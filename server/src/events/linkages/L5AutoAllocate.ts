/**
 * Phase 1 Sprint 3 — 联动执行器 L5
 *
 * 业务规则：收款凭证登记（PaymentVoucherCreated）→ 自动核销到关联发票
 *
 * 设计决策：
 *   - 若凭证已指定 invoiceId → 直接核销该发票
 *   - 若凭证未指定 invoiceId 但有 orderId → 查找该订单的 Receivable 发票（Issued/PartiallyPaid）
 *   - 若都没有 → 跳过（用户需手动核销）
 *   - 核销金额 = min(凭证剩余金额, 发票剩余金额)
 *   - 仅处理 Receipt 类型凭证（收款），Disbursement（付款）不自动核销
 *
 * 幂等性：
 *   - in-process: `auto:L5:${voucherId}` 去重
 *   - 业务层: InvoiceAllocation @@unique([invoiceId, voucherId])，重复核销会 P2002 被跳过
 */

import { Prisma } from '@prisma/client';
import { businessEventBus } from '../businessEventBus';
import { createAllocation } from '../../finance/allocationMutationService';
import { isLinkageEnabled } from '../../config/automationConfig';
import { logger } from '../../lib/logger';

export function registerL5AutoAllocate(): void {
  businessEventBus.registerLinkage({
    id: 'L5_auto_allocate',
    eventType: 'PaymentVoucherCreated',
    idempotencyKey: (e) => `auto:L5:${e.sourceEntityId}`,
    execute: async (prisma, event) => {
      if (!isLinkageEnabled('L5_auto_allocate')) {
        logger.info('[L5] linkage disabled, skipping', { voucherId: event.sourceEntityId });
        return { ok: true, created: null, error: 'linkage disabled' };
      }
      const voucherId = event.sourceEntityId;
      const payload = event.payload as {
        voucherNumber?: string;
        type?: string;
        amount?: string;
        currency?: string;
        invoiceId?: string;
        customerRelationId?: string;
        orderId?: string;
      };

      // 仅处理 Receipt（收款）类型凭证
      if (payload.type && payload.type !== 'Receipt') {
        logger.info('[L5] voucher is not Receipt type, skipping auto-allocate', {
          voucherId,
          type: payload.type,
        });
        return { ok: true, created: null, error: 'not receipt type' };
      }

      try {
        // 查询凭证完整信息
        const voucher = await prisma.paymentVoucher.findUnique({
          where: { id: voucherId },
          select: {
            id: true,
            voucherNumber: true,
            type: true,
            amount: true,
            currency: true,
            invoiceId: true,
            orderId: true,
            customerRelationId: true,
            status: true,
            appliedAmount: true,
          },
        });
        if (!voucher) {
          logger.warn('[L5] voucher not found', { voucherId });
          return { ok: false, error: `voucher ${voucherId} not found` };
        }

        // 已核销的凭证跳过
        if (voucher.status === 'reconciled') {
          logger.info('[L5] voucher already reconciled, skipping', { voucherId });
          return { ok: true, created: null, error: 'already reconciled' };
        }

        // 计算凭证剩余可核销金额
        const voucherAmount = new Prisma.Decimal(voucher.amount);
        const alreadyApplied = voucher.appliedAmount ? new Prisma.Decimal(voucher.appliedAmount) : new Prisma.Decimal(0);
        const remainingVoucherAmount = voucherAmount.minus(alreadyApplied);
        if (remainingVoucherAmount.lte(0)) {
          logger.info('[L5] voucher has no remaining amount to allocate', {
            voucherId,
            amount: voucherAmount.toString(),
            applied: alreadyApplied.toString(),
          });
          return { ok: true, created: null, error: 'no remaining amount' };
        }

        // 解析目标发票
        const targetInvoiceId = await resolveTargetInvoiceId(prisma, voucher, payload);
        if (!targetInvoiceId) {
          logger.info('[L5] no matching outstanding invoice found, skipping', {
            voucherId,
            orderId: voucher.orderId,
            customerRelationId: voucher.customerRelationId,
          });
          return { ok: true, created: null, error: 'no matching invoice' };
        }

        // 查询发票剩余金额
        const invoice = await prisma.invoice.findUnique({
          where: { id: targetInvoiceId },
          select: { id: true, invoiceNumber: true, amount: true, status: true, currency: true },
        });
        if (!invoice) {
          logger.warn('[L5] target invoice not found', { invoiceId: targetInvoiceId });
          return { ok: false, error: `invoice ${targetInvoiceId} not found` };
        }

        // 仅处理 Issued / PartiallyPaid 状态发票
        if (!['Issued', 'PartiallyPaid'].includes(invoice.status)) {
          logger.info('[L5] invoice not in allocatable status, skipping', {
            invoiceId: targetInvoiceId,
            status: invoice.status,
          });
          return { ok: true, created: null, error: 'invoice not allocatable' };
        }

        // 计算发票剩余金额 = 发票金额 - 已核销总额
        const allocatedResult = await prisma.invoiceAllocation.aggregate({
          where: { invoiceId: targetInvoiceId },
          _sum: { appliedAmount: true },
        });
        const invoiceAmount = new Prisma.Decimal(invoice.amount);
        const alreadyAllocated = allocatedResult._sum.appliedAmount
          ? new Prisma.Decimal(allocatedResult._sum.appliedAmount)
          : new Prisma.Decimal(0);
        const remainingInvoiceAmount = invoiceAmount.minus(alreadyAllocated);
        if (remainingInvoiceAmount.lte(0)) {
          logger.info('[L5] invoice already fully allocated', {
            invoiceId: targetInvoiceId,
            amount: invoiceAmount.toString(),
            allocated: alreadyAllocated.toString(),
          });
          return { ok: true, created: null, error: 'invoice fully allocated' };
        }

        // 核销金额 = min(凭证剩余, 发票剩余)
        const allocateAmount = Prisma.Decimal.min(remainingVoucherAmount, remainingInvoiceAmount);
        const today = new Date().toISOString().slice(0, 10);

        const result = await createAllocation({
          prisma,
          input: {
            invoiceId: targetInvoiceId,
            voucherId,
            appliedAmount: allocateAmount.toString(),
            appliedDate: today,
          },
          actorId: 'agent:auto',
        });

        if (!result.ok) {
          // CONFLICT (P2034) = 并发核销冲突，可重试
          if (result.error?.code === 'CONFLICT') {
            logger.warn('[L5] concurrent allocation conflict, will retry', {
              voucherId,
              invoiceId: targetInvoiceId,
            });
            return { ok: false, error: 'concurrent conflict, retry' };
          }
          logger.error('[L5] createAllocation returned error', {
            voucherId,
            invoiceId: targetInvoiceId,
            error: result.error?.message,
            code: result.error?.code,
          });
          return { ok: false, error: result.error?.message || 'allocation failed' };
        }

        logger.info('[L5] auto-allocation completed', {
          voucherId,
          voucherNumber: voucher.voucherNumber,
          invoiceId: targetInvoiceId,
          invoiceNumber: invoice.invoiceNumber,
          allocatedAmount: allocateAmount.toString(),
          newInvoiceStatus: result.data?.newInvoiceStatus,
          newVoucherStatus: result.data?.newVoucherStatus,
        });
        return {
          ok: true,
          created: {
            allocationId: result.data?.allocation.id,
            invoiceId: targetInvoiceId,
            appliedAmount: allocateAmount.toString(),
          },
        };
      } catch (e: any) {
        logger.error('[L5] autoAllocate failed', {
          error: e?.message,
          voucherId,
          eventId: event.id,
        });
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
  });
}

/**
 * 解析目标发票 ID：
 * 1. 优先使用凭证上的 invoiceId（用户创建凭证时已指定）
 * 2. 其次按 orderId 查找该订单的 Receivable 发票
 * 3. 最后按 customerRelationId 查找客户未结清的 Receivable 发票
 */
async function resolveTargetInvoiceId(
  prisma: any,
  voucher: { invoiceId: string | null; orderId: string | null; customerRelationId: string | null },
  payload: { invoiceId?: string },
): Promise<string | null> {
  // 1. 凭证已指定 invoiceId
  const explicitInvoiceId = voucher.invoiceId || payload.invoiceId;
  if (explicitInvoiceId) return explicitInvoiceId;

  // 2. 按 orderId 查找 Receivable 发票（Issued/PartiallyPaid）
  if (voucher.orderId) {
    const byOrder = await prisma.invoice.findFirst({
      where: {
        orderId: voucher.orderId,
        type: 'Receivable',
        status: { in: ['Issued', 'PartiallyPaid'] },
        deletedAt: null,
      },
      orderBy: { issueDate: 'asc' }, // 优先核销最早的发票
      select: { id: true },
    });
    if (byOrder) return byOrder.id;
  }

  // 3. 按 customerRelationId 查找
  if (voucher.customerRelationId) {
    const byCustomer = await prisma.invoice.findFirst({
      where: {
        customerRelationId: voucher.customerRelationId,
        type: 'Receivable',
        status: { in: ['Issued', 'PartiallyPaid'] },
        deletedAt: null,
      },
      orderBy: { issueDate: 'asc' },
      select: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }

  return null;
}
