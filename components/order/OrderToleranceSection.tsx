/**
 * OrderToleranceSection — REQ2-03 溢短装校验视图（订单详情）
 *
 * 设计真源：需求池 REQ2-03 ·「发货/开票数量按条款校验超限预警」
 *
 * 数据源：GET /v1/orders/:id/tolerance-status（toleranceService 单一真源）
 *   - 每行：合同量 vs 已发量，±N% 条款区间校验（verdict: ok/over_limit/under_limit）
 *   - 未发货行不做判定（发货启动后才触发条款）
 *   - 超限行展示预警文案 + 条款上限口径结算额（协商参考）
 *
 * 设计：flat 无阴影、SidePanelContainer + OrderSectionHeader（订单域统一分区头）、
 * tabular-nums 数字对齐、bds-badge 语义变体。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import type { OrderToleranceStatus } from '../../types';
import { fetchOrderToleranceStatus } from '../../services/orderLineService';
import SidePanelContainer from '../ui/SidePanelContainer';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import OrderSectionHeader from './OrderSectionHeader';
import { createOrderUiSpec } from './orderUiSpec';

interface OrderToleranceSectionProps {
  orderId: string;
  isDarkMode?: boolean;
  /** Currency code for settlement amount columns. */
  currency?: string;
  /** 行保存后自增，触发重取（shipmentQuantity/tolerancePercent 变更刷新）。 */
  refreshKey?: number;
}

/** verdict → bds-badge 变体 + 中文标签 */
function verdictBadge(verdict: string, unshipped: boolean): { cls: string; label: string } {
  if (unshipped) return { cls: 'bds-badge sm neutral', label: '未发货' };
  if (verdict === 'over_limit') return { cls: 'bds-badge sm danger', label: '溢装超限' };
  if (verdict === 'under_limit') return { cls: 'bds-badge sm warning', label: '短装超限' };
  return { cls: 'bds-badge sm success', label: '限额内' };
}

function fmtQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

const OrderToleranceSection: React.FC<OrderToleranceSectionProps> = ({ orderId, isDarkMode = false, currency, refreshKey = 0 }) => {
  const orderSpec = createOrderUiSpec(isDarkMode);
  const tableHeaderClass = BAMBOOK_OS.controls.table.header;
  const tableRowHoverClass = BAMBOOK_OS.controls.table.rowHover;
  const tableRowDividerClass = 'divide-[var(--border-c-subtle)]';
  const tableCellBorderClass = BAMBOOK_OS.controls.table.cellBorder;
  const mutedCellClass = BAMBOOK_OS.controls.table.cellMuted;
  const primaryTextClass = orderSpec.textPrimary;
  const secondaryTextClass = orderSpec.textSecondary;

  const [status, setStatus] = useState<OrderToleranceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await fetchOrderToleranceStatus(orderId));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const summary = status?.summary;
  const hasAlerts = (summary?.overLimit ?? 0) + (summary?.underLimit ?? 0) > 0;

  return (
    <SidePanelContainer
      isDarkMode={isDarkMode}
      materialRole="raisedCard"
      spotlight
      edgeFadeItem
      className="overflow-hidden"
      contentClassName="relative z-10 flex min-w-0 flex-col"
    >
      <header className={`px-4 py-4 border-b ${tableCellBorderClass}`}>
        <OrderSectionHeader
          icon={Scale}
          kicker="Tolerance"
          title="溢短装校验"
          isDarkMode={isDarkMode}
          wrapClassName="flex items-end justify-between gap-4"
          meta={summary ? (
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {summary.overLimit > 0 && <span className="bds-badge sm danger">溢装超限 {summary.overLimit}</span>}
              {summary.underLimit > 0 && <span className="bds-badge sm warning">短装超限 {summary.underLimit}</span>}
              {summary.unshipped > 0 && <span className="bds-badge sm neutral">未发货 {summary.unshipped}</span>}
              {!hasAlerts && summary.total > 0 && <span className="bds-badge sm success">全部限额内</span>}
            </span>
          ) : undefined}
        />
      </header>

      {loading && (
        <div className={`px-4 py-6 text-xs ${orderSpec.textMuted}`}>加载溢短装状态…</div>
      )}
      {!loading && error && (
        <div className="bds-alert warning m-4">
          <span className="text-xs font-light">溢短装状态加载失败：{error}</span>
        </div>
      )}
      {!loading && !error && status && (status.lines.length === 0 ? (
        <div className={`px-4 py-6 text-xs ${orderSpec.textMuted}`}>本订单暂无行明细，无条款校验对象</div>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full table-fixed border-separate border-spacing-0 text-left text-xs ${BAMBOOK_OS.typography.weight.body}`}>
            <colgroup>
              <col className="w-[8%]" />
              <col className="w-[22%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[12%]" />
              <col className="w-[17%]" />
            </colgroup>
            <thead className={`${tableHeaderClass} ${orderSpec.textMuted}`}>
              <tr>
                <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>#</th>
                <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>描述/颜色</th>
                <th className={`px-4 py-3 text-right ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>合同量</th>
                <th className={`px-4 py-3 text-right ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>已发量</th>
                <th className={`px-4 py-3 text-right ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>偏差</th>
                <th className={`px-4 py-3 text-right ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>条款</th>
                <th className={`px-4 py-3 text-right ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>结算额{currency ? ` (${currency})` : ''}</th>
                <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>状态</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${tableRowDividerClass}`}>
              {status.lines.map((l, idx) => {
                const unshipped = l.shippedQty <= 0;
                const badge = verdictBadge(l.check.verdict, unshipped);
                return (
                  <tr key={l.orderLineId} className={`relative transition-[background,color] duration-200 ${tableRowHoverClass}`}>
                    <td className={`px-4 py-3 font-light tabular-nums ${mutedCellClass}`}>{idx + 1}</td>
                    <td className={`px-4 py-3 truncate ${secondaryTextClass}`} title={l.description ?? undefined}>
                      {l.description || l.itemNo || '—'}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${primaryTextClass}`}>
                      {fmtQty(l.contractQty)}{l.unit ? <span className={orderSpec.textMuted}> {l.unit}</span> : null}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${primaryTextClass}`}>
                      {fmtQty(l.shippedQty)}{l.unit ? <span className={orderSpec.textMuted}> {l.unit}</span> : null}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${unshipped ? orderSpec.textMuted : primaryTextClass}`}>
                      {unshipped ? '—' : fmtPct(l.check.deviationPct)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${secondaryTextClass}`}>±{l.tolerancePercent}%</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${secondaryTextClass}`}>
                      {unshipped || l.check.settlementAmount == null ? '—' : fmtAmount(l.check.settlementAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className={`${badge.cls} w-fit`}>{badge.label}</span>
                        {l.check.warning && (
                          <span className={`text-[10px] leading-snug font-light ${orderSpec.textMuted}`}>{l.check.warning}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </SidePanelContainer>
  );
};

export default OrderToleranceSection;
