/**
 * 风险管理与合规 RisksManager
 * 阶段 H H3：风险管理与合规前端
 *
 * 功能：
 *   1. 预警中心 Alerts — 风险总览统计条 / 统一预警列表（确认 / 解决）/ 类型·等级·状态过滤
 *   2. 汇率 FX — 最新汇率卡片 / 汇率录入 / 历史查询 / 订单汇率锁定
 *   3. 信用 Credit — 客户最新评级（A-D + 因子快照）/ 按客户评估 / 信用风险扫描
 *   4. 合规 Compliance — HS Code / 出口管制检查触发 / 原产地规则人工登记 / 检查记录
 *   5. 质量 Quality — 疵点趋势（按工厂 / 季度分组）/ 重复问题扫描
 *
 * 设计原则：
 *   - 预警/评级/检查均为服务端真源，前端只做展示与触发，不做本地推断
 *   - Relation 名称经既有 relations API 批量取映射（category=Customer）
 *   - BDS v2.1：视觉层已迁移至组件族（bds-tabs/bds-segment/bds-card/bds-badge/bds-table/bds-input/bds-empty 等），
 *     状态用 bds-badge 语义变体（*_VARIANT 常量）替代 statusSemanticClass 拼装，主题透明无 isDarkMode 三元
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BellRing,
  CircleDollarSign,
  Gauge,
  ClipboardCheck,
  ShieldCheck,
  RefreshCw,
  Loader2,
  Trash2,
  Check,
  CheckCheck,
  Play,
  Lock,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Relation,
  Order,
  CustomsDeclaration,
  RiskAlert,
  RiskAlertType,
  RiskAlertLevel,
  RiskAlertStatus,
  RiskOverview,
  ExchangeRate,
  LatestFxRate,
  FxRateLock,
  CreditRating,
  CreditGrade,
  ComplianceCheck,
  ComplianceCheckType,
  ComplianceCheckResult,
  DefectTrendItem,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import CustomSelect from './ui/CustomSelect';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';

// ==================== 常量 ====================

type ModuleTab = 'alerts' | 'fx' | 'credit' | 'compliance' | 'quality';

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'alerts', label: '预警中心 Alerts', icon: BellRing },
  { id: 'fx', label: '汇率 FX', icon: CircleDollarSign },
  { id: 'credit', label: '信用 Credit', icon: Gauge },
  { id: 'compliance', label: '合规 Compliance', icon: ClipboardCheck },
  { id: 'quality', label: '质量 Quality', icon: ShieldCheck },
];

const ALERT_TYPE_LABELS: Record<RiskAlertType, string> = {
  fx_volatility: '汇率波动',
  credit_frozen: '信用冻结',
  bad_debt: '坏账预警',
  compliance_fail: '合规未通过',
  quality_repeat: '质量重复问题',
  sample_deadline: '样品交期',
  hr_lifecycle: '人事生命周期',
  crm_follow_up_overdue: '跟进逾期',
  lc_maturity: '信用证到期',
  tax_refund_stall: '退税滞留',
  factory_visit: '实地验厂',
  dunning_stage: '催款分级',
};

// M3：筛选按钮补全后端全部 12 种预警类型（与 server riskService ALERT_TYPES 对齐）
const ALERT_TYPE_FILTERS: readonly RiskAlertType[] = [
  'fx_volatility', 'credit_frozen', 'bad_debt', 'compliance_fail', 'quality_repeat', 'sample_deadline',
  'hr_lifecycle', 'crm_follow_up_overdue', 'lc_maturity', 'tax_refund_stall', 'factory_visit', 'dunning_stage',
];

const ALERT_LEVEL_LABELS: Record<RiskAlertLevel, string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
};

const ALERT_STATUS_LABELS: Record<RiskAlertStatus, string> = {
  Open: '未处理',
  Acknowledged: '已确认',
  Resolved: '已解决',
};

const CHECK_TYPE_LABELS: Record<ComplianceCheckType, string> = {
  hs_code: 'HS Code 归类',
  export_control: '出口管制',
  origin_rule: '原产地规则',
};

const CHECK_RESULT_LABELS: Record<ComplianceCheckResult, string> = {
  pass: '通过',
  warn: '警告',
  fail: '未通过',
};

// BDS v2.1：状态 → bds-badge 语义变体（主题透明，替代 statusSemanticClass 拼装；active 归并 info）
type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

const ALERT_LEVEL_VARIANT: Record<RiskAlertLevel, BadgeVariant> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

const ALERT_STATUS_VARIANT: Record<RiskAlertStatus, BadgeVariant> = {
  Open: 'warning',
  Acknowledged: 'info',
  Resolved: 'success',
};

const GRADE_VARIANT: Record<CreditGrade, BadgeVariant> = {
  A: 'success',
  B: 'info',
  C: 'warning',
  D: 'danger',
};

const CHECK_RESULT_VARIANT: Record<ComplianceCheckResult, BadgeVariant> = {
  pass: 'success',
  warn: 'warning',
  fail: 'danger',
};

const FX_CURRENCIES = ['USD', 'EUR', 'HKD', 'GBP', 'JPY'];
const CHECK_TARGET_TYPES = ['CustomsDeclaration', 'Order', 'ProductAsset'];

/** 预警列表分页页大小（服务端上限 200，R3 offset 分页） */
const ALERTS_PAGE_SIZE = 200;

/** R4：列表加载错误横幅（bds-alert + 重试；消除 catch 仅 console.error 导致的「失败伪装成暂无数据」） */
function LoadErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bds-alert danger flex items-center gap-2 shrink-0">
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="bds-btn bds-btn-secondary">
        <RefreshCw className="w-3.5 h-3.5" />
        重试
      </button>
    </div>
  );
}

function formatTs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return dateStr;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
}

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD（本地时区）
}

// ==================== 组件 Props ====================

interface RisksManagerProps {
  isDarkMode?: boolean;
}

// ==================== 共享样式（BDS v2.1 组件族） ====================

const actionBtnCls = 'bds-btn bds-btn-secondary';

function SectionCard({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: 'var(--border-subtle)' }}>
        <span className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>{title}</span>
        {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs mb-1 text-[var(--text-tertiary)]">{label}</label>
      {children}
    </div>
  );
}

