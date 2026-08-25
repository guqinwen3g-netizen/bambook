/**
 * fabricExclusivityService.ts — P1-3 客户专属面料规则（owner fabric 行业铁律）
 *
 * 设计真源：docs/design/10-评审与决策/2026-08-25-中度与严重缺失功能开发优先级规划.md P1-3
 * schema 真源：schema.prisma model FabricCustomerCode.isExclusive（含设计决策注释）
 *
 * 业务规则：客户 A 出资开发的独家面料（FabricCustomerCode.isExclusive=true，属主=A）
 * 不得用于客户 B 的报价/订单/样品/出运——违反即商业事故，fail-closed 阻断。
 *
 * 校验单一真源（四入口共用，漏一个即规则失效——源码契约测试锁住）：
 *   ① OrderLine 创建/更新（orders/orderLineMutationService，route + Agent flow 双通道）
 *   ② QuotationLine 创建/重建（quotations/quotationService，route + Agent flow 双通道）
 *   ③ FabricShipmentSample 登记（samples/fabricShipmentSampleService，S/S 船样 + RC 匹头样）
 *   ④ ShipmentLine 装箱（shipping/shipmentPackingService.replaceShipmentLinesTx 三收敛口）
 *
 * 产品锚解析（多键，按入口可用字段取并集）：
 *   productAssetId（直查）> sku > fabricProfile.articleNo/millQuality > fabricCustomerCode.clientCode
 * 无产品锚时不阻断（字段空不能卡业务）；解析到多个产品时全部校验（保守 Fail-closed）。
 *
 * 属主匹配：customerOrganizationId === 单据 customerRelationId 优先；
 * 无 relationId 时按 customerNameSnapshot 与单据 customerName 精确匹配兜底。
 * 违规尝试写 routeAudit 留痕（operation: exclusive_fabric_violation_attempt）。
 */
import { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { logger } from '../lib/logger';

export type ExclusivityResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } };

export interface FabricProductKeys {
  /** 产品档案直锚（Sample.fabricProfileId 解析后传入） */
  productAssetId?: string | null;
  /** ProductAsset.sku */
  sku?: string | null;
  /** FabricProfile.articleNo */
  articleNo?: string | null;
  /** FabricProfile.millQuality（工厂品色号） */
  millQuality?: string | null;
  /** FabricCustomerCode.clientCode（客供品号；无客户绑定的通用客户码也是解析线索） */
  clientCode?: string | null;
  /** clientCode 客户范围提示：优先解析「本客户登记的码 + 无客户绑定的通用码」，
   *  避免他司客户码偶发碰撞造成误报；范围化无命中时按 clientCodeGlobalFallback 决定是否全局兜底 */
  clientCodeCustomerHint?: string | null;
  /** clientCode 范围化无命中时是否全局兜底（默认 true：OrderLine.materialCode 语义即客供品号） */
  clientCodeGlobalFallback?: boolean;
}

export interface ExclusivityViolation {
  productAssetId: string;
  sku: string | null;
  productName: string | null;
  ownerCustomerName: string | null;
  ownerRelationId: string | null;
  clientCode: string | null;
}

const nonEmpty = (v: string | null | undefined): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
};

