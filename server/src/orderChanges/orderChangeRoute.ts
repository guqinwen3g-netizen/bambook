/**
 * orderChangeRoute.ts — DR-010 订单变更/取消/暂停 API
 *
 * 挂载：createOrderChangeRouter({ prisma, requireAuth })
 * 路径：/api/v1/order-changes（由主代理在 index.ts 收口）
 *
 * 端点：
 *   POST /              — 创建变更申请（scope order:change_request:create）
 *   GET  /              — 列表（按 orderId / status / requesterId 过滤）
 *   GET  /:id           — 详情
 *   POST /:id/apply     — 审批通过后生效（scope order:change_request:apply）
 *   POST /:id/withdraw  — 申请人撤回（仅 Pending）
 *
 * 鉴权：JWT fail-closed（无 token 401，无 scope 403）
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { hasScopeOnRequest } from '../auth/permissionGuard';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';
import {
  createOrderChangeRequestService,
  ORDER_CHANGE_TYPES,
  type OrderChangeType,
} from './orderChangeRequestService';
import { logger } from '../lib/logger';

export interface OrderChangeRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
}

export function createOrderChangeRouter(options: OrderChangeRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth } = options;

  const routingService = createApprovalRoutingService({ prisma });
  const approvalCreateService = createApprovalCreateService({ prisma, routingService });
  const changeService = createOrderChangeRequestService({ prisma, approvalCreateService });

  // ── 鉴权：JWT fail-closed ──
  const authenticate = (req: Request, res: Response): { userId: string; roles: string[] } | null => {
    const actor = extractActorFromRequest(req);
    if (!actor?.userId) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required.' });
      return null;
    }
    (req as any).actor = actor; // 供 hasScopeOnRequest 使用（permissionGuard 从 req.actor 取权限）
    return { userId: actor.userId, roles: actor.roles ?? [] };
  };

  const requireScope = (req: Request, res: Response, scope: string): boolean => {
    if (!requireAuth) return true;
    if (!hasScopeOnRequest(req, scope as any)) {
      res.status(403).json({ error: 'FORBIDDEN', message: `INSUFFICIENT_SCOPE: ${scope}` });
      return false;
    }
    return true;
  };

  // ══════════════════════════════════════════════════════════════════
  // POST / — 创建变更申请
  // ══════════════════════════════════════════════════════════════════
  router.post('/', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, 'order:change_request:create')) return;

    try {
      const body = req.body || {};
      const changeTypeRaw = String(body.changeType ?? '').trim() as OrderChangeType;
      if (!ORDER_CHANGE_TYPES.includes(changeTypeRaw)) {
        return res.status(400).json({ error: 'INVALID_CHANGE_TYPE', message: `非法变更类型: ${changeTypeRaw}` });
      }

      const result = await changeService.createChangeRequest({
        orderId: String(body.orderId ?? '').trim(),
        changeType: changeTypeRaw,
        beforeSnapshot: body.beforeSnapshot ?? {},
        afterDelta: body.afterDelta ?? {},
        changeReason: String(body.changeReason ?? '').trim(),
        impactSummary: String(body.impactSummary ?? '').trim(),
        requesterId: auth.userId,
        pauseReason: body.pauseReason ? String(body.pauseReason).trim() : undefined,
        pauseOwnerId: body.pauseOwnerId ? String(body.pauseOwnerId).trim() : undefined,
        expectedResumeDate: body.expectedResumeDate ? String(body.expectedResumeDate).trim() : undefined,
        attachments: body.attachments,
      });

      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.status(201).json(result.data);
    } catch (e: any) {
      logger.error('[OrderChangeRoute] POST / failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '创建变更申请失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // GET / — 列表（支持 orderId / status / requesterId 过滤）
  // ══════════════════════════════════════════════════════════════════
  router.get('/', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const where: any = { deletedAt: null };
      if (req.query.orderId) where.orderId = String(req.query.orderId);
      if (req.query.status) where.status = String(req.query.status);
      if (req.query.requesterId) where.requesterId = String(req.query.requesterId);
      const items = await prisma.orderChangeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(req.query.limit ?? 100), 500),
      });
      return res.json({ items });
    } catch (e: any) {
      logger.error('[OrderChangeRoute] GET / failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '查询变更申请列表失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // GET /:id — 详情
  // ══════════════════════════════════════════════════════════════════
  router.get('/:id', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const item = await prisma.orderChangeRequest.findUnique({
        where: { id: req.params.id },
      });
      if (!item || item.deletedAt) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `变更申请 ${req.params.id} 不存在` });
      }
      // 关联数据单独查询（OrderChangeRequest 模型无 @relation，禁用 include）
      const [order, approvalRequest] = await Promise.all([
        prisma.order.findUnique({
          where: { id: item.orderId },
          select: { id: true, status: true, poNumber: true, customer: true },
        }).catch(() => null),
        item.approvalRequestId
          ? prisma.approvalRequest.findUnique({
              where: { id: item.approvalRequestId },
              select: { id: true, status: true, reviewerId: true, decidedAt: true, decisionNote: true },
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      return res.json({ item: { ...item, order, approvalRequest } });
    } catch (e: any) {
      logger.error('[OrderChangeRoute] GET /:id failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '查询变更申请详情失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // POST /:id/apply — 审批通过后生效（幂等）
  // ══════════════════════════════════════════════════════════════════
  router.post('/:id/apply', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, 'order:change_request:apply')) return;

    try {
      const result = await changeService.applyChangeRequest({
        changeRequestId: req.params.id,
        appliedBy: auth.userId,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(result.data);
    } catch (e: any) {
      logger.error('[OrderChangeRoute] POST /:id/apply failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '变更生效失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // POST /:id/withdraw — 申请人撤回（仅 Pending）
  // ══════════════════════════════════════════════════════════════════
  router.post('/:id/withdraw', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const result = await changeService.withdrawChangeRequest({
        changeRequestId: req.params.id,
        actorId: auth.userId,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(result.data);
    } catch (e: any) {
      logger.error('[OrderChangeRoute] POST /:id/withdraw failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '撤回变更申请失败' });
    }
  });

  return router;
}
