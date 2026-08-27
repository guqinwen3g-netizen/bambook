/**
 * 定价与利润 PricingManager
 * 阶段 P1：定价与利润前端（PRD 8 双轨制）
 *
 * 功能：
 *   1. 定价计算器 Calculator — 双轨制（PRD 8）：
 *      轨道 A（系统推荐估算）：按品类拆解成本（逐项可调实时重算），
 *        输出估算售价区间（下限/中位/上限）+ 来源标签（价格历史/行业基准/手工）；
 *      轨道 B（退税美元定价）试算：HS Code 查退税率、
 *        最新汇率一键带入、实时预览（派生值服务端重算）、保存定价记录、记录状态流转
 *   2. 利润表 Profit Sheets — 订单级利润表生成/查看：收入·采购·运费·杂费四维聚合、
 *      毛利与毛利率、未折算明细透明披露
 *   3. 退税率 Tax Rates — HS Code 退税率表 CRUD + 最长前缀命中测试
 *   4. 价格历史 Price History — 原材料价格（纱线/面料/辅料）CRUD + 趋势视图，
 *      为轨道 A 估算提供校准数据源
 *
 * 设计原则：
 *   - 轨道 B 派生值（netUsdCost / finalUnitPrice 等）一律以后端返回为准，前端不做本地计算
 *   - BDS v2.1 组件族（bds-card/bds-btn/bds-input/bds-badge/bds-tabs/bds-modal 等），
 *     状态徽章用 bds-badge 语义变体（CALC_STATUS_BADGE_VARIANT），主题透明无 isDarkMode 分支
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calculator,
  Receipt,
  Percent,
  History,
  Handshake,
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
  Quotation,
  ProductAssetDetail,
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
  CommissionRule,
  CommissionRuleInput,
  Relation,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';
import { TrackAPanel } from './pricing/TrackAPanel';
import { FreightImpactPanel } from './pricing/FreightImpactPanel';
import { TrackBPanel, TrackBValidInputs } from './pricing/TrackBPanel';
import { DeviationBadge } from './pricing/DeviationBadge';

// ==================== 常量 ====================

type ModuleTab = 'calculator' | 'profitSheets' | 'taxRates' | 'priceHistory' | 'commissionRules';

/** 阶段 IA-2 / A5d 同款深链：允许外部（业务工具跳转卡 / 报表下钻）按 id 指定落点 tab */
export type { ModuleTab as PricingTabId };

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'calculator', label: '定价计算器 Calculator', icon: Calculator },
  { id: 'profitSheets', label: '利润表 Profit Sheets', icon: Receipt },
  { id: 'taxRates', label: '退税率 Tax Rates', icon: Percent },
  { id: 'priceHistory', label: '价格历史 Price History', icon: History },
  { id: 'commissionRules', label: '佣金规则 Commission', icon: Handshake },
];

const CALC_STATUS_LABELS: Record<PricingCalculationStatus, string> = {
  Draft: '草稿',
  Confirmed: '已确认',
  Archived: '已归档',
};

