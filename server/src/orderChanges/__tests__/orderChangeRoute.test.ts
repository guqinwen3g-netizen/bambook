import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createOrderChangeRouter } from '../orderChangeRoute';

/**
 * DR-010 订单变更路由契约测试：
 *   POST /            — 401/403/400/201
 *   GET /             — 401 + 列表过滤
 *   GET /:id          — 404/200
 *   POST /:id/apply   — 403 scope / 409 幂等 / 200
 *   POST /:id/withdraw— 403 非本人 / 409 非 Pending / 200
 */

// 可控 actor mock
let mockActor: { userId: string; roles: string[]; permissions?: string[] } | null = {
  userId: 'u_sales',
  roles: ['sales'],
  permissions: ['order:change_request:create', 'order:change_request:apply'],
};

vi.mock('../../auth/middleware', () => ({
  extractActorFromRequest: () => mockActor,
}));

const VALID_REASON = '客户延迟确认产前样，需要调整订单内容';
const VALID_IMPACT = 'BOM 成本变化，回款延迟风险需评估';

const baseCr = {
  id: 'OCR_1',
  orderId: 'ORD__1',
  requestNumber: 'OCR-20260816-001',
  status: 'Pending',
  changeTypes: ['quantity'],
  beforeSnapshot: { quantity: 200 },
  afterDelta: { quantity: 180 },
  changeReason: '客户延迟确认产前样，需要调整订单内容',
  requesterId: 'u_sales',
  reviewerId: 'u_supervisor',
  approvalRequestId: 'ar_1',
  appliedAt: null,
  appliedBy: null,
  deletedAt: null,
  notes: 'BOM 成本变化，回款延迟风险需评估',
  attachments: null,
};

const baseOrder = {
  id: 'ORD__1',
  status: 'Confirmed',
  deletedAt: null,
  customer: 'ABC 贸易',
  poNumber: 'PO-2026-001',
};

