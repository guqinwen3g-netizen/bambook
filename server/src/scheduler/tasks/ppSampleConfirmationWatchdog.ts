/**
 * 调度任务：厂前样（PP Sample）寄出超 3 天未确认提醒（PRD 7.1「厂前样超 3 天未确认」）
 *
 * 每日 11:30 后运行一次。扫描 SampleNode：
 *   level='pp' 且 status='sent'（已寄出）且 sentDate ≤ 今天-3 天 且未批准（approvedAt 为空），
 *   关联 DevelopmentCase 未取消（stage != cancelled）者 → warning 通知。
 *
 * 与 sampleDeadlineWatchdog 的分工：后者管 Order 级船样/匹头样（Exmill 窗口），
 * 本任务管 DevelopmentCase 样品流的厂前样确认（PRD 4.1/5.1：厂前样批准是开裁前置条件）。
 *
 * 幂等：notification metadata.stuckKey = pp_sample:unconfirmed:${nodeId}:${today}（每天每条最多一条）。
 */

import { PrismaClient } from '@prisma/client';
import { ScheduledTask } from '../schedulerService';
import { createNotificationService } from '../../notifications/notificationService';
import { logger } from '../../lib/logger';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 厂前样寄出 ≥3 天未确认开始提醒（PRD 7.1） */
const PP_CONFIRM_DAYS = 3;
const BATCH_LIMIT = 50;

let lastRunDay = '';

function dayKeyOf(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

/** 本地零点毫秒 → YYYY-MM-DD */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 解析 YYYY-MM-DD 为本地零点毫秒；非法返回 null */
function parseDate(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 扫描 + 通知主流程（导出供测试直接驱动）。
 * @returns 本次新发送的通知数
 */
export async function scanPpSampleConfirmations(
  prisma: PrismaClient,
  today: Date = new Date(),
): Promise<{ notified: number }> {
  const notificationService = createNotificationService(prisma);
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayStr = formatDate(todayMs);
  const sentBeforeMs = todayMs - PP_CONFIRM_DAYS * DAY_MS;

  const nodes = await prisma.sampleNode.findMany({
    where: {
      level: 'pp',
      status: 'sent',
      approvedAt: null,
      deletedAt: null,
      sentDate: { not: null },
    },
    select: {
      id: true,
      developmentCaseId: true,
      sentDate: true,
      courier: true,
      trackingNumber: true,
    },
    take: BATCH_LIMIT,
  });

  // SampleNode.developmentCaseId 为裸 FK（无 Prisma relation），批量取关联开发案
  const caseIds = Array.from(new Set(nodes.map(n => n.developmentCaseId)));
  const cases = caseIds.length
    ? await prisma.developmentCase.findMany({
        where: { id: { in: caseIds } },
        select: { id: true, code: true, name: true, stage: true, deletedAt: true },
      })
    : [];
  const caseMap = new Map(cases.map(c => [c.id, c]));

  let notified = 0;
  for (const node of nodes) {
    const sentMs = parseDate(node.sentDate);
    if (sentMs === null || sentMs > sentBeforeMs) continue;
    const kase = caseMap.get(node.developmentCaseId);
    if (!kase || kase.deletedAt != null || kase.stage === 'cancelled') continue;

    const days = Math.floor((todayMs - sentMs) / DAY_MS);
    const stuckKey = `pp_sample:unconfirmed:${node.id}:${todayStr}`;
    const existing = await prisma.notification.findFirst({
      where: { type: 'pp_sample_unconfirmed', metadata: { path: ['stuckKey'], equals: stuckKey } },
      select: { id: true },
    });
    if (existing) continue;

    const caseLabel = kase.code || kase.name || node.developmentCaseId;
    await notificationService.broadcastNotification({
      type: 'pp_sample_unconfirmed',
      title: `开发案 ${caseLabel} 厂前样已寄出 ${days} 天未确认`,
      body: `开发案 ${caseLabel}（${kase.name ?? ''}）厂前样已于 ${node.sentDate} 寄出${node.courier ? `（${node.courier}${node.trackingNumber ? ` ${node.trackingNumber}` : ''}）` : ''}，至今已 ${days} 天客户未确认。厂前样批准是开裁前置条件，请立即跟进。`,
      level: 'warning',
      link: `/development?id=${node.developmentCaseId}`,
      metadata: { stuckKey, entityType: 'SampleNode', entityId: node.id, developmentCaseId: node.developmentCaseId, daysPending: days },
    });
    notified += 1;
  }

  if (notified > 0) {
    logger.info('[PpSampleConfirmationWatchdog] scan', { notified });
  }
  return { notified };
}

export function createPpSampleConfirmationWatchdogTask(): ScheduledTask {
  return {
    id: 'pp_sample_confirmation_watchdog',
    shouldRun: (now: Date) => {
      // 每日 11:30 后执行一次
      const dayKey = dayKeyOf(now);
      if ((now.getHours() > 11 || (now.getHours() === 11 && now.getMinutes() >= 30)) && dayKey !== lastRunDay) {
        lastRunDay = dayKey;
        return true;
      }
      return false;
    },
    run: async (prisma: PrismaClient) => {
      try {
        await scanPpSampleConfirmations(prisma);
      } catch (e: any) {
        logger.error('[PpSampleConfirmationWatchdog] failed', { error: e?.message });
      }
    },
  };
}
