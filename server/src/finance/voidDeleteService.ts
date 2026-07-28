/**
 * ERP-P1-finance-void-delete-route-foundation
 *
 * Invoice 作废/cancel + Invoice/PaymentVoucher 软删 service（route + Agent flow 共用契约）。
 * 业务写入 + EntityLink inactive + AuditLog 同事务闭环，失败 fail closed。
 * 删除 invoice/voucher 如存在 InvoiceAllocation → 409 HAS_ALLOCATIONS，不留下孤儿核销。
 */

import { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { deactivateEntityLinks } from '../entities/sync';

export type FinanceVoidDeleteErrorCode =
  | 'INVOICE_NOT_FOUND'
  | 'VOUCHER_NOT_FOUND'
  | 'INVALID_STATUS'
  | 'HAS_ALLOCATIONS'
  | 'CANCEL_FAILED'
  | 'DELETE_FAILED';

export interface FinanceVoidDeleteError {
  code: FinanceVoidDeleteErrorCode;
  message: string;
}

export interface CancelInvoiceParams {
  prisma: PrismaClient;
  invoiceId: string;
  actorId?: string;
  reason?: string;
}

export interface CancelInvoiceResult {
  ok: boolean;
  error?: FinanceVoidDeleteError;
  data?: { invoice: any; auditId: string };
}

const VALID_CANCEL_FROM = new Set(['Draft', 'Issued', 'PartiallyPaid', 'Paid']);

/**
 * Invoice 作废（status→Cancelled）。校验状态转移合法性。
 * 同事务：update status + deactivate EntityLinks + AuditLog。
 */
export async function cancelInvoice(params: CancelInvoiceParams): Promise<CancelInvoiceResult> {
  const { prisma, invoiceId, actorId, reason } = params;
  const now = BigInt(Date.now());

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error(`Invoice ${invoiceId} not found`), { code: 'INVOICE_NOT_FOUND', statusCode: 404 });
      }
      if (existing.status === undefined) {
        throw Object.assign(new Error(`Invoice ${invoiceId} status undefined`), { code: 'INVALID_STATUS', statusCode: 400 });
      }
      if (existing.status === 'Cancelled') {
        throw Object.assign(new Error(`Invoice ${invoiceId} already cancelled`), { code: 'INVALID_STATUS', statusCode: 400 });
      }
      if (!VALID_CANCEL_FROM.has(existing.status)) {
        throw Object.assign(new Error(`Cannot cancel invoice with status=${existing.status}`), { code: 'INVALID_STATUS', statusCode: 400 });
      }

      // 检查是否有核销记录：有核销的发票不能直接作废，必须先撤销核销
      const allocCount = await tx.invoiceAllocation.count({ where: { invoiceId } });
      if (allocCount > 0) {
        throw Object.assign(new Error(`Cannot cancel invoice with ${allocCount} allocation(s); remove allocations first`), { code: 'HAS_ALLOCATIONS', statusCode: 400 });
      }

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'Cancelled', updatedAt: now },
      });

      // EntityLink inactive（deactivate 该 invoice 发出的所有 active link）
      await deactivateEntityLinks(tx, 'invoice', invoiceId, now);

      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:finance:cancel',
        operation: 'cancel_invoice', targetType: 'Invoice', targetId: invoiceId,
        before: { status: existing.status },
        after: { status: 'Cancelled', reason: reason || null },
      });

      // 纯化 BigInt 字段（避免 JSON 序列化失败）
      const safeInvoice = { ...updated, createdAt: Number(updated.createdAt), updatedAt: Number(updated.updatedAt), deletedAt: updated.deletedAt ? Number(updated.deletedAt) : null };
      return { invoice: safeInvoice, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'CANCEL_FAILED', message: `Cancel transaction failed: ${String(e?.message ?? e)}` } };
  }
}

export interface DeleteInvoiceParams {
  prisma: PrismaClient;
  invoiceId: string;
  actorId?: string;
}

export interface DeleteInvoiceResult {
  ok: boolean;
  error?: FinanceVoidDeleteError;
  data?: { auditId: string };
}

/**
 * Invoice 软删（deletedAt）。如存在 InvoiceAllocation → 409 HAS_ALLOCATIONS。
 * 同事务：check allocations + update deletedAt + deactivate EntityLinks + AuditLog。
 */
