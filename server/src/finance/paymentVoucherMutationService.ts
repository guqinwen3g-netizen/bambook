/**
 * ERP-P1-payment-voucher-mutation-shared-service-foundation
 * PaymentVoucher mutation service: route/Agent 共用事务契约。
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { syncPaymentVoucherReferences } from '../entities/sync';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { publishBusinessEvent } from '../events/businessEventBus';
import { nextBusinessNumber } from '../shared/businessNumberService';
import crypto from 'crypto';

export const VALID_PAYMENT_VOUCHER_STATUS = ['unreconciled', 'partially_reconciled', 'reconciled'] as const;
export type PaymentVoucherStatus = typeof VALID_PAYMENT_VOUCHER_STATUS[number];

// P0-9 / DR-022 凭证分类：三类费用（sample_express / customer_reimburse / business_cost）
// + normal / advance / deposit。枚举外一律拒绝（fail-closed）。
// 设计真源：财务域模型组.md §2.2 / Prisma缺口清单与迁移方案.md P0-9
export const VALID_VOUCHER_CATEGORIES = [
  'normal',
  'advance',
  'deposit',
  'sample_express',
  'customer_reimburse',
  'business_cost',
] as const;
export type VoucherCategory = typeof VALID_VOUCHER_CATEGORIES[number];

export type PaymentVoucherMutationErrorCode =
  | 'INVALID_STATUS'
  | 'INVALID_AMOUNT'
  | 'INVALID_VOUCHER_CATEGORY'
  | 'NOT_FOUND'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'STATUS_NOT_MANUAL_SETTABLE'
  | 'PAYMENT_REQUEST_REQUIRED';

export interface PaymentVoucherMutationError {
  code: PaymentVoucherMutationErrorCode;
  message: string;
}

export type PaymentVoucherMutationResult =
  | { ok: true; data: { voucher: any; auditId: string } }
  | { ok: false; error: PaymentVoucherMutationError };

export type PaymentVoucherMutationInput = Record<string, any>;

export const PAYMENT_VOUCHER_CREATE_FIELDS = [
  'id', 'voucherNumber', 'type', 'voucherCategory', 'amount', 'currency', 'paymentDate', 'paymentMethod', 'status', 'bankFee',
  'exchangeRate', 'baseCurrency', 'invoiceId', 'appliedAmount', 'orderId', 'customerRelationId',
  'customerName', 'notes', 'attachments',
] as const;

export const PAYMENT_VOUCHER_PATCH_FIELDS = [
  'type', 'voucherCategory', 'amount', 'currency', 'paymentDate', 'paymentMethod', 'bankFee',
  'exchangeRate', 'baseCurrency', 'invoiceId', 'appliedAmount', 'orderId', 'customerRelationId',
  'customerName', 'notes', 'attachments',
] as const;

const DECIMAL_FIELDS = new Set(['amount', 'bankFee', 'exchangeRate', 'appliedAmount']);

function generateId(prefix: string): string {
  return `${prefix}__${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
}

/** 服务器本地日期 YYYY-MM-DD（voucher.paymentDate 为 schema 必填，缺省默认收/付款当天） */
function localToday(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function isValidPaymentVoucherStatus(status: string): status is PaymentVoucherStatus {
  return (VALID_PAYMENT_VOUCHER_STATUS as readonly string[]).includes(status);
}

// ───────────────────────────────────────────────────────────────────
// DR-017 先申请后付款门禁（W-A 走查 DE-3 修复，fail-closed）
//   Disbursement（付款）凭证必须关联审批通过的 PaymentRequest；
//   Receipt（收款）无需申请，不受此限。
//   关联落点：attachments JSON 扩展字段（schema 冻结期设计许可，与 DR-013
//   attachments={files,scope} 扩展模式同构），并在事务内 CAS 回写
//   PaymentRequest.status=VoucherIssued + paymentVoucherId（关闭申请单）。
// ───────────────────────────────────────────────────────────────────

/** 已审批通过、可作为付款依据的申请状态 */
const PAYABLE_REQUEST_STATUSES = new Set(['Approved', 'VoucherIssued']);

function extractPaymentRequestId(input: PaymentVoucherMutationInput): string | null {
  const raw = input?.paymentRequestId;
  if (typeof raw !== 'string') return null;
  return raw.trim() || null;
}

/** 关联写入 attachments JSON 扩展字段：保留既有附件内容（对象合并 / 数组收编为 files） */
function mergePaymentRequestLink(attachments: unknown, paymentRequestId: string): Record<string, unknown> {
  if (attachments && typeof attachments === 'object' && !Array.isArray(attachments)) {
    return { ...(attachments as Record<string, unknown>), paymentRequestId };
  }
  return { files: attachments == null ? [] : Array.isArray(attachments) ? attachments : [attachments], paymentRequestId };
}

/** Disbursement 门禁：无申请 / 申请不存在 / 申请未获批 → PAYMENT_REQUEST_REQUIRED（route 映射 403） */
async function assertDisbursementPaymentRequest(
  prisma: PrismaClient,
  input: PaymentVoucherMutationInput,
): Promise<PaymentVoucherMutationError | null> {
  if (input?.type !== 'Disbursement') return null; // Receipt（收款）无需申请；type 缺失由 schema 必填约束兜底
  const paymentRequestId = extractPaymentRequestId(input);
  if (!paymentRequestId) {
    return {
      code: 'PAYMENT_REQUEST_REQUIRED',
      message: '付款（Disbursement）凭证必须关联审批通过的付款申请（DR-017 先申请后付款）：'
        + '请先经 POST /api/v1/payment-requests 提交申请并获批，再携带 paymentRequestId 创建凭证',
    };
  }
  const pr = await (prisma as any).paymentRequest?.findUnique?.({ where: { id: paymentRequestId } }).catch(() => null);
  if (!pr || pr.deletedAt) {
    return {
      code: 'PAYMENT_REQUEST_REQUIRED',
      message: `付款申请 ${paymentRequestId} 不存在或已删除，不得作为付款依据（DR-017 fail-closed）`,
    };
  }
  if (!PAYABLE_REQUEST_STATUSES.has(pr.status)) {
    return {
      code: 'PAYMENT_REQUEST_REQUIRED',
      message: `付款申请 ${paymentRequestId} 当前状态 ${pr.status}，仅审批通过（Approved）后方可创建付款凭证（DR-017 先申请后付款）`,
    };
  }
  return null;
}

function isValidVoucherCategory(category: string): category is VoucherCategory {
  return (VALID_VOUCHER_CATEGORIES as readonly string[]).includes(category);
}

/** voucherCategory 校验：传入了就必须是枚举内值（fail-closed），未传入由 schema default('normal') 兜底 */
function validateVoucherCategoryInput(input: PaymentVoucherMutationInput): PaymentVoucherMutationError | null {
  if (input?.voucherCategory === undefined || input?.voucherCategory === null) return null;
  if (typeof input.voucherCategory !== 'string' || !isValidVoucherCategory(input.voucherCategory)) {
    return { code: 'INVALID_VOUCHER_CATEGORY', message: `voucherCategory must be one of: ${VALID_VOUCHER_CATEGORIES.join(', ')}` };
  }
  return null;
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

function decimalString(v: any): string | null {
  if (v === undefined || v === null) return null;
  return typeof v?.toString === 'function' ? v.toString() : String(v);
}

function pickVoucherFields(input: PaymentVoucherMutationInput, fields: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const field of fields) {
    if (input[field] === undefined) continue;
    out[field] = input[field];
  }
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

function normalizeCreateInput(input: PaymentVoucherMutationInput): { ok: true; data: Record<string, any> } | { ok: false; error: PaymentVoucherMutationError } {
  const data = pickVoucherFields(input || {}, PAYMENT_VOUCHER_CREATE_FIELDS as any);
  let voucherStatus = 'unreconciled';
  if (input?.status != null) {
    if (typeof input.status !== 'string' || !isValidPaymentVoucherStatus(input.status)) {
      return { ok: false, error: { code: 'INVALID_STATUS', message: `status must be one of: ${VALID_PAYMENT_VOUCHER_STATUS.join(', ')}` } };
    }
    voucherStatus = input.status;
  }
  data.status = voucherStatus;
  const categoryError = validateVoucherCategoryInput(input);
  if (categoryError) return { ok: false, error: categoryError };
  // schema 必填兜底：paymentDate 缺省/空串时默认收/付款当天（前端日期可空，业务语义=创建日）
  if (data.paymentDate === undefined || data.paymentDate === null || data.paymentDate === '') {
    data.paymentDate = localToday();
  }
  if (!isValidDecimalInput(data.amount)) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: 'amount must be a valid decimal' } };
  }
  const normalized = normalizeDecimalFields(data);
  if (!normalized.ok) {
    const failedField = 'field' in normalized ? normalized.field : 'amount';
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: `${failedField} must be a valid decimal` } };
  }
  return { ok: true, data: normalized.data };
}

