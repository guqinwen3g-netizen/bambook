/**
 * 定价与利润 PricingManager
 * 阶段 P1：定价与利润前端（PRD 8 双轨制）
 *
 * 功能：
 *   1. 定价计算器 Calculator — 轨道 B（退税美元定价）试算：HS Code 查退税率、
 *      最新汇率一键带入、实时预览（派生值服务端重算）、保存定价记录、记录状态流转
 *   2. 利润表 Profit Sheets — 订单级利润表生成/查看：收入·采购·运费·杂费四维聚合、
 *      毛利与毛利率、未折算明细透明披露
 *   3. 退税率 Tax Rates — HS Code 退税率表 CRUD + 最长前缀命中测试
 *   4. 价格历史 Price History — 原材料价格（纱线/面料/辅料）CRUD + 趋势视图，
 *      为轨道 A 估算提供校准数据源
 *
 * 设计原则：
 *   - 轨道 B 派生值（netUsdCost / finalUnitPrice 等）一律以后端返回为准，前端不做本地计算
 *   - RDL flat 设计：statusSemanticClass 中性色阶，无阴影，大圆角
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calculator,
  Receipt,
  Percent,
  History,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  X,
  Check,
  Archive,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Order,
  TaxRefundRate,
  TaxRefundRateInput,
  TrackBResult,
  PricingCalculation,
  PricingCalculationStatus,
  OrderProfitSheet,
  MaterialPriceHistory,
  MaterialPriceInput,
  MaterialPriceTrendPoint,
  MaterialPriceType,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { statusSemanticClass, StatusSemantic } from './rdlBusinessStatusTokens';

// ==================== 常量 ====================

type ModuleTab = 'calculator' | 'profitSheets' | 'taxRates' | 'priceHistory';

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'calculator', label: '定价计算器 Calculator', icon: Calculator },
  { id: 'profitSheets', label: '利润表 Profit Sheets', icon: Receipt },
  { id: 'taxRates', label: '退税率 Tax Rates', icon: Percent },
  { id: 'priceHistory', label: '价格历史 Price History', icon: History },
];

const CALC_STATUS_LABELS: Record<PricingCalculationStatus, string> = {
  Draft: '草稿',
  Confirmed: '已确认',
  Archived: '已归档',
};

const CALC_STATUS_SEMANTIC: Record<PricingCalculationStatus, StatusSemantic> = {
  Draft: 'neutral',
  Confirmed: 'success',
  Archived: 'neutral',
};

const MATERIAL_TYPE_LABELS: Record<MaterialPriceType, string> = {
  yarn: '纱线',
  fabric: '面料',
  trimming: '辅料',
};

const MATERIAL_SOURCE_LABELS: Record<string, string> = {
  manual: '手工录入',
  'purchase-order': '采购单',
  quotation: '报价单',
};

const RATE_SOURCE_LABELS: Record<string, string> = {
  snapshot: '快照汇率',
  base: '本位币',
  'latest-rate': '最新汇率',
};

function formatTs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatMoney(value: number | null | undefined, currency = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const text = value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return currency ? `${currency} ${text}` : text;
}

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD（本地时区）
}

function parseNum(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? n : null;
}

// ==================== 共享样式 ====================

const inputClass = "w-full bg-surface-primary text-text-primary text-sm rounded-control px-3 py-2 border border-border-subtle outline-none focus:border-border-action";
const actionButtonClass = "flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-text-tertiary mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-surface-elevated rounded-panel w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ==================== 组件 Props ====================

interface PricingManagerProps {
  isDarkMode?: boolean;
}

// ==================== 主组件 ====================

export default function PricingManager({ isDarkMode }: PricingManagerProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>('calculator');

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="定价与利润" subtitle="Pricing & Profit" />

      {/* 模块 Tab 栏 */}
      <div className="px-7 flex items-center gap-1 border-b border-border-subtle shrink-0">
        {MODULE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-control transition-colors ${
                isActive
                  ? 'text-text-primary bg-surface-elevated border-b-2 border-border-action'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 内容（切换即重挂载，保证数据新鲜） */}
      <div className="flex-1 min-h-0 px-7 py-5 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="h-full min-h-0"
          >
            {activeTab === 'calculator' && <CalculatorPanel isDarkMode={isDarkMode} />}
            {activeTab === 'profitSheets' && <ProfitSheetsPanel isDarkMode={isDarkMode} />}
            {activeTab === 'taxRates' && <TaxRatesPanel isDarkMode={isDarkMode} />}
            {activeTab === 'priceHistory' && <PriceHistoryPanel isDarkMode={isDarkMode} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 定价计算器 Panel ====================

function CalculatorPanel(_props: { isDarkMode?: boolean }) {
  const [purchaseCostCny, setPurchaseCostCny] = useState('');
  const [hsCode, setHsCode] = useState('');
  const [refundRate, setRefundRate] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [profitMargin, setProfitMargin] = useState('');
  const [commissionRate, setCommissionRate] = useState('0');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');

  const [preview, setPreview] = useState<TrackBResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lookupHint, setLookupHint] = useState<string | null>(null);

  const [records, setRecords] = useState<PricingCalculation[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      setRecords(await apiService.listPricingCalculations());
    } catch (e) {
      console.error('[PricingManager] listPricingCalculations failed', e);
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const validInput = useMemo(() => {
    const cost = parseNum(purchaseCostCny);
    const refund = parseNum(refundRate);
    const fx = parseNum(exchangeRate);
    const margin = parseNum(profitMargin);
    if (cost === null || cost <= 0) return null;
    if (refund === null || refund < 0) return null;
    if (fx === null || fx <= 0) return null;
    if (margin === null) return null;
    return { cost, refund, fx, margin, commission: parseNum(commissionRate) ?? 0 };
  }, [purchaseCostCny, refundRate, exchangeRate, profitMargin, commissionRate]);

  const handleLookupRate = async () => {
    const code = hsCode.trim();
    if (!code) {
      alert('请输入 HS Code');
      return;
    }
    setLookupHint(null);
    try {
      const hit = await apiService.lookupTaxRefundRate(code);
      if (hit) {
        setRefundRate(String(hit.rate));
        setLookupHint(`命中 HS ${hit.hsCode}，退税率 ${hit.rate}%`);
      } else {
        setLookupHint('未命中退税率，请手工录入');
      }
    } catch (e) {
      console.error('[PricingManager] lookupTaxRefundRate failed', e);
      setLookupHint('查询失败，请手工录入');
    }
  };

  const handleFetchLatestFx = async () => {
    try {
      const rates = await apiService.getLatestFxRates();
      const usd = rates.find((r) => r.currency === 'USD');
      if (usd) {
        setExchangeRate(String(usd.rate));
      } else {
        alert('未找到 USD 最新汇率');
      }
    } catch (e) {
      console.error('[PricingManager] getLatestFxRates failed', e);
      alert('获取最新汇率失败');
    }
  };

  const handlePreview = async () => {
    if (!validInput) {
      alert('请完整填写采购成本 / 退税率 / 汇率 / 利润率');
      return;
    }
    setPreviewing(true);
    try {
      const result = await apiService.previewTrackB({
        purchaseCostCny: validInput.cost,
        refundRate: validInput.refund,
        exchangeRate: validInput.fx,
        profitMargin: validInput.margin,
        commissionRate: validInput.commission,
      });
      setPreview(result);
    } catch (e) {
      console.error('[PricingManager] previewTrackB failed', e);
      alert(`试算失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!validInput) {
      alert('请完整填写采购成本 / 退税率 / 汇率 / 利润率');
      return;
    }
    setSaving(true);
    try {
      await apiService.createPricingCalculation({
        purchaseCostCny: validInput.cost,
        refundRate: validInput.refund,
        exchangeRate: validInput.fx,
        profitMargin: validInput.margin,
        commissionRate: validInput.commission,
        hsCode: hsCode.trim() || null,
        quantity: parseNum(quantity),
        notes: notes.trim() || null,
      });
      setNotes('');
      await loadRecords();
    } catch (e) {
      console.error('[PricingManager] createPricingCalculation failed', e);
      alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePatchStatus = async (id: string, status: PricingCalculationStatus) => {
    setUpdatingId(id);
    try {
      await apiService.updatePricingCalculation(id, { status });
      await loadRecords();
    } catch (e) {
      console.error('[PricingManager] updatePricingCalculation failed', e);
      alert(`状态更新失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该定价记录？')) return;
    setUpdatingId(id);
    try {
      await apiService.deletePricingCalculation(id);
      await loadRecords();
    } catch (e) {
      console.error('[PricingManager] deletePricingCalculation failed', e);
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* 左：试算表单 */}
      <div className="bg-surface-elevated rounded-card p-5">
        <h3 className="text-sm font-medium text-text-primary mb-4">轨道 B 试算（退税美元定价）</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="采购成本（CNY 单价）">
            <input className={inputClass} value={purchaseCostCny} onChange={(e) => { setPurchaseCostCny(e.target.value); setPreview(null); }} placeholder="如 32.50" inputMode="decimal" />
          </Field>
          <Field label="HS Code（可查退税率）">
            <div className="flex gap-2">
              <input className={inputClass} value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="如 5407520000" />
              <button onClick={handleLookupRate} className={actionButtonClass} title="按最长前缀命中退税率">
                <Search className="w-3.5 h-3.5" />
                查税率
              </button>
            </div>
          </Field>
          <Field label="退税率（%）">
            <input className={inputClass} value={refundRate} onChange={(e) => { setRefundRate(e.target.value); setPreview(null); }} placeholder="如 13" inputMode="decimal" />
          </Field>
          <Field label="汇率（CNY/USD）">
            <div className="flex gap-2">
              <input className={inputClass} value={exchangeRate} onChange={(e) => { setExchangeRate(e.target.value); setPreview(null); }} placeholder="如 7.10" inputMode="decimal" />
              <button onClick={handleFetchLatestFx} className={actionButtonClass} title="带入最新 USD 汇率">
                <RefreshCw className="w-3.5 h-3.5" />
                最新
              </button>
            </div>
          </Field>
          <Field label="利润率（%）">
            <input className={inputClass} value={profitMargin} onChange={(e) => { setProfitMargin(e.target.value); setPreview(null); }} placeholder="如 15" inputMode="decimal" />
          </Field>
          <Field label="佣金率（%，0=无）">
            <input className={inputClass} value={commissionRate} onChange={(e) => { setCommissionRate(e.target.value); setPreview(null); }} placeholder="0 / 5 / 10" inputMode="decimal" />
          </Field>
          <Field label="数量（可选）">
            <input className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="如 800" inputMode="decimal" />
          </Field>
          <Field label="备注（可选）">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="定价说明" />
          </Field>
        </div>
        {lookupHint && <p className="text-xs text-text-tertiary mb-3">{lookupHint}</p>}

        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={handlePreview}
            disabled={previewing || !validInput}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-control bg-surface-primary text-text-primary border border-border-action hover:bg-surface-secondary transition-colors disabled:opacity-50"
          >
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
            试算预览
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !validInput}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            保存定价记录
          </button>
        </div>

        {/* 试算结果（服务端重算值） */}
        {preview && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-surface-primary rounded-inset p-3">
              <p className="text-xs text-text-tertiary">退税后美元成本</p>
              <p className="text-lg font-medium text-text-primary">${preview.netUsdCost.toFixed(4)}</p>
            </div>
            <div className="bg-surface-primary rounded-inset p-3">
              <p className="text-xs text-text-tertiary">利润额</p>
              <p className="text-lg font-medium text-text-primary">${preview.profitAmount.toFixed(4)}</p>
            </div>
            <div className="bg-surface-primary rounded-inset p-3">
              <p className="text-xs text-text-tertiary">佣金额</p>
              <p className="text-lg font-medium text-text-primary">${preview.commissionAmount.toFixed(4)}</p>
            </div>
            <div className="bg-surface-primary rounded-inset p-3 border border-border-action">
              <p className="text-xs text-text-tertiary">终价美元单价</p>
              <p className="text-lg font-medium text-text-primary">${preview.finalUnitPrice.toFixed(4)}</p>
            </div>
          </div>
        )}
      </div>

      {/* 右：定价记录 */}
      <div className="bg-surface-elevated rounded-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-text-primary">定价记录</h3>
          <button onClick={loadRecords} className={actionButtonClass}>
            <RefreshCw className="w-3.5 h-3.5" />
            刷新
          </button>
        </div>
        {recordsLoading ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <EmptyHint text="暂无定价记录" />
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {records.map((rec) => (
              <div key={rec.id} className="bg-surface-primary rounded-inset p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary truncate">
                      终价 ${rec.finalUnitPrice.toFixed(4)}
                      <span className="text-text-tertiary"> · 成本 ¥{rec.purchaseCostCny.toFixed(2)} · 退税 {rec.refundRate}% · 汇率 {rec.exchangeRate}</span>
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      利润率 {rec.profitMargin}%{rec.commissionRate ? ` · 佣金 ${rec.commissionRate}%` : ''}{rec.hsCode ? ` · HS ${rec.hsCode}` : ''}{rec.quantity ? ` · 数量 ${rec.quantity}` : ''} · {formatTs(rec.createdAt)}
                    </p>
                    {rec.notes && <p className="text-xs text-text-tertiary mt-0.5 truncate">{rec.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-2 py-0.5 text-xs rounded-control ${statusSemanticClass(CALC_STATUS_SEMANTIC[rec.status])}`}>
                      {CALC_STATUS_LABELS[rec.status]}
                    </span>
                    {rec.status === 'Draft' && (
                      <button onClick={() => handlePatchStatus(rec.id, 'Confirmed')} disabled={updatingId === rec.id} className={actionButtonClass} title="确认定价">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {rec.status !== 'Archived' && (
                      <button onClick={() => handlePatchStatus(rec.id, 'Archived')} disabled={updatingId === rec.id} className={actionButtonClass} title="归档">
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => handleDelete(rec.id)} disabled={updatingId === rec.id} className={actionButtonClass} title="删除">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 利润表 Panel ====================

function ProfitSheetsPanel(_props: { isDarkMode?: boolean }) {
  const [sheets, setSheets] = useState<OrderProfitSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<OrderProfitSheet | null>(null);
  const [generating, setGenerating] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [orderQuery, setOrderQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const loadSheets = useCallback(async () => {
    setLoading(true);
    try {
      setSheets(await apiService.listProfitSheets());
    } catch (e) {
      console.error('[PricingManager] listProfitSheets failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSheets();
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listOrders();
        if (!cancelled) setOrders(list.filter((o) => !o.deletedAt));
      } catch (e) {
        console.error('[PricingManager] load orders failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [loadSheets]);

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    if (!q) return [];
    return orders
      .filter((o) =>
        (o.poNumber || '').toLowerCase().includes(q)
        || (o.customer || '').toLowerCase().includes(q)
        || (o.product || '').toLowerCase().includes(q)
        || o.id.toLowerCase().includes(q))
      .slice(0, 10);
  }, [orders, orderQuery]);

  const handleGenerate = async () => {
    if (!selectedOrder) {
      alert('请搜索并选择订单');
      return;
    }
    setGenerating(true);
    try {
      const sheet = await apiService.generateProfitSheet(selectedOrder.id);
      setCurrent(sheet);
      await loadSheets();
    } catch (e) {
      console.error('[PricingManager] generateProfitSheet failed', e);
      alert(`生成失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleView = async (orderId: string) => {
    try {
      const sheet = await apiService.getProfitSheetByOrder(orderId);
      if (sheet) setCurrent(sheet);
    } catch (e) {
      console.error('[PricingManager] getProfitSheetByOrder failed', e);
    }
  };

  const handleDelete = async (orderId: string) => {
    if (!confirm('确认删除该订单利润表？')) return;
    try {
      await apiService.deleteProfitSheet(orderId);
      if (current?.orderId === orderId) setCurrent(null);
      await loadSheets();
    } catch (e) {
      console.error('[PricingManager] deleteProfitSheet failed', e);
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
      {/* 左：生成 + 列表 */}
      <div className="xl:col-span-2 space-y-4">
        <div className="bg-surface-elevated rounded-card p-5">
          <h3 className="text-sm font-medium text-text-primary mb-3">生成 / 重新生成利润表</h3>
          <Field label="订单（搜索 PO / 客户 / 产品）">
            <input
              className={inputClass}
              value={orderQuery}
              onChange={(e) => { setOrderQuery(e.target.value); setSelectedOrder(null); }}
              placeholder="输入关键字搜索订单"
            />
          </Field>
          {filteredOrders.length > 0 && !selectedOrder && (
            <div className="mb-3 bg-surface-primary rounded-inset max-h-48 overflow-y-auto">
              {filteredOrders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => { setSelectedOrder(o); setOrderQuery(`${o.poNumber || o.id} · ${o.customer || ''}`); }}
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary transition-colors"
                >
                  {o.poNumber || o.id} · {o.customer || '—'} · {o.product || '—'}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedOrder}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-control bg-surface-primary text-text-primary border border-border-action hover:bg-surface-secondary transition-colors disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
            生成利润表
          </button>
        </div>

        <div className="bg-surface-elevated rounded-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary">已生成利润表</h3>
            <button onClick={loadSheets} className={actionButtonClass}>
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-text-tertiary">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : sheets.length === 0 ? (
            <EmptyHint text="暂无利润表" />
          ) : (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {sheets.map((s) => (
                <div key={s.id} className="bg-surface-primary rounded-inset p-3 flex items-center justify-between gap-2">
                  <button onClick={() => handleView(s.orderId)} className="min-w-0 text-left">
                    <p className="text-sm text-text-primary truncate">订单 {s.orderId}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      毛利 {formatMoney(s.grossProfit, s.baseCurrency)}{s.grossMargin !== null && s.grossMargin !== undefined ? ` · 毛利率 ${s.grossMargin.toFixed(2)}%` : ''} · v{s.version} · {formatTs(s.generatedAt)}
                    </p>
                  </button>
                  <button onClick={() => handleDelete(s.orderId)} className={`${actionButtonClass} shrink-0`} title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右：利润表详情 */}
      <div className="xl:col-span-3">
        {current ? (
          <ProfitSheetDetail sheet={current} />
        ) : (
          <div className="bg-surface-elevated rounded-card p-5 h-full flex items-center justify-center">
            <EmptyHint text="选择左侧订单生成利润表，或点击已生成记录查看详情" />
          </div>
        )}
      </div>
    </div>
  );
}

function ProfitSheetDetail({ sheet }: { sheet: OrderProfitSheet }) {
  const d = sheet.details;
  return (
    <div className="bg-surface-elevated rounded-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">订单 {sheet.orderId} 利润表</h3>
        <span className="text-xs text-text-tertiary">v{sheet.version} · 生成于 {formatTs(sheet.generatedAt)}</span>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-surface-primary rounded-inset p-3">
          <p className="text-xs text-text-tertiary">销售收入</p>
          <p className="text-base font-medium text-text-primary">{formatMoney(sheet.salesRevenue, sheet.baseCurrency)}</p>
        </div>
        <div className="bg-surface-primary rounded-inset p-3">
          <p className="text-xs text-text-tertiary">采购成本</p>
          <p className="text-base font-medium text-text-primary">{formatMoney(sheet.purchaseCost, sheet.baseCurrency)}</p>
        </div>
        <div className="bg-surface-primary rounded-inset p-3">
          <p className="text-xs text-text-tertiary">运费</p>
          <p className="text-base font-medium text-text-primary">{formatMoney(sheet.freightCost, sheet.baseCurrency)}</p>
        </div>
        <div className="bg-surface-primary rounded-inset p-3">
          <p className="text-xs text-text-tertiary">杂费</p>
          <p className="text-base font-medium text-text-primary">{formatMoney(sheet.miscCost, sheet.baseCurrency)}</p>
        </div>
        <div className="bg-surface-primary rounded-inset p-3 border border-border-action">
          <p className="text-xs text-text-tertiary">毛利</p>
          <p className="text-base font-medium text-text-primary">{formatMoney(sheet.grossProfit, sheet.baseCurrency)}</p>
        </div>
        <div className="bg-surface-primary rounded-inset p-3 border border-border-action">
          <p className="text-xs text-text-tertiary">毛利率</p>
          <p className="text-base font-medium text-text-primary">
            {sheet.grossMargin !== null && sheet.grossMargin !== undefined ? `${sheet.grossMargin.toFixed(2)}%` : '—'}
          </p>
        </div>
      </div>

      {/* 明细分组 */}
      {([
        ['销售收入', d.sales],
        ['采购成本', d.purchases],
        ['运费', d.freight],
        ['杂费', d.misc],
      ] as Array<[string, typeof d.sales]>).map(([title, lines]) => (
        <div key={title}>
          <p className="text-xs font-medium text-text-secondary mb-1.5">{title}（{lines.length}）</p>
          {lines.length === 0 ? (
            <p className="text-xs text-text-tertiary">无明细</p>
          ) : (
            <div className="bg-surface-primary rounded-inset divide-y divide-border-subtle">
              {lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="text-text-secondary truncate">{line.label}</span>
                  <span className="text-text-tertiary shrink-0 ml-3">
                    {formatMoney(line.amount, line.currency)} × {line.rate}（{RATE_SOURCE_LABELS[line.rateSource] || line.rateSource}）
                    <span className="text-text-primary ml-2">= {formatMoney(line.cnyAmount, sheet.baseCurrency)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 未折算明细 */}
      {d.unconverted.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">未折算明细（缺汇率，未计入汇总）</p>
          <div className="bg-surface-primary rounded-inset divide-y divide-border-subtle border border-border-action">
            {d.unconverted.map((line) => (
              <div key={line.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="text-text-secondary truncate">{line.label}</span>
                <span className="text-text-tertiary shrink-0 ml-3">
                  {formatMoney(line.amount, line.currency)} · {line.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 退税率 Panel ====================

function TaxRatesPanel(_props: { isDarkMode?: boolean }) {
  const [items, setItems] = useState<TaxRefundRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaxRefundRate | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [testCode, setTestCode] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiService.listTaxRefundRates(includeInactive));
    } catch (e) {
      console.error('[PricingManager] listTaxRefundRates failed', e);
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTest = async () => {
    const code = testCode.trim();
    if (!code) return;
    setTestResult(null);
    try {
      const hit = await apiService.lookupTaxRefundRate(code);
      setTestResult(hit ? `命中 HS ${hit.hsCode}，退税率 ${hit.rate}%` : '未命中（已尝试 10/8/6/4/2 位前缀）');
    } catch (e) {
      console.error('[PricingManager] lookupTaxRefundRate failed', e);
      setTestResult('查询失败');
    }
  };

  const handleToggleActive = async (item: TaxRefundRate) => {
    setUpdatingId(item.id);
    try {
      await apiService.updateTaxRefundRate(item.id, { isActive: !item.isActive });
      await load();
    } catch (e) {
      console.error('[PricingManager] updateTaxRefundRate failed', e);
      alert(`更新失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该退税率？')) return;
    setUpdatingId(id);
    try {
      await apiService.deleteTaxRefundRate(id);
      await load();
    } catch (e) {
      console.error('[PricingManager] deleteTaxRefundRate failed', e);
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* 命中测试 */}
      <div className="bg-surface-elevated rounded-card p-5">
        <h3 className="text-sm font-medium text-text-primary mb-3">最长前缀命中测试</h3>
        <div className="flex items-center gap-2 max-w-lg">
          <input className={inputClass} value={testCode} onChange={(e) => { setTestCode(e.target.value); setTestResult(null); }} placeholder="输入完整 HS Code，如 5407520000" />
          <button onClick={handleTest} className={actionButtonClass}>
            <Search className="w-3.5 h-3.5" />
            测试
          </button>
        </div>
        {testResult && <p className="text-xs text-text-tertiary mt-2">{testResult}</p>}
      </div>

      {/* 退税率表 */}
      <div className="bg-surface-elevated rounded-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-medium text-text-primary">退税率表</h3>
            <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              显示已停用
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className={actionButtonClass}>
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
            <button
              onClick={() => { setEditing(null); setShowForm(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-control bg-surface-primary text-text-primary border border-border-action hover:bg-surface-secondary transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              新增退税率
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <EmptyHint text="暂无退税率记录" />
        ) : (
          <div className="bg-surface-primary rounded-inset divide-y divide-border-subtle">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-text-tertiary">
              <span className="col-span-2">HS Code</span>
              <span className="col-span-2">退税率</span>
              <span className="col-span-4">说明</span>
              <span className="col-span-2">状态</span>
              <span className="col-span-2 text-right">操作</span>
            </div>
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center">
                <span className="col-span-2 text-text-primary font-mono">{item.hsCode}</span>
                <span className="col-span-2 text-text-primary">{item.rate}%</span>
                <span className="col-span-4 text-text-secondary truncate">{item.description || '—'}</span>
                <span className="col-span-2">
                  <button
                    onClick={() => handleToggleActive(item)}
                    disabled={updatingId === item.id}
                    className={`px-2 py-0.5 rounded-control ${statusSemanticClass(item.isActive ? 'success' : 'neutral')}`}
                    title="点击切换启停"
                  >
                    {item.isActive ? '启用' : '停用'}
                  </button>
                </span>
                <span className="col-span-2 flex items-center justify-end gap-1.5">
                  <button onClick={() => { setEditing(item); setShowForm(true); }} disabled={updatingId === item.id} className={actionButtonClass} title="编辑">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={updatingId === item.id} className={actionButtonClass} title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <TaxRateForm
            editing={editing}
            onSave={async (input) => {
              try {
                if (editing) {
                  await apiService.updateTaxRefundRate(editing.id, { rate: input.rate, description: input.description, isActive: input.isActive });
                } else {
                  await apiService.createTaxRefundRate(input);
                }
                setShowForm(false);
                await load();
              } catch (e) {
                console.error('[PricingManager] saveTaxRefundRate failed', e);
                alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
              }
            }}
            onClose={() => setShowForm(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TaxRateForm({
  editing,
  onSave,
  onClose,
}: {
  editing: TaxRefundRate | null;
  onSave: (input: TaxRefundRateInput) => void;
  onClose: () => void;
}) {
  const [hsCode, setHsCode] = useState(editing?.hsCode || '');
  const [rate, setRate] = useState(editing ? String(editing.rate) : '');
  const [description, setDescription] = useState(editing?.description || '');

  const handleSubmit = () => {
    const r = parseNum(rate);
    if (!editing && !/^\d{2}(\d{2}){0,4}$/.test(hsCode.trim())) {
      alert('HS Code 须为 2/4/6/8/10 位数字');
      return;
    }
    if (r === null || r < 0 || r > 100) {
      alert('退税率须在 0-100 之间');
      return;
    }
    onSave({
      hsCode: hsCode.trim(),
      rate: r,
      description: description.trim() || null,
      isActive: editing?.isActive ?? true,
    });
  };

  return (
    <ModalShell title={editing ? `编辑退税率 HS ${editing.hsCode}` : '新增退税率'} onClose={onClose}>
      <Field label="HS Code（2/4/6/8/10 位）">
        <input className={inputClass} value={hsCode} onChange={(e) => setHsCode(e.target.value)} disabled={!!editing} placeholder="如 5407" />
      </Field>
      <Field label="退税率（%）">
        <input className={inputClass} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="如 13" inputMode="decimal" />
      </Field>
      <Field label="说明（可选）">
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="如 化纤梭织面料" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className={actionButtonClass}>取消</button>
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-control bg-surface-primary text-text-primary border border-border-action hover:bg-surface-secondary transition-colors"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ==================== 价格历史 Panel ====================

function PriceHistoryPanel(_props: { isDarkMode?: boolean }) {
  const [items, setItems] = useState<MaterialPriceHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<MaterialPriceType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MaterialPriceHistory | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [trend, setTrend] = useState<MaterialPriceTrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiService.listMaterialPrices({
        materialType: typeFilter || undefined,
        from: from || undefined,
        to: to || undefined,
      }));
    } catch (e) {
      console.error('[PricingManager] listMaterialPrices failed', e);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, from, to]);

  const loadTrend = useCallback(async () => {
    if (!typeFilter) {
      setTrend([]);
      return;
    }
    setTrendLoading(true);
    try {
      setTrend(await apiService.getMaterialPriceTrend({
        materialType: typeFilter,
        from: from || undefined,
        to: to || undefined,
      }));
    } catch (e) {
      console.error('[PricingManager] getMaterialPriceTrend failed', e);
      setTrend([]);
    } finally {
      setTrendLoading(false);
    }
  }, [typeFilter, from, to]);

  useEffect(() => {
    load();
    loadTrend();
  }, [load, loadTrend]);

  const trendBounds = useMemo(() => {
    if (trend.length === 0) return null;
    const prices = trend.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return { min, max, span: max - min };
  }, [trend]);

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该价格记录？')) return;
    setUpdatingId(id);
    try {
      await apiService.deleteMaterialPrice(id);
      await load();
      await loadTrend();
    } catch (e) {
      console.error('[PricingManager] deleteMaterialPrice failed', e);
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* 筛选 + 趋势 */}
      <div className="bg-surface-elevated rounded-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-text-tertiary mb-1">材料类型</label>
            <select className={inputClass} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as MaterialPriceType | '')}>
              <option value="">全部</option>
              <option value="yarn">纱线</option>
              <option value="fabric">面料</option>
              <option value="trimming">辅料</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-tertiary mb-1">起始日期</label>
            <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} max={todayLocal()} />
          </div>
          <div>
            <label className="block text-xs text-text-tertiary mb-1">截止日期</label>
            <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} max={todayLocal()} />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => { load(); loadTrend(); }} className={actionButtonClass}>
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
            <button
              onClick={() => { setEditing(null); setShowForm(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-control bg-surface-primary text-text-primary border border-border-action hover:bg-surface-secondary transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              录入价格
            </button>
          </div>
        </div>

        {/* 趋势条形图（按时间升序，高度 ∝ 价格） */}
        {typeFilter && (
          <div className="mt-4">
            <p className="text-xs text-text-tertiary mb-2">
              {MATERIAL_TYPE_LABELS[typeFilter]}价格趋势
              {trendBounds && ` · 区间 ${trendBounds.min.toFixed(2)} ~ ${trendBounds.max.toFixed(2)}`}
            </p>
            {trendLoading ? (
              <div className="flex items-center justify-center py-6 text-text-tertiary">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : trend.length === 0 ? (
              <p className="text-xs text-text-tertiary">该类型下暂无价格数据</p>
            ) : (
              <div className="flex items-end gap-1 h-24 bg-surface-primary rounded-inset p-2 overflow-x-auto">
                {trend.map((p, idx) => {
                  const ratio = trendBounds && trendBounds.span > 0 ? (p.price - trendBounds.min) / trendBounds.span : 1;
                  const heightPct = 20 + ratio * 80;
                  return (
                    <div
                      key={`${p.priceDate}-${idx}`}
                      className="bg-border-action rounded-t-control shrink-0 w-4"
                      style={{ height: `${heightPct}%` }}
                      title={`${p.priceDate} · ${p.currency} ${p.price.toFixed(4)}/${p.unit}${p.supplierName ? ` · ${p.supplierName}` : ''}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 价格列表 */}
      <div className="bg-surface-elevated rounded-card p-5">
        <h3 className="text-sm font-medium text-text-primary mb-4">价格记录</h3>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <EmptyHint text="暂无价格记录" />
        ) : (
          <div className="bg-surface-primary rounded-inset divide-y divide-border-subtle">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-text-tertiary">
              <span className="col-span-1">类型</span>
              <span className="col-span-2">日期</span>
              <span className="col-span-3">名称 / 规格</span>
              <span className="col-span-2">价格</span>
              <span className="col-span-2">供应商</span>
              <span className="col-span-1">来源</span>
              <span className="col-span-1 text-right">操作</span>
            </div>
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center">
                <span className="col-span-1">
                  <span className={`px-2 py-0.5 rounded-control ${statusSemanticClass('info')}`}>
                    {MATERIAL_TYPE_LABELS[item.materialType]}
                  </span>
                </span>
                <span className="col-span-2 text-text-secondary">{item.priceDate}</span>
                <span className="col-span-3 text-text-primary truncate">
                  {item.name}{item.specification ? ` · ${item.specification}` : ''}
                </span>
                <span className="col-span-2 text-text-primary">{item.currency} {item.price.toFixed(4)}/{item.unit}</span>
                <span className="col-span-2 text-text-secondary truncate">{item.supplierName || '—'}</span>
                <span className="col-span-1 text-text-tertiary">{MATERIAL_SOURCE_LABELS[item.source] || item.source}</span>
                <span className="col-span-1 flex items-center justify-end gap-1.5">
                  <button onClick={() => { setEditing(item); setShowForm(true); }} disabled={updatingId === item.id} className={actionButtonClass} title="编辑">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={updatingId === item.id} className={actionButtonClass} title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <MaterialPriceForm
            editing={editing}
            onSave={async (input) => {
              try {
                if (editing) {
                  await apiService.updateMaterialPrice(editing.id, input);
                } else {
                  await apiService.createMaterialPrice(input);
                }
                setShowForm(false);
                await load();
                await loadTrend();
              } catch (e) {
                console.error('[PricingManager] saveMaterialPrice failed', e);
                alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
              }
            }}
            onClose={() => setShowForm(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MaterialPriceForm({
  editing,
  onSave,
  onClose,
}: {
  editing: MaterialPriceHistory | null;
  onSave: (input: MaterialPriceInput) => void;
  onClose: () => void;
}) {
  const [materialType, setMaterialType] = useState<MaterialPriceType>(editing?.materialType || 'fabric');
  const [materialCode, setMaterialCode] = useState(editing?.materialCode || '');
  const [name, setName] = useState(editing?.name || '');
  const [specification, setSpecification] = useState(editing?.specification || '');
  const [price, setPrice] = useState(editing ? String(editing.price) : '');
  const [unit, setUnit] = useState(editing?.unit || 'M');
  const [currency, setCurrency] = useState(editing?.currency || 'CNY');
  const [priceDate, setPriceDate] = useState(editing?.priceDate || todayLocal());
  const [supplierName, setSupplierName] = useState(editing?.supplierName || '');
  const [notes, setNotes] = useState(editing?.notes || '');

  const handleSubmit = () => {
    const p = parseNum(price);
    if (!name.trim()) {
      alert('请输入材料名称');
      return;
    }
    if (p === null || p <= 0) {
      alert('请输入有效价格');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate)) {
      alert('价格日期格式须为 YYYY-MM-DD');
      return;
    }
    if (!unit.trim()) {
      alert('请输入计价单位');
      return;
    }
    onSave({
      materialType,
      materialCode: materialCode.trim() || null,
      name: name.trim(),
      specification: specification.trim() || null,
      price: p,
      unit: unit.trim(),
      currency: currency.trim() || 'CNY',
      priceDate,
      source: editing?.source || 'manual',
      supplierName: supplierName.trim() || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <ModalShell title={editing ? '编辑价格记录' : '录入价格'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="材料类型">
          <select className={inputClass} value={materialType} onChange={(e) => setMaterialType(e.target.value as MaterialPriceType)}>
            <option value="yarn">纱线</option>
            <option value="fabric">面料</option>
            <option value="trimming">辅料</option>
          </select>
        </Field>
        <Field label="材料编码（可选）">
          <input className={inputClass} value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} placeholder="如 YC-32S" />
        </Field>
        <Field label="材料名称">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="如 全棉精梳纱 32S" />
        </Field>
        <Field label="规格（可选）">
          <input className={inputClass} value={specification} onChange={(e) => setSpecification(e.target.value)} placeholder="如 40×40/133×72" />
        </Field>
        <Field label="价格">
          <input className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="如 5.80" inputMode="decimal" />
        </Field>
        <Field label="计价单位">
          <input className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="M / PC / KG" />
        </Field>
        <Field label="币种">
          <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
        <Field label="价格日期">
          <input type="date" className={inputClass} value={priceDate} onChange={(e) => setPriceDate(e.target.value)} max={todayLocal()} />
        </Field>
        <Field label="供应商（可选）">
          <input className={inputClass} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="供应商名称" />
        </Field>
        <Field label="备注（可选）">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="价格说明" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className={actionButtonClass}>取消</button>
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-control bg-surface-primary text-text-primary border border-border-action hover:bg-surface-secondary transition-colors"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}
