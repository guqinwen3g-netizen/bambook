/**
 * 报价管理 QuotationManager
 * Phase 2 缺失模块补齐：报价单全生命周期管理
 *
 * 功能：
 *   - 报价单列表（状态过滤、搜索、分页）
 *   - 创建报价单（含行明细、客户选择、条款）
 *   - 状态流转：Draft → Sent → Accepted/Rejected/Expired
 *   - 行明细编辑（增删行、自动金额计算）
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Send,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  FileSpreadsheet,
  Calculator,
  X,
  GitBranch,
  Image as ImageIcon,
  History,
  TrendingDown,
  Download,
  Pencil,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { hasPermission } from '../services/authService';
import { checkFabricExclusivity, type FabricExclusivityViolation } from '../services/fabricExclusivityClient';
import BottomSheet from './ui/BottomSheet';
import { bdsConfirm } from './ui/BdsDialog';
import { bdsToast } from './ui/bdsToast';
import { financeV2Service, type QuotationPricingResult } from '../services/financeV2Service';
import { TraceabilityPanel } from './TraceabilityPanel';
import { Quotation, QuotationLine, QuotationStatus, QuotationInput, Relation, ProductAsset, FabricPriceHistory, TrackBResult, TrackAInput, View } from '../types';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import CustomSelect from './ui/CustomSelect';
import QuotationImportWizard from './import/QuotationImportWizard';
import { TrackAPanel } from './pricing/TrackAPanel';
import { TrackBPanel, type TrackBValidInputs } from './pricing/TrackBPanel';
import { DeviationBadge } from './pricing/DeviationBadge';
import A4DocumentPreviewModal from './ui/A4DocumentPreviewModal';
import { useStaticEdgeMask } from './ui/useStaticEdgeMask';
import { RelatedWorkspacesSection } from './ui/RelatedWorkspacesSection';
import { consumeCrossModuleNav } from '../services/crossModuleNav';
import { NavRelationFilterChip } from './ui/NavRelationFilterChip';

// ==================== 常量 ====================
// P3-002：对外报价状态主语明确化——Sent/Accepted/Rejected 动作方是客户（我方发出后由客户回应），
// 原文案「已发送/已拒绝」无法分辨主语（我方拒绝？客户拒绝？）
const STATUS_TABS: Array<{ id: 'all' | QuotationStatus; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'Draft', label: '草稿' },
  { id: 'Sent', label: '已发客户' },
  { id: 'Accepted', label: '客户已接受' },
  { id: 'Rejected', label: '客户已拒绝' },
  { id: 'Expired', label: '已过期' },
];

const STATUS_LABELS: Record<QuotationStatus, string> = {
  Draft: '草稿',
  Sent: '已发客户',
  Accepted: '客户已接受',
  Rejected: '客户已拒绝',
  Expired: '已过期',
};

// BDS v2.1：状态 → bds-badge 语义变体（主题透明，替代 statusSemanticClass/Text 双三元拼装）
const STATUS_BADGE_VARIANT: Record<QuotationStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  Draft: 'neutral',
  Sent: 'info',
  Accepted: 'success',
  Rejected: 'danger',
  Expired: 'warning',
};

const CURRENCIES = ['USD', 'CNY', 'EUR'];
const UNITS = ['YD', 'M', 'KG', 'PC', 'SET'];

// ── 阶段 IA-3：开发案「发起报价」prime（预填创建表单，与 Suppliers preview 同模式） ──
const QUOTATION_CREATE_PRIME_KEY = 'bambook_quotation_create_prime';

export interface QuotationCreatePrime {
  customerName?: string;
  description?: string;
  inquiryRef?: string;
}

export const primeQuotationCreateFromDevCase = (prime: QuotationCreatePrime) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(QUOTATION_CREATE_PRIME_KEY, JSON.stringify(prime));
  } catch {
    // Dev-preview continuity only; ignore storage failures.
  }
};

const readQuotationCreatePrime = (): QuotationCreatePrime | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(QUOTATION_CREATE_PRIME_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as QuotationCreatePrime;
  } catch {
    return null;
  }
};

const clearQuotationCreatePrime = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(QUOTATION_CREATE_PRIME_KEY);
  } catch {
    // ignore
  }
};

interface QuotationManagerProps {
  isDarkMode: boolean;
  /** 阶段 IA-3：报价转订单成功后「查看订单」直达跳转 */
  onOpenOrder?: (orderId: string) => void;
  /** 跨模块导航：报价详情「关联业务」入口页面切换 */
  onNavigate?: (view: View) => void;
}

let lineCounter = 0;
const newLineKey = () => `new_qtl_${Date.now()}_${++lineCounter}`;

interface DraftLine {
  key: string;
  fabricCode: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  notes: string;
  imageUrl: string;
}

const createEmptyLine = (): DraftLine => ({
  key: newLineKey(),
  fabricCode: '',
  description: '',
  quantity: '',
  unit: 'YD',
  unitPrice: '',
  notes: '',
  imageUrl: '',
});

// ── B4：建单/改单响应附带的服务端 MOQ 校验结果（quotationService 追加字段 moqCheck；
//    advisory 不阻断保存，发送报价时由 fail-closed 门禁兜底） ──
interface QuotationMoqLineVerdict {
  lineIndex: number;
  quantity: number;
  unit: string;
  effectiveMoq: number;
  compliant: boolean;
}

interface QuotationMoqCheck {
  ok: boolean;
  lines?: QuotationMoqLineVerdict[];
}

// 报价有效期默认报价日 +30 天（外贸报价惯例；用户可改）
const defaultValidUntil = (issueDate: string): string => {
  const d = new Date(issueDate);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
};

// Sent 超 7 天未回复 → 列表琥珀高亮（sentAt 为首次发送时间）
const SENT_FOLLOW_UP_DAYS = 7;
const sentDaysPending = (qt: Quotation): number | null => {
  if (qt.status !== 'Sent' || !qt.sentAt) return null;
  const days = Math.floor((Date.now() - Number(qt.sentAt)) / 86400000);
  return days >= SENT_FOLLOW_UP_DAYS ? days : null;
};

// ── B7 报价单服务端化：渲染真源统一服务端（QUOT 模板注册表），前端打印模板已退役 ──

