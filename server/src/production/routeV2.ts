/**
 * productionRouteV2.ts — 生产管线 V2 路由（权限守卫）
 *
 * 挂载点：/api/v2/production
 * 业务逻辑复用现有 stageService，叠加 requirePermission 守卫
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { extractActorFromRequest } from '../auth/middleware';
import {
  advanceStage, getProductionBoard, getProductionPipeline,
  savePreCutChecklist, saveInspectionReport, signStage, parseStageKey,
} from './stageService';

export interface ProductionV2RouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createProductionV2Router(opts: ProductionV2RouterOptions): Router {
  const router = Router();
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });

  const actorId = (req: Request) => extractActorFromRequest(req)?.userId || '';

  function serialize(row: any): any {
    if (!row) return null;
    const out: any = Array.isArray(row) ? [...row] : { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
    }
    return out;
  }

  // ── 看板 ──
  router.get('/board', requirePermission('production:read'), async (req, res) => {
    try {
      const data = await getProductionBoard(opts.prisma);
      res.json({ ok: true, board: serialize(data) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── 订单管线详情 ──
  router.get('/:orderId', requirePermission('production:read'), async (req, res) => {
    try {
      const data = await getProductionPipeline(opts.prisma, req.params.orderId);
      if (!data) return res.status(404).json({ error: 'NOT_FOUND', message: '订单生产管线不存在' });
      res.json({ ok: true, pipeline: serialize(data) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── 推进阶段（含门禁检查）──
  router.post('/:orderId/advance/:stageKey', requireWrite, requirePermission('production:write'), async (req, res) => {
    try {
      const stageKey = parseStageKey(req.params.stageKey);
      if (!stageKey) return res.status(400).json({ error: 'INVALID_STAGE', message: `stageKey 不合法: ${req.params.stageKey}` });
      const result = await advanceStage({
        prisma: opts.prisma,
        orderId: req.params.orderId,
        stageKey,
        operator: actorId(req),
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      });
      if (!result.ok) {
        const code = result.error.code === 'ORDER_NOT_FOUND' ? 404
          : result.error.code === 'STAGE_NOT_SEQUENTIAL' ? 409
          : 422;
        return res.status(code).json({ error: result.error.code, message: result.error.message });
      }
      res.json({ ok: true, stage: serialize(result.data.stage) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── 保存 PreCutChecklist ──
  router.put('/:orderId/checklist', requireWrite, requirePermission('production:write'), async (req, res) => {
    try {
      const result = await savePreCutChecklist(opts.prisma, req.params.orderId, req.body);
      res.json({ ok: true, checklist: serialize(result) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── 保存 InspectionReport ──
  router.put('/:orderId/inspection', requireWrite, requirePermission('production:write'), async (req, res) => {
    try {
      const result = await saveInspectionReport(opts.prisma, req.params.orderId, req.body);
      res.json({ ok: true, inspection: serialize(result) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── 签署阶段（产前样双签等）──
  router.post('/:orderId/sign/:stageKey', requireWrite, requirePermission('production:write'), async (req, res) => {
    try {
      const stageKey = parseStageKey(req.params.stageKey);
      if (!stageKey) return res.status(400).json({ error: 'INVALID_STAGE', message: `stageKey 不合法` });
      const signType = req.body?.signType === 'production' || req.body?.signType === 'business' ? req.body.signType : '';
      if (!signType) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'body.signType 必填（production/business）' });
      const result = await signStage({
        prisma: opts.prisma,
        orderId: req.params.orderId,
        stageKey,
        signType,
        signerId: actorId(req),
      });
      res.json({ ok: true, stage: serialize(result) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  return router;
}
