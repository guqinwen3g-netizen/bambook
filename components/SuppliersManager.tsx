/**
 * 供应商管理 SuppliersManager
 * 阶段 H H1b：供应商管理前端（PRD 13 / 19.18）
 *
 * 功能：
 *   1. 工厂排名列表 — 搜索 / 排序（质量/交期/订单/金额）/ 黑名单筛选
 *   2. 工厂 360° Tabs — 总览 / 评分记录 / 认证管理 / 产能日历
 *   3. 黑名单管理 — 拉黑/解除（owner/admin/manager，服务端强制）
 *   4. 认证预警 — 30 天内到期认证顶部横幅 + 有效期色阶
 *   5. 产能日历 — 月计划产能 upsert + 在手采购单占用实时聚合可视化
 *
 * 设计原则：
 *   - 身份真源在 Relation（category=Supplier 组织），FactoryProfile 1:1 承载工厂属性
 *   - 评分为服务端事务内重算缓存，前端只读展示 + 追加明细
 *   - BDS v2.1：bds 组件类 + 语义 token，主题透明（无 isDarkMode 样式分支），无阴影，大圆角
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  X,
  Building2,
  Star,
  ShieldCheck,
  ShieldAlert,
  CalendarRange,
  TimerReset,
  Ban,
  CircleCheck,
  Pencil,
  AlertTriangle,
  AlertCircle,
  Award,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Relation,
  View,
  FactoryProfile,
  FactoryProfileInput,
  FactoryProfilePatch,
  FactoryEvaluation,
  FactoryEvaluationInput,
  FactoryEvaluationKind,
  FactoryCertification,
  FactoryCertificationInput,
  FactoryCapacity,
  FactoryPriceLevel,
  TcCertificateRow,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';
import { StatusSemantic } from './rdlBusinessStatusTokens';
import { RelatedWorkspacesSection } from './ui/RelatedWorkspacesSection';
import { FactoryDelayPanel } from './suppliers/FactoryDelayPanel';
import { primeRelationsOrgDetailPreview } from './RelationsManager';

// ==================== 跨模块落点（阶段 IA 全局收编） ====================

const SUPPLIERS_PREVIEW_STATE_KEY = 'bambook_suppliers_preview_state';

type SuppliersPreviewState = { relationId?: string | null };

const readSuppliersPreviewState = (): SuppliersPreviewState => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(SUPPLIERS_PREVIEW_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SuppliersPreviewState;
    return { relationId: typeof parsed.relationId === 'string' ? parsed.relationId : null };
  } catch {
    return {};
  }
};

const clearSuppliersPreviewState = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SUPPLIERS_PREVIEW_STATE_KEY);
  } catch {
    // 落点连续性仅作增强；存储失败忽略。
  }
};

/**
 * 阶段 IA 全局收编：关系智库 → 供应商管理跨模块跳转。
 * 调用方在触发视图切换（onNavigate(View.Suppliers)）前调用，
 * SuppliersManager 挂载时按 relationId 解析对应工厂档案并选中（含黑名单工厂）。
 */
export const primeSuppliersFactoryPreview = (relationId: string) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SUPPLIERS_PREVIEW_STATE_KEY, JSON.stringify({ relationId } satisfies SuppliersPreviewState));
  } catch {
    // 落点连续性仅作增强；存储失败忽略。
  }
};

// ==================== 常量 ====================

type SupplierTab = 'overview' | 'evaluations' | 'certifications' | 'capacity' | 'delays';

const TABS: Array<{ id: SupplierTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: '总览', icon: Building2 },
  { id: 'evaluations', label: '评分记录', icon: Star },
  { id: 'certifications', label: '认证管理', icon: ShieldCheck },
  { id: 'capacity', label: '产能日历', icon: CalendarRange },
  { id: 'delays', label: '延迟影响', icon: TimerReset },
];

const SORT_OPTIONS = [
  { id: 'quality', label: '质量分优先' },
  { id: 'delivery', label: '交期分优先' },
  { id: 'orders', label: '订单数优先' },
  { id: 'amount', label: '金额优先' },
];

const FILTER_OPTIONS = [
  { id: 'active', label: '正常' },
  { id: 'blacklisted', label: '已拉黑' },
  { id: 'all', label: '全部' },
] as const;

type FilterId = (typeof FILTER_OPTIONS)[number]['id'];

const PRICE_LEVELS: Array<{ id: FactoryPriceLevel; label: string }> = [
  { id: 'High', label: '高' },
  { id: 'Mid', label: '中' },
  { id: 'Low', label: '低' },
];

const PRICE_LEVEL_LABELS: Record<string, string> = { High: '高价位', Mid: '中价位', Low: '低价位' };

const EVALUATION_KIND_LABELS: Record<FactoryEvaluationKind, string> = {
  inspection: '验货',
  delivery: '交期',
};

const CERT_TYPES = ['BSCI', 'SEDEX', 'WRAP', 'ISO9001', 'ISO14001', 'OEKO-TEX', 'GRS', 'OCS', '其他'];

const CAPACITY_UNITS = [
  { id: 'PC', label: 'PC（件）' },
  { id: 'M', label: 'M（米）' },
];

const EXPIRING_DAYS = 30;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return dateStr;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/** 分数 → 语义色阶（>=80 优 / >=60 中 / <60 差） */
function scoreSemantic(score: number): StatusSemantic {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'danger';
}

