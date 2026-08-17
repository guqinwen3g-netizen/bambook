import { describe, expect, it, beforeEach } from 'vitest';
import { createProfitSheetService, type ProfitSheetDetails } from '../../pricing/profitSheetService';
import { getConsolidatedProfitReport } from '../../finance/reportService';
import { encodeInternalTransferPayload, type InternalTransferPayload } from '../internalTransferService';

/**
 * DR-005 内部面料交易利润口径 + 公司合并抵销测试：
 *   - 服装部利润表：purchases 含内部面料采购价（生效 incoming），部门利润已扣除
 *   - 面料部利润表（isInternalFabricTrade=true）：sales 含内部销售收入，独立归集
 *   - 未生效（PendingConfirm）内部供料单不计入核算
 *   - 历史已认账记录（无载荷 + recognizedAt）计入核算
 *   - 非内部交易订单不附加 internalTrade 摘要（既有口径不回归）
 *   - 公司合并报表：抵销内部采购/内部销售，仅计外部收入+真实面料成本；Σ 部门利润 = 合并利润
 */

function makePayload(overrides: Partial<InternalTransferPayload>): InternalTransferPayload {
  return {
    docType: 'DR033_INTERNAL_FABRIC_SUPPLY',
    role: 'master', masterId: 'OIT__M1', mirrorId: 'OIT__R1',
    requestDepartmentId: 'dept_garment', supplyDepartmentId: 'dept_fabric',
    garmentOrderId: 'G1', fabricOrderId: 'F1',
    materialCode: 'M100', quantity: 1000, unit: 'm',
    settlementPrice: 30, settlementApprovalId: 'ar_1', dueDate: '2026-09-01',
    status: 'Effective',
    confirmedQuantity: 1000, confirmedDueDate: '2026-09-01', confirmedBy: 'u_fabric', confirmedAt: '2026-08-18T00:00:00.000Z',
    deliveries: [], history: [],
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────
// 利润表 mock（沿用 pricing/__tests__/profitSheet.test.ts 的内存 mock 风格 + orderInternalTransfer）
// ────────────────────────────────────────────────────────────────────
function makeMockPrisma() {
  const orders: any[] = [];
  const invoices: any[] = [];
  const purchaseOrders: any[] = [];
  const shipments: any[] = [];
  const paymentVouchers: any[] = [];
  const exchangeRates: any[] = [];
  const profitSheets: any[] = [];
  const internalTransfers: any[] = [];

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

  const findManyOf = (rows: any[]) => async ({ where, take, skip }: any = {}) => {
    const matched = rows.filter((r) => matchWhere(r, where));
    return matched.slice(skip || 0, (skip || 0) + (take ?? matched.length));
  };

  return {
    order: { findUnique: async ({ where }: any) => orders.find((o) => o.id === where.id) || null },
    invoice: { findMany: findManyOf(invoices) },
    purchaseOrder: { findMany: findManyOf(purchaseOrders) },
    shipment: { findMany: findManyOf(shipments) },
    paymentVoucher: { findMany: findManyOf(paymentVouchers) },
    exchangeRate: { findMany: findManyOf(exchangeRates) },
    orderInternalTransfer: { findMany: findManyOf(internalTransfers) },
    orderProfitSheet: {
      findUnique: async ({ where }: any) => profitSheets.find((s) => s.orderId === where.orderId) || null,
      create: async ({ data }: any) => { profitSheets.push({ ...data }); return data; },
      update: async ({ where, data }: any) => {
        const row = profitSheets.find((s) => s.orderId === where.orderId);
        Object.assign(row, data);
        return row;
      },
    },
    _stores: { orders, invoices, purchaseOrders, shipments, paymentVouchers, exchangeRates, profitSheets, internalTransfers },
  };
}

describe('DR-005 部门利润口径（profitSheetService 扩展）', () => {
  let prisma: any;
  let service: ReturnType<typeof createProfitSheetService>;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = createProfitSheetService(prisma as any);
  });

  it('服装部：生效 incoming 内部供料单进入采购成本，部门利润扣除内部面料采购价', async () => {
    prisma._stores.orders.push({ id: 'G1', deletedAt: null, isInternalFabricTrade: false, businessLine: 'garment' });
    prisma._stores.invoices.push(
      { id: 'INV-1', invoiceNumber: 'INV-001', orderId: 'G1', type: 'Receivable', status: 'Issued', amount: 100000, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    prisma._stores.purchaseOrders.push(
      { id: 'PO-1', poNumber: 'PO-001', orderId: 'G1', status: 'Confirmed', totalAmount: 30000, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    prisma._stores.internalTransfers.push({
      id: 'OIT__M1', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
      transferAmount: 30000, transferCurrency: 'CNY', recognizedBy: 'u_fabric', recognizedAt: new Date(),
      memo: encodeInternalTransferPayload(makePayload({ status: 'Effective' })),
    });

    const sheet = await service.generateOrderProfitSheet('G1', 'u_fin');
    const details = sheet.details as unknown as ProfitSheetDetails;

    // 采购成本 = 外部 PO 30000 + 内部面料采购 30000
    expect(Number(sheet.purchaseCost)).toBe(60000);
    expect(Number(sheet.salesRevenue)).toBe(100000);
    // 服装部利润 = 100000 − 60000 = 40000（已扣内部采购价）
    expect(Number(sheet.grossProfit)).toBe(40000);

    // 内部行标记 + 摘要
    const internalLine = details.purchases.find((l) => l.internal === true)!;
    expect(internalLine.cnyAmount).toBe(30000);
    expect(details.internalTrade).toMatchObject({
      isInternalTrade: false,
      internalPurchaseAmount: 30000,
      internalSalesAmount: 0,
      consolidatedAdjustment: 30000,
      departmentProfit: 40000,
    });
  });

  it('面料部：isInternalFabricTrade=true 订单 sales 含内部销售收入，独立归集', async () => {
    prisma._stores.orders.push({ id: 'F1', deletedAt: null, isInternalFabricTrade: true, businessLine: 'fabric', internalCounterpartyId: 'CP-1' });
    prisma._stores.purchaseOrders.push(
      { id: 'PO-F1', poNumber: 'PO-F01', orderId: 'F1', status: 'Confirmed', totalAmount: 20000, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    prisma._stores.internalTransfers.push({
      id: 'OIT__R1', orderId: 'F1', transferDirection: 'outgoing', deletedAt: null,
      transferAmount: 30000, transferCurrency: 'CNY', recognizedBy: 'u_fabric', recognizedAt: new Date(),
      memo: encodeInternalTransferPayload(makePayload({ role: 'mirror', status: 'Effective' })),
    });

    const sheet = await service.generateOrderProfitSheet('F1', 'u_fin');
    const details = sheet.details as unknown as ProfitSheetDetails;

    // 面料部：内部销售收入 30000 − 真实面料成本 20000 = 10000（保留内部面料利润）
    expect(Number(sheet.salesRevenue)).toBe(30000);
    expect(Number(sheet.purchaseCost)).toBe(20000);
    expect(Number(sheet.grossProfit)).toBe(10000);
    expect(details.internalTrade).toMatchObject({
      isInternalTrade: true,
      internalPurchaseAmount: 0,
      internalSalesAmount: 30000,
      departmentProfit: 10000,
    });
    const internalLine = details.sales.find((l) => l.internal === true)!;
    expect(internalLine.cnyAmount).toBe(30000);
  });

  it('未生效（PendingConfirm）内部供料单不计入核算（未批准结算价不得生效）', async () => {
    prisma._stores.orders.push({ id: 'G1', deletedAt: null, isInternalFabricTrade: false, businessLine: 'garment' });
    prisma._stores.invoices.push(
      { id: 'INV-1', invoiceNumber: 'INV-001', orderId: 'G1', type: 'Receivable', status: 'Issued', amount: 100000, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    prisma._stores.internalTransfers.push({
      id: 'OIT__M1', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
      transferAmount: 30000, transferCurrency: 'CNY', recognizedBy: null, recognizedAt: null,
      memo: encodeInternalTransferPayload(makePayload({ status: 'PendingConfirm', confirmedQuantity: null, confirmedBy: null, confirmedAt: null })),
    });

    const sheet = await service.generateOrderProfitSheet('G1', 'u_fin');
    // 未生效 → 采购成本 0，利润不扣内部采购
    expect(Number(sheet.purchaseCost)).toBe(0);
    expect(Number(sheet.grossProfit)).toBe(100000);
  });

  it('历史已认账记录（无 DR-033 载荷，recognizedAt 非空）计入核算', async () => {
    prisma._stores.orders.push({ id: 'G1', deletedAt: null, isInternalFabricTrade: false, businessLine: 'garment' });
    prisma._stores.internalTransfers.push({
      id: 'OIT__LEGACY', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
      transferAmount: 5000, transferCurrency: 'CNY', recognizedBy: 'u_fin', recognizedAt: new Date(), memo: null,
    });
    const sheet = await service.generateOrderProfitSheet('G1', 'u_fin');
    expect(Number(sheet.purchaseCost)).toBe(5000);
  });

  it('非内部交易订单不附加 internalTrade 摘要（既有口径不回归）', async () => {
    prisma._stores.orders.push({ id: 'ORD-X', deletedAt: null, isInternalFabricTrade: false });
    prisma._stores.invoices.push(
      { id: 'INV-X', invoiceNumber: 'INV-X', orderId: 'ORD-X', type: 'Receivable', status: 'Issued', amount: 8000, currency: 'CNY', exchangeRate: null, deletedAt: null },
    );
    const sheet = await service.generateOrderProfitSheet('ORD-X', 'u_fin');
    const details = sheet.details as unknown as ProfitSheetDetails;
    expect(details.internalTrade).toBeUndefined();
    expect(Number(sheet.grossProfit)).toBe(8000);
  });
});

describe('DR-005 公司合并报表抵销（reportService.getConsolidatedProfitReport）', () => {
  function makeReportPrisma(opts: { sheets: any[]; orders: any[]; transfers: any[] }) {
    const matchWhere = (row: any, where: any = {}): boolean =>
      Object.entries(where).every(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const cond: any = v;
          if ('in' in cond) return cond.in.includes(row[k]);
          if ('not' in cond) return row[k] !== cond.not;
          if ('gte' in cond || 'lte' in cond) {
            const val = row[k];
            if (val == null) return false; // Prisma null 语义：null 不满足区间比较
            if ('gte' in cond && val < cond.gte) return false;
            if ('lte' in cond && val > cond.lte) return false;
            return true;
          }
          return true;
        }
        return row[k] === v;
      });
    return {
      orderProfitSheet: { findMany: async ({ where }: any = {}) => opts.sheets.filter((r) => matchWhere(r, where)) },
      order: { findMany: async ({ where }: any = {}) => opts.orders.filter((r) => matchWhere(r, where)) },
      orderInternalTransfer: { findMany: async ({ where }: any = {}) => opts.transfers.filter((r) => matchWhere(r, where)) },
    } as any;
  }

  const sheets = [
    // 服装订单 G1（外部）：销售 100000；采购 60000（含内部 30000）；运费 2000；杂费 1000
    { id: 'OPS_G1', orderId: 'G1', salesRevenue: 100000, purchaseCost: 60000, freightCost: 2000, miscCost: 1000, grossProfit: 37000 },
    // 内部面料订单 F1：内部销售 30000；真实面料成本 20000；运费 500
    { id: 'OPS_F1', orderId: 'F1', salesRevenue: 30000, purchaseCost: 20000, freightCost: 500, miscCost: 0, grossProfit: 9500 },
  ];
  const orders = [
    { id: 'G1', deletedAt: null, isInternalFabricTrade: false, businessLine: 'garment' },
    { id: 'F1', deletedAt: null, isInternalFabricTrade: true, businessLine: 'fabric' },
  ];
  const transfers = [
    {
      id: 'OIT__M1', orderId: 'G1', transferDirection: 'incoming', deletedAt: null,
      transferAmount: 30000, transferCurrency: 'CNY', recognizedAt: new Date(),
      memo: encodeInternalTransferPayload(makePayload({ status: 'Effective' })),
    },
    {
      id: 'OIT__R1', orderId: 'F1', transferDirection: 'outgoing', deletedAt: null,
      transferAmount: 30000, transferCurrency: 'CNY', recognizedAt: new Date(),
      memo: encodeInternalTransferPayload(makePayload({ role: 'mirror', status: 'Effective' })),
    },
  ];

  it('合并抵销：内部采购/内部销售不重复计入；仅计外部收入+真实面料成本；Σ 部门利润 = 合并利润', async () => {
    const prisma = makeReportPrisma({ sheets, orders, transfers });
    const report = await getConsolidatedProfitReport(prisma);

    // 合并收入 = 仅外部客户收入（剔除内部面料销售 30000）
    expect(report.consolidatedRevenue).toBe(100000);
    // 合并成本 = (60000 − 30000 内部采购加价) + 20000 真实面料成本 + 2500 运费 + 1000 杂费
    expect(report.costBreakdown.externalPurchaseNetOfInternal).toBe(30000);
    expect(report.costBreakdown.realFabricCost).toBe(20000);
    expect(report.costBreakdown.freightCost).toBe(2500);
    expect(report.costBreakdown.miscCost).toBe(1000);
    expect(report.consolidatedCost).toBe(53500);
    expect(report.consolidatedProfit).toBe(46500);

    // 抵销额 = 内部采购价 = 内部销售收入（单边口径，不双边重复）
    expect(report.elimination.internalPurchase).toBe(30000);
    expect(report.elimination.internalSales).toBe(30000);
    expect(report.elimination.amount).toBe(30000);
    expect(report.elimination.discrepancy).toBe(0);

    // 部门双视角：服装部利润已扣内部采购价；面料部保留内部面料利润
    expect(report.departments.garment).toEqual({ revenue: 100000, cost: 63000, profit: 37000 });
    expect(report.departments.fabric).toEqual({ revenue: 30000, cost: 20500, profit: 9500 });
    // 恒等式：Σ 部门利润 = 合并利润
    expect(report.departments.garment.profit + report.departments.fabric.profit).toBe(report.consolidatedProfit);

    expect(report.orders).toEqual({ externalCount: 1, internalCount: 1 });
  });

  it('未生效内部供料单不抵销也不剔除（PendingConfirm 零影响）', async () => {
    const pendingTransfers = transfers.map((t) => ({
      ...t,
      recognizedAt: null,
      memo: encodeInternalTransferPayload(makePayload({ status: 'PendingConfirm', role: t.transferDirection === 'outgoing' ? 'mirror' : 'master' })),
    }));
    // 注意：sheet 为已生成投影，本用例中 G1 purchaseCost 不含内部采购（未生效不入利润表）
    const sheetsNoInternal = [
      { ...sheets[0], purchaseCost: 30000, grossProfit: 67000 },
      { ...sheets[1], salesRevenue: 0, grossProfit: -20500 },
    ];
    const prisma = makeReportPrisma({ sheets: sheetsNoInternal, orders, transfers: pendingTransfers });
    const report = await getConsolidatedProfitReport(prisma);

    expect(report.elimination.amount).toBe(0);
    expect(report.elimination.internalSales).toBe(0);
    expect(report.costBreakdown.externalPurchaseNetOfInternal).toBe(30000); // 无剔除
    expect(report.consolidatedRevenue).toBe(100000);
  });

  it('非 CNY 生效内部交易：透明披露 unconverted，不做汇率假设', async () => {
    const usdTransfers = transfers.map((t) => ({ ...t, transferCurrency: 'USD' }));
    const prisma = makeReportPrisma({ sheets, orders, transfers: usdTransfers });
    const report = await getConsolidatedProfitReport(prisma);

    expect(report.unconverted).toHaveLength(2);
    expect(report.elimination.amount).toBe(0); // 未折算，排除在抵额外
  });

  it('无过滤：range 元数据 from/to 回显 null', async () => {
    const prisma = makeReportPrisma({ sheets, orders, transfers });
    const report = await getConsolidatedProfitReport(prisma);
    expect(report.from).toBeNull();
    expect(report.to).toBeNull();
  });

  it('日期过滤：from/to 按 poDate 收窄报表范围，抵销额同口径收窄，range 元数据回显', async () => {
    const datedOrders = [
      { ...orders[0], poDate: '2026-08-01' }, // G1 服装订单 8 月
      { ...orders[1], poDate: '2026-07-15' }, // F1 内部面料订单 7 月
    ];
    const prisma = makeReportPrisma({ sheets, orders: datedOrders, transfers });
    const report = await getConsolidatedProfitReport(prisma, { from: '2026-08-01', to: '2026-08-31' });

    // range 元数据回显
    expect(report.from).toBe('2026-08-01');
    expect(report.to).toBe('2026-08-31');

    // 仅 G1（8 月）纳入；F1（7 月）整单排除
    expect(report.orders).toEqual({ externalCount: 1, internalCount: 0 });
    expect(report.consolidatedRevenue).toBe(100000);
    expect(report.costBreakdown.realFabricCost).toBe(0); // 内部面料订单不在范围
    expect(report.costBreakdown.freightCost).toBe(2000); // 仅 G1 运费
    expect(report.costBreakdown.miscCost).toBe(1000);
    expect(report.costBreakdown.externalPurchaseNetOfInternal).toBe(30000); // 60000 − 30000 内部采购
    expect(report.consolidatedProfit).toBe(100000 - (30000 + 0 + 2000 + 1000));

    // 抵销同口径收窄：G1 incoming 在范围内计入；F1 outgoing 订单不在范围不计入 → discrepancy 透明披露
    expect(report.elimination.internalPurchase).toBe(30000);
    expect(report.elimination.internalSales).toBe(0);
    expect(report.elimination.discrepancy).toBe(-30000);

    // 部门视角同口径：面料部无纳入订单
    expect(report.departments.garment).toEqual({ revenue: 100000, cost: 63000, profit: 37000 });
    expect(report.departments.fabric).toEqual({ revenue: 0, cost: 0, profit: 0 });
  });

  it('日期过滤：poDate 为空的订单在过滤模式下排除（无法证明落在区间内）', async () => {
    const mixedOrders = [
      { ...orders[0], poDate: null },         // G1 无订单日期
      { ...orders[1], poDate: '2026-08-10' }, // F1 在范围内
    ];
    const prisma = makeReportPrisma({ sheets, orders: mixedOrders, transfers });
    const report = await getConsolidatedProfitReport(prisma, { from: '2026-08-01' });

    expect(report.from).toBe('2026-08-01');
    expect(report.to).toBeNull();
    expect(report.orders).toEqual({ externalCount: 0, internalCount: 1 });
    expect(report.consolidatedRevenue).toBe(0); // G1 被排除，无外部收入
    expect(report.costBreakdown.realFabricCost).toBe(20000); // 仅 F1 真实面料成本
  });
});
