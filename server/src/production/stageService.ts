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
import { createNotificationService } from '../notifications/notificationService';
import { logger } from '../lib/logger';

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

export interface ProductionBoardItem {
  order: {
    id: string;
    poNumber: string | null;
    customer: string;
    quantity: number;
    status: string;
    dueDate: string;
    businessLine: string | null;
    merchandiser: string | null;
    millName: string | null;
  };
  stages: Array<{ stageKey: string; stageSeq: number; status: string }>;
  /** 第一个非 done 阶段（全部完成时为 null） */
  currentStageKey: string | null;
  blockedCount: number;
}

/**
 * 生产跟单看板聚合（PRD 19.8）：全部在手订单 × 10 阶段泳道。
 * 在手口径：未软删且未交付/未取消（含 Alert 异常单——跟单员最需看见）。
 * 只读聚合，直接查表（与 D3 getOrderContext 同一双轨制原则）。
 */
export async function getProductionBoard(prisma: PrismaClient): Promise<{ items: ProductionBoardItem[] }> {
  const orders = await prisma.order.findMany({
    where: { deletedAt: null, status: { notIn: ['Delivered', 'Cancelled'] } },
    select: {
      id: true, poNumber: true, customer: true, quantity: true, status: true,
      dueDate: true, businessLine: true, merchandiser: true, millName: true,
    },
    orderBy: { dueDate: 'asc' },
    take: 500,
  });
  const orderIds = orders.map(o => o.id);
  let stages = await prisma.productionStage.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, stageKey: true, stageSeq: true, status: true },
    orderBy: { stageSeq: 'asc' },
  });
  // 自愈回填：历史种子/直写库订单未经 create 路由，缺 10 阶段行；看板是在手订单
  // 的唯一全景入口，缺阶段的订单泳道会整体空白。initProductionStages 幂等
  // （upsert + update:{}），仅对零阶段订单触发，随后重查一次。
  const withStages = new Set(stages.map(s => s.orderId));
  const missing = orderIds.filter(id => !withStages.has(id));
  if (missing.length > 0) {
    for (const orderId of missing) {
      await initProductionStages(prisma, orderId).catch(() => {});
    }
    stages = await prisma.productionStage.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, stageKey: true, stageSeq: true, status: true },
      orderBy: { stageSeq: 'asc' },
    });
  }
  const stagesByOrder = new Map<string, Array<{ stageKey: string; stageSeq: number; status: string }>>();
  for (const s of stages) {
    const arr = stagesByOrder.get(s.orderId) ?? [];
    arr.push({ stageKey: s.stageKey, stageSeq: s.stageSeq, status: s.status });
    stagesByOrder.set(s.orderId, arr);
  }
  const items: ProductionBoardItem[] = orders.map(o => {
    const orderStages = stagesByOrder.get(o.id) ?? [];
    const current = orderStages.find(s => s.status !== 'done') ?? null;
    return {
      order: o,
      stages: orderStages,
      currentStageKey: current?.stageKey ?? null,
      blockedCount: orderStages.filter(s => s.status === 'blocked').length,
    };
  });
  return { items };
}

