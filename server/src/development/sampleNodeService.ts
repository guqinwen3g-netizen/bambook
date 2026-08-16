/**
 * Phase B4 — 三级样衣节点服务（确认样 → 产前样 → 大货样）
 *
 * 状态机：
 *   pending(待打样) → making(制作中) → sent(已寄出) → approved(客户批准)
 *                                                ↘ revising(需修改) → making（round+1）
 *
 * 业务规则：
 *   - 每个 DevelopmentCase 固定三级节点（confirmation / pp / top），ensure 幂等创建；
 *   - approved 为终态（同一级别不可再退回首轮，新一轮需业务新建开发单）；
 *   - 所有状态迁移写审计日志（routeAudit）。
 */

import { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';

export const SAMPLE_NODE_LEVELS = ['confirmation', 'pp', 'top'] as const;
export type SampleNodeLevel = typeof SAMPLE_NODE_LEVELS[number];

export const SAMPLE_NODE_STATUSES = ['pending', 'making', 'sent', 'approved', 'revising'] as const;
export type SampleNodeStatus = typeof SAMPLE_NODE_STATUSES[number];

export type SampleNodeAction = 'start' | 'send' | 'approve' | 'revise';

/** action → (允许的前置状态 → 目标状态)；start 从 revising 进入时 round+1 */
const ACTION_RULES: Record<SampleNodeAction, { from: SampleNodeStatus[]; to: SampleNodeStatus }> = {
  start: { from: ['pending', 'revising'], to: 'making' },
  send: { from: ['making'], to: 'sent' },
  approve: { from: ['sent'], to: 'approved' },
  revise: { from: ['sent', 'making'], to: 'revising' },
};

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function serializeNode(node: any) {
  return {
    ...node,
    createdAt: Number(node.createdAt),
    updatedAt: Number(node.updatedAt),
    deletedAt: node.deletedAt ? Number(node.deletedAt) : null,
    approvedAt: node.approvedAt ? Number(node.approvedAt) : null,
  };
}

async function findLiveCase(prisma: PrismaClient, caseId: string) {
  return prisma.developmentCase.findFirst({ where: { id: caseId, deletedAt: null }, select: { id: true, code: true } });
}

/** 幂等确保三级节点存在；返回全部节点（按级别序） */
export async function ensureSampleNodes(prisma: PrismaClient, caseId: string): Promise<Result<{ nodes: any[] }>> {
  const devCase = await findLiveCase(prisma, caseId);
  if (!devCase) return { ok: false, error: { code: 'NOT_FOUND', message: `开发单 ${caseId} 不存在` } };

  const now = BigInt(Date.now());
  for (const level of SAMPLE_NODE_LEVELS) {
    await prisma.sampleNode.upsert({
      where: { developmentCaseId_level: { developmentCaseId: caseId, level } },
      create: {
        id: `SN__${caseId}__${level}`,
        developmentCaseId: caseId,
        level,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      update: {},
    });
  }
  const nodes = await listSampleNodes(prisma, caseId);
  return { ok: true, data: { nodes } };
}

export async function listSampleNodes(prisma: PrismaClient, caseId: string): Promise<any[]> {
  const nodes = await prisma.sampleNode.findMany({
    where: { developmentCaseId: caseId, deletedAt: null },
  });
  const order = new Map<string, number>(SAMPLE_NODE_LEVELS.map((l, i) => [l, i]));
  return nodes
    .sort((a, b) => (order.get(a.level as SampleNodeLevel) ?? 99) - (order.get(b.level as SampleNodeLevel) ?? 99))
    .map(serializeNode);
}

export interface AdvanceSampleNodeInput {
  action: SampleNodeAction;
  sentDate?: string;
  courier?: string;
  trackingNumber?: string;
  feedback?: string;
  feedbackDate?: string;
  approvedBy?: string;
  notes?: string;
}

/** 推进样衣节点（含状态机校验 + 审计） */
export async function advanceSampleNode(params: {
  prisma: PrismaClient;
  caseId: string;
  level: string;
  input: AdvanceSampleNodeInput;
  actorId: string;
}): Promise<Result<{ node: any }>> {
  const { prisma, caseId, level, input, actorId } = params;

  if (!(SAMPLE_NODE_LEVELS as readonly string[]).includes(level)) {
    return { ok: false, error: { code: 'INVALID_LEVEL', message: `非法样衣级别: ${level}（可选 ${SAMPLE_NODE_LEVELS.join('/')}）` } };
  }
  const rule = ACTION_RULES[input.action];
  if (!rule) {
    return { ok: false, error: { code: 'INVALID_ACTION', message: `非法动作: ${input.action}` } };
  }

  const devCase = await findLiveCase(prisma, caseId);
  if (!devCase) return { ok: false, error: { code: 'NOT_FOUND', message: `开发单 ${caseId} 不存在` } };

  // 节点可能尚未 ensure —— 自动补建后再推进（与 ensure 语义一致，幂等）
  await ensureSampleNodes(prisma, caseId);
  const node = await prisma.sampleNode.findUnique({
    where: { developmentCaseId_level: { developmentCaseId: caseId, level } },
  });
  if (!node || node.deletedAt) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '样衣节点不存在' } };
  }

  const current = node.status as SampleNodeStatus;
  if (!rule.from.includes(current)) {
    return {
      ok: false,
      error: { code: 'INVALID_TRANSITION', message: `当前状态 ${current} 不允许执行 ${input.action}` },
    };
  }

  const now = BigInt(Date.now());
  const data: any = { status: rule.to, updatedAt: now };

  if (input.action === 'start' && current === 'revising') {
    data.round = node.round + 1;
  }
  if (input.action === 'send') {
    data.sentDate = input.sentDate ?? new Date().toISOString().slice(0, 10);
    if (input.courier !== undefined) data.courier = input.courier || null;
    if (input.trackingNumber !== undefined) data.trackingNumber = input.trackingNumber || null;
  }
  if (input.action === 'approve') {
    data.approvedAt = now;
    data.approvedBy = input.approvedBy ?? actorId;
    if (input.feedback !== undefined) data.feedback = input.feedback || null;
    if (input.feedbackDate !== undefined) data.feedbackDate = input.feedbackDate || null;
  }
  if (input.action === 'revise') {
    if (input.feedback !== undefined) data.feedback = input.feedback || null;
    data.feedbackDate = input.feedbackDate ?? new Date().toISOString().slice(0, 10);
    data.approvedAt = null;
    data.approvedBy = null;
  }
  if (input.notes !== undefined) data.notes = input.notes || null;

  const updated = await prisma.sampleNode.update({ where: { id: node.id }, data });

  await writeRouteAuditLog({
    prisma,
    actorId: actorId || 'api',
    source: 'route:development:sample-node',
    operation: 'advance_sample_node',
    targetType: 'SampleNode',
    targetId: node.id,
    before: { status: current, round: node.round },
    after: { status: rule.to, round: updated.round, action: input.action },
  });

  return { ok: true, data: { node: serializeNode(updated) } };
}

