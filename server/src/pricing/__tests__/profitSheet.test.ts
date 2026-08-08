import { describe, expect, it, beforeEach } from 'vitest';
import { createProfitSheetService, ProfitSheetDetails } from '../profitSheetService';

/**
 * Mock Prisma：内存存储 Order + Invoice + PurchaseOrder + Shipment +
 * PaymentVoucher + ExchangeRate + OrderProfitSheet。
 */
function makeMockPrisma() {
  let seq = 0;
  const orders: any[] = [];
  const invoices: any[] = [];
  const purchaseOrders: any[] = [];
  const shipments: any[] = [];
  const paymentVouchers: any[] = [];
  const exchangeRates: any[] = [];
  const profitSheets: any[] = [];

  const matchWhere = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const cond: any = v;
        if ('not' in cond) return cond.not === null ? row[k] !== null : row[k] !== cond.not;
        if ('in' in cond) return cond.in.includes(row[k]);
        return true;
      }
      return row[k] === v;
    });

  const applyOrderBy = (rows: any[], orderBy: any) => {
    if (!orderBy) return rows;
    const orders_ = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((x, y) => {
      for (const o of orders_) {
        const [[field, dir]] = Object.entries(o) as [string, string][];
        const xv = x[field] ?? null;
        const yv = y[field] ?? null;
        if (xv === yv) continue;
        if (xv === null) return 1;
        if (yv === null) return -1;
        if (typeof xv === 'bigint' && typeof yv === 'bigint') {
          return xv < yv ? (dir === 'desc' ? 1 : -1) : (dir === 'desc' ? -1 : 1);
        }
        if (xv < yv) return dir === 'desc' ? 1 : -1;
        if (xv > yv) return dir === 'desc' ? -1 : 1;
      }
      return 0;
    });
  };

  const findManyOf = (rows: any[]) => async ({ where, orderBy, take, skip }: any = {}) => {
    const matched = applyOrderBy(rows.filter(r => matchWhere(r, where)), orderBy);
    return matched.slice(skip || 0, (skip || 0) + (take ?? matched.length));
  };

  const orderProfitSheet = {
    findUnique: async ({ where }: any) => profitSheets.find(s => s.orderId === where.orderId) || null,
    findMany: findManyOf(profitSheets),
    count: async ({ where }: any = {}) => profitSheets.filter(r => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { ...data, id: data.id || `OPS__T${++seq}` };
      profitSheets.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = profitSheets.find(s => s.orderId === where.orderId);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = profitSheets.findIndex(s => s.orderId === where.orderId);
      if (idx < 0) throw new Error('not found');
      return profitSheets.splice(idx, 1)[0];
    },
  };

  return {
    order: { findUnique: async ({ where }: any) => orders.find(o => o.id === where.id) || null },
    invoice: { findMany: findManyOf(invoices) },
    purchaseOrder: { findMany: findManyOf(purchaseOrders) },
    shipment: { findMany: findManyOf(shipments) },
    paymentVoucher: { findMany: findManyOf(paymentVouchers) },
    exchangeRate: { findMany: findManyOf(exchangeRates) },
    orderProfitSheet,
    _stores: { orders, invoices, purchaseOrders, shipments, paymentVouchers, exchangeRates, profitSheets },
  };
}

function seedOrder(prisma: any, id = 'ORD-1') {
  prisma._stores.orders.push({ id, customer: 'Acme', product: 'Suit', deletedAt: null });
  return id;
}

