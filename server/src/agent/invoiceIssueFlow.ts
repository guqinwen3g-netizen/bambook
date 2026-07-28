/**
 * Agent-P1-invoice-issue-flow-contract
 *
 * invoice.issue draft→approval→commit 最小闭环契约。
 * commit 事务内创建 Invoice(status=Issued) + syncInvoiceReferences + writeRouteAuditLog。
 * 复用 validateStatusTransition(Draft→Issued) + syncInvoiceReferences + writeRouteAuditLog。
 * 不 SMTP 发送；Outbox email 待发作为 postCommitHooks 排除（空），留给后续任务。
 * what-you-approve-is-what-you-commit：commit 从 subOperations.after 恢复。
 */

import { PrismaClient } from '@prisma/client';
import { syncInvoiceReferences } from '../entities/sync';
import { validateStatusTransition } from '../statusTransition';
import { writeRouteAuditLog } from '../audit/routeAudit';
import {
  computeProcessDraftHash,
  type ProcessDraft,
  type SubOperation,
} from './toolRegistry';

export type InvoiceIssueErrorCode =
  | 'APPROVAL_ID_MISSING'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_MODIFIED_UNSUPPORTED'
  | 'PROCESS_DRAFT_MISSING'
  | 'PROCESS_DRAFT_HASH_MISMATCH'
  | 'SEMANTIC_VALIDATION_FAILED'
  | 'INVALID_TRANSITION'
  | 'INVALID_AMOUNT'
  | 'COMMIT_TRANSACTION_FAILED'
  | 'UNKNOWN_ERROR';

export interface InvoiceIssueError {
  code: InvoiceIssueErrorCode;
  message: string;
  userAction: string;
  details?: string[];
}

export interface InvoiceIssueCommitted {
  status: 'committed';
  invoiceId: string;
  invoiceStatus: string;
  transactionId: string;
  auditId: string;
  idempotencyKey: string;
}

export type InvoiceIssueFeedback =
  | { status: 'approval_required'; approvalId: string; processDraft: ProcessDraft; message: string }
  | InvoiceIssueCommitted
  | { status: 'failed'; error: InvoiceIssueError; approvalId?: string };

export function buildInvoiceIssueError(code: InvoiceIssueErrorCode, message: string, details?: string[]): InvoiceIssueError {
  const userActionMap: Record<InvoiceIssueErrorCode, string> = {
    APPROVAL_ID_MISSING: '审批恢复执行必须携带 approvalId，请重新发起审批流程',
    APPROVAL_NOT_FOUND: '审批记录不存在或未通过，请重新审批',
    APPROVAL_MODIFIED_UNSUPPORTED: '审批内容被修改，不支持直接 commit，请重新生成 draft 并重新审批',
    PROCESS_DRAFT_MISSING: '请重新发起开票流程，确保 draft payload 完整',
    PROCESS_DRAFT_HASH_MISMATCH: '审批内容与 draft 不一致，请重新发起',
    SEMANTIC_VALIDATION_FAILED: '开票 draft 语义校验失败，请检查发票字段',
    INVALID_TRANSITION: '发票状态转移不合法（issue 要求 Draft→Issued）',
    INVALID_AMOUNT: '发票金额必须为正数',
    COMMIT_TRANSACTION_FAILED: '事务失败已回滚，请重试',
    UNKNOWN_ERROR: '未知错误，请联系管理员',
  };
  return { code, message, userAction: userActionMap[code], details };
}

export interface InvoiceIssueDraftInput {
  invoiceId?: string;
  invoiceNumber: string;
  type?: string;
  amount: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string;
  customerRelationId?: string;
  customerName?: string;
  orderId?: string;
  notes?: string;
  // Outbox email 待发（contract 边界：不 SMTP，写 mailbox=Outbox + sentAt=null + messageId=null）
  email?: {
    to: string[];
    subject: string;
    bodyText: string;
  };
}

