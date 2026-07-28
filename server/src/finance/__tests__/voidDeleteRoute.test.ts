import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFinanceRouter } from '../route';
import { authHeader } from '../../__tests__/authTestHelper';

function makeVoidDeleteApp(opts: {
  invoice?: any;
  voucher?: any;
  invoiceAllocCount?: number;
  voucherAllocCount?: number;
  txFail?: boolean;
  syncFail?: boolean;
  auditFail?: boolean;
} = {}) {
  const invoice = opts.invoice === undefined ? {
    id: 'INV__1', invoiceNumber: 'INV-001', status: 'Issued', deletedAt: null, createdAt: BigInt(0), updatedAt: BigInt(0),
  } : opts.invoice;
  const voucher = opts.voucher === undefined ? {
    id: 'PAY__1', voucherNumber: 'PAY-001', status: 'unreconciled', deletedAt: null, createdAt: BigInt(0), updatedAt: BigInt(0),
  } : opts.voucher;

  const invoiceUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...invoice, ...data, id: where.id }));
  const voucherUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...voucher, ...data, id: where.id }));
  const auditCreate = opts.auditFail ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT')) : vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});
  const entityLinkFindMany = vi.fn().mockResolvedValue([{ id: 'L1', fromType: 'invoice', fromId: 'INV__1', status: 'active' }]);
  const entityLinkUpdate = opts.syncFail ? vi.fn().mockRejectedValue(new Error('SYNC_REJECT')) : vi.fn().mockResolvedValue({});
  const entityRefFindMany = vi.fn().mockResolvedValue([]);
  const entityRefUpdate = vi.fn().mockResolvedValue({});
  const allocCount = vi.fn().mockResolvedValue(opts.invoiceAllocCount || 0);

  const tx = {
    invoice: { findUnique: vi.fn().mockResolvedValue(invoice), update: invoiceUpdate },
    paymentVoucher: { findUnique: vi.fn().mockResolvedValue(voucher), update: voucherUpdate },
    invoiceAllocation: { count: vi.fn().mockResolvedValue(opts.invoiceAllocCount || 0) },
    auditLog: { create: auditCreate },
    entityLink: { upsert: entityLinkUpsert, findMany: entityLinkFindMany, update: entityLinkUpdate },
    entityReference: { upsert: vi.fn(), findMany: entityRefFindMany, update: entityRefUpdate },
  };

  const prisma = {
    invoice: { findUnique: vi.fn().mockResolvedValue(invoice), findMany: vi.fn().mockResolvedValue(invoice ? [invoice] : []) },
    paymentVoucher: { findUnique: vi.fn().mockResolvedValue(voucher), findMany: vi.fn().mockResolvedValue(voucher ? [voucher] : []) },
    invoiceAllocation: { count: allocCount },
    $transaction: opts.txFail ? vi.fn().mockRejectedValue(new Error('TX_BOOM')) : vi.fn(async (fn: any) => fn(tx)),
  } as any;

  const onDataChange = vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/finance', createFinanceRouter({ prisma, requireAuth: false, apiKeys: new Set(), onDataChange }));
  return { app, tx, prisma, onDataChange, invoiceUpdate, voucherUpdate, auditCreate, entityLinkUpdate, allocCount };
}

