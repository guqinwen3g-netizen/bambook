/**
 * materialReturnService — P1-4 物料退换货（退货/换货/索赔）
 *
 * 设计真源：docs/design/10-评审与决策/2026-08-25-中度与严重缺失功能开发优先级规划.md P1-4
 * schema 真源：schema.prisma model MaterialReturn（含设计决策注释）
 *
 * 状态机：pending(待退回) → shipped(已退回) → confirmed(供应商确认) → settled(结算完成)
 *         pending → cancelled
 *
 * 联动规则：
 *   return   ：shipped 库存 Outbound 冲减；confirmed 无库存动作
 *   exchange ：shipped Outbound 冲减；confirmed 同一库存项 Inbound 回冲（换新到货，保对称）
 *   claim    ：不动物料库存；confirmed 生成负向 Payable 发票（CLM-YYYY-NNNN，CreditNote
 *              最小实现）——供应商对账单聚合负发票自然冲减应付余额
 *   绩效     ：confirm 按拒收率分级评分写 FactoryEvaluation（kind=inspection，
 *              sourceType='materialReturn'，recordAutoEvaluation 幂等，无档案静默跳过）
 *
 * 库存联动降级语义（次品未入库场景）：按 materialCode 查库存项——
 *   未找到 → 跳过联动（审计留痕 skipStockReason：次品从未入库，如收料即判退不进仓）；
 *   找到但数量不足 → fail-closed（真实库存冲突不允许静默透支）。
 *
 * 实物上限：receipt.totalRejected − 同 receipt 非 cancelled 的 return/exchange 已占数量。
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { nextBusinessNumber } from '../shared/businessNumberService';
import { createInventoryService } from '../inventory/inventoryService';
import { logger } from '../lib/logger';

export type MaterialReturnResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } };

const fail = (code: string, message: string, status = 400): MaterialReturnResult<never> =>
  ({ ok: false, error: { code, message, status } });

export const MATERIAL_RETURN_TYPES = ['return', 'exchange', 'claim'] as const;
export const MATERIAL_RETURN_STATUSES = ['pending', 'shipped', 'confirmed', 'settled', 'cancelled'] as const;

export const MATERIAL_RETURN_TYPE_LABELS: Record<string, string> = {
  return: '退货', exchange: '换货', claim: '索赔',
};
export const MATERIAL_RETURN_STATUS_LABELS: Record<string, string> = {
  pending: '待退回', shipped: '已退回', confirmed: '供应商已确认', settled: '结算完成', cancelled: '已取消',
};

/** 拒收率 → 供应商绩效评分（对齐供应商对账文档 §5 差异处理分级） */
export function returnRateScore(rejected: number, received: number): number {
  if (!(received > 0)) return 60;
  const rate = rejected / received;
  if (rate <= 0.05) return 90; // ≤5%：退货折让扣款档
  if (rate <= 0.10) return 70; // 5-10%：退货 + 整改档
  return 40; // >10%：批次拒收 + 评级降级档
}

function shortId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface CreateMaterialReturnInput {
  receiptId: string;
  type: string;
  materialCode?: string;
  materialName?: string;
  quantity: number;
  unit?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  notes?: string;
}

