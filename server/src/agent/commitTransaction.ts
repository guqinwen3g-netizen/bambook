/**
 * P1-A ProcessDraft 语义校验：防止 shape/hash 正确但语义降级的 draft 通过。
 * order.confirm 必须是 status(Pending->Confirmed) + invoice(Issued) + audit 的固定流程。
 * 缺任何一项 fail closed，不进入 $transaction。
 */
export function validateProcessDraftSemantics(draft: ProcessDraft): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. orders.update_status 必须存在，before.status === Pending，after.status === Confirmed
  const updateStatusOp = draft.subOperations.find(op => op.toolId === 'orders.update_status');
  if (!updateStatusOp) {
    errors.push('MISSING_ORDERS_UPDATE_STATUS');
  } else {
    if (String(updateStatusOp.before.status || '') !== 'Pending') {
      errors.push(`STATUS_BEFORE_NOT_PENDING(actual=${updateStatusOp.before.status})`);
    }
    if (String(updateStatusOp.after.status || '') !== 'Confirmed') {
      errors.push(`STATUS_AFTER_NOT_CONFIRMED(actual=${updateStatusOp.after.status})`);
    }
  }

  // 2. finance.create_invoice 必须存在，字段完整且语义正确
  const invoiceOp = draft.subOperations.find(op => op.toolId === 'finance.create_invoice');
  if (!invoiceOp) {
    errors.push('MISSING_FINANCE_CREATE_INVOICE');
  } else {
    if (String(invoiceOp.after.status || '') !== 'Issued') {
      errors.push(`INVOICE_STATUS_NOT_ISSUED(actual=${invoiceOp.after.status})`);
    }
    if (String(invoiceOp.after.type || '') !== 'Receivable') {
      errors.push(`INVOICE_TYPE_NOT_RECEIVABLE(actual=${invoiceOp.after.type})`);
    }
    if (!(Number(invoiceOp.after.amount) > 0)) {
      errors.push(`INVOICE_AMOUNT_INVALID(actual=${invoiceOp.after.amount})`);
    }
    if (!String(invoiceOp.after.currency || '')) {
      errors.push('INVOICE_CURRENCY_MISSING');
    }
    if (!String(invoiceOp.after.customerRelationId || '')) {
      errors.push('INVOICE_CUSTOMER_RELATION_MISSING');
    }
    if (!String(invoiceOp.after.orderId || '')) {
      errors.push('INVOICE_ORDER_ID_MISSING');
    }
  }

  // 3. impactScope 必须含 orders + invoices，postCommitHooks 必须为空
  if (!draft.impactScope.includes('orders')) errors.push('IMPACT_SCOPE_MISSING_ORDERS');
  if (!draft.impactScope.includes('invoices')) errors.push('IMPACT_SCOPE_MISSING_INVOICES');
  if (draft.postCommitHooks.length > 0) errors.push('POST_COMMIT_HOOKS_NOT_EMPTY');

  return { ok: errors.length === 0, errors };
}

/**
 * P1-A commitTransaction 引擎：order.confirm 从 ProcessDraft 到审批后事务提交闭环。
 *
 * 职责：
 * 1. 从 ApprovalRequest.payload 恢复已审批的 ProcessDraft（what-you-approve-is-what-you-commit）
 * 2. hash 校验：恢复的 draft idempotencyKey 必须与重新计算的 hash 一致（防篡改）
 * 3. Prisma $transaction 原子提交：订单状态 Confirmed + Invoice(Issued) + AuditLog
 * 4. fail-closed：draft 缺失/hash 不匹配/preconditions 失败/事务失败均抛错，不留部分主数据
 *
 * P1-A scope：
 * - entity reference sync（syncInvoiceReferences）在 $transaction 内执行，失败全回滚
 * - email/EmailQueue 明确排除（postCommitHooks 为空）
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { buildInvoiceReferenceOps } from '../entities/sync';
import {
  type ProcessDraft,
  computeProcessDraftHash,
  validateProcessDraft,
} from './toolRegistry';
import { buildOrderConfirmError, type EntityLinkRecord } from './feedbackContract';

/** commitTransaction 结果（P1-C 结构化 feedback contract） */
export interface CommitResult {
  ok: boolean;
  committed: boolean;
  orderId?: string;
  poNumber?: string;
  previousStatus?: string;
  newStatus?: string;
  transactionId?: string;
  // P1-C: commit 成功结构化字段
  invoiceId?: string;
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  customerRelationId?: string;
  customerName?: string;
  auditId?: string;
  idempotencyKey?: string;
  entityLinks?: EntityLinkRecord[];
  postCommitQueue?: Array<{
    type: 'email' | 'sms' | 'webhook' | 'notification';
    status: 'queued';
    payload: Record<string, unknown>;
  }>;
  error?: string;
  // P1-C: 统一 errorFeedback envelope（与 buildOrderConfirmError 字段一致）
  errorFeedback?: {
    code: string;
    message: string;
    userAction: string;
    details?: string[];
    retryable: boolean;
  };
  audit?: {
    approvalId: string;
    idempotencyKey: string;
    subOperationsSummary: string[];
    impactScope: string[];
  };
}