// ────────────────────────────────────────────────────────────────────
// DR-008 扩展：封样驱动的节点批准投影（服装样品双门禁收口）
// ────────────────────────────────────────────────────────────────────

/**
 * 封样联动批准（DR-008 双门禁收口投影）。
 *
 * 调用方：samples/garmentSampleGateService.sealRound —— 仅在「内部 QC 通过 + 客户确认
 * 已登记」双门禁均满足、业务员封存产前样后调用，将对应级别节点（默认 pp 产前样）
 * 推进到 approved 终态，作为生产放行/开裁前置条件的既有消费点（production 域
 * pp_sample_approved / 开裁前置校验）继续以 SampleNode.approved 为真源。
 *
 * 边界：
 *   - 本函数是既有状态机的「封样投影」扩展：不修改 advanceSampleNode 的任何既有语义，
 *     approved 仍为终态；重复调用幂等返回当前节点；
 *   - QC→确认→封存的顺序守卫由 garmentSampleGateService 保证，本函数不重复校验。
 */
export async function markSampleNodeSealedApproved(params: {
  prisma: PrismaClient;
  caseId: string;
  level?: SampleNodeLevel;
  approvedBy: string;
  feedback?: string;
  notes?: string;
}): Promise<Result<{ node: any }>> {
  const { prisma, caseId, level = 'pp', approvedBy, feedback, notes } = params;

  const devCase = await findLiveCase(prisma, caseId);
  if (!devCase) return { ok: false, error: { code: 'NOT_FOUND', message: `开发单 ${caseId} 不存在` } };

  await ensureSampleNodes(prisma, caseId);
  const node = await prisma.sampleNode.findUnique({
    where: { developmentCaseId_level: { developmentCaseId: caseId, level } },
  });
  if (!node || node.deletedAt) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '样衣节点不存在' } };
  }
  if (node.status === 'approved') {
    return { ok: true, data: { node: serializeNode(node) } }; // 幂等
  }

  const now = BigInt(Date.now());
  const updated = await prisma.sampleNode.update({
    where: { id: node.id },
    data: {
      status: 'approved',
      approvedAt: now,
      approvedBy,
      ...(feedback !== undefined ? { feedback: feedback || null } : {}),
      ...(notes !== undefined ? { notes: notes || null } : {}),
      updatedAt: now,
    },
  });

  await writeRouteAuditLog({
    prisma,
    actorId: approvedBy || 'api',
    source: 'route:samples:garment-gate',
    operation: 'seal_approve_sample_node',
    targetType: 'SampleNode',
    targetId: node.id,
    before: { status: node.status, round: node.round },
    after: { status: 'approved', round: updated.round, sealDriven: true },
  });

  return { ok: true, data: { node: serializeNode(updated) } };
}
