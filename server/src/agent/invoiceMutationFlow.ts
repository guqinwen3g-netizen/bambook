import { PrismaClient } from '@prisma/client';
import { createInvoice, updateInvoice, type InvoiceMutationErrorCode } from '../finance/invoiceMutationService';
import { computeProcessDraftHash, type ProcessDraft, type SubOperation } from './toolRegistry';

export type InvoiceMutationFlowErrorCode = 'APPROVAL_ID_MISSING'|'APPROVAL_NOT_FOUND'|'APPROVAL_MODIFIED_UNSUPPORTED'|'PROCESS_DRAFT_MISSING'|'PROCESS_DRAFT_HASH_MISMATCH'|'SEMANTIC_VALIDATION_FAILED'|InvoiceMutationErrorCode;
export interface InvoiceMutationFlowError { code: InvoiceMutationFlowErrorCode; message: string; userAction: string; }
export interface InvoiceMutationCommitted { status: 'committed'; invoiceId: string; auditId: string; idempotencyKey: string; }

export function buildInvoiceMutationError(code: InvoiceMutationFlowErrorCode, message: string): InvoiceMutationFlowError {
  const map: Record<InvoiceMutationFlowErrorCode, string> = {
    APPROVAL_ID_MISSING: '审批恢复执行必须携带 approvalId，请重新发起审批流程', APPROVAL_NOT_FOUND: '审批记录不存在或未通过，请重新审批', APPROVAL_MODIFIED_UNSUPPORTED: '审批内容被修改，不支持直接 commit，请重新生成 draft 并重新审批', PROCESS_DRAFT_MISSING: '请重新发起流程，确保 draft payload 完整', PROCESS_DRAFT_HASH_MISMATCH: '审批内容与 draft 不一致，请重新发起', SEMANTIC_VALIDATION_FAILED: '发票 draft 语义校验失败，请检查输入', INVALID_STATUS: '发票状态非法', INVALID_TRANSITION: '发票状态流转非法', INVALID_CURRENT_STATUS: '发票当前状态非法', INVALID_AMOUNT: '金额/汇率格式非法', NOT_FOUND: '发票不存在或已删除', STATUS_NOT_MANUAL_SETTABLE: '该状态只能由核销/分配操作设置，不可手动修改', CREATE_FAILED: '创建事务失败已回滚，请重试', UPDATE_FAILED: '更新事务失败已回滚，请重试',
  };
  return { code, message, userAction: map[code] };
}

function verifyHash(draft: ProcessDraft) {
  const { idempotencyKey, ...content } = draft;
  const expected = computeProcessDraftHash(content);
  const actual = idempotencyKey.includes(':pd:') ? 'pd:' + idempotencyKey.split(':pd:')[1] : idempotencyKey.split(':').slice(-1)[0];
  return { ok: expected === actual, expected, actual };
}

export function buildInvoiceCreateDraft(input: { input: Record<string, unknown> }): ProcessDraft {
  const body = input.input || {};
  const invoiceNumber = String((body as any).invoiceNumber || '');
  const subOperations: SubOperation[] = [{ toolId: 'invoice.create', entityId: invoiceNumber || 'new', action: 'create_invoice', before: {}, after: { ...body } }];
  const beforeAfterDiff = Object.entries(body).map(([field, after]) => ({ entity: 'invoice', entityId: invoiceNumber || 'new', field, before: null, after }));
  const content = { subOperations, beforeAfterDiff, impactScope: ['finance','entity-links','audit'], irreversible: false, postCommitHooks: [] as any[] };
  return { ...content, idempotencyKey: `invoice.create:${invoiceNumber || 'new'}:${computeProcessDraftHash(content)}` };
}

export function buildInvoiceUpdateDraft(input: { invoiceId: string; patch: Record<string, unknown>; currentSnapshot?: Record<string, unknown> }): ProcessDraft {
  const { invoiceId, patch, currentSnapshot = {} } = input;
  const subOperations: SubOperation[] = [{ toolId: 'invoice.update', entityId: invoiceId, action: 'update_invoice', before: currentSnapshot, after: { invoiceId, patch } }];
  const beforeAfterDiff = Object.keys(patch).map((field) => ({ entity: 'invoice', entityId: invoiceId, field, before: (currentSnapshot as any)[field] ?? null, after: (patch as any)[field] }));
  const content = { subOperations, beforeAfterDiff, impactScope: ['finance','entity-links','audit'], irreversible: false, postCommitHooks: [] as any[] };
  return { ...content, idempotencyKey: `invoice.update:${invoiceId}:${computeProcessDraftHash(content)}` };
}

