/**
 * 批次 I（功能修复任务包 40 项）— FinanceManager I1/I2/I3 契约测试
 *
 * 覆盖：
 *   I1 付款凭证入口引导：关联付款申请下拉（已批准未付款）+ 提交前客户端拦截 + 引导文案 + paymentRequestId 透传
 *   I2 首屏 KPI 卡币种合并：aggregateToCny 纯逻辑（折人民币合计 / 缺汇率披露 / 纯 CNY 不显示）
 *       + 汇率真源契约（apiService.getLatestFxRates，不自造汇率）
 *   I3 催款入口提前：collections 一级 tab 接线（分级看板 / 催款函 / 月末结转）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregateToCny, type CurrencyAggItem } from './FinanceManager';

const FINANCE_MGR = readFileSync(new URL('./FinanceManager.tsx', import.meta.url), 'utf8');
const VOUCHER_SERVICE = readFileSync(new URL('../services/paymentVoucherService.ts', import.meta.url), 'utf8');

// ─────────────────────────────────────────────────────────────
// I2 折人民币合计：纯逻辑
// ─────────────────────────────────────────────────────────────
describe('I2 aggregateToCny 折人民币合计（纯逻辑）', () => {
  const agg = (currency: string, total: number, count = 1): CurrencyAggItem => ({ currency, total, count });

  it('单币种外币按汇率折算', () => {
    const r = aggregateToCny([agg('USD', 10000)], { USD: 7.1 });
    expect(r.total).toBeCloseTo(71000);
    expect(r.missing).toEqual([]);
    expect(r.hasForeign).toBe(true);
  });

  it('多币种合并：CNY 按 1 计 + 外币按各自汇率折算后相加', () => {
    const r = aggregateToCny(
      [agg('CNY', 5000, 2), agg('USD', 1000), agg('EUR', 500)],
      { USD: 7.1, EUR: 7.8 },
    );
    expect(r.total).toBeCloseTo(5000 + 7100 + 3900);
    expect(r.missing).toEqual([]);
    expect(r.hasForeign).toBe(true);
  });

  it('缺汇率币种不强行折算，列入 missing 透明披露', () => {
    const r = aggregateToCny([agg('USD', 1000), agg('HKD', 800)], { USD: 7.1 });
    expect(r.total).toBeCloseTo(7100);
    expect(r.missing).toEqual(['HKD']);
  });

  it('非法汇率（0 / 负数 / NaN）视为缺失，不参与折算', () => {
    for (const bad of [0, -7.1, Number.NaN]) {
      const r = aggregateToCny([agg('USD', 1000)], { USD: bad });
      expect(r.total).toBe(0);
      expect(r.missing).toEqual(['USD']);
    }
  });

  it('纯人民币聚合：hasForeign=false（调用方据此不显示折算行）', () => {
    const r = aggregateToCny([agg('CNY', 12345, 3)], {});
    expect(r.total).toBe(12345);
    expect(r.hasForeign).toBe(false);
    expect(r.missing).toEqual([]);
  });

  it('空聚合：total=0 且不标记外币', () => {
    const r = aggregateToCny([], { USD: 7.1 });
    expect(r.total).toBe(0);
    expect(r.hasForeign).toBe(false);
    expect(r.missing).toEqual([]);
  });

  it('币种缺失（空串 → —）视为未知外币，列入 missing', () => {
    const r = aggregateToCny([agg('', 100)], { USD: 7.1 });
    expect(r.missing).toEqual(['—']);
    expect(r.hasForeign).toBe(true);
  });

  it('同一缺汇率币种多笔只披露一次', () => {
    const r = aggregateToCny([agg('GBP', 100), agg('GBP', 200, 2)], {});
    expect(r.missing).toEqual(['GBP']);
  });
});

// ─────────────────────────────────────────────────────────────
// I2 折人民币合计：接线契约（汇率真源 + KPI 卡展示）
// ─────────────────────────────────────────────────────────────
describe('I2 KPI 卡币种合并接线（源码契约）', () => {
  it('复用风控域最新汇率档案（apiService.getLatestFxRates），不自造汇率口径', () => {
    expect(FINANCE_MGR).toContain('apiService.getLatestFxRates()');
  });
  it('KPI 卡携带折人民币合计行（tertiary）', () => {
    expect(FINANCE_MGR).toContain('折人民币 ≈');
    expect(FINANCE_MGR).toContain('tertiary: cnyLine(');
    expect(FINANCE_MGR).toContain('aggregateToCny(agg, latestFxRates)');
  });
  it('缺汇率币种透明披露（不静默按 0 或 1 折算）', () => {
    expect(FINANCE_MGR).toContain('缺 ${result.missing.join');
  });
});

// ─────────────────────────────────────────────────────────────
// I1 付款凭证入口引导（源码契约）
// ─────────────────────────────────────────────────────────────
describe('I1 付款凭证入口引导（源码契约）', () => {
  it('新建付款凭证表单含「关联付款申请」下拉', () => {
    expect(FINANCE_MGR).toContain('关联付款申请');
    expect(FINANCE_MGR).toContain('paymentRequestService.listPaymentRequests');
    expect(FINANCE_MGR).toContain("listPaymentRequests({ status: 'Approved' })");
  });
  it('下拉数据源过滤已生成凭证的申请（已批准未付款）', () => {
    expect(FINANCE_MGR).toContain('list.filter(r => !r.paymentVoucherId)');
  });
  it('选中申请自动带出金额/币种/供应商/付款性质', () => {
    expect(FINANCE_MGR).toContain('amount: String(pr.totalAmount');
    expect(FINANCE_MGR).toContain('currency: pr.currency');
    expect(FINANCE_MGR).toContain('customerRelationId: pr.supplierId');
    expect(FINANCE_MGR).toContain('voucherCategory: (pr.paymentCategory as VoucherCategory)');
  });
  it('无关联直接付款：提交前客户端拦截并给出引导文案', () => {
    expect(FINANCE_MGR).toContain("voucherForm.type === 'Disbursement' && !voucherForm.paymentRequestId");
    expect(FINANCE_MGR).toContain('付款凭证必须关联审批通过的付款申请（先申请后付款）');
  });
  it('创建凭证透传 paymentRequestId（后端 DR-017 门禁 + CAS 回写申请单）', () => {
    expect(FINANCE_MGR).toContain("paymentRequestId: voucherForm.type === 'Disbursement' ? voucherForm.paymentRequestId || undefined : undefined");
    expect(VOUCHER_SERVICE).toContain('paymentRequestId?: string');
  });
  it('无已批准申请时引导去付款申请页签', () => {
    expect(FINANCE_MGR).toContain('暂无已批准未付款的付款申请');
    expect(FINANCE_MGR).toContain("setActiveTab('paymentRequests')");
  });
});

// ─────────────────────────────────────────────────────────────
// I3 催款入口提前（源码契约）
// ─────────────────────────────────────────────────────────────
describe('I3 催款函/月结一级入口（源码契约）', () => {
  it('FinanceTabId 与 FINANCE_TABS 含 collections 一级 tab', () => {
    expect(FINANCE_MGR).toContain("'collections'");
    expect(FINANCE_MGR).toContain("{ id: 'collections', label: '催款月结'");
  });
  it('collections 为自包含 tab（不消费共享列表与核销副作用）', () => {
    expect(FINANCE_MGR).toContain("activeTab === 'collections'");
    expect(FINANCE_MGR).toContain("|| activeTab === 'collections'");
  });
  it('催款视图挂载分级看板 + 催款函 BottomSheet（复用既有自包含组件）', () => {
    expect(FINANCE_MGR).toContain('<DunningStageBoardPanel');
    expect(FINANCE_MGR).toContain('<DunningSheet');
    expect(FINANCE_MGR).toContain('onDun={(row) => setDunningRow(row)}');
  });
  it('月末结转视图挂载 MonthlyCloseSection', () => {
    expect(FINANCE_MGR).toContain('<MonthlyCloseSection isDarkMode={isDarkMode} />');
  });
});
