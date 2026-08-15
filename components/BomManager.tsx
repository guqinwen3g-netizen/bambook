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
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { RelatedEntitiesPanel } from './RelatedEntitiesPanel';

// ==================== 常量 ====================
// BDS v2.1：状态 → bds-badge 语义变体（主题透明，替代 statusSemanticClass 拼装）
type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

const MATERIAL_TYPES: Array<{ id: MaterialType; label: string; semantic: BadgeVariant }> = [
  { id: 'Main', label: '主料', semantic: 'info' },
  { id: 'Contrast', label: '对比料', semantic: 'info' },
  { id: 'Lining', label: '里布', semantic: 'neutral' },
  { id: 'Pocketing', label: '口袋布', semantic: 'neutral' },
  { id: 'Trimmings', label: '辅料', semantic: 'warning' },
  { id: 'Thread', label: '缝纫线', semantic: 'warning' },
  { id: 'Packaging', label: '包装', semantic: 'neutral' },
  { id: 'Other', label: '其他', semantic: 'neutral' },
];

const COST_TYPES: Array<{ id: CostType; label: string; semantic: BadgeVariant }> = [
  { id: 'Material', label: '物料成本', semantic: 'info' },
  { id: 'Labor', label: '人工成本', semantic: 'warning' },
  { id: 'Overhead', label: '制造费用', semantic: 'neutral' },
  { id: 'Other', label: '其他', semantic: 'neutral' },
];

// BOM 业务状态 → bds-badge 语义变体映射
const BOM_STATUS_BADGE_VARIANT: Record<BOMStatus, BadgeVariant> = {
  Draft: 'neutral',
  Confirmed: 'success',
  Archived: 'info',
};

