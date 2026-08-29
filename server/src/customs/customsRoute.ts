/**
 * 外贸与报关 API — /api/v1/customs
 *
 * @deprecated（G6 新旧接口收敛，2026-08-28）前端四大域（报关单/HS 编码/信用证/出口退税）已统一走
 *   /api/v2/customs（带 customs:read/customs:write 细粒度权限守卫），本路由对应端点逐步废弃、新代码请勿调用。
 *   注意：trade-documents 系列端点（单据中心/出运制单在用）暂未迁移，仍由本路由服务。
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
 *   GET    /trade-documents/pack?orderId= — 订单单据批量打包（最新版本快照，L/C 交单场景；Wave A1）
 *   GET    /trade-documents/:id       — 单据详情
 *   POST   /trade-documents           — 创建单据（documentNumber 留空自动取号，Wave A1）
 *   POST   /trade-documents/generate-from-shipment — 运单批量生成单据草稿（生成即登记+v1 快照，幂等；Wave A1）
 *   PUT    /trade-documents/:id       — 更新单据（仅 Draft，服务端强制版本留痕）
 *   DELETE /trade-documents/:id       — 软删除单据（仅 Draft/Cancelled）
 *   POST   /trade-documents/:id/transition — 状态流转
 *   GET    /trade-documents/:id/versions   — 版本列表
 *   GET    /trade-documents/:id/versions/:version — 指定版本快照
 *   POST   /trade-documents/:id/versions   — 手动追加版本（编辑内容快照）
 *
 *   ── 概览 ──
 *   GET    /overview                   — 外贸报关概览统计
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
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
import { generateTradeDocumentsFromShipment, generateTradeDocumentFile, packTradeDocumentsByOrder, renderTradeDocumentServerHtml } from './tradeDocumentLifecycleService';
import { assembleCompositeDocument, isCompositeDocKind } from './compositeDocumentService';
import { renderServerDocument, isShipmentDocKind } from '../templates/docTemplates/registry';
import { renderHtmlToPdf } from '../templates/pdf';
import { assembleDocumentSetData } from '../shipping/documentSetService';
import JSZip from 'jszip';
import path from 'path';
import fs from 'fs';

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
  // S3-γ：写端点在 JWT 之上叠加 customs:write scope 门（与 /api/v2/customs 守卫口径对齐；
  // LOGISTICS 持有，SuperAdmin/owner 全通；读端点不动）
  const requireCustomsWrite = requirePermission('customs:write');

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

  router.post('/declarations', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.put('/declarations/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.delete('/declarations/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteDeclaration(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'CustomsDeclaration', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete declaration' });
    }
  });

  router.post('/declarations/:id/transition', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.post('/hs-codes', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.put('/hs-codes/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.delete('/hs-codes/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.post('/letters-of-credit', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.put('/letters-of-credit/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.delete('/letters-of-credit/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteLetterOfCredit(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'LetterOfCredit', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE letter-of-credit failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete letter-of-credit' });
    }
  });

  router.post('/letters-of-credit/:id/transition', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.post('/tax-refunds', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.post('/tax-refunds/from-declaration/:declarationId', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const item = await service.createTaxRefundFromDeclaration(req.params.declarationId, actorOf(req));
      onDataChange?.({ entity: 'TaxRefund', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST tax-refund from-declaration failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create tax-refund from declaration' });
    }
  });

  router.put('/tax-refunds/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.delete('/tax-refunds/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteTaxRefund(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'TaxRefund', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE tax-refund failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete tax-refund' });
    }
  });

  router.post('/tax-refunds/:id/transition', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.post('/tax-refunds/:id/review', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as TaxRefundReviewInput;
      if (!input.decision || !['Approved', 'Rejected'].includes(input.decision)) {
        return res.status(400).json({ error: 'decision must be Approved or Rejected' });
      }
      // G3：reviewedBy 不再要求请求体传入——审核人取真实登录人（actorOf 解析 JWT 身份），由 service 层落留痕
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
        domain: req.query.domain as string | undefined,
        shipmentId: req.query.shipmentId as string | undefined,
        declarationId: req.query.declarationId as string | undefined,
        orderId: req.query.orderId as string | undefined,
        relationId: req.query.relationId as string | undefined,
        sourceInvoiceId: req.query.sourceInvoiceId as string | undefined,
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

  // Wave A1：批量打包须注册在 /trade-documents/:id 之前，避免 'pack' 被当作 id 捕获
  router.get('/trade-documents/pack', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const orderId = (req.query.orderId as string) || '';
      if (!orderId) return res.status(400).json({ error: 'orderId 必填' });
      const result = await packTradeDocumentsByOrder(prisma, orderId);
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET trade-documents pack failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to pack trade-documents' });
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

  // Wave A1：运单 → 单据草稿批量生成（生成即登记 + v1 快照，同 shipmentId+type 幂等）
  router.post('/trade-documents/generate-from-shipment', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const { shipmentId, types } = req.body as { shipmentId?: string; types?: TradeDocumentType[] };
      if (!shipmentId || !Array.isArray(types) || types.length === 0) {
        return res.status(400).json({ error: 'shipmentId 与 types（非空数组）必填' });
      }
      const result = await generateTradeDocumentsFromShipment(prisma, { shipmentId, types, actorId: actorOf(req) });
      if (result.created.length > 0) {
        onDataChange?.({ entity: 'TradeDocument', action: 'create', ids: result.created.map((c) => c.id) });
      }
      res.status(201).json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] POST trade-documents generate-from-shipment failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to generate trade-documents' });
    }
  });

  // 一键生成文件：服务端模板优先（CI 财务回链/注册表 PL 等），其余前端渲染 HTML 传入
  // → 服务端 Puppeteer 转 PDF 落盘 uploads/trade-documents/ → 回写 filePath/fileName
  router.post('/trade-documents/:id/generate-file', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const { html, version } = req.body as { html?: string; version?: number };
      const result = await generateTradeDocumentFile(prisma, {
        id: req.params.id,
        html: html ?? '',
        version: typeof version === 'number' ? version : undefined,
        actorId: actorOf(req),
      });
      onDataChange?.({ entity: 'TradeDocument', action: 'update', ids: [req.params.id] });
      res.status(201).json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] POST trade-documents generate-file failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to generate trade-document file' });
    }
  });

  // 单据服务端预览（2026-08-22 B1 架构底座）：服务端模板类型（CI 财务回链 / PL 注册表）
  // 返回 screen 模式 A4 纸张画布 HTML（与 generate-file PDF 同源渲染，所见即所得）；
  // 其余类型（模板真源暂在前端）返回 501——前端走本地渲染器
  router.get('/trade-documents/:id/preview.html', async (req: Request, res: Response) => {
    try {
      const doc = await prisma.tradeDocument.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!doc) return res.status(404).json({ error: `贸易单据 ${req.params.id} 不存在` });
      const html = await renderTradeDocumentServerHtml(prisma, doc, { screen: true });
      if (!html) return res.status(501).json({ error: 'SERVER_TEMPLATE_NOT_AVAILABLE', message: '该单据类型暂无服务端模板（前端本地渲染）' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e: any) {
      logger.error('[CustomsRoute] GET trade-documents preview.html failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to preview trade-document' });
    }
  });

  // POST /trade-documents/batch-download — 多选单据 ZIP 打包下载（B4 批量操作）：
  // 已归档文件直读；filePath 缺失的单据现场生成（幂等覆盖）保证打包完整。
  router.post('/trade-documents/batch-download', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((v: unknown) => typeof v === 'string' && v) : [];
      if (ids.length === 0) return res.status(400).json({ error: 'ids 必填（至少一个单据）' });

      const actorId = (req as any).user?.userId || 'system';
      const zip = new JSZip();
      const usedNames = new Set<string>();
      const skipped: Array<{ id: string; reason: string }> = [];
      let packed = 0;

      for (const id of ids) {
        const doc = await prisma.tradeDocument.findFirst({ where: { id, deletedAt: null } });
        if (!doc) { skipped.push({ id, reason: '不存在' }); continue; }
        try {
          // filePath 缺失 → 现场生成（服务端模板优先，幂等覆盖）；已有归档直读
          if (!doc.filePath) {
            await generateTradeDocumentFile(prisma, { id: doc.id, actorId });
          }
          const fresh = await prisma.tradeDocument.findUnique({ where: { id: doc.id }, select: { filePath: true, fileName: true } });
          if (!fresh?.filePath) { skipped.push({ id, reason: '生成失败' }); continue; }
          const absPath = path.join(process.env.BAMBOOK_UPLOAD_DIR || path.join(__dirname, '../../../uploads'), fresh.filePath);
          if (!fs.existsSync(absPath)) { skipped.push({ id, reason: '归档文件缺失' }); continue; }
          // zip 内文件名去重（同号多版本场景加序号后缀）
          let entryName = fresh.fileName || `${doc.documentNumber}.pdf`;
          let i = 2;
          while (usedNames.has(entryName)) entryName = entryName.replace(/(\.[^.]+)$/, `_${i++}$1`);
          usedNames.add(entryName);
          zip.file(entryName, fs.readFileSync(absPath));
          packed += 1;
        } catch (e: any) {
          skipped.push({ id, reason: e?.message || '生成失败' });
        }
      }

      if (packed === 0) {
        return res.status(404).json({ error: `无文件可打包（${skipped.length} 条失败：${skipped.map(s => `${s.id}:${s.reason}`).join('；')}）` });
      }

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `trade-documents_${today}.zip`;
      const encoded = encodeURIComponent(fileName);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
      res.send(buffer);
      logger.info('[CustomsRoute] batch-download zip packed', { packed, skipped: skipped.length, ids: ids.length });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST batch-download failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to batch download trade-documents' });
    }
  });

  // POST /trade-documents/render-by-shipment — 按运单渲染出运单据（B6 前端模板退役）：
  // 出运制单引擎（ShipmentDocumentGenerator）唯一渲染入口——运单装配 + 服务端模板，
  // kind ∈ CI/PL/CO/BL/FORMA/INS/BC。不登记 TradeDocument（打印场景与登记归档分离）。
  router.post('/trade-documents/render-by-shipment', async (req: Request, res: Response) => {
    try {
      const { shipmentId, kind } = req.body ?? {};
      if (!shipmentId || typeof shipmentId !== 'string') return res.status(400).json({ error: 'shipmentId 必填' });
      if (!isShipmentDocKind(kind)) return res.status(400).json({ error: `非法单据类型: ${kind}` });
      const result = await assembleDocumentSetData(prisma, shipmentId);
      if (!result.ok || !result.data) {
        return res.status(404).json({ error: result.error?.message || '运单制单数据装配失败' });
      }
      const html = await renderServerDocument(prisma, kind, result.data);
      if (!html) return res.status(500).json({ error: `单据 ${kind} 渲染失败` });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e: any) {
      logger.error('[CustomsRoute] POST render-by-shipment failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to render shipment document' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // B3 组合文档（多对一数据聚合：多运单合并 PL / 多报告合并 IR 汇总）
  // 批次 H3 起 MERGED_PL/CONTRACT 装配默认幂等登记 TradeDocument 台账（写库，
  // 登记失败 warn 不阻断输出）→ 两端点按同文件写端点口径挂 requireWrite + scope 写门；
  // MERGED_IR 不登记仍走同一端点级门禁（口径一致，不按 kind 分裂门禁）
  // ══════════════════════════════════════════════════════════════

  // POST /trade-documents/composite/preview.html — 组合文档 A4 预览（与生成 PDF 同源渲染）
  router.post('/trade-documents/composite/preview.html', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const { kind, sourceIds } = req.body ?? {};
      if (!isCompositeDocKind(kind)) return res.status(400).json({ error: `非法组合文档类型: ${kind}` });
      const { kind: resolvedKind, data } = await assembleCompositeDocument(prisma, { kind, sourceIds });
      const html = await renderServerDocument(prisma, resolvedKind, data, { screen: true });
      if (!html) return res.status(500).json({ error: '组合文档渲染失败' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e: any) {
      logger.error('[CustomsRoute] POST composite preview.html failed', { error: e?.message });
      const status = e?.message?.includes('至少需要') || e?.message?.includes('不存在') || e?.message?.includes('装配失败') ? 400 : 500;
      res.status(status).json({ error: e?.message || 'failed to preview composite document' });
    }
  });

  // POST /trade-documents/composite/generate.pdf — 组合文档生成 PDF（流式下载，PDF 不落盘归档；台账登记见上）
  router.post('/trade-documents/composite/generate.pdf', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const { kind, sourceIds } = req.body ?? {};
      if (!isCompositeDocKind(kind)) return res.status(400).json({ error: `非法组合文档类型: ${kind}` });
      const { kind: resolvedKind, data } = await assembleCompositeDocument(prisma, { kind, sourceIds });
      const html = await renderServerDocument(prisma, resolvedKind, data);
      if (!html) return res.status(500).json({ error: '组合文档渲染失败' });
      const pdf = await renderHtmlToPdf(html, { format: 'A4' });
      const label = resolvedKind === 'MERGED_PL' ? 'Consolidated-Packing-List' : 'Consolidated-Inspection-Summary';
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `${label}_${today}.pdf`;
      const encoded = encodeURIComponent(fileName);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
      res.send(pdf.pdf);
    } catch (e: any) {
      logger.error('[CustomsRoute] POST composite generate.pdf failed', { error: e?.message });
      const status = e?.message?.includes('至少需要') || e?.message?.includes('不存在') || e?.message?.includes('装配失败') ? 400 : 500;
      res.status(status).json({ error: e?.message || 'failed to generate composite document pdf' });
    }
  });

  router.post('/trade-documents', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const input = req.body as TradeDocumentInput;
      if (!input.type) {
        return res.status(400).json({ error: 'type is required（documentNumber 留空自动取号）' });
      }
      const item = await service.createTradeDocument(input, actorOf(req));
      onDataChange?.({ entity: 'TradeDocument', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CustomsRoute] POST trade-document failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create trade-document' });
    }
  });

  router.put('/trade-documents/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.delete('/trade-documents/:id', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
    try {
      const result = await service.deleteTradeDocument(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'TradeDocument', action: 'delete', ids: [result.id] });
      res.json(result);
    } catch (e: any) {
      logger.error('[CustomsRoute] DELETE trade-document failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete trade-document' });
    }
  });

  router.post('/trade-documents/:id/transition', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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

  router.post('/trade-documents/:id/versions', requireWrite, requireCustomsWrite, async (req: Request, res: Response) => {
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
