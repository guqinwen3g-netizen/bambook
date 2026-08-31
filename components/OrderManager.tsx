
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Order, KnowledgeItem, PoItem, Relation, OrderLineItem, OrderLineLite, OrderStatusTransition, View, CompletenessEntityData } from '../types';
import { apiService } from '../services/apiService';
import { CompletenessBanner } from './ui/CompletenessIndicators';
import {
  Plus, ArrowRight,
  X, AlertCircle,
  Trash2, Edit2, Save, Package,
  AlertTriangle,
  Globe, List,
  Upload, ShoppingCart, ClipboardCheck, Ship, CheckCircle2, GitBranch,
  Search, ArrowLeft, Eye, FileText, Loader2, Download,
  ArrowUp, ArrowDown, ArrowUpDown
} from 'lucide-react';
import A4DocumentPreviewModal from './ui/A4DocumentPreviewModal';
import { TraceabilityPanel } from './TraceabilityPanel';
import { SampleColorBatchPanel } from './development/SampleColorBatchPanel';
import { TestRequestPanel } from './qc/TestRequestPanel';
import { OrderProcessChainPanel } from './mes/OrderProcessChainPanel';
import { OrderShipmentBatchPanel } from './orders/OrderShipmentBatchPanel';
import { TechPackPanel } from './orders/TechPackPanel';
import { TcChainPanel } from './suppliers/TcChainPanel';
import ImportWizard from './import/ImportWizard';
import { ParsedOrder, SavedOrderRow } from '../types';
import { saveParsedOrders, updateOrderFields } from '../services/importService';
import { createOrderLine, updateOrderLineFields } from '../services/orderLineService';
import { checkFabricExclusivity, type FabricExclusivityViolation } from '../services/fabricExclusivityClient';
import { consumeCrossModuleNav, matchesProductAnchor } from '../services/crossModuleNav';
import { NavRelationFilterChip } from './ui/NavRelationFilterChip';
import OrderClusterBlock from './order/OrderClusterBlock';
import OrderLinesTable from './order/OrderLinesTable';
import OrderToleranceSection from './order/OrderToleranceSection';
import { useGlassSurfaceEdgeMasks } from './ui/useGlassSurfaceEdgeMasks';
import { ProductionPipeline } from './ProductionPipeline';
import { ProductionAlerts } from './ProductionAlerts';
import { PageHeader } from './ui/PageHeader';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';
import { hasPermission } from '../services/authService';
import CustomSelect from './ui/CustomSelect';
import { CompiledTableShell } from './ui/primitives/compiledPrimitives';
import { CompiledMotionInteractiveCard, CompiledSurfacePanel } from './ui/primitives/compiledSurfacePrimitives';
import { RelatedWorkspacesSection } from './ui/RelatedWorkspacesSection';
import AuditHistorySection from './AuditHistorySection';
import OrderContextSection from './order/OrderContextSection';
import OrderSectionHeader from './order/OrderSectionHeader';
import OrderChangeRequestsSection, {
  CapsuleExemptionBadge,
  OrderMoqSnapshotBlock,
  type ChangeRequestGatePrefill,
} from './order/OrderChangeRequestsSection';
import { collectControlledFieldEdits, isApprovedOrderStatus } from '../services/orderChangeService';
import { fieldsForDetail, fieldsForManualForm, requiredKeysForManual, computeAutoFillPatch, fieldMetaByKey, ORDER_CLUSTERS, dbValueToTypeKey, type OrderViewType } from '../lib/orderSchema';
import type { RoleFkTarget } from '../lib/orderSchema';
import { flattenOrderLines, getNextItemNo } from '../lib/orderLineItems';
import { formatYmd } from '../lib/dateFormat';
import { primeProcurementCreateFromOrder } from './ProcurementManager';
import { primeQcAssignmentFromOrder } from './QcWorkbenchManager';
import { primeShipmentCreateFromOrder } from './ShipmentManager';

/**
 * Convert a row returned by `POST /api/v1/orders/import` into the rich
 * frontend `Order` shape so it can be merged into local state and shown in
 * the existing list view.
 */
export function savedRowToOrder(row: SavedOrderRow): Order {
  const firstLine = row.lines?.[0];
  // 客户/工厂为必填业务字段：缺省不再兜底假名（防误导性假数据入档），
  // 置空交由后端必填校验 fail-closed，列表/详情层对空串渲染「—」。
  const customer = row.customer || '';
  const supplier = row.millName || '';
  return {
    id: row.id,
    customer,
    product: row.product,
    type: (row.type === 'Garment' ? 'Garment' : row.type === 'Other' ? 'Other' : 'Fabric') as Order['type'],
    millName: supplier,
    quantity: row.quantity ?? 0,
    status: (row.status as Order['status']) ?? 'Pending',
    dueDate: row.dueDate ?? '',
    quoteAmount: row.quoteAmount ?? 0,
    updatedAt: row.updatedAt ?? Date.now(),
    poNumber: row.poNumber ?? undefined,
    poDate: row.poDate ?? undefined,
    season: row.season ?? undefined,
    // ZROH = 客供品号（Peerless PO 里对应 materialCode）
    clientCode: firstLine?.materialCode ?? undefined,
    // 工厂品色号 = mill quality
    productColorCode: firstLine?.millQuality ?? undefined,
    contactPerson: row.contactPerson ?? undefined,
    contactTelephone: row.contactPhone ?? undefined,
    asPerson: row.shipToName ?? undefined,
    // 生产交期 = delivery date；出厂交期 = exmill date
    productionDate: firstLine?.deliveryDate ?? undefined,
    clientDate: firstLine?.exMillDate ?? row.dueDate ?? undefined,
    // 面料基本信息（作为 poItems 为空时的兜底）
    fabricCode: firstLine?.materialCode ?? undefined,
    fabricContent: firstLine?.cloth ?? firstLine?.description ?? undefined,
    width: firstLine?.width ?? undefined,
    gsm: firstLine?.weight ?? undefined,
    paymentMethod: row.paymentTerms ?? undefined,
    contractAmount: row.totalActual ?? undefined,
    consignee: row.deliverTo ?? undefined,
    // 业务线快照（条件展开：避免导入合并路径把既有标记覆盖为 undefined）
    ...(row.businessLine != null ? { businessLine: row.businessLine } : {}),
    // 行明细整体带过来，订单列表里要按行展开。
    lines: row.lines ?? [],
  };
}

function mergeSavedOrders(existing: Order[], saved: SavedOrderRow[]): Order[] {
  const byId = new Map(existing.map((o) => [o.id, o] as const));
  for (const row of saved) {
    const next = savedRowToOrder(row);
    const prev = byId.get(row.id);
    byId.set(row.id, prev ? { ...prev, ...next } : next);
  }
  return Array.from(byId.values());
}

interface OrderManagerProps {
  orders: Order[];
  /** 服务端订单总数（快照 meta 透传）；> orders.length 时列表底部出现「加载更多」 */
  ordersTotal?: number | null;
  dirtyIds: Set<string>;
  setOrders: (o: Order[], modified?: Order) => void;
  onSyncComplete: (id: string) => void;
  knowledge: KnowledgeItem[];
  viewMode: 'globe' | 'list';
  onViewModeChange: (mode: 'globe' | 'list') => void;
  selectedOrder: Order | null;
  onSelectOrder: (order: Order | null) => void;
  isDarkMode?: boolean;
  orderType: OrderViewType; // 区分订单类型（含 'all'）
  onOrderTypeChange?: (type: OrderViewType) => void; // Tab 切换回调
  /** Relations list — drives the Customer / Mill / Consignee / Bill-to comboboxes. */
  relations?: Relation[];
  /** Optional: invoked when a combobox asks to create a brand-new Relation. */
  onCreateRelation?: (typedName: string, fkTarget: RoleFkTarget) => Promise<{ id: string; name: string } | null> | { id: string; name: string } | null;
  allowGlobeView?: boolean;
  onFullscreenOpenChange?: (open: boolean) => void;
  /** 阶段 D / D3：全链路区块点击卡片跳转对应模块 */
  onNavigate?: (view: View) => void;
}

// ── E3 列头排序（客户 / 金额 / 交期；点击表头 升序→降序→取消 循环） ──
export type OrderListSortKey = 'customer' | 'amount' | 'dueDate';
export interface OrderListSort {
  key: OrderListSortKey;
  dir: 'asc' | 'desc';
}

/**
 * 行项目排序比较器（纯函数导出，供列表 useMemo 与单测复用）。
 * 取数口径与行渲染一致：金额=行 amount；交期=行 exMillDate → 订单 clientDate → dueDate；
 * 客户=行 customer → 订单 customer。空日期恒排末位（与方向无关）。
 */
export function compareOrderLineItems(a: OrderLineItem, b: OrderLineItem, sort: OrderListSort): number {
  const dirFactor = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'amount') {
    return ((a.amount ?? 0) - (b.amount ?? 0)) * dirFactor;
  }
  if (sort.key === 'dueDate') {
    const da = a.exMillDate || a.order?.clientDate || a.order?.dueDate || '';
    const db = b.exMillDate || b.order?.clientDate || b.order?.dueDate || '';
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db) * dirFactor;
  }
  const ca = a.customer || a.order?.customer || '';
  const cb = b.customer || b.order?.customer || '';
  return ca.localeCompare(cb, 'zh-CN') * dirFactor;
}

/**
 * E5：订单异常提示的真实原因——取状态时间线中最近一次「→ Alert」流转的 note
 * （handleStatusTransition 留痕字段，后端 OrderStatusTransition 落库）。
 * 时间线按时间升序，倒序找首条命中即最新；无 note 返回 null 由 UI 走兜底文案。
 */
export function resolveOrderAlertReason(timeline: OrderStatusTransition[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const t = timeline[i];
    if (t.toStatus === 'Alert' && typeof t.note === 'string' && t.note.trim()) {
      return t.note.trim();
    }
  }
  return null;
}

const ORDER_TABLE_GRID_CLASS = 'grid-cols-[22%_15%_27%_13%_13%_10%]';
const ORDER_TABLE_WIDTH_CLASS = 'w-full min-w-0';
const ORDER_TABLE_ROW_CLASS = 'min-h-16';
const ORDER_TABLE_COLUMN_WIDTH_CLASSES = [
  'w-[22%]',
  'w-[15%]',
  'w-[27%]',
  'w-[13%]',
  'w-[13%]',
  'w-[10%]',
];
const ORDER_TABLE_HEADERS: Array<{ label: string; align?: string; sortKey?: OrderListSortKey; sortLabel?: string }> = [
  { label: '订单 / 客户', sortKey: 'customer', sortLabel: '客户' },
  { label: '品号' },
  { label: '描述 / 色号' },
  { label: '数量 / 金额', align: 'text-right', sortKey: 'amount', sortLabel: '金额' },
  { label: '日期', sortKey: 'dueDate', sortLabel: '交期' },
  { label: '状态 / 动作' },
];
const ORDER_TYPE_LABELS: Record<'all' | 'fabric' | 'garment' | 'other', string> = {
  all: '全部',
  fabric: '面料',
  garment: '成衣',
  other: '其他',
};

const ORDER_TYPE_TO_DB: Record<'fabric' | 'garment' | 'other', 'Fabric' | 'Garment' | 'Other'> = {
  fabric: 'Fabric',
  garment: 'Garment',
  other: 'Other',
};

/** 辅助函数：订单类型的中文标签映射 */
const DB_TYPE_ZH: Record<string, string> = {
  Fabric: '面料',
  Garment: '成衣',
  Other: '其他',
};

// ── BDS v2.1：主题透明样式映射（暗色由 tokens.css [data-theme]/.dark 统一覆盖，组件内零 isDarkMode 分支） ──
/** 订单状态 → bds-badge 语义变体（Confirmed/Production/Shipping 进行中归并 info） */
const STATUS_BADGE_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  Pending: 'neutral',
  Confirmed: 'info',
  Production: 'info',
  Shipping: 'info',
  Delivered: 'success',
  Alert: 'warning',
};

/** 订单类型 → 分类徽章内联样式（Fabric=accent / Garment=wisteria / Other=琥珀 warning 系 token） */
const ORDER_TYPE_BADGE_STYLE: Record<string, React.CSSProperties> = {
  Fabric: { background: 'var(--accent-tint)', color: 'var(--accent-text)' },
  Garment: { background: 'var(--wisteria-tint)', color: 'var(--wisteria-text)' },
  Other: { background: 'var(--warning-tint)', color: 'var(--warning-text)' },
};

/** 订单类型 → 分类圆点内联样式（小元素允许彩色） */
const ORDER_TYPE_DOT_STYLE: Record<string, React.CSSProperties> = {
  Fabric: { background: 'var(--accent)' },
  Garment: { background: 'var(--brand-wisteria)' },
  Other: { background: 'var(--warning)' },
};

/** 文字层级 token 类：title > secondary > muted > faint */
const TXT_TITLE = 'text-[var(--text-primary)]';
const TXT_SECONDARY = 'text-[var(--text-secondary)]';
const TXT_MUTED = 'text-[var(--text-tertiary)]';
const TXT_FAINT = 'text-[var(--text-quaternary)]';
/** 分区 kicker（小字 EN 标签） */
const KICKER_CLASS = `text-xs font-light uppercase tracking-[0.22em] ${TXT_MUTED}`;
/** 1px 细分隔条底色（竖/横共用） */
const DIVIDER_CLASS = 'bg-[var(--border-c-strong)]';

/** bar 状态筛选选项（CustomSelect surface="field" 消费） */
const ORDER_STATUS_FILTER_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'Pending', label: '待确认' },
  { value: 'Confirmed', label: '已确认' },
  { value: 'Production', label: '生产中' },
  { value: 'Shipping', label: '发货中' },
  { value: 'Delivered', label: '已交付' },
  { value: 'Alert', label: '异常' },
];
/** 细边框色（统计分隔/卡内分隔线） */
const BORDER_SUBTLE_CLASS = 'border-[var(--border-c-subtle)]';

/** 履约状态步骤条按钮四态（BDS 按钮变体；current/done 带 disabled 属性时需 !opacity-100 抵消 bds-btn:disabled 透明度） */
const STEP_BTN_CURRENT = 'bds-btn bds-btn-primary !min-w-24 !opacity-100';
const STEP_BTN_DONE = 'bds-btn bds-btn-outline !min-w-24 !opacity-100';
const STEP_BTN_ACTIONABLE = 'bds-btn bds-btn-outline !min-w-24';
const STEP_BTN_DISABLED = 'bds-btn bds-btn-ghost !min-w-24';

