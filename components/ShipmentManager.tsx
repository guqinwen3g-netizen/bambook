import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Truck, Plus, Search, X, Pencil, Trash2, ChevronLeft, Save, Loader2, Package, ExternalLink, RefreshCw, Box } from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import {
  CompiledFormMapPanel,
  CompiledFormSectionPanel,
  CompiledInteractiveCard,
  CompiledModuleTitleBar,
  CompiledMotionInteractiveCard,
  CompiledSurfacePanel,
  CompiledTableShell,
} from './ui/osCompiler/compiledPrimitives';
import type { Shipment as ShipmentType, ShipmentStatus, ShipmentEvent, ShipmentLine, ShipmentCarton } from '../types';
import { shipmentService } from '../services/shipmentService';
import type { OnTimeStats, MethodStats } from '../services/shipmentService';
import RelatedEntitiesPanel from './RelatedEntitiesPanel';
import { statusSemanticBg, statusSemanticText, StatusSemantic } from './rdlBusinessStatusTokens';

// ── 阶段 IA-3：订单详情下游动作 prime（创建出运预填订单，与 Suppliers preview 同模式） ──
const SHIPMENT_CREATE_PRIME_KEY = 'bambook_shipment_create_prime';

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
}

type ShipmentStatusId = 'all' | ShipmentStatus;

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const SHIPMENT_STATUSES: Array<{ id: ShipmentStatusId; label: string; semantic?: StatusSemantic }> = [
  { id: 'all', label: '全部状态' },
  { id: 'Draft', label: '草稿', semantic: 'neutral' },
  { id: 'Booked', label: '已订舱', semantic: 'info' },
  { id: 'Loading', label: '装货中', semantic: 'active' },
  { id: 'Shipped', label: '已发运', semantic: 'active' },
  { id: 'Arrived', label: '已到港', semantic: 'active' },
  { id: 'Cleared', label: '已清关', semantic: 'active' },
  { id: 'Delivered', label: '已交付', semantic: 'success' },
  { id: 'Cancelled', label: '已取消', semantic: 'neutral' },
];

const statusLabelMap = Object.fromEntries(SHIPMENT_STATUSES.map(item => [item.id, item.label])) as Record<ShipmentStatusId, string>;

// F3：节点语义色（时间轴圆点/文字，沿用 RDL 低饱和语义 token）
const shipmentStatusSemantic = (s: ShipmentStatus): StatusSemantic =>
  SHIPMENT_STATUSES.find(item => item.id === s)?.semantic ?? 'neutral';

const tableColumns = [
  { key: 'shipment', label: '货运单' },
  { key: 'status', label: '状态' },
  { key: 'partner', label: '收货方' },
  { key: 'schedule', label: '物流/日期' },
] as const;

const tableGridClass =
  'grid w-full min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,0.78fr)_minmax(0,0.9fr)_minmax(0,1fr)]';

const SHIPMENT_STATUS_OPTIONS = SHIPMENT_STATUSES.filter(
  (s): s is { id: ShipmentStatus; label: string } => s.id !== 'all',
);


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
}

