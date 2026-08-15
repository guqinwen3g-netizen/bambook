
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Order, KnowledgeItem, ResolutionStrategy, PoItem, Relation, OrderLineItem, OrderLineLite, OrderStatusTransition, View } from '../types';
import { apiService } from '../services/apiService';
import {
  Plus, ArrowRight, MoreHorizontal,
  Building2, X, AlertCircle,
  Trash2, Edit2, Save, Package,
  AlertTriangle,
  Globe, List,
  Upload, ShoppingCart, ClipboardCheck, Ship, CheckCircle2, ChevronDown, GitBranch
} from 'lucide-react';
import { TraceabilityPanel } from './TraceabilityPanel';
import BottomSheet from './ui/BottomSheet';
import ImportWizard from './import/ImportWizard';
import { ParsedOrder, SavedOrderRow } from '../types';
import { saveParsedOrders, updateOrderFields } from '../services/importService';
import { createOrderLine, updateOrderLineFields } from '../services/orderLineService';
import OrderClusterBlock from './order/OrderClusterBlock';
import OrderLinesTable from './order/OrderLinesTable';
import { useGlassSurfaceEdgeMasks } from './ui/useGlassSurfaceEdgeMasks';
import { ProductionPipeline } from './ProductionPipeline';
import { ProductionAlerts } from './ProductionAlerts';
import { PageHeader } from './ui/PageHeader';
import { CompiledTableShell } from './ui/osCompiler/compiledPrimitives';
import { CompiledMotionInteractiveCard, CompiledSurfacePanel } from './ui/osCompiler/compiledSurfacePrimitives';
import RelatedEntitiesPanel from './RelatedEntitiesPanel';
import AuditHistorySection from './AuditHistorySection';
import OrderContextSection from './order/OrderContextSection';
import OrderSectionHeader from './order/OrderSectionHeader';
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
  const customer = row.customer || 'Peerless';
  const supplier = row.millName || 'Panda Clothing';
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
  dirtyIds: Set<string>;
  setOrders: (o: Order[], modified?: Order) => void;
  onSyncComplete: (id: string) => void;
  knowledge: KnowledgeItem[];
  viewMode: 'globe' | 'list';
  onViewModeChange: (mode: 'globe' | 'list') => void;
  selectedOrder: Order | null;
  onSelectOrder: (order: Order | null) => void;
  isDarkMode?: boolean;
  isMobile?: boolean;
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

