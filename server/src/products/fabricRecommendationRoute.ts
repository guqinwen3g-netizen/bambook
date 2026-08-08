/**
 * 阶段 P2 — 面料推荐路由（PRD 6.2 P2 FabricRecommendation），挂载于 /api/v1/fabric-recommendations
 *
 * 端点：
 *   - POST   /recommend  — 执行推荐（确定性打分，结果落库）
 *   - GET    /           — 历史列表（?limit=&offset=）
 *   - GET    /:id        — 详情（criteria + results 快照）
 *   - DELETE /:id        — 软删
 *
 * 守卫口径与 pricing 模块一致：读走 JWT 或 API-Key，写必须 JWT。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { createFabricRecommendationService, RecommendCriteria } from './fabricRecommendationService';

export interface FabricRecommendationRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

function serializeValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeValue) as T;
  if (typeof value === 'object') {
    if ((value as any).constructor?.name === 'Decimal') return Number((value as any).toString()) as T;
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) out[k] = serializeValue(v);
    return out;
  }
  return value;
}

export function createFabricRecommendationRouter(options: FabricRecommendationRouterOptions): Router {
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const router = Router();
  const service = createFabricRecommendationService(prisma);

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const notify = (action: string, ids?: string[]) => onDataChange?.({ entity: 'fabricRecommendation', action, ids });

  const handleError = (res: Response, e: any, code: string) => {
    const msg = e?.message || 'operation failed';
    logger.error(`[FabricRecommendationRoute] ${code}`, { error: msg });
    const isClient = msg.includes('必填') || msg.includes('非法') || msg.includes('至少') || msg.includes('不可大于');
    const isNotFound = msg.includes('不存在');
    res.status(isNotFound ? 404 : isClient ? 400 : 500).json({ error: { code, message: msg } });
  };

  router.post('/recommend', requireWrite, async (req: Request, res: Response) => {
    try {
      const row = await service.recommend(req.body as RecommendCriteria, actorIdFromRequest(req));
      notify('create_fabric_recommendation', [row.id]);
      res.status(201).json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'FR_RECOMMEND_FAILED');
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const result = await service.listRecommendations({
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'FR_LIST_FAILED');
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const row = await service.getRecommendation(req.params.id);
      res.json(serializeValue({ item: row }));
    } catch (e: any) {
      handleError(res, e, 'FR_GET_FAILED');
    }
  });

  router.delete('/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      await service.deleteRecommendation(req.params.id, actorIdFromRequest(req));
      notify('delete_fabric_recommendation', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'FR_DELETE_FAILED');
    }
  });

  return router;
}