/** 覆盖层顶/底遮挡渐变（页面画布 token 驱动，主题透明） */
const OVERLAY_TOP_MASK_STYLE: React.CSSProperties = {
  background: 'linear-gradient(to bottom, var(--bg-page) 0%, color-mix(in srgb, var(--bg-page) 85%, transparent) 72%, transparent 100%)',
};
const OVERLAY_BOTTOM_MASK_STYLE: React.CSSProperties = {
  background: 'linear-gradient(to top, var(--bg-page) 0%, color-mix(in srgb, var(--bg-page) 70%, transparent) 65%, transparent 100%)',
};

/** 覆盖层面板容器类（玻璃材质由 CompiledSurfacePanel 承担，此处仅布局/内边距） */
const OVERLAY_MAP_PANEL_CLASS = 'p-4 bambook-relations-form-map-panel';
const OVERLAY_FORM_PANEL_CLASS = 'scroll-mt-28 p-5 bambook-relations-form-panel';
/** Detail Map / Form Map 导航按钮与序号胶囊（token 墨色 + hover 反馈） */
const OVERLAY_MAP_BUTTON_CLASS = `w-full text-left rounded-full border border-transparent px-3 py-3 transition-colors duration-200 ${TXT_SECONDARY} hover:bg-[var(--hover-darken)] hover:border-[var(--border-c-subtle)] hover:text-[var(--text-primary)]`;
const OVERLAY_MAP_INDEX_CLASS = `border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] ${TXT_MUTED}`;
/** 覆盖层头部 meta（编辑/查阅模式、录入标记等降级元信息） */
const HEADER_META_CLASS = `shrink-0 text-xs font-light ${TXT_MUTED}`;
/** 状态步骤条连接线（done=accent 45% / pending=border token） */
const STEP_CONNECTOR_DONE_STYLE: React.CSSProperties = { background: 'color-mix(in srgb, var(--accent) 45%, transparent)' };
const STEP_CONNECTOR_PENDING_CLASS = 'bg-[var(--border-c-strong)]';
/** Alert 步骤按钮激活态（warning 语义 token；非激活态走 bds-btn-ghost） */
const STEP_BTN_ALERT_STYLE: React.CSSProperties = { background: 'var(--warning-tint)', color: 'var(--warning-text)' };
/** 时间线圆点/连接线（latest=accent + accent-tint 光晕） */
const TIMELINE_DOT_CLASS = 'bg-[var(--border-c-strong)]';
const TIMELINE_DOT_ACTIVE_CLASS = 'bg-[var(--accent)] ring-4 ring-[var(--accent-tint)]';
const TIMELINE_CONNECTOR_CLASS = 'bg-[var(--border-c-subtle)]';
/** 时间线"最新"标签（accent tint 小徽章） */
const TIMELINE_LATEST_BADGE_CLASS = 'rounded-full bg-[var(--accent-tint)] px-1.5 py-px text-[10px] font-light tracking-wide text-[var(--accent-text)]';
/** 查阅态字段槽位/文字（有值= sunken 底 + secondary 墨；空值=更淡底 + faint 斜体） */
const FIELD_SLOT_FILLED_CLASS = 'bg-[var(--recessed-bg)]';
const FIELD_SLOT_EMPTY_CLASS = 'bg-[var(--hover-darken)]';
const FIELD_READONLY_VALUE_CLASS = `text-sm font-normal leading-relaxed ${TXT_SECONDARY}`;
const FIELD_READONLY_EMPTY_CLASS = `text-sm font-light italic leading-relaxed ${TXT_FAINT}`;
/** 数字输入框去原生步进器（与 bds-input 组合使用） */
const FIELD_NO_SPINNER_CLASS = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

// ── 阶段 IA-3：订单履约状态机（镜像后端 orderLifecycleService ORDER_TRANSITIONS；唯一状态真源仍是后端，前端仅做可行动性提示） ──
const ORDER_FLOW_STEPS = ['Pending', 'Confirmed', 'Production', 'Shipping', 'Delivered'] as const;
const ORDER_STATUS_LABELS: Record<string, string> = {
  Pending: '待确认',
  Confirmed: '已确认',
  Production: '生产中',
  Shipping: '出运中',
  Delivered: '已交付',
  Alert: '异常',
};
const ORDER_ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  Pending: ['Confirmed', 'Alert'],
  Confirmed: ['Production', 'Alert'],
  Production: ['Shipping', 'Alert'],
  Shipping: ['Delivered', 'Alert'],
  Delivered: [],
  Alert: ['Pending', 'Confirmed', 'Production', 'Shipping'],
};

