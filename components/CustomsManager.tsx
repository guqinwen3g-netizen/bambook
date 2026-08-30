/**
 * 外贸与报关 CustomsManager
 * Phase 5 B5 + Phase 3 C6：服装外贸出口合规闭环
 *
 * 功能：
 *   - 报关单管理（CRUD + 状态机 + 明细行）
 *   - HS 编码库（参考数据 CRUD + 停用）
 *   - 信用证管理（CRUD + 状态机 + 不符点记录）
 *   - 出口退税（CRUD + 状态机 + 审核 + 自动退税额计算）
 *   - 贸易单据（入口卡：台账/版本/打包已收口至「单据中心」，Wave A1 去重）
 *   - 出运制单（阶段 IA-2 自业务工具收编：运单一键生成 CI/PL/CO/BL 成套单据）
 *   - 单据模板（阶段 IA-2 自业务工具收编：13 类外贸单据 HTML 模板管理）
 *
 * 设计原则：
 *   - 状态用 bds-badge 语义变体（SEMANTIC_BADGE_VARIANT）
 *   - BDS v2.1 组件族（bds-card/bds-btn/bds-input/bds-modal 等）
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  FileCheck,
  BookOpen,
  CreditCard,
  Receipt,
  FileText,
  X,
  Pencil,
  ChevronDown,
  ChevronRight,
  History,
  Layers,
  LayoutTemplate,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import ShipmentDocumentGenerator from './tools/ShipmentDocumentGenerator';
import DocumentTemplateManager from './tools/DocumentTemplateManager';
import CustomSelect from './ui/CustomSelect';
import {
  CustomsDeclaration,
  CustomsDeclarationInput,
  CustomsDeclarationLineInput,
  CustomsDeclarationStatus,
  CustomsType,
  HsCode,
  HsCodeInput,
  HsCodeCategory,
  LetterOfCredit,
  LetterOfCreditInput,
  LetterOfCreditType,
  LetterOfCreditStatus,
  LcEvent,
  TaxRefund,
  TaxRefundInput,
  TaxRefundStatus,
  VatInvoice,
  VatInvoiceStatus,
} from '../types';
import { vatInvoiceService } from '../services/vatInvoiceService';
import { consumeCrossModuleNav } from '../services/crossModuleNav';
import { NavRelationFilterChip } from './ui/NavRelationFilterChip';
import { hasPermission } from '../services/authService';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import { StatusSemantic } from './rdlBusinessStatusTokens';
import { useStaticEdgeMask } from './ui/useStaticEdgeMask';
import { RelatedWorkspacesSection } from './ui/RelatedWorkspacesSection';
import { BdsDialog } from './ui/BdsDialog';

// ==================== 常量 ====================

type TabId = 'declarations' | 'hsCodes' | 'lettersOfCredit' | 'taxRefunds' | 'tradeDocuments' | 'docGenerator' | 'docTemplates';

/** A5d 报表下钻联动：允许外部（报表中心）按 id 指定落点 tab */
export type { TabId as CustomsTabId };

/** 阶段 IA-2：制单工具 tab（本地工具面板，不走列表数据拉取/搜索/状态筛选）；Wave A1：贸易单据台账收口单据中心，入口卡同例 */
const TOOL_TAB_IDS: ReadonlySet<TabId> = new Set(['tradeDocuments', 'docGenerator', 'docTemplates']);

/** R3 分页：四类单据列表每页条数（offset 追加加载，徽章显服务端 total） */
const LIST_PAGE_SIZE = 200;

/** R678：跨模块导航 relation 筛选落得动的 tab（HS 编码库为全局参考数据，无 relation 维度不参与） */
const NAV_FILTER_TAB_LABEL: Partial<Record<TabId, string>> = {
  declarations: '报关单',
  lettersOfCredit: '信用证',
  taxRefunds: '出口退税',
};

const CUSTOMS_TYPES: Array<{ id: CustomsType; label: string }> = [
  { id: 'Export', label: '出口' },
  { id: 'Import', label: '进口' },
];

const DECLARATION_STATUSES: Array<{ id: CustomsDeclarationStatus; label: string; semantic: StatusSemantic }> = [
  { id: 'Draft', label: '草稿', semantic: 'neutral' },
  { id: 'Submitted', label: '已申报', semantic: 'info' },
  { id: 'Declared', label: '已报关', semantic: 'info' },
  { id: 'Inspecting', label: '查验中', semantic: 'warning' },
  { id: 'Released', label: '已放行', semantic: 'success' },
  { id: 'Exception', label: '异常', semantic: 'danger' },
  { id: 'Cancelled', label: '已取消', semantic: 'neutral' },
];

const HS_CATEGORIES: Array<{ id: HsCodeCategory; label: string }> = [
  { id: 'Textile', label: '纺织品' },
  { id: 'Garment', label: '服装' },
  { id: 'Accessory', label: '辅料' },
  { id: 'Material', label: '原料' },
  { id: 'Yarn', label: '纱线' },
  { id: 'Other', label: '其他' },
];

const LC_TYPES: Array<{ id: LetterOfCreditType; label: string }> = [
  { id: 'Irrevocable', label: '不可撤销' },
  { id: 'Revocable', label: '可撤销' },
  { id: 'Standby', label: '备用' },
  { id: 'Transferable', label: '可转让' },
];

const LC_STATUSES: Array<{ id: LetterOfCreditStatus; label: string; semantic: StatusSemantic }> = [
  { id: 'Issued', label: '已开证', semantic: 'info' },
  { id: 'Presented', label: '已交单', semantic: 'info' },
  { id: 'Accepted', label: '已承兑', semantic: 'success' },
  { id: 'Discrepant', label: '不符点', semantic: 'warning' },
  { id: 'Settled', label: '已结算', semantic: 'success' },
  { id: 'Expired', label: '已过期', semantic: 'neutral' },
  { id: 'Cancelled', label: '已取消', semantic: 'neutral' },
];

const TAX_REFUND_STATUSES: Array<{ id: TaxRefundStatus; label: string; semantic: StatusSemantic }> = [
  { id: 'Draft', label: '草稿', semantic: 'neutral' },
  { id: 'Submitted', label: '已申报', semantic: 'info' },
  { id: 'Reviewing', label: '审核中', semantic: 'warning' },
  { id: 'Approved', label: '已批准', semantic: 'success' },
  { id: 'Rejected', label: '已拒绝', semantic: 'danger' },
  { id: 'Refunded', label: '已退税', semantic: 'success' },
  { id: 'Cancelled', label: '已取消', semantic: 'neutral' },
];

// C6 勾稽：增值税发票状态文案（镜像 FinanceManager VAT_STATUS_LABELS 契约，不猜字符串）
const VAT_INVOICE_STATUS_LABELS: Record<VatInvoiceStatus, string> = {
  Received: '已收票',
  Verified: '已认证',
  Declared: '已申报退税',
  RedFlushed: '已红冲',
  Cancelled: '已作废',
};

const TRADE_TERMS = ['FOB', 'CIF', 'EXW', 'DDP', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'CFR'];

// BDS 徽章语义变体映射（bds-badge 无 active/rebate 变体，归并到 info）
type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger' | 'warning';
const SEMANTIC_BADGE_VARIANT: Record<StatusSemantic, BadgeVariant> = {
  neutral: 'neutral',
  active: 'info',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
  destructive: 'danger',
  rebate: 'info',
};

// BDS 语义纯色（时间轴圆点/文字等小型状态元素，取语义文本色 token）
const SEMANTIC_TEXT_COLOR: Record<StatusSemantic, string> = {
  neutral: 'var(--text-quaternary)',
  active: 'var(--accent-text)',
  info: 'var(--accent-text)',
  warning: 'var(--warning-text)',
  danger: 'var(--danger-text)',
  success: 'var(--success-text)',
  destructive: 'var(--danger-text)',
  rebate: 'var(--accent-text)',
};

interface CustomsManagerProps {
  isDarkMode: boolean;
  /** A5d 报表下钻联动：指定落点 tab（如 taxRefunds），变更时响应式同步 */
  initialTab?: TabId;
  /** Wave A1：贸易单据台账收口单据中心后的跳转回调（App 注入 handleViewChange） */
  onOpenDocumentCenter?: () => void;
  /** 跨模块导航：单据详情「关联业务」入口页面切换 */
  onNavigate?: (view: import('../types').View) => void;
}

// ==================== 组件 ====================