describe('P1 · OrderProfitSheet 生成聚合', () => {
  let prisma: any;
  let service: ReturnType<typeof createProfitSheetService>;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = createProfitSheetService(prisma as any);
    seedOrder(prisma);
  });

  it('四类口径聚合：汇率快照优先，本币 rate=1，毛利率正确', async () => {
    prisma._stores.invoices.push(
      { id: 'INV-1', invoiceNumber: 'INV-2026-001', orderId: 'ORD-1', type: 'Receivable', status: 'Issued', amount: 10000, currency: 'USD', exchangeRate: 7.2, deletedAt: null },
      { id: 'INV-2', invoiceNumber: 'INV-2026-002', orderId: 'ORD-1', type: 'Receivable', status: 'Paid', amount: 7200, currency: 'CNY', exchangeRate: null, deletedAt: null },
      // Cancelled 不计入
      { id: 'INV-3', invoiceNumber: 'INV-2026-003', orderId: 'ORD-1', type: 'Receivable', status: 'Cancelled', amount: 99999, currency: 'CNY', exchangeRate: null, deletedAt: null },
      // Payable 不计入销售收入
      { id: 'INV-4', invoiceNumber: 'INV-2026-004', orderId: 'ORD-1', type: 'Payable', status: 'Issued', amount: 5000, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    prisma._stores.purchaseOrders.push(
      { id: 'PO-1', poNumber: 'PO-2026-001', orderId: 'ORD-1', status: 'Confirmed', totalAmount: 40000, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    prisma._stores.shipments.push(
      { id: 'SH-1', shipmentNumber: 'SH-2026-001', orderId: 'ORD-1', status: 'Shipped', deletedAt: null, freightAmount: 500, freightCurrency: 'USD', insuranceAmount: null, insuranceCurrency: null, customsAmount: 200, customsCurrency: 'CNY', otherCharges: null, otherChargesCurrency: null },
    );
    prisma._stores.paymentVouchers.push(
      { id: 'PV-1', voucherNumber: 'PAY-2026-001', orderId: 'ORD-1', type: 'Disbursement', invoiceId: null, amount: 1000, bankFee: 50, currency: 'CNY', exchangeRate: null, deletedAt: null },
      // 已核销发票的付款不算杂费
      { id: 'PV-2', voucherNumber: 'PAY-2026-002', orderId: 'ORD-1', type: 'Disbursement', invoiceId: 'INV-X', amount: 8888, bankFee: 0, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    prisma._stores.exchangeRates.push(
      { id: 'FXR-1', currency: 'USD', rate: 7.1, effectiveDate: '2026-08-08', createdAt: 1n },
    );

    const sheet = await service.generateOrderProfitSheet('ORD-1', 'u1');
    // sales: 10000×7.2(snapshot) + 7200×1 = 79200
    expect(sheet.salesRevenue).toBe(79200);
    // purchase: 40000
    expect(sheet.purchaseCost).toBe(40000);
    // freight: 500×7.1(latest) + 200 = 3750
    expect(sheet.freightCost).toBe(3750);
    // misc: 1000+50=1050
    expect(sheet.miscCost).toBe(1050);
    // gross: 79200-40000-3750-1050 = 34400
    expect(sheet.grossProfit).toBe(34400);
    expect(Number(sheet.grossMargin)).toBeCloseTo(43.43, 1);

    const details = sheet.details as unknown as ProfitSheetDetails;
    expect(details.sales[0].rateSource).toBe('snapshot');
    expect(details.sales[1].rateSource).toBe('base');
    expect(details.freight[0].rateSource).toBe('latest-rate');
    expect(details.unconverted).toHaveLength(0);
  });

  it('无可用汇率的外币行计入 unconverted 且不影响合计', async () => {
    prisma._stores.invoices.push(
      { id: 'INV-1', invoiceNumber: 'INV-2026-001', orderId: 'ORD-1', type: 'Receivable', status: 'Issued', amount: 5000, currency: 'EUR', exchangeRate: null, deletedAt: null },
      { id: 'INV-2', invoiceNumber: 'INV-2026-002', orderId: 'ORD-1', type: 'Receivable', status: 'Issued', amount: 7200, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    const sheet = await service.generateOrderProfitSheet('ORD-1', 'u1');
    expect(sheet.salesRevenue).toBe(7200); // EUR 行被排除
    const details = sheet.details as unknown as ProfitSheetDetails;
    expect(details.unconverted).toHaveLength(1);
    expect(details.unconverted[0]).toMatchObject({ kind: 'sales', currency: 'EUR', amount: 5000 });
  });

  it('幂等重生成：orderId 唯一覆盖更新，version 递增；sales=0 时 grossMargin 为 null', async () => {
    const first = await service.generateOrderProfitSheet('ORD-1', 'u1');
    expect(first.version).toBe(1);
    expect(first.salesRevenue).toBe(0);
    expect(first.grossMargin).toBeNull();

    prisma._stores.invoices.push(
      { id: 'INV-1', invoiceNumber: 'INV-2026-001', orderId: 'ORD-1', type: 'Receivable', status: 'Issued', amount: 1000, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    const second = await service.generateOrderProfitSheet('ORD-1', 'u1');
    expect(second.id).toBe(first.id); // 同一行覆盖更新
    expect(second.version).toBe(2);
    expect(second.salesRevenue).toBe(1000);
    expect(prisma._stores.profitSheets).toHaveLength(1);
  });

  it('订单不存在 → 抛错；删除后 getByOrder 返回 null', async () => {
    await expect(service.generateOrderProfitSheet('ORD-X', 'u1')).rejects.toThrow('订单不存在');
    await service.generateOrderProfitSheet('ORD-1', 'u1');
    await service.deleteProfitSheet('ORD-1', 'u1');
    expect(await service.getProfitSheetByOrder('ORD-1')).toBeNull();
  });
});
