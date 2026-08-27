/**
 * customsRouteV2.ts — 报关/外贸 V2 路由（权限守卫）
 *
 * 挂载点：/api/v2/customs
 * 业务逻辑复用现有 customsService，叠加 requirePermission 守卫
 *
 * G6 新旧接口收敛（2026-08-28）：四大域（报关单/HS 编码/信用证/出口退税）端点与 v1 全量对齐
 *   （同路径、同查询参数、同 { item } 响应形状），前端已统一切换至本路由；v1 对应端点加 deprecated 逐步废弃。
 *   /documents 系列为 V2 早期只读/创建端点，保持原形状不变。
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';
import {
  createCustomsService,
  CustomsDeclarationInput,
  HsCodeInput,
  LetterOfCreditInput,
  TaxRefundInput,
  TaxRefundReviewInput,
  CustomsDeclarationStatus,
  LetterOfCreditStatus,
  TaxRefundStatus,
} from './customsService';

export interface CustomsV2RouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

const VALID_DECLARATION_STATUSES: CustomsDeclarationStatus[] = ['Draft', 'Submitted', 'Declared', 'Inspecting', 'Released', 'Exception', 'Cancelled'];
const VALID_LC_STATUSES: LetterOfCreditStatus[] = ['Issued', 'Presented', 'Accepted', 'Discrepant', 'Settled', 'Expired', 'Cancelled'];
const VALID_TAX_REFUND_STATUSES: TaxRefundStatus[] = ['Draft', 'Submitted', 'Reviewing', 'Approved', 'Rejected', 'Refunded', 'Cancelled'];

/** 与 v1 路由同口径的错误码映射（不存在→404 / 冲突与非法→409 / 其余→400） */
function errStatus(msg: string, fallback = 400): number {
  if (msg.includes('不存在')) return 404;
  if (msg.includes('已存在')) return 409;
  if (msg.includes('非法') || msg.includes('不可删除') || msg.includes('不可编辑') || msg.includes('不可审核') || msg.includes('不可')) return 409;
  return fallback;
}

