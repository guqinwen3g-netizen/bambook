/**
 * Risk Module Route — 风险管理与合规（阶段 H H3 / PRD 15）
 *
 * 端点（挂载于 /api/v1/risk）：
 *
 * 统一预警 RiskAlert：
 *   - GET   /overview                      — 风险总览（Open 按类型/级别分布 + 最近 10 条）
 *   - GET   /alerts                        — 预警列表（?type&level&status&limit&offset）
 *   - PATCH /alerts/:id                    — 更新状态 {status: Open|Acknowledged|Resolved}
 *
 * 汇率（PRD 15.1）：
 *   - GET    /fx-rates                     — 汇率列表（?currency&limit）
 *   - GET    /fx-rates-latest              — 各币种最新汇率（字面路由须在参数路由前）
 *   - POST   /fx-rates                     — 录入汇率 {currency, rate, effectiveDate?, source?, note?}（波动 ≥2% 自动预警）
 *   - GET    /fx-locks                     — 汇率锁定列表（?orderId）
 *   - POST   /fx-locks                     — 锁定汇率 {orderId, currency, rate?, note?}
 *   - DELETE /fx-locks/:id                 — 解除锁定（软删）
 *
 * 信用（PRD 15.2）：
 *   - GET  /credit-ratings                 — 评级历史（?relationId&latestOnly=true&limit）
 *   - POST /credit-ratings/evaluate        — 评估客户信用评级 {relationId}
 *   - POST /credit-risk-scan               — 手动触发信用风险扫描（owner/admin/manager）
 *
 * 合规（PRD 15.3）：
 *   - GET  /compliance-checks              — 检查记录（?type&result&targetType&targetId&limit）
 *   - POST /compliance-checks/hs-code      — HS 编码校验 {declarationId}
 *   - POST /compliance-checks/export-control — 出口管制校验 {declarationId}
 *   - POST /compliance-checks              — 人工录入（origin_rule 等）{type, targetType, targetId, result, summary, details?}
 *
 * 质量（PRD 15.4）：
 *   - GET  /quality/defect-trends          — 疵点趋势（?groupBy=factory|quarter，默认 factory）
 *   - POST /quality/repeat-scan            — 重复疵点扫描（近 90 天同工厂同疵点 ≥2 张报告 → 预警）
 *
 * 守卫口径与 suppliers/seasons 模块一致：读走 JWT 或 API-Key，写必须 JWT（requireJwtForWrite）；
 * 信用风险扫描会批量冻结客户信用额度，属高风险操作，叠加 owner/admin/manager 角色守卫。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requireRole } from '../auth/middleware';
import { actorIdFromRequest } from '../audit/routeAudit';
import type { AgentRole } from '../agent/types';
import { logger } from '../lib/logger';
import {
  createRiskService,
  ExchangeRateInput,
  FxLockInput,
  ManualComplianceCheckInput,
} from './riskService';

export interface RiskRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

/** 信用扫描属批量冻结级高风险操作，与 H1 黑名单同级别 */
const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];

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