const BOM_STATUS_LABEL: Record<BOMStatus, string> = {
  Draft: '草稿',
  Confirmed: '已确认',
  Archived: '已归档',
};

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

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader title="BOM 成本核算" subtitle="Bill of Materials" isDarkMode={isDarkMode} />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        {/* ── 工具栏 ── */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="bds-segment">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`seg ${statusFilter === tab.id ? 'active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 BOM 编号/描述..."
              className="bds-input sm pl-9"
              onKeyDown={(e) => { if (e.key === 'Enter') loadBOMs(); }}
            />
          </div>
          <button onClick={loadBOMs} className="bds-btn bds-btn-ghost">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bds-btn bds-btn-primary"
          >
            <Plus size={13} />
            <span>新建 BOM</span>
          </button>
        </div>

        {error && (
          <div className="bds-alert danger mb-3">
            <AlertCircle size={14} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="p-0.5" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── BOM 列表 ── */}
        <ScrollEdgeFades scrollRef={scrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {loading && boms.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-quaternary)' }}>
              <Loader2 size={16} className="animate-spin mr-2" /> 加载中...
            </div>
          ) : boms.length === 0 ? (
            <div className="bds-empty">
              <div className="glyph"><Calculator size={24} /></div>
              <div className="title">暂无 BOM</div>
              <div className="desc">点击「新建 BOM」创建</div>
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
                    className="bds-card"
                    style={{ padding: 0, overflow: 'hidden' }}
                  >
                    {/* ── BOM 头部（可展开） ── */}
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                      onClick={() => handleExpand(bom.id)}
                    >
                      <ChevronDown
                        size={16}
                        className={`transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                        style={{ color: 'var(--text-quaternary)' }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="bds-mono text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                            {bom.bomNumber}
                          </span>
                          <span className={`bds-badge sm ${BOM_STATUS_BADGE_VARIANT[bom.status] ?? 'neutral'}`}>
                            {BOM_STATUS_LABEL[bom.status] ?? bom.status}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>v{bom.version}</span>
                        </div>
                        <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                          {bom.description} · {lineCount} 行物料
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>总成本</div>
                          <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                            {formatCurrency(bom.totalCost, bom.currency)}
                          </div>
                        </div>
                        {bom.sellingPrice != null && (
                          <div className="text-right">
                            <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>利润率</div>
                            <div className="bds-tnum text-sm flex items-center gap-0.5" style={{ color: profitPositive ? 'var(--success-text)' : 'var(--danger-text)' }}>
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
                          <div className="px-4 pb-4 pt-1" style={{ borderTop: 'var(--border-subtle)' }}>
                            {/* 成本汇总卡片 */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 mt-2">
                              <div className="p-2 rounded-inset" style={{ background: 'var(--bg-panel)' }}>
                                <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>物料成本</div>
                                <div className="bds-tnum text-sm" style={{ color: 'var(--text-secondary)' }}>
                                  {formatCurrency(detail.totalMaterialCost, detail.currency)}
                                </div>
                              </div>
                              <div className="p-2 rounded-inset" style={{ background: 'var(--bg-panel)' }}>
                                <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>人工成本</div>
                                <div className="bds-tnum text-sm" style={{ color: 'var(--text-secondary)' }}>
                                  {formatCurrency(detail.totalLaborCost, detail.currency)}
                                </div>
                              </div>
                              <div className="p-2 rounded-inset" style={{ background: 'var(--bg-panel)' }}>
                                <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>制造费用</div>
                                <div className="bds-tnum text-sm" style={{ color: 'var(--text-secondary)' }}>
                                  {formatCurrency(detail.totalOverheadCost, detail.currency)}
                                </div>
                              </div>
                              <div className="p-2 rounded-inset" style={{ background: 'var(--bg-panel)' }}>
                                <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>总成本</div>
                                <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                                  {formatCurrency(detail.totalCost, detail.currency)}
                                </div>
                              </div>
                            </div>

                            {/* 利润分析 */}
                            {detail.sellingPrice != null && (
                              <div className="p-2 rounded-inset mb-3 flex items-center gap-4" style={{ background: 'var(--success-tint)' }}>
                                <div>
                                  <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>销售单价</div>
                                  <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                                    {formatCurrency(detail.sellingPrice, detail.currency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>利润额</div>
                                  <div className="bds-tnum text-sm" style={{ color: profitPositive ? 'var(--success-text)' : 'var(--danger-text)' }}>
                                    {formatCurrency(detail.profitAmount, detail.currency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>利润率</div>
                                  <div className="bds-tnum text-sm" style={{ color: profitPositive ? 'var(--success-text)' : 'var(--danger-text)' }}>
                                    {detail.profitMargin != null ? `${detail.profitMargin.toFixed(2)}%` : '—'}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* 物料行明细 */}
                            {lines.length > 0 && (
                              <div className="mb-3">
                                <div className="bds-overline mb-1.5" style={{ color: 'var(--text-tertiary)' }}>物料明细</div>
                                <div className="rounded-inset overflow-hidden overflow-x-auto" style={{ background: 'var(--bg-panel)' }}>
                                  <table className="bds-table">
                                    <thead>
                                      <tr>
                                        <th>#</th>
                                        <th>类型</th>
                                        <th>物料编码</th>
                                        <th>品名</th>
                                        <th className="num">用量</th>
                                        <th className="num">损耗</th>
                                        <th className="num">实耗</th>
                                        <th className="num">单价</th>
                                        <th className="num">金额</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {lines.map((line) => (
                                        <tr key={line.id}>
                                          <td style={{ color: 'var(--text-quaternary)' }}>{line.lineNumber}</td>
                                          <td>
                                            <span className={`bds-badge sm ${MATERIAL_TYPES.find(m => m.id === line.materialType)?.semantic ?? 'neutral'}`}>
                                              {MATERIAL_TYPES.find(m => m.id === line.materialType)?.label || line.materialType}
                                            </span>
                                          </td>
                                          <td className="bds-mono" style={{ color: 'var(--text-secondary)' }}>{line.materialCode || '—'}</td>
                                          <td style={{ color: 'var(--text-primary)' }}>{line.description}</td>
                                          <td className="num" style={{ color: 'var(--text-secondary)' }}>{line.quantity} {line.unit}</td>
                                          <td className="num" style={{ color: 'var(--text-tertiary)' }}>{line.wastagePercent}%</td>
                                          <td className="num" style={{ color: 'var(--text-secondary)' }}>{line.effectiveQty}</td>
                                          <td className="num" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(line.unitCost, line.currency)}</td>
                                          <td className="num bds-tnum" style={{ color: 'var(--text-primary)' }}>{formatCurrency(line.amount, line.currency)}</td>
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
                                <div className="bds-overline mb-1.5" style={{ color: 'var(--text-tertiary)' }}>成本估算项</div>
                                <div className="space-y-1">
                                  {costEstimates.map((ce) => (
                                    <div key={ce.id} className="flex items-center justify-between text-xs py-1 px-2 rounded-inset" style={{ background: 'var(--bg-panel)' }}>
                                      <div className="flex items-center gap-2">
                                        <span className={`bds-badge sm ${COST_TYPES.find(c => c.id === ce.costType)?.semantic ?? 'neutral'}`}>
                                          {COST_TYPES.find(c => c.id === ce.costType)?.label || ce.costType}
                                        </span>
                                        <span style={{ color: 'var(--text-secondary)' }}>{ce.description}</span>
                                      </div>
                                      <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{formatCurrency(ce.amount, ce.currency)}</span>
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
                                    className="bds-btn bds-btn-primary"
                                  >
                                    {actionLoading === `confirm_${bom.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                    <span>确认 BOM</span>
                                  </button>
                                  <button
                                    onClick={() => handleRecalculate(bom.id)}
                                    disabled={actionLoading === `recalc_${bom.id}`}
                                    className="bds-btn bds-btn-ghost"
                                  >
                                    {actionLoading === `recalc_${bom.id}` ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
                                    <span>重新计算</span>
                                  </button>
                                  <button
                                    onClick={() => handleDelete(bom.id)}
                                    disabled={actionLoading === `delete_${bom.id}`}
                                    className="bds-btn bds-btn-danger"
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
                                  className="bds-btn bds-btn-ghost"
                                >
                                  {actionLoading === `archive_${bom.id}` ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                                  <span>归档</span>
                                </button>
                              )}
                            </div>

                            {/* 跨模块关联视图（EntityLink 图谱）— 所属订单/关联产品/来源报价 */}
                            <RelatedEntitiesPanel
                              type="bom"
                              id={bom.id}
                              isDarkMode={isDarkMode}
                              title="BOM 关联视图"
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
        </div>

        {/* ── 创建 BOM 弹窗 ── */}
        <AnimatePresence>
          {showCreateForm && (
            <CreateBOMModal
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
  onClose: () => void;
  onSuccess: () => void;
}

const CreateBOMModal: React.FC<CreateBOMModalProps> = ({ onClose, onSuccess }) => {
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

  const labelCls = 'block text-xs mb-1 text-[var(--text-tertiary)]';

  return (
    <div className="bds-modal-mask" onClick={onClose}>
      <div
        className="bds-modal"
        style={{ width: '56rem', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base" style={{ color: 'var(--text-primary)' }}>新建 BOM</h2>
          <button onClick={onClose} className="bds-btn bds-btn-ghost bds-btn-icon">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="bds-alert danger mb-3">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={labelCls}>BOM 编号 *</label>
            <input type="text" value={bomNumber} onChange={(e) => setBomNumber(e.target.value)} className="bds-input sm" />
          </div>
          <div>
            <label className={labelCls}>描述 *</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="如：男款西装外套 - 款号 M2026-001" className="bds-input sm" />
          </div>
          <div>
            <label className={labelCls}>币种</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}>
              <option value="CNY">CNY 人民币</option>
              <option value="USD">USD 美元</option>
              <option value="EUR">EUR 欧元</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>销售单价（利润分析）</label>
            <input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="可选" className="bds-input sm" />
          </div>
        </div>

        {/* 物料行 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className={labelCls}>物料明细</label>
            <button onClick={handleAddLine} className="bds-btn bds-btn-ghost" style={{ color: 'var(--accent-text)' }}>
              <Plus size={12} /> 添加行
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="p-2 rounded-inset" style={{ background: 'var(--bg-panel)' }}>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-2">
                    <label className={labelCls}>类型</label>
                    <select value={line.materialType} onChange={(e) => handleLineChange(index, 'materialType', e.target.value)} className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}>
                      {MATERIAL_TYPES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className={labelCls}>品名 *</label>
                    <input type="text" value={line.description} onChange={(e) => handleLineChange(index, 'description', e.target.value)} className="bds-input sm" />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>物料编码</label>
                    <input type="text" value={line.materialCode || ''} onChange={(e) => handleLineChange(index, 'materialCode', e.target.value)} className="bds-input sm" />
                  </div>
                  <div className="col-span-1">
                    <label className={labelCls}>用量</label>
                    <input type="number" value={line.quantity || ''} onChange={(e) => handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)} className="bds-input sm" />
                  </div>
                  <div className="col-span-1">
                    <label className={labelCls}>单位</label>
                    <select value={line.unit} onChange={(e) => handleLineChange(index, 'unit', e.target.value)} className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className={labelCls}>损耗%</label>
                    <input type="number" value={line.wastagePercent || ''} onChange={(e) => handleLineChange(index, 'wastagePercent', parseFloat(e.target.value) || 0)} className="bds-input sm" />
                  </div>
                  <div className="col-span-1">
                    <label className={labelCls}>单价</label>
                    <input type="number" value={line.unitCost || ''} onChange={(e) => handleLineChange(index, 'unitCost', parseFloat(e.target.value) || 0)} className="bds-input sm" />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => handleRemoveLine(index)} className="bds-btn bds-btn-danger bds-btn-icon">
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
            <label className={labelCls}>成本估算项（人工/费用，可选）</label>
            <button onClick={handleAddCost} className="bds-btn bds-btn-ghost" style={{ color: 'var(--accent-text)' }}>
              <Plus size={12} /> 添加成本项
            </button>
          </div>
          {costEstimates.length > 0 && (
            <div className="space-y-2">
              {costEstimates.map((cost, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-3">
                    <label className={labelCls}>类型</label>
                    <select value={cost.costType} onChange={(e) => handleCostChange(index, 'costType', e.target.value)} className="bds-select" style={{ height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}>
                      {COST_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="col-span-6">
                    <label className={labelCls}>描述</label>
                    <input type="text" value={cost.description} onChange={(e) => handleCostChange(index, 'description', e.target.value)} placeholder="如：裁剪人工 / 缝纫人工 / 厂房折旧" className="bds-input sm" />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>金额</label>
                    <input type="number" value={cost.amount || ''} onChange={(e) => handleCostChange(index, 'amount', parseFloat(e.target.value) || 0)} className="bds-input sm" />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => handleRemoveCost(index)} className="bds-btn bds-btn-danger bds-btn-icon">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 实时成本汇总 */}
        <div className="p-3 rounded-card mb-4" style={{ background: 'var(--bg-panel)' }}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div>
              <div className={labelCls}>物料合计</div>
              <div className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{costSummary.totalMaterial.toFixed(2)}</div>
            </div>
            <div>
              <div className={labelCls}>人工合计</div>
              <div className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{costSummary.laborCost.toFixed(2)}</div>
            </div>
            <div>
              <div className={labelCls}>费用合计</div>
              <div className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{costSummary.overheadCost.toFixed(2)}</div>
            </div>
            <div>
              <div className={labelCls}>总成本</div>
              <div className="bds-tnum text-base" style={{ color: 'var(--text-primary)' }}>{costSummary.totalCost.toFixed(2)} {currency}</div>
            </div>
            <div>
              <div className={labelCls}>{sellingPrice ? '利润率' : '利润分析'}</div>
              <div className="bds-tnum" style={{ color: sellingPrice ? (costSummary.profitAmount >= 0 ? 'var(--success-text)' : 'var(--danger-text)') : 'var(--text-quaternary)' }}>
                {sellingPrice ? `${costSummary.profitMargin.toFixed(1)}%` : '填入售价'}
              </div>
            </div>
          </div>
        </div>

        {/* 备注 */}
        <div className="mb-4">
          <label className={labelCls}>备注</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bds-input bds-textarea" style={{ resize: 'none' }} />
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="bds-btn bds-btn-ghost"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="bds-btn bds-btn-primary"
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
