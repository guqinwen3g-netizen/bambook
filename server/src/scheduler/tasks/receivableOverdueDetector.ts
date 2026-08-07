/**
 * 阶段 E / E1 — 调度任务：应收发票逾期分级预警
 *
 * 每小时扫描应收发票（type=Receivable，status ∈ Issued/PartiallyPaid），
 * 以「有效到期日」口径分级通知（warning / critical）：
 *   - 有效到期日 effectiveDue = dueDate ?? issueDate + 30 天（Net 30 惯例推定，
 *     覆盖未填到期日的存量发票）
 *   - 逾期 1-14 天 → warning
 *   - 逾期 ≥15 天 → critical
 *   - 未逾期 → 不通知
 *
 * 与 stuckProcessDetector 的关系：
 *   本任务取代其第 3 段「发票 >30 天未收款」。旧段注释声称判 dueDate，
 *   实现却只判 issueDate > 30 天——Net 60 发票开票 31 天误报、Net 7 发票
 *   逾期 20 天漏报，口径错误从根因修正为到期日口径并分级。
 *
 * 去重规则（与 expiryWatchdog 一致）：
 *   dedupKey 含 tier：`receivable:overdue:${invoiceId}:${tier}:${today}`
 *   同级别当天只发一次；级别升级（warning→critical）会重新通知。
 *
 * 日期字段均为 String YYYY-MM-DD（本地日历日比较，避免时区漂移）。
 */

import { PrismaClient } from '@prisma/client';
import { ScheduledTask } from '../schedulerService';
import { createNotificationService } from '../../notifications/notificationService';
import { logger } from '../../lib/logger';

const BATCH_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Net 30 推定：dueDate 缺失时以开票日 +30 天为有效到期日 */
const NET30_DAYS = 30;
/** 逾期 ≥15 天升 critical */
const CRITICAL_OVERDUE_DAYS = 15;

type Tier = 'warning' | 'critical';

const RECEIVABLE_OPEN_STATUSES = ['Issued', 'PartiallyPaid'];

let lastRunHour = -1;

/** 解析 YYYY-MM-DD 为本地零点毫秒；非法返回 null */
function parseDate(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 本地零点毫秒 → YYYY-MM-DD */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 有效到期日（本地零点毫秒）：dueDate 优先，缺失按 Net 30 推定；均无法解析返回 null */
function effectiveDueMs(dueDate: string | null, issueDate: string): number | null {
  const due = parseDate(dueDate);
  if (due !== null) return due;
  const issue = parseDate(issueDate);
  if (issue === null) return null;
  return issue + NET30_DAYS * DAY_MS;
}

/**
 * 扫描 + 通知主流程（导出供测试直接驱动）。
 * @returns 发送的通知数
 */
export async function detectAndNotify(
  prisma: PrismaClient,
  today: Date = new Date(),
): Promise<number> {
  const notificationService = createNotificationService(prisma);
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayStr = formatDate(todayMs);

  const invoices = await prisma.invoice.findMany({
    where: {
      type: 'Receivable',
      status: { in: RECEIVABLE_OPEN_STATUSES },
      deletedAt: null,
    },
    select: {
      id: true, invoiceNumber: true, amount: true, currency: true,
      issueDate: true, dueDate: true, status: true,
      orderId: true, customerName: true,
    },
    take: BATCH_LIMIT,
  });

  let sent = 0;
  for (const inv of invoices) {
    const dueMs = effectiveDueMs(inv.dueDate, inv.issueDate);
    if (dueMs === null) continue;

    const daysOverdue = Math.round((todayMs - dueMs) / DAY_MS);
    if (daysOverdue < 1) continue;

    const tier: Tier = daysOverdue >= CRITICAL_OVERDUE_DAYS ? 'critical' : 'warning';
    const dueStr = formatDate(dueMs);
    const estimated = inv.dueDate == null; // 推定口径需在正文中透明披露

    const dedupKey = `receivable:overdue:${inv.id}:${tier}:${todayStr}`;
    const existing = await prisma.notification.findFirst({
      where: { type: 'receivable_overdue', metadata: { path: ['dedupKey'], equals: dedupKey } },
      select: { id: true },
    });
    if (existing) continue;

    const amountStr = `${inv.amount} ${inv.currency}`;
    const customerStr = inv.customerName ? `（客户 ${inv.customerName}）` : '';
    const partialStr = inv.status === 'PartiallyPaid' ? '，已部分核销' : '';
    await notificationService.broadcastNotification({
      type: 'receivable_overdue',
      title: `发票 ${inv.invoiceNumber} 逾期 ${daysOverdue} 天未收清`,
      body: `应收发票 ${inv.invoiceNumber}${customerStr}（金额 ${amountStr}${partialStr}）${estimated ? `未填到期日，按 Net 30 推定 ${dueStr} 到期` : `到期日 ${dueStr}`}，已逾期 ${daysOverdue} 天，请跟进客户回款。`,
      level: tier,
      link: `/finance?tab=invoices&id=${inv.id}`,
      metadata: {
        dedupKey,
        tier,
        entityType: 'Invoice',
        entityId: inv.id,
        orderId: inv.orderId,
        daysOverdue,
        dueDate: dueStr,
        dueDateEstimated: estimated,
        status: inv.status,
      },
    });
    sent++;
  }

  if (sent > 0) {
    logger.info('[ReceivableOverdue] notifications sent', { count: sent });
  }
  return sent;
}

export function createReceivableOverdueDetectorTask(): ScheduledTask {
  return {
    id: 'receivable_overdue_detector',
    shouldRun: (now: Date) => {
      const hour = now.getHours();
      if (hour !== lastRunHour) {
        lastRunHour = hour;
        return true;
      }
      return false;
    },
    run: async (prisma: PrismaClient) => {
      try {
        await detectAndNotify(prisma);
      } catch (e: any) {
        logger.error('[ReceivableOverdue] failed', { error: e?.message });
      }
    },
  };
}