export function createRiskRouter(options: RiskRouterOptions): Router {
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const router = Router();
  const service = createRiskService(prisma);

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const notify = (action: string, ids?: string[]) => onDataChange?.({ entity: 'risk', action, ids });

  const handleError = (res: Response, e: any, code: string) => {
    const msg = e?.message || 'operation failed';
    logger.error(`[RiskRoute] ${code}`, { error: msg });
    const isClient =
      msg.includes('必填') || msg.includes('非法') || msg.includes('必须是') ||
      msg.includes('无效') || msg.includes('已存在') || msg.includes('已锁定') ||
      msg.includes('仅 category') || msg.includes('大于') || msg.includes('无可用');
    const isNotFound = msg.includes('不存在');
    res.status(isNotFound ? 404 : isClient ? 400 : 500).json({ error: { code, message: msg } });
  };

  // ══════════════════════════════════════════════════════════════
  // 统一预警
  // ══════════════════════════════════════════════════════════════

  router.get('/overview', async (_req: Request, res: Response) => {
    try {
      res.json(serializeValue(await service.getRiskOverview()));
    } catch (e: any) {
      handleError(res, e, 'OVERVIEW_FAILED');
    }
  });

  router.get('/alerts', async (req: Request, res: Response) => {
    try {
      const result = await service.listAlerts({
        type: req.query.type ? String(req.query.type) : undefined,
        level: req.query.level ? String(req.query.level) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'ALERT_LIST_FAILED');
    }
  });

  router.patch('/alerts/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const alert = await service.updateAlertStatus(req.params.id, String(req.body?.status || ''), actorIdFromRequest(req));
      notify('update_alert', [alert.id]);
      res.json(serializeValue({ ok: true, item: alert }));
    } catch (e: any) {
      handleError(res, e, 'ALERT_UPDATE_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 汇率
  // ══════════════════════════════════════════════════════════════

  router.get('/fx-rates', async (req: Request, res: Response) => {
    try {
      const result = await service.listExchangeRates({
        currency: req.query.currency ? String(req.query.currency) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'FX_LIST_FAILED');
    }
  });

  // 字面路由须在 /fx-rates 参数化变体前（本路由无 /fx-rates/:id，仍保持字面前置约定）
  router.get('/fx-rates-latest', async (_req: Request, res: Response) => {
    try {
      const items = await service.getLatestRates();
      res.json(serializeValue({ items, total: items.length }));
    } catch (e: any) {
      handleError(res, e, 'FX_LATEST_FAILED');
    }
  });

  router.post('/fx-rates', requireWrite, async (req: Request, res: Response) => {
    try {
      const rate = await service.addExchangeRate(req.body as ExchangeRateInput, actorIdFromRequest(req));
      notify('add_fx_rate', [rate.id]);
      res.status(201).json(serializeValue({ ok: true, item: rate }));
    } catch (e: any) {
      handleError(res, e, 'FX_ADD_FAILED');
    }
  });

  router.get('/fx-locks', async (req: Request, res: Response) => {
    try {
      const result = await service.listFxLocks({
        orderId: req.query.orderId ? String(req.query.orderId) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'FX_LOCK_LIST_FAILED');
    }
  });

  router.post('/fx-locks', requireWrite, async (req: Request, res: Response) => {
    try {
      const lock = await service.lockFxRate(req.body as FxLockInput, actorIdFromRequest(req));
      notify('lock_fx_rate', [lock.id]);
      res.status(201).json(serializeValue({ ok: true, item: lock }));
    } catch (e: any) {
      handleError(res, e, 'FX_LOCK_FAILED');
    }
  });

  router.delete('/fx-locks/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      await service.deleteFxLock(req.params.id, actorIdFromRequest(req));
      notify('delete_fx_lock', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      handleError(res, e, 'FX_LOCK_DELETE_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 信用
  // ══════════════════════════════════════════════════════════════

  router.get('/credit-ratings', async (req: Request, res: Response) => {
    try {
      const result = await service.listCreditRatings({
        relationId: req.query.relationId ? String(req.query.relationId) : undefined,
        latestOnly: req.query.latestOnly === 'true',
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'RATING_LIST_FAILED');
    }
  });

  router.post('/credit-ratings/evaluate', requireWrite, async (req: Request, res: Response) => {
    try {
      const rating = await service.evaluateCreditRating(String(req.body?.relationId || ''), actorIdFromRequest(req));
      notify('evaluate_credit', [rating.id]);
      res.status(201).json(serializeValue({ ok: true, item: rating }));
    } catch (e: any) {
      handleError(res, e, 'RATING_EVALUATE_FAILED');
    }
  });

  // 信用风险扫描：批量冻结客户信用额度，高风险操作叠加角色守卫
  router.post('/credit-risk-scan', requireWrite, requireRole(...HIGH_RISK_ROLES), async (_req: Request, res: Response) => {
    try {
      const result = await service.runCreditRiskScan();
      if (result.frozenCount > 0 || result.badDebtCount > 0) notify('credit_risk_scan');
      res.json(serializeValue({ ok: true, ...result }));
    } catch (e: any) {
      handleError(res, e, 'CREDIT_SCAN_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 合规
  // ══════════════════════════════════════════════════════════════

  router.get('/compliance-checks', async (req: Request, res: Response) => {
    try {
      const result = await service.listComplianceChecks({
        type: req.query.type ? String(req.query.type) : undefined,
        result: req.query.result ? String(req.query.result) : undefined,
        targetType: req.query.targetType ? String(req.query.targetType) : undefined,
        targetId: req.query.targetId ? String(req.query.targetId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(serializeValue(result));
    } catch (e: any) {
      handleError(res, e, 'COMPLIANCE_LIST_FAILED');
    }
  });

  router.post('/compliance-checks/hs-code', requireWrite, async (req: Request, res: Response) => {
    try {
      const check = await service.runHsCodeCheck(String(req.body?.declarationId || ''), actorIdFromRequest(req));
      notify('hs_code_check', [check.id]);
      res.status(201).json(serializeValue({ ok: true, item: check }));
    } catch (e: any) {
      handleError(res, e, 'HS_CODE_CHECK_FAILED');
    }
  });

  router.post('/compliance-checks/export-control', requireWrite, async (req: Request, res: Response) => {
    try {
      const check = await service.runExportControlCheck(String(req.body?.declarationId || ''), actorIdFromRequest(req));
      notify('export_control_check', [check.id]);
      res.status(201).json(serializeValue({ ok: true, item: check }));
    } catch (e: any) {
      handleError(res, e, 'EXPORT_CONTROL_CHECK_FAILED');
    }
  });

  // 人工录入（origin_rule 等无自动通道的检查类型）
  router.post('/compliance-checks', requireWrite, async (req: Request, res: Response) => {
    try {
      const check = await service.addManualComplianceCheck(req.body as ManualComplianceCheckInput, actorIdFromRequest(req));
      notify('manual_compliance_check', [check.id]);
      res.status(201).json(serializeValue({ ok: true, item: check }));
    } catch (e: any) {
      handleError(res, e, 'COMPLIANCE_CREATE_FAILED');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 质量
  // ══════════════════════════════════════════════════════════════

  router.get('/quality/defect-trends', async (req: Request, res: Response) => {
    try {
      const groupBy = req.query.groupBy === 'quarter' ? 'quarter' : 'factory';
      res.json(serializeValue(await service.getDefectTrends({ groupBy })));
    } catch (e: any) {
      handleError(res, e, 'DEFECT_TRENDS_FAILED');
    }
  });

  router.post('/quality/repeat-scan', requireWrite, async (_req: Request, res: Response) => {
    try {
      const result = await service.runQualityRepeatScan();
      if (result.alerted > 0) notify('quality_repeat_scan');
      res.json(serializeValue({ ok: true, ...result }));
    } catch (e: any) {
      handleError(res, e, 'QUALITY_SCAN_FAILED');
    }
  });

  return router;
}
