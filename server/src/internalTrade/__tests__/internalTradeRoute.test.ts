import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createInternalTradeRouter } from '../internalTradeRoute';
import { encodeInternalTransferPayload, type InternalTransferPayload } from '../internalTransferService';

/**
 * DR-033 内部供料单路由契约测试：
 *   POST /            — 401 / 403 scope / 400 必填 / 201
 *   POST /:id/confirm — 403 / 409 未批准结算价 / 200
 *   POST /:id/delivery— 403 / 409 超发 / 200
 *   POST /:id/cancel  — 403 / 200
 *   GET  /            — 401 / 400 非法状态 / 200 过滤
 *   GET  /:id         — 404 / 200
 */

let mockActor: { userId: string; roles: string[]; permissions?: string[] } | null = {
  userId: 'u_sales',
  roles: ['sales'],
  permissions: ['order:internal_trade:write'],
};

vi.mock('../../auth/middleware', () => ({
  extractActorFromRequest: () => mockActor,
}));

const GARMENT_ORDER = { id: 'G1', deletedAt: null, isInternalFabricTrade: false, businessLine: 'garment' };
const FABRIC_ORDER = { id: 'F1', deletedAt: null, isInternalFabricTrade: true, businessLine: 'fabric', internalCounterpartyId: 'CP-INTERNAL' };

function makePayload(overrides: Partial<InternalTransferPayload> = {}): InternalTransferPayload {
  return {
    docType: 'DR033_INTERNAL_FABRIC_SUPPLY',
    role: 'master',
    masterId: 'OIT__M1',
    mirrorId: 'OIT__R1',
    requestDepartmentId: 'dept_garment',
    supplyDepartmentId: 'dept_fabric',
    garmentOrderId: 'G1',
    fabricOrderId: 'F1',
    materialCode: 'M100',
    quantity: 1000,
    unit: 'm',
    settlementPrice: 30,
    settlementApprovalId: 'ar_1',
    dueDate: '2026-09-01',
    status: 'PendingConfirm',
    confirmedQuantity: null,
    confirmedDueDate: null,
    confirmedBy: null,
    confirmedAt: null,
    deliveries: [],
    history: [],
    ...overrides,
  };
}

function makeApp(opts: {
  transfers?: any[];
  approvals?: any[];
  shipments?: any[];
  orders?: any[];
} = {}) {
  const transfers: any[] = opts.transfers ?? [];
  const approvals: any[] = opts.approvals ?? [];
  const shipments: any[] = opts.shipments ?? [];
  const orders: any[] = opts.orders ?? [{ ...GARMENT_ORDER }, { ...FABRIC_ORDER }];
  const orderLines: any[] = [];

  const matchWhere = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => row[k] === v);

  const prisma: any = {
    order: {
      findUnique: vi.fn(async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null),
    },
    orderInternalTransfer: {
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, createdAt: new Date(), updatedAt: new Date(), deletedAt: null };
        transfers.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => transfers.find((t) => t.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => transfers.find((t) => matchWhere(t, where)) ?? null),
      findMany: vi.fn(async ({ where }: any = {}) => transfers.filter((t) => matchWhere(t, where))),
      update: vi.fn(async ({ where, data }: any) => {
        const row = transfers.find((t) => t.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
    orderLine: { updateMany: vi.fn(async () => ({ count: 1 })) },
    shipment: { findUnique: vi.fn(async ({ where }: any) => shipments.find((s) => s.id === where.id) ?? null) },
    approvalRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(async ({ where }: any) => approvals.find((a) => a.id === where.id) ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: any) => ({ ...data, id: 'ar_1' })),
    },
    auditLog: { create: vi.fn(async () => ({ id: 'AL-1' })) },
    // DR-007 审批路由解析（approvalRoutingService 真实实例走这些 mock）
    userAccount: { findFirst: vi.fn(async ({ where }: any) => ({ id: where.id, primaryDeptId: 'dept_1' })) },
    department: { findUnique: vi.fn(async () => ({ id: 'dept_1', status: 'active', headId: 'u_mgr', parentId: null })) },
    userRole: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/internal-trade', createInternalTradeRouter({ prisma, requireAuth: true }));
  return { app, prisma, transfers };
}

const VALID_BODY = {
  requestDepartmentId: 'dept_garment',
  supplyDepartmentId: 'dept_fabric',
  garmentOrderId: 'G1',
  fabricOrderId: 'F1',
  materialCode: 'M100',
  quantity: 1000,
  settlementPrice: 30,
  dueDate: '2026-09-01',
};

beforeEach(() => {
  mockActor = { userId: 'u_sales', roles: ['sales'], permissions: ['order:internal_trade:write'] };
});

describe('POST /api/v1/internal-trade 发起', () => {
  it('无 JWT → 401（fail-closed）', async () => {
    mockActor = null;
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/internal-trade').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('无 scope → 403 INSUFFICIENT_SCOPE（sales 角色无 permissions 时矩阵不含该 scope）', async () => {
    mockActor = { userId: 'u_qc', roles: ['qc'] };
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/internal-trade').send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('FORBIDDEN');
  });

  it('必填缺失 → 400 MISSING_REQUIRED_FIELD', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/internal-trade').send({ garmentOrderId: 'G1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_REQUIRED_FIELD');
  });

  it('成功发起 → 201 + transfer + mirror + approvalRequestId', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/internal-trade').send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.transfer).toBeTruthy();
    expect(res.body.mirror).toBeTruthy();
    expect(res.body.approvalRequestId).toBe('ar_1');
    expect(res.body.payload.status).toBe('PendingConfirm');
  });
});

