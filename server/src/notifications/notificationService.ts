/**
 * Phase 0 Sprint 1 — 通知服务（NotificationService）
 *
 * 设计目标：
 *   1. 接收 BusinessEvent，渲染通知内容，落库 Notification 表
 *   2. 多通道投递：站内（SSE 实时推送）+ 邮件（可选，未来 Push）
 *   3. 用户偏好：根据 NotificationPreference 决定通道（Sprint 1 默认 in_app）
 *   4. 接收人解析：单租户场景，所有 active 用户都收到（Phase 1+ 加细粒度路由）
 *
 * 不变量：
 *   - 通知失败永不阻断业务（持久化失败仅日志）
 *   - SSE 推送失败只影响实时性，不重试（落库已成功，用户刷新可见）
 *   - 邮件通道默认关闭，需 NotificationPreference 配置开启
 */

import { PrismaClient, Notification } from '@prisma/client';
import { BusinessEvent, BusinessEventType } from '../events/businessEventBus';
import { renderNotification, NotificationContent, NotificationLevel } from './notificationTemplateEngine';
import { publishNotificationEvent } from '../realtime';
import { logger } from '../lib/logger';

// ────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────

export type NotificationListParams = {
  userId: string;
  unreadOnly?: boolean;
  type?: string;
  level?: string;
  limit?: number;
  offset?: number;
};

export type NotificationStats = {
  total: number;
  unread: number;
  critical: number;
  byType: Record<string, number>;
};

// ────────────────────────────────────────────────────────────────
// 通知服务
// ────────────────────────────────────────────────────────────────

