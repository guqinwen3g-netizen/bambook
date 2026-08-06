/**
 * Phase 0 Sprint 1 — 通知 REST API
 *
 * 端点：
 *   GET    /v1/notifications              列出当前用户通知（支持 unreadOnly/type/level/limit/offset）
 *   GET    /v1/notifications/stats         获取未读统计
 *   POST   /v1/notifications/:id/read      标记单条已读
 *   POST   /v1/notifications/read-all      标记全部已读
 *   DELETE /v1/notifications/:id           删除通知
 *
 * 鉴权：从 req.actor.userId 解析当前用户（cookie JWT 或 API key actor）
 */

import { Router, Request, Response } from 'express';
import { getNotificationService } from './eventBindings';

export function createNotificationsRouter(): Router {
  const router = Router();

  // 鉴权中间件：要求 actor 必须有 userId（非纯 API key）
  const requireUser = (req: Request, res: Response, next: () => void) => {
    const userId = (req as any).actor?.userId;
    if (!userId) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User authentication required for notifications.',
      });
    }
    (req as any).notificationUserId = userId;
    next();
  };

  // GET /v1/notifications — 列出当前用户通知
  router.get('/', requireUser, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).notificationUserId as string;
      const service = getNotificationService();
      const { items, total } = await service.listNotifications({
        userId,
        unreadOnly: req.query.unreadOnly === 'true',
        type: typeof req.query.type === 'string' ? req.query.type : undefined,
        level: typeof req.query.level === 'string' ? req.query.level : undefined,
        limit: req.query.limit ? Math.min(Number(req.query.limit), 200) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ items, total });
    } catch (e: any) {
      res.status(500).json({
        error: 'LIST_FAILED',
        message: String(e?.message ?? e),
      });
    }
  });

  // GET /v1/notifications/stats — 获取未读统计
  router.get('/stats', requireUser, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).notificationUserId as string;
      const service = getNotificationService();
      const stats = await service.getStats(userId);
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({
        error: 'STATS_FAILED',
        message: String(e?.message ?? e),
      });
    }
  });

  // POST /v1/notifications/:id/read — 标记单条已读
  router.post('/:id/read', requireUser, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).notificationUserId as string;
      const service = getNotificationService();
      const result = await service.markAsRead(userId, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Notification not found or already read.' });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({
        error: 'MARK_READ_FAILED',
        message: String(e?.message ?? e),
      });
    }
  });

  // POST /v1/notifications/read-all — 标记全部已读
  router.post('/read-all', requireUser, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).notificationUserId as string;
      const service = getNotificationService();
      const result = await service.markAllAsRead(userId);
      res.json({ ok: true, count: result.count });
    } catch (e: any) {
      res.status(500).json({
        error: 'MARK_ALL_READ_FAILED',
        message: String(e?.message ?? e),
      });
    }
  });

  // DELETE /v1/notifications/:id — 删除通知
  router.delete('/:id', requireUser, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).notificationUserId as string;
      const service = getNotificationService();
      const result = await service.deleteNotification(userId, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Notification not found.' });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({
        error: 'DELETE_FAILED',
        message: String(e?.message ?? e),
      });
    }
  });

  return router;
}
