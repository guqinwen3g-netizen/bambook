/**
 * P1-C-backend: order.confirm result feedback contract
 *
 * 定义 order.confirm 工具运行后的统一反馈结构，供 agentLoop tool_call_end/block_patch
 * 携带结构化 outputPreview/errorPreview，前端审批卡 + 结果展示消费。
 *
 * 三态：approval_required / committed / failed
 * scope: 不含 email/postCommitHook（P1-A 基准保持）
 */

import type { ProcessDraft } from './toolRegistry';

/** fail-closed 稳定错误码（业务语义，不随实现变化） */
export type OrderConfirmErrorCode =
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_MODIFIED_UNSUPPORTED'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_ID_MISSING'
  | 'PROCESS_DRAFT_MISSING'
  | 'PROCESS_DRAFT_HASH_MISMATCH'
  | 'SEMANTIC_VALIDATION_FAILED'
  | 'PRECONDITIONS_FAILED'
  | 'ORDER_NOT_FOUND'
  | 'STATUS_DRIFT'
  | 'INVOICE_AMOUNT_INVALID'
  | 'INVOICE_CURRENCY_MISSING'
  | 'COMMIT_TRANSACTION_FAILED'
  | 'UNKNOWN_ERROR';

/** fail-closed 结构化错误（稳定 code + message + userAction） */
export interface OrderConfirmError {
  code: OrderConfirmErrorCode;
  message: string;
  userAction: string;
  details?: string[];
}

/** entity link 写入记录（commit 成功时返回） */
export interface EntityLinkRecord {
  linkKind: 'aboutOrder' | 'billTo';
  fromType: 'invoice';
  fromId: string;
  toType: 'order' | 'relation.organization';
  toId: string;
}

/** commit 成功结构化字段 */
export interface OrderConfirmCommitted {
  status: 'committed';
  orderId: string;
  poNumber: string;
  previousStatus: string;
  newStatus: string;
  transactionId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  customerRelationId: string;
  customerName: string;
  auditId: string;
  idempotencyKey: string;
  entityLinks: EntityLinkRecord[];
  approvalId: string;
  subOperationsSummary: string[];
  impactScope: string[];
}

/** approval_required 结构化字段 */
export interface OrderConfirmApprovalRequired {
  status: 'approval_required';
  approvalId: string;
  processDraft: ProcessDraft;
  message: string;
  editableFields?: string[];
}

/** 统一 feedback contract（三态联合类型） */
export type OrderConfirmFeedback =
  | OrderConfirmApprovalRequired
  | OrderConfirmCommitted
  | { status: 'failed'; error: OrderConfirmError; approvalId?: string };

/** 把内部错误字符串解析为稳定 OrderConfirmErrorCode */
export function parseErrorCode(errorStr: string): OrderConfirmErrorCode {
  const s = errorStr || '';
  if (s.includes('does not support modified')) return 'APPROVAL_MODIFIED_UNSUPPORTED';
  if (s.includes('not approved') && s.includes('rejected')) return 'APPROVAL_REJECTED';
  if (s.includes('not found or not approved')) return 'APPROVAL_NOT_FOUND';
  if (s.includes('approvalId not provided')) return 'APPROVAL_ID_MISSING';
  if (s.includes('no approved process draft')) return 'PROCESS_DRAFT_MISSING';
  if (s.includes('hash mismatch')) return 'PROCESS_DRAFT_HASH_MISMATCH';
  if (s.includes('semantic validation failed')) return 'SEMANTIC_VALIDATION_FAILED';
  if (s.includes('PRECONDITIONS_FAILED') || s.includes('preconditions')) return 'PRECONDITIONS_FAILED';
  if (s.includes('ORDER_NOT_FOUND')) return 'ORDER_NOT_FOUND';
  if (s.includes('STATUS_DRIFT')) return 'STATUS_DRIFT';
  if (s.includes('INVOICE_AMOUNT_INVALID') || s.includes('INVOICE_AMOUNT')) return 'INVOICE_AMOUNT_INVALID';
  if (s.includes('INVOICE_CURRENCY_MISSING')) return 'INVOICE_CURRENCY_MISSING';
  if (s.includes('COMMIT_TRANSACTION_FAILED') || s.includes('COMMIT_FAILED')) return 'COMMIT_TRANSACTION_FAILED';
  return 'UNKNOWN_ERROR';
}

/** 根据 code 生成 userAction 指引 */
export function userActionForCode(code: OrderConfirmErrorCode): string {
  const map: Record<OrderConfirmErrorCode, string> = {
    APPROVAL_REJECTED: '审批已被拒绝，无法执行 order.confirm，请确认是否需要重新发起审批。',
    APPROVAL_MODIFIED_UNSUPPORTED: '当前不支持 modified 审批，请重新生成 ProcessDraft 并重新审批。',
    APPROVAL_NOT_FOUND: '找不到对应的审批记录，请确认 approvalId 是否正确，或重新发起审批。',
    APPROVAL_ID_MISSING: '审批通过后重跑必须携带 approvalId，请联系管理员检查 agentLoop 契约。',
    PROCESS_DRAFT_MISSING: '审批 payload 缺少 ProcessDraft，请重新发起 order.confirm 生成 draft。',
    PROCESS_DRAFT_HASH_MISMATCH: 'ProcessDraft 与审批时不一致（可能被篡改），请重新发起审批。',
    SEMANTIC_VALIDATION_FAILED: 'ProcessDraft 业务语义校验失败，请检查订单状态/发票字段是否完整。',
    PRECONDITIONS_FAILED: '订单不满足确认前置条件（需 Pending 状态、客户关系、订单行、有效金额）。',
    ORDER_NOT_FOUND: '订单不存在或已删除，请确认 poNumber 是否正确。',
    STATUS_DRIFT: '订单状态已被并发修改，请刷新订单状态后重新确认。',
    INVOICE_AMOUNT_INVALID: '发票金额无效（必须 > 0），请检查订单 totalActual/totalNet/quoteAmount。',
    INVOICE_CURRENCY_MISSING: '发票币种缺失，请检查订单 salesCurrency/currency 字段。',
    COMMIT_TRANSACTION_FAILED: '事务提交失败（数据库错误），请稍后重试或联系管理员。',
    UNKNOWN_ERROR: '未知错误，请联系管理员查看日志。',
  };
  return map[code];
}

/** 构造 fail-closed OrderConfirmError */
export function buildOrderConfirmError(errorStr: string, details?: string[]): OrderConfirmError {
  const code = parseErrorCode(errorStr);
  return {
    code,
    message: errorStr,
    userAction: userActionForCode(code),
    details,
  };
}
