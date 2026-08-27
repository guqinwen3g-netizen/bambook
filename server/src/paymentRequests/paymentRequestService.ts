/**
 * paymentRequestService.ts — DR-017 付款申请服务（先申请后付款唯一入口）
 *
 * 设计真源：
 *   - docs/design/02-数据模型/财务域模型组.md §2.1（PaymentRequest：审批通过前不得创建 PaymentVoucher）
 *   - docs/design/04-模块设计/05-财务与结算/应付与付款流程.md §8（DR-007 组织归属路由，去阈值化）
 *   - docs/design/04-模块设计/05-财务与结算/付款凭证管理.md §6（付款审批流设计规格）
 *   - docs/design/02-数据模型/Prisma缺口清单与迁移方案.md P1-1（PaymentRequest 模型）
 *
 * 铁律（fail-closed）：
 *   1. 审批单必须经 approvalCreateService.createBusinessApproval 创建
 *      （reviewerId 服务端 DR-007 解析，前端传入一律忽略并审计，绝不手写）
 *   2. 未批准（status≠Approved）不得生成 PaymentVoucher（DR-017）
 *   3. 凭证生成幂等：paymentVoucherId 已关联时重复调用直接返回既有凭证，不产生二次写入
 *   4. 状态机守卫：Draft → Pending → Approved → VoucherIssued（+Rejected/Cancelled），
 *      非法迁移一律 409 拒绝
 *   5. paymentCategory 六类枚举（同 PaymentVoucher.voucherCategory，P0-9/DR-022），枚举外拒绝
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { writeRouteAuditLog } from '../audit/routeAudit';
import type { ApprovalCreateService } from '../approvals/approvalCreateService';
import {
  createPaymentVoucher,
  VALID_VOUCHER_CATEGORIES,
  type VoucherCategory,
} from '../finance/paymentVoucherMutationService';

// ───────────────────────────────────────────────────────────────────
// 错误码（全部 fail-closed）
// ───────────────────────────────────────────────────────────────────
export const PAYMENT_REQUEST_ERRORS = {
  MISSING_PAYEE: 'MISSING_PAYEE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  MISSING_CURRENCY: 'MISSING_CURRENCY',
  INVALID_PAYMENT_CATEGORY: 'INVALID_PAYMENT_CATEGORY',
  INVALID_DATE: 'INVALID_DATE',
  PAYMENT_REQUEST_NOT_FOUND: 'PAYMENT_REQUEST_NOT_FOUND',
  PAYMENT_REQUEST_NOT_APPROVED: 'PAYMENT_REQUEST_NOT_APPROVED',
  PAYMENT_REQUEST_NOT_CANCELLABLE: 'PAYMENT_REQUEST_NOT_CANCELLABLE',
  CANCEL_NOT_BY_APPLICANT: 'CANCEL_NOT_BY_APPLICANT',
  VOUCHER_ISSUE_FAILED: 'VOUCHER_ISSUE_FAILED',
  CREATE_FAILED: 'CREATE_FAILED',
  NO_REVIEWER_RESOLVED: 'NO_REVIEWER_RESOLVED',
} as const;

export type PaymentRequestErrorCode = (typeof PAYMENT_REQUEST_ERRORS)[keyof typeof PAYMENT_REQUEST_ERRORS];

export type PaymentRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: PaymentRequestErrorCode | string; message: string; statusCode: number } };

// ───────────────────────────────────────────────────────────────────
// 状态机 & 付款性质枚举
// ───────────────────────────────────────────────────────────────────
export const PAYMENT_REQUEST_STATUSES = [
  'Draft',
  'Pending',
  'Approved',
  'Rejected',
  'VoucherIssued',
  'Cancelled',
] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

/** 付款性质 = PaymentVoucher.voucherCategory 同一枚举真源（normal/advance/deposit/三类费用） */
export const VALID_PAYMENT_CATEGORIES = VALID_VOUCHER_CATEGORIES;
export type PaymentCategory = VoucherCategory;

/** 允许申请人作废的状态（仅 Pending 及之前） */
const CANCELLABLE_STATUSES = new Set<PaymentRequestStatus>(['Draft', 'Pending']);

