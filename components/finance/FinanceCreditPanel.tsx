/**
 * FinanceCreditPanel — 客户信用面板（信用控制域 Track F 前端落点）
 *
 * 数据源：/v1/credit/:customerId（creditService）
 *   status  — 额度 / 已占用 / 可用 / 冻结状态 / 门禁标记 creditFrozen / 最大逾期天数
 *   history — CreditLimitHistory append-only 时间线（冻结/解冻/占用释放全事件）
 *   freeze  — 人工冻结（scope credit:freeze:write，理由必填）
 *   thaw    — 主管手动解冻（scope credit:thaw:write，理由必填，记录 thawedReason）
 *
 * REQ2-15 破产处置区块（DR-055，/v1/credit/bankruptcy）：
 *   案件列表卡（跨客户，黑天鹅低频）→ 开案 BottomSheet（declare 首动作 + 自动信用冻结）→
 *   案件详情子视图（动作时间线 append-only + 实时损益汇总 + 四类动作登记 + 闭案终态）。
 *   闭案不自动解冻——信用恢复属重大人工决策，提示走本面板冻结/解冻入口（DR-055-③）。
 *
 * 权限显隐：冻结/解冻/破产写操作按 scope 门控（服务端 fail-closed 兜底）。
 * 联动预留：customerId / onCustomerChange props 供 RelationsManager 等外部容器受控接入；
 * embedded 模式供客户详情（DetailPanel）等已提供客户上下文的容器直接嵌入。
 *
 * 设计：flat 无阴影、bds 语义类、字重 ≤300、无 emoji。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Ban, CircleDollarSign, Loader2, Plus, RotateCcw, ShieldCheck, Ship, ShoppingCart, Undo2 } from 'lucide-react';
import { hasPermission } from '../../services/authService';
import {
  creditService,
  CREDIT_LIMIT_STATUS_LABELS,
  OVERDUE_FREEZE_THRESHOLD_DAYS,
  SYSTEM_CREDIT_ACTOR,
  creditTriggerTypeLabel,
  bankruptcyActionLabel,
  DISPOSAL_ACTION_TYPES,
  type BankruptcyActionType,
  type BankruptcyActionView,
  type BankruptcyProceedingItem,
  type BankruptcyProceedingView,
  type BankruptcySummary,
  type CreditHistoryItem,
  type CreditStatus,
} from '../../services/creditService';
import BottomSheet from '../ui/BottomSheet';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import { bdsToast } from '../ui/bdsToast';
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

/** 破产动作时间（后端 serializeValue：BigInt createdAt → 毫秒数） */
function formatEpoch(value?: number | null): string {
  if (value === null || value === undefined) return '—';
  const d = new Date(Number(value));
  return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }) : String(value);
}

/** 处置期四类动作的登记配置（类型徽章样式 + 快照字段；镜像后端 DISPOSAL_ACTION_TYPES） */
const DISPOSAL_ACTION_META: Array<{ type: BankruptcyActionType; label: string; badgeClass: string; amountLabel: string; amountHint: string }> = [
  { type: 'resale', label: '转卖处置', badgeClass: 'bds-badge sm info', amountLabel: '转卖回收金额', amountHint: '下家买家支付的货款（计入回收，冲减净损失）' },
  { type: 'return_shipment', label: '退运', badgeClass: 'bds-badge sm neutral', amountLabel: '退运成本', amountHint: '运回发生的费用（计入损失）' },
  { type: 'bad_debt', label: '坏账登记', badgeClass: 'bds-badge sm danger', amountLabel: '坏账金额', amountHint: '确认无法收回的债权（快照关联发票号/订单号）' },
  { type: 'recover', label: '部分回款', badgeClass: 'bds-badge sm success', amountLabel: '回款金额', amountHint: '清算分配等收回的部分款项' },
];

/** 动作 payload 快照字段的中文标签（时间线要素渲染；未知键原样展示） */
const SNAPSHOT_LABELS: Record<string, string> = {
  buyer: '买家',
  shipmentNo: '运单',
  invoiceNumbers: '发票',
  orderIds: '订单',
  receivedAt: '到账',
  declaredAt: '宣告日',
  totalClaimedAmount: '申报',
  relationName: '客户',
};

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

