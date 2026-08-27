/**
 * Development Management API — /api/v1/development
 *
 * CRUD + stage progression + convert-to-order for DevelopmentCase.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { PrismaClient, Prisma } from '@prisma/client';
import { syncOrderEntityReferences } from '../entities/sync';
import { createDevelopmentCase, updateDevelopmentCase, updateDevelopmentStage, deleteDevelopmentCase } from './developmentCaseMutationService';
import { ensureSampleNodes, listSampleNodes, advanceSampleNode } from './sampleNodeService';
import { writeRouteAuditLog, actorIdFromRequest } from '../audit/routeAudit';
import { convertDevCaseToOrder } from './convertService';
import { logger } from '../lib/logger';

export interface DevelopmentRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

type DevelopmentCaseCreateInput = {
  code: string;
  name: string;
  type: string;
  stage?: string;
  priority?: string;
  owner?: string;
  customerRelationId?: string;
  customerName?: string;
  supplierRelationId?: string;
  supplierName?: string;
  productAssetId?: string;
  productName?: string;
  currentRound?: number;
  nextAction?: string;
  targetDate?: string;
  sampleType?: string;
  sampleCategory?: string;
  sampleQuantity?: number;
  sampleUnit?: string;
  notes?: string;
  tags?: string[];
  styleSpec?: string;
  sizeSpec?: string;
  fabricSpec?: string;
  processSpec?: string;
};

type DevelopmentCaseUpdateInput = Partial<DevelopmentCaseCreateInput> & {
  stage?: string;
  sampleSentDate?: string;
  sampleTrackingNumber?: string;
  sampleCourier?: string;
  sampleShippingFee?: number;
  sampleRecipientName?: string;
  sampleRecipientCompany?: string;
  sampleRecipientAddress?: string;
  sampleRecipientPhone?: string;
  sampleFeedback?: string;
  sampleFeedbackDate?: string;
  sampleInvoiceId?: string;
  linkedOrderId?: string;
  linkedOrderPo?: string;
  convertedAt?: number;
  completedDate?: string;
  attachments?: any;
};

// Valid transitions for stage progression
const VALID_STAGES = ['developing', 'shipping', 'feedback', 'revision', 'approved', 'cancelled'] as const;
const VALID_TYPES = ['fabric', 'garment', 'pp', 'trim'] as const;

function isValidStage(s: string): s is typeof VALID_STAGES[number] {
  return (VALID_STAGES as readonly string[]).includes(s);
}
function isValidType(t: string): t is typeof VALID_TYPES[number] {
  return (VALID_TYPES as readonly string[]).includes(t);
}

export function createDevelopmentRouter(options: DevelopmentRouterOptions): Router {
  const { prisma, onDataChange, requireAuth, apiKeys } = options;
  const router = Router();

  // Shared auth guard: JWT or API-key (restored — was silently dropped by scaffold)
  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);

  // W-C 批三-E 族B 收口：Development 属 products 域（VIEW_TO_MAIN_SCOPES 真源）——
  // 原无授权门的写面挂 products:write scope 门（持有 = SALES/SALES_MANAGER＋SuperAdmin 特判），
  // 读面挂 products:read；convert/delete 已随族 C 一并收编 products:write（legacy requireRole 退役）。
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });
  const requireDevWrite = requirePermission('products:write');
  const requireDevRead = requirePermission('products:read');


  // ─── GET / ─── List development cases ───
  router.get('/', requireDevRead, async (req: Request, res: Response) => {
    try {
      const { type, stage, customer, supplier, owner, search, sampleInvoiceId, productAssetId, limit = '50', offset = '0' } = req.query;

      const where: Prisma.DevelopmentCaseWhereInput = {
        deletedAt: null,
        ...(type ? { type: String(type) } : {}),
        ...(stage ? { stage: String(stage) } : {}),
        ...(customer ? { customerRelationId: String(customer) } : {}),
        ...(supplier ? { supplierRelationId: String(supplier) } : {}),
        ...(owner ? { owner: String(owner) } : {}),
        // DR-057 v2.1 发票↔开发单双向闭环：发票详情反查引用本发票的开发单
        ...(sampleInvoiceId ? { sampleInvoiceId: String(sampleInvoiceId) } : {}),
        // DR-057 v2.1 档案↔开发单反查：产品档案详情反查关联开发单
        ...(productAssetId ? { productAssetId: String(productAssetId) } : {}),
        ...(search ? {
          OR: [
            { name: { contains: String(search), mode: 'insensitive' } },
            { code: { contains: String(search), mode: 'insensitive' } },
            { customerName: { contains: String(search), mode: 'insensitive' } },
            { supplierName: { contains: String(search), mode: 'insensitive' } },
            { productName: { contains: String(search), mode: 'insensitive' } },
          ],
        } : {}),
      };

      const [cases, total] = await Promise.all([
        prisma.developmentCase.findMany({
          where,
          orderBy: [{ targetDate: 'asc' }, { createdAt: 'desc' }],
          take: Math.min(Number(limit), 200),
          skip: Number(offset),
        }),
        prisma.developmentCase.count({ where }),
      ]);

      // Strip BigInt for JSON serialization
      const serialized = cases.map(c => ({
        ...c,
        createdAt: Number(c.createdAt),
        updatedAt: Number(c.updatedAt),
        deletedAt: c.deletedAt ? Number(c.deletedAt) : null,
        convertedAt: c.convertedAt ? Number(c.convertedAt) : null,
        tags: c.tags || [],
      }));

      res.json({ ok: true, cases: serialized, total, limit: Number(limit), offset: Number(offset) });
    } catch (err: any) {
      logger.error('[development] GET / failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /:id ─── Get single development case ───
  router.get('/:id', requireDevRead, async (req: Request, res: Response) => {
    try {
      const doc = await prisma.developmentCase.findFirst({
        where: { id: req.params.id, deletedAt: null },
      });
      if (!doc) {
        res.status(404).json({ ok: false, error: 'Development case not found' });
        return;
      }
      const serialized = {
        ...doc,
        createdAt: Number(doc.createdAt),
        updatedAt: Number(doc.updatedAt),
        deletedAt: doc.deletedAt ? Number(doc.deletedAt) : null,
        convertedAt: doc.convertedAt ? Number(doc.convertedAt) : null,
        tags: doc.tags || [],
      };
      res.json({ ok: true, case: serialized });
    } catch (err: any) {
      logger.error('[development] GET /:id failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── POST / ─── Create development case ───
  router.post('/', requireWrite, requireDevWrite, async (req: Request, res: Response) => {
    // task ERP-P1-development-mutation-route-foundation: route 只调 service（$transaction + sync + audit fail closed）
    const result = await createDevelopmentCase({
      prisma,
      input: req.body,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_INPUT: 400, INVALID_TYPE: 400, INVALID_STAGE: 400, DUPLICATE_CODE: 409, CREATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    const doc = result.data!.case;
    onDataChange?.({ entity: 'development', action: 'create', ids: [doc.id] });
    res.status(201).json({
      ok: true,
      case: {
        ...doc,
        createdAt: Number(doc.createdAt),
        updatedAt: Number(doc.updatedAt),
        deletedAt: null,
        convertedAt: null,
        tags: doc.tags || [],
      },
    });
  });

  // ─── PUT /:id ─── Update development case ───
  router.put('/:id', requireWrite, requireDevWrite, async (req: Request, res: Response) => {
    // task ERP-P1-development-mutation-route-foundation: route 只调 service
    const result = await updateDevelopmentCase({
      prisma,
      caseId: req.params.id,
      input: req.body,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_INPUT: 400, INVALID_STAGE: 400, INVALID_TYPE: 400, INVALID_TRANSITION: 409, NOT_FOUND: 404, UPDATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    const doc = result.data!.case;
    onDataChange?.({ entity: 'development', action: 'update', ids: [doc.id] });
    res.json({
      ok: true,
      case: {
        ...doc,
        createdAt: Number(doc.createdAt),
        updatedAt: Number(doc.updatedAt),
        deletedAt: doc.deletedAt ? Number(doc.deletedAt) : null,
        convertedAt: doc.convertedAt ? Number(doc.convertedAt) : null,
        tags: doc.tags || [],
      },
    });
  });

  // ─── PATCH /:id/stage ─── Update stage (with validation) ───
  router.patch('/:id/stage', requireWrite, requireDevWrite, async (req: Request, res: Response) => {
    // task ERP-P1-development-mutation-route-foundation: route 只调 service
    const { stage, nextAction } = req.body || {};
    const result = await updateDevelopmentStage({
      prisma,
      caseId: req.params.id,
      stage,
      nextAction,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_STAGE: 400, INVALID_TRANSITION: 400, REVIEW_REQUIRED: 400, NOT_FOUND: 404, STAGE_UPDATE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    const doc = result.data!.case;
    onDataChange?.({ entity: 'development', action: 'stage-change', ids: [doc.id] });
    res.json({
      ok: true,
      case: {
        ...doc,
        createdAt: Number(doc.createdAt),
        updatedAt: Number(doc.updatedAt),
        deletedAt: doc.deletedAt ? Number(doc.deletedAt) : null,
        convertedAt: doc.convertedAt ? Number(doc.convertedAt) : null,
        tags: doc.tags || [],
      },
    });
  });

  // ─── POST /:id/review — 5A 样衣评审 ───
  router.post('/:id/review', requireWrite, requireDevWrite, async (req: Request, res: Response) => {
    try {
      const { reviewStatus, reviewNote } = req.body || {};
      if (!['passed', 'failed'].includes(reviewStatus)) {
        return res.status(400).json({ ok: false, error: { code: 'INVALID_REVIEW_STATUS', message: 'reviewStatus must be passed or failed' } });
      }
      const existing = await prisma.developmentCase.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!existing) {
        return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Development case not found' } });
      }
      if (existing.sampleCategory !== '5a') {
        return res.status(400).json({ ok: false, error: { code: 'NOT_5A', message: 'Only 5A samples require review' } });
      }
      const updated = await prisma.developmentCase.update({
        where: { id: req.params.id },
        data: {
          reviewStatus,
          reviewNote: reviewNote || null,
          reviewerId: actorIdFromRequest(req) || null,
          reviewDate: new Date().toISOString().slice(0, 10),
          updatedAt: BigInt(Date.now()),
        },
      });
      onDataChange?.({ entity: 'development', action: 'review', ids: [req.params.id] });
      res.json({
        ok: true,
        case: {
          ...updated,
          createdAt: Number(updated.createdAt),
          updatedAt: Number(updated.updatedAt),
          deletedAt: updated.deletedAt ? Number(updated.deletedAt) : null,
          convertedAt: updated.convertedAt ? Number(updated.convertedAt) : null,
          tags: updated.tags || [],
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: { code: 'REVIEW_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // ─── POST /:id/convert ─── Convert development case to order ───
  // Two modes:
  //   (a) "Link to existing order" — pass { orderId, orderPo } in the body.
  //   (b) "Auto-create order from this case" — pass { autoCreate: true,
  //       orderPo?, customer?, millName?, dueDate?, productName? }. Server
  //       generates a new Order using the dev case as the source of truth
  //       (customerRelationId, supplierRelationId, productAssetId, etc.).
  //
  // In both modes the case is marked approved + completedDate, linked to the
  // resulting order, and the cross-module EntityLink graph is updated.
  // task ERP-P1: route 调用 convertDevCaseToOrder service（route + Agent flow 共用契约）
  // W-C 族 C：convert 从 legacy HIGH_RISK 收编为矩阵 scope 门（SALES/SM 持 products:write；
  // 开发转订单是 S1 主链日常，订单创建本身的信用/状态门禁由 orderService 链各自兜底）
  router.post('/:id/convert', requireDevWrite, async (req: Request, res: Response) => {
    try {
      const { orderId, orderPo, autoCreate, customer, millName, dueDate, productName, quantity } = req.body || {};
      const wantAutoCreate = Boolean(autoCreate) || (!orderId && !orderPo);
      const result = await convertDevCaseToOrder({
        prisma,
        caseId: req.params.id,
        mode: wantAutoCreate ? 'autoCreate' : 'link',
        orderId, orderPo, customer, millName, dueDate, productName, quantity,
        actorId: actorIdFromRequest(req),
      });
      if (!result.ok) {
        const statusCodeMap: Record<string, number> = { DEV_CASE_NOT_FOUND: 404, ORDER_NOT_FOUND: 404, INVALID_INPUT: 400, ALREADY_CONVERTED: 409, CASE_CANCELLED: 400, CONVERT_FAILED: 500 };
        res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
        return;
      }
      const doc = result.data!.case;
      const createdOrder = result.data!.order;
      onDataChange?.({ entity: 'development', action: 'convert', ids: [doc.id] });
      if (createdOrder) onDataChange?.({ entity: 'orders', action: 'create-from-dev', ids: [doc.linkedOrderId] });

      res.json({
        ok: true,
        case: {
          ...doc,
          createdAt: Number(doc.createdAt),
          updatedAt: Number(doc.updatedAt),
          deletedAt: doc.deletedAt ? Number(doc.deletedAt) : null,
          convertedAt: doc.convertedAt ? Number(doc.convertedAt) : null,
          tags: doc.tags || [],
        },
        order: createdOrder
          ? {
              ...createdOrder,
              importedAt: Number(createdOrder.importedAt),
              createdAt: Number(createdOrder.createdAt),
              updatedAt: Number(createdOrder.updatedAt),
            }
          : null,
      });
    } catch (err: any) {
      logger.error('[development] POST /:id/convert failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: { code: 'CONVERT_FAILED', message: err.message } });
    }
  });

  // ─── GET /:id/sample-nodes — 三级样衣节点列表（Phase B4） ───
  router.get('/:id/sample-nodes', requireDevRead, async (req: Request, res: Response) => {
    try {
      const doc = await prisma.developmentCase.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true } });
      if (!doc) {
        res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Development case not found' } });
        return;
      }
      const nodes = await listSampleNodes(prisma, req.params.id);
      res.json({ ok: true, nodes });
    } catch (err: any) {
      logger.error('[development] GET /:id/sample-nodes failed', { error: err?.message || String(err) });
      res.status(500).json({ ok: false, error: { code: 'LIST_FAILED', message: err.message } });
    }
  });

  // ─── POST /:id/sample-nodes/ensure — 幂等创建三级节点（Phase B4） ───
  router.post('/:id/sample-nodes/ensure', requireWrite, requireDevWrite, async (req: Request, res: Response) => {
    const result = await ensureSampleNodes(prisma, req.params.id);
    if (!result.ok) {
      res.status(result.error!.code === 'NOT_FOUND' ? 404 : 500).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, nodes: result.data!.nodes });
  });

  // ─── PATCH /:id/sample-nodes/:level — 推进样衣节点状态机（Phase B4） ───
  router.patch('/:id/sample-nodes/:level', requireWrite, requireDevWrite, async (req: Request, res: Response) => {
    const result = await advanceSampleNode({
      prisma,
      caseId: req.params.id,
      level: req.params.level,
      input: req.body || {},
      actorId: actorIdFromRequest(req),
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = {
        NOT_FOUND: 404,
        INVALID_LEVEL: 400,
        INVALID_ACTION: 400,
        INVALID_TRANSITION: 400,
      };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    onDataChange?.({ entity: 'development', action: 'sample-node', ids: [req.params.id] });
    res.json({ ok: true, node: result.data!.node });
  });

  // ─── DELETE /:id ─── Soft delete ───
  // W-C 族 C：软删开发单（草稿期业务操作，无财务勾稽牵连）收编矩阵 scope 门；
  // 服务层状态机兜底（已转订单/已结案不可删）
  router.delete('/:id', requireDevWrite, async (req: Request, res: Response) => {
    // task ERP-P1-development-mutation-route-foundation: route 只调 service
    const result = await deleteDevelopmentCase({
      prisma,
      caseId: req.params.id,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, ALREADY_DELETED: 409, CONVERTED_TO_ORDER: 409, DELETE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    onDataChange?.({ entity: 'development', action: 'delete', ids: [req.params.id] });
    res.json({ ok: true });
  });

  return router;
}
