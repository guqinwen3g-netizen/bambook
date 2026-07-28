import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDevelopmentRouter } from '../route';
import { authHeader } from '../../__tests__/authTestHelper';

function makeDevCase(overrides: any = {}) {
  return {
    id: 'DC__1', code: 'DC-001', name: 'Test Case', type: 'fabric', stage: 'developing',
    priority: 'normal', customerRelationId: 'R1', customerName: 'Cust',
    supplierRelationId: 'R2', supplierName: 'Supp', productAssetId: 'P1', productName: 'Prod',
    linkedOrderId: null, convertedAt: null, deletedAt: null,
    createdAt: BigInt(0), updatedAt: BigInt(0),
    ...overrides,
  };
}

function makeConvertApp(opts: {
  existingCase?: any;
  orderExists?: boolean;
  syncFail?: boolean;
  auditFail?: boolean;
  txFail?: boolean;
} = {}) {
  const existingCase = opts.existingCase === undefined ? makeDevCase() : opts.existingCase;
  const devCaseUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...existingCase, ...data, id: where.id, code: existingCase.code || 'DC-001', tags: data.tags || [], createdAt: existingCase.createdAt || BigInt(0), updatedAt: data.updatedAt || BigInt(0) }));

  const orderCreate = vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: data.id }));
  const orderLineCreate = vi.fn().mockResolvedValue({});
  // prisma.order.findUnique（事务外，link 模式校验）与 tx.order.findUnique（事务内）分离
  const prismaOrderFindUnique = vi.fn().mockResolvedValue(opts.orderExists ? { id: 'ORD-EXIST' } : null);
  const txOrderFindUnique = vi.fn().mockResolvedValue({
    id: 'ORD-EXIST', poNumber: 'PO-001', customer: 'Cust', product: 'Prod',
    customerRelationId: 'R1', millName: 'Supp', millRelationId: 'R2',
    importedAt: BigInt(0), createdAt: BigInt(0), updatedAt: BigInt(0),
  });

  const auditCreate = opts.auditFail ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT')) : vi.fn().mockResolvedValue({});
  const entityRefUpsert = opts.syncFail ? vi.fn().mockRejectedValue(new Error('SYNC_REJECT')) : vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});
  const entityLinkFindMany = vi.fn().mockResolvedValue([]);
  const entityLinkUpdate = vi.fn().mockResolvedValue({});

  const tx = {
    developmentCase: { update: devCaseUpdate },
    order: { create: orderCreate, findUnique: txOrderFindUnique },
    orderLine: { create: orderLineCreate },
    auditLog: { create: auditCreate },
    entityReference: { upsert: entityRefUpsert },
    entityLink: { upsert: entityLinkUpsert, findMany: entityLinkFindMany, update: entityLinkUpdate },
  };

  const prisma = {
    developmentCase: { findFirst: vi.fn().mockResolvedValue(existingCase) },
    order: { findUnique: prismaOrderFindUnique },
    $transaction: opts.txFail
      ? vi.fn().mockRejectedValue(new Error('TX_BOOM'))
      : vi.fn(async (fn: any) => fn(tx)),
  } as any;

  const onDataChange = vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/development', createDevelopmentRouter({ prisma, requireAuth: false, apiKeys: new Set(), onDataChange }));
  return { app, tx, prisma, onDataChange, devCaseUpdate, orderCreate, auditCreate, entityLinkUpsert };
}

describe('task ERP-P1 dev-convert: POST /:id/convert 成功路径', () => {
  it('autoCreate → 200 + DevCase update + Order create + sync + audit（同事务）', async () => {
    const { app, devCaseUpdate, orderCreate, auditCreate } = makeConvertApp();
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true, quantity: 100 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.case.stage).toBe('approved');
    expect(res.body.case.linkedOrderId).toBeTruthy();
    expect(res.body.order).toBeTruthy();
    // 事务内调用
    expect(devCaseUpdate).toHaveBeenCalledTimes(1);
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1); // audit 写入
  });

  it('link 模式（传 orderId）→ 200 + 不创建新 order', async () => {
    const { app, orderCreate } = makeConvertApp({ orderExists: true });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ orderId: 'ORD-EXIST', orderPo: 'PO-001' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.order).toBeNull(); // link 模式不返回 createdOrder
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1 dev-convert: fail closed（error code 稳定）', () => {
  it('DEV_CASE_NOT_FOUND（case 不存在）→ 404', async () => {
    const { app } = makeConvertApp({ existingCase: null });
    const res = await request(app).post('/api/v1/development/NOPE/convert').set(authHeader()).send({ autoCreate: true });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DEV_CASE_NOT_FOUND');
  });

  it('ALREADY_CONVERTED（已 linkedOrderId）→ 409', async () => {
    const { app } = makeConvertApp({ existingCase: makeDevCase({ linkedOrderId: 'ORD-OLD' }) });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_CONVERTED');
  });

  it('CASE_CANCELLED（stage=cancelled 终态）→ 400（区分 已linked=409 vs cancelled=400）', async () => {
    const { app } = makeConvertApp({ existingCase: makeDevCase({ stage: 'cancelled' }) });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CASE_CANCELLED');
  });

  it('ORDER_NOT_FOUND（link 模式 order 不存在）→ 404', async () => {
    const { app } = makeConvertApp({ orderExists: false });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ orderId: 'ORD-MISSING', orderPo: 'PO-1' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('INVALID_INPUT（link 模式无 orderId）→ 400', async () => {
    const { app } = makeConvertApp();
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ orderPo: 'PO-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });
});

describe('task ERP-P1 dev-convert: 事务失败 fail closed（不伪成功）', () => {
  it('sync reject → CONVERT_FAILED（事务回滚）', async () => {
    const { app } = makeConvertApp({ syncFail: true });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CONVERT_FAILED');
  });

  it('audit reject → CONVERT_FAILED（事务回滚，不静默成功）', async () => {
    const { app } = makeConvertApp({ auditFail: true });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CONVERT_FAILED');
  });

  it('tx boom → CONVERT_FAILED', async () => {
    const { app } = makeConvertApp({ txFail: true });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CONVERT_FAILED');
  });
});

describe('task ERP-P1 dev-convert: onDataChange 事务成功后触发', () => {
  it('成功后 onDataChange 被调用', async () => {
    const { app, onDataChange } = makeConvertApp();
    await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true });
    expect(onDataChange).toHaveBeenCalled();
  });

  it('事务失败 → onDataChange 不被调用', async () => {
    const { app, onDataChange } = makeConvertApp({ syncFail: true });
    await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true });
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1 dev-convert: EntityLink 行为（同事务 sync）', () => {
  it('autoCreate → syncOrderEntityReferences + syncDevelopmentCaseReferences 调用（entityLink.upsert 多次）', async () => {
    const { app, entityLinkUpsert } = makeConvertApp();
    await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ autoCreate: true });
    // Order sync（orderedBy + suppliedBy）+ DevCase sync（developFor + developBy + aboutProduct）
    expect(entityLinkUpsert.mock.calls.length).toBeGreaterThan(0);
  });
});


