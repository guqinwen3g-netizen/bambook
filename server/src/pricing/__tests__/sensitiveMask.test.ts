import express from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const validApiKey = 'test-key';
const apiKeys = new Set([validApiKey]);

import { createPricingRouter } from '../pricingRoute';
import { maskTrackAResult, maskFreightImpactResult } from '../sensitiveMask';

/**
 * S3 走查阶段二 · β 车道：pricing 敏感字段服务端遮罩测试。
 *
 * 实锤背景：GET /api/v1/pricing/profit-sheets 仅校验 pricing:read，对未持
 * sensitive:cost / sensitive:profit 的角色（sales 等）明文返回成本/毛利字段。
 * 本套件断言：无 sensitive scope 的 actor → 敏感字段遮罩（数字 → null、成本明细行
 * 数组 → []）；持 sensitive scope 或 owner → 明文正常。
 *
 * 测试身份（与 pricingRoute.test.ts 同风格 JWT mock）：
 *   - owner：legacy owner → 全量明文（SuperAdmin 直通）
 *   - sales：pricing:read|write 但无 sensitive:*（fallback 矩阵 SALES 同样未授 sensitive）
 *   - finance：JWT permissions 显式携带 sensitive:cost/profit/commission → 明文
 */
const ownerToken = jwt.sign({ userId: 'u-owner', roles: ['owner'] }, SECRET);
const salesToken = jwt.sign(
  { userId: 'u-sales', roles: ['sales'], permissions: ['pricing:read', 'pricing:write'] },
  SECRET,
);
const financeToken = jwt.sign(
  {
    userId: 'u-finance',
    roles: ['finance'],
    permissions: ['pricing:read', 'pricing:write', 'sensitive:cost', 'sensitive:profit', 'sensitive:commission'],
  },
  SECRET,
);

const asOwner = { Cookie: `bambook_token=${ownerToken}` };
const asSales = { Cookie: `bambook_token=${salesToken}` };
const asFinance = { Cookie: `bambook_token=${financeToken}` };

/** Mock Prisma：内存存储本套件用到的表（语义对齐真实 client 用到的子集） */
function makeMockPrisma() {
  const profitSheetRows: any[] = [];
  const calculationRows: any[] = [];
  const commissionRuleRows: any[] = [];
  const materialPriceRows: any[] = [];
  const orderRows: any[] = [];
  const shipmentRows: any[] = [];

  const matchWhere = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const cond: any = v;
        if ('in' in cond) return cond.in.includes(row[k]);
        if ('notIn' in cond) return !cond.notIn.includes(row[k]);
        if ('not' in cond) return cond.not === null ? row[k] !== null : row[k] !== cond.not;
        return true;
      }
      return row[k] === v;
    });

  const orderProfitSheet = {
    findMany: async ({ take, skip }: any = {}) => profitSheetRows.slice(skip || 0, (skip || 0) + (take ?? profitSheetRows.length)),
    count: async () => profitSheetRows.length,
    findUnique: async ({ where }: any) => profitSheetRows.find(r => r.orderId === where.orderId) || null,
  };
  const pricingCalculation = {
    findMany: async ({ where, take, skip }: any = {}) => {
      const rows = calculationRows.filter(c => matchWhere(c, where));
      return rows.slice(skip || 0, (skip || 0) + (take ?? rows.length));
    },
    count: async ({ where }: any = {}) => calculationRows.filter(c => matchWhere(c, where)).length,
  };
  const commissionRule = {
    findMany: async ({ where }: any = {}) => commissionRuleRows.filter(r => matchWhere(r, where)),
    count: async ({ where }: any = {}) => commissionRuleRows.filter(r => matchWhere(r, where)).length,
    findFirst: async ({ where }: any = {}) => commissionRuleRows.find(r => matchWhere(r, where)) || null,
  };
  const materialPriceHistory = {
    findMany: async ({ where, take, skip }: any = {}) => {
      const rows = materialPriceRows.filter(r => matchWhere(r, where));
      return rows.slice(skip || 0, (skip || 0) + (take ?? rows.length));
    },
    count: async ({ where }: any = {}) => materialPriceRows.filter(r => matchWhere(r, where)).length,
  };
  const order = {
    findMany: async ({ where }: any = {}) => orderRows.filter(o => matchWhere(o, where)),
    findUnique: async ({ where }: any) => orderRows.find(o => o.id === where.id) || null,
  };
  const shipment = {
    findMany: async ({ where }: any = {}) => shipmentRows.filter(s => matchWhere(s, where)),
  };
  const emptyFindMany = async () => [];

  return {
    orderProfitSheet,
    pricingCalculation,
    commissionRule,
    materialPriceHistory,
    order,
    shipment,
    invoice: { findMany: emptyFindMany },
    purchaseOrder: { findMany: emptyFindMany },
    paymentVoucher: { findMany: emptyFindMany },
    exchangeRate: { findMany: emptyFindMany },
    _stores: { profitSheetRows, calculationRows, commissionRuleRows, materialPriceRows, orderRows, shipmentRows },
  };
}

function makeApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    if (req.headers.cookie) {
      const cookies: Record<string, string> = {};
      req.headers.cookie.split(';').forEach((c: string) => {
        const [k, v] = c.trim().split('=');
        cookies[k] = v;
      });
      req.cookies = cookies;
    }
    next();
  });
  app.use('/api/v1/pricing', createPricingRouter({ prisma, requireAuth: true, apiKeys }));
  return app;
}

/** 造一行含全部分敏感字段的利润表（details 嵌套成本明细行） */
function seedProfitSheet(prisma: any) {
  prisma._stores.profitSheetRows.push({
    id: 'OPS__1',
    orderId: 'ORD__1',
    salesRevenue: 10000,
    purchaseCost: 4000,
    freightCost: 800,
    miscCost: 200,
    grossProfit: 5000,
    grossMargin: 50,
    details: {
      sales: [{ id: 'INV__1', label: 'INV-1', amount: 10000, currency: 'CNY', rate: 1, rateSource: 'base', cnyAmount: 10000 }],
      purchases: [{ id: 'PO__1', label: 'PO-1', amount: 4000, currency: 'CNY', rate: 1, rateSource: 'base', cnyAmount: 4000 }],
      freight: [{ id: 'SH__1', label: 'SH-1 运费', amount: 800, currency: 'CNY', rate: 1, rateSource: 'base', cnyAmount: 800 }],
      misc: [{ id: 'PV__1', label: 'PV-1', amount: 200, currency: 'CNY', rate: 1, rateSource: 'base', cnyAmount: 200 }],
      unconverted: [
        { id: 'PO__2', label: 'PO-2', kind: 'purchase', amount: 999, currency: 'USD', reason: '无汇率快照且无最新汇率记录' },
        { id: 'INV__2', label: 'INV-2', kind: 'sales', amount: 888, currency: 'USD', reason: '无汇率快照且无最新汇率记录' },
      ],
    },
    version: 1,
    generatedAt: 1700000000000,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  });
}

// ════════════════════════════════════════════════════════════════
// 利润表：list / get-by-order（实锤端点）
// ════════════════════════════════════════════════════════════════

