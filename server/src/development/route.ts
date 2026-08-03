/**
 * Development Management API — /api/v1/development
 *
 * CRUD + stage progression + convert-to-order for DevelopmentCase.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import type { AgentRole } from '../agent/types';
import { PrismaClient, Prisma } from '@prisma/client';
import { syncOrderEntityReferences } from '../entities/sync';
import { createDevelopmentCase, updateDevelopmentCase, updateDevelopmentStage, deleteDevelopmentCase } from './developmentCaseMutationService';
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
  sampleQuantity?: number;
  sampleUnit?: string;
  notes?: string;
  tags?: string[];
};

type DevelopmentCaseUpdateInput = Partial<DevelopmentCaseCreateInput> & {
  stage?: string;
  sampleSentDate?: string;
  sampleTrackingNumber?: string;
  sampleCourier?: string;
  sampleFeedback?: string;
  sampleFeedbackDate?: string;
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

  const HIGH_RISK_ROLES: AgentRole[] = ['owner', 'admin', 'manager'];
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });


  // ─── GET / ─── List development cases ───
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { type, stage, customer, supplier, owner, search, limit = '50', offset = '0' } = req.query;

      const where: Prisma.DevelopmentCaseWhereInput = {
        deletedAt: null,
        ...(type ? { type: String(type) } : {}),
        ...(stage ? { stage: String(stage) } : {}),
        ...(customer ? { customerRelationId: String(customer) } : {}),
        ...(supplier ? { supplierRelationId: String(supplier) } : {}),
        ...(owner ? { owner: String(owner) } : {}),
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
  router.get('/:id', async (req: Request, res: Response) => {
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
  router.post('/', requireWrite, async (req: Request, res: Response) => {
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
  router.put('/:id', requireWrite, async (req: Request, res: Response) => {
    // task ERP-P1-development-mutation-route-foundation: route 只调 service
    const result = await updateDevelopmentCase({
      prisma,
      caseId: req.params.id,
      input: req.body,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { INVALID_INPUT: 400, INVALID_STAGE: 400, INVALID_TYPE: 400, NOT_FOUND: 404, UPDATE_FAILED: 500 };
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
  router.patch('/:id/stage', requireWrite, async (req: Request, res: Response) => {
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
  router.post('/:id/review', requireWrite, async (req: Request, res: Response) => {
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
  router.post('/:id/convert', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
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

  // ─── DELETE /:id ─── Soft delete ───
  router.delete('/:id', requireRole(...HIGH_RISK_ROLES), async (req: Request, res: Response) => {
    // task ERP-P1-development-mutation-route-foundation: route 只调 service
    const result = await deleteDevelopmentCase({
      prisma,
      caseId: req.params.id,
      actorId: actorIdFromRequest(req),
      ip: req.ip || null,
    });
    if (!result.ok) {
      const statusCodeMap: Record<string, number> = { NOT_FOUND: 404, ALREADY_DELETED: 409, DELETE_FAILED: 500 };
      res.status(statusCodeMap[result.error!.code] || 500).json({ ok: false, error: result.error });
      return;
    }
    onDataChange?.({ entity: 'development', action: 'delete', ids: [req.params.id] });
    res.json({ ok: true });
  });

  return router;
}