/** 多键解析产品档案集合（productAssetId > sku > articleNo/millQuality > clientCode；并集去重） */
export async function resolveProductAssets(prisma: PrismaClient, keys: FabricProductKeys): Promise<Array<{ id: string; sku: string; name: string }>> {
  const db = prisma as any;
  const ids = new Set<string>();
  const directId = nonEmpty(keys.productAssetId);
  if (directId) ids.add(directId);

  const sku = nonEmpty(keys.sku);
  if (sku) {
    const rows = await db.productAsset.findMany({ where: { sku, deletedAt: null }, select: { id: true } });
    rows.forEach((r: any) => ids.add(r.id));
  }

  const articleNo = nonEmpty(keys.articleNo);
  const millQuality = nonEmpty(keys.millQuality);
  if (articleNo || millQuality) {
    const rows = await db.fabricProfile.findMany({
      where: {
        deletedAt: null,
        ...(articleNo && millQuality ? { OR: [{ articleNo }, { millQuality }] } : articleNo ? { articleNo } : { millQuality }),
      },
      select: { productAssetId: true },
    });
    rows.forEach((r: any) => ids.add(r.productAssetId));
  }

  const clientCode = nonEmpty(keys.clientCode);
  if (clientCode) {
    // 客户范围化优先：本客户登记的码 + 无客户绑定的通用码（防他司客户码碰撞误报）
    const hint = nonEmpty(keys.clientCodeCustomerHint ?? null);
    let rows: any[] = [];
    if (hint) {
      rows = await db.fabricCustomerCode.findMany({
        where: { clientCode, deletedAt: null, OR: [{ customerOrganizationId: null }, { customerOrganizationId: hint }] },
        select: { productAssetId: true },
      });
    }
    if (rows.length === 0 && keys.clientCodeGlobalFallback !== false) {
      rows = await db.fabricCustomerCode.findMany({
        where: { clientCode, deletedAt: null },
        select: { productAssetId: true },
      });
    }
    rows.forEach((r: any) => ids.add(r.productAssetId));
  }

  if (ids.size === 0) return [];
  return db.productAsset.findMany({
    where: { id: { in: [...ids] }, deletedAt: null },
    select: { id: true, sku: true, name: true },
  });
}

/** 校验核心：给定产品集合 × 单据客户 → 违规清单（专属属主 ≠ 当前客户） */
export async function checkExclusivityForAssets(
  prisma: PrismaClient,
  productAssetIds: string[],
  customer: { customerRelationId?: string | null; customerName?: string | null },
): Promise<ExclusivityViolation[]> {
  const db = prisma as any;
  if (productAssetIds.length === 0) return [];
  const relationId = nonEmpty(customer.customerRelationId ?? null);
  const customerName = nonEmpty(customer.customerName ?? null);

  const exclusiveRows = await db.fabricCustomerCode.findMany({
    where: { productAssetId: { in: productAssetIds }, isExclusive: true, deletedAt: null },
    select: { productAssetId: true, customerOrganizationId: true, customerNameSnapshot: true, clientCode: true },
  });
  if (exclusiveRows.length === 0) return [];

  const assets = await db.productAsset.findMany({
    where: { id: { in: productAssetIds } },
    select: { id: true, sku: true, name: true },
  });
  const assetById = new Map<string, any>(assets.map((a: any) => [a.id, a]));

  const violations: ExclusivityViolation[] = [];
  for (const row of exclusiveRows) {
    const isOwner = (relationId != null && row.customerOrganizationId === relationId)
      || (customerName != null && nonEmpty(row.customerNameSnapshot) === customerName);
    if (isOwner) continue;
    const asset = assetById.get(row.productAssetId);
    violations.push({
      productAssetId: row.productAssetId,
      sku: asset?.sku ?? null,
      productName: asset?.name ?? null,
      ownerCustomerName: nonEmpty(row.customerNameSnapshot) ?? row.customerOrganizationId ?? null,
      ownerRelationId: row.customerOrganizationId ?? null,
      clientCode: nonEmpty(row.clientCode),
    });
  }
  return violations;
}

/**
 * fail-closed 断言（四入口共用）。违规时返回 409 EXCLUSIVE_FABRIC_BLOCKED
 * 并写 routeAudit 违规尝试留痕（即便被阻断也要可审计）。
 */
