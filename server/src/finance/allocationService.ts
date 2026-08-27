import { Prisma } from '@prisma/client';
import { syncInvoiceReferences, syncPaymentVoucherReferences } from '../entities/sync';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { notifyShipmentBatchSettlementRecalc } from './shipmentBatchSettlementHook';

/**
 * task ERP-P1-payment-allocation-route-foundation: allocation 状态重算纯函数。
 *
 * Decimal-safe：用 Prisma.Decimal（非 Number()）累加，避免 IEEE 754 漂移。
 * 重算公式：
 *   - Invoice: totalApplied = Σ allocation.appliedAmount WHERE invoiceId
 *     totalApplied >= invoice.amount → 'Paid'
 *     totalApplied > 0              → 'PartiallyPaid'
 *     totalApplied == 0:
 *       当前 status 是 Paid/PartiallyPaid → 回退 'Issued'（核销全撤销）
 *       否则                              → 保持当前 status
 *   - Voucher: totalAllocated = Σ allocation.appliedAmount WHERE voucherId
 *     voucherAmount <= 0           → 'unreconciled'
 *     totalAllocated >= voucherAmount → 'reconciled'
 *     totalAllocated > 0              → 'partially_reconciled'
 *     else                            → 'unreconciled'
 */

export type TxLike = any;

/**
 * 重算单个 invoice 的 status（基于其所有 InvoiceAllocation 汇总）。
 * 返回新 status（totalApplied==0 时若当前 Paid/PartiallyPaid 回退 Issued，否则保持）。
 */
export async function recalcInvoiceStatus(tx: TxLike, invoiceId: string): Promise<string> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, amount: true, status: true },
  });
  if (!invoice) return 'Draft'; // 不存在默认 Draft

  const allocs = await tx.invoiceAllocation.findMany({
    where: { invoiceId },
    select: { appliedAmount: true },
  });

  let total = new Prisma.Decimal(0);
  for (const a of allocs) {
    total = total.plus(a.appliedAmount);
  }
  const invoiceAmount = new Prisma.Decimal(invoice.amount);

  if (invoiceAmount.gt(0) && total.gte(invoiceAmount)) return 'Paid';
  if (total.gt(0)) return 'PartiallyPaid';
  // totalApplied == 0: 若当前是 Paid/PartiallyPaid → 回退 Issued（核销全撤销）
  if (invoice.status === 'Paid' || invoice.status === 'PartiallyPaid') return 'Issued';
  return invoice.status; // Draft/Issued/Cancelled 保持
}

/**
 * 重算单个 voucher 的 status + 汇总 appliedAmount（基于其所有 InvoiceAllocation）。
 * 返回 { status, totalAllocated }——totalAllocated 用汇总值（非单笔）写 PaymentVoucher.appliedAmount。
 */
export async function recalcVoucherStatus(tx: TxLike, voucherId: string): Promise<{ status: string; totalAllocated: Prisma.Decimal }> {
  const voucher = await tx.paymentVoucher.findUnique({
    where: { id: voucherId },
    select: { id: true, amount: true },
  });
  if (!voucher) return { status: 'unreconciled', totalAllocated: new Prisma.Decimal(0) };

  const allocs = await tx.invoiceAllocation.findMany({
    where: { voucherId },
    select: { appliedAmount: true },
  });

  let total = new Prisma.Decimal(0);
  for (const a of allocs) {
    total = total.plus(a.appliedAmount);
  }
  const voucherAmount = new Prisma.Decimal(voucher.amount);

  if (voucherAmount.lte(0)) return { status: 'unreconciled', totalAllocated: total };
  if (total.gte(voucherAmount)) return { status: 'reconciled', totalAllocated: total };
  if (total.gt(0)) return { status: 'partially_reconciled', totalAllocated: total };
  return { status: 'unreconciled', totalAllocated: total };
}

/**
 * 验证 allocation 输入合法性（fail closed 稳定错误码）。
 */
export interface AllocationValidation {
  ok: boolean;
  error?: string;
  message?: string;
}

export function isValidAllocationDecimal(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') {
    if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
    try { return new Prisma.Decimal(v).isFinite(); } catch { return false; }
  }
  return false;
}

