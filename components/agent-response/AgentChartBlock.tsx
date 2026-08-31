import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import type { AgentChartBlock as AgentChartBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

// 系列色板：图表语义六色（--chart-1..6），深浅两态由 tokens.css .dark 段统一覆盖
const CHART_PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

// 非法数值不静默转 0：返回 null（图表留断点），由调用方统计并提示
const numericValue = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export const AgentChartBlock: React.FC<AgentBlockComponentProps<AgentChartBlockModel>> = ({ block, isDarkMode }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';
  const axisColor = 'var(--chart-axis)';
  const gridColor = 'var(--chart-grid)';

  const dim = block.dimensions[0];
  const measures = block.measures.length > 0 ? block.measures : (dim ? [] : []);

  const { data, invalidCount } = useMemo(() => {
    let invalid = 0;
    const rows = (block.data || []).map((row, idx) => {
      const out: Record<string, unknown> = { __idx: idx };
      if (dim) out[dim] = row[dim];
      measures.forEach(m => {
        const parsed = numericValue(row[m]);
        // 仅统计"有值但无法解析"的异常；空值属正常稀疏数据
        if (parsed === null && row[m] !== null && row[m] !== undefined && row[m] !== '') invalid += 1;
        out[m] = parsed;
      });
      return out;
    });
    return { data: rows, invalidCount: invalid };
  }, [block.data, dim, measures]);

  const chartType = block.chartType || 'bar';
  const isEmpty = data.length === 0 || measures.length === 0;

  const tooltipStyle = {
    backgroundColor: 'var(--chart-tooltip-bg)',
    border: '0.5px solid var(--chart-tooltip-border)',
    borderRadius: 10,
    fontSize: 12,
    color: 'var(--text-primary)',
  };

  const renderChart = () => {
    if (isEmpty) {
      return <div className={`flex h-full w-full items-center justify-center text-xs ${quietTextClass}`}>暂无图表数据</div>;
    }

    if (chartType === 'pie') {
      const m = measures[0];
      // null 数据点在饼图中无法表达占比，直接剔除（数量由 invalidCount 提示）
      const pieData = data
        .map(d => ({ name: String(dim ? d[dim] : d.__idx), value: d[m] as number | null }))
        .filter((d): d is { name: string; value: number } => d.value !== null);
      if (pieData.length === 0) {
        return <div className={`flex h-full w-full items-center justify-center text-xs ${quietTextClass}`}>数据均无法解析为数值</div>;
      }
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: axisColor }} />
            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="40%" outerRadius="78%" paddingAngle={1}>
              {pieData.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      );
    }

    const ChartCmp = chartType === 'line' ? LineChart : chartType === 'area' ? AreaChart : BarChart;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ChartCmp data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey={dim ?? '__idx'} stroke={axisColor} tick={{ fontSize: 11 }} />
          <YAxis stroke={axisColor} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          {measures.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: axisColor }} />}
          {measures.map((m, i) => {
            const color = CHART_PALETTE[i % CHART_PALETTE.length];
            if (chartType === 'line') return <Line key={m} type="monotone" dataKey={m} stroke={color} strokeWidth={2} dot={{ r: 2 }} />;
            if (chartType === 'area') return <Area key={m} type="monotone" dataKey={m} stroke={color} strokeWidth={1.5} fill={color} fillOpacity={isDarkMode ? 0.18 : 0.22} />;
            return <Bar key={m} dataKey={m} fill={color} radius={[4, 4, 0, 0]} />;
          })}
        </ChartCmp>
      </ResponsiveContainer>
    );
  };

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-xs uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '图表'}</div>
          <div className={`mt-1 text-xs ${quietTextClass}`}>{chartType} · {data.length} 条数据 · {measures.join(', ') || '无指标'}</div>
          {invalidCount > 0 && (
            <div className={`mt-1 text-xs ${quietTextClass}`}>{invalidCount} 个数据点无法解析为数值，已在图表中留空。</div>
          )}
        </div>
      </div>
      <div className="mt-3 h-56 w-full">
        {renderChart()}
      </div>
    </div>
  );
};
