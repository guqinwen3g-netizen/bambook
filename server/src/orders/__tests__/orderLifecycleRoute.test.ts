import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createOrdersRouter } from '../route';

// JWT mock for write-op auth guard (requireRole + requireJwtForWrite).
// Signed with the same default secret as auth/service.ts.
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const ownerToken = jwt.sign({ userId: 'u1', roles: ['owner'] }, JWT_SECRET);
function auth() {
  return { Authorization: `Bearer ${ownerToken}` };
}

function makeLifecycleApp(opts: {
  order?: any;
  txFail?: boolean;
  syncFail?: boolean;
  syncOrderFail?: boolean;
  auditFail?: boolean;
} = {}) {
  const order = opts.order === undefined ? {
    id: 'ORD__1', status: 'Pending', deletedAt: null, createdAt: BigInt(0), updatedAt: BigInt(0),
  } : opts.order;

  const orderUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...order, ...data, id: where.id }));
  const statusTransitionCreate = vi.fn().mockResolvedValue({});
  const auditCreate = opts.auditFail ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT')) : vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});
  const entityLinkFindMany = vi.fn().mockResolvedValue([{ id: 'L1', fromType: 'order', fromId: 'ORD__1', status: 'active' }]);
  const entityLinkUpdate = opts.syncFail ? vi.fn().mockRejectedValue(new Error('SYNC_REJECT')) : vi.fn().mockResolvedValue({});
  const entityRefFindMany = vi.fn().mockResolvedValue([]);
  const entityRefUpdate = vi.fn().mockResolvedValue({});
  const entityRefUpsert = opts.syncOrderFail ? vi.fn().mockRejectedValue(new Error('SYNC_ORDER_REJECT')) : vi.fn().mockResolvedValue({});

  const tx = {
    order: { findUnique: vi.fn().mockResolvedValue(order), update: orderUpdate },
    orderStatusTransition: { create: statusTransitionCreate },
    auditLog: { create: auditCreate },
    entityLink: { upsert: entityLinkUpsert, findMany: entityLinkFindMany, update: entityLinkUpdate },
    entityReference: { upsert: entityRefUpsert, findMany: entityRefFindMany, update: entityRefUpdate },
    // deleteOrder checks for dependent invoices/shipments/vouchers before soft-deleting
    invoice: { count: vi.fn().mockResolvedValue(0) },
    shipment: { count: vi.fn().mockResolvedValue(0) },
    paymentVoucher: { count: vi.fn().mockResolvedValue(0) },
  };

  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(order), findMany: vi.fn().mockResolvedValue(order ? [order] : []) },
    $transaction: opts.txFail ? vi.fn().mockRejectedValue(new Error('TX_BOOM')) : vi.fn(async (fn: any) => fn(tx)),
  } as any;

  const onDataChange = vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/orders', createOrdersRouter({ prisma, requireAuth: false, apiKeys: new Set(), onDataChange }));
  return { app, tx, prisma, onDataChange, orderUpdate, statusTransitionCreate, auditCreate, entityLinkUpdate };
}

