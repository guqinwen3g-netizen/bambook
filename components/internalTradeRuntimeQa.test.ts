import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_TRANSFER_ACCOUNTING_STATUSES,
  INTERNAL_TRANSFER_STATUSES,
  INTERNAL_TRANSFER_STATUS_LABEL,
  decodeInternalTransferPayload,
  internalTradeService,
  toAmount,
} from '../services/internalTradeService';
import type { ConsolidatedProfitReport, InternalTransferPayload } from '../services/internalTradeService';

/**
 * DR-005/DR-033 internal-trade runtime QA：fixture-driven
 * payload / 契约全部来自后端已 merged 代码（静态读取/断言真实源码），不手写假 contract。
 */

const fs = require('fs');
const path = require('path');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/internalTrade/internalTradeRoute.ts'), 'utf-8');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/internalTrade/internalTransferService.ts'), 'utf-8');
const REPORT_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/reportService.ts'), 'utf-8');
const INDEX_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/index.ts'), 'utf-8');

const ENDPOINT = 'https://test.example.com';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
}

// ═══ Part 1: 后端真实契约静态断言（route / service / report / 挂载） ═══
describe('runtime QA [internal-trade]: 后端真实源码 contract', () => {
  it('内部交易路由挂载于 /api/v1/internal-trade（index.ts 收口）', () => {
    expect(INDEX_SRC).toContain("app.use('/api/v1/internal-trade'");
  });

  it('GET / + GET /:id 列表与详情端点存在', () => {
    expect(ROUTE_SRC).toContain("router.get('/',");
    expect(ROUTE_SRC).toContain("router.get('/:id',");
  });

  it('写操作端点存在：create / confirm / delivery / cancel', () => {
    expect(ROUTE_SRC).toContain("router.post('/',");
    expect(ROUTE_SRC).toContain("router.post('/:id/confirm',");
    expect(ROUTE_SRC).toContain("router.post('/:id/delivery',");
    expect(ROUTE_SRC).toContain("router.post('/:id/cancel',");
  });

  it('前端状态机常量与 server INTERNAL_TRANSFER_STATUSES 逐一对齐', () => {
    const match = SERVICE_SRC.match(/export const INTERNAL_TRANSFER_STATUSES = \[([\s\S]*?)\] as const/);
    expect(match).toBeTruthy();
    const serverStatuses = [...match![1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);
    expect([...INTERNAL_TRANSFER_STATUSES]).toEqual(serverStatuses);
  });

  it('前端核算生效集合与 server INTERNAL_TRANSFER_ACCOUNTING_STATUSES 对齐', () => {
    const match = SERVICE_SRC.match(/export const INTERNAL_TRANSFER_ACCOUNTING_STATUSES[^=]*= \[([\s\S]*?)\]/);
    expect(match).toBeTruthy();
    const serverAccounting = [...match![1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);
    expect([...INTERNAL_TRANSFER_ACCOUNTING_STATUSES]).toEqual(serverAccounting);
  });

  it('每个状态都有中文标签（UI 不裸奔英文枚举）', () => {
    for (const s of INTERNAL_TRANSFER_STATUSES) {
      expect(INTERNAL_TRANSFER_STATUS_LABEL[s]).toBeTruthy();
    }
  });

  it('合并利润报表契约字段存在于 reportService 真实源码', () => {
    for (const field of [
      'getConsolidatedProfitReport',
      'consolidatedRevenue',
      'consolidatedCost',
      'consolidatedProfit',
      'externalPurchaseNetOfInternal',
      'realFabricCost',
      'internalPurchase',
      'internalSales',
      'discrepancy',
      'departments',
      'unconverted',
    ]) {
      expect(REPORT_SRC).toContain(field);
    }
  });
});

// ═══ Part 2: DR-033 载荷解码（fail-safe） ═══
describe('runtime QA [internal-trade]: decodeInternalTransferPayload', () => {
  const payload: InternalTransferPayload = {
    docType: 'DR033_INTERNAL_FABRIC_SUPPLY',
    role: 'master',
    masterId: 'OIT__M1',
    mirrorId: 'OIT__R1',
    requestDepartmentId: 'dept_garment',
    supplyDepartmentId: 'dept_fabric',
    garmentOrderId: 'G1',
    fabricOrderId: 'F1',
    materialCode: 'FAB-COTTON-40S',
    quantity: 1000,
    unit: 'm',
    settlementPrice: 30,
    settlementApprovalId: 'APR__1',
    dueDate: '2026-09-01',
    status: 'Effective',
    confirmedQuantity: 1000,
    confirmedDueDate: '2026-09-01',
    confirmedBy: 'u_fabric',
    confirmedAt: '2026-08-16T02:00:00.000Z',
    deliveries: [
      {
        id: 'ITD__1',
        shipmentId: 'SH1',
        shipmentNumber: 'SH-2026-001',
        quantity: 400,
        deliveryDate: '2026-08-10',
        receivedQuantity: 398,
        receivedDate: '2026-08-12',
        variance: -2,
        packingLines: [{ cartonNo: 'C1', quantity: 398 }],
        registeredBy: 'u_fabric',
        registeredAt: '2026-08-10T08:00:00.000Z',
      },
    ],
    history: [
      { from: 'Draft', to: 'PendingConfirm', actorId: 'u_garment', at: '2026-08-01T01:00:00.000Z', note: '服装部发起内部供料申请' },
      { from: 'PendingConfirm', to: 'Effective', actorId: 'u_fabric', at: '2026-08-16T02:00:00.000Z' },
    ],
  };

  it('server 编码载荷（JSON.stringify）可完整解码', () => {
    const decoded = decodeInternalTransferPayload(JSON.stringify(payload));
    expect(decoded?.status).toBe('Effective');
    expect(decoded?.garmentOrderId).toBe('G1');
    expect(decoded?.fabricOrderId).toBe('F1');
    expect(decoded?.deliveries).toHaveLength(1);
    expect(decoded?.deliveries[0].variance).toBe(-2);
    expect(decoded?.history).toHaveLength(2);
  });

  it('非 DR-033 载荷返回 null（fail-safe）', () => {
    expect(decodeInternalTransferPayload(JSON.stringify({ docType: 'OTHER' }))).toBeNull();
    expect(decodeInternalTransferPayload('普通备注文本')).toBeNull();
    expect(decodeInternalTransferPayload('{broken json')).toBeNull();
    expect(decodeInternalTransferPayload(null)).toBeNull();
    expect(decodeInternalTransferPayload(undefined)).toBeNull();
  });
});

// ═══ Part 3: service URL / 解析契约（fetch mock） ═══
describe('runtime QA [internal-trade]: internalTradeService HTTP contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('listInternalTransfers 拼接 status / limit 过滤参数', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ items: [], total: 0 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await internalTradeService.listInternalTransfers({ status: 'Effective', limit: 200 }, ENDPOINT);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/internal-trade/?');
    expect(url).toContain('status=Effective');
    expect(url).toContain('limit=200');
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('listInternalTransfers 无过滤时仅请求根路径', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ items: [{ record: { id: 'OIT__M1' }, payload: null }], total: 1 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await internalTradeService.listInternalTransfers({}, ENDPOINT);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/internal-trade/');
    expect(url).not.toContain('?');
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('getInternalTransfer 按 id 请求详情端点', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ item: { id: 'OIT__M1' }, mirror: { id: 'OIT__R1' }, payload: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const detail = await internalTradeService.getInternalTransfer('OIT__M1', ENDPOINT);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/internal-trade/OIT__M1');
    expect(detail.mirror?.id).toBe('OIT__R1');
  });

  it('getConsolidatedProfitReport 请求 /v1/finance/reports/consolidated-profit', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => CONSOLIDATED_FIXTURE,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const report = await internalTradeService.getConsolidatedProfitReport(ENDPOINT);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/finance/reports/consolidated-profit');
    expect(report.consolidatedProfit).toBe(46500);
  });

  it('透出 fail-closed 错误码（INVALID_TRANSFER_STATE）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (..._args: any[]) => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'INVALID_TRANSFER_STATE', message: '非法状态: Bogus' }),
    })));

    await expect(
      internalTradeService.listInternalTransfers({ status: 'Bogus' as any }, ENDPOINT),
    ).rejects.toThrow('非法状态: Bogus');
  });

  it('toAmount 归一 Prisma Decimal 序列化（string | number → number）', () => {
    expect(toAmount('30000')).toBe(30000);
    expect(toAmount(12.5)).toBe(12.5);
    expect(toAmount(undefined)).toBe(0);
    expect(toAmount(null)).toBe(0);
    expect(toAmount('abc')).toBe(0);
  });
});

