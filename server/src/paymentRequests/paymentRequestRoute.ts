/**
 * paymentRequestRoute.ts — DR-017 付款申请 API
 *
 * 挂载：createPaymentRequestRouter({ prisma, requireAuth })
 * 建议路径：/api/v1/payment-requests（由主代理在 index.ts 收口）
 *
 * 端点：
 *   POST /              — 创建付款申请（scope finance:payment_request:create；创建即 Pending + 生成审批单）
 *   GET  /              — 列表（按 status / paymentCategory / applicantId / search 过滤，附 total）
 *   GET  /:id           — 详情（附 approvalRequest / paymentVoucher 关联快照）
 *   POST /:id/issue-voucher — 生成付款凭证（scope finance:payment_request:create；DR-017 幂等）
 *   POST /:id/cancel    — 申请人作废（仅 Draft/Pending，仅本人）
 *
 * 鉴权：JWT fail-closed（无 token 401，无 scope 403）
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { hasScopeOnRequest } from '../auth/permissionGuard';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';
import {
  createPaymentRequestService,
  PAYMENT_REQUEST_SOURCE_TYPES,
  type PaymentRequestSourceType,
} from './paymentRequestService';
import { logger } from '../lib/logger';

export interface PaymentRequestRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
}

export function createPaymentRequestRouter(options: PaymentRequestRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth } = options;

  const routingService = createApprovalRoutingService({ prisma });
  const approvalCreateService = createApprovalCreateService({ prisma, routingService });
  const paymentRequestService = createPaymentRequestService({ prisma, approvalCreateService });

  // ── 鉴权：JWT fail-closed ──
  const authenticate = (req: Request, res: Response): { userId: string; roles: string[] } | null => {
    const actor = extractActorFromRequest(req);
    if (!actor?.userId) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required.' });
      return null;
    }
    (req as any).actor = actor; // 供 hasScopeOnRequest 使用（permissionGuard 从 req.actor 取权限）
    return { userId: actor.userId, roles: actor.roles ?? [] };
  };

  const requireScope = (req: Request, res: Response, scope: string): boolean => {
    if (!requireAuth) return true;
    if (!hasScopeOnRequest(req, scope as any)) {
      res.status(403).json({ error: 'FORBIDDEN', message: `INSUFFICIENT_SCOPE: ${scope}` });
      return false;
    }
    return true;
  };

  // ══════════════════════════════════════════════════════════════════
  // POST / — 创建付款申请（创建即提交审批）
  // ══════════════════════════════════════════════════════════════════
  router.post('/', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, 'finance:payment_request:create')) return;

    try {
      const body = req.body || {};
      const sourceTypeRaw = body.sourceType ? String(body.sourceType).trim() : undefined;
      const sourceType = sourceTypeRaw && (PAYMENT_REQUEST_SOURCE_TYPES as readonly string[]).includes(sourceTypeRaw)
        ? (sourceTypeRaw as PaymentRequestSourceType)
        : undefined;

      const result = await paymentRequestService.createPaymentRequest({
        supplierId: body.supplierId ? String(body.supplierId).trim() : undefined,
        supplierName: body.supplierName ? String(body.supplierName).trim() : undefined,
        totalAmount: body.totalAmount,
        currency: String(body.currency ?? '').trim(),
        paymentCategory: body.paymentCategory ? String(body.paymentCategory).trim() : undefined,
        requestDate: body.requestDate ? String(body.requestDate).trim() : undefined,
        expectedPaymentDate: body.expectedPaymentDate ? String(body.expectedPaymentDate).trim() : undefined,
        sourceType,
        sourceId: body.sourceId ? String(body.sourceId).trim() : undefined,
        remark: body.remark ? String(body.remark).trim() : undefined,
        attachments: body.attachments,
        applicantId: auth.userId,
        // 前端传入的 reviewerId 绝不用于审批路由，仅透传审计（DR7-A2）
        clientSuppliedReviewerId: body.reviewerId ? String(body.reviewerId).trim() : null,
      });

      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.status(201).json(result.data);
    } catch (e: any) {
      logger.error('[PaymentRequestRoute] POST / failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '创建付款申请失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // GET / — 列表（status / paymentCategory / applicantId / search 过滤；附 total 供截断透明披露）
  // ══════════════════════════════════════════════════════════════════
  router.get('/', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const where: any = { deletedAt: null };
      if (req.query.status) where.status = String(req.query.status);
      if (req.query.paymentCategory) where.paymentCategory = String(req.query.paymentCategory);
      if (req.query.applicantId) where.applicantId = String(req.query.applicantId);
      // search：申请编号 / 收款方 / 事由 三字段模糊匹配（与 finance route 同一 contains+insensitive 惯例）
      if (req.query.search) {
        const q = String(req.query.search).trim();
        if (q) {
          const qInsensitive = { contains: q, mode: 'insensitive' as const };
          where.OR = [
            { requestNumber: qInsensitive },
            { supplierName: qInsensitive },
            { remark: qInsensitive },
          ];
        }
      }
      const take = Math.min(Number(req.query.limit ?? 100), 500);
      const [items, total] = await Promise.all([
        prisma.paymentRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
        }),
        prisma.paymentRequest.count({ where }),
      ]);
      return res.json({ items, total });
    } catch (e: any) {
      logger.error('[PaymentRequestRoute] GET / failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '查询付款申请列表失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // GET /:id — 详情
  // ══════════════════════════════════════════════════════════════════
  router.get('/:id', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const item = await prisma.paymentRequest.findUnique({ where: { id: req.params.id } });
      if (!item || item.deletedAt) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `付款申请 ${req.params.id} 不存在` });
      }
      // 关联数据单独查询（PaymentRequest 模型无 @relation，禁用 include）
      const [approvalRequest, paymentVoucher] = await Promise.all([
        item.approvalRequestId
          ? prisma.approvalRequest.findUnique({
              where: { id: item.approvalRequestId },
              select: { id: true, status: true, reviewerId: true, decidedAt: true, decisionNote: true },
            }).catch(() => null)
          : Promise.resolve(null),
        item.paymentVoucherId
          ? prisma.paymentVoucher.findUnique({
              where: { id: item.paymentVoucherId },
              select: { id: true, voucherNumber: true, type: true, voucherCategory: true, amount: true, currency: true, status: true },
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      return res.json({ item: { ...item, approvalRequest, paymentVoucher } });
    } catch (e: any) {
      logger.error('[PaymentRequestRoute] GET /:id failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '查询付款申请详情失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // POST /:id/issue-voucher — 生成付款凭证（手动触发兜底；幂等）
  //   审批通过事件钩子（paymentRequestApprovalHook）为主链路；本端点用于
  //   漏触发/失败重试：先惰性回写审批决议（Approved 自动生成凭证），再按
  //   DR-017 状态机发凭证（未批准 409；已发凭证直接返回既有凭证）。
  // ══════════════════════════════════════════════════════════════════
  router.post('/:id/issue-voucher', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, 'finance:payment_request:create')) return;
    try {
      // 先回写审批决议（Pending 且审批已决议时推进状态并自动发凭证）
      await paymentRequestService.syncApprovalDecision({ paymentRequestId: req.params.id, actorId: auth.userId });
      const result = await paymentRequestService.issueVoucherForApprovedRequest({
        paymentRequestId: req.params.id,
        actorId: auth.userId,
        paymentMethod: req.body?.paymentMethod ? String(req.body.paymentMethod).trim() : undefined,
        paymentDate: req.body?.paymentDate ? String(req.body.paymentDate).trim() : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.status(result.data.idempotent ? 200 : 201).json(result.data);
    } catch (e: any) {
      logger.error('[PaymentRequestRoute] POST /:id/issue-voucher failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '生成付款凭证失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // POST /:id/cancel — 申请人作废（仅 Draft/Pending，仅本人）
  // ══════════════════════════════════════════════════════════════════
  router.post('/:id/cancel', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const result = await paymentRequestService.cancelPaymentRequest({
        paymentRequestId: req.params.id,
        actorId: auth.userId,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(result.data);
    } catch (e: any) {
      logger.error('[PaymentRequestRoute] POST /:id/cancel failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '作废付款申请失败' });
    }
  });

  return router;
}
