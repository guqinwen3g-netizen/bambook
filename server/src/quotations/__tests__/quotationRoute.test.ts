import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createQuotationRouter } from '../quotationRoute';
import { businessEventBus } from '../../events/businessEventBus';

/**
 * task ERP-P2-quotation-route-contract:
 * 覆盖 /api/v1/quotations 路由的 HTTP 契约：
 *   - 输入校验（400）
 *   - 唯一性校验（409）
 *   - 状态转换错误码映射（404 不存在 / 409 非法转换）
 *   - onDataChange 在事务后触发
 *   - 事件发布（QuotationIssued / QuotationAccepted）
 */

const publishSpy = vi.spyOn(businessEventBus, 'publish').mockResolvedValue(undefined);

function makeApp(opts: {
  existing?: any;
  existingByNumber?: any;
  auditFail?: boolean;
  createFail?: boolean;
  updateFail?: boolean;
  onDataChange?: any;
} = {}) {
  const existing = opts.existing ?? null;
  const existingByNumber = opts.existingByNumber ?? null;

  const quotationCreate = opts.createFail
    ? vi.fn().mockRejectedValue(new Error('DB_BOOM'))
    : vi.fn().mockImplementation(async ({ data }: any) => {
        const { createdAt, updatedAt, lines, ...rest } = data;
        const createdLines = lines?.create?.map((l: any, i: number) => ({
          ...l,
          lineNumber: i + 1,
          amount: Math.round(l.quantity * l.unitPrice * 10000) / 10000,
        })) ?? [];
        return { ...rest, createdAt, updatedAt, lines: createdLines };
      });

  const quotationUpdate = opts.updateFail
    ? vi.fn().mockRejectedValue(new Error('UPDATE_BOOM'))
    : vi.fn().mockImplementation(async ({ where, data, include }: any) => {
        const { updatedAt, deletedAt, status, ...rest } = data;
        return {
          ...existing,
          ...rest,
          status: status ?? existing?.status ?? 'Draft',
          id: where.id,
          updatedAt: updatedAt ?? Date.now(),
          lines: existing?.lines ?? [],
        };
      });

  // route 层用 prisma.quotation.findUnique 检查报价号唯一性
  // service 层用 prisma.quotation.findUnique 检查报价单存在性
  const quotationFindUnique = vi.fn().mockImplementation(async ({ where }: any) => {
    if (where.id !== undefined) {
      if (where.id === existing?.id) return existing;
      return null;
    }
    if (where.quotationNumber !== undefined) {
      if (where.quotationNumber === existingByNumber?.quotationNumber) return existingByNumber;
      return null;
    }
    return null;
  });

  const quotationLineDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const quotationLineCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  const auditCreate = opts.auditFail
    ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT'))
    : vi.fn().mockResolvedValue({ id: 'AL-1' });

  const tx: any = {
    quotation: { create: quotationCreate, update: quotationUpdate },
    quotationLine: { deleteMany: quotationLineDeleteMany, createMany: quotationLineCreateMany },
    auditLog: { create: auditCreate },
    // EntityLink 图谱（D1.1a）：sync/deactivate 走 tx 内 upsert/findMany/update
    entityReference: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    entityLink: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  };

  const prisma: any = {
    quotation: {
      findUnique: quotationFindUnique,
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: quotationUpdate, // expireQuotation 不用事务
    },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  const onDataChange = opts.onDataChange || vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/quotations', createQuotationRouter({
    prisma,
    requireAuth: false,
    apiKeys: new Set<string>(),
    onDataChange,
  }));

  return { app, prisma, tx, quotationCreate, quotationUpdate, quotationFindUnique, auditCreate, onDataChange };
}

const validInput = {
  quotationNumber: 'QT-20260806-001',
  currency: 'USD',
  issueDate: '2026-08-06',
  customerName: 'ACME Corp',
  lines: [
    { description: 'Fabric A', quantity: 100, unit: 'YD', unitPrice: 5.5 },
  ],
};