function makeApp(opts: {
  changeRequest?: any;
  order?: any;
  failCreate?: boolean;
  failApply?: boolean;
  failWithdraw?: boolean;
} = {}) {
  const cr = opts.changeRequest ?? baseCr;
  const order = opts.order ?? baseOrder;

  const orderFindUnique = vi.fn(async ({ where }: any) =>
    where.id === order.id ? order : null);
  const crFindUnique = vi.fn(async ({ where }: any) =>
    where.id === cr?.id ? cr : null);
  const crCreate = vi.fn(async ({ data }: any) => ({ ...data, createdAt: new Date(), updatedAt: new Date() }));
  const crUpdate = vi.fn(async ({ where, data }: any) => ({ ...cr, ...data, id: where.id }));
  const orderUpdate = vi.fn(async ({ where, data }: any) => ({ ...order, ...data, id: where.id }));
  const transitionCreate = vi.fn(async () => ({}));
  const auditCreate = vi.fn(async () => ({ id: 'AL-1' }));
  const approvalCreate = vi.fn(async () => ({
    id: 'ar_1', reviewerId: 'u_supervisor', status: 'pending',
  }));
  const approvalUpdateMany = vi.fn(async () => ({ count: 1 }));

  const prisma: any = {
    order: { findUnique: orderFindUnique, update: orderUpdate, findMany: vi.fn(async () => [order]) },
    orderChangeRequest: {
      count: vi.fn(async () => 0),
      create: opts.failCreate ? vi.fn(async () => { throw new Error('DB_FAIL'); }) : crCreate,
      findUnique: crFindUnique,
      update: crUpdate,
      findMany: vi.fn(async () => [cr]),
    },
    orderStatusTransition: { create: transitionCreate, findFirst: vi.fn(async () => null) },
    approvalRequest: {
      updateMany: approvalUpdateMany,
      findUnique: vi.fn(async () => null),
      create: approvalCreate,
      findFirst: vi.fn().mockResolvedValue(null),
    },
    auditLog: { create: auditCreate },
    // DR-007 审批路由解析（approvalRoutingService 真实实例走这些 mock）
    userAccount: { findFirst: vi.fn(async ({ where }: any) => ({ id: where.id, primaryDeptId: 'dept_1' })) },
    department: { findUnique: vi.fn(async () => ({ id: 'dept_1', status: 'active', headId: 'u_supervisor', parentId: null })) },
    userRole: { findMany: vi.fn(async () => []) },
    purchaseOrder: { count: vi.fn(async () => 0) },
    developmentCase: { findMany: vi.fn(async () => []) },
    sampleNode: { count: vi.fn(async () => 0) },
    productionStage: { count: vi.fn(async () => 0) },
    invoice: { count: vi.fn(async () => 0) },
    paymentVoucher: { count: vi.fn(async () => 0) },
    creditLimit: { findFirst: vi.fn(async () => null) },
    preCutChecklist: { updateMany: vi.fn(async () => ({ count: 1 })) },
    entityReference: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/order-changes', createOrderChangeRouter({ prisma, requireAuth: true }));

  return { app, prisma, crCreate, orderUpdate, crUpdate, transitionCreate };
}

beforeEach(() => {
  mockActor = {
    userId: 'u_sales',
    roles: ['sales'],
    permissions: ['order:change_request:create', 'order:change_request:apply'],
  };
});

describe('POST /api/v1/order-changes 创建', () => {
  it('无 JWT → 401（fail-closed）', async () => {
    mockActor = null;
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/order-changes')
      .send({ orderId: 'ORD__1', changeType: 'quantity', beforeSnapshot: { quantity: 200 }, afterDelta: { quantity: 180 }, changeReason: VALID_REASON, impactSummary: VALID_IMPACT });
    expect(res.status).toBe(401);
  });

  it('无 scope → 403 INSUFFICIENT_SCOPE（finance 角色无 order:change_request:create）', async () => {
    mockActor = { userId: 'u_fin', roles: ['finance'] };
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/order-changes')
      .send({ orderId: 'ORD__1', changeType: 'quantity', beforeSnapshot: { quantity: 200 }, afterDelta: { quantity: 180 }, changeReason: VALID_REASON, impactSummary: VALID_IMPACT });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('FORBIDDEN');
  });

  it('非法 changeType → 400 INVALID_CHANGE_TYPE', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/order-changes')
      .send({ orderId: 'ORD__1', changeType: 'bogus', beforeSnapshot: {}, afterDelta: {}, changeReason: VALID_REASON, impactSummary: VALID_IMPACT });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_CHANGE_TYPE');
  });

  it('未批准订单（Pending）→ 400 ORDER_NOT_APPROVED（service 层校验透传）', async () => {
    const { app } = makeApp({ order: { ...baseOrder, status: 'Pending' } });
    const res = await request(app)
      .post('/api/v1/order-changes')
      .send({ orderId: 'ORD__1', changeType: 'quantity', beforeSnapshot: { quantity: 200 }, afterDelta: { quantity: 180 }, changeReason: VALID_REASON, impactSummary: VALID_IMPACT });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDER_NOT_APPROVED');
  });

  it('成功路径 → 201 + changeRequest + approvalRequestId', async () => {
    const { app, crCreate } = makeApp();
    const res = await request(app)
      .post('/api/v1/order-changes')
      .send({ orderId: 'ORD__1', changeType: 'quantity', beforeSnapshot: { quantity: 200 }, afterDelta: { quantity: 180 }, changeReason: VALID_REASON, impactSummary: VALID_IMPACT });
    expect(res.status).toBe(201);
    expect(res.body.changeRequest).toBeTruthy();
    expect(res.body.approvalRequestId).toBe('ar_1');
    expect(crCreate).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/v1/order-changes 列表', () => {
  it('无 JWT → 401', async () => {
    mockActor = null;
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/order-changes');
    expect(res.status).toBe(401);
  });

  it('按 orderId 过滤 → 200 返回 items', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/order-changes?orderId=ORD__1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe('GET /api/v1/order-changes/:id 详情', () => {
  it('变更申请不存在 → 404', async () => {
    const { app } = makeApp({ changeRequest: null });
    const res = await request(app).get('/api/v1/order-changes/OCR_MISSING');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('正常返回 → 200 + item + order + approvalRequest', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/order-changes/OCR_1');
    expect(res.status).toBe(200);
    expect(res.body.item.id).toBe('OCR_1');
    expect(res.body.item.order).toBeTruthy();
    expect(res.body.item.approvalRequest).toBeFalsy(); // approvalRequestId 为 'ar_1' 时 mock 返回 null
  });
});

describe('POST /api/v1/order-changes/:id/apply', () => {
  it('无 scope order:change_request:apply → 403', async () => {
    mockActor = { userId: 'u_sales', roles: ['sales'] };
    const { app } = makeApp({ changeRequest: { ...baseCr, status: 'Approved' } });
    const res = await request(app).post('/api/v1/order-changes/OCR_1/apply').send({});
    expect(res.status).toBe(403);
  });

  it('重复 apply（幂等）→ 409 ALREADY_APPLIED', async () => {
    const { app } = makeApp({ changeRequest: { ...baseCr, status: 'Applied', appliedAt: new Date() } });
    const res = await request(app).post('/api/v1/order-changes/OCR_1/apply').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_APPLIED');
  });

  it('成功 apply → 200 + applied', async () => {
    const { app, orderUpdate } = makeApp({ changeRequest: { ...baseCr, status: 'Approved' } });
    const res = await request(app).post('/api/v1/order-changes/OCR_1/apply').send({});
    expect(res.status).toBe(200);
    expect(orderUpdate).toHaveBeenCalled();
  });
});

describe('POST /api/v1/order-changes/:id/withdraw', () => {
  it('非申请人撤回 → 403 WITHDRAW_NOT_BY_REQUESTER', async () => {
    const { app } = makeApp({ changeRequest: baseCr });
    mockActor = { userId: 'u_other', roles: ['sales'] };
    const res = await request(app).post('/api/v1/order-changes/OCR_1/withdraw').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WITHDRAW_NOT_BY_REQUESTER');
  });

  it('非 Pending（已 Approved）→ 409 CHANGE_REQUEST_NOT_PENDING', async () => {
    const { app } = makeApp({ changeRequest: { ...baseCr, status: 'Approved' } });
    const res = await request(app).post('/api/v1/order-changes/OCR_1/withdraw').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CHANGE_REQUEST_NOT_PENDING');
  });

  it('成功撤回 → 200 + 订单恢复 Confirmed（时间线回查 fromStatus）', async () => {
    const { app, orderUpdate, transitionCreate } = makeApp({
      changeRequest: { ...baseCr, changeTypes: ['other'] }, // cancel 申请（无 attachments.pause → cancel）
      order: { ...baseOrder, status: 'CancelRequested' },
    });
    const res = await request(app).post('/api/v1/order-changes/OCR_1/withdraw').send({});
    expect(res.status).toBe(200);
    expect(orderUpdate).toHaveBeenCalledTimes(1);
    expect(orderUpdate.mock.calls[0][0].data.status).toBe('Confirmed');
    expect(transitionCreate).toHaveBeenCalledTimes(1);
  });
});
