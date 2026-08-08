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
 *   - RDL flat 设计：statusSemanticClass 中性色阶，无阴影，大圆角
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
  Ban,
  CircleCheck,
  Pencil,
  AlertTriangle,
  Award,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Relation,
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
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { statusSemanticClass, statusSemanticBg, StatusSemantic } from './rdlBusinessStatusTokens';
import { RelatedEntitiesPanel } from './RelatedEntitiesPanel';

// ==================== 常量 ====================

type SupplierTab = 'overview' | 'evaluations' | 'certifications' | 'capacity';

const TABS: Array<{ id: SupplierTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: '总览', icon: Building2 },
  { id: 'evaluations', label: '评分记录', icon: Star },
  { id: 'certifications', label: '认证管理', icon: ShieldCheck },
  { id: 'capacity', label: '产能日历', icon: CalendarRange },
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

// ==================== 组件 Props ====================

interface SuppliersManagerProps {
  isDarkMode?: boolean;
}

// ==================== 主组件 ====================

export default function SuppliersManager({ isDarkMode }: SuppliersManagerProps) {
  const [activeTab, setActiveTab] = useState<SupplierTab>('overview');
  const [profiles, setProfiles] = useState<FactoryProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('quality');
  const [filter, setFilter] = useState<FilterId>('active');

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
  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiService.listFactoryProfiles({
        search: search || undefined,
        sort,
        blacklisted: filter === 'all' ? undefined : filter === 'blacklisted',
        limit: 100,
      });
      setProfiles(result.items);
      setTotal(result.total);
      if (!selectedId && result.items.length > 0) {
        setSelectedId(result.items[0].id);
      }
    } catch (e) {
      console.error('[SuppliersManager] loadProfiles failed', e);
    } finally {
      setLoading(false);
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
    } catch (e) {
      console.error('[SuppliersManager] loadDetail failed', e);
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
      alert(`保存工厂档案失败：${e?.message || e}`);
    }
  };

  const handleDeleteProfile = async (profile: FactoryProfile) => {
    if (!confirm(`确认删除工厂档案「${profile.relation?.name || profile.id}」？（软删除，可联系管理员恢复）`)) return;
    try {
      await apiService.deleteFactoryProfile(profile.id);
      if (selectedId === profile.id) setSelectedId(null);
      await refreshAll();
    } catch (e: any) {
      alert(`删除失败：${e?.message || e}`);
    }
  };

  const handleBlacklist = async (reason: string) => {
    if (!blacklistTarget) return;
    try {
      await apiService.blacklistFactory(blacklistTarget.id, reason);
      setBlacklistTarget(null);
      await refreshAll();
    } catch (e: any) {
      alert(`拉黑失败：${e?.message || e}`);
    }
  };

  const handleUnblacklist = async (profile: FactoryProfile) => {
    if (!confirm(`确认解除「${profile.relation?.name || profile.id}」的拉黑？`)) return;
    try {
      await apiService.unblacklistFactory(profile.id);
      await refreshAll();
    } catch (e: any) {
      alert(`解除拉黑失败：${e?.message || e}`);
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
      alert(`追加评分失败：${e?.message || e}`);
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
      alert(`保存认证失败：${e?.message || e}`);
    }
  };

  const handleDeleteCertification = async (cert: FactoryCertification) => {
    if (!confirm(`确认删除认证「${cert.type}」？`)) return;
    try {
      await apiService.deleteFactoryCertification(cert.id);
      await Promise.all([loadDetail(), loadExpiring()]);
    } catch (e: any) {
      alert(`删除认证失败：${e?.message || e}`);
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
      alert(`保存产能失败：${e?.message || e}`);
    }
  };

  const handleDeleteCapacity = async (row: FactoryCapacity) => {
    if (!confirm(`确认删除 ${row.month} 的产能计划？`)) return;
    if (!selectedId) return;
    try {
      await apiService.deleteFactoryCapacity(selectedId, row.month);
      await loadDetail();
    } catch (e: any) {
      alert(`删除产能失败：${e?.message || e}`);
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-control bg-surface-elevated text-text-primary hover:ring-1 hover:ring-border-action transition-all"
          >
            <Plus className="w-4 h-4" />
            新建工厂档案
          </button>
        }
      />

      {/* 认证到期预警横幅 */}
      {expiringCerts.length > 0 && (
        <div className="px-7 pb-2">
          <button
            onClick={() => setShowExpiringPanel((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-card bg-surface-elevated border border-border-subtle text-left hover:ring-1 hover:ring-border-action transition-all"
          >
            <AlertTriangle className="w-4 h-4 text-text-secondary shrink-0" />
            <span className="text-sm text-text-primary">
              {expiringCerts.length} 项工厂认证将于 {EXPIRING_DAYS} 天内到期
            </span>
            <span className="text-xs text-text-tertiary ml-auto">{showExpiringPanel ? '收起' : '查看'}</span>
          </button>
          <AnimatePresence>
            {showExpiringPanel && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 rounded-card bg-surface-elevated border border-border-subtle divide-y divide-border-subtle">
                  {expiringCerts.map((cert) => {
                    const daysLeft = certDaysLeft(cert.validUntil);
                    return (
                      <div key={cert.id} className="flex items-center gap-3 px-4 py-2.5">
                        <ShieldAlert className="w-4 h-4 text-text-tertiary shrink-0" />
                        <span className="text-sm text-text-primary truncate">
                          {cert.factory?.relation?.name || cert.factory?.relationId || '未知工厂'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-control border ${statusSemanticClass('info', isDarkMode)}`}>
                          {cert.type}
                        </span>
                        <span className={`ml-auto text-xs px-2 py-0.5 rounded-control border ${statusSemanticClass(certSemantic(daysLeft), isDarkMode)}`}>
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
        <div className="w-80 shrink-0 flex flex-col rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
          <div className="p-3 border-b border-border-subtle space-y-2">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-text-tertiary shrink-0" />
              <input
                type="text"
                placeholder="搜索供应商名称..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none flex-1 min-w-0"
              />
              <button
                onClick={refreshAll}
                className="p-1 rounded-control hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
                title="刷新"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setFilter(opt.id)}
                  className={`px-2.5 py-1 text-xs rounded-control border transition-colors ${
                    filter === opt.id
                      ? statusSemanticClass('active', isDarkMode)
                      : 'text-text-tertiary border-transparent hover:text-text-secondary'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="ml-auto bg-surface-elevated text-text-primary text-xs rounded-control px-2 py-1 border border-border-subtle outline-none focus:border-border-action"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
              </div>
            ) : profiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary px-4">
                <Building2 className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm text-center">
                  {search ? '未找到匹配的工厂档案' : '暂无工厂档案，点击右上角「新建工厂档案」开始'}
                </p>
              </div>
            ) : (
              profiles.map((p) => {
                const isSelected = p.id === selectedId;
                const blacklisted = p.blacklistedAt != null;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-4 py-3 border-b border-border-subtle transition-colors ${
                      isSelected ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary truncate flex-1">
                        {p.relation?.name || p.relationId}
                      </span>
                      {blacklisted && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass('danger', isDarkMode)}`}>
                          已拉黑
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-tertiary">
                      <span className={`px-1.5 py-0.5 rounded-control border ${statusSemanticClass(scoreSemantic(p.qualityScore), isDarkMode)}`}>
                        质 {Math.round(p.qualityScore)}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-control border ${statusSemanticClass(scoreSemantic(p.deliveryScore), isDarkMode)}`}>
                        交 {Math.round(p.deliveryScore)}
                      </span>
                      <span className="ml-auto">{p.totalOrders} 单</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="px-4 py-2 border-t border-border-subtle text-[11px] text-text-tertiary">
            共 {total} 家工厂
          </div>
        </div>

        {/* ── 右侧：360° 详情 ── */}
        <div className="flex-1 min-w-0 flex flex-col rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
          {!selectedProfile ? (
            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
              <Building2 className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm">请选择左侧工厂查看 360° 详情</p>
            </div>
          ) : (
            <>
              {/* 工厂头部卡 */}
              <div className="p-5 border-b border-border-subtle">
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-medium text-text-primary truncate">
                        {detail?.relation?.name || selectedProfile.relation?.name || selectedProfile.relationId}
                      </h2>
                      {(detail?.blacklistedAt ?? selectedProfile.blacklistedAt) != null && (
                        <span className={`text-xs px-2 py-0.5 rounded-control border shrink-0 ${statusSemanticClass('danger', isDarkMode)}`}>
                          已拉黑
                        </span>
                      )}
                      {(detail?.priceLevel ?? selectedProfile.priceLevel) && (
                        <span className={`text-xs px-2 py-0.5 rounded-control border shrink-0 ${statusSemanticClass('info', isDarkMode)}`}>
                          {PRICE_LEVEL_LABELS[(detail?.priceLevel ?? selectedProfile.priceLevel) as string]}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-text-tertiary flex-wrap">
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
                    <ScoreBadge label="质量" score={selectedProfile.qualityScore} isDarkMode={isDarkMode} />
                    <ScoreBadge label="交期" score={selectedProfile.deliveryScore} isDarkMode={isDarkMode} />
                  </div>
                </div>
                {/* 操作行 */}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => { setEditingProfile(detail ?? selectedProfile); setShowProfileForm(true); }}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    编辑档案
                  </button>
                  {(detail?.blacklistedAt ?? selectedProfile.blacklistedAt) != null ? (
                    <button
                      onClick={() => handleUnblacklist(detail ?? selectedProfile)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
                    >
                      <CircleCheck className="w-3.5 h-3.5" />
                      解除拉黑
                    </button>
                  ) : (
                    <button
                      onClick={() => setBlacklistTarget(detail ?? selectedProfile)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      拉黑
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProfile(detail ?? selectedProfile)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-tertiary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除
                  </button>
                </div>
                {(detail?.blacklistedAt ?? selectedProfile.blacklistedAt) != null && (
                  <div className={`mt-3 px-3 py-2 rounded-card border text-xs ${statusSemanticClass('danger', isDarkMode)}`}>
                    拉黑原因：{(detail ?? selectedProfile).blacklistReason || '未填写'}
                  </div>
                )}
              </div>

              {/* Tab 栏 */}
              <div className="px-5 flex items-center gap-1 border-b border-border-subtle">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-control transition-colors ${
                        isActive
                          ? 'text-text-primary bg-surface-elevated border-b-2 border-border-action'
                          : 'text-text-tertiary hover:text-text-secondary'
                      }`}
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
                    <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
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
                        <OverviewTab profile={detail} isDarkMode={isDarkMode} />
                      )}
                      {activeTab === 'evaluations' && (
                        <EvaluationsTab
                          evaluations={evaluations}
                          isDarkMode={isDarkMode}
                          onCreate={() => setShowEvaluationForm(true)}
                        />
                      )}
                      {activeTab === 'certifications' && (
                        <CertificationsTab
                          certifications={certifications}
                          isDarkMode={isDarkMode}
                          onCreate={() => { setEditingCert(null); setShowCertForm(true); }}
                          onEdit={(c) => { setEditingCert(c); setShowCertForm(true); }}
                          onDelete={handleDeleteCertification}
                        />
                      )}
                      {activeTab === 'capacity' && (
                        <CapacityTab
                          capacity={capacity}
                          isDarkMode={isDarkMode}
                          onCreate={() => { setEditingCapacityMonth(null); setShowCapacityForm(true); }}
                          onEdit={(row) => { setEditingCapacityMonth(row); setShowCapacityForm(true); }}
                          onDelete={handleDeleteCapacity}
                        />
                      )}

                      {/* 跨模块关联视图（EntityLink 图谱） */}
                      {detail?.relationId && (
                        <div className="pt-4">
                          <RelatedEntitiesPanel
                            type="relation.organization"
                            id={detail.relationId}
                            isDarkMode={isDarkMode}
                            title="供应商关联视图"
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

function ScoreBadge({ label, score, isDarkMode }: { label: string; score: number; isDarkMode?: boolean }) {
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded-card border ${statusSemanticClass(scoreSemantic(score), isDarkMode)}`}>
      <span className="text-lg font-medium leading-none">{Math.round(score)}</span>
      <span className="text-[10px] mt-1 opacity-70">{label}分</span>
    </div>
  );
}

// ─── 总览 Tab ───

function OverviewTab({ profile, isDarkMode }: { profile: FactoryProfile; isDarkMode?: boolean }) {
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
      <div className="bg-surface-elevated rounded-card p-4">
        <div className="text-xs text-text-tertiary mb-2">擅长品类</div>
        {profile.specialties.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {profile.specialties.map((s) => (
              <span key={s} className={`text-xs px-2 py-1 rounded-control border ${statusSemanticClass('info', isDarkMode)}`}>
                {s}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-sm text-text-tertiary">未填写</div>
        )}
      </div>

      {/* 档案字段 */}
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.label} className="bg-surface-elevated rounded-card p-3">
            <div className="text-xs text-text-tertiary">{item.label}</div>
            <div className="text-sm text-text-primary mt-1 break-all">{item.value}</div>
          </div>
        ))}
      </div>

      {/* 备注 */}
      {profile.notes && (
        <div className="bg-surface-elevated rounded-card p-4">
          <div className="text-xs text-text-tertiary mb-1">备注</div>
          <div className="text-sm text-text-secondary whitespace-pre-wrap">{profile.notes}</div>
        </div>
      )}

      {/* Relation 联系信息 */}
      {profile.relation && (
        <div className="bg-surface-elevated rounded-card p-4">
          <div className="text-xs text-text-tertiary mb-2">联系信息（关系智库）</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-text-tertiary text-xs">主联系人</span>
              <div className="text-text-primary">{profile.relation.primaryContactName || '—'}</div>
            </div>
            <div>
              <span className="text-text-tertiary text-xs">联系方式</span>
              <div className="text-text-primary break-all">{profile.relation.contactInfo || '—'}</div>
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
  isDarkMode,
  onCreate,
}: {
  evaluations: FactoryEvaluation[];
  isDarkMode?: boolean;
  onCreate: () => void;
}) {
  const [kindFilter, setKindFilter] = useState<'' | FactoryEvaluationKind>('');
  const filtered = kindFilter ? evaluations.filter((e) => e.kind === kindFilter) : evaluations;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(['', 'inspection', 'delivery'] as const).map((k) => (
          <button
            key={k || 'all'}
            onClick={() => setKindFilter(k)}
            className={`px-2.5 py-1 text-xs rounded-control border transition-colors ${
              kindFilter === k
                ? statusSemanticClass('active', isDarkMode)
                : 'text-text-tertiary border-transparent hover:text-text-secondary'
            }`}
          >
            {k === '' ? '全部' : EVALUATION_KIND_LABELS[k]}
          </button>
        ))}
        <button
          onClick={onCreate}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          手动评分
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 text-text-tertiary text-sm bg-surface-elevated rounded-card">
          暂无评分记录（验货结论 / 采购单收齐后将自动追加评分）
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((ev) => (
            <div key={ev.id} className="bg-surface-elevated rounded-card p-3 flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-control border shrink-0 ${statusSemanticClass(ev.kind === 'inspection' ? 'info' : 'active', isDarkMode)}`}>
                {EVALUATION_KIND_LABELS[ev.kind] || ev.kind}
              </span>
              <span className={`text-base font-medium px-2 py-0.5 rounded-control border ${statusSemanticClass(scoreSemantic(ev.score), isDarkMode)}`}>
                {Math.round(ev.score)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text-primary truncate">{ev.note || '—'}</div>
                <div className="text-[11px] text-text-tertiary mt-0.5">
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
  isDarkMode,
  onCreate,
  onEdit,
  onDelete,
}: {
  certifications: FactoryCertification[];
  isDarkMode?: boolean;
  onCreate: () => void;
  onEdit: (c: FactoryCertification) => void;
  onDelete: (c: FactoryCertification) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-text-tertiary">共 {certifications.length} 项认证</div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          新增认证
        </button>
      </div>

      {certifications.length === 0 ? (
        <div className="text-center py-10 text-text-tertiary text-sm bg-surface-elevated rounded-card">
          暂无认证记录
        </div>
      ) : (
        <div className="space-y-2">
          {certifications.map((cert) => {
            const daysLeft = certDaysLeft(cert.validUntil);
            return (
              <div key={cert.id} className="bg-surface-elevated rounded-card p-3 flex items-center gap-3">
                <Award className="w-4 h-4 text-text-tertiary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary">{cert.type}</span>
                    {cert.certificateNo && (
                      <span className="text-[11px] text-text-tertiary">No. {cert.certificateNo}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-text-tertiary mt-0.5">
                    签发 {formatDate(cert.issuedAt)} · 有效期至 {cert.validUntil || '长期'}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-control border shrink-0 ${statusSemanticClass(certSemantic(daysLeft), isDarkMode)}`}>
                  {daysLeft === null ? '长期有效' : daysLeft < 0 ? `已过期 ${-daysLeft} 天` : daysLeft <= EXPIRING_DAYS ? `剩余 ${daysLeft} 天` : '有效'}
                </span>
                <button
                  onClick={() => onEdit(cert)}
                  className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                  title="编辑"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(cert)}
                  className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
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

// ─── 产能日历 Tab ───

function CapacityTab({
  capacity,
  isDarkMode,
  onCreate,
  onEdit,
  onDelete,
}: {
  capacity: FactoryCapacity[];
  isDarkMode?: boolean;
  onCreate: () => void;
  onEdit: (row: FactoryCapacity) => void;
  onDelete: (row: FactoryCapacity) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-text-tertiary">
          占用量由在手采购单（已发送/已确认/部分收货）按交期落月实时聚合
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          设置月产能
        </button>
      </div>

      {capacity.length === 0 ? (
        <div className="text-center py-10 text-text-tertiary text-sm bg-surface-elevated rounded-card">
          暂无产能计划，点击「设置月产能」开始规划
        </div>
      ) : (
        <div className="space-y-2">
          {capacity.map((row) => {
            const occupied = row.occupied ?? 0;
            const cap = Number(row.capacity) || 0;
            const ratio = cap > 0 ? occupied / cap : 0;
            const semantic: StatusSemantic = ratio > 1 ? 'danger' : ratio > 0.8 ? 'warning' : 'success';
            return (
              <div key={row.id} className="bg-surface-elevated rounded-card p-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-text-primary font-medium w-20">{row.month}</span>
                  <span className="text-xs text-text-tertiary">
                    计划 {formatNumber(cap)} {row.unit || ''}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-control border ${statusSemanticClass(semantic, isDarkMode)}`}>
                    占用 {formatNumber(occupied)}（{Math.round(ratio * 100)}%）
                  </span>
                  {row.note && <span className="text-[11px] text-text-tertiary truncate">{row.note}</span>}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => onEdit(row)}
                      className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDelete(row)}
                      className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* 占用条（flat：纯色膜，无阴影） */}
                <div className="mt-2 h-1.5 rounded-full bg-surface-primary overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${statusSemanticBg(semantic, isDarkMode)}`}
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-surface-elevated rounded-panel w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-text-tertiary mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full bg-surface-primary text-text-primary text-sm rounded-control px-3 py-2 border border-border-subtle outline-none focus:border-border-action";

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
        alert('请选择供应商（Relation）');
        return;
      }
      onSave({ relationId, ...payload } as FactoryProfileInput);
    }
  };

  return (
    <ModalShell title={profile ? '编辑工厂档案' : '新建工厂档案'} onClose={onClose}>
      {!profile && (
        <Field label="供应商（category=Supplier 的组织）*">
          <select className={inputClass} value={relationId} onChange={(e) => setRelationId(e.target.value)}>
            <option value="">选择供应商...</option>
            {relations.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {relations.length === 0 && (
            <div className="text-[11px] text-text-tertiary mt-1">
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
          <select className={inputClass} value={capacityUnit} onChange={(e) => setCapacityUnit(e.target.value)}>
            {CAPACITY_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="工人数量">
          <input type="number" className={inputClass} value={workerCount} onChange={(e) => setWorkerCount(e.target.value)} />
        </Field>
        <Field label="价位水平">
          <select className={inputClass} value={priceLevel} onChange={(e) => setPriceLevel(e.target.value as FactoryPriceLevel | '')}>
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
        <input type="date" className={inputClass} value={firstOrderAt} onChange={(e) => setFirstOrderAt(e.target.value)} />
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
        <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
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
      alert('评分必须是 0-100 的数字');
      return;
    }
    onSave({ kind, score: num, sourceType: 'manual', evaluatedAt, note: note || null });
  };

  return (
    <ModalShell title="手动追加评分" onClose={onClose}>
      <Field label="评分类型 *">
        <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as FactoryEvaluationKind)}>
          <option value="inspection">验货质量</option>
          <option value="delivery">交期达成</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="分数（0-100）*">
          <input type="number" min={0} max={100} className={inputClass} value={score} onChange={(e) => setScore(e.target.value)} />
        </Field>
        <Field label="评定日期 *">
          <input type="date" className={inputClass} value={evaluatedAt} onChange={(e) => setEvaluatedAt(e.target.value)} />
        </Field>
      </div>
      <Field label="备注">
        <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="评定依据说明" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
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
      alert('请填写认证类型');
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
          className={inputClass}
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
          <input type="date" className={inputClass} value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
        </Field>
        <Field label="有效期至">
          <input type="date" className={inputClass} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={longTerm} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-text-tertiary mb-3">
        <input type="checkbox" checked={longTerm} onChange={(e) => setLongTerm(e.target.checked)} />
        长期有效（无到期日）
      </label>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
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
      alert('月份格式必须是 YYYY-MM');
      return;
    }
    if (capacity === '' || Number.isNaN(num) || num < 0) {
      alert('产能必须是非负数字');
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
        <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
          {CAPACITY_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </Field>
      <Field label="备注">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：春节月减半" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
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
      alert('拉黑原因必填');
      return;
    }
    onSave(reason.trim());
  };

  return (
    <ModalShell title={`拉黑「${profile.relation?.name || profile.relationId}」`} onClose={onClose}>
      <div className={`mb-3 px-3 py-2 rounded-card border text-xs ${statusSemanticClass('warning')}`}>
        拉黑后该工厂将被禁止新建采购单，直至解除拉黑。此操作需要管理权限。
      </div>
      <Field label="拉黑原因 *">
        <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：连续两次验货不合格 / 严重延期" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
        >
          确认拉黑
        </button>
      </div>
    </ModalShell>
  );
}
