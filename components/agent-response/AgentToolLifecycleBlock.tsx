import React from 'react';
import { CheckCircle2, CircleDashed, ShieldAlert, XCircle } from 'lucide-react';
import type { AgentToolLifecycleBlock as AgentToolLifecycleBlockModel } from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';
import { riskToneClass, riskPillClass } from './agentResponseTone';

const statusLabel: Record<AgentToolLifecycleBlockModel['lifecycleStatus'], string> = {
  planned: '已规划',
  parameterized: '已生成参数',
  permission_checked: '已完成权限检查',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  blocked: '已阻塞',
};

const StatusIcon: React.FC<{ status: AgentToolLifecycleBlockModel['lifecycleStatus']; className: string }> = ({ status, className }) => {
  if (status === 'succeeded') return <CheckCircle2 size={16} className={className} />;
  if (status === 'failed') return <XCircle size={16} className={className} />;
  if (status === 'blocked') return <ShieldAlert size={16} className={className} />;
  return <CircleDashed size={16} className={className} />;
};

export const AgentToolLifecycleBlock: React.FC<AgentBlockComponentProps<AgentToolLifecycleBlockModel>> = ({ block, isDarkMode, onReferenceClick }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';
  const canOpenToolRun = Boolean(onReferenceClick && block.toolRunId);

  return (
    <button
      type="button"
      onClick={() => block.toolRunId && onReferenceClick?.({
        refId: `ref_${block.toolRunId}`,
        kind: 'tool_run',
        label: block.toolId,
        toolRunId: block.toolRunId,
        blockId: block.id,
      })}
      disabled={!canOpenToolRun}
      className={`${OS_MATERIAL.insetSurface} w-full rounded-inset border px-4 py-3 text-left ${borderClass} ${canOpenToolRun ? 'transition-opacity hover:opacity-85' : 'cursor-default'}`}
    >
      <div className="flex items-start gap-3">
        <StatusIcon status={block.lifecycleStatus} className={riskToneClass(block.risk, isDarkMode)} />
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '工具调用'}</div>
          <div className={`mt-1 text-xs text-[var(--text-primary)]`}>{block.toolId} · {statusLabel[block.lifecycleStatus]}</div>
          {block.reason && <div className={`mt-1 text-xs leading-5 ${quietTextClass}`}>{block.reason}</div>}
          <div className={`mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest ${quietTextClass}`}>
            <span className={`rounded-full border px-2 py-1 ${riskPillClass(block.risk, isDarkMode) || borderClass}`}>risk: {block.risk}</span>
            {block.toolRunId && <span className={`rounded-full border px-2 py-1 ${borderClass}`}>run: {block.toolRunId}</span>}
          </div>
          {block.error && <div className={`mt-2 rounded-compact border px-3 py-2 text-xs leading-5 ${borderClass} text-[var(--text-secondary)]`}>{block.error}</div>}
        </div>
      </div>
    </button>
  );
};
