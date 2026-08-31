import React from 'react';
import { FileText } from 'lucide-react';
import type { AgentArtifactBlock as AgentArtifactBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

export const AgentArtifactBlock: React.FC<AgentBlockComponentProps<AgentArtifactBlockModel>> = ({ block, isDarkMode, onArtifactClick }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';

  return (
    <button
      type="button"
      onClick={() => onArtifactClick?.(block)}
      disabled={!onArtifactClick}
      className={`${OS_MATERIAL.insetSurface} w-full rounded-inset border px-4 py-3 text-left ${borderClass} ${onArtifactClick ? 'transition-opacity hover:opacity-85' : 'cursor-default'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${borderClass}`}>
          <FileText size={16} className={quietTextClass} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-xs uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '产物'}</div>
          <div className={`mt-1 text-xs leading-5 ${quietTextClass}`}>
            {block.artifactType} · version {block.version} · {block.artifactId}
          </div>
          {block.contentRef && <div className={`mt-1 truncate text-xs ${quietTextClass}`}>contentRef: {block.contentRef}</div>}
        </div>
      </div>
    </button>
  );
};