const CustomsManager: React.FC<CustomsManagerProps> = ({ isDarkMode, initialTab, onOpenDocumentCenter, onNavigate }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'declarations');
  // 边缘渐隐：固定 mask 挂滚动容器自身（12px 轻微渐隐——修复原 ScrollEdgeFades null-ref 断链，恢复渐隐）
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  useStaticEdgeMask(contentScrollRef, { topFadeEnd: 12, bottomFade: 12 });
  // A5d：与 FinanceManager 同一口径 — initialTab 变更时响应式同步（下钻落点定位）
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // 跨模块导航筛选（关系智库档案「关联业务 → 报关/退税/信用证」入口）：
  // 挂载时消费一次——tab 预填 + relation 筛选（fetch 参数接 relationId，服务端过滤）；✕ 清除回全量
  const navContext = useState(() => consumeCrossModuleNav())[0];
  const [navRelationFilter, setNavRelationFilter] = useState(() => navContext?.filter ?? null);
  useEffect(() => {
    if (navContext?.tab && ['declarations', 'hsCodes', 'lettersOfCredit', 'taxRefunds', 'tradeDocuments', 'docGenerator', 'docTemplates'].includes(navContext.tab)) {
      setActiveTab(navContext.tab as TabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [declarations, setDeclarations] = useState<CustomsDeclaration[]>([]);
  const [hsCodes, setHsCodes] = useState<HsCode[]>([]);
  const [lettersOfCredit, setLettersOfCredit] = useState<LetterOfCredit[]>([]);
  const [taxRefunds, setTaxRefunds] = useState<TaxRefund[]>([]);
  // R3：服务端 total（tab 徽章 + 加载更多判定），不再以 items.length 冒充全量
  const [declTotal, setDeclTotal] = useState(0);
  const [hsTotal, setHsTotal] = useState(0);
  const [lcTotal, setLcTotal] = useState(0);
  const [trTotal, setTrTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // R678：搜索防抖——逐键触发服务端请求（fetch* 依赖 searchQuery）改为 300ms 防抖后的 debouncedSearch
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // F1：信用证节点时间轴
  const [lcTimelineId, setLcTimelineId] = useState<string | null>(null);
  const [lcEvents, setLcEvents] = useState<LcEvent[]>([]);
  const [lcEventsLoading, setLcEventsLoading] = useState(false);

  // G2：信用证「录入不符点」内联录入（点击后展开输入框，确认后流转 Discrepant）
  const [lcDiscrepancyId, setLcDiscrepancyId] = useState<string | null>(null);
  const [lcDiscrepancyText, setLcDiscrepancyText] = useState('');

  // G5：HS 编码编辑（复用新建弹窗，editing 非空即编辑模式）
  const [editingHsCode, setEditingHsCode] = useState<HsCode | null>(null);

  // C6：退税申报单进项专票勾稽（消费 GET /v1/finance/vat-invoices?taxRefundId=）
  const [trVatId, setTrVatId] = useState<string | null>(null);
  const [trVatInvoices, setTrVatInvoices] = useState<VatInvoice[]>([]);
  const [trVatLoading, setTrVatLoading] = useState(false);

  // 创建表单状态
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── 拉取数据（R3：offset>0 为「加载更多」追加页，否则为首屏替换） ──
  // R678：relation 筛选接服务端（declarations/letters-of-credit/tax-refunds 均支持 relationId 过滤；
  // HS 编码库为全局参考数据无 relation 维度，不下发）；搜索词用 debouncedSearch（300ms 防抖）
  const fetchDeclarations = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const result = await apiService.listCustomsDeclarations({
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        relationId: navRelationFilter?.relationId || undefined,
        limit: LIST_PAGE_SIZE,
        offset,
      });
      setDeclarations(prev => (offset > 0 ? [...prev, ...result.items] : result.items));
      setDeclTotal(result.total);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, statusFilter, navRelationFilter]);

  const fetchHsCodes = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const result = await apiService.listHsCodes({ search: debouncedSearch || undefined, limit: LIST_PAGE_SIZE, offset });
      setHsCodes(prev => (offset > 0 ? [...prev, ...result.items] : result.items));
      setHsTotal(result.total);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch]);

  const fetchLettersOfCredit = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const result = await apiService.listLettersOfCredit({
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        relationId: navRelationFilter?.relationId || undefined,
        limit: LIST_PAGE_SIZE,
        offset,
      });
      setLettersOfCredit(prev => (offset > 0 ? [...prev, ...result.items] : result.items));
      setLcTotal(result.total);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, statusFilter, navRelationFilter]);

  const fetchTaxRefunds = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const result = await apiService.listTaxRefunds({
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        relationId: navRelationFilter?.relationId || undefined,
        limit: LIST_PAGE_SIZE,
        offset,
      });
      setTaxRefunds(prev => (offset > 0 ? [...prev, ...result.items] : result.items));
      setTrTotal(result.total);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, statusFilter, navRelationFilter]);

  useEffect(() => {
    if (TOOL_TAB_IDS.has(activeTab)) { setLoading(false); return; }
    if (activeTab === 'declarations') fetchDeclarations();
    if (activeTab === 'hsCodes') fetchHsCodes();
    if (activeTab === 'lettersOfCredit') fetchLettersOfCredit();
    if (activeTab === 'taxRefunds') fetchTaxRefunds();
  }, [activeTab, fetchDeclarations, fetchHsCodes, fetchLettersOfCredit, fetchTaxRefunds]);

  // R6：写操作门禁——后端写端点均挂 customs:write scope（requireCustomsWrite），无权限不渲染写按钮（防 403 假动作）
  const canWriteCustoms = hasPermission('customs:write');

  // 搜索框 Enter：跳过防抖立即应用当前输入
  const applySearchNow = useCallback(() => setDebouncedSearch(searchQuery.trim()), [searchQuery]);

  // ── 辅助 ──
  const formatNum = (n: string | number | null | undefined, digits = 2) => {
    if (n == null || n === '') return '—';
    const num = Number(n);
    if (isNaN(num)) return String(n);
    return num.toLocaleString('en-US', { maximumFractionDigits: digits });
  };
  const formatDate = (s?: string | null) => s || '—';
  const declStatusInfo = (s: CustomsDeclarationStatus) => DECLARATION_STATUSES.find(d => d.id === s) || DECLARATION_STATUSES[0];
  const lcStatusInfo = (s: LetterOfCreditStatus) => LC_STATUSES.find(d => d.id === s) || LC_STATUSES[0];
  const taxRefundStatusInfo = (s: TaxRefundStatus) => TAX_REFUND_STATUSES.find(d => d.id === s) || TAX_REFUND_STATUSES[0];

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'declarations', label: '报关单', icon: <FileCheck size={16} strokeWidth={1.75} />, count: declTotal },
    { id: 'hsCodes', label: 'HS 编码库', icon: <BookOpen size={16} strokeWidth={1.75} />, count: hsTotal },
    { id: 'lettersOfCredit', label: '信用证', icon: <CreditCard size={16} strokeWidth={1.75} />, count: lcTotal },
    { id: 'taxRefunds', label: '出口退税', icon: <Receipt size={16} strokeWidth={1.75} />, count: trTotal },
    { id: 'tradeDocuments', label: '贸易单据', icon: <FileText size={16} strokeWidth={1.75} /> },
    { id: 'docGenerator', label: '出运制单', icon: <Layers size={16} strokeWidth={1.75} /> },
    { id: 'docTemplates', label: '单据模板', icon: <LayoutTemplate size={16} strokeWidth={1.75} /> },
  ];

  // ── 状态转换 ──
  const handleTransitionDeclaration = useCallback(async (id: string, toStatus: CustomsDeclarationStatus) => {
    setActionLoading(`decl_${id}_${toStatus}`);
    try {
      const updated = await apiService.transitionCustomsDeclarationStatus(id, toStatus);
      setDeclarations(prev => prev.map(d => (d.id === id ? updated : d)));
    } catch (e: any) {
      setError(`状态转换失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleTransitionLc = useCallback(async (id: string, toStatus: LetterOfCreditStatus, discrepancies?: string) => {
    setActionLoading(`lc_${id}_${toStatus}`);
    try {
      const updated = await apiService.transitionLetterOfCreditStatus(id, toStatus, discrepancies);
      setLettersOfCredit(prev => prev.map(d => (d.id === id ? updated : d)));
      // F1：若该信用证时间轴已展开，流转后同步刷新节点
      if (lcTimelineId === id) {
        const data = await apiService.listLetterOfCreditEvents(id);
        setLcEvents(data.items);
      }
    } catch (e: any) {
      setError(`状态转换失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [lcTimelineId]);

  // G2：录入不符点（Presented → Discrepant，不符点内容必填并落 LcEvent 节点留痕）
  const handleRecordDiscrepancy = useCallback(async (id: string) => {
    const text = lcDiscrepancyText.trim();
    if (!text) {
      setError('请填写不符点内容');
      return;
    }
    setActionLoading(`lc_${id}_Discrepant`);
    try {
      const updated = await apiService.transitionLetterOfCreditStatus(id, 'Discrepant', text);
      setLettersOfCredit(prev => prev.map(d => (d.id === id ? updated : d)));
      if (lcTimelineId === id) {
        const data = await apiService.listLetterOfCreditEvents(id);
        setLcEvents(data.items);
      }
      setLcDiscrepancyId(null);
      setLcDiscrepancyText('');
    } catch (e: any) {
      setError(`录入不符点失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [lcDiscrepancyText, lcTimelineId]);

  // G4：一键生成退税草稿（后端从报关单自动核算，L10 同一入口；生成后跳到出口退税页签查看草稿）
  const handleGenerateTaxRefund = useCallback(async (declarationId: string) => {
    setActionLoading(`decl_${declarationId}_taxrefund`);
    try {
      await apiService.createTaxRefundFromDeclaration(declarationId);
      setActiveTab('taxRefunds');
    } catch (e: any) {
      setError(`生成退税草稿失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  // F1：展开/收起信用证节点时间轴（首次展开时拉取 LcEvent）
  const handleToggleLcTimeline = useCallback(async (id: string) => {
    if (lcTimelineId === id) {
      setLcTimelineId(null);
      setLcEvents([]);
      return;
    }
    setLcTimelineId(id);
    setLcEventsLoading(true);
    try {
      const data = await apiService.listLetterOfCreditEvents(id);
      setLcEvents(data.items);
    } catch (e: any) {
      setError(`加载节点时间轴失败：${e?.message || e}`);
    } finally {
      setLcEventsLoading(false);
    }
  }, [lcTimelineId]);

  // C6：展开/收起退税申报单进项专票勾稽（首次展开时按 taxRefundId 拉取专票）
  const handleToggleTrVat = useCallback(async (id: string) => {
    if (trVatId === id) {
      setTrVatId(null);
      setTrVatInvoices([]);
      return;
    }
    setTrVatId(id);
    setTrVatLoading(true);
    try {
      const data = await vatInvoiceService.listVatInvoices(undefined, { taxRefundId: id });
      setTrVatInvoices(data.items);
    } catch (e: any) {
      setError(`加载进项专票勾稽失败：${e?.message || e}`);
    } finally {
      setTrVatLoading(false);
    }
  }, [trVatId]);

  const handleTransitionTaxRefund = useCallback(async (id: string, toStatus: TaxRefundStatus) => {
    setActionLoading(`tr_${id}_${toStatus}`);
    try {
      const updated = await apiService.transitionTaxRefundStatus(id, toStatus);
      setTaxRefunds(prev => prev.map(d => (d.id === id ? updated : d)));
    } catch (e: any) {
      setError(`状态转换失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleReviewTaxRefund = useCallback(async (id: string, decision: 'Approved' | 'Rejected') => {
    // G3：审核人由后端取真实登录人（认证身份），前端不再传 reviewedBy
    setActionLoading(`tr_review_${id}_${decision}`);
    try {
      const updated = await apiService.reviewTaxRefund(id, { decision });
      setTaxRefunds(prev => prev.map(d => (d.id === id ? updated : d)));
    } catch (e: any) {
      setError(`审核失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  // R5：删除前 BdsDialog 确认（替代直发请求；参照 DocumentCenter 删除确认模式）
  const [deleteTarget, setDeleteTarget] = useState<{ tab: TabId; id: string; label: string } | null>(null);

  const handleDelete = useCallback(async (tab: TabId, id: string) => {
    setDeleteTarget(null);
    setActionLoading(`del_${id}`);
    try {
      if (tab === 'declarations') {
        await apiService.deleteCustomsDeclaration(id);
        setDeclarations(prev => prev.filter(d => d.id !== id));
        setDeclTotal(prev => Math.max(0, prev - 1));
      } else if (tab === 'hsCodes') {
        await apiService.deleteHsCode(id);
        setHsCodes(prev => prev.map(h => (h.id === id ? { ...h, isActive: false } : h)));
      } else if (tab === 'lettersOfCredit') {
        await apiService.deleteLetterOfCredit(id);
        setLettersOfCredit(prev => prev.filter(d => d.id !== id));
        setLcTotal(prev => Math.max(0, prev - 1));
      } else if (tab === 'taxRefunds') {
        await apiService.deleteTaxRefund(id);
        setTaxRefunds(prev => prev.filter(d => d.id !== id));
        setTrTotal(prev => Math.max(0, prev - 1));
      }
    } catch (e: any) {
      setError(`删除失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  // R3：加载更多（当前 tab 已加载数 < 服务端 total 时显示，offset 追加）
  const renderLoadMore = (loadedCount: number, total: number, load: (offset: number) => Promise<void>) => {
    if (loadedCount <= 0 || loadedCount >= total) return null;
    return (
      <div className="flex justify-center pt-2">
        <button onClick={() => void load(loadedCount)} disabled={loadingMore} className="bds-btn bds-btn-secondary">
          {loadingMore && <Loader2 size={14} className="animate-spin" />}
          加载更多（已显示 {loadedCount} / 共 {total} 条）
        </button>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader
        title="外贸与报关"
        subtitle="Foreign Trade & Customs"
        contextLabel="Customs Desk"
        isDarkMode={isDarkMode}
        actions={
          TOOL_TAB_IDS.has(activeTab) || !canWriteCustoms ? undefined : (
            <button
              onClick={() => { setEditingHsCode(null); setShowForm(true); }}
              className="bds-btn bds-btn-primary"
            >
              <Plus size={14} strokeWidth={1.75} /><span>新增</span>
            </button>
          )
        }
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* Tab 导航（BDS Tabs 下划线式） */}
          <div className="bds-tabs mb-4">
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setActiveTab(t.id); setSearchQuery(''); setDebouncedSearch(''); setStatusFilter(''); }} className={`bds-tab flex items-center gap-1.5 ${activeTab === t.id ? 'active' : ''}`}>
                {t.icon}<span>{t.label}</span>
                {t.count != null && t.count > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'var(--recessed-bg)', color: 'var(--text-tertiary)' }}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* R678：跨模块导航 relation 筛选提示条（✕ 清除回全量；仅 relation 维度落得动的 tab 显示） */}
          {!TOOL_TAB_IDS.has(activeTab) && navRelationFilter && NAV_FILTER_TAB_LABEL[activeTab] && (
            <div className="mb-3">
              <NavRelationFilterChip
                filter={navRelationFilter}
                label={NAV_FILTER_TAB_LABEL[activeTab]!}
                onClear={() => setNavRelationFilter(null)}
              />
            </div>
          )}

          {/* 工具栏（制单工具 tab 为本地面板，无列表工具栏） */}
          {!TOOL_TAB_IDS.has(activeTab) && (
          <div className="flex items-center bds-filterbar mb-4 flex-wrap">
            <div className="relative flex-1 min-w-50 max-w-80">
              <Search size={14} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索编号 / 名称 / 客户..."
                className="bds-input sm pl-9"
                onKeyDown={(e) => { if (e.key === 'Enter') applySearchNow(); }}
              />
            </div>
            {activeTab !== 'hsCodes' && (
              <CustomSelect
                className="w-[140px]"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v)}
                options={[
                  { value: '', label: '全部状态' },
                  ...(activeTab === 'declarations' ? DECLARATION_STATUSES.map(s => ({ value: s.id, label: s.label })) : []),
                  ...(activeTab === 'lettersOfCredit' ? LC_STATUSES.map(s => ({ value: s.id, label: s.label })) : []),
                  ...(activeTab === 'taxRefunds' ? TAX_REFUND_STATUSES.map(s => ({ value: s.id, label: s.label })) : []),
                ]}
              />
            )}
            <button
              onClick={() => { if (activeTab === 'declarations') fetchDeclarations(); if (activeTab === 'hsCodes') fetchHsCodes(); if (activeTab === 'lettersOfCredit') fetchLettersOfCredit(); if (activeTab === 'taxRefunds') fetchTaxRefunds(); }}
              className="bds-btn bds-btn-secondary"
            >
              <RefreshCw size={14} strokeWidth={1.75} />刷新
            </button>
          </div>
          )}

          {error && (
            <div className="bds-alert danger mb-3">
              <AlertCircle size={16} strokeWidth={1.75} />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto p-0.5" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
            </div>
          ) : (
            <>
              {/* ════════ 报关单 Tab ════════ */}
              {activeTab === 'declarations' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {declarations.length === 0 ? (
                    <div className="bds-empty">
                      <div className="glyph"><FileCheck size={24} strokeWidth={1.25} /></div>
                      <div className="title">暂无报关单数据</div>
                    </div>
                  ) : (
                    declarations.map(decl => {
                      const si = declStatusInfo(decl.status);
                      const isExpanded = expandedId === decl.id;
                      return (
                        <div key={decl.id} className="bds-card" style={{ padding: 0 }}>
                          <div
                            className="flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                            onClick={() => setExpandedId(isExpanded ? null : decl.id)}
                          >
                            {isExpanded ? <ChevronDown size={14} strokeWidth={1.75} style={{ color: 'var(--text-quaternary)' }} /> : <ChevronRight size={14} strokeWidth={1.75} style={{ color: 'var(--text-quaternary)' }} />}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-light truncate bds-mono">{decl.declarationNumber}</span>
                                <span className={`bds-badge sm ${SEMANTIC_BADGE_VARIANT[si.semantic]}`}>{si.label}</span>
                                <span className={`bds-badge sm ${CUSTOMS_TYPES.find(t => t.id === decl.type)?.id === 'Export' ? 'info' : 'warning'}`}>
                                  {CUSTOMS_TYPES.find(t => t.id === decl.type)?.label || decl.type}
                                </span>
                              </div>
                              <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                                {decl.consignee || '—'} → {decl.destinationCountry || '—'} · {decl.totalPackages ?? '—'} 件 · {formatNum(decl.grossWeight, 3)} kg
                                {decl._count?.lines ? ` · ${decl._count.lines} 行` : ''}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-light bds-tnum">{decl.currency || ''} {formatNum(decl.totalValue)}</div>
                              <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>{formatDate(decl.declarationDate)}</div>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="px-4 pb-3" style={{ borderTop: 'var(--border-subtle)' }}>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 text-xs">
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>贸易条款</span>{decl.tradeTerms || '—'}</div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>申报口岸</span>{decl.declarationPort || '—'}</div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>报关行</span>{decl.agent || '—'}</div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>报关员</span>{decl.declarant || '—'}</div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>原产国</span>{decl.originCountry || '—'}</div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>目的国</span>{decl.destinationCountry || '—'}</div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>毛重</span>{formatNum(decl.grossWeight, 3)} kg</div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>净重</span>{formatNum(decl.netWeight, 3)} kg</div>
                              </div>
                              {decl.lines && decl.lines.length > 0 && (
                                <div className="mt-3">
                                  <div className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>明细行</div>
                                  <div className="space-y-1">
                                    {decl.lines.map(line => (
                                      <div key={line.id} className="flex items-center gap-2 px-2 py-1 rounded-inset text-xs bds-inset">
                                        <span style={{ color: 'var(--text-quaternary)' }}>#{line.lineNumber}</span>
                                        <span className="flex-1 truncate">{line.productName}</span>
                                        {line.hsCode && <span className="bds-badge sm neutral bds-mono">{line.hsCode}</span>}
                                        <span className="bds-tnum">{formatNum(line.quantity)} {line.unit}</span>
                                        {line.totalAmount && <span className="bds-tnum" style={{ color: 'var(--text-tertiary)' }}>{line.currency || ''} {formatNum(line.totalAmount)}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* 状态转换按钮（R6：写操作 customs:write 门禁，无权限整组隐藏） */}
                              {canWriteCustoms && (
                              <div className="flex items-center gap-2 mt-3 flex-wrap">
                                {decl.status === 'Draft' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Submitted')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">提交申报</button>
                                )}
                                {decl.status === 'Submitted' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Declared')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">确认报关</button>
                                )}
                                {decl.status === 'Declared' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Inspecting')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">查验中</button>
                                )}
                                {decl.status === 'Inspecting' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Released')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">放行</button>
                                )}
                                {/* G2：标记异常（Submitted/Declared/Inspecting → Exception） */}
                                {(decl.status === 'Submitted' || decl.status === 'Declared' || decl.status === 'Inspecting') && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Exception')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">标记异常</button>
                                )}
                                {(decl.status === 'Draft' || decl.status === 'Submitted' || decl.status === 'Exception') && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Cancelled')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">取消</button>
                                )}
                                {/* G4：一键生成退税草稿（后端自动核算；同报关单已生成则后端幂等拦截） */}
                                {decl.status !== 'Cancelled' && (
                                  <button onClick={() => handleGenerateTaxRefund(decl.id)} disabled={!!actionLoading} className="bds-btn bds-btn-secondary" title="按报关单明细行 HS 退税率自动核算生成退税申报草稿">
                                    <Receipt size={14} strokeWidth={1.75} />一键生成退税草稿
                                  </button>
                                )}
                                {(decl.status === 'Draft' || decl.status === 'Cancelled') && (
                                  <button onClick={() => setDeleteTarget({ tab: 'declarations', id: decl.id, label: decl.declarationNumber })} disabled={!!actionLoading} className="bds-btn bds-btn-danger">
                                    <Trash2 size={14} strokeWidth={1.75} />删除
                                  </button>
                                )}
                              </div>
                              )}
                              {/* 跨模块关联视图（EntityLink 图谱）— 清关出运/关联订单/报关客户/退税 */}
                              {decl.relationId && (
                                <RelatedWorkspacesSection
                                  sourceType="relation"
                                  relationId={decl.relationId}
                                  relationRole="customer"
                                  onNavigate={onNavigate}
                                  isDarkMode={isDarkMode}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  {renderLoadMore(declarations.length, declTotal, fetchDeclarations)}
                </motion.div>
              )}

              {/* ════════ HS 编码库 Tab ════════ */}
              {activeTab === 'hsCodes' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {hsCodes.length === 0 ? (
                    <div className="bds-empty">
                      <div className="glyph"><BookOpen size={24} strokeWidth={1.25} /></div>
                      <div className="title">暂无 HS 编码数据</div>
                    </div>
                  ) : (
                    <div className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
                      <table className="bds-table">
                        <thead>
                          <tr>
                            <th>HS 编码</th>
                            <th>商品描述</th>
                            <th>类别</th>
                            <th className="num">退税率</th>
                            <th className="num">关税率</th>
                            <th className="num">增值税率</th>
                            <th style={{ textAlign: 'center' }}>状态</th>
                            <th className="num">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hsCodes.map(hc => (
                            <tr key={hc.id}>
                              <td className="bds-mono">{hc.code}</td>
                              <td className="max-w-50 truncate">{hc.description}</td>
                              <td>{HS_CATEGORIES.find(c => c.id === hc.category)?.label || hc.category}</td>
                              <td className="num bds-tnum">{hc.exportTaxRebateRate ? `${formatNum(hc.exportTaxRebateRate, 4)}%` : '—'}</td>
                              <td className="num bds-tnum">{hc.importTariffRate ? `${formatNum(hc.importTariffRate, 4)}%` : '—'}</td>
                              <td className="num bds-tnum">{hc.vatRate ? `${formatNum(hc.vatRate, 4)}%` : '—'}</td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={`bds-badge sm ${hc.isActive ? 'success' : 'neutral'}`}>
                                  {hc.isActive ? '启用' : '停用'}
                                </span>
                              </td>
                              <td className="num">
                                {/* R6：写操作 customs:write 门禁（编辑/停用均无权限不渲染） */}
                                {canWriteCustoms && (
                                <div className="flex items-center justify-end gap-1">
                                  {/* G5：HS 编码可编辑（退税率/描述等就地修改，无需停用重建） */}
                                  <button onClick={() => { setEditingHsCode(hc); setShowForm(true); }} disabled={!!actionLoading} className="bds-btn bds-btn-secondary bds-btn-icon" title="编辑">
                                    <Pencil size={14} strokeWidth={1.75} />
                                  </button>
                                  {hc.isActive && (
                                    <button onClick={() => setDeleteTarget({ tab: 'hsCodes', id: hc.id, label: hc.code })} disabled={!!actionLoading} className="bds-btn bds-btn-danger bds-btn-icon" title="停用">
                                      <Trash2 size={14} strokeWidth={1.75} />
                                    </button>
                                  )}
                                </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {renderLoadMore(hsCodes.length, hsTotal, fetchHsCodes)}
                </motion.div>
              )}

              {/* ════════ 信用证 Tab ════════ */}
              {activeTab === 'lettersOfCredit' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {lettersOfCredit.length === 0 ? (
                    <div className="bds-empty">
                      <div className="glyph"><CreditCard size={24} strokeWidth={1.25} /></div>
                      <div className="title">暂无信用证数据</div>
                    </div>
                  ) : (
                    lettersOfCredit.map(lc => {
                      const si = lcStatusInfo(lc.status);
                      return (
                        <div key={lc.id} className="bds-card" style={{ padding: 'var(--space-3)' }}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-light bds-mono">{lc.lcNumber}</span>
                                <span className={`bds-badge sm ${SEMANTIC_BADGE_VARIANT[si.semantic]}`}>{si.label}</span>
                                <span className="bds-badge sm neutral">
                                  {LC_TYPES.find(t => t.id === lc.type)?.label || lc.type}
                                </span>
                              </div>
                              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                {lc.applicant || '—'} → {lc.beneficiary || '—'}
                                {lc.issueBank && ` · 开证行: ${lc.issueBank}`}
                              </div>
                              <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                                有效期: {formatDate(lc.expiryDate)}
                                {lc.shipmentDeadline && ` · 最迟装运: ${lc.shipmentDeadline}`}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-light bds-tnum">{lc.currency} {formatNum(lc.amount)}</div>
                              {lc.availableAmount && lc.availableAmount !== lc.amount && (
                                <div className="text-[10px] bds-tnum" style={{ color: 'var(--text-quaternary)' }}>可用: {formatNum(lc.availableAmount)}</div>
                              )}
                            </div>
                          </div>
                          {lc.discrepancies && (
                            <div className="bds-alert warning mt-2">
                              不符点: {lc.discrepancies}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {/* R6：写操作 customs:write 门禁（流转/不符点/删除无权限不渲染；节点时间轴为只读保留） */}
                            {canWriteCustoms && lc.status === 'Issued' && <button onClick={() => handleTransitionLc(lc.id, 'Presented')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">交单</button>}
                            {canWriteCustoms && lc.status === 'Presented' && <button onClick={() => handleTransitionLc(lc.id, 'Accepted')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">承兑</button>}
                            {canWriteCustoms && lc.status === 'Accepted' && <button onClick={() => handleTransitionLc(lc.id, 'Settled')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">结算</button>}
                            {/* G2：录入不符点（Presented → Discrepant，展开内联输入） */}
                            {canWriteCustoms && lc.status === 'Presented' && (
                              <button
                                onClick={() => { setLcDiscrepancyId(lcDiscrepancyId === lc.id ? null : lc.id); setLcDiscrepancyText(lc.discrepancies ?? ''); }}
                                disabled={!!actionLoading}
                                className="bds-btn bds-btn-secondary"
                              >
                                录入不符点
                              </button>
                            )}
                            {canWriteCustoms && (lc.status === 'Issued' || lc.status === 'Presented' || lc.status === 'Accepted') && <button onClick={() => handleTransitionLc(lc.id, 'Cancelled')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">取消</button>}
                            <button onClick={() => handleToggleLcTimeline(lc.id)} className="bds-btn bds-btn-secondary">
                              <History size={14} strokeWidth={1.75} />{lcTimelineId === lc.id ? '收起时间轴' : '节点时间轴'}
                            </button>
                            {canWriteCustoms && (lc.status === 'Issued' || lc.status === 'Cancelled') && <button onClick={() => setDeleteTarget({ tab: 'lettersOfCredit', id: lc.id, label: lc.lcNumber })} disabled={!!actionLoading} className="bds-btn bds-btn-danger"><Trash2 size={14} strokeWidth={1.75} />删除</button>}
                          </div>
                          {/* G2：不符点内联录入（确认后流转 Discrepant 并落节点留痕） */}
                          {canWriteCustoms && lcDiscrepancyId === lc.id && (
                            <div className="flex items-center gap-2 mt-2">
                              <input
                                className="bds-input sm flex-1"
                                value={lcDiscrepancyText}
                                onChange={e => setLcDiscrepancyText(e.target.value)}
                                placeholder="不符点内容（如：单证不一致、迟装运、金额超证）"
                                onKeyDown={e => { if (e.key === 'Enter') handleRecordDiscrepancy(lc.id); }}
                              />
                              <button onClick={() => handleRecordDiscrepancy(lc.id)} disabled={!!actionLoading} className="bds-btn bds-btn-primary">确认</button>
                              <button onClick={() => { setLcDiscrepancyId(null); setLcDiscrepancyText(''); }} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">取消</button>
                            </div>
                          )}
                          {/* F1：节点时间轴（LcEvent 开证→交单→承兑/不符点→结清/过期/作废） */}
                          {lcTimelineId === lc.id && (
                            <div className="mt-3 pt-3" style={{ borderTop: 'var(--border-subtle)' }}>
                              {lcEventsLoading ? (
                                <div className="flex items-center gap-2 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                  <Loader2 size={14} className="animate-spin" />加载节点时间轴…
                                </div>
                              ) : lcEvents.length === 0 ? (
                                <div className="py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>暂无节点记录</div>
                              ) : (
                                <div className="space-y-0">
                                  {lcEvents.map((ev, idx) => {
                                    const evStatus = lcStatusInfo(ev.toNode);
                                    const isLast = idx === lcEvents.length - 1;
                                    return (
                                      <div key={ev.id} className="flex gap-2.5">
                                        <div className="flex flex-col items-center shrink-0 w-3 pt-1">
                                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SEMANTIC_TEXT_COLOR[evStatus.semantic] }} />
                                          {!isLast && <span className="flex-1 w-px" style={{ background: 'var(--border-c-strong)' }} />}
                                        </div>
                                        <div className={`flex-1 min-w-0 ${isLast ? 'pb-1' : 'pb-3'}`}>
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs font-light" style={{ color: SEMANTIC_TEXT_COLOR[evStatus.semantic] }}>{evStatus.label}</span>
                                            <span className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>{formatDate(ev.eventDate)}</span>
                                            {ev.actorId && <span className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>操作人: {ev.actorId}</span>}
                                          </div>
                                          {ev.note && (
                                            <div className="mt-1 px-2 py-1 rounded-inset text-[11px] bds-inset" style={{ color: 'var(--text-tertiary)' }}>{ev.note}</div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {/* 跨模块关联视图（EntityLink 图谱）— 开证客户/关联订单（展开时才加载，对齐报关卡门控模式） */}
                              <div className="mt-3">
                                {lc.relationId && (
                                <RelatedWorkspacesSection
                                  sourceType="relation"
                                  relationId={lc.relationId}
                                  relationRole="customer"
                                  onNavigate={onNavigate}
                                  isDarkMode={isDarkMode}
                                />
                              )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  {renderLoadMore(lettersOfCredit.length, lcTotal, fetchLettersOfCredit)}
                </motion.div>
              )}

              {/* ════════ 出口退税 Tab ════════ */}
              {activeTab === 'taxRefunds' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {taxRefunds.length === 0 ? (
                    <div className="bds-empty">
                      <div className="glyph"><Receipt size={24} strokeWidth={1.25} /></div>
                      <div className="title">暂无退税数据</div>
                    </div>
                  ) : (
                    taxRefunds.map(tr => {
                      const si = taxRefundStatusInfo(tr.status);
                      // C6 勾稽：仅统计有效（已申报退税）专票税额；红冲/作废票不参与勾稽
                      const declaredVat = trVatId === tr.id ? trVatInvoices.filter(v => v.status === 'Declared') : [];
                      const declaredVatTaxTotal = declaredVat.reduce((acc, v) => acc + Number(v.taxAmount || 0), 0);
                      const refundableVat = tr.refundableVat != null ? Number(tr.refundableVat) : null;
                      const vatReconciled = refundableVat != null && Math.abs(declaredVatTaxTotal - refundableVat) <= 0.01;
                      return (
                        <div key={tr.id} className="bds-card" style={{ padding: 'var(--space-3)' }}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-light bds-mono">{tr.refundNumber}</span>
                                <span className={`bds-badge sm ${SEMANTIC_BADGE_VARIANT[si.semantic]}`}>{si.label}</span>
                              </div>
                              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                出口日期: {formatDate(tr.exportDate)}
                                {tr.declarationDate && ` · 申报: ${tr.declarationDate}`}
                                {tr.refundDate && ` · 到账: ${tr.refundDate}`}
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>FOB 金额</span><span className="bds-tnum">{tr.exportAmountFobCurrency || ''} {formatNum(tr.exportAmountFob)}</span></div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>折人民币</span><span className="bds-tnum">CNY {formatNum(tr.exportAmountCny)}</span></div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>退税率</span><span className="bds-tnum">{tr.refundableRate ? `${formatNum(tr.refundableRate, 4)}%` : '—'}</span></div>
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>退税额</span><span className="font-light bds-tnum" style={{ color: 'var(--success-text)' }}>CNY {formatNum(tr.refundAmount)}</span></div>
                              </div>
                              {tr.reviewNotes && (
                                <div className={`bds-alert ${SEMANTIC_BADGE_VARIANT[si.semantic] === 'neutral' ? 'info' : SEMANTIC_BADGE_VARIANT[si.semantic]} mt-2`}>
                                  审核: {tr.reviewedBy} · {tr.reviewNotes}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {/* R6：写操作 customs:write 门禁（流转/审核/删除无权限不渲染；专票勾稽为只读保留） */}
                            {canWriteCustoms && tr.status === 'Draft' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Submitted')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">提交申报</button>}
                            {canWriteCustoms && tr.status === 'Submitted' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Reviewing')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">送审</button>}
                            {canWriteCustoms && tr.status === 'Reviewing' && (
                              <>
                                <button onClick={() => handleReviewTaxRefund(tr.id, 'Approved')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">批准</button>
                                <button onClick={() => handleReviewTaxRefund(tr.id, 'Rejected')} disabled={!!actionLoading} className="bds-btn bds-btn-danger">拒绝</button>
                              </>
                            )}
                            {canWriteCustoms && tr.status === 'Approved' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Refunded')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">确认到账</button>}
                            {canWriteCustoms && tr.status === 'Rejected' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Draft')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">退回草稿</button>}
                            {canWriteCustoms && (tr.status === 'Draft' || tr.status === 'Cancelled') && <button onClick={() => setDeleteTarget({ tab: 'taxRefunds', id: tr.id, label: tr.refundNumber })} disabled={!!actionLoading} className="bds-btn bds-btn-danger"><Trash2 size={14} strokeWidth={1.75} />删除</button>}
                            <button onClick={() => handleToggleTrVat(tr.id)} className="bds-btn bds-btn-secondary">
                              <Receipt size={14} strokeWidth={1.75} />{trVatId === tr.id ? '收起专票勾稽' : '专票勾稽'}
                            </button>
                          </div>
                          {/* C6：进项专票勾稽（退税申报单 ↔ VAT 专票，税额勾稽核对） */}
                          {trVatId === tr.id && (
                            <div className="mt-3 pt-3" style={{ borderTop: 'var(--border-subtle)' }}>
                              {trVatLoading ? (
                                <div className="flex items-center gap-2 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                  <Loader2 size={14} className="animate-spin" />加载进项专票…
                                </div>
                              ) : trVatInvoices.length === 0 ? (
                                <div className="py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                  暂无关联进项专票（在 财务 → 增值税 页签执行「申报退税」时关联本申报单）
                                </div>
                              ) : (
                                <>
                                  <div className="space-y-1">
                                    {trVatInvoices.map(v => (
                                      <div key={v.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-inset text-xs bds-inset">
                                        <div className="min-w-0 flex-1 truncate">
                                          <span className="bds-mono">{v.vatNumber}</span>
                                          <span className="ml-2" style={{ color: 'var(--text-tertiary)' }}>{v.sellerName}</span>
                                        </div>
                                        <span className={`bds-badge sm ${v.status === 'Declared' ? 'info' : v.status === 'RedFlushed' ? 'warning' : 'neutral'}`}>
                                          {VAT_INVOICE_STATUS_LABELS[v.status] || v.status}
                                        </span>
                                        <span className="shrink-0 bds-tnum">税额 CNY {formatNum(v.taxAmount)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  {/* 勾稽汇总：有效专票税额合计 vs 申报可退增值税 */}
                                  <div className={`bds-alert ${vatReconciled ? 'success' : 'warning'} mt-2`}>
                                    有效专票 {declaredVat.length} 张 · 税额合计 CNY {formatNum(declaredVatTaxTotal)}
                                    {refundableVat != null
                                      ? ` · 申报可退增值税 CNY ${formatNum(refundableVat)} · ${vatReconciled ? '勾稽一致' : `勾稽差异 CNY ${formatNum(declaredVatTaxTotal - refundableVat)}`}`
                                      : ' · 本申报单未填可退增值税额'}
                                  </div>
                                </>
                              )}
                              {/* 跨模块关联视图（EntityLink 图谱）— 关联报关单/订单/客户（展开时才加载，对齐报关卡门控模式） */}
                              <div className="mt-3">
                                {tr.relationId && (
                                <RelatedWorkspacesSection
                                  sourceType="relation"
                                  relationId={tr.relationId}
                                  relationRole="customer"
                                  onNavigate={onNavigate}
                                  isDarkMode={isDarkMode}
                                />
                              )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  {renderLoadMore(taxRefunds.length, trTotal, fetchTaxRefunds)}
                </motion.div>
              )}

              {/* ════════ 贸易单据 Tab（Wave A1：台账/版本/打包收口单据中心，此处仅入口卡） ════════ */}
              {activeTab === 'tradeDocuments' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="bds-card p-8 flex flex-col items-center text-center">
                    <FileText size={24} strokeWidth={1.25} style={{ color: 'var(--text-quaternary)' }} />
                    <div className="text-sm font-light mt-3">贸易单据台账已收口至「单据中心」</div>
                    <div className="text-xs mt-1.5 max-w-md" style={{ color: 'var(--text-tertiary)' }}>
                      登记/编辑/状态流转、版本留痕、单据预览打印、运单批量生成与订单打包，统一在单据中心完成。
                    </div>
                    {onOpenDocumentCenter && (
                      <button
                        onClick={onOpenDocumentCenter}
                        className="bds-btn bds-btn-primary mt-4"
                      >
                        前往单据中心
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </>
          )}

          {/* ════════ 出运制单 / 单据模板 Tab（阶段 IA-2 自业务工具收编，独立 loading 分支外） ════════ */}
          {activeTab === 'docGenerator' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <ShipmentDocumentGenerator isDarkMode={isDarkMode} />
            </motion.div>
          )}
          {activeTab === 'docTemplates' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <DocumentTemplateManager isDarkMode={isDarkMode} />
            </motion.div>
          )}
        </div>
      </div>

      {/* 创建表单弹窗 */}
      {showForm && (
        <CreateFormModal
          activeTab={activeTab}
          isDarkMode={isDarkMode}
          editingHsCode={editingHsCode}
          onClose={() => { setShowForm(false); setFormError(null); setEditingHsCode(null); }}
          onSuccess={async () => {
            setShowForm(false);
            setFormError(null);
            setEditingHsCode(null);
            if (activeTab === 'declarations') fetchDeclarations();
            if (activeTab === 'hsCodes') fetchHsCodes();
            if (activeTab === 'lettersOfCredit') fetchLettersOfCredit();
            if (activeTab === 'taxRefunds') fetchTaxRefunds();
          }}
        />
      )}

      {/* R5：删除/停用确认（BdsDialog 声明式，替代直发请求；对齐 DocumentCenter 删除确认模式） */}
      {deleteTarget && (
        <BdsDialog
          title={deleteTarget.tab === 'hsCodes' ? '停用 HS 编码' : '删除确认'}
          danger
          confirmLabel={deleteTarget.tab === 'hsCodes' ? '停用' : '删除'}
          loading={actionLoading === `del_${deleteTarget.id}`}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete(deleteTarget.tab, deleteTarget.id)}
        >
          {deleteTarget.tab === 'hsCodes'
            ? `确认停用 HS 编码 ${deleteTarget.label}？（软停用，记录保留可恢复）`
            : `确认删除${deleteTarget.tab === 'declarations' ? '报关单' : deleteTarget.tab === 'lettersOfCredit' ? '信用证' : '退税申报单'} ${deleteTarget.label}？`}
        </BdsDialog>
      )}
    </div>
  );
};

// ==================== 创建表单弹窗 ====================

interface CreateFormModalProps {
  activeTab: TabId;
  isDarkMode: boolean;
  /** G5：HS 编码编辑模式（非空时弹窗预填并走 updateHsCode） */
  editingHsCode?: HsCode | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateFormModal: React.FC<CreateFormModalProps> = ({ activeTab, isDarkMode, editingHsCode, onClose, onSuccess }) => {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 报关单表单
  const [declForm, setDeclForm] = useState<CustomsDeclarationInput>({
    declarationNumber: '',
    type: 'Export',
    tradeTerms: 'FOB',
    currency: 'USD',
  });

  // G1：报关单明细行（品名/HS 编码/数量/单位/单价/金额，可加多行）
  const [declLines, setDeclLines] = useState<CustomsDeclarationLineInput[]>([]);
  const addDeclLine = () => setDeclLines(prev => [...prev, { productName: '', quantity: 0, unit: 'PCS' }]);
  const updateDeclLine = (idx: number, patch: Partial<CustomsDeclarationLineInput>) =>
    setDeclLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const removeDeclLine = (idx: number) => setDeclLines(prev => prev.filter((_, i) => i !== idx));

  // HS 编码表单
  const [hsForm, setHsForm] = useState<HsCodeInput>({
    code: '',
    description: '',
    category: 'Textile',
    isActive: true,
  });

  // G5：编辑模式预填（code 为自然键不可改，updateHsCode 白名单也不含 code）
  useEffect(() => {
    if (editingHsCode) {
      setHsForm({
        code: editingHsCode.code,
        description: editingHsCode.description,
        category: editingHsCode.category,
        exportTaxRebateRate: editingHsCode.exportTaxRebateRate != null ? Number(editingHsCode.exportTaxRebateRate) : undefined,
        importTariffRate: editingHsCode.importTariffRate != null ? Number(editingHsCode.importTariffRate) : undefined,
        vatRate: editingHsCode.vatRate != null ? Number(editingHsCode.vatRate) : undefined,
        unit: editingHsCode.unit ?? undefined,
        supervisionCondition: editingHsCode.supervisionCondition ?? undefined,
        inspectionQuarantine: editingHsCode.inspectionQuarantine ?? undefined,
        additionalDuty: editingHsCode.additionalDuty ?? undefined,
        notes: editingHsCode.notes ?? undefined,
        isActive: editingHsCode.isActive,
      });
    }
  }, [editingHsCode]);

  // 信用证表单
  const [lcForm, setLcForm] = useState<LetterOfCreditInput>({
    lcNumber: '',
    type: 'Irrevocable',
    amount: 0,
    currency: 'USD',
  });

  // 退税表单
  const [trForm, setTrForm] = useState<TaxRefundInput>({
    refundNumber: '',
    exportAmountFobCurrency: 'USD',
  });

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (activeTab === 'declarations') {
        if (!declForm.declarationNumber) throw new Error('请填写报关单号');
        // G1：明细行校验——只收完整行（品名+数量>0+单位），半填行给出明确提示
        const halfFilled = declLines.find(l => (l.productName.trim() || l.quantity > 0) && !(l.productName.trim() && l.quantity > 0 && l.unit.trim()));
        if (halfFilled) throw new Error('明细行需填完整：品名 / 数量(>0) / 单位');
        const lines = declLines.filter(l => l.productName.trim() && l.quantity > 0 && l.unit.trim());
        await apiService.createCustomsDeclaration({ ...declForm, lines: lines.length > 0 ? lines : undefined });
      } else if (activeTab === 'hsCodes') {
        if (!hsForm.code || !hsForm.description) throw new Error('请填写 HS 编码和描述');
        if (editingHsCode) {
          await apiService.updateHsCode(editingHsCode.id, hsForm);
        } else {
          await apiService.createHsCode(hsForm);
        }
      } else if (activeTab === 'lettersOfCredit') {
        if (!lcForm.lcNumber || !lcForm.amount) throw new Error('请填写信用证号和金额');
        await apiService.createLetterOfCredit(lcForm);
      } else if (activeTab === 'taxRefunds') {
        if (!trForm.refundNumber) throw new Error('请填写退税编号');
        await apiService.createTaxRefund(trForm);
      }
      onSuccess();
    } catch (e: any) {
      setError(String(e?.message || e || (editingHsCode ? '保存失败' : '创建失败')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bds-modal-mask" onClick={onClose}>
      <div className="bds-modal" style={{ width: '42rem', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="bds-text-sm" style={{ color: 'var(--text-primary)' }}>
            {activeTab === 'declarations' && '新增报关单'}
            {activeTab === 'hsCodes' && (editingHsCode ? '编辑 HS 编码' : '新增 HS 编码')}
            {activeTab === 'lettersOfCredit' && '新增信用证'}
            {activeTab === 'taxRefunds' && '新增出口退税'}
          </h2>
          <button onClick={onClose} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}><X size={16} strokeWidth={1.75} /></button>
        </div>

        {error && (
          <div className="bds-alert danger mb-3">
            <AlertCircle size={14} strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        {/* 报关单表单 */}
        {activeTab === 'declarations' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>报关单号 *</label><input className="bds-input sm" value={declForm.declarationNumber} onChange={e => setDeclForm({ ...declForm, declarationNumber: e.target.value })} placeholder="CD-20260807-001" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>报关类型 *</label><CustomSelect surface="form" size="compact" className="w-full" value={declForm.type} onChange={v => setDeclForm({ ...declForm, type: v as CustomsType })} options={CUSTOMS_TYPES.map(t => ({ value: t.id, label: t.label }))} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>申报日期</label><CapsuleDateInput value={declForm.declarationDate || ''} onChange={v => setDeclForm({ ...declForm, declarationDate: v })} isDarkMode={isDarkMode} className="bds-input sm" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>贸易条款</label><CustomSelect surface="form" size="compact" className="w-full" value={declForm.tradeTerms || ''} onChange={v => setDeclForm({ ...declForm, tradeTerms: v })} options={[{ value: '', label: '—' }, ...TRADE_TERMS.map(t => ({ value: t, label: t }))]} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>申报口岸</label><input className="bds-input sm" value={declForm.declarationPort || ''} onChange={e => setDeclForm({ ...declForm, declarationPort: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>报关行</label><input className="bds-input sm" value={declForm.agent || ''} onChange={e => setDeclForm({ ...declForm, agent: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>发货人</label><input className="bds-input sm" value={declForm.consignor || ''} onChange={e => setDeclForm({ ...declForm, consignor: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>收货人</label><input className="bds-input sm" value={declForm.consignee || ''} onChange={e => setDeclForm({ ...declForm, consignee: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>原产国</label><input className="bds-input sm" value={declForm.originCountry || ''} onChange={e => setDeclForm({ ...declForm, originCountry: e.target.value })} placeholder="China" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>目的国</label><input className="bds-input sm" value={declForm.destinationCountry || ''} onChange={e => setDeclForm({ ...declForm, destinationCountry: e.target.value })} placeholder="USA" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>总件数</label><input type="number" className="bds-input sm" value={declForm.totalPackages ?? ''} onChange={e => setDeclForm({ ...declForm, totalPackages: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>申报总额</label><input type="number" className="bds-input sm" value={declForm.totalValue ?? ''} onChange={e => setDeclForm({ ...declForm, totalValue: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>币种</label><input className="bds-input sm" value={declForm.currency || ''} onChange={e => setDeclForm({ ...declForm, currency: e.target.value })} placeholder="USD" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>毛重(kg)</label><input type="number" className="bds-input sm" value={declForm.grossWeight ?? ''} onChange={e => setDeclForm({ ...declForm, grossWeight: Number(e.target.value) || undefined })} /></div>
            <div className="col-span-2"><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>备注</label><textarea className="bds-input bds-textarea" rows={2} value={declForm.notes || ''} onChange={e => setDeclForm({ ...declForm, notes: e.target.value })} /></div>
            {/* G1：明细行录入区（品名/HS 编码/数量/单位/单价/金额，可加多行） */}
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>明细行</label>
                <button type="button" onClick={addDeclLine} className="bds-btn bds-btn-secondary">
                  <Plus size={14} strokeWidth={1.75} />添加明细行
                </button>
              </div>
              {declLines.length === 0 ? (
                <div className="text-xs py-1" style={{ color: 'var(--text-quaternary)' }}>暂无明细行（可不填，后续退税核算将回退按申报总额）</div>
              ) : (
                <div className="space-y-2">
                  {declLines.map((line, idx) => (
                    <div key={idx} className="px-2 py-2 rounded-inset bds-inset">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>#{idx + 1}</span>
                        <button type="button" onClick={() => removeDeclLine(idx)} className="bds-btn bds-btn-danger bds-btn-icon" title="删除行">
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                      <div className="grid grid-cols-6 gap-2">
                        <input className="bds-input sm col-span-2" placeholder="品名 *" value={line.productName} onChange={e => updateDeclLine(idx, { productName: e.target.value })} />
                        <input className="bds-input sm col-span-2 bds-mono" placeholder="HS 编码" value={line.hsCode || ''} onChange={e => updateDeclLine(idx, { hsCode: e.target.value })} />
                        <input type="number" className="bds-input sm col-span-1" placeholder="数量 *" value={line.quantity || ''} onChange={e => updateDeclLine(idx, { quantity: Number(e.target.value) || 0 })} />
                        <input className="bds-input sm col-span-1" placeholder="单位 *" value={line.unit} onChange={e => updateDeclLine(idx, { unit: e.target.value })} />
                        <input type="number" className="bds-input sm col-span-2" placeholder="单价" value={line.unitPrice ?? ''} onChange={e => updateDeclLine(idx, { unitPrice: e.target.value === '' ? undefined : Number(e.target.value) })} />
                        <input type="number" className="bds-input sm col-span-2" placeholder="金额" value={line.totalAmount ?? ''} onChange={e => updateDeclLine(idx, { totalAmount: e.target.value === '' ? undefined : Number(e.target.value) })} />
                        <input className="bds-input sm col-span-2" placeholder="币种" value={line.currency || declForm.currency || ''} onChange={e => updateDeclLine(idx, { currency: e.target.value })} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* HS 编码表单 */}
        {activeTab === 'hsCodes' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>HS 编码 *</label><input className="bds-input sm" value={hsForm.code} onChange={e => setHsForm({ ...hsForm, code: e.target.value })} placeholder="5208.52.00.00" disabled={!!editingHsCode} title={editingHsCode ? '编码为自然键不可修改' : undefined} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>类别 *</label><CustomSelect surface="form" size="compact" className="w-full" value={hsForm.category} onChange={v => setHsForm({ ...hsForm, category: v as HsCodeCategory })} options={HS_CATEGORIES.map(c => ({ value: c.id, label: c.label }))} /></div>
            <div className="col-span-2"><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>商品描述 *</label><input className="bds-input sm" value={hsForm.description} onChange={e => setHsForm({ ...hsForm, description: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>出口退税率(%)</label><input type="number" step="0.01" className="bds-input sm" value={hsForm.exportTaxRebateRate ?? ''} onChange={e => setHsForm({ ...hsForm, exportTaxRebateRate: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>进口关税率(%)</label><input type="number" step="0.01" className="bds-input sm" value={hsForm.importTariffRate ?? ''} onChange={e => setHsForm({ ...hsForm, importTariffRate: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>增值税率(%)</label><input type="number" step="0.01" className="bds-input sm" value={hsForm.vatRate ?? ''} onChange={e => setHsForm({ ...hsForm, vatRate: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>法定单位</label><input className="bds-input sm" value={hsForm.unit || ''} onChange={e => setHsForm({ ...hsForm, unit: e.target.value })} placeholder="KG / M / PCS" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>监管条件</label><input className="bds-input sm" value={hsForm.supervisionCondition || ''} onChange={e => setHsForm({ ...hsForm, supervisionCondition: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>检验检疫</label><input className="bds-input sm" value={hsForm.inspectionQuarantine || ''} onChange={e => setHsForm({ ...hsForm, inspectionQuarantine: e.target.value })} /></div>
            <div className="col-span-2"><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>备注</label><textarea className="bds-input bds-textarea" rows={2} value={hsForm.notes || ''} onChange={e => setHsForm({ ...hsForm, notes: e.target.value })} /></div>
          </div>
        )}

        {/* 信用证表单 */}
        {activeTab === 'lettersOfCredit' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>信用证号 *</label><input className="bds-input sm" value={lcForm.lcNumber} onChange={e => setLcForm({ ...lcForm, lcNumber: e.target.value })} placeholder="LC-20260807-001" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>类型 *</label><CustomSelect surface="form" size="compact" className="w-full" value={lcForm.type} onChange={v => setLcForm({ ...lcForm, type: v as LetterOfCreditType })} options={LC_TYPES.map(t => ({ value: t.id, label: t.label }))} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>金额 *</label><input type="number" className="bds-input sm" value={lcForm.amount || ''} onChange={e => setLcForm({ ...lcForm, amount: Number(e.target.value) || 0 })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>币种</label><input className="bds-input sm" value={lcForm.currency || ''} onChange={e => setLcForm({ ...lcForm, currency: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>开证日期</label><CapsuleDateInput value={lcForm.issueDate || ''} onChange={v => setLcForm({ ...lcForm, issueDate: v })} isDarkMode={isDarkMode} className="bds-input sm" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>有效期</label><CapsuleDateInput value={lcForm.expiryDate || ''} onChange={v => setLcForm({ ...lcForm, expiryDate: v })} isDarkMode={isDarkMode} className="bds-input sm" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>开证行</label><input className="bds-input sm" value={lcForm.issueBank || ''} onChange={e => setLcForm({ ...lcForm, issueBank: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>通知行</label><input className="bds-input sm" value={lcForm.advisingBank || ''} onChange={e => setLcForm({ ...lcForm, advisingBank: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>申请人(进口方)</label><input className="bds-input sm" value={lcForm.applicant || ''} onChange={e => setLcForm({ ...lcForm, applicant: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>受益人(出口方)</label><input className="bds-input sm" value={lcForm.beneficiary || ''} onChange={e => setLcForm({ ...lcForm, beneficiary: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>最迟装运期</label><CapsuleDateInput value={lcForm.shipmentDeadline || ''} onChange={v => setLcForm({ ...lcForm, shipmentDeadline: v })} isDarkMode={isDarkMode} className="bds-input sm" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>交单期限</label><CapsuleDateInput value={lcForm.presentationDeadline || ''} onChange={v => setLcForm({ ...lcForm, presentationDeadline: v })} isDarkMode={isDarkMode} className="bds-input sm" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>贸易条款</label><CustomSelect surface="form" size="compact" className="w-full" value={lcForm.tradeTerms || ''} onChange={v => setLcForm({ ...lcForm, tradeTerms: v })} options={[{ value: '', label: '—' }, ...TRADE_TERMS.map(t => ({ value: t, label: t }))]} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>装运港</label><input className="bds-input sm" value={lcForm.portOfLoading || ''} onChange={e => setLcForm({ ...lcForm, portOfLoading: e.target.value })} /></div>
            <div className="col-span-2"><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>特殊条款</label><textarea className="bds-input bds-textarea" rows={2} value={lcForm.specialConditions || ''} onChange={e => setLcForm({ ...lcForm, specialConditions: e.target.value })} /></div>
          </div>
        )}

        {/* 退税表单 */}
        {activeTab === 'taxRefunds' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>退税编号 *</label><input className="bds-input sm" value={trForm.refundNumber} onChange={e => setTrForm({ ...trForm, refundNumber: e.target.value })} placeholder="TR-20260807-001" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>出口日期</label><CapsuleDateInput value={trForm.exportDate || ''} onChange={v => setTrForm({ ...trForm, exportDate: v })} isDarkMode={isDarkMode} className="bds-input sm" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>FOB 金额</label><input type="number" className="bds-input sm" value={trForm.exportAmountFob ?? ''} onChange={e => setTrForm({ ...trForm, exportAmountFob: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>FOB 币种</label><input className="bds-input sm" value={trForm.exportAmountFobCurrency || ''} onChange={e => setTrForm({ ...trForm, exportAmountFobCurrency: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>折人民币</label><input type="number" className="bds-input sm" value={trForm.exportAmountCny ?? ''} onChange={e => setTrForm({ ...trForm, exportAmountCny: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>外汇汇率</label><input type="number" step="0.00000001" className="bds-input sm" value={trForm.fxRate ?? ''} onChange={e => setTrForm({ ...trForm, fxRate: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>退税率(%)</label><input type="number" step="0.01" className="bds-input sm" value={trForm.refundableRate ?? ''} onChange={e => setTrForm({ ...trForm, refundableRate: Number(e.target.value) || undefined })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>可退增值税</label><input type="number" className="bds-input sm" value={trForm.refundableVat ?? ''} onChange={e => setTrForm({ ...trForm, refundableVat: Number(e.target.value) || undefined })} /></div>
            <div className="col-span-2"><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>备注</label><textarea className="bds-input bds-textarea" rows={2} value={trForm.notes || ''} onChange={e => setTrForm({ ...trForm, notes: e.target.value })} /></div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-4 pt-4" style={{ borderTop: 'var(--border-subtle)' }}>
          <button onClick={onClose} className="bds-btn bds-btn-secondary">取消</button>
          <button onClick={handleSubmit} disabled={submitting} className="bds-btn bds-btn-primary">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {editingHsCode ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomsManager;