const OrderManager: React.FC<OrderManagerProps> = ({ orders, ordersTotal, dirtyIds, setOrders, onSyncComplete, knowledge, viewMode, onViewModeChange, selectedOrder, onSelectOrder, isDarkMode = false, orderType, onOrderTypeChange, relations = [], onCreateRelation, allowGlobeView = true, onFullscreenOpenChange, onNavigate }) => {
  // Local state removed, using props
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTracePanel, setShowTracePanel] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Order | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [poItems, setPoItems] = useState<PoItem[]>([]);
  const [selectedLineItem, setSelectedLineItem] = useState<OrderLineItem | null>(null);
  const [editLineForm, setEditLineForm] = useState<Partial<OrderLineItem> | null>(null);
  // ── P1-3 客户专属面料行级即时警示（仅提示不放行；提交仍由后端 fail-closed 兜底；API 失败静默降级）──
  const [editLineFabricViolations, setEditLineFabricViolations] = useState<FabricExclusivityViolation[] | null>(null);
  const editLineFabricTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editLineFabricSeqRef = useRef(0);
  useEffect(() => () => {
    if (editLineFabricTimerRef.current) clearTimeout(editLineFabricTimerRef.current);
  }, []);
  // REQ2-03：行保存（shipmentQuantity/tolerancePercent 变更）后自增，驱动溢短装视图重取
  const [toleranceRefreshKey, setToleranceRefreshKey] = useState(0);
  const [statusTimeline, setStatusTimeline] = useState<OrderStatusTransition[]>([]);
  // R4：时间线加载失败可见化（区分「加载失败」与「无记录」）
  const [timelineError, setTimelineError] = useState<string | null>(null);
  // R5：防重三连——保存修改 / 状态推进 / 归档确认
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [statusTransitioning, setStatusTransitioning] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // R678-⑧ 写操作按钮可见性门禁：与后端 requirePermission('orders:write') 同口径
  // （owner 全权 *；admin/manager/merchandiser 默认含 orders:write；归档后端另有
  // owner/admin/manager 角色门禁兜底 fail-closed，前端按写权限隐藏入口）
  const canWriteOrders = hasPermission('orders:write');

  // R3：列表分页——快照首页 limit=500 可能截断；total 由 App 快照 meta 透传，底部「加载更多」按 offset 续拉
  const [ordersTotalLocal, setOrdersTotalLocal] = useState<number | null>(ordersTotal ?? null);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  useEffect(() => { setOrdersTotalLocal(ordersTotal ?? null); }, [ordersTotal]);
  const handleLoadMoreOrders = useCallback(async () => {
    if (loadingMoreOrders) return;
    setLoadingMoreOrders(true);
    try {
      const page = await apiService.listOrdersPage(undefined, { limit: 500, offset: orders.length });
      // 与 App 首屏装载同口径：后端行格式需 savedRowToOrder 转换（启发式判别）
      const converted = page.items.map((r: any) => {
        if (r.customer && !r.poNumber) return r as Order;
        try { return savedRowToOrder(r); } catch { return r as Order; }
      });
      const existing = new Set(orders.map(o => o.id));
      const fresh = converted.filter(o => !existing.has(o.id));
      if (fresh.length > 0) setOrders([...orders, ...fresh]);
      setOrdersTotalLocal(page.total);
    } catch (e: any) {
      bdsToast.danger(`加载更多订单失败：${e?.message ?? e}`);
    } finally {
      setLoadingMoreOrders(false);
    }
  }, [loadingMoreOrders, orders, setOrders]);
  const hasMoreOrders = ordersTotalLocal != null && orders.length < ordersTotalLocal;

  // ── B8 订单确认书（OC）：A4 预览 + 生成 PDF（服务端模板，与采购/报价同款体验） ──
  const [ocPreviewOpen, setOcPreviewOpen] = useState(false);
  const [ocPreviewHtml, setOcPreviewHtml] = useState('');
  const [ocPreviewLoading, setOcPreviewLoading] = useState(false);
  const [ocPreviewErr, setOcPreviewErr] = useState<string | null>(null);
  const [ocGenerating, setOcGenerating] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const handlePreviewOc = useCallback(async (orderId: string) => {
    setOcPreviewOpen(true);
    setOcPreviewHtml('');
    setOcPreviewErr(null);
    setOcPreviewLoading(true);
    try {
      const html = await apiService.getOrderConfirmationPreviewHtml(orderId);
      setOcPreviewHtml(html);
    } catch (e: any) {
      setOcPreviewErr(`订单确认书预览加载失败：${e?.message || e}`);
    } finally {
      setOcPreviewLoading(false);
    }
  }, []);

  const handleGenerateOc = useCallback(async (orderId: string) => {
    setOcGenerating(true);
    try {
      const result = await apiService.generateOrderConfirmationDocument(orderId);
      bdsToast.success(`已生成 ${result.documentNumber}（${Math.round(result.fileSize / 1024)} KB），归档至单据中心`);
    } catch (e: any) {
      bdsToast.danger(`生成订单确认书失败：${e?.message || e}`);
    } finally {
      setOcGenerating(false);
    }
  }, []);
  // DR-010 编辑门禁：已批准订单受控字段直改被拦截后，预填并引导到变更申请表单
  const [changeGatePrefill, setChangeGatePrefill] = useState<ChangeRequestGatePrefill | null>(null);
  const orderDetailScrollRef = useRef<HTMLDivElement | null>(null);
  const orderEntryScrollRef = useRef<HTMLDivElement | null>(null);
  const orderListScrollRef = useRef<HTMLDivElement | null>(null);

  // Load status timeline when selected order changes
  useEffect(() => {
    if (!selectedOrder?.id) { setStatusTimeline([]); setTimelineError(null); return; }
    (async () => {
      try {
        const timeline = await apiService.getOrderTimeline(selectedOrder.id!);
        setStatusTimeline(timeline);
        setTimelineError(null);
      } catch (e: any) {
        // R4：加载失败必须可见（不再静默为空），UI 区分「加载失败」与「暂无记录」
        setStatusTimeline([]);
        setTimelineError(`时间线加载失败：${e?.message ?? e}`);
      }
    })();
  }, [selectedOrder?.id]);

  // 资料完备度横幅（GET /api/completeness/entity?type=order）：详情头部增强提示，
  // 拉取失败或后端未就绪时静默降级为不展示（提示型数据，不阻塞详情阅读）
  const [orderCompleteness, setOrderCompleteness] = useState<CompletenessEntityData | null>(null);
  useEffect(() => {
    if (!selectedOrder?.id) { setOrderCompleteness(null); return; }
    let cancelled = false;
    apiService.completenessEntity('order', selectedOrder.id)
      .then((data) => { if (!cancelled) setOrderCompleteness(data ?? null); })
      .catch(() => { if (!cancelled) setOrderCompleteness(null); });
    return () => { cancelled = true; };
  }, [selectedOrder?.id]);

  // Push order status forward with audit trail
  const handleStatusTransition = useCallback(async (toStatus: string, note?: string) => {
    if (!selectedOrder?.id) return;
    if (statusTransitioning) return; // R5：连点 guard——状态机流转进行中拒绝并发推进
    setStatusTransitioning(true);
    try {
      // 操作人不再由前端传字面量（防伪造/失真）：服务端以认证 actorId 为留痕唯一真源，
      // operator 形参传空串占位（apiService 契约暂留该参数，服务端忽略空值）。
      const updated = await apiService.transitionOrderStatus(selectedOrder.id, toStatus, '', note);
      const nextOrders = orders.map(o => o.id === updated.id ? updated : o);
      setOrders(nextOrders, updated);
      onSelectOrder(updated);
      // Refresh timeline
      try {
        const timeline = await apiService.getOrderTimeline(selectedOrder.id!);
        setStatusTimeline(timeline);
        setTimelineError(null);
      } catch { /* 时间线刷新失败非关键：状态已可见更新，保持静默 */ }
    } catch (e: any) {
      // IA 残留收口：推进失败必须用户可见（191.6 登记体验债），走 bdsToast 反馈
      bdsToast.danger(`状态推进失败：${e?.message ?? e}\n\n订单状态未变更，请稍后重试。`);
    } finally {
      setStatusTransitioning(false);
    }
  }, [selectedOrder?.id, orders, setOrders, onSelectOrder, statusTransitioning]);

  // 阶段 IA-3：订单详情下游动作区 —— prime 目标模块创建表单后跳转（复用后端 L1-L10 联动，前端补触发点）
  const handlePrimeProcurement = useCallback(() => {
    if (!selectedOrder || !onNavigate) return;
    const firstLine = selectedOrder.lines?.[0];
    primeProcurementCreateFromOrder({
      orderId: selectedOrder.id,
      poNumber: selectedOrder.poNumber,
      materialCode: selectedLineItem?.materialCode ?? firstLine?.materialCode ?? selectedOrder.fabricCode,
      description: selectedLineItem?.description ?? firstLine?.description ?? selectedOrder.fabricContent ?? selectedOrder.product,
      quantity: selectedLineItem?.quantity ?? firstLine?.quantity ?? selectedOrder.quantity,
      unit: selectedLineItem?.unit ?? firstLine?.unit ?? undefined,
    });
    onNavigate(View.Procurement);
  }, [selectedOrder, selectedLineItem, onNavigate]);

  const handlePrimeQc = useCallback(() => {
    if (!selectedOrder || !onNavigate) return;
    primeQcAssignmentFromOrder(selectedOrder.id);
    onNavigate(View.QcWorkbench);
  }, [selectedOrder, onNavigate]);

  const handlePrimeShipment = useCallback(() => {
    if (!selectedOrder || !onNavigate) return;
    primeShipmentCreateFromOrder({
      orderId: selectedOrder.id,
      customerName: selectedOrder.consignee || selectedOrder.customer,
    });
    onNavigate(View.Shipments);
  }, [selectedOrder, onNavigate]);

  useGlassSurfaceEdgeMasks({
    scrollRef: orderDetailScrollRef,
    enabled: !!selectedOrder && !showAddModal,
    topHeight: 96,
    bottomHeight: 112,
  });

  useGlassSurfaceEdgeMasks({
    scrollRef: orderEntryScrollRef,
    enabled: showAddModal,
    topHeight: 96,
    bottomHeight: 112,
  });

  // 订单类型辅助变量（在 getDefaultNewOrder 之前声明）
  const isAllType = orderType === 'all';
  const currentDbType = !isAllType ? ORDER_TYPE_TO_DB[orderType] : null;

  // 订单录入表单的默认值（支持 Fabric/Garment/Other 动态类型）
  const getDefaultNewOrder = (type?: string): Partial<Order> => {
    const dbType = (type || currentDbType || 'Fabric') as 'Fabric' | 'Garment' | 'Other';
    const prefix = dbType === 'Garment' ? 'GAR' : dbType === 'Other' ? 'OTH' : 'FAB';
    const defaultUnit: Record<'Fabric' | 'Garment' | 'Other', string> = {
      Fabric: 'Meter',
      Garment: 'Pcs',
      Other: 'KG',
    };
    return {
      id: `${prefix}-${Date.now().toString().slice(-6)}`,
      status: 'Pending',
      type: dbType,
    quantity: 0,
    quoteAmount: 0,
    unit: defaultUnit[dbType],
    dueDate: new Date().toISOString().split('T')[0],
    poDate: new Date().toISOString().split('T')[0],
    season: '',
    productionBatch: '',
    poNumber: '',
    itemNo: '',
    clientCode: '',
    productColorCode: '',
    referenceBatch: '',
    productionDate: '',
    clientDate: '',
    salesPrice: 0,
    contractAmount: 0,
    paymentMethod: 'Net 30',
    ocDays: 30,
    consignee: '',
    specialInstructions: '',
    // Fabric 专属字段
    customer: '',
    customerAddress: '',
    product: '',
    factoryLat: undefined,
    factoryLon: undefined,
    contactPerson: '',
    contactTelephone: '',
    asPerson: '',
    // 面料规格
    fabricContent: '',
    fabricCode: '',
    width: '',
    gsm: '',
    // 样品追踪
    needShipmentSample: true,
    needHeaderSample: true,
    // 财务
    salesCurrency: 'USD',
    purchaseCurrency: 'CNY',
    purchasePrice: 0,
    purchasePaymentDate: '',
    supplierInvoiceNumber: '',
    supplierInvoiceDate: '',
    supplierInvoiceAmount: 0,
    // 发票
    invoiceNumber: '',
    invoiceDate: '',
    shipmentQuantity: 0,
    shipmentAmount: 0,
    // 收汇
    expectedPaymentDate: '',
    actualPaymentDate: '',
    actualPaymentAmount: 0,
    // 样品
    sampleSentDate: '',
    sampleTrackingNumber: '',
    sampleConfirmedDate: '',
    fabricSampleSentDate: '',
    fabricSampleTrackingNumber: '',
    fabricSampleConfirmedDate: '',
    paidSampleQuantity: 0,
    shipmentSampleComments: '',
    factoryVisitDate: '',
    // 物流
    shippingDate: '',
    shippingMethod: '',
    };
  };

  const [newOrder, setNewOrder] = useState<Partial<Order>>(getDefaultNewOrder());

  const resetNewOrder = () => setNewOrder(getDefaultNewOrder());


  // 只显示未删除且类型与当前 Tab 匹配的订单
  // Capsule 子视图：成衣 Tab 下的业务线透镜（capsuleOnly 仅 garment 生效；未标记订单归大货）
  const [capsuleOnly, setCapsuleOnly] = useState(false);
  const capsuleActive = orderType === 'garment' && capsuleOnly;

  // 跨模块导航筛选（关系智库档案「关联业务 → 订单」入口）：挂载时消费一次，
  // 之后用户可点 ✕ 清除回到全量视图。订单按四个角色维度取并集（下单/收货/结算/供应）。
  const [navRelationFilter, setNavRelationFilter] = useState(() => consumeCrossModuleNav()?.filter ?? null);
  const orderMatchesNav = (o: Order | undefined) => {
    if (!o || !navRelationFilter) return true;
    // 产品锚：按订单行编码（itemNo/materialCode）∈ 产品编码集合匹配
    if (navRelationFilter.anchor === 'product') return matchesProductAnchor(o as any, navRelationFilter);
    // relation 锚：按四个角色维度（下单/收货/结算/供应）取并集
    const id = navRelationFilter.relationId;
    return o.customerRelationId === id ||
      o.consigneeRelationId === id ||
      o.billToRelationId === id ||
      o.millRelationId === id;
  };

  const filteredOrders = orders.filter(o =>
    !o.deletedAt &&
    (isAllType || o.type === currentDbType) &&
    (!capsuleActive || o.businessLine === 'capsule') &&
    orderMatchesNav(o),
  );
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [orderFilterStatus, setOrderFilterStatus] = useState<string>('all');
  // E3：列头排序状态（null=默认服务端/录入顺序）
  const [orderSort, setOrderSort] = useState<OrderListSort | null>(null);
  const handleSortToggle = useCallback((key: OrderListSortKey) => {
    setOrderSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }, []);

  /** 订单台账 Excel 导出（当前列表筛选全量：类型/状态/搜索/Capsule 透镜镜像到服务端过滤） */
  const handleExportXlsx = useCallback(async () => {
    setExportingXlsx(true);
    try {
      await apiService.exportOrdersXlsx({
        ...(currentDbType ? { type: currentDbType } : {}),
        ...(orderFilterStatus !== 'all' ? { status: orderFilterStatus } : {}),
        ...(capsuleActive ? { businessLine: 'capsule' } : {}),
        ...(orderSearchTerm.trim() ? { search: orderSearchTerm.trim() } : {}),
      });
    } catch (e: any) {
      bdsToast.danger(`台账导出失败：${e?.message || e}`);
    } finally {
      setExportingXlsx(false);
    }
  }, [currentDbType, orderFilterStatus, capsuleActive, orderSearchTerm]);

  const lineItems = useMemo(() => {
    let items = flattenOrderLines(orders).filter(item => isAllType || item.order?.type === currentDbType);
    if (capsuleActive) {
      items = items.filter(item => item.order?.businessLine === 'capsule');
    }
    if (navRelationFilter) {
      items = items.filter(item => orderMatchesNav(item.order));
    }
    if (orderFilterStatus !== 'all') {
      items = items.filter(item => item.order?.status === orderFilterStatus);
    }
    if (orderSearchTerm.trim()) {
      const q = orderSearchTerm.trim().toLowerCase();
      items = items.filter(item =>
        item.order?.poNumber?.toLowerCase().includes(q) ||
        item.order?.customer?.toLowerCase().includes(q) ||
        item.materialCode?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.order?.clientCode?.toLowerCase().includes(q)
      );
    }
    // E3：列头排序（在全部筛选之后应用，稳定排序保持同值行原顺序）
    if (orderSort) {
      items = [...items].sort((a, b) => compareOrderLineItems(a, b, orderSort));
    }
    return items;
  }, [orders, orderType, capsuleActive, orderSearchTerm, orderFilterStatus, orderSort, isAllType, currentDbType, navRelationFilter]);

  const mergeLineIntoOrders = (line: OrderLineItem, sourceOrders: Order[] = orders): Order[] => {
    const parent = line.order;
    const lineLite: OrderLineLite = {
      id: line.id,
      orderId: line.orderId,
      lineNumber: line.lineNumber,
      itemNo: line.itemNo,
      materialCode: line.materialCode,
      millQuality: line.millQuality,
      description: line.description,
      width: line.width,
      exMillDate: line.exMillDate,
      deliveryDate: line.deliveryDate,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      netValue: line.netValue,
      cloth: line.cloth,
      weight: line.weight,
      status: line.status,
      productionBatch: line.productionBatch,
      shippingDate: line.shippingDate,
      shippingMethod: line.shippingMethod,
      invoiceNumber: line.invoiceNumber,
      invoiceDate: line.invoiceDate,
      shipmentQuantity: line.shipmentQuantity,
      shipmentAmount: line.shipmentAmount,
      actualPaymentDate: line.actualPaymentDate,
      actualPaymentAmount: line.actualPaymentAmount,
      specialInstructions: line.specialInstructions,
      // 成衣 line 级字段（sizeBreakdown/productionSteps/bomItems/styleNo/colorName/garmentSampleStages）
      sizeBreakdown: line.sizeBreakdown,
      productionSteps: line.productionSteps,
      bomItems: line.bomItems,
      styleNo: line.styleNo,
      colorName: line.colorName,
      garmentSampleStages: line.garmentSampleStages,
    };
    const existing = sourceOrders.find((order) => order.id === parent.id);
    if (!existing) return [{ ...parent, lines: [lineLite] }, ...sourceOrders];
    return sourceOrders.map((order) => {
      if (order.id !== parent.id) return order;
      const previousLines = order.lines ?? [];
      const hasLine = previousLines.some((l) => l.id === line.id);
      return {
        ...order,
        ...parent,
        lines: hasLine
          ? previousLines.map((l) => (l.id === line.id ? { ...l, ...lineLite } : l))
          : [...previousLines, lineLite].sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0)),
      };
    });
  };

  const handleOrderClick = async (order: Order) => {
    setSelectedLineItem(null);
    setEditLineForm(null);
    clearEditLineFabricWarning();
    onSelectOrder(order);
    setIsEditing(false);
    setEditForm({ ...order });
    // 面料明细：直接从 order.lines 映射（不再调 /api/po/items）
    if (order.lines && order.lines.length > 0) {
      setPoItems(order.lines.map((line, idx) => ({
        poNumber: order.poNumber || '',
        itemNo: line.itemNo || String(line.lineNumber ?? idx + 1),
        peerlessNumber: '',
        zrohNumber: line.materialCode || '',
        qualityDescription: line.description || '',
        fabricCode: line.millQuality || '',
        width: line.width || '',
        exmillDate: line.exMillDate || '',
        deliveryDate: line.deliveryDate || '',
        quantity: line.quantity,
        unit: line.unit || '',
        unitPrice: line.unitPrice || 0,
        fabricContent: line.cloth || '',
        gsm: line.weight || '',
        netValue: line.netValue || 0,
        shippingMethod: '',
        category: '',
      })));
    } else {
      setPoItems([]);
    }
  };

  /**
   * 合同金额 ↔ 销售单价 × 数量 双向联动。
   * 规则：
   * - patch 中含 salesPrice → contractAmount = salesPrice × quantity（仅当 quantity > 0）
   * - patch 中含 contractAmount → salesPrice = contractAmount / quantity（仅当 quantity > 0）
   * - patch 中含 quantity 但不含 salesPrice/contractAmount → contractAmount = salesPrice × quantity（沿用既存单价）
   * - patch 中同时含 salesPrice + contractAmount → 用户手动双方都改了，以 contractAmount 口径回算单价作为兜底；保留用户手动值
   * 所有结果保留 2 位小数（避免 float 精度噪音）。
   */
  const applyAmountLinkage = <T extends Partial<Order>>(prev: T, patch: Partial<Order>): Partial<Order> => {
    const next: Record<string, any> = { ...prev, ...patch };
    const qty = Number(next.quantity) || 0;
    const hasSalesPrice = 'salesPrice' in patch;
    const hasContract = 'contractAmount' in patch;
    const hasQty = 'quantity' in patch;
    const toNum = (x: any) => (x === '' || x === null || x === undefined ? 0 : Number(x));
    const round2 = (n: number) => Math.round(n * 100) / 100;

    if (qty > 0) {
      if (hasSalesPrice && !hasContract) {
        const price = toNum(patch.salesPrice);
        if (price >= 0) next.contractAmount = round2(price * qty);
      } else if (hasContract && !hasSalesPrice) {
        const amount = toNum(patch.contractAmount);
        if (amount >= 0) next.salesPrice = round2(amount / qty);
      } else if (hasQty && !hasSalesPrice && !hasContract) {
        const price = toNum(next.salesPrice);
        if (price >= 0) next.contractAmount = round2(price * qty);
      }
    }
    return next;
  };

  // ── P1-3 行面料即时预检：产品锚 = 客供品号(materialCode)/工厂品色号(millQuality)，触发面与
  // 后端 order-line:create/update 一致；宽语义（clientCodeGlobalFallback=false，预检端点固定），
  // 差异漏报场景由提交时后端 assertFabricAllowed fail-closed 兜底 ──
  const clearEditLineFabricWarning = () => {
    editLineFabricSeqRef.current += 1;
    if (editLineFabricTimerRef.current) {
      clearTimeout(editLineFabricTimerRef.current);
      editLineFabricTimerRef.current = null;
    }
    setEditLineFabricViolations(null);
  };

  const scheduleEditLineFabricCheck = (nextLine: { materialCode?: unknown; millQuality?: unknown }) => {
    if (editLineFabricTimerRef.current) clearTimeout(editLineFabricTimerRef.current);
    const materialCode = typeof nextLine.materialCode === 'string' ? nextLine.materialCode.trim() : '';
    const millQuality = typeof nextLine.millQuality === 'string' ? nextLine.millQuality.trim() : '';
    // 无产品锚不警示（字段空不能卡业务，与后端「无产品锚不阻断」语义一致）
    if (!materialCode && !millQuality) {
      setEditLineFabricViolations(null);
      return;
    }
    editLineFabricSeqRef.current += 1;
    const seq = editLineFabricSeqRef.current;
    const docCustomer = ((isEditing && editForm) || selectedOrder) as Partial<Order> | null;
    editLineFabricTimerRef.current = setTimeout(() => {
      checkFabricExclusivity({
        clientCode: materialCode || null,
        millQuality: millQuality || null,
        customerRelationId: docCustomer?.customerRelationId ?? null,
        customerName: docCustomer?.customer ?? null,
      })
        .then((result) => {
          if (seq !== editLineFabricSeqRef.current) return; // 竞态守卫：切行/新一轮输入已作废旧回包
          setEditLineFabricViolations(result.allowed ? null : result.violations);
        })
        .catch(() => {
          if (seq !== editLineFabricSeqRef.current) return;
          setEditLineFabricViolations(null); // 预检失败静默降级：API 不通时不阻塞录入、不打扰用户
        });
    }, 500);
  };

  const handleLineClick = (item: OrderLineItem) => {
    setSelectedLineItem(item);
    setEditLineForm({ ...item });
    clearEditLineFabricWarning();
    onSelectOrder(item.order);
    setIsEditing(false);
    setEditForm({ ...item.order });
  };

  // ── R678-② 编辑脏数据防丢：进入编辑时打快照，关闭（遮罩/返回/X）前有改动先 bdsConfirm ──
  const editSnapshotRef = useRef<{ order: string; line: string } | null>(null);
  const hasUnsavedEdits = () => {
    if (!isEditing) return false;
    const snap = editSnapshotRef.current;
    if (!snap) return false;
    if (JSON.stringify(editForm ?? null) !== snap.order) return true;
    if (JSON.stringify(editLineForm ?? null) !== snap.line) return true;
    return false;
  };
  const requestCloseDetail = async () => {
    if (hasUnsavedEdits()) {
      const ok = await bdsConfirm({
        title: '放弃未保存的修改？',
        body: '当前订单有未保存的编辑内容，关闭后修改将丢失。',
        danger: true,
        confirmText: '放弃修改',
        cancelText: '继续编辑',
      });
      if (!ok) return;
    }
    onSelectOrder(null);
    setSelectedLineItem(null);
    setEditLineForm(null);
    clearEditLineFabricWarning();
    setIsEditing(false);
    setEditForm(null);
    editSnapshotRef.current = null;
  };

  // ── R678-⑥ 变更申请生效后刷新订单本体（V2 详情口径，与列表同源）──
  const refreshSelectedOrderFromServer = useCallback(async () => {
    if (!selectedOrder?.id) return;
    try {
      const url = apiService.buildApiUrl(`/v2/orders/${encodeURIComponent(selectedOrder.id)}`);
      const res = await fetch(url, { headers: apiService.getAuthHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const fresh = data?.order as Order | undefined;
      if (!fresh?.id) return;
      setOrders(orders.map(o => (o.id === fresh.id ? fresh : o)), fresh);
      onSelectOrder(fresh);
      if (selectedLineItem?.id) {
        // 行视角同步：重拍平 fresh.lines，选中行指向新对象（防陈旧读）
        const freshFlat = flattenOrderLines([fresh]).find((l) => l.id === selectedLineItem.id);
        if (freshFlat) setSelectedLineItem(freshFlat);
      }
    } catch { /* 刷新失败非关键：变更已生效，下次同步追上 */ }
  }, [selectedOrder?.id, selectedLineItem?.id, orders, setOrders, onSelectOrder]);


  const handleSaveEdit = async () => {
    if (!editForm) return;
    if (isSavingEdit) return; // R5：防重——保存进行中拒绝重复提交
    setIsSavingEdit(true);
    try {
    if (selectedLineItem && editLineForm) {
      // Line-level patch: includes both fabric (common) fields AND
      // garment-specific fields (styleNo/colorName/sizeBreakdown/...)
      // so that garment order edits are persisted in a single call.
      const linePatch: Partial<OrderLineLite> = {
        itemNo: editLineForm.itemNo,
        materialCode: editLineForm.materialCode,
        millQuality: editLineForm.millQuality,
        description: editLineForm.description,
        cloth: editLineForm.cloth,
        width: editLineForm.width,
        weight: editLineForm.weight,
        quantity: editLineForm.quantity,
        unit: editLineForm.unit,
        unitPrice: editLineForm.unitPrice,
        netValue: editLineForm.netValue,
        exMillDate: editLineForm.exMillDate,
        deliveryDate: editLineForm.deliveryDate,
        status: editLineForm.status,
        productionBatch: editLineForm.productionBatch,
        shippingDate: editLineForm.shippingDate,
        shippingMethod: editLineForm.shippingMethod,
        invoiceNumber: editLineForm.invoiceNumber,
        invoiceDate: editLineForm.invoiceDate,
        shipmentQuantity: editLineForm.shipmentQuantity,
        shipmentAmount: editLineForm.shipmentAmount,
        tolerancePercent: editLineForm.tolerancePercent,
        actualPaymentDate: editLineForm.actualPaymentDate,
        actualPaymentAmount: editLineForm.actualPaymentAmount,
        specialInstructions: editLineForm.specialInstructions,
        // Garment-specific line fields — must be persisted here since
        // the old dedicated garment branch (below) is unreachable when
        // selectedLineItem is set (which it always is for garment orders).
        styleNo: editLineForm.styleNo,
        colorName: editLineForm.colorName,
        sizeBreakdown: editLineForm.sizeBreakdown,
        productionSteps: editLineForm.productionSteps,
        bomItems: editLineForm.bomItems,
        garmentSampleStages: editLineForm.garmentSampleStages,
      };
      const { line } = await updateOrderLineFields(selectedLineItem.id, linePatch);
      const merged = mergeLineIntoOrders(line);
      setOrders(merged, line.order);
      setSelectedLineItem(line);
      setEditLineForm({ ...line });
      onSelectOrder(line.order);
      setIsEditing(false);
      setToleranceRefreshKey((k) => k + 1);
      return;
    }
    // DR-010 门禁引导：已批准订单的受控字段（数量/金额/交期/客户/产品）直改不直接落库——
    // 还原为原值，其余字段正常保存，并引导用户走变更申请审批链（而非静默失败/静默绕过）。
    const controlledEdits = selectedOrder && isApprovedOrderStatus(selectedOrder.status)
      ? collectControlledFieldEdits(
          selectedOrder as unknown as Record<string, unknown>,
          editForm as unknown as Record<string, unknown>,
        )
      : [];
    const updatedOrder = {
      ...editForm,
      updatedAt: Date.now(),
    };
    if (controlledEdits.length > 0) {
      for (const edit of controlledEdits) {
        (updatedOrder as unknown as Record<string, unknown>)[edit.field] = (selectedOrder as unknown as Record<string, unknown>)[edit.field];
      }
    }
    const updatedOrders = orders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
    // Optimistic local update first so the UI feels instant.
    setOrders(updatedOrders, updatedOrder);
    onSelectOrder(updatedOrder);
    setIsEditing(false);

    // Persist via the new field-aware PUT endpoint so subsequent PDF re-imports
    // honour the manual override (server tags each touched field as
    // 'manual'/'imported-then-edited' in `fieldSources`).
    try {
      // Line-level save (fallback path): when selectedLineItem is null (user
      // entered edit from order detail without clicking a specific line), we
      // still need to persist ALL line-level fields — both common fabric fields
      // AND garment-specific fields — so nothing is lost.
      if (editLineForm?.id) {
        const linePatch: Partial<OrderLineLite> = {
          itemNo: editLineForm.itemNo,
          materialCode: editLineForm.materialCode,
          millQuality: editLineForm.millQuality,
          description: editLineForm.description,
          cloth: editLineForm.cloth,
          width: editLineForm.width,
          weight: editLineForm.weight,
          quantity: editLineForm.quantity,
          unit: editLineForm.unit,
          unitPrice: editLineForm.unitPrice,
          netValue: editLineForm.netValue,
          exMillDate: editLineForm.exMillDate,
          deliveryDate: editLineForm.deliveryDate,
          status: editLineForm.status,
          productionBatch: editLineForm.productionBatch,
          shippingDate: editLineForm.shippingDate,
          shippingMethod: editLineForm.shippingMethod,
          invoiceNumber: editLineForm.invoiceNumber,
          invoiceDate: editLineForm.invoiceDate,
          shipmentQuantity: editLineForm.shipmentQuantity,
          shipmentAmount: editLineForm.shipmentAmount,
          tolerancePercent: editLineForm.tolerancePercent,
          actualPaymentDate: editLineForm.actualPaymentDate,
          actualPaymentAmount: editLineForm.actualPaymentAmount,
          specialInstructions: editLineForm.specialInstructions,
          styleNo: editLineForm.styleNo,
          colorName: editLineForm.colorName,
          sizeBreakdown: editLineForm.sizeBreakdown,
          productionSteps: editLineForm.productionSteps,
          bomItems: editLineForm.bomItems,
          garmentSampleStages: editLineForm.garmentSampleStages,
        };
        try {
          const { line: savedLine } = await updateOrderLineFields(editLineForm.id, linePatch);
          const lineMerged = mergeLineIntoOrders(savedLine, updatedOrders);
          setOrders(lineMerged, savedLine.order);
          onSelectOrder(savedLine.order);
          setToleranceRefreshKey((k) => k + 1);
        } catch (lineErr: any) {
          // eslint-disable-next-line no-console
          console.error('[detail-save] line persist failed:', lineErr);
          bdsToast.danger(`行项目字段保存失败：${lineErr?.message ?? lineErr}\n\n订单级字段将继续保存。`);
        }
      }

      const { id, lines: _ignoreLines, fieldSources: _ignoreSources, ...patch } = updatedOrder as any;
      // 被门禁拦截的受控字段不进入持久化 patch（避免字段被误标 manual 且绕过 DR-010 审批链）
      for (const edit of controlledEdits) {
        delete (patch as Record<string, unknown>)[edit.field];
      }
      const { order: persisted } = await updateOrderFields(id, patch);
      const synced = updatedOrders.map((o) => (o.id === id ? (persisted as Order) : o));
      setOrders(synced, persisted as Order);
      onSelectOrder(persisted as Order);
      bdsToast.success('订单详情已保存');
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[detail-save] persist failed:', e);
      bdsToast.danger(`订单详情保存到服务器失败：${e?.message ?? e}\n\n本地更改保留，但下一次同步可能丢失。`);
    }

    // 受控字段被拦截 → 预填变更申请并滚动到「变更申请」区块（引导而非静默失败）
    if (controlledEdits.length > 0) {
      setChangeGatePrefill({ edits: controlledEdits });
      requestAnimationFrame(() => {
        document.getElementById('order-detail-changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Auto-fill handler: when a Relation FK is selected, auto-fill related fields
  const handleRelationSelected = (fkField: string, relation: Relation) => {
    if (!editForm) return;
    const patch = computeAutoFillPatch(fkField, relation);
    if (Object.keys(patch).length > 0) {
      setEditForm((prev) => prev ? { ...prev, ...patch } : prev);
    }
  };

  // Same for new order form
  const handleNewRelationSelected = (fkField: string, relation: Relation) => {
    const patch = computeAutoFillPatch(fkField, relation);
    if (Object.keys(patch).length > 0) {
      setNewOrder((prev) => ({ ...prev, ...patch }));
    }
  };

  // ERP-P0 orders-delete-real-sync: 调用后端 DELETE /api/v1/orders/:id（softDelete）。
  // 失败不从本地列表移除，给用户可见反馈；成功后用后端返回的 order（含 deletedAt）更新状态。
  const handleDeleteOrder = async () => {
    if (!selectedOrder?.id) return;
    if (isArchiving) return; // R5：归档进行中拒绝重复点击
    setIsArchiving(true);
    const archiveLabel = selectedOrder.poNumber || selectedOrder.id;
    try {
      // 成功：用后端返回的 order（含 deletedAt）更新本地状态，保持与后端一致
      // 不传 modified 第二参——本函数已直接调后端 DELETE，传 modified 会触发
      // App.handleUpdateOrders 的二次 deleteOrder（modified.deletedAt 分支）。
      const tombstone = await apiService.deleteOrderRemote(selectedOrder.id);
      const updatedOrders = orders.map(o => o.id === tombstone.id ? tombstone : o);
      setOrders(updatedOrders);
      onSelectOrder(null);
      setShowDeleteConfirm(false);
      bdsToast.success(`订单已归档：${archiveLabel}，可在历史档案中查询`);
    } catch (e: any) {
      bdsToast.danger(`订单删除失败：${e?.message ?? e}\n\n订单未从列表移除，请稍后重试。`);
      setShowDeleteConfirm(false);
    } finally {
      setIsArchiving(false);
    }
  };

  const handleUpdateStatus = async (newStatus: Order['status']) => {
    if (selectedLineItem && editLineForm) {
      setEditLineForm({ ...editLineForm, status: newStatus });
      return;
    }
    if (!selectedOrder) return;
    if (editForm) {
      setEditForm({ ...editForm, status: newStatus });
    }
  };

  const handleAddOrder = async () => {
    // Validate against the dictionary so this stays in sync with the rendered form.
    const required = requiredKeysForManual(manualTypeKey);
    const missing: string[] = [];
    for (const k of required) {
      const v = (newOrder as any)[k];
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
        const meta = fieldMetaByKey(k);
        missing.push(meta?.labelZh || String(k));
      }
    }
    if (missing.length > 0) {
      bdsToast.warning(`必填项缺失，无法创建订单：\n\n· ${missing.join('\n· ')}`);
      return;
    }

    const draft: Partial<Order> = { ...newOrder };
    const poNumber = String(draft.poNumber || '').trim();
    const existingPoLines = orders.find((order) => order.poNumber === poNumber || order.id === poNumber)?.lines ?? [];
    const itemNo = String((draft as any).itemNo || getNextItemNo(existingPoLines.map((line) => line.itemNo)));

    setShowAddModal(false);
    resetNewOrder();

    try {
      const { line } = await createOrderLine({
        poNumber,
        itemNo,
        customer: draft.customer,
        materialCode: draft.clientCode,
        millQuality: draft.productColorCode,
        description: draft.product,
        cloth: draft.fabricContent,
        width: draft.width,
        weight: draft.gsm,
        quantity: Number(draft.quantity || 0),
        unit: (draft.unit as any) ?? 'Meter',
        unitPrice: draft.salesPrice,
        netValue: draft.contractAmount ?? draft.quoteAmount,
        exMillDate: draft.clientDate || draft.dueDate,
        deliveryDate: draft.productionDate,
        status: draft.status,
        specialInstructions: draft.specialInstructions,
        salesCurrency: draft.salesCurrency,
        purchaseCurrency: draft.purchaseCurrency,
      });
      const merged = mergeLineIntoOrders(line);
      setOrders(merged, line.order);
      setSelectedLineItem(line);
      onSelectOrder(line.order);
      bdsToast.success(`订单已创建：${line.order?.poNumber || line.order?.id || '新订单'}`);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[manual-line-create] failed:', e);
      bdsToast.danger(`面料项目未能保存到服务器：${e?.message ?? e}`);
    }
  };

  const desktopFullscreenOpen = showAddModal || !!selectedOrder;
  const effectiveViewMode = allowGlobeView ? viewMode : 'list';
  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 样式分支，暗色由 tokens.css [data-theme]/.dark 统一覆盖 ──
  // 表格行三档文字（密集阅读场景，token 墨色）
  const listRowPrimaryCls = `truncate text-sm font-light leading-[1.25] tracking-normal ${TXT_TITLE}`;
  const listRowRegularCls = `truncate text-sm font-light leading-[1.25] tracking-normal ${TXT_SECONDARY}`;
  const listRowSecondaryCls = `mt-1 truncate text-xs font-light leading-[1.2] tracking-normal ${TXT_MUTED}`;
  // 行内"查看详情"交互暗示（hover 变 accent）
  const listRowActionHintCls = `mt-1 flex items-center gap-1 text-xs font-light leading-[1.2] tracking-normal transition-colors duration-200 ${TXT_MUTED} group-hover:text-[var(--accent-text)]`;
  // 字段按订单类型过滤：面料订单只看面料字段，成衣订单只看成衣字段
  const detailTypeKey = dbValueToTypeKey(selectedOrder?.type);
  const manualTypeKey: 'fabric' | 'garment' | 'other' = orderType === 'all' ? 'fabric' : orderType;
  const detailSections = fieldsForDetail(detailTypeKey);
  const manualSections = fieldsForManualForm(manualTypeKey);

  // 四路订单类型切换（全部 / 面料 / 成衣 / 其他）。Capsule = 成衣 Tab 下的业务线透镜；
  // 未标记业务线的成衣订单归大货透镜（businessLine null 语义）。
  // Capsule 始终显示，非成衣 Tab 时 disabled，避免 Tab 栏宽度抖动。
  // BDS v2.1：分段控件统一走 bds-segment（.seg + .active），主题透明。
  const renderOrderTypeSwitcher = () => (
    <>
      {(['all', 'fabric', 'garment', 'other'] as const).map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => { setCapsuleOnly(false); onOrderTypeChange?.(type); }}
          className={`seg whitespace-nowrap ${orderType === type && !capsuleActive ? 'active' : ''}`}
        >
          {ORDER_TYPE_LABELS[type]}
        </button>
      ))}
      <button
        type="button"
        disabled={orderType !== 'garment'}
        onClick={() => { onOrderTypeChange?.('garment'); setCapsuleOnly(true); }}
        className={`seg whitespace-nowrap ${capsuleActive ? 'active' : ''} ${orderType !== 'garment' ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
      >
        Capsule
      </button>
    </>
  );

  // 业务线标记（成衣订单：大货 ⇄ Capsule）——走 businessLines 专用端点（注册表存在/启用校验 + 审计），
  // 成功后同步本地列表与选中订单；失败走 bdsToast 反馈。
  const [businessLineSaving, setBusinessLineSaving] = useState(false);
  const handleSetBusinessLine = async (code: 'garment' | 'capsule') => {
    if (!selectedOrder || businessLineSaving) return;
    const current = selectedOrder.businessLine === 'capsule' ? 'capsule' : 'garment';
    if (current === code) return;
    setBusinessLineSaving(true);
    try {
      await apiService.setOrderBusinessLine(selectedOrder.id, code);
      setOrders(orders.map(o => (o.id === selectedOrder.id ? { ...o, businessLine: code } : o)));
      onSelectOrder({ ...selectedOrder, businessLine: code });
    } catch (e: any) {
      bdsToast.danger(`业务线标记失败：${e?.message ?? e}\n请稍后重试。`);
    } finally {
      setBusinessLineSaving(false);
    }
  };

  useEffect(() => {
    onFullscreenOpenChange?.(desktopFullscreenOpen);
    return () => onFullscreenOpenChange?.(false);
  }, [desktopFullscreenOpen, onFullscreenOpenChange]);

  return (
    <div className="w-full h-full flex flex-col bg-transparent overflow-hidden pointer-events-none">
      <PageHeader
        title="订单管理"
        subtitle="Production Orders"
        contextLabel="Order Desk"
        hidden={desktopFullscreenOpen}
        className="pointer-events-auto"
        actions={(
          <>
            <div className="flex items-center gap-1 md:hidden">
              {allowGlobeView && (
                <button
                  type="button"
                  title="地球视图"
                  onClick={() => onViewModeChange('globe')}
                  className={`bds-toggle${effectiveViewMode === 'globe' ? ' active' : ''}`}
                >
                  <Globe size={16} strokeWidth={1.5} />
                </button>
              )}
              <button
                type="button"
                title="列表视图"
                onClick={() => onViewModeChange('list')}
                className={`bds-toggle${effectiveViewMode === 'list' ? ' active' : ''}`}
              >
                <List size={16} strokeWidth={1.5} />
              </button>
            </div>
            {canWriteOrders && (
              <>
                <button
                  type="button"
                  onClick={() => { onSelectOrder(null); setShowImportWizard(true); }}
                  className="bds-btn bds-btn-secondary"
                >
                  <Upload size={16} strokeWidth={1.5} /> 导入
                </button>
                <button
                  type="button"
                  onClick={() => { onSelectOrder(null); setNewOrder({ ...getDefaultNewOrder(), type: currentDbType || 'Fabric' }); setShowAddModal(true); }}
                  className="bds-btn bds-btn-primary"
                >
                  <Plus size={16} strokeWidth={1.5} /> 录入订单
                </button>
              </>
            )}
            {selectedOrder?.id && (
              <button
                type="button"
                onClick={() => setShowTracePanel(true)}
                className="bds-btn bds-btn-secondary"
              >
                <GitBranch size={16} strokeWidth={1.5} /> 溯源
              </button>
            )}
            {selectedOrder?.id && (
              <>
                <button
                  type="button"
                  onClick={() => void handlePreviewOc(selectedOrder.id)}
                  className="bds-btn bds-btn-secondary"
                  title="订单确认书 A4 预览（与生成 PDF 同源排版）"
                >
                  <Eye size={16} strokeWidth={1.5} /> 确认书
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerateOc(selectedOrder.id)}
                  disabled={ocGenerating}
                  className="bds-btn bds-btn-secondary"
                  title="生成订单确认书 PDF 并归档单据中心"
                >
                  {ocGenerating ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <FileText size={16} strokeWidth={1.5} />}
                  生成 PDF
                </button>
              </>
            )}
            {/* B10 运营域报表：订单台账 Excel 导出（当前筛选全量） */}
            <button
              type="button"
              onClick={() => void handleExportXlsx()}
              disabled={exportingXlsx}
              className="bds-btn bds-btn-secondary"
              title="订单台账 Excel 导出（当前筛选全量）"
            >
              {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              导出台账
            </button>
          </>
        )}
      />

      <ImportWizard
        isOpen={showImportWizard}
        onClose={() => setShowImportWizard(false)}
        onConfirm={async (parsed: ParsedOrder[]) => {
          try {
            const resp = await saveParsedOrders(parsed);
            const merged = mergeSavedOrders(orders, resp.orders);
            // Use setOrders without `modified` so the cloud-sync loop treats this as a bulk replace.
            setOrders(merged);
            bdsToast.success(
              `已入库：新增 ${resp.created} 张，更新 ${resp.updated} 张。` +
              `\n订单列表已刷新。`,
            );
            setShowImportWizard(false);
          } catch (e: any) {
            console.error('[ImportWizard] save failed:', e);
            bdsToast.danger(`入库失败：${e?.message ?? e}\n订单未保存，请稍后重试。`);
          }
        }}
        isDarkMode={isDarkMode}
      />

      {/* 单行筛选 bar（点名② 双行→单行重构）：搜索 + 类型 segment + 状态 + 视图 toggle 共行；
          搜索/状态/视图桌面端渲染（移动端沿用 segment 横滚，原独立 tab 行并入本 bar）。
          三区同槽：bar 与 PageHeader（--p-pagehead）/ 表格区共享 px-7（28px）页面内容栅格，
          左右边界严格对齐；pb-4 呼吸间距与下方内容面板分层（基准范式同 QuotationManager mb-4） */}
      {!desktopFullscreenOpen && (
        <div className="shrink-0 px-7 pt-2 pb-4 pointer-events-auto">
          {navRelationFilter && (
            <div className="mb-2">
              <NavRelationFilterChip filter={navRelationFilter} label="订单" onClear={() => setNavRelationFilter(null)} />
            </div>
          )}
          <div className="bds-filterbar flex-wrap gap-y-2">
            <div className="relative hidden md:block min-w-40 flex-[1_1_180px] max-w-60">
              <Search size={14} strokeWidth={1.5} className={`absolute left-3 top-1/2 -translate-y-1/2 ${TXT_FAINT}`} />
              <input
                type="text"
                value={orderSearchTerm}
                onChange={e => setOrderSearchTerm(e.target.value)}
                placeholder="搜索订单号/客户/品号..."
                className="bds-input pl-9"
              />
            </div>
            <div className="min-w-0 flex-[1_1_auto] overflow-x-auto no-scrollbar">
              <div className="bds-segment w-fit">
                {renderOrderTypeSwitcher()}
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 ml-auto">
              {/* 状态筛选：原生 select 元素（OS 原生浮层）→ CustomSelect surface="field"（W4 原生浮层收编），
                  触发器几何为 40px pill recessed。
                  menuPortal：全站 CustomSelect 唯一漏配处——非 portal 时菜单 absolute 悬浮于
                  .bds-filterbar（backdrop-filter 创建 stacking context）内，z-50 被表格区 z-10
                  压制，展开后被下方列表盖住。与 Products/Relations/compiled 模板同收编到 body 浮层。 */}
              <div className="relative shrink-0 w-28">
                <CustomSelect
                  surface="field"
                  menuPortal
                  options={ORDER_STATUS_FILTER_OPTIONS}
                  value={orderFilterStatus}
                  onChange={setOrderFilterStatus}
                />
              </div>
              <div className={`h-5 w-px shrink-0 ${DIVIDER_CLASS}`} />
              <div className="flex items-center gap-1">
                {allowGlobeView && (
                  <button
                    type="button"
                    title="地球视图"
                    onClick={() => onViewModeChange('globe')}
                    className={`bds-toggle${effectiveViewMode === 'globe' ? ' active' : ''}`}
                  >
                    <Globe size={14} strokeWidth={1.5} />
                  </button>
                )}
                <button
                  type="button"
                  title="列表视图"
                  onClick={() => onViewModeChange('list')}
                  className={`bds-toggle${effectiveViewMode === 'list' ? ' active' : ''}`}
                >
                  <List size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`flex-1 overflow-hidden relative ${desktopFullscreenOpen ? 'hidden' : ''}`}>
        {effectiveViewMode === 'globe' ? (
          <div className="w-full h-full relative duration-300">
            {/*
               GLOBAL GLOBE INTEGRATION:
               ProductionGlobe is now rendered at the App level (underlying layer).
               Here we just render an empty transparent frame to let it show through.
               Visual filters still float on top.
            */}
            <div className="w-full h-full bg-transparent"></div>
          </div>
        ) : (
          <div className="h-full flex flex-col pointer-events-auto">
            <div className="flex-1 min-h-0 overflow-visible">
                <>
                {/* 预警横幅同槽 px-7：原全宽出血，与表格左右边界错位（同属 bar 超槽家族） */}
                <div className="shrink-0 px-7">
                  <ProductionAlerts isDarkMode={isDarkMode} onSelectOrder={(oid) => {
                    const item = lineItems.find(li => li.order?.id === oid);
                    if (item) handleLineClick(item);
                  }} />
                </div>
                <div className="w-full h-full flex flex-col min-h-0 overflow-visible bg-transparent">
                <div className="flex-1 min-h-0 flex px-7 pt-0 bambook-main-panel-bottom-inset gap-4 overflow-visible">
                <CompiledTableShell
                  isDarkMode={isDarkMode}
                  scrollRef={orderListScrollRef}
                  useSidePanelContainer
                  shellBaseClassName="h-full min-h-0 overflow-visible"
                  panelClassName="flex h-full w-full flex-col overflow-hidden"
                  panelContentClassName="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden"
                  scrollClassName="overflow-x-auto overscroll-contain"
                  edgeFade={{ topHeight: 22, topFadeStartOffset: 0, bottomHeight: 42 }}
                  header={(
                    <table className={`w-full shrink-0 table-fixed border-separate border-spacing-0 text-left text-xs ${ORDER_TABLE_WIDTH_CLASS}`}>
                      <colgroup>
                        {ORDER_TABLE_COLUMN_WIDTH_CLASSES.map((widthClass, index) => (
                          <col key={index} className={widthClass} />
                        ))}
                      </colgroup>
                      <thead className={TXT_MUTED}>
                        <tr>
                          {ORDER_TABLE_HEADERS.map((header) => (
                            <th key={header.label} className={`px-3 py-3 text-[10px] font-light tracking-[0.16em] whitespace-nowrap border-b ${BORDER_SUBTLE_CLASS} ${header.align ?? ''}`}>
                              {header.sortKey ? (
                                <button
                                  type="button"
                                  onClick={() => handleSortToggle(header.sortKey!)}
                                  title={`按${header.sortLabel ?? header.label}排序`}
                                  aria-label={`按${header.sortLabel ?? header.label}排序`}
                                  className={`inline-flex items-center gap-1 uppercase tracking-[0.16em] transition-colors hover:text-[var(--text-primary)] ${header.align === 'text-right' ? 'w-full flex-row-reverse' : ''} ${orderSort?.key === header.sortKey ? 'text-[var(--text-primary)]' : ''}`}
                                >
                                  {header.label}
                                  {orderSort?.key === header.sortKey ? (
                                    orderSort.dir === 'asc'
                                      ? <ArrowUp size={14} strokeWidth={1.5} />
                                      : <ArrowDown size={14} strokeWidth={1.5} />
                                  ) : (
                                    <ArrowUpDown size={14} strokeWidth={1.5} className="opacity-40" />
                                  )}
                                </button>
                              ) : (
                                header.label
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    </table>
                  )}
                >
                  <div className={`${ORDER_TABLE_WIDTH_CLASS} flex min-h-0 flex-1 flex-col text-left text-xs`}>
                    {lineItems.length === 0 ? (
                      <div className="bds-empty" style={{ minHeight: 360 }}>
                        <div className="glyph"><Package size={24} strokeWidth={1.25} /></div>
                        {capsuleActive ? (
                          <>
                            <div className="title">暂无 Capsule 订单</div>
                            <div className="desc" style={{ maxWidth: 320 }}>在成衣订单详情中将业务线标记为 Capsule 后，订单将在此子视图集中呈现</div>
                          </>
                        ) : (
                          <>
                            <div className="title">暂无订单数据</div>
                            <div className="desc" style={{ maxWidth: 320 }}>
                              {orderType === 'all' && '当前没有任何订单，点击右上角「+」按钮创建新订单'}
                              {orderType === 'fabric' && '当前没有面料订单，点击右上角「+」按钮创建面料订单'}
                              {orderType === 'garment' && '当前没有成衣订单，点击右上角「+」按钮创建成衣订单'}
                              {orderType === 'other' && '当前没有其他类型订单（辅料/纱线等），点击右上角「+」按钮创建'}
                            </div>
                          </>
                        )}
                      </div>
                    ) : lineItems.map((item, idx) => {
                      const clientCode = item.materialCode || item.order.clientCode || '-';
                      const colorCode = item.millQuality || item.order.productColorCode || '-';
                      const description = item.description || item.cloth || item.order.product || '-';
                      const exMill = formatYmd(item.exMillDate || item.order.clientDate || item.order.dueDate) || '-';
                      const amountLabel = `${item.salesCurrency || '$'} ${(item.amount ?? 0).toLocaleString()}`;
                      const cellClass = 'relative z-10 min-w-0 px-4 py-4';
                      const isSelected = selectedLineItem?.id === item.id;
                      return (
                        <CompiledMotionInteractiveCard
                          as="div"
                          role="button"
                          tabIndex={0}
                          key={item.id}
                          data-glass-edge-mask
                          onClick={() => handleLineClick(item)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            handleLineClick(item);
                          }}
                          spotlightColor="rgb(var(--os-vnext-brand-blue-rgb) / 0.05)"
                          spotlightSize={420}
                          idleSpotlightOpacity={0}
                          liquidSpotlight
                          liquidSpotlightTone="light"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          whileHover={{ y: -1, transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] } }}
                          transition={{ delay: idx * 0.02 }}
                          className={`group relative grid w-full cursor-pointer ${ORDER_TABLE_ROW_CLASS} ${ORDER_TABLE_GRID_CLASS} overflow-hidden text-xs transition-[background,color,box-shadow,border-color,transform] duration-200 ${isSelected ? 'bg-[var(--accent-tint)]' : `hover:bg-[var(--hover-darken)] ${TXT_SECONDARY}`}`}
                        >
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-px bg-[var(--border-c-subtle)]" aria-hidden="true" />
                          <div className={cellClass}>
                            <div className="flex items-center gap-1.5">
                              <p className={`${listRowPrimaryCls} min-w-0`}>{item.displayId}</p>
                              <span className="bds-badge sm" style={ORDER_TYPE_BADGE_STYLE[item.order.type]}>
                                {DB_TYPE_ZH[item.order.type] || item.order.type}
                              </span>
                              {item.order.businessLine === 'capsule' && (
                                <span className="bds-badge sm neutral">Capsule</span>
                              )}
                              <CapsuleExemptionBadge order={item.order} />
                            </div>
                            <p className={listRowSecondaryCls}>{item.customer || '-'}</p>
                          </div>
                          <div className={cellClass}>
                            <p className={listRowRegularCls}>{clientCode}</p>
                            <p className={listRowSecondaryCls}>行号 {item.displayItemNo}</p>
                          </div>
                          <div className={cellClass}>
                            <p className={listRowRegularCls}>{description}</p>
                            <p className={listRowSecondaryCls}>色号 {colorCode}</p>
                          </div>
                          <div className={`${cellClass} text-right`}>
                            <p className={listRowPrimaryCls}>{(item.quantity ?? 0).toLocaleString()}</p>
                            <p className={listRowSecondaryCls}>{amountLabel}</p>
                          </div>
                          <div className={cellClass}>
                            <p className={listRowRegularCls}>{exMill}</p>
                            <p className={listRowSecondaryCls}>订单 {formatYmd(item.poDate) || '-'}</p>
                          </div>
                          <div className={cellClass}>
                            <span className={`bds-badge sm max-w-full ${STATUS_BADGE_VARIANT[item.status] ?? 'neutral'}`}>
                              <span className="truncate">{ORDER_STATUS_LABELS[item.status] ?? item.status}</span>
                            </span>
                            <p className={listRowActionHintCls}>
                              查看详情 <ArrowRight size={14} strokeWidth={1.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                            </p>
                          </div>
                        </CompiledMotionInteractiveCard>
                      );
                    })}
                    {/* R3：分页页脚——快照首页 500 截断时可见「加载更多」；total 已知时恒显口径 */}
                    {(hasMoreOrders || ordersTotalLocal != null) && (
                      <div className={`flex shrink-0 items-center justify-center gap-3 border-t px-4 py-3 ${BORDER_SUBTLE_CLASS}`}>
                        {ordersTotalLocal != null && (
                          <span className={`text-xs font-light ${TXT_MUTED}`}>已加载 {orders.length} / 共 {ordersTotalLocal} 条</span>
                        )}
                        {hasMoreOrders && (
                          <button
                            type="button"
                            onClick={() => void handleLoadMoreOrders()}
                            disabled={loadingMoreOrders}
                            className="bds-btn bds-btn-secondary"
                          >
                            {loadingMoreOrders ? '加载中…' : '加载更多'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </CompiledTableShell>
                </div>
                </div>
                </>
            </div>
          </div>
        )}
      </div>

      {selectedOrder && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 z-[60] flex flex-col pointer-events-auto bg-transparent"
          onClick={() => onSelectOrder(null)}
        >
          {/* Full-screen container. Edge fade is applied to the real scroll
              layer through per-glass-surface edge masks, not a masked scroll parent. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full h-full overflow-hidden"
          >
            {/* Header — close button + primary action grouped top-right */}
            <div className="absolute inset-x-0 top-0 z-[60] px-7 pt-5 pb-3 flex items-center justify-between pointer-events-none">
              {/* 渐变遮挡层：防止滚动内容穿透标题区（backdrop-blur + mask 渐隐，衔接滚动容器 96px 顶部让位；BDS 画布 token 驱动渐变） */}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-24 pointer-events-none backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_0%,black_72%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_72%,transparent_100%)]"
                style={OVERLAY_TOP_MASK_STYLE}
              />
              <div className="relative min-w-0">
                <p className={KICKER_CLASS}>Production Detail</p>
                <div className="mt-1.5 flex min-w-0 items-center gap-3">
                  {/* Hero 订单号：页面主角，编辑级大标题排版 */}
                  <h2 className={`truncate text-[28px] leading-none font-light tracking-[0.03em] ${TXT_TITLE}`}>{selectedLineItem?.displayId || selectedOrder.poNumber || selectedOrder.id}</h2>
                  <span className={`bds-badge shrink-0 uppercase ${STATUS_BADGE_VARIANT[selectedOrder.status ?? 'Pending'] ?? 'neutral'}`}>{ORDER_STATUS_LABELS[selectedOrder.status ?? 'Pending']}</span>
                  <span className={HEADER_META_CLASS}>{isEditing ? '编辑模式' : '查阅模式'}</span>
                </div>
                {/* Hero meta 行：PO 日期 / 季节 / 客户 / 业务线 — 降级元信息，增强档案感 */}
                {(selectedOrder.poDate || selectedOrder.season || selectedOrder.customer) && (
                  <div className={`mt-2 flex min-w-0 items-center gap-3 ${HEADER_META_CLASS}`}>
                    {selectedOrder.poDate && <span className="shrink-0">PO 日期 {formatYmd(selectedOrder.poDate) || '—'}</span>}
                    {selectedOrder.season && <span className="shrink-0">季节 {selectedOrder.season}</span>}
                    {selectedOrder.customer && <span className="truncate">{selectedOrder.customer}</span>}
                    {selectedOrder.businessLine === 'capsule' && <span className="bds-badge sm neutral shrink-0">Capsule</span>}
                    <CapsuleExemptionBadge order={selectedOrder} />
                  </div>
                )}
              </div>
              <div className="pointer-events-auto relative flex items-center gap-2">
                {/* P2-004：显式「返回列表」入口（原裸 X 图标按钮可发现性差，验收判为无返回入口） */}
                <button
                  onClick={() => { void requestCloseDetail(); }}
                  className="bds-btn bds-btn-ghost"
                >
                  <ArrowLeft size={14} strokeWidth={1.5} />返回列表
                </button>
                <div className={`h-4 w-px ${DIVIDER_CLASS}`}></div>
                {isEditing ? (
                  <button onClick={handleSaveEdit} disabled={isSavingEdit} className="bds-btn bds-btn-primary">
                    <Save size={14} strokeWidth={1.5} />{isSavingEdit ? '保存中…' : '保存修改'}
                  </button>
                ) : canWriteOrders ? (
                  <button onClick={() => {
                    const orderDraft = selectedOrder ? { ...selectedOrder } : null;
                    const lineDraft = selectedLineItem ? { ...selectedLineItem } : (selectedOrder?.lines?.[0] ? { ...selectedOrder.lines[0] } as Partial<OrderLineItem> : null);
                    // R678-②：进入编辑打快照，供关闭时脏检测（hasUnsavedEdits）
                    editSnapshotRef.current = { order: JSON.stringify(orderDraft ?? null), line: JSON.stringify(lineDraft ?? null) };
                    setIsEditing(true);
                    setEditForm(orderDraft);
                    setEditLineForm(lineDraft);
                  }} className="bds-btn bds-btn-secondary">
                    <Edit2 size={14} strokeWidth={1.5} />编辑项目
                  </button>
                ) : null}
                <button
                  onClick={() => { void requestCloseDetail(); }}
                  className="bds-btn bds-btn-ghost bds-btn-icon"
                  title="关闭详情"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* Scrollable Content Container */}
            <div className="absolute inset-0 z-10 overflow-hidden">
              <div ref={orderDetailScrollRef} className="h-full overflow-y-auto">
                {/* 资料完备度横幅：详情头部（标题层之下、内容之上），数据就绪后渲染；
                    有横幅时内容区顶部让位收窄（pt-24 由横幅容器承接） */}
                {orderCompleteness && (
                  <div className="px-7 pt-24">
                    <CompletenessBanner data={orderCompleteness} onNavigate={onNavigate} />
                  </div>
                )}
                <div className={`grid w-full grid-cols-[240px_minmax(0,1fr)] gap-5 px-7 ${orderCompleteness ? 'pt-5' : 'pt-24'} pb-5`}>
                  {/* Detail Map：sticky 锚定（滚动时固定于标题层之下），超高时内部滚动 */}
                  <aside className="sticky top-24 z-10 max-h-[calc(100vh-8rem)] self-start overflow-y-auto">
                    <CompiledSurfacePanel materialRole="raisedCard" spotlight isDarkMode={isDarkMode} className={OVERLAY_MAP_PANEL_CLASS}>
                      <p className={`px-3 pb-3 ${KICKER_CLASS}`}>Detail Map</p>
                      <div className="space-y-1">
                        {[
                          { id: 'order-detail-summary', label: '概览', desc: '数量、金额、交期' },
                          { id: 'order-detail-timeline', label: '生产进度', desc: '状态变更时间线' },
                          { id: 'order-detail-related', label: '关联视图', desc: '跨模块实体链接' },
                          { id: 'order-detail-context', label: '全链路', desc: '报价→财务生命周期' },
                          { id: 'order-detail-audit', label: '变更历史', desc: '实体审计记录' },
                          { id: 'order-detail-changes', label: '变更申请', desc: 'DR-010 变更审批链' },
                          { id: 'order-detail-pipeline', label: '生产管线', desc: '10 阶段门禁' },
                          ...(selectedLineItem ? [{ id: 'order-detail-line', label: `${DB_TYPE_ZH[selectedOrder.type] || '订单'}项目`, desc: selectedLineItem.displayId || selectedLineItem.itemNo || 'Order item' }] : []),
                          ...(!selectedLineItem && selectedOrder.lines && selectedOrder.lines.length > 0 ? [{ id: 'order-detail-lines', label: '行明细', desc: `${selectedOrder.lines.length} 行订单项目` }] : []),
                          ...detailSections.map(({ cluster }) => ({ id: `section-${cluster.id}`, label: cluster.labelZh, desc: cluster.labelEn })),
                        ].map((section, idx) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                            className={OVERLAY_MAP_BUTTON_CLASS}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-light ${OVERLAY_MAP_INDEX_CLASS}`}>{idx + 1}</span>
                              <div className="min-w-0">
                                <div className={`truncate text-xs font-light ${TXT_TITLE}`}>{section.label}</div>
                                <div className={`mt-0.5 truncate text-[10px] font-light ${TXT_MUTED}`}>{section.desc}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </CompiledSurfacePanel>
                  </aside>
                  <div className="min-w-0 space-y-6 bambook-panel-shadow-viewport">
                    {/* Top summary: keep the high-efficiency detail reading surface */}
                    <CompiledSurfacePanel
                      id="order-detail-summary"
                      isDarkMode={isDarkMode}
                      materialRole="raisedCard"
                      edgeFadeItem
                      spotlight
                      className={OVERLAY_FORM_PANEL_CLASS}
                      contentClassName="relative z-10"
                      spotlightSizing="width"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-4">
                        {[
                          { label: '项目数量', num: (selectedLineItem?.quantity ?? selectedOrder.quantity ?? 0).toLocaleString(), affix: selectedLineItem?.unit || (selectedOrder.type === 'Fabric' ? 'M' : 'Pcs'), affixPos: 'suffix' as const, sub: 'Item Quantity', compact: false },
                          { label: '项目金额', num: ((selectedLineItem?.amount ?? selectedOrder.contractAmount ?? selectedOrder.quoteAmount ?? 0)).toLocaleString(), affix: selectedOrder.salesCurrency || 'USD', affixPos: 'prefix' as const, sub: 'Line Amount', compact: false },
                          { label: '出厂交期', num: formatYmd(selectedLineItem?.exMillDate || selectedOrder.clientDate || selectedOrder.dueDate) || '—', sub: 'Exmill Date', compact: false },
                          { label: '客户', num: selectedOrder.customer || '—', sub: 'Customer', compact: true },
                        ].map((stat, i) => (
                          <div key={stat.label} className={`px-6 py-3 min-w-0 ${i < 3 ? `md:border-r ${BORDER_SUBTLE_CLASS}` : ''}`}>
                            <p className={`text-[10px] font-light uppercase tracking-[0.22em] ${TXT_FAINT}`}>{stat.sub}</p>
                            {/* 数据带主角：大号超轻数字 + 小号单位/币种缀，编辑级数据排版 */}
                            <p className={`mt-2.5 flex items-baseline min-w-0 leading-none tracking-tight ${stat.compact ? `text-base font-light` : 'text-[26px] font-extralight tabular-nums'} ${TXT_TITLE}`}>
                              {stat.affix && stat.affixPos === 'prefix' && <span className={`mr-1.5 shrink-0 text-xs font-light tracking-wide ${TXT_MUTED}`}>{stat.affix}</span>}
                              <span className="truncate">{stat.num}</span>
                              {stat.affix && stat.affixPos === 'suffix' && <span className={`ml-1.5 shrink-0 text-xs font-light tracking-wide ${TXT_MUTED}`}>{stat.affix}</span>}
                            </p>
                            <p className={`mt-2.5 text-xs font-light ${TXT_MUTED}`}>{stat.label}</p>
                          </div>
                        ))}
                      </div>
                      {/* Capsule 子视图：成衣订单业务线标记（大货 ⇄ Capsule），编辑模式下隐藏防误触 */}
                      {selectedOrder.type === 'Garment' && !isEditing && (
                        <div className={`mt-2 flex flex-wrap items-center justify-between gap-3 border-t px-4 pt-3 ${BORDER_SUBTLE_CLASS}`}>
                          <div className="min-w-0">
                            <p className={`text-[10px] font-light uppercase tracking-[0.22em] ${TXT_FAINT}`}>Business Line</p>
                            <p className={`mt-0.5 text-xs font-light ${TXT_MUTED}`}>业务线（Capsule = 设计师小单业务）</p>
                          </div>
                          <div className="bds-segment">
                            {([
                              { code: 'garment' as const, label: '成衣大货' },
                              { code: 'capsule' as const, label: 'Capsule' },
                            ]).map(opt => {
                              const active = (selectedOrder.businessLine === 'capsule' ? 'capsule' : 'garment') === opt.code;
                              return (
                                <button
                                  key={opt.code}
                                  type="button"
                                  disabled={businessLineSaving}
                                  onClick={() => handleSetBusinessLine(opt.code)}
                                  title={active ? undefined : `标记为${opt.label}`}
                                  className={`seg whitespace-nowrap ${active ? 'active' : ''} ${businessLineSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* MOQ 快照（writeOnce 只读）：三档阈值 + 快照时间 + 来源，不随配置变更追溯 */}
                      <OrderMoqSnapshotBlock order={selectedOrder} isDarkMode={isDarkMode} />
                    </CompiledSurfacePanel>

                    {/* 阶段 IA-3：履约动作区 —— 订单下游一键触发（采购/验货/出运），prime 目标模块创建表单 */}
                    {onNavigate && !isEditing && (
                      <CompiledSurfacePanel
                        isDarkMode={isDarkMode}
                        as="section"
                        materialRole="raisedCard"
                        edgeFadeItem
                        spotlight
                        className={OVERLAY_FORM_PANEL_CLASS}
                        contentClassName="relative z-10"
                        spotlightSizing="width"
                      >
                        <OrderSectionHeader
                          iconKey="fulfillment"
                          kicker="Fulfillment Actions"
                          title="履约动作"
                          isDarkMode={isDarkMode}
                          wrapClassName="flex flex-wrap items-end justify-between gap-3"
                          meta={(
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" onClick={handlePrimeProcurement} className="bds-btn bds-btn-secondary" title="跳转到采购管理并预填本订单明细">
                                <ShoppingCart size={14} strokeWidth={1.5} />生成采购单
                              </button>
                              <button type="button" onClick={handlePrimeQc} className="bds-btn bds-btn-secondary" title="跳转到 QC 工作台并预选本订单">
                                <ClipboardCheck size={14} strokeWidth={1.5} />发起验货
                              </button>
                              <button type="button" onClick={handlePrimeShipment} className="bds-btn bds-btn-secondary" title="跳转到出运管理并预填本订单">
                                <Ship size={14} strokeWidth={1.5} />创建出运
                              </button>
                            </div>
                          )}
                        />
                      </CompiledSurfacePanel>
                    )}

                    {/* Production Timeline Card */}
                    <CompiledSurfacePanel
                      id="order-detail-timeline"
                      isDarkMode={isDarkMode}
                      as="section"
                      materialRole="raisedCard"
                      edgeFadeItem
                      spotlight
                      className={OVERLAY_FORM_PANEL_CLASS}
                      contentClassName="relative z-10"
                      spotlightSizing="width"
                    >
                      <OrderSectionHeader
                        iconKey="timeline"
                        kicker="Production Timeline"
                        title="生产进度时间线"
                        isDarkMode={isDarkMode}
                      />

                      {/* 阶段 IA-3：履约状态步骤条（6 态机镜像；点击合法下一态复用 handleStatusTransition，后端契约校验，不引入第二状态源） */}
                      {(() => {
                        const currentStatus = selectedOrder.status || 'Pending';
                        const isAlert = currentStatus === 'Alert';
                        const currentIdx = isAlert ? -1 : ORDER_FLOW_STEPS.indexOf(currentStatus as typeof ORDER_FLOW_STEPS[number]);
                        const allowed = ORDER_ALLOWED_TRANSITIONS[currentStatus] ?? [];
                        return (
                          <div className="mb-4 flex flex-wrap items-center gap-1">
                            {ORDER_FLOW_STEPS.map((step, idx) => {
                              const isDone = !isAlert && idx < currentIdx;
                              const isCurrent = step === currentStatus;
                              const isActionable = !isEditing && !statusTransitioning && allowed.includes(step);
                              return (
                                <React.Fragment key={step}>
                                  {idx > 0 && (
                                    <span className={`h-px w-4 shrink-0 ${isDone ? '' : STEP_CONNECTOR_PENDING_CLASS}`} style={isDone ? STEP_CONNECTOR_DONE_STYLE : undefined} />
                                  )}
                                  <button
                                    type="button"
                                    disabled={!isActionable}
                                    onClick={() => handleStatusTransition(step)}
                                    title={isActionable ? `推进到「${ORDER_STATUS_LABELS[step]}」` : ORDER_STATUS_LABELS[step]}
                                    className={isCurrent ? STEP_BTN_CURRENT : isDone ? STEP_BTN_DONE : isActionable ? STEP_BTN_ACTIONABLE : STEP_BTN_DISABLED}
                                  >
                                    {isDone && <CheckCircle2 size={14} strokeWidth={2} className="text-[var(--accent)]" />}
                                    {ORDER_STATUS_LABELS[step]}
                                  </button>
                                </React.Fragment>
                              );
                            })}
                            {/* Alert 异常态：非终态可标记异常；异常中可恢复到任一非终态（点击上方步骤） */}
                            <span className={`h-px w-4 shrink-0 ${STEP_CONNECTOR_PENDING_CLASS}`} />
                            <button
                              type="button"
                              disabled={!canWriteOrders || isEditing || statusTransitioning || (!isAlert && !allowed.includes('Alert'))}
                              onClick={() => !isAlert && handleStatusTransition('Alert')}
                              title={isAlert ? '异常中：点击左侧步骤恢复到对应阶段' : '标记为异常'}
                              className={`${isAlert ? 'bds-btn !min-w-24' : 'bds-btn bds-btn-outline !min-w-24'} ${isEditing ? 'cursor-not-allowed opacity-40' : ''}`}
                              style={isAlert ? STEP_BTN_ALERT_STYLE : undefined}
                            >
                              <AlertTriangle size={14} strokeWidth={1.5} />
                              {ORDER_STATUS_LABELS.Alert}
                            </button>
                          </div>
                        );
                      })()}

                      {timelineError ? (
                        <div className="bds-alert danger">
                          <AlertCircle size={14} />
                          <span className="text-xs font-light">{timelineError}——请返回列表重进或稍后重试。</span>
                        </div>
                      ) : statusTimeline.length === 0 ? (
                        <p className={`text-xs font-light ${TXT_MUTED}`}>暂无状态变更记录</p>
                      ) : (
                        <div className="space-y-3">
                          {statusTimeline.map((t, idx) => {
                            const dateStr = formatYmd(t.createdAt);
                            // 列表按时间升序，末位即最新事件：accent 点亮作为事件流视觉落点
                            const isLatest = idx === statusTimeline.length - 1;
                            return (
                              <div key={t.id} className="flex items-start gap-3">
                                <div className="flex flex-col items-center">
                                  <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                                    isLatest ? TIMELINE_DOT_ACTIVE_CLASS : TIMELINE_DOT_CLASS
                                  }`} />
                                  {idx < statusTimeline.length - 1 && (
                                    <div className={`w-px h-4 ${TIMELINE_CONNECTOR_CLASS}`} />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs ${isLatest ? 'font-normal' : 'font-light'} ${TXT_TITLE}`}>
                                      {ORDER_STATUS_LABELS[t.fromStatus] ?? t.fromStatus} → {ORDER_STATUS_LABELS[t.toStatus] ?? t.toStatus}
                                    </span>
                                    {isLatest && (
                                      <span className={TIMELINE_LATEST_BADGE_CLASS}>最新</span>
                                    )}
                                    <span className={`text-[10px] ${TXT_MUTED}`}>{dateStr}</span>
                                  </div>
                                  {t.note && <div className={`text-[10px] mt-0.5 ${TXT_MUTED}`}>{t.note}</div>}
                                  {t.operator && <div className={`text-[10px] mt-0.5 ${TXT_MUTED}`}>by {t.operator}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* 异常提示（BDS alert 族 danger 语义）：E5 显示真实异常原因——
                          取状态时间线最近一次「→ Alert」流转的 note 留痕；无留痕时给兜底说明，不写死原因 */}
                      {selectedOrder.status === 'Alert' && (() => {
                        const alertReason = resolveOrderAlertReason(statusTimeline);
                        return (
                          <div className="bds-alert danger mt-4">
                            <AlertCircle size={14} />
                            <span className="text-xs font-light">
                              {alertReason
                                ? `异常原因：${alertReason}`
                                : '订单处于异常状态（标记时未填写原因，可在状态推进时补充说明）'}
                            </span>
                          </div>
                        );
                      })()}
                    </CompiledSurfacePanel>

                    {/* 关联业务（产品化 Links）— 该客户的订单/开发/报价/出运等入口 */}
                    {selectedOrder.customerRelationId && (
                    <div id="order-detail-related" className="pt-4">
                      <RelatedWorkspacesSection
                        sourceType="relation"
                        relationId={selectedOrder.customerRelationId}
                        relationRole="customer"
                        onNavigate={onNavigate}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                    )}

                    {/* 阶段 D / D3：订单全链路（报价→开发→BOM→采购→生产→外协→出运→财务） */}
                    <div id="order-detail-context">
                      <OrderContextSection
                        orderId={selectedOrder.id}
                        isDarkMode={isDarkMode}
                        onNavigate={onNavigate}
                      />
                    </div>

                    {/* 阶段 D / D6：订单变更历史（实体审计，模块读权限门禁） */}
                    <div id="order-detail-audit">
                      <AuditHistorySection
                        targetType="Order"
                        targetId={selectedOrder.id}
                        isDarkMode={isDarkMode}
                        title="订单变更历史"
                      />
                    </div>

                    {/* DR-010：订单变更申请审批链（数量/金额/交期/客户/产品/取消/暂停；含 MOQ 预检与编辑门禁引导） */}
                    <div id="order-detail-changes">
                      <OrderChangeRequestsSection
                        order={selectedOrder}
                        isDarkMode={isDarkMode}
                        gatePrefill={changeGatePrefill}
                        onGatePrefillConsumed={() => setChangeGatePrefill(null)}
                        relations={relations}
                        onOrderUpdated={() => { void refreshSelectedOrderFromServer(); }}
                      />
                    </div>

                    {/* REQ2-01 大货缸差记录（面料订单：染厂分缸生产的缸号级色差证据链，投诉取证 3min SLA） */}
                    {selectedOrder.type === 'Fabric' && (
                      <div id="order-detail-color-batches" className="mb-6">
                        <SampleColorBatchPanel
                          key={`bulk-${selectedOrder.id}`}
                          stage="bulk"
                          orderId={selectedOrder.id}
                          orderLabel={selectedOrder.poNumber}
                          isDarkMode={isDarkMode}
                        />
                      </div>
                    )}

                    {/* REQ2-05 面料工序级委外链（坯布→染整→后整理→涂层：投入产出/累计损耗/加工费核算，DR-047） */}
                    {selectedOrder.type === 'Fabric' && (
                      <div id="order-detail-process-chain" className="mb-6">
                        <OrderProcessChainPanel
                          key={`opc-${selectedOrder.id}`}
                          orderId={selectedOrder.id}
                          isDarkMode={isDarkMode}
                          relations={relations}
                        />
                      </div>
                    )}

                    {/* REQ2-06 GRS TC 交易证书链（原料→工厂→我方三段 + 出货前一键校验，DR-048；面料/其他类 GRS 订单） */}
                    {(selectedOrder.type === 'Fabric' || selectedOrder.type === 'Other') && (
                      <div id="order-detail-tc-chain" className="mb-6">
                        <TcChainPanel
                          key={`tc-${selectedOrder.id}`}
                          orderId={selectedOrder.id}
                          isDarkMode={isDarkMode}
                          relations={relations}
                        />
                      </div>
                    )}

                    {/* REQ2-18 Tech Pack 结构化解析（成衣线：规格书上传 → 六类字段解析 → 勾选回填订单，DR-059） */}
                    {selectedOrder.type === 'Garment' && (
                      <div id="order-detail-techpack" className="mb-6">
                        <TechPackPanel
                          key={`tp-${selectedOrder.id}`}
                          orderId={selectedOrder.id}
                          isDarkMode={isDarkMode}
                          order={{
                            product: selectedOrder.product,
                            quantity: selectedOrder.quantity,
                            dueDate: selectedOrder.dueDate,
                            fabricContent: (selectedOrder as any).fabricContent ?? null,
                            productColorCode: (selectedOrder as any).productColorCode ?? null,
                          }}
                        />
                      </div>
                    )}

                    {/* REQ2-04 第三方测试委托（全订单类型：SGS/ITS/BV 送样检测 → 报告归档 → 失败项整改闭环，3 击查看） */}
                    <div id="order-detail-test-requests" className="mb-6">
                      <TestRequestPanel
                        key={`tr-${selectedOrder.id}`}
                        orderId={selectedOrder.id}
                        isDarkMode={isDarkMode}
                      />
                    </div>

                    {/* P0-1 分批出运与尾款结算（全订单类型：批次计划登记 → 排船回填 → 发运确认 → 尾款门禁与结算聚合） */}
                    <div id="order-detail-batches" className="mb-6">
                      <OrderShipmentBatchPanel
                        key={`osb-${selectedOrder.id}`}
                        orderId={selectedOrder.id}
                        isDarkMode={isDarkMode}
                      />
                    </div>

                    {/* 生产管线 (10阶段门禁引擎) */}
                    <div id="order-detail-pipeline">
                      <ProductionPipeline orderId={selectedOrder.id} isDarkMode={isDarkMode} />
                    </div>

                    {selectedLineItem && (
                      <CompiledSurfacePanel
                        id="order-detail-line"
                        isDarkMode={isDarkMode}
                        as="section"
                        materialRole="raisedCard"
                        edgeFadeItem
                        spotlight
                        className={OVERLAY_FORM_PANEL_CLASS}
                        contentClassName="relative z-10"
                        spotlightSizing="width"
                      >
                        <OrderSectionHeader
                          iconKey="lineItem"
                          kicker={selectedOrder.type === 'Garment' ? 'Garment Item' : selectedOrder.type === 'Other' ? 'Item Detail' : 'Fabric Item'}
                          title={`${DB_TYPE_ZH[selectedOrder.type] || '订单'}项目详情`}
                          isDarkMode={isDarkMode}
                          meta={(
                            <span className={`bds-badge shrink-0 uppercase ${STATUS_BADGE_VARIANT[((isEditing && editLineForm ? editLineForm.status : selectedLineItem.status) || 'Pending') as string] ?? 'neutral'}`}>{ORDER_STATUS_LABELS[(isEditing && editLineForm ? editLineForm.status : selectedLineItem.status) || 'Pending'] ?? ((isEditing && editLineForm ? editLineForm.status : selectedLineItem.status) || 'Pending')}</span>
                          )}
                        />
                        {/* 查阅态网格与 spec.gridRead 同 gap（gap-x-10/gap-y-7），值排版走 spec 档案态配方（与 OrderFieldInput 同构） */}
                        <div className={`grid grid-cols-1 md:grid-cols-4 ${isEditing ? 'gap-3' : 'gap-x-10 gap-y-7'}`}>
                          {[
                            ['PO Item', 'itemNo'],
                            ['客供品号', 'materialCode'],
                            ['工厂品色号', 'millQuality'],
                            ['描述/颜色', 'description'],
                            ['成分', 'cloth'],
                            ['门幅', 'width'],
                            ['克重', 'weight'],
                            ['出厂日期', 'exMillDate'],
                            ['到港日期', 'deliveryDate'],
                            ['数量', 'quantity'],
                            ['单价', 'unitPrice'],
                            ['小计', 'netValue'],
                            ['溢短装条款', 'tolerancePercent'],
                            ['状态', 'status'],
                            ['实际发货日', 'shippingDate'],
                            ['发票号', 'invoiceNumber'],
                            ['收款日', 'actualPaymentDate'],
                          ].map(([label, key]) => {
            const raw = (isEditing && editLineForm ? (editLineForm as any)[key] : (selectedLineItem as any)[key]) ?? '';
            // REQ2-03：溢短装条款查阅态归一为 ±N%（Prisma Decimal 经 JSON 序列化为 "5.00"，统一 Number 化展示）
            const isTolerance = key === 'tolerancePercent';
            const toleranceDisplay = raw === '' || raw === null || raw === undefined
              ? ''
              : `±${Number(raw)}%`;
            // 查阅态日期归一：日期键统一 YYYY-MM-DD（与 OrderFieldInput 档案态一致）
            const value = !isEditing && ['exMillDate', 'deliveryDate', 'shippingDate', 'actualPaymentDate'].includes(key)
              ? formatYmd(raw) || ''
              : isTolerance
                ? (isEditing ? (raw === '' || raw === null || raw === undefined ? '' : String(Number(raw))) : toleranceDisplay)
                : raw;
            const isEmpty = !value || value === '-' || value === '';
            return (
              <div key={key} className="space-y-1.5">
                <span className={`ml-1 ${KICKER_CLASS}`}>{label}</span>
                {isEditing ? (
                  <input
                    className={`bds-input ${FIELD_NO_SPINNER_CLASS}`}
                    inputMode={isTolerance ? 'decimal' : undefined}
                    placeholder={isTolerance ? '如 5' : undefined}
                    value={String(value)}
                    onChange={(event) => {
                      const numericKey = ['quantity', 'unitPrice', 'netValue', 'tolerancePercent'].includes(key);
                      const nextValue = numericKey ? Number(event.target.value) : event.target.value;
                      setEditLineForm((prev) => ({ ...(prev ?? selectedLineItem), [key]: nextValue }));
                      // P1-3：客供品号/工厂品色号即产品锚，变更即 debounce 预检（合成另一锚当前值一起校验）
                      if (key === 'materialCode' || key === 'millQuality') {
                        scheduleEditLineFabricCheck({
                          materialCode: key === 'materialCode' ? nextValue : (editLineForm as any)?.materialCode,
                          millQuality: key === 'millQuality' ? nextValue : (editLineForm as any)?.millQuality,
                        });
                      }
                    }}
                  />
                ) : (
                  <div className={`min-h-6 truncate rounded-inset px-2.5 py-1 ${isEmpty ? FIELD_SLOT_EMPTY_CLASS : FIELD_SLOT_FILLED_CLASS}`}>
                    <span className={isEmpty ? FIELD_READONLY_EMPTY_CLASS : FIELD_READONLY_VALUE_CLASS}>{isEmpty ? '—' : String(value)}</span>
                  </div>
                )}
              </div>
            );
          })}
                        </div>
                        {/* P1-3 客户专属面料行级警示：提前提示，不拦截输入；提交仍由后端 fail-closed 兜底 */}
                        {isEditing && editLineFabricViolations && editLineFabricViolations.length > 0 && (
                          <div role="alert" className="mt-3 flex items-start gap-2 rounded-inset px-3 py-2 text-xs leading-relaxed" style={{ background: 'var(--danger-tint)', color: 'var(--danger-text)' }}>
                            <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                            <span>
                              {editLineFabricViolations.map((v, i) => (
                                <span key={`${v.productAssetId}-${i}`}>
                                  {i > 0 && '；'}
                                  {`面料「${v.productName || v.sku || v.clientCode || v.productAssetId}」为客户「${v.ownerCustomerName || '未知属主'}」出资开发的专属面料`}
                                </span>
                              ))}
                              ；当前订单客户「{String(((isEditing && editForm ? editForm : selectedOrder))?.customer ?? '—')}」无权使用，保存提交时将被系统拦截。如确需使用请走属主客户授权变更。
                            </span>
                          </div>
                        )}
                      </CompiledSurfacePanel>
                    )}

                    {/* Order Lines Table */}
                    {!selectedLineItem && selectedOrder.lines && selectedOrder.lines.length > 0 && (
                      <div id="order-detail-lines">
                        <OrderLinesTable
                          lines={selectedOrder.lines}
                          isDarkMode={isDarkMode}
                          currency={selectedOrder.salesCurrency || 'USD'}
                        />
                      </div>
                    )}

                    {/* REQ2-03 溢短装校验：全部行已发量 vs 合同量（±N% 条款区间 + 超限预警） */}
                    {selectedOrder.id && selectedOrder.lines && selectedOrder.lines.length > 0 && (
                      <div id="order-detail-tolerance" className="mt-6">
                        <OrderToleranceSection
                          key={selectedOrder.id}
                          orderId={selectedOrder.id}
                          isDarkMode={isDarkMode}
                          currency={selectedOrder.salesCurrency || 'USD'}
                          refreshKey={toleranceRefreshKey}
                        />
                      </div>
                    )}

                    {/* Dictionary-driven field sections */}
                    <div className="space-y-6">
                      {detailSections.map(({ cluster, fields }) => (
                        <OrderClusterBlock
                          key={cluster.id}
                          cluster={cluster}
                          fields={fields}
                          order={isEditing && editForm ? editForm : selectedOrder}
                          isDarkMode={isDarkMode}
                          readOnly={!isEditing}
                          relations={relations}
                          onCreateRelation={onCreateRelation}
                          onRelationSelected={isEditing ? handleRelationSelected : undefined}
                          onChange={(patch) => {
                            if (isEditing && editForm) {
                              setEditForm(applyAmountLinkage(editForm, patch) as Order);
                            }
                          }}
                          orderLine={isEditing && editLineForm ? editLineForm : selectedOrder?.lines?.[0]}
                          onLineChange={isEditing ? (patch) => {
                            setEditLineForm((prev) => ({ ...(prev ?? selectedOrder?.lines?.[0] ?? {}), ...patch } as Partial<OrderLineItem>));
                            // P1-3：line 字段簇若触碰产品锚同样触发即时预检
                            if ('materialCode' in patch || 'millQuality' in patch) {
                              const prevLine = ((isEditing && editLineForm) || selectedOrder?.lines?.[0]) as Partial<OrderLineLite> | undefined;
                              scheduleEditLineFabricCheck({
                                materialCode: 'materialCode' in patch ? patch.materialCode : prevLine?.materialCode,
                                millQuality: 'millQuality' in patch ? patch.millQuality : prevLine?.millQuality,
                              });
                            }
                          } : undefined}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Footer Action Bar — primary actions live in the header now;
                only destructive 'archive' lingers here for safety distance. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[60] px-5 pb-5 pt-10 flex justify-end items-center">
              {/* 渐变遮挡层：防止滚动内容穿透底部归档区 */}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
                style={OVERLAY_BOTTOM_MASK_STYLE}
              />
              <div className="pointer-events-auto relative flex items-center gap-2">
                {canWriteOrders && (
                  <button onClick={() => setShowDeleteConfirm(true)} className="bds-btn bds-btn-ghost bds-btn-icon" title="归档此单">
                    <Trash2 size={16} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Add Order Modal */}
      {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-[60] flex flex-col pointer-events-auto bg-transparent"
            onClick={() => { setShowAddModal(false); resetNewOrder(); }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative w-full h-full overflow-hidden"
            >
              {/* Header — primary actions and close button grouped top-right */}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[60] px-7 pt-5 pb-3 flex items-center justify-between">
                {/* 渐变遮挡层：防止滚动内容穿透标题区（backdrop-blur + mask 渐隐，衔接滚动容器 96px 顶部让位；BDS 画布 token 驱动渐变） */}
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-24 pointer-events-none backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_0%,black_72%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_72%,transparent_100%)]"
                  style={OVERLAY_TOP_MASK_STYLE}
                />
                <div className="relative min-w-0">
                  <p className={KICKER_CLASS}>{orderType === 'garment' ? 'New Garment Order' : orderType === 'other' ? 'New Other Order' : 'New Fabric Order'}</p>
                  <div className="mt-1 flex min-w-0 items-baseline gap-3">
                    <h2 className={`truncate text-[22px] font-light tracking-[0.12em] ${TXT_TITLE}`}>录入{ORDER_TYPE_LABELS[orderType]}订单</h2>
                    <span className={HEADER_META_CLASS}>生产录入</span>
                  </div>
                </div>
                <div className="pointer-events-auto relative flex items-center gap-2">
                  <button
                    onClick={() => { setShowAddModal(false); setShowImportWizard(true); }}
                    className="bds-btn bds-btn-secondary"
                  >
                    <Upload size={14} strokeWidth={1.5} /> 导入 PDF
                  </button>
                  <button onClick={handleAddOrder} className="bds-btn bds-btn-primary">
                    <Save size={14} strokeWidth={1.5} />确认创建
                  </button>
                  <div className={`h-4 w-px ${DIVIDER_CLASS}`}></div>
                  <button
                    onClick={() => { setShowAddModal(false); resetNewOrder(); }}
                    className="bds-btn bds-btn-ghost bds-btn-icon"
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="absolute inset-0 z-10 overflow-hidden">
                <div className="h-full px-7 pt-24">
                  <div className="grid h-full w-full grid-cols-[240px_minmax(0,1fr)] gap-5">
                    <aside className="self-start">
                      <CompiledSurfacePanel materialRole="raisedCard" spotlight isDarkMode={isDarkMode} className={OVERLAY_MAP_PANEL_CLASS}>
                        <p className={`px-3 pb-3 ${KICKER_CLASS}`}>Form Map</p>
                        <div className="space-y-1">
                          {manualSections.map(({ cluster }, idx) => (
                            <button
                              key={cluster.id}
                              type="button"
                              onClick={() => document.getElementById(`section-${cluster.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                              className={OVERLAY_MAP_BUTTON_CLASS}
                            >
                              <div className="flex items-center gap-3">
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-light ${OVERLAY_MAP_INDEX_CLASS}`}>{idx + 1}</span>
                                <div className="min-w-0">
                                  <div className={`truncate text-xs font-light ${TXT_TITLE}`}>{cluster.labelZh}</div>
                                  <div className={`mt-0.5 truncate text-[10px] font-light ${TXT_MUTED}`}>{cluster.labelEn}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </CompiledSurfacePanel>
                    </aside>
                    <div ref={orderEntryScrollRef} className="min-w-0 overflow-y-auto overscroll-contain space-y-6 pb-32 bambook-panel-shadow-viewport">
                      {manualSections.map(({ cluster, fields }) => (
                        <OrderClusterBlock
                          key={cluster.id}
                          cluster={cluster}
                          fields={fields}
                          order={newOrder}
                          isDarkMode={isDarkMode}
                          relations={relations}
                          onCreateRelation={onCreateRelation}
                          onRelationSelected={handleNewRelationSelected}
                          onChange={(patch) => setNewOrder((prev) => applyAmountLinkage(prev, patch) as Partial<Order>)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
      )}

      {showDeleteConfirm && (
        <div className="bds-modal-mask !absolute !z-[100] duration-300 pointer-events-auto">
          <div className="bds-modal overflow-hidden duration-300">
            <div className="text-center space-y-6">
              <div className={`w-20 h-20 rounded-field flex items-center justify-center mx-auto mb-2 border ${BORDER_SUBTLE_CLASS} bg-[var(--recessed-bg)]`}>
                <AlertTriangle size={24} strokeWidth={1.5} className="text-[var(--warning)]" />
              </div>
              <div className="space-y-2">
                <h3 className={`text-xl font-light ${TXT_TITLE}`}>确认归档生产任务？</h3>
                <p className={`text-sm font-light leading-relaxed ${TXT_SECONDARY}`}>
                  确定要归档此生产任务吗？归档后该订单将从当前生产流中移除并存入历史档案。
                </p>
              </div>
              <div className="flex flex-col items-center gap-3 pt-4">
                <button
                  onClick={handleDeleteOrder}
                  disabled={isArchiving}
                  className="bds-btn bds-btn-danger min-w-32 px-6"
                >
                  {isArchiving ? '归档中…' : '确认归档'}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isArchiving}
                  className="bds-btn bds-btn-ghost min-w-32 px-6"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 一键溯源侧边面板（z 须高于详情覆盖层 z-[60]，否则从详情打开时被压在下方不可见） */}
      {showTracePanel && selectedOrder?.id && (
        <div
          className="fixed inset-0 z-[70] flex justify-end"
          onClick={() => setShowTracePanel(false)}
        >
          <div className="absolute inset-0 bg-[var(--mask-bg)]" />
          <div
            className={`bds-frosted relative flex h-full w-full max-w-2xl flex-col overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between border-b px-4 py-3 ${BORDER_SUBTLE_CLASS}`}>
              <div className="flex items-center gap-2">
                <GitBranch size={16} className={TXT_SECONDARY} />
                <span className={`text-sm font-light ${TXT_TITLE}`}>订单履约链溯源</span>
                <span className={`text-[10px] font-light tracking-[0.14em] ${TXT_FAINT}`}>Order Fulfillment</span>
              </div>
              <button
                type="button"
                onClick={() => setShowTracePanel(false)}
                className="bds-btn bds-btn-ghost bds-btn-icon"
              >
                <X size={16} />
              </button>
            </div>
            <TraceabilityPanel
              isDarkMode={isDarkMode}
              presetScenario="orderFulfillment"
              presetRootId={selectedOrder.id}
              embedded
            />
          </div>
        </div>
      )}

      {/* B8 订单确认书 A4 预览（服务端模板，与生成 PDF 同源排版） */}
      {ocPreviewOpen && selectedOrder?.id && (
        <A4DocumentPreviewModal
          title={`订单确认书预览 · ${selectedOrder.poNumber || selectedOrder.customer}`}
          subtitle="A4 · Order Confirmation · 与生成 PDF 同源排版"
          html={ocPreviewHtml}
          loading={ocPreviewLoading}
          error={ocPreviewErr}
          onClose={() => setOcPreviewOpen(false)}
          onPrint={() => void handleGenerateOc(selectedOrder.id)}
          printLabel="生成 PDF"
        />
      )}
    </div>
  );
};

export default OrderManager;