// ==================== 主组件 ====================

export default function RisksManager({ isDarkMode }: RisksManagerProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>('alerts');

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="风险管理与合规" subtitle="Risk & Compliance" />

      {/* 模块 Tab 栏（BDS Tabs 下划线式） */}
      <div className="px-7 pb-3 shrink-0">
        <div className="bds-tabs">
          {MODULE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`bds-tab flex items-center gap-1.5 ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 内容（切换即重挂载，保证数据新鲜） */}
      <div className="flex-1 min-h-0 px-7 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="h-full min-h-0"
          >
            {activeTab === 'alerts' && <AlertsPanel />}
            {activeTab === 'fx' && <FxPanel />}
            {activeTab === 'credit' && <CreditPanel />}
            {activeTab === 'compliance' && <CompliancePanel />}
            {activeTab === 'quality' && <QualityPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 预警中心 Panel ====================

function AlertsPanel() {
  const [overview, setOverview] = useState<RiskOverview | null>(null);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // R4：加载失败进 error state（横幅 + 重试），不再 console.error 后伪装成「暂无数据」
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'' | RiskAlertType>('');
  const [levelFilter, setLevelFilter] = useState<'' | RiskAlertLevel>('');
  const [statusFilter, setStatusFilter] = useState<'' | RiskAlertStatus>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoadError(null);
    try {
      setOverview(await apiService.getRiskOverview());
    } catch (e: any) {
      console.error('[RisksManager] loadRiskOverview failed', e);
      setLoadError(`风险总览加载失败：${e?.message || e}`);
    }
  }, []);

  // R3：offset 分页首页（原 limit:200 硬截断；后端 listAlerts 支持 offset + total）
  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await apiService.listRiskAlerts({
        type: typeFilter || undefined,
        level: levelFilter || undefined,
        status: statusFilter || undefined,
        limit: ALERTS_PAGE_SIZE,
        offset: 0,
      });
      setAlerts(result.items);
      setTotal(result.total);
    } catch (e: any) {
      console.error('[RisksManager] listRiskAlerts failed', e);
      setLoadError(`预警列表加载失败：${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, levelFilter, statusFilter]);

  const loadMoreAlerts = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await apiService.listRiskAlerts({
        type: typeFilter || undefined,
        level: levelFilter || undefined,
        status: statusFilter || undefined,
        limit: ALERTS_PAGE_SIZE,
        offset: alerts.length,
      });
      setAlerts((prev) => [...prev, ...result.items]);
      setTotal(result.total);
    } catch (e: any) {
      console.error('[RisksManager] listRiskAlerts loadMore failed', e);
      bdsToast.danger(`加载更多预警失败：${e?.message || e}`);
    } finally {
      setLoadingMore(false);
    }
  }, [typeFilter, levelFilter, statusFilter, alerts.length, loadingMore]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadOverview(), loadAlerts()]);
  }, [loadOverview, loadAlerts]);

  const handleUpdateStatus = async (item: RiskAlert, status: RiskAlertStatus) => {
    setUpdatingId(item.id);
    try {
      await apiService.updateRiskAlertStatus(item.id, status);
      await refreshAll();
      bdsToast.success('预警状态已更新');
    } catch (e: any) {
      bdsToast.danger(`更新预警状态失败：${e?.message || e}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const openByTypeEntries = useMemo(
    () => Object.entries(overview?.openByType ?? {}).filter(([, count]) => count > 0),
    [overview],
  );

  return (
    <div className="h-full flex flex-col min-h-0 gap-4">
      {/* R4：加载失败横幅（重试 = 重新拉取总览 + 列表） */}
      {loadError && <LoadErrorBanner message={loadError} onRetry={refreshAll} />}
      {/* 总览统计条 */}
      <div className="bds-card shrink-0 flex items-center gap-3 flex-wrap" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <span className="text-xs shrink-0" style={{ color: 'var(--text-tertiary)' }}>未结预警</span>
        {(['critical', 'warning', 'info'] as RiskAlertLevel[]).map((level) => (
          <span key={level} className={`bds-badge sm ${ALERT_LEVEL_VARIANT[level]}`}>
            {ALERT_LEVEL_LABELS[level]} {overview?.openByLevel?.[level] ?? 0}
          </span>
        ))}
        <span className="ml-auto text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
          {openByTypeEntries.length > 0
            ? openByTypeEntries.map(([type, count]) => `${ALERT_TYPE_LABELS[type as RiskAlertType] ?? type} ${count}`).join(' · ')
            : '各类型暂无未结预警'}
        </span>
      </div>

      {/* 过滤 + 列表 */}
      <div className="bds-card flex-1 min-h-0 flex flex-col" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-3 space-y-2" style={{ borderBottom: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs w-10 shrink-0" style={{ color: 'var(--text-tertiary)' }}>类型</span>
            <div className="bds-segment flex-wrap">
              {(['', ...ALERT_TYPE_FILTERS] as const).map((t) => (
                <button
                  key={t || 'all'}
                  onClick={() => setTypeFilter(t)}
                  className={`seg ${typeFilter === t ? 'active' : ''}`}
                >
                  {t === '' ? '全部' : ALERT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <button
              onClick={refreshAll}
              className="bds-btn bds-btn-ghost bds-btn-icon ml-auto"
              title="刷新"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs w-10 shrink-0" style={{ color: 'var(--text-tertiary)' }}>等级</span>
            <div className="bds-segment flex-wrap">
              {(['', 'critical', 'warning', 'info'] as const).map((l) => (
                <button
                  key={l || 'all'}
                  onClick={() => setLevelFilter(l)}
                  className={`seg ${levelFilter === l ? 'active' : ''}`}
                >
                  {l === '' ? '全部' : ALERT_LEVEL_LABELS[l]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs w-10 shrink-0" style={{ color: 'var(--text-tertiary)' }}>状态</span>
            <div className="bds-segment flex-wrap">
              {(['', 'Open', 'Acknowledged', 'Resolved'] as const).map((s) => (
                <button
                  key={s || 'all'}
                  onClick={() => setStatusFilter(s)}
                  className={`seg ${statusFilter === s ? 'active' : ''}`}
                >
                  {s === '' ? '全部' : ALERT_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
            </div>
          ) : alerts.length === 0 ? (
            // R4：加载失败时由上方横幅承载，不再显示「暂无」伪装
            loadError ? null : (
            <div className="bds-empty">
              <div className="glyph"><BellRing size={24} /></div>
              <div className="title">暂无匹配的风险预警</div>
            </div>
            )
          ) : (
            alerts.map((alert) => (
              <div key={alert.id} className="px-4 py-3" style={{ borderBottom: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className={`bds-badge sm shrink-0 ${ALERT_LEVEL_VARIANT[alert.level] ?? 'neutral'}`}>
                    {ALERT_LEVEL_LABELS[alert.level] || alert.level}
                  </span>
                  <span className="bds-badge sm info shrink-0">
                    {ALERT_TYPE_LABELS[alert.type] || alert.type}
                  </span>
                  <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{alert.title}</span>
                  <span className={`bds-badge sm ml-auto shrink-0 ${ALERT_STATUS_VARIANT[alert.status] ?? 'neutral'}`}>
                    {ALERT_STATUS_LABELS[alert.status] || alert.status}
                  </span>
                </div>
                <div className="mt-1.5 text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{alert.content}</div>
                <div className="mt-2 flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                  <span>{formatTs(alert.createdAt)}</span>
                  {alert.relatedType && (
                    <span>关联 {alert.relatedType}{alert.relatedId ? ` ${alert.relatedId}` : ''}</span>
                  )}
                  {alert.resolvedAt != null && <span>解决于 {formatTs(alert.resolvedAt)}</span>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {alert.status === 'Open' && (
                      <button
                        onClick={() => handleUpdateStatus(alert, 'Acknowledged')}
                        disabled={updatingId === alert.id}
                        className={actionBtnCls}
                      >
                        {updatingId === alert.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        确认
                      </button>
                    )}
                    {alert.status !== 'Resolved' && (
                      <button
                        onClick={() => handleUpdateStatus(alert, 'Resolved')}
                        disabled={updatingId === alert.id}
                        className={actionBtnCls}
                      >
                        {updatingId === alert.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                        标记解决
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="px-4 py-2 text-xs flex items-center justify-between gap-2" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          <span>共 {total} 条预警 · 已加载 {alerts.length} 条</span>
          {alerts.length < total && (
            <button type="button" onClick={loadMoreAlerts} disabled={loadingMore} className={actionBtnCls}>
              {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              加载更多（剩余 {total - alerts.length} 条）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== 汇率 Panel ====================

function FxPanel() {
  const [latest, setLatest] = useState<LatestFxRate[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [locks, setLocks] = useState<FxRateLock[]>([]);
  const [loadingRates, setLoadingRates] = useState(true);
  const [loadingLocks, setLoadingLocks] = useState(true);
  // R4：加载失败进 error state（横幅 + 重试），不再 console.error 后伪装成「暂无数据」
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currencyFilter, setCurrencyFilter] = useState('');

  // 录入汇率表单
  const [rateCurrency, setRateCurrency] = useState('USD');
  const [rateValue, setRateValue] = useState('');
  const [rateDate, setRateDate] = useState(todayLocal());
  const [rateNote, setRateNote] = useState('');
  const [savingRate, setSavingRate] = useState(false);

  // 新建锁定表单
  const [lockOrderId, setLockOrderId] = useState('');
  const [lockCurrency, setLockCurrency] = useState('USD');
  const [lockRate, setLockRate] = useState('');
  const [lockNote, setLockNote] = useState('');
  const [savingLock, setSavingLock] = useState(false);
  // M5：锁汇订单改下拉选择（订单档案真源，杜绝手打错单号）
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listOrders();
        if (cancelled) return;
        setOrders(list.filter((o) => !o.deletedAt));
      } catch (e) {
        console.error('[RisksManager] load orders failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadLatest = useCallback(async () => {
    setLoadError(null);
    try {
      setLatest(await apiService.getLatestFxRates());
    } catch (e: any) {
      console.error('[RisksManager] getLatestFxRates failed', e);
      setLoadError(`最新汇率加载失败：${e?.message || e}`);
    }
  }, []);

  const loadRates = useCallback(async () => {
    setLoadingRates(true);
    setLoadError(null);
    try {
      setRates(await apiService.listExchangeRates({ currency: currencyFilter || undefined, limit: 100 }));
    } catch (e: any) {
      console.error('[RisksManager] listExchangeRates failed', e);
      setLoadError(`汇率历史加载失败：${e?.message || e}`);
    } finally {
      setLoadingRates(false);
    }
  }, [currencyFilter]);

  const loadLocks = useCallback(async () => {
    setLoadingLocks(true);
    setLoadError(null);
    try {
      setLocks(await apiService.listFxLocks());
    } catch (e: any) {
      console.error('[RisksManager] listFxLocks failed', e);
      setLoadError(`汇率锁定加载失败：${e?.message || e}`);
    } finally {
      setLoadingLocks(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
    loadLocks();
  }, [loadLatest, loadLocks]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadLatest(), loadRates(), loadLocks()]);
  }, [loadLatest, loadRates, loadLocks]);

  const currencyOptions = useMemo(() => {
    const set = new Set<string>(FX_CURRENCIES);
    latest.forEach((r) => set.add(r.currency));
    rates.forEach((r) => set.add(r.currency));
    return Array.from(set).sort();
  }, [latest, rates]);

  const handleAddRate = async () => {
    const value = Number(rateValue);
    if (!rateCurrency.trim() || !rateValue || !(value > 0)) {
      bdsToast.warning('请填写币种与大于 0 的汇率');
      return;
    }
    setSavingRate(true);
    try {
      await apiService.addExchangeRate({
        currency: rateCurrency.trim().toUpperCase(),
        rate: value,
        effectiveDate: rateDate || undefined,
        note: rateNote.trim() || null,
      });
      setRateValue('');
      setRateNote('');
      await refreshAll();
      bdsToast.success('汇率已录入');
    } catch (e: any) {
      bdsToast.danger(`录入汇率失败：${e?.message || e}`);
    } finally {
      setSavingRate(false);
    }
  };

  const handleLock = async () => {
    if (!lockOrderId.trim()) {
      bdsToast.warning('请选择订单');
      return;
    }
    if (lockRate && !(Number(lockRate) > 0)) {
      bdsToast.warning('锁定汇率需大于 0，或留空取最新汇率');
      return;
    }
    setSavingLock(true);
    try {
      await apiService.lockFxRate({
        orderId: lockOrderId.trim(),
        currency: lockCurrency.trim().toUpperCase(),
        rate: lockRate ? Number(lockRate) : undefined,
        note: lockNote.trim() || null,
      });
      setLockOrderId('');
      setLockRate('');
      setLockNote('');
      await loadLocks();
      bdsToast.success('汇率锁定已创建');
    } catch (e: any) {
      bdsToast.danger(`新建汇率锁定失败：${e?.message || e}`);
    } finally {
      setSavingLock(false);
    }
  };

  const handleDeleteLock = async (lock: FxRateLock) => {
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除订单「${lock.orderId}」的 ${lock.currency} 汇率锁定？`, danger: true }))) return;
    try {
      await apiService.deleteFxLock(lock.id);
      await loadLocks();
      bdsToast.success('汇率锁定已解除');
    } catch (e: any) {
      bdsToast.danger(`删除锁定失败：${e?.message || e}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-4 pr-1">
      {/* R4：加载失败横幅（重试 = 重新拉取最新汇率 + 历史 + 锁定） */}
      {loadError && <LoadErrorBanner message={loadError} onRetry={refreshAll} />}
      {/* 最新汇率 */}
      <SectionCard
        title="最新汇率（兑 CNY）"
        extra={
          <button
            onClick={refreshAll}
            className="bds-btn bds-btn-ghost bds-btn-icon"
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        }
      >
        {latest.length === 0 ? (
          <div className="bds-empty">
            <div className="glyph"><CircleDollarSign size={24} /></div>
            <div className="title">暂无汇率数据，请在下方录入第一条汇率</div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {latest.map((item) => (
              <div key={item.currency} className="rounded-inset p-3 bds-inset">
                <div className="flex items-center gap-2">
                  <span className="text-base" style={{ color: 'var(--text-primary)' }}>{item.currency}</span>
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>{item.source}</span>
                </div>
                <div className="bds-tnum mt-1 text-lg" style={{ color: 'var(--text-primary)' }}>{formatRate(item.rate)}</div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>生效 {formatDate(item.effectiveDate)}</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 录入汇率 */}
      <SectionCard title="录入汇率">
        <div className="grid grid-cols-4 gap-3 items-end">
          <Field label="币种 *">
            <CustomSelect
              surface="form"
              value={rateCurrency}
              onChange={(v) => setRateCurrency(v)}
              options={FX_CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="汇率（兑 CNY）*">
            <input type="number" min={0} step="0.0001" className="bds-input" value={rateValue} onChange={(e) => setRateValue(e.target.value)} placeholder="如 7.1234" />
          </Field>
          <Field label="生效日期">
            <CapsuleDateInput className="bds-input" value={rateDate} onChange={setRateDate} />
          </Field>
          <Field label="备注">
            <input className="bds-input" value={rateNote} onChange={(e) => setRateNote(e.target.value)} placeholder="可选" />
          </Field>
        </div>
        <div className="flex justify-end">
          <button onClick={handleAddRate} disabled={savingRate} className={actionBtnCls}>
            {savingRate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CircleDollarSign className="w-3.5 h-3.5" />}
            录入汇率
          </button>
        </div>
      </SectionCard>

      {/* 汇率历史 */}
      <SectionCard
        title="汇率历史"
        extra={
          <CustomSelect
            value={currencyFilter}
            onChange={(v) => setCurrencyFilter(v)}
            size="compact"
            className="w-28"
            options={[{ value: '', label: '全部币种' }, ...currencyOptions.map((c) => ({ value: c, label: c }))]}
          />
        }
      >
        {loadingRates ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : rates.length === 0 ? (
          <div className="bds-empty">
            <div className="glyph"><CircleDollarSign size={24} /></div>
            <div className="title">暂无汇率记录</div>
          </div>
        ) : (
          <div className="rounded-inset overflow-hidden bds-inset">
            <table className="bds-table">
              <thead>
                <tr>
                  <th>币种</th>
                  <th className="num">汇率</th>
                  <th>生效日期</th>
                  <th>来源</th>
                  <th>备注</th>
                  <th>录入时间</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id}>
                    <td style={{ color: 'var(--text-primary)' }}>{rate.currency}</td>
                    <td className="num bds-tnum">{formatRate(rate.rate)}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatDate(rate.effectiveDate)}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>{rate.source}</td>
                    <td className="max-w-[220px] truncate" title={rate.note || undefined} style={{ color: 'var(--text-tertiary)' }}>{rate.note || '—'}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>{formatTs(rate.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* 订单汇率锁定 */}
      <SectionCard title="订单汇率锁定">
        <div className="grid grid-cols-[1.2fr_0.8fr_1fr_1.2fr_auto] gap-3 items-end mb-4">
          <Field label="订单 *">
            <CustomSelect
              surface="form"
              value={lockOrderId}
              onChange={(v) => setLockOrderId(v)}
              options={[
                { value: '', label: '选择订单...' },
                ...orders.map((o) => ({ value: o.id, label: `${o.id}（${o.customer}）` })),
              ]}
            />
          </Field>
          <Field label="币种 *">
            <CustomSelect
              surface="form"
              value={lockCurrency}
              onChange={(v) => setLockCurrency(v)}
              options={FX_CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="锁定汇率">
            <input type="number" min={0} step="0.0001" className="bds-input" value={lockRate} onChange={(e) => setLockRate(e.target.value)} placeholder="留空取最新汇率" />
          </Field>
          <Field label="备注">
            <input className="bds-input" value={lockNote} onChange={(e) => setLockNote(e.target.value)} placeholder="可选" />
          </Field>
          <button onClick={handleLock} disabled={savingLock} className={`${actionBtnCls} mb-3`}>
            {savingLock ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            新建锁定
          </button>
        </div>
        <div className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>锁定汇率留空时将自动取该币种最新有效汇率。</div>
        {loadingLocks ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : locks.length === 0 ? (
          loadError ? null : (
          <div className="bds-empty">
            <div className="glyph"><Lock size={24} /></div>
            <div className="title">暂无汇率锁定</div>
            <div className="desc">大额订单建议在报价阶段锁定汇率</div>
          </div>
          )
        ) : (
          <div className="rounded-inset overflow-hidden bds-inset">
            <table className="bds-table">
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>币种</th>
                  <th className="num">锁定汇率</th>
                  <th>锁定时间</th>
                  <th>备注</th>
                  <th className="num">操作</th>
                </tr>
              </thead>
              <tbody>
                {locks.map((lock) => (
                  <tr key={lock.id}>
                    <td className="max-w-[200px] truncate" style={{ color: 'var(--text-primary)' }}>{lock.orderId}</td>
                    <td style={{ color: 'var(--text-primary)' }}>{lock.currency}</td>
                    <td className="num bds-tnum">{formatRate(lock.rate)}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>{formatTs(lock.lockedAt)}</td>
                    <td className="max-w-[200px] truncate" title={lock.note || undefined} style={{ color: 'var(--text-tertiary)' }}>{lock.note || '—'}</td>
                    <td className="num">
                      <button
                        onClick={() => handleDeleteLock(lock)}
                        className="bds-btn bds-btn-ghost bds-btn-icon"
                        title="删除锁定"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ==================== 信用 Panel ====================

function CreditPanel() {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [ratings, setRatings] = useState<CreditRating[]>([]);
  const [loading, setLoading] = useState(true);
  // R4：加载失败进 error state（横幅 + 重试），不再 console.error 后伪装成「暂无数据」
  const [loadError, setLoadError] = useState<string | null>(null);
  const [relationFilter, setRelationFilter] = useState('');
  const [evaluateRelationId, setEvaluateRelationId] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ frozenCount: number; badDebtCount: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listRelations();
        if (cancelled) return;
        setRelations(list.filter((r) => r.category === 'Customer' && !r.deletedAt));
      } catch (e) {
        console.error('[RisksManager] load customer relations failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadRatings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // 未选客户：取每客户最新一条评级；选中客户：取该客户完整评估历史
      setRatings(await apiService.listCreditRatings(
        relationFilter ? { relationId: relationFilter } : { latestOnly: true },
      ));
    } catch (e: any) {
      console.error('[RisksManager] listCreditRatings failed', e);
      setLoadError(`信用评级加载失败：${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [relationFilter]);

  useEffect(() => {
    loadRatings();
  }, [loadRatings]);

  const relationNameById = useMemo(() => {
    const map = new Map<string, string>();
    relations.forEach((r) => map.set(r.id, r.name));
    return map;
  }, [relations]);

  const handleEvaluate = async () => {
    if (!evaluateRelationId) {
      bdsToast.warning('请选择要评估的客户');
      return;
    }
    setEvaluating(true);
    try {
      await apiService.evaluateCreditRating(evaluateRelationId);
      setEvaluateRelationId('');
      await loadRatings();
      bdsToast.success('信用评估完成');
    } catch (e: any) {
      bdsToast.danger(`信用评估失败：${e?.message || e}`);
    } finally {
      setEvaluating(false);
    }
  };

  const handleScan = async () => {
    if (!(await bdsConfirm({ title: '确认运行信用扫描', body: '确认运行信用扫描？系统将评估所有客户账期，自动冻结超期客户并生成坏账预警（需管理角色权限）。' }))) return;
    setScanning(true);
    setScanResult(null);
    try {
      const result = await apiService.runCreditRiskScan();
      setScanResult(result);
      await loadRatings();
    } catch (e: any) {
      bdsToast.danger(`信用扫描失败：${e?.message || e}`);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-4 pr-1">
      {/* R4：加载失败横幅（重试 = 重新拉取评级） */}
      {loadError && <LoadErrorBanner message={loadError} onRetry={loadRatings} />}
      {/* 操作条 */}
      <div className="bds-card flex items-center gap-2 flex-wrap" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <CustomSelect
          surface="form"
          size="compact"
          className="w-48"
          value={evaluateRelationId}
          onChange={(v) => setEvaluateRelationId(v)}
          options={[
            { value: '', label: '选择客户...' },
            ...relations.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
        <button onClick={handleEvaluate} disabled={evaluating} className={actionBtnCls}>
          {evaluating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gauge className="w-3.5 h-3.5" />}
          评估该客户
        </button>
        <button onClick={handleScan} disabled={scanning} className={actionBtnCls}>
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          运行信用扫描
        </button>
        <button
          onClick={loadRatings}
          className="bds-btn bds-btn-ghost bds-btn-icon"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {scanResult && (
          <span className={`bds-badge sm ${scanResult.frozenCount > 0 || scanResult.badDebtCount > 0 ? 'warning' : 'success'}`}>
            扫描完成：新冻结 {scanResult.frozenCount} 家客户 · 新增坏账预警 {scanResult.badDebtCount} 条
          </span>
        )}
        <CustomSelect
          size="compact"
          className="ml-auto w-56"
          value={relationFilter}
          onChange={(v) => setRelationFilter(v)}
          options={[
            { value: '', label: '全部客户（最新评级）' },
            ...relations.map((r) => ({ value: r.id, label: `${r.name}（评估历史）` })),
          ]}
        />
      </div>

      {/* 评级列表 */}
      <div className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : ratings.length === 0 ? (
          loadError ? null : (
          <div className="bds-empty">
            <div className="glyph"><Gauge size={24} /></div>
            <div className="title">暂无信用评级</div>
            <div className="desc">选择客户后点击「评估该客户」生成首条评级</div>
          </div>
          )
        ) : (
          <table className="bds-table">
            <thead>
              <tr>
                <th>客户</th>
                <th>评级</th>
                <th className="num">评分</th>
                <th>评估因子</th>
                <th>评估时间</th>
                <th>评估人</th>
              </tr>
            </thead>
            <tbody>
              {ratings.map((rating) => (
                <tr key={rating.id}>
                  <td className="max-w-[200px] truncate" title={rating.relationId} style={{ color: 'var(--text-primary)' }}>
                    {relationNameById.get(rating.relationId) ?? rating.relationId}
                  </td>
                  <td>
                    <span className={`bds-badge sm ${GRADE_VARIANT[rating.grade] ?? 'neutral'}`}>
                      {rating.grade} 级
                    </span>
                  </td>
                  <td className="num bds-tnum" style={{ color: 'var(--text-primary)' }}>{formatNumber(rating.score)}</td>
                  <td className="max-w-[320px] truncate text-xs" title={`准时率 ${rating.factors.onTimeRate == null ? '—' : `${Math.round(rating.factors.onTimeRate * 100)}%`} · 逾期 ${rating.factors.overdueCount} 次 · 最长逾期 ${rating.factors.maxDaysOverdue} 天 · 合作 ${rating.factors.cooperationYears} 年 · 已结清 ${rating.factors.settledCount} 单`} style={{ color: 'var(--text-tertiary)' }}>
                    准时率 {rating.factors.onTimeRate == null ? '—' : `${Math.round(rating.factors.onTimeRate * 100)}%`} · 逾期 {rating.factors.overdueCount} 次 · 最长逾期 {rating.factors.maxDaysOverdue} 天 · 合作 {rating.factors.cooperationYears} 年 · 已结清 {rating.factors.settledCount} 单
                  </td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{formatTs(rating.evaluatedAt)}</td>
                  <td className="max-w-[120px] truncate" style={{ color: 'var(--text-tertiary)' }}>{rating.evaluatedBy ?? '系统'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ==================== 合规 Panel ====================

function CompliancePanel() {
  const [checks, setChecks] = useState<ComplianceCheck[]>([]);
  const [loading, setLoading] = useState(true);
  // R4：加载失败进 error state（横幅 + 重试），不再 console.error 后伪装成「暂无数据」
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'' | ComplianceCheckType>('');
  const [resultFilter, setResultFilter] = useState<'' | ComplianceCheckResult>('');

  // M5：合规检查报关单改下拉选择（报关单档案真源，杜绝手打错单号）
  const [declarations, setDeclarations] = useState<CustomsDeclaration[]>([]);

  // HS Code 检查表单
  const [hsDeclarationId, setHsDeclarationId] = useState('');
  const [runningHs, setRunningHs] = useState(false);
  // 出口管制检查表单
  const [ecDeclarationId, setEcDeclarationId] = useState('');
  const [runningEc, setRunningEc] = useState(false);
  // 人工登记原产地规则表单
  const [manualTargetType, setManualTargetType] = useState('CustomsDeclaration');
  const [manualTargetId, setManualTargetId] = useState('');
  const [manualResult, setManualResult] = useState<ComplianceCheckResult>('pass');
  const [manualSummary, setManualSummary] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await apiService.listCustomsDeclarations({ limit: 200 });
        if (cancelled) return;
        setDeclarations(result.items);
      } catch (e) {
        console.error('[RisksManager] load customs declarations failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadChecks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setChecks(await apiService.listComplianceChecks({
        type: typeFilter || undefined,
        result: resultFilter || undefined,
      }));
    } catch (e: any) {
      console.error('[RisksManager] listComplianceChecks failed', e);
      setLoadError(`合规检查记录加载失败：${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, resultFilter]);

  useEffect(() => {
    loadChecks();
  }, [loadChecks]);

  const handleRunHs = async () => {
    if (!hsDeclarationId.trim()) {
      bdsToast.warning('请填写报关单 ID');
      return;
    }
    setRunningHs(true);
    try {
      await apiService.runHsCodeCheck(hsDeclarationId.trim());
      setHsDeclarationId('');
      await loadChecks();
      bdsToast.success('HS Code 检查完成');
    } catch (e: any) {
      bdsToast.danger(`HS Code 检查失败：${e?.message || e}`);
    } finally {
      setRunningHs(false);
    }
  };

  const handleRunEc = async () => {
    if (!ecDeclarationId.trim()) {
      bdsToast.warning('请选择报关单');
      return;
    }
    setRunningEc(true);
    try {
      await apiService.runExportControlCheck(ecDeclarationId.trim());
      setEcDeclarationId('');
      await loadChecks();
      bdsToast.success('出口管制检查完成');
    } catch (e: any) {
      bdsToast.danger(`出口管制检查失败：${e?.message || e}`);
    } finally {
      setRunningEc(false);
    }
  };

  const handleAddManual = async () => {
    if (!manualTargetId.trim() || !manualSummary.trim()) {
      bdsToast.warning('检查对象 ID 与结论摘要必填');
      return;
    }
    setSavingManual(true);
    try {
      await apiService.addComplianceCheck({
        type: 'origin_rule',
        targetType: manualTargetType,
        targetId: manualTargetId.trim(),
        result: manualResult,
        summary: manualSummary.trim(),
      });
      setManualTargetId('');
      setManualSummary('');
      setManualResult('pass');
      await loadChecks();
      bdsToast.success('合规检查已登记');
    } catch (e: any) {
      bdsToast.danger(`登记合规检查失败：${e?.message || e}`);
    } finally {
      setSavingManual(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-4 pr-1">
      {/* R4：加载失败横幅（重试 = 重新拉取检查记录） */}
      {loadError && <LoadErrorBanner message={loadError} onRetry={loadChecks} />}
      {/* 检查触发 */}
      <div className="grid grid-cols-3 gap-4">
        <SectionCard title="运行 HS Code 检查">
          <Field label="报关单 *">
            <CustomSelect
              surface="form"
              value={hsDeclarationId}
              onChange={(v) => setHsDeclarationId(v)}
              options={[
                { value: '', label: '选择报关单...' },
                ...declarations.map((d) => ({
                  value: d.id,
                  label: `${d.declarationNumber}${d.destinationCountry ? `（${d.destinationCountry}）` : ''}`,
                })),
              ]}
            />
          </Field>
          <div className="flex justify-end">
            <button onClick={handleRunHs} disabled={runningHs} className={actionBtnCls}>
              {runningHs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              运行检查
            </button>
          </div>
        </SectionCard>
        <SectionCard title="运行出口管制检查">
          <Field label="报关单 *">
            <CustomSelect
              surface="form"
              value={ecDeclarationId}
              onChange={(v) => setEcDeclarationId(v)}
              options={[
                { value: '', label: '选择报关单...' },
                ...declarations.map((d) => ({
                  value: d.id,
                  label: `${d.declarationNumber}${d.destinationCountry ? `（${d.destinationCountry}）` : ''}`,
                })),
              ]}
            />
          </Field>
          <div className="flex justify-end">
            <button onClick={handleRunEc} disabled={runningEc} className={actionBtnCls}>
              {runningEc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              运行检查
            </button>
          </div>
        </SectionCard>
        <SectionCard title="人工登记（原产地规则）">
          <div className="grid grid-cols-2 gap-2">
            <Field label="对象类型 *">
              <CustomSelect
                surface="form"
                value={manualTargetType}
                onChange={(v) => setManualTargetType(v)}
                options={CHECK_TARGET_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <Field label="结果 *">
              <CustomSelect
                surface="form"
                value={manualResult}
                onChange={(v) => setManualResult(v as ComplianceCheckResult)}
                options={(Object.keys(CHECK_RESULT_LABELS) as ComplianceCheckResult[]).map((r) => ({ value: r, label: CHECK_RESULT_LABELS[r] }))}
              />
            </Field>
          </div>
          <Field label="对象 ID *">
            <input className="bds-input" value={manualTargetId} onChange={(e) => setManualTargetId(e.target.value)} placeholder="如 ORD-... / PA-..." />
          </Field>
          <Field label="结论摘要 *">
            <input className="bds-input" value={manualSummary} onChange={(e) => setManualSummary(e.target.value)} placeholder="如：满足 RCEP 原产地累积规则" />
          </Field>
          <div className="flex justify-end">
            <button onClick={handleAddManual} disabled={savingManual} className={actionBtnCls}>
              {savingManual ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
              登记检查
            </button>
          </div>
        </SectionCard>
      </div>

      {/* 禁运国清单配置（M7：数据库配置真源，政策变更免改代码） */}
      <SanctionedCountriesCard />

      {/* 检查记录 */}
      <div className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-3 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: 'var(--border-subtle)' }}>
          <span className="text-xs w-10 shrink-0" style={{ color: 'var(--text-tertiary)' }}>类型</span>
          <div className="bds-segment flex-wrap">
            {(['', 'hs_code', 'export_control', 'origin_rule'] as const).map((t) => (
              <button
                key={t || 'all'}
                onClick={() => setTypeFilter(t)}
                className={`seg ${typeFilter === t ? 'active' : ''}`}
              >
                {t === '' ? '全部' : CHECK_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <span className="text-xs w-10 shrink-0 ml-3" style={{ color: 'var(--text-tertiary)' }}>结果</span>
          <div className="bds-segment flex-wrap">
            {(['', 'pass', 'warn', 'fail'] as const).map((r) => (
              <button
                key={r || 'all'}
                onClick={() => setResultFilter(r)}
                className={`seg ${resultFilter === r ? 'active' : ''}`}
              >
                {r === '' ? '全部' : CHECK_RESULT_LABELS[r]}
              </button>
            ))}
          </div>
          <button
            onClick={loadChecks}
            className="bds-btn bds-btn-ghost bds-btn-icon ml-auto"
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : checks.length === 0 ? (
          loadError ? null : (
          <div className="bds-empty">
            <div className="glyph"><ClipboardCheck size={24} /></div>
            <div className="title">暂无合规检查记录</div>
            <div className="desc">可在上方触发自动检查或人工登记</div>
          </div>
          )
        ) : (
          <table className="bds-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>结果</th>
                <th>结论摘要</th>
                <th>检查对象</th>
                <th>检查时间</th>
                <th>检查人</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.id}>
                  <td style={{ color: 'var(--text-secondary)' }}>{CHECK_TYPE_LABELS[check.type] || check.type}</td>
                  <td>
                    <span className={`bds-badge sm ${CHECK_RESULT_VARIANT[check.result] ?? 'neutral'}`}>
                      {CHECK_RESULT_LABELS[check.result] || check.result}
                    </span>
                  </td>
                  <td className="max-w-[280px] truncate" title={check.summary} style={{ color: 'var(--text-primary)' }}>{check.summary}</td>
                  <td className="max-w-[200px] truncate text-xs" title={`${check.targetType} ${check.targetId}`} style={{ color: 'var(--text-tertiary)' }}>
                    {check.targetType} {check.targetId}
                  </td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{formatTs(check.checkedAt)}</td>
                  <td className="max-w-[120px] truncate" style={{ color: 'var(--text-tertiary)' }}>{check.checkedById ?? '系统'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* R3 诚实化：数据源当前仅支持服务端默认窗口（50 条），达窗口上限时披露截断并引导筛选。
            R678：服务端 listComplianceChecks 已补 limit/offset 真分页（riskRoute 透传 + total 真源），
            前端 apiService.listComplianceChecks 的 {limit, offset} 补参在途（库存车道）——落地后此处接「加载更多」替换本提示 */}
        {!loading && !loadError && checks.length >= 50 && (
          <div className="px-4 py-2 text-xs" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
            当前为服务端默认最近 50 条窗口，更早记录请用上方类型/结果筛选缩小范围
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 禁运国清单配置 Card（M7） ====================

function SanctionedCountriesCard() {
  const [items, setItems] = useState<string[]>([]);
  const [source, setSource] = useState<'config' | 'default'>('default');
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiService.getSanctionedCountries();
      setItems(result.items);
      setSource(result.source);
      setDirty(false);
    } catch (e) {
      console.error('[RisksManager] getSanctionedCountries failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = () => {
    const v = newItem.trim();
    if (!v) return;
    if (items.some((i) => i.toLowerCase() === v.toLowerCase())) {
      bdsToast.warning('该条目已在清单中');
      return;
    }
    setItems([...items, v]);
    setNewItem('');
    setDirty(true);
  };

  const handleRemove = (item: string) => {
    setItems(items.filter((i) => i !== item));
    setDirty(true);
  };

  const handleSave = async () => {
    if (items.length === 0) {
      bdsToast.warning('禁运国清单不能为空');
      return;
    }
    setSaving(true);
    try {
      const result = await apiService.updateSanctionedCountries(items, reason.trim() || undefined);
      setItems(result.items);
      setSource(result.source);
      setReason('');
      setDirty(false);
      bdsToast.success('禁运国清单已保存，出口管制检查即时生效');
    } catch (e: any) {
      bdsToast.danger(`保存禁运国清单失败：${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="禁运国清单配置（出口管制）"
      extra={
        <span className={`bds-badge sm ${source === 'config' ? 'info' : 'neutral'}`}>
          {source === 'config' ? '数据库配置' : '内置默认（保存后转为配置）'}
        </span>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {items.map((item) => (
              <span key={item} className="bds-badge sm neutral flex items-center gap-1">
                {item}
                <button
                  onClick={() => handleRemove(item)}
                  className="bds-btn bds-btn-ghost bds-btn-icon"
                  title={`移除 ${item}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
            {items.length === 0 && (
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>清单为空，请先添加条目</span>
            )}
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <Field label="新增条目（ISO 两位码或国名）">
              <input
                className="bds-input"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                placeholder="如 KP / North Korea"
              />
            </Field>
            <Field label="变更理由（可选，留痕审计）">
              <input
                className="bds-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：政策更新新增禁运国"
              />
            </Field>
            <div className="flex items-center gap-1.5 mb-3">
              <button onClick={handleAdd} className={actionBtnCls}>
                <Plus className="w-3.5 h-3.5" />
                添加
              </button>
              <button onClick={handleSave} disabled={saving || !dirty} className={actionBtnCls}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                保存清单
              </button>
            </div>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            目的国与任一条目精确匹配（大小写不敏感）即判定命中禁运；保存后立即作用于出口管制检查。
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ==================== 质量 Panel ====================

function QualityPanel() {
  const [groupBy, setGroupBy] = useState<'factory' | 'quarter'>('factory');
  const [trends, setTrends] = useState<DefectTrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  // R4：加载失败进 error state（横幅 + 重试），不再 console.error 后伪装成「暂无数据」
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<number | null>(null);

  const loadTrends = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setTrends(await apiService.getDefectTrends(groupBy));
    } catch (e: any) {
      console.error('[RisksManager] getDefectTrends failed', e);
      setLoadError(`疵点趋势加载失败：${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [groupBy]);

  useEffect(() => {
    loadTrends();
  }, [loadTrends]);

  const handleScan = async () => {
    if (!(await bdsConfirm({ title: '确认运行质量扫描', body: '确认运行重复质量问题扫描？系统将对反复出现的疵点生成质量预警。' }))) return;
    setScanning(true);
    setScanResult(null);
    try {
      const result = await apiService.runQualityRepeatScan();
      setScanResult(result.alerted);
    } catch (e: any) {
      bdsToast.danger(`重复问题扫描失败：${e?.message || e}`);
    } finally {
      setScanning(false);
    }
  };

  const stickyThStyle: React.CSSProperties = { position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 };

  return (
    <div className="h-full flex flex-col min-h-0 gap-4">
      {/* R4：加载失败横幅（重试 = 重新拉取趋势） */}
      {loadError && <LoadErrorBanner message={loadError} onRetry={loadTrends} />}
      {/* 操作条 */}
      <div className="bds-card shrink-0 flex items-center gap-2 flex-wrap" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <span className="text-xs shrink-0" style={{ color: 'var(--text-tertiary)' }}>分组</span>
        <div className="bds-segment">
          {(['factory', 'quarter'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`seg ${groupBy === g ? 'active' : ''}`}
            >
              {g === 'factory' ? '按工厂' : '按季度'}
            </button>
          ))}
        </div>
        <button onClick={handleScan} disabled={scanning} className={actionBtnCls}>
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          运行重复问题扫描
        </button>
        <button
          onClick={loadTrends}
          className="bds-btn bds-btn-ghost bds-btn-icon"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {scanResult !== null && (
          <span className={`bds-badge sm ${scanResult > 0 ? 'warning' : 'success'}`}>
            扫描完成：新增 {scanResult} 条重复质量预警
          </span>
        )}
      </div>

      {/* 趋势表格 */}
      <div className="bds-card flex-1 min-h-0 flex flex-col" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : trends.length === 0 ? (
          loadError ? null : (
          <div className="bds-empty flex-1 justify-center">
            <div className="glyph"><ShieldCheck size={24} /></div>
            <div className="title">暂无疵点趋势数据</div>
            <div className="desc">验货报告积累后自动聚合</div>
          </div>
          )
        ) : (
          <div className="flex-1 overflow-y-auto">
            <table className="bds-table">
              <thead>
                <tr>
                  <th style={stickyThStyle}>{groupBy === 'factory' ? '工厂' : '季度'}</th>
                  <th className="num" style={stickyThStyle}>验货报告</th>
                  <th className="num" style={stickyThStyle}>不合格</th>
                  <th className="num" style={stickyThStyle}>严重疵点</th>
                  <th className="num" style={stickyThStyle}>主要疵点</th>
                  <th className="num" style={stickyThStyle}>轻微疵点</th>
                  <th style={stickyThStyle}>高频疵点</th>
                </tr>
              </thead>
              <tbody>
                {trends.map((item) => {
                  // M2：字段对齐后端（factory 组=factoryLabel，quarter 组=quarter）
                  const rowLabel = item.factoryLabel ?? item.quarter ?? '—';
                  return (
                  <tr key={rowLabel}>
                    <td className="max-w-[180px] truncate" style={{ color: 'var(--text-primary)' }}>{rowLabel}</td>
                    <td className="num bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatNumber(item.reports)}</td>
                    <td className="num bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatNumber(item.failCount)}</td>
                    <td className="num bds-tnum" style={{ color: item.criticalDefects > 0 ? 'var(--danger-text)' : 'var(--text-tertiary)' }}>{formatNumber(item.criticalDefects)}</td>
                    <td className="num bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatNumber(item.majorDefects)}</td>
                    <td className="num bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatNumber(item.minorDefects)}</td>
                    <td>
                      <span className="flex items-center gap-1 flex-wrap">
                        {item.defectKeywords.length === 0 ? (
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>—</span>
                        ) : (
                          item.defectKeywords.slice(0, 5).map((kw) => (
                            <span key={kw.keyword} className="bds-badge sm info">
                              {kw.keyword} ×{kw.count}
                            </span>
                          ))
                        )}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 text-xs" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          共 {trends.length} 个分组
        </div>
      </div>
    </div>
  );
}
