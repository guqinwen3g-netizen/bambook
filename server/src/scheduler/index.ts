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
import { createWeeklyBriefingTask } from './tasks/weeklyBriefing';
import { createStuckProcessDetectorTask } from './tasks/stuckProcessDetector';
import { createExpiryWatchdogTask } from './tasks/expiryWatchdog';
import { createShipmentDelayDetectorTask } from './tasks/shipmentDelayDetector';
import { createReceivableOverdueDetectorTask } from './tasks/receivableOverdueDetector';
import { createInventoryWatchdogTask } from './tasks/inventoryWatchdog';
import { createProductionDeadlineWatchdogTask } from './tasks/productionDeadlineWatchdog';
import { createFactoryCertificationWatchdogTask } from './tasks/factoryCertificationWatchdog';
import { createSeasonReviewWatchdogTask } from './tasks/seasonReviewWatchdog';
import { createCreditRiskWatchdogTask, createQualityRepeatWatchdogTask } from './tasks/riskWatchdog';
import { createSampleDeadlineWatchdogTask } from './tasks/sampleDeadlineWatchdog';
import { createScheduledReportRunnerTask } from './tasks/scheduledReportRunner';
import { createHrLifecycleWatchdogTask } from './tasks/hrLifecycleWatchdog';
import { logger } from '../lib/logger';

export function startScheduler(prisma: PrismaClient): void {
  const scheduler = initializeScheduler(prisma);

  // 注册调度任务
  scheduler.register(createCrashRecoveryTask());
  scheduler.register(createCleanupTask());
  scheduler.register(createDailyBriefingTask());
  scheduler.register(createStuckProcessDetectorTask());
  scheduler.register(createExpiryWatchdogTask());
  scheduler.register(createShipmentDelayDetectorTask());
  // 阶段 E / E1：主动提醒引擎扩展（应收逾期 / 库存预警 / 生产超期）
  scheduler.register(createReceivableOverdueDetectorTask());
  scheduler.register(createInventoryWatchdogTask());
  scheduler.register(createProductionDeadlineWatchdogTask());
  // 阶段 E / E2：每周经营 briefing（日报已升级为 C1 聚合口径）
  scheduler.register(createWeeklyBriefingTask());
  // 阶段 H / H1c：工厂认证到期 30 天预警（每日）
  scheduler.register(createFactoryCertificationWatchdogTask());
  // 阶段 H / H2：季度结束后自动生成季度回顾（每日）
  scheduler.register(createSeasonReviewWatchdogTask());
  // 阶段 H / H3：信用风险扫描（每日 10:00）+ 重复疵点扫描（每日 10:30）
  scheduler.register(createCreditRiskWatchdogTask());
  scheduler.register(createQualityRepeatWatchdogTask());
  // 阶段 P0 回补：船样 / 匹头样确认追踪预警（每日 11:00，PRD 5.2）
  scheduler.register(createSampleDeadlineWatchdogTask());
  // 阶段 A5：定时报表运行器（每小时扫描，按周期键幂等）
  scheduler.register(createScheduledReportRunnerTask());
  // 阶段 C3：HR 生命周期预警 — 试用转正（前 7 天）/ 合同到期（前 30 天），每日 09:00
  scheduler.register(createHrLifecycleWatchdogTask());

  // 启动调度器
  scheduler.start();

  logger.info('[Scheduler] initialized with 17 tasks', {
    tasks: ['crash_recovery', 'cleanup_queued_jobs', 'daily_briefing', 'weekly_briefing', 'stuck_process_detector', 'expiry_watchdog', 'shipment_delay_detector', 'receivable_overdue_detector', 'inventory_watchdog', 'production_deadline_watchdog', 'factory_certification_watchdog', 'season_review_watchdog', 'credit_risk_watchdog', 'quality_repeat_watchdog', 'sample_deadline_watchdog', 'scheduled_report_runner', 'hr_lifecycle_watchdog'],
  });
}

export { initializeScheduler, getScheduler } from './schedulerService';
