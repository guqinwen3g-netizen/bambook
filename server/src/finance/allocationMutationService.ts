import { Prisma, PrismaClient } from '@prisma/client';
import { syncInvoiceReferences, syncPaymentVoucherReferences } from '../entities/sync';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { recalcInvoiceStatus, recalcVoucherStatus, validateAllocationInput, syncAllocationVoucherLinks, applyAllocation, isValidAllocationDecimal } from './allocationService';

export type AllocationMutationErrorCode =
  | 'MISSING_INVOICE' | 'MISSING_VOUCHER' | 'MISSING_AMOUNT' | 'INVALID_AMOUNT'
  | 'INVOICE_NOT_FOUND' | 'VOUCHER_NOT_FOUND' | 'NOT_FOUND'
  | 'CONFLICT' // 并发核销冲突（Serializable 隔离中止，P2034）——route 映射 409，可安全重试
  | 'CREATE_FAILED' | 'UPDATE_FAILED' | 'DELETE_FAILED';
export interface AllocationMutationError { code: AllocationMutationErrorCode; message: string; }
export interface AllocationMutationResult<T = any> { ok: boolean; data?: T; error?: AllocationMutationError; }

function toAllocationError(e: any, fallback: AllocationMutationErrorCode): AllocationMutationError {
  if (e?.code === 'P2034') return { code: 'CONFLICT', message: `concurrent allocation conflict, safely rolled back — retry the operation (${String(e?.message ?? e)})` };
  if (e?.code && ['MISSING_INVOICE','MISSING_VOUCHER','MISSING_AMOUNT','INVALID_AMOUNT','INVOICE_NOT_FOUND','VOUCHER_NOT_FOUND','NOT_FOUND'].includes(e.code)) return { code: e.code, message: String(e.message ?? e) };
  return { code: fallback, message: String(e?.message ?? e) };
}

// Phase 2 · 2.2 并发根因修复：allocation check-then-act 必须 Serializable，
// 否则 READ COMMITTED 下两事务并发核销同一发票可双双通过剩余校验 → 超核销。
// SSI 中止其中一方（P2034 → CONFLICT/409），调用方重试即可。
const SERIALIZABLE_TX = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

export interface CreateAllocationData {
  allocation: { id: string; invoiceId: string; voucherId: string; appliedAmount: string; appliedDate: string };
  newInvoiceStatus: string; newVoucherStatus: string; voucherAppliedAmount: string; auditId: string;
}

export async function createAllocation(params: {
  prisma: PrismaClient; input: { invoiceId?: string; voucherId?: string; appliedAmount?: any; appliedDate?: string };
  actorId?: string; ip?: string | null;
}): Promise<AllocationMutationResult<CreateAllocationData>> {
  const { prisma, input, actorId, ip } = params;
  const v = validateAllocationInput(input);
  if (!v.ok) return { ok: false, error: { code: v.error! as AllocationMutationErrorCode, message: v.message! } };
  const invId = input.invoiceId as string; const vocId = input.voucherId as string;
  const appliedDate = input.appliedDate || new Date().toISOString().slice(0, 10);
  try {
    const data = await (prisma as any).$transaction(async (tx: any) => {
      const r = await applyAllocation(prisma, tx, {
        invoiceId: invId, voucherId: vocId, appliedAmount: String(input.appliedAmount), appliedDate,
        actorId: actorId || 'api', source: 'route:allocation:create', auditOperation: 'create_allocation',
      });
      return {
        allocation: { id: r.allocationId, invoiceId: invId, voucherId: vocId, appliedAmount: String(input.appliedAmount), appliedDate },
        newInvoiceStatus: r.newInvoiceStatus, newVoucherStatus: r.newVoucherStatus,
        voucherAppliedAmount: r.voucherAppliedAmount.toString(), auditId: r.auditId,
      };
    }, SERIALIZABLE_TX);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: toAllocationError(e, 'CREATE_FAILED') };
  }
}

export interface UpdateAllocationData {
  allocation: { id: string; appliedAmount: string; appliedDate: string };
  newInvoiceStatus: string; newVoucherStatus: string; voucherAppliedAmount: string; auditId: string;
}

