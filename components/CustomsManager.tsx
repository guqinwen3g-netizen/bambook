/**
 * 外贸与报关 CustomsManager
 * Phase 5 B5 + Phase 3 C6：服装外贸出口合规闭环
 *
 * 功能：
 *   - 报关单管理（CRUD + 状态机 + 明细行）
 *   - HS 编码库（参考数据 CRUD + 停用）
 *   - 信用证管理（CRUD + 状态机 + 不符点记录）
 *   - 出口退税（CRUD + 状态机 + 审核 + 自动退税额计算）
 *   - 贸易单据（CRUD + 状态机 + 附件管理）
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
} from 'lucide-react';
import { apiService } from '../services/apiService';
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
  TaxRefund,
  TaxRefundInput,
  TaxRefundStatus,
  TradeDocument,
  TradeDocumentInput,
  TradeDocumentType,
  TradeDocumentStatus,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { statusSemanticClass, statusSemanticText, StatusSemantic } from './rdlBusinessStatusTokens';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { RelatedEntitiesPanel } from './RelatedEntitiesPanel';

// ==================== 常量 ====================

type TabId = 'declarations' | 'hsCodes' | 'lettersOfCredit' | 'taxRefunds' | 'tradeDocuments';

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

const DOC_TYPES: Array<{ id: TradeDocumentType; label: string }> = [
  { id: 'CommercialInvoice', label: '商业发票' },
  { id: 'PackingList', label: '装箱单' },
  { id: 'CertificateOfOrigin', label: '原产地证' },
  { id: 'BillOfLading', label: '提单 B/L' },
  { id: 'AirWaybill', label: '空运单 AWB' },
  { id: 'InsuranceCert', label: '保险凭证' },
  { id: 'InspectionCert', label: '检验证书' },
  { id: 'PhytosanitaryCert', label: '植检证书' },
  { id: 'Other', label: '其他' },
];

const DOC_STATUSES: Array<{ id: TradeDocumentStatus; label: string; semantic: StatusSemantic }> = [
  { id: 'Draft', label: '草稿', semantic: 'neutral' },
  { id: 'Issued', label: '已签发', semantic: 'info' },
  { id: 'Submitted', label: '已提交', semantic: 'info' },
  { id: 'Accepted', label: '已接受', semantic: 'success' },
  { id: 'Rejected', label: '已拒绝', semantic: 'danger' },
  { id: 'Cancelled', label: '已取消', semantic: 'neutral' },
];

const TRADE_TERMS = ['FOB', 'CIF', 'EXW', 'DDP', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'CFR'];

interface CustomsManagerProps {
  isDarkMode: boolean;
}

// ==================== 组件 ====================

const CustomsManager: React.FC<CustomsManagerProps> = ({ isDarkMode }) => {
  const [activeTab, setActiveTab] = useState<TabId>('declarations');
  const [declarations, setDeclarations] = useState<CustomsDeclaration[]>([]);
  const [hsCodes, setHsCodes] = useState<HsCode[]>([]);
  const [lettersOfCredit, setLettersOfCredit] = useState<LetterOfCredit[]>([]);
  const [taxRefunds, setTaxRefunds] = useState<TaxRefund[]>([]);
  const [tradeDocuments, setTradeDocuments] = useState<TradeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  const fetchTradeDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listTradeDocuments({
        search: searchQuery || undefined,
        status: statusFilter || undefined,
        limit: 200,
      });
      setTradeDocuments(result.items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    if (activeTab === 'declarations') fetchDeclarations();
    if (activeTab === 'hsCodes') fetchHsCodes();
    if (activeTab === 'lettersOfCredit') fetchLettersOfCredit();
    if (activeTab === 'taxRefunds') fetchTaxRefunds();
    if (activeTab === 'tradeDocuments') fetchTradeDocuments();
  }, [activeTab, fetchDeclarations, fetchHsCodes, fetchLettersOfCredit, fetchTaxRefunds, fetchTradeDocuments]);

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
  const docStatusInfo = (s: TradeDocumentStatus) => DOC_STATUSES.find(d => d.id === s) || DOC_STATUSES[0];

  // ── 主题样式 ──
  const cardClass = isDarkMode
    ? `rounded-card border border-white/[0.055] bg-white/[0.018] ${BAMBOOK_OS.material.glassColor}`
    : `rounded-card border border-white/45 bg-white/24 ${BAMBOOK_OS.material.glassColor}`;
  const fieldClass = `w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] ${
    isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const labelClass = `block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;
  const tabBtnCls = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-xs font-light inline-flex items-center gap-1.5 transition-colors ${
      active
        ? 'bg-[var(--os-vnext-brand-blue)] text-white'
        : isDarkMode
        ? 'bg-white/5 text-slate-400 hover:bg-white/10'
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'declarations', label: '报关单', icon: <FileCheck size={12} />, count: declarations.length },
    { id: 'hsCodes', label: 'HS 编码库', icon: <BookOpen size={12} />, count: hsCodes.length },
    { id: 'lettersOfCredit', label: '信用证', icon: <CreditCard size={12} />, count: lettersOfCredit.length },
    { id: 'taxRefunds', label: '出口退税', icon: <Receipt size={12} />, count: taxRefunds.length },
    { id: 'tradeDocuments', label: '贸易单据', icon: <FileText size={12} />, count: tradeDocuments.length },
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
    } catch (e: any) {
      setError(`状态转换失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

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

  const handleTransitionDoc = useCallback(async (id: string, toStatus: TradeDocumentStatus) => {
    setActionLoading(`doc_${id}_${toStatus}`);
    try {
      const updated = await apiService.transitionTradeDocumentStatus(id, toStatus);
      setTradeDocuments(prev => prev.map(d => (d.id === id ? updated : d)));
    } catch (e: any) {
      setError(`状态转换失败：${e?.message || e}`);
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
      } else if (tab === 'tradeDocuments') {
        await apiService.deleteTradeDocument(id);
        setTradeDocuments(prev => prev.filter(d => d.id !== id));
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
          <button
            onClick={() => setShowForm(true)}
            className="h-8 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} /><span>新增</span>
          </button>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <ScrollEdgeFades scrollRef={{ current: null }} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* Tab 导航 */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setActiveTab(t.id); setSearchQuery(''); setStatusFilter(''); }} className={tabBtnCls(activeTab === t.id)}>
                {t.icon}<span>{t.label}</span>
                {t.count != null && t.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === t.id ? 'bg-white/20' : isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* 工具栏 */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索编号 / 名称 / 客户..."
                className={`${fieldClass} pl-9 py-1.5`}
                onKeyDown={(e) => { if (e.key === 'Enter') { if (activeTab === 'declarations') fetchDeclarations(); if (activeTab === 'hsCodes') fetchHsCodes(); if (activeTab === 'lettersOfCredit') fetchLettersOfCredit(); if (activeTab === 'taxRefunds') fetchTaxRefunds(); if (activeTab === 'tradeDocuments') fetchTradeDocuments(); } }}
              />
            </div>
            {activeTab !== 'hsCodes' && (
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${fieldClass} max-w-[140px] py-1.5`}>
                <option value="">全部状态</option>
                {activeTab === 'declarations' && DECLARATION_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                {activeTab === 'lettersOfCredit' && LC_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                {activeTab === 'taxRefunds' && TAX_REFUND_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                {activeTab === 'tradeDocuments' && DOC_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            )}
            <button
              onClick={() => { if (activeTab === 'declarations') fetchDeclarations(); if (activeTab === 'hsCodes') fetchHsCodes(); if (activeTab === 'lettersOfCredit') fetchLettersOfCredit(); if (activeTab === 'taxRefunds') fetchTaxRefunds(); if (activeTab === 'tradeDocuments') fetchTradeDocuments(); }}
              className="h-9 px-3 rounded-control text-xs font-light flex items-center gap-1.5 transition-colors border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <RefreshCw size={12} />刷新
            </button>
          </div>

          {error && (
            <div className={`p-3 rounded-inset border flex items-center gap-2 mb-3 ${statusSemanticClass('danger', isDarkMode)}`}>
              <AlertCircle size={16} className={statusSemanticText('danger', isDarkMode)} />
              <span className="text-sm">{error}</span>
              <button onClick={() => setError(null)} className={`ml-auto p-0.5 ${isDarkMode ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-900'}`}>
                <X size={14} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className={`animate-spin ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
            </div>
          ) : (
            <>
              {/* ════════ 报关单 Tab ════════ */}
              {activeTab === 'declarations' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {declarations.length === 0 ? (
                    <div className={`text-center py-20 text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>暂无报关单数据</div>
                  ) : (
                    declarations.map(decl => {
                      const si = declStatusInfo(decl.status);
                      const isExpanded = expandedId === decl.id;
                      return (
                        <div key={decl.id} className={cardClass}>
                          <div
                            className="flex items-center gap-3 p-3 cursor-pointer"
                            onClick={() => setExpandedId(isExpanded ? null : decl.id)}
                          >
                            {isExpanded ? <ChevronDown size={14} className={isDarkMode ? 'text-slate-500' : 'text-slate-400'} /> : <ChevronRight size={14} className={isDarkMode ? 'text-slate-500' : 'text-slate-400'} />}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{decl.declarationNumber}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusSemanticClass(si.semantic, isDarkMode)} ${statusSemanticText(si.semantic, isDarkMode)}`}>{si.label}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${CUSTOMS_TYPES.find(t => t.id === decl.type)?.id === 'Export' ? 'bg-blue-500/15 text-blue-500' : 'bg-amber-500/15 text-amber-600'}`}>
                                  {CUSTOMS_TYPES.find(t => t.id === decl.type)?.label || decl.type}
                                </span>
                              </div>
                              <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                {decl.consignee || '—'} → {decl.destinationCountry || '—'} · {decl.totalPackages ?? '—'} 件 · {formatNum(decl.grossWeight, 3)} kg
                                {decl._count?.lines ? ` · ${decl._count.lines} 行` : ''}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-medium">{decl.currency || ''} {formatNum(decl.totalValue)}</div>
                              <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{formatDate(decl.declarationDate)}</div>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className={`px-4 pb-3 border-t ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 text-xs">
                                <div><span className={labelClass}>贸易条款</span>{decl.tradeTerms || '—'}</div>
                                <div><span className={labelClass}>申报口岸</span>{decl.declarationPort || '—'}</div>
                                <div><span className={labelClass}>报关行</span>{decl.agent || '—'}</div>
                                <div><span className={labelClass}>报关员</span>{decl.declarant || '—'}</div>
                                <div><span className={labelClass}>原产国</span>{decl.originCountry || '—'}</div>
                                <div><span className={labelClass}>目的国</span>{decl.destinationCountry || '—'}</div>
                                <div><span className={labelClass}>毛重</span>{formatNum(decl.grossWeight, 3)} kg</div>
                                <div><span className={labelClass}>净重</span>{formatNum(decl.netWeight, 3)} kg</div>
                              </div>
                              {decl.lines && decl.lines.length > 0 && (
                                <div className="mt-3">
                                  <div className={labelClass}>明细行</div>
                                  <div className="space-y-1">
                                    {decl.lines.map(line => (
                                      <div key={line.id} className={`flex items-center gap-2 px-2 py-1 rounded-inset text-xs ${isDarkMode ? 'bg-white/[0.02]' : 'bg-slate-50'}`}>
                                        <span className="text-slate-500">#{line.lineNumber}</span>
                                        <span className="flex-1 truncate">{line.productName}</span>
                                        {line.hsCode && <span className={`px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>{line.hsCode}</span>}
                                        <span>{formatNum(line.quantity)} {line.unit}</span>
                                        {line.totalAmount && <span className="text-slate-500">{line.currency || ''} {formatNum(line.totalAmount)}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* 状态转换按钮 */}
                              <div className="flex items-center gap-2 mt-3 flex-wrap">
                                {decl.status === 'Draft' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Submitted')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-[var(--os-vnext-brand-blue)] text-white disabled:opacity-50">提交申报</button>
                                )}
                                {decl.status === 'Submitted' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Declared')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-[var(--os-vnext-brand-blue)] text-white disabled:opacity-50">确认报关</button>
                                )}
                                {decl.status === 'Declared' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Inspecting')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-amber-500 text-white disabled:opacity-50">查验中</button>
                                )}
                                {decl.status === 'Inspecting' && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Released')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-green-500 text-white disabled:opacity-50">放行</button>
                                )}
                                {(decl.status === 'Draft' || decl.status === 'Submitted' || decl.status === 'Exception') && (
                                  <button onClick={() => handleTransitionDeclaration(decl.id, 'Cancelled')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light border border-slate-200 dark:border-white/10 text-slate-500 disabled:opacity-50">取消</button>
                                )}
                                {(decl.status === 'Draft' || decl.status === 'Cancelled') && (
                                  <button onClick={() => handleDelete('declarations', decl.id)} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light text-red-500 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-1">
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
                    <div className={`text-center py-20 text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>暂无 HS 编码数据</div>
                  ) : (
                    <div className={`${cardClass} overflow-hidden`}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className={`border-b ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
                            <th className="text-left px-3 py-2 font-light">HS 编码</th>
                            <th className="text-left px-3 py-2 font-light">商品描述</th>
                            <th className="text-left px-3 py-2 font-light">类别</th>
                            <th className="text-right px-3 py-2 font-light">退税率</th>
                            <th className="text-right px-3 py-2 font-light">关税率</th>
                            <th className="text-right px-3 py-2 font-light">增值税率</th>
                            <th className="text-center px-3 py-2 font-light">状态</th>
                            <th className="text-right px-3 py-2 font-light">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hsCodes.map(hc => (
                            <tr key={hc.id} className={`border-b ${isDarkMode ? 'border-white/[0.02]' : 'border-slate-50'} hover:bg-white/[0.02]`}>
                              <td className="px-3 py-2 font-mono">{hc.code}</td>
                              <td className="px-3 py-2 max-w-[200px] truncate">{hc.description}</td>
                              <td className="px-3 py-2">{HS_CATEGORIES.find(c => c.id === hc.category)?.label || hc.category}</td>
                              <td className="px-3 py-2 text-right">{hc.exportTaxRebateRate ? `${formatNum(hc.exportTaxRebateRate, 4)}%` : '—'}</td>
                              <td className="px-3 py-2 text-right">{hc.importTariffRate ? `${formatNum(hc.importTariffRate, 4)}%` : '—'}</td>
                              <td className="px-3 py-2 text-right">{hc.vatRate ? `${formatNum(hc.vatRate, 4)}%` : '—'}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${hc.isActive ? statusSemanticClass('success', isDarkMode) : statusSemanticClass('neutral', isDarkMode)} ${hc.isActive ? statusSemanticText('success', isDarkMode) : statusSemanticText('neutral', isDarkMode)}`}>
                                  {hc.isActive ? '启用' : '停用'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                {hc.isActive && (
                                  <button onClick={() => handleDelete('hsCodes', hc.id)} disabled={!!actionLoading} className="text-red-500 hover:text-red-600 disabled:opacity-50">
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
                    <div className={`text-center py-20 text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>暂无信用证数据</div>
                  ) : (
                    lettersOfCredit.map(lc => {
                      const si = lcStatusInfo(lc.status);
                      return (
                        <div key={lc.id} className={`${cardClass} p-3`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium">{lc.lcNumber}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusSemanticClass(si.semantic, isDarkMode)} ${statusSemanticText(si.semantic, isDarkMode)}`}>{si.label}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                                  {LC_TYPES.find(t => t.id === lc.type)?.label || lc.type}
                                </span>
                              </div>
                              <div className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                {lc.applicant || '—'} → {lc.beneficiary || '—'}
                                {lc.issueBank && ` · 开证行: ${lc.issueBank}`}
                              </div>
                              <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                有效期: {formatDate(lc.expiryDate)}
                                {lc.shipmentDeadline && ` · 最迟装运: ${lc.shipmentDeadline}`}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-medium">{lc.currency} {formatNum(lc.amount)}</div>
                              {lc.availableAmount && lc.availableAmount !== lc.amount && (
                                <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>可用: {formatNum(lc.availableAmount)}</div>
                              )}
                            </div>
                          </div>
                          {lc.discrepancies && (
                            <div className={`mt-2 p-2 rounded-inset text-xs ${statusSemanticClass('warning', isDarkMode)}`}>
                              不符点: {lc.discrepancies}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {lc.status === 'Issued' && <button onClick={() => handleTransitionLc(lc.id, 'Presented')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-[var(--os-vnext-brand-blue)] text-white disabled:opacity-50">交单</button>}
                            {lc.status === 'Presented' && <button onClick={() => handleTransitionLc(lc.id, 'Accepted')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-green-500 text-white disabled:opacity-50">承兑</button>}
                            {lc.status === 'Accepted' && <button onClick={() => handleTransitionLc(lc.id, 'Settled')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-green-500 text-white disabled:opacity-50">结算</button>}
                            {(lc.status === 'Issued' || lc.status === 'Presented' || lc.status === 'Accepted') && <button onClick={() => handleTransitionLc(lc.id, 'Cancelled')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light border border-slate-200 dark:border-white/10 text-slate-500 disabled:opacity-50">取消</button>}
                            {(lc.status === 'Issued' || lc.status === 'Cancelled') && <button onClick={() => handleDelete('lettersOfCredit', lc.id)} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light text-red-500 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-1"><Trash2 size={11} />删除</button>}
                          </div>
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
                    <div className={`text-center py-20 text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>暂无退税数据</div>
                  ) : (
                    taxRefunds.map(tr => {
                      const si = taxRefundStatusInfo(tr.status);
                      return (
                        <div key={tr.id} className={`${cardClass} p-3`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium">{tr.refundNumber}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusSemanticClass(si.semantic, isDarkMode)} ${statusSemanticText(si.semantic, isDarkMode)}`}>{si.label}</span>
                              </div>
                              <div className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                出口日期: {formatDate(tr.exportDate)}
                                {tr.declarationDate && ` · 申报: ${tr.declarationDate}`}
                                {tr.refundDate && ` · 到账: ${tr.refundDate}`}
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
                                <div><span className={labelClass}>FOB 金额</span>{tr.exportAmountFobCurrency || ''} {formatNum(tr.exportAmountFob)}</div>
                                <div><span className={labelClass}>折人民币</span>CNY {formatNum(tr.exportAmountCny)}</div>
                                <div><span className={labelClass}>退税率</span>{tr.refundableRate ? `${formatNum(tr.refundableRate, 4)}%` : '—'}</div>
                                <div><span className={labelClass}>退税额</span><span className="text-green-500 font-medium">CNY {formatNum(tr.refundAmount)}</span></div>
                              </div>
                              {tr.reviewNotes && (
                                <div className={`mt-2 p-2 rounded-inset text-xs ${statusSemanticClass(si.semantic, isDarkMode)}`}>
                                  审核: {tr.reviewedBy} · {tr.reviewNotes}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {tr.status === 'Draft' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Submitted')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-[var(--os-vnext-brand-blue)] text-white disabled:opacity-50">提交申报</button>}
                            {tr.status === 'Submitted' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Reviewing')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-amber-500 text-white disabled:opacity-50">送审</button>}
                            {tr.status === 'Reviewing' && (
                              <>
                                <button onClick={() => handleReviewTaxRefund(tr.id, 'Approved')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-green-500 text-white disabled:opacity-50">批准</button>
                                <button onClick={() => handleReviewTaxRefund(tr.id, 'Rejected')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-red-500 text-white disabled:opacity-50">拒绝</button>
                              </>
                            )}
                            {tr.status === 'Approved' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Refunded')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-green-500 text-white disabled:opacity-50">确认到账</button>}
                            {tr.status === 'Rejected' && <button onClick={() => handleTransitionTaxRefund(tr.id, 'Draft')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light border border-slate-200 dark:border-white/10 text-slate-500 disabled:opacity-50">退回草稿</button>}
                            {(tr.status === 'Draft' || tr.status === 'Cancelled') && <button onClick={() => handleDelete('taxRefunds', tr.id)} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light text-red-500 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-1"><Trash2 size={11} />删除</button>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </motion.div>
              )}

              {/* ════════ 贸易单据 Tab ════════ */}
              {activeTab === 'tradeDocuments' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {tradeDocuments.length === 0 ? (
                    <div className={`text-center py-20 text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>暂无贸易单据数据</div>
                  ) : (
                    tradeDocuments.map(doc => {
                      const si = docStatusInfo(doc.status);
                      return (
                        <div key={doc.id} className={`${cardClass} p-3`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium">{doc.documentNumber}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusSemanticClass(si.semantic, isDarkMode)} ${statusSemanticText(si.semantic, isDarkMode)}`}>{si.label}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                                  {DOC_TYPES.find(t => t.id === doc.type)?.label || doc.type}
                                </span>
                              </div>
                              <div className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                {doc.consignor || '—'} → {doc.consignee || '—'}
                                {doc.issuedBy && ` · 签发: ${doc.issuedBy}`}
                              </div>
                              <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                签发日: {formatDate(doc.issueDate)}
                                {doc.expiryDate && ` · 有效期至: ${doc.expiryDate}`}
                                {doc.fileName && ` · 📎 ${doc.fileName}`}
                              </div>
                            </div>
                            {doc.totalAmount && (
                              <div className="text-right shrink-0">
                                <div className="text-sm font-medium">{doc.currency || ''} {formatNum(doc.totalAmount)}</div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {doc.status === 'Draft' && <button onClick={() => handleTransitionDoc(doc.id, 'Issued')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-[var(--os-vnext-brand-blue)] text-white disabled:opacity-50">签发</button>}
                            {doc.status === 'Issued' && <button onClick={() => handleTransitionDoc(doc.id, 'Submitted')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-[var(--os-vnext-brand-blue)] text-white disabled:opacity-50">提交</button>}
                            {doc.status === 'Submitted' && (
                              <>
                                <button onClick={() => handleTransitionDoc(doc.id, 'Accepted')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-green-500 text-white disabled:opacity-50">接受</button>
                                <button onClick={() => handleTransitionDoc(doc.id, 'Rejected')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light bg-red-500 text-white disabled:opacity-50">拒绝</button>
                              </>
                            )}
                            {doc.status === 'Rejected' && <button onClick={() => handleTransitionDoc(doc.id, 'Draft')} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light border border-slate-200 dark:border-white/10 text-slate-500 disabled:opacity-50">退回草稿</button>}
                            {(doc.status === 'Draft' || doc.status === 'Cancelled') && <button onClick={() => handleDelete('tradeDocuments', doc.id)} disabled={!!actionLoading} className="h-7 px-3 rounded-control text-[11px] font-light text-red-500 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-1"><Trash2 size={11} />删除</button>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 创建表单弹窗 */}
      {showForm && (
        <CreateFormModal
          activeTab={activeTab}
          isDarkMode={isDarkMode}
          onClose={() => { setShowForm(false); setFormError(null); }}
          onSuccess={async () => {
            setShowForm(false);
            setFormError(null);
            if (activeTab === 'declarations') fetchDeclarations();
            if (activeTab === 'hsCodes') fetchHsCodes();
            if (activeTab === 'lettersOfCredit') fetchLettersOfCredit();
            if (activeTab === 'taxRefunds') fetchTaxRefunds();
            if (activeTab === 'tradeDocuments') fetchTradeDocuments();
          }}
          cardClass={cardClass}
          fieldClass={fieldClass}
          labelClass={labelClass}
        />
      )}
    </div>
  );
};

// ==================== 创建表单弹窗 ====================

interface CreateFormModalProps {
  activeTab: TabId;
  isDarkMode: boolean;
  onClose: () => void;
  onSuccess: () => void;
  cardClass: string;
  fieldClass: string;
  labelClass: string;
}

const CreateFormModal: React.FC<CreateFormModalProps> = ({ activeTab, isDarkMode, onClose, onSuccess, cardClass, fieldClass, labelClass }) => {
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

  // 单据表单
  const [docForm, setDocForm] = useState<TradeDocumentInput>({
    documentNumber: '',
    type: 'CommercialInvoice',
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
      } else if (activeTab === 'tradeDocuments') {
        if (!docForm.documentNumber) throw new Error('请填写单据编号');
        await apiService.createTradeDocument(docForm);
      }
      onSuccess();
    } catch (e: any) {
      setError(String(e?.message || e || '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = `${fieldClass} py-1.5`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className={`${cardClass} w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 m-4`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium">
            {activeTab === 'declarations' && '新增报关单'}
            {activeTab === 'hsCodes' && '新增 HS 编码'}
            {activeTab === 'lettersOfCredit' && '新增信用证'}
            {activeTab === 'taxRefunds' && '新增出口退税'}
            {activeTab === 'tradeDocuments' && '新增贸易单据'}
          </h2>
          <button onClick={onClose} className={`p-1 rounded ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}><X size={16} /></button>
        </div>

        {error && (
          <div className={`p-2 rounded-inset border flex items-center gap-2 mb-3 ${statusSemanticClass('danger', isDarkMode)}`}>
            <AlertCircle size={14} className={statusSemanticText('danger', isDarkMode)} />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {/* 报关单表单 */}
        {activeTab === 'declarations' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>报关单号 *</label><input className={inputCls} value={declForm.declarationNumber} onChange={e => setDeclForm({ ...declForm, declarationNumber: e.target.value })} placeholder="CD-20260807-001" /></div>
            <div><label className={labelClass}>报关类型 *</label><select className={inputCls} value={declForm.type} onChange={e => setDeclForm({ ...declForm, type: e.target.value as CustomsType })}>{CUSTOMS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div><label className={labelClass}>申报日期</label><input type="date" className={inputCls} value={declForm.declarationDate || ''} onChange={e => setDeclForm({ ...declForm, declarationDate: e.target.value })} /></div>
            <div><label className={labelClass}>贸易条款</label><select className={inputCls} value={declForm.tradeTerms || ''} onChange={e => setDeclForm({ ...declForm, tradeTerms: e.target.value })}><option value="">—</option>{TRADE_TERMS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className={labelClass}>申报口岸</label><input className={inputCls} value={declForm.declarationPort || ''} onChange={e => setDeclForm({ ...declForm, declarationPort: e.target.value })} /></div>
            <div><label className={labelClass}>报关行</label><input className={inputCls} value={declForm.agent || ''} onChange={e => setDeclForm({ ...declForm, agent: e.target.value })} /></div>
            <div><label className={labelClass}>发货人</label><input className={inputCls} value={declForm.consignor || ''} onChange={e => setDeclForm({ ...declForm, consignor: e.target.value })} /></div>
            <div><label className={labelClass}>收货人</label><input className={inputCls} value={declForm.consignee || ''} onChange={e => setDeclForm({ ...declForm, consignee: e.target.value })} /></div>
            <div><label className={labelClass}>原产国</label><input className={inputCls} value={declForm.originCountry || ''} onChange={e => setDeclForm({ ...declForm, originCountry: e.target.value })} placeholder="China" /></div>
            <div><label className={labelClass}>目的国</label><input className={inputCls} value={declForm.destinationCountry || ''} onChange={e => setDeclForm({ ...declForm, destinationCountry: e.target.value })} placeholder="USA" /></div>
            <div><label className={labelClass}>总件数</label><input type="number" className={inputCls} value={declForm.totalPackages ?? ''} onChange={e => setDeclForm({ ...declForm, totalPackages: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>申报总额</label><input type="number" className={inputCls} value={declForm.totalValue ?? ''} onChange={e => setDeclForm({ ...declForm, totalValue: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>币种</label><input className={inputCls} value={declForm.currency || ''} onChange={e => setDeclForm({ ...declForm, currency: e.target.value })} placeholder="USD" /></div>
            <div><label className={labelClass}>毛重(kg)</label><input type="number" className={inputCls} value={declForm.grossWeight ?? ''} onChange={e => setDeclForm({ ...declForm, grossWeight: Number(e.target.value) || undefined })} /></div>
            <div className="col-span-2"><label className={labelClass}>备注</label><textarea className={inputCls} rows={2} value={declForm.notes || ''} onChange={e => setDeclForm({ ...declForm, notes: e.target.value })} /></div>
          </div>
        )}

        {/* HS 编码表单 */}
        {activeTab === 'hsCodes' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>HS 编码 *</label><input className={inputCls} value={hsForm.code} onChange={e => setHsForm({ ...hsForm, code: e.target.value })} placeholder="5208.52.00.00" /></div>
            <div><label className={labelClass}>类别 *</label><select className={inputCls} value={hsForm.category} onChange={e => setHsForm({ ...hsForm, category: e.target.value as HsCodeCategory })}>{HS_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
            <div className="col-span-2"><label className={labelClass}>商品描述 *</label><input className={inputCls} value={hsForm.description} onChange={e => setHsForm({ ...hsForm, description: e.target.value })} /></div>
            <div><label className={labelClass}>出口退税率(%)</label><input type="number" step="0.01" className={inputCls} value={hsForm.exportTaxRebateRate ?? ''} onChange={e => setHsForm({ ...hsForm, exportTaxRebateRate: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>进口关税率(%)</label><input type="number" step="0.01" className={inputCls} value={hsForm.importTariffRate ?? ''} onChange={e => setHsForm({ ...hsForm, importTariffRate: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>增值税率(%)</label><input type="number" step="0.01" className={inputCls} value={hsForm.vatRate ?? ''} onChange={e => setHsForm({ ...hsForm, vatRate: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>法定单位</label><input className={inputCls} value={hsForm.unit || ''} onChange={e => setHsForm({ ...hsForm, unit: e.target.value })} placeholder="KG / M / PCS" /></div>
            <div><label className={labelClass}>监管条件</label><input className={inputCls} value={hsForm.supervisionCondition || ''} onChange={e => setHsForm({ ...hsForm, supervisionCondition: e.target.value })} /></div>
            <div><label className={labelClass}>检验检疫</label><input className={inputCls} value={hsForm.inspectionQuarantine || ''} onChange={e => setHsForm({ ...hsForm, inspectionQuarantine: e.target.value })} /></div>
            <div className="col-span-2"><label className={labelClass}>备注</label><textarea className={inputCls} rows={2} value={hsForm.notes || ''} onChange={e => setHsForm({ ...hsForm, notes: e.target.value })} /></div>
          </div>
        )}

        {/* 信用证表单 */}
        {activeTab === 'lettersOfCredit' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>信用证号 *</label><input className={inputCls} value={lcForm.lcNumber} onChange={e => setLcForm({ ...lcForm, lcNumber: e.target.value })} placeholder="LC-20260807-001" /></div>
            <div><label className={labelClass}>类型 *</label><select className={inputCls} value={lcForm.type} onChange={e => setLcForm({ ...lcForm, type: e.target.value as LetterOfCreditType })}>{LC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div><label className={labelClass}>金额 *</label><input type="number" className={inputCls} value={lcForm.amount || ''} onChange={e => setLcForm({ ...lcForm, amount: Number(e.target.value) || 0 })} /></div>
            <div><label className={labelClass}>币种</label><input className={inputCls} value={lcForm.currency || ''} onChange={e => setLcForm({ ...lcForm, currency: e.target.value })} /></div>
            <div><label className={labelClass}>开证日期</label><input type="date" className={inputCls} value={lcForm.issueDate || ''} onChange={e => setLcForm({ ...lcForm, issueDate: e.target.value })} /></div>
            <div><label className={labelClass}>有效期</label><input type="date" className={inputCls} value={lcForm.expiryDate || ''} onChange={e => setLcForm({ ...lcForm, expiryDate: e.target.value })} /></div>
            <div><label className={labelClass}>开证行</label><input className={inputCls} value={lcForm.issueBank || ''} onChange={e => setLcForm({ ...lcForm, issueBank: e.target.value })} /></div>
            <div><label className={labelClass}>通知行</label><input className={inputCls} value={lcForm.advisingBank || ''} onChange={e => setLcForm({ ...lcForm, advisingBank: e.target.value })} /></div>
            <div><label className={labelClass}>申请人(进口方)</label><input className={inputCls} value={lcForm.applicant || ''} onChange={e => setLcForm({ ...lcForm, applicant: e.target.value })} /></div>
            <div><label className={labelClass}>受益人(出口方)</label><input className={inputCls} value={lcForm.beneficiary || ''} onChange={e => setLcForm({ ...lcForm, beneficiary: e.target.value })} /></div>
            <div><label className={labelClass}>最迟装运期</label><input type="date" className={inputCls} value={lcForm.shipmentDeadline || ''} onChange={e => setLcForm({ ...lcForm, shipmentDeadline: e.target.value })} /></div>
            <div><label className={labelClass}>交单期限</label><input type="date" className={inputCls} value={lcForm.presentationDeadline || ''} onChange={e => setLcForm({ ...lcForm, presentationDeadline: e.target.value })} /></div>
            <div><label className={labelClass}>贸易条款</label><select className={inputCls} value={lcForm.tradeTerms || ''} onChange={e => setLcForm({ ...lcForm, tradeTerms: e.target.value })}><option value="">—</option>{TRADE_TERMS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className={labelClass}>装运港</label><input className={inputCls} value={lcForm.portOfLoading || ''} onChange={e => setLcForm({ ...lcForm, portOfLoading: e.target.value })} /></div>
            <div className="col-span-2"><label className={labelClass}>特殊条款</label><textarea className={inputCls} rows={2} value={lcForm.specialConditions || ''} onChange={e => setLcForm({ ...lcForm, specialConditions: e.target.value })} /></div>
          </div>
        )}

        {/* 退税表单 */}
        {activeTab === 'taxRefunds' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>退税编号 *</label><input className={inputCls} value={trForm.refundNumber} onChange={e => setTrForm({ ...trForm, refundNumber: e.target.value })} placeholder="TR-20260807-001" /></div>
            <div><label className={labelClass}>出口日期</label><input type="date" className={inputCls} value={trForm.exportDate || ''} onChange={e => setTrForm({ ...trForm, exportDate: e.target.value })} /></div>
            <div><label className={labelClass}>FOB 金额</label><input type="number" className={inputCls} value={trForm.exportAmountFob ?? ''} onChange={e => setTrForm({ ...trForm, exportAmountFob: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>FOB 币种</label><input className={inputCls} value={trForm.exportAmountFobCurrency || ''} onChange={e => setTrForm({ ...trForm, exportAmountFobCurrency: e.target.value })} /></div>
            <div><label className={labelClass}>折人民币</label><input type="number" className={inputCls} value={trForm.exportAmountCny ?? ''} onChange={e => setTrForm({ ...trForm, exportAmountCny: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>外汇汇率</label><input type="number" step="0.00000001" className={inputCls} value={trForm.fxRate ?? ''} onChange={e => setTrForm({ ...trForm, fxRate: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>退税率(%)</label><input type="number" step="0.01" className={inputCls} value={trForm.refundableRate ?? ''} onChange={e => setTrForm({ ...trForm, refundableRate: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>可退增值税</label><input type="number" className={inputCls} value={trForm.refundableVat ?? ''} onChange={e => setTrForm({ ...trForm, refundableVat: Number(e.target.value) || undefined })} /></div>
            <div className="col-span-2"><label className={labelClass}>备注</label><textarea className={inputCls} rows={2} value={trForm.notes || ''} onChange={e => setTrForm({ ...trForm, notes: e.target.value })} /></div>
          </div>
        )}

        {/* 贸易单据表单 */}
        {activeTab === 'tradeDocuments' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>单据编号 *</label><input className={inputCls} value={docForm.documentNumber} onChange={e => setDocForm({ ...docForm, documentNumber: e.target.value })} placeholder="CI-20260807-001" /></div>
            <div><label className={labelClass}>单据类型 *</label><select className={inputCls} value={docForm.type} onChange={e => setDocForm({ ...docForm, type: e.target.value as TradeDocumentType })}>{DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div><label className={labelClass}>签发日期</label><input type="date" className={inputCls} value={docForm.issueDate || ''} onChange={e => setDocForm({ ...docForm, issueDate: e.target.value })} /></div>
            <div><label className={labelClass}>有效期</label><input type="date" className={inputCls} value={docForm.expiryDate || ''} onChange={e => setDocForm({ ...docForm, expiryDate: e.target.value })} /></div>
            <div><label className={labelClass}>签发方</label><input className={inputCls} value={docForm.issuedBy || ''} onChange={e => setDocForm({ ...docForm, issuedBy: e.target.value })} /></div>
            <div><label className={labelClass}>金额</label><input type="number" className={inputCls} value={docForm.totalAmount ?? ''} onChange={e => setDocForm({ ...docForm, totalAmount: Number(e.target.value) || undefined })} /></div>
            <div><label className={labelClass}>发货人</label><input className={inputCls} value={docForm.consignor || ''} onChange={e => setDocForm({ ...docForm, consignor: e.target.value })} /></div>
            <div><label className={labelClass}>收货人</label><input className={inputCls} value={docForm.consignee || ''} onChange={e => setDocForm({ ...docForm, consignee: e.target.value })} /></div>
            <div><label className={labelClass}>装运港</label><input className={inputCls} value={docForm.portOfLoading || ''} onChange={e => setDocForm({ ...docForm, portOfLoading: e.target.value })} /></div>
            <div><label className={labelClass}>卸货港</label><input className={inputCls} value={docForm.portOfDischarge || ''} onChange={e => setDocForm({ ...docForm, portOfDischarge: e.target.value })} /></div>
            <div className="col-span-2"><label className={labelClass}>备注</label><textarea className={inputCls} rows={2} value={docForm.notes || ''} onChange={e => setDocForm({ ...docForm, notes: e.target.value })} /></div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-white/5">
          <button onClick={onClose} className="h-8 px-4 rounded-control text-xs font-light border border-slate-200 dark:border-white/10">取消</button>
          <button onClick={handleSubmit} disabled={submitting} className="h-8 px-4 rounded-control text-xs font-light bg-[var(--os-vnext-brand-blue)] text-white disabled:opacity-50 flex items-center gap-1.5">
            {submitting && <Loader2 size={12} className="animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomsManager;
