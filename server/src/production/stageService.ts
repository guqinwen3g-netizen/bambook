/**
 * Production Pipeline Stage Service — 大货十阶段生产管线门禁引擎
 *
 * 业务规定门禁:
 *   ⑥ pre_cut_checked 需 PreCutChecklist 四项全 true
 *   ⑦ pp_sample_approved 需双签（生产部+业务部确认）
 *   ⑩ qc_shipped 需验货 passRate>=90% + defectRate<=3% + 业务部批准
 */

import { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { publishBusinessEvent } from '../events/businessEventBus';

export const PRODUCTION_STAGES = [
  { key: 'order_placed', seq: 1, label: '业务下单' },
  { key: 'materials_confirmed', seq: 2, label: '面辅料确认' },
  { key: 'production_planned', seq: 3, label: '生产计划' },
  { key: 'in_production', seq: 4, label: '货期管理' },
  { key: 'materials_arrived', seq: 5, label: '面辅料到厂' },
  { key: 'pre_cut_checked', seq: 6, label: '裁剪前检查' },
  { key: 'pp_sample_approved', seq: 7, label: '产前样确认' },
  { key: 'manufacturing', seq: 8, label: '生产过程' },
  { key: 'final_review', seq: 9, label: '成品确认' },
  { key: 'qc_shipped', seq: 10, label: '验货发货' },
] as const;

export type StageKey = typeof PRODUCTION_STAGES[number]['key'];

const STAGE_KEYS: string[] = PRODUCTION_STAGES.map(s => s.key);
const STAGE_MAP = new Map<StageKey, typeof PRODUCTION_STAGES[number]>(PRODUCTION_STAGES.map(s => [s.key, s]));

/**
 * 边界处解析 stageKey：将外部 string 输入转换为 StageKey 联合类型。
 * 返回 null 时调用方应直接响应 INVALID_STAGE。
 */
export function parseStageKey(input: string): StageKey | null {
  return STAGE_KEYS.includes(input) ? (input as StageKey) : null;
}

const MIN_PASS_RATE = 0.90;
const MAX_DEFECT_RATE = 0.03;

export type StageGateErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'INVALID_STAGE'
  | 'STAGE_NOT_SEQUENTIAL'
  | 'PRECUT_CHECKLIST_INCOMPLETE'
  | 'PP_SAMPLE_NOT_SIGNED'
  | 'INSPECTION_NOT_QUALIFIED'
  | 'BUSINESS_APPROVAL_REQUIRED'
  | 'STAGE_UPDATE_FAILED';

function passRate(total: number, passed: number): number {
  if (total <= 0) return 0;
  return passed / total;
}

function defectRate(total: number, passed: number): number {
  if (total <= 0) return 0;
  return (total - passed) / total;
}

export async function initProductionStages(prisma: PrismaClient, orderId: string): Promise<void> {
  const now = BigInt(Date.now());
  for (const stage of PRODUCTION_STAGES) {
    await prisma.productionStage.upsert({
      where: { orderId_stageKey: { orderId, stageKey: stage.key } },
      create: {
        id: `PST__${orderId}__${stage.key}`,
        orderId,
        stageKey: stage.key,
        stageSeq: stage.seq,
        status: stage.seq === 1 ? 'done' : 'pending',
        doneAt: stage.seq === 1 ? now : null,
        createdAt: now,
        updatedAt: now,
      },
      update: {},
    });
  }
}

export async function getProductionPipeline(prisma: PrismaClient, orderId: string) {
  const stages = await prisma.productionStage.findMany({
    where: { orderId },
    orderBy: { stageSeq: 'asc' },
  });
  const checklist = await prisma.preCutChecklist.findUnique({ where: { orderId } });
  const inspection = await prisma.inspectionReport.findUnique({ where: { orderId } });

  return {
    stages: stages.map(s => ({
      ...s,
      createdAt: Number(s.createdAt),
      updatedAt: Number(s.updatedAt),
      startedAt: s.startedAt ? Number(s.startedAt) : null,
      doneAt: s.doneAt ? Number(s.doneAt) : null,
    })),
    checklist: checklist ? {
      ...checklist,
      createdAt: Number(checklist.createdAt),
      updatedAt: Number(checklist.updatedAt),
      confirmedAt: checklist.confirmedAt ? Number(checklist.confirmedAt) : null,
    } : null,
    inspection: inspection
      ? {
          ...inspection,
          passRate: passRate(inspection.totalUnits, inspection.passedUnits),
          defectRate: defectRate(inspection.totalUnits, inspection.passedUnits),
          createdAt: Number(inspection.createdAt),
          updatedAt: Number(inspection.updatedAt),
          approvedAt: inspection.approvedAt ? Number(inspection.approvedAt) : null,
        }
      : null,
  };
}

export interface AdvanceStageParams {
  prisma: PrismaClient;
  orderId: string;
  stageKey: StageKey;
  operator?: string;
  note?: string;
}

export async function advanceStage(params: AdvanceStageParams): Promise<
  { ok: true; data: { stage: any; auditId: string } } | { ok: false; error: { code: StageGateErrorCode; message: string } }
> {
  const { prisma, orderId, stageKey, operator, note } = params;

  if (!STAGE_MAP.has(stageKey)) {
    return { ok: false, error: { code: 'INVALID_STAGE', message: `Invalid stage: ${stageKey}` } };
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const order = await tx.order.findFirst({ where: { id: orderId, deletedAt: null } });
      if (!order) {
        throw Object.assign(new Error(`Order ${orderId} not found`), { code: 'ORDER_NOT_FOUND' });
      }

      const stage = await tx.productionStage.findUnique({
        where: { orderId_stageKey: { orderId, stageKey } },
      });
      if (!stage) {
        throw Object.assign(new Error(`Stage ${stageKey} not initialized`), { code: 'INVALID_STAGE' });
      }
      if (stage.status === 'done') {
        throw Object.assign(new Error(`Stage ${stageKey} already done`), { code: 'STAGE_NOT_SEQUENTIAL' });
      }

      const prevStages = await tx.productionStage.findMany({
        where: { orderId, stageSeq: { lt: stage.stageSeq } },
        orderBy: { stageSeq: 'asc' },
      });
      const incompletePrev = prevStages.find((s: any) => s.status !== 'done');
      if (incompletePrev) {
        throw Object.assign(
          new Error(`Previous stage not done: ${incompletePrev.stageKey}`),
          { code: 'STAGE_NOT_SEQUENTIAL' },
        );
      }

      if (stageKey === 'pre_cut_checked') {
        const checklist = await tx.preCutChecklist.findUnique({ where: { orderId } });
        if (!checklist) {
          throw Object.assign(new Error('PreCutChecklist not found'), { code: 'PRECUT_CHECKLIST_INCOMPLETE' });
        }
        if (!checklist.gradingConfirmed || !checklist.consumptionConfirmed || !checklist.patternConfirmed || !checklist.preProductionMeeting) {
          const missing: string[] = [];
          if (!checklist.gradingConfirmed) missing.push('推码确认');
          if (!checklist.consumptionConfirmed) missing.push('耗料确认');
          if (!checklist.patternConfirmed) missing.push('样板确认');
          if (!checklist.preProductionMeeting) missing.push('产前会议');
          throw Object.assign(new Error(`裁剪前检查未完成: ${missing.join('、')}`), { code: 'PRECUT_CHECKLIST_INCOMPLETE' });
        }
      }

      if (stageKey === 'pp_sample_approved') {
        if (!stage.signedByProduction || !stage.signedByBusiness) {
          const missing: string[] = [];
          if (!stage.signedByProduction) missing.push('生产部签字');
          if (!stage.signedByBusiness) missing.push('业务部签字');
          throw Object.assign(new Error(`产前样需双签确认: 缺少 ${missing.join('、')}`), { code: 'PP_SAMPLE_NOT_SIGNED' });
        }
      }

      if (stageKey === 'qc_shipped') {
        const inspection = await tx.inspectionReport.findUnique({ where: { orderId } });
        if (!inspection) {
          throw Object.assign(new Error('InspectionReport not found'), { code: 'INSPECTION_NOT_QUALIFIED' });
        }
        const pr = passRate(inspection.totalUnits, inspection.passedUnits);
        const dr = defectRate(inspection.totalUnits, inspection.passedUnits);
        if (pr < MIN_PASS_RATE) {
          throw Object.assign(new Error(`合格率 ${(pr * 100).toFixed(1)}% 低于阈值 90%`), { code: 'INSPECTION_NOT_QUALIFIED' });
        }
        if (dr > MAX_DEFECT_RATE) {
          throw Object.assign(new Error(`不合格率 ${(dr * 100).toFixed(1)}% 超过上限 3%`), { code: 'INSPECTION_NOT_QUALIFIED' });
        }
        if (!inspection.approvedByBusiness) {
          throw Object.assign(new Error('需业务部批准发货'), { code: 'BUSINESS_APPROVAL_REQUIRED' });
        }
      }

      const now = BigInt(Date.now());
      const updated = await tx.productionStage.update({
        where: { id: stage.id },
        data: { status: 'done', doneAt: now, operator: operator || null, note: note || stage.note, updatedAt: now },
      });

      const auditId = await writeRouteAuditLog({
        prisma: tx,
        actorId: operator || 'api',
        source: 'route:production:advance',
        operation: 'advance_production_stage',
        targetType: 'ProductionStage',
        targetId: stage.id,
        before: { status: stage.status },
        after: { status: 'done', stageKey },
      });

      return {
        stage: {
          ...updated,
          createdAt: Number(updated.createdAt),
          updatedAt: Number(updated.updatedAt),
          doneAt: updated.doneAt ? Number(updated.doneAt) : null,
        },
        auditId,
      };
    });

    // Phase 0 Sprint 1: 生产阶段推进事件（事务提交后发布，fire-and-forget）
    // - ProductionStageAdvanced：每次阶段完成都发布
    // - ProductionCompleted：qc_shipped 阶段（第 10 阶段，最终验货发货）完成时发布
    //   用于 Phase 1 Sprint 3 触发自动创建发货单联动
    const stageLabel = STAGE_MAP.get(stageKey)?.label || stageKey;
    publishBusinessEvent({
      type: 'ProductionStageAdvanced',
      sourceEntityType: 'ProductionStage',
      sourceEntityId: result.stage.id,
      orderId,
      payload: { stageKey, stageLabel, operator: operator || 'api', auditId: result.auditId },
      actorId: operator || 'api',
      transactionId: result.auditId,
    }).catch(() => { /* event publish failure must not fail business */ });

    if (stageKey === 'qc_shipped') {
      publishBusinessEvent({
        type: 'ProductionCompleted',
        sourceEntityType: 'ProductionStage',
        sourceEntityId: result.stage.id,
        orderId,
        payload: { stageKey, stageLabel, completedAt: Number(result.stage.doneAt), auditId: result.auditId },
        actorId: operator || 'api',
        transactionId: result.auditId,
      }).catch(() => { /* event publish failure must not fail business */ });
    }
    return { ok: true, data: result };
  } catch (e: any) {
    const GATE_ERROR_CODES: Set<string> = new Set([
      'ORDER_NOT_FOUND', 'INVALID_STAGE', 'STAGE_NOT_SEQUENTIAL',
      'PRECUT_CHECKLIST_INCOMPLETE', 'PP_SAMPLE_NOT_SIGNED',
      'INSPECTION_NOT_QUALIFIED', 'BUSINESS_APPROVAL_REQUIRED',
    ]);
    if (GATE_ERROR_CODES.has(e.code)) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    return { ok: false, error: { code: 'STAGE_UPDATE_FAILED', message: String(e?.message ?? e) } };
  }
}

