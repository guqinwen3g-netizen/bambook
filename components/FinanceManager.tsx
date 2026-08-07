import React, { useEffect, useMemo, useRef, useState } from 'react';
import { paymentVoucherService } from '../services/paymentVoucherService';
import { invoiceService } from '../services/invoiceService';
import { allocationService } from '../services/allocationService';
import { fxSettlementService } from '../services/fxSettlementService';
import { CreditCard, FileText, Landmark, Link2, Pencil, Plus, Trash2, Loader2, AlertCircle, BarChart3 } from 'lucide-react';
import { RdlMetricCard, RdlOverlayIconButton, RdlPill, RdlSearch, RdlSurface, RdlToolbar } from './ui/RDLPrimitives';
import { FinanceReportsPanel } from './finance/FinanceReportsPanel';
import type {
  Invoice as InvoiceEntity,
  InvoiceStatus,
  InvoiceAllocation as AllocationEntity,
  InvoiceType,
  PaymentVoucher as VoucherEntity,
  VoucherStatus,
  VoucherType,
  VoucherSettlementSummary,
} from '../types';
import RelatedEntitiesPanel from './RelatedEntitiesPanel';
import { PageHeader } from './ui/PageHeader';

// ── Typedefs & constants ──────────────────────────────────────────────────
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type FinanceTabId = 'invoices' | 'vouchers' | 'reports';

type InvoiceTypeId = 'all' | InvoiceType;
type InvoiceStatusId = 'all' | InvoiceStatus;
type VoucherTypeId = 'all' | VoucherType;
type VoucherStatusId = 'all' | VoucherStatus;

const INVOICE_TYPES: Array<{ id: InvoiceTypeId; label: string }> = [
  { id: 'all', label: '全部类型' },
  { id: 'Receivable', label: '应收' },
  { id: 'Payable', label: '应付' },
];
const INVOICE_STATUSES: Array<{ id: InvoiceStatusId; label: string }> = [
  { id: 'all', label: '全部状态' },
  { id: 'Draft', label: '草稿' },
  { id: 'Issued', label: '已开票' },
  { id: 'PartiallyPaid', label: '部分销账' },
  { id: 'Paid', label: '已结清' },
  { id: 'Cancelled', label: '已作废' },
];
const VOUCHER_TYPES: Array<{ id: VoucherTypeId; label: string }> = [
  { id: 'all', label: '全部类型' },
  { id: 'Receipt', label: '收款' },
  { id: 'Disbursement', label: '付款' },
];
const VOUCHER_STATUSES: Array<{ id: VoucherStatusId; label: string }> = [
  { id: 'all', label: '全部状态' },
  { id: 'unreconciled', label: '未核销' },
  { id: 'partially_reconciled', label: '部分核销' },
  { id: 'reconciled', label: '已核销' },
];

const invoiceTypeLabel = (t: InvoiceType) => (t === 'Receivable' ? '应收' : '应付');
const voucherTypeLabel = (t: VoucherType) => (t === 'Receipt' ? '收款' : '付款');

const FINANCE_TABS: Array<{ id: FinanceTabId; label: string; icon: typeof FileText }> = [
  { id: 'invoices', label: '发票', icon: FileText },
  { id: 'vouchers', label: '收付款', icon: CreditCard },
  { id: 'reports', label: '报表', icon: BarChart3 },
];

const TABLE_GRID_CLASS =
  'grid w-full min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,0.78fr)_minmax(0,0.9fr)_minmax(0,1fr)]';

interface FinanceManagerProps {
  isDarkMode: boolean;
  initialTab?: FinanceTabId;
  invoices: InvoiceEntity[];
  setInvoices: React.Dispatch<React.SetStateAction<InvoiceEntity[]>>;
  vouchers: VoucherEntity[];
  setVouchers: React.Dispatch<React.SetStateAction<VoucherEntity[]>>;
}

