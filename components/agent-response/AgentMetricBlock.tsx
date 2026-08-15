import React from 'react';
import type { AgentMetricBlock as AgentMetricBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';
import { metricToneClass } from './agentResponseTone';

export const AgentMetricBlock: React.FC<AgentBlockComponentProps<AgentMetricBlockModel>> = ({ block, isDarkMode }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {block.metrics.map(metric => (
        <div key={metric.id} className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
          <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{metric.label}</div>
          <div className={`mt-2 text-xl font-light ${metricToneClass(metric.tone || '', isDarkMode)}`}>{metric.value}</div>
          {metric.delta && <div className={`mt-1 text-xs ${quietTextClass}`}>{metric.delta}</div>}
        </div>
      ))}
    </div>
  );
};
