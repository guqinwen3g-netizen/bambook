/**
 * garmentSampleGateService.ts — 服装样品多轮双门禁服务（DR-008 / DR-029）
 *
 * 设计真源：
 *   - DR-008：样品开发是可循环链，不限轮数。每轮必须记录目的、版本、材料/工艺配置、
 *     QC 结论、客户意见、修改项与证据。内部门禁：每轮样品须先经内部 QC 通过，才允许
 *     提交客户。客户确认：客户不登录系统，业务员登记确认结果/日期/渠道/证据；QC 通过后
 *     可直接登记确认并封存产前样（不加主管审批）。封样不可变：封存产前样为生产基准，
 *     任何后续改动须产生新样品版本，并重新 QC、客户确认、封存。
 *   - DR-029 服装链：工厂每轮产前样先交服装 QC 评审；客户不通过→业务员反馈工厂→
 *     新样必须重新 QC 评审后才可再寄客户。
 *   - DR-039：每次寄送独立记录（快递商/单号/日期/收件方 + 随附单据）。
 *
 * 存储约束（schema 冻结，本轨不得新增模型）：
 *   - 多轮样品记录存于 DevelopmentCase.attachments.garmentSampleGate（JSON，保留其他键，
 *     read-modify-write + $transaction）；既有键（如前端附件）不受影响；
 *   - QC 结论引用 InspectionReport（qcInspectionReportId）——QC 域记录只读引用，本服务不写；
 *   - 封存收口投影：seal 时调用 development/sampleNodeService.markSampleNodeSealedApproved
 *     将 pp 节点推进 approved（生产放行/开裁前置的既有消费点不变）。
 */

import type { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { markSampleNodeSealedApproved } from '../development/sampleNodeService';
import { isYmd, todayYmd } from './fabricShipmentSampleService';

// ────────────────────────────────────────────────────────────────────
// 常量与类型
// ────────────────────────────────────────────────────────────────────

/** 轮次状态机：in_progress →(QC通过)→ qc_passed →(提交客户)→ submitted →(客户approved)→ confirmed →(封存)→ sealed
 *                                        ↑                                  ↘(客户不通过)→ rejected（该轮终止，改动须开新轮）
 *   sealed 轮次在新轮封存时转为 superseded（内容不可变，仅标记不再是当前生产基准）。
 */
export const GARMENT_ROUND_STATUSES = [
  'in_progress',
  'qc_passed',
  'submitted',
  'confirmed',
  'sealed',
  'superseded',
  'rejected',
] as const;
export type GarmentRoundStatus = (typeof GARMENT_ROUND_STATUSES)[number];

export const GARMENT_QC_RESULTS = ['passed', 'failed'] as const;
export const GARMENT_CONFIRM_RESULTS = ['approved', 'rejected', 'needs_revision'] as const;

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; status: number } };

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}
type Failure = { ok: false; error: { code: string; message: string; status: number } };
function fail(code: string, message: string, status = 400): Failure {
  return { ok: false, error: { code, message, status } };
}

// ────────────────────────────────────────────────────────────────────
// 存储辅助（DevelopmentCase.attachments.garmentSampleGate）
// ────────────────────────────────────────────────────────────────────

interface GarmentGateState {
  rounds: any[];
  sealedRoundId: string | null;
}

function readGate(caseRow: any): GarmentGateState {
  const att = caseRow?.attachments && typeof caseRow.attachments === 'object' ? (caseRow.attachments as any) : {};
  const gate = att.garmentSampleGate && typeof att.garmentSampleGate === 'object' ? att.garmentSampleGate : {};
  return {
    rounds: Array.isArray(gate.rounds) ? [...gate.rounds] : [],
    sealedRoundId: gate.sealedRoundId ?? null,
  };
}

function buildAttachments(caseRow: any, gate: GarmentGateState): any {
  const att = caseRow?.attachments && typeof caseRow.attachments === 'object' && !Array.isArray(caseRow.attachments)
    ? { ...(caseRow.attachments as any) }
    : {};
  return {
    ...att,
    garmentSampleGate: {
      rounds: gate.rounds,
      sealedRoundId: gate.sealedRoundId,
      roundIds: gate.rounds.map((r: any) => r.id),
    },
  };
}