function normalizeUpdateInput(input: PaymentVoucherMutationInput): { ok: true; data: Record<string, any> } | { ok: false; error: PaymentVoucherMutationError } {
  // status 由 allocation 操作自动重算，禁止手动 PATCH 篡改（显式拒绝，不静默删除）
  // 与 invoiceMutationService STATUS_NOT_MANUAL_SETTABLE 模式对齐
  if (input?.status !== undefined) {
    return { ok: false, error: { code: 'STATUS_NOT_MANUAL_SETTABLE', message: 'status can only be set by allocation operations, not manual PATCH' } };
  }
  const categoryError = validateVoucherCategoryInput(input);
  if (categoryError) return { ok: false, error: categoryError };
  const data = pickVoucherFields(input || {}, PAYMENT_VOUCHER_PATCH_FIELDS as any);
  const normalized = normalizeDecimalFields(data);
  if (!normalized.ok) {
    const failedField = 'field' in normalized ? normalized.field : 'amount';
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: `${failedField} must be a valid decimal` } };
  }
  return { ok: true, data: normalized.data };
}

export async function createPaymentVoucher(params: {
  prisma: PrismaClient;
  input: PaymentVoucherMutationInput;
  actorId?: string;
  ip?: string | null;
}): Promise<PaymentVoucherMutationResult> {
  const { prisma, input, actorId, ip } = params;
  const normalized = normalizeCreateInput(input);
  if (!normalized.ok) return { ok: false, error: 'error' in normalized ? normalized.error : { code: 'CREATE_FAILED', message: 'validation failed' } };
  // DR-017 门禁（DE-3）：Disbursement 必须关联审批通过的 PaymentRequest（直付旁路 fail-closed 阻断）
  const gateError = await assertDisbursementPaymentRequest(prisma, input);
  if (gateError) return { ok: false, error: gateError };
  const paymentRequestId = extractPaymentRequestId(input);
  if (paymentRequestId) {
    normalized.data.attachments = mergePaymentRequestLink(normalized.data.attachments, paymentRequestId);
  }
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const now = BigInt(Date.now());
      const id = generateId('PAY');
      // PRD 5.6：服务端自动生成凭证号（PV-YYYY-NNNN），传入时优先使用传入值
      const voucherNumber = input.voucherNumber || await nextBusinessNumber(tx, 'PV');
      const data = { id, ...normalized.data, voucherNumber, createdAt: now, updatedAt: now };
      const voucher = await tx.paymentVoucher.create({ data });
      // DR-017 闭环：凭证落库同事务 CAS 回写申请单（Approved 且未关联凭证 → VoucherIssued + paymentVoucherId）；
      // count=0 = 已被并发凭证关联，不覆盖既有链接（并发安全幂等）
      if (paymentRequestId) {
        await tx.paymentRequest.updateMany({
          where: { id: paymentRequestId, status: 'Approved', paymentVoucherId: null },
          data: { paymentVoucherId: voucher.id, status: 'VoucherIssued' },
        });
      }
      await syncPaymentVoucherReferences(prisma, voucher, { source: 'route:voucher:create' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:voucher:create',
        operation: 'create_voucher', targetType: 'PaymentVoucher', targetId: voucher.id,
        after: { id: voucher.id, voucherNumber: voucher.voucherNumber, type: voucher.type, amount: decimalString(voucher.amount), status: voucher.status, ...(paymentRequestId ? { paymentRequestId } : {}) },
        ip: ip || null,
      });
      return { voucher, auditId };
    });
    // Publish domain event after commit (best-effort, never fails business)
    publishBusinessEvent({
      type: 'PaymentVoucherCreated',
      sourceEntityType: 'PaymentVoucher',
      sourceEntityId: result.voucher.id,
      orderId: result.voucher.orderId || undefined,
      payload: {
        voucherId: result.voucher.id,
        voucherNumber: result.voucher.voucherNumber,
        type: result.voucher.type,
        amount: decimalString(result.voucher.amount),
        currency: result.voucher.currency,
        paymentDate: result.voucher.paymentDate,
        paymentMethod: result.voucher.paymentMethod,
        status: result.voucher.status,
        customerName: result.voucher.customerName,
        customerRelationId: result.voucher.customerRelationId,
        invoiceId: result.voucher.invoiceId,
      },
      actorId: actorId || 'api',
      transactionId: result.auditId,
    }).catch(() => { /* event publish failure must not fail business */ });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: String(e.message ?? e) } };
    }
    return { ok: false, error: { code: 'CREATE_FAILED', message: `Create voucher transaction failed: ${String(e?.message ?? e)}` } };
  }
}

