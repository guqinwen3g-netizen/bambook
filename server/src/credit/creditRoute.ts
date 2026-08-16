/**
 * creditRoute.ts — 信用控制域 API（Track F）
 *
 * 挂载：createCreditRouter({ prisma, requireAuth })
 * 建议路径：/api/v1/credit（由主代理在 index.ts 收口）
 *
 * 端点（:customerId = 客户 Relation.id）：
 *   POST /:customerId/freeze   — 人工冻结（scope credit:freeze:write，理由必填）
 *   POST /:customerId/thaw     — 主管手动解冻（scope credit:thaw:write，理由必填，记录 thawedReason）
 *   GET  /:customerId/status   — 信用状态（含门禁标记 creditFrozen / 最大逾期天数）
 *   GET  /:customerId/history  — 历史时间线（冻结/解冻/占用释放全事件，append-only）
 *
 * 鉴权：JWT fail-closed（无 token 401，无 scope 403）。
 * 设计真源：docs/design/03-业务规则/信用控制规则.md §2.4 / §6 #5/#6
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { hasScopeOnRequest } from '../auth/permissionGuard';
import { createCreditService } from './creditService';
import { logger } from '../lib/logger';

export interface CreditRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
}

/** BigInt / Decimal JSON 序列化（与 riskRoute 同口径） */
function serializeValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeValue) as T;
  if (typeof value === 'object') {
    if ((value as any).constructor?.name === 'Decimal') return Number((value as any).toString()) as T;
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) out[k] = serializeValue(v);
    return out;
  }
  return value;
}

export function createCreditRouter(options: CreditRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth } = options;
  const creditService = createCreditService({ prisma });

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
  // POST /:customerId/freeze — 人工冻结（理由必填）
  // ══════════════════════════════════════════════════════════════════
  router.post('/:customerId/freeze', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, 'credit:freeze:write')) return;

    try {
      const result = await creditService.freezeCredit({
        relationId: req.params.customerId,
        reason: String(req.body?.reason ?? '').trim(),
        actorId: auth.userId,
        triggerId: req.body?.triggerId ? String(req.body.triggerId) : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(serializeValue({ ok: true, ...result.data }));
    } catch (e: any) {
      logger.error('[CreditRoute] POST /:customerId/freeze failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '信用冻结失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // POST /:customerId/thaw — 主管手动解冻（理由必填，记录 thawedReason）
  // ══════════════════════════════════════════════════════════════════
  router.post('/:customerId/thaw', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!requireScope(req, res, 'credit:thaw:write')) return;

    try {
      const result = await creditService.thawCredit({
        relationId: req.params.customerId,
        reason: String(req.body?.reason ?? '').trim(),
        actorId: auth.userId,
        triggerId: req.body?.triggerId ? String(req.body.triggerId) : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(serializeValue({ ok: true, ...result.data }));
    } catch (e: any) {
      logger.error('[CreditRoute] POST /:customerId/thaw failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '信用解冻失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // GET /:customerId/status — 信用状态（含门禁标记）
  // ══════════════════════════════════════════════════════════════════
  router.get('/:customerId/status', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const status = await creditService.getCreditStatus(req.params.customerId);
      if (!status) {
        return res.status(400).json({ error: 'RELATION_REQUIRED', message: 'customerId 必填' });
      }
      return res.json(serializeValue(status));
    } catch (e: any) {
      logger.error('[CreditRoute] GET /:customerId/status failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '查询信用状态失败' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // GET /:customerId/history — 历史时间线
  // ══════════════════════════════════════════════════════════════════
  router.get('/:customerId/history', async (req: Request, res: Response) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    try {
      const result = await creditService.getCreditHistory({
        relationId: req.params.customerId,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      if (!result.ok) {
        return res.status(result.error.statusCode).json({ error: result.error.code, message: result.error.message });
      }
      return res.json(serializeValue(result.data));
    } catch (e: any) {
      logger.error('[CreditRoute] GET /:customerId/history failed', { error: e?.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || '查询信用历史失败' });
    }
  });

  return router;
}
