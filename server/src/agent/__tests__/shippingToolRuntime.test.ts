import { describe, expect, it, vi } from 'vitest';
import { handleShippingCreateShipment, handleShippingUpdateTrackingStatus } from '../toolRuntime';

// ============================================================================
// task review-fix: 真实 handler 执行测试（mock prisma tx）
// ============================================================================

function makeTx(opts: {
  shipmentCreate?: any;
  shipmentFind?: any;
  shipmentUpdate?: any;
  auditCreate?: any;
  syncRefs?: any; // entityReference/entityLink upsert（syncShipmentReferences 调用）
  orderFind?: any;
  orderUpdate?: any;
} = {}) {
  const shipmentCreate = opts.shipmentCreate ?? vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, orderId: data.orderId }));
  const shipmentFind = opts.shipmentFind ?? vi.fn().mockResolvedValue({ id: 'S1', status: 'Booked', orderId: 'O1', shipmentNumber: 'SHP1' });
  const shipmentUpdate = opts.shipmentUpdate ?? vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data, orderId: 'O1', shipmentNumber: 'SHP1' }));
  const auditCreate = opts.auditCreate ?? vi.fn().mockResolvedValue({});
  const entityRefUpsert = vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});
  const orderFind = opts.orderFind ?? vi.fn().mockResolvedValue({ id: 'O1', status: 'Pending', deletedAt: null });
  const orderUpdate = opts.orderUpdate ?? vi.fn().mockResolvedValue({});
  const orderStatusTransitionCreate = vi.fn().mockResolvedValue({});
  const shipmentEventCreate = vi.fn().mockResolvedValue({});

  const tx = {
    shipment: { create: shipmentCreate, findUnique: shipmentFind, update: shipmentUpdate },
    shipmentEvent: { create: shipmentEventCreate },
    shipmentOrderAllocation: { findMany: vi.fn().mockResolvedValue([]) }, // DR-016 合票分配（本组用例无合票）
    auditLog: { create: auditCreate },
    entityReference: { upsert: entityRefUpsert },
    entityLink: { upsert: entityLinkUpsert },
    order: { findUnique: orderFind, update: orderUpdate },
    orderStatusTransition: { create: orderStatusTransitionCreate },
  };
  return { tx, shipmentCreate, shipmentFind, shipmentUpdate, shipmentEventCreate, auditCreate, entityRefUpsert, entityLinkUpsert, orderFind, orderUpdate, orderStatusTransitionCreate };
}

function makePrisma(tx: any, txFail = false) {
  const $transaction = vi.fn(async (fn: any) => {
    if (txFail) throw new Error('TX_FAIL');
    return fn(tx);
  });
  return { $transaction } as any;
}

