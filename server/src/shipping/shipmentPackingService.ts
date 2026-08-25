/**
 * C4 发货深化 — 装箱明细服务（行级 + 逐箱级）
 *
 * 职责：
 *   - ShipmentLine 写路径单一来源（此前模型存在但全库无写入，制单靠回退链兜底）
 *   - ShipmentCarton / ShipmentCartonItem 逐箱装箱（混装分配）
 *   - 运单汇总字段派生：有箱 → 箱级合计；无箱有行 → 行级合计；皆无 → 保持手工录入
 *
 * 设计决策：
 *   1. 全量替换语义（PUT）：行/箱均以整组替换落库，事务内 delete→create，
 *      天然幂等；行被移除时级联清理引用它的箱内分配（snapshot FK 无数据库级联）。
 *   2. 编辑窗口：仅 Draft/Booked/Loading 可改装箱（Shipped 起货已离厂，锁定 409）。
 *   3. 分配校验：每行累计分配量不得超过行数量（行数量为 null 时不校验上限）。
 *   4. 体积推导：箱三尺寸齐全且 volume 缺省时按 L×W×H÷1e6 推导 CBM。
 *   5. 审计：每次替换写一条 AuditLog（PACKING_LINES_REPLACE / PACKING_CARTONS_REPLACE）。
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { assertFabricAllowed } from '../products/fabricExclusivityService';

export type PackingErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_CURRENT_STATUS'
  | 'VALIDATION_FAILED'
  | 'ORDER_NOT_FOUND'
  | 'EXCLUSIVE_FABRIC_BLOCKED'
  | 'SAVE_FAILED';

export interface PackingResult<T = any> {
  ok: boolean;
  data?: T;
  error?: { code: PackingErrorCode; message: string };
}

/** 可编辑装箱的运单状态（Shipped 起锁定） */
const PACKING_EDITABLE_STATUSES = new Set(['Draft', 'Booked', 'Loading']);

function fail<T>(code: PackingErrorCode, message: string): PackingResult<T> {
  return { ok: false, error: { code, message } };
}

function toDecimal(v: unknown): Prisma.Decimal | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(n);
}

function numOrNull(v: unknown): number | null {
  const d = toDecimal(v);
  return d === null ? null : Number(d);
}

