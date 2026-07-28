import React, { useMemo, useRef, useState } from 'react';
import { Truck, Plus, Search, X, Pencil, Trash2, ChevronLeft, Save } from 'lucide-react';
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
import type { Shipment as ShipmentType, ShipmentStatus } from '../types';
import { shipmentService } from '../services/shipmentService';
import RelatedEntitiesPanel from './RelatedEntitiesPanel';

interface ShipmentManagerProps {
  isDarkMode: boolean;
  shipments: ShipmentType[];
  setShipments: React.Dispatch<React.SetStateAction<ShipmentType[]>>;
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
      'h-7 shrink-0 rounded-xl border px-3 text-[10px] font-light tracking-wide transition-all',
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
              <label className={cx('flex h-7 min-w-[188px] flex-[1_1_220px] items-center gap-2 rounded-xl border px-2.5 text-[11px] font-light', toolbarSearchShellClass)}>
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
                        <span className={cx('inline-flex rounded-xl border px-2.5 py-1 text-[10px] font-light tracking-wide', statusTone(item.status, isDarkMode))}>
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
                        <span className={cx('inline-flex rounded-xl border px-2.5 py-1 text-[10px] font-light tracking-wide', statusTone(selectedShipment.status, isDarkMode))}>
                          {statusLabelMap[selectedShipment.status]}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(selectedShipment)}
                            className={cx('h-7 inline-flex items-center gap-1 rounded-xl border px-2.5 text-[10px] font-light tracking-wide transition-colors', isDarkMode ? 'border-white/[0.085] bg-white/[0.035] text-white/62 hover:bg-white/[0.07]' : 'border-slate-200/60 bg-white/50 text-slate-500 hover:bg-white/85')}
                          >
                            <Pencil size={11} strokeWidth={1.4} />
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(selectedShipment)} disabled={deletingId !== null}
                            className={cx('h-7 inline-flex items-center gap-1 rounded-xl border px-2.5 text-[10px] font-light tracking-wide transition-colors', isDarkMode ? 'border-white/[0.08] bg-white/[0.04] text-white/55 hover:bg-white/[0.06]' : 'border-slate-300/40 bg-slate-100/50 text-slate-500 hover:bg-slate-100/60')}
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
    </div>
  );
};

export default ShipmentManager;
