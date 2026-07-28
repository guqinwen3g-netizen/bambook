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
  const tx = {
    invoice: { create: invoiceCreate, update: invoiceUpdate, findUnique: invoiceFindUnique },
    paymentVoucher: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invoiceAllocation: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: auditCreate },
    entityReference: { upsert: entityReferenceUpsert },
    entityLink: { upsert: entityLinkUpsert, findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
  } as any;
  const prisma = {
    invoice: { findMany: vi.fn().mockResolvedValue([]), findUnique: invoiceFindUnique },
    paymentVoucher: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    invoiceAllocation: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  } as any;
  const onDataChange = opts.onDataChange || vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/finance', createFinanceRouter({ prisma, requireAuth: false, apiKeys: new Set(), onDataChange }));
  return { app, prisma, invoiceCreate, invoiceUpdate, invoiceFindUnique, auditCreate, entityReferenceUpsert, entityLinkUpsert, onDataChange };
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
    const { app, invoiceUpdate, auditCreate, onDataChange } = makeApp({ invoice: { id: 'INV__1', status: 'Issued', amount: new Prisma.Decimal('100'), deletedAt: null } });
    const res = await request(app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ status: 'PartiallyPaid', amount: '50.5000' });
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

    const badTransition = makeApp({ invoice: { id: 'INV__1', status: 'Draft', amount: new Prisma.Decimal('100'), deletedAt: null } });
    const r2 = await request(badTransition.app).patch('/api/v1/finance/INV__1').set(authHeader()).send({ status: 'Paid' });
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