export async function updatePaymentVoucher(params: {
  prisma: PrismaClient;
  voucherId: string;
  input: PaymentVoucherMutationInput;
  actorId?: string;
  ip?: string | null;
}): Promise<PaymentVoucherMutationResult> {
  const { prisma, voucherId, input, actorId, ip } = params;
  const normalized = normalizeUpdateInput(input);
  if (!normalized.ok) return { ok: false, error: 'error' in normalized ? normalized.error : { code: 'UPDATE_FAILED', message: 'validation failed' } };
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.paymentVoucher.findUnique({ where: { id: voucherId }, select: { id: true, status: true, amount: true, appliedAmount: true, deletedAt: true } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error('voucher not found'), { statusCode: 404, code: 'NOT_FOUND' });
      }
      const data = { ...normalized.data, updatedAt: BigInt(Date.now()) };
      const voucher = await tx.paymentVoucher.update({ where: { id: voucherId }, data });
      await syncPaymentVoucherReferences(prisma, voucher, { source: 'route:voucher:update' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:voucher:update',
        operation: 'update_voucher', targetType: 'PaymentVoucher', targetId: voucher.id,
        before: { status: existing.status, amount: decimalString(existing.amount), appliedAmount: decimalString(existing.appliedAmount) },
        after: { status: voucher.status, amount: decimalString(voucher.amount), appliedAmount: decimalString(voucher.appliedAmount) },
        ip: ip || null,
      });
      return { voucher, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code === 'NOT_FOUND') return { ok: false, error: { code: 'NOT_FOUND', message: String(e.message ?? e) } };
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: String(e.message ?? e) } };
    }
    return { ok: false, error: { code: 'UPDATE_FAILED', message: `Update voucher transaction failed: ${String(e?.message ?? e)}` } };
  }
}
