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
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Warehouse,
  WarehouseInput,
  WarehouseType,
  InventoryItem,
  InventoryItemInput,
  StockMovement,
  StockMovementInput,
  StockMovementType,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { statusSemanticClass, statusSemanticText, StatusSemantic } from './rdlBusinessStatusTokens';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
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

const MOVEMENT_TYPES: Array<{ id: StockMovementType; label: string; icon: React.ReactNode; semantic: StatusSemantic }> = [
  { id: 'Inbound', label: '入库', icon: <ArrowDownToLine size={12} />, semantic: 'success' },
  { id: 'Outbound', label: '出库', icon: <ArrowUpFromLine size={12} />, semantic: 'warning' },
  { id: 'Transfer', label: '调拨', icon: <ArrowLeftRight size={12} />, semantic: 'info' },
  { id: 'Adjustment', label: '盘点', icon: <ClipboardCheck size={12} />, semantic: 'neutral' },
  { id: 'Lock', label: '锁定', icon: <Lock size={12} />, semantic: 'warning' },
  { id: 'Unlock', label: '解锁', icon: <Unlock size={12} />, semantic: 'success' },
];

interface InventoryManagerProps {
  isDarkMode: boolean;
}

const InventoryManager: React.FC<InventoryManagerProps> = ({ isDarkMode }) => {
  const [activeTab, setActiveTab] = useState<'items' | 'warehouses' | 'alerts'>('items');
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
    setActionLoading(`movement_${movementTargetId}`);
    try {
      await apiService.createStockMovement({ ...movementForm, itemId: movementTargetId });
      setMovementTargetId(null);
      setMovementForm({
        itemId: '', type: 'Inbound', quantity: 0, reason: '',
        movementDate: new Date().toISOString().split('T')[0],
      });
      await fetchItems();
      await fetchLowStock();
    } catch (e: any) {
      setMovementError(`操作失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, [movementTargetId, movementForm, fetchItems, fetchLowStock]);

  // ── 辅助 ──
  const formatQty = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const formatDate = (s?: string) => s || '—';
  const warehouseName = (id: string) => warehouses.find(w => w.id === id)?.name || id;

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
      <PageHeader title="库存管理" subtitle="Inventory" isDarkMode={isDarkMode} />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <ScrollEdgeFades scrollRef={{ current: null }} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* 顶部 Tab 切换 */}
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => setActiveTab('items')} className={`px-4 py-1.5 rounded-full text-xs font-light transition-colors ${activeTab === 'items' ? 'bg-[var(--os-vnext-brand-blue)] text-white' : isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              <Boxes size={12} className="inline mr-1" />库存物料
            </button>
            <button onClick={() => setActiveTab('warehouses')} className={`px-4 py-1.5 rounded-full text-xs font-light transition-colors ${activeTab === 'warehouses' ? 'bg-[var(--os-vnext-brand-blue)] text-white' : isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              <WarehouseIcon size={12} className="inline mr-1" />仓库
            </button>
            <button onClick={() => setActiveTab('alerts')} className={`px-4 py-1.5 rounded-full text-xs font-light transition-colors ${activeTab === 'alerts' ? 'bg-[var(--os-vnext-brand-blue)] text-white' : isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              <AlertTriangle size={12} className="inline mr-1" />预警
              {lowStockItems.length > 0 && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${statusSemanticClass('danger', isDarkMode)} ${statusSemanticText('danger', isDarkMode)}`}>{lowStockItems.length}</span>
              )}
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

          {/* ════════════ 库存物料 Tab ════════════ */}
          {activeTab === 'items' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {/* 工具栏 */}
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <button onClick={() => setShowItemForm(true)} className="h-9 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1.5 transition-colors">
                  <Plus size={14} /><span>新增物料</span>
                </button>
                <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className={`${fieldClass} max-w-[160px] py-1.5`}>
                  <option value="">全部仓库</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={`${fieldClass} max-w-[120px] py-1.5`}>
                  <option value="">全部品类</option>
                  {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className={`flex items-center gap-1.5 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} className="accent-[var(--os-vnext-brand-blue)]" />
                  仅低库存
                </label>
                <div className="relative flex-1 max-w-xs">
                  <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索物料..." className={`${fieldClass} pl-9`} />
                </div>
                <button onClick={fetchItems} className={`p-2 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`} title="刷新">
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* 列表 */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className={`animate-spin ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                </div>
              ) : items.length === 0 ? (
                <div className={`text-center py-12 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  <Boxes size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无库存物料</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item, index) => {
                    const isLowStock = item.minStock != null && Number(item.quantity) <= Number(item.minStock);
                    const movements = movementsByItem[item.id] || [];
                    return (
                      <motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }} className={`${cardClass} overflow-hidden`}>
                        {/* 卡片头部 */}
                        <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={() => handleExpand(item.id)}>
                          <button className={`flex-shrink-0 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                            {expandedId === item.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.materialCode || '—'}</span>
                              {isLowStock && (
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-light ${statusSemanticClass('danger', isDarkMode)} ${statusSemanticText('danger', isDarkMode)}`}>低库存</span>
                              )}
                              {Number(item.lockedQuantity) > 0 && (
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-light ${statusSemanticClass('warning', isDarkMode)} ${statusSemanticText('warning', isDarkMode)}`}>
                                  锁定 {formatQty(Number(item.lockedQuantity))}
                                </span>
                              )}
                            </div>
                            <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                              {item.description} · {item.warehouse?.name || warehouseName(item.warehouseId)}
                              {item.batchNumber ? ` · 批次 ${item.batchNumber}` : ''}
                              {item.locationCode ? ` · ${item.locationCode}` : ''}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className={`text-sm font-light tabular-nums ${isLowStock ? (isDarkMode ? 'text-red-400' : 'text-red-600') : (isDarkMode ? 'text-white' : 'text-slate-900')}`}>
                              {formatQty(Number(item.quantity))} <span className="text-xs opacity-60">{item.unit}</span>
                            </div>
                            {item.minStock != null && (
                              <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>最低 {formatQty(Number(item.minStock))}</div>
                            )}
                          </div>
                        </div>

                        {/* 展开详情 */}
                        <AnimatePresence>
                          {expandedId === item.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className={`overflow-hidden border-t ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/50'}`}>
                              <div className="p-4 space-y-3">
                                {/* 物料信息 */}
                                <div className={`grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                                  {item.category && <div><span className="opacity-60">品类:</span> {item.category}</div>}
                                  {item.specification && <div><span className="opacity-60">规格:</span> {item.specification}</div>}
                                  {item.unitCost != null && <div><span className="opacity-60">单位成本:</span> {Number(item.unitCost).toFixed(2)} {item.currency}</div>}
                                  {item.lastInDate && <div><span className="opacity-60">最后入库:</span> {formatDate(item.lastInDate)}</div>}
                                  {item.lastOutDate && <div><span className="opacity-60">最后出库:</span> {formatDate(item.lastOutDate)}</div>}
                                  {item.maxStock != null && <div><span className="opacity-60">最高库存:</span> {formatQty(Number(item.maxStock))}</div>}
                                </div>

                                {/* 可用库存摘要 */}
                                <div className={`flex items-center gap-4 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                                  <span>当前: <span className={isDarkMode ? 'text-white' : 'text-slate-900'}>{formatQty(Number(item.quantity))}</span> {item.unit}</span>
                                  <span>锁定: <span className={isDarkMode ? 'text-amber-400' : 'text-amber-600'}>{formatQty(Number(item.lockedQuantity))}</span></span>
                                  <span>可用: <span className={isDarkMode ? 'text-green-400' : 'text-green-600'}>{formatQty(item.availableQuantity)}</span></span>
                                </div>

                                {/* 变动流水 */}
                                {movements.length > 0 && (
                                  <div>
                                    <h4 className={`text-xs font-light uppercase tracking-wider mb-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>最近变动</h4>
                                    <div className="space-y-1">
                                      {movements.slice(0, 8).map(mv => {
                                        const mt = MOVEMENT_TYPES.find(m => m.id === mv.type);
                                        return (
                                          <div key={mv.id} className={`p-2 rounded-inset flex items-center gap-3 text-xs ${isDarkMode ? 'bg-white/[0.02]' : 'bg-slate-50/80'}`}>
                                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-light flex items-center gap-1 ${statusSemanticClass(mt?.semantic || 'neutral', isDarkMode)} ${statusSemanticText(mt?.semantic || 'neutral', isDarkMode)}`}>
                                              {mt?.icon} {mt?.label || mv.type}
                                            </span>
                                            <span className={`tabular-nums ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{formatQty(Number(mv.quantity))} {mv.unit}</span>
                                            <span className={isDarkMode ? 'text-slate-500' : 'text-slate-400'}>{formatDate(mv.movementDate)}</span>
                                            <span className={`ml-auto tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                                              {formatQty(Number(mv.balanceBefore))} → {formatQty(Number(mv.balanceAfter))}
                                            </span>
                                            {mv.reason && <span className={isDarkMode ? 'text-slate-500' : 'text-slate-400'}>· {mv.reason}</span>}
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
                                      <div className={`p-3 rounded-inset ${isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}`}>
                                        <h4 className={`text-xs font-light mb-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>库存变动</h4>
                                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-2">
                                          <select value={movementForm.type} onChange={(e) => setMovementForm({ ...movementForm, type: e.target.value as StockMovementType })} className={`${fieldClass} py-1.5 text-xs`}>
                                            {MOVEMENT_TYPES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                          </select>
                                          <input type="number" value={movementForm.quantity || ''} onChange={(e) => setMovementForm({ ...movementForm, quantity: parseFloat(e.target.value) || 0 })} placeholder="数量 *" className={`${fieldClass} py-1.5 text-xs`} />
                                          <input type="date" value={movementForm.movementDate} onChange={(e) => setMovementForm({ ...movementForm, movementDate: e.target.value })} className={`${fieldClass} py-1.5 text-xs`} />
                                          <input type="text" value={movementForm.reason || ''} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })} placeholder="原因" className={`${fieldClass} py-1.5 text-xs`} />
                                          {movementForm.type === 'Transfer' && (
                                            <select value={movementForm.targetWarehouseId || ''} onChange={(e) => setMovementForm({ ...movementForm, targetWarehouseId: e.target.value })} className={`${fieldClass} py-1.5 text-xs xl:col-span-2`}>
                                              <option value="">目标仓库...</option>
                                              {warehouses.filter(w => w.id !== item.warehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                            </select>
                                          )}
                                          {movementForm.type === 'Adjustment' && (
                                            <input type="text" value={movementForm.notes || ''} onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })} placeholder="盘点备注" className={`${fieldClass} py-1.5 text-xs xl:col-span-2`} />
                                          )}
                                        </div>
                                        {movementError && <div className={`text-xs mb-2 ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>{movementError}</div>}
                                        <div className="flex items-center justify-end gap-2">
                                          <button onClick={() => { setMovementTargetId(null); setMovementError(null); }} className={`h-7 px-3 rounded-full text-xs font-light ${isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>取消</button>
                                          <button onClick={handleCreateMovement} disabled={actionLoading === `movement_${item.id}`} className="h-7 px-3 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1 disabled:opacity-50">
                                            {actionLoading === `movement_${item.id}` ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                                            <span>执行变动</span>
                                          </button>
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                {/* 操作按钮 */}
                                <div className="flex items-center gap-2 pt-2 flex-wrap">
                                  <button onClick={() => { setMovementTargetId(movementTargetId === item.id ? null : item.id); setMovementError(null); setMovementForm({ ...movementForm, type: 'Inbound', quantity: 0 }); }} className={`${actionBtnCls} bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue-soft)] hover:bg-[var(--os-vnext-brand-blue)]/14`}>
                                    <ArrowDownToLine size={12} /><span>{movementTargetId === item.id ? '收起' : '库存变动'}</span>
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
                  <motion.div key="item-form" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm`} onClick={() => setShowItemForm(false)}>
                    <div className={`w-full max-w-2xl p-6 rounded-card ${cardClass}`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className={`text-lg font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>新增库存物料</h3>
                        <button onClick={() => setShowItemForm(false)} className={`p-1 ${isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}><X size={18} /></button>
                      </div>
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                        <div><label className={labelClass}>仓库 *</label><select value={itemForm.warehouseId} onChange={(e) => setItemForm({ ...itemForm, warehouseId: e.target.value })} className={fieldClass}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
                        <div><label className={labelClass}>物料编码</label><input type="text" value={itemForm.materialCode} onChange={(e) => setItemForm({ ...itemForm, materialCode: e.target.value })} className={fieldClass} /></div>
                        <div><label className={labelClass}>品类</label><select value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} className={fieldClass}>{ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                        <div className="xl:col-span-2"><label className={labelClass}>品名描述 *</label><input type="text" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} className={fieldClass} /></div>
                        <div><label className={labelClass}>单位 *</label><select value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} className={fieldClass}>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                        <div><label className={labelClass}>初始数量</label><input type="number" value={itemForm.quantity || ''} onChange={(e) => setItemForm({ ...itemForm, quantity: parseFloat(e.target.value) || 0 })} className={fieldClass} /></div>
                        <div><label className={labelClass}>单位成本</label><input type="number" step="0.01" value={itemForm.unitCost ?? ''} onChange={(e) => setItemForm({ ...itemForm, unitCost: e.target.value ? parseFloat(e.target.value) : undefined })} className={fieldClass} /></div>
                        <div><label className={labelClass}>批次号</label><input type="text" value={itemForm.batchNumber} onChange={(e) => setItemForm({ ...itemForm, batchNumber: e.target.value })} className={fieldClass} /></div>
                        <div><label className={labelClass}>库位</label><input type="text" value={itemForm.locationCode} onChange={(e) => setItemForm({ ...itemForm, locationCode: e.target.value })} className={fieldClass} /></div>
                        <div><label className={labelClass}>最低库存</label><input type="number" step="0.01" value={itemForm.minStock ?? ''} onChange={(e) => setItemForm({ ...itemForm, minStock: e.target.value ? parseFloat(e.target.value) : undefined })} className={fieldClass} /></div>
                        <div><label className={labelClass}>最高库存</label><input type="number" step="0.01" value={itemForm.maxStock ?? ''} onChange={(e) => setItemForm({ ...itemForm, maxStock: e.target.value ? parseFloat(e.target.value) : undefined })} className={fieldClass} /></div>
                      </div>
                      {itemFormError && <div className={`mt-3 text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>{itemFormError}</div>}
                      <div className="flex items-center justify-end gap-2 mt-4">
                        <button onClick={() => setShowItemForm(false)} className={`h-9 px-4 rounded-full text-xs font-light ${isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>取消</button>
                        <button onClick={handleCreateItem} disabled={actionLoading === 'create-item'} className="h-9 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1.5 disabled:opacity-50">
                          {actionLoading === 'create-item' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}<span>创建</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ════════════ 仓库 Tab ════════════ */}
          {activeTab === 'warehouses' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={() => setShowWarehouseForm(true)} className="h-9 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1.5 transition-colors">
                  <Plus size={14} /><span>新增仓库</span>
                </button>
                <button onClick={fetchWarehouses} className={`p-2 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`} title="刷新">
                  <RefreshCw size={16} />
                </button>
              </div>
              {warehouses.length === 0 ? (
                <div className={`text-center py-12 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  <WarehouseIcon size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无仓库</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {warehouses.map(wh => (
                    <div key={wh.id} className={`p-4 rounded-card ${cardClass}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{wh.code}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-light ${statusSemanticClass(wh.type === 'Main' ? 'info' : 'neutral', isDarkMode)} ${statusSemanticText(wh.type === 'Main' ? 'info' : 'neutral', isDarkMode)}`}>
                          {WAREHOUSE_TYPES.find(t => t.id === wh.type)?.label || wh.type}
                        </span>
                      </div>
                      <div className={`text-sm font-light ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{wh.name}</div>
                      {wh.address && <div className={`text-xs mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{wh.address}</div>}
                      <div className={`text-xs mt-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
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
                  <motion.div key="wh-form" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm`} onClick={() => setShowWarehouseForm(false)}>
                    <div className={`w-full max-w-md p-6 rounded-card ${cardClass}`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className={`text-lg font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>新增仓库</h3>
                        <button onClick={() => setShowWarehouseForm(false)} className={`p-1 ${isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}><X size={18} /></button>
                      </div>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div><label className={labelClass}>仓库编码 *</label><input type="text" value={warehouseForm.code} onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value })} placeholder="WH-001" className={fieldClass} /></div>
                          <div><label className={labelClass}>类型</label><select value={warehouseForm.type} onChange={(e) => setWarehouseForm({ ...warehouseForm, type: e.target.value as WarehouseType })} className={fieldClass}>{WAREHOUSE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
                        </div>
                        <div><label className={labelClass}>仓库名称 *</label><input type="text" value={warehouseForm.name} onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })} className={fieldClass} /></div>
                        <div><label className={labelClass}>地址</label><input type="text" value={warehouseForm.address} onChange={(e) => setWarehouseForm({ ...warehouseForm, address: e.target.value })} className={fieldClass} /></div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><label className={labelClass}>管理员</label><input type="text" value={warehouseForm.manager} onChange={(e) => setWarehouseForm({ ...warehouseForm, manager: e.target.value })} className={fieldClass} /></div>
                          <div><label className={labelClass}>电话</label><input type="text" value={warehouseForm.phone} onChange={(e) => setWarehouseForm({ ...warehouseForm, phone: e.target.value })} className={fieldClass} /></div>
                        </div>
                      </div>
                      {warehouseFormError && <div className={`mt-3 text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>{warehouseFormError}</div>}
                      <div className="flex items-center justify-end gap-2 mt-4">
                        <button onClick={() => setShowWarehouseForm(false)} className={`h-9 px-4 rounded-full text-xs font-light ${isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>取消</button>
                        <button onClick={handleCreateWarehouse} disabled={actionLoading === 'create-warehouse'} className="h-9 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1.5 disabled:opacity-50">
                          {actionLoading === 'create-warehouse' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}<span>创建</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ════════════ 预警 Tab ════════════ */}
          {activeTab === 'alerts' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={fetchLowStock} className={`p-2 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`} title="刷新">
                  <RefreshCw size={16} />
                </button>
              </div>
              {lowStockItems.length === 0 ? (
                <div className={`text-center py-12 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  <AlertTriangle size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无库存预警</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lowStockItems.map((item, index) => (
                    <motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className={`p-4 rounded-card ${cardClass}`}>
                      <div className="flex items-center gap-3">
                        <AlertTriangle size={16} className={statusSemanticText('danger', isDarkMode)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.materialCode || '—'}</span>
                            <span className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{item.description}</span>
                          </div>
                          <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            {item.warehouse?.name || warehouseName(item.warehouseId)}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`text-sm tabular-nums ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                            {formatQty(Number(item.quantity))} / {formatQty(Number(item.minStock))} {item.unit}
                          </div>
                          <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>当前 / 最低</div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryManager;