/**
 * 从 ApprovalRequest.payload 恢复 ProcessDraft。
 * payload.processDraft 是审批时写入的 draft 快照。
 */
export function recoverProcessDraftFromPayload(
  payload: Record<string, unknown> | null,
): ProcessDraft | null {
  if (!payload) return null;
  const draft = (payload as any).processDraft;
  if (!draft || typeof draft !== 'object') return null;
  const validation = validateProcessDraft(draft as ProcessDraft);
  if (!validation.ok) return null;
  return draft as ProcessDraft;
}

/**
 * 校验恢复的 ProcessDraft 的 idempotencyKey 与重新计算的 hash 一致。
 * 防篡改：任何字段被修改都会导致 hash 不匹配，fail-closed。
 */
export function verifyProcessDraftHash(draft: ProcessDraft): { ok: boolean; expected: string; actual: string } {
  // 重算 draft 内容（去掉 idempotencyKey）的 canonical hash，比对 idempotencyKey 里的 hash 部分
  const { idempotencyKey, ...content } = draft;
  const recomputedHash = computeProcessDraftHash(content); // 格式 pd:xxxx
  // 提取原 idempotencyKey 里的 hash 部分（支持 "order.confirm:PO-001:pd:xxxx" 或 "pd:xxxx"）
  const actualHashPart = idempotencyKey.includes(':pd:')
    ? 'pd:' + idempotencyKey.split(':pd:')[1]
    : idempotencyKey;
  return {
    ok: recomputedHash === actualHashPart,
    expected: recomputedHash,
    actual: actualHashPart,
  };
}

/**
 * P1-A commitTransaction：Prisma $transaction 原子提交 order.confirm。
 *
 * 步骤：
 * 1. 从 approval payload 恢复 draft（必须存在）
 * 2. hash 校验（防篡改）
 * 3. 找到 update_status subOperation，事务化更新订单状态
 * 4. postCommitHooks 转 queue intent（不外发）
 * 5. 返回审计摘要
 *
 * 失败语义：任何步骤失败抛错，Prisma $transaction 自动回滚，不留部分主数据。
 */
