import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, Cpu, CircleDashed, CheckCircle2, AlertCircle,
  Wrench, Activity, Settings,
} from 'lucide-react';
import type { AgentWorkEvent } from '../types';
import {
  buildAgentProgressItems,
  getAgentEventIconKind,
  type AgentNarrativeLine,
  type AgentEventIconKind,
} from '../lib/agentEventPresentation';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';

interface AgentProcessPanelProps {
  /** 结构化事件；有则优先用事件渲染 */
  events?: AgentWorkEvent[];
  /** 当没有事件时，fallback 到纯文本的过程描述 */
  fallbackText?: string;
  /** 是否正在执行中——执行中默认展开，执行完默认收起 */
  isRunning?: boolean;
  isDarkMode?: boolean;
  /** live：运行中平铺展示；summary：完成后折叠回看 */
  variant?: 'live' | 'summary';
}

const iconFor = (kind: AgentEventIconKind): React.ReactElement => {
  switch (kind) {
    case 'complete':
      return <CheckCircle2 size={13} className="text-slate-400" />;
    case 'blocked':
      return <AlertCircle size={13} className="text-slate-400" />;
    case 'tool':
      return <Wrench size={13} className="text-[var(--os-vnext-brand-blue)]" />;
    case 'cognitive':
      return <Activity size={13} className="text-slate-400" />;
    case 'identity':
      return <Settings size={13} className="text-slate-400" />;
    case 'final':
      return <Cpu size={13} className="text-slate-400" />;
    case 'running':
      return <CircleDashed size={13} className="text-slate-400 animate-spin" />;
    default:
      return <CircleDashed size={13} className="text-slate-400" />;
  }
};

const renderEventRow = (item: AgentNarrativeLine, bodyClass: string, quietClass: string) => {
  const iconKind =
    item.isFailed || item.isBlocked
      ? 'blocked' as const
      : item.isRunning
        ? 'running' as const
        : (item.phase === 'tool_call' || item.phase === 'tool_result')
          ? 'tool' as const
          : getAgentEventIconKind({
              id: item.id, phase: item.phase, status: item.status || 'complete',
              title: '', message: '',
            } as AgentWorkEvent);

  const icon = iconFor(iconKind);

  return (
    <div key={`${item.id}`} className="flex items-start gap-2.5">
      <div className="mt-[3px] shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className={`text-[12px] leading-relaxed ${bodyClass}`}>{item.line}</div>
        {item.toolLabel && (
          <div className={`mt-1 inline-block rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] ${quietClass}`}>
            {item.toolLabel}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Agent 工作过程面板
 *
 * - 执行中 (isRunning) 自动展开
 * - 执行完默认收起，用户可点击展开查看完整过程
 * - 优先渲染事件列表（结构化），没有则渲染 fallbackText
 */
export const AgentProcessPanel: React.FC<AgentProcessPanelProps> = ({
  events = [],
  fallbackText = '',
  isRunning = false,
  isDarkMode = false,
  variant = isRunning ? 'live' : 'summary',
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  useEffect(() => {
    setIsExpanded(isRunning);
  }, [isRunning]);

  const displayItems = buildAgentProgressItems(events);
  const hasEvents = displayItems.length > 0;
  const hasFallback = !!fallbackText.trim();
  if (!hasEvents && !hasFallback && !isRunning) return null;

  const quietTextClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const bodyTextClass = isDarkMode ? 'text-white/72' : 'text-slate-700';
  const borderClass = isDarkMode ? 'border-white/10' : 'border-slate-200';
  const hoverBgClass = isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50';
  const stepCount = hasEvents ? displayItems.length : 1;
  const liveItems = hasEvents ? displayItems : [{
    id: 'agent-live-waiting',
    phase: 'start',
    status: 'running',
    line: '正在建立任务上下文...',
    isRunning: true,
  } as AgentNarrativeLine];

  if (variant === 'live') {
    return (
      <div className="mb-3">
        <div className={`mb-2 flex items-center gap-2 text-[12px] ${quietTextClass}`}>
          <Activity size={13} className="text-[var(--os-vnext-brand-blue)] animate-pulse" />
          <span>工作过程</span>
        </div>
        <div className={`space-y-3 border-l pl-3 ${isDarkMode ? 'border-white/10' : 'border-slate-200'}`}>
          {liveItems.map(item => renderEventRow(item, bodyTextClass, quietTextClass))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mb-3 flex flex-col rounded-field border ${borderClass} overflow-hidden ${OS_MATERIAL.insetSurface} transition-all duration-300`}
    >
      <button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        className={`flex items-center justify-between w-full px-3 py-2.5 text-left ${hoverBgClass} transition-colors`}
      >
        <div className="flex items-center gap-2">
          {isRunning && <Activity size={13} className="text-[var(--os-vnext-brand-blue)] animate-pulse" />}
          <span className={`text-[12px] ${isRunning ? bodyTextClass : quietTextClass}`}>
            {isRunning ? '工作过程' : `查看工作过程（${stepCount}步）`}
          </span>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className={quietTextClass}
        >
          <ChevronDown size={13} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className={`px-3 pb-3 pt-1 border-t ${borderClass}`}>
              {hasEvents ? (
                <div className="space-y-3 mt-2">
                  {displayItems.map(item => renderEventRow(item, bodyTextClass, quietTextClass))}
                  {isRunning && (
                    <div className="flex items-start gap-2.5 opacity-60">
                      <div className="mt-[3px] shrink-0">
                        <CircleDashed size={13} className="text-slate-400 animate-spin" />
                      </div>
                      <div className={`text-[12px] leading-relaxed ${quietTextClass}`}>
                        执行中...
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={`text-[12px] leading-relaxed whitespace-pre-wrap ${bodyTextClass} mt-1`}>
                  {fallbackText}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
