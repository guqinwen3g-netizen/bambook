/**
 * 货运管理 API — /api/v1/shipping
 *
 * 契约钩子（来自 docs/MODULE_CONTRACT.md）：
 *   - L2.2 输入校验：字段白名单 + 必填校验
 *   - L3.1 EntityLink 同步：mutation 调用 syncShipmentReferences
 *   - L4 审批：高风险 mutation 默认走 manifest.safety.approval=always
 *
 * Decimal-first：金额字段用 Prisma Decimal @db.Decimal(18,4)，
 * route 层 JSON 序列化自动输出 string，前端按需 parse。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { PrismaClient } from '@prisma/client';
import { actorIdFromRequest } from '../audit/routeAudit';
import { createShipment, updateShipment, deleteShipment, VALID_SHIPMENT_STATUSES } from './shipmentMutationService';
import { assembleDocumentSetData } from './documentSetService';
import { getOnTimeStats, getMethodStats } from './shipmentStatsService';
import {
  listShipmentLines, listShipmentCartons,
  replaceShipmentLines, replaceShipmentCartons, pullLinesFromOrder,
} from './shipmentPackingService';
import { createAllocationService } from './allocationService';

export interface ShippingRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

// ── 字段白名单 ──

type ShipmentCreateInput = {
  shipmentNumber: string;
  type: string;
  shippingMethod: string;
  status?: string;
  bookingDate?: string;
  etd?: string;
  atd?: string;
  eta?: string;
  ata?: string;
  vesselOrFlight?: string;
  voyageNumber?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  containerNumber?: string;
  sealNumber?: string;
  trackingNumber?: string;
  carrierTrackingUrl?: string;
  totalPackages?: number;
  grossWeight?: number;
  netWeight?: number;
  volume?: number;
  freightAmount?: number;
  freightCurrency?: string;
  insuranceAmount?: number;
  insuranceCurrency?: string;
  customsAmount?: number;
  customsCurrency?: string;
  otherCharges?: number;
  otherChargesCurrency?: string;
  orderId?: string;
  customerRelationId?: string;
  customerName?: string;
  carrierRelationId?: string;
  carrierName?: string;
  hsCode?: string;
  customsBroker?: string;
  customsDeclarationNumber?: string;
  customsClearanceDate?: string;
  notes?: string;
  attachments?: any;
};

const SHIPMENT_PATCH_FIELDS: (keyof ShipmentCreateInput)[] = [
  'status', 'bookingDate', 'etd', 'atd', 'eta', 'ata',
  'vesselOrFlight', 'voyageNumber',
  'portOfLoading', 'portOfDischarge',
  'containerNumber', 'sealNumber', 'trackingNumber', 'carrierTrackingUrl', 'totalPackages',
  'grossWeight', 'netWeight', 'volume',
  'freightAmount', 'freightCurrency',
  'insuranceAmount', 'insuranceCurrency',
  'customsAmount', 'customsCurrency',
  'otherCharges', 'otherChargesCurrency',
  'orderId', 'customerRelationId', 'customerName',
  'carrierRelationId', 'carrierName',
  'hsCode', 'customsBroker', 'customsDeclarationNumber', 'customsClearanceDate',
  'notes', 'attachments',
];

function pickFields<T extends Record<string, any>>(obj: T, keys: string[]): Partial<T> {
  const out: any = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export function createShippingRouter(options: ShippingRouterOptions): Router {
  const { prisma, onDataChange, requireAuth, apiKeys } = options;
  const router = Router();
  const allocationService = createAllocationService(prisma);

  // Shared auth guard: JWT or API-key (restored — was silently dropped by scaffold)
  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });


  // GET /api/v1/shipping — list / search
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;

      const where: any = { deletedAt: null };
      if (req.query.type) where.type = String(req.query.type);
      if (req.query.status) where.status = String(req.query.status);
      if (req.query.orderId) where.orderId = String(req.query.orderId);
      if (req.query.customerRelationId) where.customerRelationId = String(req.query.customerRelationId);
      if (req.query.carrierRelationId) where.carrierRelationId = String(req.query.carrierRelationId);
      if (req.query.carrierName) where.carrierName = { contains: String(req.query.carrierName), mode: 'insensitive' };
      if (req.query.shipmentNumber) where.shipmentNumber = { contains: String(req.query.shipmentNumber), mode: 'insensitive' };
      if (req.query.search) {
        const q = String(req.query.search);
        const qInsensitive = { contains: q, mode: 'insensitive' };
        where.OR = [{ shipmentNumber: qInsensitive }, { customerName: qInsensitive }, { carrierName: qInsensitive }];
      }

      const [items, total] = await Promise.all([
        (prisma as any).shipment.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
        (prisma as any).shipment.count({ where }),
      ]);
      res.json({ items, total });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/shipping/stats/on-time — 准交率统计（只读；两段式路径不与 /:id 冲突）
  router.get('/stats/on-time', async (req: Request, res: Response) => {
    try {
      const stats = await getOnTimeStats(prisma, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'STATS_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/shipping/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const item = await (prisma as any).shipment.findUnique({ where: { id: req.params.id } });
      if (!item || item.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '运单不存在' } });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'GET_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/shipping/:id/document-set — 制单数据装配（只读，CI/PL/CO/BL 成套生成数据源）
  router.get('/:id/document-set', async (req: Request, res: Response) => {
    try {
      const result = await assembleDocumentSetData(prisma, req.params.id);
      if (!result.ok) {
        const statusCode = result.error!.code === 'SHIPMENT_NOT_FOUND' ? 404 : 500;
        res.status(statusCode).json({ error: result.error });
        return;
      }
      res.json(result.data);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'ASSEMBLE_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/shipping/stats/by-method — C4 运输方式维度统计（只读；须在 /:id 之前注册）
  router.get('/stats/by-method', async (req: Request, res: Response) => {
    try {
      const stats = await getMethodStats(prisma, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'STATS_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/shipping/:id/lines — C4 装运行（只读）
  router.get('/:id/lines', async (req: Request, res: Response) => {
    try {
      const sh = await (prisma as any).shipment.findUnique({ where: { id: req.params.id }, select: { id: true, deletedAt: true } });
      if (!sh || sh.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '运单不存在' } });
      const items = await listShipmentLines(prisma, req.params.id);
      res.json({ items, total: items.length });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // PUT /api/v1/shipping/:id/lines — C4 装运行整组替换（幂等）
  router.put('/:id/lines', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
    if (!lines) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'body.lines must be an array' } });
    const result = await replaceShipmentLines(prisma, req.params.id, lines, actorIdFromRequest(req), req.ip || null);
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, INVALID_CURRENT_STATUS: 409, VALIDATION_FAILED: 400 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'update', ids: [req.params.id] });
    res.json(result.data);
  });

  // POST /api/v1/shipping/:id/lines/pull-from-order — C4 从订单重新带出装运行
  router.post('/:id/lines/pull-from-order', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await pullLinesFromOrder(prisma, req.params.id, actorIdFromRequest(req), req.ip || null);
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, ORDER_NOT_FOUND: 404, INVALID_CURRENT_STATUS: 409, VALIDATION_FAILED: 400 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'update', ids: [req.params.id] });
    res.json(result.data);
  });

  // GET /api/v1/shipping/:id/cartons — C4 逐箱装箱（只读，含箱内分配）
  router.get('/:id/cartons', async (req: Request, res: Response) => {
    try {
      const sh = await (prisma as any).shipment.findUnique({ where: { id: req.params.id }, select: { id: true, deletedAt: true } });
      if (!sh || sh.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '运单不存在' } });
      const items = await listShipmentCartons(prisma, req.params.id);
      res.json({ items, total: items.length });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // PUT /api/v1/shipping/:id/cartons — C4 逐箱整组替换（幂等，箱内分配随行校验）
  router.put('/:id/cartons', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const cartons = Array.isArray(req.body?.cartons) ? req.body.cartons : null;
    if (!cartons) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'body.cartons must be an array' } });
    const result = await replaceShipmentCartons(prisma, req.params.id, cartons, actorIdFromRequest(req), req.ip || null);
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, INVALID_CURRENT_STATUS: 409, VALIDATION_FAILED: 400 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'update', ids: [req.params.id] });
    res.json(result.data);
  });

  // GET /api/v1/shipping/:id/events — F3 物流节点时间轴（ShipmentEvent 升序全量）
  router.get('/:id/events', async (req: Request, res: Response) => {
    try {
      const sh = await (prisma as any).shipment.findUnique({ where: { id: req.params.id }, select: { id: true, deletedAt: true } });
      if (!sh || sh.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '运单不存在' } });
      const items = await (prisma as any).shipmentEvent.findMany({
        where: { shipmentId: req.params.id },
        orderBy: [{ eventDate: 'asc' }, { createdAt: 'asc' }],
      });
      res.json({ items, total: items.length });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/shipping — create (high risk, approval upstream)
  // task ERP-P1-shipping-mutation-shared-service-foundation: route 只调 service
  router.post('/', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const input = pickFields(req.body as ShipmentCreateInput, [
      'type', 'shippingMethod', 'status', 'bookingDate',
      'etd', 'atd', 'eta', 'ata',
      'vesselOrFlight', 'voyageNumber',
      'portOfLoading', 'portOfDischarge',
      'containerNumber', 'sealNumber', 'trackingNumber', 'carrierTrackingUrl', 'totalPackages',
      'grossWeight', 'netWeight', 'volume',
      'freightAmount', 'freightCurrency',
      'insuranceAmount', 'insuranceCurrency',
      'customsAmount', 'customsCurrency',
      'otherCharges', 'otherChargesCurrency',
      'orderId', 'customerRelationId', 'customerName',
      'carrierRelationId', 'carrierName',
      'hsCode', 'customsBroker', 'customsDeclarationNumber', 'customsClearanceDate',
      'notes', 'attachments',
    ]);
    const result = await createShipment({
      prisma, input, actorId: actorIdFromRequest(req), ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        INVALID_STATUS: 400,
        INVALID_INITIAL_STATUS: 400,
        ORDER_NOT_FOUND: 404,
        ORDER_TERMINAL: 400,
        INVALID_CURRENT_ORDER_STATUS: 400,
        CREATE_FAILED: 500,
      };
      const code = result.error!.code;
      res.status(statusCodeMap[code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'create', ids: [result.data!.shipment.id] });
    res.status(201).json(result.data!.shipment);
  });

  // PATCH /api/v1/shipping/:id
  // task ERP-P1-shipping-mutation-shared-service-foundation: route 只调 service
  router.patch('/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'status');
    const patch = pickFields(req.body, SHIPMENT_PATCH_FIELDS);
    const result = await updateShipment({
      prisma, shipmentId: req.params.id, patch, hasStatus,
      actorId: actorIdFromRequest(req), ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        NOT_FOUND: 404,
        INVALID_STATUS: 400,
        INVALID_TRANSITION: 400,
        INVALID_CURRENT_STATUS: 400,
        ORDER_NOT_FOUND: 404,
        ORDER_TERMINAL: 400,
        INVALID_CURRENT_ORDER_STATUS: 400,
        UPDATE_FAILED: 500,
      };
      const code = result.error!.code;
      res.status(statusCodeMap[code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'update', ids: [result.data!.shipment.id] });
    res.json(result.data!.shipment);
  });

  // DELETE /api/v1/shipping/:id — soft delete
  // task ERP-P1-shipping-mutation-shared-service-foundation: route 只调 service
  router.delete('/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await deleteShipment({
      prisma, shipmentId: req.params.id,
      actorId: actorIdFromRequest(req), ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, DELETE_FAILED: 500 };
      const code = result.error!.code;
      res.status(statusCodeMap[code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'delete', ids: [result.data!.shipment.id] });
    res.json({ ok: true, id: result.data!.shipment.id });
  });

  // ════════════════════════════════════════════════════════════════
  // DR-016 合票建模 — ShipmentOrderAllocation 分配记录路由
  // ════════════════════════════════════════════════════════════════

  // GET /api/v1/shipping/:id/allocations — 票内分配列表
  router.get('/:id/allocations', async (req: Request, res: Response) => {
    try {
      const sh = await (prisma as any).shipment.findUnique({ where: { id: req.params.id }, select: { id: true, deletedAt: true } });
      if (!sh || sh.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '运单不存在' } });
      const result = await allocationService.listAllocations(req.params.id);
      if (!result.ok) {
        res.status(500).json({ error: result.error });
        return;
      }
      res.json(result.data);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/shipping/:id/allocations — 新增分配（合票/拆票）
  router.post('/:id/allocations', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const { orderId, orderLineId, plannedQty, actualQty, unit, status, batchOrCartonNote, exception } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'body.orderId 必填' } });
    }
    const result = await allocationService.createAllocation(req.params.id, {
      orderId, orderLineId, plannedQty, actualQty, unit, status, batchOrCartonNote, exception,
    }, actorIdFromRequest(req), req.ip || null);
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        SHIPMENT_NOT_FOUND: 404,
        ORDER_NOT_FOUND: 404,
        CONSOLIDATION_CUSTOMER_MISMATCH: 409,
        CONSOLIDATION_BUSINESS_LINE_MISMATCH: 409,
        ORDER_LINE_OVER_ALLOCATED: 409,
        VALIDATION_FAILED: 400,
        CREATE_FAILED: 500,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'update', ids: [req.params.id] });
    res.status(201).json(result.data!.allocation);
  });

  // PATCH /api/v1/shipping/:id/allocations/:allocId — 更新分配
  router.patch('/:id/allocations/:allocId', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await allocationService.updateAllocation(req.params.id, req.params.allocId, req.body || {},
      actorIdFromRequest(req), req.ip || null);
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        SHIPMENT_NOT_FOUND: 404,
        ALLOCATION_NOT_FOUND: 404,
        ORDER_LINE_OVER_ALLOCATED: 409,
        VALIDATION_FAILED: 400,
        UPDATE_FAILED: 500,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'update', ids: [req.params.id] });
    res.json(result.data!.allocation);
  });

  // DELETE /api/v1/shipping/:id/allocations/:allocId — 删除分配
  router.delete('/:id/allocations/:allocId', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await allocationService.deleteAllocation(req.params.id, req.params.allocId,
      actorIdFromRequest(req), req.ip || null);
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        SHIPMENT_NOT_FOUND: 404,
        ALLOCATION_NOT_FOUND: 404,
        DELETE_FAILED: 500,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'update', ids: [req.params.id] });
    res.json({ ok: true, id: result.data!.allocation.id });
  });

  // GET /api/v1/shipping/allocations/by-order/:orderId — 按订单查询跨票分配
  router.get('/allocations/by-order/:orderId', async (req: Request, res: Response) => {
    try {
      const result = await allocationService.listAllocationsByOrder(req.params.orderId);
      if (!result.ok) {
        res.status(500).json({ error: result.error });
        return;
      }
      res.json(result.data);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  return router;
}
