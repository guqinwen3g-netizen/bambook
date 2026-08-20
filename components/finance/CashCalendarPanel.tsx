/**
 * CashCalendarPanel — REQ2-02 资金日历与 30 天现金流预测（剧本 C）
 *
 * 设计真源：需求池 REQ2-02 · DR-044 净额口径（open = amount − Σ InvoiceAllocation，
 * 与账龄/对账单/KPI 跨模块同源——验收计划 §4.4 交叉一致性铁律）
 *
 * 四区布局：
 *   1. 今日动作清单 —— 逾期 + 今日到期（该收谁的钱/该付谁的钱）
 *   2. 30 天现金流预测 —— 按币种：应收到期 in / 应付到期 out / 净额（逾期单列）
 *   3. 外汇敞口（E4）—— 非本位币净应收/净应付
 *   4. 预收款/保证金泳道 —— 未核销凭证余额（voucherCategory 分组）
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CalendarClock, Coins, Globe2, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { apiService } from '../../services/apiService';
import type { CashCalendarReport } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const VOUCHER_CATEGORY_LABELS: Record<string, string> = {
  normal: '常规款项',
  advance: '预收款',
  deposit: '保证金',
  sample_express: '样品快递费',
  customer_reimburse: '客户报销',
  business_cost: '业务成本',
};

function formatAmount(amount: number, currency?: string): string {
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : (currency || '');
  return `${sym}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CashCalendarPanelProps {
  isDarkMode: boolean;
  endpoint?: string;
}

export function CashCalendarPanel({ isDarkMode: _isDarkMode, endpoint }: CashCalendarPanelProps) {
  const [asOf, setAsOf] = useState(todayStr());
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CashCalendarReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-subtle)]';
  const rowBg = 'bg-[var(--recessed-bg)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiService.getCashCalendar({ asOf: asOf || undefined, days }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [asOf, days, endpoint]);

  useEffect(() => { load(); }, [load]);

  const inputCls = 'bds-input sm bds-tnum w-auto';

  const sectionTitle = (icon: React.ReactNode, zh: string, en: string) => (
    <div className={cx('flex items-center gap-2 border-b px-4 pb-2 pt-2.5', divider)}>
      <span className={textFaint}>{icon}</span>
      <span className={cx('text-xs font-light', textPrimary)}>{zh}</span>
      <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>{en}</span>
    </div>
  );

  const overdueBadge = (d: number) => {
    if (d === 0) return <span className="bds-badge sm warning">今日到期</span>;
    return <span className="bds-badge sm danger">逾期 {d} 天</span>;
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-7 pb-5">
      {/* 工具条：基准日 + 预测窗口 + 查询 */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="bds-filterbar">
          <span className={cx('px-2 text-[10px] font-light tracking-[0.14em]', textSecondary)}>基准日</span>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={inputCls} />
          <span className={cx('px-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>预测窗口</span>
          {[30, 60, 90].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cx('rounded-full border px-3 py-1 text-[11px] font-light transition-colors',
                days === d
                  ? 'border-[var(--accent-tint)] bg-[var(--accent-tint-light)] text-[var(--text-primary)]'
                  : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]')}
            >
              {d} 天
            </button>
          ))}
          <button type="button" onClick={load} className="bds-btn bds-btn-secondary">
            <RefreshCw size={14} strokeWidth={1.5} />查询
          </button>
        </div>
        {data && (
          <div className={cx('ml-auto text-[10px] font-light tabular-nums', textFaint)}>
            窗口 {data.asOf} ~ {data.windowEnd}（多币种不折算，与账龄/对账单同口径）
          </div>
        )}
      </div>

      {loading && (
        <div className={cx('flex items-center justify-center gap-2 py-12 text-xs font-light', textFaint)}>
          <Loader2 size={14} className="animate-spin" />加载中…
        </div>
      )}
      {!loading && error && (
        <div className={cx('flex items-center justify-center gap-2 py-12 text-xs font-light', textFaint)}>
          <AlertCircle size={14} />{error}
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── 区 1：今日动作清单（逾期 + 今日到期）── */}
          <div className="bds-card flex min-h-0 shrink-0 flex-col" style={{ padding: 0 }}>
            {sectionTitle(<CalendarClock size={14} strokeWidth={1.5} />, '今日动作清单', 'TODAY ACTIONS')}
            {data.todayActions.length === 0 ? (
              <div className={cx('py-5 text-center text-xs font-light', textFaint)}>无逾期或今日到期款项。</div>
            ) : (
              <div className="space-y-1 px-2 pb-2 pt-1.5 text-xs">
                {data.todayActions.map(a => (
                  <div key={a.invoiceId} className={cx('grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px_130px_110px] items-center rounded-control px-3 py-2', rowBg)}>
                    <div className={cx('truncate font-light', textPrimary)}>{a.counterparty ?? '—'}</div>
                    <div className={cx('truncate font-light', textSecondary)}>
                      {a.type === 'Receivable' ? '应收' : '应付'} · {a.invoiceNumber}
                    </div>
                    <div className="text-right">{overdueBadge(a.daysOverdue)}</div>
                    <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(a.openAmount, a.currency)}</div>
                    <div className={cx('text-right text-[11px] font-light tabular-nums', textFaint)}>{a.dueDate}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 区 2：30 天现金流预测（按币种）── */}
          <div className="bds-card flex min-h-0 shrink-0 flex-col" style={{ padding: 0 }}>
            {sectionTitle(<Coins size={14} strokeWidth={1.5} />, `${data.days} 天现金流预测`, 'CASH FLOW FORECAST')}
            {data.forecast.length === 0 ? (
              <div className={cx('py-5 text-center text-xs font-light', textFaint)}>窗口内无到期款项。</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-3">
                {data.forecast.map(f => (
                  <div key={f.currency} className={cx('rounded-card border px-4 py-3', divider, rowBg)}>
                    <div className={cx('flex items-baseline justify-between')}>
                      <span className={cx('text-sm font-light', textPrimary)}>{f.currency}</span>
                      <span className={cx('text-[10px] font-light', textFaint)}>{f.itemCount} 张未结清</span>
                    </div>
                    <div className={cx('mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-light tabular-nums')}>
                      <span className={textSecondary}>应收到期</span>
                      <span className={cx('text-right', textPrimary)}>{formatAmount(f.windowInflow, f.currency)}</span>
                      <span className={textSecondary}>应付到期</span>
                      <span className={cx('text-right', textPrimary)}>{formatAmount(f.windowOutflow, f.currency)}</span>
                      <span className={textSecondary}>窗口净额</span>
                      <span className={cx('text-right font-normal', f.netWindow >= 0 ? 'text-[var(--text-primary)]' : 'text-[var(--status-danger-text,var(--text-primary))]')}>
                        {f.netWindow >= 0 ? '+' : ''}{formatAmount(f.netWindow, f.currency)}
                      </span>
                      {f.overdueInflow > 0 && (
                        <>
                          <span className={textFaint}>已逾期未收</span>
                          <span className={cx('text-right', textSecondary)}>{formatAmount(f.overdueInflow, f.currency)}</span>
                        </>
                      )}
                      {f.overdueOutflow > 0 && (
                        <>
                          <span className={textFaint}>已逾期未付</span>
                          <span className={cx('text-right', textSecondary)}>{formatAmount(f.overdueOutflow, f.currency)}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* 未来到期日程（紧凑列表） */}
            {data.upcoming.length > 0 && (
              <div className={cx('max-h-44 space-y-1 overflow-y-auto border-t px-2 py-2 text-xs', divider)}>
                {data.upcoming.map(u => (
                  <div key={u.invoiceId} className={cx('grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1.2fr)_130px] items-center rounded-control px-3 py-1.5', rowBg)}>
                    <div className={cx('text-[11px] font-light tabular-nums', textSecondary)}>{u.dueDate}</div>
                    <div className={cx('truncate font-light', textPrimary)}>{u.counterparty ?? '—'}</div>
                    <div className={cx('truncate font-light', textFaint)}>{u.type === 'Receivable' ? '应收' : '应付'} · {u.invoiceNumber}</div>
                    <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(u.openAmount, u.currency)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 区 3 + 4：外汇敞口 / 预收款保证金泳道 ── */}
          <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="bds-card flex flex-col" style={{ padding: 0 }}>
              {sectionTitle(<Globe2 size={14} strokeWidth={1.5} />, '外汇敞口', 'FX EXPOSURE')}
              {data.fxExposure.length === 0 ? (
                <div className={cx('py-5 text-center text-xs font-light', textFaint)}>无非本位币未结清款项。</div>
              ) : (
                <div className="space-y-1 p-3 text-xs">
                  {data.fxExposure.map(fx => (
                    <div key={fx.currency} className={cx('grid grid-cols-[60px_minmax(0,1fr)_minmax(0,1fr)] items-center rounded-control px-3 py-2', rowBg)}>
                      <span className={cx('font-light', textPrimary)}>{fx.currency}</span>
                      <span className={cx('text-right font-light tabular-nums', textPrimary)}>未收 {formatAmount(fx.netReceivable, fx.currency)}</span>
                      <span className={cx('text-right font-light tabular-nums', textSecondary)}>未付 {formatAmount(fx.netPayable, fx.currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bds-card flex flex-col" style={{ padding: 0 }}>
              {sectionTitle(<Wallet size={14} strokeWidth={1.5} />, '预收款 / 保证金（未核销）', 'UNAPPLIED FUNDS')}
              {data.unappliedVouchers.length === 0 ? (
                <div className={cx('py-5 text-center text-xs font-light', textFaint)}>无未核销款项。</div>
              ) : (
                <div className="space-y-1 p-3 text-xs">
                  {data.unappliedVouchers.map(u => (
                    <div key={`${u.voucherCategory}-${u.currency}`} className={cx('grid grid-cols-[minmax(0,1fr)_60px_minmax(0,1fr)_50px] items-center rounded-control px-3 py-2', rowBg)}>
                      <span className={cx('truncate font-light', textPrimary)}>{VOUCHER_CATEGORY_LABELS[u.voucherCategory] ?? u.voucherCategory}</span>
                      <span className={cx('text-center text-[11px] font-light', textFaint)}>{u.currency}</span>
                      <span className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(u.unapplied, u.currency)}</span>
                      <span className={cx('text-right text-[11px] font-light', textFaint)}>{u.count} 笔</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