export function createCustomsV2Router(opts: CustomsV2RouterOptions): Router {
  const router = Router();
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  const svc = createCustomsService(opts.prisma);

  const actorId = (req: Request) => extractActorFromRequest(req)?.userId || 'system';

  function serialize(row: any): any {
    if (!row) return null;
    const out: any = Array.isArray(row) ? [...row] : { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
      if (out[k] && typeof out[k] === 'object' && out[k]._isBigNumber) out[k] = Number(out[k].toString());
    }
    return out;
  }

  // ════ CustomsDeclaration（报关单，与 v1 同路径/同形状） ════
  router.get('/declarations', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listDeclarations({
        type: req.query.type as string | undefined,
        status: req.query.status as string | undefined,
        shipmentId: req.query.shipmentId as string | undefined,
        orderId: req.query.orderId as string | undefined,
        relationId: req.query.relationId as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json({ items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET declarations failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list declarations' });
    }
  });

  router.get('/declarations/:id', requirePermission('customs:read'), async (req, res) => {
    try {
      const item = await svc.getDeclaration(req.params.id);
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get declaration' });
    }
  });

  router.post('/declarations', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const input = req.body as CustomsDeclarationInput;
      if (!input.type) {
        return res.status(400).json({ error: 'type is required（declarationNumber 留空自动取号）' });
      }
      const item = await svc.createDeclaration(input, actorId(req));
      res.status(201).json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create declaration' });
    }
  });

  router.put('/declarations/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.updateDeclaration(req.params.id, req.body as Partial<CustomsDeclarationInput>, actorId(req));
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] PUT declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update declaration' });
    }
  });

  router.delete('/declarations/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const result = await svc.deleteDeclaration(req.params.id, actorId(req));
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRouteV2] DELETE declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete declaration' });
    }
  });

  router.post('/declarations/:id/transition', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const { toStatus } = req.body as { toStatus: CustomsDeclarationStatus };
      if (!toStatus || !VALID_DECLARATION_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法报关单状态: ${toStatus}` });
      }
      const item = await svc.transitionDeclarationStatus(req.params.id, toStatus, actorId(req));
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST declaration transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition declaration' });
    }
  });

  // ════ HsCode（HS 编码库，与 v1 同路径/同形状） ════
  router.get('/hs-codes', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listHsCodes({
        category: req.query.category as string | undefined,
        search: req.query.search as string | undefined,
        isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json({ items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET hs-codes failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list hs-codes' });
    }
  });

  router.get('/hs-codes/:code', requirePermission('customs:read'), async (req, res) => {
    try {
      const item = await svc.getHsCodeByCode(req.params.code);
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET hs-code failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get hs-code' });
    }
  });

  router.post('/hs-codes', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const input = req.body as HsCodeInput;
      if (!input.code || !input.description || !input.category) {
        return res.status(400).json({ error: 'code, description and category are required' });
      }
      const item = await svc.createHsCode(input, actorId(req));
      res.status(201).json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST hs-code failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create hs-code' });
    }
  });

  router.put('/hs-codes/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.updateHsCode(req.params.id, req.body as Partial<HsCodeInput>, actorId(req));
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] PUT hs-code failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update hs-code' });
    }
  });

  router.delete('/hs-codes/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const result = await svc.deleteHsCode(req.params.id, actorId(req));
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRouteV2] DELETE hs-code failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete hs-code' });
    }
  });

  // ════ LetterOfCredit（信用证，与 v1 同路径/同形状） ════
  router.get('/letters-of-credit', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listLettersOfCredit({
        status: req.query.status as string | undefined,
        relationId: req.query.relationId as string | undefined,
        orderId: req.query.orderId as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json({ items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET letters-of-credit failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list letters-of-credit' });
    }
  });

  router.get('/letters-of-credit/:id', requirePermission('customs:read'), async (req, res) => {
    try {
      const item = await svc.getLetterOfCredit(req.params.id);
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get letter-of-credit' });
    }
  });

  router.post('/letters-of-credit', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const input = req.body as LetterOfCreditInput;
      if (!input.lcNumber || !input.type || input.amount == null) {
        return res.status(400).json({ error: 'lcNumber, type and amount are required' });
      }
      const item = await svc.createLetterOfCredit(input, actorId(req));
      res.status(201).json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create letter-of-credit' });
    }
  });

  router.put('/letters-of-credit/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.updateLetterOfCredit(req.params.id, req.body as Partial<LetterOfCreditInput>, actorId(req));
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] PUT letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update letter-of-credit' });
    }
  });

  router.delete('/letters-of-credit/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const result = await svc.deleteLetterOfCredit(req.params.id, actorId(req));
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRouteV2] DELETE letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete letter-of-credit' });
    }
  });

  router.post('/letters-of-credit/:id/transition', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const { toStatus, discrepancies } = req.body as { toStatus: LetterOfCreditStatus; discrepancies?: string };
      if (!toStatus || !VALID_LC_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法信用证状态: ${toStatus}` });
      }
      const item = await svc.transitionLcStatus(req.params.id, toStatus, actorId(req), discrepancies);
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST letter-of-credit transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition letter-of-credit' });
    }
  });

  // F1：信用证节点时间轴（LcEvent 全量升序）
  router.get('/letters-of-credit/:id/events', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listLcEvents(req.params.id);
      res.json({ items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET letter-of-credit events failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to list lc events' });
    }
  });

  // ════ TaxRefund（出口退税，与 v1 同路径/同形状） ════
  router.get('/tax-refunds', requirePermission('customs:read'), async (req, res) => {
    try {
      const result = await svc.listTaxRefunds({
        status: req.query.status as string | undefined,
        declarationId: req.query.declarationId as string | undefined,
        orderId: req.query.orderId as string | undefined,
        relationId: req.query.relationId as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json({ items: (result.items || []).map(serialize), total: result.total });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET tax-refunds failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list tax-refunds' });
    }
  });

  router.get('/tax-refunds/:id', requirePermission('customs:read'), async (req, res) => {
    try {
      const item = await svc.getTaxRefund(req.params.id);
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] GET tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get tax-refund' });
    }
  });

  router.post('/tax-refunds', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const input = req.body as TaxRefundInput;
      if (!input.refundNumber) {
        return res.status(400).json({ error: 'refundNumber is required' });
      }
      const item = await svc.createTaxRefund(input, actorId(req));
      res.status(201).json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create tax-refund' });
    }
  });

  // G4：从报关单自动核算生成退税草稿（L10 同一入口，手动触发）
  router.post('/tax-refunds/from-declaration/:declarationId', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.createTaxRefundFromDeclaration(req.params.declarationId, actorId(req));
      res.status(201).json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST tax-refund from-declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create tax-refund from declaration' });
    }
  });

  router.put('/tax-refunds/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const item = await svc.updateTaxRefund(req.params.id, req.body as Partial<TaxRefundInput>, actorId(req));
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] PUT tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update tax-refund' });
    }
  });

  router.delete('/tax-refunds/:id', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const result = await svc.deleteTaxRefund(req.params.id, actorId(req));
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRouteV2] DELETE tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete tax-refund' });
    }
  });

  router.post('/tax-refunds/:id/transition', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const { toStatus } = req.body as { toStatus: TaxRefundStatus };
      if (!toStatus || !VALID_TAX_REFUND_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法退税状态: ${toStatus}` });
      }
      const item = await svc.transitionTaxRefundStatus(req.params.id, toStatus, actorId(req));
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST tax-refund transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition tax-refund' });
    }
  });

  // G3：审核人取真实登录人（actorId 来自认证身份），body 无需/不应再传 reviewedBy
  router.post('/tax-refunds/:id/review', requireWrite, requirePermission('customs:write'), async (req, res) => {
    try {
      const input = req.body as TaxRefundReviewInput;
      if (!input.decision || !['Approved', 'Rejected'].includes(input.decision)) {
        return res.status(400).json({ error: 'decision must be Approved or Rejected' });
      }
      const item = await svc.reviewTaxRefund(req.params.id, input, actorId(req));
      res.json({ item: serialize(item) });
    } catch (e: any) {
      logger.error('[CustomsRouteV2] POST tax-refund review failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to review tax-refund' });
    }
  });

  // ════ TradeDocument（V2 早期端点，保持原形状；单据中心仍走 v1 trade-documents） ════
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

  return router;
}
