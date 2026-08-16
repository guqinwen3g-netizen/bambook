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
 *   DR-029 双链样品 QC（链 scope 双闸门 + JWT fail-closed）：
 *   - POST   /chain/garment/:orderId/review        — 服装链评审（qc:garment_chain:write）
 *   - POST   /chain/garment/:orderId/direct-reject — 直接打回工厂重做（qc:garment_chain:write，QC-29-A4）
 *   - POST   /chain/fabric/:orderId/review         — 面料链评审（qc:fabric_chain:write）
 *   - GET    /chain/garment/:orderId/gate          — 寄送门禁查询（qc:read；?sampleLevel=&round=）
 *   - GET    /chain/:orderId/reports               — 链报告列表（qc:read；?chain=garment|fabric）
 *
 *   DR-014 出运资格 + 报告双签：
 *   - GET    /orders/:orderId/shipment-eligibility — 面料出运三条件并行视图（qc:read，QC-014-C2）
 *   - GET    /orders/:orderId/reports              — 订单全部验货报告（qc:read）
 *   - GET    /reports/:reportId                    — 单条报告（qc:read）
 *   - POST   /reports/:reportId/sign               — 双签 {role: qc|business}（qc:write + JWT）
 *
 * 守卫口径与 seasons/risk 模块一致：读走 JWT 或 API-Key，写必须 JWT（requireJwtForWrite）。
 * 链写 scope（:write 后缀）由 requirePermission 强制 JWT user-session，API key 通道 401。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { createQcService, QCLocationInput, QCAssignmentInput } from './qcService';