export async function updateAllocation(params: {
  prisma: PrismaClient; allocationId: string; input: { appliedAmount?: any; appliedDate?: string };
  actorId?: string; ip?: string | null;
}): Promise<AllocationMutationResult<UpdateAllocationData>> {
  const { prisma, allocationId, input, actorId, ip } = params;
  if (input.appliedAmount != null) {
    if (!isValidAllocationDecimal(input.appliedAmount)) return { ok: false, error: { code: 'INVALID_AMOUNT', message: 'appliedAmount must be a valid decimal' } };
    try { if (new Prisma.Decimal(input.appliedAmount).lte(0)) return { ok: false, error: { code: 'INVALID_AMOUNT', message: 'appliedAmount must be positive' } }; } catch { return { ok: false, error: { code: 'INVALID_AMOUNT', message: 'appliedAmount must be a valid decimal' } }; }
  }
  try {
    const data = await (prisma as any).$transaction(async (tx: any) => {
      const now = BigInt(Date.now());
      const existing = await tx.invoiceAllocation.findUnique({ where: { id: allocationId } });
      if (!existing) throw Object.assign(new Error('allocation not found'), { code: 'NOT_FOUND' });
      const updateData: any = { updatedAt: now };
      if (input.appliedAmount != null) updateData.appliedAmount = new Prisma.Decimal(input.appliedAmount);
      if (input.appliedDate != null) updateData.appliedDate = input.appliedDate;
      const updated = await tx.invoiceAllocation.update({ where: { id: allocationId }, data: updateData });
      const newInvoiceStatus = await recalcInvoiceStatus(tx, existing.invoiceId);
      const updatedInvoice = await tx.invoice.update({ where: { id: existing.invoiceId }, data: { status: newInvoiceStatus, updatedAt: now } });
      const voucherRecalc = await recalcVoucherStatus(tx, existing.voucherId);
      const updatedVoucher = await tx.paymentVoucher.update({ where: { id: existing.voucherId }, data: { status: voucherRecalc.status, appliedAmount: voucherRecalc.totalAllocated, updatedAt: now } });
      await syncInvoiceReferences(prisma, updatedInvoice, { source: 'allocation.update' }, tx);
      await syncPaymentVoucherReferences(prisma, updatedVoucher, { source: 'allocation.update' }, tx);
      await syncAllocationVoucherLinks(tx, existing.voucherId, { source: 'allocation.update' });
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:allocation:update',
        operation: 'update_allocation', targetType: 'InvoiceAllocation', targetId: allocationId,
        before: { appliedAmount: new Prisma.Decimal(existing.appliedAmount).toString() },
        after: { appliedAmount: new Prisma.Decimal(updated.appliedAmount).toString(), invoiceStatus: newInvoiceStatus, voucherStatus: voucherRecalc.status, voucherAppliedAmount: voucherRecalc.totalAllocated.toString() },
        ip: ip || null,
      });
      return { allocation: { id: allocationId, appliedAmount: new Prisma.Decimal(updated.appliedAmount).toString(), appliedDate: updated.appliedDate }, newInvoiceStatus, newVoucherStatus: voucherRecalc.status, voucherAppliedAmount: voucherRecalc.totalAllocated.toString(), auditId };
    }, SERIALIZABLE_TX);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: toAllocationError(e, 'UPDATE_FAILED') };
  }
}

export interface DeleteAllocationData {
  deleted: boolean; id: string; newInvoiceStatus: string; newVoucherStatus: string; voucherAppliedAmount: string; auditId: string;
}

export async function deleteAllocation(params: {
  prisma: PrismaClient; allocationId: string; actorId?: string; ip?: string | null;
}): Promise<AllocationMutationResult<DeleteAllocationData>> {
  const { prisma, allocationId, actorId, ip } = params;
  try {
    const data = await (prisma as any).$transaction(async (tx: any) => {
      const now = BigInt(Date.now());
      const existing = await tx.invoiceAllocation.findUnique({ where: { id: allocationId } });
      if (!existing) throw Object.assign(new Error('allocation not found'), { code: 'NOT_FOUND' });
      await tx.invoiceAllocation.delete({ where: { id: allocationId } });
      const newInvoiceStatus = await recalcInvoiceStatus(tx, existing.invoiceId);
      const updatedInvoice = await tx.invoice.update({ where: { id: existing.invoiceId }, data: { status: newInvoiceStatus, updatedAt: now } });
      const voucherRecalc = await recalcVoucherStatus(tx, existing.voucherId);
      const updatedVoucher = await tx.paymentVoucher.update({ where: { id: existing.voucherId }, data: { status: voucherRecalc.status, appliedAmount: voucherRecalc.totalAllocated, updatedAt: now } });
      await syncInvoiceReferences(prisma, updatedInvoice, { source: 'allocation.delete' }, tx);
      await syncPaymentVoucherReferences(prisma, updatedVoucher, { source: 'allocation.delete' }, tx);
      await syncAllocationVoucherLinks(tx, existing.voucherId, { source: 'allocation.delete' });
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:allocation:delete',
        operation: 'delete_allocation', targetType: 'InvoiceAllocation', targetId: allocationId,
        before: { id: allocationId, invoiceId: existing.invoiceId, voucherId: existing.voucherId, appliedAmount: new Prisma.Decimal(existing.appliedAmount).toString() },
        after: { invoiceStatus: newInvoiceStatus, voucherStatus: voucherRecalc.status, voucherAppliedAmount: voucherRecalc.totalAllocated.toString() },
        ip: ip || null,
      });
      return { deleted: true as const, id: allocationId, newInvoiceStatus, newVoucherStatus: voucherRecalc.status, voucherAppliedAmount: voucherRecalc.totalAllocated.toString(), auditId };
    }, SERIALIZABLE_TX);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: toAllocationError(e, 'DELETE_FAILED') };
  }
}