describe('task ERP-P1 order-lifecycle: DELETE /:id 软删', () => {
  it('成功 → 200 + onDataChange 触发 + response 含 serializeOrder', async () => {
    const { app, onDataChange, auditCreate } = makeLifecycleApp();
    const res = await request(app).delete('/api/v1/orders/ORD__1').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.order).toBeTruthy();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('ORDER_NOT_FOUND → 404', async () => {
    const { app } = makeLifecycleApp({ order: null });
    const res = await request(app).delete('/api/v1/orders/NOPE').set(auth());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('ORDER_ALREADY_DELETED（重复删除）→ 409', async () => {
    const { app } = makeLifecycleApp({ order: { id: 'ORD__1', status: 'Pending', deletedAt: BigInt(Date.now()) } });
    const res = await request(app).delete('/api/v1/orders/ORD__1').set(auth());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_ALREADY_DELETED');
  });

  it('sync reject → DELETE_FAILED（事务回滚）', async () => {
    const { app } = makeLifecycleApp({ syncFail: true });
    const res = await request(app).delete('/api/v1/orders/ORD__1').set(auth());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DELETE_FAILED');
  });

  it('失败路径 onDataChange 不调用（DELETE ORDER_NOT_FOUND）', async () => {
    const { app, onDataChange } = makeLifecycleApp({ order: null });
    await request(app).delete('/api/v1/orders/NOPE').set(auth());
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit reject → DELETE_FAILED（事务回滚）', async () => {
    const { app } = makeLifecycleApp({ auditFail: true });
    const res = await request(app).delete('/api/v1/orders/ORD__1').set(auth());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DELETE_FAILED');
  });

  it('EntityLink inactive：delete → entityLink.update 被调用', async () => {
    const { app, entityLinkUpdate } = makeLifecycleApp();
    await request(app).delete('/api/v1/orders/ORD__1').set(auth());
    expect(entityLinkUpdate).toHaveBeenCalled();
  });
});

describe('task ERP-P1 order-lifecycle: POST /:id/status-transition', () => {
  it('成功 → 200 + transition + onDataChange', async () => {
    const { app, statusTransitionCreate, onDataChange } = makeLifecycleApp();
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Confirmed', note: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(statusTransitionCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('INVALID_STATUS（非法状态）→ 400', async () => {
    const { app } = makeLifecycleApp();
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Cancelled' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('INVALID_STATUS（空 toStatus）→ 400', async () => {
    const { app } = makeLifecycleApp();
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('NO_CHANGE（相同状态）→ 400', async () => {
    const { app } = makeLifecycleApp({ order: { id: 'ORD__1', status: 'Confirmed', deletedAt: null } });
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Confirmed' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CHANGE');
  });

  it('ORDER_NOT_FOUND → 404', async () => {
    const { app } = makeLifecycleApp({ order: null });
    const res = await request(app).post('/api/v1/orders/NOPE/status-transition').set(auth()).send({ toStatus: 'Confirmed' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('deleted order → 404（status-transition 拒绝）', async () => {
    const { app } = makeLifecycleApp({ order: { id: 'ORD__1', status: 'Pending', deletedAt: BigInt(Date.now()) } });
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Confirmed' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('audit reject → TRANSITION_FAILED（事务回滚）', async () => {
    const { app } = makeLifecycleApp({ auditFail: true });
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Confirmed' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('TRANSITION_FAILED');
  });

  it('syncOrderEntityReferences reject → TRANSITION_FAILED（事务回滚）', async () => {
    // order 含 customerRelationId 让 syncOrderEntityReferences 产生 entityReference.upsert 调用
    const { app } = makeLifecycleApp({ syncOrderFail: true, order: { id: 'ORD__1', status: 'Pending', deletedAt: null, customerRelationId: 'R1', millRelationId: 'R2' } });
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Confirmed' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('TRANSITION_FAILED');
  });

  it('失败路径 onDataChange 不调用（status-transition INVALID_STATUS）', async () => {
    const { app, onDataChange } = makeLifecycleApp();
    await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Bogus' });
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('status-transition 成功 → response 含完整 transition + serializeOrder', async () => {
    const { app } = makeLifecycleApp();
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Confirmed', note: 'test note' });
    expect(res.status).toBe(200);
    expect(res.body.transition.fromStatus).toBe('Pending');
    expect(res.body.transition.toStatus).toBe('Confirmed');
    expect(res.body.transition.note).toBe('test note');
    expect(res.body.transition.lineId).toBeNull();
    expect(res.body.order).toBeTruthy();
  });

  it('status-transition lineId 透传 → response transition.lineId 非空', async () => {
    // Pending → Production 不是合法转移；用 Confirmed → Production 测试 lineId 透传
    const { app } = makeLifecycleApp({ order: { id: 'ORD__1', status: 'Confirmed', deletedAt: null, createdAt: BigInt(0), updatedAt: BigInt(0) } });
    const res = await request(app).post('/api/v1/orders/ORD__1/status-transition').set(auth()).send({ toStatus: 'Production', lineId: 'OL__1' });
    expect(res.status).toBe(200);
    expect(res.body.transition.lineId).toBe('OL__1');
  });
});
