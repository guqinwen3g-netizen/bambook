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

import React, { useState, useEffect, useCallback } from 'react';
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
  ChevronDown,
  ChevronRight,
  History,
  Layers,
  LayoutTemplate,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import ShipmentDocumentGenerator from './tools/ShipmentDocumentGenerator';
import DocumentTemplateManager from './tools/DocumentTemplateManager';
import {
  CustomsDeclaration,
  CustomsDeclarationInput,
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
import { PageHeader } from './ui/PageHeader';
import { StatusSemantic } from './rdlBusinessStatusTokens';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { RelatedEntitiesPanel } from './RelatedEntitiesPanel';

// ==================== 常量 ====================

type TabId = 'declarations' | 'hsCodes' | 'lettersOfCredit' | 'taxRefunds' | 'tradeDocuments' | 'docGenerator' | 'docTemplates';

/** A5d 报表下钻联动：允许外部（报表中心）按 id 指定落点 tab */
export type { TabId as CustomsTabId };

/** 阶段 IA-2：制单工具 tab（本地工具面板，不走列表数据拉取/搜索/状态筛选）；Wave A1：贸易单据台账收口单据中心，入口卡同例 */
const TOOL_TAB_IDS: ReadonlySet<TabId> = new Set(['tradeDocuments', 'docGenerator', 'docTemplates']);

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
}

// ==================== 组件 ====================

