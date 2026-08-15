import React from 'react';
import type { AgentDiagramBlock as AgentDiagramBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

export const AgentDiagramBlock: React.FC<AgentBlockComponentProps<AgentDiagramBlockModel>> = ({ block, isDarkMode }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';
  const nodeById = new Map(block.nodes.map(node => [node.id, node]));

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '图示'}</div>
        <div className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-widest ${borderClass} ${quietTextClass}`}>
          {block.kind}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {block.nodes.map(node => (
          <div key={node.id} className={`min-w-0 rounded-compact border px-3 py-2 ${borderClass}`}>
            <div className={`truncate text-xs text-[var(--text-primary)]`}>{node.label}</div>
            {node.subtitle && <div className={`mt-0.5 truncate text-[11px] ${quietTextClass}`}>{node.subtitle}</div>}
          </div>
        ))}
      </div>

      {block.edges.length > 0 && (
        <div className={`mt-3 rounded-compact border px-3 py-2 ${borderClass}`}>
          <div className={`text-[10px] uppercase tracking-widest ${labelTextClass}`}>关系</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {block.edges.slice(0, 6).map((edge, index) => (
              <div key={`${edge.from}-${edge.to}-${index}`} className={`flex min-w-0 items-center gap-2 text-[11px] ${quietTextClass}`}>
                <span className="truncate">{nodeById.get(edge.from)?.label ?? edge.from}</span>
                <span className="text-[var(--text-tertiary)] dark:text-[var(--text-quaternary)]">→</span>
                <span className="truncate">{nodeById.get(edge.to)?.label ?? edge.to}</span>
                {edge.label && <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${borderClass}`}>{edge.label}</span>}
              </div>
            ))}
            {block.edges.length > 6 && <div className={`text-[11px] ${quietTextClass}`}>还有 {block.edges.length - 6} 条关系未展开。</div>}
          </div>
        </div>
      )}
    </div>
  );
};