export function buildInvoiceIssueDraft(input: InvoiceIssueDraftInput): ProcessDraft {
  const afterPayload: Record<string, any> = {
    invoiceNumber: input.invoiceNumber,
    type: input.type || 'Receivable',
    status: 'Issued',
    amount: input.amount,
    currency: input.currency || 'CNY',
    issueDate: input.issueDate || new Date().toISOString().slice(0, 10),
    dueDate: input.dueDate || null,
    customerRelationId: input.customerRelationId || null,
    customerName: input.customerName || null,
    orderId: input.orderId || null,
    notes: input.notes || null,
  };
  if (input.invoiceId) afterPayload.id = input.invoiceId;

  const subOperations: SubOperation[] = [{
    toolId: 'finance.create_invoice',
    entityId: input.invoiceId || input.invoiceNumber,
    action: 'create_and_issue_invoice',
    before: {},
    after: afterPayload,
  }];

  const beforeAfterDiff = [{
    entity: 'invoices',
    entityId: input.invoiceId || input.invoiceNumber,
    field: 'status',
    before: 'Draft',
    after: 'Issued',
  }];

  // 双 subOperation：invoice + Outbox email 待发（contract 边界：不 SMTP）
  if (input.email) {
    const emailAfter = {
      to: input.email.to,
      subject: input.email.subject,
      bodyText: input.email.bodyText,
      direction: 'outbound',
      mailbox: 'Outbox',
    };
    subOperations.push({
      toolId: 'email.reply_and_send',
      entityId: `${input.invoiceId || input.invoiceNumber}:outbox`,
      action: 'create_outbox_email',
      before: {},
      after: emailAfter,
    });
    beforeAfterDiff.push({
      entity: 'emails',
      entityId: `${input.invoiceId || input.invoiceNumber}:outbox`,
      field: 'outbox',
      before: 'none' as any,
      after: 'outbound:Outbox' as any,
    });
  }

  const content = {
    subOperations,
    beforeAfterDiff,
    impactScope: input.email ? ['invoices', 'emails'] : ['invoices'],
    irreversible: true,
    postCommitHooks: [] as any[],
  };
  const hash = computeProcessDraftHash(content);
  const idempotencyKey = `invoice.issue:${input.invoiceId || input.invoiceNumber}:${hash}`;

  return { ...content, idempotencyKey };
}

export function validateInvoiceIssueDraftSemantics(draft: any): { ok: boolean; error?: InvoiceIssueError } {
  if (!draft.subOperations || draft.subOperations.length === 0) {
    return { ok: false, error: buildInvoiceIssueError('SEMANTIC_VALIDATION_FAILED', 'draft must contain at least one subOperation') };
  }
  const after = draft.subOperations[0].after as any;
  if (!after?.invoiceNumber) {
    return { ok: false, error: buildInvoiceIssueError('SEMANTIC_VALIDATION_FAILED', 'draft must contain invoiceNumber in subOperations.after') };
  }
  if (!after?.amount || Number(after.amount) <= 0) {
    return { ok: false, error: buildInvoiceIssueError('INVALID_AMOUNT', 'invoice amount must be a positive number') };
  }
  // 复用 validateStatusTransition 校验 Draft→Issued 合法转移
  const t = validateStatusTransition('Invoice', 'Draft', after.status || 'Issued');
  if (!t.ok) {
    return { ok: false, error: buildInvoiceIssueError('INVALID_TRANSITION', t.message!) };
  }
  return { ok: true };
}

export function verifyInvoiceIssueDraftHash(draft: ProcessDraft): { ok: boolean; expected: string; actual: string } {
  const { idempotencyKey, ...content } = draft;
  const recomputedHash = computeProcessDraftHash(content);
  const actualHashPart = idempotencyKey.includes(':pd:')
    ? 'pd:' + idempotencyKey.split(':pd:')[1]
    : idempotencyKey;
  return { ok: recomputedHash === actualHashPart, expected: recomputedHash, actual: actualHashPart };
}

export interface InvoiceIssueCommitParams {
  prisma: PrismaClient;
  approvalId: string;
  approvalPayload: any;
}

