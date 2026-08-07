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
 * 设计：flat 风格（无阴影 / 无 rim / 大圆角 / 半透明膜色），遵循 BAMBOOK_OS 设计令牌
 */

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { apiService } from '../services/apiService';
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
import { statusSemanticClass, statusSemanticText, StatusSemantic } from './rdlBusinessStatusTokens';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import ScrollEdgeFades from './ui/ScrollEdgeFades';

// ==================== 常量 ====================

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

  // ── 各 Tab 数据 ──
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [workStations, setWorkStations] = useState<WorkStation[]>([]);
  const [workHours, setWorkHours] = useState<WorkHour[]>([]);
  const [pieceRateRules, setPieceRateRules] = useState<PieceRateRule[]>([]);
  const [pieceRateRecords, setPieceRateRecords] = useState<PieceRateRecord[]>([]);
  const [outsourcingOrders, setOutsourcingOrders] = useState<OutsourcingOrder[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── 通用样式 ──
  const cardClass = isDarkMode
    ? `rounded-card border border-white/[0.055] bg-white/[0.018] ${BAMBOOK_OS.material.glassColor}`
    : `rounded-card border border-white/45 bg-white/24 ${BAMBOOK_OS.material.glassColor}`;
  const fieldClass = `w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] ${
    isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const tabBtnCls = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-xs font-light transition-colors inline-flex items-center gap-1 ${active ? 'bg-[var(--os-vnext-brand-blue)] text-white' : isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`;
  const primaryBtnCls = 'h-9 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1.5 transition-colors disabled:opacity-50';
  const ghostBtnCls = `p-2 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`;

  // ── 拉取数据 ──
  const fetchPlans = useCallback(async () => {
    try {
      const data = await apiService.listProductionPlans();
      setPlans(data);
    } catch (e: any) { setError(e?.message || '加载排产失败'); }
  }, []);

  const fetchWorkStations = useCallback(async () => {
    try {
      const data = await apiService.listWorkStations();
      setWorkStations(data);
    } catch (e: any) { setError(e?.message || '加载工位失败'); }
  }, []);

  const fetchWorkHours = useCallback(async () => {
    try {
      const data = await apiService.listWorkHours();
      setWorkHours(data);
    } catch (e: any) { setError(e?.message || '加载工时失败'); }
  }, []);

  const fetchPieceRateRules = useCallback(async () => {
    try {
      const data = await apiService.listPieceRateRules();
      setPieceRateRules(data);
    } catch (e: any) { setError(e?.message || '加载计件规则失败'); }
  }, []);

  const fetchPieceRateRecords = useCallback(async () => {
    try {
      const data = await apiService.listPieceRateRecords();
      setPieceRateRecords(data);
    } catch (e: any) { setError(e?.message || '加载计件记录失败'); }
  }, []);

  const fetchOutsourcing = useCallback(async () => {
    try {
      const data = await apiService.listOutsourcingOrders();
      setOutsourcingOrders(data);
    } catch (e: any) { setError(e?.message || '加载外协订单失败'); }
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
  // 创建表单状态
  // ════════════════════════════════════════

  // 排产表单
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planForm, setPlanForm] = useState<ProductionPlanInput>({
    planNumber: '', workStationId: '', processType: 'Sewing', plannedQuantity: 0, unit: 'PC',
    plannedStartDate: todayStr(), plannedEndDate: todayStr(), priority: 'Normal',
  });

  // 工位表单
  const [showWsForm, setShowWsForm] = useState(false);
  const [wsForm, setWsForm] = useState<WorkStationInput>({
    code: '', name: '', type: 'Sewing', capacityPerDay: undefined, capacityUnit: 'PC', location: '', manager: '',
  });

  // 工时表单
  const [showWhForm, setShowWhForm] = useState(false);
  const [whForm, setWhForm] = useState<WorkHourInput>({
    productionPlanId: '', workDate: todayStr(), hours: 0, overtimeHours: 0,
  });

  // 计件规则表单
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<PieceRateRuleInput>({
    code: '', name: '', processType: 'Sewing', unit: 'PC', ratePerUnit: 0, effectiveFrom: todayStr(),
  });

  // 计件记录表单
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [recordForm, setRecordForm] = useState<PieceRateRecordInput>({
    pieceRateRuleId: '', workDate: todayStr(), quantity: 0, unit: 'PC',
  });

  // 外协表单
  const [showOsoForm, setShowOsoForm] = useState(false);
  const [osoForm, setOsoForm] = useState<OutsourcingOrderInput>({
    orderNumber: '', processType: 'Sewing', quantity: 0, unit: 'PC', unitPrice: 0, currency: 'CNY',
  });

  // ── 提交处理 ──
  const submitPlan = async () => {
    if (!planForm.planNumber || !planForm.workStationId || planForm.plannedQuantity <= 0) {
      setError('请填写排产单号、工位、计划数量'); return;
    }
    setActionLoading('submit:plan');
    try {
      await apiService.createProductionPlan(planForm);
      setShowPlanForm(false);
      setPlanForm({ planNumber: '', workStationId: '', processType: 'Sewing', plannedQuantity: 0, unit: 'PC', plannedStartDate: todayStr(), plannedEndDate: todayStr(), priority: 'Normal' });
      await fetchPlans();
    } catch (e: any) { setError(e?.message || '创建排产失败'); }
    finally { setActionLoading(null); }
  };

  const submitWs = async () => {
    if (!wsForm.code || !wsForm.name) { setError('请填写工位编码与名称'); return; }
    setActionLoading('submit:ws');
    try {
      await apiService.createWorkStation(wsForm);
      setShowWsForm(false);
      setWsForm({ code: '', name: '', type: 'Sewing', capacityPerDay: undefined, capacityUnit: 'PC', location: '', manager: '' });
      await fetchWorkStations();
    } catch (e: any) { setError(e?.message || '创建工位失败'); }
    finally { setActionLoading(null); }
  };

  const submitWh = async () => {
    if (!whForm.productionPlanId || whForm.hours <= 0) { setError('请选择排产单并填写工时'); return; }
    setActionLoading('submit:wh');
    try {
      await apiService.createWorkHour(whForm);
      setShowWhForm(false);
      setWhForm({ productionPlanId: '', workDate: todayStr(), hours: 0, overtimeHours: 0 });
      await fetchWorkHours();
    } catch (e: any) { setError(e?.message || '创建工时失败'); }
    finally { setActionLoading(null); }
  };

  const submitRule = async () => {
    if (!ruleForm.code || !ruleForm.name || ruleForm.ratePerUnit <= 0) { setError('请填写规则编码、名称、单价'); return; }
    setActionLoading('submit:rule');
    try {
      await apiService.createPieceRateRule(ruleForm);
      setShowRuleForm(false);
      setRuleForm({ code: '', name: '', processType: 'Sewing', unit: 'PC', ratePerUnit: 0, effectiveFrom: todayStr() });
      await fetchPieceRateRules();
    } catch (e: any) { setError(e?.message || '创建计件规则失败'); }
    finally { setActionLoading(null); }
  };

  const submitRecord = async () => {
    if (!recordForm.pieceRateRuleId || recordForm.quantity <= 0) { setError('请选择计件规则并填写数量'); return; }
    setActionLoading('submit:record');
    try {
      await apiService.createPieceRateRecord(recordForm);
      setShowRecordForm(false);
      setRecordForm({ pieceRateRuleId: '', workDate: todayStr(), quantity: 0, unit: 'PC' });
      await fetchPieceRateRecords();
    } catch (e: any) { setError(e?.message || '创建计件记录失败'); }
    finally { setActionLoading(null); }
  };

  const submitOso = async () => {
    if (!osoForm.orderNumber || osoForm.quantity <= 0 || osoForm.unitPrice <= 0) { setError('请填写外协单号、数量、单价'); return; }
    setActionLoading('submit:oso');
    try {
      await apiService.createOutsourcingOrder(osoForm);
      setShowOsoForm(false);
      setOsoForm({ orderNumber: '', processType: 'Sewing', quantity: 0, unit: 'PC', unitPrice: 0, currency: 'CNY' });
      await fetchOutsourcing();
    } catch (e: any) { setError(e?.message || '创建外协失败'); }
    finally { setActionLoading(null); }
  };

  // ── 通用删除 ──
  const deletePlan = async (id: string) => {
    setActionLoading(`del:plan:${id}`);
    try { await apiService.deleteProductionPlan(id); await fetchPlans(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };
  const deleteWs = async (id: string) => {
    setActionLoading(`del:ws:${id}`);
    try { await apiService.deleteWorkStation(id); await fetchWorkStations(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };
  const deleteRule = async (id: string) => {
    setActionLoading(`del:rule:${id}`);
    try { await apiService.deletePieceRateRule(id); await fetchPieceRateRules(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };
  const deleteRecord = async (id: string) => {
    setActionLoading(`del:record:${id}`);
    try { await apiService.deletePieceRateRecord(id); await fetchPieceRateRecords(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };
  const deleteOso = async (id: string) => {
    setActionLoading(`del:oso:${id}`);
    try { await apiService.deleteOutsourcingOrder(id); await fetchOutsourcing(); }
    catch (e: any) { setError(e?.message || '删除失败'); }
    finally { setActionLoading(null); }
  };

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'plans', label: '排产', icon: <CalendarClock size={12} />, count: plans.length },
    { id: 'workStations', label: '工位', icon: <Cog size={12} />, count: workStations.length },
    { id: 'outsourcing', label: '外协', icon: <Send size={12} />, count: outsourcingOrders.length },
    { id: 'workHours', label: '工时', icon: <Clock size={12} />, count: workHours.length },
    { id: 'pieceRateRules', label: '计件规则', icon: <Award size={12} />, count: pieceRateRules.length },
    { id: 'pieceRateRecords', label: '计件记录', icon: <Award size={12} />, count: pieceRateRecords.length },
  ];

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader
        title="生产执行 MES"
        subtitle="Manufacturing Execution System"
        contextLabel="MES Desk"
        isDarkMode={isDarkMode}
        actions={
          <button onClick={refreshAll} className={ghostBtnCls} title="刷新全部">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col relative px-7 pb-6 pt-2">
        <ScrollEdgeFades scrollRef={{ current: null }} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* Tab 切换 */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} className={tabBtnCls(activeTab === t.id)}>
                {t.icon}<span>{t.label}</span>
                {t.count != null && t.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === t.id ? 'bg-white/20' : isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {error && (
            <div className={`p-3 rounded-inset border flex items-center gap-2 mb-3 ${statusSemanticClass('danger', isDarkMode)}`}>
              <AlertCircle size={16} className={statusSemanticText('danger', isDarkMode)} />
              <span className="text-sm">{error}</span>
              <button onClick={() => setError(null)} className={`ml-auto p-0.5 ${isDarkMode ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-900'}`}>
                <X size={14} />
              </button>
            </div>
          )}

          {/* ════════════ 排产 Tab ════════════ */}
          {activeTab === 'plans' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <button onClick={() => setShowPlanForm(true)} className={primaryBtnCls}>
                  <Plus size={14} /><span>新增排产</span>
                </button>
                <button onClick={() => refreshTab('plans')} className={ghostBtnCls} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:plans' ? 'animate-spin' : ''} />
                </button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className={`animate-spin ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                </div>
              ) : plans.length === 0 ? (
                <EmptyState icon={<CalendarClock size={32} />} text="暂无排产单" isDarkMode={isDarkMode} />
              ) : (
                <div className="space-y-2">
                  {plans.map((plan, i) => {
                    const semantic = statusSemanticOf(PLAN_STATUSES, plan.status);
                    const progress = Number(plan.plannedQuantity) > 0
                      ? Math.min(100, Math.round((Number(plan.actualQuantity) / Number(plan.plannedQuantity)) * 100))
                      : 0;
                    return (
                      <motion.div key={plan.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className={`${cardClass} overflow-hidden`}>
                        <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={() => setExpandedId(expandedId === plan.id ? null : plan.id)}>
                          <button className={`flex-shrink-0 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                            {expandedId === plan.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{plan.planNumber}</span>
                              <StatusBadge semantic={semantic} label={statusLabel(PLAN_STATUSES, plan.status)} isDarkMode={isDarkMode} />
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-light ${isDarkMode ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                                {statusLabel(PRIORITIES, plan.priority)}优先级
                              </span>
                            </div>
                            <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                              {plan.workStation?.name || wsName(plan.workStationId)} · {statusLabel(WS_TYPES, plan.processType)}
                              {plan.orderId ? ` · 订单 ${plan.orderId.slice(-8)}` : ''}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className={`text-sm font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                              {formatNum(Number(plan.actualQuantity))} / {formatNum(Number(plan.plannedQuantity))} <span className="text-xs opacity-60">{plan.unit}</span>
                            </div>
                            <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{formatDate(plan.plannedStartDate)} → {formatDate(plan.plannedEndDate)}</div>
                          </div>
                        </div>

                        {/* 进度条 */}
                        <div className="px-4 pb-2">
                          <div className={`h-1 rounded-full overflow-hidden ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}>
                            <div className="h-full bg-[var(--os-vnext-brand-blue)] transition-all" style={{ width: `${progress}%` }} />
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedId === plan.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className={`p-4 border-t ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {plan.status === 'Draft' && (
                                    <>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Confirmed')} loading={actionLoading === `plan:${plan.id}`} icon={<CheckCircle2 size={12} />} isDarkMode={isDarkMode}>确认排产</ActionButton>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Cancelled')} loading={actionLoading === `plan:${plan.id}`} icon={<X size={12} />} danger isDarkMode={isDarkMode}>取消</ActionButton>
                                      <ActionButton onClick={() => deletePlan(plan.id)} loading={actionLoading === `del:plan:${plan.id}`} icon={<Trash2 size={12} />} danger isDarkMode={isDarkMode}>删除</ActionButton>
                                    </>
                                  )}
                                  {plan.status === 'Confirmed' && (
                                    <>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'InProgress')} loading={actionLoading === `plan:${plan.id}`} icon={<PlayCircle size={12} />} isDarkMode={isDarkMode}>开始生产</ActionButton>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Cancelled')} loading={actionLoading === `plan:${plan.id}`} icon={<X size={12} />} danger isDarkMode={isDarkMode}>取消</ActionButton>
                                    </>
                                  )}
                                  {plan.status === 'InProgress' && (
                                    <>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Completed')} loading={actionLoading === `plan:${plan.id}`} icon={<StopCircle size={12} />} isDarkMode={isDarkMode}>完成</ActionButton>
                                      <ActionButton onClick={() => transitionPlan(plan.id, 'Cancelled')} loading={actionLoading === `plan:${plan.id}`} icon={<X size={12} />} danger isDarkMode={isDarkMode}>取消</ActionButton>
                                    </>
                                  )}
                                </div>
                                {plan.notes && <div className={`text-xs mt-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{plan.notes}</div>}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {showPlanForm && (
                <CreateFormModal title="新增排产单" onClose={() => setShowPlanForm(false)} onSubmit={submitPlan} loading={actionLoading === 'submit:plan'} isDarkMode={isDarkMode}>
                  <FormField label="排产单号" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={planForm.planNumber} onChange={e => setPlanForm({ ...planForm, planNumber: e.target.value })} placeholder="PP-2026-001" />
                  </FormField>
                  <FormField label="工位" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={planForm.workStationId} onChange={e => setPlanForm({ ...planForm, workStationId: e.target.value })}>
                      <option value="">选择工位</option>
                      {workStations.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                    </select>
                  </FormField>
                  <FormField label="工序类型" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={planForm.processType} onChange={e => setPlanForm({ ...planForm, processType: e.target.value as WorkStationType })}>
                      {WS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="计划数量" isDarkMode={isDarkMode}>
                    <input type="number" className={fieldClass} value={planForm.plannedQuantity} onChange={e => setPlanForm({ ...planForm, plannedQuantity: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="单位" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={planForm.unit} onChange={e => setPlanForm({ ...planForm, unit: e.target.value })}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </FormField>
                  <FormField label="计划开始" isDarkMode={isDarkMode}>
                    <input type="date" className={fieldClass} value={planForm.plannedStartDate} onChange={e => setPlanForm({ ...planForm, plannedStartDate: e.target.value })} />
                  </FormField>
                  <FormField label="计划结束" isDarkMode={isDarkMode}>
                    <input type="date" className={fieldClass} value={planForm.plannedEndDate} onChange={e => setPlanForm({ ...planForm, plannedEndDate: e.target.value })} />
                  </FormField>
                  <FormField label="优先级" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={planForm.priority} onChange={e => setPlanForm({ ...planForm, priority: e.target.value as Priority })}>
                      {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 工位 Tab ════════════ */}
          {activeTab === 'workStations' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <button onClick={() => setShowWsForm(true)} className={primaryBtnCls}>
                  <Plus size={14} /><span>新增工位</span>
                </button>
                <button onClick={() => refreshTab('workStations')} className={ghostBtnCls} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:workStations' ? 'animate-spin' : ''} />
                </button>
              </div>

              {workStations.length === 0 ? (
                <EmptyState icon={<Cog size={32} />} text="暂无工位" isDarkMode={isDarkMode} />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {workStations.map((ws, i) => (
                    <motion.div key={ws.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className={`${cardClass} p-4`}>
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Factory size={14} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'} />
                            <span className={`text-sm font-mono truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{ws.code}</span>
                          </div>
                          <div className={`text-sm mt-1 ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>{ws.name}</div>
                          <div className={`text-xs mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            {statusLabel(WS_TYPES, ws.type)} · {ws.isActive ? '启用' : '停用'}
                          </div>
                        </div>
                        <button onClick={() => deleteWs(ws.id)} disabled={actionLoading === `del:ws:${ws.id}`} className={`p-1 rounded-control ${isDarkMode ? 'text-slate-500 hover:text-red-400 hover:bg-white/5' : 'text-slate-400 hover:text-red-600 hover:bg-slate-100'} disabled:opacity-50`} title="删除">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {ws.capacityPerDay != null && (
                        <div className={`text-[10px] mt-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                          日产能 {formatNum(Number(ws.capacityPerDay))} {ws.capacityUnit || ''}
                          {ws.location ? ` · ${ws.location}` : ''}
                          {ws.manager ? ` · ${ws.manager}` : ''}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}

              {showWsForm && (
                <CreateFormModal title="新增工位" onClose={() => setShowWsForm(false)} onSubmit={submitWs} loading={actionLoading === 'submit:ws'} isDarkMode={isDarkMode}>
                  <FormField label="工位编码" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={wsForm.code} onChange={e => setWsForm({ ...wsForm, code: e.target.value })} placeholder="WS-001" />
                  </FormField>
                  <FormField label="工位名称" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={wsForm.name} onChange={e => setWsForm({ ...wsForm, name: e.target.value })} placeholder="缝纫一号线" />
                  </FormField>
                  <FormField label="类型" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={wsForm.type} onChange={e => setWsForm({ ...wsForm, type: e.target.value as WorkStationType })}>
                      {WS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="日产能" isDarkMode={isDarkMode}>
                    <input type="number" className={fieldClass} value={wsForm.capacityPerDay ?? ''} onChange={e => setWsForm({ ...wsForm, capacityPerDay: e.target.value ? Number(e.target.value) : undefined })} />
                  </FormField>
                  <FormField label="位置" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={wsForm.location} onChange={e => setWsForm({ ...wsForm, location: e.target.value })} />
                  </FormField>
                  <FormField label="负责人" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={wsForm.manager} onChange={e => setWsForm({ ...wsForm, manager: e.target.value })} />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 外协 Tab ════════════ */}
          {activeTab === 'outsourcing' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <button onClick={() => setShowOsoForm(true)} className={primaryBtnCls}>
                  <Plus size={14} /><span>新增外协</span>
                </button>
                <button onClick={() => refreshTab('outsourcing')} className={ghostBtnCls} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:outsourcing' ? 'animate-spin' : ''} />
                </button>
              </div>

              {outsourcingOrders.length === 0 ? (
                <EmptyState icon={<Send size={32} />} text="暂无外协订单" isDarkMode={isDarkMode} />
              ) : (
                <div className="space-y-2">
                  {outsourcingOrders.map((oso, i) => {
                    const semantic = statusSemanticOf(OUTSOURCING_STATUSES, oso.status);
                    return (
                      <motion.div key={oso.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className={`${cardClass} overflow-hidden`}>
                        <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={() => setExpandedId(expandedId === oso.id ? null : oso.id)}>
                          <button className={`flex-shrink-0 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                            {expandedId === oso.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{oso.orderNumber}</span>
                              <StatusBadge semantic={semantic} label={statusLabel(OUTSOURCING_STATUSES, oso.status)} isDarkMode={isDarkMode} />
                            </div>
                            <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                              {statusLabel(OUTSOURCING_PROCESS_TYPES, oso.processType)}
                              {oso.description ? ` · ${oso.description}` : ''}
                              {oso.plannedDeliveryDate ? ` · 交期 ${oso.plannedDeliveryDate}` : ''}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className={`text-sm font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                              {formatNum(Number(oso.totalAmount))} <span className="text-xs opacity-60">{oso.currency}</span>
                            </div>
                            <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{formatNum(Number(oso.quantity))} {oso.unit} × {formatNum(Number(oso.unitPrice))}</div>
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedId === oso.id && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className={`p-4 border-t ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {oso.status === 'Draft' && (
                                    <>
                                      <ActionButton onClick={() => transitionOutsourcing(oso.id, 'Sent')} loading={actionLoading === `oso:${oso.id}`} icon={<Send size={12} />} isDarkMode={isDarkMode}>发送</ActionButton>
                                      <ActionButton onClick={() => transitionOutsourcing(oso.id, 'Cancelled')} loading={actionLoading === `oso:${oso.id}`} icon={<X size={12} />} danger isDarkMode={isDarkMode}>取消</ActionButton>
                                      <ActionButton onClick={() => deleteOso(oso.id)} loading={actionLoading === `del:oso:${oso.id}`} icon={<Trash2 size={12} />} danger isDarkMode={isDarkMode}>删除</ActionButton>
                                    </>
                                  )}
                                  {oso.status === 'Sent' && (
                                    <ActionButton onClick={() => transitionOutsourcing(oso.id, 'Confirmed')} loading={actionLoading === `oso:${oso.id}`} icon={<CheckCircle2 size={12} />} isDarkMode={isDarkMode}>确认</ActionButton>
                                  )}
                                  {oso.status === 'Confirmed' && (
                                    <ActionButton onClick={() => transitionOutsourcing(oso.id, 'InProduction')} loading={actionLoading === `oso:${oso.id}`} icon={<PlayCircle size={12} />} isDarkMode={isDarkMode}>投入生产</ActionButton>
                                  )}
                                  {oso.status === 'InProduction' && (
                                    <ActionButton onClick={() => transitionOutsourcing(oso.id, 'Received')} loading={actionLoading === `oso:${oso.id}`} icon={<PackageCheck size={12} />} isDarkMode={isDarkMode}>到货验收</ActionButton>
                                  )}
                                </div>
                                {oso.lines && oso.lines.length > 0 && (
                                  <div className="mt-3 space-y-1">
                                    <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>行明细</div>
                                    {oso.lines.map(line => (
                                      <div key={line.id} className={`flex justify-between text-xs ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                                        <span>{statusLabel(OUTSOURCING_PROCESS_TYPES, line.processType)} · {line.description}</span>
                                        <span className="tabular-nums">{formatNum(Number(line.quantity))} {line.unit} × {formatNum(Number(line.unitPrice))} = {formatNum(Number(line.amount))}</span>
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
              )}

              {showOsoForm && (
                <CreateFormModal title="新增外协订单" onClose={() => setShowOsoForm(false)} onSubmit={submitOso} loading={actionLoading === 'submit:oso'} isDarkMode={isDarkMode}>
                  <FormField label="外协单号" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={osoForm.orderNumber} onChange={e => setOsoForm({ ...osoForm, orderNumber: e.target.value })} placeholder="OSO-2026-001" />
                  </FormField>
                  <FormField label="工序类型" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={osoForm.processType} onChange={e => setOsoForm({ ...osoForm, processType: e.target.value as OutsourcingProcessType })}>
                      {OUTSOURCING_PROCESS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="数量" isDarkMode={isDarkMode}>
                    <input type="number" className={fieldClass} value={osoForm.quantity} onChange={e => setOsoForm({ ...osoForm, quantity: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="单位" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={osoForm.unit} onChange={e => setOsoForm({ ...osoForm, unit: e.target.value })}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </FormField>
                  <FormField label="单价" isDarkMode={isDarkMode}>
                    <input type="number" className={fieldClass} value={osoForm.unitPrice} onChange={e => setOsoForm({ ...osoForm, unitPrice: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="币种" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={osoForm.currency} onChange={e => setOsoForm({ ...osoForm, currency: e.target.value })}>
                      <option value="CNY">CNY 人民币</option>
                      <option value="USD">USD 美元</option>
                    </select>
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 工时 Tab ════════════ */}
          {activeTab === 'workHours' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <button onClick={() => setShowWhForm(true)} className={primaryBtnCls}>
                  <Plus size={14} /><span>记录工时</span>
                </button>
                <button onClick={() => refreshTab('workHours')} className={ghostBtnCls} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:workHours' ? 'animate-spin' : ''} />
                </button>
              </div>

              {workHours.length === 0 ? (
                <EmptyState icon={<Clock size={32} />} text="暂无工时记录" isDarkMode={isDarkMode} />
              ) : (
                <div className="space-y-2">
                  {workHours.map((wh, i) => (
                    <motion.div key={wh.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }} className={`${cardClass} p-3 flex items-center gap-3`}>
                      <Clock size={14} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          {wh.employeeName || wh.employeeId || '未知员工'}
                          {wh.productionPlanId && <span className={`text-xs ml-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>排产 {wh.productionPlanId.slice(-8)}</span>}
                        </div>
                        <div className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{wh.workDate}{wh.notes ? ` · ${wh.notes}` : ''}</div>
                      </div>
                      <div className={`text-sm font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        {formatNum(Number(wh.hours))}h
                        {Number(wh.overtimeHours) > 0 && <span className={`text-xs ml-1 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>+{formatNum(Number(wh.overtimeHours))}加班</span>}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {showWhForm && (
                <CreateFormModal title="记录工时" onClose={() => setShowWhForm(false)} onSubmit={submitWh} loading={actionLoading === 'submit:wh'} isDarkMode={isDarkMode}>
                  <FormField label="排产单" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={whForm.productionPlanId} onChange={e => setWhForm({ ...whForm, productionPlanId: e.target.value })}>
                      <option value="">选择排产单</option>
                      {plans.map(p => <option key={p.id} value={p.id}>{p.planNumber}</option>)}
                    </select>
                  </FormField>
                  <FormField label="员工姓名" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={whForm.employeeName ?? ''} onChange={e => setWhForm({ ...whForm, employeeName: e.target.value })} />
                  </FormField>
                  <FormField label="日期" isDarkMode={isDarkMode}>
                    <input type="date" className={fieldClass} value={whForm.workDate} onChange={e => setWhForm({ ...whForm, workDate: e.target.value })} />
                  </FormField>
                  <FormField label="工时" isDarkMode={isDarkMode}>
                    <input type="number" className={fieldClass} value={whForm.hours} onChange={e => setWhForm({ ...whForm, hours: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="加班工时" isDarkMode={isDarkMode}>
                    <input type="number" className={fieldClass} value={whForm.overtimeHours ?? 0} onChange={e => setWhForm({ ...whForm, overtimeHours: Number(e.target.value) })} />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 计件规则 Tab ════════════ */}
          {activeTab === 'pieceRateRules' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <button onClick={() => setShowRuleForm(true)} className={primaryBtnCls}>
                  <Plus size={14} /><span>新增规则</span>
                </button>
                <button onClick={() => refreshTab('pieceRateRules')} className={ghostBtnCls} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:pieceRateRules' ? 'animate-spin' : ''} />
                </button>
              </div>

              {pieceRateRules.length === 0 ? (
                <EmptyState icon={<Award size={32} />} text="暂无计件规则" isDarkMode={isDarkMode} />
              ) : (
                <div className="space-y-2">
                  {pieceRateRules.map((rule, i) => (
                    <motion.div key={rule.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }} className={`${cardClass} p-3 flex items-center gap-3`}>
                      <Award size={14} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{rule.code}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-light ${rule.isActive ? statusSemanticClass('success', isDarkMode) : statusSemanticClass('neutral', isDarkMode)} ${rule.isActive ? statusSemanticText('success', isDarkMode) : statusSemanticText('neutral', isDarkMode)}`}>
                            {rule.isActive ? '生效' : '停用'}
                          </span>
                        </div>
                        <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {rule.name} · {statusLabel(WS_TYPES, rule.processType)} · 生效 {rule.effectiveFrom}{rule.effectiveTo ? ` 至 ${rule.effectiveTo}` : ' 长期'}
                        </div>
                      </div>
                      <div className={`text-sm font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        {formatNum(Number(rule.ratePerUnit))} <span className="text-xs opacity-60">CNY/{rule.unit}</span>
                      </div>
                      <button onClick={() => deleteRule(rule.id)} disabled={actionLoading === `del:rule:${rule.id}`} className={`p-1 rounded-control ${isDarkMode ? 'text-slate-500 hover:text-red-400 hover:bg-white/5' : 'text-slate-400 hover:text-red-600 hover:bg-slate-100'} disabled:opacity-50`} title="删除">
                        <Trash2 size={14} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}

              {showRuleForm && (
                <CreateFormModal title="新增计件规则" onClose={() => setShowRuleForm(false)} onSubmit={submitRule} loading={actionLoading === 'submit:rule'} isDarkMode={isDarkMode}>
                  <FormField label="规则编码" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={ruleForm.code} onChange={e => setRuleForm({ ...ruleForm, code: e.target.value })} placeholder="PR-SEW-001" />
                  </FormField>
                  <FormField label="规则名称" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="缝纫计件标准" />
                  </FormField>
                  <FormField label="工序类型" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={ruleForm.processType} onChange={e => setRuleForm({ ...ruleForm, processType: e.target.value as WorkStationType })}>
                      {WS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="单位" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={ruleForm.unit} onChange={e => setRuleForm({ ...ruleForm, unit: e.target.value })}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </FormField>
                  <FormField label="单价" isDarkMode={isDarkMode}>
                    <input type="number" className={fieldClass} value={ruleForm.ratePerUnit} onChange={e => setRuleForm({ ...ruleForm, ratePerUnit: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="生效日期" isDarkMode={isDarkMode}>
                    <input type="date" className={fieldClass} value={ruleForm.effectiveFrom} onChange={e => setRuleForm({ ...ruleForm, effectiveFrom: e.target.value })} />
                  </FormField>
                </CreateFormModal>
              )}
            </motion.div>
          )}

          {/* ════════════ 计件记录 Tab ════════════ */}
          {activeTab === 'pieceRateRecords' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <button onClick={() => setShowRecordForm(true)} className={primaryBtnCls}>
                  <Plus size={14} /><span>新增计件</span>
                </button>
                <button onClick={() => refreshTab('pieceRateRecords')} className={ghostBtnCls} title="刷新">
                  <RefreshCw size={16} className={actionLoading === 'refresh:pieceRateRecords' ? 'animate-spin' : ''} />
                </button>
              </div>

              {pieceRateRecords.length === 0 ? (
                <EmptyState icon={<Award size={32} />} text="暂无计件记录" isDarkMode={isDarkMode} />
              ) : (
                <div className="space-y-2">
                  {pieceRateRecords.map((rec, i) => {
                    const semantic = statusSemanticOf(PIECE_RATE_STATUSES, rec.status);
                    return (
                      <motion.div key={rec.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.01 }} className={`${cardClass} p-3 flex items-center gap-3`}>
                        <Award size={14} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{rec.employeeName || rec.employeeId || '未知员工'}</span>
                            <StatusBadge semantic={semantic} label={statusLabel(PIECE_RATE_STATUSES, rec.status)} isDarkMode={isDarkMode} />
                          </div>
                          <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            {rec.pieceRateRule?.name || rec.pieceRateRuleId}{rec.workDate ? ` · ${rec.workDate}` : ''}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`text-sm font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            {formatNum(Number(rec.amount))} <span className="text-xs opacity-60">{rec.currency}</span>
                          </div>
                          <div className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{formatNum(Number(rec.quantity))} {rec.unit} × {formatNum(Number(rec.ratePerUnit))}</div>
                        </div>
                        <div className="flex flex-col gap-1">
                          {rec.status === 'Pending' && (
                            <>
                              <ActionButton onClick={() => transitionPieceRate(rec.id, 'Confirmed')} loading={actionLoading === `prr:${rec.id}`} icon={<CheckCircle2 size={11} />} isDarkMode={isDarkMode} small>确认</ActionButton>
                              <ActionButton onClick={() => deleteRecord(rec.id)} loading={actionLoading === `del:record:${rec.id}`} icon={<Trash2 size={11} />} danger isDarkMode={isDarkMode} small>删</ActionButton>
                            </>
                          )}
                          {rec.status === 'Confirmed' && (
                            <ActionButton onClick={() => transitionPieceRate(rec.id, 'Paid')} loading={actionLoading === `prr:${rec.id}`} icon={<CheckCircle2 size={11} />} isDarkMode={isDarkMode} small>支付</ActionButton>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {showRecordForm && (
                <CreateFormModal title="新增计件记录" onClose={() => setShowRecordForm(false)} onSubmit={submitRecord} loading={actionLoading === 'submit:record'} isDarkMode={isDarkMode}>
                  <FormField label="计件规则" isDarkMode={isDarkMode}>
                    <select className={fieldClass} value={recordForm.pieceRateRuleId} onChange={e => setRecordForm({ ...recordForm, pieceRateRuleId: e.target.value, unit: pieceRateRules.find(r => r.id === e.target.value)?.unit || 'PC' })}>
                      <option value="">选择规则</option>
                      {pieceRateRules.filter(r => r.isActive).map(r => <option key={r.id} value={r.id}>{r.code} · {r.name} ({formatNum(Number(r.ratePerUnit))}/{r.unit})</option>)}
                    </select>
                  </FormField>
                  <FormField label="员工姓名" isDarkMode={isDarkMode}>
                    <input className={fieldClass} value={recordForm.employeeName ?? ''} onChange={e => setRecordForm({ ...recordForm, employeeName: e.target.value })} />
                  </FormField>
                  <FormField label="日期" isDarkMode={isDarkMode}>
                    <input type="date" className={fieldClass} value={recordForm.workDate} onChange={e => setRecordForm({ ...recordForm, workDate: e.target.value })} />
                  </FormField>
                  <FormField label="数量" isDarkMode={isDarkMode}>
                    <input type="number" className={fieldClass} value={recordForm.quantity} onChange={e => setRecordForm({ ...recordForm, quantity: Number(e.target.value) })} />
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

// ==================== 子组件 ====================

const StatusBadge: React.FC<{ semantic: StatusSemantic; label: string; isDarkMode: boolean }> = ({ semantic, label, isDarkMode }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-light ${statusSemanticClass(semantic, isDarkMode)} ${statusSemanticText(semantic, isDarkMode)}`}>{label}</span>
);

const EmptyState: React.FC<{ icon: React.ReactNode; text: string; isDarkMode: boolean }> = ({ icon, text, isDarkMode }) => (
  <div className={`text-center py-12 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
    <div className="flex justify-center mb-2 opacity-50">{icon}</div>
    <p className="text-sm">{text}</p>
  </div>
);

const ActionButton: React.FC<{
  onClick: () => void;
  loading?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  isDarkMode: boolean;
  danger?: boolean;
  small?: boolean;
}> = ({ onClick, loading, icon, children, isDarkMode, danger, small }) => (
  <button
    onClick={onClick}
    disabled={loading}
    className={`inline-flex items-center gap-1 ${small ? 'h-6 px-2 text-[10px]' : 'h-8 px-3 text-[11px]'} rounded-control font-light transition-colors disabled:opacity-50 ${
      danger
        ? isDarkMode ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'
        : isDarkMode ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'
    }`}
  >
    {loading ? <Loader2 size={small ? 10 : 12} className="animate-spin" /> : icon}
    {children}
  </button>
);

const FormField: React.FC<{ label: string; isDarkMode: boolean; children: React.ReactNode }> = ({ label, isDarkMode, children }) => (
  <div>
    <label className={`block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{label}</label>
    {children}
  </div>
);

const CreateFormModal: React.FC<{
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  loading?: boolean;
  isDarkMode: boolean;
  children: React.ReactNode;
}> = ({ title, onClose, onSubmit, loading, isDarkMode, children }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.95, opacity: 0 }}
      onClick={e => e.stopPropagation()}
      className={`w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar rounded-panel border p-5 ${
        isDarkMode ? 'bg-slate-900/95 border-white/10' : 'bg-white/95 border-slate-200'
      } ${BAMBOOK_OS.material.glassColor}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{title}</h2>
        <button onClick={onClose} className={`p-1 rounded-control ${isDarkMode ? 'text-slate-400 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-100'}`}>
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {children}
      </div>
      <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-white/5">
        <button onClick={onClose} className={`h-8 px-4 rounded-control text-xs font-light ${isDarkMode ? 'text-slate-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'}`}>取消</button>
        <button onClick={onSubmit} disabled={loading} className="h-8 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1.5 transition-colors disabled:opacity-50">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          <span>创建</span>
        </button>
      </div>
    </motion.div>
  </motion.div>
);

export default MesManager;
