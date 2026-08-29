/**
 * FinancePaymentRequestsPanel — 付款申请面板（DR-017 先申请后付款）
 *
 * 数据源：
 *   /v1/payment-requests（paymentRequestService）— 列表 / 创建 / 作废
 *   /v1/approvals/:id/decide（approvalKernelService）— 审批决策（仅当前审批人可见入口）
 *
 * 权限显隐：
 *   新建入口 — hasPermission('finance:payment_request:create')
 *   审批操作 — 审批单 pending 且当前用户 = reviewerId（服务端自审守卫兜底）
 *   作废入口 — 状态 Draft/Pending 且当前用户 = applicantId
 *
 * 设计：flat 无阴影、bds 语义类、字重 ≤300、无 emoji。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Ban, ClipboardList, Loader2, Plus, Search } from 'lucide-react';
import { getAuthState, hasPermission } from '../../services/authService';
import { approvalKernelService } from '../../services/approvalKernelService';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import { bdsConfirm } from '../ui/BdsDialog';
import {
  paymentRequestService,
  PAYMENT_REQUEST_STATUSES,
  PAYMENT_REQUEST_STATUS_LABELS,
  PAYMENT_REQUEST_SOURCE_TYPES,
  PAYMENT_REQUEST_SOURCE_TYPE_LABELS,
  type PaymentCategory,
  type PaymentRequest,
  type PaymentRequestDetail,
  type PaymentRequestSourceType,
  type PaymentRequestStatus,
} from '../../services/paymentRequestService';
import {
  VOUCHER_CATEGORIES,
  VOUCHER_CATEGORY_LABELS,
  voucherCategoryLabel,
} from '../../services/paymentVoucherService';
import type { Relation } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const textPrimary = 'text-[var(--text-primary)]';
const textSecondary = 'text-[var(--text-tertiary)]';

function formatAmount(amount: number | string, currency?: string | null): string {
  const num = Number(amount);
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : (currency || '');
  return `${sym}${(Number.isFinite(num) ? num : 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }) : String(value);
}

const PR_GRID_CLASS =
  'grid w-full min-w-0 grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)]';

interface FinancePaymentRequestsPanelProps {
  isDarkMode: boolean;
  endpoint?: string;
  /** 交易对象档案（FinanceManager 已加载，复用避免重复拉取） */
  relations: Relation[];
}

const EMPTY_FORM = {
  supplierRelationId: '',
  supplierName: '',
  totalAmount: '',
  currency: 'USD',
  paymentCategory: 'normal' as PaymentCategory,
  requestDate: '',
  expectedPaymentDate: '',
  sourceType: '' as '' | PaymentRequestSourceType,
  sourceId: '',
  remark: '',
};

