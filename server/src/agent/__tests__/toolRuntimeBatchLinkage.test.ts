/**
 * W-B 断层④挂接点接线回归（Agent 直改路径）— toolRuntime 两条到 Shipped 的路径必须触发批次联动
 *
 * Agent 路径绕开 shipmentMutationService 且不发业务事件（走查发现的既有事实），
 * 因此联动采用服务层内联而非事件订阅；本文件锁定这两个内联点的接线不回归。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const autoAdvanceSpy = vi.hoisted(() => vi.fn().mockResolvedValue({ advanced: [], failed: [] }));

vi.mock('../../shipping/orderShipmentBatchService', () => ({
  createOrderShipmentBatchService: vi.fn(() => ({ autoAdvanceOnShipmentShipped: autoAdvanceSpy })),
}));
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../shipping/shipmentEligibilityGate', () => ({
  evaluateShipmentReleaseGate: vi.fn().mockResolvedValue({ ok: true, data: { orders: [] } }),
}));
vi.mock('../../shipping/orderLinkService', () => ({
  linkOrderStatusFromShipment: vi.fn().mockResolvedValue({ ok: true, skipped: true }),
}));
vi.mock('../../audit/routeAudit', () => ({
  writeRouteAuditLog: vi.fn().mockResolvedValue('AUDIT__TEST'),
}));
vi.mock('../../entities/sync', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    syncShipmentReferences: vi.fn().mockResolvedValue(undefined),
    deactivateEntityLinks: vi.fn().mockResolvedValue(undefined),
  };
});

import { handleShippingCreateShipment, handleShippingUpdateTrackingStatus } from '../toolRuntime';

function makePrisma(seed: { shipment?: any } = {}) {
  const shipmentRow = seed.shipment ?? null;
  const tx: any = {
    shipment: {
      findUnique: async () => shipmentRow,
      create: async ({ data }: any) => ({ ...data }),
      update: async ({ where, data }: any) => ({ ...shipmentRow, ...data, id: where.id }),
    },
    shipmentOrderAllocation: { findMany: async () => [] },
    shipmentEvent: { create: async ({ data }: any) => ({ ...data }) },
  };
  const prisma: any = { $transaction: async (fn: any) => fn(tx) };
  return { prisma, tx };
}

beforeEach(() => { vi.clearAllMocks(); autoAdvanceSpy.mockResolvedValue({ advanced: [], failed: [] }); });

describe('Agent 直建运单（handleShippingCreateShipment）', () => {
  it('直建 Shipped：触发批次自动联动（actorId=agent）', async () => {
    const { prisma } = makePrisma();
    const r = await handleShippingCreateShipment(prisma, {
      shipmentNumber: 'SH-2026-0010', type: 'FCL', shippingMethod: 'Sea', orderId: 'O-1', status: 'Shipped',
    });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).toHaveBeenCalledTimes(1);
    expect(autoAdvanceSpy.mock.calls[0][1]).toBe('agent');
  });

  it('默认 Booked 创建：不触发', async () => {
    const { prisma } = makePrisma();
    const r = await handleShippingCreateShipment(prisma, {
      shipmentNumber: 'SH-2026-0011', type: 'FCL', shippingMethod: 'Sea', orderId: 'O-1',
    });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).not.toHaveBeenCalled();
  });
});

describe('Agent 更新跟踪状态（handleShippingUpdateTrackingStatus）', () => {
  it('Booked→Shipped：触发批次自动联动', async () => {
    const { prisma } = makePrisma({
      shipment: { id: 'SHP-1', status: 'Booked', orderId: 'O-1' },
    });
    const r = await handleShippingUpdateTrackingStatus(prisma, { shipmentId: 'SHP-1', status: 'Shipped' });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).toHaveBeenCalledTimes(1);
    expect(autoAdvanceSpy).toHaveBeenCalledWith('SHP-1', 'agent');
  });

  it('Booked→Loading：非 Shipped 不触发', async () => {
    const { prisma } = makePrisma({
      shipment: { id: 'SHP-1', status: 'Booked', orderId: 'O-1' },
    });
    const r = await handleShippingUpdateTrackingStatus(prisma, { shipmentId: 'SHP-1', status: 'Loading' });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).not.toHaveBeenCalled();
  });
});
