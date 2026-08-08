/**
 * 外贸与报关 API — /api/v1/customs
 *
 * 端点：
 *   ── 报关单 CustomsDeclaration ──
 *   GET    /declarations              — 报关单列表（支持 type/status/shipmentId/orderId/relationId/search 过滤）
 *   GET    /declarations/:id          — 报关单详情（含明细行）
 *   POST   /declarations              — 创建报关单（含明细行）
 *   PUT    /declarations/:id           — 更新报关单（仅 Draft）
 *   DELETE /declarations/:id          — 软删除报关单（仅 Draft/Cancelled）
 *   POST   /declarations/:id/transition — 状态流转
 *
 *   ── HS 编码 HsCode ──
 *   GET    /hs-codes                  — HS 编码列表（支持 category/search/isActive 过滤）
 *   GET    /hs-codes/:code             — 按 code 查询 HS 编码
 *   POST   /hs-codes                   — 创建 HS 编码
 *   PUT    /hs-codes/:id               — 更新 HS 编码
 *   DELETE /hs-codes/:id               — 停用 HS 编码（deactivate）
 *
 *   ── 信用证 LetterOfCredit ──
 *   GET    /letters-of-credit          — 信用证列表（支持 status/relationId/orderId/search 过滤）
 *   GET    /letters-of-credit/:id      — 信用证详情
 *   POST   /letters-of-credit          — 创建信用证
 *   PUT    /letters-of-credit/:id      — 更新信用证（仅 Issued）
 *   DELETE /letters-of-credit/:id      — 软删除信用证（仅 Issued/Cancelled）
 *   POST   /letters-of-credit/:id/transition — 状态流转
 *   GET    /letters-of-credit/:id/events    — 节点时间轴（F1 LcEvent 升序全量）
 *
 *   ── 出口退税 TaxRefund ──
 *   GET    /tax-refunds                — 退税列表（支持 status/declarationId/orderId/relationId/search 过滤）
 *   GET    /tax-refunds/:id            — 退税详情
 *   POST   /tax-refunds                — 创建退税记录（自动计算退税额）
 *   POST   /tax-refunds/from-declaration/:declarationId — 从报关单自动核算生成退税草稿（L10 同一入口）
 *   PUT    /tax-refunds/:id            — 更新退税记录（仅 Draft）
 *   DELETE /tax-refunds/:id            — 软删除退税记录（仅 Draft/Cancelled）
 *   POST   /tax-refunds/:id/transition — 状态流转
 *   POST   /tax-refunds/:id/review     — 审核（Approved/Rejected）
 *
 *   ── 贸易单据 TradeDocument ──
 *   GET    /trade-documents           — 单据列表（支持 type/status/shipmentId/declarationId/orderId/relationId/search 过滤）
 *   GET    /trade-documents/:id       — 单据详情
 *   POST   /trade-documents           — 创建单据
 *   PUT    /trade-documents/:id       — 更新单据（仅 Draft）
 *   DELETE /trade-documents/:id       — 软删除单据（仅 Draft/Cancelled）
 *   POST   /trade-documents/:id/transition — 状态流转
 *
 *   ── 概览 ──
 *   GET    /overview                   — 外贸报关概览统计
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { logger } from '../lib/logger';
import {
  createCustomsService,
  CustomsDeclarationInput,
  CustomsDeclarationLineInput,
  HsCodeInput,
  LetterOfCreditInput,
  TaxRefundInput,
  TaxRefundReviewInput,
  TradeDocumentInput,
  CustomsDeclarationStatus,
  LetterOfCreditStatus,
  TaxRefundStatus,
  TradeDocumentStatus,
  TradeDocumentType,
} from './customsService';
import { createDocumentTemplateService } from './documentTemplateService';

export interface CustomsRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

const VALID_DECLARATION_STATUSES: CustomsDeclarationStatus[] = ['Draft', 'Submitted', 'Declared', 'Inspecting', 'Released', 'Exception', 'Cancelled'];
const VALID_LC_STATUSES: LetterOfCreditStatus[] = ['Issued', 'Presented', 'Accepted', 'Discrepant', 'Settled', 'Expired', 'Cancelled'];
const VALID_TAX_REFUND_STATUSES: TaxRefundStatus[] = ['Draft', 'Submitted', 'Reviewing', 'Approved', 'Rejected', 'Refunded', 'Cancelled'];
const VALID_DOC_STATUSES: TradeDocumentStatus[] = ['Draft', 'Issued', 'Submitted', 'Accepted', 'Rejected', 'Cancelled'];

function errStatus(msg: string, fallback = 400): number {
  if (msg.includes('不存在')) return 404;
  if (msg.includes('已存在')) return 409;
  if (msg.includes('非法') || msg.includes('不可删除') || msg.includes('不可编辑') || msg.includes('不可审核') || msg.includes('不可')) return 409;
  return fallback;
}

export function createCustomsRouter(options: CustomsRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const service = createCustomsService(prisma);
  const docTemplates = createDocumentTemplateService(prisma);

  const authenticate = (req: Request, res: Response): boolean => {
    if (!requireAuth) return true;
    const apiKey = (req.query.apiKey as string) || (req.headers['x-bambook-api-key'] as string);
    if (apiKey && apiKeys.has(apiKey)) return true;
    const actor = extractActorFromRequest(req);
    if (actor?.userId) return true;
    res.status(401).json({ error: 'authentication required' });
    return false;
  };

  const actorOf = (req: Request): string => {
    const actor = extractActorFromRequest(req);
    return actor?.userId || 'system';
  };

  // 统一认证守卫
  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  // 写操作必须 JWT
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });

  // ════════════════════════════════════════════════════════════
  // 1. CustomsDeclaration（报关单）
  // ════════════════════════════════════════════════════════════

  router.get('/declarations', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const result = await service.listDeclarations({
        type: req.query.type as string | undefined,
        status: req.query.status as string | undefined,
        shipmentId: req.query.shipmentId as string | undefined,
        orderId: req.query.orderId as string | undefined,
        relationId: req.query.relationId as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET declarations failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list declarations' });
    }
  });

  router.get('/declarations/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await service.getDeclaration(req.params.id);
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] GET declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get declaration' });
    }
  });

  router.post('/declarations', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as CustomsDeclarationInput;
      if (!input.declarationNumber || !input.type) {
        return res.status(400).json({ error: 'declarationNumber and type are required' });
      }
      const item = await service.createDeclaration(input, actorOf(req));
      onDataChange?.({ entity: 'CustomsDeclaration', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create declaration' });
    }
  });

  router.put('/declarations/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as Partial<CustomsDeclarationInput>;
      const item = await service.updateDeclaration(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'CustomsDeclaration', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] PUT declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update declaration' });
    }
  });

  router.delete('/declarations/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteDeclaration(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'CustomsDeclaration', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete declaration' });
    }
  });

  router.post('/declarations/:id/transition', requireWrite, async (req: Request, res: Response) => {
    try {
      const { toStatus } = req.body as { toStatus: CustomsDeclarationStatus };
      if (!toStatus || !VALID_DECLARATION_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法报关单状态: ${toStatus}` });
      }
      const item = await service.transitionDeclarationStatus(req.params.id, toStatus, actorOf(req));
      onDataChange?.({ entity: 'CustomsDeclaration', action: 'transition', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST declaration transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition declaration' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // 2. HsCode（HS 编码库）
  // ════════════════════════════════════════════════════════════

  router.get('/hs-codes', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const result = await service.listHsCodes({
        category: req.query.category as string | undefined,
        search: req.query.search as string | undefined,
        isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET hs-codes failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list hs-codes' });
    }
  });

  router.get('/hs-codes/:code', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await service.getHsCodeByCode(req.params.code);
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] GET hs-code failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get hs-code' });
    }
  });

  router.post('/hs-codes', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as HsCodeInput;
      if (!input.code || !input.description || !input.category) {
        return res.status(400).json({ error: 'code, description and category are required' });
      }
      const item = await service.createHsCode(input, actorOf(req));
      onDataChange?.({ entity: 'HsCode', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST hs-code failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create hs-code' });
    }
  });

  router.put('/hs-codes/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as Partial<HsCodeInput>;
      const item = await service.updateHsCode(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'HsCode', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] PUT hs-code failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update hs-code' });
    }
  });

  router.delete('/hs-codes/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteHsCode(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'HsCode', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE hs-code failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete hs-code' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // 3. LetterOfCredit（信用证）
  // ════════════════════════════════════════════════════════════

  router.get('/letters-of-credit', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const result = await service.listLettersOfCredit({
        status: req.query.status as string | undefined,
        relationId: req.query.relationId as string | undefined,
        orderId: req.query.orderId as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET letters-of-credit failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list letters-of-credit' });
    }
  });

  router.get('/letters-of-credit/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await service.getLetterOfCredit(req.params.id);
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] GET letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get letter-of-credit' });
    }
  });

  router.post('/letters-of-credit', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as LetterOfCreditInput;
      if (!input.lcNumber || !input.type || input.amount == null) {
        return res.status(400).json({ error: 'lcNumber, type and amount are required' });
      }
      const item = await service.createLetterOfCredit(input, actorOf(req));
      onDataChange?.({ entity: 'LetterOfCredit', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create letter-of-credit' });
    }
  });

  router.put('/letters-of-credit/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as Partial<LetterOfCreditInput>;
      const item = await service.updateLetterOfCredit(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'LetterOfCredit', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] PUT letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update letter-of-credit' });
    }
  });

  router.delete('/letters-of-credit/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteLetterOfCredit(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'LetterOfCredit', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete letter-of-credit' });
    }
  });

  router.post('/letters-of-credit/:id/transition', requireWrite, async (req: Request, res: Response) => {
    try {
      const { toStatus, discrepancies } = req.body as { toStatus: LetterOfCreditStatus; discrepancies?: string };
      if (!toStatus || !VALID_LC_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法信用证状态: ${toStatus}` });
      }
      const item = await service.transitionLcStatus(req.params.id, toStatus, actorOf(req), discrepancies);
      onDataChange?.({ entity: 'LetterOfCredit', action: 'transition', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST letter-of-credit transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition letter-of-credit' });
    }
  });

  // F1：信用证节点时间轴（LcEvent 全量升序）
  router.get('/letters-of-credit/:id/events', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const result = await service.listLcEvents(req.params.id);
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET letter-of-credit events failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to list lc events' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // 4. TaxRefund（出口退税）
  // ════════════════════════════════════════════════════════════

  router.get('/tax-refunds', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const result = await service.listTaxRefunds({
        status: req.query.status as string | undefined,
        declarationId: req.query.declarationId as string | undefined,
        orderId: req.query.orderId as string | undefined,
        relationId: req.query.relationId as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET tax-refunds failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list tax-refunds' });
    }
  });

  router.get('/tax-refunds/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await service.getTaxRefund(req.params.id);
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] GET tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get tax-refund' });
    }
  });

  router.post('/tax-refunds', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as TaxRefundInput;
      if (!input.refundNumber) {
        return res.status(400).json({ error: 'refundNumber is required' });
      }
      const item = await service.createTaxRefund(input, actorOf(req));
      onDataChange?.({ entity: 'TaxRefund', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create tax-refund' });
    }
  });

  router.post('/tax-refunds/from-declaration/:declarationId', requireWrite, async (req: Request, res: Response) => {
    try {
      const item = await service.createTaxRefundFromDeclaration(req.params.declarationId, actorOf(req));
      onDataChange?.({ entity: 'TaxRefund', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST tax-refund from-declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create tax-refund from declaration' });
    }
  });

  router.put('/tax-refunds/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as Partial<TaxRefundInput>;
      const item = await service.updateTaxRefund(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'TaxRefund', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] PUT tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update tax-refund' });
    }
  });

  router.delete('/tax-refunds/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteTaxRefund(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'TaxRefund', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete tax-refund' });
    }
  });

  router.post('/tax-refunds/:id/transition', requireWrite, async (req: Request, res: Response) => {
    try {
      const { toStatus } = req.body as { toStatus: TaxRefundStatus };
      if (!toStatus || !VALID_TAX_REFUND_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法退税状态: ${toStatus}` });
      }
      const item = await service.transitionTaxRefundStatus(req.params.id, toStatus, actorOf(req));
      onDataChange?.({ entity: 'TaxRefund', action: 'transition', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST tax-refund transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition tax-refund' });
    }
  });

  router.post('/tax-refunds/:id/review', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as TaxRefundReviewInput;
      if (!input.decision || !['Approved', 'Rejected'].includes(input.decision)) {
        return res.status(400).json({ error: 'decision must be Approved or Rejected' });
      }
      if (!input.reviewedBy) {
        return res.status(400).json({ error: 'reviewedBy is required' });
      }
      const item = await service.reviewTaxRefund(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'TaxRefund', action: 'review', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST tax-refund review failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to review tax-refund' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // 5. TradeDocument（贸易单据）
  // ════════════════════════════════════════════════════════════

  router.get('/trade-documents', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const result = await service.listTradeDocuments({
        type: req.query.type as string | undefined,
        status: req.query.status as string | undefined,
        shipmentId: req.query.shipmentId as string | undefined,
        declarationId: req.query.declarationId as string | undefined,
        orderId: req.query.orderId as string | undefined,
        relationId: req.query.relationId as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET trade-documents failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list trade-documents' });
    }
  });

  router.get('/trade-documents/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await service.getTradeDocument(req.params.id);
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] GET trade-document failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get trade-document' });
    }
  });

  router.post('/trade-documents', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as TradeDocumentInput;
      if (!input.documentNumber || !input.type) {
        return res.status(400).json({ error: 'documentNumber and type are required' });
      }
      const item = await service.createTradeDocument(input, actorOf(req));
      onDataChange?.({ entity: 'TradeDocument', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST trade-document failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create trade-document' });
    }
  });

  router.put('/trade-documents/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as Partial<TradeDocumentInput>;
      const item = await service.updateTradeDocument(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'TradeDocument', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] PUT trade-document failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update trade-document' });
    }
  });

  router.delete('/trade-documents/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteTradeDocument(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'TradeDocument', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE trade-document failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete trade-document' });
    }
  });

  router.post('/trade-documents/:id/transition', requireWrite, async (req: Request, res: Response) => {
    try {
      const { toStatus } = req.body as { toStatus: TradeDocumentStatus };
      if (!toStatus || !VALID_DOC_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法单据状态: ${toStatus}` });
      }
      const item = await service.transitionTradeDocumentStatus(req.params.id, toStatus, actorOf(req));
      onDataChange?.({ entity: 'TradeDocument', action: 'transition', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST trade-document transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition trade-document' });
    }
  });

  // ─── 单据版本留痕（阶段 P3a，PRD 11.3 DocumentVersion）───

  router.get('/trade-documents/:id/versions', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const result = await docTemplates.listVersions(req.params.id);
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET trade-document versions failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to list document versions' });
    }
  });

  router.get('/trade-documents/:id/versions/:version', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const version = Number(req.params.version);
      if (!Number.isInteger(version) || version < 1) {
        return res.status(400).json({ error: '非法版本号' });
      }
      const item = await docTemplates.getVersion(req.params.id, version);
      res.json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] GET trade-document version failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to get document version' });
    }
  });

  router.post('/trade-documents/:id/versions', requireWrite, async (req: Request, res: Response) => {
    try {
      const item = await docTemplates.createVersion(req.params.id, req.body ?? {}, actorOf(req));
      onDataChange?.({ entity: 'TradeDocument', action: 'create_version', ids: [req.params.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST trade-document version failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create document version' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // Overview
  // ════════════════════════════════════════════════════════════

  router.get('/overview', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const overview = await service.getCustomsOverview();
      res.json(overview);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET overview failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get overview' });
    }
  });

  return router;
}
