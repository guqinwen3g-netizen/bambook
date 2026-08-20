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
 *   REQ2-04 第三方测试管理（qc:read 读 / qc:write 写）：
 *   - POST   /test-requests                        — 登记委托 {orderId, testItems[], agency, ...}
 *   - GET    /test-requests?orderId=               — 订单维度全景（附件+整改+summary，3 击数据源）
 *   - PATCH  /test-requests/:id                    — 结论登记（fail 门禁：failItems+≥1 open 整改）
 *   - DELETE /test-requests/:id                    — 软删（仅 pending）
 *   - POST   /test-requests/:id/files              — 报告 PDF 上传（multer，PDF only ≤10MB）
 *   - GET    /test-requests/:id/files/:fileId      — 报告下载/预览
 *   - POST   /test-requests/:id/corrective-actions — 追加整改 {failItem, action, ...}
 *   - POST   /test-requests/corrective-actions/:caId/close — 整改闭环 {closeNote?}
 *
 * 守卫口径与 seasons/risk 模块一致：读走 JWT 或 API-Key，写必须 JWT（requireJwtForWrite）。
 * 链写 scope（:write 后缀）由 requirePermission 强制 JWT user-session，API key 通道 401。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { serializeValue } from '../lib/serializeValue';
import { createQcService, QCLocationInput, QCAssignmentInput } from './qcService';
import {
  createQcChainService,
  GarmentSampleReviewInput,
  FabricSampleReviewInput,
  ChainResult,
} from './qcChainService';
import { createTestRequestService, TestRequestResult } from './testRequestService';

