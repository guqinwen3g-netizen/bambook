import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createShippingRouter } from '../route';
import { authHeader } from '../../__tests__/authTestHelper';

/**
 * task ERP-P1-shipping-mutation-shared-service-foundation:
 * 覆盖 shipping route → shipmentMutationService 的事务/审计/联动契约。
 * 用 $transaction: (fn) => fn(tx) 透明穿透模式，验证 audit/sync/link reject → 事务回滚 → onDataChange 不触发。
 */

function makeApp(opts: {
  existingShipment?: any;
  auditFail?: boolean;
  syncFail?: boolean;
  linkFail?: boolean;
  order?: any;
  onDataChange?: any;
  shipmentCreateFail?: boolean;
  cleanupFail?: boolean;
} = {}) {
  const existing = opts.existingShipment ?? { id: 'SHP-1', shipmentNumber: 'SHP001', status: 'Booked' };
  const order = opts.hasOwnProperty('order') ? opts.order : { id: 'ORDER-1', status: 'Confirmed', deletedAt: null };

  const shipmentCreate = opts.shipmentCreateFail
    ? vi.fn().mockRejectedValue(new Error('DB_BOOM'))
    : vi.fn().mockImplementation(async ({ data }: any) => {
        const { createdAt, updatedAt, ...rest } = data;
        return { ...rest, id: data.id || 'SHP-NEW' };
      });
  const shipmentUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => {
    const { updatedAt, deletedAt, ...rest } = data;
    return { ...existing, ...rest, id: where.id };
  });
  const shipmentFindUnique = vi.fn().mockImplementation(async ({ where }: any) => {
    if (where.id === existing.id) return existing;
    return null;
  });
  const auditCreate = opts.auditFail
    ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT'))
    : vi.fn().mockResolvedValue({ id: 'AL-1' });
  const entityRefUpsert = opts.syncFail
    ? vi.fn().mockRejectedValue(new Error('SYNC_BOOM'))
    : vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});
  const entityLinkFindMany = vi.fn().mockResolvedValue([{ id: 'LINK-1' }]);
  const entityRefFindMany = vi.fn().mockResolvedValue([{ id: 'REF-1' }]);
  const entityLinkUpdate = opts.cleanupFail ? vi.fn().mockRejectedValue(new Error('CLEANUP_BOOM')) : vi.fn().mockResolvedValue({});
  const entityRefUpdate = vi.fn().mockResolvedValue({});
  const orderFindUnique = vi.fn().mockResolvedValue(order);
  const orderUpdate = opts.linkFail
    ? vi.fn().mockRejectedValue(new Error('ORDER_BOOM'))
    : vi.fn().mockResolvedValue(order);
  const orderStatusTransitionCreate = vi.fn().mockResolvedValue({});
  const shipmentEventCreate = vi.fn().mockResolvedValue({});
  const shipmentEventFindMany = vi.fn().mockResolvedValue([]);

  const tx: any = {
    shipment: { create: shipmentCreate, update: shipmentUpdate, findUnique: shipmentFindUnique },
    shipmentEvent: { create: shipmentEventCreate, findMany: shipmentEventFindMany },
    shipmentOrderAllocation: { findMany: vi.fn().mockResolvedValue([]) }, // DR-016 合票分配（本组用例无合票）
    order: { findUnique: orderFindUnique, update: orderUpdate },
    orderLine: { findMany: vi.fn().mockResolvedValue([]) }, // C4：首装自动带出装运行——空订单行跳过
    orderStatusTransition: { create: orderStatusTransitionCreate },
    auditLog: { create: auditCreate },
    entityReference: { upsert: entityRefUpsert, findMany: entityRefFindMany, update: entityRefUpdate },
    entityLink: { upsert: entityLinkUpsert, findMany: entityLinkFindMany, update: entityLinkUpdate },
  };
  const prisma: any = {
    shipment: { findUnique: shipmentFindUnique },
    shipmentEvent: { findMany: shipmentEventFindMany },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const onDataChange = opts.onDataChange || vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/shipping', createShippingRouter({ prisma, requireAuth: false, apiKeys: new Set<string>(), onDataChange }));
  return { app, prisma, tx, shipmentCreate, shipmentUpdate, shipmentFindUnique, shipmentEventCreate, shipmentEventFindMany, auditCreate, entityRefUpsert, entityLinkUpsert, entityLinkFindMany, entityLinkUpdate, entityRefFindMany, entityRefUpdate, orderFindUnique, orderUpdate, onDataChange };
}