export function FinancePaymentRequestsPanel({ isDarkMode: _isDarkMode, endpoint, relations }: FinancePaymentRequestsPanelProps) {
  const currentUserId = getAuthState().user?.id ?? '';
  const canCreate = hasPermission('finance:payment_request:create');

  const supplierOptions = useMemo(
    () => relations.filter(r => !r.deletedAt && (r.category === 'Supplier' || r.type === 'Supplier')),
    [relations],
  );
  const relationDisplayName = (r: Relation) => r.chineseName || r.name;

  // ── 列表 ──
  const [items, setItems] = useState<PaymentRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  // 服务端搜索词（防抖后生效；R3：搜索下推后端，客户端不再只过滤已加载窗口）
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentRequestStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PaymentCategory>('all');

  // ── 详情 ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ── 创建 ──
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── 审批 / 作废 ──
  const [decisionNote, setDecisionNote] = useState('');
  const [actionBusy, setActionBusy] = useState<'approved' | 'rejected' | 'cancel' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // 搜索防抖：300ms 内连续输入合并为一次服务端查询
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(searchTerm.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // R3：limit 500（服务端上限）+ 消费 total 透明披露截断；search 下推服务端
      const result = await paymentRequestService.listPaymentRequests(
        { limit: 500, search: appliedSearch || undefined },
        endpoint,
      );
      setItems(result.items);
      setTotal(result.total);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [endpoint, appliedSearch]);

  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await paymentRequestService.getPaymentRequest(id, endpoint));
    } catch (e: any) {
      setDetail(null);
      setDetailError(String(e?.message || e));
    } finally {
      setDetailLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    setDecisionNote('');
    setActionError(null);
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // 搜索已下推服务端（appliedSearch 参与查询）；状态/性质过滤在已加载窗口内客户端过滤
  const filtered = useMemo(() => {
    let result = items;
    if (statusFilter !== 'all') result = result.filter(i => i.status === statusFilter);
    if (categoryFilter !== 'all') result = result.filter(i => i.paymentCategory === categoryFilter);
    return result;
  }, [items, statusFilter, categoryFilter]);

  // ── 创建提交（审批人由服务端 DR-007 解析，前端不传 reviewerId） ──
  const handleCreate = async () => {
    const amount = Number(form.totalAmount);
    if (!form.supplierRelationId && !form.supplierName.trim()) {
      setCreateError('付款对象必填：选择供应商档案或手动输入名称');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setCreateError('金额必须是大于 0 的有效数字');
      return;
    }
    if (!form.currency.trim()) {
      setCreateError('币种必填');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const rel = supplierOptions.find(r => r.id === form.supplierRelationId);
      await paymentRequestService.createPaymentRequest({
        supplierId: form.supplierRelationId || undefined,
        supplierName: rel ? relationDisplayName(rel) : (form.supplierName.trim() || undefined),
        totalAmount: amount,
        currency: form.currency.trim(),
        paymentCategory: form.paymentCategory,
        requestDate: form.requestDate || undefined,
        expectedPaymentDate: form.expectedPaymentDate || undefined,
        sourceType: form.sourceType || undefined,
        sourceId: form.sourceId.trim() || undefined,
        remark: form.remark.trim() || undefined,
      }, endpoint);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await loadList();
    } catch (e: any) {
      setCreateError(String(e?.message || e));
    } finally {
      setCreating(false);
    }
  };

  // ── 审批决策（通过 / 驳回；驳回必填审批意见） ──
  const handleDecide = async (status: 'approved' | 'rejected') => {
    const approvalId = detail?.approvalRequest?.id;
    if (!approvalId || actionBusy) return;
    const note = decisionNote.trim();
    if (status === 'rejected' && !note) {
      setActionError('驳回必须填写审批意见');
      return;
    }
    setActionBusy(status);
    setActionError(null);
    try {
      await approvalKernelService.decideApproval(approvalId, status, note || undefined, endpoint);
      await Promise.all([loadDetail(detail!.id), loadList()]);
      setDecisionNote('');
    } catch (e: any) {
      setActionError(String(e?.message || e));
    } finally {
      setActionBusy(null);
    }
  };

  // ── 申请人作废 ──
  const handleCancel = async () => {
    if (!detail || actionBusy) return;
    if (!(await bdsConfirm({ title: '确认作废', body: `作废付款申请 ${detail.requestNumber}？\n关联审批单将一并撤回，不可恢复。`, danger: true }))) return;
    setActionBusy('cancel');
    setActionError(null);
    try {
      await paymentRequestService.cancelPaymentRequest(detail.id, endpoint);
      await Promise.all([loadDetail(detail.id), loadList()]);
    } catch (e: any) {
      setActionError(String(e?.message || e));
    } finally {
      setActionBusy(null);
    }
  };

  const approval = detail?.approvalRequest ?? null;
  const canDecide = Boolean(detail && approval?.status === 'pending' && currentUserId && approval?.reviewerId === currentUserId);
  const canCancel = Boolean(detail && (detail.status === 'Draft' || detail.status === 'Pending') && currentUserId && detail.applicantId === currentUserId);

  const renderRow = (item: PaymentRequest) => {
    const active = selectedId === item.id;
    return (
      <button
        type="button"
        key={item.id}
        data-rdl-component="data-row"
        data-interactive="true"
        data-selected={active ? 'true' : 'false'}
        onClick={() => setSelectedId(item.id)}
        className={cx(PR_GRID_CLASS, 'rdl-data-row w-full text-left text-xs')}
      >
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimary)}>{item.requestNumber}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondary)}>{item.requestDate || '—'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimary)}>{item.supplierName || '—'}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondary)}>{voucherCategoryLabel(item.paymentCategory)}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light tabular-nums', textPrimary)}>{formatAmount(item.totalAmount, item.currency)}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondary)}>预期付款 {item.expectedPaymentDate || '—'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <span className="bds-badge sm neutral">{PAYMENT_REQUEST_STATUS_LABELS[item.status] || item.status}</span>
          <div className={cx('mt-1 truncate text-[11px]', textSecondary)}>{item.remark || '—'}</div>
        </div>
      </button>
    );
  };

  const renderDetail = () => {
    if (!selectedId) {
      return (
        <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondary)}>
          <ClipboardList size={24} strokeWidth={1.25} className="mb-3 opacity-45" />
          <div className="text-sm font-light">请选择付款申请</div>
        </div>
      );
    }
    if (detailLoading) {
      return (
        <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondary)}>
          <Loader2 size={20} strokeWidth={1.25} className="mb-3 animate-spin opacity-45" />
          <div className="text-sm font-light">加载中…</div>
        </div>
      );
    }
    if (detailError || !detail) {
      return (
        <div className="px-5 py-5">
          <div className="bds-alert danger">{detailError || '详情加载失败'}</div>
        </div>
      );
    }

    const fieldRows = [
      { label: '申请编号', value: detail.requestNumber },
      { label: '收款方', value: detail.supplierName || '—' },
      { label: '申请日期', value: detail.requestDate || '—' },
      { label: '预期付款日', value: detail.expectedPaymentDate || '—' },
      { label: '付款性质', value: voucherCategoryLabel(detail.paymentCategory) },
      { label: '币种', value: detail.currency || '—' },
      { label: '申请人', value: detail.applicantId || '—' },
      { label: '事由', value: detail.remark || '—' },
    ];

    return (
      <>
        <div className="shrink-0 px-5 py-5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>当前付款申请</div>
              <div className={cx('mt-2 truncate text-base font-light', textPrimary)}>{detail.requestNumber}</div>
              <div className={cx('mt-1 truncate text-[11px]', textSecondary)}>{detail.supplierName || '—'} · {detail.currency || '—'}</div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <span className="bds-badge sm neutral mt-0.5">{PAYMENT_REQUEST_STATUS_LABELS[detail.status] || detail.status}</span>
              {canCancel && (
                <button type="button" disabled={actionBusy !== null} onClick={handleCancel} className="bds-btn bds-btn-secondary">
                  {actionBusy === 'cancel' ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} strokeWidth={1.75} />}
                  作废
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {actionError && <div className="bds-alert danger mb-3">{actionError}</div>}
          <div className="space-y-1">
            {fieldRows.map(row => (
              <div key={row.label} className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-2 py-1">
                <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>{row.label}</div>
                <div className={cx('truncate text-xs font-light', textPrimary)}>{row.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-inset p-4 bds-inset">
            <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>申请金额</div>
            <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(detail.totalAmount, detail.currency)}</div>
          </div>

          {/* 审批进度（ApprovalRequest 快照为真源） */}
          <div className="mt-4 rounded-inset p-4 bds-inset">
            <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>审批进度</div>
            {approval ? (
              <div className="mt-2 space-y-1">
                <div className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-2 py-1">
                  <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>审批状态</div>
                  <div className={cx('text-xs font-light', textPrimary)}>
                    {approval.status === 'pending' ? '待审批' : approval.status === 'approved' ? '已通过' : approval.status === 'rejected' ? '已驳回' : approval.status === 'cancelled' ? '已撤回' : approval.status}
                  </div>
                </div>
                <div className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-2 py-1">
                  <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>审批人</div>
                  <div className={cx('truncate text-xs font-light', textPrimary)}>{approval.reviewerId || '—'}</div>
                </div>
                <div className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-2 py-1">
                  <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>决策时间</div>
                  <div className={cx('truncate text-xs font-light', textPrimary)}>{formatDateTime(approval.decidedAt)}</div>
                </div>
                {approval.decisionNote && (
                  <div className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-2 py-1">
                    <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>审批意见</div>
                    <div className={cx('text-xs font-light', textPrimary)}>{approval.decisionNote}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className={cx('mt-2 text-[11px] font-light', textSecondary)}>无关联审批单</div>
            )}

            {/* 审批操作入口（仅当前审批人可见；服务端自审守卫兜底） */}
            {canDecide && (
              <div className="mt-3">
                <textarea
                  value={decisionNote}
                  onChange={e => setDecisionNote(e.target.value)}
                  placeholder="审批意见（驳回必填）"
                  rows={2}
                  className="bds-input sm w-full"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" disabled={actionBusy !== null} onClick={() => handleDecide('rejected')} className="bds-btn bds-btn-secondary">
                    {actionBusy === 'rejected' ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} strokeWidth={1.75} />}
                    驳回
                  </button>
                  <button type="button" disabled={actionBusy !== null} onClick={() => handleDecide('approved')} className="bds-btn bds-btn-primary">
                    {actionBusy === 'approved' ? <Loader2 size={16} className="animate-spin" /> : <BadgeCheck size={16} strokeWidth={1.75} />}
                    通过
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 已生成凭证快照（VoucherIssued 闭环） */}
          {detail.paymentVoucher && (
            <div className="mt-4 rounded-inset p-4 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>付款凭证</div>
              <div className={cx('mt-2 text-xs font-light', textPrimary)}>{detail.paymentVoucher.voucherNumber}</div>
              <div className={cx('mt-1 text-[11px] font-light tabular-nums', textSecondary)}>
                {formatAmount(detail.paymentVoucher.amount, detail.paymentVoucher.currency)} · {voucherCategoryLabel(detail.paymentVoucher.voucherCategory)}
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
      {/* 工具栏：搜索 + 状态/分类过滤 + 新建入口（按权限显隐） */}
      <div className="bds-filterbar">
        <div className="relative min-w-56 flex-[1_1_260px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="申请编号 / 收款方 / 事由"
            className="bds-input sm pl-9"
          />
        </div>
        <div className="hidden h-4 w-px shrink-0 xl:block" style={{ background: 'var(--border-c-strong)' }} />
        <div className="bds-segment min-w-0 flex-[1_1_auto] overflow-x-auto">
          <button type="button" onClick={() => setStatusFilter('all')} className={cx('seg shrink-0', statusFilter === 'all' && 'active')}>全部状态</button>
          {PAYMENT_REQUEST_STATUSES.map(s => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)} className={cx('seg shrink-0', statusFilter === s && 'active')}>
              {PAYMENT_REQUEST_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="bds-segment min-w-0 flex-[1_1_auto] overflow-x-auto">
          <button type="button" onClick={() => setCategoryFilter('all')} className={cx('seg shrink-0', categoryFilter === 'all' && 'active')}>全部性质</button>
          {VOUCHER_CATEGORIES.map(c => (
            <button key={c} type="button" onClick={() => setCategoryFilter(c)} className={cx('seg shrink-0', categoryFilter === c && 'active')}>
              {VOUCHER_CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        {canCreate && (
          <button
            type="button"
            className="bds-btn bds-btn-primary ml-auto shrink-0"
            onClick={() => { setForm(EMPTY_FORM); setCreateError(null); setShowCreate(true); }}
          >
            <Plus size={14} strokeWidth={1.5} />
            发起付款申请
          </button>
        )}
      </div>

      {error && <div className="bds-alert danger shrink-0">{error}</div>}

      {/* 列表 + 详情侧栏 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="bds-surface flex h-full min-h-0 flex-col rounded-panel p-3">
          <div className={cx(PR_GRID_CLASS, 'px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
            <div className="min-w-0">申请编号</div>
            <div className="min-w-0">收款方</div>
            <div className="min-w-0">金额</div>
            <div className="min-w-0">状态</div>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
            {loading ? (
              <div className="bds-empty">
                <div className="glyph"><Loader2 size={24} strokeWidth={1.25} className="animate-spin" /></div>
                <div className="title">加载中…</div>
              </div>
            ) : filtered.length > 0 ? (
              filtered.map(renderRow)
            ) : (
              <div className="bds-empty">
                <div className="glyph"><ClipboardList size={24} strokeWidth={1.25} /></div>
                <div className="title">暂无匹配付款申请</div>
              </div>
            )}
          </div>
          {/* R3 诚实化：total = 服务端全量计数；截断/筛选命中透明披露，不再把窗口误当全量 */}
          <div
            className={cx('flex shrink-0 items-center justify-between gap-2 px-4 pt-2 text-[11px] font-light', textSecondary)}
            style={{ borderTop: 'var(--border-subtle)' }}
          >
            <span className="tabular-nums">共 {total} 条付款申请{total > items.length ? ` · 当前加载前 ${items.length} 条，可用搜索缩小范围` : ''}</span>
            {(statusFilter !== 'all' || categoryFilter !== 'all') && (
              <span className="shrink-0 tabular-nums">当前筛选命中 {filtered.length} 条</span>
            )}
          </div>
        </div>
        <div className="bds-surface flex h-full min-h-0 flex-col overflow-hidden rounded-panel">
          {renderDetail()}
        </div>
      </div>

      {/* 发起付款申请 modal */}
      {showCreate && (
        <div className="bds-modal-mask" onClick={() => !creating && setShowCreate(false)}>
          <div className="bds-modal" style={{ width: '28rem' }} onClick={e => e.stopPropagation()}>
            <h2 className={cx('mb-4 text-[13px] font-light tracking-[0.02em]', textPrimary)}>发起付款申请</h2>
            <div className="space-y-3">
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>供应商档案</label>
                <select
                  value={form.supplierRelationId}
                  onChange={e => setForm(f => ({ ...f, supplierRelationId: e.target.value }))}
                  className="bds-select sm"
                >
                  <option value="">手动输入（不关联档案）</option>
                  {supplierOptions.map(r => (
                    <option key={r.id} value={r.id}>{relationDisplayName(r)}</option>
                  ))}
                </select>
              </div>
              {!form.supplierRelationId && (
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>收款方名称 *</label>
                  <input value={form.supplierName} onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} className="bds-input sm" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>金额 *</label>
                  <input type="number" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} className="bds-input sm" />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>币种 *</label>
                  <input value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className="bds-input sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>付款性质</label>
                  <select
                    value={form.paymentCategory}
                    onChange={e => setForm(f => ({ ...f, paymentCategory: e.target.value as PaymentCategory }))}
                    className="bds-select sm"
                  >
                    {VOUCHER_CATEGORIES.map(c => (
                      <option key={c} value={c}>{VOUCHER_CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>预期付款日</label>
                  <CapsuleDateInput value={form.expectedPaymentDate} onChange={v => setForm(f => ({ ...f, expectedPaymentDate: v }))} isDarkMode={_isDarkMode} className="bds-input sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>来源单据类型</label>
                  <select
                    value={form.sourceType}
                    onChange={e => setForm(f => ({ ...f, sourceType: e.target.value as '' | PaymentRequestSourceType }))}
                    className="bds-select sm"
                  >
                    <option value="">不关联</option>
                    {PAYMENT_REQUEST_SOURCE_TYPES.map(t => (
                      <option key={t} value={t}>{PAYMENT_REQUEST_SOURCE_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>来源单据号</label>
                  <input value={form.sourceId} onChange={e => setForm(f => ({ ...f, sourceId: e.target.value }))} className="bds-input sm" />
                </div>
              </div>
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>事由</label>
                <input value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} className="bds-input sm" />
              </div>
              {createError && <div className="bds-alert danger">{createError}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={creating} onClick={() => setShowCreate(false)} className="bds-btn bds-btn-secondary">取消</button>
              <button type="button" disabled={creating} onClick={handleCreate} className="bds-btn bds-btn-primary">
                {creating ? '提交中...' : '提交申请'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
