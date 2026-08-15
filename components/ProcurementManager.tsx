/**
 * 采购管理 ProcurementManager
 * Phase 2 B1 缺失模块补齐：采购单全生命周期管理 + 来料检验
 *
 * 功能：
 *   - 采购单列表（状态过滤、搜索、供应商筛选）
 *   - 创建采购单（含行明细、供应商选择、条款）
 *   - 状态流转：Draft → Sent → Confirmed → PartiallyReceived/Received → Closed / Cancelled
 *   - 来料检验记录（MaterialReceipt）：合格/不合格数量、入库仓库、检验员
 *   - 行明细：物料编码、品名、数量、单价、已收数量跟踪
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  PackageCheck,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Package,
  FileText,
  X,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  PurchaseOrder,
  PurchaseLine,
  PurchaseOrderStatus,
  PurchaseOrderInput,
  MaterialReceipt,
  MaterialReceiptInput,
  Relation,
  View,
} from '../types';
import { primeFinanceInvoiceCreate } from './FinanceManager';
import { PageHeader } from './ui/PageHeader';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { RelatedEntitiesPanel } from './RelatedEntitiesPanel';

// ==================== 常量 ====================

// ── 阶段 IA-3：订单详情下游动作 prime（生成采购单预填，与 Suppliers preview 同模式） ──
const PROCUREMENT_CREATE_PRIME_KEY = 'bambook_procurement_create_prime';

export interface ProcurementCreatePrime {
  orderId: string;
  poNumber?: string;
  materialCode?: string;
  description?: string;
  quantity?: number;
  unit?: string;
}

export const primeProcurementCreateFromOrder = (prime: ProcurementCreatePrime) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PROCUREMENT_CREATE_PRIME_KEY, JSON.stringify(prime));
  } catch {
    // Dev-preview continuity only; ignore storage failures.
  }
};

const readProcurementCreatePrime = (): ProcurementCreatePrime | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PROCUREMENT_CREATE_PRIME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProcurementCreatePrime>;
    return typeof parsed.orderId === 'string' && parsed.orderId ? (parsed as ProcurementCreatePrime) : null;
  } catch {
    return null;
  }
};

const clearProcurementCreatePrime = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PROCUREMENT_CREATE_PRIME_KEY);
  } catch {
    // ignore
  }
};

type StatusTab = 'all' | PurchaseOrderStatus;

const STATUS_TABS: Array<{ id: StatusTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'Draft', label: '草稿' },
  { id: 'Sent', label: '已发送' },
  { id: 'Confirmed', label: '已确认' },
  { id: 'PartiallyReceived', label: '部分到货' },
  { id: 'Received', label: '全部到货' },
  { id: 'Closed', label: '已关闭' },
  { id: 'Cancelled', label: '已取消' },
];

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  Draft: '草稿',
  Sent: '已发送',
  Confirmed: '已确认',
  PartiallyReceived: '部分到货',
  Received: '全部到货',
  Closed: '已关闭',
  Cancelled: '已取消',
};

// BDS v2.1：状态 → bds-badge 语义变体（主题透明，替代 statusSemanticClass/Text 双三元拼装）
const STATUS_BADGE_VARIANT: Record<PurchaseOrderStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  Draft: 'neutral',
  Sent: 'info',
  Confirmed: 'neutral',
  PartiallyReceived: 'warning',
  Received: 'success',
  Closed: 'neutral',
  Cancelled: 'danger',
};

const CURRENCIES = ['USD', 'CNY', 'EUR'];
const UNITS = ['YD', 'M', 'KG', 'PC', 'SET'];
const LINE_CATEGORIES = ['Fabric', 'Trimmings', 'Accessories', 'Other'];

const RECEIPT_STATUS_LABELS: Record<MaterialReceipt['status'], string> = {
  Pending: '待检',
  Inspected: '已检验',
  Accepted: '合格入库',
  Rejected: '不合格',
  PartiallyAccepted: '部分合格',
};

const RECEIPT_STATUS_BADGE_VARIANT: Record<MaterialReceipt['status'], 'neutral' | 'success' | 'danger' | 'warning'> = {
  Pending: 'neutral',
  Inspected: 'neutral',
  Accepted: 'success',
  Rejected: 'danger',
  PartiallyAccepted: 'warning',
};

interface ProcurementManagerProps {
  isDarkMode: boolean;
  /** 跨模块跳转（如「生成应付发票」→ 财务发票模块） */
  onNavigate?: (view: View) => void;
}

