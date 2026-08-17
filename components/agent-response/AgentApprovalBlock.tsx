import React from 'react';
import { ShieldCheck, AlertTriangle, GitBranch, Globe, Mail, Wrench } from 'lucide-react';
import type {
  AgentApprovalBlock as AgentApprovalBlockModel,
  AgentProcessDraft,
  AgentProcessDraftFieldDiff,
  AgentProcessDraftPostCommitHook,
} from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { OS_MATERIAL } from '../ui/osMaterial';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';
import { riskToneClass } from './agentResponseTone';

const formatDraftValue = (value: unknown): string => {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};

const HOOK_TYPE_LABEL: Record<AgentProcessDraftPostCommitHook['type'], string> = {
  email: '邮件通知',
  sms: '短信通知',
  webhook: 'Webhook',
  notification: '站内通知',
};

const ProcessDraftView: React.FC<{ draft: AgentProcessDraft; isDarkMode?: boolean }> = ({ draft, isDarkMode }) => {
  const quietText = BAMBOOK_OS.tone.text.quiet;
  const labelCls = BAMBOOK_OS.tone.text.formLabel;
  const beforeCls = 'text-[var(--text-tertiary)] line-through';
  const afterCls = 'text-[var(--text-secondary)]';
  const rowBorder = 'border-[var(--border-c-subtle)]';

  return (
    <div className={`mt-2 flex flex-col gap-2 rounded-compact border ${rowBorder} px-2.5 py-2`}>
      {draft.beforeAfterDiff.length > 0 && (
        <div>
          <div className={`mb-1 flex items-center gap-1 text-[10px] uppercase tracking-widest ${labelCls}`}>
            <GitBranch size={14} />
            <span>变更清单</span>
          </div>
          <div className="flex flex-col gap-1">
            {draft.beforeAfterDiff.map((diff: AgentProcessDraftFieldDiff, idx: number) => (
              <div key={`${diff.entity}_${diff.entityId}_${diff.field}_${idx}`} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11.5px] leading-relaxed">
                <span className={`font-light text-[var(--text-primary)]`}>{diff.entity}.{diff.field}</span>
                {diff.before != null && diff.before !== '' && (
                  <span className={`break-all ${beforeCls}`}>{formatDraftValue(diff.before)}</span>
                )}
                <span className={quietText}>→</span>
                <span className={`break-all font-light ${afterCls}`}>{formatDraftValue(diff.after)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {draft.subOperations.length > 0 && (
        <div>
          <div className={`mb-1 flex items-center gap-1 text-[10px] uppercase tracking-widest ${labelCls}`}>
            <Wrench size={14} />
            <span>操作步骤 · {draft.subOperations.length} 步</span>
          </div>
          <div className="flex flex-col gap-1">
            {draft.subOperations.map((op, idx) => (
              <div key={`${op.toolId}_${op.entityId}_${idx}`} className={`flex items-center gap-1.5 text-[11px] ${quietText}`}>
                <span className="tabular-nums">{idx + 1}.</span>
                <span className={`font-light text-[var(--text-secondary)]`}>{op.action}</span>
                <span>→</span>
                <span className="truncate">{op.toolId}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {draft.impactScope.length > 0 && (
        <div>
          <div className={`mb-1 flex items-center gap-1 text-[10px] uppercase tracking-widest ${labelCls}`}>
            <Globe size={14} />
            <span>影响范围</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {draft.impactScope.map((scope: string, idx: number) => (
              <span key={idx} className={`rounded-full px-1.5 py-0.5 text-[10.5px] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>{scope}</span>
            ))}
          </div>
        </div>
      )}
      {(draft.irreversible || draft.postCommitHooks.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {draft.irreversible && (
            <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
              <AlertTriangle size={14} />
              <span>不可逆操作</span>
            </span>
          )}
          {draft.postCommitHooks.map((hook: AgentProcessDraftPostCommitHook, idx: number) => (
            <span key={idx} className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
              <Mail size={14} />
              <span>提交后 · {HOOK_TYPE_LABEL[hook.type] ?? hook.type}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const approvalLabel: Record<AgentApprovalBlockModel['approvalStatus'], string> = {
  pending: '等待审批',
  approved: '已批准',
  rejected: '已拒绝',
  modified: '已修改',
};

export const AgentApprovalBlock: React.FC<AgentBlockComponentProps<AgentApprovalBlockModel>> = ({ block, isDarkMode, onExecuteAction }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const borderClass = 'border-[var(--border-c-default)]';

  return (
    <div className={`${OS_MATERIAL.insetSurface} rounded-inset border px-4 py-3 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${borderClass}`}>
          <ShieldCheck size={16} className={riskToneClass(block.risk, isDarkMode)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] uppercase tracking-widest ${labelTextClass}`}>{block.title ?? '需要确认'}</div>
          <div className={`mt-1 text-xs leading-5 text-[var(--text-primary)]`}>{block.proposedAction}</div>
          {block.processDraft && <ProcessDraftView draft={block.processDraft} isDarkMode={isDarkMode} />}
          <div className={`mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest ${quietTextClass}`}>
            <span className={`rounded-full border px-2 py-1 ${borderClass}`}>{approvalLabel[block.approvalStatus]}</span>
            <span className={`rounded-full border px-2 py-1 ${borderClass}`}>risk: {block.risk}</span>
            {block.toolId && <span className={`rounded-full border px-2 py-1 ${borderClass}`}>{block.toolId}</span>}
          </div>
          {block.approvalStatus === 'pending' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onExecuteAction?.({ actionId: block.approvalId, actionType: 'approval', payload: { approvalId: block.approvalId, decision: 'approved', toolId: block.toolId, input: block.input }, risk: block.risk, label: '批准' })}
                disabled={!onExecuteAction}
                className={`rounded-full border px-3 py-1.5 text-xs font-light transition-opacity ${onExecuteAction ? 'hover:opacity-80' : 'cursor-default opacity-70'} ${borderClass}`}
              >
                批准
              </button>
              <button
                type="button"
                onClick={() => onExecuteAction?.({ actionId: block.approvalId, actionType: 'approval', payload: { approvalId: block.approvalId, decision: 'rejected', toolId: block.toolId }, risk: block.risk, label: '拒绝' })}
                disabled={!onExecuteAction}
                className={`rounded-full border px-3 py-1.5 text-xs font-light transition-opacity ${onExecuteAction ? 'hover:opacity-80' : 'cursor-default opacity-70'} ${borderClass}`}
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={() => onExecuteAction?.({ actionId: block.approvalId, actionType: 'approval', payload: { approvalId: block.approvalId, decision: 'modified', toolId: block.toolId, input: block.input, editableFields: block.editableFields }, risk: block.risk, label: '修改参数' })}
                disabled={!onExecuteAction}
                className={`rounded-full border px-3 py-1.5 text-xs font-light transition-opacity ${onExecuteAction ? 'hover:opacity-80' : 'cursor-default opacity-70'} ${borderClass}`}
              >
                修改参数
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
