/**
 * ReconciliationPanel — W-B 波次 P2-6 客户四单对账工作台（订单↔出运↔开票↔收款）
 *                     P2-7 扩展「多币种」子视图（汇率链三段对照 / 锁汇覆盖 / 汇兑损益汇总）
 *
 * 数据源：/api/v1/reconciliation（reconciliationService）
 *   - 客户维度汇总卡：差异订单数 / 订单·开票·收款总额 / critical·warning·info 计数
 *   - 差异清单表格：severity 色阶（critical 红 / warning 黄 / info 蓝），severity+type 筛选 + 分页
 *   - 单订单详情抽屉：四单金额/数量/状态对照 + 差异字段 expected→actual + 强制重算
 *   - 多币种子视图：锁汇覆盖率卡片（按币种）+ 汇兑损益汇总（按币种）+ 订单汇率链入口；
 *     抽屉内汇率链三段对照表（开票日/收付日/结汇日汇率与差异）
 *
 * 断层拍板口径（与后端 reconciliationService 同源）：
 *   ① 整单开票口径（IOA.batchId 无写入入口，分批开票启用后补 batchId 维度）
 *   ② 币种双源 → 记 currency_mismatch 差异不静默取其一
 *   ③ 收款真源 = InvoiceAllocation；actualPaymentAmount 仅参考（漂移记 info）
 *   P2-7 锁汇优先：active FxRateLock（deletedAt null，按订单+币种整单覆盖）为期望汇率，
 *   单据快照与锁定价差异记 info（设计内）
 *
 * 设计：flat 无阴影、bds 语义类、字重 ≤300、无 emoji。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, Loader2, RefreshCw } from 'lucide-react';
import {
  reconciliationService,
  DISCREPANCY_TYPE_LABELS,
  FX_RATE_SOURCE_LABELS,
  FX_SEGMENT_LABELS,
  SEVERITY_LABELS,
  type CustomerReconciliationSummary,
  type DiscrepancyListItem,
  type DiscrepancySeverity,
  type DiscrepancyType,
  type OrderReconciliation,
} from '../../services/reconciliationService';
import BottomSheet from '../ui/BottomSheet';
import CustomSelect from '../ui/CustomSelect';
import { bdsToast } from '../ui/bdsToast';
import RelationPickerCombobox from './RelationPickerCombobox';
import type { Relation } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const textPrimary = 'text-[var(--text-primary)]';
const textSecondary = 'text-[var(--text-tertiary)]';

const SEVERITY_BADGE: Record<DiscrepancySeverity, string> = {
  critical: 'bds-badge sm danger',
  warning: 'bds-badge sm warning',
  info: 'bds-badge sm info',
};

function formatAmount(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined) return '—';
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : (currency || '');
  return `${sym}${Number(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : Number(rate).toFixed(4);
}

function formatSigned(amount: number, currency: string): string {
  return `${amount >= 0 ? '+' : ''}${formatAmount(amount, currency)}`;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  Pending: '待确认',
  Confirmed: '已确认',
  Production: '生产中',
  Shipping: '出运中',
  Delivered: '已交付',
  Alert: '异常',
};

const PAGE_SIZE = 20;

interface ReconciliationPanelProps {
  isDarkMode: boolean;
  endpoint?: string;
  /** 交易对象档案（FinanceManager 已加载，复用避免重复拉取） */
  relations: Relation[];
}

