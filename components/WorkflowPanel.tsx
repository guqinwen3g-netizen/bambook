/**
 * WorkflowPanel — 审批中心（Approval Center）
 *
 * 功能（三个分区）：
 *   1. 审批单 Approvals — /v1/approvals 业务审批列表 + 决策；展开详情含：
 *      - DR-007 路由解析轨迹（resolveReviewerByDepartment：请求人部门 → 部门主管 → 兜底链）
 *      - 委派 delegation（当前审批人可转派，reason ≥10 字；展示委派记录）
 *      - BOSS 兜底标识与特批（owner 专属，reason ≥30 字；路由兜底 FALLBACK_* 明确标识）
 *   2. 例外申请 Exceptions — DR-013 受控例外：列表/详情卡片/发起表单/撤回/BOSS 兜底/
 *      门禁查询 gate-check；监听 EXCEPTION_ENTRY_EVENT（门禁阻断入口联动）
 *   3. 工作流实例 Workflows — 既有工作流引擎实例审批
 *
 * 设计：flat 无阴影、大圆角、半透明膜色；全部真实 API，无 mock。
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Workflow, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight,
  RefreshCw, AlertTriangle, User, GitBranch, UserCheck, ShieldAlert,
  FileWarning, CornerUpRight, Search, PlusCircle,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { WorkflowInstance, WorkflowInstanceStatus } from '../types';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import {
  approvalKernelService,
  type ApprovalKernelListItem,
  type ApprovalResolutionTrace,
  RESOLVER_ROUTE_LABEL,
  isFallbackRoute,
} from '../services/approvalKernelService';
import {
  exceptionService,
  openExceptionEntry,
  EXCEPTION_ENTRY_EVENT,
  EXCEPTION_ENTRY_HINT,
  EXCEPTION_CATEGORIES,
  EXCEPTION_CATEGORY_LABEL,
  EXCEPTION_STATUS_LABEL,
  type Dr013ExceptionView,
  type ExceptionCategory,
  type ExceptionStatus,
  type ExceptionEntryDetail,
  type GateCheckResult,
} from '../services/exceptionService';
import { getAuthState, hasRole } from '../services/authService';

// ── 状态 → 显示 ──
const STATUS_LABEL: Record<WorkflowInstanceStatus, string> = {
  running: '运行中',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消',
};

const STATUS_COLOR: Record<WorkflowInstanceStatus, string> = {
  running: 'text-blue-400',
  approved: 'text-emerald-400',
  rejected: 'text-red-400',
  cancelled: 'text-[var(--text-tertiary)]',
};

const STATUS_BG: Record<WorkflowInstanceStatus, string> = {
  running: 'bg-blue-400/8',
  approved: 'bg-emerald-400/8',
  rejected: 'bg-red-400/8',
  cancelled: 'bg-[var(--recessed-bg)]',
};

const EXCEPTION_STATUS_COLOR: Record<ExceptionStatus, string> = {
  Pending: 'text-blue-400',
  ReviewerApproved: 'text-emerald-400',
  ReviewerRejected: 'text-red-400',
  BossFinalBypass: 'text-[var(--os-vnext-brand-blue)]',
  Consumed: 'text-[var(--text-tertiary)]',
  Expired: 'text-[var(--text-tertiary)]',
  Cancelled: 'text-[var(--text-tertiary)]',
};

// ── 时间格式化 ──
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface WorkflowPanelProps {
  isDarkMode: boolean;
}

/** 共享样式皮肤（扁平 token，全部 CSS 变量自适应主题） */
interface Skin {
  card: string;
  primaryText: string;
  weakText: string;
  brandIcon: string;
  inputCls: string;
  dividerCls: string;
}

const DELEGATE_REASON_MIN = 10;
const BOSS_REASON_MIN = 30;
const EXCEPTION_REASON_MIN = 30;

