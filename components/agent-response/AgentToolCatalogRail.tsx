import React, { useMemo, useState } from 'react';
import { ChevronDown, Wrench, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import {
  type AgentToolCatalog,
  type AgentToolManifestEntry,
  type AgentToolRiskLevel,
  getDomainLabel,
} from '../../lib/agentManifest';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { riskPillClass } from './agentResponseTone';

type Props = {
  catalog: AgentToolCatalog | null;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error?: string;
  onRetry?: () => void;
  isDarkMode?: boolean;
};

const ApprovalIcon: React.FC<{ approval: AgentToolManifestEntry['safety']['approval']; className: string }> = ({ approval, className }) => {
  if (approval === 'always') return <ShieldX size={14} strokeWidth={1.5} className={className} />;
  if (approval === 'risk_based') return <ShieldAlert size={14} strokeWidth={1.5} className={className} />;
  return <ShieldCheck size={14} strokeWidth={1.5} className={className} />;
};

const approvalTooltip = (approval: AgentToolManifestEntry['safety']['approval']): string => {
  if (approval === 'always') return '执行前必须审批';
  if (approval === 'risk_based') return '高风险时需要审批';
  return '只读 · 无需审批';
};

/**
 * Phase 7 / Task 59 — 左栏工具目录
 *
 * 设计要点：
 * - 默认折叠：每个 domain 一行 chip（label + 数量），点开显示工具列表
 * - 工具卡：name + risk pill + safety icon；hover tooltip 展示 inputHint
 * - 数据源：父组件 fetch /api/agent/mcp/manifest 后传入；不直接 fetch（保留可测性）
 * - 不消费上下文：纯展示组件，不触发 agent 调用，也不联动右栏
 */
export const AgentToolCatalogRail: React.FC<Props> = ({ catalog, status, error, onRetry, isDarkMode }) => {
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const surfaceClass = 'border-[var(--border-c-subtle)]';

  const [openDomains, setOpenDomains] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => catalog?.groupedByDomain ?? [], [catalog]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex flex-col space-y-1.5 no-drag">
        <div className={`px-2 text-[10px] uppercase ${BAMBOOK_OS.typography.tracking.overline} font-light ${labelTextClass}`}>工具目录</div>
        <div className={`rounded-inset border px-2.5 py-2 text-[11px] leading-4 shrink-0 ${surfaceClass} ${quietTextClass}`}>
          {status === 'loading' ? '加载中…' : '准备中'}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col space-y-1.5 no-drag">
        <div className={`px-2 text-[10px] uppercase ${BAMBOOK_OS.typography.tracking.overline} font-light ${labelTextClass}`}>工具目录</div>
        <div className={`rounded-inset border px-2.5 py-2 text-[11px] leading-4 shrink-0 border-[var(--border-c-default)] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
          {error || '工具目录加载失败'}
          {onRetry && (
            <button type="button" onClick={onRetry} className={`ml-2 underline text-[var(--text-primary)]`}>
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!catalog || catalog.tools.length === 0) {
    return (
      <div className="flex flex-col space-y-1.5 no-drag">
        <div className={`px-2 text-[10px] uppercase ${BAMBOOK_OS.typography.tracking.overline} font-light ${labelTextClass}`}>工具目录</div>
        <div className={`rounded-inset border px-2.5 py-2 text-[11px] leading-4 shrink-0 ${surfaceClass} ${quietTextClass}`}>暂无可用工具</div>
      </div>
    );
  }

  const totalApproval = catalog.summary.approvalRequired.length;

  return (
    <div className="flex flex-col space-y-1.5 no-drag">
      <div className={`px-2 flex items-center justify-between text-[10px] uppercase ${BAMBOOK_OS.typography.tracking.overline} font-light ${labelTextClass}`}>
        <span>工具目录</span>
        <span className={quietTextClass}>{catalog.summary.total}</span>
      </div>

      <div className="space-y-1 px-0.5">
        {groups.map(group => {
          const meta = getDomainLabel(group.domain);
          const isOpen = openDomains[group.domain] ?? false;
          const approvalCount = group.tools.filter(t => t.safety.approval !== 'never').length;
          return (
            <div key={group.domain} className={`rounded-inset border ${surfaceClass}`}>
              <button
                type="button"
                onClick={() => setOpenDomains(prev => ({ ...prev, [group.domain]: !isOpen }))}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--hover-darken)] rounded-inset`}
                title={meta.hint}
              >
                <Wrench size={14} strokeWidth={1.5} className="text-[var(--text-tertiary)]" />
                <span className={`text-[11px] font-light text-[var(--text-primary)]`}>{meta.label}</span>
                <span className={`text-[10px] ${quietTextClass}`}>{group.tools.length}</span>
                {approvalCount > 0 && (
                  <span
                    className={`text-[9px] px-1 py-0.5 rounded-full border ${riskPillClass('high', isDarkMode)}`}
                    title={`${approvalCount} 个工具需审批`}
                  >
                    {approvalCount} 审批
                  </span>
                )}
                <ChevronDown
                  size={14}
                  strokeWidth={1.5}
                  className={`ml-auto transition-transform ${isOpen ? 'rotate-180' : ''} ${quietTextClass}`}
                />
              </button>
              {isOpen && (
                <div className={`border-t ${surfaceClass} px-1.5 py-1 space-y-0.5`}>
                  {group.tools.map(tool => (
                    <div
                      key={tool.id}
                      className={`group rounded-compact px-2 py-1.5 hover:bg-[var(--hover-darken)]`}
                      title={tool.inputHint || tool.description || tool.name}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-light leading-4 truncate text-[var(--text-primary)]`}>
                          {tool.name}
                        </span>
                        <span className={`shrink-0 text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded-bds-sm border ${riskPillClass(tool.risk, isDarkMode)}`}>
                          {tool.risk}
                        </span>
                        <ApprovalIcon
                          approval={tool.safety.approval}
                          className={`shrink-0 ml-auto text-[var(--text-secondary)]`}
                        />
                      </div>
                      <div className={`mt-0.5 text-[10px] leading-3.5 ${quietTextClass} truncate`}>
                        {tool.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalApproval > 0 && (
        <div className={`px-2 text-[9.5px] ${quietTextClass}`}>
          共 {totalApproval} 个工具需审批 · schema {catalog.schemaVersion}
        </div>
      )}
    </div>
  );
};
