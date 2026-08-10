/**
 * 报价管理 API — /api/v1/quotations
 *
 * 端点：
 *   GET    /              — 列表（支持 status/customer/date/search 过滤）
 *   GET    /:id           — 详情（含行明细）
 *   POST   /              — 创建报价单（Draft 状态）
 *   PUT    /:id           — 更新报价单（仅 Draft）
 *   DELETE /:id           — 软删除报价单（仅 Draft）
 *   POST   /:id/send      — 发送报价单（Draft → Sent + 发布 QuotationIssued 事件）
 *   POST   /:id/accept    — 接受报价单（Sent → Accepted + 发布 QuotationAccepted 事件）
 *   POST   /:id/reject    — 拒绝报价单（Sent → Rejected）
 *   POST   /:id/expire    — 标记过期（Draft/Sent → Expired）
 *
 * 鉴权：JWT（写操作需要认证），读取操作支持 apiKey
 * 审计：所有 mutation 写入 AuditLog（字段级审计）
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { actorIdFromRequest, writeRouteAuditLog } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { createQuotationService, CreateQuotationInput, UpdateQuotationInput } from './quotationService';
import { createQuotationImportService, HistoricalQuotationRow } from './quotationImportService';

export interface QuotationRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createQuotationRouter(options: QuotationRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const service = createQuotationService(prisma);
  const importService = createQuotationImportService(prisma);

  // ── 简易 apiKey 校验 ──
  const authenticate = (req: Request, res: Response): boolean => {
    if (!requireAuth) return true;
    const apiKey = (req.query.apiKey as string) || (req.headers['x-bambook-api-key'] as string) || (req.headers['x-api-key'] as string);
    if (apiKey && apiKeys.has(apiKey)) return true;
    const actor = extractActorFromRequest(req);
    if (actor?.userId) return true;
    res.status(401).json({ error: 'authentication required' });
    return false;
  };

  // ── GET / — 列表 ──
  router.get('/', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { status, customerRelationId, dateFrom, dateTo, search, limit, offset } = req.query;
      const result = await service.listQuotations({
        status: status as string | undefined,
        customerRelationId: customerRelationId as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
        search: search as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[QuotationRoute] GET list failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list quotations' });
    }
  });

  // ── GET /:id — 详情 ──
  router.get('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const quotation = await service.getQuotation(req.params.id);
      if (!quotation) {
        return res.status(404).json({ error: '报价单不存在' });
      }
      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] GET detail failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get quotation' });
    }
  });

  // ── POST / — 创建 ──
  router.post('/', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as CreateQuotationInput;

      // 基本校验
      if (!input.quotationNumber || !input.currency || !input.issueDate) {
        return res.status(400).json({ error: '缺少必填字段：quotationNumber / currency / issueDate' });
      }
      if (!input.lines || input.lines.length === 0) {
        return res.status(400).json({ error: '至少需要一行报价明细' });
      }
      for (const line of input.lines) {
        if (!line.description || !line.unit || line.quantity == null || line.unitPrice == null) {
          return res.status(400).json({ error: '报价行缺少必填字段：description / unit / quantity / unitPrice' });
        }
      }

      // 检查报价号唯一性
      const existing = await prisma.quotation.findUnique({ where: { quotationNumber: input.quotationNumber } });
      if (existing) {
        return res.status(409).json({ error: `报价号 ${input.quotationNumber} 已存在` });
      }

      const quotation = await service.createQuotation(input, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'create', ids: [quotation.id] });

      res.status(201).json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST create failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to create quotation' });
    }
  });

  // ── POST /import — 历史报价导入（阶段 P3c，PRD 16.1；mode=preview 只校验，mode=commit 导入合法行）──
  // 注意：须注册在 /:id 之前，避免 'import' 被 :id 捕获
  router.post('/import', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const rows = req.body?.rows as HistoricalQuotationRow[];
      const mode = req.body?.mode === 'commit' ? 'commit' : 'preview';
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: 'rows 须为数组' });
      }
      const result = await importService.importHistoricalQuotations(rows, mode, actor?.userId || 'system');
      if (mode === 'commit' && result.created > 0) {
        onDataChange?.({ entity: 'Quotation', action: 'import', ids: [] });
      }
      res.json(result);
    } catch (e: any) {
      logger.error('[QuotationRoute] POST import failed', { error: e?.message });
      const msg = e?.message || '';
      res.status(msg.includes('为空') || msg.includes('不可超过') || msg.includes('数组') ? 400 : 500)
        .json({ error: msg || 'failed to import quotations' });
    }
  });

  // ── PUT /:id — 更新（仅 Draft） ──
  router.put('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as UpdateQuotationInput;
      const quotation = await service.updateQuotation(req.params.id, input, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'update', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] PUT update failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('仅 Draft') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to update quotation' });
    }
  });

  // ── DELETE /:id — 软删除（仅 Draft） ──
  router.delete('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      await service.deleteQuotation(req.params.id, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'delete', ids: [req.params.id] });

      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[QuotationRoute] DELETE failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('仅 Draft') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to delete quotation' });
    }
  });

  // ── POST /:id/send — 发送报价单（Draft → Sent） ──
  router.post('/:id/send', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const quotation = await service.sendQuotation(req.params.id, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'send', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST send failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404 : msg.includes('非法') || msg.includes('门禁') ? 409 : 400;
      res.status(status).json({ error: msg || 'failed to send quotation' });
    }
  });

  // ── POST /:id/accept — 接受报价单（Sent → Accepted） ──
  router.post('/:id/accept', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const { note } = req.body;
      const quotation = await service.acceptQuotation(req.params.id, actor?.userId || 'system', note);

      onDataChange?.({ entity: 'Quotation', action: 'accept', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST accept failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('非法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to accept quotation' });
    }
  });

  // ── POST /:id/reject — 拒绝报价单（Sent → Rejected） ──
  router.post('/:id/reject', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const { note } = req.body;
      const quotation = await service.rejectQuotation(req.params.id, actor?.userId || 'system', note);

      onDataChange?.({ entity: 'Quotation', action: 'reject', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST reject failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('非法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to reject quotation' });
    }
  });

  // ── POST /:id/expire — 标记过期 ──
  router.post('/:id/expire', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const quotation = await service.expireQuotation(req.params.id, actor?.userId || 'system');

      onDataChange?.({ entity: 'Quotation', action: 'expire', ids: [quotation.id] });

      res.json({ quotation });
    } catch (e: any) {
      logger.error('[QuotationRoute] POST expire failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : 400;
      res.status(status).json({ error: e?.message || 'failed to expire quotation' });
    }
  });

  // ── POST /:id/convert-to-order — 转为正式订单（Accepted → Order） ──
  router.post('/:id/convert-to-order', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const { poNumber, millName, type, dueDate } = req.body || {};
      const result = await service.convertToOrder(
        req.params.id,
        actor?.userId || 'system',
        { poNumber, millName, type, dueDate },
      );

      onDataChange?.({ entity: 'Quotation', action: 'convert', ids: [result.quotation.id] });
      onDataChange?.({ entity: 'orders', action: 'create', ids: [result.orderId] });

      res.status(201).json(result);
    } catch (e: any) {
      logger.error('[QuotationRoute] POST convert-to-order failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404
        : msg.includes('已转为') ? 409
        : msg.includes('仅 Accepted') ? 409
        : 400;
      res.status(status).json({ error: msg || 'failed to convert quotation to order' });
    }
  });

  return router;
}
