/**
 * 阶段 C6 — 增值税发票（VatInvoice）生命周期服务
 *
 * 业务背景：外贸企业「免退」办法下，出口退税 = 进项专票注明金额 × 退税率，
 *   无增值税专用发票无退税。本服务管理专票全生命周期：
 *   收票(Received) → 勾选认证(Verified) → 申报退税(Declared) → 红冲(RedFlushed) / 作废(Cancelled)
 *
 * 设计决策（fail closed）：
 *   - 金额三栏服务端校验：totalAmount == round4(netAmount + taxAmount) 精确一致；
 *     taxAmount vs round4(netAmount × taxRate/100) 容差 0.02（开票尾差）
 *   - 唯一性：(vatCode, vatNumber) 复合唯一；全电票 vatCode 为 NULL（PG NULL 不参与唯一冲突），
 *     事务内应用层查重兜底
 *   - 退税联动：→Declared 强制 direction=Input + invoiceType=Special + taxRefundId 有效（未软删）
 *   - 红冲/作废为终态；Declared 不可删除（税务留痕），仅可红冲
 *   - EntityLink 图谱同步 + route audit + business event（与 fxSettlement 同口径）
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { syncVatInvoiceReferences, deactivateEntityLinks } from '../entities/sync';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { publishBusinessEvent } from '../events/businessEventBus';

export type VatInvoiceStatus = 'Received' | 'Verified' | 'Declared' | 'RedFlushed' | 'Cancelled';
export type VatInvoiceDirection = 'Input' | 'Output';
export type VatInvoiceType = 'Special' | 'Normal';

export type VatInvoiceErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_MISMATCH'
  | 'TAX_MISMATCH'
  | 'INVALID_DATE'
  | 'INVALID_STATUS'
  | 'INVALID_TRANSITION'
  | 'DUPLICATE_VAT_INVOICE'
  | 'NOT_FOUND'
  | 'TAX_REFUND_REQUIRED'
  | 'TAX_REFUND_NOT_FOUND'
  | 'NOT_INPUT_SPECIAL'
  | 'DELETE_FORBIDDEN'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'DELETE_FAILED'
  | 'TRANSITION_FAILED';

export interface VatInvoiceError {
  code: VatInvoiceErrorCode;
  message: string;
}

export type VatInvoiceResult =
  | { ok: true; data: { vatInvoice: any; auditId?: string } }
  | { ok: false; error: VatInvoiceError };

export interface VatInvoiceCreateInput {
  vatCode?: string;
  vatNumber: string;
  direction?: string;
  invoiceType?: string;
  sellerName: string;
  sellerTaxNo?: string;
  buyerName: string;
  buyerTaxNo?: string;
  issueDate: string;
  netAmount: number | string;
  taxRate: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  currency?: string;
  invoiceId?: string;
  orderId?: string;
  relationId?: string;
  notes?: string;
  attachments?: any;
}

export interface VatInvoicePatchInput {
  vatCode?: string;
  sellerName?: string;
  sellerTaxNo?: string;
  buyerName?: string;
  buyerTaxNo?: string;
  issueDate?: string;
  netAmount?: number | string;
  taxRate?: number | string;
  taxAmount?: number | string;
  totalAmount?: number | string;
  deductionPeriod?: string;
  invoiceId?: string;
  orderId?: string;
  relationId?: string;
  notes?: string;
  attachments?: any;
}

export interface VatInvoiceTransitionInput {
  toStatus: VatInvoiceStatus;
  verifiedDate?: string;        // →Verified 时缺省当日
  deductionPeriod?: string;     // →Verified 时可带勾选所属期
  taxRefundId?: string;         // →Declared 必填（或已挂在票上）
  redFlushNumber?: string;      // →RedFlushed 可带红字发票号
  redFlushDate?: string;        // →RedFlushed 缺省当日
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-\d{2}$/;

/** 税额容差：开票尾差 ±0.02 */
const TAX_TOLERANCE = 0.02;

