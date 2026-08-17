import { Router, Request, Response } from 'express';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { createOrderLine, updateOrderLine, deleteOrderLine } from './orderLineMutationService';
import { actorIdFromRequest } from '../audit/routeAudit';
import { stripLineWritable } from './orderLineWritable';
import { Prisma, PrismaClient } from '@prisma/client';
import { nextItemNo } from './orderLineItems';
import { parseFieldSources, FieldSourceTag } from '../import/persistOrders';
import { syncOrderLineEntityReferences } from '../entities/sync';

export interface OrderLinesRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createOrderLinesRouter(opts: OrderLinesRouterOptions): Router {
  const router = Router();
  const { requireAuth, apiKeys } = opts;

  // Shared auth guard: JWT cookie/Bearer OR API-key header.
  // Replaces inline api-key-only guard — write ops now require JWT + role below.
  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });

  router.get('/', async (_req, res) => {
    try {
      const rows = await opts.prisma.orderLine.findMany({
        where: { order: { deletedAt: null } },
        include: { order: true },
        orderBy: [{ order: { importedAt: 'desc' } }, { lineNumber: 'asc' }],
      });
      return res.json({ ok: true, lines: rows.map(serializeOrderLine) });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: { code: 'LIST_LINES_FAILED', message: '订单行查询失败' } });
    }
  });

  // task ERP-P1: POST / 调 orderLineMutationService（事务+sync+audit fail closed）
  router.post('/', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req, res) => {
    const body = (req.body || {}) as Record<string, unknown> & { poNumber?: string };
    const poNumber = String(body.poNumber || '').trim();
    if (!poNumber) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'poNumber is required' } });
    }
    try {
      // 查找 parent order（显式校验，不自动 upsert）
      const order = await opts.prisma.order.findUnique({ where: { poNumber } });
      if (!order || order.deletedAt) {
        return res.status(404).json({ ok: false, error: { code: 'ORDER_NOT_FOUND', message: `order poNumber=${poNumber} not found or deleted` } });
      }
      const writable = stripLineWritable(body);
      const lineSources: Record<string, FieldSourceTag> = {};
      for (const k of Object.keys(writable)) {
        if (k === 'status') continue;
        lineSources[k] = 'manual';
      }
      const { itemNo: _ignoredItemNo, lineNumber: _ignoredLineNumber, ...extra } = writable;
      const result = await createOrderLine({
        prisma: opts.prisma,
        orderId: order.id,
        itemNo: writable.itemNo ? String(writable.itemNo) : undefined, // 不传则 service 事务内自动算
        materialCode: writable.materialCode ? String(writable.materialCode) : undefined,
        description: writable.description ? String(writable.description) : undefined,
        quantity: Number(writable.quantity || 0),
        unit: writable.unit ? String(writable.unit) : undefined,
        unitPrice: writable.unitPrice ? Number(writable.unitPrice) : undefined,
        type: order.type,
        fieldSources: lineSources as any,
        actorId: actorIdFromRequest(req),
        extra: extra as any,
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { INVALID_INPUT: 400, ORDER_NOT_FOUND: 404, ORDER_LINE_NOT_FOUND: 404, DUPLICATE_ITEM_NO: 409, CREATE_LINE_FAILED: 500, UPDATE_LINE_FAILED: 500 };
        return res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      }
      opts.onDataChange?.({ entity: 'order-lines', action: 'create', ids: [result.data!.line.id] });
      return res.json({ ok: true, line: serializeOrderLine(result.data!.line) });
    } catch (e: any) {
      const code = (e?.code as string | undefined) ?? '';
      if (code === 'P2002') {
        return res.status(409).json({ ok: false, error: { code: 'DUPLICATE_ITEM_NO', message: 'This PO item number already exists.' } });
      }
      return res.status(500).json({ ok: false, error: { code: 'CREATE_LINE_FAILED', message: '订单行创建失败' } });
    }
  });

  router.put('/:id', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req, res) => {
    const id = req.params.id;
    const writable = stripLineWritable(req.body || {});
    if (Object.keys(writable).length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'EMPTY_PATCH', message: 'patch body has no editable fields' } });
    }

    try {
      // Read current fieldSources so we can tag manually-edited fields.
      const current = await opts.prisma.orderLine.findUnique({ where: { id }, select: { fieldSources: true } });
      if (!current) {
        return res.status(404).json({ ok: false, error: { code: 'ORDER_LINE_NOT_FOUND', message: `order line ${id} not found` } });
      }
      const prevSources = parseFieldSources(current?.fieldSources);
      const nextSources = { ...prevSources };
      for (const k of Object.keys(writable)) {
        const prev = prevSources[k];
        if (prev === 'manual' || prev === 'imported-then-edited') {
          nextSources[k] = 'imported-then-edited';
        } else {
          nextSources[k] = 'manual';
        }
      }

      // task ERP-P1: 调 updateOrderLine service（事务+sync+audit fail closed）
      const result = await updateOrderLine({
        prisma: opts.prisma, lineId: id,
        patch: { ...(writable as any), fieldSources: nextSources },
        actorId: actorIdFromRequest(req),
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { INVALID_INPUT: 400, ORDER_NOT_FOUND: 404, ORDER_LINE_NOT_FOUND: 404, DUPLICATE_ITEM_NO: 409, CREATE_LINE_FAILED: 500, UPDATE_LINE_FAILED: 500 };
        return res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      }
      opts.onDataChange?.({ entity: 'order-lines', action: 'update', ids: [id] });
      return res.json({ ok: true, line: serializeOrderLine(result.data!.line) });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: { code: 'UPDATE_LINE_FAILED', message: '订单行更新失败' } });
    }
  });

  // DELETE /api/v1/order-lines/:id — delete order line
  router.delete('/:id', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req, res) => {
    const id = req.params.id;
    try {
      const result = await deleteOrderLine({
        prisma: opts.prisma,
        lineId: id,
        actorId: actorIdFromRequest(req),
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { ORDER_LINE_NOT_FOUND: 404, DELETE_LINE_FAILED: 500 };
        const error = result.error;
        return res.status(statusCodeMap[error.code] || 500).json({ ok: false, error });
      }
      opts.onDataChange?.({ entity: 'order-lines', action: 'delete', ids: [id] });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: { code: 'DELETE_LINE_FAILED', message: '订单行删除失败' } });
    }
  });

  return router;
}


function serializeOrderLine(line: any) {
  const out: any = { ...line };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
  }
  if (out.order) {
    out.poNumber = out.order.poNumber;
    out.customer = out.order.customer;
    for (const k of Object.keys(out.order)) {
      if (typeof out.order[k] === 'bigint') out.order[k] = Number(out.order[k]);
    }
  }
  return out;
}

function makeOrderId(poNumber: string): string {
  return `PO-${poNumber.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
