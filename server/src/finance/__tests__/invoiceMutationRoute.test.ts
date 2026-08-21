import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { createFinanceRouter } from '../route';
import { authHeader } from '../../__tests__/authTestHelper';

function makeApp(opts: { invoice?: any; syncFail?: boolean; auditFail?: boolean; onDataChange?: any } = {}) {
  const invoice = opts.hasOwnProperty('invoice') ? opts.invoice : { id: 'INV__1', invoiceNumber: 'INV-1', type: 'Receivable', status: 'Issued', amount: new Prisma.Decimal('100.0000'), currency: 'USD', issueDate: '2026-07-02', exchangeRate: null, deletedAt: null };
  const invoiceCreate = vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: 'INV__NEW' }));
  const invoiceUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...(invoice || {}), ...data, id: where.id }));
  const invoiceFindUnique = vi.fn().mockResolvedValue(invoice);
  const auditCreate = opts.auditFail ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT')) : vi.fn().mockResolvedValue({ id: 'AL-1' });
  const entityReferenceUpsert = opts.syncFail ? vi.fn().mockRejectedValue(new Error('SYNC_REJECT')) : vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});
  const orderFindMany = vi.fn().mockResolvedValue([
      { id: 'O1', code: 'SO-202608-001', poNumber: 'PO-1' },
      { id: 'O2', code: 'SO-202608-002', poNumber: null },
    ]);
  const orderAllocCreate = vi.fn().mockResolvedValue({});
  const orderAllocUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  // CI 级模板数据源 mock：出口商档案（SystemConfig 未配置 → 默认档案）/ 交易对手 / 订单 / 订单行明细 / 出运单
  const systemConfigFindUnique = vi.fn().mockResolvedValue(null);
  const relationFindUnique = vi.fn().mockResolvedValue(null);
  const orderLinesFindMany = vi.fn().mockResolvedValue([
    { orderId: 'O1', lineNumber: 1, itemNo: 'ART-001', description: 'Navy Wool Twill', quantity: new Prisma.Decimal('100'), unit: 'M', unitPrice: new Prisma.Decimal('0.5'), netValue: new Prisma.Decimal('50') },
  ]);
  const ordersFindMany = vi.fn().mockResolvedValue([
    { id: 'O1', code: 'SO-202608-001', poNumber: 'PO-1', deliveryTerms: 'FOB SHANGHAI', paymentTerms: 'T/T 30% DEPOSIT', shipToName: null },
    { id: 'O2', code: 'SO-202608-002', poNumber: null, deliveryTerms: null, paymentTerms: null, shipToName: null },
  ]);
  const shipmentFindFirst = vi.fn().mockResolvedValue(null);
  const tx = {
    invoice: { create: invoiceCreate, update: invoiceUpdate, findUnique: invoiceFindUnique },
    paymentVoucher: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invoiceAllocation: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: auditCreate },
    entityReference: { upsert: entityReferenceUpsert },
    entityLink: { upsert: entityLinkUpsert, findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    order: { findMany: orderFindMany },
    invoiceOrderAllocation: { create: orderAllocCreate, updateMany: orderAllocUpdateMany },
  } as any;
  const prisma = {
    invoice: { findMany: vi.fn().mockResolvedValue([]), findUnique: invoiceFindUnique },
    paymentVoucher: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    invoiceAllocation: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    invoiceOrderAllocation: { findMany: vi.fn().mockResolvedValue([{ id: 'IOA__1', orderId: 'O1', orderNumber: 'ORD-1', poNumber: 'PO-1', allocatedAmount: new Prisma.Decimal('50.0000'), note: null }]) },
    systemConfig: { findUnique: systemConfigFindUnique },
    relation: { findUnique: relationFindUnique },
    order: { findMany: ordersFindMany },
    orderLine: { findMany: orderLinesFindMany },
    shipment: { findFirst: shipmentFindFirst },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  } as any;
  const onDataChange = opts.onDataChange || vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/finance', createFinanceRouter({ prisma, requireAuth: false, apiKeys: new Set(), onDataChange }));
  return { app, prisma, invoiceCreate, invoiceUpdate, invoiceFindUnique, auditCreate, entityReferenceUpsert, entityLinkUpsert, onDataChange, orderAllocCreate, orderAllocUpdateMany, orderFindMany };
}

