/**
 * 生产执行 MES Manager
 * Phase 3 C2：制造执行系统深化 — 工位 / 排产 / 工时 / 计件 / 外协
 *
 * 功能：
 *   - 排产管理（ProductionPlan）：CRUD + 状态机（Draft→Confirmed→InProgress→Completed/Cancelled）+ 进度更新
 *   - 工位管理（WorkStation）：CRUD + 利用率
 *   - 工时记录（WorkHour）：CRUD + 汇总
 *   - 计件规则（PieceRateRule）：CRUD
 *   - 计件记录（PieceRateRecord）：自动金额 + 状态机（Pending→Confirmed→Paid）+ 汇总
 *   - 外协订单（OutsourcingOrder）：CRUD + 状态机 + 到货验收
 *
 * 设计：BDS v2.1 — 组件对主题透明（无 isDarkMode 样式分支），暗色由 tokens.css 统一覆盖
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Cog,
  CalendarClock,
  Clock,
  Award,
  Send,
  X,
  CheckCircle2,
  Factory,
  PlayCircle,
  StopCircle,
  PackageCheck,
  Download,
  Search,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import { hasPermission } from '../services/authService';
import { bdsToast } from './ui/bdsToast';
import {
  WorkStation,
  WorkStationInput,
  WorkStationType,
  ProductionPlan,
  ProductionPlanInput,
  ProductionPlanStatus,
  Priority,
  WorkHour,
  WorkHourInput,
  PieceRateRule,
  PieceRateRuleInput,
  PieceRateRecord,
  PieceRateRecordInput,
  PieceRateStatus,
  OutsourcingOrder,
  OutsourcingOrderInput,
  OutsourcingStatus,
  OutsourcingProcessType,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { StatusSemantic } from './rdlBusinessStatusTokens';
import { useStaticEdgeMask } from './ui/useStaticEdgeMask';
import CapsuleDateInput from './ui/CapsuleDateInput';
import CustomSelect from './ui/CustomSelect';
import { consumeCrossModuleNav } from '../services/crossModuleNav';
import { NavRelationFilterChip } from './ui/NavRelationFilterChip';
import { bdsConfirm } from './ui/BdsDialog';

// ==================== 常量 ====================

// R678：MES 各 Tab 服务端真分页（apiService/后端 mesRoute 已支持 limit/offset + total 真实计数），
// 每页 200 条 + 「加载更多」追加；MES_LIST_RENDER_LIMIT 退化为客户端渲染上限兜底（防一次性渲染过多卡片）。
const MES_PAGE_SIZE = 200;
const MES_LIST_RENDER_LIMIT = 200;

const WS_TYPES: Array<{ id: WorkStationType; label: string }> = [
  { id: 'Sewing', label: '缝纫' },
  { id: 'Cutting', label: '裁剪' },
  { id: 'Printing', label: '印花' },
  { id: 'Embroidery', label: '绣花' },
  { id: 'Packing', label: '包装' },
  { id: 'QC', label: '质检' },
  { id: 'Other', label: '其他' },
];

const OUTSOURCING_PROCESS_TYPES: Array<{ id: OutsourcingProcessType; label: string }> = [
  { id: 'Sewing', label: '缝纫' },
  { id: 'Cutting', label: '裁剪' },
  { id: 'Washing', label: '水洗' },
  { id: 'Printing', label: '印花' },
  { id: 'Embroidery', label: '绣花' },
  { id: 'Dyeing', label: '染色' },
  { id: 'Other', label: '其他' },
];

// BDS v2.1：semantic 直接映射 bds-badge 语义变体（neutral/info/success/danger/warning）
const PLAN_STATUSES: Array<{ id: ProductionPlanStatus; label: string; semantic: StatusSemantic }> = [
  { id: 'Draft', label: '草稿', semantic: 'neutral' },
  { id: 'Confirmed', label: '已确认', semantic: 'info' },
  { id: 'InProgress', label: '进行中', semantic: 'warning' },
  { id: 'Completed', label: '已完成', semantic: 'success' },
  { id: 'Cancelled', label: '已取消', semantic: 'danger' },
];

const OUTSOURCING_STATUSES: Array<{ id: OutsourcingStatus; label: string; semantic: StatusSemantic }> = [
  { id: 'Draft', label: '草稿', semantic: 'neutral' },
  { id: 'Sent', label: '已发送', semantic: 'info' },
  { id: 'Confirmed', label: '已确认', semantic: 'info' },
  { id: 'InProduction', label: '生产中', semantic: 'warning' },
  { id: 'Received', label: '已到货', semantic: 'success' },
  { id: 'Cancelled', label: '已取消', semantic: 'danger' },
];

const PIECE_RATE_STATUSES: Array<{ id: PieceRateStatus; label: string; semantic: StatusSemantic }> = [
  { id: 'Pending', label: '待审', semantic: 'neutral' },
  { id: 'Confirmed', label: '已确认', semantic: 'info' },
  { id: 'Paid', label: '已支付', semantic: 'success' },
];

const PRIORITIES: Array<{ id: Priority; label: string }> = [
  { id: 'High', label: '高' },
  { id: 'Normal', label: '正常' },
  { id: 'Low', label: '低' },
];

const UNITS = ['PC', 'SET', 'YD', 'M', 'KG', 'PCS'];

const todayStr = () => new Date().toISOString().slice(0, 10);

// R678③：弹层表单初始值工厂（打开时重置，防上次取消残留带入下次）
const initialPlanForm = (): ProductionPlanInput => ({
  planNumber: '', workStationId: '', processType: 'Sewing', plannedQuantity: 0, unit: 'PC',
  plannedStartDate: todayStr(), plannedEndDate: todayStr(), priority: 'Normal',
});
const initialWsForm = (): WorkStationInput => ({
  code: '', name: '', type: 'Sewing', capacityPerDay: undefined, capacityUnit: 'PC', location: '', manager: '',
});
const initialWhForm = (): WorkHourInput => ({
  productionPlanId: '', workDate: todayStr(), hours: 0, overtimeHours: 0,
});
const initialRuleForm = (): PieceRateRuleInput => ({
  code: '', name: '', processType: 'Sewing', unit: 'PC', ratePerUnit: 0, effectiveFrom: todayStr(),
});
const initialRecordForm = (): PieceRateRecordInput => ({
  pieceRateRuleId: '', workDate: todayStr(), quantity: 0, unit: 'PC',
});
const initialOsoForm = (): OutsourcingOrderInput => ({
  orderNumber: '', supplierId: '', processType: 'Sewing', quantity: 0, unit: 'PC', unitPrice: 0, currency: 'CNY',
});

function statusLabel<T extends { id: string; label: string }>(list: T[], id: string): string {
  return list.find(s => s.id === id)?.label ?? id;
}
function statusSemanticOf<T extends { id: string; semantic: StatusSemantic }>(list: T[], id: string): StatusSemantic {
  return list.find(s => s.id === id)?.semantic ?? 'neutral';
}

interface MesManagerProps {
  isDarkMode: boolean;
}

type TabId = 'plans' | 'workStations' | 'workHours' | 'pieceRateRules' | 'pieceRateRecords' | 'outsourcing';

const MesManager: React.FC<MesManagerProps> = ({ isDarkMode }) => {
  const [activeTab, setActiveTab] = useState<TabId>('plans');
  // 边缘渐隐：固定 mask 挂滚动容器自身（12px 轻微渐隐——修复原 ScrollEdgeFades null-ref 断链，恢复渐隐）
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  useStaticEdgeMask(contentScrollRef, { topFadeEnd: 12, bottomFade: 12 });

  // ── 跨模块导航：消费上下文（外协入口跳转 → 自动切外协 tab + 供应商筛选）──
  const navContext = useState(() => consumeCrossModuleNav())[0];
  const [navRelationFilter, setNavRelationFilter] = useState(() => navContext?.filter ?? null);
  useEffect(() => {
    if (navRelationFilter || navContext?.tab === 'outsourcing') setActiveTab('outsourcing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 各 Tab 数据（R678：服务端真分页，total 为后端真实计数） ──
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [plansTotal, setPlansTotal] = useState(0);
  const [workStations, setWorkStations] = useState<WorkStation[]>([]);
  const [workStationsTotal, setWorkStationsTotal] = useState(0);
  const [workHours, setWorkHours] = useState<WorkHour[]>([]);
  const [workHoursTotal, setWorkHoursTotal] = useState(0);
  const [pieceRateRules, setPieceRateRules] = useState<PieceRateRule[]>([]);
  const [pieceRateRulesTotal, setPieceRateRulesTotal] = useState(0);
  const [pieceRateRecords, setPieceRateRecords] = useState<PieceRateRecord[]>([]);
  const [pieceRateRecordsTotal, setPieceRateRecordsTotal] = useState(0);
  const [outsourcingOrders, setOutsourcingOrders] = useState<OutsourcingOrder[]>([]);
  const [outsourcingTotal, setOutsourcingTotal] = useState(0);
  const [loadingMoreTab, setLoadingMoreTab] = useState<TabId | null>(null);

  // R678④：各 Tab 搜索 + 关键状态筛选（客户端过滤已加载条目）
  const [searchQuery, setSearchQuery] = useState('');
  const [planStatusFilter, setPlanStatusFilter] = useState('');
  const [wsTypeFilter, setWsTypeFilter] = useState('');
  const [osoStatusFilter, setOsoStatusFilter] = useState('');
  const [ruleActiveFilter, setRuleActiveFilter] = useState<'' | 'active' | 'inactive'>('');
  const [recordStatusFilter, setRecordStatusFilter] = useState('');

  // R678⑤：外协供应商下拉数据源（Relation 档案，供应商口径与采购域一致）
  const [supplierOptions, setSupplierOptions] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    apiService.listRelations().then((list) => {
      setSupplierOptions(
        list
          .filter((r) => !r.deletedAt && (r.type === 'Supplier' || r.category === 'Supplier'))
          .map((r) => ({ id: r.id, label: r.englishName || r.chineseName || r.name })),
      );
    }).catch(() => {});
  }, []);
  const supplierNameById = useMemo(() => new Map(supplierOptions.map((s) => [s.id, s.label])), [supplierOptions]);

  // R6：写操作权限门（production:write；无权限隐藏创建/删除/流转按钮，只读可用）
  const canWrite = hasPermission('production:write');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  // ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 样式分支（仅透传 PageHeader 等） ──

  // ── 拉取数据（R678：offset=0 重置首屏；>0 加载更多追加；total 后端真实计数） ──
  const fetchPlans = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMoreTab('plans');
    try {
      const r = await apiService.listProductionPlans({ limit: MES_PAGE_SIZE, offset });
      setPlans(prev => (offset === 0 ? r.items : [...prev, ...r.items]));
      setPlansTotal(r.total);
    } catch (e: any) { setError(e?.message || '加载排产失败'); }
    finally { if (offset > 0) setLoadingMoreTab(null); }
  }, []);

  /** 生产计划台账 Excel 导出（全量，与列表口径一致） */
  const handleExportPlansXlsx = useCallback(async () => {
    setExportingXlsx(true);
    try {
      await apiService.exportMesPlansXlsx();
    } catch (e: any) {
      setError(`台账导出失败：${e?.message || e}`);
    } finally {
      setExportingXlsx(false);
    }
  }, []);

  const fetchWorkStations = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMoreTab('workStations');
    try {
      const r = await apiService.listWorkStations({ limit: MES_PAGE_SIZE, offset });
      setWorkStations(prev => (offset === 0 ? r.items : [...prev, ...r.items]));
      setWorkStationsTotal(r.total);
    } catch (e: any) { setError(e?.message || '加载工位失败'); }
    finally { if (offset > 0) setLoadingMoreTab(null); }
  }, []);

  const fetchWorkHours = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMoreTab('workHours');
    try {
      const r = await apiService.listWorkHours({ limit: MES_PAGE_SIZE, offset });
      setWorkHours(prev => (offset === 0 ? r.items : [...prev, ...r.items]));
      setWorkHoursTotal(r.total);
    } catch (e: any) { setError(e?.message || '加载工时失败'); }
    finally { if (offset > 0) setLoadingMoreTab(null); }
  }, []);

  const fetchPieceRateRules = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMoreTab('pieceRateRules');
    try {
      const r = await apiService.listPieceRateRules({ limit: MES_PAGE_SIZE, offset });
      setPieceRateRules(prev => (offset === 0 ? r.items : [...prev, ...r.items]));
      setPieceRateRulesTotal(r.total);
    } catch (e: any) { setError(e?.message || '加载计件规则失败'); }
    finally { if (offset > 0) setLoadingMoreTab(null); }
  }, []);

  const fetchPieceRateRecords = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMoreTab('pieceRateRecords');
    try {
      const r = await apiService.listPieceRateRecords({ limit: MES_PAGE_SIZE, offset });
      setPieceRateRecords(prev => (offset === 0 ? r.items : [...prev, ...r.items]));
      setPieceRateRecordsTotal(r.total);
    } catch (e: any) { setError(e?.message || '加载计件记录失败'); }
    finally { if (offset > 0) setLoadingMoreTab(null); }
  }, []);

  const fetchOutsourcing = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMoreTab('outsourcing');
    try {
      const r = await apiService.listOutsourcingOrders({ limit: MES_PAGE_SIZE, offset });
      setOutsourcingOrders(prev => (offset === 0 ? r.items : [...prev, ...r.items]));
      setOutsourcingTotal(r.total);
    } catch (e: any) { setError(e?.message || '加载外协订单失败'); }
    finally { if (offset > 0) setLoadingMoreTab(null); }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchPlans(), fetchWorkStations(), fetchOutsourcing(), fetchPieceRateRules(), fetchPieceRateRecords(), fetchWorkHours()]);
    } finally {
      setLoading(false);
    }
  }, [fetchPlans, fetchWorkStations, fetchOutsourcing, fetchPieceRateRules, fetchPieceRateRecords, fetchWorkHours]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  const refreshTab = useCallback(async (tab: TabId) => {
    setActionLoading(`refresh:${tab}`);
    try {
      if (tab === 'plans') await fetchPlans();
      else if (tab === 'workStations') await fetchWorkStations();
      else if (tab === 'workHours') await fetchWorkHours();
      else if (tab === 'pieceRateRules') await fetchPieceRateRules();
      else if (tab === 'pieceRateRecords') await fetchPieceRateRecords();
      else if (tab === 'outsourcing') await fetchOutsourcing();
    } finally {
      setActionLoading(null);
    }
  }, [fetchPlans, fetchWorkStations, fetchWorkHours, fetchPieceRateRules, fetchPieceRateRecords, fetchOutsourcing]);

  // ── 辅助 ──
  const formatNum = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const formatDate = (s?: string | null) => s || '—';
  const wsName = (id: string) => workStations.find(w => w.id === id)?.name || id;

  // ── 排产状态流转 ──
  const transitionPlan = useCallback(async (id: string, toStatus: ProductionPlanStatus) => {
    setActionLoading(`plan:${id}`);
    try {
      await apiService.transitionPlanStatus(id, toStatus);
      await fetchPlans();
    } catch (e: any) {
      setError(e?.message || '状态流转失败');
    } finally {
      setActionLoading(null);
    }
  }, [fetchPlans]);

  // ── 外协状态流转 ──
  const transitionOutsourcing = useCallback(async (id: string, toStatus: OutsourcingStatus) => {
    setActionLoading(`oso:${id}`);
    try {
      await apiService.transitionOutsourcingStatus(id, toStatus);
      await fetchOutsourcing();
    } catch (e: any) {
      setError(e?.message || '状态流转失败');
    } finally {
      setActionLoading(null);
    }
  }, [fetchOutsourcing]);

  // ── 计件状态流转 ──
  const transitionPieceRate = useCallback(async (id: string, toStatus: PieceRateStatus) => {
    setActionLoading(`prr:${id}`);
    try {
      await apiService.transitionPieceRateStatus(id, toStatus);
      await fetchPieceRateRecords();
    } catch (e: any) {
      setError(e?.message || '状态流转失败');
    } finally {
      setActionLoading(null);
    }
  }, [fetchPieceRateRecords]);

  // ════════════════════════════════════════
  // 创建表单状态（R678③：打开时重置为初始值，防上次取消残留带入下次）
  // ════════════════════════════════════════

  // 排产表单
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planForm, setPlanForm] = useState<ProductionPlanInput>(initialPlanForm);
  const openPlanForm = useCallback(() => { setPlanForm(initialPlanForm()); setShowPlanForm(true); }, []);

  // 工位表单
  const [showWsForm, setShowWsForm] = useState(false);
  const [wsForm, setWsForm] = useState<WorkStationInput>(initialWsForm);
  const openWsForm = useCallback(() => { setWsForm(initialWsForm()); setShowWsForm(true); }, []);

  // 工时表单
  const [showWhForm, setShowWhForm] = useState(false);
  const [whForm, setWhForm] = useState<WorkHourInput>(initialWhForm);
  const openWhForm = useCallback(() => { setWhForm(initialWhForm()); setShowWhForm(true); }, []);

  // 计件规则表单
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<PieceRateRuleInput>(initialRuleForm);
  const openRuleForm = useCallback(() => { setRuleForm(initialRuleForm()); setShowRuleForm(true); }, []);

  // 计件记录表单
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [recordForm, setRecordForm] = useState<PieceRateRecordInput>(initialRecordForm);
  const openRecordForm = useCallback(() => { setRecordForm(initialRecordForm()); setShowRecordForm(true); }, []);

  // 外协表单
  const [showOsoForm, setShowOsoForm] = useState(false);
  const [osoForm, setOsoForm] = useState<OutsourcingOrderInput>(initialOsoForm);
  const openOsoForm = useCallback(() => { setOsoForm(initialOsoForm()); setShowOsoForm(true); }, []);

  // ── 提交处理 ──
  const submitPlan = async () => {
    if (!planForm.planNumber || !planForm.workStationId || planForm.plannedQuantity <= 0) {
      setError('请填写排产单号、工位、计划数量'); return;
    }
    setActionLoading('submit:plan');
    try {
      await apiService.createProductionPlan(planForm);
      bdsToast.success(`排产单 ${planForm.planNumber} 已创建`);
      setShowPlanForm(false);
      setPlanForm(initialPlanForm());
      await fetchPlans();
    } catch (e: any) { setError(e?.message || '创建排产失败'); }
    finally { setActionLoading(null); }
  };

  const submitWs = async () => {
    if (!wsForm.code || !wsForm.name) { setError('请填写工位编码与名称'); return; }
    setActionLoading('submit:ws');
    try {
      await apiService.createWorkStation(wsForm);
      bdsToast.success(`工位 ${wsForm.name} 已创建`);
      setShowWsForm(false);
      setWsForm(initialWsForm());
      await fetchWorkStations();
    } catch (e: any) { setError(e?.message || '创建工位失败'); }
    finally { setActionLoading(null); }
  };

  const submitWh = async () => {
    if (!whForm.productionPlanId || whForm.hours <= 0) { setError('请选择排产单并填写工时'); return; }
    setActionLoading('submit:wh');
    try {
      await apiService.createWorkHour(whForm);
      bdsToast.success('工时记录已创建');
      setShowWhForm(false);
      setWhForm(initialWhForm());
      await fetchWorkHours();
    } catch (e: any) { setError(e?.message || '创建工时失败'); }
    finally { setActionLoading(null); }
  };

  const submitRule = async () => {
    if (!ruleForm.code || !ruleForm.name || ruleForm.ratePerUnit <= 0) { setError('请填写规则编码、名称、单价'); return; }
    setActionLoading('submit:rule');
    try {
      await apiService.createPieceRateRule(ruleForm);
      bdsToast.success(`计件规则 ${ruleForm.code} 已创建`);
      setShowRuleForm(false);
      setRuleForm(initialRuleForm());
      await fetchPieceRateRules();
    } catch (e: any) { setError(e?.message || '创建计件规则失败'); }
    finally { setActionLoading(null); }
  };

  const submitRecord = async () => {
    if (!recordForm.pieceRateRuleId || recordForm.quantity <= 0) { setError('请选择计件规则并填写数量'); return; }
    setActionLoading('submit:record');
    try {
      await apiService.createPieceRateRecord(recordForm);
      bdsToast.success('计件记录已创建');
      setShowRecordForm(false);
      setRecordForm(initialRecordForm());
      await fetchPieceRateRecords();
    } catch (e: any) { setError(e?.message || '创建计件记录失败'); }
    finally { setActionLoading(null); }
  };

  const submitOso = async () => {
    if (!osoForm.orderNumber || osoForm.quantity <= 0 || osoForm.unitPrice <= 0) { setError('请填写外协单号、数量、单价'); return; }
    setActionLoading('submit:oso');
    try {
      // supplierId 空串归一为 undefined（后端 ?? null 落库，防空串入档）
      await apiService.createOutsourcingOrder({ ...osoForm, supplierId: osoForm.supplierId || undefined });
      bdsToast.success(`外协订单 ${osoForm.orderNumber} 已创建`);
      setShowOsoForm(false);
      setOsoForm(initialOsoForm());
      await fetchOutsourcing();
    } catch (e: any) { setError(e?.message || '创建外协失败'); }
    finally { setActionLoading(null); }
  };

  // ── 通用删除（R5：全部先经 bdsConfirm danger 确认，防误删） ──
  const deletePlan = async (id: string) => {
    const plan = plans.find(p => p.id === id);
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除排产单「${plan?.planNumber || id}」？此操作不可恢复。`, danger: true }))) return;
    setActionLoading(`del:plan:${id}`);
    try { await apiService.deleteProductionPlan(id); bdsToast.success(`排产单 ${plan?.planNumber || id} 已删除`); await fetchPlans(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };
  const deleteWs = async (id: string) => {
    const ws = workStations.find(w => w.id === id);
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除工位「${ws?.name || ws?.code || id}」？此操作不可恢复。`, danger: true }))) return;
    setActionLoading(`del:ws:${id}`);
    try { await apiService.deleteWorkStation(id); bdsToast.success(`工位 ${ws?.name || ws?.code || id} 已删除`); await fetchWorkStations(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };
  const deleteRule = async (id: string) => {
    const rule = pieceRateRules.find(r => r.id === id);
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除计件规则「${rule ? `${rule.code} ${rule.name}` : id}」？此操作不可恢复。`, danger: true }))) return;
    setActionLoading(`del:rule:${id}`);
    try { await apiService.deletePieceRateRule(id); bdsToast.success(`计件规则 ${rule?.code || id} 已删除`); await fetchPieceRateRules(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };
  const deleteRecord = async (id: string) => {
    const rec = pieceRateRecords.find(r => r.id === id);
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除计件记录（${rec?.employeeName || rec?.employeeId || '未知员工'} · ${rec?.workDate || '—'}）？此操作不可恢复。`, danger: true }))) return;
    setActionLoading(`del:record:${id}`);
    try { await apiService.deletePieceRateRecord(id); bdsToast.success('计件记录已删除'); await fetchPieceRateRecords(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };
  const deleteOso = async (id: string) => {
    const oso = outsourcingOrders.find(o => o.id === id);
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除外协订单「${oso?.orderNumber || id}」？此操作不可恢复。`, danger: true }))) return;
    setActionLoading(`del:oso:${id}`);
    try { await apiService.deleteOutsourcingOrder(id); bdsToast.success(`外协订单 ${oso?.orderNumber || id} 已删除`); await fetchOutsourcing(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };

  // ── 跨模块导航筛选：外协订单按供应商 relation 过滤 ──
  const navFilteredOutsourcing = useMemo(
    () => navRelationFilter
      ? outsourcingOrders.filter(oso => oso.supplierId === navRelationFilter.relationId)
      : outsourcingOrders,
    [outsourcingOrders, navRelationFilter],
  );

  // ── R678④：各 Tab 搜索 + 状态筛选（客户端过滤已加载条目；footer 计数仍展示服务端真实 total） ──
  const searchLower = searchQuery.trim().toLowerCase();
  const filteredPlans = useMemo(() => plans.filter((p) => {
    if (planStatusFilter && p.status !== planStatusFilter) return false;
    if (!searchLower) return true;
    return [p.planNumber, p.orderId, p.assignedTo, p.workStation?.name]
      .some((v) => (v ?? '').toLowerCase().includes(searchLower));
  }), [plans, planStatusFilter, searchLower]);
  const filteredWorkStations = useMemo(() => workStations.filter((w) => {
    if (wsTypeFilter && w.type !== wsTypeFilter) return false;
    if (!searchLower) return true;
    return [w.code, w.name, w.manager, w.location]
      .some((v) => (v ?? '').toLowerCase().includes(searchLower));
  }), [workStations, wsTypeFilter, searchLower]);
  const visibleOutsourcing = useMemo(() => navFilteredOutsourcing.filter((o) => {
    if (osoStatusFilter && o.status !== osoStatusFilter) return false;
    if (!searchLower) return true;
    return [o.orderNumber, o.description, o.supplierId ? supplierNameById.get(o.supplierId) : null]
      .some((v) => (v ?? '').toLowerCase().includes(searchLower));
  }), [navFilteredOutsourcing, osoStatusFilter, searchLower, supplierNameById]);
  const filteredWorkHours = useMemo(() => workHours.filter((wh) => {
    if (!searchLower) return true;
    return [wh.employeeName, wh.employeeId, wh.productionPlanId, wh.workDate, wh.notes]
      .some((v) => (v ?? '').toLowerCase().includes(searchLower));
  }), [workHours, searchLower]);
  const filteredPieceRateRules = useMemo(() => pieceRateRules.filter((r) => {
    if (ruleActiveFilter === 'active' && !r.isActive) return false;
    if (ruleActiveFilter === 'inactive' && r.isActive) return false;
    if (!searchLower) return true;
    return [r.code, r.name]
      .some((v) => (v ?? '').toLowerCase().includes(searchLower));
  }), [pieceRateRules, ruleActiveFilter, searchLower]);
  const filteredPieceRateRecords = useMemo(() => pieceRateRecords.filter((r) => {
    if (recordStatusFilter && r.status !== recordStatusFilter) return false;
    if (!searchLower) return true;
    return [r.employeeName, r.employeeId, r.pieceRateRule?.name, r.pieceRateRule?.code, r.workDate]
      .some((v) => (v ?? '').toLowerCase().includes(searchLower));
  }), [pieceRateRecords, recordStatusFilter, searchLower]);

  /** 是否有客户端筛选生效（生效时 footer 显式提示「筛选仅作用于已加载条目」） */
  const filterActive = searchLower !== ''
    || (activeTab === 'plans' && planStatusFilter !== '')
    || (activeTab === 'workStations' && wsTypeFilter !== '')
    || (activeTab === 'outsourcing' && osoStatusFilter !== '')
    || (activeTab === 'pieceRateRules' && ruleActiveFilter !== '')
    || (activeTab === 'pieceRateRecords' && recordStatusFilter !== '');

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'plans', label: '排产', icon: <CalendarClock size={12} />, count: plansTotal },
    { id: 'workStations', label: '工位', icon: <Cog size={12} />, count: workStationsTotal },
    { id: 'outsourcing', label: '外协', icon: <Send size={12} />, count: navRelationFilter ? visibleOutsourcing.length : outsourcingTotal },
    { id: 'workHours', label: '工时', icon: <Clock size={12} />, count: workHoursTotal },
    { id: 'pieceRateRules', label: '计件规则', icon: <Award size={12} />, count: pieceRateRulesTotal },
    { id: 'pieceRateRecords', label: '计件记录', icon: <Award size={12} />, count: pieceRateRecordsTotal },
  ];

  /** R678④：Tab 工具栏搜索框（各 Tab 共用 searchQuery，切 Tab 清空） + 关键状态筛选插槽 */
  const renderTabToolbarExtras = (statusFilterSlot?: React.ReactNode) => (
    <>
      <div className="relative flex-1 max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索..." className="bds-input sm pl-9" />
      </div>
      {statusFilterSlot}
    </>
  );

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader
        title="生产执行 MES"
        subtitle="Manufacturing Execution System"
        contextLabel="MES Desk"
        isDarkMode={isDarkMode}
        actions={
          <>
            <button onClick={refreshAll} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新全部">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            {activeTab === 'plans' && canWrite && (
              <button onClick={openPlanForm} className="bds-btn bds-btn-primary">
                <Plus size={14} /><span>新增排产</span>
              </button>
            )}
            {/* B10 运营域报表：生产计划台账 Excel 导出（全量） */}
            {activeTab === 'plans' && (
              <button onClick={() => void handleExportPlansXlsx()} disabled={exportingXlsx} className="bds-btn bds-btn-secondary">
                {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                <span>导出台账</span>
              </button>
            )}
            {activeTab === 'workStations' && canWrite && (
              <button onClick={openWsForm} className="bds-btn bds-btn-primary">
                <Plus size={14} /><span>新增工位</span>
              </button>
            )}
            {activeTab === 'outsourcing' && canWrite && (
              <button onClick={openOsoForm} className="bds-btn bds-btn-primary">
                <Plus size={14} /><span>新增外协</span>
              </button>
            )}
            {activeTab === 'workHours' && canWrite && (
              <button onClick={openWhForm} className="bds-btn bds-btn-primary">
                <Plus size={14} /><span>记录工时</span>
              </button>
            )}
            {activeTab === 'pieceRateRules' && canWrite && (
              <button onClick={openRuleForm} className="bds-btn bds-btn-primary">
                <Plus size={14} /><span>新增规则</span>
              </button>
            )}
            {activeTab === 'pieceRateRecords' && canWrite && (
              <button onClick={openRecordForm} className="bds-btn bds-btn-primary">
                <Plus size={14} /><span>新增计件</span>
              </button>
            )}
          </>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* Tab 切换（BDS 分段控制器；切 Tab 清空搜索词防串扰） */}
          <div className="bds-segment mb-4 flex-wrap">
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setActiveTab(t.id); setSearchQuery(''); }} className={`seg ${activeTab === t.id ? 'active' : ''}`}>
                {t.icon}<span>{t.label}</span>
                {t.count != null && t.count > 0 && (
                  <span className="ml-1 text-[10px] opacity-60">{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {error && (
            <div className="bds-alert danger mb-3">
              <AlertCircle size={16} />
              <span className="flex-1 min-w-0">{error}</span>
              <button onClick={() => setError(null)} className="ml-auto" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
                <X size={14} />
              </button>
            </div>
          )}

          {/* ════════════ 排产 Tab ════════════ */}
          {activeTab === 'plans' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {canWrite && (
                  <button onClick={openPlanForm} className="bds-btn bds-btn-primary">
                    <Plus size={14} /><span>新增排产</span>
                  </button>
                )}
                <button onClick={() => refreshTab('plans')} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:plans' ? 'animate-spin' : ''} />
                </button>
                {renderTabToolbarExtras(
                  <CustomSelect
                    className="w-32"
                    size="compact"
                    value={planStatusFilter}
                    onChange={(v) => setPlanStatusFilter(v)}
                    options={[{ value: '', label: '全部状态' }, ...PLAN_STATUSES.map(s => ({ value: s.id, label: s.label }))]}
                  />,
                )}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                </div>
              ) : filteredPlans.length === 0 ? (
                <EmptyState icon={<CalendarClock size={24} />} text={filterActive ? '无符合筛选条件的排产单' : '暂无排产单'} />
              ) : (
                <>
                <div className="space-y-2">
                  {filteredPlans.slice(0, MES_LIST_RENDER_LIMIT).map((plan, i) => {
                    const semantic = statusSemanticOf(PLAN_STATUSES, plan.status);
                    const progress = Number(plan.plannedQuantity) > 0
                      ? Math.min(100, Math.round((Number(plan.actualQuantity) / Number(plan.plannedQuantity)) * 100))
                      : 0;
                    return (
                      <motion.div key={plan.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="flex items-center gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]" onClick={() => setExpandedId(expandedId === plan.id ? null : plan.id)}>
                          <button className="flex-shrink-0" style={{ color: 'var(--text-quaternary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                            {expandedId === plan.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>{plan.planNumber}</span>
                              <StatusBadge semantic={semantic} label={statusLabel(PLAN_STATUSES, plan.status)} />
                              <span className="bds-badge sm neutral">
                                {statusLabel(PRIORITIES, plan.priority)}优先级
                              </span>
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              {plan.workStation?.name || wsName(plan.workStationId)} · {statusLabel(WS_TYPES, plan.processType)}
                              {plan.orderId ? ` · 订单 ${plan.orderId.slice(-8)}` : ''}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                              {formatNum(Number(plan.actualQuantity))} / {formatNum(Number(plan.plannedQuantity))} <span className="text-xs opacity-60">{plan.unit}</span>
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>{formatDate(plan.plannedStartDate)} → {formatDate(plan.plannedEndDate)}</div>
                          </div>
                        </div>

                        {/* 进度条 */}
                        <div className="px-4 pb-2">
                          <div className="bds-progress">
                            <div className="fill" style={{ width: `${progress}%` }} />
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedId === plan.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="p-4" style={{ borderTop: 'var(--border-subtle)' }}>
                                {canWrite && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  {plan.status === 'Draft' && (
                                    <>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Confirmed')} loading={actionLoading === `plan:${plan.id}`} icon={<CheckCircle2 size={12} />}>确认排产</ActionButton>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Cancelled')} loading={actionLoading === `plan:${plan.id}`} icon={<X size={12} />} danger>取消</ActionButton>
                                      <ActionButton onClick={() => deletePlan(plan.id)} loading={actionLoading === `del:plan:${plan.id}`} icon={<Trash2 size={12} />} danger>删除</ActionButton>
                                    </>
                                  )}
                                  {plan.status === 'Confirmed' && (
                                    <>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'InProgress')} loading={actionLoading === `plan:${plan.id}`} icon={<PlayCircle size={12} />}>开始生产</ActionButton>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Cancelled')} loading={actionLoading === `plan:${plan.id}`} icon={<X size={12} />} danger>取消</ActionButton>
                                    </>
                                  )}
                                  {plan.status === 'InProgress' && (
                                    <>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Completed')} loading={actionLoading === `plan:${plan.id}`} icon={<StopCircle size={12} />}>完成</ActionButton>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Cancelled')} loading={actionLoading === `plan:${plan.id}`} icon={<X size={12} />} danger>取消</ActionButton>
                                    </>
                                  )}
                                </div>
                                )}
                                {plan.notes && <div className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>{plan.notes}</div>}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
                <TruncationHint loaded={filteredPlans.length} />
                <ListPager loaded={plans.length} total={plansTotal} loading={loadingMoreTab === 'plans'} filterActive={filterActive} onMore={() => fetchPlans(plans.length)} />
                </>
              )}

              {showPlanForm && (
                <CreateFormModal title="新增排产单" onClose={() => setShowPlanForm(false)} onSubmit={submitPlan} loading={actionLoading === 'submit:plan'}>
                  <FormField label="排产单号">
                    <input className="bds-input sm" value={planForm.planNumber} onChange={e => setPlanForm({ ...planForm, planNumber: e.target.value })} placeholder="PP-2026-001" />
                  </FormField>
                  <FormField label="工位">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={planForm.workStationId}
                      onChange={v => setPlanForm({ ...planForm, workStationId: v })}
                      options={[{ value: '', label: '选择工位' }, ...workStations.map(w => ({ value: w.id, label: `${w.name} (${w.code})` }))]}
                    />
                  </FormField>
                  <FormField label="工序类型">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={planForm.processType}
                      onChange={v => setPlanForm({ ...planForm, processType: v as WorkStationType })}
                      options={WS_TYPES.map(t => ({ value: t.id, label: t.label }))}
                    />
                  </FormField>
                  <FormField label="计划数量">
                    <input type="number" className="bds-input sm" value={planForm.plannedQuantity} onChange={e => setPlanForm({ ...planForm, plannedQuantity: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="单位">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={planForm.unit}
                      onChange={v => setPlanForm({ ...planForm, unit: v })}
                      options={UNITS.map(u => ({ value: u, label: u }))}
                    />
                  </FormField>
                  <FormField label="计划开始">
                    <CapsuleDateInput className="bds-input sm" value={planForm.plannedStartDate ?? ''} onChange={(v) => setPlanForm({ ...planForm, plannedStartDate: v })} isDarkMode={isDarkMode} />
                  </FormField>
                  <FormField label="计划结束">
                    <CapsuleDateInput className="bds-input sm" value={planForm.plannedEndDate ?? ''} onChange={(v) => setPlanForm({ ...planForm, plannedEndDate: v })} isDarkMode={isDarkMode} />
                  </FormField>
                  <FormField label="优先级">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={planForm.priority ?? ''}
                      onChange={v => setPlanForm({ ...planForm, priority: v as Priority })}
                      options={PRIORITIES.map(p => ({ value: p.id, label: p.label }))}
                    />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 工位 Tab ════════════ */}
          {activeTab === 'workStations' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {canWrite && (
                  <button onClick={openWsForm} className="bds-btn bds-btn-primary">
                    <Plus size={14} /><span>新增工位</span>
                  </button>
                )}
                <button onClick={() => refreshTab('workStations')} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:workStations' ? 'animate-spin' : ''} />
                </button>
                {renderTabToolbarExtras(
                  <CustomSelect
                    className="w-32"
                    size="compact"
                    value={wsTypeFilter}
                    onChange={(v) => setWsTypeFilter(v)}
                    options={[{ value: '', label: '全部类型' }, ...WS_TYPES.map(t => ({ value: t.id, label: t.label }))]}
                  />,
                )}
              </div>

              {filteredWorkStations.length === 0 ? (
                <EmptyState icon={<Cog size={24} />} text={filterActive ? '无符合筛选条件的工位' : '暂无工位'} />
              ) : (
                <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredWorkStations.slice(0, MES_LIST_RENDER_LIMIT).map((ws, i) => (
                    <motion.div key={ws.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className="bds-card">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Factory size={14} style={{ color: 'var(--text-tertiary)' }} />
                            <span className="bds-mono text-sm truncate" style={{ color: 'var(--text-primary)' }}>{ws.code}</span>
                          </div>
                          <div className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{ws.name}</div>
                          <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                            {statusLabel(WS_TYPES, ws.type)} · {ws.isActive ? '启用' : '停用'}
                          </div>
                        </div>
                        {canWrite && (
                          <button onClick={() => deleteWs(ws.id)} disabled={actionLoading === `del:ws:${ws.id}`} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      {ws.capacityPerDay != null && (
                        <div className="text-[10px] mt-2" style={{ color: 'var(--text-quaternary)' }}>
                          日产能 {formatNum(Number(ws.capacityPerDay))} {ws.capacityUnit || ''}
                          {ws.location ? ` · ${ws.location}` : ''}
                          {ws.manager ? ` · ${ws.manager}` : ''}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
                <TruncationHint loaded={filteredWorkStations.length} />
                <ListPager loaded={workStations.length} total={workStationsTotal} loading={loadingMoreTab === 'workStations'} filterActive={filterActive} onMore={() => fetchWorkStations(workStations.length)} />
                </>
              )}

              {showWsForm && (
                <CreateFormModal title="新增工位" onClose={() => setShowWsForm(false)} onSubmit={submitWs} loading={actionLoading === 'submit:ws'}>
                  <FormField label="工位编码">
                    <input className="bds-input sm" value={wsForm.code} onChange={e => setWsForm({ ...wsForm, code: e.target.value })} placeholder="WS-001" />
                  </FormField>
                  <FormField label="工位名称">
                    <input className="bds-input sm" value={wsForm.name} onChange={e => setWsForm({ ...wsForm, name: e.target.value })} placeholder="缝纫一号线" />
                  </FormField>
                  <FormField label="类型">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={wsForm.type}
                      onChange={v => setWsForm({ ...wsForm, type: v as WorkStationType })}
                      options={WS_TYPES.map(t => ({ value: t.id, label: t.label }))}
                    />
                  </FormField>
                  <FormField label="日产能">
                    <input type="number" className="bds-input sm" value={wsForm.capacityPerDay ?? ''} onChange={e => setWsForm({ ...wsForm, capacityPerDay: e.target.value ? Number(e.target.value) : undefined })} />
                  </FormField>
                  <FormField label="位置">
                    <input className="bds-input sm" value={wsForm.location} onChange={e => setWsForm({ ...wsForm, location: e.target.value })} />
                  </FormField>
                  <FormField label="负责人">
                    <input className="bds-input sm" value={wsForm.manager} onChange={e => setWsForm({ ...wsForm, manager: e.target.value })} />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 外协 Tab ════════════ */}
          {activeTab === 'outsourcing' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {canWrite && (
                  <button onClick={openOsoForm} className="bds-btn bds-btn-primary">
                    <Plus size={14} /><span>新增外协</span>
                  </button>
                )}
                <button onClick={() => refreshTab('outsourcing')} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:outsourcing' ? 'animate-spin' : ''} />
                </button>
                {renderTabToolbarExtras(
                  <CustomSelect
                    className="w-32"
                    size="compact"
                    value={osoStatusFilter}
                    onChange={(v) => setOsoStatusFilter(v)}
                    options={[{ value: '', label: '全部状态' }, ...OUTSOURCING_STATUSES.map(s => ({ value: s.id, label: s.label }))]}
                  />,
                )}
                {navRelationFilter && (
                  <NavRelationFilterChip filter={navRelationFilter} label="外协订单" onClear={() => setNavRelationFilter(null)} />
                )}
              </div>

              {visibleOutsourcing.length === 0 ? (
                <EmptyState icon={<Send size={24} />} text={navRelationFilter ? '该供应商暂无外协订单' : filterActive ? '无符合筛选条件的外协订单' : '暂无外协订单'} />
              ) : (
                <>
                <div className="space-y-2">
                  {visibleOutsourcing.slice(0, MES_LIST_RENDER_LIMIT).map((oso, i) => {
                    const semantic = statusSemanticOf(OUTSOURCING_STATUSES, oso.status);
                    return (
                      <motion.div key={oso.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="flex items-center gap-3 p-4 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]" onClick={() => setExpandedId(expandedId === oso.id ? null : oso.id)}>
                          <button className="flex-shrink-0" style={{ color: 'var(--text-quaternary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                            {expandedId === oso.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>{oso.orderNumber}</span>
                              <StatusBadge semantic={semantic} label={statusLabel(OUTSOURCING_STATUSES, oso.status)} />
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              {statusLabel(OUTSOURCING_PROCESS_TYPES, oso.processType)}
                              {oso.supplierId ? ` · ${supplierNameById.get(oso.supplierId) ?? oso.supplierId}` : ''}
                              {oso.description ? ` · ${oso.description}` : ''}
                              {oso.plannedDeliveryDate ? ` · 交期 ${oso.plannedDeliveryDate}` : ''}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                              {formatNum(Number(oso.totalAmount))} <span className="text-xs opacity-60">{oso.currency}</span>
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>{formatNum(Number(oso.quantity))} {oso.unit} × {formatNum(Number(oso.unitPrice))}</div>
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedId === oso.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="p-4" style={{ borderTop: 'var(--border-subtle)' }}>
                                {canWrite && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  {oso.status === 'Draft' && (
                                    <>
                                      <ActionButton onClick={() => transitionOutsourcing(oso.id, 'Sent')} loading={actionLoading === `oso:${oso.id}`} icon={<Send size={12} />}>发送</ActionButton>
                                      <ActionButton onClick={() => transitionOutsourcing(oso.id, 'Cancelled')} loading={actionLoading === `oso:${oso.id}`} icon={<X size={12} />} danger>取消</ActionButton>
                                      <ActionButton onClick={() => deleteOso(oso.id)} loading={actionLoading === `del:oso:${oso.id}`} icon={<Trash2 size={12} />} danger>删除</ActionButton>
                                    </>
                                  )}
                                  {oso.status === 'Sent' && (
                                    <ActionButton onClick={() => transitionOutsourcing(oso.id, 'Confirmed')} loading={actionLoading === `oso:${oso.id}`} icon={<CheckCircle2 size={12} />}>确认</ActionButton>
                                  )}
                                  {oso.status === 'Confirmed' && (
                                    <ActionButton onClick={() => transitionOutsourcing(oso.id, 'InProduction')} loading={actionLoading === `oso:${oso.id}`} icon={<PlayCircle size={12} />}>投入生产</ActionButton>
                                  )}
                                  {oso.status === 'InProduction' && (
                                    <ActionButton onClick={() => transitionOutsourcing(oso.id, 'Received')} loading={actionLoading === `oso:${oso.id}`} icon={<PackageCheck size={12} />}>到货验收</ActionButton>
                                  )}
                                </div>
                                )}
                                {oso.lines && oso.lines.length > 0 && (
                                  <div className="mt-3 space-y-1">
                                    <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>行明细</div>
                                    {oso.lines.map(line => (
                                      <div key={line.id} className="flex justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        <span>{statusLabel(OUTSOURCING_PROCESS_TYPES, line.processType)} · {line.description}</span>
                                        <span className="bds-tnum">{formatNum(Number(line.quantity))} {line.unit} × {formatNum(Number(line.unitPrice))} = {formatNum(Number(line.amount))}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
                <TruncationHint loaded={visibleOutsourcing.length} />
                <ListPager loaded={outsourcingOrders.length} total={outsourcingTotal} loading={loadingMoreTab === 'outsourcing'} filterActive={filterActive} onMore={() => fetchOutsourcing(outsourcingOrders.length)} />
                </>
              )}

              {showOsoForm && (
                <CreateFormModal title="新增外协订单" onClose={() => setShowOsoForm(false)} onSubmit={submitOso} loading={actionLoading === 'submit:oso'}>
                  <FormField label="外协单号">
                    <input className="bds-input sm" value={osoForm.orderNumber} onChange={e => setOsoForm({ ...osoForm, orderNumber: e.target.value })} placeholder="OSO-2026-001" />
                  </FormField>
                  {/* R678⑤：供应商下拉（Relation 档案供应商口径，与采购域一致；落 supplierId 入图可追溯） */}
                  <FormField label="供应商">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={osoForm.supplierId ?? ''}
                      onChange={v => setOsoForm({ ...osoForm, supplierId: v || undefined })}
                      options={[{ value: '', label: '不指定供应商' }, ...supplierOptions.map(s => ({ value: s.id, label: s.label }))]}
                    />
                  </FormField>
                  <FormField label="工序类型">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={osoForm.processType}
                      onChange={v => setOsoForm({ ...osoForm, processType: v as OutsourcingProcessType })}
                      options={OUTSOURCING_PROCESS_TYPES.map(t => ({ value: t.id, label: t.label }))}
                    />
                  </FormField>
                  <FormField label="数量">
                    <input type="number" className="bds-input sm" value={osoForm.quantity} onChange={e => setOsoForm({ ...osoForm, quantity: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="单位">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={osoForm.unit}
                      onChange={v => setOsoForm({ ...osoForm, unit: v })}
                      options={UNITS.map(u => ({ value: u, label: u }))}
                    />
                  </FormField>
                  <FormField label="单价">
                    <input type="number" className="bds-input sm" value={osoForm.unitPrice} onChange={e => setOsoForm({ ...osoForm, unitPrice: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="币种">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={osoForm.currency ?? ''}
                      onChange={v => setOsoForm({ ...osoForm, currency: v })}
                      options={[{ value: 'CNY', label: 'CNY 人民币' }, { value: 'USD', label: 'USD 美元' }]}
                    />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 工时 Tab ════════════ */}
          {activeTab === 'workHours' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {canWrite && (
                  <button onClick={openWhForm} className="bds-btn bds-btn-primary">
                    <Plus size={14} /><span>记录工时</span>
                  </button>
                )}
                <button onClick={() => refreshTab('workHours')} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:workHours' ? 'animate-spin' : ''} />
                </button>
                {renderTabToolbarExtras()}
              </div>

              {filteredWorkHours.length === 0 ? (
                <EmptyState icon={<Clock size={24} />} text={filterActive ? '无符合筛选条件的工时记录' : '暂无工时记录'} />
              ) : (
                <>
                <div className="space-y-2">
                  {filteredWorkHours.slice(0, MES_LIST_RENDER_LIMIT).map((wh, i) => (
                    <motion.div key={wh.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }} className="bds-card flex items-center gap-3" style={{ padding: 'var(--space-3)' }}>
                      <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                          {wh.employeeName || wh.employeeId || '未知员工'}
                          {wh.productionPlanId && <span className="text-xs ml-2" style={{ color: 'var(--text-tertiary)' }}>排产 {wh.productionPlanId.slice(-8)}</span>}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{wh.workDate}{wh.notes ? ` · ${wh.notes}` : ''}</div>
                      </div>
                      <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                        {formatNum(Number(wh.hours))}h
                        {Number(wh.overtimeHours) > 0 && <span className="text-xs ml-1" style={{ color: 'var(--warning-text)' }}>+{formatNum(Number(wh.overtimeHours))}加班</span>}
                      </div>
                    </motion.div>
                  ))}
                </div>
                <TruncationHint loaded={filteredWorkHours.length} />
                <ListPager loaded={workHours.length} total={workHoursTotal} loading={loadingMoreTab === 'workHours'} filterActive={filterActive} onMore={() => fetchWorkHours(workHours.length)} />
                </>
              )}

              {showWhForm && (
                <CreateFormModal title="记录工时" onClose={() => setShowWhForm(false)} onSubmit={submitWh} loading={actionLoading === 'submit:wh'}>
                  <FormField label="排产单">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={whForm.productionPlanId}
                      onChange={v => setWhForm({ ...whForm, productionPlanId: v })}
                      options={[{ value: '', label: '选择排产单' }, ...plans.map(p => ({ value: p.id, label: p.planNumber }))]}
                    />
                  </FormField>
                  <FormField label="员工姓名">
                    <input className="bds-input sm" value={whForm.employeeName ?? ''} onChange={e => setWhForm({ ...whForm, employeeName: e.target.value })} />
                  </FormField>
                  <FormField label="日期">
                    <CapsuleDateInput className="bds-input sm" value={whForm.workDate ?? ''} onChange={(v) => setWhForm({ ...whForm, workDate: v })} isDarkMode={isDarkMode} />
                  </FormField>
                  <FormField label="工时">
                    <input type="number" className="bds-input sm" value={whForm.hours} onChange={e => setWhForm({ ...whForm, hours: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="加班工时">
                    <input type="number" className="bds-input sm" value={whForm.overtimeHours ?? 0} onChange={e => setWhForm({ ...whForm, overtimeHours: Number(e.target.value) })} />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 计件规则 Tab ════════════ */}
          {activeTab === 'pieceRateRules' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {canWrite && (
                  <button onClick={openRuleForm} className="bds-btn bds-btn-primary">
                    <Plus size={14} /><span>新增规则</span>
                  </button>
                )}
                <button onClick={() => refreshTab('pieceRateRules')} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:pieceRateRules' ? 'animate-spin' : ''} />
                </button>
                {renderTabToolbarExtras(
                  <CustomSelect
                    className="w-32"
                    size="compact"
                    value={ruleActiveFilter}
                    onChange={(v) => setRuleActiveFilter(v as '' | 'active' | 'inactive')}
                    options={[{ value: '', label: '全部状态' }, { value: 'active', label: '生效中' }, { value: 'inactive', label: '已停用' }]}
                  />,
                )}
              </div>

              {filteredPieceRateRules.length === 0 ? (
                <EmptyState icon={<Award size={24} />} text={filterActive ? '无符合筛选条件的计件规则' : '暂无计件规则'} />
              ) : (
                <>
                <div className="space-y-2">
                  {filteredPieceRateRules.slice(0, MES_LIST_RENDER_LIMIT).map((rule, i) => (
                    <motion.div key={rule.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }} className="bds-card flex items-center gap-3" style={{ padding: 'var(--space-3)' }}>
                      <Award size={14} style={{ color: 'var(--text-tertiary)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="bds-mono text-sm" style={{ color: 'var(--text-primary)' }}>{rule.code}</span>
                          <span className={`bds-badge sm ${rule.isActive ? 'success' : 'neutral'}`}>
                            {rule.isActive ? '生效' : '停用'}
                          </span>
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          {rule.name} · {statusLabel(WS_TYPES, rule.processType)} · 生效 {rule.effectiveFrom}{rule.effectiveTo ? ` 至 ${rule.effectiveTo}` : ' 长期'}
                        </div>
                      </div>
                      <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                        {formatNum(Number(rule.ratePerUnit))} <span className="text-xs opacity-60">CNY/{rule.unit}</span>
                      </div>
                      {canWrite && (
                        <button onClick={() => deleteRule(rule.id)} disabled={actionLoading === `del:rule:${rule.id}`} className="bds-btn bds-btn-ghost bds-btn-icon" title="删除">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </motion.div>
                  ))}
                </div>
                <TruncationHint loaded={filteredPieceRateRules.length} />
                <ListPager loaded={pieceRateRules.length} total={pieceRateRulesTotal} loading={loadingMoreTab === 'pieceRateRules'} filterActive={filterActive} onMore={() => fetchPieceRateRules(pieceRateRules.length)} />
                </>
              )}

              {showRuleForm && (
                <CreateFormModal title="新增计件规则" onClose={() => setShowRuleForm(false)} onSubmit={submitRule} loading={actionLoading === 'submit:rule'}>
                  <FormField label="规则编码">
                    <input className="bds-input sm" value={ruleForm.code} onChange={e => setRuleForm({ ...ruleForm, code: e.target.value })} placeholder="PR-SEW-001" />
                  </FormField>
                  <FormField label="规则名称">
                    <input className="bds-input sm" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="缝纫计件标准" />
                  </FormField>
                  <FormField label="工序类型">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={ruleForm.processType}
                      onChange={v => setRuleForm({ ...ruleForm, processType: v as WorkStationType })}
                      options={WS_TYPES.map(t => ({ value: t.id, label: t.label }))}
                    />
                  </FormField>
                  <FormField label="单位">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={ruleForm.unit}
                      onChange={v => setRuleForm({ ...ruleForm, unit: v })}
                      options={UNITS.map(u => ({ value: u, label: u }))}
                    />
                  </FormField>
                  <FormField label="单价">
                    <input type="number" className="bds-input sm" value={ruleForm.ratePerUnit} onChange={e => setRuleForm({ ...ruleForm, ratePerUnit: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="生效日期">
                    <CapsuleDateInput className="bds-input sm" value={ruleForm.effectiveFrom ?? ''} onChange={(v) => setRuleForm({ ...ruleForm, effectiveFrom: v })} isDarkMode={isDarkMode} />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 计件记录 Tab ════════════ */}
          {activeTab === 'pieceRateRecords' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <button onClick={() => refreshTab('pieceRateRecords')} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:pieceRateRecords' ? 'animate-spin' : ''} />
                </button>
                {renderTabToolbarExtras(
                  <CustomSelect
                    className="w-32"
                    size="compact"
                    value={recordStatusFilter}
                    onChange={(v) => setRecordStatusFilter(v)}
                    options={[{ value: '', label: '全部状态' }, ...PIECE_RATE_STATUSES.map(s => ({ value: s.id, label: s.label }))]}
                  />,
                )}
              </div>

              {filteredPieceRateRecords.length === 0 ? (
                <EmptyState icon={<Award size={24} />} text={filterActive ? '无符合筛选条件的计件记录' : '暂无计件记录'} />
              ) : (
                <>
                <div className="space-y-2">
                  {filteredPieceRateRecords.slice(0, MES_LIST_RENDER_LIMIT).map((rec, i) => {
                    const semantic = statusSemanticOf(PIECE_RATE_STATUSES, rec.status);
                    return (
                      <motion.div key={rec.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }} className="bds-card flex items-center gap-3" style={{ padding: 'var(--space-3)' }}>
                        <Award size={14} style={{ color: 'var(--text-tertiary)' }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{rec.employeeName || rec.employeeId || '未知员工'}</span>
                            <StatusBadge semantic={semantic} label={statusLabel(PIECE_RATE_STATUSES, rec.status)} />
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                            {rec.pieceRateRule?.name || rec.pieceRateRuleId}{rec.workDate ? ` · ${rec.workDate}` : ''}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="bds-tnum text-sm" style={{ color: 'var(--text-primary)' }}>
                            {formatNum(Number(rec.amount))} <span className="text-xs opacity-60">{rec.currency}</span>
                          </div>
                          <div className="text-[10px]" style={{ color: 'var(--text-quaternary)' }}>{formatNum(Number(rec.quantity))} {rec.unit} × {formatNum(Number(rec.ratePerUnit))}</div>
                        </div>
                        <div className="flex flex-col gap-1">
                          {canWrite && rec.status === 'Pending' && (
                            <>
                              <ActionButton onClick={() => transitionPieceRate(rec.id, 'Confirmed')} loading={actionLoading === `prr:${rec.id}`} icon={<CheckCircle2 size={11} />}>确认</ActionButton>
                              <ActionButton onClick={() => deleteRecord(rec.id)} loading={actionLoading === `del:record:${rec.id}`} icon={<Trash2 size={11} />} danger>删</ActionButton>
                            </>
                          )}
                          {canWrite && rec.status === 'Confirmed' && (
                            <ActionButton onClick={() => transitionPieceRate(rec.id, 'Paid')} loading={actionLoading === `prr:${rec.id}`} icon={<CheckCircle2 size={11} />}>支付</ActionButton>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
                <TruncationHint loaded={filteredPieceRateRecords.length} />
                <ListPager loaded={pieceRateRecords.length} total={pieceRateRecordsTotal} loading={loadingMoreTab === 'pieceRateRecords'} filterActive={filterActive} onMore={() => fetchPieceRateRecords(pieceRateRecords.length)} />
                </>
              )}

              {showRecordForm && (
                <CreateFormModal title="新增计件记录" onClose={() => setShowRecordForm(false)} onSubmit={submitRecord} loading={actionLoading === 'submit:record'}>
                  <FormField label="计件规则">
                    <CustomSelect
                      surface="form"
                      size="compact"
                      value={recordForm.pieceRateRuleId}
                      onChange={v => setRecordForm({ ...recordForm, pieceRateRuleId: v, unit: pieceRateRules.find(r => r.id === v)?.unit || 'PC' })}
                      options={[{ value: '', label: '选择规则' }, ...pieceRateRules.filter(r => r.isActive).map(r => ({ value: r.id, label: `${r.code} · ${r.name} (${formatNum(Number(r.ratePerUnit))}/${r.unit})` }))]}
                    />
                  </FormField>
                  <FormField label="员工姓名">
                    <input className="bds-input sm" value={recordForm.employeeName ?? ''} onChange={e => setRecordForm({ ...recordForm, employeeName: e.target.value })} />
                  </FormField>
                  <FormField label="日期">
                    <CapsuleDateInput className="bds-input sm" value={recordForm.workDate ?? ''} onChange={(v) => setRecordForm({ ...recordForm, workDate: v })} isDarkMode={isDarkMode} />
                  </FormField>
                  <FormField label="数量">
                    <input type="number" className="bds-input sm" value={recordForm.quantity} onChange={e => setRecordForm({ ...recordForm, quantity: Number(e.target.value) })} />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== 子组件（BDS v2.1：主题透明，无 isDarkMode 入参） ====================

const StatusBadge: React.FC<{ semantic: StatusSemantic; label: string }> = ({ semantic, label }) => (
  <span className={`bds-badge sm ${semantic}`}>{label}</span>
);

const EmptyState: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="bds-empty">
    <div className="glyph">{icon}</div>
    <div className="title">{text}</div>
  </div>
);

// R678：渲染上限兜底提示（服务端分页为主；已加载条目超出渲染上限时显式披露）
const TruncationHint: React.FC<{ loaded: number }> = ({ loaded }) =>
  loaded > MES_LIST_RENDER_LIMIT ? (
    <div className="text-center text-[11px] py-2" style={{ color: 'var(--text-tertiary)' }}>
      已加载 {loaded} 条，仅渲染前 {MES_LIST_RENDER_LIMIT} 条（可用搜索缩小范围）
    </div>
  ) : null;

// R678：服务端真分页 footer（total 为后端 count 真实计数；加载更多按 offset 追加）
const ListPager: React.FC<{ loaded: number; total: number; loading: boolean; filterActive: boolean; onMore: () => void }> = ({ loaded, total, loading, filterActive, onMore }) => (
  <div className="flex items-center justify-center gap-3 pt-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
    <span>已加载 {loaded} / 共 {total} 条{filterActive ? '（搜索/筛选仅作用于已加载条目）' : ''}</span>
    {loaded < total && (
      <button onClick={onMore} disabled={loading} className="bds-btn bds-btn-ghost">
        {loading ? <Loader2 size={14} className="animate-spin" /> : null}
        <span>{loading ? '加载中...' : '加载更多'}</span>
      </button>
    )}
  </div>
);

const ActionButton: React.FC<{
  onClick: () => void;
  loading?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
}> = ({ onClick, loading, icon, children, danger }) => (
  <button
    onClick={onClick}
    disabled={loading}
    className={`bds-btn ${danger ? 'bds-btn-danger' : 'bds-btn-ghost'}`}
  >
    {loading ? <Loader2 size={12} className="animate-spin" /> : icon}
    {children}
  </button>
);

const FormField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
    {children}
  </div>
);

const CreateFormModal: React.FC<{
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  loading?: boolean;
  children: React.ReactNode;
}> = ({ title, onClose, onSubmit, loading, children }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="bds-modal-mask"
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.95, opacity: 0 }}
      onClick={e => e.stopPropagation()}
      className="bds-modal custom-scrollbar"
      style={{ width: '32rem', maxHeight: '85vh', overflowY: 'auto' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="bds-text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <button onClick={onClose} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}>
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {children}
      </div>
      <div className="flex items-center justify-end gap-2 mt-5 pt-4" style={{ borderTop: 'var(--border-subtle)' }}>
        <button onClick={onClose} className="bds-btn bds-btn-secondary">取消</button>
        <button onClick={onSubmit} disabled={loading} className="bds-btn bds-btn-primary">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          <span>创建</span>
        </button>
      </div>
    </motion.div>
  </motion.div>
);

export default MesManager;
