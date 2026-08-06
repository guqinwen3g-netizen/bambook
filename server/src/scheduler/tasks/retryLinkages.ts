/**
 * Phase 0 Sprint 2 — 调度任务：崩溃恢复 + AgentJob 清理
 *
 * 任务 1（崩溃恢复，启动时执行一次）：
 *   - 服务器重启后，processedKeys 内存已清空
 *   - 扫描所有 status='queued' 的 bev:* AgentJob
 *   - 通过 businessEventBus 重放事件（idempotencyKey 去重 + 业务层幂等保证安全）
 *   - 标记为 'completed'
 *
 * 任务 2（清理，每小时执行）：
 *   - 标记 5 分钟前仍在 'queued' 状态的 bev:* AgentJob 为 'completed'
 *   - 这些是正常流程中已由 in-process handler 处理完毕但未更新状态的记录
 */

import { PrismaClient } from '@prisma/client';
import { ScheduledTask } from '../schedulerService';
import { businessEventBus } from '../../events/businessEventBus';
import { logger } from '../../lib/logger';

const RETRY_BATCH_SIZE = 50;
const CLEANUP_AGE_MS = 5 * 60 * 1000; // 5 分钟

let crashRecoveryDone = false;

export function createCrashRecoveryTask(): ScheduledTask {
  return {
    id: 'crash_recovery',
    shouldRun: () => !crashRecoveryDone,
    run: async (prisma: PrismaClient) => {
      const staleJobs = await prisma.agentJob.findMany({
        where: {
          status: 'queued',
          jobType: { startsWith: 'bev:' },
        },
        orderBy: { scheduledAt: 'asc' },
        take: RETRY_BATCH_SIZE,
      });

      if (staleJobs.length === 0) {
        logger.info('[CrashRecovery] no stale AgentJobs found');
        crashRecoveryDone = true;
        return;
      }

      logger.info('[CrashRecovery] replaying stale events', { count: staleJobs.length });

      let replayed = 0;
      let skipped = 0;
      for (const job of staleJobs) {
        try {
          const event = job.payload as any;
          if (!event || !event.type) {
            // payload 不是有效的 BusinessEvent，直接标记完成
            await prisma.agentJob.update({
              where: { id: job.id },
              data: { status: 'completed', completedAt: new Date() },
            });
            skipped++;
            continue;
          }

          // 重放事件 — publish 内部会用 duplicate key 忽略重复持久化
          // idempotencyKey 去重 + 业务层幂等保证不会重复执行
          await businessEventBus.publish(event);
          replayed++;

          await prisma.agentJob.update({
            where: { id: job.id },
            data: { status: 'completed', completedAt: new Date() },
          });
        } catch (e: any) {
          logger.error('[CrashRecovery] failed to replay job', {
            jobId: job.id,
            jobType: job.jobType,
            error: e?.message,
          });
          // 标记为 failed，避免反复重试坏数据
          await prisma.agentJob.update({
            where: { id: job.id },
            data: { status: 'failed', error: String(e?.message ?? e), completedAt: new Date() },
          }).catch(() => {});
        }
      }

      crashRecoveryDone = true;
      logger.info('[CrashRecovery] done', { replayed, skipped, total: staleJobs.length });
    },
  };
}

export function createCleanupTask(): ScheduledTask {
  let lastRunHour = -1;
  return {
    id: 'cleanup_queued_jobs',
    shouldRun: (now: Date) => {
      const hour = now.getHours();
      if (hour !== lastRunHour) {
        lastRunHour = hour;
        return true;
      }
      return false;
    },
    run: async (prisma: PrismaClient) => {
      const cutoff = new Date(Date.now() - CLEANUP_AGE_MS);
      const result = await prisma.agentJob.updateMany({
        where: {
          status: 'queued',
          jobType: { startsWith: 'bev:' },
          scheduledAt: { lt: cutoff },
        },
        data: { status: 'completed', completedAt: new Date() },
      });
      if (result.count > 0) {
        logger.info('[Cleanup] marked old queued AgentJobs as completed', {
          count: result.count,
          cutoff: cutoff.toISOString(),
        });
      }
    },
  };
}
