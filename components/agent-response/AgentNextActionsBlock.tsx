import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { AgentNextActionsBlock as AgentNextActionsBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';

export const AgentNextActionsBlock: React.FC<AgentBlockComponentProps<AgentNextActionsBlockModel>> = ({ block, isDarkMode, onExecuteAction }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
      <div className={`text-xs uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '下一步'}</div>
      <div className="mt-3 flex flex-col gap-2">
        {block.actions.map(action => (
          <button
            key={action.id}
            type="button"
            onClick={() => onExecuteAction?.({ actionId: action.id, actionType: action.actionType, payload: action.payload, risk: action.risk, label: action.label })}
            disabled={!onExecuteAction}
            className={`flex w-full items-start gap-2 rounded-compact border px-3 py-2 text-left transition-colors ${onExecuteAction ? 'hover:opacity-80' : 'cursor-default opacity-75'} ${borderClass}`}
          >
            <ChevronRight size={14} className={`mt-0.5 shrink-0 ${quietTextClass}`} />
            <span className="min-w-0">
              <span className={`block text-xs text-[var(--text-primary)]`}>{action.label}</span>
              {action.description && <span className={`mt-0.5 block text-xs leading-5 ${quietTextClass}`}>{action.description}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