describe('shipping route → service: POST /', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功创建 → 201 + 事务内 sync + audit + order 联动 + onDataChange 事务后', async () => {
    const { app, shipmentCreate, entityRefUpsert, entityLinkUpsert, auditCreate, orderUpdate, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({
      shipmentNumber: 'SHP001', type: 'sea', shippingMethod: 'ocean', orderId: 'ORDER-1',
      customerRelationId: 'REL-1', customerName: 'Acme',
    });
    expect(res.status).toBe(201);
    expect(shipmentCreate).toHaveBeenCalledTimes(1);
    expect(entityRefUpsert).toHaveBeenCalled();
    expect(entityLinkUpsert).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(orderUpdate).toHaveBeenCalled(); // Booked → Order Shipping
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('非法 status → 400 INVALID_STATUS，未进 $transaction', async () => {
    const { app, prisma, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({
      shipmentNumber: 'SHP001', type: 'sea', shippingMethod: 'ocean', status: 'BogusStatus',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('sync reject → 500 CREATE_FAILED，audit/onDataChange 不触发', async () => {
    const { app, auditCreate, onDataChange } = makeApp({ syncFail: true });
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({
      shipmentNumber: 'SHP001', type: 'sea', shippingMethod: 'ocean', orderId: 'ORDER-1',
    });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CREATE_FAILED');
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit reject → 500 CREATE_FAILED，onDataChange 不触发', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({
      shipmentNumber: 'SHP001', type: 'sea', shippingMethod: 'ocean',
    });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CREATE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('order link 失败 → 500 CREATE_FAILED，onDataChange 不触发', async () => {
    const { app, onDataChange } = makeApp({ linkFail: true });
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({
      shipmentNumber: 'SHP001', type: 'sea', shippingMethod: 'ocean', orderId: 'ORDER-1',
    });
    expect(res.status).toBe(500);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('order 不存在 → 404 ORDER_NOT_FOUND', async () => {
    const { app, onDataChange } = makeApp({ order: null });
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({
      shipmentNumber: 'SHP001', type: 'sea', shippingMethod: 'ocean', orderId: 'MISSING',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('shipping route → service: PATCH /:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功更新 → 200 + sync + audit + onDataChange', async () => {
    const { app, shipmentUpdate, auditCreate, entityRefUpsert, onDataChange } = makeApp({
      existingShipment: { id: 'SHP-1', shipmentNumber: 'SHP001', status: 'Booked' },
    });
    const res = await request(app).patch('/api/v1/shipping/SHP-1').set(authHeader()).send({ vesselOrFlight: 'MV-1' });
    expect(res.status).toBe(200);
    expect(shipmentUpdate).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('not found → 404 NOT_FOUND', async () => {
    const { app, onDataChange } = makeApp({ existingShipment: { id: 'OTHER', shipmentNumber: 'X', status: 'Booked' } });
    const res = await request(app).patch('/api/v1/shipping/MISSING').set(authHeader()).send({ vesselOrFlight: 'MV-1' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit reject → 500 UPDATE_FAILED，onDataChange 不触发', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).patch('/api/v1/shipping/SHP-1').set(authHeader()).send({ vesselOrFlight: 'MV-1' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('UPDATE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('非字符串 status → 400 INVALID_STATUS', async () => {
    const { app, onDataChange } = makeApp();
    const res = await request(app).patch('/api/v1/shipping/SHP-1').set(authHeader()).send({ status: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('shipping route → service: DELETE /:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功软删 → 200 + EntityReference/EntityLink inactive + audit + onDataChange', async () => {
    const { app, shipmentUpdate, auditCreate, entityLinkFindMany, entityLinkUpdate, entityRefFindMany, entityRefUpdate, onDataChange } = makeApp();
    const res = await request(app).delete('/api/v1/shipping/SHP-1').set(authHeader());
    expect(res.status).toBe(200);
    expect(shipmentUpdate).toHaveBeenCalled();
    expect(entityLinkFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ fromType: 'shipment', fromId: 'SHP-1', status: 'active' }) }));
    expect(entityLinkUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'LINK-1' }, data: expect.objectContaining({ status: 'inactive' }) }));
    expect(entityRefFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerType: 'shipment', ownerId: 'SHP-1', status: 'active' }) }));
    expect(entityRefUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'REF-1' }, data: expect.objectContaining({ status: 'inactive' }) }));
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('not found → 404 NOT_FOUND', async () => {
    const { app, onDataChange } = makeApp({ existingShipment: { id: 'OTHER', shipmentNumber: 'X', status: 'Booked' } });
    const res = await request(app).delete('/api/v1/shipping/MISSING').set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('cleanup reject → 500 DELETE_FAILED，audit/onDataChange 不触发', async () => {
    const { app, auditCreate, onDataChange } = makeApp({ cleanupFail: true });
    const res = await request(app).delete('/api/v1/shipping/SHP-1').set(authHeader());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DELETE_FAILED');
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit reject → 500 DELETE_FAILED，onDataChange 不触发', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).delete('/api/v1/shipping/SHP-1').set(authHeader());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DELETE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('shipping route → service: route→service 契约', () => {
  it('POST/PATCH/DELETE 都触发 $transaction（不再有平行事务）', async () => {
    const { app, prisma } = makeApp();
    await request(app).post('/api/v1/shipping').set(authHeader()).send({ shipmentNumber: 'S1', type: 'sea', shippingMethod: 'ocean' });
    await request(app).patch('/api/v1/shipping/SHP-1').set(authHeader()).send({ vesselOrFlight: 'MV-1' });
    await request(app).delete('/api/v1/shipping/SHP-1').set(authHeader());
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

// ── F3：ShipmentEvent 物流节点时间轴 ──
describe('F3: ShipmentEvent 节点跟踪', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST 创建 → 事务内落首节点事件（fromNode=null，toNode=初始状态，eventDate 取 bookingDate）', async () => {
    const { app, shipmentEventCreate } = makeApp();
    const res = await request(app).post('/api/v1/shipping').set(authHeader()).send({
      shipmentNumber: 'SHP001', type: 'sea', shippingMethod: 'ocean', bookingDate: '2026-08-10',
    });
    expect(res.status).toBe(201);
    expect(shipmentEventCreate).toHaveBeenCalledTimes(1);
    expect(shipmentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromNode: null, toNode: 'Booked', eventDate: '2026-08-10' }),
      }),
    );
  });

  it('PATCH 状态变更 → 落节点事件（from/to + Shipped 取 atd）；同状态幂等 patch 不落事件', async () => {
    const { app, shipmentEventCreate } = makeApp();
    const res = await request(app).patch('/api/v1/shipping/SHP-1').set(authHeader()).send({ status: 'Shipped', atd: '2026-08-15' });
    expect(res.status).toBe(200);
    expect(shipmentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shipmentId: 'SHP-1', fromNode: 'Booked', toNode: 'Shipped', eventDate: '2026-08-15' }),
      }),
    );

    shipmentEventCreate.mockClear();
    const res2 = await request(app).patch('/api/v1/shipping/SHP-1').set(authHeader()).send({ vesselOrFlight: 'MV-2' });
    expect(res2.status).toBe(200);
    expect(shipmentEventCreate).not.toHaveBeenCalled();
  });

  it('GET /:id/events → 升序返回节点时间轴；运单不存在 → 404', async () => {
    const { app, shipmentEventFindMany } = makeApp();
    shipmentEventFindMany.mockResolvedValueOnce([
      { id: 'e1', shipmentId: 'SHP-1', fromNode: null, toNode: 'Booked', eventDate: '2026-08-10' },
      { id: 'e2', shipmentId: 'SHP-1', fromNode: 'Booked', toNode: 'Shipped', eventDate: '2026-08-15' },
    ]);
    const res = await request(app).get('/api/v1/shipping/SHP-1/events').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[1].toNode).toBe('Shipped');
    expect(shipmentEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shipmentId: 'SHP-1' },
        orderBy: [{ eventDate: 'asc' }, { createdAt: 'asc' }],
      }),
    );

    const res404 = await request(app).get('/api/v1/shipping/MISSING/events').set(authHeader());
    expect(res404.status).toBe(404);
  });
});