export async function savePreCutChecklist(prisma: PrismaClient, orderId: string, data: {
  gradingConfirmed?: boolean;
  consumptionConfirmed?: boolean;
  patternConfirmed?: boolean;
  preProductionMeeting?: boolean;
  meetingNote?: string;
  confirmedBy?: string;
}): Promise<any> {
  const now = BigInt(Date.now());
  const result = await prisma.preCutChecklist.upsert({
    where: { orderId },
    create: {
      id: `PCL__${orderId}`,
      orderId,
      gradingConfirmed: data.gradingConfirmed ?? false,
      consumptionConfirmed: data.consumptionConfirmed ?? false,
      patternConfirmed: data.patternConfirmed ?? false,
      preProductionMeeting: data.preProductionMeeting ?? false,
      meetingNote: data.meetingNote || null,
      confirmedBy: data.confirmedBy || null,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      ...(data.gradingConfirmed !== undefined ? { gradingConfirmed: data.gradingConfirmed } : {}),
      ...(data.consumptionConfirmed !== undefined ? { consumptionConfirmed: data.consumptionConfirmed } : {}),
      ...(data.patternConfirmed !== undefined ? { patternConfirmed: data.patternConfirmed } : {}),
      ...(data.preProductionMeeting !== undefined ? { preProductionMeeting: data.preProductionMeeting } : {}),
      ...(data.meetingNote !== undefined ? { meetingNote: data.meetingNote } : {}),
      ...(data.confirmedBy !== undefined ? { confirmedBy: data.confirmedBy, confirmedAt: now } : {}),
      updatedAt: now,
    },
  });
  return { ...result, createdAt: Number(result.createdAt), updatedAt: Number(result.updatedAt), confirmedAt: result.confirmedAt ? Number(result.confirmedAt) : null };
}