const QuotationManager: React.FC<QuotationManagerProps> = ({ isDarkMode, onOpenOrder, onNavigate }) => {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // 阶段 IA-3：转单成功订单 id（成功横幅 + 「查看订单」直达）
  const [convertedOrderId, setConvertedOrderId] = useState<string | null>(null);
  // R678-①：PI 生成成功提示独立 state——PI 编号不是订单 id，与转单横幅分离（修假跳转：
  // 历史上复用 convertedOrderId 装「PI 已生成：INV-xxx」文本，「查看订单」按钮拿它当 orderId 跳）
  const [piGeneratedMsg, setPiGeneratedMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | QuotationStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // R678-③：列表搜索防抖目标值——fetchQuotations 只跟随 debouncedSearch，逐键输入不直接打后端
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  // 边缘渐隐：固定 mask 挂滚动容器自身（12px 轻微渐隐——修复原 ScrollEdgeFades null-ref 断链，恢复渐隐）
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  useStaticEdgeMask(contentScrollRef, { topFadeEnd: 12, bottomFade: 12 });
  // ── 阶段 P3c：历史报价导入向导（PRD 16.1/16.2）──
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [traceQuoteId, setTraceQuoteId] = useState<string | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  // ── B7 报价单服务端单据：A4 预览（服务端模板实时渲染，与生成 PDF 同源排版）──
  const [previewQt, setPreviewQt] = useState<Quotation | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [docGeneratedMsg, setDocGeneratedMsg] = useState<string | null>(null);

  // 创建表单状态（validUntil 默认报价日 +30 天）
  const [form, setForm] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    return {
      quotationNumber: '',
      currency: 'USD',
      customerRelationId: '',
      customerName: '',
      issueDate: today,
      validUntil: defaultValidUntil(today),
      deliveryTerms: 'FOB Shanghai',
      paymentTerms: 'T/T 30% deposit, 70% before shipment',
      salesperson: '',
      inquiryRef: '',
      notes: '',
    };
  });
  const [formLines, setFormLines] = useState<DraftLine[]>([createEmptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  // ── B4 MOQ 行级提醒：建单后服务端返回低于起订量的行 → 表单保持打开展示提醒；
  //    moqDraftId 记录已存草稿 id，再次提交走 update（改量复判），避免重复建单 ──
  const [moqWarnings, setMoqWarnings] = useState<QuotationMoqLineVerdict[] | null>(null);
  const [moqDraftId, setMoqDraftId] = useState<string | null>(null);
  // ── C14 砍价修订改价入口：草稿状态「编辑」按钮复用创建表单（提交走 updateQuotation）──
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);

  // ── 双轨成本面板（PRD 8.6）：轨道 A 中位估算 + 轨道 B 终价 → 偏差黄/红标（仅内部参考）──
  const [showDualTrack, setShowDualTrack] = useState(true);
  const [trackAMedian, setTrackAMedian] = useState<{ usd: number; unit: 'PC' | 'M' } | null>(null);
  const [trackBResult, setTrackBResult] = useState<TrackBResult | null>(null);

  // ── V2 双轨定价 modal（对已保存报价单应用 Track A/B → 写入快照字段 + 偏差分级）──
  const [pricingQuoteId, setPricingQuoteId] = useState<string | null>(null);
  const [pricingTrackA, setPricingTrackA] = useState<TrackAInput | null>(null);
  const [pricingTrackB, setPricingTrackB] = useState<TrackBValidInputs | null>(null);
  const [pricingResult, setPricingResult] = useState<QuotationPricingResult | null>(null);
  const [applyingPricing, setApplyingPricing] = useState(false);

  // 阶段 IA-3：开发案「发起报价」prime —— 挂载时自动打开创建表单并预填客户/明细
  useEffect(() => {
    const prime = readQuotationCreatePrime();
    if (!prime) return;
    clearQuotationCreatePrime();
    setShowCreateForm(true);
    setForm(prev => ({
      ...prev,
      customerName: prime.customerName ?? prev.customerName,
      inquiryRef: prime.inquiryRef ?? prev.inquiryRef,
    }));
    if (prime.description) {
      setFormLines([{ ...createEmptyLine(), description: prime.description }]);
    }
  }, []);

  // ── F4 价格生命周期：面料档案联动（PRD 19.5 报价编辑器 · 从档案选择面料，自动带出成分/历史价参考）──
  const [fabricSuggestions, setFabricSuggestions] = useState<Record<string, ProductAsset[]>>({});
  const [fabricSearching, setFabricSearching] = useState<Record<string, boolean>>({});
  const [selectedFabrics, setSelectedFabrics] = useState<Record<string, ProductAsset>>({});
  const fabricSearchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── P1-3 客户专属面料行级即时警示（宽语义预检；仅提示不放行，提交由后端 fail-closed 兜底；
  //    API 不通时静默降级，不阻塞录入、不打扰用户）──
  const [fabricViolations, setFabricViolations] = useState<Record<string, FabricExclusivityViolation[]>>({});
  const fabricExclTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const fabricExclSeqRef = useRef<Record<string, number>>({});
  const formCustomerRef = useRef({ relationId: '', name: '' });
  useEffect(() => {
    formCustomerRef.current = { relationId: form.customerRelationId, name: form.customerName };
  }, [form.customerRelationId, form.customerName]);
  useEffect(() => {
    const timers = fabricExclTimersRef.current;
    return () => { Object.values(timers).forEach((t) => clearTimeout(t)); };
  }, []);

  // ── 拉取数据 ──
  // R678-③：搜索输入 300ms 防抖（同报价行面料搜索 fabricSearchTimers 模式），停键后才打后端
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]);

  const fetchQuotations = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const result = await apiService.listQuotations({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: debouncedSearch || undefined,
        limit: 100,
        offset,
      });
      setTotal(result.total);
      setQuotations(prev => (offset > 0 ? [...prev, ...result.items] : result.items));
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [statusFilter, debouncedSearch]);

  /** 报价台账 Excel 导出（当前筛选条件全量；搜索词取防抖后口径，与可见列表一致） */
  const handleExportXlsx = useCallback(async () => {
    setExportingXlsx(true);
    try {
      await apiService.exportQuotationsXlsx({
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
    } catch (e: any) {
      setError(`台账导出失败：${e?.message || e}`);
    } finally {
      setExportingXlsx(false);
    }
  }, [statusFilter, debouncedSearch]);

  useEffect(() => { fetchQuotations(); }, [fetchQuotations]);

  useEffect(() => {
    apiService.listRelations().then(setRelations).catch(() => {});
  }, []);

  // ── B7 报价单服务端单据：预览 / 生成 PDF ──

  /** 预览报价单（服务端模板实时渲染，A4 纸张画布——与生成 PDF 同源排版） */
  const handlePreviewQt = useCallback(async (qt: Quotation) => {
    setPreviewQt(qt);
    setPreviewHtml('');
    setPreviewErr(null);
    setPreviewLoading(true);
    try {
      const html = await apiService.getQuotationPreviewHtml(qt.id);
      setPreviewHtml(html);
    } catch (e: any) {
      setPreviewErr(`报价单预览加载失败：${e?.message || e}`);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  /** 生成报价单 PDF（登记域单据 domain=quotation → 单据中心归档 → 下载） */
  const handleGenerateQtDocument = useCallback(async (qt: Quotation) => {
    setActionLoading(`${qt.id}_gendoc`);
    setError(null);
    try {
      const result = await apiService.generateQuotationDocument(qt.id);
      setDocGeneratedMsg(`已生成 ${result.documentNumber}（${Math.round(result.fileSize / 1024)} KB），归档至单据中心`);
    } catch (e: any) {
      setError(`生成报价单文档失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  // 跨模块导航筛选（关系智库档案「关联业务 → 报价」入口）：挂载时消费一次，
  // 服务端 fetch 结果之上本地精确过滤（customerRelationId）
  const [navRelationFilter, setNavRelationFilter] = useState(() => consumeCrossModuleNav()?.filter ?? null);
  const visibleQuotations = useMemo(
    () => navRelationFilter
      ? quotations.filter(qt => qt.customerRelationId === navRelationFilter.relationId)
      : quotations,
    [quotations, navRelationFilter],
  );

  // ── 客户选项 ──
  const customerOptions = useMemo(() => {
    return relations
      .filter(r => !r.deletedAt && (r.type === 'Customer' || r.type === 'Supplier'))
      .map(r => ({
        id: r.id,
        label: r.englishName || r.chineseName || r.name,
        chineseName: r.chineseName || r.name,
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
  const handleAction = useCallback(async (id: string, action: 'send' | 'accept' | 'reject' | 'delete' | 'revise') => {
    if (action === 'revise') {
      if (!(await bdsConfirm({
        title: '砍价修订',
        body: '快照当前版本留痕并回到草稿状态——编辑价格后重新发送。谈判轮次与版本历史全程可溯。',
      }))) return;
    }
    if (action === 'delete') {
      if (!(await bdsConfirm({
        title: '删除报价单',
        body: '确认删除该报价单？此操作不可撤销。',
        danger: true,
      }))) return;
    }
    setActionLoading(`${id}_${action}`);
    setConvertedOrderId(null);
    setPiGeneratedMsg(null);
    try {
      // R678-⑦：send/reject/delete/revise 原先成功无反馈 → 统一 bdsToast.success
      if (action === 'send') {
        await apiService.sendQuotation(id);
        bdsToast.success('报价单已发送客户。');
      }
      else if (action === 'accept') {
        const result = await apiService.acceptQuotation(id);
        // L9 联动：接受后系统自动转为订单草稿，提示用户
        if (result?.convertedOrderId) {
          bdsToast.success(`已接受报价并自动转为订单草稿（订单号：${result.convertedOrderId}）。可在订单管理中查看。`);
        } else {
          bdsToast.success('已接受报价。可点击「转为订单」手动转为正式订单。');
        }
      }
      else if (action === 'reject') {
        await apiService.rejectQuotation(id);
        bdsToast.success('已标记客户拒绝。');
      }
      else if (action === 'delete') {
        await apiService.deleteQuotation(id);
        bdsToast.success('报价单已删除。');
      }
      else if (action === 'revise') {
        await apiService.reviseQuotation(id, '砍价修订');
        bdsToast.success('已快照当前版本并回到草稿，可编辑改价后重新发送。');
      }
      await fetchQuotations();
    } catch (e: any) {
      setError(`操作失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [fetchQuotations]);

  // ── C16 转订单补充信息：弹窗收集 PO 号/工厂/交期/订单类型后再调转换端点（overrides 契约后端已支持）──
  const [convertTarget, setConvertTarget] = useState<Quotation | null>(null);
  const [convertForm, setConvertForm] = useState<{ poNumber: string; millName: string; dueDate: string; type: string }>({
    poNumber: '', millName: '', dueDate: '', type: 'Fabric',
  });

  const openConvertModal = useCallback((qt: Quotation) => {
    setConvertForm({
      poNumber: qt.quotationNumber || '',
      millName: '',
      dueDate: qt.validUntil || '',
      type: 'Fabric',
    });
    setConvertTarget(qt);
  }, []);

  const handleConvertConfirm = useCallback(async () => {
    if (!convertTarget) return;
    const id = convertTarget.id;
    setActionLoading(`${id}_convert`);
    setConvertedOrderId(null);
    try {
      const result = await apiService.convertQuotationToOrder(id, {
        poNumber: convertForm.poNumber.trim() || undefined,
        millName: convertForm.millName.trim() || undefined,
        dueDate: convertForm.dueDate || undefined,
        type: convertForm.type || undefined,
      });
      setConvertedOrderId(result.orderId);
      setConvertTarget(null);
      await fetchQuotations();
    } catch (e: any) {
      setError(`操作失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [convertTarget, convertForm, fetchQuotations]);

  // ── REQ2-19：版本历史弹层 ──
  const [versionSheet, setVersionSheet] = useState<{ quotation: any; versions: any[] } | null>(null);
  const openVersionSheet = useCallback(async (qt: any) => {
    setVersionSheet({ quotation: qt, versions: [] });
    try {
      const versions = await apiService.listQuotationVersions(qt.id);
      setVersionSheet({ quotation: qt, versions });
    } catch (e: any) {
      setError(`版本历史加载失败：${e?.message || e}`);
      setVersionSheet(null);
    }
  }, []);

  // ── REQ2-19：客户砍价画像弹层 ──
  const [profileSheet, setProfileSheet] = useState<{ relationId: string; relationName: string; profile: any } | null>(null);
  const openPriceProfile = useCallback(async (relationId: string, relationName: string) => {
    setProfileSheet({ relationId, relationName, profile: null });
    try {
      const profile = await apiService.getQuotationPriceProfile(relationId);
      setProfileSheet({ relationId, relationName, profile });
    } catch (e: any) {
      setError(`砍价画像加载失败：${e?.message || e}`);
      setProfileSheet(null);
    }
  }, []);

  // ── 生成形式发票 PI（Phase 1-04：从 Accepted 报价单生成 PI）──
  const handleGeneratePi = useCallback(async (id: string) => {
    setActionLoading(`${id}_generatePi`);
    try {
      const invoice = await financeV2Service.generatePi(id, {});
      setError(null);
      setConvertedOrderId(null);
      await fetchQuotations();
      // R678-①：PI 编号走独立 piGeneratedMsg（纯提示横幅，不提供「查看订单」跳转——
      // 历史上复用 convertedOrderId 导致横幅渲染「已转为订单 PI 已生成：…」且按钮拿 PI 文本当 orderId 假跳转）
      setPiGeneratedMsg(`PI 已生成：${invoice.invoiceNumber}，可在发票模块查看`);
    } catch (e: any) {
      setError(`生成 PI 失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [fetchQuotations]);

  // ── V2 应用双轨定价（对已保存报价单调用后端 Track A/B 计算 → 写入快照 + 偏差分级）──
  const handleApplyPricing = useCallback(async () => {
    if (!pricingQuoteId || !pricingTrackB) return;
    setApplyingPricing(true);
    setError(null);
    try {
      const input: any = {
        category: pricingTrackA?.category || 'fabric',
        ...(pricingTrackA || {}),
        purchaseCostCny: pricingTrackB.purchaseCostCny,
        refundRate: pricingTrackB.refundRate,
        exchangeRate: pricingTrackB.exchangeRate,
        profitMargin: pricingTrackB.profitMargin,
        commissionRate: pricingTrackB.commissionRate,
        commissionRuleId: pricingTrackB.commissionRuleId || undefined,
        hsCode: pricingTrackB.hsCode || undefined,
      };
      const result = await financeV2Service.applyTrackPricing(pricingQuoteId, input);
      setPricingResult(result);
      await fetchQuotations();
    } catch (e: any) {
      setError(`应用定价失败：${e?.message || e}`);
    } finally {
      setApplyingPricing(false);
    }
  }, [pricingQuoteId, pricingTrackA, pricingTrackB, fetchQuotations]);

  // ── V2 查询定价校验（读取已保存的双轨快照 + 偏差分级，不写入）──
  const handlePricingCheck = useCallback(async () => {
    if (!pricingQuoteId) return;
    setApplyingPricing(true);
    setError(null);
    try {
      const result = await financeV2Service.getPricingCheck(pricingQuoteId);
      setPricingResult(result);
    } catch (e: any) {
      setError(`查询定价校验失败：${e?.message || e}`);
    } finally {
      setApplyingPricing(false);
    }
  }, [pricingQuoteId]);

  // ── C14 草稿「编辑」：复用创建表单回填报价单内容（改价/改行后走 updateQuotation 保存）──
  const openEditForm = useCallback((qt: Quotation) => {
    setEditingQuotationId(qt.id);
    setForm({
      quotationNumber: qt.quotationNumber || '',
      currency: qt.currency || 'USD',
      customerRelationId: qt.customerRelationId || '',
      customerName: qt.customerName || '',
      issueDate: qt.issueDate || new Date().toISOString().split('T')[0],
      validUntil: qt.validUntil || '',
      deliveryTerms: qt.deliveryTerms || '',
      paymentTerms: qt.paymentTerms || '',
      salesperson: qt.salesperson || '',
      inquiryRef: qt.inquiryRef || '',
      notes: qt.notes || '',
    });
    setFormLines(qt.lines && qt.lines.length > 0
      ? qt.lines.map(l => ({
          key: newLineKey(),
          fabricCode: l.fabricCode || '',
          description: l.description || '',
          quantity: l.quantity != null ? String(l.quantity) : '',
          unit: l.unit || 'YD',
          unitPrice: l.unitPrice != null ? String(l.unitPrice) : '',
          notes: l.notes || '',
          imageUrl: l.imageUrl || '',
        }))
      : [createEmptyLine()]);
    setMoqWarnings(null);
    setMoqDraftId(null);
    setFormError(null);
    setShowCreateForm(true);
  }, []);

  // ── R678-④：表单内容重置（创建成功与「返回列表」取消共用——此前取消仅清编辑态，
  //    form/formLines/双轨/专属面料预检残留，下次打开新建表单带着上次内容） ──
  const resetCreateForm = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    setForm({
      quotationNumber: '', currency: 'USD', customerRelationId: '', customerName: '',
      issueDate: today, validUntil: defaultValidUntil(today),
      deliveryTerms: 'FOB Shanghai', paymentTerms: 'T/T 30% deposit, 70% before shipment',
      salesperson: '', inquiryRef: '', notes: '',
    });
    setFormLines([createEmptyLine()]);
    setFormError(null);
    setFabricViolations({});
    setTrackAMedian(null);
    setTrackBResult(null);
  }, []);

  // ── 创建报价单 ──
  const handleCreate = useCallback(async () => {
    setFormError(null);
    const validLines = formLines.filter(l => l.description && l.quantity && l.unitPrice);
    if (!form.issueDate) { setFormError('请填写报价日期'); return; }
    if (validLines.length === 0) { setFormError('至少需要一行有效报价明细'); return; }

    setActionLoading('create');
    try {
      // 双轨快照（PRD 8.6）：轨道 A 中位 + 轨道 B 终价齐备时随创建提交，服务端计算偏差分级
      const dualTrackSnapshot = trackAMedian && trackBResult
        ? {
            trackAMedianUsd: trackAMedian.usd,
            trackAUnit: trackAMedian.unit,
            trackBFinalUsd: trackBResult.finalUnitPrice,
          }
        : {};
      const input: QuotationInput = {
        quotationNumber: form.quotationNumber || undefined,
        currency: form.currency,
        customerRelationId: form.customerRelationId || undefined,
        customerName: form.customerName || undefined,
        issueDate: form.issueDate,
        validUntil: form.validUntil || undefined,
        deliveryTerms: form.deliveryTerms || undefined,
        paymentTerms: form.paymentTerms || undefined,
        salesperson: form.salesperson || undefined,
        inquiryRef: form.inquiryRef || undefined,
        notes: form.notes || undefined,
        ...dualTrackSnapshot,
        lines: validLines.map(l => ({
          fabricCode: l.fabricCode || undefined,
          description: l.description,
          quantity: parseFloat(l.quantity),
          unit: l.unit,
          unitPrice: parseFloat(l.unitPrice),
          notes: l.notes || undefined,
          imageUrl: l.imageUrl || undefined,
        })),
      };
      // B4：已因 MOQ 提醒留存草稿 → 再次提交走 update 复判（不重复建单）；
      // C14：草稿「编辑」入口同样走 update（editingQuotationId 优先）
      const updateTargetId = editingQuotationId || moqDraftId;
      const saved = (updateTargetId
        ? await apiService.updateQuotation(updateTargetId, input)
        : await apiService.createQuotation(input)) as Quotation & { moqCheck?: QuotationMoqCheck | null };
      // B4：服务端建单/改单已做 MOQ 校验（advisory），低于起订量的行在表单上即时行级提醒，
      // 不再等到点「发送」才被门禁拦下；表单保持打开供改量后再次提交复判
      const belowMoqLines = saved.moqCheck && saved.moqCheck.ok === false
        ? (saved.moqCheck.lines ?? []).filter(l => !l.compliant)
        : [];
      if (belowMoqLines.length > 0) {
        setMoqDraftId(saved.id);
        setMoqWarnings(belowMoqLines);
        await fetchQuotations(); // 草稿已落库，后台刷新列表
        return;
      }
      setShowCreateForm(false);
      // 重置表单（validUntil 重新取报价日 +30 天默认值；R678-④ 收敛为共享 resetCreateForm）
      resetCreateForm();
      setMoqWarnings(null);
      setMoqDraftId(null);
      setEditingQuotationId(null);
      await fetchQuotations();
    } catch (e: any) {
      setFormError(`保存失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [form, formLines, trackAMedian, trackBResult, moqDraftId, editingQuotationId, fetchQuotations, resetCreateForm]);

  // ── P1-3 行面料即时预检：fabricCode 宽键（sku/厂号/品色号/客供品号并集解析，端点固定
  // clientCodeGlobalFallback=false），与后端 quotation create/rebuild 触发面一致；
  // productAssetId 直锚优先（选中档案面料时传入）。客户信息经 ref 读取，避免闭包陈旧 ──
  const clearFabricViolation = useCallback((lineKey: string) => {
    fabricExclSeqRef.current[lineKey] = (fabricExclSeqRef.current[lineKey] ?? 0) + 1;
    if (fabricExclTimersRef.current[lineKey]) {
      clearTimeout(fabricExclTimersRef.current[lineKey]);
      delete fabricExclTimersRef.current[lineKey];
    }
    setFabricViolations((prev) => {
      if (!prev[lineKey]) return prev;
      const next = { ...prev };
      delete next[lineKey];
      return next;
    });
  }, []);

  const scheduleFabricExclusivityCheck = useCallback((lineKey: string, fabricCode: string, productAssetId?: string | null) => {
    if (fabricExclTimersRef.current[lineKey]) clearTimeout(fabricExclTimersRef.current[lineKey]);
    const code = (fabricCode || '').trim();
    // 无产品锚不警示（字段空不能卡业务，与后端「无产品锚不阻断」语义一致）
    if (!code && !productAssetId) {
      clearFabricViolation(lineKey);
      return;
    }
    fabricExclSeqRef.current[lineKey] = (fabricExclSeqRef.current[lineKey] ?? 0) + 1;
    const seq = fabricExclSeqRef.current[lineKey];
    fabricExclTimersRef.current[lineKey] = setTimeout(() => {
      checkFabricExclusivity({
        productAssetId: productAssetId ?? null,
        fabricCode: code || null,
        customerRelationId: formCustomerRef.current.relationId || null,
        customerName: formCustomerRef.current.name || null,
      })
        .then((result) => {
          if (seq !== fabricExclSeqRef.current[lineKey]) return; // 竞态守卫：删行/新一轮输入已作废旧回包
          setFabricViolations((prev) => ({ ...prev, [lineKey]: result.allowed ? [] : result.violations }));
        })
        .catch(() => {
          if (seq !== fabricExclSeqRef.current[lineKey]) return;
          setFabricViolations((prev) => ({ ...prev, [lineKey]: [] })); // 预检失败静默降级
        });
    }, 450);
  }, [clearFabricViolation]);

  // B4：行内容一经编辑，上次保存口径的 MOQ 提醒即过时 → 清除，待下次提交复判刷新
  const clearMoqWarnings = () => setMoqWarnings(prev => (prev ? null : prev));

  const updateFormLine = (key: string, field: keyof DraftLine, value: string) => {
    clearMoqWarnings();
    setFormLines(prev => prev.map(l => (l.key === key ? { ...l, [field]: value } : l)));
    if (field === 'fabricCode') {
      searchFabricsForLine(key, value);
      scheduleFabricExclusivityCheck(key, value);
    }
  };
  const addFormLine = () => {
    clearMoqWarnings();
    setFormLines(prev => [...prev, createEmptyLine()]);
  };
  const removeFormLine = (key: string) => {
    clearMoqWarnings();
    clearFabricViolation(key);
    setFormLines(prev => (prev.length > 1 ? prev.filter(l => l.key !== key) : prev));
  };

  // ── REQ2-12 行图片上传（DR-053-① 手动通道：色卡图/实拍 → uploads/quotations/） ──
  const [lineImageUploading, setLineImageUploading] = useState<string | null>(null);
  const handleLineImageUpload = useCallback(async (lineKey: string, file: File | undefined) => {
    if (!file) return;
    setLineImageUploading(lineKey);
    try {
      const url = await apiService.uploadQuotationLineImage(file);
      setFormLines(prev => prev.map(l => (l.key === lineKey ? { ...l, imageUrl: url } : l)));
    } catch (e: any) {
      setFormError(`图片上传失败：${e?.message || e}`);
    } finally {
      setLineImageUploading(null);
    }
  }, []);

  // ── F4：面料档案搜索（防抖 300ms，≥2 字符触发）──
  const searchFabricsForLine = useCallback((lineKey: string, q: string) => {
    const timers = fabricSearchTimers.current;
    if (timers[lineKey]) clearTimeout(timers[lineKey]);
    // 输入变化即视为偏离已选档案，清掉旧参考，避免陈旧价格误导
    setSelectedFabrics(prev => {
      if (!prev[lineKey]) return prev;
      const next = { ...prev };
      delete next[lineKey];
      return next;
    });
    const query = q.trim();
    if (query.length < 2) {
      setFabricSuggestions(prev => ({ ...prev, [lineKey]: [] }));
      return;
    }
    timers[lineKey] = setTimeout(async () => {
      setFabricSearching(prev => ({ ...prev, [lineKey]: true }));
      try {
        const items = await apiService.listProductAssets(undefined, { search: query, mainCategory: 'Fabric', limit: 6 });
        setFabricSuggestions(prev => ({ ...prev, [lineKey]: items.filter(p => !p.deletedAt) }));
      } catch {
        setFabricSuggestions(prev => ({ ...prev, [lineKey]: [] }));
      } finally {
        setFabricSearching(prev => ({ ...prev, [lineKey]: false }));
      }
    }, 300);
  }, []);

  // ── F4：选中档案面料 → 带出 SKU/成分描述/历史价参考 ──
  const handleSelectFabric = useCallback((lineKey: string, product: ProductAsset) => {
    setSelectedFabrics(prev => ({ ...prev, [lineKey]: product }));
    setFabricSuggestions(prev => ({ ...prev, [lineKey]: [] }));
    setFormLines(prev => prev.map(l => {
      if (l.key !== lineKey) return l;
      const composition = (product.compositionLines || [])
        .filter(cl => !cl.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(cl => `${cl.percentage}% ${cl.term?.chineseName || cl.term?.englishName || ''}`.trim())
        .filter(Boolean)
        .join(' + ');
      const autoDesc = [product.name, composition].filter(Boolean).join(' ');
      return {
        ...l,
        fabricCode: product.sku,
        description: l.description || autoDesc,
        // REQ2-12 DR-053-①：档案主图自动带出（手动上传过则不覆盖）
        imageUrl: l.imageUrl || product.imageUrl || '',
      };
    }));
    // P1-3：选中档案面料 → 带产品直锚预检（比宽键更准）
    scheduleFabricExclusivityCheck(lineKey, product.sku || '', product.id);
  }, [scheduleFabricExclusivityCheck]);

  // ── F4：历史价参考与偏差计算（PRD 19.5：偏离 >15% 黄标提示触发审批）──
  const latestPriceOf = useCallback((product: ProductAsset | undefined, type: string): FabricPriceHistory | undefined => {
    if (!product) return undefined;
    return (product.fabricPrices || [])
      .filter(p => p.priceType === type && !p.deletedAt)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  }, []);

  const priceDeviationRatio = (unitPrice: string, ref?: FabricPriceHistory): number | null => {
    if (!ref || !ref.amount) return null;
    const p = parseFloat(unitPrice);
    if (!Number.isFinite(p) || p <= 0) return null;
    const ratio = (p - Number(ref.amount)) / Number(ref.amount);
    return Math.abs(ratio) > 0.15 ? ratio : null;
  };

  const formatAmount = (n: number, currency: string) =>
    `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

  const formatDate = (s?: string) => s || '—';

  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
  const labelCls = 'block text-xs mb-1 text-[var(--text-tertiary)]';
  // R678-R6：写操作按钮（发送/删除/转为订单）按 quotations:write scope 隐藏，无权限角色只读
  const canWriteQuotation = hasPermission('quotations:write');

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader
        title="报价管理"
        subtitle="Quotations"
        actions={!showCreateForm ? (
          <>
            <button onClick={() => setShowImportWizard(true)} className="bds-btn bds-btn-secondary">
              <FileSpreadsheet size={14} /><span>导入历史报价</span>
            </button>
            {/* B10 运营域报表：报价台账 Excel 导出（当前筛选全量） */}
            <button onClick={() => void handleExportXlsx()} disabled={exportingXlsx} className="bds-btn bds-btn-secondary">
              {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>导出台账</span>
            </button>
            <button onClick={() => setShowCreateForm(true)} className="bds-btn bds-btn-primary">
              <Plus size={14} /><span>新建报价单</span>
            </button>
          </>
        ) : undefined}
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          <AnimatePresence mode="wait">
            {showCreateForm ? (
              <motion.div key="create-form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                {/* 创建/编辑表单（C14：草稿「编辑」复用本表单，提交走 updateQuotation） */}
                <div className="flex items-center justify-between mb-4">
                  <h2 className="bds-text-lg" style={{ color: 'var(--text-primary)' }}>{editingQuotationId ? '编辑报价单' : '新建报价单'}</h2>
                  <button onClick={() => { setShowCreateForm(false); setMoqWarnings(null); setMoqDraftId(null); setEditingQuotationId(null); resetCreateForm(); }} className="bds-btn bds-btn-secondary">
                    <ChevronRight size={14} className="rotate-180" /><span>返回列表</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {/* 基本信息 */}
                  <div className="bds-card">
                    <h3 className="bds-overline mb-3" style={{ color: 'var(--text-tertiary)' }}>基本信息</h3>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                      <div>
                        <label className={labelCls}>报价编号</label>
                        <input type="text" value={form.quotationNumber} onChange={(e) => setForm({ ...form, quotationNumber: e.target.value })} placeholder="留空自动生成 QT-YYYY-NNNN" className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>币种</label>
                        <CustomSelect
                          surface="form"
                          className="w-full"
                          ariaLabel="报价币种"
                          value={form.currency}
                          onChange={(v) => setForm({ ...form, currency: v })}
                          options={CURRENCIES.map(c => ({ value: c, label: c }))}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>报价日期 *</label>
                        <CapsuleDateInput className="bds-input" value={form.issueDate} onChange={(v) => setForm({ ...form, issueDate: v, validUntil: defaultValidUntil(v) })} />
                      </div>
                      <div>
                        <label className={labelCls}>有效期至</label>
                        <CapsuleDateInput className="bds-input" value={form.validUntil} onChange={(v) => setForm({ ...form, validUntil: v })} />
                      </div>
                      <div>
                        <label className={labelCls}>客户</label>
                        <CustomSelect
                          surface="form"
                          className="w-full"
                          ariaLabel="报价客户"
                          value={form.customerRelationId}
                          onChange={(v) => {
                            const rel = relations.find(r => r.id === v);
                            setForm({ ...form, customerRelationId: v, customerName: rel?.englishName || rel?.chineseName || '' });
                          }}
                          options={[
                            { value: '', label: '选择客户...' },
                            ...customerOptions.map(c => ({ value: c.id, label: `${c.label} (${c.chineseName})` })),
                          ]}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>业务员</label>
                        <input type="text" value={form.salesperson} onChange={(e) => setForm({ ...form, salesperson: e.target.value })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>询价参考</label>
                        <input type="text" value={form.inquiryRef} onChange={(e) => setForm({ ...form, inquiryRef: e.target.value })} className="bds-input" />
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
                    {/* C17 报价备注：内部留痕（谈判背景/特殊约定），随创建/编辑提交后端 notes 字段 */}
                    <div className="mt-3">
                      <label className={labelCls}>备注</label>
                      <textarea
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="报价备注（内部留痕，可记录谈判背景 / 特殊约定）"
                        className="bds-input bds-textarea resize-none min-h-20"
                      />
                    </div>
                  </div>

                  {/* 双轨成本面板（PRD 8.6 · 仅内部参考，不对客户展示） */}
                  <div className="bds-card">
                    <button
                      type="button"
                      onClick={() => setShowDualTrack(v => !v)}
                      className="bds-overline w-full flex items-center justify-between transition-colors"
                      style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <span>双轨成本面板（轨道 A 估算 + 轨道 B 退税定价 · 仅内部）</span>
                      <ChevronDown size={14} className={`transition-transform ${showDualTrack ? '' : '-rotate-90'}`} />
                    </button>
                    {showDualTrack && (
                      <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                        <TrackAPanel isDarkMode={isDarkMode} onMedianUsdChange={(usd, unit) => setTrackAMedian(usd !== null && unit ? { usd, unit } : null)} />
                        <div className="space-y-3">
                          <TrackBPanel onResultChange={setTrackBResult} />
                          <DeviationBadge
                            finalUsd={trackBResult?.finalUnitPrice ?? null}
                            medianUsd={trackAMedian?.usd ?? null}
                            medianUnit={trackAMedian?.unit}
                            isDarkMode={isDarkMode}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 报价行 */}
                  <div className="bds-card">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>报价明细</h3>
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
                            <div className="relative">
                              <input type="text" value={line.fabricCode} onChange={(e) => updateFormLine(line.key, 'fabricCode', e.target.value)} onBlur={() => setTimeout(() => setFabricSuggestions(prev => ({ ...prev, [line.key]: [] })), 150)} placeholder="面料编码（搜索档案）" className="bds-input sm" />
                              {fabricSearching[line.key] && (
                                <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                              )}
                              {/* F4：档案面料搜索建议下拉（BDS 浮层族） */}
                              {(fabricSuggestions[line.key]?.length ?? 0) > 0 && (
                                <div className="bds-pop" style={{ left: 0, right: 0, top: 'calc(100% + 4px)' }}>
                                  {fabricSuggestions[line.key].map(p => (
                                    <div
                                      key={p.id}
                                      className="opt"
                                      onClick={() => handleSelectFabric(line.key, p)}
                                    >
                                      <span className="bds-mono">{p.sku}</span>
                                      <span className="sub">{p.name}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* REQ2-12 产品图片：缩略预览 + 上传/替换/移除（档案主图自动带出） */}
                            <div className="relative flex items-center justify-center overflow-hidden rounded-control border" style={{ borderColor: 'var(--border-c-default)', background: 'var(--recessed-bg)', minHeight: '34px' }}>
                              {lineImageUploading === line.key ? (
                                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                              ) : line.imageUrl ? (
                                <>
                                  <img src={line.imageUrl} alt="产品图" className="h-full max-h-14 w-full object-contain" />
                                  <button type="button" onClick={() => updateFormLine(line.key, 'imageUrl', '')} className="absolute right-0.5 top-0.5 rounded-full bg-[var(--recessed-bg-strong)] p-0.5 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100" style={{ color: 'var(--text-tertiary)' }} title="移除图片">
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <label className="flex cursor-pointer items-center gap-1 text-[10px]" style={{ color: 'var(--text-quaternary)' }}>
                                  <ImageIcon size={14} />
                                  产品图
                                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { handleLineImageUpload(line.key, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                                </label>
                              )}
                              {line.imageUrl && lineImageUploading !== line.key && (
                                <label className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-control bg-[var(--recessed-bg-strong)] opacity-0 transition-opacity hover:opacity-100" style={{ color: 'var(--text-tertiary)' }} title="替换图片">
                                  <ImageIcon size={14} />
                                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { handleLineImageUpload(line.key, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                                </label>
                              )}
                            </div>
                            <input type="text" value={line.description} onChange={(e) => updateFormLine(line.key, 'description', e.target.value)} placeholder="品名描述 *" className="bds-input sm xl:col-span-2" />
                            <input type="number" value={line.quantity} onChange={(e) => updateFormLine(line.key, 'quantity', e.target.value)} placeholder="数量 *" className="bds-input sm" />
                            <CustomSelect
                              surface="form"
                              size="compact"
                              className="w-full"
                              ariaLabel="行单位"
                              value={line.unit}
                              onChange={(v) => updateFormLine(line.key, 'unit', v)}
                              options={UNITS.map(u => ({ value: u, label: u }))}
                            />
                            <input type="number" step="0.01" value={line.unitPrice} onChange={(e) => updateFormLine(line.key, 'unitPrice', e.target.value)} placeholder="单价 *" className="bds-input sm" />
                          </div>
                          {/* F4：历史价参考条 + 偏差黄标（PRD 19.5） */}
                          {(() => {
                            const fabric = selectedFabrics[line.key];
                            if (!fabric) return null;
                            const factoryRef = latestPriceOf(fabric, 'factory');
                            const customerRef = latestPriceOf(fabric, 'customer');
                            const deviation = priceDeviationRatio(line.unitPrice, customerRef);
                            if (!factoryRef && !customerRef) {
                              return (
                                <div className="mt-2 text-[10px]" style={{ color: 'var(--text-quaternary)' }}>
                                  档案面料 {fabric.sku} 暂无历史价格记录
                                </div>
                              );
                            }
                            return (
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                <span>历史价参考：</span>
                                {factoryRef && (
                                  <span>工厂价 {factoryRef.currency} {Number(factoryRef.amount).toFixed(2)}{factoryRef.unit ? `/${factoryRef.unit}` : ''}{factoryRef.effectiveDate ? `（${factoryRef.effectiveDate}）` : ''}</span>
                                )}
                                {customerRef && (
                                  <span>最近售价 {customerRef.currency} {Number(customerRef.amount).toFixed(2)}{customerRef.unit ? `/${customerRef.unit}` : ''}{customerRef.effectiveDate ? `（${customerRef.effectiveDate}）` : ''}</span>
                                )}
                                {deviation !== null && customerRef && (
                                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--warning-text)' }}>
                                    <AlertTriangle size={14} />
                                    偏离最近售价 {deviation > 0 ? '+' : ''}{Math.round(deviation * 100)}%（&gt;15%，将触发审批）
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                          <div className="mt-1 text-right text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            金额: {formatAmount(calcLineAmount(line.quantity, line.unitPrice), form.currency)}
                          </div>
                          {/* P1-3 客户专属面料行级警示：提前提示，不拦截输入；提交仍由后端 fail-closed 兜底 */}
                          {(fabricViolations[line.key]?.length ?? 0) > 0 && (
                            <div role="alert" className="mt-2 flex items-start gap-2 rounded-inset px-2.5 py-1.5 text-xs leading-relaxed" style={{ background: 'var(--danger-tint)', color: 'var(--danger-text)' }}>
                              <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                              <span>
                                {(fabricViolations[line.key] ?? []).map((v, i) => (
                                  <span key={`${v.productAssetId}-${i}`}>
                                    {i > 0 && '；'}
                                    {`面料「${v.productName || v.sku || v.clientCode || v.productAssetId}」为客户「${v.ownerCustomerName || '未知属主'}」出资开发的专属面料`}
                                  </span>
                                ))}
                                ；当前报价客户「{form.customerName || '—'}」无权使用，提交报价单时将被系统拦截。如确需使用请走属主客户授权变更。
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 flex justify-between items-center text-sm" style={{ borderTop: 'var(--border-subtle)' }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>合计</span>
                      <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{formatAmount(formTotal, form.currency)}</span>
                    </div>
                  </div>

                  {/* B4 MOQ 行级提醒：建单/改单响应的 moqCheck 低于起订量行即时展示（advisory），发送时需审批豁免 */}
                  {moqWarnings && moqWarnings.length > 0 && (
                    <div role="alert" className="bds-alert warning items-start">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <span>
                        报价单已保存为草稿。以下行低于起订量，发送时需审批豁免：
                        {moqWarnings.map((w) => (
                          <span key={w.lineIndex} className="block">
                            第 {w.lineIndex + 1} 行低于起订量（当前 {w.quantity} {w.unit}，要求 {w.effectiveMoq} {w.unit}）
                          </span>
                        ))}
                      </span>
                    </div>
                  )}

                  {formError && (
                    <div className="bds-alert danger">
                      <AlertCircle size={16} />
                      <span>{formError}</span>
                    </div>
                  )}

                  <button onClick={handleCreate} disabled={actionLoading === 'create'} className="bds-btn bds-btn-primary lg w-full">
                    {actionLoading === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    <span>{editingQuotationId || moqDraftId ? '保存修改' : '创建报价单'}</span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                {/* 单行筛选 bar（点名③）：原「纯单搜索误套组合 bar + 独立 segment 行」双行
                    → 搜索 + 状态 segment 并入同一组合 bar（spec §2.1：搜索+≥1 筛选共行 = 组合嵌套 bar；
                    评估结论：并入优于「单层搜索+独立 segment 行」两行之案——单行收敛上边距，
                    与 OrderManager/ShipmentManager 范式一致） */}
                {navRelationFilter && (
                  <NavRelationFilterChip filter={navRelationFilter} label="报价" onClear={() => setNavRelationFilter(null)} />
                )}
                <div className="bds-filterbar mb-4 flex-wrap gap-y-2">
                  <div className="relative min-w-40 flex-[1_1_200px] max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索报价号/客户..." className="bds-input pl-9" />
                  </div>
                  <div className="min-w-0 flex-[1_1_auto] overflow-x-auto no-scrollbar">
                    <div className="bds-segment w-fit">
                      {STATUS_TABS.map(tab => (
                        <button key={tab.id} onClick={() => setStatusFilter(tab.id)} className={`seg whitespace-nowrap ${statusFilter === tab.id ? 'active' : ''}`}>
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => fetchQuotations()} className="bds-btn bds-btn-ghost ml-auto" title="刷新">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>

                {/* 错误提示 */}
                {error && (
                  <div className="bds-alert danger mb-3">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                  </div>
                )}

                {/* B7：报价单 PDF 生成成功提示（归档单据中心） */}
                {docGeneratedMsg && (
                  <div className="bds-alert success mb-3">
                    <CheckCircle2 size={16} />
                    <span className="flex-1 min-w-0 truncate">{docGeneratedMsg}</span>
                    <button
                      type="button"
                      onClick={() => setDocGeneratedMsg(null)}
                      className="flex items-center shrink-0 hover:opacity-70"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* R678-①：PI 生成成功横幅（独立 state 纯提示——PI 编号不是订单 id，不提供「查看订单」跳转） */}
                {piGeneratedMsg && (
                  <div className="bds-alert success mb-3">
                    <CheckCircle2 size={16} />
                    <span className="flex-1 min-w-0 truncate">{piGeneratedMsg}</span>
                    <button
                      type="button"
                      onClick={() => setPiGeneratedMsg(null)}
                      className="flex items-center shrink-0 hover:opacity-70"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* 阶段 IA-3：转单成功横幅 —— 「查看订单」直达跳转（convertedOrderId 只装真实订单 id） */}
                {convertedOrderId && (
                  <div className="bds-alert success mb-3">
                    <CheckCircle2 size={16} />
                    <span className="flex-1 min-w-0 truncate">已转为订单 {convertedOrderId}</span>
                    {onOpenOrder && (
                      <button
                        type="button"
                        onClick={() => onOpenOrder(convertedOrderId)}
                        className="bds-btn bds-btn-link flex items-center gap-1 shrink-0"
                      >
                        查看订单 <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                )}

                {/* 列表 */}
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                  </div>
                ) : visibleQuotations.length === 0 ? (
                  <div className="bds-empty">
                    <div className="glyph"><FileText size={24} /></div>
                    <div className="title">{navRelationFilter ? '该客户暂无报价单' : '暂无报价单'}</div>
                    <div className="desc">{navRelationFilter ? '当前为跨模块筛选视图，点上方 ✕ 查看全部' : '点击「新建报价单」开始，或导入历史报价'}</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {visibleQuotations.map((qt, index) => (
                      <motion.div
                        key={qt.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className="bds-card"
                        style={{ padding: 0, overflow: 'hidden' }}
                      >
                        {/* 卡片头部 */}
                        <div
                          className="flex items-center gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                          onClick={() => setExpandedId(expandedId === qt.id ? null : qt.id)}
                        >
                          <button className="flex-shrink-0" style={{ color: 'var(--text-quaternary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                            {expandedId === qt.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>{qt.quotationNumber}</span>
                              <span className={`bds-badge sm ${STATUS_BADGE_VARIANT[qt.status as QuotationStatus] || 'neutral'}`}>
                                <span className="dot"></span>
                                {STATUS_LABELS[qt.status as QuotationStatus] || qt.status}
                              </span>
                              {/* 双轨偏差徽标（PRD 8.6 历史快照；warn=已触发审批，block=未审批禁止发送） */}
                              {qt.priceDeviationLevel === 'warn' && (
                                <span className="bds-badge sm warning">
                                  <AlertTriangle size={14} />
                                  偏差 {(qt.priceDeviationPercent ?? 0) > 0 ? '+' : ''}{qt.priceDeviationPercent}% · 已触发审批
                                </span>
                              )}
                              {qt.priceDeviationLevel === 'block' && (
                                <span className="bds-badge sm danger">
                                  <AlertCircle size={14} />
                                  偏差 {(qt.priceDeviationPercent ?? 0) > 0 ? '+' : ''}{qt.priceDeviationPercent}% · 需审批后发送
                                </span>
                              )}
                              {/* Sent 超 7 天未回复 → 琥珀提醒（sentAt 为首次发送时间） */}
                              {sentDaysPending(qt) != null && (
                                <span className="bds-badge sm warning">
                                  <AlertTriangle size={14} />
                                  已发送 {sentDaysPending(qt)} 天 · 待客户回复
                                </span>
                              )}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              {qt.customerName || '未指定客户'} · {formatDate(qt.issueDate)}
                              {qt.validUntil ? ` · 有效期至 ${qt.validUntil}` : ''}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                              {formatAmount(Number(qt.totalAmount), qt.currency)}
                            </div>
                            {qt.lines && qt.lines.length > 0 && (
                              <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>{qt.lines.length} 行</div>
                            )}
                          </div>
                        </div>

                        {/* 展开详情 */}
                        <AnimatePresence>
                          {expandedId === qt.id && (
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
                                  {qt.deliveryTerms && <div><span className="opacity-60">交货:</span> {qt.deliveryTerms}</div>}
                                  {qt.paymentTerms && <div><span className="opacity-60">付款:</span> {qt.paymentTerms}</div>}
                                  {qt.salesperson && <div><span className="opacity-60">业务员:</span> {qt.salesperson}</div>}
                                  {qt.inquiryRef && <div><span className="opacity-60">询价参考:</span> {qt.inquiryRef}</div>}
                                </div>

                                {/* 双轨定价快照（PRD 8.6 历史快照，仅内部参考） */}
                                {qt.priceDeviationLevel && qt.trackAMedianUsd != null && qt.trackBFinalUsd != null && (
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-inset text-xs bds-inset" style={{ color: 'var(--text-tertiary)' }}>
                                    <span className="opacity-60">双轨快照（内部）:</span>
                                    <span>轨道 A 中位 ${Number(qt.trackAMedianUsd).toFixed(4)}/{qt.trackAUnit === 'PC' ? '件' : '米'}</span>
                                    <span>轨道 B 终价 ${Number(qt.trackBFinalUsd).toFixed(4)}</span>
                                    <span style={{ color: qt.priceDeviationLevel === 'block' ? 'var(--danger-text)' : qt.priceDeviationLevel === 'warn' ? 'var(--warning-text)' : 'var(--success-text)' }}>
                                      偏差 {(qt.priceDeviationPercent ?? 0) > 0 ? '+' : ''}{qt.priceDeviationPercent}%
                                      {qt.priceDeviationLevel === 'warn' && '（已触发审批）'}
                                      {qt.priceDeviationLevel === 'block' && '（未审批通过禁止发送）'}
                                    </span>
                                  </div>
                                )}

                                {/* 行明细表 */}
                                {qt.lines && qt.lines.length > 0 && (
                                  <div className="rounded-inset overflow-hidden bds-inset">
                                    <table className="bds-table">
                                      <thead>
                                        <tr>
                                          <th>#</th>
                                          <th>编码</th>
                                          <th>品名</th>
                                          <th className="num">数量</th>
                                          <th style={{ textAlign: 'center' }}>单位</th>
                                          <th className="num">单价</th>
                                          <th className="num">金额</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {qt.lines.map((line) => (
                                          <tr key={line.id}>
                                            <td>{line.lineNumber}</td>
                                            <td className="bds-mono">{line.fabricCode || '—'}</td>
                                            <td>{line.description}</td>
                                            <td className="num bds-tnum">{Number(line.quantity).toLocaleString('en-US')}</td>
                                            <td style={{ textAlign: 'center' }}>{line.unit}</td>
                                            <td className="num bds-tnum">{Number(line.unitPrice).toFixed(4)}</td>
                                            <td className="num bds-tnum">{Number(line.amount).toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {/* 操作按钮 */}
                                <div className="flex items-center gap-2 pt-2 flex-wrap">
                                  {/* REQ2-19 版本徽章（version≥2 可查谈判链） */}
                                  {(qt as any).version != null && (qt as any).version >= 2 && (
                                    <button
                                      onClick={() => openVersionSheet(qt)}
                                      className="bds-btn bds-btn-ghost"
                                      title="砍价版本历史"
                                    >
                                      <History size={14} />
                                      <span>v{(qt as any).version}</span>
                                    </button>
                                  )}
                                  {/* REQ2-19：客户砍价画像（客户维度首报偏差统计） */}
                                  {qt.customerRelationId && (
                                    <button
                                      onClick={() => openPriceProfile(qt.customerRelationId!, qt.customerName || '客户')}
                                      className="bds-btn bds-btn-ghost"
                                      title="该客户历史砍价画像"
                                    >
                                      <TrendingDown size={14} />
                                      <span>画像</span>
                                    </button>
                                  )}
                                  {qt.status === 'Draft' && (
                                    <>
                                      {/* C14 砍价修订改价入口：草稿直接编辑改价（表单回填，保存走 updateQuotation） */}
                                      <button
                                        onClick={() => openEditForm(qt)}
                                        className="bds-btn bds-btn-secondary"
                                        title="编辑草稿报价（改价/改行后保存，版本链自动留痕）"
                                      >
                                        <Pencil size={14} />
                                        <span>编辑</span>
                                      </button>
                                      <button
                                        onClick={() => { setPricingQuoteId(qt.id); setPricingResult(null); }}
                                        className="bds-btn bds-btn-secondary"
                                      >
                                        <Calculator size={14} />
                                        <span>应用定价</span>
                                      </button>
                                      {canWriteQuotation && (
                                        <button onClick={() => handleAction(qt.id, 'send')} disabled={actionLoading === `${qt.id}_send`} className="bds-btn bds-btn-secondary">
                                          {actionLoading === `${qt.id}_send` ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                          <span>发送报价</span>
                                        </button>
                                      )}
                                      {/* 双轨红标门禁提示（PRD 8.6）：偏差 >30% 需审批通过后服务端才放行发送 */}
                                      {qt.priceDeviationLevel === 'block' && (
                                        <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--danger-text)' }}>
                                          <AlertCircle size={14} />
                                          偏差超 30%，需审批通过后发送
                                        </span>
                                      )}
                                      {canWriteQuotation && (
                                        <button onClick={() => handleAction(qt.id, 'delete')} disabled={actionLoading === `${qt.id}_delete`} className="bds-btn bds-btn-danger">
                                          {actionLoading === `${qt.id}_delete` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                          <span>删除</span>
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {qt.status === 'Sent' && (
                                    <>
                                      <button onClick={() => handleAction(qt.id, 'accept')} disabled={actionLoading === `${qt.id}_accept`} className="bds-btn bds-btn-secondary">
                                        {actionLoading === `${qt.id}_accept` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                        <span>接受</span>
                                      </button>
                                      {/* REQ2-19：砍价修订（快照当前版回 Draft 改价重发） */}
                                      <button onClick={() => handleAction(qt.id, 'revise')} disabled={actionLoading === `${qt.id}_revise`} className="bds-btn bds-btn-secondary">
                                        {actionLoading === `${qt.id}_revise` ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
                                        <span>砍价修订</span>
                                      </button>
                                      <button onClick={() => handleAction(qt.id, 'reject')} disabled={actionLoading === `${qt.id}_reject`} className="bds-btn bds-btn-danger">
                                        {actionLoading === `${qt.id}_reject` ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                                        <span>拒绝</span>
                                      </button>
                                    </>
                                  )}
                                  {(qt.status === 'Accepted' || qt.status === 'Rejected' || qt.status === 'Expired') && (
                                    <>
                                      {canWriteQuotation && qt.status === 'Accepted' && !qt.convertedOrderId && (
                                        <button
                                          onClick={() => openConvertModal(qt)}
                                          disabled={actionLoading === `${qt.id}_convert`}
                                          className="bds-btn bds-btn-secondary"
                                          title="补充 PO 号/工厂/交期/订单类型后转为正式订单"
                                        >
                                          {actionLoading === `${qt.id}_convert` ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                                          <span>转为订单</span>
                                        </button>
                                      )}
                                      {qt.status === 'Accepted' && (
                                        <button
                                          onClick={() => handleGeneratePi(qt.id)}
                                          disabled={actionLoading === `${qt.id}_generatePi`}
                                          className="bds-btn bds-btn-secondary"
                                        >
                                          {actionLoading === `${qt.id}_generatePi` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                                          <span>生成 PI</span>
                                        </button>
                                      )}
                                      <button
                                        onClick={() => setTraceQuoteId(qt.id)}
                                        className="bds-btn bds-btn-secondary"
                                      >
                                        <GitBranch size={14} />
                                        <span>溯源</span>
                                      </button>
                                      {qt.status === 'Accepted' && qt.convertedOrderId && (
                                        <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                                          <CheckCircle2 size={14} />
                                          <span>已转订单</span>
                                          {onOpenOrder ? (
                                            <button
                                              type="button"
                                              onClick={() => onOpenOrder(qt.convertedOrderId!)}
                                              className="bds-btn bds-btn-link flex items-center gap-0.5"
                                            >
                                              {qt.convertedOrderId} <ArrowRight size={14} />
                                            </button>
                                          ) : (
                                            <span>{qt.convertedOrderId}</span>
                                          )}
                                        </div>
                                      )}
                                      {(qt.status === 'Rejected' || qt.status === 'Expired') && (
                                        <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-quaternary)' }}>
                                          <Clock size={14} />
                                          <span>{STATUS_LABELS[qt.status as QuotationStatus]} — 终态</span>
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {/* B7 报价单服务端单据：预览 / 生成 PDF（服务端模板，归档单据中心） */}
                                  <button
                                    type="button"
                                    onClick={() => void handlePreviewQt(qt)}
                                    className="bds-btn bds-btn-ghost"
                                  >
                                    <Eye size={14} />
                                    <span>预览单据</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleGenerateQtDocument(qt)}
                                    disabled={actionLoading === `${qt.id}_gendoc`}
                                    className="bds-btn bds-btn-ghost"
                                  >
                                    {actionLoading === `${qt.id}_gendoc` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                                    <span>生成 PDF</span>
                                  </button>
                                </div>
                                {qt.customerRelationId && (
                                <div className="pt-3">
                                  <RelatedWorkspacesSection
                                    sourceType="relation"
                                    relationId={qt.customerRelationId}
                                    relationName={qt.customerName ?? ''}
                                    relationRole="customer"
                                    onNavigate={onNavigate}
                                    isDarkMode={isDarkMode}
                                  />
                                </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                    {/* 分页消费：消费 total，超 100 条不再静默截断 */}
                    {!navRelationFilter && total > 0 && (
                      <div className="flex items-center justify-center gap-3 pt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        <span>共 {total} 条{quotations.length < total ? `，已加载 ${quotations.length} 条` : ''}</span>
                        {quotations.length < total && (
                          <button
                            onClick={() => fetchQuotations(quotations.length)}
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

      {/* 阶段 P3c：历史报价导入向导 */}
      <QuotationImportWizard
        isOpen={showImportWizard}
        onClose={() => setShowImportWizard(false)}
        onImported={() => { setShowImportWizard(false); fetchQuotations(); }}
      />

      {/* V2 双轨定价 modal：对已保存报价单应用 Track A/B → 写入快照 + 偏差分级 */}
      {pricingQuoteId && (
        <div className="bds-modal-mask" onClick={() => setPricingQuoteId(null)}>
          <div
            className="bds-modal"
            style={{ width: '56rem', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="bds-text-sm" style={{ color: 'var(--text-primary)' }}>
                应用双轨定价 — Track A 估算 + Track B 退税定价
              </h3>
              <button onClick={() => setPricingQuoteId(null)} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}>
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <TrackAPanel
                isDarkMode={isDarkMode}
                onInputsChange={setPricingTrackA}
                onMedianUsdChange={() => {}}
              />
              <div className="space-y-3">
                <TrackBPanel
                  onResultChange={() => {}}
                  onInputsChange={setPricingTrackB}
                />
              </div>
            </div>

            {/* 定价结果 */}
            {pricingResult && (
              <div className="mt-4 p-3 rounded-inset text-xs bds-inset" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-center gap-4 flex-wrap">
                  <span>Track A 中位: <strong>${pricingResult.trackAMedianUsd?.toFixed(4)}</strong></span>
                  <span>Track B 终价: <strong>${pricingResult.trackBFinalUsd?.toFixed(4)}</strong></span>
                  <span>偏差: <strong style={{ color: pricingResult.deviationLevel === 'ok' ? 'var(--success-text)' : pricingResult.deviationLevel === 'warn' ? 'var(--warning-text)' : 'var(--danger-text)' }}>{pricingResult.deviationPercent?.toFixed(1)}% ({pricingResult.deviationLevel})</strong></span>
                  <span>可发送: <strong>{pricingResult.canSend ? '是' : '否'}</strong></span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setPricingQuoteId(null)}
                className="bds-btn bds-btn-ghost"
              >
                关闭
              </button>
              <button
                onClick={handlePricingCheck}
                disabled={applyingPricing}
                className="bds-btn bds-btn-secondary"
              >
                {applyingPricing ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                <span>查询校验</span>
              </button>
              <button
                onClick={handleApplyPricing}
                disabled={applyingPricing || !pricingTrackB}
                className="bds-btn bds-btn-primary"
              >
                {applyingPricing ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
                <span>{applyingPricing ? '计算中...' : '应用定价'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C16 转订单补充信息弹窗：PO 号 / 工厂 / 交期 / 订单类型 → convert-to-order overrides */}
      {convertTarget && (
        <div className="bds-modal-mask" onClick={() => setConvertTarget(null)}>
          <div
            className="bds-modal"
            style={{ width: '28rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="bds-text-sm" style={{ color: 'var(--text-primary)' }}>
                转为订单 — {convertTarget.quotationNumber}
              </h3>
              <button onClick={() => setConvertTarget(null)} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className={labelCls}>PO 号</label>
                <input
                  type="text"
                  value={convertForm.poNumber}
                  onChange={(e) => setConvertForm({ ...convertForm, poNumber: e.target.value })}
                  placeholder="默认沿用报价号"
                  className="bds-input"
                />
              </div>
              <div>
                <label className={labelCls}>工厂</label>
                <input
                  type="text"
                  value={convertForm.millName}
                  onChange={(e) => setConvertForm({ ...convertForm, millName: e.target.value })}
                  placeholder="生产工厂名称"
                  className="bds-input"
                />
              </div>
              <div>
                <label className={labelCls}>交期</label>
                <CapsuleDateInput
                  className="bds-input"
                  value={convertForm.dueDate}
                  onChange={(v) => setConvertForm({ ...convertForm, dueDate: v })}
                />
              </div>
              <div>
                <label className={labelCls}>订单类型</label>
                <CustomSelect
                  surface="form"
                  className="w-full"
                  ariaLabel="订单类型"
                  value={convertForm.type}
                  onChange={(v) => setConvertForm({ ...convertForm, type: v })}
                  options={[
                    { value: 'Fabric', label: '面料订单' },
                    { value: 'Garment', label: '成衣订单' },
                    { value: 'Other', label: '其他' },
                  ]}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setConvertTarget(null)}
                className="bds-btn bds-btn-ghost"
              >
                取消
              </button>
              <button
                onClick={handleConvertConfirm}
                disabled={actionLoading === `${convertTarget.id}_convert`}
                className="bds-btn bds-btn-primary"
              >
                {actionLoading === `${convertTarget.id}_convert` ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                <span>确认转订单</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一键溯源侧边面板（BDS Sheet 右滑抽屉 · 640 宽度） */}
      {traceQuoteId && (
        <>
          <div className="bds-sheet-mask open" onClick={() => setTraceQuoteId(null)} />
          <div className="bds-sheet lg open" role="dialog" aria-label="报价到发货链溯源">
            <div className="sh-head" style={{ alignItems: 'center' }}>
              <div className="sh-main">
                <div className="sh-title flex items-center gap-2">
                  <GitBranch size={16} style={{ color: 'var(--text-tertiary)' }} />
                  报价到发货链溯源
                </div>
                <div className="sh-sub">Quote to Ship</div>
              </div>
              <button
                type="button"
                onClick={() => setTraceQuoteId(null)}
                className="bds-btn bds-btn-ghost"
                style={{ padding: '0 var(--space-2)' }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="sh-body" style={{ padding: 0 }}>
              <TraceabilityPanel
                isDarkMode={isDarkMode}
                presetScenario="quoteToShip"
                presetRootId={traceQuoteId}
                embedded
              />
            </div>
          </div>
        </>
      )}

      {/* ── REQ2-19（DR-060）：版本历史弹层（谈判链 append-only） ── */}
      {versionSheet && (
        <BottomSheet isOpen onClose={() => setVersionSheet(null)} title={`版本历史 · ${versionSheet.quotation.quotationNumber ?? ''}`} isDarkMode={isDarkMode}>
          <div className="space-y-2 px-6 py-5">
            <div className="text-[11px] font-light leading-relaxed text-[var(--text-tertiary)]">
              当前 v{versionSheet.quotation.version ?? 1} · {Number(versionSheet.quotation.totalAmount).toFixed(2)} {versionSheet.quotation.currency}；
              下方为历史版本快照（保存新版本前的完整旧内容，含行单价留痕）。
            </div>
            {versionSheet.versions.length === 0 && (
              <div className="text-xs font-light text-[var(--text-tertiary)] px-1 py-2">加载中...</div>
            )}
            {versionSheet.versions.map((v: any) => (
              <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-compact bg-[var(--recessed-bg)] px-3 py-2 text-xs">
                <span className="bds-badge neutral">v{v.version}</span>
                <span className="font-light text-[var(--text-primary)]">{Number(v.totalAmount).toFixed(2)} {v.currency ?? ''}</span>
                {v.changeReason && <span className="bds-badge info">{v.changeReason}</span>}
                {v.linesSnapshot && v.linesSnapshot.length > 0 && (
                  <span className="text-[10px] font-light text-[var(--text-tertiary)]">
                    行单价 {v.linesSnapshot.map((l: any) => Number(l.unitPrice).toFixed(2)).join(' / ')}
                  </span>
                )}
                <span className="ml-auto text-[10px] font-light text-[var(--text-tertiary)]">
                  {new Date(Number(v.createdAt)).toLocaleString('zh-CN', { hour12: false })}
                </span>
              </div>
            ))}
          </div>
        </BottomSheet>
      )}

      {/* ── REQ2-19（DR-060）：客户砍价画像弹层 ── */}
      {profileSheet && (
        <BottomSheet isOpen onClose={() => setProfileSheet(null)} title={`砍价画像 · ${profileSheet.relationName}`} isDarkMode={isDarkMode}>
          <div className="space-y-3 px-6 py-5">
            {!profileSheet.profile && <div className="text-xs font-light text-[var(--text-tertiary)]">加载中...</div>}
            {profileSheet.profile && profileSheet.profile.items?.length === 0 && (
              <div className="text-xs font-light text-[var(--text-tertiary)]">该客户暂无报价记录。</div>
            )}
            {profileSheet.profile?.summary && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: '报价单数', value: profileSheet.profile.summary.quotationCount },
                  { label: '砍价单数', value: profileSheet.profile.summary.negotiatedCount },
                  { label: '平均降幅', value: `${profileSheet.profile.summary.avgCutPct}%` },
                  { label: '成交偏差', value: profileSheet.profile.summary.avgDealDeviationPct != null ? `${profileSheet.profile.summary.avgDealDeviationPct}%` : '—' },
                ].map(cell => (
                  <div key={cell.label} className="rounded-compact bg-[var(--recessed-bg)] px-2 py-2.5 text-center">
                    <div className="text-base font-light text-[var(--text-primary)]">{cell.value}</div>
                    <div className="text-[10px] font-light text-[var(--text-tertiary)]">{cell.label}</div>
                  </div>
                ))}
              </div>
            )}
            {profileSheet.profile?.items?.map((item: any) => (
              <div key={item.quotationId} className="rounded-compact bg-[var(--recessed-bg)] px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-light text-[var(--text-primary)]">{item.quotationNumber}</span>
                  <span className="bds-badge neutral">{item.status}</span>
                  <span className="text-[10px] font-light text-[var(--text-tertiary)]">v{item.version} · {item.rounds} 轮</span>
                  <span className="text-[10px] font-light text-[var(--text-tertiary)]">{item.issueDate}</span>
                  {item.cutPct != null && item.cutPct !== 0 && (
                    <span className="bds-badge warning">{item.cutPct > 0 ? '+' : ''}{item.cutPct}%</span>
                  )}
                  {item.dealDeviationPct != null && (
                    <span className="bds-badge info">成交 {item.dealDeviationPct}%{item.orderPo ? ` · ${item.orderPo}` : ''}</span>
                  )}
                </div>
                <div className="mt-1 text-[10px] font-light text-[var(--text-tertiary)]">
                  首报 {item.firstAmount} → 当前 {item.currentAmount} {item.currency}
                </div>
              </div>
            ))}
          </div>
        </BottomSheet>
      )}

      {/* B7 报价单服务端单据：A4 预览（与生成 PDF 同源排版，所见即所得） */}
      {previewQt && (
        <A4DocumentPreviewModal
          title={`报价单预览 · ${previewQt.quotationNumber}`}
          subtitle={`A4 · Quotation · 与生成 PDF 同源排版`}
          html={previewHtml}
          loading={previewLoading}
          error={previewErr}
          onClose={() => setPreviewQt(null)}
          onPrint={() => void handleGenerateQtDocument(previewQt)}
          printLabel="生成 PDF"
        />
      )}
    </div>
  );
};

export default QuotationManager;