function newId(prefix: string): string {
  return `${prefix}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 输入类型 ────────────────────────────────────────────────────

export interface ShipmentLineInput {
  orderLineId?: string | null;
  productCode?: string | null;
  productName?: string | null;
  colorCode?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  cartons?: number | null;
  grossWeight?: number | string | null;
  netWeight?: number | string | null;
  volume?: number | string | null;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
}

export interface CartonItemInput {
  shipmentLineId: string;
  quantity: number | string;
}

export interface ShipmentCartonInput {
  cartonNo: string;
  description?: string | null;
  length?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  grossWeight?: number | string | null;
  netWeight?: number | string | null;
  volume?: number | string | null;
  items?: CartonItemInput[];
}

// ─── 查询 ────────────────────────────────────────────────────────

export async function listShipmentLines(prisma: PrismaClient, shipmentId: string) {
  return (prisma as any).shipmentLine.findMany({
    where: { shipmentId },
    orderBy: { lineNumber: 'asc' },
  });
}

export async function listShipmentCartons(prisma: PrismaClient, shipmentId: string) {
  return (prisma as any).shipmentCarton.findMany({
    where: { shipmentId },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
  });
}

// ─── 汇总派生 ────────────────────────────────────────────────────

/**
 * 重算运单汇总字段（事务内调用）：
 *   有箱 → totalPackages=箱数，毛/净/体=箱级合计
 *   无箱有行 → totalPackages=行箱数合计，毛/净/体=行级合计
 *   皆无 → 不动（保持手工录入）
 */
async function recomputeShipmentTotals(t: any, shipmentId: string): Promise<void> {
  const cartons = await t.shipmentCarton.findMany({ where: { shipmentId } });
  const lines = await t.shipmentLine.findMany({ where: { shipmentId } });

  const sum = (rows: any[], key: string): Prisma.Decimal | null => {
    let has = false;
    let acc = new Prisma.Decimal(0);
    for (const r of rows) {
      if (r[key] !== null && r[key] !== undefined) {
        acc = acc.plus(new Prisma.Decimal(r[key].toString()));
        has = true;
      }
    }
    return has ? acc : null;
  };

  let patch: any = null;
  if (cartons.length > 0) {
    patch = {
      totalPackages: cartons.length,
      grossWeight: sum(cartons, 'grossWeight'),
      netWeight: sum(cartons, 'netWeight'),
      volume: sum(cartons, 'volume'),
    };
  } else if (lines.length > 0) {
    const cartonSum = lines.reduce((acc: number, l: any) => acc + (typeof l.cartons === 'number' ? l.cartons : 0), 0);
    patch = {
      totalPackages: cartonSum > 0 ? cartonSum : null,
      grossWeight: sum(lines, 'grossWeight'),
      netWeight: sum(lines, 'netWeight'),
      volume: sum(lines, 'volume'),
    };
  }
  if (patch) {
    await t.shipment.update({ where: { id: shipmentId }, data: { ...patch, updatedAt: BigInt(Date.now()) } });
  }
}

// ─── 守卫 ────────────────────────────────────────────────────────

async function loadEditableShipment(t: any, shipmentId: string) {
  const sh = await t.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, deletedAt: true, orderId: true } });
  if (!sh || sh.deletedAt) {
    throw Object.assign(new Error(`运单 ${shipmentId} 不存在`), { code: 'NOT_FOUND' });
  }
  if (!PACKING_EDITABLE_STATUSES.has(sh.status)) {
    throw Object.assign(
      new Error(`运单状态 ${sh.status} 不可编辑装箱明细（仅 Draft/Booked/Loading 可编辑）`),
      { code: 'INVALID_CURRENT_STATUS' },
    );
  }
  return sh;
}

function toPackingError(e: any): { code: PackingErrorCode; message: string } {
  if (e?.code === 'NOT_FOUND' || e?.code === 'INVALID_CURRENT_STATUS' || e?.code === 'VALIDATION_FAILED' || e?.code === 'ORDER_NOT_FOUND' || e?.code === 'EXCLUSIVE_FABRIC_BLOCKED') {
    return { code: e.code, message: String(e.message ?? e) };
  }
  return { code: 'SAVE_FAILED', message: String(e?.message ?? e) };
}

// ─── 行级装箱：整组替换 ──────────────────────────────────────────

/** 事务内整组替换装运行（createShipment 首装 / pull-from-order / PUT 共用） */
export async function replaceShipmentLinesTx(
  t: any,
  shipmentId: string,
  lines: ShipmentLineInput[],
  actorId: string,
  ip?: string | null,
  options?: { skipStatusCheck?: boolean },
): Promise<any[]> {
  if (!options?.skipStatusCheck) {
    await loadEditableShipment(t, shipmentId);
  }

  // 校验
  lines.forEach((l, i) => {
    const qty = numOrNull(l.quantity);
    if (qty !== null && qty < 0) {
      throw Object.assign(new Error(`第 ${i + 1} 行数量不能为负`), { code: 'VALIDATION_FAILED' });
    }
    if (l.cartons !== null && l.cartons !== undefined && (!Number.isInteger(Number(l.cartons)) || Number(l.cartons) < 0)) {
      throw Object.assign(new Error(`第 ${i + 1} 行箱数必须为非负整数`), { code: 'VALIDATION_FAILED' });
    }
  });

  // P1-3 客户专属面料校验（fail-closed：行产品锚命中他人独占面料 → 409，违规尝试留痕）
  // 锚解析：orderLineId → OrderLine（客供品号/品色号）；无 orderLineId 行按 productCode 兜底为客供品号。
  const exclusiveLineIds = lines.map(l => l.orderLineId).filter((x): x is string => !!x);
  const orderLinesById = new Map<string, any>(
    exclusiveLineIds.length > 0
      ? (await t.orderLine.findMany({ where: { id: { in: exclusiveLineIds } }, select: { id: true, materialCode: true, millQuality: true } })).map((ol: any) => [ol.id, ol])
      : [],
  );
  const shipmentForExclusive = await t.shipment.findUnique({
    where: { id: shipmentId },
    select: { customerRelationId: true, customerName: true },
  });
  for (const l of lines) {
    const ol = l.orderLineId ? orderLinesById.get(l.orderLineId) : null;
    const clientCode = ol?.materialCode ?? l.productCode ?? null;
    const millQuality = ol?.millQuality ?? null;
    if (!clientCode && !millQuality) continue;
    const exclusive = await assertFabricAllowed(t, {
      customer: { customerRelationId: shipmentForExclusive?.customerRelationId ?? null, customerName: shipmentForExclusive?.customerName ?? null },
      productKeys: { clientCode, millQuality, clientCodeCustomerHint: shipmentForExclusive?.customerRelationId ?? null },
      context: 'shipment-lines:replace',
      actorId,
      documentRef: { shipmentId, orderLineId: l.orderLineId ?? null, productCode: l.productCode ?? null },
    });
    if (!exclusive.ok) {
      throw Object.assign(new Error(exclusive.error.message), { code: exclusive.error.code, statusCode: exclusive.error.status });
    }
  }

  const ts = BigInt(Date.now());
  // 级联：被移除的行需清理箱内分配（snapshot FK 无数据库级联）
  const removedLineIds: string[] = (await t.shipmentLine.findMany({ where: { shipmentId }, select: { id: true } })).map((r: any) => r.id);
  if (removedLineIds.length > 0) {
    await t.shipmentCartonItem.deleteMany({ where: { shipmentLineId: { in: removedLineIds } } });
  }
  await t.shipmentLine.deleteMany({ where: { shipmentId } });

  const created: any[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    created.push(await t.shipmentLine.create({
      data: {
        id: newId('SHPL'),
        shipmentId,
        lineNumber: i + 1,
        orderLineId: l.orderLineId ?? null,
        productCode: l.productCode ?? null,
        productName: l.productName ?? null,
        colorCode: l.colorCode ?? null,
        quantity: toDecimal(l.quantity),
        unit: l.unit ?? null,
        cartons: l.cartons !== null && l.cartons !== undefined ? Number(l.cartons) : null,
        grossWeight: toDecimal(l.grossWeight),
        netWeight: toDecimal(l.netWeight),
        volume: toDecimal(l.volume),
        hsCode: l.hsCode ?? null,
        countryOfOrigin: l.countryOfOrigin ?? null,
        createdAt: ts,
        updatedAt: ts,
      },
    }));
  }

  await recomputeShipmentTotals(t, shipmentId);
  await writeRouteAuditLog({
    prisma: t, actorId, source: 'route:shipping:packing',
    operation: 'PACKING_LINES_REPLACE', targetType: 'Shipment', targetId: shipmentId,
    after: { lineCount: created.length },
    ip: ip || null,
  });
  return created;
}

export async function replaceShipmentLines(
  prisma: PrismaClient,
  shipmentId: string,
  lines: ShipmentLineInput[],
  actorId: string,
  ip?: string | null,
): Promise<PackingResult<{ lines: any[] }>> {
  try {
    const result = await (prisma as any).$transaction(async (t: any) => {
      return replaceShipmentLinesTx(t, shipmentId, lines, actorId, ip);
    });
    return { ok: true, data: { lines: result } };
  } catch (e: any) {
    return fail(toPackingError(e).code, toPackingError(e).message);
  }
}

/** OrderLine → ShipmentLineInput 映射（单一来源，pull 端点与 createShipment 首装共用） */
export function mapOrderLinesToShipmentLineInputs(orderLines: any[]): ShipmentLineInput[] {
  return orderLines.map((ol: any) => ({
    orderLineId: ol.id,
    productCode: ol.materialCode ?? ol.itemNo ?? null,
    productName: ol.description ?? null,
    quantity: ol.quantity !== null && ol.quantity !== undefined ? ol.quantity.toString() : null,
    unit: ol.unit ?? null,
  }));
}

// ─── 从订单带出装运行 ────────────────────────────────────────────

export async function pullLinesFromOrder(
  prisma: PrismaClient,
  shipmentId: string,
  actorId: string,
  ip?: string | null,
): Promise<PackingResult<{ lines: any[] }>> {
  try {
    const orderLines = await (prisma as any).$transaction(async (t: any) => {
      const sh = await loadEditableShipment(t, shipmentId);
      if (!sh.orderId) {
        throw Object.assign(new Error('运单未关联订单，无法带出装运行'), { code: 'VALIDATION_FAILED' });
      }
      const order = await t.order.findUnique({ where: { id: sh.orderId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      if (!order || order.deletedAt) {
        throw Object.assign(new Error(`订单 ${sh.orderId} 不存在`), { code: 'ORDER_NOT_FOUND' });
      }
      return order.lines as any[];
    });

    const lines: ShipmentLineInput[] = mapOrderLinesToShipmentLineInputs(orderLines);
    return replaceShipmentLines(prisma, shipmentId, lines, actorId, ip);
  } catch (e: any) {
    return fail(toPackingError(e).code, toPackingError(e).message);
  }
}

// ─── 逐箱装箱：整组替换 ──────────────────────────────────────────

export async function replaceShipmentCartons(
  prisma: PrismaClient,
  shipmentId: string,
  cartons: ShipmentCartonInput[],
  actorId: string,
  ip?: string | null,
): Promise<PackingResult<{ cartons: any[] }>> {
  try {
    const result = await (prisma as any).$transaction(async (t: any) => {
      await loadEditableShipment(t, shipmentId);

      const lines: any[] = await t.shipmentLine.findMany({ where: { shipmentId } });
      const lineById = new Map<string, any>(lines.map((l: any) => [l.id, l]));

      // 校验：箱号必填；分配引用本运单既有行；每行累计分配 ≤ 行数量
      const allocatedByLine = new Map<string, Prisma.Decimal>();
      cartons.forEach((c, ci) => {
        if (!c.cartonNo || !String(c.cartonNo).trim()) {
          throw Object.assign(new Error(`第 ${ci + 1} 箱箱号必填`), { code: 'VALIDATION_FAILED' });
        }
        for (const item of c.items ?? []) {
          const line = lineById.get(item.shipmentLineId);
          if (!line) {
            throw Object.assign(new Error(`箱 ${c.cartonNo} 分配了不属于本运单的装运行 ${item.shipmentLineId}`), { code: 'VALIDATION_FAILED' });
          }
          const qty = toDecimal(item.quantity);
          if (qty === null || qty.lte(0)) {
            throw Object.assign(new Error(`箱 ${c.cartonNo} 分配数量必须为正数`), { code: 'VALIDATION_FAILED' });
          }
          const acc = (allocatedByLine.get(item.shipmentLineId) ?? new Prisma.Decimal(0)).plus(qty);
          allocatedByLine.set(item.shipmentLineId, acc);
        }
      });
      for (const [lineId, allocated] of allocatedByLine) {
        const line = lineById.get(lineId)!;
        if (line.quantity !== null && allocated.gt(new Prisma.Decimal(line.quantity.toString()))) {
          throw Object.assign(
            new Error(`装运行 ${line.lineNumber} 累计分配 ${allocated.toString()} 超过行数量 ${line.quantity.toString()}`),
            { code: 'VALIDATION_FAILED' },
          );
        }
      }

      const ts = BigInt(Date.now());
      await t.shipmentCarton.deleteMany({ where: { shipmentId } }); // items 随 onDelete: Cascade

      const created: any[] = [];
      for (const c of cartons) {
        const length = toDecimal(c.length);
        const width = toDecimal(c.width);
        const height = toDecimal(c.height);
        let volume = toDecimal(c.volume);
        if (volume === null && length !== null && width !== null && height !== null) {
          volume = length.mul(width).mul(height).div(1_000_000); // cm³ → CBM
        }
        const carton = await t.shipmentCarton.create({
          data: {
            id: newId('SHPC'),
            shipmentId,
            cartonNo: String(c.cartonNo).trim(),
            description: c.description ?? null,
            length, width, height,
            grossWeight: toDecimal(c.grossWeight),
            netWeight: toDecimal(c.netWeight),
            volume,
            createdAt: ts,
            updatedAt: ts,
          },
        });
        const items: any[] = [];
        for (const item of c.items ?? []) {
          items.push(await t.shipmentCartonItem.create({
            data: {
              id: newId('SHPCI'),
              cartonId: carton.id,
              shipmentLineId: item.shipmentLineId,
              quantity: toDecimal(item.quantity)!,
              createdAt: ts,
              updatedAt: ts,
            },
          }));
        }
        created.push({ ...carton, items });
      }

      await recomputeShipmentTotals(t, shipmentId);
      await writeRouteAuditLog({
        prisma: t, actorId, source: 'route:shipping:packing',
        operation: 'PACKING_CARTONS_REPLACE', targetType: 'Shipment', targetId: shipmentId,
        after: { cartonCount: created.length },
        ip: ip || null,
      });
      return created;
    });
    return { ok: true, data: { cartons: result } };
  } catch (e: any) {
    const err = toPackingError(e);
    return fail(err.code, err.message);
  }
}