export async function saveInspectionReport(prisma: PrismaClient, orderId: string, data: {
  totalUnits?: number;
  passedUnits?: number;
  reportFile?: string;
  inspectedBy?: string;
  approvedByBusiness?: boolean;
  businessApprover?: string;
}): Promise<any> {
  const now = BigInt(Date.now());
  const result = await prisma.inspectionReport.upsert({
    where: { orderId },
    create: {
      id: `INR__${orderId}`,
      orderId,
      totalUnits: data.totalUnits ?? 0,
      passedUnits: data.passedUnits ?? 0,
      reportFile: data.reportFile || null,
      inspectedBy: data.inspectedBy || null,
      approvedByBusiness: data.approvedByBusiness ?? false,
      businessApprover: data.businessApprover || null,
      approvedAt: data.approvedByBusiness ? now : null,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      ...(data.totalUnits !== undefined ? { totalUnits: data.totalUnits } : {}),
      ...(data.passedUnits !== undefined ? { passedUnits: data.passedUnits } : {}),
      ...(data.reportFile !== undefined ? { reportFile: data.reportFile } : {}),
      ...(data.inspectedBy !== undefined ? { inspectedBy: data.inspectedBy } : {}),
      ...(data.approvedByBusiness !== undefined ? { approvedByBusiness: data.approvedByBusiness, approvedAt: data.approvedByBusiness ? now : null } : {}),
      ...(data.businessApprover !== undefined ? { businessApprover: data.businessApprover } : {}),
      updatedAt: now,
    },
  });
  return {
    ...result,
    passRate: passRate(result.totalUnits, result.passedUnits),
    defectRate: defectRate(result.totalUnits, result.passedUnits),
    createdAt: Number(result.createdAt),
    updatedAt: Number(result.updatedAt),
    approvedAt: result.approvedAt ? Number(result.approvedAt) : null,
  };
}

