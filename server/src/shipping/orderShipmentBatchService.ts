/**
 * orderShipmentService.ts — P0-1 订单分批出运与尾款结算（财务侧主档）
 *
 * 设计真源：docs/design/10-评审与决策/2026-08-25-中度与严重缺失功能开发优先级规划.md P0-1
 * schema 真源：schema.prisma model OrderShipmentBatch（含设计决策注释）
 *
 * 职责边界（与 DR-016 ShipmentOrderAllocation 的分工）：
 *   - 物理侧（票视角：一票运了哪些单多少货）由 ShipmentOrderAllocation 承载，本服务只读它；
 *   - 本服务承载财务侧（订单视角）：批次计划登记 → 排船回填 → 结算进度聚合 → 尾款计算与门禁。
 *
 * 状态机（双正交）：
 *   status:       planned → shipped | cancelled（出运维度）
 *   settleStatus: unsettled → partially_settled → settled（财务维度，由 recalcSettlement 派生）
 *
 * 核心规则（fail-closed）：
 *   ① 同订单至多一批 isFinalBatch=true（末批锚点唯一）
 *   ② 已发运批次不可改计划/取消（只能整批冲销走 cancelled 语义，二期再议）
 *   ③ 末批发运门禁：isFinalBatch && status=shipped 前置校验收款进度
 *      （已收 ≥ 阈值比例 × 订单额，阈值默认 100% 减尾款，可按订单覆盖）
 *   ④ invoicedAmount/paidAmount 为聚合快照：从 InvoiceOrderAllocation(batchId)
 *      与 InvoiceAllocation(经 invoice → allocation) 联聚回写，每次结算动作后刷新。
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { logger } from '../lib/logger';

export type OrderShipmentBatchResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } };

const fail = (code: string, message: string, status = 400): OrderShipmentBatchResult<never> =>
  ({ ok: false, error: { code, message, status } });

/** 末批发运收款门禁：默认已收金额须覆盖「订单额 − 末批计划额」（即尾款前的全部款项） */
const FINAL_GATE_COVER_RATIO_DEFAULT = 1;

