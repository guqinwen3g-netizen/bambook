import React from 'react';
import type { AgentEvidenceBlock as AgentEvidenceBlockModel, AgentReferenceAnchor } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

const confidenceLabel = (confidence?: 'high' | 'medium' | 'low') => {
  if (confidence === 'high') return '高可信';
  if (confidence === 'medium') return '中可信';
  if (confidence === 'low') return '低可信';
  return '证据';
};

const anchorKindLabel = (kind: AgentReferenceAnchor['kind']) => {
  if (kind === 'tool_run') return '工具';
  if (kind === 'document') return '文档';
  if (kind === 'artifact') return '产物';
  if (kind === 'database_row') return '数据';
  if (kind === 'api_response') return '接口';
  return '来源';
};

export const AgentEvidenceBlock: React.FC<AgentBlockComponentProps<AgentEvidenceBlockModel>> = ({ block, isDarkMode, onReferenceClick }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';
  const anchorsByRef = new Map((block.anchors ?? []).map(anchor => [anchor.refId, anchor]));

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '证据链'}</div>
        {(block.anchors?.length ?? 0) > 0 && (
          <div className={`text-[10px] uppercase tracking-widest ${quietTextClass}`}>{block.anchors?.length} anchors</div>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {block.items.map(item => {
          const anchor = anchorsByRef.get(item.refId);
          return (
            <div key={item.refId} className={`rounded-compact border px-3 py-2 ${borderClass}`}>
              <div className="flex items-center justify-between gap-2">
                <div className={`text-xs text-[var(--text-primary)]`}>{item.label}</div>
                <div className={`text-[10px] uppercase tracking-widest ${quietTextClass}`}>{confidenceLabel(item.confidence)}</div>
              </div>
              <div className={`mt-1 text-xs leading-5 ${quietTextClass}`}>{item.summary}</div>
              {anchor && (
                <div className="mt-2 flex min-w-0 max-w-full flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onReferenceClick?.(anchor)}
                    disabled={!onReferenceClick}
                    className={`min-w-0 max-w-full truncate rounded-full border px-2 py-1 text-[10px] transition-colors ${onReferenceClick ? 'hover:opacity-80' : 'cursor-default'} ${borderClass} ${quietTextClass}`}
                  >
                    {anchorKindLabel(anchor.kind)} · {anchor.label ?? anchor.sourceId ?? anchor.toolRunId ?? anchor.refId}
                  </button>
                  {anchor.path && <span className={`min-w-0 max-w-full truncate rounded-full border px-2 py-1 text-[10px] ${borderClass} ${quietTextClass}`}>{anchor.path}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
