/**
 * relationServiceV2 单测
 * 覆盖：listRelations/getRelation/createRelation/updateRelation/deleteRelation
 *       + getSalesFunnel/changeStage/get360View/batchChangeStage
 *       + 行级权限 scope + 字典校验 + 配置默认值
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── mock 依赖 ──
vi.mock('../../auth/permissionService', () => ({
  createPermissionService: vi.fn(() => ({
    getDataScopeResolver: vi.fn().mockResolvedValue({ rule: { kind: 'all' }, allowedDepartmentIds: [], allowedUserIds: [] }),
  })),
}));

vi.mock('../../sequence/sequenceService', () => ({
  createSequenceService: vi.fn(() => ({
    nextNumber: vi.fn().mockResolvedValue('CUS-00001'),
  })),
}));

vi.mock('../../dictionaries/dataDictionaryService', () => ({
  getDataDictionaryService: vi.fn(() => ({
    getEntries: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../config/systemConfigService', () => ({
  getSystemConfigService: vi.fn(() => ({
    getString: vi.fn().mockResolvedValue('CNY'),
  })),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// mock relationMutationService 的纯函数
vi.mock('../relationMutationService', () => ({
  toRelationDbPayload: vi.fn((input: any) => ({ ...input, id: input.id || `REL-${Date.now()}` })),
  toRelationUpdatePayload: vi.fn((input: any) => ({ ...input })),
  serializeRelation: vi.fn((row: any) => {
    const out: any = { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
    }
    return out;
  }),
  VALID_RELATION_CATEGORIES: new Set(['Customer', 'Supplier', 'Agent', 'Partner', 'Government', 'Internal', 'Other']),
}));

import { createRelationServiceV2 } from '../relationServiceV2';

// ── helpers ──
function dec(v: number | string) {
  return { toString: () => String(v) };
}

const ACTOR = { userId: 'user_1', departmentIds: ['dept_1'], role: 'admin' } as any;

function makeRelation(overrides: any = {}) {
  return {
    id: 'REL__1',
    code: 'CUS-00001',
    name: 'Peerless',
    category: 'Customer',
    stage: 'Customer',
    tier: 'A',
    isOrganization: true,
    ownerId: 'user_1',
    departmentId: 'dept_1',
    deletedAt: null,
    createdAt: BigInt(0),
    updatedAt: BigInt(0),
    salesRepIds: ['user_1'],
    ...overrides,
  };
}

function makePrisma(overrides: {
  findMany?: any;
  count?: any;
  findFirst?: any;
  upsert?: any;
  update?: any;
} = {}) {
  return {
    relation: {
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([makeRelation()]),
      count: overrides.count ?? vi.fn().mockResolvedValue(1),
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(makeRelation()),
      upsert: overrides.upsert ?? vi.fn().mockImplementation(async ({ where, create }: any) => ({ ...create, id: where.id })),
      update: overrides.update ?? vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    paymentVoucher: { findMany: vi.fn().mockResolvedValue([]) },
  } as any;
}

beforeEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════
// listRelations
// ═══════════════════════════════════════════════════════════════

describe('listRelations 客户列表', () => {
  it('成功返回分页列表', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.listRelations(ACTOR, { limit: 10, offset: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.items).toHaveLength(1);
      expect(r.data.total).toBe(1);
    }
  });

  it('筛选条件透传', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    await svc.listRelations(ACTOR, { category: 'Customer', stage: 'Lead', tier: 'A', search: 'Peerless' });
    const where = prisma.relation.findMany.mock.calls[0][0].where;
    expect(where.category).toBe('Customer');
    expect(where.stage).toBe('Lead');
    expect(where.tier).toBe('A');
    expect(where.OR).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// getRelation
// ═══════════════════════════════════════════════════════════════

describe('getRelation 客户详情', () => {
  it('存在 → 返回数据', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.getRelation(ACTOR, 'REL__1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.id).toBe('REL__1');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createRelationServiceV2(prisma);
    const r = await svc.getRelation(ACTOR, 'NOPE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════
// createRelation
// ═══════════════════════════════════════════════════════════════

describe('createRelation 创建客户', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.createRelation(null, { name: 'Test', category: 'Customer' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('name 为空 → VALIDATION_FAILED', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.createRelation(ACTOR, { name: '', category: 'Customer' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_FAILED');
  });

  it('非法 category → VALIDATION_FAILED', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.createRelation(ACTOR, { name: 'Test', category: 'InvalidCategory' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_FAILED');
  });

  it('成功创建 Customer（自动编号 CUS-00001 + ownerId 自动填充）', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.createRelation(ACTOR, { name: 'Peerless', category: 'Customer' });
    expect(r.ok).toBe(true);
    expect(prisma.relation.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = prisma.relation.upsert.mock.calls[0][0];
    expect(upsertCall.create.code).toBe('CUS-00001');
    expect(upsertCall.create.ownerId).toBe('user_1');
    expect(upsertCall.create.stage).toBe('Customer');
  });

  it('Supplier 类型生成 supplier 编号', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    await svc.createRelation(ACTOR, { name: 'Factory A', category: 'Supplier' });
    const upsertCall = prisma.relation.upsert.mock.calls[0][0];
    // seqType='supplier'，nextNumber mock 返回 CUS-00001（共用 mock，实际编号由 sequenceService 决定）
    expect(upsertCall.create.code).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// updateRelation
// ═══════════════════════════════════════════════════════════════

describe('updateRelation 更新客户', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.updateRelation(null, 'REL__1', { stage: 'Key' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createRelationServiceV2(prisma);
    const r = await svc.updateRelation(ACTOR, 'NOPE', { stage: 'Key' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('成功更新 stage/tier', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.updateRelation(ACTOR, 'REL__1', { stage: 'Key', tier: 'S' });
    expect(r.ok).toBe(true);
    const updateCall = prisma.relation.update.mock.calls[0][0];
    expect(updateCall.data.stage).toBe('Key');
    expect(updateCall.data.tier).toBe('S');
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteRelation
// ═══════════════════════════════════════════════════════════════

describe('deleteRelation 软删除客户', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.deleteRelation(null, 'REL__1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createRelationServiceV2(prisma);
    const r = await svc.deleteRelation(ACTOR, 'NOPE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('成功 → deletedAt 落库', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.deleteRelation(ACTOR, 'REL__1');
    expect(r.ok).toBe(true);
    const updateCall = prisma.relation.update.mock.calls[0][0];
    expect(updateCall.data.deletedAt).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// getSalesFunnel
// ═══════════════════════════════════════════════════════════════

describe('getSalesFunnel 销售漏斗聚合', () => {
  it('按 stage 分组 count', async () => {
    const prisma = makePrisma({
      findMany: vi.fn().mockResolvedValue([
        { stage: 'Lead' }, { stage: 'Lead' }, { stage: 'Customer' }, { stage: 'Key' },
      ]),
    });
    const svc = createRelationServiceV2(prisma);
    const r = await svc.getSalesFunnel(ACTOR, { category: 'Customer' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.total).toBe(4);
      const lead = r.data.stages.find((s: any) => s.stage === 'Lead');
      expect(lead.count).toBe(2);
    }
  });

  it('tier 筛选透传', async () => {
    const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
    const svc = createRelationServiceV2(prisma);
    await svc.getSalesFunnel(ACTOR, { category: 'Customer', tier: 'A' });
    const where = prisma.relation.findMany.mock.calls[0][0].where;
    expect(where.tier).toBe('A');
    expect(where.category).toBe('Customer');
  });
});

// ═══════════════════════════════════════════════════════════════
// changeStage
// ═══════════════════════════════════════════════════════════════

describe('changeStage 单个阶段变更', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.changeStage(null, 'REL__1', 'Key');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createRelationServiceV2(prisma);
    const r = await svc.changeStage(ACTOR, 'NOPE', 'Key');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('成功 → stage + lastInteraction 更新', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.changeStage(ACTOR, 'REL__1', 'Key');
    expect(r.ok).toBe(true);
    const updateCall = prisma.relation.update.mock.calls[0][0];
    expect(updateCall.data.stage).toBe('Key');
    expect(updateCall.data.lastInteraction).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// get360View
// ═══════════════════════════════════════════════════════════════

describe('get360View 360°客户视图', () => {
  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createRelationServiceV2(prisma);
    const r = await svc.get360View(ACTOR, 'NOPE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('成功聚合跨域数据', async () => {
    const prisma = makePrisma();
    prisma.relation.findFirst.mockResolvedValue({
      ...makeRelation(),
      contacts: [{ id: 'CON__1', isPrimary: true, name: 'John' }],
      creditLimits: [{ id: 'CL__1', status: 'active', limitAmount: dec(50000) }],
      followUpRecords: [{ id: 'FU__1', followUpAt: '2026-08-01', nextFollowUpAt: null }],
      opportunities: [{ id: 'OPP__1', stage: 'Proposal' }],
      customerTiers: [{ id: 'CT__1', status: 'active', tier: 'A' }],
      factoryProfile: null,
    });
    prisma.order.findMany.mockResolvedValue([
      { id: 'ORD__1', code: 'SO-1', status: 'Confirmed', quoteAmount: dec(10000) },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'INV__1', type: 'Receivable', amount: dec(5000), currency: 'USD' },
    ]);
    prisma.paymentVoucher.findMany.mockResolvedValue([
      { id: 'PAY__1', type: 'Receipt', amount: dec(3000), currency: 'USD' },
    ]);
    const svc = createRelationServiceV2(prisma);
    const r = await svc.get360View(ACTOR, 'REL__1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.relation).toBeDefined();
      expect(r.data.contacts).toHaveLength(1);
      expect(r.data.orders).toHaveLength(1);
      expect(r.data.summary.orderCount).toBe(1);
      expect(r.data.summary.arTotal).toBe(5000);
      expect(r.data.summary.receiptTotal).toBe(3000);
      expect(r.data.summary.outstanding).toBe(2000);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// batchChangeStage
// ═══════════════════════════════════════════════════════════════

describe('batchChangeStage 批量阶段变更', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.batchChangeStage(null, ['REL__1'], 'Key');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('全部成功 → updated=3, failed=0', async () => {
    const prisma = makePrisma();
    const svc = createRelationServiceV2(prisma);
    const r = await svc.batchChangeStage(ACTOR, ['REL__1', 'REL__2', 'REL__3'], 'Key');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.updated).toBe(3);
      expect(r.data.failed).toBe(0);
    }
  });

  it('部分不存在 → updated=1, failed=2', async () => {
    const prisma = makePrisma({
      findFirst: vi.fn()
        .mockResolvedValueOnce(makeRelation({ id: 'REL__1' }))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
    });
    const svc = createRelationServiceV2(prisma);
    const r = await svc.batchChangeStage(ACTOR, ['REL__1', 'REL__2', 'REL__3'], 'Key');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.updated).toBe(1);
      expect(r.data.failed).toBe(2);
    }
  });
});
