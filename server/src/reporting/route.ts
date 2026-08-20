/**
 * A5 报表引擎 API — /api/v1/reports
 *
 * 端点：
 *   GET    /datasets                    数据集注册表（报表设计器元数据）
 *   GET    /definitions                 定义列表
 *   POST   /definitions                 创建定义（高风险角色 + 审计）
 *   GET    /definitions/:id             定义详情
 *   PATCH  /definitions/:id             更新定义（高风险角色 + 审计）
 *   DELETE /definitions/:id             软删定义（高风险角色 + 审计）
 *   POST   /preview                     临时预览（不落库，≤500 行）
 *   POST   /drill                       下钻（聚合组 → 组成员实体明细，不落库，≤200 行）
 *   POST   /definitions/:id/run         手动运行（落运行快照）
 *   GET    /runs?definitionId=          运行历史
 *   GET    /runs/:id                    运行详情
 *   GET    /runs/:id/export.csv         导出 CSV（重放快照）
 *
 * 权限：读/预览/导出走模块守卫（JWT 或 API key）；定义变更走 HIGH_RISK_ROLES；
 * 手动运行要求 JWT（与财务写入口径一致，API key 不足）。
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { listDatasets } from './datasets';
import { rowsToCsv } from './reportEngine';
import { createMonthlyCloseService } from './monthlyCloseService';
import {
  createReportDefinition,
  deleteReportDefinition,
  drillReportQuery,
  previewReportQuery,
  runReportDefinition,
  updateReportDefinition,
} from './reportDefinitionService';

export interface ReportingRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

function serialize<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as T;
  if (Array.isArray(value)) return value.map(serialize) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v);
    return out as T;
  }
  return value;
}

const ERROR_STATUS: Record<string, number> = {
  INVALID_INPUT: 400,
  UNKNOWN_DATASET: 400,
  INVALID_DIMENSIONS: 400,
  UNKNOWN_DIMENSION: 400,
  INVALID_METRICS: 400,
  INVALID_METRIC: 400,
  UNKNOWN_METRIC: 400,
  INVALID_AGG: 400,
  INVALID_FILTERS: 400,
  INVALID_FILTER: 400,
  UNKNOWN_FILTER_FIELD: 400,
  INVALID_FILTER_OP: 400,
  INVALID_FILTER_VALUE: 400,
  INVALID_SCHEDULE: 400,
  INVALID_DRILL_GROUP: 400,
  DEFINITION_INVALID: 409,
  DISABLED: 409,
  NOT_FOUND: 404,
  // REQ2-17 月末结转（DR-058）
  VALIDATION_FAILED: 400,
  NO_MONTHLY_DEFINITIONS: 404,
  INTERNAL_ERROR: 500,
};

export function createReportingRouter(options: ReportingRouterOptions): Router {
  const { prisma, requireAuth, apiKeys } = options;
  const router = Router();

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager', 'finance'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const monthlyCloseService = createMonthlyCloseService(prisma);

  const sendError = (res: Response, error: { code: string; message: string }) => {
    res.status(ERROR_STATUS[error.code] ?? 500).json({ error });
  };

  // ── 数据集注册表 ──
  router.get('/datasets', (_req: Request, res: Response) => {
    res.json({ datasets: listDatasets() });
  });

  // ── 定义列表 ──
  router.get('/definitions', async (_req: Request, res: Response) => {
    try {
      const definitions = await (prisma as any).reportDefinition.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      res.json(serialize({ definitions }));
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // ── 定义详情 ──
  router.get('/definitions/:id', async (req: Request, res: Response) => {
    try {
      const definition = await (prisma as any).reportDefinition.findUnique({ where: { id: req.params.id } });
      if (!definition || definition.deletedAt) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'report definition not found' } });
        return;
      }
      res.json(serialize({ definition }));
    } catch (err: any) {
      res.status(500).json({ error: { code: 'GET_FAILED', message: err.message } });
    }
  });

  // ── 创建定义 ──
  router.post('/definitions', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await createReportDefinition({
      prisma,
      input: req.body,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      sendError(res, result.error!);
      return;
    }
    res.status(201).json(serialize(result.data!.definition));
  });

  // ── 更新定义 ──
  router.patch('/definitions/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await updateReportDefinition({
      prisma,
      definitionId: req.params.id,
      input: req.body,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      sendError(res, result.error!);
      return;
    }
    res.json(serialize(result.data!.definition));
  });

  // ── 软删定义 ──
  router.delete('/definitions/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await deleteReportDefinition({
      prisma,
      definitionId: req.params.id,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      sendError(res, result.error!);
      return;
    }
    res.json({ ok: true });
  });

  // ── 预览（不落库） ──
  router.post('/preview', requireWrite, async (req: Request, res: Response) => {
    const result = await previewReportQuery({ prisma, input: req.body });
    if (!result.ok) {
      sendError(res, result.error!);
      return;
    }
    res.json(serialize(result.data));
  });

  // ── 下钻（不落库；返回业务明细行，与预览同级权限） ──
  router.post('/drill', requireWrite, async (req: Request, res: Response) => {
    const result = await drillReportQuery({ prisma, input: req.body });
    if (!result.ok) {
      sendError(res, result.error!);
      return;
    }
    res.json(serialize(result.data));
  });

  // ── 手动运行（落快照） ──
  router.post('/definitions/:id/run', requireWrite, async (req: Request, res: Response) => {
    const result = await runReportDefinition({
      prisma,
      definitionId: req.params.id,
      trigger: 'manual',
      actorId: actorIdFromRequest(req),
    });
    if (!result.ok) {
      sendError(res, result.error!);
      return;
    }
    res.status(201).json(serialize({ run: result.data!.run }));
  });

  // ── REQ2-17 月末批量结转（DR-058）：mc: 幂等键月末时点快照 + 相邻期对比 ──
  // 守卫与定义变更同级（结转是财务批量快照动作，高风险角色 + JWT）。
  router.post('/monthly-close', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await monthlyCloseService.runMonthlyClose({
      periodKey: typeof req.body?.periodKey === 'string' ? req.body.periodKey : undefined,
      actorId: actorIdFromRequest(req),
      ip: req.ip,
    });
    if (!result.ok) {
      sendError(res, result.error!);
      return;
    }
    res.json(serialize(result.data));
  });

  router.get('/monthly-close/compare', requireWrite, requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    const result = await monthlyCloseService.compareMonthlyClose({
      periodKey: typeof req.query.periodKey === 'string' ? req.query.periodKey : undefined,
    });
    if (!result.ok) {
      sendError(res, result.error!);
      return;
    }
    res.json(serialize(result.data));
  });

  // ── 运行历史 ──
  router.get('/runs', async (req: Request, res: Response) => {
    try {
      const definitionId = typeof req.query.definitionId === 'string' ? req.query.definitionId : undefined;
      const limitRaw = Number(req.query.limit);
      const take = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;
      const runs = await (prisma as any).reportRun.findMany({
        where: definitionId ? { definitionId } : {},
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true, definitionId: true, definitionName: true, status: true, trigger: true,
          idempotencyKey: true, rowCount: true, error: true,
          startedAt: true, finishedAt: true, createdAt: true,
          // 列表不携带 rows 快照（可能很大），详情接口单独取
        },
      });
      res.json(serialize({ runs }));
    } catch (err: any) {
      res.status(500).json({ error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // ── 运行详情（含快照行） ──
  router.get('/runs/:id', async (req: Request, res: Response) => {
    try {
      const run = await (prisma as any).reportRun.findUnique({ where: { id: req.params.id } });
      if (!run) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'report run not found' } });
        return;
      }
      res.json(serialize({ run }));
    } catch (err: any) {
      res.status(500).json({ error: { code: 'GET_FAILED', message: err.message } });
    }
  });

  // ── 导出 CSV（重放快照） ──
  router.get('/runs/:id/export.csv', async (req: Request, res: Response) => {
    try {
      const run = await (prisma as any).reportRun.findUnique({ where: { id: req.params.id } });
      if (!run) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'report run not found' } });
        return;
      }
      if (run.status !== 'Success' || !Array.isArray(run.rows) || !Array.isArray(run.columns)) {
        res.status(409).json({ error: { code: 'RUN_NOT_EXPORTABLE', message: `run status is ${run.status}; only successful runs export` } });
        return;
      }
      // 表头标签随快照落库；缺失（历史数据）时回退列键
      const columnLabels = Array.isArray(run.columnLabels) && run.columnLabels.length === run.columns.length
        ? (run.columnLabels as string[])
        : (run.columns as string[]);
      const csv = rowsToCsv(columnLabels, run.columns as string[], run.rows as Array<Record<string, unknown>>);
      const filename = `${run.definitionName || 'report'}-${run.id}.csv`.replace(/[\\/:*?"<>|]/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(csv);
    } catch (err: any) {
      logger.error('[Reporting] export failed', { error: err?.message });
      res.status(500).json({ error: { code: 'EXPORT_FAILED', message: err.message } });
    }
  });

  return router;
}
