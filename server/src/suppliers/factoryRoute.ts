/**
 * Supplier / Factory Module Route — 供应商管理（阶段 H H1 / PRD 13 / 19.18）
 *
 * 端点（挂载于 /api/v1/suppliers）：
 *
 * 工厂档案 FactoryProfile：
 *   - GET    /                          — 档案列表/排名（search / blacklisted / sort=quality|delivery|orders|amount）
 *   - POST   /                          — 建立工厂档案（挂 category=Supplier 的组织 Relation，1:1）
 *   - GET    /expiring-certifications   — 认证到期预警扫描（?days=30，字面路由须在 /:id 之前）
 *   - GET    /:id                       — 档案详情（含 Relation + 认证）
 *   - PATCH  /:id                       — 更新档案（白名单字段）
 *   - DELETE /:id                       — 软删除档案
 *   - POST   /:id/blacklist             — 拉黑（{reason}，owner/admin/manager）
 *   - DELETE /:id/blacklist             — 解除拉黑（owner/admin/manager）
 *
 * 评估记录 FactoryEvaluation（append-only 真源，追加后事务内重算质量/交期缓存分）：
 *   - GET    /:id/evaluations           — 评分明细（?kind=inspection|delivery）
 *   - POST   /:id/evaluations           — 追加评分 {kind, score 0-100, sourceType?, sourceId?, evaluatedAt, note?}
 *
 * 认证记录 FactoryCertification：
 *   - GET    /:id/certifications        — 认证列表（按有效期升序）
 *   - POST   /:id/certifications        — 新增认证 {type, certificateNo?, issuedAt?, validUntil?}
 *   - PATCH  /certifications/:certId    — 更新认证
 *   - DELETE /certifications/:certId    — 软删除认证
 *
 * 产能日历 FactoryCapacity（占用量由在手采购单实时聚合，不落地）：
 *   - GET    /:id/capacity              — 产能日历（含 occupied 聚合）
 *   - PUT    /:id/capacity/:month       — upsert 月计划产能 {capacity, unit?, note?}
 *   - DELETE /:id/capacity/:month       — 软删除月产能
 *
 * 总览：
 *   - GET    /:id/overview              — 工厂 360°（档案 + 近期评分 + 认证 + 产能）
 *
 * 守卫口径与 email 模块一致：读走 JWT 或 API-Key，写必须 JWT（requireJwtForWrite）；
 * 黑名单属高风险操作，叠加 owner/admin/manager 角色守卫。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requireRole } from '../auth/middleware';
import { actorIdFromRequest } from '../audit/routeAudit';
import type { AgentRole } from '../agent/types';
import { logger } from '../lib/logger';
import { createFactoryService, FactoryProfileInput, FactoryEvaluationInput, FactoryCertificationInput } from './factoryService';

export interface SupplierRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

const BLACKLIST_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];

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

export function createSupplierRouter(options: SupplierRouterOptions): Router {
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const router = Router();
  const service = createFactoryService(prisma);

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const notify = (action: string, ids?: string[]) => onDataChange?.({ entity: 'suppliers', action, ids });

  const handleError = (res: Response, e: any, code: string) => {
    const msg = e?.message || 'operation failed';
    logger.error(`[SupplierRoute] ${code}`, { error: msg });
    const isClient =
      msg.includes('必填') || msg.includes('非法') || msg.includes('必须是') ||
      msg.includes('无效') || msg.includes('已存在') || msg.includes('仅 category') ||
      msg.includes('挂在组织') || msg.includes('禁止') || msg.includes('之间');
    const isNotFound = msg.includes('不存在');
    res.status(isNotFound ? 404 : isClient ? 400 : 500).json({ error: { code, message: msg } });
  };

  // ══════════════════════════════════════════════════════════════
  // 字面路由（须在 /:id 之前）
  // ══════════════════════════════════════════════════════════════

  // GET / — 列表/排名
  router.get('/', async (req: Request, res: Response) => {
    try {
      const blacklisted =
        req.query.blacklisted === 'true' ? true :
        req.query.blacklisted === 'false' ? false : undefined;
      const result = await service.listProfiles({
        search: req.query.search ? String(req.query.search) : undefined,
        blacklisted,
        sort: req.query.sort ? String(req.query.sort) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'LIST_FAILED');
    }
  });

  // GET /expiring-certifications — 认证到期预警（默认 30 天）
  router.get('/expiring-certifications', async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      const items = await service.listExpiringCertifications(days);
      res.json(serializeValue({ items, total: items.length, days }));
    } catch (e: any) {
      handleError(res, e, 'EXPIRING_LIST_FAILED');
    }
  });

  // POST / — 建立工厂档案
  router.post('/', requireWrite, async (req: Request, res: Response) => {
    try {
      const profile = await service.createProfile(req.body as FactoryProfileInput, actorIdFromRequest(req));
      notify('create', [profile.id]);
      res.status(201).json(serializeValue({ ok: true, item: profile }));
    } catch (e: any) {
      handleError(res, e, 'CREATE_FAILED');
    }
  });

  // PATCH /certifications/:certId（字面前缀，须在 /:id 通配前注册）
  router.patch('/certifications/:certId', requireWrite, async (req: Request, res: Response) => {
    try {
      const cert = await service.updateCertification(req.params.certId, req.body, actorIdFromRequest(req));
      notify('update_certification', [cert.id]);
      res.json(serializeValue({ ok: true, item: cert }));
    } catch (e: any) {
      handleError(res, e, 'UPDATE_CERT_FAILED');
    }
  });

  router.delete('/certifications/:certId', requireWrite, async (req: Request, res: Response) => {
    try {
      await service.deleteCertification(req.params.certId, actorIdFromRequest(req));
      notify('delete_certification', [req.params.certId]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'DELETE_CERT_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 档案 /:id
  // ══════════════════════════════════════════════════════════════

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const profile = await service.getProfile(req.params.id);
      if (!profile) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '工厂档案不存在' } });
      res.json(serializeValue({ item: profile }));
    } catch (e: any) {
      handleError(res, e, 'GET_FAILED');
    }
  });

  router.patch('/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const profile = await service.updateProfile(req.params.id, req.body, actorIdFromRequest(req));
      notify('update', [profile.id]);
      res.json(serializeValue({ ok: true, item: profile }));
    } catch (e: any) {
      handleError(res, e, 'UPDATE_FAILED');
    }
  });

  router.delete('/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      await service.deleteProfile(req.params.id, actorIdFromRequest(req));
      notify('delete', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'DELETE_FAILED');
    }
  });

  // ─── 黑名单（高风险：owner/admin/manager） ───

  router.post('/:id/blacklist', requireWrite, requireRole(...BLACKLIST_ROLES), async (req: Request, res: Response) => {
    try {
      const profile = await service.setBlacklist(req.params.id, String(req.body?.reason || ''), actorIdFromRequest(req));
      notify('blacklist', [profile.id]);
      res.json(serializeValue({ ok: true, item: profile }));
    } catch (e: any) {
      handleError(res, e, 'BLACKLIST_FAILED');
    }
  });

  router.delete('/:id/blacklist', requireWrite, requireRole(...BLACKLIST_ROLES), async (req: Request, res: Response) => {
    try {
      const profile = await service.clearBlacklist(req.params.id, actorIdFromRequest(req));
      notify('unblacklist', [profile.id]);
      res.json(serializeValue({ ok: true, item: profile }));
    } catch (e: any) {
      handleError(res, e, 'UNBLACKLIST_FAILED');
    }
  });

  // ─── 评估记录 ───

  router.get('/:id/evaluations', async (req: Request, res: Response) => {
    try {
      const items = await service.listEvaluations(req.params.id, req.query.kind ? String(req.query.kind) : undefined);
      res.json(serializeValue({ items, total: items.length }));
    } catch (e: any) {
      handleError(res, e, 'EVALUATION_LIST_FAILED');
    }
  });

  router.post('/:id/evaluations', requireWrite, async (req: Request, res: Response) => {
    try {
      const evaluation = await service.addEvaluation(req.params.id, req.body as FactoryEvaluationInput, actorIdFromRequest(req));
      notify('add_evaluation', [evaluation.id]);
      res.status(201).json(serializeValue({ ok: true, item: evaluation }));
    } catch (e: any) {
      handleError(res, e, 'ADD_EVALUATION_FAILED');
    }
  });

  // ─── 认证记录 ───

  router.get('/:id/certifications', async (req: Request, res: Response) => {
    try {
      const items = await service.listCertifications(req.params.id);
      res.json(serializeValue({ items, total: items.length }));
    } catch (e: any) {
      handleError(res, e, 'CERT_LIST_FAILED');
    }
  });

  router.post('/:id/certifications', requireWrite, async (req: Request, res: Response) => {
    try {
      const cert = await service.addCertification(req.params.id, req.body as FactoryCertificationInput, actorIdFromRequest(req));
      notify('add_certification', [cert.id]);
      res.status(201).json(serializeValue({ ok: true, item: cert }));
    } catch (e: any) {
      handleError(res, e, 'ADD_CERT_FAILED');
    }
  });

  // ─── 产能日历 ───

  router.get('/:id/capacity', async (req: Request, res: Response) => {
    try {
      const items = await service.listCapacity(req.params.id);
      res.json(serializeValue({ items, total: items.length }));
    } catch (e: any) {
      handleError(res, e, 'CAPACITY_LIST_FAILED');
    }
  });

  router.put('/:id/capacity/:month', requireWrite, async (req: Request, res: Response) => {
    try {
      const row = await service.upsertCapacity(req.params.id, {
        month: req.params.month,
        capacity: Number(req.body?.capacity),
        unit: req.body?.unit ?? null,
        note: req.body?.note ?? null,
      }, actorIdFromRequest(req));
      notify('upsert_capacity', [row.id]);
      res.json(serializeValue({ ok: true, item: row }));
    } catch (e: any) {
      handleError(res, e, 'UPSERT_CAPACITY_FAILED');
    }
  });

  router.delete('/:id/capacity/:month', requireWrite, async (req: Request, res: Response) => {
    try {
      await service.deleteCapacity(req.params.id, req.params.month, actorIdFromRequest(req));
      notify('delete_capacity', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'DELETE_CAPACITY_FAILED');
    }
  });

  // ─── 360° 总览 ───

  router.get('/:id/overview', async (req: Request, res: Response) => {
    try {
      const overview = await service.getOverview(req.params.id);
      if (!overview) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '工厂档案不存在' } });
      res.json(serializeValue(overview));
    } catch (e: any) {
      handleError(res, e, 'OVERVIEW_FAILED');
    }
  });

  return router;
}
