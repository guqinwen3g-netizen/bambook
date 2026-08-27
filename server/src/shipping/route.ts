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
import { requirePermission } from '../auth/permissionGuard';
import type { AgentRole } from '../agent/types';
import { PrismaClient } from '@prisma/client';
import { actorIdFromRequest } from '../audit/routeAudit';
import { createShipment, updateShipment, deleteShipment, VALID_SHIPMENT_STATUSES } from './shipmentMutationService';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';
import { createExceptionService } from '../exceptions/exceptionService';
import type { ExceptionChecker } from '../exceptions/exceptionGate';
import { assembleDocumentSetData } from './documentSetService';
import { getOnTimeStats, getMethodStats } from './shipmentStatsService';
import {
  listShipmentLines, listShipmentCartons,
  replaceShipmentLines, replaceShipmentCartons, pullLinesFromOrder,
} from './shipmentPackingService';
import { createAllocationService } from './allocationService';
import { createBookingLeadTimeService } from './bookingLeadTimeService';
import { createOrderShipmentBatchService } from './orderShipmentBatchService';
import { serializeValue } from '../lib/serializeValue';
import { buildXlsx, xlsxDownloadHeaders, type XlsxSheet } from '../templates/xlsxExport';
import { logger } from '../lib/logger';

/** 运单状态 → 台账中文标签（与 ShipmentManager 展示口径一致，枚举镜像 VALID_SHIPMENT_STATUSES） */
const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  Draft: '草稿', Booked: '已订舱', Loading: '装货中', Shipped: '已发运',
  Arrived: '已到港', Cleared: '已清关', Delivered: '已交付', Cancelled: '已取消',
};

/** 运单类型 → 台账中文标签（Shipment.type 枚举） */
const SHIPMENT_TYPE_LABEL: Record<string, string> = {
  Export: '出口', Import: '进口', Domestic: '内贸',
};

/** 运输方式 → 台账中文标签（Shipment.shippingMethod 枚举） */
const SHIPMENT_METHOD_LABEL: Record<string, string> = {
  Sea: '海运', Air: '空运', Land: '陆运', Rail: '铁运', Courier: '快递',
};