let lineCounter = 0;
const newLineKey = () => `new_pol_${Date.now()}_${++lineCounter}`;

interface DraftLine {
  key: string;
  materialCode: string;
  description: string;
  category: string;
  specification: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  notes: string;
}

const createEmptyLine = (): DraftLine => ({
  key: newLineKey(),
  materialCode: '',
  description: '',
  category: 'Fabric',
  specification: '',
  quantity: '',
  unit: 'YD',
  unitPrice: '',
  notes: '',
});

const ProcurementManager: React.FC<ProcurementManagerProps> = ({ isDarkMode, onNavigate }) => {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [receiptsByPo, setReceiptsByPo] = useState<Record<string, MaterialReceipt[]>>({});
  const [showReceiptForm, setShowReceiptForm] = useState<string | null>(null);

  // 创建表单状态
  const [form, setForm] = useState({
    poNumber: '',
    currency: 'USD',
    supplierRelationId: '',
    supplierName: '',
    orderDate: new Date().toISOString().split('T')[0],
    expectedDeliveryDate: '',
    deliveryTerms: 'FOB Shanghai',
    paymentTerms: 'T/T 30% deposit, 70% before shipment',
    shipToAddress: '',
    buyer: '',
    notes: '',
  });
  const [formLines, setFormLines] = useState<DraftLine[]>([createEmptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);

  // 阶段 IA-3：订单详情「生成采购单」prime —— 挂载时自动打开创建表单并预填
  const [createPrime, setCreatePrime] = useState<ProcurementCreatePrime | null>(() => {
    const prime = readProcurementCreatePrime();
    if (prime) clearProcurementCreatePrime();
    return prime;
  });

  useEffect(() => {
    if (!createPrime) return;
    setShowCreateForm(true);
    setForm(prev => ({
      ...prev,
      notes: prev.notes || `关联订单 ${createPrime.poNumber || createPrime.orderId}`,
    }));
    setFormLines([{
      ...createEmptyLine(),
      materialCode: createPrime.materialCode ?? '',
      description: createPrime.description ?? '',
      quantity: createPrime.quantity != null ? String(createPrime.quantity) : '',
      unit: createPrime.unit ?? 'YD',
    }]);
  }, [createPrime]);

  // 来料检验表单状态
  const [receiptForm, setReceiptForm] = useState({
    receiptNumber: '',
    receivedDate: new Date().toISOString().split('T')[0],
    receivedBy: '',
    warehouseName: '',
    totalReceived: '',
    totalAccepted: '',
    totalRejected: '',
    rejectionReason: '',
    qualityNotes: '',
  });
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // ── 拉取数据 ──
  const fetchPurchaseOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listPurchaseOrders({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: searchQuery || undefined,
        limit: 100,
      });
      setPurchaseOrders(result.items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => { fetchPurchaseOrders(); }, [fetchPurchaseOrders]);

  useEffect(() => {
    apiService.listRelations().then(setRelations).catch(() => {});
  }, []);

  // ── 供应商选项 ──
  const supplierOptions = useMemo(() => {
    return relations
      .filter(r => !r.deletedAt && (r.type === 'Supplier' || r.category === 'Supplier'))
      .map(r => ({
        id: r.id,
        label: r.englishName || r.chineseName || r.name,
        chineseName: r.chineseName || r.name,
        code: r.paymentTerms || '',
      }));
  }, [relations]);

  // ── 行金额计算 ──
  const calcLineAmount = (qty: string, price: string) => {
    const q = parseFloat(qty);
    const p = parseFloat(price);
    if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
    return Math.round(q * p * 10000) / 10000;
  };

  const formTotal = useMemo(() => {
    return formLines.reduce((sum, l) => sum + calcLineAmount(l.quantity, l.unitPrice), 0);
  }, [formLines]);

  // ── 状态转换操作 ──
  const handleAction = useCallback(async (id: string, action: 'send' | 'confirm' | 'cancel' | 'close' | 'delete') => {
    setActionLoading(`${id}_${action}`);
    setError(null);
    try {
      if (action === 'send') await apiService.sendPurchaseOrder(id);
      else if (action === 'confirm') await apiService.confirmPurchaseOrder(id);
      else if (action === 'cancel') await apiService.cancelPurchaseOrder(id);
      else if (action === 'close') await apiService.closePurchaseOrder(id);
      else if (action === 'delete') await apiService.deletePurchaseOrder(id);
      await fetchPurchaseOrders();
    } catch (e: any) {
      setError(`操作失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [fetchPurchaseOrders]);

  // ── 拉取来料记录 ──
  const fetchReceipts = useCallback(async (poId: string) => {
    try {
      const receipts = await apiService.listMaterialReceipts(poId);
      setReceiptsByPo(prev => ({ ...prev, [poId]: receipts }));
    } catch {
      // 静默失败，不影响主列表
    }
  }, []);

  const handleExpand = useCallback((poId: string) => {
    if (expandedId === poId) {
      setExpandedId(null);
    } else {
      setExpandedId(poId);
      fetchReceipts(poId);
    }
  }, [expandedId, fetchReceipts]);

  // ── 创建采购单 ──
  const handleCreate = useCallback(async () => {
    setFormError(null);
    const validLines = formLines.filter(l => l.description && l.quantity && l.unitPrice);
    if (!form.poNumber) { setFormError('请填写采购单号'); return; }
    if (!form.orderDate) { setFormError('请填写下单日期'); return; }
    if (validLines.length === 0) { setFormError('至少需要一行有效采购明细'); return; }

    setActionLoading('create');
    try {
      const input: PurchaseOrderInput = {
        poNumber: form.poNumber,
        currency: form.currency,
        supplierRelationId: form.supplierRelationId || undefined,
        supplierName: form.supplierName || undefined,
        orderDate: form.orderDate,
        expectedDeliveryDate: form.expectedDeliveryDate || undefined,
        deliveryTerms: form.deliveryTerms || undefined,
        paymentTerms: form.paymentTerms || undefined,
        shipToAddress: form.shipToAddress || undefined,
        orderId: createPrime?.orderId,
        buyer: form.buyer || undefined,
        notes: form.notes || undefined,
        lines: validLines.map(l => ({
          materialCode: l.materialCode || undefined,
          description: l.description,
          category: l.category || undefined,
          specification: l.specification || undefined,
          quantity: parseFloat(l.quantity),
          unit: l.unit,
          unitPrice: parseFloat(l.unitPrice),
          notes: l.notes || undefined,
        })),
      };
      await apiService.createPurchaseOrder(input);
      setShowCreateForm(false);
      // 重置表单
      setForm({
        poNumber: '', currency: 'USD', supplierRelationId: '', supplierName: '',
        orderDate: new Date().toISOString().split('T')[0], expectedDeliveryDate: '',
        deliveryTerms: 'FOB Shanghai', paymentTerms: 'T/T 30% deposit, 70% before shipment',
        shipToAddress: '', buyer: '', notes: '',
      });
      setFormLines([createEmptyLine()]);
      setCreatePrime(null);
      await fetchPurchaseOrders();
    } catch (e: any) {
      setFormError(`创建失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [form, formLines, createPrime, fetchPurchaseOrders]);

  // ── 创建来料检验记录 ──
  const handleCreateReceipt = useCallback(async (poId: string) => {
    setReceiptError(null);
    if (!receiptForm.receiptNumber) { setReceiptError('请填写收料单号'); return; }
    if (!receiptForm.receivedDate) { setReceiptError('请填写收货日期'); return; }
    if (receiptForm.totalReceived === '' || receiptForm.totalAccepted === '' || receiptForm.totalRejected === '') {
      setReceiptError('请填写收货数量 / 合格数量 / 不合格数量'); return;
    }

    setActionLoading(`receipt_${poId}`);
    try {
      const input: MaterialReceiptInput = {
        receiptNumber: receiptForm.receiptNumber,
        receivedDate: receiptForm.receivedDate,
        receivedBy: receiptForm.receivedBy || undefined,
        warehouseName: receiptForm.warehouseName || undefined,
        totalReceived: parseFloat(receiptForm.totalReceived),
        totalAccepted: parseFloat(receiptForm.totalAccepted),
        totalRejected: parseFloat(receiptForm.totalRejected),
        rejectionReason: receiptForm.rejectionReason || undefined,
        qualityNotes: receiptForm.qualityNotes || undefined,
      };
      await apiService.createMaterialReceipt(poId, input);
      setShowReceiptForm(null);
      // 重置来料表单
      setReceiptForm({
        receiptNumber: '', receivedDate: new Date().toISOString().split('T')[0],
        receivedBy: '', warehouseName: '', totalReceived: '', totalAccepted: '',
        totalRejected: '', rejectionReason: '', qualityNotes: '',
      });
      await fetchReceipts(poId);
      await fetchPurchaseOrders();
    } catch (e: any) {
      setReceiptError(`登记失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [receiptForm, fetchReceipts, fetchPurchaseOrders]);

  const updateFormLine = (key: string, field: keyof DraftLine, value: string) => {
    setFormLines(prev => prev.map(l => (l.key === key ? { ...l, [field]: value } : l)));
  };
  const addFormLine = () => setFormLines(prev => [...prev, createEmptyLine()]);
  const removeFormLine = (key: string) => setFormLines(prev => (prev.length > 1 ? prev.filter(l => l.key !== key) : prev));

  const formatAmount = (n: number, currency: string) =>
    `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

  const formatDate = (s?: string) => s || '—';

  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
  const labelCls = 'block text-xs mb-1 text-[var(--text-tertiary)]';

  const canReceive = (status: PurchaseOrderStatus) =>
    status === 'Confirmed' || status === 'PartiallyReceived' || status === 'Received';

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader title="采购管理" subtitle="Procurement" isDarkMode={isDarkMode} />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <ScrollEdgeFades scrollRef={{ current: null }} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          <AnimatePresence mode="wait">
            {showCreateForm ? (
              <motion.div key="create-form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                {/* 创建表单 */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <h2 className="text-lg font-light" style={{ color: 'var(--text-primary)' }}>新建采购单</h2>
                    {createPrime && (
                      <span className="bds-badge sm neutral flex items-center gap-1.5">
                        关联订单 {createPrime.poNumber || createPrime.orderId}
                        <button
                          type="button"
                          onClick={() => setCreatePrime(null)}
                          className="rounded-full p-0.5 transition-colors"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}
                          title="取消订单关联"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    )}
                  </div>
                  <button onClick={() => { setShowCreateForm(false); setCreatePrime(null); }} className="bds-btn bds-btn-secondary">
                    <ChevronRight size={14} className="rotate-180" /><span>返回列表</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {/* 基本信息 */}
                  <div className="bds-card">
                    <h3 className="bds-overline mb-3" style={{ color: 'var(--text-tertiary)' }}>基本信息</h3>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                      <div>
                        <label className={labelCls}>采购单号 *</label>
                        <input type="text" value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} placeholder="PO-2026-001" className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>币种</label>
                        <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="bds-select">
                          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>下单日期 *</label>
                        <input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>预计交货日期</label>
                        <input type="date" value={form.expectedDeliveryDate} onChange={(e) => setForm({ ...form, expectedDeliveryDate: e.target.value })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>供应商</label>
                        <select value={form.supplierRelationId} onChange={(e) => {
                          const rel = relations.find(r => r.id === e.target.value);
                          setForm({ ...form, supplierRelationId: e.target.value, supplierName: rel?.englishName || rel?.chineseName || '' });
                        }} className="bds-select">
                          <option value="">选择供应商...</option>
                          {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.label} ({s.chineseName})</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>采购员</label>
                        <input type="text" value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>收货地址</label>
                        <input type="text" value={form.shipToAddress} onChange={(e) => setForm({ ...form, shipToAddress: e.target.value })} className="bds-input" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className={labelCls}>交货条款</label>
                        <input type="text" value={form.deliveryTerms} onChange={(e) => setForm({ ...form, deliveryTerms: e.target.value })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>付款条款</label>
                        <input type="text" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} className="bds-input" />
                      </div>
                    </div>
                  </div>

                  {/* 采购行 */}
                  <div className="bds-card">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>采购明细</h3>
                      <button onClick={addFormLine} className="bds-btn bds-btn-ghost" style={{ color: 'var(--accent-text)' }}>
                        <Plus size={12} /> 添加行
                      </button>
                    </div>
                    <div className="space-y-2">
                      {formLines.map((line) => (
                        <div key={line.key} className="p-3 rounded-inset" style={{ background: 'var(--bg-panel)' }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="bds-mono text-xs" style={{ color: 'var(--text-quaternary)' }}>行 {formLines.indexOf(line) + 1}</span>
                            {formLines.length > 1 && (
                              <button onClick={() => removeFormLine(line.key)} className="p-1 rounded transition-colors" style={{ color: 'var(--text-quaternary)' }}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
                            <input type="text" value={line.materialCode} onChange={(e) => updateFormLine(line.key, 'materialCode', e.target.value)} placeholder="物料编码" className="bds-input sm" />
                            <input type="text" value={line.description} onChange={(e) => updateFormLine(line.key, 'description', e.target.value)} placeholder="品名描述 *" className="bds-input sm xl:col-span-2" />
                            <select value={line.category} onChange={(e) => updateFormLine(line.key, 'category', e.target.value)} className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}>
                              {LINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <input type="number" value={line.quantity} onChange={(e) => updateFormLine(line.key, 'quantity', e.target.value)} placeholder="数量 *" className="bds-input sm" />
                            <select value={line.unit} onChange={(e) => updateFormLine(line.key, 'unit', e.target.value)} className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}>
                              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                            <input type="number" step="0.01" value={line.unitPrice} onChange={(e) => updateFormLine(line.key, 'unitPrice', e.target.value)} placeholder="单价 *" className="bds-input sm" />
                            <input type="text" value={line.specification} onChange={(e) => updateFormLine(line.key, 'specification', e.target.value)} placeholder="规格" className="bds-input sm xl:col-span-2" />
                          </div>
                          <div className="mt-1 text-right text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            金额: {formatAmount(calcLineAmount(line.quantity, line.unitPrice), form.currency)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 flex justify-between items-center text-sm" style={{ borderTop: 'var(--border-subtle)' }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>合计</span>
                      <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{formatAmount(formTotal, form.currency)}</span>
                    </div>
                  </div>

                  {formError && (
                    <div className="bds-alert danger">
                      <AlertCircle size={16} />
                      <span>{formError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => { setShowCreateForm(false); setCreatePrime(null); }} className="bds-btn bds-btn-ghost">
                      取消
                    </button>
                    <button onClick={handleCreate} disabled={actionLoading === 'create'} className="bds-btn bds-btn-primary">
                      {actionLoading === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      <span>创建采购单</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                {/* 工具栏 */}
                <div className="flex items-center gap-3 mb-4">
                  <button onClick={() => setShowCreateForm(true)} className="bds-btn bds-btn-primary">
                    <Plus size={14} /><span>新建采购单</span>
                  </button>
                  <div className="bds-filterbar relative flex-1 max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索采购号/供应商..." className="bds-input sm pl-9" />
                  </div>
                  <button onClick={fetchPurchaseOrders} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>

                {/* 状态过滤 */}
                <div className="bds-segment mb-4 flex-wrap">
                  {STATUS_TABS.map(tab => (
                    <button key={tab.id} onClick={() => setStatusFilter(tab.id)} className={`seg ${statusFilter === tab.id ? 'active' : ''}`}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* 错误提示 */}
                {error && (
                  <div className="bds-alert danger mb-3">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-auto p-0.5" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}>
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* 列表 */}
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                  </div>
                ) : purchaseOrders.length === 0 ? (
                  <div className="bds-empty">
                    <div className="glyph"><PackageCheck size={24} /></div>
                    <div className="title">暂无采购单</div>
                    <div className="desc">点击「新建采购单」开始</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {purchaseOrders.map((po, index) => {
                      const receipts = receiptsByPo[po.id] || [];
                      return (
                        <motion.div
                          key={po.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.03 }}
                          className="bds-card"
                          style={{ padding: 0, overflow: 'hidden' }}
                        >
                          {/* 卡片头部 */}
                          <div
                            className="flex items-center gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                            onClick={() => handleExpand(po.id)}
                          >
                            <button className="flex-shrink-0" style={{ color: 'var(--text-quaternary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              {expandedId === po.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>{po.poNumber}</span>
                                <span className={`bds-badge sm ${STATUS_BADGE_VARIANT[po.status as PurchaseOrderStatus] || 'neutral'}`}>
                                  {STATUS_LABELS[po.status as PurchaseOrderStatus] || po.status}
                                </span>
                              </div>
                              <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                                {po.supplierName || '未指定供应商'} · 下单 {formatDate(po.orderDate)}
                                {po.expectedDeliveryDate ? ` · 预计交货 ${po.expectedDeliveryDate}` : ''}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                                {formatAmount(Number(po.totalAmount), po.currency)}
                              </div>
                              {po.lines && po.lines.length > 0 && (
                                <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>
                                  {po.lines.length} 行
                                  {receipts.length > 0 && ` · ${receipts.length} 次收料`}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 展开详情 */}
                          <AnimatePresence>
                            {expandedId === po.id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                                style={{ borderTop: 'var(--border-subtle)' }}
                              >
                                <div className="p-4 space-y-3">
                                  {/* 条款信息 */}
                                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                    {po.deliveryTerms && <div><span className="opacity-60">交货:</span> {po.deliveryTerms}</div>}
                                    {po.paymentTerms && <div><span className="opacity-60">付款:</span> {po.paymentTerms}</div>}
                                    {po.buyer && <div><span className="opacity-60">采购员:</span> {po.buyer}</div>}
                                    {po.shipToAddress && <div><span className="opacity-60">收货:</span> {po.shipToAddress}</div>}
                                  </div>

                                  {/* 行明细表 */}
                                  {po.lines && po.lines.length > 0 && (
                                    <div className="rounded-inset overflow-hidden" style={{ background: 'var(--bg-panel)' }}>
                                      <table className="bds-table">
                                        <thead>
                                          <tr>
                                            <th>#</th>
                                            <th>物料编码</th>
                                            <th>品名</th>
                                            <th className="num">订单数量</th>
                                            <th style={{ textAlign: 'center' }}>单位</th>
                                            <th className="num">单价</th>
                                            <th className="num">金额</th>
                                            <th className="num">已收</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {po.lines.map((line: PurchaseLine) => (
                                            <tr key={line.id}>
                                              <td>{line.lineNumber}</td>
                                              <td className="bds-mono">{line.materialCode || '—'}</td>
                                              <td>{line.description}</td>
                                              <td className="num bds-tnum">{Number(line.quantity).toLocaleString('en-US')}</td>
                                              <td style={{ textAlign: 'center' }}>{line.unit}</td>
                                              <td className="num bds-tnum">{Number(line.unitPrice).toFixed(4)}</td>
                                              <td className="num bds-tnum">{Number(line.amount).toFixed(2)}</td>
                                              <td className="num bds-tnum">
                                                {Number(line.receivedQuantity) > 0 ? (
                                                  <span style={{ color: 'var(--success-text)' }}>{Number(line.receivedQuantity).toLocaleString('en-US')}</span>
                                                ) : '—'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  {/* 来料检验记录 */}
                                  {receipts.length > 0 && (
                                    <div>
                                      <h4 className="bds-overline mb-2" style={{ color: 'var(--text-tertiary)' }}>来料检验记录</h4>
                                      <div className="space-y-1.5">
                                        {receipts.map(rc => (
                                          <div key={rc.id} className="p-2.5 rounded-inset flex items-center gap-3 text-xs" style={{ background: 'var(--bg-panel)' }}>
                                            <Package size={14} style={{ color: 'var(--text-quaternary)' }} />
                                            <span className="bds-mono" style={{ color: 'var(--text-primary)' }}>{rc.receiptNumber}</span>
                                            <span className={`bds-badge sm ${RECEIPT_STATUS_BADGE_VARIANT[rc.status] || 'neutral'}`}>
                                              {RECEIPT_STATUS_LABELS[rc.status] || rc.status}
                                            </span>
                                            <span style={{ color: 'var(--text-tertiary)' }}>{formatDate(rc.receivedDate)}</span>
                                            <span className="ml-auto bds-tnum" style={{ color: 'var(--text-primary)' }}>
                                              合格 {Number(rc.totalAccepted).toLocaleString('en-US')} / 不合格 {Number(rc.totalRejected).toLocaleString('en-US')}
                                            </span>
                                            {rc.warehouseName && (
                                              <span style={{ color: 'var(--text-quaternary)' }}>· {rc.warehouseName}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* 来料检验表单 */}
                                  <AnimatePresence>
                                    {showReceiptForm === po.id && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="p-3 rounded-inset" style={{ background: 'var(--bg-panel)' }}>
                                          <h4 className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>登记来料检验</h4>
                                          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-2">
                                            <input type="text" value={receiptForm.receiptNumber} onChange={(e) => setReceiptForm({ ...receiptForm, receiptNumber: e.target.value })} placeholder="收料单号 *" className="bds-input sm" />
                                            <input type="date" value={receiptForm.receivedDate} onChange={(e) => setReceiptForm({ ...receiptForm, receivedDate: e.target.value })} className="bds-input sm" />
                                            <input type="text" value={receiptForm.receivedBy} onChange={(e) => setReceiptForm({ ...receiptForm, receivedBy: e.target.value })} placeholder="收货人" className="bds-input sm" />
                                            <input type="text" value={receiptForm.warehouseName} onChange={(e) => setReceiptForm({ ...receiptForm, warehouseName: e.target.value })} placeholder="入库仓库" className="bds-input sm" />
                                            <input type="number" value={receiptForm.totalReceived} onChange={(e) => setReceiptForm({ ...receiptForm, totalReceived: e.target.value })} placeholder="收货数量 *" className="bds-input sm" />
                                            <input type="number" value={receiptForm.totalAccepted} onChange={(e) => setReceiptForm({ ...receiptForm, totalAccepted: e.target.value })} placeholder="合格数量 *" className="bds-input sm" />
                                            <input type="number" value={receiptForm.totalRejected} onChange={(e) => setReceiptForm({ ...receiptForm, totalRejected: e.target.value })} placeholder="不合格数量 *" className="bds-input sm" />
                                            <input type="text" value={receiptForm.rejectionReason} onChange={(e) => setReceiptForm({ ...receiptForm, rejectionReason: e.target.value })} placeholder="不合格原因" className="bds-input sm" />
                                          </div>
                                          {receiptError && (
                                            <div className="text-xs mb-2" style={{ color: 'var(--danger-text)' }}>{receiptError}</div>
                                          )}
                                          <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => { setShowReceiptForm(null); setReceiptError(null); }} className="bds-btn bds-btn-ghost">
                                              取消
                                            </button>
                                            <button onClick={() => handleCreateReceipt(po.id)} disabled={actionLoading === `receipt_${po.id}`} className="bds-btn bds-btn-primary">
                                              {actionLoading === `receipt_${po.id}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                              <span>登记</span>
                                            </button>
                                          </div>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>

                                  {/* 操作按钮 */}
                                  <div className="flex items-center gap-2 pt-2 flex-wrap">
                                    {po.status === 'Draft' && (
                                      <>
                                        <button onClick={() => handleAction(po.id, 'send')} disabled={actionLoading === `${po.id}_send`} className="bds-btn bds-btn-primary">
                                          {actionLoading === `${po.id}_send` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                          <span>发送采购单</span>
                                        </button>
                                        <button onClick={() => handleAction(po.id, 'delete')} disabled={actionLoading === `${po.id}_delete`} className="bds-btn bds-btn-danger">
                                          {actionLoading === `${po.id}_delete` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                          <span>删除</span>
                                        </button>
                                      </>
                                    )}
                                    {po.status === 'Sent' && (
                                      <>
                                        <button onClick={() => handleAction(po.id, 'confirm')} disabled={actionLoading === `${po.id}_confirm`} className="bds-btn bds-btn-primary">
                                          {actionLoading === `${po.id}_confirm` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                          <span>确认采购单</span>
                                        </button>
                                        <button onClick={() => handleAction(po.id, 'cancel')} disabled={actionLoading === `${po.id}_cancel`} className="bds-btn bds-btn-danger">
                                          {actionLoading === `${po.id}_cancel` ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                          <span>取消</span>
                                        </button>
                                      </>
                                    )}
                                    {canReceive(po.status as PurchaseOrderStatus) && (
                                      <>
                                        <button
                                          onClick={() => { setShowReceiptForm(showReceiptForm === po.id ? null : po.id); setReceiptError(null); }}
                                          className="bds-btn bds-btn-primary"
                                        >
                                          <Package size={12} />
                                          <span>{showReceiptForm === po.id ? '收起' : '登记来料'}</span>
                                        </button>
                                        {po.status !== 'Received' && po.status !== 'Closed' && (
                                          <button onClick={() => handleAction(po.id, 'cancel')} disabled={actionLoading === `${po.id}_cancel`} className="bds-btn bds-btn-danger">
                                            {actionLoading === `${po.id}_cancel` ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                            <span>取消</span>
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {po.status === 'Received' && (
                                      <button onClick={() => handleAction(po.id, 'close')} disabled={actionLoading === `${po.id}_close`} className="bds-btn bds-btn-secondary">
                                        {actionLoading === `${po.id}_close` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                        <span>关闭采购单</span>
                                      </button>
                                    )}
                                    {/* 采购 → 财务联动：采购事实成立后即可生成应付发票（prime+navigate，预填供应商/币种/金额） */}
                                    {onNavigate && ['Confirmed', 'PartiallyReceived', 'Received', 'Closed'].includes(po.status) && (
                                      <button
                                        onClick={() => {
                                          primeFinanceInvoiceCreate({
                                            supplierRelationId: po.supplierRelationId || undefined,
                                            supplierName: po.supplierName || undefined,
                                            currency: po.currency,
                                            amount: Number(po.totalAmount),
                                            notes: `关联采购单 ${po.poNumber}`,
                                          });
                                          onNavigate(View.Invoices);
                                        }}
                                        className="bds-btn bds-btn-secondary"
                                      >
                                        <FileText size={12} />
                                        <span>生成应付发票</span>
                                      </button>
                                    )}
                                    {po.status === 'Closed' && (
                                      <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                                        <CheckCircle2 size={12} />
                                        <span>已关闭 — 终态</span>
                                      </div>
                                    )}
                                    {po.status === 'Cancelled' && (
                                      <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-quaternary)' }}>
                                        <Clock size={12} />
                                        <span>已取消 — 终态</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* 跨模块关联视图（EntityLink 图谱）— 采购供应商/所属订单/来源 BOM/来源报价 */}
                                  <RelatedEntitiesPanel
                                    type="purchaseOrder"
                                    id={po.id}
                                    isDarkMode={isDarkMode}
                                    title="采购关联视图"
                                  />
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
      </div>
    </div>
  );
};

export default ProcurementManager;
