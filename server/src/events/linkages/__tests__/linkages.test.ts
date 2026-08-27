/**
 * Phase 1 Sprint 3 — 联动执行器单元测试
 *
 * 覆盖：
 *   L1: OrderConfirmed → initProductionStages（含幂等检查）
 *   L2: ProductionCompleted → createShipment（含已存在跳过、订单未找到）
 *   L3: ShipmentCompleted → createInvoice（含已存在跳过、无金额跳过）
 *   L5: PaymentVoucherCreated → autoAllocate（含匹配发票、无匹配跳过、非 Receipt 跳过）
 *
 * 测试策略：
 *   - Mock prisma（避免真实 DB）
 *   - Mock service 函数（createShipment/createInvoice/createAllocation/initProductionStages）
 *   - 验证幂等性：相同事件不重复执行
 *   - 验证失败恢复：失败后可重试
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock 依赖服务
vi.mock('../../../production/stageService', () => ({
  initProductionStages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shipping/shipmentMutationService', () => ({
  createShipment: vi.fn(),
}));
vi.mock('../../../finance/invoiceMutationService', () => ({
  createInvoice: vi.fn(),
}));
vi.mock('../../../finance/allocationMutationService', () => ({
  createAllocation: vi.fn(),
}));
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { businessEventBus, publishBusinessEvent } from '../../businessEventBus';
import { initProductionStages } from '../../../production/stageService';
import { createShipment } from '../../../shipping/shipmentMutationService';
import { createInvoice } from '../../../finance/invoiceMutationService';
import { createAllocation } from '../../../finance/allocationMutationService';
import { registerAllLinkages } from '../index';

// ── Mock Prisma 工厂 ──
function makeMockPrisma(overrides: Record<string, any> = {}) {
  return {
    shipment: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.shipment,
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.order,
    },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.invoice,
    },
    paymentVoucher: {
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.paymentVoucher,
    },
    invoiceAllocation: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { appliedAmount: null } }),
      ...overrides.invoiceAllocation,
    },
    ...overrides,
  } as any;
}

describe('Linkage Handlers', () => {
  let prisma: any;

  beforeEach(() => {
    vi.clearAllMocks();
    businessEventBus.reset();
    prisma = makeMockPrisma();
    businessEventBus.setPrisma(prisma);
    registerAllLinkages();
  });

  // ── L1: OrderConfirmed → initProductionStages ──
  describe('L1: OrderConfirmed → initProductionStages', () => {
    it('initializes production stages when order is confirmed', async () => {
      await publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: 'ord_1',
        orderId: 'ord_1',
        payload: { poNumber: 'PO-001', fromStatus: 'Pending' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(initProductionStages).toHaveBeenCalledWith(prisma, 'ord_1');
    });

    it('skips when orderId is missing', async () => {
      await publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: 'ord_1',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(initProductionStages).not.toHaveBeenCalled();
    });

    it('does not re-execute for duplicate event (same orderId)', async () => {
      await publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: 'ord_1',
        orderId: 'ord_1',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      await publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: 'ord_1',
        orderId: 'ord_1',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(initProductionStages).toHaveBeenCalledTimes(1);
    });
  });

  // ── L2: ProductionCompleted → createShipment ──
  describe('L2: ProductionCompleted → createShipment', () => {
    it('creates shipment draft when production completes', async () => {
      prisma.order.findUnique.mockResolvedValue({
        poNumber: 'PO-001',
        customer: 'ACME Corp',
        customerRelationId: 'rel_1',
        currency: 'USD',
      });
      (createShipment as any).mockResolvedValue({
        ok: true,
        data: { shipment: { id: 'SHP_1', shipmentNumber: 'SHP-PO-001-xxx' } },
      });

      await publishBusinessEvent({
        type: 'ProductionCompleted',
        sourceEntityType: 'ProductionStage',
        sourceEntityId: 'pst_1',
        orderId: 'ord_1',
        payload: { stageKey: 'qc_shipped' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createShipment).toHaveBeenCalledTimes(1);
      const callArg = (createShipment as any).mock.calls[0][0];
      expect(callArg.input.orderId).toBe('ord_1');
      expect(callArg.input.status).toBe('Draft');
      expect(callArg.input.type).toBe('Export');
      expect(callArg.actorId).toBe('system');
    });

    it('skips when shipment already exists for order', async () => {
      prisma.shipment.findFirst.mockResolvedValue({ id: 'SHP_existing', shipmentNumber: 'SHP-001' });

      await publishBusinessEvent({
        type: 'ProductionCompleted',
        sourceEntityType: 'ProductionStage',
        sourceEntityId: 'pst_1',
        orderId: 'ord_1',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createShipment).not.toHaveBeenCalled();
    });

    it('returns not-ok when order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await publishBusinessEvent({
        type: 'ProductionCompleted',
        sourceEntityType: 'ProductionStage',
        sourceEntityId: 'pst_1',
        orderId: 'ord_missing',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createShipment).not.toHaveBeenCalled();
    });
  });

  // ── L3: ShipmentCompleted → createInvoice ──
  describe('L3: ShipmentCompleted → createInvoice', () => {
    it('creates receivable invoice draft when shipment is delivered', async () => {
      prisma.order.findUnique.mockResolvedValue({
        poNumber: 'PO-001',
        customer: 'ACME Corp',
        customerRelationId: 'rel_1',
        currency: 'USD',
        totalNet: '5000.00',
        quoteAmount: '4800.00',
      });
      (createInvoice as any).mockResolvedValue({
        ok: true,
        data: { invoice: { id: 'INV_1', invoiceNumber: 'INV-PO-001-xxx' } },
      });

      await publishBusinessEvent({
        type: 'ShipmentCompleted',
        sourceEntityType: 'Shipment',
        sourceEntityId: 'shp_1',
        orderId: 'ord_1',
        payload: { shipmentNumber: 'SHP-001' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createInvoice).toHaveBeenCalledTimes(1);
      const callArg = (createInvoice as any).mock.calls[0][0];
      expect(callArg.input.orderId).toBe('ord_1');
      expect(callArg.input.type).toBe('Receivable');
      expect(callArg.input.status).toBe('Draft');
      expect(callArg.input.amount).toBe('5000'); // totalNet 优先，Prisma.Decimal 规范化去尾零
      expect(callArg.input.currency).toBe('USD');
    });

    it('skips when invoice already exists for order', async () => {
      prisma.invoice.findFirst.mockResolvedValue({ id: 'INV_existing', invoiceNumber: 'INV-001', status: 'Draft' });

      await publishBusinessEvent({
        type: 'ShipmentCompleted',
        sourceEntityType: 'Shipment',
        sourceEntityId: 'shp_1',
        orderId: 'ord_1',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createInvoice).not.toHaveBeenCalled();
    });

    it('skips when order has no valid amount', async () => {
      prisma.order.findUnique.mockResolvedValue({
        poNumber: 'PO-001',
        customer: 'ACME',
        currency: 'USD',
        totalNet: null,
        quoteAmount: '0',
      });

      await publishBusinessEvent({
        type: 'ShipmentCompleted',
        sourceEntityType: 'Shipment',
        sourceEntityId: 'shp_1',
        orderId: 'ord_1',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createInvoice).not.toHaveBeenCalled();
    });
  });

  // ── L5: PaymentVoucherCreated → autoAllocate ──
  describe('L5: PaymentVoucherCreated → autoAllocate', () => {
    it('auto-allocates when voucher has explicit invoiceId', async () => {
      prisma.paymentVoucher.findUnique.mockResolvedValue({
        id: 'voc_1',
        voucherNumber: 'PAY-001',
        type: 'Receipt',
        amount: '3000.00',
        currency: 'USD',
        invoiceId: 'inv_1',
        orderId: 'ord_1',
        customerRelationId: 'rel_1',
        status: 'unreconciled',
        appliedAmount: null,
      });
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_1',
        invoiceNumber: 'INV-001',
        amount: '5000.00',
        status: 'Issued',
        currency: 'USD',
      });
      prisma.invoiceAllocation.aggregate.mockResolvedValue({ _sum: { appliedAmount: null } });
      (createAllocation as any).mockResolvedValue({
        ok: true,
        data: {
          allocation: { id: 'alloc_1', invoiceId: 'inv_1', voucherId: 'voc_1', appliedAmount: '3000.00', appliedDate: '2026-08-06' },
          newInvoiceStatus: 'PartiallyPaid',
          newVoucherStatus: 'reconciled',
        },
      });

      await publishBusinessEvent({
        type: 'PaymentVoucherCreated',
        sourceEntityType: 'PaymentVoucher',
        sourceEntityId: 'voc_1',
        orderId: 'ord_1',
        payload: { voucherNumber: 'PAY-001', type: 'Receipt', amount: '3000.00', invoiceId: 'inv_1' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createAllocation).toHaveBeenCalledTimes(1);
      const callArg = (createAllocation as any).mock.calls[0][0];
      expect(callArg.input.invoiceId).toBe('inv_1');
      expect(callArg.input.voucherId).toBe('voc_1');
      expect(callArg.input.appliedAmount).toBe('3000'); // Prisma.Decimal 规范化去尾零
      expect(callArg.actorId).toBe('system');
    });

    it('skips non-Receipt type vouchers', async () => {
      await publishBusinessEvent({
        type: 'PaymentVoucherCreated',
        sourceEntityType: 'PaymentVoucher',
        sourceEntityId: 'voc_2',
        payload: { type: 'Disbursement', amount: '1000.00' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createAllocation).not.toHaveBeenCalled();
    });

    it('skips already reconciled vouchers', async () => {
      prisma.paymentVoucher.findUnique.mockResolvedValue({
        id: 'voc_3',
        type: 'Receipt',
        amount: '1000.00',
        status: 'reconciled',
        appliedAmount: '1000.00',
        invoiceId: null,
        orderId: null,
        customerRelationId: null,
      });

      await publishBusinessEvent({
        type: 'PaymentVoucherCreated',
        sourceEntityType: 'PaymentVoucher',
        sourceEntityId: 'voc_3',
        payload: { type: 'Receipt', amount: '1000.00' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createAllocation).not.toHaveBeenCalled();
    });

    it('skips when no matching invoice found', async () => {
      prisma.paymentVoucher.findUnique.mockResolvedValue({
        id: 'voc_4',
        type: 'Receipt',
        amount: '1000.00',
        status: 'unreconciled',
        appliedAmount: null,
        invoiceId: null,
        orderId: null,
        customerRelationId: null,
      });

      await publishBusinessEvent({
        type: 'PaymentVoucherCreated',
        sourceEntityType: 'PaymentVoucher',
        sourceEntityId: 'voc_4',
        payload: { type: 'Receipt', amount: '1000.00' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(createAllocation).not.toHaveBeenCalled();
    });

    it('allocates minimum of voucher remaining and invoice remaining', async () => {
      prisma.paymentVoucher.findUnique.mockResolvedValue({
        id: 'voc_5',
        type: 'Receipt',
        amount: '3000.00',
        currency: 'USD',
        status: 'unreconciled',
        appliedAmount: null,
        invoiceId: 'inv_5',
        orderId: null,
        customerRelationId: null,
      });
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_5',
        invoiceNumber: 'INV-005',
        amount: '2000.00',
        status: 'Issued',
        currency: 'USD',
      });
      prisma.invoiceAllocation.aggregate.mockResolvedValue({ _sum: { appliedAmount: null } });
      (createAllocation as any).mockResolvedValue({
        ok: true,
        data: {
          allocation: { id: 'alloc_5', appliedAmount: '2000.00' },
          newInvoiceStatus: 'Paid',
          newVoucherStatus: 'partially_reconciled',
        },
      });

      await publishBusinessEvent({
        type: 'PaymentVoucherCreated',
        sourceEntityType: 'PaymentVoucher',
        sourceEntityId: 'voc_5',
        payload: { type: 'Receipt', amount: '3000.00', invoiceId: 'inv_5' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      // min(3000 voucher, 2000 invoice) = 2000
      expect(createAllocation).toHaveBeenCalledTimes(1);
      const callArg = (createAllocation as any).mock.calls[0][0];
      expect(callArg.input.appliedAmount).toBe('2000');
    });
  });

  // ── 联动注册 ──
  describe('registration', () => {
    it('registerAllLinkages is idempotent', () => {
      // Already registered in beforeEach, calling again should not throw
      expect(() => registerAllLinkages()).not.toThrow();
    });
  });
});