// ══════════════════════════════════════════════════════════════════
// 审批单分区（/v1/approvals + /v1/approvals-kernel）
// ══════════════════════════════════════════════════════════════════
function ApprovalsSection({ skin }: { skin: Skin }) {
  const { card, primaryText, weakText, brandIcon, inputCls, dividerCls } = skin;
  const [view, setView] = useState<'pending' | 'done'>('pending');
  const [items, setItems] = useState<ApprovalKernelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [traces, setTraces] = useState<Record<string, { loading: boolean; error?: string; data?: ApprovalResolutionTrace }>>({});
  const [decideNote, setDecideNote] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [delegateFor, setDelegateFor] = useState<string | null>(null);
  const [delegateForm, setDelegateForm] = useState<{ toUserId: string; reason: string }>({ toUserId: '', reason: '' });
  const [bossFor, setBossFor] = useState<string | null>(null);
  const [bossReason, setBossReason] = useState('');

  const currentUserId = getAuthState().user?.id ?? '';
  const isOwner = hasRole('owner');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await approvalKernelService.listBusinessApprovals(view);
      setItems(list);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const loadTrace = useCallback(async (id: string) => {
    setTraces(prev => ({ ...prev, [id]: { loading: true } }));
    try {
      const data = await approvalKernelService.getResolutionTrace(id);
      setTraces(prev => ({ ...prev, [id]: { loading: false, data } }));
    } catch (e: any) {
      setTraces(prev => ({ ...prev, [id]: { loading: false, error: String(e?.message || e) } }));
    }
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      if (next && !traces[next]?.data) loadTrace(next);
      return next;
    });
  }, [traces, loadTrace]);

  const handleDecide = useCallback(async (id: string, status: 'approved' | 'rejected') => {
    setActionLoading(id);
    setError(null);
    try {
      await approvalKernelService.decideApproval(id, status, decideNote[id]?.trim() || undefined);
      await fetchItems();
      setDecideNote(prev => { const next = { ...prev }; delete next[id]; return next; });
      setExpandedId(null);
    } catch (e: any) {
      setError(`决策失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [decideNote, fetchItems]);

  const handleDelegate = useCallback(async (id: string) => {
    setActionLoading(id);
    setError(null);
    try {
      await approvalKernelService.delegateApproval(id, {
        toUserId: delegateForm.toUserId.trim(),
        reason: delegateForm.reason.trim(),
      });
      setDelegateFor(null);
      setDelegateForm({ toUserId: '', reason: '' });
      await fetchItems();
      setTraces({});
    } catch (e: any) {
      setError(`委派失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [delegateForm, fetchItems]);

  const handleBossBypass = useCallback(async (id: string) => {
    setActionLoading(id);
    setError(null);
    try {
      await approvalKernelService.bossBypassApproval(id, bossReason.trim());
      setBossFor(null);
      setBossReason('');
      await fetchItems();
    } catch (e: any) {
      setError(`BOSS 兜底特批失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [bossReason, fetchItems]);

  return (
    <div className="space-y-3">
      {/* ── 待办 / 已办切换 ── */}
      <div className="flex flex-wrap gap-1.5">
        {([['pending', '待审批 Pending'], ['done', '已办 Done']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`rounded-control px-3 py-1 text-xs font-light transition-all ${
              view === id
                ? 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={`${card} rounded-card p-8 flex items-center justify-center`}>
          <RefreshCw size={18} strokeWidth={1.2} className={`animate-spin ${brandIcon}`} />
        </div>
      ) : items.length === 0 ? (
        <div className={`${card} rounded-card p-8 flex flex-col items-center justify-center gap-2`}>
          <UserCheck size={24} strokeWidth={1} className="text-[var(--text-quaternary)]" />
          <span className={`text-xs font-light ${weakText}`}>{view === 'pending' ? '暂无待审批单' : '暂无已办审批'}</span>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const isExpanded = expandedId === item.id;
            const isPending = item.status === 'pending';
            const canDelegate = isPending && currentUserId && item.reviewerId === currentUserId;
            const trace = traces[item.id];
            return (
              <div key={item.id} className={`${card} rounded-card overflow-hidden`}>
                {/* ── 卡片头 ── */}
                <div
                  className="flex items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                  onClick={() => toggleExpand(item.id)}
                >
                  {isExpanded ? (
                    <ChevronDown size={14} strokeWidth={1.5} className={`mt-1 ${weakText}`} />
                  ) : (
                    <ChevronRight size={14} strokeWidth={1.5} className={`mt-1 ${weakText}`} />
                  )}
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    item.status === 'approved' ? STATUS_BG.approved
                      : item.status === 'rejected' ? STATUS_BG.rejected
                        : item.status === 'cancelled' ? STATUS_BG.cancelled : STATUS_BG.running
                  }`}>
                    {item.status === 'approved' ? (
                      <CheckCircle size={14} strokeWidth={1.5} className={STATUS_COLOR.approved} />
                    ) : item.status === 'rejected' ? (
                      <XCircle size={14} strokeWidth={1.5} className={STATUS_COLOR.rejected} />
                    ) : (
                      <Clock size={14} strokeWidth={1.5} className={STATUS_COLOR.running} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-light ${primaryText}`}>{item.actionType}</span>
                      <span className={`text-[10px] font-light ${weakText}`}>{item.targetType}{item.targetId ? ` · ${item.targetId}` : ''}</span>
                      {/* BOSS 最终兜底特批标识 */}
                      {item.bossFinalBypassBy && (
                        <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--danger-tint)] text-[var(--danger-text)]">
                          <ShieldAlert size={10} strokeWidth={1.5} />
                          BOSS 最终兜底特批
                        </span>
                      )}
                      {/* DR-007 路由兜底标识 */}
                      {isFallbackRoute(item.reviewerResolverRoute) && (
                        <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-light bg-blue-400/8 text-blue-400">
                          <GitBranch size={10} strokeWidth={1.5} />
                          路由兜底 {item.reviewerResolverRoute ? RESOLVER_ROUTE_LABEL[item.reviewerResolverRoute] : ''}
                        </span>
                      )}
                      {item.delegatedBy && (
                        <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">
                          <CornerUpRight size={10} strokeWidth={1.5} />
                          已委派
                        </span>
                      )}
                    </div>
                    <div className={`mt-0.5 text-xs font-light ${weakText}`}>
                      申请人：{item.requester?.displayName || item.requesterId}
                      {' · '}审批人：{item.reviewer?.displayName || item.reviewerId || '—'}
                      {item.risk && ` · 风险 ${item.risk}`}
                    </div>
                  </div>
                  <div className={`text-[10px] font-light ${weakText} shrink-0`}>{formatTime(item.createdAt)}</div>
                </div>

                {/* ── 展开详情 ── */}
                {isExpanded && (
                  <div className={`border-t ${dividerCls} px-4 py-3 space-y-3`}>
                    {/* 决策备注 */}
                    {item.decisionNote && (
                      <div className={`text-xs font-light ${weakText}`}>审批意见：{item.decisionNote}</div>
                    )}

                    {/* ── 路由解析轨迹（DR-007） ── */}
                    <div className="rounded-inset bg-[var(--recessed-bg)] px-3 py-2.5 space-y-1.5">
                      <div className={`flex items-center gap-1.5 text-[11px] font-light ${primaryText}`}>
                        <GitBranch size={12} strokeWidth={1.5} className={brandIcon} />
                        路由解析轨迹 Resolution Trace
                      </div>
                      {trace?.loading ? (
                        <div className={`flex items-center gap-1.5 text-[11px] font-light ${weakText}`}>
                          <RefreshCw size={10} strokeWidth={1.5} className="animate-spin" />
                          轨迹加载中…
                        </div>
                      ) : trace?.error ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-light text-[var(--danger-text)]">
                          <AlertTriangle size={10} strokeWidth={1.5} />
                          {trace.error}
                          <button type="button" onClick={() => loadTrace(item.id)} className={`underline ${brandIcon}`}>重试</button>
                        </div>
                      ) : trace?.data ? (
                        <div className={`text-[11px] font-light ${weakText} space-y-1`}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>请求人 {trace.data.requesterId}</span>
                            <ChevronRight size={10} strokeWidth={1.5} />
                            <span>部门快照 {trace.data.departmentSnapshotId || 'DEPT_NONE'}</span>
                            <ChevronRight size={10} strokeWidth={1.5} />
                            <span>{trace.data.reviewerResolverRoute ? RESOLVER_ROUTE_LABEL[trace.data.reviewerResolverRoute] : '未记录解析路径'}</span>
                            <ChevronRight size={10} strokeWidth={1.5} />
                            <span className={primaryText}>审批人 {trace.data.reviewerId || '—'}</span>
                          </div>
                          {trace.data.delegatedBy && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <CornerUpRight size={10} strokeWidth={1.5} />
                              <span>
                                委派记录：{trace.data.delegatedBy} 于 {formatTime(trace.data.delegatedAt)} 转派
                                {trace.data.delegateReason ? `，理由：${trace.data.delegateReason}` : ''}
                              </span>
                            </div>
                          )}
                          {trace.data.bossFinalBypassBy && (
                            <div className="flex items-center gap-1.5 flex-wrap text-[var(--danger-text)]">
                              <ShieldAlert size={10} strokeWidth={1.5} />
                              <span>
                                BOSS 最终兜底特批：{trace.data.bossFinalBypassBy} 于 {formatTime(trace.data.bossFinalBypassAt)}
                              </span>
                            </div>
                          )}
                          {trace.data.clientReviewerIdSupplied && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <AlertTriangle size={10} strokeWidth={1.5} />
                              <span>前端曾传入 reviewerId（已忽略，仅审计标记；服务端 DR-007 解析为唯一真源）</span>
                            </div>
                          )}
                          {trace.data.bypassedApprovalId && (
                            <div>被 DR-013 例外绕过，关联例外审批单：{trace.data.bypassedApprovalId}</div>
                          )}
                        </div>
                      ) : null}
                    </div>

                    {/* ── 决策操作（仅 pending） ── */}
                    {isPending && (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="审批备注（驳回必填）"
                          value={decideNote[item.id] || ''}
                          onChange={e => setDecideNote(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className={inputCls}
                          disabled={actionLoading === item.id}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={actionLoading === item.id}
                            onClick={() => handleDecide(item.id, 'approved')}
                            className={`flex-1 rounded-control py-2 text-xs font-light transition-all bg-[var(--success-tint)] text-[var(--success-text)] hover:bg-[var(--success-tint-hover)] ${actionLoading === item.id ? 'opacity-50 cursor-wait' : ''}`}
                          >
                            <CheckCircle size={12} strokeWidth={1.5} className="inline mr-1" />
                            通过
                          </button>
                          <button
                            type="button"
                            disabled={actionLoading === item.id}
                            onClick={() => handleDecide(item.id, 'rejected')}
                            className={`flex-1 rounded-control py-2 text-xs font-light transition-all bg-[var(--danger-tint)] text-[var(--danger-text)] hover:bg-[var(--danger-tint-hover)] ${actionLoading === item.id ? 'opacity-50 cursor-wait' : ''}`}
                          >
                            <XCircle size={12} strokeWidth={1.5} className="inline mr-1" />
                            驳回
                          </button>
                        </div>

                        {/* ── 委派入口（仅当前审批人本人） ── */}
                        {canDelegate && (
                          <div className={`pt-2 border-t ${dividerCls} space-y-2`}>
                            {delegateFor === item.id ? (
                              <>
                                <div className={`flex items-center gap-1.5 text-[11px] font-light ${primaryText}`}>
                                  <CornerUpRight size={12} strokeWidth={1.5} className={brandIcon} />
                                  委派给他人 Delegate
                                </div>
                                <input
                                  type="text"
                                  placeholder="被委派人用户 ID（禁止委派给申请人）"
                                  value={delegateForm.toUserId}
                                  onChange={e => setDelegateForm(prev => ({ ...prev, toUserId: e.target.value }))}
                                  className={inputCls}
                                />
                                <input
                                  type="text"
                                  placeholder={`委派理由（至少 ${DELEGATE_REASON_MIN} 字，审计强制）`}
                                  value={delegateForm.reason}
                                  onChange={e => setDelegateForm(prev => ({ ...prev, reason: e.target.value }))}
                                  className={inputCls}
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={actionLoading === item.id || delegateForm.toUserId.trim().length === 0 || delegateForm.reason.trim().length < DELEGATE_REASON_MIN}
                                    onClick={() => handleDelegate(item.id)}
                                    className={`flex-1 rounded-control py-2 text-xs font-light transition-all bg-[var(--recessed-bg-strong)] text-[var(--text-primary)] hover:bg-[var(--recessed-bg-hover)] ${actionLoading === item.id || delegateForm.toUserId.trim().length === 0 || delegateForm.reason.trim().length < DELEGATE_REASON_MIN ? 'opacity-50' : ''}`}
                                  >
                                    确认委派
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setDelegateFor(null); setDelegateForm({ toUserId: '', reason: '' }); }}
                                    className={`rounded-control px-3 py-2 text-xs font-light ${weakText} hover:bg-[var(--recessed-bg-hover)]`}
                                  >
                                    取消
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDelegateFor(item.id)}
                                className={`flex items-center gap-1 rounded-control px-2.5 py-1 text-xs font-light ${brandIcon} hover:bg-[var(--active-darken)] transition-colors`}
                              >
                                <CornerUpRight size={12} strokeWidth={1.5} />
                                委派 Delegate
                              </button>
                            )}
                          </div>
                        )}

                        {/* ── BOSS 兜底特批（仅 owner） ── */}
                        {isOwner && (
                          <div className={`pt-2 border-t ${dividerCls} space-y-2`}>
                            {bossFor === item.id ? (
                              <>
                                <div className="flex items-center gap-1.5 text-[11px] font-light text-[var(--danger-text)]">
                                  <ShieldAlert size={12} strokeWidth={1.5} />
                                  BOSS 最终兜底特批 Final Bypass（绝密级审计）
                                </div>
                                <input
                                  type="text"
                                  placeholder={`特批理由（至少 ${BOSS_REASON_MIN} 字，当前 ${bossReason.trim().length} 字）`}
                                  value={bossReason}
                                  onChange={e => setBossReason(e.target.value)}
                                  className={inputCls}
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={actionLoading === item.id || bossReason.trim().length < BOSS_REASON_MIN}
                                    onClick={() => handleBossBypass(item.id)}
                                    className={`flex-1 rounded-control py-2 text-xs font-light transition-all bg-[var(--danger-tint)] text-[var(--danger-text)] hover:bg-[var(--danger-tint-hover)] ${actionLoading === item.id || bossReason.trim().length < BOSS_REASON_MIN ? 'opacity-50' : ''}`}
                                  >
                                    确认 BOSS 兜底特批
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setBossFor(null); setBossReason(''); }}
                                    className={`rounded-control px-3 py-2 text-xs font-light ${weakText} hover:bg-[var(--recessed-bg-hover)]`}
                                  >
                                    取消
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setBossFor(item.id)}
                                className="flex items-center gap-1 rounded-control px-2.5 py-1 text-xs font-light text-[var(--danger-text)] hover:bg-[var(--danger-tint)] transition-colors"
                              >
                                <ShieldAlert size={12} strokeWidth={1.5} />
                                BOSS 兜底特批
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && (
        <div className="rounded-control px-4 py-2 text-xs bg-[var(--danger-tint)] text-[var(--danger-text)]">
          {error}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// DR-013 例外申请分区
// ══════════════════════════════════════════════════════════════════
interface ExceptionFormState {
  exceptionCategory: ExceptionCategory;
  subCategory: string;
  targetType: string;
  targetId: string;
  action: string;
  validUntil: string;
  maxUses: string;
  responsibleOwnerId: string;
  exceptionReason: string;
  riskMitigationPlan: string;
  customerCommitment: string;
  bypassedApprovalIds: string;
  notes: string;
}

const EMPTY_EXCEPTION_FORM: ExceptionFormState = {
  exceptionCategory: 'other',
  subCategory: '',
  targetType: '',
  targetId: '',
  action: '',
  validUntil: '',
  maxUses: '1',
  responsibleOwnerId: '',
  exceptionReason: '',
  riskMitigationPlan: '',
  customerCommitment: '',
  bypassedApprovalIds: '',
  notes: '',
};

function ExceptionsSection({ skin, entryPrefill, onConsumePrefill }: {
  skin: Skin;
  entryPrefill: ExceptionEntryDetail | null;
  onConsumePrefill: () => void;
}) {
  const { card, primaryText, weakText, brandIcon, inputCls, dividerCls } = skin;
  const [items, setItems] = useState<Dr013ExceptionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExceptionStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ExceptionFormState>(EMPTY_EXCEPTION_FORM);
  const [entryBanner, setEntryBanner] = useState<ExceptionEntryDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [gateCheck, setGateCheck] = useState<{ loading: boolean; result?: GateCheckResult; error?: string }>({ loading: false });
  const [bossFor, setBossFor] = useState<string | null>(null);
  const [bossReason, setBossReason] = useState('');

  const currentUserId = getAuthState().user?.id ?? '';
  const isOwner = hasRole('owner');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await exceptionService.listExceptions({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 100,
      });
      setItems(list);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // 门禁阻断入口：预填表单 + 打开
  useEffect(() => {
    if (!entryPrefill) return;
    setForm(prev => ({
      ...prev,
      targetType: entryPrefill.targetType ?? prev.targetType,
      targetId: entryPrefill.targetId ?? prev.targetId,
      action: entryPrefill.action ?? prev.action,
      exceptionCategory: entryPrefill.exceptionCategory ?? prev.exceptionCategory,
    }));
    setEntryBanner(entryPrefill);
    setShowForm(true);
    onConsumePrefill();
  }, [entryPrefill, onConsumePrefill]);

  const setField = useCallback(<K extends keyof ExceptionFormState>(key: K, value: ExceptionFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const runGateCheck = useCallback(async () => {
    setGateCheck({ loading: true });
    try {
      const result = await exceptionService.gateCheck({
        targetType: form.targetType.trim(),
        targetId: form.targetId.trim(),
        action: form.action.trim(),
      });
      setGateCheck({ loading: false, result });
    } catch (e: any) {
      setGateCheck({ loading: false, error: String(e?.message || e) });
    }
  }, [form.targetType, form.targetId, form.action]);

  const handleCreate = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const bypassedApprovalIds = form.bypassedApprovalIds
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const maxUses = Number(form.maxUses);
      const created = await exceptionService.createException({
        exceptionCategory: form.exceptionCategory,
        subCategory: form.subCategory.trim() || null,
        targetType: form.targetType.trim(),
        targetId: form.targetId.trim(),
        action: form.action.trim(),
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
        maxUses: Number.isInteger(maxUses) && maxUses >= 1 ? maxUses : undefined,
        responsibleOwnerId: form.responsibleOwnerId.trim(),
        exceptionReason: form.exceptionReason.trim(),
        riskMitigationPlan: form.riskMitigationPlan.trim(),
        customerCommitment: form.customerCommitment.trim() || null,
        bypassedApprovalIds,
        notes: form.notes.trim() || null,
      });
      setNotice(`例外申请 ${created.exception.exceptionNumber} 已提交（审批单 ${created.approvalRequestId}，DR-007 服务端解析审批人）`);
      setForm(EMPTY_EXCEPTION_FORM);
      setShowForm(false);
      setEntryBanner(null);
      await fetchItems();
    } catch (e: any) {
      setError(`发起例外申请失败：${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  }, [form, fetchItems]);

  const handleWithdraw = useCallback(async (id: string) => {
    setActionLoading(id);
    setError(null);
    try {
      await exceptionService.withdrawException(id);
      await fetchItems();
    } catch (e: any) {
      setError(`撤回失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [fetchItems]);

  const handleBossBypass = useCallback(async (id: string) => {
    setActionLoading(id);
    setError(null);
    try {
      await exceptionService.bossBypassException(id, bossReason.trim());
      setBossFor(null);
      setBossReason('');
      await fetchItems();
    } catch (e: any) {
      setError(`BOSS 兜底特批失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [bossReason, fetchItems]);

  const reasonLen = form.exceptionReason.trim().length;
  const formValid =
    form.targetType.trim() && form.targetId.trim() && form.action.trim() &&
    form.responsibleOwnerId.trim() && form.riskMitigationPlan.trim() &&
    reasonLen >= EXCEPTION_REASON_MIN;

  const STATUS_FILTERS: (ExceptionStatus | 'all')[] = [
    'all', 'Pending', 'ReviewerApproved', 'ReviewerRejected', 'BossFinalBypass', 'Consumed', 'Expired', 'Cancelled',
  ];

  return (
    <div className="space-y-3">
      {/* ── 状态过滤 + 发起入口 ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-control px-3 py-1 text-xs font-light transition-all ${
              statusFilter === s
                ? 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]'
            }`}
          >
            {s === 'all' ? '全部' : EXCEPTION_STATUS_LABEL[s]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setShowForm(prev => !prev); setEntryBanner(null); }}
          className={`ml-auto flex items-center gap-1 rounded-control px-2.5 py-1 text-xs font-light ${brandIcon} hover:bg-[var(--active-darken)] transition-colors`}
        >
          <PlusCircle size={12} strokeWidth={1.5} />
          发起例外申请
        </button>
      </div>

      {notice && (
        <div className="rounded-control px-4 py-2 text-xs bg-[var(--success-tint)] text-[var(--success-text)]">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-control px-4 py-2 text-xs bg-[var(--danger-tint)] text-[var(--danger-text)]">
          {error}
        </div>
      )}

      {/* ── 发起表单 ── */}
      {showForm && (
        <div className={`${card} rounded-card p-4 space-y-3`}>
          <div className={`flex items-center gap-1.5 text-sm font-light ${primaryText}`}>
            <FileWarning size={14} strokeWidth={1.5} className={brandIcon} />
            发起 DR-013 受控例外申请 New Exception
          </div>
          {entryBanner && (
            <div className="rounded-control px-3 py-2 text-[11px] font-light bg-blue-400/8 text-blue-400">
              从门禁阻断进入{entryBanner.gate ? `（门禁 ${entryBanner.gate}）` : ''}
              {entryBanner.blockingReasons?.length ? `，阻断原因：${entryBanner.blockingReasons.join(', ')}` : ''}
            </div>
          )}
          <div className={`text-[10px] font-light ${weakText}`}>{EXCEPTION_ENTRY_HINT}</div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>例外类型 Category</span>
              <select
                value={form.exceptionCategory}
                onChange={e => setField('exceptionCategory', e.target.value as ExceptionCategory)}
                className={inputCls}
              >
                {EXCEPTION_CATEGORIES.map(c => (
                  <option key={c} value={c}>{EXCEPTION_CATEGORY_LABEL[c]}（{c}）</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>子类 Sub-category（可选）</span>
              <input type="text" value={form.subCategory} onChange={e => setField('subCategory', e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>受影响对象类型 targetType</span>
              <input type="text" placeholder="如 Shipment / Order / Quotation" value={form.targetType} onChange={e => setField('targetType', e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>指定订单 / 对象 targetId</span>
              <input type="text" placeholder="精确对象 ID（绝不模糊匹配）" value={form.targetId} onChange={e => setField('targetId', e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>指定动作 action</span>
              <input type="text" placeholder="如 shipment:release" value={form.action} onChange={e => setField('action', e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>指定时点 validUntil（可选，过期自动失效）</span>
              <input type="datetime-local" value={form.validUntil} onChange={e => setField('validUntil', e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>核销次数 maxUses（默认 1 = 一次性）</span>
              <input type="number" min={1} step={1} value={form.maxUses} onChange={e => setField('maxUses', e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>补救 / 跟进责任人 responsibleOwnerId</span>
              <input type="text" placeholder="责任人用户 ID" value={form.responsibleOwnerId} onChange={e => setField('responsibleOwnerId', e.target.value)} className={inputCls} />
            </label>
          </div>

          <label className="space-y-1 block">
            <span className={`text-[10px] font-light ${weakText}`}>
              例外原因 exceptionReason（至少 {EXCEPTION_REASON_MIN} 字，当前 {reasonLen} 字）
            </span>
            <textarea
              rows={2}
              value={form.exceptionReason}
              onChange={e => setField('exceptionReason', e.target.value)}
              className={`${inputCls} resize-none`}
            />
          </label>
          <label className="space-y-1 block">
            <span className={`text-[10px] font-light ${weakText}`}>风险应对 / 补救措施 riskMitigationPlan</span>
            <textarea
              rows={2}
              value={form.riskMitigationPlan}
              onChange={e => setField('riskMitigationPlan', e.target.value)}
              className={`${inputCls} resize-none`}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>客户承诺 customerCommitment（可选）</span>
              <input type="text" value={form.customerCommitment} onChange={e => setField('customerCommitment', e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={`text-[10px] font-light ${weakText}`}>被绕过的被拒审批单（逗号分隔，可选）</span>
              <input type="text" placeholder="ApprovalRequest.id 列表（须全部已拒绝）" value={form.bypassedApprovalIds} onChange={e => setField('bypassedApprovalIds', e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className={`text-[10px] font-light ${weakText}`}>备注 notes（可选）</span>
            <input type="text" value={form.notes} onChange={e => setField('notes', e.target.value)} className={inputCls} />
          </label>

          {/* ── 门禁查询 gate-check ── */}
          <div className={`rounded-inset bg-[var(--recessed-bg)] px-3 py-2.5 space-y-1.5`}>
            <div className={`flex items-center justify-between gap-2`}>
              <span className={`flex items-center gap-1.5 text-[11px] font-light ${primaryText}`}>
                <Search size={11} strokeWidth={1.5} className={brandIcon} />
                门禁查询 Gate Check（按当前对象 / 动作精确匹配）
              </span>
              <button
                type="button"
                disabled={gateCheck.loading || !form.targetType.trim() || !form.targetId.trim() || !form.action.trim()}
                onClick={runGateCheck}
                className={`rounded-control px-2.5 py-1 text-[11px] font-light ${brandIcon} hover:bg-[var(--active-darken)] transition-colors ${gateCheck.loading || !form.targetType.trim() || !form.targetId.trim() || !form.action.trim() ? 'opacity-50' : ''}`}
              >
                查询
              </button>
            </div>
            {gateCheck.loading && <div className={`text-[11px] font-light ${weakText}`}>查询中…</div>}
            {gateCheck.error && <div className="text-[11px] font-light text-[var(--danger-text)]">{gateCheck.error}</div>}
            {gateCheck.result && (
              <div className={`text-[11px] font-light ${weakText}`}>
                {gateCheck.result.active && gateCheck.result.exception ? (
                  <span className="text-emerald-400">
                    存在生效例外：{gateCheck.result.exception.exceptionNumber}
                    {gateCheck.result.exception.bossFinalBypass ? '（BOSS 最终兜底特批放行）' : ''}
                    {gateCheck.result.exception.validUntil ? `，有效至 ${formatTime(gateCheck.result.exception.validUntil)}` : ''}
                  </span>
                ) : (
                  <span>无生效例外（{gateCheck.result.reason ?? 'NO_ACTIVE_EXCEPTION'}）</span>
                )}
              </div>
            )}
          </div>

          <div className={`text-[10px] font-light ${weakText}`}>
            「原规则不变」：例外不改变原门禁状态，仅对「指定对象 + 指定动作 + 指定时点」放行；审批链走 DR-007 路由，审批人由服务端解析。
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting || !formValid}
              onClick={handleCreate}
              className={`flex-1 rounded-control py-2 text-xs font-light transition-all bg-[var(--recessed-bg-strong)] text-[var(--text-primary)] hover:bg-[var(--recessed-bg-hover)] ${submitting || !formValid ? 'opacity-50' : ''}`}
            >
              {submitting ? '提交中…' : '提交例外申请'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(EMPTY_EXCEPTION_FORM); setEntryBanner(null); }}
              className={`rounded-control px-3 py-2 text-xs font-light ${weakText} hover:bg-[var(--recessed-bg-hover)]`}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ── 例外列表 ── */}
      {loading ? (
        <div className={`${card} rounded-card p-8 flex items-center justify-center`}>
          <RefreshCw size={18} strokeWidth={1.2} className={`animate-spin ${brandIcon}`} />
        </div>
      ) : items.length === 0 ? (
        <div className={`${card} rounded-card p-8 flex flex-col items-center justify-center gap-2`}>
          <FileWarning size={24} strokeWidth={1} className="text-[var(--text-quaternary)]" />
          <span className={`text-xs font-light ${weakText}`}>暂无例外申请</span>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(exc => {
            const isExpanded = expandedId === exc.id;
            const isPending = exc.status === 'Pending';
            const canWithdraw = isPending && currentUserId && exc.requesterId === currentUserId;
            const isBossBypassed = exc.status === 'BossFinalBypass' || Boolean(exc.bossFinalBypassBy);
            return (
              <div key={exc.id} className={`${card} rounded-card overflow-hidden`}>
                <div
                  className="flex items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                  onClick={() => setExpandedId(isExpanded ? null : exc.id)}
                >
                  {isExpanded ? (
                    <ChevronDown size={14} strokeWidth={1.5} className={`mt-1 ${weakText}`} />
                  ) : (
                    <ChevronRight size={14} strokeWidth={1.5} className={`mt-1 ${weakText}`} />
                  )}
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isPending ? STATUS_BG.running : 'bg-[var(--recessed-bg)]'}`}>
                    <FileWarning size={14} strokeWidth={1.5} className={EXCEPTION_STATUS_COLOR[exc.status]} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-light ${primaryText}`}>{exc.exceptionNumber}</span>
                      <span className={`text-[10px] font-light ${weakText}`}>
                        {EXCEPTION_CATEGORY_LABEL[exc.exceptionCategory] ?? exc.exceptionCategory}
                        {exc.subCategory ? ` / ${exc.subCategory}` : ''}
                      </span>
                      <span className={`text-[10px] font-light ${EXCEPTION_STATUS_COLOR[exc.status]}`}>
                        {EXCEPTION_STATUS_LABEL[exc.status] ?? exc.status}
                      </span>
                      {isBossBypassed && (
                        <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--danger-tint)] text-[var(--danger-text)]">
                          <ShieldAlert size={10} strokeWidth={1.5} />
                          BOSS 最终兜底特批
                        </span>
                      )}
                    </div>
                    <div className={`mt-0.5 text-xs font-light ${weakText}`}>
                      越权门禁：{exc.scope ? `${exc.scope.action} @ ${exc.scope.targetType}/${exc.scope.targetId}` : '—'}
                    </div>
                  </div>
                  <div className={`text-[10px] font-light ${weakText} shrink-0`}>{formatTime(exc.createdAt)}</div>
                </div>

                {isExpanded && (
                  <div className={`border-t ${dividerCls} px-4 py-3 space-y-2 text-[11px] font-light ${weakText}`}>
                    <div><span className={primaryText}>原因：</span>{exc.exceptionReason}</div>
                    <div><span className={primaryText}>风险应对 / 补救：</span>{exc.riskMitigationPlan}</div>
                    {exc.customerCommitment && <div><span className={primaryText}>客户承诺：</span>{exc.customerCommitment}</div>}
                    <div>
                      <span className={primaryText}>跟进责任人：</span>{exc.scope?.responsibleOwnerId ?? '—'}
                      {' · '}<span className={primaryText}>申请人：</span>{exc.requesterId}
                      {' · '}<span className={primaryText}>审批人：</span>{exc.reviewerId ?? '—'}
                    </div>
                    {exc.scope && (
                      <div>
                        <span className={primaryText}>指定订单 / 动作 / 时点：</span>
                        {exc.scope.targetId} · {exc.scope.action} · {exc.scope.validUntil ? `有效至 ${formatTime(exc.scope.validUntil)}` : '无时间窗口'}
                        {' · '}核销 {exc.scope.usedCount}/{exc.scope.maxUses}
                      </div>
                    )}
                    {exc.scope?.consumptions?.length ? (
                      <div>
                        <span className={primaryText}>核销记录：</span>
                        {exc.scope.consumptions.map((c, i) => (
                          <span key={i} className="mr-2">{c.consumedBy} 于 {formatTime(c.consumedAt)}{c.note ? `（${c.note}）` : ''}</span>
                        ))}
                      </div>
                    ) : null}
                    <div>
                      <span className={primaryText}>审批状态：</span>{EXCEPTION_STATUS_LABEL[exc.status] ?? exc.status}
                      {exc.approvalRequestId ? ` · 审批单 ${exc.approvalRequestId}` : ''}
                    </div>
                    {isBossBypassed && (
                      <div className="text-[var(--danger-text)]">
                        <span className={primaryText}>BOSS 兜底：</span>
                        {exc.bossFinalBypassBy ?? '—'} 于 {formatTime(exc.bossFinalBypassAt)}
                        {exc.bossFinalBypassReason ? `，理由：${exc.bossFinalBypassReason}` : ''}
                      </div>
                    )}
                    {exc.bypassedApprovalIds?.length ? (
                      <div><span className={primaryText}>被绕过的被拒审批单：</span>{exc.bypassedApprovalIds.join(', ')}</div>
                    ) : null}
                    {exc.notes && <div><span className={primaryText}>备注：</span>{exc.notes}</div>}
                    <div className="rounded-inset bg-[var(--recessed-bg)] px-3 py-2">
                      「原规则不变」：本例外不改变原门禁状态，仅对「{exc.scope?.targetType}/{exc.scope?.targetId}」的「{exc.scope?.action}」动作在指定时点内放行，未获批准保持原门禁。
                    </div>

                    {/* ── 操作区 ── */}
                    {(canWithdraw || (isOwner && isPending)) && (
                      <div className={`pt-2 border-t ${dividerCls} flex flex-wrap gap-2`}>
                        {canWithdraw && (
                          <button
                            type="button"
                            disabled={actionLoading === exc.id}
                            onClick={() => handleWithdraw(exc.id)}
                            className={`rounded-control px-3 py-1.5 text-xs font-light transition-all bg-[var(--recessed-bg-strong)] text-[var(--text-primary)] hover:bg-[var(--recessed-bg-hover)] ${actionLoading === exc.id ? 'opacity-50 cursor-wait' : ''}`}
                          >
                            撤回申请 Withdraw
                          </button>
                        )}
                        {isOwner && isPending && (
                          bossFor === exc.id ? (
                            <div className="w-full space-y-2">
                              <input
                                type="text"
                                placeholder={`BOSS 特批理由（至少 ${BOSS_REASON_MIN} 字，当前 ${bossReason.trim().length} 字）`}
                                value={bossReason}
                                onChange={e => setBossReason(e.target.value)}
                                className={inputCls}
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={actionLoading === exc.id || bossReason.trim().length < BOSS_REASON_MIN}
                                  onClick={() => handleBossBypass(exc.id)}
                                  className={`flex-1 rounded-control py-2 text-xs font-light transition-all bg-[var(--danger-tint)] text-[var(--danger-text)] hover:bg-[var(--danger-tint-hover)] ${actionLoading === exc.id || bossReason.trim().length < BOSS_REASON_MIN ? 'opacity-50' : ''}`}
                                >
                                  确认 BOSS 兜底特批
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setBossFor(null); setBossReason(''); }}
                                  className={`rounded-control px-3 py-2 text-xs font-light ${weakText} hover:bg-[var(--recessed-bg-hover)]`}
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setBossFor(exc.id)}
                              className="flex items-center gap-1 rounded-control px-3 py-1.5 text-xs font-light text-[var(--danger-text)] hover:bg-[var(--danger-tint)] transition-colors"
                            >
                              <ShieldAlert size={12} strokeWidth={1.5} />
                              BOSS 兜底特批
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 主面板
// ══════════════════════════════════════════════════════════════════
export function WorkflowPanel({ isDarkMode }: WorkflowPanelProps) {
  const [section, setSection] = useState<'approvals' | 'exceptions' | 'workflows'>('approvals');
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkflowInstanceStatus | 'all'>('running');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<Record<string, string>>({});
  const [exceptionEntryPrefill, setExceptionEntryPrefill] = useState<ExceptionEntryDetail | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // ── 设计 token ──
  const skin: Skin = {
    card: `${BAMBOOK_OS.material.glassColor} ${BAMBOOK_OS.material.panelSurface} border-[var(--border-c-default)] bg-[var(--recessed-bg)]`,
    primaryText: 'text-[var(--text-primary)]',
    weakText: 'text-[var(--text-tertiary)]',
    brandIcon: BAMBOOK_OS.tone.text.brandEmphasis,
    inputCls: `w-full px-3 py-1.5 rounded-control outline-none text-xs ${BAMBOOK_OS.controls.recessedField.base}`,
    dividerCls: 'border-[var(--border-c-default)]',
  };
  const { card, primaryText, weakText, brandIcon, inputCls, dividerCls } = skin;

  // ── 门禁阻断入口事件：切到例外 Tab 并预填 ──
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ExceptionEntryDetail>).detail ?? {};
      setSection('exceptions');
      setExceptionEntryPrefill(detail);
    };
    window.addEventListener(EXCEPTION_ENTRY_EVENT, handler);
    return () => window.removeEventListener(EXCEPTION_ENTRY_EVENT, handler);
  }, []);

  // ── 拉取工作流实例列表 ──
  const fetchInstances = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = statusFilter === 'all' ? {} : { status: statusFilter };
      const { items } = await apiService.listWorkflowInstances({ ...params, limit: 100 });
      setInstances(items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (section === 'workflows') fetchInstances();
  }, [fetchInstances, section, refreshTick]);

  // ── 工作流实例审批操作 ──
  const handleAction = useCallback(async (instanceId: string, action: 'approve' | 'reject') => {
    setActionLoading(instanceId);
    const note = actionNote[instanceId] || '';
    try {
      if (action === 'approve') {
        await apiService.approveWorkflowStep(instanceId, note);
      } else {
        await apiService.rejectWorkflowStep(instanceId, note);
      }
      await fetchInstances();
      setActionNote(prev => { const next = { ...prev }; delete next[instanceId]; return next; });
    } catch (e: any) {
      setError(`操作失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [actionNote, fetchInstances]);

  const FILTERS: { id: WorkflowInstanceStatus | 'all'; label: string }[] = [
    { id: 'running', label: '待审批' },
    { id: 'all', label: '全部' },
    { id: 'approved', label: '已通过' },
    { id: 'rejected', label: '已驳回' },
    { id: 'cancelled', label: '已取消' },
  ];

  const SECTIONS: { id: 'approvals' | 'exceptions' | 'workflows'; label: string }[] = [
    { id: 'approvals', label: '审批单 Approvals' },
    { id: 'exceptions', label: '例外申请 Exceptions' },
    { id: 'workflows', label: '工作流实例 Workflows' },
  ];

  return (
    <div className="space-y-4">
      {/* ── 头部 ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Workflow size={18} strokeWidth={1.5} className={brandIcon} />
          <span className={`text-sm font-light ${primaryText}`}>审批中心 Approval Center</span>
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick(t => t + 1)}
          className={`flex items-center gap-1 rounded-control px-2.5 py-1 text-xs font-light ${brandIcon} hover:bg-[var(--active-darken)] transition-colors`}
        >
          <RefreshCw size={12} strokeWidth={1.5} />
          刷新
        </button>
      </div>

      {/* ── 分区切换 ── */}
      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`rounded-control px-3 py-1 text-xs font-light transition-all ${
              section === s.id
                ? 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'approvals' && <ApprovalsSection skin={skin} />}
      {section === 'exceptions' && (
        <ExceptionsSection
          skin={skin}
          entryPrefill={exceptionEntryPrefill}
          onConsumePrefill={() => setExceptionEntryPrefill(null)}
        />
      )}

      {section === 'workflows' && (
        <div className="space-y-3">
          {/* ── 状态过滤 ── */}
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`rounded-control px-3 py-1 text-xs font-light transition-all ${
                  statusFilter === f.id
                    ? 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* ── 错误提示 ── */}
          {error && (
            <div className="rounded-control px-4 py-2 text-xs bg-[var(--danger-tint)] text-[var(--danger-text)]">
              {error}
            </div>
          )}

          {/* ── 实例列表 ── */}
          {loading ? (
            <div className={`${card} rounded-card p-8 flex items-center justify-center`}>
              <RefreshCw size={18} strokeWidth={1.2} className={`animate-spin ${brandIcon}`} />
            </div>
          ) : instances.length === 0 ? (
            <div className={`${card} rounded-card p-8 flex flex-col items-center justify-center gap-2`}>
              <Workflow size={24} strokeWidth={1} className="text-[var(--text-quaternary)]" />
              <span className={`text-xs font-light ${weakText}`}>暂无工作流实例</span>
            </div>
          ) : (
            <div className="space-y-2">
              {instances.map(instance => {
                const isExpanded = expandedId === instance.id;
                const currentStep = instance.steps.find(s => s.stepIndex === instance.currentStepIndex);
                const isRunning = instance.status === 'running';

                return (
                  <div key={instance.id} className={`${card} rounded-card overflow-hidden`}>
                    {/* ── 实例卡片头部 ── */}
                    <div
                      className="flex items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                      onClick={() => setExpandedId(isExpanded ? null : instance.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} strokeWidth={1.5} className={`mt-1 ${weakText}`} />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.5} className={`mt-1 ${weakText}`} />
                      )}
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${STATUS_BG[instance.status]}`}>
                        {instance.status === 'approved' ? (
                          <CheckCircle size={14} strokeWidth={1.5} className={STATUS_COLOR[instance.status]} />
                        ) : instance.status === 'rejected' ? (
                          <XCircle size={14} strokeWidth={1.5} className={STATUS_COLOR[instance.status]} />
                        ) : (
                          <Clock size={14} strokeWidth={1.5} className={STATUS_COLOR[instance.status]} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-light ${primaryText}`}>
                            {instance.title || `${instance.entityType} ${instance.entityId}`}
                          </span>
                          <span className={`text-[10px] font-light ${STATUS_COLOR[instance.status]}`}>
                            {STATUS_LABEL[instance.status]}
                          </span>
                        </div>
                        <div className={`mt-0.5 text-xs font-light ${weakText}`}>
                          {instance.definitionName}
                          {currentStep && isRunning && ` · 当前：${currentStep.stepName}`}
                        </div>
                      </div>
                      <div className={`text-[10px] font-light ${weakText} shrink-0`}>
                        {formatTime(instance.createdAt)}
                      </div>
                    </div>

                    {/* ── 展开内容 ── */}
                    {isExpanded && (
                      <div className={`border-t ${dividerCls} px-4 py-3 space-y-3`}>
                        <div className="space-y-2">
                          {instance.steps.map(step => {
                            const isCurrent = step.stepIndex === instance.currentStepIndex && isRunning;
                            const isDone = step.decision !== null;
                            return (
                              <div key={step.id} className="flex items-start gap-3">
                                <div className="mt-0.5 shrink-0">
                                  {step.decision === 'approved' ? (
                                    <CheckCircle size={14} strokeWidth={1.5} className="text-emerald-400" />
                                  ) : step.decision === 'rejected' ? (
                                    <XCircle size={14} strokeWidth={1.5} className="text-red-400" />
                                  ) : isCurrent ? (
                                    <Clock size={14} strokeWidth={1.5} className="text-blue-400" />
                                  ) : (
                                    <div className="h-3.5 w-3.5 rounded-full border border-[var(--border-c-strong)]" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs font-light ${isCurrent ? 'text-blue-400' : weakText}`}>
                                      {step.stepName}
                                    </span>
                                    {step.approverRole && (
                                      <span className={`text-[10px] font-light ${weakText}`}>@{step.approverRole}</span>
                                    )}
                                  </div>
                                  {step.decisionNote && (
                                    <div className={`mt-0.5 text-[11px] font-light ${weakText}`}>备注：{step.decisionNote}</div>
                                  )}
                                  {step.deciderName && (
                                    <div className={`mt-0.5 text-[10px] font-light ${weakText}`}>
                                      <User size={9} strokeWidth={1.5} className="inline mr-1" />
                                      {step.deciderName} · {formatTime(step.decidedAt)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {isRunning && currentStep && (
                          <div className={`pt-2 border-t ${dividerCls} space-y-2`}>
                            <input
                              type="text"
                              placeholder="审批备注（可选）"
                              value={actionNote[instance.id] || ''}
                              onChange={e => setActionNote(prev => ({ ...prev, [instance.id]: e.target.value }))}
                              className={inputCls}
                              disabled={actionLoading === instance.id}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={actionLoading === instance.id}
                                onClick={() => handleAction(instance.id, 'approve')}
                                className={`flex-1 rounded-control py-2 text-xs font-light transition-all bg-[var(--success-tint)] text-[var(--success-text)] hover:bg-[var(--success-tint-hover)] ${actionLoading === instance.id ? 'opacity-50 cursor-wait' : ''}`}
                              >
                                <CheckCircle size={12} strokeWidth={1.5} className="inline mr-1" />
                                通过
                              </button>
                              <button
                                type="button"
                                disabled={actionLoading === instance.id}
                                onClick={() => handleAction(instance.id, 'reject')}
                                className={`flex-1 rounded-control py-2 text-xs font-light transition-all bg-[var(--danger-tint)] text-[var(--danger-text)] hover:bg-[var(--danger-tint-hover)] ${actionLoading === instance.id ? 'opacity-50 cursor-wait' : ''}`}
                              >
                                <XCircle size={12} strokeWidth={1.5} className="inline mr-1" />
                                驳回
                              </button>
                            </div>
                          </div>
                        )}

                        {instance.initiatorName && (
                          <div className={`flex items-center gap-1.5 text-[10px] font-light ${weakText}`}>
                            <User size={10} strokeWidth={1.5} />
                            发起人：{instance.initiatorName}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WorkflowPanel;
