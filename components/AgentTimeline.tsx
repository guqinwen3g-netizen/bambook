import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  Brain,
  ChevronDown,
  CircleDashed,
  CheckCircle2,
  ClipboardList,
  Layers,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { AgentWorkEvent } from '../types';
import {
  buildAgentTimeline,
  describeAgentTool,
  type AgentTimeline as AgentTimelineModel,
  type AgentTimelineIteration,
  type AgentTimelinePlanItem,
  type AgentTimelineToolCall,
  type AgentTimelineLegacyTaskNode,
} from '../lib/agentEventPresentation';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';
import { statusTextClass, runningStatusClass } from './agent-response/agentResponseTone';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

interface AgentTimelineProps {
  events: AgentWorkEvent[];
  /** 是否仍在执行——影响"思考中"占位与默认展开。 */
  isRunning?: boolean;
  isDarkMode?: boolean;
}

/**
 * Agent 真实工作流可视化（S3）。
 *
 * 设计：
 *   - 把后端 agent_event 流通过 buildAgentTimeline() 聚合成按 step 的迭代结构。
 *   - 每个 step 内呈现 ThoughtCard → PlanCard → ToolCallCard[] 的卡片流。
 *   - 顶部呈现 TaskGraphPanel（仅旧 orchestrator 路径有数据；agentLoop 路径不渲染）。
 *   - 收尾呈现 FinalAnswerCard（含 stopReason / forced 标记）。
 *
 * 兼容：
 *   - 当 hasNewLoop=false（旧 8 phase 流），本组件只渲染 TaskGraphPanel（若有），
 *     其余仍交给 AgentProcessPanel 兜底。
 */