/**
 * 产前样双签（生产部 / 业务部各签一次）
 */
export async function signStage(params: {
  prisma: PrismaClient;
  orderId: string;
  stageKey: string;
  signType: 'production' | 'business';
  signerId: string;
}): Promise<any> {
  const { prisma, orderId, stageKey, signType, signerId } = params;
  const now = BigInt(Date.now());
  const stage = await prisma.productionStage.findUnique({
    where: { orderId_stageKey: { orderId, stageKey } },
  });
  if (!stage) {
    throw Object.assign(new Error(`Stage ${stageKey} not found`), { code: 'INVALID_STAGE' });
  }

  const data: any = { updatedAt: now };
  if (signType === 'production') {
    data.signedByProduction = signerId;
    data.signedAtProduction = now;
  } else {
    data.signedByBusiness = signerId;
    data.signedAtBusiness = now;
  }

  const updated = await prisma.productionStage.update({
    where: { id: stage.id },
    data,
  });

  return {
    ...updated,
    signedAtProduction: updated.signedAtProduction ? Number(updated.signedAtProduction) : null,
    signedAtBusiness: updated.signedAtBusiness ? Number(updated.signedAtBusiness) : null,
    createdAt: Number(updated.createdAt),
    updatedAt: Number(updated.updatedAt),
    doneAt: updated.doneAt ? Number(updated.doneAt) : null,
  };
}
