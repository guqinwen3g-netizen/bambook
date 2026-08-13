/**
 * seasonRouteV2.ts — Phase 1 季节管理 V2 路由（权限守卫）
 *
 * 挂载点：/api/v2/seasons
 * 业务逻辑复用现有 seasonService，叠加 requirePermission 守卫
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { extractActorFromRequest } from '../auth/middleware';
import { createSeasonService } from './seasonService';

export interface SeasonsV2RouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createSeasonsV2Router(opts: SeasonsV2RouterOptions): Router {
  const router = Router();
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  const svc = createSeasonService(opts.prisma);

  const actorId = (req: Request) => extractActorFromRequest(req)?.userId || '';

  function serialize(row: any): any {
    if (!row) return null;
    const out: any = Array.isArray(row) ? [...row] : { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
    }
    return out;
  }

  // ── Season CRUD ──
  router.get('/', requirePermission('seasons:read'), async (req, res) => {
    try {
      const query: any = {};
      if (typeof req.query.status === 'string') query.status = req.query.status;
      if (typeof req.query.search === 'string') query.search = req.query.search;
      query.limit = req.query.limit ? Number(req.query.limit) : 50;
      query.offset = req.query.offset ? Number(req.query.offset) : 0;
      const result = await svc.listSeasons(query);
      res.json({ ok: true, ...result, items: result.items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const item = await svc.createSeason(req.body, actorId(req));
      res.json({ ok: true, season: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/:id', requirePermission('seasons:read'), async (req, res) => {
    try {
      const item = await svc.getSeason(req.params.id);
      if (!item) return res.status(404).json({ error: 'NOT_FOUND' });
      res.json({ ok: true, season: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/:id', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const item = await svc.updateSeason(req.params.id, req.body, actorId(req));
      res.json({ ok: true, season: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/:id', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      await svc.deleteSeason(req.params.id, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Season Review ──
  router.get('/:id/review', requirePermission('seasons:read'), async (req, res) => {
    try {
      const data = await svc.computeSeasonReview(req.params.id);
      res.json({ ok: true, review: serialize(data) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:id/review/generate', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const data = await svc.generateSeasonReview(req.params.id, actorId(req));
      res.json({ ok: true, review: serialize(data) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Trend Tags ──
  router.get('/:id/trend-tags', requirePermission('seasons:read'), async (req, res) => {
    try {
      const items = await svc.listTrendTags({ seasonId: req.params.id, type: typeof req.query.type === 'string' ? req.query.type : undefined });
      res.json({ ok: true, trendTags: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:id/trend-tags', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const item = await svc.createTrendTag({ ...req.body, seasonId: req.params.id }, actorId(req));
      res.json({ ok: true, trendTag: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/trend-tags/:tagId', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const item = await svc.updateTrendTag(req.params.tagId, req.body, actorId(req));
      res.json({ ok: true, trendTag: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/trend-tags/:tagId', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      await svc.deleteTrendTag(req.params.tagId, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Trending Fabrics ──
  router.get('/trending/fabrics', requirePermission('seasons:read'), async (req, res) => {
    try {
      const items = await svc.listTrendingFabrics({ seasonId: typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined });
      res.json({ ok: true, fabrics: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Trade Shows ──
  router.get('/trade-shows', requirePermission('seasons:read'), async (req, res) => {
    try {
      const items = await svc.listTradeShows({
        seasonId: typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      res.json({ ok: true, tradeShows: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/trade-shows', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const item = await svc.createTradeShow(req.body, actorId(req));
      res.json({ ok: true, tradeShow: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/trade-shows/:id', requirePermission('seasons:read'), async (req, res) => {
    try {
      const item = await svc.getTradeShow(req.params.id);
      if (!item) return res.status(404).json({ error: 'NOT_FOUND' });
      res.json({ ok: true, tradeShow: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/trade-shows/:id', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const item = await svc.updateTradeShow(req.params.id, req.body, actorId(req));
      res.json({ ok: true, tradeShow: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/trade-shows/:id', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      await svc.deleteTradeShow(req.params.id, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Trade Show Leads ──
  router.post('/trade-shows/:id/leads', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const item = await svc.addLead(req.params.id, req.body, actorId(req));
      res.json({ ok: true, lead: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/leads/:leadId', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const item = await svc.updateLead(req.params.leadId, req.body, actorId(req));
      res.json({ ok: true, lead: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/leads/:leadId', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      await svc.deleteLead(req.params.leadId, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/leads/:leadId/convert', requireWrite, requirePermission('seasons:write'), async (req, res) => {
    try {
      const relationId = typeof req.body?.relationId === 'string' ? req.body.relationId : '';
      if (!relationId) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'relationId 必填' });
      const item = await svc.convertLead(req.params.leadId, relationId, actorId(req));
      res.json({ ok: true, lead: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Trade Show ROI ──
  router.get('/trade-shows/:id/roi', requirePermission('seasons:read'), async (req, res) => {
    try {
      const data = await svc.getShowROI(req.params.id);
      res.json({ ok: true, roi: serialize(data) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  return router;
}
