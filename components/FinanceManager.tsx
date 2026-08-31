import React, { useEffect, useMemo, useRef, useState } from 'react';
import { paymentVoucherService, VOUCHER_CATEGORIES, VOUCHER_CATEGORY_LABELS, voucherCategoryLabel, type PaymentVoucherWithCategory, type VoucherCategory } from '../services/paymentVoucherService';
import { paymentRequestService, type PaymentRequest } from '../services/paymentRequestService';
import { invoiceService } from '../services/invoiceService';
import { allocationService } from '../services/allocationService';
import { fxSettlementService } from '../services/fxSettlementService';
import { outwardRemittanceService } from '../services/outwardRemittanceService';
import { vatInvoiceService } from '../services/vatInvoiceService';
import { apiService } from '../services/apiService';
import { financeV2Service } from '../services/financeV2Service';
import { BadgeCheck, Ban, CalendarClock, ClipboardList, CreditCard, FileText, GitCompareArrows, Landmark, Link2, Pencil, Plus, Receipt, RotateCcw, Search, Send, ShieldCheck, Trash2, Loader2, AlertCircle, BarChart3, Upload, Download, Paperclip, Eye } from 'lucide-react';
import { FinanceReportsPanel } from './finance/FinanceReportsPanel';
import { CashCalendarPanel } from './finance/CashCalendarPanel';
import { FinancePaymentRequestsPanel } from './finance/FinancePaymentRequestsPanel';
import { FinanceCreditPanel } from './finance/FinanceCreditPanel';
import { ReconciliationPanel } from './finance/ReconciliationPanel';
import DunningStageBoardPanel from './finance/DunningStageBoardPanel';
import DunningSheet from './finance/DunningSheet';
import MonthlyCloseSection from './finance/MonthlyCloseSection';
import { View } from '../types';
import type {
  Invoice as InvoiceEntity,
  InvoiceStatus,
  InvoiceAllocation as AllocationEntity,
  InvoiceType,
  PaymentVoucher as VoucherEntity,
  VoucherStatus,
  VoucherType,
  VoucherSettlementSummary,
  VoucherRemittanceSummary,
  VatInvoice as VatInvoiceEntity,
  VatInvoiceStatus,
  VatInvoiceDirection,
  VatInvoiceType,
  TaxRefund as TaxRefundEntity,
  Relation,
  InvoiceOrderAllocation,
  InvoiceAttachment,
  Order as OrderEntity,
  TradeDocument,
  TradeDocumentStatus,
  DunningStage,
} from '../types';
import { RelatedWorkspacesSection } from './ui/RelatedWorkspacesSection';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import A4DocumentPreviewModal from './ui/A4DocumentPreviewModal';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';
import { consumeCrossModuleNav, primeCrossModuleNav } from '../services/crossModuleNav';
import { developmentService } from '../services/developmentService';
import { hasPermission } from '../services/authService';
import { NavRelationFilterChip } from './ui/NavRelationFilterChip';
import RelationPickerCombobox from './finance/RelationPickerCombobox';
import CustomSelect from './ui/CustomSelect';

// ── Typedefs & constants ──────────────────────────────────────────────────
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ── 跨模块 prime：采购单 → 生成应付发票（与 ProcurementCreatePrime 同模式，sessionStorage 传递） ──
const FINANCE_INVOICE_PRIME_KEY = 'bambook_finance_invoice_prime';

export interface FinanceInvoicePrime {
  supplierRelationId?: string;
  supplierName?: string;
  currency?: string;
  amount?: number;
  notes?: string;
  /** 定位模式（单据中心 CI 回链跳转用）：只选中该发票，不打开新建弹窗 */
  focusInvoiceId?: string;
}

export const primeFinanceInvoiceCreate = (prime: FinanceInvoicePrime) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(FINANCE_INVOICE_PRIME_KEY, JSON.stringify(prime));
  } catch {
    // Cross-module continuity only; ignore storage failures.
  }
};

/** 单据中心「财务发票」回链直达（App.tsx 调用）：跳财务发票 tab 并选中目标发票 */
export const primeFinanceInvoiceFocus = (invoiceId: string) => {
  primeFinanceInvoiceCreate({ focusInvoiceId: invoiceId });
};

const readFinanceInvoicePrime = (): FinanceInvoicePrime | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(FINANCE_INVOICE_PRIME_KEY);
    return raw ? (JSON.parse(raw) as FinanceInvoicePrime) : null;
  } catch {
    return null;
  }
};

const clearFinanceInvoicePrime = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(FINANCE_INVOICE_PRIME_KEY);
  } catch {
    // ignore
  }
};

type FinanceTabId = 'invoices' | 'vouchers' | 'paymentRequests' | 'credit' | 'vatInvoices' | 'cashCalendar' | 'reports' | 'reconciliation' | 'collections';

/** A5d 报表下钻联动：允许外部（报表中心）按 id 指定落点 tab */
export type { FinanceTabId };

type InvoiceTypeId = 'all' | InvoiceType;
type InvoiceStatusId = 'all' | InvoiceStatus;
type VoucherTypeId = 'all' | VoucherType;
type VoucherStatusId = 'all' | VoucherStatus;

const INVOICE_TYPES: Array<{ id: InvoiceTypeId; label: string }> = [
  { id: 'all', label: '全部类型' },
  { id: 'Receivable', label: '应收' },
  { id: 'Payable', label: '应付' },
  { id: 'Proforma' as any, label: '形式发票' },
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

const invoiceTypeLabel = (t: InvoiceType | string) => (t === 'Receivable' ? '应收' : t === 'Payable' ? '应付' : t === 'Proforma' ? '形式发票' : String(t));
const voucherTypeLabel = (t: VoucherType) => (t === 'Receipt' ? '收款' : '付款');

// ── C6 增值税发票常量 ───
type VatDirectionId = 'all' | VatInvoiceDirection;
type VatStatusId = 'all' | VatInvoiceStatus;

const VAT_DIRECTIONS: Array<{ id: VatDirectionId; label: string }> = [
  { id: 'all', label: '全部方向' },
  { id: 'Input', label: '进项' },
  { id: 'Output', label: '销项' },
];
const VAT_STATUSES: Array<{ id: VatStatusId; label: string }> = [
  { id: 'all', label: '全部状态' },
  { id: 'Received', label: '已收票' },
  { id: 'Verified', label: '已认证' },
  { id: 'Declared', label: '已申报退税' },
  { id: 'RedFlushed', label: '已红冲' },
  { id: 'Cancelled', label: '已作废' },
];
const VAT_STATUS_LABELS: Record<VatInvoiceStatus, string> = {
  Received: '已收票',
  Verified: '已认证',
  Declared: '已申报退税',
  RedFlushed: '已红冲',
  Cancelled: '已作废',
};
const vatDirectionLabel = (d: VatInvoiceDirection) => (d === 'Input' ? '进项' : '销项');
const vatTypeLabel = (t: VatInvoiceType) => (t === 'Special' ? '专票' : '普票');

/** 增值税发票状态说明 + 下一步指引（消费后端稳定状态机，不猜字符串） */
const VAT_STATUS_GUIDE: Record<VatInvoiceStatus, string> = {
  Received: '发票已登记收票。下一步：勾选认证（认证后才可抵扣/申报退税），或作废处理。',
  Verified: '发票已认证。进项专票下一步：挂退税申报单后申报退税；如发票有误可红冲。',
  Declared: '发票已申报出口退税。申报后不可编辑/删除；如需调整，请先红冲。',
  RedFlushed: '发票已红冲（红字冲销），不再参与抵扣与退税。状态终态。',
  Cancelled: '发票已作废，不再参与抵扣与退税。状态终态。',
};

/** C6 增值税发票流转动作文案（消费后端状态机，不猜字符串） */
const VAT_TRANSITION_LABELS: Record<'Verified' | 'Declared' | 'RedFlushed', string> = {
  Verified: '勾选认证',
  Declared: '申报退税',
  RedFlushed: '红冲',
};

/** C6 退税申报单状态文案（消费 /v1/customs/tax-refunds contract） */
const TAX_REFUND_STATUS_LABELS: Record<string, string> = {
  Draft: '草稿',
  Submitted: '已申报',
  Reviewing: '审核中',
  Approved: '已批准',
  Rejected: '已拒绝',
  Refunded: '已退税',
  Cancelled: '已取消',
};

/** 可挂接进项专票的退税申报单状态（Approved/Refunded/Cancelled 不再接受新票） */
const VAT_DECLARABLE_REFUND_STATUSES = ['Draft', 'Submitted', 'Reviewing', 'Rejected'];

/** C6 付汇用途选项（镜像后端 REMITTANCE_PURPOSES 契约枚举） */
const REMITTANCE_PURPOSE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'GoodsPayment', label: '货款' },
  { id: 'Freight', label: '运费' },
  { id: 'Insurance', label: '保险费' },
  { id: 'Commission', label: '佣金' },
  { id: 'Other', label: '其他' },
];
const remittancePurposeLabel = (p?: string | null) =>
  REMITTANCE_PURPOSE_OPTIONS.find(o => o.id === p)?.label || p || '—';

const FINANCE_TABS: Array<{ id: FinanceTabId; label: string; icon: typeof FileText }> = [
  { id: 'invoices', label: '发票', icon: FileText },
  { id: 'vouchers', label: '收付款', icon: CreditCard },
  { id: 'paymentRequests', label: '付款申请', icon: ClipboardList },
  { id: 'credit', label: '客户信用', icon: ShieldCheck },
  { id: 'vatInvoices', label: '增值税', icon: Receipt },
  { id: 'cashCalendar', label: '资金日历', icon: CalendarClock },
  { id: 'reports', label: '报表', icon: BarChart3 },
  { id: 'reconciliation', label: '对账', icon: GitCompareArrows },
  { id: 'collections', label: '催款月结', icon: Send },
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
  /** 跨模块导航：单据详情「关联业务」入口页面切换 */
  onNavigate?: (view: import('../types').View) => void;
  /** 交单回链直达：发票详情「查看交单」→ 单据中心定位目标单据（App.tsx 实现 prime 写入 + 视图切换） */
  onOpenTradeDocument?: (docId: string) => void;
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

/** BDS v2.1：状态徽章变体 —— Finance 页面禁用语义色族，统一 neutral；终态（作废/红冲）降透明度表达 inactive */
const FINANCE_STATUS_BADGE = 'bds-badge sm neutral';
const FINANCE_STATUS_BADGE_INACTIVE = 'bds-badge sm neutral opacity-60';

const invoiceStatusBadge = (status: InvoiceStatus) =>
  status === 'Cancelled' ? FINANCE_STATUS_BADGE_INACTIVE : FINANCE_STATUS_BADGE;

const voucherStatusBadge = (_status: VoucherStatus) => FINANCE_STATUS_BADGE;

/** C6 增值税发票状态徽章：终态（红冲/作废）降为 inactive，其余中性 */
const vatStatusBadge = (status: VatInvoiceStatus) =>
  status === 'RedFlushed' || status === 'Cancelled' ? FINANCE_STATUS_BADGE_INACTIVE : FINANCE_STATUS_BADGE;

/** 核销状态说明 + 下一步指引（消费后端稳定枚举，不猜字符串） */
const VOUCHER_STATUS_GUIDE: Record<VoucherStatus, { label: string; nextStep: string }> = {
  unreconciled: { label: '未核销', nextStep: '该凭证尚未核销任何发票。可在发票模块关联核销，或等待 Agent 自动匹配。' },
  partially_reconciled: { label: '部分核销', nextStep: '该凭证已部分核销发票。余款仍挂账，可继续关联其他发票完成核销。' },
  reconciled: { label: '已核销', nextStep: '该凭证已完全核销，资金流闭环。如需调整，请冲销后重新核销。' },
  cancelled: { label: '已作废', nextStep: '该凭证已作废，不再参与核销。' },
};

/** P3-003：状态列中文映射（与快捷统计「已结清/已开票/部分销账」同口径） */
const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  Draft: '草稿',
  Issued: '已开票',
  PartiallyPaid: '部分销账',
  Paid: '已结清',
  Cancelled: '已作废',
};

/** 交单状态中文映射（镜像单据中心 DOC_STATUSES，发票详情「交单状态」区块用） */
const TRADE_DOC_STATUS_LABEL: Record<TradeDocumentStatus, string> = {
  Draft: '草稿',
  Issued: '已签发',
  Submitted: '已提交',
  Accepted: '已接受',
  Rejected: '已拒绝',
  Cancelled: '已取消',
};

const voucherStatusLabel = (status: string | undefined): string =>
  VOUCHER_STATUS_GUIDE[(status || 'unreconciled') as VoucherStatus]?.label ?? (status || 'unreconciled');

type KpiCard = {
  label: string;
  primary: string;
  secondary: string;
  /** I2 折人民币合计行（多币种/外币时显示；纯人民币或空聚合不显示） */
  tertiary?: string;
};

const KpiCard: React.FC<{ card: KpiCard }> = ({ card }) => (
  <div className="bds-card flex flex-col justify-between">
    <div className="text-[10px] font-light tracking-[0.18em]" style={{ color: 'var(--text-tertiary)' }}>{card.label}</div>
    <div className="bds-tnum mt-2 text-lg font-light" style={{ color: 'var(--text-primary)' }}>{card.primary}</div>
    <div className="mt-1 text-[11px] font-light" style={{ color: 'var(--text-tertiary)' }}>{card.secondary}</div>
    {card.tertiary && (
      <div className="bds-tnum mt-1 text-[11px] font-light" style={{ color: 'var(--text-tertiary)' }}>{card.tertiary}</div>
    )}
  </div>
);

// ── Aggregation helpers ───────────────────────────────────────────────────
export type CurrencyAggItem = { currency: string; total: number; count: number };

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

/**
 * DR-044 净额口径：未结清/未核销余额 = 单据金额 − 已核销（InvoiceAllocation 真源派生）。
 * openAmount 为列表接口附带的派生字段；旧数据缺失时兜底：发票退全额、凭证退 amount − appliedAmount。
 */
const netOpenAmount = (item: { amount: number; openAmount?: number; appliedAmount?: number }): number => {
  if (typeof item.openAmount === 'number' && Number.isFinite(item.openAmount)) return item.openAmount;
  if (typeof item.appliedAmount === 'number' && Number.isFinite(item.appliedAmount)) {
    return Math.max(0, item.amount - item.appliedAmount);
  }
  return item.amount;
};

/**
 * I2 折人民币合计（首屏 KPI 卡多币种合并折算）。
 * 汇率真源：风控域最新汇率档案 GET /v1/risk/fx-rates-latest（apiService.getLatestFxRates），
 * rate 语义 = 1 单位外币兑 CNY；CNY 恒按 1 计。缺汇率的币种不强行折算，列入 missing 透明披露。
 */
export type CnyAggregateResult = { total: number; missing: string[]; hasForeign: boolean };

export const aggregateToCny = (agg: CurrencyAggItem[], rates: Record<string, number>): CnyAggregateResult => {
  let total = 0;
  let hasForeign = false;
  const missing: string[] = [];
  for (const item of agg) {
    const currency = item.currency || '—';
    if (currency === 'CNY') {
      total += item.total;
      continue;
    }
    hasForeign = true;
    const rate = rates[currency];
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      total += item.total * rate;
    } else if (!missing.includes(currency)) {
      missing.push(currency);
    }
  }
  return { total, missing, hasForeign };
};

// ── Component ─────────────────────────────────────────────────────────────