function generateId(): string {
  return `OSB__${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** Decimal → number（列表/快照序列化） */
function d2n(v: Prisma.Decimal | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/** 从订单 paymentTerms 文本解析账期天数（如 "T/T 30% deposit, 70% against B/L 30 days" → 30；解析失败返回 null） */
export function parseCreditDaysFromPaymentTerms(terms?: string | null): number | null {
  if (!terms) return null;
  const m = terms.match(/(\d+)\s*days?/i);
  if (m) {
    const d = parseInt(m[1], 10);
    if (Number.isFinite(d) && d >= 0 && d <= 365) return d;
  }
  return null;
}

/** YYYY-MM-DD + N 天 → YYYY-MM-DD */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 订单结算金额真源口径：totalNet（成交净额）优先，缺省 quoteAmount（报价额） */
function orderAmountOf(order: { totalNet?: Prisma.Decimal | null; quoteAmount: Prisma.Decimal }): number {
  return order.totalNet != null ? Number(order.totalNet) : Number(order.quoteAmount);
}

/** 日期字符串 → 时间戳（ms；无效返回 null） */
function ymdToTs(ymd?: string | null): number | null {
  if (!ymd) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

export function createOrderShipmentBatchService(prisma: PrismaClient) {
  const db = prisma as any;

  /** 序列化（Decimal → number + 派生字段） */
  function serialize(b: any, order?: any) {
    const amount = d2n(b.amount);
    const paid = d2n(b.paidAmount) ?? 0;
    const invoiced = d2n(b.invoicedAmount) ?? 0;
    return {
      ...b,
      amount,
      plannedRatio: d2n(b.plannedRatio),
      plannedQty: d2n(b.plannedQty),
      invoicedAmount: invoiced,
      paidAmount: paid,
      // 派生：结算进度（分母缺省 0 → null；进度只做展示不做门禁真源）
      settleProgress: amount != null && amount > 0 ? Math.min(1, paid / amount) : null,
      // 派生：尾款余额（批计划额 − 已收；负值钳 0）
      outstandingAmount: amount != null ? Math.max(0, amount - paid) : null,
      // 派生：尾款逾期（末批且到期日已过且未结清）
      finalPaymentOverdue: b.isFinalBatch === true
        && b.finalPaymentDueDate != null
        && b.settleStatus !== 'settled'
        && ymdToTs(b.finalPaymentDueDate) != null
        && (ymdToTs(b.finalPaymentDueDate) as number) < Date.now(),
      orderPoNumber: order?.poNumber ?? null,
      orderCustomer: order?.customer ?? null,
    };
  }

  /** 校验：同订单末批唯一 + 占比总和 ≤ 100%（登记/更新共用，excludeId 为更新时排除自身） */
  async function validateBatchPlan(params: {
    orderId: string;
    excludeId?: string;
    batchNo?: number;
    plannedRatio?: number | null;
    isFinalBatch?: boolean;
    autoAssignFinal?: boolean; // 登记时自动把最大批次设为末批（仅当订单内尚无末批）
  }): Promise<OrderShipmentBatchResult<{ isFinalBatch: boolean }>> {
    const where: any = { orderId: params.orderId, deletedAt: null };
    if (params.excludeId) where.id = { not: params.excludeId };
    const siblings: any[] = await db.orderShipmentBatch.findMany({ where, orderBy: { batchNo: 'asc' } });

    // 占比总和校验（含本次输入）
    const ratios = siblings
      .filter((s: any) => s.plannedRatio != null)
      .map((s: any) => Number(s.plannedRatio));
    if (params.plannedRatio != null) ratios.push(Number(params.plannedRatio));
    if (ratios.length > 0) {
      const sum = ratios.reduce((a: number, b: number) => a + b, 0);
      if (sum > 100 + 1e-9) {
        return fail('RATIO_EXCEEDED', `批次计划占比合计 ${sum.toFixed(2)}% 超过 100%`, 400);
      }
    }

    // 末批唯一性：既有（排除自身）已存在末批时，本次不可再标记末批
    const existingFinal = siblings.find(s => s.isFinalBatch === true);
    let isFinalBatch = params.isFinalBatch === true;
    if (isFinalBatch && existingFinal && existingFinal.id !== params.excludeId) {
      return fail('FINAL_BATCH_DUPLICATE', `订单已存在末批（batchNo ${existingFinal.batchNo}）；同订单至多一批可标记为末批`, 409);
    }
    // 自动末批：登记时无末批且未显式标记 → 本批（首个批次）默认为末批（单批整单出运场景）
    if (params.autoAssignFinal && !existingFinal && params.isFinalBatch === undefined) {
      isFinalBatch = true;
    }
    return { ok: true, data: { isFinalBatch } };
  }

  /** 金额推导：amount 缺省时 = 订单额 × plannedRatio%（两者皆缺 → null 由调用方决定是否放行） */
  function deriveAmount(order: any, plannedRatio?: number | null, amount?: number | null): number | null {
    if (amount != null && Number.isFinite(Number(amount))) return Number(amount);
    if (plannedRatio != null && Number.isFinite(Number(plannedRatio))) {
      return Number((orderAmountOf(order) * Number(plannedRatio) / 100).toFixed(4));
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════
  // 批次登记
  // ════════════════════════════════════════════════════════════════
  async function createBatch(input: {
    orderId: string;
    shipmentId?: string | null;
    plannedRatio?: number | null;
    plannedQty?: number | null;
    unit?: string | null;
    amount?: number | null;
    currency?: string | null;
    isFinalBatch?: boolean;
    finalPaymentDueDays?: number | null;
    notes?: string | null;
  }, actorId?: string): Promise<OrderShipmentBatchResult<any>> {
    try {
      const order = await db.order.findFirst({ where: { id: input.orderId, deletedAt: null } });
      if (!order) return fail('ORDER_NOT_FOUND', `订单 ${input.orderId} 不存在`, 404);

      // 排船回填时 shipment 必须真实存在且未取消
      let shipmentSnapshot: any = null;
      if (input.shipmentId) {
        shipmentSnapshot = await db.shipment.findFirst({ where: { id: input.shipmentId, deletedAt: null } });
        if (!shipmentSnapshot) return fail('SHIPMENT_NOT_FOUND', `出运单 ${input.shipmentId} 不存在`, 404);
        if (shipmentSnapshot.status === 'Cancelled') return fail('SHIPMENT_CANCELLED', `出运单 ${input.shipmentId} 已取消，不可作为批次运单`, 409);
      }

      // batchNo 自动递增（订单内现有最大 + 1）
      const maxNo = await db.orderShipmentBatch.findFirst({
        where: { orderId: input.orderId, deletedAt: null },
        orderBy: { batchNo: 'desc' },
        select: { batchNo: true },
      });
      const batchNo = (maxNo?.batchNo ?? 0) + 1;

      // 计划校验（占比/末批唯一/自动末批）
      const ratio = input.plannedRatio != null && Number.isFinite(Number(input.plannedRatio))
        ? Math.max(0, Math.min(100, Number(input.plannedRatio))) : null;
      const planCheck = await validateBatchPlan({
        orderId: input.orderId,
        plannedRatio: ratio,
        isFinalBatch: input.isFinalBatch,
        autoAssignFinal: true,
      });
      if (!planCheck.ok) return planCheck;

      // 金额推导 + 币种
      const amount = deriveAmount(order, ratio, input.amount);
      if (amount == null && planCheck.data.isFinalBatch === false && ratio == null && input.plannedQty == null) {
        return fail('VALIDATION_FAILED', 'plannedRatio / plannedQty / amount 至少填一项（否则批次无法量化）');
      }
      const currency = (input.currency || order.salesCurrency || order.purchaseCurrency || 'USD') as string;

      const now = BigInt(Date.now());
      const batch = await db.$transaction(async (tx: any) => {
        const created = await tx.orderShipmentBatch.create({
          data: {
            id: generateId(),
            orderId: input.orderId,
            shipmentId: input.shipmentId ?? null,
            batchNo,
            plannedRatio: ratio != null ? new Prisma.Decimal(ratio.toFixed(2)) : null,
            plannedQty: input.plannedQty != null && Number.isFinite(Number(input.plannedQty))
              ? new Prisma.Decimal(Number(input.plannedQty)) : null,
            unit: input.unit ?? null,
            amount: amount != null ? new Prisma.Decimal(amount) : null,
            currency,
            customerRelationId: order.customerRelationId ?? null,
            customerName: order.customer ?? null,
            status: 'planned',
            settleStatus: 'unsettled',
            isFinalBatch: planCheck.data.isFinalBatch,
            finalPaymentDueDays: input.finalPaymentDueDays ?? null,
            finalPaymentDueDate: null,
            notes: input.notes ?? null,
            createdAt: now,
            updatedAt: now,
          },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:order-shipment-batch:create',
          operation: 'create_order_shipment_batch',
          targetType: 'OrderShipmentBatch',
          targetId: created.id,
          after: { id: created.id, orderId: input.orderId, batchNo, isFinalBatch: created.isFinalBatch, amount },
          ip: null,
        });
        return created;
      });
      return { ok: true, data: serialize(batch, order) };
    } catch (e: any) {
      return fail('CREATE_FAILED', `批次登记失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 批次更新（计划期：未发运才可改计划/取消）
  // ════════════════════════════════════════════════════════════════
  async function updateBatch(batchId: string, input: {
    shipmentId?: string | null;
    plannedRatio?: number | null;
    plannedQty?: number | null;
    unit?: string | null;
    amount?: number | null;
    isFinalBatch?: boolean;
    finalPaymentDueDays?: number | null;
    notes?: string | null;
    status?: string; // planned → cancelled（软取消）
  }, actorId?: string): Promise<OrderShipmentBatchResult<any>> {
    try {
      const batch = await db.orderShipmentBatch.findFirst({ where: { id: batchId, deletedAt: null } });
      if (!batch) return fail('BATCH_NOT_FOUND', `批次 ${batchId} 不存在`, 404);

      const order = await db.order.findFirst({ where: { id: batch.orderId, deletedAt: null } });

      // 状态迁移校验
      if (input.status === 'cancelled') {
        if (batch.status === 'shipped') return fail('ALREADY_SHIPPED', '已发运批次不可取消', 409);
        if (batch.status === 'cancelled') return fail('ALREADY_CANCELLED', '批次已是取消状态', 409);
      } else if (input.status && input.status !== batch.status) {
        return fail('INVALID_TRANSITION', `status 仅允许 planned → cancelled（发运/结清由专用动作触发，当前 ${batch.status}）`, 400);
      }

      // 计划字段仅计划期可改（cancelled 后也不可改——留痕冻结）
      const planFrozen = batch.status !== 'planned';
      if (planFrozen && (input.plannedRatio !== undefined || input.plannedQty !== undefined
        || input.amount !== undefined || input.isFinalBatch !== undefined)) {
        return fail('PLAN_FROZEN', `批次已${batch.status === 'shipped' ? '发运' : '取消'}，计划字段冻结不可修改`, 409);
      }

      // 排船回填校验
      let shipmentSnapshot: any = null;
      if (input.shipmentId) {
        shipmentSnapshot = await db.shipment.findFirst({ where: { id: input.shipmentId, deletedAt: null } });
        if (!shipmentSnapshot) return fail('SHIPMENT_NOT_FOUND', `出运单 ${input.shipmentId} 不存在`, 404);
        if (shipmentSnapshot.status === 'Cancelled') return fail('SHIPMENT_CANCELLED', `出运单 ${input.shipmentId} 已取消，不可作为批次运单`, 409);
      }

      // 计划校验（占比/末批唯一）
      const ratio = input.plannedRatio !== undefined
        ? (input.plannedRatio != null && Number.isFinite(Number(input.plannedRatio))
          ? Math.max(0, Math.min(100, Number(input.plannedRatio))) : null)
        : (batch.plannedRatio != null ? Number(batch.plannedRatio) : null);
      const planCheck = await validateBatchPlan({
        orderId: batch.orderId,
        excludeId: batch.id,
        plannedRatio: ratio,
        isFinalBatch: input.isFinalBatch !== undefined ? input.isFinalBatch === true : batch.isFinalBatch === true,
      });
      if (!planCheck.ok) return planCheck;

      // 金额：显式传入优先，否则保持原值，再否则按新 ratio 重推
      let amount: number | null = batch.amount != null ? Number(batch.amount) : null;
      if (input.amount !== undefined) {
        amount = input.amount != null && Number.isFinite(Number(input.amount)) ? Number(input.amount) : null;
      } else if (order && input.plannedRatio !== undefined && input.amount === undefined) {
        amount = deriveAmount(order, ratio, input.amount ?? null) ?? amount;
      }

      const now = BigInt(Date.now());
      const updated = await db.$transaction(async (tx: any) => {
        const row = await tx.orderShipmentBatch.update({
          where: { id: batchId },
          data: {
            ...(input.shipmentId !== undefined ? { shipmentId: input.shipmentId ?? null } : {}),
            ...(input.plannedRatio !== undefined ? { plannedRatio: ratio != null ? new Prisma.Decimal(ratio.toFixed(2)) : null } : {}),
            ...(input.plannedQty !== undefined ? { plannedQty: input.plannedQty != null && Number.isFinite(Number(input.plannedQty)) ? new Prisma.Decimal(Number(input.plannedQty)) : null } : {}),
            ...(input.unit !== undefined ? { unit: input.unit ?? null } : {}),
            ...(amount !== undefined ? { amount: amount != null ? new Prisma.Decimal(amount) : null } : {}),
            ...(input.isFinalBatch !== undefined ? { isFinalBatch: input.isFinalBatch === true } : {}),
            ...(input.finalPaymentDueDays !== undefined ? { finalPaymentDueDays: input.finalPaymentDueDays ?? null } : {}),
            ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
            ...(input.status ? { status: input.status } : {}),
            updatedAt: now,
          },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:order-shipment-batch:update',
          operation: 'update_order_shipment_batch',
          targetType: 'OrderShipmentBatch',
          targetId: batchId,
          before: { id: batchId, status: batch.status, amount: d2n(batch.amount), isFinalBatch: batch.isFinalBatch },
          after: { id: batchId, status: row.status, amount, isFinalBatch: row.isFinalBatch },
          ip: null,
        });
        return row;
      });
      return { ok: true, data: serialize(updated, order) };
    } catch (e: any) {
      return fail('UPDATE_FAILED', `批次更新失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 结算进度聚合（invoiced/paid 快照回写 + settleStatus 派生）
  // ════════════════════════════════════════════════════════════════
  /**
   * 批次已开票金额：InvoiceOrderAllocation.batchId = 批次 且 allocation 未软删 且发票未作废。
   * 同发票同订单的分配行唯一（@@unique），allocatedAmount 缺省视为整单金额（取 invoice.amount）。
   */
  async function recalcSettlement(batchId: string, tx?: any): Promise<OrderShipmentBatchResult<any>> {
    const runner = tx ?? db;
    const batch = await runner.orderShipmentBatch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) return fail('BATCH_NOT_FOUND', `批次 ${batchId} 不存在`, 404);

    // 已开票：发票分配（batchId 归属）
    const allocations = await runner.invoiceOrderAllocation.findMany({
      where: { batchId, deletedAt: null },
    });
    const invoiceIds = [...new Set(allocations.map((a: any) => a.invoiceId))];
    const invoices = invoiceIds.length > 0
      ? await runner.invoice.findMany({ where: { id: { in: invoiceIds }, deletedAt: null } })
      : [];
    const invoiceMap = new Map<string, any>(invoices.map((inv: any) => [inv.id, inv]));
    let invoiced = 0;
    for (const a of allocations as any[]) {
      const inv = invoiceMap.get(a.invoiceId) as any;
      if (!inv || inv.status === 'Cancelled') continue;
      invoiced += a.allocatedAmount != null ? Number(a.allocatedAmount) : Number(inv.amount);
    }

    // 已收款：上述发票经 InvoiceAllocation 核销（allocation 已核销金额 = 核销时点发票已收全额，取 settledAmount 口径）
    // 注意：InvoiceAllocation 为硬删除模型（@@unique + delete+insert 语义，schema/migrations 均无 deletedAt 列），
    // 过滤 deletedAt 会触发 PrismaClientValidationError —— 此处不做软删过滤。
    let paid = 0;
    if (invoiceIds.length > 0) {
      const invoiceAllocs = await runner.invoiceAllocation.findMany({
        where: { invoiceId: { in: invoiceIds } },
      });
      // InvoiceAllocation 行 = 凭证×发票核销记录；已核销金额按行汇总即该发票累计已收
      // 注意：核销金额字段为 appliedAmount（InvoiceAllocation 模型唯一金额字段，schema 真源）
      for (const ia of invoiceAllocs as any[]) {
        const inv = invoiceMap.get(ia.invoiceId) as any;
        if (!inv || inv.status === 'Cancelled') continue;
        paid += ia.appliedAmount != null ? Number(ia.appliedAmount) : 0;
      }
    }

    // settleStatus 派生（分母缺省 → 无法判定时维持原状态）
    const amount = batch.amount != null ? Number(batch.amount) : null;
    let settleStatus = batch.settleStatus as string;
    let settledAt = batch.settledAt;
    if (amount != null && amount > 0) {
      const eps = 1e-6;
      if (paid >= amount - eps) {
        settleStatus = 'settled';
        settledAt = settledAt ?? BigInt(Date.now());
      } else if (paid > eps) {
        settleStatus = 'partially_settled';
        settledAt = null;
      } else {
        settleStatus = 'unsettled';
        settledAt = null;
      }
    }

    const now = BigInt(Date.now());
    const updated = await runner.orderShipmentBatch.update({
      where: { id: batchId },
      data: {
        invoicedAmount: new Prisma.Decimal(invoiced.toFixed(4)),
        paidAmount: new Prisma.Decimal(paid.toFixed(4)),
        settleStatus,
        settledAt,
        updatedAt: now,
      },
    });
    const order = batch.orderId ? await runner.order.findFirst({ where: { id: batch.orderId, deletedAt: null } }) : null;
    return { ok: true, data: serialize(updated, order) };
  }

  /** 触发点：某订单的全部批次重算（发票分配/核销变动后调用） */
  async function recalcOrderSettlement(orderId: string, tx?: any): Promise<OrderShipmentBatchResult<any[]>> {
    const runner = tx ?? db;
    const batches = await runner.orderShipmentBatch.findMany({ where: { orderId, deletedAt: null } });
    const results = [];
    for (const b of batches) {
      const r = await recalcSettlement(b.id, runner);
      if (r.ok) results.push(r.data);
    }
    return { ok: true, data: results };
  }

  // ════════════════════════════════════════════════════════════════
  // 批次发运确认（排船回填 + 尾款到期日计算 + 末批收款门禁）
  // ════════════════════════════════════════════════════════════════
  async function markShipped(batchId: string, input?: {
    shipmentId?: string; // 可在发运确认时才排船
    shippedAt?: number; // 缺省取运单 atd/当日
    gateCoverRatio?: number; // 末批门禁覆盖率覆盖（1 = 全覆盖尾款前款项；<1 放宽）
    skipGate?: boolean; // 管理员豁免（留痕）
    autoLinkage?: boolean; // Shipment→Shipped 自动联动标记（留痕，区别于人工操作/管理员豁免）
  }, actorId?: string): Promise<OrderShipmentBatchResult<any>> {
    try {
      const batch = await db.orderShipmentBatch.findFirst({ where: { id: batchId, deletedAt: null } });
      if (!batch) return fail('BATCH_NOT_FOUND', `批次 ${batchId} 不存在`, 404);
      if (batch.status === 'shipped') return fail('ALREADY_SHIPPED', '批次已发运', 409);
      if (batch.status === 'cancelled') return fail('ALREADY_CANCELLED', '批次已取消，不可发运', 409);

      const order = await db.order.findFirst({ where: { id: batch.orderId, deletedAt: null } });
      if (!order) return fail('ORDER_NOT_FOUND', `订单 ${batch.orderId} 不存在`, 404);

      // 运单：传入优先，其次已回填
      const shipId = input?.shipmentId ?? batch.shipmentId;
      if (!shipId) return fail('SHIPMENT_REQUIRED', '批次尚未关联出运单（shipmentId），不能确认发运');
      const shipment = await db.shipment.findFirst({ where: { id: shipId, deletedAt: null } });
      if (!shipment) return fail('SHIPMENT_NOT_FOUND', `出运单 ${shipId} 不存在`, 404);
      if (shipment.status === 'Cancelled') return fail('SHIPMENT_CANCELLED', `出运单 ${shipId} 已取消`, 409);

      // 先刷新结算快照（门禁用最新已收金额）
      await recalcSettlement(batchId);

      // ── 末批发运收款门禁（fail-closed；skipGate 豁免留痕） ──
      if (batch.isFinalBatch === true && !input?.skipGate) {
        const orderAmt = orderAmountOf(order);
        const batchAmt = batch.amount != null ? Number(batch.amount) : 0;
        // 门禁线 = 覆盖率 × （订单额 − 末批额）：即末批之前款项须已收足
        const coverRatio = input?.gateCoverRatio != null ? Number(input.gateCoverRatio) : FINAL_GATE_COVER_RATIO_DEFAULT;
        const required = Math.max(0, orderAmt - batchAmt) * coverRatio;
        const paidAll = await totalPaidOfOrder(batch.orderId);
        if (paidAll + 1e-6 < required) {
          return fail('FINAL_PAYMENT_GATE_BLOCKED',
            `末批发运门禁：订单累计已收 ${paidAll.toFixed(2)} ${batch.currency}，须 ≥ ${required.toFixed(2)} ${batch.currency}（订单额 ${orderAmt.toFixed(2)} − 末批 ${batchAmt.toFixed(2)}）× 覆盖率 ${coverRatio}；可收款后重试或管理员豁免（skipGate 留痕）`,
            409);
        }
      }

      // 尾款到期日：末批 → 发运日 + 账期（本批覆盖值 > 订单 paymentTerms 解析）
      const shippedAt = input?.shippedAt != null ? BigInt(input.shippedAt)
        : (shipment.atd ? BigInt(ymdToTs(shipment.atd) ?? Date.now()) : BigInt(Date.now()));
      let finalPaymentDueDate: string | null = batch.finalPaymentDueDate;
      if (batch.isFinalBatch === true) {
        const creditDays = batch.finalPaymentDueDays != null
          ? Number(batch.finalPaymentDueDays)
          : parseCreditDaysFromPaymentTerms(order.paymentTerms);
        if (creditDays != null) {
          finalPaymentDueDate = addDays(new Date(Number(shippedAt)).toISOString().slice(0, 10), creditDays);
        }
      }

      const now = BigInt(Date.now());
      const updated = await db.$transaction(async (tx: any) => {
        const row = await tx.orderShipmentBatch.update({
          where: { id: batchId },
          data: {
            shipmentId: shipId,
            status: 'shipped',
            shippedAt,
            finalPaymentDueDate,
            updatedAt: now,
          },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:order-shipment-batch:mark-shipped',
          operation: 'mark_batch_shipped',
          targetType: 'OrderShipmentBatch',
          targetId: batchId,
          before: { id: batchId, status: batch.status },
          after: { id: batchId, status: 'shipped', shipmentId: shipId, finalPaymentDueDate, skipGate: input?.skipGate === true, autoLinkage: input?.autoLinkage === true },
          ip: null,
        });
        return row;
      });
      return { ok: true, data: serialize(updated, order) };
    } catch (e: any) {
      return fail('SHIP_FAILED', `批次发运确认失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /** 订单累计已收（USD 口径随各发票币种直接加总——同订单同币种为常态；跨币种门禁由上层换算后覆盖 coverRatio） */
  async function totalPaidOfOrder(orderId: string): Promise<number> {
    const allocations = await db.invoiceOrderAllocation.findMany({
      where: { orderId, deletedAt: null },
      select: { invoiceId: true },
    });
    const invoiceIds = [...new Set(allocations.map((a: any) => a.invoiceId))];
    if (invoiceIds.length === 0) return 0;
    // InvoiceAllocation 为硬删除模型（无 deletedAt 列），不做软删过滤（同 recalcSettlement）
    const invoiceAllocs = await db.invoiceAllocation.findMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    return invoiceAllocs.reduce((sum: number, ia: any) => sum + (ia.appliedAmount != null ? Number(ia.appliedAmount) : 0), 0);
  }

  // ════════════════════════════════════════════════════════════════
  // 尾款看板（watchdog 扫描源 + 前端列表）
  // ════════════════════════════════════════════════════════════════
  /** 到期未结清末批列表（dueDate < today 且 settleStatus ≠ settled） */
  async function listOverdueFinalBatches(limit = 100): Promise<OrderShipmentBatchResult<any[]>> {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db.orderShipmentBatch.findMany({
      where: {
        deletedAt: null,
        isFinalBatch: true,
        status: 'shipped',
        settleStatus: { not: 'settled' },
        finalPaymentDueDate: { lt: today },
      },
      orderBy: { finalPaymentDueDate: 'asc' },
      take: Math.min(Math.max(1, limit), 500),
    });
    // 附订单摘要
    const orderIds = [...new Set(rows.map((r: any) => r.orderId))];
    const orders = orderIds.length > 0 ? await db.order.findMany({ where: { id: { in: orderIds } } }) : [];
    const orderMap = new Map(orders.map((o: any) => [o.id, o]));
    return { ok: true, data: rows.map((r: any) => serialize(r, orderMap.get(r.orderId))) };
  }

  /** 订单批次全景（含计划汇总 + 出运/结算进度） */
  async function listByOrder(orderId: string): Promise<OrderShipmentBatchResult<any>> {
    const order = await db.order.findFirst({ where: { id: orderId, deletedAt: null } });
    if (!order) return fail('ORDER_NOT_FOUND', `订单 ${orderId} 不存在`, 404);
    const batches = await db.orderShipmentBatch.findMany({
      where: { orderId, deletedAt: null },
      orderBy: { batchNo: 'asc' },
    });
    const shippedQty = batches.filter((b: any) => b.status === 'shipped').length;
    const serialized = batches.map((b: any) => serialize(b, order));
    return {
      ok: true,
      data: {
        order: { id: order.id, poNumber: order.poNumber, customer: order.customer, currency: order.salesCurrency ?? order.purchaseCurrency },
        orderAmount: orderAmountOf(order),
        batches: serialized,
        summary: {
          totalBatches: batches.length,
          shippedBatches: shippedQty,
          allShipped: batches.length > 0 && shippedQty === batches.length,
          totalPlannedAmount: serialized.reduce((s: number, b: any) => s + (b.amount ?? 0), 0),
          totalInvoiced: serialized.reduce((s: number, b: any) => s + (b.invoicedAmount ?? 0), 0),
          totalPaid: serialized.reduce((s: number, b: any) => s + (b.paidAmount ?? 0), 0),
        },
      },
    };
  }

  // ════════════════════════════════════════════════════════════════
  // W-B 断层④拍板：Shipment→Shipped 自动推进挂接批次（双状态机挂钩）
  //   物理事实优先：运单既已发运，显式挂接（shipmentId=该运单）的 planned 批次
  //   必须同步 shipped——否则催款分级/对账读批次状态永远滞后（货发了款没催）。
  //   - 幂等：仅扫 status='planned'；shipped/cancelled 天然跳过（终态不复活）
  //   - 尾款门禁语义：末批收款门禁的保护点在「发运前」（人工 mark-shipped / 出运放行门禁）；
  //     物理发运既成事实后不再阻断状态同步，缺口以 skipGate+autoLinkage 留痕，
  //     由催款 watchdog（listOverdueFinalBatches）兜底追款
  //   - best-effort：单批失败记录并继续，整体永不 throw（不阻断运单主业务）
  //   - 归属判定：只推进显式挂接批次；未排船批次（shipmentId=null）保持 planned，
  //     走人工 mark-shipped（一票多批次的归属歧义不猜）
  // ════════════════════════════════════════════════════════════════
  async function autoAdvanceOnShipmentShipped(
    shipmentId: string,
    actorId?: string,
  ): Promise<{ advanced: string[]; failed: Array<{ batchId: string; code: string }> }> {
    const advanced: string[] = [];
    const failed: Array<{ batchId: string; code: string }> = [];
    try {
      const candidates = await db.orderShipmentBatch.findMany({
        where: { shipmentId, status: 'planned', deletedAt: null },
        select: { id: true },
      });
      for (const b of candidates) {
        const r = await markShipped(b.id, { shipmentId, skipGate: true, autoLinkage: true }, actorId ?? 'system');
        if (r.ok) advanced.push(b.id);
        else {
          failed.push({ batchId: b.id, code: r.error.code });
          logger.warn('[OrderShipmentBatch] Shipment→Shipped 自动联动单批失败（不阻断）', { shipmentId, batchId: b.id, code: r.error.code, message: r.error.message });
        }
      }
      if (advanced.length > 0) {
        logger.info('[OrderShipmentBatch] Shipment→Shipped 自动联动推进批次', { shipmentId, advanced });
      }
    } catch (e: any) {
      logger.warn('[OrderShipmentBatch] Shipment→Shipped 自动联动异常（不阻断）', { shipmentId, error: e?.message });
    }
    return { advanced, failed };
  }

  return {
    createBatch,
    updateBatch,
    markShipped,
    autoAdvanceOnShipmentShipped,
    recalcSettlement,
    recalcOrderSettlement,
    totalPaidOfOrder,
    listByOrder,
    listOverdueFinalBatches,
  };
}