describe('task ERP-P1 finance void-delete: POST /:id/cancel 成功路径', () => {
  it('Issued invoice → cancel → 200 + status=Cancelled + audit', async () => {
    const { app, invoiceUpdate, auditCreate } = makeVoidDeleteApp();
    const res = await request(app).post('/api/v1/finance/INV__1/cancel').set(authHeader()).send({ reason: 'void test' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.invoice.status).toBe('Cancelled');
    expect(invoiceUpdate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });
});

describe('task ERP-P1 finance void-delete: cancel fail closed', () => {
  it('INVOICE_NOT_FOUND → 404', async () => {
    const { app } = makeVoidDeleteApp({ invoice: null });
    const res = await request(app).post('/api/v1/finance/NOPE/cancel').set(authHeader()).send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVOICE_NOT_FOUND');
  });

  it('INVALID_STATUS（已 Cancelled）→ 400', async () => {
    const { app } = makeVoidDeleteApp({ invoice: { id: 'INV__1', status: 'Cancelled', deletedAt: null } });
    const res = await request(app).post('/api/v1/finance/INV__1/cancel').set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('audit reject → CANCEL_FAILED（事务回滚）', async () => {
    const { app } = makeVoidDeleteApp({ auditFail: true });
    const res = await request(app).post('/api/v1/finance/INV__1/cancel').set(authHeader()).send({});
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CANCEL_FAILED');
  });

  it('sync reject（EntityLink update fail）→ CANCEL_FAILED', async () => {
    const { app } = makeVoidDeleteApp({ syncFail: true });
    const res = await request(app).post('/api/v1/finance/INV__1/cancel').set(authHeader()).send({});
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CANCEL_FAILED');
  });
});

describe('task ERP-P1 finance void-delete: DELETE /:id 软删', () => {
  it('成功 → 200', async () => {
    const { app, onDataChange } = makeVoidDeleteApp();
    const res = await request(app).delete('/api/v1/finance/INV__1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('HAS_ALLOCATIONS（存在 InvoiceAllocation）→ 409', async () => {
    const { app } = makeVoidDeleteApp({ invoiceAllocCount: 2 });
    const res = await request(app).delete('/api/v1/finance/INV__1').set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_ALLOCATIONS');
  });

  it('INVOICE_NOT_FOUND → 404', async () => {
    const { app } = makeVoidDeleteApp({ invoice: null });
    const res = await request(app).delete('/api/v1/finance/NOPE').set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVOICE_NOT_FOUND');
  });
});

describe('task ERP-P1 finance void-delete: DELETE /vouchers/:id 软删', () => {
  it('成功 → 200', async () => {
    const { app } = makeVoidDeleteApp();
    const res = await request(app).delete('/api/v1/finance/vouchers/PAY__1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('HAS_ALLOCATIONS（voucher 有核销）→ 409', async () => {
    const { app } = makeVoidDeleteApp({ voucherAllocCount: 1 });
    // 需让 voucher allocation count 也 > 0
    const tx2 = {
      invoice: { findUnique: vi.fn(), update: vi.fn() },
      paymentVoucher: { findUnique: vi.fn().mockResolvedValue({ id: 'PAY__1', deletedAt: null }), update: vi.fn() },
      invoiceAllocation: { count: vi.fn().mockResolvedValue(1) },
      auditLog: { create: vi.fn() },
      entityLink: { upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
      entityReference: { upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    };
    const prisma2 = {
      invoice: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      paymentVoucher: { findUnique: vi.fn().mockResolvedValue({ id: 'PAY__1', deletedAt: null }), findMany: vi.fn().mockResolvedValue([]) },
      invoiceAllocation: { count: vi.fn().mockResolvedValue(1) },
      $transaction: vi.fn(async (fn: any) => fn(tx2)),
    } as any;
    const app2 = express();
    app2.use(express.json());
    app2.use('/api/v1/finance', createFinanceRouter({ prisma: prisma2, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app2).delete('/api/v1/finance/vouchers/PAY__1').set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_ALLOCATIONS');
  });

  it('VOUCHER_NOT_FOUND → 404', async () => {
    const { app } = makeVoidDeleteApp({ voucher: null });
    const res = await request(app).delete('/api/v1/finance/vouchers/NOPE').set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VOUCHER_NOT_FOUND');
  });
});

describe('task ERP-P1 finance void-delete: GET 过滤 deletedAt', () => {
  it('GET / 过滤 deletedAt（where 含 deletedAt: null）', async () => {
    const { app, prisma } = makeVoidDeleteApp();
    await request(app).get('/api/v1/finance/');
    expect(prisma.invoice.findMany).toHaveBeenCalled();
    const callArgs = (prisma.invoice.findMany as any).mock.calls[0][0];
    expect(callArgs.where).toEqual(expect.objectContaining({ deletedAt: null }));
  });

  it('GET /:id 判空 deletedAt → 404', async () => {
    const { app } = makeVoidDeleteApp({ invoice: { id: 'INV__1', status: 'Issued', deletedAt: BigInt(Date.now()) } });
    const res = await request(app).get('/api/v1/finance/INV__1');
    expect(res.status).toBe(404);
  });

  it('GET /vouchers 过滤 deletedAt（paymentVoucher.findMany where 含 deletedAt: null）', async () => {
    const { app, prisma } = makeVoidDeleteApp();
    await request(app).get('/api/v1/finance/vouchers');
    expect((prisma as any).paymentVoucher.findMany).toHaveBeenCalled();
    const callArgs = ((prisma as any).paymentVoucher.findMany as any).mock.calls[0][0];
    expect(callArgs.where).toEqual(expect.objectContaining({ deletedAt: null }));
  });

  it('GET /vouchers/:id 判空 deletedAt → 404', async () => {
    const { app } = makeVoidDeleteApp({ voucher: { id: 'PAY__1', deletedAt: BigInt(Date.now()) } });
    const res = await request(app).get('/api/v1/finance/vouchers/PAY__1');
    expect(res.status).toBe(404);
  });
});

describe('task ERP-P1 finance void-delete: EntityLink inactive（cancel/delete 时）', () => {
  it('cancel → entityLink.update 被调用（置 inactive）', async () => {
    const { app, entityLinkUpdate } = makeVoidDeleteApp();
    await request(app).post('/api/v1/finance/INV__1/cancel').set(authHeader()).send({});
    expect(entityLinkUpdate).toHaveBeenCalled();
  });

  it('delete invoice → entityLink.update 被调用（置 inactive）', async () => {
    const { app, entityLinkUpdate } = makeVoidDeleteApp();
    await request(app).delete('/api/v1/finance/INV__1').set(authHeader());
    expect(entityLinkUpdate).toHaveBeenCalled();
  });
});