export function validateAllocationInput(input: {
  invoiceId?: string;
  voucherId?: string;
  appliedAmount?: any;
}): AllocationValidation {
  const { invoiceId, voucherId, appliedAmount } = input;
  if (!invoiceId) return { ok: false, error: 'MISSING_INVOICE', message: 'invoiceId is required' };
  if (!voucherId) return { ok: false, error: 'MISSING_VOUCHER', message: 'voucherId is required' };
  if (appliedAmount == null) return { ok: false, error: 'MISSING_AMOUNT', message: 'appliedAmount is required' };

  if (!isValidAllocationDecimal(appliedAmount)) return { ok: false, error: 'INVALID_AMOUNT', message: 'appliedAmount must be a valid decimal' };
  try { if (new Prisma.Decimal(appliedAmount).lte(0)) return { ok: false, error: 'INVALID_AMOUNT', message: 'appliedAmount must be positive' }; } catch { return { ok: false, error: 'INVALID_AMOUNT', message: 'appliedAmount must be a valid decimal' }; }

  return { ok: true };
}

/**
 * W4 Agent 工具收尾：核销明细列表只读查询（finance.query_allocations 的 service 真源）。
 *
 * 与 finance/route.ts GET /allocations 同一查询口径（invoiceId/voucherId 过滤 +
 * createdAt desc + take 上限 500）；路由同批改调本函数，保持单一真源不漂移。
 * 只读：不写库、不触发状态重算。
 */
export async function listInvoiceAllocations(
  prisma: { invoiceAllocation: { findMany: (args: any) => Promise<any[]> } },
  params: { invoiceId?: string; voucherId?: string; limit?: number } = {},
): Promise<{ items: any[]; total: number }> {
  const where: any = {};
  if (params.invoiceId) where.invoiceId = params.invoiceId;
  if (params.voucherId) where.voucherId = params.voucherId;
  const items = await prisma.invoiceAllocation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(params.limit ?? 200, 500),
  });
  return { items, total: items.length };
}

/**
 * task 阻断3 fix: allocation-aware EntityLink sync。
 *
 * 基于 InvoiceAllocation 当前 rows 维护 paymentVoucher → invoice 的 settlesInvoice links：
 *   - 当前 allocation 对应的 (voucherId, invoiceId) 对 → upsert active link
 *   - 不在当前 allocation 中但曾存在的 settlesInvoice link → 置 inactive（deletedAt）
 *
 * 这样 split voucher（多张 invoice）/delete allocation 时 EntityLink 与事实源一致。
 */
