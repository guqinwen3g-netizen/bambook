/**
 * WorkflowPanel — 工作流审批管理面板
 *
 * 功能：
 *   1. 列出运行中的工作流实例（待审批）
 *   2. 展开查看步骤时间线
 *   3. 审批通过 / 驳回（含备注）
 *   4. 状态过滤（全部 / 运行中 / 已通过 / 已驳回 / 已取消）
 *
 * 设计：flat 无阴影、大圆角、半透明膜色 — 与 AdminPanel 一致
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Workflow, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight,
  RefreshCw, AlertTriangle, User, FileText,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { WorkflowInstance, WorkflowInstanceStatus } from '../types';
import { BAMBOOK_OS } from './ui/bambookOsTokens';

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

// ── 时间格式化 ──
function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface WorkflowPanelProps {
  isDarkMode: boolean;
}

export function WorkflowPanel({ isDarkMode }: WorkflowPanelProps) {
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkflowInstanceStatus | 'all'>('running');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<Record<string, string>>({});

  // ── 设计 token ──
  const card = `${BAMBOOK_OS.material.glassColor} ${BAMBOOK_OS.material.panelSurface} border-[var(--border-c-default)] bg-[var(--recessed-bg)]`;
  const primaryText = 'text-[var(--text-primary)]';
  const weakText = 'text-[var(--text-tertiary)]';
  const brandIcon = BAMBOOK_OS.tone.text.brandEmphasis;
  const inputCls = `w-full px-3 py-1.5 rounded-control outline-none text-xs ${BAMBOOK_OS.controls.recessedField.base}`;
  const dividerCls = 'border-[var(--border-c-default)]';

  // ── 拉取实例列表 ──
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
    fetchInstances();
  }, [fetchInstances]);

  // ── 审批操作 ──
  const handleAction = useCallback(async (instanceId: string, action: 'approve' | 'reject') => {
    setActionLoading(instanceId);
    const note = actionNote[instanceId] || '';
    try {
      if (action === 'approve') {
        await apiService.approveWorkflowStep(instanceId, note);
      } else {
        await apiService.rejectWorkflowStep(instanceId, note);
      }
      // 刷新列表
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

  return (
    <div className="space-y-4">
      {/* ── 头部 ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Workflow size={18} strokeWidth={1.5} className={brandIcon} />
          <span className={`text-sm font-light ${primaryText}`}>工作流审批</span>
          {!loading && (
            <span className={`text-xs font-light ${weakText}`}>({instances.length})</span>
          )}
        </div>
        <button
          type="button"
          onClick={fetchInstances}
          className={`flex items-center gap-1 rounded-control px-2.5 py-1 text-xs font-light ${brandIcon} hover:bg-[var(--active-darken)] transition-colors`}
        >
          <RefreshCw size={12} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

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
        <div className={`rounded-control px-4 py-2 text-xs bg-[var(--danger-tint)] text-[var(--danger-text)]`}>
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
                  {/* 展开图标 */}
                  {isExpanded ? (
                    <ChevronDown size={14} strokeWidth={1.5} className={`mt-1 ${weakText}`} />
                  ) : (
                    <ChevronRight size={14} strokeWidth={1.5} className={`mt-1 ${weakText}`} />
                  )}

                  {/* 状态徽章 */}
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${STATUS_BG[instance.status]}`}>
                    {instance.status === 'approved' ? (
                      <CheckCircle size={14} strokeWidth={1.5} className={STATUS_COLOR[instance.status]} />
                    ) : instance.status === 'rejected' ? (
                      <XCircle size={14} strokeWidth={1.5} className={STATUS_COLOR[instance.status]} />
                    ) : instance.status === 'cancelled' ? (
                      <Clock size={14} strokeWidth={1.5} className={STATUS_COLOR[instance.status]} />
                    ) : (
                      <Clock size={14} strokeWidth={1.5} className={STATUS_COLOR[instance.status]} />
                    )}
                  </div>

                  {/* 内容 */}
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

                  {/* 时间 */}
                  <div className={`text-[10px] font-light ${weakText} shrink-0`}>
                    {formatTime(instance.createdAt)}
                  </div>
                </div>

                {/* ── 展开内容 ── */}
                {isExpanded && (
                  <div className={`border-t ${dividerCls} px-4 py-3 space-y-3`}>
                    {/* 步骤时间线 */}
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
                                <div className={`h-3.5 w-3.5 rounded-full border border-[var(--border-c-strong)]`} />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs ${isCurrent ? 'font-normal text-blue-400' : isDone ? `font-light ${weakText}` : `font-light ${weakText}`}`}>
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

                    {/* 审批操作（仅运行中实例） */}
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

                    {/* 发起人信息 */}
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
  );
}

export default WorkflowPanel;