export function createMaterialReturnService(prisma: PrismaClient) {
  const db = prisma as any;
  const inventoryService = createInventoryService(prisma);

  /** 同 receipt 实物额度：totalRejected − 非 cancelled 的 return/exchange 已占数量 */
  async function remainingQuota(receiptId: string, excludeReturnId?: string): Promise<number> {
    const receipt = await db.materialReceipt.findUnique({ where: { id: receiptId } });
    if (!receipt) return -1;
    const siblings = await db.materialReturn.findMany({
      where: {
        receiptId,
        status: { not: 'cancelled' },
        deletedAt: null,
        type: { in: ['return', 'exchange'] },
        ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
      },
      select: { quantity: true },
    });
    const used = siblings.reduce((s: number, r: any) => s + Number(r.quantity), 0);
    return Number(receipt.totalRejected) - used;
  }

  // ── 登记退换货/索赔（pending）──
  async function createReturn(input: CreateMaterialReturnInput, actorId?: string): Promise<MaterialReturnResult<any>> {
    try {
      const receiptId = String(input.receiptId ?? '').trim();
      if (!receiptId) return fail('RECEIPT_REQUIRED', 'receiptId 必填（退换货锚定来料检验单）');
      const type = String(input.type ?? '').trim();
      if (!(MATERIAL_RETURN_TYPES as readonly string[]).includes(type)) {
        return fail('INVALID_TYPE', `type 须为 ${MATERIAL_RETURN_TYPES.join(' | ')}`);
      }
      const quantity = num(input.quantity) ?? -1;
      if (quantity < 0) return fail('INVALID_QUANTITY', 'quantity 须为非负数');
      if (type !== 'claim' && quantity <= 0) {
        return fail('INVALID_QUANTITY', '退货/换货数量必须大于 0');
      }
      const amount = num(input.amount ?? null);
      if (type === 'claim' && (amount == null || amount <= 0)) {
        return fail('AMOUNT_REQUIRED', '索赔（claim）必须填写索赔金额（正数）');
      }
      if (amount != null && amount < 0) return fail('INVALID_AMOUNT', 'amount 须为非负数（索赔/折让金额）');
      if (type !== 'claim' && !String(input.materialCode ?? '').trim()) {
        return fail('MATERIAL_CODE_REQUIRED', '退货/换货必须填写物料编码（库存联动锚点）');
      }

      const receipt = await db.materialReceipt.findUnique({ where: { id: receiptId } });
      if (!receipt) return fail('RECEIPT_NOT_FOUND', `来料检验单 ${receiptId} 不存在`, 404);
      const po = await db.purchaseOrder.findUnique({ where: { id: receipt.purchaseOrderId } });
      if (!po) return fail('PO_NOT_FOUND', `采购单 ${receipt.purchaseOrderId} 不存在`, 404);

      // 实物额度校验（claim 纯金额不占额度）
      if (type !== 'claim') {
        const quota = await remainingQuota(receiptId);
        if (quantity > quota + 1e-9) {
          return fail('QUOTA_EXCEEDED', `退换数量超出来料不合格额度：本单不合格 ${Number(receipt.totalRejected)}，剩余可退 ${Math.max(0, Math.round(quota * 10000) / 10000)}`);
        }
      }

      const now = Date.now();
      const currency = String(input.currency ?? po.currency ?? 'CNY').trim() || 'CNY';
      const returnNumber = await nextBusinessNumber(db, 'RT', undefined, {
        occupied: async (n: string) => !!(await db.materialReturn.findFirst({ where: { returnNumber: n }, select: { id: true } })),
      });

      const created = await db.$transaction(async (tx: any) => {
        const row = await tx.materialReturn.create({
          data: {
            id: shortId('MATRET'),
            returnNumber,
            receiptId,
            purchaseOrderId: receipt.purchaseOrderId,
            supplierRelationId: po.supplierRelationId ?? null,
            supplierName: po.supplierName ?? null,
            type,
            materialCode: String(input.materialCode ?? '').trim() || null,
            materialName: String(input.materialName ?? '').trim() || null,
            quantity,
            unit: String(input.unit ?? '').trim() || null,
            amount: amount ?? null,
            currency,
            status: 'pending',
            reason: String(input.reason ?? receipt.rejectionReason ?? '').trim() || null,
            notes: String(input.notes ?? '').trim() || null,
            createdAt: now,
            updatedAt: now,
          },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:procurement:material-return',
          operation: 'create_material_return',
          targetType: 'MaterialReturn',
          targetId: row.id,
          after: { returnNumber, type, quantity, amount: amount ?? null, receiptId },
          ip: null,
        });
        return row;
      });
      logger.info('[MaterialReturn] created', { returnNumber, type, quantity, receiptId });
      return { ok: true, data: { materialReturn: created } };
    } catch (e: any) {
      logger.error('[MaterialReturn] create failed', { error: e?.message });
      return fail('CREATE_FAILED', e?.message || '退换货登记失败', 500);
    }
  }

  /** 库存项解析：materialCode（收料仓库优先 → 任意在用仓库）；未找到返回 null */
  async function resolveStockItem(materialCode: string, warehouseId?: string | null): Promise<any | null> {
    const base = { materialCode, deletedAt: null };
    if (warehouseId) {
      const inWh = await db.inventoryItem.findFirst({ where: { ...base, warehouseId } });
      if (inWh) return inWh;
    }
    return db.inventoryItem.findFirst({ where: base });
  }

  /** 幂等防重：该退换单是否已产生指定类型的库存流水（对齐 L8 联动去重范式，重试安全） */
  async function hasStockMovement(returnId: string, type: 'Inbound' | 'Outbound'): Promise<boolean> {
    const dup = await db.stockMovement.findFirst({
      where: { referenceType: 'MaterialReturn', referenceId: returnId, type },
      select: { id: true },
    });
    return !!dup;
  }

  // ── 发运确认（pending → shipped；return/exchange 库存 Outbound 冲减）──
  async function markShipped(id: string, actorId?: string): Promise<MaterialReturnResult<any>> {
    try {
      const row = await db.materialReturn.findUnique({ where: { id } });
      if (!row || row.deletedAt) return fail('NOT_FOUND', `退换货单 ${id} 不存在`, 404);
      if (row.status !== 'pending') {
        return fail('INVALID_STATUS', `退换货单状态为 ${row.status}，仅 pending 可发运确认`, 409);
      }

      // 库存联动（return/exchange）：找库存项 → Outbound；未找到跳过（次品未入库留痕）
      let stockItemId: string | null = null;
      let skipStockReason: string | null = null;
      if (row.type !== 'claim' && row.materialCode) {
        if (await hasStockMovement(row.id, 'Outbound')) {
          // 幂等重试：出库流水已存在（前次执行后状态更新失败场景），直接采用既有库存项
          stockItemId = row.stockItemId;
          skipStockReason = '出库流水已存在（幂等重试），跳过重复出库';
        } else {
          const receipt = await db.materialReceipt.findUnique({ where: { id: row.receiptId } });
          const item = await resolveStockItem(row.materialCode, receipt?.warehouseId ?? null);
          if (!item) {
            skipStockReason = `物料 ${row.materialCode} 无在库库存项（次品未入库场景），跳过出库联动`;
          } else {
            const qty = Number(row.quantity);
            if (qty > Number(item.quantity) + 1e-9) {
              return fail('STOCK_INSUFFICIENT', `库存不足：物料 ${row.materialCode} 当前 ${Number(item.quantity)} ${row.unit ?? ''}，退货需 ${qty}（请先核对入库记录）`, 409);
            }
            await inventoryService.createStockMovement({
              itemId: item.id,
              type: 'Outbound',
              quantity: qty,
              unit: row.unit ?? undefined,
              reason: `物料退换货：${row.returnNumber}（${MATERIAL_RETURN_TYPE_LABELS[row.type] ?? row.type}）`,
              referenceType: 'MaterialReturn',
              referenceId: row.id,
              notes: `P1-4 退换货出库联动，采购单 ${row.purchaseOrderId}`,
            }, actorId || 'system');
            stockItemId = item.id;
          }
        }
      }

      const now = Date.now();
      const updated = await db.$transaction(async (tx: any) => {
        const next = await tx.materialReturn.update({
          where: { id },
          data: { status: 'shipped', stockItemId, updatedAt: now },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:procurement:material-return',
          operation: 'mark_shipped_material_return',
          targetType: 'MaterialReturn',
          targetId: id,
          before: { status: 'pending' },
          after: { status: 'shipped', stockItemId, skipStockReason: skipStockReason ?? null },
          ip: null,
        });
        return next;
      });
      if (skipStockReason) logger.info('[MaterialReturn] stock outbound skipped', { id, reason: skipStockReason });
      return { ok: true, data: { materialReturn: updated, skipStockReason } };
    } catch (e: any) {
      logger.error('[MaterialReturn] markShipped failed', { error: e?.message });
      return fail('SHIP_FAILED', e?.message || '发运确认失败', 500);
    }
  }

  // ── 供应商确认（shipped → confirmed；exchange 回冲 / claim 负向应付发票 / 绩效评分）──
  async function confirmReturn(id: string, actorId?: string): Promise<MaterialReturnResult<any>> {
    try {
      const row = await db.materialReturn.findUnique({ where: { id } });
      if (!row || row.deletedAt) return fail('NOT_FOUND', `退换货单 ${id} 不存在`, 404);
      if (row.status !== 'shipped') {
        return fail('INVALID_STATUS', `退换货单状态为 ${row.status}，仅 shipped 可供应商确认`, 409);
      }
      const receipt = await db.materialReceipt.findUnique({ where: { id: row.receiptId } });

      // exchange：换新到货回冲（仅 shipped 时执行过出库的同一库存项，保对称；幂等防重）
      // 在状态事务之前执行——失败则状态停留 shipped，重试确认不会重复回冲（hasStockMovement 防重）。
      if (row.type === 'exchange' && row.stockItemId && !(await hasStockMovement(row.id, 'Inbound'))) {
        await inventoryService.createStockMovement({
          itemId: row.stockItemId,
          type: 'Inbound',
          quantity: Number(row.quantity),
          unit: row.unit ?? undefined,
          reason: `换货到货回冲：${row.returnNumber}`,
          referenceType: 'MaterialReturn',
          referenceId: row.id,
          notes: `P1-4 换货回冲，采购单 ${row.purchaseOrderId}`,
        }, actorId || 'system');
      }

      const now = Date.now();
      const today = todayYmd();
      const result = await db.$transaction(async (tx: any) => {
        let claimInvoiceId: string | null = row.claimInvoiceId;

        // claim：生成负向 Payable 发票（CLM-YYYY-NNNN，贷项通知单——对账单自然冲减应付）
        if (row.type === 'claim' && row.amount != null && !claimInvoiceId) {
          const invoiceNumber = await nextBusinessNumber(tx, 'CLM', undefined, {
            occupied: async (n: string) => !!(await tx.invoice.findFirst({ where: { invoiceNumber: n }, select: { id: true } })),
          });
          const invoice = await tx.invoice.create({
            data: {
              id: shortId('INV'),
              invoiceNumber,
              type: 'Payable',
              status: 'Issued',
              amount: -Math.abs(Number(row.amount)), // 负向冲减
              currency: row.currency,
              issueDate: today,
              customerRelationId: row.supplierRelationId ?? null,
              customerName: row.supplierName ?? null,
              notes: `物料索赔贷项：退换单 ${row.returnNumber}${row.reason ? `（${row.reason}）` : ''}，冲减应付`,
              createdAt: now,
              updatedAt: now,
            },
          });
          claimInvoiceId = invoice.id;
        }

        const next = await tx.materialReturn.update({
          where: { id },
          data: { status: 'confirmed', claimInvoiceId, updatedAt: now },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:procurement:material-return',
          operation: 'confirm_material_return',
          targetType: 'MaterialReturn',
          targetId: id,
          before: { status: 'shipped' },
          after: { status: 'confirmed', claimInvoiceId, exchangeStockIn: row.type === 'exchange' && !!row.stockItemId },
          ip: null,
        });
        return { materialReturn: next, claimInvoiceId };
      });

      // 供应商绩效：拒收率分级评分（非阻塞，幂等）
      if (row.supplierRelationId && receipt) {
        try {
          const { createFactoryService } = await import('../suppliers/factoryService');
          const factoryService = createFactoryService(prisma);
          const score = returnRateScore(Number(receipt.totalRejected), Number(receipt.totalReceived));
          await factoryService.recordAutoEvaluation({
            relationId: row.supplierRelationId,
            kind: 'inspection',
            score,
            sourceType: 'materialReturn',
            sourceId: row.id,
            evaluatedAt: today,
            note: `物料退换货 ${row.returnNumber}（${MATERIAL_RETURN_TYPE_LABELS[row.type] ?? row.type}）：本单拒收 ${Number(receipt.totalRejected)}/${Number(receipt.totalReceived)}`,
            actorId: actorId || 'system',
          });
        } catch (e: any) {
          logger.warn('[MaterialReturn] evaluation failed (non-blocking)', { error: e?.message });
        }
      }

      logger.info('[MaterialReturn] confirmed', { id: row.id, type: row.type, claimInvoiceId: result.claimInvoiceId });
      return { ok: true, data: result };
    } catch (e: any) {
      logger.error('[MaterialReturn] confirm failed', { error: e?.message });
      return fail('CONFIRM_FAILED', e?.message || '供应商确认失败', 500);
    }
  }

  // ── 结算完成（confirmed → settled）──
  async function settleReturn(id: string, actorId?: string): Promise<MaterialReturnResult<any>> {
    try {
      const row = await db.materialReturn.findUnique({ where: { id } });
      if (!row || row.deletedAt) return fail('NOT_FOUND', `退换货单 ${id} 不存在`, 404);
      if (row.status !== 'confirmed') {
        return fail('INVALID_STATUS', `退换货单状态为 ${row.status}，仅 confirmed 可结算完成`, 409);
      }
      const now = Date.now();
      const updated = await db.$transaction(async (tx: any) => {
        const next = await tx.materialReturn.update({ where: { id }, data: { status: 'settled', updatedAt: now } });
        await writeRouteAuditLog({
          prisma: tx, actorId: actorId || 'api', source: 'route:procurement:material-return',
          operation: 'settle_material_return', targetType: 'MaterialReturn', targetId: id,
          before: { status: 'confirmed' }, after: { status: 'settled' }, ip: null,
        });
        return next;
      });
      return { ok: true, data: { materialReturn: updated } };
    } catch (e: any) {
      logger.error('[MaterialReturn] settle failed', { error: e?.message });
      return fail('SETTLE_FAILED', e?.message || '结算完成失败', 500);
    }
  }

  // ── 取消（pending → cancelled）──
  async function cancelReturn(id: string, actorId?: string): Promise<MaterialReturnResult<any>> {
    try {
      const row = await db.materialReturn.findUnique({ where: { id } });
      if (!row || row.deletedAt) return fail('NOT_FOUND', `退换货单 ${id} 不存在`, 404);
      if (row.status !== 'pending') {
        return fail('INVALID_STATUS', `退换货单状态为 ${row.status}，已发运/确认的退换货不可取消（冲销走结算流程）`, 409);
      }
      const now = Date.now();
      const updated = await db.$transaction(async (tx: any) => {
        const next = await tx.materialReturn.update({ where: { id }, data: { status: 'cancelled', updatedAt: now } });
        await writeRouteAuditLog({
          prisma: tx, actorId: actorId || 'api', source: 'route:procurement:material-return',
          operation: 'cancel_material_return', targetType: 'MaterialReturn', targetId: id,
          before: { status: 'pending' }, after: { status: 'cancelled' }, ip: null,
        });
        return next;
      });
      return { ok: true, data: { materialReturn: updated } };
    } catch (e: any) {
      logger.error('[MaterialReturn] cancel failed', { error: e?.message });
      return fail('CANCEL_FAILED', e?.message || '取消失败', 500);
    }
  }

  // ── 列表（采购单/检验单/供应商/状态过滤）──
  async function listReturns(params: {
    purchaseOrderId?: string; receiptId?: string; supplierRelationId?: string; status?: string; limit?: number;
  }): Promise<MaterialReturnResult<{ items: any[] }>> {
    const where: any = { deletedAt: null };
    if (params.purchaseOrderId) where.purchaseOrderId = params.purchaseOrderId;
    if (params.receiptId) where.receiptId = params.receiptId;
    if (params.supplierRelationId) where.supplierRelationId = params.supplierRelationId;
    if (params.status) where.status = params.status;
    const items = await db.materialReturn.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(params.limit ?? 100, 1), 500),
    });
    return { ok: true, data: { items } };
  }

  return { createReturn, markShipped, confirmReturn, settleReturn, cancelReturn, listReturns, remainingQuota };
}
