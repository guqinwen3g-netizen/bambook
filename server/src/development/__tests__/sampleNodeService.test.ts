import { describe, expect, it, vi } from 'vitest';
import { ensureSampleNodes, advanceSampleNode, listSampleNodes, SAMPLE_NODE_LEVELS } from '../sampleNodeService';

vi.mock('../../audit/routeAudit', () => ({
  writeRouteAuditLog: vi.fn().mockResolvedValue('audit_test_id'),
}));

function makeNode(overrides: any = {}) {
  return {
    id: 'SN__C1__confirmation',
    developmentCaseId: 'C1',
    level: 'confirmation',
    round: 1,
    status: 'pending',
    sentDate: null,
    courier: null,
    trackingNumber: null,
    feedback: null,
    feedbackDate: null,
    approvedAt: null,
    approvedBy: null,
    notes: null,
    createdAt: BigInt(1000),
    updatedAt: BigInt(1000),
    deletedAt: null,
    ...overrides,
  };
}

function makePrisma(opts: { node?: any; nodes?: any[]; caseExists?: boolean } = {}) {
  const node = opts.node === undefined ? makeNode() : opts.node;
  const state = { nodes: opts.nodes ?? [] };
  const prisma: any = {
    developmentCase: {
      findFirst: vi.fn().mockResolvedValue(opts.caseExists === false ? null : { id: 'C1', code: 'DEV-1' }),
    },
    sampleNode: {
      upsert: vi.fn().mockImplementation(async ({ create }: any) => {
        state.nodes.push({ ...create });
        return create;
      }),
      findUnique: vi.fn().mockResolvedValue(node),
      findMany: vi.fn().mockImplementation(async () => state.nodes),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ ...node, ...data })),
    },
  };
  return { prisma, state };
}

describe('ensureSampleNodes', () => {
  it('幂等创建三级节点（confirmation/pp/top）', async () => {
    const { prisma, state } = makePrisma();
    const r = await ensureSampleNodes(prisma, 'C1');
    expect(r.ok).toBe(true);
    expect(prisma.sampleNode.upsert).toHaveBeenCalledTimes(3);
    const levels = state.nodes.map((n: any) => n.level);
    expect(levels).toEqual([...SAMPLE_NODE_LEVELS]);
  });

  it('开发单不存在返回 NOT_FOUND', async () => {
    const { prisma } = makePrisma({ caseExists: false });
    const r = await ensureSampleNodes(prisma, 'C1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
});

describe('listSampleNodes 排序', () => {
  it('按 confirmation → pp → top 固定序返回', async () => {
    const { prisma } = makePrisma({
      nodes: [
        makeNode({ id: 'SN__C1__top', level: 'top' }),
        makeNode({ id: 'SN__C1__pp', level: 'pp' }),
        makeNode({ id: 'SN__C1__confirmation', level: 'confirmation' }),
      ],
    });
    const nodes = await listSampleNodes(prisma, 'C1');
    expect(nodes.map((n: any) => n.level)).toEqual(['confirmation', 'pp', 'top']);
  });
});

describe('advanceSampleNode 状态机', () => {
  it('pending → start → making', async () => {
    const { prisma } = makePrisma({ node: makeNode({ status: 'pending' }) });
    const r = await advanceSampleNode({ prisma, caseId: 'C1', level: 'confirmation', input: { action: 'start' }, actorId: 'u1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.node.status).toBe('making');
  });

  it('making → send → sent（写入寄样信息）', async () => {
    const { prisma } = makePrisma({ node: makeNode({ status: 'making' }) });
    const r = await advanceSampleNode({
      prisma, caseId: 'C1', level: 'confirmation',
      input: { action: 'send', sentDate: '2026-08-07', courier: 'DHL', trackingNumber: 'T123' },
      actorId: 'u1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.node.status).toBe('sent');
      expect(r.data.node.sentDate).toBe('2026-08-07');
      expect(r.data.node.trackingNumber).toBe('T123');
    }
  });

  it('sent → approve → approved（写入批准人/时间）', async () => {
    const { prisma } = makePrisma({ node: makeNode({ status: 'sent' }) });
    const r = await advanceSampleNode({ prisma, caseId: 'C1', level: 'pp', input: { action: 'approve', feedback: '版型 OK' }, actorId: 'u1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.node.status).toBe('approved');
      expect(r.data.node.approvedBy).toBe('u1');
      expect(r.data.node.approvedAt).not.toBeNull();
    }
  });

  it('sent → revise → revising（清空批准信息）', async () => {
    const { prisma } = makePrisma({ node: makeNode({ status: 'sent' }) });
    const r = await advanceSampleNode({ prisma, caseId: 'C1', level: 'pp', input: { action: 'revise', feedback: '罗纹偏松' }, actorId: 'u1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.node.status).toBe('revising');
      expect(r.data.node.feedback).toBe('罗纹偏松');
      expect(r.data.node.approvedAt).toBeNull();
    }
  });

  it('revising → start → making 且 round+1', async () => {
    const { prisma } = makePrisma({ node: makeNode({ status: 'revising', round: 2 }) });
    const r = await advanceSampleNode({ prisma, caseId: 'C1', level: 'confirmation', input: { action: 'start' }, actorId: 'u1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.node.status).toBe('making');
      expect(r.data.node.round).toBe(3);
    }
  });

  it('pending 状态不允许 send（INVALID_TRANSITION）', async () => {
    const { prisma } = makePrisma({ node: makeNode({ status: 'pending' }) });
    const r = await advanceSampleNode({ prisma, caseId: 'C1', level: 'confirmation', input: { action: 'send' }, actorId: 'u1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('approved 终态不允许任何动作', async () => {
    const { prisma } = makePrisma({ node: makeNode({ status: 'approved' }) });
    for (const action of ['start', 'send', 'approve', 'revise'] as const) {
      const r = await advanceSampleNode({ prisma, caseId: 'C1', level: 'confirmation', input: { action }, actorId: 'u1' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
    }
  });

  it('非法级别返回 INVALID_LEVEL', async () => {
    const { prisma } = makePrisma();
    const r = await advanceSampleNode({ prisma, caseId: 'C1', level: 'proto', input: { action: 'start' }, actorId: 'u1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_LEVEL');
  });

  it('非法动作返回 INVALID_ACTION', async () => {
    const { prisma } = makePrisma();
    const r = await advanceSampleNode({ prisma, caseId: 'C1', level: 'confirmation', input: { action: 'fly' as any }, actorId: 'u1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ACTION');
  });

  it('推进时自动 ensure 缺失节点', async () => {
    const { prisma } = makePrisma({ node: makeNode({ status: 'pending' }) });
    await advanceSampleNode({ prisma, caseId: 'C1', level: 'confirmation', input: { action: 'start' }, actorId: 'u1' });
    expect(prisma.sampleNode.upsert).toHaveBeenCalledTimes(3);
  });
});