export function FinanceCreditPanel({ isDarkMode, endpoint, relations, customerId: controlledId, onCustomerChange, embedded = false }: FinanceCreditPanelProps) {
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

  // ── REQ2-15 破产处置区块状态 ──
  const [proceedings, setProceedings] = useState<BankruptcyProceedingItem[]>([]);
  const [proceedingsLoading, setProceedingsLoading] = useState(true);
  const [proceedingsError, setProceedingsError] = useState<string | null>(null);
  const [selectedProceedingId, setSelectedProceedingId] = useState('');
  const [proceedingDetail, setProceedingDetail] = useState<{ proceeding: BankruptcyProceedingView; actions: BankruptcyActionView[]; summary: BankruptcySummary } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 开案 BottomSheet
  const [showOpenSheet, setShowOpenSheet] = useState(false);
  const [openForm, setOpenForm] = useState({ declaredAt: '', totalClaimedAmount: '', note: '' });
  const [openSaving, setOpenSaving] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // 动作登记 BottomSheet
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [actionForm, setActionForm] = useState({ actionType: 'resale' as BankruptcyActionType, amount: '', buyer: '', shipmentNo: '', invoiceNumbers: '', orderIds: '', receivedAt: '', note: '' });
  const [actionFormSaving, setActionFormSaving] = useState(false);
  const [actionFormError, setActionFormError] = useState<string | null>(null);

  // 闭案确认 modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

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

  // ── REQ2-15 破产处置：加载与操作 ──

  const loadProceedings = useCallback(async () => {
    setProceedingsLoading(true);
    setProceedingsError(null);
    try {
      const items = await creditService.listBankruptcyProceedings(undefined, endpoint);
      setProceedings(items);
    } catch (e: any) {
      setProceedingsError(String(e?.message || e));
    } finally {
      setProceedingsLoading(false);
    }
  }, [endpoint]);

  const loadProceedingDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const detail = await creditService.getBankruptcyProceeding(id, endpoint);
      setProceedingDetail(detail);
    } catch (e: any) {
      setProceedingDetail(null);
      setDetailError(String(e?.message || e));
    } finally {
      setDetailLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { loadProceedings(); }, [loadProceedings]);

  useEffect(() => {
    if (selectedProceedingId) loadProceedingDetail(selectedProceedingId);
    else {
      setProceedingDetail(null);
      setDetailError(null);
    }
  }, [selectedProceedingId, loadProceedingDetail]);

  const openProceedingSheet = () => {
    setOpenForm({ declaredAt: '', totalClaimedAmount: '', note: '' });
    setOpenError(null);
    setShowOpenSheet(true);
  };

  const handleOpenProceeding = async () => {
    if (openSaving) return;
    if (!customerId) {
      setOpenError('请先选择破产客户（工具栏客户下拉）');
      return;
    }
    if (!openForm.declaredAt) {
      setOpenError('宣告日必填');
      return;
    }
    const claimed = Number(openForm.totalClaimedAmount);
    if (!Number.isFinite(claimed) || claimed < 0) {
      setOpenError('申报债权总额必须为非负数');
      return;
    }
    setOpenSaving(true);
    setOpenError(null);
    try {
      const r = await creditService.openBankruptcyProceeding({
        relationId: customerId,
        declaredAt: openForm.declaredAt,
        totalClaimedAmount: claimed,
        note: openForm.note.trim() || undefined,
      }, endpoint);
      setShowOpenSheet(false);
      bdsToast.success(`破产案件 ${r.proceeding.proceedingNumber} 已开案${r.creditFrozen ? '，客户信用已自动冻结' : ''}`);
      await Promise.all([
        loadProceedings(),
        loadCredit(customerId), // 开案自动冻结 → 信用状态同步刷新
      ]);
      setSelectedProceedingId(r.proceeding.id);
    } catch (e: any) {
      setOpenError(String(e?.message || e));
    } finally {
      setOpenSaving(false);
    }
  };

  const openActionSheet = (type: BankruptcyActionType) => {
    setActionForm({ actionType: type, amount: '', buyer: '', shipmentNo: '', invoiceNumbers: '', orderIds: '', receivedAt: '', note: '' });
    setActionFormError(null);
    setShowActionSheet(true);
  };

  const handleAddAction = async () => {
    if (!selectedProceedingId || actionFormSaving) return;
    const amount = Number(actionForm.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setActionFormError(`${DISPOSAL_ACTION_META.find(m => m.type === actionForm.actionType)?.amountLabel ?? '金额'}必须为非负数`);
      return;
    }
    // 按动作类型组装 payload 快照（买家/运单号/发票号/订单号等，append-only 留痕）
    const payload: Record<string, unknown> = {};
    if (actionForm.actionType === 'resale' && actionForm.buyer.trim()) payload.buyer = actionForm.buyer.trim();
    if (actionForm.actionType === 'return_shipment' && actionForm.shipmentNo.trim()) payload.shipmentNo = actionForm.shipmentNo.trim();
    if (actionForm.actionType === 'bad_debt') {
      const invoiceNumbers = actionForm.invoiceNumbers.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
      const orderIds = actionForm.orderIds.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
      if (invoiceNumbers.length) payload.invoiceNumbers = invoiceNumbers;
      if (orderIds.length) payload.orderIds = orderIds;
    }
    if (actionForm.actionType === 'recover' && actionForm.receivedAt) payload.receivedAt = actionForm.receivedAt;

    setActionFormSaving(true);
    setActionFormError(null);
    try {
      const r = await creditService.addBankruptcyAction(selectedProceedingId, {
        actionType: actionForm.actionType,
        amount,
        payload: Object.keys(payload).length ? payload : undefined,
        note: actionForm.note.trim() || undefined,
      }, endpoint);
      setShowActionSheet(false);
      bdsToast.success(`${bankruptcyActionLabel(actionForm.actionType)}已登记，净损失 ¥${r.summary.netLoss.toLocaleString('zh-CN')}`);
      await Promise.all([loadProceedingDetail(selectedProceedingId), loadProceedings()]);
    } catch (e: any) {
      setActionFormError(String(e?.message || e));
    } finally {
      setActionFormSaving(false);
    }
  };

  const handleCloseProceeding = async () => {
    if (!selectedProceedingId || closeSaving) return;
    setCloseSaving(true);
    setCloseError(null);
    try {
      const r = await creditService.closeBankruptcyProceeding(selectedProceedingId, {
        note: closeNote.trim() || undefined,
      }, endpoint);
      setShowCloseModal(false);
      setCloseNote('');
      bdsToast.success(`案件已闭案，净损失 ¥${r.summary.netLoss.toLocaleString('zh-CN')}`);
      await Promise.all([loadProceedingDetail(selectedProceedingId), loadProceedings()]);
    } catch (e: any) {
      setCloseError(String(e?.message || e));
    } finally {
      setCloseSaving(false);
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

  // ── REQ2-15 破产处置区块（跨客户案件列表，append-only 留痕入口） ──
  const renderBankruptcySection = () => (
    <div className="rounded-inset p-4 bds-inset">
      <div className="flex items-center justify-between gap-2">
        <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>破产处置 Bankruptcy（{proceedings.length}）</div>
        {canFreeze && (
          <button type="button" onClick={openProceedingSheet} className="bds-btn bds-btn-secondary">
            <Plus size={14} strokeWidth={1.75} />
            开案登记
          </button>
        )}
      </div>
      {proceedingsLoading ? (
        <div className={cx('mt-2 text-[11px] font-light', textSecondary)}>破产案件加载中…</div>
      ) : proceedingsError ? (
        <div className="bds-alert danger mt-2">{proceedingsError}</div>
      ) : proceedings.length === 0 ? (
        <div className={cx('mt-2 text-[11px] font-light', textSecondary)}>暂无破产案件。客户破产宣告时在此开案：登记债权后信用自动冻结，转卖/退运/坏账/回款全程留痕。</div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {proceedings.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedProceedingId(p.id)}
              className="rdl-data-row w-full min-h-0 px-2.5 py-1.5 text-left"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className={cx('truncate text-[11px] font-light', textPrimary)}>
                  {p.relationName}
                  <span className={cx('ml-1.5 text-[10px] font-light tabular-nums', textSecondary)}>{p.proceedingNumber}</span>
                </div>
                <span className={cx('shrink-0', p.status === 'processing' ? 'bds-badge sm warning' : 'bds-badge sm neutral')}>
                  {p.status === 'processing' ? '处置中' : '已闭案'}
                </span>
              </div>
              <div className={cx('mt-0.5 flex items-center justify-between gap-2 text-[10px] font-light tabular-nums', textSecondary)}>
                <span className="truncate">宣告 {p.declaredAt} · 动作 {p.summary.actionCount}</span>
                <span className="shrink-0">申报 {formatAmount(p.totalClaimedAmount)} · 净损失 {formatAmount(p.summary.netLoss)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ── REQ2-15 案件详情子视图（时间线 + 实时汇总 + 动作登记 + 闭案） ──
  const renderProceedingDetail = () => {
    const body = (() => {
      if (detailLoading) {
        return (
          <div className={cx('flex h-32 flex-col items-center justify-center text-center', textSecondary)}>
            <Loader2 size={20} strokeWidth={1.25} className="mb-3 animate-spin opacity-45" />
            <div className="text-sm font-light">案件详情加载中…</div>
          </div>
        );
      }
      if (detailError) return <div className="bds-alert danger m-5">{detailError}</div>;
      if (!proceedingDetail) return null;
      const { proceeding, actions, summary } = proceedingDetail;
      const isProcessing = proceeding.status === 'processing';

      return (
        <div className={embedded ? undefined : 'min-h-0 flex-1 overflow-y-auto px-5 pb-5'}>
          {/* 案件头 */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className={cx('truncate text-sm font-light', textPrimary)}>{proceeding.relationName}</div>
              <div className={cx('mt-0.5 text-[10px] font-light tabular-nums', textSecondary)}>
                {proceeding.proceedingNumber} · 宣告 {proceeding.declaredAt}
              </div>
            </div>
            <span className={cx('shrink-0', isProcessing ? 'bds-badge sm warning' : 'bds-badge sm neutral')}>
              {isProcessing ? '处置中' : '已闭案'}
            </span>
          </div>

          {/* 实时损益汇总（净损失 = 申报 − 转卖回收 − 回款 + 退运成本） */}
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>申报债权</div>
              <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(summary.totalClaimed)}</div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>转卖回收</div>
              <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(summary.resaleRecovered)}</div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>部分回款</div>
              <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(summary.recovered)}</div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>退运成本</div>
              <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(summary.returnShippingCost)}</div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>坏账合计</div>
              <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimary)}>{formatAmount(summary.badDebt)}</div>
            </div>
            <div className="rounded-inset p-3 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>净损失</div>
              <div className={cx('mt-2 text-sm font-light tabular-nums', summary.netLoss > 0 ? 'text-[var(--danger-text)]' : textPrimary)}>
                {formatAmount(summary.netLoss)}
              </div>
            </div>
          </div>

          {/* 处置动作登记（processing 期；写权限门控，服务端 fail-closed 兜底） */}
          {isProcessing && canFreeze && (
            <div className="mt-3 rounded-inset p-4 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>处置动作登记</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {DISPOSAL_ACTION_META.map(m => (
                  <button key={m.type} type="button" onClick={() => openActionSheet(m.type)} className="bds-btn bds-btn-ghost">
                    {m.type === 'resale' && <ShoppingCart size={14} strokeWidth={1.5} />}
                    {m.type === 'return_shipment' && <Ship size={14} strokeWidth={1.5} />}
                    {m.type === 'bad_debt' && <CircleDollarSign size={14} strokeWidth={1.5} />}
                    {m.type === 'recover' && <Undo2 size={14} strokeWidth={1.5} />}
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => { setCloseNote(''); setCloseError(null); setShowCloseModal(true); }}
                  className="bds-btn bds-btn-secondary"
                >
                  <Ban size={14} strokeWidth={1.75} />
                  闭案（终态）
                </button>
              </div>
            </div>
          )}

          {/* 闭案结论（终态快照） */}
          {!isProcessing && proceeding.closeNote && (
            <div className="mt-3 rounded-inset p-4 bds-inset">
              <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>闭案结论</div>
              <div className={cx('mt-1.5 text-[11px] font-light leading-relaxed', textPrimary)}>{proceeding.closeNote}</div>
              <div className={cx('mt-1.5 text-[10px] font-light', textSecondary)}>闭案不自动解冻：信用恢复请返回客户信用人工解冻（重大决策留痕）。</div>
            </div>
          )}

          {/* 动作时间线（append-only 正序；declare → 处置动作 → close 全程留痕） */}
          <div className="mt-3 rounded-inset p-4 bds-inset">
            <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>处置时间线（{actions.length}）</div>
            {actions.length === 0 ? (
              <div className={cx('mt-2 text-[11px] font-light', textSecondary)}>暂无动作记录。</div>
            ) : (
              <div className="mt-2 space-y-1.5">
                {actions.map(a => {
                  const meta = DISPOSAL_ACTION_META.find(m => m.type === a.actionType);
                  const badgeClass = a.actionType === 'declare'
                    ? 'bds-badge sm warning'
                    : a.actionType === 'close'
                      ? 'bds-badge sm neutral'
                      : (meta?.badgeClass ?? 'bds-badge sm neutral');
                  return (
                    <div key={a.id} className="rdl-data-row min-h-0 px-2.5 py-1.5">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className={cx('shrink-0', badgeClass)}>{bankruptcyActionLabel(a.actionType)}</span>
                          {a.amount > 0 && (
                            <span className={cx('truncate text-[11px] font-light tabular-nums', textPrimary)}>{formatAmount(a.amount)}</span>
                          )}
                        </div>
                        <div className={cx('shrink-0 text-[10px] font-light tabular-nums', textSecondary)}>{formatEpoch(a.createdAt)}</div>
                      </div>
                      {/* 快照要素（买家/运单号/发票号/订单号/宣告日等；append-only 不失真） */}
                      {a.payload && Object.keys(a.payload).length > 0 && (
                        <div className={cx('mt-0.5 truncate text-[10px] font-light tabular-nums', textSecondary)}>
                          {Object.entries(a.payload)
                            .filter(([, v]) => v !== null && v !== undefined && v !== '')
                            .map(([k, v]) => `${SNAPSHOT_LABELS[k] ?? k} ${Array.isArray(v) ? v.join(' / ') : String(v)}`)
                            .join(' · ')}
                        </div>
                      )}
                      {(a.note || a.actor) && (
                        <div className={cx('mt-0.5 truncate text-[10px] font-light', textSecondary)}>
                          {a.actor && a.actor !== SYSTEM_CREDIT_ACTOR ? `${a.actor} · ` : ''}{a.note || ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    })();

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        <button
          type="button"
          onClick={() => setSelectedProceedingId('')}
          className="bds-btn bds-btn-ghost self-start"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          返回客户信用
        </button>
        {embedded ? body : <div className="bds-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">{body}</div>}
      </div>
    );
  };

  // 开案 BottomSheet（宣告日 + 申报债权额 + 备注；客户=当前选中客户）
  const openProceedingSheetEl = showOpenSheet && (
    <BottomSheet
      isOpen={showOpenSheet}
      onClose={() => !openSaving && setShowOpenSheet(false)}
      title="破产开案登记"
      isDarkMode={isDarkMode}
    >
      <div className="space-y-4 px-6 py-5">
        <div className={cx('text-[11px] font-light leading-relaxed', textSecondary)}>
          开案后登记申报债权，客户 {customerId ? relationDisplayName(customerOptions.find(r => r.id === customerId) ?? ({} as Relation)) : '（未选择）'} 信用将自动冻结（best-effort）；
          处置动作（转卖/退运/坏账/回款）全程 append-only 留痕，闭案汇总净损失。同客户同时仅一个进行中案件。
        </div>
        <div>
          <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>宣告日 *</label>
          <CapsuleDateInput
            value={openForm.declaredAt}
            onChange={v => setOpenForm(f => ({ ...f, declaredAt: v }))}
            isDarkMode={isDarkMode}
            className="bds-input sm w-auto"
            placeholder="法院宣告/破产受理日"
          />
        </div>
        <div>
          <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>申报债权总额 *</label>
          <input
            type="number" min={0} step="0.0001"
            value={openForm.totalClaimedAmount}
            onChange={e => setOpenForm(f => ({ ...f, totalClaimedAmount: e.target.value }))}
            placeholder="对破产客户的应收债权总额（含未出运货值）"
            className="bds-input sm w-full"
          />
        </div>
        <div>
          <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>备注</label>
          <input
            value={openForm.note}
            onChange={e => setOpenForm(f => ({ ...f, note: e.target.value }))}
            placeholder="案件背景（受理法院/管理人联系方式等）"
            className="bds-input sm w-full"
          />
        </div>
        {openError && <div className="bds-alert danger">{openError}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" disabled={openSaving} onClick={() => setShowOpenSheet(false)} className="bds-btn bds-btn-ghost">取消</button>
          <button type="button" disabled={openSaving} onClick={handleOpenProceeding} className="bds-btn bds-btn-primary">
            {openSaving && <Loader2 size={14} className="animate-spin" />}
            确认开案
          </button>
        </div>
      </div>
    </BottomSheet>
  );

  // 动作登记 BottomSheet（四类处置动作 + 快照字段 + 金额 + 备注）
  const actionSheetMeta = DISPOSAL_ACTION_META.find(m => m.type === actionForm.actionType);
  const addActionSheetEl = showActionSheet && (
    <BottomSheet
      isOpen={showActionSheet}
      onClose={() => !actionFormSaving && setShowActionSheet(false)}
      title={`登记处置动作 · ${actionSheetMeta?.label ?? ''}`}
      isDarkMode={isDarkMode}
    >
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-wrap gap-2">
          {DISPOSAL_ACTION_META.map(m => (
            <button
              key={m.type}
              type="button"
              onClick={() => setActionForm(f => ({ ...f, actionType: m.type }))}
              className={cx(m.type === actionForm.actionType ? 'bds-btn bds-btn-secondary' : 'bds-btn bds-btn-ghost')}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div>
          <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>{actionSheetMeta?.amountLabel} *</label>
          <input
            type="number" min={0} step="0.0001"
            value={actionForm.amount}
            onChange={e => setActionForm(f => ({ ...f, amount: e.target.value }))}
            placeholder={actionSheetMeta?.amountHint}
            className="bds-input sm w-full"
          />
        </div>
        {actionForm.actionType === 'resale' && (
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>下家买家</label>
            <input
              value={actionForm.buyer}
              onChange={e => setActionForm(f => ({ ...f, buyer: e.target.value }))}
              placeholder="转卖买家公司名（快照留痕）"
              className="bds-input sm w-full"
            />
          </div>
        )}
        {actionForm.actionType === 'return_shipment' && (
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>退运运单号</label>
            <input
              value={actionForm.shipmentNo}
              onChange={e => setActionForm(f => ({ ...f, shipmentNo: e.target.value }))}
              placeholder="SH-xxxx（快照留痕）"
              className="bds-input sm w-full"
            />
          </div>
        )}
        {actionForm.actionType === 'bad_debt' && (
          <div className="space-y-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>关联发票号（逗号分隔）</label>
              <input
                value={actionForm.invoiceNumbers}
                onChange={e => setActionForm(f => ({ ...f, invoiceNumbers: e.target.value }))}
                placeholder="INV-2026-001, INV-2026-002（闭环可见性快照）"
                className="bds-input sm w-full"
              />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>关联订单号（逗号分隔）</label>
              <input
                value={actionForm.orderIds}
                onChange={e => setActionForm(f => ({ ...f, orderIds: e.target.value }))}
                placeholder="PO-2601007, PO-2601008"
                className="bds-input sm w-full"
              />
            </div>
          </div>
        )}
        {actionForm.actionType === 'recover' && (
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>回款日期</label>
            <CapsuleDateInput
              value={actionForm.receivedAt}
              onChange={v => setActionForm(f => ({ ...f, receivedAt: v }))}
              isDarkMode={isDarkMode}
              className="bds-input sm w-auto"
              placeholder="清算分配到账日"
            />
          </div>
        )}
        <div>
          <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>备注</label>
          <input
            value={actionForm.note}
            onChange={e => setActionForm(f => ({ ...f, note: e.target.value }))}
            placeholder="补充说明（可选）"
            className="bds-input sm w-full"
          />
        </div>
        {actionFormError && <div className="bds-alert danger">{actionFormError}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" disabled={actionFormSaving} onClick={() => setShowActionSheet(false)} className="bds-btn bds-btn-ghost">取消</button>
          <button type="button" disabled={actionFormSaving} onClick={handleAddAction} className="bds-btn bds-btn-primary">
            {actionFormSaving && <Loader2 size={14} className="animate-spin" />}
            登记动作
          </button>
        </div>
      </div>
    </BottomSheet>
  );

  // 闭案确认 modal（终态：汇总结论 + 不自动解冻提示）
  const closeModalEl = showCloseModal && proceedingDetail && (
    <div className="bds-modal-mask" onClick={() => !closeSaving && setShowCloseModal(false)}>
      <div className="bds-modal" style={{ width: '28rem' }} onClick={e => e.stopPropagation()}>
        <h2 className={cx('mb-4 text-[13px] font-light tracking-[0.02em]', textPrimary)}>闭案确认（终态）</h2>
        <div className="space-y-3">
          <div className={cx('text-[11px] font-light leading-relaxed', textSecondary)}>
            闭案后不可再追加处置动作，汇总结论将落库到案件备注。净损失 = 申报债权 − 转卖回收 − 部分回款 + 退运成本。
          </div>
          <div className="rounded-inset p-3 bds-inset">
            <div className="grid grid-cols-2 gap-y-1.5 text-[11px] font-light tabular-nums">
              <span className={textSecondary}>申报债权</span><span className={cx('text-right', textPrimary)}>{formatAmount(proceedingDetail.summary.totalClaimed)}</span>
              <span className={textSecondary}>转卖回收</span><span className={cx('text-right', textPrimary)}>{formatAmount(proceedingDetail.summary.resaleRecovered)}</span>
              <span className={textSecondary}>部分回款</span><span className={cx('text-right', textPrimary)}>{formatAmount(proceedingDetail.summary.recovered)}</span>
              <span className={textSecondary}>退运成本</span><span className={cx('text-right', textPrimary)}>{formatAmount(proceedingDetail.summary.returnShippingCost)}</span>
              <span className={textSecondary}>坏账合计</span><span className={cx('text-right', textPrimary)}>{formatAmount(proceedingDetail.summary.badDebt)}</span>
              <span className={cx('font-normal', 'text-[var(--danger-text)]')}>净损失</span>
              <span className={cx('text-right font-normal', 'text-[var(--danger-text)]')}>{formatAmount(proceedingDetail.summary.netLoss)}</span>
            </div>
          </div>
          <div className={cx('text-[11px] font-light leading-relaxed', textSecondary)}>
            闭案不自动解冻：客户信用恢复属重大人工决策，请返回客户信用手动解冻（留痕审计）。
          </div>
          <div>
            <label className={cx('mb-1 block text-[11px] font-light', textSecondary)}>闭案备注</label>
            <textarea
              value={closeNote}
              onChange={e => setCloseNote(e.target.value)}
              rows={3}
              placeholder="债权处置结论说明（可选，与汇总一并落库）"
              className="bds-input sm w-full"
            />
          </div>
          {closeError && <div className="bds-alert danger">{closeError}</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={closeSaving} onClick={() => setShowCloseModal(false)} className="bds-btn bds-btn-secondary">取消</button>
          <button type="button" disabled={closeSaving} onClick={handleCloseProceeding} className="bds-btn bds-btn-primary">
            {closeSaving ? '提交中...' : '确认闭案'}
          </button>
        </div>
      </div>
    </div>
  );

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

  // 嵌入模式：外部容器（客户详情等）已提供客户上下文与表面，仅渲染状态主体 + 破产区块 + modal
  if (embedded) {
    return (
      <div className="flex flex-col gap-2.5">
        {selectedProceedingId ? renderProceedingDetail() : (
          <>
            {renderStatusBody()}
            {renderBankruptcySection()}
          </>
        )}
        {actionModal}
        {openProceedingSheetEl}
        {addActionSheetEl}
        {closeModalEl}
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

      {selectedProceedingId ? renderProceedingDetail() : (
        <>
          <div className="bds-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
            {renderStatusBody()}
          </div>
          {renderBankruptcySection()}
        </>
      )}

      {actionModal}
      {openProceedingSheetEl}
      {addActionSheetEl}
      {closeModalEl}
    </div>
  );
}
