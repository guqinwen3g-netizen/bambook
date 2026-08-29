import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Truck, Plus, Search, X, Pencil, Trash2, ChevronLeft, Save, Loader2, Package, ExternalLink, RefreshCw, Box, Download, Split, Layers } from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import { bdsConfirm } from './ui/BdsDialog';
import { bdsToast } from './ui/bdsToast';
import { hasRole } from '../services/authService';
import { OrderShipmentBatchPanel } from './orders/OrderShipmentBatchPanel';
import {
  CompiledFormMapPanel,
  CompiledFormSectionPanel,
  CompiledModuleTitleBar,
  CompiledMotionInteractiveCard,
  CompiledSurfacePanel,
  CompiledTableShell,
} from './ui/primitives/compiledPrimitives';
import type { Shipment as ShipmentType, ShipmentStatus, ShipmentEvent, ShipmentLine, ShipmentCarton } from '../types';
import { shipmentService } from '../services/shipmentService';
import type { OnTimeStats, MethodStats, ShipmentAllocation } from '../services/shipmentService';
import { apiService } from '../services/apiService';
import { RelatedWorkspacesSection } from './ui/RelatedWorkspacesSection';
import { consumeCrossModuleNav } from '../services/crossModuleNav';
import { NavRelationFilterChip } from './ui/NavRelationFilterChip';

// ── 阶段 IA-3：订单详情下游动作 prime（创建出运预填订单，与 Suppliers preview 同模式） ──
const SHIPMENT_CREATE_PRIME_KEY = 'bambook_shipment_create_prime';

/** R3：主列表服务端分页页大小（后端 /v1/shipping take 上限 200） */
const SHIPMENT_LIST_PAGE_SIZE = 100;

export interface ShipmentCreatePrime {
  orderId: string;
  customerName?: string;
}

export const primeShipmentCreateFromOrder = (prime: ShipmentCreatePrime) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SHIPMENT_CREATE_PRIME_KEY, JSON.stringify(prime));
  } catch {
    // Dev-preview continuity only; ignore storage failures.
  }
};

const readShipmentCreatePrime = (): ShipmentCreatePrime | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SHIPMENT_CREATE_PRIME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShipmentCreatePrime>;
    return typeof parsed.orderId === 'string' && parsed.orderId ? (parsed as ShipmentCreatePrime) : null;
  } catch {
    return null;
  }
};

const clearShipmentCreatePrime = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SHIPMENT_CREATE_PRIME_KEY);
  } catch {
    // ignore
  }
};

interface ShipmentManagerProps {
  isDarkMode: boolean;
  shipments: ShipmentType[];
  setShipments: React.Dispatch<React.SetStateAction<ShipmentType[]>>;
  /** 跨模块导航：运单详情「关联业务」入口页面切换 */
  onNavigate?: (view: import('../types').View) => void;
}

type ShipmentStatusId = 'all' | ShipmentStatus;

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const SHIPMENT_STATUSES: Array<{ id: ShipmentStatusId; label: string }> = [
  { id: 'all', label: '全部状态' },
  { id: 'Draft', label: '草稿' },
  { id: 'Booked', label: '已订舱' },
  { id: 'Loading', label: '装货中' },
  { id: 'Shipped', label: '已发运' },
  { id: 'Arrived', label: '已到港' },
  { id: 'Cleared', label: '已清关' },
  { id: 'Delivered', label: '已交付' },
  { id: 'Cancelled', label: '已取消' },
];

const statusLabelMap = Object.fromEntries(SHIPMENT_STATUSES.map(item => [item.id, item.label])) as Record<ShipmentStatusId, string>;

const tableColumns = [
  { key: 'shipment', label: '货运单' },
  { key: 'status', label: '状态' },
  { key: 'partner', label: '收货方' },
  { key: 'schedule', label: '物流/日期' },
] as const;

const tableGridClass =
  'grid w-full min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,0.78fr)_minmax(0,0.9fr)_minmax(0,1fr)]';

// ── F3 状态引导下拉：镜像后端 server/src/statusTransition.ts SHIPMENT_TRANSITIONS（from → 合法下一步） ──
// 后端 updateShipment 对非法转移 fail-closed（400 INVALID_TRANSITION）；前端下拉只给当前态可选项，不能乱跳。
const SHIPMENT_STATUS_TRANSITIONS: Record<ShipmentStatus, ReadonlyArray<ShipmentStatus>> = {
  Draft: ['Booked', 'Cancelled'],
  Booked: ['Loading', 'Shipped', 'Cancelled'],
  Loading: ['Shipped', 'Cancelled'],
  Shipped: ['Arrived', 'Cancelled'],
  Arrived: ['Cleared', 'Cancelled'],
  Cleared: ['Delivered', 'Cancelled'],
  Delivered: [], // 终态（已交付）
  Cancelled: [], // 终态
};

// 创建入口合法初始态（镜像后端 createShipment：禁止直建终态 Delivered/Cancelled）
const SHIPMENT_CREATE_STATUSES: ReadonlyArray<ShipmentStatus> = ['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared'];

/**
 * F3：状态下拉可选项。
 * - create：仅创建合法初始态（不含 Delivered/Cancelled）
 * - edit：当前态（幂等保留选中）+ 状态机允许的下一步
 */
export function getShipmentFormStatusOptions(mode: 'create' | 'edit', currentStatus?: ShipmentStatus | null): ShipmentStatus[] {
  if (mode === 'create') return [...SHIPMENT_CREATE_STATUSES];
  const current = currentStatus && SHIPMENT_STATUS_TRANSITIONS[currentStatus] ? currentStatus : 'Draft';
  return [current, ...SHIPMENT_STATUS_TRANSITIONS[current]];
}

/** F1：费用币种选项（与 QuotationManager/SupplierInquiryPanel 同一口径） */
const FEE_CURRENCY_OPTIONS = ['USD', 'CNY', 'EUR'];


type ShipmentFormDraft = {
  shipmentNumber: string;
  type: string;
  status: string;
  shippingMethod: string;
  bookingDate: string;
  etd: string;
  eta: string;
  vesselOrFlight: string;
  voyageNumber: string;
  portOfLoading: string;
  portOfDischarge: string;
  containerNumber: string;
  sealNumber: string;
  trackingNumber: string;
  carrierTrackingUrl: string;
  totalPackages: string;
  grossWeight: string;
  netWeight: string;
  volume: string;
  freightAmount: string;
  freightCurrency: string;
  insuranceAmount: string;
  insuranceCurrency: string;
  customsAmount: string;
  customsCurrency: string;
  otherCharges: string;
  otherChargesCurrency: string;
  customerName: string;
  carrierName: string;
  orderId: string;
  notes: string;
};

const createEmptyDraft = (): ShipmentFormDraft => ({
  shipmentNumber: '',
  type: 'Export',
  status: 'Draft',
  shippingMethod: 'Sea',
  bookingDate: '',
  etd: '',
  eta: '',
  vesselOrFlight: '',
  voyageNumber: '',
  portOfLoading: '',
  portOfDischarge: '',
  containerNumber: '',
  sealNumber: '',
  trackingNumber: '',
  carrierTrackingUrl: '',
  totalPackages: '',
  grossWeight: '',
  netWeight: '',
  volume: '',
  freightAmount: '',
  freightCurrency: 'USD',
  insuranceAmount: '',
  insuranceCurrency: 'USD',
  customsAmount: '',
  customsCurrency: 'USD',
  otherCharges: '',
  otherChargesCurrency: 'USD',
  customerName: '',
  carrierName: '',
  orderId: '',
  notes: '',
});

const draftFromShipment = (s: ShipmentType): ShipmentFormDraft => ({
  shipmentNumber: s.shipmentNumber || '',
  type: s.type || 'Export',
  status: s.status || 'Draft',
  shippingMethod: s.shippingMethod || 'Sea',
  bookingDate: s.bookingDate || '',
  etd: s.etd || '',
  eta: s.eta || '',
  vesselOrFlight: s.vesselOrFlight || '',
  voyageNumber: s.voyageNumber || '',
  portOfLoading: s.portOfLoading || '',
  portOfDischarge: s.portOfDischarge || '',
  containerNumber: s.containerNumber || '',
  sealNumber: s.sealNumber || '',
  trackingNumber: s.trackingNumber || '',
  carrierTrackingUrl: s.carrierTrackingUrl || '',
  totalPackages: s.totalPackages != null ? String(s.totalPackages) : '',
  grossWeight: s.grossWeight != null ? String(s.grossWeight) : '',
  netWeight: s.netWeight != null ? String(s.netWeight) : '',
  volume: s.volume != null ? String(s.volume) : '',
  freightAmount: s.freightAmount != null ? String(s.freightAmount) : '',
  freightCurrency: s.freightCurrency || 'USD',
  insuranceAmount: s.insuranceAmount != null ? String(s.insuranceAmount) : '',
  insuranceCurrency: s.insuranceCurrency || 'USD',
  customsAmount: s.customsAmount != null ? String(s.customsAmount) : '',
  customsCurrency: s.customsCurrency || 'USD',
  otherCharges: s.otherCharges != null ? String(s.otherCharges) : '',
  otherChargesCurrency: s.otherChargesCurrency || 'USD',
  customerName: s.customerName || '',
  carrierName: s.carrierName || '',
  orderId: s.orderId || '',
  notes: s.notes || '',
});

interface ShipmentFormFieldConfig {
  name: keyof ShipmentFormDraft;
  label: string;
  type: 'text' | 'select' | 'textarea';
  options?: ReadonlyArray<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  fullSpan?: boolean;
  /** R6：编辑态禁用（身份字段创建后不可改；后端 PATCH 白名单亦不收，防止「可编辑但静默丢弃」） */
  disabledInEdit?: boolean;
}

