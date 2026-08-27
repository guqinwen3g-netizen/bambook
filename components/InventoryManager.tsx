/**
 * 库存管理 InventoryManager
 * Phase 2 B2 缺失模块补齐：多仓库 + 库存物料 + 库存变动 + 预警
 *
 * 功能：
 *   - 仓库管理（多仓库 CRUD）
 *   - 库存物料列表（按仓库/品类/搜索/低库存过滤）
 *   - 库存变动：入库/出库/调拨/盘点/锁定/解锁（含流水审计）
 *   - 低库存预警面板
 *   - 物料详情（含最近变动流水）
 *
 * BDS v2.1：视觉层已迁移至组件族（bds-segment/bds-card/bds-badge/bds-input/bds-modal 等），
 * 本组件对主题透明 — 无 isDarkMode 样式分支，暗色由 tokens.css [data-theme] 统一覆盖。
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  ClipboardCheck,
  Lock,
  Unlock,
  X,
  AlertTriangle,
  FileDown,
  Package,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { consumeCrossModuleNav } from '../services/crossModuleNav';
import SampleRoomPanel from './development/SampleRoomPanel';
import {
  Warehouse,
  WarehouseInput,
  WarehouseType,
  InventoryItem,
  InventoryItemInput,
  StockMovement,
  StockMovementInput,
  StockMovementType,
  View,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import { bdsConfirm } from './ui/BdsDialog';
import { StatusSemantic } from './rdlBusinessStatusTokens';
import ScrollEdgeFades from './ui/ScrollEdgeFades';

// ==================== 常量 ====================
const WAREHOUSE_TYPES: Array<{ id: WarehouseType; label: string }> = [
  { id: 'Main', label: '主仓' },
  { id: 'Auxiliary', label: '辅仓' },
  { id: 'Temporary', label: '临时仓' },
  { id: 'Virtual', label: '虚拟仓' },
];

const ITEM_CATEGORIES = ['Fabric', 'Trimmings', 'Accessories', 'Garment', 'Other'];
const UNITS = ['YD', 'M', 'KG', 'PC', 'SET'];

// BDS v2.1：semantic 与 bds-badge 语义变体同名（neutral/info/success/danger/warning），直接映射
const MOVEMENT_TYPES: Array<{ id: StockMovementType; label: string; icon: React.ReactNode; semantic: StatusSemantic }> = [
  { id: 'Inbound', label: '入库', icon: <ArrowDownToLine size={14} />, semantic: 'success' },
  { id: 'Outbound', label: '出库', icon: <ArrowUpFromLine size={14} />, semantic: 'warning' },
  { id: 'Transfer', label: '调拨', icon: <ArrowLeftRight size={14} />, semantic: 'info' },
  { id: 'Adjustment', label: '盘点', icon: <ClipboardCheck size={14} />, semantic: 'neutral' },
  { id: 'Lock', label: '锁定', icon: <Lock size={14} />, semantic: 'warning' },
  { id: 'Unlock', label: '解锁', icon: <Unlock size={14} />, semantic: 'success' },
];

// ── A3 盘点高危操作防护（纯函数，测试可直引）──
/** 数量格式化：en-US 千分位、最多 2 位小数 */
const formatQty = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** 盘点差异 = 盘点后实际数量 − 账面数量 */
export function computeStocktakingDiff(bookQty: number, countedQty: number): number {
  return Number(countedQty) - Number(bookQty);
}

/** 带符号数量格式化（口径同 formatQty）：+50 / -50 / 0 */
export function formatSignedQty(n: number): string {
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v > 0) return `+${abs}`;
  if (v < 0) return `-${abs}`;
  return '0';
}

interface InventoryManagerProps {
  isDarkMode: boolean;
  /** 跨模块导航：切 View（样品间 chips 点击跳转用） */
  onNavigate?: (view: View) => void;
  /** 打开订单详情（样品间关联订单 chip 点击跳转用） */
  onOpenOrder?: (orderId: string) => void;
}

