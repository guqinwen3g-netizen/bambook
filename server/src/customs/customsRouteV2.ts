/**
 * customsRouteV2.ts — 报关/外贸 V2 路由（权限守卫）
 *
 * 挂载点：/api/v2/customs
 * 业务逻辑复用现有 customsService，叠加 requirePermission 守卫
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { extractActorFromRequest } from '../auth/middleware';
import { createCustomsService } from './customsService';

export interface CustomsV2RouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createCustomsV2Router(opts: CustomsV2RouterOptions): Router {
  const router = Router();
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  const svc = createCustomsService(opts.prisma);

  const actorId = (req: Request) => extractActorFromRequest(req)?.userId || '';

  function serialize(row: any): any {
    if (!row) return null;
    const out: any = Array.isArray(row) ? [...row] : { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
      if (out[k] && typeof out[k] === 'object' && out[k]._isBigNumber) out[k] = Number(out[k].toString());
    }
    return out;
  }

  // ════ CustomsDeclaration ════
  router.get('/declarations', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listDeclarations({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        type: typeof req.query.customsType === 'string' ? req.query.customsType : undefined,
        orderId: typeof req.query.orderId === 'string' ? req.query.orderId : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ ok: true, items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/declarations/:id', requirePermission('customs:read'), async (req, res) => {
    try {
      const item = await svc.getDeclaration(req.params.id);
      res.json({ ok: true, declaration: serialize(item) });
    } catch (e: any) { res.status(404).json({ error: 'NOT_FOUND', message: e?.message }); }
  });

  router.post('/declarations', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.createDeclaration(req.body, actorId(req));
      res.json({ ok: true, declaration: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/declarations/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.updateDeclaration(req.params.id, req.body, actorId(req));
      res.json({ ok: true, declaration: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/declarations/:id/transition', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const toStatus = typeof req.body?.toStatus === 'string' ? req.body.toStatus.trim() : '';
      if (!toStatus) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'body.toStatus 必填' });
      const item = await svc.transitionDeclarationStatus(req.params.id, toStatus as any, actorId(req));
      res.json({ ok: true, declaration: serialize(item) });
    } catch (e: any) {
      const code = e?.message?.includes('INVALID') ? 409 : 500;
      res.status(code).json({ error: e?.message, message: e?.message });
    }
  });

  router.delete('/declarations/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      await svc.deleteDeclaration(req.params.id, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ════ TaxRefund ════
  router.get('/tax-refunds', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listTaxRefunds({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        orderId: typeof req.query.orderId === 'string' ? req.query.orderId : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ ok: true, items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/tax-refunds/:id', requirePermission('customs:read'), async (req, res) => {
    try {
      const item = await svc.getTaxRefund(req.params.id);
      res.json({ ok: true, taxRefund: serialize(item) });
    } catch (e: any) { res.status(404).json({ error: 'NOT_FOUND', message: e?.message }); }
  });

  router.post('/tax-refunds', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.createTaxRefund(req.body, actorId(req));
      res.json({ ok: true, taxRefund: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/tax-refunds/:id/transition', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const toStatus = typeof req.body?.toStatus === 'string' ? req.body.toStatus.trim() : '';
      if (!toStatus) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'body.toStatus 必填' });
      const item = await svc.transitionTaxRefundStatus(req.params.id, toStatus as any, actorId(req));
      res.json({ ok: true, taxRefund: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/tax-refunds/:id/review', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.reviewTaxRefund(req.params.id, req.body, actorId(req));
      res.json({ ok: true, taxRefund: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/tax-refunds/from-declaration/:declarationId', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.createTaxRefundFromDeclaration(req.params.declarationId, actorId(req));
      res.json({ ok: true, taxRefund: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ════ TradeDocument ════
  router.get('/documents', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listTradeDocuments({
        orderId: typeof req.query.orderId === 'string' ? req.query.orderId : undefined,
        type: typeof req.query.docType === 'string' ? req.query.docType : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ ok: true, items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/documents/:id', requirePermission('customs:read'), async (req, res) => {
    try {
      const item = await svc.getTradeDocument(req.params.id);
      res.json({ ok: true, document: serialize(item) });
    } catch (e: any) { res.status(404).json({ error: 'NOT_FOUND', message: e?.message }); }
  });

  router.post('/documents', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.createTradeDocument(req.body, actorId(req));
      res.json({ ok: true, document: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ════ LetterOfCredit（只读） ════
  router.get('/lc', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listLettersOfCredit({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        orderId: typeof req.query.orderId === 'string' ? req.query.orderId : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ ok: true, items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/lc/:id', requirePermission('customs:read'), async (req, res) => {
    try {
      const item = await svc.getLetterOfCredit(req.params.id);
      res.json({ ok: true, letterOfCredit: serialize(item) });
    } catch (e: any) { res.status(404).json({ error: 'NOT_FOUND', message: e?.message }); }
  });

  // ════ HsCode（只读参考数据） ════
  router.get('/hs-codes', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listHsCodes({
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ ok: true, items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  return router;
}
