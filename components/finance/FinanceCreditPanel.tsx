/**
 * FinanceCreditPanel — 客户信用面板（信用控制域 Track F 前端落点）
 *
 * 数据源：/v1/credit/:customerId（creditService）
 *   status  — 额度 / 已占用 / 可用 / 冻结状态 / 门禁标记 creditFrozen / 最大逾期天数
 *   history — CreditLimitHistory append-only 时间线（冻结/解冻/占用释放全事件）
 *   freeze  — 人工冻结（scope credit:freeze:write，理由必填）
 *   thaw    — 主管手动解冻（scope credit:thaw:write，理由必填，记录 thawedReason）
 *
 * 权限显隐：冻结/解冻按钮按 scope 门控（服务端 fail-closed 兜底）。
 * 联动预留：customerId / onCustomerChange props 供 RelationsManager 等外部容器受控接入；
 * embedded 模式供客户详情（DetailPanel）等已提供客户上下文的容器直接嵌入。
 *
 * 设计：flat 无阴影、bds 语义类、字重 ≤300、无 emoji。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import { hasPermission } from '../../services/authService';
import {
  creditService,
  CREDIT_LIMIT_STATUS_LABELS,
  OVERDUE_FREEZE_THRESHOLD_DAYS,
  SYSTEM_CREDIT_ACTOR,
  creditTriggerTypeLabel,
  type CreditHistoryItem,
  type CreditStatus,
} from '../../services/creditService';
import type { Relation } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const textPrimary = 'text-[var(--text-primary)]';
const textSecondary = 'text-[var(--text-tertiary)]';

function formatAmount(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined) return '—';
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : (currency || '');
  return `${sym}${Number(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }) : String(value);
}

interface FinanceCreditPanelProps {
  isDarkMode: boolean;
  endpoint?: string;
  /** 交易对象档案（FinanceManager 已加载，复用避免重复拉取） */
  relations: Relation[];
  /** 受控客户选择（外部容器如客户详情联动时传入） */
  customerId?: string;
  /** 客户切换事件（受控模式下由外部接管状态） */
  onCustomerChange?: (customerId: string) => void;
  /** 嵌入模式：外部容器（如客户详情）已提供客户上下文，隐藏选择工具栏与整面表面包裹 */
  embedded?: boolean;
}