const InventoryManager: React.FC<InventoryManagerProps> = ({ isDarkMode, onNavigate, onOpenOrder }) => {
  // 跨模块导航消费（挂载时一次）：开发单详情「样品库存」按钮跳转过来时，
  // tab='samples' 直达样品 Tab，focusEntityId=devCaseId 预过滤样品间列表；
  // 产品档案详情反查跳转时 filter.product 锚 → productAssetId 预过滤。
  const navCtx = useState(() => consumeCrossModuleNav())[0];
  const navToSamples = navCtx?.view === View.Inventory && navCtx?.tab === 'samples';
  const navProductFilter = navToSamples && navCtx?.filter?.anchor === 'product' ? navCtx.filter.productId ?? null : null;
  const [activeTab, setActiveTab] = useState<'items' | 'warehouses' | 'alerts' | 'samples'>(navToSamples ? 'samples' : 'items');
  const [sampleFilterDevCaseId, setSampleFilterDevCaseId] = useState<string | null>(
    navToSamples && !navProductFilter ? navCtx?.focusEntityId ?? null : null,
  );
  const [sampleFilterProductAssetId, setSampleFilterProductAssetId] = useState<string | null>(navProductFilter);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [lowStockItems, setLowStockItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [movementsByItem, setMovementsByItem] = useState<Record<string, StockMovement[]>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // B5 运营域报表：库存台账 Excel 导出（当前筛选全量）
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const handleExportXlsx = useCallback(async () => {
    setExportingXlsx(true);
    setError(null);
    try {
      await apiService.exportInventoryItemsXlsx({
        ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
        ...(lowStockOnly ? { lowStockOnly: true } : {}),
      });
    } catch (e: any) {
      setError(`台账导出失败：${e?.message || e}`);
    } finally {
      setExportingXlsx(false);
    }
  }, [warehouseFilter, categoryFilter, searchQuery, lowStockOnly]);

  // 创建仓库表单
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState<WarehouseInput>({
    code: '', name: '', type: 'Main', address: '', manager: '', phone: '', notes: '',
  });
  const [warehouseFormError, setWarehouseFormError] = useState<string | null>(null);

  // 创建物料表单
  const [showItemForm, setShowItemForm] = useState(false);
  const [itemForm, setItemForm] = useState<InventoryItemInput>({
    warehouseId: '', materialCode: '', description: '', category: 'Fabric',
    specification: '', batchNumber: '', locationCode: '', quantity: 0, unit: 'YD',
    unitCost: undefined, minStock: undefined, maxStock: undefined, notes: '',
  });
  const [itemFormError, setItemFormError] = useState<string | null>(null);

  // 库存变动表单
  const [movementTargetId, setMovementTargetId] = useState<string | null>(null);
  const [movementForm, setMovementForm] = useState<StockMovementInput>({
    itemId: '', type: 'Inbound', quantity: 0, reason: '', movementDate: new Date().toISOString().split('T')[0],
  });
  const [movementError, setMovementError] = useState<string | null>(null);

  // ── 拉取数据 ──
  const fetchWarehouses = useCallback(async () => {
    try {
      const data = await apiService.listWarehouses();
      setWarehouses(data);
      if (data.length > 0 && !itemForm.warehouseId) {
        setItemForm(prev => ({ ...prev, warehouseId: data[0].id }));
      }
    } catch { /* 静默 */ }
  }, [itemForm.warehouseId]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.listInventoryItems({
        warehouseId: warehouseFilter || undefined,
        category: categoryFilter || undefined,
        search: searchQuery || undefined,
        lowStockOnly,
        limit: 200,
      });
      // 计算 availableQuantity
      const itemsWithAvail = result.items.map(it => ({
        ...it,
        availableQuantity: Number(it.quantity) - Number(it.lockedQuantity),
      }));
      setItems(itemsWithAvail);
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [warehouseFilter, categoryFilter, searchQuery, lowStockOnly]);

  const fetchLowStock = useCallback(async () => {
    try {
      const data = await apiService.getLowStockAlerts();
      setLowStockItems(data);
    } catch { /* 静默 */ }
  }, []);

  useEffect(() => { fetchWarehouses(); }, [fetchWarehouses]);
  useEffect(() => {
    if (activeTab === 'items') fetchItems();
    if (activeTab === 'alerts') fetchLowStock();
  }, [activeTab, fetchItems, fetchLowStock]);

  // ── 拉取物料变动流水 ──
  const fetchMovements = useCallback(async (itemId: string) => {
    try {
      const result = await apiService.listStockMovements({ itemId, limit: 20 });
      setMovementsByItem(prev => ({ ...prev, [itemId]: result.items }));
    } catch { /* 静默 */ }
  }, []);

  const handleExpand = useCallback((itemId: string) => {
    if (expandedId === itemId) {
      setExpandedId(null);
    } else {
      setExpandedId(itemId);
      fetchMovements(itemId);
    }
  }, [expandedId, fetchMovements]);

  // ── 创建仓库 ──
  const handleCreateWarehouse = useCallback(async () => {
    setWarehouseFormError(null);
    if (!warehouseForm.code || !warehouseForm.name) {
      setWarehouseFormError('请填写仓库编码和名称'); return;
    }
    setActionLoading('create-warehouse');
    try {
      await apiService.createWarehouse(warehouseForm);
      setShowWarehouseForm(false);
      setWarehouseForm({ code: '', name: '', type: 'Main', address: '', manager: '', phone: '', notes: '' });
      await fetchWarehouses();
    } catch (e: any) {
      setWarehouseFormError(`创建失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [warehouseForm, fetchWarehouses]);

  // ── 创建物料 ──
  const handleCreateItem = useCallback(async () => {
    setItemFormError(null);
    if (!itemForm.warehouseId || !itemForm.description || !itemForm.unit) {
      setItemFormError('请填写仓库 / 品名 / 单位'); return;
    }
    setActionLoading('create-item');
    try {
      await apiService.createInventoryItem(itemForm);
      setShowItemForm(false);
      setItemForm({
        warehouseId: warehouses[0]?.id || '', materialCode: '', description: '', category: 'Fabric',
        specification: '', batchNumber: '', locationCode: '', quantity: 0, unit: 'YD',
        unitCost: undefined, minStock: undefined, maxStock: undefined, notes: '',
      });
      await fetchItems();
    } catch (e: any) {
      setItemFormError(`创建失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [itemForm, warehouses, fetchItems]);

  // ── 库存变动 ──
  const handleCreateMovement = useCallback(async () => {
    setMovementError(null);
    if (!movementTargetId || !movementForm.type || !movementForm.quantity) {
      setMovementError('请填写变动类型和数量'); return;
    }
    if (movementForm.type === 'Transfer' && !movementForm.targetWarehouseId) {
      setMovementError('调拨必须指定目标仓库'); return;
    }
    // A3 盘点高危操作防护：盘点数量语义为「盘点后实际总数」而非差值，
    // 提交前显式确认 账面 → 盘点 → 差异，防仓管误填差值导致库存被覆盖
    if (movementForm.type === 'Adjustment') {
      const target = items.find(it => it.id === movementTargetId);
      const bookQty = Number(target?.quantity ?? 0);
      const countedQty = Number(movementForm.quantity);
      const unit = target?.unit || '';
      const confirmed = await bdsConfirm({
        title: '确认盘点',
        body: `账面 ${formatQty(bookQty)} ${unit} → 盘点 ${formatQty(countedQty)} ${unit}，差异 ${formatSignedQty(computeStocktakingDiff(bookQty, countedQty))} ${unit}。\n确认提交？`,
        confirmText: '确认提交',
      });
      if (!confirmed) return;
    }
    setActionLoading(`movement_${movementTargetId}`);
    try {
      // E6：手工变动可挂关联单据号（referenceId；有单据号时 referenceType 记 Manual 台账口径）
      const referenceId = movementForm.referenceId?.trim() || undefined;
      await apiService.createStockMovement({
        ...movementForm,
        itemId: movementTargetId,
        referenceId,
        referenceType: referenceId ? 'Manual' : movementForm.referenceType,
      });
      setMovementTargetId(null);
      setMovementForm({
        itemId: '', type: 'Inbound', quantity: 0, reason: '', referenceId: '',
        movementDate: new Date().toISOString().split('T')[0],
      });
      await fetchItems();
      await fetchLowStock();
    } catch (e: any) {
      setMovementError(`操作失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [movementTargetId, movementForm, items, fetchItems, fetchLowStock]);

  // ── 辅助 ──
  const formatDate = (s?: string) => s || '—';
  const warehouseName = (id: string) => warehouses.find(w => w.id === id)?.name || id;

  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
  const labelCls = 'block text-xs mb-1 text-[var(--text-tertiary)]';

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader
        title="库存管理"
        subtitle="Inventory"
        isDarkMode={isDarkMode}
        actions={
          activeTab === 'items' ? (
            <button onClick={() => setShowItemForm(true)} className="bds-btn bds-btn-primary">
              <Plus size={14} /><span>新增物料</span>
            </button>
          ) : activeTab === 'warehouses' ? (
            <button onClick={() => setShowWarehouseForm(true)} className="bds-btn bds-btn-primary">
              <Plus size={14} /><span>新增仓库</span>
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <ScrollEdgeFades scrollRef={{ current: null }} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* 顶部 Tab 切换 */}
          <div className="bds-segment mb-4">
            <button onClick={() => setActiveTab('items')} className={`seg ${activeTab === 'items' ? 'active' : ''}`}>
              <Boxes size={14} className="inline mr-1" />库存物料
            </button>
            <button onClick={() => setActiveTab('warehouses')} className={`seg ${activeTab === 'warehouses' ? 'active' : ''}`}>
              <WarehouseIcon size={14} className="inline mr-1" />仓库
            </button>
            <button onClick={() => setActiveTab('alerts')} className={`seg ${activeTab === 'alerts' ? 'active' : ''}`}>
              <AlertTriangle size={14} className="inline mr-1" />预警
              {lowStockItems.length > 0 && (
                <span className="bds-badge sm danger ml-1">{lowStockItems.length}</span>
              )}
            </button>
            <button onClick={() => setActiveTab('samples')} className={`seg ${activeTab === 'samples' ? 'active' : ''}`}>
              <Package size={14} className="inline mr-1" />样品
            </button>
          </div>

          {error && (
            <div className="bds-alert danger mb-3">
              <AlertCircle size={16} />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto p-0.5" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}>
                <X size={14} />
              </button>
            </div>
          )}

          {/* ════════════ 库存物料 Tab ════════════ */}
          {activeTab === 'items' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {/* 工具栏 */}
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="bds-filterbar">
                  <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className="bds-select" style={{ maxWidth: 160 }}>
                    <option value="">全部仓库</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="bds-select" style={{ maxWidth: 120 }}>
                    <option value="">全部品类</option>
                    {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <label className="bds-check" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
                    <span className="box"></span>
                    仅低库存
                  </label>
                  <div className="relative flex-1 max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索物料..." className="bds-input sm pl-9" />
                  </div>
                  <button onClick={fetchItems} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>
                {/* B5 运营域报表：库存台账 Excel 导出（当前筛选全量） */}
                <button onClick={() => void handleExportXlsx()} disabled={exportingXlsx} className="bds-btn bds-btn-secondary">
                  {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                  <span>导出台账</span>
                </button>
              </div>

              {/* 列表 */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                </div>
              ) : items.length === 0 ? (
                <div className="bds-empty">
                  <div className="glyph"><Boxes size={24} /></div>
                  <div className="title">暂无库存物料</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item, index) => {
                    const isLowStock = item.minStock != null && Number(item.quantity) <= Number(item.minStock);
                    const movements = movementsByItem[item.id] || [];
                    return (
                      <motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }} className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
                        {/* 卡片头部 */}
                        <div className="flex items-center gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]" onClick={() => handleExpand(item.id)}>
                          <button className="flex-shrink-0" style={{ color: 'var(--text-quaternary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                            {expandedId === item.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>{item.materialCode || '—'}</span>
                              {isLowStock && (
                                <span className="bds-badge sm danger">低库存</span>
                              )}
                              {Number(item.lockedQuantity) > 0 && (
                                <span className="bds-badge sm warning">
                                  锁定 {formatQty(Number(item.lockedQuantity))}
                                </span>
                              )}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              {item.description} · {item.warehouse?.name || warehouseName(item.warehouseId)}
                              {item.batchNumber ? ` · 批次 ${item.batchNumber}` : ''}
                              {item.locationCode ? ` · ${item.locationCode}` : ''}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="bds-tnum text-sm" style={{ color: isLowStock ? 'var(--danger-text)' : 'var(--text-primary)' }}>
                              {formatQty(Number(item.quantity))} <span className="text-xs opacity-60">{item.unit}</span>
                            </div>
                            {item.minStock != null && (
                              <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>最低 {formatQty(Number(item.minStock))}</div>
                            )}
                          </div>
                        </div>

                        {/* 展开详情 */}
                        <AnimatePresence>
                          {expandedId === item.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden" style={{ borderTop: 'var(--border-subtle)' }}>
                              <div className="p-4 space-y-3">
                                {/* 物料信息 */}
                                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                  {item.category && <div><span className="opacity-60">品类:</span> {item.category}</div>}
                                  {item.specification && <div><span className="opacity-60">规格:</span> {item.specification}</div>}
                                  {item.unitCost != null && <div><span className="opacity-60">单位成本:</span> {Number(item.unitCost).toFixed(2)} {item.currency}</div>}
                                  {item.lastInDate && <div><span className="opacity-60">最后入库:</span> {formatDate(item.lastInDate)}</div>}
                                  {item.lastOutDate && <div><span className="opacity-60">最后出库:</span> {formatDate(item.lastOutDate)}</div>}
                                  {item.maxStock != null && <div><span className="opacity-60">最高库存:</span> {formatQty(Number(item.maxStock))}</div>}
                                </div>

                                {/* 可用库存摘要 */}
                                <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                  <span>当前: <span style={{ color: 'var(--text-primary)' }}>{formatQty(Number(item.quantity))}</span> {item.unit}</span>
                                  <span>锁定: <span style={{ color: 'var(--warning-text)' }}>{formatQty(Number(item.lockedQuantity))}</span></span>
                                  <span>可用: <span style={{ color: 'var(--success-text)' }}>{formatQty(item.availableQuantity)}</span></span>
                                </div>

                                {/* 变动流水 */}
                                {movements.length > 0 && (
                                  <div>
                                    <h4 className="bds-overline mb-2" style={{ color: 'var(--text-tertiary)' }}>最近变动</h4>
                                    <div className="space-y-1">
                                      {movements.slice(0, 8).map(mv => {
                                        const mt = MOVEMENT_TYPES.find(m => m.id === mv.type);
                                        return (
                                          <div key={mv.id} className="p-2 rounded-inset flex items-center gap-3 text-xs bds-inset">
                                            <span className={`bds-badge sm ${mt?.semantic || 'neutral'}`}>
                                              {mt?.icon} {mt?.label || mv.type}
                                            </span>
                                            <span className="bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatQty(Number(mv.quantity))} {mv.unit}</span>
                                            <span style={{ color: 'var(--text-quaternary)' }}>{formatDate(mv.movementDate)}</span>
                                            <span className="ml-auto bds-tnum" style={{ color: 'var(--text-tertiary)' }}>
                                              {formatQty(Number(mv.balanceBefore))} → {formatQty(Number(mv.balanceAfter))}
                                            </span>
                                            {mv.reason && <span style={{ color: 'var(--text-quaternary)' }}>· {mv.reason}</span>}
                                            {mv.referenceId && <span className="bds-mono" style={{ color: 'var(--text-quaternary)' }}>· 单 {mv.referenceId}</span>}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* 库存变动表单 */}
                                <AnimatePresence>
                                  {movementTargetId === item.id && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                      <div className="p-3 rounded-inset bds-inset">
                                        <h4 className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>库存变动</h4>
                                        {/* A3 盘点防护：账面数对比 + 实时差异（盘点数量语义 = 盘点后实际总数） */}
                                        {movementForm.type === 'Adjustment' && (() => {
                                          const bookQty = Number(item.quantity);
                                          const diff = computeStocktakingDiff(bookQty, Number(movementForm.quantity));
                                          const diffColor = diff > 0 ? 'var(--success-text)' : diff < 0 ? 'var(--danger-text)' : 'var(--text-secondary)';
                                          return (
                                            <div className="flex items-center gap-4 text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                              <span>当前账面：<span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{formatQty(bookQty)}</span> {item.unit}</span>
                                              <span>
                                                差异：
                                                {movementForm.quantity ? (
                                                  <span className="bds-tnum" style={{ color: diffColor }}>{formatSignedQty(diff)} {item.unit}</span>
                                                ) : (
                                                  <span style={{ color: 'var(--text-quaternary)' }}>输入盘点后实际数量实时显示</span>
                                                )}
                                              </span>
                                            </div>
                                          );
                                        })()}
                                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-2">
                                          <select value={movementForm.type} onChange={(e) => setMovementForm({ ...movementForm, type: e.target.value as StockMovementType })} className="bds-select sm">
                                            {MOVEMENT_TYPES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                          </select>
                                          <input type="number" value={movementForm.quantity || ''} onChange={(e) => setMovementForm({ ...movementForm, quantity: parseFloat(e.target.value) || 0 })} placeholder={movementForm.type === 'Adjustment' ? '盘点后实际数量 *' : '数量 *'} className="bds-input sm" />
                                          <CapsuleDateInput value={movementForm.movementDate || ''} onChange={(v) => setMovementForm({ ...movementForm, movementDate: v })} className="bds-input sm" />
                                          <input type="text" value={movementForm.reason || ''} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })} placeholder="原因" className="bds-input sm" />
                                          {/* E6：关联单据号（如 PO-2026-001 / MR-001，随变动流水落库可追溯） */}
                                          <input type="text" value={movementForm.referenceId || ''} onChange={(e) => setMovementForm({ ...movementForm, referenceId: e.target.value })} placeholder="关联单据号" className="bds-input sm" />
                                          {movementForm.type === 'Transfer' && (
                                            <select value={movementForm.targetWarehouseId || ''} onChange={(e) => setMovementForm({ ...movementForm, targetWarehouseId: e.target.value })} className="bds-select sm xl:col-span-2">
                                              <option value="">目标仓库...</option>
                                              {warehouses.filter(w => w.id !== item.warehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                            </select>
                                          )}
                                          {movementForm.type === 'Adjustment' && (
                                            <input type="text" value={movementForm.notes || ''} onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })} placeholder="盘点备注" className="bds-input sm xl:col-span-2" />
                                          )}
                                        </div>
                                        {movementError && <div className="text-xs mb-2" style={{ color: 'var(--danger-text)' }}>{movementError}</div>}
                                        <div className="flex items-center justify-end gap-2">
                                          <button onClick={() => { setMovementTargetId(null); setMovementError(null); }} className="bds-btn bds-btn-ghost">取消</button>
                                          <button onClick={handleCreateMovement} disabled={actionLoading === `movement_${item.id}`} className="bds-btn bds-btn-primary">
                                            {actionLoading === `movement_${item.id}` ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                            <span>执行变动</span>
                                          </button>
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                {/* 操作按钮 */}
                                <div className="flex items-center gap-2 pt-2 flex-wrap">
                                  <button onClick={() => { setMovementTargetId(movementTargetId === item.id ? null : item.id); setMovementError(null); setMovementForm({ ...movementForm, type: 'Inbound', quantity: 0 }); }} className="bds-btn bds-btn-ghost" style={{ color: 'var(--accent-text)' }}>
                                    <ArrowDownToLine size={14} /><span>{movementTargetId === item.id ? '收起' : '库存变动'}</span>
                                  </button>
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

              {/* 创建物料表单 */}
              <AnimatePresence>
                {showItemForm && (
                  <motion.div key="item-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bds-modal-mask" onClick={() => setShowItemForm(false)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bds-modal" style={{ width: '42rem', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="bds-text-lg" style={{ color: 'var(--text-primary)' }}>新增库存物料</h3>
                        <button onClick={() => setShowItemForm(false)} className="bds-btn bds-btn-ghost bds-btn-icon"><X size={18} /></button>
                      </div>
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                        <div><label className={labelCls}>仓库 *</label><select value={itemForm.warehouseId} onChange={(e) => setItemForm({ ...itemForm, warehouseId: e.target.value })} className="bds-select">{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
                        <div><label className={labelCls}>物料编码</label><input type="text" value={itemForm.materialCode} onChange={(e) => setItemForm({ ...itemForm, materialCode: e.target.value })} className="bds-input" /></div>
                        <div><label className={labelCls}>品类</label><select value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} className="bds-select">{ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                        <div className="xl:col-span-2"><label className={labelCls}>品名描述 *</label><input type="text" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} className="bds-input" /></div>
                        <div><label className={labelCls}>单位 *</label><select value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} className="bds-select">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                        <div><label className={labelCls}>初始数量</label><input type="number" value={itemForm.quantity || ''} onChange={(e) => setItemForm({ ...itemForm, quantity: parseFloat(e.target.value) || 0 })} className="bds-input" /></div>
                        <div><label className={labelCls}>单位成本</label><input type="number" step="0.01" value={itemForm.unitCost ?? ''} onChange={(e) => setItemForm({ ...itemForm, unitCost: e.target.value ? parseFloat(e.target.value) : undefined })} className="bds-input" /></div>
                        <div><label className={labelCls}>批次号</label><input type="text" value={itemForm.batchNumber} onChange={(e) => setItemForm({ ...itemForm, batchNumber: e.target.value })} className="bds-input" /></div>
                        <div><label className={labelCls}>库位</label><input type="text" value={itemForm.locationCode} onChange={(e) => setItemForm({ ...itemForm, locationCode: e.target.value })} className="bds-input" /></div>
                        <div><label className={labelCls}>最低库存</label><input type="number" step="0.01" value={itemForm.minStock ?? ''} onChange={(e) => setItemForm({ ...itemForm, minStock: e.target.value ? parseFloat(e.target.value) : undefined })} className="bds-input" /></div>
                        <div><label className={labelCls}>最高库存</label><input type="number" step="0.01" value={itemForm.maxStock ?? ''} onChange={(e) => setItemForm({ ...itemForm, maxStock: e.target.value ? parseFloat(e.target.value) : undefined })} className="bds-input" /></div>
                      </div>
                      {itemFormError && <div className="mt-3 text-xs" style={{ color: 'var(--danger-text)' }}>{itemFormError}</div>}
                      <div className="flex items-center justify-end gap-2 mt-4">
                        <button onClick={() => setShowItemForm(false)} className="bds-btn bds-btn-ghost">取消</button>
                        <button onClick={handleCreateItem} disabled={actionLoading === 'create-item'} className="bds-btn bds-btn-primary">
                          {actionLoading === 'create-item' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}<span>创建</span>
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ════════════ 仓库 Tab ════════════ */}
          {activeTab === 'warehouses' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={fetchWarehouses} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                  <RefreshCw size={16} />
                </button>
              </div>
              {warehouses.length === 0 ? (
                <div className="bds-empty">
                  <div className="glyph"><WarehouseIcon size={24} /></div>
                  <div className="title">暂无仓库</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {warehouses.map(wh => (
                    <div key={wh.id} className="bds-card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>{wh.code}</span>
                        <span className={`bds-badge sm ${wh.type === 'Main' ? 'info' : 'neutral'}`}>
                          {WAREHOUSE_TYPES.find(t => t.id === wh.type)?.label || wh.type}
                        </span>
                      </div>
                      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{wh.name}</div>
                      {wh.address && <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{wh.address}</div>}
                      <div className="text-xs mt-2" style={{ color: 'var(--text-quaternary)' }}>
                        {wh.manager && <span>管理员: {wh.manager}</span>}
                        {wh.isActive ? ' · 活跃' : ' · 已停用'}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 创建仓库表单 */}
              <AnimatePresence>
                {showWarehouseForm && (
                  <motion.div key="wh-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bds-modal-mask" onClick={() => setShowWarehouseForm(false)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bds-modal" style={{ width: '28rem', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="bds-text-lg" style={{ color: 'var(--text-primary)' }}>新增仓库</h3>
                        <button onClick={() => setShowWarehouseForm(false)} className="bds-btn bds-btn-ghost bds-btn-icon"><X size={18} /></button>
                      </div>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div><label className={labelCls}>仓库编码 *</label><input type="text" value={warehouseForm.code} onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value })} placeholder="WH-001" className="bds-input" /></div>
                          <div><label className={labelCls}>类型</label><select value={warehouseForm.type} onChange={(e) => setWarehouseForm({ ...warehouseForm, type: e.target.value as WarehouseType })} className="bds-select">{WAREHOUSE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
                        </div>
                        <div><label className={labelCls}>仓库名称 *</label><input type="text" value={warehouseForm.name} onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })} className="bds-input" /></div>
                        <div><label className={labelCls}>地址</label><input type="text" value={warehouseForm.address} onChange={(e) => setWarehouseForm({ ...warehouseForm, address: e.target.value })} className="bds-input" /></div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><label className={labelCls}>管理员</label><input type="text" value={warehouseForm.manager} onChange={(e) => setWarehouseForm({ ...warehouseForm, manager: e.target.value })} className="bds-input" /></div>
                          <div><label className={labelCls}>电话</label><input type="text" value={warehouseForm.phone} onChange={(e) => setWarehouseForm({ ...warehouseForm, phone: e.target.value })} className="bds-input" /></div>
                        </div>
                      </div>
                      {warehouseFormError && <div className="mt-3 text-xs" style={{ color: 'var(--danger-text)' }}>{warehouseFormError}</div>}
                      <div className="flex items-center justify-end gap-2 mt-4">
                        <button onClick={() => setShowWarehouseForm(false)} className="bds-btn bds-btn-ghost">取消</button>
                        <button onClick={handleCreateWarehouse} disabled={actionLoading === 'create-warehouse'} className="bds-btn bds-btn-primary">
                          {actionLoading === 'create-warehouse' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}<span>创建</span>
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ════════════ 预警 Tab ════════════ */}
          {activeTab === 'alerts' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={fetchLowStock} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                  <RefreshCw size={16} />
                </button>
              </div>
              {lowStockItems.length === 0 ? (
                <div className="bds-empty">
                  <div className="glyph"><AlertTriangle size={24} /></div>
                  <div className="title">暂无库存预警</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {lowStockItems.map((item, index) => (
                    <motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="bds-card">
                      <div className="flex items-center gap-3">
                        <AlertTriangle size={16} style={{ color: 'var(--danger-text)' }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>{item.materialCode || '—'}</span>
                            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{item.description}</span>
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                            {item.warehouse?.name || warehouseName(item.warehouseId)}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="bds-tnum text-sm" style={{ color: 'var(--danger-text)' }}>
                            {formatQty(Number(item.quantity))} / {formatQty(Number(item.minStock))} {item.unit}
                          </div>
                          <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>当前 / 最低</div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ════════════ 样品 Tab（DR-057 v2 库存联动 · 虚拟化万级样卡） ════════════ */}
          {activeTab === 'samples' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <SampleRoomPanel
                isDarkMode={isDarkMode}
                collapsible={false}
                devCaseId={sampleFilterDevCaseId || undefined}
                productAssetId={sampleFilterProductAssetId || undefined}
                onClearFilter={() => { setSampleFilterDevCaseId(null); setSampleFilterProductAssetId(null); }}
                onNavigate={onNavigate}
                onOpenOrder={onOpenOrder}
              />
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryManager;
