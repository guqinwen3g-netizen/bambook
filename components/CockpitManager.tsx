/**
 * CockpitManager — 经营驾驶舱（Phase C1）
 * 阶段 IA 定位（PRD 24.2）：经营预警入口——应收应付/毛利/汇率损益等「需要行动的信号」。
 * 与 全景看板（全局概览，现状冻结）、报表中心（明细与台账）定位分化，互不渗透。
 *
 * 五个区块：
 *   1. 销售业绩排行 — 业务员 × 币种：订单数 / 销售额 / 回款额
 *   2. 客户贡献度 — 客户 × 币种：销售额 + 同币种内占比条
 *   3. 订单毛利表 — 收入 - 成本 = 毛利 / 毛利率（跨币种订单不计毛利，亏损靠前）
 *   4. 应收应付预警 — 账龄逾期 Top5（复用 B2 aging）
 *   5. 汇率损益汇总 — 核销口径净损益（复用 B2 fx-gain-loss）
 *
 * 数据源：GET /v1/dashboard/cockpit（只读聚合，多币种不折算）
 * 设计：flat 无阴影、RDL 原语、tabular-nums 数字对齐
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, TrendingUp, TrendingDown, Users, UserCheck, Scale, BellRing } from 'lucide-react';
import { apiService } from '../services/apiService';
import { RdlMetricCard, RdlPill, RdlSurface, RdlToolbar } from './ui/RDLPrimitives';
import { PageHeader } from './ui/PageHeader';
import type { BusinessCockpit } from '../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

function formatAmount(amount: number, currency?: string): string {
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : (currency || '');
  return `${sym}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(rate: number | null): string {
  return rate == null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CockpitManagerProps {
  isDarkMode: boolean;
  endpoint?: string;
}

export function CockpitManager({ isDarkMode, endpoint }: CockpitManagerProps) {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BusinessCockpit | null>(null);

  const textPrimary = isDarkMode ? 'text-white/88' : 'text-slate-800/88';
  const textSecondary = isDarkMode ? 'text-white/50' : 'text-slate-500/75';
  const textFaint = isDarkMode ? 'text-white/35' : 'text-slate-400/80';
  const divider = isDarkMode ? 'border-white/8' : 'border-slate-300/30';
  const rowBg = isDarkMode ? 'bg-white/[0.03]' : 'bg-white/40';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiService.getBusinessCockpit({ from: from || undefined, to: to || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [from, to, endpoint]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps — 仅首载，区间变更走「查询」

  const inputCls = cx(
    'h-8 rounded-field border bg-transparent px-2.5 text-[11px] font-light outline-none tabular-nums',
    divider, textPrimary,
  );

  const sectionTitle = (icon: React.ReactNode, zh: string, en: string) => (
    <div className={cx('flex items-center gap-2 border-b px-4 pb-2 pt-2.5', divider)}>
      <span className={textFaint}>{icon}</span>
      <span className={cx('text-xs font-light', textPrimary)}>{zh}</span>
      <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>{en}</span>
    </div>
  );

  // ── 销售业绩排行 ──
  const renderSalesLeaderboard = () => {
    if (!data) return null;
    const grid = 'grid w-full min-w-0 grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,0.8fr))]';
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<UserCheck size={13} strokeWidth={1.4} />, '销售业绩排行', 'SALES LEADERBOARD')}
        <div className={cx(grid, 'px-4 pb-1.5 pt-1.5 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
          <div>业务员</div>
          <div className="text-right">币种</div>
          <div className="text-right">订单数</div>
          <div className="text-right">销售额</div>
          <div className="text-right">已回款</div>
        </div>
        <div className="min-h-0 space-y-1 overflow-y-auto overscroll-contain px-1 pb-2 text-xs">
          {data.salesLeaderboard.length === 0 && (
            <div className={cx('py-5 text-center font-light', textFaint)}>该期间无订单</div>
          )}
          {data.salesLeaderboard.map(row => (
            <div key={`${row.salesPerson}-${row.currency}`} className={cx(grid, 'items-center rounded-control px-3 py-2', rowBg)}>
              <div className={cx('truncate font-light', textPrimary)}>{row.salesPerson}</div>
              <div className={cx('text-right font-light', textFaint)}>{row.currency}</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{row.orderCount}</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(row.salesAmount, row.currency)}</div>
              <div className={cx('text-right font-light tabular-nums', textSecondary)}>{formatAmount(row.collectedAmount, row.currency)}</div>
            </div>
          ))}
        </div>
      </RdlSurface>
    );
  };

  // ── 客户贡献度 ──
  const renderCustomerContribution = () => {
    if (!data) return null;
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<Users size={13} strokeWidth={1.4} />, '客户贡献度', 'CUSTOMER SHARE')}
        <div className="min-h-0 space-y-1 overflow-y-auto overscroll-contain px-3 py-2 text-xs">
          {data.customerContribution.length === 0 && (
            <div className={cx('py-5 text-center font-light', textFaint)}>该期间无订单</div>
          )}
          {data.customerContribution.slice(0, 10).map(row => (
            <div key={`${row.customerRelationId ?? row.customer}-${row.currency}`} className={cx('rounded-control px-2 py-2', rowBg)}>
              <div className="flex items-baseline justify-between gap-2">
                <div className={cx('min-w-0 truncate font-light', textPrimary)}>{row.customer}</div>
                <div className={cx('shrink-0 font-light tabular-nums', textPrimary)}>
                  {formatAmount(row.salesAmount, row.currency)}
                  <span className={cx('ml-2 text-[10px]', textFaint)}>{(row.share * 100).toFixed(1)}%</span>
                </div>
              </div>
              <div className={cx('mt-1.5 h-1 overflow-hidden rounded-full', isDarkMode ? 'bg-white/6' : 'bg-slate-300/30')}>
                <div
                  className="h-full rounded-full bg-[var(--os-vnext-brand-blue)] transition-all duration-500"
                  style={{ width: `${Math.min(row.share * 100, 100)}%` }}
                />
              </div>
              <div className={cx('mt-1 text-[10px] font-light', textFaint)}>{row.currency} · {row.orderCount} 单 · 同币种内占比</div>
            </div>
          ))}
        </div>
      </RdlSurface>
    );
  };

  // ── 订单毛利表 ──
  const renderOrderMargins = () => {
    if (!data) return null;
    const { rows, totals, excludedCount } = data.orderMargins;
    const grid = 'grid w-full min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_repeat(5,minmax(0,0.72fr))]';
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<Scale size={13} strokeWidth={1.4} />, '订单毛利表', 'ORDER MARGIN')}
        <div className={cx(grid, 'px-4 pb-1.5 pt-1.5 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
          <div>订单 / 客户</div>
          <div>产品</div>
          <div className="text-right">收入</div>
          <div className="text-right">成本</div>
          <div className="text-right">毛利</div>
          <div className="text-right">毛利率</div>
          <div className="text-right">交期</div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-1 pb-2 text-xs">
          {rows.length === 0 && (
            <div className={cx('py-5 text-center font-light', textFaint)}>该期间无订单</div>
          )}
          {rows.map(row => (
            <div key={row.orderId} className={cx(grid, 'items-center rounded-control px-3 py-2', rowBg)}>
              <div className="min-w-0">
                <div className={cx('truncate font-light', textPrimary)}>{row.poNumber ?? row.orderId}</div>
                <div className={cx('truncate text-[10px] font-light', textFaint)}>{row.customer} · {row.salesPerson ?? '未分配'}</div>
              </div>
              <div className={cx('truncate font-light', textSecondary)}>{row.product}</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(row.revenue, row.currency)}</div>
              <div className={cx('text-right font-light tabular-nums', textSecondary)}>
                {row.cost == null ? '—' : row.crossCurrency ? <span title="采销币种不一致，毛利不参与合计">跨币种</span> : formatAmount(row.cost, row.currency)}
              </div>
              <div className={cx('text-right font-light tabular-nums', row.margin == null ? textFaint : row.margin >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {row.margin == null ? '—' : `${row.margin >= 0 ? '+' : ''}${formatAmount(row.margin, row.currency)}`}
              </div>
              <div className={cx('text-right font-light tabular-nums', row.marginRate == null ? textFaint : row.marginRate >= 0 ? textPrimary : 'text-red-400')}>
                {formatPct(row.marginRate)}
              </div>
              <div className={cx('text-right font-light tabular-nums', textFaint)}>{row.dueDate}</div>
            </div>
          ))}
        </div>
        {totals.length > 0 && (
          <div className={cx('shrink-0 border-t px-4 py-2 text-[10px] font-light tabular-nums', divider, textSecondary)}>
            {totals.map(t => (
              <span key={t.currency} className="mr-4">
                {t.currency} 合计：收入 {formatAmount(t.revenue, t.currency)} · 毛利 <span className={t.margin >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatAmount(t.margin, t.currency)}</span>（{formatPct(t.marginRate)}，{t.orderCount} 单）
              </span>
            ))}
            {excludedCount > 0 && <span className={textFaint}>另 {excludedCount} 单跨币种/缺成本未计入</span>}
          </div>
        )}
      </RdlSurface>
    );
  };

  // ── 应收应付预警 ──
  const renderArApAlerts = () => {
    if (!data) return null;
    const oneSide = (title: string, side: BusinessCockpit['arApAlerts']['receivable']) => (
      <div className="min-w-0 flex-1">
        <div className={cx('px-4 pt-2 text-[10px] font-light tracking-[0.14em]', textSecondary)}>{title}</div>
        <div className="space-y-1 px-3 py-2 text-xs">
          {side.rows.length === 0 && (
            <div className={cx('py-3 text-center font-light', textFaint)}>无逾期</div>
          )}
          {side.rows.map(row => {
            const overdue = row.buckets.d1_30 + row.buckets.d31_60 + row.buckets.d61_90 + row.buckets.d90plus;
            return (
              <div key={`${title}-${row.customerRelationId ?? row.customerName}-${row.currency}`} className={cx('flex items-center justify-between gap-2 rounded-control px-2 py-1.5', rowBg)}>
                <div className="min-w-0">
                  <div className={cx('truncate font-light', textPrimary)}>{row.customerName}</div>
                  <div className={cx('text-[10px] font-light', row.buckets.d90plus > 0 ? 'text-red-400' : textFaint)}>
                    {row.buckets.d90plus > 0 ? `90 天以上 ${formatAmount(row.buckets.d90plus, row.currency)}` : `${row.currency} · ${row.invoiceCount} 张未清`}
                  </div>
                </div>
                <div className={cx('shrink-0 font-light tabular-nums', 'text-red-400')}>{formatAmount(overdue, row.currency)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<BellRing size={13} strokeWidth={1.4} />, '应收应付预警', 'AR/AP OVERDUE')}
        <div className="flex min-h-0 divide-x divide-transparent">
          {oneSide('应收逾期 TOP5', data.arApAlerts.receivable)}
          {oneSide('应付逾期 TOP5', data.arApAlerts.payable)}
        </div>
      </RdlSurface>
    );
  };

  // ── KPI 行 ──
  const renderKpis = () => {
    if (!data) return null;
    const fxGain = data.fxSummary.totalGainLoss >= 0;
    const arOverdue = data.arApAlerts.receivable.totals;
    const apOverdue = data.arApAlerts.payable.totals;
    return (
      <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
        <RdlMetricCard className="px-4 py-3">
          <div className={cx('flex items-center gap-1.5 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
            {fxGain ? <TrendingUp size={11} strokeWidth={1.4} /> : <TrendingDown size={11} strokeWidth={1.4} />}
            汇兑净{fxGain ? '收益' : '损失'} · {data.fxSummary.baseCurrency}
          </div>
          <div className={cx('mt-1.5 text-lg font-light tabular-nums', fxGain ? 'text-emerald-400' : 'text-red-400')}>
            {fxGain ? '+' : ''}{formatAmount(data.fxSummary.totalGainLoss, data.fxSummary.baseCurrency)}
          </div>
          <div className={cx('mt-1 text-[10px] font-light', textFaint)}>{data.fxSummary.rowCount} 笔核销 · 区间内</div>
        </RdlMetricCard>
        {arOverdue.map(t => (
          <RdlMetricCard key={`ar-${t.currency}`} className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>应收逾期 · {t.currency}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', t.overdue > 0 ? 'text-red-400' : textPrimary)}>{formatAmount(t.overdue, t.currency)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>未收合计 {formatAmount(t.total, t.currency)}</div>
          </RdlMetricCard>
        ))}
        {apOverdue.map(t => (
          <RdlMetricCard key={`ap-${t.currency}`} className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>应付逾期 · {t.currency}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', t.overdue > 0 ? 'text-red-400' : textPrimary)}>{formatAmount(t.overdue, t.currency)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>未付合计 {formatAmount(t.total, t.currency)}</div>
          </RdlMetricCard>
        ))}
        {arOverdue.length === 0 && apOverdue.length === 0 && (
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>账龄预警</div>
            <div className={cx('mt-1.5 text-lg font-light', textPrimary)}>无未清账款</div>
            <div className={cx('mt-1 text-[10px] font-light', textFaint)}>应收/应付均已核销</div>
          </RdlMetricCard>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <PageHeader
        title="经营驾驶舱"
        subtitle="Business Cockpit"
        contextLabel="Sales / Margin / AR-AP / FX"
        isDarkMode={isDarkMode}
      />
      <main className="min-h-0 flex-1 px-5 pb-5">
        <div className="flex h-full min-h-0 flex-col gap-2.5">
          {/* 工具条：区间 + 查询 */}
          <div className="flex min-h-0 shrink-0 items-center gap-2">
            <RdlToolbar density="compact">
              <span className={cx('px-2 text-[10px] font-light tracking-[0.14em]', textSecondary)}>统计区间</span>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} aria-label="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} aria-label="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={load} className="min-h-8 px-4 text-[11px]">查询</RdlPill>
            </RdlToolbar>
            {data && (
              <div className={cx('ml-auto text-[10px] font-light tabular-nums', textFaint)}>
                生成于 {new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false })}
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 size={18} strokeWidth={1.4} className={cx('animate-spin', textFaint)} />
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2">
              <AlertCircle size={18} strokeWidth={1.2} className="text-red-400/70" />
              <div className={cx('text-xs font-light', textSecondary)}>{error}</div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-2.5 overflow-hidden xl:grid-cols-2 xl:grid-rows-[auto_minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="col-span-full">{renderKpis()}</div>
              <div className="min-h-0">{renderSalesLeaderboard()}</div>
              <div className="min-h-0">{renderCustomerContribution()}</div>
              <div className="min-h-0">{renderOrderMargins()}</div>
              <div className="min-h-0">{renderArApAlerts()}</div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default CockpitManager;
