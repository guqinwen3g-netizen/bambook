/**
 * Phase C1 — 经营驾驶舱聚合服务单元测试
 *
 * 覆盖：
 *   - 销售业绩排行：salesPerson × currency 分组 + contractAmount ?? quoteAmount 口径 + 未分配兜底
 *   - 客户贡献度：同币种内占比 + 多币种不混合
 *   - 订单毛利表：收入/成本口径优先级 + 跨币种排除 + 亏损靠前排序 + 合计
 *   - 应收应付预警：逾期桶聚合 + Top5 截断
 *   - 汇率损益汇总：totalGainLoss 透传
 *   - 日期区间：dueDate 字典序过滤
 */

import { describe, expect, it, vi } from 'vitest';
import { getBusinessCockpit } from '../dashboardService';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makePrisma(opts: {
  orders?: any[];
  invoices?: any[];
  vouchers?: any[];
  allocations?: any[];
  allocGroupBy?: any[];
}) {
  return {
    order: {
      findMany: vi.fn().mockImplementation(async ({ where }: any = {}) => {
        let rows = opts.orders ?? [];
        if (where?.dueDate?.gte) rows = rows.filter(r => r.dueDate >= where.dueDate.gte);
        if (where?.dueDate?.lte) rows = rows.filter(r => r.dueDate <= where.dueDate.lte);
        return rows;
      }),
    },
    invoice: {
      findMany: vi.fn().mockImplementation(async ({ where }: any = {}) => {
        let rows = opts.invoices ?? [];
        if (where?.id?.in) return rows.filter(r => where.id.in.includes(r.id));
        if (where?.type) rows = rows.filter(r => r.type === where.type);
        return rows;
      }),
    },
    paymentVoucher: {
      findMany: vi.fn().mockImplementation(async ({ where }: any = {}) => {
        let rows = opts.vouchers ?? [];
        if (where?.id?.in) return rows.filter(r => where.id.in.includes(r.id));
        return rows;
      }),
    },
    invoiceAllocation: {
      groupBy: vi.fn().mockResolvedValue(opts.allocGroupBy ?? []),
      findMany: vi.fn().mockImplementation(async ({ where }: any = {}) => {
        let rows = opts.allocations ?? [];
        if (where?.appliedDate?.gte) rows = rows.filter(r => r.appliedDate >= where.appliedDate.gte);
        if (where?.appliedDate?.lte) rows = rows.filter(r => r.appliedDate <= where.appliedDate.lte);
        return rows;
      }),
    },
  } as any;
}

function makeOrder(over: Partial<any> = {}) {
  return {
    id: 'O1', poNumber: 'PO-1', customer: 'ACME', product: 'T-Shirt',
    salesPerson: 'Alice', dueDate: '2026-08-01', status: 'Production', quantity: 100,
    currency: 'USD', salesCurrency: 'USD', purchaseCurrency: 'USD',
    quoteAmount: 1000, contractAmount: 1200, shipmentAmount: null,
    actualPaymentAmount: 600, purchasePrice: null, supplierInvoiceAmount: 800,
    customerRelationId: 'REL_A',
    ...over,
  };
}

describe('getBusinessCockpit — 销售业绩排行', () => {
  it('groups by salesPerson × currency with contractAmount priority and collected sum', async () => {
    const prisma = makePrisma({
      orders: [
        makeOrder(),
        makeOrder({ id: 'O2', salesPerson: 'Alice', contractAmount: null, quoteAmount: 500, actualPaymentAmount: null }),
        makeOrder({ id: 'O3', salesPerson: 'Bob', contractAmount: 3000, quoteAmount: 3000, actualPaymentAmount: 1000 }),
        makeOrder({ id: 'O4', salesPerson: '  ', contractAmount: 200, quoteAmount: 200, actualPaymentAmount: 0 }),
      ],
    });
    const cockpit = await getBusinessCockpit(prisma);
    expect(cockpit.salesLeaderboard).toEqual([
      { salesPerson: 'Bob', currency: 'USD', orderCount: 1, salesAmount: 3000, collectedAmount: 1000 },
      { salesPerson: 'Alice', currency: 'USD', orderCount: 2, salesAmount: 1700, collectedAmount: 600 },
      { salesPerson: '未分配', currency: 'USD', orderCount: 1, salesAmount: 200, collectedAmount: 0 },
    ]);
  });

  it('splits rows by currency without conversion', async () => {
    const prisma = makePrisma({
      orders: [
        makeOrder(),
        makeOrder({ id: 'O2', salesCurrency: 'EUR', contractAmount: 900 }),
      ],
    });
    const cockpit = await getBusinessCockpit(prisma);
    expect(cockpit.salesLeaderboard).toHaveLength(2);
    expect(cockpit.salesLeaderboard.map(r => r.currency).sort()).toEqual(['EUR', 'USD']);
  });
});

