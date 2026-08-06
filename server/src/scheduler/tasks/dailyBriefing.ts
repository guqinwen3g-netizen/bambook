/**
 * Phase 0 Sprint 2 — 调度任务：每日业务 briefing
 *
 * 每天 09:00 生成过去 24 小时的业务摘要通知：
 *   - 新建/确认订单数
 *   - 生产完成数
 *   - 发货完成数
 *   - 开具发票数 + 总金额
 *   - 收款登记数 + 总金额
 *   - 待处理事项（未确认订单、逾期发票）
 *
 * 摘要以通知形式推送给所有 active 用户（type: 'daily_briefing'）
 *
 * 注意：Order/Shipment/Invoice/PaymentVoucher 的 createdAt/updatedAt 是 BigInt（Unix 毫秒），
 * 不是 DateTime。查询用 number 比较。
 */

import { PrismaClient } from '@prisma/client';
import { ScheduledTask } from '../schedulerService';
import { createNotificationService } from '../../notifications/notificationService';
import { logger } from '../../lib/logger';

const BRIEFING_HOUR = 9; // 每天 09:00
let lastBriefingDate = ''; // YYYY-MM-DD，防同日重复

export function createDailyBriefingTask(): ScheduledTask {
  return {
    id: 'daily_briefing',
    shouldRun: (now: Date) => {
      if (now.getHours() < BRIEFING_HOUR) return false;
      const today = now.toISOString().slice(0, 10);
      return today !== lastBriefingDate;
    },
    run: async (prisma: PrismaClient) => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      lastBriefingDate = today;

      const sinceMs = now.getTime() - 24 * 60 * 60 * 1000; // 24 小时前（Unix 毫秒）

      try {
        // 并行查询各业务维度
        const [
          newOrders,
          confirmedOrders,
          productionCompleted,
          shipmentsDelivered,
          invoicesIssued,
          invoicesIssuedAmount,
          vouchersCreated,
          vouchersCreatedAmount,
          pendingConfirmations,
          overdueInvoices,
        ] = await Promise.all([
          // Order 没有 createdAt，用 updatedAt 近似（24h 内有变更的订单）
          prisma.order.count({
            where: { updatedAt: { gte: sinceMs }, deletedAt: null },
          }),
          prisma.order.count({
            where: {
              status: 'Confirmed',
              updatedAt: { gte: sinceMs },
              deletedAt: null,
            },
          }),
          prisma.agentJob.count({
            where: {
              jobType: 'bev:ProductionCompleted',
              status: 'completed',
              scheduledAt: { gte: new Date(sinceMs) },
            },
          }),
          prisma.shipment.count({
            where: {
              status: 'Delivered',
              updatedAt: { gte: sinceMs },
              deletedAt: null,
            },
          }),
          prisma.invoice.count({
            where: {
              status: 'Issued',
              updatedAt: { gte: sinceMs },
              deletedAt: null,
            },
          }),
          prisma.invoice.aggregate({
            where: {
              status: 'Issued',
              updatedAt: { gte: sinceMs },
              deletedAt: null,
            },
            _sum: { amount: true },
          }),
          prisma.paymentVoucher.count({
            where: {
              createdAt: { gte: sinceMs },
              deletedAt: null,
            },
          }),
          prisma.paymentVoucher.aggregate({
            where: {
              createdAt: { gte: sinceMs },
              deletedAt: null,
            },
            _sum: { amount: true },
          }),
          prisma.order.count({
            where: {
              status: 'Pending',
              deletedAt: null,
            },
          }),
          prisma.invoice.count({
            where: {
              status: { in: ['Issued', 'PartiallyPaid'] },
              dueDate: { lt: today, not: null },
              deletedAt: null,
            },
          }),
        ]);

        // 构建 briefing 文本
        const invSum = invoicesIssuedAmount._sum.amount?.toString() ?? '0';
        const vocSum = vouchersCreatedAmount._sum.amount?.toString() ?? '0';
        const lines: string[] = [
          `近 24h 订单变更 ${newOrders} 笔，确认 ${confirmedOrders} 笔`,
          `生产完成 ${productionCompleted} 单`,
          `发货完成 ${shipmentsDelivered} 单`,
          `开具发票 ${invoicesIssued} 张${invSum !== '0' ? `（合计 ${invSum}）` : ''}`,
          `收款登记 ${vouchersCreated} 笔${vocSum !== '0' ? `（合计 ${vocSum}）` : ''}`,
        ];
        const todos: string[] = [];
        if (pendingConfirmations > 0) todos.push(`待确认订单 ${pendingConfirmations} 笔`);
        if (overdueInvoices > 0) todos.push(`逾期发票 ${overdueInvoices} 张`);

        const body = lines.join('；') + (todos.length > 0 ? `\n待办：${todos.join('，')}` : '');
        const title = `每日业务摘要 ${today}`;

        // 创建通知给所有 active 用户
        const notificationService = createNotificationService(prisma);
        await notificationService.broadcastNotification({
          type: 'daily_briefing',
          title,
          body,
          level: 'info',
          link: '/dashboard',
          metadata: {
            date: today,
            stats: {
              newOrders,
              confirmedOrders,
              productionCompleted,
              shipmentsDelivered,
              invoicesIssued,
              vouchersCreated,
              pendingConfirmations,
              overdueInvoices,
            },
          },
        });

        logger.info('[DailyBriefing] sent', { date: today, stats: { newOrders, confirmedOrders, productionCompleted, shipmentsDelivered, invoicesIssued, vouchersCreated } });
      } catch (e: any) {
        logger.error('[DailyBriefing] failed', { error: e?.message });
      }
    },
  };
}
