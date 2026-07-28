import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleDashed, ShieldAlert, XCircle, Wrench, FileText } from 'lucide-react';
import type {
  AgentEvidenceBlock as AgentEvidenceBlockModel,
  AgentReferenceAnchor,
  AgentToolLifecycleBlock as AgentToolLifecycleBlockModel,
} from '../../types';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { statusIconClass } from './agentResponseTone';

export type TimelineEntry =
  | { kind: 'tool'; block: AgentToolLifecycleBlockModel }
  | { kind: 'evidence'; block: AgentEvidenceBlockModel };

export interface AgentTimelineGroupProps {
  entries: TimelineEntry[];
  isDarkMode?: boolean;
  defaultOpen?: boolean;
  isStreaming?: boolean;
  onReferenceClick?: (anchor: AgentReferenceAnchor) => void;
}

const STATUS_LABEL: Record<AgentToolLifecycleBlockModel['lifecycleStatus'], string> = {
  planned: '规划中',
  parameterized: '参数生成',
  permission_checked: '权限检查',
  running: '执行中',
  succeeded: '完成',
  failed: '失败',
  blocked: '阻塞',
};

const isRunning = (s: AgentToolLifecycleBlockModel['lifecycleStatus']) =>
  s === 'planned' || s === 'parameterized' || s === 'permission_checked' || s === 'running';

const ToolStatusIcon: React.FC<{ status: AgentToolLifecycleBlockModel['lifecycleStatus']; isDarkMode?: boolean }> = ({ status, isDarkMode }) => {
  const cls = 'shrink-0';
  // 终态图标用 key 触发 fade-in，避免从 spinner 硬切到对勾的视觉跳变
  if (status === 'succeeded') return <CheckCircle2 key="ok" size={13} className={`${cls} agent-fade-in ${statusIconClass(status, isDarkMode)}`} />;
  if (status === 'failed') return <XCircle key="fail" size={13} className={`${cls} agent-fade-in ${statusIconClass(status, isDarkMode)}`} />;
  if (status === 'blocked') return <ShieldAlert key="blk" size={13} className={`${cls} agent-fade-in ${statusIconClass(status, isDarkMode)}`} />;
  return <CircleDashed key="run" size={13} className={`${cls} animate-spin ${statusIconClass(status, isDarkMode)}`} />;
};

const RiskPill: React.FC<{ risk?: AgentToolLifecycleBlockModel['risk']; isDarkMode?: boolean }> = ({ risk, isDarkMode }) => {
  if (!risk || risk === 'low') return null;
  const cls = risk === 'critical'
    ? (isDarkMode ? 'bg-white/[0.07] text-white/75' : 'bg-slate-100 text-slate-600')
    : risk === 'high'
    ? (isDarkMode ? 'bg-white/[0.07] text-white/75' : 'bg-slate-100 text-slate-600')
    : (isDarkMode ? 'bg-white/[0.07] text-white/75' : 'bg-slate-100 text-slate-600');
  return <span className={`shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-light ${cls}`}>{risk}</span>;
};

interface TimelineRowProps {
  entry: TimelineEntry;
  isHover: boolean;
  onEnter: () => void;
  onLeave: () => void;
  isDarkMode?: boolean;
  onReferenceClick?: (anchor: AgentReferenceAnchor) => void;
}

