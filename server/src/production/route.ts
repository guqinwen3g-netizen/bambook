/**
 * Production Pipeline REST API — /api/v1/production
 *
 * GET    /board                      → 在手订单 × 10 阶段泳道看板聚合（PRD 19.8）
 * GET    /:orderId                    → get full pipeline (stages + checklist + inspection)
 * POST   /:orderId/advance/:stageKey  → advance a stage (with gate checks)
 * POST   /:orderId/block/:stageKey    → C18 看板阻塞标记（blocked ⇄ pending）
 * PUT    /:orderId/checklist           → save PreCutChecklist
 * PUT    /:orderId/inspection          → save InspectionReport
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { advanceStage, getProductionBoard, getProductionPipeline, savePreCutChecklist, saveInspectionReport, signStage, parseStageKey, setStageBlocked } from './stageService';

export interface ProductionRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids: string[] }) => void;
}

function actorIdFromRequest(req: Request): string {
  return (req as any).actor?.id || (req.headers['x-bambook-actor'] as string) || 'api';
}

export function createProductionRouter(opts: ProductionRouterOptions): Router {
  const router = Router();

  // W-C 批三-E 族B 收口：API-Key-only 私有守卫 + legacy requireProductionRole 双退役，
  // 统一 createModuleAuthGuard（JWT 或 API-Key）。读面挂 production:read scope 门；
  // 写面 requireJwtForWrite（JWT-only）＋ production:write scope 门
  // （持有 = SALES/SALES_MANAGER/QC＋SuperAdmin 特判，_shared/rolePermissionMatrix 真源——
  //  修复生产态 fail-closed 死锁：旧守卫 API-Key 无 roles 恒 403，矩阵授权角色无法写）。
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });
  const requireProductionRead = requirePermission('production:read');
  const requireProductionWrite = requirePermission('production:write');

  // GET /stats/dashboard — 生产看板统计
  router.get('/stats/dashboard', requireProductionRead, async (req: Request, res: Response) => {
    try {
      const today = new Date().toISOString().slice(0, 10);

      // 各阶段订单分布（当前最高可推进阶段）
      const allStages = await opts.prisma.productionStage.findMany({
        where: { status: { not: 'done' } },
        select: { orderId: true, stageKey: true, stageSeq: true, status: true },
        orderBy: { stageSeq: 'asc' },
      });

      // 按 orderId 分组，取每组最小的 pending stage 作为"当前阶段"
      const orderStageMap = new Map<string, { stageKey: string; stageSeq: number }>();
      for (const s of allStages) {
        const existing = orderStageMap.get(s.orderId);
        if (!existing || s.stageSeq < existing.stageSeq) {
          orderStageMap.set(s.orderId, { stageKey: s.stageKey, stageSeq: s.stageSeq });
        }
      }

      const stageDistribution: Record<string, number> = {};
      for (const [, val] of orderStageMap) {
        stageDistribution[val.stageKey] = (stageDistribution[val.stageKey] || 0) + 1;
      }

      // 已完成订单数（所有 10 阶段都 done）
      const completedStages = await opts.prisma.productionStage.groupBy({
        by: ['orderId'],
        where: { status: 'done' },
        _count: { orderId: true },
      });
      const fullyCompleted = completedStages.filter(g => g._count.orderId >= 10).length;

      // 超期统计
      const overdueCount = await opts.prisma.order.count({
        where: {
          deletedAt: null,
          status: { notIn: ['Delivered'] },
          productionPlanDeadline: { lt: today },
        },
      });

      // 总活跃订单数
      const totalActive = await opts.prisma.order.count({
        where: { deletedAt: null, status: { notIn: ['Delivered', 'Alert'] } },
      });

      // 检查清单完成率
      const checklists = await opts.prisma.preCutChecklist.findMany({
        select: { gradingConfirmed: true, consumptionConfirmed: true, patternConfirmed: true, preProductionMeeting: true },
      });
      const checklistComplete = checklists.filter(c =>
        c.gradingConfirmed && c.consumptionConfirmed && c.patternConfirmed && c.preProductionMeeting
      ).length;

      // 验货通过率
      const inspections = await opts.prisma.inspectionReport.findMany({
        select: { totalUnits: true, passedUnits: true, approvedByBusiness: true },
      });
      const inspectionPassed = inspections.filter(i =>
        i.totalUnits > 0 && (i.passedUnits / i.totalUnits) >= 0.9 && i.approvedByBusiness
      ).length;

      res.json({
        ok: true,
        stats: {
          stageDistribution,
          fullyCompleted,
          overdueCount,
          totalActive,
          checklistTotal: checklists.length,
          checklistComplete,
          checklistRate: checklists.length > 0 ? checklistComplete / checklists.length : 0,
          inspectionTotal: inspections.length,
          inspectionPassed,
          inspectionRate: inspections.length > 0 ? inspectionPassed / inspections.length : 0,
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: { code: 'DASHBOARD_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // GET /alerts/scan — 全局延期预警扫描
  // 扫描所有未完成订单的 productionPlanDeadline（下单后7天）和 delayNoticeDeadline（交期前15天）
  router.get('/alerts/scan', requireProductionRead, async (req: Request, res: Response) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const orders = await opts.prisma.order.findMany({
        where: {
          deletedAt: null,
          status: { notIn: ['Delivered', 'Alert'] },
        },
        select: {
          id: true, poNumber: true, customer: true, status: true,
          dueDate: true, productionPlanDeadline: true, delayNoticeDeadline: true,
          importedAt: true,
        },
        orderBy: { importedAt: 'desc' },
        take: 500,
      });

      const alerts: any[] = [];
      for (const o of orders) {
        if (o.productionPlanDeadline && o.productionPlanDeadline < today) {
          alerts.push({
            orderId: o.id,
            poNumber: o.poNumber,
            customer: o.customer,
            alertType: 'production_plan_overdue',
            deadline: o.productionPlanDeadline,
            message: `生产计划超期（截止日 ${o.productionPlanDeadline}）`,
            severity: 'high',
          });
        }
        if (o.delayNoticeDeadline && o.delayNoticeDeadline <= today) {
          const dueDate = o.dueDate || '未知';
          alerts.push({
            orderId: o.id,
            poNumber: o.poNumber,
            customer: o.customer,
            alertType: 'delay_notice_window',
            deadline: o.delayNoticeDeadline,
            message: `延期通知窗口已开启（交期 ${dueDate}，需提前通知）`,
            severity: 'critical',
          });
        }
      }

      alerts.sort((a, b) => {
        const sev = { critical: 0, high: 1, medium: 2, low: 3 };
        return (sev[a.severity as keyof typeof sev] ?? 4) - (sev[b.severity as keyof typeof sev] ?? 4);
      });

      res.json({ ok: true, alerts, total: alerts.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: { code: 'ALERT_SCAN_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // GET /board — 生产跟单泳道看板聚合（PRD 19.8；必须在 /:orderId 之前注册）
  router.get('/board', requireProductionRead, async (req: Request, res: Response) => {
    try {
      const board = await getProductionBoard(opts.prisma);
      res.json({ ok: true, ...board });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: { code: 'BOARD_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // GET /:orderId — full pipeline
  router.get('/:orderId', requireProductionRead, async (req: Request, res: Response) => {
    try {
      const pipeline = await getProductionPipeline(opts.prisma, req.params.orderId);
      res.json({ ok: true, ...pipeline });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: { code: 'PIPELINE_FETCH_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // POST /:orderId/advance/:stageKey — advance stage
  router.post('/:orderId/advance/:stageKey', requireWrite, requireProductionWrite, async (req: Request, res: Response) => {
    const { note } = req.body || {};
    const stageKey = parseStageKey(req.params.stageKey);
    if (!stageKey) {
      return res.status(400).json({ ok: false, error: { code: 'INVALID_STAGE', message: `Invalid stage: ${req.params.stageKey}` } });
    }
    const result = await advanceStage({
      prisma: opts.prisma,
      orderId: req.params.orderId,
      stageKey,
      operator: actorIdFromRequest(req),
      note,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        ORDER_NOT_FOUND: 404,
        INVALID_STAGE: 400,
        STAGE_NOT_SEQUENTIAL: 400,
        PRECUT_CHECKLIST_INCOMPLETE: 400,
        PP_SAMPLE_NOT_SIGNED: 400,
        INSPECTION_NOT_QUALIFIED: 400,
        BUSINESS_APPROVAL_REQUIRED: 400,
        STAGE_UPDATE_FAILED: 500,
      };
      const errResult = result as any; return res.status(statusCodeMap[errResult.error.code] || 500).json({ ok: false, error: errResult.error });
    }
    opts.onDataChange?.({ entity: 'production', action: 'advance', ids: [req.params.orderId] });
    res.json({ ok: true, stage: result.data.stage });
  });

  // POST /:orderId/block/:stageKey — C18 看板阻塞标记（blocked ⇄ pending；body.blocked 缺省 true）
  router.post('/:orderId/block/:stageKey', requireWrite, requireProductionWrite, async (req: Request, res: Response) => {
    const stageKey = parseStageKey(req.params.stageKey);
    if (!stageKey) {
      return res.status(400).json({ ok: false, error: { code: 'INVALID_STAGE', message: `Invalid stage: ${req.params.stageKey}` } });
    }
    const { note } = req.body || {};
    const blocked = req.body?.blocked !== false; // 缺省标记阻塞；显式 false = 解除阻塞
    const result = await setStageBlocked({
      prisma: opts.prisma,
      orderId: req.params.orderId,
      stageKey,
      blocked,
      operator: actorIdFromRequest(req),
      note,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        ORDER_NOT_FOUND: 404,
        INVALID_STAGE: 400,
        STAGE_NOT_BLOCKABLE: 400,
        STAGE_UPDATE_FAILED: 500,
      };
      const errResult = result as any; return res.status(statusCodeMap[errResult.error.code] || 500).json({ ok: false, error: errResult.error });
    }
    opts.onDataChange?.({ entity: 'production', action: 'block', ids: [req.params.orderId] });
    res.json({ ok: true, stage: result.data.stage });
  });

  // POST /:orderId/sign/:stageKey — dual-sign (production/business)
  router.post('/:orderId/sign/:stageKey', requireWrite, requireProductionWrite, async (req: Request, res: Response) => {
    const { signType, signerId } = req.body || {};
    if (!['production', 'business'].includes(signType)) {
      return res.status(400).json({ ok: false, error: { code: 'INVALID_SIGN_TYPE', message: 'signType must be production or business' } });
    }
    try {
      const stage = await signStage({
        prisma: opts.prisma,
        orderId: req.params.orderId,
        stageKey: req.params.stageKey,
        signType,
        signerId: signerId || actorIdFromRequest(req),
      });
      opts.onDataChange?.({ entity: 'production', action: 'sign', ids: [req.params.orderId] });
      res.json({ ok: true, stage });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: { code: 'SIGN_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // PUT /:orderId/checklist — save PreCutChecklist
  router.put('/:orderId/checklist', requireWrite, requireProductionWrite, async (req: Request, res: Response) => {
    try {
      const checklist = await savePreCutChecklist(opts.prisma, req.params.orderId, req.body || {});
      opts.onDataChange?.({ entity: 'production', action: 'checklist', ids: [req.params.orderId] });
      res.json({ ok: true, checklist });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: { code: 'CHECKLIST_SAVE_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // PUT /:orderId/inspection — save InspectionReport
  router.put('/:orderId/inspection', requireWrite, requireProductionWrite, async (req: Request, res: Response) => {
    try {
      const report = await saveInspectionReport(opts.prisma, req.params.orderId, req.body || {});
      opts.onDataChange?.({ entity: 'production', action: 'inspection', ids: [req.params.orderId] });
      res.json({ ok: true, inspection: report });
    } catch (e: any) {
      const code = e?.code === 'INVALID_RESULT' ? 400 : e?.code === 'ORDER_NOT_FOUND' ? 404 : 500;
      res.status(code).json({ ok: false, error: { code: e?.code || 'INSPECTION_SAVE_FAILED', message: String(e?.message ?? e) } });
    }
  });

  return router;
}
