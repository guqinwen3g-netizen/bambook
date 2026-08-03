/**
 * 财务管理 API — /api/v1/finance
 *
 * 由 scaffold-module.ts 生成于 2026-06-15T00:39:31.882Z.
 * 生成器只搭骨架，业务校验/字段白名单/审计需要人工补全。
 *
 * 契约钩子（来自 docs/MODULE_CONTRACT.md）：
 *   - L2.2 输入校验：在每个 mutation 入口加 zod / 手写白名单
 *   - L3.1 EntityLink 同步：mutation 必须调用 syncFinanceReferences
 *   - L4 审批：高风险 mutation 默认走 manifest.safety.approval=required
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { logger } from '../lib/logger';
import { PrismaClient } from '@prisma/client';
import { syncInvoiceReferences, syncPaymentVoucherReferences } from '../entities/sync';
import { writeRouteAuditLog, actorIdFromRequest } from '../audit/routeAudit';
import { cancelInvoice, cancelVoucher, deleteInvoice, deleteVoucher } from './voidDeleteService';
import { recalcInvoiceStatus, recalcVoucherStatus, validateAllocationInput, syncAllocationVoucherLinks, applyAllocation } from './allocationService';
import { createAllocation, updateAllocation, deleteAllocation } from './allocationMutationService';
import { validateStatusTransition } from '../statusTransition';
import { createPaymentVoucher, updatePaymentVoucher } from './paymentVoucherMutationService';
import { createInvoice, updateInvoice } from './invoiceMutationService';

export interface FinanceRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

type FinanceCreateInput = {
  invoiceNumber: string;
  type: string;
  status?: string;
  amount: number;
  currency: string;
  issueDate: string;
  dueDate?: string;
  exchangeRate?: number;
  baseCurrency?: string;
  orderId?: string;
  customerRelationId?: string;
  customerName?: string;
  notes?: string;
  attachments?: any;
};

type VoucherCreateInput = {
  voucherNumber: string;
  type: string;
  amount: number;
  currency: string;
  paymentDate: string;
  paymentMethod: string;
  status?: string; // task_mqxwgafj: unreconciled|partially_reconciled|reconciled
  bankFee?: number;
  exchangeRate?: number;
  baseCurrency?: string;
  invoiceId?: string;
  appliedAmount?: number;
  orderId?: string;
  customerRelationId?: string;
  customerName?: string;
  notes?: string;
  attachments?: any;
};

/** Whitelisted fields for PATCH updates on Invoice */
const INVOICE_PATCH_FIELDS = [
  'type', 'status', 'amount', 'currency', 'issueDate', 'dueDate',
  'exchangeRate', 'baseCurrency', 'orderId', 'customerRelationId',
  'customerName', 'notes', 'attachments',
] as const;

/** Whitelisted fields for PATCH updates on PaymentVoucher */
const VOUCHER_PATCH_FIELDS = [
  'type', 'amount', 'currency', 'paymentDate', 'paymentMethod', 'bankFee',
  'exchangeRate', 'baseCurrency', 'invoiceId', 'appliedAmount',
  'orderId', 'customerRelationId', 'customerName', 'notes', 'attachments',
] as const;

function pickFields(body: Record<string, any>, fields: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  return out;
}

function serializeFinanceValue<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeFinanceValue) as T;
  if (value && typeof value === 'object') {
    if (typeof (value as any).toString === 'function' && (value as any).constructor?.name === 'Decimal') return (value as any).toString() as T;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = serializeFinanceValue(item as any);
    return out as T;
  }
  return value;
}

