/**
 * 库存管理 API — /api/v1/inventory
 *
 * 端点：
 *   ── 仓库 ──
 *   GET    /warehouses                — 仓库列表
 *   POST   /warehouses                — 创建仓库
 *   PUT    /warehouses/:id            — 更新仓库
 *   DELETE /warehouses/:id            — 软删除仓库（须无非零库存）
 *
 *   ── 库存物料 ──
 *   GET    /items                     — 库存物料列表（支持 warehouse/category/search/lowStock 过滤）
 *   GET    /items/:id                 — 库存物料详情（含最近 50 条流水）
 *   POST   /items                     — 创建库存物料（含初始入库流水）
 *   PUT    /items/:id                 — 更新库存物料（元数据，不含数量）
 *   DELETE /items/:id                 — 软删除库存物料（须 quantity=0）
 *
 *   ── 库存变动 ──
 *   GET    /movements                 — 库存变动流水（支持 itemId/warehouse/type/date 过滤）
 *   POST   /movements                — 创建库存变动（Inbound/Outbound/Transfer/Adjustment/Lock/Unlock）
 *
 *   ── 预警 ──
 *   GET    /alerts/low-stock          — 低库存预警列表
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { logger } from '../lib/logger';
import { buildXlsx, xlsxDownloadHeaders, type XlsxSheet } from '../templates/xlsxExport';
import {
  createInventoryService,
  WarehouseInput,
  InventoryItemInput,
  StockMovementInput,
  VALID_MOVEMENT_TYPES,
} from './inventoryService';

/** 库存类别 → 台账中文标签 */
const INVENTORY_CATEGORY_LABEL: Record<string, string> = {
  Fabric: '面料', Trimmings: '辅料', Accessories: '配件', Garment: '成衣', Other: '其他',
};

