import React from 'react';
import { Activity, AlertCircle } from 'lucide-react';
import type { AgentWorkEvent } from '../types';
import {
  getAgentLiveStatusText,
  getAgentEventSemanticTone,
} from '../lib/agentEventPresentation';
import { BAMBOOK_OS } from './ui/bambookOsTokens';

interface AgentLiveStatusBarProps {
  events: AgentWorkEvent[];
  isLoading: boolean;
  isDarkMode?: boolean;
  /** 自定义前缀；默认由 getAgentLiveStatusText 生成 */
  overrideText?: string;
}

/**
 * Agent 实时状态条
 *
 * 显示在 Agent 消息气泡上方的一行小文字。
 * - 执行中："正在调用 订单档案查询" / "正在规划执行步骤"
 * - 异常："需要补充信息" / "执行失败"
 * - 空闲：不渲染（return null）
 */
export const AgentLiveStatusBar: React.FC<AgentLiveStatusBarProps> = ({
  events,
  isLoading,
  isDarkMode = false,
  overrideText,
}) => {
  const text = overrideText ?? getAgentLiveStatusText(events, isLoading);
  if (!text) return null;

  // 只有在执行中 / 有异常时才显示——不要在"已完成"状态下还显示
  const last = events[events.length - 1];
  const isException = last?.status === 'blocked' || last?.status === 'failed';
  if (!isLoading && !isException) return null;

  const tone = last
    ? getAgentEventSemanticTone(last)
    : 'info';

  const iconColor = 'text-[var(--text-tertiary)]';

  const textClass = BAMBOOK_OS.tone.text.quiet;

  const Icon = (tone === 'danger' || tone === 'warning') ? AlertCircle : Activity;

  return (
    <div className="mb-2 flex items-center gap-2 text-[12px]">
      <Icon size={14} className={`${iconColor} ${isLoading ? 'animate-pulse' : ''}`} />
      <span className={textClass}>{text}</span>
    </div>
  );
};
