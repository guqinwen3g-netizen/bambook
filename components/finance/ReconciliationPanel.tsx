/**
 * ReconciliationPanel — W-B 波次 P2-6 客户四单对账工作台（订单↔出运↔开票↔收款）
 *
 * 数据源：/api/v1/reconciliation（reconciliationService）
 *   - 客户维度汇总卡：差异订单数 / 订单·开票·收款总额 / critical·warning·info 计数
 *   - 差异清单表格：severity 色阶（critical 红 / warning 黄 / info 蓝），筛选 + 分页
 *   - 单订单详情抽屉：四单金额/数量/状态对照 + 差异字段 expected→actual + 强制重算
 *
 * 断层拍板口径（与后端 reconciliationService 同源）：
 *   ① 整单开票口径（IOA.batchId 无写入入口，分批开票启用后补 batchId 维度）
 *   ② 币种双源 → 记 currency_mismatch 差异不静默取其一
 *   ③ 收款真源 = InvoiceAllocation；actualPaymentAmount 仅参考（漂移记 info）
 *
 * 设计：flat 无阴影、bds 语义类、字重 ≤300、无 emoji。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, Loader2, RefreshCw } from 'lucide-react';
import {
  reconciliationService,
  DISCREPANCY_TYPE_LABELS,
  SEVERITY_LABELS,
  type CustomerReconciliationSummary,
  type DiscrepancyListItem,
  type DiscrepancySeverity,
  type OrderReconciliation,
} from '../../services/reconciliationService';
import BottomSheet from '../ui/BottomSheet';
import { bdsToast } from '../ui/bdsToast';
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
  const relationDisplayName = (r: Relation) => r.chineseName || r.name;

  // ── 客户维度汇总 ──
  const [customerId, setCustomerId] = useState('');
  const [summary, setSummary] = useState<CustomerReconciliationSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // ── 差异清单 ──
  const [items, setItems] = useState<DiscrepancyListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState<DiscrepancySeverity | ''>('');
  const [listLoading, setListLoading] = useState(false);

  // ── 单订单详情抽屉 ──
  const [detail, setDetail] = useState<OrderReconciliation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSummary = useCallback(async (cid: string) => {
    if (!cid) { setSummary(null); return; }
    setSummaryLoading(true);
    try {
      const data = await reconciliationService.reconcileCustomer(cid, endpoint);
      setSummary(data.summary);
    } catch (e: any) {
      bdsToast.danger(e?.message || '客户对账汇总加载失败');
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [endpoint]);

  const loadList = useCallback(async (nextPage: number, severity: DiscrepancySeverity | '', cid: string) => {
    setListLoading(true);
    try {
      const data = await reconciliationService.listDiscrepancies({
        page: nextPage,
        pageSize: PAGE_SIZE,
        severity,
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
  useEffect(() => { loadList(1, severityFilter, customerId); }, [severityFilter, customerId, loadList]);

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
      loadList(page, severityFilter, customerId);
      if (customerId) loadSummary(customerId);
    } catch (e: any) {
      bdsToast.danger(e?.message || '重算失败');
    } finally {
      setDetailLoading(false);
    }
  }, [detail, endpoint, page, severityFilter, customerId, loadList, loadSummary]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── 客户维度汇总卡 ── */}
      <div className="rounded-inset p-4 bds-inset">
        <div className="flex flex-wrap items-center gap-2">
          <GitCompareArrows size={16} style={{ color: 'var(--text-quaternary)' }} />
          <span className={cx('text-sm font-light', textPrimary)}>客户维度批量对账</span>
          <select
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            className="bds-select sm min-w-40"
            aria-label="选择客户"
          >
            <option value="">全部客户（仅差异清单）</option>
            {customerOptions.map(r => (
              <option key={r.id} value={r.id}>{relationDisplayName(r)}</option>
            ))}
          </select>
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
          <span className={cx('ml-auto text-[11px] font-light', textSecondary)}>
            共 {total} 条 · 第 {page}/{totalPages} 页
          </span>
          <div className="bds-segment">
            <button type="button" disabled={page <= 1 || listLoading} onClick={() => loadList(page - 1, severityFilter, customerId)} className="seg">上一页</button>
            <button type="button" disabled={page >= totalPages || listLoading} onClick={() => loadList(page + 1, severityFilter, customerId)} className="seg">下一页</button>
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
                    className="cursor-pointer border-t transition-colors hover:bg-[var(--recessed-bg)]"
                    style={{ borderColor: 'var(--border-c-soft)' }}
                    onClick={() => openDetail(d.orderId)}
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
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}
