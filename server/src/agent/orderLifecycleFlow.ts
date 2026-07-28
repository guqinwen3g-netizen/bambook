/**
 * Agent-P1-order-lifecycle-flow-contract
 *
 * order.status_transition / order.delete draft→approval→commit 流程契约。
 * 复用 orderLifecycleService（route + Agent flow 共用契约），不在 Agent path 手写 DB mutation。
 * ProcessDraft what-you-approve-is-what-you-commit。
 */

import { PrismaClient } from '@prisma/client';
import {
  deleteOrder,
  transitionOrderStatus,
  VALID_ORDER_STATUSES,
  type OrderLifecycleErrorCode,
} from '../orders/orderLifecycleService';
import {
  computeProcessDraftHash,
  type ProcessDraft,
  type SubOperation,
} from './toolRegistry';

export type OrderLifecycleFlowErrorCode =
  | 'APPROVAL_ID_MISSING'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_MODIFIED_UNSUPPORTED'
  | 'PROCESS_DRAFT_MISSING'
  | 'PROCESS_DRAFT_HASH_MISMATCH'
  | 'SEMANTIC_VALIDATION_FAILED'
  | OrderLifecycleErrorCode
  | 'UNKNOWN_ERROR';

export interface OrderLifecycleFlowError {
  code: OrderLifecycleFlowErrorCode;
  message: string;
  userAction: string;
}

export interface OrderLifecycleFlowCommitted {
  status: 'committed';
  orderId: string;
  auditId: string;
  idempotencyKey: string;
}

export type OrderLifecycleFlowFeedback =
  | { status: 'approval_required'; approvalId: string; processDraft: ProcessDraft; message: string }
  | OrderLifecycleFlowCommitted
  | { status: 'failed'; error: OrderLifecycleFlowError; approvalId?: string };

export function buildOrderLifecycleError(code: OrderLifecycleFlowErrorCode, message: string): OrderLifecycleFlowError {
  const userActionMap: Record<OrderLifecycleFlowErrorCode, string> = {
    APPROVAL_ID_MISSING: '审批恢复执行必须携带 approvalId，请重新发起审批流程',
    APPROVAL_NOT_FOUND: '审批记录不存在或未通过，请重新审批',
    APPROVAL_MODIFIED_UNSUPPORTED: '审批内容被修改，不支持直接 commit，请重新生成 draft 并重新审批',
    PROCESS_DRAFT_MISSING: '请重新发起流程，确保 draft payload 完整',
    PROCESS_DRAFT_HASH_MISMATCH: '审批内容与 draft 不一致，请重新发起',
    SEMANTIC_VALIDATION_FAILED: 'draft 语义校验失败，请检查 orderId/toStatus',
    ORDER_NOT_FOUND: '订单不存在或已删除',
    ORDER_ALREADY_DELETED: '订单已删除，无需重复删除',
    INVALID_STATUS: '目标状态非法（只允许 Pending/Confirmed/Production/Shipping/Delivered/Alert）',
    NO_CHANGE: '订单已在目标状态，无需流转',
    DELETE_FAILED: '删除事务失败已回滚，请重试',
    TRANSITION_FAILED: '状态流转事务失败已回滚，请重试',
    UNKNOWN_ERROR: '未知错误，请联系管理员',
  };
  return { code, message, userAction: userActionMap[code] };
}

// ────────────────────────────────────────────────────────────────
// order.status_transition draft
// ────────────────────────────────────────────────────────────────

export interface OrderStatusTransitionDraftInput {
  orderId: string;
  toStatus: string;
  currentStatus?: string; // 从真实 order 读
  note?: string;
  lineId?: string;
}

export function buildOrderStatusTransitionDraft(input: OrderStatusTransitionDraftInput): ProcessDraft {
  const { orderId, toStatus, currentStatus, note, lineId } = input;
  const afterPayload: Record<string, any> = { orderId, toStatus };
  if (note !== undefined) afterPayload.note = note;
  if (lineId !== undefined) afterPayload.lineId = lineId;

  const subOperations: SubOperation[] = [{
    toolId: 'order.status_transition',
    entityId: orderId,
    action: 'transition_order_status',
    before: {},
    after: afterPayload,
  }];

  const beforeAfterDiff = [{
    entity: 'order',
    entityId: orderId,
    field: 'status',
    before: (currentStatus || 'unknown') as any,
    after: toStatus as any,
  }];

  const content = {
    subOperations,
    beforeAfterDiff,
    impactScope: ['orders'],
    irreversible: true,
    postCommitHooks: [] as any[],
  };
  const hash = computeProcessDraftHash(content);
  const idempotencyKey = `order.status_transition:${orderId}:${toStatus}:${hash}`;

  return { ...content, idempotencyKey };
}

export function validateOrderStatusTransitionDraftSemantics(draft: any): { ok: boolean; error?: OrderLifecycleFlowError } {
  if (!draft.subOperations || draft.subOperations.length === 0) {
    return { ok: false, error: buildOrderLifecycleError('SEMANTIC_VALIDATION_FAILED', 'draft must contain at least one subOperation') };
  }
  const after = draft.subOperations[0].after as any;
  if (!after?.orderId) {
    return { ok: false, error: buildOrderLifecycleError('SEMANTIC_VALIDATION_FAILED', 'draft must contain orderId') };
  }
  if (!after?.toStatus) {
    return { ok: false, error: buildOrderLifecycleError('SEMANTIC_VALIDATION_FAILED', 'draft must contain toStatus') };
  }
  if (!VALID_ORDER_STATUSES.includes(after.toStatus)) {
    return { ok: false, error: buildOrderLifecycleError('INVALID_STATUS', `Invalid toStatus: ${after.toStatus}`) };
  }
  return { ok: true };
}

