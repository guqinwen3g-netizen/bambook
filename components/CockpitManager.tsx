/**
 * CockpitManager — 经营驾驶舱（Phase C1 + B2 缺口补全）
 * 阶段 IA 定位（PRD 24.2）：经营预警入口——应收应付/毛利/汇率损益等「需要行动的信号」。
 * 与 全景看板（全局概览，现状冻结）、报表中心（明细与台账）定位分化，互不渗透。
 *
 * 九个区块（B2 补全后）：
 *   1. 销售业绩排行 — 业务员 × 币种：订单数 / 销售额 / 回款额 / 回款率
 *   2. 客户贡献度 — 客户 × 币种：销售额 + 同币种内占比条 + 新老客标记 + 最近下单
 *   3. 订单毛利表 — 收入 - 成本 = 毛利 / 毛利率 / 回款率（跨币种订单不计毛利，亏损靠前）
 *   4. 订单状态分布 — 按 status × currency 分组统计
 *   5. 交付预警 — 未完结订单 dueDate 7 天内或已逾期
 *   6. 样品进度预警 — 活跃样衣案件 targetDate 已过未完成
 *   7. 汇率走势趋势 — 近 30 条汇率记录折线图
 *   8. 应收应付预警 — 账龄逾期 Top5（复用 B2 aging）
 *   9. 汇率损益汇总 — 核销口径净损益（复用 B2 fx-gain-loss）
 *
 * 数据源：GET /v1/dashboard/cockpit（只读聚合，多币种不折算）
 * 设计：flat 无阴影、RDL 原语、tabular-nums 数字对齐
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, TrendingUp, TrendingDown, Users, UserCheck, Scale, BellRing, Clock, FlaskConical, BarChart3 } from 'lucide-react';
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
    const grid = 'grid w-full min-w-0 grid-cols-[minmax(0,1.2fr)_repeat(5,minmax(0,0.7fr))]';
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<UserCheck size={13} strokeWidth={1.4} />, '销售业绩排行', 'SALES LEADERBOARD')}
        <div className={cx(grid, 'px-4 pb-1.5 pt-1.5 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
          <div>业务员</div>
          <div className="text-right">币种</div>
          <div className="text-right">订单数</div>
          <div className="text-right">销售额</div>
          <div className="text-right">已回款</div>
          <div className="text-right">回款率</div>
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
              <div className={cx('text-right font-light tabular-nums', row.collectionRate == null ? textFaint : row.collectionRate >= 0.8 ? 'text-emerald-400' : row.collectionRate >= 0.5 ? textPrimary : 'text-amber-400')}>
                {formatPct(row.collectionRate)}
              </div>
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
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className={cx('min-w-0 truncate font-light', textPrimary)}>{row.customer}</div>
                  {row.isNewCustomer && (
                    <span className={cx('shrink-0 rounded-compact px-1 py-0.5 text-[9px] font-light', isDarkMode ? 'bg-emerald-400/15 text-emerald-400' : 'bg-emerald-400/10 text-emerald-600')}>
                      新客
                    </span>
                  )}
                </div>
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
              <div className={cx('mt-1 text-[10px] font-light', textFaint)}>
                {row.currency} · {row.orderCount} 单 · 最近下单 {row.lastOrderDate ?? '—'}
              </div>
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
    const grid = 'grid w-full min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_repeat(6,minmax(0,0.62fr))]';
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
          <div className="text-right">回款率</div>
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
              <div className={cx('text-right font-light tabular-nums', row.collectionRate == null ? textFaint : row.collectionRate >= 0.8 ? 'text-emerald-400' : row.collectionRate >= 0.5 ? textPrimary : 'text-amber-400')}>
                {formatPct(row.collectionRate)}
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

  // ── 订单状态分布 ──
  const renderOrderStatus = () => {
    if (!data) return null;
    const buckets = data.orderStatusDistribution;
    const maxCount = Math.max(...buckets.map(b => b.count), 1);
    const STATUS_COLORS: Record<string, string> = {
      Pending: 'bg-slate-400',
      Confirmed: 'bg-blue-400',
      Production: 'bg-indigo-400',
      Shipping: 'bg-cyan-400',
      Delivered: 'bg-emerald-400',
      Alert: 'bg-red-400',
    };
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<BarChart3 size={13} strokeWidth={1.4} />, '订单状态分布', 'ORDER STATUS')}
        <div className="min-h-0 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-2 text-xs">
          {buckets.length === 0 && (
            <div className={cx('py-5 text-center font-light', textFaint)}>该期间无订单</div>
          )}
          {buckets.map(b => (
            <div key={`${b.status}-${b.currency}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className={cx('inline-block h-2 w-2 rounded-full', STATUS_COLORS[b.status] ?? 'bg-slate-400')} />
                  <span className={cx('font-light', textPrimary)}>{b.status}</span>
                  <span className={cx('text-[10px] font-light', textFaint)}>{b.currency}</span>
                </div>
                <div className={cx('font-light tabular-nums', textPrimary)}>
                  {b.count} 单
                  <span className={cx('ml-2 text-[10px]', textFaint)}>{formatAmount(b.salesAmount, b.currency)}</span>
                </div>
              </div>
              <div className={cx('h-1 overflow-hidden rounded-full', isDarkMode ? 'bg-white/6' : 'bg-slate-300/30')}>
                <div
                  className={cx('h-full rounded-full transition-all duration-500', STATUS_COLORS[b.status] ?? 'bg-slate-400')}
                  style={{ width: `${(b.count / maxCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </RdlSurface>
    );
  };

  // ── 交付预警 ──
  const renderDeliveryAlerts = () => {
    if (!data) return null;
    const alerts = data.deliveryAlerts;
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<Clock size={13} strokeWidth={1.4} />, '交付预警', 'DELIVERY ALERTS')}
        <div className="min-h-0 space-y-1 overflow-y-auto overscroll-contain px-3 py-2 text-xs">
          {alerts.length === 0 && (
            <div className={cx('py-5 text-center font-light', textFaint)}>7 天内无交付预警</div>
          )}
          {alerts.slice(0, 10).map(a => (
            <div key={a.orderId} className={cx('flex items-center justify-between gap-2 rounded-control px-2 py-1.5', rowBg)}>
              <div className="min-w-0">
                <div className={cx('truncate font-light', textPrimary)}>{a.poNumber ?? a.orderId}</div>
                <div className={cx('truncate text-[10px] font-light', textFaint)}>{a.customer} · {a.product}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className={cx('font-light tabular-nums', a.daysUntilDue < 0 ? 'text-red-400' : a.daysUntilDue <= 3 ? 'text-amber-400' : textSecondary)}>
                  {a.daysUntilDue < 0 ? `逾期 ${-a.daysUntilDue} 天` : `${a.daysUntilDue} 天`}
                </div>
                <div className={cx('text-[10px] font-light tabular-nums', textFaint)}>{a.dueDate} · {formatAmount(a.orderAmount, a.currency)}</div>
              </div>
            </div>
          ))}
        </div>
      </RdlSurface>
    );
  };

  // ── 样品进度预警 ──
  const renderSampleAlerts = () => {
    if (!data) return null;
    const alerts = data.sampleProgressAlerts;
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<FlaskConical size={13} strokeWidth={1.4} />, '样品进度预警', 'SAMPLE PROGRESS')}
        <div className="min-h-0 space-y-1 overflow-y-auto overscroll-contain px-3 py-2 text-xs">
          {alerts.length === 0 && (
            <div className={cx('py-5 text-center font-light', textFaint)}>无逾期样衣案件</div>
          )}
          {alerts.slice(0, 10).map(a => (
            <div key={a.caseId} className={cx('flex items-center justify-between gap-2 rounded-control px-2 py-1.5', rowBg)}>
              <div className="min-w-0">
                <div className={cx('truncate font-light', textPrimary)}>{a.caseCode} · {a.caseName}</div>
                <div className={cx('truncate text-[10px] font-light', textFaint)}>
                  {a.customerName ?? '—'} · {a.productName ?? '—'} · 第 {a.currentRound} 轮
                  {a.priority === 'urgent' && <span className="ml-1 text-red-400">紧急</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={cx('font-light tabular-nums text-red-400')}>逾期 {a.daysOverdue} 天</div>
                <div className={cx('text-[10px] font-light', textFaint)}>目标 {a.targetDate}</div>
              </div>
            </div>
          ))}
        </div>
      </RdlSurface>
    );
  };

  // ── 汇率走势趋势 ──
  const renderFxTrend = () => {
    if (!data) return null;
    const points = data.fxTrend.points;
    if (points.length === 0) {
      return (
        <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
          {sectionTitle(<TrendingUp size={13} strokeWidth={1.4} />, '汇率走势', 'FX TREND')}
          <div className={cx('py-5 text-center text-xs font-light', textFaint)}>暂无汇率数据</div>
        </RdlSurface>
      );
    }
    // 按币种分组
    const byCurrency = new Map<string, typeof points>();
    for (const p of points) {
      if (!byCurrency.has(p.currency)) byCurrency.set(p.currency, []);
      byCurrency.get(p.currency)!.push(p);
    }
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-col">
        {sectionTitle(<TrendingUp size={13} strokeWidth={1.4} />, '汇率走势', 'FX TREND')}
        <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain px-3 py-2 text-xs">
          {[...byCurrency.entries()].map(([currency, pts]) => {
            const rates = pts.map(p => p.rate);
            const min = Math.min(...rates);
            const max = Math.max(...rates);
            const range = max - min || 1;
            const w = 100;
            const h = 32;
            const path = pts.map((p, i) => {
              const x = (i / Math.max(pts.length - 1, 1)) * w;
              const y = h - ((p.rate - min) / range) * h;
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
            const lastRate = rates[rates.length - 1];
            const firstRate = rates[0];
            const isUp = lastRate >= firstRate;
            return (
              <div key={currency} className={cx('rounded-control px-2 py-1.5', rowBg)}>
                <div className="flex items-center justify-between">
                  <span className={cx('font-light', textPrimary)}>{currency}/CNY</span>
                  <span className={cx('font-light tabular-nums', isUp ? 'text-emerald-400' : 'text-red-400')}>
                    {lastRate.toFixed(4)}
                    <span className={cx('ml-1 text-[10px]', isUp ? 'text-emerald-400' : 'text-red-400')}>
                      {isUp ? '+' : ''}{(lastRate - firstRate).toFixed(4)}
                    </span>
                  </span>
                </div>
                <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 w-full" preserveAspectRatio="none" style={{ height: h }}>
                  <path d={path} fill="none" stroke={isUp ? 'rgb(74 222 128)' : 'rgb(248 113 113)'} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className={cx('mt-0.5 flex justify-between text-[9px] font-light', textFaint)}>
                  <span>{pts[0].effectiveDate}</span>
                  <span>{pts[pts.length - 1].effectiveDate}</span>
                </div>
              </div>
            );
          })}
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
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-y-auto overscroll-contain xl:grid-cols-2">
              <div className="col-span-full">{renderKpis()}</div>
              <div className="min-h-[200px]">{renderSalesLeaderboard()}</div>
              <div className="min-h-[200px]">{renderCustomerContribution()}</div>
              <div className="col-span-full min-h-[260px]">{renderOrderMargins()}</div>
              <div className="min-h-[180px]">{renderOrderStatus()}</div>
              <div className="min-h-[180px]">{renderFxTrend()}</div>
              <div className="min-h-[180px]">{renderDeliveryAlerts()}</div>
              <div className="min-h-[180px]">{renderSampleAlerts()}</div>
              <div className="col-span-full min-h-[200px]">{renderArApAlerts()}</div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default CockpitManager;
