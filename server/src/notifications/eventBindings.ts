/**
 * Phase 0 Sprint 1 — 业务事件 → 通知系统的桥接
 *
 * 在 server 启动时调用 initializeNotificationBindings(prisma)，
 * 把 businessEventBus 的所有业务事件订阅到 notificationService。
 *
 * 解耦设计：
 *   - 业务 service 只负责 publishBusinessEvent（不知道通知系统的存在）
 *   - 通知系统订阅事件并决定如何渲染、投递
 *   - 后续 Phase 1+ 可加 linkage handlers 订阅同样事件做业务联动
 */

import { PrismaClient } from '@prisma/client';
import { businessEventBus, BusinessEventType } from '../events/businessEventBus';
import { createNotificationService, NotificationService } from './notificationService';
import { logger } from '../lib/logger';

let initialized = false;
let notificationService: NotificationService | null = null;

/**
 * 初始化通知系统的事件订阅。
 * 必须在 prisma 创建后、路由注册前调用。
 */
export function initializeNotificationBindings(prisma: PrismaClient): NotificationService {
  if (initialized) {
    logger.warn('[NotificationBindings] already initialized, skipping');
    return notificationService!;
  }

  // 注入 prisma 到事件总线（用于持久化事件到 AgentJob）
  businessEventBus.setPrisma(prisma);

  // 创建通知服务
  notificationService = createNotificationService(prisma);

  // 订阅所有业务事件类型，统一交给 notificationService 处理
  const ALL_BUSINESS_EVENT_TYPES: BusinessEventType[] = [
    'OrderCreated',
    'OrderConfirmed',
    'OrderStatusChanged',
    'ProductionStageAdvanced',
    'ProductionCompleted',
    'ShipmentCreated',
    'ShipmentCompleted',
    'ShipmentStatusChanged',
    'InvoiceIssued',
    'InvoiceCancelled',
    'PaymentVoucherCreated',
    'PaymentReceived',
    'AllocationReconciled',
    'DevelopmentConverted',
    'RelationOnboarded',
    // C3 HR 深化：员工状态跃迁 / 请假审批结果
    'EmployeeStatusChanged',
    'LeaveRequestDecided',
  ];

  for (const eventType of ALL_BUSINESS_EVENT_TYPES) {
    businessEventBus.subscribe(eventType, async (event) => {
      await notificationService!.notifyFromEvent(event);
    });
  }

  // 通配订阅（用于监控/调试，未来可用于审计日志扩展）
  businessEventBus.subscribe('*', (event) => {
    logger.info('[BusinessEvent]', {
      type: event.type,
      sourceEntityType: event.sourceEntityType,
      sourceEntityId: event.sourceEntityId,
      orderId: event.orderId,
      actorId: event.actorId,
      eventId: event.id,
    });
  });

  initialized = true;
  logger.info('[NotificationBindings] initialized', {
    subscribedEventTypes: ALL_BUSINESS_EVENT_TYPES.length,
  });

  return notificationService;
}

/**
 * 获取已初始化的 NotificationService（用于 route 注入）。
 * 若未初始化抛错。
 */
export function getNotificationService(): NotificationService {
  if (!notificationService) {
    throw new Error('[NotificationBindings] not initialized, call initializeNotificationBindings first');
  }
  return notificationService;
}

/**
 * 重置绑定（仅供测试使用）
 */
export function resetNotificationBindingsForTest(): void {
  businessEventBus.reset();
  notificationService = null;
  initialized = false;
}
