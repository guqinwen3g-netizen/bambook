/**
 * Phase C1 — 经营驾驶舱 API — /api/v1/dashboard
 *
 * 只读聚合端点，无 mutation；鉴权与其他 ERP 模块一致（JWT 或 API key）。
 * W-C 权限收口：/cockpit 内容即经营驾驶舱（含财务敏感 KPI），
 * 叠加 requirePermission('cockpit:read') scope 门（与 VIEW_TO_MAIN_SCOPES[View.Cockpit] 对齐）。
 */
import { Router, Request, Response } from 'express';
import { createModuleAuthGuard } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { PrismaClient } from '@prisma/client';
import { getBusinessCockpit } from './dashboardService';

export interface DashboardRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createDashboardRouter(options: DashboardRouterOptions): Router {
  const { prisma, requireAuth, apiKeys } = options;
  const router = Router();

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));

  // GET /api/v1/dashboard/cockpit?from=YYYY-MM-DD&to=YYYY-MM-DD&marginRowLimit=N
  router.get('/cockpit', requirePermission('cockpit:read'), async (req: Request, res: Response) => {
    try {
      const from = req.query.from ? String(req.query.from) : undefined;
      const to = req.query.to ? String(req.query.to) : undefined;
      if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
        return res.status(400).json({ error: { code: 'INVALID_DATE', message: 'from/to 必须为 YYYY-MM-DD' } });
      }
      const marginRowLimit = req.query.marginRowLimit ? Number(req.query.marginRowLimit) : undefined;
      if (marginRowLimit != null && (!Number.isFinite(marginRowLimit) || marginRowLimit < 1)) {
        return res.status(400).json({ error: { code: 'INVALID_LIMIT', message: 'marginRowLimit 必须为正整数' } });
      }
      const cockpit = await getBusinessCockpit(prisma, { from, to, marginRowLimit });
      res.json(cockpit);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'COCKPIT_FAILED', message: err.message } });
    }
  });

  return router;
}