/** 认证有效期 → 剩余天数（null = 长期有效返回 null） */
function certDaysLeft(validUntil: string | null | undefined): number | null {
  if (!validUntil) return null;
  const target = new Date(validUntil + 'T00:00:00').getTime();
  if (Number.isNaN(target)) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

function certSemantic(daysLeft: number | null): StatusSemantic {
  if (daysLeft === null) return 'neutral';
  if (daysLeft < 0) return 'danger';
  if (daysLeft <= EXPIRING_DAYS) return 'warning';
  return 'success';
}

// ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──

/** StatusSemantic → tint/text token 样式（分数卡等非 badge 结构共用；badge 直接用语义同名变体类） */
const SEMANTIC_TINT_STYLE: Record<string, React.CSSProperties> = {
  neutral: { background: 'var(--recessed-bg)', color: 'var(--text-secondary)' },
  info: { background: 'var(--accent-tint)', color: 'var(--accent-text)' },
  success: { background: 'var(--success-tint)', color: 'var(--success-text)' },
  warning: { background: 'var(--warning-tint)', color: 'var(--warning-text)' },
  danger: { background: 'var(--danger-tint)', color: 'var(--danger-text)' },
};

/** 评分类型 → bds-badge 语义变体（原 active 归并 neutral） */
const EVALUATION_KIND_BADGE_VARIANT: Record<FactoryEvaluationKind, 'info' | 'neutral'> = {
  inspection: 'info',
  delivery: 'neutral',
};

// ==================== 组件 Props ====================

interface SuppliersManagerProps {
  isDarkMode?: boolean;
  /** 跨模块导航（详情头部「关系档案」直达关系智库组织详情） */
  onNavigate?: (view: View) => void;
}

// ==================== 主组件 ====================

export default function SuppliersManager({ isDarkMode, onNavigate }: SuppliersManagerProps) {
  const [activeTab, setActiveTab] = useState<SupplierTab>('overview');
  const [profiles, setProfiles] = useState<FactoryProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('quality');
  const [filter, setFilter] = useState<FilterId>('active');

  // ── 跨模块落点解析：关系智库供应商组织 → 对应工厂档案 ──
  const [primedRelationId, setPrimedRelationId] = useState<string | null>(
    () => readSuppliersPreviewState().relationId ?? null,
  );

  useEffect(() => {
    if (!primedRelationId) return;
    let cancelled = false;
    void apiService.listFactoryProfiles({ limit: 500 })
      .then((result) => {
        if (cancelled) return;
        const hit = result.items.find((p) => p.relationId === primedRelationId);
        if (hit) {
          // 黑名单工厂不在默认「正常」过滤内，切「全部」保证落点可见
          setFilter('all');
          setSearch('');
          setActiveTab('overview');
          setSelectedId(hit.id);
        }
        clearSuppliersPreviewState();
        setPrimedRelationId(null);
      })
      .catch(() => {
        clearSuppliersPreviewState();
        setPrimedRelationId(null);
      });
    return () => { cancelled = true; };
  }, [primedRelationId]);

  // 选中工厂数据
  const [detail, setDetail] = useState<FactoryProfile | null>(null);
  const [evaluations, setEvaluations] = useState<FactoryEvaluation[]>([]);
  const [certifications, setCertifications] = useState<FactoryCertification[]>([]);
  const [capacity, setCapacity] = useState<FactoryCapacity[]>([]);

  // 认证预警
  const [expiringCerts, setExpiringCerts] = useState<FactoryCertification[]>([]);
  const [showExpiringPanel, setShowExpiringPanel] = useState(false);

  // 弹窗状态
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<FactoryProfile | null>(null);
  const [showEvaluationForm, setShowEvaluationForm] = useState(false);
  const [showCertForm, setShowCertForm] = useState(false);
  const [editingCert, setEditingCert] = useState<FactoryCertification | null>(null);
  const [showCapacityForm, setShowCapacityForm] = useState(false);
  const [editingCapacityMonth, setEditingCapacityMonth] = useState<FactoryCapacity | null>(null);
  const [blacklistTarget, setBlacklistTarget] = useState<FactoryProfile | null>(null);

  // ── 加载档案列表 ──
  const loadProfiles = useCallback(async (offset = 0) => {
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    setListError(null);
    try {
      const result = await apiService.listFactoryProfiles({
        search: search || undefined,
        sort,
        blacklisted: filter === 'all' ? undefined : filter === 'blacklisted',
        limit: 100,
        offset,
      });
      setProfiles(prev => (offset > 0 ? [...prev, ...result.items] : result.items));
      setTotal(result.total);
      if (offset === 0 && !selectedId && result.items.length > 0) {
        setSelectedId(result.items[0].id);
      }
    } catch (e: any) {
      console.error('[SuppliersManager] loadProfiles failed', e);
      setListError(`工厂档案加载失败：${e?.message || e}`);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, sort, filter, selectedId]);

  useEffect(() => {
    const timer = setTimeout(() => { loadProfiles(); }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadProfiles, search]);

  // ── 加载认证预警 ──
  const loadExpiring = useCallback(async () => {
    try {
      const items = await apiService.listExpiringCertifications(EXPIRING_DAYS);
      setExpiringCerts(items);
    } catch (e) {
      console.error('[SuppliersManager] loadExpiring failed', e);
    }
  }, []);

  useEffect(() => {
    loadExpiring();
  }, [loadExpiring]);

  // ── 加载选中工厂 360° 数据 ──
  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const overview = await apiService.getFactoryOverview(selectedId);
      if (overview) {
        setDetail(overview.profile);
        setEvaluations(overview.evaluations);
        setCertifications(overview.certifications);
        setCapacity(overview.capacity);
      } else {
        setDetail(null);
      }
    } catch (e: any) {
      console.error('[SuppliersManager] loadDetail failed', e);
      setDetailError(`工厂 360° 详情加载失败：${e?.message || e}`);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadProfiles(), loadDetail(), loadExpiring()]);
  }, [loadProfiles, loadDetail, loadExpiring]);

  // ══════════════════════════════════════════════════════════════
  // 档案操作
  // ══════════════════════════════════════════════════════════════

  const handleSaveProfile = async (input: FactoryProfileInput | FactoryProfilePatch, id?: string) => {
    try {
      if (id) {
        await apiService.updateFactoryProfile(id, input as FactoryProfilePatch);
      } else {
        await apiService.createFactoryProfile(input as FactoryProfileInput);
      }
      setShowProfileForm(false);
      setEditingProfile(null);
      await refreshAll();
    } catch (e: any) {
      bdsToast.danger(`保存工厂档案失败：${e?.message || e}`);
    }
  };

  const handleDeleteProfile = async (profile: FactoryProfile) => {
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除工厂档案「${profile.relation?.name || profile.id}」？（软删除，可联系管理员恢复）`, danger: true }))) return;
    try {
      await apiService.deleteFactoryProfile(profile.id);
      if (selectedId === profile.id) setSelectedId(null);
      await refreshAll();
    } catch (e: any) {
      bdsToast.danger(`删除失败：${e?.message || e}`);
    }
  };

  const handleBlacklist = async (reason: string) => {
    if (!blacklistTarget) return;
    try {
      await apiService.blacklistFactory(blacklistTarget.id, reason);
      setBlacklistTarget(null);
      await refreshAll();
    } catch (e: any) {
      bdsToast.danger(`拉黑失败：${e?.message || e}`);
    }
  };

  const handleUnblacklist = async (profile: FactoryProfile) => {
    if (!(await bdsConfirm({ title: '确认解除拉黑', body: `确认解除「${profile.relation?.name || profile.id}」的拉黑？` }))) return;
    try {
      await apiService.unblacklistFactory(profile.id);
      await refreshAll();
    } catch (e: any) {
      bdsToast.danger(`解除拉黑失败：${e?.message || e}`);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // 评分操作
  // ══════════════════════════════════════════════════════════════

  const handleAddEvaluation = async (input: FactoryEvaluationInput) => {
    if (!selectedId) return;
    try {
      await apiService.addFactoryEvaluation(selectedId, input);
      setShowEvaluationForm(false);
      await loadDetail();
    } catch (e: any) {
      bdsToast.danger(`追加评分失败：${e?.message || e}`);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // 认证操作
  // ══════════════════════════════════════════════════════════════

  const handleSaveCertification = async (input: FactoryCertificationInput, certId?: string) => {
    if (!selectedId) return;
    try {
      if (certId) {
        await apiService.updateFactoryCertification(certId, input);
      } else {
        await apiService.addFactoryCertification(selectedId, input);
      }
      setShowCertForm(false);
      setEditingCert(null);
      await Promise.all([loadDetail(), loadExpiring()]);
    } catch (e: any) {
      bdsToast.danger(`保存认证失败：${e?.message || e}`);
    }
  };

  const handleDeleteCertification = async (cert: FactoryCertification) => {
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除认证「${cert.type}」？`, danger: true }))) return;
    try {
      await apiService.deleteFactoryCertification(cert.id);
      await Promise.all([loadDetail(), loadExpiring()]);
    } catch (e: any) {
      bdsToast.danger(`删除认证失败：${e?.message || e}`);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // 产能操作
  // ══════════════════════════════════════════════════════════════

  const handleSaveCapacity = async (month: string, input: { capacity: number; unit?: string | null; note?: string | null }) => {
    if (!selectedId) return;
    try {
      await apiService.upsertFactoryCapacity(selectedId, month, input);
      setShowCapacityForm(false);
      setEditingCapacityMonth(null);
      await loadDetail();
    } catch (e: any) {
      bdsToast.danger(`保存产能失败：${e?.message || e}`);
    }
  };

  const handleDeleteCapacity = async (row: FactoryCapacity) => {
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除 ${row.month} 的产能计划？`, danger: true }))) return;
    if (!selectedId) return;
    try {
      await apiService.deleteFactoryCapacity(selectedId, row.month);
      await loadDetail();
    } catch (e: any) {
      bdsToast.danger(`删除产能失败：${e?.message || e}`);
    }
  };

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  // ══════════════════════════════════════════════════════════════
  // 渲染
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="供应商管理"
        subtitle="Supplier Management"
        actions={
          <button
            onClick={() => { setEditingProfile(null); setShowProfileForm(true); }}
            className="bds-btn bds-btn-primary"
          >
            <Plus className="w-4 h-4" />
            新建工厂档案
          </button>
        }
      />

      {/* 认证到期预警横幅（C8：已过期证书一并进预警，比将到期更紧急） */}
      {expiringCerts.length > 0 && (
        <div className="px-7 pb-2">
          <button
            onClick={() => setShowExpiringPanel((v) => !v)}
            className={`bds-alert w-full text-left ${expiringCerts.some((c) => (certDaysLeft(c.validUntil) ?? 0) < 0) ? 'danger' : 'warning'}`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {(() => {
                const expired = expiringCerts.filter((c) => (certDaysLeft(c.validUntil) ?? 0) < 0).length;
                const upcoming = expiringCerts.length - expired;
                const parts: string[] = [];
                if (expired > 0) parts.push(`${expired} 项工厂认证已过期`);
                if (upcoming > 0) parts.push(`${upcoming} 项将于 ${EXPIRING_DAYS} 天内到期`);
                return parts.join('，');
              })()}
            </span>
            <span className="text-xs opacity-70 ml-auto">{showExpiringPanel ? '收起' : '查看'}</span>
          </button>
          <AnimatePresence>
            {showExpiringPanel && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 bds-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {expiringCerts.map((cert, index) => {
                    const daysLeft = certDaysLeft(cert.validUntil);
                    return (
                      <div
                        key={cert.id}
                        className="flex items-center gap-3 px-4 py-2.5"
                        style={index > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
                      >
                        <ShieldAlert className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                        <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                          {cert.factory?.relation?.name || cert.factory?.relationId || '未知工厂'}
                        </span>
                        <span className="bds-badge sm info">
                          {cert.type}
                        </span>
                        <span className={`ml-auto bds-badge sm ${certSemantic(daysLeft)}`}>
                          {daysLeft !== null && daysLeft < 0 ? `已过期 ${-daysLeft} 天` : `剩余 ${daysLeft} 天`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 主体：左列表 + 右详情 */}
      <div className="flex-1 flex min-h-0 px-7 pb-5 gap-4">
        {/* ── 左侧：排名列表 ── */}
        <div className="w-80 shrink-0 flex flex-col bds-card overflow-hidden" style={{ padding: 0 }}>
          <div className="p-3 space-y-2" style={{ borderBottom: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
                <input
                  type="text"
                  placeholder="搜索供应商名称..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bds-input sm pl-9"
                />
              </div>
              <button
                onClick={refreshAll}
                className="bds-btn bds-btn-ghost bds-btn-icon"
                title="刷新"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="bds-segment">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setFilter(opt.id)}
                    className={`seg ${filter === opt.id ? 'active' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <select
                className="bds-select ml-auto"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                style={{ width: 'auto', height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {listError && profiles.length > 0 && (
              <div className="bds-alert danger mx-3 mt-2 mb-1">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="flex-1 min-w-0">{listError}</span>
                <button onClick={() => loadProfiles()} className="bds-btn bds-btn-secondary shrink-0">
                  <RefreshCw className="w-3.5 h-3.5" /><span>重试</span>
                </button>
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
              </div>
            ) : listError && profiles.length === 0 ? (
              <div className="bds-alert danger m-3 items-start">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="flex-1 min-w-0">{listError}</span>
                <button onClick={() => loadProfiles()} className="bds-btn bds-btn-secondary shrink-0">
                  <RefreshCw className="w-3.5 h-3.5" /><span>重试</span>
                </button>
              </div>
            ) : profiles.length === 0 ? (
              <div className="bds-empty">
                <div className="glyph"><Building2 className="w-6 h-6" /></div>
                <div className="title">{search ? '未找到匹配的工厂档案' : '暂无工厂档案'}</div>
                {!search && <div className="desc">点击右上角「新建工厂档案」开始</div>}
              </div>
            ) : (
              <div className="bds-listrows px-2 py-1">
                {profiles.map((p) => {
                  const isSelected = p.id === selectedId;
                  const blacklisted = p.blacklistedAt != null;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className="bds-listrow w-full text-left"
                      style={isSelected ? { background: 'var(--recessed-bg-strong)' } : undefined}
                    >
                      <div className="lr-main">
                        <div className="flex items-center gap-2">
                          <span className="lr-title flex-1" style={{ color: 'var(--text-primary)' }}>
                            {p.relation?.name || p.relationId}
                          </span>
                          {blacklisted && (
                            <span className="bds-badge sm danger shrink-0">
                              已拉黑
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                          <span className={`bds-badge sm ${scoreSemantic(p.qualityScore)}`}>
                            质 {Math.round(p.qualityScore)}
                          </span>
                          <span className={`bds-badge sm ${scoreSemantic(p.deliveryScore)}`}>
                            交 {Math.round(p.deliveryScore)}
                          </span>
                          <span className="ml-auto">{p.totalOrders} 单</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="px-4 py-2 text-[11px] flex items-center gap-2" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
            <span>共 {total} 家工厂{profiles.length < total ? `，已加载 ${profiles.length} 家` : ''}</span>
            {profiles.length < total && (
              <button
                onClick={() => loadProfiles(profiles.length)}
                disabled={loadingMore}
                className="bds-btn bds-btn-ghost ml-auto"
                style={{ padding: '0 var(--space-2)' }}
              >
                {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>加载更多</span>
              </button>
            )}
          </div>
        </div>

        {/* ── 右侧：360° 详情 ── */}
        <div className="flex-1 min-w-0 flex flex-col bds-card overflow-hidden" style={{ padding: 0 }}>
          {detailError && (
            <div className="bds-alert danger m-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1 min-w-0">{detailError}</span>
              <button onClick={() => loadDetail()} className="bds-btn bds-btn-secondary shrink-0">
                <RefreshCw className="w-3.5 h-3.5" /><span>重试</span>
              </button>
            </div>
          )}
          {!selectedProfile ? (
            <div className="bds-empty flex-1 justify-center">
              <div className="glyph"><Building2 className="w-6 h-6" /></div>
              <div className="title">请选择左侧工厂查看 360° 详情</div>
            </div>
          ) : (
            <>
              {/* 工厂头部卡 */}
              <div className="p-5" style={{ borderBottom: 'var(--border-subtle)' }}>
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-light truncate" style={{ color: 'var(--text-primary)' }}>
                        {detail?.relation?.name || selectedProfile.relation?.name || selectedProfile.relationId}
                      </h2>
                      {(detail?.blacklistedAt ?? selectedProfile.blacklistedAt) != null && (
                        <span className="bds-badge sm danger shrink-0">
                          已拉黑
                        </span>
                      )}
                      {(detail?.priceLevel ?? selectedProfile.priceLevel) && (
                        <span className="bds-badge sm info shrink-0">
                          {PRICE_LEVEL_LABELS[(detail?.priceLevel ?? selectedProfile.priceLevel) as string]}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                      <span>累计 {selectedProfile.totalOrders} 单</span>
                      <span>累计金额 {formatNumber(selectedProfile.totalAmount)}</span>
                      <span>首次合作 {formatDate(selectedProfile.firstOrderAt)}</span>
                      {selectedProfile.monthlyCapacity != null && (
                        <span>月产能 {formatNumber(selectedProfile.monthlyCapacity)} {selectedProfile.capacityUnit || ''}</span>
                      )}
                    </div>
                  </div>
                  {/* 评分 */}
                  <div className="flex items-center gap-2 shrink-0">
                    <ScoreBadge label="质量" score={selectedProfile.qualityScore} />
                    <ScoreBadge label="交期" score={selectedProfile.deliveryScore} />
                  </div>
                </div>
                {/* 操作行 */}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => { setEditingProfile(detail ?? selectedProfile); setShowProfileForm(true); }}
                    className="bds-btn bds-btn-secondary"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    编辑档案
                  </button>
                  {onNavigate && (
                    <button
                      onClick={() => {
                        // 'Supplier' 固定分类：详情页返回上级落在供应商组织列表（返回栈完整）
                        primeRelationsOrgDetailPreview(selectedProfile.relationId, 'Supplier');
                        onNavigate(View.Relations);
                      }}
                      className="bds-btn bds-btn-secondary"
                      title="在关系智库中查看该供应商的组织档案、联系人与跟进记录"
                    >
                      关系档案
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {(detail?.blacklistedAt ?? selectedProfile.blacklistedAt) != null ? (
                    <button
                      onClick={() => handleUnblacklist(detail ?? selectedProfile)}
                      className="bds-btn bds-btn-secondary"
                    >
                      <CircleCheck className="w-3.5 h-3.5" />
                      解除拉黑
                    </button>
                  ) : (
                    <button
                      onClick={() => setBlacklistTarget(detail ?? selectedProfile)}
                      className="bds-btn bds-btn-secondary"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      拉黑
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProfile(detail ?? selectedProfile)}
                    className="bds-btn bds-btn-danger ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除
                  </button>
                </div>
                {(detail?.blacklistedAt ?? selectedProfile.blacklistedAt) != null && (
                  <div className="bds-alert danger mt-3 text-xs">
                    拉黑原因：{(detail ?? selectedProfile).blacklistReason || '未填写'}
                  </div>
                )}
              </div>

              {/* Tab 栏 */}
              <div className="bds-tabs px-5">
                {TABS.map((tab) => {
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

              {/* Tab 内容 */}
              <div className="flex-1 overflow-y-auto p-5">
                {detailLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15 }}
                    >
                      {activeTab === 'overview' && detail && (
                        <OverviewTab profile={detail} />
                      )}
                      {activeTab === 'evaluations' && (
                        <EvaluationsTab
                          evaluations={evaluations}
                          onCreate={() => setShowEvaluationForm(true)}
                        />
                      )}
                      {activeTab === 'certifications' && (
                        <CertificationsTab
                          certifications={certifications}
                          onCreate={() => { setEditingCert(null); setShowCertForm(true); }}
                          onEdit={(c) => { setEditingCert(c); setShowCertForm(true); }}
                          onDelete={handleDeleteCertification}
                        />
                      )}
                      {activeTab === 'certifications' && detail?.relationId && (
                        <SupplierTcTrace relationId={detail.relationId} />
                      )}
                      {activeTab === 'capacity' && (
                        <CapacityTab
                          capacity={capacity}
                          onCreate={() => { setEditingCapacityMonth(null); setShowCapacityForm(true); }}
                          onEdit={(row) => { setEditingCapacityMonth(row); setShowCapacityForm(true); }}
                          onDelete={handleDeleteCapacity}
                        />
                      )}
                      {activeTab === 'delays' && detail?.relationId && (
                        <FactoryDelayPanel
                          relationId={detail.relationId}
                          supplierName={detail.relation?.name ?? ''}
                          isDarkMode={isDarkMode}
                        />
                      )}

                      {/* 关联业务（产品化 Links）— 该供应商的采购/订单/报价/开发/出运等入口 */}
                      {detail?.relationId && (
                        <div className="pt-4">
                          <RelatedWorkspacesSection
                            sourceType="relation"
                            relationId={detail.relationId}
                            relationName={detail.relation?.name ?? ''}
                            relationRole="supplier"
                            onNavigate={onNavigate}
                            isDarkMode={isDarkMode}
                          />
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 弹窗 */}
      <AnimatePresence>
        {showProfileForm && (
          <ProfileForm
            profile={editingProfile}
            existingRelationIds={profiles.map((p) => p.relationId)}
            onSave={handleSaveProfile}
            onClose={() => { setShowProfileForm(false); setEditingProfile(null); }}
          />
        )}
        {showEvaluationForm && (
          <EvaluationForm
            onSave={handleAddEvaluation}
            onClose={() => setShowEvaluationForm(false)}
          />
        )}
        {showCertForm && (
          <CertificationForm
            certification={editingCert}
            onSave={handleSaveCertification}
            onClose={() => { setShowCertForm(false); setEditingCert(null); }}
          />
        )}
        {showCapacityForm && (
          <CapacityForm
            row={editingCapacityMonth}
            defaultUnit={detail?.capacityUnit || 'PC'}
            onSave={handleSaveCapacity}
            onClose={() => { setShowCapacityForm(false); setEditingCapacityMonth(null); }}
          />
        )}
        {blacklistTarget && (
          <BlacklistForm
            profile={blacklistTarget}
            onSave={handleBlacklist}
            onClose={() => setBlacklistTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== 子组件 ====================

function ScoreBadge({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex flex-col items-center px-3 py-2 rounded-card" style={SEMANTIC_TINT_STYLE[scoreSemantic(score)]}>
      <span className="text-lg font-light leading-none">{Math.round(score)}</span>
      <span className="text-[10px] mt-1 opacity-70">{label}分</span>
    </div>
  );
}

// ─── 总览 Tab ───

function OverviewTab({ profile }: { profile: FactoryProfile }) {
  const items: Array<{ label: string; value: React.ReactNode }> = [
    { label: '月产能', value: profile.monthlyCapacity != null ? `${formatNumber(profile.monthlyCapacity)} ${profile.capacityUnit || ''}` : '—' },
    { label: '工人数量', value: profile.workerCount != null ? `${profile.workerCount} 人` : '—' },
    { label: '设备清单', value: profile.equipmentList || '—' },
    { label: '价位水平', value: profile.priceLevel ? PRICE_LEVEL_LABELS[profile.priceLevel] : '—' },
    { label: '首次合作', value: formatDate(profile.firstOrderAt) },
    { label: '累计订单', value: `${profile.totalOrders} 单` },
    { label: '累计金额', value: formatNumber(profile.totalAmount) },
    { label: '开户行', value: profile.bankName || '—' },
    { label: '收款账户', value: profile.bankAccount || '—' },
    { label: 'SWIFT', value: profile.bankSwift || '—' },
  ];

  return (
    <div className="space-y-4">
      {/* 专长 */}
      <div className="bds-card flat">
        <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>擅长品类</div>
        {profile.specialties.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {profile.specialties.map((s) => (
              <span key={s} className="bds-badge sm info">
                {s}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>未填写</div>
        )}
      </div>

      {/* 档案字段 */}
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.label} className="bds-card flat" style={{ padding: 'var(--space-3)' }}>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{item.label}</div>
            <div className="text-sm mt-1 break-all" style={{ color: 'var(--text-primary)' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* 备注 */}
      {profile.notes && (
        <div className="bds-card flat">
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>备注</div>
          <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{profile.notes}</div>
        </div>
      )}

      {/* Relation 联系信息 */}
      {profile.relation && (
        <div className="bds-card flat">
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>联系信息（关系智库）</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>主联系人</span>
              <div style={{ color: 'var(--text-primary)' }}>{profile.relation.primaryContactName || '—'}</div>
            </div>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>联系方式</span>
              <div className="break-all" style={{ color: 'var(--text-primary)' }}>{profile.relation.contactInfo || '—'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 评分记录 Tab ───

function EvaluationsTab({
  evaluations,
  onCreate,
}: {
  evaluations: FactoryEvaluation[];
  onCreate: () => void;
}) {
  const [kindFilter, setKindFilter] = useState<'' | FactoryEvaluationKind>('');
  const filtered = kindFilter ? evaluations.filter((e) => e.kind === kindFilter) : evaluations;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="bds-segment">
          {(['', 'inspection', 'delivery'] as const).map((k) => (
            <button
              key={k || 'all'}
              onClick={() => setKindFilter(k)}
              className={`seg ${kindFilter === k ? 'active' : ''}`}
            >
              {k === '' ? '全部' : EVALUATION_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <button
          onClick={onCreate}
          className="bds-btn bds-btn-secondary ml-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          手动评分
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bds-empty bds-card flat">
          <div className="title">暂无评分记录</div>
          <div className="desc">验货结论 / 采购单收齐后将自动追加评分</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((ev) => (
            <div key={ev.id} className="bds-card flat flex items-center gap-3" style={{ padding: 'var(--space-3)' }}>
              <span className={`bds-badge sm shrink-0 ${EVALUATION_KIND_BADGE_VARIANT[ev.kind] || 'neutral'}`}>
                {EVALUATION_KIND_LABELS[ev.kind] || ev.kind}
              </span>
              <span className={`bds-badge ${scoreSemantic(ev.score)}`} style={{ fontSize: 'var(--text-base)' }}>
                {Math.round(ev.score)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{ev.note || '—'}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {ev.evaluatedAt}
                  {ev.sourceType ? ` · 来源 ${SOURCE_TYPE_LABELS[ev.sourceType] || ev.sourceType}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  inspectionReport: '验货报告',
  shipment: '货运',
  purchaseOrder: '采购单',
  manual: '手动',
};

// ─── 认证管理 Tab ───

function CertificationsTab({
  certifications,
  onCreate,
  onEdit,
  onDelete,
}: {
  certifications: FactoryCertification[];
  onCreate: () => void;
  onEdit: (c: FactoryCertification) => void;
  onDelete: (c: FactoryCertification) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>共 {certifications.length} 项认证</div>
        <button
          onClick={onCreate}
          className="bds-btn bds-btn-secondary"
        >
          <Plus className="w-3.5 h-3.5" />
          新增认证
        </button>
      </div>

      {certifications.length === 0 ? (
        <div className="bds-empty bds-card flat">
          <div className="title">暂无认证记录</div>
        </div>
      ) : (
        <div className="space-y-2">
          {certifications.map((cert) => {
            const daysLeft = certDaysLeft(cert.validUntil);
            return (
              <div key={cert.id} className="bds-card flat flex items-center gap-3" style={{ padding: 'var(--space-3)' }}>
                <Award className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{cert.type}</span>
                    {cert.certificateNo && (
                      <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>No. {cert.certificateNo}</span>
                    )}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    签发 {formatDate(cert.issuedAt)} · 有效期至 {cert.validUntil || '长期'}
                  </div>
                </div>
                <span className={`bds-badge sm shrink-0 ${certSemantic(daysLeft)}`}>
                  {daysLeft === null ? '长期有效' : daysLeft < 0 ? `已过期 ${-daysLeft} 天` : daysLeft <= EXPIRING_DAYS ? `剩余 ${daysLeft} 天` : '有效'}
                </span>
                <button
                  onClick={() => onEdit(cert)}
                  className="bds-btn bds-btn-ghost bds-btn-icon"
                  title="编辑"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(cert)}
                  className="bds-btn bds-btn-ghost bds-btn-icon"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── REQ2-06 TC 交易证书追溯（认证管理 Tab 内，按交易对手维度——验收锚点②） ───

const TC_STAGE_LABELS_SUPPLIER: Record<string, string> = {
  material_input: '原料 TC',
  factory_output: '工厂 TC',
  our_sale: '我方 TC',
};

function SupplierTcTrace({ relationId }: { relationId: string }) {
  const [items, setItems] = useState<TcCertificateRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiService.listTcCertificates({ relationId });
        if (!cancelled) setItems(data.items);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [relationId]);

  return (
    <div className="bds-card flat" style={{ padding: 'var(--space-4)' }}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>TC 交易证书追溯</span>
        <span className="text-[10px] tracking-[0.14em]" style={{ color: 'var(--text-quaternary)' }}>TC CHAIN</span>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{items.length} 张</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs" style={{ color: 'var(--text-quaternary)' }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />加载 TC 链…
        </div>
      ) : items.length === 0 ? (
        <div className="py-4 text-xs" style={{ color: 'var(--text-quaternary)' }}>
          该交易对手暂无 TC 证书记录（GRS 订单的 TC 登记在订单详情「GRS TC 证书链」区块）
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {items.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="bds-badge sm neutral">{TC_STAGE_LABELS_SUPPLIER[t.stage] ?? t.stage}</span>
              <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{t.tcNo}</span>
              <span className="tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                {Number(t.quantityKg).toLocaleString()} kg
              </span>
              <span style={{ color: 'var(--text-quaternary)' }}>
                订单 {t.orderId}{t.validUntil ? ` · 效期至 ${t.validUntil}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 产能日历 Tab ───

function CapacityTab({
  capacity,
  onCreate,
  onEdit,
  onDelete,
}: {
  capacity: FactoryCapacity[];
  onCreate: () => void;
  onEdit: (row: FactoryCapacity) => void;
  onDelete: (row: FactoryCapacity) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          占用量由在手采购单（已发送/已确认/部分收货）按交期落月实时聚合
        </div>
        <button
          onClick={onCreate}
          className="bds-btn bds-btn-secondary"
        >
          <Plus className="w-3.5 h-3.5" />
          设置月产能
        </button>
      </div>

      {capacity.length === 0 ? (
        <div className="bds-empty bds-card flat">
          <div className="title">暂无产能计划</div>
          <div className="desc">点击「设置月产能」开始规划</div>
        </div>
      ) : (
        <div className="space-y-2">
          {capacity.map((row) => {
            const occupied = row.occupied ?? 0;
            const cap = Number(row.capacity) || 0;
            const ratio = cap > 0 ? occupied / cap : 0;
            const semantic: StatusSemantic = ratio > 1 ? 'danger' : ratio > 0.8 ? 'warning' : 'success';
            return (
              <div key={row.id} className="bds-card flat" style={{ padding: 'var(--space-3)' }}>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-light w-20" style={{ color: 'var(--text-primary)' }}>{row.month}</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    计划 {formatNumber(cap)} {row.unit || ''}
                  </span>
                  <span className={`bds-badge sm ${semantic}`}>
                    占用 {formatNumber(occupied)}（{Math.round(ratio * 100)}%）
                  </span>
                  {row.note && <span className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{row.note}</span>}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => onEdit(row)}
                      className="bds-btn bds-btn-ghost bds-btn-icon"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDelete(row)}
                      className="bds-btn bds-btn-ghost bds-btn-icon"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* 占用条 */}
                <div className={`bds-progress mt-2 ${semantic}`}>
                  <div
                    className="fill"
                    style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==================== 表单组件 ====================

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
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
        className="bds-modal"
        style={{ width: '32rem', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} className="bds-btn bds-btn-ghost bds-btn-icon">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
      {children}
    </div>
  );
}

const inputClass = 'bds-input';
const textareaClass = 'bds-input bds-textarea';

// ─── 档案表单（新建 / 编辑） ───

function ProfileForm({
  profile,
  existingRelationIds,
  onSave,
  onClose,
}: {
  profile: FactoryProfile | null;
  existingRelationIds: string[];
  onSave: (input: FactoryProfileInput | FactoryProfilePatch, id?: string) => void;
  onClose: () => void;
}) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relationId, setRelationId] = useState(profile?.relationId ?? '');
  const [monthlyCapacity, setMonthlyCapacity] = useState(profile?.monthlyCapacity?.toString() ?? '');
  const [capacityUnit, setCapacityUnit] = useState(profile?.capacityUnit ?? 'PC');
  const [equipmentList, setEquipmentList] = useState(profile?.equipmentList ?? '');
  const [workerCount, setWorkerCount] = useState(profile?.workerCount?.toString() ?? '');
  const [specialties, setSpecialties] = useState((profile?.specialties ?? []).join(', '));
  const [priceLevel, setPriceLevel] = useState(profile?.priceLevel ?? '');
  const [firstOrderAt, setFirstOrderAt] = useState(profile?.firstOrderAt ?? '');
  const [bankName, setBankName] = useState(profile?.bankName ?? '');
  const [bankAccount, setBankAccount] = useState(profile?.bankAccount ?? '');
  const [bankSwift, setBankSwift] = useState(profile?.bankSwift ?? '');
  const [notes, setNotes] = useState(profile?.notes ?? '');

  // 新建模式：加载可选供应商（category=Supplier 组织，且尚无档案）
  useEffect(() => {
    if (profile) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listRelations();
        if (cancelled) return;
        setRelations(
          list.filter((r) => r.category === 'Supplier' && r.isOrganization && !r.deletedAt && !existingRelationIds.includes(r.id)),
        );
      } catch (e) {
        console.error('[SuppliersManager] load relations for picker failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [profile, existingRelationIds]);

  const handleSubmit = () => {
    const payload: FactoryProfilePatch = {
      monthlyCapacity: monthlyCapacity ? Number(monthlyCapacity) : null,
      capacityUnit: capacityUnit || null,
      equipmentList: equipmentList || null,
      workerCount: workerCount ? Number(workerCount) : null,
      specialties: specialties.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      priceLevel: (priceLevel || null) as FactoryPriceLevel | null,
      firstOrderAt: firstOrderAt || null,
      bankName: bankName || null,
      bankAccount: bankAccount || null,
      bankSwift: bankSwift || null,
      notes: notes || null,
    };
    if (profile) {
      onSave(payload, profile.id);
    } else {
      if (!relationId) {
        bdsToast.warning('请选择供应商（Relation）');
        return;
      }
      onSave({ relationId, ...payload } as FactoryProfileInput);
    }
  };

  return (
    <ModalShell title={profile ? '编辑工厂档案' : '新建工厂档案'} onClose={onClose}>
      {!profile && (
        <Field label="供应商（category=Supplier 的组织）*">
          <select className="bds-select" value={relationId} onChange={(e) => setRelationId(e.target.value)}>
            <option value="">选择供应商...</option>
            {relations.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {relations.length === 0 && (
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
              暂无可建档的供应商组织，请先在「关系智库」创建 category=Supplier 的组织
            </div>
          )}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="月产能">
          <input type="number" className={inputClass} value={monthlyCapacity} onChange={(e) => setMonthlyCapacity(e.target.value)} />
        </Field>
        <Field label="产能单位">
          <select className="bds-select" value={capacityUnit} onChange={(e) => setCapacityUnit(e.target.value)}>
            {CAPACITY_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="工人数量">
          <input type="number" className={inputClass} value={workerCount} onChange={(e) => setWorkerCount(e.target.value)} />
        </Field>
        <Field label="价位水平">
          <select className="bds-select" value={priceLevel} onChange={(e) => setPriceLevel(e.target.value as FactoryPriceLevel | '')}>
            <option value="">未设置</option>
            {PRICE_LEVELS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="擅长品类（逗号分隔）">
        <input className={inputClass} value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="西装, 大衣, 衬衫" />
      </Field>
      <Field label="设备清单">
        <input className={inputClass} value={equipmentList} onChange={(e) => setEquipmentList(e.target.value)} placeholder="平车 50 台, 拷边机 10 台" />
      </Field>
      <Field label="首次合作日期">
        <CapsuleDateInput className="bds-input" value={firstOrderAt} onChange={setFirstOrderAt} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="开户行">
          <input className={inputClass} value={bankName} onChange={(e) => setBankName(e.target.value)} />
        </Field>
        <Field label="收款账户">
          <input className={inputClass} value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
        </Field>
        <Field label="SWIFT">
          <input className={inputClass} value={bankSwift} onChange={(e) => setBankSwift(e.target.value)} />
        </Field>
      </div>
      <Field label="备注">
        <textarea className={textareaClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ─── 手动评分表单 ───

function EvaluationForm({
  onSave,
  onClose,
}: {
  onSave: (input: FactoryEvaluationInput) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<FactoryEvaluationKind>('inspection');
  const [score, setScore] = useState('');
  const [evaluatedAt, setEvaluatedAt] = useState(todayStr());
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    const num = Number(score);
    if (score === '' || Number.isNaN(num) || num < 0 || num > 100) {
      bdsToast.warning('评分必须是 0-100 的数字');
      return;
    }
    onSave({ kind, score: num, sourceType: 'manual', evaluatedAt, note: note || null });
  };

  return (
    <ModalShell title="手动追加评分" onClose={onClose}>
      <Field label="评分类型 *">
        <select className="bds-select" value={kind} onChange={(e) => setKind(e.target.value as FactoryEvaluationKind)}>
          <option value="inspection">验货质量</option>
          <option value="delivery">交期达成</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="分数（0-100）*">
          <input type="number" min={0} max={100} className={inputClass} value={score} onChange={(e) => setScore(e.target.value)} />
        </Field>
        <Field label="评定日期 *">
          <CapsuleDateInput className="bds-input" value={evaluatedAt} onChange={setEvaluatedAt} />
        </Field>
      </div>
      <Field label="备注">
        <textarea className={textareaClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="评定依据说明" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ─── 认证表单 ───

function CertificationForm({
  certification,
  onSave,
  onClose,
}: {
  certification: FactoryCertification | null;
  onSave: (input: FactoryCertificationInput, certId?: string) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState(certification?.type ?? 'BSCI');
  const [customType, setCustomType] = useState('');
  const [certificateNo, setCertificateNo] = useState(certification?.certificateNo ?? '');
  const [issuedAt, setIssuedAt] = useState(certification?.issuedAt ?? '');
  const [validUntil, setValidUntil] = useState(certification?.validUntil ?? '');
  const [longTerm, setLongTerm] = useState(!certification?.validUntil && !!certification);

  const isCustom = type === '其他' && !CERT_TYPES.slice(0, -1).includes(type);

  const handleSubmit = () => {
    const finalType = type === '其他' ? customType.trim() : type;
    if (!finalType) {
      bdsToast.warning('请填写认证类型');
      return;
    }
    onSave({
      type: finalType,
      certificateNo: certificateNo || null,
      issuedAt: issuedAt || null,
      validUntil: longTerm ? null : validUntil || null,
    }, certification?.id);
  };

  return (
    <ModalShell title={certification ? '编辑认证' : '新增认证'} onClose={onClose}>
      <Field label="认证类型 *">
        <select
          className="bds-select"
          value={CERT_TYPES.includes(type) ? type : '其他'}
          onChange={(e) => {
            const v = e.target.value;
            setType(v);
            if (v !== '其他') setCustomType('');
          }}
        >
          {CERT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      {(type === '其他' || isCustom) && (
        <Field label="自定义类型名称 *">
          <input className={inputClass} value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="如：GRS 再生认证" />
        </Field>
      )}
      <Field label="证书编号">
        <input className={inputClass} value={certificateNo} onChange={(e) => setCertificateNo(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="签发日期">
          <CapsuleDateInput className="bds-input" value={issuedAt} onChange={setIssuedAt} />
        </Field>
        <Field label="有效期至">
          <CapsuleDateInput className="bds-input" value={validUntil} onChange={setValidUntil} disabled={longTerm} />
        </Field>
      </div>
      <label className="bds-check mb-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <input type="checkbox" checked={longTerm} onChange={(e) => setLongTerm(e.target.checked)} />
        <span className="box" />
        长期有效（无到期日）
      </label>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ─── 产能表单 ───

function CapacityForm({
  row,
  defaultUnit,
  onSave,
  onClose,
}: {
  row: FactoryCapacity | null;
  defaultUnit: string;
  onSave: (month: string, input: { capacity: number; unit?: string | null; note?: string | null }) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(row?.month ?? currentMonth());
  const [capacity, setCapacity] = useState(row?.capacity?.toString() ?? '');
  const [unit, setUnit] = useState(row?.unit ?? defaultUnit);
  const [note, setNote] = useState(row?.note ?? '');

  const handleSubmit = () => {
    const num = Number(capacity);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      bdsToast.warning('月份格式必须是 YYYY-MM');
      return;
    }
    if (capacity === '' || Number.isNaN(num) || num < 0) {
      bdsToast.warning('产能必须是非负数字');
      return;
    }
    onSave(month, { capacity: num, unit: unit || null, note: note || null });
  };

  return (
    <ModalShell title={row ? `编辑 ${row.month} 产能` : '设置月产能'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="月份（YYYY-MM）*">
          <input type="month" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)} disabled={!!row} />
        </Field>
        <Field label="计划产能 *">
          <input type="number" min={0} className={inputClass} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
      </div>
      <Field label="单位">
        <select className="bds-select" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {CAPACITY_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </Field>
      <Field label="备注">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：春节月减半" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          保存
        </button>
      </div>
    </ModalShell>
  );
}

// ─── 拉黑表单 ───

function BlacklistForm({
  profile,
  onSave,
  onClose,
}: {
  profile: FactoryProfile;
  onSave: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    if (!reason.trim()) {
      bdsToast.warning('拉黑原因必填');
      return;
    }
    onSave(reason.trim());
  };

  return (
    <ModalShell title={`拉黑「${profile.relation?.name || profile.relationId}」`} onClose={onClose}>
      <div className="bds-alert warning mb-3 text-xs">
        拉黑后该工厂将被禁止新建采购单，直至解除拉黑。此操作需要管理权限。
      </div>
      <Field label="拉黑原因 *">
        <textarea className={textareaClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：连续两次验货不合格 / 严重延期" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-danger"
        >
          确认拉黑
        </button>
      </div>
    </ModalShell>
  );
}