export function createFinanceRouter(options: FinanceRouterOptions): Router {
  const { prisma, onDataChange, requireAuth, apiKeys } = options;
  const router = Router();

  // Shared auth guard: JWT or API-key (restored — was silently dropped by scaffold)
  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager', 'finance'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });

  // High-risk role guard: owner/admin/manager only

  // GET /api/v1/finance — list / search
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const where: any = { deletedAt: null };
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.orderId) where.orderId = String(req.query.orderId);
    if (req.query.customerRelationId) where.customerRelationId = String(req.query.customerRelationId);
    if (req.query.customer) where.customerName = { contains: String(req.query.customer), mode: 'insensitive' };
    if (req.query.search) {
      const q = String(req.query.search);
      const qInsensitive = { contains: q, mode: 'insensitive' };
      where.OR = [{ invoiceNumber: qInsensitive }, { customerName: qInsensitive }];
    }
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      prisma.invoice.count({ where }),
    ]);
    res.json({ items, total });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance — create (high risk, approval upstream)
  router.post('/', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await createInvoice({
      prisma,
      input: req.body as FinanceCreateInput,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_STATUS: 400, INVALID_TRANSITION: 400, INVALID_CURRENT_STATUS: 400, INVALID_AMOUNT: 400, CREATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const created = result.data!.invoice;
    onDataChange?.({ entity: 'finance', action: 'create', ids: [created.id] });
    res.status(201).json(serializeFinanceValue(created));
  });

  // ────────────────────────────────────────────────────────────────
  // 收付款凭证（PaymentVoucher） — /api/v1/finance/vouchers
  // ⚠️ 字面路由 /vouchers 必须在参数路由 /:id 之前，否则 Express 会
  //    把 /vouchers 匹配到 /:id（id='vouchers'）导致 404。
  // ────────────────────────────────────────────────────────────────

  // GET /api/v1/finance/vouchers — list / search
  router.get('/vouchers', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const where: any = { deletedAt: null };
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.orderId) where.orderId = String(req.query.orderId);
    if (req.query.invoiceId) where.invoiceId = String(req.query.invoiceId);
    if (req.query.customer) where.customerName = { contains: String(req.query.customer), mode: 'insensitive' };
    if (req.query.search) {
      const q = String(req.query.search);
      const qInsensitive = { contains: q, mode: 'insensitive' };
      where.OR = [{ voucherNumber: qInsensitive }, { customerName: qInsensitive }];
    }
    const [items, total] = await Promise.all([
      (prisma as any).paymentVoucher.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      (prisma as any).paymentVoucher.count({ where }),
    ]);
    res.json({ items, total });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/vouchers/:id
  router.get('/vouchers/:id', async (req: Request, res: Response) => {
    try {
      const item = await (prisma as any).paymentVoucher.findUnique({ where: { id: req.params.id } });
      if (!item || item.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '收付款凭证不存在' } });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'GET_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance/vouchers — create (high risk, approval upstream)
  router.post('/vouchers', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    // task ERP-P1-payment-voucher-mutation-shared-service-foundation: route 只调用 service
    const result = await createPaymentVoucher({
      prisma,
      input: req.body as VoucherCreateInput,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_STATUS: 400, INVALID_AMOUNT: 400, CREATE_FAILED: 500 };
      const error = result.error;
      res.status(statusCodeMap[error.code] || 500).json({ error });
      return;
    }
    const created = result.data!.voucher;
    onDataChange?.({ entity: 'finance.vouchers', action: 'create', ids: [created.id] });
    res.status(201).json(serializeFinanceValue(created));
  });

  // PATCH /api/v1/finance/vouchers/:id
  router.patch('/vouchers/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    // task ERP-P1-payment-voucher-mutation-shared-service-foundation: route 只调用 service
    const result = await updatePaymentVoucher({
      prisma,
      voucherId: req.params.id,
      input: req.body as any,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_STATUS: 400, INVALID_AMOUNT: 400, NOT_FOUND: 404, STATUS_NOT_MANUAL_SETTABLE: 400, UPDATE_FAILED: 500 };
      const error = result.error;
      res.status(statusCodeMap[error.code] || 500).json({ error });
      return;
    }
    const updated = result.data!.voucher;
    onDataChange?.({ entity: 'finance.vouchers', action: 'update', ids: [updated.id] });
    res.json(serializeFinanceValue(updated));
  });


  // ────────────────────────────────────────────────────────────────
  // 收付款核销明细（InvoiceAllocation） — /api/v1/finance/allocations
  // task ERP-P1-payment-allocation-route-foundation
  // 业务写入 + status 重算 + AuditLog 同事务闭环（fail closed）
  // ────────────────────────────────────────────────────────────────

  // task ERP-P1: DELETE /vouchers/:id — Voucher 软删（调 voidDeleteService，allocation 阻断）
  // POST /api/v1/finance/vouchers/:id/cancel — cancel (void) voucher
  router.post('/vouchers/:id/cancel', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await cancelVoucher({
      prisma,
      voucherId: req.params.id,
      actorId: actorIdFromRequest(req),
      reason: req.body?.reason,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { VOUCHER_NOT_FOUND: 404, HAS_ALLOCATIONS: 400, INVALID_STATUS: 400, CANCEL_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    res.json({ ok: true, voucher: result.data!.voucher });
  });

  router.delete('/vouchers/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    try {
      const result = await deleteVoucher({
        prisma, voucherId: req.params.id, actorId: actorIdFromRequest(req),
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { INVOICE_NOT_FOUND: 404, VOUCHER_NOT_FOUND: 404, INVALID_STATUS: 400, HAS_ALLOCATIONS: 409, CANCEL_FAILED: 500, DELETE_FAILED: 500 };
        res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'finance', action: 'delete_voucher', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('[finance] DELETE /vouchers/:id failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: { code: 'DELETE_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/allocations — list/query
  router.get('/allocations', async (req: Request, res: Response) => {
    try {
      const where: any = {};
      if (req.query.invoiceId) where.invoiceId = String(req.query.invoiceId);
      if (req.query.voucherId) where.voucherId = String(req.query.voucherId);
      const items = await (prisma as any).invoiceAllocation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(req.query.limit) || 200, 500),
      });
      res.json({ items, total: items.length });
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // POST /api/v1/finance/allocations — create（apply voucher to invoice）
  router.post('/allocations', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await createAllocation({ prisma, input: req.body, actorId: actorIdFromRequest(req), ip: req.ip || null });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { MISSING_INVOICE: 400, MISSING_VOUCHER: 400, MISSING_AMOUNT: 400, INVALID_AMOUNT: 400, INVOICE_NOT_FOUND: 404, VOUCHER_NOT_FOUND: 404, NOT_FOUND: 404, CREATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const allocId = result.data!.allocation.id;
    onDataChange?.({ entity: 'finance.allocations', action: 'create', ids: [allocId] });
    res.status(201).json(result.data);
  });

  // PATCH /api/v1/finance/allocations/:id — update + status 重算
  router.patch('/allocations/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await updateAllocation({ prisma, allocationId: req.params.id, input: req.body, actorId: actorIdFromRequest(req), ip: req.ip || null });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_AMOUNT: 400, NOT_FOUND: 404, UPDATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.allocations', action: 'update', ids: [req.params.id] });
    res.json(result.data);
  });

  // DELETE /api/v1/finance/allocations/:id — delete（撤销核销）+ status 反向重算
  router.delete('/allocations/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await deleteAllocation({ prisma, allocationId: req.params.id, actorId: actorIdFromRequest(req), ip: req.ip || null });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, DELETE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    onDataChange?.({ entity: 'finance.allocations', action: 'delete', ids: [req.params.id] });
    res.json(result.data);
  });

  // task ERP-P1: POST /:id/cancel — Invoice 作废（调 voidDeleteService）
  router.post('/:id/cancel', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    try {
      const result = await cancelInvoice({
        prisma, invoiceId: req.params.id,
        actorId: actorIdFromRequest(req), reason: req.body?.reason,
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { INVOICE_NOT_FOUND: 404, VOUCHER_NOT_FOUND: 404, INVALID_STATUS: 400, HAS_ALLOCATIONS: 409, CANCEL_FAILED: 500, DELETE_FAILED: 500 };
        res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'finance', action: 'cancel', ids: [req.params.id] });
      res.json({ ok: true, invoice: result.data!.invoice });
    } catch (err: any) {
      logger.error('[finance] POST /:id/cancel failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: { code: 'CANCEL_FAILED', message: err.message } });
    }
  });

  // task ERP-P1: DELETE /:id — Invoice 软删（调 voidDeleteService，allocation 阻断）
  router.delete('/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    try {
      const result = await deleteInvoice({
        prisma, invoiceId: req.params.id, actorId: actorIdFromRequest(req),
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { INVOICE_NOT_FOUND: 404, VOUCHER_NOT_FOUND: 404, INVALID_STATUS: 400, HAS_ALLOCATIONS: 409, CANCEL_FAILED: 500, DELETE_FAILED: 500 };
        res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
        return;
      }
      onDataChange?.({ entity: 'finance', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('[finance] DELETE /:id failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: { code: 'DELETE_FAILED', message: err.message } });
    }
  });

  // GET /api/v1/finance/:id — 必须放在 /vouchers 字面路由之后
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const item = await prisma.invoice.findUnique({ where: { id: req.params.id } });
      if (!item || item.deletedAt) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '发票不存在' } });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'GET_FAILED', message: err.message } });
    }
  });

  // PATCH /api/v1/finance/:id
  router.patch('/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await updateInvoice({
      prisma,
      invoiceId: req.params.id,
      input: req.body as any,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 400, INVALID_TRANSITION: 400, INVALID_CURRENT_STATUS: 400, INVALID_AMOUNT: 400, STATUS_NOT_MANUAL_SETTABLE: 400, UPDATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ error: result.error });
      return;
    }
    const updated = result.data!.invoice;
    onDataChange?.({ entity: 'finance', action: 'update', ids: [updated.id] });
    res.json(serializeFinanceValue(updated));
  });

  return router;
}