describe('invoiceMutationService route POST /finance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create success → Decimal-safe + sync + audit + onDataChange', async () => {
    const { app, invoiceCreate, entityReferenceUpsert, entityLinkUpsert, auditCreate, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', amount: '123.4567', currency: 'USD', issueDate: '2026-07-02', status: 'Issued', orderId: 'O1', customerRelationId: 'R1', exchangeRate: '7.1234' });
    expect(res.status).toBe(201);
    const data = invoiceCreate.mock.calls[0][0].data;
    expect(data.amount).toBeInstanceOf(Prisma.Decimal);
    expect(data.exchangeRate).toBeInstanceOf(Prisma.Decimal);
    expect(entityReferenceUpsert).toHaveBeenCalled();
    expect(entityLinkUpsert).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('create with orderIds → writes invoice↔order allocations with snapshot', async () => {
    const { app, orderAllocCreate, orderFindMany } = makeApp();
    const res = await request(app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-2', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-02', status: 'Draft', orderIds: ['O1', 'O2'] });
    expect(res.status).toBe(201);
    // orderFindMany 用分配订单做快照（订单号取 Order.code，PO 取 poNumber）
    expect(orderFindMany).toHaveBeenCalledWith({ where: { id: { in: ['O1', 'O2'] }, deletedAt: null }, select: { id: true, code: true, poNumber: true } });
    expect(orderAllocCreate).toHaveBeenCalledTimes(2);
    const callData = orderAllocCreate.mock.calls.map((c: any) => c[0].data);
    expect(callData.map((d: any) => d.orderId)).toEqual(expect.arrayContaining(['O1', 'O2']));
    expect(callData.find((d: any) => d.orderId === 'O1')).toMatchObject({ invoiceId: 'INV__NEW', orderId: 'O1', orderNumber: 'SO-202608-001', poNumber: 'PO-1' });
    expect(callData.find((d: any) => d.orderId === 'O2')).toMatchObject({ orderNumber: 'SO-202608-002', poNumber: null });
  });

  it('GET /:id → returns orderAllocations alongside invoice', async () => {
    const { app, prisma } = makeApp();
    const res = await request(app).get('/api/v1/finance/INV__1').set(authHeader());
    expect(res.status).toBe(200);
    expect(prisma.invoiceOrderAllocation.findMany).toHaveBeenCalledWith({ where: { invoiceId: 'INV__1', deletedAt: null }, orderBy: { createdAt: 'asc' } });
    expect(Array.isArray(res.body.orderAllocations)).toBe(true);
    expect(res.body.orderAllocations[0]).toMatchObject({ orderId: 'O1', orderNumber: 'ORD-1', poNumber: 'PO-1', allocatedAmount: 50 });
  });

  it('GET /:id/preview.html → text/html CI 级同源渲染（信头/双方/条款组/行明细/金额大写 + A4 画布）', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/finance/INV__1/preview.html').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    // CI 抬头与公司信头 + 单据标识（内部 Status 字段不出现）
    expect(res.text).toContain('COMMERCIAL INVOICE');
    expect(res.text).toContain('商业发票');
    expect(res.text).toContain('INV-1');
    expect(res.text).toContain('ORIGINAL');
    // doc-* 基座结构标记（2026-08-21 统一裁决：与合同/装箱单同一版式基因，无旧 letterhead 类）
    expect(res.text).toContain('doc-header');
    expect(res.text).toContain('doc-party-grid');
    // 卖方 = 出口商档案默认值（SystemConfig 未配置 → DEFAULT_EXPORTER_PROFILE）
    expect(res.text).toContain('JIANGSU PANDA CLOTHING CO.,LTD.');
    // 运输与条款组（订单 deliveryTerms/paymentTerms + 原产国）
    expect(res.text).toContain('Shipment &amp; Terms');
    expect(res.text).toContain('FOB SHANGHAI');
    expect(res.text).toContain('T/T 30% DEPOSIT');
    expect(res.text).toContain('Country of Origin');
    // 订单分配行 + 订单行明细分组（Order ORD-1 · P/O PO-1 + 货号/品名/数量/金额）
    expect(res.text).toContain('Order ORD-1');
    expect(res.text).toContain('PO-1');
    expect(res.text).toContain('ART-001');
    expect(res.text).toContain('Navy Wool Twill');
    expect(res.text).toContain('50.00');
    // 合计 + 金额大写（invoice.amount = 100 USD）
    expect(res.text).toContain('SAY TOTAL US DOLLARS ONE HUNDRED ONLY');
    // 收款银行块（应收发票展示受益人银行）
    expect(res.text).toContain('Beneficiary Bank');
    expect(res.text).toContain('BKCHCNBJ95L');
    // 签字 + 盖章区 + 页脚（E&OE）——doc-* 基座双签章三段式（sig-label/sig-line/sig-name）
    expect(res.text).toContain('(签章)');
    expect(res.text).toContain('Authorized Signature / Date');
    expect(res.text).toContain('E. &amp; O. E.');
    // screen 预览 = A4 纸张画布（210mm 固定纸宽 + 纸内边距，不随容器自适应）
    expect(res.text).toContain('width: 210mm');
    expect(res.text).toContain('min-height: 297mm');
    expect(res.text).toContain('padding: 40px 48px');
  });

  it('GET /:id/preview.html → 空分配渲染空态占位行（TOTAL 不悬空）', async () => {
    // makeApp 闭包不便覆写——重建 app 用空分配 mock 验证空态分支
    const base = makeApp();
    const prisma = base.prisma;
    prisma.invoiceOrderAllocation.findMany.mockResolvedValueOnce([]);
    const res = await request(base.app).get('/api/v1/finance/INV__1/preview.html').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.text).toContain('No order lines allocated');
    // 空态下不渲染运输与条款组（无订单 → 无条款数据）
    expect(res.text).not.toContain('FOB SHANGHAI');
  });

  it('GET /:id/preview.html → 404 for missing/deleted invoice', async () => {
    const { app } = makeApp({ invoice: null });
    const res = await request(app).get('/api/v1/finance/INV__NONE/preview.html').set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('invalid status → 400 INVALID_STATUS before tx', async () => {
    const { app, prisma, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-02', status: 'Bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('invalid transition Draft→Paid → 400 INVALID_TRANSITION before tx', async () => {
    const { app, prisma } = makeApp();
    const res = await request(app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-02', status: 'Paid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('invalid/missing/null amount → 400 INVALID_AMOUNT before tx', async () => {
    const invalid = makeApp();
    const r1 = await request(invalid.app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', amount: 'abc', currency: 'USD', issueDate: '2026-07-02' });
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('INVALID_AMOUNT');
    expect(invalid.prisma.$transaction).not.toHaveBeenCalled();

    const missing = makeApp();
    const r2 = await request(missing.app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', currency: 'USD', issueDate: '2026-07-02' });
    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe('INVALID_AMOUNT');
    expect(missing.prisma.$transaction).not.toHaveBeenCalled();
    expect(missing.auditCreate).not.toHaveBeenCalled();
    expect(missing.onDataChange).not.toHaveBeenCalled();

    const nullAmount = makeApp();
    const r3 = await request(nullAmount.app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', amount: null, currency: 'USD', issueDate: '2026-07-02' });
    expect(r3.status).toBe(400);
    expect(r3.body.error.code).toBe('INVALID_AMOUNT');
    expect(nullAmount.prisma.$transaction).not.toHaveBeenCalled();
    expect(nullAmount.auditCreate).not.toHaveBeenCalled();
    expect(nullAmount.onDataChange).not.toHaveBeenCalled();
  });

  it('sync/audit reject fail closed', async () => {
    const sync = makeApp({ syncFail: true });
    const r1 = await request(sync.app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-02', status: 'Issued', orderId: 'O1' });
    expect(r1.status).toBe(500);
    expect(r1.body.error.code).toBe('CREATE_FAILED');
    expect(sync.auditCreate).not.toHaveBeenCalled();
    expect(sync.onDataChange).not.toHaveBeenCalled();
    const audit = makeApp({ auditFail: true });
    const r2 = await request(audit.app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-02' });
    expect(r2.status).toBe(500);
    expect(r2.body.error.code).toBe('CREATE_FAILED');
    expect(audit.onDataChange).not.toHaveBeenCalled();
  });
});

describe('invoiceMutationService route PATCH /finance/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('update success → status transition + Decimal-safe + sync + audit', async () => {
    const { app, invoiceUpdate, auditCreate, onDataChange } = makeApp({ invoice: { id: 'INV__1', status: 'Draft', amount: new Prisma.Decimal('100'), deletedAt: null } });
    const res = await request(app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ status: 'Issued', amount: '50.5000' });
    expect(res.status).toBe(200);
    expect(invoiceUpdate.mock.calls[0][0].data.amount).toBeInstanceOf(Prisma.Decimal);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('not found/deleted → 404 NOT_FOUND', async () => {
    const { app, auditCreate, onDataChange } = makeApp({ invoice: { id: 'INV__1', deletedAt: BigInt(1) } });
    const res = await request(app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ amount: '10' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('invalid status/transition/amount fail closed before update', async () => {
    const badStatus = makeApp();
    const r1 = await request(badStatus.app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ status: null });
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('INVALID_STATUS');
    expect(badStatus.prisma.$transaction).not.toHaveBeenCalled();

    // PartiallyPaid/Paid 是 allocation-managed 状态，不可手动 PATCH → STATUS_NOT_MANUAL_SETTABLE
    const allocationManaged = makeApp({ invoice: { id: 'INV__1', status: 'Issued', amount: new Prisma.Decimal('100'), deletedAt: null } });
    const rAlloc = await request(allocationManaged.app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ status: 'PartiallyPaid' });
    expect(rAlloc.status).toBe(400);
    expect(rAlloc.body.error.code).toBe('STATUS_NOT_MANUAL_SETTABLE');

    // 终态 → 无效流转（Cancelled 是终态，不可再转移）
    const badTransition = makeApp({ invoice: { id: 'INV__1', status: 'Cancelled', amount: new Prisma.Decimal('100'), deletedAt: null } });
    const r2 = await request(badTransition.app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ status: 'Issued' });
    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe('INVALID_TRANSITION');

    const badAmount = makeApp();
    const r3 = await request(badAmount.app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ amount: 'NaN' });
    expect(r3.status).toBe(400);
    expect(r3.body.error.code).toBe('INVALID_AMOUNT');
    expect(badAmount.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sync/audit reject fail closed and no onDataChange', async () => {
    const sync = makeApp({ syncFail: true });
    const r1 = await request(sync.app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ orderId: 'O1' });
    expect(r1.status).toBe(500);
    expect(r1.body.error.code).toBe('UPDATE_FAILED');
    expect(sync.auditCreate).not.toHaveBeenCalled();
    expect(sync.onDataChange).not.toHaveBeenCalled();

    const audit = makeApp({ auditFail: true });
    const r2 = await request(audit.app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ amount: '10' });
    expect(r2.status).toBe(500);
    expect(r2.body.error.code).toBe('UPDATE_FAILED');
    expect(audit.onDataChange).not.toHaveBeenCalled();
  });

  it('POST/PATCH route→service 契约：各触发 service 内 transaction 一次', async () => {
    const { app, prisma } = makeApp();
    await request(app).post('/api/v1/finance').set(authHeader()).send({ invoiceNumber: 'INV-1', type: 'Receivable', amount: '100', currency: 'USD', issueDate: '2026-07-02' });
    await request(app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ amount: '20' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