const FinanceManager: React.FC<FinanceManagerProps> = ({
  isDarkMode,
  initialTab = 'vouchers',
  invoices,
  setInvoices,
  vouchers,
  setVouchers,
  onNavigate,
  onOpenTradeDocument,
}) => {
  // ── View switching ───
  const [activeTab, setActiveTab] = useState<FinanceTabId>(initialTab);
  // R6 权限显隐（W-C 矩阵真源 scope；服务端 requirePermission fail-closed 兜底）：
  // 发票写 = invoices:write；凭证写（含结汇/付汇/核销）= vouchers:write；增值税票写 = vat:write
  const canWriteInvoices = hasPermission('invoices:write');
  const canWriteVouchers = hasPermission('vouchers:write');
  const canWriteVat = hasPermission('vat:write');
  // Keep local state for activeTab in sync with parent's initialTab prop (handles deep-link navigation).
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // ── I3 催款月结一级入口：催款函/月末结转自报表子视图前置 ───
  const [collectionsView, setCollectionsView] = useState<'dunning' | 'monthlyClose'>('dunning');
  const [dunningRow, setDunningRow] = useState<{ customerRelationId: string | null; customerName: string; currency: string; stage?: DunningStage } | null>(null);
  const [dunningRefreshKey, setDunningRefreshKey] = useState(0);

  // 跨模块导航筛选（关系智库档案「关联业务 → 发票/收付款/增值税发票」入口）：
  // 挂载时消费一次——tab 预填（如 vatInvoices）+ relation 筛选；✕ 清除回全量
  const navContext = useState(() => consumeCrossModuleNav())[0];
  const [navRelationFilter, setNavRelationFilter] = useState(() => navContext?.filter ?? null);
  useEffect(() => {
    if (navContext?.tab && ['invoices', 'vouchers', 'paymentRequests', 'credit', 'vatInvoices', 'cashCalendar', 'reports', 'reconciliation', 'collections'].includes(navContext.tab)) {
      setActiveTab(navContext.tab as FinanceTabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Filter state (one flat set; resets on tab change) ───
  const [searchTerm, setSearchTerm] = useState('');

  // ── 交易对象档案（发票/凭证表单关联 Relation 档案，支撑客户/供应商对账单数据链路）───
  const [relationOptions, setRelationOptions] = useState<Relation[]>([]);
  useEffect(() => {
    let alive = true;
    apiService.listRelations().then(list => { if (alive) setRelationOptions(list); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // 方向分组以 category 为准（type 是自由文本子类，如 Fabric Mill/Trading Agent）；
  // 保留 type 回退兼容旧档案（对齐 ProcurementManager 的双检模式）。
  const relationOptionsFor = (direction: 'Customer' | 'Supplier') =>
    relationOptions.filter(r => !r.deletedAt && (r.category === direction || r.type === direction));
  const relationDisplayName = (r: Relation) => r.chineseName || r.name;

  // ── P0 payment manual path: 创建凭证 modal state ───
  const [showCreateVoucher, setShowCreateVoucher] = useState(false);
  const [voucherForm, setVoucherForm] = useState({ voucherNumber: '', type: 'Receipt' as 'Receipt' | 'Disbursement', voucherCategory: 'normal' as VoucherCategory, amount: '', currency: 'USD', paymentDate: '', paymentMethod: 'TT', customerName: '', customerRelationId: '', paymentRequestId: '' });
  const [voucherCreating, setVoucherCreating] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [editingVoucher, setEditingVoucher] = useState<VoucherEntity | null>(null);

  // ── I1 付款凭证入口引导：已批准未付款的付款申请（DR-017 先申请后付款唯一数据源）───
  // 仅新建付款（Disbursement）凭证时加载；下拉选中即带出金额/币种/供应商/付款性质，
  // 用户不再填完一屏才撞 PAYMENT_REQUEST_REQUIRED 门禁。
  const [payableRequests, setPayableRequests] = useState<PaymentRequest[]>([]);
  const [payableRequestsLoading, setPayableRequestsLoading] = useState(false);
  useEffect(() => {
    if (!showCreateVoucher || editingVoucher || voucherForm.type !== 'Disbursement') return;
    let alive = true;
    setPayableRequestsLoading(true);
    paymentRequestService.listPaymentRequests({ status: 'Approved' })
      .then(({ items: list }) => { if (alive) setPayableRequests(list.filter(r => !r.paymentVoucherId)); })
      .catch(() => { if (alive) setPayableRequests([]); })
      .finally(() => { if (alive) setPayableRequestsLoading(false); });
    return () => { alive = false; };
  }, [showCreateVoucher, editingVoucher, voucherForm.type]);

  // I1：选中付款申请即带出金额/币种/供应商/付款性质（申请单为唯一事实源，避免手输漂移）
  const handleSelectPaymentRequest = (requestId: string) => {
    const pr = payableRequests.find(r => r.id === requestId);
    setVoucherForm(f => ({
      ...f,
      paymentRequestId: requestId,
      ...(pr ? {
        amount: String(pr.totalAmount ?? ''),
        currency: pr.currency || f.currency,
        voucherCategory: (pr.paymentCategory as VoucherCategory) || f.voucherCategory,
        customerRelationId: pr.supplierId || '',
        customerName: pr.supplierName || '',
      } : {}),
    }));
  };

  const openEditVoucher = (voucher: VoucherEntity) => {
    setEditingVoucher(voucher);
    setVoucherForm({
      voucherNumber: voucher.voucherNumber || '',
      type: voucher.type || 'Receipt',
      voucherCategory: (voucher as PaymentVoucherWithCategory).voucherCategory || 'normal',
      amount: String(voucher.amount ?? ''),
      currency: voucher.currency || 'USD',
      paymentDate: voucher.paymentDate || '',
      paymentMethod: voucher.paymentMethod || 'TT',
      customerName: voucher.customerName || '',
      customerRelationId: voucher.customerRelationId || '',
      paymentRequestId: '',
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
        voucherCategory: voucherForm.voucherCategory,
        amount: voucherAmount,
        currency: voucherForm.currency,
        paymentDate: voucherForm.paymentDate || new Date().toISOString().slice(0, 10),
        paymentMethod: voucherForm.paymentMethod,
        customerName: voucherForm.customerName || undefined,
        customerRelationId: voucherForm.customerRelationId || undefined,
      });
      setVouchers(prev => prev.map(v => v.id === editingVoucher.id ? { ...v, ...updated } : v));
      setShowCreateVoucher(false);
      setEditingVoucher(null);
      setVoucherForm({ voucherNumber: '', type: 'Receipt', voucherCategory: 'normal', amount: '', currency: 'USD', paymentDate: '', paymentMethod: 'TT', customerName: '', customerRelationId: '', paymentRequestId: '' });
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
    // I1 入口引导：付款凭证无关联申请时在提交前明确拦截，不再等后端 PAYMENT_REQUEST_REQUIRED 撞墙
    if (voucherForm.type === 'Disbursement' && !voucherForm.paymentRequestId) {
      setVoucherError('付款凭证必须关联审批通过的付款申请（先申请后付款）。请从上方「关联付款申请」下拉选择已批准的申请；如无申请，请先在「付款申请」页签提交并获批后再来开凭证。');
      return;
    }
    setVoucherCreating(true);
    setVoucherError(null);
    try {
      const created = await paymentVoucherService.createPaymentVoucher({
        voucherNumber: voucherForm.voucherNumber,
        type: voucherForm.type,
        voucherCategory: voucherForm.voucherCategory,
        amount: voucherAmount,
        currency: voucherForm.currency,
        paymentDate: voucherForm.paymentDate || new Date().toISOString().slice(0, 10),
        paymentMethod: voucherForm.paymentMethod,
        customerName: voucherForm.customerName || undefined,
        customerRelationId: voucherForm.customerRelationId || undefined,
        paymentRequestId: voucherForm.type === 'Disbursement' ? voucherForm.paymentRequestId || undefined : undefined,
      });
      // 成功：刷新服务端事实源（追加到本地列表，保持一致）
      setVouchers(prev => [created, ...prev]);
      setShowCreateVoucher(false);
      setEditingVoucher(null);
      setVoucherForm({ voucherNumber: '', type: 'Receipt', voucherCategory: 'normal', amount: '', currency: 'USD', paymentDate: '', paymentMethod: 'TT', customerName: '', customerRelationId: '', paymentRequestId: '' });
      bdsToast.success(`凭证 ${created.voucherNumber} 已创建`);
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
        bdsToast.warning('结汇已登记，但摘要刷新失败，请关闭后重开查看最新数据。');
      }
    }
  };

  const handleDeleteSettlement = async (settlementId: string, settlementNumber: string) => {
    if (!settlementVoucher || settlementDeletingId) return;
    if (!(await bdsConfirm({ title: '确认删除', body: `删除结汇水单 ${settlementNumber}？\n删除后该凭证未结汇余额将回滚。`, danger: true }))) return;
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
        bdsToast.warning('已删除，但摘要刷新失败，请关闭后重开查看最新数据。');
      }
    }
  };

  // ── C6 付汇闭环：付汇 modal state（消费 /v1/finance/outward-remittances contract，镜像结汇付款侧）───
  const [remittanceVoucher, setRemittanceVoucher] = useState<VoucherEntity | null>(null);
  const [remittanceSummary, setRemittanceSummary] = useState<VoucherRemittanceSummary | null>(null);
  const [remittanceLoading, setRemittanceLoading] = useState(false);
  const [remittanceSaving, setRemittanceSaving] = useState(false);
  const [remittanceDeletingId, setRemittanceDeletingId] = useState<string | null>(null);
  const [remittanceError, setRemittanceError] = useState<string | null>(null);
  const [remittanceForm, setRemittanceForm] = useState({ remitDate: '', foreignAmount: '', fxRate: '', purpose: 'GoodsPayment', payeeName: '', bank: '', slipNumber: '', notes: '' });

  const loadRemittanceSummary = async (voucherId: string) => {
    setRemittanceLoading(true);
    setRemittanceError(null);
    try {
      setRemittanceSummary(await outwardRemittanceService.getVoucherRemittanceSummary(voucherId));
    } catch (e: any) {
      setRemittanceError(`付汇摘要加载失败：${e?.message ?? e}`);
    } finally {
      setRemittanceLoading(false);
    }
  };

  const openRemittanceModal = (voucher: VoucherEntity) => {
    setRemittanceVoucher(voucher);
    setRemittanceSummary(null);
    setRemittanceError(null);
    setRemittanceForm({ remitDate: new Date().toISOString().slice(0, 10), foreignAmount: '', fxRate: '', purpose: 'GoodsPayment', payeeName: '', bank: '', slipNumber: '', notes: '' });
    loadRemittanceSummary(voucher.id);
  };

  const handleCreateRemittance = async () => {
    if (!remittanceVoucher || remittanceSaving) return;
    const foreignAmount = Number(remittanceForm.foreignAmount);
    const fxRate = Number(remittanceForm.fxRate);
    if (!remittanceForm.remitDate) {
      setRemittanceError('付汇日期为必填项');
      return;
    }
    if (!Number.isFinite(foreignAmount) || foreignAmount <= 0) {
      setRemittanceError('付汇外币金额必须是大于 0 的有效数字');
      return;
    }
    if (!Number.isFinite(fxRate) || fxRate <= 0) {
      setRemittanceError('付汇汇率必须是大于 0 的有效数字');
      return;
    }
    setRemittanceSaving(true);
    setRemittanceError(null);
    let mutationOk = false;
    try {
      await outwardRemittanceService.createOutwardRemittance({
        voucherId: remittanceVoucher.id,
        remitDate: remittanceForm.remitDate,
        foreignAmount,
        fxRate,
        purpose: remittanceForm.purpose || undefined,
        payeeName: remittanceForm.payeeName || undefined,
        bank: remittanceForm.bank || undefined,
        slipNumber: remittanceForm.slipNumber || undefined,
        notes: remittanceForm.notes || undefined,
      });
      mutationOk = true;
      setRemittanceForm({ remitDate: new Date().toISOString().slice(0, 10), foreignAmount: '', fxRate: '', purpose: 'GoodsPayment', payeeName: '', bank: '', slipNumber: '', notes: '' });
    } catch (e: any) {
      // mutation 失败——真实未落库（超付/币种不一致等服务端阻断原因透出）
      setRemittanceError(`付汇登记失败：${e?.message ?? e}`);
    } finally {
      setRemittanceSaving(false);
    }
    // ✅ mutation 成功后以服务端摘要为真源刷新（含 cnyAmount 服务端计算结果）
    if (mutationOk) {
      try {
        await loadRemittanceSummary(remittanceVoucher.id);
      } catch {
        bdsToast.warning('付汇已登记，但摘要刷新失败，请关闭后重开查看最新数据。');
      }
    }
  };

  const handleDeleteRemittance = async (remittanceId: string, remittanceNumber: string) => {
    if (!remittanceVoucher || remittanceDeletingId) return;
    if (!(await bdsConfirm({ title: '确认删除', body: `删除付汇水单 ${remittanceNumber}？\n删除后该凭证未付汇余额将回滚。`, danger: true }))) return;
    setRemittanceDeletingId(remittanceId);
    setRemittanceError(null);
    let mutationOk = false;
    try {
      await outwardRemittanceService.deleteOutwardRemittance(remittanceId);
      mutationOk = true;
    } catch (e: any) {
      setRemittanceError(`删除失败：${e?.message ?? e}`);
    } finally {
      setRemittanceDeletingId(null);
    }
    if (mutationOk) {
      try {
        await loadRemittanceSummary(remittanceVoucher.id);
      } catch {
        bdsToast.warning('已删除，但摘要刷新失败，请关闭后重开查看最新数据。');
      }
    }
  };

  // ── P0 invoice manual UI: 创建/编辑发票 modal state ───
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceEntity | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: '', type: 'Receivable' as 'Receivable' | 'Payable', status: 'Draft' as InvoiceStatus, amount: '', currency: 'USD', customerName: '', customerRelationId: '', issueDate: '', dueDate: '', notes: '', orderId: '', exchangeRate: '', orderIds: [] as string[] });
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  // DR：发票详情（orderAllocations + attachments）——发票 tab 选中时拉取 GET /v1/finance/:id
  const [invoiceDetail, setInvoiceDetail] = useState<(InvoiceEntity & { orderAllocations?: InvoiceOrderAllocation[] }) | null>(null);
  const [invoiceDetailLoading, setInvoiceDetailLoading] = useState(false);
  // 发票表单多订单分配用订单候选列表（apiService.listOrders）
  const [orderOptions, setOrderOptions] = useState<OrderEntity[]>([]);
  // 发票附件上传状态
  const [invoiceUpFile, setInvoiceUpFile] = useState<File | null>(null);
  const [invoiceUploading, setInvoiceUploading] = useState(false);
  const [invoiceAttachmentErr, setInvoiceAttachmentErr] = useState<string | null>(null);
  // 交单回链（发票 → 单据中心 CommercialInvoice 引用，sourceInvoiceId 反查）
  const [invoiceTradeDoc, setInvoiceTradeDoc] = useState<TradeDocument | null>(null);
  // DR-057 v2.1 发票↔开发单双向闭环：引用本发票作为样品发票的开发单（发票详情反查）
  const [linkedDevCases, setLinkedDevCases] = useState<Array<{ id: string; code: string; name: string }>>([]);

  // ── 跨模块 prime 消费：采购单 → 生成应付发票（预填供应商/币种/金额并直接开新建 modal）───
  useEffect(() => {
    const prime = readFinanceInvoicePrime();
    if (!prime) return;
    clearFinanceInvoicePrime();
    setActiveTab('invoices');
    // 定位模式（单据中心 CI 回链）：选中目标发票，不打开新建弹窗
    if (prime.focusInvoiceId) {
      setSelectedId(prime.focusInvoiceId);
      return;
    }
    setEditingInvoice(null);
    setInvoiceForm({
      invoiceNumber: '', type: 'Payable', status: 'Draft',
      amount: prime.amount != null ? String(prime.amount) : '',
      currency: prime.currency || 'USD',
      customerName: prime.supplierName || '',
      customerRelationId: prime.supplierRelationId || '',
      issueDate: '', dueDate: '', notes: prime.notes || '', orderId: '', exchangeRate: '', orderIds: [],
    });
    setInvoiceError(null);
    setShowInvoiceModal(true);
  }, []);

  const openCreateInvoice = () => {
    setEditingInvoice(null);
    setInvoiceForm({ invoiceNumber: '', type: 'Receivable', status: 'Draft', amount: '', currency: 'USD', customerName: '', customerRelationId: '', issueDate: '', dueDate: '', notes: '', orderId: '', exchangeRate: '', orderIds: [] });
    setInvoiceError(null);
    setShowInvoiceModal(true);
    loadOrderOptions();
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
      customerRelationId: inv.customerRelationId || '',
      issueDate: inv.issueDate || '',
      dueDate: inv.dueDate || '',
      notes: inv.notes || '',
      orderId: inv.orderId || '',
      exchangeRate: inv.exchangeRate != null ? String(inv.exchangeRate) : '',
      // DR：多订单分配——优先用详情接口带回的 orderAllocations；列表无该字段时退化到单个 orderId
      orderIds: ((inv as InvoiceEntity & { orderAllocations?: InvoiceOrderAllocation[] }).orderAllocations ?? []).map(a => a.orderId),
    });
    setInvoiceError(null);
    setShowInvoiceModal(true);
    loadOrderOptions();
  };

  // 加载发票表单多订单分配候选订单（best-effort，失败不阻塞表单）
  const loadOrderOptions = () => {
    apiService.listOrders()
      .then(list => { if (Array.isArray(list)) setOrderOptions(list); })
      .catch(() => setOrderOptions([]));
  };

  // task_mqyusoio: 作废/软删 state（消费后端 contract，不伪造）
  const [voidDeletingId, setVoidDeletingId] = useState<string | null>(null);
  const [voidDeleteError, setVoidDeleteError] = useState<string | null>(null);
  // Phase 1-04: PI 转换为正式应收发票
  const [convertingPiId, setConvertingPiId] = useState<string | null>(null);

  const handleConvertToReceivable = async (invoiceId: string, invoiceNumber: string) => {
    if (!(await bdsConfirm({ title: '确认转换', body: `将形式发票 ${invoiceNumber} 转换为正式应收发票？\n转换后将生成新的应收发票，原 PI 将标记为已作废。`, danger: true }))) return;
    setConvertingPiId(invoiceId);
    setVoidDeleteError(null);
    try {
      const newInvoice = await financeV2Service.convertToReceivable(invoiceId, {});
      // 刷新发票列表
      const refreshed = await invoiceService.listInvoices();
      setInvoices(refreshed);
      // 选中新建的应收发票
      setSelectedId(newInvoice.id);
      bdsToast.success(`已转换为正式应收发票 ${newInvoice.invoiceNumber}`);
    } catch (e: any) {
      setVoidDeleteError(`PI 转换失败：${e.message || e}`);
    } finally {
      setConvertingPiId(null);
    }
  };

  // R678：statusOverride 显式传参（「保存并开票」与 setState 时序解耦——
  // setInvoiceForm 后 await 本函数读到的是旧 status，payload 必须以入参为准）
  const handleSaveInvoice = async (statusOverride?: InvoiceStatus) => {
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
        status: statusOverride ?? invoiceForm.status,
        amount: invoiceAmount,
        currency: invoiceForm.currency,
        customerName: invoiceForm.customerName || undefined,
        customerRelationId: invoiceForm.customerRelationId || undefined,
        issueDate: invoiceForm.issueDate || undefined,
        dueDate: invoiceForm.dueDate || undefined,
        notes: invoiceForm.notes || undefined,
        orderId: invoiceForm.orderId.trim() || undefined,
        exchangeRate: invoiceForm.exchangeRate ? Number(invoiceForm.exchangeRate) : undefined,
        // DR：多订单分配——提交 orderIds[]（create 插入 / update 全量替换）
        ...(invoiceForm.orderIds.length > 0 ? { orderIds: invoiceForm.orderIds } : {}),
      };
      if (editingInvoice) {
        // 编辑：调 PATCH，成功后用后端返回更新本地
        const updated = await invoiceService.updateInvoice(editingInvoice.id, payload);
        setInvoices(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } as InvoiceEntity : i));
        setSelectedId(updated.id);
        bdsToast.success(`发票 ${updated.invoiceNumber} 已更新`);
      } else {
        // 新建：调 POST，成功后追加到本地
        const created = await invoiceService.createInvoice(payload);
        setInvoices(prev => [created as InvoiceEntity, ...prev]);
        setSelectedId(created.id);
        bdsToast.success(`发票 ${created.invoiceNumber} 已创建${payload.status === 'Issued' ? '并开票' : ''}`);
      }
      setShowInvoiceModal(false);
    } catch (e: any) {
      // 失败：保留原数据，显示可执行反馈
      setInvoiceError(`保存失败：${e?.message ?? e}`);
    } finally {
      setInvoiceSaving(false);
    }
  };

  // ── C6 增值税发票：列表 state（tab 激活时自包含加载，本地过滤与发票/凭证 tab 一致）───
  const [vatInvoices, setVatInvoices] = useState<VatInvoiceEntity[]>([]);
  const [vatLoading, setVatLoading] = useState(false);
  const [vatListError, setVatListError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'vatInvoices') return;
    let cancelled = false;
    setVatLoading(true);
    setVatListError(null);
    vatInvoiceService.listVatInvoices()
      .then(r => { if (!cancelled) setVatInvoices(r.items); })
      .catch((e: any) => { if (!cancelled) setVatListError(`增值税发票加载失败：${e?.message ?? e}`); })
      .finally(() => { if (!cancelled) setVatLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  // ── C6 增值税发票：创建/编辑 modal state ───
  const emptyVatForm = { vatNumber: '', vatCode: '', direction: 'Input' as VatInvoiceDirection, invoiceType: 'Special' as VatInvoiceType, sellerName: '', sellerTaxNo: '', buyerName: '', buyerTaxNo: '', issueDate: '', netAmount: '', taxRate: '13', taxAmount: '', totalAmount: '', deductionPeriod: '', notes: '' };
  const [showVatModal, setShowVatModal] = useState(false);
  const [editingVat, setEditingVat] = useState<VatInvoiceEntity | null>(null);
  const [vatForm, setVatForm] = useState(emptyVatForm);
  const [vatSaving, setVatSaving] = useState(false);
  const [vatError, setVatError] = useState<string | null>(null);

  const openCreateVat = () => {
    setEditingVat(null);
    setVatForm({ ...emptyVatForm, issueDate: new Date().toISOString().slice(0, 10) });
    setVatError(null);
    setShowVatModal(true);
  };

  const openEditVat = (vat: VatInvoiceEntity) => {
    setEditingVat(vat);
    setVatForm({
      vatNumber: vat.vatNumber || '',
      vatCode: vat.vatCode || '',
      direction: vat.direction || 'Input',
      invoiceType: vat.invoiceType || 'Special',
      sellerName: vat.sellerName || '',
      sellerTaxNo: vat.sellerTaxNo || '',
      buyerName: vat.buyerName || '',
      buyerTaxNo: vat.buyerTaxNo || '',
      issueDate: vat.issueDate || '',
      netAmount: String(vat.netAmount ?? ''),
      taxRate: String(vat.taxRate ?? ''),
      taxAmount: String(vat.taxAmount ?? ''),
      totalAmount: String(vat.totalAmount ?? ''),
      deductionPeriod: vat.deductionPeriod || '',
      notes: vat.notes || '',
    });
    setVatError(null);
    setShowVatModal(true);
  };

  const handleSaveVat = async () => {
    if (vatSaving) return;
    const netAmount = Number(vatForm.netAmount);
    const taxRate = Number(vatForm.taxRate);
    const taxAmount = Number(vatForm.taxAmount);
    const totalAmount = Number(vatForm.totalAmount);
    if (!vatForm.vatNumber.trim() || !vatForm.sellerName.trim() || !vatForm.buyerName.trim()) {
      setVatError('发票号码、销售方、购买方为必填项');
      return;
    }
    if (!vatForm.issueDate) {
      setVatError('开票日期为必填项');
      return;
    }
    if (![netAmount, taxRate, taxAmount, totalAmount].every(Number.isFinite) || netAmount <= 0 || totalAmount <= 0) {
      setVatError('金额三栏与税率必须是有效数字（金额大于 0）');
      return;
    }
    setVatSaving(true);
    setVatError(null);
    try {
      if (editingVat) {
        // 编辑：PATCH 票面修正（vatNumber/direction/invoiceType 服务端不可变，不提交）
        const updated = await vatInvoiceService.updateVatInvoice(editingVat.id, {
          vatCode: vatForm.vatCode.trim() || undefined,
          sellerName: vatForm.sellerName.trim(),
          sellerTaxNo: vatForm.sellerTaxNo.trim() || undefined,
          buyerName: vatForm.buyerName.trim(),
          buyerTaxNo: vatForm.buyerTaxNo.trim() || undefined,
          issueDate: vatForm.issueDate,
          netAmount,
          taxRate,
          taxAmount,
          totalAmount,
          deductionPeriod: vatForm.deductionPeriod.trim() || undefined,
          notes: vatForm.notes.trim() || undefined,
        });
        setVatInvoices(prev => prev.map(v => v.id === editingVat.id ? { ...v, ...updated } : v));
        bdsToast.success(`增值税发票 ${editingVat.vatNumber} 已更新`);
      } else {
        const created = await vatInvoiceService.createVatInvoice({
          vatNumber: vatForm.vatNumber.trim(),
          vatCode: vatForm.vatCode.trim() || undefined,
          direction: vatForm.direction,
          invoiceType: vatForm.invoiceType,
          sellerName: vatForm.sellerName.trim(),
          sellerTaxNo: vatForm.sellerTaxNo.trim() || undefined,
          buyerName: vatForm.buyerName.trim(),
          buyerTaxNo: vatForm.buyerTaxNo.trim() || undefined,
          issueDate: vatForm.issueDate,
          netAmount,
          taxRate,
          taxAmount,
          totalAmount,
          notes: vatForm.notes.trim() || undefined,
        });
        setVatInvoices(prev => [created, ...prev]);
      }
      setShowVatModal(false);
    } catch (e: any) {
      // 失败：金额三栏校验/查重等服务端阻断原因透出
      setVatError(`保存失败：${e?.message ?? e}`);
    } finally {
      setVatSaving(false);
    }
  };

  // ── C6 增值税发票：状态机流转 modal state（认证 / 申报退税 / 红冲）───
  const [vatTransitionTarget, setVatTransitionTarget] = useState<VatInvoiceEntity | null>(null);
  const [vatTransitionAction, setVatTransitionAction] = useState<'Verified' | 'Declared' | 'RedFlushed'>('Verified');
  const [vatTransitionForm, setVatTransitionForm] = useState({ verifiedDate: '', deductionPeriod: '', taxRefundId: '', redFlushNumber: '', redFlushDate: '' });
  const [vatTransitionSaving, setVatTransitionSaving] = useState(false);
  const [vatTransitionError, setVatTransitionError] = useState<string | null>(null);
  const [vatMutatingId, setVatMutatingId] = useState<string | null>(null);
  // 申报退税：可选退税申报单候选（Draft/Submitted/Reviewing/Rejected，终态不再接受新票）
  const [vatRefundOptions, setVatRefundOptions] = useState<TaxRefundEntity[]>([]);
  const [vatRefundOptionsLoading, setVatRefundOptionsLoading] = useState(false);

  const openVatTransition = (vat: VatInvoiceEntity, action: 'Verified' | 'Declared' | 'RedFlushed') => {
    const today = new Date().toISOString().slice(0, 10);
    setVatTransitionTarget(vat);
    setVatTransitionAction(action);
    setVatTransitionForm({
      verifiedDate: today,
      deductionPeriod: vat.deductionPeriod || '',
      taxRefundId: vat.taxRefundId || '',
      redFlushNumber: '',
      redFlushDate: today,
    });
    setVatTransitionError(null);
    if (action === 'Declared') {
      setVatRefundOptionsLoading(true);
      apiService.listTaxRefunds({ limit: 200 })
        .then(result => {
          const items = result.items || [];
          const options = items.filter(r => VAT_DECLARABLE_REFUND_STATUSES.includes(r.status));
          // 已挂接的申报单即使进入非候选状态也保留在选项中（避免显示空值）
          if (vat.taxRefundId && !options.some(o => o.id === vat.taxRefundId)) {
            const current = items.find(r => r.id === vat.taxRefundId);
            if (current) options.unshift(current);
          }
          setVatRefundOptions(options);
        })
        .catch(() => setVatRefundOptions([]))
        .finally(() => setVatRefundOptionsLoading(false));
    } else {
      setVatRefundOptions([]);
    }
  };

  const handleVatTransition = async () => {
    if (!vatTransitionTarget || vatTransitionSaving) return;
    if (vatTransitionAction === 'Declared' && !vatTransitionForm.taxRefundId.trim()) {
      setVatTransitionError('申报退税必须关联退税申报单 ID');
      return;
    }
    setVatTransitionSaving(true);
    setVatTransitionError(null);
    try {
      const updated = await vatInvoiceService.transitionVatInvoice(vatTransitionTarget.id, {
        toStatus: vatTransitionAction,
        verifiedDate: vatTransitionAction === 'Verified' ? (vatTransitionForm.verifiedDate || undefined) : undefined,
        deductionPeriod: vatTransitionAction === 'Verified' ? (vatTransitionForm.deductionPeriod.trim() || undefined) : undefined,
        taxRefundId: vatTransitionAction === 'Declared' ? vatTransitionForm.taxRefundId.trim() : undefined,
        redFlushNumber: vatTransitionAction === 'RedFlushed' ? (vatTransitionForm.redFlushNumber.trim() || undefined) : undefined,
        redFlushDate: vatTransitionAction === 'RedFlushed' ? (vatTransitionForm.redFlushDate || undefined) : undefined,
      });
      // ✅ 消费后端返回的完整实体更新本地（不伪造状态）
      setVatInvoices(prev => prev.map(v => v.id === vatTransitionTarget.id ? { ...v, ...updated } : v));
      setVatTransitionTarget(null);
      bdsToast.success(`增值税发票 ${vatTransitionTarget.vatNumber} ${vatTransitionAction === 'Verified' ? '已认证' : vatTransitionAction === 'Declared' ? '已申报退税' : '已红冲'}`);
    } catch (e: any) {
      setVatTransitionError(`流转失败：${e?.message ?? e}`);
    } finally {
      setVatTransitionSaving(false);
    }
  };

  const handleVatCancel = async (vat: VatInvoiceEntity) => {
    if (vatMutatingId) return;
    if (!(await bdsConfirm({ title: '确认作废', body: `作废增值税发票 ${vat.vatNumber}？\n作废后不可恢复，仅收票状态可作废。`, danger: true }))) return;
    setVatMutatingId(vat.id);
    setVatListError(null);
    try {
      const updated = await vatInvoiceService.transitionVatInvoice(vat.id, { toStatus: 'Cancelled' });
      setVatInvoices(prev => prev.map(v => v.id === vat.id ? { ...v, ...updated } : v));
    } catch (e: any) {
      setVatListError(`作废失败：${e?.message ?? e}`);
    } finally {
      setVatMutatingId(null);
    }
  };

  const handleVatDelete = async (vat: VatInvoiceEntity) => {
    if (vatMutatingId) return;
    if (!(await bdsConfirm({ title: '确认删除', body: `删除增值税发票 ${vat.vatNumber}？\n已申报退税的发票不可删除（仅可红冲）。`, danger: true }))) return;
    setVatMutatingId(vat.id);
    setVatListError(null);
    try {
      await vatInvoiceService.deleteVatInvoice(vat.id);
      setVatInvoices(prev => prev.filter(v => v.id !== vat.id));
      setSelectedId(null);
      bdsToast.success(`增值税发票 ${vat.vatNumber} 已删除`);
    } catch (e: any) {
      setVatListError(`删除失败：${e?.message ?? e}`);
    } finally {
      setVatMutatingId(null);
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
      bdsToast.success(editingAllocId ? '核销记录已更新' : '核销已登记');
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
        bdsToast.warning('状态已更新，但明细列表刷新失败，请刷新页面查看最新数据。');
      }
    }
  };

  const handleDeleteAlloc = async (allocId: string) => {
    if (!selectedItem?.id) return;
    // 删除前先定位真实 invoiceId/voucherId（不依赖 selectedItem）
    const parties = resolveAllocParties(allocId);
    if (!(await bdsConfirm({ title: '确认撤销', body: '确认撤销该核销记录？撤销后发票/凭证状态将反向重算。', danger: true }))) return;
    let mutationOk = false;
    try {
      const result = await allocationService.deleteAllocation(allocId);
      // ✅ mutation 成功——先消费反向重算结果 + 本地 remove allocation（乐观更新）
      applyRecalcResult(result.newInvoiceStatus, result.newVoucherStatus, parties.invoiceId, parties.voucherId);
      setAllocations(prev => prev.filter(a => a.id !== allocId));
      bdsToast.success('核销已撤销，发票/凭证状态已反向重算');
      mutationOk = true;
    } catch (e: any) {
      // mutation 失败——真实未落库，显示失败反馈
      bdsToast.danger(`撤销核销失败：${e?.message ?? e}`);
    }
    // ✅ mutation 成功后 best-effort 刷新列表（独立 try/catch，失败不误导用户）
    if (mutationOk) {
      try {
        const params = isInvoiceContext ? { invoiceId: selectedItem.id } : { voucherId: selectedItem.id };
        const refreshed = await allocationService.listAllocations(undefined, params);
        setAllocations(refreshed);
      } catch {
        // refresh 失败——状态已更新，只提示明细刷新失败
        bdsToast.warning('状态已更新，但明细列表刷新失败，请刷新页面查看最新数据。');
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

  // ── BDS v2.1 语义文本/表单类（token 主题透明，无 isDarkMode 分支） ───
  const textPrimaryClass = 'text-[var(--text-primary)]';
  const textSecondaryClass = 'text-[var(--text-tertiary)]';
  const formInputClass = 'bds-input sm';
  const formSelectSmStyle = { height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' } as const;
  const formStaticClass = 'rounded-field bg-[var(--recessed-bg)] px-4 py-2.5 text-xs font-light text-[var(--text-tertiary)]';

  // ── KPI row (always derived from ALL invoices + ALL vouchers) ───
  // DR-044 净额口径：四张卡均按"单据金额 − 已核销"聚合（openAmount 派生字段），
  // 与账龄分析/对账单/报表同一公式，消除"账龄 $84,000 vs 对账单 $34,000"分裂（P1-005）。
  // I2 折人民币合计：汇率真源 = 风控域最新汇率档案（GET /v1/risk/fx-rates-latest，rate = 1 外币 → CNY），
  // 与汇率损益/外汇台账同一档案，不自造汇率口径。
  const [latestFxRates, setLatestFxRates] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    apiService.getLatestFxRates()
      .then(list => {
        if (!alive) return;
        const map: Record<string, number> = {};
        for (const r of list) map[r.currency] = Number(r.rate);
        setLatestFxRates(map);
      })
      .catch(() => { /* 汇率档案不可达时回落原有多币种展示（不折算、不阻塞） */ });
    return () => { alive = false; };
  }, []);

  const kpiCards: KpiCard[] = useMemo(() => {
    const openReceivable = invoices.filter(i => i.type === 'Receivable' && i.status !== 'Paid' && i.status !== 'Cancelled');
    const openPayable = invoices.filter(i => i.type === 'Payable' && i.status !== 'Paid' && i.status !== 'Cancelled');
    const openReceiptVouchers = vouchers.filter(v => v.type === 'Receipt' && v.status !== 'reconciled' && v.status !== 'cancelled');
    const openDisbursementVouchers = vouchers.filter(v => v.type === 'Disbursement' && v.status !== 'reconciled' && v.status !== 'cancelled');

    const recvAgg = aggregateByCurrency(openReceivable.map(i => ({ currency: i.currency, amount: netOpenAmount(i) })));
    const payAgg = aggregateByCurrency(openPayable.map(i => ({ currency: i.currency, amount: netOpenAmount(i) })));
    const recvVAgg = aggregateByCurrency(openReceiptVouchers.map(v => ({ currency: v.currency, amount: netOpenAmount(v) })));
    const payVAgg = aggregateByCurrency(openDisbursementVouchers.map(v => ({ currency: v.currency, amount: netOpenAmount(v) })));

    const recv = formatCurrencyAggregate(recvAgg);
    const pay = formatCurrencyAggregate(payAgg);
    const recvV = formatCurrencyAggregate(recvVAgg);
    const payV = formatCurrencyAggregate(payVAgg);

    // 折人民币合计行：含外币才显示；缺汇率币种透明披露，不强行估算
    const cnyLine = (agg: CurrencyAggItem[]): string | undefined => {
      if (agg.length === 0) return undefined;
      const result = aggregateToCny(agg, latestFxRates);
      if (!result.hasForeign) return undefined;
      const base = `折人民币 ≈ ${formatAmount(result.total, 'CNY')}`;
      return result.missing.length > 0 ? `${base}（缺 ${result.missing.join('/')} 汇率）` : base;
    };

    return [
      { label: '应收发票', primary: recv.primary, secondary: recv.secondary, tertiary: cnyLine(recvAgg) },
      { label: '应付发票', primary: pay.primary, secondary: pay.secondary, tertiary: cnyLine(payAgg) },
      { label: '待收凭证', primary: recvV.primary, secondary: recvV.secondary, tertiary: cnyLine(recvVAgg) },
      { label: '待付凭证', primary: payV.primary, secondary: payV.secondary, tertiary: cnyLine(payVAgg) },
    ];
  }, [invoices, vouchers, latestFxRates]);

  // ── Per-tab lists & current row selection ───
  const filteredInvoices = useMemo(() => {
    let result = invoices;
    if (navRelationFilter) result = result.filter(i => i.customerRelationId === navRelationFilter.relationId);
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
  }, [invoices, selectedType, selectedStatus, searchTerm, navRelationFilter]);

  const filteredVouchers = useMemo(() => {
    let result = vouchers;
    if (navRelationFilter) result = result.filter(v => v.customerRelationId === navRelationFilter.relationId);
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
  }, [vouchers, selectedType, selectedStatus, searchTerm, navRelationFilter]);

  // C6 增值税发票：本地过滤（方向 → type chips / 状态 → status chips，与发票/凭证 tab 同一交互范式）
  const filteredVatInvoices = useMemo(() => {
    let result = vatInvoices;
    if (navRelationFilter) result = result.filter(v => v.relationId === navRelationFilter.relationId);
    if (selectedType !== 'all') result = result.filter(v => v.direction === selectedType);
    if (selectedStatus !== 'all') result = result.filter(v => v.status === selectedStatus);
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter(v =>
        v.vatNumber?.toLowerCase().includes(q) ||
        v.sellerName?.toLowerCase().includes(q) ||
        v.buyerName?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [vatInvoices, selectedType, selectedStatus, searchTerm, navRelationFilter]);

  // 自包含 tab（报表 / 资金日历 / 付款申请 / 客户信用 / 催款月结）由专属面板全权渲染，不消费共享列表与核销副作用
  const isSelfContainedTab = activeTab === 'reports' || activeTab === 'cashCalendar' || activeTab === 'paymentRequests' || activeTab === 'credit' || activeTab === 'reconciliation' || activeTab === 'collections';
  const activeList: Array<InvoiceEntity | VoucherEntity | VatInvoiceEntity> =
    isSelfContainedTab ? [] : activeTab === 'invoices' ? filteredInvoices : activeTab === 'vatInvoices' ? filteredVatInvoices : filteredVouchers;
  const selectedItem = activeList.find(item => item.id === selectedId) || activeList[0];

  const isInvoiceContext = activeTab === 'invoices';

  // 选中 invoice/voucher 时加载其 allocations（消费 GET /allocations）；增值税发票无核销语义，跳过
  useEffect(() => {
    if (activeTab === 'vatInvoices') { setAllocations([]); return; }
    if (!selectedItem?.id) { setAllocations([]); return; }
    setAllocLoading(true);
    const params = isInvoiceContext ? { invoiceId: selectedItem.id } : { voucherId: selectedItem.id };
    allocationService.listAllocations(undefined, params)
      .then(setAllocations)
      .catch(() => setAllocations([]))
      .finally(() => setAllocLoading(false));
  }, [selectedItem?.id, activeTab]);

  // DR：发票 tab 选中时拉取详情（GET /v1/finance/:id），获取发票↔订单 orderAllocations + 附件 attachments
  useEffect(() => {
    if (activeTab !== 'invoices' || !selectedItem?.id) { setInvoiceDetail(null); return; }
    let cancelled = false;
    setInvoiceDetailLoading(true);
    invoiceService.getInvoice(selectedItem.id)
      .then(detail => { if (!cancelled) setInvoiceDetail(detail); })
      .catch(() => { if (!cancelled) setInvoiceDetail(null); })
      .finally(() => { if (!cancelled) setInvoiceDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedItem?.id, activeTab, invoices]);

  // DR-057 v2.1 发票↔开发单双向闭环：发票详情反查引用本发票作为样品发票的开发单
  useEffect(() => {
    if (activeTab !== 'invoices' || !selectedItem?.id) { setLinkedDevCases([]); return; }
    let cancelled = false;
    developmentService.listDevelopmentCases(undefined, { sampleInvoiceId: selectedItem.id, limit: 5 })
      .then(list => { if (!cancelled) setLinkedDevCases(list); })
      .catch(() => { if (!cancelled) setLinkedDevCases([]); });
    return () => { cancelled = true; };
  }, [selectedItem?.id, activeTab]);

  // 交单回链：sourceInvoiceId 反查单据中心 CommercialInvoice（交单号=记账号，双向跳转用）
  useEffect(() => {
    if (activeTab !== 'invoices' || !selectedItem?.id) { setInvoiceTradeDoc(null); return; }
    let cancelled = false;
    apiService.listTradeDocuments({ sourceInvoiceId: selectedItem.id, type: 'CommercialInvoice', limit: 5 })
      .then(r => { if (!cancelled) setInvoiceTradeDoc(r.items[0] ?? null); })
      .catch(() => { if (!cancelled) setInvoiceTradeDoc(null); });
    return () => { cancelled = true; };
  }, [selectedItem?.id, activeTab]);

  // 导出发票 PDF（GET /:id/render.pdf → 浏览器下载）
  const handleExportInvoicePdf = async (invoice: InvoiceEntity) => {
    try {
      await invoiceService.renderInvoicePdf(invoice.id);
      bdsToast.success(`已导出发票 ${invoice.invoiceNumber} 的 PDF`);
    } catch (e: any) {
      setInvoiceAttachmentErr(`导出 PDF 失败：${e?.message ?? e}`);
    }
  };

  // 发票预览弹窗（GET /:id/preview.html——与 render.pdf 同源渲染，所见即所得）；
  // 弹窗 UI 用全站共享组件 A4DocumentPreviewModal（B1 架构底座）
  const [previewingInvoice, setPreviewingInvoice] = useState<InvoiceEntity | null>(null);
  const [invoicePreviewHtml, setInvoicePreviewHtml] = useState<string | null>(null);
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false);
  const [invoicePreviewErr, setInvoicePreviewErr] = useState<string | null>(null);

  const handlePreviewInvoice = async (invoice: InvoiceEntity) => {
    setPreviewingInvoice(invoice);
    setInvoicePreviewHtml(null);
    setInvoicePreviewErr(null);
    setInvoicePreviewLoading(true);
    try {
      const html = await invoiceService.getInvoicePreviewHtml(invoice.id);
      setInvoicePreviewHtml(html);
    } catch (e: any) {
      setInvoicePreviewErr(`加载预览失败：${e?.message ?? e}`);
    } finally {
      setInvoicePreviewLoading(false);
    }
  };

  // 上传发票真实文件（POST /:id/attachments，multipart 'file'）→ 登记到 invoice.attachments
  const handleUploadInvoiceAttachment = async (invoiceId: string) => {
    const file = invoiceUpFile;
    if (!file) { setInvoiceAttachmentErr('请先选择要上传的发票文件'); return; }
    setInvoiceUploading(true);
    setInvoiceAttachmentErr(null);
    try {
      const att = await invoiceService.uploadInvoiceAttachment(invoiceId, file);
      // 用后端返回的附件更新本地详情附件列表
      setInvoiceDetail(prev => {
        if (!prev) return prev;
        const prevArts = (Array.isArray((prev as any).attachments) ? (prev as any).attachments : []) as InvoiceAttachment[];
        return { ...prev, attachments: [...prevArts, att] };
      });
      setInvoiceUpFile(null);
      bdsToast.success('发票附件上传成功');
    } catch (e: any) {
      setInvoiceAttachmentErr(`上传失败：${e?.message ?? e}`);
    } finally {
      setInvoiceUploading(false);
    }
  };

  // 下载/查看附件（带鉴权头拉取 blob 后触发浏览器保存）
  const handleDownloadAttachment = async (att: InvoiceAttachment) => {
    try {
      const url = apiService.buildApiUrl(att.url, undefined);
      const res = await fetch(url, { headers: apiService.getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = att.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      setInvoiceAttachmentErr(`下载附件失败：${e?.message ?? e}`);
    }
  };

  // ── Status quick-stats (shown at right of toolbar for the active tab) ───
  const statusStats = useMemo(() => {
    if (activeTab === 'reports' || activeTab === 'cashCalendar' || activeTab === 'reconciliation' || activeTab === 'collections') return [];
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
      : activeTab === 'vatInvoices'
        ? [{ key: 'vatNumber', label: '发票号码' }, { key: 'status', label: '状态' }, { key: 'partner', label: '购销方' }, { key: 'amount', label: '价税合计' }]
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
        )}
      >
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimaryClass)}>{item.invoiceNumber}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{invoiceTypeLabel(item.type)} · {item.currency || '—'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <span className={invoiceStatusBadge(item.status)}>
            {INVOICE_STATUS_LABEL[item.status] ?? item.status}
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
        )}
      >
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimaryClass)}>{item.voucherNumber}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{voucherTypeLabel(item.type)} · {item.currency || '—'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className={voucherStatusBadge((item.status || 'unreconciled') as VoucherStatus)}>
              {voucherStatusLabel(item.status)}
            </span>
            {(item as PaymentVoucherWithCategory).voucherCategory && (item as PaymentVoucherWithCategory).voucherCategory !== 'normal' && (
              <span className={FINANCE_STATUS_BADGE}>{voucherCategoryLabel((item as PaymentVoucherWithCategory).voucherCategory)}</span>
            )}
          </div>
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

  // ── C6 增值税发票表格行（镜像发票/凭证行范式）───
  const renderVatRow = (item: VatInvoiceEntity) => {
    const active = selectedItem?.id === item.id;
    const partnerName = item.direction === 'Input' ? item.sellerName : item.buyerName;
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
        )}
      >
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimaryClass)}>{item.vatNumber}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{vatDirectionLabel(item.direction)} · {vatTypeLabel(item.invoiceType)}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <span className={vatStatusBadge(item.status)}>
            {VAT_STATUS_LABELS[item.status] || item.status}
          </span>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{vatDirectionLabel(item.direction)}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light', textPrimaryClass)}>{partnerName || '—'}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{item.orderId ? `订单 ${item.orderId.slice(-8)}` : item.taxRefundId ? `退税 ${item.taxRefundId.slice(-8)}` : '无关联单据'}</div>
        </div>
        <div className="min-w-0 px-1 py-1">
          <div className={cx('truncate font-light tabular-nums', textPrimaryClass)}>{formatAmount(Number(item.totalAmount), item.currency)}</div>
          <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{item.issueDate || '—'}</div>
        </div>
      </button>
    );
  };

  // ── R4 快照空态诚实化（发票/收付款 tab 走 App 快照 props，无 loading/error 信号； ──
  //    快照失败由 App 全局横幅覆盖，本组件不改 App.tsx）──
  // 「首轮快照已落地」判定：挂载即非空（本地缓存回填）立即落地；挂载后数组引用首次变更
  // 即落地（App applyDataHubSnapshot 每轮同步恒产出新数组引用，空结果亦如此）；
  // 兜底定时器在窗口内未观测到落地时转「暂无」（宁可早报暂无，不无限谎称加载中）。
  const SNAPSHOT_SETTLE_MS = 4000;
  const snapshotInitRef = useRef<{ invoices: InvoiceEntity[]; vouchers: VoucherEntity[] } | null>(null);
  const [snapshotSettled, setSnapshotSettled] = useState(() => invoices.length > 0 || vouchers.length > 0);
  if (snapshotInitRef.current === null) snapshotInitRef.current = { invoices, vouchers };
  useEffect(() => {
    if (snapshotSettled) return;
    const init = snapshotInitRef.current;
    if (
      invoices.length > 0 || vouchers.length > 0 ||
      (init !== null && (init.invoices !== invoices || init.vouchers !== vouchers))
    ) {
      setSnapshotSettled(true);
      return;
    }
    const timer = window.setTimeout(() => setSnapshotSettled(true), SNAPSHOT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [invoices, vouchers, snapshotSettled]);
  /** 快照 tab（发票/收付款）首轮同步未落地 = 加载中；落地后空列表才可诚实地显示「暂无」 */
  const snapshotListLoading = (activeTab === 'invoices' || activeTab === 'vouchers') && !snapshotSettled;

  // ── Side panel detail rendering ───
  const activeSearchPlaceholder =
    activeTab === 'invoices' ? '发票号 / 伙伴' : activeTab === 'vatInvoices' ? '发票号码 / 购销方' : '凭证号 / 伙伴';

  const renderEmptyState = () => (
    <div className="bds-empty">
      <div className="glyph">
        {snapshotListLoading || (vatLoading && activeTab === 'vatInvoices')
          ? <Loader2 size={24} strokeWidth={1.25} className="animate-spin" />
          : activeTab === 'invoices'
            ? <FileText size={24} strokeWidth={1.25} />
            : activeTab === 'vatInvoices'
              ? <Receipt size={24} strokeWidth={1.25} />
              : <CreditCard size={24} strokeWidth={1.25} />}
      </div>
      <div className="title">
        {vatLoading && activeTab === 'vatInvoices'
          ? '加载中…'
          : snapshotListLoading
            ? '加载中…（正在同步数据中心快照）'
            : activeTab === 'invoices'
              ? '暂无匹配发票'
              : activeTab === 'vatInvoices'
                ? '暂无匹配增值税发票'
                : '暂无匹配凭证'}
      </div>
    </div>
  );

  // ── C6 增值税发票侧栏（字段 + 状态机流转入口 + 关联视图）───
  const renderVatSidePanel = () => {
    const vat = (selectedItem as VatInvoiceEntity | undefined) || undefined;
    if (!vat) {
      return (
        <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondaryClass)}>
          <Receipt size={24} strokeWidth={1.25} className="mb-3 opacity-45" />
          <div className="text-sm font-light">请选择增值税发票</div>
        </div>
      );
    }

    // R6：vat:write 门控叠加在状态机显隐之上（服务端 requirePermission 兜底）
    const canEdit = canWriteVat && (vat.status === 'Received' || vat.status === 'Verified');
    const canVerify = canWriteVat && vat.status === 'Received';
    const canDeclare = canWriteVat && vat.status === 'Verified' && vat.direction === 'Input' && vat.invoiceType === 'Special';
    const canRedFlush = canWriteVat && (vat.status === 'Verified' || vat.status === 'Declared');
    const canCancel = canWriteVat && vat.status === 'Received';
    const canDelete = canWriteVat && vat.status !== 'Declared';

    const fieldRows = [
      { label: '发票号码', value: vat.vatNumber },
      { label: '发票代码', value: vat.vatCode || '—' },
      { label: '票种', value: `${vatDirectionLabel(vat.direction)} · ${vatTypeLabel(vat.invoiceType)}` },
      { label: '销售方', value: vat.sellerName || '—' },
      { label: '销售方税号', value: vat.sellerTaxNo || '—' },
      { label: '购买方', value: vat.buyerName || '—' },
      { label: '购买方税号', value: vat.buyerTaxNo || '—' },
      { label: '开票日期', value: vat.issueDate || '—' },
      { label: '不含税金额', value: formatAmount(Number(vat.netAmount), vat.currency) },
      { label: '税率', value: `${vat.taxRate}%` },
      { label: '税额', value: formatAmount(Number(vat.taxAmount), vat.currency) },
      { label: '认证日期', value: vat.verifiedDate || '—' },
      { label: '抵扣所属期', value: vat.deductionPeriod || '—' },
      { label: '退税申报', value: vat.taxRefundId ? `申报 ${vat.taxRefundId.slice(-8)}` : '—' },
      { label: '红字发票号', value: vat.redFlushNumber || '—' },
      { label: '红冲日期', value: vat.redFlushDate || '—' },
      { label: '关联订单', value: vat.orderId ? `订单 ${vat.orderId.slice(-8)}` : '—' },
      { label: '备注', value: vat.notes || '—' },
    ];

    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {vatListError && (
          <div className="bds-alert danger">
            {vatListError}
          </div>
        )}
        <div className="px-5 py-5">
          {/* 与发票/凭证详情头部一致（2026-08-21）：头部行 flex-wrap + 按钮簇去 shrink-0，
              窄 panel 下按钮簇整块落到标题下方而非顶破。 */}
          <div className="flex flex-wrap min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>当前增值税发票</div>
              <div className={cx('mt-2 truncate text-base font-light', textPrimaryClass)}>{vat.vatNumber}</div>
              <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{vatDirectionLabel(vat.direction)}{vatTypeLabel(vat.invoiceType)} · {vat.currency || 'CNY'}</div>
              {/* 状态徽章归到标题信息区，与动作按钮分离，避免混排显得杂乱 */}
              <div className="mt-2"><span className={vatStatusBadge(vat.status)}>
                {VAT_STATUS_LABELS[vat.status] || vat.status}
              </span></div>
            </div>
            {/* 按钮簇只放纯动作按钮；状态徽章已上移到标题块。
               flex-wrap + justify-start：窄 panel 下可换行且左对齐整齐。 */}
            <div className="flex flex-wrap items-center justify-start gap-2">
              {canEdit && (
                <button type="button" onClick={() => openEditVat(vat)} className="bds-btn bds-btn-secondary">
                  <Pencil size={16} strokeWidth={1.75} />
                  编辑
                </button>
              )}
              {canVerify && (
                <button type="button" onClick={() => openVatTransition(vat, 'Verified')} className="bds-btn bds-btn-secondary">
                  <BadgeCheck size={16} strokeWidth={1.75} />
                  认证
                </button>
              )}
              {canDeclare && (
                <button type="button" onClick={() => openVatTransition(vat, 'Declared')} className="bds-btn bds-btn-secondary">
                  <Landmark size={16} strokeWidth={1.75} />
                  申报退税
                </button>
              )}
              {canRedFlush && (
                <button type="button" onClick={() => openVatTransition(vat, 'RedFlushed')} className="bds-btn bds-btn-secondary">
                  <RotateCcw size={16} strokeWidth={1.75} />
                  红冲
                </button>
              )}
              {canCancel && (
                <button type="button" disabled={vatMutatingId === vat.id} onClick={() => handleVatCancel(vat)} className="bds-btn bds-btn-secondary">
                  {vatMutatingId === vat.id ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} strokeWidth={1.75} />}
                  作废
                </button>
              )}
              {canDelete && (
                <button type="button" disabled={vatMutatingId === vat.id} onClick={() => handleVatDelete(vat)} className="bds-btn bds-btn-secondary">
                  {vatMutatingId === vat.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} strokeWidth={1.75} />}
                  删除
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5">
          <div className="space-y-1">
            {fieldRows.map(row => (
              <div key={row.label} className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-2 py-1">
                <div className={cx('text-[10px] font-light tracking-wide', textSecondaryClass)}>{row.label}</div>
                <div className={cx('truncate text-xs font-light', textPrimaryClass)}>{row.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-inset p-3 bds-inset">
            <div className={cx('text-[10px] font-light tracking-wide', textSecondaryClass)}>状态说明</div>
            <div className={cx('mt-1 text-[11px] font-light leading-relaxed', textPrimaryClass)}>
              {VAT_STATUS_LABELS[vat.status] || vat.status}：{VAT_STATUS_GUIDE[vat.status] || '请检查发票状态。'}
            </div>
          </div>
          <div className="bds-divider" style={{ margin: 'var(--space-4) 0' }} />
          <div className="rounded-inset p-4 bds-inset">
            <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>价税合计</div>
            <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimaryClass)}>{formatAmount(Number(vat.totalAmount), vat.currency)}</div>
            <div className={cx('mt-1 text-[11px] font-light tabular-nums', textSecondaryClass)}>
              不含税 {formatAmount(Number(vat.netAmount), vat.currency)} + 税额 {formatAmount(Number(vat.taxAmount), vat.currency)}
            </div>
          </div>
          {vat.relationId && (
          <div className="mt-4">
            <RelatedWorkspacesSection
              sourceType="relation"
              relationId={vat.relationId}
              relationRole="customer"
              onNavigate={onNavigate}
              isDarkMode={isDarkMode}
            />
          </div>
          )}
        </div>
      </div>
    );
  };

  const renderSidePanel = () => {
    if (activeTab === 'vatInvoices') return renderVatSidePanel();
    if (!selectedItem) {
      return (
        <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondaryClass)}>
          {activeTab === 'invoices'
            ? <FileText size={24} strokeWidth={1.25} className="mb-3 opacity-45" />
            : <CreditCard size={24} strokeWidth={1.25} className="mb-3 opacity-45" />}
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
      ? invoiceStatusBadge(invoice!.status)
      : voucherStatusBadge((voucher!.status || 'unreconciled') as VoucherStatus);
    const statusLabel = isInvoice
      ? (INVOICE_STATUS_LABEL[invoice!.status] ?? invoice!.status)
      : voucherStatusLabel(voucher!.status);

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
          { label: '凭证分类', value: voucherCategoryLabel((voucher as PaymentVoucherWithCategory).voucherCategory) },
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {voidDeleteError && (
          <div className="bds-alert danger">
            {voidDeleteError}
          </div>
        )}
        <div className="px-5 py-5">
          {/* 根因修复（2026-08-21）：头部行必须 flex-wrap，否则窄 panel 下右侧按钮簇
              被左侧标题挤破、向右戳出被 overflow-hidden 裁切（"编辑/导出PDF 仍溢出"）。
              加 flex-wrap 后空间不足时按钮簇整块落到标题下方，而非顶破。 */}
          <div className="flex flex-wrap min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>{headerLabel}</div>
              <div className={cx('mt-2 truncate text-base font-light', textPrimaryClass)}>{headerValue}</div>
              <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{headerMeta}</div>
              {/* 状态徽章归到标题信息区，与动作按钮分离，避免混排显得杂乱 */}
              <div className="mt-2"><span className={statusChipClassApplied}>{statusLabel}</span></div>
            </div>
            {/* 按钮簇只放纯动作按钮；状态徽章已上移到标题块。
               flex-wrap + justify-start：窄 panel 下可换行且左对齐整齐，不再顶破 panel。 */}
            <div className="flex flex-wrap items-center justify-start gap-2">
              {/* P0 invoice manual UI: 编辑发票入口（R6：invoices:write 门控） */}
              {isInvoice && invoice && canWriteInvoices && (
                <button
                  type="button"
                  onClick={() => openEditInvoice(invoice)}
                  className="bds-btn bds-btn-secondary"
                >
                  <Pencil size={16} strokeWidth={1.75} />
                  编辑
                </button>
              )}
              {/* Phase 1-04: PI 转换为正式应收发票（仅 Proforma 类型且非 Cancelled；R6：invoices:write 门控） */}
              {isInvoice && invoice && canWriteInvoices && (invoice as any).type === 'Proforma' && invoice.status !== 'Cancelled' && (
                <button
                  type="button"
                  disabled={convertingPiId === invoice.id}
                  onClick={() => handleConvertToReceivable(invoice.id, invoice.invoiceNumber)}
                  className="bds-btn bds-btn-secondary"
                >
                  {convertingPiId === invoice.id ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} strokeWidth={1.75} />}
                  转为应收
                </button>
              )}
              {/* 发票预览（与导出 PDF 同源渲染，所见即所得） */}
              {isInvoice && invoice && (
                <button
                  type="button"
                  onClick={() => handlePreviewInvoice(invoice)}
                  className="bds-btn bds-btn-secondary"
                >
                  <Eye size={16} strokeWidth={1.75} />
                  预览
                </button>
              )}
              {/* 导出发票 PDF */}
              {isInvoice && invoice && (
                <button
                  type="button"
                  disabled={invoiceDetailLoading}
                  onClick={() => handleExportInvoicePdf(invoice)}
                  className="bds-btn bds-btn-secondary"
                >
                  <Download size={16} strokeWidth={1.75} />
                  导出 PDF
                </button>
              )}
              {/* task_mqyusoio: 作废入口（只对非 Cancelled 发票显示；R6：invoices:write 门控） */}
              {isInvoice && invoice && canWriteInvoices && invoice.status !== 'Cancelled' && (
                <button
                  type="button"
                  disabled={voidDeletingId === invoice.id}
                  onClick={async () => {
                    if (!(await bdsConfirm({ title: '确认作废', body: `作废发票 ${invoice.invoiceNumber}？\n作废后状态变为 Cancelled，不可恢复。`, danger: true }))) return;
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
                  className="bds-btn bds-btn-secondary"
                >
                  {voidDeletingId === invoice.id ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} strokeWidth={1.75} />}
                  作废
                </button>
              )}
              {/* task_mqyusoio: 软删入口（所有发票可删，HAS_ALLOCATIONS 阻断；R6：invoices:write 门控） */}
              {isInvoice && invoice && canWriteInvoices && (
                <button
                  type="button"
                  disabled={voidDeletingId === invoice.id}
                  onClick={async () => {
                    if (!(await bdsConfirm({ title: '确认删除', body: `删除发票 ${invoice.invoiceNumber}？\n有核销记录的发票不可删除。`, danger: true }))) return;
                    setVoidDeletingId(invoice.id);
                    setVoidDeleteError(null);
                    try {
                      await invoiceService.deleteInvoice(invoice.id);
                      setInvoices(prev => prev.filter(i => i.id !== invoice.id));
                      setSelectedId(null);
                      bdsToast.success(`发票 ${invoice.invoiceNumber} 已删除`);
                    } catch (e: any) {
                      setVoidDeleteError(`删除失败：${e.message || e}`);
                    } finally {
                      setVoidDeletingId(null);
                    }
                  }}
                  className="bds-btn bds-btn-secondary"
                >
                  {voidDeletingId === invoice.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} strokeWidth={1.75} />}
                  删除
                </button>
              )}
              {/* voucher 编辑入口（R6：vouchers:write 门控） */}
              {!isInvoice && voucher && canWriteVouchers && (
                <button
                  type="button"
                  onClick={() => openEditVoucher(voucher)}
                  className="bds-btn bds-btn-secondary"
                >
                  <Pencil size={16} strokeWidth={1.75} />
                  编辑
                </button>
              )}
              {/* F2 外汇核销闭环：结汇入口（仅外币收款凭证有结汇语义；R6：vouchers:write 门控） */}
              {!isInvoice && voucher && canWriteVouchers && voucher.type === 'Receipt' && voucher.currency !== 'CNY' && (
                <button
                  type="button"
                  onClick={() => openSettlementModal(voucher)}
                  className="bds-btn bds-btn-secondary"
                >
                  <Landmark size={16} strokeWidth={1.75} />
                  结汇
                </button>
              )}
              {/* C6 付汇闭环：付汇入口（仅外币付款凭证有付汇语义，镜像结汇付款侧；R6：vouchers:write 门控） */}
              {!isInvoice && voucher && canWriteVouchers && voucher.type === 'Disbursement' && voucher.currency !== 'CNY' && (
                <button
                  type="button"
                  onClick={() => openRemittanceModal(voucher)}
                  className="bds-btn bds-btn-secondary"
                >
                  <Send size={16} strokeWidth={1.75} />
                  付汇
                </button>
              )}
              {/* voucher 作废入口（非 cancelled 状态可作废；R6：vouchers:write 门控） */}
              {!isInvoice && voucher && canWriteVouchers && voucher.status !== 'cancelled' && (
                <button
                  type="button"
                  disabled={voidDeletingId === voucher.id}
                  onClick={async () => {
                    if (!(await bdsConfirm({ title: '确认作废', body: `作废凭证 ${voucher.voucherNumber}?\n有核销记录的凭证不可作废。`, danger: true }))) return;
                    setVoidDeletingId(voucher.id);
                    setVoidDeleteError(null);
                    try {
                      const updated = await paymentVoucherService.cancelVoucher(voucher.id);
                      setVouchers(prev => prev.map(v => v.id === voucher.id ? { ...v, ...updated } : v));
                      bdsToast.success(`凭证 ${voucher.voucherNumber} 已作废`);
                    } catch (e: any) {
                      setVoidDeleteError(`作废失败：${e.message || e}`);
                    } finally {
                      setVoidDeletingId(null);
                    }
                  }}
                  className="bds-btn bds-btn-secondary"
                >
                  {voidDeletingId === voucher.id ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} strokeWidth={1.75} />}
                  作废
                </button>
              )}
              {/* task_mqyusoio: voucher 软删入口（消费 paymentVoucherService.deletePaymentVoucher；R6：vouchers:write 门控） */}
              {!isInvoice && voucher && canWriteVouchers && (
                <button
                  type="button"
                  disabled={voidDeletingId === voucher.id}
                  onClick={async () => {
                    if (!(await bdsConfirm({ title: '确认删除', body: `删除凭证 ${voucher.voucherNumber}？\n有核销记录的凭证不可删除。`, danger: true }))) return;
                    setVoidDeletingId(voucher.id);
                    setVoidDeleteError(null);
                    try {
                      await paymentVoucherService.deletePaymentVoucher(voucher.id);
                      setVouchers(prev => prev.filter(v => v.id !== voucher.id));
                      setSelectedId(null);
                      bdsToast.success(`凭证 ${voucher.voucherNumber} 已删除`);
                    } catch (e: any) {
                      setVoidDeleteError(`删除失败：${e.message || e}`);
                    } finally {
                      setVoidDeletingId(null);
                    }
                  }}
                  className="bds-btn bds-btn-secondary"
                >
                  {voidDeletingId === voucher.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} strokeWidth={1.75} />}
                  删除
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5">
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
            <div className="mt-3 rounded-inset p-3 bds-inset">
              <div className={cx('text-[10px] font-light tracking-wide', textSecondaryClass)}>状态说明</div>
              <div className={cx('mt-1 text-[11px] font-light leading-relaxed', textPrimaryClass)}>
                {VOUCHER_STATUS_GUIDE[voucher.status as VoucherStatus]?.label ?? '未知状态'}：{VOUCHER_STATUS_GUIDE[voucher.status as VoucherStatus]?.nextStep ?? '请检查凭证核销状态。'}
              </div>
            </div>
          )}
          <div className="bds-divider" style={{ margin: 'var(--space-4) 0' }} />
          <div className="rounded-inset p-4 bds-inset">
            <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>{summary.label}</div>
            <div className={cx('mt-2 text-sm font-light tabular-nums', textPrimaryClass)}>{summary.value}</div>
          </div>
          {/* DR：发票↔订单 多对多——关联订单分配列表（消费 GET /:id 的 orderAllocations） */}
          {isInvoice && invoice && (
            <div className="mt-4">
              <div className="rounded-inset p-4 bds-inset">
                <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>关联订单（{invoiceDetail?.orderAllocations?.length ?? 0}）</div>
                {invoiceDetailLoading ? (
                  <div className={cx('mt-2 text-[11px] font-light', textSecondaryClass)}>加载中...</div>
                ) : !invoiceDetail?.orderAllocations || invoiceDetail.orderAllocations.length === 0 ? (
                  <div className={cx('mt-2 text-[11px] font-light', textSecondaryClass)}>暂无关联订单。在「编辑」中分配一个或多个订单。</div>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {invoiceDetail.orderAllocations.map((oa: InvoiceOrderAllocation) => (
                      <div key={oa.id} className="rdl-data-row min-h-0 justify-between px-2.5 py-1.5">
                        <div className="min-w-0">
                          <div className={cx('truncate text-[11px] font-light', textPrimaryClass)}>
                            {oa.orderNumber ? `订单 ${oa.orderNumber}` : `订单 ${oa.orderId.slice(-8)}`}
                            {oa.poNumber ? ` · PO ${oa.poNumber}` : ''}
                          </div>
                          <div className={cx('mt-0.5 text-[10px] font-light', textSecondaryClass)}>
                            {oa.allocatedAmount != null ? `分配金额 ${oa.allocatedAmount}` : '未核定分配金额'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* DR-057 v2.1 发票↔开发单双向闭环：反查引用本发票作为样品发票的开发单（可点击直达开发单详情） */}
          {isInvoice && invoice && linkedDevCases.length > 0 && (
            <div className="mt-4">
              <div className="rounded-inset p-4 bds-inset">
                <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>关联开发单（{linkedDevCases.length}）</div>
                <div className="mt-2 space-y-1.5">
                  {linkedDevCases.map(dc => (
                    <button
                      key={dc.id}
                      type="button"
                      onClick={() => {
                        if (!onNavigate) return;
                        primeCrossModuleNav({ view: View.Development, focusEntityId: dc.id });
                        onNavigate(View.Development);
                      }}
                      title="跳转到开发管理并直达该开发单详情"
                      className="rdl-data-row min-h-0 w-full justify-between px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--hover-darken)]"
                    >
                      <div className="min-w-0">
                        <div className={cx('truncate text-[11px] font-light', textPrimaryClass)}>
                          开发 {dc.code}
                        </div>
                        <div className={cx('mt-0.5 truncate text-[10px] font-light', textSecondaryClass)}>
                          {dc.name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* 交单回链：sourceInvoiceId 反查单据中心 CI（交单号=记账号），双向跳转的财务侧入口 */}
          {isInvoice && invoice && (
            <div className="mt-4">
              <div className="rounded-inset p-4 bds-inset">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>交单状态（单据中心）</div>
                  {invoiceTradeDoc && onOpenTradeDocument && (
                    <button type="button" onClick={() => onOpenTradeDocument(invoiceTradeDoc.id)} className="bds-btn bds-btn-secondary">
                      <FileText size={14} strokeWidth={1.75} />
                      查看交单
                    </button>
                  )}
                </div>
                {invoiceTradeDoc ? (
                  <div className="rdl-data-row mt-2 min-h-0 justify-between px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className={cx('truncate text-[11px] font-light', textPrimaryClass)}>
                        交单 {invoiceTradeDoc.documentNumber}（与记账号同号）
                      </div>
                      <div className={cx('mt-0.5 text-[10px] font-light', textSecondaryClass)}>
                        状态：{TRADE_DOC_STATUS_LABEL[invoiceTradeDoc.status] ?? invoiceTradeDoc.status}
                        {invoiceTradeDoc.issueDate ? ` · 签发日 ${invoiceTradeDoc.issueDate}` : ''}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={cx('mt-2 text-[11px] font-light leading-relaxed', textSecondaryClass)}>
                    尚未在单据中心登记交单。出货后可在单据中心「从运单生成」批量建档，商业发票将自动回链本发票（交单号=记账号）。
                  </div>
                )}
              </div>
            </div>
          )}
          {/* DR：发票附件——查看/下载 + 上传真实文件 */}
          {isInvoice && invoice && (
            <div className="mt-4">
              <div className="rounded-inset p-4 bds-inset">
                {/* 根因修复（2026-08-21）：原 flex justify-between + 固定 w-40 input
                    在 340~360px 详情 panel 下无法收缩，整行被撑破溢出。
                    改为 flex-wrap，input 用 min-w-0 flex-1 可收缩，窄宽时按钮自动换行。 */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>附件（{((Array.isArray((invoiceDetail as any)?.attachments) ? (invoiceDetail as any).attachments : []) as InvoiceAttachment[]).length}）</div>
                  {/* R6：附件上传 = 发票写操作，invoices:write 门控 */}
                  {canWriteInvoices && (
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:flex-none">
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                        className="bds-input min-w-0 flex-1 text-[10px] sm:w-40 sm:flex-none"
                        onChange={e => setInvoiceUpFile(e.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        disabled={invoiceUploading}
                        onClick={() => handleUploadInvoiceAttachment(invoice.id)}
                        className="bds-btn bds-btn-secondary"
                      >
                        <Upload size={14} strokeWidth={1.75} />
                        {invoiceUploading ? '上传中...' : '上传文件'}
                      </button>
                    </div>
                  )}
                </div>
                {invoiceAttachmentErr && (
                  <div className="bds-alert danger mt-2">{invoiceAttachmentErr}</div>
                )}
                {(() => {
                  const arts = (Array.isArray((invoiceDetail as any)?.attachments) ? (invoiceDetail as any).attachments : []) as InvoiceAttachment[];
                  if (arts.length === 0) {
                    return <div className={cx('mt-2 text-[11px] font-light', textSecondaryClass)}>暂无附件。上传发票文件以便归档留痕。</div>;
                  }
                  return (
                    <div className="mt-2 space-y-1.5">
                      {arts.map((att, idx) => (
                        <div key={`${att.fileName}-${idx}`} className="rdl-data-row min-h-0 justify-between px-2.5 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Paperclip size={14} strokeWidth={1.75} className={textSecondaryClass} />
                            <div className="min-w-0">
                              <div className={cx('truncate text-[11px] font-light', textPrimaryClass)}>{att.fileName}</div>
                              {att.fileSize != null && (
                                <div className={cx('mt-0.5 text-[10px] font-light', textSecondaryClass)}>
                                  {Math.round(att.fileSize / 1024)} KB{att.uploadedAt ? ` · ${new Date(att.uploadedAt).toLocaleString()}` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                          <button type="button" onClick={() => handleDownloadAttachment(att)}
                            className="bds-btn bds-btn-ghost bds-btn-icon">
                            <Download size={14} strokeWidth={1.75} />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          {/* P1 payment reconcile manual UI: 核销明细 + 手动核销入口 */}
          <div className="mt-4">
            <div className="rounded-inset p-4 bds-inset">
              {/* 根因修复（2026-08-21）：窄 panel 下 justify-between 单行若标题+按钮
                  同时较宽会挤爆，统一 flex-wrap 兜底。 */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>核销明细（{allocations.length}）</div>
                {/* R6：核销写入门控（发票上下文 = invoices:write；凭证上下文 = vouchers:write） */}
                {(isInvoiceContext ? canWriteInvoices : canWriteVouchers) && (
                  <button
                    type="button"
                    onClick={openCreateAlloc}
                    className="bds-btn bds-btn-secondary"
                  >
                    <Link2 size={16} strokeWidth={1.75} />
                    添加核销
                  </button>
                )}
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
                        {/* R6：核销编辑/删除与「添加核销」同一上下文权限门 */}
                        {(isInvoiceContext ? canWriteInvoices : canWriteVouchers) && (
                          <>
                            <button type="button" onClick={() => { setEditingAllocId(alloc.id); setAllocForm({ targetId: isInvoiceContext ? alloc.voucherId : alloc.invoiceId, appliedAmount: String(alloc.appliedAmount), appliedDate: alloc.appliedDate }); setAllocError(null); setShowAllocModal(true); }}
                              className="bds-btn bds-btn-ghost bds-btn-icon">
                              <Pencil size={14} strokeWidth={1.75} />
                            </button>
                            <button type="button" onClick={() => handleDeleteAlloc(alloc.id)}
                              className="bds-btn bds-btn-ghost bds-btn-icon">
                              <Trash2 size={14} strokeWidth={1.75} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* status 重算反馈提示 */}
              <div className={cx('mt-2 text-[10px] font-light', textSecondaryClass)}>
                当前状态：{statusLabel}（核销操作后由后端重算并自动更新）
              </div>
            </div>
          </div>
          {(() => {
            const relId = isInvoice
              ? (selectedItem as InvoiceEntity).customerRelationId
              : (selectedItem as VoucherEntity).customerRelationId;
            const relName = isInvoice
              ? (selectedItem as InvoiceEntity).customerName
              : (selectedItem as VoucherEntity).customerName;
            if (!relId) return null;
            return (
              <div className="mt-4">
                <RelatedWorkspacesSection
                  sourceType="relation"
                  relationId={relId}
                  relationName={relName ?? ''}
                  relationRole="customer"
                  onNavigate={onNavigate}
                  isDarkMode={isDarkMode}
                />
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  // ── Active tab toolbar chips ───
  const activeTypeOptions = activeTab === 'invoices' ? INVOICE_TYPES : activeTab === 'vatInvoices' ? VAT_DIRECTIONS : VOUCHER_TYPES;
  const activeStatusOptions = activeTab === 'invoices' ? INVOICE_STATUSES : activeTab === 'vatInvoices' ? VAT_STATUSES : VOUCHER_STATUSES;

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <PageHeader
        title="财务管理"
        subtitle="Invoices / Vouchers / Reconciliation"
        contextLabel={activeTab === 'invoices' ? 'Invoice Desk' : activeTab === 'vatInvoices' ? 'VAT Desk' : activeTab === 'reports' ? 'Finance Reports' : activeTab === 'cashCalendar' ? 'Cash Calendar' : activeTab === 'paymentRequests' ? 'Payment Requests' : activeTab === 'credit' ? 'Credit Control' : activeTab === 'reconciliation' ? 'Reconciliation' : activeTab === 'collections' ? 'Collections' : 'Voucher Desk'}
        isDarkMode={isDarkMode}
        actions={(
          <>
            {/* P0 payment manual path: 无 Agent 手动创建凭证入口（R6：vouchers:write 门控） */}
            {activeTab === 'vouchers' && canWriteVouchers && (
              <button
                type="button"
                className="bds-btn bds-btn-primary"
                onClick={() => { setEditingVoucher(null); setVoucherForm({ voucherNumber: '', type: 'Receipt', voucherCategory: 'normal', amount: '', currency: 'USD', paymentDate: '', paymentMethod: 'TT', customerName: '', customerRelationId: '', paymentRequestId: '' }); setVoucherError(null); setShowCreateVoucher(true); }}
              >
                <Plus size={16} strokeWidth={1.75} />
                新建凭证
              </button>
            )}
            {/* P0 invoice manual UI: 无 Agent 手动创建发票入口（R6：invoices:write 门控） */}
            {activeTab === 'invoices' && canWriteInvoices && (
              <button
                type="button"
                onClick={openCreateInvoice}
                className="bds-btn bds-btn-primary"
              >
                <Plus size={16} strokeWidth={1.75} />
                新建发票
              </button>
            )}
            {/* C6 增值税发票：手动登记入口（R6：vat:write 门控） */}
            {activeTab === 'vatInvoices' && canWriteVat && (
              <button
                type="button"
                onClick={openCreateVat}
                className="bds-btn bds-btn-primary"
              >
                <Plus size={16} strokeWidth={1.75} />
                新建增值税票
              </button>
            )}
          </>
        )}
      />

      {/* ── Main content: KPI → segment switcher → toolbar → table+panel ── */}
      <main className="min-h-0 flex-1 px-7 pb-5">
        <div className="flex h-full min-h-0 flex-col gap-2.5">

          {/* KPI row（shrink-0：固定摘要行不参与 flex 压缩，防止面板高度异常时被压扁、内容溢出盖住下方） */}
          <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
            {kpiCards.map(card => <KpiCard key={card.label} card={card} />)}
          </div>

          {/* Segment switcher */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="min-w-0 overflow-x-auto no-scrollbar">
              <div className="bds-segment">
                {FINANCE_TABS.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cx('seg', activeTab === tab.id && 'active')}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={cx('ml-auto text-[11px] font-light', textSecondaryClass)}>
              {activeTab === 'reports'
                ? '账龄 / 对账单 / 汇率损益 / 外汇台账'
                : activeTab === 'cashCalendar'
                  ? '今日动作 · 30 天预测 · 外汇敞口'
                  : activeTab === 'reconciliation'
                    ? '订单 ↔ 出运 ↔ 开票 ↔ 收款 四单勾稽'
                    : activeTab === 'paymentRequests'
                    ? '先申请后付款 · 审批链闭环'
                    : activeTab === 'credit'
                      ? '额度 / 冻结门禁 / 历史时间线'
                      : activeTab === 'collections'
                        ? '催款分级看板 · 催款函 · 月末结转'
                        : activeTab === 'vatInvoices'
                          ? `共 ${activeList.length} 张增值税票`
                          : (
                            <>
                              {`共 ${activeList.length} ${activeTab === 'invoices' ? '张发票' : '张凭证'}`}
                              {/* R3 诚实化：发票/收付款列表 = App 同步快照（非本组件直查），计数旁标注来源与快照总量 */}
                              <span className="ml-1" style={{ color: 'var(--text-quaternary)' }}>
                                （App 同步快照 {activeTab === 'invoices' ? invoices.length : vouchers.length} 条 · 随数据中心刷新）
                              </span>
                            </>
                          )}
            </div>
          </div>

          {/* 报表 tab：自包含面板（账龄 / 对账单 / 汇率损益 / 外汇台账） */}
          {activeTab === 'reports' && (
            <FinanceReportsPanel isDarkMode={isDarkMode} />
          )}

          {/* 资金日历 tab（REQ2-02）：自包含面板（今日动作 / 30 天预测 / 外汇敞口 / 预收款泳道） */}
          {activeTab === 'cashCalendar' && (
            <CashCalendarPanel isDarkMode={isDarkMode} />
          )}

          {/* 付款申请 tab：自包含面板（DR-017 先申请后付款 + 审批链） */}
          {activeTab === 'paymentRequests' && (
            <FinancePaymentRequestsPanel isDarkMode={isDarkMode} relations={relationOptions} />
          )}

          {/* 客户信用 tab：自包含面板（额度 / 冻结门禁 / CreditLimitHistory 时间线） */}
          {activeTab === 'credit' && (
            <FinanceCreditPanel isDarkMode={isDarkMode} relations={relationOptions} />
          )}

          {/* 对账 tab（W-B P2-6）：自包含面板（客户汇总卡 / 差异清单 / 单订单四单对照抽屉） */}
          {activeTab === 'reconciliation' && (
            <ReconciliationPanel isDarkMode={isDarkMode} relations={relationOptions} />
          )}

          {/* 催款月结 tab（I3 一级入口）：催款分级看板 / 催款函 + 月末结转，自报表子视图前置 */}
          {activeTab === 'collections' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain">
              <div className="bds-segment shrink-0 self-start">
                <button
                  type="button"
                  onClick={() => setCollectionsView('dunning')}
                  className={cx('seg', collectionsView === 'dunning' && 'active')}
                >
                  催款
                </button>
                <button
                  type="button"
                  onClick={() => setCollectionsView('monthlyClose')}
                  className={cx('seg', collectionsView === 'monthlyClose' && 'active')}
                >
                  月末结转
                </button>
              </div>
              {collectionsView === 'dunning' ? (
                <DunningStageBoardPanel
                  refreshKey={dunningRefreshKey}
                  onDun={(row) => setDunningRow(row)}
                />
              ) : (
                <MonthlyCloseSection isDarkMode={isDarkMode} />
              )}
            </div>
          )}

          {!isSelfContainedTab && (
          <>
          {navRelationFilter && (
            <NavRelationFilterChip filter={navRelationFilter} label={activeTab === 'vatInvoices' ? '增值税发票' : activeTab === 'invoices' ? '发票' : '收付款'} onClear={() => setNavRelationFilter(null)} />
          )}
          {/* Shared toolbar (chips adapt per tab) */}
          <div className="bds-filterbar">
              <div className="relative min-w-0 flex-[1_1_260px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={activeSearchPlaceholder}
                  className="bds-input sm pl-9"
                />
              </div>
              <div className="hidden h-4 w-px shrink-0 xl:block" style={{ background: 'var(--border-c-strong)' }} />
              <div className="bds-segment min-w-0 flex-[1_1_auto] overflow-x-auto">
                {activeTypeOptions.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedType(item.id)}
                    className={cx('seg shrink-0', selectedType === item.id && 'active')}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="bds-segment min-w-0 flex-[1_1_auto] overflow-x-auto">
                {activeStatusOptions.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedStatus(item.id)}
                    className={cx('seg shrink-0', selectedStatus === item.id && 'active')}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
          </div>

          {/* Table + side panel */}
          {/* 侧栏宽改为响应式 minmax(320px,360px)：原硬锁 340px 在窄 xl 视口下过小，
              配合按钮簇 flex-wrap 后留有余量，避免详情 panel 被挤压到内容溢出。 */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]" data-finance-layout="rdl-flush-table-canvas">
            <div className="bds-surface flex h-full min-h-0 flex-col overflow-hidden rounded-panel p-3">
                <div className={cx(TABLE_GRID_CLASS, 'min-w-0 px-4 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>
                  {columnHeaders.map(column => (
                    <div key={column.key} className="min-w-0">{column.label}</div>
                  ))}
                </div>
              <div ref={tableScrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-xs">
                {activeList.length > 0
                  ? (activeTab === 'invoices'
                      ? (activeList as InvoiceEntity[]).map((item) => renderInvoiceRow(item))
                      : activeTab === 'vatInvoices'
                        ? (activeList as VatInvoiceEntity[]).map((item) => renderVatRow(item))
                        : (activeList as VoucherEntity[]).map((item) => renderVoucherRow(item)))
                  : renderEmptyState()}
              </div>
            </div>

            <div className="bds-surface flex h-full min-h-0 flex-col overflow-hidden rounded-panel">
              {renderSidePanel()}
            </div>
          </div>
          </>
          )}
        </div>
      </main>

      {/* P0 payment manual path: 创建凭证 modal */}
      {showCreateVoucher && (
        <div className="bds-modal-mask" onClick={() => !voucherCreating && setShowCreateVoucher(false)}>
          <div className="bds-modal" style={{ width: '28rem' }} onClick={e => e.stopPropagation()}>
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
                  <CustomSelect surface="form" size="compact" value={voucherForm.type}
                    onChange={v => setVoucherForm(f => ({ ...f, type: v as 'Receipt' | 'Disbursement', customerRelationId: '', paymentRequestId: '' }))}
                    options={[{ value: 'Receipt', label: '收款' }, { value: 'Disbursement', label: '付款' }]} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>金额 *</label>
                  <input type="number" value={voucherForm.amount} onChange={e => setVoucherForm(f => ({ ...f, amount: e.target.value }))}
                    className={formInputClass} />
                </div>
              </div>
              {/* I1 付款入口引导（DR-017 先申请后付款）：新建付款凭证必须先选已批准的付款申请，
                  下拉即唯一合法数据源；无申请时明确指引去「付款申请」页签，不再填完一屏才撞门禁 */}
              {voucherForm.type === 'Disbursement' && !editingVoucher && (
                <div className="rounded-field bg-[var(--recessed-bg)] px-4 py-3">
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>关联付款申请 *（先申请后付款）</label>
                  {payableRequests.length > 0 ? (
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={voucherForm.paymentRequestId}
                      onChange={v => handleSelectPaymentRequest(v)}
                      options={[
                        { value: '', label: '请选择已批准的付款申请' },
                        ...payableRequests.map(pr => ({
                          value: pr.id,
                          label: `${pr.requestNumber} · ${pr.supplierName || '未填供应商'} · ${formatAmount(Number(pr.totalAmount), pr.currency)}`,
                        })),
                      ]}
                    />
                  ) : (
                    <div className={cx('text-[11px] font-light', textSecondaryClass)}>
                      {payableRequestsLoading ? '正在加载已批准的付款申请…' : '暂无已批准未付款的付款申请。'}
                    </div>
                  )}
                  <div className={cx('mt-2 text-[11px] font-light', textSecondaryClass)}>
                    付款凭证必须关联审批通过的付款申请，未关联将无法创建。尚无申请？请先到「付款申请」页签提交并获批。
                    <button
                      type="button"
                      onClick={() => { setShowCreateVoucher(false); setActiveTab('paymentRequests'); }}
                      className="ml-1 text-link"
                    >
                      前往付款申请
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>凭证分类</label>
                <CustomSelect surface="form" size="compact" value={voucherForm.voucherCategory}
                  onChange={v => setVoucherForm(f => ({ ...f, voucherCategory: v as VoucherCategory }))}
                  options={VOUCHER_CATEGORIES.map(c => ({ value: c, label: VOUCHER_CATEGORY_LABELS[c] }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>币种</label>
                  <input value={voucherForm.currency} onChange={e => setVoucherForm(f => ({ ...f, currency: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>付款方式</label>
                  <CustomSelect surface="form" size="compact" value={voucherForm.paymentMethod}
                    onChange={v => setVoucherForm(f => ({ ...f, paymentMethod: v }))}
                    options={[{ value: 'TT', label: 'TT' }, { value: 'LC', label: 'LC' }, { value: 'Cash', label: 'Cash' }, { value: 'Other', label: 'Other' }]} />
                </div>
              </div>
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>交易对象档案</label>
                {/* R678：原生 select 全量渲染（上限 500 条不可搜索）→ 可搜索 combobox，超 50 条截断提示 */}
                <RelationPickerCombobox
                  value={voucherForm.customerRelationId}
                  options={relationOptionsFor(voucherForm.type === 'Receipt' ? 'Customer' : 'Supplier')}
                  emptyOptionLabel="手动输入（不关联档案）"
                  ariaLabel="交易对象档案"
                  onChange={(rid, rel) => setVoucherForm(f => ({ ...f, customerRelationId: rid, customerName: rel ? relationDisplayName(rel) : f.customerName }))}
                />
              </div>
              {!voucherForm.customerRelationId && (
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>交易对象名称</label>
                  <input value={voucherForm.customerName} onChange={e => setVoucherForm(f => ({ ...f, customerName: e.target.value }))}
                    className={formInputClass} />
                </div>
              )}
              {voucherError && <div className="bds-alert danger">{voucherError}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={voucherCreating} onClick={() => setShowCreateVoucher(false)}
                className="bds-btn bds-btn-secondary">取消</button>
              <button type="button" disabled={voucherCreating} onClick={editingVoucher ? handleSaveVoucher : handleCreateVoucher}
                className="bds-btn bds-btn-primary">
                {voucherCreating ? '保存中...' : editingVoucher ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* I3 催款函 BottomSheet（催款月结 tab 分级看板行「催款」一键发起；关闭后刷新看板行） */}
      {dunningRow && (
        <DunningSheet
          key={`${dunningRow.customerName}-${dunningRow.currency}-${dunningRow.stage ?? 'auto'}`}
          open={!!dunningRow}
          onClose={() => { setDunningRow(null); setDunningRefreshKey(k => k + 1); }}
          customerRelationId={dunningRow.customerRelationId}
          customerName={dunningRow.customerName}
          currency={dunningRow.currency}
          stage={dunningRow.stage}
        />
      )}

      {/* 发票预览弹窗——全站共享 A4 纸张查看器（B1 架构底座）：
          iframe 渲染 GET /:id/preview.html 同源模板，与导出 PDF 同源所见即所得 */}
      {previewingInvoice && (
        <A4DocumentPreviewModal
          title={`发票预览 · ${previewingInvoice.invoiceNumber}`}
          subtitle="A4 · 与导出 PDF 同源渲染，所见即所得"
          html={invoicePreviewHtml}
          loading={invoicePreviewLoading}
          error={invoicePreviewErr}
          onClose={() => setPreviewingInvoice(null)}
          onPrint={() => void handleExportInvoicePdf(previewingInvoice)}
          printLabel="导出 PDF"
        />
      )}

      {/* P0 invoice manual UI: 创建/编辑发票 modal */}
      {showInvoiceModal && (
        <div className="bds-modal-mask" onClick={() => !invoiceSaving && setShowInvoiceModal(false)}>
          <div className="bds-modal" style={{ width: '28rem' }} onClick={e => e.stopPropagation()}>
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
                  <CustomSelect surface="form" size="compact" value={invoiceForm.type}
                    onChange={v => setInvoiceForm(f => ({ ...f, type: v as 'Receivable' | 'Payable', customerRelationId: '' }))}
                    options={[{ value: 'Receivable', label: '应收' }, { value: 'Payable', label: '应付' }]} />
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
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>{invoiceForm.type === 'Payable' ? '供应商档案' : '客户档案'}</label>
                  {/* R678：原生 select 全量渲染 → 可搜索 combobox（同凭证弹窗交易对象） */}
                  <RelationPickerCombobox
                    value={invoiceForm.customerRelationId}
                    options={relationOptionsFor(invoiceForm.type === 'Receivable' ? 'Customer' : 'Supplier')}
                    emptyOptionLabel="手动输入（不关联档案）"
                    ariaLabel={invoiceForm.type === 'Payable' ? '供应商档案' : '客户档案'}
                    onChange={(rid, rel) => setInvoiceForm(f => ({ ...f, customerRelationId: rid, customerName: rel ? relationDisplayName(rel) : f.customerName }))}
                  />
                </div>
                {!invoiceForm.customerRelationId && (
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>{invoiceForm.type === 'Payable' ? '供应商名称' : '客户名称'}</label>
                    <input value={invoiceForm.customerName} onChange={e => setInvoiceForm(f => ({ ...f, customerName: e.target.value }))}
                      className={formInputClass} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>发票日期</label>
                  <CapsuleDateInput value={invoiceForm.issueDate} onChange={v => setInvoiceForm(f => ({ ...f, issueDate: v }))} className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>到期日</label>
                  <CapsuleDateInput value={invoiceForm.dueDate} onChange={v => setInvoiceForm(f => ({ ...f, dueDate: v }))} className={formInputClass} />
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
                <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>关联订单（多选）</label>
                {orderOptions.length === 0 ? (
                  <input value={invoiceForm.orderId} onChange={e => setInvoiceForm(f => ({ ...f, orderId: e.target.value }))}
                    placeholder="订单列表不可用时可手动输入 1 个订单 ID"
                    className={formInputClass} />
                ) : (
                  <div className="bds-inset max-h-28 space-y-1 overflow-y-auto rounded-field p-1.5">
                    {orderOptions.map(o => {
                      const checked = invoiceForm.orderIds.includes(o.id);
                      return (
                        <label key={o.id} className="flex items-center gap-2 py-0.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setInvoiceForm(f => ({
                              ...f,
                              orderIds: checked ? f.orderIds.filter(id => id !== o.id) : [...f.orderIds, o.id],
                            }))}
                            className="bds-checkbox"
                          />
                          <span className={cx('truncate text-[11px] font-light', checked ? textPrimaryClass : textSecondaryClass)}>
                            {o.customer || o.id.slice(-8)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
              {invoiceError && <div className="bds-alert danger">{invoiceError}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={invoiceSaving} onClick={() => setShowInvoiceModal(false)}
                className="bds-btn bds-btn-secondary">取消</button>
              {!editingInvoice && (
                <button type="button" disabled={invoiceSaving} onClick={async () => {
                  // R678：status 以入参直传（不再依赖 setInvoiceForm 后的状态时序）
                  setInvoiceForm(f => ({ ...f, status: 'Issued' as InvoiceStatus }));
                  await handleSaveInvoice('Issued' as InvoiceStatus);
                }}
                  className="bds-btn bds-btn-secondary">
                  保存并开票
                </button>
              )}
              <button type="button" disabled={invoiceSaving} onClick={() => void handleSaveInvoice()}
                className="bds-btn bds-btn-primary">
                {invoiceSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* P1 payment reconcile manual UI: 核销 modal */}
      {showAllocModal && (
        <div className="bds-modal-mask" onClick={() => !allocSaving && setShowAllocModal(false)}>
          <div className="bds-modal" style={{ width: '28rem' }} onClick={e => e.stopPropagation()}>
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
                  <CustomSelect surface="form" size="compact" value={allocForm.targetId}
                    onChange={v => setAllocForm(f => ({ ...f, targetId: v }))}
                    options={[
                      { value: '', label: `请选择${isInvoiceContext ? '凭证' : '发票'}` },
                      ...(isInvoiceContext ? vouchers : invoices).map((item: any) => ({
                        value: item.id,
                        label: isInvoiceContext ? `${item.voucherNumber} · ${formatAmount(item.amount, item.currency)}` : `${item.invoiceNumber} · ${formatAmount(item.amount, item.currency)}`,
                      })),
                    ]} />
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
                  <CapsuleDateInput value={allocForm.appliedDate} onChange={v => setAllocForm(f => ({ ...f, appliedDate: v }))} className={formInputClass} />
                </div>
              </div>
              {allocError && <div className="bds-alert danger">{allocError}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={allocSaving} onClick={() => setShowAllocModal(false)}
                className="bds-btn bds-btn-secondary">取消</button>
              <button type="button" disabled={allocSaving} onClick={handleSaveAlloc}
                className="bds-btn bds-btn-primary">
                {allocSaving ? '核销中...' : '确认核销'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* F2 外汇核销闭环：结汇 modal（核销摘要 + 结汇记录 + 登记表单） */}
      {settlementVoucher && (
        <div className="bds-modal-mask" onClick={() => !settlementSaving && setSettlementVoucher(null)}>
          <div className="bds-modal flex max-h-[85vh] flex-col" style={{ width: '32rem' }} onClick={e => e.stopPropagation()}>
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
                <div key={card.label} className="rounded-inset p-3 bds-inset">
                  <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>{card.label}</div>
                  {/* 中性材质对比表达强调（Finance 页面禁用语义色族）：未结清用主色，结清降为次级 */}
                  <div className={cx('mt-1 text-sm font-light tabular-nums', card.accent && settlementSummary?.fullySettled ? textSecondaryClass : textPrimaryClass)}>
                    {settlementLoading ? '加载中…' : card.value}
                  </div>
                </div>
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
                    <div key={s.id} className="flex items-center gap-2 rounded-control px-3 py-2 bds-inset">
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
                      <button
                        type="button"
                        disabled={settlementDeletingId === s.id}
                        onClick={() => handleDeleteSettlement(s.id, s.settlementNumber)}
                        title="删除结汇水单（回滚未结汇余额）"
                        className="bds-btn bds-btn-ghost bds-btn-icon"
                      >
                        {settlementDeletingId === s.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.75} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 登记结汇表单 */}
              {(!settlementSummary || !settlementSummary.fullySettled) && (
                <div className="rounded-field p-3" style={{ border: 'var(--border-subtle)' }}>
                  <div className={cx('mb-2 text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>登记结汇</div>
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>结汇日期 *</label>
                        <CapsuleDateInput value={settlementForm.settleDate} onChange={v => setSettlementForm(f => ({ ...f, settleDate: v }))} className={formInputClass} />
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

              {settlementError && <div className="bds-alert danger">{settlementError}</div>}
            </div>

            <div className="mt-3 flex shrink-0 justify-end gap-2">
              <button type="button" disabled={settlementSaving} onClick={() => setSettlementVoucher(null)}
                className="bds-btn bds-btn-secondary">关闭</button>
              {(!settlementSummary || !settlementSummary.fullySettled) && (
                <button type="button" disabled={settlementSaving || settlementLoading} onClick={handleCreateSettlement}
                  className="bds-btn bds-btn-primary">
                  {settlementSaving ? '登记中…' : '登记结汇'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* C6 增值税发票：创建/编辑 modal（编辑时 vatNumber/direction/invoiceType 服务端不可变，仅票面修正） */}
      {showVatModal && (
        <div className="bds-modal-mask" onClick={() => !vatSaving && setShowVatModal(false)}>
          <div className="bds-modal flex max-h-[85vh] flex-col" style={{ width: '32rem' }} onClick={e => e.stopPropagation()}>
            <h2 className={cx('mb-3 shrink-0 text-[13px] font-light tracking-[0.02em]', textPrimaryClass)}>
              {editingVat ? `编辑增值税发票 · ${editingVat.vatNumber}` : '新建增值税发票'}
            </h2>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>发票号码 *</label>
                  <input value={vatForm.vatNumber} disabled={!!editingVat} onChange={e => setVatForm(f => ({ ...f, vatNumber: e.target.value }))}
                    placeholder="02345678"
                    className={cx(formInputClass, editingVat && 'opacity-50')} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>发票代码（纸质票）</label>
                  <input value={vatForm.vatCode} onChange={e => setVatForm(f => ({ ...f, vatCode: e.target.value }))}
                    placeholder="可选"
                    className={formInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>方向</label>
                  <CustomSelect surface="form" size="compact" value={vatForm.direction} disabled={!!editingVat}
                    onChange={v => setVatForm(f => ({ ...f, direction: v as VatInvoiceDirection }))}
                    options={[{ value: 'Input', label: '进项' }, { value: 'Output', label: '销项' }]} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>票种</label>
                  <CustomSelect surface="form" size="compact" value={vatForm.invoiceType} disabled={!!editingVat}
                    onChange={v => setVatForm(f => ({ ...f, invoiceType: v as VatInvoiceType }))}
                    options={[{ value: 'Special', label: '专票' }, { value: 'Normal', label: '普票' }]} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>销售方 *</label>
                  <input value={vatForm.sellerName} onChange={e => setVatForm(f => ({ ...f, sellerName: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>销售方税号</label>
                  <input value={vatForm.sellerTaxNo} onChange={e => setVatForm(f => ({ ...f, sellerTaxNo: e.target.value }))}
                    placeholder="可选"
                    className={formInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>购买方 *</label>
                  <input value={vatForm.buyerName} onChange={e => setVatForm(f => ({ ...f, buyerName: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>购买方税号</label>
                  <input value={vatForm.buyerTaxNo} onChange={e => setVatForm(f => ({ ...f, buyerTaxNo: e.target.value }))}
                    placeholder="可选"
                    className={formInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>开票日期 *</label>
                  <CapsuleDateInput value={vatForm.issueDate} onChange={v => setVatForm(f => ({ ...f, issueDate: v }))} className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>抵扣所属期（YYYY-MM）</label>
                  <input value={vatForm.deductionPeriod} onChange={e => setVatForm(f => ({ ...f, deductionPeriod: e.target.value }))}
                    placeholder="2026-08"
                    className={formInputClass} />
                </div>
              </div>
              {/* 金额三栏 + 税率：服务端校验 totalAmount ≈ netAmount + taxAmount（容忍 ±0.01） */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>不含税金额 *</label>
                  <input type="number" step="0.0001" value={vatForm.netAmount} onChange={e => setVatForm(f => ({ ...f, netAmount: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>税率（%）*</label>
                  <input type="number" step="0.01" value={vatForm.taxRate} onChange={e => setVatForm(f => ({ ...f, taxRate: e.target.value }))}
                    placeholder="13"
                    className={formInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>税额 *</label>
                  <input type="number" step="0.0001" value={vatForm.taxAmount} onChange={e => setVatForm(f => ({ ...f, taxAmount: e.target.value }))}
                    className={formInputClass} />
                </div>
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>价税合计 *</label>
                  <input type="number" step="0.0001" value={vatForm.totalAmount} onChange={e => setVatForm(f => ({ ...f, totalAmount: e.target.value }))}
                    className={formInputClass} />
                </div>
              </div>
              <div>
                <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>备注</label>
                <input value={vatForm.notes} onChange={e => setVatForm(f => ({ ...f, notes: e.target.value }))}
                  className={formInputClass} />
              </div>
              {vatError && <div className="bds-alert danger">{vatError}</div>}
            </div>
            <div className="mt-3 flex shrink-0 justify-end gap-2">
              <button type="button" disabled={vatSaving} onClick={() => setShowVatModal(false)}
                className="bds-btn bds-btn-secondary">取消</button>
              <button type="button" disabled={vatSaving} onClick={handleSaveVat}
                className="bds-btn bds-btn-primary">
                {vatSaving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C6 增值税发票：状态机流转 modal（认证 / 申报退税 / 红冲，消费后端稳定状态机） */}
      {vatTransitionTarget && (
        <div className="bds-modal-mask" onClick={() => !vatTransitionSaving && setVatTransitionTarget(null)}>
          <div className="bds-modal" style={{ width: '28rem' }} onClick={e => e.stopPropagation()}>
            <h2 className={cx('mb-1 text-[13px] font-light tracking-[0.02em]', textPrimaryClass)}>
              {VAT_TRANSITION_LABELS[vatTransitionAction]} · {vatTransitionTarget.vatNumber}
            </h2>
            <div className={cx('mb-4 text-[11px] font-light', textSecondaryClass)}>
              {VAT_STATUS_LABELS[vatTransitionTarget.status]} → {VAT_STATUS_LABELS[vatTransitionAction]}
            </div>
            <div className="space-y-3">
              {vatTransitionAction === 'Verified' && (
                <>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>勾选认证日期</label>
                    <CapsuleDateInput value={vatTransitionForm.verifiedDate} onChange={v => setVatTransitionForm(f => ({ ...f, verifiedDate: v }))} className={formInputClass} />
                  </div>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>抵扣所属期（YYYY-MM）</label>
                    <input value={vatTransitionForm.deductionPeriod} onChange={e => setVatTransitionForm(f => ({ ...f, deductionPeriod: e.target.value }))}
                      placeholder="2026-08"
                      className={formInputClass} />
                  </div>
                </>
              )}
              {vatTransitionAction === 'Declared' && (
                <div>
                  <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>退税申报单 *</label>
                  <CustomSelect surface="form" size="compact" value={vatTransitionForm.taxRefundId}
                    onChange={v => setVatTransitionForm(f => ({ ...f, taxRefundId: v }))}
                    disabled={vatRefundOptionsLoading}
                    options={[
                      { value: '', label: vatRefundOptionsLoading ? '加载退税申报单…' : '请选择退税申报单' },
                      ...vatRefundOptions.map(r => ({
                        value: r.id,
                        label: `${r.refundNumber} · ${TAX_REFUND_STATUS_LABELS[r.status] || r.status}${r.refundableVat != null ? ` · 可退 ${formatAmount(Number(r.refundableVat), 'CNY')}` : ''}`,
                      })),
                    ]} />
                  {!vatRefundOptionsLoading && vatRefundOptions.length === 0 && (
                    <div className={cx('mt-1 text-[10px] font-light', textSecondaryClass)}>
                      暂无可用退税申报单，请先在 关务 → 出口退税 页签创建
                    </div>
                  )}
                </div>
              )}
              {vatTransitionAction === 'RedFlushed' && (
                <>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>红字发票号</label>
                    <input value={vatTransitionForm.redFlushNumber} onChange={e => setVatTransitionForm(f => ({ ...f, redFlushNumber: e.target.value }))}
                      placeholder="可选"
                      className={formInputClass} />
                  </div>
                  <div>
                    <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>红冲日期</label>
                    <CapsuleDateInput value={vatTransitionForm.redFlushDate} onChange={v => setVatTransitionForm(f => ({ ...f, redFlushDate: v }))} className={formInputClass} />
                  </div>
                </>
              )}
              {vatTransitionError && <div className="bds-alert danger">{vatTransitionError}</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={vatTransitionSaving} onClick={() => setVatTransitionTarget(null)}
                className="bds-btn bds-btn-secondary">取消</button>
              <button type="button" disabled={vatTransitionSaving} onClick={handleVatTransition}
                className="bds-btn bds-btn-primary">
                {vatTransitionSaving ? '流转中…' : `确认${VAT_TRANSITION_LABELS[vatTransitionAction]}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C6 付汇闭环：付汇核销 modal（镜像结汇 modal，消费 /v1/finance/outward-remittances contract） */}
      {remittanceVoucher && (
        <div className="bds-modal-mask" onClick={() => !remittanceSaving && setRemittanceVoucher(null)}>
          <div className="bds-modal flex max-h-[85vh] flex-col" style={{ width: '32rem' }} onClick={e => e.stopPropagation()}>
            <h2 className={cx('mb-3 text-[13px] font-light tracking-[0.02em]', textPrimaryClass)}>
              付汇核销 · {remittanceVoucher.voucherNumber}
              <span className={cx('ml-2 text-[11px]', textSecondaryClass)}>{remittanceVoucher.customerName || '—'}</span>
            </h2>

            {/* 付汇摘要（服务端真源） */}
            <div className="grid shrink-0 grid-cols-3 gap-2">
              {([
                { label: '凭证金额', value: remittanceSummary ? formatAmount(Number(remittanceSummary.voucherAmount), remittanceSummary.currency) : '—' },
                { label: '已付汇', value: remittanceSummary ? formatAmount(Number(remittanceSummary.remittedAmount), remittanceSummary.currency) : '—' },
                { label: '未付汇余额', value: remittanceSummary ? formatAmount(Number(remittanceSummary.remainingAmount), remittanceSummary.currency) : '—', accent: true },
              ]).map(card => (
                <div key={card.label} className="rounded-inset p-3 bds-inset">
                  <div className={cx('text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>{card.label}</div>
                  {/* 中性材质对比表达强调（Finance 页面禁用语义色族）：未付清用主色，付清降为次级 */}
                  <div className={cx('mt-1 text-sm font-light tabular-nums', card.accent && remittanceSummary?.fullyRemitted ? textSecondaryClass : textPrimaryClass)}>
                    {remittanceLoading ? '加载中…' : card.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
              {/* 付汇记录 */}
              <div>
                <div className={cx('mb-1.5 text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>
                  付汇记录{remittanceSummary ? `（${remittanceSummary.remittances.length} 笔）` : ''}
                </div>
                {remittanceSummary && remittanceSummary.remittances.length === 0 && (
                  <div className={cx('py-3 text-center text-[11px] font-light', textSecondaryClass)}>暂无付汇记录</div>
                )}
                <div className="space-y-1">
                  {remittanceSummary?.remittances.map(r => (
                    <div key={r.id} className="flex items-center gap-2 rounded-control px-3 py-2 bds-inset">
                      <div className="min-w-0 flex-1">
                        <div className={cx('truncate text-[11px] font-light', textPrimaryClass)}>
                          {r.remitDate}
                          <span className={cx('ml-2 text-[10px]', textSecondaryClass)}>{r.remittanceNumber}</span>
                        </div>
                        <div className={cx('mt-0.5 truncate text-[10px] font-light tabular-nums', textSecondaryClass)}>
                          {formatAmount(Number(r.foreignAmount), r.currency)} × {Number(r.fxRate)} = {formatAmount(Number(r.cnyAmount), 'CNY')}
                          {r.purpose ? ` · ${remittancePurposeLabel(r.purpose)}` : ''}{r.bank ? ` · ${r.bank}` : ''}{r.slipNumber ? ` · 水单 ${r.slipNumber}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={remittanceDeletingId === r.id}
                        onClick={() => handleDeleteRemittance(r.id, r.remittanceNumber)}
                        title="删除付汇水单（回滚未付汇余额）"
                        className="bds-btn bds-btn-ghost bds-btn-icon"
                      >
                        {remittanceDeletingId === r.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.75} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 登记付汇表单 */}
              {(!remittanceSummary || !remittanceSummary.fullyRemitted) && (
                <div className="rounded-field p-3" style={{ border: 'var(--border-subtle)' }}>
                  <div className={cx('mb-2 text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>登记付汇</div>
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>付汇日期 *</label>
                        <CapsuleDateInput value={remittanceForm.remitDate} onChange={v => setRemittanceForm(f => ({ ...f, remitDate: v }))} className={formInputClass} />
                      </div>
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>付汇外币金额（{remittanceVoucher.currency}）*</label>
                        <input type="number" step="0.0001" value={remittanceForm.foreignAmount} onChange={e => setRemittanceForm(f => ({ ...f, foreignAmount: e.target.value }))}
                          placeholder={remittanceSummary ? `未付汇 ${remittanceSummary.remainingAmount}` : ''}
                          className={formInputClass} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>付汇汇率（{remittanceVoucher.currency} → CNY）*</label>
                        <input type="number" step="0.00000001" value={remittanceForm.fxRate} onChange={e => setRemittanceForm(f => ({ ...f, fxRate: e.target.value }))}
                          placeholder="7.12345678"
                          className={formInputClass} />
                      </div>
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>付汇用途</label>
                        <CustomSelect surface="form" size="compact" value={remittanceForm.purpose}
                          onChange={v => setRemittanceForm(f => ({ ...f, purpose: v }))}
                          options={REMITTANCE_PURPOSE_OPTIONS.map(o => ({ value: o.id, label: o.label }))} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>收款人名称</label>
                        <input value={remittanceForm.payeeName} onChange={e => setRemittanceForm(f => ({ ...f, payeeName: e.target.value }))}
                          className={formInputClass} />
                      </div>
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>付汇银行</label>
                        <input value={remittanceForm.bank} onChange={e => setRemittanceForm(f => ({ ...f, bank: e.target.value }))}
                          placeholder="中国银行"
                          className={formInputClass} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>银行水单号</label>
                        <input value={remittanceForm.slipNumber} onChange={e => setRemittanceForm(f => ({ ...f, slipNumber: e.target.value }))}
                          className={formInputClass} />
                      </div>
                      <div>
                        <label className={cx('mb-1 block text-[11px] font-light', textSecondaryClass)}>备注</label>
                        <input value={remittanceForm.notes} onChange={e => setRemittanceForm(f => ({ ...f, notes: e.target.value }))}
                          className={formInputClass} />
                      </div>
                    </div>
                    {/* 折人民币预览（本地估算，真源以服务端计算为准） */}
                    {Number(remittanceForm.foreignAmount) > 0 && Number(remittanceForm.fxRate) > 0 && (
                      <div className={cx('text-[11px] font-light tabular-nums', textSecondaryClass)}>
                        折人民币约 {formatAmount(Number(remittanceForm.foreignAmount) * Number(remittanceForm.fxRate), 'CNY')}（以服务端计算为准）
                      </div>
                    )}
                  </div>
                </div>
              )}

              {remittanceError && <div className="bds-alert danger">{remittanceError}</div>}
            </div>

            <div className="mt-3 flex shrink-0 justify-end gap-2">
              <button type="button" disabled={remittanceSaving} onClick={() => setRemittanceVoucher(null)}
                className="bds-btn bds-btn-secondary">关闭</button>
              {(!remittanceSummary || !remittanceSummary.fullyRemitted) && (
                <button type="button" disabled={remittanceSaving || remittanceLoading} onClick={handleCreateRemittance}
                  className="bds-btn bds-btn-primary">
                  {remittanceSaving ? '登记中…' : '登记付汇'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceManager;
