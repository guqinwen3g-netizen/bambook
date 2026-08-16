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
  Printer,
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
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { financeV2Service, type QuotationPricingResult } from '../services/financeV2Service';
import { TraceabilityPanel } from './TraceabilityPanel';
import { getExporterProfile } from './tools/exportDocs/exporterProfile';
import { Quotation, QuotationLine, QuotationStatus, QuotationInput, Relation, ProductAsset, FabricPriceHistory, TrackBResult, TrackAInput } from '../types';
import { PageHeader } from './ui/PageHeader';
import QuotationImportWizard from './import/QuotationImportWizard';
import { TrackAPanel } from './pricing/TrackAPanel';
import { TrackBPanel, type TrackBValidInputs } from './pricing/TrackBPanel';
import { DeviationBadge } from './pricing/DeviationBadge';
import { printHtmlDocument, escapeHtml } from './tools/printDocument';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { RelatedEntitiesPanel } from './RelatedEntitiesPanel';

// ==================== 常量 ====================
const STATUS_TABS: Array<{ id: 'all' | QuotationStatus; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'Draft', label: '草稿' },
  { id: 'Sent', label: '已发送' },
  { id: 'Accepted', label: '已接受' },
  { id: 'Rejected', label: '已拒绝' },
  { id: 'Expired', label: '已过期' },
];

const STATUS_LABELS: Record<QuotationStatus, string> = {
  Draft: '草稿',
  Sent: '已发送',
  Accepted: '已接受',
  Rejected: '已拒绝',
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
}

const createEmptyLine = (): DraftLine => ({
  key: newLineKey(),
  fabricCode: '',
  description: '',
  quantity: '',
  unit: 'YD',
  unitPrice: '',
  notes: '',
});

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

