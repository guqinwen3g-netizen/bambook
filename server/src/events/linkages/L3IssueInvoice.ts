/**
 * Phase 1 Sprint 3 — 联动执行器 L3
 *
 * 业务规则：发货完成（ShipmentCompleted）→ 自动创建应收发票草稿
 *
 * 设计决策：
 *   - 仅创建 Draft 状态发票，不自动开具（需人工核对金额/税率/到期日）
 *   - type=Receivable（应收-客户账单），金额取订单 totalNet || quoteAmount
 *   - 币种取订单 currency，默认 USD（外贸最常见）
 *   - issueDate 取当日，dueDate 留空（用户根据付款条件填写）
 *
 * 幂等性：
 *   - in-process: `auto:L3:${shipmentId}` 去重（按发货单，非订单）
 *   - 业务层: 先查询是否已有该订单的 Receivable 发票，有则跳过
 */

import { Prisma } from '@prisma/client';
import { businessEventBus } from '../businessEventBus';
import { createInvoice } from '../../finance/invoiceMutationService';
import { isLinkageEnabled } from '../../config/automationConfig';
import { logger } from '../../lib/logger';

export function registerL3IssueInvoice(): void {
  businessEventBus.registerLinkage({
    id: 'L3_issue_invoice',
    eventType: 'ShipmentCompleted',
    idempotencyKey: (e) => `auto:L3:${e.sourceEntityId}`,
    execute: async (prisma, event) => {
      if (!isLinkageEnabled('L3_issue_invoice')) {
        logger.info('[L3] linkage disabled, skipping', { shipmentId: event.sourceEntityId });
        return { ok: true, created: null, error: 'linkage disabled' };
      }
      const shipmentId = event.sourceEntityId;
      const orderId = event.orderId;

      if (!orderId) {
        logger.warn('[L3] ShipmentCompleted event missing orderId, skipping', { eventId: event.id, shipmentId });
        return { ok: true, created: null, error: 'no orderId' };
      }

      try {
        // 幂等检查：该订单是否已有 Receivable 发票（未删除）
        const existing = await prisma.invoice.findFirst({
          where: { orderId, type: 'Receivable', deletedAt: null },
          select: { id: true, invoiceNumber: true, status: true },
        });
        if (existing) {
          logger.info('[L3] receivable invoice already exists for order, skipping', {
            orderId,
            invoiceId: existing.id,
            invoiceNumber: existing.invoiceNumber,
            status: existing.status,
          });
          return { ok: true, created: null, error: 'invoice already exists' };
        }

        // 查询订单快照
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            poNumber: true,
            customer: true,
            customerRelationId: true,
            currency: true,
            totalNet: true,
            quoteAmount: true,
          },
        });
        if (!order) {
          logger.warn('[L3] order not found', { orderId });
          return { ok: false, error: `order ${orderId} not found` };
        }

        // 金额：优先 totalNet，兜底 quoteAmount
        const amount = order.totalNet ?? order.quoteAmount;
        if (!amount || new Prisma.Decimal(amount).lte(0)) {
          logger.warn('[L3] order has no valid amount, skipping invoice creation', {
            orderId,
            totalNet: order.totalNet?.toString(),
            quoteAmount: order.quoteAmount?.toString(),
          });
          return { ok: false, error: 'order has no valid amount' };
        }

        // 生成发票号：INV-{poNumber}-{YYYYMMDDHHmmss}
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const poRef = order.poNumber || orderId.slice(-8);
        const invoiceNumber = `INV-${poRef}-${ts}`;
        const issueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const result = await createInvoice({
          prisma,
          input: {
            orderId,
            invoiceNumber,
            type: 'Receivable',
            status: 'Draft',
            amount: new Prisma.Decimal(amount).toString(),
            currency: order.currency || 'USD',
            issueDate,
            customerName: order.customer,
            customerRelationId: order.customerRelationId,
            notes: `由发货单 ${event.payload?.shipmentNumber ?? shipmentId} 交付自动生成`,
          },
          actorId: 'system',
        });

        if (!result.ok) {
          logger.error('[L3] createInvoice returned error', {
            orderId,
            error: result.error?.message,
            code: result.error?.code,
          });
          return { ok: false, error: result.error?.message || 'create invoice failed' };
        }

        logger.info('[L3] receivable invoice draft created', {
          orderId,
          shipmentId,
          invoiceId: result.data?.invoice.id,
          invoiceNumber,
          amount: new Prisma.Decimal(amount).toString(),
          currency: order.currency || 'USD',
        });
        return { ok: true, created: { invoiceId: result.data?.invoice.id, invoiceNumber } };
      } catch (e: any) {
        logger.error('[L3] createInvoice failed', {
          error: e?.message,
          orderId,
          shipmentId,
          eventId: event.id,
        });
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
  });
}