export async function commitInvoiceIssue(
  params: InvoiceIssueCommitParams,
): Promise<{ ok: true; feedback: InvoiceIssueCommitted } | { ok: false; feedback: { status: 'failed'; error: InvoiceIssueError; approvalId?: string } }> {
  const { prisma, approvalId, approvalPayload } = params;

  const draft: any = approvalPayload?.processDraft;
  if (!draft) {
    return { ok: false, feedback: { status: 'failed', error: buildInvoiceIssueError('PROCESS_DRAFT_MISSING', 'processDraft not found in approval payload'), approvalId } };
  }

  const hashCheck = verifyInvoiceIssueDraftHash(draft);
  if (!hashCheck.ok) {
    return { ok: false, feedback: { status: 'failed', error: buildInvoiceIssueError('PROCESS_DRAFT_HASH_MISMATCH', `hash mismatch: expected=${hashCheck.expected} actual=${hashCheck.actual}`), approvalId } };
  }

  const semCheck = validateInvoiceIssueDraftSemantics(draft);
  if (!semCheck.ok) {
    return { ok: false, feedback: { status: 'failed', error: semCheck.error!, approvalId } };
  }

  const transactionId = `iis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let auditId = '';
  let committed: Partial<InvoiceIssueCommitted> = {};

  try {
    await prisma.$transaction(async (tx: any) => {
      const now = BigInt(Date.now());
      const after = draft.subOperations[0].after as any;
      const invoiceId = after.id || `INV__${Date.now().toString(36)}`;
      const status = after.status || 'Issued';

      // 复用 validateStatusTransition（事务内再次校验 Draft→Issued）
      const t = validateStatusTransition('Invoice', 'Draft', status);
      if (!t.ok) throw Object.assign(new Error(t.message!), { code: 'INVALID_TRANSITION' });

      const invoice = await tx.invoice.create({
        data: {
          id: invoiceId,
          invoiceNumber: after.invoiceNumber,
          type: after.type || 'Receivable',
          status,
          amount: Number(after.amount),
          currency: after.currency || 'CNY',
          issueDate: after.issueDate,
          dueDate: after.dueDate || null,
          customerRelationId: after.customerRelationId || null,
          customerName: after.customerName || null,
          orderId: after.orderId || null,
          notes: after.notes || null,
          createdAt: now,
          updatedAt: now,
        },
      });

      // 复用 syncInvoiceReferences（EntityLink aboutOrder + billTo，传 tx 同事务）
      await syncInvoiceReferences(prisma, invoice, { source: 'agent:invoice.issue' }, tx);

      // 同事务写 Outbox email 待发（contract 边界：不 SMTP，不写 sentAt/messageId）
      let emailId: string | null = null;
      if (draft.subOperations.length > 1) {
        const emailAfter = draft.subOperations[1].after as any;
        emailId = `EML__${Date.now().toString(36)}`;
        await tx.email.create({
          data: {
            id: emailId,
            direction: 'outbound',
            status: 'read',
            fromAddress: 'agent@bambook.local',
            fromName: 'Bambook Agent',
            toAddresses: JSON.stringify(emailAfter.to),
            subject: emailAfter.subject,
            bodyText: emailAfter.bodyText,
            mailbox: 'Outbox',
            threadId: null,
            messageId: null,
            sentAt: null,
            orderId: after.orderId || null,
            relationId: after.customerRelationId || null,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      // audit（事务内闭环，用 writeRouteAuditLog 返回的真实 id）
      auditId = await writeRouteAuditLog({
        prisma: tx, actorId: 'agent', source: 'agent:invoice.issue:commit',
        operation: 'invoice_issue_committed', targetType: 'Invoice', targetId: invoice.id,
        after: { invoiceId: invoice.id, status: invoice.status, amount: Number(invoice.amount), outboxEmailId: emailId, transactionId },
      });
      committed = { invoiceId: invoice.id, invoiceStatus: invoice.status };
    });

    return {
      ok: true,
      feedback: {
        status: 'committed',
        invoiceId: committed.invoiceId!,
        invoiceStatus: committed.invoiceStatus!,
        transactionId,
        auditId,
        idempotencyKey: draft.idempotencyKey,
      },
    };
  } catch (e: any) {
    const code = e?.code === 'INVALID_TRANSITION' ? 'INVALID_TRANSITION' : 'COMMIT_TRANSACTION_FAILED';
    return {
      ok: false,
      feedback: { status: 'failed', error: buildInvoiceIssueError(code as InvoiceIssueErrorCode, String(e?.message ?? e)), approvalId },
    };
  }
}
