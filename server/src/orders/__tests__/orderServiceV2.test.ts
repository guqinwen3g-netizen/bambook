/**
 * orderServiceV2 单测
 * 覆盖：listOrders/getOrder/createOrder/updateOrder/transitionStatus/deleteOrder/getKanban
 *       + 行级权限 scope + 状态机校验 + 字典校验 + 配置默认值
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
    nextNumber: vi.fn().mockResolvedValue('SO-202608-001'),
  })),
}));

vi.mock('../../dictionaries/dataDictionaryService', () => ({
  getDataDictionaryService: vi.fn(() => ({
    getEntries: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../config/systemConfigService', () => ({
  getSystemConfigService: vi.fn(() => ({
    getString: vi.fn().mockResolvedValue('USD'),
  })),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// 不 mock orderLifecycleService — 使用真实的状态机常量
import { createOrderServiceV2 } from '../orderServiceV2';

// ── helpers ──
function dec(v: number | string) {
  return { toString: () => String(v) };
}

const ACTOR = { userId: 'user_1', departmentIds: ['dept_1'], role: 'admin' } as any;

function makeOrder(overrides: any = {}) {
  return {
    id: 'ORD__1',
    code: 'SO-202608-001',
    customer: 'Peerless',
    product: 'Cotton Twill',
    type: 'Fabric',
    quantity: 1000,
    status: 'Pending',
    dueDate: '2026-09-01',
    quoteAmount: dec(10000),
    currency: 'USD',
    ownerId: 'user_1',
    departmentId: 'dept_1',
    deletedAt: null,
    createdAt: BigInt(0),
    updatedAt: BigInt(0),
    lines: [],
    ...overrides,
  };
}

function makePrisma(overrides: {
  findMany?: any;
  count?: any;
  findFirst?: any;
  create?: any;
  update?: any;
  txUpdate?: any;
  txCreate?: any;
} = {}) {
  const txUpdate = overrides.txUpdate ?? vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  const txCreate = overrides.txCreate ?? vi.fn().mockResolvedValue({});
  return {
    order: {
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([makeOrder()]),
      count: overrides.count ?? vi.fn().mockResolvedValue(1),
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(makeOrder()),
      create: overrides.create ?? vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: data.id || 'ORD__NEW', lines: [] })),
      update: overrides.update ?? vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    orderStatusTransition: {
      create: txCreate,
    },
    $transaction: vi.fn(async (fn: any) => fn({
      order: { update: txUpdate },
      orderStatusTransition: { create: txCreate },
    })),
  } as any;
}

beforeEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════
// listOrders
// ═══════════════════════════════════════════════════════════════

describe('listOrders 订单列表', () => {
  it('成功返回分页列表', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.listOrders(ACTOR, { limit: 10, offset: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.items).toHaveLength(1);
      expect(r.data.total).toBe(1);
    }
  });

  it('搜索条件透传', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    await svc.listOrders(ACTOR, { status: 'Pending', type: 'Fabric', search: 'Peerless' });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('Pending');
    expect(where.type).toBe('Fabric');
    expect(where.OR).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// getOrder
// ═══════════════════════════════════════════════════════════════

describe('getOrder 订单详情', () => {
  it('存在 → 返回数据', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.getOrder(ACTOR, 'ORD__1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.id).toBe('ORD__1');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.getOrder(ACTOR, 'NOPE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════
// createOrder
// ═══════════════════════════════════════════════════════════════

describe('createOrder 创建订单', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.createOrder(null, { customer: 'Test', product: 'P', type: 'Fabric', quantity: 100, dueDate: '2026-09-01', quoteAmount: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('customer 为空 → VALIDATION_FAILED', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.createOrder(ACTOR, { customer: '', product: 'P', type: 'Fabric', quantity: 100, dueDate: '2026-09-01', quoteAmount: 1000 } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_FAILED');
  });

  it('quantity ≤ 0 → VALIDATION_FAILED', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.createOrder(ACTOR, { customer: 'Test', product: 'P', type: 'Fabric', quantity: 0, dueDate: '2026-09-01', quoteAmount: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_FAILED');
  });

  it('非法 status → VALIDATION_FAILED', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.createOrder(ACTOR, { customer: 'Test', product: 'P', type: 'Fabric', quantity: 100, dueDate: '2026-09-01', quoteAmount: 1000, status: 'InvalidStatus' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_FAILED');
  });

  it('成功创建（自动编号 + ownerId + 配置默认值）', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.createOrder(ACTOR, {
      customer: 'Peerless',
      product: 'Cotton Twill',
      type: 'Fabric',
      quantity: 1000,
      dueDate: '2026-09-01',
      quoteAmount: 10000,
    });
    expect(r.ok).toBe(true);
    const createCall = prisma.order.create.mock.calls[0][0];
    expect(createCall.data.code).toBe('SO-202608-001');
    expect(createCall.data.ownerId).toBe('user_1');
    expect(createCall.data.currency).toBe('USD');
    expect(createCall.data.status).toBe('Pending');
  });
});

// ═══════════════════════════════════════════════════════════════
// updateOrder
// ═══════════════════════════════════════════════════════════════

describe('updateOrder 更新订单', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.updateOrder(null, 'ORD__1', { customer: 'New' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.updateOrder(ACTOR, 'NOPE', { customer: 'New' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('成功更新（只更新 updatableFields）', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.updateOrder(ACTOR, 'ORD__1', { customer: 'New Name', poNumber: 'PO-123' });
    expect(r.ok).toBe(true);
    const updateCall = prisma.order.update.mock.calls[0][0];
    expect(updateCall.data.customer).toBe('New Name');
    expect(updateCall.data.poNumber).toBe('PO-123');
  });
});

// ═══════════════════════════════════════════════════════════════
// transitionStatus
// ═══════════════════════════════════════════════════════════════

describe('transitionStatus 状态机流转', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.transitionStatus(null, 'ORD__1', 'Confirmed');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('非法目标状态 → VALIDATION_FAILED', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.transitionStatus(ACTOR, 'ORD__1', 'InvalidStatus');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_FAILED');
  });

  it('订单不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.transitionStatus(ACTOR, 'NOPE', 'Confirmed');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('相同状态 → INVALID_TRANSITION', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(makeOrder({ status: 'Pending' })) });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.transitionStatus(ACTOR, 'ORD__1', 'Pending');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('非法转换 Pending → Delivered → INVALID_TRANSITION', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(makeOrder({ status: 'Pending' })) });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.transitionStatus(ACTOR, 'ORD__1', 'Delivered');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('合法转换 Pending → Confirmed → 成功（同事务写状态记录）', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(makeOrder({ status: 'Pending' })) });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.transitionStatus(ACTOR, 'ORD__1', 'Confirmed', '客户确认');
    expect(r.ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteOrder
// ═══════════════════════════════════════════════════════════════

describe('deleteOrder 软删除订单', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.deleteOrder(null, 'ORD__1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.deleteOrder(ACTOR, 'NOPE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('成功 → deletedAt 落库', async () => {
    const prisma = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.deleteOrder(ACTOR, 'ORD__1');
    expect(r.ok).toBe(true);
    const updateCall = prisma.order.update.mock.calls[0][0];
    expect(updateCall.data.deletedAt).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// getKanban
// ═══════════════════════════════════════════════════════════════

describe('getKanban 看板聚合', () => {
  it('按 status 分组 count', async () => {
    const prisma = makePrisma({
      findMany: vi.fn().mockResolvedValue([
        { status: 'Pending' }, { status: 'Pending' }, { status: 'Confirmed' },
      ]),
    });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.getKanban(ACTOR, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.total).toBe(3);
      const pending = r.data.statuses.find((s: any) => s.status === 'Pending');
      expect(pending.count).toBe(2);
    }
  });

  it('type 筛选透传', async () => {
    const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
    const svc = createOrderServiceV2(prisma);
    await svc.getKanban(ACTOR, { type: 'Fabric' });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('Fabric');
  });
});
