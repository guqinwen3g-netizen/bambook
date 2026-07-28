import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createOrderLinesRouter } from '../orderLinesRoute';

// JWT mock for write-op auth guard (requireRole + requireJwtForWrite).
// Signed with the same default secret as auth/service.ts.
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const ownerToken = jwt.sign({ userId: 'u1', roles: ['owner'] }, JWT_SECRET);
function auth() {
  return { Authorization: `Bearer ${ownerToken}` };
}

function makeApp(opts: {
  order?: any;
  line?: any;
  existingLine?: any; // for duplicate itemNo check
  txFail?: boolean;
  syncFail?: boolean;
  auditFail?: boolean;
} = {}) {
  const order = opts.order === undefined ? {
    id: 'ORD__1', poNumber: 'PO-1', customer: 'TestCustomer', type: 'fabric', deletedAt: null, lines: [],
  } : opts.order;
  const line = opts.line === undefined ? {
    id: 'ORD__1__0010', orderId: 'ORD__1', lineNumber: 1, itemNo: '0010', materialCode: 'PROD-1', quantity: 100, fieldSources: {}, status: 'Pending',
  } : opts.line;

  const lineCreate = vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, quantity: Number(data.quantity) }));
  const lineUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...line, ...data, id: where.id }));
  const lineFindUnique = vi.fn().mockImplementation(async ({ where }: any) => {
    if (where.id?.includes?.('UNKNOWN')) return null;
    if (where.orderId_itemNo) {
      // duplicate check: 只在 existingLine 匹配时返回，否则 null（不存在的 itemNo）
      return opts.existingLine && where.orderId_itemNo.itemNo === opts.existingLine.itemNo ? opts.existingLine : null;
    }
    return line;
  });
  const orderFindUnique = vi.fn().mockImplementation(async ({ where }: any) => {
    if (where.id && where.id !== 'ORD__1') return null;
    if (where.poNumber && where.poNumber !== 'PO-1') return null;
    return order;
  });
  const auditCreate = opts.auditFail ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT')) : vi.fn().mockResolvedValue({});
  const entityRefUpsert = opts.syncFail ? vi.fn().mockRejectedValue(new Error('SYNC_REJECT')) : vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});

  const lineFindMany = vi.fn().mockResolvedValue(opts.existingLine ? [{ itemNo: opts.existingLine.itemNo }] : []);
  const tx = {
    order: { findUnique: orderFindUnique },
    orderLine: { findUnique: lineFindUnique, findMany: lineFindMany, create: lineCreate, update: lineUpdate },
    auditLog: { create: auditCreate },
    entityReference: { upsert: entityRefUpsert },
    entityLink: { upsert: entityLinkUpsert },
  };

  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(order) },
    orderLine: { findUnique: vi.fn().mockResolvedValue(line), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: opts.txFail ? vi.fn().mockRejectedValue(new Error('TX_BOOM')) : vi.fn(async (fn: any) => fn(tx)),
  } as any;

  const onDataChange = vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/order-lines', createOrderLinesRouter({ prisma, requireAuth: false, apiKeys: new Set(), onDataChange }));
  return { app, tx, prisma, onDataChange, lineCreate, lineUpdate, auditCreate, entityRefUpsert };
}

