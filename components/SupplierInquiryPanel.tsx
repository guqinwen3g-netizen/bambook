/**
 * 供应商询价比价面板 SupplierInquiryPanel
 * 卡点 3：供应商询价比价（剧本 2.10 验收点）
 *
 * 功能：
 *   - 询价单列表（状态过滤、搜索、卡片展开）
 *   - 创建询价单（品名描述、物料编码、数量、单位、币种、期望交期、采购员、备注）
 *   - 供应商报价管理（增删改，仅 Open 状态）
 *   - 比价决策（选定中选供应商 + 决策备注 → Compared）
 *   - 关闭询价（Compared → Closed）
 *   - 基准金额 baseAmount 横向比价（最低基准高亮）
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  X,
  CheckCircle2,
  Scale,
  Pencil,
  Undo2,
  FileText,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  SupplierInquiry,
  SupplierInquiryStatus,
  SupplierInquiryInput,
  SupplierQuoteInput,
  SupplierQuoteItem,
  FactoryProfile,
} from '../types';
import CapsuleDateInput from './ui/CapsuleDateInput';

// ==================== 常量 ====================

type StatusTab = 'all' | SupplierInquiryStatus;

const STATUS_TABS: Array<{ id: StatusTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'Open', label: '询价中' },
  { id: 'Compared', label: '已比价' },
  { id: 'Closed', label: '已关闭' },
];

const STATUS_LABELS: Record<SupplierInquiryStatus, string> = {
  Open: '询价中',
  Compared: '已比价',
  Closed: '已关闭',
};

// BDS v2.1：状态 → bds-badge 语义变体
const STATUS_BADGE_VARIANT: Record<SupplierInquiryStatus, 'neutral' | 'info' | 'success'> = {
  Open: 'info',
  Compared: 'success',
  Closed: 'neutral',
};

const CURRENCIES = ['USD', 'CNY', 'EUR'];
const UNITS = ['YD', 'M', 'KG', 'PC', 'SET'];

// ==================== 类型 ====================

/** C7：询价转采购单预填草稿（由宿主 ProcurementManager 消费） */
export interface SupplierInquiryConvertDraft {
  inquiryNumber: string;
  currency: string;
  supplierRelationId?: string;
  supplierName?: string;
  expectedDeliveryDate?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  buyer?: string;
  line: {
    materialCode?: string;
    description: string;
    quantity?: number;
    unit?: string;
  };
}

interface SupplierInquiryPanelProps {
  isDarkMode: boolean;
  /** C7：已比价询价单一键转采购单（宿主 ProcurementManager 提供；缺省不展示入口） */
  onConvertToPurchaseOrder?: (draft: SupplierInquiryConvertDraft) => void;
}

interface QuoteFormState {
  /** 供应商档案 relationId（B2：报价供应商必须从档案选择，禁止手打名称绕过黑名单） */
  supplierId: string;
  quoteAmount: string;
  currency: string;
  exchangeRate: string;
  quoteDate: string;
  deliveryTerms: string;
  paymentTerms: string;
  expectedDeliveryDate: string;
  notes: string;
}

interface CreateFormState {
  description: string;
  materialCode: string;
  quantity: string;
  unit: string;
  currency: string;
  expectedDeliveryDate: string;
  buyer: string;
  notes: string;
}

// ==================== 工厂函数 ====================

const createEmptyQuoteForm = (): QuoteFormState => ({
  supplierId: '',
  quoteAmount: '',
  currency: 'USD',
  exchangeRate: '',
  quoteDate: new Date().toISOString().split('T')[0],
  deliveryTerms: '',
  paymentTerms: '',
  expectedDeliveryDate: '',
  notes: '',
});

const createEmptyCreateForm = (): CreateFormState => ({
  description: '',
  materialCode: '',
  quantity: '',
  unit: 'YD',
  currency: 'USD',
  expectedDeliveryDate: '',
  buyer: '',
  notes: '',
});

// ==================== 工具函数 ====================

const formatAmount = (n: number, currency: string): string =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const formatDate = (s?: string): string => s || '—';

/** createdAt/updatedAt 为后端 BigInt 序列化的字符串，兼容时间戳与 ISO 日期 */
const formatTimestamp = (s?: string): string => {
  if (!s) return '—';
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) {
      const d = new Date(n);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }
  }
  return s.length > 10 ? s.substring(0, 10) : s;
};

