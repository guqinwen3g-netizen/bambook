/**
 * routeV2.ts — Phase 1-02 订单/履约域 V2 路由
 *
 * 挂载点：/api/v2/orders
 *
 * 路由表：
 *   GET    /                  — 列表（带 scope + 筛选 + 分页）
 *   GET    /kanban            — 看板聚合（按 status 分组 count）
 *   GET    /:id               — 详情（带 scope 校验）
 *   POST   /                  — 创建（编号 + 字典 + 配置默认值）
 *   PUT    /:id               — 更新（scope + 字典校验）
 *   PATCH  /:id/status        — 状态流转（状态机校验 + 留痕）
 *   DELETE /:id               — 软删除（scope 校验）
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { extractActorFromRequest } from '../auth/middleware';
import { createOrderServiceV2 } from './orderServiceV2';

export interface OrdersV2RouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createOrdersV2Router(opts: OrdersV2RouterOptions): Router {
  const router = Router();

  const guard = createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  router.use(guard);

  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  const svc = createOrderServiceV2(opts.prisma);

  function actorOf(req: Request) {
    return extractActorFromRequest(req);
  }

  // ── GET / 列表 ──
  router.get('/', requirePermission('orders:read'), async (req, res) => {
    const actor = actorOf(req);
    const filter = {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      ownerId: typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined,
      departmentId: typeof req.query.departmentId === 'string' ? req.query.departmentId : undefined,
      customerCode: typeof req.query.customerCode === 'string' ? req.query.customerCode : undefined,
      customerRelationId: typeof req.query.customerRelationId === 'string' ? req.query.customerRelationId : undefined,
      businessLine: typeof req.query.businessLine === 'string' ? req.query.businessLine : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
    };
    const result = await svc.listOrders(actor, filter);
    if (!result.ok) return res.status(500).json({ error: result.error!.code, message: result.error!.message });
    return res.json({ ok: true, ...result.data });
  });

  // ── GET /kanban 看板聚合 ──
  router.get('/kanban', requirePermission('orders:read'), async (req, res) => {
    const actor = actorOf(req);
    const filter = {
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      businessLine: typeof req.query.businessLine === 'string' ? req.query.businessLine : undefined,
    };
    const result = await svc.getKanban(actor, filter);
    if (!result.ok) return res.status(500).json({ error: result.error!.code, message: result.error!.message });
    return res.json({ ok: true, ...result.data });
  });

  // ── GET /:id 详情 ──
  router.get('/:id', requirePermission('orders:read'), async (req, res) => {
    const actor = actorOf(req);
    const result = await svc.getOrder(actor, req.params.id);
    if (!result.ok) {
      const status = result.error!.code === 'NOT_FOUND' ? 404 : 500;
      return res.status(status).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ── POST / 创建 ──
  router.post('/', requireWrite, requirePermission('orders:write'), async (req, res) => {
    const actor = actorOf(req);
    const result = await svc.createOrder(actor, req.body || {});
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401, FORBIDDEN: 403, VALIDATION_FAILED: 400, SEQUENCE_FAILED: 500, INTERNAL_ERROR: 500,
      };
      return res.status(statusMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ── PUT /:id 更新 ──
  router.put('/:id', requireWrite, requirePermission('orders:write'), async (req, res) => {
    const actor = actorOf(req);
    const result = await svc.updateOrder(actor, req.params.id, req.body || {});
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401, FORBIDDEN: 403, VALIDATION_FAILED: 400, NOT_FOUND: 404, INTERNAL_ERROR: 500,
      };
      return res.status(statusMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ── PATCH /:id/status 状态流转 ──
  router.patch('/:id/status', requireWrite, requirePermission('orders:write'), async (req, res) => {
    const actor = actorOf(req);
    const newStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
    if (!newStatus) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'body.status 必填' });
    const result = await svc.transitionStatus(actor, req.params.id, newStatus, reason);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401, VALIDATION_FAILED: 400, NOT_FOUND: 404, INVALID_TRANSITION: 409, INTERNAL_ERROR: 500,
      };
      return res.status(statusMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  // ── DELETE /:id 软删除 ──
  router.delete('/:id', requireWrite, requirePermission('orders:delete'), async (req, res) => {
    const actor = actorOf(req);
    const result = await svc.deleteOrder(actor, req.params.id);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INTERNAL_ERROR: 500,
      };
      return res.status(statusMap[result.error!.code] || 500).json({ error: result.error!.code, message: result.error!.message });
    }
    return res.json({ ok: true, order: result.data });
  });

  return router;
}