const SHIPMENT_FORM_SECTIONS: Array<{ id: string; title: string; desc: string; fields: ShipmentFormFieldConfig[] }> = [
  {
    id: 'shipment-basic',
    title: '基本信息',
    desc: '运单号、状态、运输方式',
    fields: [
      { name: 'shipmentNumber', label: '运单号', type: 'text', required: true, placeholder: 'SHIP-2026-001' },
      { name: 'status', label: '状态', type: 'select', required: true, options: SHIPMENT_STATUS_OPTIONS.map(s => ({ value: s.id, label: s.label })) },
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
    id: 'shipment-consignee',
    title: '收货信息',
    desc: '收货方、地址、备注',
    fields: [
      { name: 'customerName', label: '客户', type: 'text' },
      { name: 'carrierName', label: '承运人', type: 'text' },
      { name: 'containerNumber', label: '集装箱号', type: 'text' },
      { name: 'totalPackages', label: '总件数', type: 'text' },
      { name: 'grossWeight', label: '毛重(kg)', type: 'text' },
      { name: 'volume', label: '体积(CBM)', type: 'text' },
      { name: 'notes', label: '备注', type: 'textarea', fullSpan: true },
    ],
  },
];

const statusTone = (status: ShipmentStatus, isDarkMode: boolean) => {
  if (status === 'Delivered') return isDarkMode ? 'border-white/[0.08] bg-white/[0.06] text-white/70' : 'border-slate-300/40 bg-slate-100/60 text-slate-600';
  if (status === 'Shipped' || status === 'Loading' || status === 'Arrived' || status === 'Cleared') return isDarkMode ? 'border-white/[0.08] bg-white/[0.06] text-white/70' : 'border-slate-300/40 bg-slate-100/60 text-slate-600';
  if (status === 'Booked') return isDarkMode ? 'border-white/[0.08] bg-white/[0.06] text-white/70' : 'border-slate-300/40 bg-slate-100/60 text-slate-600';
  if (status === 'Cancelled') return isDarkMode ? 'border-white/[0.07] bg-white/[0.02] text-white/38' : 'border-slate-200/30 bg-slate-50/36 text-slate-400';
  return isDarkMode ? 'border-white/[0.07] bg-white/[0.035] text-white/58' : 'border-slate-300/30 bg-white/36 text-slate-600/78';
};

const ToolbarFilterButton = ({
  active,
  children,
  isDarkMode,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  isDarkMode: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cx(
      'h-8 shrink-0 rounded-control border px-3 text-[10px] font-light tracking-wide transition-all',
      active
        ? isDarkMode
          ? BAMBOOK_OS.controls.selectedSurface.dark
          : BAMBOOK_OS.controls.selectedSurface.light
        : isDarkMode
          ? `${BAMBOOK_OS.controls.toolbar.controlDark} ${BAMBOOK_OS.controls.toolbar.controlIdleDark}`
          : `${BAMBOOK_OS.controls.toolbar.controlLight} ${BAMBOOK_OS.controls.toolbar.controlIdleLight}`,
    )}
  >
    {children}
  </button>
);

const ShipmentManager: React.FC<ShipmentManagerProps> = ({ isDarkMode, shipments, setShipments }) => {
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

  // Derive filtered list from App-level shipments (optimistic display from cache + dataHub)
  const filteredShipments = useMemo(() => {
    let result = shipments;
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
  }, [shipments, selectedStatus, searchTerm]);
  const selectedShipment = filteredShipments.find(item => item.id === selectedId) || filteredShipments[0];

  // F3 — 物流节点时间轴（选中运单时拉取；状态变更后随 selectedShipment.status 联动刷新）
  const [shipmentEvents, setShipmentEvents] = useState<ShipmentEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const selectedShipmentId = selectedShipment?.id;
  const selectedShipmentStatus = selectedShipment?.status;
  useEffect(() => {
    if (!selectedShipmentId) {
      setShipmentEvents([]);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    shipmentService.listShipmentEvents(selectedShipmentId)
      .then(items => { if (!cancelled) setShipmentEvents(items); })
      .catch(() => { if (!cancelled) setShipmentEvents([]); /* 时间轴不可用时不阻断详情面板 */ })
      .finally(() => { if (!cancelled) setEventsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedShipmentId, selectedShipmentStatus]);

  // C4 — 装箱明细（选中运单时拉取行 + 箱；状态变更后联动刷新，保存后手动刷新）
  const [packingLines, setPackingLines] = useState<ShipmentLine[]>([]);
  const [packingCartons, setPackingCartons] = useState<ShipmentCarton[]>([]);
  const [packingLoading, setPackingLoading] = useState(false);
  const [packingRefreshKey, setPackingRefreshKey] = useState(0);
  useEffect(() => {
    if (!selectedShipmentId) {
      setPackingLines([]);
      setPackingCartons([]);
      return;
    }
    let cancelled = false;
    setPackingLoading(true);
    Promise.all([
      shipmentService.listShipmentLines(selectedShipmentId),
      shipmentService.listShipmentCartons(selectedShipmentId),
    ])
      .then(([lines, cartons]) => {
        if (!cancelled) { setPackingLines(lines); setPackingCartons(cartons); }
      })
      .catch(() => { if (!cancelled) { setPackingLines([]); setPackingCartons([]); /* 装箱明细不可用时不阻断详情面板 */ } })
      .finally(() => { if (!cancelled) setPackingLoading(false); });
    return () => { cancelled = true; };
  }, [selectedShipmentId, selectedShipmentStatus, packingRefreshKey]);

  const textPrimaryClass = isDarkMode ? 'text-white/86' : 'text-slate-950';
  const textSecondaryClass = isDarkMode ? 'text-white/52' : 'text-slate-500';
  const tableHeaderClass = isDarkMode ? BAMBOOK_OS.controls.table.headerDark : BAMBOOK_OS.controls.table.headerLight;
  const tableRowHoverClass = isDarkMode ? BAMBOOK_OS.controls.table.rowHoverDark : BAMBOOK_OS.controls.table.rowHoverLight;
  const tableRowSeparatorClass = isDarkMode ? BAMBOOK_OS.controls.table.rowSeparatorDark : BAMBOOK_OS.controls.table.rowSeparatorLight;
  const toolbarSurfaceClass = isDarkMode ? BAMBOOK_OS.controls.toolbar.surfaceDark : BAMBOOK_OS.controls.toolbar.surfaceLight;
  const toolbarSearchClass = isDarkMode ? BAMBOOK_OS.controls.toolbar.searchDark : BAMBOOK_OS.controls.toolbar.searchLight;
  const toolbarSearchShellClass = isDarkMode ? BAMBOOK_OS.controls.toolbar.controlDark : BAMBOOK_OS.controls.toolbar.controlLight;
  const statusChipClass = isDarkMode
    ? 'border-white/[0.065] bg-white/[0.028] text-white/54'
    : 'border-slate-300/28 bg-white/38 text-slate-500';
  const formFieldClass = cx(
    'w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all',
    isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light,
  );
  const formTextareaClass = cx(
    'w-full mt-1 px-4 py-3 rounded-full border outline-none font-light text-xs transition-all resize-none',
    isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light,
  );

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
        const persisted = await shipmentService.updateShipment(editingShipment.id, payload);
        setShipments(prev => prev.map(s => (s.id === persisted.id ? persisted : s)));
      } else {
        const persisted = await shipmentService.createShipment(payload);
        setShipments(prev => [persisted, ...prev]);
        setSelectedId(persisted.id);
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
    if (!window.confirm(`确定要删除运单 ${shipment.shipmentNumber} 吗？此操作不可撤销。`)) return;
    setDeletingId(shipment.id);
    setErrorMessage('');
    try {
      await shipmentService.deleteShipment(shipment.id);
      setShipments(prev => prev.filter(s => s.id !== shipment.id));
      if (selectedId === shipment.id) setSelectedId(null);
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

  const handlePullLines = async () => {
    if (!selectedShipment || pullingLines) return;
    setPullingLines(true);
    setErrorMessage('');
    try {
      await shipmentService.pullLinesFromOrder(selectedShipment.id);
      setPackingRefreshKey(k => k + 1);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPullingLines(false);
    }
  };

  const renderShipmentField = (field: ShipmentFormFieldConfig) => (
    <div key={field.name} className={cx('flex flex-col', field.fullSpan && 'md:col-span-2')}>
      <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>
        {field.label}{field.required && <span className="ml-0.5 text-slate-400">*</span>}
      </label>
      {field.type === 'select' ? (
        <select
          value={formDraft[field.name]}
          onChange={(e) => setFormDraft(prev => ({ ...prev, [field.name]: e.target.value }))}
          className={formFieldClass}
        >
          {!field.required && (
            <option value="" className={isDarkMode ? 'bg-deep text-white/60' : 'bg-white text-slate-500'}>— 不指定 —</option>
          )}
          {field.options?.map(opt => (
            <option key={opt.value} value={opt.value} className={isDarkMode ? 'bg-deep text-white/85' : 'bg-white text-slate-800'}>{opt.label}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={formDraft[field.name]}
          onChange={(e) => setFormDraft(prev => ({ ...prev, [field.name]: e.target.value }))}
          rows={3}
          placeholder={field.placeholder}
          className={formTextareaClass}
        />
      ) : (
        <input
          type="text"
          value={formDraft[field.name]}
          onChange={(e) => setFormDraft(prev => ({ ...prev, [field.name]: e.target.value }))}
          placeholder={field.placeholder}
          className={formFieldClass}
        />
      )}
    </div>
  );

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 overflow-hidden">
      <PageHeader
        title="货运管理"
        subtitle="Shipments & Logistics"
        contextLabel="Shipment Desk"
        isDarkMode={isDarkMode}
        hidden={showFormModal}
        actions={(
          <button
            type="button"
            onClick={openCreateModal}
            className={cx(
              BAMBOOK_OS.controls.title.actionButton,
              isDarkMode
                ? 'border-white/[0.085] bg-white/[0.04] text-white/72 hover:bg-white/[0.08]'
                : 'border-slate-200/60 bg-white/60 text-slate-600 hover:bg-white/90',
            )}
          >
            <Plus size={14} strokeWidth={1.4} />
            新建运单
          </button>
        )}
      />

      <main className={cx(BAMBOOK_OS.layout.desktopSinglePanelBodyClass, BAMBOOK_OS.layout.desktopPageCanvasClass, showFormModal && 'hidden')}>
        <div className="flex h-full min-h-0 flex-col gap-3">
          {errorMessage && !showFormModal && (
            <div className={cx('flex items-start justify-between gap-3 rounded-inset border px-4 py-2.5 text-[11px] font-light', isDarkMode ? 'border-white/[0.08] bg-white/[0.04] text-white/55' : 'border-slate-200 bg-slate-100/60 text-slate-500')}>
              <span className="break-words">{errorMessage}</span>
              <button type="button" onClick={() => setErrorMessage('')} className={cx('mt-px shrink-0', isDarkMode ? 'text-white/40 hover:text-white/70' : 'text-slate-400 hover:text-slate-600')}>
                <X size={12} strokeWidth={1.6} />
              </button>
            </div>
          )}
          <div className={cx(BAMBOOK_OS.controls.toolbar.base, 'h-auto min-h-9 overflow-hidden py-1', toolbarSurfaceClass)}>
            <span className={BAMBOOK_OS.controls.toolbar.ambient} aria-hidden="true" />
            <div className={cx(BAMBOOK_OS.controls.toolbar.content, '!h-auto min-h-9 flex-wrap gap-x-2 gap-y-2 py-1.5')}>
              <label className={cx('flex h-9 min-w-[188px] flex-[1_1_220px] items-center gap-2 rounded-control border px-3 text-[11px] font-light', toolbarSearchShellClass)}>
                <Search size={13} strokeWidth={1.2} className={isDarkMode ? 'text-white/38' : 'text-slate-400'} />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="运单号 / 收货方"
                  className={cx('min-w-0 flex-1 bg-transparent text-[11px] font-light outline-none', toolbarSearchClass)}
                />
              </label>
              <div className={cx('hidden h-4 w-px shrink-0 xl:block', isDarkMode ? 'bg-white/8' : 'bg-slate-300/32')} />
              <div className="flex min-w-0 flex-[1_1_auto] items-center gap-1 overflow-x-auto">
                {SHIPMENT_STATUSES.map(item => (
                  <ToolbarFilterButton key={item.id} active={selectedStatus === item.id} isDarkMode={isDarkMode} onClick={() => setSelectedStatus(item.id)}>
                    {item.label}
                  </ToolbarFilterButton>
                ))}
              </div>
            </div>
          </div>

          {/* Phase B3 — 准交率统计条（只读，口径：订单最后一票 ata ≤ dueDate / 运单 ata ≤ eta） */}
          {onTimeStats && (onTimeStats.order.total > 0 || onTimeStats.shipment.total > 0) && (
            <div className={cx('flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1.5 rounded-inset border px-4 py-2', toolbarSurfaceClass)}>
              <div className="flex items-baseline gap-2">
                <span className={cx('text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>订单准交率</span>
                <span className={cx('text-sm font-light tabular-nums', textPrimaryClass)}>
                  {onTimeStats.order.rate == null ? '—' : `${(onTimeStats.order.rate * 100).toFixed(1)}%`}
                </span>
                <span className={cx('text-[10px] font-light tabular-nums', textSecondaryClass)}>
                  准交 {onTimeStats.order.onTime} / 可判定 {onTimeStats.order.total - onTimeStats.order.pending}
                  {onTimeStats.order.pending > 0 && ` · 待出运 ${onTimeStats.order.pending}`}
                </span>
              </div>
              <div className={cx('hidden h-4 w-px xl:block', isDarkMode ? 'bg-white/8' : 'bg-slate-300/32')} />
              <div className="flex items-baseline gap-2">
                <span className={cx('text-[10px] font-light tracking-[0.14em]', textSecondaryClass)}>运单准点率</span>
                <span className={cx('text-sm font-light tabular-nums', textPrimaryClass)}>
                  {onTimeStats.shipment.rate == null ? '—' : `${(onTimeStats.shipment.rate * 100).toFixed(1)}%`}
                </span>
                <span className={cx('text-[10px] font-light tabular-nums', textSecondaryClass)}>
                  准点 {onTimeStats.shipment.onTime} / {onTimeStats.shipment.total}
                </span>
              </div>
              {/* C4：运输方式 chips（总量 · 在途 · 准点率） */}
              {methodStats && methodStats.methods.length > 0 && (
                <>
                  <div className={cx('hidden h-4 w-px xl:block', isDarkMode ? 'bg-white/8' : 'bg-slate-300/32')} />
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {methodStats.methods.slice(0, 6).map(m => (
                      <span
                        key={m.method}
                        title={`${m.method}：共 ${m.total} 票 · 在途 ${m.inTransit} · 已交付 ${m.delivered}${m.onTimeRate != null ? ` · 准点率 ${(m.onTimeRate * 100).toFixed(1)}%` : ''}`}
                        className={cx('inline-flex items-baseline gap-1.5 rounded-control border px-2.5 py-1 text-[10px] font-light tracking-wide', statusChipClass)}
                      >
                        <span>{m.method}</span>
                        <span className="tabular-nums">{m.total}票</span>
                        {m.inTransit > 0 && <span className="tabular-nums">在途{m.inTransit}</span>}
                        {m.onTimeRate != null && <span className="tabular-nums">{(m.onTimeRate * 100).toFixed(0)}%</span>}
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
                <div className={cx(tableGridClass, 'border-b text-[10px] font-light tracking-[0.16em]', tableHeaderClass, textSecondaryClass)}>
                  {tableColumns.map(column => (
                    <div key={column.key} className={cx('min-w-0', BAMBOOK_OS.spacing.cellPadding)}>{column.label}</div>
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
                      spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                      spotlightSize={isDarkMode ? 240 : 190}
                      idleSpotlightOpacity={0}
                      liquidSpotlight
                      liquidSpotlightTone="light"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.025 }}
                      className={cx(
                        tableGridClass,
                        'group relative isolate w-full overflow-hidden text-left transition-[background,color,transform] duration-200',
                        tableRowHoverClass,
                        active && (isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light),
                      )}
                    >
                      <span className={cx('pointer-events-none absolute inset-x-0 bottom-0 z-20 h-px', tableRowSeparatorClass)} aria-hidden="true" />
                      <div className={cx('relative z-10 min-w-0', BAMBOOK_OS.spacing.cellContentPadding)}>
                        <div className={cx('truncate font-light', textPrimaryClass)}>{item.shipmentNumber}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.shippingMethod || '—'} · {item.carrierName || '—'}</div>
                      </div>
                      <div className={cx('relative z-10 min-w-0', BAMBOOK_OS.spacing.cellContentPadding)}>
                        <span className={cx('inline-flex rounded-control border px-2.5 py-1 text-[10px] font-light tracking-wide', statusTone(item.status, isDarkMode))}>
                          {statusLabelMap[item.status]}
                        </span>
                      </div>
                      <div className={cx('relative z-10 min-w-0', BAMBOOK_OS.spacing.cellContentPadding)}>
                        <div className={cx('truncate font-light', textPrimaryClass)}>{item.customerName || '—'}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.orderId ? '订单 ' + item.orderId.slice(-8) : '无关联订单'}</div>
                      </div>
                      <div className={cx('relative z-10 min-w-0', BAMBOOK_OS.spacing.cellContentPadding)}>
                        <div className={cx('truncate font-light', textPrimaryClass)}>{item.vesselOrFlight || item.voyageNumber || '—'}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.etd || '—'} → {item.eta || '—'}</div>
                      </div>
                    </CompiledMotionInteractiveCard>
                  );
                })}
                {filteredShipments.length === 0 && (
                  <div className={cx('flex h-56 flex-col items-center justify-center text-center', textSecondaryClass)}>
                    <Truck size={28} strokeWidth={1} className="mb-3 opacity-45" />
                    <div className="text-sm font-light">暂无匹配运单</div>
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
                  <div className={cx('shrink-0 border-b', BAMBOOK_OS.spacing.detailPanelPadding, isDarkMode ? 'border-white/[0.045]' : 'border-white/36')}>
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>当前运单</div>
                        <div className={cx('mt-2 truncate text-base font-light', textPrimaryClass)}>{selectedShipment.shipmentNumber}</div>
                        <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{selectedShipment.shippingMethod || '—'} · {selectedShipment.carrierName || '—'}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className={cx('inline-flex rounded-control border px-2.5 py-1 text-[10px] font-light tracking-wide', statusTone(selectedShipment.status, isDarkMode))}>
                          {statusLabelMap[selectedShipment.status]}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(selectedShipment)}
                            className={cx('h-8 inline-flex items-center gap-1 rounded-control border px-2.5 text-[10px] font-light tracking-wide transition-colors', isDarkMode ? 'border-white/[0.085] bg-white/[0.035] text-white/62 hover:bg-white/[0.07]' : 'border-slate-200/60 bg-white/50 text-slate-500 hover:bg-white/85')}
                          >
                            <Pencil size={11} strokeWidth={1.4} />
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(selectedShipment)} disabled={deletingId !== null}
                            className={cx('h-8 inline-flex items-center gap-1 rounded-control border px-2.5 text-[10px] font-light tracking-wide transition-colors', isDarkMode ? 'border-white/[0.08] bg-white/[0.04] text-white/55 hover:bg-white/[0.06]' : 'border-slate-300/40 bg-slate-100/50 text-slate-500 hover:bg-slate-100/60')}
                          >
                            <Trash2 size={11} strokeWidth={1.4} />
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={cx('min-h-0 flex-1 overflow-y-auto', BAMBOOK_OS.spacing.detailPanelPadding)}>
                    <div className="space-y-1">
                      {inspectorRows.map(row => (
                        <div key={row.label} className={cx('grid grid-cols-[72px_minmax(0,1fr)] items-baseline', BAMBOOK_OS.spacing.attrRowGap)}>
                          <div className={cx('text-[10px] font-light tracking-wide', textSecondaryClass)}>{row.label}</div>
                          <div className={cx('truncate text-xs font-light', textPrimaryClass)}>{row.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className={cx('my-4 h-px w-full', isDarkMode ? 'bg-white/[0.055]' : 'bg-slate-200/55')} />
                    <div className={cx('rounded-inset border', BAMBOOK_OS.spacing.nestedPanelPadding, isDarkMode ? 'border-[var(--os-vnext-brand-blue-soft)]/12 bg-[var(--os-vnext-brand-blue)]/[0.045]' : 'border-[var(--os-vnext-brand-blue)]/16 bg-[var(--os-vnext-brand-blue)]/[0.045]')}>
                      <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>物流轨迹</div>
                      <div className={cx('mt-2 text-sm font-light', textPrimaryClass)}>
                        {selectedShipment.portOfLoading || '?'} → {selectedShipment.portOfDischarge || '?'}
                      </div>
                      <div className={cx('mt-1 text-[10px] font-light', textSecondaryClass)}>
                        离港 {selectedShipment.etd || '?'} · 到港 {selectedShipment.eta || '?'}
                        {selectedShipment.ata && ` · 实际到港 ${selectedShipment.ata}`}
                      </div>
                      {/* C4：物流跟踪号 + 承运商查询跳转 */}
                      {(selectedShipment.trackingNumber || selectedShipment.carrierTrackingUrl) && (
                        <div className={cx('mt-2 flex items-center gap-2 text-[10px] font-light', textSecondaryClass)}>
                          <span className="truncate">跟踪号 {selectedShipment.trackingNumber || '—'}</span>
                          {selectedShipment.carrierTrackingUrl && (
                            <a
                              href={selectedShipment.carrierTrackingUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className={cx('inline-flex shrink-0 items-center gap-1 rounded-control border px-2 py-0.5 transition-colors', isDarkMode ? 'border-white/[0.085] bg-white/[0.035] text-white/62 hover:bg-white/[0.07]' : 'border-slate-200/60 bg-white/50 text-slate-500 hover:bg-white/85')}
                            >
                              <ExternalLink size={10} strokeWidth={1.4} />
                              承运商查询
                            </a>
                          )}
                        </div>
                      )}
                      {/* F3：节点时间轴（ShipmentEvent 订舱→装货→发运→到港→清关→交付） */}
                      <div className={cx('mt-3 pt-3 border-t', isDarkMode ? 'border-white/[0.055]' : 'border-white/50')}>
                        {eventsLoading ? (
                          <div className={cx('flex items-center gap-2 py-1 text-[10px] font-light', textSecondaryClass)}>
                            <Loader2 size={11} className="animate-spin" />加载节点时间轴…
                          </div>
                        ) : shipmentEvents.length === 0 ? (
                          <div className={cx('py-1 text-[10px] font-light', textSecondaryClass)}>暂无节点记录</div>
                        ) : (
                          <div className="space-y-0">
                            {shipmentEvents.map((ev, idx) => {
                              const semantic = shipmentStatusSemantic(ev.toNode);
                              const isLast = idx === shipmentEvents.length - 1;
                              return (
                                <div key={ev.id} className="flex gap-2.5">
                                  <div className="flex flex-col items-center shrink-0 w-2.5 pt-1">
                                    <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', statusSemanticBg(semantic, isDarkMode))} />
                                    {!isLast && <span className={cx('flex-1 w-px', isDarkMode ? 'bg-white/[0.08]' : 'bg-slate-200/70')} />}
                                  </div>
                                  <div className={cx('flex-1 min-w-0', isLast ? 'pb-0.5' : 'pb-3')}>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={cx('text-xs font-light', statusSemanticText(semantic, isDarkMode))}>{statusLabelMap[ev.toNode] || ev.toNode}</span>
                                      <span className={cx('text-[10px] font-light', textSecondaryClass)}>{ev.eventDate}</span>
                                      {ev.actorId && <span className={cx('text-[10px] font-light', isDarkMode ? 'text-white/32' : 'text-slate-400/80')}>操作人: {ev.actorId}</span>}
                                    </div>
                                    {ev.note && (
                                      <div className={cx('mt-1 px-2 py-1 rounded-inset text-[11px] font-light', isDarkMode ? 'bg-white/[0.02] text-white/45' : 'bg-white/50 text-slate-500')}>{ev.note}</div>
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
                      <div className={cx('rounded-inset border', BAMBOOK_OS.spacing.nestedPanelPadding, isDarkMode ? 'border-white/[0.055] bg-white/[0.02]' : 'border-slate-200/55 bg-white/40')}>
                        <div className="flex items-center justify-between gap-2">
                          <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>装箱明细</div>
                          <div className="flex items-center gap-1.5">
                            {selectedShipment.orderId && packingEditable && (
                              <button
                                type="button"
                                onClick={handlePullLines}
                                disabled={pullingLines}
                                title="从关联订单重新带出装运行（覆盖现有行）"
                                className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light tracking-wide transition-colors disabled:opacity-50', isDarkMode ? 'border-white/[0.085] bg-white/[0.035] text-white/62 hover:bg-white/[0.07]' : 'border-slate-200/60 bg-white/50 text-slate-500 hover:bg-white/85')}
                              >
                                {pullingLines ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} strokeWidth={1.4} />}
                                从订单带出
                              </button>
                            )}
                            {packingEditable && (
                              <button
                                type="button"
                                onClick={() => setShowPackingEditor(true)}
                                className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light tracking-wide transition-colors', isDarkMode ? 'border-white/[0.085] bg-white/[0.035] text-white/62 hover:bg-white/[0.07]' : 'border-slate-200/60 bg-white/50 text-slate-500 hover:bg-white/85')}
                              >
                                <Package size={10} strokeWidth={1.4} />
                                编辑装箱
                              </button>
                            )}
                          </div>
                        </div>
                        {packingLoading ? (
                          <div className={cx('mt-2 flex items-center gap-2 py-1 text-[10px] font-light', textSecondaryClass)}>
                            <Loader2 size={11} className="animate-spin" />加载装箱明细…
                          </div>
                        ) : packingLines.length === 0 && packingCartons.length === 0 ? (
                          <div className={cx('mt-2 py-1 text-[10px] font-light', textSecondaryClass)}>
                            暂无装箱明细{packingEditable && selectedShipment.orderId ? '，可点击「从订单带出」快速生成装运行' : ''}
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2.5">
                            {packingLines.length > 0 && (
                              <div>
                                <div className={cx('text-[10px] font-light', textSecondaryClass)}>装运行（{packingLines.length}）</div>
                                <div className="mt-1 space-y-1">
                                  {packingLines.map(line => (
                                    <div key={line.id} className={cx('flex items-baseline justify-between gap-2 rounded-inset px-2 py-1', isDarkMode ? 'bg-white/[0.025]' : 'bg-white/55')}>
                                      <span className={cx('min-w-0 truncate text-[11px] font-light', textPrimaryClass)}>
                                        {line.productName || line.productCode || `行 ${line.lineNumber ?? ''}`}
                                      </span>
                                      <span className={cx('shrink-0 text-[10px] font-light tabular-nums', textSecondaryClass)}>
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
                                <div className={cx('text-[10px] font-light', textSecondaryClass)}>逐箱（{packingCartons.length}）</div>
                                <div className="mt-1 space-y-1">
                                  {packingCartons.map(carton => {
                                    const dims = [carton.length, carton.width, carton.height].every(v => v != null)
                                      ? `${carton.length}×${carton.width}×${carton.height}cm` : null;
                                    return (
                                      <div key={carton.id} className={cx('rounded-inset px-2 py-1', isDarkMode ? 'bg-white/[0.025]' : 'bg-white/55')}>
                                        <div className="flex items-baseline justify-between gap-2">
                                          <span className={cx('inline-flex min-w-0 items-center gap-1 text-[11px] font-light', textPrimaryClass)}>
                                            <Box size={10} strokeWidth={1.4} className="shrink-0 opacity-60" />
                                            <span className="truncate">C/NO {carton.cartonNo}</span>
                                          </span>
                                          <span className={cx('shrink-0 text-[10px] font-light tabular-nums', textSecondaryClass)}>
                                            {carton.grossWeight != null ? `${carton.grossWeight}kg` : '—'}
                                            {carton.volume != null && ` · ${Number(carton.volume).toFixed(3)}CBM`}
                                          </span>
                                        </div>
                                        {(dims || (carton.items && carton.items.length > 0)) && (
                                          <div className={cx('mt-0.5 text-[10px] font-light', textSecondaryClass)}>
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
                    <div className="mt-4">
                      <RelatedEntitiesPanel
                        type="shipment"
                        id={selectedShipment.id}
                        isDarkMode={isDarkMode}
                        title="运单关联视图"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondaryClass)}>
                  <Truck size={28} strokeWidth={1} className="mb-3 opacity-45" />
                  <div className="text-sm font-light">请选择运单</div>
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
                  <CompiledInteractiveCard
                    spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                    spotlightSize={isDarkMode ? 240 : 190}
                    idleSpotlightOpacity={0}
                    activeSpotlightOpacity={1}
                    className={cx(BAMBOOK_OS.controls.title.iconButton, isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light)}
                  >
                    <button type="button" onClick={closeFormModal} aria-label="返回货运管理" className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center">
                      <ChevronLeft size={18} strokeWidth={1.4} />
                    </button>
                  </CompiledInteractiveCard>
                  <h3 className={cx(BAMBOOK_OS.controls.title.pageLabel, isDarkMode ? 'text-white/70' : 'text-slate-700')}>
                    {editingShipment ? '编辑运单' : '新建运单'}
                  </h3>
                </div>
              )}
              actions={(
                <div className="flex h-full items-center gap-2 shrink-0">
                  <div className={cx('text-[11px] font-light tracking-wide', isDarkMode ? 'text-white/48' : 'text-slate-400')}>
                    货运管理
                  </div>
                  <CompiledInteractiveCard
                    spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                    spotlightSize={isDarkMode ? 240 : 190}
                    idleSpotlightOpacity={0}
                    activeSpotlightOpacity={1}
                    className={cx(BAMBOOK_OS.controls.title.actionButton, isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light)}
                  >
                    <button type="button" onClick={closeFormModal} disabled={isSaving} className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center disabled:cursor-not-allowed">
                      取消
                    </button>
                  </CompiledInteractiveCard>
                  <CompiledInteractiveCard
                    spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                    spotlightSize={isDarkMode ? 240 : 190}
                    idleSpotlightOpacity={0}
                    activeSpotlightOpacity={1}
                    className={cx(BAMBOOK_OS.controls.title.actionButton, isSaving ? 'opacity-60 cursor-not-allowed border-transparent' : isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light)}
                  >
                    <button type="submit" form="shipment-fullscreen-form" disabled={isSaving} className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2 disabled:cursor-not-allowed">
                      <Save size={14} strokeWidth={1.5} />
                      {isSaving ? '保存中…' : '保存'}
                    </button>
                  </CompiledInteractiveCard>
                </div>
              )}
            />
            {errorMessage && (
              <div className={cx('w-full px-5 pt-3 text-xs font-light', isDarkMode ? 'text-white/55' : 'text-slate-500')}>
                {errorMessage}
              </div>
            )}
            <form
              id="shipment-fullscreen-form"
              onSubmit={(e) => { e.preventDefault(); void submitForm(); }}
              className="w-full flex-1 min-h-0 px-5 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch"
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
                        className={cx(
                          'w-full text-left rounded-full border px-3 py-3 transition-all',
                          isDarkMode
                            ? 'border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.05] hover:border-white/[0.1]'
                            : 'border-slate-200/50 bg-white/30 hover:bg-white/60 hover:border-slate-300/60',
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span className={cx('w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-[10px] font-light transition-colors', isDarkMode ? 'border-white/[0.1] bg-white/[0.04] text-white/60' : 'border-slate-200 bg-white/50 text-slate-400')}>
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className={cx('text-xs font-light', isDarkMode ? 'text-white/75' : 'text-slate-800')}>{section.title}</div>
                            <div className={cx('text-[10px] mt-0.5 truncate', isDarkMode ? 'text-white/38' : 'text-slate-400')}>{section.desc}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </CompiledFormMapPanel>
              </aside>

              <div ref={formScrollRef} className={cx('min-w-0 -mt-[112px] h-[calc(100%+7rem)] overflow-y-auto overscroll-contain space-y-6 pt-24 pb-[176px]', BAMBOOK_OS.layout.panelShadowViewportClass)}>
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
  isDarkMode,
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

  const textPrimary = isDarkMode ? 'text-white/86' : 'text-slate-950';
  const textSecondary = isDarkMode ? 'text-white/52' : 'text-slate-500';
  const fieldClass = cx(
    'h-8 w-full rounded-control border px-2.5 text-[11px] font-light outline-none transition-all',
    isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light,
  );

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
              <CompiledInteractiveCard
                spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                spotlightSize={isDarkMode ? 240 : 190}
                idleSpotlightOpacity={0}
                activeSpotlightOpacity={1}
                className={cx(BAMBOOK_OS.controls.title.iconButton, isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light)}
              >
                <button type="button" onClick={onClose} disabled={saving} aria-label="返回运单详情" className="relative z-10 flex h-full w-full items-center justify-center rounded-[inherit]">
                  <ChevronLeft size={18} strokeWidth={1.4} />
                </button>
              </CompiledInteractiveCard>
              <h3 className={cx(BAMBOOK_OS.controls.title.pageLabel, isDarkMode ? 'text-white/70' : 'text-slate-700')}>
                装箱明细 · {shipment.shipmentNumber}
              </h3>
            </div>
          )}
          actions={(
            <div className="flex h-full shrink-0 items-center gap-2">
              <div className={cx('text-[11px] font-light tracking-wide', isDarkMode ? 'text-white/48' : 'text-slate-400')}>货运管理</div>
              <CompiledInteractiveCard
                spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                spotlightSize={isDarkMode ? 240 : 190}
                idleSpotlightOpacity={0}
                activeSpotlightOpacity={1}
                className={cx(BAMBOOK_OS.controls.title.actionButton, isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light)}
              >
                <button type="button" onClick={onClose} disabled={saving} className="relative z-10 flex h-full w-full items-center justify-center rounded-[inherit] disabled:cursor-not-allowed">取消</button>
              </CompiledInteractiveCard>
              <CompiledInteractiveCard
                spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                spotlightSize={isDarkMode ? 240 : 190}
                idleSpotlightOpacity={0}
                activeSpotlightOpacity={1}
                className={cx(BAMBOOK_OS.controls.title.actionButton, saving ? 'cursor-not-allowed border-transparent opacity-60' : isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light)}
              >
                <button type="button" onClick={() => void handleSave()} disabled={saving} className="relative z-10 flex h-full w-full items-center justify-center gap-2 rounded-[inherit] disabled:cursor-not-allowed">
                  <Save size={14} strokeWidth={1.5} />
                  {saving ? '保存中…' : '保存'}
                </button>
              </CompiledInteractiveCard>
            </div>
          )}
        />

        {error && (
          <div className={cx('w-full px-5 pt-3 text-xs font-light', isDarkMode ? 'text-white/55' : 'text-slate-500')}>{error}</div>
        )}

        <div className="flex min-h-0 flex-1 flex-col px-5 pt-3 pb-5">
          {/* tab 切换 */}
          <div className="flex shrink-0 items-center gap-1.5">
            {([{ id: 'lines', label: `装运行（${lines.length}）` }, { id: 'cartons', label: `逐箱（${cartons.length}）` }] as const).map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cx(
                  'h-8 rounded-control border px-3 text-[10px] font-light tracking-wide transition-all',
                  tab === t.id
                    ? isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light
                    : isDarkMode
                      ? `${BAMBOOK_OS.controls.toolbar.controlDark} ${BAMBOOK_OS.controls.toolbar.controlIdleDark}`
                      : `${BAMBOOK_OS.controls.toolbar.controlLight} ${BAMBOOK_OS.controls.toolbar.controlIdleLight}`,
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {tab === 'lines' ? (
              <div className="space-y-2 pb-8">
                {lines.map((line, idx) => (
                  <div key={line.key} className={cx('rounded-inset border p-3', isDarkMode ? 'border-white/[0.055] bg-white/[0.02]' : 'border-slate-200/55 bg-white/50')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx('text-[10px] font-light tracking-wide', textSecondary)}>行 {idx + 1}</span>
                      <button type="button" onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))} className={cx('inline-flex h-6 items-center gap-1 rounded-control border px-2 text-[10px] font-light', isDarkMode ? 'border-white/[0.08] text-white/50 hover:bg-white/[0.05]' : 'border-slate-200/60 text-slate-400 hover:bg-white/70')}>
                        <X size={10} strokeWidth={1.4} />移除
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
                  className={cx('inline-flex h-8 items-center gap-1.5 rounded-control border px-3 text-[10px] font-light tracking-wide', isDarkMode ? 'border-white/[0.085] bg-white/[0.035] text-white/62 hover:bg-white/[0.07]' : 'border-slate-200/60 bg-white/50 text-slate-500 hover:bg-white/85')}
                >
                  <Plus size={11} strokeWidth={1.4} />添加装运行
                </button>
              </div>
            ) : (
              <div className="space-y-2 pb-8">
                {lines.length === 0 && (
                  <div className={cx('rounded-inset border px-3 py-2 text-[11px] font-light', isDarkMode ? 'border-white/[0.055] bg-white/[0.02] text-white/45' : 'border-slate-200/55 bg-white/50 text-slate-400')}>
                    请先在「装运行」页签添加行，逐箱分配需引用装运行。
                  </div>
                )}
                {cartons.map((carton, idx) => (
                  <div key={carton.key} className={cx('rounded-inset border p-3', isDarkMode ? 'border-white/[0.055] bg-white/[0.02]' : 'border-slate-200/55 bg-white/50')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx('text-[10px] font-light tracking-wide', textSecondary)}>箱 {idx + 1}</span>
                      <button type="button" onClick={() => setCartons(prev => prev.filter(c => c.key !== carton.key))} className={cx('inline-flex h-6 items-center gap-1 rounded-control border px-2 text-[10px] font-light', isDarkMode ? 'border-white/[0.08] text-white/50 hover:bg-white/[0.05]' : 'border-slate-200/60 text-slate-400 hover:bg-white/70')}>
                        <X size={10} strokeWidth={1.4} />移除
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
                            value={item.lineKey}
                            onChange={e => updateCarton(carton.key, { items: carton.items.map(i => i.key === item.key ? { ...i, lineKey: e.target.value } : i) })}
                            className={cx(fieldClass, 'flex-1')}
                          >
                            {lines.map(l => (
                              <option key={l.key} value={l.key} className={isDarkMode ? 'bg-deep text-white/85' : 'bg-white text-slate-800'}>
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
                            className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border', isDarkMode ? 'border-white/[0.08] text-white/50 hover:bg-white/[0.05]' : 'border-slate-200/60 text-slate-400 hover:bg-white/70')}
                            aria-label="移除分配"
                          >
                            <X size={10} strokeWidth={1.4} />
                          </button>
                        </div>
                      ))}
                      {lines.length > 0 && (
                        <button
                          type="button"
                          onClick={() => updateCarton(carton.key, { items: [...carton.items, { key: nextDraftKey('PCI'), lineKey: lines[0].key, quantity: '' }] })}
                          className={cx('inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[10px] font-light', isDarkMode ? 'border-white/[0.07] text-white/50 hover:bg-white/[0.04]' : 'border-slate-200/50 text-slate-400 hover:bg-white/60')}
                        >
                          <Plus size={10} strokeWidth={1.4} />添加分配
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCartons(prev => [...prev, { key: nextDraftKey('PC'), cartonNo: String(prev.length + 1), description: '', length: '', width: '', height: '', grossWeight: '', netWeight: '', volume: '', items: [] }])}
                  className={cx('inline-flex h-8 items-center gap-1.5 rounded-control border px-3 text-[10px] font-light tracking-wide', isDarkMode ? 'border-white/[0.085] bg-white/[0.035] text-white/62 hover:bg-white/[0.07]' : 'border-slate-200/60 bg-white/50 text-slate-500 hover:bg-white/85')}
                >
                  <Plus size={11} strokeWidth={1.4} />添加箱
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
