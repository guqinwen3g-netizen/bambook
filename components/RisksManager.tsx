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
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Relation,
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
};

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
const selectSmStyle: React.CSSProperties = { height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)', width: 'auto' };

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
  const [typeFilter, setTypeFilter] = useState<'' | RiskAlertType>('');
  const [levelFilter, setLevelFilter] = useState<'' | RiskAlertLevel>('');
  const [statusFilter, setStatusFilter] = useState<'' | RiskAlertStatus>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await apiService.getRiskOverview());
    } catch (e) {
      console.error('[RisksManager] loadRiskOverview failed', e);
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiService.listRiskAlerts({
        type: typeFilter || undefined,
        level: levelFilter || undefined,
        status: statusFilter || undefined,
        limit: 200,
      });
      setAlerts(result.items);
      setTotal(result.total);
    } catch (e) {
      console.error('[RisksManager] listRiskAlerts failed', e);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, levelFilter, statusFilter]);

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
    } catch (e: any) {
      alert(`更新预警状态失败：${e?.message || e}`);
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
      {/* 总览统计条 */}
      <div className="bds-card shrink-0 flex items-center gap-3 flex-wrap" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <span className="text-xs shrink-0" style={{ color: 'var(--text-tertiary)' }}>未结预警</span>
        {(['critical', 'warning', 'info'] as RiskAlertLevel[]).map((level) => (
          <span key={level} className={`bds-badge sm ${ALERT_LEVEL_VARIANT[level]}`}>
            {ALERT_LEVEL_LABELS[level]} {overview?.openByLevel?.[level] ?? 0}
          </span>
        ))}
        <span className="ml-auto text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
          {openByTypeEntries.length > 0
            ? openByTypeEntries.map(([type, count]) => `${ALERT_TYPE_LABELS[type as RiskAlertType] ?? type} ${count}`).join(' · ')
            : '各类型暂无未结预警'}
        </span>
      </div>

      {/* 过滤 + 列表 */}
      <div className="bds-card flex-1 min-h-0 flex flex-col" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-3 space-y-2" style={{ borderBottom: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] w-10 shrink-0" style={{ color: 'var(--text-tertiary)' }}>类型</span>
            <div className="bds-segment flex-wrap">
              {(['', 'fx_volatility', 'credit_frozen', 'bad_debt', 'compliance_fail', 'quality_repeat', 'sample_deadline'] as const).map((t) => (
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
            <span className="text-[11px] w-10 shrink-0" style={{ color: 'var(--text-tertiary)' }}>等级</span>
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
            <span className="text-[11px] w-10 shrink-0" style={{ color: 'var(--text-tertiary)' }}>状态</span>
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
            <div className="bds-empty">
              <div className="glyph"><BellRing size={24} /></div>
              <div className="title">暂无匹配的风险预警</div>
            </div>
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
                <div className="mt-2 flex items-center gap-3 text-[11px] flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
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
        <div className="px-4 py-2 text-[11px]" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          共 {total} 条预警
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

  const loadLatest = useCallback(async () => {
    try {
      setLatest(await apiService.getLatestFxRates());
    } catch (e) {
      console.error('[RisksManager] getLatestFxRates failed', e);
    }
  }, []);

  const loadRates = useCallback(async () => {
    setLoadingRates(true);
    try {
      setRates(await apiService.listExchangeRates({ currency: currencyFilter || undefined, limit: 100 }));
    } catch (e) {
      console.error('[RisksManager] listExchangeRates failed', e);
    } finally {
      setLoadingRates(false);
    }
  }, [currencyFilter]);

  const loadLocks = useCallback(async () => {
    setLoadingLocks(true);
    try {
      setLocks(await apiService.listFxLocks());
    } catch (e) {
      console.error('[RisksManager] listFxLocks failed', e);
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
      alert('请填写币种与大于 0 的汇率');
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
    } catch (e: any) {
      alert(`录入汇率失败：${e?.message || e}`);
    } finally {
      setSavingRate(false);
    }
  };

  const handleLock = async () => {
    if (!lockOrderId.trim()) {
      alert('请填写订单号');
      return;
    }
    if (lockRate && !(Number(lockRate) > 0)) {
      alert('锁定汇率需大于 0，或留空取最新汇率');
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
    } catch (e: any) {
      alert(`新建汇率锁定失败：${e?.message || e}`);
    } finally {
      setSavingLock(false);
    }
  };

  const handleDeleteLock = async (lock: FxRateLock) => {
    if (!confirm(`确认删除订单「${lock.orderId}」的 ${lock.currency} 汇率锁定？`)) return;
    try {
      await apiService.deleteFxLock(lock.id);
      await loadLocks();
    } catch (e: any) {
      alert(`删除锁定失败：${e?.message || e}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-4 pr-1">
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
              <div key={item.currency} className="rounded-inset p-3" style={{ background: 'var(--bg-panel)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-base" style={{ color: 'var(--text-primary)' }}>{item.currency}</span>
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>{item.source}</span>
                </div>
                <div className="bds-tnum mt-1 text-lg" style={{ color: 'var(--text-primary)' }}>{formatRate(item.rate)}</div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>生效 {formatDate(item.effectiveDate)}</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 录入汇率 */}
      <SectionCard title="录入汇率">
        <div className="grid grid-cols-4 gap-3 items-end">
          <Field label="币种 *">
            <select className="bds-select" value={rateCurrency} onChange={(e) => setRateCurrency(e.target.value)}>
              {FX_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="汇率（兑 CNY）*">
            <input type="number" min={0} step="0.0001" className="bds-input" value={rateValue} onChange={(e) => setRateValue(e.target.value)} placeholder="如 7.1234" />
          </Field>
          <Field label="生效日期">
            <input type="date" className="bds-input" value={rateDate} onChange={(e) => setRateDate(e.target.value)} />
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
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
            className="bds-select"
            style={selectSmStyle}
          >
            <option value="">全部币种</option>
            {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
          <div className="rounded-inset overflow-hidden" style={{ background: 'var(--bg-panel)' }}>
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
          <Field label="订单号 *">
            <input className="bds-input" value={lockOrderId} onChange={(e) => setLockOrderId(e.target.value)} placeholder="如 SO-2026-0001" />
          </Field>
          <Field label="币种 *">
            <select className="bds-select" value={lockCurrency} onChange={(e) => setLockCurrency(e.target.value)}>
              {FX_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
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
        <div className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>锁定汇率留空时将自动取该币种最新有效汇率。</div>
        {loadingLocks ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : locks.length === 0 ? (
          <div className="bds-empty">
            <div className="glyph"><Lock size={24} /></div>
            <div className="title">暂无汇率锁定</div>
            <div className="desc">大额订单建议在报价阶段锁定汇率</div>
          </div>
        ) : (
          <div className="rounded-inset overflow-hidden" style={{ background: 'var(--bg-panel)' }}>
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
    try {
      // 未选客户：取每客户最新一条评级；选中客户：取该客户完整评估历史
      setRatings(await apiService.listCreditRatings(
        relationFilter ? { relationId: relationFilter } : { latestOnly: true },
      ));
    } catch (e) {
      console.error('[RisksManager] listCreditRatings failed', e);
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
      alert('请选择要评估的客户');
      return;
    }
    setEvaluating(true);
    try {
      await apiService.evaluateCreditRating(evaluateRelationId);
      setEvaluateRelationId('');
      await loadRatings();
    } catch (e: any) {
      alert(`信用评估失败：${e?.message || e}`);
    } finally {
      setEvaluating(false);
    }
  };

  const handleScan = async () => {
    if (!confirm('确认运行信用扫描？系统将评估所有客户账期，自动冻结超期客户并生成坏账预警（需管理角色权限）。')) return;
    setScanning(true);
    setScanResult(null);
    try {
      const result = await apiService.runCreditRiskScan();
      setScanResult(result);
      await loadRatings();
    } catch (e: any) {
      alert(`信用扫描失败：${e?.message || e}`);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-4 pr-1">
      {/* 操作条 */}
      <div className="bds-card flex items-center gap-2 flex-wrap" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <select
          value={evaluateRelationId}
          onChange={(e) => setEvaluateRelationId(e.target.value)}
          className="bds-select"
          style={selectSmStyle}
        >
          <option value="">选择客户...</option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
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
        <select
          value={relationFilter}
          onChange={(e) => setRelationFilter(e.target.value)}
          className="bds-select ml-auto"
          style={selectSmStyle}
        >
          <option value="">全部客户（最新评级）</option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>{r.name}（评估历史）</option>
          ))}
        </select>
      </div>

      {/* 评级列表 */}
      <div className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : ratings.length === 0 ? (
          <div className="bds-empty">
            <div className="glyph"><Gauge size={24} /></div>
            <div className="title">暂无信用评级</div>
            <div className="desc">选择客户后点击「评估该客户」生成首条评级</div>
          </div>
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
                  <td className="max-w-[320px] truncate text-[11px]" title={`准时率 ${rating.factors.onTimeRate == null ? '—' : `${Math.round(rating.factors.onTimeRate * 100)}%`} · 逾期 ${rating.factors.overdueCount} 次 · 最长逾期 ${rating.factors.maxDaysOverdue} 天 · 合作 ${rating.factors.cooperationYears} 年 · 已结清 ${rating.factors.settledCount} 单`} style={{ color: 'var(--text-tertiary)' }}>
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
  const [typeFilter, setTypeFilter] = useState<'' | ComplianceCheckType>('');
  const [resultFilter, setResultFilter] = useState<'' | ComplianceCheckResult>('');

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

  const loadChecks = useCallback(async () => {
    setLoading(true);
    try {
      setChecks(await apiService.listComplianceChecks({
        type: typeFilter || undefined,
        result: resultFilter || undefined,
      }));
    } catch (e) {
      console.error('[RisksManager] listComplianceChecks failed', e);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, resultFilter]);

  useEffect(() => {
    loadChecks();
  }, [loadChecks]);

  const handleRunHs = async () => {
    if (!hsDeclarationId.trim()) {
      alert('请填写报关单 ID');
      return;
    }
    setRunningHs(true);
    try {
      await apiService.runHsCodeCheck(hsDeclarationId.trim());
      setHsDeclarationId('');
      await loadChecks();
    } catch (e: any) {
      alert(`HS Code 检查失败：${e?.message || e}`);
    } finally {
      setRunningHs(false);
    }
  };

  const handleRunEc = async () => {
    if (!ecDeclarationId.trim()) {
      alert('请填写报关单 ID');
      return;
    }
    setRunningEc(true);
    try {
      await apiService.runExportControlCheck(ecDeclarationId.trim());
      setEcDeclarationId('');
      await loadChecks();
    } catch (e: any) {
      alert(`出口管制检查失败：${e?.message || e}`);
    } finally {
      setRunningEc(false);
    }
  };

  const handleAddManual = async () => {
    if (!manualTargetId.trim() || !manualSummary.trim()) {
      alert('检查对象 ID 与结论摘要必填');
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
    } catch (e: any) {
      alert(`登记合规检查失败：${e?.message || e}`);
    } finally {
      setSavingManual(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-4 pr-1">
      {/* 检查触发 */}
      <div className="grid grid-cols-3 gap-4">
        <SectionCard title="运行 HS Code 检查">
          <Field label="报关单 ID *">
            <input className="bds-input" value={hsDeclarationId} onChange={(e) => setHsDeclarationId(e.target.value)} placeholder="如 CD-2026-0001" />
          </Field>
          <div className="flex justify-end">
            <button onClick={handleRunHs} disabled={runningHs} className={actionBtnCls}>
              {runningHs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              运行检查
            </button>
          </div>
        </SectionCard>
        <SectionCard title="运行出口管制检查">
          <Field label="报关单 ID *">
            <input className="bds-input" value={ecDeclarationId} onChange={(e) => setEcDeclarationId(e.target.value)} placeholder="如 CD-2026-0001" />
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
              <select className="bds-select" value={manualTargetType} onChange={(e) => setManualTargetType(e.target.value)}>
                {CHECK_TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="结果 *">
              <select className="bds-select" value={manualResult} onChange={(e) => setManualResult(e.target.value as ComplianceCheckResult)}>
                {(Object.keys(CHECK_RESULT_LABELS) as ComplianceCheckResult[]).map((r) => (
                  <option key={r} value={r}>{CHECK_RESULT_LABELS[r]}</option>
                ))}
              </select>
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

      {/* 检查记录 */}
      <div className="bds-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-3 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: 'var(--border-subtle)' }}>
          <span className="text-[11px] w-10 shrink-0" style={{ color: 'var(--text-tertiary)' }}>类型</span>
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
          <span className="text-[11px] w-10 shrink-0 ml-3" style={{ color: 'var(--text-tertiary)' }}>结果</span>
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
          <div className="bds-empty">
            <div className="glyph"><ClipboardCheck size={24} /></div>
            <div className="title">暂无合规检查记录</div>
            <div className="desc">可在上方触发自动检查或人工登记</div>
          </div>
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
                  <td className="max-w-[200px] truncate text-[11px]" title={`${check.targetType} ${check.targetId}`} style={{ color: 'var(--text-tertiary)' }}>
                    {check.targetType} {check.targetId}
                  </td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{formatTs(check.checkedAt)}</td>
                  <td className="max-w-[120px] truncate" style={{ color: 'var(--text-tertiary)' }}>{check.checkedById ?? '系统'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ==================== 质量 Panel ====================

function QualityPanel() {
  const [groupBy, setGroupBy] = useState<'factory' | 'quarter'>('factory');
  const [trends, setTrends] = useState<DefectTrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<number | null>(null);

  const loadTrends = useCallback(async () => {
    setLoading(true);
    try {
      setTrends(await apiService.getDefectTrends(groupBy));
    } catch (e) {
      console.error('[RisksManager] getDefectTrends failed', e);
    } finally {
      setLoading(false);
    }
  }, [groupBy]);

  useEffect(() => {
    loadTrends();
  }, [loadTrends]);

  const handleScan = async () => {
    if (!confirm('确认运行重复质量问题扫描？系统将对反复出现的疵点生成质量预警。')) return;
    setScanning(true);
    setScanResult(null);
    try {
      const result = await apiService.runQualityRepeatScan();
      setScanResult(result.alerted);
    } catch (e: any) {
      alert(`重复问题扫描失败：${e?.message || e}`);
    } finally {
      setScanning(false);
    }
  };

  const stickyThStyle: React.CSSProperties = { position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 };

  return (
    <div className="h-full flex flex-col min-h-0 gap-4">
      {/* 操作条 */}
      <div className="bds-card shrink-0 flex items-center gap-2 flex-wrap" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <span className="text-[11px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>分组</span>
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
          <div className="bds-empty flex-1 justify-center">
            <div className="glyph"><ShieldCheck size={24} /></div>
            <div className="title">暂无疵点趋势数据</div>
            <div className="desc">验货报告积累后自动聚合</div>
          </div>
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
                {trends.map((item) => (
                  <tr key={item.key}>
                    <td className="max-w-[180px] truncate" style={{ color: 'var(--text-primary)' }}>{item.key}</td>
                    <td className="num bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatNumber(item.reports)}</td>
                    <td className="num bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatNumber(item.failCount)}</td>
                    <td className="num bds-tnum" style={{ color: item.criticalDefects > 0 ? 'var(--danger-text)' : 'var(--text-tertiary)' }}>{formatNumber(item.criticalDefects)}</td>
                    <td className="num bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatNumber(item.majorDefects)}</td>
                    <td className="num bds-tnum" style={{ color: 'var(--text-secondary)' }}>{formatNumber(item.minorDefects)}</td>
                    <td>
                      <span className="flex items-center gap-1 flex-wrap">
                        {item.defectKeywords.length === 0 ? (
                          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>—</span>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 text-[11px]" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          共 {trends.length} 个分组
        </div>
      </div>
    </div>
  );
}
