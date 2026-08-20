/**
 * MonthlyCloseSection.tsx — REQ2-17 月末批量结转（DR-058）
 *
 * 挂载：FinanceReportsPanel「月末结转」tab（报表中心延伸：月末时点快照 + 月度对比）。
 * 交互：periodKey（默认上一个完整月）→ 一键结转（mc: 幂等键，重复 skipped）→ 对比表
 * （每定义本期/上期 metric 合计 + Δ/Δ%；缺上期提示先结转上月）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Loader2, RefreshCw } from 'lucide-react';
import { reportingService, MonthlyCloseCompareItem, MonthlyCloseRunResult } from '../../services/reportingService';
import { bdsConfirm } from '../ui/BdsDialog';
import { bdsToast } from '../ui/bdsToast';
import { RdlSurface, RdlToolbar } from '../ui/RDLPrimitives';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

function previousMonthKey(): string {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.abs(v) >= 1000 ? v.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(Math.round(v * 100) / 100);
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v}%`;
}

interface MonthlyCloseSectionProps { isDarkMode: boolean; endpoint?: string; }

export const MonthlyCloseSection: React.FC<MonthlyCloseSectionProps> = ({ endpoint }) => {
  const [periodKey, setPeriodKey] = useState(previousMonthKey());
  const [running, setRunning] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [error, setError] = useState('');
  const [runResult, setRunResult] = useState<MonthlyCloseRunResult | null>(null);
  const [compare, setCompare] = useState<{ periodKey: string; previousPeriodKey: string; items: MonthlyCloseCompareItem[] } | null>(null);

  const loadCompare = useCallback(async (pk: string) => {
    setCompareLoading(true);
    setError('');
    try {
      const data = await reportingService.compareMonthlyClose(pk, endpoint);
      setCompare(data);
    } catch (e: any) {
      setError(e.message || '月度对比加载失败');
    } finally {
      setCompareLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    loadCompare(periodKey);
  }, [periodKey, loadCompare]);

  const runClose = async () => {
    if (running) return;
    const confirmed = await bdsConfirm({
      title: '确认月末结转',
      body: `对 ${periodKey} 执行月末结转？将批量生成所有月度报表定义的时点快照（幂等：已结转的定义自动跳过，不覆盖历史）。`,
    });
    if (!confirmed) return;
    setRunning(true);
    setError('');
    try {
      const result = await reportingService.runMonthlyClose(periodKey, endpoint);
      setRunResult(result);
      bdsToast.success(`结转完成：新增 ${result.ran} / 跳过 ${result.skipped}${result.failed > 0 ? ` / 失败 ${result.failed}` : ''}`);
      await loadCompare(periodKey);
    } catch (e: any) {
      setError(e.message || '结转执行失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <RdlSurface>
        <RdlToolbar>
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs tracking-[0.14em] text-[var(--text-secondary)]">
              <CalendarCheck size={14} />
              月末结转 MONTHLY CLOSE
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={periodKey}
                onChange={e => { if (e.target.value) setPeriodKey(e.target.value); }}
                className="bds-input sm w-36"
                aria-label="结转月份"
              />
              <button type="button" className="bds-btn bds-btn-ghost h-9" disabled={compareLoading} onClick={() => loadCompare(periodKey)}>
                {compareLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                刷新对比
              </button>
              <button type="button" className="bds-btn bds-btn-primary h-9" disabled={running} onClick={runClose}>
                {running ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck size={14} />}
                {running ? '结转中...' : '一键结转'}
              </button>
            </div>
          </div>
        </RdlToolbar>
        <div className="px-4 pb-4 space-y-3">
          <div className="text-[11px] font-light leading-relaxed text-[var(--text-tertiary)]">
            结转 = 各月度报表定义在月末时点的存量快照（对账口径，幂等不覆盖历史）；月度自动快照（A5 调度，月初口径）不受影响。
            严格当月发生额口径列增强。
          </div>

          {error && <div className="bds-alert danger">{error}</div>}

          {runResult && (
            <div className="bds-alert success">
              {runResult.periodKey} 结转：{runResult.ran} 新增 / {runResult.skipped} 跳过{runResult.failed > 0 ? ` / ${runResult.failed} 失败（见运行历史）` : ''}（共 {runResult.total} 个月度定义）
            </div>
          )}

          {compareLoading && !compare && <div className="text-xs font-light text-[var(--text-tertiary)]">对比加载中...</div>}

          {compare && compare.items.length === 0 && (
            <div className="text-xs font-light text-[var(--text-tertiary)]">
              暂无月度报表定义。先在报表中心创建 schedule=monthly 的定义（如订单月报/发票月报）。
            </div>
          )}

          {compare && compare.items.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">
                <span>月度对比 · {compare.periodKey} vs {compare.previousPeriodKey}</span>
                <span>{compare.items.length} 个定义</span>
              </div>
              {compare.items.map(item => (
                <div key={item.definitionId} className="rounded-compact bg-[var(--recessed-bg)] px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs font-light text-[var(--text-primary)]">{item.name}</span>
                    <span className="text-[10px] font-light text-[var(--text-tertiary)]">{item.datasetKey}</span>
                    <span className={cx('bds-badge', item.current ? 'success' : 'neutral')}>
                      {item.current ? `${item.current.rowCount} 行快照` : '本期未结转'}
                    </span>
                    {item.previous == null && (
                      <span className="bds-badge warning">上期未结转（Δ 无基线）</span>
                    )}
                  </div>
                  {item.deltas.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-[11px] font-light border-separate border-spacing-0">
                        <thead className="text-[10px] text-[var(--text-tertiary)]">
                          <tr>
                            <th className="border-b border-[var(--border-c-default)] px-2 py-1.5">指标</th>
                            <th className="border-b border-[var(--border-c-default)] px-2 py-1.5 text-right">本期</th>
                            <th className="border-b border-[var(--border-c-default)] px-2 py-1.5 text-right">上期</th>
                            <th className="border-b border-[var(--border-c-default)] px-2 py-1.5 text-right">Δ</th>
                            <th className="border-b border-[var(--border-c-default)] px-2 py-1.5 text-right">Δ%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.deltas.map((d: any) => (
                            <tr key={d.metric}>
                              <td className="border-b border-[var(--border-c-subtle)] px-2 py-1.5 text-[var(--text-secondary)]">{d.metric}</td>
                              <td className="border-b border-[var(--border-c-subtle)] px-2 py-1.5 text-right text-[var(--text-primary)]">{fmtNum(d.current)}</td>
                              <td className="border-b border-[var(--border-c-subtle)] px-2 py-1.5 text-right text-[var(--text-secondary)]">{fmtNum(d.previous)}</td>
                              <td className={cx('border-b border-[var(--border-c-subtle)] px-2 py-1.5 text-right', d.delta > 0 ? 'text-[var(--os-vnext-brand-blue-strong)]' : d.delta < 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]')}>
                                {d.delta > 0 ? '+' : ''}{fmtNum(d.delta)}
                              </td>
                              <td className="border-b border-[var(--border-c-subtle)] px-2 py-1.5 text-right text-[var(--text-secondary)]">{fmtPct(d.deltaPct)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </RdlSurface>
    </div>
  );
};

export default MonthlyCloseSection;
