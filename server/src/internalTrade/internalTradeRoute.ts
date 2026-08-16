/**
 * internalTradeRoute.ts — DR-033 内部供料单 / DR-005 内部面料交易 API
 *
 * 挂载：createInternalTradeRouter({ prisma, requireAuth })
 * 建议路径：/api/v1/internal-trade（由主代理在 index.ts 收口）
 *
 * 端点：
 *   POST /              — 服装部发起内部供料申请（scope order:internal_trade:write）
 *   POST /:id/confirm   — 面料部确认生效（结算价审批通过为前置，scope order:internal_trade:write）
 *   POST /:id/delivery  — 交付登记（关联面料订单既有出运，回写服装订单到货，scope order:internal_trade:write）
 *   POST /:id/cancel    — 取消（仅 Draft/PendingConfirm，scope order:internal_trade:write）
 *   GET  /              — 列表（按 departmentId / status / garmentOrderId / fabricOrderId 过滤）
 *   GET  /:id           — 详情（master + mirror + 解码载荷）
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
  createInternalTransferService,
  INTERNAL_TRANSFER_STATUSES,
  type InternalTransferStatus,
} from './internalTransferService';
import { logger } from '../lib/logger';

export interface InternalTradeRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
}

const WRITE_SCOPE = 'order:internal_trade:write';

export function createInternalTradeRouter(options: InternalTradeRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth } = options;

  const routingService = createApprovalRoutingService({ prisma });
  const approvalCreateService = createApprovalCreateService({ prisma, routingService });
  const transferService = createInternalTransferService({ prisma, approvalCreateService });

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
  // POST / — 服装部发起内部供料申请（创建即 PendingConfirm + 结算价审批单）
  // ══════════════════════════════════════════════════════════════════
  router.post('/', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, WRITE_SCOPE)) return;

    try {
      const body = req.body || {};
      const result = await transferService.createInternalTransfer({
        requestDepartmentId: String(body.requestDepartmentId ?? '').trim(),
        supplyDepartmentId: String(body.supplyDepartmentId ?? '').trim(),
        garmentOrderId: String(body.garmentOrderId ?? '').trim(),
        fabricOrderId: String(body.fabricOrderId ?? '').trim(),
        materialCode: String(body.materialCode ?? '').trim(),
        quantity: body.quantity !== undefined && body.quantity !== null ? Number(body.quantity) : (undefined as any),
        unit: body.unit ? String(body.unit).trim() : undefined,
        settlementPrice: body.settlementPrice !== undefined && body.settlementPrice !== null ? Number(body.settlementPrice) : (undefined as any),
        dueDate: String(body.dueDate ?? '').trim(),
        memo: body.memo ? String(body.memo).trim() : undefined,
        requesterId: auth.userId,
      });

      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.status(201).json(result.data);
    } catch (e: any) {
      logger.error('[InternalTradeRoute] POST / failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '创建内部供料单失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // POST /:id/confirm — 面料部确认数量/交期 + 已批准结算价 → 生效
  // ══════════════════════════════════════════════════════════════════
  router.post('/:id/confirm', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, WRITE_SCOPE)) return;

    try {
      const body = req.body || {};
      const result = await transferService.confirmInternalTransfer({
        id: req.params.id,
        actorId: auth.userId,
        confirmedQuantity: body.confirmedQuantity !== undefined && body.confirmedQuantity !== null ? Number(body.confirmedQuantity) : undefined,
        confirmedDueDate: body.confirmedDueDate ? String(body.confirmedDueDate).trim() : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(result.data);
    } catch (e: any) {
      logger.error('[InternalTradeRoute] POST /:id/confirm failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '内部供料单确认失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // POST /:id/delivery — 交付登记（分批出运/分批到货/差异追溯；仅内部交付单+装箱明细）
  // ══════════════════════════════════════════════════════════════════
  router.post('/:id/delivery', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, WRITE_SCOPE)) return;

    try {
      const body = req.body || {};
      const result = await transferService.registerDelivery({
        id: req.params.id,
        actorId: auth.userId,
        shipmentId: String(body.shipmentId ?? '').trim(),
        quantity: Number(body.quantity),
        deliveryDate: body.deliveryDate ? String(body.deliveryDate).trim() : undefined,
        receivedQuantity: body.receivedQuantity !== undefined && body.receivedQuantity !== null ? Number(body.receivedQuantity) : undefined,
        receivedDate: body.receivedDate ? String(body.receivedDate).trim() : undefined,
        packingLines: Array.isArray(body.packingLines) ? body.packingLines : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(result.data);
    } catch (e: any) {
      logger.error('[InternalTradeRoute] POST /:id/delivery failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '内部供料交付登记失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // POST /:id/cancel — 取消（仅 Draft/PendingConfirm；生效后须走订单变更/例外链）
  // ══════════════════════════════════════════════════════════════════
  router.post('/:id/cancel', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, WRITE_SCOPE)) return;

    try {
      const result = await transferService.cancelInternalTransfer({
        id: req.params.id,
        actorId: auth.userId,
        reason: req.body?.reason ? String(req.body.reason).trim() : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(result.data);
    } catch (e: any) {
      logger.error('[InternalTradeRoute] POST /:id/cancel failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '取消内部供料单失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // GET / — 列表（departmentId / status / garmentOrderId / fabricOrderId 过滤）
  // ══════════════════════════════════════════════════════════════════
  router.get('/', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;

    try {
      const statusRaw = req.query.status ? String(req.query.status) : undefined;
      if (statusRaw && !(INTERNAL_TRANSFER_STATUSES as readonly string[]).includes(statusRaw)) {
        return res.status(400).json({ error: 'INVALID_TRANSFER_STATE', message: `非法状态: ${statusRaw}。允许: ${INTERNAL_TRANSFER_STATUSES.join(', ')}` });
      }
      const result = await transferService.listInternalTransfers({
        departmentId: req.query.departmentId ? String(req.query.departmentId) : undefined,
        status: statusRaw as InternalTransferStatus | undefined,
        garmentOrderId: req.query.garmentOrderId ? String(req.query.garmentOrderId) : undefined,
        fabricOrderId: req.query.fabricOrderId ? String(req.query.fabricOrderId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      return res.json(result);
    } catch (e: any) {
      logger.error('[InternalTradeRoute] GET / failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '查询内部供料单列表失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // GET /:id — 详情（master + mirror + 解码载荷）
  // ══════════════════════════════════════════════════════════════════
  router.get('/:id', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;

    try {
      const result = await transferService.getInternalTransferById(req.params.id);
      if (!result) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `内部供料单 ${req.params.id} 不存在` });
      }
      return res.json({ item: result.master, mirror: result.mirror, payload: result.payload });
    } catch (e: any) {
      logger.error('[InternalTradeRoute] GET /:id failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '查询内部供料单详情失败' });
    }
  });

  return router;
}
