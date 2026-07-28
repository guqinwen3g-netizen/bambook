/**
 * Agent-P1-email-send-outbox-flow-contract
 *
 * email.send draft→approval→commit 消费已 merged 的 Outbox send service。
 * draft 只引用/选择已有 outbound Outbox Email（emailId），不重新构造任意邮件体。
 * commit 调用 sendOutboxEmail（共用 Outbox send service 契约），不绕过 DB 事实源，不直接 nodemailer。
 * what-you-approve-is-what-you-commit：commit 从 subOperations.after 恢复 emailId。
 */

import { PrismaClient } from '@prisma/client';
import { sendOutboxEmail } from '../email/outboxSend';
import {
  computeProcessDraftHash,
  type ProcessDraft,
  type SubOperation,
} from './toolRegistry';

export type EmailSendOutboxErrorCode =
  | 'APPROVAL_ID_MISSING'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_MODIFIED_UNSUPPORTED'
  | 'PROCESS_DRAFT_MISSING'
  | 'PROCESS_DRAFT_HASH_MISMATCH'
  | 'SEMANTIC_VALIDATION_FAILED'
  | 'EMAIL_NOT_FOUND'
  | 'EMAIL_NOT_OUTBOUND'
  | 'EMAIL_NOT_OUTBOX'
  | 'EMAIL_ALREADY_SENT'
  | 'MISSING_RECIPIENT'
  | 'MISSING_CREDENTIALS'
  | 'SMTP_SEND_FAILED'
  | 'SMTP_MESSAGE_ID_MISSING'
  | 'DB_UPDATE_FAILED'
  | 'UNKNOWN_ERROR';

export interface EmailSendOutboxError {
  code: EmailSendOutboxErrorCode;
  message: string;
  userAction: string;
}

export interface EmailSendOutboxCommitted {
  status: 'committed';
  emailId: string;
  messageId: string;
  sentAt: string;
  auditId: string;
  idempotencyKey: string;
}

export type EmailSendOutboxFeedback =
  | { status: 'approval_required'; approvalId: string; processDraft: ProcessDraft; message: string }
  | EmailSendOutboxCommitted
  | { status: 'failed'; error: EmailSendOutboxError; approvalId?: string };

export function buildEmailSendOutboxError(code: EmailSendOutboxErrorCode, message: string): EmailSendOutboxError {
  const userActionMap: Record<EmailSendOutboxErrorCode, string> = {
    APPROVAL_ID_MISSING: '审批恢复执行必须携带 approvalId，请重新发起审批流程',
    APPROVAL_NOT_FOUND: '审批记录不存在或未通过，请重新审批',
    APPROVAL_MODIFIED_UNSUPPORTED: '审批内容被修改，不支持直接 commit，请重新生成 draft 并重新审批',
    PROCESS_DRAFT_MISSING: '请重新发起发送流程，确保 draft payload 完整',
    PROCESS_DRAFT_HASH_MISMATCH: '审批内容与 draft 不一致，请重新发起',
    SEMANTIC_VALIDATION_FAILED: '发送 draft 语义校验失败，请检查 emailId',
    EMAIL_NOT_FOUND: 'Outbox 邮件不存在，请检查 emailId',
    EMAIL_NOT_OUTBOUND: '邮件方向非 outbound，不可发送',
    EMAIL_NOT_OUTBOX: '邮件不在 Outbox，不可发送',
    EMAIL_ALREADY_SENT: '邮件已发送，无需重复发送',
    MISSING_RECIPIENT: '邮件无有效收件人',
    MISSING_CREDENTIALS: 'SMTP 凭据缺失（user/pass）',
    SMTP_SEND_FAILED: 'SMTP 发送失败，邮件保持 Outbox，请稍后重试',
    SMTP_MESSAGE_ID_MISSING: 'SMTP 发送完成但未返回 messageId，请检查 SMTP 服务',
    DB_UPDATE_FAILED: 'SMTP 已发送但 DB 更新失败，请联系管理员核对',
    UNKNOWN_ERROR: '未知错误，请联系管理员',
  };
  return { code, message, userAction: userActionMap[code] };
}

export interface EmailSendOutboxDraftInput {
  emailId: string;
  credentials: {
    user: string;
    pass: string;
    host?: string;
    port?: number;
  };
}

/**
 * draft 只引用已有 Outbox Email（emailId），不重新构造邮件体。
 * credentials 编码进 subOperations.after（what-you-approve-is-what-you-commit）。
 */