export async function commitOrderStatusTransition(
  params: { prisma: PrismaClient; approvalId: string; approvalPayload: any },
): Promise<{ ok: true; feedback: OrderLifecycleFlowCommitted } | { ok: false; feedback: { status: 'failed'; error: OrderLifecycleFlowError; approvalId?: string } }> {
  const { prisma, approvalId, approvalPayload } = params;
  const draft: any = approvalPayload?.processDraft;
  if (!draft) {
    return { ok: false, feedback: { status: 'failed', error: buildOrderLifecycleError('PROCESS_DRAFT_MISSING', 'processDraft not found'), approvalId } };
  }
  const { idempotencyKey, ...content } = draft;
  const recomputedHash = computeProcessDraftHash(content);
  const actualHashPart = idempotencyKey.includes(':pd:') ? 'pd:' + idempotencyKey.split(':pd:')[1] : idempotencyKey.split(':').slice(-1)[0];
  if (recomputedHash !== actualHashPart) {
    return { ok: false, feedback: { status: 'failed', error: buildOrderLifecycleError('PROCESS_DRAFT_HASH_MISMATCH', `hash mismatch: expected=${recomputedHash} actual=${actualHashPart}`), approvalId } };
  }
  const semCheck = validateOrderStatusTransitionDraftSemantics(draft);
  if (!semCheck.ok) {
    return { ok: false, feedback: { status: 'failed', error: semCheck.error!, approvalId } };
  }
  const after = draft.subOperations[0].after as any;
  const result = await transitionOrderStatus({
    prisma, orderId: after.orderId, toStatus: after.toStatus,
    note: after.note, lineId: after.lineId, actorId: 'agent',
  });
  if (!result.ok) {
    return { ok: false, feedback: { status: 'failed', error: buildOrderLifecycleError(result.error!.code as OrderLifecycleFlowErrorCode, result.error!.message), approvalId } };
  }
  return { ok: true, feedback: { status: 'committed', orderId: result.data!.order.id, auditId: result.data!.auditId, idempotencyKey: draft.idempotencyKey } };
}

// ────────────────────────────────────────────────────────────────
// order.delete draft
// ────────────────────────────────────────────────────────────────

export interface OrderDeleteDraftInput {
  orderId: string;
}

export function buildOrderDeleteDraft(input: OrderDeleteDraftInput): ProcessDraft {
  const { orderId } = input;
  const subOperations: SubOperation[] = [{
    toolId: 'order.delete',
    entityId: orderId,
    action: 'delete_order',
    before: {},
    after: { orderId },
  }];
  const beforeAfterDiff = [{
    entity: 'order',
    entityId: orderId,
    field: 'deletedAt',
    before: null,
    after: true as any,
  }];
  const content = {
    subOperations,
    beforeAfterDiff,
    impactScope: ['orders'],
    irreversible: true,
    postCommitHooks: [] as any[],
  };
  const hash = computeProcessDraftHash(content);
  const idempotencyKey = `order.delete:${orderId}:${hash}`;
  return { ...content, idempotencyKey };
}

export function validateOrderDeleteDraftSemantics(draft: any): { ok: boolean; error?: OrderLifecycleFlowError } {
  if (!draft.subOperations || draft.subOperations.length === 0) {
    return { ok: false, error: buildOrderLifecycleError('SEMANTIC_VALIDATION_FAILED', 'draft must contain at least one subOperation') };
  }
  const after = draft.subOperations[0].after as any;
  if (!after?.orderId) {
    return { ok: false, error: buildOrderLifecycleError('SEMANTIC_VALIDATION_FAILED', 'draft must contain orderId') };
  }
  return { ok: true };
}

export async function commitOrderDelete(
  params: { prisma: PrismaClient; approvalId: string; approvalPayload: any },
): Promise<{ ok: true; feedback: OrderLifecycleFlowCommitted } | { ok: false; feedback: { status: 'failed'; error: OrderLifecycleFlowError; approvalId?: string } }> {
  const { prisma, approvalId, approvalPayload } = params;
  const draft: any = approvalPayload?.processDraft;
  if (!draft) {
    return { ok: false, feedback: { status: 'failed', error: buildOrderLifecycleError('PROCESS_DRAFT_MISSING', 'processDraft not found'), approvalId } };
  }
  const { idempotencyKey, ...content } = draft;
  const recomputedHash = computeProcessDraftHash(content);
  const actualHashPart = idempotencyKey.includes(':pd:') ? 'pd:' + idempotencyKey.split(':pd:')[1] : idempotencyKey.split(':').slice(-1)[0];
  if (recomputedHash !== actualHashPart) {
    return { ok: false, feedback: { status: 'failed', error: buildOrderLifecycleError('PROCESS_DRAFT_HASH_MISMATCH', `hash mismatch: expected=${recomputedHash} actual=${actualHashPart}`), approvalId } };
  }
  const semCheck = validateOrderDeleteDraftSemantics(draft);
  if (!semCheck.ok) {
    return { ok: false, feedback: { status: 'failed', error: semCheck.error!, approvalId } };
  }
  const after = draft.subOperations[0].after as any;
  const result = await deleteOrder({ prisma, orderId: after.orderId, actorId: 'agent' });
  if (!result.ok) {
    return { ok: false, feedback: { status: 'failed', error: buildOrderLifecycleError(result.error!.code as OrderLifecycleFlowErrorCode, result.error!.message), approvalId } };
  }
  return { ok: true, feedback: { status: 'committed', orderId: after.orderId, auditId: result.data!.auditId, idempotencyKey: draft.idempotencyKey } };
}
