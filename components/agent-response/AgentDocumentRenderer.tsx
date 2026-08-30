import React, { useMemo, useState } from 'react';
import {
  CheckCircle2, ChevronRight, CircleDashed, ShieldAlert, XCircle,
  Wrench, FileText, ShieldCheck, Globe, AlertTriangle, GitBranch, Mail, Receipt,
} from 'lucide-react';
import type {
  AgentResponseBlock,
  AgentResponseBlockType,
  AgentEvidenceBlock as AgentEvidenceBlockModel,
  AgentReferenceAnchor,
  AgentToolLifecycleBlock as AgentToolLifecycleBlockModel,
  AgentApprovalBlock as AgentApprovalBlockModel,
  AgentProcessDraft,
  AgentProcessDraftFieldDiff,
  AgentProcessDraftPostCommitHook,
  OrderConfirmCommitResult,
  OrderConfirmErrorFeedback,
} from '../../types';
import {
  classifyOrderConfirmFeedback,
  extractOrderConfirmResult,
  extractOrderConfirmErrorFeedback,
  ERROR_CODE_LABEL,
} from '../../lib/orderConfirmFeedback';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { AgentBlockErrorBoundary } from './AgentBlockErrorBoundary';
import { AgentTableBlock } from './AgentTableBlock';
import { AgentMetricBlock } from './AgentMetricBlock';
import { AgentNextActionsBlock } from './AgentNextActionsBlock';
import { AgentDiagramBlock } from './AgentDiagramBlock';
import { AgentChartBlock } from './AgentChartBlock';
import { AgentMermaidBlock } from './AgentMermaidBlock';
import { AgentArtifactBlock } from './AgentArtifactBlock';
import { AgentFormBlock } from './AgentFormBlock';
import { AgentUnsupportedBlock } from './AgentUnsupportedBlock';
import type { AgentBlockComponentProps } from './AgentMarkdownBlock';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import { statusIconClass } from './agentResponseTone';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 12 — 流式文档渲染器
// ─────────────────────────────────────────────────────────────────────────────
// 设计准则：
// 1. 整条消息 = 一份流式文档（不是堆叠的卡片）
// 2. tool/evidence = 行内注解（图标 + 单行文字 + ▼可折叠），无背景无边框
// 3. markdown = 裸 markdown 段落，不包裹在容器里
// 4. approval = 内联审批横幅
// 5. form = 独立交互卡片（LLM 发起的结构化信息收集）
// 6. table/metric/chart/diagram/mermaid/artifact/nextActions = 独立段落级元素
// 7. streaming 时答案在后，tool 注解保持原序；完成态时答案前置

type AgentBlockRendererComponent = React.ComponentType<AgentBlockComponentProps<any>>;

const blockRegistry: Partial<Record<AgentResponseBlockType, AgentBlockRendererComponent>> = {
  table: AgentTableBlock,
  metric: AgentMetricBlock,
  nextActions: AgentNextActionsBlock,
  diagram: AgentDiagramBlock,
  chart: AgentChartBlock,
  mermaid: AgentMermaidBlock,
  artifact: AgentArtifactBlock,
  form: AgentFormBlock,
};

// 过程类型 — 渲染为行内注解
const PROCESS_TYPES: ReadonlySet<AgentResponseBlockType> = new Set(['tool', 'evidence']);

// 答案类型 — 完成态时前置
const ANSWER_TYPES: ReadonlySet<AgentResponseBlockType> = new Set([
  'markdown', 'table', 'metric', 'chart', 'mermaid', 'diagram', 'artifact', 'nextActions',
]);

// ── 小型原子组件 ──