describe('POST /api/v1/internal-trade/:id/confirm 确认生效', () => {
  const pendingTransfer = {
    id: 'OIT__M1', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
    transferAmount: 30000, transferCurrency: 'CNY', memo: encodeInternalTransferPayload(makePayload()),
  };

  it('无 scope → 403', async () => {
    mockActor = { userId: 'u_sales', roles: ['sales'] };
    const { app } = makeApp({ transfers: [{ ...pendingTransfer }], approvals: [{ id: 'ar_1', status: 'approved' }] });
    const res = await request(app).post('/api/v1/internal-trade/OIT__M1/confirm').send({});
    expect(res.status).toBe(403);
  });

  it('结算价未批准 → 409 SETTLEMENT_PRICE_NOT_APPROVED', async () => {
    const { app } = makeApp({ transfers: [{ ...pendingTransfer }], approvals: [{ id: 'ar_1', status: 'pending' }] });
    const res = await request(app).post('/api/v1/internal-trade/OIT__M1/confirm').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SETTLEMENT_PRICE_NOT_APPROVED');
  });

  it('审批通过 → 200 Effective', async () => {
    const { app, transfers } = makeApp({
      transfers: [{ ...pendingTransfer }, { ...pendingTransfer, id: 'OIT__R1', orderId: 'F1', transferDirection: 'outgoing', memo: encodeInternalTransferPayload(makePayload({ role: 'mirror' })) }],
      approvals: [{ id: 'ar_1', status: 'approved' }],
    });
    const res = await request(app).post('/api/v1/internal-trade/OIT__M1/confirm').send({});
    expect(res.status).toBe(200);
    expect(res.body.payload.status).toBe('Effective');
    expect(transfers.find((t) => t.id === 'OIT__M1').recognizedBy).toBe('u_sales');
  });
});