// BDS 徽章语义变体映射（bds-badge：neutral/info/success/danger/warning）
const CALC_STATUS_BADGE_VARIANT: Record<PricingCalculationStatus, 'neutral' | 'success'> = {
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

const inputClass = "bds-input";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
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
      className="bds-modal-mask"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bds-modal"
        style={{ width: '32rem', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="bds-text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="bds-empty">
      <div className="title">{text}</div>
    </div>
  );
}

// ==================== 组件 Props ====================

interface PricingManagerProps {
  isDarkMode?: boolean;
  /** 阶段 IA-2：跳转卡/下钻落点 tab，变更时响应式同步（与 CustomsManager initialTab 同口径） */
  initialTab?: ModuleTab;
}

// ==================== 主组件 ====================

// ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
// isDarkMode 仅保留在 props 签名与解构中兼容调用方，组件内不再使用
export default function PricingManager({ isDarkMode, initialTab }: PricingManagerProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>(initialTab ?? 'calculator');
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // ── H2/V9：无状态依赖的新建类主操作统一收 PageHeader（QC ref 注册模式） ──
  // calculator/profitSheets 面板内已有绑定面板状态的任务区 primary（V2 裁决），PageHeader 不再重复
  const newActionRef = useRef<(() => void) | null>(null);
  const NEW_ACTION_LABEL: Partial<Record<ModuleTab, string>> = {
    taxRates: '新增退税率',
    priceHistory: '录入价格',
    commissionRules: '新增规则',
  };
  const newActionLabel = NEW_ACTION_LABEL[activeTab];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="定价与利润"
        subtitle="Pricing & Profit"
        actions={
          newActionLabel ? (
            <button onClick={() => newActionRef.current?.()} className="bds-btn bds-btn-primary">
              <Plus size={14} />
              <span>{newActionLabel}</span>
            </button>
          ) : undefined
        }
      />

      {/* 模块 Tab 栏（BDS Tabs 下划线式） */}
      <div className="px-7 shrink-0">
        <div className="bds-tabs">
          {MODULE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`bds-tab flex items-center gap-1.5 ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
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
            {activeTab === 'calculator' && <CalculatorPanel />}
            {activeTab === 'profitSheets' && <ProfitSheetsPanel />}
            {activeTab === 'taxRates' && <TaxRatesPanel registerNewAction={(fn) => { newActionRef.current = fn; }} />}
            {activeTab === 'priceHistory' && <PriceHistoryPanel registerNewAction={(fn) => { newActionRef.current = fn; }} />}
            {activeTab === 'commissionRules' && <CommissionRulesPanel registerNewAction={(fn) => { newActionRef.current = fn; }} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 定价计算器 Panel ====================

function CalculatorPanel() {
  // 轨道 B 附加字段（保存定价记录用；试算本体在共享 TrackBPanel 内）
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // J1 定价记录归属：关联订单 / 报价单 / 产品（snapshot FK，均为可选）
  const [orderId, setOrderId] = useState('');
  const [quotationId, setQuotationId] = useState('');
  const [productAssetId, setProductAssetId] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [products, setProducts] = useState<ProductAssetDetail[]>([]);

  // 双轨联动校验（PRD 8.6）：轨道 A 中位估算 + 轨道 B 终价 → 偏差黄/红标
  const [trackAMedian, setTrackAMedian] = useState<{ usd: number; unit: 'PC' | 'M' } | null>(null);
  const [trackBInputs, setTrackBInputs] = useState<TrackBValidInputs | null>(null);
  const [trackBResult, setTrackBResult] = useState<TrackBResult | null>(null);

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

  // 关联候选列表（失败不阻塞主流程，仅下拉为空）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listOrders();
        if (!cancelled) setOrders(list.filter((o) => !o.deletedAt));
      } catch (e) {
        console.error('[PricingManager] listOrders failed', e);
      }
      try {
        const { items } = await apiService.listQuotations({ limit: 200 });
        if (!cancelled) setQuotations(items);
      } catch (e) {
        console.error('[PricingManager] listQuotations failed', e);
      }
      try {
        const assets = await apiService.listProductAssets(undefined, { limit: 200 });
        if (!cancelled) setProducts(assets.filter((a) => !a.deletedAt));
      } catch (e) {
        console.error('[PricingManager] listProductAssets failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const orderLabel = useCallback((id: string) => {
    const o = orders.find((x) => x.id === id);
    return o ? `${o.id} · ${o.customer}` : id;
  }, [orders]);
  const quotationLabel = useCallback((id: string) => {
    const q = quotations.find((x) => x.id === id);
    return q ? `${q.quotationNumber}${q.customerName ? ` · ${q.customerName}` : ''}` : id;
  }, [quotations]);
  const productLabel = useCallback((id: string) => {
    const p = products.find((x) => x.id === id);
    return p ? `${p.name} · ${p.sku}` : id;
  }, [products]);

  const handleSave = async () => {
    if (!trackBInputs) {
      bdsToast.warning('请完整填写采购成本 / 退税率 / 汇率 / 利润率');
      return;
    }
    setSaving(true);
    try {
      await apiService.createPricingCalculation({
        purchaseCostCny: trackBInputs.purchaseCostCny,
        refundRate: trackBInputs.refundRate,
        exchangeRate: trackBInputs.exchangeRate,
        profitMargin: trackBInputs.profitMargin,
        commissionRate: trackBInputs.commissionRate,
        commissionRuleId: trackBInputs.commissionRuleId,
        hsCode: trackBInputs.hsCode || null,
        orderId: orderId || null,
        quotationId: quotationId || null,
        productAssetId: productAssetId || null,
        quantity: parseNum(quantity),
        notes: notes.trim() || null,
      });
      setNotes('');
      setOrderId('');
      setQuotationId('');
      setProductAssetId('');
      await loadRecords();
    } catch (e) {
      console.error('[PricingManager] createPricingCalculation failed', e);
      bdsToast.danger(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
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
      bdsToast.danger(`状态更新失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除该定价记录？', danger: true }))) return;
    setUpdatingId(id);
    try {
      await apiService.deletePricingCalculation(id);
      await loadRecords();
    } catch (e) {
      console.error('[PricingManager] deletePricingCalculation failed', e);
      bdsToast.danger(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* 左：双轨试算（轨道 A 估算 + 轨道 B 退税定价 + 偏差校验） */}
      <div className="space-y-5">
        <TrackAPanel onMedianUsdChange={(usd, unit) => setTrackAMedian(usd !== null && unit ? { usd, unit } : null)} />
        <TrackBPanel
          onResultChange={setTrackBResult}
          onInputsChange={setTrackBInputs}
          actions={
            <button
              onClick={handleSave}
              disabled={saving || !trackBInputs}
              className="bds-btn bds-btn-primary"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              保存定价记录
            </button>
          }
        >
          <Field label="关联订单（可选）">
            <select className="bds-select" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">不关联</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{orderLabel(o.id)}</option>
              ))}
            </select>
          </Field>
          <Field label="关联报价单（可选）">
            <select className="bds-select" value={quotationId} onChange={(e) => setQuotationId(e.target.value)}>
              <option value="">不关联</option>
              {quotations.map((q) => (
                <option key={q.id} value={q.id}>{quotationLabel(q.id)}</option>
              ))}
            </select>
          </Field>
          <Field label="关联产品（可选）">
            <select className="bds-select" value={productAssetId} onChange={(e) => setProductAssetId(e.target.value)}>
              <option value="">不关联</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{productLabel(p.id)}</option>
              ))}
            </select>
          </Field>
          <Field label="数量（可选）">
            <input className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="如 800" inputMode="decimal" />
          </Field>
          <Field label="备注（可选）">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="定价说明" />
          </Field>
        </TrackBPanel>
        <DeviationBadge
          finalUsd={trackBResult?.finalUnitPrice ?? null}
          medianUsd={trackAMedian?.usd ?? null}
          medianUnit={trackAMedian?.unit}
        />
      </div>

      {/* 右：定价记录 */}
      <div className="bds-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>定价记录</h3>
          <button onClick={loadRecords} className="bds-btn bds-btn-secondary">
            <RefreshCw className="w-3.5 h-3.5" />
            刷新
          </button>
        </div>
        {recordsLoading ? (
          <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-quaternary)' }}>
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <EmptyHint text="暂无定价记录" />
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {records.map((rec) => (
              <div key={rec.id} className="rounded-inset p-3 bds-inset">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      终价 ${rec.finalUnitPrice.toFixed(4)}
                      <span style={{ color: 'var(--text-tertiary)' }}> · 成本 ¥{rec.purchaseCostCny.toFixed(2)} · 退税 {rec.refundRate}% · 汇率 {rec.exchangeRate}</span>
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      利润率 {rec.profitMargin}%{rec.commissionRate ? ` · 佣金 ${rec.commissionRate}%` : ''}{rec.hsCode ? ` · HS ${rec.hsCode}` : ''}{rec.quantity ? ` · 数量 ${rec.quantity}` : ''} · {formatTs(rec.createdAt)}
                    </p>
                    {(rec.orderId || rec.quotationId || rec.productAssetId) && (
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                        归属：{[
                          rec.orderId ? `订单 ${orderLabel(rec.orderId)}` : null,
                          rec.quotationId ? `报价单 ${quotationLabel(rec.quotationId)}` : null,
                          rec.productAssetId ? `产品 ${productLabel(rec.productAssetId)}` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {rec.notes && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{rec.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`bds-badge sm ${CALC_STATUS_BADGE_VARIANT[rec.status]}`}>
                      {CALC_STATUS_LABELS[rec.status]}
                    </span>
                    {rec.status === 'Draft' && (
                      <button onClick={() => handlePatchStatus(rec.id, 'Confirmed')} disabled={updatingId === rec.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="确认定价">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {rec.status !== 'Archived' && (
                      <button onClick={() => handlePatchStatus(rec.id, 'Archived')} disabled={updatingId === rec.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="归档">
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => handleDelete(rec.id)} disabled={updatingId === rec.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
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

function ProfitSheetsPanel() {
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
      bdsToast.warning('请搜索并选择订单');
      return;
    }
    setGenerating(true);
    try {
      const sheet = await apiService.generateProfitSheet(selectedOrder.id);
      setCurrent(sheet);
      await loadSheets();
    } catch (e) {
      console.error('[PricingManager] generateProfitSheet failed', e);
      bdsToast.danger(`生成失败: ${e instanceof Error ? e.message : String(e)}`);
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
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除该订单利润表？', danger: true }))) return;
    try {
      await apiService.deleteProfitSheet(orderId);
      if (current?.orderId === orderId) setCurrent(null);
      await loadSheets();
    } catch (e) {
      console.error('[PricingManager] deleteProfitSheet failed', e);
      bdsToast.danger(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
      {/* 左：生成 + 列表 */}
      <div className="xl:col-span-2 space-y-4">
        <div className="bds-card">
          <h3 className="bds-overline mb-3" style={{ color: 'var(--text-tertiary)' }}>生成 / 重新生成利润表</h3>
          <Field label="订单（搜索 PO / 客户 / 产品）">
            <input
              className={inputClass}
              value={orderQuery}
              onChange={(e) => { setOrderQuery(e.target.value); setSelectedOrder(null); }}
              placeholder="输入关键字搜索订单"
            />
          </Field>
          {filteredOrders.length > 0 && !selectedOrder && (
            <div className="mb-3 rounded-inset max-h-48 overflow-y-auto bds-inset">
              {filteredOrders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => { setSelectedOrder(o); setOrderQuery(`${o.poNumber || o.id} · ${o.customer || ''}`); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--hover-darken)]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {o.poNumber || o.id} · {o.customer || '—'} · {o.product || '—'}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedOrder}
            className="bds-btn bds-btn-primary"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
            生成利润表
          </button>
        </div>

        {/* REQ2-14 海运费变动利润重估（X-04：倍率一击 → 受影响订单一屏可见） */}
        <FreightImpactPanel />

        <div className="bds-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>已生成利润表</h3>
            <button onClick={loadSheets} className="bds-btn bds-btn-secondary">
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-quaternary)' }}>
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : sheets.length === 0 ? (
            <EmptyHint text="暂无利润表" />
          ) : (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {sheets.map((s) => (
                <div key={s.id} className="rounded-inset p-3 flex items-center justify-between gap-2 bds-inset">
                  <button onClick={() => handleView(s.orderId)} className="min-w-0 text-left">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>订单 {s.orderId}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      毛利 {formatMoney(s.grossProfit, s.baseCurrency)}{s.grossMargin !== null && s.grossMargin !== undefined ? ` · 毛利率 ${s.grossMargin.toFixed(2)}%` : ''} · v{s.version} · {formatTs(s.generatedAt)}
                    </p>
                  </button>
                  <button onClick={() => handleDelete(s.orderId)} className="bds-btn bds-btn-ghost bds-btn-icon shrink-0" title="删除">
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
          <div className="bds-card h-full flex items-center justify-center">
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
    <div className="bds-card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>订单 {sheet.orderId} 利润表</h3>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>v{sheet.version} · 生成于 {formatTs(sheet.generatedAt)}</span>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-inset p-3 bds-inset">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>销售收入</p>
          <p className="bds-tnum text-base" style={{ color: 'var(--text-primary)' }}>{formatMoney(sheet.salesRevenue, sheet.baseCurrency)}</p>
        </div>
        <div className="rounded-inset p-3 bds-inset">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>采购成本</p>
          <p className="bds-tnum text-base" style={{ color: 'var(--text-primary)' }}>{formatMoney(sheet.purchaseCost, sheet.baseCurrency)}</p>
        </div>
        <div className="rounded-inset p-3 bds-inset">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>运费</p>
          <p className="bds-tnum text-base" style={{ color: 'var(--text-primary)' }}>{formatMoney(sheet.freightCost, sheet.baseCurrency)}</p>
        </div>
        <div className="rounded-inset p-3 bds-inset">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>杂费</p>
          <p className="bds-tnum text-base" style={{ color: 'var(--text-primary)' }}>{formatMoney(sheet.miscCost, sheet.baseCurrency)}</p>
        </div>
        <div className="rounded-inset p-3 bds-inset" style={{ border: '1px solid var(--accent-tint-strong)' }}>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>毛利</p>
          <p className="bds-tnum text-base" style={{ color: 'var(--text-primary)' }}>{formatMoney(sheet.grossProfit, sheet.baseCurrency)}</p>
        </div>
        <div className="rounded-inset p-3 bds-inset" style={{ border: '1px solid var(--accent-tint-strong)' }}>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>毛利率</p>
          <p className="bds-tnum text-base" style={{ color: 'var(--text-primary)' }}>
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
          <p className="bds-overline mb-1.5" style={{ color: 'var(--text-secondary)' }}>{title}（{lines.length}）</p>
          {lines.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>无明细</p>
          ) : (
            <div className="rounded-inset bds-inset">
              {lines.map((line, idx) => (
                <div
                  key={line.id}
                  className="flex items-center justify-between px-3 py-2 text-xs"
                  style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
                >
                  <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{line.label}</span>
                  <span className="shrink-0 ml-3" style={{ color: 'var(--text-tertiary)' }}>
                    {formatMoney(line.amount, line.currency)} × {line.rate}（{RATE_SOURCE_LABELS[line.rateSource] || line.rateSource}）
                    <span className="ml-2" style={{ color: 'var(--text-primary)' }}>= {formatMoney(line.cnyAmount, sheet.baseCurrency)}</span>
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
          <p className="bds-overline mb-1.5" style={{ color: 'var(--text-secondary)' }}>未折算明细（缺汇率，未计入汇总）</p>
          <div className="rounded-inset bds-inset" style={{ border: '1px solid var(--accent-tint-strong)' }}>
            {d.unconverted.map((line, idx) => (
              <div
                key={line.id}
                className="flex items-center justify-between px-3 py-2 text-xs"
                style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
              >
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{line.label}</span>
                <span className="shrink-0 ml-3" style={{ color: 'var(--text-tertiary)' }}>
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

function TaxRatesPanel({ registerNewAction }: { registerNewAction?: (fn: (() => void) | null) => void }) {
  const [items, setItems] = useState<TaxRefundRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaxRefundRate | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [testCode, setTestCode] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  // ── H2/V9：新建主操作注册到 PageHeader（无状态依赖，卡片头不再重复） ──
  useEffect(() => {
    registerNewAction?.(() => { setEditing(null); setShowForm(true); });
    return () => registerNewAction?.(null);
  }, [registerNewAction]);

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
      bdsToast.danger(`更新失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除该退税率？', danger: true }))) return;
    setUpdatingId(id);
    try {
      await apiService.deleteTaxRefundRate(id);
      await load();
    } catch (e) {
      console.error('[PricingManager] deleteTaxRefundRate failed', e);
      bdsToast.danger(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* 命中测试 */}
      <div className="bds-card">
        <h3 className="bds-overline mb-3" style={{ color: 'var(--text-tertiary)' }}>最长前缀命中测试</h3>
        <div className="flex items-center gap-2 max-w-lg">
          <input className={inputClass} value={testCode} onChange={(e) => { setTestCode(e.target.value); setTestResult(null); }} placeholder="输入完整 HS Code，如 5407520000" />
          <button onClick={handleTest} className="bds-btn bds-btn-secondary shrink-0">
            <Search className="w-3.5 h-3.5" />
            测试
          </button>
        </div>
        {testResult && <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>{testResult}</p>}
      </div>

      {/* 退税率表 */}
      <div className="bds-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>退税率表</h3>
            <label className="bds-check" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              <span className="box"></span>
              显示已停用
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="bds-btn bds-btn-secondary">
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-quaternary)' }}>
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <EmptyHint text="暂无退税率记录" />
        ) : (
          <div className="rounded-inset bds-inset">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)', borderBottom: 'var(--border-subtle)' }}>
              <span className="col-span-2">HS Code</span>
              <span className="col-span-2">退税率</span>
              <span className="col-span-4">说明</span>
              <span className="col-span-2">状态</span>
              <span className="col-span-2 text-right">操作</span>
            </div>
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
                style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
              >
                <span className="col-span-2 bds-mono" style={{ color: 'var(--text-primary)' }}>{item.hsCode}</span>
                <span className="col-span-2 bds-tnum" style={{ color: 'var(--text-primary)' }}>{item.rate}%</span>
                <span className="col-span-4 truncate" style={{ color: 'var(--text-secondary)' }}>{item.description || '—'}</span>
                <span className="col-span-2">
                  <button
                    onClick={() => handleToggleActive(item)}
                    disabled={updatingId === item.id}
                    className={`bds-badge sm ${item.isActive ? 'success' : 'neutral'}`}
                    style={{ cursor: 'pointer' }}
                    title="点击切换启停"
                  >
                    {item.isActive ? '启用' : '停用'}
                  </button>
                </span>
                <span className="col-span-2 flex items-center justify-end gap-1.5">
                  <button onClick={() => { setEditing(item); setShowForm(true); }} disabled={updatingId === item.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="编辑">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={updatingId === item.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
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
                bdsToast.danger(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
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
      bdsToast.warning('HS Code 须为 2/4/6/8/10 位数字');
      return;
    }
    if (r === null || r < 0 || r > 100) {
      bdsToast.warning('退税率须在 0-100 之间');
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
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ==================== 价格历史 Panel ====================

function PriceHistoryPanel({ registerNewAction }: { registerNewAction?: (fn: (() => void) | null) => void }) {
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

  // ── H2/V9：新建主操作注册到 PageHeader（无状态依赖，卡片头不再重复） ──
  useEffect(() => {
    registerNewAction?.(() => { setEditing(null); setShowForm(true); });
    return () => registerNewAction?.(null);
  }, [registerNewAction]);

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
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除该价格记录？', danger: true }))) return;
    setUpdatingId(id);
    try {
      await apiService.deleteMaterialPrice(id);
      await load();
      await loadTrend();
    } catch (e) {
      console.error('[PricingManager] deleteMaterialPrice failed', e);
      bdsToast.danger(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* 筛选 + 趋势 */}
      <div className="bds-card">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>材料类型</label>
            <select className="bds-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as MaterialPriceType | '')}>
              <option value="">全部</option>
              <option value="yarn">纱线</option>
              <option value="fabric">面料</option>
              <option value="trimming">辅料</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>起始日期</label>
            <CapsuleDateInput className={inputClass} value={from} onChange={setFrom} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>截止日期</label>
            <CapsuleDateInput className={inputClass} value={to} onChange={setTo} />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => { load(); loadTrend(); }} className="bds-btn bds-btn-secondary">
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
          </div>
        </div>

        {/* 趋势条形图（按时间升序，高度 ∝ 价格） */}
        {typeFilter && (
          <div className="mt-4">
            <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
              {MATERIAL_TYPE_LABELS[typeFilter]}价格趋势
              {trendBounds && ` · 区间 ${trendBounds.min.toFixed(2)} ~ ${trendBounds.max.toFixed(2)}`}
            </p>
            {trendLoading ? (
              <div className="flex items-center justify-center py-6" style={{ color: 'var(--text-quaternary)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : trend.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>该类型下暂无价格数据</p>
            ) : (
              <div className="flex items-end gap-1 h-24 rounded-inset p-2 overflow-x-auto bds-inset">
                {trend.map((p, idx) => {
                  const ratio = trendBounds && trendBounds.span > 0 ? (p.price - trendBounds.min) / trendBounds.span : 1;
                  const heightPct = 20 + ratio * 80;
                  return (
                    <div
                      key={`${p.priceDate}-${idx}`}
                      className="rounded-t-control shrink-0 w-4"
                      style={{ height: `${heightPct}%`, background: 'var(--accent)' }}
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
      <div className="bds-card">
        <h3 className="bds-overline mb-4" style={{ color: 'var(--text-tertiary)' }}>价格记录</h3>
        {loading ? (
          <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-quaternary)' }}>
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <EmptyHint text="暂无价格记录" />
        ) : (
          <div className="rounded-inset bds-inset">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)', borderBottom: 'var(--border-subtle)' }}>
              <span className="col-span-1">类型</span>
              <span className="col-span-2">日期</span>
              <span className="col-span-3">名称 / 规格</span>
              <span className="col-span-2">价格</span>
              <span className="col-span-2">供应商</span>
              <span className="col-span-1">来源</span>
              <span className="col-span-1 text-right">操作</span>
            </div>
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
                style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
              >
                <span className="col-span-1">
                  <span className="bds-badge sm info">
                    {MATERIAL_TYPE_LABELS[item.materialType]}
                  </span>
                </span>
                <span className="col-span-2" style={{ color: 'var(--text-secondary)' }}>{item.priceDate}</span>
                <span className="col-span-3 truncate" style={{ color: 'var(--text-primary)' }}>
                  {item.name}{item.specification ? ` · ${item.specification}` : ''}
                </span>
                <span className="col-span-2 bds-tnum" style={{ color: 'var(--text-primary)' }}>{item.currency} {item.price.toFixed(4)}/{item.unit}</span>
                <span className="col-span-2 truncate" style={{ color: 'var(--text-secondary)' }}>{item.supplierName || '—'}</span>
                <span className="col-span-1" style={{ color: 'var(--text-tertiary)' }}>{MATERIAL_SOURCE_LABELS[item.source] || item.source}</span>
                <span className="col-span-1 flex items-center justify-end gap-1.5">
                  <button onClick={() => { setEditing(item); setShowForm(true); }} disabled={updatingId === item.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="编辑">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={updatingId === item.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
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
                bdsToast.danger(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
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
      bdsToast.warning('请输入材料名称');
      return;
    }
    if (p === null || p <= 0) {
      bdsToast.warning('请输入有效价格');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate)) {
      bdsToast.warning('价格日期格式须为 YYYY-MM-DD');
      return;
    }
    if (!unit.trim()) {
      bdsToast.warning('请输入计价单位');
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
          <select className="bds-select" value={materialType} onChange={(e) => setMaterialType(e.target.value as MaterialPriceType)}>
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
          <select className="bds-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
        <Field label="价格日期">
          <CapsuleDateInput className={inputClass} value={priceDate} onChange={setPriceDate} />
        </Field>
        <Field label="供应商（可选）">
          <input className={inputClass} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="供应商名称" />
        </Field>
        <Field label="备注（可选）">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="价格说明" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ==================== 佣金规则 Panel ====================

function CommissionRulesPanel({ registerNewAction }: { registerNewAction?: (fn: (() => void) | null) => void }) {
  const [items, setItems] = useState<CommissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CommissionRule | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // ── H2/V9：新建主操作注册到 PageHeader（无状态依赖，卡片头不再重复） ──
  useEffect(() => {
    registerNewAction?.(() => { setEditing(null); setShowForm(true); });
    return () => registerNewAction?.(null);
  }, [registerNewAction]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiService.listCommissionRules(includeInactive));
    } catch (e) {
      console.error('[PricingManager] listCommissionRules failed', e);
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleActive = async (item: CommissionRule) => {
    setUpdatingId(item.id);
    try {
      await apiService.updateCommissionRule(item.id, { isActive: !item.isActive });
      await load();
    } catch (e) {
      console.error('[PricingManager] updateCommissionRule failed', e);
      bdsToast.danger(`更新失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除该佣金规则？', danger: true }))) return;
    setUpdatingId(id);
    try {
      await apiService.deleteCommissionRule(id);
      await load();
    } catch (e) {
      console.error('[PricingManager] deleteCommissionRule failed', e);
      bdsToast.danger(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bds-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>佣金规则</h3>
            <label className="bds-check" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              <span className="box"></span>
              显示已停用
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="bds-btn bds-btn-secondary">
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
          </div>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          命中口径：定价计算器选择中间人时精确命中其启用规则；无精确命中时回退默认规则（中间人为空）。同一中间人仅允许一条启用规则。
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-quaternary)' }}>
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <EmptyHint text="暂无佣金规则" />
        ) : (
          <div className="rounded-inset bds-inset">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)', borderBottom: 'var(--border-subtle)' }}>
              <span className="col-span-3">规则名称</span>
              <span className="col-span-2">佣金率</span>
              <span className="col-span-2">中间人</span>
              <span className="col-span-2">备注</span>
              <span className="col-span-1">状态</span>
              <span className="col-span-2 text-right">操作</span>
            </div>
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
                style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
              >
                <span className="col-span-3 truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                <span className="col-span-2 bds-tnum" style={{ color: 'var(--text-primary)' }}>{item.rate}%</span>
                <span className="col-span-2 truncate" style={{ color: 'var(--text-secondary)' }}>{item.intermediaryName || '默认规则'}</span>
                <span className="col-span-2 truncate" style={{ color: 'var(--text-secondary)' }}>{item.notes || '—'}</span>
                <span className="col-span-1">
                  <button
                    onClick={() => handleToggleActive(item)}
                    disabled={updatingId === item.id}
                    className={`bds-badge sm ${item.isActive ? 'success' : 'neutral'}`}
                    style={{ cursor: 'pointer' }}
                    title="点击切换启停"
                  >
                    {item.isActive ? '启用' : '停用'}
                  </button>
                </span>
                <span className="col-span-2 flex items-center justify-end gap-1.5">
                  <button onClick={() => { setEditing(item); setShowForm(true); }} disabled={updatingId === item.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="编辑">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={updatingId === item.id} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
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
          <CommissionRuleForm
            editing={editing}
            onSave={async (input) => {
              try {
                if (editing) {
                  await apiService.updateCommissionRule(editing.id, input);
                } else {
                  await apiService.createCommissionRule(input);
                }
                setShowForm(false);
                await load();
              } catch (e) {
                console.error('[PricingManager] saveCommissionRule failed', e);
                bdsToast.danger(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
              }
            }}
            onClose={() => setShowForm(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CommissionRuleForm({
  editing,
  onSave,
  onClose,
}: {
  editing: CommissionRule | null;
  onSave: (input: CommissionRuleInput) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name || '');
  const [rate, setRate] = useState(editing ? String(editing.rate) : '5');
  const [intermediaryRelationId, setIntermediaryRelationId] = useState(editing?.intermediaryRelationId || '');
  const [notes, setNotes] = useState(editing?.notes || '');
  const [relations, setRelations] = useState<Relation[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listRelations();
        if (cancelled) return;
        setRelations(
          list
            .filter((r) => r.isOrganization && !r.deletedAt)
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
        );
      } catch (e) {
        console.error('[PricingManager] listRelations failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = () => {
    if (!name.trim()) {
      bdsToast.warning('规则名称必填');
      return;
    }
    const rateNum = parseNum(rate);
    if (rateNum === null || rateNum <= 0 || rateNum > 100) {
      bdsToast.warning('佣金率必须大于 0 且不超过 100%');
      return;
    }
    onSave({
      name: name.trim(),
      rate: rateNum,
      intermediaryRelationId: intermediaryRelationId || null,
      notes: notes.trim() || null,
      isActive: editing?.isActive ?? true,
    });
  };

  return (
    <ModalShell title={editing ? `编辑佣金规则 ${editing.name}` : '新增佣金规则'} onClose={onClose}>
      <Field label="规则名称">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="如 E10-品牌中介" />
      </Field>
      <Field label="佣金率（%，0-100）">
        <input className={inputClass} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="如 7.5" inputMode="decimal" />
      </Field>
      <Field label="中间人（空 = 默认规则）">
        <select className="bds-select" value={intermediaryRelationId} onChange={(e) => setIntermediaryRelationId(e.target.value)}>
          <option value="">默认规则（不限中间人）</option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </Field>
      <Field label="备注（可选）">
        <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="适用场景说明" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}