// ── Small shared render helpers ───────────────────────────────────────────
const formatAmount = (amount: number, currency?: string) => {
  const sym =
    currency === 'CNY' ? '¥' :
    currency === 'USD' ? '$' :
    currency === 'EUR' ? '€' :
    (currency || '');
  return `${sym}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatCurrencyAggregate = (agg: Array<{ currency: string; total: number; count: number }>) => {
  if (agg.length === 0) return { primary: '—', secondary: '0 笔' };
  if (agg.length === 1) {
    const only = agg[0];
    return {
      primary: formatAmount(only.total, only.currency),
      secondary: `${only.count} 笔`,
    };
  }
  // multi-currency → show top 2 amounts
  const sorted = [...agg].sort((a, b) => b.total - a.total);
  const main = sorted[0];
  const rest = sorted.slice(1).map(r => formatAmount(r.total, r.currency)).join(' / ');
  const totalCount = agg.reduce((sum, a) => sum + a.count, 0);
  return {
    primary: formatAmount(main.total, main.currency),
    secondary: `${totalCount} 笔 · ${rest}`,
  };
};

const financeStatusTone = (isDarkMode: boolean) =>
  isDarkMode ? 'bg-white/[0.055] text-white/70' : 'bg-white/50 text-slate-700/76';

const financeInactiveStatusTone = (isDarkMode: boolean) =>
  isDarkMode ? 'bg-white/[0.035] text-white/42' : 'bg-white/34 text-slate-500/70';

const invoiceStatusTone = (status: InvoiceStatus, isDarkMode: boolean) =>
  status === 'Cancelled' ? financeInactiveStatusTone(isDarkMode) : financeStatusTone(isDarkMode);

const voucherStatusTone = (_status: VoucherStatus, isDarkMode: boolean) => financeStatusTone(isDarkMode);

const financeAlertTone = (isDarkMode: boolean) =>
  isDarkMode ? 'bg-white/[0.055] text-white/72' : 'bg-white/48 text-slate-700/78';

/** 核销状态说明 + 下一步指引（消费后端稳定枚举，不猜字符串） */
const VOUCHER_STATUS_GUIDE: Record<VoucherStatus, { label: string; nextStep: string }> = {
  unreconciled: { label: '未核销', nextStep: '该凭证尚未核销任何发票。可在发票模块关联核销，或等待 Agent 自动匹配。' },
  partially_reconciled: { label: '部分核销', nextStep: '该凭证已部分核销发票。余款仍挂账，可继续关联其他发票完成核销。' },
  reconciled: { label: '已核销', nextStep: '该凭证已完全核销，资金流闭环。如需调整，请冲销后重新核销。' },
  cancelled: { label: '已作废', nextStep: '该凭证已作废，不再参与核销。' },
};

const ToolbarFilterButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <RdlPill
    type="button"
    onClick={onClick}
    active={active}
    className="min-h-8 shrink-0 px-3 text-[11px]"
  >
    {children}
  </RdlPill>
);

type KpiCard = {
  label: string;
  primary: string;
  secondary: string;
};

const KpiCard: React.FC<{ card: KpiCard; isDarkMode: boolean }> = ({ card, isDarkMode }) => {
  const textPrimary = isDarkMode ? 'text-white/86' : 'text-slate-900';
  const textSecondary = isDarkMode ? 'text-white/52' : 'text-slate-500';
  return (
    <RdlMetricCard className="min-h-[112px] justify-between">
      <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondary)}>{card.label}</div>
      <div className={cx('mt-2 text-lg font-light tabular-nums', textPrimary)}>{card.primary}</div>
      <div className={cx('mt-1 text-[11px] font-light', textSecondary)}>{card.secondary}</div>
    </RdlMetricCard>
  );
};

// ── Aggregation helpers ───────────────────────────────────────────────────
type CurrencyAggItem = { currency: string; total: number; count: number };

const aggregateByCurrency = <T extends { currency?: string; amount: number }>(
  items: T[],
): CurrencyAggItem[] => {
  const map = new Map<string, CurrencyAggItem>();
  for (const item of items) {
    const currency = item.currency || '—';
    const existing = map.get(currency);
    if (existing) {
      existing.total += item.amount;
      existing.count += 1;
    } else {
      map.set(currency, { currency: item.currency || '—', total: item.amount, count: 1 });
    }
  }
  return Array.from(map.values());
};

// ── Component ─────────────────────────────────────────────────────────────

const FinanceManager: React.FC<FinanceManagerProps> = ({
  isDarkMode,
  initialTab = 'vouchers',
  invoices,
  setInvoices,
  vouchers,
  setVouchers,
}) => {
  // ── View switching ───
  const [activeTab, setActiveTab] = useState<FinanceTabId>(initialTab);
  // Keep local state for activeTab in sync with parent's initialTab prop (handles deep-link navigation).
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // ── Filter state (one flat set; resets on tab change) ───
  const [searchTerm, setSearchTerm] = useState('');

  // ── P0 payment manual path: 创建凭证 modal state ───
  const [showCreateVoucher, setShowCreateVoucher] = useState(false);
  const [voucherForm, setVoucherForm] = useState({ voucherNumber: '', type: 'Receipt' as 'Receipt' | 'Disbursement', amount: '', currency: 'USD', paymentDate: '', paymentMethod: 'TT', customerName: '' });
  const [voucherCreating, setVoucherCreating] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [editingVoucher, setEditingVoucher] = useState<VoucherEntity | null>(null);

  const openEditVoucher = (voucher: VoucherEntity) => {
    setEditingVoucher(voucher);
    setVoucherForm({
      voucherNumber: voucher.voucherNumber || '',
      type: voucher.type || 'Receipt',
      amount: String(voucher.amount ?? ''),
      currency: voucher.currency || 'USD',
      paymentDate: voucher.paymentDate || '',
      paymentMethod: voucher.paymentMethod || 'TT',
      customerName: voucher.customerName || '',
    });
    setVoucherError(null);
    setShowCreateVoucher(true);
  };

  const handleSaveVoucher = async () => {
    if (!editingVoucher) return;
    const voucherAmount = Number(voucherForm.amount);
    if (!voucherForm.voucherNumber || !voucherForm.amount) {
      setVoucherError('凭证号和金额为必填项');
      return;
    }
    if (!Number.isFinite(voucherAmount) || voucherAmount <= 0) {
      setVoucherError('金额必须是大于 0 的有效数字');
      return;
    }
    setVoucherCreating(true);
    setVoucherError(null);
    try {
      const updated = await paymentVoucherService.updatePaymentVoucher(editingVoucher.id, {
        voucherNumber: voucherForm.voucherNumber,
        type: voucherForm.type,
        amount: voucherAmount,
        currency: voucherForm.currency,
        paymentDate: voucherForm.paymentDate || new Date().toISOString().slice(0, 10),
        paymentMethod: voucherForm.paymentMethod,
        customerName: voucherForm.customerName || undefined,
      });
      setVouchers(prev => prev.map(v => v.id === editingVoucher.id ? { ...v, ...updated } : v));
      setShowCreateVoucher(false);
      setEditingVoucher(null);
      setVoucherForm({ voucherNumber: '', type: 'Receipt', amount: '', currency: 'USD', paymentDate: '', paymentMethod: 'TT', customerName: '' });
    } catch (e: any) {
      setVoucherError(e?.message || '凭证保存失败');
    } finally {
      setVoucherCreating(false);
    }
  };

  const handleCreateVoucher = async () => {
    const voucherAmount = Number(voucherForm.amount);
    if (!voucherForm.voucherNumber || !voucherForm.amount) {
      setVoucherError('凭证号和金额为必填项');
      return;
    }
    if (!Number.isFinite(voucherAmount) || voucherAmount <= 0) {
      setVoucherError('金额必须是大于 0 的有效数字');
      return;
    }
    setVoucherCreating(true);
    setVoucherError(null);
    try {
      const created = await paymentVoucherService.createPaymentVoucher({
        voucherNumber: voucherForm.voucherNumber,
        type: voucherForm.type,
        amount: voucherAmount,
        currency: voucherForm.currency,
        paymentDate: voucherForm.paymentDate || new Date().toISOString().slice(0, 10),
        paymentMethod: voucherForm.paymentMethod,
        customerName: voucherForm.customerName || undefined,
      });
      // 成功：刷新服务端事实源（追加到本地列表，保持一致）
      setVouchers(prev => [created, ...prev]);
      setShowCreateVoucher(false);
      setEditingVoucher(null);
      setVoucherForm({ voucherNumber: '', type: 'Receipt', amount: '', currency: 'USD', paymentDate: '', paymentMethod: 'TT', customerName: '' });
    } catch (e: any) {
      // 失败：保留原数据，显示可执行反馈
      setVoucherError(`创建失败：${e?.message ?? e}`);
    } finally {
      setVoucherCreating(false);
    }
  };

  // ── F2 外汇核销闭环：结汇 modal state（消费 /v1/finance/fx-settlements contract）───
  const [settlementVoucher, setSettlementVoucher] = useState<VoucherEntity | null>(null);
  const [settlementSummary, setSettlementSummary] = useState<VoucherSettlementSummary | null>(null);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementSaving, setSettlementSaving] = useState(false);
  const [settlementDeletingId, setSettlementDeletingId] = useState<string | null>(null);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [settlementForm, setSettlementForm] = useState({ settleDate: '', foreignAmount: '', fxRate: '', bank: '', slipNumber: '', notes: '' });

  const loadSettlementSummary = async (voucherId: string) => {
    setSettlementLoading(true);
    setSettlementError(null);
    try {
      setSettlementSummary(await fxSettlementService.getVoucherSettlementSummary(voucherId));
    } catch (e: any) {
      setSettlementError(`核销摘要加载失败：${e?.message ?? e}`);
    } finally {
      setSettlementLoading(false);
    }
  };

  const openSettlementModal = (voucher: VoucherEntity) => {
    setSettlementVoucher(voucher);
    setSettlementSummary(null);
    setSettlementError(null);
    setSettlementForm({ settleDate: new Date().toISOString().slice(0, 10), foreignAmount: '', fxRate: '', bank: '', slipNumber: '', notes: '' });
    loadSettlementSummary(voucher.id);
  };

  const handleCreateSettlement = async () => {
    if (!settlementVoucher || settlementSaving) return;
    const foreignAmount = Number(settlementForm.foreignAmount);
    const fxRate = Number(settlementForm.fxRate);
    if (!settlementForm.settleDate) {
      setSettlementError('结汇日期为必填项');
      return;
    }
    if (!Number.isFinite(foreignAmount) || foreignAmount <= 0) {
      setSettlementError('结汇外币金额必须是大于 0 的有效数字');
      return;
    }
    if (!Number.isFinite(fxRate) || fxRate <= 0) {
      setSettlementError('结汇汇率必须是大于 0 的有效数字');
      return;
    }
    setSettlementSaving(true);
    setSettlementError(null);
    let mutationOk = false;
    try {
      await fxSettlementService.createFxSettlement({
        voucherId: settlementVoucher.id,
        settleDate: settlementForm.settleDate,
        foreignAmount,
        fxRate,
        bank: settlementForm.bank || undefined,
        slipNumber: settlementForm.slipNumber || undefined,
        notes: settlementForm.notes || undefined,
      });
      mutationOk = true;
      setSettlementForm({ settleDate: new Date().toISOString().slice(0, 10), foreignAmount: '', fxRate: '', bank: '', slipNumber: '', notes: '' });
    } catch (e: any) {
      // mutation 失败——真实未落库（超结/币种不一致等服务端阻断原因透出）
      setSettlementError(`结汇登记失败：${e?.message ?? e}`);
    } finally {
      setSettlementSaving(false);
    }
    // ✅ mutation 成功后以服务端摘要为真源刷新（含 cnyAmount 服务端计算结果）
    if (mutationOk) {
      try {
        await loadSettlementSummary(settlementVoucher.id);
      } catch {
        window.alert('结汇已登记，但摘要刷新失败，请关闭后重开查看最新数据。');
      }
    }
  };

  const handleDeleteSettlement = async (settlementId: string, settlementNumber: string) => {
    if (!settlementVoucher || settlementDeletingId) return;
    if (!window.confirm(`删除结汇水单 ${settlementNumber}？\n删除后该凭证未结汇余额将回滚。`)) return;
    setSettlementDeletingId(settlementId);
    setSettlementError(null);
    let mutationOk = false;
    try {
      await fxSettlementService.deleteFxSettlement(settlementId);
      mutationOk = true;
    } catch (e: any) {
      setSettlementError(`删除失败：${e?.message ?? e}`);
    } finally {
      setSettlementDeletingId(null);
    }
    if (mutationOk) {
      try {
        await loadSettlementSummary(settlementVoucher.id);
      } catch {
        window.alert('已删除，但摘要刷新失败，请关闭后重开查看最新数据。');
      }
    }
  };

  // ── P0 invoice manual UI: 创建/编辑发票 modal state ───
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceEntity | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: '', type: 'Receivable' as 'Receivable' | 'Payable', status: 'Draft' as InvoiceStatus, amount: '', currency: 'USD', customerName: '', issueDate: '', dueDate: '', notes: '', orderId: '', exchangeRate: '' });
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const openCreateInvoice = () => {
    setEditingInvoice(null);
    setInvoiceForm({ invoiceNumber: '', type: 'Receivable', status: 'Draft', amount: '', currency: 'USD', customerName: '', issueDate: '', dueDate: '', notes: '', orderId: '', exchangeRate: '' });
    setInvoiceError(null);
    setShowInvoiceModal(true);
  };

  const openEditInvoice = (inv: InvoiceEntity) => {
    setEditingInvoice(inv);
    setInvoiceForm({
      invoiceNumber: inv.invoiceNumber || '',
      type: inv.type || 'Receivable',
      status: inv.status,
      amount: String(inv.amount ?? ''),
      currency: inv.currency || 'USD',
      customerName: inv.customerName || '',
      issueDate: inv.issueDate || '',
      dueDate: inv.dueDate || '',
      notes: inv.notes || '',
      orderId: inv.orderId || '',
      exchangeRate: inv.exchangeRate != null ? String(inv.exchangeRate) : '',
    });
    setInvoiceError(null);
    setShowInvoiceModal(true);
  };

  // task_mqyusoio: 作废/软删 state（消费后端 contract，不伪造）
  const [voidDeletingId, setVoidDeletingId] = useState<string | null>(null);
  const [voidDeleteError, setVoidDeleteError] = useState<string | null>(null);

  const handleSaveInvoice = async () => {
    if (invoiceSaving) return;
    const invoiceAmount = Number(invoiceForm.amount);
    if (!invoiceForm.invoiceNumber || !invoiceForm.amount) {
      setInvoiceError('发票号和金额为必填项');
      return;
    }
    if (!Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
      setInvoiceError('金额必须是大于 0 的有效数字');
      return;
    }
    setInvoiceSaving(true);
    setInvoiceError(null);
    try {
      const payload = {
        invoiceNumber: invoiceForm.invoiceNumber,
        type: invoiceForm.type,
        status: invoiceForm.status,
        amount: invoiceAmount,
        currency: invoiceForm.currency,
        customerName: invoiceForm.customerName || undefined,
        issueDate: invoiceForm.issueDate || undefined,
        dueDate: invoiceForm.dueDate || undefined,
        notes: invoiceForm.notes || undefined,
        orderId: invoiceForm.orderId.trim() || undefined,
        exchangeRate: invoiceForm.exchangeRate ? Number(invoiceForm.exchangeRate) : undefined,
      };
      if (editingInvoice) {
        // 编辑：调 PATCH，成功后用后端返回更新本地
        const updated = await invoiceService.updateInvoice(editingInvoice.id, payload);
        setInvoices(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } as InvoiceEntity : i));
      } else {
        // 新建：调 POST，成功后追加到本地
        const created = await invoiceService.createInvoice(payload);
        setInvoices(prev => [created as InvoiceEntity, ...prev]);
      }
      setShowInvoiceModal(false);
    } catch (e: any) {
      // 失败：保留原数据，显示可执行反馈
      setInvoiceError(`保存失败：${e?.message ?? e}`);
    } finally {
      setInvoiceSaving(false);
    }
  };

  // ── P1 payment reconcile manual UI: allocation state + handlers ───
  const [allocations, setAllocations] = useState<AllocationEntity[]>([]);
  const [allocLoading, setAllocLoading] = useState(false);
  const [showAllocModal, setShowAllocModal] = useState(false);
  const [allocForm, setAllocForm] = useState({ targetId: '', appliedAmount: '', appliedDate: '' });
  const [allocSaving, setAllocSaving] = useState(false);
  const [allocError, setAllocError] = useState<string | null>(null);
  const [editingAllocId, setEditingAllocId] = useState<string | null>(null);

    const openCreateAlloc = () => {
    setEditingAllocId(null);
    setAllocForm({ targetId: '', appliedAmount: '', appliedDate: new Date().toISOString().slice(0, 10) });
    setAllocError(null);
    setShowAllocModal(true);
  };

  /** 从 allocations 数组或 ALLOC__id 解析真实 invoiceId/voucherId（不依赖 selectedItem 推断） */
  const resolveAllocParties = (allocId: string): { invoiceId?: string; voucherId?: string } => {
    const found = allocations.find(a => a.id === allocId);
    if (found) return { invoiceId: found.invoiceId, voucherId: found.voucherId };
    // fallback: 从 ALLOC__invoiceId__voucherId 格式解析
    const parts = allocId.split('__');
    if (parts.length >= 3) return { invoiceId: parts[1], voucherId: parts[2] };
    return {};
  };

  const handleSaveAlloc = async () => {
    if (!selectedItem?.id || !allocForm.targetId || !allocForm.appliedAmount) {
      setAllocError('请填写关联对象和核销金额');
      return;
    }
    if (allocSaving) return;
    setAllocSaving(true);
    setAllocError(null);
    let mutationOk = false;
    try {
      let result;
      let invId: string;
      let vocId: string;
      if (editingAllocId) {
        // 更新 allocation（PATCH）：先定位真实 invoiceId/voucherId
        result = await allocationService.updateAllocation(editingAllocId, {
          appliedAmount: Number(allocForm.appliedAmount),
          appliedDate: allocForm.appliedDate || undefined,
        });
        const parties = resolveAllocParties(editingAllocId);
        invId = parties.invoiceId!;
        vocId = parties.voucherId!;
      } else {
        // 创建 allocation（POST）
        invId = isInvoiceContext ? selectedItem.id : allocForm.targetId;
        vocId = isInvoiceContext ? allocForm.targetId : selectedItem.id;
        result = await allocationService.createAllocation({
          invoiceId: invId,
          voucherId: vocId,
          appliedAmount: Number(allocForm.appliedAmount),
          appliedDate: allocForm.appliedDate || undefined,
        });
      }
      // ✅ mutation 成功——先消费 status 重算结果 + 本地 upsert allocation（乐观更新，不依赖 refresh）
      applyRecalcResult(result.newInvoiceStatus, result.newVoucherStatus, invId, vocId);
      const newAlloc = result.allocation;
      setAllocations(prev => {
        const idx = prev.findIndex(a => a.id === newAlloc.id);
        const merged: AllocationEntity = {
          id: newAlloc.id,
          invoiceId: newAlloc.invoiceId || invId,
          voucherId: newAlloc.voucherId || vocId,
          appliedAmount: newAlloc.appliedAmount,
          appliedDate: newAlloc.appliedDate,
        };
        return idx >= 0 ? prev.map(a => a.id === newAlloc.id ? merged : a) : [merged, ...prev];
      });
      setShowAllocModal(false);
      mutationOk = true;
    } catch (e: any) {
      // mutation 失败——真实未落库，显示失败反馈
      setAllocError(`核销失败：${e?.message ?? e}`);
    } finally {
      setAllocSaving(false);
    }
    // ✅ mutation 成功后 best-effort 刷新列表（独立 try/catch，失败不误导用户）
    if (mutationOk && selectedItem?.id) {
      try {
        const params = isInvoiceContext ? { invoiceId: selectedItem.id } : { voucherId: selectedItem.id };
        const refreshed = await allocationService.listAllocations(undefined, params);
        setAllocations(refreshed);
      } catch {
        // refresh 失败——状态已更新，只提示明细刷新失败，不说"核销失败"
        window.alert('状态已更新，但明细列表刷新失败，请刷新页面查看最新数据。');
      }
    }
  };

  const handleDeleteAlloc = async (allocId: string) => {
    if (!selectedItem?.id) return;
    // 删除前先定位真实 invoiceId/voucherId（不依赖 selectedItem）
    const parties = resolveAllocParties(allocId);
    if (!window.confirm('确认撤销该核销记录？撤销后发票/凭证状态将反向重算。')) return;
    let mutationOk = false;
    try {
      const result = await allocationService.deleteAllocation(allocId);
      // ✅ mutation 成功——先消费反向重算结果 + 本地 remove allocation（乐观更新）
      applyRecalcResult(result.newInvoiceStatus, result.newVoucherStatus, parties.invoiceId, parties.voucherId);
      setAllocations(prev => prev.filter(a => a.id !== allocId));
      mutationOk = true;
    } catch (e: any) {
      // mutation 失败——真实未落库，显示失败反馈
      window.alert(`撤销核销失败：${e?.message ?? e}`);
    }
    // ✅ mutation 成功后 best-effort 刷新列表（独立 try/catch，失败不误导用户）
    if (mutationOk) {
      try {
        const params = isInvoiceContext ? { invoiceId: selectedItem.id } : { voucherId: selectedItem.id };
        const refreshed = await allocationService.listAllocations(undefined, params);
        setAllocations(refreshed);
      } catch {
        // refresh 失败——状态已更新，只提示明细刷新失败
        window.alert('状态已更新，但明细列表刷新失败，请刷新页面查看最新数据。');
      }
    }
  };

  /** 消费后端 status 重算结果，用真实 invoiceId/voucherId 精确更新本地两侧 status（不依赖 selectedItem 推断） */
  const applyRecalcResult = (newInvStatus: any, newVocStatus: any, invId?: string, vocId?: string) => {
    if (newInvStatus && invId) {
      setInvoices(prev => prev.map(i => i.id === invId ? { ...i, status: newInvStatus } as InvoiceEntity : i));
    }
    if (newVocStatus && vocId) {
      setVouchers(prev => prev.map(v => v.id === vocId ? { ...v, status: newVocStatus } : v));
    }
  };
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSearchTerm('');
    setSelectedType('all');
    setSelectedStatus('all');
    setSelectedId(null);
  }, [activeTab]);

  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  // ── Theme tokens (mirrors what the two older components used) ───
  const textPrimaryClass = isDarkMode ? 'text-white/86' : 'text-slate-950';
  const textSecondaryClass = isDarkMode ? 'text-white/52' : 'text-slate-500';
  const statusChipClass = isDarkMode
    ? 'bg-white/[0.045] text-white/54'
    : 'bg-white/42 text-slate-500';
  const formInputClass = cx(
    'w-full rounded-full px-4 py-2.5 text-xs font-light outline-none',
    isDarkMode ? 'bg-white/[0.055] text-white/82 placeholder:text-white/34' : 'bg-white/55 text-slate-700 placeholder:text-slate-400',
  );
  const formSelectClass = cx(
    'w-full rounded-full px-4 py-2.5 text-xs font-light outline-none',
    isDarkMode ? 'bg-white/[0.055] text-white/82' : 'bg-white/55 text-slate-700',
  );
  const formStaticClass = cx(
    'rounded-full px-4 py-2.5 text-xs font-light',
    isDarkMode ? 'bg-white/[0.04] text-white/50' : 'bg-white/45 text-slate-400',
  );

  // ── KPI row (always derived from ALL invoices + ALL vouchers) ───
  const kpiCards: KpiCard[] = useMemo(() => {
    const openReceivable = invoices.filter(i => i.type === 'Receivable' && i.status !== 'Paid' && i.status !== 'Cancelled');
    const openPayable = invoices.filter(i => i.type === 'Payable' && i.status !== 'Paid' && i.status !== 'Cancelled');
    const openReceiptVouchers = vouchers.filter(v => v.type === 'Receipt' && v.status !== 'reconciled');
    const openDisbursementVouchers = vouchers.filter(v => v.type === 'Disbursement' && v.status !== 'reconciled');

    const recv = formatCurrencyAggregate(aggregateByCurrency(openReceivable));
    const pay = formatCurrencyAggregate(aggregateByCurrency(openPayable));
    const recvV = formatCurrencyAggregate(aggregateByCurrency(openReceiptVouchers));
    const payV = formatCurrencyAggregate(aggregateByCurrency(openDisbursementVouchers));

    return [
      { label: '应收发票', primary: recv.primary, secondary: recv.secondary },
      { label: '应付发票', primary: pay.primary, secondary: pay.secondary },
      { label: '待收凭证', primary: recvV.primary, secondary: recvV.secondary },
      { label: '待付凭证', primary: payV.primary, secondary: payV.secondary },
    ];
  }, [invoices, vouchers]);

  // ── Per-tab lists & current row selection ───
  const filteredInvoices = useMemo(() => {
    let result = invoices;
    if (selectedType !== 'all') result = result.filter(i => i.type === selectedType);
    if (selectedStatus !== 'all') result = result.filter(i => i.status === selectedStatus);
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter(i =>
        i.invoiceNumber?.toLowerCase().includes(q) ||
        i.customerName?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [invoices, selectedType, selectedStatus, searchTerm]);

  const filteredVouchers = useMemo(() => {
    let result = vouchers;
    if (selectedType !== 'all') result = result.filter(v => v.type === selectedType);
    if (selectedStatus !== 'all') result = result.filter(v => v.status === selectedStatus);
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter(v =>
        v.voucherNumber?.toLowerCase().includes(q) ||
        v.customerName?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [vouchers, selectedType, selectedStatus, searchTerm]);

  const activeList = activeTab === 'invoices' ? filteredInvoices : filteredVouchers;
  const selectedItem = activeList.find(item => item.id === selectedId) || activeList[0];

  const isInvoiceContext = activeTab === 'invoices';

  // 选中 invoice/voucher 时加载其 allocations（消费 GET /allocations）
  useEffect(() => {
    if (!selectedItem?.id) { setAllocations([]); return; }
    setAllocLoading(true);
    const params = isInvoiceContext ? { invoiceId: selectedItem.id } : { voucherId: selectedItem.id };
    allocationService.listAllocations(undefined, params)
      .then(setAllocations)
      .catch(() => setAllocations([]))
      .finally(() => setAllocLoading(false));
  }, [selectedItem?.id, activeTab]);

  // ── Status quick-stats (shown at right of toolbar for the active tab) ───
  const statusStats = useMemo(() => {
    if (activeTab === 'reports') return [];
    if (activeTab === 'invoices') {
      const paid = invoices.filter(i => i.status === 'Paid').length;
      const partiallyPaid = invoices.filter(i => i.status === 'PartiallyPaid').length;
      const issued = invoices.filter(i => i.status === 'Issued').length;
      return [
        { label: '已结清', value: paid },
        { label: '已开票', value: issued },
        { label: '部分销账', value: partiallyPaid },
      ];
    }
    const reconciled = vouchers.filter(v => v.status === 'reconciled').length;
    const unreconciled = vouchers.filter(v => v.status === 'unreconciled').length;
    const partial = vouchers.filter(v => v.status === 'partially_reconciled').length;
    return [
      { label: '已核销', value: reconciled },
      { label: '未核销', value: unreconciled },
      { label: '部分核销', value: partial },
    ];
  }, [activeTab, invoices, vouchers]);

  // ── Column headers shared by both tabs (but the rendered CELLS differ) ───
  const columnHeaders =
    activeTab === 'invoices'
      ? [{ key: 'invoice', label: '发票' }, { key: 'typeStatus', label: '类型/状态' }, { key: 'partner', label: '伙伴' }, { key: 'amount', label: '金额' }]
      : [{ key: 'voucher', label: '凭证' }, { key: 'typeStatus', label: '类型/状态' }, { key: 'partner', label: '伙伴' }, { key: 'amount', label: '金额' }];

  // ── Render helpers for the two tab table rows ───
  const renderInvoiceRow = (item: InvoiceEntity) => {
    const active = selectedItem?.id === item.id;
    return (
      <button
        type="button"
        key={item.id}
        data-rdl-component="data-row"
        data-interactive="true"
        data-selected={active ? 'true' : 'false'}
        onClick={() => setSelectedId(item.id)}
        className={cx(
          'rdl-data-row',
          TABLE_GRID_CLASS,
          'w-full text-left text-xs',
          active && (isDarkMode ? 'bg-white/[0.075]' : 'bg-white/50'),
        )}
      >
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimaryClass)}>{item.invoiceNumber}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{invoiceTypeLabel(item.type)} · {item.currency || '—'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <span className={cx('inline-flex rounded-full px-3 py-1 text-[11px] font-light tracking-wide', invoiceStatusTone(item.status, isDarkMode))}>
            {item.status}
          </span>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{invoiceTypeLabel(item.type)}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimaryClass)}>{item.customerName || '—'}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{item.orderId ? `订单 ${item.orderId.slice(-8)}` : '无关联订单'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light tabular-nums', textPrimaryClass)}>{formatAmount(item.amount, item.currency)}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{item.dueDate || '—'}</div>
        </div>
      </button>
    );
  };

  const renderVoucherRow = (item: VoucherEntity) => {
    const active = selectedItem?.id === item.id;
    return (
      <button
        type="button"
        key={item.id}
        data-rdl-component="data-row"
        data-interactive="true"
        data-selected={active ? 'true' : 'false'}
        onClick={() => setSelectedId(item.id)}
        className={cx(
          'rdl-data-row',
          TABLE_GRID_CLASS,
          'w-full text-left text-xs',
          active && (isDarkMode ? 'bg-white/[0.075]' : 'bg-white/50'),
        )}
      >
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimaryClass)}>{item.voucherNumber}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{voucherTypeLabel(item.type)} · {item.currency || '—'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <span className={cx('inline-flex rounded-full px-3 py-1 text-[11px] font-light tracking-wide', voucherStatusTone((item.status || 'unreconciled') as VoucherStatus, isDarkMode))}>
            {item.status || 'unreconciled'}
          </span>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{voucherTypeLabel(item.type)}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimaryClass)}>{item.customerName || '—'}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{item.invoiceId ? `发票 ${item.invoiceId.slice(-8)}` : '未核销'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light tabular-nums', textPrimaryClass)}>{formatAmount(item.amount, item.currency)}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{item.paymentDate || '—'}</div>
        </div>
      </button>
    );
  };

  // ── Side panel detail rendering ───
  const activeSearchPlaceholder = activeTab === 'invoices' ? '发票号 / 伙伴' : '凭证号 / 伙伴';

  const renderEmptyState = () => (
    <div className={cx('flex h-56 flex-col items-center justify-center text-center', textSecondaryClass)}>
      {activeTab === 'invoices'
        ? <FileText size={28} strokeWidth={1} className="mb-3 opacity-45" />
        : <CreditCard size={28} strokeWidth={1} className="mb-3 opacity-45" />}
      <div className="text-sm font-light">
        {activeTab === 'invoices' ? '暂无匹配发票' : '暂无匹配凭证'}
      </div>
    </div>
  );

  const renderSidePanel = () => {
    if (!selectedItem) {
      return (
        <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondaryClass)}>
          {activeTab === 'invoices'
            ? <FileText size={28} strokeWidth={1} className="mb-3 opacity-45" />
            : <CreditCard size={28} strokeWidth={1} className="mb-3 opacity-45" />}
          <div className="text-sm font-light">
            {activeTab === 'invoices' ? '请选择发票' : '请选择凭证'}
          </div>
        </div>
      );
    }

    const isInvoice = activeTab === 'invoices';
    const invoice = isInvoice ? (selectedItem as InvoiceEntity) : null;
    const voucher = !isInvoice ? (selectedItem as VoucherEntity) : null;

    const headerLabel = isInvoice ? '当前发票' : '当前凭证';
    const headerValue = isInvoice ? invoice!.invoiceNumber : voucher!.voucherNumber;
    const headerMeta = isInvoice ? `${invoiceTypeLabel(invoice!.type)} · ${invoice!.currency || '—'}` : `${voucherTypeLabel(voucher!.type)} · ${voucher!.currency || '—'}`;
    const statusChipClassApplied = isInvoice
      ? invoiceStatusTone(invoice!.status, isDarkMode)
      : voucherStatusTone((voucher!.status || 'unreconciled') as VoucherStatus, isDarkMode);
    const statusLabel = isInvoice ? invoice!.status : (voucher!.status || 'unreconciled');

    const fieldRows = isInvoice
      ? [
          { label: '发票号', value: invoice!.invoiceNumber },
          { label: '客户/供应商', value: invoice!.customerName || '—' },
          { label: '关联订单', value: invoice!.orderId ? `订单 ${invoice!.orderId.slice(-8)}` : '—' },
          { label: '发票日期', value: invoice!.issueDate || '—' },
          { label: '到期日', value: invoice!.dueDate || '—' },
          { label: '结算日期', value: invoice!.settlementDate || '—' },
          { label: '币种', value: invoice!.currency || '—' },
          { label: '汇率', value: invoice!.exchangeRate != null ? String(invoice!.exchangeRate) : '—' },
          { label: '本位币', value: invoice!.baseCurrency || '—' },
          { label: '金额', value: formatAmount(invoice!.amount, invoice!.currency) },
          { label: '备注', value: invoice!.notes || '—' },
        ]
      : [
          { label: '凭证号', value: voucher!.voucherNumber },
          { label: '交易对象', value: voucher!.customerName || '—' },
          { label: '关联发票', value: voucher!.invoiceId ? `发票 ${voucher!.invoiceId.slice(-8)}` : '—' },
          { label: '关联订单', value: voucher!.orderId ? `订单 ${voucher!.orderId.slice(-8)}` : '—' },
          { label: '付款日期', value: voucher!.paymentDate || '—' },
          { label: '付款方式', value: voucher!.paymentMethod || '—' },
          { label: '币种', value: voucher!.currency || '—' },
          { label: '银行手续费', value: voucher!.bankFee != null ? formatAmount(voucher!.bankFee, voucher!.currency) : '—' },
          { label: '已核销金额', value: voucher!.appliedAmount != null ? formatAmount(voucher!.appliedAmount, voucher!.currency) : '—' },
          { label: '金额', value: formatAmount(voucher!.amount, voucher!.currency) },
          { label: '备注', value: voucher!.notes || '—' },
        ];

    const summary = isInvoice
      ? { label: '金额', value: formatAmount(invoice!.amount, invoice!.currency) }
      : { label: '收付金额', value: formatAmount(voucher!.amount, voucher!.currency) };

    return (
      <>
        {voidDeleteError && (
          <div className={cx('shrink-0 px-4 py-2 text-[11px] font-light', financeAlertTone(isDarkMode))}>
            {voidDeleteError}
          </div>
        )}
        <div className="shrink-0 px-5 py-5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>{headerLabel}</div>
              <div className={cx('mt-2 truncate text-base font-light', textPrimaryClass)}>{headerValue}</div>
              <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{headerMeta}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cx('mt-0.5 inline-flex rounded-full px-3 py-1 text-[11px] font-light tracking-wide', statusChipClassApplied)}>{statusLabel}</span>
              {/* P0 invoice manual UI: 编辑发票入口 */}
              {isInvoice && invoice && (
                <RdlPill
                  type="button"
                  onClick={() => openEditInvoice(invoice)}
                  className="min-h-8 px-2.5 text-[10.5px]"
                >
                  <Pencil size={10} strokeWidth={1.3} />
                  编辑
                </RdlPill>
              )}
              {/* task_mqyusoio: 作废入口（只对非 Cancelled 发票显示） */}
              {isInvoice && invoice && invoice.status !== 'Cancelled' && (
                <RdlPill
                  type="button"
                  disabled={voidDeletingId === invoice.id}
                  onClick={async () => {
                    if (!window.confirm(`作废发票 ${invoice.invoiceNumber}？\n作废后状态变为 Cancelled，不可恢复。`)) return;
                    setVoidDeletingId(invoice.id);
                    setVoidDeleteError(null);
                    try {
                      const updated = await invoiceService.cancelInvoice(invoice.id);
                      // 消费后端返回的 invoice 对象更新本地（不伪造 status）
                      setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, ...updated } : i));
                    } catch (e: any) {
                      setVoidDeleteError(`作废失败：${e.message || e}`);
                    } finally {
                      setVoidDeletingId(null);
                    }
                  }}
                  className="min-h-8 px-2.5 text-[10.5px]"
                >
                  {voidDeletingId === invoice.id ? <Loader2 size={10} className="animate-spin" /> : <AlertCircle size={10} strokeWidth={1.3} />}
                  作废
                </RdlPill>
              )}
              {/* task_mqyusoio: 软删入口（所有发票可删，HAS_ALLOCATIONS 阻断） */}
              {isInvoice && invoice && (
                <RdlPill
                  type="button"
                  disabled={voidDeletingId === invoice.id}
                  onClick={async () => {
                    if (!window.confirm(`删除发票 ${invoice.invoiceNumber}？\n有核销记录的发票不可删除。`)) return;
                    setVoidDeletingId(invoice.id);
                    setVoidDeleteError(null);
                    try {
                      await invoiceService.deleteInvoice(invoice.id);
                      setInvoices(prev => prev.filter(i => i.id !== invoice.id));
                      setSelectedId(null);
                    } catch (e: any) {
                      setVoidDeleteError(`删除失败：${e.message || e}`);
                    } finally {
                      setVoidDeletingId(null);
                    }
                  }}
                  className="min-h-8 px-2.5 text-[10.5px]"
                >
                  {voidDeletingId === invoice.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} strokeWidth={1.3} />}
                  删除
                </RdlPill>
              )}
              {/* voucher 编辑入口 */}
              {!isInvoice && voucher && (
                <RdlPill
                  type="button"
                  onClick={() => openEditVoucher(voucher)}
                  className="min-h-8 px-2.5 text-[10.5px]"
                >
                  <Pencil size={10} strokeWidth={1.3} />
                  编辑
                </RdlPill>
              )}
              {/* F2 外汇核销闭环：结汇入口（仅外币收款凭证有结汇语义） */}
              {!isInvoice && voucher && voucher.type === 'Receipt' && voucher.currency !== 'CNY' && (
                <RdlPill
                  type="button"
                  onClick={() => openSettlementModal(voucher)}
                  className="min-h-8 px-2.5 text-[10.5px]"
                >
                  <Landmark size={10} strokeWidth={1.3} />
                  结汇
                </RdlPill>
              )}
              {/* voucher 作废入口（非 cancelled 状态可作废） */}
              {!isInvoice && voucher && voucher.status !== 'cancelled' && (
                <RdlPill
                  type="button"
                  disabled={voidDeletingId === voucher.id}
                  onClick={async () => {
                    if (!window.confirm(`作废凭证 ${voucher.voucherNumber}?\n有核销记录的凭证不可作废。`)) return;
                    setVoidDeletingId(voucher.id);
                    setVoidDeleteError(null);
                    try {
                      const updated = await paymentVoucherService.cancelVoucher(voucher.id);
                      setVouchers(prev => prev.map(v => v.id === voucher.id ? { ...v, ...updated } : v));
                    } catch (e: any) {
                      setVoidDeleteError(`作废失败：${e.message || e}`);
                    } finally {
                      setVoidDeletingId(null);
                    }
                  }}
                  className="min-h-8 px-2.5 text-[10.5px]"
                >
                  {voidDeletingId === voucher.id ? <Loader2 size={10} className="animate-spin" /> : <AlertCircle size={10} strokeWidth={1.3} />}
                  作废
                </RdlPill>
              )}
              {/* task_mqyusoio: voucher 软删入口（消费 paymentVoucherService.deletePaymentVoucher） */}
              {!isInvoice && voucher && (
                <RdlPill
                  type="button"
                  disabled={voidDeletingId === voucher.id}
                  onClick={async () => {
                    if (!window.confirm(`删除凭证 ${voucher.voucherNumber}？\n有核销记录的凭证不可删除。`)) return;
                    setVoidDeletingId(voucher.id);
                    setVoidDeleteError(null);
                    try {
                      await paymentVoucherService.deletePaymentVoucher(voucher.id);
                      setVouchers(prev => prev.filter(v => v.id !== voucher.id));
                      setSelectedId(null);
                    } catch (e: any) {
                      setVoidDeleteError(`删除失败：${e.message || e}`);
                    } finally {
                      setVoidDeletingId(null);
                    }
                  }}
                  className="min-h-8 px-2.5 text-[10.5px]"
                >
                  {voidDeletingId === voucher.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} strokeWidth={1.3} />}
                  删除
                </RdlPill>
              )}
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="space-y-1">
            {fieldRows.map(row => (
              <div key={row.label} className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-2 py-1">
                <div className={cx('text-[10px] font-light tracking-wide', textSecondaryClass)}>{row.label}</div>
                <div className={cx('truncate text-xs font-light', textPrimaryClass)}>{row.value}</div>
              </div>
            ))}
          </div>
          {/* P0 payment manual path: voucher 核销状态说明 + 下一步（消费后端稳定枚举） */}
          {!isInvoice && voucher && (
            <RdlSurface tone="inset" padding="compact" className="mt-3">
              <div className={cx('text-[10px] font-light tracking-wide', textSecondaryClass)}>状态说明</div>
              <div className={cx('mt-1 text-[11px] font-light leading-relaxed', textPrimaryClass)}>
                {VOUCHER_STATUS_GUIDE[voucher.status as VoucherStatus]?.label ?? '未知状态'}：{VOUCHER_STATUS_GUIDE[voucher.status as VoucherStatus]?.nextStep ?? '请检查凭证核销状态。'}
              </div>
            </RdlSurface>
          )}
          <div className={cx('my-4 h-px w-full', isDarkMode ? 'bg-white/[0.055]' : 'bg-slate-200/55')} />
          <RdlSurface tone="inset" padding="regular">
            <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>{summary.label}</div>
            <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimaryClass)}>{summary.value}</div>
          </RdlSurface>
          {/* P1 payment reconcile manual UI: 核销明细 + 手动核销入口 */}
          <div className="mt-4">
            <RdlSurface tone="inset" padding="regular">
              <div className="flex items-center justify-between">
                <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>核销明细（{allocations.length}）</div>
                <RdlPill
                  type="button"
                  onClick={openCreateAlloc}
                  className="min-h-8 px-2.5 text-[10.5px]"
                >
                  <Link2 size={10} strokeWidth={1.3} />
                  添加核销
                </RdlPill>
              </div>
              {allocLoading ? (
                <div className={cx('mt-2 text-[11px] font-light', textSecondaryClass)}>加载中...</div>
              ) : allocations.length === 0 ? (
                <div className={cx('mt-2 text-[11px] font-light', textSecondaryClass)}>暂无核销记录。点击「添加核销」关联{isInvoice ? '收付款凭证' : '发票'}。</div>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {allocations.map(alloc => (
                    <div key={alloc.id} className="rdl-data-row min-h-0 justify-between px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className={cx('truncate text-[11px] font-light', textPrimaryClass)}>
                          {isInvoiceContext ? `凭证: ${alloc.voucherId}` : `发票: ${alloc.invoiceId}`}
                        </div>
                        <div className={cx('mt-0.5 text-[10px] font-light', textSecondaryClass)}>
                          核销 {alloc.appliedAmount} · {alloc.appliedDate}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <RdlOverlayIconButton type="button" onClick={() => { setEditingAllocId(alloc.id); setAllocForm({ targetId: isInvoiceContext ? alloc.voucherId : alloc.invoiceId, appliedAmount: String(alloc.appliedAmount), appliedDate: alloc.appliedDate }); setAllocError(null); setShowAllocModal(true); }}
                          className="h-8 w-8">
                          <Pencil size={11} strokeWidth={1.3} />
                        </RdlOverlayIconButton>
                        <RdlOverlayIconButton type="button" onClick={() => handleDeleteAlloc(alloc.id)}
                          className="h-8 w-8">
                          <Trash2 size={11} strokeWidth={1.3} />
                        </RdlOverlayIconButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* status 重算反馈提示 */}
              <div className={cx('mt-2 text-[10px] font-light', textSecondaryClass)}>
                当前状态：{statusLabel}（核销操作后由后端重算并自动更新）
              </div>
            </RdlSurface>
          </div>
          <div className="mt-4">
            <RelatedEntitiesPanel
              type={isInvoice ? 'invoice' : 'payment-voucher'}
              id={selectedItem.id}
              isDarkMode={isDarkMode}
              title={isInvoice ? '发票关联视图' : '凭证关联视图'}
            />
          </div>
        </div>
      </>
    );
  };

  // ── Active tab toolbar chips ───
  const activeTypeOptions = activeTab === 'invoices' ? INVOICE_TYPES : VOUCHER_TYPES;
  const activeStatusOptions = activeTab === 'invoices' ? INVOICE_STATUSES : VOUCHER_STATUSES;

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <PageHeader
        title="财务管理"
        subtitle="Invoices / Vouchers / Reconciliation"
        contextLabel={activeTab === 'invoices' ? 'Invoice Desk' : activeTab === 'reports' ? 'Finance Reports' : 'Voucher Desk'}
        isDarkMode={isDarkMode}
      />

      {/* ── Main content: KPI → segment switcher → toolbar → table+panel ── */}
      <main className="min-h-0 flex-1 px-5 pb-5">
        <div className="flex h-full min-h-0 flex-col gap-2.5">

          {/* KPI row */}
          <div className="grid min-h-0 grid-cols-2 gap-3 xl:grid-cols-4">
            {kpiCards.map(card => <KpiCard key={card.label} card={card} isDarkMode={isDarkMode} />)}
          </div>

          {/* Segment switcher */}
          <div className="flex min-h-0 items-center gap-2">
            <RdlToolbar density="compact">
              {FINANCE_TABS.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <RdlPill
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    active={isActive}
                    className="min-h-8 px-4 text-[11px]"
                  >
                    {tab.label}
                  </RdlPill>
                );
              })}
            </RdlToolbar>
            <div className={cx('ml-auto text-[11px] font-light', textSecondaryClass)}>
              {activeTab === 'reports'
                ? '账龄 / 对账单 / 汇率损益 / 外汇台账'
                : `共 ${activeList.length} ${activeTab === 'invoices' ? '张发票' : '张凭证'}`}
            </div>
          </div>

          {/* 报表 tab：自包含面板（账龄 / 对账单 / 汇率损益 / 外汇台账） */}
          {activeTab === 'reports' && (
            <FinanceReportsPanel isDarkMode={isDarkMode} />
          )}

          {activeTab !== 'reports' && (
          <>
          {/* Shared toolbar (chips adapt per tab) */}
          <RdlToolbar className="h-auto min-h-11 flex-wrap gap-x-2 gap-y-2">
              <RdlSearch
                density="compact"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={activeSearchPlaceholder}
                className="min-w-[220px] flex-[1_1_260px]"
              />
              <div className={cx('hidden h-4 w-px shrink-0 xl:block', isDarkMode ? 'bg-white/8' : 'bg-slate-300/32')} />
              <div className="flex min-w-0 flex-[1_1_auto] items-center gap-1 overflow-x-auto">
                {activeTypeOptions.map(item => (
                  <ToolbarFilterButton
                    key={item.id}
                    active={selectedType === item.id}
                    onClick={() => setSelectedType(item.id)}
                  >
                    {item.label}
                  </ToolbarFilterButton>
                ))}
              </div>
              <div className="flex min-w-0 flex-[1_1_auto] items-center gap-1 overflow-x-auto">
                {activeStatusOptions.map(item => (
                  <ToolbarFilterButton
                    key={item.id}
                    active={selectedStatus === item.id}
                    onClick={() => setSelectedStatus(item.id)}
                  >
                    {item.label}
                  </ToolbarFilterButton>
                ))}
              </div>
              {/* P0 payment manual path: 无 Agent 手动创建凭证入口 */}
              {activeTab === 'vouchers' && (
                <RdlPill
                  type="button"
                  active
                  tone="accent"
                  className="min-h-8 shrink-0 px-3 text-[11px]"
                  onClick={() => { setEditingVoucher(null); setVoucherForm({ voucherNumber: '', type: 'Receipt', amount: '', currency: 'USD', paymentDate: '', paymentMethod: 'TT', customerName: '' }); setVoucherError(null); setShowCreateVoucher(true); }}
                >
                  <Plus size={12} strokeWidth={1.4} />
                  新建凭证
                </RdlPill>
              )}
              {/* P0 invoice manual UI: 无 Agent 手动创建发票入口 */}
              {activeTab === 'invoices' && (
                <RdlPill
                  type="button"
                  onClick={openCreateInvoice}
                  active
                  tone="accent"
                  className="min-h-8 shrink-0 px-3 text-[11px]"
                >
                  <Plus size={12} strokeWidth={1.4} />
                  新建发票
                </RdlPill>
              )}
          </RdlToolbar>

          {/* Table + side panel */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]" data-finance-layout="rdl-flush-table-canvas">
            <RdlSurface tone="panel" padding="compact" className="flex h-full min-h-0 flex-col">
                <div className={cx(TABLE_GRID_CLASS, 'px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>
                  {columnHeaders.map(column => (
                    <div key={column.key} className="min-w-0">{column.label}</div>
                  ))}
                </div>
              <div ref={tableScrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
                {activeList.length > 0
                  ? (activeTab === 'invoices'
                      ? (activeList as InvoiceEntity[]).map((item) => renderInvoiceRow(item))
                      : (activeList as VoucherEntity[]).map((item) => renderVoucherRow(item)))
                  : renderEmptyState()}
              </div>
            </RdlSurface>

            <RdlSurface tone="panel" className="flex h-full min-h-0 flex-col overflow-hidden p-0">
              {renderSidePanel()}
            </RdlSurface>
          </div>
          </>
          )}
        </div>
      </main>

      {/* P0 payment manual path: 创建凭证 modal */}
      {showCreateVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm" onClick={() => !voucherCreating && setShowCreateVoucher(false)}>
          <RdlSurface tone="floating" padding="regular" className="w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className={cx('mb-4 text-[13px] font-light tracking-[0.02em]', textPrimaryClass)}>{editingVoucher ? '编辑收付款凭证' : '新建收付款凭证'}</h2>
            <div className="space-y-3">
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>凭证号 *</label>
                <input value={voucherForm.voucherNumber} onChange={e => setVoucherForm(f => ({ ...f, voucherNumber: e.target.value }))}
                  placeholder="PAY-20260628-001"
                  className={formInputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>类型</label>
                  <select value={voucherForm.type} onChange={e => setVoucherForm(f => ({ ...f, type: e.target.value as 'Receipt' | 'Disbursement' }))}
                    className={formSelectClass}>
                    <option value="Receipt">收款</option>
                    <option value="Disbursement">付款</option>
                  </select>
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>金额 *</label>
                  <input type="number" value={voucherForm.amount} onChange={e => setVoucherForm(f => ({ ...f, amount: e.target.value }))}
                    className={formInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>币种</label>
                  <input value={voucherForm.currency} onChange={e => setVoucherForm(f => ({ ...f, currency: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>付款方式</label>
                  <select value={voucherForm.paymentMethod} onChange={e => setVoucherForm(f => ({ ...f, paymentMethod: e.target.value }))}
                    className={formSelectClass}>
                    <option value="TT">TT</option><option value="LC">LC</option><option value="Cash">Cash</option><option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>交易对象</label>
                <input value={voucherForm.customerName} onChange={e => setVoucherForm(f => ({ ...f, customerName: e.target.value }))}
                  className={formInputClass} />
              </div>
              {voucherError && <div className={cx('rounded-field px-3 py-2 text-[11px] font-light', financeAlertTone(isDarkMode))}>{voucherError}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <RdlPill type="button" disabled={voucherCreating} onClick={() => setShowCreateVoucher(false)}
                className="min-h-8 px-4 text-xs">取消</RdlPill>
              <RdlPill type="button" disabled={voucherCreating} onClick={editingVoucher ? handleSaveVoucher : handleCreateVoucher}
                active tone="accent" className="min-h-8 px-4 text-xs disabled:opacity-50">
                {voucherCreating ? '保存中...' : editingVoucher ? '保存' : '创建'}
              </RdlPill>
            </div>
          </RdlSurface>
        </div>
      )}

      {/* P0 invoice manual UI: 创建/编辑发票 modal */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm" onClick={() => !invoiceSaving && setShowInvoiceModal(false)}>
          <RdlSurface tone="floating" padding="regular" className="w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className={cx('mb-4 text-[13px] font-light tracking-[0.02em]', textPrimaryClass)}>{editingInvoice ? '编辑发票' : '新建发票'}</h2>
            <div className="space-y-3">
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>发票号 *</label>
                <input value={invoiceForm.invoiceNumber} onChange={e => setInvoiceForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                  placeholder="INV-20260629-001"
                  className={formInputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>类型</label>
                  <select value={invoiceForm.type} onChange={e => setInvoiceForm(f => ({ ...f, type: e.target.value as 'Receivable' | 'Payable' }))}
                    className={formSelectClass}>
                    <option value="Receivable">应收</option>
                    <option value="Payable">应付</option>
                  </select>
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>金额 *</label>
                  <input type="number" value={invoiceForm.amount} onChange={e => setInvoiceForm(f => ({ ...f, amount: e.target.value }))}
                    className={formInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>币种</label>
                  <input value={invoiceForm.currency} onChange={e => setInvoiceForm(f => ({ ...f, currency: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>客户</label>
                  <input value={invoiceForm.customerName} onChange={e => setInvoiceForm(f => ({ ...f, customerName: e.target.value }))}
                    className={formInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>发票日期</label>
                  <input type="date" value={invoiceForm.issueDate} onChange={e => setInvoiceForm(f => ({ ...f, issueDate: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>到期日</label>
                  <input type="date" value={invoiceForm.dueDate} onChange={e => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))}
                    className={formInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>汇率（→本位币）</label>
                  <input type="number" step="0.0001" value={invoiceForm.exchangeRate} onChange={e => setInvoiceForm(f => ({ ...f, exchangeRate: e.target.value }))}
                    placeholder="如 7.25"
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>关联订单 ID</label>
                  <input value={invoiceForm.orderId} onChange={e => setInvoiceForm(f => ({ ...f, orderId: e.target.value }))}
                    placeholder="可选"
                    className={formInputClass} />
                </div>
              </div>
              {invoiceError && <div className={cx('rounded-field px-3 py-2 text-[11px] font-light', financeAlertTone(isDarkMode))}>{invoiceError}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <RdlPill type="button" disabled={invoiceSaving} onClick={() => setShowInvoiceModal(false)}
                className="min-h-8 px-4 text-xs">取消</RdlPill>
              <RdlPill type="button" disabled={invoiceSaving} onClick={handleSaveInvoice}
                active tone="accent" className="min-h-8 px-4 text-xs disabled:opacity-50">
                {invoiceSaving ? '保存中...' : '保存'}
              </RdlPill>
            </div>
          </RdlSurface>
        </div>
      )}

      {/* P1 payment reconcile manual UI: 核销 modal */}
      {showAllocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm" onClick={() => !allocSaving && setShowAllocModal(false)}>
          <RdlSurface tone="floating" padding="regular" className="w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className={cx('mb-4 text-[13px] font-light tracking-[0.02em]', textPrimaryClass)}>{editingAllocId ? '编辑核销' : '添加核销'}</h2>
            <div className="space-y-3">
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>
                  关联{isInvoiceContext ? '收付款凭证' : '发票'} {!editingAllocId && '*'}
                </label>
                {editingAllocId ? (
                  <div className={formStaticClass}>
                    {allocForm.targetId}（编辑模式不可更改关联对象）
                  </div>
                ) : (
                  <select value={allocForm.targetId} onChange={e => setAllocForm(f => ({ ...f, targetId: e.target.value }))}
                    className={formSelectClass}>
                    <option value="">请选择{isInvoiceContext ? '凭证' : '发票'}</option>
                    {(isInvoiceContext ? vouchers : invoices).map((item: any) => (
                      <option key={item.id} value={item.id}>{isInvoiceContext ? `${item.voucherNumber} · ${formatAmount(item.amount, item.currency)}` : `${item.invoiceNumber} · ${formatAmount(item.amount, item.currency)}`}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>核销金额 *</label>
                  <input type="number" value={allocForm.appliedAmount} onChange={e => setAllocForm(f => ({ ...f, appliedAmount: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>核销日期</label>
                  <input type="date" value={allocForm.appliedDate} onChange={e => setAllocForm(f => ({ ...f, appliedDate: e.target.value }))}
                    className={formInputClass} />
                </div>
              </div>
              {allocError && <div className={cx('rounded-field px-3 py-2 text-[11px] font-light', financeAlertTone(isDarkMode))}>{allocError}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <RdlPill type="button" disabled={allocSaving} onClick={() => setShowAllocModal(false)}
                className="min-h-8 px-4 text-xs">取消</RdlPill>
              <RdlPill type="button" disabled={allocSaving} onClick={handleSaveAlloc}
                active tone="accent" className="min-h-8 px-4 text-xs disabled:opacity-50">
                {allocSaving ? '核销中...' : '确认核销'}
              </RdlPill>
            </div>
          </RdlSurface>
        </div>
      )}

      {/* F2 外汇核销闭环：结汇 modal（核销摘要 + 结汇记录 + 登记表单） */}
      {settlementVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm" onClick={() => !settlementSaving && setSettlementVoucher(null)}>
          <RdlSurface tone="floating" padding="regular" className="flex max-h-[85vh] w-full max-w-lg flex-col" onClick={e => e.stopPropagation()}>
            <h2 className={cx('mb-3 text-[13px] font-light tracking-[0.02em]', textPrimaryClass)}>
              结汇核销 · {settlementVoucher.voucherNumber}
              <span className={cx('ml-2 text-[11px]', textSecondaryClass)}>{settlementVoucher.customerName || '—'}</span>
            </h2>

            {/* 核销摘要（服务端真源） */}
            <div className="grid shrink-0 grid-cols-3 gap-2">
              {([
                { label: '凭证金额', value: settlementSummary ? formatAmount(Number(settlementSummary.voucherAmount), settlementSummary.currency) : '—' },
                { label: '已结汇', value: settlementSummary ? formatAmount(Number(settlementSummary.settledAmount), settlementSummary.currency) : '—' },
                { label: '未结汇余额', value: settlementSummary ? formatAmount(Number(settlementSummary.remainingAmount), settlementSummary.currency) : '—', accent: true },
              ]).map(card => (
                <RdlSurface key={card.label} tone="inset" padding="compact">
                  <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>{card.label}</div>
                  {/* 中性材质对比表达强调（Finance 页面禁用语义色族）：未结清用主色，结清降为次级 */}
                  <div className={cx('mt-1 text-sm font-light tabular-nums', card.accent && settlementSummary?.fullySettled ? textSecondaryClass : textPrimaryClass)}>
                    {settlementLoading ? '加载中…' : card.value}
                  </div>
                </RdlSurface>
              ))}
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
              {/* 结汇记录 */}
              <div>
                <div className={cx('mb-1.5 text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>
                  结汇记录{settlementSummary ? `（${settlementSummary.settlements.length} 笔）` : ''}
                </div>
                {settlementSummary && settlementSummary.settlements.length === 0 && (
                  <div className={cx('py-3 text-center text-[11px] font-light', textSecondaryClass)}>暂无结汇记录</div>
                )}
                <div className="space-y-1">
                  {settlementSummary?.settlements.map(s => (
                    <div key={s.id} className={cx('flex items-center gap-2 rounded-control px-3 py-2', isDarkMode ? 'bg-white/[0.035]' : 'bg-white/40')}>
                      <div className="min-w-0 flex-1">
                        <div className={cx('truncate text-[11px] font-light', textPrimaryClass)}>
                          {s.settleDate}
                          <span className={cx('ml-2 text-[10px]', textSecondaryClass)}>{s.settlementNumber}</span>
                        </div>
                        <div className={cx('mt-0.5 truncate text-[10px] font-light tabular-nums', textSecondaryClass)}>
                          {formatAmount(Number(s.foreignAmount), s.currency)} × {Number(s.fxRate)} = {formatAmount(Number(s.cnyAmount), 'CNY')}
                          {s.bank ? ` · ${s.bank}` : ''}{s.slipNumber ? ` · 水单 ${s.slipNumber}` : ''}
                        </div>
                      </div>
                      <RdlOverlayIconButton
                        type="button"
                        disabled={settlementDeletingId === s.id}
                        onClick={() => handleDeleteSettlement(s.id, s.settlementNumber)}
                        title="删除结汇水单（回滚未结汇余额）"
                      >
                        {settlementDeletingId === s.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} strokeWidth={1.3} />}
                      </RdlOverlayIconButton>
                    </div>
                  ))}
                </div>
              </div>

              {/* 登记结汇表单 */}
              {(!settlementSummary || !settlementSummary.fullySettled) && (
                <div className={cx('rounded-field border p-3', isDarkMode ? 'border-white/8' : 'border-slate-300/30')}>
                  <div className={cx('mb-2 text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>登记结汇</div>
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>结汇日期 *</label>
                        <input type="date" value={settlementForm.settleDate} onChange={e => setSettlementForm(f => ({ ...f, settleDate: e.target.value }))}
                          className={formInputClass} />
                      </div>
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>结汇外币金额（{settlementVoucher.currency}）*</label>
                        <input type="number" step="0.0001" value={settlementForm.foreignAmount} onChange={e => setSettlementForm(f => ({ ...f, foreignAmount: e.target.value }))}
                          placeholder={settlementSummary ? `未结汇 ${settlementSummary.remainingAmount}` : ''}
                          className={formInputClass} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>结汇汇率（{settlementVoucher.currency} → CNY）*</label>
                        <input type="number" step="0.00000001" value={settlementForm.fxRate} onChange={e => setSettlementForm(f => ({ ...f, fxRate: e.target.value }))}
                          placeholder="7.12345678"
                          className={formInputClass} />
                      </div>
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>结汇银行</label>
                        <input value={settlementForm.bank} onChange={e => setSettlementForm(f => ({ ...f, bank: e.target.value }))}
                          placeholder="中国银行"
                          className={formInputClass} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>银行水单号</label>
                        <input value={settlementForm.slipNumber} onChange={e => setSettlementForm(f => ({ ...f, slipNumber: e.target.value }))}
                          className={formInputClass} />
                      </div>
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>备注</label>
                        <input value={settlementForm.notes} onChange={e => setSettlementForm(f => ({ ...f, notes: e.target.value }))}
                          className={formInputClass} />
                      </div>
                    </div>
                    {/* 折人民币预览（本地估算，真源以服务端计算为准） */}
                    {Number(settlementForm.foreignAmount) > 0 && Number(settlementForm.fxRate) > 0 && (
                      <div className={cx('text-[11px] font-light tabular-nums', textSecondaryClass)}>
                        折人民币约 {formatAmount(Number(settlementForm.foreignAmount) * Number(settlementForm.fxRate), 'CNY')}（以服务端计算为准）
                      </div>
                    )}
                  </div>
                </div>
              )}

              {settlementError && <div className={cx('rounded-field px-3 py-2 text-[11px] font-light', financeAlertTone(isDarkMode))}>{settlementError}</div>}
            </div>

            <div className="mt-3 flex shrink-0 justify-end gap-2">
              <RdlPill type="button" disabled={settlementSaving} onClick={() => setSettlementVoucher(null)}
                className="min-h-8 px-4 text-xs">关闭</RdlPill>
              {(!settlementSummary || !settlementSummary.fullySettled) && (
                <RdlPill type="button" disabled={settlementSaving || settlementLoading} onClick={handleCreateSettlement}
                  active tone="accent" className="min-h-8 px-4 text-xs disabled:opacity-50">
                  {settlementSaving ? '登记中…' : '登记结汇'}
                </RdlPill>
              )}
            </div>
          </RdlSurface>
        </div>
      )}
    </div>
  );
};

export default FinanceManager;
