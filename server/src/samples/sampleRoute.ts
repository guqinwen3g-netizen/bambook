/**
 * sampleRoute.ts — 样品域统一路由，建议挂载于 /api/v1/samples
 *
 * 覆盖链路：
 *   面料 S/S 船样 + RC 匹头样（DR-011/012/014/039）：
 *   - POST /fabric/:orderId/shipment-sample        — S/S 船样登记（面料订单必须管理）
 *   - POST /fabric/:orderId/head-sample            — RC 匹头样启用（业务员决定并留痕）
 *   - POST /:id/ship                               — 寄送登记（快递商/单号/日期/收件方 + 随附单据）
 *   - POST /:id/confirm                            — 客户确认登记（结果/日期/渠道/意见/证据）
 *   - GET  /fabric/:orderId/samples                — 样品列表（含 Exmill 倒计时/逾期标记）
 *   - GET  /fabric/:orderId/shipment-eligibility   — DR-012 样品链发货资格判定（出运域消费）
 *   - GET  /fabric/:orderId/shipment-gate          — DR-013 例外门禁消费（叠加生效例外：gate/exception 放行或 409 GATE_BLOCKED）
 *
 *   投产后早期生产样（DR-028，不限轮次闭环）：
 *   - POST /early-production/:orderId/rounds           — 登记新一轮（previousSampleId 链入上一轮）
 *   - POST /early-production/rounds/:id/ship           — 寄送登记
 *   - POST /early-production/rounds/:id/feedback       — 客户反馈登记（approved 闭环；其余转 QC 迭代）
 *   - GET  /early-production/:orderId/rounds           — 链式列表
 *
 *   服装多轮样品双门禁（DR-008/DR-029）：
 *   - POST /garment/:caseId/rounds                     — 创建轮次（目的/版本/材料工艺配置必填）
 *   - POST /garment/:id/submit-qc                      — QC 评审结论登记（引用 InspectionReport 只读）
 *   - POST /garment/:id/submit-customer                — 提交客户（QC 未通过 → 409，fail-closed）
 *   - POST /garment/:id/register-customer-confirmation — 业务员登记客户确认（不加主管审批）
 *   - POST /garment/:id/seal                           — 封存产前样（不可变；pp 节点投影 approved）
 *   - GET  /garment/:caseId/rounds                     — 轮次列表（含当前封存基准）
 *
 * 守卫口径：读走 JWT 或 API-Key；写必须 JWT（requireJwtForWrite）+ scope 校验
 * （requirePermission，fail-closed：API key 不可写，无 scope → 403）。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { serializeValue } from '../lib/serializeValue';
import { createFabricShipmentSampleService } from './fabricShipmentSampleService';
import { createEarlyProductionSampleService } from './earlyProductionSampleService';
import { createGarmentSampleGateService } from './garmentSampleGateService';
import { createColorBatchService } from './colorBatchService';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';
import { createExceptionService } from '../exceptions/exceptionService';

export interface SampleRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys?: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createSampleRouter(options: SampleRouterOptions): Router {
  const { prisma, requireAuth, onDataChange } = options;
  const apiKeys = options.apiKeys ?? new Set<string>();
  const router = Router();

  // DR-013 例外查询链（门禁消费真源）：hasActiveException 注入样品链门禁消费点
  const exceptionRoutingService = createApprovalRoutingService({ prisma });
  const exceptionApprovalCreateService = createApprovalCreateService({ prisma, routingService: exceptionRoutingService });
  const exceptionService = createExceptionService({ prisma, approvalCreateService: exceptionApprovalCreateService });

  const fabricService = createFabricShipmentSampleService({ prisma, exceptionChecker: exceptionService.hasActiveException });
  const earlyService = createEarlyProductionSampleService({ prisma });
  const garmentService = createGarmentSampleGateService({ prisma });

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });

  // scope 中间件（fail-closed；写类 scope 强制 JWT user-session）
  const requireShipmentWrite = [requireWrite, requirePermission('sample:shipment:write')];
  const requireEarlyWrite = [requireWrite, requirePermission('sample:early_production:write')];
  const requireGarmentWrite = [requireWrite, requirePermission('products:write')];
  const requireGarmentQc = [requireWrite, requirePermission('qc:garment_chain:write')];

  const notify = (action: string, ids?: string[]) => onDataChange?.({ entity: 'samples', action, ids });

  const sendResult = <T>(res: Response, r: { ok: true; data: T } | { ok: false; error: { code: string; message: string; status: number } }, okStatus = 200, wrapKey?: string) => {
    if (!r.ok) {
      return res.status(r.error.status ?? 400).json({ error: { code: r.error.code, message: r.error.message } });
    }
    const body = wrapKey ? { ok: true, [wrapKey]: (r.data as any)[wrapKey], ...omit(r.data as any, wrapKey) } : { ok: true, ...(r.data as any) };
    res.status(okStatus).json(serializeValue(body));
  };
  const omit = (obj: any, key: string) => {
    const { [key]: _drop, ...rest } = obj ?? {};
    return rest;
  };

  // ══════════════════════════════════════════════════════════════
  // 面料 S/S 船样 + RC 匹头样
  // ══════════════════════════════════════════════════════════════

  router.post('/fabric/:orderId/shipment-sample', ...requireShipmentWrite, async (req: Request, res: Response) => {
    try {
      const r = await fabricService.registerShipmentSample({
        orderId: req.params.orderId,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('create_shipment_sample', [r.data.sample.id]);
      sendResult(res, r, 201, 'sample');
    } catch (e: any) {
      logger.error('[SampleRoute] SS_CREATE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'SS_CREATE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/fabric/:orderId/head-sample', ...requireShipmentWrite, async (req: Request, res: Response) => {
    try {
      const r = await fabricService.enableHeadSample({
        orderId: req.params.orderId,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('enable_head_sample', [r.data.sample.id]);
      sendResult(res, r, 201, 'sample');
    } catch (e: any) {
      logger.error('[SampleRoute] RC_ENABLE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'RC_ENABLE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.get('/fabric/:orderId/samples', async (req: Request, res: Response) => {
    try {
      const r = await fabricService.listOrderSamples({ orderId: req.params.orderId });
      sendResult(res, r, 200, 'items');
    } catch (e: any) {
      logger.error('[SampleRoute] FABRIC_SAMPLE_LIST_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'FABRIC_SAMPLE_LIST_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.get('/fabric/:orderId/shipment-eligibility', async (req: Request, res: Response) => {
    try {
      const r = await fabricService.computeShipmentEligibility({ orderId: req.params.orderId });
      sendResult(res, r, 200, 'eligibility');
    } catch (e: any) {
      logger.error('[SampleRoute] SHIPMENT_ELIGIBILITY_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'SHIPMENT_ELIGIBILITY_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  // DR-013 例外门禁消费端点：叠加生效例外后的放行结论（gate / exception）或 409 GATE_BLOCKED
  // （阻断时透传 blockingReasons + exceptionReason + exceptionEntryHint，引导 DR-013 申请入口）
  router.get('/fabric/:orderId/shipment-gate', async (req: Request, res: Response) => {
    try {
      const r = await fabricService.assertFabricShipmentGate({ orderId: req.params.orderId });
      if (!r.ok) {
        return res.status(r.error.status ?? 400).json({
          error: {
            code: r.error.code,
            message: r.error.message,
            blockingReasons: r.error.blockingReasons,
            exceptionReason: r.error.exceptionReason,
            exceptionEntryHint: r.error.exceptionEntryHint,
          },
        });
      }
      res.status(200).json(serializeValue({ ok: true, pass: r.data.pass, eligibility: r.data.eligibility }));
    } catch (e: any) {
      logger.error('[SampleRoute] SHIPMENT_GATE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'SHIPMENT_GATE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 投产后早期生产样（DR-028）
  // ══════════════════════════════════════════════════════════════

  router.post('/early-production/:orderId/rounds', ...requireEarlyWrite, async (req: Request, res: Response) => {
    try {
      const r = await earlyService.createSample({
        orderId: req.params.orderId,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('create_early_production_sample', [r.data.sample.id]);
      sendResult(res, r, 201, 'sample');
    } catch (e: any) {
      logger.error('[SampleRoute] EPS_CREATE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'EPS_CREATE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/early-production/rounds/:id/ship', ...requireEarlyWrite, async (req: Request, res: Response) => {
    try {
      const r = await earlyService.sendSample({
        sampleId: req.params.id,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('send_early_production_sample', [req.params.id]);
      sendResult(res, r, 200, 'sample');
    } catch (e: any) {
      logger.error('[SampleRoute] EPS_SHIP_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'EPS_SHIP_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/early-production/rounds/:id/feedback', ...requireEarlyWrite, async (req: Request, res: Response) => {
    try {
      const r = await earlyService.confirmSample({
        sampleId: req.params.id,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('confirm_early_production_sample', [req.params.id]);
      sendResult(res, r, 200, 'sample');
    } catch (e: any) {
      logger.error('[SampleRoute] EPS_CONFIRM_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'EPS_CONFIRM_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.get('/early-production/:orderId/rounds', async (req: Request, res: Response) => {
    try {
      const r = await earlyService.listByOrder({ orderId: req.params.orderId });
      sendResult(res, r, 200, 'items');
    } catch (e: any) {
      logger.error('[SampleRoute] EPS_LIST_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'EPS_LIST_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 服装多轮样品双门禁（DR-008）
  // ══════════════════════════════════════════════════════════════

  router.post('/garment/:caseId/rounds', ...requireGarmentWrite, async (req: Request, res: Response) => {
    try {
      const r = await garmentService.createRound({
        caseId: req.params.caseId,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('create_garment_sample_round', [r.data.round.id]);
      sendResult(res, r, 201, 'round');
    } catch (e: any) {
      logger.error('[SampleRoute] GARMENT_ROUND_CREATE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'GARMENT_ROUND_CREATE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/garment/:id/submit-qc', ...requireGarmentQc, async (req: Request, res: Response) => {
    try {
      const r = await garmentService.submitQcConclusion({
        roundId: req.params.id,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('submit_garment_sample_qc', [req.params.id]);
      sendResult(res, r, 200, 'round');
    } catch (e: any) {
      logger.error('[SampleRoute] GARMENT_QC_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'GARMENT_QC_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/garment/:id/submit-customer', ...requireGarmentWrite, async (req: Request, res: Response) => {
    try {
      const r = await garmentService.submitToCustomer({
        roundId: req.params.id,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('submit_garment_sample_to_customer', [req.params.id]);
      sendResult(res, r, 200, 'round');
    } catch (e: any) {
      logger.error('[SampleRoute] GARMENT_SUBMIT_CUSTOMER_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'GARMENT_SUBMIT_CUSTOMER_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/garment/:id/register-customer-confirmation', ...requireGarmentWrite, async (req: Request, res: Response) => {
    try {
      const r = await garmentService.registerCustomerConfirmation({
        roundId: req.params.id,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('confirm_garment_sample', [req.params.id]);
      sendResult(res, r, 200, 'round');
    } catch (e: any) {
      logger.error('[SampleRoute] GARMENT_CONFIRM_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'GARMENT_CONFIRM_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/garment/:id/seal', ...requireGarmentWrite, async (req: Request, res: Response) => {
    try {
      const r = await garmentService.sealRound({ roundId: req.params.id, actorId: actorIdFromRequest(req), ip: req.ip });
      if (r.ok) notify('seal_garment_preproduction_sample', [req.params.id]);
      sendResult(res, r, 200, 'round');
    } catch (e: any) {
      logger.error('[SampleRoute] GARMENT_SEAL_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'GARMENT_SEAL_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.get('/garment/:caseId/rounds', async (req: Request, res: Response) => {
    try {
      const r = await garmentService.listRounds({ caseId: req.params.caseId });
      if (!r.ok) return res.status(r.error.status ?? 400).json({ error: { code: r.error.code, message: r.error.message } });
      res.json(serializeValue({ ok: true, items: r.data.items, sealedRoundId: r.data.sealedRoundId }));
    } catch (e: any) {
      logger.error('[SampleRoute] GARMENT_ROUND_LIST_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'GARMENT_ROUND_LIST_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 通用样品操作（/:id 两段式，注册在最后避免吞掉字面路由）
  // ══════════════════════════════════════════════════════════════

  router.post('/:id/ship', ...requireShipmentWrite, async (req: Request, res: Response) => {
    try {
      const r = await fabricService.registerSampleShipment({
        sampleId: req.params.id,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('ship_sample', [req.params.id]);
      sendResult(res, r, 200, 'sample');
    } catch (e: any) {
      logger.error('[SampleRoute] SAMPLE_SHIP_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'SAMPLE_SHIP_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/:id/confirm', ...requireShipmentWrite, async (req: Request, res: Response) => {
    try {
      const r = await fabricService.registerCustomerConfirmation({
        sampleId: req.params.id,
        input: req.body ?? {},
        actorId: actorIdFromRequest(req),
        ip: req.ip,
      });
      if (r.ok) notify('confirm_sample', [req.params.id]);
      sendResult(res, r, 200, 'sample');
    } catch (e: any) {
      logger.error('[SampleRoute] SAMPLE_CONFIRM_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'SAMPLE_CONFIRM_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // REQ2-01 打色批次（色差管理体系）：缸号级色差证据链
  // 读走 JWT/API-Key；写必须 JWT（sample:color_batch:write scope）
  // ══════════════════════════════════════════════════════════════
  const colorBatchService = createColorBatchService(prisma);
  const requireColorBatchWrite = [requireWrite, requirePermission('sample:color_batch:write')];

  // 字面路由（/color-batches/evidence）须在参数路由（/color-batches/:id）之前
  router.get('/color-batches/evidence', async (req: Request, res: Response) => {
    try {
      const r = await colorBatchService.getColorBatchEvidence({
        developmentCaseId: typeof req.query.developmentCaseId === 'string' ? req.query.developmentCaseId : undefined,
        orderId: typeof req.query.orderId === 'string' ? req.query.orderId : undefined,
      });
      sendResult(res, r, 200, 'evidence');
    } catch (e: any) {
      logger.error('[SampleRoute] COLOR_EVIDENCE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'COLOR_EVIDENCE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.get('/color-batches', async (req: Request, res: Response) => {
    try {
      const r = await colorBatchService.listColorBatches({
        developmentCaseId: typeof req.query.developmentCaseId === 'string' ? req.query.developmentCaseId : undefined,
        orderId: typeof req.query.orderId === 'string' ? req.query.orderId : undefined,
      });
      sendResult(res, r, 200, 'items');
    } catch (e: any) {
      logger.error('[SampleRoute] COLOR_BATCH_LIST_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'COLOR_BATCH_LIST_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.post('/color-batches', ...requireColorBatchWrite, async (req: Request, res: Response) => {
    try {
      const r = await colorBatchService.createColorBatch(req.body ?? {}, actorIdFromRequest(req));
      if (r.ok) notify('create_color_batch', [r.data.id]);
      sendResult(res, r, 201, 'batch');
    } catch (e: any) {
      logger.error('[SampleRoute] COLOR_BATCH_CREATE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'COLOR_BATCH_CREATE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.patch('/color-batches/:id', ...requireColorBatchWrite, async (req: Request, res: Response) => {
    try {
      const r = await colorBatchService.updateColorBatch(req.params.id, req.body ?? {});
      sendResult(res, r, 200, 'batch');
    } catch (e: any) {
      logger.error('[SampleRoute] COLOR_BATCH_UPDATE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'COLOR_BATCH_UPDATE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  // 客户判定（批色即封样 + 疵点自动入供应商质量分）
  router.post('/color-batches/:id/customer-feedback', ...requireColorBatchWrite, async (req: Request, res: Response) => {
    try {
      const r = await colorBatchService.recordCustomerFeedback(req.params.id, req.body ?? {}, actorIdFromRequest(req));
      if (r.ok) notify('color_batch_customer_feedback', [req.params.id]);
      sendResult(res, r, 200, 'batch');
    } catch (e: any) {
      logger.error('[SampleRoute] COLOR_FEEDBACK_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'COLOR_FEEDBACK_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  router.delete('/color-batches/:id', ...requireColorBatchWrite, async (req: Request, res: Response) => {
    try {
      const r = await colorBatchService.deleteColorBatch(req.params.id, actorIdFromRequest(req));
      sendResult(res, r, 200, 'deleted');
    } catch (e: any) {
      logger.error('[SampleRoute] COLOR_BATCH_DELETE_FAILED', { error: e?.message });
      res.status(500).json({ error: { code: 'COLOR_BATCH_DELETE_FAILED', message: e?.message ?? 'operation failed' } });
    }
  });

  return router;
}
