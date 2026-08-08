import { describe, expect, it, vi } from 'vitest';
import { validateStatusTransition, VALID_INVOICE_STATUS, VALID_SHIPMENT_STATUS } from '../statusTransition';
import { authHeader } from './authTestHelper';

describe('task_mqy459c6: statusTransition 纯函数', () => {
  describe('Invoice 状态枚举', () => {
    it('VALID_INVOICE_STATUS 含 5 值', () => {
      expect(VALID_INVOICE_STATUS).toEqual(['Draft', 'Issued', 'PartiallyPaid', 'Paid', 'Cancelled']);
    });
  });

  describe('Invoice 合法转移', () => {
    it('Draft → Issued 合法', () => expect(validateStatusTransition('Invoice', 'Draft', 'Issued').ok).toBe(true));
    it('Issued → PartiallyPaid 合法', () => expect(validateStatusTransition('Invoice', 'Issued', 'PartiallyPaid').ok).toBe(true));
    it('Issued → Paid 合法', () => expect(validateStatusTransition('Invoice', 'Issued', 'Paid').ok).toBe(true));
    it('PartiallyPaid → Paid 合法', () => expect(validateStatusTransition('Invoice', 'PartiallyPaid', 'Paid').ok).toBe(true));
    it('Draft → Cancelled 合法', () => expect(validateStatusTransition('Invoice', 'Draft', 'Cancelled').ok).toBe(true));
    it('Paid → Cancelled 合法', () => expect(validateStatusTransition('Invoice', 'Paid', 'Cancelled').ok).toBe(true));
    it('相同状态幂等（合法）', () => expect(validateStatusTransition('Invoice', 'Issued', 'Issued').ok).toBe(true));
  });

  describe('Invoice 非法转移', () => {
    it('Draft → Paid 非法（跨态）', () => {
      const r = validateStatusTransition('Invoice', 'Draft', 'Paid');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Paid → Issued 非法（终态不可回退）', () => {
      const r = validateStatusTransition('Invoice', 'Paid', 'Issued');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Cancelled → Draft 非法（终态）', () => {
      const r = validateStatusTransition('Invoice', 'Cancelled', 'Draft');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Paid → PartiallyPaid 非法（不可回退）', () => {
      const r = validateStatusTransition('Invoice', 'Paid', 'PartiallyPaid');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
  });

  describe('Shipment 状态枚举', () => {
    it('VALID_SHIPMENT_STATUS 含 8 值', () => {
      expect(VALID_SHIPMENT_STATUS).toEqual(['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled']);
    });
  });

  describe('Shipment 合法转移', () => {
    it('Draft → Booked 合法', () => expect(validateStatusTransition('Shipment', 'Draft', 'Booked').ok).toBe(true));
    it('Booked → Shipped 合法（跨 Loading）', () => expect(validateStatusTransition('Shipment', 'Booked', 'Shipped').ok).toBe(true));
    it('Shipped → Arrived 合法', () => expect(validateStatusTransition('Shipment', 'Shipped', 'Arrived').ok).toBe(true));
    it('任意非终态 → Cancelled 合法', () => {
      expect(validateStatusTransition('Shipment', 'Booked', 'Cancelled').ok).toBe(true);
      expect(validateStatusTransition('Shipment', 'Shipped', 'Cancelled').ok).toBe(true);
    });
    it('相同状态幂等（合法）', () => expect(validateStatusTransition('Shipment', 'Booked', 'Booked').ok).toBe(true));
  });

  describe('Shipment 非法转移', () => {
    it('Draft → Delivered 非法（跨太多）', () => {
      const r = validateStatusTransition('Shipment', 'Draft', 'Delivered');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Delivered → Shipped 非法（终态）', () => {
      const r = validateStatusTransition('Shipment', 'Delivered', 'Shipped');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Cancelled → Booked 非法（终态）', () => {
      const r = validateStatusTransition('Shipment', 'Cancelled', 'Booked');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('回退（Shipped → Booked）非法', () => {
      const r = validateStatusTransition('Shipment', 'Shipped', 'Booked');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
  });

  describe('非法枚举值（to）', () => {
    it('Invoice 非法 to → INVALID_STATUS', () => {
      const r = validateStatusTransition('Invoice', 'Draft', 'Bogus');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_STATUS');
    });
    it('Shipment 非法 to → INVALID_STATUS', () => {
      const r = validateStatusTransition('Shipment', 'Draft', 'Flying');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_STATUS');
    });
  });

  describe('from 不在枚举（脏数据/旧枚举）→ INVALID_CURRENT_STATUS fail closed', () => {
    it('Invoice from=Unknown → INVALID_CURRENT_STATUS（不静默放过）', () => {
      const r = validateStatusTransition('Invoice', 'Unknown', 'Issued');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('INVALID_CURRENT_STATUS');
      expect(r.message).toContain('Unknown');
    });
    it('Shipment from=Pending → INVALID_CURRENT_STATUS', () => {
      const r = validateStatusTransition('Shipment', 'Pending', 'Booked');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('INVALID_CURRENT_STATUS');
    });
  });
});

// ============================================================================
// 集成测试：invoice route PATCH 状态转移
// ============================================================================
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createFinanceRouter } from '../finance/route';

function makeInvoiceApp(existingStatus: string, txFail = false) {
  const invoiceFind = vi.fn().mockResolvedValue({ id: 'I1', status: existingStatus, amount: new Prisma.Decimal(100) });
  const invoiceUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, status: data.status, amount: data.amount ? Number(data.amount) : undefined, invoiceNumber: 'INV001' }));
  const tx = {
    invoice: { findUnique: invoiceFind, update: invoiceUpdate },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    entityReference: { upsert: vi.fn().mockResolvedValue({}) },
    entityLink: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
  };
  const $transaction = vi.fn(async (fn: any) => {
    if (txFail) throw new Error('TX_FAIL');
    return fn(tx);
  });
  const prisma = { $transaction } as any;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/finance', createFinanceRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
  return { app, invoiceUpdate };
}

describe('task_mqy459c6: invoice route PATCH 状态转移集成', () => {
  it('PartiallyPaid 不可手动 PATCH → 400 STATUS_NOT_MANUAL_SETTABLE（仅 allocation 可设）', async () => {
    const { app, invoiceUpdate } = makeInvoiceApp('Issued');
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ status: 'PartiallyPaid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STATUS_NOT_MANUAL_SETTABLE');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('Paid 不可手动 PATCH → 400 STATUS_NOT_MANUAL_SETTABLE（仅 allocation 可设），不写 DB', async () => {
    const { app, invoiceUpdate } = makeInvoiceApp('Draft');
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ status: 'Paid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STATUS_NOT_MANUAL_SETTABLE');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('非法枚举 → 400 INVALID_STATUS', async () => {
    const { app, invoiceUpdate } = makeInvoiceApp('Draft');
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ status: 'Bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('脏数据 from=Unknown → 400 INVALID_CURRENT_STATUS', async () => {
    const { app, invoiceUpdate } = makeInvoiceApp('Unknown');
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ status: 'Issued' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURRENT_STATUS');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('Cancelled 终态 → 400', async () => {
    const { app } = makeInvoiceApp('Cancelled');
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ status: 'Issued' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('invoice not found → 404', async () => {
    const app = express();
    app.use(express.json());
    const tx = { invoice: { findUnique: vi.fn().mockResolvedValue(null) } };
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    app.use('/api/v1/finance', createFinanceRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).patch('/api/v1/finance/NOPE').set(authHeader()).send({ status: 'Issued' });
    expect(res.status).toBe(404);
  });

  it('事务失败（sync/audit rollback）→ 500 不伪成功', async () => {
    const { app } = makeInvoiceApp('Issued', true);
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ status: 'PartiallyPaid' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('UPDATE_FAILED');
  });


  it('显式 status:null → 400 INVALID_STATUS，不写 DB', async () => {
    const { app, invoiceUpdate } = makeInvoiceApp('Issued');
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ status: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('显式 status:数字 → 400 INVALID_STATUS', async () => {
    const { app, invoiceUpdate } = makeInvoiceApp('Issued');
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ status: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('不传 status → 不触发转移校验，正常更新', async () => {
    const { app, invoiceUpdate } = makeInvoiceApp('Issued');
    const res = await request(app).patch('/api/v1/finance/I1').set(authHeader()).send({ amount: 200 });
    expect(res.status).toBe(200);
    expect(invoiceUpdate).toHaveBeenCalled();
  });
});

// ============================================================================
// 集成测试：shipment route PATCH 状态转移
// ============================================================================
import { createShippingRouter } from '../shipping/route';

function makeShipmentApp(existingStatus: string, txFail = false) {
  const shipmentFind = vi.fn().mockResolvedValue({ id: 'S1', status: existingStatus, shipmentNumber: 'SHP001' });
  const shipmentUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, status: data.status, shipmentNumber: 'SHP001' }));
  const tx = {
    shipment: { findUnique: shipmentFind, update: shipmentUpdate },
    shipmentEvent: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    entityReference: { upsert: vi.fn().mockResolvedValue({}) },
    entityLink: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const $transaction = vi.fn(async (fn: any) => {
    if (txFail) throw new Error('TX_FAIL');
    return fn(tx);
  });
  const prisma = { $transaction } as any;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
  return { app, shipmentUpdate };
}

describe('task_mqy459c6: shipment route PATCH 状态转移集成', () => {
  it('合法转移 Booked → Shipped → 200', async () => {
    const { app, shipmentUpdate } = makeShipmentApp('Booked');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Shipped' });
    expect(res.status).toBe(200);
    expect(shipmentUpdate).toHaveBeenCalled();
  });

  it('非法转移 Draft → Delivered → 400 INVALID_TRANSITION', async () => {
    const { app, shipmentUpdate } = makeShipmentApp('Draft');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Delivered' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(shipmentUpdate).not.toHaveBeenCalled();
  });

  it('非法回退 Shipped → Booked → 400', async () => {
    const { app } = makeShipmentApp('Shipped');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Booked' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('非法枚举 → 400 INVALID_STATUS', async () => {
    const { app } = makeShipmentApp('Booked');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Flying' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('脏数据 from=Pending → 400 INVALID_CURRENT_STATUS', async () => {
    const { app, shipmentUpdate } = makeShipmentApp('Pending');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Booked' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURRENT_STATUS');
    expect(shipmentUpdate).not.toHaveBeenCalled();
  });

  it('Delivered 终态 → 400', async () => {
    const { app } = makeShipmentApp('Delivered');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Shipped' });
    expect(res.status).toBe(400);
  });

  it('shipment not found → 404', async () => {
    const app = express();
    app.use(express.json());
    const tx = { shipment: { findUnique: vi.fn().mockResolvedValue(null) } };
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).patch('/api/v1/shipping/NOPE').set(authHeader()).send({ status: 'Shipped' });
    expect(res.status).toBe(404);
  });

  it('事务失败 → 500 不伪成功', async () => {
    const { app } = makeShipmentApp('Booked', true);
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Shipped' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('UPDATE_FAILED');
  });


  it('显式 status:null → 400 INVALID_STATUS，不写 DB', async () => {
    const { app, shipmentUpdate } = makeShipmentApp('Booked');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(shipmentUpdate).not.toHaveBeenCalled();
  });

  it('显式 status:数字 → 400 INVALID_STATUS', async () => {
    const { app, shipmentUpdate } = makeShipmentApp('Booked');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 456 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(shipmentUpdate).not.toHaveBeenCalled();
  });

  it('不传 status → 正常更新', async () => {
    const { app, shipmentUpdate } = makeShipmentApp('Booked');
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ containerNumber: 'CN001' });
    expect(res.status).toBe(200);
    expect(shipmentUpdate).toHaveBeenCalled();
  });
});
