/**
 * W-B 断层④挂接点接线回归 — Shipment→Shipped 各路径自动推进批次的接线断言
 *
 * 与 orderShipmentBatchService.test.ts 的分工：
 *   - 该文件测联动执行体（autoAdvanceOnShipmentShipped）的行为语义；
 *   - 本文件测「挂接点是否接线」——createShipment / updateShipment 到达 Shipped 时
 *     必须调用联动（Agent 两条路径的接线断言见 agent/__tests__/toolRuntimeBatchLinkage.test.ts）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const autoAdvanceSpy = vi.hoisted(() => vi.fn().mockResolvedValue({ advanced: [], failed: [] }));

vi.mock('../orderShipmentBatchService', () => ({
  createOrderShipmentBatchService: vi.fn(() => ({ autoAdvanceOnShipmentShipped: autoAdvanceSpy })),
}));
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../entities/sync', () => ({
  syncShipmentReferences: vi.fn().mockResolvedValue(undefined),
  deactivateEntityLinks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../orderLinkService', () => ({
  linkOrderStatusFromShipment: vi.fn().mockResolvedValue({ ok: true, skipped: true }),
}));
vi.mock('../../audit/routeAudit', () => ({
  writeRouteAuditLog: vi.fn().mockResolvedValue('AUDIT__TEST'),
}));
vi.mock('../../events/businessEventBus', () => ({
  publishBusinessEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../shipmentPackingService', () => ({
  mapOrderLinesToShipmentLineInputs: vi.fn(() => []),
  replaceShipmentLinesTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../shipmentEligibilityGate', () => ({
  evaluateShipmentReleaseGate: vi.fn().mockResolvedValue({ ok: true, data: { orders: [] } }),
}));

import { createShipment, updateShipment } from '../shipmentMutationService';

/** tx mock：Shipment 存一行 Booked，可按需种子化 */
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
    orderLine: { findMany: async () => [] },
  };
  const prisma: any = { $transaction: async (fn: any) => fn(tx) };
  return { prisma, tx };
}

beforeEach(() => { vi.clearAllMocks(); autoAdvanceSpy.mockResolvedValue({ advanced: [], failed: [] }); });

describe('updateShipment 挂接点', () => {
  it('Booked→Shipped：触发批次自动联动（shipmentId + actorId 透传）', async () => {
    const { prisma } = makePrisma({
      shipment: { id: 'SHP-1', status: 'Booked', shipmentNumber: 'SH-2026-0001', orderId: 'O-1', deletedAt: null },
    });
    const r = await updateShipment({
      prisma, shipmentId: 'SHP-1', patch: { status: 'Shipped' }, hasStatus: true, actorId: 'actor-1',
    });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).toHaveBeenCalledTimes(1);
    expect(autoAdvanceSpy).toHaveBeenCalledWith('SHP-1', 'actor-1');
  });

  it('Booked→Loading：非 Shipped 不触发', async () => {
    const { prisma } = makePrisma({
      shipment: { id: 'SHP-1', status: 'Booked', shipmentNumber: 'SH-2026-0001', orderId: 'O-1', deletedAt: null },
    });
    const r = await updateShipment({
      prisma, shipmentId: 'SHP-1', patch: { status: 'Loading' }, hasStatus: true, actorId: 'actor-1',
    });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).not.toHaveBeenCalled();
  });

  it('Shipped→Arrived：离开 Shipped 不触发（从状态非 Shipped 才触发）', async () => {
    const { prisma } = makePrisma({
      shipment: { id: 'SHP-1', status: 'Shipped', shipmentNumber: 'SH-2026-0001', orderId: 'O-1', deletedAt: null },
    });
    const r = await updateShipment({
      prisma, shipmentId: 'SHP-1', patch: { status: 'Arrived' }, hasStatus: true, actorId: 'actor-1',
    });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).not.toHaveBeenCalled();
  });
});

describe('createShipment 挂接点（补录场景直建 Shipped）', () => {
  it('直建 Shipped：触发批次自动联动', async () => {
    const { prisma } = makePrisma();
    const r = await createShipment({
      prisma,
      input: { orderId: 'O-1', status: 'Shipped', shipmentNumber: 'SH-2026-0002', type: 'FCL', shippingMethod: 'Sea' },
      actorId: 'actor-1',
    });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).toHaveBeenCalledTimes(1);
    expect(autoAdvanceSpy.mock.calls[0][1]).toBe('actor-1');
    expect(typeof autoAdvanceSpy.mock.calls[0][0]).toBe('string'); // 服务端生成的 shipmentId
  });

  it('默认 Booked 创建：不触发', async () => {
    const { prisma } = makePrisma();
    const r = await createShipment({
      prisma,
      input: { orderId: 'O-1', shipmentNumber: 'SH-2026-0003', type: 'FCL', shippingMethod: 'Sea' },
      actorId: 'actor-1',
    });
    expect(r.ok).toBe(true);
    expect(autoAdvanceSpy).not.toHaveBeenCalled();
  });
});
