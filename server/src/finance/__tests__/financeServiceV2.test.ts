/**
 * financeServiceV2 单测
 * 覆盖：list/get/create/update/softDelete CRUD + getArApSummary 看板聚合 + 行级权限 scope
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
    nextNumber: vi.fn().mockResolvedValue('INV-2026-0001'),
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

import { createFinanceServiceV2 } from '../financeServiceV2';

// ── helpers ──
function dec(v: number | string) {
  return { toString: () => String(v) };
}

const ACTOR = { userId: 'user_1', departmentIds: ['dept_1'], role: 'admin' } as any;

function makeRow(overrides: any = {}) {
  return {
    id: 'INV__1',
    invoiceNumber: 'INV-2026-0001',
    type: 'Receivable',
    status: 'Issued',
    amount: dec(10000),
    currency: 'USD',
    deletedAt: null,
    ownerId: 'user_1',
    departmentId: 'dept_1',
    createdAt: BigInt(0),
    updatedAt: BigInt(0),
    ...overrides,
  };
}

function makePrisma(overrides: {
  findMany?: any;
  count?: any;
  findFirst?: any;
  create?: any;
  update?: any;
} = {}) {
  return {
    quotation: {
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([makeRow({ id: 'QT__1', quotationNumber: 'QT-1' })]),
      count: overrides.count ?? vi.fn().mockResolvedValue(1),
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(makeRow({ id: 'QT__1', quotationNumber: 'QT-1' })),
      create: overrides.create ?? vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: data.id || 'QT__NEW' })),
      update: overrides.update ?? vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    invoice: {
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([makeRow()]),
      count: overrides.count ?? vi.fn().mockResolvedValue(1),
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(makeRow()),
      create: overrides.create ?? vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: data.id || 'INV__NEW' })),
      update: overrides.update ?? vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    paymentVoucher: {
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([makeRow({ id: 'PAY__1', voucherNumber: 'PAY-1', type: 'Receipt' })]),
      count: overrides.count ?? vi.fn().mockResolvedValue(1),
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(makeRow({ id: 'PAY__1', voucherNumber: 'PAY-1', type: 'Receipt' })),
      create: overrides.create ?? vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: data.id || 'PAY__NEW' })),
      update: overrides.update ?? vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
  } as any;
}

beforeEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════
// list
// ═══════════════════════════════════════════════════════════════

describe('list 财务单据列表', () => {
  it('成功返回分页列表（scope=all）', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.list('invoice', ACTOR, { limit: 10, offset: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.items).toHaveLength(1);
      expect(r.data.total).toBe(1);
      expect(r.data.hasMore).toBe(false);
    }
  });

  it('未登录 actor → 返回空列表（ownerId=__NOBODY__）', async () => {
    const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) });
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.list('invoice', null, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.items).toHaveLength(0);
  });

  it('搜索条件透传 where', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    await svc.list('invoice', ACTOR, { status: 'Issued', type: 'Receivable', search: 'INV' });
    const where = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('Issued');
    expect(where.type).toBe('Receivable');
    expect(where.OR).toBeDefined();
  });

  it('limit 上限 500', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    await svc.list('invoice', ACTOR, { limit: 9999 });
    expect(prisma.invoice.findMany.mock.calls[0][0].take).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// get
// ═══════════════════════════════════════════════════════════════

describe('get 财务单据详情', () => {
  it('存在 → 返回序列化数据', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.get('invoice', ACTOR, 'INV__1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.id).toBe('INV__1');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.get('invoice', ACTOR, 'NOPE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════
// create
// ═══════════════════════════════════════════════════════════════

describe('create 创建财务单据', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.create('invoice', null, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('成功创建 invoice（自动编号 + ownerId 自动填充）', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.create('invoice', ACTOR, { type: 'Receivable', amount: 1000 });
    expect(r.ok).toBe(true);
    const createCall = prisma.invoice.create.mock.calls[0][0];
    expect(createCall.data.invoiceNumber).toBe('INV-2026-0001');
    expect(createCall.data.ownerId).toBe('user_1');
    expect(createCall.data.currency).toBe('USD'); // 来自 config 默认值
  });

  it('已传编号时不覆盖', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    await svc.create('invoice', ACTOR, { invoiceNumber: 'CUSTOM-001', type: 'Receivable' });
    const createCall = prisma.invoice.create.mock.calls[0][0];
    expect(createCall.data.invoiceNumber).toBe('CUSTOM-001');
  });

  it('quotation 类型生成 QT 前缀 ID', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    await svc.create('quotation', ACTOR, {});
    const createCall = prisma.quotation.create.mock.calls[0][0];
    expect(createCall.data.id).toMatch(/^QT_/);
  });

  it('payment 类型生成 PAY 前缀 ID', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    await svc.create('payment', ACTOR, {});
    const createCall = prisma.paymentVoucher.create.mock.calls[0][0];
    expect(createCall.data.id).toMatch(/^PAY_/);
  });
});

// ═══════════════════════════════════════════════════════════════
// update
// ═══════════════════════════════════════════════════════════════

describe('update 更新财务单据', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.update('invoice', null, 'INV__1', { status: 'Paid' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.update('invoice', ACTOR, 'NOPE', { status: 'Paid' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('成功更新（编号字段被过滤）', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.update('invoice', ACTOR, 'INV__1', {
      status: 'Paid',
      invoiceNumber: 'SHOULD_NOT_CHANGE',
      id: 'SHOULD_NOT_CHANGE',
    });
    expect(r.ok).toBe(true);
    const updateCall = prisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe('Paid');
    expect(updateCall.data.invoiceNumber).toBeUndefined();
    expect(updateCall.data.id).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// softDelete
// ═══════════════════════════════════════════════════════════════

describe('softDelete 软删除财务单据', () => {
  it('未登录 → UNAUTHORIZED', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.softDelete('invoice', null, 'INV__1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.softDelete('invoice', ACTOR, 'NOPE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('成功 → deletedAt 落库', async () => {
    const prisma = makePrisma();
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.softDelete('invoice', ACTOR, 'INV__1');
    expect(r.ok).toBe(true);
    const updateCall = prisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.deletedAt).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// getArApSummary
// ═══════════════════════════════════════════════════════════════

describe('getArApSummary 应收应付看板', () => {
  it('成功聚合 AR/AP 数据', async () => {
    const prisma = {
      invoice: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ amount: dec(10000), currency: 'USD' }])  // AR
          .mockResolvedValueOnce([{ amount: dec(5000), currency: 'USD' }]),  // AP
      },
      paymentVoucher: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ amount: dec(3000), currency: 'USD' }])   // Receipts
          .mockResolvedValueOnce([{ amount: dec(2000), currency: 'USD' }]),  // Disbursements
      },
    } as any;
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.getArApSummary(ACTOR);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.receivable.total).toBe(10000);
      expect(r.data.receivable.paid).toBe(3000);
      expect(r.data.receivable.outstanding).toBe(7000);
      expect(r.data.receivable.count).toBe(1);
      expect(r.data.payable.total).toBe(5000);
      expect(r.data.payable.paid).toBe(2000);
      expect(r.data.payable.outstanding).toBe(3000);
    }
  });

  it('无数据 → 全部为 0', async () => {
    const prisma = {
      invoice: { findMany: vi.fn().mockResolvedValue([]) },
      paymentVoucher: { findMany: vi.fn().mockResolvedValue([]) },
    } as any;
    const svc = createFinanceServiceV2(prisma);
    const r = await svc.getArApSummary(ACTOR);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.receivable.total).toBe(0);
      expect(r.data.payable.total).toBe(0);
    }
  });
});
