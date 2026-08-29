import React, { useState, useCallback } from 'react';
import { Check, Copy, Paperclip, Globe, ClipboardList, Pencil } from 'lucide-react';
import type { ChatMessage, AgentWorkEvent, AgentArtifactBlock, AgentReferenceAnchor, AgentResponseBlock, AgentToolLifecycleBlock, AgentEvidenceBlock, AgentApprovalBlock, AgentMarkdownBlock } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentDocumentRenderer } from './agent-response/AgentDocumentRenderer';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 12 — 中栏流式文档渲染
// ─────────────────────────────────────────────────────────────────────────────
// 渲染范式：
//   model 消息 = 身份头（头像+名字+badge）→ 文档流 → 底部操作栏（常驻）
//   user  消息 = 右对齐轻气泡
//
// 文档流由 AgentDocumentRenderer 驱动：
//   tool/evidence/approval = 行内注解（不占满宽度、无独立容器）
//   markdown = 裸段落
//   rich block = 独立段落

// ── 完整工作流序列化（用于"复制完整工作流"功能）──
// 把 blocks 数组转为结构化文本，保留 tool/evidence/approval 的全部过程信息，
// 方便后续 agent 调试 / 喂入 prompt / 人工审计。

const LIFECYCLE_LABEL: Record<AgentToolLifecycleBlock['lifecycleStatus'], string> = {
  planned: '规划中',
  parameterized: '参数生成',
  permission_checked: '权限检查',
  running: '执行中',
  succeeded: '完成',
  failed: '失败',
  blocked: '阻塞',
};

const APPROVAL_LABEL: Record<AgentApprovalBlock['approvalStatus'], string> = {
  pending: '等待审批',
  approved: '已批准',
  rejected: '已拒绝',
  modified: '已修改',
};

function serializeBlocksForCopy(blocks: AgentResponseBlock[], answerText: string, userPrompt?: string, events?: AgentWorkEvent[]): string {
  const lines: string[] = [];

  // 如果有用户提问，先写入
  if (userPrompt && userPrompt.trim()) {
    lines.push('═══ 用户提问 ═══');
    lines.push('');
    lines.push(userPrompt.trim());
    lines.push('');
  }

  // 先写过程
  const processBlocks = blocks.filter(b => b.type === 'tool' || b.type === 'evidence' || b.type === 'approval');
  if (processBlocks.length > 0) {
    lines.push('═══ Agent 工作流 ═══');
    lines.push('');

    for (const block of processBlocks) {
      if (block.type === 'tool') {
        const t = block as AgentToolLifecycleBlock;
        lines.push(`── 工具: ${t.title || t.toolId} ──`);
        lines.push(`   状态: ${LIFECYCLE_LABEL[t.lifecycleStatus]}`);
        if (t.risk && t.risk !== 'low') lines.push(`   风险: ${t.risk}`);
        if (t.reason) lines.push(`   原因: ${t.reason}`);
        if (t.inputPreview) {
          try { lines.push(`   输入: ${JSON.stringify(t.inputPreview, null, 2).split('\n').map((l, i) => i === 0 ? l : '   ' + l).join('\n')}`); } catch { /* skip */ }
        }
        if (t.outputPreview != null) {
          const outText = typeof t.outputPreview === 'string' ? t.outputPreview : (() => { try { return JSON.stringify(t.outputPreview, null, 2); } catch { return String(t.outputPreview); } })();
          const truncated = outText.length > 800 ? outText.slice(0, 800) + '...[截断]' : outText;
          lines.push(`   输出: ${truncated.split('\n').map((l, i) => i === 0 ? l : '   ' + l).join('\n')}`);
        }
        if (t.error) lines.push(`   错误: ${t.error}`);
        lines.push('');
      } else if (block.type === 'evidence') {
        const e = block as AgentEvidenceBlock;
        lines.push(`── 证据: ${e.title || '证据链'} (${e.items.length} 条) ──`);
        for (const item of e.items.slice(0, 10)) {
          lines.push(`   • ${item.label}${item.summary ? ': ' + (item.summary.length > 120 ? item.summary.slice(0, 120) + '...' : item.summary) : ''}`);
        }
        if (e.items.length > 10) lines.push(`   ...还有 ${e.items.length - 10} 条`);
        lines.push('');
      } else if (block.type === 'approval') {
        const a = block as AgentApprovalBlock;
        lines.push(`── 审批: ${a.title || '需要确认'} ──`);
        lines.push(`   状态: ${APPROVAL_LABEL[a.approvalStatus]}`);
        lines.push(`   操作: ${a.proposedAction}`);
        if (a.risk) lines.push(`   风险: ${a.risk}`);
        if (a.input) {
          try { lines.push(`   参数: ${JSON.stringify(a.input, null, 2).split('\n').map((l, i) => i === 0 ? l : '   ' + l).join('\n')}`); } catch { /* skip */ }
        }
        lines.push('');
      }
    }
  } else if (events && events.length > 0) {
    // Fallback：blocks 为空时从 agentEvents 重建工作流
    lines.push('═══ Agent 工作流 ═══');
    lines.push('');
    for (const ev of events) {
      if (ev.phase === 'tool_call_start' && ev.toolId) {
        lines.push(`── 工具: ${ev.toolId} ──`);
        lines.push(`   状态: 执行中`);
        if (ev.message) lines.push(`   原因: ${ev.message.slice(0, 200)}`);
        lines.push('');
      } else if (ev.phase === 'tool_call_end' && ev.toolId) {
        lines.push(`── 工具: ${ev.toolId} ──`);
        lines.push(`   状态: ${ev.status === 'complete' ? '完成' : '失败'}`);
        if (ev.summary) lines.push(`   摘要: ${ev.summary.slice(0, 300)}`);
        if (ev.metadata?.error) lines.push(`   错误: ${JSON.stringify(ev.metadata.error).slice(0, 300)}`);
        lines.push('');
      } else if (ev.phase === 'final_answer' && ev.metadata?.finalAnswer) {
        // skip, handled below
      } else if (ev.phase === 'thought' && ev.message) {
        lines.push(`── 思考 ──`);
        lines.push(`   ${ev.message.slice(0, 300)}`);
        lines.push('');
      }
    }
  }

  // 写最终答案
  const markdownBlocks = blocks.filter(b => b.type === 'markdown');
  const finalAnswer = markdownBlocks.map(b => (b as AgentMarkdownBlock).content).join('\n\n') || answerText;
  if (finalAnswer.trim()) {
    if (processBlocks.length > 0) {
      lines.push('═══ 最终回答 ═══');
      lines.push('');
    }
    lines.push(finalAnswer.trim());
  }

  return lines.join('\n');
}

