/**
 * FinanceReportsPanel — 财务报表面板（Phase B2 + 阶段 F / F2 + DR-005/DR-033）
 *
 * 七个子视图：
 *   1. 账龄分析 Aging — 应收/应付五桶（未到期/1-30/31-60/61-90/90+），按客户×币种分组
 *   2. 客户对账单 Statement — 期初余额 + 开票/收款流水 + running balance，多币种分节
 *   3. 供应商对账单 Supplier Statement — 应付侧镜像：收票（借）/付款（贷）流水 + running balance
 *   4. 汇率损益 FX Gain/Loss — 核销维度（收款汇率 vs 开票汇率），收益/损失汇总
 *   5. 外汇台账 FX Ledger — 收汇/已结汇/未结汇按币种聚合 + 未结汇凭证清单（F2 外汇核销闭环）
 *   6. 合并利润 Consolidated Profit — DR-005 公司合并视图：抵销内部采购/内部销售，
 *      仅计客户外部收入 + 真实面料成本；合并视图 / 部门视角（DR-043 双口径）切换
 *   7. 内部供料 Internal Supply — DR-033 内部供料单列表：关联服装/面料订单、金额、状态、交付进度
 *
 * 数据源：GET /v1/finance/reports/* + GET /v1/finance/fx-settlements/ledger
 *   + GET /v1/finance/reports/consolidated-profit + GET /v1/internal-trade（只读报表，多币种不折算汇总）
 * 设计：flat 无阴影、RDL 原语、tabular-nums 数字对齐
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, FileText, ArrowLeftRight, Loader2, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { fxSettlementService } from '../../services/fxSettlementService';
import {
  INTERNAL_TRANSFER_STATUSES,
  INTERNAL_TRANSFER_STATUS_LABEL,
  internalTradeService,
  toAmount,
} from '../../services/internalTradeService';
import type {
  ConsolidatedProfitReport,
  InternalTransferListItem,
  InternalTransferStatus,
} from '../../services/internalTradeService';
import { RdlMetricCard, RdlPill, RdlSurface, RdlToolbar } from '../ui/RDLPrimitives';
import type { AgingBuckets, AgingReport, CustomerStatement, FxGainLossReport, FxLedger, Relation, StatementSection, SupplierStatement } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type ReportTabId = 'aging' | 'statement' | 'supplier-statement' | 'fx' | 'fx-ledger' | 'consolidated' | 'internal-trade';

const REPORT_TABS: Array<{ id: ReportTabId; label: string; en: string }> = [
  { id: 'aging', label: '账龄分析', en: 'Aging' },
  { id: 'statement', label: '客户对账单', en: 'Statement' },
  { id: 'supplier-statement', label: '供应商对账单', en: 'Supplier' },
  { id: 'fx', label: '汇率损益', en: 'FX Gain/Loss' },
  { id: 'fx-ledger', label: '外汇台账', en: 'FX Ledger' },
  { id: 'consolidated', label: '合并利润', en: 'Consolidated' },
  { id: 'internal-trade', label: '内部供料', en: 'Internal Supply' },
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

  // ── 合并利润（DR-005）──
  const [consolidated, setConsolidated] = useState<ConsolidatedProfitReport | null>(null);
  const [consolidatedMode, setConsolidatedMode] = useState<'company' | 'department'>('company');

  // ── 内部供料单（DR-033）──
  const [transfers, setTransfers] = useState<InternalTransferListItem[] | null>(null);
  const [transferStatus, setTransferStatus] = useState<InternalTransferStatus | ''>('');
  const [expandedTransferId, setExpandedTransferId] = useState<string | null>(null);

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

  const loadConsolidated = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConsolidated(await internalTradeService.getConsolidatedProfitReport(endpoint));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await internalTradeService.listInternalTransfers(
        { status: transferStatus || undefined, limit: 200 },
        endpoint,
      );
      setTransfers(result.items);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [transferStatus, endpoint]);

  // 初次进入各 tab 时加载
  useEffect(() => {
    if (tab === 'aging' && !aging) loadAging();
    if (tab === 'fx' && !fx) loadFx();
    if (tab === 'fx-ledger' && !ledger) loadLedger();
    if (tab === 'consolidated' && !consolidated) loadConsolidated();
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
  }, [tab, aging, fx, ledger, consolidated, relations.length, supplierRelations.length, customerId, supplierId, endpoint, loadAging, loadFx, loadLedger, loadConsolidated]);

  // 内部供料单：进入 tab 或状态筛选变化时加载
  useEffect(() => {
    if (tab === 'internal-trade') loadTransfers();
  }, [tab, loadTransfers]);

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

  // ── 合并利润视图（DR-005：合并视图 / 部门视角双模式，数据同源服务端聚合投影）──
  const renderConsolidated = () => {
    if (!consolidated) return null;
    const r = consolidated;
    const cur = r.baseCurrency;
    if (r.orders.externalCount === 0 && r.orders.internalCount === 0) {
      return (
        <div className={cx('py-10 text-center text-xs font-light', textFaint)}>
          暂无订单利润表数据 — 合并报表在利润表生成后自动聚合（仅读，不改写任何单据）
        </div>
      );
    }
    const profitCls = (n: number) => (n >= 0 ? 'text-emerald-400' : 'text-red-400');

    // 抵销过程可视化（内部采购合计 / 内部销售合计 / 抵销净额 + 双边口径差异透明披露）
    const renderElimination = () => (
      <RdlSurface tone="panel" padding="compact" className="flex flex-col">
        <div className={cx('border-b px-4 pb-2 pt-2 text-[10px] font-light tracking-[0.14em]', divider, textSecondary)}>
          抵销过程 · Elimination（DR-005 单边口径）
        </div>
        <div className="space-y-1 px-2 py-2 text-xs">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
            <div className={cx('font-light', textPrimary)}>
              内部采购合计
              <span className={cx('ml-2 text-[10px]', textFaint)}>服装部 · 生效内部供料（incoming）</span>
            </div>
            <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.elimination.internalPurchase, cur)}</div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
            <div className={cx('font-light', textPrimary)}>
              内部销售合计
              <span className={cx('ml-2 text-[10px]', textFaint)}>面料部 · 生效内部供料（outgoing）</span>
            </div>
            <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.elimination.internalSales, cur)}</div>
          </div>
          <div className={cx('grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5', 'bg-[var(--recessed-bg)]')}>
            <div className={cx('font-light', textPrimary)}>
              抵销净额
              <span className={cx('ml-2 text-[10px]', textFaint)}>不计入公司收入与成本</span>
            </div>
            <div className={cx('text-right font-light tabular-nums', 'text-amber-400')}>-{formatAmount(r.elimination.amount, cur)}</div>
          </div>
          {r.elimination.discrepancy !== 0 && (
            <div className={cx('rounded-control px-2 py-1.5 text-[10px] font-light', 'text-amber-400')}>
              双边口径不一致披露：内部销售 − 内部采购 = {formatAmount(r.elimination.discrepancy, cur)}（应≈0，请核对内部供料单双边登记）
            </div>
          )}
          <div className={cx('px-2 pt-1 text-[10px] font-light', textFaint)}>
            内部采购价 = 面料部内部销售收入，合并时全额抵销；仅生效（已生效/交付中/已关闭）内部供料单计入
          </div>
        </div>
        {r.unconverted.length > 0 && (
          <div className={cx('border-t px-4 pb-2 pt-2', divider)}>
            <div className={cx('pb-1 text-[10px] font-light tracking-[0.14em]', 'text-amber-400')}>
              未折算内部交易披露（{r.unconverted.length} 笔，排除在抵销外）
            </div>
            <div className="space-y-0.5 text-[11px]">
              {r.unconverted.map(u => (
                <div key={u.transferId} className="flex items-baseline justify-between gap-2">
                  <span className={cx('min-w-0 truncate font-light', textSecondary)}>{u.transferId} · {u.direction === 'incoming' ? '内部采购' : '内部销售'}</span>
                  <span className={cx('shrink-0 font-light tabular-nums', textPrimary)}>{formatAmount(u.amount, u.currency)}</span>
                </div>
              ))}
              <div className={cx('pt-0.5 text-[10px] font-light', textFaint)}>非本位币内部交易，报表不做汇率假设，透明披露</div>
            </div>
          </div>
        )}
      </RdlSurface>
    );

    if (consolidatedMode === 'department') {
      const deptSum = r.departments.garment.profit + r.departments.fabric.profit;
      const identityGap = deptSum - r.consolidatedProfit;
      const departments: Array<{ key: 'garment' | 'fabric'; label: string; en: string; caliber: string }> = [
        { key: 'garment', label: '服装部', en: 'Garment', caliber: '收入含外部客户收入；成本含内部面料采购价（部门利润已扣内部采购）' },
        { key: 'fabric', label: '面料部', en: 'Fabric', caliber: '收入含内部面料销售；成本为真实面料成本（保留内部面料利润）' },
      ];
      return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {departments.map(d => {
              const dept = r.departments[d.key];
              return (
                <RdlSurface key={d.key} tone="panel" padding="compact" className="flex flex-col">
                  <div className={cx('border-b px-4 pb-2 pt-2', divider)}>
                    <div className={cx('text-xs font-light', textPrimary)}>{d.label} · {d.en}</div>
                    <div className={cx('mt-0.5 text-[10px] font-light', textFaint)}>{d.caliber}</div>
                  </div>
                  <div className="space-y-1 px-2 py-2 text-xs">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
                      <div className={cx('font-light', textSecondary)}>部门收入</div>
                      <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(dept.revenue, cur)}</div>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
                      <div className={cx('font-light', textSecondary)}>部门成本</div>
                      <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(dept.cost, cur)}</div>
                    </div>
                    <div className={cx('grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5', 'bg-[var(--recessed-bg)]')}>
                      <div className={cx('font-light', textPrimary)}>部门利润</div>
                      <div className={cx('text-right font-light tabular-nums', profitCls(dept.profit))}>{formatAmount(dept.profit, cur)}</div>
                    </div>
                  </div>
                </RdlSurface>
              );
            })}
          </div>
          <RdlSurface tone="panel" padding="compact" className="flex flex-col">
            <div className={cx('border-b px-4 pb-2 pt-2 text-[10px] font-light tracking-[0.14em]', divider, textSecondary)}>
              恒等式校验 · Σ 部门利润 = 合并利润
            </div>
            <div className="space-y-1 px-2 py-2 text-xs">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
                <div className={cx('font-light', textSecondary)}>Σ 部门利润（服装部 + 面料部）</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(deptSum, cur)}</div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
                <div className={cx('font-light', textSecondary)}>合并利润（抵销后）</div>
                <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.consolidatedProfit, cur)}</div>
              </div>
              <div className={cx('px-2 pt-1 text-[10px] font-light', identityGap === 0 ? 'text-emerald-400' : 'text-amber-400')}>
                {identityGap === 0
                  ? '恒等成立 — 抵销不改变公司利润，仅在部门间重新归属'
                  : `差额披露：${formatAmount(identityGap, cur)}（对应抵销过程的双边口径差异，请核对内部供料单登记）`}
              </div>
            </div>
          </RdlSurface>
          {renderElimination()}
        </div>
      );
    }

    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
        {/* 汇总卡片 */}
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>客户外部收入 · {cur}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', textPrimary)}>{formatAmount(r.consolidatedRevenue, cur)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>外部订单 {r.orders.externalCount} 张（内部面料销售不计入）</div>
          </RdlMetricCard>
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>合并成本 · {cur}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', textPrimary)}>{formatAmount(r.consolidatedCost, cur)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>含真实面料成本 {formatAmount(r.costBreakdown.realFabricCost, cur)}</div>
          </RdlMetricCard>
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>公司利润（抵销后）· {cur}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', profitCls(r.consolidatedProfit))}>{formatAmount(r.consolidatedProfit, cur)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>外部收入 − 合并成本</div>
          </RdlMetricCard>
          <RdlMetricCard className="px-4 py-3">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>合并抵销额 · {cur}</div>
            <div className={cx('mt-1.5 text-lg font-light tabular-nums', 'text-amber-400')}>-{formatAmount(r.elimination.amount, cur)}</div>
            <div className={cx('mt-1 text-[10px] font-light tabular-nums', textFaint)}>内部面料订单 {r.orders.internalCount} 张参与抵销</div>
          </RdlMetricCard>
        </div>

        {/* 成本构成 + 抵销过程 */}
        <RdlSurface tone="panel" padding="compact" className="flex flex-col">
          <div className={cx('border-b px-4 pb-2 pt-2 text-[10px] font-light tracking-[0.14em]', divider, textSecondary)}>
            合并成本构成 · Cost Breakdown
          </div>
          <div className="space-y-1 px-2 py-2 text-xs">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
              <div className={cx('font-light', textPrimary)}>
                外部采购成本
                <span className={cx('ml-2 text-[10px]', textFaint)}>已剔除内部采购加价</span>
              </div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.costBreakdown.externalPurchaseNetOfInternal, cur)}</div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
              <div className={cx('font-light', textPrimary)}>
                真实面料成本
                <span className={cx('ml-2 text-[10px]', textFaint)}>内部面料订单自身采购成本</span>
              </div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.costBreakdown.realFabricCost, cur)}</div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
              <div className={cx('font-light', textSecondary)}>运费</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.costBreakdown.freightCost, cur)}</div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5">
              <div className={cx('font-light', textSecondary)}>杂费</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.costBreakdown.miscCost, cur)}</div>
            </div>
            <div className={cx('grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] items-center rounded-control px-2 py-1.5', 'bg-[var(--recessed-bg)]')}>
              <div className={cx('font-light', textPrimary)}>合并成本合计</div>
              <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(r.consolidatedCost, cur)}</div>
            </div>
          </div>
        </RdlSurface>
        {renderElimination()}
      </div>
    );
  };

  // ── 内部供料单视图（DR-033：双向关联独立核算，列表仅 incoming 主单）──
  const renderTransfers = () => {
    if (!transfers) return null;
    const gridCls = 'grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.6fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)]';
    const statusCls = (s: InternalTransferStatus | undefined): string => {
      switch (s) {
        case 'PendingConfirm': return 'text-amber-400';
        case 'Effective': return 'text-emerald-400';
        case 'Delivering': return 'text-amber-400';
        case 'Closed': return textPrimary;
        case 'Cancelled': return 'text-red-400';
        default: return textFaint;
      }
    };
    return (
      <RdlSurface tone="panel" padding="compact" className="flex min-h-0 flex-1 flex-col">
        <div className={cx(gridCls, 'px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
          <div>供料单号</div>
          <div>物料</div>
          <div className="text-right">数量</div>
          <div className="text-right">结算价</div>
          <div className="text-right">金额</div>
          <div>服装订单</div>
          <div>面料订单</div>
          <div>交期</div>
          <div>状态</div>
          <div className="text-right">交付进度</div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
          {transfers.length === 0 && (
            <div className={cx('py-6 text-center font-light', textFaint)}>
              {transferStatus ? `暂无「${INTERNAL_TRANSFER_STATUS_LABEL[transferStatus]}」状态的内部供料单` : '暂无内部供料单 — 由服装部基于服装订单发起，经结算价审批与面料部确认后生效'}
            </div>
          )}
          {transfers.map(({ record, payload }) => {
            const amount = toAmount(record.transferAmount);
            const delivered = payload ? payload.deliveries.reduce((acc, d) => acc + d.quantity, 0) : 0;
            const confirmedQty = payload ? (payload.confirmedQuantity ?? payload.quantity) : 0;
            const expanded = expandedTransferId === record.id;
            return (
              <div key={record.id} className={cx('rounded-control', 'bg-[var(--recessed-bg)]')}>
                <button
                  type="button"
                  onClick={() => setExpandedTransferId(expanded ? null : record.id)}
                  className={cx(gridCls, 'w-full items-center px-4 py-2.5 text-left')}
                  aria-expanded={expanded}
                >
                  <div className={cx('truncate font-light', textPrimary)}>{record.id}</div>
                  <div className={cx('truncate font-light', textPrimary)}>{payload?.materialCode ?? '—'}</div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>
                    {payload ? `${payload.quantity.toLocaleString('zh-CN')} ${payload.unit}` : '—'}
                  </div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>
                    {payload ? formatAmount(payload.settlementPrice, record.transferCurrency) : '—'}
                  </div>
                  <div className={cx('text-right font-light tabular-nums', textPrimary)}>{formatAmount(amount, record.transferCurrency)}</div>
                  <div className={cx('truncate font-light', textSecondary)}>{payload?.garmentOrderId ?? record.orderId}</div>
                  <div className={cx('truncate font-light', textSecondary)}>{payload?.fabricOrderId ?? '—'}</div>
                  <div className={cx('font-light tabular-nums', textSecondary)}>{payload?.dueDate ?? record.transferDate}</div>
                  <div className={cx('font-light', statusCls(payload?.status))}>
                    {payload ? INTERNAL_TRANSFER_STATUS_LABEL[payload.status] : (record.recognizedAt ? '已认账（历史）' : '未生效（历史）')}
                  </div>
                  <div className={cx('text-right font-light tabular-nums', textSecondary)}>
                    {payload ? `${delivered.toLocaleString('zh-CN')} / ${confirmedQty.toLocaleString('zh-CN')} ${payload.unit}` : '—'}
                  </div>
                </button>
                {expanded && payload && (
                  <div className={cx('mx-2 mb-2 space-y-2 rounded-control px-3 py-2', 'bg-[var(--hover-darken)]')}>
                    <div className={cx('grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-light xl:grid-cols-4', textSecondary)}>
                      <div>申请部门：<span className={textPrimary}>{payload.requestDepartmentId}</span></div>
                      <div>供料部门：<span className={textPrimary}>{payload.supplyDepartmentId}</span></div>
                      <div>结算价审批单：<span className={textPrimary}>{payload.settlementApprovalId}</span></div>
                      <div>
                        确认数量/交期：
                        <span className={textPrimary}>
                          {payload.confirmedQuantity !== null ? `${payload.confirmedQuantity.toLocaleString('zh-CN')} ${payload.unit}` : '—'}
                          {' / '}{payload.confirmedDueDate ?? '—'}
                        </span>
                      </div>
                    </div>
                    {payload.deliveries.length > 0 && (
                      <div>
                        <div className={cx('pb-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>交付记录（分批出运/到货/差异）</div>
                        <div className="space-y-0.5">
                          {payload.deliveries.map(d => (
                            <div key={d.id} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.5fr)] items-center px-1 py-1 text-[11px]">
                              <div className={cx('font-light tabular-nums', textSecondary)}>{d.deliveryDate}</div>
                              <div className={cx('truncate font-light', textPrimary)}>{d.shipmentNumber ?? d.shipmentId}</div>
                              <div className={cx('text-right font-light tabular-nums', textPrimary)}>出运 {d.quantity.toLocaleString('zh-CN')}</div>
                              <div className={cx('text-right font-light tabular-nums', textPrimary)}>
                                {d.receivedQuantity !== null ? `到货 ${d.receivedQuantity.toLocaleString('zh-CN')}` : '到货 —'}
                              </div>
                              <div className={cx('text-right font-light tabular-nums', d.variance !== null && d.variance !== 0 ? 'text-amber-400' : textFaint)}>
                                {d.variance !== null ? `差异 ${d.variance >= 0 ? '+' : ''}${d.variance.toLocaleString('zh-CN')}` : '差异 —'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {payload.history.length > 0 && (
                      <div>
                        <div className={cx('pb-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>状态流转</div>
                        <div className="space-y-0.5">
                          {payload.history.map((h, i) => (
                            <div key={`${h.at}-${i}`} className="flex items-baseline gap-2 px-1 py-0.5 text-[11px]">
                              <span className={cx('shrink-0 font-light tabular-nums', textFaint)}>{h.at.slice(0, 16).replace('T', ' ')}</span>
                              <span className={cx('shrink-0 font-light', statusCls(h.to))}>
                                {h.from ? `${INTERNAL_TRANSFER_STATUS_LABEL[h.from]} → ` : ''}{INTERNAL_TRANSFER_STATUS_LABEL[h.to]}
                              </span>
                              <span className={cx('min-w-0 truncate font-light', textSecondary)}>{h.note ?? ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </RdlSurface>
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
          {tab === 'consolidated' && (
            <>
              <RdlPill type="button" active={consolidatedMode === 'company'} onClick={() => setConsolidatedMode('company')} className="min-h-8 px-3 text-[11px]">合并视图</RdlPill>
              <RdlPill type="button" active={consolidatedMode === 'department'} onClick={() => setConsolidatedMode('department')} className="min-h-8 px-3 text-[11px]">部门视角</RdlPill>
              <RdlPill type="button" active tone="accent" onClick={loadConsolidated} className="min-h-8 px-3 text-[11px]">刷新</RdlPill>
            </>
          )}
          {tab === 'internal-trade' && (
            <>
              <select
                value={transferStatus}
                onChange={e => setTransferStatus(e.target.value as InternalTransferStatus | '')}
                className={cx(inputCls, 'min-w-[140px]')}
                aria-label="状态筛选"
              >
                <option value="">全部状态</option>
                {INTERNAL_TRANSFER_STATUSES.map(s => (
                  <option key={s} value={s}>{INTERNAL_TRANSFER_STATUS_LABEL[s]}</option>
                ))}
              </select>
              <RdlPill type="button" active tone="accent" onClick={loadTransfers} className="min-h-8 px-3 text-[11px]">刷新</RdlPill>
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
          {tab === 'consolidated' && renderConsolidated()}
          {tab === 'internal-trade' && renderTransfers()}
        </>
      )}
    </div>
  );
}

export default FinanceReportsPanel;
