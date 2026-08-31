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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  FileDown,
  Eye,
  X,
  Undo2,
  Pencil,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { hasPermission } from '../services/authService';
import {
  PurchaseOrder,
  PurchaseLine,
  PurchaseOrderStatus,
  PurchaseOrderInput,
  MaterialReceipt,
  MaterialReceiptInput,
  MaterialReturn,
  MaterialReturnType,
  MATERIAL_RETURN_TYPE_LABELS,
  MATERIAL_RETURN_STATUS_LABELS,
  Relation,
  View,
  Warehouse,
} from '../types';
import { primeFinanceInvoiceCreate } from './FinanceManager';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import CustomSelect from './ui/CustomSelect';
import { useStaticEdgeMask } from './ui/useStaticEdgeMask';
import { RelatedWorkspacesSection } from './ui/RelatedWorkspacesSection';
import { consumeCrossModuleNav } from '../services/crossModuleNav';
import { NavRelationFilterChip } from './ui/NavRelationFilterChip';
import A4DocumentPreviewModal from './ui/A4DocumentPreviewModal';
import SupplierInquiryPanel, { SupplierInquiryConvertDraft } from './SupplierInquiryPanel';
import { bdsConfirm } from './ui/BdsDialog';
import { bdsToast } from './ui/bdsToast';

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