describe('S3-β · profit-sheets 敏感字段遮罩', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedProfitSheet(prisma);
  });

  it('sales（无 sensitive scope）GET /profit-sheets → 成本/毛利遮罩，收入与非敏感字段保留', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/pricing/profit-sheets').set(asSales);
    expect(res.status).toBe(200);
    const s = res.body.items[0];
    // 敏感：成本三项 + 毛利两项 → null
    expect(s.purchaseCost).toBeNull();
    expect(s.freightCost).toBeNull();
    expect(s.miscCost).toBeNull();
    expect(s.grossProfit).toBeNull();
    expect(s.grossMargin).toBeNull();
    // 非敏感：销售收入/版本/订单号明文
    expect(s.salesRevenue).toBe(10000);
    expect(s.orderId).toBe('ORD__1');
    expect(s.version).toBe(1);
    // details 嵌套：成本明细行数组遮罩为空，销售明细保留
    expect(s.details.purchases).toEqual([]);
    expect(s.details.freight).toEqual([]);
    expect(s.details.misc).toEqual([]);
    expect(s.details.sales).toHaveLength(1);
    // 未折算行：成本类金额遮罩，销售类保留
    const unPurchase = s.details.unconverted.find((u: any) => u.kind === 'purchase');
    const unSales = s.details.unconverted.find((u: any) => u.kind === 'sales');
    expect(unPurchase.amount).toBeNull();
    expect(unSales.amount).toBe(888);
  });

  it('sales GET /profit-sheets/order/:orderId → 同样遮罩；不存在 → 404 不受影响', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/pricing/profit-sheets/order/ORD__1').set(asSales);
    expect(res.status).toBe(200);
    expect(res.body.item.grossProfit).toBeNull();
    expect(res.body.item.purchaseCost).toBeNull();

    const miss = await request(app).get('/api/v1/pricing/profit-sheets/order/ORD__NONE').set(asSales);
    expect(miss.status).toBe(404);
  });

  it('finance（sensitive:cost+profit）→ 明文正常；owner → 明文正常', async () => {
    const app = makeApp(prisma);
    const fin = await request(app).get('/api/v1/pricing/profit-sheets').set(asFinance);
    expect(fin.body.items[0].purchaseCost).toBe(4000);
    expect(fin.body.items[0].grossProfit).toBe(5000);
    expect(fin.body.items[0].grossMargin).toBe(50);
    expect(fin.body.items[0].details.purchases).toHaveLength(1);

    const own = await request(app).get('/api/v1/pricing/profit-sheets/order/ORD__1').set(asOwner);
    expect(own.body.item.grossProfit).toBe(5000);
    expect(own.body.item.freightCost).toBe(800);
  });
});

// ════════════════════════════════════════════════════════════════
// 定价计算 + 轨道 B 试算
// ════════════════════════════════════════════════════════════════

describe('S3-β · calculations / track-b-preview 敏感字段遮罩', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.calculationRows.push({
      id: 'PRC__1',
      purchaseCostCny: 80,
      refundRate: 13,
      exchangeRate: 7.2,
      profitMargin: 25,
      commissionRate: 10,
      netUsdCost: 9.6667,
      profitAmount: 2.4167,
      commissionAmount: 0.9667,
      finalUnitPrice: 13.05,
      status: 'Draft',
      deletedAt: null,
    });
  });

  it('sales GET /calculations → 成本/利润/佣金字段遮罩；终价/退税率/汇率保留', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/pricing/calculations').set(asSales);
    expect(res.status).toBe(200);
    const c = res.body.items[0];
    expect(c.purchaseCostCny).toBeNull();   // sensitive:cost
    expect(c.netUsdCost).toBeNull();        // sensitive:cost
    expect(c.profitMargin).toBeNull();      // sensitive:profit
    expect(c.profitAmount).toBeNull();      // sensitive:profit
    expect(c.commissionRate).toBeNull();    // sensitive:commission
    expect(c.commissionAmount).toBeNull();  // sensitive:commission
    expect(c.finalUnitPrice).toBe(13.05);   // 对外终价不遮罩
    expect(c.refundRate).toBe(13);
    expect(c.exchangeRate).toBe(7.2);
  });

  it('finance GET /calculations → 明文正常', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/pricing/calculations').set(asFinance);
    const c = res.body.items[0];
    expect(c.purchaseCostCny).toBe(80);
    expect(c.profitAmount).toBe(2.4167);
    expect(c.commissionAmount).toBe(0.9667);
  });

  it('sales POST /track-b-preview → netUsdCost/profitAmount/commissionAmount 遮罩，finalUnitPrice 保留', async () => {
    const app = makeApp(prisma);
    const body = { purchaseCostCny: 80, refundRate: 13, exchangeRate: 7.2, profitMargin: 25, commissionRate: 10 };
    const masked = await request(app).post('/api/v1/pricing/track-b-preview').set(asSales).send(body);
    expect(masked.status).toBe(200);
    expect(masked.body.netUsdCost).toBeNull();
    expect(masked.body.profitAmount).toBeNull();
    expect(masked.body.commissionAmount).toBeNull();
    expect(masked.body.finalUnitPrice).toBeCloseTo(13.05, 1);

    const plain = await request(app).post('/api/v1/pricing/track-b-preview').set(asOwner).send(body);
    expect(plain.body.netUsdCost).toBeCloseTo(9.6667, 3);
    expect(plain.body.profitAmount).toBeCloseTo(2.4167, 3);
    expect(plain.body.commissionAmount).toBeCloseTo(0.9667, 3);
  });
});