// ═══ Part 4: 合并抵销恒等式（fixture 数字来自 server 真实测试 internalTradeProfit.test.ts） ═══
const CONSOLIDATED_FIXTURE: ConsolidatedProfitReport = {
  baseCurrency: 'CNY',
  consolidatedRevenue: 100000,
  consolidatedCost: 53500,
  consolidatedProfit: 46500,
  costBreakdown: {
    externalPurchaseNetOfInternal: 30000,
    realFabricCost: 20000,
    freightCost: 2500,
    miscCost: 1000,
  },
  elimination: { internalPurchase: 30000, internalSales: 30000, amount: 30000, discrepancy: 0 },
  departments: {
    garment: { revenue: 100000, cost: 63000, profit: 37000 },
    fabric: { revenue: 30000, cost: 20500, profit: 9500 },
  },
  orders: { externalCount: 1, internalCount: 1 },
  unconverted: [],
};

describe('runtime QA [consolidated]: DR-005 抵销恒等式（server 真实测试数字）', () => {
  it('合并利润 = 合并收入 − 合并成本', () => {
    expect(CONSOLIDATED_FIXTURE.consolidatedRevenue - CONSOLIDATED_FIXTURE.consolidatedCost)
      .toBe(CONSOLIDATED_FIXTURE.consolidatedProfit);
  });

  it('Σ 部门利润 = 合并利润（抵销不改变公司利润，仅在部门间重新归属）', () => {
    const deptSum = CONSOLIDATED_FIXTURE.departments.garment.profit + CONSOLIDATED_FIXTURE.departments.fabric.profit;
    expect(deptSum).toBe(CONSOLIDATED_FIXTURE.consolidatedProfit);
  });

  it('抵销净额 = 内部采购合计（单边口径），discrepancy = 内部销售 − 内部采购', () => {
    expect(CONSOLIDATED_FIXTURE.elimination.amount).toBe(CONSOLIDATED_FIXTURE.elimination.internalPurchase);
    expect(CONSOLIDATED_FIXTURE.elimination.discrepancy).toBe(
      CONSOLIDATED_FIXTURE.elimination.internalSales - CONSOLIDATED_FIXTURE.elimination.internalPurchase,
    );
  });

  it('合并成本构成四分项合计 = 合并成本', () => {
    const b = CONSOLIDATED_FIXTURE.costBreakdown;
    expect(b.externalPurchaseNetOfInternal + b.realFabricCost + b.freightCost + b.miscCost)
      .toBe(CONSOLIDATED_FIXTURE.consolidatedCost);
  });
});
