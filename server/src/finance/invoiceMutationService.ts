import { Prisma, PrismaClient } from '@prisma/client';
import { syncInvoiceReferences } from '../entities/sync';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { validateStatusTransition } from '../statusTransition';
import { publishBusinessEvent } from '../events/businessEventBus';

export type InvoiceMutationErrorCode =
  | 'INVALID_STATUS'
  | 'INVALID_TRANSITION'
  | 'INVALID_CURRENT_STATUS'
  | 'INVALID_AMOUNT'
  | 'NOT_FOUND'
  | 'STATUS_NOT_MANUAL_SETTABLE'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED';

export interface InvoiceMutationError { code: InvoiceMutationErrorCode; message: string; }
export interface InvoiceMutationResult { ok: boolean; data?: { invoice: any; auditId: string }; error?: InvoiceMutationError; }
export type InvoiceMutationInput = Record<string, any>;

export const INVOICE_CREATE_FIELDS = ['id', 'invoiceNumber', 'type', 'status', 'amount', 'currency', 'issueDate', 'dueDate', 'exchangeRate', 'baseCurrency', 'orderId', 'customerRelationId', 'customerName', 'notes', 'attachments'] as const;
export const INVOICE_PATCH_FIELDS = ['type', 'status', 'amount', 'currency', 'issueDate', 'dueDate', 'exchangeRate', 'baseCurrency', 'orderId', 'customerRelationId', 'customerName', 'notes', 'attachments'] as const;

const DECIMAL_FIELDS = new Set(['amount', 'exchangeRate']);

function decimalString(v: any): string | null {
  if (v === undefined || v === null) return null;
  return typeof v?.toString === 'function' ? v.toString() : String(v);
}

function isValidDecimalInput(v: unknown): boolean {
  if (v === undefined) return true;
  if (v === null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') {
    if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
    try { return new Prisma.Decimal(v).isFinite(); } catch { return false; }
  }
  return false;
}

function pick(input: any, fields: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const field of fields) if (input?.[field] !== undefined) out[field] = input[field];
  return out;
}

function normalizeDecimalFields(data: Record<string, any>): { ok: true; data: Record<string, any> } | { ok: false; field: string } {
  for (const field of Object.keys(data)) {
    if (!DECIMAL_FIELDS.has(field)) continue;
    if (!isValidDecimalInput(data[field])) return { ok: false, field };
    if (data[field] !== undefined) data[field] = new Prisma.Decimal(data[field]);
  }
  return { ok: true, data };
}

function normalizeCreateInput(input: InvoiceMutationInput): { ok: true; data: Record<string, any> } | { ok: false; error: InvoiceMutationError } {
  const data = pick(input || {}, INVOICE_CREATE_FIELDS as any);
  const status = input?.status ?? 'Draft';
  if (input?.status != null && typeof input.status !== 'string') return { ok: false, error: { code: 'INVALID_STATUS', message: 'status must be a non-null string' } };
  const transition = validateStatusTransition('Invoice', 'Draft', status);
  if (!transition.ok) return { ok: false, error: { code: transition.error as InvoiceMutationErrorCode, message: transition.message! } };
  data.status = status;
  if (!Object.prototype.hasOwnProperty.call(input || {}, 'amount') || input.amount === undefined || input.amount === null || !isValidDecimalInput(data.amount)) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: 'amount must be a valid decimal' } };
  }
  const normalized = normalizeDecimalFields(data);
  if (!normalized.ok) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: `${normalized.field} must be a valid decimal` } };
  }
  return { ok: true, data: normalized.data };
}

function normalizeUpdateInput(input: InvoiceMutationInput): { ok: true; data: Record<string, any>; hasStatus: boolean } | { ok: false; error: InvoiceMutationError } {
  const data = pick(input || {}, INVOICE_PATCH_FIELDS as any);
  const hasStatus = Object.prototype.hasOwnProperty.call(input || {}, 'status');
  if (hasStatus && typeof input.status !== 'string') return { ok: false, error: { code: 'INVALID_STATUS', message: 'status must be a non-null string' } };
  const normalized = normalizeDecimalFields(data);
  if (!normalized.ok) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: `${normalized.field} must be a valid decimal` } };
  }
  return { ok: true, data: normalized.data, hasStatus };
}

function toError(e: any, fallback: InvoiceMutationErrorCode): InvoiceMutationError {
  if (['INVALID_STATUS', 'INVALID_TRANSITION', 'INVALID_CURRENT_STATUS', 'INVALID_AMOUNT', 'NOT_FOUND', 'STATUS_NOT_MANUAL_SETTABLE'].includes(e?.code)) return { code: e.code, message: String(e.message ?? e) };
  return { code: fallback, message: String(e?.message ?? e) };
}

