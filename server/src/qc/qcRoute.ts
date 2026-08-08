/**
 * 阶段 P0 回补 — QC 模块路由（PRD 6.2 / 4.2 QC 工作台），挂载于 /api/v1/qc
 *
 * 端点：
 *   驻地：
 *   - GET    /locations                 — 驻地列表（全量未删除）
 *   - POST   /locations                 — 新建驻地 {code, name, region?, focus?, address?, notes?}
 *   - PATCH  /locations/:id             — 更新驻地（code 不可改）
 *   - DELETE /locations/:id             — 软删（仍有任务引用时拒绝）
 *
 *   验货任务：
 *   - GET    /assignments               — 任务列表（?qcUserId&status&orderId&locationId&dueBefore&limit&offset）
 *   - POST   /assignments               — 派单 {orderId, inspectionType, qcUserId, locationId?, dueDate?, notes?}
 *   - PATCH  /assignments/:id           — 更新（notes/dueDate/locationId/qcUserId；已完结不可改）
 *   - DELETE /assignments/:id           — 软删
 *   - POST   /assignments/:id/start     — Assigned → InProgress
 *   - POST   /assignments/:id/complete  — → Completed {reportId?}
 *   - POST   /assignments/:id/cancel    — → Cancelled（Completed 不可取消）
 *
 *   工作台（字面路由先于参数路由）：
 *   - GET    /workbench                 — 按状态分组（?qcUserId=；completed 仅近 30 天限 20 条）
 *
 * 守卫口径与 seasons/risk 模块一致：读走 JWT 或 API-Key，写必须 JWT（requireJwtForWrite）。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { createQcService, QCLocationInput, QCAssignmentInput } from './qcService';

export interface QcRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

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

export function createQcRouter(options: QcRouterOptions): Router {
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const router = Router();
  const service = createQcService(prisma);

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const notify = (action: string, ids?: string[]) => onDataChange?.({ entity: 'qc', action, ids });

  const handleError = (res: Response, e: any, code: string) => {
    const msg = e?.message || 'operation failed';
    logger.error(`[QcRoute] ${code}`, { error: msg });
    const isClient =
      msg.includes('必填') || msg.includes('非法') || msg.includes('必须是') ||
      msg.includes('已存在') || msg.includes('不可修改') || msg.includes('不可删除') ||
      msg.includes('不可取消') || msg.includes('已有进行中') || msg.includes('不匹配');
    const isNotFound = msg.includes('不存在');
    res.status(isNotFound ? 404 : isClient ? 400 : 500).json({ error: { code, message: msg } });
  };

  // ══════════════════════════════════════════════════════════════
  // 驻地
  // ══════════════════════════════════════════════════════════════

  router.get('/locations', async (_req: Request, res: Response) => {
    try {
      const items = await service.listLocations();
      res.json(serializeValue({ items, total: items.length }));
    } catch (e: any) {
      handleError(res, e, 'QC_LOCATION_LIST_FAILED');
    }
  });

  router.post('/locations', requireWrite, async (req: Request, res: Response) => {
    try {
      const loc = await service.createLocation(req.body as QCLocationInput, actorIdFromRequest(req));
      notify('create_location', [loc.id]);
      res.status(201).json(serializeValue({ ok: true, item: loc }));
    } catch (e: any) {
      handleError(res, e, 'QC_LOCATION_CREATE_FAILED');
    }
  });

  router.patch('/locations/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const loc = await service.updateLocation(req.params.id, req.body ?? {}, actorIdFromRequest(req));
      notify('update_location', [loc.id]);
      res.json(serializeValue({ ok: true, item: loc }));
    } catch (e: any) {
      handleError(res, e, 'QC_LOCATION_UPDATE_FAILED');
    }
  });

  router.delete('/locations/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      await service.deleteLocation(req.params.id, actorIdFromRequest(req));
      notify('delete_location', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'QC_LOCATION_DELETE_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 验货任务
  // ══════════════════════════════════════════════════════════════

  router.get('/assignments', async (req: Request, res: Response) => {
    try {
      const result = await service.listAssignments({
        qcUserId: req.query.qcUserId ? String(req.query.qcUserId) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        orderId: req.query.orderId ? String(req.query.orderId) : undefined,
        locationId: req.query.locationId ? String(req.query.locationId) : undefined,
        dueBefore: req.query.dueBefore ? String(req.query.dueBefore) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'QC_ASSIGNMENT_LIST_FAILED');
    }
  });

  router.post('/assignments', requireWrite, async (req: Request, res: Response) => {
    try {
      const assignment = await service.createAssignment(req.body as QCAssignmentInput, actorIdFromRequest(req));
      notify('create_assignment', [assignment.id]);
      res.status(201).json(serializeValue({ ok: true, item: assignment }));
    } catch (e: any) {
      handleError(res, e, 'QC_ASSIGNMENT_CREATE_FAILED');
    }
  });

  router.patch('/assignments/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const assignment = await service.updateAssignment(req.params.id, req.body ?? {}, actorIdFromRequest(req));
      notify('update_assignment', [assignment.id]);
      res.json(serializeValue({ ok: true, item: assignment }));
    } catch (e: any) {
      handleError(res, e, 'QC_ASSIGNMENT_UPDATE_FAILED');
    }
  });

  router.delete('/assignments/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      await service.deleteAssignment(req.params.id, actorIdFromRequest(req));
      notify('delete_assignment', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'QC_ASSIGNMENT_DELETE_FAILED');
    }
  });

  router.post('/assignments/:id/start', requireWrite, async (req: Request, res: Response) => {
    try {
      const assignment = await service.startAssignment(req.params.id, actorIdFromRequest(req));
      notify('start_assignment', [assignment.id]);
      res.json(serializeValue({ ok: true, item: assignment }));
    } catch (e: any) {
      handleError(res, e, 'QC_ASSIGNMENT_START_FAILED');
    }
  });

  router.post('/assignments/:id/complete', requireWrite, async (req: Request, res: Response) => {
    try {
      const assignment = await service.completeAssignment(
        req.params.id,
        { reportId: req.body?.reportId ?? null },
        actorIdFromRequest(req),
      );
      notify('complete_assignment', [assignment.id]);
      res.json(serializeValue({ ok: true, item: assignment }));
    } catch (e: any) {
      handleError(res, e, 'QC_ASSIGNMENT_COMPLETE_FAILED');
    }
  });

  router.post('/assignments/:id/cancel', requireWrite, async (req: Request, res: Response) => {
    try {
      const assignment = await service.cancelAssignment(req.params.id, actorIdFromRequest(req));
      notify('cancel_assignment', [assignment.id]);
      res.json(serializeValue({ ok: true, item: assignment }));
    } catch (e: any) {
      handleError(res, e, 'QC_ASSIGNMENT_CANCEL_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 工作台
  // ══════════════════════════════════════════════════════════════

  router.get('/workbench', async (req: Request, res: Response) => {
    try {
      const result = await service.getWorkbench({
        qcUserId: req.query.qcUserId ? String(req.query.qcUserId) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'QC_WORKBENCH_FAILED');
    }
  });

  return router;
}
