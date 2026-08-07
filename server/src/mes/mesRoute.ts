/**
 * 生产 MES API — /api/v1/mes
 *
 * 端点：
 *   ── 工位 WorkStation ──
 *   GET    /work-stations                — 工位列表（支持 type/isActive 过滤）
 *   GET    /work-stations/:id            — 工位详情（含最近 10 条排产）
 *   GET    /work-stations/:id/utilization — 工位利用率（?startDate=&endDate=）
 *   POST   /work-stations                — 创建工位
 *   PUT    /work-stations/:id            — 更新工位
 *   DELETE /work-stations/:id            — 软删除工位
 *
 *   ── 排产 ProductionPlan ──
 *   GET    /plans                        — 排产列表（支持 orderId/workStationId/status/processType/date 过滤）
 *   GET    /plans/:id                    — 排产详情（含工位 + 工时）
 *   POST   /plans                        — 创建排产单
 *   PUT    /plans/:id                    — 更新排产单（仅 Draft）
 *   DELETE /plans/:id                    — 软删除排产单（仅 Draft）
 *   POST   /plans/:id/transition         — 状态流转（?toStatus=）
 *   POST   /plans/:id/progress           — 更新生产进度（actualQuantity）
 *
 *   ── 工时 WorkHour ──
 *   GET    /work-hours                   — 工时列表（支持 planId/employeeId/date 过滤）
 *   GET    /work-hours/summary           — 工时汇总（按员工聚合）
 *   POST   /work-hours                   — 创建工时记录
 *   DELETE /work-hours/:id               — 删除工时记录
 *
 *   ── 计件规则 PieceRateRule ──
 *   GET    /piece-rate-rules             — 计件规则列表
 *   POST   /piece-rate-rules             — 创建计件规则
 *   PUT    /piece-rate-rules/:id         — 更新计件规则
 *   DELETE /piece-rate-rules/:id         — 软删除计件规则
 *
 *   ── 计件记录 PieceRateRecord ──
 *   GET    /piece-rate-records           — 计件记录列表
 *   GET    /piece-rate-records/summary   — 计件工资汇总（按员工聚合）
 *   POST   /piece-rate-records           — 创建计件记录（自动金额计算）
 *   POST   /piece-rate-records/:id/transition — 状态流转（Pending→Confirmed→Paid）
 *   DELETE /piece-rate-records/:id       — 删除计件记录（已支付不可删）
 *
 *   ── 外协 OutsourcingOrder ──
 *   GET    /outsourcing                  — 外协订单列表
 *   GET    /outsourcing/:id             — 外协订单详情
 *   POST   /outsourcing                  — 创建外协订单（含行明细 + 自动 totalAmount）
 *   PUT    /outsourcing/:id              — 更新外协订单（仅 Draft）
 *   DELETE /outsourcing/:id              — 软删除外协订单（仅 Draft）
 *   POST   /outsourcing/:id/transition   — 状态流转（Draft→Sent→Confirmed→InProduction→Received）
 *   POST   /outsourcing/:id/receive      — 外协到货验收（qualityAcceptedQty / qualityRejectedQty）
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';
import {
  createMesService,
  WorkStationInput,
  ProductionPlanInput,
  WorkHourInput,
  PieceRateRuleInput,
  PieceRateRecordInput,
  OutsourcingOrderInput,
  ProductionPlanStatus,
  PieceRateStatus,
  OutsourcingStatus,
} from './mesService';

export interface MesRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

const VALID_PLAN_STATUSES: ProductionPlanStatus[] = ['Draft', 'Confirmed', 'InProgress', 'Completed', 'Cancelled'];
const VALID_PIECE_RATE_STATUSES: PieceRateStatus[] = ['Pending', 'Confirmed', 'Paid'];
const VALID_OUTSOURCING_STATUSES: OutsourcingStatus[] = ['Draft', 'Sent', 'Confirmed', 'InProduction', 'Received', 'Cancelled'];

function errStatus(msg: string, fallback = 400): number {
  if (msg.includes('不存在')) return 404;
  if (msg.includes('已存在')) return 409;
  if (msg.includes('非法') || msg.includes('不可删除') || msg.includes('不可') || msg.includes('超过')) return 409;
  return fallback;
}

export function createMesRouter(options: MesRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const service = createMesService(prisma);

  const authenticate = (req: Request, res: Response): boolean => {
    if (!requireAuth) return true;
    const apiKey = req.query.apiKey as string || req.headers['x-api-key'] as string;
    if (apiKey && apiKeys.has(apiKey)) return true;
    const actor = extractActorFromRequest(req);
    if (actor?.userId) return true;
    res.status(401).json({ error: 'authentication required' });
    return false;
  };

  const actorOf = (req: Request): string => extractActorFromRequest(req)?.userId || 'system';

  // ════════════════════════════════════════
  // 工位 WorkStation
  // ════════════════════════════════════════

  router.get('/work-stations', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { type, isActive } = req.query;
      const items = await service.listWorkStations({
        type: type as string | undefined,
        isActive: isActive === undefined ? undefined : isActive === 'true',
      });
      res.json({ items, total: items.length });
    } catch (e: any) {
      logger.error('[MesRoute] GET work-stations failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list work stations' });
    }
  });

  router.get('/work-stations/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await service.getWorkStation(req.params.id);
      if (!item) return res.status(404).json({ error: '工位不存在' });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] GET work-station failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get work station' });
    }
  });

  router.get('/work-stations/:id/utilization', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: '需要 startDate 与 endDate 查询参数' });
      }
      const utilization = await service.getWorkStationUtilization(
        req.params.id,
        startDate as string,
        endDate as string,
      );
      res.json({ utilization });
    } catch (e: any) {
      logger.error('[MesRoute] GET utilization failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '', 500)).json({ error: e?.message || 'failed to get utilization' });
    }
  });

  router.post('/work-stations', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as WorkStationInput;
      if (!input.code || !input.name || !input.type) {
        return res.status(400).json({ error: '缺少必填字段：code / name / type' });
      }
      const item = await service.createWorkStation(input, actorOf(req));
      onDataChange?.({ entity: 'WorkStation', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST work-station failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create work station' });
    }
  });

  router.put('/work-stations/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as Partial<WorkStationInput>;
      const item = await service.updateWorkStation(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'WorkStation', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] PUT work-station failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update work station' });
    }
  });

  router.delete('/work-stations/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteWorkStation(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'WorkStation', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[MesRoute] DELETE work-station failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete work station' });
    }
  });

  // ════════════════════════════════════════
  // 排产 ProductionPlan
  // ════════════════════════════════════════

  router.get('/plans', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { orderId, workStationId, status, processType, dateFrom, dateTo } = req.query;
      const items = await service.listProductionPlans({
        orderId: orderId as string | undefined,
        workStationId: workStationId as string | undefined,
        status: status as string | undefined,
        processType: processType as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
      });
      res.json({ items, total: items.length });
    } catch (e: any) {
      logger.error('[MesRoute] GET plans failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list production plans' });
    }
  });

  router.get('/plans/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await service.getProductionPlan(req.params.id);
      if (!item) return res.status(404).json({ error: '排产单不存在' });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] GET plan failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get production plan' });
    }
  });

  router.post('/plans', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as ProductionPlanInput;
      if (!input.planNumber || !input.workStationId || !input.processType || input.plannedQuantity == null || !input.unit || !input.plannedStartDate || !input.plannedEndDate) {
        return res.status(400).json({ error: '缺少必填字段：planNumber / workStationId / processType / plannedQuantity / unit / plannedStartDate / plannedEndDate' });
      }
      const item = await service.createProductionPlan(input, actorOf(req));
      onDataChange?.({ entity: 'ProductionPlan', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST plan failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create production plan' });
    }
  });

  router.put('/plans/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as Partial<ProductionPlanInput>;
      const item = await service.updateProductionPlan(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'ProductionPlan', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] PUT plan failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update production plan' });
    }
  });

  router.delete('/plans/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteProductionPlan(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'ProductionPlan', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[MesRoute] DELETE plan failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete production plan' });
    }
  });

  router.post('/plans/:id/transition', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { toStatus } = req.body as { toStatus: ProductionPlanStatus };
      if (!toStatus || !VALID_PLAN_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法排产状态：${toStatus}` });
      }
      const item = await service.transitionPlanStatus(req.params.id, toStatus, actorOf(req));
      onDataChange?.({ entity: 'ProductionPlan', action: 'transition', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST plan transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition plan status' });
    }
  });

  router.post('/plans/:id/progress', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { actualQuantity } = req.body as { actualQuantity: number };
      if (actualQuantity == null || actualQuantity < 0) {
        return res.status(400).json({ error: 'actualQuantity 必须 ≥ 0' });
      }
      const item = await service.updatePlanProgress(req.params.id, actualQuantity, actorOf(req));
      onDataChange?.({ entity: 'ProductionPlan', action: 'progress', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST plan progress failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update plan progress' });
    }
  });

  // ════════════════════════════════════════
  // 工时 WorkHour
  // ════════════════════════════════════════

  router.get('/work-hours', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { productionPlanId, employeeId, dateFrom, dateTo } = req.query;
      const items = await service.listWorkHours({
        productionPlanId: productionPlanId as string | undefined,
        employeeId: employeeId as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
      });
      res.json({ items, total: items.length });
    } catch (e: any) {
      logger.error('[MesRoute] GET work-hours failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list work hours' });
    }
  });

  router.get('/work-hours/summary', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { productionPlanId, dateFrom, dateTo } = req.query;
      const summary = await service.getWorkHourSummary({
        productionPlanId: productionPlanId as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
      });
      res.json({ summary, total: summary.length });
    } catch (e: any) {
      logger.error('[MesRoute] GET work-hours summary failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get work hour summary' });
    }
  });

  router.post('/work-hours', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as WorkHourInput;
      if (!input.productionPlanId || !input.workDate || input.hours == null) {
        return res.status(400).json({ error: '缺少必填字段：productionPlanId / workDate / hours' });
      }
      const item = await service.createWorkHour(input, actorOf(req));
      onDataChange?.({ entity: 'WorkHour', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST work-hour failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create work hour' });
    }
  });

  router.delete('/work-hours/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteWorkHour(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'WorkHour', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[MesRoute] DELETE work-hour failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete work hour' });
    }
  });

  // ════════════════════════════════════════
  // 计件规则 PieceRateRule
  // ════════════════════════════════════════

  router.get('/piece-rate-rules', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { processType, productAssetId, isActive } = req.query;
      const items = await service.listPieceRateRules({
        processType: processType as string | undefined,
        productAssetId: productAssetId as string | undefined,
        isActive: isActive === undefined ? undefined : isActive === 'true',
      });
      res.json({ items, total: items.length });
    } catch (e: any) {
      logger.error('[MesRoute] GET piece-rate-rules failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list piece rate rules' });
    }
  });

  router.post('/piece-rate-rules', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as PieceRateRuleInput;
      if (!input.code || !input.name || !input.processType || !input.unit || input.ratePerUnit == null || !input.effectiveFrom) {
        return res.status(400).json({ error: '缺少必填字段：code / name / processType / unit / ratePerUnit / effectiveFrom' });
      }
      const item = await service.createPieceRateRule(input, actorOf(req));
      onDataChange?.({ entity: 'PieceRateRule', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST piece-rate-rule failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create piece rate rule' });
    }
  });

  router.put('/piece-rate-rules/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as Partial<PieceRateRuleInput>;
      const item = await service.updatePieceRateRule(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'PieceRateRule', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] PUT piece-rate-rule failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update piece rate rule' });
    }
  });

  router.delete('/piece-rate-rules/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deletePieceRateRule(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'PieceRateRule', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[MesRoute] DELETE piece-rate-rule failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete piece rate rule' });
    }
  });

  // ════════════════════════════════════════
  // 计件记录 PieceRateRecord
  // ════════════════════════════════════════

  router.get('/piece-rate-records', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { pieceRateRuleId, productionPlanId, employeeId, status, dateFrom, dateTo } = req.query;
      const items = await service.listPieceRateRecords({
        pieceRateRuleId: pieceRateRuleId as string | undefined,
        productionPlanId: productionPlanId as string | undefined,
        employeeId: employeeId as string | undefined,
        status: status as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
      });
      res.json({ items, total: items.length });
    } catch (e: any) {
      logger.error('[MesRoute] GET piece-rate-records failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list piece rate records' });
    }
  });

  router.get('/piece-rate-records/summary', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { employeeId, status, dateFrom, dateTo } = req.query;
      const summary = await service.getPiceRateSummary({
        employeeId: employeeId as string | undefined,
        status: status as string | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
      });
      res.json({ summary, total: summary.length });
    } catch (e: any) {
      logger.error('[MesRoute] GET piece-rate summary failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get piece rate summary' });
    }
  });

  router.post('/piece-rate-records', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as PieceRateRecordInput;
      if (!input.pieceRateRuleId || !input.workDate || input.quantity == null || !input.unit) {
        return res.status(400).json({ error: '缺少必填字段：pieceRateRuleId / workDate / quantity / unit' });
      }
      const item = await service.createPieceRateRecord(input, actorOf(req));
      onDataChange?.({ entity: 'PieceRateRecord', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST piece-rate-record failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create piece rate record' });
    }
  });

  router.post('/piece-rate-records/:id/transition', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { toStatus } = req.body as { toStatus: PieceRateStatus };
      if (!toStatus || !VALID_PIECE_RATE_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法计件状态：${toStatus}` });
      }
      const item = await service.transitionPieceRateStatus(req.params.id, toStatus, actorOf(req));
      onDataChange?.({ entity: 'PieceRateRecord', action: 'transition', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST piece-rate transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition piece rate status' });
    }
  });

  router.delete('/piece-rate-records/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deletePieceRateRecord(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'PieceRateRecord', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[MesRoute] DELETE piece-rate-record failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete piece rate record' });
    }
  });

  // ════════════════════════════════════════
  // 外协 OutsourcingOrder
  // ════════════════════════════════════════

  router.get('/outsourcing', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { supplierId, orderId, status, processType } = req.query;
      const items = await service.listOutsourcingOrders({
        supplierId: supplierId as string | undefined,
        orderId: orderId as string | undefined,
        status: status as string | undefined,
        processType: processType as string | undefined,
      });
      res.json({ items, total: items.length });
    } catch (e: any) {
      logger.error('[MesRoute] GET outsourcing failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list outsourcing orders' });
    }
  });

  router.get('/outsourcing/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await service.getOutsourcingOrder(req.params.id);
      if (!item) return res.status(404).json({ error: '外协单不存在' });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] GET outsourcing detail failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get outsourcing order' });
    }
  });

  router.post('/outsourcing', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as OutsourcingOrderInput;
      if (!input.orderNumber || !input.processType || input.quantity == null || !input.unit || input.unitPrice == null) {
        return res.status(400).json({ error: '缺少必填字段：orderNumber / processType / quantity / unit / unitPrice' });
      }
      const item = await service.createOutsourcingOrder(input, actorOf(req));
      onDataChange?.({ entity: 'OutsourcingOrder', action: 'create', ids: [item.id] });
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST outsourcing failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to create outsourcing order' });
    }
  });

  router.put('/outsourcing/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const input = req.body as Partial<OutsourcingOrderInput>;
      const item = await service.updateOutsourcingOrder(req.params.id, input, actorOf(req));
      onDataChange?.({ entity: 'OutsourcingOrder', action: 'update', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] PUT outsourcing failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to update outsourcing order' });
    }
  });

  router.delete('/outsourcing/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteOutsourcingOrder(req.params.id, actorOf(req));
      onDataChange?.({ entity: 'OutsourcingOrder', action: 'delete', ids: [req.params.id] });
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[MesRoute] DELETE outsourcing failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to delete outsourcing order' });
    }
  });

  router.post('/outsourcing/:id/transition', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { toStatus } = req.body as { toStatus: OutsourcingStatus };
      if (!toStatus || !VALID_OUTSOURCING_STATUSES.includes(toStatus)) {
        return res.status(400).json({ error: `非法外协状态：${toStatus}` });
      }
      const item = await service.transitionOutsourcingStatus(req.params.id, toStatus, actorOf(req));
      onDataChange?.({ entity: 'OutsourcingOrder', action: 'transition', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST outsourcing transition failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to transition outsourcing status' });
    }
  });

  router.post('/outsourcing/:id/receive', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { qualityAcceptedQty, qualityRejectedQty } = req.body as {
        qualityAcceptedQty: number;
        qualityRejectedQty?: number;
      };
      if (qualityAcceptedQty == null || qualityAcceptedQty < 0) {
        return res.status(400).json({ error: 'qualityAcceptedQty 必须 ≥ 0' });
      }
      const item = await service.receiveOutsourcing(
        req.params.id,
        { qualityAcceptedQty, qualityRejectedQty },
        actorOf(req),
      );
      onDataChange?.({ entity: 'OutsourcingOrder', action: 'receive', ids: [item.id] });
      res.json({ item });
    } catch (e: any) {
      logger.error('[MesRoute] POST outsourcing receive failed', { error: e?.message });
      res.status(errStatus(e?.message ?? '')).json({ error: e?.message || 'failed to receive outsourcing order' });
    }
  });

  return router;
}