// ════════════════════════════════════════════════════════════════
// 佣金规则 + 原材料价格
// ════════════════════════════════════════════════════════════════

describe('S3-β · commission-rules / material-prices 敏感字段遮罩', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.commissionRuleRows.push(
      { id: 'CR__1', name: '默认规则', rate: 5, intermediaryRelationId: null, isActive: true, deletedAt: null },
    );
    prisma._stores.materialPriceRows.push(
      { id: 'MP__1', materialType: 'fabric', materialCode: 'F-1001', price: 55.5, deletedAt: null },
    );
  });

  it('sales GET /commission-rules + lookup → rate 遮罩；finance → 明文', async () => {
    const app = makeApp(prisma);
    const list = await request(app).get('/api/v1/pricing/commission-rules').set(asSales);
    expect(list.body.items[0].rate).toBeNull();
    expect(list.body.items[0].name).toBe('默认规则');

    const hit = await request(app).get('/api/v1/pricing/commission-rules/lookup').set(asSales);
    expect(hit.body.hit.rate).toBeNull();
    expect(hit.body.hit.ruleId).toBe('CR__1');

    const fin = await request(app).get('/api/v1/pricing/commission-rules').set(asFinance);
    expect(fin.body.items[0].rate).toBe(5);
    const finHit = await request(app).get('/api/v1/pricing/commission-rules/lookup').set(asFinance);
    expect(finHit.body.hit.rate).toBe(5);
  });

  it('sales GET /material-prices → 采购价 price 遮罩（sensitive:cost）；finance → 明文', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/pricing/material-prices').set(asSales);
    expect(res.body.items[0].price).toBeNull();
    expect(res.body.items[0].materialCode).toBe('F-1001');

    const fin = await request(app).get('/api/v1/pricing/material-prices').set(asFinance);
    expect(fin.body.items[0].price).toBe(55.5);
  });
});

// ════════════════════════════════════════════════════════════════
// REQ2-14 freight-impact 重估
// ════════════════════════════════════════════════════════════════