export async function createInvoice(params: { prisma: PrismaClient; input: InvoiceMutationInput; actorId?: string; ip?: string | null }): Promise<InvoiceMutationResult> {
  const { prisma, input, actorId, ip } = params;
  const normalized = normalizeCreateInput(input);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const now = BigInt(Date.now());
      const data = { ...normalized.data, invoiceNumber: input.invoiceNumber, createdAt: now, updatedAt: now };
      const invoice = await tx.invoice.create({ data });
      await syncInvoiceReferences(prisma, invoice, { source: 'route:invoice:create' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:invoice:create',
        operation: 'create_invoice', targetType: 'Invoice', targetId: invoice.id,
        after: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, type: invoice.type, amount: decimalString(invoice.amount), status: invoice.status },
        ip: ip || null,
      });
      return { invoice, auditId };
    });
    // Publish domain events after commit (best-effort, never fails business)
    if (result.invoice.status === 'Issued') {
      publishBusinessEvent({
        type: 'InvoiceIssued',
        sourceEntityType: 'Invoice',
        sourceEntityId: result.invoice.id,
        orderId: result.invoice.orderId || undefined,
        payload: {
          invoiceId: result.invoice.id,
          invoiceNumber: result.invoice.invoiceNumber,
          type: result.invoice.type,
          amount: decimalString(result.invoice.amount),
          currency: result.invoice.currency,
          customerName: result.invoice.customerName,
          customerRelationId: result.invoice.customerRelationId,
        },
        actorId: actorId || 'api',
        transactionId: result.auditId,
      }).catch(() => { /* event publish failure must not fail business */ });
    }
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: toError(e, 'CREATE_FAILED') };
  }
}

export async function updateInvoice(params: { prisma: PrismaClient; invoiceId: string; input: InvoiceMutationInput; actorId?: string; ip?: string | null }): Promise<InvoiceMutationResult> {
  const { prisma, invoiceId, input, actorId, ip } = params;
  const normalized = normalizeUpdateInput(input);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, status: true, amount: true, deletedAt: true } });
      if (!existing || existing.deletedAt) throw Object.assign(new Error('invoice not found'), { code: 'NOT_FOUND', statusCode: 404 });
      if (normalized.hasStatus) {
        // PartiallyPaid/Paid 只能由 allocation 操作自动重算，禁止手动 PATCH
        if (input.status === 'PartiallyPaid' || input.status === 'Paid') {
          throw Object.assign(new Error(`status ${input.status} can only be set by allocation operations, not manual PATCH`), { code: 'STATUS_NOT_MANUAL_SETTABLE', statusCode: 400 });
        }
        const transition = validateStatusTransition('Invoice', existing.status, input.status);
        if (!transition.ok) throw Object.assign(new Error(transition.message!), { code: transition.error });
      }
      const data = { ...normalized.data, updatedAt: BigInt(Date.now()) };
      const invoice = await tx.invoice.update({ where: { id: invoiceId }, data });
      await syncInvoiceReferences(prisma, invoice, { source: 'route:invoice:update' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:invoice:update',
        operation: 'update_invoice', targetType: 'Invoice', targetId: invoice.id,
        before: { status: existing.status, amount: decimalString(existing.amount) },
        after: { status: invoice.status, amount: decimalString(invoice.amount) },
        ip: ip || null,
      });
      return { invoice, auditId, fromStatus: existing.status };
    });
    // Publish domain events after commit (best-effort, never fails business)
    if (normalized.hasStatus && result.fromStatus !== result.invoice.status) {
      if (result.invoice.status === 'Issued' && result.fromStatus !== 'Issued') {
        publishBusinessEvent({
          type: 'InvoiceIssued',
          sourceEntityType: 'Invoice',
          sourceEntityId: result.invoice.id,
          orderId: result.invoice.orderId || undefined,
          payload: {
            invoiceId: result.invoice.id,
            invoiceNumber: result.invoice.invoiceNumber,
            type: result.invoice.type,
            amount: decimalString(result.invoice.amount),
            currency: result.invoice.currency,
            customerName: result.invoice.customerName,
            fromStatus: result.fromStatus,
          },
          actorId: actorId || 'api',
          transactionId: result.auditId,
        }).catch(() => { /* event publish failure must not fail business */ });
      }
      if (result.invoice.status === 'Cancelled' && result.fromStatus !== 'Cancelled') {
        publishBusinessEvent({
          type: 'InvoiceCancelled',
          sourceEntityType: 'Invoice',
          sourceEntityId: result.invoice.id,
          orderId: result.invoice.orderId || undefined,
          payload: {
            invoiceId: result.invoice.id,
            invoiceNumber: result.invoice.invoiceNumber,
            type: result.invoice.type,
            amount: decimalString(result.invoice.amount),
            currency: result.invoice.currency,
            customerName: result.invoice.customerName,
            fromStatus: result.fromStatus,
          },
          actorId: actorId || 'api',
          transactionId: result.auditId,
        }).catch(() => { /* event publish failure must not fail business */ });
      }
    }
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: toError(e, 'UPDATE_FAILED') };
  }
}