// ── P1-4 物料退换货：类型/状态徽章变体 ──
const RETURN_TYPE_BADGE_VARIANT: Record<MaterialReturnType, 'neutral' | 'info' | 'warning' | 'danger'> = {
  return: 'warning',
  exchange: 'info',
  claim: 'danger',
};
const RETURN_STATUS_BADGE_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  shipped: 'info',
  confirmed: 'success',
  settled: 'success',
  cancelled: 'neutral',
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
  // R6 前端权限：写操作按钮按 procurement:write 隐藏（服务端 requireProcurementWrite 为最终门禁）
  const canWrite = hasPermission('procurement:write');
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // 服务端搜索词（300ms 防抖后生效，逐键不直发请求——对齐 SuppliersManager/FinancePaymentRequestsPanel 口径）
  const [appliedSearch, setAppliedSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  // 编辑断头修复：Draft 采购单复用创建表单回填编辑（PUT /:id 仅 Draft）
  const [editingPoId, setEditingPoId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'orders' | 'inquiries'>('orders');
  // 边缘渐隐：固定 mask 挂滚动容器自身（12px 轻微渐隐——修复原 ScrollEdgeFades null-ref 断链，恢复渐隐）
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  useStaticEdgeMask(contentScrollRef, { topFadeEnd: 12, bottomFade: 12 });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [receiptsByPo, setReceiptsByPo] = useState<Record<string, MaterialReceipt[]>>({});
  const [showReceiptForm, setShowReceiptForm] = useState<string | null>(null);
  // ── P1-4 物料退换货（退货/换货/索赔）──
  const [returnsByPo, setReturnsByPo] = useState<Record<string, MaterialReturn[]>>({});
  const [showReturnForm, setShowReturnForm] = useState<{ receipt: MaterialReceipt; po: PurchaseOrder } | null>(null);
  const [returnForm, setReturnForm] = useState({
    type: 'return' as MaterialReturnType,
    materialCode: '',
    quantity: '',
    unit: '',
    amount: '',
    reason: '',
    notes: '',
  });
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnActing, setReturnActing] = useState<string | null>(null);

  // ── B2 运营域单据：PO 文档预览/生成（服务端模板真源，与单据中心归档同源） ──
  const [previewPo, setPreviewPo] = useState<PurchaseOrder | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [docGeneratedMsg, setDocGeneratedMsg] = useState<string | null>(null);

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
    setEditingPoId(null); // 订单 prime 永远进入新建态
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

  // 来料检验表单状态（D5 仓库下拉选 warehouseId；D6 行级明细为真源，单头合计由行级累加派生）
  const [receiptForm, setReceiptForm] = useState({
    receiptNumber: '',
    receivedDate: new Date().toISOString().split('T')[0],
    receivedBy: '',
    warehouseId: '',
    rejectionReason: '',
    qualityNotes: '',
  });
  // D6 行级收货输入态：lineId → 本次合格/不合格（字符串，空 = 未收）
  const [receiptLines, setReceiptLines] = useState<Record<string, { accepted: string; rejected: string }>>({});
  const [receiptError, setReceiptError] = useState<string | null>(null);
  // D5：入库仓库下拉数据源（收货表单用）
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // ── 拉取数据 ──
  // 跨模块导航筛选（关系智库供应商档案「关联业务 → 采购」入口）：挂载时消费一次；
  // supplierRelationId 下推服务端过滤（与台账导出口径一致，不再客户端截断首 100 条）
  const [navRelationFilter, setNavRelationFilter] = useState(() => consumeCrossModuleNav()?.filter ?? null);

  // 搜索防抖：300ms 内连续输入合并为一次服务端查询
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const fetchPurchaseOrders = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const result = await apiService.listPurchaseOrders({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: appliedSearch || undefined,
        supplierRelationId: navRelationFilter?.relationId || undefined,
        limit: 100,
        offset,
      });
      setTotal(result.total);
      setPurchaseOrders(prev => (offset > 0 ? [...prev, ...result.items] : result.items));
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [statusFilter, appliedSearch, navRelationFilter]);

  useEffect(() => { fetchPurchaseOrders(); }, [fetchPurchaseOrders]);

  useEffect(() => {
    apiService.listRelations().then(setRelations).catch(() => {});
  }, []);

  // D5：入库仓库下拉数据源（收货表单用）
  useEffect(() => {
    apiService.listWarehouses().then(setWarehouses).catch(() => {});
  }, []);

  // ── C7：询价一键转采购单（已比价询价单 → 新建采购单预填：供应商/币种/条款/行明细） ──
  const handleConvertInquiry = useCallback((draft: SupplierInquiryConvertDraft) => {
    setCreatePrime(null); // 询价来源与订单 prime 互斥，避免关联备注串味
    setEditingPoId(null); // 与编辑态互斥：转采购单永远进入新建
    setForm(prev => ({
      ...prev,
      currency: draft.currency || prev.currency,
      supplierRelationId: draft.supplierRelationId ?? '',
      supplierName: draft.supplierName ?? '',
      expectedDeliveryDate: draft.expectedDeliveryDate || prev.expectedDeliveryDate,
      deliveryTerms: draft.deliveryTerms || prev.deliveryTerms,
      paymentTerms: draft.paymentTerms || prev.paymentTerms,
      buyer: draft.buyer || prev.buyer,
      notes: `来自询价单 ${draft.inquiryNumber}`,
    }));
    setFormLines([{
      ...createEmptyLine(),
      materialCode: draft.line.materialCode ?? '',
      description: draft.line.description,
      quantity: draft.line.quantity != null ? String(draft.line.quantity) : '',
      unit: draft.line.unit || 'YD',
    }]);
    setFormError(null);
    setViewMode('orders');
    setShowCreateForm(true);
  }, []);

  // D6：行级收货合计（行级为真源，单头合计派生只读展示）
  const receiptTotals = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    for (const v of Object.values(receiptLines)) {
      accepted += v.accepted.trim() ? Number(v.accepted) || 0 : 0;
      rejected += v.rejected.trim() ? Number(v.rejected) || 0 : 0;
    }
    return { accepted, rejected };
  }, [receiptLines]);

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
    if (action === 'delete' || action === 'cancel') {
      const poNumber = purchaseOrders.find(p => p.id === id)?.poNumber;
      const label = poNumber ? ` ${poNumber}` : '';
      const ok = await bdsConfirm(action === 'delete'
        ? { title: `删除采购单${label}`, body: '仅草稿状态可删除；确认删除该采购单？此操作不可撤销。', danger: true }
        : { title: `取消采购单${label}`, body: '确认取消该采购单？取消后进入终态，不可恢复。', danger: true });
      if (!ok) return;
    }
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
  }, [fetchPurchaseOrders, purchaseOrders]);

  // ── B2 运营域单据：PO 预览 / 生成 PDF / 台账导出 ──

  /** 预览 PO 单据（服务端模板实时渲染，A4 纸张画布——与生成 PDF 同源排版） */
  const handlePreviewPo = useCallback(async (po: PurchaseOrder) => {
    setPreviewPo(po);
    setPreviewHtml('');
    setPreviewErr(null);
    setPreviewLoading(true);
    try {
      const html = await apiService.getPurchaseOrderPreviewHtml(po.id);
      setPreviewHtml(html);
    } catch (e: any) {
      setPreviewErr(`PO 预览加载失败：${e?.message || e}`);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  /** 生成 PO PDF（登记域单据 domain=procurement → 单据中心归档 → 下载） */
  const handleGeneratePoDocument = useCallback(async (po: PurchaseOrder) => {
    setActionLoading(`${po.id}_gendoc`);
    setError(null);
    try {
      const result = await apiService.generatePurchaseOrderDocument(po.id);
      setError(null);
      setPreviewErr(null);
      window.setTimeout(() => setError(null), 0);
      // 成功提示走轻量 alert（模块内无全局 toast；与生成应付发票成功路径一致的静默策略）
      setDocGeneratedMsg(`已生成 ${result.documentNumber}（${Math.round(result.fileSize / 1024)} KB），归档至单据中心`);
    } catch (e: any) {
      setError(`生成 PO 文档失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  /** 采购台账 Excel 导出（当前筛选条件全量） */
  const handleExportXlsx = useCallback(async () => {
    setExportingXlsx(true);
    try {
      await apiService.exportPurchaseOrdersXlsx({
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
        ...(navRelationFilter?.relationId ? { supplierRelationId: navRelationFilter.relationId } : {}),
      });
    } catch (e: any) {
      setError(`台账导出失败：${e?.message || e}`);
    } finally {
      setExportingXlsx(false);
    }
  }, [statusFilter, searchQuery, navRelationFilter]);

  // ── 拉取来料记录 ──
  const fetchReceipts = useCallback(async (poId: string) => {
    try {
      const receipts = await apiService.listMaterialReceipts(poId);
      setReceiptsByPo(prev => ({ ...prev, [poId]: receipts }));
    } catch {
      // 静默失败，不影响主列表
    }
  }, []);

  // ── P1-4：拉取退换货记录（展开采购单时随来料记录一并加载）──
  const fetchMaterialReturns = useCallback(async (poId: string) => {
    try {
      const items = await apiService.listMaterialReturns({ purchaseOrderId: poId });
      setReturnsByPo(prev => ({ ...prev, [poId]: items }));
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
      fetchMaterialReturns(poId);
    }
  }, [expandedId, fetchReceipts, fetchMaterialReturns]);

  // ── 表单重置（创建/编辑/取消共用；修复取消后表单残留） ──
  const resetPoForm = useCallback(() => {
    setForm({
      poNumber: '', currency: 'USD', supplierRelationId: '', supplierName: '',
      orderDate: new Date().toISOString().split('T')[0], expectedDeliveryDate: '',
      deliveryTerms: 'FOB Shanghai', paymentTerms: 'T/T 30% deposit, 70% before shipment',
      shipToAddress: '', buyer: '', notes: '',
    });
    setFormLines([createEmptyLine()]);
    setFormError(null);
    setCreatePrime(null);
    setEditingPoId(null);
  }, []);

  // ── Draft 编辑入口：回填创建表单 → PUT /:id（后端仅 Draft 可编辑） ──
  const handleEditPo = useCallback((po: PurchaseOrder) => {
    setCreatePrime(null);
    setEditingPoId(po.id);
    setForm({
      poNumber: po.poNumber,
      currency: po.currency,
      supplierRelationId: po.supplierRelationId ?? '',
      supplierName: po.supplierName ?? '',
      orderDate: po.orderDate || new Date().toISOString().split('T')[0],
      expectedDeliveryDate: po.expectedDeliveryDate ?? '',
      deliveryTerms: po.deliveryTerms ?? '',
      paymentTerms: po.paymentTerms ?? '',
      shipToAddress: po.shipToAddress ?? '',
      buyer: po.buyer ?? '',
      notes: po.notes ?? '',
    });
    const lines = po.lines ?? [];
    setFormLines(lines.length > 0 ? lines.map(l => ({
      key: newLineKey(),
      materialCode: l.materialCode ?? '',
      description: l.description ?? '',
      category: l.category ?? 'Fabric',
      specification: l.specification ?? '',
      quantity: String(l.quantity ?? ''),
      unit: l.unit || 'YD',
      unitPrice: String(l.unitPrice ?? ''),
      notes: l.notes ?? '',
    })) : [createEmptyLine()]);
    setFormError(null);
    setShowCreateForm(true);
  }, []);

  /** 表单是否已填写内容（取消时据此 bdsConfirm 弃稿确认） */
  const isPoFormDirty = useCallback(() => {
    if (editingPoId) return true; // 编辑态预填非空，取消一律确认弃稿
    return Boolean(form.poNumber || form.supplierRelationId || form.buyer || form.shipToAddress || form.notes)
      || formLines.some(l => l.materialCode || l.description || l.specification || l.quantity || l.unitPrice || l.notes);
  }, [editingPoId, form, formLines]);

  // ── 取消/返回列表：脏表单 bdsConfirm 弃稿，干净表单直接重置（修复取消残留） ──
  const handleCancelForm = useCallback(async () => {
    if (isPoFormDirty()) {
      const ok = await bdsConfirm({
        title: editingPoId ? '放弃对采购单的修改？' : '放弃新建采购单草稿？',
        body: '表单中已填写的内容不会被保存。',
        danger: true,
      });
      if (!ok) return;
    }
    resetPoForm();
    setShowCreateForm(false);
  }, [isPoFormDirty, editingPoId, resetPoForm]);

  // ── 提交采购单（新建 POST / 编辑 PUT，编辑仅 Draft） ──
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
        orderId: editingPoId ? undefined : createPrime?.orderId,
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
      if (editingPoId) {
        await apiService.updatePurchaseOrder(editingPoId, input);
        bdsToast.success(`采购单 ${form.poNumber} 已更新。`);
      } else {
        await apiService.createPurchaseOrder(input);
        bdsToast.success(`采购单 ${form.poNumber} 已创建。`);
      }
      setShowCreateForm(false);
      resetPoForm();
      await fetchPurchaseOrders();
    } catch (e: any) {
      setFormError(`${editingPoId ? '保存' : '创建'}失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [form, formLines, createPrime, editingPoId, resetPoForm, fetchPurchaseOrders]);

  // ── 创建来料检验记录（D5 仓库下拉生效；D6 行级明细为真源，单头合计由行级累加派生） ──
  const handleCreateReceipt = useCallback(async (poId: string) => {
    setReceiptError(null);
    if (!receiptForm.receiptNumber) { setReceiptError('请填写收料单号'); return; }
    if (!receiptForm.receivedDate) { setReceiptError('请填写收货日期'); return; }

    const po = purchaseOrders.find(p => p.id === poId);
    const lines = po?.lines ?? [];
    // D6：逐行解析本次收货数量（空 = 未收），行级明细为真源
    const lineReceipts: Array<{ lineId: string; accepted: number; rejected: number }> = [];
    for (const line of lines) {
      const draft = receiptLines[line.id];
      const acc = draft?.accepted?.trim() ? Number(draft.accepted) : 0;
      const rej = draft?.rejected?.trim() ? Number(draft.rejected) : 0;
      if (!Number.isFinite(acc) || acc < 0 || !Number.isFinite(rej) || rej < 0) {
        setReceiptError(`行 ${line.lineNumber} 收货数量非法（须为非负数字）`); return;
      }
      if (acc > 0 || rej > 0) lineReceipts.push({ lineId: line.id, accepted: acc, rejected: rej });
    }
    if (lineReceipts.length === 0) { setReceiptError('请至少填写一行的本次收货数量'); return; }
    const totalAccepted = lineReceipts.reduce((s, l) => s + l.accepted, 0);
    const totalRejected = lineReceipts.reduce((s, l) => s + l.rejected, 0);
    const totalReceived = totalAccepted + totalRejected;

    setActionLoading(`receipt_${poId}`);
    try {
      // D5：仓库下拉选定 → warehouseId + 名称快照一并提交（后端落库并随事件透传，不再永远进主仓）
      const warehouse = warehouses.find(w => w.id === receiptForm.warehouseId);
      const input = {
        receiptNumber: receiptForm.receiptNumber,
        receivedDate: receiptForm.receivedDate,
        receivedBy: receiptForm.receivedBy || undefined,
        warehouseId: warehouse?.id || undefined,
        warehouseName: warehouse?.name || undefined,
        totalReceived,
        totalAccepted,
        totalRejected,
        rejectionReason: receiptForm.rejectionReason || undefined,
        qualityNotes: receiptForm.qualityNotes || undefined,
        // D6 行级明细（后端契约字段；前端 MaterialReceiptInput 类型未含——types.ts 不在本车道租约内，断言透传）
        lineReceipts,
      } as MaterialReceiptInput & { lineReceipts: typeof lineReceipts };
      await apiService.createMaterialReceipt(poId, input);
      setShowReceiptForm(null);
      // 重置来料表单
      setReceiptForm({
        receiptNumber: '', receivedDate: new Date().toISOString().split('T')[0],
        receivedBy: '', warehouseId: '', rejectionReason: '', qualityNotes: '',
      });
      setReceiptLines({});
      await fetchReceipts(poId);
      await fetchPurchaseOrders();
    } catch (e: any) {
      setReceiptError(`登记失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [receiptForm, receiptLines, purchaseOrders, warehouses, fetchReceipts, fetchPurchaseOrders]);

  // ── P1-4：登记退换货/索赔 ──
  const handleCreateReturn = useCallback(async () => {
    if (!showReturnForm) return;
    setReturnError(null);
    const type = returnForm.type;
    const quantity = returnForm.quantity === '' ? 0 : Number(returnForm.quantity);
    if (type !== 'claim' && !(quantity > 0)) { setReturnError('退货/换货数量必须大于 0'); return; }
    if (type !== 'claim' && !returnForm.materialCode.trim()) { setReturnError('请填写退货物料编码（库存联动锚点）'); return; }
    if (type === 'claim' && (returnForm.amount === '' || !(Number(returnForm.amount) > 0))) {
      setReturnError('索赔必须填写索赔金额（正数）'); return;
    }
    setReturnActing('create');
    try {
      await apiService.createMaterialReturn({
        receiptId: showReturnForm.receipt.id,
        type,
        materialCode: returnForm.materialCode.trim() || undefined,
        quantity,
        unit: returnForm.unit.trim() || undefined,
        amount: returnForm.amount === '' ? undefined : Number(returnForm.amount),
        reason: returnForm.reason.trim() || undefined,
        notes: returnForm.notes.trim() || undefined,
      });
      bdsToast.success('退换货已登记（待退回）。');
      setShowReturnForm(null);
      await fetchMaterialReturns(showReturnForm.po.id);
    } catch (e: any) {
      setReturnError(`登记失败：${e?.message ?? e}`);
    } finally {
      setReturnActing(null);
    }
  }, [showReturnForm, returnForm, fetchMaterialReturns]);

  // ── P1-4：退换货状态推进（发运确认 / 供应商确认 / 结算 / 取消）──
  const handleReturnAction = useCallback(async (poId: string, ret: MaterialReturn, action: 'mark-shipped' | 'confirm' | 'settle' | 'cancel') => {
    if (returnActing) return;
    if (action === 'cancel') {
      const ok = await bdsConfirm({
        title: `取消退换单 ${ret.returnNumber}`,
        body: '仅待退回状态可取消；确认取消该退换货登记？',
        danger: true,
      });
      if (!ok) return;
    }
    setReturnActing(`${ret.id}_${action}`);
    try {
      if (action === 'mark-shipped') {
        const r = await apiService.markMaterialReturnShipped(ret.id);
        bdsToast.success(r.skipStockReason
          ? `已发运确认（注：${r.skipStockReason}）。`
          : `退换单 ${ret.returnNumber} 已发运确认${ret.type === 'exchange' ? '（库存已冲减，供应商确认后回冲）' : '（库存已冲减）'}。`);
      } else if (action === 'confirm') {
        const r = await apiService.confirmMaterialReturn(ret.id);
        bdsToast.success(r.claimInvoiceId
          ? '供应商已确认；索赔贷项发票已生成（冲减应付余额，可在供应商对账单查看）。'
          : `供应商已确认 ${ret.returnNumber}。`);
      } else if (action === 'settle') {
        await apiService.settleMaterialReturn(ret.id);
        bdsToast.success(`退换单 ${ret.returnNumber} 结算完成。`);
      } else {
        await apiService.cancelMaterialReturn(ret.id);
        bdsToast.success(`退换单 ${ret.returnNumber} 已取消。`);
      }
      await fetchMaterialReturns(poId);
    } catch (e: any) {
      bdsToast.danger(`操作失败：${e?.message ?? e}`);
    } finally {
      setReturnActing(null);
    }
  }, [returnActing, fetchMaterialReturns]);

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
      <PageHeader
        title="采购管理"
        subtitle="Procurement"
        isDarkMode={isDarkMode}
        actions={viewMode === 'orders' && !showCreateForm && canWrite ? (
          <button onClick={() => { resetPoForm(); setShowCreateForm(true); }} className="bds-btn bds-btn-primary">
            <Plus size={14} /><span>新建采购单</span>
          </button>
        ) : undefined}
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <div className="bds-segment mb-3">
          <button className={`seg ${viewMode === 'orders' ? 'active' : ''}`} onClick={() => setViewMode('orders')}>采购单</button>
          <button className={`seg ${viewMode === 'inquiries' ? 'active' : ''}`} onClick={() => setViewMode('inquiries')}>供应商询价</button>
        </div>
        <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          <AnimatePresence mode="wait">
            {viewMode === 'inquiries' ? (
              <motion.div key="inquiries-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <SupplierInquiryPanel isDarkMode={isDarkMode} onConvertToPurchaseOrder={handleConvertInquiry} />
              </motion.div>
            ) : showCreateForm ? (
              <motion.div key="create-form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                {/* 创建表单 */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <h2 className="text-lg font-light" style={{ color: 'var(--text-primary)' }}>{editingPoId ? '编辑采购单' : '新建采购单'}</h2>
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
                          <X size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                  <button onClick={() => void handleCancelForm()} className="bds-btn bds-btn-secondary">
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
                        <CustomSelect
                          options={CURRENCIES.map(c => ({ value: c, label: c }))}
                          value={form.currency}
                          onChange={(v) => setForm({ ...form, currency: v })}
                          surface="form"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>下单日期 *</label>
                        <CapsuleDateInput value={form.orderDate} onChange={(v) => setForm({ ...form, orderDate: v })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>预计交货日期</label>
                        <CapsuleDateInput value={form.expectedDeliveryDate} onChange={(v) => setForm({ ...form, expectedDeliveryDate: v })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>供应商</label>
                        <CustomSelect
                          options={[
                            { value: '', label: '选择供应商...' },
                            ...supplierOptions.map(s => ({ value: s.id, label: `${s.label} (${s.chineseName})` })),
                          ]}
                          value={form.supplierRelationId}
                          onChange={(v) => {
                            const rel = relations.find(r => r.id === v);
                            setForm({ ...form, supplierRelationId: v, supplierName: rel?.englishName || rel?.chineseName || '' });
                          }}
                          surface="form"
                        />
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
                        <Plus size={14} /> 添加行
                      </button>
                    </div>
                    <div className="space-y-2">
                      {formLines.map((line) => (
                        <div key={line.key} className="p-3 rounded-inset bds-inset">
                          <div className="flex items-center justify-between mb-2">
                            <span className="bds-mono text-xs" style={{ color: 'var(--text-quaternary)' }}>行 {formLines.indexOf(line) + 1}</span>
                            {formLines.length > 1 && (
                              <button onClick={() => removeFormLine(line.key)} className="p-1 rounded-control transition-colors" style={{ color: 'var(--text-quaternary)' }}>
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
                            <input type="text" value={line.materialCode} onChange={(e) => updateFormLine(line.key, 'materialCode', e.target.value)} placeholder="物料编码" className="bds-input sm" />
                            <input type="text" value={line.description} onChange={(e) => updateFormLine(line.key, 'description', e.target.value)} placeholder="品名描述 *" className="bds-input sm xl:col-span-2" />
                            <CustomSelect
                              options={LINE_CATEGORIES.map(c => ({ value: c, label: c }))}
                              value={line.category}
                              onChange={(v) => updateFormLine(line.key, 'category', v)}
                              surface="form"
                              size="compact"
                            />
                            <input type="number" value={line.quantity} onChange={(e) => updateFormLine(line.key, 'quantity', e.target.value)} placeholder="数量 *" className="bds-input sm" />
                            <CustomSelect
                              options={UNITS.map(u => ({ value: u, label: u }))}
                              value={line.unit}
                              onChange={(v) => updateFormLine(line.key, 'unit', v)}
                              surface="form"
                              size="compact"
                            />
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
                    <button onClick={() => void handleCancelForm()} className="bds-btn bds-btn-ghost">
                      取消
                    </button>
                    <button onClick={handleCreate} disabled={actionLoading === 'create'} className="bds-btn bds-btn-primary">
                      {actionLoading === 'create' ? <Loader2 size={16} className="animate-spin" /> : editingPoId ? <CheckCircle2 size={16} /> : <Plus size={16} />}
                      <span>{editingPoId ? '保存修改' : '创建采购单'}</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                {/* 工具栏：过滤控件组合 → filterbar 玻璃条（主操作已收编 PageHeader） */}
                {navRelationFilter && (
                  <NavRelationFilterChip filter={navRelationFilter} label="采购" onClear={() => setNavRelationFilter(null)} />
                )}
                <div className="bds-filterbar mb-4">
                  <div className="relative flex-1 max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索采购号/供应商..." className="bds-input sm pl-9" />
                  </div>
                  <button onClick={() => fetchPurchaseOrders()} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  </button>
                  {/* B2 运营域报表：采购台账 Excel 导出（当前筛选全量） */}
                  <button onClick={handleExportXlsx} disabled={exportingXlsx} className="bds-btn bds-btn-secondary">
                    {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                    <span>导出台账</span>
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

                {/* B2 文档生成成功提示 */}
                {docGeneratedMsg && (
                  <div className="bds-alert success mb-3">
                    <CheckCircle2 size={16} />
                    <span>{docGeneratedMsg}</span>
                    <button onClick={() => setDocGeneratedMsg(null)} className="ml-auto p-0.5" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}>
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
                    <div className="title">{navRelationFilter ? '该供应商暂无采购单' : '暂无采购单'}</div>
                    <div className="desc">{navRelationFilter ? '当前为跨模块筛选视图，点上方 ✕ 查看全部' : '点击「新建采购单」开始'}</div>
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
                              <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
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

                                  {/* 行明细表（8 列窄屏溢出：overflow-hidden → overflow-x-auto 横向滚动） */}
                                  {po.lines && po.lines.length > 0 && (
                                    <div className="rounded-inset overflow-x-auto bds-inset">
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
                                          <div key={rc.id} className="p-2.5 rounded-inset flex items-center gap-3 text-xs bds-inset">
                                            <Package size={14} style={{ color: 'var(--text-quaternary)' }} />
                                            <span className="bds-mono" style={{ color: 'var(--text-primary)' }}>{rc.receiptNumber}</span>
                                            <span className={`bds-badge sm ${RECEIPT_STATUS_BADGE_VARIANT[rc.status] || 'neutral'}`}>
                                              {RECEIPT_STATUS_LABELS[rc.status] || rc.status}
                                            </span>
                                            <span style={{ color: 'var(--text-tertiary)' }}>{formatDate(rc.receivedDate)}</span>
                                            <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>
                                              合格 {Number(rc.totalAccepted).toLocaleString('en-US')} / 不合格 {Number(rc.totalRejected).toLocaleString('en-US')}
                                            </span>
                                            {rc.warehouseName && (
                                              <span style={{ color: 'var(--text-quaternary)' }}>· {rc.warehouseName}</span>
                                            )}
                                            {/* P1-4：有不合格数量 → 退换/索赔入口（写操作按 procurement:write 隐藏） */}
                                            {canWrite && Number(rc.totalRejected) > 0 && (
                                              <button
                                                type="button"
                                                className="bds-btn bds-btn-ghost"
                                                onClick={() => {
                                                  setShowReturnForm({ receipt: rc, po });
                                                  const firstLine = po.lines?.[0];
                                                  setReturnForm({
                                                    type: 'return',
                                                    materialCode: firstLine?.materialCode ?? '',
                                                    quantity: String(Number(rc.totalRejected)),
                                                    unit: firstLine?.unit ?? '',
                                                    amount: '',
                                                    reason: rc.rejectionReason ?? '',
                                                    notes: '',
                                                  });
                                                  setReturnError(null);
                                                }}
                                              >
                                                <Undo2 size={13} /> 退换/索赔
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* P1-4 退换货 / 索赔记录（状态机推进 + 索赔贷项标识） */}
                                  {(() => {
                                    const returns = returnsByPo[po.id] || [];
                                    if (returns.length === 0) return null;
                                    return (
                                      <div>
                                        <h4 className="bds-overline mb-2" style={{ color: 'var(--text-tertiary)' }}>退换货 / 索赔</h4>
                                        <div className="space-y-1.5">
                                          {returns.map(ret => (
                                            <div key={ret.id} className="p-2.5 rounded-inset flex flex-wrap items-center gap-2 text-xs bds-inset">
                                              <Undo2 size={14} style={{ color: 'var(--text-quaternary)' }} />
                                              <span className="bds-mono" style={{ color: 'var(--text-primary)' }}>{ret.returnNumber}</span>
                                              <span className={`bds-badge sm ${RETURN_TYPE_BADGE_VARIANT[ret.type] ?? 'neutral'}`}>
                                                {MATERIAL_RETURN_TYPE_LABELS[ret.type] ?? ret.type}
                                              </span>
                                              <span className={`bds-badge sm ${RETURN_STATUS_BADGE_VARIANT[ret.status] ?? 'neutral'}`}>
                                                {MATERIAL_RETURN_STATUS_LABELS[ret.status] ?? ret.status}
                                              </span>
                                              <span className="bds-tnum" style={{ color: 'var(--text-tertiary)' }}>
                                                {Number(ret.quantity).toLocaleString('en-US')}{ret.unit ? ` ${ret.unit}` : ''}
                                                {ret.amount != null ? ` · ${ret.currency} ${Number(ret.amount).toLocaleString('en-US')}` : ''}
                                              </span>
                                              {ret.materialCode && (
                                                <span style={{ color: 'var(--text-quaternary)' }}>{ret.materialCode}</span>
                                              )}
                                              {ret.claimInvoiceId && <span className="bds-badge sm info">索赔贷项已生成</span>}
                                              {canWrite && (
                                              <div className="ml-auto flex items-center gap-1.5">
                                                {ret.status === 'pending' && (
                                                  <>
                                                    <button type="button" className="bds-btn bds-btn-ghost" disabled={returnActing !== null} onClick={() => handleReturnAction(po.id, ret, 'mark-shipped')}>
                                                      {returnActing === `${ret.id}_mark-shipped` ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}发运确认
                                                    </button>
                                                    <button type="button" className="bds-btn bds-btn-ghost" disabled={returnActing !== null} onClick={() => handleReturnAction(po.id, ret, 'cancel')}>
                                                      取消
                                                    </button>
                                                  </>
                                                )}
                                                {ret.status === 'shipped' && (
                                                  <button type="button" className="bds-btn bds-btn-ghost" disabled={returnActing !== null} onClick={() => handleReturnAction(po.id, ret, 'confirm')}>
                                                    {returnActing === `${ret.id}_confirm` ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}供应商确认
                                                  </button>
                                                )}
                                                {ret.status === 'confirmed' && (
                                                  <button type="button" className="bds-btn bds-btn-ghost" disabled={returnActing !== null} onClick={() => handleReturnAction(po.id, ret, 'settle')}>
                                                    结算完成
                                                  </button>
                                                )}
                                              </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* 来料检验表单 */}
                                  <AnimatePresence>
                                    {showReceiptForm === po.id && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="p-3 rounded-inset bds-inset">
                                          <h4 className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>登记来料检验</h4>
                                          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-2">
                                            <input type="text" value={receiptForm.receiptNumber} onChange={(e) => setReceiptForm({ ...receiptForm, receiptNumber: e.target.value })} placeholder="收料单号 *" className="bds-input sm" />
                                            <CapsuleDateInput value={receiptForm.receivedDate} onChange={(v) => setReceiptForm({ ...receiptForm, receivedDate: v })} className="bds-input sm" />
                                            <input type="text" value={receiptForm.receivedBy} onChange={(e) => setReceiptForm({ ...receiptForm, receivedBy: e.target.value })} placeholder="收货人" className="bds-input sm" />
                                            {/* D5：入库仓库下拉（选定真实落点；不选 = 默认主仓，与 L8 兜底口径一致） */}
                                            <CustomSelect
                                              options={[
                                                { value: '', label: '入库仓库（默认主仓）' },
                                                ...warehouses.map(w => ({ value: w.id, label: w.name })),
                                              ]}
                                              value={receiptForm.warehouseId}
                                              onChange={(v) => setReceiptForm({ ...receiptForm, warehouseId: v })}
                                              surface="form"
                                            />
                                          </div>
                                          {/* D6 行级收货明细（真源：每行本次收了多少；单头合计由行级累加派生） */}
                                          <div className="mb-2">
                                            <div className="text-xs mb-1" style={{ color: 'var(--text-quaternary)' }}>行级收货明细（本次合格 / 本次不合格）</div>
                                            <div className="space-y-1.5">
                                              {(po.lines ?? []).map(line => {
                                                const draft = receiptLines[line.id] ?? { accepted: '', rejected: '' };
                                                return (
                                                  <div key={line.id} className="grid grid-cols-2 xl:grid-cols-4 gap-2 items-center p-2 rounded-inset bds-inset">
                                                    <div className="col-span-2 min-w-0">
                                                      <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                                                        行{line.lineNumber} · {line.description}
                                                      </div>
                                                      <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>
                                                        订单 {Number(line.quantity).toLocaleString('en-US')} {line.unit} · 已收 {Number(line.receivedQuantity ?? 0).toLocaleString('en-US')}
                                                      </div>
                                                    </div>
                                                    <input
                                                      type="number" min="0" value={draft.accepted}
                                                      onChange={(e) => setReceiptLines(prev => ({ ...prev, [line.id]: { ...draft, accepted: e.target.value } }))}
                                                      placeholder="本次合格" className="bds-input sm"
                                                    />
                                                    <input
                                                      type="number" min="0" value={draft.rejected}
                                                      onChange={(e) => setReceiptLines(prev => ({ ...prev, [line.id]: { ...draft, rejected: e.target.value } }))}
                                                      placeholder="本次不合格" className="bds-input sm"
                                                    />
                                                  </div>
                                                );
                                              })}
                                            </div>
                                            <div className="text-xs mt-1.5 text-right" style={{ color: 'var(--text-tertiary)' }}>
                                              合计：合格 <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{receiptTotals.accepted}</span>
                                              {' '}· 不合格 <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{receiptTotals.rejected}</span>
                                            </div>
                                          </div>
                                          <div className="grid grid-cols-2 gap-2 mb-2">
                                            <input type="text" value={receiptForm.rejectionReason} onChange={(e) => setReceiptForm({ ...receiptForm, rejectionReason: e.target.value })} placeholder="不合格原因" className="bds-input sm" />
                                            <input type="text" value={receiptForm.qualityNotes} onChange={(e) => setReceiptForm({ ...receiptForm, qualityNotes: e.target.value })} placeholder="质检备注" className="bds-input sm" />
                                          </div>
                                          {receiptError && (
                                            <div className="text-xs mb-2" style={{ color: 'var(--danger-text)' }}>{receiptError}</div>
                                          )}
                                          <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => { setShowReceiptForm(null); setReceiptError(null); }} className="bds-btn bds-btn-ghost">
                                              取消
                                            </button>
                                            <button onClick={() => handleCreateReceipt(po.id)} disabled={actionLoading === `receipt_${po.id}`} className="bds-btn bds-btn-primary">
                                              {actionLoading === `receipt_${po.id}` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                              <span>登记</span>
                                            </button>
                                          </div>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>

                                  {/* P1-4 退换货/索赔登记表单（锚定不合格来料检验单） */}
                                  <AnimatePresence>
                                    {showReturnForm?.po.id === po.id && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="p-3 rounded-inset bds-inset">
                                          <h4 className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
                                            登记退换货 / 索赔 · {showReturnForm.receipt.receiptNumber}（不合格 {Number(showReturnForm.receipt.totalRejected).toLocaleString('en-US')}）
                                          </h4>
                                          <p className="text-[10px] mb-2" style={{ color: 'var(--text-quaternary)' }}>
                                            退货/换货发运确认时冲减库存；换货供应商确认后回冲；索赔确认时生成贷项发票冲减应付并计入供应商绩效。
                                          </p>
                                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                            {(['return', 'exchange', 'claim'] as const).map(t => (
                                              <button
                                                key={t}
                                                type="button"
                                                onClick={() => setReturnForm({ ...returnForm, type: t })}
                                                className={`bds-badge sm cursor-pointer ${returnForm.type === t ? RETURN_TYPE_BADGE_VARIANT[t] : 'neutral'}`}
                                              >
                                                {MATERIAL_RETURN_TYPE_LABELS[t]}
                                              </button>
                                            ))}
                                          </div>
                                          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-2">
                                            <input type="text" value={returnForm.materialCode} onChange={(e) => setReturnForm({ ...returnForm, materialCode: e.target.value })} placeholder={returnForm.type === 'claim' ? '物料编码（可选）' : '退货物料编码 *'} className="bds-input sm" />
                                            <input type="number" value={returnForm.quantity} onChange={(e) => setReturnForm({ ...returnForm, quantity: e.target.value })} placeholder={returnForm.type === 'claim' ? '数量（索赔可 0）' : '退货/换货数量 *'} className="bds-input sm" />
                                            <input type="text" value={returnForm.unit} onChange={(e) => setReturnForm({ ...returnForm, unit: e.target.value })} placeholder="单位" className="bds-input sm" />
                                            <input type="number" value={returnForm.amount} onChange={(e) => setReturnForm({ ...returnForm, amount: e.target.value })} placeholder={returnForm.type === 'claim' ? '索赔金额 *' : '折让金额（可选）'} className="bds-input sm" />
                                            <input type="text" value={returnForm.reason} onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })} placeholder="原因（缺省取不合格原因）" className="bds-input sm" />
                                            <input type="text" value={returnForm.notes} onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })} placeholder="备注" className="bds-input sm" />
                                          </div>
                                          {returnError && (
                                            <div className="text-xs mb-2" style={{ color: 'var(--danger-text)' }}>{returnError}</div>
                                          )}
                                          <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => { setShowReturnForm(null); setReturnError(null); }} className="bds-btn bds-btn-ghost">
                                              取消
                                            </button>
                                            <button onClick={handleCreateReturn} disabled={returnActing !== null} className="bds-btn bds-btn-primary">
                                              {returnActing === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                                              <span>登记</span>
                                            </button>
                                          </div>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>

                                  {/* 操作按钮（写操作按 procurement:write 隐藏；预览/生成 PDF/导出发票 prime 为只读或跨域入口，保留） */}
                                  <div className="flex items-center gap-2 pt-2 flex-wrap">
                                    {canWrite && po.status === 'Draft' && (
                                      <>
                                        {/* 编辑断头修复：Draft 可回填编辑（PUT /:id 仅 Draft） */}
                                        <button onClick={() => handleEditPo(po)} className="bds-btn bds-btn-secondary">
                                          <Pencil size={14} />
                                          <span>编辑</span>
                                        </button>
                                        <button onClick={() => handleAction(po.id, 'send')} disabled={actionLoading === `${po.id}_send`} className="bds-btn bds-btn-secondary">
                                          {actionLoading === `${po.id}_send` ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                          <span>发送采购单</span>
                                        </button>
                                        <button onClick={() => handleAction(po.id, 'delete')} disabled={actionLoading === `${po.id}_delete`} className="bds-btn bds-btn-danger">
                                          {actionLoading === `${po.id}_delete` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                          <span>删除</span>
                                        </button>
                                      </>
                                    )}
                                    {canWrite && po.status === 'Sent' && (
                                      <>
                                        <button onClick={() => handleAction(po.id, 'confirm')} disabled={actionLoading === `${po.id}_confirm`} className="bds-btn bds-btn-secondary">
                                          {actionLoading === `${po.id}_confirm` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                          <span>确认采购单</span>
                                        </button>
                                        <button onClick={() => handleAction(po.id, 'cancel')} disabled={actionLoading === `${po.id}_cancel`} className="bds-btn bds-btn-danger">
                                          {actionLoading === `${po.id}_cancel` ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                                          <span>取消</span>
                                        </button>
                                      </>
                                    )}
                                    {canWrite && canReceive(po.status as PurchaseOrderStatus) && (
                                      <>
                                        <button
                                          onClick={() => {
                                            if (showReceiptForm === po.id) {
                                              setShowReceiptForm(null);
                                            } else {
                                              setShowReceiptForm(po.id);
                                              // D6：按采购行初始化行级收货输入态（空 = 本次未收）
                                              setReceiptLines(Object.fromEntries((po.lines ?? []).map(l => [l.id, { accepted: '', rejected: '' }])));
                                            }
                                            setReceiptError(null);
                                          }}
                                          className="bds-btn bds-btn-secondary"
                                        >
                                          <Package size={14} />
                                          <span>{showReceiptForm === po.id ? '收起' : '登记来料'}</span>
                                        </button>
                                        {po.status !== 'Received' && po.status !== 'Closed' && (
                                          <button onClick={() => handleAction(po.id, 'cancel')} disabled={actionLoading === `${po.id}_cancel`} className="bds-btn bds-btn-danger">
                                            {actionLoading === `${po.id}_cancel` ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                                            <span>取消</span>
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {canWrite && po.status === 'Received' && (
                                      <button onClick={() => handleAction(po.id, 'close')} disabled={actionLoading === `${po.id}_close`} className="bds-btn bds-btn-secondary">
                                        {actionLoading === `${po.id}_close` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                        <span>关闭采购单</span>
                                      </button>
                                    )}
                                    {/* B2 运营域单据：PO 预览 / 生成 PDF（服务端模板，归档单据中心） */}
                                    <button onClick={() => void handlePreviewPo(po)} className="bds-btn bds-btn-secondary">
                                      <Eye size={14} />
                                      <span>预览单据</span>
                                    </button>
                                    <button onClick={() => void handleGeneratePoDocument(po)} disabled={actionLoading === `${po.id}_gendoc`} className="bds-btn bds-btn-secondary">
                                      {actionLoading === `${po.id}_gendoc` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                                      <span>生成 PDF</span>
                                    </button>
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
                                        <FileText size={14} />
                                        <span>生成应付发票</span>
                                      </button>
                                    )}
                                    {po.status === 'Closed' && (
                                      <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                                        <CheckCircle2 size={14} />
                                        <span>已关闭 — 终态</span>
                                      </div>
                                    )}
                                    {po.status === 'Cancelled' && (
                                      <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-quaternary)' }}>
                                        <Clock size={14} />
                                        <span>已取消 — 终态</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* 关联业务（产品化 Links）— 该供应商的采购/订单/开发/报价/出运等入口 */}
                                  {po.supplierRelationId && (
                                  <RelatedWorkspacesSection
                                    sourceType="relation"
                                    relationId={po.supplierRelationId}
                                    relationName={po.supplierName ?? ''}
                                    relationRole="supplier"
                                    onNavigate={onNavigate}
                                    isDarkMode={isDarkMode}
                                  />
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                    {/* 分页消费：消费 result.total（供应商筛选已下推服务端，total 即筛选后口径），超 100 条不再静默截断 */}
                    {total > 0 && (
                      <div className="flex items-center justify-center gap-3 pt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        <span>共 {total} 条{purchaseOrders.length < total ? `，已加载 ${purchaseOrders.length} 条` : ''}</span>
                        {purchaseOrders.length < total && (
                          <button
                            onClick={() => fetchPurchaseOrders(purchaseOrders.length)}
                            disabled={loadingMore}
                            className="bds-btn bds-btn-secondary"
                          >
                            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            <span>加载更多</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* B2 运营域单据：PO 服务端模板 A4 预览（与生成 PDF 同源排版，所见即所得） */}
      {previewPo && (
        <A4DocumentPreviewModal
          title={`采购单预览 · ${previewPo.poNumber}`}
          subtitle={`A4 · Purchase Order · 与生成 PDF 同源排版`}
          html={previewHtml}
          loading={previewLoading}
          error={previewErr}
          onClose={() => setPreviewPo(null)}
          onPrint={() => void handleGeneratePoDocument(previewPo)}
          printLabel="生成 PDF"
        />
      )}
    </div>
  );
};

export default ProcurementManager;