interface WorkspaceOpenPayload {
  kind: 'browser' | 'image' | 'pdf' | 'file' | 'review' | 'artifact';
  url?: string;
  title?: string;
  previewUrl?: string;
  mimeType?: string;
  data?: string;
  name?: string;
  attachmentName?: string;
  referenceAnchor?: AgentReferenceAnchor;
  artifactBlock?: AgentArtifactBlock;
}

export interface AgentMessageCardProps {
  message: ChatMessage;
  index: number;
  userName?: string;
  isLatestModelMessage?: boolean;
  runtimeEvents?: AgentWorkEvent[];
  isRuntimeLoading?: boolean;
  isDarkMode?: boolean;
  copiedMessageKey?: string | number | null;
  onCopy?: (messageKey: string | number, text: string) => void;
  onCopyFull?: (messageKey: string | number, text: string) => void;
  onOpenWorkspace?: (payload: WorkspaceOpenPayload) => void;
  onExecuteAction?: (action: { actionId: string; actionType?: string; payload?: Record<string, unknown>; risk?: 'low' | 'medium' | 'high' | 'critical'; label?: string }) => void;
  onEditUserMessage?: (messageKey: string | number, newText: string) => void;
  userPrompt?: string;
}

export const AgentMessageCard: React.FC<AgentMessageCardProps> = ({
  message,
  index,
  userName,
  isLatestModelMessage = false,
  isDarkMode = false,
  copiedMessageKey,
  onCopy,
  onCopyFull,
  onOpenWorkspace,
  onExecuteAction,
  onEditUserMessage,
  userPrompt,
  runtimeEvents,
}) => {
  const messageKey = message.id ?? index;
  const isTyping = Boolean(message.isTyping && isLatestModelMessage);
  const isCopied = copiedMessageKey === messageKey;
  const isCopiedFull = copiedMessageKey === `full_${messageKey}`;

  // ── user 消息 inline 编辑态 ──
  // 主流 Agent 交互：hover 用户气泡出现复制/编辑；编辑时气泡就地变成 textarea，
  // 提交后由父组件截断该消息之后的历史并基于新文本重新生成回复。
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const startEdit = useCallback(() => {
    setEditText(message.text);
    setIsEditing(true);
  }, [message.text]);
  const cancelEdit = useCallback(() => {
    setEditText(message.text);
    setIsEditing(false);
  }, [message.text]);
  const submitEdit = useCallback(() => {
    const text = editText.trim();
    if (!text || !onEditUserMessage) return;
    onEditUserMessage(messageKey, text);
  }, [editText, onEditUserMessage, messageKey]);

  const bodyTextClass = 'text-[var(--text-primary)]';
  const quietTextClass = BAMBOOK_OS.tone.text.quiet;
  const labelTextClass = BAMBOOK_OS.tone.text.formLabel;
  const actionControlClass = BAMBOOK_OS.controls.actionControl.bordered;
  const inlineSurfaceClass = `${OS_MATERIAL.insetSurface} rounded-inset border`;
  const isDarkModeOverride = 'border-[var(--border-c-default)] text-[var(--text-tertiary)]';

  const isModel = message.role === 'model';
  const hasResponseBlocks = isModel && Boolean(message.blocks?.length);
  const hasAnswerText = message.text.trim().length > 0;

  const hasAnyContent = hasAnswerText || hasResponseBlocks;

  // ── 容器样式 ──
  const containerClass = isModel
    ? 'group relative py-6 px-1'
    : 'group relative py-3 flex justify-end';

  const userBubbleClass = 'rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] px-4 py-2.5 text-sm font-light leading-6 text-[var(--text-primary)] max-w-[85%]';

  // user 气泡 hover 操作按钮（icon-only，紧凑），与 model 操作栏共用设计语言
  const userActionBtnClass = 'flex items-center justify-center rounded-control p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-secondary)]';
  const userEditorClass = 'w-full max-w-[85%] rounded-inset border border-[var(--border-c-strong)] bds-inset px-3 py-2.5';

  // 右键/长按复制完整工作流
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isModel || !hasResponseBlocks || !onCopyFull) return;
    // 只在有 blocks 的 model 消息上拦截右键
    e.preventDefault();
    const fullText = serializeBlocksForCopy(message.blocks ?? [], message.text, userPrompt, runtimeEvents);
    onCopyFull(`full_${messageKey}`, fullText);
  }, [isModel, hasResponseBlocks, onCopyFull, message.blocks, message.text, messageKey, userPrompt, runtimeEvents]);

  return (
    <section className={containerClass} onContextMenu={handleContextMenu}>
      {/* ── model 消息 ── */}
      {isModel && (
        <>
          {/* 身份头：头像 + 名字 + 时间/token badge */}
          <div className="mb-3 flex items-center gap-2.5">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-[var(--os-vnext-brand-blue)]/10`}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[var(--os-vnext-brand-blue)]">
                <path d="M8 1L1 5v6l7 4 7-4V5L8 1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M1 5l7 4m0 0l7-4m-7 4v6" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </div>
            <span className="text-[13px] font-light text-[var(--text-primary)]">Bambook</span>
            {isTyping && (
              <span className="flex items-center gap-1.5">
                <span className={"inline-block h-1.5 w-1.5 rounded-full animate-pulse bg-[var(--invert-bg)]"} />
                <span className={`text-[11px] ${quietTextClass}`}>思考中</span>
              </span>
            )}
            {!isTyping && message.timestamp ? (
              <span className={`text-[11px] ${quietTextClass}`}>
                {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
          </div>

          {/* 文档流 */}
          {/* 流式过程中：思考过程以纯文本灰字显示，不渲染 markdown */}
          {isTyping && hasAnswerText ? (
            <div className={`mb-2 text-[13px] font-light leading-6 italic ${quietTextClass}`}>
              {message.text.replace(/^>\s*💭?\s*/gm, '')}
            </div>
          ) : null}
          {hasResponseBlocks ? (
            <div className={bodyTextClass}>
              <AgentDocumentRenderer
                blocks={message.blocks ?? []}
                isDarkMode={isDarkMode}
                isStreaming={isTyping}
                onExecuteAction={onExecuteAction}
                onReferenceClick={(anchor) => onOpenWorkspace?.({
                  kind: 'review',
                  title: anchor.label || anchor.sourceId || anchor.toolRunId || anchor.refId,
                  name: anchor.label,
                  referenceAnchor: anchor,
                })}
                onArtifactClick={(artifactBlock) => onOpenWorkspace?.({
                  kind: 'artifact',
                  title: artifactBlock.title || artifactBlock.artifactId,
                  name: artifactBlock.title,
                  artifactBlock,
                })}
              />
            </div>
          ) : !isTyping && hasAnswerText ? (
            <div className={`text-sm font-light leading-6 ${bodyTextClass}`}>
              <MarkdownRenderer content={message.text} isDarkMode={isDarkMode} />
            </div>
          ) : isTyping && !hasAnswerText && !hasResponseBlocks ? (
            <div className={`text-sm font-light leading-6 ${quietTextClass}`}>正在思考...</div>
          ) : null}

          {/* 来源 chip 行 */}
          {message.sources && message.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {message.sources.map((source, i) => (
                <a
                  key={i}
                  href={source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenWorkspace?.({
                      kind: 'browser',
                      url: source.uri,
                      title: source.title || source.uri,
                      name: source.title,
                    });
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-light transition-colors ${actionControlClass}`}
                >
                  <Globe size={10} />
                  <span className="truncate max-w-[160px]">{source.title}</span>
                </a>
              ))}
            </div>
          )}

          {/* 底部操作栏（常驻） */}
          {hasAnyContent && !isTyping && (
            <div className={`mt-2 flex items-center gap-3 ${quietTextClass}`}>
              {hasAnswerText && (
                <button
                  type="button"
                  onClick={() => onCopy?.(messageKey, message.text)}
                  className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-secondary)]`}
                  title="复制回复"
                  aria-label="复制回复"
                >
                  {isCopied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
                  <span>{isCopied ? '已复制' : '复制'}</span>
                </button>
              )}
              {isModel && onCopyFull && (
                <button
                  type="button"
                  onClick={() => {
                    const fullText = serializeBlocksForCopy(message.blocks ?? [], message.text, userPrompt, runtimeEvents);
                    onCopyFull(`full_${messageKey}`, fullText);
                  }}
                  className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-secondary)]`}
                  title="复制完整工作流（含所有工具调用、证据链、审批记录）"
                  aria-label="复制完整工作流"
                >
                  {isCopiedFull ? <Check size={12} strokeWidth={1.5} /> : <ClipboardList size={12} strokeWidth={1.5} />}
                  <span>{isCopiedFull ? '已复制' : '复制工作流'}</span>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── user 消息 ── */}
      {!isModel && (
        <div className="flex flex-col items-end gap-2 max-w-full">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end">
              {message.attachments.map((att, i) => (
                <div
                  key={i}
                  role={onOpenWorkspace ? 'button' : undefined}
                  tabIndex={onOpenWorkspace ? 0 : undefined}
                  onClick={() => onOpenWorkspace?.({
                    kind: att.mimeType?.startsWith('image/') ? 'image' : att.mimeType?.includes('pdf') ? 'pdf' : 'file',
                    title: att.name,
                    mimeType: att.mimeType,
                    data: att.data,
                    previewUrl: att.previewUrl,
                    name: att.name,
                    attachmentName: att.name,
                  })}
                  className={`${inlineSurfaceClass} h-12 w-12 rounded-inset overflow-hidden flex items-center justify-center text-[10px] cursor-pointer ${isDarkModeOverride}`}
                  title={att.name}
                >
                  {att.mimeType?.startsWith('image/')
                    ? <img src={att.previewUrl} alt={att.name} className="w-full h-full object-cover" />
                    : <Paperclip size={14} />}
                </div>
              ))}
            </div>
          )}
          {hasAnswerText && !isEditing && (
            <div className="flex flex-col items-end gap-1">
              <div className={userBubbleClass}>
                <div className="whitespace-pre-wrap">{message.text}</div>
              </div>
              <div className={`flex items-center gap-0.5 pr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${isTyping ? '!opacity-0' : ''}`}>
                <button
                  type="button"
                  onClick={() => onCopy?.(messageKey, message.text)}
                  className={userActionBtnClass}
                  title="复制"
                  aria-label="复制提问"
                >
                  {isCopied ? <Check size={13} strokeWidth={1.5} /> : <Copy size={13} strokeWidth={1.5} />}
                </button>
                {onEditUserMessage && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className={userActionBtnClass}
                    title="编辑并重新发送"
                    aria-label="编辑提问"
                  >
                    <Pencil size={13} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          )}
          {hasAnswerText && isEditing && (
            <div className="flex flex-col items-end gap-2 w-full">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    submitEdit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                rows={Math.min(12, Math.max(2, editText.split('\n').length + 1))}
                autoFocus
                className={`${userEditorClass} text-sm font-light leading-6 resize-none outline-none focus:ring-1 text-[var(--text-primary)] focus:ring-[var(--border-c-strong)]`}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-light transition-opacity hover:opacity-80 text-[var(--text-secondary)]`}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitEdit}
                  disabled={!editText.trim() || editText.trim() === message.text}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-light transition-opacity disabled:cursor-not-allowed disabled:opacity-40 border-[var(--border-c-strong)] text-[var(--text-primary)] hover:opacity-80`}
                >
                  保存并重新发送
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