export async function commitOrderConfirm(params: {
  prisma: PrismaClient;
  approvalId: string;
  approvalPayload: Record<string, unknown> | null;
}): Promise<CommitResult> {
  const { prisma, approvalId, approvalPayload } = params;

  // 1. 恢复 draft
  const draft = recoverProcessDraftFromPayload(approvalPayload);
  if (!draft) {
    return {
      ok: false,
      committed: false,
      error: 'COMMIT_FAILED: process draft missing or invalid in approval payload',
      errorFeedback: { ...buildOrderConfirmError('no approved process draft'), retryable: false },
    };
  }

  // 2. ProcessDraft 语义校验（业务规则，优先于 hash 防篡改）
  // 防止 shape 正确但语义降级的 draft（如缺 invoice、状态非 Pending->Confirmed）通过
  const semanticValidation = validateProcessDraftSemantics(draft);
  if (!semanticValidation.ok) {
    return {
      ok: false,
      committed: false,
      error: `COMMIT_FAILED: ProcessDraft semantic validation failed: ${semanticValidation.errors.join(', ')}`,
      errorFeedback: { ...buildOrderConfirmError('semantic validation failed', semanticValidation.errors), retryable: false },
      audit: {
        approvalId,
        idempotencyKey: draft.idempotencyKey,
        subOperationsSummary: draft.subOperations.map(s => `${s.toolId}:${s.action}`),
        impactScope: draft.impactScope,
      },
    };
  }

  // 3. hash 校验（防篡改，第二道防线）
  const hashCheck = verifyProcessDraftHash(draft);
  if (!hashCheck.ok) {
    return {
      ok: false,
      committed: false,
      error: `COMMIT_FAILED: process draft hash mismatch (expected ${hashCheck.expected}, got ${hashCheck.actual})`,
      errorFeedback: { ...buildOrderConfirmError('hash mismatch'), retryable: false },
      audit: {
        approvalId,
        idempotencyKey: draft.idempotencyKey,
        subOperationsSummary: draft.subOperations.map(s => `${s.toolId}:${s.action}`),
        impactScope: draft.impactScope,
      },
    };
  }

  // 4. 找到 update_status subOperation（semantic validation 已保证存在）
  const updateStatusOp = draft.subOperations.find(op => op.toolId === 'orders.update_status')!;

  // 阻断2修复：entityId 存的是 poNumber（如 PO-001），不是 Order.id。
  // Order 表 poNumber 是 unique 字段，用 poNumber 查。
  const poNumber = updateStatusOp.entityId;
  const newStatus = String(updateStatusOp.after.status || '');
  const previousStatus = String(updateStatusOp.before.status || '');

  // 查 approval 拿 requesterId（审计 actorId 用真实用户，不用 'system'）
  const approval = await (prisma as any).approvalRequest.findUnique({
    where: { id: approvalId },
    select: { id: true, requesterId: true },
  }).catch(() => null);
  const auditActorId = approval?.requesterId || 'unknown';

  // 4. Prisma $transaction 原子提交
  try {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ts = Date.now();

    // P1-A 真实口径：status + invoice(Issued) + AuditLog 全部在 $transaction 内收口
    const invoiceOp = draft.subOperations.find(op => op.toolId === 'finance.create_invoice');

    let invoiceId = '';
    let invoiceNumber = '';
    let invAmount = 0;
    let invCurrency = '';
    const committedResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // The receipt is written in the same transaction as domain changes. A concurrent
      // replay can therefore never create a second order transition or invoice.
      await (tx as any).agentCommitReceipt.create({
        data: {
          id: `acr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          idempotencyKey: draft.idempotencyKey,
          toolId: 'order.confirm',
          approvalId,
          status: 'committing',
        },
      });
      // 用 poNumber 查订单（不是 id）
      const order = await tx.order.findFirst({
        where: { poNumber },
        select: { id: true, poNumber: true, status: true, deletedAt: true },
      });
      if (!order || order.deletedAt) {
        throw new Error(`ORDER_NOT_FOUND: poNumber=${poNumber}`);
      }
      if (order.status !== previousStatus) {
        throw new Error(`STATUS_DRIFT: expected ${previousStatus}, actual ${order.status}`);
      }
      const realOrderId = order.id;

      // 1. 创建状态流转记录
      await tx.orderStatusTransition.create({
        data: {
          id: `ST-${realOrderId}-${ts}`,
          orderId: realOrderId,
          fromStatus: previousStatus,
          toStatus: newStatus,
          note: `order.confirm commitTransaction (approvalId=${approvalId}, idempotencyKey=${draft.idempotencyKey})`,
          operator: 'agent',
          createdAt: BigInt(ts),
        },
      });

      // 2. 更新订单状态
      await tx.order.update({
        where: { id: realOrderId },
        data: { status: newStatus, updatedAt: BigInt(ts) },
      });

      // 3. P1-A：事务内创建 Invoice(status=Issued)，用已审批 ProcessDraft 的 snapshot 字段
      // amount/currency/customer 来自 draftPhase 读取的订单快照（不硬编码）
      if (invoiceOp) {
        invoiceId = `INV__${poNumber.replace(/[^a-zA-Z0-9]/g, '_')}_${ts}`;
        invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(ts).slice(-6)}`;
        const issueDate = new Date().toISOString().slice(0, 10);
        invAmount = Number(invoiceOp.after.amount);
        invCurrency = String(invoiceOp.after.currency || '');
        if (!(invAmount > 0)) {
          throw new Error(`INVOICE_AMOUNT_INVALID: draft amount=${invAmount} (must be > 0)`);
        }
        if (!invCurrency) {
          // P1-A: currency 缺失 fail closed（ProcessDraft 应完整，不引入 CNY fallback）
          throw new Error(`INVOICE_CURRENCY_MISSING: draft currency empty (ProcessDraft must carry currency from order snapshot)`);
        }
        await tx.invoice.create({
          data: {
            id: invoiceId,
            invoiceNumber,
            type: String(invoiceOp.after.type || 'Receivable'),
            status: 'Issued',
            amount: invAmount,
            currency: invCurrency,
            issueDate,
            orderId: realOrderId,
            customerRelationId: String(invoiceOp.after.customerRelationId || '') || null,
            customerName: String(invoiceOp.after.customerName || '') || null,
            notes: `order.confirm commitTransaction (transactionId=${transactionId}, lineCount=${invoiceOp.after.lineCount || 0})`,
            createdAt: BigInt(ts),
            updatedAt: BigInt(ts),
          },
        });
        // P1-A: 事务内同步 entity reference/link（aboutOrder + billTo 两维度），失败全回滚
        // 复用 sync.ts 的 buildInvoiceReferenceOps（与 syncInvoiceReferences 等价，但不嵌套 $transaction）
        const createdInvoice = {
          id: invoiceId, invoiceNumber,
          orderId: realOrderId,
          customerRelationId: String(invoiceOp.after.customerRelationId || '') || null,
          customerName: String(invoiceOp.after.customerName || '') || null,
        };
        const syncOps = buildInvoiceReferenceOps(tx as any, createdInvoice as any, {
          source: 'agent:order_confirm_commit',
          now: () => ts,
        });
        // 逐个 await（已在同一 tx 内，失败会让事务回滚）
        for (const op of syncOps) {
          await op;
        }
      }

      // 4. AuditLog：审计是事务闭环的一部分，失败必须让事务回滚（不再 catch non-fatal）
      await tx.auditLog.create({
        data: {
          id: `audit_commit_${transactionId}`,
          actorId: auditActorId,
          action: 'order_confirm_committed',
          targetType: 'orders',
          targetId: realOrderId,
          detail: {
            transactionId,
            approvalId,
            idempotencyKey: draft.idempotencyKey,
            poNumber,
            previousStatus,
            newStatus,
            invoiceCreated: !!invoiceOp,
            subOperationsSummary: draft.subOperations.map(s => `${s.toolId}:${s.action}`),
            impactScope: draft.impactScope,
            irreversible: draft.irreversible,
          } as any,
        },
      });

      const auditId = `audit_commit_${transactionId}`;
      const entityLinks: EntityLinkRecord[] = [
        { linkKind: 'aboutOrder', fromType: 'invoice', fromId: invoiceId, toType: 'order', toId: realOrderId },
      ];
      if (invoiceOp && String(invoiceOp.after.customerRelationId || '')) {
        entityLinks.push({
          linkKind: 'billTo', fromType: 'invoice', fromId: invoiceId,
          toType: 'relation.organization', toId: String(invoiceOp.after.customerRelationId),
        });
      }
      const result: CommitResult = {
        ok: true,
        committed: true,
        orderId: realOrderId,
        poNumber,
        previousStatus,
        newStatus,
        transactionId,
        invoiceId,
        invoiceNumber,
        amount: invAmount,
        currency: invCurrency,
        customerRelationId: String(invoiceOp?.after.customerRelationId || ''),
        customerName: String(invoiceOp?.after.customerName || ''),
        auditId,
        idempotencyKey: draft.idempotencyKey,
        entityLinks,
        postCommitQueue: [],
        audit: {
          approvalId,
          idempotencyKey: draft.idempotencyKey,
          subOperationsSummary: draft.subOperations.map(s => `${s.toolId}:${s.action}`),
          impactScope: draft.impactScope,
        },
      };
      await (tx as any).agentCommitReceipt.update({
        where: { idempotencyKey: draft.idempotencyKey },
        data: { status: 'committed', result: result as any, completedAt: new Date() },
      });
      return result;
    });
    return committedResult;
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const receipt = await (prisma as any).agentCommitReceipt?.findUnique?.({
        where: { idempotencyKey: draft.idempotencyKey },
      }).catch(() => null);
      if (receipt?.status === 'committed' && receipt.result && typeof receipt.result === 'object') {
        return receipt.result as CommitResult;
      }
    }
    // fail-closed：事务失败已自动回滚，不留部分主数据
    return {
      ok: false,
      committed: false,
      poNumber,
      error: `COMMIT_TRANSACTION_FAILED: ${String(error?.message || error)}`,
      errorFeedback: { ...buildOrderConfirmError(`COMMIT_TRANSACTION_FAILED: ${String(error?.message || error)}`), retryable: false },
      audit: {
        approvalId,
        idempotencyKey: draft.idempotencyKey,
        subOperationsSummary: draft.subOperations.map(s => `${s.toolId}:${s.action}`),
        impactScope: draft.impactScope,
      },
    };
  }
}