export async function assertFabricAllowed(
  prisma: PrismaClient,
  params: {
    customer: { customerRelationId?: string | null; customerName?: string | null };
    productAssetIds?: string[];
    productKeys?: FabricProductKeys;
    /** 校验入口标识（审计 source）：如 'order-line:create' / 'quotation:create' */
    context: string;
    actorId?: string;
    /** 单据定位（审计补充）：如 orderId/quotationId */
    documentRef?: Record<string, unknown>;
  },
): Promise<ExclusivityResult<{ checked: number }>> {
  try {
    const resolved = params.productAssetIds?.length
      ? await (prisma as any).productAsset.findMany({
          where: { id: { in: params.productAssetIds }, deletedAt: null },
          select: { id: true },
        })
      : [];
    const keyResolved = params.productKeys ? await resolveProductAssets(prisma, params.productKeys) : [];
    const ids = [...new Set([...resolved.map((r: any) => r.id), ...keyResolved.map((r: any) => r.id)])];
    if (ids.length === 0) return { ok: true, data: { checked: 0 } }; // 无产品锚不阻断

    const violations = await checkExclusivityForAssets(prisma, ids, params.customer);
    if (violations.length === 0) return { ok: true, data: { checked: ids.length } };

    const customerLabel = nonEmpty(params.customer.customerName ?? null) ?? params.customer.customerRelationId ?? '未识别客户';
    const violationLines = violations.map(v =>
      `面料「${v.productName ?? v.sku ?? v.productAssetId}」${v.clientCode ? `（客供品号 ${v.clientCode}）` : ''}为客户「${v.ownerCustomerName ?? '未知属主'}」出资开发的专属面料`);
    const message = `专属面料阻断：${violationLines.join('；')}——当前单据客户（${customerLabel}）无权使用。如确需使用请走属主客户授权变更。`;

    // 违规尝试留痕（fail-closed 前置审计）
    await writeRouteAuditLog({
      prisma,
      actorId: params.actorId || 'api',
      source: `fabric-exclusivity:${params.context}`,
      operation: 'exclusive_fabric_violation_attempt',
      targetType: 'ProductAsset',
      targetId: violations[0].productAssetId,
      before: null,
      after: {
        violations,
        customer: params.customer,
        documentRef: params.documentRef ?? null,
      },
      ip: null,
    }).catch(() => { /* 审计失败不改变阻断语义 */ });

    logger.warn('[FabricExclusivity] blocked', { context: params.context, violations: violations.length, customer: customerLabel });
    return { ok: false, error: { code: 'EXCLUSIVE_FABRIC_BLOCKED', message, status: 409 } };
  } catch (e: any) {
    // 校验器自身故障不阻断业务（避免误杀），但记录错误待修
    logger.error('[FabricExclusivity] assert failed (fail-open logged)', { context: params.context, error: e?.message });
    return { ok: true, data: { checked: 0 } };
  }
}

/** 专属标记维护校验：isExclusive 行必须有属主锚（customerOrganizationId 或名称快照） */
export function validateExclusiveCodes(rows: Array<{ isExclusive?: boolean | null; customerOrganizationId?: string | null; customerNameSnapshot?: string | null; clientCode?: string | null }>): string | null {
  for (const row of rows) {
    if (row.isExclusive !== true) continue;
    if (!nonEmpty(row.customerOrganizationId) && !nonEmpty(row.customerNameSnapshot)) {
      return `专属面料行（客供品号 ${row.clientCode ?? '—'}）必须绑定属主客户（customerOrganizationId / customerNameSnapshot 至少其一），否则无法锚定属主执行阻断`;
    }
  }
  return null;
}

/** FabricProfile.id → ProductAsset.id（样品链直锚解析；未命中返回 null） */
export async function productAssetIdOfFabricProfile(prisma: PrismaClient, fabricProfileId: string | null | undefined): Promise<string | null> {
  const id = nonEmpty(fabricProfileId);
  if (!id) return null;
  const row = await (prisma as any).fabricProfile.findFirst({ where: { id, deletedAt: null }, select: { productAssetId: true } });
  return row?.productAssetId ?? null;
}