describe('POST /api/v1/internal-trade/:id/delivery 交付登记', () => {
  const effectiveTransfer = {
    id: 'OIT__M1', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
    transferAmount: 30000, transferCurrency: 'CNY',
    memo: encodeInternalTransferPayload(makePayload({ status: 'Effective', confirmedQuantity: 1000, confirmedDueDate: '2026-09-01' })),
  };
  const shipment = { id: 'SH1', shipmentNumber: 'SHP-1', orderId: 'F1', status: 'Shipped', deletedAt: null };

  it('无 scope → 403', async () => {
    mockActor = { userId: 'u_sales', roles: ['sales'] };
    const { app } = makeApp({ transfers: [{ ...effectiveTransfer }], shipments: [shipment] });
    const res = await request(app).post('/api/v1/internal-trade/OIT__M1/delivery').send({ shipmentId: 'SH1', quantity: 100 });
    expect(res.status).toBe(403);
  });

  it('超发 → 409 OVER_DELIVERY', async () => {
    const { app } = makeApp({ transfers: [{ ...effectiveTransfer }], shipments: [shipment] });
    const res = await request(app).post('/api/v1/internal-trade/OIT__M1/delivery').send({ shipmentId: 'SH1', quantity: 1001 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('OVER_DELIVERY');
  });

  it('成功登记 → 200 Delivering + delivery 明细', async () => {
    const { app } = makeApp({
      transfers: [{ ...effectiveTransfer }, { ...effectiveTransfer, id: 'OIT__R1', orderId: 'F1', transferDirection: 'outgoing', memo: encodeInternalTransferPayload(makePayload({ role: 'mirror', status: 'Effective', confirmedQuantity: 1000 })) }],
      shipments: [shipment],
    });
    const res = await request(app)
      .post('/api/v1/internal-trade/OIT__M1/delivery')
      .send({ shipmentId: 'SH1', quantity: 600, receivedQuantity: 580, deliveryDate: '2026-08-20' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Delivering');
    expect(res.body.cumulativeDelivered).toBe(600);
    expect(res.body.delivery.variance).toBe(-20);
  });
});

describe('POST /api/v1/internal-trade/:id/cancel 取消', () => {
  it('PendingConfirm → 200 Cancelled', async () => {
    const pendingTransfer = {
      id: 'OIT__M1', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
      transferAmount: 30000, memo: encodeInternalTransferPayload(makePayload()),
    };
    const mirror = { ...pendingTransfer, id: 'OIT__R1', orderId: 'F1', transferDirection: 'outgoing', memo: encodeInternalTransferPayload(makePayload({ role: 'mirror' })) };
    const { app } = makeApp({ transfers: [pendingTransfer, mirror], approvals: [{ id: 'ar_1', status: 'pending' }] });
    const res = await request(app).post('/api/v1/internal-trade/OIT__M1/cancel').send({ reason: '需求取消' });
    expect(res.status).toBe(200);
    expect(res.body.payload.status).toBe('Cancelled');
  });
});

describe('GET /api/v1/internal-trade 列表与详情', () => {
  it('无 JWT → 401', async () => {
    mockActor = null;
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/internal-trade');
    expect(res.status).toBe(401);
  });

  it('非法 status → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/internal-trade?status=Bogus');
    expect(res.status).toBe(400);
  });

  it('按状态过滤 → 200 items', async () => {
    const pendingTransfer = {
      id: 'OIT__M1', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
      ourDepartmentId: 'dept_garment', counterpartyId: 'dept_fabric',
      transferAmount: 30000, memo: encodeInternalTransferPayload(makePayload()), createdAt: new Date(),
    };
    const { app } = makeApp({ transfers: [pendingTransfer] });
    const res = await request(app).get('/api/v1/internal-trade?status=PendingConfirm&departmentId=dept_garment');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const res2 = await request(app).get('/api/v1/internal-trade?status=Effective');
    expect(res2.body.total).toBe(0);
  });

  it('详情不存在 → 404；存在 → 200（item + mirror + payload）', async () => {
    const pendingTransfer = {
      id: 'OIT__M1', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
      transferAmount: 30000, memo: encodeInternalTransferPayload(makePayload()),
    };
    const mirror = { ...pendingTransfer, id: 'OIT__R1', orderId: 'F1', transferDirection: 'outgoing' };
    const { app } = makeApp({ transfers: [pendingTransfer, mirror] });
    const missing = await request(app).get('/api/v1/internal-trade/OIT__X');
    expect(missing.status).toBe(404);
    const res = await request(app).get('/api/v1/internal-trade/OIT__M1');
    expect(res.status).toBe(200);
    expect(res.body.item.id).toBe('OIT__M1');
    expect(res.body.mirror.id).toBe('OIT__R1');
    expect(res.body.payload.garmentOrderId).toBe('G1');
  });
});