const TimelineRow: React.FC<TimelineRowProps> = ({ entry, isHover, onEnter, onLeave, isDarkMode, onReferenceClick }) => {
  const quietTextClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const hoverBg = isDarkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-slate-50';

  if (entry.kind === 'tool') {
    const b = entry.block;
    return (
      <li onMouseEnter={onEnter} onMouseLeave={onLeave} className={`group relative flex items-start gap-2 px-3 py-1.5 ${hoverBg}`}>
        <span className="relative z-10 mt-[3px] flex h-[14px] w-[14px] items-center justify-center">
          <ToolStatusIcon status={b.lifecycleStatus} isDarkMode={isDarkMode} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`truncate text-[12px] ${isDarkMode ? 'text-white/85' : 'text-slate-800'}`}>{b.title || b.toolId}</span>
            <span className={`shrink-0 text-[10px] ${quietTextClass}`}>{STATUS_LABEL[b.lifecycleStatus]}</span>
            <RiskPill risk={b.risk} isDarkMode={isDarkMode} />
            {b.toolRunId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReferenceClick?.({ refId: `ref_${b.toolRunId}`, kind: 'tool_run', label: b.toolId, toolRunId: b.toolRunId, blockId: b.id });
                }}
                className={`ml-auto shrink-0 rounded px-1.5 py-[1px] text-[10px] opacity-0 transition-opacity group-hover:opacity-100 ${
                  isDarkMode ? 'text-white/60 hover:text-white/85 hover:bg-white/[0.05]' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                详情 →
              </button>
            )}
          </div>
          {b.reason && <div className={`mt-0.5 text-[11px] leading-[1.4] ${quietTextClass}`} style={{ display: '-webkit-box', WebkitLineClamp: isHover ? 4 : 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.reason}</div>}
          {b.error && <div className={`mt-0.5 text-[11px] leading-[1.4] ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`}>{b.error}</div>}
          {isHover && b.outputPreview != null && (() => {
            const text = typeof b.outputPreview === 'string' ? b.outputPreview : (() => {
              try { return JSON.stringify(b.outputPreview, null, 2); } catch { return String(b.outputPreview); }
            })();
            const truncated = text.length > 360 ? text.slice(0, 360) + '…' : text;
            return (
              <pre className={`mt-1 max-h-[140px] max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md px-2 py-1 text-[10.5px] leading-[1.45] ${isDarkMode ? 'bg-white/[0.04] text-white/70' : 'bg-slate-50 text-slate-600'}`}>
                {truncated}
              </pre>
            );
          })()}
        </div>
      </li>
    );
  }

  // evidence row
  const ev = entry.block;
  const anchorsByRef = new Map<string, AgentReferenceAnchor>((ev.anchors ?? []).map(a => [a.refId, a]));
  return (
    <li onMouseEnter={onEnter} onMouseLeave={onLeave} className={`group relative flex items-start gap-2 px-3 py-1.5 ${hoverBg}`}>
      <span className="relative z-10 mt-[3px] flex h-[14px] w-[14px] items-center justify-center">
        <FileText size={12} className={`shrink-0 ${quietTextClass}`} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-[12px] ${isDarkMode ? 'text-white/85' : 'text-slate-800'}`}>{ev.title ?? '证据'}</span>
          <span className={`shrink-0 text-[10px] ${quietTextClass}`}>{ev.items.length} 条</span>
        </div>
        {isHover && ev.items.slice(0, 3).map(item => {
          const anchor = anchorsByRef.get(item.refId);
          return (
            <div key={item.refId} className={`mt-0.5 truncate text-[11px] leading-[1.4] ${quietTextClass}`}>
              · {item.label}{item.summary ? ` — ${item.summary.length > 80 ? item.summary.slice(0, 80) + '…' : item.summary}` : ''}
              {anchor && onReferenceClick && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onReferenceClick(anchor); }}
                  className={`ml-1 rounded px-1 text-[10px] ${isDarkMode ? 'text-[var(--os-vnext-brand-blue-soft)] hover:bg-white/[0.05]' : 'text-[var(--os-vnext-brand-blue-strong)] hover:bg-slate-100'}`}
                >
                  查看
                </button>
              )}
            </div>
          );
        })}
      </div>
    </li>
  );
};

export const AgentTimelineGroup: React.FC<AgentTimelineGroupProps> = ({ entries, isDarkMode, defaultOpen, isStreaming, onReferenceClick }) => {
  const [open, setOpen] = useState<boolean>(Boolean(defaultOpen));
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const effectiveOpen = isStreaming ? true : open;

  const summary = useMemo(() => {
    let succeeded = 0, failed = 0, running = 0, evidenceCount = 0;
    for (const e of entries) {
      if (e.kind === 'evidence') { evidenceCount += 1; continue; }
      const s = e.block.lifecycleStatus;
      if (s === 'succeeded') succeeded += 1;
      else if (s === 'failed' || s === 'blocked') failed += 1;
      else running += 1;
    }
    return { succeeded, failed, running, evidenceCount, total: entries.length };
  }, [entries]);

  const quietTextClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const dividerClass = isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/55';
  const railClass = isDarkMode ? 'bg-white/[0.08]' : 'bg-slate-200/70';
  const hoverBg = isDarkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-slate-50';

  const headerLabel = (() => {
    if (isStreaming && summary.running > 0) {
      const cur = entries.find(e => e.kind === 'tool' && isRunning(e.block.lifecycleStatus));
      const tip = cur && cur.kind === 'tool' ? cur.block.toolId : '';
      return `执行中 · ${summary.succeeded}/${summary.total} 步${tip ? ` · ${tip}` : ''}`;
    }
    if (summary.failed > 0) return `已完成 ${summary.succeeded} 步 · ${summary.failed} 异常`;
    return `已完成 ${summary.succeeded} 步${summary.evidenceCount ? ` · ${summary.evidenceCount} 条证据` : ''}`;
  })();

  return (
    <div className={`overflow-hidden rounded-inset border ${dividerClass}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${hoverBg}`}
        aria-expanded={effectiveOpen}
      >
        <ChevronRight size={14} className={`shrink-0 transition-transform duration-200 ${effectiveOpen ? 'rotate-90' : ''} ${quietTextClass}`} />
        <Wrench size={12} className={`shrink-0 ${quietTextClass}`} />
        <span className={`text-[12px] font-light ${isDarkMode ? 'text-white/72' : 'text-slate-700'}`}>{headerLabel}</span>
        {isStreaming && (
          <span className="ml-auto flex items-center gap-1">
            <span className={`inline-block h-1.5 w-1.5 rounded-full animate-pulse ${isDarkMode ? 'bg-white/60' : 'bg-slate-500'}`} />
            <span className={`text-[10px] ${quietTextClass}`}>live</span>
          </span>
        )}
      </button>
      {effectiveOpen && (
        <div className="relative pb-1">
          <div className={`pointer-events-none absolute left-[18px] top-0 bottom-2 w-px ${railClass}`} />
          <ol className="flex flex-col">
            {entries.map(entry => (
              <TimelineRow
                key={entry.block.id}
                entry={entry}
                isHover={hoveredId === entry.block.id}
                onEnter={() => setHoveredId(entry.block.id)}
                onLeave={() => setHoveredId(prev => (prev === entry.block.id ? null : prev))}
                isDarkMode={isDarkMode}
                onReferenceClick={onReferenceClick}
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
};
