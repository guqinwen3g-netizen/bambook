/**
 * 采购管理 API — /api/v1/procurement
 *
 * 端点：
 *   GET    /                          — 采购单列表（支持 status/supplier/date/search 过滤）
 *   GET    /:id                       — 采购单详情（含行明细 + 收料记录）
 *   POST   /                          — 创建采购单（Draft 状态）
 *   PUT    /:id                       — 更新采购单（仅 Draft）
 *   DELETE /:id                       — 软删除采购单（仅 Draft）
 *   POST   /:id/send                  — 发送采购单（Draft → Sent）
 *   POST   /:id/confirm               — 确认采购单（Sent → Confirmed）
 *   POST   /:id/cancel                — 取消采购单
 *   POST   /:id/close                 — 关闭采购单
 *   POST   /:id/receipts              — 创建来料检验记录
 *   GET    /:id/receipts              — 查询来料记录列表
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';
import { createProcurementService, CreatePurchaseOrderInput, UpdatePurchaseOrderInput, MaterialReceiptInput } from './procurementService';

export interface ProcurementRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createProcurementRouter(options: ProcurementRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const service = createProcurementService(prisma);

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
      const { status, supplierRelationId, dateFrom, dateTo, search, limit, offset } = req.query;
      const result = await service.listPurchaseOrders({
        status: status as string | undefined,
        supplierRelationId: supplierRelationId as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
        search: search as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[ProcurementRoute] GET list failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list purchase orders' });
    }
  });

  // ── GET /:id — 详情 ──
  router.get('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const purchaseOrder = await service.getPurchaseOrder(req.params.id);
      if (!purchaseOrder) {
        return res.status(404).json({ error: '采购单不存在' });
      }
      res.json({ purchaseOrder });
    } catch (e: any) {
      logger.error('[ProcurementRoute] GET detail failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get purchase order' });
    }
  });

  // ── POST / — 创建 ──
  router.post('/', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as CreatePurchaseOrderInput;

      if (!input.poNumber || !input.currency || !input.orderDate) {
        return res.status(400).json({ error: '缺少必填字段：poNumber / currency / orderDate' });
      }
      if (!input.lines || input.lines.length === 0) {
        return res.status(400).json({ error: '至少需要一行采购明细' });
      }
      for (const line of input.lines) {
        if (!line.description || !line.unit || line.quantity == null || line.unitPrice == null) {
          return res.status(400).json({ error: '采购行缺少必填字段：description / unit / quantity / unitPrice' });
        }
      }

      const existing = await prisma.purchaseOrder.findUnique({ where: { poNumber: input.poNumber } });
      if (existing) {
        return res.status(409).json({ error: `采购单号 ${input.poNumber} 已存在` });
      }

      const purchaseOrder = await service.createPurchaseOrder(input, actor?.userId || 'system');
      onDataChange?.({ entity: 'PurchaseOrder', action: 'create', ids: [purchaseOrder.id] });
      res.status(201).json({ purchaseOrder });
    } catch (e: any) {
      logger.error('[ProcurementRoute] POST create failed', { error: e?.message });
      const status = e?.message?.includes('已被拉黑') ? 400 : 500;
      res.status(status).json({ error: e?.message || 'failed to create purchase order' });
    }
  });

  // ── PUT /:id — 更新（仅 Draft） ──
  router.put('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as UpdatePurchaseOrderInput;
      const purchaseOrder = await service.updatePurchaseOrder(req.params.id, input, actor?.userId || 'system');
      onDataChange?.({ entity: 'PurchaseOrder', action: 'update', ids: [purchaseOrder.id] });
      res.json({ purchaseOrder });
    } catch (e: any) {
      logger.error('[ProcurementRoute] PUT update failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('仅 Draft') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to update purchase order' });
    }
  });

  // ── DELETE /:id — 软删除（仅 Draft） ──
  router.delete('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      await service.deletePurchaseOrder(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'PurchaseOrder', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[ProcurementRoute] DELETE failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('仅 Draft') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to delete purchase order' });
    }
  });

  // ── POST /:id/send — 发送采购单 ──
  router.post('/:id/send', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const purchaseOrder = await service.sendPurchaseOrder(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'PurchaseOrder', action: 'send', ids: [purchaseOrder.id] });
      res.json({ purchaseOrder });
    } catch (e: any) {
      logger.error('[ProcurementRoute] POST send failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('非法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to send purchase order' });
    }
  });

  // ── POST /:id/confirm — 确认采购单 ──
  router.post('/:id/confirm', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const purchaseOrder = await service.confirmPurchaseOrder(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'PurchaseOrder', action: 'confirm', ids: [purchaseOrder.id] });
      res.json({ purchaseOrder });
    } catch (e: any) {
      logger.error('[ProcurementRoute] POST confirm failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('非法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to confirm purchase order' });
    }
  });

  // ── POST /:id/cancel — 取消采购单 ──
  router.post('/:id/cancel', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const { reason } = req.body || {};
      const purchaseOrder = await service.cancelPurchaseOrder(req.params.id, actor?.userId || 'system', reason);
      onDataChange?.({ entity: 'PurchaseOrder', action: 'cancel', ids: [purchaseOrder.id] });
      res.json({ purchaseOrder });
    } catch (e: any) {
      logger.error('[ProcurementRoute] POST cancel failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('非法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to cancel purchase order' });
    }
  });

  // ── POST /:id/close — 关闭采购单 ──
  router.post('/:id/close', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const purchaseOrder = await service.closePurchaseOrder(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'PurchaseOrder', action: 'close', ids: [purchaseOrder.id] });
      res.json({ purchaseOrder });
    } catch (e: any) {
      logger.error('[ProcurementRoute] POST close failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('非法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to close purchase order' });
    }
  });

  // ── GET /:id/receipts — 来料记录列表 ──
  router.get('/:id/receipts', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const receipts = await prisma.materialReceipt.findMany({
        where: { purchaseOrderId: req.params.id },
        orderBy: { receivedDate: 'desc' },
      });
      res.json({ receipts });
    } catch (e: any) {
      logger.error('[ProcurementRoute] GET receipts failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list receipts' });
    }
  });

  // ── POST /:id/receipts — 创建来料检验记录 ──
  router.post('/:id/receipts', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as MaterialReceiptInput;

      if (!input.receiptNumber || !input.receivedDate || input.totalReceived == null || input.totalAccepted == null || input.totalRejected == null) {
        return res.status(400).json({ error: '缺少必填字段：receiptNumber / receivedDate / totalReceived / totalAccepted / totalRejected' });
      }

      const receipt = await service.createMaterialReceipt(req.params.id, input, actor?.userId || 'system');
      onDataChange?.({ entity: 'MaterialReceipt', action: 'create', ids: [receipt.id] });
      onDataChange?.({ entity: 'PurchaseOrder', action: 'receipt', ids: [req.params.id] });
      res.status(201).json({ receipt });
    } catch (e: any) {
      logger.error('[ProcurementRoute] POST receipts failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('仅') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to create material receipt' });
    }
  });

  return router;
}