describe('task ERP-P1 order-line-mutation: POST / create', () => {
  it('成功 → 200 + onDataChange + audit + sync + response 含 order/poNumber/customer（hydrate）', async () => {
    const { app, onDataChange, auditCreate, entityRefUpsert } = makeApp();
    const res = await request(app).post('/api/v1/order-lines/').set(auth()).send({ poNumber: 'PO-1', itemNo: '0020', materialCode: 'PROD-2', quantity: 50 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // 前端 serializeOrderLine 读 line.order/poNumber/customer
    expect(res.body.line.order).toBeTruthy();
    expect(res.body.line.poNumber).toBe('PO-1');
    expect(res.body.line.customer).toBe('TestCustomer');
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(entityRefUpsert).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('默认 itemNo 生成（existingLines=[] 不传 itemNo → 0010）+ audit after.itemNo 一致', async () => {
    const { app, auditCreate } = makeApp();
    const res = await request(app).post('/api/v1/order-lines/').set(auth()).send({ poNumber: 'PO-1', materialCode: 'PROD-3', quantity: 30 });
    expect(res.status).toBe(200);
    expect(res.body.line.itemNo).toBe('0010');
    expect(res.body.line.id).toBe('ORD__1__0010');
    const auditCall = (auditCreate as any).mock.calls[0][0];
    expect(auditCall.data.detail.after.itemNo).toBe('0010');
    expect(auditCall.data.detail.after.id).toBe('ORD__1__0010');
  });

  it('默认 itemNo 生成（existingLines=[0010] 不传 itemNo → 0020）', async () => {
    const { app } = makeApp({ existingLine: { itemNo: '0010' } });
    // existingLine 让 findMany 返回 [{itemNo:'0010'}]，nextItemNo → 0020
    const res = await request(app).post('/api/v1/order-lines/').set(auth()).send({ poNumber: 'PO-1', materialCode: 'PROD-3', quantity: 30 });
    expect(res.status).toBe(200);
    expect(res.body.line.itemNo).toBe('0020');
  });

  it('ORDER_NOT_FOUND（parent order 不存在）→ 404', async () => {
    const { app } = makeApp({ order: null });
    const res = await request(app).post('/api/v1/order-lines/').set(auth()).send({ poNumber: 'PO-MISSING', itemNo: '0010', quantity: 10 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ORDER_NOT_FOUND');
  });

  it('parent order deletedAt → 404', async () => {
    const { app } = makeApp({ order: { id: 'ORD__1', poNumber: 'PO-1', type: 'fabric', deletedAt: 1000, lines: [] } });
    const res = await request(app).post('/api/v1/order-lines/').set(auth()).send({ poNumber: 'PO-1', itemNo: '0010', quantity: 10 });
    expect(res.status).toBe(404);
  });

  it('DUPLICATE_ITEM_NO → 409', async () => {
    const { app } = makeApp({ existingLine: { itemNo: '0010' } });
    const res = await request(app).post('/api/v1/order-lines/').set(auth()).send({ poNumber: 'PO-1', itemNo: '0010', quantity: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_ITEM_NO');
  });

  it('sync reject → CREATE_LINE_FAILED（事务回滚，fail closed）', async () => {
    const { app, onDataChange } = makeApp({ syncFail: true });
    const res = await request(app).post('/api/v1/order-lines/').set(auth()).send({ poNumber: 'PO-1', itemNo: '0020', materialCode: 'PROD-2', quantity: 10 });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CREATE_LINE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit reject → CREATE_LINE_FAILED（事务回滚）', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).post('/api/v1/order-lines/').set(auth()).send({ poNumber: 'PO-1', itemNo: '0020', quantity: 10 });
    expect(res.status).toBe(500);
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1 order-line-mutation: PUT /:id update', () => {
  it('成功 → 200 + onDataChange + audit + response 含 order/poNumber/customer（hydrate）', async () => {
    const { app, onDataChange, auditCreate } = makeApp();
    const res = await request(app).put('/api/v1/order-lines/ORD__1__0010').set(auth()).send({ materialCode: 'PROD-NEW', quantity: 200 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.line.order).toBeTruthy();
    expect(res.body.line.poNumber).toBe('PO-1');
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('ORDER_LINE_NOT_FOUND → 404', async () => {
    const { app } = makeApp({ line: null });
    const res = await request(app).put('/api/v1/order-lines/UNKNOWN').set(auth()).send({ quantity: 200 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ORDER_LINE_NOT_FOUND');
  });

  it('sync reject → UPDATE_LINE_FAILED（事务回滚）', async () => {
    const { app, onDataChange } = makeApp({ syncFail: true });
    const res = await request(app).put('/api/v1/order-lines/ORD__1__0010').set(auth()).send({ materialCode: 'PROD-NEW' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('UPDATE_LINE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit reject → UPDATE_LINE_FAILED（事务回滚）', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).put('/api/v1/order-lines/ORD__1__0010').set(auth()).send({ quantity: 200 });
    expect(res.status).toBe(500);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('空 patch → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/v1/order-lines/ORD__1__0010').set(auth()).send({});
    expect(res.status).toBe(400);
  });
});
