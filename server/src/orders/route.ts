import { Router, Request, Response } from 'express';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { writeRouteAuditLog, actorIdFromRequest } from '../audit/routeAudit';
import { deleteOrder, transitionOrderStatus, VALID_ORDER_STATUSES as LIFECYCLE_VALID_STATUSES } from './orderLifecycleService';
import { initProductionStages } from '../production/stageService';
import { Prisma, PrismaClient } from '@prisma/client';
import { persistOrders, PersistResult } from '../import/persistOrders';
import { ParsedOrder } from '../import/types';
import { syncOrderEntityReferences } from '../entities/sync';
import { getOrder, getOrderContext, queryOrders } from './query';
import { logger } from '../lib/logger';

export interface OrdersRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

/**
 * Express router for the persistent Order resource.
 *
 *   GET    /            → list active orders (with lines, BigInts → numbers)
 *   POST   /import      → persist a batch of parsed POs (idempotent by poNumber)
 *   POST   /            → create a manual (non-PDF) order. Marks every supplied
 *                         field as `'manual'` in `fieldSources` so subsequent
 *                         PDF imports won't overwrite them.
 *   PUT    /:id         → patch a single order from the detail card. Each
 *                         supplied field is tagged `'manual'` (or
 *                         `'imported-then-edited'` if it was previously 'pdf').
 *
 * The frontend's order list reads from `GET /api/v1/orders` so it always sees
 * the same source of truth that the import wizard writes into. Tombstoned rows
 * (`deletedAt != null`) are excluded server-side; the client merges with its
 * localStorage tombstones via the existing `converge()` helper.
 */