export function validateInvoiceCreateDraftSemantics(draft: any) {
  const after = draft?.subOperations?.[0]?.after as any;
  for (const f of ['invoiceNumber','type','amount','currency','issueDate']) if (after?.[f] === undefined || after?.[f] === null || after?.[f] === '') return { ok: false, error: buildInvoiceMutationError('SEMANTIC_VALIDATION_FAILED', `draft must contain ${f}`) };
  return { ok: true };
}
export function validateInvoiceUpdateDraftSemantics(draft: any) {
  const after = draft?.subOperations?.[0]?.after as any;
  if (!after?.invoiceId) return { ok: false, error: buildInvoiceMutationError('SEMANTIC_VALIDATION_FAILED', 'draft must contain invoiceId') };
  if (!after.patch || typeof after.patch !== 'object' || Object.keys(after.patch).length === 0) return { ok: false, error: buildInvoiceMutationError('SEMANTIC_VALIDATION_FAILED', 'draft must contain non-empty patch') };
  return { ok: true };
}

export async function commitInvoiceCreate(params: { prisma: PrismaClient; approvalId: string; approvalPayload: any }): Promise<{ ok: true; feedback: InvoiceMutationCommitted } | { ok: false; feedback: { status: 'failed'; error: InvoiceMutationFlowError; approvalId?: string } }> {
  const { prisma, approvalId, approvalPayload } = params; const draft: any = approvalPayload?.processDraft;
  if (!draft) return { ok: false, feedback: { status: 'failed', error: buildInvoiceMutationError('PROCESS_DRAFT_MISSING','processDraft not found'), approvalId } };
  const hash = verifyHash(draft); if (!hash.ok) return { ok: false, feedback: { status: 'failed', error: buildInvoiceMutationError('PROCESS_DRAFT_HASH_MISMATCH', `hash mismatch: expected=${hash.expected} actual=${hash.actual}`), approvalId } };
  const sem = validateInvoiceCreateDraftSemantics(draft); if (!sem.ok) return { ok: false, feedback: { status: 'failed', error: sem.error!, approvalId } };
  const r = await createInvoice({ prisma, input: draft.subOperations[0].after, actorId: 'agent' });
  if (!r.ok) return { ok: false, feedback: { status: 'failed', error: buildInvoiceMutationError(r.error!.code, r.error!.message), approvalId } };
  return { ok: true, feedback: { status: 'committed', invoiceId: r.data!.invoice.id, auditId: r.data!.auditId, idempotencyKey: draft.idempotencyKey } };
}

export async function commitInvoiceUpdate(params: { prisma: PrismaClient; approvalId: string; approvalPayload: any }): Promise<{ ok: true; feedback: InvoiceMutationCommitted } | { ok: false; feedback: { status: 'failed'; error: InvoiceMutationFlowError; approvalId?: string } }> {
  const { prisma, approvalId, approvalPayload } = params; const draft: any = approvalPayload?.processDraft;
  if (!draft) return { ok: false, feedback: { status: 'failed', error: buildInvoiceMutationError('PROCESS_DRAFT_MISSING','processDraft not found'), approvalId } };
  const hash = verifyHash(draft); if (!hash.ok) return { ok: false, feedback: { status: 'failed', error: buildInvoiceMutationError('PROCESS_DRAFT_HASH_MISMATCH', `hash mismatch: expected=${hash.expected} actual=${hash.actual}`), approvalId } };
  const sem = validateInvoiceUpdateDraftSemantics(draft); if (!sem.ok) return { ok: false, feedback: { status: 'failed', error: sem.error!, approvalId } };
  const after = draft.subOperations[0].after as any;
  const r = await updateInvoice({ prisma, invoiceId: after.invoiceId, input: after.patch, actorId: 'agent' });
  if (!r.ok) return { ok: false, feedback: { status: 'failed', error: buildInvoiceMutationError(r.error!.code, r.error!.message), approvalId } };
  return { ok: true, feedback: { status: 'committed', invoiceId: r.data!.invoice.id, auditId: r.data!.auditId, idempotencyKey: draft.idempotencyKey } };
}