async function findGarmentCase(prisma: PrismaClient, caseId: string): Promise<Result<{ devCase: any }>> {
  const devCase = await prisma.developmentCase.findFirst({ where: { id: caseId, deletedAt: null } });
  if (!devCase) return fail('NOT_FOUND', `开发单 ${caseId} 不存在`, 404);
  if (String(devCase.type) !== 'garment') {
    return fail('NOT_GARMENT_CASE', `开发单 ${caseId} 类型为 ${devCase.type}，多轮双门禁仅适用于服装（garment）样品链（DR-008/DR-029 强制边界）`, 400);
  }
  return ok({ devCase });
}

async function findCaseByRoundId(prisma: PrismaClient, roundId: string): Promise<Result<{ devCase: any; round: any }>> {
  const devCase = await (prisma.developmentCase as any).findFirst({
    where: {
      deletedAt: null,
      attachments: { path: ['garmentSampleGate', 'roundIds'], array_contains: [roundId] },
    },
  });
  if (!devCase) return fail('NOT_FOUND', `样品轮次 ${roundId} 不存在`, 404);
  const gate = readGate(devCase);
  const round = gate.rounds.find((r: any) => r.id === roundId);
  if (!round) return fail('NOT_FOUND', `样品轮次 ${roundId} 不存在`, 404);
  return ok({ devCase, round });
}

/** 封样不可变守卫：sealed/superseded 轮次内容不可再改（只会返回失败分支） */
function assertRoundMutable(round: any): Failure | null {
  if (round.status === 'sealed' || round.status === 'superseded') {
    return fail(
      'SEALED_IMMUTABLE',
      '封存产前样为不可变生产基准：任何改动必须产生新样品版本，并重新走 QC→客户确认→封存链（DR-008）',
      409,
    );
  }
  return null;
}

async function persistGate(tx: any, devCase: any, gate: GarmentGateState): Promise<void> {
  await tx.developmentCase.update({
    where: { id: devCase.id },
    data: { attachments: buildAttachments(devCase, gate), updatedAt: BigInt(Date.now()) },
  });
}

// ────────────────────────────────────────────────────────────────────
// 输入类型
// ────────────────────────────────────────────────────────────────────

export interface CreateGarmentRoundInput {
  purpose: string;          // 必填：本轮目的
  version: string;          // 必填：客户侧版本号（V1/V2/...）
  materialConfig: string;   // 必填：材料/工艺配置
  notes?: string;
  evidence?: any[];         // 证据（图片/文件引用）
}

export interface SubmitQcConclusionInput {
  result: 'passed' | 'failed';      // 必填：QC 评审结论
  qcInspectionReportId?: string;    // QC 结论引用（InspectionReport，QC 域只读）
  qcNote?: string;                  // QC 内部评审意见（不做机械二值压缩）
}

export interface SubmitToCustomerInput {
  sentDate?: string;          // 默认今天
  courier: string;            // 必填（DR-039）
  trackingNumber: string;     // 必填
  recipientName: string;      // 必填：收件方
  recipientContact?: string;
  documents?: any[];          // 随附单据
}

export interface RegisterGarmentConfirmationInput {
  result: 'approved' | 'rejected' | 'needs_revision';
  confirmationDate: string;   // 必填
  channel: string;            // 必填：确认渠道
  note?: string;              // 客户意见
  modifications?: string[];   // 修改项
  evidence?: any[];           // 证据
}

// ────────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────────

