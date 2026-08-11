import React from 'react';
import type { OrderLineLite } from '../../types';
import SidePanelContainer from '../ui/SidePanelContainer';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import OrderSectionHeader from './OrderSectionHeader';
import { createOrderUiSpec } from './orderUiSpec';
import { formatYmd } from '../../lib/dateFormat';

interface OrderLinesTableProps {
  lines: OrderLineLite[] | undefined;
  isDarkMode?: boolean;
  /** Currency code for the unitPrice / netValue columns. */
  currency?: string;
}

/**
 * Renders every line in `Order.lines` as a wide table row. Replaces the
 * older "show line[0] only" pattern that hid multi-row POs in the detail
 * card. All columns map directly onto `OrderLineLite` fields.
 */
const OrderLinesTable: React.FC<OrderLinesTableProps> = ({ lines, isDarkMode = false, currency }) => {
  const orderSpec = createOrderUiSpec(isDarkMode);
  const tableHeaderClass = isDarkMode ? BAMBOOK_OS.controls.table.headerDark : BAMBOOK_OS.controls.table.headerLight;
  const tableRowHoverClass = isDarkMode ? BAMBOOK_OS.controls.table.rowHoverDark : BAMBOOK_OS.controls.table.rowHoverLight;
  // 亮色模式用 slate-200/45（原 divide-white/45 是笔误：白色 45% 透明度叠在浅色背景上不可见）
  const tableRowDividerClass = isDarkMode ? 'divide-white/[0.045]' : 'divide-slate-200/45';
  const tableCellBorderClass = isDarkMode ? BAMBOOK_OS.controls.table.cellBorderDark : BAMBOOK_OS.controls.table.cellBorderLight;
  const quietTextClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const mutedCellClass = isDarkMode ? BAMBOOK_OS.controls.table.cellMutedDark : BAMBOOK_OS.controls.table.cellMutedLight;
  const primaryTextClass = orderSpec.textPrimary;
  const secondaryTextClass = orderSpec.textSecondary;

  if (!lines || lines.length === 0) {
    return (
      <SidePanelContainer
        isDarkMode={isDarkMode}
        materialRole="raisedCard"
        spotlight
        edgeFadeItem
        className="overflow-hidden"
        contentClassName="relative z-10 px-5 py-6"
      >
        <div className={orderSpec.emptyText}>
          本订单暂无行明细 · 手动录入或自动导入后会出现在这里
        </div>
      </SidePanelContainer>
    );
  }

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
        {/* 统一分区头（唯一渲染器）；表头自带 border-b，故外壳去 mb */}
        <OrderSectionHeader
          iconKey="lines"
          kicker="Line Items"
          title="行明细"
          meta={`${lines.length} 行 · 总数量 ${sum(lines.map((l) => Number(l.quantity) || 0)).toLocaleString()}`}
          isDarkMode={isDarkMode}
          wrapClassName="flex items-end justify-between gap-4"
        />
      </header>
      <div className="overflow-x-auto">
        <table className={`w-full min-w-[980px] table-fixed border-separate border-spacing-0 text-left text-xs ${BAMBOOK_OS.typography.weight.body}`}>
          <colgroup>
            <col className="w-[5%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[16%]" />
            <col className="w-[11%]" />
            <col className="w-[7%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
          </colgroup>
          <thead className={`${tableHeaderClass} ${orderSpec.textMuted}`}>
            <tr>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>#</th>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>客供品号</th>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>工厂品色号</th>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>描述/颜色</th>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>面料</th>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>门幅</th>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>克重</th>
              <th className={`px-4 py-3 text-right ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>数量</th>
              <th className={`px-4 py-3 text-right ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>单价{currency ? ` (${currency})` : ''}</th>
              <th className={`px-4 py-3 text-right ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>小计</th>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>出厂日期</th>
              <th className={`px-4 py-3 ${BAMBOOK_OS.typography.weight.tableHeader} ${BAMBOOK_OS.typography.tracking.label} whitespace-nowrap ${tableCellBorderClass}`}>到港日期</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${tableRowDividerClass}`}>
            {lines.map((l) => (
              <tr key={l.id ?? l.lineNumber} className={`relative transition-[background,color] duration-200 ${tableRowHoverClass}`}>
                <td className={`px-4 py-3 font-light tabular-nums ${mutedCellClass}`}>{l.lineNumber}</td>
                <td className={`px-4 py-3 truncate ${primaryTextClass}`}>{l.materialCode || '—'}</td>
                <td className={`px-4 py-3 truncate ${secondaryTextClass}`}>{l.millQuality || '—'}</td>
                <td className={`px-4 py-3 truncate ${secondaryTextClass}`}>{l.description || '—'}</td>
                <td className={`px-4 py-3 truncate ${secondaryTextClass}`}>{l.cloth || '—'}</td>
                <td className={`px-4 py-3 truncate ${secondaryTextClass}`}>{l.width || '—'}</td>
                <td className={`px-4 py-3 truncate ${secondaryTextClass}`}>{l.weight || '—'}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${primaryTextClass}`}>
                  {Number(l.quantity || 0).toLocaleString()} {l.unit || ''}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${secondaryTextClass}`}>
                  {fmt(l.unitPrice)}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${primaryTextClass}`}>
                  {fmt(l.netValue)}
                </td>
                <td className={`px-4 py-3 whitespace-nowrap ${secondaryTextClass}`}>{formatYmd(l.exMillDate) || '—'}</td>
                <td className={`px-4 py-3 whitespace-nowrap ${secondaryTextClass}`}>{formatYmd(l.deliveryDate) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SidePanelContainer>
  );
};

function sum(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export default OrderLinesTable;
