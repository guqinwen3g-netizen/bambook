
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Order, KnowledgeItem, ResolutionStrategy, PoItem, Relation, OrderLineItem, OrderLineLite, OrderStatusTransition, View } from '../types';
import { apiService } from '../services/apiService';
import {
  Plus, Filter, Clock, ArrowRight, MoreHorizontal,
  Building2, X, AlertCircle, Sparkles, Loader2,
  Trash2, Edit2, Save, Calendar, User, Package, Hash,
  CloudUpload, Trash, AlertTriangle,
  Globe, List, MoreVertical, Activity, Shirt, Database, RefreshCw,
  Upload, ShoppingCart, ClipboardCheck, Ship, CheckCircle2
} from 'lucide-react';
import BottomSheet from './ui/BottomSheet';
import ImportWizard from './import/ImportWizard';
import { ParsedOrder, SavedOrderRow } from '../types';
import { saveParsedOrders, updateOrderFields } from '../services/importService';
import { createOrderLine, updateOrderLineFields } from '../services/orderLineService';
import OrderClusterBlock from './order/OrderClusterBlock';
import OrderLinesTable from './order/OrderLinesTable';
import { useGlassSurfaceEdgeMasks } from './ui/useGlassSurfaceEdgeMasks';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { ProductionPipeline } from './ProductionPipeline';
import { ProductionAlerts } from './ProductionAlerts';
import { PageHeader } from './ui/PageHeader';
import { CompiledTableShell } from './ui/osCompiler/compiledPrimitives';
import { CompiledMotionInteractiveCard, CompiledSurfacePanel } from './ui/osCompiler/compiledSurfacePrimitives';
import RelatedEntitiesPanel from './RelatedEntitiesPanel';
import AuditHistorySection from './AuditHistorySection';
import OrderContextSection from './order/OrderContextSection';
import { fieldsForDetail, fieldsForManualForm, requiredKeysForManual, computeAutoFillPatch, fieldMetaByKey, ORDER_CLUSTERS } from '../lib/orderSchema';
import type { RoleFkTarget } from '../lib/orderSchema';
import { flattenOrderLines, getNextItemNo } from '../lib/orderLineItems';
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
    type: (row.type === 'Garment' ? 'Garment' : 'Fabric') as Order['type'],
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
  orderType: 'fabric' | 'garment'; // 区分订单类型
  onOrderTypeChange?: (type: 'fabric' | 'garment') => void; // Tab 切换回调
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
const ORDER_TYPE_LABELS: Record<'fabric' | 'garment', string> = {
  fabric: '面料',
  garment: '成衣',
};

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

  // Fabric 订单录入表单的默认值
  const getDefaultNewOrder = (): Partial<Order> => ({
    id: `FAB-${Date.now().toString().slice(-6)}`,
    status: 'Pending',
    type: 'Fabric',
    quantity: 0,
    quoteAmount: 0,
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
  });

  const [newOrder, setNewOrder] = useState<Partial<Order>>(getDefaultNewOrder());

  const resetNewOrder = () => setNewOrder(getDefaultNewOrder());


  // 只显示未删除且类型与当前 Tab 匹配的订单
  // Capsule 子视图：成衣 Tab 下的业务线透镜（capsuleOnly 仅 garment 生效；未标记订单归大货）
  const [capsuleOnly, setCapsuleOnly] = useState(false);
  const capsuleActive = orderType === 'garment' && capsuleOnly;
  const filteredOrders = orders.filter(o =>
    !o.deletedAt &&
    o.type === (orderType === 'garment' ? 'Garment' : 'Fabric') &&
    (!capsuleActive || o.businessLine === 'capsule'),
  );
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [orderFilterStatus, setOrderFilterStatus] = useState<string>('all');

  const lineItems = useMemo(() => {
    let items = flattenOrderLines(orders).filter(item => item.order?.type === (orderType === 'garment' ? 'Garment' : 'Fabric'));
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
  }, [orders, orderType, capsuleActive, orderSearchTerm, orderFilterStatus]);

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
    const required = requiredKeysForManual();
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
        unit: 'Meter',
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

  const getStatusStyles = (status: Order['status']) => {
    if (isDarkMode) {
      // Dark mode: muted/desaturated colors, avoiding high saturation
      switch (status) {
        case 'Alert': return 'text-white/55 bg-white/[0.06] border-white/[0.08]';
        case 'Delivered': return 'text-white/70 bg-white/[0.06] border-white/[0.08]';
        case 'Production': return 'text-white/70 bg-white/[0.06] border-white/[0.08]';
        case 'Shipping': return 'text-white/70 bg-white/[0.06] border-white/[0.08]';
        default: return 'text-slate-400 bg-slate-700/40 border-slate-600/30';
      }
    }
    switch (status) {
      case 'Alert': return 'text-slate-600 bg-slate-100/60 border-slate-200';
      case 'Delivered': return 'text-slate-600 bg-slate-100/60 border-slate-200';
      case 'Production': return 'text-slate-600 bg-slate-100/60 border-slate-200';
      case 'Shipping': return 'text-slate-600 bg-slate-100/60 border-slate-200';
      default: return 'text-slate-500 bg-slate-50 border-slate-100';
    }
  };

  const desktopFullscreenOpen = !isMobile && (showAddModal || !!selectedOrder);
  const effectiveViewMode = allowGlobeView ? viewMode : 'list';
  const toolbarSurfaceClass = isDarkMode ? BAMBOOK_OS.controls.toolbar.surfaceDark : BAMBOOK_OS.controls.toolbar.surfaceLight;
  const toolbarControlClass = isDarkMode
    ? 'bg-transparent text-white/46 shadow-none hover:bg-transparent hover:text-white/76 active:translate-y-[1px]'
    : 'bg-transparent text-slate-500 shadow-none hover:bg-transparent hover:text-slate-900 active:translate-y-[1px]';
  const toolbarSelectedClass = isDarkMode
    ? 'bg-white/[0.050] text-white/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]'
    : 'bg-white/42 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.52)]';
  const titleActionClass = isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light;
  const orderTableHeaderClass = isDarkMode
    ? `${BAMBOOK_OS.controls.table.headerDark} text-white/42`
    : `${BAMBOOK_OS.controls.table.headerLight} text-slate-500`;
  const orderTableRowClass = isDarkMode
    ? `${BAMBOOK_OS.controls.table.rowHoverDark} text-white/70`
    : `${BAMBOOK_OS.controls.table.rowHoverLight} text-slate-700`;
  const orderTableRowSeparatorClass = isDarkMode ? BAMBOOK_OS.controls.table.rowSeparatorDark : BAMBOOK_OS.controls.table.rowSeparatorLight;
  const orderTableSelectedClass = isDarkMode
    ? BAMBOOK_OS.controls.selectedSurface.dark
    : BAMBOOK_OS.controls.selectedSurface.light;
  const overlayToolbarClass = `${BAMBOOK_OS.controls.toolbar.base} !w-auto !min-w-0 ${toolbarSurfaceClass}`;
  const overlayToolbarContentClass = `${BAMBOOK_OS.controls.toolbar.content} !gap-2 !px-2`;
  const overlayActionClass = `flex h-8 items-center gap-2 rounded-full border px-3 text-[11px] font-light tracking-wide transition-all ${titleActionClass}`;
  const overlayIconActionClass = `flex h-8 w-8 items-center justify-center rounded-control border transition-all ${titleActionClass}`;
  const overlayPrimaryActionClass = isDarkMode
    ? 'border-white/[0.08] bg-white/[0.04] text-white/65 hover:bg-white/[0.07]'
    : 'border-slate-300/40 bg-slate-100/50 text-slate-600 hover:bg-slate-100/70';
  const overlayBlueActionClass = isDarkMode
    ? 'border-white/[0.08] bg-white/[0.04] text-white/65 hover:bg-white/[0.07]'
    : 'border-slate-300/40 bg-slate-100/50 text-slate-600 hover:bg-slate-100/70';
  const overlayDividerClass = isDarkMode ? 'bg-white/10' : 'bg-slate-300/40';
  const overlayKickerClass = isDarkMode ? 'text-white/32' : 'text-slate-400';
  const overlayTitleClass = isDarkMode ? 'text-slate-50' : 'text-slate-950';
  const overlayMutedClass = isDarkMode ? 'text-white/42' : 'text-slate-500';
  const overlayMapPanelClass = 'p-4 bambook-relations-form-map-panel';
  const overlayFormPanelClass = 'scroll-mt-28 p-5 bambook-relations-form-panel';
  const overlayMapButtonClass = `w-full text-left rounded-full border px-3 py-3 transition-all ${titleActionClass}`;
  const overlayMapIndexClass = isDarkMode
    ? 'bg-white/[0.035] border-white/[0.06] text-white/58'
    : 'bg-white/55 border-white/60 text-slate-500';
  const detailSections = fieldsForDetail();
  const manualSections = fieldsForManualForm();

  // Capsule 子视图：三路订单类型切换（面料 / 成衣 / Capsule）。Capsule = 成衣 + businessLine==='capsule' 透镜；
  // 未标记业务线的成衣订单归大货透镜（businessLine null 语义）。
  const renderOrderTypeSwitcher = (buttonClass: (active: boolean) => string) => (
    <>
      {(['fabric', 'garment'] as const).map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => { setCapsuleOnly(false); onOrderTypeChange?.(type); }}
          className={buttonClass(orderType === type && !capsuleActive)}
        >
          {ORDER_TYPE_LABELS[type]}
        </button>
      ))}
      <button
        type="button"
        onClick={() => { onOrderTypeChange?.('garment'); setCapsuleOnly(true); }}
        className={buttonClass(capsuleActive)}
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
        isDarkMode={isDarkMode}
        hidden={desktopFullscreenOpen}
        className="pointer-events-auto"
        center={(
          <div className={`hidden md:block ${BAMBOOK_OS.controls.toolbar.base} max-w-[460px] ${toolbarSurfaceClass}`}>
            <span className={BAMBOOK_OS.controls.toolbar.ambient} aria-hidden="true" />
            <div className={`${BAMBOOK_OS.controls.toolbar.content} !gap-2 !px-2`}>
              <div className="flex h-8 min-w-0 items-center gap-0.5">
                {renderOrderTypeSwitcher((active) => `h-8 rounded-full px-2.5 text-[10px] font-light tracking-wide transition-all ${active ? toolbarSelectedClass : toolbarControlClass}`)}
              </div>
              <div className={`h-3.5 w-px shrink-0 ${isDarkMode ? 'bg-white/10' : 'bg-slate-300/40'}`} />
              <input
                type="text"
                value={orderSearchTerm}
                onChange={e => setOrderSearchTerm(e.target.value)}
                placeholder="搜索订单号/客户/品号..."
                className={`h-8 w-32 rounded-control border-0 px-2 text-[10px] font-light outline-none placeholder:opacity-50 ${isDarkMode ? 'bg-white/5 text-white/80' : 'bg-slate-100/80 text-slate-700'}`}
              />
              <select
                value={orderFilterStatus}
                onChange={e => setOrderFilterStatus(e.target.value)}
                className={`h-8 rounded-control border-0 px-1.5 text-[10px] font-light outline-none ${isDarkMode ? 'bg-white/5 text-white/80' : 'bg-slate-100/80 text-slate-700'}`}
              >
                <option value="all">全部状态</option>
                <option value="Pending">待确认</option>
                <option value="Confirmed">已确认</option>
                <option value="Production">生产中</option>
                <option value="Shipping">发货中</option>
                <option value="Delivered">已交付</option>
                <option value="Alert">异常</option>
              </select>
              <div className={`h-3.5 w-px shrink-0 ${isDarkMode ? 'bg-white/10' : 'bg-slate-300/40'}`} />
              <div className="flex h-8 items-center gap-0.5">
                {allowGlobeView && (
                  <button
                    type="button"
                    title="地球视图"
                    onClick={() => onViewModeChange('globe')}
                    className={`flex h-8 w-7 items-center justify-center rounded-full transition-all ${effectiveViewMode === 'globe' ? toolbarSelectedClass : toolbarControlClass}`}
                  >
                    <Globe size={14} strokeWidth={1.5} />
                  </button>
                )}
                <button
                  type="button"
                  title="列表视图"
                  onClick={() => onViewModeChange('list')}
                  className={`flex h-8 w-7 items-center justify-center rounded-full transition-all ${effectiveViewMode === 'list' ? toolbarSelectedClass : toolbarControlClass}`}
                >
                  <List size={14} strokeWidth={1.5} />
                </button>
              </div>
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
                  className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all ${effectiveViewMode === 'globe' ? toolbarSelectedClass : titleActionClass}`}
                >
                  <Globe size={15} strokeWidth={1.5} />
                </button>
              )}
              <button
                type="button"
                title="列表视图"
                onClick={() => onViewModeChange('list')}
                className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all ${effectiveViewMode === 'list' ? toolbarSelectedClass : titleActionClass}`}
              >
                <List size={15} strokeWidth={1.5} />
              </button>
            </div>
            {!isMobile && (
              <button
                type="button"
                onClick={() => setShowImportWizard(true)}
                className={`flex h-9 items-center gap-2 rounded-full border px-3 text-[11px] font-light tracking-wide transition-all ${titleActionClass}`}
              >
                <Upload size={14} strokeWidth={1.5} /> 导入
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className={`flex h-9 items-center gap-2 rounded-full border px-3 text-[11px] font-light tracking-wide transition-all ${titleActionClass}`}
            >
              <Plus size={14} strokeWidth={1.5} /> {!isMobile && '录入订单'}
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

      {/* Mobile order type switcher */}
      {effectiveViewMode === 'list' && !desktopFullscreenOpen && isMobile && (
        <div className={`h-12 px-5 flex items-center justify-start border-b pointer-events-auto ${isDarkMode ? 'bg-transparent border-white/5' : 'bg-transparent border-white/10'} ${isMobile ? 'overflow-x-auto px-4 no-scrollbar' : ''}`}>
          <div className="flex gap-2">
            {/* Fabric/Garment/Capsule Tab Switcher */}
            {renderOrderTypeSwitcher((active) => `h-8 shrink-0 rounded-full px-4 text-[10px] font-light tracking-wide transition-all ${active ? toolbarSelectedClass : toolbarControlClass}`)}
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

            {/* Floating Fabric/Garment/Capsule Tab for Globe Mode */}
            <div className={`absolute top-6 left-1/2 z-10 block w-[252px] -translate-x-1/2 pointer-events-auto md:hidden ${BAMBOOK_OS.controls.toolbar.base} ${toolbarSurfaceClass}`}>
              <span className={BAMBOOK_OS.controls.toolbar.ambient} aria-hidden="true" />
              <div className={BAMBOOK_OS.controls.toolbar.content}>
                {renderOrderTypeSwitcher((active) => `h-8 flex-1 rounded-full px-3 text-[10px] font-light tracking-wide transition-all ${active ? toolbarSelectedClass : toolbarControlClass}`)}
              </div>
            </div>
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
                      className={`relative p-5 bambook-card-glass overflow-hidden transition-all touch-active ${selectedOrder?.id === order.id ? 'ring-2 ring-[var(--os-vnext-brand-blue)]' : ''}`}
                    >
                      {/* Quick Action Trigger */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowOptionsSheet(order); }}
                        className={`absolute top-4 right-4 p-2 rounded-full z-10 transition-colors ${isDarkMode ? 'text-slate-400 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-100'}`}
                      >
                        <MoreHorizontal size={20} strokeWidth={1} />
                      </button>

                      {/* Card Header: Order ID & Status */}
                      <div className="flex justify-between items-start mb-4 pr-8">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-2 h-2 rounded-full ${order.type === 'Fabric' ? 'bg-[var(--os-vnext-brand-blue)]' : 'bg-[var(--os-vnext-brand-blue)]'}`}></div>
                            <span className={`text-[10px] font-light uppercase tracking-widest ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}`}>{order.type}</span>
                            {order.businessLine === 'capsule' && (
                              <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-light leading-none tracking-wide ${isDarkMode ? 'border-white/[0.10] text-white/55' : 'border-slate-300/70 text-slate-500'}`}>Capsule</span>
                            )}
                          </div>
                          <span className={`text-lg font-light font-mono tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{order.id}</span>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[9px] font-light uppercase tracking-widest border ${getStatusStyles(order.status)}`}>
                          {order.status}
                        </span>
                      </div>

                      {/* Card Body: Factory & Value */}
                      <div className="flex justify-between items-end mb-4">
                        <div>
                          <div className={`text-[10px] font-light mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>FACTORY</div>
                          <div className={`text-sm font-light flex items-center gap-1.5 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                            <Building2 size={12} /> {order.millName}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-[10px] font-light mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>VALUE</div>
                          <div className={`text-xl font-light ${isDarkMode ? 'text-white bg-gradient-to-r from-[var(--os-vnext-brand-blue-strong)] to-[var(--os-vnext-brand-blue)] bg-clip-text text-transparent' : 'text-slate-900'}`}>
                            ${order.quoteAmount.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {/* Card Footer: Progress Bar */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[9px] font-light uppercase tracking-widest text-slate-400">
                          <span>Progress</span>
                          <span>{order.status === 'Delivered' ? '100%' : order.status === 'Shipping' ? '85%' : order.status === 'Production' ? '60%' : order.status === 'Confirmed' ? '25%' : order.status === 'Alert' ? '异常' : '10%'}</span>
                        </div>
                        <div className={`h-1.5 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${order.status === 'Alert' ? 'bg-slate-400 w-[30%]' :
                              order.status === 'Delivered' ? 'bg-[var(--os-vnext-brand-blue-strong)] w-full' :
                                order.status === 'Shipping' ? 'bg-[var(--os-vnext-brand-blue)] w-[85%]' : order.status === 'Production' ? 'bg-[rgb(var(--os-vnext-brand-blue-rgb))] w-[60%]' : order.status === 'Confirmed' ? 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.6)] w-[25%]' : 'bg-[var(--os-vnext-brand-blue)] w-[10%]'
                              }`}
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
                <div className={BAMBOOK_OS.layout.desktopPageFrameClass}>
                <div className={BAMBOOK_OS.layout.desktopPanelRowClass}>
                <CompiledTableShell
                  isDarkMode={isDarkMode}
                  scrollRef={orderListScrollRef}
                  useSidePanelContainer
                  shellBaseClassName="h-full min-h-0 overflow-visible"
                  panelClassName={BAMBOOK_OS.layout.relationsTablePanelClass}
                  panelContentClassName={`${BAMBOOK_OS.layout.relationsTablePanelContentClass} overflow-hidden`}
                  scrollClassName="overflow-x-auto overscroll-contain"
                  edgeFade={{ topHeight: 22, topFadeStartOffset: 0, bottomHeight: 42 }}
                  header={(
                    <table className={`${BAMBOOK_OS.layout.relationsTableHeaderTableClass} ${ORDER_TABLE_WIDTH_CLASS}`}>
                      <colgroup>
                        {ORDER_TABLE_COLUMN_WIDTH_CLASSES.map((widthClass, index) => (
                          <col key={index} className={widthClass} />
                        ))}
                      </colgroup>
                      <thead className={isDarkMode ? 'text-white/42' : 'text-slate-500'}>
                        <tr>
                          {ORDER_TABLE_HEADERS.map((header) => (
                            <th key={header.label} className={`${BAMBOOK_OS.layout.relationsTableHeaderCellClass} ${orderTableHeaderClass} ${header.align ?? ''}`}>
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
                      <div className={`flex min-h-[360px] flex-col items-center justify-center gap-4 px-6 text-center ${isDarkMode ? 'text-white/35' : 'text-slate-400'}`}>
                        <Package size={44} strokeWidth={1} className={isDarkMode ? 'text-white/24' : 'text-slate-300'} />
                        {capsuleActive ? (
                          <>
                            <p className="text-xs font-light tracking-wide">暂无 Capsule 订单</p>
                            <p className={`text-[11px] font-light leading-relaxed ${isDarkMode ? 'text-white/28' : 'text-slate-400'}`}>在成衣订单详情中将业务线标记为 Capsule 后，订单将在此子视图集中呈现</p>
                          </>
                        ) : (
                          <p className="text-xs font-light tracking-wide">无匹配生产任务数据</p>
                        )}
                      </div>
                    ) : lineItems.map((item, idx) => {
                      const clientCode = item.materialCode || item.order.clientCode || '-';
                      const colorCode = item.millQuality || item.order.productColorCode || '-';
                      const description = item.description || item.cloth || item.order.product || '-';
                      const exMill = item.exMillDate || item.order.clientDate || item.order.dueDate || '-';
                      const amountLabel = `${item.salesCurrency || '$'} ${(item.amount ?? 0).toLocaleString()}`;
                      const primaryText = `truncate text-[13px] font-light leading-[1.25] tracking-normal ${isDarkMode ? 'text-slate-100' : 'text-slate-950'}`;
                      const regularText = `truncate text-[13px] font-light leading-[1.25] tracking-normal ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`;
                      const secondaryText = `mt-1 truncate text-[11px] font-light leading-[1.2] tracking-normal ${isDarkMode ? 'text-white/42' : 'text-slate-500'}`;
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
                          spotlightColor={isDarkMode ? BAMBOOK_OS.spotlight.cardDarkColor : BAMBOOK_OS.spotlight.cardLightColor}
                          spotlightSize={isDarkMode ? BAMBOOK_OS.spotlight.cardDarkSize : BAMBOOK_OS.spotlight.cardLightSize}
                          idleSpotlightOpacity={0}
                          liquidSpotlight
                          liquidSpotlightTone="light"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          whileHover={{ y: -1, transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] } }}
                          transition={{ delay: idx * 0.02 }}
                          className={`group relative grid w-full cursor-pointer ${ORDER_TABLE_ROW_CLASS} ${ORDER_TABLE_GRID_CLASS} overflow-hidden text-xs transition-[background,color,box-shadow,border-color,transform] duration-200 ${isSelected ? orderTableSelectedClass : orderTableRowClass}`}
                        >
                          <span className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 h-px ${orderTableRowSeparatorClass}`} aria-hidden="true" />
                          <div className={cellClass}>
                            <div className="flex items-center gap-1.5">
                              <p className={`${primaryText} min-w-0`}>{item.displayId}</p>
                              {item.order.businessLine === 'capsule' && (
                                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-light leading-none tracking-wide ${isDarkMode ? 'border-white/[0.10] text-white/55' : 'border-slate-300/70 text-slate-500'}`}>Capsule</span>
                              )}
                            </div>
                            <p className={secondaryText}>{item.customer || '-'}</p>
                          </div>
                          <div className={cellClass}>
                            <p className={regularText}>{clientCode}</p>
                            <p className={secondaryText}>行号 {item.displayItemNo}</p>
                          </div>
                          <div className={cellClass}>
                            <p className={regularText}>{description}</p>
                            <p className={secondaryText}>色号 {colorCode}</p>
                          </div>
                          <div className={`${cellClass} text-right`}>
                            <p className={primaryText}>{(item.quantity ?? 0).toLocaleString()}</p>
                            <p className={secondaryText}>{amountLabel}</p>
                          </div>
                          <div className={cellClass}>
                            <p className={regularText}>{exMill}</p>
                            <p className={secondaryText}>订单 {item.poDate || '-'}</p>
                          </div>
                          <div className={cellClass}>
                            <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] font-light leading-none tracking-normal ${getStatusStyles(item.status)}`}>
                              <span className="truncate">{item.status}</span>
                            </span>
                            <p className={secondaryText}>查看详情</p>
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
                <div className="p-20 text-center flex flex-col items-center justify-center gap-4">
                  <Package size={60} strokeWidth={1} className="text-slate-100" />
                  <p className="text-xs font-light text-slate-300 uppercase tracking-widest">{capsuleActive ? '暂无 Capsule 订单' : '无匹配生产任务数据'}</p>
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
            <div className="absolute inset-x-0 top-0 z-30 px-7 pt-5 pb-3 flex items-center justify-between pointer-events-none">
              <div className="min-w-0">
                <p className={`text-[10px] font-light uppercase tracking-[0.24em] ${overlayKickerClass}`}>Production Detail</p>
                <div className="mt-1 flex min-w-0 items-baseline gap-3">
                  <h2 className={`truncate text-[22px] font-light tracking-[0.12em] uppercase ${overlayTitleClass}`}>{selectedLineItem?.displayId || selectedOrder.poNumber || selectedOrder.id}</h2>
                  <span className={`shrink-0 text-[12px] font-light ${overlayMutedClass}`}>{isEditing ? '编辑模式' : '查阅模式'}</span>
                </div>
              </div>
              <div className={`pointer-events-auto ${overlayToolbarClass}`}>
                <span className={BAMBOOK_OS.controls.toolbar.ambient} aria-hidden="true" />
                <div className={overlayToolbarContentClass}>
                  {isEditing ? (
                    <button onClick={handleSaveEdit} className={`${overlayActionClass} ${overlayPrimaryActionClass}`}>
                      <Save size={14} strokeWidth={1.5} />保存修改
                    </button>
                  ) : (
                    <button onClick={() => { setIsEditing(true); setEditForm(selectedOrder ? { ...selectedOrder } : null); setEditLineForm(selectedLineItem ? { ...selectedLineItem } : null); }} className={overlayActionClass}>
                      <Edit2 size={14} strokeWidth={1.5} />编辑项目
                    </button>
                  )}
                  <div className={`h-4 w-px ${overlayDividerClass}`}></div>
                  <button
                    onClick={() => { onSelectOrder(null); setSelectedLineItem(null); setEditLineForm(null); setIsEditing(false); setEditForm(null); }}
                    className={overlayIconActionClass}
                  >
                    <X size={17} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            </div>

            {/* Scrollable Content Container */}
            <div className="absolute inset-0 z-10 overflow-hidden">
              <div ref={orderDetailScrollRef} className={`h-full overflow-y-auto ${isDarkMode ? 'scrollbar-custom' : ''}`}>
                <div className="grid w-full grid-cols-[240px_minmax(0,1fr)] gap-5 px-5 pt-5 pb-5">
                  <aside className="self-start">
                    <CompiledSurfacePanel materialRole="raisedCard" spotlight isDarkMode={isDarkMode} className={overlayMapPanelClass}>
                      <p className={`px-3 pb-3 text-[10px] font-light uppercase tracking-[0.22em] ${overlayTitleClass}`}>Detail Map</p>
                      <div className="space-y-1">
                        {[
                          { id: 'order-detail-summary', label: '概览', desc: '数量、金额、交期' },
                          { id: 'order-detail-timeline', label: '生产进度', desc: '状态变更时间线' },
                          ...(selectedLineItem ? [{ id: 'order-detail-line', label: '面料项目', desc: selectedLineItem.displayId || selectedLineItem.itemNo || 'Fabric item' }] : []),
                          ...(!selectedLineItem && selectedOrder.lines && selectedOrder.lines.length > 0 ? [{ id: 'order-detail-lines', label: '行明细', desc: `${selectedOrder.lines.length} 行订单项目` }] : []),
                          ...detailSections.map(({ cluster }) => ({ id: `section-${cluster.id}`, label: cluster.labelZh, desc: cluster.labelEn })),
                        ].map((section, idx) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                            className={overlayMapButtonClass}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-light ${overlayMapIndexClass}`}>{idx + 1}</span>
                              <div className="min-w-0">
                                <div className={`truncate text-xs font-light ${overlayTitleClass}`}>{section.label}</div>
                                <div className={`mt-0.5 truncate text-[10px] font-light ${overlayMutedClass}`}>{section.desc}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </CompiledSurfacePanel>
                  </aside>
                  <div className={`min-w-0 space-y-6 ${BAMBOOK_OS.layout.panelShadowViewportClass}`}>
                    {/* Top summary: keep the high-efficiency detail reading surface */}
                    <CompiledSurfacePanel
                      id="order-detail-summary"
                      isDarkMode={isDarkMode}
                      materialRole="raisedCard"
                      edgeFadeItem
                      spotlight
                      className={overlayFormPanelClass}
                      contentClassName="relative z-10"
                      spotlightSizing="width"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-4">
                        {[
                          { label: '项目数量', value: `${(selectedLineItem?.quantity ?? selectedOrder.quantity ?? 0).toLocaleString()} ${selectedLineItem?.unit || (selectedOrder.type === 'Fabric' ? 'M' : 'Pcs')}`, sub: 'Item Quantity' },
                          { label: '项目金额', value: `${selectedOrder.salesCurrency || 'USD'} ${((selectedLineItem?.amount ?? selectedOrder.contractAmount ?? selectedOrder.quoteAmount ?? 0)).toLocaleString()}`, sub: 'Line Amount' },
                          { label: '出厂交期', value: selectedLineItem?.exMillDate || selectedOrder.clientDate || selectedOrder.dueDate || '-', sub: 'Exmill Date' },
                          { label: '客户', value: selectedOrder.customer || '-', sub: 'Customer' },
                        ].map((stat, i) => (
                          <div key={stat.label} className={`px-4 py-2 ${i < 3 ? (isDarkMode ? 'md:border-r md:border-white/[0.06]' : 'md:border-r md:border-slate-200/45') : ''}`}>
                            <p className={`text-[10px] font-light uppercase tracking-[0.22em] ${overlayKickerClass}`}>{stat.sub}</p>
                            <p className={`mt-1.5 truncate text-[17px] font-light tracking-tight ${overlayTitleClass}`}>{stat.value}</p>
                            <p className={`mt-1 text-xs font-light ${overlayMutedClass}`}>{stat.label}</p>
                          </div>
                        ))}
                      </div>
                      {/* Capsule 子视图：成衣订单业务线标记（大货 ⇄ Capsule），编辑模式下隐藏防误触 */}
                      {selectedOrder.type === 'Garment' && !isEditing && (
                        <div className={`mt-2 flex flex-wrap items-center justify-between gap-3 border-t px-4 pt-3 ${isDarkMode ? 'border-white/[0.06]' : 'border-slate-200/45'}`}>
                          <div className="min-w-0">
                            <p className={`text-[10px] font-light uppercase tracking-[0.22em] ${overlayKickerClass}`}>Business Line</p>
                            <p className={`mt-0.5 text-xs font-light ${overlayMutedClass}`}>业务线（Capsule = 设计师小单业务）</p>
                          </div>
                          <div className="flex items-center gap-0.5">
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
                                  className={`h-7 rounded-full px-3 text-[10px] font-light tracking-wide transition-all ${active ? toolbarSelectedClass : toolbarControlClass} ${businessLineSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                        className={overlayFormPanelClass}
                        contentClassName="relative z-10"
                        spotlightSizing="width"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`text-[10px] font-light uppercase tracking-[0.22em] ${overlayKickerClass}`}>Fulfillment Actions</p>
                            <h3 className={`mt-1 text-base font-light tracking-wide ${overlayTitleClass}`}>履约动作</h3>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={handlePrimeProcurement} className={overlayActionClass} title="跳转到采购管理并预填本订单明细">
                              <ShoppingCart size={14} strokeWidth={1.5} />生成采购单
                            </button>
                            <button type="button" onClick={handlePrimeQc} className={overlayActionClass} title="跳转到 QC 工作台并预选本订单">
                              <ClipboardCheck size={14} strokeWidth={1.5} />发起验货
                            </button>
                            <button type="button" onClick={handlePrimeShipment} className={overlayActionClass} title="跳转到出运管理并预填本订单">
                              <Ship size={14} strokeWidth={1.5} />创建出运
                            </button>
                          </div>
                        </div>
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
                      className={overlayFormPanelClass}
                      contentClassName="relative z-10"
                      spotlightSizing="width"
                    >
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <p className={`text-[10px] font-light uppercase tracking-[0.22em] ${overlayKickerClass}`}>Production Timeline</p>
                          <h3 className={`mt-1 text-base font-light tracking-wide ${overlayTitleClass}`}>生产进度时间线</h3>
                        </div>
                      </div>

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
                                    <span className={`h-px w-4 shrink-0 ${isDone || isCurrent ? (isDarkMode ? 'bg-white/25' : 'bg-slate-400/60') : (isDarkMode ? 'bg-white/[0.08]' : 'bg-slate-200')}`} />
                                  )}
                                  <button
                                    type="button"
                                    disabled={!isActionable}
                                    onClick={() => handleStatusTransition(step)}
                                    title={isActionable ? `推进到「${ORDER_STATUS_LABELS[step]}」` : ORDER_STATUS_LABELS[step]}
                                    className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-light tracking-wide transition-all ${
                                      isCurrent
                                        ? isDarkMode ? 'border-white/[0.14] bg-white/[0.08] text-white/88' : 'border-slate-400/70 bg-slate-200/70 text-slate-800'
                                        : isDone
                                          ? isDarkMode ? 'border-white/[0.08] text-white/55' : 'border-slate-200/60 text-slate-500'
                                          : isActionable
                                            ? isDarkMode ? 'border-white/[0.10] text-white/70 hover:bg-white/[0.05]' : 'border-slate-300/70 text-slate-600 hover:bg-slate-100/70'
                                            : isDarkMode ? 'border-white/[0.05] text-white/25 cursor-not-allowed' : 'border-slate-200/40 text-slate-300 cursor-not-allowed'
                                    }`}
                                  >
                                    {isDone && <CheckCircle2 size={11} strokeWidth={1.5} className={isDarkMode ? 'text-white/55' : 'text-slate-500'} />}
                                    {ORDER_STATUS_LABELS[step]}
                                  </button>
                                </React.Fragment>
                              );
                            })}
                            {/* Alert 异常态：非终态可标记异常；异常中可恢复到任一非终态（点击上方步骤） */}
                            <span className={`h-px w-4 shrink-0 ${isDarkMode ? 'bg-white/[0.08]' : 'bg-slate-200'}`} />
                            <button
                              type="button"
                              disabled={isEditing || (!isAlert && !allowed.includes('Alert'))}
                              onClick={() => !isAlert && handleStatusTransition('Alert')}
                              title={isAlert ? '异常中：点击左侧步骤恢复到对应阶段' : '标记为异常'}
                              className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-light tracking-wide transition-all ${
                                isAlert
                                  ? isDarkMode ? 'border-white/[0.14] bg-white/[0.08] text-white/88' : 'border-slate-400/70 bg-slate-200/70 text-slate-800'
                                  : isDarkMode ? 'border-white/[0.06] text-white/45 hover:bg-white/[0.03]' : 'border-slate-200/50 text-slate-400 hover:bg-slate-50'
                              } ${isEditing ? 'cursor-not-allowed opacity-40' : ''}`}
                            >
                              <AlertTriangle size={11} strokeWidth={1.5} />
                              {ORDER_STATUS_LABELS.Alert}
                            </button>
                          </div>
                        );
                      })()}

                      {statusTimeline.length === 0 ? (
                        <p className={`text-xs font-light ${overlayMutedClass}`}>暂无状态变更记录</p>
                      ) : (
                        <div className="space-y-3">
                          {statusTimeline.map((t, idx) => {
                            const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';
                            return (
                              <div key={t.id} className="flex items-start gap-3">
                                <div className="flex flex-col items-center">
                                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${
                                    idx === statusTimeline.length - 1
                                      ? isDarkMode ? 'bg-slate-400' : 'bg-slate-500'
                                      : isDarkMode ? 'bg-slate-600' : 'bg-slate-300'
                                  }`} />
                                  {idx < statusTimeline.length - 1 && (
                                    <div className={`w-px h-4 ${isDarkMode ? 'bg-white/5' : 'bg-slate-200'}`} />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs font-light ${overlayTitleClass}`}>
                                      {t.fromStatus} → {t.toStatus}
                                    </span>
                                    <span className={`text-[9px] ${overlayMutedClass}`}>{dateStr}</span>
                                  </div>
                                  {t.note && <div className={`text-[10px] mt-0.5 ${overlayMutedClass}`}>{t.note}</div>}
                                  {t.operator && <div className={`text-[9px] mt-0.5 ${overlayMutedClass}`}>by {t.operator}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Overdue alert */}
                      {selectedOrder.status === 'Alert' && (
                        <div className={`mt-4 flex items-center gap-2 rounded-control border px-3 py-2 ${
                          isDarkMode ? 'border-white/[0.08] bg-white/[0.06] text-white/65' : 'border-slate-300 bg-slate-100/60 text-slate-600'
                        }`}>
                          <AlertCircle size={14} />
                          <span className="text-xs font-light">此订单已超期，请尽快处理</span>
                        </div>
                      )}
                    </CompiledSurfacePanel>

                    {/* 跨模块关联视图 — 客户/供应商/收货方/销售/跟单等 EntityLink */}
                    <div className="mt-4">
                      <RelatedEntitiesPanel
                        type="order"
                        id={selectedOrder.id}
                        isDarkMode={isDarkMode}
                        title="订单关联视图"
                      />
                    </div>

                    {/* 阶段 D / D3：订单全链路（报价→开发→BOM→采购→生产→外协→出运→财务） */}
                    <div className="mt-4">
                      <OrderContextSection
                        orderId={selectedOrder.id}
                        isDarkMode={isDarkMode}
                        onNavigate={onNavigate}
                      />
                    </div>

                    {/* 阶段 D / D6：订单变更历史（实体审计，模块读权限门禁） */}
                    <div className="mt-4">
                      <AuditHistorySection
                        targetType="Order"
                        targetId={selectedOrder.id}
                        isDarkMode={isDarkMode}
                        title="订单变更历史"
                      />
                    </div>

                    {/* 生产管线 (10阶段门禁引擎) */}
                    <div className="mt-4">
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
                        className={overlayFormPanelClass}
                        contentClassName="relative z-10"
                        spotlightSizing="width"
                      >
                        <div className="mb-4 flex items-center justify-between gap-4">
                          <div>
                            <p className={`text-[10px] font-light uppercase tracking-[0.22em] ${overlayKickerClass}`}>Fabric Item</p>
                            <h3 className={`mt-1 text-base font-light tracking-wide ${overlayTitleClass}`}>面料项目详情</h3>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-[11px] font-light ${isDarkMode ? 'bg-white/[0.035] text-white/62 border-white/[0.06]' : 'bg-white/35 text-slate-500 border-slate-200/45'}`}>{(isEditing && editLineForm ? editLineForm.status : selectedLineItem.status) || 'Pending'}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
                            const value = (isEditing && editLineForm ? (editLineForm as any)[key] : (selectedLineItem as any)[key]) ?? '';
                            return (
                              <label key={key} className="block">
                                <span className={`mb-1 block text-[10px] font-light uppercase tracking-wide ${overlayKickerClass}`}>{label}</span>
                                {isEditing ? (
                                  <input
                                    className={`h-9 w-full rounded-full border px-3 text-xs font-light outline-none transition-all ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`}
                                    value={String(value)}
                                    onChange={(event) => setEditLineForm((prev) => ({ ...(prev ?? selectedLineItem), [key]: ['quantity', 'unitPrice', 'netValue'].includes(key) ? Number(event.target.value) : event.target.value }))}
                                  />
                                ) : (
                                  <p className={`min-h-9 rounded-inset border px-3 py-2 text-xs font-light ${isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light}`}>{String(value || '-')}</p>
                                )}
                              </label>
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
                              setEditForm({ ...editForm, ...patch });
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Footer Action Bar — primary actions live in the header now;
                only destructive 'archive' lingers here for safety distance. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-5 pb-5 pt-10 flex justify-end items-center">
              <div className={`pointer-events-auto ${overlayToolbarClass}`}>
                <span className={BAMBOOK_OS.controls.toolbar.ambient} aria-hidden="true" />
                <div className={overlayToolbarContentClass}>
                  <button onClick={() => setShowDeleteConfirm(true)} className={`flex h-8 w-8 items-center justify-center rounded-control border border-transparent transition-all ${isDarkMode ? 'text-white/35 hover:bg-white/[0.05] hover:text-white/70' : 'text-slate-400 hover:bg-slate-100/70 hover:text-slate-700'}`} title="归档此单">
                    <Trash2 size={17} strokeWidth={1.5} />
                  </button>
                </div>
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
                  setShowOptionsSheet(null);
                }
              }}
              className={`w-full p-4 rounded-inset flex items-center gap-4 text-left font-light ${isDarkMode ? 'bg-slate-800/50 text-slate-200' : 'bg-slate-50 text-slate-700'}`}
            >
              <div className="p-2 bg-white/[0.06] rounded-control text-slate-500"><Edit2 size={18} /></div>
              编辑详情
            </button>
            <div className={`p-4 rounded-inset space-y-4 ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
              <div className="text-[10px] font-light uppercase tracking-widest text-slate-400">快速状态变更</div>
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
                    className={`px-4 py-2 rounded-full text-[10px] uppercase font-light whitespace-nowrap border ${getStatusStyles(st as any)}`}
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
              className={`w-full p-4 rounded-inset flex items-center gap-4 text-left font-light text-slate-600 ${isDarkMode ? 'bg-slate-800/40' : 'bg-slate-100/60'}`}
            >
              <div className="p-2 bg-slate-400/10 rounded-control"><Trash2 size={18} /></div>
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
            {fieldsForManualForm().map(({ cluster, fields }) => (
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
                onChange={(patch) => setNewOrder((prev) => ({ ...prev, ...patch }))}
              />
            ))}
            <button onClick={handleAddOrder} className={`w-full py-5 text-xs font-light uppercase tracking-widest rounded-full mt-4 transition-all ${isDarkMode ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-white/70 border border-slate-200/60 text-slate-700 hover:bg-white/90 hover:text-slate-900'}`}>确认创建</button>
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
              <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-7 pt-5 pb-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className={`text-[10px] font-light uppercase tracking-[0.24em] ${overlayKickerClass}`}>New Fabric Order</p>
                  <div className="mt-1 flex min-w-0 items-baseline gap-3">
                    <h2 className={`truncate text-[22px] font-light tracking-[0.12em] ${overlayTitleClass}`}>录入面料订单</h2>
                    <span className={`shrink-0 text-[12px] font-light ${overlayMutedClass}`}>生产录入</span>
                  </div>
                </div>
                <div className={`pointer-events-auto ${overlayToolbarClass}`}>
                  <span className={BAMBOOK_OS.controls.toolbar.ambient} aria-hidden="true" />
                  <div className={overlayToolbarContentClass}>
                    <button
                      onClick={() => { setShowAddModal(false); setShowImportWizard(true); }}
                      className={`${overlayActionClass} ${overlayBlueActionClass}`}
                    >
                      <Upload size={14} strokeWidth={1.5} /> 导入 PDF
                    </button>
                    <button onClick={handleAddOrder} className={`${overlayActionClass} ${overlayPrimaryActionClass}`}>
                      <Save size={14} strokeWidth={1.5} />确认创建
                    </button>
                    <div className={`h-4 w-px ${overlayDividerClass}`}></div>
                    <button
                      onClick={() => { setShowAddModal(false); resetNewOrder(); }}
                      className={overlayIconActionClass}
                    >
                      <X size={17} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="absolute inset-0 z-10 overflow-hidden">
                <div className="h-full px-5 pt-3">
                  <div className="grid h-full w-full grid-cols-[240px_minmax(0,1fr)] gap-5">
                    <aside className="self-start">
                      <CompiledSurfacePanel materialRole="raisedCard" spotlight isDarkMode={isDarkMode} className={overlayMapPanelClass}>
                        <p className={`px-3 pb-3 text-[10px] font-light uppercase tracking-[0.22em] ${overlayTitleClass}`}>Form Map</p>
                        <div className="space-y-1">
                          {manualSections.map(({ cluster }, idx) => (
                            <button
                              key={cluster.id}
                              type="button"
                              onClick={() => document.getElementById(`section-${cluster.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                              className={overlayMapButtonClass}
                            >
                              <div className="flex items-center gap-3">
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-light ${overlayMapIndexClass}`}>{idx + 1}</span>
                                <div className="min-w-0">
                                  <div className={`truncate text-xs font-light ${overlayTitleClass}`}>{cluster.labelZh}</div>
                                  <div className={`mt-0.5 truncate text-[10px] font-light ${overlayMutedClass}`}>{cluster.labelEn}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </CompiledSurfacePanel>
                    </aside>
                    <div ref={orderEntryScrollRef} className={`min-w-0 overflow-y-auto overscroll-contain space-y-6 pb-32 ${BAMBOOK_OS.layout.panelShadowViewportClass} ${isDarkMode ? 'scrollbar-custom' : ''}`}>
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
                          onChange={(patch) => setNewOrder((prev) => ({ ...prev, ...patch }))}
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
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300 pointer-events-auto">
          <div className="bambook-panel-glass rounded-card w-full max-w-md shadow-none overflow-hidden animate-in zoom-in duration-300">
            <div className="p-10 text-center space-y-6">
              <div className={`w-20 h-20 rounded-control flex items-center justify-center mx-auto mb-2 border ${isDarkMode ? 'bg-white/[0.06] text-white/60 border-white/[0.08]' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                <AlertTriangle size={32} strokeWidth={1} />
              </div>
              <div className="space-y-2">
                <h3 className={`text-xl font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>确认归档生产任务？</h3>
                <p className="text-sm text-slate-400 font-light leading-relaxed">
                  确定要归档此生产任务吗？归档后该订单将从当前生产流中移除并存入历史档案。
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={handleDeleteOrder}
                  className={`w-full py-4 rounded-full text-xs font-light uppercase tracking-widest transition-all ${isDarkMode ? 'bg-slate-800 text-white/90 hover:bg-slate-700 border border-white/[0.08]' : 'bg-slate-800 text-white/90 hover:bg-slate-700'}`}
                >
                  确认归档
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className={`w-full py-4 rounded-full text-xs font-light uppercase tracking-widest transition-all ${isDarkMode ? 'text-slate-400 hover:bg-white/5' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderManager;
