import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { reportingService } from './reportingService';

const ENDPOINT = 'https://test.example.com';
const sectionSource = readFileSync(new URL('../components/finance/MonthlyCloseSection.tsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../components/finance/FinanceReportsPanel.tsx', import.meta.url), 'utf8');

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
}

describe('reportingService（REQ2-17 月末结转 contract，DR-058）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('runMonthlyClose POST /v1/reports/monthly-close（携带 periodKey）', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ periodKey: '2026-07', total: 2, ran: 2, skipped: 0, failed: 0, results: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await reportingService.runMonthlyClose('2026-07', ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/reports/monthly-close');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ periodKey: '2026-07' });
    expect(r.ran).toBe(2);
  });

  it('compareMonthlyClose GET /monthly-close/compare?periodKey=', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ periodKey: '2026-07', previousPeriodKey: '2026-06', items: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await reportingService.compareMonthlyClose('2026-07', ENDPOINT);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/reports/monthly-close/compare?periodKey=2026-07');
    expect(r.previousPeriodKey).toBe('2026-06');
  });

  it('失败响应透传 error code（NO_MONTHLY_DEFINITIONS → 404）', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NO_MONTHLY_DEFINITIONS', message: '无可结转的月度报表定义' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(reportingService.runMonthlyClose('2026-07', ENDPOINT))
      .rejects.toMatchObject({ status: 404, code: 'NO_MONTHLY_DEFINITIONS' });
  });
});

describe('MonthlyCloseSection REQ2-17（DR-058 UI 契约）', () => {
  it('月份选择（默认上一个完整月）+ 一键结转（bdsConfirm 确认 + 幂等提示）+ 刷新对比', () => {
    expect(sectionSource).toContain('previousMonthKey()');
    expect(sectionSource).toContain('type="month"');
    expect(sectionSource).toContain('一键结转');
    expect(sectionSource).toContain("'确认月末结转'");
    expect(sectionSource).toContain('已结转的定义自动跳过，不覆盖历史');
    expect(sectionSource).toContain('刷新对比');
  });

  it('对比表：本期/上期/Δ/Δ% 四列 + 缺上期提示 + Δ% null 不除零显示', () => {
    expect(sectionSource).toContain("item.current ? `${item.current.rowCount} 行快照` : '本期未结转'");
    expect(sectionSource).toContain('上期未结转（Δ 无基线）');
    expect(sectionSource).toContain('fmtPct(d.deltaPct)');
    expect(sectionSource).toContain('function fmtPct(v: number | null)');
  });

  it('挂载：FinanceReportsPanel 报表 tab 新增月末结转子 tab', () => {
    expect(panelSource).toContain("{ id: 'monthly-close', label: '月末结转', en: 'Monthly Close' }");
    expect(panelSource).toContain("import MonthlyCloseSection from './MonthlyCloseSection'");
    expect(panelSource).toContain("{tab === 'monthly-close' && <MonthlyCloseSection");
  });
});