export async function getProductionPipeline(prisma: PrismaClient, orderId: string) {
  const stages = await prisma.productionStage.findMany({
    where: { orderId },
    orderBy: { stageSeq: 'asc' },
  });
  const checklist = await prisma.preCutChecklist.findUnique({ where: { orderId } });
  // Phase B4：终期验货报告是 qc_shipped 门禁判据；inspections 返回全部类型报告
  const inspections = await prisma.inspectionReport.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
  });
  const inspection = inspections.find(i => i.inspectionType === 'final') ?? null;

  // 阶段 D / D5：外协只读区块 — 直接查表（production 不反向依赖 mes 服务）。
  // 跟单员在生产跟进视图可见外协进度：加工厂/工序/数量/验收/交期。
  const outsourcingRows = await prisma.outsourcingOrder.findMany({
    where: { orderId, deletedAt: null },
    select: {
      id: true, orderNumber: true, supplierId: true, processType: true, status: true,
      quantity: true, unit: true, plannedDeliveryDate: true, actualDeliveryDate: true,
      qualityAcceptedQty: true, qualityRejectedQty: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const supplierIds = [...new Set(outsourcingRows.map(o => o.supplierId).filter(Boolean))] as string[];
  const supplierRows = supplierIds.length
    ? await prisma.relation.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } })
    : [];
  const supplierNameById = new Map(supplierRows.map(r => [r.id, r.name]));
  const outsourcing = outsourcingRows.map(o => ({
    ...o,
    supplierName: o.supplierId ? supplierNameById.get(o.supplierId) ?? null : null,
    quantity: Number(o.quantity),
    qualityAcceptedQty: Number(o.qualityAcceptedQty),
    qualityRejectedQty: Number(o.qualityRejectedQty),
  }));

  const serializeInspection = (r: any) => ({
    ...r,
    passRate: passRate(r.totalUnits, r.passedUnits),
    defectRate: defectRate(r.totalUnits, r.passedUnits),
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    approvedAt: r.approvedAt ? Number(r.approvedAt) : null,
  });

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
    inspection: inspection ? serializeInspection(inspection) : null,
    inspections: inspections.map(serializeInspection),
    outsourcing,
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
        // Phase B4：门禁仅认终期验货（final）报告
        const inspection = await tx.inspectionReport.findUnique({
          where: { orderId_inspectionType: { orderId, inspectionType: 'final' } },
        });
        if (!inspection) {
          throw Object.assign(new Error('终期验货报告（final）未建立'), { code: 'INSPECTION_NOT_QUALIFIED' });
        }
        if (inspection.result === 'fail') {
          throw Object.assign(new Error('终期验货结论为不合格（fail），需整改复验'), { code: 'INSPECTION_NOT_QUALIFIED' });
        }
        if ((inspection.criticalDefects ?? 0) > 0) {
          throw Object.assign(new Error(`存在 ${inspection.criticalDefects} 个致命疵点（AQL 0 零容忍）`), { code: 'INSPECTION_NOT_QUALIFIED' });
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

export const INSPECTION_TYPES = ['midline', 'final'] as const;
export type InspectionType = typeof INSPECTION_TYPES[number];

export async function saveInspectionReport(prisma: PrismaClient, orderId: string, data: {
  inspectionType?: string;
  totalUnits?: number;
  passedUnits?: number;
  inspectionDate?: string;
  inspectorOrg?: string;
  aqlLevel?: string;
  lotSize?: number;
  sampleSize?: number;
  criticalDefects?: number;
  majorDefects?: number;
  minorDefects?: number;
  defectSummary?: string;
  result?: string;
  shipmentId?: string;
  reportFile?: string;
  inspectedBy?: string;
  approvedByBusiness?: boolean;
  businessApprover?: string;
  notes?: string;
}): Promise<any> {
  const inspectionType: InspectionType = data.inspectionType === 'midline' ? 'midline' : 'final';
  if (data.result !== undefined && data.result !== null && !['pass', 'conditional', 'fail'].includes(data.result)) {
    throw Object.assign(new Error(`非法验货结论: ${data.result}`), { code: 'INVALID_RESULT' });
  }
  // P3c：检验报告（含历史录入路径）必须挂靠有效订单；软删订单同样拒绝。
  // 同时取出 millRelationId/poNumber 供下方 H1c 自动评分复用，避免二次查询。
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, millRelationId: true, poNumber: true, customer: true, product: true },
  });
  if (!order) {
    throw Object.assign(new Error(`订单 ${orderId} 不存在或已删除`), { code: 'ORDER_NOT_FOUND' });
  }
  const now = BigInt(Date.now());
  // final 沿用历史 id 格式（迁移前数据 id=INR__${orderId}），保证 upsert 命中旧行
  const id = inspectionType === 'final' ? `INR__${orderId}` : `INR__${orderId}__${inspectionType}`;
  // PRD 7.1「终期验货 fail」状态迁移判据：upsert 前取旧结论，仅 fail 迁移瞬间通知一次
  const previous = await prisma.inspectionReport.findUnique({
    where: { orderId_inspectionType: { orderId, inspectionType } },
    select: { result: true },
  });
  const result = await prisma.inspectionReport.upsert({
    where: { orderId_inspectionType: { orderId, inspectionType } },
    create: {
      id,
      orderId,
      inspectionType,
      totalUnits: data.totalUnits ?? 0,
      passedUnits: data.passedUnits ?? 0,
      inspectionDate: data.inspectionDate || null,
      inspectorOrg: data.inspectorOrg || null,
      aqlLevel: data.aqlLevel || null,
      lotSize: data.lotSize ?? null,
      sampleSize: data.sampleSize ?? null,
      criticalDefects: data.criticalDefects ?? 0,
      majorDefects: data.majorDefects ?? 0,
      minorDefects: data.minorDefects ?? 0,
      defectSummary: data.defectSummary || null,
      result: data.result || null,
      shipmentId: data.shipmentId || null,
      reportFile: data.reportFile || null,
      inspectedBy: data.inspectedBy || null,
      approvedByBusiness: data.approvedByBusiness ?? false,
      businessApprover: data.businessApprover || null,
      approvedAt: data.approvedByBusiness ? now : null,
      notes: data.notes || null,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      ...(data.totalUnits !== undefined ? { totalUnits: data.totalUnits } : {}),
      ...(data.passedUnits !== undefined ? { passedUnits: data.passedUnits } : {}),
      ...(data.inspectionDate !== undefined ? { inspectionDate: data.inspectionDate || null } : {}),
      ...(data.inspectorOrg !== undefined ? { inspectorOrg: data.inspectorOrg || null } : {}),
      ...(data.aqlLevel !== undefined ? { aqlLevel: data.aqlLevel || null } : {}),
      ...(data.lotSize !== undefined ? { lotSize: data.lotSize } : {}),
      ...(data.sampleSize !== undefined ? { sampleSize: data.sampleSize } : {}),
      ...(data.criticalDefects !== undefined ? { criticalDefects: data.criticalDefects } : {}),
      ...(data.majorDefects !== undefined ? { majorDefects: data.majorDefects } : {}),
      ...(data.minorDefects !== undefined ? { minorDefects: data.minorDefects } : {}),
      ...(data.defectSummary !== undefined ? { defectSummary: data.defectSummary || null } : {}),
      ...(data.result !== undefined ? { result: data.result || null } : {}),
      ...(data.shipmentId !== undefined ? { shipmentId: data.shipmentId || null } : {}),
      ...(data.reportFile !== undefined ? { reportFile: data.reportFile } : {}),
      ...(data.inspectedBy !== undefined ? { inspectedBy: data.inspectedBy } : {}),
      ...(data.approvedByBusiness !== undefined ? { approvedByBusiness: data.approvedByBusiness, approvedAt: data.approvedByBusiness ? now : null } : {}),
      ...(data.businessApprover !== undefined ? { businessApprover: data.businessApprover } : {}),
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      updatedAt: now,
    },
  });

  // H1c：验货结论 → 自动追加质量评分（幂等：同报告只评一次；无档案供应商静默跳过）
  // 评挂钩对象：订单的 millRelationId（面料厂/供应商身份真源在 Relation → FactoryProfile 1:1）
  if (result.result) {
    try {
      if (order.millRelationId) {
        const { createFactoryService, inspectionScoreForResult } = await import('../suppliers/factoryService');
        const factoryService = createFactoryService(prisma);
        const critical = result.criticalDefects ?? 0;
        const score = inspectionScoreForResult(result.result, critical);
        await factoryService.recordAutoEvaluation({
          relationId: order.millRelationId,
          kind: 'inspection',
          score,
          sourceType: 'inspectionReport',
          sourceId: result.id,
          evaluatedAt: result.inspectionDate || new Date().toISOString().slice(0, 10),
          note: `验货报告 ${result.id}（订单 ${order.poNumber || orderId}）结论 ${result.result}${critical > 0 ? `，致命疵点 ${critical}` : ''}`,
          actorId: data.inspectedBy || 'system',
        });
      }
    } catch (e: any) {
      logger.warn('[StageService] inspection auto-evaluation failed (non-blocking)', { error: e?.message });
    }
  }

  // PRD 7.1「终期验货 fail」：结论迁移为非 fail → fail 瞬间广播 critical（QC + 业务员 + 管理层）
  // 状态迁移触发天然幂等：重复保存相同 fail 结论不再通知；整改后再次 fail 属新事件，重新通知
  if (inspectionType === 'final' && result.result === 'fail' && previous?.result !== 'fail') {
    try {
      const notificationService = createNotificationService(prisma);
      const label = order.poNumber || orderId;
      const critical = result.criticalDefects ?? 0;
      const major = result.majorDefects ?? 0;
      const minor = result.minorDefects ?? 0;
      await notificationService.broadcastNotification({
        type: 'inspection_fail',
        title: `订单 ${label} 终期验货不通过（critical=${critical}, major=${major}）`,
        body: `订单 ${label}（客户 ${order.customer ?? '未指定'}，产品 ${order.product ?? '未指定'}）终期验货结论为不合格：致命疵点 ${critical}、主要疵点 ${major}、次要疵点 ${minor}${result.defectSummary ? `，疵点摘要：${result.defectSummary}` : ''}。该订单出运门禁已锁定，需整改复验合格后方可放行。`,
        level: 'critical',
        link: `/production?orderId=${orderId}`,
        metadata: { entityType: 'InspectionReport', entityId: result.id, orderId, criticalDefects: critical, majorDefects: major, minorDefects: minor },
      });
    } catch (e: any) {
      logger.warn('[StageService] inspection fail notification failed (non-blocking)', { error: e?.message });
    }
  }

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