export function FinanceCreditPanel({ isDarkMode: _isDarkMode, endpoint, relations, customerId: controlledId, onCustomerChange, embedded = false }: FinanceCreditPanelProps) {
  const canFreeze = hasPermission('credit:freeze:write');
  const canThaw = hasPermission('credit:thaw:write');

  const customerOptions = useMemo(
    () => relations.filter(r => !r.deletedAt && (r.category === 'Customer' || r.type === 'Customer')),
    [relations],
  );
  const relationDisplayName = (r: Relation) => r.chineseName || r.name;

  // 受控/非受控双模：外部传入 customerId 时以其为准
  const [innerCustomerId, setInnerCustomerId] = useState('');
  const customerId = controlledId ?? innerCustomerId;
  const selectCustomer = (id: string) => {
    if (onCustomerChange) onCustomerChange(id);
    else setInnerCustomerId(id);
  };

  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [history, setHistory] = useState<CreditHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 冻结 / 解冻 modal ──
  const [action, setAction] = useState<'freeze' | 'thaw' | null>(null);
  const [reason, setReason] = useState('');
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCredit = useCallback(async (rid: string) => {
    setLoading(true);
    setError(null);
    try {
      const [s, h] = await Promise.all([
        creditService.getCreditStatus(rid, endpoint),
        creditService.getCreditHistory(rid, { limit: 100 }, endpoint),
      ]);
      setStatus(s);
      setHistory(h.items);
      setHistoryTotal(h.total);
    } catch (e: any) {
      setStatus(null);
      setHistory([]);
      setHistoryTotal(0);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    setAction(null);
    setReason('');
    setActionError(null);
    if (customerId) loadCredit(customerId);
    else {
      setStatus(null);
      setHistory([]);
      setHistoryTotal(0);
      setError(null);
    }
  }, [customerId, loadCredit]);

  const openAction = (kind: 'freeze' | 'thaw') => {
    setAction(kind);
    setReason('');
    setActionError(null);
  };

  const handleAction = async () => {
    if (!action || !customerId || actionSaving) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setActionError(action === 'freeze' ? '冻结理由必填（审计强制）' : '解冻理由必填（记录 thawedReason，审计强制）');
      return;
    }
    setActionSaving(true);
    setActionError(null);
    try {
      if (action === 'freeze') await creditService.freezeCredit(customerId, trimmed, endpoint);
      else await creditService.thawCredit(customerId, trimmed, endpoint);
      setAction(null);
      setReason('');
      await loadCredit(customerId);
    } catch (e: any) {
      setActionError(String(e?.message || e));
    } finally {
      setActionSaving(false);
    }
  };

  const statusLabel = (s: string | null) => (s && CREDIT_LIMIT_STATUS_LABELS[s]) || s || '—';

  const renderStatusBody = () => {
    if (!customerId) {
      return (
        <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondary)}>
          <ShieldCheck size={24} strokeWidth={1.25} className="mb-3 opacity-45" />
          <div className="text-sm font-light">请选择客户查看信用额度</div>
        </div>
      );
    }
    if (loading) {
      return (
        <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondary)}>
          <Loader2 size={20} strokeWidth={1.25} className="mb-3 animate-spin opacity-45" />
          <div className="text-sm font-light">加载中…</div>
        </div>
      );
    }
    if (error) {
      return <div className="bds-alert danger m-5">{error}</div>;
    }
    if (!status) return null;

    if (!status.hasCreditLimit) {
      return (
        <div className="bds-empty">
          <div className="glyph"><ShieldCheck size={24} strokeWidth={1.25} /></div>
          <div className="title">该客户未设置信用额度</div>
          {status.maxOverdueDays > 0 && (
            <div className={cx('mt-2 text-[11px] font-light', textSecondary)}>当前最大逾期 {status.maxOverdueDays} 天</div>
          )}
        </div>
      );
    }

    const isFrozen = status.status === 'Frozen';
    const usagePercent = status.totalLimit && status.totalLimit > 0
      ? Math.min(100, Math.round(((status.usedAmount ?? 0) / status.totalLimit) * 100))
      : 0;

    return (
      <div className={embedded ? undefined : 'min-h-0 flex-1 overflow-y-auto px-5 pb-5'}>
        {/* 额度概览 */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-inset p-3 bds-inset">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>信用额度</div>
            <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(status.totalLimit, status.currency)}</div>
          </div>
          <div className="rounded-inset p-3 bds-inset">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>已占用</div>
            <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(status.usedAmount, status.currency)}</div>
          </div>
          <div className="rounded-inset p-3 bds-inset">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>可用额度</div>
            <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(status.remaining, status.currency)}</div>
          </div>
        </div>

        {/* 占用比例条（token 表面色，无硬编码颜色） */}
        <div className="mt-3 rounded-inset p-3 bds-inset">
          <div className="flex items-center justify-between">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>额度占用</div>
            <div className={cx('text-[11px] font-light tabular-nums', textSecondary)}>{usagePercent}%</div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-field" style={{ background: 'var(--recessed-bg)' }}>
            <div className="h-full rounded-field" style={{ width: `${usagePercent}%`, background: 'var(--border-c-strong)' }} />
          </div>
        </div>

        {/* 状态与门禁 */}
        <div className="mt-3 rounded-inset p-4 bds-inset">
          <div className="flex items-center justify-between gap-2">
            <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>额度状态</div>
            <span className="bds-badge sm neutral">{statusLabel(status.status)}</span>
          </div>
          <div className={cx('mt-2 text-[11px] font-light leading-relaxed', status.creditFrozen ? 'text-[var(--text-primary)]' : textSecondary)}>
            {status.creditFrozen
              ? '门禁生效中：该客户信用已冻结/吊销，新订单与订单变更将被阻断，请先由财务解冻。'
              : status.maxOverdueDays > OVERDUE_FREEZE_THRESHOLD_DAYS
                ? `该客户存在 ≥${OVERDUE_FREEZE_THRESHOLD_DAYS} 天逾期未结清应收（最大逾期 ${status.maxOverdueDays} 天），调度任务将自动冻结额度。`
                : '信用门禁正常，新订单不受信用阻断。'}
          </div>
          <div className="mt-2 space-y-1">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-2 py-1">
              <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>最大逾期</div>
              <div className={cx('text-xs font-light tabular-nums', textPrimary)}>{status.maxOverdueDays} 天</div>
            </div>
            {isFrozen && (
              <>
                <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-2 py-1">
                  <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>冻结时间</div>
                  <div className={cx('truncate text-xs font-light', textPrimary)}>{formatDateTime(status.frozenAt)}</div>
                </div>
                <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-2 py-1">
                  <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>冻结触发</div>
                  <div className={cx('truncate text-xs font-light', textPrimary)}>
                    {status.frozenBy === SYSTEM_CREDIT_ACTOR ? '系统自动（60 天逾期巡检）' : status.frozenBy || '—'}
                  </div>
                </div>
              </>
            )}
            {status.thawedReason && (
              <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-2 py-1">
                <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>最近解冻理由</div>
                <div className={cx('text-xs font-light', textPrimary)}>{status.thawedReason}</div>
              </div>
            )}
            <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-2 py-1">
              <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>最近巡检</div>
              <div className={cx('truncate text-xs font-light', textPrimary)}>{formatDateTime(status.lastAutoScanDate)}</div>
            </div>
          </div>
          {/* 冻结 / 解冻入口（按 scope 显隐；服务端 fail-closed 兜底） */}
          {(canFreeze || canThaw) && (
            <div className="mt-3 flex justify-end gap-2">
              {canFreeze && status.status === 'Active' && (
                <button type="button" onClick={() => openAction('freeze')} className="bds-btn bds-btn-secondary">
                  <Ban size={16} strokeWidth={1.75} />
                  冻结额度
                </button>
              )}
              {canThaw && isFrozen && (
                <button type="button" onClick={() => openAction('thaw')} className="bds-btn bds-btn-secondary">
                  <RotateCcw size={16} strokeWidth={1.75} />
                  手动解冻
                </button>
              )}
            </div>
          )}
        </div>

        {/* 历史时间线（append-only） */}
        <div className="mt-4 rounded-inset p-4 bds-inset">
          <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>信用历史（{historyTotal}）</div>
          {history.length === 0 ? (
            <div className={cx('mt-2 text-[11px] font-light', textSecondary)}>暂无冻结 / 解冻 / 占用释放记录。</div>
          ) : (
            <div className="mt-2 space-y-1.5">
              {history.map(item => (
                <div key={item.id} className="rdl-data-row min-h-0 px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className={cx('truncate text-[11px] font-light', textPrimary)}>{creditTriggerTypeLabel(item.triggerType)}</div>
                    <div className={cx('shrink-0 text-[10px] font-light tabular-nums', textSecondary)}>{formatDateTime(item.createdAt)}</div>
                  </div>
                  <div className={cx('mt-0.5 text-[10px] font-light tabular-nums', textSecondary)}>
                    占用 {formatAmount(item.beforeUsedAmount, status.currency)} → {formatAmount(item.afterUsedAmount, status.currency)}
                    {item.delta !== 0 && `（${item.delta > 0 ? '+' : ''}${formatAmount(item.delta, status.currency)}）`}
                  </div>
                  {(item.triggerBy || item.remark) && (
                    <div className={cx('mt-0.5 truncate text-[10px] font-light', textSecondary)}>
                      {item.triggerBy === SYSTEM_CREDIT_ACTOR ? '系统自动' : item.triggerBy || ''}
                      {item.triggerBy && item.remark ? ' · ' : ''}
                      {item.remark || ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // 冻结 / 解冻理由 modal（两种模式共用）
  const actionModal = action && (
    <div className="bds-modal-mask" onClick={() => !actionSaving && setAction(null)}>
      <div className="bds-modal" style={{ width: '24rem' }} onClick={e => e.stopPropagation()}>
        <h2 className={cx('mb-4 text-[13px] font-light tracking-[0.02em]', textPrimary)}>
          {action === 'freeze' ? '冻结客户信用额度' : '手动解冻客户信用额度'}
        </h2>
        <div className="space-y-3">
          <div className={cx('text-[11px] font-light leading-relaxed', textSecondary)}>
            {action === 'freeze'
              ? '冻结后该客户新订单与订单变更将被信用门禁阻断。冻结理由必填并写入审计。'
              : '解冻后信用门禁解除。解冻理由必填并记录到 thawedReason（审计强制）。'}
          </div>
          <div>
            <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>
              {action === 'freeze' ? '冻结理由 *' : '解冻理由 *'}
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              className="bds-input sm w-full"
            />
          </div>
          {actionError && <div className="bds-alert danger">{actionError}</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={actionSaving} onClick={() => setAction(null)} className="bds-btn bds-btn-secondary">取消</button>
          <button type="button" disabled={actionSaving} onClick={handleAction} className="bds-btn bds-btn-primary">
            {actionSaving ? '提交中...' : action === 'freeze' ? '确认冻结' : '确认解冻'}
          </button>
        </div>
      </div>
    </div>
  );

  // 嵌入模式：外部容器（客户详情等）已提供客户上下文与表面，仅渲染状态主体 + modal
  if (embedded) {
    return (
      <div className="flex flex-col gap-2.5">
        {renderStatusBody()}
        {actionModal}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
      {/* 工具栏：客户选择 */}
      <div className="bds-filterbar">
        <select
          value={customerId}
          onChange={e => selectCustomer(e.target.value)}
          className="bds-select min-w-64"
        >
          <option value="">选择客户档案…</option>
          {customerOptions.map(r => (
            <option key={r.id} value={r.id}>{relationDisplayName(r)}</option>
          ))}
        </select>
        {status?.hasCreditLimit && (
          <div className={cx('ml-auto text-[11px] font-light', textSecondary)}>
            {status.creditFrozen ? '信用门禁：冻结中' : '信用门禁：正常'} · 最大逾期 {status.maxOverdueDays} 天
          </div>
        )}
      </div>

      <div className="bds-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
        {renderStatusBody()}
      </div>

      {actionModal}
    </div>
  );
}