const SHIPMENT_FORM_SECTIONS: Array<{ id: string; title: string; desc: string; fields: ShipmentFormFieldConfig[] }> = [
  {
    id: 'shipment-basic',
    title: '基本信息',
    desc: '运单号、状态、运输方式',
    fields: [
      { name: 'shipmentNumber', label: '运单号', type: 'text', required: true, placeholder: 'SHIP-2026-001', disabledInEdit: true },
      // F3：options 为占位，渲染时按状态机动态替换为「当前态 + 合法下一步」（见 renderShipmentField）
      { name: 'status', label: '状态', type: 'select', required: true, options: [] },
      { name: 'shippingMethod', label: '运输方式', type: 'text' },
    ],
  },
  {
    id: 'shipment-logistics',
    title: '物流信息',
    desc: '承运人、跟踪号、港口',
    fields: [
      { name: 'carrierName', label: '承运人', type: 'text' },
      { name: 'voyageNumber', label: '航次号', type: 'text' },
      { name: 'vesselOrFlight', label: '船名/航班', type: 'text' },
      { name: 'trackingNumber', label: '物流跟踪号', type: 'text', placeholder: '快递单号 / 集装箱跟踪号' },
      { name: 'carrierTrackingUrl', label: '跟踪查询链接', type: 'text', placeholder: 'https://…（承运商查询页）' },
      { name: 'portOfLoading', label: '装运港', type: 'text' },
      { name: 'portOfDischarge', label: '卸货港', type: 'text' },
      { name: 'etd', label: '预计离港', type: 'text', placeholder: 'YYYY-MM-DD' },
      { name: 'eta', label: '预计到港', type: 'text', placeholder: 'YYYY-MM-DD' },
    ],
  },
  {
    id: 'shipment-fees',
    title: '费用信息',
    desc: '运费、保险费、报关费、其他费用',
    fields: [
      { name: 'freightAmount', label: '运费金额', type: 'text', placeholder: '如 12500.00' },
      { name: 'freightCurrency', label: '运费币种', type: 'select', options: FEE_CURRENCY_OPTIONS.map(c => ({ value: c, label: c })) },
      { name: 'insuranceAmount', label: '保险费金额', type: 'text', placeholder: '如 800.00' },
      { name: 'insuranceCurrency', label: '保险费币种', type: 'select', options: FEE_CURRENCY_OPTIONS.map(c => ({ value: c, label: c })) },
      { name: 'customsAmount', label: '报关费金额', type: 'text', placeholder: '如 1500.00' },
      { name: 'customsCurrency', label: '报关费币种', type: 'select', options: FEE_CURRENCY_OPTIONS.map(c => ({ value: c, label: c })) },
      { name: 'otherCharges', label: '其他费用金额', type: 'text', placeholder: '如 300.00' },
      { name: 'otherChargesCurrency', label: '其他费用币种', type: 'select', options: FEE_CURRENCY_OPTIONS.map(c => ({ value: c, label: c })) },
    ],
  },
  {
    id: 'shipment-consignee',
    title: '收货信息',
    desc: '收货方、地址、备注',
    fields: [
      { name: 'customerName', label: '客户', type: 'text' },
      { name: 'containerNumber', label: '集装箱号', type: 'text' },
      { name: 'totalPackages', label: '总件数', type: 'text' },
      { name: 'grossWeight', label: '毛重(kg)', type: 'text' },
      { name: 'volume', label: '体积(CBM)', type: 'text' },
      { name: 'notes', label: '备注', type: 'textarea', fullSpan: true },
    ],
  },
];

// BDS v2.1：状态 → bds-badge 语义变体（主题透明，替代原 isDarkMode 双态 class 拼装。
// 函数名与活跃态判定字面量保留 —— rdl/shipment 源码契约守卫测试消费同一函数体）
const statusTone = (status: ShipmentStatus): 'neutral' | 'info' | 'success' | 'danger' | 'warning' => {
  if (status === 'Delivered') return 'success';
  if (status === 'Shipped' || status === 'Loading' || status === 'Arrived' || status === 'Cleared') return 'info';
  if (status === 'Booked') return 'info';
  if (status === 'Cancelled') return 'neutral';
  return 'neutral';
};

// 时间轴节点圆点/文字色（与徽章变体同语义 token，主题透明）
const STATUS_TONE_COLOR: Record<ReturnType<typeof statusTone>, string> = {
  neutral: 'var(--text-tertiary)',
  info: 'var(--accent-text)',
  success: 'var(--success-text)',
  danger: 'var(--danger-text)',
  warning: 'var(--warning-text)',
};

// compiled 交互卡 spotlight 统一 accent 色/尺寸（主题透明，替代 isDarkMode 双值三元）
const SPOTLIGHT_COLOR = 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)';
const SPOTLIGHT_SIZE = 200;