export interface InventoryRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createInventoryRouter(options: InventoryRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const service = createInventoryService(prisma);

  // W-C 批三-E 族B 收口：inline authenticate 闭包退役，统一 createModuleAuthGuard（JWT 或 API-Key）。
  // 读面保持认证门（API-Key 兼容契约，auth/__tests__/moduleApiKeyHeader.test.ts 锁定）；
  // 写面 requireJwtForWrite（JWT-only，API-Key 裸写旧契约关闭）＋ inventory:write scope 门
  // （持有 = LOGISTICS 专属＋SuperAdmin 特判，GAP-R5 仓储归后勤，_shared/rolePermissionMatrix 真源）。
  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const requireInventoryWrite = requirePermission('inventory:write');

  // ════════════════════════════════════════
  // 仓库
  // ════════════════════════════════════════

  router.get('/warehouses', async (req: Request, res: Response) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const warehouses = await service.listWarehouses(includeInactive);
      res.json({ warehouses });
    } catch (e: any) {
      logger.error('[InventoryRoute] GET warehouses failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list warehouses' });
    }
  });

  router.post('/warehouses', requireWrite, requireInventoryWrite, async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as WarehouseInput;
      if (!input.code || !input.name || !input.type) {
        return res.status(400).json({ error: '缺少必填字段：code / name / type' });
      }
      const warehouse = await service.createWarehouse(input, actor?.userId || 'system');
      onDataChange?.({ entity: 'Warehouse', action: 'create', ids: [warehouse.id] });
      res.status(201).json({ warehouse });
    } catch (e: any) {
      logger.error('[InventoryRoute] POST warehouse failed', { error: e?.message });
      const status = e?.message?.includes('已存在') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to create warehouse' });
    }
  });

  router.put('/warehouses/:id', requireWrite, requireInventoryWrite, async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as Partial<WarehouseInput>;
      const warehouse = await service.updateWarehouse(req.params.id, input, actor?.userId || 'system');
      onDataChange?.({ entity: 'Warehouse', action: 'update', ids: [warehouse.id] });
      res.json({ warehouse });
    } catch (e: any) {
      logger.error('[InventoryRoute] PUT warehouse failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : 400;
      res.status(status).json({ error: e?.message || 'failed to update warehouse' });
    }
  });

  router.delete('/warehouses/:id', requireWrite, requireInventoryWrite, async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      await service.deleteWarehouse(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'Warehouse', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[InventoryRoute] DELETE warehouse failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('不可删除') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to delete warehouse' });
    }
  });

  // ════════════════════════════════════════
  // 库存物料
  // ════════════════════════════════════════

  router.get('/items', async (req: Request, res: Response) => {
    try {
      const { warehouseId, category, materialCode, search, lowStockOnly, limit, offset } = req.query;
      const exportAll = req.query.format === 'xlsx';
      const result = await service.listInventoryItems({
        warehouseId: warehouseId as string | undefined,
        category: category as string | undefined,
        materialCode: materialCode as string | undefined,
        search: search as string | undefined,
        lowStockOnly: lowStockOnly === 'true',
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        ...(exportAll ? { exportAll: true } : {}),
      });
      if (exportAll) {
        const sheet: XlsxSheet = {
          name: '库存台账',
          columnLabels: ['物料编码', '品名描述', '类别', '规格', '批次号', '库位', '仓库', '库存数量', '锁定数量', '可用数量', '单位', '单位成本', '币种', '最低库存', '最后入库', '最后出库', '备注'],
          columns: ['materialCode', 'description', 'category', 'specification', 'batchNumber', 'locationCode', 'warehouseName', 'quantity', 'lockedQuantity', 'available', 'unit', 'unitCost', 'currency', 'minStock', 'lastInDate', 'lastOutDate', 'notes'],
          rows: result.items.map((it: any) => ({
            materialCode: it.materialCode ?? '',
            description: it.description,
            category: it.category ? INVENTORY_CATEGORY_LABEL[it.category] ?? it.category : '',
            specification: it.specification ?? '',
            batchNumber: it.batchNumber ?? '',
            locationCode: it.locationCode ?? '',
            warehouseName: it.warehouse?.name ?? '',
            quantity: Number(it.quantity),
            lockedQuantity: Number(it.lockedQuantity),
            available: Number(it.quantity) - Number(it.lockedQuantity),
            unit: it.unit,
            unitCost: it.unitCost != null ? Number(it.unitCost) : null,
            currency: it.currency,
            minStock: it.minStock != null ? Number(it.minStock) : null,
            lastInDate: it.lastInDate ?? '',
            lastOutDate: it.lastOutDate ?? '',
            notes: it.notes ?? '',
          })),
        };
        const today = new Date().toISOString().slice(0, 10);
        res.set(xlsxDownloadHeaders(`库存台账_${today}.xlsx`)).send(buildXlsx([sheet]));
        return;
      }
      res.json(result);
    } catch (e: any) {
      logger.error('[InventoryRoute] GET items failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list inventory items' });
    }
  });

  router.get('/items/:id', async (req: Request, res: Response) => {
    try {
      const item = await service.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ error: '库存项不存在' });
      res.json({ item });
    } catch (e: any) {
      logger.error('[InventoryRoute] GET item failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get inventory item' });
    }
  });

  router.post('/items', requireWrite, requireInventoryWrite, async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as InventoryItemInput;
      if (!input.warehouseId || !input.description || !input.unit) {
        return res.status(400).json({ error: '缺少必填字段：warehouseId / description / unit' });
      }
      if (input.quantity == null) input.quantity = 0;
      const item = await service.createInventoryItem(input, actor?.userId || 'system');
      onDataChange?.({ entity: 'InventoryItem', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[InventoryRoute] POST item failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('已停用') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to create inventory item' });
    }
  });

  router.put('/items/:id', requireWrite, requireInventoryWrite, async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as Partial<InventoryItemInput>;
      const item = await service.updateInventoryItem(req.params.id, input, actor?.userId || 'system');
      onDataChange?.({ entity: 'InventoryItem', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[InventoryRoute] PUT item failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : 400;
      res.status(status).json({ error: e?.message || 'failed to update inventory item' });
    }
  });

  router.delete('/items/:id', requireWrite, requireInventoryWrite, async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      await service.deleteInventoryItem(req.params.id, actor?.userId || 'system');
      onDataChange?.({ entity: 'InventoryItem', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[InventoryRoute] DELETE item failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('不可删除') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to delete inventory item' });
    }
  });

  // ════════════════════════════════════════
  // 库存变动
  // ════════════════════════════════════════

  router.get('/movements', async (req: Request, res: Response) => {
    try {
      const { itemId, warehouseId, type, dateFrom, dateTo, limit, offset } = req.query;
      const result = await service.listStockMovements({
        itemId: itemId as string | undefined,
        warehouseId: warehouseId as string | undefined,
        type: type as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[InventoryRoute] GET movements failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list stock movements' });
    }
  });

  router.post('/movements', requireWrite, requireInventoryWrite, async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      const input = req.body as StockMovementInput;

      if (!input.itemId || !input.type || input.quantity == null) {
        return res.status(400).json({ error: '缺少必填字段：itemId / type / quantity' });
      }
      if (!VALID_MOVEMENT_TYPES.includes(input.type)) {
        return res.status(400).json({ error: `非法变动类型：${input.type}` });
      }
      if (input.type === 'Transfer' && !input.targetWarehouseId) {
        return res.status(400).json({ error: '调拨必须指定 targetWarehouseId' });
      }
      if (input.quantity <= 0) {
        return res.status(400).json({ error: '变动数量必须 > 0' });
      }

      const movement = await service.createStockMovement(input, actor?.userId || 'system');
      onDataChange?.({ entity: 'StockMovement', action: 'create', ids: [movement.id] });
      onDataChange?.({ entity: 'InventoryItem', action: 'movement', ids: [input.itemId] });
      res.status(201).json({ movement });
    } catch (e: any) {
      logger.error('[InventoryRoute] POST movement failed', { error: e?.message });
      const msg = e?.message || '';
      const status = msg.includes('不存在') ? 404
        : msg.includes('库存不足') || msg.includes('不可删除') || msg.includes('非法') ? 409
        : 400;
      res.status(status).json({ error: msg || 'failed to create stock movement' });
    }
  });

  // ════════════════════════════════════════
  // 预警
  // ════════════════════════════════════════

  router.get('/alerts/low-stock', async (req: Request, res: Response) => {
    try {
      const items = await service.getLowStockItems();
      res.json({ items, total: items.length });
    } catch (e: any) {
      logger.error('[InventoryRoute] GET low-stock failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get low stock alerts' });
    }
  });

  return router;
}
