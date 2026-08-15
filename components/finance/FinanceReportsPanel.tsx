/**
 * FinanceReportsPanel — 财务报表面板（Phase B2 + 阶段 F / F2）
 *
 * 五个子视图：
 *   1. 账龄分析 Aging — 应收/应付五桶（未到期/1-30/31-60/61-90/90+），按客户×币种分组
 *   2. 客户对账单 Statement — 期初余额 + 开票/收款流水 + running balance，多币种分节
 *   3. 供应商对账单 Supplier Statement — 应付侧镜像：收票（借）/付款（贷）流水 + running balance
 *   4. 汇率损益 FX Gain/Loss — 核销维度（收款汇率 vs 开票汇率），收益/损失汇总
 *   5. 外汇台账 FX Ledger — 收汇/已结汇/未结汇按币种聚合 + 未结汇凭证清单（F2 外汇核销闭环）
 *
 * 数据源：GET /v1/finance/reports/* + GET /v1/finance/fx-settlements/ledger（只读报表，多币种不折算汇总）
 * 设计：flat 无阴影、RDL 原语、tabular-nums 数字对齐
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, FileText, ArrowLeftRight, Loader2, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { fxSettlementService } from '../../services/fxSettlementService';
import { RdlMetricCard, RdlPill, RdlSurface, RdlToolbar } from '../ui/RDLPrimitives';
import type { AgingBuckets, AgingReport, CustomerStatement, FxGainLossReport, FxLedger, Relation, StatementSection, SupplierStatement } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type ReportTabId = 'aging' | 'statement' | 'supplier-statement' | 'fx' | 'fx-ledger';

const REPORT_TABS: Array<{ id: ReportTabId; label: string; en: string }> = [
  { id: 'aging', label: '账龄分析', en: 'Aging' },
  { id: 'statement', label: '客户对账单', en: 'Statement' },
  { id: 'supplier-statement', label: '供应商对账单', en: 'Supplier' },
  { id: 'fx', label: '汇率损益', en: 'FX Gain/Loss' },
  { id: 'fx-ledger', label: '外汇台账', en: 'FX Ledger' },
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

  // ── 供应商对账单（应付侧镜像）──
  const [supplierRelations, setSupplierRelations] = useState<Relation[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [supFrom, setSupFrom] = useState(firstDayOfMonth());
  const [supTo, setSupTo] = useState(today());
  const [supplierStatement, setSupplierStatement] = useState<SupplierStatement | null>(null);

  // ── 汇率损益 ──
  const [fxFrom, setFxFrom] = useState(firstDayOfMonth());
  const [fxTo, setFxTo] = useState(today());
  const [fx, setFx] = useState<FxGainLossReport | null>(null);

  // ── 外汇台账（F2）──
  const [ledgerFrom, setLedgerFrom] = useState(firstDayOfMonth());
  const [ledgerTo, setLedgerTo] = useState(today());
  const [ledger, setLedger] = useState<FxLedger | null>(null);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-default)]';

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

  const loadSupplierStatement = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    try {
      setSupplierStatement(await apiService.getSupplierStatement({ supplierRelationId: supplierId, from: supFrom || undefined, to: supTo || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [supplierId, supFrom, supTo, endpoint]);

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

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLedger(await fxSettlementService.getFxLedger({ from: ledgerFrom || undefined, to: ledgerTo || undefined }, endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [ledgerFrom, ledgerTo, endpoint]);

  // 初次进入各 tab 时加载
  useEffect(() => {
    if (tab === 'aging' && !aging) loadAging();
    if (tab === 'fx' && !fx) loadFx();
    if (tab === 'fx-ledger' && !ledger) loadLedger();
    if (tab === 'statement' && relations.length === 0) {
      apiService.listRelations(endpoint).then(list => {
        // 方向分组以 category 为准（type 是自由文本子类，如 Fabric Mill）；保留 type 回退兼容旧档案
        const customers = list.filter(r => !r.deletedAt && (r.category === 'Customer' || r.type === 'Customer'));
        setRelations(customers);
        if (customers.length > 0 && !customerId) setCustomerId(customers[0].id);
      }).catch(() => {});
    }
    if (tab === 'supplier-statement' && supplierRelations.length === 0) {
      apiService.listRelations(endpoint).then(list => {
        const suppliers = list.filter(r => !r.deletedAt && (r.category === 'Supplier' || r.type === 'Supplier'));
        setSupplierRelations(suppliers);
        if (suppliers.length > 0 && !supplierId) setSupplierId(suppliers[0].id);
      }).catch(() => {});
    }
  }, [tab, aging, fx, ledger, relations.length, supplierRelations.length, customerId, supplierId, endpoint, loadAging, loadFx, loadLedger]);

  // 客户选定后自动加载对账单
  useEffect(() => {
    if (tab === 'statement' && customerId) loadStatement();
  }, [tab, customerId, loadStatement]);

  // 供应商选定后自动加载对账单
  useEffect(() => {
    if (tab === 'supplier-statement' && supplierId) loadSupplierStatement();
  }, [tab, supplierId, loadSupplierStatement]);

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
              <div key={`${row.customerRelationId ?? row.customerName}-${row.currency}`} className={cx(gridCls, 'items-center rounded-control px-4 py-2.5', 'bg-[var(--recessed-bg)]')}>
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

  // ── 对账单视图（客户/供应商共用，仅借贷列文案与流水类型标签不同）──
  const renderStatementSections = (opts: {
    partyName: string | null;
    partyFallback: string;
    sections: StatementSection[];
    debitLabel: string;
    creditLabel: string;
    creditKindLabel: string;
    emptyText: string;
  }) => (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
      {opts.sections.map(sec => (
        <RdlSurface key={sec.currency} tone="panel" padding="compact" className="flex flex-col">
          <div className={cx('flex items-baseline justify-between border-b px-4 pb-2 pt-2', divider)}>
            <div className={cx('text-xs font-light', textPrimary)}>{opts.partyName ?? opts.partyFallback} · {sec.currency}</div>
            <div className={cx('text-[10px] font-light tabular-nums', textSecondary)}>
              期初 {formatAmount(sec.openingBalance, sec.currency)} → 期末 <span className={textPrimary}>{formatAmount(sec.closingBalance, sec.currency)}</span>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] px-4 pb-1 pt-1.5 text-[10px] font-light tracking-[0.14em]">
            <div className={textSecondary}>日期</div>
            <div className={textSecondary}>单号</div>
            <div className={cx('text-right', textSecondary)}>{opts.debitLabel}</div>
            <div className={cx('text-right', textSecondary)}>{opts.creditLabel}</div>
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
                  <span className={cx('ml-2 text-[10px]', textFaint)}>{t.kind === 'invoice' ? '发票' : opts.creditKindLabel}</span>
                </div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{t.debit > 0 ? formatAmount(t.debit, sec.currency) : '—'}</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{t.credit > 0 ? formatAmount(t.credit, sec.currency) : '—'}</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(t.balance, sec.currency)}</div>
              </div>
            ))}
          </div>
        </RdlSurface>
      ))}
      {opts.sections.length === 0 && (
        <div className={cx('py-6 text-center text-xs font-light', textFaint)}>{opts.emptyText}</div>
      )}
    </div>
  );

  const renderStatement = () => {
    if (!statement) return null;
    return renderStatementSections({
      partyName: statement.customerName,
      partyFallback: '客户',
      sections: statement.sections,
      debitLabel: '开票',
      creditLabel: '收款',
      creditKindLabel: '收款',
      emptyText: '该客户暂无发票/收款记录',
    });
  };

  const renderSupplierStatement = () => {
    if (!supplierStatement) return null;
    return renderStatementSections({
      partyName: supplierStatement.supplierName,
      partyFallback: '供应商',
      sections: supplierStatement.sections,
      debitLabel: '收票',
      creditLabel: '付款',
      creditKindLabel: '付款',
      emptyText: '该供应商暂无应付发票/付款记录',
    });
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
              <div key={row.allocationId} className={cx('grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)] items-center rounded-control px-4 py-2.5', 'bg-[var(--recessed-bg)]')}>
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

  // ── 外汇台账视图（F2）──
  const renderFxLedger = () => {
    if (!ledger) return null;
    const gridCls = 'grid w-full min-w-0 grid-cols-[minmax(0,0.55fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.45fr)_minmax(0,0.7fr)_minmax(0,0.8fr)]';
    const formatRate = (rate: string | null) => (rate == null ? '—' : Number(rate).toFixed(4));
    const formatDiff = (diff: string | null) => {
      if (diff == null) return { text: '—', cls: textFaint };
      const n = Number(diff);
      return { text: `${n >= 0 ? '+' : ''}${formatAmount(n, 'CNY')}`, cls: n >= 0 ? 'text-emerald-400' : 'text-red-400' };
    };
    return (
      <>
        {/* 未结汇余额汇总卡片（待办导向：还有多少外币躺在账上） */}
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          {ledger.rows.map(row => (
            <RdlMetricCard key={row.currency} className="px-4 py-3">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>未结汇余额 · {row.currency}</div>
              <div className={cx('mt-1.5 text-lg font-light tabular-nums', Number(row.unsettledBalance) > 0 ? 'text-amber-400' : textPrimary)}>
                {formatAmount(Number(row.unsettledBalance), row.currency)}
              </div>
              <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>
                期间收汇 {formatAmount(Number(row.receivedTotal), row.currency)} · 已结汇 {formatAmount(Number(row.settledTotal), row.currency)}
              </div>
            </RdlMetricCard>
          ))}
          {ledger.rows.length === 0 && (
            <div className={cx('col-span-full py-6 text-center text-xs font-light', textFaint)}>该期间无外币收汇/结汇记录</div>
          )}
        </div>

        {/* 币种聚合表 */}
        {ledger.rows.length > 0 && (
          <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
            <div className={cx(gridCls, 'px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
              <div>币种</div>
              <div className="text-right">期间收汇</div>
              <div className="text-right">期间结汇</div>
              <div className="text-right">未结汇余额</div>
              <div className="text-right">笔数</div>
              <div className="text-right">加权汇率</div>
              <div className="text-right">汇兑差额估算 (CNY)</div>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
              {ledger.rows.map(row => {
                const diff = formatDiff(row.fxDiffEstimate);
                return (
                  <div key={row.currency} className={cx(gridCls, 'items-center rounded-control px-4 py-2.5', 'bg-[var(--recessed-bg)]')}>
                    <div className={cx('font-light', textPrimary)}>{row.currency}</div>
                    <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(Number(row.receivedTotal), row.currency)}</div>
                    <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(Number(row.settledTotal), row.currency)}</div>
                    <div className={cx('text-right font-light tabular-nums', Number(row.unsettledBalance) > 0 ? 'text-amber-400' : textPrimary)}>
                      {formatAmount(Number(row.unsettledBalance), row.currency)}
                    </div>
                    <div className={cx('text-right font-light tabular-nums', textSecondary)}>{row.settlementCount}</div>
                    <div className={cx('text-right font-light tabular-nums', textSecondary)}>{formatRate(row.weightedAvgSettleRate)}</div>
                    <div className={cx('text-right font-light tabular-nums', diff.cls)}>{diff.text}</div>
                  </div>
                );
              })}
            </div>
          </RdlSurface>
        )}

        {/* 未结汇凭证清单（行动导向） */}
        {ledger.unsettledVouchers.length > 0 && (
          <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
            <div className={cx('flex items-baseline justify-between px-4 pb-2 pt-1')}>
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>未结汇凭证（{ledger.unsettledVouchers.length} 笔待处理）</div>
              <div className={cx('text-[10px] font-light', textFaint)}>可在「收付款」tab 选中凭证后点「结汇」登记</div>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
              {ledger.unsettledVouchers.map(v => (
                <div key={v.voucherId} className={cx('grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] items-center rounded-control px-4 py-2.5', 'bg-[var(--recessed-bg)]')}>
                  <div className={cx('font-light tabular-nums', textSecondary)}>{v.paymentDate}</div>
                  <div className={cx('truncate font-light', textPrimary)}>{v.voucherNumber}</div>
                  <div className={cx('truncate font-light', textSecondary)}>{v.customerName || '—'}</div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(Number(v.voucherAmount), v.currency)}</div>
                  <div className={cx('text-right font-light tabular-nums', 'text-amber-400')}>{formatAmount(Number(v.remainingAmount), v.currency)}</div>
                </div>
              ))}
            </div>
          </RdlSurface>
        )}
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
          {tab === 'supplier-statement' && (
            <>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={cx(inputCls, 'min-w-[160px]')} aria-label="选择供应商">
                {supplierRelations.length === 0 && <option value="">加载供应商...</option>}
                {supplierRelations.map(r => <option key={r.id} value={r.id}>{r.chineseName || r.name}</option>)}
              </select>
              <input type="date" value={supFrom} onChange={e => setSupFrom(e.target.value)} className={inputCls} aria-label="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <input type="date" value={supTo} onChange={e => setSupTo(e.target.value)} className={inputCls} aria-label="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={loadSupplierStatement} className="min-h-8 px-3 text-[11px]">查询</RdlPill>
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
          {tab === 'fx-ledger' && (
            <>
              <input type="date" value={ledgerFrom} onChange={e => setLedgerFrom(e.target.value)} className={inputCls} aria-label="开始日期" />
              <span className={cx('text-[10px]', textFaint)}>至</span>
              <input type="date" value={ledgerTo} onChange={e => setLedgerTo(e.target.value)} className={inputCls} aria-label="结束日期" />
              <RdlPill type="button" active tone="accent" onClick={loadLedger} className="min-h-8 px-3 text-[11px]">查询</RdlPill>
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
          {tab === 'supplier-statement' && renderSupplierStatement()}
          {tab === 'fx' && renderFx()}
          {tab === 'fx-ledger' && renderFxLedger()}
        </>
      )}
    </div>
  );
}

export default FinanceReportsPanel;