const CustomsManager: React.FC<CustomsManagerProps> = ({ isDarkMode, initialTab, onOpenDocumentCenter }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'declarations');
  // A5d：与 FinanceManager 同一口径 — initialTab 变更时响应式同步（下钻落点定位）
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
  const [declarations, setDeclarations] = useState<CustomsDeclaration[]>([]);
  const [hsCodes, setHsCodes] = useState<HsCode[]>([]);
  const [lettersOfCredit, setLettersOfCredit] = useState<LetterOfCredit[]>([]);
  const [taxRefunds, setTaxRefunds] = useState<TaxRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // F1：信用证节点时间轴
  const [lcTimelineId, setLcTimelineId] = useState<string | null>(null);
  const [lcEvents, setLcEvents] = useState<LcEvent[]>([]);
  const [lcEventsLoading, setLcEventsLoading] = useState(false);

  // C6：退税申报单进项专票勾稽（消费 GET /v1/finance/vat-invoices?taxRefundId=）
  const [trVatId, setTrVatId] = useState<string | null>(null);
  const [trVatInvoices, setTrVatInvoices] = useState<VatInvoice[]>([]);
  const [trVatLoading, setTrVatLoading] = useState(false);

  // 创建表单状态
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── 拉取数据 ──
  const fetchDeclarations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listCustomsDeclarations({
        search: searchQuery || undefined,
        status: statusFilter || undefined,
        limit: 200,
      });
      setDeclarations(result.items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  const fetchHsCodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listHsCodes({ search: searchQuery || undefined, limit: 200 });
      setHsCodes(result.items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const fetchLettersOfCredit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listLettersOfCredit({
        search: searchQuery || undefined,
        status: statusFilter || undefined,
        limit: 200,
      });
      setLettersOfCredit(result.items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  const fetchTaxRefunds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listTaxRefunds({
        search: searchQuery || undefined,
        status: statusFilter || undefined,
        limit: 200,
      });
      setTaxRefunds(result.items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    if (TOOL_TAB_IDS.has(activeTab)) { setLoading(false); return; }
    if (activeTab === 'declarations') fetchDeclarations();
    if (activeTab === 'hsCodes') fetchHsCodes();
    if (activeTab === 'lettersOfCredit') fetchLettersOfCredit();
    if (activeTab === 'taxRefunds') fetchTaxRefunds();
  }, [activeTab, fetchDeclarations, fetchHsCodes, fetchLettersOfCredit, fetchTaxRefunds]);

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
    { id: 'declarations', label: '报关单', icon: <FileCheck size={12} />, count: declarations.length },
    { id: 'hsCodes', label: 'HS 编码库', icon: <BookOpen size={12} />, count: hsCodes.length },
    { id: 'lettersOfCredit', label: '信用证', icon: <CreditCard size={12} />, count: lettersOfCredit.length },
    { id: 'taxRefunds', label: '出口退税', icon: <Receipt size={12} />, count: taxRefunds.length },
    { id: 'tradeDocuments', label: '贸易单据', icon: <FileText size={12} /> },
    { id: 'docGenerator', label: '出运制单', icon: <Layers size={12} /> },
    { id: 'docTemplates', label: '单据模板', icon: <LayoutTemplate size={12} /> },
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

  const handleTransitionLc = useCallback(async (id: string, toStatus: LetterOfCreditStatus) => {
    setActionLoading(`lc_${id}_${toStatus}`);
    try {
      const updated = await apiService.transitionLetterOfCreditStatus(id, toStatus);
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
    const reviewedBy = '当前用户';
    setActionLoading(`tr_review_${id}_${decision}`);
    try {
      const updated = await apiService.reviewTaxRefund(id, { reviewedBy, decision });
      setTaxRefunds(prev => prev.map(d => (d.id === id ? updated : d)));
    } catch (e: any) {
      setError(`审核失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleDelete = useCallback(async (tab: TabId, id: string) => {
    setActionLoading(`del_${id}`);
    try {
      if (tab === 'declarations') {
        await apiService.deleteCustomsDeclaration(id);
        setDeclarations(prev => prev.filter(d => d.id !== id));
      } else if (tab === 'hsCodes') {
        await apiService.deleteHsCode(id);
        setHsCodes(prev => prev.map(h => (h.id === id ? { ...h, isActive: false } : h)));
      } else if (tab === 'lettersOfCredit') {
        await apiService.deleteLetterOfCredit(id);
        setLettersOfCredit(prev => prev.filter(d => d.id !== id));
      } else if (tab === 'taxRefunds') {
        await apiService.deleteTaxRefund(id);
        setTaxRefunds(prev => prev.filter(d => d.id !== id));
      }
    } catch (e: any) {
      setError(`删除失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader
        title="外贸与报关"
        subtitle="Foreign Trade & Customs"
        contextLabel="Customs Desk"
        isDarkMode={isDarkMode}
        actions={
          TOOL_TAB_IDS.has(activeTab) ? undefined : (
            <button
              onClick={() => setShowForm(true)}
              className="bds-btn bds-btn-primary"
            >
              <Plus size={14} /><span>新增</span>
            </button>
          )
        }
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <ScrollEdgeFades scrollRef={{ current: null }} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* Tab 导航（BDS Tabs 下划线式） */}
          <div className="bds-tabs mb-4">
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setActiveTab(t.id); setSearchQuery(''); setStatusFilter(''); }} className={`bds-tab flex items-center gap-1.5 ${activeTab === t.id ? 'active' : ''}`}>
                {t.icon}<span>{t.label}</span>
                {t.count != null && t.count > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'var(--bg-sunken)', color: 'var(--text-tertiary)' }}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* 工具栏（制单工具 tab 为本地面板，无列表工具栏） */}
          {!TOOL_TAB_IDS.has(activeTab) && (
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索编号 / 名称 / 客户..."
                className="bds-input sm pl-9"
                onKeyDown={(e) => { if (e.key === 'Enter') { if (activeTab === 'declarations') fetchDeclarations(); if (activeTab === 'hsCodes') fetchHsCodes(); if (activeTab === 'lettersOfCredit') fetchLettersOfCredit(); if (activeTab === 'taxRefunds') fetchTaxRefunds(); } }}
              />
            </div>
            {activeTab !== 'hsCodes' && (
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bds-select" style={{ maxWidth: 140, height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}>
                <option value="">全部状态</option>
                {activeTab === 'declarations' && DECLARATION_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                {activeTab === 'lettersOfCredit' && LC_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                {activeTab === 'taxRefunds' && TAX_REFUND_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            )}
            <button
              onClick={() => { if (activeTab === 'declarations') fetchDeclarations(); if (activeTab === 'hsCodes') fetchHsCodes(); if (activeTab === 'lettersOfCredit') fetchLettersOfCredit(); if (activeTab === 'taxRefunds') fetchTaxRefunds(); }}
              className="bds-btn bds-btn-secondary"
            >
              <RefreshCw size={12} />刷新
            </button>
          </div>
          )}

          {error && (
            <div className="bds-alert danger mb-3">
              <AlertCircle size={16} />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto p-0.5" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
                <X size={14} />
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
                      <div className="glyph"><FileCheck size={24} /></div>
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
                            {isExpanded ? <ChevronDown size={14} style={{ color: 'var(--text-quaternary)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-quaternary)' }} />}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate bds-mono">{decl.declarationNumber}</span>
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
                              <div className="text-sm font-medium bds-tnum">{decl.currency || ''} {formatNum(decl.totalValue)}</div>
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
                                      <div key={line.id} className="flex items-center gap-2 px-2 py-1 rounded-inset text-xs" style={{ background: 'var(--bg-panel)' }}>
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
                              {/* 状态转换按钮 */}
                              <div className="flex items-center gap-2 mt-3 flex-wrap">
                                {decl.status === 'Draft' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Submitted')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">提交申报</button>
                                )}
                                {decl.status === 'Submitted' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Declared')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">确认报关</button>
                                )}
                                {decl.status === 'Declared' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Inspecting')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">查验中</button>
                                )}
                                {decl.status === 'Inspecting' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Released')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">放行</button>
                                )}
                                {(decl.status === 'Draft' || decl.status === 'Submitted' || decl.status === 'Exception') && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Cancelled')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">取消</button>
                                )}
                                {(decl.status === 'Draft' || decl.status === 'Cancelled') && (
                                  <button onClick={() => handleDelete('declarations', decl.id)} disabled={!!actionLoading} className="bds-btn bds-btn-danger">
                                    <Trash2 size={11} />删除
                                  </button>
                                )}
                              </div>
                              {/* 跨模块关联视图（EntityLink 图谱）— 清关出运/关联订单/报关客户/退税 */}
                              <RelatedEntitiesPanel
                                type="customsDeclaration"
                                id={decl.id}
                                isDarkMode={isDarkMode}
                                title="报关关联视图"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </motion.div>
              )}

              {/* ════════ HS 编码库 Tab ════════ */}
              {activeTab === 'hsCodes' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {hsCodes.length === 0 ? (
                    <div className="bds-empty">
                      <div className="glyph"><BookOpen size={24} /></div>
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
                              <td className="max-w-[200px] truncate">{hc.description}</td>
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
                                {hc.isActive && (
                                  <button onClick={() => handleDelete('hsCodes', hc.id)} disabled={!!actionLoading} className="bds-btn bds-btn-danger bds-btn-icon" title="停用">
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ════════ 信用证 Tab ════════ */}
              {activeTab === 'lettersOfCredit' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {lettersOfCredit.length === 0 ? (
                    <div className="bds-empty">
                      <div className="glyph"><CreditCard size={24} /></div>
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
                                <span className="text-sm font-medium bds-mono">{lc.lcNumber}</span>
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
                              <div className="text-sm font-medium bds-tnum">{lc.currency} {formatNum(lc.amount)}</div>
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
                            {lc.status === 'Issued' && <button onClick={() => handleTransitionLc(lc.id, 'Presented')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">交单</button>}
                            {lc.status === 'Presented' && <button onClick={() => handleTransitionLc(lc.id, 'Accepted')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">承兑</button>}
                            {lc.status === 'Accepted' && <button onClick={() => handleTransitionLc(lc.id, 'Settled')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">结算</button>}
                            {(lc.status === 'Issued' || lc.status === 'Presented' || lc.status === 'Accepted') && <button onClick={() => handleTransitionLc(lc.id, 'Cancelled')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">取消</button>}
                            <button onClick={() => handleToggleLcTimeline(lc.id)} className="bds-btn bds-btn-secondary">
                              <History size={11} />{lcTimelineId === lc.id ? '收起时间轴' : '节点时间轴'}
                            </button>
                            {(lc.status === 'Issued' || lc.status === 'Cancelled') && <button onClick={() => handleDelete('lettersOfCredit', lc.id)} disabled={!!actionLoading} className="bds-btn bds-btn-danger"><Trash2 size={11} />删除</button>}
                          </div>
                          {/* F1：节点时间轴（LcEvent 开证→交单→承兑/不符点→结清/过期/作废） */}
                          {lcTimelineId === lc.id && (
                            <div className="mt-3 pt-3" style={{ borderTop: 'var(--border-subtle)' }}>
                              {lcEventsLoading ? (
                                <div className="flex items-center gap-2 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                  <Loader2 size={12} className="animate-spin" />加载节点时间轴…
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
                                            <span className="text-xs font-medium" style={{ color: SEMANTIC_TEXT_COLOR[evStatus.semantic] }}>{evStatus.label}</span>
                                            <span className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>{formatDate(ev.eventDate)}</span>
                                            {ev.actorId && <span className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>操作人: {ev.actorId}</span>}
                                          </div>
                                          {ev.note && (
                                            <div className="mt-1 px-2 py-1 rounded-inset text-[11px]" style={{ background: 'var(--bg-panel)', color: 'var(--text-tertiary)' }}>{ev.note}</div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {/* 跨模块关联视图（EntityLink 图谱）— 开证客户/关联订单（展开时才加载，对齐报关卡门控模式） */}
                              <div className="mt-3">
                                <RelatedEntitiesPanel
                                  type="letterOfCredit"
                                  id={lc.id}
                                  isDarkMode={isDarkMode}
                                  title="信用证关联视图"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </motion.div>
              )}

              {/* ════════ 出口退税 Tab ════════ */}
              {activeTab === 'taxRefunds' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {taxRefunds.length === 0 ? (
                    <div className="bds-empty">
                      <div className="glyph"><Receipt size={24} /></div>
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
                                <span className="text-sm font-medium bds-mono">{tr.refundNumber}</span>
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
                                <div><span className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>退税额</span><span className="font-medium bds-tnum" style={{ color: 'var(--success-text)' }}>CNY {formatNum(tr.refundAmount)}</span></div>
                              </div>
                              {tr.reviewNotes && (
                                <div className={`bds-alert ${SEMANTIC_BADGE_VARIANT[si.semantic] === 'neutral' ? 'info' : SEMANTIC_BADGE_VARIANT[si.semantic]} mt-2`}>
                                  审核: {tr.reviewedBy} · {tr.reviewNotes}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {tr.status === 'Draft' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Submitted')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">提交申报</button>}
                            {tr.status === 'Submitted' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Reviewing')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">送审</button>}
                            {tr.status === 'Reviewing' && (
                              <>
                                <button onClick={() => handleReviewTaxRefund(tr.id, 'Approved')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">批准</button>
                                <button onClick={() => handleReviewTaxRefund(tr.id, 'Rejected')} disabled={!!actionLoading} className="bds-btn bds-btn-danger">拒绝</button>
                              </>
                            )}
                            {tr.status === 'Approved' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Refunded')} disabled={!!actionLoading} className="bds-btn bds-btn-primary">确认到账</button>}
                            {tr.status === 'Rejected' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Draft')} disabled={!!actionLoading} className="bds-btn bds-btn-secondary">退回草稿</button>}
                            {(tr.status === 'Draft' || tr.status === 'Cancelled') && <button onClick={() => handleDelete('taxRefunds', tr.id)} disabled={!!actionLoading} className="bds-btn bds-btn-danger"><Trash2 size={11} />删除</button>}
                            <button onClick={() => handleToggleTrVat(tr.id)} className="bds-btn bds-btn-secondary">
                              <Receipt size={11} />{trVatId === tr.id ? '收起专票勾稽' : '专票勾稽'}
                            </button>
                          </div>
                          {/* C6：进项专票勾稽（退税申报单 ↔ VAT 专票，税额勾稽核对） */}
                          {trVatId === tr.id && (
                            <div className="mt-3 pt-3" style={{ borderTop: 'var(--border-subtle)' }}>
                              {trVatLoading ? (
                                <div className="flex items-center gap-2 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                  <Loader2 size={12} className="animate-spin" />加载进项专票…
                                </div>
                              ) : trVatInvoices.length === 0 ? (
                                <div className="py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                  暂无关联进项专票（在 财务 → 增值税 页签执行「申报退税」时关联本申报单）
                                </div>
                              ) : (
                                <>
                                  <div className="space-y-1">
                                    {trVatInvoices.map(v => (
                                      <div key={v.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-inset text-xs" style={{ background: 'var(--bg-panel)' }}>
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
                                <RelatedEntitiesPanel
                                  type="taxRefund"
                                  id={tr.id}
                                  isDarkMode={isDarkMode}
                                  title="退税关联视图"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </motion.div>
              )}

              {/* ════════ 贸易单据 Tab（Wave A1：台账/版本/打包收口单据中心，此处仅入口卡） ════════ */}
              {activeTab === 'tradeDocuments' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="bds-card p-8 flex flex-col items-center text-center">
                    <FileText size={28} style={{ color: 'var(--text-quaternary)' }} />
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
          onClose={() => { setShowForm(false); setFormError(null); }}
          onSuccess={async () => {
            setShowForm(false);
            setFormError(null);
            if (activeTab === 'declarations') fetchDeclarations();
            if (activeTab === 'hsCodes') fetchHsCodes();
            if (activeTab === 'lettersOfCredit') fetchLettersOfCredit();
            if (activeTab === 'taxRefunds') fetchTaxRefunds();
          }}
        />
      )}
    </div>
  );
};

// ==================== 创建表单弹窗 ====================

interface CreateFormModalProps {
  activeTab: TabId;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateFormModal: React.FC<CreateFormModalProps> = ({ activeTab, onClose, onSuccess }) => {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 报关单表单
  const [declForm, setDeclForm] = useState<CustomsDeclarationInput>({
    declarationNumber: '',
    type: 'Export',
    tradeTerms: 'FOB',
    currency: 'USD',
  });

  // HS 编码表单
  const [hsForm, setHsForm] = useState<HsCodeInput>({
    code: '',
    description: '',
    category: 'Textile',
    isActive: true,
  });

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
        await apiService.createCustomsDeclaration(declForm);
      } else if (activeTab === 'hsCodes') {
        if (!hsForm.code || !hsForm.description) throw new Error('请填写 HS 编码和描述');
        await apiService.createHsCode(hsForm);
      } else if (activeTab === 'lettersOfCredit') {
        if (!lcForm.lcNumber || !lcForm.amount) throw new Error('请填写信用证号和金额');
        await apiService.createLetterOfCredit(lcForm);
      } else if (activeTab === 'taxRefunds') {
        if (!trForm.refundNumber) throw new Error('请填写退税编号');
        await apiService.createTaxRefund(trForm);
      }
      onSuccess();
    } catch (e: any) {
      setError(String(e?.message || e || '创建失败'));
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
            {activeTab === 'hsCodes' && '新增 HS 编码'}
            {activeTab === 'lettersOfCredit' && '新增信用证'}
            {activeTab === 'taxRefunds' && '新增出口退税'}
          </h2>
          <button onClick={onClose} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}><X size={16} /></button>
        </div>

        {error && (
          <div className="bds-alert danger mb-3">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* 报关单表单 */}
        {activeTab === 'declarations' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>报关单号 *</label><input className="bds-input sm" value={declForm.declarationNumber} onChange={e => setDeclForm({ ...declForm, declarationNumber: e.target.value })} placeholder="CD-20260807-001" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>报关类型 *</label><select className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }} value={declForm.type} onChange={e => setDeclForm({ ...declForm, type: e.target.value as CustomsType })}>{CUSTOMS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>申报日期</label><input type="date" className="bds-input sm" value={declForm.declarationDate || ''} onChange={e => setDeclForm({ ...declForm, declarationDate: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>贸易条款</label><select className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }} value={declForm.tradeTerms || ''} onChange={e => setDeclForm({ ...declForm, tradeTerms: e.target.value })}><option value="">—</option>{TRADE_TERMS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
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
          </div>
        )}

        {/* HS 编码表单 */}
        {activeTab === 'hsCodes' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>HS 编码 *</label><input className="bds-input sm" value={hsForm.code} onChange={e => setHsForm({ ...hsForm, code: e.target.value })} placeholder="5208.52.00.00" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>类别 *</label><select className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }} value={hsForm.category} onChange={e => setHsForm({ ...hsForm, category: e.target.value as HsCodeCategory })}>{HS_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
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
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>类型 *</label><select className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }} value={lcForm.type} onChange={e => setLcForm({ ...lcForm, type: e.target.value as LetterOfCreditType })}>{LC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>金额 *</label><input type="number" className="bds-input sm" value={lcForm.amount || ''} onChange={e => setLcForm({ ...lcForm, amount: Number(e.target.value) || 0 })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>币种</label><input className="bds-input sm" value={lcForm.currency || ''} onChange={e => setLcForm({ ...lcForm, currency: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>开证日期</label><input type="date" className="bds-input sm" value={lcForm.issueDate || ''} onChange={e => setLcForm({ ...lcForm, issueDate: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>有效期</label><input type="date" className="bds-input sm" value={lcForm.expiryDate || ''} onChange={e => setLcForm({ ...lcForm, expiryDate: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>开证行</label><input className="bds-input sm" value={lcForm.issueBank || ''} onChange={e => setLcForm({ ...lcForm, issueBank: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>通知行</label><input className="bds-input sm" value={lcForm.advisingBank || ''} onChange={e => setLcForm({ ...lcForm, advisingBank: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>申请人(进口方)</label><input className="bds-input sm" value={lcForm.applicant || ''} onChange={e => setLcForm({ ...lcForm, applicant: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>受益人(出口方)</label><input className="bds-input sm" value={lcForm.beneficiary || ''} onChange={e => setLcForm({ ...lcForm, beneficiary: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>最迟装运期</label><input type="date" className="bds-input sm" value={lcForm.shipmentDeadline || ''} onChange={e => setLcForm({ ...lcForm, shipmentDeadline: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>交单期限</label><input type="date" className="bds-input sm" value={lcForm.presentationDeadline || ''} onChange={e => setLcForm({ ...lcForm, presentationDeadline: e.target.value })} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>贸易条款</label><select className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }} value={lcForm.tradeTerms || ''} onChange={e => setLcForm({ ...lcForm, tradeTerms: e.target.value })}><option value="">—</option>{TRADE_TERMS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>装运港</label><input className="bds-input sm" value={lcForm.portOfLoading || ''} onChange={e => setLcForm({ ...lcForm, portOfLoading: e.target.value })} /></div>
            <div className="col-span-2"><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>特殊条款</label><textarea className="bds-input bds-textarea" rows={2} value={lcForm.specialConditions || ''} onChange={e => setLcForm({ ...lcForm, specialConditions: e.target.value })} /></div>
          </div>
        )}

        {/* 退税表单 */}
        {activeTab === 'taxRefunds' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>退税编号 *</label><input className="bds-input sm" value={trForm.refundNumber} onChange={e => setTrForm({ ...trForm, refundNumber: e.target.value })} placeholder="TR-20260807-001" /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>出口日期</label><input type="date" className="bds-input sm" value={trForm.exportDate || ''} onChange={e => setTrForm({ ...trForm, exportDate: e.target.value })} /></div>
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
            {submitting && <Loader2 size={12} className="animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomsManager;
