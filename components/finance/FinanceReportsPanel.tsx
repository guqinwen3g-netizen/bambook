/**
 * FinanceReportsPanel — 财务报表面板（Phase B2）
 *
 * 三个子视图：
 *   1. 账龄分析 Aging — 应收/应付五桶（未到期/1-30/31-60/61-90/90+），按客户×币种分组
 *   2. 客户对账单 Statement — 期初余额 + 开票/收款流水 + running balance，多币种分节
 *   3. 汇率损益 FX Gain/Loss — 核销维度（收款汇率 vs 开票汇率），收益/损失汇总
 *
 * 数据源：GET /v1/finance/reports/*（只读报表，多币种不折算汇总）
 * 设计：flat 无阴影、RDL 原语、tabular-nums 数字对齐
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, FileText, ArrowLeftRight, Loader2, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { RdlMetricCard, RdlPill, RdlSurface, RdlToolbar } from '../ui/RDLPrimitives';
import type { AgingBuckets, AgingReport, CustomerStatement, FxGainLossReport, Relation } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type ReportTabId = 'aging' | 'statement' | 'fx';

const REPORT_TABS: Array<{ id: ReportTabId; label: string; en: string }> = [
  { id: 'aging', label: '账龄分析', en: 'Aging' },
  { id: 'statement', label: '客户对账单', en: 'Statement' },
  { id: 'fx', label: '汇率损益', en: 'FX Gain/Loss' },
];

function formatAmount(amount: number, currency?: string): string {
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : (currency || '');
  return `${sym}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

interface FinanceReportsPanelProps {
  isDarkMode: boolean;
  endpoint?: string;
}

export function FinanceReportsPanel({ isDarkMode, endpoint }: FinanceReportsPanelProps) {
  const [tab, setTab] = useState<ReportTabId>('aging');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 账龄 ──
  const [agingType, setAgingType] = useState<'Receivable' | 'Payable'>('Receivable');
  const [aging, setAging] = useState<AgingReport | null>(null);

  // ── 对账单 ──
  const [relations, setRelations] = useState<Relation[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [stmtFrom, setStmtFrom] = useState(firstDayOfMonth());
  const [stmtTo, setStmtTo] = useState(today());
  const [statement, setStatement] = useState<CustomerStatement | null>(null);

  // ── 汇率损益 ──
  const [fxFrom, setFxFrom] = useState(firstDayOfMonth());
  const [fxTo, setFxTo] = useState(today());
  const [fx, setFx] = useState<FxGainLossReport | null>(null);

  const textPrimary = isDarkMode ? 'text-white/88' : 'text-slate-800/88';
  const textSecondary = isDarkMode ? 'text-white/50' : 'text-slate-500/75';
  const textFaint = isDarkMode ? 'text-white/35' : 'text-slate-400/80';
  const divider = isDarkMode ? 'border-white/8' : 'border-slate-300/30';

  // ── 数据加载 ──
  const loadAging = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAging(await apiService.getAgingReport(agingType, undefined, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [agingType, endpoint]);

  const loadStatement = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      setStatement(await apiService.getCustomerStatement({ customerRelationId: customerId, from: stmtFrom || undefined, to: stmtTo || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [customerId, stmtFrom, stmtTo, endpoint]);

  const loadFx = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFx(await apiService.getFxGainLoss({ from: fxFrom || undefined, to: fxTo || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [fxFrom, fxTo, endpoint]);

  // 初次进入各 tab 时加载
  useEffect(() => {
    if (tab === 'aging' && !aging) loadAging();
    if (tab === 'fx' && !fx) loadFx();
    if (tab === 'statement' && relations.length === 0) {
      apiService.listRelations(endpoint).then(list => {
        const customers = list.filter(r => r.type === 'Customer' && !r.deletedAt);
        setRelations(customers);
        if (customers.length > 0 && !customerId) setCustomerId(customers[0].id);
      }).catch(() => {});
    }
  }, [tab, aging, fx, relations.length, customerId, endpoint, loadAging, loadFx]);

  // 客户选定后自动加载对账单
  useEffect(() => {
    if (tab === 'statement' && customerId) loadStatement();
  }, [tab, customerId, loadStatement]);

  const inputCls = cx(
    'h-8 rounded-field border bg-transparent px-2.5 text-[11px] font-light outline-none tabular-nums',
    divider, textPrimary,
  );

  // ── 账龄视图 ──
  const renderAging = () => {
    if (!aging) return null;
    const bucketCols: Array<{ key: keyof AgingBuckets; label: string }> = [
      { key: 'current', label: '未到期' },
      { key: 'd1_30', label: '1-30 天' },
      { key: 'd31_60', label: '31-60 天' },
      { key: 'd61_90', label: '61-90 天' },
      { key: 'd90plus', label: '90 天以上' },
    ];
    const gridCls = 'grid w-full min-w-0 grid-cols-[minmax(0,1.4fr)_repeat(6,minmax(0,0.75fr))]';
    return (
      <>
        {/* 汇总卡片 */}
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          {aging.totals.map(t => (
            <RdlMetricCard key={t.currency} className="px-4 py-3">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>
                {agingType === 'Receivable' ? '应收未收' : '应付未付'} · {t.currency}
              </div>
              <div className={cx('mt-1.5 text-lg font-light tabular-nums', textPrimary)}>{formatAmount(t.total, t.currency)}</div>
              <div className={cx('mt-1 text-[10px] font-light tabular-nums', t.d90plus > 0 ? 'text-red-400' : textFaint)}>
                90 天以上 {formatAmount(t.d90plus, t.currency)}
              </div>
            </RdlMetricCard>
          ))}
          {aging.totals.length === 0 && (
            <div className={cx('col-span-full py-6 text-center text-xs font-light', textFaint)}>暂无未核销{agingType === 'Receivable' ? '应收' : '应付'}账款</div>
          )}
        </div>

        {/* 明细表 */}
        <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
          <div className={cx(gridCls, 'px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
            <div>客户 / 币种</div>
            {bucketCols.map(c => <div key={c.key} className="text-right">{c.label}</div>)}
            <div className="text-right">合计</div>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
            {aging.rows.map(row => (
              <div key={`${row.customerRelationId ?? row.customerName}-${row.currency}`} className={cx(gridCls, 'items-center rounded-control px-4 py-2.5', isDarkMode ? 'bg-white/[0.03]' : 'bg-white/40')}>
                <div className="min-w-0">
                  <div className={cx('truncate font-light', textPrimary)}>{row.customerName}</div>
                  <div className={cx('text-[10px] font-light', textFaint)}>{row.currency} · {row.invoiceCount} 张发票</div>
                </div>
                {bucketCols.map(c => (
                  <div key={c.key} className={cx('text-right font-light tabular-nums', row.buckets[c.key] > 0 && c.key === 'd90plus' ? 'text-red-400' : textPrimary)}>
                    {row.buckets[c.key] > 0 ? formatAmount(row.buckets[c.key], row.currency) : '—'}
                  </div>
                ))}
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(row.buckets.total, row.currency)}</div>
              </div>
            ))}
          </div>
        </RdlSurface>
      </>
    );
  };

  // ── 对账单视图 ──
  const renderStatement = () => {
    if (!statement) return null;
    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
        {statement.sections.map(sec => (
          <RdlSurface key={sec.currency} tone="panel" padding="compact" className="flex flex-col">
            <div className={cx('flex items-baseline justify-between border-b px-4 pb-2 pt-2', divider)}>
              <div className={cx('text-xs font-light', textPrimary)}>{statement.customerName ?? '客户'} · {sec.currency}</div>
              <div className={cx('text-[10px] font-light tabular-nums', textSecondary)}>
                期初 {formatAmount(sec.openingBalance, sec.currency)} → 期末 <span className={textPrimary}>{formatAmount(sec.closingBalance, sec.currency)}</span>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] px-4 pb-1 pt-1.5 text-[10px] font-light tracking-[0.14em]">
              <div className={textSecondary}>日期</div>
              <div className={textSecondary}>单号</div>
              <div className={cx('text-right', textSecondary)}>开票</div>
              <div className={cx('text-right', textSecondary)}>收款</div>
              <div className={cx('text-right', textSecondary)}>余额</div>
            </div>
            <div className="space-y-0.5 px-1 pb-2 text-xs">
              {sec.transactions.length === 0 && (
                <div className={cx('py-4 text-center font-light', textFaint)}>该期间无流水</div>
              )}
              {sec.transactions.map((t, i) => (
                <div key={`${t.number}-${i}`} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] items-center rounded-control px-3 py-1.5">
                  <div className={cx('font-light tabular-nums', textSecondary)}>{t.date}</div>
                  <div className={cx('truncate font-light', textPrimary)}>
                    {t.number}
                    <span className={cx('ml-2 text-[10px]', textFaint)}>{t.kind === 'invoice' ? '发票' : '收款'}</span>
                  </div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>{t.debit > 0 ? formatAmount(t.debit, sec.currency) : '—'}</div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>{t.credit > 0 ? formatAmount(t.credit, sec.currency) : '—'}</div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(t.balance, sec.currency)}</div>
                </div>
              ))}
            </div>
          </RdlSurface>
        ))}
        {statement.sections.length === 0 && (
          <div className={cx('py-6 text-center text-xs font-light', textFaint)}>该客户暂无发票/收款记录</div>
        )}
      </div>
    );
  };

  // ── 汇率损益视图 ──
  const renderFx = () => {
    if (!fx) return null;
    const isGain = fx.totalGainLoss >= 0;
    return (
      <>
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>汇兑净{isGain ? '收益' : '损失'} · {fx.baseCurrency}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', isGain ? 'text-emerald-400' : 'text-red-400')}>
              {isGain ? '+' : ''}{formatAmount(fx.totalGainLoss, fx.baseCurrency)}
            </div>
            <div className={cx('mt-1 text-[10px] font-light', textFaint)}>{fx.rows.length} 笔核销</div>
          </RdlMetricCard>
        </div>
        <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
          <div className={cx('grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)] px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
            <div>核销日期</div>
            <div>发票</div>
            <div>凭证</div>
            <div className="text-right">核销额</div>
            <div className="text-right">开票汇率</div>
            <div className="text-right">收付汇率</div>
            <div className="text-right">损益 ({fx.baseCurrency})</div>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
            {fx.rows.map(row => (
              <div key={row.allocationId} className={cx('grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)] items-center rounded-control px-4 py-2.5', isDarkMode ? 'bg-white/[0.03]' : 'bg-white/40')}>
                <div className={cx('font-light tabular-nums', textSecondary)}>{row.appliedDate}</div>
                <div className={cx('truncate font-light', textPrimary)}>
                  {row.invoiceNumber}
                  <span className={cx('ml-1.5 text-[10px]', textFaint)}>{row.invoiceType === 'Payable' ? '应付' : '应收'}</span>
                </div>
                <div className={cx('truncate font-light', textPrimary)}>{row.voucherNumber}</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(row.appliedAmount, row.currency)}</div>
                <div className={cx('text-right font-light tabular-nums', textSecondary)}>{row.invoiceRate}</div>
                <div className={cx('text-right font-light tabular-nums', textSecondary)}>{row.voucherRate}</div>
                <div className={cx('text-right font-light tabular-nums', row.gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {row.gainLoss >= 0 ? '+' : ''}{formatAmount(row.gainLoss, fx.baseCurrency)}
                </div>
              </div>
            ))}
            {fx.rows.length === 0 && (
              <div className={cx('py-6 text-center font-light', textFaint)}>该期间无含双边汇率的核销记录</div>
            )}
          </div>
        </RdlSurface>
      </>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {/* 子 tab + 过滤器 */}
      <div className="flex min-h-0 shrink-0 items-center gap-2">
        <RdlToolbar density="compact">
          {REPORT_TABS.map(t => (
            <RdlPill key={t.id} type="button" onClick={() => setTab(t.id)} active={tab === t.id} className="min-h-8 px-4 text-[11px]">
              {t.label}
            </RdlPill>
          ))}
        </RdlToolbar>
        <div className="ml-auto flex items-center gap-2">
          {tab === 'aging' && (
            <>
              <RdlPill type="button" active={agingType === 'Receivable'} onClick={() => setAgingType('Receivable')} className="min-h-8 px-3 text-[11px]">应收</RdlPill>
              <RdlPill type="button" active={agingType === 'Payable'} onClick={() => setAgingType('Payable')} className="min-h-8 px-3 text-[11px]">应付</RdlPill>
              <RdlPill type="button" active tone="accent" onClick={loadAging} className="min-h-8 px-3 text-[11px]">刷新</RdlPill>
            </>
          )}
          {tab === 'statement' && (
            <>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} className={cx(inputCls, 'min-w-[160px]')} aria-label="选择客户">
                {relations.length === 0 && <option value="">加载客户...</option>}
                {relations.map(r => <option key={r.id} value={r.id}>{r.chineseName || r.name}</option>)}
              </select>
              <input type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)} className={inputCls} aria-label="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <input type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)} className={inputCls} aria-label="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={loadStatement} className="min-h-8 px-3 text-[11px]">查询</RdlPill>
            </>
          )}
          {tab === 'fx' && (
            <>
              <input type="date" value={fxFrom} onChange={e => setFxFrom(e.target.value)} className={inputCls} aria-label="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <input type="date" value={fxTo} onChange={e => setFxTo(e.target.value)} className={inputCls} aria-label="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={loadFx} className="min-h-8 px-3 text-[11px]">查询</RdlPill>
            </>
          )}
        </div>
      </div>

      {/* 内容区 */}
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
        <>
          {tab === 'aging' && renderAging()}
          {tab === 'statement' && renderStatement()}
          {tab === 'fx' && renderFx()}
        </>
      )}
    </div>
  );
}

export default FinanceReportsPanel;
