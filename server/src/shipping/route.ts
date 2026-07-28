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
  'containerNumber', 'sealNumber', 'totalPackages',
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

  // POST /api/v1/shipping — create (high risk, approval upstream)
  // task ERP-P1-shipping-mutation-shared-service-foundation: route 只调 service
  router.post('/', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const input = pickFields(req.body as ShipmentCreateInput, [
      'shipmentNumber', 'type', 'shippingMethod', 'status', 'bookingDate',
      'etd', 'atd', 'eta', 'ata',
      'vesselOrFlight', 'voyageNumber',
      'portOfLoading', 'portOfDischarge',
      'containerNumber', 'sealNumber', 'totalPackages',
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

  return router;
}
