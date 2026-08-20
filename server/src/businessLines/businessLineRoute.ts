/**
 * 阶段 P0 回补 — 业务线模块路由（PRD 6.2），挂载于 /api/v1/business-lines
 *
 * 端点：
 *   - GET    /                          — 业务线列表（?includeInactive=true，sortOrder 升序）
 *   - POST   /                          — 注册业务线 {code, name, ...}
 *   - PUT    /order/:orderId            — 订单业务线标记 {businessLine: code | null}（字面路由先于 /:id）
 *   - GET    /order/:orderId/moq-check  — 订单 MOQ 软校验
 *   - PATCH  /:id                       — 更新业务线（code 不可改）
 *   - DELETE /:id                       — 软删（仍有订单引用时拒绝）
 *
 * 守卫口径与 seasons/risk 模块一致：读走 JWT 或 API-Key，写必须 JWT（requireJwtForWrite）。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { serializeValue } from '../lib/serializeValue';
import { createBusinessLineService, BusinessLineInput } from './businessLineService';

export interface BusinessLineRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createBusinessLineRouter(options: BusinessLineRouterOptions): Router {
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const router = Router();
  const service = createBusinessLineService(prisma);

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const notify = (action: string, ids?: string[]) => onDataChange?.({ entity: 'business-lines', action, ids });

  const handleError = (res: Response, e: any, code: string) => {
    const msg = e?.message || 'operation failed';
    logger.error(`[BusinessLineRoute] ${code}`, { error: msg });
    const isClient =
      msg.includes('必填') || msg.includes('非法') || msg.includes('必须是') ||
      msg.includes('已存在') || msg.includes('不可修改') || msg.includes('不可删除') ||
      msg.includes('已停用');
    const isNotFound = msg.includes('不存在');
    res.status(isNotFound ? 404 : isClient ? 400 : 500).json({ error: { code, message: msg } });
  };

  router.get('/', async (req: Request, res: Response) => {
    try {
      const result = await service.listBusinessLines({ includeInactive: req.query.includeInactive === 'true' });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'BL_LIST_FAILED');
    }
  });

  router.post('/', requireWrite, async (req: Request, res: Response) => {
    try {
      const bl = await service.createBusinessLine(req.body as BusinessLineInput, actorIdFromRequest(req));
      notify('create_business_line', [bl.id]);
      res.status(201).json(serializeValue({ ok: true, item: bl }));
    } catch (e: any) {
      handleError(res, e, 'BL_CREATE_FAILED');
    }
  });

  // 字面路由 /order/:orderId 须在参数路由 /:id 前
  router.put('/order/:orderId', requireWrite, async (req: Request, res: Response) => {
    try {
      const code = req.body?.businessLine === undefined ? null : req.body.businessLine;
      const order = await service.setOrderBusinessLine(req.params.orderId, code, actorIdFromRequest(req));
      notify('set_order_business_line', [req.params.orderId]);
      res.json(serializeValue({ ok: true, item: order }));
    } catch (e: any) {
      handleError(res, e, 'BL_SET_ORDER_FAILED');
    }
  });

  router.get('/order/:orderId/moq-check', async (req: Request, res: Response) => {
    try {
      res.json(serializeValue(await service.checkOrderMoq(req.params.orderId)));
    } catch (e: any) {
      handleError(res, e, 'BL_MOQ_CHECK_FAILED');
    }
  });

  router.patch('/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const bl = await service.updateBusinessLine(req.params.id, req.body ?? {}, actorIdFromRequest(req));
      notify('update_business_line', [bl.id]);
      res.json(serializeValue({ ok: true, item: bl }));
    } catch (e: any) {
      handleError(res, e, 'BL_UPDATE_FAILED');
    }
  });

  router.delete('/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      await service.deleteBusinessLine(req.params.id, actorIdFromRequest(req));
      notify('delete_business_line', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'BL_DELETE_FAILED');
    }
  });

  return router;
}