export async function syncAllocationVoucherLinks(
  tx: TxLike,
  voucherId: string,
  options: { source: string; now?: () => number } = { source: 'manual' },
): Promise<void> {
  if (!voucherId) return;
  const now = options.now?.() ?? Date.now();

  // 当前 allocation rows → 目标 invoice 集合
  const allocs = await tx.invoiceAllocation.findMany({
    where: { voucherId },
    select: { invoiceId: true, appliedAmount: true },
  });
  const activeInvoiceIds = new Set(allocs.map((a: any) => a.invoiceId));

  // upsert active link for each current allocation
  for (const a of allocs) {
    const referenceId = `REF__paymentVoucher__${voucherId}__invoiceId__invoice__${a.invoiceId}`;
    const linkId = `LINK__paymentVoucher__${voucherId}__settlesInvoice__invoice__${a.invoiceId}`;
    const snapshot = { invoiceId: a.invoiceId, fieldKey: 'invoiceId', appliedAmount: new Prisma.Decimal(a.appliedAmount).toString() };

    await tx.entityReference.upsert({
      where: { id: referenceId },
      update: { snapshot, confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: referenceId, ownerType: 'paymentVoucher', ownerId: voucherId, fieldKey: 'invoiceId',
        targetType: 'invoice', targetId: a.invoiceId,
        snapshot, confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    });
    await tx.entityLink.upsert({
      where: { id: linkId },
      update: { confidence: 1, source: options.source, status: 'active', updatedAt: BigInt(now), deletedAt: null },
      create: {
        id: linkId, fromType: 'paymentVoucher', fromId: voucherId,
        toType: 'invoice', toId: a.invoiceId, linkKind: 'settlesInvoice',
        confidence: 1, source: options.source, status: 'active',
        createdAt: BigInt(now), updatedAt: BigInt(now),
      },
    });
  }

  // 停用不再属于当前 allocation 的 settlesInvoice link
  // 查找该 voucher 所有 settlesInvoice link（可能含已 inactive）
  const existingLinks = await tx.entityLink.findMany({
    where: { fromType: 'paymentVoucher', fromId: voucherId, linkKind: 'settlesInvoice' },
    select: { id: true, toId: true, status: true },
  });
  for (const link of existingLinks) {
    if (!activeInvoiceIds.has(link.toId) && link.status === 'active') {
      await tx.entityLink.update({
        where: { id: link.id },
        data: { status: 'inactive', updatedAt: BigInt(now), deletedAt: BigInt(now) },
      });
    }
  }
}

/**
 * task Agent-P1: route + Agent 共用的 allocation mutation service。
 *
 * 封装完整事务闭环：validate + upsert allocation + recalc invoice/voucher status +
 * syncInvoiceReferences + syncPaymentVoucherReferences + syncAllocationVoucherLinks +
 * writeRouteAuditLog。route POST 和 Agent commitPaymentReceiveAndReconcile 都调本函数，
 * 确保 EntityReference/settlesInvoice link/audit 与 route path 一致，不漂移。
 *
 * @param prisma PrismaClient（用于 syncInvoiceReferences/syncPaymentVoucherReferences 读快照）
 * @param tx 已开的事务 client
 * @param params { invoiceId, voucherId, appliedAmount, appliedDate?, actorId, source, auditOperation }
 */
export async function applyAllocation(
  prisma: any,
  tx: any,
  params: {
    invoiceId: string;
    voucherId: string;
    appliedAmount: string | number;
    appliedDate?: string;
    actorId: string;
    source: string;
    auditOperation?: string;
  },
): Promise<{
  allocationId: string;
  newInvoiceStatus: string;
  newVoucherStatus: string;
  voucherAppliedAmount: Prisma.Decimal;
  auditId: string;
}> {
  const { invoiceId, voucherId, actorId, source } = params;
  const appliedAmountDecimal = new Prisma.Decimal(params.appliedAmount);
  const appliedAmountStr = appliedAmountDecimal.toString();
  const appliedDate = params.appliedDate || new Date().toISOString().slice(0, 10);
  const now = BigInt(Date.now());
  const allocId = `ALLOC__${invoiceId}__${voucherId}`;

  // 1. 校验 invoice/voucher 存在（未删）+ 状态 + 币种 + 金额
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, deletedAt: true, status: true, currency: true, amount: true } });
  if (!invoice || invoice.deletedAt) throw Object.assign(new Error(`invoice ${invoiceId} not found or deleted`), { code: 'INVOICE_NOT_FOUND' });
  if (invoice.status === 'Cancelled' || invoice.status === 'Draft') {
    throw Object.assign(new Error(`invoice ${invoiceId} status ${invoice.status} does not allow allocation`), { code: 'INVALID_INVOICE_STATUS', statusCode: 400 });
  }
  const voucher = await tx.paymentVoucher.findUnique({ where: { id: voucherId }, select: { id: true, deletedAt: true, status: true, currency: true, amount: true } });
  if (!voucher || voucher.deletedAt) throw Object.assign(new Error(`voucher ${voucherId} not found or deleted`), { code: 'VOUCHER_NOT_FOUND' });
  if (voucher.status === 'cancelled' || voucher.status === 'void') {
    throw Object.assign(new Error(`voucher ${voucherId} status ${voucher.status} does not allow allocation`), { code: 'INVALID_VOUCHER_STATUS', statusCode: 400 });
  }
  // 币种一致性校验
  if (invoice.currency !== voucher.currency) {
    throw Object.assign(new Error(`currency mismatch: invoice ${invoice.currency} vs voucher ${voucher.currency}`), { code: 'CURRENCY_MISMATCH', statusCode: 400 });
  }
  // 金额不超限校验：核销金额不能超过发票金额、不能超过凭证金额
  const invoiceAmount = new Prisma.Decimal(invoice.amount);
  if (appliedAmountDecimal.gt(invoiceAmount)) {
    throw Object.assign(new Error(`appliedAmount ${appliedAmountStr} exceeds invoice amount ${invoiceAmount.toString()}`), { code: 'AMOUNT_EXCEEDS_INVOICE', statusCode: 400 });
  }
  const voucherAmount = new Prisma.Decimal(voucher.amount);
  if (appliedAmountDecimal.gt(voucherAmount)) {
    throw Object.assign(new Error(`appliedAmount ${appliedAmountStr} exceeds voucher amount ${voucherAmount.toString()}`), { code: 'AMOUNT_EXCEEDS_VOUCHER', statusCode: 400 });
  }
  // 检查发票剩余可核销金额（已有 allocation 汇总）
  const existingAllocs = await tx.invoiceAllocation.findMany({ where: { invoiceId }, select: { appliedAmount: true, voucherId: true } });
  const alreadyAllocated = existingAllocs.filter((a: any) => a.voucherId !== voucherId).reduce((sum: any, a: any) => sum.plus(new Prisma.Decimal(a.appliedAmount)), new Prisma.Decimal(0));
  const remainingInvoice = invoiceAmount.minus(alreadyAllocated);
  if (appliedAmountDecimal.gt(remainingInvoice)) {
    throw Object.assign(new Error(`appliedAmount ${appliedAmountStr} exceeds invoice remaining ${remainingInvoice.toString()}`), { code: 'AMOUNT_EXCEEDS_INVOICE_REMAINING', statusCode: 400 });
  }
  // 检查凭证剩余可分配金额
  const existingVoucherAllocs = await tx.invoiceAllocation.findMany({ where: { voucherId }, select: { appliedAmount: true, invoiceId: true } });
  const alreadyVoucherAllocated = existingVoucherAllocs.filter((a: any) => a.invoiceId !== invoiceId).reduce((sum: any, a: any) => sum.plus(new Prisma.Decimal(a.appliedAmount)), new Prisma.Decimal(0));
  const remainingVoucher = voucherAmount.minus(alreadyVoucherAllocated);
  if (appliedAmountDecimal.gt(remainingVoucher)) {
    throw Object.assign(new Error(`appliedAmount ${appliedAmountStr} exceeds voucher remaining ${remainingVoucher.toString()}`), { code: 'AMOUNT_EXCEEDS_VOUCHER_REMAINING', statusCode: 400 });
  }

  // 2. upsert allocation（Decimal-safe 写入）
  await tx.invoiceAllocation.upsert({
    where: { invoiceId_voucherId: { invoiceId, voucherId } },
    update: { appliedAmount: appliedAmountDecimal, appliedDate, updatedAt: now },
    create: { id: allocId, invoiceId, voucherId, appliedAmount: appliedAmountDecimal, appliedDate, createdAt: now, updatedAt: now },
  });

  // 3. recalc invoice/voucher status（Decimal-safe 纯函数）
  const newInvoiceStatus = await recalcInvoiceStatus(tx, invoiceId);
  // 发票全额结清时自动写入 settlementDate（实际结算日期）
  const invoiceUpdateData: any = { status: newInvoiceStatus, updatedAt: now };
  if (newInvoiceStatus === 'Paid') {
    invoiceUpdateData.settlementDate = new Date().toISOString().slice(0, 10);
  }
  const updatedInvoice = await tx.invoice.update({ where: { id: invoiceId }, data: invoiceUpdateData });
  const voucherRecalc = await recalcVoucherStatus(tx, voucherId);
  const updatedVoucher = await tx.paymentVoucher.update({
    where: { id: voucherId },
    data: { status: voucherRecalc.status, appliedAmount: voucherRecalc.totalAllocated, invoiceId, updatedAt: now },
  });

  // 4. 完整 sync 集（与 route POST 一致）——EntityReference + settlesInvoice link
  await syncInvoiceReferences(prisma, updatedInvoice, { source }, tx);
  await syncPaymentVoucherReferences(prisma, updatedVoucher, { source }, tx);
  await syncAllocationVoucherLinks(tx, voucherId, { source });

  // 5. audit（事务内闭环）——audit 展示金额用 toString，避免 IEEE 754 截断
  const auditId = await writeRouteAuditLog({
    prisma: tx, actorId, source,
    operation: params.auditOperation || 'create_allocation',
    targetType: 'InvoiceAllocation', targetId: allocId,
    after: { id: allocId, invoiceId, voucherId, appliedAmount: appliedAmountStr, invoiceStatus: newInvoiceStatus, voucherStatus: voucherRecalc.status, voucherAppliedAmount: voucherRecalc.totalAllocated.toString() },
  });

  // 6. W-A P0-1：核销创建/替换后触发受影响订单的出运批次结算重算（同事务、失败不阻断，幂等）
  await notifyShipmentBatchSettlementRecalc(tx, { invoiceId, source });

  return {
    allocationId: allocId,
    newInvoiceStatus,
    newVoucherStatus: voucherRecalc.status,
    voucherAppliedAmount: voucherRecalc.totalAllocated,
    auditId,
  };
}
