/**
 * paymentRequestApprovalHook.ts — DR-017 审批通过事件驱动发凭证（W-A 走查 DE-3 修复）
 *
 * 背景：issueVoucherForApprovedRequest 此前生产零调用方，审批通过后无自动生成
 *   PaymentVoucher 的链路（直付旁路 DE-3）。本钩子在 approvalEventBus 'resolved'
 *   事件上挂载：审批单决议 → 定位关联 PaymentRequest → syncApprovalDecision
 *   回写状态并自动生成付款凭证（幂等，已关联凭证时直接返回既有凭证）。
 *
 * 事件契约：与 approvalRoute decide / approvalKernelRoute boss-bypass 同一总线
 *   （agent/events.approvalEventBus.emit('resolved', approvalId, { decision })）。
 *   进程内总线为 best-effort 触发；漏触发时由 POST /api/v1/payment-requests/:id/issue-voucher
 *   手动触发兜底（同一 service 契约，幂等）。
 */

import type { PrismaClient } from '@prisma/client';
import { approvalEventBus } from '../agent/events';
import { logger } from '../lib/logger';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';
import { createPaymentRequestService } from './paymentRequestService';

export function registerPaymentRequestApprovalHook(opts: { prisma: PrismaClient }): void {
  const { prisma } = opts;
  const approvalCreateService = createApprovalCreateService({
    prisma,
    routingService: createApprovalRoutingService({ prisma }),
  });
  const paymentRequestService = createPaymentRequestService({ prisma, approvalCreateService });

  approvalEventBus.on('resolved', (approvalId: string, payload: { decision?: string } = {}) => {
    (async () => {
      // 仅处理付款申请审批单（actionType=finance:payment_request 的申请以 approvalRequestId 反链）
      const pr = await (prisma as any).paymentRequest.findFirst({
        where: { approvalRequestId: approvalId, deletedAt: null },
      });
      if (!pr) return;
      const result = await paymentRequestService.syncApprovalDecision({
        paymentRequestId: pr.id,
        actorId: 'system_approval_hook',
      });
      if (!result.ok) {
        logger.error('[PaymentRequestHook] 审批决议回写失败', {
          approvalId, paymentRequestId: pr.id, error: result.error.code, message: result.error.message,
        });
        return;
      }
      if (result.data.synced) {
        logger.info('[PaymentRequestHook] 审批决议已回写', {
          approvalId,
          paymentRequestId: pr.id,
          decision: payload.decision,
          voucherIssued: Boolean((result.data as any).voucher),
        });
      }
    })().catch((e: any) => {
      // 事件钩子失败不阻断审批主流程（决议已落库），记录日志供 issue-voucher 手动兜底
      logger.error('[PaymentRequestHook] 审批决议处理异常', { approvalId, error: e?.message });
    });
  });

  logger.info('[PaymentRequestHook] DR-017 审批决议钩子已注册（approvalEventBus resolved）');
}
