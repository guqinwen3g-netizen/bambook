/**
 * orderConfirmGates.test.ts — W-A 走查 P0 死胡同回归
 *
 * P0-1（DE-1）信用门禁接线：
 *   - orderServiceV2.createOrder 对 Frozen/Revoked/Net61+ 逾期客户 fail-closed（403 码族）
 *   - transitionOrderStatus 进入 Confirmed 同样门禁（V1/V2/Agent 全路径单引擎）
 * P0-2（DE-2/DE-4）确认路径统一：
 *   - V1 status-transition 发布 OrderStatusChanged + OrderConfirmed（L1 生产管线 / L6 BOM 联动触发源）
 *   - V2 PATCH 委托同一引擎后同样发事件；V1 补齐 MOQ Confirmed 门禁
 * P0-3（DE-6）MOQ HTTP 契约：
 *   - V2 PATCH 小单确认 → 409 + body.approvalRequestId 可读（不再 500）
 *   - V1 status-transition 小单确认 → 409 + error.approvalRequestId
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ── mock 平台依赖（与 orderServiceV2.test.ts 同口径） ──
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../events/businessEventBus', () => ({
  publishBusinessEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../auth/permissionService', () => ({
  createPermissionService: vi.fn(() => ({
    getDataScopeResolver: vi.fn().mockResolvedValue({ rule: { kind: 'all' }, allowedDepartmentIds: [], allowedUserIds: [] }),
  })),
  ROLE_ID_TO_LEGACY_AGENT_ROLE: {},
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

vi.mock('../../teams/teamShareService', () => ({
  createTeamShareService: vi.fn(() => ({
    hasRelationWriteAccess: vi.fn().mockResolvedValue(true),
    resolveVisibleRelationIds: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../approvals/approvalRoutingService', () => ({
  createApprovalRoutingService: vi.fn(() => ({})),
}));

// MOQ 豁免审批单统一经 approvalCreateService（DR-007）；mock 固定回单号验证透传
const MOCK_APPROVAL_ID = 'APR__MOCK__1';
vi.mock('../../approvals/approvalCreateService', () => ({
  createApprovalCreateService: vi.fn(() => ({
    createBusinessApproval: vi.fn().mockResolvedValue({ id: MOCK_APPROVAL_ID }),
  })),
}));

import { transitionOrderStatus } from '../orderLifecycleService';
import { createOrderServiceV2 } from '../orderServiceV2';
import { createOrdersV2Router } from '../routeV2';
import { createOrdersRouter } from '../route';
import { publishBusinessEvent } from '../../events/businessEventBus';

// ── helpers ──
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const ownerToken = jwt.sign({ userId: 'u1', roles: ['owner'] }, JWT_SECRET);
const ACTOR = { userId: 'user_1', departmentIds: ['dept_1'], roles: ['admin'] } as any;

function makeOrder(overrides: any = {}) {
  return {
    id: 'ORD__1',
    code: 'SO-202608-001',
    customer: 'Peerless',
    product: 'Cotton Twill',
    type: 'Fabric',
    businessLine: 'fabric',
    quantity: 1000,
    status: 'Pending',
    dueDate: '2026-09-01',
    quoteAmount: 10000,
    currency: 'USD',
    capsuleExemption: false,
    moqSnapshot: null,
    customerRelationId: null,
    ownerId: 'user_1',
    deletedAt: null,
    createdAt: BigInt(0),
    updatedAt: BigInt(0),
    lines: [],
    ...overrides,
  };
}

function makeCreditLimit(overrides: any = {}) {
  return {
    id: 'CL__1',
    relationId: 'REL__1',
    status: 'Active',
    totalLimit: 100000,
    usedAmount: 0,
    currency: 'USD',
    frozenAt: null,
    frozenBy: null,
    thawedReason: null,
    lastAutoScanDate: null,
    ...overrides,
  };
}

function makePrisma(opts: {
  order?: any;
  creditLimit?: any;
  invoices?: any[];
  approvedMoqExemption?: any;
} = {}) {
  const order = 'order' in opts ? opts.order : makeOrder();
  const tx = {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...order, ...data, id: where.id })),
    },
    orderStatusTransition: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    entityLink: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
    entityReference: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      findFirst: vi.fn().mockResolvedValue(order),
      findMany: vi.fn().mockResolvedValue(order ? [order] : []),
      count: vi.fn().mockResolvedValue(order ? 1 : 0),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: data.id ?? 'ORD__NEW', lines: [] })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    orderStatusTransition: { create: tx.orderStatusTransition.create },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    creditLimit: { findFirst: vi.fn().mockResolvedValue(opts.creditLimit ?? null), findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue(opts.invoices ?? []), count: vi.fn().mockResolvedValue(0) },
    approvalRequest: { findFirst: vi.fn().mockResolvedValue(opts.approvedMoqExemption ?? null) },
    entityLink: tx.entityLink,
    entityReference: tx.entityReference,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  } as any;
  return { prisma, tx, order };
}

beforeEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════
// P0-1（DE-1）信用门禁：transitionOrderStatus 进入 Confirmed
// ═══════════════════════════════════════════════════════════════
describe('P0-1 信用门禁：Confirmed 流转 fail-closed', () => {
  it('Frozen 客户确认被阻断（CREDIT_FROZEN_60_DAYS），无状态写入、无事件', async () => {
    const { prisma, tx } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__F' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__F', status: 'Frozen', frozenBy: 'system_credit_scan', frozenAt: new Date() }),
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CREDIT_FROZEN_60_DAYS');
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderStatusTransition.create).not.toHaveBeenCalled();
    expect(publishBusinessEvent).not.toHaveBeenCalled();
  });

  it('Revoked（吊销）客户确认被阻断（CREDIT_REVOKED）', async () => {
    const { prisma } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__R' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__R', status: 'Revoked' }),
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CREDIT_REVOKED');
  });

  it('Active 额度但 Net61+ 逾期未结清 → OVERDUE_60_DAYS（调度遗漏兜底）', async () => {
    const overdueDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { prisma } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__O' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__O', status: 'Active' }),
      invoices: [{ id: 'INV__1', dueDate: overdueDate, issueDate: overdueDate, status: 'Issued', type: 'Receivable', customerRelationId: 'REL__O' }],
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('OVERDUE_60_DAYS');
  });

  it('Active 客户确认放行：状态写入 + OrderStatusChanged/OrderConfirmed 事件发布（P0-2 联动源）', async () => {
    const { prisma, tx } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__A' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__A', status: 'Active' }),
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(true);
    expect(tx.order.update).toHaveBeenCalledTimes(1);
    expect(tx.orderStatusTransition.create).toHaveBeenCalledTimes(1);
    const eventTypes = (publishBusinessEvent as any).mock.calls.map((c: any[]) => c[0]?.type);
    expect(eventTypes).toContain('OrderStatusChanged');
    expect(eventTypes).toContain('OrderConfirmed');
  });
});

// ═══════════════════════════════════════════════════════════════
// P0-1（DE-1）信用门禁：orderServiceV2.createOrder 建单 fail-closed
// ═══════════════════════════════════════════════════════════════
describe('P0-1 信用门禁：V2 建单 fail-closed', () => {
  it('Frozen 客户建单被拒（CREDIT_FROZEN_60_DAYS），order.create 未调用', async () => {
    const { prisma } = makePrisma({
      creditLimit: makeCreditLimit({ relationId: 'REL__F', status: 'Frozen' }),
    });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.createOrder(ACTOR, {
      customer: 'Peerless', product: 'Cotton Twill', type: 'Fabric',
      quantity: 1000, dueDate: '2026-09-01', quoteAmount: 10000,
      customerRelationId: 'REL__F',
    });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CREDIT_FROZEN_60_DAYS');
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('Active 客户建单正常放行', async () => {
    const { prisma } = makePrisma({
      creditLimit: makeCreditLimit({ relationId: 'REL__A', status: 'Active' }),
    });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.createOrder(ACTOR, {
      customer: 'Peerless', product: 'Cotton Twill', type: 'Fabric',
      quantity: 1000, dueDate: '2026-09-01', quoteAmount: 10000,
      customerRelationId: 'REL__A',
    });
    expect(r.ok).toBe(true);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// P0-2（DE-2/DE-4）确认路径统一：V1 补 MOQ 门禁，V2 委托单引擎发事件
// ═══════════════════════════════════════════════════════════════
describe('P0-2 确认路径统一（V1/V2 单引擎）', () => {
  it('V1 确认 MOQ 不足被阻断：MOQ_VIOLATION + approvalRequestId（豁免审批单自动发起）', async () => {
    const { prisma, tx } = makePrisma({ order: makeOrder({ quantity: 100 }) });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('MOQ_VIOLATION');
    expect(r.error!.approvalRequestId).toBe(MOCK_APPROVAL_ID);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('V1 确认 MOQ 不足但已有 approved 豁免单 → 放行', async () => {
    const { prisma } = makePrisma({
      order: makeOrder({ quantity: 100 }),
      approvedMoqExemption: { id: 'APR__APPROVED' },
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(true);
  });

  it('V2 transitionStatus 委托单引擎：小单确认 → MOQ_VIOLATION + approvalRequestId 透传', async () => {
    const { prisma } = makePrisma({ order: makeOrder({ quantity: 100 }) });
    const svc = createOrderServiceV2(prisma);
    const r = await svc.transitionStatus(ACTOR, 'ORD__1', 'Confirmed');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('MOQ_VIOLATION');
    expect(r.error!.approvalRequestId).toBe(MOCK_APPROVAL_ID);
  });

  it('V2 transitionStatus 委托单引擎：合规确认 → 成功且发布 OrderConfirmed（L1/L6 联动恢复）', async () => {
    const { prisma } = makePrisma();
    const svc = createOrderServiceV2(prisma);
    const r = await svc.transitionStatus(ACTOR, 'ORD__1', 'Confirmed');
    expect(r.ok).toBe(true);
    const eventTypes = (publishBusinessEvent as any).mock.calls.map((c: any[]) => c[0]?.type);
    expect(eventTypes).toContain('OrderStatusChanged');
    expect(eventTypes).toContain('OrderConfirmed');
  });
});

// ═══════════════════════════════════════════════════════════════
// P0-3（DE-6）MOQ HTTP 契约：409 + approvalRequestId 可读
// ═══════════════════════════════════════════════════════════════
describe('P0-3 MOQ/信用门禁 HTTP 契约', () => {
  it('V2 PATCH /api/v2/orders/:id/status 小单确认 → 409 + body.error=MOQ_VIOLATION + body.approvalRequestId', async () => {
    const { prisma } = makePrisma({ order: makeOrder({ quantity: 100 }) });
    const app = express();
    app.use(express.json());
    app.use('/api/v2/orders', createOrdersV2Router({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app)
      .patch('/api/v2/orders/ORD__1/status')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'Confirmed' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('MOQ_VIOLATION');
    expect(res.body.approvalRequestId).toBe(MOCK_APPROVAL_ID);
  });

  it('V2 POST /api/v2/orders Frozen 客户建单 → 403 + body.error=CREDIT_FROZEN_60_DAYS', async () => {
    const { prisma } = makePrisma({
      creditLimit: makeCreditLimit({ relationId: 'REL__F', status: 'Frozen' }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v2/orders', createOrdersV2Router({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app)
      .post('/api/v2/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        customer: 'Peerless', product: 'Cotton Twill', type: 'Fabric',
        quantity: 1000, dueDate: '2026-09-01', quoteAmount: 10000,
        customerRelationId: 'REL__F',
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CREDIT_FROZEN_60_DAYS');
  });

  it('V1 POST /api/v1/orders/:id/status-transition 小单确认 → 409 + error.code=MOQ_VIOLATION + error.approvalRequestId', async () => {
    const { prisma } = makePrisma({ order: makeOrder({ quantity: 100 }) });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/orders', createOrdersRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app)
      .post('/api/v1/orders/ORD__1/status-transition')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ toStatus: 'Confirmed' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MOQ_VIOLATION');
    expect(res.body.error.approvalRequestId).toBe(MOCK_APPROVAL_ID);
  });

  it('V1 POST /api/v1/orders/:id/status-transition Frozen 客户确认 → 403 + error.code=CREDIT_FROZEN_60_DAYS', async () => {
    const { prisma } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__F' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__F', status: 'Frozen' }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/orders', createOrdersRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app)
      .post('/api/v1/orders/ORD__1/status-transition')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ toStatus: 'Confirmed' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CREDIT_FROZEN_60_DAYS');
  });
});