const VAT_TRANSITIONS: Record<VatInvoiceStatus, VatInvoiceStatus[]> = {
  Received: ['Verified', 'Cancelled'],
  Verified: ['Declared', 'RedFlushed'],
  Declared: ['RedFlushed'],
  RedFlushed: [],
  Cancelled: [],
};

function isValidDecimalInput(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') {
    if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
    try { return new Prisma.Decimal(v).isFinite(); } catch { return false; }
  }
  return false;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function decimalString(v: any): string | null {
  if (v === undefined || v === null) return null;
  return typeof v?.toString === 'function' ? v.toString() : String(v);
}

function generateId(prefix: string): string {
  return `${prefix}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 金额三栏校验：total == net + tax（精确）；tax ≈ net × rate/100（容差 0.02） */
function validateAmounts(netAmount: number, taxRate: number, taxAmount: number, totalAmount: number): VatInvoiceError | null {
  if (netAmount <= 0 || taxAmount < 0 || totalAmount <= 0 || taxRate < 0 || taxRate > 100) {
    return { code: 'INVALID_AMOUNT', message: 'amounts must be positive and taxRate within [0,100]' };
  }
  if (round4(netAmount + taxAmount) !== round4(totalAmount)) {
    return { code: 'AMOUNT_MISMATCH', message: `totalAmount ${totalAmount} != netAmount + taxAmount (${round4(netAmount + taxAmount)})` };
  }
  const expectedTax = round4(netAmount * (taxRate / 100));
  if (Math.abs(expectedTax - taxAmount) > TAX_TOLERANCE) {
    return { code: 'TAX_MISMATCH', message: `taxAmount ${taxAmount} deviates from netAmount × taxRate (${expectedTax}) beyond ±${TAX_TOLERANCE}` };
  }
  return null;
}

export async function createVatInvoice(params: {
  prisma: PrismaClient;
  input: VatInvoiceCreateInput;
  actorId?: string;
  ip?: string | null;
}): Promise<VatInvoiceResult> {
  const { prisma, input, actorId, ip } = params;

  // ── 输入校验（fail closed） ──
  if (!input || typeof input.vatNumber !== 'string' || !input.vatNumber.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'vatNumber is required' } };
  }
  if (typeof input.sellerName !== 'string' || !input.sellerName.trim()
    || typeof input.buyerName !== 'string' || !input.buyerName.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'sellerName and buyerName are required' } };
  }
  if (typeof input.issueDate !== 'string' || !DATE_RE.test(input.issueDate)) {
    return { ok: false, error: { code: 'INVALID_DATE', message: 'issueDate must be YYYY-MM-DD' } };
  }
  for (const f of ['netAmount', 'taxRate', 'taxAmount', 'totalAmount'] as const) {
    if (!isValidDecimalInput(input[f])) {
      return { ok: false, error: { code: 'INVALID_AMOUNT', message: `${f} must be a valid decimal` } };
    }
  }
  const direction = (input.direction?.trim() || 'Input') as VatInvoiceDirection;
  if (!['Input', 'Output'].includes(direction)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'direction must be Input|Output' } };
  }
  const invoiceType = (input.invoiceType?.trim() || 'Special') as VatInvoiceType;
  if (!['Special', 'Normal'].includes(invoiceType)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'invoiceType must be Special|Normal' } };
  }

  const netAmount = Number(input.netAmount);
  const taxRate = Number(input.taxRate);
  const taxAmount = Number(input.taxAmount);
  const totalAmount = Number(input.totalAmount);
  const amountError = validateAmounts(netAmount, taxRate, taxAmount, totalAmount);
  if (amountError) return { ok: false, error: amountError };

  const vatCode = input.vatCode?.trim() || null;
  const vatNumber = input.vatNumber.trim();

  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      // ── 查重（复合唯一 + 全电票 NULL code 应用层兜底） ──
      const dup = await tx.vatInvoice.findFirst({
        where: { vatCode, vatNumber, deletedAt: null },
        select: { id: true },
      });
      if (dup) {
        throw Object.assign(new Error(`duplicate vat invoice: code=${vatCode ?? '(none)'} number=${vatNumber}`), { code: 'DUPLICATE_VAT_INVOICE' });
      }

      const now = BigInt(Date.now());
      const vatInvoice = await tx.vatInvoice.create({
        data: {
          id: generateId('VAT'),
          vatCode,
          vatNumber,
          direction,
          invoiceType,
          status: 'Received',
          sellerName: input.sellerName.trim(),
          sellerTaxNo: input.sellerTaxNo?.trim() || null,
          buyerName: input.buyerName.trim(),
          buyerTaxNo: input.buyerTaxNo?.trim() || null,
          issueDate: input.issueDate,
          netAmount: new Prisma.Decimal(netAmount.toFixed(4)),
          taxRate: new Prisma.Decimal(taxRate.toString()),
          taxAmount: new Prisma.Decimal(taxAmount.toFixed(4)),
          totalAmount: new Prisma.Decimal(totalAmount.toFixed(4)),
          currency: input.currency?.trim() || 'CNY',
          invoiceId: input.invoiceId?.trim() || null,
          orderId: input.orderId?.trim() || null,
          relationId: input.relationId?.trim() || null,
          notes: input.notes ?? null,
          attachments: input.attachments ?? null,
          createdAt: now,
          updatedAt: now,
        },
      });

      await syncVatInvoiceReferences(prisma, vatInvoice, { source: 'route:vat-invoice:create' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:vat-invoice:create',
        operation: 'create_vat_invoice', targetType: 'VatInvoice', targetId: vatInvoice.id,
        after: {
          id: vatInvoice.id, vatCode, vatNumber, direction, invoiceType,
          netAmount: decimalString(vatInvoice.netAmount), taxRate: decimalString(vatInvoice.taxRate),
          taxAmount: decimalString(vatInvoice.taxAmount), totalAmount: decimalString(vatInvoice.totalAmount),
        },
        ip: ip || null,
      });
      return { vatInvoice, auditId };
    });

    publishBusinessEvent({
      type: 'VatInvoiceCreated',
      sourceEntityType: 'VatInvoice',
      sourceEntityId: result.vatInvoice.id,
      orderId: result.vatInvoice.orderId || undefined,
      payload: {
        vatInvoiceId: result.vatInvoice.id,
        vatNumber: result.vatInvoice.vatNumber,
        direction: result.vatInvoice.direction,
        totalAmount: decimalString(result.vatInvoice.totalAmount),
        relationId: result.vatInvoice.relationId,
      },
      actorId: actorId || 'api',
      transactionId: result.auditId,
    }).catch(() => { /* event publish failure must not fail business */ });

    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: String(e.message ?? e) } };
    }
    return { ok: false, error: { code: 'CREATE_FAILED', message: `Create vat invoice transaction failed: ${String(e?.message ?? e)}` } };
  }
}

export async function updateVatInvoice(params: {
  prisma: PrismaClient;
  vatInvoiceId: string;
  patch: VatInvoicePatchInput;
  actorId?: string;
  ip?: string | null;
}): Promise<VatInvoiceResult> {
  const { prisma, vatInvoiceId, patch, actorId, ip } = params;

  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.vatInvoice.findUnique({ where: { id: vatInvoiceId } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error('vat invoice not found'), { code: 'NOT_FOUND' });
      }
      // 终态与已申报不可改（税务留痕）；红冲/作废前可修正票面与关联
      if (['Declared', 'RedFlushed', 'Cancelled'].includes(existing.status)) {
        throw Object.assign(new Error(`vat invoice in status ${existing.status} cannot be edited`), { code: 'INVALID_STATUS' });
      }

      const netAmount = patch.netAmount !== undefined ? Number(patch.netAmount) : Number(existing.netAmount.toString());
      const taxRate = patch.taxRate !== undefined ? Number(patch.taxRate) : Number(existing.taxRate.toString());
      const taxAmount = patch.taxAmount !== undefined ? Number(patch.taxAmount) : Number(existing.taxAmount.toString());
      const totalAmount = patch.totalAmount !== undefined ? Number(patch.totalAmount) : Number(existing.totalAmount.toString());
      for (const [k, v] of Object.entries({ netAmount, taxRate, taxAmount, totalAmount })) {
        if (!Number.isFinite(v)) {
          throw Object.assign(new Error(`${k} must be a valid decimal`), { code: 'INVALID_AMOUNT' });
        }
      }
      const amountError = validateAmounts(netAmount, taxRate, taxAmount, totalAmount);
      if (amountError) throw Object.assign(new Error(amountError.message), { code: amountError.code });

      if (patch.issueDate !== undefined && !DATE_RE.test(patch.issueDate)) {
        throw Object.assign(new Error('issueDate must be YYYY-MM-DD'), { code: 'INVALID_DATE' });
      }
      if (patch.deductionPeriod !== undefined && patch.deductionPeriod !== null && patch.deductionPeriod !== ''
        && !PERIOD_RE.test(patch.deductionPeriod)) {
        throw Object.assign(new Error('deductionPeriod must be YYYY-MM'), { code: 'INVALID_DATE' });
      }

      const data: any = { updatedAt: BigInt(Date.now()) };
      if (patch.vatCode !== undefined) data.vatCode = patch.vatCode?.trim() || null;
      if (patch.sellerName !== undefined) data.sellerName = patch.sellerName.trim();
      if (patch.sellerTaxNo !== undefined) data.sellerTaxNo = patch.sellerTaxNo?.trim() || null;
      if (patch.buyerName !== undefined) data.buyerName = patch.buyerName.trim();
      if (patch.buyerTaxNo !== undefined) data.buyerTaxNo = patch.buyerTaxNo?.trim() || null;
      if (patch.issueDate !== undefined) data.issueDate = patch.issueDate;
      if (patch.netAmount !== undefined) data.netAmount = new Prisma.Decimal(netAmount.toFixed(4));
      if (patch.taxRate !== undefined) data.taxRate = new Prisma.Decimal(taxRate.toString());
      if (patch.taxAmount !== undefined) data.taxAmount = new Prisma.Decimal(taxAmount.toFixed(4));
      if (patch.totalAmount !== undefined) data.totalAmount = new Prisma.Decimal(totalAmount.toFixed(4));
      if (patch.deductionPeriod !== undefined) data.deductionPeriod = patch.deductionPeriod?.trim() || null;
      if (patch.invoiceId !== undefined) data.invoiceId = patch.invoiceId?.trim() || null;
      if (patch.orderId !== undefined) data.orderId = patch.orderId?.trim() || null;
      if (patch.relationId !== undefined) data.relationId = patch.relationId?.trim() || null;
      if (patch.notes !== undefined) data.notes = patch.notes;
      if (patch.attachments !== undefined) data.attachments = patch.attachments;

      const vatInvoice = await tx.vatInvoice.update({ where: { id: vatInvoiceId }, data });
      await syncVatInvoiceReferences(prisma, vatInvoice, { source: 'route:vat-invoice:update' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:vat-invoice:update',
        operation: 'update_vat_invoice', targetType: 'VatInvoice', targetId: vatInvoiceId,
        before: { status: existing.status, totalAmount: decimalString(existing.totalAmount) },
        after: { patch: Object.keys(patch), totalAmount: decimalString(vatInvoice.totalAmount) },
        ip: ip || null,
      });
      return { vatInvoice, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: String(e.message ?? e) } };
    }
    return { ok: false, error: { code: 'UPDATE_FAILED', message: `Update vat invoice transaction failed: ${String(e?.message ?? e)}` } };
  }
}

export async function transitionVatInvoiceStatus(params: {
  prisma: PrismaClient;
  vatInvoiceId: string;
  input: VatInvoiceTransitionInput;
  actorId?: string;
  ip?: string | null;
}): Promise<VatInvoiceResult> {
  const { prisma, vatInvoiceId, input, actorId, ip } = params;

  const toStatus = input?.toStatus;
  if (!toStatus || !Object.prototype.hasOwnProperty.call(VAT_TRANSITIONS, toStatus)) {
    return { ok: false, error: { code: 'INVALID_STATUS', message: `invalid toStatus: ${String(toStatus)}` } };
  }

  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.vatInvoice.findUnique({ where: { id: vatInvoiceId } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error('vat invoice not found'), { code: 'NOT_FOUND' });
      }
      const from = existing.status as VatInvoiceStatus;
      if (!VAT_TRANSITIONS[from].includes(toStatus)) {
        throw Object.assign(
          new Error(`invalid transition: ${from} → ${toStatus} (allowed: ${VAT_TRANSITIONS[from].join('|') || 'none'})`),
          { code: 'INVALID_TRANSITION' },
        );
      }

      const data: any = { status: toStatus, updatedAt: BigInt(Date.now()) };

      if (toStatus === 'Verified') {
        const verifiedDate = input.verifiedDate ?? today();
        if (!DATE_RE.test(verifiedDate)) {
          throw Object.assign(new Error('verifiedDate must be YYYY-MM-DD'), { code: 'INVALID_DATE' });
        }
        if (input.deductionPeriod !== undefined && input.deductionPeriod !== null && input.deductionPeriod !== ''
          && !PERIOD_RE.test(input.deductionPeriod)) {
          throw Object.assign(new Error('deductionPeriod must be YYYY-MM'), { code: 'INVALID_DATE' });
        }
        data.verifiedDate = verifiedDate;
        if (input.deductionPeriod) data.deductionPeriod = input.deductionPeriod.trim();
      }

      if (toStatus === 'Declared') {
        // 退税联动硬校验：仅进项专票可申报退税，且必须挂有效退税申报
        if (existing.direction !== 'Input' || existing.invoiceType !== 'Special') {
          throw Object.assign(
            new Error('only Input + Special vat invoices can be declared for export tax refund'),
            { code: 'NOT_INPUT_SPECIAL' },
          );
        }
        const taxRefundId = input.taxRefundId?.trim() || existing.taxRefundId;
        if (!taxRefundId) {
          throw Object.assign(new Error('taxRefundId is required when transitioning to Declared'), { code: 'TAX_REFUND_REQUIRED' });
        }
        const refund = await tx.taxRefund.findFirst({ where: { id: taxRefundId, deletedAt: null }, select: { id: true } });
        if (!refund) {
          throw Object.assign(new Error(`tax refund ${taxRefundId} not found`), { code: 'TAX_REFUND_NOT_FOUND' });
        }
        data.taxRefundId = taxRefundId;
      }

      if (toStatus === 'RedFlushed') {
        const redFlushDate = input.redFlushDate ?? today();
        if (!DATE_RE.test(redFlushDate)) {
          throw Object.assign(new Error('redFlushDate must be YYYY-MM-DD'), { code: 'INVALID_DATE' });
        }
        data.redFlushDate = redFlushDate;
        if (input.redFlushNumber) data.redFlushNumber = input.redFlushNumber.trim();
      }

      const vatInvoice = await tx.vatInvoice.update({ where: { id: vatInvoiceId }, data });
      await syncVatInvoiceReferences(prisma, vatInvoice, { source: 'route:vat-invoice:transition' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:vat-invoice:transition',
        operation: 'transition_vat_invoice', targetType: 'VatInvoice', targetId: vatInvoiceId,
        before: { status: from },
        after: { status: toStatus, taxRefundId: vatInvoice.taxRefundId, verifiedDate: vatInvoice.verifiedDate },
        ip: ip || null,
      });
      return { vatInvoice, auditId, from };
    });

    publishBusinessEvent({
      type: 'VatInvoiceStatusChanged',
      sourceEntityType: 'VatInvoice',
      sourceEntityId: vatInvoiceId,
      orderId: result.vatInvoice.orderId || undefined,
      payload: {
        vatInvoiceId,
        vatNumber: result.vatInvoice.vatNumber,
        from: (result as any).from,
        to: toStatus,
        taxRefundId: result.vatInvoice.taxRefundId,
      },
      actorId: actorId || 'api',
      transactionId: result.auditId,
    }).catch(() => { /* event publish failure must not fail business */ });

    return { ok: true, data: { vatInvoice: result.vatInvoice, auditId: result.auditId } };
  } catch (e: any) {
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: String(e.message ?? e) } };
    }
    return { ok: false, error: { code: 'TRANSITION_FAILED', message: `Transition vat invoice transaction failed: ${String(e?.message ?? e)}` } };
  }
}

export async function deleteVatInvoice(params: {
  prisma: PrismaClient;
  vatInvoiceId: string;
  actorId?: string;
  ip?: string | null;
}): Promise<VatInvoiceResult> {
  const { prisma, vatInvoiceId, actorId, ip } = params;
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.vatInvoice.findUnique({ where: { id: vatInvoiceId } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error('vat invoice not found'), { code: 'NOT_FOUND' });
      }
      // Declared 不可删除（税务留痕）——仅可红冲
      if (existing.status === 'Declared') {
        throw Object.assign(new Error('declared vat invoice cannot be deleted; use RedFlushed instead'), { code: 'DELETE_FORBIDDEN' });
      }
      const now = BigInt(Date.now());
      const vatInvoice = await tx.vatInvoice.update({
        where: { id: vatInvoiceId },
        data: { deletedAt: now, updatedAt: now },
      });
      await deactivateEntityLinks(tx, 'vatInvoice', vatInvoiceId, now);
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:vat-invoice:delete',
        operation: 'delete_vat_invoice', targetType: 'VatInvoice', targetId: vatInvoiceId,
        before: {
          vatNumber: existing.vatNumber, status: existing.status,
          totalAmount: decimalString(existing.totalAmount),
        },
        ip: ip || null,
      });
      return { vatInvoice, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: String(e.message ?? e) } };
    }
    return { ok: false, error: { code: 'DELETE_FAILED', message: `Delete vat invoice transaction failed: ${String(e?.message ?? e)}` } };
  }
}

// ────────────────────────────────────────────────────────────────
// 只读查询
// ────────────────────────────────────────────────────────────────

export async function listVatInvoices(
  prisma: PrismaClient,
  params: {
    status?: string; direction?: string; relationId?: string; taxRefundId?: string;
    invoiceId?: string; orderId?: string; from?: string; to?: string;
  } = {},
): Promise<{ items: any[]; total: number }> {
  const where: any = { deletedAt: null };
  if (params.status) where.status = params.status;
  if (params.direction) where.direction = params.direction;
  if (params.relationId) where.relationId = params.relationId;
  if (params.taxRefundId) where.taxRefundId = params.taxRefundId;
  if (params.invoiceId) where.invoiceId = params.invoiceId;
  if (params.orderId) where.orderId = params.orderId;
  if (params.from && DATE_RE.test(params.from)) where.issueDate = { ...(where.issueDate || {}), gte: params.from };
  if (params.to && DATE_RE.test(params.to)) where.issueDate = { ...(where.issueDate || {}), lte: params.to };
  const items = await (prisma as any).vatInvoice.findMany({
    where,
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
  });
  return { items, total: items.length };
}

export async function getVatInvoice(
  prisma: PrismaClient,
  vatInvoiceId: string,
): Promise<{ ok: true; data: { vatInvoice: any } } | { ok: false; error: VatInvoiceError }> {
  const vatInvoice = await (prisma as any).vatInvoice.findUnique({ where: { id: vatInvoiceId } });
  if (!vatInvoice || vatInvoice.deletedAt) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'vat invoice not found' } };
  }
  return { ok: true, data: { vatInvoice } };
}
