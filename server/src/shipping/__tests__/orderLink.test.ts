import { describe, expect, it, vi } from 'vitest';
import { deriveOrderStatusFromShipment, linkOrderStatusFromShipment, VALID_ORDER_STATUSES } from '../orderLinkService';
import { authHeader } from '../../__tests__/authTestHelper';

// ============================================================================
// task ERP-P1-order-shipment-status-link-foundation: 纯函数 + 集成测试
// ============================================================================

describe('task order-shipment-link: deriveOrderStatusFromShipment 映射规则', () => {
  it('Shipment Shipped → Order Shipping', () => {
    expect(deriveOrderStatusFromShipment('Shipped')).toBe('Shipping');
  });
  it('Shipment Delivered → Order Delivered', () => {
    expect(deriveOrderStatusFromShipment('Delivered')).toBe('Delivered');
  });
  it('Shipment Booked/Loading/Shipped/Arrived/Cleared → Order Shipping', () => {
    expect(deriveOrderStatusFromShipment('Booked')).toBe('Shipping');
    expect(deriveOrderStatusFromShipment('Loading')).toBe('Shipping');
    expect(deriveOrderStatusFromShipment('Shipped')).toBe('Shipping');
    expect(deriveOrderStatusFromShipment('Arrived')).toBe('Shipping');
    expect(deriveOrderStatusFromShipment('Cleared')).toBe('Shipping');
  });
  it('Shipment Draft/Cancelled → null（不联动）', () => {
    expect(deriveOrderStatusFromShipment('Draft')).toBeNull();
    expect(deriveOrderStatusFromShipment('Cancelled')).toBeNull();
  });
});

describe('task order-shipment-link: VALID_ORDER_STATUSES', () => {
  it('含 6 值', () => {
    expect(VALID_ORDER_STATUSES).toEqual(['Pending', 'Confirmed', 'Production', 'Shipping', 'Delivered', 'Alert']);
  });
});