describe('S3-β · freight-impact 敏感字段遮罩', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.orderRows.push({ id: 'ORD__1', poNumber: 'PO-C-1', customer: 'ACME', status: 'Confirmed', deletedAt: null });
    prisma._stores.shipmentRows.push({
      id: 'SH__1', orderId: 'ORD__1', status: 'Booked', deletedAt: null,
      freightAmount: 800, freightCurrency: 'CNY',
      insuranceAmount: null, insuranceCurrency: null,
      customsAmount: null, customsCurrency: null,
      otherCharges: null, otherChargesCurrency: null,
    });
    // baseline 取已落库利润表（persisted 路径，避免重算链）
    prisma._stores.profitSheetRows.push({
      id: 'OPS__1', orderId: 'ORD__1',
      salesRevenue: 10000, purchaseCost: 4000, freightCost: 800, miscCost: 0,
      grossProfit: 5200, grossMargin: 52,
      details: { sales: [], purchases: [], freight: [], misc: [], unconverted: [] },
      version: 1, generatedAt: 1700000000000, createdAt: 1700000000000, updatedAt: 1700000000000,
    });
  });

  it('sales GET /freight-impact → 利润/成本字段遮罩，advice 等工作流字段保留', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/pricing/freight-impact?multiplier=2').set(asSales);
    expect(res.status).toBe(200);
    const it0 = res.body.items[0];
    expect(it0.baseline.grossProfit).toBeNull();
    expect(it0.baseline.grossMargin).toBeNull();
    expect(it0.baseline.freightCost).toBeNull();
    expect(it0.reestimated.grossProfit).toBeNull();
    expect(it0.reestimated.grossMargin).toBeNull();
    expect(it0.reestimated.freightCost).toBeNull();
    expect(it0.deltaProfit).toBeNull();
    expect(it0.deltaMargin).toBeNull();
    expect(it0.advice).toBeDefined();
    expect(res.body.summary.baselineProfitTotal).toBeNull();
    expect(res.body.summary.reestimatedProfitTotal).toBeNull();
    expect(res.body.summary.deltaProfitTotal).toBeNull();
    expect(res.body.summary.multiplier).toBe(2);
  });

  it('owner GET /freight-impact → 明文正常', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/pricing/freight-impact?multiplier=2').set(asOwner);
    expect(res.status).toBe(200);
    const it0 = res.body.items[0];
    expect(it0.baseline.grossProfit).toBe(5200);
    expect(it0.baseline.freightCost).toBe(800);
    // 重估走 buildProfitOverview 现场口径（mock 无发票/采购行）：毛利 = 0 - 800×2 = -1600
    expect(it0.reestimated.grossProfit).toBe(-1600);
    expect(it0.deltaProfit).toBe(-6800);
    expect(it0.advice).toBe('renegotiate');
  });
});

// ════════════════════════════════════════════════════════════════
// 纯函数遮罩：track-a 结果 / freight-impact 形状边界
// ════════════════════════════════════════════════════════════════

describe('S3-β · 遮罩纯函数边界', () => {
  const noScope = { cost: false, profit: false, commission: false };
  const allScope = { cost: true, profit: true, commission: true };

  it('maskTrackAResult：成本行/成本合计/利润基准遮罩，估算售价区间保留', () => {
    const result = {
      category: 'garment', unit: 'PC',
      lines: [{ key: 'fabric', label: '面料成本', amountCny: 85.1, source: 'manual' }],
      costTotalCny: 131.1, profitBenchmark: 25,
      priceMedianCny: 163.88, priceLowCny: 150.77, priceHighCny: 176.99,
      priceMedianUsd: 22.76, priceLowUsd: 20.94, priceHighUsd: 24.58,
      spreadPercent: 8, dataQuality: 'full_history',
    } as any;
    const masked = maskTrackAResult(result, noScope);
    expect(masked.costTotalCny).toBeNull();
    expect(masked.lines[0].amountCny).toBeNull();
    expect(masked.lines[0].key).toBe('fabric');
    expect(masked.profitBenchmark).toBeNull();
    expect(masked.priceMedianCny).toBe(163.88); // 估算售价（对外口径）不遮罩

    const plain = maskTrackAResult(result, allScope);
    expect(plain.costTotalCny).toBe(131.1);
  });

  it('maskFreightImpactResult：null/缺字段行不崩；grossMargin 原值为 null 时保持 null', () => {
    const result = {
      items: [{
        orderId: 'O1',
        baseline: { grossProfit: 100, grossMargin: null, freightCost: 10, source: 'persisted' },
        reestimated: { grossProfit: 90, grossMargin: null, freightCost: 20 },
        deltaProfit: -10, deltaMargin: null, advice: 'ok',
      }],
      summary: { multiplier: 2, affectedOrders: 1, baselineProfitTotal: 100, reestimatedProfitTotal: 90, deltaProfitTotal: -10 },
    } as any;
    const masked = maskFreightImpactResult(result, noScope);
    expect(masked.items[0].baseline.grossMargin).toBeNull();
    expect(masked.items[0].deltaMargin).toBeNull();
    expect(masked.items[0].advice).toBe('ok');
    // 非对象输入容错
    expect(maskFreightImpactResult(null as any, noScope)).toBeNull();
  });
});