describe('task ERP-P1 dev-convert review-fix: link 模式 Order EntityLink 维护', () => {
  it('link 模式 → 事务内读 linked Order + 调 syncOrderEntityReferences（精确断言 order EntityLink payload）', async () => {
    const { app, entityLinkUpsert } = makeConvertApp({ orderExists: true });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ orderId: 'ORD-EXIST', orderPo: 'PO-001' });
    expect(res.status).toBe(200);
    // 精确断言：至少有一条 entityLink.upsert 的 payload 含 fromType='order' + fromId='ORD-EXIST'
    // （区分 Order sync 与 DevelopmentCase sync，后者 fromType='development-case'）
    const orderLinks = entityLinkUpsert.mock.calls.filter((call: any) => {
      const data = call[0]?.create || call[0]?.data || {};
      return data.fromType === 'order' && data.fromId === 'ORD-EXIST';
    });
    expect(orderLinks.length).toBeGreaterThan(0);
    // 进一步断言 orderedBy（customer R1）或 suppliedBy（mill R2）存在
    const linkKinds = orderLinks.map((call: any) => (call[0]?.create || call[0]?.data || {}).linkKind);
    expect(linkKinds).toEqual(expect.arrayContaining(['orderedBy', 'suppliedBy']));
  });

  it('link 模式 Order 不存在 → ORDER_NOT_FOUND（事务前校验）', async () => {
    const { app } = makeConvertApp({ orderExists: false });
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ orderId: 'ORD-MISSING', orderPo: 'PO-1' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('link 模式 Order 事务内缺失（tx.findUnique null）→ CONVERT_FAILED（fail closed，不伪成功）', async () => {
    // prisma.order.findUnique 通过校验，但 tx.order.findUnique 返回 null → 事务内 fail closed
    const tx = {
      developmentCase: { update: vi.fn().mockResolvedValue({ id: 'DC__1', stage: 'approved', createdAt: BigInt(0), updatedAt: BigInt(0), tags: [] }) },
      order: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) }, // 事务内返回 null
      orderLine: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      entityReference: { upsert: vi.fn().mockResolvedValue({}) },
      entityLink: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      developmentCase: { findFirst: vi.fn().mockResolvedValue(makeDevCase()) },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'ORD-EXIST' }) }, // 事务外通过
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/development', createDevelopmentRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ orderId: 'ORD-EXIST', orderPo: 'PO-1' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CONVERT_FAILED');
    // audit 不应落盘（事务回滚）
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('link 模式 Order sync reject → CONVERT_FAILED（事务回滚，不 audit 不 onDataChange）', async () => {
    const tx = {
      developmentCase: { update: vi.fn().mockResolvedValue({ id: 'DC__1', stage: 'approved', createdAt: BigInt(0), updatedAt: BigInt(0), tags: [] }) },
      order: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 'ORD-EXIST', customerRelationId: 'R1', millRelationId: 'R2' }) },
      orderLine: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      entityReference: { upsert: vi.fn().mockRejectedValue(new Error('SYNC_REJECT')) }, // sync 失败
      entityLink: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
    };
    const onDataChange = vi.fn();
    const prisma = {
      developmentCase: { findFirst: vi.fn().mockResolvedValue(makeDevCase()) },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'ORD-EXIST' }) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/development', createDevelopmentRouter({ prisma, requireAuth: false, apiKeys: new Set(), onDataChange }));
    const res = await request(app).post('/api/v1/development/DC__1/convert').set(authHeader()).send({ orderId: 'ORD-EXIST', orderPo: 'PO-1' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CONVERT_FAILED');
    expect(tx.auditLog.create).not.toHaveBeenCalled(); // audit 未落盘
    expect(onDataChange).not.toHaveBeenCalled(); // onDataChange 未触发
  });
});