describe('task order-shipment-link: linkOrderStatusFromShipment 事务内联动', () => {
  function makeTx(order: any) {
    return {
      order: { findUnique: vi.fn().mockResolvedValue(order), update: vi.fn().mockResolvedValue({}) },
      orderStatusTransition: { create: vi.fn().mockResolvedValue({}) },
    } as any;
  }

  it('Shipment Shipped → Order Pending → Shipping（写 transition + update）', async () => {
    const tx = makeTx({ id: 'O1', status: 'Pending', deletedAt: null });
    const r = await linkOrderStatusFromShipment(tx, 'O1', 'Shipped');
    expect(r.ok).toBe(true);
    expect(r.fromStatus).toBe('Pending');
    expect(r.toStatus).toBe('Shipping');
    expect(tx.orderStatusTransition.create).toHaveBeenCalledTimes(1);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'O1' },
      data: expect.objectContaining({ status: 'Shipping' }),
    }));
  });

  it('Shipment Delivered → Order Shipping → Delivered', async () => {
    const tx = makeTx({ id: 'O1', status: 'Shipping', deletedAt: null });
    const r = await linkOrderStatusFromShipment(tx, 'O1', 'Delivered');
    expect(r.ok).toBe(true);
    expect(r.toStatus).toBe('Delivered');
  });

  it('Shipment Booked → Order Confirmed → Shipping（create default Booked 联动）', async () => {
    const tx = makeTx({ id: 'O1', status: 'Confirmed', deletedAt: null });
    const r = await linkOrderStatusFromShipment(tx, 'O1', 'Booked');
    expect(r.ok).toBe(true);
    expect(r.toStatus).toBe('Shipping');
    expect(tx.orderStatusTransition.create).toHaveBeenCalledTimes(1);
  });

  it('order 已在目标 status → 幂等 skipped', async () => {
    const tx = makeTx({ id: 'O1', status: 'Shipping', deletedAt: null });
    const r = await linkOrderStatusFromShipment(tx, 'O1', 'Shipped');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('order 不存在 → throw ORDER_NOT_FOUND', async () => {
    const tx = makeTx(null);
    await expect(linkOrderStatusFromShipment(tx, 'OX', 'Shipped')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });

  it('order 已删 → throw ORDER_NOT_FOUND', async () => {
    const tx = makeTx({ id: 'O1', status: 'Pending', deletedAt: 123 });
    await expect(linkOrderStatusFromShipment(tx, 'O1', 'Shipped')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });

  it('order 终态 Delivered → 联动 Shipped → throw ORDER_TERMINAL', async () => {
    const tx = makeTx({ id: 'O1', status: 'Delivered', deletedAt: null });
    await expect(linkOrderStatusFromShipment(tx, 'O1', 'Shipped')).rejects.toMatchObject({ code: 'ORDER_TERMINAL' });
  });

  it('order 终态 Alert → throw ORDER_TERMINAL', async () => {
    const tx = makeTx({ id: 'O1', status: 'Alert', deletedAt: null });
    await expect(linkOrderStatusFromShipment(tx, 'O1', 'Shipped')).rejects.toMatchObject({ code: 'ORDER_TERMINAL' });
  });

  it('order 非法当前 status → throw INVALID_CURRENT_ORDER_STATUS', async () => {
    const tx = makeTx({ id: 'O1', status: 'Bogus', deletedAt: null });
    await expect(linkOrderStatusFromShipment(tx, 'O1', 'Shipped')).rejects.toMatchObject({ code: 'INVALID_CURRENT_ORDER_STATUS' });
  });

  it('order 已 Shipping + Shipment Shipped → 幂等 skipped', async () => {
    const tx = makeTx({ id: 'O1', status: 'Shipping', deletedAt: null });
    const r = await linkOrderStatusFromShipment(tx, 'O1', 'Shipped');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('缺失 orderId → MISSING_ORDER', async () => {
    const tx = makeTx(null);
    const r = await linkOrderStatusFromShipment(tx, '', 'Shipped');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('MISSING_ORDER');
  });
});

// ============================================================================
// 集成测试：shipping route POST 创建 shipment → order 联动
// ============================================================================
import express from 'express';
import request from 'supertest';
import { createShippingRouter } from '../route';

function makeShippingTx(opts: { order?: any; shipmentFind?: any; txFail?: boolean }) {
  const shipmentCreate = vi.fn().mockImplementation(async ({ data }: any) => ({ id: data.id || 'S1', shipmentNumber: data.shipmentNumber, type: data.type, status: data.status, orderId: data.orderId }));
  const shipmentFind = opts.shipmentFind ?? null;
  const orderFind = vi.fn().mockResolvedValue(opts.order === undefined ? { id: 'O1', status: 'Pending', deletedAt: null } : opts.order);
  const orderUpdate = vi.fn().mockResolvedValue({});
  const orderStatusTransitionCreate = vi.fn().mockResolvedValue({});
  const tx = {
    shipment: { create: shipmentCreate, findUnique: vi.fn().mockResolvedValue(shipmentFind), update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data, shipmentNumber: 'SHP001' })) },
    shipmentEvent: { create: vi.fn().mockResolvedValue({}) },
    order: { findUnique: orderFind, update: orderUpdate },
    orderStatusTransition: { create: orderStatusTransitionCreate },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    entityReference: { upsert: vi.fn().mockResolvedValue({}) },
    entityLink: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const $transaction = vi.fn(async (fn: any) => {
    if (opts.txFail) throw new Error('TX_FAIL');
    return fn(tx);
  });
  return { tx, $transaction };
}

describe('task order-shipment-link: shipping route POST 创建 → order 联动', () => {
  it('创建 Shipped shipment + orderId → order Pending→Shipping（同事务）', async () => {
    const { tx, $transaction } = makeShippingTx({ order: { id: 'O1', status: 'Pending', deletedAt: null } });
    const prisma = { $transaction } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({ shipmentNumber: 'S1', type: 'Ocean', shippingMethod: 'FCL', orderId: 'O1', status: 'Shipped' });
    expect(res.status).toBe(201);
    expect(tx.orderStatusTransition.create).toHaveBeenCalledTimes(1);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'O1' }, data: expect.objectContaining({ status: 'Shipping' }) }));
  });

  it('创建 Booked shipment（default）+ orderId → order Confirmed→Shipping（联动）', async () => {
    const { tx, $transaction } = makeShippingTx({ order: { id: 'O1', status: 'Confirmed', deletedAt: null } });
    const prisma = { $transaction } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({ shipmentNumber: 'S2', type: 'Air', shippingMethod: 'Express', orderId: 'O1', status: 'Booked' });
    expect(res.status).toBe(201);
    expect(tx.orderStatusTransition.create).toHaveBeenCalledTimes(1);
    expect(tx.order.update).toHaveBeenCalled();
  });

  it('创建 shipment 无 orderId → 不触发联动（正常）', async () => {
    const { tx, $transaction } = makeShippingTx({});
    const prisma = { $transaction } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({ shipmentNumber: 'S3', type: 'Ocean', shippingMethod: 'FCL', status: 'Booked' });
    expect(res.status).toBe(201);
    expect(tx.order.findUnique).not.toHaveBeenCalled();
  });

  it('创建 shipment orderId 指向终态 order → 400 ORDER_TERMINAL', async () => {
    const { $transaction } = makeShippingTx({ order: { id: 'O1', status: 'Delivered', deletedAt: null } });
    const prisma = { $transaction } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({ shipmentNumber: 'S4', type: 'Ocean', shippingMethod: 'FCL', orderId: 'O1', status: 'Shipped' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORDER_TERMINAL');
  });

  it('创建 shipment orderId 指向不存在 order → 404 ORDER_NOT_FOUND', async () => {
    const { $transaction } = makeShippingTx({ order: null });
    const prisma = { $transaction } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({ shipmentNumber: 'S5', type: 'Ocean', shippingMethod: 'FCL', orderId: 'OX', status: 'Shipped' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('事务失败（联动 rollback）→ 500 不伪成功', async () => {
    const { $transaction } = makeShippingTx({ order: { id: 'O1', status: 'Pending', deletedAt: null }, txFail: true });
    const prisma = { $transaction } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({ shipmentNumber: 'S6', type: 'Ocean', shippingMethod: 'FCL', orderId: 'O1', status: 'Shipped' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CREATE_FAILED');
  });
});

describe('task order-shipment-link: shipping route PATCH 状态变更 → order 联动', () => {
  it('PATCH shipment Booked→Shipped + orderId → order 联动', async () => {
    const tx = {
      shipment: { findUnique: vi.fn().mockResolvedValue({ id: 'S1', status: 'Booked', shipmentNumber: 'SHP001', orderId: 'O1' }), update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, status: data.status, shipmentNumber: 'SHP001', orderId: 'O1' })) },
      shipmentEvent: { create: vi.fn().mockResolvedValue({}) },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'O1', status: 'Confirmed', deletedAt: null }), update: vi.fn().mockResolvedValue({}) },
      orderStatusTransition: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      entityReference: { upsert: vi.fn().mockResolvedValue({}) },
      entityLink: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Shipped' });
    expect(res.status).toBe(200);
    expect(tx.orderStatusTransition.create).toHaveBeenCalledTimes(1);
    expect(tx.order.update).toHaveBeenCalled();
  });

  it('PATCH shipment Cleared→Delivered + orderId → order → Delivered', async () => {
    const tx = {
      shipment: { findUnique: vi.fn().mockResolvedValue({ id: 'S1', status: 'Cleared', shipmentNumber: 'SHP001', orderId: 'O1' }), update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, status: data.status, shipmentNumber: 'SHP001', orderId: 'O1' })) },
      shipmentEvent: { create: vi.fn().mockResolvedValue({}) },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'O1', status: 'Shipping', deletedAt: null }), update: vi.fn().mockResolvedValue({}) },
      orderStatusTransition: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      entityReference: { upsert: vi.fn().mockResolvedValue({}) },
      entityLink: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Delivered' });
    expect(res.status).toBe(200);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'Delivered' }) }));
  });

  it('PATCH shipment orderId 指向终态 order → 400 ORDER_TERMINAL', async () => {
    // shipment Arrived→Cleared 合法转移，但 order 已 Delivered（终态）→ ORDER_TERMINAL
    const tx = {
      shipment: { findUnique: vi.fn().mockResolvedValue({ id: 'S1', status: 'Arrived', shipmentNumber: 'SHP001', orderId: 'O1' }), update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, status: data.status, shipmentNumber: 'SHP001', orderId: 'O1' })) },
      shipmentEvent: { create: vi.fn().mockResolvedValue({}) },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'O1', status: 'Delivered', deletedAt: null }), update: vi.fn() },
      orderStatusTransition: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      entityReference: { upsert: vi.fn() },
      entityLink: { upsert: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).patch('/api/v1/shipping/S1').set(authHeader()).send({ status: 'Cleared' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORDER_TERMINAL');
  });
});
