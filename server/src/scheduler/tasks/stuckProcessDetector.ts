/**
 * Phase 0 Sprint 2 — 调度任务：卡滞业务流程检测
 *
 * 每小时扫描以下卡滞场景，创建 warning 级别通知：
 *   1. 订单确认后 >7 天仍未进入生产（updatedAt 超过 7 天）
 *   2. 发货单创建后 >3 天仍为 Draft（未订舱）
 *   3. 发票开具后 >30 天仍未收款（Issued/PartiallyPaid 且已过到期日）
 *   4. 收款凭证登记后 >2 天未核销（unreconciled）
 *
 * 每个卡滞实体每天只发一次通知（通过通知 metadata.stuckKey 去重）
 *
 * 注意：Order/Shipment/Invoice/PaymentVoucher 的 createdAt/updatedAt 是 BigInt（Unix 毫秒），
 * 时间比较用 number，格式化时用 new Date(Number(value))。
 */

import { PrismaClient } from '@prisma/client';
import { ScheduledTask } from '../schedulerService';
import { createNotificationService } from '../../notifications/notificationService';
import { logger } from '../../lib/logger';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 20;

let lastRunHour = -1;

function formatDate(bigIntValue: bigint | null | undefined): string {
  if (bigIntValue == null) return '未知';
  return new Date(Number(bigIntValue)).toISOString().slice(0, 10);
}

export function createStuckProcessDetectorTask(): ScheduledTask {
  return {
    id: 'stuck_process_detector',
    shouldRun: (now: Date) => {
      const hour = now.getHours();
      if (hour !== lastRunHour) {
        lastRunHour = hour;
        return true;
      }
      return false;
    },
    run: async (prisma: PrismaClient) => {
      const now = Date.now();
      const notificationService = createNotificationService(prisma);
      const today = new Date().toISOString().slice(0, 10);
      let stuckCount = 0;

      try {
        // 1. 订单确认后 >7 天未进入生产
        const confirmedCutoff = now - SEVEN_DAYS_MS;
        const stuckOrders = await prisma.order.findMany({
          where: {
            status: 'Confirmed',
            updatedAt: { lt: confirmedCutoff },
            deletedAt: null,
          },
          select: { id: true, poNumber: true, customer: true, updatedAt: true },
          take: BATCH_LIMIT,
        });
        for (const order of stuckOrders) {
          const stuckKey = `stuck:order:${order.id}:${today}`;
          const existing = await prisma.notification.findFirst({
            where: { type: 'stuck_order', metadata: { path: ['stuckKey'], equals: stuckKey } },
            select: { id: true },
          });
          if (existing) continue;

          await notificationService.broadcastNotification({
            type: 'stuck_order',
            title: `订单 ${order.poNumber} 生产停滞`,
            body: `订单 ${order.poNumber}（客户 ${order.customer}）确认已超过 7 天，仍未进入生产。上次更新：${formatDate(order.updatedAt)}`,
            level: 'warning',
            link: `/orders?id=${order.id}`,
            metadata: { stuckKey, entityType: 'Order', entityId: order.id, orderId: order.id },
          });
          stuckCount++;
        }

        // 2. 发货单 >3 天仍为 Draft
        const draftCutoff = now - THREE_DAYS_MS;
        const stuckShipments = await prisma.shipment.findMany({
          where: {
            status: 'Draft',
            updatedAt: { lt: draftCutoff },
            deletedAt: null,
          },
          select: { id: true, shipmentNumber: true, orderId: true, updatedAt: true },
          take: BATCH_LIMIT,
        });
        for (const ship of stuckShipments) {
          const stuckKey = `stuck:shipment:${ship.id}:${today}`;
          const existing = await prisma.notification.findFirst({
            where: { type: 'stuck_shipment', metadata: { path: ['stuckKey'], equals: stuckKey } },
            select: { id: true },
          });
          if (existing) continue;

          await notificationService.broadcastNotification({
            type: 'stuck_shipment',
            title: `发货单 ${ship.shipmentNumber} 未订舱`,
            body: `发货单 ${ship.shipmentNumber} 创建已超过 3 天，仍为 Draft 状态，请尽快订舱。`,
            level: 'warning',
            link: `/shipments?id=${ship.id}`,
            metadata: { stuckKey, entityType: 'Shipment', entityId: ship.id, orderId: ship.orderId },
          });
          stuckCount++;
        }

        // 3. 发票 >30 天未收款（已过到期日）
        const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS).toISOString().slice(0, 10);
        const stuckInvoices = await prisma.invoice.findMany({
          where: {
            status: { in: ['Issued', 'PartiallyPaid'] },
            issueDate: { lt: thirtyDaysAgo },
            deletedAt: null,
          },
          select: { id: true, invoiceNumber: true, amount: true, currency: true, orderId: true, issueDate: true },
          take: BATCH_LIMIT,
        });
        for (const inv of stuckInvoices) {
          const stuckKey = `stuck:invoice:${inv.id}:${today}`;
          const existing = await prisma.notification.findFirst({
            where: { type: 'stuck_invoice', metadata: { path: ['stuckKey'], equals: stuckKey } },
            select: { id: true },
          });
          if (existing) continue;

          await notificationService.broadcastNotification({
            type: 'stuck_invoice',
            title: `发票 ${inv.invoiceNumber} 逾期未收款`,
            body: `发票 ${inv.invoiceNumber}（金额 ${inv.amount} ${inv.currency}）开具于 ${inv.issueDate}，已超过 30 天未收清。`,
            level: 'critical',
            link: `/finance?tab=invoices&id=${inv.id}`,
            metadata: { stuckKey, entityType: 'Invoice', entityId: inv.id, orderId: inv.orderId },
          });
          stuckCount++;
        }

        // 4. 收款凭证 >2 天未核销
        const voucherCutoff = now - TWO_DAYS_MS;
        const stuckVouchers = await prisma.paymentVoucher.findMany({
          where: {
            status: 'unreconciled',
            createdAt: { lt: voucherCutoff },
            deletedAt: null,
          },
          select: { id: true, voucherNumber: true, amount: true, currency: true, createdAt: true },
          take: BATCH_LIMIT,
        });
        for (const voc of stuckVouchers) {
          const stuckKey = `stuck:voucher:${voc.id}:${today}`;
          const existing = await prisma.notification.findFirst({
            where: { type: 'stuck_voucher', metadata: { path: ['stuckKey'], equals: stuckKey } },
            select: { id: true },
          });
          if (existing) continue;

          await notificationService.broadcastNotification({
            type: 'stuck_voucher',
            title: `收款凭证 ${voc.voucherNumber} 未核销`,
            body: `凭证 ${voc.voucherNumber}（金额 ${voc.amount} ${voc.currency}）登记已超过 2 天，仍未核销。`,
            level: 'warning',
            link: `/finance?tab=vouchers&id=${voc.id}`,
            metadata: { stuckKey, entityType: 'PaymentVoucher', entityId: voc.id },
          });
          stuckCount++;
        }

        if (stuckCount > 0) {
          logger.info('[StuckDetector] notifications sent', { count: stuckCount });
        }
      } catch (e: any) {
        logger.error('[StuckDetector] failed', { error: e?.message });
      }
    },
  };
}