describe('getBusinessCockpit — 客户贡献度', () => {
  it('computes share within same currency only', async () => {
    const prisma = makePrisma({
      orders: [
        makeOrder({ contractAmount: 3000 }),
        makeOrder({ id: 'O2', customer: 'BETA', customerRelationId: 'REL_B', contractAmount: 1000 }),
        makeOrder({ id: 'O3', customer: 'GMBH', customerRelationId: 'REL_C', salesCurrency: 'EUR', contractAmount: 500 }),
      ],
    });
    const cockpit = await getBusinessCockpit(prisma);
    const acme = cockpit.customerContribution.find(r => r.customer === 'ACME')!;
    const beta = cockpit.customerContribution.find(r => r.customer === 'BETA')!;
    const gmbh = cockpit.customerContribution.find(r => r.customer === 'GMBH')!;
    expect(acme.share).toBe(0.75);
    expect(beta.share).toBe(0.25);
    expect(gmbh.share).toBe(1); // EUR 币种内独占
  });
});

describe('getBusinessCockpit — 订单毛利表', () => {
  it('uses shipmentAmount > contractAmount > quoteAmount revenue priority', async () => {
    const prisma = makePrisma({
      orders: [
        makeOrder({ shipmentAmount: 1500 }), // 收入取 shipmentAmount
        makeOrder({ id: 'O2', shipmentAmount: null, contractAmount: 1200 }), // 取 contractAmount
        makeOrder({ id: 'O3', shipmentAmount: null, contractAmount: null, quoteAmount: 900 }), // 取 quoteAmount
      ],
    });
    const cockpit = await getBusinessCockpit(prisma);
    const byId = new Map(cockpit.orderMargins.rows.map(r => [r.orderId, r]));
    expect(byId.get('O1')!.revenue).toBe(1500);
    expect(byId.get('O2')!.revenue).toBe(1200);
    expect(byId.get('O3')!.revenue).toBe(900);
  });

  it('falls back to purchasePrice × quantity when supplierInvoiceAmount missing', async () => {
    const prisma = makePrisma({
      orders: [makeOrder({ supplierInvoiceAmount: null, purchasePrice: 5, quantity: 100 })],
    });
    const cockpit = await getBusinessCockpit(prisma);
    const row = cockpit.orderMargins.rows[0];
    expect(row.cost).toBe(500);
    expect(row.margin).toBe(700); // 1200 - 500
    expect(row.marginRate).toBe(0.5833);
  });

  it('marks cross-currency orders and excludes them from totals', async () => {
    const prisma = makePrisma({
      orders: [
        makeOrder({ purchaseCurrency: 'CNY', supplierInvoiceAmount: 5000 }), // 跨币种
        makeOrder({ id: 'O2', supplierInvoiceAmount: 800 }), // 同币种正常
      ],
    });
    const cockpit = await getBusinessCockpit(prisma);
    const cross = cockpit.orderMargins.rows.find(r => r.orderId === 'O1')!;
    expect(cross.crossCurrency).toBe(true);
    expect(cross.margin).toBeNull();
    expect(cockpit.orderMargins.totals).toHaveLength(1);
    expect(cockpit.orderMargins.totals[0].orderCount).toBe(1);
    expect(cockpit.orderMargins.excludedCount).toBe(1);
  });

  it('sorts loss-making orders first, null-margin last by revenue desc', async () => {
    const prisma = makePrisma({
      orders: [
        makeOrder({ id: 'WIN', contractAmount: 2000, supplierInvoiceAmount: 800 }), // +1200
        makeOrder({ id: 'LOSS', contractAmount: 1000, supplierInvoiceAmount: 1300 }), // -300
        makeOrder({ id: 'NOCOST', contractAmount: 5000, supplierInvoiceAmount: null, purchasePrice: null }), // null
      ],
    });
    const cockpit = await getBusinessCockpit(prisma);
    expect(cockpit.orderMargins.rows.map(r => r.orderId)).toEqual(['LOSS', 'WIN', 'NOCOST']);
  });

  it('respects marginRowLimit', async () => {
    const prisma = makePrisma({
      orders: Array.from({ length: 10 }, (_, i) => makeOrder({ id: `O${i}` })),
    });
    const cockpit = await getBusinessCockpit(prisma, { marginRowLimit: 3 });
    expect(cockpit.orderMargins.rows).toHaveLength(3);
  });
});