export interface NotificationService {
  /** 从业务事件生成通知并落库（订阅 businessEventBus 调用） */
  notifyFromEvent(event: BusinessEvent): Promise<void>;
  /** 直接创建并落库一条通知 */
  createNotification(params: {
    userId: string;
    type: string;
    title: string;
    body: string;
    level?: 'info' | 'warning' | 'critical';
    link?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Notification>;
  /** 广播通知给所有 active 用户（用于调度器 briefing / 卡滞告警） */
  broadcastNotification(params: {
    type: string;
    title: string;
    body: string;
    level?: 'info' | 'warning' | 'critical';
    link?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ count: number }>;
  /** 发送给指定用户（创建 + SSE 实时推送） */
  sendToUser(params: {
    userId: string;
    type: string;
    title: string;
    body: string;
    level?: 'info' | 'warning' | 'critical';
    link?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Notification | null>;
  /** 发送给指定角色的所有用户（按 UserRole 关联查找） */
  broadcastToRole(params: {
    role: string;
    type: string;
    title: string;
    body: string;
    level?: 'info' | 'warning' | 'critical';
    link?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ count: number }>;
  /** 列出用户的通知 */
  listNotifications(params: NotificationListParams): Promise<{ items: Notification[]; total: number }>;
  /** 获取未读统计 */
  getStats(userId: string): Promise<NotificationStats>;
  /** 标记单条已读 */
  markAsRead(userId: string, notificationId: string): Promise<{ ok: boolean }>;
  /** 标记全部已读 */
  markAllAsRead(userId: string): Promise<{ ok: boolean; count: number }>;
  /** 删除通知（仅本人） */
  deleteNotification(userId: string, notificationId: string): Promise<{ ok: boolean }>;
}

// ────────────────────────────────────────────────────────────────
// 工厂函数：创建 NotificationService 实例
// ────────────────────────────────────────────────────────────────

export function createNotificationService(prisma: PrismaClient): NotificationService {
  return {
    async notifyFromEvent(event: BusinessEvent): Promise<void> {
      try {
        const content = renderNotification(event);
        // 接收人解析：单租户场景，所有 active 用户都收到
        // Phase 1+ 可改为按事件类型+订单关联人细粒度路由
        const recipients = await resolveRecipients(prisma, event);
        if (recipients.length === 0) {
          logger.warn('[NotificationService] no recipients for event', {
            eventType: event.type,
            eventId: event.id,
          });
          return;
        }

        // 批量创建通知记录
        const created = await prisma.notification.createMany({
          data: recipients.map((userId) => ({
            id: `ntf_${event.id}_${userId}`,
            userId,
            type: content.type,
            title: content.title,
            body: content.body,
            level: content.level,
            link: content.link ?? null,
            metadata: {
              eventId: event.id,
              eventType: event.type,
              sourceEntityType: event.sourceEntityType,
              sourceEntityId: event.sourceEntityId,
              orderId: event.orderId ?? null,
              actorId: event.actorId,
              occurredAt: event.occurredAt,
            } as any,
          })),
          skipDuplicates: true,  // 幂等：相同 event.id+userId 不重复创建
        });

        if (created.count > 0) {
          // SSE 推送给所有在线客户端
          publishNotificationEvent({
            type: content.type,
            title: content.title,
            body: content.body,
            level: content.level,
            link: content.link,
            eventId: event.id,
            eventType: event.type,
            orderId: event.orderId,
            recipientIds: recipients,
          });
          logger.info('[NotificationService] notifications delivered', {
            eventType: event.type,
            eventId: event.id,
            recipients: recipients.length,
          });
        }
      } catch (e: any) {
        // 通知失败永不阻断业务
        logger.error('[NotificationService] notifyFromEvent failed', {
          error: e?.message,
          eventType: event.type,
          eventId: event.id,
        });
      }
    },

    async createNotification(params): Promise<Notification> {
      const id = `ntf_manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return prisma.notification.create({
        data: {
          id,
          userId: params.userId,
          type: params.type,
          title: params.title,
          body: params.body,
          level: params.level ?? 'info',
          link: params.link ?? null,
          metadata: (params.metadata as any) ?? null,
        },
      });
    },

    async broadcastNotification(params): Promise<{ count: number }> {
      const recipients = await resolveRecipients(prisma, null as any);
      if (recipients.length === 0) {
        logger.warn('[NotificationService] broadcast: no active recipients');
        return { count: 0 };
      }
      const baseId = `ntf_brd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const created = await prisma.notification.createMany({
        data: recipients.map((userId) => ({
          id: `${baseId}_${userId}`,
          userId,
          type: params.type,
          title: params.title,
          body: params.body,
          level: params.level ?? 'info',
          link: params.link ?? null,
          metadata: (params.metadata as any) ?? null,
        })),
        skipDuplicates: true,
      });
      // SSE 推送
      publishNotificationEvent({
        type: params.type,
        title: params.title,
        body: params.body,
        level: params.level ?? 'info',
        link: params.link,
        eventId: baseId,
        eventType: params.type,
        recipientIds: recipients,
      });
      return { count: created.count };
    },

    async sendToUser(params): Promise<Notification | null> {
      try {
        const id = `ntf_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const notification = await prisma.notification.create({
          data: {
            id,
            userId: params.userId,
            type: params.type,
            title: params.title,
            body: params.body,
            level: params.level ?? 'info',
            link: params.link ?? null,
            metadata: (params.metadata as any) ?? null,
          },
        });
        // SSE 推送给该用户
        publishNotificationEvent({
          type: params.type,
          title: params.title,
          body: params.body,
          level: params.level ?? 'info',
          link: params.link,
          eventId: id,
          eventType: params.type,
          recipientIds: [params.userId],
        });
        return notification;
      } catch (e: any) {
        logger.error('[NotificationService] sendToUser failed', { error: e?.message, userId: params.userId });
        return null;
      }
    },

    async broadcastToRole(params): Promise<{ count: number }> {
      try {
        // 查找拥有该角色的所有 active 用户
        const usersWithRole = await prisma.userRole.findMany({
          where: { role: { name: params.role } },
          select: { userId: true },
        });
        const userIds = [...new Set(usersWithRole.map(ur => ur.userId))];
        if (userIds.length === 0) {
          logger.warn('[NotificationService] broadcastToRole: no users with role', { role: params.role });
          return { count: 0 };
        }
        const baseId = `ntf_role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const created = await prisma.notification.createMany({
          data: userIds.map((userId) => ({
            id: `${baseId}_${userId}`,
            userId,
            type: params.type,
            title: params.title,
            body: params.body,
            level: params.level ?? 'info',
            link: params.link ?? null,
            metadata: (params.metadata as any) ?? null,
          })),
          skipDuplicates: true,
        });
        // SSE 推送
        publishNotificationEvent({
          type: params.type,
          title: params.title,
          body: params.body,
          level: params.level ?? 'info',
          link: params.link,
          eventId: baseId,
          eventType: params.type,
          recipientIds: userIds,
        });
        logger.info('[NotificationService] broadcastToRole delivered', { role: params.role, recipients: userIds.length });
        return { count: created.count };
      } catch (e: any) {
        logger.error('[NotificationService] broadcastToRole failed', { error: e?.message, role: params.role });
        return { count: 0 };
      }
    },

    async listNotifications(params): Promise<{ items: Notification[]; total: number }> {
      const { userId, unreadOnly, type, level, limit = 50, offset = 0 } = params;
      const where: Record<string, unknown> = { userId };
      if (unreadOnly) where.readAt = null;
      if (type) where.type = type;
      if (level) where.level = level;

      const [items, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.notification.count({ where }),
      ]);
      return { items, total };
    },

    async getStats(userId: string): Promise<NotificationStats> {
      const [total, unread, critical, byTypeRaw] = await Promise.all([
        prisma.notification.count({ where: { userId } }),
        prisma.notification.count({ where: { userId, readAt: null } }),
        prisma.notification.count({ where: { userId, readAt: null, level: 'critical' } }),
        prisma.notification.groupBy({
          by: ['type'],
          where: { userId, readAt: null },
          _count: { type: true },
        }),
      ]);
      const byType: Record<string, number> = {};
      for (const row of byTypeRaw) {
        byType[row.type] = row._count.type;
      }
      return { total, unread, critical, byType };
    },

    async markAsRead(userId: string, notificationId: string): Promise<{ ok: boolean }> {
      const result = await prisma.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { ok: result.count > 0 };
    },

    async markAllAsRead(userId: string): Promise<{ ok: boolean; count: number }> {
      const result = await prisma.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { ok: true, count: result.count };
    },

    async deleteNotification(userId: string, notificationId: string): Promise<{ ok: boolean }> {
      const result = await prisma.notification.deleteMany({
        where: { id: notificationId, userId },
      });
      return { ok: result.count > 0 };
    },
  };
}

// ────────────────────────────────────────────────────────────────
// 接收人解析
// ────────────────────────────────────────────────────────────────

/**
 * 解析事件的接收人列表。
 *
 * Sprint 1 策略（单租户 + Electron 桌面 + Mac Mini）：
 *   - 所有 active 状态的 UserAccount 都收到通知
 *   - 这符合小企业 ERP 实际：所有员工都看到业务动态
 *
 * Phase 1+ 增强方向：
 *   - 订单事件 → 订单的 salesPersonRelationId / merchandiserRelationId 对应的 UserAccount
 *   - 发票事件 → finance 角色 + 销售
 *   - 生产事件 → production_manager 角色
 *   - 通过 NotificationPreference 进一步过滤
 */
async function resolveRecipients(prisma: PrismaClient, _event: BusinessEvent): Promise<string[]> {
  try {
    const users = await prisma.userAccount.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    return users.map((u) => u.id);
  } catch (e: any) {
    logger.error('[NotificationService] resolveRecipients failed', { error: e?.message });
    return [];
  }
}