const statusIcon = (status: AgentToolLifecycleBlockModel['lifecycleStatus'], isDarkMode?: boolean) => {
  const cls = 'shrink-0';
  if (status === 'succeeded') return <CheckCircle2 size={14} className={`${cls} ${statusIconClass(status, isDarkMode)}`} />;
  if (status === 'failed') return <XCircle size={14} className={`${cls} ${statusIconClass(status, isDarkMode)}`} />;
  if (status === 'blocked') return <ShieldAlert size={14} className={`${cls} ${statusIconClass(status, isDarkMode)}`} />;
  return <CircleDashed size={14} className={`${cls} animate-spin ${statusIconClass(status, isDarkMode)}`} style={{ animationDuration: '2s' }} />;
};

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

// ── P1-C: order.confirm 反馈状态视图 ──

const OrderConfirmFeedbackView: React.FC<{
  result: OrderConfirmCommitResult | null;
  errorFeedback: OrderConfirmErrorFeedback | null;
  hasError: boolean;
  isDarkMode?: boolean;
}> = ({ result, errorFeedback, hasError, isDarkMode }) => {
  const state = classifyOrderConfirmFeedback(result, hasError, errorFeedback);
  const quietText = BAMBOOK_OS.tone.text.quiet;
  const labelCls = BAMBOOK_OS.tone.text.formLabel;
  const cardBorder = 'border-[var(--border-c-subtle)]';
  const monoText = 'text-[var(--text-tertiary)]';

  // === 成功态：订单已确认 + 发票已开具 + 审计已记录 ===
  if (state === 'committed' && result) {
    return (
      <div className={`mt-2 flex flex-col gap-1.5 rounded-compact border ${cardBorder} px-2.5 py-2`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
            <CheckCircle2 size={14} />
            <span>订单已确认</span>
          </span>
          {result.previousStatus && result.newStatus && (
            <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
              <FileText size={14} />
              <span>{result.previousStatus} → {result.newStatus}</span>
            </span>
          )}
          {result.invoiceId && (
            <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
              <Receipt size={14} />
              <span>发票已开具</span>
            </span>
          )}
          {result.auditId && (
            <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] bg-[var(--recessed-bg)] text-[var(--text-tertiary)]`}>
              <ShieldCheck size={14} />
              <span>审计已记录</span>
            </span>
          )}
        </div>
        {/* 结构化字段（对齐 P1-C-backend contract） */}
        <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] ${quietText}`}>
          {result.poNumber && <span>订单 <span className={labelCls}>{result.poNumber}</span></span>}
          {result.invoiceNumber && <span>发票号 <span className={labelCls}>{result.invoiceNumber}</span></span>}
          {typeof result.amount === 'number' && (
            <span>金额 <span className={labelCls}>{result.currency} {result.amount.toLocaleString()}</span></span>
          )}
          {result.customerName && <span>客户 <span className={labelCls}>{result.customerName}</span></span>}
        </div>
        {result.transactionId && (
          <div className={`text-[10px] text-[var(--text-tertiary)]`}>
            事务 {result.transactionId.slice(-14)}
            {result.idempotencyKey && <span> · 幂等键 {result.idempotencyKey.slice(0, 12)}…</span>}
          </div>
        )}
        {result.entityLinks && result.entityLinks.length > 0 && (
          <div className={`text-[10px] ${quietText}`}>
            <span className={labelCls}>关联写入 · </span>
            {result.entityLinks.map((link, i) => (
              <span key={i}>{i > 0 ? '、' : ''}{link.linkKind}({link.toType})</span>
            ))}
          </div>
        )}
        {/* P1-D §2.1: 必须告知 email 未发送，避免"全部完成"误导 */}
        <div className={`flex items-start gap-1 text-[10.5px] leading-[1.4] text-[var(--text-tertiary)]`}>
          <AlertTriangle size={14} className="mt-[1px] shrink-0" />
          <span>确认邮件尚未自动发送（当前 scope 限制），请手动在邮件模块发送确认通知。</span>
        </div>
      </div>
    );
  }

  // === rejected：用户主动拒绝，中性 reassuring（P1-D §3.3）
  if (state === 'rejected') {
    return (
      <div className={`mt-2 rounded-compact border border-[var(--border-c-default)] bg-[var(--recessed-bg)] px-2.5 py-2`}>
        <div className={`flex items-center gap-1.5 text-[11.5px] font-light text-[var(--text-secondary)]`}>
          <XCircle size={14} />
          <span>订单确认已取消</span>
        </div>
        <div className={`mt-1 text-[11px] leading-[1.5] ${quietText}`}>
          订单状态不变，无发票创建，无任何变更。如需稍后确认，可重新发起。
        </div>
      </div>
    );
  }

  // === approval_required：需要审批后才能执行 ===
  if (state === 'approval_required') {
    return (
      <div className={`mt-2 rounded-compact border border-[var(--border-c-default)] bg-[var(--recessed-bg)] px-2.5 py-2`}>
        <div className={`flex items-center gap-1.5 text-[11.5px] font-light text-[var(--text-secondary)]`}>
          <ShieldAlert size={14} />
          <span>该操作需要审批后才能执行</span>
        </div>
        <div className={`mt-1 text-[11px] ${quietText}`}>审批通过后，订单状态变更与发票开具将在单一事务内原子提交。</div>
      </div>
    );
  }

  // === failed：消费稳定 errorFeedback.code + userAction ===
  const code = errorFeedback?.code ?? 'UNKNOWN_ERROR';
  const codeLabel = ERROR_CODE_LABEL[code] ?? code;
  const userAction = errorFeedback?.userAction ?? '请联系管理员查看日志。';
  const details = errorFeedback?.details;
  return (
    <div className={`mt-2 flex flex-col gap-1.5 rounded-compact border border-[var(--border-c-default)] bg-[var(--recessed-bg)] px-2.5 py-2`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`flex items-center gap-1 text-[11.5px] font-light text-[var(--text-secondary)]`}>
          <XCircle size={14} />
          <span>{codeLabel}</span>
        </span>
        <span className={`rounded-bds-sm px-1 py-0.5 text-[9.5px] font-mono bg-[var(--recessed-bg-strong)] text-[var(--text-tertiary)]`}>{code}</span>
        {errorFeedback?.retryable === false && (
          <span className={`text-[9.5px] ${quietText}`}>不可重试</span>
        )}
      </div>
      <div className={`text-[11px] leading-[1.5] ${quietText}`}>
        <span className={labelCls}>下一步 · </span>{userAction}
      </div>
      {details && details.length > 0 && (
        <div className={`mt-0.5 text-[10px] ${monoText}`}>{details.join(' · ')}</div>
      )}
      {result?.error && !details && (
        <div className={`mt-0.5 break-all text-[10px] font-mono ${monoText}`}>{result.error.slice(0, 200)}</div>
      )}
    </div>
  );
};

// ── 行内工具注解 ──

interface ToolAnnotationProps {
  block: AgentToolLifecycleBlockModel;
  isDarkMode?: boolean;
  onReferenceClick?: (anchor: AgentReferenceAnchor) => void;
}

const ToolAnnotation: React.FC<ToolAnnotationProps> = ({ block, isDarkMode, onReferenceClick }) => {
  const [expanded, setExpanded] = useState(false);
  const quietText = BAMBOOK_OS.tone.text.quiet;
  const mainText = 'text-[var(--text-primary)]';
  const detailBg = 'bg-[var(--hover-darken)]';
  const canOpen = Boolean(onReferenceClick && block.toolRunId);

  return (
    <div className="flex items-start gap-2.5 py-1">
      <span className="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center">
        {statusIcon(block.lifecycleStatus, isDarkMode)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[13px] font-light ${mainText}`}>{block.title || block.toolId}</span>
          <span className={`shrink-0 text-[11px] ${quietText}`}>{STATUS_LABEL[block.lifecycleStatus]}</span>
          {block.risk && block.risk !== 'low' && (
            <span className={`shrink-0 rounded-full px-1.5 py-[0.5px] text-[9px] font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>{block.risk}</span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className={`ml-auto shrink-0 p-0.5 rounded-control transition-colors ${quietText} hover:bg-[var(--recessed-bg-hover)]`}
            aria-label={expanded ? '收起详情' : '展开详情'}
          >
            <ChevronRight size={14} className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>
        {expanded && (
          <div className={`mt-1.5 rounded-compact ${detailBg} px-3 py-2`}>
            {block.reason && <div className={`text-[12px] leading-[1.5] ${quietText}`}>{block.reason}</div>}
            {block.error && <div className={`mt-1 text-[12px] leading-[1.5] text-[var(--text-secondary)]`}>{block.error}</div>}
            {block.toolId === 'order.confirm' ? (
              <OrderConfirmFeedbackView
                result={extractOrderConfirmResult(block.outputPreview)}
                errorFeedback={block.errorPreview ?? extractOrderConfirmErrorFeedback(null, extractOrderConfirmResult(block.outputPreview))}
                hasError={Boolean(block.error)}
                isDarkMode={isDarkMode}
              />
            ) : block.outputPreview != null && (() => {
              const text = typeof block.outputPreview === 'string' ? block.outputPreview : (() => {
                try { return JSON.stringify(block.outputPreview, null, 2); } catch { return String(block.outputPreview); }
              })();
              const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text;
              return (
                <pre className={`mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-[1.45] font-mono ${quietText}`}>{truncated}</pre>
              );
            })()}
            {canOpen && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReferenceClick?.({ refId: `ref_${block.toolRunId}`, kind: 'tool_run', label: block.toolId, toolRunId: block.toolRunId, blockId: block.id });
                }}
                className="mt-1.5 text-[11px] text-[var(--os-vnext-brand-blue-strong)] hover:text-[var(--os-vnext-brand-blue)]"
              >
                查看运行详情 →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── 行内证据注解 ──

interface EvidenceAnnotationProps {
  block: AgentEvidenceBlockModel;
  isDarkMode?: boolean;
  onReferenceClick?: (anchor: AgentReferenceAnchor) => void;
}

const EvidenceAnnotation: React.FC<EvidenceAnnotationProps> = ({ block, isDarkMode, onReferenceClick }) => {
  const [expanded, setExpanded] = useState(false);
  const quietText = BAMBOOK_OS.tone.text.quiet;
  const mainText = 'text-[var(--text-primary)]';
  const anchorsByRef = new Map<string, AgentReferenceAnchor>((block.anchors ?? []).map(a => [a.refId, a]));

  return (
    <div className="flex items-start gap-2.5 py-1">
      <span className="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center">
        <FileText size={14} className="text-[var(--os-vnext-brand-blue-strong)]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[13px] font-light ${mainText}`}>{block.title ?? '证据'}</span>
          <span className={`shrink-0 text-[11px] ${quietText}`}>{block.items.length} 条</span>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className={`ml-auto shrink-0 p-0.5 rounded-control transition-colors ${quietText} hover:bg-[var(--recessed-bg-hover)]`}
            aria-label={expanded ? '收起详情' : '展开详情'}
          >
            <ChevronRight size={14} className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>
        {expanded && (
          <div className={`mt-1.5 space-y-1`}>
            {block.items.slice(0, 5).map(item => {
              const anchor = anchorsByRef.get(item.refId);
              return (
                <div key={item.refId} className={`text-[12px] leading-[1.5] ${quietText}`}>
                  <span className="font-light">{item.label}</span>
                  {item.summary && <span> — {item.summary.length > 100 ? item.summary.slice(0, 100) + '...' : item.summary}</span>}
                  {anchor && onReferenceClick && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onReferenceClick(anchor); }}
                      className="ml-1.5 text-[11px] text-[var(--os-vnext-brand-blue-strong)] hover:text-[var(--os-vnext-brand-blue)]"
                    >
                      查看
                    </button>
                  )}
                </div>
              );
            })}
            {block.items.length > 5 && (
              <div className={`text-[11px] ${quietText}`}>...还有 {block.items.length - 5} 条</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── 行内审批注解 ──

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
            {draft.impactScope.map((scope, idx) => (
              <span key={idx} className={`min-w-0 max-w-full truncate rounded-full px-1.5 py-0.5 text-[10.5px] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
                {scope}
              </span>
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
          {draft.postCommitHooks.map((hook: AgentProcessDraftPostCommitHook, idx) => (
            <span key={idx} className={`flex min-w-0 max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
              <Mail size={14} className="shrink-0" />
              <span className="min-w-0 truncate">提交后 · {HOOK_TYPE_LABEL[hook.type] ?? hook.type}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

interface ApprovalAnnotationProps {
  block: AgentApprovalBlockModel;
  isDarkMode?: boolean;
  onExecuteAction?: AgentBlockComponentProps<AgentApprovalBlockModel>['onExecuteAction'];
}

const ApprovalAnnotation: React.FC<ApprovalAnnotationProps> = ({ block, isDarkMode, onExecuteAction }) => {
  const quietText = 'text-[var(--text-tertiary)]';
  const mainText = 'text-[var(--text-primary)]';
  const borderCls = 'border-[var(--border-c-subtle)]';
  const isPending = block.approvalStatus === 'pending';

  const approvalStatusLabel: Record<AgentApprovalBlockModel['approvalStatus'], string> = {
    pending: '等待审批',
    approved: '已批准',
    rejected: '已拒绝',
    modified: '已修改',
  };

  return (
    <div className={`flex items-start gap-2.5 py-2 px-3 rounded-inset border ${isPending ? 'bg-[var(--recessed-bg)] border-[var(--border-c-subtle)]' : ''} ${!isPending ? borderCls : ''}`}>
      <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">
        <ShieldCheck size={14} className="text-[var(--text-secondary)]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[13px] font-light ${mainText}`}>{block.title ?? '需要确认'}</span>
          <span className={`shrink-0 text-[11px] ${quietText}`}>{approvalStatusLabel[block.approvalStatus]}</span>
        </div>
        {block.proposedAction && <div className={`mt-0.5 text-[12px] leading-[1.5] ${quietText}`}>{block.proposedAction}</div>}
        {block.processDraft && <ProcessDraftView draft={block.processDraft} isDarkMode={isDarkMode} />}
        {isPending && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onExecuteAction?.({ actionId: block.approvalId, actionType: 'approval', payload: { approvalId: block.approvalId, decision: 'approved', toolId: block.toolId, input: block.input }, risk: block.risk, label: '批准' })}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-light transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}
            >
              批准
            </button>
            <button
              type="button"
              onClick={() => onExecuteAction?.({ actionId: block.approvalId, actionType: 'approval', payload: { approvalId: block.approvalId, decision: 'rejected', toolId: block.toolId }, risk: block.risk, label: '拒绝' })}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-light transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() => onExecuteAction?.({ actionId: block.approvalId, actionType: 'approval', payload: { approvalId: block.approvalId, decision: 'modified', toolId: block.toolId, input: block.input, editableFields: block.editableFields }, risk: block.risk, label: '修改参数' })}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-light transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}
            >
              修改参数
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── 流式 Markdown 段落 ──

interface StreamMarkdownProps {
  block: import('../../types').AgentMarkdownBlock;
  isDarkMode?: boolean;
}

const StreamMarkdown: React.FC<StreamMarkdownProps> = ({ block, isDarkMode }) => {
  // 直接用 MarkdownRenderer 渲染，不包容器
  return <MarkdownRenderer content={block.content} isDarkMode={isDarkMode} />;
};

// ── 连续过程注解组（压缩摘要行）──

interface ProcessGroupProps {
  blocks: AgentResponseBlock[];
  isDarkMode?: boolean;
  isStreaming?: boolean;
  onReferenceClick?: (anchor: AgentReferenceAnchor) => void;
  onExecuteAction?: AgentBlockComponentProps<AgentApprovalBlockModel>['onExecuteAction'];
}

const ProcessGroup: React.FC<ProcessGroupProps> = ({ blocks, isDarkMode, isStreaming, onReferenceClick, onExecuteAction }) => {
  const [expanded, setExpanded] = useState(false);
  const quietText = 'text-[var(--text-tertiary)]';
  const mainText = 'text-[var(--text-primary)]';

  // 统计摘要
  const summary = useMemo(() => {
    let succeeded = 0, failed = 0, running = 0, evidenceCount = 0, pendingApprovals = 0;
    for (const b of blocks) {
      if (b.type === 'evidence') { evidenceCount += 1; continue; }
      if (b.type === 'approval') { if ((b as AgentApprovalBlockModel).approvalStatus === 'pending') pendingApprovals += 1; continue; }
      if (b.type === 'tool') {
        const s = (b as AgentToolLifecycleBlockModel).lifecycleStatus;
        if (s === 'succeeded') succeeded += 1;
        else if (s === 'failed' || s === 'blocked') failed += 1;
        else running += 1;
      }
    }
    return { succeeded, failed, running, evidenceCount, pendingApprovals, total: blocks.length };
  }, [blocks]);

  // 把 approval 块单独抽出来 — 它们永远展开，永远可见
  const approvalBlocks = blocks.filter(b => b.type === 'approval') as AgentApprovalBlockModel[];
  const processBlocks = blocks.filter(b => b.type !== 'approval');

  const hasPendingApproval = summary.pendingApprovals > 0;

  // ★ 核心改动：
  // streaming 时，完全不渲染 processBlocks（工具/证据日志），只渲染 approval。
  // 思考过程由 message.text 里的自然语言叙述来体现，不需要机械的工具日志。
  // 完成态：processBlocks 折叠为一个小链接，点开才看到详情。
  if (isStreaming) {
    // 流式中：如果有审批，显示审批；否则什么都不显示
    if (approvalBlocks.length === 0) return null;
    return (
      <div className="space-y-2">
        {approvalBlocks.map(block => (
          <ApprovalAnnotation key={block.id} block={block} isDarkMode={isDarkMode} onExecuteAction={onExecuteAction} />
        ))}
      </div>
    );
  }

  // 完成态
  return (
    <div>
      {/* 审批块 — 永远独立渲染，永远可见 */}
      {approvalBlocks.length > 0 && (
        <div className="mb-3 space-y-2">
          {approvalBlocks.map(block => (
            <ApprovalAnnotation key={block.id} block={block} isDarkMode={isDarkMode} onExecuteAction={onExecuteAction} />
          ))}
        </div>
      )}

      {/* 工具执行详情 — 默认折叠，只有一行提示文字，点击展开 */}
      {processBlocks.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className={`bds-btn bds-btn-link text-[11.5px] ${quietText}`}
          >
            {expanded ? '收起操作详情' : `查看 ${summary.succeeded + summary.failed} 个操作步骤`}
          </button>
          {expanded && (
            <div className={`mt-1.5 ml-2 border-l border-[var(--border-c-subtle)] pl-3 space-y-0.5`}>
              {processBlocks.map(block => {
                if (block.type === 'tool') return <ToolAnnotation key={block.id} block={block as AgentToolLifecycleBlockModel} isDarkMode={isDarkMode} onReferenceClick={onReferenceClick} />;
                if (block.type === 'evidence') return <EvidenceAnnotation key={block.id} block={block as AgentEvidenceBlockModel} isDarkMode={isDarkMode} onReferenceClick={onReferenceClick} />;
                return null;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── 主渲染器 ──

export interface AgentDocumentRendererProps {
  blocks: AgentResponseBlock[];
  isDarkMode?: boolean;
  isStreaming?: boolean;
  onExecuteAction?: AgentBlockComponentProps<AgentResponseBlock>['onExecuteAction'];
  onReferenceClick?: AgentBlockComponentProps<AgentResponseBlock>['onReferenceClick'];
  onArtifactClick?: AgentBlockComponentProps<AgentResponseBlock>['onArtifactClick'];
}

interface DocSegment {
  kind: 'process' | 'markdown' | 'rich';
  blocks: AgentResponseBlock[];
}

/**
 * 把 blocks 数组按类型分成文档段落：
 * - 连续的 tool/evidence/approval → process 段（一行摘要 + 可展开注解）
 * - markdown → 独立段落（裸渲染）
 * - 其他 rich block → 独立段落（用 blockRegistry 组件）
 */
const segmentBlocks = (blocks: AgentResponseBlock[]): DocSegment[] => {
  const segments: DocSegment[] = [];
  let buffer: AgentResponseBlock[] = [];
  const flushProcess = () => {
    if (buffer.length === 0) return;
    segments.push({ kind: 'process', blocks: buffer });
    buffer = [];
  };
  for (const b of blocks) {
    if (PROCESS_TYPES.has(b.type) || b.type === 'approval') {
      buffer.push(b);
    } else if (b.type === 'markdown') {
      flushProcess();
      segments.push({ kind: 'markdown', blocks: [b] });
    } else {
      flushProcess();
      segments.push({ kind: 'rich', blocks: [b] });
    }
  }
  flushProcess();
  return segments;
};

export const AgentDocumentRenderer: React.FC<AgentDocumentRendererProps> = ({
  blocks,
  isDarkMode,
  isStreaming,
  onExecuteAction,
  onReferenceClick,
  onArtifactClick,
}) => {
  const segments = useMemo(() => segmentBlocks(blocks), [blocks]);

  // 完成态时答案前置：markdown + rich 段移到前面，process 段留在后面
  // 但如果 process 段包含 pending approval，不后移 — 审批必须紧跟在答案之后
  const reordered = useMemo(() => {
    if (isStreaming) return segments;
    const answers: DocSegment[] = [];
    const tail: DocSegment[] = [];
    for (const seg of segments) {
      if (seg.kind === 'markdown' || seg.kind === 'rich') {
        answers.push(seg);
      } else {
        // process segment — 检查是否有 pending approval
        const hasPending = seg.blocks.some(b => b.type === 'approval' && (b as AgentApprovalBlockModel).approvalStatus === 'pending');
        if (hasPending) {
          answers.push(seg); // 审批段保持显眼位置
        } else {
          tail.push(seg);
        }
      }
    }
    return [...answers, ...tail];
  }, [segments, isStreaming]);

  return (
    <div className="space-y-4">
      {reordered.map((seg, idx) => {
        if (seg.kind === 'process') {
          return (
            <AgentBlockErrorBoundary
              key={`proc_${idx}_${seg.blocks[0]?.id ?? ''}`}
              isDarkMode={isDarkMode}
              resetKey={`${isStreaming ? 'streaming' : 'complete'}:${seg.blocks.length}`}
            >
              <ProcessGroup
                blocks={seg.blocks}
                isDarkMode={isDarkMode}
                isStreaming={isStreaming}
                onReferenceClick={onReferenceClick}
                onExecuteAction={onExecuteAction as any}
              />
            </AgentBlockErrorBoundary>
          );
        }
        if (seg.kind === 'markdown') {
          const block = seg.blocks[0] as import('../../types').AgentMarkdownBlock;
          return (
            <AgentBlockErrorBoundary key={block.id} isDarkMode={isDarkMode} resetKey={block.status}>
              <StreamMarkdown block={block} isDarkMode={isDarkMode} />
            </AgentBlockErrorBoundary>
          );
        }
        // rich block (table/metric/chart/diagram/mermaid/artifact/nextActions)
        const block = seg.blocks[0];
        const Renderer = blockRegistry[block.type] ?? AgentUnsupportedBlock;
        return (
          <AgentBlockErrorBoundary key={block.id} isDarkMode={isDarkMode} resetKey={block.status}>
            <Renderer
              block={block as any}
              isDarkMode={isDarkMode}
              onExecuteAction={onExecuteAction}
              onReferenceClick={onReferenceClick}
              onArtifactClick={onArtifactClick}
            />
          </AgentBlockErrorBoundary>
        );
      })}
    </div>
  );
};
