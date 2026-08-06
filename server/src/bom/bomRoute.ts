/**
 * BOM / 成本核算 API — /api/v1/bom
 *
 * 端点：
 *   GET    /                    — BOM 列表（支持 status/productAssetId/orderId/search 过滤）
 *   GET    /:id                 — BOM 详情（含物料行 + 成本估算项）
 *   POST   /                    — 创建 BOM（Draft 状态）
 *   PUT    /:id                 — 更新 BOM（仅 Draft）
 *   DELETE /:id                 — 软删除 BOM（仅 Draft）
 *   POST   /:id/confirm         — 确认 BOM（Draft → Confirmed）
 *   POST   /:id/archive         — 归档 BOM（Draft/Confirmed → Archived）
 *   POST   /:id/recalculate     — 重新计算成本（仅 Draft）
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';
import { createBOMService, CreateBOMInput, UpdateBOMInput } from './bomService';

export interface BOMRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createBOMRouter(options: BOMRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const service = createBOMService(prisma);

  const authenticate = (req: Request, res: Response): boolean => {
    if (!requireAuth) return true;
    const apiKey = req.query.apiKey as string || req.headers['x-api-key'] as string;
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
      const { status, productAssetId, orderId, quotationId, search, limit, offset } = req.query;
      const result = await service.listBOMs({
        status: status as string | undefined,
        productAssetId: productAssetId as string | undefined,
        orderId: orderId as string | undefined,
        quotationId: quotationId as string | undefined,
        search: search as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[BOMRoute] GET list failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list BOMs' });
    }
  });

  // ── GET /:id — 详情 ──
  router.get('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const bom = await service.getBOM(req.params.id);
      if (!bom) {
        return res.status(404).json({ error: 'BOM 不存在' });
      }
      res.json({ bom });
    } catch (e: any) {
      logger.error('[BOMRoute] GET detail failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get BOM' });
    }
  });

  // ── POST / — 创建 ──
  router.post('/', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as CreateBOMInput;

      if (!input.bomNumber || !input.description || !input.lines || input.lines.length === 0) {
        return res.status(400).json({ error: '缺少必填字段：bomNumber / description / lines' });
      }

      const bom = await service.createBOM(input, actor?.userId || 'system');
      onDataChange?.({ entity: 'BOM', action: 'create', ids: [bom.id] });
      res.status(201).json({ bom });
    } catch (e: any) {
      logger.error('[BOMRoute] POST create failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('已存在') ? 409
        : msg.includes('非法') || msg.includes('至少需要') ? 400
        : 500;
      res.status(status).json({ error: msg || 'failed to create BOM' });
    }
  });

  // ── PUT /:id — 更新（仅 Draft） ──
  router.put('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as UpdateBOMInput;
      const bom = await service.updateBOM(req.params.id, input, actor?.userId || 'system');
      onDataChange?.({ entity: 'BOM', action: 'update', ids: [bom.id] });
      res.json({ bom });
    } catch (e: any) {
      logger.error('[BOMRoute] PUT update failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404
        : msg.includes('仅 Draft') || msg.includes('非法') ? 409
        : 400;
      res.status(status).json({ error: msg || 'failed to update BOM' });
    }
  });

  // ── DELETE /:id — 软删除（仅 Draft） ──
  router.delete('/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      await service.deleteBOM(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'BOM', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[BOMRoute] DELETE failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404
        : msg.includes('仅 Draft') ? 409
        : 400;
      res.status(status).json({ error: msg || 'failed to delete BOM' });
    }
  });

  // ── POST /:id/confirm — 确认（Draft → Confirmed） ──
  router.post('/:id/confirm', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const bom = await service.confirmBOM(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'BOM', action: 'confirm', ids: [bom.id] });
      res.json({ bom });
    } catch (e: any) {
      logger.error('[BOMRoute] POST confirm failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404
        : msg.includes('非法状态转换') ? 409
        : 400;
      res.status(status).json({ error: msg || 'failed to confirm BOM' });
    }
  });

  // ── POST /:id/archive — 归档 ──
  router.post('/:id/archive', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const bom = await service.archiveBOM(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'BOM', action: 'archive', ids: [bom.id] });
      res.json({ bom });
    } catch (e: any) {
      logger.error('[BOMRoute] POST archive failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404
        : msg.includes('非法状态转换') ? 409
        : 400;
      res.status(status).json({ error: msg || 'failed to archive BOM' });
    }
  });

  // ── POST /:id/recalculate — 重新计算成本（仅 Draft） ──
  router.post('/:id/recalculate', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const actor = extractActorFromRequest(req);
      const bom = await service.recalculateCost(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'BOM', action: 'recalculate', ids: [bom.id] });
      res.json({ bom });
    } catch (e: any) {
      logger.error('[BOMRoute] POST recalculate failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404
        : msg.includes('仅 Draft') ? 409
        : 400;
      res.status(status).json({ error: msg || 'failed to recalculate BOM cost' });
    }
  });

  return router;
}
