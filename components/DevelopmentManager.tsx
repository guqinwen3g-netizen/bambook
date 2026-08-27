import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ChevronLeft, FileText, Package, PackageCheck, Plus, Pencil, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import {
  CompiledFormMapPanel,
  CompiledFormSectionPanel,
  CompiledModuleTitleBar,
  CompiledMotionInteractiveCard,
  CompiledSurfacePanel,
  CompiledTableShell,
} from './ui/primitives/compiledPrimitives';
import { developmentService } from '../services/developmentService';
import { apiService } from '../services/apiService';
import { consumeCrossModuleNav, primeCrossModuleNav } from '../services/crossModuleNav';
import { NavRelationFilterChip } from './ui/NavRelationFilterChip';
import type {
  DevelopmentCase as DevCase,
  DevelopmentCaseCreateInput,
  DevelopmentCaseUpdateInput,
  DevelopmentType as DevType,
  DevelopmentStage as DevStage,
  SampleType,
  ProductAssetDetail,
} from '../types';
import { View } from '../types';
import { RelatedWorkspacesSection } from './ui/RelatedWorkspacesSection';
import { SampleNodesPanel } from './development/SampleNodesPanel';
import { SampleColorBatchPanel } from './development/SampleColorBatchPanel';
import { primeQuotationCreateFromDevCase } from './QuotationManager';
import { primeFinanceInvoiceFocus } from './FinanceManager';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';

interface DevelopmentManagerProps {
  isDarkMode: boolean;
  cases: DevCase[];
  setCases: React.Dispatch<React.SetStateAction<DevCase[]>>;
  /** 阶段 IA-3：开发案详情「发起报价」跳转报价管理 */
  onNavigate?: (view: View) => void;
  /** DR-057 v2.1：开发单详情「已转订单」直达订单详情（App.handleOpenOrderById） */
  onOpenOrder?: (orderId: string) => void;
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

const DEV_FORM_SECTIONS_BASE = [
  { id: 'dev-basic', title: '基本信息', desc: '编号、名称、类型、阶段' },
  { id: 'dev-partner', title: '关联信息', desc: '客户、供应商、产品' },
  { id: 'dev-garment-spec', title: '成衣规格', desc: '款式、尺码、面料、工艺' },
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
  productAssetId: string;
  productName: string;
  currentRound: string;
  nextAction: string;
  targetDate: string;
  sampleType: SampleType | '';
  sampleCategory: 'normal' | '5a';
  // 寄样信息（DR-057 v2.1 用户验收口径：开发单须承载寄样快递全量留痕）
  sampleQuantity: string;
  sampleUnit: string;
  sampleSentDate: string;
  sampleCourier: string;
  sampleTrackingNumber: string;
  sampleShippingFee: string;
  // 寄样收件信息（DR-057 v2.1：收件方全量留痕）
  sampleRecipientName: string;
  sampleRecipientCompany: string;
  sampleRecipientAddress: string;
  sampleRecipientPhone: string;
  // 样品发票关联（跳财务发票详情直达）
  sampleInvoiceId: string;
  styleSpec: string;
  sizeSpec: string;
  fabricSpec: string;
  processSpec: string;
  notes: string;
}

const COURIER_OPTIONS = ['DHL', 'FedEx', 'UPS', 'TNT', 'SF Express', 'EMS', 'Other'] as const;
const SAMPLE_UNIT_OPTIONS = ['meter', 'yard', 'pc', 'set', 'kg'] as const;

const EMPTY_FORM: DevFormState = {
  code: '',
  name: '',
  type: 'fabric',
  stage: 'developing',
  owner: '',
  customerName: '',
  supplierName: '',
  productAssetId: '',
  productName: '',
  currentRound: '1',
  nextAction: '',
  targetDate: '',
  sampleType: '',
  sampleCategory: 'normal',
  sampleQuantity: '',
  sampleUnit: 'meter',
  sampleSentDate: '',
  sampleCourier: '',
  sampleTrackingNumber: '',
  sampleShippingFee: '',
  sampleRecipientName: '',
  sampleRecipientCompany: '',
  sampleRecipientAddress: '',
  sampleRecipientPhone: '',
  sampleInvoiceId: '',
  styleSpec: '',
  sizeSpec: '',
  fabricSpec: '',
  processSpec: '',
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
    productAssetId: (editingCase as any).productAssetId || '',
    productName: editingCase.productName || '',
    currentRound: String(editingCase.currentRound ?? 1),
    nextAction: editingCase.nextAction || '',
    targetDate: editingCase.targetDate || '',
    sampleType: editingCase.sampleType || '',
    sampleCategory: (editingCase as any).sampleCategory === '5a' ? '5a' : 'normal',
    sampleQuantity: editingCase.sampleQuantity != null ? String(editingCase.sampleQuantity) : '',
    sampleUnit: editingCase.sampleUnit || 'meter',
    sampleSentDate: editingCase.sampleSentDate || '',
    sampleCourier: editingCase.sampleCourier || '',
    sampleTrackingNumber: editingCase.sampleTrackingNumber || '',
    sampleShippingFee: editingCase.sampleShippingFee != null ? String(editingCase.sampleShippingFee) : '',
    sampleRecipientName: editingCase.sampleRecipientName || '',
    sampleRecipientCompany: editingCase.sampleRecipientCompany || '',
    sampleRecipientAddress: editingCase.sampleRecipientAddress || '',
    sampleRecipientPhone: editingCase.sampleRecipientPhone || '',
    sampleInvoiceId: editingCase.sampleInvoiceId || '',
    styleSpec: (editingCase as any).styleSpec || '',
    sizeSpec: (editingCase as any).sizeSpec || '',
    fabricSpec: (editingCase as any).fabricSpec || '',
    processSpec: (editingCase as any).processSpec || '',
    notes: editingCase.notes || '',
  };
};

