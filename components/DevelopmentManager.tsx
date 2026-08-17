import React, { useMemo, useRef, useState, useCallback } from 'react';
import { ChevronLeft, FileText, PackageCheck, Plus, Pencil, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import {
  CompiledFormMapPanel,
  CompiledFormSectionPanel,
  CompiledModuleTitleBar,
  CompiledMotionInteractiveCard,
  CompiledSurfacePanel,
  CompiledTableShell,
} from './ui/primitives/compiledPrimitives';
import { developmentService } from '../services/developmentService';
import type {
  DevelopmentCase as DevCase,
  DevelopmentCaseCreateInput,
  DevelopmentCaseUpdateInput,
  DevelopmentType as DevType,
  DevelopmentStage as DevStage,
  SampleType,
} from '../types';
import { View } from '../types';
import RelatedEntitiesPanel from './RelatedEntitiesPanel';
import { SampleNodesPanel } from './development/SampleNodesPanel';
import { primeQuotationCreateFromDevCase } from './QuotationManager';

interface DevelopmentManagerProps {
  isDarkMode: boolean;
  cases: DevCase[];
  setCases: React.Dispatch<React.SetStateAction<DevCase[]>>;
  /** 阶段 IA-3：开发案详情「发起报价」跳转报价管理 */
  onNavigate?: (view: View) => void;
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

// BDS v2.1：阶段 → bds-badge 语义变体（主题透明，替代原 isDarkMode 双态 class 拼装。
// 函数名保留 —— rdl 源码契约守卫测试消费同一函数体）
const stageTone = (stage: DevStage): 'neutral' | 'info' | 'success' | 'danger' | 'warning' => {
  if (stage === 'approved') return 'success';
  if (stage === 'revision' || stage === 'shipping') return 'warning';
  if (stage === 'developing' || stage === 'feedback') return 'info';
  return 'neutral';
};

// compiled 交互卡 spotlight 统一 accent 色/尺寸（主题透明，替代 isDarkMode 双值三元）
const SPOTLIGHT_COLOR = 'rgb(var(--os-vnext-brand-blue-rgb)/0.18)';
const SPOTLIGHT_SIZE = 200;

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

const DevelopmentManager: React.FC<DevelopmentManagerProps> = ({ isDarkMode, cases, setCases, onNavigate }) => {
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

  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──
  const textPrimaryClass = 'text-[var(--text-primary)]';
  const textSecondaryClass = 'text-[var(--text-tertiary)]';

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
        hidden={isFormModalOpen}
        actions={(
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="bds-btn bds-btn-secondary"
            >
              <RefreshCw size={13} className={cx(isRefreshing && 'animate-spin')} />
              刷新
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="bds-btn bds-btn-primary"
            >
              <Plus size={14} />
              新建开发单
            </button>
          </div>
        )}
      />

      <main className={cx('flex-1 min-h-0 flex flex-col px-7 pt-0 bambook-main-panel-bottom-inset overflow-visible w-full h-full', isFormModalOpen && 'hidden')}>
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="bds-filterbar shrink-0 flex-wrap gap-y-2">
            <div className="relative min-w-[188px] flex-[1_1_220px] max-w-xs">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="开发单 / 伙伴"
                className="bds-input pl-9"
              />
            </div>
            <div className="hidden h-4 w-px shrink-0 xl:block bg-[var(--border-c-strong)]" />
            <select
              className="bds-select w-[140px] shrink-0"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as DevelopmentTypeId)}
            >
              {DEVELOPMENT_TYPES.map(item => (
                <option key={item.id} value={item.id}>
                  {item.id === 'all' ? item.label : `${item.label} · ${cases.filter(c => c.type === item.id).length}`}
                </option>
              ))}
            </select>
            <select
              className="bds-select w-[120px] shrink-0"
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value as DevelopmentStageId)}
            >
              {DEVELOPMENT_STAGES.map(item => (
                <option key={item.id} value={item.id}>
                  {item.id === 'all' ? item.label : `${item.label} · ${cases.filter(c => c.stage === item.id).length}`}
                </option>
              ))}
            </select>
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
                <div className={cx(tableGridClass, 'text-[10px] tracking-[0.16em]', textSecondaryClass)} style={{ borderBottom: 'var(--border-default)' }}>
                  {tableColumns.map(column => (
                    <div key={column.key} className="min-w-0 px-3 py-3">
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
                        <div className={cx('truncate', textPrimaryClass)}>{item.name}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.code} · {typeLabelMap[item.type]} · S{item.currentRound}</div>
                      </div>
                      <div className="relative z-10 min-w-0 px-3 py-4">
                        <span className={`bds-badge sm ${stageTone(item.stage)}`}>
                          {stageLabelMap[item.stage]}
                        </span>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>负责人 · {item.owner || '—'}</div>
                      </div>
                      <div className="relative z-10 min-w-0 px-3 py-4">
                        <div className={cx('truncate', textPrimaryClass)}>{item.customerName || '—'}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>{item.supplierName || '—'} · {item.linkedOrderPo || '未转大货'}</div>
                      </div>
                      <div className="relative z-10 min-w-0 px-3 py-4">
                        <div className={cx('truncate', textPrimaryClass)}>{item.nextAction}</div>
                        <div className={cx('mt-1 truncate text-[10px]', textSecondaryClass)}>目标日 · {item.targetDate || '—'}</div>
                      </div>
                    </CompiledMotionInteractiveCard>
                  );
                })}
                {filteredCases.length === 0 && (
                  <div className="bds-empty">
                    <div className="glyph"><PackageCheck size={24} strokeWidth={1} /></div>
                    <div className="title">暂无匹配开发单</div>
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
                  <div className="shrink-0 px-5 py-4" style={{ borderBottom: 'var(--border-subtle)' }}>
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={cx('text-[10px] tracking-[0.18em]', textSecondaryClass)}>当前开发单</div>
                        <div className={cx('mt-2 truncate text-base', textPrimaryClass)}>{selectedCase.name}</div>
                        <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{selectedCase.code} · {typeLabelMap[selectedCase.type]} · S{selectedCase.currentRound}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className={`bds-badge sm ${stageTone(selectedCase.stage)}`}>
                          {stageLabelMap[selectedCase.stage]}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {onNavigate && selectedCase.stage !== 'cancelled' && (
                            <button
                              type="button"
                              onClick={() => {
                                primeQuotationCreateFromDevCase({
                                  customerName: selectedCase.customerName || undefined,
                                  description: `${selectedCase.productName || selectedCase.name}（开发案 ${selectedCase.code}）`,
                                  inquiryRef: selectedCase.code,
                                });
                                onNavigate(View.Quotations);
                              }}
                              title="跳转到报价管理并预填本开发案客户/产品"
                              className="bds-btn bds-btn-secondary"
                            >
                              <FileText size={11} />
                              发起报价
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={openEditModal}
                            className="bds-btn bds-btn-secondary"
                          >
                            <Pencil size={11} />
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={handleDelete}
                            className="bds-btn bds-btn-danger"
                          >
                            <Trash2 size={11} />
                            删除
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
                      <div className={cx('text-[10px] tracking-[0.18em]', textSecondaryClass)}>下一动作</div>
                      <div className={cx('mt-2 text-sm leading-snug', textPrimaryClass)}>{selectedCase.nextAction}</div>
                    </div>
                    <div className="mt-4">
                      <SampleNodesPanel key={selectedCase.id} caseId={selectedCase.id} caseType={selectedCase.type} isDarkMode={isDarkMode} />
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
                        className="bds-btn bds-btn-primary w-full mt-3"
                      >
                        一键转为大货订单
                      </button>
                    )}
                    {selectedCase.linkedOrderId && (
                      <div className="bds-alert success mt-3">
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
                <div className="bds-empty h-full justify-center">
                  <div className="glyph"><PackageCheck size={24} strokeWidth={1} /></div>
                  <div className="title">请选择开发单</div>
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
                  <button type="button" onClick={closeFormModal} aria-label="返回开发管理" className="bds-btn bds-btn-secondary bds-btn-icon">
                    <ChevronLeft size={18} strokeWidth={1.4} />
                  </button>
                  <h3 className="flex h-9 max-w-[260px] items-center truncate text-[11px] font-light leading-none tracking-wide text-[var(--text-secondary)]">
                    {editingCase ? '编辑开发单' : '新建开发单'}
                  </h3>
                </div>
              )}
              actions={(
                <div className="flex h-full items-center gap-2 shrink-0">
                  <div className="text-[11px] font-light tracking-wide text-[var(--text-tertiary)]">
                    开发管理
                  </div>
                  <button type="button" onClick={closeFormModal} disabled={isSubmitting} className="bds-btn bds-btn-secondary">
                    取消
                  </button>
                  <button
                    type="submit"
                    form="development-fullscreen-form"
                    disabled={isSubmitting || !form.code.trim() || !form.name.trim()}
                    className="bds-btn bds-btn-primary"
                  >
                    <Save size={14} strokeWidth={1.5} />
                    {isSubmitting ? '保存中…' : '保存'}
                  </button>
                </div>
              )}
            />

            {formErrorMessage && (
              <div className="w-full px-5 pt-3">
                <div className="bds-alert danger">{formErrorMessage}</div>
              </div>
            )}

            <form
              id="development-fullscreen-form"
              onSubmit={handleDevFormSubmit}
              className="w-full flex-1 min-h-0 px-7 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch"
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
                        className="w-full rounded-full border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] px-3 py-3 text-left transition-all hover:bg-[var(--recessed-bg)] hover:border-[var(--border-c-strong)]"
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
              <CompiledFormSectionPanel
                id="dev-basic"
                title="基本信息"
                isDarkMode={isDarkMode}
                materialRole="raisedCard"
                contentBaseClassName="grid grid-cols-2 gap-4"
              >
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">编号 *</label>
                  <input
                    value={form.code}
                    onChange={(e) => updateField('code', e.target.value)}
                    placeholder="如 DEV-2026-001"
                    className="bds-input"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">名称 *</label>
                  <input
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="开发单名称"
                    className="bds-input"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">类型</label>
                  <select
                    value={form.type}
                    onChange={(e) => updateField('type', e.target.value as DevType)}
                    className="bds-select"
                  >
                    {DEV_TYPE_OPTIONS.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">阶段</label>
                  <select
                    value={form.stage}
                    onChange={(e) => updateField('stage', e.target.value as DevStage)}
                    className="bds-select"
                  >
                    {DEV_STAGE_OPTIONS.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">负责人</label>
                  <input
                    value={form.owner}
                    onChange={(e) => updateField('owner', e.target.value)}
                    placeholder="负责人姓名"
                    className="bds-input"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">当前轮次</label>
                  <input
                    type="number"
                    min={1}
                    value={form.currentRound}
                    onChange={(e) => updateField('currentRound', e.target.value)}
                    className="bds-input"
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
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">客户名</label>
                  <input
                    value={form.customerName}
                    onChange={(e) => updateField('customerName', e.target.value)}
                    placeholder="客户名称"
                    className="bds-input"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">供应商名</label>
                  <input
                    value={form.supplierName}
                    onChange={(e) => updateField('supplierName', e.target.value)}
                    placeholder="供应商名称"
                    className="bds-input"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">产品名</label>
                  <input
                    value={form.productName}
                    onChange={(e) => updateField('productName', e.target.value)}
                    placeholder="产品名称"
                    className="bds-input"
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
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">样品类型</label>
                  <select
                    value={form.sampleType}
                    onChange={(e) => updateField('sampleType', e.target.value as SampleType | '')}
                    className="bds-select"
                  >
                    <option value="">不指定</option>
                    {SAMPLE_TYPE_OPTIONS.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">样衣分档</label>
                  <select
                    value={form.sampleCategory}
                    onChange={(e) => updateField('sampleCategory', e.target.value as 'normal' | '5a')}
                    className="bds-select"
                  >
                    <option value="normal">普通样衣</option>
                    <option value="5a">5A 重点样衣</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">目标日期</label>
                  <input
                    type="date"
                    value={form.targetDate}
                    onChange={(e) => updateField('targetDate', e.target.value)}
                    className="bds-input"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">下一动作</label>
                  <input
                    value={form.nextAction}
                    onChange={(e) => updateField('nextAction', e.target.value)}
                    placeholder="下一步待办或行动项"
                    className="bds-input"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">备注</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateField('notes', e.target.value)}
                    placeholder="备注信息"
                    className="bds-input bds-textarea resize-none min-h-[96px]"
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
