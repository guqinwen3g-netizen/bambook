import React, { useMemo, useRef, useState, useCallback } from 'react';
import { ChevronLeft, PackageCheck, Plus, Pencil, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
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
import { developmentService } from '../services/developmentService';
import CustomSelect from './ui/CustomSelect';
import type {
  DevelopmentCase as DevCase,
  DevelopmentCaseCreateInput,
  DevelopmentCaseUpdateInput,
  DevelopmentType as DevType,
  DevelopmentStage as DevStage,
  SampleType,
} from '../types';
import RelatedEntitiesPanel from './RelatedEntitiesPanel';
import { SampleNodesPanel } from './development/SampleNodesPanel';

interface DevelopmentManagerProps {
  isDarkMode: boolean;
  cases: DevCase[];
  setCases: React.Dispatch<React.SetStateAction<DevCase[]>>;
}

type DevelopmentTypeId = 'all' | DevType;
type DevelopmentStageId = 'all' | DevStage;

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const DEVELOPMENT_TYPES: Array<{ id: DevelopmentTypeId; label: string }> = [
  { id: 'all', label: '全部类型' },
  { id: 'fabric', label: '面料开发样' },
  { id: 'garment', label: '成衣开发样' },
  { id: 'pp', label: '产前样' },
  { id: 'trim', label: '辅料样' },
];

const DEVELOPMENT_STAGES: Array<{ id: DevelopmentStageId; label: string }> = [
  { id: 'all', label: '全部阶段' },
  { id: 'developing', label: '开发中' },
  { id: 'shipping', label: '待寄样' },
  { id: 'feedback', label: '待反馈' },
  { id: 'revision', label: '需复样' },
  { id: 'approved', label: '已确认' },
  { id: 'cancelled', label: '已取消' },
];

const typeLabelMap = Object.fromEntries(DEVELOPMENT_TYPES.map(item => [item.id, item.label])) as Record<DevelopmentTypeId, string>;
const stageLabelMap = Object.fromEntries(DEVELOPMENT_STAGES.map(item => [item.id, item.label])) as Record<DevelopmentStageId, string>;

const DEV_FORM_SECTIONS = [
  { id: 'dev-basic', title: '基本信息', desc: '编号、名称、类型、阶段' },
  { id: 'dev-partner', title: '关联信息', desc: '客户、供应商、产品' },
  { id: 'dev-sample-plan', title: '样品与计划', desc: '样品类型、目标日、备注' },
];

const tableColumns = [
  { key: 'case', label: '开发单' },
  { key: 'stageOwner', label: '阶段/负责人' },
  { key: 'partner', label: '伙伴' },
  { key: 'nextAction', label: '下一动作/目标日' },
] as const;

const tableGridClass =
  'grid w-full min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,0.78fr)_minmax(0,0.9fr)_minmax(0,1fr)]';

const stageTone = (stage: DevStage, isDarkMode: boolean) => {
  if (stage === 'approved') return isDarkMode ? 'border-white/[0.08] bg-white/[0.06] text-white/70' : 'border-slate-300/40 bg-slate-100/60 text-slate-600';
  if (stage === 'revision') return isDarkMode ? 'border-white/[0.08] bg-white/[0.06] text-white/70' : 'border-slate-300/40 bg-slate-100/60 text-slate-600';
  if (stage === 'feedback') return isDarkMode ? 'border-white/[0.08] bg-white/[0.06] text-white/70' : 'border-slate-300/40 bg-slate-100/60 text-slate-600';
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

const DEV_TYPE_OPTIONS = DEVELOPMENT_TYPES.filter((t): t is { id: DevType; label: string } => t.id !== 'all');
const DEV_STAGE_OPTIONS = DEVELOPMENT_STAGES.filter((s): s is { id: DevStage; label: string } => s.id !== 'all');
const SAMPLE_TYPE_OPTIONS: Array<{ id: SampleType; label: string }> = [
  { id: 'lab-dip', label: '色样 Lab-dip' },
  { id: 'handloom', label: '手织样 Handloom' },
  { id: 'yardage', label: '匹样 Yardage' },
  { id: 'fit-sample', label: '合身样 Fit Sample' },
  { id: 'pp-sample', label: '产前样 PP Sample' },
  { id: 'size-set', label: '尺码组 Size Set' },
];

interface DevFormState {
  code: string;
  name: string;
  type: DevType;
  stage: DevStage;
  owner: string;
  customerName: string;
  supplierName: string;
  productName: string;
  currentRound: string;
  nextAction: string;
  targetDate: string;
  sampleType: SampleType | '';
  sampleCategory: 'normal' | '5a';
  notes: string;
}

const EMPTY_FORM: DevFormState = {
  code: '',
  name: '',
  type: 'fabric',
  stage: 'developing',
  owner: '',
  customerName: '',
  supplierName: '',
  productName: '',
  currentRound: '1',
  nextAction: '',
  targetDate: '',
  sampleType: '',
  sampleCategory: 'normal',
  notes: '',
};

const buildInitialForm = (editingCase: DevCase | null): DevFormState => {
  if (!editingCase) return { ...EMPTY_FORM };
  return {
    code: editingCase.code || '',
    name: editingCase.name || '',
    type: editingCase.type || 'fabric',
    stage: editingCase.stage || 'developing',
    owner: editingCase.owner || '',
    customerName: editingCase.customerName || '',
    supplierName: editingCase.supplierName || '',
    productName: editingCase.productName || '',
    currentRound: String(editingCase.currentRound ?? 1),
    nextAction: editingCase.nextAction || '',
    targetDate: editingCase.targetDate || '',
    sampleType: editingCase.sampleType || '',
    sampleCategory: (editingCase as any).sampleCategory === '5a' ? '5a' : 'normal',
    notes: editingCase.notes || '',
  };
};

const DevelopmentManager: React.FC<DevelopmentManagerProps> = ({ isDarkMode, cases, setCases }) => {
  const [selectedType, setSelectedType] = useState<DevelopmentTypeId>('all');
  const [selectedStage, setSelectedStage] = useState<DevelopmentStageId>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const formScrollRef = useRef<HTMLDivElement | null>(null);

  // 手动刷新（从后端拉取最新数据，不阻塞渲染）
  const handleRefresh = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const data = await developmentService.listDevelopmentCases(undefined, { limit: 200 });
      setCases(data);
    } catch (err) {
      console.error('[DevelopmentManager] refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [setCases]);

  // 客户端零延迟过滤（与老页面 RelationsManager 模式一致）
  const filteredCases = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return cases.filter(item => {
      if (selectedType !== 'all' && item.type !== selectedType) return false;
      if (selectedStage !== 'all' && item.stage !== selectedStage) return false;
      if (normalizedSearch) {
        const haystack = `${item.name || ''} ${item.code || ''} ${item.customerName || ''} ${item.supplierName || ''} ${item.productName || ''}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });
  }, [cases, selectedType, selectedStage, searchTerm]);

  const selectedCase = filteredCases.find(item => item.id === selectedCaseId) || filteredCases[0];

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<DevCase | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
  const [form, setForm] = useState<DevFormState>(EMPTY_FORM);

  const updateField = useCallback(<K extends keyof DevFormState>(key: K, value: DevFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const openCreateModal = useCallback(() => {
    setEditingCase(null);
    setForm({ ...EMPTY_FORM });
    setFormErrorMessage(null);
    setIsFormModalOpen(true);
  }, []);

  const openEditModal = useCallback(() => {
    if (!selectedCase) return;
    setEditingCase(selectedCase);
    setForm(buildInitialForm(selectedCase));
    setFormErrorMessage(null);
    setIsFormModalOpen(true);
  }, [selectedCase]);

  const closeFormModal = useCallback(() => {
    setIsFormModalOpen(false);
    setEditingCase(null);
    setFormErrorMessage(null);
    setForm({ ...EMPTY_FORM });
  }, []);

  const handleFormSubmit = useCallback(async (input: DevelopmentCaseCreateInput | DevelopmentCaseUpdateInput) => {
    if (isSubmitting) return;
    setFormErrorMessage(null);
    setIsSubmitting(true);
    try {
      if (editingCase) {
        const updated = await developmentService.updateDevelopmentCase(editingCase.id, input as DevelopmentCaseUpdateInput);
        setCases(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      } else {
        const created = await developmentService.createDevelopmentCase(input as DevelopmentCaseCreateInput);
        setCases(prev => [created, ...prev]);
      }
      closeFormModal();
    } catch (err: any) {
      setFormErrorMessage(err?.message || String(err) || '操作失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  }, [editingCase, setCases, closeFormModal, isSubmitting]);

  const handleDevFormSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    const parsedRound = parseInt(form.currentRound, 10);
    if (form.currentRound && (!Number.isFinite(parsedRound) || parsedRound < 0)) {
      alert('当前轮次必须是有效的非负整数');
      return;
    }
    if (form.targetDate) {
      const d = new Date(form.targetDate);
      if (isNaN(d.getTime())) { alert('交样日期格式无效'); return; }
    }
    const input: DevelopmentCaseCreateInput = {
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
      stage: form.stage,
      ...(form.owner.trim() ? { owner: form.owner.trim() } : {}),
      ...(form.customerName.trim() ? { customerName: form.customerName.trim() } : {}),
      ...(form.supplierName.trim() ? { supplierName: form.supplierName.trim() } : {}),
      ...(form.productName.trim() ? { productName: form.productName.trim() } : {}),
      currentRound: Number.isFinite(parsedRound) && parsedRound > 0 ? parsedRound : 1,
      ...(form.nextAction.trim() ? { nextAction: form.nextAction.trim() } : {}),
      ...(form.targetDate ? { targetDate: form.targetDate } : {}),
      ...(form.sampleType ? { sampleType: form.sampleType } : {}),
      sampleCategory: form.sampleCategory,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };
    handleFormSubmit(input);
  }, [form, handleFormSubmit]);

  const handleDelete = useCallback(async () => {
    if (!selectedCase) return;
    if (!window.confirm(`确认删除开发单「${selectedCase.name}」(${selectedCase.code})？\n此操作不可撤销。`)) return;
    const deletedId = selectedCase.id;
    try {
      await developmentService.deleteDevelopmentCase(deletedId);
      setCases(prev => prev.filter(c => c.id !== deletedId));
      setSelectedCaseId(null);
    } catch (err: any) {
      window.alert(`删除失败：${err?.message || err}`);
    }
  }, [selectedCase, setCases]);

  const textPrimaryClass = isDarkMode ? 'text-white/86' : 'text-slate-950';
  const textSecondaryClass = isDarkMode ? 'text-white/52' : 'text-slate-500';
  const tableHeaderClass = isDarkMode ? BAMBOOK_OS.controls.table.headerDark : BAMBOOK_OS.controls.table.headerLight;
  const tableRowHoverClass = isDarkMode ? BAMBOOK_OS.controls.table.rowHoverDark : BAMBOOK_OS.controls.table.rowHoverLight;
  const tableRowSeparatorClass = isDarkMode ? BAMBOOK_OS.controls.table.rowSeparatorDark : BAMBOOK_OS.controls.table.rowSeparatorLight;
  const toolbarSurfaceClass = isDarkMode ? BAMBOOK_OS.controls.toolbar.surfaceDark : BAMBOOK_OS.controls.toolbar.surfaceLight;
  const toolbarSearchClass = isDarkMode ? BAMBOOK_OS.controls.toolbar.searchDark : BAMBOOK_OS.controls.toolbar.searchLight;
  const toolbarSearchShellClass = isDarkMode ? BAMBOOK_OS.controls.toolbar.controlDark : BAMBOOK_OS.controls.toolbar.controlLight;
  const mutedTitleActionClass = isDarkMode
    ? 'border-transparent bg-transparent text-white/36'
    : 'border-transparent bg-transparent text-slate-400';
  const statusChipClass = isDarkMode
    ? 'border-white/[0.065] bg-white/[0.028] text-white/54'
    : 'border-slate-300/28 bg-white/38 text-slate-500';

  const statusItems = [
    { label: '开发中', value: cases.filter(item => item.stage === 'developing').length },
    { label: '待寄样', value: cases.filter(item => item.stage === 'shipping').length },
    { label: '待反馈', value: cases.filter(item => item.stage === 'feedback').length },
    { label: '已确认', value: cases.filter(item => item.stage === 'approved').length },
  ];
  const inspectorRows = selectedCase
    ? [
        { label: '负责人', value: selectedCase.owner || '—' },
        { label: '客户', value: selectedCase.customerName || '—' },
        { label: '供应商', value: selectedCase.supplierName || '—' },
        { label: '产品', value: selectedCase.productName || '—' },
        { label: '样品类型', value: selectedCase.sampleType || '—' },
        { label: '样衣分档', value: (selectedCase as any).sampleCategory === '5a' ? '5A 重点' : '普通' },
        { label: '评审状态', value: (selectedCase as any).reviewStatus === 'passed' ? '通过' : (selectedCase as any).reviewStatus === 'failed' ? '不通过' : (selectedCase as any).reviewStatus === 'pending' ? '待评审' : '—' },
        { label: '目标日期', value: selectedCase.targetDate || '—' },
        { label: '当前轮次', value: `S${selectedCase.currentRound}` },
        { label: '快递单号', value: selectedCase.sampleTrackingNumber || '—' },
        { label: '客户反馈', value: selectedCase.sampleFeedback || '—' },
        { label: '大货关联', value: selectedCase.linkedOrderPo || '未转大货' },
      ]
    : [];

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 overflow-hidden">
      <PageHeader
        title="开发管理"
        subtitle="Development Tracking"
        contextLabel="Development Desk"
        isDarkMode={isDarkMode}
        hidden={isFormModalOpen}
        actions={(
          <div className="flex items-center gap-1">
            <span
              onClick={handleRefresh}
              className={cx(BAMBOOK_OS.controls.title.actionButton, 'cursor-pointer select-none', mutedTitleActionClass, isRefreshing && 'pointer-events-none opacity-50')}
            >
              <RefreshCw size={13} strokeWidth={1.4} className={cx(isRefreshing && 'animate-spin')} />
              刷新
            </span>
            <span
              onClick={openCreateModal}
              className={cx(BAMBOOK_OS.controls.title.actionButton, 'cursor-pointer', mutedTitleActionClass)}
            >
              <Plus size={14} strokeWidth={1.4} />
              新建开发单
            </span>
          </div>
        )}
      />

      <main className={cx(BAMBOOK_OS.layout.desktopSinglePanelBodyClass, BAMBOOK_OS.layout.desktopPageCanvasClass, isFormModalOpen && 'hidden')}>
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className={cx(BAMBOOK_OS.controls.toolbar.base, 'h-auto min-h-9 overflow-hidden py-1', toolbarSurfaceClass)}>
            <span className={BAMBOOK_OS.controls.toolbar.ambient} aria-hidden="true" />
            <div className={cx(BAMBOOK_OS.controls.toolbar.content, '!h-auto min-h-9 flex-wrap gap-x-2 gap-y-2 py-1.5')}>
              <label className={cx('flex h-9 min-w-[188px] flex-[1_1_220px] items-center gap-2 rounded-control border px-3 text-[11px] font-light', toolbarSearchShellClass)}>
                <Search size={13} strokeWidth={1.2} className={isDarkMode ? 'text-white/38' : 'text-slate-400'} />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="开发单 / 伙伴"
                  className={cx('min-w-0 flex-1 bg-transparent text-[11px] font-light outline-none', toolbarSearchClass)}
                />
              </label>
              <div className={cx('hidden h-4 w-px shrink-0 xl:block', isDarkMode ? 'bg-white/8' : 'bg-slate-300/32')} />
              <CustomSelect
                isDarkMode={isDarkMode}
                size="compact"
                surface="toolbar"
                value={selectedType}
                onChange={(v) => setSelectedType(v as DevelopmentTypeId)}
                className="w-[140px] shrink-0"
                options={DEVELOPMENT_TYPES.map(item => ({
                  value: item.id,
                  label: item.id === 'all' ? item.label : `${item.label} · ${cases.filter(c => c.type === item.id).length}`,
                }))}
              />
              <CustomSelect
                isDarkMode={isDarkMode}
                size="compact"
                surface="toolbar"
                value={selectedStage}
                onChange={(v) => setSelectedStage(v as DevelopmentStageId)}
                className="w-[120px] shrink-0"
                options={DEVELOPMENT_STAGES.map(item => ({
                  value: item.id,
                  label: item.id === 'all' ? item.label : `${item.label} · ${cases.filter(c => c.stage === item.id).length}`,
                }))}
              />
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
                    <div key={column.key} className={cx('min-w-0', BAMBOOK_OS.spacing.cellPadding)}>
                      {column.label}
                    </div>
                  ))}
                </div>
              )}
            >
              <div className="text-xs">
                {filteredCases.map((item, index) => {
                  const active = selectedCase?.id === item.id;
                  return (
                    <CompiledMotionInteractiveCard
                      as="button"
                      type="button"
                      key={item.id}
                      data-glass-edge-mask
                      onClick={() => setSelectedCaseId(item.id)}
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
                        <div className={cx('truncate font-light', textPrimaryClass)}>{item.name}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.code} · {typeLabelMap[item.type]} · S{item.currentRound}</div>
                      </div>
                      <div className={cx('relative z-10 min-w-0', BAMBOOK_OS.spacing.cellContentPadding)}>
                        <span className={cx('inline-flex rounded-control border px-2.5 py-1 text-[10px] font-light tracking-wide', stageTone(item.stage, isDarkMode))}>
                          {stageLabelMap[item.stage]}
                        </span>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>负责人 · {item.owner || '—'}</div>
                      </div>
                      <div className={cx('relative z-10 min-w-0', BAMBOOK_OS.spacing.cellContentPadding)}>
                        <div className={cx('truncate font-light', textPrimaryClass)}>{item.customerName || '—'}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.supplierName || '—'} · {item.linkedOrderPo || '未转大货'}</div>
                      </div>
                      <div className={cx('relative z-10 min-w-0', BAMBOOK_OS.spacing.cellContentPadding)}>
                        <div className={cx('truncate font-light', textPrimaryClass)}>{item.nextAction}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>目标日 · {item.targetDate || '—'}</div>
                      </div>
                    </CompiledMotionInteractiveCard>
                  );
                })}
                {filteredCases.length === 0 && (
                  <div className={cx('flex h-56 flex-col items-center justify-center text-center', textSecondaryClass)}>
                    <PackageCheck size={28} strokeWidth={1} className="mb-3 opacity-45" />
                    <div className="text-sm font-light">暂无匹配开发单</div>
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
              {selectedCase ? (
                <>
                  <div className={cx('shrink-0 border-b', BAMBOOK_OS.spacing.detailPanelPadding, isDarkMode ? 'border-white/[0.045]' : 'border-white/36')}>
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>当前开发单</div>
                        <div className={cx('mt-2 truncate text-base font-light', textPrimaryClass)}>{selectedCase.name}</div>
                        <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{selectedCase.code} · {typeLabelMap[selectedCase.type]} · S{selectedCase.currentRound}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className={cx('inline-flex rounded-control border px-2.5 py-1 text-[10px] font-light tracking-wide', stageTone(selectedCase.stage, isDarkMode))}>
                          {stageLabelMap[selectedCase.stage]}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={openEditModal}
                            className={cx(
                              'h-8 inline-flex items-center gap-1 rounded-control border px-2.5 text-[10px] font-light tracking-wide transition-colors',
                              isDarkMode
                                ? 'border-white/10 text-white/64 hover:bg-white/8 hover:text-white/88'
                                : 'border-slate-300/40 text-slate-500 hover:bg-white/60 hover:text-slate-800',
                            )}
                          >
                            <Pencil size={11} strokeWidth={1.4} />
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={handleDelete}
                            className={cx(
                              'h-8 inline-flex items-center gap-1 rounded-control border px-2.5 text-[10px] font-light tracking-wide transition-colors',
                              isDarkMode
                                ? 'border-white/[0.08] text-white/55 hover:bg-white/[0.05] hover:text-white/70'
                                : 'border-slate-300/40 text-slate-500 hover:bg-slate-100/60 hover:text-slate-600',
                            )}
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
                      <div className={cx('text-[10px] font-light tracking-[0.18em]', textSecondaryClass)}>下一动作</div>
                      <div className={cx('mt-2 text-sm font-light leading-snug', textPrimaryClass)}>{selectedCase.nextAction}</div>
                    </div>
                    <div className="mt-4">
                      <SampleNodesPanel key={selectedCase.id} caseId={selectedCase.id} isDarkMode={isDarkMode} />
                    </div>
                    {selectedCase.stage === 'approved' && !selectedCase.linkedOrderId && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!selectedCase) return;
                          if (!window.confirm(`将 ${selectedCase.code} 转为大货订单？\n系统会自动沿用客户/供应商/产品。`)) return;
                          try {
                            const res = await developmentService.convertToOrder(selectedCase.id, { autoCreate: true });
                            await handleRefresh();
                            window.alert(`已转为订单 ${res.order?.poNumber ?? '(未返回PO)'}。`);
                          } catch (err: any) {
                            window.alert(`转订单失败：${err.message || err}`);
                          }
                        }}
                        className={cx(
                          'mt-3 w-full rounded-full border px-4 py-2.5 text-xs font-light tracking-wide transition-colors',
                          isDarkMode
                            ? 'border-[var(--os-vnext-brand-blue-soft)]/30 bg-[var(--os-vnext-brand-blue)]/15 text-white hover:bg-[var(--os-vnext-brand-blue)]/25'
                            : 'border-[var(--os-vnext-brand-blue)]/35 bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue)]/20'
                        )}
                      >
                        一键转为大货订单
                      </button>
                    )}
                    {selectedCase.linkedOrderId && (
                      <div className={cx('mt-3 rounded-inset border text-xs font-light', BAMBOOK_OS.spacing.nestedPanelPadding, isDarkMode ? 'border-white/[0.08] bg-white/[0.04] text-white/65' : 'border-slate-300 bg-slate-100/60 text-slate-600')}>
                        已转订单 · {selectedCase.linkedOrderPo || selectedCase.linkedOrderId}
                      </div>
                    )}
                    <div className="mt-4">
                      <RelatedEntitiesPanel
                        type="development-case"
                        id={selectedCase.id}
                        isDarkMode={isDarkMode}
                        title="开发单关联视图"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className={cx('flex h-full flex-col items-center justify-center px-6 text-center', textSecondaryClass)}>
                  <PackageCheck size={28} strokeWidth={1} className="mb-3 opacity-45" />
                  <div className="text-sm font-light">请选择开发单</div>
                </div>
              )}
            </CompiledSurfacePanel>
          </div>
        </div>
      </main>

      {isFormModalOpen && (
        <div
          className="absolute inset-x-0 top-0 bottom-0 z-[70] bg-transparent"
          onClick={(e) => { if (e.target === e.currentTarget) closeFormModal(); }}
        >
          <div className="h-full w-full overflow-hidden flex flex-col bg-transparent">
            <CompiledModuleTitleBar
              template="development.development-form.title"
              source="DevelopmentManager.form"
              leading={(
                <div className="flex h-full items-center gap-1.5 min-w-0">
                  <CompiledInteractiveCard
                    as="button"
                    type="button"
                    onClick={closeFormModal}
                    aria-label="返回开发管理"
                    spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                    spotlightSize={isDarkMode ? 180 : 140}
                    idleSpotlightOpacity={0}
                    activeSpotlightOpacity={1}
                    className={cx(
                      'inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                      isDarkMode
                        ? 'border-white/10 text-white/64 hover:bg-white/8 hover:text-white/88'
                        : 'border-slate-300/40 text-slate-500 hover:bg-white/60 hover:text-slate-800',
                    )}
                  >
                    <ChevronLeft size={18} strokeWidth={1.4} />
                  </CompiledInteractiveCard>
                  <h3 className={cx(isDarkMode ? 'text-white/70' : 'text-slate-700')}>
                    {editingCase ? '编辑开发单' : '新建开发单'}
                  </h3>
                </div>
              )}
              actions={(
                <div className="flex h-full items-center gap-2 shrink-0">
                  <div className={cx('text-[11px] font-light tracking-wide', isDarkMode ? 'text-white/48' : 'text-slate-400')}>
                    开发管理
                  </div>
                  <CompiledInteractiveCard
                    as="button"
                    type="button"
                    onClick={closeFormModal}
                    spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                    spotlightSize={isDarkMode ? 180 : 140}
                    idleSpotlightOpacity={0}
                    activeSpotlightOpacity={1}
                    className={cx(
                      'inline-flex h-9 items-center justify-center rounded-full border px-3.5 text-[11px] font-light tracking-wide transition-colors',
                      isDarkMode
                        ? 'border-white/10 text-white/64 hover:bg-white/8 hover:text-white/88'
                        : 'border-slate-300/40 text-slate-500 hover:bg-white/60 hover:text-slate-800',
                    )}
                  >
                    取消
                  </CompiledInteractiveCard>
                  <CompiledInteractiveCard
                    spotlightColor={isDarkMode ? 'rgb(var(--os-vnext-brand-blue-soft-rgb)/0.18)' : 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)'}
                    spotlightSize={isDarkMode ? 180 : 140}
                    idleSpotlightOpacity={0}
                    activeSpotlightOpacity={1}
                    className={cx(
                      'inline-flex h-9 items-center justify-center rounded-full border px-4 text-[11px] font-light tracking-wide transition-colors',
                      'border-[var(--os-vnext-brand-blue)]/30',
                      isDarkMode
                        ? 'bg-[var(--os-vnext-brand-blue)]/22 text-white hover:bg-[var(--os-vnext-brand-blue)]/32'
                        : 'bg-[var(--os-vnext-brand-blue)]/14 text-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue)]/22',
                      (isSubmitting || !form.code.trim() || !form.name.trim()) && 'pointer-events-none opacity-50',
                    )}
                  >
                    <button
                      type="submit"
                      form="development-fullscreen-form"
                      disabled={isSubmitting || !form.code.trim() || !form.name.trim()}
                      className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-1.5"
                    >
                      <Save size={14} strokeWidth={1.5} />
                      {isSubmitting ? '保存中…' : '保存'}
                    </button>
                  </CompiledInteractiveCard>
                </div>
              )}
            />

            {formErrorMessage && (
              <div className={cx('w-full px-5 pt-3 text-xs font-light', isDarkMode ? 'text-white/55' : 'text-slate-500')}>
                {formErrorMessage}
              </div>
            )}

            <form
              id="development-fullscreen-form"
              onSubmit={handleDevFormSubmit}
              className="w-full flex-1 min-h-0 px-5 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch"
            >
              <aside className="self-start">
                <CompiledFormMapPanel
                  isDarkMode={isDarkMode}
                  source="DevelopmentManager.form-map"
                >
                  <div className="space-y-1">
                    {DEV_FORM_SECTIONS.map((section, idx) => (
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
              <CompiledFormSectionPanel
                id="dev-basic"
                title="基本信息"
                isDarkMode={isDarkMode}
                materialRole="raisedCard"
                contentBaseClassName="grid grid-cols-2 gap-4"
              >
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>编号 *</label>
                  <input
                    value={form.code}
                    onChange={(e) => updateField('code', e.target.value)}
                    placeholder="如 DEV-2026-001"
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>名称 *</label>
                  <input
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="开发单名称"
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>类型</label>
                  <select
                    value={form.type}
                    onChange={(e) => updateField('type', e.target.value as DevType)}
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  >
                    {DEV_TYPE_OPTIONS.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>阶段</label>
                  <select
                    value={form.stage}
                    onChange={(e) => updateField('stage', e.target.value as DevStage)}
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  >
                    {DEV_STAGE_OPTIONS.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>负责人</label>
                  <input
                    value={form.owner}
                    onChange={(e) => updateField('owner', e.target.value)}
                    placeholder="负责人姓名"
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>当前轮次</label>
                  <input
                    type="number"
                    min={1}
                    value={form.currentRound}
                    onChange={(e) => updateField('currentRound', e.target.value)}
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
              </CompiledFormSectionPanel>

              <CompiledFormSectionPanel
                id="dev-partner"
                title="关联信息"
                isDarkMode={isDarkMode}
                materialRole="raisedCard"
                contentBaseClassName="grid grid-cols-2 gap-4"
              >
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>客户名</label>
                  <input
                    value={form.customerName}
                    onChange={(e) => updateField('customerName', e.target.value)}
                    placeholder="客户名称"
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>供应商名</label>
                  <input
                    value={form.supplierName}
                    onChange={(e) => updateField('supplierName', e.target.value)}
                    placeholder="供应商名称"
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
                <div className="col-span-2">
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>产品名</label>
                  <input
                    value={form.productName}
                    onChange={(e) => updateField('productName', e.target.value)}
                    placeholder="产品名称"
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
              </CompiledFormSectionPanel>

              <CompiledFormSectionPanel
                id="dev-sample-plan"
                title="样品与计划"
                isDarkMode={isDarkMode}
                materialRole="raisedCard"
                contentBaseClassName="grid grid-cols-2 gap-4"
              >
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>样品类型</label>
                  <select
                    value={form.sampleType}
                    onChange={(e) => updateField('sampleType', e.target.value as SampleType | '')}
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  >
                    <option value="">不指定</option>
                    {SAMPLE_TYPE_OPTIONS.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>样衣分档</label>
                  <select
                    value={form.sampleCategory}
                    onChange={(e) => updateField('sampleCategory', e.target.value as 'normal' | '5a')}
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  >
                    <option value="normal">普通样衣</option>
                    <option value="5a">5A 重点样衣</option>
                  </select>
                </div>
                <div>
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>目标日期</label>
                  <input
                    type="date"
                    value={form.targetDate}
                    onChange={(e) => updateField('targetDate', e.target.value)}
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>下一动作</label>
                  <input
                    value={form.nextAction}
                    onChange={(e) => updateField('nextAction', e.target.value)}
                    placeholder="下一步待办或行动项"
                    className={cx('w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className={cx('text-[10px] font-light tracking-wide ml-1', isDarkMode ? 'text-white/52' : 'text-slate-500')}>备注</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateField('notes', e.target.value)}
                    placeholder="备注信息"
                    className={cx('w-full mt-1 px-4 py-3 rounded-full border outline-none font-light text-xs transition-all resize-none min-h-[96px]', isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light)}
                  />
                </div>
              </CompiledFormSectionPanel>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DevelopmentManager;