describe('task review-fix: handleShippingCreateShipment 真实执行', () => {
  it('status=Bad → INVALID_STATUS，$transaction/shipment.create/sync/audit/order-link 均不调用', async () => {
    const { tx, shipmentCreate, auditCreate, entityRefUpsert, orderFind } = makeTx();
    const prisma = makePrisma(tx);
    const r = await handleShippingCreateShipment(prisma, {
      shipmentNumber: 'S1', type: 'Ocean', shippingMethod: 'FCL', status: 'BadStatus',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('INVALID_STATUS');
    // $transaction 未进
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
    expect(shipmentCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(entityRefUpsert).not.toHaveBeenCalled();
    expect(orderFind).not.toHaveBeenCalled();
  });

  it('create 成功 → tx.auditLog.create 被调用（同事务）', async () => {
    const { tx, auditCreate } = makeTx();
    const prisma = makePrisma(tx);
    const r = await handleShippingCreateShipment(prisma, {
      shipmentNumber: 'S1', type: 'Ocean', shippingMethod: 'FCL', status: 'Booked',
    });
    expect(r.ok).toBe(true);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    // 同一 tx（$transaction 只调一次）
    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
  });

  it('auditLog.create reject → CREATE_FAILED，不伪成功', async () => {
    const { tx } = makeTx({ auditCreate: vi.fn().mockRejectedValue(new Error('AUDIT_FAIL')) });
    const prisma = makePrisma(tx);
    const r = await handleShippingCreateShipment(prisma, {
      shipmentNumber: 'S1', type: 'Ocean', shippingMethod: 'FCL', status: 'Booked',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CREATE_FAILED');
  });

  it('sync reject（entityReference.upsert）→ CREATE_FAILED', async () => {
    const { tx, entityRefUpsert } = makeTx();
    entityRefUpsert.mockRejectedValue(new Error('SYNC_FAIL'));
    const prisma = makePrisma(tx);
    // 传 orderId 触发 sync 生成 ops（syncShipmentReferences 需 orderId/customer/carrier）
    const r = await handleShippingCreateShipment(prisma, {
      shipmentNumber: 'S1', type: 'Ocean', shippingMethod: 'FCL', orderId: 'O1', status: 'Booked',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CREATE_FAILED');
  });

  it('linkOrderStatusFromShipment reject（order 终态）→ ORDER_TERMINAL', async () => {
    const { tx } = makeTx({ orderFind: vi.fn().mockResolvedValue({ id: 'O1', status: 'Delivered', deletedAt: null }) });
    const prisma = makePrisma(tx);
    const r = await handleShippingCreateShipment(prisma, {
      shipmentNumber: 'S1', type: 'Ocean', shippingMethod: 'FCL', orderId: 'O1', status: 'Booked',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ORDER_TERMINAL');
  });
});

describe('task review-fix: handleShippingUpdateTrackingStatus 真实执行', () => {
  it('update 成功 → tx.auditLog.create 含 before/after', async () => {
    const { tx, auditCreate } = makeTx({
      shipmentFind: vi.fn().mockResolvedValue({ id: 'S1', status: 'Booked', orderId: 'O1', shipmentNumber: 'SHP1' }),
    });
    const prisma = makePrisma(tx);
    const r = await handleShippingUpdateTrackingStatus(prisma, { shipmentId: 'S1', status: 'Shipped' });
    expect(r.ok).toBe(true);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditCall = auditCreate.mock.calls[0][0];
    // writeRouteAuditLog 把 before/after 包在 detail 里
    expect(auditCall.data.detail.before).toEqual({ status: 'Booked' });
    expect(auditCall.data.detail.after).toEqual({ status: 'Shipped' });
  });

  it('auditLog.create reject → UPDATE_FAILED，不伪成功', async () => {
    const { tx } = makeTx({ auditCreate: vi.fn().mockRejectedValue(new Error('AUDIT_FAIL')) });
    const prisma = makePrisma(tx);
    const r = await handleShippingUpdateTrackingStatus(prisma, { shipmentId: 'S1', status: 'Shipped' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UPDATE_FAILED');
  });

  it('sync reject → UPDATE_FAILED', async () => {
    const { tx, entityRefUpsert } = makeTx();
    entityRefUpsert.mockRejectedValue(new Error('SYNC_FAIL'));
    const prisma = makePrisma(tx);
    const r = await handleShippingUpdateTrackingStatus(prisma, { shipmentId: 'S1', status: 'Shipped' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UPDATE_FAILED');
  });

  it('非法转移 Draft→Delivered → INVALID_TRANSITION', async () => {
    const { tx } = makeTx({
      shipmentFind: vi.fn().mockResolvedValue({ id: 'S1', status: 'Draft', orderId: null, shipmentNumber: 'SHP1' }),
    });
    const prisma = makePrisma(tx);
    const r = await handleShippingUpdateTrackingStatus(prisma, { shipmentId: 'S1', status: 'Delivered' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('INVALID_TRANSITION');
  });

  it('shipment 不存在 → SHIPMENT_NOT_FOUND', async () => {
    const { tx } = makeTx({ shipmentFind: vi.fn().mockResolvedValue(null) });
    const prisma = makePrisma(tx);
    const r = await handleShippingUpdateTrackingStatus(prisma, { shipmentId: 'NOPE', status: 'Shipped' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('SHIPMENT_NOT_FOUND');
  });
});

// ============================================================================
// F3：agent 直改路径同样落 ShipmentEvent（时间轴完整性单一来源）
// ============================================================================
describe('F3: agent 路径 ShipmentEvent 节点跟踪', () => {
  it('agent create → 事务内落首节点事件（fromNode=null，toNode=初始状态）', async () => {
    const { tx, shipmentEventCreate } = makeTx();
    const prisma = makePrisma(tx);
    const r = await handleShippingCreateShipment(prisma, {
      shipmentNumber: 'S1', type: 'Ocean', shippingMethod: 'FCL', status: 'Booked',
    });
    expect(r.ok).toBe(true);
    expect(shipmentEventCreate).toHaveBeenCalledTimes(1);
    expect(shipmentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromNode: null, toNode: 'Booked', actorId: 'agent' }),
      }),
    );
  });

  it('agent update_tracking 状态变更 → 落节点事件（from Booked → to Shipped）', async () => {
    const { tx, shipmentEventCreate } = makeTx();
    const prisma = makePrisma(tx);
    const r = await handleShippingUpdateTrackingStatus(prisma, { shipmentId: 'S1', status: 'Shipped' });
    expect(r.ok).toBe(true);
    expect(shipmentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shipmentId: 'S1', fromNode: 'Booked', toNode: 'Shipped', actorId: 'agent' }),
      }),
    );
  });
});