export function ReconciliationPanel({ isDarkMode, endpoint, relations }: ReconciliationPanelProps) {
  const customerOptions = useMemo(
    () => relations.filter(r => !r.deletedAt && (r.category === 'Customer' || r.type === 'Customer')),
    [relations],
  );

  // ── 视图：差异清单 | 多币种（P2-7） ──
  const [view, setView] = useState<'list' | 'fx'>('list');

  // ── 客户维度汇总 ──
  const [customerId, setCustomerId] = useState('');
  const [summary, setSummary] = useState<CustomerReconciliationSummary | null>(null);
  const [customerOrders, setCustomerOrders] = useState<OrderReconciliation[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // ── 差异清单 ──
  const [items, setItems] = useState<DiscrepancyListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState<DiscrepancySeverity | ''>('');
  const [typeFilter, setTypeFilter] = useState<DiscrepancyType | 'fx' | ''>('');
  const [listLoading, setListLoading] = useState(false);

  // ── 单订单详情抽屉 ──
  const [detail, setDetail] = useState<OrderReconciliation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSummary = useCallback(async (cid: string) => {
    if (!cid) { setSummary(null); setCustomerOrders([]); return; }
    setSummaryLoading(true);
    try {
      const data = await reconciliationService.reconcileCustomer(cid, endpoint);
      setSummary(data.summary);
      setCustomerOrders(data.orders);
    } catch (e: any) {
      bdsToast.danger(e?.message || '客户对账汇总加载失败');
      setSummary(null);
      setCustomerOrders([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [endpoint]);

  const loadList = useCallback(async (nextPage: number, severity: DiscrepancySeverity | '', type: DiscrepancyType | 'fx' | '', cid: string) => {
    setListLoading(true);
    try {
      const data = await reconciliationService.listDiscrepancies({
        page: nextPage,
        pageSize: PAGE_SIZE,
        severity,
        type,
        customerRelationId: cid || undefined,
      }, endpoint);
      setItems(data.items);
      setTotal(data.total);
      setPage(data.page);
    } catch (e: any) {
      bdsToast.danger(e?.message || '差异清单加载失败');
    } finally {
      setListLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { loadSummary(customerId); }, [customerId, loadSummary]);
  useEffect(() => { loadList(1, severityFilter, typeFilter, customerId); }, [severityFilter, typeFilter, customerId, loadList]);

  const openDetail = useCallback(async (orderId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await reconciliationService.reconcileOrder(orderId, endpoint);
      setDetail(data);
    } catch (e: any) {
      bdsToast.danger(e?.message || '订单对账详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }, [endpoint]);

  const refreshDetail = useCallback(async () => {
    if (!detail) return;
    setDetailLoading(true);
    try {
      const data = await reconciliationService.refreshOrder(detail.orderId, endpoint);
      setDetail(data);
      bdsToast.success('已重算');
      loadList(page, severityFilter, typeFilter, customerId);
      if (customerId) loadSummary(customerId);
    } catch (e: any) {
      bdsToast.danger(e?.message || '重算失败');
    } finally {
      setDetailLoading(false);
    }
  }, [detail, endpoint, page, severityFilter, typeFilter, customerId, loadList, loadSummary]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // P2-7 多币种子视图：有汇率链活动（三段对照/汇率差异/锁汇）的订单
  const fxOrders = useMemo(
    () => customerOrders.filter(o => (o.fx?.segments?.length ?? 0) > 0 || (o.fxDiscrepancies?.length ?? 0) > 0 || (o.fx?.locks?.length ?? 0) > 0),
    [customerOrders],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── 客户维度汇总卡 ── */}
      <div className="rounded-inset p-4 bds-inset">
        <div className="flex flex-wrap items-center gap-2">
          <GitCompareArrows size={16} style={{ color: 'var(--text-quaternary)' }} />
          <span className={cx('text-sm font-light', textPrimary)}>客户维度批量对账</span>
          <div className="bds-segment">
            {([['list', '差异清单'], ['fx', '多币种']] as Array<['list' | 'fx', string]>).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cx('seg', view === id && 'active')}
              >
                {label}
              </button>
            ))}
          </div>
          {/* R678：客户全量原生 select → 可搜索 combobox（保留「全部客户」空值语义） */}
          <div className="w-56">
            <RelationPickerCombobox
              value={customerId}
              options={customerOptions}
              onChange={id => setCustomerId(id)}
              emptyOptionLabel="全部客户（仅差异清单）"
              placeholder="搜索并选择客户"
              ariaLabel="选择客户"
            />
          </div>
          {summaryLoading && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />}
        </div>
        {summary && (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[11px] font-light', textSecondary)}>差异订单</div>
              <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>
                {summary.discrepancyOrders} / {summary.totalOrders}
              </div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[11px] font-light', textSecondary)}>订单总额</div>
              <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(summary.totalOrderAmount)}</div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[11px] font-light', textSecondary)}>已开票</div>
              <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(summary.totalInvoicedAmount)}</div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[11px] font-light', textSecondary)}>已收款</div>
              <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(summary.totalPaidAmount)}</div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[11px] font-light', textSecondary)}>严重 / 警示</div>
              <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>
                {summary.criticalCount} / {summary.warningCount}
              </div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[11px] font-light', textSecondary)}>提示</div>
              <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>{summary.infoCount}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── 差异清单 ── */}
      {view === 'list' && (
      <div className="rounded-inset p-4 bds-inset flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx('text-sm font-light', textPrimary)}>差异清单</span>
          <div className="bds-segment">
            {([['', '全部'], ['critical', '严重'], ['warning', '警示'], ['info', '提示']] as Array<[DiscrepancySeverity | '', string]>).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSeverityFilter(id)}
                className={cx('seg', severityFilter === id && 'active')}
              >
                {label}
              </button>
            ))}
          </div>
          <CustomSelect
            value={typeFilter}
            onChange={v => setTypeFilter(v as DiscrepancyType | 'fx' | '')}
            className="w-44"
            ariaLabel="差异类型筛选"
            options={[
              { value: '', label: '全部类型' },
              { value: 'quantity_mismatch', label: '数量差异' },
              { value: 'invoice_amount_mismatch', label: '开票差异' },
              { value: 'payment_mismatch', label: '收款差异' },
              { value: 'status_inconsistency', label: '状态不一致' },
              { value: 'currency_mismatch', label: '币种不一致' },
              { value: 'manual_payment_field_drift', label: '手工实收漂移' },
              { value: 'fx', label: '汇率差异（全部三段）' },
              { value: 'fx_order_to_invoice', label: '汇率·订单→开票' },
              { value: 'fx_invoice_to_payment', label: '汇率·开票→收付' },
              { value: 'fx_payment_to_settlement', label: '汇率·收付→结汇' },
            ]}
          />
          <span className={cx('ml-auto text-[11px] font-light', textSecondary)}>
            共 {total} 条 · 第 {page}/{totalPages} 页
          </span>
          <div className="bds-segment">
            <button type="button" disabled={page <= 1 || listLoading} onClick={() => loadList(page - 1, severityFilter, typeFilter, customerId)} className="seg">上一页</button>
            <button type="button" disabled={page >= totalPages || listLoading} onClick={() => loadList(page + 1, severityFilter, typeFilter, customerId)} className="seg">下一页</button>
          </div>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-auto">
          {listLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
            </div>
          ) : items.length === 0 ? (
            <div className={cx('py-10 text-center text-sm font-light', textSecondary)}>
              无差异记录——四单勾稽全部一致
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={cx('text-left text-[11px] font-light', textSecondary)}>
                  <th className="pb-2 pr-3 font-light">级别</th>
                  <th className="pb-2 pr-3 font-light">类型</th>
                  <th className="pb-2 pr-3 font-light">订单</th>
                  <th className="pb-2 pr-3 font-light">客户</th>
                  <th className="pb-2 pr-3 font-light">差异说明</th>
                  <th className="pb-2 font-light">期望 → 实际</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d, idx) => (
                  <tr
                    key={`${d.orderId}-${d.type}-${d.field}-${idx}`}
                    className="cursor-pointer border-t transition-colors hover:bg-[var(--recessed-bg)] focus-visible:bg-[var(--recessed-bg-hover)] focus-visible:outline-none"
                    style={{ borderColor: 'var(--border-c-soft)' }}
                    onClick={() => openDetail(d.orderId)}
                    // R678：键盘可达——Tab 聚焦 + Enter/Space 打开订单对账详情（与点击同路径）
                    tabIndex={0}
                    role="button"
                    aria-label={`查看订单 ${d.orderCode || d.poNumber || d.orderId} 对账详情`}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openDetail(d.orderId);
                      }
                    }}
                  >
                    <td className="py-2 pr-3"><span className={SEVERITY_BADGE[d.severity]}>{SEVERITY_LABELS[d.severity]}</span></td>
                    <td className={cx('py-2 pr-3 font-light', textPrimary)}>{DISCREPANCY_TYPE_LABELS[d.type] || d.type}</td>
                    <td className={cx('py-2 pr-3 font-light tabular-nums', textPrimary)}>{d.orderCode || d.poNumber || d.orderId}</td>
                    <td className={cx('py-2 pr-3 font-light', textSecondary)}>{d.customerName || '—'}</td>
                    <td className={cx('py-2 pr-3 font-light', textSecondary)}>{d.message}</td>
                    <td className={cx('py-2 font-light tabular-nums', textSecondary)}>{d.expected} → {d.actual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      )}

      {/* ── 多币种子视图（P2-7：锁汇覆盖率 + 汇兑损益汇总 + 订单汇率链入口） ── */}
      {view === 'fx' && (
      <div className="rounded-inset p-4 bds-inset flex min-h-0 flex-1 flex-col">
        {!customerId ? (
          <div className={cx('py-10 text-center text-sm font-light', textSecondary)}>
            请先选择客户——多币种对账按客户维度汇总（锁汇覆盖率 / 汇兑损益按币种分组）
          </div>
        ) : (
          <>
            {/* 锁汇覆盖率 + 汇兑损益汇总卡片（按币种分组） */}
            {summary && summary.fxGainLossTotal.length > 0 ? (
              <div className="grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
                {summary.fxGainLossTotal.map(row => (
                  <div key={row.currency} className="rounded-inset p-3 bds-inset">
                    <div className={cx('text-[11px] font-light', textSecondary)}>{row.currency} · 锁汇覆盖率</div>
                    <div className={cx('mt-1 text-sm font-light tabular-nums', row.coveragePct > 0 ? 'text-[var(--success-text)]' : textPrimary)}>
                      {(row.coveragePct * 100).toFixed(1)}%
                    </div>
                    <div className={cx('mt-1 text-[11px] font-light tabular-nums', textSecondary)}>
                      锁定 {formatAmount(row.lockedAmount, row.currency)} / 应收 {formatAmount(row.invoicedAmount, row.currency)}
                    </div>
                    <div className={cx('mt-1 text-[11px] font-light tabular-nums', row.realizedGainLossCny >= 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]')}>
                      已实现汇兑{row.realizedGainLossCny >= 0 ? '收益' : '损失'} {formatSigned(row.realizedGainLossCny, 'CNY')}
                    </div>
                  </div>
                ))}
              </div>
            ) : summary ? (
              <div className={cx('py-2 text-[11px] font-light', textSecondary)}>该客户暂无外币应收（纯 CNY 口径无汇率链）</div>
            ) : null}

            {/* 订单汇率链清单（点击进入抽屉看三段对照表） */}
            <div className="mt-3 min-h-0 flex-1 overflow-auto">
              {summaryLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                </div>
              ) : fxOrders.length === 0 ? (
                <div className={cx('py-10 text-center text-sm font-light', textSecondary)}>
                  无汇率链活动订单（无外币发票 / 收付 / 结汇 / 锁汇记录）
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className={cx('text-left text-[11px] font-light', textSecondary)}>
                      <th className="pb-2 pr-3 font-light">订单</th>
                      <th className="pb-2 pr-3 font-light">币种</th>
                      <th className="pb-2 pr-3 font-light text-right">应收（外币）</th>
                      <th className="pb-2 pr-3 font-light">锁汇</th>
                      <th className="pb-2 pr-3 font-light text-right">已实现损益 (CNY)</th>
                      <th className="pb-2 font-light text-right">汇率差异</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fxOrders.map(o => {
                      return (
                        <tr
                          key={o.orderId}
                          className="cursor-pointer border-t transition-colors hover:bg-[var(--recessed-bg)] focus-visible:bg-[var(--recessed-bg-hover)] focus-visible:outline-none"
                          style={{ borderColor: 'var(--border-c-soft)' }}
                          onClick={() => openDetail(o.orderId)}
                          // R678：键盘可达——Tab 聚焦 + Enter/Space 打开汇率链抽屉（与点击同路径）
                          tabIndex={0}
                          role="button"
                          aria-label={`查看订单 ${o.orderCode || o.poNumber || o.orderId} 汇率链详情`}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openDetail(o.orderId);
                            }
                          }}
                        >
                          <td className={cx('py-2 pr-3 font-light tabular-nums', textPrimary)}>{o.orderCode || o.poNumber || o.orderId}</td>
                          <td className={cx('py-2 pr-3 font-light', textSecondary)}>{o.fx.invoicedByCurrency.map(g => g.currency).join('/') || o.currency || '—'}</td>
                          <td className={cx('py-2 pr-3 font-light text-right tabular-nums', textPrimary)}>
                            {o.fx.invoicedByCurrency.length > 0
                              ? o.fx.invoicedByCurrency.map(g => formatAmount(g.amount, g.currency)).join(' / ')
                              : '—'}
                          </td>
                          <td className="py-2 pr-3">
                            {o.fx.locks.length > 0
                              ? o.fx.locks.map(l => (
                                  <span key={l.id} className="bds-badge sm info mr-1">锁 {l.currency} {formatRate(l.rate)}</span>
                                ))
                              : <span className={cx('text-[11px] font-light', textSecondary)}>—</span>}
                          </td>
                          <td className={cx('py-2 pr-3 font-light text-right tabular-nums', o.fx.realizedGainLossCny >= 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]')}>
                            {formatSigned(o.fx.realizedGainLossCny, o.fx.baseCurrency)}
                          </td>
                          <td className={cx('py-2 font-light text-right tabular-nums', o.fxDiscrepancies.some(d => d.severity === 'critical') ? 'text-[var(--danger-text)]' : textSecondary)}>
                            {o.fxDiscrepancies.length} 条
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {/* ── 单订单对账详情抽屉 ── */}
      <BottomSheet
        isOpen={detailLoading || detail != null}
        onClose={() => setDetail(null)}
        title={detail ? `订单对账 · ${detail.orderCode || detail.poNumber || detail.orderId}` : '订单对账'}
        height="half"
        isDarkMode={isDarkMode}
      >
        {detailLoading && !detail ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : detail ? (
          <div className="flex flex-col gap-3 pb-4">
            <div className="flex items-center gap-2">
              <span className={cx('text-[11px] font-light', textSecondary)}>
                {detail.customerName || '—'} · 状态 {ORDER_STATUS_LABELS[detail.orderStatus] || detail.orderStatus} · 币种 {detail.currency || '—'}
              </span>
              <button
                type="button"
                onClick={refreshDetail}
                disabled={detailLoading}
                className="bds-btn bds-btn-secondary ml-auto"
              >
                <RefreshCw size={14} className={detailLoading ? 'animate-spin' : undefined} />
                强制重算
              </button>
            </div>

            {/* 四单对照 */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="rounded-inset p-3 bds-inset">
                <div className={cx('text-[11px] font-light', textSecondary)}>订单金额</div>
                <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(detail.orderAmount, detail.currency)}</div>
              </div>
              <div className="rounded-inset p-3 bds-inset">
                <div className={cx('text-[11px] font-light', textSecondary)}>出运数量</div>
                <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>
                  {detail.shippedQty} / {detail.orderedQty}{detail.delivered ? ' · 已交付' : ''}
                </div>
              </div>
              <div className="rounded-inset p-3 bds-inset">
                <div className={cx('text-[11px] font-light', textSecondary)}>已开票（{detail.invoiceCount} 张）</div>
                <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(detail.invoicedAmount, detail.currency)}</div>
              </div>
              <div className="rounded-inset p-3 bds-inset">
                <div className={cx('text-[11px] font-light', textSecondary)}>已收款</div>
                <div className={cx('mt-1 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(detail.paidAmount, detail.currency)}</div>
              </div>
            </div>

            {detail.referenceActualPaymentAmount != null && (
              <div className={cx('text-[11px] font-light', textSecondary)}>
                参考：手工实收字段 actualPaymentAmount = {formatAmount(detail.referenceActualPaymentAmount, detail.currency)}（非收款真源，建议废弃）
              </div>
            )}

            {/* 差异明细 */}
            {detail.discrepancies.length === 0 ? (
              <div className={cx('py-4 text-center text-sm font-light', textSecondary)}>四单勾稽一致，无差异</div>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.discrepancies.map((d, idx) => (
                  <div key={`${d.type}-${d.field}-${idx}`} className="rounded-inset p-3 bds-inset">
                    <div className="flex items-center gap-2">
                      <span className={SEVERITY_BADGE[d.severity]}>{SEVERITY_LABELS[d.severity]}</span>
                      <span className={cx('text-sm font-light', textPrimary)}>{DISCREPANCY_TYPE_LABELS[d.type] || d.type}</span>
                      <span className={cx('ml-auto text-[11px] font-light tabular-nums', textSecondary)}>{d.expected} → {d.actual}</span>
                    </div>
                    <div className={cx('mt-1 text-[11px] font-light', textSecondary)}>{d.message}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── P2-7 汇率链三段对照（开票日 / 收付日 / 结汇日汇率与差异） ── */}
            {detail.fx && (detail.fx.segments.length > 0 || detail.fx.locks.length > 0) && (
              <div className="rounded-inset p-3 bds-inset">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx('text-sm font-light', textPrimary)}>汇率链三段对照</span>
                  {detail.fx.locks.map(l => (
                    <span key={l.id} className="bds-badge sm info">锁汇 {l.currency} {formatRate(l.rate)}</span>
                  ))}
                  <span className={cx('ml-auto text-[11px] font-light tabular-nums', detail.fx.realizedGainLossCny >= 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]')}>
                    已实现汇兑{detail.fx.realizedGainLossCny >= 0 ? '收益' : '损失'} {formatSigned(detail.fx.realizedGainLossCny, detail.fx.baseCurrency)}
                  </span>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={cx('text-left text-[11px] font-light', textSecondary)}>
                        <th className="pb-2 pr-3 font-light">阶段</th>
                        <th className="pb-2 pr-3 font-light">单据</th>
                        <th className="pb-2 pr-3 font-light text-right">金额</th>
                        <th className="pb-2 pr-3 font-light text-right">单据汇率</th>
                        <th className="pb-2 pr-3 font-light text-right">期望汇率</th>
                        <th className="pb-2 pr-3 font-light text-right">差异</th>
                        <th className="pb-2 font-light text-right">损益 (CNY)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.fx.segments.map((s, idx) => (
                        <tr key={`${s.stage}-${s.documentId}-${idx}`} className="border-t" style={{ borderColor: 'var(--border-c-soft)' }}>
                          <td className={cx('py-2 pr-3 font-light', textSecondary)}>{FX_SEGMENT_LABELS[s.stage]}</td>
                          <td className={cx('py-2 pr-3 font-light tabular-nums', textPrimary)}>
                            {s.documentNumber}
                            <span className={cx('ml-1.5 text-[10px]', textSecondary)}>{s.currency}</span>
                          </td>
                          <td className={cx('py-2 pr-3 font-light text-right tabular-nums', textPrimary)}>{formatAmount(s.foreignAmount, s.currency)}</td>
                          <td className={cx('py-2 pr-3 font-light text-right tabular-nums', s.documentRate == null ? 'text-[var(--danger-text)]' : textPrimary)}>{formatRate(s.documentRate)}</td>
                          <td className={cx('py-2 pr-3 font-light text-right tabular-nums', textSecondary)}>
                            {formatRate(s.expectedRate)}
                            <span className={cx('ml-1 text-[10px]', textSecondary)}>{FX_RATE_SOURCE_LABELS[s.rateSource]}</span>
                          </td>
                          <td className={cx('py-2 pr-3 font-light text-right tabular-nums', s.variance != null && Math.abs(s.variance) > 1e-6 ? 'text-[var(--warning-text)]' : textSecondary)}>
                            {s.variance != null ? `${s.variance >= 0 ? '+' : ''}${s.variance}` : '—'}
                          </td>
                          <td className={cx('py-2 font-light text-right tabular-nums', s.gainLossCny == null ? textSecondary : s.gainLossCny >= 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]')}>
                            {s.gainLossCny != null ? formatSigned(s.gainLossCny, detail.fx.baseCurrency) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}