export function createOrdersRouter(opts: OrdersRouterOptions): Router {
  const router = Router();
  const { requireAuth, apiKeys } = opts;

  // Shared auth guard: JWT cookie/Bearer OR API-key header.
  // Replaces inline api-key-only guard — write ops now require JWT + role below.
  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const rows = await opts.prisma.order.findMany({
        where: { deletedAt: null },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
        orderBy: [{ importedAt: 'desc' }, { updatedAt: 'desc' }],
      });
      return res.json({ ok: true, orders: rows.map(serializeOrder) });
    } catch (e: any) {
      logger.error('[orders/list] failed', { error: e?.message || String(e) });
      return res.status(500).json({
        error: 'LIST_FAILED',
        message: String(e?.message ?? e),
      });
    }
  });

  router.post('/query', async (req: Request, res: Response) => {
    try {
      const result = await queryOrders(opts.prisma, req.body || {});
      return res.json({ ok: true, ...result });
    } catch (e: any) {
      logger.error('[orders/query] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'QUERY_FAILED', message: String(e?.message ?? e) });
    }
  });

  // 阶段 D / D3：订单全链路聚合（只读）。注册在 /:id 之前避免歧义。
  router.get('/:id/context', async (req: Request, res: Response) => {
    try {
      const result = await getOrderContext(opts.prisma, req.params.id);
      if (!result.found) return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found' });
      return res.json({ ok: true, ...result });
    } catch (e: any) {
      logger.error('[orders/context] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'CONTEXT_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const result = await getOrder(opts.prisma, { id: req.params.id });
      if (!(result as any).found) return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found' });
      return res.json({ ok: true, order: (result as any).item });
    } catch (e: any) {
      logger.error('[orders/detail] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'DETAIL_FAILED', message: String(e?.message ?? e) });
    }
  });

  router.post('/import', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const body = req.body as { orders?: ParsedOrder[]; overwriteExisting?: boolean; mode?: 'overwrite-pdf-fields-only' | 'force-overwrite' } | undefined;
    const orders = Array.isArray(body?.orders) ? body!.orders : [];
    if (orders.length === 0) {
      return res.status(400).json({
        error: 'NO_ORDERS',
        message: 'POST body must be { "orders": ParsedOrder[] } with at least one order',
      });
    }

    const invalid = orders.filter((o) => !o || typeof o.poNumber !== 'string' || !o.poNumber);
    if (invalid.length > 0) {
      return res.status(400).json({
        error: 'INVALID_ORDER',
        message: `Every order must have a non-empty poNumber. ${invalid.length} bad row(s).`,
      });
    }

    try {
      const results: PersistResult[] = await persistOrders(opts.prisma, orders, {
        mode: body?.mode ?? 'overwrite-pdf-fields-only',
        overwriteExisting: body?.overwriteExisting ?? true,
      });

      // Hydrate freshly-saved rows so the frontend can drop them straight into
      // its in-memory list without a follow-up GET.
      const ids = results.map((r) => r.orderId);
      const saved = await opts.prisma.order.findMany({
        where: { id: { in: ids } },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      for (const order of saved) {
        await syncOrderEntityReferences(opts.prisma, order as any, { source: 'pdf-import' });
      }
      // Convert BigInt fields → numbers so Express's JSON serializer can handle them.
      const savedJson = saved.map(serializeOrder);
      opts.onDataChange?.({ entity: 'orders', action: 'import', ids });

      const created = results.filter((r) => r.action === 'created').length;
      const updated = results.filter((r) => r.action === 'updated').length;
      return res.json({
        ok: true,
        created,
        updated,
        results,
        orders: savedJson,
      });
    } catch (e: any) {
      logger.error('[orders/import] failed', { error: e?.message || String(e) });
      return res.status(500).json({
        error: 'PERSIST_FAILED',
        message: String(e?.message ?? e),
      });
    }
  });

  /**
   * Create a manual (non-PDF) order. Every field in the payload is recorded as
   * `'manual'` in `fieldSources`, so a subsequent PDF re-import for the same
   * `poNumber` will not overwrite anything the user typed by hand.
   */
  router.post('/', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown> & { id?: string; poNumber?: string };
    const errors: string[] = [];
    if (!body.customer) errors.push('customer (客户) is required');
    if (!body.poNumber) errors.push('poNumber (订单号) is required');
    if (!body.millName) errors.push('millName (面料工厂) is required');
    if (errors.length > 0) {
      return res.status(400).json({ error: 'VALIDATION_FAILED', message: errors.join('; ') });
    }

    const ts = Date.now();
    const id = sanitizeId(body.id) ?? `FAB-${String(ts).slice(-6)}`;
    const writableInput = stripReadonly(body);

    // Required scalar columns. Manual entry rarely supplies these explicitly
    // so we fall back to safe defaults.
    const product = (writableInput.product as string | undefined) ?? '';
    const quantity = Number.isFinite(Number(writableInput.quantity)) ? Number(writableInput.quantity) : 0;
    const status = (writableInput.status as string | undefined) ?? 'Pending';
    const dueDate = (writableInput.dueDate as string | undefined) ?? (writableInput.clientDate as string | undefined) ?? '';
    const quoteAmount = Number.isFinite(Number(writableInput.quoteAmount))
      ? Number(writableInput.quoteAmount)
      : Number.isFinite(Number(writableInput.contractAmount)) ? Number(writableInput.contractAmount) : 0;

    const fieldSources: Record<string, 'manual'> = {};
    for (const k of Object.keys(writableInput)) {
      if (k === 'fieldSources' || k === 'lines' || k === 'orderDate') continue;
      fieldSources[k] = 'manual';
    }

    try {
      // $transaction wraps create + auditLog to enforce fail-closed:
      // if AuditLog write fails, the order create rolls back.
      const created = await opts.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            ...(writableInput as any),
            id,
            customer: writableInput.customer as string,
            product,
            type: (writableInput.type as string | undefined) ?? 'Fabric',
            quantity: Math.round(quantity),
            status,
            dueDate,
            quoteAmount,
            // 业务规则：下单后7天生产计划截止，交货期前15天延期通知截止
            productionPlanDeadline: (() => {
              const d = new Date();
              d.setDate(d.getDate() + 7);
              return d.toISOString().slice(0, 10);
            })(),
            delayNoticeDeadline: dueDate ? (() => {
              const d = new Date(dueDate);
              d.setDate(d.getDate() - 15);
              return d.toISOString().slice(0, 10);
            })() : null,
            source: 'manual',
            updatedAt: BigInt(ts),
            importedAt: BigInt(ts),
            salesCurrency: (writableInput.salesCurrency as string | undefined) ?? 'USD',
            purchaseCurrency: (writableInput.purchaseCurrency as string | undefined) ?? 'CNY',
            fieldSources: fieldSources as Prisma.InputJsonValue,
          },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorIdFromRequest(req),
          source: 'route:orders:create',
          operation: 'create_order',
          targetType: 'Order',
          targetId: order.id,
          after: {
            id: order.id,
            poNumber: order.poNumber,
            customer: order.customer,
            product: order.product,
            type: order.type,
            status: order.status,
            quantity: order.quantity,
            quoteAmount: order.quoteAmount,
            dueDate: order.dueDate,
            millName: order.millName,
          },
          ip: req.ip || null,
        });
        return order;
      });
      await syncOrderEntityReferences(opts.prisma, created as any, { source: 'manual' });
      // 初始化 10 阶段生产管线
      await initProductionStages(opts.prisma, created.id).catch(() => {});
      opts.onDataChange?.({ entity: 'orders', action: 'create', ids: [created.id] });
      return res.json({ ok: true, order: serializeOrder(created) });
    } catch (e: any) {
      logger.error('[orders/create] failed', { error: e?.message || String(e) });
      const code = (e?.code as string | undefined) ?? '';
      if (code === 'P2002') {
        return res.status(409).json({
          error: 'DUPLICATE_PO',
          message: `Order with poNumber=${body.poNumber} already exists. Use PUT /api/v1/orders/:id to update it.`,
        });
      }
      return res.status(500).json({ error: 'CREATE_FAILED', message: String(e?.message ?? e) });
    }
  });

  /**
   * Patch an existing order from the detail-card edit flow. Each supplied
   * scalar field is recorded in `fieldSources` as either `'manual'` (new
   * value where there was none) or `'imported-then-edited'` (overrides a
   * value that came from PDF import).
   */
  router.put('/:id', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'BAD_ID', message: 'order id required' });

    const body = (req.body || {}) as Record<string, unknown>;
    const writableInput = stripReadonly(body);
    if (Object.keys(writableInput).length === 0) {
      return res.status(400).json({ error: 'EMPTY_PATCH', message: 'patch body has no editable fields' });
    }

    try {
      const existing = await opts.prisma.order.findUnique({
        where: { id },
        select: {
          id: true,
          fieldSources: true,
          status: true,
          poNumber: true,
          customer: true,
          product: true,
          type: true,
          quantity: true,
          quoteAmount: true,
          dueDate: true,
          millName: true,
        },
      });
      if (!existing) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `order ${id} not found` });
      }

      const previousSources = parsePrevSources(existing.fieldSources);
      const nextSources: Record<string, 'pdf' | 'manual' | 'imported-then-edited'> = { ...previousSources };
      for (const k of Object.keys(writableInput)) {
        if (k === 'fieldSources' || k === 'lines') continue;
        const prev = previousSources[k];
        nextSources[k] = prev === 'pdf' ? 'imported-then-edited' : 'manual';
      }

      // $transaction wraps update + auditLog to enforce fail-closed:
      // if AuditLog write fails, the order update rolls back.
      const updated = await opts.prisma.$transaction(async (tx) => {
        const order = await tx.order.update({
          where: { id },
          data: {
            ...(writableInput as any),
            updatedAt: BigInt(Date.now()),
            fieldSources: nextSources as Prisma.InputJsonValue,
          },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorIdFromRequest(req),
          source: 'route:orders:update',
          operation: 'update_order',
          targetType: 'Order',
          targetId: order.id,
          before: {
            status: existing.status,
            poNumber: existing.poNumber,
            customer: existing.customer,
            product: existing.product,
            type: existing.type,
            quantity: existing.quantity,
            quoteAmount: existing.quoteAmount,
            dueDate: existing.dueDate,
            millName: existing.millName,
          },
          after: {
            status: order.status,
            poNumber: order.poNumber,
            customer: order.customer,
            product: order.product,
            type: order.type,
            quantity: order.quantity,
            quoteAmount: order.quoteAmount,
            dueDate: order.dueDate,
            millName: order.millName,
          },
          ip: req.ip || null,
        });
        return order;
      });
      await syncOrderEntityReferences(opts.prisma, updated as any, { source: 'manual' });
      opts.onDataChange?.({ entity: 'orders', action: 'update', ids: [updated.id] });
      return res.json({ ok: true, order: serializeOrder(updated) });
    } catch (e: any) {
      logger.error('[orders/update] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'UPDATE_FAILED', message: String(e?.message ?? e) });
    }
  });

  // task ERP-P1: DELETE /:id 调 lifecycleService（事务+audit+EntityLink inactive）
  router.delete('/:id', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'BAD_ID', message: 'order id required' });
    try {
      const result = await deleteOrder({
        prisma: opts.prisma, orderId: id,
        actorId: (req as any).actor?.userId || (req as any).actor?.id || 'api',
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { ORDER_NOT_FOUND: 404, ORDER_ALREADY_DELETED: 409, DELETE_FAILED: 500, INVALID_STATUS: 400, INVALID_TRANSITION: 400, NO_CHANGE: 400, TRANSITION_FAILED: 500 };
        return res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      }
      opts.onDataChange?.({ entity: 'orders', action: 'delete', ids: [id] });
      return res.json({ ok: true, order: serializeOrder(result.data!.order) });
    } catch (e: any) {
      logger.error('[orders/delete] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'DELETE_FAILED', message: String(e?.message ?? e) });
    }
  });

  // ---------------------------------------------------------------------------
  // Status Transition (with audit trail)
  // ---------------------------------------------------------------------------
  // NOTE: Below routes use multi-segment paths (e.g. /:id/status-transition,
  // /kanban/summary) or different HTTP methods (PATCH /batch-status), so they
  // do NOT collide with the parameterized GET/:id, PUT/:id, DELETE/:id above.
  // If any future route uses a single-segment path like /summary, MOVE it
  // ABOVE the /:id handlers to avoid being captured.

  /** Validate and record a status transition, then update the order. */
  // task ERP-P1: 调 lifecycleService（事务+OrderStatusTransition+sync+audit）
  router.post('/:id/status-transition', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = (req.body || {}) as { toStatus?: string; note?: string; operator?: string; lineId?: string };
    const toStatus = String(body.toStatus || '').trim();
    try {
      const result = await transitionOrderStatus({
        prisma: opts.prisma, orderId: id, toStatus,
        note: body.note, operator: body.operator, lineId: body.lineId,
        actorId: (req as any).actor?.userId || (req as any).actor?.id || 'api',
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { ORDER_NOT_FOUND: 404, ORDER_ALREADY_DELETED: 409, INVALID_STATUS: 400, INVALID_TRANSITION: 400, NO_CHANGE: 400, DELETE_FAILED: 500, TRANSITION_FAILED: 500 };
        return res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      }
      opts.onDataChange?.({ entity: 'orders', action: 'status-transition', ids: [id] });
      const d = result.data!;
      return res.json({
        ok: true,
        transition: {
          id: d.transitionId,
          fromStatus: d.fromStatus,
          toStatus: d.toStatus,
          note: d.note,
          operator: d.operator,
          lineId: d.lineId,
          createdAt: d.createdAt,
        },
        order: serializeOrder(d.order),
      });
    } catch (e: any) {
      logger.error('[orders/status-transition] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'TRANSITION_FAILED', message: String(e?.message ?? e) });
    }
  });

  /** Get the status transition timeline for an order. */
  router.get('/:id/timeline', async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      const transitions = await opts.prisma.orderStatusTransition.findMany({
        where: { orderId: id },
        orderBy: { createdAt: 'asc' },
      });
      const serialized = transitions.map((t: any) => {
        const out: any = { ...t };
        for (const k of Object.keys(out)) {
          if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
        }
        return out;
      });
      return res.json({ ok: true, timeline: serialized });
    } catch (e: any) {
      logger.error('[orders/timeline] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'TIMELINE_FAILED', message: String(e?.message ?? e) });
    }
  });

  /** Batch status update for multiple orders. */
  router.patch('/batch-status', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const body = (req.body || {}) as { ids?: string[]; toStatus?: string; note?: string; operator?: string };
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const toStatus = String(body.toStatus || '').trim();

    if (ids.length === 0) {
      return res.status(400).json({ error: 'NO_IDS', message: 'ids array is required' });
    }
    if (!toStatus || !LIFECYCLE_VALID_STATUSES.includes(toStatus as any)) {
      return res.status(400).json({ error: 'INVALID_STATUS', message: `toStatus must be one of: ${LIFECYCLE_VALID_STATUSES.join(', ')}` });
    }

    try {
      const results: Array<{ id: string; fromStatus: string; toStatus: string; skipped?: string }> = [];

      for (const id of ids) {
        // 走 transitionOrderStatus service，确保状态机校验 + 审计日志 + 事务完整性
        const result = await transitionOrderStatus({
          prisma: opts.prisma,
          orderId: id,
          toStatus: toStatus as any,
          note: body.note || undefined,
          operator: body.operator || 'batch-api',
          actorId: (req as any).user?.id || 'batch-api',
        });
        if (result.ok && result.data) {
          results.push({ id, fromStatus: result.data.fromStatus, toStatus: result.data.toStatus });
        } else if (result.error) {
          // 跳过失败项（已删除/无转换/非法转换），记录原因
          results.push({ id, fromStatus: '', toStatus, skipped: result.error.code || 'FAILED' });
        }
      }

      opts.onDataChange?.({ entity: 'orders', action: 'batch-status', ids });
      return res.json({ ok: true, updated: results });
    } catch (e: any) {
      logger.error('[orders/batch-status] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'BATCH_FAILED', message: String(e?.message ?? e) });
    }
  });

  /** Kanban aggregation: count orders per status. */
  router.get('/kanban/summary', async (_req: Request, res: Response) => {
    try {
      const groups = await opts.prisma.order.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { id: true },
        _sum: { quoteAmount: true },
      });
      const kanban = groups.map((g: any) => ({
        status: g.status,
        count: g._count?.id ?? 0,
        totalAmount: Number(g._sum?.quoteAmount ?? 0),
      }));
      return res.json({ ok: true, kanban });
    } catch (e: any) {
      logger.error('[orders/kanban] failed', { error: e?.message || String(e) });
      return res.status(500).json({ error: 'KANBAN_FAILED', message: String(e?.message ?? e) });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Strip fields the client should never set directly. We block server-managed
 * audit columns plus the immutable id (only used on create).
 */
function stripReadonly(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const dbKey = ORDER_WRITE_ALIASES[k] ?? k;
    if (!ORDER_WRITABLE_FIELDS.has(dbKey)) continue;
    if (v === undefined) continue;
    out[dbKey] = v;
  }
  return out;
}

