/**
 * 经营简报组装服务单元测试（阶段 E / E2）
 *
 * mock 边界：dashboardService（C1 聚合）与 reportService（B2 账龄）各自有独立测试，
 * 本文件 vi.mock 隔离，聚焦 briefingService 增量逻辑：
 *   日报：文本分段、在手订单敞口分币种合计、风险分级、本月区间传参
 *   周报：周区间计算（lastMondayMs 边界）、环比口径、Top3 截断、分级
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const mockGetBusinessCockpit = vi.fn();
const mockGetAgingReport = vi.fn();
const mockGetFxGainLoss = vi.fn();

vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../dashboard/dashboardService', () => ({
  getBusinessCockpit: (...args: any[]) => mockGetBusinessCockpit(...args),
}));
vi.mock('../../finance/reportService', () => ({
  getAgingReport: (...args: any[]) => mockGetAgingReport(...args),
  getFxGainLoss: (...args: any[]) => mockGetFxGainLoss(...args),
}));

import {
  buildDailyBriefing,
  buildWeeklyBriefing,
  lastMondayMs,
  formatLocalDate,
  fmtMoney,
} from '../briefingService';

// 固定：2026-08-10 是周一（getDay=1）
const NOW_MONDAY = new Date(2026, 7, 10, 9, 30);
// 2026-08-12 周三
const NOW_WEDNESDAY = new Date(2026, 7, 12, 10, 0);

function makePrisma(overrides: Record<string, any> = {}) {
  const defaults = {
    order: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    shipment: { count: vi.fn().mockResolvedValue(0) },
    invoice: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    paymentVoucher: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
  };
  const merged: any = { ...defaults };
  for (const [model, fns] of Object.entries(overrides)) {
    merged[model] = { ...defaults[model as keyof typeof defaults], ...fns };
  }
  return merged as any;
}

function emptyCockpit(overrides: Record<string, any> = {}) {
  return {
    from: null, to: null, generatedAt: '',
    salesLeaderboard: [],
    customerContribution: [],
    orderMargins: { rows: [], totals: [], excludedCount: 0 },
    arApAlerts: {
      receivable: { rows: [], totals: [] },
      payable: { rows: [], totals: [] },
    },
    fxSummary: { baseCurrency: 'USD', totalGainLoss: 0, rowCount: 0 },
    ...overrides,
  };
}

function agingRow(customerName: string, currency: string, buckets: Partial<Record<'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus' | 'total', number>>) {
  const b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, ...buckets };
  return { customerRelationId: null, customerName, currency, invoiceCount: 1, buckets: b };
}

describe('工具函数', () => {
  it('lastMondayMs：周一 → 上周一', () => {
    expect(formatLocalDate(lastMondayMs(NOW_MONDAY))).toBe('2026-08-03');
  });
  it('lastMondayMs：周三 → 上周一', () => {
    expect(formatLocalDate(lastMondayMs(NOW_WEDNESDAY))).toBe('2026-08-03');
  });
  it('lastMondayMs：周日 2026-08-16 → 上周一 2026-08-03（非本周一）', () => {
    expect(formatLocalDate(lastMondayMs(new Date(2026, 7, 16)))).toBe('2026-08-03');
  });
  it('fmtMoney：千分位 + 两位小数截断', () => {
    expect(fmtMoney(123456.789)).toBe('123,456.79');
    expect(fmtMoney(0)).toBe('0');
  });
});

describe('buildDailyBriefing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBusinessCockpit.mockResolvedValue(emptyCockpit());
    mockGetAgingReport.mockResolvedValue({ type: 'Receivable', asOf: '2026-08-10', rows: [], totals: [] });
  });

  it('完整组装：昨日动态 + 在手订单 + 应收逾期 + 本月毛利', async () => {
    const prisma = makePrisma({
      order: {
        count: vi.fn()
          .mockResolvedValueOnce(3)  // newOrders
          .mockResolvedValueOnce(2)  // confirmedOrders
          .mockResolvedValueOnce(1), // pendingConfirmations
        findMany: vi.fn().mockResolvedValue([
          { contractAmount: '100000', quoteAmount: null, currency: 'USD', salesCurrency: null },
          { contractAmount: null, quoteAmount: '50000', currency: 'USD', salesCurrency: null },
          { contractAmount: '200000', quoteAmount: null, currency: 'CNY', salesCurrency: 'CNY' },
        ]),
      },
      shipment: { count: vi.fn().mockResolvedValue(1) },
      invoice: {
        count: vi.fn().mockResolvedValue(2),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: '45000' } }),
      },
      paymentVoucher: {
        count: vi.fn().mockResolvedValue(1),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: '20000' } }),
      },
    });
    mockGetAgingReport.mockResolvedValue({
      type: 'Receivable', asOf: '2026-08-10', totals: [],
      rows: [agingRow('ACME', 'USD', { d1_30: 30000, total: 30000 })],
    });
    mockGetBusinessCockpit.mockResolvedValue(emptyCockpit({
      orderMargins: {
        rows: [], excludedCount: 0,
        totals: [{ currency: 'USD', revenue: 380000, cost: 312000, margin: 68000, marginRate: 0.1789, orderCount: 5 }],
      },
    }));

    const b = await buildDailyBriefing(prisma, NOW_MONDAY);

    expect(b.title).toBe('每日经营摘要 2026-08-10');
    expect(b.body).toContain('订单变更 3 笔·确认 2 笔');
    expect(b.body).toContain('发货 1 单');
    expect(b.body).toContain('开票 2 张（合计 45,000）');
    expect(b.body).toContain('收款 1 笔（合计 20,000）');
    expect(b.body).toContain('【在手订单】3 笔，敞口 CNY 200,000 / USD 150,000');
    expect(b.body).toContain('【应收逾期】USD 30,000（最大逾期户：ACME USD 30,000）');
    expect(b.body).toContain('【本月毛利】USD 68,000（17.89%）');
    expect(b.body).toContain('【待办】待确认订单 1 笔');
    expect(b.level).toBe('info');
  });

  it('本月区间传参：from=月初 to=今天（本地日期）', async () => {
    const prisma = makePrisma();
    await buildDailyBriefing(prisma, NOW_WEDNESDAY); // 2026-08-12
    expect(mockGetBusinessCockpit).toHaveBeenCalledWith(prisma, { from: '2026-08-01', to: '2026-08-12' });
  });

  it('在手订单口径：status 排除 Delivered/Cancelled，销售币种 salesCurrency ?? currency', async () => {
    const prisma = makePrisma();
    await buildDailyBriefing(prisma, NOW_MONDAY);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.status.notIn).toEqual(['Delivered', 'Cancelled']);
    expect(where.deletedAt).toBeNull();
  });

  it('长账龄逾期（d61_90+d90plus > 0）→ warning', async () => {
    const prisma = makePrisma();
    mockGetAgingReport.mockResolvedValue({
      type: 'Receivable', asOf: '2026-08-10', totals: [],
      rows: [agingRow('BADCO', 'USD', { d90plus: 5000, total: 5000 })],
    });
    const b = await buildDailyBriefing(prisma, NOW_MONDAY);
    expect(b.level).toBe('warning');
  });

  it('负毛利订单存在 → warning；无毛利合计 → 「暂无可计毛利订单」', async () => {
    const prisma = makePrisma();
    mockGetBusinessCockpit.mockResolvedValue(emptyCockpit({
      orderMargins: {
        rows: [{ margin: -1000, currency: 'USD' }], excludedCount: 1,
        totals: [],
      },
    }));
    const b = await buildDailyBriefing(prisma, NOW_MONDAY);
    expect(b.level).toBe('warning');
    expect(b.body).toContain('暂无可计毛利订单');
  });

  it('逾期为 0 时显示 —', async () => {
    const prisma = makePrisma();
    const b = await buildDailyBriefing(prisma, NOW_MONDAY);
    expect(b.body).toContain('【应收逾期】—');
  });
});

describe('buildWeeklyBriefing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBusinessCockpit.mockResolvedValue(emptyCockpit());
    mockGetAgingReport.mockResolvedValue({ type: 'Receivable', asOf: '', rows: [], totals: [] });
  });

  it('周区间：周一触发 → 上周一~上周日；上上周区间正确', async () => {
    const prisma = makePrisma();
    await buildWeeklyBriefing(prisma, NOW_MONDAY); // 2026-08-10 周一
    expect(mockGetBusinessCockpit).toHaveBeenNthCalledWith(1, prisma, { from: '2026-08-03', to: '2026-08-09' });
    expect(mockGetBusinessCockpit).toHaveBeenNthCalledWith(2, prisma, { from: '2026-07-27', to: '2026-08-02' });
  });

  it('标题与环比：同币种百分比、新增、无基数', async () => {
    mockGetBusinessCockpit
      .mockResolvedValueOnce(emptyCockpit({
        salesLeaderboard: [
          { salesPerson: 'Alice', currency: 'USD', orderCount: 3, salesAmount: 110000, collectedAmount: 0 },
          { salesPerson: 'Bob', currency: 'EUR', orderCount: 1, salesAmount: 5000, collectedAmount: 0 },
        ],
      }))
      .mockResolvedValueOnce(emptyCockpit({
        salesLeaderboard: [
          { salesPerson: 'Alice', currency: 'USD', orderCount: 2, salesAmount: 100000, collectedAmount: 0 },
        ],
      }));
    const prisma = makePrisma();
    const b = await buildWeeklyBriefing(prisma, NOW_MONDAY);
    expect(b.title).toBe('每周经营报告 2026-08-03 ~ 2026-08-09');
    expect(b.body).toContain('【环比上周】USD +10% / EUR 新增');
    expect(b.level).toBe('info');
  });

  it('环比下滑 >30% → warning', async () => {
    mockGetBusinessCockpit
      .mockResolvedValueOnce(emptyCockpit({
        salesLeaderboard: [{ salesPerson: 'Alice', currency: 'USD', orderCount: 1, salesAmount: 50000, collectedAmount: 0 }],
      }))
      .mockResolvedValueOnce(emptyCockpit({
        salesLeaderboard: [{ salesPerson: 'Alice', currency: 'USD', orderCount: 3, salesAmount: 100000, collectedAmount: 0 }],
      }));
    const prisma = makePrisma();
    const b = await buildWeeklyBriefing(prisma, NOW_MONDAY);
    expect(b.level).toBe('warning');
    expect(b.body).toContain('USD -50%');
  });

  it('排行/客户 Top3 截断 + 毛利 + 逾期 + 汇损完整组装', async () => {
    mockGetBusinessCockpit
      .mockResolvedValueOnce(emptyCockpit({
        salesLeaderboard: [
          { salesPerson: 'A', currency: 'USD', orderCount: 1, salesAmount: 900, collectedAmount: 0 },
          { salesPerson: 'B', currency: 'USD', orderCount: 1, salesAmount: 800, collectedAmount: 0 },
          { salesPerson: 'C', currency: 'USD', orderCount: 1, salesAmount: 700, collectedAmount: 0 },
          { salesPerson: 'D', currency: 'USD', orderCount: 1, salesAmount: 600, collectedAmount: 0 },
        ],
        customerContribution: [
          { customer: 'ACME', customerRelationId: null, currency: 'USD', orderCount: 2, salesAmount: 2000, share: 0.6667 },
        ],
        orderMargins: {
          rows: [], excludedCount: 0,
          totals: [{ currency: 'USD', revenue: 3000, cost: 2400, margin: 600, marginRate: 0.2, orderCount: 3 }],
        },
        arApAlerts: {
          receivable: { rows: [], totals: [{ currency: 'USD', overdue: 12000, total: 50000 }] },
          payable: { rows: [], totals: [{ currency: 'CNY', overdue: 3000, total: 20000 }] },
        },
        fxSummary: { baseCurrency: 'USD', totalGainLoss: -1234.56, rowCount: 4 },
      }))
      .mockResolvedValueOnce(emptyCockpit());
    const prisma = makePrisma();
    const b = await buildWeeklyBriefing(prisma, NOW_MONDAY);
    expect(b.body).toContain('1. A USD 900（1 单）');
    expect(b.body).toContain('3. C USD 700（1 单）');
    expect(b.body).not.toContain('D USD 600');
    expect(b.body).toContain('1. ACME USD 2,000（占 66.67%）');
    expect(b.body).toContain('【区间毛利】USD 600');
    expect(b.body).toContain('【应收逾期】USD 12,000；【应付逾期】CNY 3,000');
    expect(b.body).toContain('【汇率损益】USD -1,234.56（4 笔重估）');
  });

  it('长账龄逾期行 → warning（receivable.rows d61_90/d90plus 加总）', async () => {
    mockGetBusinessCockpit
      .mockResolvedValueOnce(emptyCockpit({
        arApAlerts: {
          receivable: { rows: [agingRow('X', 'USD', { d61_90: 100, total: 100 })], totals: [] },
          payable: { rows: [], totals: [] },
        },
      }))
      .mockResolvedValueOnce(emptyCockpit());
    const prisma = makePrisma();
    const b = await buildWeeklyBriefing(prisma, NOW_MONDAY);
    expect(b.level).toBe('warning');
  });

  it('汇损 0 笔时不显示该行', async () => {
    mockGetBusinessCockpit.mockResolvedValue(emptyCockpit());
    const prisma = makePrisma();
    const b = await buildWeeklyBriefing(prisma, NOW_MONDAY);
    expect(b.body).not.toContain('汇率损益');
  });
});