export function createGarmentSampleGateService(opts: { prisma: PrismaClient }) {
  const { prisma } = opts;

  /** 创建新一轮样品（目的/版本/材料工艺配置必填；不限轮数） */
  async function createRound(params: {
    caseId: string;
    input: CreateGarmentRoundInput;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ round: any }>> {
    const { caseId, input, actorId, ip } = params;
    if (!input || typeof input !== 'object') return fail('INVALID_INPUT', '请求体必填');
    if (!input.purpose || !String(input.purpose).trim()) return fail('INVALID_INPUT', 'purpose（本轮目的）必填（DR-008 每轮记录）');
    if (!input.version || !String(input.version).trim()) return fail('INVALID_INPUT', 'version（客户侧版本号）必填（DR-008 每轮记录）');
    if (!input.materialConfig || !String(input.materialConfig).trim()) return fail('INVALID_INPUT', 'materialConfig（材料/工艺配置）必填（DR-008 每轮记录）');

    const caseR = await findGarmentCase(prisma, caseId);
    if (!caseR.ok) return caseR;
    const { devCase } = caseR.data;

    const now = Date.now();
    try {
      const round = await (prisma as any).$transaction(async (tx: any) => {
        const gate = readGate(devCase);
        const seq = gate.rounds.length + 1;
        const record = {
          id: `GSR__${caseId}__${seq}_${Math.random().toString(36).slice(2, 6)}`,
          developmentCaseId: caseId,
          round: seq,
          purpose: String(input.purpose),
          version: String(input.version),
          materialConfig: String(input.materialConfig),
          // QC 门禁
          qcStatus: 'none',
          qcInspectionReportId: null,
          qcReviewedBy: null,
          qcReviewedAt: null,
          qcNote: null,
          // 提交客户
          submittedAt: null,
          submittedBy: null,
          shipment: null,
          // 客户确认
          customerStatus: 'pending',
          confirmation: null,
          modifications: [],
          evidence: Array.isArray(input.evidence) ? input.evidence : [],
          notes: input.notes ?? null,
          // 状态机
          status: 'in_progress',
          sealedAt: null,
          sealedBy: null,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        };
        gate.rounds.push(record);
        await persistGate(tx, devCase, gate);
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:garment-gate',
          operation: 'create_garment_sample_round',
          targetType: 'DevelopmentCase',
          targetId: caseId,
          after: { roundId: record.id, round: seq, version: record.version, purpose: record.purpose },
          ip: ip ?? null,
        });
        return record;
      });
      logger.info('[GarmentGate] 样品轮次已创建', { caseId, roundId: round.id, actorId });
      return ok({ round });
    } catch (e: any) {
      return fail('CREATE_FAILED', `样品轮次创建失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /** QC 评审结论登记（DR-029：QC 直接在系统填写内部评审意见；引用 InspectionReport 只读校验） */
  async function submitQcConclusion(params: {
    roundId: string;
    input: SubmitQcConclusionInput;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ round: any }>> {
    const { roundId, input, actorId, ip } = params;
    if (!input || typeof input !== 'object') return fail('INVALID_INPUT', '请求体必填');
    if (!(GARMENT_QC_RESULTS as readonly string[]).includes(String(input.result))) {
      return fail('INVALID_INPUT', 'result 必须是 passed | failed');
    }

    if (input.qcInspectionReportId) {
      const report = await prisma.inspectionReport.findUnique({ where: { id: input.qcInspectionReportId } });
      if (!report) return fail('QC_REPORT_NOT_FOUND', `QC 结论引用 ${input.qcInspectionReportId} 不存在（InspectionReport 由 QC 域维护，仅可引用）`, 400);
    }

    const found = await findCaseByRoundId(prisma, roundId);
    if (!found.ok) return found;
    const { devCase, round } = found.data;

    const immutable = assertRoundMutable(round);
    if (immutable) return immutable;
    if (!['in_progress', 'qc_passed'].includes(round.status)) {
      return fail('INVALID_TRANSITION', `当前轮次状态 ${round.status} 不允许登记 QC 结论（已提交客户后须由客户确认链推进）`, 409);
    }

    const now = Date.now();
    try {
      const updated = await (prisma as any).$transaction(async (tx: any) => {
        const gate = readGate(devCase);
        const target = gate.rounds.find((r: any) => r.id === roundId);
        target.qcStatus = input.result;
        target.qcInspectionReportId = input.qcInspectionReportId ?? target.qcInspectionReportId ?? null;
        target.qcReviewedBy = actorId;
        target.qcReviewedAt = now;
        target.qcNote = input.qcNote ?? null;
        target.status = input.result === 'passed' ? 'qc_passed' : 'in_progress'; // failed → 工厂重做后重新送 QC
        target.updatedAt = now;
        await persistGate(tx, devCase, gate);
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:garment-gate',
          operation: 'submit_garment_sample_qc',
          targetType: 'DevelopmentCase',
          targetId: devCase.id,
          before: { roundId, qcStatus: round.qcStatus, status: round.status },
          after: { roundId, qcStatus: input.result, status: target.status, qcInspectionReportId: target.qcInspectionReportId },
          ip: ip ?? null,
        });
        return target;
      });
      return ok({ round: updated });
    } catch (e: any) {
      return fail('UPDATE_FAILED', `QC 结论登记失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /** 提交客户（内部门禁 fail-closed：QC 未通过 → 409）+ DR-039 寄送记录 */
  async function submitToCustomer(params: {
    roundId: string;
    input: SubmitToCustomerInput;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ round: any }>> {
    const { roundId, input, actorId, ip } = params;
    if (!input || typeof input !== 'object') return fail('INVALID_INPUT', '请求体必填');
    if (!input.courier || !String(input.courier).trim()) return fail('INVALID_INPUT', 'courier（快递服务商）必填（DR-039）');
    if (!input.trackingNumber || !String(input.trackingNumber).trim()) return fail('INVALID_INPUT', 'trackingNumber（快递单号）必填（DR-039）');
    if (!input.recipientName || !String(input.recipientName).trim()) return fail('INVALID_INPUT', 'recipientName（收件方）必填（DR-039）');
    if (input.sentDate !== undefined && input.sentDate !== '' && !isYmd(input.sentDate)) {
      return fail('INVALID_INPUT', 'sentDate 格式须为 YYYY-MM-DD');
    }

    const found = await findCaseByRoundId(prisma, roundId);
    if (!found.ok) return found;
    const { devCase, round } = found.data;

    const immutable = assertRoundMutable(round);
    if (immutable) return immutable;
    // DR-008 内部门禁（fail-closed）：内部 QC 通过才允许提交客户
    if (round.qcStatus !== 'passed' || round.status !== 'qc_passed') {
      return fail('QC_GATE_NOT_PASSED', '内部 QC 未通过，禁止提交客户（DR-008 内部门禁，fail-closed）', 409);
    }

    const now = Date.now();
    const sentDate = input.sentDate || todayYmd();
    try {
      const updated = await (prisma as any).$transaction(async (tx: any) => {
        const gate = readGate(devCase);
        const target = gate.rounds.find((r: any) => r.id === roundId);
        target.status = 'submitted';
        target.submittedAt = now;
        target.submittedBy = actorId;
        target.shipment = {
          sentDate,
          courier: String(input.courier),
          trackingNumber: String(input.trackingNumber),
          recipientName: String(input.recipientName),
          recipientContact: input.recipientContact ?? null,
          documents: Array.isArray(input.documents) ? input.documents : [],
        };
        target.updatedAt = now;
        await persistGate(tx, devCase, gate);
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:garment-gate',
          operation: 'submit_garment_sample_to_customer',
          targetType: 'DevelopmentCase',
          targetId: devCase.id,
          before: { roundId, status: round.status },
          after: { roundId, status: 'submitted', sentDate, courier: input.courier, trackingNumber: input.trackingNumber },
          ip: ip ?? null,
        });
        return target;
      });
      return ok({ round: updated });
    } catch (e: any) {
      return fail('UPDATE_FAILED', `提交客户失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /** 客户确认登记（业务员登记结果/日期/渠道/修改项/证据；不加主管审批，DR-008） */
  async function registerCustomerConfirmation(params: {
    roundId: string;
    input: RegisterGarmentConfirmationInput;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ round: any }>> {
    const { roundId, input, actorId, ip } = params;
    if (!input || typeof input !== 'object') return fail('INVALID_INPUT', '请求体必填');
    if (!(GARMENT_CONFIRM_RESULTS as readonly string[]).includes(String(input.result))) {
      return fail('INVALID_INPUT', 'result 必须是 approved | rejected | needs_revision');
    }
    if (!isYmd(input.confirmationDate)) return fail('INVALID_INPUT', 'confirmationDate 必填，格式 YYYY-MM-DD');
    if (!input.channel || !String(input.channel).trim()) return fail('INVALID_INPUT', 'channel（确认渠道）必填：客户不登录系统，须登记渠道（DR-008）');

    const found = await findCaseByRoundId(prisma, roundId);
    if (!found.ok) return found;
    const { devCase, round } = found.data;

    const immutable = assertRoundMutable(round);
    if (immutable) return immutable;
    if (round.status !== 'submitted') {
      return fail('INVALID_TRANSITION', `当前轮次状态 ${round.status} 不允许登记客户确认（须先提交客户）`, 409);
    }

    const now = Date.now();
    const approved = input.result === 'approved';
    try {
      const updated = await (prisma as any).$transaction(async (tx: any) => {
        const gate = readGate(devCase);
        const target = gate.rounds.find((r: any) => r.id === roundId);
        target.customerStatus = input.result;
        target.confirmation = {
          result: input.result,
          date: input.confirmationDate,
          channel: String(input.channel),
          note: input.note ?? null,
          evidence: Array.isArray(input.evidence) ? input.evidence : [],
          registeredBy: actorId,
          registeredAt: now,
        };
        target.modifications = Array.isArray(input.modifications) ? input.modifications.map(String) : [];
        // approved → 待封存；rejected/needs_revision → 该轮终止，改动须开新轮重走 QC（DR-029 闭环）
        target.status = approved ? 'confirmed' : 'rejected';
        target.updatedAt = now;
        await persistGate(tx, devCase, gate);
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:garment-gate',
          operation: 'confirm_garment_sample',
          targetType: 'DevelopmentCase',
          targetId: devCase.id,
          before: { roundId, status: round.status, customerStatus: round.customerStatus },
          after: { roundId, status: target.status, customerStatus: input.result, channel: input.channel, confirmationDate: input.confirmationDate },
          ip: ip ?? null,
        });
        return target;
      });
      return ok({ round: updated });
    } catch (e: any) {
      return fail('UPDATE_FAILED', `客户确认登记失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /**
   * 封存产前样（封样不可变；QC 通过 + 客户确认后业务员直接封存，不加主管审批——DR-008）。
   * 新轮封存时旧封存轮次转 superseded（内容不可变，仅不再是当前生产基准）。
   * 收口投影：pp 样衣节点推进 approved（生产放行/开裁前置的既有消费点）。
   */
  async function sealRound(params: {
    roundId: string;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ round: any }>> {
    const { roundId, actorId, ip } = params;

    const found = await findCaseByRoundId(prisma, roundId);
    if (!found.ok) return found;
    const { devCase, round } = found.data;

    const immutable = assertRoundMutable(round);
    if (immutable) return immutable;
    if (round.status !== 'confirmed') {
      return fail(
        'SEAL_REQUIRES_CONFIRMED',
        `封存产前样须先完成双门禁：内部 QC 通过 + 客户确认已登记（当前状态 ${round.status}，QC ${round.qcStatus}）`,
        409,
      );
    }

    const now = Date.now();
    try {
      const updated = await (prisma as any).$transaction(async (tx: any) => {
        const gate = readGate(devCase);
        // 旧封存轮次 → superseded（内容不可变，历史基准保留）
        if (gate.sealedRoundId) {
          const prev = gate.rounds.find((r: any) => r.id === gate.sealedRoundId);
          if (prev && prev.status === 'sealed') {
            prev.status = 'superseded';
            prev.updatedAt = now;
          }
        }
        const target = gate.rounds.find((r: any) => r.id === roundId);
        target.status = 'sealed';
        target.sealedAt = now;
        target.sealedBy = actorId;
        target.updatedAt = now;
        gate.sealedRoundId = roundId;
        await persistGate(tx, devCase, gate);

        // 封样收口投影：pp 样衣节点 → approved（幂等；既有生产放行消费点不变）
        const nodeR = await markSampleNodeSealedApproved({
          prisma: tx,
          caseId: devCase.id,
          level: 'pp',
          approvedBy: actorId,
          feedback: `封存产前样 ${target.version}（第 ${target.round} 轮）`,
        });
        if (!nodeR.ok) {
          throw Object.assign(new Error(nodeR.error.message), { code: nodeR.error.code });
        }

        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:garment-gate',
          operation: 'seal_garment_preproduction_sample',
          targetType: 'DevelopmentCase',
          targetId: devCase.id,
          before: { roundId, status: round.status, sealedRoundId: round.id },
          after: { roundId, status: 'sealed', sealedRoundId: roundId, ppNodeApproved: true },
          ip: ip ?? null,
        });
        return target;
      });
      logger.info('[GarmentGate] 产前样已封存', { caseId: devCase.id, roundId, actorId });
      return ok({ round: updated });
    } catch (e: any) {
      if (e?.code === 'NOT_FOUND') return fail('NOT_FOUND', e.message, 404);
      return fail('SEAL_FAILED', `封样失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /** 开发单样品轮次列表（含当前封存基准标记） */
  async function listRounds(params: { caseId: string }): Promise<Result<{ items: any[]; sealedRoundId: string | null }>> {
    const devCase = await prisma.developmentCase.findFirst({ where: { id: params.caseId, deletedAt: null } });
    if (!devCase) return fail('NOT_FOUND', `开发单 ${params.caseId} 不存在`, 404);
    const gate = readGate(devCase);
    return ok({ items: gate.rounds, sealedRoundId: gate.sealedRoundId });
  }

  return { createRound, submitQcConclusion, submitToCustomer, registerCustomerConfirmation, sealRound, listRounds };
}

export type GarmentSampleGateService = ReturnType<typeof createGarmentSampleGateService>;
