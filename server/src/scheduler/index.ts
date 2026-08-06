/**
 * Phase 0 Sprint 2 — 调度器初始化入口
 *
 * 在 server 启动时调用 initializeScheduler(prisma)：
 *   1. 创建 SchedulerService 实例
 *   2. 注册所有调度任务
 *   3. 启动定时循环
 *
 * 调用时序：
 *   1. initializeNotificationBindings(prisma)  — 注入 prisma + 通知订阅
 *   2. registerAllLinkages()                    — 注册联动执行器
 *   3. initializeScheduler(prisma)              — 启动调度器
 */

import { PrismaClient } from '@prisma/client';
import { initializeScheduler } from './schedulerService';
import { createCrashRecoveryTask, createCleanupTask } from './tasks/retryLinkages';
import { createDailyBriefingTask } from './tasks/dailyBriefing';
import { createStuckProcessDetectorTask } from './tasks/stuckProcessDetector';
import { logger } from '../lib/logger';

export function startScheduler(prisma: PrismaClient): void {
  const scheduler = initializeScheduler(prisma);

  // 注册调度任务
  scheduler.register(createCrashRecoveryTask());
  scheduler.register(createCleanupTask());
  scheduler.register(createDailyBriefingTask());
  scheduler.register(createStuckProcessDetectorTask());

  // 启动调度器
  scheduler.start();

  logger.info('[Scheduler] initialized with 4 tasks', {
    tasks: ['crash_recovery', 'cleanup_queued_jobs', 'daily_briefing', 'stuck_process_detector'],
  });
}

export { initializeScheduler, getScheduler } from './schedulerService';