const ORDER_WRITE_ALIASES: Record<string, string> = {
  contactTelephone: 'contactPhone',
  shippingDate: 'shipmentDate',
};

const ORDER_WRITABLE_FIELDS = new Set([
  'customer',
  'product',
  'type',
  'quantity',
  'status',
  'dueDate',
  'quoteAmount',
  'poNumber',
  'customerCode',
  'season',
  'poDate',
  'contactPerson',
  'contactPhone',
  'currency',
  'deliveryTerms',
  'paymentTerms',
  'shipToName',
  'shipToAddress1',
  'shipToAddress2',
  'shipToCountry',
  'shipToPhone',
  'deliverTo',
  'totalNet',
  'totalActual',
  'source',
  'fieldSources',
  'purchaseCurrency',
  'salesCurrency',
  'customerAddress',
  'customerRelationId',
  'millName',
  'millAddress',
  'millContact',
  'millPhone',
  'millRelationId',
  'consigneeName',
  'consigneeAddress',
  'consigneeContact',
  'consigneeRelationId',
  'billToName',
  'billToAddress',
  'billToContact',
  'billToIsAgent',
  'billToRelationId',
  'salesPerson',
  'salesPersonRelationId',
  'merchandiser',
  'merchandiserRelationId',
  'supervisor',
  'supervisorRelationId',
  'salesContractNumber',
  'finalContractNumber',
  'productionBatch',
  'productColorCode',
  'clientCode',
  'referenceBatch',
  'productionDate',
  'clientDate',
  'fabricCode',
  'fabricContent',
  'width',
  'gsm',
  'asPerson',
  'salesPrice',
  'contractAmount',
  'paymentInstrument',
  'expectedPaymentDate',
  'actualPaymentDate',
  'actualPaymentAmount',
  'invoiceNumber',
  'invoiceDate',
  'shipmentDate',
  'shipmentMethod',
  'shipmentQuantity',
  'shipmentAmount',
  'sampleSentDate',
  'sampleConfirmedDate',
  'sampleTrackingNumber',
  'shipmentSampleComments',
  'fabricSampleSentDate',
  'fabricSampleConfirmedDate',
  'fabricSampleTrackingNumber',
  'paidSampleQuantity',
  'factoryVisitDate',
  'purchasePrice',
  'purchasePaymentDate',
  'supplierInvoiceNumber',
  'supplierInvoiceDate',
  'supplierInvoiceAmount',
  'specialInstructions',
  'ocDays',
]);

function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
}

function parsePrevSources(raw: unknown): Record<string, 'pdf' | 'manual' | 'imported-then-edited'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, 'pdf' | 'manual' | 'imported-then-edited'> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === 'pdf' || v === 'manual' || v === 'imported-then-edited') out[k] = v;
  }
  return out;
}

function serializeOrder(o: any) {
  const out: any = { ...o };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
  }
  if (Array.isArray(out.lines)) {
    out.lines = out.lines.map((l: any) => {
      const ll: any = { ...l };
      for (const k of Object.keys(ll)) {
        if (typeof ll[k] === 'bigint') ll[k] = Number(ll[k]);
      }
      return ll;
    });
  }
  return out;
}