export interface QcRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  /** REQ2-04 报告 PDF 附件落盘根目录（与 products 图片上传同源 UPLOAD_DIR） */
  uploadDir?: string;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createQcRouter(options: QcRouterOptions): Router {
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const router = Router();
  const service = createQcService(prisma);
  const chainService = createQcChainService(prisma);
  const testRequestService = createTestRequestService(prisma);

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
        {
          reportId: req.body?.reportId ?? null,
          // 缺口修复：支持携带 report 数据自动创建大货验货报告（final 锚定 INR__{orderId} 出运门禁锚点）
          report: req.body?.report ?? undefined,
        },
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

  // ══════════════════════════════════════════════════════════════
  // REQ2-04 第三方测试管理（TestRequest — 订单级实验室检测委托）
  // 读 qc:read / 写 qc:write；报告 PDF multer 落盘（ProductImage 范式）
  // ══════════════════════════════════════════════════════════════

  /** TestRequestResult → HTTP（结构化错误码直透，与 handleChainResult 同构） */
  const handleTrResult = <T>(
    res: Response,
    result: TestRequestResult<T>,
    successStatus: number,
    wrap: (data: T) => Record<string, unknown>,
  ) => {
    if (!result.ok) {
      return res.status(result.error.status).json({ error: { code: result.error.code, message: result.error.message } });
    }
    res.status(successStatus).json(serializeValue(wrap(result.data)));
  };

  // 报告 PDF 上传（PDF only ≤10MB，多文件；落盘 test-reports/{requestId}/）
  const reportUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, file, cb) => {
        const dir = path.join(options.uploadDir ?? path.join(process.cwd(), 'uploads'), 'test-reports', _req.params.id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.pdf';
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) cb(null, true);
      else cb(new Error('仅支持 PDF 报告文件'));
    },
  });

  // 登记委托
  router.post(
    '/test-requests',
    requireWrite,
    requirePermission('qc:write'),
    async (req: Request, res: Response) => {
      const result = await testRequestService.createTestRequest((req.body ?? {}) as any);
      if (result.ok) notify('create_test_request', [result.data.request.id]);
      handleTrResult(res, result, 201, (d) => ({ ok: true, request: d.request }));
    },
  );

  // 订单维度全景（3 击数据源：含附件 + 整改 + summary）
  router.get(
    '/test-requests',
    requirePermission('qc:read'),
    async (req: Request, res: Response) => {
      const result = await testRequestService.listTestRequests(String(req.query.orderId ?? ''));
      handleTrResult(res, result, 200, (d) => ({ ok: true, ...d }));
    },
  );

  // 附件下载/预览（sendFile 绝对路径；filePath 相对 uploadDir）
  router.get(
    '/test-requests/:id/files/:fileId',
    requirePermission('qc:read'),
    async (req: Request, res: Response) => {
      try {
        const file = await (prisma as any).testReportFile.findFirst({
          where: { id: req.params.fileId, testRequestId: req.params.id, deletedAt: null },
        });
        if (!file) {
          return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: '报告附件不存在' } });
        }
        const abs = path.join(options.uploadDir ?? path.join(process.cwd(), 'uploads'), file.filePath);
        if (!fs.existsSync(abs)) {
          return res.status(404).json({ error: { code: 'FILE_MISSING', message: '附件文件已丢失（磁盘无此文件）' } });
        }
        return res.download(abs, file.fileName);
      } catch (e: any) {
        logger.error('[QcRoute] TEST_FILE_DOWNLOAD_FAILED', { error: e?.message });
        return res.status(500).json({ error: { code: 'TEST_FILE_DOWNLOAD_FAILED', message: '附件下载失败' } });
      }
    },
  );

  // 上传报告 PDF
  router.post(
    '/test-requests/:id/files',
    requireWrite,
    requirePermission('qc:write'),
    reportUpload.array('files', 10),
    async (req: Request, res: Response) => {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        return res.status(400).json({ error: { code: 'NO_FILES', message: '未收到 PDF 文件' } });
      }
      const result = await testRequestService.attachFiles(req.params.id, files.map((f) => ({
        filePath: path.join('test-reports', req.params.id, f.filename),
        fileName: f.originalname,
        mimeType: f.mimetype,
        fileSize: f.size,
      })));
      if (!result.ok) {
        // 委托单不存在等场景：清理已落盘文件，不留孤儿
        for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* best-effort */ } }
      } else {
        notify('upload_test_report', [req.params.id]);
      }
      handleTrResult(res, result, 201, (d) => ({ ok: true, files: d.files }));
    },
  );

  // 结论登记 / 委托修正（fail 门禁在 service）
  router.patch(
    '/test-requests/:id',
    requireWrite,
    requirePermission('qc:write'),
    async (req: Request, res: Response) => {
      const result = await testRequestService.updateTestRequest(req.params.id, (req.body ?? {}) as any);
      if (result.ok) notify('update_test_request', [req.params.id]);
      handleTrResult(res, result, 200, (d) => ({ ok: true, request: d.request }));
    },
  );

  // 软删委托（仅 pending）
  router.delete(
    '/test-requests/:id',
    requireWrite,
    requirePermission('qc:write'),
    async (req: Request, res: Response) => {
      const result = await testRequestService.deleteTestRequest(req.params.id);
      if (result.ok) notify('delete_test_request', [req.params.id]);
      handleTrResult(res, result, 200, (d) => ({ ok: true, id: d.id }));
    },
  );

  // 追加整改记录（fail 单）
  router.post(
    '/test-requests/:id/corrective-actions',
    requireWrite,
    requirePermission('qc:write'),
    async (req: Request, res: Response) => {
      const result = await testRequestService.addCorrectiveAction(req.params.id, (req.body ?? {}) as any);
      if (result.ok) notify('add_test_corrective_action', [req.params.id]);
      handleTrResult(res, result, 201, (d) => ({ ok: true, correctiveAction: d.correctiveAction }));
    },
  );

  // 整改闭环（open→closed；字面段路由先于参数路由不冲突——段数不同）
  router.post(
    '/test-requests/corrective-actions/:caId/close',
    requireWrite,
    requirePermission('qc:write'),
    async (req: Request, res: Response) => {
      const result = await testRequestService.closeCorrectiveAction(
        req.params.caId, (req.body ?? {}).closeNote);
      if (result.ok) notify('close_test_corrective_action', [req.params.caId]);
      handleTrResult(res, result, 200, (d) => ({ ok: true, correctiveAction: d.correctiveAction }));
    },
  );

  return router;
}