export async function deleteInvoice(params: DeleteInvoiceParams): Promise<DeleteInvoiceResult> {
  const { prisma, invoiceId, actorId } = params;
  const now = BigInt(Date.now());

  try {
    const auditId = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error(`Invoice ${invoiceId} not found`), { code: 'INVOICE_NOT_FOUND', statusCode: 404 });
      }

      // allocation 阻断（不留下孤儿核销）
      const allocCount = await tx.invoiceAllocation.count({ where: { invoiceId } });
      if (allocCount > 0) {
        throw Object.assign(new Error(`Invoice ${invoiceId} has ${allocCount} allocations, cannot delete`), { code: 'HAS_ALLOCATIONS', statusCode: 409 });
      }

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { deletedAt: now, updatedAt: now },
      });

      // EntityLink inactive
      await deactivateEntityLinks(tx, 'invoice', invoiceId, now);

      return await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:finance:delete',
        operation: 'delete_invoice', targetType: 'Invoice', targetId: invoiceId,
        before: { deletedAt: null },
        after: { deletedAt: Number(now) },
      });
    });
    return { ok: true, data: { auditId } };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'DELETE_FAILED', message: `Delete transaction failed: ${String(e?.message ?? e)}` } };
  }
}

export interface DeleteVoucherParams {
  prisma: PrismaClient;
  voucherId: string;
  actorId?: string;
}

export interface DeleteVoucherResult {
  ok: boolean;
  error?: FinanceVoidDeleteError;
  data?: { auditId: string };
}

/**
 * PaymentVoucher 软删（deletedAt）。如存在 InvoiceAllocation → 409 HAS_ALLOCATIONS。
 */
export async function deleteVoucher(params: DeleteVoucherParams): Promise<DeleteVoucherResult> {
  const { prisma, voucherId, actorId } = params;
  const now = BigInt(Date.now());

  try {
    const auditId = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.paymentVoucher.findUnique({ where: { id: voucherId } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error(`Voucher ${voucherId} not found`), { code: 'VOUCHER_NOT_FOUND', statusCode: 404 });
      }

      // allocation 阻断
      const allocCount = await tx.invoiceAllocation.count({ where: { voucherId } });
      if (allocCount > 0) {
        throw Object.assign(new Error(`Voucher ${voucherId} has ${allocCount} allocations, cannot delete`), { code: 'HAS_ALLOCATIONS', statusCode: 409 });
      }

      await tx.paymentVoucher.update({
        where: { id: voucherId },
        data: { deletedAt: now, updatedAt: now },
      });

      // EntityLink inactive
      await deactivateEntityLinks(tx, 'paymentVoucher', voucherId, now);

      return await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:finance:delete_voucher',
        operation: 'delete_voucher', targetType: 'PaymentVoucher', targetId: voucherId,
        before: { deletedAt: null },
        after: { deletedAt: Number(now) },
      });
    });
    return { ok: true, data: { auditId } };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'DELETE_FAILED', message: `Delete voucher transaction failed: ${String(e?.message ?? e)}` } };
  }
}

export interface CancelVoucherParams {
  prisma: PrismaClient;
  voucherId: string;
  actorId?: string;
  reason?: string;
}

export interface CancelVoucherResult {
  ok: boolean;
  error?: FinanceVoidDeleteError;
  data?: { voucher: any; auditId: string };
}

/**
 * PaymentVoucher 作废（status → cancelled）。校验状态 + allocation 检查。
 * 同事务：check allocations + update status + deactivate EntityLinks + AuditLog。
 */
export async function cancelVoucher(params: CancelVoucherParams): Promise<CancelVoucherResult> {
  const { prisma, voucherId, actorId, reason } = params;
  const now = BigInt(Date.now());

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.paymentVoucher.findUnique({ where: { id: voucherId } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error(`Voucher ${voucherId} not found`), { code: 'VOUCHER_NOT_FOUND', statusCode: 404 });
      }

      // 已有核销记录的凭证不可作废，必须先撤销核销
      const allocCount = await tx.invoiceAllocation.count({ where: { voucherId } });
      if (allocCount > 0) {
        throw Object.assign(new Error(`Cannot cancel voucher with ${allocCount} allocation(s); remove allocations first`), { code: 'HAS_ALLOCATIONS', statusCode: 400 });
      }

      const updated = await tx.paymentVoucher.update({
        where: { id: voucherId },
        data: { status: 'cancelled', updatedAt: now },
      });

      await deactivateEntityLinks(tx, 'paymentVoucher', voucherId, now);

      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:finance:cancel_voucher',
        operation: 'cancel_voucher', targetType: 'PaymentVoucher', targetId: voucherId,
        before: { status: existing.status },
        after: { status: 'cancelled', reason: reason || null },
      });

      const safeVoucher = { ...updated, createdAt: Number(updated.createdAt), updatedAt: Number(updated.updatedAt), deletedAt: updated.deletedAt ? Number(updated.deletedAt) : null };
      return { voucher: safeVoucher, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'CANCEL_FAILED', message: `Cancel voucher transaction failed: ${String(e?.message ?? e)}` } };
  }
}
