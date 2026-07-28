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

const PALETTE_LIGHT = ['#185FA5', '#3B6D11', '#854F0B', '#993556', '#534AB7', '#0F6E56'];
const PALETTE_DARK  = ['#85B7EB', '#C0DD97', '#FAC775', '#F4C0D1', '#CECBF6', '#9FE1CB'];

const numericValue = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return 0;
};

export const AgentChartBlock: React.FC<AgentBlockComponentProps<AgentChartBlockModel>> = ({ block, isDarkMode }) => {
  const labelTextClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const quietTextClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const borderClass = isDarkMode ? 'border-white/[0.08]' : 'border-slate-200/70';
  const axisColor = isDarkMode ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.55)';
  const gridColor = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const palette = isDarkMode ? PALETTE_DARK : PALETTE_LIGHT;

  const dim = block.dimensions[0];
  const measures = block.measures.length > 0 ? block.measures : (dim ? [] : []);

  const data = useMemo(() => {
    return (block.data || []).map((row, idx) => {
      const out: Record<string, unknown> = { __idx: idx };
      if (dim) out[dim] = row[dim];
      measures.forEach(m => { out[m] = numericValue(row[m]); });
      return out;
    });
  }, [block.data, dim, measures]);

  const chartType = block.chartType || 'bar';
  const isEmpty = data.length === 0 || measures.length === 0;

  const tooltipStyle = {
    backgroundColor: isDarkMode ? 'rgba(20,20,22,0.96)' : 'rgba(255,255,255,0.96)',
    border: `0.5px solid ${isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.15)'}`,
    borderRadius: 10,
    fontSize: 12,
    color: isDarkMode ? '#fff' : '#0f172a',
  };

  const renderChart = () => {
    if (isEmpty) {
      return <div className={`flex h-full w-full items-center justify-center text-xs ${quietTextClass}`}>暂无图表数据</div>;
    }

    if (chartType === 'pie') {
      const m = measures[0];
      const pieData = data.map(d => ({ name: String(dim ? d[dim] : d.__idx), value: numericValue(d[m]) }));
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: axisColor }} />
            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="40%" outerRadius="78%" paddingAngle={1}>
              {pieData.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
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
            const color = palette[i % palette.length];
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
          <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '图表'}</div>
          <div className={`mt-1 text-xs ${quietTextClass}`}>{chartType} · {data.length} 条数据 · {measures.join(', ') || '无指标'}</div>
        </div>
      </div>
      <div className="mt-3 h-56 w-full">
        {renderChart()}
      </div>
    </div>
  );
};