/** 来源单据类型（关联采购单/订单/费用；schema 无专用列，持久化于 attachments.sourceDocument） */
export const PAYMENT_REQUEST_SOURCE_TYPES = ['purchase_order', 'order', 'expense', 'other'] as const;
export type PaymentRequestSourceType = (typeof PAYMENT_REQUEST_SOURCE_TYPES)[number];

const genId = (prefix: string) =>
  `${prefix}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

function localToday(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function isValidDateString(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isValidDecimal(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    try { return new Prisma.Decimal(v).isFinite(); } catch { return false; }
  }
  return false;
}

function fail<T>(code: string, message: string, statusCode: number): PaymentRequestResult<T> {
  return { ok: false, error: { code, message, statusCode } };
}

// ───────────────────────────────────────────────────────────────────
// 服务工厂
// ───────────────────────────────────────────────────────────────────
export interface PaymentRequestServiceOptions {
  prisma: PrismaClient;
  approvalCreateService: ApprovalCreateService;
}

export interface CreatePaymentRequestInput {
  /** 付款对象：供应商 Relation ID 与名称至少其一必填 */
  supplierId?: string;
  supplierName?: string;
  totalAmount: number | string;
  currency: string;
  /** 付款性质（voucherCategory 六类），缺省 normal */
  paymentCategory?: string;
  requestDate?: string;
  expectedPaymentDate?: string;
  /** 关联来源单据（采购单/订单/费用） */
  sourceType?: PaymentRequestSourceType;
  sourceId?: string;
  remark?: string;
  attachments?: unknown;
  applicantId: string;
  /** 前端越权传入的 reviewerId（将被忽略，仅透传给审批服务做审计标记） */
  clientSuppliedReviewerId?: string | null;
}

export function createPaymentRequestService(opts: PaymentRequestServiceOptions) {
  const { prisma, approvalCreateService } = opts;

  // ── 内部：生成业务申请号 PAYR-YYYYMMDD-xxx ──
  async function nextRequestNumber(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PAYR-${day}-`;
    const count = await prisma.paymentRequest.count({
      where: { requestNumber: { startsWith: prefix } },
    }).catch(() => 0);
    return `${prefix}${String(count + 1).padStart(3, '0')}`;
  }

  // ══════════════════════════════════════════════════════════════════
  // createPaymentRequest — 创建并提交申请（scope 由 route 层守卫）
  //   创建即进入 Pending 并生成 ApprovalRequest（DR-007 组织归属路由）
  // ══════════════════════════════════════════════════════════════════
  async function createPaymentRequest(
    input: CreatePaymentRequestInput,
  ): Promise<PaymentRequestResult<{ paymentRequest: any; approvalRequestId: string }>> {
    const supplierId = (input.supplierId ?? '').trim() || null;
    const supplierName = (input.supplierName ?? '').trim() || null;
    // 1. 付款对象必填（供应商 ID 或名称至少其一）
    if (!supplierId && !supplierName) {
      return fail(PAYMENT_REQUEST_ERRORS.MISSING_PAYEE, '付款对象必填：supplierId 或 supplierName 至少提供其一', 400);
    }
    // 2. 金额必填且 > 0
    if (!isValidDecimal(input.totalAmount)) {
      return fail(PAYMENT_REQUEST_ERRORS.INVALID_AMOUNT, 'totalAmount 必须为合法十进制数', 400);
    }
    const amount = new Prisma.Decimal(input.totalAmount as any);
    if (amount.lte(0)) {
      return fail(PAYMENT_REQUEST_ERRORS.INVALID_AMOUNT, 'totalAmount 必须 > 0', 400);
    }
    // 3. 币种必填
    const currency = (input.currency ?? '').trim();
    if (!currency) {
      return fail(PAYMENT_REQUEST_ERRORS.MISSING_CURRENCY, 'currency 必填', 400);
    }
    // 4. 付款性质枚举校验（fail-closed，缺省 normal）
    const paymentCategory = (input.paymentCategory ?? 'normal').trim() || 'normal';
    if (!(VALID_PAYMENT_CATEGORIES as readonly string[]).includes(paymentCategory)) {
      return fail(
        PAYMENT_REQUEST_ERRORS.INVALID_PAYMENT_CATEGORY,
        `paymentCategory 必须是以下之一: ${VALID_PAYMENT_CATEGORIES.join(', ')}`,
        400,
      );
    }
    // 5. 日期格式校验
    const requestDate = (input.requestDate ?? '').trim() || localToday();
    if (!isValidDateString(requestDate)) {
      return fail(PAYMENT_REQUEST_ERRORS.INVALID_DATE, 'requestDate 必须为 YYYY-MM-DD', 400);
    }
    const expectedPaymentDate = (input.expectedPaymentDate ?? '').trim() || null;
    if (expectedPaymentDate && !isValidDateString(expectedPaymentDate)) {
      return fail(PAYMENT_REQUEST_ERRORS.INVALID_DATE, 'expectedPaymentDate 必须为 YYYY-MM-DD', 400);
    }
    // 6. 来源单据（可选）
    const sourceType = input.sourceType && (PAYMENT_REQUEST_SOURCE_TYPES as readonly string[]).includes(input.sourceType)
      ? input.sourceType
      : null;
    const sourceId = (input.sourceId ?? '').trim() || null;
    const sourceDocument = sourceType && sourceId ? { type: sourceType, id: sourceId } : null;

    const requestNumber = await nextRequestNumber();
    const requestId = genId('PAYR');

    // 7. 审批单创建（DR-007；NO_REVIEWER_RESOLVED 原样透传为 409，fail-closed）
    let approval;
    try {
      approval = await approvalCreateService.createBusinessApproval({
        requesterId: input.applicantId,
        actionType: 'finance:payment_request',
        targetType: 'PaymentRequest',
        targetId: requestId,
        payload: {
          requestNumber,
          supplierId,
          supplierName,
          totalAmount: amount.toString(),
          currency,
          paymentCategory,
          expectedPaymentDate,
          sourceDocument,
        },
        risk: 'high',
        clientSuppliedReviewerId: input.clientSuppliedReviewerId ?? null,
      });
    } catch (e: any) {
      return fail(
        e?.code ?? PAYMENT_REQUEST_ERRORS.CREATE_FAILED,
        e?.message ?? '审批单创建失败',
        e?.code === PAYMENT_REQUEST_ERRORS.NO_REVIEWER_RESOLVED ? 409 : 500,
      );
    }

    // 8. 事务：PaymentRequest 落库（Pending）+ 审计
    const attachments = {
      ...((input.attachments && typeof input.attachments === 'object' ? input.attachments : {}) as Record<string, unknown>),
      ...(sourceDocument ? { sourceDocument } : {}),
    };
    try {
      const paymentRequest = await prisma.$transaction(async (tx: any) => {
        const pr = await tx.paymentRequest.create({
          data: {
            id: requestId,
            requestNumber,
            supplierId,
            supplierName,
            requestDate,
            expectedPaymentDate,
            totalAmount: amount,
            currency,
            applicantId: input.applicantId,
            reviewerId: approval.reviewerId as string,
            status: 'Pending',
            approvalRequestId: approval.id,
            paymentCategory,
            ownerId: input.applicantId,
            remark: (input.remark ?? '').trim() || null,
            attachments: (Object.keys(attachments).length > 0 ? attachments : undefined) as any,
          },
        });
        await writeRouteAuditLog({
          prisma: tx, actorId: input.applicantId, source: 'service:payment-request:create',
          operation: 'payment_request_create', targetType: 'PaymentRequest', targetId: requestId,
          after: { requestNumber, status: 'Pending', paymentCategory, totalAmount: amount.toString(), currency, approvalRequestId: approval.id },
        });
        return pr;
      });
      logger.info('[PaymentRequest] 付款申请已创建', {
        id: requestId, requestNumber, paymentCategory, applicantId: input.applicantId, approvalRequestId: approval.id,
      });
      return { ok: true, data: { paymentRequest, approvalRequestId: approval.id } };
    } catch (e: any) {
      logger.error('[PaymentRequest] 付款申请落库失败', { requestNumber, error: e?.message });
      return fail(PAYMENT_REQUEST_ERRORS.CREATE_FAILED, `付款申请创建事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // issueVoucherForApprovedRequest — 审批通过后生成付款凭证（DR-017 闭环，幂等）
  //   未批准一律 409；已关联凭证时重复调用直接返回既有凭证（防重复生成）
  // ══════════════════════════════════════════════════════════════════
  async function issueVoucherForApprovedRequest(params: {
    paymentRequestId: string;
    actorId: string;
    paymentMethod?: string;
    paymentDate?: string;
  }): Promise<PaymentRequestResult<{ paymentRequest: any; voucher: any; idempotent: boolean }>> {
    const { paymentRequestId, actorId } = params;

    const pr = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    if (!pr || pr.deletedAt) {
      return fail(PAYMENT_REQUEST_ERRORS.PAYMENT_REQUEST_NOT_FOUND, `付款申请 ${paymentRequestId} 不存在或已删除`, 404);
    }
    // 幂等：已生成凭证 → 直接返回既有凭证，不产生二次写入
    if (pr.paymentVoucherId) {
      const existing = await prisma.paymentVoucher.findUnique({ where: { id: pr.paymentVoucherId } }).catch(() => null);
      if (existing) {
        return { ok: true, data: { paymentRequest: pr, voucher: existing, idempotent: true } };
      }
    }
    // DR-017：未批准不得生成付款凭证
    if (pr.status !== 'Approved') {
      return fail(
        PAYMENT_REQUEST_ERRORS.PAYMENT_REQUEST_NOT_APPROVED,
        `付款申请当前状态 ${pr.status}，仅 Approved 可生成付款凭证（DR-017 先申请后付款）`,
        409,
      );
    }

    // 凭证生成走共享 mutation 服务（编号/审计/事件/同步引用统一契约），voucherCategory 一并写入；
    // 携带 paymentRequestId：凭证创建事务内 CAS 回写本申请单（VoucherIssued + paymentVoucherId，DR-017 闭环）
    const created = await createPaymentVoucher({
      prisma,
      input: {
        type: 'Disbursement',
        voucherCategory: pr.paymentCategory,
        amount: pr.totalAmount?.toString?.() ?? pr.totalAmount,
        currency: pr.currency,
        paymentDate: params.paymentDate ?? pr.expectedPaymentDate ?? localToday(),
        paymentMethod: params.paymentMethod ?? 'TT',
        customerRelationId: pr.supplierId ?? undefined,
        customerName: pr.supplierName ?? undefined,
        notes: `付款申请 ${pr.requestNumber}${pr.remark ? `：${pr.remark}` : ''}`,
        paymentRequestId: pr.id,
      },
      actorId,
    });
    if (!created.ok) {
      return fail(
        PAYMENT_REQUEST_ERRORS.VOUCHER_ISSUE_FAILED,
        `付款凭证生成失败: ${created.error.code} ${created.error.message}`,
        500,
      );
    }
    const voucher = created.data.voucher;

    // 回读凭证事务内 CAS 回写后的申请单；并发落败（凭证被其他并发请求关联）时回读既有凭证幂等返回
    try {
      const updated = await prisma.paymentRequest.findUnique({ where: { id: pr.id } });
      if (updated?.paymentVoucherId && updated.paymentVoucherId !== voucher.id) {
        const concurrentVoucher = await prisma.paymentVoucher.findUnique({ where: { id: updated.paymentVoucherId } }).catch(() => null);
        logger.warn('[PaymentRequest] 凭证生成并发竞态，回读既有凭证幂等返回', {
          paymentRequestId: pr.id, orphanVoucherId: voucher.id, existingVoucherId: updated.paymentVoucherId,
        });
        if (concurrentVoucher) {
          return { ok: true, data: { paymentRequest: updated, voucher: concurrentVoucher, idempotent: true } };
        }
      }
      await writeRouteAuditLog({
        prisma, actorId, source: 'service:payment-request:issue-voucher',
        operation: 'payment_request_voucher_issued', targetType: 'PaymentRequest', targetId: pr.id,
        before: { status: 'Approved' },
        after: { status: 'VoucherIssued', paymentVoucherId: voucher.id, voucherNumber: voucher.voucherNumber },
        transactionId: pr.approvalRequestId ?? pr.id,
      });
      logger.info('[PaymentRequest] 付款凭证已生成', {
        paymentRequestId: pr.id, requestNumber: pr.requestNumber, voucherId: voucher.id, voucherNumber: voucher.voucherNumber,
      });
      return { ok: true, data: { paymentRequest: updated, voucher, idempotent: false } };
    } catch (e: any) {
      logger.error('[PaymentRequest] 凭证关联失败', { paymentRequestId: pr.id, voucherId: voucher.id, error: e?.message });
      return fail(PAYMENT_REQUEST_ERRORS.VOUCHER_ISSUE_FAILED, `凭证关联事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // syncApprovalDecision — 审批决定回写（由审批侧回调/轮询驱动）
  //   approved → Approved 并自动生成付款凭证（DR-017 闭环：审批通过事件驱动
  //   issueVoucherForApprovedRequest，幂等防重）；rejected → Rejected；pending → 无操作
  // ══════════════════════════════════════════════════════════════════
  async function syncApprovalDecision(params: {
    paymentRequestId: string;
    actorId: string;
  }): Promise<PaymentRequestResult<{ paymentRequest: any; synced: boolean; voucher?: any }>> {
    const { paymentRequestId, actorId } = params;
    const pr = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    if (!pr || pr.deletedAt) {
      return fail(PAYMENT_REQUEST_ERRORS.PAYMENT_REQUEST_NOT_FOUND, `付款申请 ${paymentRequestId} 不存在或已删除`, 404);
    }
    if (pr.status !== 'Pending' || !pr.approvalRequestId) {
      return { ok: true, data: { paymentRequest: pr, synced: false } };
    }
    const approval = await prisma.approvalRequest.findUnique({ where: { id: pr.approvalRequestId } }).catch(() => null);
    if (!approval || approval.status === 'pending') {
      return { ok: true, data: { paymentRequest: pr, synced: false } };
    }
    const nextStatus: PaymentRequestStatus = approval.status === 'approved' ? 'Approved' : 'Rejected';
    const updated = await prisma.$transaction(async (tx: any) => {
      const next = await tx.paymentRequest.update({ where: { id: pr.id }, data: { status: nextStatus } });
      await writeRouteAuditLog({
        prisma: tx, actorId, source: 'service:payment-request:sync-decision',
        operation: 'payment_request_decision', targetType: 'PaymentRequest', targetId: pr.id,
        before: { status: 'Pending' },
        after: { status: nextStatus, approvalStatus: approval.status },
        transactionId: pr.approvalRequestId,
      });
      return next;
    });
    logger.info('[PaymentRequest] 审批决定已回写', { paymentRequestId: pr.id, status: nextStatus });
    // DR-017 闭环（DE-3）：审批通过 → 自动生成付款凭证。
    // 失败不回滚审批回写（审批结论是真源），记录错误供重试（POST /:id/issue-voucher 手动触发兜底）。
    if (nextStatus === 'Approved') {
      const issued = await issueVoucherForApprovedRequest({ paymentRequestId: pr.id, actorId });
      if (!issued.ok) {
        logger.error('[PaymentRequest] 审批通过后自动发凭证失败（可经 issue-voucher 端点重试）', {
          paymentRequestId: pr.id, error: issued.error.code, message: issued.error.message,
        });
        return { ok: true, data: { paymentRequest: updated, synced: true } };
      }
      return { ok: true, data: { paymentRequest: issued.data.paymentRequest, synced: true, voucher: issued.data.voucher } };
    }
    return { ok: true, data: { paymentRequest: updated, synced: true } };
  }

  // ══════════════════════════════════════════════════════════════════
  // cancelPaymentRequest — 申请人作废（仅 Draft/Pending，仅本人）
  // ══════════════════════════════════════════════════════════════════
  async function cancelPaymentRequest(params: {
    paymentRequestId: string;
    actorId: string;
  }): Promise<PaymentRequestResult<{ paymentRequest: any }>> {
    const { paymentRequestId, actorId } = params;
    const pr = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    if (!pr || pr.deletedAt) {
      return fail(PAYMENT_REQUEST_ERRORS.PAYMENT_REQUEST_NOT_FOUND, `付款申请 ${paymentRequestId} 不存在或已删除`, 404);
    }
    if (!CANCELLABLE_STATUSES.has(pr.status as PaymentRequestStatus)) {
      return fail(
        PAYMENT_REQUEST_ERRORS.PAYMENT_REQUEST_NOT_CANCELLABLE,
        `付款申请当前状态 ${pr.status}，仅 Draft/Pending 可作废`,
        409,
      );
    }
    if (pr.applicantId !== actorId) {
      return fail(PAYMENT_REQUEST_ERRORS.CANCEL_NOT_BY_APPLICANT, '仅申请人本人可作废付款申请', 403);
    }
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const next = await tx.paymentRequest.update({ where: { id: pr.id }, data: { status: 'Cancelled' } });
        // 关联审批单仍在 pending → 一并撤回，防止审批人继续处理已作废申请
        if (pr.approvalRequestId) {
          await tx.approvalRequest.updateMany({
            where: { id: pr.approvalRequestId, status: 'pending' },
            data: { status: 'cancelled', decidedAt: new Date(), decisionNote: `付款申请 ${pr.requestNumber} 已被申请人作废` },
          });
        }
        await writeRouteAuditLog({
          prisma: tx, actorId, source: 'service:payment-request:cancel',
          operation: 'payment_request_cancel', targetType: 'PaymentRequest', targetId: pr.id,
          before: { status: pr.status },
          after: { status: 'Cancelled' },
        });
        return next;
      });
      logger.info('[PaymentRequest] 付款申请已作废', { paymentRequestId, actorId });
      return { ok: true, data: { paymentRequest: updated } };
    } catch (e: any) {
      logger.error('[PaymentRequest] 作废失败', { paymentRequestId, error: e?.message });
      return fail(PAYMENT_REQUEST_ERRORS.CREATE_FAILED, `作废事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // listPaymentRequests / getPaymentRequest — 只读查询（与 paymentRequestRoute GET 同一合约真源）
  //   Agent 只读工具与路由共用本入口；纯查询，不触发审批链、不写库
  // ══════════════════════════════════════════════════════════════════
  async function listPaymentRequests(filter: {
    status?: string;
    paymentCategory?: string;
    applicantId?: string;
    limit?: number;
  }): Promise<{ items: any[] }> {
    const where: any = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.paymentCategory) where.paymentCategory = filter.paymentCategory;
    if (filter.applicantId) where.applicantId = filter.applicantId;
    const items = await prisma.paymentRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
    return { items };
  }

  async function getPaymentRequest(id: string): Promise<{ item: any | null }> {
    const item = await prisma.paymentRequest.findUnique({ where: { id } });
    if (!item || item.deletedAt) return { item: null };
    // 关联数据单独查询（PaymentRequest 模型无 @relation，禁用 include）
    const [approvalRequest, paymentVoucher] = await Promise.all([
      item.approvalRequestId
        ? prisma.approvalRequest.findUnique({
            where: { id: item.approvalRequestId },
            select: { id: true, status: true, reviewerId: true, decidedAt: true, decisionNote: true },
          }).catch(() => null)
        : Promise.resolve(null),
      item.paymentVoucherId
        ? prisma.paymentVoucher.findUnique({
            where: { id: item.paymentVoucherId },
            select: { id: true, voucherNumber: true, type: true, voucherCategory: true, amount: true, currency: true, status: true },
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { item: { ...item, approvalRequest, paymentVoucher } };
  }

  return {
    createPaymentRequest,
    issueVoucherForApprovedRequest,
    syncApprovalDecision,
    cancelPaymentRequest,
    listPaymentRequests,
    getPaymentRequest,
  };
}

export type PaymentRequestService = ReturnType<typeof createPaymentRequestService>;