describe('getBusinessCockpit — 应收应付预警', () => {
  it('aggregates overdue buckets and returns top-5 alert rows', async () => {
    const invoices = Array.from({ length: 7 }, (_, i) => ({
      id: `INV${i}`, invoiceNumber: `INV-${i}`, amount: 100 * (i + 1), currency: 'USD',
      issueDate: '2026-01-01', dueDate: '2026-02-01', // 已逾期（asOf 默认今天 2026-08+）
      customerRelationId: `REL_${i}`, customerName: `C${i}`, status: 'Issued', type: 'Receivable',
    }));
    const prisma = makePrisma({ invoices });
    const cockpit = await getBusinessCockpit(prisma);
    expect(cockpit.arApAlerts.receivable.rows).toHaveLength(5); // Top5 截断
    const total = cockpit.arApAlerts.receivable.totals.find(t => t.currency === 'USD')!;
    expect(total.overdue).toBe(2800); // 100+200+...+700
    expect(total.total).toBe(2800);
  });

  it('excludes fully-allocated invoices from alerts', async () => {
    const prisma = makePrisma({
      invoices: [{
        id: 'INV1', invoiceNumber: 'INV-1', amount: 1000, currency: 'USD',
        issueDate: '2026-01-01', dueDate: '2026-02-01',
        customerRelationId: 'REL_A', customerName: 'ACME', status: 'Issued', type: 'Receivable',
      }],
      allocGroupBy: [{ invoiceId: 'INV1', _sum: { appliedAmount: 1000 } }],
    });
    const cockpit = await getBusinessCockpit(prisma);
    expect(cockpit.arApAlerts.receivable.rows).toHaveLength(0);
    expect(cockpit.arApAlerts.receivable.totals).toHaveLength(0);
  });
});

describe('getBusinessCockpit — 汇率损益汇总', () => {
  it('passes through fx totals with row count', async () => {
    const prisma = makePrisma({
      invoices: [{
        id: 'INV1', invoiceNumber: 'INV-1', type: 'Receivable', currency: 'USD',
        exchangeRate: 7.1, baseCurrency: 'CNY', amount: 1000,
        issueDate: '2026-07-01', dueDate: null, customerRelationId: 'REL_A', customerName: 'ACME', status: 'PartiallyPaid',
      }],
      vouchers: [{ id: 'V1', voucherNumber: 'V-1', exchangeRate: 7.2 }],
      allocations: [{ id: 'A1', invoiceId: 'INV1', voucherId: 'V1', appliedAmount: 1000, appliedDate: '2026-08-01' }],
    });
    const cockpit = await getBusinessCockpit(prisma);
    expect(cockpit.fxSummary.totalGainLoss).toBe(100); // 1000 × (7.2 - 7.1)
    expect(cockpit.fxSummary.rowCount).toBe(1);
    expect(cockpit.fxSummary.baseCurrency).toBe('CNY');
  });
});

describe('getBusinessCockpit — 日期区间', () => {
  it('filters orders by dueDate lexicographic range', async () => {
    const prisma = makePrisma({
      orders: [
        makeOrder({ id: 'IN', dueDate: '2026-08-15' }),
        makeOrder({ id: 'OUT', dueDate: '2026-09-01' }),
      ],
    });
    const cockpit = await getBusinessCockpit(prisma, { from: '2026-08-01', to: '2026-08-31' });
    expect(cockpit.orderMargins.rows.map(r => r.orderId)).toEqual(['IN']);
    expect(cockpit.from).toBe('2026-08-01');
    expect(cockpit.to).toBe('2026-08-31');
  });

  it('returns empty aggregates when no orders match', async () => {
    const prisma = makePrisma({ orders: [] });
    const cockpit = await getBusinessCockpit(prisma);
    expect(cockpit.salesLeaderboard).toEqual([]);
    expect(cockpit.customerContribution).toEqual([]);
    expect(cockpit.orderMargins.totals).toEqual([]);
  });
});