/** 在多条报价中找到基准金额最低的一条 id（用于比价高亮） */
const getLowestBaseAmountId = (quotes: SupplierQuoteItem[]): string | null => {
  const withBase = quotes.filter(q => q.baseAmount != null);
  if (withBase.length < 2) return null;
  let min = Number(withBase[0].baseAmount);
  let minId = withBase[0].id;
  for (const q of withBase) {
    const v = Number(q.baseAmount);
    if (v < min) {
      min = v;
      minId = q.id;
    }
  }
  return minId;
};

// ==================== 组件 ====================

const SupplierInquiryPanel: React.FC<SupplierInquiryPanelProps> = ({ isDarkMode: _isDarkMode, onConvertToPurchaseOrder }) => {
  const [inquiries, setInquiries] = useState<SupplierInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // 创建表单
  const [createForm, setCreateForm] = useState<CreateFormState>(createEmptyCreateForm);
  const [createError, setCreateError] = useState<string | null>(null);

  // 报价表单（当前展开的询价）
  const [quoteForm, setQuoteForm] = useState<QuoteFormState>(createEmptyQuoteForm);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // B2：报价供应商下拉数据源 — 供应商档案（仅未拉黑；名称真源在 Relation）
  const [supplierOptions, setSupplierOptions] = useState<FactoryProfile[]>([]);

  // 比价决策
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
  const labelCls = 'block text-xs mb-1 text-[var(--text-tertiary)]';

  // ── 拉取数据 ──
  const fetchInquiries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listSupplierInquiries({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: searchQuery || undefined,
        limit: 100,
      });
      setInquiries(result.items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  // ── 拉取供应商档案（报价下拉框数据源，blacklisted=false 过滤黑名单） ──
  useEffect(() => {
    let cancelled = false;
    apiService.listFactoryProfiles({ blacklisted: false, limit: 200 })
      .then((result) => { if (!cancelled) setSupplierOptions(result.items); })
      .catch(() => { if (!cancelled) setSupplierOptions([]); });
    return () => { cancelled = true; };
  }, []);

  // ── 展开/折叠 ──
  const handleExpand = useCallback((inquiryId: string) => {
    setExpandedId(prev => {
      if (prev === inquiryId) return null;
      // 切换询价时重置报价表单与决策状态
      setQuoteForm(createEmptyQuoteForm());
      setEditingQuoteId(null);
      setQuoteError(null);
      setSelectedQuoteId(null);
      setDecisionNote('');
      return inquiryId;
    });
  }, []);

  // ── 更新本地询价（报价操作后局部刷新） ──
  const updateInquiryInList = useCallback((updated: SupplierInquiry) => {
    setInquiries(prev => prev.map(i => (i.id === updated.id ? updated : i)));
  }, []);

  // ── 创建询价 ──
  const handleCreate = useCallback(async () => {
    setCreateError(null);
    if (!createForm.description.trim()) {
      setCreateError('请填写品名描述');
      return;
    }
    setActionLoading('create');
    try {
      const input: SupplierInquiryInput = {
        description: createForm.description.trim(),
        materialCode: createForm.materialCode.trim() || undefined,
        quantity: createForm.quantity ? parseFloat(createForm.quantity) : undefined,
        unit: createForm.unit || undefined,
        currency: createForm.currency,
        expectedDeliveryDate: createForm.expectedDeliveryDate || undefined,
        buyer: createForm.buyer.trim() || undefined,
        notes: createForm.notes.trim() || undefined,
      };
      await apiService.createSupplierInquiry(input);
      setShowCreateForm(false);
      setCreateForm(createEmptyCreateForm());
      await fetchInquiries();
    } catch (e: any) {
      setCreateError(`创建失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [createForm, fetchInquiries]);

  // ── 添加/更新报价 ──
  const handleSaveQuote = useCallback(async (inquiryId: string) => {
    setQuoteError(null);
    // B2：供应商必须从档案下拉框选择（relationId），supplierName 由档案派生
    const selectedSupplier = supplierOptions.find(s => s.relationId === quoteForm.supplierId);
    if (!selectedSupplier) {
      setQuoteError('请从供应商档案中选择供应商');
      return;
    }
    const supplierName = selectedSupplier.relation?.name?.trim() || selectedSupplier.relationId;
    const amount = parseFloat(quoteForm.quoteAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setQuoteError('请填写有效的报价金额');
      return;
    }
    if (!quoteForm.quoteDate) {
      setQuoteError('请填写报价日期');
      return;
    }
    setActionLoading(`quote_${inquiryId}`);
    try {
      const input: SupplierQuoteInput = {
        supplierId: selectedSupplier.relationId,
        supplierName,
        quoteAmount: amount,
        currency: quoteForm.currency,
        exchangeRate: quoteForm.exchangeRate ? parseFloat(quoteForm.exchangeRate) : undefined,
        quoteDate: quoteForm.quoteDate,
        deliveryTerms: quoteForm.deliveryTerms.trim() || undefined,
        paymentTerms: quoteForm.paymentTerms.trim() || undefined,
        expectedDeliveryDate: quoteForm.expectedDeliveryDate || undefined,
        notes: quoteForm.notes.trim() || undefined,
      };
      let updated: SupplierInquiry;
      if (editingQuoteId) {
        updated = await apiService.updateSupplierQuote(inquiryId, editingQuoteId, input);
      } else {
        updated = await apiService.addSupplierQuote(inquiryId, input);
      }
      updateInquiryInList(updated);
      setQuoteForm(createEmptyQuoteForm());
      setEditingQuoteId(null);
    } catch (e: any) {
      setQuoteError(`保存报价失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [quoteForm, supplierOptions, editingQuoteId, updateInquiryInList]);

  // ── 编辑报价（填充表单进入编辑态；存量手打报价无 supplierId 时需重选档案供应商） ──
  const handleEditQuote = useCallback((quote: SupplierQuoteItem) => {
    setQuoteForm({
      supplierId: quote.supplierId || '',
      quoteAmount: String(quote.quoteAmount),
      currency: quote.currency,
      exchangeRate: quote.exchangeRate != null ? String(quote.exchangeRate) : '',
      quoteDate: quote.quoteDate,
      deliveryTerms: quote.deliveryTerms || '',
      paymentTerms: quote.paymentTerms || '',
      expectedDeliveryDate: quote.expectedDeliveryDate || '',
      notes: quote.notes || '',
    });
    setEditingQuoteId(quote.id);
    setQuoteError(null);
  }, []);

  // ── 取消编辑 ──
  const handleCancelEdit = useCallback(() => {
    setQuoteForm(createEmptyQuoteForm());
    setEditingQuoteId(null);
    setQuoteError(null);
  }, []);

  // ── 删除报价 ──
  const handleRemoveQuote = useCallback(async (inquiryId: string, quoteId: string) => {
    setError(null);
    setActionLoading(`delquote_${quoteId}`);
    try {
      const updated = await apiService.removeSupplierQuote(inquiryId, quoteId);
      updateInquiryInList(updated);
    } catch (e: any) {
      setError(`删除报价失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [updateInquiryInList]);

  // ── 比价决策（Open → Compared） ──
  const handleSelectSupplier = useCallback(async (inquiryId: string) => {
    setError(null);
    if (!selectedQuoteId) {
      setError('请先选择一条报价作为中选供应商');
      return;
    }
    setActionLoading(`select_${inquiryId}`);
    try {
      const updated = await apiService.selectSupplier(inquiryId, selectedQuoteId, decisionNote.trim());
      updateInquiryInList(updated);
      setSelectedQuoteId(null);
      setDecisionNote('');
    } catch (e: any) {
      setError(`比价决策失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [selectedQuoteId, decisionNote, updateInquiryInList]);

  // ── 关闭询价（Compared → Closed） ──
  const handleCloseInquiry = useCallback(async (inquiryId: string) => {
    setError(null);
    setActionLoading(`close_${inquiryId}`);
    try {
      const updated = await apiService.closeSupplierInquiry(inquiryId);
      updateInquiryInList(updated);
    } catch (e: any) {
      setError(`关闭询价失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [updateInquiryInList]);

  // ── C9：撤回比价（Compared → Open）——选错中选供应商可回退重新决策（报价保留） ──
  const handleRevertComparison = useCallback(async (inquiryId: string) => {
    setError(null);
    setActionLoading(`revert_${inquiryId}`);
    try {
      // 后端 updateSupplierInquiry 已扩展 Compared → Open 撤回分支（状态机真源在服务端）；
      // status 为后端撤回契约字段，前端 SupplierInquiryInput 类型未含（types.ts 不在本车道租约内），收窄断言透传。
      const updated = await apiService.updateSupplierInquiry(inquiryId, { status: 'Open' } as any);
      updateInquiryInList(updated);
    } catch (e: any) {
      setError(`撤回比价失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [updateInquiryInList]);

  // ── C7：一键转采购单（已比价 → 采购单新建页预填：供应商/币种/条款/行明细） ──
  const handleConvert = useCallback((inquiry: SupplierInquiry) => {
    if (!onConvertToPurchaseOrder) return;
    const quotes = Array.isArray(inquiry.supplierQuotes) ? inquiry.supplierQuotes : [];
    const selectedQuote = quotes.find(q => q.isSelected)
      ?? quotes.find(q => q.supplierId && q.supplierId === inquiry.selectedSupplierId)
      ?? null;
    onConvertToPurchaseOrder({
      inquiryNumber: inquiry.inquiryNumber,
      currency: inquiry.currency,
      supplierRelationId: inquiry.selectedSupplierId ?? selectedQuote?.supplierId,
      supplierName: inquiry.selectedSupplierName ?? selectedQuote?.supplierName,
      expectedDeliveryDate: selectedQuote?.expectedDeliveryDate || inquiry.expectedDeliveryDate,
      deliveryTerms: selectedQuote?.deliveryTerms,
      paymentTerms: selectedQuote?.paymentTerms,
      buyer: inquiry.buyer,
      line: {
        materialCode: inquiry.materialCode,
        description: inquiry.description,
        quantity: inquiry.quantity,
        unit: inquiry.unit,
      },
    });
  }, [onConvertToPurchaseOrder]);

  // ── 删除询价 ──
  const handleDeleteInquiry = useCallback(async (inquiryId: string) => {
    setError(null);
    setActionLoading(`delinq_${inquiryId}`);
    try {
      await apiService.deleteSupplierInquiry(inquiryId);
      setExpandedId(null);
      await fetchInquiries();
    } catch (e: any) {
      setError(`删除询价失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [fetchInquiries]);

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {showCreateForm ? (
          <motion.div
            key="inq-create"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {/* 创建表单头 */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-light" style={{ color: 'var(--text-primary)' }}>新建询价单</h2>
              <button
                onClick={() => { setShowCreateForm(false); setCreateError(null); }}
                className="bds-btn bds-btn-secondary"
              >
                <ChevronRight size={14} className="rotate-180" /><span>返回列表</span>
              </button>
            </div>

            <div className="space-y-3">
              {/* 基本信息 */}
              <div className="bds-card">
                <h3 className="bds-overline mb-3" style={{ color: 'var(--text-tertiary)' }}>基本信息</h3>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="xl:col-span-2">
                    <label className={labelCls}>品名描述 *</label>
                    <input
                      type="text"
                      value={createForm.description}
                      onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                      placeholder="如：21S/2 纱线"
                      className="bds-input"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>物料编码</label>
                    <input
                      type="text"
                      value={createForm.materialCode}
                      onChange={(e) => setCreateForm({ ...createForm, materialCode: e.target.value })}
                      placeholder="MAT-001"
                      className="bds-input"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>币种</label>
                    <select
                      value={createForm.currency}
                      onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value })}
                      className="bds-select"
                    >
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>数量</label>
                    <input
                      type="number"
                      step="0.01"
                      value={createForm.quantity}
                      onChange={(e) => setCreateForm({ ...createForm, quantity: e.target.value })}
                      placeholder="0"
                      className="bds-input"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>单位</label>
                    <select
                      value={createForm.unit}
                      onChange={(e) => setCreateForm({ ...createForm, unit: e.target.value })}
                      className="bds-select"
                    >
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>期望交期</label>
                    <CapsuleDateInput
                      value={createForm.expectedDeliveryDate}
                      onChange={(v) => setCreateForm({ ...createForm, expectedDeliveryDate: v })}
                      className="bds-input"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>采购员</label>
                    <input
                      type="text"
                      value={createForm.buyer}
                      onChange={(e) => setCreateForm({ ...createForm, buyer: e.target.value })}
                      placeholder="采购员"
                      className="bds-input"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className={labelCls}>备注</label>
                  <textarea
                    value={createForm.notes}
                    onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                    placeholder="询价要求说明..."
                    className="bds-input"
                    rows={2}
                  />
                </div>
              </div>

              {createError && (
                <div className="bds-alert danger">
                  <AlertCircle size={16} />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setShowCreateForm(false); setCreateError(null); }}
                  className="bds-btn bds-btn-ghost"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={actionLoading === 'create'}
                  className="bds-btn bds-btn-primary"
                >
                  {actionLoading === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  <span>创建询价</span>
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="inq-list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            {/* 工具栏 */}
            <div className="bds-filterbar mb-4">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索询价号/品名..."
                  className="bds-input sm pl-9"
                />
              </div>
              <button
                onClick={fetchInquiries}
                className="bds-btn bds-btn-ghost"
                style={{ padding: '0 var(--space-2)' }}
                title="刷新"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => setShowCreateForm(true)}
                className="bds-btn bds-btn-primary ml-auto"
              >
                <Plus size={14} /><span>新建询价</span>
              </button>
            </div>

            {/* 状态过滤 */}
            <div className="bds-segment mb-4 flex-wrap">
              {STATUS_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`seg ${statusFilter === tab.id ? 'active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="bds-alert danger mb-3">
                <AlertCircle size={16} />
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="ml-auto p-0.5"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* 列表 */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
              </div>
            ) : inquiries.length === 0 ? (
              <div className="bds-empty">
                <div className="glyph"><Scale size={24} /></div>
                <div className="title">暂无询价单</div>
                <div className="desc">点击「新建询价」开始比价</div>
              </div>
            ) : (
              <div className="space-y-2">
                {inquiries.map((inquiry, index) => {
                  const quotes = Array.isArray(inquiry.supplierQuotes) ? inquiry.supplierQuotes : [];
                  const lowestId = getLowestBaseAmountId(quotes);
                  const isOpen = inquiry.status === 'Open';
                  return (
                    <motion.div
                      key={inquiry.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="bds-card"
                      style={{ padding: 0, overflow: 'hidden' }}
                    >
                      {/* 卡片头部 */}
                      <div
                        className="flex items-center gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                        onClick={() => handleExpand(inquiry.id)}
                      >
                        <button
                          className="flex-shrink-0"
                          style={{ color: 'var(--text-quaternary)', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          {expandedId === inquiry.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>
                              {inquiry.inquiryNumber}
                            </span>
                            <span className={`bds-badge sm ${STATUS_BADGE_VARIANT[inquiry.status]}`}>
                              {STATUS_LABELS[inquiry.status]}
                            </span>
                          </div>
                          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                            {inquiry.description}
                            {inquiry.materialCode ? ` · ${inquiry.materialCode}` : ''}
                            {inquiry.quantity != null ? ` · ${inquiry.quantity} ${inquiry.unit || ''}` : ''}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                            {inquiry.currency}
                          </div>
                          <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>
                            {quotes.length} 条报价
                          </div>
                        </div>
                        {inquiry.selectedSupplierName && (
                          <div className="flex-shrink-0 text-right">
                            <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>中选</div>
                            <div className="text-xs font-light" style={{ color: 'var(--success-text)' }}>
                              {inquiry.selectedSupplierName}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 展开详情 */}
                      <AnimatePresence>
                        {expandedId === inquiry.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                            style={{ borderTop: 'var(--border-subtle)' }}
                          >
                            <div className="p-4 space-y-3">
                              {/* 基本信息 */}
                              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                {inquiry.materialCode && (
                                  <div><span className="opacity-60">物料:</span> <span className="bds-mono">{inquiry.materialCode}</span></div>
                                )}
                                {inquiry.quantity != null && (
                                  <div><span className="opacity-60">数量:</span> {inquiry.quantity} {inquiry.unit || ''}</div>
                                )}
                                {inquiry.buyer && (
                                  <div><span className="opacity-60">采购员:</span> {inquiry.buyer}</div>
                                )}
                                {inquiry.expectedDeliveryDate && (
                                  <div><span className="opacity-60">期望交期:</span> {formatDate(inquiry.expectedDeliveryDate)}</div>
                                )}
                                {inquiry.notes && (
                                  <div className="xl:col-span-4"><span className="opacity-60">备注:</span> {inquiry.notes}</div>
                                )}
                                <div><span className="opacity-60">创建:</span> {formatTimestamp(inquiry.createdAt)}</div>
                              </div>

                              {/* 供应商报价列表 */}
                              <div>
                                <h4 className="bds-overline mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                  供应商报价（{quotes.length}）
                                </h4>
                                {quotes.length === 0 ? (
                                  <div className="text-xs text-center py-3" style={{ color: 'var(--text-quaternary)' }}>
                                    {isOpen ? '暂无报价，请在下方添加' : '暂无报价'}
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {quotes.map(quote => {
                                      const isLowest = lowestId === quote.id;
                                      const isSelected = quote.isSelected || inquiry.selectedSupplierId === quote.id;
                                      return (
                                        <div key={quote.id} className="p-3 rounded-inset bds-inset">
                                          <div className="flex items-center gap-3">
                                            {/* 选择 radio（仅 Open 状态可选） */}
                                            {isOpen ? (
                                              <input
                                                type="radio"
                                                name={`select_${inquiry.id}`}
                                                checked={selectedQuoteId === quote.id}
                                                onChange={() => setSelectedQuoteId(quote.id)}
                                                className="flex-shrink-0"
                                              />
                                            ) : isSelected ? (
                                              <CheckCircle2 size={16} style={{ color: 'var(--success-text)' }} />
                                            ) : (
                                              <div style={{ width: 16 }} />
                                            )}
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-light" style={{ color: 'var(--text-primary)' }}>
                                                  {quote.supplierName}
                                                </span>
                                                {isSelected && (
                                                  <span className="bds-badge sm success">中选</span>
                                                )}
                                                {isLowest && !isSelected && (
                                                  <span className="bds-badge sm warning">最低基准</span>
                                                )}
                                              </div>
                                              <div className="text-xs mt-1 flex items-center gap-3 flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                                                <span>
                                                  报价: <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>
                                                    {formatAmount(Number(quote.quoteAmount), quote.currency)}
                                                  </span>
                                                </span>
                                                {quote.baseAmount != null && (
                                                  <span>
                                                    基准: <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>
                                                      {formatAmount(Number(quote.baseAmount), inquiry.currency)}
                                                    </span>
                                                  </span>
                                                )}
                                                {quote.exchangeRate != null && (
                                                  <span>汇率: <span className="bds-tnum">{Number(quote.exchangeRate).toFixed(4)}</span></span>
                                                )}
                                                <span>报价日: {formatDate(quote.quoteDate)}</span>
                                                {quote.expectedDeliveryDate && <span>交期: {formatDate(quote.expectedDeliveryDate)}</span>}
                                                {quote.deliveryTerms && <span>交货: {quote.deliveryTerms}</span>}
                                                {quote.paymentTerms && <span>付款: {quote.paymentTerms}</span>}
                                              </div>
                                              {quote.notes && (
                                                <div className="text-xs mt-1" style={{ color: 'var(--text-quaternary)' }}>
                                                  {quote.notes}
                                                </div>
                                              )}
                                            </div>
                                            {/* 编辑/删除（仅 Open） */}
                                            {isOpen && (
                                              <div className="flex items-center gap-1 flex-shrink-0">
                                                <button
                                                  onClick={() => handleEditQuote(quote)}
                                                  className="p-1 rounded-control transition-colors hover:bg-[var(--hover-darken)]"
                                                  style={{ color: 'var(--text-quaternary)' }}
                                                  title="编辑报价"
                                                >
                                                  <Pencil size={14} />
                                                </button>
                                                <button
                                                  onClick={() => handleRemoveQuote(inquiry.id, quote.id)}
                                                  disabled={actionLoading === `delquote_${quote.id}`}
                                                  className="p-1 rounded-control transition-colors hover:bg-[var(--hover-darken)]"
                                                  style={{ color: 'var(--text-quaternary)' }}
                                                  title="删除报价"
                                                >
                                                  {actionLoading === `delquote_${quote.id}` ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                  ) : (
                                                    <Trash2 size={14} />
                                                  )}
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* 添加/编辑报价表单（仅 Open） */}
                              {isOpen && (
                                <div className="p-3 rounded-inset bds-inset">
                                  <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                      {editingQuoteId ? '编辑报价' : '添加报价'}
                                    </h4>
                                    {editingQuoteId && (
                                      <button
                                        onClick={handleCancelEdit}
                                        className="bds-btn bds-btn-ghost"
                                        style={{ padding: '0 var(--space-2)' }}
                                      >
                                        <X size={14} /><span>取消编辑</span>
                                      </button>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                                    <div>
                                      <label className={labelCls}>供应商 *</label>
                                      <select
                                        value={quoteForm.supplierId}
                                        onChange={(e) => setQuoteForm({ ...quoteForm, supplierId: e.target.value })}
                                        className="bds-select sm"
                                      >
                                        <option value="">请选择供应商档案</option>
                                        {supplierOptions.map(s => (
                                          <option key={s.relationId} value={s.relationId}>
                                            {s.relation?.name || s.relationId}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <label className={labelCls}>报价金额 *</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={quoteForm.quoteAmount}
                                        onChange={(e) => setQuoteForm({ ...quoteForm, quoteAmount: e.target.value })}
                                        placeholder="0.00"
                                        className="bds-input sm"
                                      />
                                    </div>
                                    <div>
                                      <label className={labelCls}>币种 *</label>
                                      <select
                                        value={quoteForm.currency}
                                        onChange={(e) => setQuoteForm({ ...quoteForm, currency: e.target.value })}
                                        className="bds-select sm"
                                      >
                                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className={labelCls}>汇率</label>
                                      <input
                                        type="number"
                                        step="0.0001"
                                        value={quoteForm.exchangeRate}
                                        onChange={(e) => setQuoteForm({ ...quoteForm, exchangeRate: e.target.value })}
                                        placeholder="1.0000"
                                        className="bds-input sm"
                                      />
                                    </div>
                                    <div>
                                      <label className={labelCls}>报价日期 *</label>
                                      <CapsuleDateInput
                                        value={quoteForm.quoteDate}
                                        onChange={(v) => setQuoteForm({ ...quoteForm, quoteDate: v })}
                                        className="bds-input sm"
                                      />
                                    </div>
                                    <div>
                                      <label className={labelCls}>交货条款</label>
                                      <input
                                        type="text"
                                        value={quoteForm.deliveryTerms}
                                        onChange={(e) => setQuoteForm({ ...quoteForm, deliveryTerms: e.target.value })}
                                        placeholder="FOB"
                                        className="bds-input sm"
                                      />
                                    </div>
                                    <div>
                                      <label className={labelCls}>付款条款</label>
                                      <input
                                        type="text"
                                        value={quoteForm.paymentTerms}
                                        onChange={(e) => setQuoteForm({ ...quoteForm, paymentTerms: e.target.value })}
                                        placeholder="T/T 30%"
                                        className="bds-input sm"
                                      />
                                    </div>
                                    <div>
                                      <label className={labelCls}>交期</label>
                                      <CapsuleDateInput
                                        value={quoteForm.expectedDeliveryDate}
                                        onChange={(v) => setQuoteForm({ ...quoteForm, expectedDeliveryDate: v })}
                                        className="bds-input sm"
                                      />
                                    </div>
                                    <div className="xl:col-span-4">
                                      <label className={labelCls}>备注</label>
                                      <input
                                        type="text"
                                        value={quoteForm.notes}
                                        onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })}
                                        placeholder="报价说明"
                                        className="bds-input sm"
                                      />
                                    </div>
                                  </div>
                                  {quoteError && (
                                    <div className="text-xs mt-2" style={{ color: 'var(--danger-text)' }}>
                                      {quoteError}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-end gap-2 mt-2">
                                    <button
                                      onClick={() => handleSaveQuote(inquiry.id)}
                                      disabled={actionLoading === `quote_${inquiry.id}`}
                                      className="bds-btn bds-btn-primary"
                                    >
                                      {actionLoading === `quote_${inquiry.id}` ? (
                                        <Loader2 size={14} className="animate-spin" />
                                      ) : (
                                        <Plus size={14} />
                                      )}
                                      <span>{editingQuoteId ? '保存修改' : '添加报价'}</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* 比价决策（仅 Open 且有报价） */}
                              {isOpen && quotes.length > 0 && (
                                <div
                                  className="p-3 rounded-inset"
                                  style={{ background: 'var(--recessed-bg)', border: 'var(--border-subtle)' }}
                                >
                                  <h4 className="bds-overline mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                    比价决策
                                  </h4>
                                  <div className="space-y-2">
                                    <div>
                                      <label className={labelCls}>决策备注</label>
                                      <textarea
                                        value={decisionNote}
                                        onChange={(e) => setDecisionNote(e.target.value)}
                                        placeholder="比价决策说明，如：综合考虑价格、交期、付款条件..."
                                        className="bds-input"
                                        rows={2}
                                      />
                                    </div>
                                    <div className="flex items-center justify-end gap-2">
                                      {!selectedQuoteId && (
                                        <span className="text-xs" style={{ color: 'var(--text-quaternary)' }}>
                                          请先选择一条报价
                                        </span>
                                      )}
                                      <button
                                        onClick={() => handleSelectSupplier(inquiry.id)}
                                        disabled={!selectedQuoteId || actionLoading === `select_${inquiry.id}`}
                                        className="bds-btn bds-btn-primary"
                                      >
                                        {actionLoading === `select_${inquiry.id}` ? (
                                          <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                          <CheckCircle2 size={14} />
                                        )}
                                        <span>确认比价决策</span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* 已决策信息（Compared/Closed） */}
                              {inquiry.status !== 'Open' && (inquiry.selectedSupplierName || inquiry.decisionNote) && (
                                <div
                                  className="p-3 rounded-inset"
                                  style={{ background: 'var(--recessed-bg)', border: 'var(--border-subtle)' }}
                                >
                                  <h4 className="bds-overline mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                    决策记录
                                  </h4>
                                  {inquiry.selectedSupplierName && (
                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                      中选供应商：<span className="font-light" style={{ color: 'var(--success-text)' }}>
                                        {inquiry.selectedSupplierName}
                                      </span>
                                    </div>
                                  )}
                                  {inquiry.decisionNote && (
                                    <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                                      {inquiry.decisionNote}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* 操作按钮 */}
                              <div className="flex items-center gap-2 pt-2 flex-wrap">
                                {inquiry.status === 'Compared' && (
                                  <>
                                    {/* C7：一键转采购单（宿主提供跳转时展示） */}
                                    {onConvertToPurchaseOrder && (
                                      <button
                                        onClick={() => handleConvert(inquiry)}
                                        className="bds-btn bds-btn-primary"
                                      >
                                        <FileText size={14} />
                                        <span>转采购单</span>
                                      </button>
                                    )}
                                    {/* C9：撤回比价（Compared → Open，报价保留可重新决策） */}
                                    <button
                                      onClick={() => handleRevertComparison(inquiry.id)}
                                      disabled={actionLoading === `revert_${inquiry.id}`}
                                      className="bds-btn bds-btn-ghost"
                                    >
                                      {actionLoading === `revert_${inquiry.id}` ? (
                                        <Loader2 size={14} className="animate-spin" />
                                      ) : (
                                        <Undo2 size={14} />
                                      )}
                                      <span>撤回比价</span>
                                    </button>
                                    <button
                                      onClick={() => handleCloseInquiry(inquiry.id)}
                                      disabled={actionLoading === `close_${inquiry.id}`}
                                      className="bds-btn bds-btn-secondary"
                                    >
                                      {actionLoading === `close_${inquiry.id}` ? (
                                        <Loader2 size={14} className="animate-spin" />
                                      ) : (
                                        <CheckCircle2 size={14} />
                                      )}
                                      <span>关闭询价</span>
                                    </button>
                                  </>
                                )}
                                {inquiry.status === 'Open' && (
                                  <button
                                    onClick={() => handleDeleteInquiry(inquiry.id)}
                                    disabled={actionLoading === `delinq_${inquiry.id}`}
                                    className="bds-btn bds-btn-danger"
                                  >
                                    {actionLoading === `delinq_${inquiry.id}` ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <Trash2 size={14} />
                                    )}
                                    <span>删除询价</span>
                                  </button>
                                )}
                                {inquiry.status === 'Closed' && (
                                  <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                                    <CheckCircle2 size={14} />
                                    <span>已关闭 — 终态</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SupplierInquiryPanel;