const DevelopmentManager: React.FC<DevelopmentManagerProps> = ({ isDarkMode, cases, setCases, onNavigate, onOpenOrder }) => {
  const [selectedType, setSelectedType] = useState<DevelopmentTypeId>('all');
  const [selectedStage, setSelectedStage] = useState<DevelopmentStageId>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const formScrollRef = useRef<HTMLDivElement | null>(null);

  // 跨模块导航筛选（关系/样品间档案「关联业务 → 开发」入口）：挂载时消费一次
  // 同时携带 filter（列表筛选）与 focusEntityId（精准定位开发单详情）
  const [navCtx, setNavCtx] = useState(() => consumeCrossModuleNav());
  const navRelationFilter = navCtx?.filter ?? null;
  const navFocusEntityId = navCtx?.focusEntityId ?? null;

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
      if (navRelationFilter && item.customerRelationId !== navRelationFilter.relationId) return false;
      if (selectedType !== 'all' && item.type !== selectedType) return false;
      if (selectedStage !== 'all' && item.stage !== selectedStage) return false;
      if (normalizedSearch) {
        const haystack = `${item.name || ''} ${item.code || ''} ${item.customerName || ''} ${item.supplierName || ''} ${item.productName || ''}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });
  }, [cases, selectedType, selectedStage, searchTerm, navRelationFilter]);

  const selectedCase = filteredCases.find(item => item.id === selectedCaseId) || filteredCases[0];

  // 跨模块导航 focusEntityId 直达：从样品间/订单详情等入口跳转过来时，
  // 定位对应开发单（首选 filteredCases 命中，回退到 cases 全量匹配，避免被当前筛选条件吞掉）
  useEffect(() => {
    if (!navFocusEntityId) return;
    const matched =
      filteredCases.find(c => c.id === navFocusEntityId) ??
      cases.find(c => c.id === navFocusEntityId);
    if (matched) setSelectedCaseId(matched.id);
  }, [navFocusEntityId, filteredCases, cases]);

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<DevCase | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
  const [form, setForm] = useState<DevFormState>(EMPTY_FORM);

  const updateField = useCallback(<K extends keyof DevFormState>(key: K, value: DevFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  // ── ProductAsset 搜索（2.10 关联产品资产）──
  const [paSearch, setPaSearch] = useState('');
  const [paResults, setPaResults] = useState<ProductAssetDetail[]>([]);
  const [paLoading, setPaLoading] = useState(false);
  const [paDropdownOpen, setPaDropdownOpen] = useState(false);

  useEffect(() => {
    if (!paSearch.trim()) { setPaResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPaLoading(true);
      try {
        const mainCategory = form.type === 'garment' ? 'Garment' : 'Fabric';
        const assets = await apiService.listProductAssets(undefined, { search: paSearch.trim(), mainCategory, limit: 6 });
        if (!cancelled) setPaResults(assets);
      } catch { if (!cancelled) setPaResults([]); }
      finally { if (!cancelled) setPaLoading(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [paSearch, form.type]);

  const selectProductAsset = useCallback((asset: ProductAssetDetail) => {
    updateField('productAssetId', asset.id);
    updateField('productName', asset.name);
    setPaSearch('');
    setPaDropdownOpen(false);
  }, [updateField]);

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
      bdsToast.warning('当前轮次必须是有效的非负整数');
      return;
    }
    if (form.targetDate) {
      const d = new Date(form.targetDate);
      if (isNaN(d.getTime())) { bdsToast.warning('交样日期格式无效'); return; }
    }
    if (form.sampleSentDate) {
      const d = new Date(form.sampleSentDate);
      if (isNaN(d.getTime())) { bdsToast.warning('寄出日期格式无效'); return; }
    }
    const parsedQty = form.sampleQuantity === '' ? null : Number(form.sampleQuantity);
    if (parsedQty != null && (!Number.isFinite(parsedQty) || parsedQty < 0)) {
      bdsToast.warning('样品数量必须是有效的非负数值');
      return;
    }
    const parsedFee = form.sampleShippingFee === '' ? null : Number(form.sampleShippingFee);
    if (parsedFee != null && (!Number.isFinite(parsedFee) || parsedFee < 0)) {
      bdsToast.warning('邮寄费必须是有效的非负数值');
      return;
    }
    // 寄样字段（sampleSentDate 等）属于 UpdateInput 专属：create 场景后端显式字段表同样支持
    // sampleQuantity/sampleUnit/sampleShippingFee，其余寄样字段随 update 链路提交。
    const input: DevelopmentCaseCreateInput & Partial<DevelopmentCaseUpdateInput> = {
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
      stage: form.stage,
      ...(form.owner.trim() ? { owner: form.owner.trim() } : {}),
      ...(form.customerName.trim() ? { customerName: form.customerName.trim() } : {}),
      ...(form.supplierName.trim() ? { supplierName: form.supplierName.trim() } : {}),
      ...(form.productAssetId.trim() ? { productAssetId: form.productAssetId.trim() } : {}),
      ...(form.productName.trim() ? { productName: form.productName.trim() } : {}),
      currentRound: Number.isFinite(parsedRound) && parsedRound > 0 ? parsedRound : 1,
      ...(form.nextAction.trim() ? { nextAction: form.nextAction.trim() } : {}),
      ...(form.targetDate ? { targetDate: form.targetDate } : {}),
      ...(form.sampleType ? { sampleType: form.sampleType } : {}),
      sampleCategory: form.sampleCategory,
      // 寄样信息（DR-057 v2.1）：数量/单位/邮寄费为 create+update 共有；寄出日期/快递公司/单号随 update 提交
      ...(parsedQty != null ? { sampleQuantity: parsedQty } : {}),
      sampleUnit: form.sampleUnit,
      ...(parsedFee != null ? { sampleShippingFee: parsedFee } : {}),
      ...(form.sampleSentDate ? { sampleSentDate: form.sampleSentDate } : {}),
      ...(form.sampleCourier.trim() ? { sampleCourier: form.sampleCourier.trim() } : {}),
      ...(form.sampleTrackingNumber.trim() ? { sampleTrackingNumber: form.sampleTrackingNumber.trim() } : {}),
      // 寄样收件信息（DR-057 v2.1）+ 样品发票关联
      ...(form.sampleRecipientName.trim() ? { sampleRecipientName: form.sampleRecipientName.trim() } : {}),
      ...(form.sampleRecipientCompany.trim() ? { sampleRecipientCompany: form.sampleRecipientCompany.trim() } : {}),
      ...(form.sampleRecipientAddress.trim() ? { sampleRecipientAddress: form.sampleRecipientAddress.trim() } : {}),
      ...(form.sampleRecipientPhone.trim() ? { sampleRecipientPhone: form.sampleRecipientPhone.trim() } : {}),
      ...(form.sampleInvoiceId.trim() ? { sampleInvoiceId: form.sampleInvoiceId.trim() } : {}),
      ...(form.styleSpec.trim() ? { styleSpec: form.styleSpec.trim() } : {}),
      ...(form.sizeSpec.trim() ? { sizeSpec: form.sizeSpec.trim() } : {}),
      ...(form.fabricSpec.trim() ? { fabricSpec: form.fabricSpec.trim() } : {}),
      ...(form.processSpec.trim() ? { processSpec: form.processSpec.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };
    handleFormSubmit(input);
  }, [form, handleFormSubmit]);

  const handleDelete = useCallback(async () => {
    if (!selectedCase) return;
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除开发单「${selectedCase.name}」(${selectedCase.code})？\n此操作不可撤销。`, danger: true }))) return;
    const deletedId = selectedCase.id;
    try {
      await developmentService.deleteDevelopmentCase(deletedId);
      setCases(prev => prev.filter(c => c.id !== deletedId));
      setSelectedCaseId(null);
    } catch (err: any) {
      bdsToast.danger(`删除失败：${err?.message || err}`);
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
        {
          label: '样品数量',
          value: selectedCase.sampleQuantity != null ? `${selectedCase.sampleQuantity} ${selectedCase.sampleUnit || ''}`.trim() : '—',
        },
        { label: '寄出日期', value: selectedCase.sampleSentDate || '—' },
        { label: '快递公司', value: selectedCase.sampleCourier || '—' },
        { label: '快递单号', value: selectedCase.sampleTrackingNumber || '—' },
        {
          label: '邮寄费',
          value: selectedCase.sampleShippingFee != null ? String(selectedCase.sampleShippingFee) : '—',
        },
        {
          label: '收件人',
          value: [selectedCase.sampleRecipientName, selectedCase.sampleRecipientCompany].filter(Boolean).join(' · ') || '—',
        },
        { label: '收件地址', value: selectedCase.sampleRecipientAddress || '—' },
        { label: '联系电话', value: selectedCase.sampleRecipientPhone || '—' },
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
              <RefreshCw size={14} className={cx(isRefreshing && 'animate-spin')} />
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
          {navRelationFilter && (
            <NavRelationFilterChip filter={navRelationFilter} label="开发" onClear={() => setNavCtx(null)} />
          )}
          {/* 根因修复（2026-08-21）：原搜索框 min-w-48 + 两 select shrink-0（且 w-30 为无效
              Tailwind 类导致 auto 宽度跳变），窄视口下整行最小宽 ~500px 不可收缩，flex-wrap
              把 select 挤成错乱两行。改为财务同款范式：全行 min-w-0 可收缩，任何宽度保持单行。 */}
          <div className="bds-filterbar shrink-0 flex-wrap gap-y-2">
            <div className="relative min-w-0 flex-[1_1_220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="开发单 / 伙伴"
                className="bds-input pl-9"
              />
            </div>
            <div className="hidden h-4 w-px shrink-0 xl:block bg-[var(--border-c-strong)]" />
            <select
              className="bds-select w-36"
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
              className="bds-select w-36"
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value as DevelopmentStageId)}
            >
              {DEVELOPMENT_STAGES.map(item => (
                <option key={item.id} value={item.id}>
                  {item.id === 'all' ? item.label : `${item.label} · ${cases.filter(c => c.stage === item.id).length}`}
                </option>
              ))}
            </select>
            {/* DR-057 v2.1 寄样成本统计：当前筛选范围邮寄费合计（币种随各开发单客户合同） */}
            {(() => {
              const total = filteredCases.reduce((sum, c) => sum + (Number(c.sampleShippingFee) || 0), 0);
              if (total <= 0) return null;
              return (
                <span className="bds-badge sm neutral ml-auto shrink-0" title="当前筛选范围开发单的邮寄费合计（币种随各客户合同）">
                  寄样支出 {total % 1 === 0 ? total : total.toFixed(2)}
                </span>
              );
            })()}
          </div>

          {/* 侧栏宽改为响应式 minmax(320px,360px)：原硬锁 320px 在窄 xl 视口下过小，
              详情内容（样品节点/打色批次/关联业务）堆积易溢出（与财务管理同一根因）。 */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-visible xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
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
                    <div className="glyph"><PackageCheck size={24} strokeWidth={1.5} /></div>
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
                    {/* 与财务管理详情头部同一范式（2026-08-21）：头部行 flex-wrap，
                        窄 panel 下按钮簇整块落到标题下方而非顶破；状态徽章归标题块，与动作按钮分离。 */}
                    <div className="flex flex-wrap min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={cx('text-[10px] tracking-[0.18em]', textSecondaryClass)}>当前开发单</div>
                        <div className={cx('mt-2 truncate text-base', textPrimaryClass)}>{selectedCase.name}</div>
                        <div className={cx('mt-1 truncate text-[11px]', textSecondaryClass)}>{selectedCase.code} · {typeLabelMap[selectedCase.type]} · S{selectedCase.currentRound}</div>
                        <div className="mt-2"><span className={`bds-badge sm ${stageTone(selectedCase.stage)}`}>{stageLabelMap[selectedCase.stage]}</span></div>
                      </div>
                      {/* 按钮簇只放纯动作按钮；flex-wrap + justify-start：窄 panel 下可换行且左对齐整齐 */}
                      <div className="flex flex-wrap items-center justify-start gap-2">
                        {/* REQ2-16 v2.1 跨模块联动：跳转库存管理·样品 Tab 并按本开发单预过滤
                            （crossModuleNav 三段式：tab='samples' 定位 Tab，focusEntityId=devCaseId 预过滤） */}
                        {onNavigate && (
                          <button
                            type="button"
                            onClick={() => {
                              primeCrossModuleNav({ view: View.Inventory, tab: 'samples', focusEntityId: selectedCase.id });
                              onNavigate(View.Inventory);
                            }}
                            title="跳转到库存管理·样品间，并按本开发单预过滤"
                            className="bds-btn bds-btn-secondary"
                          >
                            <Package size={14} />
                            样品库存
                          </button>
                        )}
                        {/* 样品发票 → 财务发票管理（View.Invoices 映射 FinanceManager initialTab='invoices'）；
                            已关联 sampleInvoiceId 时 primeFinanceInvoiceFocus 直达该发票详情 */}
                        {onNavigate && (
                          <button
                            type="button"
                            onClick={() => {
                              if (selectedCase.sampleInvoiceId) {
                                primeFinanceInvoiceFocus(selectedCase.sampleInvoiceId);
                              }
                              onNavigate(View.Invoices);
                            }}
                            title={selectedCase.sampleInvoiceId
                              ? '跳转到财务·发票管理，并直达关联的样品发票详情'
                              : '跳转到财务·发票管理，登记或查看本开发单的样品发票（编辑表单可关联发票 ID 直达）'}
                            className="bds-btn bds-btn-secondary"
                          >
                            <FileText size={14} />
                            样品发票
                          </button>
                        )}
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
                            <FileText size={14} />
                            发起报价
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={openEditModal}
                          className="bds-btn bds-btn-secondary"
                        >
                          <Pencil size={14} />
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={handleDelete}
                          className="bds-btn bds-btn-danger"
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
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
                    {/* REQ2-01 打色批次（色差管理体系）：面料/成衣打色阶段缸号级批色记录 */}
                    <div className="mt-4">
                      <SampleColorBatchPanel key={`color-${selectedCase.id}`} stage="lab_dip" developmentCaseId={selectedCase.id} isDarkMode={isDarkMode} />
                    </div>
                    {selectedCase.stage === 'approved' && !selectedCase.linkedOrderId && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!selectedCase) return;
                          if (!(await bdsConfirm({ title: '转为大货订单', body: `将 ${selectedCase.code} 转为大货订单？\n系统会自动沿用客户/供应商/产品。` }))) return;
                          try {
                            const res = await developmentService.convertToOrder(selectedCase.id, { autoCreate: true });
                            await handleRefresh();
                            bdsToast.success(`已转为订单 ${res.order?.poNumber ?? '(未返回PO)'}。`);
                          } catch (err: any) {
                            bdsToast.danger(`转订单失败：${err.message || err}`);
                          }
                        }}
                        className="bds-btn bds-btn-primary w-full mt-3"
                      >
                        一键转为大货订单
                      </button>
                    )}
                    {selectedCase.linkedOrderId && (
                      onOpenOrder ? (
                        <button
                          type="button"
                          onClick={() => onOpenOrder(selectedCase.linkedOrderId!)}
                          title="直达关联大货订单详情"
                          className="bds-btn bds-btn-secondary w-full mt-3"
                        >
                          <PackageCheck size={14} />
                          已转订单 · {selectedCase.linkedOrderPo || selectedCase.linkedOrderId}
                        </button>
                      ) : (
                        <div className="bds-alert success mt-3">
                          已转订单 · {selectedCase.linkedOrderPo || selectedCase.linkedOrderId}
                        </div>
                      )
                    )}
                    {selectedCase.customerRelationId && (
                    <div className="mt-4">
                      <RelatedWorkspacesSection
                        sourceType="relation"
                        relationId={selectedCase.customerRelationId}
                        relationName={selectedCase.customerName ?? ''}
                        relationRole="customer"
                        onNavigate={onNavigate}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="bds-empty h-full justify-center">
                  <div className="glyph"><PackageCheck size={24} strokeWidth={1.5} /></div>
                  <div className="title">请选择开发单</div>
                </div>
              )}
            </CompiledSurfacePanel>
          </div>
        </div>

        {/* REQ2-16 样品间联动（DR-057 v2.1）：开发单详情「样品库存」按钮跳转
            库存管理·样品 Tab（crossModuleNav tab='samples' + focusEntityId 预过滤），
            本页不再底部内嵌 SampleRoomPanel（用户验收口径：内嵌展开视觉混乱，改为整页跳转）。 */}
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
                    <ChevronLeft size={18} strokeWidth={1.5} />
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
                    {DEV_FORM_SECTIONS_BASE.filter(s => s.id !== 'dev-garment-spec' || form.type === 'garment').map((section, idx) => (
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

              <div ref={formScrollRef} className="min-w-0 -mt-[7rem] h-[calc(100%+7rem)] overflow-y-auto overscroll-contain space-y-6 pt-24 pb-[176px] bambook-panel-shadow-viewport">
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
                    className="bds-select"
                    value={form.type}
                    onChange={(e) => updateField('type', e.target.value as DevType)}
                  >
                    {DEV_TYPE_OPTIONS.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">阶段</label>
                  <select
                    className="bds-select"
                    value={form.stage}
                    onChange={(e) => updateField('stage', e.target.value as DevStage)}
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
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">关联产品 / 产品名</label>
                  {form.productAssetId && (
                    <div className="mb-2 flex items-center gap-2">
                      <span className="bds-badge info text-[10px]">已关联</span>
                      <span className="text-xs font-light text-[var(--text-primary)] truncate flex-1">{form.productName}</span>
                      <button type="button" onClick={() => { updateField('productAssetId', ''); }} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0">
                        取消关联
                      </button>
                    </div>
                  )}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" />
                    <input
                      value={paSearch}
                      onChange={(e) => { setPaSearch(e.target.value); setPaDropdownOpen(true); }}
                      onFocus={() => setPaDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setPaDropdownOpen(false), 200)}
                      placeholder={`搜索${form.type === 'garment' ? '成衣' : '面料'}产品资产…`}
                      className="bds-input pl-9 mb-2"
                    />
                    {paDropdownOpen && (paSearch.trim() || paLoading) && (
                      <div className="absolute z-50 mt-1 w-full rounded-card border border-[var(--border-c-subtle)] bg-[var(--surface-bg)] max-h-48 overflow-y-auto">
                        {paLoading && <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">搜索中…</div>}
                        {!paLoading && paResults.length === 0 && paSearch.trim() && (
                          <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">无匹配结果</div>
                        )}
                        {paResults.map(asset => (
                          <button key={asset.id} type="button" onMouseDown={(e) => { e.preventDefault(); selectProductAsset(asset); }} className="w-full px-3 py-2 text-left hover:bg-[var(--recessed-bg)] transition-colors">
                            <div className="text-xs font-light text-[var(--text-primary)] truncate">{asset.name}</div>
                            <div className="text-[10px] text-[var(--text-tertiary)] truncate">{asset.sku}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    value={form.productName}
                    onChange={(e) => updateField('productName', e.target.value)}
                    placeholder="产品名称（可手动输入或从上方搜索选择）"
                    className="bds-input"
                  />
                </div>
              </CompiledFormSectionPanel>

              {form.type === 'garment' && (
              <CompiledFormSectionPanel
                id="dev-garment-spec"
                title="成衣规格"
                isDarkMode={isDarkMode}
                materialRole="raisedCard"
                contentBaseClassName="grid grid-cols-2 gap-4"
              >
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">款式</label>
                  <input value={form.styleSpec} onChange={(e) => updateField('styleSpec', e.target.value)} placeholder="如 V领衬衫" className="bds-input" />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">尺码</label>
                  <input value={form.sizeSpec} onChange={(e) => updateField('sizeSpec', e.target.value)} placeholder="如 S/M/L" className="bds-input" />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">面料</label>
                  <input value={form.fabricSpec} onChange={(e) => updateField('fabricSpec', e.target.value)} placeholder="如 全棉府绸" className="bds-input" />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">工艺</label>
                  <input value={form.processSpec} onChange={(e) => updateField('processSpec', e.target.value)} placeholder="如 成衣染色" className="bds-input" />
                </div>
              </CompiledFormSectionPanel>
              )}

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
                    className="bds-select"
                    value={form.sampleType}
                    onChange={(e) => updateField('sampleType', e.target.value as SampleType | '')}
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
                    className="bds-select"
                    value={form.sampleCategory}
                    onChange={(e) => updateField('sampleCategory', e.target.value as 'normal' | '5a')}
                  >
                    <option value="normal">普通样衣</option>
                    <option value="5a">5A 重点样衣</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">目标日期</label>
                  <CapsuleDateInput className="bds-input" value={form.targetDate} onChange={(value) => updateField('targetDate', value)} />
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
                    className="bds-input bds-textarea resize-none min-h-24"
                  />
                </div>
              </CompiledFormSectionPanel>

              {/* 寄样信息（DR-057 v2.1 用户验收口径）：快递单号/快递公司/寄出日期/样品数量/单位/邮寄费全量留痕 */}
              <CompiledFormSectionPanel
                id="dev-sample-shipment"
                title="寄样信息"
                isDarkMode={isDarkMode}
                materialRole="raisedCard"
                contentBaseClassName="grid grid-cols-2 gap-4"
              >
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">样品数量</label>
                  <input
                    type="number"
                    min="0"
                    value={form.sampleQuantity}
                    onChange={(e) => updateField('sampleQuantity', e.target.value)}
                    placeholder="如 3"
                    className="bds-input"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">单位</label>
                  <select
                    className="bds-select"
                    value={form.sampleUnit}
                    onChange={(e) => updateField('sampleUnit', e.target.value)}
                  >
                    {SAMPLE_UNIT_OPTIONS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">寄出日期</label>
                  <CapsuleDateInput className="bds-input" value={form.sampleSentDate} onChange={(value) => updateField('sampleSentDate', value)} />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">快递公司</label>
                  <select
                    className="bds-select"
                    value={form.sampleCourier}
                    onChange={(e) => updateField('sampleCourier', e.target.value)}
                  >
                    <option value="">未寄出</option>
                    {COURIER_OPTIONS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">快递单号</label>
                  <input
                    value={form.sampleTrackingNumber}
                    onChange={(e) => updateField('sampleTrackingNumber', e.target.value)}
                    placeholder="如 7798 1234 5678"
                    className="bds-input"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">邮寄费</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.sampleShippingFee}
                    onChange={(e) => updateField('sampleShippingFee', e.target.value)}
                    placeholder="如 45.50（随客户合同币种）"
                    className="bds-input"
                  />
                </div>
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">收件人</label>
                    <input
                      value={form.sampleRecipientName}
                      onChange={(e) => updateField('sampleRecipientName', e.target.value)}
                      placeholder="如 Emma Lindqvist"
                      className="bds-input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">收件公司</label>
                    <input
                      value={form.sampleRecipientCompany}
                      onChange={(e) => updateField('sampleRecipientCompany', e.target.value)}
                      placeholder="如 Norden Studio AB"
                      className="bds-input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">收件地址</label>
                    <input
                      value={form.sampleRecipientAddress}
                      onChange={(e) => updateField('sampleRecipientAddress', e.target.value)}
                      placeholder="如 Stockholm, Sweden"
                      className="bds-input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">联系电话</label>
                    <input
                      value={form.sampleRecipientPhone}
                      onChange={(e) => updateField('sampleRecipientPhone', e.target.value)}
                      placeholder="如 +46 70 123 4567"
                      className="bds-input"
                    />
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs mb-1 ml-1 text-[var(--text-tertiary)]">关联样品发票 ID（可选，用于发票详情直达）</label>
                  <input
                    value={form.sampleInvoiceId}
                    onChange={(e) => updateField('sampleInvoiceId', e.target.value)}
                    placeholder="发票管理中的发票 ID；填写后「样品发票」按钮直达该发票详情"
                    className="bds-input"
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