const ShipmentManager: React.FC<ShipmentManagerProps> = ({ isDarkMode, shipments, setShipments, onNavigate }) => {
  const [selectedStatus, setSelectedStatus] = useState<ShipmentStatusId>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const formScrollRef = useRef<HTMLDivElement | null>(null);

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingShipment, setEditingShipment] = useState<ShipmentType | null>(null);
  const [formDraft, setFormDraft] = useState<ShipmentFormDraft>(createEmptyDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [exportingXlsx, setExportingXlsx] = useState(false);

  // 阶段 IA-3：订单详情「创建出运」prime —— 挂载时自动打开新建运单并预填订单/客户
  useEffect(() => {
    const prime = readShipmentCreatePrime();
    if (!prime) return;
    clearShipmentCreatePrime();
    setEditingShipment(null);
    setFormDraft({ ...createEmptyDraft(), orderId: prime.orderId, customerName: prime.customerName ?? '' });
    setErrorMessage('');
    setShowFormModal(true);
  }, []);

  // Phase B3 — 准交率统计（只读；挂载时拉取一次，失败静默不影响主流程）
  const [onTimeStats, setOnTimeStats] = useState<OnTimeStats | null>(null);
  // REQ2-20（DR-061）：旺季舱位预警清单（订舱提前期规则扫描，只读）
  const [bookingReminders, setBookingReminders] = useState<Awaited<ReturnType<typeof shipmentService.getBookingReminders>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    shipmentService.getBookingReminders()
      .then(r => { if (!cancelled) setBookingReminders(r); })
      .catch(() => { /* 预警加载失败不阻断主列表 */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    shipmentService.getOnTimeStats()
      .then(stats => { if (!cancelled) setOnTimeStats(stats); })
      .catch(() => { /* 统计条不可用时不阻断货运主流程 */ });
    return () => { cancelled = true; };
  }, []);

  // C4 — 运输方式维度统计（只读 chips；与准交率同策略，失败静默）
  const [methodStats, setMethodStats] = useState<MethodStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    shipmentService.getMethodStats()
      .then(stats => { if (!cancelled) setMethodStats(stats); })
      .catch(() => { /* 统计条不可用时不阻断货运主流程 */ });
    return () => { cancelled = true; };
  }, []);

  // 跨模块导航筛选（关系智库档案「关联业务 → 出运」入口）：挂载时消费一次
  const [navRelationFilter, setNavRelationFilter] = useState(() => consumeCrossModuleNav()?.filter ?? null);

  // ── R3：主列表服务端分页（/v1/shipping limit=100 + offset + search + customerRelationId）──
  // 搜索防抖 300ms 走服务端 ?search=；失败回退 props 客户端过滤（本地快照已循环拉全）并给可见错误。
  const [serverList, setServerList] = useState<ShipmentType[] | null>(null);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (listSearchTimerRef.current) clearTimeout(listSearchTimerRef.current); }, []);

  const fetchShipmentPage = useCallback((offset: number) => apiService.listShipmentsPage(undefined, {
    limit: SHIPMENT_LIST_PAGE_SIZE,
    offset,
    ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
    ...(selectedStatus !== 'all' ? { status: selectedStatus } : {}),
    ...(navRelationFilter ? { customerRelationId: navRelationFilter.relationId } : {}),
  }), [searchTerm, selectedStatus, navRelationFilter]);

  // 防抖重置拉取：搜索/状态/导航筛选变更 → 300ms 后从第一页重拉
  useEffect(() => {
    if (listSearchTimerRef.current) clearTimeout(listSearchTimerRef.current);
    setListLoading(true);
    listSearchTimerRef.current = setTimeout(() => {
      fetchShipmentPage(0)
        .then(page => { setServerList(page.items); setServerTotal(page.total); setListError(null); })
        .catch((e: any) => { setServerList(null); setServerTotal(null); setListError(`运单列表加载失败：${e?.message ?? e}`); })
        .finally(() => setListLoading(false));
    }, 300);
    return () => { if (listSearchTimerRef.current) clearTimeout(listSearchTimerRef.current); };
  }, [fetchShipmentPage]);

  const handleLoadMoreShipments = useCallback(async () => {
    if (listLoading || serverList == null) return;
    setListLoading(true);
    try {
      const page = await fetchShipmentPage(serverList.length);
      setServerList(prev => {
        const base = prev ?? [];
        const existing = new Set(base.map(s => s.id));
        return [...base, ...page.items.filter(s => !existing.has(s.id))];
      });
      setServerTotal(page.total);
    } catch (e: any) {
      setListError(`加载更多运单失败：${e?.message ?? e}`);
    } finally {
      setListLoading(false);
    }
  }, [listLoading, serverList, fetchShipmentPage]);
  const hasMoreShipments = serverList != null && serverTotal != null && serverList.length < serverTotal;

  // Derive filtered list：服务端分页结果优先（已按 status/search/customerRelationId 过滤）；未就绪/失败时回退 App 快照客户端过滤
  const filteredShipments = useMemo(() => {
    if (serverList != null) return serverList;
    let result = shipments;
    if (navRelationFilter) result = result.filter(s => s.customerRelationId === navRelationFilter.relationId);
    if (selectedStatus !== 'all') result = result.filter(s => s.status === selectedStatus);
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter(s =>
        s.shipmentNumber?.toLowerCase().includes(q) ||
        s.customerName?.toLowerCase().includes(q) ||
        s.carrierName?.toLowerCase().includes(q) ||
        s.vesselOrFlight?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [shipments, serverList, selectedStatus, searchTerm, navRelationFilter]);
  const selectedShipment = filteredShipments.find(item => item.id === selectedId) || filteredShipments[0];

  /** 运单台账 Excel 导出（当前筛选条件全量：状态/搜索/客户档案锚镜像到服务端过滤） */
  const handleExportXlsx = useCallback(async () => {
    setExportingXlsx(true);
    try {
      await apiService.exportShipmentsXlsx({
        ...(selectedStatus !== 'all' ? { status: selectedStatus } : {}),
        ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
        ...(navRelationFilter ? { customerRelationId: navRelationFilter.relationId } : {}),
      });
    } catch (e: any) {
      setErrorMessage(`台账导出失败：${e?.message || e}`);
    } finally {
      setExportingXlsx(false);
    }
  }, [selectedStatus, searchTerm, navRelationFilter]);

  // F3 — 物流节点时间轴（选中运单时拉取；状态变更后随 selectedShipment.status 联动刷新）
  const [shipmentEvents, setShipmentEvents] = useState<ShipmentEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  // R4：时间轴加载失败内联可见（区分「加载失败」与「暂无节点记录」）
  const [eventsError, setEventsError] = useState<string | null>(null);
  const selectedShipmentId = selectedShipment?.id;
  const selectedShipmentStatus = selectedShipment?.status;
  useEffect(() => {
    if (!selectedShipmentId) {
      setShipmentEvents([]);
      setEventsError(null);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    setEventsError(null);
    shipmentService.listShipmentEvents(selectedShipmentId)
      .then(items => { if (!cancelled) setShipmentEvents(items); })
      .catch((e: any) => { if (!cancelled) { setShipmentEvents([]); setEventsError(`时间轴加载失败：${e?.message ?? e}`); } })
      .finally(() => { if (!cancelled) setEventsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedShipmentId, selectedShipmentStatus]);

  // C4 — 装箱明细（选中运单时拉取行 + 箱；状态变更后联动刷新，保存后手动刷新）
  const [packingLines, setPackingLines] = useState<ShipmentLine[]>([]);
  const [packingCartons, setPackingCartons] = useState<ShipmentCarton[]>([]);
  const [packingLoading, setPackingLoading] = useState(false);
  const [packingRefreshKey, setPackingRefreshKey] = useState(0);
  // R4：装箱明细加载失败内联可见（区分「加载失败」与「暂无装箱明细」）
  const [packingError, setPackingError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedShipmentId) {
      setPackingLines([]);
      setPackingCartons([]);
      setPackingError(null);
      return;
    }
    let cancelled = false;
    setPackingLoading(true);
    setPackingError(null);
    Promise.all([
      shipmentService.listShipmentLines(selectedShipmentId),
      shipmentService.listShipmentCartons(selectedShipmentId),
    ])
      .then(([lines, cartons]) => {
        if (!cancelled) { setPackingLines(lines); setPackingCartons(cartons); }
      })
      .catch((e: any) => { if (!cancelled) { setPackingLines([]); setPackingCartons([]); setPackingError(`装箱明细加载失败：${e?.message ?? e}`); } })
      .finally(() => { if (!cancelled) setPackingLoading(false); });
    return () => { cancelled = true; };
  }, [selectedShipmentId, selectedShipmentStatus, packingRefreshKey]);

  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
  const textPrimaryClass = 'text-[var(--text-primary)]';
  const textSecondaryClass = 'text-[var(--text-tertiary)]';

  const statusItems = [
    { label: '已发运', value: shipments.filter(s => s.status === 'Shipped').length },
    { label: '已交付', value: shipments.filter(s => s.status === 'Delivered').length },
    { label: '草稿', value: shipments.filter(s => s.status === 'Draft').length },
  ];

  const inspectorRows = selectedShipment
    ? [
        { label: '运单号', value: selectedShipment.shipmentNumber },
        { label: '客户', value: selectedShipment.customerName || '—' },
        { label: '集装箱号', value: selectedShipment.containerNumber || '—' },
        { label: '跟踪号', value: selectedShipment.trackingNumber || '—' },
        { label: '关联订单', value: selectedShipment.orderId ? `订单 ${selectedShipment.orderId.slice(-8)}` : '—' },
        { label: '承运人', value: selectedShipment.carrierName || '—' },
        { label: '运输方式', value: selectedShipment.shippingMethod || '—' },
        { label: '航次号', value: selectedShipment.voyageNumber || '—' },
        { label: '船名/航班', value: selectedShipment.vesselOrFlight || '—' },
        { label: '装运港', value: selectedShipment.portOfLoading || '—' },
        { label: '卸货港', value: selectedShipment.portOfDischarge || '—' },
        { label: '预计离港', value: selectedShipment.etd || '—' },
        { label: '实际到港', value: selectedShipment.ata || '—' },
        { label: '实际离港', value: selectedShipment.atd || '—' },
        { label: '报关单号', value: selectedShipment.customsDeclarationNumber || '—' },
        { label: '清关日期', value: selectedShipment.customsClearanceDate || '—' },
        { label: '总件数', value: selectedShipment.totalPackages != null ? String(selectedShipment.totalPackages) : '—' },
        { label: '毛重', value: selectedShipment.grossWeight != null ? `${selectedShipment.grossWeight} kg` : '—' },
        { label: '净重', value: selectedShipment.netWeight != null ? `${selectedShipment.netWeight} kg` : '—' },
        { label: '体积', value: selectedShipment.volume != null ? `${selectedShipment.volume} CBM` : '—' },
        { label: '运费', value: selectedShipment.freightAmount != null ? `${selectedShipment.freightAmount} ${selectedShipment.freightCurrency || ''}`.trim() : '—' },
        { label: '保险费', value: selectedShipment.insuranceAmount != null ? `${selectedShipment.insuranceAmount} ${selectedShipment.insuranceCurrency || ''}`.trim() : '—' },
        { label: '报关费', value: selectedShipment.customsAmount != null ? `${selectedShipment.customsAmount} ${selectedShipment.customsCurrency || ''}`.trim() : '—' },
        { label: '其他费用', value: selectedShipment.otherCharges != null ? `${selectedShipment.otherCharges} ${selectedShipment.otherChargesCurrency || ''}`.trim() : '—' },
        { label: '备注', value: selectedShipment.notes || '—' },
      ]
    : [];

  const openCreateModal = () => {
    setEditingShipment(null);
    setFormDraft(createEmptyDraft());
    setErrorMessage('');
    setShowFormModal(true);
  };

  const openEditModal = (shipment: ShipmentType) => {
    setEditingShipment(shipment);
    setFormDraft(draftFromShipment(shipment));
    setErrorMessage('');
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    if (isSaving) return;
    setShowFormModal(false);
    setEditingShipment(null);
    setErrorMessage('');
  };

  const buildPayload = (): Partial<ShipmentType> => {
    const d = formDraft;
    const maybe = (v: string) => { const t = v.trim(); return t ? t : undefined; };
    const numOrUndef = (v: string) => { const n = Number(v); return v.trim() && Number.isFinite(n) ? n : undefined; };
    return {
      shipmentNumber: d.shipmentNumber.trim(),
      type: d.type,
      status: d.status as ShipmentStatus,
      shippingMethod: d.shippingMethod,
      bookingDate: maybe(d.bookingDate),
      etd: maybe(d.etd),
      eta: maybe(d.eta),
      vesselOrFlight: maybe(d.vesselOrFlight),
      voyageNumber: maybe(d.voyageNumber),
      portOfLoading: maybe(d.portOfLoading),
      portOfDischarge: maybe(d.portOfDischarge),
      containerNumber: maybe(d.containerNumber),
      sealNumber: maybe(d.sealNumber),
      trackingNumber: maybe(d.trackingNumber),
      carrierTrackingUrl: maybe(d.carrierTrackingUrl),
      totalPackages: numOrUndef(d.totalPackages) as any,
      grossWeight: numOrUndef(d.grossWeight) as any,
      netWeight: numOrUndef(d.netWeight) as any,
      volume: numOrUndef(d.volume) as any,
      freightAmount: numOrUndef(d.freightAmount) as any,
      freightCurrency: d.freightAmount.trim() ? maybe(d.freightCurrency) : undefined,
      insuranceAmount: numOrUndef(d.insuranceAmount) as any,
      insuranceCurrency: d.insuranceAmount.trim() ? maybe(d.insuranceCurrency) : undefined,
      customsAmount: numOrUndef(d.customsAmount) as any,
      customsCurrency: d.customsAmount.trim() ? maybe(d.customsCurrency) : undefined,
      otherCharges: numOrUndef(d.otherCharges) as any,
      otherChargesCurrency: d.otherCharges.trim() ? maybe(d.otherChargesCurrency) : undefined,
      customerName: maybe(d.customerName),
      carrierName: maybe(d.carrierName),
      orderId: maybe(d.orderId),
      notes: maybe(d.notes),
    };
  };

  const submitForm = async () => {
    if (!formDraft.shipmentNumber.trim()) {
      setErrorMessage('请填写运单号');
      return;
    }
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (formDraft.etd && !datePattern.test(formDraft.etd)) {
      setErrorMessage('预计离港日格式应为 YYYY-MM-DD');
      return;
    }
    if (formDraft.eta && !datePattern.test(formDraft.eta)) {
      setErrorMessage('预计到港日格式应为 YYYY-MM-DD');
      return;
    }
    setIsSaving(true);
    setErrorMessage('');
    try {
      const payload = buildPayload();
      if (editingShipment) {
        // R6：编辑态不下发身份字段（后端 PATCH 白名单不收 shipmentNumber/type，带上即假动作）
        delete payload.shipmentNumber;
        delete payload.type;
        const persisted = await shipmentService.updateShipment(editingShipment.id, payload);
        setShipments(prev => prev.map(s => (s.id === persisted.id ? persisted : s)));
        setServerList(prev => (prev ? prev.map(s => (s.id === persisted.id ? persisted : s)) : prev));
        bdsToast.success(`运单 ${persisted.shipmentNumber} 已保存`);
      } else {
        const persisted = await shipmentService.createShipment(payload);
        setShipments(prev => [persisted, ...prev]);
        setServerList(prev => (prev ? [persisted, ...prev] : prev));
        setServerTotal(prev => (prev != null ? prev + 1 : prev));
        setSelectedId(persisted.id);
        bdsToast.success(`运单 ${persisted.shipmentNumber} 已创建`);
      }
      setShowFormModal(false);
      setEditingShipment(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (shipment: ShipmentType) => {
    if (deletingId) return;
    if (!(await bdsConfirm({ title: '确认删除', body: `确定要删除运单 ${shipment.shipmentNumber} 吗？此操作不可撤销。`, danger: true }))) return;
    setDeletingId(shipment.id);
    setErrorMessage('');
    try {
      await shipmentService.deleteShipment(shipment.id);
      setShipments(prev => prev.filter(s => s.id !== shipment.id));
      setServerList(prev => (prev ? prev.filter(s => s.id !== shipment.id) : prev));
      setServerTotal(prev => (prev != null && prev > 0 ? prev - 1 : prev));
      if (selectedId === shipment.id) setSelectedId(null);
      bdsToast.success(`运单 ${shipment.shipmentNumber} 已删除`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingId(null);
    }
  };

  // C4 — 装箱明细：编辑窗口（Draft/Booked/Loading 可编辑）+ 从订单带出
  const [showPackingEditor, setShowPackingEditor] = useState(false);
  const [pullingLines, setPullingLines] = useState(false);
  const packingEditable = !!selectedShipment && ['Draft', 'Booked', 'Loading'].includes(selectedShipment.status);

  // F2 — 分批出运（订单批次面板）/ 合票出运（票内订单分配）入口窗口
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [showAllocationPanel, setShowAllocationPanel] = useState(false);

  const handlePullLines = async () => {
    if (!selectedShipment || pullingLines) return;
    setPullingLines(true);
    setErrorMessage('');
    try {
      await shipmentService.pullLinesFromOrder(selectedShipment.id);
      setPackingRefreshKey(k => k + 1);
      bdsToast.success(`已从订单 ${selectedShipment.orderId?.slice(-8) ?? ''} 带出装运行`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPullingLines(false);
    }
  };

  // F3：状态下拉可选项（create=合法初始态；edit=当前态+合法下一步；镜像后端 SHIPMENT_TRANSITIONS）
  const statusFieldOptions = useMemo<ReadonlyArray<{ value: string; label: string }>>(
    () => getShipmentFormStatusOptions(editingShipment ? 'edit' : 'create', editingShipment?.status ?? null)
      .map(s => ({ value: s, label: statusLabelMap[s] })),
    [editingShipment],
  );

  // F4：删除按钮权限（后端 DELETE /shipping/:id 限 requireRole('owner','admin','manager')，无权限不渲染）
  const canDeleteShipment = hasRole('owner', 'admin', 'manager');

  const renderShipmentField = (field: ShipmentFormFieldConfig) => {
    // F3：状态字段选项随编辑对象动态计算（新建/编辑合法集合不同）
    const options = field.name === 'status' ? statusFieldOptions : field.options;
    // R6：身份字段（运单号）编辑态禁用——后端 PATCH 白名单不收，可编辑即假动作
    const fieldDisabled = !!(editingShipment && field.disabledInEdit);
    return (
    <div key={field.name} className={cx('flex flex-col', field.fullSpan && 'md:col-span-2')}>
      <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">
        {field.label}{field.required && <span className="ml-0.5 text-[var(--text-quaternary)]">*</span>}
        {fieldDisabled && <span className="ml-1 text-[10px] text-[var(--text-quaternary)]">（创建后不可修改）</span>}
      </label>
      {field.type === 'select' ? (
        <select
          className="bds-select"
          value={formDraft[field.name]}
          disabled={fieldDisabled}
          onChange={(e) => setFormDraft(prev => ({ ...prev, [field.name]: e.target.value }))}
        >
          {!field.required && (
            <option value="">— 不指定 —</option>
          )}
          {options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={formDraft[field.name]}
          onChange={(e) => setFormDraft(prev => ({ ...prev, [field.name]: e.target.value }))}
          rows={3}
          placeholder={field.placeholder}
          disabled={fieldDisabled}
          className="bds-input bds-textarea"
        />
      ) : (
        <input
          type="text"
          value={formDraft[field.name]}
          onChange={(e) => setFormDraft(prev => ({ ...prev, [field.name]: e.target.value }))}
          placeholder={field.placeholder}
          disabled={fieldDisabled}
          className="bds-input"
        />
      )}
    </div>
    );
  };

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 overflow-hidden">
      <PageHeader
        title="货运管理"
        subtitle="Shipments & Logistics"
        contextLabel="Shipment Desk"
        hidden={showFormModal}
        actions={(
          <>
            {/* B10 运营域报表：运单台账 Excel 导出（当前筛选全量） */}
            <button
              type="button"
              onClick={() => void handleExportXlsx()}
              disabled={exportingXlsx}
              className="bds-btn bds-btn-secondary"
              title="运单台账 Excel 导出（当前筛选全量）"
            >
              {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              导出台账
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="bds-btn bds-btn-primary"
            >
              <Plus size={14} />
              新建运单
            </button>
          </>
        )}
      />

      <main className={cx('flex-1 min-h-0 flex flex-col px-7 pt-0 bambook-main-panel-bottom-inset overflow-visible w-full h-full', showFormModal && 'hidden')}>
        <div className="flex h-full min-h-0 flex-col gap-3">
          {errorMessage && !showFormModal && (
            <div className="bds-alert danger shrink-0">
              <span className="flex-1 min-w-0 break-words">{errorMessage}</span>
              <button type="button" onClick={() => setErrorMessage('')} aria-label="关闭错误提示" className="mt-px shrink-0 hover:opacity-70">
                <X size={14} />
              </button>
            </div>
          )}

          {/* R3/R4：列表加载失败可见化（已回退本地缓存口径），与「真空」区分 */}
          {listError && !showFormModal && (
            <div className="bds-alert warning shrink-0">
              <span className="flex-1 min-w-0 break-words">{listError}——当前展示为本地缓存口径。</span>
              <button type="button" onClick={() => setListError(null)} aria-label="关闭列表错误提示" className="mt-px shrink-0 hover:opacity-70">
                <X size={14} />
              </button>
            </div>
          )}

          {/* REQ2-20（DR-061）：旺季舱位预警——订舱提前期规则（旺季/平时）扫描无出运安排的订单 */}
          {bookingReminders && bookingReminders.items.length > 0 && (
            <div className="shrink-0 rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs tracking-[0.14em] text-[var(--text-secondary)]">舱位预警 BOOKING</span>
                <span className="bds-badge warning">{bookingReminders.items.length} 单待订舱</span>
                <span className="text-[10px] font-light text-[var(--text-tertiary)]">
                  规则：旺季（{bookingReminders.rule.peakMonths.map(m => `${m} 月`).join('/')}）提前 {bookingReminders.rule.peakDays} 天 · 平时提前 {bookingReminders.rule.normalDays} 天
                </span>
              </div>
              <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto custom-scrollbar">
                {bookingReminders.items.map(item => (
                  <div key={item.orderId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-compact bg-[var(--recessed-bg-strong)] px-3 py-2 text-xs">
                    <span className={cx('bds-badge',
                      item.level === 'overdue' ? 'danger' : item.level === 'urgent' ? 'warning' : 'neutral')}>
                      {item.level === 'overdue' ? '已过交期' : item.level === 'urgent' ? '紧急' : '待订舱'}
                    </span>
                    <span className="font-light text-[var(--text-primary)]">{item.customer}</span>
                    {item.poNumber && <span className="text-[10px] font-light text-[var(--text-tertiary)]">{item.poNumber}</span>}
                    <span className="text-[10px] font-light text-[var(--text-tertiary)]">交期 {item.dueDate}</span>
                    {item.isPeak && <span className="bds-badge info">旺季</span>}
                    <span className="text-[10px] font-light text-[var(--text-secondary)]">{item.suggestion}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {navRelationFilter && (
            <NavRelationFilterChip filter={navRelationFilter} label="出运" onClear={() => setNavRelationFilter(null)} />
          )}
          <div className="bds-filterbar shrink-0 flex-wrap gap-y-2">
            <div className="relative min-w-48 flex-[1_1_220px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="运单号 / 客户 / 承运方（服务端搜索）"
                className="bds-input sm pl-9"
              />
            </div>
            <div className="hidden h-4 w-px shrink-0 xl:block bg-[var(--border-c-strong)]" />
            <div className="min-w-0 flex-[1_1_auto] overflow-x-auto">
              <div className="bds-segment">
                {SHIPMENT_STATUSES.map(item => (
                  <button key={item.id} type="button" onClick={() => setSelectedStatus(item.id)} className={cx('seg whitespace-nowrap', selectedStatus === item.id && 'active')}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Phase B3 — 准交率统计条（只读，口径：订单最后一票 ata ≤ dueDate / 运单 ata ≤ eta） */}
          {onTimeStats && (onTimeStats.order.total > 0 || onTimeStats.shipment.total > 0) && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1.5 rounded-inset px-4 py-2 bg-[var(--recessed-bg)]">
              <div className="flex items-baseline gap-2">
                <span className={cx('text-[10px] tracking-[0.14em]', textSecondaryClass)}>订单准交率</span>
                <span className={cx('text-sm bds-tnum', textPrimaryClass)}>
                  {onTimeStats.order.rate == null ? '—' : `${(onTimeStats.order.rate * 100).toFixed(1)}%`}
                </span>
                <span className={cx('text-[10px] bds-tnum', textSecondaryClass)}>
                  准交 {onTimeStats.order.onTime} / 可判定 {onTimeStats.order.total - onTimeStats.order.pending}
                  {onTimeStats.order.pending > 0 && ` · 待出运 ${onTimeStats.order.pending}`}
                </span>
              </div>
              <div className="hidden h-4 w-px xl:block bg-[var(--border-c-strong)]" />
              <div className="flex items-baseline gap-2">
                <span className={cx('text-[10px] tracking-[0.14em]', textSecondaryClass)}>运单准点率</span>
                <span className={cx('text-sm bds-tnum', textPrimaryClass)}>
                  {onTimeStats.shipment.rate == null ? '—' : `${(onTimeStats.shipment.rate * 100).toFixed(1)}%`}
                </span>
                <span className={cx('text-[10px] bds-tnum', textSecondaryClass)}>
                  准点 {onTimeStats.shipment.onTime} / {onTimeStats.shipment.total}
                </span>
              </div>
              {/* C4：运输方式 chips（总量 · 在途 · 准点率） */}
              {methodStats && methodStats.methods.length > 0 && (
                <>
                  <div className="hidden h-4 w-px xl:block bg-[var(--border-c-strong)]" />
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {methodStats.methods.slice(0, 6).map(m => (
                      <span
                        key={m.method}
                        title={`${m.method}：共 ${m.total} 票 · 在途 ${m.inTransit} · 已交付 ${m.delivered}${m.onTimeRate != null ? ` · 准点率 ${(m.onTimeRate * 100).toFixed(1)}%` : ''}`}
                        className="bds-badge sm neutral"
                      >
                        <span>{m.method}</span>
                        <span className="bds-tnum">{m.total}票</span>
                        {m.inTransit > 0 && <span className="bds-tnum">在途{m.inTransit}</span>}
                        {m.onTimeRate != null && <span className="bds-tnum">{(m.onTimeRate * 100).toFixed(0)}%</span>}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-visible xl:grid-cols-[minmax(0,1fr)_320px]">
            <CompiledTableShell
              isDarkMode={isDarkMode}
              scrollRef={tableScrollRef}
              useSidePanelContainer
              shellBaseClassName="h-full min-h-0 overflow-visible"
              panelClassName="flex h-full w-full flex-col overflow-hidden"
              panelContentClassName="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden"
              scrollClassName="min-h-0 flex-1 overflow-x-visible overflow-y-auto overscroll-contain"
              edgeFade={{ topHeight: 22, topFadeStartOffset: 0, bottomHeight: 42 }}
              header={(
                <div className={cx(tableGridClass, 'text-[10px] tracking-[0.16em]', textSecondaryClass)} style={{ borderBottom: 'var(--border-default)' }}>
                  {tableColumns.map(column => (
                    <div key={column.key} className="min-w-0 px-3 py-3">{column.label}</div>
                  ))}
                </div>
              )}
            >
              <div className="text-xs">
                {filteredShipments.map((item, index) => {
                  const active = selectedShipment?.id === item.id;
                  return (
                    <CompiledMotionInteractiveCard
                      as="button"
                      type="button"
                      key={item.id}
                      data-glass-edge-mask
                      onClick={() => setSelectedId(item.id)}
                      spotlightColor={SPOTLIGHT_COLOR}
                      spotlightSize={SPOTLIGHT_SIZE}
                      idleSpotlightOpacity={0}
                      liquidSpotlight
                      liquidSpotlightTone="light"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.025 }}
                      className={cx(
                        tableGridClass,
                        'group relative isolate w-full overflow-hidden text-left transition-colors duration-200 hover:bg-[var(--hover-darken)]',
                      )}
                      style={active ? { background: 'var(--accent-tint)' } : undefined}
                    >
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-px bg-[var(--border-c-subtle)]" aria-hidden="true" />
                      <div className="relative z-10 min-w-0 px-3 py-4">
                        <div className={cx('truncate', textPrimaryClass)}>{item.shipmentNumber}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.shippingMethod || '—'} · {item.carrierName || '—'}</div>
                      </div>
                      <div className="relative z-10 min-w-0 px-3 py-4">
                        <span className={`bds-badge sm ${statusTone(item.status)}`}>
                          {statusLabelMap[item.status]}
                        </span>
                      </div>
                      <div className="relative z-10 min-w-0 px-3 py-4">
                        <div className={cx('truncate', textPrimaryClass)}>{item.customerName || '—'}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.orderId ? '订单 ' + item.orderId.slice(-8) : '无关联订单'}</div>
                      </div>
                      <div className="relative z-10 min-w-0 px-3 py-4">
                        <div className={cx('truncate', textPrimaryClass)}>{item.vesselOrFlight || item.voyageNumber || '—'}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.etd || '—'} → {item.eta || '—'}</div>
                      </div>
                    </CompiledMotionInteractiveCard>
                  );
                })}
                {filteredShipments.length === 0 && !listLoading && (
                  <div className="bds-empty">
                    <div className="glyph"><Truck size={24} strokeWidth={1.5} /></div>
                    <div className="title">暂无匹配运单</div>
                  </div>
                )}
                {/* R3：分页页脚——total 可见 + 加载更多（服务端 offset 续拉） */}
                {(serverTotal != null || listLoading) && (
                  <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[var(--border-c-subtle)] px-4 py-3">
                    {listLoading && <Loader2 size={14} className="animate-spin text-[var(--text-quaternary)]" />}
                    {serverTotal != null && (
                      <span className={cx('text-[11px] font-light', textSecondaryClass)}>已加载 {filteredShipments.length} / 共 {serverTotal} 票</span>
                    )}
                    {hasMoreShipments && (
                      <button
                        type="button"
                        onClick={() => void handleLoadMoreShipments()}
                        disabled={listLoading}
                        className="bds-btn bds-btn-secondary"
                      >
                        加载更多
                      </button>
                    )}
                  </div>
                )}
              </div>
            </CompiledTableShell>

            <CompiledSurfacePanel
              isDarkMode={isDarkMode}
              materialRole="framePanel"
              spotlight
              spotlightSizing="width"
              className="h-full min-h-0 overflow-hidden p-0"
              contentClassName="relative z-10 flex h-full min-h-0 flex-col overflow-hidden"
            >
              {selectedShipment ? (
                <>
                  <div className="shrink-0 px-5 py-4" style={{ borderBottom: 'var(--border-subtle)' }}>
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={cx('text-[10px] tracking-[0.18em]', textSecondaryClass)}>当前运单</div>
                        <div className={cx('mt-2 truncate text-base', textPrimaryClass)}>{selectedShipment.shipmentNumber}</div>
                        <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{selectedShipment.shippingMethod || '—'} · {selectedShipment.carrierName || '—'}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className={`bds-badge sm ${statusTone(selectedShipment.status)}`}>
                          {statusLabelMap[selectedShipment.status]}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(selectedShipment)}
                            className="bds-btn bds-btn-secondary"
                          >
                            <Pencil size={14} />
                            编辑
                          </button>
                          {canDeleteShipment && (
                            <button
                              type="button"
                              onClick={() => handleDelete(selectedShipment)} disabled={deletingId !== null}
                              className="bds-btn bds-btn-danger"
                            >
                              <Trash2 size={14} />
                              删除
                            </button>
                          )}
                        </div>
                        {/* F2：分批出运（订单批次计划/发运确认）+ 合票出运（票内订单分配 DR-016）操作入口 */}
                        <div className="flex items-center gap-1.5">
                          {selectedShipment.orderId && (
                            <button
                              type="button"
                              onClick={() => setShowBatchPanel(true)}
                              title="订单分批出运：批次计划登记 / 排船回填 / 发运确认 / 尾款结算"
                              className="bds-btn bds-btn-secondary"
                            >
                              <Split size={14} />
                              分批出运
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowAllocationPanel(true)}
                            title="合票出运：本票运单分配多个订单（同客户同业务线，后端校验）"
                            className="bds-btn bds-btn-secondary"
                          >
                            <Layers size={14} />
                            合票出运
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <div className="space-y-1">
                      {inspectorRows.map(row => (
                        <div key={row.label} className="grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-3 py-2">
                          <div className={cx('text-[10px] tracking-wide', textSecondaryClass)}>{row.label}</div>
                          <div className={cx('truncate text-xs', textPrimaryClass)}>{row.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="my-4 h-px w-full bg-[var(--border-c-subtle)]" />
                    <div className="rounded-inset px-4 py-3" style={{ background: 'var(--accent-tint-light)', border: '1px solid var(--accent-tint)' }}>
                      <div className={cx('text-[10px] tracking-[0.18em]', textSecondaryClass)}>物流轨迹</div>
                      <div className={cx('mt-2 text-sm', textPrimaryClass)}>
                        {selectedShipment.portOfLoading || '?'} → {selectedShipment.portOfDischarge || '?'}
                      </div>
                      <div className={cx('mt-1 text-[10px]', textSecondaryClass)}>
                        离港 {selectedShipment.etd || '?'} · 到港 {selectedShipment.eta || '?'}
                        {selectedShipment.ata && ` · 实际到港 ${selectedShipment.ata}`}
                      </div>
                      {/* C4：物流跟踪号 + 承运商查询跳转 */}
                      {(selectedShipment.trackingNumber || selectedShipment.carrierTrackingUrl) && (
                        <div className={cx('mt-2 flex items-center gap-2 text-[10px]', textSecondaryClass)}>
                          <span className="truncate">跟踪号 {selectedShipment.trackingNumber || '—'}</span>
                          {selectedShipment.carrierTrackingUrl && (
                            <a
                              href={selectedShipment.carrierTrackingUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="bds-btn bds-btn-secondary shrink-0"
                            >
                              <ExternalLink size={14} />
                              承运商查询
                            </a>
                          )}
                        </div>
                      )}
                      {/* F3：节点时间轴（ShipmentEvent 订舱→装货→发运→到港→清关→交付） */}
                      <div className="mt-3 pt-3" style={{ borderTop: 'var(--border-subtle)' }}>
                        {eventsLoading ? (
                          <div className={cx('flex items-center gap-2 py-1 text-[10px]', textSecondaryClass)}>
                            <Loader2 size={14} className="animate-spin" />加载节点时间轴…
                          </div>
                        ) : eventsError ? (
                          <div className="bds-alert danger">
                            <span className="text-[10px] font-light">{eventsError}</span>
                          </div>
                        ) : shipmentEvents.length === 0 ? (
                          <div className={cx('py-1 text-[10px]', textSecondaryClass)}>暂无节点记录</div>
                        ) : (
                          <div className="space-y-0">
                            {shipmentEvents.map((ev, idx) => {
                              const toneColor = STATUS_TONE_COLOR[statusTone(ev.toNode)];
                              const isLast = idx === shipmentEvents.length - 1;
                              return (
                                <div key={ev.id} className="flex gap-2.5">
                                  <div className="flex flex-col items-center shrink-0 w-2.5 pt-1">
                                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: toneColor }} />
                                    {!isLast && <span className="flex-1 w-px bg-[var(--border-c-strong)]" />}
                                  </div>
                                  <div className={cx('flex-1 min-w-0', isLast ? 'pb-0.5' : 'pb-3')}>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs" style={{ color: toneColor }}>{statusLabelMap[ev.toNode] || ev.toNode}</span>
                                      <span className={cx('text-[10px]', textSecondaryClass)}>{ev.eventDate}</span>
                                      {ev.actorId && <span className="text-[10px] text-[var(--text-quaternary)]">操作人: {ev.actorId}</span>}
                                    </div>
                                    {ev.note && (
                                      <div className="mt-1 px-2 py-1 rounded-inset text-[11px] bds-inset" style={{ color: 'var(--text-tertiary)' }}>{ev.note}</div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-4">
                      {/* C4：装箱明细区块（行级 + 逐箱；只读展示 + 编辑入口） */}
                      <div className="rounded-inset px-4 py-3 bds-inset" style={{ border: 'var(--border-subtle)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className={cx('text-[10px] tracking-[0.18em]', textSecondaryClass)}>装箱明细</div>
                          <div className="flex items-center gap-1.5">
                            {selectedShipment.orderId && packingEditable && (
                              <button
                                type="button"
                                onClick={handlePullLines}
                                disabled={pullingLines}
                                title="从关联订单重新带出装运行（覆盖现有行）"
                                className="bds-btn bds-btn-secondary"
                              >
                                {pullingLines ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                从订单带出
                              </button>
                            )}
                            {packingEditable && (
                              <button
                                type="button"
                                onClick={() => setShowPackingEditor(true)}
                                className="bds-btn bds-btn-secondary"
                              >
                                <Package size={14} />
                                编辑装箱
                              </button>
                            )}
                          </div>
                        </div>
                        {packingLoading ? (
                          <div className={cx('mt-2 flex items-center gap-2 py-1 text-[10px]', textSecondaryClass)}>
                            <Loader2 size={14} className="animate-spin" />加载装箱明细…
                          </div>
                        ) : packingError ? (
                          <div className="bds-alert danger mt-2">
                            <span className="text-[10px] font-light">{packingError}</span>
                          </div>
                        ) : packingLines.length === 0 && packingCartons.length === 0 ? (
                          <div className={cx('mt-2 py-1 text-[10px]', textSecondaryClass)}>
                            暂无装箱明细{packingEditable && selectedShipment.orderId ? '，可点击「从订单带出」快速生成装运行' : ''}
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2.5">
                            {packingLines.length > 0 && (
                              <div>
                                <div className={cx('text-[10px]', textSecondaryClass)}>装运行（{packingLines.length}）</div>
                                <div className="mt-1 space-y-1">
                                  {packingLines.map(line => (
                                    <div key={line.id} className="flex items-baseline justify-between gap-2 rounded-inset px-2 py-1 bds-inset">
                                      <span className={cx('min-w-0 truncate text-[11px]', textPrimaryClass)}>
                                        {line.productName || line.productCode || `行 ${line.lineNumber ?? ''}`}
                                      </span>
                                      <span className={cx('shrink-0 text-[10px] bds-tnum', textSecondaryClass)}>
                                        {line.quantity != null ? `${line.quantity}${line.unit ? ` ${line.unit}` : ''}` : '—'}
                                        {line.cartons != null && ` · ${line.cartons}箱`}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {packingCartons.length > 0 && (
                              <div>
                                <div className={cx('text-[10px]', textSecondaryClass)}>逐箱（{packingCartons.length}）</div>
                                <div className="mt-1 space-y-1">
                                  {packingCartons.map(carton => {
                                    const dims = [carton.length, carton.width, carton.height].every(v => v != null)
                                      ? `${carton.length}×${carton.width}×${carton.height}cm` : null;
                                    return (
                                      <div key={carton.id} className="rounded-inset px-2 py-1 bds-inset">
                                        <div className="flex items-baseline justify-between gap-2">
                                          <span className={cx('inline-flex min-w-0 items-center gap-1 text-[11px]', textPrimaryClass)}>
                                            <Box size={14} className="shrink-0 opacity-60" />
                                            <span className="truncate">C/NO {carton.cartonNo}</span>
                                          </span>
                                          <span className={cx('shrink-0 text-[10px] bds-tnum', textSecondaryClass)}>
                                            {carton.grossWeight != null ? `${carton.grossWeight}kg` : '—'}
                                            {carton.volume != null && ` · ${Number(carton.volume).toFixed(3)}CBM`}
                                          </span>
                                        </div>
                                        {(dims || (carton.items && carton.items.length > 0)) && (
                                          <div className={cx('mt-0.5 text-[10px]', textSecondaryClass)}>
                                            {dims && <span>{dims}</span>}
                                            {carton.items && carton.items.length > 0 && (
                                              <span>
                                                {dims ? ' · ' : ''}混装 {carton.items.length} 行
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedShipment.customerRelationId && (
                    <div className="mt-4">
                      <RelatedWorkspacesSection
                        sourceType="relation"
                        relationId={selectedShipment.customerRelationId}
                        relationRole="customer"
                        onNavigate={onNavigate}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="bds-empty" style={{ height: '100%', justifyContent: 'center' }}>
                  <div className="glyph"><Truck size={24} strokeWidth={1.5} /></div>
                  <div className="title">请选择运单</div>
                </div>
              )}
            </CompiledSurfacePanel>
          </div>
        </div>
      </main>

      {showFormModal && (
        <div
          className="absolute inset-x-0 top-0 bottom-0 z-[70] bg-transparent"
          onClick={(e) => { if (e.target === e.currentTarget) closeFormModal(); }}
        >
          <div className="h-full w-full overflow-hidden flex flex-col bg-transparent">
            <CompiledModuleTitleBar
              template="shipments.shipment-form.title"
              source="ShipmentManager.form"
              leading={(
                <div className="flex h-full items-center gap-1.5 min-w-0">
                  <button type="button" onClick={closeFormModal} aria-label="返回货运管理" className="bds-btn bds-btn-secondary bds-btn-icon">
                    <ChevronLeft size={18} strokeWidth={1.5} />
                  </button>
                  <h3 className="flex h-9 max-w-64 items-center truncate text-[11px] font-light leading-none tracking-wide text-[var(--text-secondary)]">
                    {editingShipment ? '编辑运单' : '新建运单'}
                  </h3>
                </div>
              )}
              actions={(
                <div className="flex h-full items-center gap-2 shrink-0">
                  <div className="text-[11px] font-light tracking-wide text-[var(--text-tertiary)]">
                    货运管理
                  </div>
                  <button type="button" onClick={closeFormModal} disabled={isSaving} className="bds-btn bds-btn-secondary">
                    取消
                  </button>
                  <button type="submit" form="shipment-fullscreen-form" disabled={isSaving} className="bds-btn bds-btn-primary">
                    <Save size={14} strokeWidth={1.5} />
                    {isSaving ? '保存中…' : '保存'}
                  </button>
                </div>
              )}
            />
            {errorMessage && (
              <div className="w-full px-5 pt-3">
                <div className="bds-alert danger">{errorMessage}</div>
              </div>
            )}
            <form
              id="shipment-fullscreen-form"
              onSubmit={(e) => { e.preventDefault(); void submitForm(); }}
              className="w-full flex-1 min-h-0 px-7 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch"
            >
              <aside className="self-start">
                <CompiledFormMapPanel
                  isDarkMode={isDarkMode}
                  source="ShipmentManager.form-map"
                >
                  <div className="space-y-1">
                    {SHIPMENT_FORM_SECTIONS.map((section, idx) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        className="w-full rounded-full border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] px-3 py-3 text-left transition-colors duration-200 hover:bg-[var(--recessed-bg)] hover:border-[var(--border-c-strong)]"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 shrink-0 rounded-full border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] flex items-center justify-center text-[10px] font-light text-[var(--text-tertiary)] transition-colors">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-light text-[var(--text-primary)]">{section.title}</div>
                            <div className="text-[10px] mt-0.5 truncate text-[var(--text-quaternary)]">{section.desc}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </CompiledFormMapPanel>
              </aside>

              <div ref={formScrollRef} className="min-w-0 -mt-[112px] h-[calc(100%+7rem)] overflow-y-auto overscroll-contain space-y-6 pt-24 pb-[176px] bambook-panel-shadow-viewport">
                {SHIPMENT_FORM_SECTIONS.map(section => (
                  <CompiledFormSectionPanel
                    key={section.id}
                    id={section.id}
                    title={section.title}
                    isDarkMode={isDarkMode}
                    materialRole="raisedCard"
                    contentBaseClassName="grid grid-cols-2 gap-4"
                  >
                    {section.fields.map(renderShipmentField)}
                  </CompiledFormSectionPanel>
                ))}
              </div>
            </form>
          </div>
        </div>
      )}
      {/* C4：装箱编辑器（全屏模态；行级 + 逐箱） */}
      {showPackingEditor && selectedShipment && (
        <PackingEditorModal
          isDarkMode={isDarkMode}
          shipment={selectedShipment}
          initialLines={packingLines}
          initialCartons={packingCartons}
          onClose={() => setShowPackingEditor(false)}
          onSaved={() => {
            setShowPackingEditor(false);
            setPackingRefreshKey(k => k + 1);
            bdsToast.success('装箱明细已保存');
          }}
        />
      )}
      {/* F2：分批出运（全屏模态，复用订单详情 OrderShipmentBatchPanel） */}
      {showBatchPanel && selectedShipment?.orderId && (
        <div
          className="absolute inset-0 z-[70] bg-transparent"
          onClick={(e) => { if (e.target === e.currentTarget) setShowBatchPanel(false); }}
        >
          <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
            <CompiledModuleTitleBar
              template="shipments.batch-panel.title"
              source="ShipmentManager.batch"
              leading={(
                <div className="flex h-full min-w-0 items-center gap-1.5">
                  <button type="button" onClick={() => setShowBatchPanel(false)} aria-label="返回运单详情" className="bds-btn bds-btn-secondary bds-btn-icon">
                    <ChevronLeft size={18} strokeWidth={1.5} />
                  </button>
                  <h3 className="flex h-9 max-w-64 items-center truncate text-[11px] font-light leading-none tracking-wide text-[var(--text-secondary)]">
                    分批出运 · {selectedShipment.shipmentNumber}
                  </h3>
                </div>
              )}
              actions={(
                <div className="flex h-full shrink-0 items-center gap-2">
                  <div className="text-[11px] font-light tracking-wide text-[var(--text-tertiary)]">货运管理</div>
                  <button type="button" onClick={() => setShowBatchPanel(false)} className="bds-btn bds-btn-secondary">关闭</button>
                </div>
              )}
            />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3 pb-5">
              <OrderShipmentBatchPanel orderId={selectedShipment.orderId} isDarkMode={isDarkMode} />
            </div>
          </div>
        </div>
      )}
      {/* F2：合票出运（全屏模态；票内订单分配 DR-016） */}
      {showAllocationPanel && selectedShipment && (
        <AllocationEditorModal
          shipment={selectedShipment}
          onClose={() => setShowAllocationPanel(false)}
          onChanged={(updated) => {
            // 分配变动会触发后端 Shipment.orderId 投影维护，回刷父列表该行
            setShipments(prev => prev.map(s => (s.id === updated.id ? updated : s)));
          }}
        />
      )}
    </div>
  );
};

export default ShipmentManager;

// ────────────────────────────────────────────────────────────────
// C4 装箱编辑器（全屏模态）
//   保存顺序：先整组替换装运行（拿到服务端行 id）→ 行 key→id 映射箱内分配 → 整组替换逐箱。
//   前端预校验与后端一致（箱号必填/正数分配/累计 ≤ 行数量），后端 fail-closed 兜底。
// ────────────────────────────────────────────────────────────────

type PackingLineDraft = {
  key: string;
  id?: string; // 既有行保留服务端 id（仅作箱分配引用锚点；保存时按整组替换语义重建）
  productCode: string;
  productName: string;
  quantity: string;
  unit: string;
  cartons: string;
  grossWeight: string;
  netWeight: string;
  volume: string;
  hsCode: string;
};

type PackingCartonItemDraft = { key: string; lineKey: string; quantity: string };

type PackingCartonDraft = {
  key: string;
  cartonNo: string;
  description: string;
  length: string;
  width: string;
  height: string;
  grossWeight: string;
  netWeight: string;
  volume: string;
  items: PackingCartonItemDraft[];
};

let packingDraftSeq = 0;
const nextDraftKey = (p: string) => `${p}_${Date.now().toString(36)}_${++packingDraftSeq}`;

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function lineDraftFrom(line: ShipmentLine): PackingLineDraft {
  return {
    key: nextDraftKey('PL'),
    id: line.id,
    productCode: line.productCode ?? '',
    productName: line.productName ?? '',
    quantity: line.quantity != null ? String(line.quantity) : '',
    unit: line.unit ?? '',
    cartons: line.cartons != null ? String(line.cartons) : '',
    grossWeight: line.grossWeight != null ? String(line.grossWeight) : '',
    netWeight: line.netWeight != null ? String(line.netWeight) : '',
    volume: line.volume != null ? String(line.volume) : '',
    hsCode: line.hsCode ?? '',
  };
}

function cartonDraftFrom(carton: ShipmentCarton, lineKeyById: Map<string, string>): PackingCartonDraft {
  return {
    key: nextDraftKey('PC'),
    cartonNo: carton.cartonNo ?? '',
    description: carton.description ?? '',
    length: carton.length != null ? String(carton.length) : '',
    width: carton.width != null ? String(carton.width) : '',
    height: carton.height != null ? String(carton.height) : '',
    grossWeight: carton.grossWeight != null ? String(carton.grossWeight) : '',
    netWeight: carton.netWeight != null ? String(carton.netWeight) : '',
    volume: carton.volume != null ? String(carton.volume) : '',
    items: (carton.items ?? [])
      .map(item => {
        const lineKey = lineKeyById.get(item.shipmentLineId);
        return lineKey ? { key: nextDraftKey('PCI'), lineKey, quantity: String(item.quantity) } : null;
      })
      .filter((x): x is PackingCartonItemDraft => x !== null),
  };
}

function PackingEditorModal({
  shipment,
  initialLines,
  initialCartons,
  onClose,
  onSaved,
}: {
  isDarkMode: boolean;
  shipment: ShipmentType;
  initialLines: ShipmentLine[];
  initialCartons: ShipmentCarton[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<PackingLineDraft[]>(() => initialLines.map(lineDraftFrom));
  const [cartons, setCartons] = useState<PackingCartonDraft[]>(() => {
    const lineKeyById = new Map<string, string>();
    initialLines.forEach((l, i) => lineKeyById.set(l.id, lineDraftFrom(l).key));
    // 与 lines state 的 key 对齐：重新生成会导致 key 不一致，故用索引行映射
    return initialCartons.map(c => cartonDraftFrom(c, new Map(initialLines.map((l, i) => [l.id, `__idx_${i}`]))));
  });
  // 上面初始化顺序问题：用 useMemo 一次性构造更稳。重构——见下方 useState 惰性初始化替代。
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'lines' | 'cartons'>('lines');

  const textSecondary = 'text-[var(--text-tertiary)]';
  const fieldClass = 'bds-input sm';

  const updateLine = (key: string, patch: Partial<PackingLineDraft>) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const updateCarton = (key: string, patch: Partial<PackingCartonDraft>) =>
    setCartons(prev => prev.map(c => (c.key === key ? { ...c, ...patch } : c)));

  const validate = (): string | null => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.productName.trim() && !l.productCode.trim()) return `第 ${i + 1} 行需填写品名或货号`;
      const qty = numOrNull(l.quantity);
      if (qty !== null && qty < 0) return `第 ${i + 1} 行数量不能为负`;
      const c = numOrNull(l.cartons);
      if (c !== null && (!Number.isInteger(c) || c < 0)) return `第 ${i + 1} 行箱数必须为非负整数`;
    }
    const allocated = new Map<string, number>();
    for (let i = 0; i < cartons.length; i++) {
      const c = cartons[i];
      if (!c.cartonNo.trim()) return `第 ${i + 1} 箱箱号必填`;
      for (const item of c.items) {
        const qty = numOrNull(item.quantity);
        if (qty === null || qty <= 0) return `箱 ${c.cartonNo} 分配数量必须为正数`;
        if (!lines.some(l => l.key === item.lineKey)) return `箱 ${c.cartonNo} 存在失效的行引用，请移除该分配`;
        allocated.set(item.lineKey, (allocated.get(item.lineKey) ?? 0) + qty);
      }
    }
    for (const [lineKey, total] of allocated) {
      const line = lines.find(l => l.key === lineKey)!;
      const lineQty = numOrNull(line.quantity);
      if (lineQty !== null && total > lineQty) {
        return `行「${line.productName || line.productCode || lineKey}」累计分配 ${total} 超过行数量 ${lineQty}`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true);
    setError('');
    try {
      // 1) 整组替换装运行
      const savedLines = await shipmentService.replaceShipmentLines(shipment.id, lines.map(l => ({
        productCode: l.productCode.trim() || null,
        productName: l.productName.trim() || null,
        quantity: numOrNull(l.quantity),
        unit: l.unit.trim() || null,
        cartons: numOrNull(l.cartons),
        grossWeight: numOrNull(l.grossWeight),
        netWeight: numOrNull(l.netWeight),
        volume: numOrNull(l.volume),
        hsCode: l.hsCode.trim() || null,
      })));
      // 2) 行 key → 服务端行 id（整组替换后按 lineNumber 顺序对齐）
      const lineIdByKey = new Map<string, string>();
      lines.forEach((l, i) => { if (savedLines[i]) lineIdByKey.set(l.key, savedLines[i].id); });
      // 3) 整组替换逐箱
      await shipmentService.replaceShipmentCartons(shipment.id, cartons.map(c => ({
        cartonNo: c.cartonNo.trim(),
        description: c.description.trim() || null,
        length: numOrNull(c.length),
        width: numOrNull(c.width),
        height: numOrNull(c.height),
        grossWeight: numOrNull(c.grossWeight),
        netWeight: numOrNull(c.netWeight),
        volume: numOrNull(c.volume),
        items: c.items
          .map(item => ({ shipmentLineId: lineIdByKey.get(item.lineKey)!, quantity: numOrNull(item.quantity)! }))
          .filter(item => !!item.shipmentLineId),
      })));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[70] bg-transparent"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
        <CompiledModuleTitleBar
          template="shipments.packing-editor.title"
          source="ShipmentManager.packing"
          leading={(
            <div className="flex h-full min-w-0 items-center gap-1.5">
              <button type="button" onClick={onClose} disabled={saving} aria-label="返回运单详情" className="bds-btn bds-btn-secondary bds-btn-icon">
                <ChevronLeft size={18} strokeWidth={1.5} />
              </button>
              <h3 className="flex h-9 max-w-64 items-center truncate text-[11px] font-light leading-none tracking-wide text-[var(--text-secondary)]">
                装箱明细 · {shipment.shipmentNumber}
              </h3>
            </div>
          )}
          actions={(
            <div className="flex h-full shrink-0 items-center gap-2">
              <div className="text-[11px] font-light tracking-wide text-[var(--text-tertiary)]">货运管理</div>
              <button type="button" onClick={onClose} disabled={saving} className="bds-btn bds-btn-secondary">取消</button>
              <button type="button" onClick={() => void handleSave()} disabled={saving} className="bds-btn bds-btn-primary">
                <Save size={14} strokeWidth={1.5} />
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          )}
        />

        {error && (
          <div className="w-full px-5 pt-3">
            <div className="bds-alert danger">{error}</div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col px-5 pt-3 pb-5">
          {/* tab 切换 */}
          <div className="bds-segment shrink-0 self-start">
            {([{ id: 'lines', label: `装运行（${lines.length}）` }, { id: 'cartons', label: `逐箱（${cartons.length}）` }] as const).map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cx('seg', tab === t.id && 'active')}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {tab === 'lines' ? (
              <div className="space-y-2 pb-8">
                {lines.map((line, idx) => (
                  <div key={line.key} className="rounded-inset p-3 bg-[var(--recessed-bg)]">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx('text-[10px] font-light tracking-wide', textSecondary)}>行 {idx + 1}</span>
                      <button type="button" onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))} className="inline-flex h-6 items-center gap-1 rounded-control border border-[var(--border-c-subtle)] px-2 text-[10px] font-light text-[var(--text-tertiary)] transition-colors hover:bg-[var(--hover-darken)]">
                        <X size={14} strokeWidth={1.5} />移除
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                      <input value={line.productCode} onChange={e => updateLine(line.key, { productCode: e.target.value })} placeholder="货号" className={fieldClass} />
                      <input value={line.productName} onChange={e => updateLine(line.key, { productName: e.target.value })} placeholder="品名*" className={fieldClass} />
                      <input value={line.quantity} onChange={e => updateLine(line.key, { quantity: e.target.value })} placeholder="数量" className={fieldClass} />
                      <input value={line.unit} onChange={e => updateLine(line.key, { unit: e.target.value })} placeholder="单位 (m/yd/pcs)" className={fieldClass} />
                      <input value={line.cartons} onChange={e => updateLine(line.key, { cartons: e.target.value })} placeholder="箱数" className={fieldClass} />
                      <input value={line.grossWeight} onChange={e => updateLine(line.key, { grossWeight: e.target.value })} placeholder="毛重 kg" className={fieldClass} />
                      <input value={line.netWeight} onChange={e => updateLine(line.key, { netWeight: e.target.value })} placeholder="净重 kg" className={fieldClass} />
                      <input value={line.volume} onChange={e => updateLine(line.key, { volume: e.target.value })} placeholder="体积 CBM" className={fieldClass} />
                      <input value={line.hsCode} onChange={e => updateLine(line.key, { hsCode: e.target.value })} placeholder="HS 编码" className={fieldClass} />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setLines(prev => [...prev, { key: nextDraftKey('PL'), productCode: '', productName: '', quantity: '', unit: '', cartons: '', grossWeight: '', netWeight: '', volume: '', hsCode: '' }])}
                  className="bds-btn bds-btn-secondary"
                >
                  <Plus size={14} strokeWidth={1.5} />添加装运行
                </button>
              </div>
            ) : (
              <div className="space-y-2 pb-8">
                {lines.length === 0 && (
                  <div className="bds-alert info">
                    请先在「装运行」页签添加行，逐箱分配需引用装运行。
                  </div>
                )}
                {cartons.map((carton, idx) => (
                  <div key={carton.key} className="rounded-inset p-3 bg-[var(--recessed-bg)]">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx('text-[10px] font-light tracking-wide', textSecondary)}>箱 {idx + 1}</span>
                      <button type="button" onClick={() => setCartons(prev => prev.filter(c => c.key !== carton.key))} className="inline-flex h-6 items-center gap-1 rounded-control border border-[var(--border-c-subtle)] px-2 text-[10px] font-light text-[var(--text-tertiary)] transition-colors hover:bg-[var(--hover-darken)]">
                        <X size={14} strokeWidth={1.5} />移除
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                      <input value={carton.cartonNo} onChange={e => updateCarton(carton.key, { cartonNo: e.target.value })} placeholder="箱号*（如 1 或 1-60）" className={fieldClass} />
                      <input value={carton.grossWeight} onChange={e => updateCarton(carton.key, { grossWeight: e.target.value })} placeholder="毛重 kg" className={fieldClass} />
                      <input value={carton.netWeight} onChange={e => updateCarton(carton.key, { netWeight: e.target.value })} placeholder="净重 kg" className={fieldClass} />
                      <input value={carton.volume} onChange={e => updateCarton(carton.key, { volume: e.target.value })} placeholder="体积 CBM（留空按尺寸推导）" className={fieldClass} />
                      <input value={carton.length} onChange={e => updateCarton(carton.key, { length: e.target.value })} placeholder="长 cm" className={fieldClass} />
                      <input value={carton.width} onChange={e => updateCarton(carton.key, { width: e.target.value })} placeholder="宽 cm" className={fieldClass} />
                      <input value={carton.height} onChange={e => updateCarton(carton.key, { height: e.target.value })} placeholder="高 cm" className={fieldClass} />
                      <input value={carton.description} onChange={e => updateCarton(carton.key, { description: e.target.value })} placeholder="箱内货物描述" className={fieldClass} />
                    </div>
                    {/* 箱内分配 */}
                    <div className="mt-2 space-y-1.5">
                      {carton.items.map(item => (
                        <div key={item.key} className="flex items-center gap-2">
                          <select
                            className="bds-select sm flex-1"
                            value={item.lineKey}
                            onChange={e => updateCarton(carton.key, { items: carton.items.map(i => i.key === item.key ? { ...i, lineKey: e.target.value } : i) })}
                          >
                            {lines.map(l => (
                              <option key={l.key} value={l.key}>
                                {l.productName || l.productCode || '（未命名行）'}{l.quantity ? ` · 总量 ${l.quantity}${l.unit ? ` ${l.unit}` : ''}` : ''}
                              </option>
                            ))}
                          </select>
                          <input
                            value={item.quantity}
                            onChange={e => updateCarton(carton.key, { items: carton.items.map(i => i.key === item.key ? { ...i, quantity: e.target.value } : i) })}
                            placeholder="分配数量"
                            className={cx(fieldClass, 'w-28 shrink-0')}
                          />
                          <button
                            type="button"
                            onClick={() => updateCarton(carton.key, { items: carton.items.filter(i => i.key !== item.key) })}
                            className="bds-btn bds-btn-ghost bds-btn-icon shrink-0"
                            aria-label="移除分配"
                          >
                            <X size={14} strokeWidth={1.5} />
                          </button>
                        </div>
                      ))}
                      {lines.length > 0 && (
                        <button
                          type="button"
                          onClick={() => updateCarton(carton.key, { items: [...carton.items, { key: nextDraftKey('PCI'), lineKey: lines[0].key, quantity: '' }] })}
                          className="inline-flex h-7 items-center gap-1 rounded-control border border-[var(--border-c-subtle)] px-2 text-[10px] font-light text-[var(--text-tertiary)] transition-colors hover:bg-[var(--hover-darken)]"
                        >
                          <Plus size={14} strokeWidth={1.5} />添加分配
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCartons(prev => [...prev, { key: nextDraftKey('PC'), cartonNo: String(prev.length + 1), description: '', length: '', width: '', height: '', grossWeight: '', netWeight: '', volume: '', items: [] }])}
                  className="bds-btn bds-btn-secondary"
                >
                  <Plus size={14} strokeWidth={1.5} />添加箱
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// F2 合票出运编辑器（全屏模态；DR-016 ShipmentOrderAllocation 票内订单分配）
//   列表：票内全部分配（订单/数量/状态/备注）；
//   新增：选择订单 + 计划数量 + 备注 → POST /v1/shipping/:id/allocations
//   合票约束（同客户同业务线）由后端 assertConsolidationAllowed 强校验，失败原样透出。
// ────────────────────────────────────────────────────────────────

const ALLOCATION_STATUS_LABELS: Record<string, string> = {
  Planned: '待出运',
  PartiallyShipped: '部分出运',
  Fulfilled: '已出运',
  ShortShipped: '短装',
  Cancelled: '已取消',
};

function AllocationEditorModal({
  shipment,
  onClose,
  onChanged,
}: {
  shipment: ShipmentType;
  onClose: () => void;
  onChanged: (updated: ShipmentType) => void;
}) {
  const [allocations, setAllocations] = useState<ShipmentAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 新增分配表单
  const [orders, setOrders] = useState<import('../types').Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [formOrderId, setFormOrderId] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formUnit, setFormUnit] = useState('');
  const [formNote, setFormNote] = useState('');

  const textSecondary = 'text-[var(--text-tertiary)]';
  const fieldClass = 'bds-input sm';

  const loadAllocations = useCallback(async () => {
    setLoading(true);
    try {
      const items = await shipmentService.listShipmentAllocations(shipment.id);
      setAllocations(items);
    } catch (e) {
      setAllocations([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [shipment.id]);

  useEffect(() => { void loadAllocations(); }, [loadAllocations]);

  // 候选订单（排除已在票内分配的，避免重复分配）
  useEffect(() => {
    let cancelled = false;
    setOrdersLoading(true);
    apiService.listOrders()
      .then(items => { if (!cancelled) setOrders(items); })
      .catch(() => { if (!cancelled) setOrders([]); })
      .finally(() => { if (!cancelled) setOrdersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const allocatedOrderIds = useMemo(() => new Set(allocations.map(a => a.orderId)), [allocations]);
  const candidateOrders = useMemo(
    () => orders.filter(o => !allocatedOrderIds.has(o.id)),
    [orders, allocatedOrderIds],
  );

  const handleAdd = async () => {
    if (saving) return;
    if (!formOrderId) { setError('请选择要合票的订单'); return; }
    const qty = formQty.trim() ? Number(formQty) : null;
    if (formQty.trim() && !Number.isFinite(qty)) { setError('计划数量须为数字'); return; }
    setSaving(true);
    setError('');
    try {
      await shipmentService.createShipmentAllocation(shipment.id, {
        orderId: formOrderId,
        plannedQty: qty,
        unit: formUnit.trim() || null,
        batchOrCartonNote: formNote.trim() || null,
      });
      setFormOrderId(''); setFormQty(''); setFormUnit(''); setFormNote('');
      await loadAllocations();
      // Shipment.orderId 投影可能变动（首条分配派生），回刷父列表
      const fresh = await shipmentService.getShipment(shipment.id).catch(() => null);
      if (fresh) onChanged(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[70] bg-transparent"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
        <CompiledModuleTitleBar
          template="shipments.allocation-editor.title"
          source="ShipmentManager.allocation"
          leading={(
            <div className="flex h-full min-w-0 items-center gap-1.5">
              <button type="button" onClick={onClose} disabled={saving} aria-label="返回运单详情" className="bds-btn bds-btn-secondary bds-btn-icon">
                <ChevronLeft size={18} strokeWidth={1.5} />
              </button>
              <h3 className="flex h-9 max-w-64 items-center truncate text-[11px] font-light leading-none tracking-wide text-[var(--text-secondary)]">
                合票出运 · {shipment.shipmentNumber}
              </h3>
            </div>
          )}
          actions={(
            <div className="flex h-full shrink-0 items-center gap-2">
              <div className="text-[11px] font-light tracking-wide text-[var(--text-tertiary)]">货运管理</div>
              <button type="button" onClick={onClose} disabled={saving} className="bds-btn bds-btn-secondary">关闭</button>
            </div>
          )}
        />

        {error && (
          <div className="w-full px-5 pt-3">
            <div className="bds-alert danger">{error}</div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col px-5 pt-3 pb-5">
          <div className={cx('shrink-0 text-[10px]', textSecondary)}>
            一票运单分配多个订单（合票出运）；合票要求同客户同业务线，由后端强校验。
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className={cx('flex items-center gap-2 py-1 text-[10px]', textSecondary)}>
                <Loader2 size={14} className="animate-spin" />加载票内分配…
              </div>
            ) : allocations.length === 0 ? (
              <div className={cx('py-1 text-[10px]', textSecondary)}>暂无票内分配，可在下方添加订单形成合票。</div>
            ) : (
              <div className="space-y-1.5 pb-4">
                {allocations.map(a => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-inset px-3 py-2 bds-inset">
                    <span className="text-xs font-light text-[var(--text-primary)]">订单 {a.orderId.slice(-8)}</span>
                    <span className={cx('text-[10px] bds-tnum', textSecondary)}>
                      计划 {a.plannedQty != null ? `${a.plannedQty}${a.unit ? ` ${a.unit}` : ''}` : '—'}
                      {a.actualQty != null && ` · 实际 ${a.actualQty}${a.unit ? ` ${a.unit}` : ''}`}
                    </span>
                    {a.status && (
                      <span className={cx('bds-badge sm', a.status === 'Fulfilled' ? 'success' : a.status === 'Cancelled' ? 'neutral' : 'info')}>
                        {ALLOCATION_STATUS_LABELS[a.status] || a.status}
                      </span>
                    )}
                    {a.batchOrCartonNote && <span className={cx('text-[10px]', textSecondary)}>{a.batchOrCartonNote}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* 新增分配（合票） */}
            <div className="rounded-inset p-3 bg-[var(--recessed-bg)]">
              <div className={cx('text-[10px] font-light tracking-wide', textSecondary)}>添加订单到本票（合票）</div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                <select
                  className="bds-select sm col-span-2"
                  value={formOrderId}
                  onChange={e => setFormOrderId(e.target.value)}
                  disabled={ordersLoading || saving}
                >
                  <option value="">{ordersLoading ? '加载订单…' : '— 选择订单 —'}</option>
                  {candidateOrders.map(o => (
                    <option key={o.id} value={o.id}>{o.customer} · 订单 {o.id.slice(-8)}</option>
                  ))}
                </select>
                <input value={formQty} onChange={e => setFormQty(e.target.value)} placeholder="计划数量" className={fieldClass} />
                <input value={formUnit} onChange={e => setFormUnit(e.target.value)} placeholder="单位 (m/yd/pcs)" className={fieldClass} />
                <input value={formNote} onChange={e => setFormNote(e.target.value)} placeholder="批次/箱备注（可选）" className={cx(fieldClass, 'col-span-2 md:col-span-4')} />
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void handleAdd()}
                  disabled={saving || !formOrderId}
                  className="bds-btn bds-btn-primary"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={1.5} />}
                  {saving ? '提交中…' : '添加分配'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
