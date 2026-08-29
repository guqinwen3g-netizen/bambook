import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentArtifactBlock, AgentMarkdownBlock as AgentMarkdownBlockModel, AgentReferenceAnchor } from '../../types';
import { MarkdownRenderer } from '../MarkdownRenderer';

export interface AgentBlockComponentProps<TBlock> {
  block: TBlock;
  isDarkMode?: boolean;
  onExecuteAction?: (action: {
    actionId: string;
    actionType?: string;
    payload?: Record<string, unknown>;
    risk?: 'low' | 'medium' | 'high' | 'critical';
    label?: string;
  }) => void;
  onReferenceClick?: (anchor: AgentReferenceAnchor) => void;
  onArtifactClick?: (artifact: AgentArtifactBlock) => void;
}

// 字符级吐字节奏：每个 tick 吐多少字符（含中文/英文混合时整体观感约 30~40 char/s）
const CHARS_PER_TICK = 4;
// 吐字 tick 间隔（ms）
const TICK_MS = 28;
// 安全阈值：当队列长度超过此值时，倍速吐字以追上后端节奏，避免落后过多
const FAST_FORWARD_THRESHOLD = 240;

/**
 * 字符级流式打字 markdown block。
 *
 * 设计：
 *   - block.content 是后端流式追加的最新完整文本
 *   - 内部维护 displayedLen，定时器按节奏推进直至追上
 *   - block.status === 'complete' 时立即 flush 全部，避免末尾卡顿
 *   - 用户切到非 streaming 历史消息时也能看到完整内容（直接显示 content）
 */
export const AgentMarkdownBlock: React.FC<AgentBlockComponentProps<AgentMarkdownBlockModel>> = ({ block, isDarkMode }) => {
  const isComplete = block.status === 'complete' || block.status === 'error';
  const [displayedLen, setDisplayedLen] = useState<number>(() => (isComplete ? block.content.length : 0));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 当 block 已经 complete 时，立刻显示完整内容
  useEffect(() => {
    if (isComplete) {
      setDisplayedLen(block.content.length);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }
    // streaming 状态：如果 content 缩短了（理论上不会），重置；正常情况下推进 tick
    setDisplayedLen(prev => Math.min(prev, block.content.length));
  }, [block.content, isComplete]);

  // 推进 tick：streaming 时若 displayedLen < content.length 则 schedule 下一次 setState
  useEffect(() => {
    if (isComplete) return;
    if (displayedLen >= block.content.length) {
      // 追上了，但仍可能有更多 content 来；等下一个 content 变化再 schedule
      return;
    }
    const remaining = block.content.length - displayedLen;
    const charsToAdvance = remaining > FAST_FORWARD_THRESHOLD
      ? Math.max(CHARS_PER_TICK, Math.ceil(remaining / 40))
      : CHARS_PER_TICK;
    timerRef.current = setTimeout(() => {
      setDisplayedLen(prev => Math.min(prev + charsToAdvance, block.content.length));
    }, TICK_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [displayedLen, block.content.length, isComplete]);

  // 卸载时清理
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const visibleText = useMemo(() => {
    if (isComplete) return block.content;
    return block.content.slice(0, displayedLen);
  }, [block.content, displayedLen, isComplete]);

  const isTyping = !isComplete && displayedLen < block.content.length;
  // 当还在 streaming 但暂时追上时，光标也应保持闪烁，因为更多内容可能还会来
  const showCursor = !isComplete;

  return (
    <div className="relative">
      <MarkdownRenderer content={visibleText} isDarkMode={Boolean(isDarkMode)} />
      {showCursor && (
        <span
          aria-hidden
          className={`agent-md-cursor ${isTyping ? 'is-typing' : ''} inline-block align-text-bottom ml-px h-[1.05em] w-0.5 -mb-px bg-[var(--invert-bg)]`}
          style={{ verticalAlign: '-0.12em' }}
        />
      )}
    </div>
  );
};