export interface ShippingRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
  /**
   * DR-013 例外查询器（出运放行门禁用）：
   *   - undefined（缺省）→ 构建真实例外链（生产路径）
   *   - 显式 null → fail-closed 无例外通道
   *   - 注入函数 → 测试可控（mock 例外查询）
   */
  exceptionChecker?: ExceptionChecker | null;
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

  // DR-013 例外查询链（出运放行门禁消费真源，与 samples 域同一装配范式）：
  // hasActiveException 注入 mutationService，→Shipped 放行时不具备资格订单可经生效例外放行；
  // 测试可经 options.exceptionChecker 注入 mock（显式 null = fail-closed 无例外通道）
  const shipmentReleaseChecker: ExceptionChecker | null = options.exceptionChecker !== undefined
    ? options.exceptionChecker
    : (() => {
        const exceptionRoutingService = createApprovalRoutingService({ prisma });
        const exceptionService = createExceptionService({
          prisma,
          approvalCreateService: createApprovalCreateService({ prisma, routingService: exceptionRoutingService }),
        });
        return exceptionService.hasActiveException;
      })();

  // Shared auth guard: JWT or API-key (restored — was silently dropped by scaffold)
  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);

  // REQ2-20：旺季舱位提醒（订舱提前期规则扫描）
  const bookingLeadTimeService = createBookingLeadTimeService(prisma);

  // P0-1：订单分批出运与尾款结算（财务侧批次主档）
  const batchService = createOrderShipmentBatchService(prisma);

  // W-C 批三-F（族 C）：发货域日常写端点（运单创建/更新/装箱/批次/合票分配）已从 legacy requireRole
  // 切换到 requirePermission('shipments:write')——矩阵真源授权 SALES/SALES_MANAGER/LOGISTICS
  // （业务员本部门发货登记 + 后勤全公司物流执行），§6.6 ADMIN 业务域只读属预期收紧，
  // SuperAdmin(owner) 经 hasPermission 特判照常全通；→Shipped 放行业务门禁在 service 层
  // （GATE_BLOCKED + DR-013 例外链），角色门按矩阵 write 档对齐。
  // HIGH_RISK_ROLES 仅保留给毁灭性删除端点（DELETE 运单 / DELETE 合票分配）：
  // 矩阵 shipments 域无 delete scope 锚点，且删除释放已配额度影响对账。
  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });


  // ═══ P0-1：订单出运批次（字面路由，须在参数路由 /:id 之前注册） ═══
  const batchRespond = (res: Response, result: any) => {
    if (!result.ok) {
      res.status(result.error.status).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, ...(result.data instanceof Array ? { batches: serializeValue(result.data) } : { ...serializeValue(result.data) }) });
  };

  // GET /order-batches?orderId=… — 订单批次全景（批次列表 + 计划/出运/结算汇总）
  router.get('/order-batches', async (req: Request, res: Response) => {
    try {
      const orderId = String(req.query.orderId || '');
      if (!orderId) {
        res.status(400).json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'orderId 必填' } });
        return;
      }
      batchRespond(res, await batchService.listByOrder(orderId));
    } catch (err: any) {
      logger.error('[ShippingRoute] list order batches failed', { error: err?.message });
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // GET /order-batches/overdue-final — 尾款到期未结清末批清单（watchdog/看板扫描源）
  router.get('/order-batches/overdue-final', async (req: Request, res: Response) => {
    try {
      const result = await batchService.listOverdueFinalBatches(Number(req.query.limit) || 100);
      batchRespond(res, result);
    } catch (err: any) {
      logger.error('[ShippingRoute] overdue final batches failed', { error: err?.message });
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /order-batches — 批次登记（计划期；batchNo 自动递增；单批自动末批）
  router.post('/order-batches', requirePermission('shipments:write'), async (req: Request, res: Response) => {
    try {
      const { orderId, shipmentId, plannedRatio, plannedQty, unit, amount, currency, isFinalBatch, finalPaymentDueDays, notes } = req.body || {};
      if (!orderId) {
        res.status(400).json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'orderId 必填' } });
        return;
      }
      const result = await batchService.createBatch({
        orderId, shipmentId, plannedRatio, plannedQty, unit, amount, currency, isFinalBatch, finalPaymentDueDays, notes,
      }, actorIdFromRequest(req));
      if (!result.ok) {
        res.status(result.error.status).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'order-shipment-batch', action: 'create', ids: [result.data.id] });
      res.status(201).json({ ok: true, batch: serializeValue(result.data) });
    } catch (err: any) {
      logger.error('[ShippingRoute] create order batch failed', { error: err?.message });
      res.status(500).json({ error: { code: 'CREATE_FAILED', message: err.message } });
    }
  });

  // PUT /order-batches/:batchId — 批次更新（计划字段仅计划期可改；status 仅允许 planned→cancelled）
  router.put('/order-batches/:batchId', requirePermission('shipments:write'), async (req: Request, res: Response) => {
    try {
      const result = await batchService.updateBatch(req.params.batchId, req.body || {}, actorIdFromRequest(req));
      if (!result.ok) {
        res.status(result.error.status).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'order-shipment-batch', action: 'update', ids: [req.params.batchId] });
      res.json({ ok: true, batch: serializeValue(result.data) });
    } catch (err: any) {
      logger.error('[ShippingRoute] update order batch failed', { error: err?.message });
      res.status(500).json({ error: { code: 'UPDATE_FAILED', message: err.message } });
    }
  });

  // POST /order-batches/:batchId/mark-shipped — 批次发运确认（排船回填 + 尾款到期日计算 + 末批收款门禁）
  router.post('/order-batches/:batchId/mark-shipped', requirePermission('shipments:write'), async (req: Request, res: Response) => {
    try {
      const result = await batchService.markShipped(req.params.batchId, req.body || {}, actorIdFromRequest(req));
      if (!result.ok) {
        res.status(result.error.status).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'order-shipment-batch', action: 'update', ids: [req.params.batchId] });
      res.json({ ok: true, batch: serializeValue(result.data) });
    } catch (err: any) {
      logger.error('[ShippingRoute] mark batch shipped failed', { error: err?.message });
      res.status(500).json({ error: { code: 'SHIP_FAILED', message: err.message } });
    }
  });

  // POST /order-batches/:batchId/recalc — 结算进度重算（发票分配/核销变动后手动触发；自动触发点二期接入）
  router.post('/order-batches/:batchId/recalc', requirePermission('shipments:write'), async (req: Request, res: Response) => {
    try {
      const result = await batchService.recalcSettlement(req.params.batchId);
      if (!result.ok) {
        res.status(result.error.status).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, batch: serializeValue(result.data) });
    } catch (err: any) {
      logger.error('[ShippingRoute] recalc batch settlement failed', { error: err?.message });
      res.status(500).json({ error: { code: 'RECALC_FAILED', message: err.message } });
    }
  });

  // ── REQ2-20（DR-061）：GET /booking-reminders — 旺季舱位预警清单（订舱提前期规则扫描，只读零写） ──
  // 字面路由：须在参数路由 /:id 之前注册
  router.get('/booking-reminders', async (req: Request, res: Response) => {
    try {
      const result = await bookingLeadTimeService.listBookingReminders();
      res.json(serializeValue(result));
    } catch (err: any) {
      logger.error('[ShippingRoute] booking reminders failed', { error: err?.message });
      res.status(500).json({ error: { code: 'BOOKING_REMINDERS_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/shipping — list / search（format=xlsx → 全量台账 Excel 导出）
  router.get('/', async (req: Request, res: Response) => {
    try {
      const exportAll = req.query.format === 'xlsx';
      const limit = exportAll ? undefined : Math.min(Number(req.query.limit) || 50, 200);
      const offset = exportAll ? 0 : (Number(req.query.offset) || 0);

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
        (prisma as any).shipment.findMany({ where, ...(limit != null ? { take: limit, skip: offset } : {}), orderBy: { createdAt: 'desc' } }),
        (prisma as any).shipment.count({ where }),
      ]);
      if (exportAll) {
        const sheet: XlsxSheet = {
          name: '运单台账',
          columnLabels: ['运单号', '类型', '状态', '运输方式', '客户', '承运方', '船名/航班', '航次', '起运港', '目的港', 'ETD', 'ETA', '件数', '毛重(kg)', '净重(kg)', '体积(CBM)', '运费', '运费币种', '备注'],
          columns: ['shipmentNumber', 'type', 'status', 'shippingMethod', 'customerName', 'carrierName', 'vesselOrFlight', 'voyageNumber', 'portOfLoading', 'portOfDischarge', 'etd', 'eta', 'totalPackages', 'grossWeight', 'netWeight', 'volume', 'freightAmount', 'freightCurrency', 'notes'],
          rows: items.map((s: any) => ({
            shipmentNumber: s.shipmentNumber,
            type: SHIPMENT_TYPE_LABEL[s.type] ?? s.type,
            status: SHIPMENT_STATUS_LABEL[s.status] ?? s.status,
            shippingMethod: SHIPMENT_METHOD_LABEL[s.shippingMethod] ?? s.shippingMethod,
            customerName: s.customerName,
            carrierName: s.carrierName,
            vesselOrFlight: s.vesselOrFlight,
            voyageNumber: s.voyageNumber,
            portOfLoading: s.portOfLoading,
            portOfDischarge: s.portOfDischarge,
            etd: s.etd,
            eta: s.eta,
            totalPackages: s.totalPackages,
            grossWeight: s.grossWeight != null ? Number(s.grossWeight) : null,
            netWeight: s.netWeight != null ? Number(s.netWeight) : null,
            volume: s.volume != null ? Number(s.volume) : null,
            freightAmount: s.freightAmount != null ? Number(s.freightAmount) : null,
            freightCurrency: s.freightCurrency,
            notes: s.notes,
          })),
        };
        const today = new Date().toISOString().slice(0, 10);
        return res.set(xlsxDownloadHeaders(`运单台账_${today}.xlsx`)).send(buildXlsx([sheet]));
      }
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
  router.put('/:id/lines', requirePermission('shipments:write'), async (req: Request, res: Response) => {
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
    if (!lines) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'body.lines must be an array' } });
    const result = await replaceShipmentLines(prisma, req.params.id, lines, actorIdFromRequest(req), req.ip || null);
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, INVALID_CURRENT_STATUS: 409, VALIDATION_FAILED: 400, EXCLUSIVE_FABRIC_BLOCKED: 409 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'shipping', action: 'update', ids: [req.params.id] });
    res.json(result.data);
  });

  // POST /api/v1/shipping/:id/lines/pull-from-order — C4 从订单重新带出装运行
  router.post('/:id/lines/pull-from-order', requirePermission('shipments:write'), async (req: Request, res: Response) => {
    const result = await pullLinesFromOrder(prisma, req.params.id, actorIdFromRequest(req), req.ip || null);
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, ORDER_NOT_FOUND: 404, INVALID_CURRENT_STATUS: 409, VALIDATION_FAILED: 400, EXCLUSIVE_FABRIC_BLOCKED: 409 };
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
  router.put('/:id/cartons', requirePermission('shipments:write'), async (req: Request, res: Response) => {
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
  router.post('/', requirePermission('shipments:write'), async (req: Request, res: Response) => {
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
      exceptionChecker: shipmentReleaseChecker,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        INVALID_STATUS: 400,
        INVALID_INITIAL_STATUS: 400,
        ORDER_NOT_FOUND: 404,
        ORDER_TERMINAL: 400,
        INVALID_CURRENT_ORDER_STATUS: 400,
        GATE_BLOCKED: 409,
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
  router.patch('/:id', requirePermission('shipments:write'), async (req: Request, res: Response) => {
    const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'status');
    const patch = pickFields(req.body, SHIPMENT_PATCH_FIELDS);
    const result = await updateShipment({
      prisma, shipmentId: req.params.id, patch, hasStatus,
      actorId: actorIdFromRequest(req), ip: req.ip || null,
      exceptionChecker: shipmentReleaseChecker,
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
        GATE_BLOCKED: 409,
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
  router.post('/:id/allocations', requirePermission('shipments:write'), async (req: Request, res: Response) => {
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
  router.patch('/:id/allocations/:allocId', requirePermission('shipments:write'), async (req: Request, res: Response) => {
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