import {
  createQcChainService,
  GarmentSampleReviewInput,
  FabricSampleReviewInput,
  ChainResult,
} from './qcChainService';

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
  const chainService = createQcChainService(prisma);

  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const notify = (action: string, ids?: string[]) => onDataChange?.({ entity: 'qc', action, ids });

  const handleError = (res: Response, e: any, code: string) => {
    const msg = e?.message || 'operation failed';
    logger.error(`[QcRoute] ${code}`, { error: msg });
    const isForbidden = msg.includes('仅限') || msg.includes('ROLE_REQUIRED');
    const isClient =
      msg.includes('必填') || msg.includes('非法') || msg.includes('必须是') ||
      msg.includes('已存在') || msg.includes('不可修改') || msg.includes('不可删除') ||
      msg.includes('不可取消') || msg.includes('已有进行中') || msg.includes('不匹配') ||
      msg.includes('已签署');
    const isNotFound = msg.includes('不存在');
    res.status(isForbidden ? 403 : isNotFound ? 404 : isClient ? 400 : 500).json({ error: { code, message: msg } });
  };

  /** ChainResult → HTTP 响应（双链服务结构化错误码直透，fail-closed） */
  const handleChainResult = <T>(
    res: Response,
    result: ChainResult<T>,
    successStatus: number,
    wrap: (data: T) => Record<string, unknown>,
  ) => {
    if (!result.ok) {
      return res.status(result.error.status).json({ error: { code: result.error.code, message: result.error.message } });
    }
    res.status(successStatus).json(serializeValue(wrap(result.data)));
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

  // ══════════════════════════════════════════════════════════════
  // DR-029 双链样品 QC 评审（服装链 / 面料链 强制边界，QC-29-B3）
  //   写端点：requireWrite（JWT fail-closed）+ 链 scope 双闸门
  // ══════════════════════════════════════════════════════════════

  router.post(
    '/chain/garment/:orderId/review',
    requireWrite,
    requirePermission('qc:garment_chain:write'),
    async (req: Request, res: Response) => {
      const result = await chainService.reviewGarmentSample({
        orderId: req.params.orderId,
        input: (req.body ?? {}) as GarmentSampleReviewInput,
        actorId: actorIdFromRequest(req),
        ip: req.ip ?? null,
      });
      if (result.ok) notify('review_garment_sample', [result.data.report.id]);
      handleChainResult(res, result, 201, (d) => ({ ok: true, report: d.report, gate: d.gate }));
    },
  );

  // QC-29-A4：直接打回工厂重做（结论=fail + disposition=DIRECT_REJECT，通知业务员）
  router.post(
    '/chain/garment/:orderId/direct-reject',
    requireWrite,
    requirePermission('qc:garment_chain:write'),
    async (req: Request, res: Response) => {
      const result = await chainService.directlyRejectGarmentSample({
        orderId: req.params.orderId,
        input: (req.body ?? {}) as GarmentSampleReviewInput,
        actorId: actorIdFromRequest(req),
        ip: req.ip ?? null,
      });
      if (result.ok) notify('direct_reject_garment_sample', [result.data.report.id]);
      handleChainResult(res, result, 201, (d) => ({ ok: true, report: d.report, gate: d.gate }));
    },
  );

  router.post(
    '/chain/fabric/:orderId/review',
    requireWrite,
    requirePermission('qc:fabric_chain:write'),
    async (req: Request, res: Response) => {
      const result = await chainService.reviewFabricSample({
        orderId: req.params.orderId,
        input: (req.body ?? {}) as FabricSampleReviewInput,
        actorId: actorIdFromRequest(req),
        ip: req.ip ?? null,
      });
      if (result.ok) notify('review_fabric_sample', [result.data.report.id]);
      handleChainResult(res, result, 201, (d) => ({ ok: true, report: d.report }));
    },
  );

  // DR-008 / QC-29-A3 服装样品寄送门禁查询（样品域 Track C 消费）
  router.get(
    '/chain/garment/:orderId/gate',
    requirePermission('qc:read'),
    async (req: Request, res: Response) => {
      const result = await chainService.getGarmentSampleGate({
        orderId: req.params.orderId,
        sampleLevel: req.query.sampleLevel ? String(req.query.sampleLevel) : undefined,
        round: Number(req.query.round),
      });
      handleChainResult(res, result, 200, (d) => d);
    },
  );

  // 链报告列表（样品链与大货 final/midline 天然隔离，REL-14-A4）
  router.get(
    '/chain/:orderId/reports',
    requirePermission('qc:read'),
    async (req: Request, res: Response) => {
      const chain = req.query.chain ? String(req.query.chain) : undefined;
      if (chain !== undefined && chain !== 'garment' && chain !== 'fabric') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'chain 仅允许 garment | fabric' } });
      }
      const result = await chainService.listChainReports({ orderId: req.params.orderId, chain });
      handleChainResult(res, result, 200, (d) => d);
    },
  );

  // ══════════════════════════════════════════════════════════════
  // DR-014 面料出运资格视图（QC ∥ S/S ∥ RC 三条件并行，QC-014-C2）
  // ══════════════════════════════════════════════════════════════

  router.get(
    '/orders/:orderId/shipment-eligibility',
    requirePermission('qc:read'),
    async (req: Request, res: Response) => {
      try {
        const view = await service.checkShipmentEligibility(req.params.orderId);
        res.json(serializeValue(view));
      } catch (e: any) {
        handleError(res, e, 'QC_SHIPMENT_ELIGIBILITY_FAILED');
      }
    },
  );

  // ══════════════════════════════════════════════════════════════
  // InspectionReport 读取 + signatures 双签（质量门禁 §9.3-②）
  // ══════════════════════════════════════════════════════════════

  router.get(
    '/orders/:orderId/reports',
    requirePermission('qc:read'),
    async (req: Request, res: Response) => {
      try {
        const result = await service.listReportsByOrder(req.params.orderId);
        res.json(serializeValue(result));
      } catch (e: any) {
        handleError(res, e, 'QC_ORDER_REPORTS_FAILED');
      }
    },
  );

  router.get(
    '/reports/:reportId',
    requirePermission('qc:read'),
    async (req: Request, res: Response) => {
      try {
        const report = await service.getReport(req.params.reportId);
        res.json(serializeValue({ item: report }));
      } catch (e: any) {
        handleError(res, e, 'QC_REPORT_GET_FAILED');
      }
    },
  );

  router.post(
    '/reports/:reportId/sign',
    requireWrite,
    requirePermission('qc:write'),
    async (req: Request, res: Response) => {
      try {
        const report = await service.signReport(
          req.params.reportId,
          req.body?.role,
          actorIdFromRequest(req),
          req.ip ?? null,
        );
        notify('sign_report', [report.id]);
        res.json(serializeValue({ ok: true, item: report }));
      } catch (e: any) {
        handleError(res, e, 'QC_REPORT_SIGN_FAILED');
      }
    },
  );

  return router;
}
