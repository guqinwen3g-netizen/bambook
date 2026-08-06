/**
 * BOM 成本核算 BomManager
 * Phase 2 B4 缺失模块补齐：物料清单 + 成本测算（料/工/费）+ 利润分析
 *
 * 功能：
 *   - BOM 列表（按状态/搜索过滤）
 *   - BOM 详情（物料行 + 成本估算项 + 利润分析）
 *   - 创建 BOM（含物料行 + 成本估算项，自动计算成本）
 *   - 状态转换：Draft → Confirmed → Archived
 *   - 成本重新计算（仅 Draft）
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Search,
  RefreshCw,
  ChevronDown,
  Loader2,
  AlertCircle,
  Calculator,
  Check,
  Archive,
  X,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  BOM,
  BOMLine,
  BOMLineInput,
  CostEstimate,
  CostEstimateInput,
  CreateBOMInput,
  MaterialType,
  CostType,
  BOMStatus,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { statusSemanticClass, statusSemanticText, StatusSemantic } from './rdlBusinessStatusTokens';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import ScrollEdgeFades from './ui/ScrollEdgeFades';

// ==================== 常量 ====================
const MATERIAL_TYPES: Array<{ id: MaterialType; label: string; semantic: StatusSemantic }> = [
  { id: 'Main', label: '主料', semantic: 'info' },
  { id: 'Contrast', label: '对比料', semantic: 'info' },
  { id: 'Lining', label: '里布', semantic: 'neutral' },
  { id: 'Pocketing', label: '口袋布', semantic: 'neutral' },
  { id: 'Trimmings', label: '辅料', semantic: 'warning' },
  { id: 'Thread', label: '缝纫线', semantic: 'warning' },
  { id: 'Packaging', label: '包装', semantic: 'neutral' },
  { id: 'Other', label: '其他', semantic: 'neutral' },
];

const COST_TYPES: Array<{ id: CostType; label: string }> = [
  { id: 'Material', label: '物料成本' },
  { id: 'Labor', label: '人工成本' },
  { id: 'Overhead', label: '制造费用' },
  { id: 'Other', label: '其他' },
];

const ITEM_CATEGORIES = ['Fabric', 'Trimmings', 'Accessories', 'Garment', 'Other'];
const UNITS = ['YD', 'M', 'KG', 'PC', 'SET'];

const STATUS_TABS: Array<{ id: BOMStatus | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'Draft', label: '草稿' },
  { id: 'Confirmed', label: '已确认' },
  { id: 'Archived', label: '已归档' },
];

function formatCurrency(n: number | undefined | null, currency = 'CNY'): string {
  if (n == null) return '—';
  return `${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

interface BomManagerProps {
  isDarkMode: boolean;
}

const BomManager: React.FC<BomManagerProps> = ({ isDarkMode }) => {
  const [boms, setBoms] = useState<BOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, BOM>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── 加载 BOM 列表 ──
  const loadBOMs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listBOMs({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: searchQuery || undefined,
        limit: 200,
      });
      setBoms(result.items || []);
    } catch (e: any) {
      setError(e?.message || '加载 BOM 列表失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    loadBOMs();
  }, [loadBOMs]);

  // ── 加载 BOM 详情 ──
  const loadBOMDetail = useCallback(async (id: string) => {
    try {
      const bom = await apiService.getBOM(id);
      if (bom) {
        setDetailCache((prev) => ({ ...prev, [id]: bom }));
      }
    } catch (e: any) {
      // 静默失败，详情不阻断列表
    }
  }, []);

  const handleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!detailCache[id]) {
        loadBOMDetail(id);
      }
    }
  };

  // ── 状态转换 ──
  const handleConfirm = async (id: string) => {
    setActionLoading(`confirm_${id}`);
    try {
      const updated = await apiService.confirmBOM(id);
      setBoms((prev) => prev.map((b) => (b.id === id ? { ...b, status: 'Confirmed' } : b)));
      setDetailCache((prev) => ({ ...prev, [id]: updated }));
    } catch (e: any) {
      setError(e?.message || '确认 BOM 失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleArchive = async (id: string) => {
    setActionLoading(`archive_${id}`);
    try {
      const updated = await apiService.archiveBOM(id);
      setBoms((prev) => prev.map((b) => (b.id === id ? { ...b, status: 'Archived' } : b)));
      setDetailCache((prev) => ({ ...prev, [id]: updated }));
    } catch (e: any) {
      setError(e?.message || '归档 BOM 失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRecalculate = async (id: string) => {
    setActionLoading(`recalc_${id}`);
    try {
      const updated = await apiService.recalculateBOMCost(id);
      setDetailCache((prev) => ({ ...prev, [id]: updated }));
      setBoms((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (e: any) {
      setError(e?.message || '重新计算成本失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此 BOM？（仅 Draft 状态可删除）')) return;
    setActionLoading(`delete_${id}`);
    try {
      await apiService.deleteBOM(id);
      setBoms((prev) => prev.filter((b) => b.id !== id));
      setExpandedId(null);
    } catch (e: any) {
      setError(e?.message || '删除 BOM 失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateSuccess = () => {
    setShowCreateForm(false);
    loadBOMs();
  };

  // ── 主题样式 ──
  const cardClass = isDarkMode
    ? `rounded-card border border-white/[0.055] bg-white/[0.018] ${BAMBOOK_OS.material.glassColor}`
    : `rounded-card border border-white/45 bg-white/24 ${BAMBOOK_OS.material.glassColor}`;
  const fieldClass = `w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] ${
    isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const labelClass = `block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;
  const actionBtnCls = `h-8 px-3 rounded-control text-[11px] font-light inline-flex items-center gap-1 transition-colors disabled:opacity-50`;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader title="BOM 成本核算" subtitle="Bill of Materials" isDarkMode={isDarkMode} />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        {/* ── 工具栏 ── */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 rounded-control bg-black/5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1 rounded-compact text-xs font-light transition-colors ${
                  statusFilter === tab.id
                    ? isDarkMode ? 'bg-white/10 text-white' : 'bg-white text-slate-900 shadow-sm'
                    : isDarkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 BOM 编号/描述..."
              className={`${fieldClass} pl-9`}
              onKeyDown={(e) => { if (e.key === 'Enter') loadBOMs(); }}
            />
          </div>
          <button onClick={loadBOMs} className={`${actionBtnCls} ${isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => setShowCreateForm(true)}
            className={`${actionBtnCls} bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white`}
          >
            <Plus size={13} />
            <span>新建 BOM</span>
          </button>
        </div>

        {error && (
          <div className={`mb-3 p-3 rounded-control flex items-center gap-2 text-xs ${isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
            <AlertCircle size={14} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100"><X size={14} /></button>
          </div>
        )}

        {/* ── BOM 列表 ── */}
        <ScrollEdgeFades scrollRef={scrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {loading && boms.length === 0 ? (
            <div className={`flex items-center justify-center h-32 text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              <Loader2 size={16} className="animate-spin mr-2" /> 加载中...
            </div>
          ) : boms.length === 0 ? (
            <div className={`flex flex-col items-center justify-center h-32 text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              <Calculator size={32} className="mb-2 opacity-30" />
              <span>暂无 BOM，点击「新建 BOM」创建</span>
            </div>
          ) : (
            <div className="space-y-2 pb-2">
              {boms.map((bom, index) => {
                const isExpanded = expandedId === bom.id;
                const detail = detailCache[bom.id] || bom;
                const lines = detail.lines || [];
                const costEstimates = detail.costEstimates || [];
                const lineCount = lines.length || (bom as any).lines?.length || 0;
                const profitPositive = (detail.profitAmount ?? 0) >= 0;

                return (
                  <motion.div
                    key={bom.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index * 0.02, 0.3) }}
                    className={`${cardClass} overflow-hidden`}
                  >
                    {/* ── BOM 头部（可展开） ── */}
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      onClick={() => handleExpand(bom.id)}
                    >
                      <ChevronDown
                        size={16}
                        className={`transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''} ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-normal truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            {bom.bomNumber}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-light ${statusSemanticClass(bom.status as StatusSemantic, isDarkMode)}`}>
                            {statusSemanticText(bom.status as StatusSemantic)}
                          </span>
                          <span className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>v{bom.version}</span>
                        </div>
                        <div className={`text-xs mt-0.5 truncate ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {bom.description} · {lineCount} 行物料
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="text-right">
                          <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>总成本</div>
                          <div className={`text-sm font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            {formatCurrency(bom.totalCost, bom.currency)}
                          </div>
                        </div>
                        {bom.sellingPrice != null && (
                          <div className="text-right">
                            <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>利润率</div>
                            <div className={`text-sm font-normal flex items-center gap-0.5 ${profitPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                              {profitPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                              {bom.profitMargin != null ? `${bom.profitMargin.toFixed(1)}%` : '—'}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── BOM 详情（展开） ── */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className={`px-4 pb-4 pt-1 border-t ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
                            {/* 成本汇总卡片 */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                              <div className={`p-2 rounded-inset ${isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}`}>
                                <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>物料成本</div>
                                <div className={`text-sm font-normal ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                                  {formatCurrency(detail.totalMaterialCost, detail.currency)}
                                </div>
                              </div>
                              <div className={`p-2 rounded-inset ${isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}`}>
                                <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>人工成本</div>
                                <div className={`text-sm font-normal ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                                  {formatCurrency(detail.totalLaborCost, detail.currency)}
                                </div>
                              </div>
                              <div className={`p-2 rounded-inset ${isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}`}>
                                <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>制造费用</div>
                                <div className={`text-sm font-normal ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                                  {formatCurrency(detail.totalOverheadCost, detail.currency)}
                                </div>
                              </div>
                              <div className={`p-2 rounded-inset ${isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}`}>
                                <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>总成本</div>
                                <div className={`text-sm font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                  {formatCurrency(detail.totalCost, detail.currency)}
                                </div>
                              </div>
                            </div>

                            {/* 利润分析 */}
                            {detail.sellingPrice != null && (
                              <div className={`p-2 rounded-inset mb-3 flex items-center gap-4 ${isDarkMode ? 'bg-emerald-500/[0.06]' : 'bg-emerald-50'}`}>
                                <div>
                                  <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>销售单价</div>
                                  <div className={`text-sm font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                    {formatCurrency(detail.sellingPrice, detail.currency)}
                                  </div>
                                </div>
                                <div>
                                  <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>利润额</div>
                                  <div className={`text-sm font-normal ${profitPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {formatCurrency(detail.profitAmount, detail.currency)}
                                  </div>
                                </div>
                                <div>
                                  <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>利润率</div>
                                  <div className={`text-sm font-normal ${profitPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {detail.profitMargin != null ? `${detail.profitMargin.toFixed(2)}%` : '—'}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* 物料行明细 */}
                            {lines.length > 0 && (
                              <div className="mb-3">
                                <div className={`text-xs mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>物料明细</div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className={`text-left ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                        <th className="py-1 pr-2 font-light">#</th>
                                        <th className="py-1 pr-2 font-light">类型</th>
                                        <th className="py-1 pr-2 font-light">物料编码</th>
                                        <th className="py-1 pr-2 font-light">品名</th>
                                        <th className="py-1 pr-2 font-light text-right">用量</th>
                                        <th className="py-1 pr-2 font-light text-right">损耗</th>
                                        <th className="py-1 pr-2 font-light text-right">实耗</th>
                                        <th className="py-1 pr-2 font-light text-right">单价</th>
                                        <th className="py-1 font-light text-right">金额</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {lines.map((line) => (
                                        <tr key={line.id} className={`border-t ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
                                          <td className={`py-1.5 pr-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{line.lineNumber}</td>
                                          <td className="py-1.5 pr-2">
                                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${statusSemanticClass(line.materialType as StatusSemantic, isDarkMode)}`}>
                                              {MATERIAL_TYPES.find(m => m.id === line.materialType)?.label || line.materialType}
                                            </span>
                                          </td>
                                          <td className={`py-1.5 pr-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{line.materialCode || '—'}</td>
                                          <td className={`py-1.5 pr-2 ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>{line.description}</td>
                                          <td className={`py-1.5 pr-2 text-right ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{line.quantity} {line.unit}</td>
                                          <td className={`py-1.5 pr-2 text-right ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{line.wastagePercent}%</td>
                                          <td className={`py-1.5 pr-2 text-right ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{line.effectiveQty}</td>
                                          <td className={`py-1.5 pr-2 text-right ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{formatCurrency(line.unitCost, line.currency)}</td>
                                          <td className={`py-1.5 text-right font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{formatCurrency(line.amount, line.currency)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* 成本估算项 */}
                            {costEstimates.length > 0 && (
                              <div className="mb-3">
                                <div className={`text-xs mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>成本估算项</div>
                                <div className="space-y-1">
                                  {costEstimates.map((ce) => (
                                    <div key={ce.id} className={`flex items-center justify-between text-xs py-1 px-2 rounded-inset ${isDarkMode ? 'bg-white/[0.02]' : 'bg-slate-50'}`}>
                                      <div className="flex items-center gap-2">
                                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${statusSemanticClass(ce.costType as StatusSemantic, isDarkMode)}`}>
                                          {COST_TYPES.find(c => c.id === ce.costType)?.label || ce.costType}
                                        </span>
                                        <span className={isDarkMode ? 'text-slate-300' : 'text-slate-600'}>{ce.description}</span>
                                      </div>
                                      <span className={`font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{formatCurrency(ce.amount, ce.currency)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 操作按钮 */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {bom.status === 'Draft' && (
                                <>
                                  <button
                                    onClick={() => handleConfirm(bom.id)}
                                    disabled={actionLoading === `confirm_${bom.id}`}
                                    className={`${actionBtnCls} bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white`}
                                  >
                                    {actionLoading === `confirm_${bom.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                    <span>确认 BOM</span>
                                  </button>
                                  <button
                                    onClick={() => handleRecalculate(bom.id)}
                                    disabled={actionLoading === `recalc_${bom.id}`}
                                    className={`${actionBtnCls} ${isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                  >
                                    {actionLoading === `recalc_${bom.id}` ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
                                    <span>重新计算</span>
                                  </button>
                                  <button
                                    onClick={() => handleDelete(bom.id)}
                                    disabled={actionLoading === `delete_${bom.id}`}
                                    className={`${actionBtnCls} ${isDarkMode ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                                  >
                                    {actionLoading === `delete_${bom.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                    <span>删除</span>
                                  </button>
                                </>
                              )}
                              {(bom.status === 'Draft' || bom.status === 'Confirmed') && (
                                <button
                                  onClick={() => handleArchive(bom.id)}
                                  disabled={actionLoading === `archive_${bom.id}`}
                                  className={`${actionBtnCls} ${isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                >
                                  {actionLoading === `archive_${bom.id}` ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                                  <span>归档</span>
                                </button>
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
        </div>

        {/* ── 创建 BOM 弹窗 ── */}
        <AnimatePresence>
          {showCreateForm && (
            <CreateBOMModal
              isDarkMode={isDarkMode}
              cardClass={cardClass}
              fieldClass={fieldClass}
              labelClass={labelClass}
              onClose={() => setShowCreateForm(false)}
              onSuccess={handleCreateSuccess}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

// ==================== 创建 BOM 弹窗 ====================
interface CreateBOMModalProps {
  isDarkMode: boolean;
  cardClass: string;
  fieldClass: string;
  labelClass: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateBOMModal: React.FC<CreateBOMModalProps> = ({ isDarkMode, cardClass, fieldClass, labelClass, onClose, onSuccess }) => {
  const [bomNumber, setBomNumber] = useState(`BOM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`);
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<BOMLineInput[]>([
    { materialType: 'Main', description: '', quantity: 0, unit: 'YD', unitCost: 0, wastagePercent: 0 },
  ]);
  const [costEstimates, setCostEstimates] = useState<CostEstimateInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 实时成本计算 ──
  const costSummary = useMemo(() => {
    const materialCost = lines.reduce((sum, l) => {
      const eff = l.quantity * (1 + (l.wastagePercent ?? 0) / 100);
      return sum + eff * l.unitCost;
    }, 0);
    const extraMaterial = costEstimates.filter(c => c.costType === 'Material').reduce((s, c) => s + c.amount, 0);
    const laborCost = costEstimates.filter(c => c.costType === 'Labor').reduce((s, c) => s + c.amount, 0);
    const overheadCost = costEstimates.filter(c => c.costType === 'Overhead' || c.costType === 'Other').reduce((s, c) => s + c.amount, 0);
    const totalMaterial = materialCost + extraMaterial;
    const totalCost = totalMaterial + laborCost + overheadCost;
    const sp = sellingPrice ? parseFloat(sellingPrice) : 0;
    const profitAmount = sp ? sp - totalCost : 0;
    const profitMargin = sp > 0 ? (profitAmount / sp) * 100 : 0;
    return { totalMaterial, laborCost, overheadCost, totalCost, profitAmount, profitMargin };
  }, [lines, costEstimates, sellingPrice]);

  const handleAddLine = () => {
    setLines([...lines, { materialType: 'Main', description: '', quantity: 0, unit: 'YD', unitCost: 0, wastagePercent: 0 }]);
  };

  const handleRemoveLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleLineChange = (index: number, field: keyof BOMLineInput, value: any) => {
    setLines(lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const handleAddCost = () => {
    setCostEstimates([...costEstimates, { costType: 'Labor', description: '', amount: 0 }]);
  };

  const handleRemoveCost = (index: number) => {
    setCostEstimates(costEstimates.filter((_, i) => i !== index));
  };

  const handleCostChange = (index: number, field: keyof CostEstimateInput, value: any) => {
    setCostEstimates(costEstimates.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!bomNumber.trim() || !description.trim()) {
      setError('BOM 编号和描述为必填项');
      return;
    }
    if (lines.length === 0) {
      setError('至少需要一行物料明细');
      return;
    }
    for (const line of lines) {
      if (!line.description.trim()) {
        setError('所有物料行必须有品名描述');
        return;
      }
    }

    setSubmitting(true);
    try {
      const input: CreateBOMInput = {
        bomNumber: bomNumber.trim(),
        description: description.trim(),
        currency,
        sellingPrice: sellingPrice ? parseFloat(sellingPrice) : undefined,
        notes: notes.trim() || undefined,
        lines: lines.map(l => ({
          materialType: l.materialType,
          materialCode: l.materialCode || undefined,
          description: l.description.trim(),
          category: l.category || undefined,
          specification: l.specification || undefined,
          quantity: Number(l.quantity),
          unit: l.unit,
          wastagePercent: l.wastagePercent ?? 0,
          unitCost: Number(l.unitCost),
          notes: l.notes || undefined,
        })),
        costEstimates: costEstimates.length > 0 ? costEstimates.map(c => ({
          costType: c.costType,
          description: c.description.trim(),
          amount: Number(c.amount),
          notes: c.notes || undefined,
        })) : undefined,
      };
      await apiService.createBOM(input);
      onSuccess();
    } catch (e: any) {
      setError(e?.message || '创建 BOM 失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`w-full max-w-4xl max-h-[90vh] overflow-auto p-6 rounded-card ${cardClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-base font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>新建 BOM</h2>
          <button onClick={onClose} className={`p-1 rounded-control ${isDarkMode ? 'text-slate-400 hover:bg-white/5' : 'text-slate-400 hover:bg-slate-100'}`}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className={`mb-3 p-2 rounded-control text-xs ${isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
            {error}
          </div>
        )}

        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={labelClass}>BOM 编号 *</label>
            <input type="text" value={bomNumber} onChange={(e) => setBomNumber(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>描述 *</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="如：男款西装外套 - 款号 M2026-001" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>币种</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={fieldClass}>
              <option value="CNY">CNY 人民币</option>
              <option value="USD">USD 美元</option>
              <option value="EUR">EUR 欧元</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>销售单价（利润分析）</label>
            <input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="可选" className={fieldClass} />
          </div>
        </div>

        {/* 物料行 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className={labelClass}>物料明细</label>
            <button onClick={handleAddLine} className={`text-xs flex items-center gap-1 ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)]' : 'text-[var(--os-vnext-brand-blue)]'}`}>
              <Plus size={12} /> 添加行
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className={`p-2 rounded-inset ${isDarkMode ? 'bg-white/[0.02]' : 'bg-slate-50'}`}>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-2">
                    <label className={labelClass}>类型</label>
                    <select value={line.materialType} onChange={(e) => handleLineChange(index, 'materialType', e.target.value)} className={`${fieldClass} py-1.5 text-xs`}>
                      {MATERIAL_TYPES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className={labelClass}>品名 *</label>
                    <input type="text" value={line.description} onChange={(e) => handleLineChange(index, 'description', e.target.value)} className={`${fieldClass} py-1.5 text-xs`} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>物料编码</label>
                    <input type="text" value={line.materialCode || ''} onChange={(e) => handleLineChange(index, 'materialCode', e.target.value)} className={`${fieldClass} py-1.5 text-xs`} />
                  </div>
                  <div className="col-span-1">
                    <label className={labelClass}>用量</label>
                    <input type="number" value={line.quantity || ''} onChange={(e) => handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)} className={`${fieldClass} py-1.5 text-xs`} />
                  </div>
                  <div className="col-span-1">
                    <label className={labelClass}>单位</label>
                    <select value={line.unit} onChange={(e) => handleLineChange(index, 'unit', e.target.value)} className={`${fieldClass} py-1.5 text-xs`}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className={labelClass}>损耗%</label>
                    <input type="number" value={line.wastagePercent || ''} onChange={(e) => handleLineChange(index, 'wastagePercent', parseFloat(e.target.value) || 0)} className={`${fieldClass} py-1.5 text-xs`} />
                  </div>
                  <div className="col-span-1">
                    <label className={labelClass}>单价</label>
                    <input type="number" value={line.unitCost || ''} onChange={(e) => handleLineChange(index, 'unitCost', parseFloat(e.target.value) || 0)} className={`${fieldClass} py-1.5 text-xs`} />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => handleRemoveLine(index)} className={`p-1.5 rounded-control ${isDarkMode ? 'text-red-400 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'}`}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 成本估算项 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className={labelClass}>成本估算项（人工/费用，可选）</label>
            <button onClick={handleAddCost} className={`text-xs flex items-center gap-1 ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)]' : 'text-[var(--os-vnext-brand-blue)]'}`}>
              <Plus size={12} /> 添加成本项
            </button>
          </div>
          {costEstimates.length > 0 && (
            <div className="space-y-2">
              {costEstimates.map((cost, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-3">
                    <label className={labelClass}>类型</label>
                    <select value={cost.costType} onChange={(e) => handleCostChange(index, 'costType', e.target.value)} className={`${fieldClass} py-1.5 text-xs`}>
                      {COST_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="col-span-6">
                    <label className={labelClass}>描述</label>
                    <input type="text" value={cost.description} onChange={(e) => handleCostChange(index, 'description', e.target.value)} placeholder="如：裁剪人工 / 缝纫人工 / 厂房折旧" className={`${fieldClass} py-1.5 text-xs`} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>金额</label>
                    <input type="number" value={cost.amount || ''} onChange={(e) => handleCostChange(index, 'amount', parseFloat(e.target.value) || 0)} className={`${fieldClass} py-1.5 text-xs`} />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => handleRemoveCost(index)} className={`p-1.5 rounded-control ${isDarkMode ? 'text-red-400 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'}`}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 实时成本汇总 */}
        <div className={`p-3 rounded-card mb-4 ${isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}`}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div>
              <div className={labelClass}>物料合计</div>
              <div className={`font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{costSummary.totalMaterial.toFixed(2)}</div>
            </div>
            <div>
              <div className={labelClass}>人工合计</div>
              <div className={`font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{costSummary.laborCost.toFixed(2)}</div>
            </div>
            <div>
              <div className={labelClass}>费用合计</div>
              <div className={`font-normal ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{costSummary.overheadCost.toFixed(2)}</div>
            </div>
            <div>
              <div className={labelClass}>总成本</div>
              <div className={`font-normal text-base ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{costSummary.totalCost.toFixed(2)} {currency}</div>
            </div>
            <div>
              <div className={labelClass}>{sellingPrice ? '利润率' : '利润分析'}</div>
              <div className={`font-normal ${sellingPrice ? (costSummary.profitAmount >= 0 ? 'text-emerald-500' : 'text-red-500') : isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                {sellingPrice ? `${costSummary.profitMargin.toFixed(1)}%` : '填入售价'}
              </div>
            </div>
          </div>
        </div>

        {/* 备注 */}
        <div className="mb-4">
          <label className={labelClass}>备注</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fieldClass} resize-none`} />
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className={`h-9 px-4 rounded-control text-sm font-light ${isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="h-9 px-4 rounded-control text-sm font-light bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            创建 BOM
          </button>
        </div>
      </div>
    </div>
  );
};

export default BomManager;