describe('quotationRoute: POST / (create)', () => {
  beforeEach(() => publishSpy.mockClear());

  it('成功创建 → 201 + onDataChange 触发', async () => {
    const { app, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/quotations').send(validInput);

    expect(res.status).toBe(201);
    expect(res.body.quotation.quotationNumber).toBe('QT-20260806-001');
    expect(res.body.quotation.status).toBe('Draft');
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      entity: 'Quotation',
      action: 'create',
    }));
  });

  it('缺少 quotationNumber → 400', async () => {
    const { app, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/quotations').send({ ...validInput, quotationNumber: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quotationNumber/);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('缺少 currency → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/quotations').send({ ...validInput, currency: '' });
    expect(res.status).toBe(400);
  });

  it('缺少 issueDate → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/quotations').send({ ...validInput, issueDate: '' });
    expect(res.status).toBe(400);
  });

  it('空 lines → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/quotations').send({ ...validInput, lines: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/至少需要一行/);
  });

  it('行缺少 description → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/quotations').send({
      ...validInput,
      lines: [{ quantity: 10, unit: 'YD', unitPrice: 5 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/);
  });

  it('行缺少 unit → 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/v1/quotations').send({
      ...validInput,
      lines: [{ description: 'x', quantity: 10, unitPrice: 5 }],
    });
    expect(res.status).toBe(400);
  });

  it('报价号已存在 → 409', async () => {
    const { app, onDataChange } = makeApp({
      existingByNumber: { quotationNumber: 'QT-20260806-001', id: 'QT_EXISTING' },
    });
    const res = await request(app).post('/api/v1/quotations').send(validInput);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/已存在/);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit reject → 500（事务回滚，不伪成功），onDataChange 不触发', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).post('/api/v1/quotations').send(validInput);
    expect(res.status).toBe(500);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('create reject（DB 错误）→ 500，onDataChange 不触发', async () => {
    const { app, onDataChange } = makeApp({ createFail: true });
    const res = await request(app).post('/api/v1/quotations').send(validInput);
    expect(res.status).toBe(500);
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('quotationRoute: GET / (list)', () => {
  it('返回 { items, total }', async () => {
    const { app, prisma } = makeApp();
    prisma.quotation.findMany.mockResolvedValue([{ id: 'QT_1' }, { id: 'QT_2' }]);
    prisma.quotation.count.mockResolvedValue(2);

    const res = await request(app).get('/api/v1/quotations');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('status 过滤透传给 service', async () => {
    const { app, prisma } = makeApp();
    prisma.quotation.findMany.mockResolvedValue([]);
    prisma.quotation.count.mockResolvedValue(0);

    await request(app).get('/api/v1/quotations?status=Sent');

    expect(prisma.quotation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'Sent' }),
    }));
  });
});

describe('quotationRoute: GET /:id (detail)', () => {
  it('存在 → 200 + quotation', async () => {
    const { app } = makeApp({
      existing: { id: 'QT_1', quotationNumber: 'QT-001', status: 'Draft', deletedAt: null, lines: [] },
    });
    const res = await request(app).get('/api/v1/quotations/QT_1');
    expect(res.status).toBe(200);
    expect(res.body.quotation.id).toBe('QT_1');
  });

  it('不存在 → 404', async () => {
    const { app } = makeApp({ existing: null });
    const res = await request(app).get('/api/v1/quotations/NOPE');
    expect(res.status).toBe(404);
  });
});

describe('quotationRoute: PUT /:id (update)', () => {
  it('Draft → 成功更新', async () => {
    const { app, onDataChange } = makeApp({
      existing: { id: 'QT_1', status: 'Draft', deletedAt: null, lines: [], quotationNumber: 'QT-001' },
    });
    const res = await request(app).put('/api/v1/quotations/QT_1').send({ notes: 'updated' });
    expect(res.status).toBe(200);
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'update' }));
  });

  it('非 Draft → 409', async () => {
    const { app } = makeApp({
      existing: { id: 'QT_1', status: 'Sent', deletedAt: null, lines: [] },
    });
    const res = await request(app).put('/api/v1/quotations/QT_1').send({ notes: 'x' });
    expect(res.status).toBe(409);
  });

  it('不存在 → 404', async () => {
    const { app } = makeApp({ existing: null });
    const res = await request(app).put('/api/v1/quotations/NOPE').send({ notes: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('quotationRoute: DELETE /:id (soft delete)', () => {
  it('Draft → 200 + ok', async () => {
    const { app, onDataChange } = makeApp({
      existing: { id: 'QT_1', status: 'Draft', deletedAt: null, quotationNumber: 'QT-001' },
    });
    const res = await request(app).delete('/api/v1/quotations/QT_1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete' }));
  });

  it('非 Draft → 409', async () => {
    const { app } = makeApp({
      existing: { id: 'QT_1', status: 'Sent', deletedAt: null },
    });
    const res = await request(app).delete('/api/v1/quotations/QT_1');
    expect(res.status).toBe(409);
  });

  it('不存在 → 404', async () => {
    const { app } = makeApp({ existing: null });
    const res = await request(app).delete('/api/v1/quotations/NOPE');
    expect(res.status).toBe(404);
  });
});

describe('quotationRoute: POST /:id/send (Draft → Sent)', () => {
  beforeEach(() => publishSpy.mockClear());

  it('Draft → Sent 成功 → 200 + onDataChange + QuotationIssued 事件', async () => {
    const { app, onDataChange } = makeApp({
      existing: {
        id: 'QT_1',
        status: 'Draft',
        deletedAt: null,
        quotationNumber: 'QT-001',
        customerName: 'ACME',
        totalAmount: 550,
        currency: 'USD',
        lines: [{ id: 'L1', description: 'x', quantity: 100, unit: 'YD', unitPrice: 5.5 }],
      },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/send');

    expect(res.status).toBe(200);
    expect(res.body.quotation.status).toBe('Sent');
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'send' }));
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].type).toBe('QuotationIssued');
  });

  it('Sent → 非法转换 → 409', async () => {
    const { app, onDataChange } = makeApp({
      existing: { id: 'QT_1', status: 'Sent', deletedAt: null, lines: [] },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/send');
    expect(res.status).toBe(409);
    expect(onDataChange).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('不存在 → 404', async () => {
    const { app } = makeApp({ existing: null });
    const res = await request(app).post('/api/v1/quotations/NOPE/send');
    expect(res.status).toBe(404);
  });
});

describe('quotationRoute: POST /:id/accept (Sent → Accepted)', () => {
  beforeEach(() => publishSpy.mockClear());

  it('Sent → Accepted 成功 → 200 + QuotationAccepted 事件', async () => {
    const { app, onDataChange } = makeApp({
      existing: {
        id: 'QT_1',
        status: 'Sent',
        deletedAt: null,
        quotationNumber: 'QT-001',
        customerName: 'ACME',
        totalAmount: 550,
        currency: 'USD',
        lines: [{ id: 'L1', description: 'x', quantity: 100, unit: 'YD', unitPrice: 5.5 }],
      },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/accept').send({ note: '客户确认' });

    expect(res.status).toBe(200);
    expect(res.body.quotation.status).toBe('Accepted');
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept' }));
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].type).toBe('QuotationAccepted');
  });

  it('Draft → 非法转换 → 409', async () => {
    const { app } = makeApp({
      existing: { id: 'QT_1', status: 'Draft', deletedAt: null, lines: [] },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/accept');
    expect(res.status).toBe(409);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('不存在 → 404', async () => {
    const { app } = makeApp({ existing: null });
    const res = await request(app).post('/api/v1/quotations/NOPE/accept');
    expect(res.status).toBe(404);
  });
});

describe('quotationRoute: POST /:id/reject (Sent → Rejected)', () => {
  beforeEach(() => publishSpy.mockClear());

  it('Sent → Rejected 成功 → 200', async () => {
    const { app, onDataChange } = makeApp({
      existing: { id: 'QT_1', status: 'Sent', deletedAt: null, quotationNumber: 'QT-001' },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/reject').send({ note: '价格过高' });

    expect(res.status).toBe(200);
    expect(res.body.quotation.status).toBe('Rejected');
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'reject' }));
    // reject 不发布业务事件
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('Draft → 非法转换 → 409', async () => {
    const { app } = makeApp({
      existing: { id: 'QT_1', status: 'Draft', deletedAt: null },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/reject');
    expect(res.status).toBe(409);
  });

  it('不存在 → 404', async () => {
    const { app } = makeApp({ existing: null });
    const res = await request(app).post('/api/v1/quotations/NOPE/reject');
    expect(res.status).toBe(404);
  });
});

describe('quotationRoute: POST /:id/expire', () => {
  it('Draft → Expired 成功 → 200', async () => {
    const { app, onDataChange } = makeApp({
      existing: { id: 'QT_1', status: 'Draft', deletedAt: null },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/expire');
    expect(res.status).toBe(200);
    expect(res.body.quotation.status).toBe('Expired');
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'expire' }));
  });

  it('Accepted 终态 → 400（不可标记过期）', async () => {
    const { app } = makeApp({
      existing: { id: 'QT_1', status: 'Accepted', deletedAt: null },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/expire');
    expect(res.status).toBe(400);
  });

  it('不存在 → 404', async () => {
    const { app } = makeApp({ existing: null });
    const res = await request(app).post('/api/v1/quotations/NOPE/expire');
    expect(res.status).toBe(404);
  });
});

describe('quotationRoute: POST /:id/convert-to-order', () => {
  beforeEach(() => publishSpy.mockClear());

  it('Accepted → 201 + orderId + quotation.convertedOrderId + 双 onDataChange', async () => {
    const { app, onDataChange } = makeAppWithConvert({
      existing: {
        id: 'QT_1',
        quotationNumber: 'QT-001',
        status: 'Accepted',
        deletedAt: null,
        convertedOrderId: null,
        customerName: 'ACME',
        currency: 'USD',
        baseCurrency: 'CNY',
        totalAmount: 550,
        validUntil: '2026-09-30',
        lines: [{ id: 'L1', fabricCode: 'FAB-A', description: 'Fabric A', quantity: 100, unit: 'YD', unitPrice: 5.5, amount: 550 }],
      },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/convert-to-order').send({});

    expect(res.status).toBe(201);
    expect(res.body.orderId).toMatch(/^ORD-QT-/);
    expect(res.body.quotation.convertedOrderId).toBe(res.body.orderId);

    // 双 onDataChange：Quotation + orders
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ entity: 'Quotation', action: 'convert' }));
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ entity: 'orders', action: 'create' }));
  });

  it('支持 overrides（poNumber / millName）', async () => {
    const { app, tx } = makeAppWithConvert({
      existing: {
        id: 'QT_1',
        quotationNumber: 'QT-001',
        status: 'Accepted',
        deletedAt: null,
        convertedOrderId: null,
        customerName: 'ACME',
        currency: 'USD',
        baseCurrency: 'CNY',
        totalAmount: 100,
        lines: [{ id: 'L1', description: 'x', quantity: 10, unit: 'YD', unitPrice: 10, amount: 100 }],
      },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/convert-to-order').send({
      poNumber: 'PO-CUSTOM',
      millName: 'Mill A',
    });

    expect(res.status).toBe(201);
    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.poNumber).toBe('PO-CUSTOM');
    expect(orderData.millName).toBe('Mill A');
  });

  it('非 Accepted → 409', async () => {
    const { app, onDataChange } = makeAppWithConvert({
      existing: { id: 'QT_1', status: 'Sent', deletedAt: null, convertedOrderId: null, lines: [] },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/convert-to-order');
    expect(res.status).toBe(409);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('已转换 → 409', async () => {
    const { app } = makeAppWithConvert({
      existing: { id: 'QT_1', status: 'Accepted', deletedAt: null, convertedOrderId: 'ORD-QT-EXISTING', lines: [] },
    });
    const res = await request(app).post('/api/v1/quotations/QT_1/convert-to-order');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/已转为/);
  });

  it('不存在 → 404', async () => {
    const { app } = makeAppWithConvert({ existing: null });
    const res = await request(app).post('/api/v1/quotations/NOPE/convert-to-order');
    expect(res.status).toBe(404);
  });
});

// ── convert-to-order 需要额外的 order.create mock ──
function makeAppWithConvert(opts: { existing?: any; onDataChange?: any } = {}) {
  const base = makeApp(opts);
  const orderCreate = vi.fn().mockImplementation(async ({ data }: any) => ({
    id: data.id,
    ...data,
    lines: data.lines?.create ?? [],
  }));
  const quotationUpdate = vi.fn().mockImplementation(async ({ where, data, include }: any) => ({
    ...opts.existing,
    ...data,
    id: where.id,
    lines: opts.existing?.lines ?? [],
  }));
  base.tx.order = { create: orderCreate };
  base.tx.quotation.update = quotationUpdate;
  base.prisma.$transaction = vi.fn(async (fn: any) => fn(base.tx));
  return { ...base, orderCreate, quotationUpdate };
}
