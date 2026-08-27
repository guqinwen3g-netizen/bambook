/**
 * task ERP-P1-development-mutation-route-foundation:
 * DevelopmentCase mutation service — route + Agent 共用契约。
 * 每个 mutation 内部 $transaction，业务写入 + syncDevelopmentCaseReferences /
 * deactivateEntityLinks + writeRouteAuditLog 在同一事务闭环，fail closed。
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { syncDevelopmentCaseReferences, deactivateEntityLinks } from '../entities/sync';

export type DevelopmentCaseMutationErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_TRANSITION'
  | 'REVIEW_REQUIRED'
  | 'INVALID_STAGE'
  | 'INVALID_TYPE'
  | 'DUPLICATE_CODE'
  | 'NOT_FOUND'
  | 'ALREADY_DELETED'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'STAGE_UPDATE_FAILED'
  | 'DELETE_FAILED';

export interface DevelopmentCaseMutationError {
  code: DevelopmentCaseMutationErrorCode;
  message: string;
}

export interface DevelopmentCaseMutationResult {
  ok: boolean;
  data?: { case?: any; auditId: string };
  error?: DevelopmentCaseMutationError;
}

// 常量：合法 stage / type 集合（route + service 共用）
export const VALID_STAGES = ['developing', 'shipping', 'feedback', 'revision', 'approved', 'cancelled'] as const;

// DevCase 合法 stage 转换矩阵
const DEV_STAGE_TRANSITIONS: Record<string, Set<string>> = {
  developing: new Set(['shipping', 'cancelled']),
  shipping: new Set(['feedback', 'cancelled']),
  feedback: new Set(['revision', 'approved', 'cancelled']),
  revision: new Set(['shipping', 'cancelled']),
  approved: new Set(), // 终态
  cancelled: new Set(), // 终态
};

// 5A 样衣审批门禁：shipping 阶段需要 reviewStatus = passed
const STAGES_REQUIRING_REVIEW: Set<string> = new Set(['shipping']);
export const VALID_TYPES = ['fabric', 'garment', 'pp', 'trim'] as const;
export function isValidStage(s: string): s is typeof VALID_STAGES[number] {
  return (VALID_STAGES as readonly string[]).includes(s);
}
export function isValidType(t: string): t is typeof VALID_TYPES[number] {
  return (VALID_TYPES as readonly string[]).includes(t);
}

export interface DevelopmentCaseCreateInput {
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
}

export type DevelopmentCaseUpdateInput = Partial<DevelopmentCaseCreateInput> & {
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

function throwCoded(code: DevelopmentCaseMutationErrorCode, message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { code, statusCode });
}

// ─── CREATE ────────────────────────────────────────────────────────
export async function createDevelopmentCase(params: {
  prisma: PrismaClient;
  input: DevelopmentCaseCreateInput;
  actorId?: string;
  ip?: string | null;
}): Promise<DevelopmentCaseMutationResult> {
  const { prisma, input, actorId, ip } = params;
  if (!input?.code || !input?.name || !input?.type) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'code, name, and type are required' } };
  }
  if (!isValidType(input.type)) {
    return { ok: false, error: { code: 'INVALID_TYPE', message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` } };
  }
  if (input.stage && !isValidStage(input.stage)) {
    return { ok: false, error: { code: 'INVALID_STAGE', message: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` } };
  }
  const now = BigInt(Date.now());
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const created = await tx.developmentCase.create({
        data: {
          id: `DEV-${input.code}-${Date.now()}`,
          code: input.code,
          name: input.name,
          type: input.type,
          stage: input.stage || 'developing',
          priority: input.priority || 'normal',
          owner: input.owner || null,
          customerRelationId: input.customerRelationId || null,
          customerName: input.customerName || null,
          supplierRelationId: input.supplierRelationId || null,
          supplierName: input.supplierName || null,
          productAssetId: input.productAssetId || null,
          productName: input.productName || null,
          currentRound: input.currentRound || 1,
          nextAction: input.nextAction || null,
          targetDate: input.targetDate || null,
          sampleType: input.sampleType || null,
          sampleCategory: input.sampleCategory || null,
          sampleQuantity: input.sampleQuantity || null,
          sampleUnit: input.sampleUnit || 'meter',
          sampleShippingFee: (input as DevelopmentCaseUpdateInput).sampleShippingFee ?? null,
          sampleRecipientName: (input as DevelopmentCaseUpdateInput).sampleRecipientName || null,
          sampleRecipientCompany: (input as DevelopmentCaseUpdateInput).sampleRecipientCompany || null,
          sampleRecipientAddress: (input as DevelopmentCaseUpdateInput).sampleRecipientAddress || null,
          sampleRecipientPhone: (input as DevelopmentCaseUpdateInput).sampleRecipientPhone || null,
          sampleInvoiceId: (input as DevelopmentCaseUpdateInput).sampleInvoiceId || null,
          notes: input.notes || null,
          tags: input.tags || [],
          styleSpec: input.styleSpec || null,
          sizeSpec: input.sizeSpec || null,
          fabricSpec: input.fabricSpec || null,
          processSpec: input.processSpec || null,
          createdAt: now,
          updatedAt: now,
        },
      });
      await syncDevelopmentCaseReferences(prisma, created as any, { source: 'route:dev-case:create' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx,
        actorId: actorId || 'api',
        source: 'route:dev-case:create',
        operation: 'create_development_case',
        targetType: 'DevelopmentCase',
        targetId: created.id,
        after: { id: created.id, code: created.code, name: created.name, type: created.type, stage: created.stage },
        ip: ip || null,
      });
      return { case: created, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return { ok: false, error: { code: 'DUPLICATE_CODE', message: 'Development code already exists' } };
    }
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    return { ok: false, error: { code: 'CREATE_FAILED', message: `Create transaction failed: ${String(e?.message ?? e)}` } };
  }
}

// ─── UPDATE ────────────────────────────────────────────────────────
export async function updateDevelopmentCase(params: {
  prisma: PrismaClient;
  caseId: string;
  input: DevelopmentCaseUpdateInput;
  actorId?: string;
  ip?: string | null;
}): Promise<DevelopmentCaseMutationResult> {
  const { prisma, caseId, input, actorId, ip } = params;
  if (!input || typeof input !== 'object') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'update payload is required' } };
  }
  if (input.stage && !isValidStage(input.stage)) {
    return { ok: false, error: { code: 'INVALID_STAGE', message: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` } };
  }
  if (input.type && !isValidType(input.type)) {
    return { ok: false, error: { code: 'INVALID_TYPE', message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` } };
  }
  const now = BigInt(Date.now());
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.developmentCase.findFirst({ where: { id: caseId, deletedAt: null } });
      if (!existing) {
        throwCoded('NOT_FOUND', `Development case ${caseId} not found`, 404);
      }
      const updateData: Prisma.DevelopmentCaseUncheckedUpdateInput = {
        ...input,
        updatedAt: now,
      };
      if (input.stage === 'approved' && !existing.completedDate) {
        (updateData as any).completedDate = new Date().toISOString().split('T')[0];
      }
      const updated = await tx.developmentCase.update({
        where: { id: caseId },
        data: updateData,
      });
      await syncDevelopmentCaseReferences(prisma, updated as any, { source: 'route:dev-case:update' }, tx);
      const auditId = await writeRouteAuditLog({
        prisma: tx,
        actorId: actorId || 'api',
        source: 'route:dev-case:update',
        operation: 'update_development_case',
        targetType: 'DevelopmentCase',
        targetId: caseId,
        before: { id: caseId, name: existing.name, stage: existing.stage },
        after: { id: caseId, ...(input.name !== undefined ? { name: input.name } : {}), ...(input.stage !== undefined ? { stage: input.stage } : {}) },
        ip: ip || null,
      });
      return { case: updated, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    return { ok: false, error: { code: 'UPDATE_FAILED', message: `Update transaction failed: ${String(e?.message ?? e)}` } };
  }
}

// ─── UPDATE STAGE ──────────────────────────────────────────────────
export async function updateDevelopmentStage(params: {
  prisma: PrismaClient;
  caseId: string;
  stage: string;
  nextAction?: string;
  actorId?: string;
  ip?: string | null;
}): Promise<DevelopmentCaseMutationResult> {
  const { prisma, caseId, stage, nextAction, actorId, ip } = params;
  if (!stage || !isValidStage(stage)) {
    return { ok: false, error: { code: 'INVALID_STAGE', message: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` } };
  }
  const now = BigInt(Date.now());
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.developmentCase.findFirst({ where: { id: caseId, deletedAt: null } });
      if (!existing) {
        throwCoded('NOT_FOUND', `Development case ${caseId} not found`, 404);
      }
      // stage 转换合法性校验
      if (existing.stage !== stage) {
        const allowed = DEV_STAGE_TRANSITIONS[existing.stage];
        if (!allowed || !allowed.has(stage)) {
          throwCoded('INVALID_TRANSITION', `Invalid stage transition: ${existing.stage} -> ${stage}`, 400);
        }
        // 5A 样衣审批门禁：进入 shipping 前必须评审通过
        if (STAGES_REQUIRING_REVIEW.has(stage) && existing.sampleCategory === '5a' && existing.reviewStatus !== 'passed') {
          throwCoded('REVIEW_REQUIRED', `5A 样衣进入寄出阶段前需生产部评审通过（当前评审状态: ${existing.reviewStatus || '未评审'}）`, 400);
        }
      }
      const updateData: Prisma.DevelopmentCaseUncheckedUpdateInput = { stage, updatedAt: now };
      if (nextAction !== undefined) updateData.nextAction = nextAction;
      if (stage === 'revision') {
        updateData.currentRound = (existing.currentRound || 1) + 1;
      }
      if (stage === 'approved' && !existing.completedDate) {
        (updateData as any).completedDate = new Date().toISOString().split('T')[0];
      }
      const updated = await tx.developmentCase.update({
        where: { id: caseId },
        data: updateData,
      });
      const auditId = await writeRouteAuditLog({
        prisma: tx,
        actorId: actorId || 'api',
        source: 'route:dev-case:stage',
        operation: 'update_development_case_stage',
        targetType: 'DevelopmentCase',
        targetId: caseId,
        before: { id: caseId, stage: existing.stage, currentRound: existing.currentRound },
        after: { id: caseId, stage, currentRound: (updateData as any).currentRound ?? existing.currentRound },
        ip: ip || null,
      });
      return { case: updated, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    return { ok: false, error: { code: 'STAGE_UPDATE_FAILED', message: `Stage transaction failed: ${String(e?.message ?? e)}` } };
  }
}

// ─── DELETE (soft) ─────────────────────────────────────────────────
export async function deleteDevelopmentCase(params: {
  prisma: PrismaClient;
  caseId: string;
  actorId?: string;
  ip?: string | null;
}): Promise<DevelopmentCaseMutationResult> {
  const { prisma, caseId, actorId, ip } = params;
  const now = BigInt(Date.now());
  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.developmentCase.findFirst({ where: { id: caseId } });
      if (!existing) {
        throwCoded('NOT_FOUND', `Development case ${caseId} not found`, 404);
      }
      if (existing.deletedAt) {
        throwCoded('ALREADY_DELETED', `Development case ${caseId} is already deleted`, 409);
      }
      // A4: 已转订单的开发单不可删除。linkedOrderId 非空即已转订单锚点，
      // 覆盖两种形态：convert 流程转单（stage=approved + linkedOrderId）与
      // 存量 stage='已确认' && linkedOrderId 数据（二者均以 linkedOrderId 为锚）。
      // 注：409 语义码复用 ALREADY_DELETED —— DELETE 路由 statusCodeMap 仅将该码映射为 409，
      // 新增专用码需连带 route.ts 映射与 agent/developmentCreateFlow.ts 穷举 Record（超出本修复租约）。
      if (existing.linkedOrderId) {
        throwCoded('ALREADY_DELETED', '已转订单的开发单不可删除', 409);
      }
      await tx.developmentCase.update({
        where: { id: caseId },
        data: { deletedAt: now, updatedAt: now },
      });
      await deactivateEntityLinks(tx, 'development-case', caseId, now);
      const auditId = await writeRouteAuditLog({
        prisma: tx,
        actorId: actorId || 'api',
        source: 'route:dev-case:delete',
        operation: 'delete_development_case',
        targetType: 'DevelopmentCase',
        targetId: caseId,
        before: { id: caseId, deletedAt: null },
        after: { id: caseId, deletedAt: Number(now) },
        ip: ip || null,
      });
      return { case: { id: caseId }, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e?.code && typeof e.code === 'string' && !e.code.startsWith('P')) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    return { ok: false, error: { code: 'DELETE_FAILED', message: `Delete transaction failed: ${String(e?.message ?? e)}` } };
  }
}
