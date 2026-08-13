/**
 * factoryRouteV2.ts — Phase 1 供应商管理 V2 路由（权限守卫）
 *
 * 挂载点：/api/v2/suppliers
 * 业务逻辑复用现有 factoryService，叠加 requirePermission 守卫
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { extractActorFromRequest } from '../auth/middleware';
import { createFactoryService } from './factoryService';

export interface SuppliersV2RouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createSuppliersV2Router(opts: SuppliersV2RouterOptions): Router {
  const router = Router();
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  const svc = createFactoryService(opts.prisma);

  const actorId = (req: Request) => extractActorFromRequest(req)?.userId || '';

  function serialize(row: any): any {
    if (!row) return null;
    const out: any = Array.isArray(row) ? [...row] : { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
    }
    return out;
  }

  // ── Profile ──
  router.get('/', requirePermission('suppliers:read'), async (req, res) => {
    try {
      const query: any = {};
      if (typeof req.query.search === 'string') query.search = req.query.search;
      if (typeof req.query.specialty === 'string') query.specialty = req.query.specialty;
      if (typeof req.query.blacklisted === 'string') query.blacklisted = req.query.blacklisted === 'true';
      query.limit = req.query.limit ? Number(req.query.limit) : 50;
      query.offset = req.query.offset ? Number(req.query.offset) : 0;
      const result = await svc.listProfiles(query);
      res.json({ ok: true, ...result, items: result.items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/by-relation/:relationId', requirePermission('suppliers:read'), async (req, res) => {
    try {
      const item = await svc.getProfileByRelation(req.params.relationId);
      res.json({ ok: true, profile: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      const item = await svc.createProfile(req.body, actorId(req));
      res.json({ ok: true, profile: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/:id', requirePermission('suppliers:read'), async (req, res) => {
    try {
      const item = await svc.getProfile(req.params.id);
      if (!item) return res.status(404).json({ error: 'NOT_FOUND' });
      res.json({ ok: true, profile: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/:id', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      const item = await svc.updateProfile(req.params.id, req.body, actorId(req));
      res.json({ ok: true, profile: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/:id', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      await svc.deleteProfile(req.params.id, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Blacklist ──
  router.post('/:id/blacklist', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      const item = await svc.setBlacklist(req.params.id, req.body?.reason || '', actorId(req));
      res.json({ ok: true, profile: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/:id/blacklist', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      const item = await svc.clearBlacklist(req.params.id, actorId(req));
      res.json({ ok: true, profile: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Evaluation ──
  router.get('/:id/evaluations', requirePermission('suppliers:read'), async (req, res) => {
    try {
      const items = await svc.listEvaluations(req.params.id, typeof req.query.kind === 'string' ? req.query.kind : undefined);
      res.json({ ok: true, evaluations: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:id/evaluations', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      const item = await svc.addEvaluation(req.params.id, req.body, actorId(req));
      res.json({ ok: true, evaluation: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Certification ──
  router.get('/:id/certifications', requirePermission('suppliers:read'), async (req, res) => {
    try {
      const items = await svc.listCertifications(req.params.id);
      res.json({ ok: true, certifications: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:id/certifications', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      const item = await svc.addCertification(req.params.id, req.body, actorId(req));
      res.json({ ok: true, certification: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/certifications/:certId', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      const item = await svc.updateCertification(req.params.certId, req.body, actorId(req));
      res.json({ ok: true, certification: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/certifications/:certId', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      await svc.deleteCertification(req.params.certId, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/certifications/expiring', requirePermission('suppliers:read'), async (req, res) => {
    try {
      const days = req.query.days ? Number(req.query.days) : 30;
      const items = await svc.listExpiringCertifications(days);
      res.json({ ok: true, expiring: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Capacity ──
  router.get('/:id/capacity', requirePermission('suppliers:read'), async (req, res) => {
    try {
      const items = await svc.listCapacity(req.params.id);
      res.json({ ok: true, capacity: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:id/capacity', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      const item = await svc.upsertCapacity(req.params.id, req.body, actorId(req));
      res.json({ ok: true, capacity: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/:id/capacity/:month', requireWrite, requirePermission('suppliers:write'), async (req, res) => {
    try {
      await svc.deleteCapacity(req.params.id, req.params.month, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ── Overview ──
  router.get('/:id/overview', requirePermission('suppliers:read'), async (req, res) => {
    try {
      const data = await svc.getOverview(req.params.id);
      res.json({ ok: true, ...serialize(data) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  return router;
}