export const AgentTimeline: React.FC<AgentTimelineProps> = ({
  events,
  isRunning = false,
  isDarkMode = false,
}) => {
  const timeline: AgentTimelineModel = useMemo(() => buildAgentTimeline(events), [events]);

  if (!timeline.hasNewLoop && !timeline.legacyTaskGraph) return null;

  const quietClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const labelClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;

  return (
    <div className="mb-3 flex flex-col gap-2.5">
      {/* 任务图（旧 orchestrator 路径才有；agentLoop 路径会显示运行中迭代列表替代） */}
      {timeline.legacyTaskGraph && timeline.legacyTaskGraph.length > 0 && (
        <TaskGraphPanel
          nodes={timeline.legacyTaskGraph}
          isDarkMode={isDarkMode}
        />
      )}

      {timeline.hasNewLoop && (
        <div className="flex flex-col gap-2">
          <div className={`flex items-center gap-2 text-[12px] ${labelClass}`}>
            <Activity size={13} className={`${runningStatusClass(isDarkMode)} ${isRunning ? 'animate-pulse' : ''}`} />
            <span>Agent 推理迭代</span>
            <span className={`ml-auto text-[10px] ${quietClass}`}>
              {timeline.iterations.length} 步 · {timeline.iterations.reduce((sum, it) => sum + it.toolCalls.length, 0)} 次调用
            </span>
          </div>
          <div className={`space-y-2 border-l pl-3 ${isDarkMode ? 'border-white/10' : 'border-slate-200'}`}>
            {timeline.iterations.map(iter => (
              <IterationGroup
                key={iter.step}
                iteration={iter}
                isDarkMode={isDarkMode}
                isRunning={isRunning && !iter.isComplete}
              />
            ))}
            {isRunning && timeline.iterations.length === 0 && (
              <div className={`flex items-center gap-2 text-[12px] ${quietClass}`}>
                <CircleDashed size={13} className="animate-spin" />
                <span>正在建立任务上下文...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {timeline.finalAnswer && (
        <FinalAnswerCard
          text={timeline.finalAnswer}
          stopReason={timeline.stopReason}
          forced={timeline.forced}
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// IterationGroup：一个 step 内的卡片流
// ─────────────────────────────────────────────────────────────────────────────

interface IterationGroupProps {
  iteration: AgentTimelineIteration;
  isDarkMode?: boolean;
  isRunning?: boolean;
}

const IterationGroup: React.FC<IterationGroupProps> = ({ iteration, isDarkMode, isRunning }) => {
  const [isExpanded, setIsExpanded] = useState(!iteration.isComplete);
  const labelClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const quietClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;

  return (
    <section className="flex flex-col gap-2">
      <header 
        className={`flex items-center gap-2 text-[11px] tracking-wide cursor-pointer hover:opacity-80 transition-opacity select-none ${labelClass}`}
        onClick={() => setIsExpanded(p => !p)}
      >
        <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
          isDarkMode ? 'bg-white/[0.06] text-white/70' : 'bg-slate-100/60 text-slate-600'
        }`}>
          {iteration.step}
        </span>
        <span>第 {iteration.step} 步</span>
        {iteration.isComplete ? (
          <span className="ml-1 truncate opacity-70">
            {iteration.toolCalls.map(c => describeAgentTool(c.toolId)).join(' → ') || '分析'}
          </span>
        ) : isRunning ? (
          <CircleDashed size={12} className={`animate-spin ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`} />
        ) : null}
        <span className={`ml-auto text-[10px] ${quietClass}`}>
          {iteration.toolCalls.length} 次调用
        </span>
      </header>

      {isExpanded && (
        <div className="flex flex-col gap-2 pl-6 mt-1 border-l-2 border-transparent">
          {iteration.thought && (
            <ThoughtCard text={iteration.thought} isDarkMode={isDarkMode} />
          )}

          {iteration.plan && iteration.plan.length > 0 && (
            <PlanCard plan={iteration.plan} isDarkMode={isDarkMode} />
          )}

          {iteration.toolCalls.map(call => (
            <ToolCallCard key={call.callId} call={call} isDarkMode={isDarkMode} />
          ))}
        </div>
      )}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ThoughtCard
// ─────────────────────────────────────────────────────────────────────────────

interface ThoughtCardProps {
  text: string;
  isDarkMode?: boolean;
}

const ThoughtCard: React.FC<ThoughtCardProps> = ({ text, isDarkMode }) => {
  const bodyClass = isDarkMode ? 'text-white/72' : 'text-slate-700';
  const labelClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const borderClass = isDarkMode ? 'border-white/10' : 'border-slate-200';

  return (
    <article className={`${OS_MATERIAL.insetSurface} rounded-inset border ${borderClass} px-3 py-2.5`}>
      <div className={`mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${labelClass}`}>
        <Brain size={11} className="text-[var(--os-vnext-brand-blue)]" />
        <span>思考</span>
      </div>
      <div className={`whitespace-pre-wrap text-[12px] leading-relaxed ${bodyClass}`}>{text}</div>
    </article>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PlanCard
// ─────────────────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: AgentTimelinePlanItem[];
  isDarkMode?: boolean;
}

const PlanCard: React.FC<PlanCardProps> = ({ plan, isDarkMode }) => {
  const bodyClass = isDarkMode ? 'text-white/72' : 'text-slate-700';
  const quietClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const labelClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const borderClass = isDarkMode ? 'border-white/10' : 'border-slate-200';

  return (
    <article className={`${OS_MATERIAL.insetSurface} rounded-inset border ${borderClass} px-3 py-2.5`}>
      <div className={`mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${labelClass}`}>
        <ClipboardList size={11} className="text-[var(--os-vnext-brand-blue)]" />
        <span>Plan</span>
        <span className={`ml-auto normal-case tracking-normal ${quietClass}`}>{plan.length} 个工具</span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {plan.map((item, idx) => (
          <li key={`${item.toolId}_${idx}`} className="flex items-start gap-2">
            <span className={`mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${isDarkMode ? 'bg-white/[0.06] text-white/70' : 'bg-slate-100/60 text-slate-600'}`}>
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-[12px] ${bodyClass}`}>
                <span className="font-light">{describeAgentTool(item.toolId)}</span>
                <span className={`ml-1.5 text-[11px] ${quietClass}`}>{item.toolId}</span>
              </div>
              {item.why && (
                <div className={`mt-0.5 text-[11px] ${quietClass}`}>{item.why}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ToolCallCard：可折叠的入参 / 出参 / 错误
// ─────────────────────────────────────────────────────────────────────────────

interface ToolCallCardProps {
  call: AgentTimelineToolCall;
  isDarkMode?: boolean;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ call, isDarkMode }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(call.status === 'failed');
  const bodyClass = isDarkMode ? 'text-white/72' : 'text-slate-700';
  const quietClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const labelClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const borderClass = isDarkMode ? 'border-white/10' : 'border-slate-200';
  const hoverBg = isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50';

  const statusColor = statusTextClass(isDarkMode);

  const StatusIcon = call.status === 'failed'
    ? AlertCircle
    : call.status === 'running'
      ? CircleDashed
      : call.status === 'complete'
        ? CheckCircle2
        : Wrench;

  const statusText =
    call.status === 'failed' ? '失败'
    : call.status === 'running' ? '运行中'
    : call.status === 'complete' ? '已完成'
    : '排队中';

  return (
    <article className={`${OS_MATERIAL.insetSurface} rounded-inset border ${borderClass} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${hoverBg}`}
      >
        <Wrench size={12} className="text-[var(--os-vnext-brand-blue)] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className={`flex items-center gap-2 text-[12px] ${bodyClass}`}>
            <span className="font-light truncate">{call.toolLabel}</span>
            <span className={`text-[10px] ${quietClass} truncate`}>{call.toolId}</span>
          </div>
          {call.why && !isExpanded && (
            <div className={`mt-0.5 text-[11px] truncate ${quietClass}`}>{call.why}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {typeof call.durationMs === 'number' && (
            <span className={`text-[10px] tabular-nums ${quietClass}`}>{formatDuration(call.durationMs)}</span>
          )}
          <StatusIcon
            size={12}
            className={`${statusColor} ${call.status === 'running' ? 'animate-spin' : ''}`}
          />
          <span className={`text-[10px] ${statusColor}`}>{statusText}</span>
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className={quietClass}
          >
            <ChevronDown size={12} />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className={`flex flex-col gap-2.5 border-t ${borderClass} px-3 py-2.5`}>
              {call.why && (
                <KeyValueBlock label="Why" value={call.why} isDarkMode={isDarkMode} mono={false} />
              )}
              <KeyValueBlock
                label="Input"
                value={formatJson(call.input)}
                isDarkMode={isDarkMode}
              />
              {call.error ? (
                <div className={`rounded-compact border px-2.5 py-2 text-[11px] ${
                  isDarkMode ? 'border-white/10 bg-white/[0.06] text-white/70' : 'border-slate-200 bg-slate-100/60 text-slate-600'
                }`}>
                  <div className={`mb-1 text-[10px] uppercase tracking-widest ${labelClass}`}>Error</div>
                  <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                    {call.error.code ? `[${call.error.code}] ` : ''}{call.error.message}
                  </div>
                </div>
              ) : (
                <KeyValueBlock
                  label="Output"
                  value={formatJson(call.output)}
                  isDarkMode={isDarkMode}
                  hint={call.status === 'running' ? '运行中…' : undefined}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FinalAnswerCard
// ─────────────────────────────────────────────────────────────────────────────

interface FinalAnswerCardProps {
  text: string;
  stopReason?: string;
  forced?: boolean;
  isDarkMode?: boolean;
}

const FinalAnswerCard: React.FC<FinalAnswerCardProps> = ({ text, stopReason, forced, isDarkMode }) => {
  const labelClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const quietClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const borderClass = isDarkMode ? 'border-white/10' : 'border-slate-200';
  const bgClass = isDarkMode ? 'bg-white/[0.06]' : 'bg-slate-100/60';
  const bodyClass = isDarkMode ? 'text-white/82' : 'text-slate-800';

  return (
    <article className={`rounded-inset border ${borderClass} ${bgClass} px-3 py-2.5`}>
      <div className={`mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${labelClass}`}>
        <Sparkles size={11} className={isDarkMode ? 'text-white/70' : 'text-slate-600'} />
        <span>本轮结论</span>
        {forced && (
          <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[9px] normal-case tracking-normal ${
            isDarkMode ? 'border-white/10 text-white/70' : 'border-slate-200 text-slate-600'
          }`}>
            强制收尾{stopReason ? ` · ${stopReason}` : ''}
          </span>
        )}
      </div>
      <div className={`whitespace-pre-wrap text-[12px] leading-relaxed ${bodyClass}`}>{text}</div>
      {!forced && stopReason && (
        <div className={`mt-1 text-[10px] ${quietClass}`}>stopReason · {stopReason}</div>
      )}
    </article>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TaskGraphPanel：旧 orchestrator 路径的任务图静态渲染
// ─────────────────────────────────────────────────────────────────────────────

interface TaskGraphPanelProps {
  nodes: AgentTimelineLegacyTaskNode[];
  isDarkMode?: boolean;
}

const TaskGraphPanel: React.FC<TaskGraphPanelProps> = ({ nodes, isDarkMode }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const labelClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const quietClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const bodyClass = isDarkMode ? 'text-white/72' : 'text-slate-700';
  const borderClass = isDarkMode ? 'border-white/10' : 'border-slate-200';

  return (
    <article className={`${OS_MATERIAL.insetSurface} rounded-inset border ${borderClass} px-3 py-2.5`}>
      <div 
        className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest cursor-pointer hover:opacity-80 transition-opacity select-none ${labelClass} ${isExpanded ? 'mb-2' : ''}`}
        onClick={() => setIsExpanded(p => !p)}
      >
        <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
        <Layers size={11} className="text-[var(--os-vnext-brand-blue)]" />
        <span>任务流程</span>
        <span className={`ml-auto normal-case tracking-normal ${quietClass}`}>{nodes.length} 个节点</span>
      </div>
      {isExpanded && (
      <ol className="flex flex-col gap-1.5 mt-2">
        {nodes.map((node, idx) => (
          <li key={node.id} className="flex items-start gap-2">
            <span className={`mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
              isDarkMode ? 'bg-white/[0.06] text-white/70' : 'bg-slate-100/60 text-slate-600'
            }`}>
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-[12px] ${bodyClass}`}>
                {node.toolId ? describeAgentTool(node.toolId) : node.kind || node.id}
                {node.toolId && (
                  <span className={`ml-1.5 text-[11px] ${quietClass}`}>{node.toolId}</span>
                )}
              </div>
              {node.objective && (
                <div className={`mt-0.5 text-[11px] ${quietClass}`}>{node.objective}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
      )}
    </article>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface KeyValueBlockProps {
  label: string;
  value: string;
  hint?: string;
  isDarkMode?: boolean;
  mono?: boolean;
}

const KeyValueBlock: React.FC<KeyValueBlockProps> = ({ label, value, hint, isDarkMode, mono = true }) => {
  const labelClass = isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight;
  const quietClass = isDarkMode ? BAMBOOK_OS.tone.text.quietDark : BAMBOOK_OS.tone.text.quietLight;
  const bodyClass = isDarkMode ? 'text-white/82' : 'text-slate-800';
  const blockBg = isDarkMode
    ? 'border-white/10 bg-black/25 text-white/82'
    : 'border-slate-200/70 bg-slate-50 text-slate-800';

  return (
    <div>
      <div className={`mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${labelClass}`}>
        <span>{label}</span>
        {hint && <span className={`normal-case tracking-normal ${quietClass}`}>{hint}</span>}
      </div>
      <pre className={`max-h-40 overflow-auto rounded-compact border px-2.5 py-2 text-[11px] leading-relaxed ${blockBg} ${
        mono ? 'font-mono whitespace-pre-wrap break-words' : `whitespace-pre-wrap ${bodyClass}`
      }`}>
        {value || '—'}
      </pre>
    </div>
  );
};

const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
};

const formatJson = (value: unknown): string => {
  if (typeof value === 'undefined') return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
};