// ── 中英文报价单打印（复用共享 printHtmlDocument 版式；双轨快照属内部信息不打印）──
const buildQuotationPrintHtml = (qt: Quotation): string => {
  const lines = qt.lines ?? [];
  const currency = qt.currency || 'USD';
  const rows = lines.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml([l.fabricCode, l.description].filter(Boolean).join(' · '))}${l.notes ? `<div style="color:#718096;font-size:10px">${escapeHtml(l.notes)}</div>` : ''}</td>
      <td style="text-align:right">${Number(l.quantity).toLocaleString('en-US')}</td>
      <td>${escapeHtml(l.unit)}</td>
      <td style="text-align:right">${Number(l.unitPrice).toFixed(4)}</td>
      <td style="text-align:right">${Number(l.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>`).join('');
  return `
  <div class="doc-header">
    <div class="doc-title-block">
      <h1>QUOTATION</h1>
      <div class="subtitle">报 价 单</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${escapeHtml(qt.quotationNumber)}</div>
      <div>Date 报价日期: ${escapeHtml(qt.issueDate)}</div>
      ${qt.validUntil ? `<div>Valid Until 有效期至: ${escapeHtml(qt.validUntil)}</div>` : ''}
      ${qt.inquiryRef ? `<div>Inquiry Ref 询价参考: ${escapeHtml(qt.inquiryRef)}</div>` : ''}
    </div>
  </div>

  <div class="doc-party-grid">
    <div class="doc-party">
      <div class="label">From 报价方</div>
      <div class="name">${escapeHtml(getExporterProfile().nameEn)}</div>
      ${qt.salesperson ? `<div class="detail">Sales 业务员: ${escapeHtml(qt.salesperson)}</div>` : ''}
    </div>
    <div class="doc-party">
      <div class="label">To 致客户</div>
      <div class="name">${escapeHtml(qt.customerName || '—')}</div>
      ${qt.customerCode ? `<div class="detail">Code 客户编码: ${escapeHtml(qt.customerCode)}</div>` : ''}
    </div>
  </div>

  <table class="doc-table">
    <thead>
      <tr>
        <th style="width:36px">No.<br/>序号</th>
        <th>Description 品名描述</th>
        <th style="width:90px;text-align:right">Qty 数量</th>
        <th style="width:60px">Unit 单位</th>
        <th style="width:100px;text-align:right">Unit Price 单价 (${escapeHtml(currency)})</th>
        <th style="width:110px;text-align:right">Amount 金额 (${escapeHtml(currency)})</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5">TOTAL 总计 (${escapeHtml(currency)})</td>
        <td style="text-align:right">${Number(qt.totalAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    </tfoot>
  </table>

  <div class="doc-section">
    <div class="doc-section-title">Terms &amp; Conditions 条款</div>
    <div style="font-size:11px;line-height:1.8">
      ${qt.deliveryTerms ? `<div><strong>Delivery 交货:</strong> ${escapeHtml(qt.deliveryTerms)}</div>` : ''}
      ${qt.paymentTerms ? `<div><strong>Payment 付款:</strong> ${escapeHtml(qt.paymentTerms)}</div>` : ''}
      ${qt.validUntil ? `<div><strong>Validity 有效期:</strong> ${escapeHtml(qt.issueDate)} ~ ${escapeHtml(qt.validUntil)}</div>` : ''}
    </div>
  </div>

  ${qt.notes ? `
  <div class="doc-notes">
    <div class="notes-title">Remarks 备注</div>
    ${escapeHtml(qt.notes)}
  </div>` : ''}

  <div class="doc-footer">
    <div class="doc-signature">
      <div class="sig-label">Seller's Signature 卖方签章</div>
      <div class="sig-line"></div>
    </div>
    <div class="doc-signature">
      <div class="sig-label">Buyer's Confirmation 买方确认</div>
      <div class="sig-line"></div>
    </div>
  </div>`;
};

const QuotationManager: React.FC<QuotationManagerProps> = ({ isDarkMode, onOpenOrder }) => {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 阶段 IA-3：转单成功订单 id（成功横幅 + 「查看订单」直达）
  const [convertedOrderId, setConvertedOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | QuotationStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  // ── 阶段 P3c：历史报价导入向导（PRD 16.1/16.2）──
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [traceQuoteId, setTraceQuoteId] = useState<string | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);

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

  // ── 拉取数据 ──
  const fetchQuotations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listQuotations({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: searchQuery || undefined,
        limit: 100,
      });
      setQuotations(result.items);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => { fetchQuotations(); }, [fetchQuotations]);

  useEffect(() => {
    apiService.listRelations().then(setRelations).catch(() => {});
  }, []);

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
  const handleAction = useCallback(async (id: string, action: 'send' | 'accept' | 'reject' | 'delete' | 'convert') => {
    setActionLoading(`${id}_${action}`);
    setConvertedOrderId(null);
    try {
      if (action === 'send') await apiService.sendQuotation(id);
      else if (action === 'accept') await apiService.acceptQuotation(id);
      else if (action === 'reject') await apiService.rejectQuotation(id);
      else if (action === 'delete') await apiService.deleteQuotation(id);
      else if (action === 'convert') {
        const result = await apiService.convertQuotationToOrder(id);
        setConvertedOrderId(result.orderId);
      }
      await fetchQuotations();
    } catch (e: any) {
      setError(`操作失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [fetchQuotations]);

  // ── 生成形式发票 PI（Phase 1-04：从 Accepted 报价单生成 PI）──
  const handleGeneratePi = useCallback(async (id: string) => {
    setActionLoading(`${id}_generatePi`);
    try {
      const invoice = await financeV2Service.generatePi(id, {});
      setError(null);
      // 提示成功（不跳转，用户可在发票模块查看 PI）
      setConvertedOrderId(null);
      await fetchQuotations();
      // 用 convertedOrderId state 复用为 PI 编号展示
      setConvertedOrderId(`PI 已生成：${invoice.invoiceNumber}`);
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
        })),
      };
      await apiService.createQuotation(input);
      setShowCreateForm(false);
      // 重置表单（validUntil 重新取报价日 +30 天默认值）
      const today = new Date().toISOString().split('T')[0];
      setForm({
        quotationNumber: '', currency: 'USD', customerRelationId: '', customerName: '',
        issueDate: today, validUntil: defaultValidUntil(today),
        deliveryTerms: 'FOB Shanghai', paymentTerms: 'T/T 30% deposit, 70% before shipment',
        salesperson: '', inquiryRef: '', notes: '',
      });
      setFormLines([createEmptyLine()]);
      setTrackAMedian(null);
      setTrackBResult(null);
      await fetchQuotations();
    } catch (e: any) {
      setFormError(`创建失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [form, formLines, trackAMedian, trackBResult, fetchQuotations]);

  const updateFormLine = (key: string, field: keyof DraftLine, value: string) => {
    setFormLines(prev => prev.map(l => (l.key === key ? { ...l, [field]: value } : l)));
    if (field === 'fabricCode') searchFabricsForLine(key, value);
  };
  const addFormLine = () => setFormLines(prev => [...prev, createEmptyLine()]);
  const removeFormLine = (key: string) => setFormLines(prev => (prev.length > 1 ? prev.filter(l => l.key !== key) : prev));

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
      };
    }));
  }, []);

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
            <button onClick={() => setShowCreateForm(true)} className="bds-btn bds-btn-primary">
              <Plus size={14} /><span>新建报价单</span>
            </button>
          </>
        ) : undefined}
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <ScrollEdgeFades scrollRef={{ current: null }} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          <AnimatePresence mode="wait">
            {showCreateForm ? (
              <motion.div key="create-form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                {/* 创建表单 */}
                <div className="flex items-center justify-between mb-4">
                  <h2 className="bds-text-lg" style={{ color: 'var(--text-primary)' }}>新建报价单</h2>
                  <button onClick={() => setShowCreateForm(false)} className="bds-btn bds-btn-secondary">
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
                        <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="bds-select">
                          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>报价日期 *</label>
                        <input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value, validUntil: defaultValidUntil(e.target.value) })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>有效期至</label>
                        <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className="bds-input" />
                      </div>
                      <div>
                        <label className={labelCls}>客户</label>
                        <select value={form.customerRelationId} onChange={(e) => {
                          const rel = relations.find(r => r.id === e.target.value);
                          setForm({ ...form, customerRelationId: e.target.value, customerName: rel?.englishName || rel?.chineseName || '' });
                        }} className="bds-select">
                          <option value="">选择客户...</option>
                          {customerOptions.map(c => <option key={c.id} value={c.id}>{c.label} ({c.chineseName})</option>)}
                        </select>
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
                        <TrackAPanel onMedianUsdChange={(usd, unit) => setTrackAMedian(usd !== null && unit ? { usd, unit } : null)} />
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
                        <Plus size={12} /> 添加行
                      </button>
                    </div>
                    <div className="space-y-2">
                      {formLines.map((line) => (
                        <div key={line.key} className="p-3 rounded-inset bds-inset">
                          <div className="flex items-center justify-between mb-2">
                            <span className="bds-mono text-xs" style={{ color: 'var(--text-quaternary)' }}>行 {formLines.indexOf(line) + 1}</span>
                            {formLines.length > 1 && (
                              <button onClick={() => removeFormLine(line.key)} className="p-1 rounded transition-colors" style={{ color: 'var(--text-quaternary)' }}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
                            <div className="relative">
                              <input type="text" value={line.fabricCode} onChange={(e) => updateFormLine(line.key, 'fabricCode', e.target.value)} onBlur={() => setTimeout(() => setFabricSuggestions(prev => ({ ...prev, [line.key]: [] })), 150)} placeholder="面料编码（搜索档案）" className="bds-input sm" />
                              {fabricSearching[line.key] && (
                                <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
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
                            <input type="text" value={line.description} onChange={(e) => updateFormLine(line.key, 'description', e.target.value)} placeholder="品名描述 *" className="bds-input sm xl:col-span-2" />
                            <input type="number" value={line.quantity} onChange={(e) => updateFormLine(line.key, 'quantity', e.target.value)} placeholder="数量 *" className="bds-input sm" />
                            <select value={line.unit} onChange={(e) => updateFormLine(line.key, 'unit', e.target.value)} className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}>
                              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
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
                                    <AlertTriangle size={11} />
                                    偏离最近售价 {deviation > 0 ? '+' : ''}{Math.round(deviation * 100)}%（&gt;15%，将触发审批）
                                  </span>
                                )}
                              </div>
                            );
                          })()}
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

                  <button onClick={handleCreate} disabled={actionLoading === 'create'} className="bds-btn bds-btn-primary lg w-full">
                    {actionLoading === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    <span>创建报价单</span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                {/* 工具栏：过滤控件组合 → filterbar 玻璃条（主操作已收编 PageHeader） */}
                <div className="bds-filterbar mb-4">
                  <div className="relative flex-1 max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索报价号/客户..." className="bds-input sm pl-9" />
                  </div>
                  <button onClick={fetchQuotations} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>

                {/* 状态过滤 */}
                <div className="bds-segment mb-4">
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
                  </div>
                )}

                {/* 阶段 IA-3：转单成功横幅 —— 「查看订单」直达跳转 */}
                {convertedOrderId && (
                  <div className="bds-alert success mb-3">
                    <CheckCircle2 size={16} />
                    <span className="flex-1 min-w-0 truncate">已转为订单 {convertedOrderId}</span>
                    {onOpenOrder && (
                      <button
                        type="button"
                        onClick={() => onOpenOrder(convertedOrderId)}
                        className="flex items-center gap-1 shrink-0 hover:underline"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                      >
                        查看订单 <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                )}

                {/* 列表 */}
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                  </div>
                ) : quotations.length === 0 ? (
                  <div className="bds-empty">
                    <div className="glyph"><FileText size={24} /></div>
                    <div className="title">暂无报价单</div>
                    <div className="desc">点击「新建报价单」开始，或导入历史报价</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {quotations.map((qt, index) => (
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
                                  <AlertTriangle size={10} />
                                  偏差 {(qt.priceDeviationPercent ?? 0) > 0 ? '+' : ''}{qt.priceDeviationPercent}% · 已触发审批
                                </span>
                              )}
                              {qt.priceDeviationLevel === 'block' && (
                                <span className="bds-badge sm danger">
                                  <AlertCircle size={10} />
                                  偏差 {(qt.priceDeviationPercent ?? 0) > 0 ? '+' : ''}{qt.priceDeviationPercent}% · 需审批后发送
                                </span>
                              )}
                              {/* Sent 超 7 天未回复 → 琥珀提醒（sentAt 为首次发送时间） */}
                              {sentDaysPending(qt) != null && (
                                <span className="bds-badge sm warning">
                                  <AlertTriangle size={10} />
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
                                  {qt.status === 'Draft' && (
                                    <>
                                      <button
                                        onClick={() => { setPricingQuoteId(qt.id); setPricingResult(null); }}
                                        className="bds-btn bds-btn-secondary"
                                      >
                                        <Calculator size={12} />
                                        <span>应用定价</span>
                                      </button>
                                      <button onClick={() => handleAction(qt.id, 'send')} disabled={actionLoading === `${qt.id}_send`} className="bds-btn bds-btn-secondary">
                                        {actionLoading === `${qt.id}_send` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                        <span>发送报价</span>
                                      </button>
                                      {/* 双轨红标门禁提示（PRD 8.6）：偏差 >30% 需审批通过后服务端才放行发送 */}
                                      {qt.priceDeviationLevel === 'block' && (
                                        <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--danger-text)' }}>
                                          <AlertCircle size={10} />
                                          偏差超 30%，需审批通过后发送
                                        </span>
                                      )}
                                      <button onClick={() => handleAction(qt.id, 'delete')} disabled={actionLoading === `${qt.id}_delete`} className="bds-btn bds-btn-danger">
                                        {actionLoading === `${qt.id}_delete` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                        <span>删除</span>
                                      </button>
                                    </>
                                  )}
                                  {qt.status === 'Sent' && (
                                    <>
                                      <button onClick={() => handleAction(qt.id, 'accept')} disabled={actionLoading === `${qt.id}_accept`} className="bds-btn bds-btn-secondary">
                                        {actionLoading === `${qt.id}_accept` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                        <span>接受</span>
                                      </button>
                                      <button onClick={() => handleAction(qt.id, 'reject')} disabled={actionLoading === `${qt.id}_reject`} className="bds-btn bds-btn-danger">
                                        {actionLoading === `${qt.id}_reject` ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                        <span>拒绝</span>
                                      </button>
                                    </>
                                  )}
                                  {(qt.status === 'Accepted' || qt.status === 'Rejected' || qt.status === 'Expired') && (
                                    <>
                                      {qt.status === 'Accepted' && !qt.convertedOrderId && (
                                        <button
                                          onClick={() => handleAction(qt.id, 'convert')}
                                          disabled={actionLoading === `${qt.id}_convert`}
                                          className="bds-btn bds-btn-secondary"
                                        >
                                          {actionLoading === `${qt.id}_convert` ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                                          <span>转为订单</span>
                                        </button>
                                      )}
                                      {qt.status === 'Accepted' && (
                                        <button
                                          onClick={() => handleGeneratePi(qt.id)}
                                          disabled={actionLoading === `${qt.id}_generatePi`}
                                          className="bds-btn bds-btn-secondary"
                                        >
                                          {actionLoading === `${qt.id}_generatePi` ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                                          <span>生成 PI</span>
                                        </button>
                                      )}
                                      <button
                                        onClick={() => setTraceQuoteId(qt.id)}
                                        className="bds-btn bds-btn-secondary"
                                      >
                                        <GitBranch size={12} />
                                        <span>溯源</span>
                                      </button>
                                      {qt.status === 'Accepted' && qt.convertedOrderId && (
                                        <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                                          <CheckCircle2 size={12} />
                                          <span>已转订单</span>
                                          {onOpenOrder ? (
                                            <button
                                              type="button"
                                              onClick={() => onOpenOrder(qt.convertedOrderId!)}
                                              className="flex items-center gap-0.5 hover:underline"
                                              style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--accent-text)' }}
                                            >
                                              {qt.convertedOrderId} <ArrowRight size={10} />
                                            </button>
                                          ) : (
                                            <span>{qt.convertedOrderId}</span>
                                          )}
                                        </div>
                                      )}
                                      {(qt.status === 'Rejected' || qt.status === 'Expired') && (
                                        <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-quaternary)' }}>
                                          <Clock size={12} />
                                          <span>{STATUS_LABELS[qt.status as QuotationStatus]} — 终态</span>
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {/* 打印中英文报价单（全状态可用；复用共享打印版式） */}
                                  <button
                                    type="button"
                                    onClick={() => printHtmlDocument({ title: `Quotation ${qt.quotationNumber}`, htmlBody: buildQuotationPrintHtml(qt) })}
                                    className="bds-btn bds-btn-ghost"
                                  >
                                    <Printer size={12} />
                                    <span>打印报价单</span>
                                  </button>
                                </div>
                                <RelatedEntitiesPanel
                                  type="quotation"
                                  id={qt.id}
                                  isDarkMode={isDarkMode}
                                  title="报价关联视图"
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
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
        isDarkMode={isDarkMode}
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
                {applyingPricing ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                <span>查询校验</span>
              </button>
              <button
                onClick={handleApplyPricing}
                disabled={applyingPricing || !pricingTrackB}
                className="bds-btn bds-btn-primary"
              >
                {applyingPricing ? <Loader2 size={12} className="animate-spin" /> : <Calculator size={12} />}
                <span>{applyingPricing ? '计算中...' : '应用定价'}</span>
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
                  <GitBranch size={15} style={{ color: 'var(--text-tertiary)' }} />
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
                <X size={15} />
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
    </div>
  );
};

export default QuotationManager;