export function buildEmailSendOutboxDraft(input: EmailSendOutboxDraftInput): ProcessDraft {
  const { emailId, credentials } = input;
  const afterPayload = {
    emailId,
    credentialsUser: credentials.user,
    credentialsHost: credentials.host || 'smtp.qiye.aliyun.com',
    credentialsPort: credentials.port || 465,
  };

  const subOperations: SubOperation[] = [{
    toolId: 'email.send',
    entityId: emailId,
    action: 'send_outbox_email',
    before: { emailId, mailbox: 'Outbox' },
    after: afterPayload,
  }];

  const beforeAfterDiff = [{
    entity: 'emails',
    entityId: emailId,
    field: 'mailbox',
    before: 'Outbox' as any,
    after: 'Sent' as any,
  }];

  const content = {
    subOperations,
    beforeAfterDiff,
    impactScope: ['emails'],
    irreversible: true,
    postCommitHooks: [] as any[],
  };
  const hash = computeProcessDraftHash(content);
  const idempotencyKey = `email.send:${emailId}:${hash}`;

  return { ...content, idempotencyKey };
}

export function validateEmailSendOutboxDraftSemantics(draft: any): { ok: boolean; error?: EmailSendOutboxError } {
  if (!draft.subOperations || draft.subOperations.length === 0) {
    return { ok: false, error: buildEmailSendOutboxError('SEMANTIC_VALIDATION_FAILED', 'draft must contain at least one subOperation') };
  }
  const after = draft.subOperations[0].after as any;
  if (!after?.emailId) {
    return { ok: false, error: buildEmailSendOutboxError('SEMANTIC_VALIDATION_FAILED', 'draft must contain emailId in subOperations.after') };
  }
  if (!after?.credentialsUser) {
    return { ok: false, error: buildEmailSendOutboxError('MISSING_CREDENTIALS', 'draft must contain credentials.user in subOperations.after') };
  }
  return { ok: true };
}

export function verifyEmailSendOutboxDraftHash(draft: ProcessDraft): { ok: boolean; expected: string; actual: string } {
  const { idempotencyKey, ...content } = draft;
  const recomputedHash = computeProcessDraftHash(content);
  const actualHashPart = idempotencyKey.includes(':pd:')
    ? 'pd:' + idempotencyKey.split(':pd:')[1]
    : idempotencyKey;
  return { ok: recomputedHash === actualHashPart, expected: recomputedHash, actual: actualHashPart };
}

export interface EmailSendOutboxCommitParams {
  prisma: PrismaClient;
  approvalId: string;
  approvalPayload: any;
  // 凭据从 ApprovalRequest payload 恢复时需 password（draft 只存 user，password 在 commit 时从 approvalPayload 取或外部注入）
  credentialsPassword?: string;
}

/**
 * commit 调用 sendOutboxEmail（共用 Outbox send service），不绕过 DB 事实源，不直接 nodemailer。
 */
export async function commitEmailSendOutbox(
  params: EmailSendOutboxCommitParams,
): Promise<{ ok: true; feedback: EmailSendOutboxCommitted } | { ok: false; feedback: { status: 'failed'; error: EmailSendOutboxError; approvalId?: string } }> {
  const { prisma, approvalId, approvalPayload, credentialsPassword } = params;

  const draft: any = approvalPayload?.processDraft;
  if (!draft) {
    return { ok: false, feedback: { status: 'failed', error: buildEmailSendOutboxError('PROCESS_DRAFT_MISSING', 'processDraft not found in approval payload'), approvalId } };
  }

  const hashCheck = verifyEmailSendOutboxDraftHash(draft);
  if (!hashCheck.ok) {
    return { ok: false, feedback: { status: 'failed', error: buildEmailSendOutboxError('PROCESS_DRAFT_HASH_MISMATCH', `hash mismatch: expected=${hashCheck.expected} actual=${hashCheck.actual}`), approvalId } };
  }

  const semCheck = validateEmailSendOutboxDraftSemantics(draft);
  if (!semCheck.ok) {
    return { ok: false, feedback: { status: 'failed', error: semCheck.error!, approvalId } };
  }

  const after = draft.subOperations[0].after as any;
  const emailId = after.emailId;
  const password = credentialsPassword || approvalPayload?.credentialsPassword;

  // 调用共用 sendOutboxEmail（不绕 DB，不直接 nodemailer）
  const result = await sendOutboxEmail({
    prisma,
    emailId,
    credentials: {
      user: after.credentialsUser,
      pass: password || '',
      host: after.credentialsHost,
      port: after.credentialsPort,
    },
    actorId: 'agent',
  });

  if (!result.ok) {
    return { ok: false, feedback: { status: 'failed', error: buildEmailSendOutboxError(result.error!.code as EmailSendOutboxErrorCode, result.error!.message), approvalId } };
  }

  return {
    ok: true,
    feedback: {
      status: 'committed',
      emailId: result.data!.emailId,
      messageId: result.data!.messageId,
      sentAt: result.data!.sentAt,
      auditId: result.data!.auditId,
      idempotencyKey: draft.idempotencyKey,
    },
  };
}
