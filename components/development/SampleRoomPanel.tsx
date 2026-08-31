/**
 * SampleRoomPanel.tsx — REQ2-16 样品间管理面板（DR-057 v2 库存联动）
 *
 * 挂载点：
 *   1) DevelopmentManager 列表视图底部（可折叠区块，预过滤 = 当前开发单）
 *   2) InventoryManager 第 4 Tab「样品」（collapsible=false，整页展开）
 *
 * v2 库存联动：
 *   - 样卡支持 quantity/minStock/maxStock/unit/warehouseId 软关联 devCaseId/orderId
 *   - 借出 loanQuantity（部分借出：availableQty>0 仍 in_stock；=0 才 borrowed）
 *   - 盘点 adjustQuantity（保留在借数量）
 *   - 低库存预警 listLowStock
 *   - 关联单据摘要 join（devCase.code/order.poNumber/customer + warehouse.code/name）
 *
 * 二维码：qrcode 库生成 PNG dataURL（载荷 = 样卡编号）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as QRCode from 'qrcode';
import { Virtuoso } from 'react-virtuoso';
import { ChevronDown, ChevronUp, ChevronRight, Plus, QrCode, RotateCcw, Search, Archive, ClipboardCheck, X, Boxes } from 'lucide-react';
import BottomSheet from '../ui/BottomSheet';
import { bdsToast } from '../ui/bdsToast';
import { bdsConfirm } from '../ui/BdsDialog';
import CapsuleDateInput from '../ui/CapsuleDateInput';
import CustomSelect from '../ui/CustomSelect';
import RelationCombobox from '../ui/RelationCombobox';
import { sampleRoomService, SampleCardItemView } from '../../services/sampleRoomService';
import { apiService } from '../../services/apiService';
import { primeCrossModuleNav } from '../../services/crossModuleNav';
import { developmentService } from '../../services/developmentService';
import { hasPermission } from '../../services/authService';
import { View } from '../../types';
import type { Warehouse, ProductAssetDetail, Relation } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const CARD_TYPE_LABELS: Record<string, string> = {
  fabric: '面料', garment: '成衣', colorcard: '色卡', trim: '辅料', other: '其他',
};

const STATUS_LABELS: Record<string, string> = {
  in_stock: '在库', borrowed: '在借', retired: '已退役',
};

const STATUS_TONES: Record<string, string> = {
  in_stock: 'success', borrowed: 'info', retired: 'neutral',
};

const UNITS = ['PC', 'YD', 'M', 'KG', 'SET'];

interface SampleRoomPanelProps {
  isDarkMode: boolean;
  /** 预过滤：开发单 ID（来自 DevelopmentManager 卡片入口） */
  devCaseId?: string;
  /** 预过滤：订单 ID（来自订单详情入口，未来扩展） */
  orderId?: string;
  /** 预过滤：产品档案 ID（来自产品档案详情反查入口，DR-057 v2.1） */
  productAssetId?: string;
  /** 是否可折叠（DevelopmentManager 底部挂载 = true；InventoryManager Tab = false） */
  collapsible?: boolean;
  /** 折叠初始展开（默认 false） */
  defaultExpanded?: boolean;
  /** 清除预过滤回调 */
  onClearFilter?: () => void;
  /** 跨模块导航：切 View（点击关联开发单/档案 chip 触发） */
  onNavigate?: (view: View) => void;
  /** 打开订单详情（点击关联订单 chip 触发） */
  onOpenOrder?: (orderId: string) => void;
}

const EMPTY_ITEM_FORM = {
  name: '', cardType: 'fabric', colorCardCode: '', location: '', notes: '',
  quantity: '1', minStock: '', maxStock: '', unit: 'PC',
  warehouseId: '', devCaseId: '', orderId: '', productAssetId: '',
};
const EMPTY_LOAN_FORM = {
  loanType: 'borrow' as 'borrow' | 'viewing',
  loanQuantity: '1',
  borrowerName: '', relationId: '', relationName: '', dueDate: '', conditionNote: '',
};
const EMPTY_ADJUST_FORM = {
  newQuantity: '', newMinStock: '', newMaxStock: '', reason: '',
};