const ORDER_TABLE_GRID_CLASS = 'grid-cols-[22%_15%_27%_13%_13%_10%]';
const ORDER_TABLE_WIDTH_CLASS = 'w-full min-w-0';
const ORDER_TABLE_ROW_CLASS = 'min-h-[72px]';
const ORDER_TABLE_COLUMN_WIDTH_CLASSES = [
  'w-[22%]',
  'w-[15%]',
  'w-[27%]',
  'w-[13%]',
  'w-[13%]',
  'w-[10%]',
];
const ORDER_TABLE_HEADERS = [
  { label: '订单 / 客户' },
  { label: '品号' },
  { label: '描述 / 色号' },
  { label: '数量 / 金额', align: 'text-right' },
  { label: '日期' },
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
const KICKER_CLASS = `text-[11px] font-light uppercase tracking-[0.22em] ${TXT_MUTED}`;
/** 1px 细分隔条底色（竖/横共用） */
const DIVIDER_CLASS = 'bg-[var(--border-c-strong)]';
/** 细边框色（统计分隔/卡内分隔线） */
const BORDER_SUBTLE_CLASS = 'border-[var(--border-c-subtle)]';

/** 履约状态步骤条按钮四态（BDS 按钮变体；current/done 带 disabled 属性时需 !opacity-100 抵消 bds-btn:disabled 透明度） */
const STEP_BTN_CURRENT = 'bds-btn bds-btn-primary !min-w-[96px] !opacity-100';
const STEP_BTN_DONE = 'bds-btn bds-btn-outline !min-w-[96px] !opacity-100';
const STEP_BTN_ACTIONABLE = 'bds-btn bds-btn-outline !min-w-[96px]';
const STEP_BTN_DISABLED = 'bds-btn bds-btn-ghost !min-w-[96px]';

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
const OVERLAY_MAP_BUTTON_CLASS = `w-full text-left rounded-full border border-transparent px-3 py-3 transition-all ${TXT_SECONDARY} hover:bg-[var(--hover-darken)] hover:border-[var(--border-c-subtle)] hover:text-[var(--text-primary)]`;
const OVERLAY_MAP_INDEX_CLASS = `border-[var(--border-c-subtle)] bg-[var(--bg-sunken)] ${TXT_MUTED}`;
/** 覆盖层头部 meta（编辑/查阅模式、录入标记等降级元信息） */
const HEADER_META_CLASS = `shrink-0 text-[12px] font-light ${TXT_MUTED}`;
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
const FIELD_SLOT_FILLED_CLASS = 'bg-[var(--bg-sunken)]';
const FIELD_SLOT_EMPTY_CLASS = 'bg-[var(--hover-darken)]';
const FIELD_READONLY_VALUE_CLASS = `text-[14px] font-normal leading-relaxed ${TXT_SECONDARY}`;
const FIELD_READONLY_EMPTY_CLASS = `text-[13px] font-light italic leading-relaxed ${TXT_FAINT}`;
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

const OrderManager: React.FC<OrderManagerProps> = ({ orders, dirtyIds, setOrders, onSyncComplete, knowledge, viewMode, onViewModeChange, selectedOrder, onSelectOrder, isDarkMode = false, isMobile = false, orderType, onOrderTypeChange, relations = [], onCreateRelation, allowGlobeView = true, onFullscreenOpenChange, onNavigate }) => {
  // Local state removed, using props
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTracePanel, setShowTracePanel] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Order | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [strategies, setStrategies] = useState<ResolutionStrategy[]>([]);
  const [showOptionsSheet, setShowOptionsSheet] = useState<Order | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [poItems, setPoItems] = useState<PoItem[]>([]);
  const [selectedLineItem, setSelectedLineItem] = useState<OrderLineItem | null>(null);
  const [editLineForm, setEditLineForm] = useState<Partial<OrderLineItem> | null>(null);
  const [statusTimeline, setStatusTimeline] = useState<OrderStatusTransition[]>([]);
  const orderDetailScrollRef = useRef<HTMLDivElement | null>(null);
  const orderEntryScrollRef = useRef<HTMLDivElement | null>(null);
  const orderListScrollRef = useRef<HTMLDivElement | null>(null);

  // Load status timeline when selected order changes
  useEffect(() => {
    if (!selectedOrder?.id) { setStatusTimeline([]); return; }
    (async () => {
      try {
        const timeline = await apiService.getOrderTimeline(selectedOrder.id!);
        setStatusTimeline(timeline);
      } catch { /* ignore */ }
    })();
  }, [selectedOrder?.id]);

  // Push order status forward with audit trail
  const handleStatusTransition = useCallback(async (toStatus: string, note?: string) => {
    if (!selectedOrder?.id) return;
    try {
      const updated = await apiService.transitionOrderStatus(selectedOrder.id, toStatus, 'desktop-user', note);
      const nextOrders = orders.map(o => o.id === updated.id ? updated : o);
      setOrders(nextOrders, updated);
      onSelectOrder(updated);
      // Refresh timeline
      try {
        const timeline = await apiService.getOrderTimeline(selectedOrder.id!);
        setStatusTimeline(timeline);
      } catch { /* 时间线刷新失败非关键：状态已可见更新，保持静默 */ }
    } catch (e: any) {
      // IA 残留收口：推进失败必须用户可见（191.6 登记体验债），沿用本模块 window.alert 反馈惯例
      window.alert(`状态推进失败：${e?.message ?? e}\n\n订单状态未变更，请稍后重试。`);
    }
  }, [selectedOrder?.id, orders, setOrders, onSelectOrder]);

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
  const filteredOrders = orders.filter(o =>
    !o.deletedAt &&
    (isAllType || o.type === currentDbType) &&
    (!capsuleActive || o.businessLine === 'capsule'),
  );
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [orderFilterStatus, setOrderFilterStatus] = useState<string>('all');

  const lineItems = useMemo(() => {
    let items = flattenOrderLines(orders).filter(item => isAllType || item.order?.type === currentDbType);
    if (capsuleActive) {
      items = items.filter(item => item.order?.businessLine === 'capsule');
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
    return items;
  }, [orders, orderType, capsuleActive, orderSearchTerm, orderFilterStatus, isAllType, currentDbType]);

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

  const handleLineClick = (item: OrderLineItem) => {
    setSelectedLineItem(item);
    setEditLineForm({ ...item });
    onSelectOrder(item.order);
    setIsEditing(false);
    setEditForm({ ...item.order });
  };


  const handleSaveEdit = async () => {
    if (!editForm) return;
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
      return;
    }
    const updatedOrder = {
      ...editForm,
      updatedAt: Date.now(),
    };
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
        } catch (lineErr: any) {
          // eslint-disable-next-line no-console
          console.error('[detail-save] line persist failed:', lineErr);
          window.alert(`行项目字段保存失败：${lineErr?.message ?? lineErr}\n\n订单级字段将继续保存。`);
        }
      }

      const { id, lines: _ignoreLines, fieldSources: _ignoreSources, ...patch } = updatedOrder as any;
      const { order: persisted } = await updateOrderFields(id, patch);
      const synced = updatedOrders.map((o) => (o.id === id ? (persisted as Order) : o));
      setOrders(synced, persisted as Order);
      onSelectOrder(persisted as Order);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[detail-save] persist failed:', e);
      window.alert(`订单详情保存到服务器失败：${e?.message ?? e}\n\n本地更改保留，但下一次同步可能丢失。`);
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
    try {
      // 成功：用后端返回的 order（含 deletedAt）更新本地状态，保持与后端一致
      // 不传 modified 第二参——本函数已直接调后端 DELETE，传 modified 会触发
      // App.handleUpdateOrders 的二次 deleteOrder（modified.deletedAt 分支）。
      const tombstone = await apiService.deleteOrderRemote(selectedOrder.id);
      const updatedOrders = orders.map(o => o.id === tombstone.id ? tombstone : o);
      setOrders(updatedOrders);
      onSelectOrder(null);
      setShowDeleteConfirm(false);
    } catch (e: any) {
      window.alert(`订单删除失败：${e?.message ?? e}\n\n订单未从列表移除，请稍后重试。`);
      setShowDeleteConfirm(false);
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
      window.alert(`必填项缺失，无法创建订单：\n\n· ${missing.join('\n· ')}`);
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
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[manual-line-create] failed:', e);
      window.alert(`面料项目未能保存到服务器：${e?.message ?? e}`);
    }
  };

  const desktopFullscreenOpen = !isMobile && (showAddModal || !!selectedOrder);
  const effectiveViewMode = allowGlobeView ? viewMode : 'list';
  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 样式分支，暗色由 tokens.css [data-theme]/.dark 统一覆盖 ──
  // 表格行三档文字（密集阅读场景，token 墨色）
  const listRowPrimaryCls = `truncate text-[13px] font-light leading-[1.25] tracking-normal ${TXT_TITLE}`;
  const listRowRegularCls = `truncate text-[13px] font-light leading-[1.25] tracking-normal ${TXT_SECONDARY}`;
  const listRowSecondaryCls = `mt-1 truncate text-[11px] font-light leading-[1.2] tracking-normal ${TXT_MUTED}`;
  // 行内"查看详情"交互暗示（hover 变 accent）
  const listRowActionHintCls = `mt-1 flex items-center gap-1 text-[11px] font-light leading-[1.2] tracking-normal transition-colors duration-200 ${TXT_MUTED} group-hover:text-[var(--accent-text)]`;
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
  // 成功后同步本地列表与选中订单；失败沿用本模块 window.alert 反馈惯例。
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
      window.alert(`业务线标记失败：${e?.message ?? e}\n请稍后重试。`);
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
        center={(
          <div className="hidden md:flex bds-filterbar max-w-[440px]">
            <input
              type="text"
              value={orderSearchTerm}
              onChange={e => setOrderSearchTerm(e.target.value)}
              placeholder="搜索订单号/客户/品号..."
              className="bds-input min-w-[100px] max-w-[180px] flex-1"
            />
            <div className="relative h-8 shrink-0">
              <select
                value={orderFilterStatus}
                onChange={e => setOrderFilterStatus(e.target.value)}
                className="bds-select h-8 pl-3.5 pr-8 text-xs"
              >
                <option value="all">全部状态</option>
                <option value="Pending">待确认</option>
                <option value="Confirmed">已确认</option>
                <option value="Production">生产中</option>
                <option value="Shipping">发货中</option>
                <option value="Delivered">已交付</option>
                <option value="Alert">异常</option>
              </select>
              <ChevronDown size={12} strokeWidth={1.5} className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 ${TXT_FAINT}`} />
            </div>
            <div className={`h-5 w-px shrink-0 ${DIVIDER_CLASS}`} />
            <div className="flex h-8 items-center gap-0.5">
              {allowGlobeView && (
                <button
                  type="button"
                  title="地球视图"
                  onClick={() => onViewModeChange('globe')}
                  className={`bds-btn bds-btn-icon ${effectiveViewMode === 'globe' ? 'bds-btn-dark' : 'bds-btn-ghost'}`}
                >
                  <Globe size={14} strokeWidth={1.5} />
                </button>
              )}
              <button
                type="button"
                title="列表视图"
                onClick={() => onViewModeChange('list')}
                className={`bds-btn bds-btn-icon ${effectiveViewMode === 'list' ? 'bds-btn-dark' : 'bds-btn-ghost'}`}
              >
                <List size={14} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}
        actions={(
          <>
            <div className="flex items-center gap-1 md:hidden">
              {allowGlobeView && (
                <button
                  type="button"
                  title="地球视图"
                  onClick={() => onViewModeChange('globe')}
                  className={`bds-btn bds-btn-icon ${effectiveViewMode === 'globe' ? 'bds-btn-dark' : 'bds-btn-ghost'}`}
                >
                  <Globe size={15} strokeWidth={1.5} />
                </button>
              )}
              <button
                type="button"
                title="列表视图"
                onClick={() => onViewModeChange('list')}
                className={`bds-btn bds-btn-icon ${effectiveViewMode === 'list' ? 'bds-btn-dark' : 'bds-btn-ghost'}`}
              >
                <List size={15} strokeWidth={1.5} />
              </button>
            </div>
            {!isMobile && (
              <button
                type="button"
                onClick={() => { onSelectOrder(null); setShowImportWizard(true); }}
                className="bds-btn bds-btn-secondary"
              >
                <Upload size={15} strokeWidth={1.5} /> 导入
              </button>
            )}
            <button
              type="button"
              onClick={() => { onSelectOrder(null); setNewOrder({ ...getDefaultNewOrder(), type: currentDbType || 'Fabric' }); setShowAddModal(true); }}
              className="bds-btn bds-btn-primary"
            >
              <Plus size={15} strokeWidth={1.5} /> {!isMobile && '录入订单'}
            </button>
            {selectedOrder?.id && (
              <button
                type="button"
                onClick={() => setShowTracePanel(true)}
                className="bds-btn bds-btn-secondary"
              >
                <GitBranch size={15} strokeWidth={1.5} /> {!isMobile && '溯源'}
              </button>
            )}
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
            window.alert(
              `已入库：新增 ${resp.created} 张，更新 ${resp.updated} 张。` +
              `\n订单列表已刷新。`,
            );
            setShowImportWizard(false);
          } catch (e: any) {
            console.error('[ImportWizard] save failed:', e);
            window.alert(`入库失败：${e?.message ?? e}\n订单未保存，请稍后重试。`);
          }
        }}
        isDarkMode={isDarkMode}
      />

      {/* 独立订单类型 Tab 栏 — 统一桌面/移动/Globe 三种场景，不与搜索/筛选混在一起（BDS 分段控件） */}
      {!desktopFullscreenOpen && (
        <div className={`shrink-0 px-4 py-2 pointer-events-auto ${isMobile ? 'overflow-x-auto no-scrollbar' : ''}`}>
          <div className="bds-segment w-fit">
            {renderOrderTypeSwitcher()}
          </div>
        </div>
      )}

      <div className={`flex-1 overflow-hidden relative ${desktopFullscreenOpen ? 'hidden' : ''}`}>
        {effectiveViewMode === 'globe' ? (
          <div className="w-full h-full relative animate-in fade-in duration-700">
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
            <div className={`flex-1 min-h-0 ${isMobile ? 'overflow-y-scroll p-4 pb-20 safe-bottom' : 'overflow-visible'}`}>
              {isMobile ? (
                // Mobile Card View (Enhanced Design)
                <div className="space-y-4">
                  {filteredOrders.map((order) => (
                    <div
                      key={order.id}
                      onClick={() => handleOrderClick(order)}
                      className={`relative p-5 bambook-card-glass overflow-hidden transition-all touch-active ${selectedOrder?.id === order.id ? 'ring-2 ring-[var(--accent)]' : ''}`}
                    >
                      {/* Quick Action Trigger */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowOptionsSheet(order); }}
                        className={`absolute top-4 right-4 p-2 rounded-full z-10 transition-colors ${TXT_FAINT} hover:bg-[var(--hover-darken)]`}
                      >
                        <MoreHorizontal size={20} strokeWidth={1} />
                      </button>

                      {/* Card Header: Order ID & Status */}
                      <div className="flex justify-between items-start mb-4 pr-8">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 rounded-full" style={ORDER_TYPE_DOT_STYLE[order.type]}></div>
                            <span className="bds-badge sm" style={ORDER_TYPE_BADGE_STYLE[order.type]}>
                              {DB_TYPE_ZH[order.type] || order.type}
                            </span>
                            {order.businessLine === 'capsule' && (
                              <span className="bds-badge sm neutral">Capsule</span>
                            )}
                          </div>
                          <span className={`text-lg font-light font-mono tracking-tight ${TXT_TITLE}`}>{order.id}</span>
                        </div>
                        <span className={`bds-badge sm uppercase ${STATUS_BADGE_VARIANT[order.status] ?? 'neutral'}`}>
                          {order.status}
                        </span>
                      </div>

                      {/* Card Body: Factory & Value */}
                      <div className="flex justify-between items-end mb-4">
                        <div>
                          <div className={`text-[10px] font-light mb-1 ${TXT_FAINT}`}>FACTORY</div>
                          <div className={`text-sm font-light flex items-center gap-1.5 ${TXT_SECONDARY}`}>
                            <Building2 size={12} /> {order.millName}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-[10px] font-light mb-1 ${TXT_FAINT}`}>VALUE</div>
                          <div className={`text-xl font-light ${TXT_TITLE}`}>
                            ${order.quoteAmount.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {/* Card Footer: Progress Bar（BDS 进度条族；小元素 fill 允许彩色发光） */}
                      <div className="space-y-1.5">
                        <div className={`flex justify-between text-[9px] font-light uppercase tracking-widest ${TXT_FAINT}`}>
                          <span>Progress</span>
                          <span>{order.status === 'Delivered' ? '100%' : order.status === 'Shipping' ? '85%' : order.status === 'Production' ? '60%' : order.status === 'Confirmed' ? '25%' : order.status === 'Alert' ? '异常' : '10%'}</span>
                        </div>
                        <div className={`bds-progress ${order.status === 'Alert' ? 'warning' : order.status === 'Delivered' ? 'success' : ''}`}>
                          <div
                            className="fill"
                            style={{ width: order.status === 'Alert' ? '30%' : order.status === 'Delivered' ? '100%' : order.status === 'Shipping' ? '85%' : order.status === 'Production' ? '60%' : order.status === 'Confirmed' ? '25%' : '10%' }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                <ProductionAlerts isDarkMode={isDarkMode} onSelectOrder={(oid) => {
                  const item = lineItems.find(li => li.order?.id === oid);
                  if (item) handleLineClick(item);
                }} />
                <div className="w-full h-full flex flex-col min-h-0 overflow-visible bg-transparent">
                <div className="flex-1 min-h-0 flex px-5 pt-0 bambook-main-panel-bottom-inset gap-4 overflow-visible">
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
                              {header.label}
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
                        <div className="glyph"><Package size={22} strokeWidth={1} /></div>
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
                              查看详情 <ArrowRight size={10} strokeWidth={1.5} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                            </p>
                          </div>
                        </CompiledMotionInteractiveCard>
                      );
                    })}
                  </div>
                </CompiledTableShell>
                </div>
                </div>
                </>
              )}
              {isMobile && filteredOrders.length === 0 && (
                <div className={`p-20 text-center flex flex-col items-center justify-center gap-4 ${TXT_MUTED}`}>
                  <Package size={60} strokeWidth={1} className={TXT_FAINT} />
                  {capsuleActive ? (
                    <p className="text-sm font-light tracking-wide">暂无 Capsule 订单</p>
                  ) : (
                    <p className="text-sm font-light tracking-wide">
                      {orderType === 'all' ? '暂无订单' : orderType === 'fabric' ? '暂无面料订单' : orderType === 'garment' ? '暂无成衣订单' : '暂无其他类型订单'}
                    </p>
                  )}
                </div>
              )}
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
                  </div>
                )}
              </div>
              <div className="pointer-events-auto relative bds-filterbar">
                {isEditing ? (
                  <button onClick={handleSaveEdit} className="bds-btn bds-btn-primary">
                    <Save size={14} strokeWidth={1.5} />保存修改
                  </button>
                ) : (
                  <button onClick={() => { setIsEditing(true); setEditForm(selectedOrder ? { ...selectedOrder } : null); setEditLineForm(selectedLineItem ? { ...selectedLineItem } : (selectedOrder?.lines?.[0] ? { ...selectedOrder.lines[0] } as Partial<OrderLineItem> : null)); }} className="bds-btn bds-btn-secondary">
                    <Edit2 size={14} strokeWidth={1.5} />编辑项目
                  </button>
                )}
                <div className={`h-4 w-px ${DIVIDER_CLASS}`}></div>
                <button
                  onClick={() => { onSelectOrder(null); setSelectedLineItem(null); setEditLineForm(null); setIsEditing(false); setEditForm(null); }}
                  className="bds-btn bds-btn-ghost bds-btn-icon"
                >
                  <X size={17} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* Scrollable Content Container */}
            <div className="absolute inset-0 z-10 overflow-hidden">
              <div ref={orderDetailScrollRef} className="h-full overflow-y-auto">
                <div className="grid w-full grid-cols-[240px_minmax(0,1fr)] gap-5 px-5 pt-24 pb-5">
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
                            <p className={`mt-2.5 flex items-baseline min-w-0 leading-none tracking-tight ${stat.compact ? `text-[15px] font-light` : 'text-[26px] font-extralight tabular-nums'} ${TXT_TITLE}`}>
                              {stat.affix && stat.affixPos === 'prefix' && <span className={`mr-1.5 shrink-0 text-[12px] font-light tracking-wide ${TXT_MUTED}`}>{stat.affix}</span>}
                              <span className="truncate">{stat.num}</span>
                              {stat.affix && stat.affixPos === 'suffix' && <span className={`ml-1.5 shrink-0 text-[12px] font-light tracking-wide ${TXT_MUTED}`}>{stat.affix}</span>}
                            </p>
                            <p className={`mt-2.5 text-[11px] font-light ${TXT_MUTED}`}>{stat.label}</p>
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
                              const isActionable = !isEditing && allowed.includes(step);
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
                                    {isDone && <CheckCircle2 size={12} strokeWidth={2} className="text-[var(--accent)]" />}
                                    {ORDER_STATUS_LABELS[step]}
                                  </button>
                                </React.Fragment>
                              );
                            })}
                            {/* Alert 异常态：非终态可标记异常；异常中可恢复到任一非终态（点击上方步骤） */}
                            <span className={`h-px w-4 shrink-0 ${STEP_CONNECTOR_PENDING_CLASS}`} />
                            <button
                              type="button"
                              disabled={isEditing || (!isAlert && !allowed.includes('Alert'))}
                              onClick={() => !isAlert && handleStatusTransition('Alert')}
                              title={isAlert ? '异常中：点击左侧步骤恢复到对应阶段' : '标记为异常'}
                              className={`${isAlert ? 'bds-btn !min-w-[96px]' : 'bds-btn bds-btn-outline !min-w-[96px]'} ${isEditing ? 'cursor-not-allowed opacity-40' : ''}`}
                              style={isAlert ? STEP_BTN_ALERT_STYLE : undefined}
                            >
                              <AlertTriangle size={11} strokeWidth={1.5} />
                              {ORDER_STATUS_LABELS.Alert}
                            </button>
                          </div>
                        );
                      })()}

                      {statusTimeline.length === 0 ? (
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

                      {/* Overdue alert（BDS alert 族 danger 语义） */}
                      {selectedOrder.status === 'Alert' && (
                        <div className="bds-alert danger mt-4">
                          <AlertCircle size={14} />
                          <span className="text-xs font-light">此订单已超期，请尽快处理</span>
                        </div>
                      )}
                    </CompiledSurfacePanel>

                    {/* 跨模块关联视图 — 客户/供应商/收货方/销售/跟单等 EntityLink */}
                    <div id="order-detail-related">
                      <RelatedEntitiesPanel
                        type="order"
                        id={selectedOrder.id}
                        isDarkMode={isDarkMode}
                        title="订单关联视图"
                      />
                    </div>

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
                            ['状态', 'status'],
                            ['实际发货日', 'shippingDate'],
                            ['发票号', 'invoiceNumber'],
                            ['收款日', 'actualPaymentDate'],
                          ].map(([label, key]) => {
            const raw = (isEditing && editLineForm ? (editLineForm as any)[key] : (selectedLineItem as any)[key]) ?? '';
            // 查阅态日期归一：日期键统一 YYYY-MM-DD（与 OrderFieldInput 档案态一致）
            const value = !isEditing && ['exMillDate', 'deliveryDate', 'shippingDate', 'actualPaymentDate'].includes(key)
              ? formatYmd(raw) || ''
              : raw;
            const isEmpty = !value || value === '-' || value === '';
            return (
              <div key={key} className="space-y-1.5">
                <span className={`ml-1 ${KICKER_CLASS}`}>{label}</span>
                {isEditing ? (
                  <input
                    className={`bds-input ${FIELD_NO_SPINNER_CLASS}`}
                    value={String(value)}
                    onChange={(event) => setEditLineForm((prev) => ({ ...(prev ?? selectedLineItem), [key]: ['quantity', 'unitPrice', 'netValue'].includes(key) ? Number(event.target.value) : event.target.value }))}
                  />
                ) : (
                  <div className={`min-h-[24px] truncate rounded-inset px-2.5 py-1 ${isEmpty ? FIELD_SLOT_EMPTY_CLASS : FIELD_SLOT_FILLED_CLASS}`}>
                    <span className={isEmpty ? FIELD_READONLY_EMPTY_CLASS : FIELD_READONLY_VALUE_CLASS}>{isEmpty ? '—' : String(value)}</span>
                  </div>
                )}
              </div>
            );
          })}
                        </div>
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
              <div className="pointer-events-auto relative bds-filterbar">
                <button onClick={() => setShowDeleteConfirm(true)} className="bds-btn bds-btn-ghost bds-btn-icon" title="归档此单">
                  <Trash2 size={17} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Mobile Options Sheet */}
      {isMobile && (
        <BottomSheet
          isOpen={!!showOptionsSheet}
          onClose={() => setShowOptionsSheet(null)}
          title="订单操作"
          height="auto"
          isDarkMode={isDarkMode}
        >
          <div className="space-y-2 py-2">
            <button
              onClick={() => {
                if (showOptionsSheet) {
                  onSelectOrder(showOptionsSheet);
                  setIsEditing(true);
                  setEditForm({ ...showOptionsSheet });
                  setEditLineForm(showOptionsSheet?.lines?.[0] ? { ...showOptionsSheet.lines[0] } as Partial<OrderLineItem> : null);
                  setShowOptionsSheet(null);
                }
              }}
              className={`w-full p-4 rounded-inset flex items-center gap-4 text-left font-light bg-[var(--bg-sunken)] ${TXT_SECONDARY}`}
            >
              <div className={`p-2 rounded-2xl bg-[var(--hover-darken)] ${TXT_MUTED}`}><Edit2 size={18} /></div>
              编辑详情
            </button>
            <div className="p-4 rounded-inset space-y-4 bg-[var(--bg-sunken)]">
              <div className={`text-[10px] font-light uppercase tracking-widest ${TXT_FAINT}`}>快速状态变更</div>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                {['Confirmed', 'Production', 'Shipping', 'Delivered'].map(st => (
                  <button
                    key={st}
                    onClick={async () => {
                      if (showOptionsSheet) {
                        try {
                          const updated = await apiService.transitionOrderStatus(showOptionsSheet.id, st, 'mobile-user');
                          const nextOrders = orders.map(o => o.id === updated.id ? updated : o);
                          setOrders(nextOrders, updated);
                        } catch (e: any) {
                          alert(e?.message || '状态变更失败');
                        }
                        setShowOptionsSheet(null);
                      }
                    }}
                    className={`bds-badge cursor-pointer !px-4 !py-2 uppercase ${STATUS_BADGE_VARIANT[st] ?? 'neutral'}`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => {
                if (showOptionsSheet) {
                  onSelectOrder(showOptionsSheet);
                  setShowDeleteConfirm(true);
                  setShowOptionsSheet(null);
                }
              }}
              className="w-full p-4 rounded-inset flex items-center gap-4 text-left font-light bg-[var(--danger-tint)] text-[var(--danger-text)]"
            >
              <div className="p-2 rounded-2xl bg-[var(--danger-tint-hover)] text-[var(--danger-text)]"><Trash2 size={18} /></div>
              归档订单
            </button>
          </div>
        </BottomSheet>
      )}

      {/* Add Order Sheet (Mobile) & Modal (Desktop) */}
      {isMobile ? (
        <BottomSheet
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="录入新生产任务"
          height="full"
          isDarkMode={isDarkMode}
        >
          <div className="space-y-6 pb-20">
            {fieldsForManualForm(manualTypeKey).map(({ cluster, fields }) => (
              <OrderClusterBlock
                key={cluster.id}
                cluster={cluster}
                fields={fields}
                order={newOrder}
                isDarkMode={isDarkMode}
                density="compact"
                relations={relations}
                onCreateRelation={onCreateRelation}
                onRelationSelected={handleNewRelationSelected}
                onChange={(patch) => setNewOrder((prev) => applyAmountLinkage(prev, patch) as Partial<Order>)}
              />
            ))}
            <button onClick={handleAddOrder} className="bds-btn bds-btn-primary lg w-full mt-4 uppercase tracking-widest">确认创建</button>
          </div>
        </BottomSheet>
      ) : (
        showAddModal && (
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
                <div className="pointer-events-auto relative bds-filterbar">
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
                    <X size={17} strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="absolute inset-0 z-10 overflow-hidden">
                <div className="h-full px-5 pt-24">
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
        )
      )}

      {showDeleteConfirm && (
        <div className="bds-modal-mask !absolute !z-[100] animate-in fade-in duration-300 pointer-events-auto">
          <div className="bds-modal overflow-hidden animate-in zoom-in duration-300">
            <div className="text-center space-y-6">
              <div className={`w-20 h-20 rounded-field flex items-center justify-center mx-auto mb-2 border ${BORDER_SUBTLE_CLASS} bg-[var(--bg-sunken)]`}>
                <AlertTriangle size={32} strokeWidth={1} className="text-[var(--warning)]" />
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
                  className="bds-btn bds-btn-danger min-w-[120px] px-6"
                >
                  确认归档
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="bds-btn bds-btn-ghost min-w-[120px] px-6"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 一键溯源侧边面板 */}
      {showTracePanel && selectedOrder?.id && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setShowTracePanel(false)}
        >
          <div className="absolute inset-0" style={{ background: 'var(--mask-bg)' }} />
          <div
            className={`relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-[var(--border-c-strong)] bg-bds-card/95 backdrop-blur-xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between border-b px-4 py-3 ${BORDER_SUBTLE_CLASS}`}>
              <div className="flex items-center gap-2">
                <GitBranch size={15} className={TXT_SECONDARY} />
                <span className={`text-sm font-light ${TXT_TITLE}`}>订单履约链溯源</span>
                <span className={`text-[10px] font-light tracking-[0.14em] ${TXT_FAINT}`}>Order Fulfillment</span>
              </div>
              <button
                type="button"
                onClick={() => setShowTracePanel(false)}
                className="bds-btn bds-btn-ghost bds-btn-icon"
              >
                <X size={15} />
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
    </div>
  );
};

export default OrderManager;