const SampleRoomPanel: React.FC<SampleRoomPanelProps> = ({
  isDarkMode,
  devCaseId,
  orderId,
  productAssetId,
  collapsible = true,
  defaultExpanded = false,
  onClearFilter,
  onNavigate,
  onOpenOrder,
}) => {
  const [expanded, setExpanded] = useState(!collapsible || defaultExpanded);
  const [items, setItems] = useState<SampleCardItemView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // error 双显分离：listError 仅列表区（加载失败），sheetError 仅弹层（登记/借出/盘点校验与提交失败）
  const [listError, setListError] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // 搜索 300ms 防抖（逐击键发请求 → 停顿后才请求；Enter 立即冲刷）
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);

  const [showItemSheet, setShowItemSheet] = useState(false);
  const [itemForm, setItemForm] = useState({ ...EMPTY_ITEM_FORM });
  const [itemSaving, setItemSaving] = useState(false);

  // ── 登记表单关联搜索（DR-057 v2.1：产品档案/开发单搜索选择，替代手输 ID）──
  const [paQuery, setPaQuery] = useState('');
  const [paOptions, setPaOptions] = useState<ProductAssetDetail[]>([]);
  const [devQuery, setDevQuery] = useState('');
  const [devOptions, setDevOptions] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [devCasePicked, setDevCasePicked] = useState<string>('');
  // R678：订单手输 ID → 搜索下拉（复用 devQuery 300ms 防抖模式）
  const [orderQuery, setOrderQuery] = useState('');
  const [orderOptions, setOrderOptions] = useState<Array<{ id: string; poNumber: string; customer: string }>>([]);
  const [orderPicked, setOrderPicked] = useState<string>('');

  // R678：看样客户 RelationCombobox 数据源（关系智库，与开发/订单表单同通道）
  const [relations, setRelations] = useState<Relation[]>([]);
  useEffect(() => {
    apiService.listRelations().then(setRelations).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!orderQuery.trim()) { setOrderOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // apiService.listOrdersPage 不透传 search 参数（分页口径仅 limit/offset），
        // 此处直取 V2 列表端点（routeV2 支持 search 模糊：订单号/客户/品名/合同号）
        const qs = new URLSearchParams({ search: orderQuery.trim(), limit: '5' });
        const base = apiService.getStoredConfig().cloudEndpoint;
        const res = await fetch(apiService.buildApiUrl(`/v2/orders?${qs.toString()}`, base), { headers: apiService.getAuthHeaders() });
        const data = await res.json().catch(() => ({}));
        const rows = Array.isArray(data.items) ? data.items : [];
        if (!cancelled) setOrderOptions(rows.map((o: any) => ({ id: o.id, poNumber: o.poNumber || o.id, customer: o.customer || '' })));
      } catch {
        if (!cancelled) setOrderOptions([]);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderQuery]);

  useEffect(() => {
    if (!paQuery.trim()) { setPaOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const assets = await apiService.listProductAssets(undefined, { search: paQuery.trim(), limit: 5 });
        if (!cancelled) setPaOptions(assets);
      } catch {
        if (!cancelled) setPaOptions([]);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [paQuery]);

  useEffect(() => {
    if (!devQuery.trim()) { setDevOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const list = await developmentService.listDevelopmentCases(undefined, { search: devQuery.trim(), limit: 5 });
        if (!cancelled) setDevOptions(list.map(c => ({ id: c.id, code: c.code, name: c.name })));
      } catch {
        if (!cancelled) setDevOptions([]);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [devQuery]);

  const [loanTarget, setLoanTarget] = useState<SampleCardItemView | null>(null);
  const [loanForm, setLoanForm] = useState({ ...EMPTY_LOAN_FORM });
  const [loanSaving, setLoanSaving] = useState(false);

  const [adjustTarget, setAdjustTarget] = useState<SampleCardItemView | null>(null);
  const [adjustForm, setAdjustForm] = useState({ ...EMPTY_ADJUST_FORM });
  const [adjustSaving, setAdjustSaving] = useState(false);

  const [qrItem, setQrItem] = useState<SampleCardItemView | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  // 行级展开（手风琴：详情/操作面板内联展开，承载万级样卡的紧凑浏览）
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // ── 仓库下拉 ──
  const fetchWarehouses = useCallback(async () => {
    setWarehousesLoading(true);
    try {
      const data = await apiService.listWarehouses();
      setWarehouses(Array.isArray(data) ? data : []);
    } catch {
      setWarehouses([]);
    } finally {
      setWarehousesLoading(false);
    }
  }, []);

  useEffect(() => { fetchWarehouses(); }, [fetchWarehouses]);

  // ── 列表 ──
  const reload = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const data = await sampleRoomService.listItems({
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        warehouseId: warehouseFilter || undefined,
        devCaseId: devCaseId || undefined,
        orderId: orderId || undefined,
        productAssetId: productAssetId || undefined,
        lowStock: lowStockOnly || undefined,
        limit: 2000,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (e: any) {
      setListError(e.message || '样品间数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, warehouseFilter, devCaseId, orderId, productAssetId, lowStockOnly]);

  useEffect(() => {
    if (expanded) reload();
  }, [expanded, reload]);

  // 预过滤变化时自动展开（仅 collapsible 模式）
  useEffect(() => {
    if (collapsible && (devCaseId || orderId || productAssetId)) {
      setExpanded(true);
    }
  }, [devCaseId, orderId, productAssetId, collapsible]);

  const stats = useMemo(() => ({
    inStock: items.filter(i => i.status === 'in_stock').length,
    borrowed: items.filter(i => i.status === 'borrowed').length,
    overdue: items.filter(i => i.overdue).length,
    lowStock: items.filter(i => i.minStock != null && Number(i.availableQty) <= Number(i.minStock)).length,
  }), [items]);

  // ── 跨模块导航：点击 chip 跳转关联开发单/订单/产品档案 ──
  // 设计遵循 crossModuleNav 三段式：先 prime（写 sessionStorage 上下文），
  // 再 onNavigate 切 View，目标 Manager 挂载时 consumeCrossModuleNav 消费。
  // 当 props 未提供（如 DevelopmentManager 内挂载态）→ chips 退化为纯文本。
  const openDevCaseDetail = useCallback((devCaseId: string) => {
    if (!onNavigate) return;
    primeCrossModuleNav({ view: View.Development, focusEntityId: devCaseId });
    onNavigate(View.Development);
  }, [onNavigate]);
  const openOrderDetail = useCallback((oid: string) => {
    onOpenOrder?.(oid);
  }, [onOpenOrder]);
  const openProductDetail = useCallback((productId: string, productName?: string | null) => {
    if (!onNavigate) return;
    primeCrossModuleNav({
      view: View.Products,
      filter: { anchor: 'product', productId, productName: productName || undefined },
      focusEntityId: productId,
    });
    onNavigate(View.Products);
  }, [onNavigate]);

  const handleCreateItem = async () => {
    if (itemSaving) return;
    if (!itemForm.name.trim()) {
      setSheetError('样卡名称必填');
      return;
    }
    const minNum = itemForm.minStock === '' ? null : Number(itemForm.minStock);
    const maxNum = itemForm.maxStock === '' ? null : Number(itemForm.maxStock);
    if (minNum != null && maxNum != null && minNum > maxNum) {
      setSheetError('最低库存不可大于最高库存');
      return;
    }
    setItemSaving(true);
    setSheetError('');
    try {
      const item = await sampleRoomService.createItem({
        name: itemForm.name.trim(),
        cardType: itemForm.cardType,
        colorCardCode: itemForm.colorCardCode.trim() || undefined,
        location: itemForm.location.trim() || undefined,
        notes: itemForm.notes.trim() || undefined,
        quantity: Number(itemForm.quantity) || 0,
        minStock: minNum,
        maxStock: maxNum,
        unit: itemForm.unit,
        warehouseId: itemForm.warehouseId || undefined,
        devCaseId: itemForm.devCaseId.trim() || undefined,
        orderId: itemForm.orderId.trim() || undefined,
        productAssetId: itemForm.productAssetId.trim() || undefined,
      });
      bdsToast.success(`样卡已登记：${item.code}`);
      setShowItemSheet(false);
      setItemForm({
        ...EMPTY_ITEM_FORM,
        warehouseId: warehouses[0]?.id || '',
        devCaseId: devCaseId || '',
        orderId: orderId || '',
      });
      setDevQuery('');
      setDevOptions([]);
      setDevCasePicked('');
      setOrderQuery('');
      setOrderOptions([]);
      setOrderPicked('');
      setPaQuery('');
      setPaOptions([]);
      await reload();
      openQr(item);
    } catch (e: any) {
      setSheetError(e.message || '样卡登记失败');
    } finally {
      setItemSaving(false);
    }
  };

  const openQr = async (item: SampleCardItemView) => {
    setQrItem(item);
    setQrDataUrl('');
    try {
      const url = await QRCode.toDataURL(item.code, { margin: 1, width: 200, errorCorrectionLevel: 'M' });
      setQrDataUrl(url);
    } catch {
      setQrDataUrl('');
    }
  };

  const handleCreateLoan = async () => {
    if (!loanTarget || loanSaving) return;
    if (!loanForm.borrowerName.trim()) {
      setSheetError(loanForm.loanType === 'borrow' ? '请填写借用人' : '请填写看样联系人');
      return;
    }
    if (loanForm.loanType === 'viewing' && !loanForm.relationId.trim()) {
      setSheetError('看样登记需选择客户');
      return;
    }
    const qty = Number(loanForm.loanQuantity) || 1;
    if (qty < 1) {
      setSheetError('借出数量至少为 1');
      return;
    }
    if (qty > Number(loanTarget.availableQty)) {
      setSheetError(`借出数量不可超过可用库存（${loanTarget.availableQty}）`);
      return;
    }
    setLoanSaving(true);
    setSheetError('');
    try {
      const dueAt = loanForm.loanType === 'borrow' && loanForm.dueDate
        ? new Date(loanForm.dueDate).getTime()
        : undefined;
      await sampleRoomService.createLoan(loanTarget.id, {
        loanType: loanForm.loanType,
        loanQuantity: qty,
        borrowerName: loanForm.borrowerName.trim(),
        relationId: loanForm.loanType === 'viewing' ? loanForm.relationId.trim() : undefined,
        dueAt,
      });
      bdsToast.success(loanForm.loanType === 'borrow' ? `已借出 ${qty}：${loanTarget.code}` : `看样已登记：${loanTarget.code}`);
      setLoanTarget(null);
      setLoanForm({ ...EMPTY_LOAN_FORM });
      await reload();
    } catch (e: any) {
      setSheetError(e.message || '借出/看样登记失败');
    } finally {
      setLoanSaving(false);
    }
  };

  const handleAdjust = async () => {
    if (!adjustTarget || adjustSaving) return;
    setAdjustSaving(true);
    setSheetError('');
    try {
      const newQty = adjustForm.newQuantity === '' ? undefined : Number(adjustForm.newQuantity);
      const newMin = adjustForm.newMinStock === '' ? null : Number(adjustForm.newMinStock);
      const newMax = adjustForm.newMaxStock === '' ? null : Number(adjustForm.newMaxStock);
      if (newQty != null && newQty < 0) {
        setSheetError('数量不可为负');
        setAdjustSaving(false);
        return;
      }
      if (newMin != null && newMax != null && newMin > newMax) {
        setSheetError('最低库存不可大于最高库存');
        setAdjustSaving(false);
        return;
      }
      await sampleRoomService.adjustQuantity(adjustTarget.id, {
        newQuantity: newQty,
        newMinStock: newMin,
        newMaxStock: newMax,
        reason: adjustForm.reason.trim() || undefined,
      });
      bdsToast.success(`已盘点：${adjustTarget.code}`);
      setAdjustTarget(null);
      setAdjustForm({ ...EMPTY_ADJUST_FORM });
      await reload();
    } catch (e: any) {
      setSheetError(e.message || '盘点失败');
    } finally {
      setAdjustSaving(false);
    }
  };

  const handleReturn = async (item: SampleCardItemView) => {
    if (!item.activeLoan) return;
    const note = await bdsConfirm({
      title: '归还登记',
      body: `归还样卡「${item.code} ${item.name}」？可在下方"其他"栏填写归还状态备注（损坏/缺失留痕）。`,
    });
    if (!note) return;
    try {
      await sampleRoomService.returnLoan(item.activeLoan.id);
      bdsToast.success(`已归还：${item.code}`);
      await reload();
    } catch (e: any) {
      bdsToast.danger(e.message || '归还失败');
    }
  };

  const handleRetire = async (item: SampleCardItemView) => {
    if (!(await bdsConfirm({ title: '确认退役', body: `样卡「${item.code} ${item.name}」退役？退役为终态，不可再借出/看样。`, danger: true }))) return;
    try {
      await sampleRoomService.retireItem(item.id);
      bdsToast.success(`已退役：${item.code}`);
      await reload();
    } catch (e: any) {
      bdsToast.danger(e.message || '退役失败');
    }
  };

  const openLoanSheet = (item: SampleCardItemView) => {
    setLoanTarget(item);
    setLoanForm({ ...EMPTY_LOAN_FORM });
    setSheetError('');
  };

  const openAdjustSheet = (item: SampleCardItemView) => {
    setAdjustTarget(item);
    setAdjustForm({
      newQuantity: String(item.quantity ?? ''),
      newMinStock: item.minStock != null ? String(item.minStock) : '',
      newMaxStock: item.maxStock != null ? String(item.maxStock) : '',
      reason: '',
    });
    setSheetError('');
  };

  const openItemSheet = () => {
    setItemForm({
      ...EMPTY_ITEM_FORM,
      warehouseId: warehouses[0]?.id || '',
      devCaseId: devCaseId || '',
      orderId: orderId || '',
    });
    setDevQuery('');
    setDevOptions([]);
    setDevCasePicked(devCaseId ? `预过滤 ${devCaseId.slice(-8)}` : '');
    setOrderQuery('');
    setOrderOptions([]);
    setOrderPicked(orderId ? `预过滤 ${orderId.slice(-8)}` : '');
    setPaQuery('');
    setPaOptions([]);
    setShowItemSheet(true);
    setSheetError('');
  };

  // R6 权限门：样品间写操作（登记/借出/看样/归还/盘点/退役）统一 sample:room:write，无权限只读
  const canWrite = hasPermission('sample:room:write');

  // ── 渲染 ──
  const headerStats = (
    <span className="flex items-center gap-2 text-[10px] font-light text-[var(--text-tertiary)]">
      <span>{total} 张</span>
      <span className="opacity-50">·</span>
      <span>在库 {stats.inStock}</span>
      <span className="opacity-50">·</span>
      <span>在借 {stats.borrowed}</span>
      {stats.lowStock > 0 && (
        <>
          <span className="opacity-50">·</span>
          <span style={{ color: 'var(--warning-text)' }}>低库存 {stats.lowStock}</span>
        </>
      )}
      {stats.overdue > 0 && (
        <>
          <span className="opacity-50">·</span>
          <span style={{ color: 'var(--danger-text)' }}>逾期 {stats.overdue}</span>
        </>
      )}
    </span>
  );

  const filterBadge = (devCaseId || orderId || productAssetId) ? (
    <span className="inline-flex items-center gap-1 rounded-compact px-2 py-1 text-[10px] font-light" style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}>
      {devCaseId
        ? `预过滤：开发单 ${devCaseId.slice(-6)}`
        : orderId
          ? `预过滤：订单 ${orderId.slice(-6)}`
          : `预过滤：产品档案 ${productAssetId!.slice(-10)}`}
      {onClearFilter && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onClearFilter(); }} className="hover:opacity-70" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}>
          <X size={14} />
        </button>
      )}
    </span>
  ) : null;

  return (
    <div className={cx('shrink-0', !collapsible && 'h-full flex flex-col')}>
      {/* 折叠头（仅 collapsible 模式） */}
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="bds-btn bds-btn-ghost w-full justify-between px-4 h-11"
        >
          <span className="flex items-center gap-2 text-xs tracking-[0.14em] text-[var(--text-secondary)]">
            <QrCode size={14} />
            样品间 SAMPLE ROOM
            {expanded && !loading && headerStats}
            {filterBadge}
          </span>
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      )}

      {/* 非折叠模式：标题栏 */}
      {!collapsible && (
        <div className="mb-3 flex flex-wrap items-center gap-3 px-1">
          <span className="flex items-center gap-2 text-sm font-light tracking-[0.14em] text-[var(--text-primary)]">
            <Boxes size={16} />
            样品库存 SAMPLE ROOM
          </span>
          {!loading && headerStats}
          {filterBadge}
        </div>
      )}

      {(expanded || !collapsible) && (
        <div className={cx('flex flex-col min-h-0', collapsible ? 'mt-2 h-[clamp(320px,60vh,720px)]' : 'flex-1 min-h-0')}>
          {/* 工具行：搜索 + 状态筛选 + 仓库筛选 + 低库存 + 登记 */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative min-w-0 flex-1 max-w-64">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setDebouncedSearch(searchInput.trim()); }}
                placeholder="样卡名 / 编号 / 架位"
                className="bds-input pl-9 h-9 text-xs"
              />
            </div>
            <CustomSelect
              className="w-28 shrink-0"
              value={statusFilter}
              onChange={v => setStatusFilter(v)}
              options={[
                { value: '', label: '全部状态' },
                { value: 'in_stock', label: '在库' },
                { value: 'borrowed', label: '在借' },
                { value: 'retired', label: '已退役' },
              ]}
            />
            <CustomSelect
              className="w-32 shrink-0"
              value={warehouseFilter}
              onChange={v => setWarehouseFilter(v)}
              disabled={warehousesLoading}
              options={[
                { value: '', label: '全部仓库' },
                ...warehouses.map(w => ({ value: w.id, label: w.name })),
              ]}
            />
            <label className="flex items-center gap-1 text-[11px] font-light text-[var(--text-tertiary)] shrink-0">
              <input type="checkbox" checked={lowStockOnly} onChange={e => setLowStockOnly(e.target.checked)} />
              仅低库存
            </label>
            {canWrite && (
              <button type="button" className="bds-btn bds-btn-primary h-9 text-xs" onClick={openItemSheet}>
                <Plus size={14} />登记样卡
              </button>
            )}
          </div>

          {/* limit=2000 截断提示：超出时引导用搜索/筛选缩小范围 */}
          {total > items.length && (
            <div className="text-[10px] font-light text-[var(--text-tertiary)] shrink-0 px-1 pt-1">
              已加载前 {items.length} 条（共 {total} 条，单次上限 2000），请用搜索/筛选缩小范围
            </div>
          )}

          {listError && <div className="bds-alert danger text-xs shrink-0">{listError}</div>}
          {loading && <div className="text-xs font-light text-[var(--text-tertiary)] px-1 py-3 shrink-0">加载中...</div>}

          {/* 样卡列表 — 虚拟化紧凑表格（react-virtuoso，承载万级样卡） */}
          {!loading && items.length === 0 ? (
            <div className="text-xs font-light text-[var(--text-tertiary)] px-1 py-8 text-center">
              暂无样卡。登记后自动生成样卡编号（二维码载荷），打印贴卡即用。
            </div>
          ) : (
            <div className="flex-1 min-h-0" ref={listRef}>
              <Virtuoso
                data={items}
                style={{ height: '100%' }}
                className="custom-scrollbar"
                itemContent={(index, item) => {
                  const isLowStock = item.minStock != null && Number(item.availableQty) <= Number(item.minStock);
                  const onLoanQty = Number(item.quantity) - Number(item.availableQty);
                  const isExpanded = expandedItemId === item.id;
                  return (
                    <div key={item.id} style={{ borderBottom: 'var(--border-c-subtle)' }}>
                      {/* 紧凑行（单击展开） */}
                      <div
                        className="flex items-center gap-2 px-3 h-10 cursor-pointer transition-colors hover:bg-[var(--recessed-bg-hover)]"
                        onClick={() => setExpandedItemId(prev => prev === item.id ? null : item.id)}
                      >
                        {/* 状态徽章 */}
                        <span className={cx('bds-badge sm shrink-0 w-16 justify-center', STATUS_TONES[item.status] ?? 'neutral')}>
                          {STATUS_LABELS[item.status] ?? item.status}
                        </span>
                        {/* 编号 */}
                        <span className="bds-mono text-[11px] text-[var(--text-tertiary)] shrink-0">{item.code}</span>
                        {/* 名称 */}
                        <span className="font-light text-xs text-[var(--text-primary)] truncate flex-1 min-w-0">{item.name}</span>
                        {/* 类型 */}
                        <span className="text-[10px] font-light text-[var(--text-tertiary)] shrink-0 hidden md:inline">{CARD_TYPE_LABELS[item.cardType] ?? item.cardType}</span>
                        {/* 数量 */}
                        <span className="bds-tnum text-[11px] font-light text-[var(--text-secondary)] shrink-0">
                          {item.availableQty}<span className="text-[var(--text-tertiary)]">/{item.quantity}</span>{item.unit ? ` ${item.unit}` : ''}
                        </span>
                        {/* 低库存标记 */}
                        {isLowStock && (
                          <span className="shrink-0 text-[10px] font-light" style={{ color: 'var(--warning-text)' }}>低库存</span>
                        )}
                        {/* 关联摘要（仅 xl+ 视口） */}
                        {(item.devCaseCode || item.orderPoNumber || item.productAssetSku || item.productAssetName || item.warehouseName) && (
                          <span className="text-[10px] font-light text-[var(--text-tertiary)] shrink-0 max-w-32 truncate hidden xl:inline">
                            {item.devCaseCode
                              ? `开发 ${item.devCaseCode}`
                              : item.orderPoNumber
                                ? `订单 ${item.orderPoNumber}`
                                : (item.productAssetSku || item.productAssetName)
                                  ? `档案 ${item.productAssetSku || item.productAssetName}`
                                  : `仓库 ${item.warehouseName}`}
                          </span>
                        )}
                        {/* 展开指示 */}
                        {isExpanded
                          ? <ChevronDown size={14} className="shrink-0 text-[var(--text-tertiary)]" />
                          : <ChevronRight size={14} className="shrink-0 text-[var(--text-tertiary)]" />}
                      </div>
                      {/* 展开详情 + 操作（手风琴） */}
                      {isExpanded && (
                        <div className="px-3 py-3 space-y-2" style={{ background: 'var(--recessed-bg)' }}>
                          {/* 数量明细 */}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] font-light text-[var(--text-tertiary)]">
                            <span>可用 <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>{item.availableQty}</span></span>
                            <span>· 总 <span className="bds-tnum">{item.quantity}</span>{item.unit ? ` ${item.unit}` : ''}</span>
                            <span>· 在借 <span className="bds-tnum">{onLoanQty}</span></span>
                            {item.minStock != null && <span style={isLowStock ? { color: 'var(--warning-text)' } : undefined}>· 最低 {item.minStock}</span>}
                            {item.maxStock != null && <span>· 最高 {item.maxStock}</span>}
                            {item.location && <span>· 架位 {item.location}</span>}
                            {item.colorCardCode && <span>· Pantone {item.colorCardCode}</span>}
                          </div>
                          {/* 关联单据 chips（可点击跳转：开发单→focusEntityId 直达详情，订单→onOpenOrder，档案→product 锚直达） */}
                          {(item.devCaseCode || item.orderPoNumber || item.productAssetSku || item.productAssetName || item.warehouseName) && (
                            <div className="flex flex-wrap gap-2 text-[10px] font-light">
                              {item.devCaseCode && (
                                onNavigate && item.devCaseId ? (
                                  <button
                                    type="button"
                                    onClick={() => openDevCaseDetail(item.devCaseId!)}
                                    className="rounded-compact px-2 py-0.5 transition-colors hover:brightness-105 active:brightness-95"
                                    style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}
                                    title="跳转到开发单详情"
                                  >
                                    开发 · {item.devCaseCode}{item.devCaseName ? ` ${item.devCaseName}` : ''}
                                  </button>
                                ) : (
                                  <span className="rounded-compact px-2 py-0.5" style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}>
                                    开发 · {item.devCaseCode}{item.devCaseName ? ` ${item.devCaseName}` : ''}
                                  </span>
                                )
                              )}
                              {item.orderPoNumber && (
                                onOpenOrder && item.orderId ? (
                                  <button
                                    type="button"
                                    onClick={() => openOrderDetail(item.orderId!)}
                                    className="rounded-compact px-2 py-0.5 transition-colors hover:brightness-105 active:brightness-95"
                                    style={{ background: 'var(--recessed-bg-strong)' }}
                                    title="跳转到订单详情"
                                  >
                                    订单 · {item.orderPoNumber}{item.orderCustomer ? ` ${item.orderCustomer}` : ''}
                                  </button>
                                ) : (
                                  <span className="rounded-compact px-2 py-0.5" style={{ background: 'var(--recessed-bg-strong)' }}>
                                    订单 · {item.orderPoNumber}{item.orderCustomer ? ` ${item.orderCustomer}` : ''}
                                  </span>
                                )
                              )}
                              {(item.productAssetSku || item.productAssetName) && (
                                onNavigate && item.productAssetId ? (
                                  <button
                                    type="button"
                                    onClick={() => openProductDetail(item.productAssetId!, item.productAssetName)}
                                    className="rounded-compact px-2 py-0.5 transition-colors hover:brightness-105 active:brightness-95"
                                    style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}
                                    title="跳转到产品档案详情"
                                  >
                                    档案 · {item.productAssetSku || item.productAssetName}{item.productAssetCategory ? ` · ${item.productAssetCategory}` : ''}
                                  </button>
                                ) : (
                                  <span className="rounded-compact px-2 py-0.5" style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}>
                                    档案 · {item.productAssetSku || item.productAssetName}{item.productAssetCategory ? ` · ${item.productAssetCategory}` : ''}
                                  </span>
                                )
                              )}
                              {item.warehouseName && (
                                <span className="rounded-compact px-2 py-0.5" style={{ background: 'var(--recessed-bg-strong)' }}>
                                  仓库 · {item.warehouseName}
                                </span>
                              )}
                            </div>
                          )}
                          {/* 在借信息 */}
                          {item.activeLoan && (
                            <div className="text-[10px] font-light text-[var(--text-tertiary)]">
                              {item.activeLoan.borrowerName}{item.activeLoan.loanQuantity > 1 ? ` ×${item.activeLoan.loanQuantity}` : ''}
                              {item.activeLoan.dueAt ? ` · 应还 ${new Date(item.activeLoan.dueAt).toLocaleDateString('zh-CN')}` : ''}
                              {item.overdue ? ' · 逾期' : ''}
                            </div>
                          )}
                          {/* 操作按钮簇 */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <button type="button" className="bds-btn bds-btn-ghost h-7 px-2 text-[11px]" title="二维码打印" onClick={() => openQr(item)}>
                              <QrCode size={14} />二维码
                            </button>
                            {canWrite && item.status !== 'retired' && (
                              <button type="button" className="bds-btn bds-btn-ghost h-7 px-2 text-[11px]" title="盘点" onClick={() => openAdjustSheet(item)}>
                                <ClipboardCheck size={14} />盘点
                              </button>
                            )}
                            {canWrite && item.status === 'in_stock' && Number(item.availableQty) > 0 && (
                              <button type="button" className="bds-btn bds-btn-secondary h-7 px-2 text-[11px]" onClick={() => openLoanSheet(item)}>
                                借出/看样
                              </button>
                            )}
                            {canWrite && item.status === 'borrowed' && item.activeLoan && (
                              <button type="button" className="bds-btn bds-btn-secondary h-7 px-2 text-[11px]" onClick={() => handleReturn(item)}>
                                <RotateCcw size={14} />归还
                              </button>
                            )}
                            {canWrite && item.status !== 'retired' && (
                              <button type="button" className="bds-btn bds-btn-ghost h-7 px-2 text-[11px]" title="退役" onClick={() => handleRetire(item)}>
                                <Archive size={14} />退役
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 登记样卡 BottomSheet */}
      {showItemSheet && (
        <BottomSheet isOpen onClose={() => !itemSaving && setShowItemSheet(false)} title="登记样卡" isDarkMode={isDarkMode}>
          <form className="space-y-4 px-6 py-5" onSubmit={(e) => { e.preventDefault(); void handleCreateItem(); }}>
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">样卡名称 *</label>
              <input value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} placeholder="面料名 / 色卡名 / 成衣款名" className="bds-input sm w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">类型</label>
                <CustomSelect
                  surface="form"
                    size="compact"
                  className="w-full"
                  value={itemForm.cardType}
                  onChange={v => setItemForm(f => ({ ...f, cardType: v }))}
                  options={Object.entries(CARD_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">架位</label>
                <input value={itemForm.location} onChange={e => setItemForm(f => ({ ...f, location: e.target.value }))} placeholder="如 A-01" className="bds-input sm w-full" />
              </div>
            </div>
            {/* v2 库存字段 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">数量 *</label>
                <input type="number" min="0" value={itemForm.quantity} onChange={e => setItemForm(f => ({ ...f, quantity: e.target.value }))} className="bds-input sm w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">单位</label>
                <CustomSelect
                  surface="form"
                    size="compact"
                  className="w-full"
                  value={itemForm.unit}
                  onChange={v => setItemForm(f => ({ ...f, unit: v }))}
                  options={UNITS.map(u => ({ value: u, label: u }))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">仓库</label>
                <CustomSelect
                  surface="form"
                    size="compact"
                  className="w-full"
                  value={itemForm.warehouseId}
                  onChange={v => setItemForm(f => ({ ...f, warehouseId: v }))}
                  options={[
                    { value: '', label: '未指定' },
                    ...warehouses.map(w => ({ value: w.id, label: w.name })),
                  ]}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">最低库存</label>
                <input type="number" min="0" value={itemForm.minStock} onChange={e => setItemForm(f => ({ ...f, minStock: e.target.value }))} placeholder="如 5" className="bds-input sm w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">最高库存</label>
                <input type="number" min="0" value={itemForm.maxStock} onChange={e => setItemForm(f => ({ ...f, maxStock: e.target.value }))} placeholder="如 100" className="bds-input sm w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">关联 Pantone 色号</label>
                <input value={itemForm.colorCardCode} onChange={e => setItemForm(f => ({ ...f, colorCardCode: e.target.value }))} placeholder="如 19-4052 TCX" className="bds-input sm w-full" />
              </div>
            </div>
            {/* v2 软关联（DR-057 v2.1 搜索选择化：产品档案/开发单/订单均下拉搜索，无手输 ID） */}
            <div className="grid grid-cols-3 gap-3">
              <div className="relative">
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">关联开发单（可选）</label>
                <input
                  value={devQuery}
                  onChange={(e) => {
                    setDevQuery(e.target.value);
                    if (!e.target.value.trim()) setItemForm(f => ({ ...f, devCaseId: '' }));
                  }}
                  placeholder="搜索开发单编号/名称"
                  className="bds-input sm w-full"
                />
                {itemForm.devCaseId && !devOptions.length && (
                  <div className="mt-1 truncate text-[10px] font-light" style={{ color: 'var(--success-text)' }}>
                    已选 · {devCasePicked || itemForm.devCaseId.slice(-8)}
                  </div>
                )}
                {devOptions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-field border border-[var(--border-c-subtle)] bg-[var(--bg-elevated)] p-1" style={{ boxShadow: 'var(--shadow-dropdown)' }}>
                    {devOptions.map(d => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          setItemForm(f => ({ ...f, devCaseId: d.id }));
                          setDevQuery(`${d.code} · ${d.name}`);
                          setDevCasePicked(d.code);
                          setDevOptions([]);
                        }}
                        className="w-full rounded-compact px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover-darken)]"
                      >
                        <div className="truncate text-[11px] font-light text-[var(--text-primary)]">{d.code}</div>
                        <div className="truncate text-[10px] font-light text-[var(--text-tertiary)]">{d.name}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">关联订单（可选）</label>
                <input
                  value={orderQuery}
                  onChange={(e) => {
                    setOrderQuery(e.target.value);
                    if (!e.target.value.trim()) setItemForm(f => ({ ...f, orderId: '' }));
                  }}
                  placeholder="搜索订单号 / 客户"
                  className="bds-input sm w-full"
                />
                {itemForm.orderId && !orderOptions.length && (
                  <div className="mt-1 truncate text-[10px] font-light" style={{ color: 'var(--success-text)' }}>
                    已选 · {orderPicked || itemForm.orderId.slice(-8)}
                  </div>
                )}
                {orderOptions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-field border border-[var(--border-c-subtle)] bg-[var(--bg-elevated)] p-1" style={{ boxShadow: 'var(--shadow-dropdown)' }}>
                    {orderOptions.map(o => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => {
                          setItemForm(f => ({ ...f, orderId: o.id }));
                          setOrderQuery(o.customer ? `${o.poNumber} · ${o.customer}` : o.poNumber);
                          setOrderPicked(o.poNumber);
                          setOrderOptions([]);
                        }}
                        className="w-full rounded-compact px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover-darken)]"
                      >
                        <div className="truncate text-[11px] font-light text-[var(--text-primary)]">{o.poNumber}</div>
                        <div className="truncate text-[10px] font-light text-[var(--text-tertiary)]">{o.customer || o.id}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">关联产品档案（可选）</label>
                <input
                  value={paQuery}
                  onChange={(e) => {
                    setPaQuery(e.target.value);
                    if (!e.target.value.trim()) setItemForm(f => ({ ...f, productAssetId: '' }));
                  }}
                  placeholder="搜索面料/成衣档案"
                  className="bds-input sm w-full"
                />
                {itemForm.productAssetId && !paOptions.length && (
                  <div className="mt-1 truncate text-[10px] font-light" style={{ color: 'var(--success-text)' }}>
                    已选档案
                  </div>
                )}
                {paOptions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-field border border-[var(--border-c-subtle)] bg-[var(--bg-elevated)] p-1" style={{ boxShadow: 'var(--shadow-dropdown)' }}>
                    {paOptions.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setItemForm(f => ({ ...f, productAssetId: a.id }));
                          setPaQuery(a.name || (a as any).sku || a.id);
                          setPaOptions([]);
                        }}
                        className="w-full rounded-compact px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover-darken)]"
                      >
                        <div className="truncate text-[11px] font-light text-[var(--text-primary)]">{a.name}</div>
                        <div className="truncate text-[10px] font-light text-[var(--text-tertiary)]">
                          {(a as any).sku ? `SKU ${(a as any).sku}` : a.id}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">备注</label>
              <input value={itemForm.notes} onChange={e => setItemForm(f => ({ ...f, notes: e.target.value }))} placeholder="登记备注" className="bds-input sm w-full" />
            </div>
            <div className="text-[10px] font-light leading-relaxed text-[var(--text-tertiary)]">
              登记后自动生成样卡编号（SC-日期-序号）并弹出二维码，打印贴卡即用；扫码按编号直达样卡。
            </div>
            {sheetError && <div className="bds-alert danger">{sheetError}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" disabled={itemSaving} onClick={() => setShowItemSheet(false)} className="bds-btn bds-btn-ghost">取消</button>
              <button type="submit" disabled={itemSaving || !itemForm.name.trim()} className="bds-btn bds-btn-primary">
                {itemSaving ? '登记中...' : '登记并出二维码'}
              </button>
            </div>
          </form>
        </BottomSheet>
      )}

      {/* 借出/看样 BottomSheet */}
      {loanTarget && (
        <BottomSheet isOpen onClose={() => !loanSaving && setLoanTarget(null)} title={`借出 / 看样 · ${loanTarget.code}`} isDarkMode={isDarkMode}>
          <form className="space-y-4 px-6 py-5" onSubmit={(e) => { e.preventDefault(); void handleCreateLoan(); }}>
            {/* 库存摘要 */}
            <div className="rounded-inset px-3 py-2 text-[11px] font-light text-[var(--text-tertiary)]" style={{ background: 'var(--recessed-bg)' }}>
              可用 {loanTarget.availableQty} / 总 {loanTarget.quantity}{loanTarget.unit ? ` ${loanTarget.unit}` : ''}
              {loanTarget.minStock != null && ` · 最低 ${loanTarget.minStock}`}
            </div>
            <div className="flex flex-wrap gap-2">
              {([['borrow', '内部借出'], ['viewing', '客户看样']] as const).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setLoanForm(f => ({ ...f, loanType: type }))}
                  className={cx(loanForm.loanType === type ? 'bds-btn bds-btn-secondary' : 'bds-btn bds-btn-ghost')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">借出数量 *</label>
              <input
                type="number"
                min="1"
                max={Number(loanTarget.availableQty)}
                value={loanForm.loanQuantity}
                onChange={e => setLoanForm(f => ({ ...f, loanQuantity: e.target.value }))}
                className="bds-input sm w-full"
              />
              <div className="mt-1 text-[10px] font-light text-[var(--text-tertiary)]">单次最多 {loanTarget.availableQty}；部分借出（仍有余量）保持「在库」状态。</div>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">
                {loanForm.loanType === 'borrow' ? '借用人 *' : '看样联系人 *'}
              </label>
              <input value={loanForm.borrowerName} onChange={e => setLoanForm(f => ({ ...f, borrowerName: e.target.value }))} placeholder="姓名" className="bds-input sm w-full" />
            </div>
            {loanForm.loanType === 'viewing' && (
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">看样客户 *</label>
                <RelationCombobox
                  value={loanForm.relationName}
                  relationId={loanForm.relationId || undefined}
                  relations={relations}
                  filterCategories={['Customer']}
                  placeholder="从关系智库搜索客户"
                  isDarkMode={isDarkMode}
                  onChange={({ name, relationId }) => setLoanForm(f => ({ ...f, relationName: name, relationId: relationId ?? '' }))}
                />
                <div className="mt-1 text-[10px] font-light text-[var(--text-tertiary)]">看样即看即还（不占借出状态），记录挂客户档案。</div>
              </div>
            )}
            {loanForm.loanType === 'borrow' && (
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">预计归还日</label>
                <CapsuleDateInput className="bds-input sm w-auto" value={loanForm.dueDate} onChange={(v) => setLoanForm(f => ({ ...f, dueDate: v }))} isDarkMode={isDarkMode} />
                <div className="mt-1 text-[10px] font-light text-[var(--text-tertiary)]">逾期（超过预计归还日未还）在列表标红提醒。</div>
              </div>
            )}
            {sheetError && <div className="bds-alert danger">{sheetError}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" disabled={loanSaving} onClick={() => setLoanTarget(null)} className="bds-btn bds-btn-ghost">取消</button>
              <button type="submit" disabled={loanSaving || !loanForm.borrowerName.trim() || (loanForm.loanType === 'viewing' && !loanForm.relationId)} className="bds-btn bds-btn-primary">
                {loanSaving ? '登记中...' : loanForm.loanType === 'borrow' ? '确认借出' : '登记看样'}
              </button>
            </div>
          </form>
        </BottomSheet>
      )}

      {/* 盘点 BottomSheet */}
      {adjustTarget && (
        <BottomSheet isOpen onClose={() => !adjustSaving && setAdjustTarget(null)} title={`盘点 · ${adjustTarget.code}`} isDarkMode={isDarkMode}>
          <form className="space-y-4 px-6 py-5" onSubmit={(e) => { e.preventDefault(); void handleAdjust(); }}>
            <div className="rounded-inset px-3 py-2 text-[11px] font-light text-[var(--text-tertiary)]" style={{ background: 'var(--recessed-bg)' }}>
              当前 · 总 {adjustTarget.quantity} · 可用 {adjustTarget.availableQty}{adjustTarget.unit ? ` ${adjustTarget.unit}` : ''} · 在借 {Number(adjustTarget.quantity) - Number(adjustTarget.availableQty)}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">新总数量 *</label>
                <input type="number" min="0" value={adjustForm.newQuantity} onChange={e => setAdjustForm(f => ({ ...f, newQuantity: e.target.value }))} className="bds-input sm w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">新最低库存</label>
                <input type="number" min="0" value={adjustForm.newMinStock} onChange={e => setAdjustForm(f => ({ ...f, newMinStock: e.target.value }))} placeholder="留空清除" className="bds-input sm w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">新最高库存</label>
                <input type="number" min="0" value={adjustForm.newMaxStock} onChange={e => setAdjustForm(f => ({ ...f, newMaxStock: e.target.value }))} placeholder="留空清除" className="bds-input sm w-full" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] tracking-[0.14em] text-[var(--text-tertiary)]">盘点原因</label>
              <input value={adjustForm.reason} onChange={e => setAdjustForm(f => ({ ...f, reason: e.target.value }))} placeholder="如 周期盘点 / 损耗调整" className="bds-input sm w-full" />
            </div>
            <div className="text-[10px] font-light leading-relaxed text-[var(--text-tertiary)]">
              盘点只改总量；在借数量自动保留。新总数量不可小于当前在借数量（{Number(adjustTarget.quantity) - Number(adjustTarget.availableQty)}）。
            </div>
            {sheetError && <div className="bds-alert danger">{sheetError}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" disabled={adjustSaving} onClick={() => setAdjustTarget(null)} className="bds-btn bds-btn-ghost">取消</button>
              <button type="submit" disabled={adjustSaving} className="bds-btn bds-btn-primary">
                {adjustSaving ? '盘点中...' : '确认盘点'}
              </button>
            </div>
          </form>
        </BottomSheet>
      )}

      {/* 二维码打印 BottomSheet */}
      {qrItem && (
        <BottomSheet isOpen onClose={() => setQrItem(null)} title="样卡二维码" isDarkMode={isDarkMode}>
          <div className="space-y-4 px-6 py-5">
            <div className="flex flex-col items-center gap-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={`QR ${qrItem.code}`} className="h-48 w-48 rounded-card bg-white p-2" />
              ) : (
                <div className="h-48 w-48 flex items-center justify-center text-xs text-[var(--text-tertiary)]">生成中...</div>
              )}
              <div className="text-center">
                <div className="text-sm font-light text-[var(--text-primary)]">{qrItem.name}</div>
                <div className="text-xs font-light text-[var(--text-tertiary)]">{qrItem.code}</div>
                {qrItem.location && <div className="text-[10px] font-light text-[var(--text-tertiary)]">架位 {qrItem.location}</div>}
              </div>
              <button type="button" className="bds-btn bds-btn-secondary" onClick={() => window.print()}>
                <QrCode size={14} />打印贴卡
              </button>
              <div className="text-[10px] font-light leading-relaxed text-[var(--text-tertiary)] text-center">
                二维码载荷为样卡编号 {qrItem.code}；扫码后在样品间按编号搜索直达该样卡。
              </div>
            </div>
          </div>
        </BottomSheet>
      )}
    </div>
  );
};

export default SampleRoomPanel;
