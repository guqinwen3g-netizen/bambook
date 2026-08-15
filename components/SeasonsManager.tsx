/**
 * 季节性与趋势管理 SeasonsManager
 * 阶段 H H2：季节性与趋势管理前端
 *
 * 功能：
 *   1. 季度 Seasons — 季度卡片列表 / 开发日历 timeline / 季度回顾快照（服务端聚合生成）
 *   2. 趋势 Trends — 趋势标签（面料/色彩/工艺/成分）+ 关联面料（数字档案 Fabric 搜索）
 *   3. 展会 TradeShows — 展会 CRUD / 线索 leads 全生命周期 / ROI 实时聚合 / 线索转化 Relation
 *
 * 设计原则：
 *   - 季度回顾为服务端快照，前端只读展示 + 触发生成
 *   - 线索转化真源在 Relation（category=Customer），前端只做选择与提交
 *   - BDS v2.1：视觉层已迁移至组件族（bds-tabs/bds-card/bds-badge/bds-table/bds-input/bds-modal/bds-empty 等），
 *     状态用 bds-badge 语义变体（SEMANTIC_BADGE_VARIANT 常量）替代 statusSemanticClass 拼装，主题透明无 isDarkMode 三元
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
  Pencil,
  CalendarRange,
  TrendingUp,
  Store,
  MapPin,
  BarChart3,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Relation,
  ProductAssetDetail,
  Season,
  SeasonInput,
  SeasonPatch,
  SeasonStatus,
  SeasonCalendarItem,
  SeasonReview,
  TrendTag,
  TrendTagInput,
  TrendTagType,
  TradeShow,
  TradeShowInput,
  TradeShowStatus,
  TradeShowROI,
  TradeShowLead,
  TradeShowLeadInput,
  TradeShowLeadStatus,
} from '../types';
import { PageHeader } from './ui/PageHeader';
import { StatusSemantic } from './rdlBusinessStatusTokens';

// ==================== 常量 ====================

type ModuleTab = 'seasons' | 'trends' | 'shows';

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'seasons', label: '季度 Seasons', icon: CalendarRange },
  { id: 'trends', label: '趋势 Trends', icon: TrendingUp },
  { id: 'shows', label: '展会 Trade Shows', icon: Store },
];

const SEASON_STATUS_LABELS: Record<SeasonStatus, string> = {
  Planning: '规划中',
  Active: '进行中',
  Closed: '已收官',
};

const SEASON_STATUS_SEMANTIC: Record<SeasonStatus, StatusSemantic> = {
  Planning: 'info',
  Active: 'active',
  Closed: 'neutral',
};

const TREND_TYPE_LABELS: Record<TrendTagType, string> = {
  fabric: '面料',
  color: '色彩',
  craft: '工艺',
  composition: '成分',
};

const SHOW_STATUS_LABELS: Record<TradeShowStatus, string> = {
  Planned: '已计划',
  Ongoing: '进行中',
  Completed: '已完成',
  Cancelled: '已取消',
};

const SHOW_STATUS_SEMANTIC: Record<TradeShowStatus, StatusSemantic> = {
  Planned: 'info',
  Ongoing: 'active',
  Completed: 'success',
  Cancelled: 'neutral',
};

const LEAD_STATUS_LABELS: Record<TradeShowLeadStatus, string> = {
  New: '新线索',
  Following: '跟进中',
  Converted: '已转化',
  Lost: '已流失',
};

const LEAD_STATUS_SEMANTIC: Record<TradeShowLeadStatus, StatusSemantic> = {
  New: 'info',
  Following: 'warning',
  Converted: 'success',
  Lost: 'neutral',
};

// BDS v2.1：StatusSemantic → bds-badge 语义变体（active 归并 info；替代 statusSemanticClass 拼装）
type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger' | 'warning';
const SEMANTIC_BADGE_VARIANT: Record<StatusSemantic, BadgeVariant> = {
  neutral: 'neutral',
  active: 'info',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
  destructive: 'danger',
  rebate: 'info',
};

/** 非 badge 结构（ROI 指标卡 / 线索状态下拉）共用的 tint/text token 样式 */
const SEMANTIC_TINT_STYLE: Record<BadgeVariant, React.CSSProperties> = {
  neutral: { background: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
  info: { background: 'var(--accent-tint)', color: 'var(--accent-text)' },
  success: { background: 'var(--success-tint)', color: 'var(--success-text)' },
  warning: { background: 'var(--warning-tint)', color: 'var(--warning-text)' },
  danger: { background: 'var(--danger-tint)', color: 'var(--danger-text)' },
};

const CURRENCIES = ['USD', 'CNY', 'EUR'];

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return dateStr;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function formatMoney(value: number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined) return '—';
  return `${currency || 'USD'} ${formatNumber(value)}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-CN', { hour12: false });
}

// ==================== 组件 Props ====================

interface SeasonsManagerProps {
  isDarkMode?: boolean;
}

// ==================== 主组件 ====================

export default function SeasonsManager({ isDarkMode }: SeasonsManagerProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>('seasons');

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="季节性与趋势" subtitle="Season & Trend Management" />

      {/* 模块 Tab 栏（BDS Tabs 下划线式） */}
      <div className="px-7 shrink-0">
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
            {activeTab === 'seasons' && <SeasonsPanel />}
            {activeTab === 'trends' && <TrendsPanel />}
            {activeTab === 'shows' && <ShowsPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 季度 Panel ====================

// ── BDS v2.1：本组件对主题透明 — 无 isDarkMode 分支，暗色由 tokens.css [data-theme] 统一覆盖 ──

function SeasonsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | SeasonStatus>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<Season | null>(null);
  const [review, setReview] = useState<SeasonReview | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [generatingReview, setGeneratingReview] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingSeason, setEditingSeason] = useState<Season | null>(null);

  // ── 加载季度列表 ──
  const loadSeasons = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiService.listSeasons({
        status: statusFilter || undefined,
        search: search || undefined,
      });
      setSeasons(result.items);
      setTotal(result.total);
      if (!selectedId && result.items.length > 0) {
        setSelectedId(result.items[0].id);
      }
    } catch (e) {
      console.error('[SeasonsManager] loadSeasons failed', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, selectedId]);

  useEffect(() => {
    const timer = setTimeout(() => { loadSeasons(); }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadSeasons, search]);

  // ── 加载季度详情 + 回顾 ──
  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      setReview(null);
      return;
    }
    setDetailLoading(true);
    try {
      const [item, reviewData] = await Promise.all([
        apiService.getSeason(selectedId),
        apiService.getSeasonReview(selectedId),
      ]);
      setDetail(item);
      setReview(reviewData);
    } catch (e) {
      console.error('[SeasonsManager] loadSeasonDetail failed', e);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSeasons(), loadDetail()]);
  }, [loadSeasons, loadDetail]);

  // ── 操作 ──
  const handleSave = async (input: SeasonInput | SeasonPatch, id?: string) => {
    try {
      if (id) {
        await apiService.updateSeason(id, input as SeasonPatch);
      } else {
        await apiService.createSeason(input as SeasonInput);
      }
      setShowForm(false);
      setEditingSeason(null);
      await refreshAll();
    } catch (e: any) {
      alert(`保存季度失败：${e?.message || e}`);
    }
  };

  const handleDelete = async (season: Season) => {
    if (!confirm(`确认删除季度「${season.code} ${season.name}」？关联的趋势标签与展会将保留但失去季度归属。`)) return;
    try {
      await apiService.deleteSeason(season.id);
      if (selectedId === season.id) setSelectedId(null);
      await refreshAll();
    } catch (e: any) {
      alert(`删除失败：${e?.message || e}`);
    }
  };

  const handleGenerateReview = async () => {
    if (!selectedId) return;
    setGeneratingReview(true);
    try {
      const data = await apiService.generateSeasonReview(selectedId);
      setReview(data);
    } catch (e: any) {
      alert(`生成季度回顾失败：${e?.message || e}`);
    } finally {
      setGeneratingReview(false);
    }
  };

  const selectedSeason = useMemo(
    () => seasons.find((s) => s.id === selectedId) ?? null,
    [seasons, selectedId],
  );

  return (
    <div className="h-full flex min-h-0 gap-4">
      {/* ── 左侧：季度卡片列表 ── */}
      <div className="w-80 shrink-0 flex flex-col bds-card overflow-hidden" style={{ padding: 0 }}>
        <div className="p-3 space-y-2" style={{ borderBottom: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
              <input
                type="text"
                placeholder="搜索季度代码 / 名称..."
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
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="bds-segment flex-wrap">
              {(['', 'Planning', 'Active', 'Closed'] as const).map((s) => (
                <button
                  key={s || 'all'}
                  onClick={() => setStatusFilter(s)}
                  className={`seg ${statusFilter === s ? 'active' : ''}`}
                >
                  {s === '' ? '全部' : SEASON_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setEditingSeason(null); setShowForm(true); }}
              className="bds-btn bds-btn-secondary ml-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              新建季度
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
            </div>
          ) : seasons.length === 0 ? (
            <div className="bds-empty">
              <div className="glyph"><CalendarRange className="w-6 h-6" /></div>
              <div className="title">{search ? '未找到匹配的季度' : '暂无季度'}</div>
              {!search && <div className="desc">点击「新建季度」开始规划</div>}
            </div>
          ) : (
            <div className="bds-listrows px-2 py-1">
              {seasons.map((s) => {
                const isSelected = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className="bds-listrow w-full text-left"
                    style={isSelected ? { background: 'var(--bg-panel)' } : undefined}
                  >
                    <div className="lr-main">
                      <div className="flex items-center gap-2">
                        <span className="lr-title flex-1" style={{ color: 'var(--text-primary)' }}>{s.code}</span>
                        <span className={`bds-badge sm shrink-0 ${SEMANTIC_BADGE_VARIANT[SEASON_STATUS_SEMANTIC[s.status] ?? 'neutral']}`}>
                          {SEASON_STATUS_LABELS[s.status] || s.status}
                        </span>
                      </div>
                      <div className="lr-sub mt-1 truncate">{s.name}</div>
                      <div className="lr-sub mt-1">
                        {formatDate(s.startDate)} ~ {formatDate(s.endDate)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-4 py-2 text-[11px]" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          共 {total} 个季度
        </div>
      </div>

      {/* ── 右侧：季度详情 ── */}
      <div className="flex-1 min-w-0 flex flex-col bds-card overflow-hidden" style={{ padding: 0 }}>
        {!selectedSeason ? (
          <div className="bds-empty flex-1 justify-center">
            <div className="glyph"><CalendarRange className="w-6 h-6" /></div>
            <div className="title">请选择左侧季度查看详情</div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* 季度头部 */}
            <div className="p-5" style={{ borderBottom: 'var(--border-subtle)' }}>
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="bds-text-lg" style={{ color: 'var(--text-primary)' }}>{selectedSeason.code}</h2>
                    <span className={`bds-badge sm shrink-0 ${SEMANTIC_BADGE_VARIANT[SEASON_STATUS_SEMANTIC[selectedSeason.status] ?? 'neutral']}`}>
                      {SEASON_STATUS_LABELS[selectedSeason.status] || selectedSeason.status}
                    </span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{selectedSeason.name}</div>
                  <div className="mt-2 flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                    <span>{formatDate(selectedSeason.startDate)} ~ {formatDate(selectedSeason.endDate)}</span>
                    <span>{detail?.trendTags?.length ?? 0} 个趋势标签</span>
                    <span>{detail?.tradeShows?.length ?? 0} 场展会</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => { setEditingSeason(detail ?? selectedSeason); setShowForm(true); }}
                  className="bds-btn bds-btn-secondary"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  编辑季度
                </button>
                <button
                  onClick={() => handleDelete(detail ?? selectedSeason)}
                  className="bds-btn bds-btn-danger ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              </div>
              {(detail?.notes || selectedSeason.notes) && (
                <div className="mt-3 px-3 py-2 rounded-inset text-xs whitespace-pre-wrap" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>
                  {detail?.notes || selectedSeason.notes}
                </div>
              )}
            </div>

            <div className="p-5 space-y-5">
              {/* 开发日历 timeline */}
              <section>
                <div className="bds-overline mb-3" style={{ color: 'var(--text-tertiary)' }}>开发日历</div>
                {(detail?.calendar ?? []).length > 0 ? (
                  <div className="relative pl-5">
                    <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px" style={{ background: 'var(--border-c-subtle)' }} />
                    <div className="space-y-3">
                      {(detail?.calendar ?? []).map((node) => (
                        <div key={node.key} className="relative flex items-start gap-3">
                          <span className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full" style={{ background: 'var(--accent)' }} />
                          <div className="min-w-0 flex-1 rounded-inset px-3 py-2" style={{ background: 'var(--bg-panel)' }}>
                            <div className="flex items-center gap-2">
                              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{node.label}</span>
                              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{node.key}</span>
                            </div>
                            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              {formatDate(node.startDate)} ~ {formatDate(node.endDate)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-sm rounded-inset" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-panel)' }}>
                    暂无开发日历节点，点击「编辑季度」维护开发里程碑
                  </div>
                )}
              </section>

              {/* 季度回顾 */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>季度回顾</div>
                  {review && (
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>生成于 {formatDateTime(review.generatedAt)}</span>
                  )}
                  <button
                    onClick={handleGenerateReview}
                    disabled={generatingReview}
                    className="bds-btn bds-btn-secondary ml-auto"
                  >
                    {generatingReview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
                    {review ? '重新生成回顾' : '生成季度回顾'}
                  </button>
                </div>
                {review ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        { label: '接单量', value: `${formatNumber(review.orderCount)} 单` },
                        { label: '出货量', value: formatNumber(review.shippedCount) },
                        { label: '营收', value: formatNumber(review.revenue) },
                        { label: '成本', value: formatNumber(review.cost) },
                        { label: '毛利', value: formatNumber(review.grossProfit) },
                      ].map((m) => (
                        <div key={m.label} className="rounded-inset p-3" style={{ background: 'var(--bg-panel)' }}>
                          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{m.label}</div>
                          <div className="bds-tnum text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                    {review.topCustomers.length > 0 && (
                      <div className="rounded-inset overflow-hidden" style={{ background: 'var(--bg-panel)' }}>
                        <div className="px-4 py-2 text-xs" style={{ borderBottom: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                          Top {review.topCustomers.length} 客户
                        </div>
                        <div>
                          {review.topCustomers.map((c, idx) => (
                            <div key={`${c.customer}-${idx}`} className="flex items-center gap-3 px-4 py-2" style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}>
                              <span className="text-[11px] w-5" style={{ color: 'var(--text-tertiary)' }}>{idx + 1}</span>
                              <span className="text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }}>{c.customer}</span>
                              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{c.orderCount} 单</span>
                              <span className="bds-tnum text-xs" style={{ color: 'var(--text-secondary)' }}>{formatNumber(c.revenue)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 text-sm rounded-inset" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-panel)' }}>
                    尚未生成季度回顾，点击「生成季度回顾」按当前订单数据聚合快照
                  </div>
                )}
              </section>

              {/* 关联趋势 / 展会 */}
              {detail && (detail.trendTags?.length || detail.tradeShows?.length) ? (
                <section className="grid grid-cols-2 gap-3">
                  <div className="rounded-inset p-3" style={{ background: 'var(--bg-panel)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>趋势标签</div>
                    {(detail.trendTags ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(detail.trendTags ?? []).map((t) => (
                          <span key={t.id} className="bds-badge sm info">
                            {t.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>暂无</div>
                    )}
                  </div>
                  <div className="rounded-inset p-3" style={{ background: 'var(--bg-panel)' }}>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>展会</div>
                    {(detail.tradeShows ?? []).length > 0 ? (
                      <div className="space-y-1.5">
                        {(detail.tradeShows ?? []).map((show) => (
                          <div key={show.id} className="flex items-center gap-2">
                            <Store className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                            <span className="text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }}>{show.name}</span>
                            <span className={`bds-badge sm shrink-0 ${SEMANTIC_BADGE_VARIANT[SHOW_STATUS_SEMANTIC[show.status] ?? 'neutral']}`}>
                              {SHOW_STATUS_LABELS[show.status] || show.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>暂无</div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* 弹窗 */}
      <AnimatePresence>
        {showForm && (
          <SeasonForm
            season={editingSeason}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditingSeason(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== 趋势 Panel ====================

function TrendsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [tags, setTags] = useState<TrendTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [seasonFilter, setSeasonFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | TrendTagType>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingTag, setEditingTag] = useState<TrendTag | null>(null);

  const loadSeasons = useCallback(async () => {
    try {
      const result = await apiService.listSeasons();
      setSeasons(result.items);
    } catch (e) {
      console.error('[SeasonsManager] trends loadSeasons failed', e);
    }
  }, []);

  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const items = await apiService.listTrendTags({
        seasonId: seasonFilter || undefined,
        type: typeFilter || undefined,
      });
      setTags(items);
    } catch (e) {
      console.error('[SeasonsManager] loadTrendTags failed', e);
    } finally {
      setLoading(false);
    }
  }, [seasonFilter, typeFilter]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const handleSave = async (input: TrendTagInput, tagId?: string) => {
    try {
      if (tagId) {
        await apiService.updateTrendTag(tagId, input);
      } else {
        await apiService.createTrendTag(input);
      }
      setShowForm(false);
      setEditingTag(null);
      await loadTags();
    } catch (e: any) {
      alert(`保存趋势标签失败：${e?.message || e}`);
    }
  };

  const handleDelete = async (tag: TrendTag) => {
    if (!confirm(`确认删除趋势标签「${tag.name}」？关联面料将一并解除。`)) return;
    try {
      await apiService.deleteTrendTag(tag.id);
      if (expandedId === tag.id) setExpandedId(null);
      await loadTags();
    } catch (e: any) {
      alert(`删除失败：${e?.message || e}`);
    }
  };

  const handleLinkFabric = async (tagId: string, fabricId: string, note?: string) => {
    try {
      await apiService.linkTrendFabric(tagId, { fabricId, note: note || null });
      await loadTags();
    } catch (e: any) {
      alert(`关联面料失败：${e?.message || e}`);
    }
  };

  const handleUnlinkFabric = async (tagId: string, fabricId: string) => {
    try {
      await apiService.unlinkTrendFabric(tagId, fabricId);
      await loadTags();
    } catch (e: any) {
      alert(`移除关联面料失败：${e?.message || e}`);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 bds-card overflow-hidden" style={{ padding: 0 }}>
      {/* 过滤栏 */}
      <div className="p-3 flex items-center gap-2 flex-wrap" style={{ borderBottom: 'var(--border-subtle)' }}>
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          className="bds-select"
          style={{ width: 'auto', height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}
        >
          <option value="">全部季度</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.code} {s.name}</option>
          ))}
        </select>
        <div className="bds-segment flex-wrap">
          {(['', 'fabric', 'color', 'craft', 'composition'] as const).map((t) => (
            <button
              key={t || 'all'}
              onClick={() => setTypeFilter(t)}
              className={`seg ${typeFilter === t ? 'active' : ''}`}
            >
              {t === '' ? '全部' : TREND_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <button
          onClick={loadTags}
          className="bds-btn bds-btn-ghost bds-btn-icon"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setEditingTag(null); setShowForm(true); }}
          className="bds-btn bds-btn-secondary ml-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          新建标签
        </button>
      </div>

      {/* 标签卡片列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : tags.length === 0 ? (
          <div className="bds-empty">
            <div className="glyph"><TrendingUp className="w-6 h-6" /></div>
            <div className="title">暂无趋势标签</div>
            <div className="desc">点击「新建标签」开始收集趋势</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {tags.map((tag) => {
              const expanded = expandedId === tag.id;
              const links = tag.fabricLinks ?? [];
              return (
                <div key={tag.id} className="bds-card flat" style={{ padding: 'var(--space-4)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }}>{tag.name}</span>
                    <span className="bds-badge sm info shrink-0">
                      {TREND_TYPE_LABELS[tag.type] || tag.type}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                    <span>{links.length} 款关联面料</span>
                    {tag.tradeShow?.name && <span>来源展会：{tag.tradeShow.name}</span>}
                    {!tag.tradeShow?.name && tag.source && <span>来源：{tag.source}</span>}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      onClick={() => setExpandedId(expanded ? null : tag.id)}
                      className="bds-btn bds-btn-ghost"
                    >
                      <ArrowRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      {expanded ? '收起面料' : '展开面料'}
                    </button>
                    <button
                      onClick={() => { setEditingTag(tag); setShowForm(true); }}
                      className="bds-btn bds-btn-ghost bds-btn-icon"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(tag)}
                      className="bds-btn bds-btn-ghost bds-btn-icon ml-auto"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {expanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: 'var(--border-subtle)' }}>
                          {tag.description && (
                            <div className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{tag.description}</div>
                          )}
                          {links.length === 0 ? (
                            <div className="text-xs py-2" style={{ color: 'var(--text-tertiary)' }}>尚未关联面料</div>
                          ) : (
                            <div className="space-y-1.5">
                              {links.map((link) => (
                                <div key={link.id} className="flex items-center gap-2 rounded-bds-md px-2.5 py-1.5" style={{ background: 'var(--bg-card)' }}>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                                      {link.fabric?.productAsset?.name || link.fabric?.articleNo || link.fabricId}
                                    </div>
                                    <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                                      {link.fabric?.productAsset?.sku || ''}
                                      {link.note ? ` · ${link.note}` : ''}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleUnlinkFabric(tag.id, link.fabricId)}
                                    className="bds-btn bds-btn-ghost bds-btn-icon shrink-0"
                                    title="移除关联"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <FabricLinker
                            linkedFabricIds={links.map((l) => l.fabricId)}
                            onLink={(fabricId, note) => handleLinkFabric(tag.id, fabricId, note)}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 弹窗 */}
      <AnimatePresence>
        {showForm && (
          <TrendTagForm
            tag={editingTag}
            seasons={seasons}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditingTag(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 关联面料搜索 ───

function FabricLinker({
  linkedFabricIds,
  onLink,
}: {
  linkedFabricIds: string[];
  onLink: (fabricId: string, note?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [results, setResults] = useState<ProductAssetDetail[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const assets = await apiService.listProductAssets(undefined, {
          mainCategory: 'Fabric',
          search: query.trim(),
          limit: 10,
        });
        if (!cancelled) setResults(assets);
      } catch (e) {
        console.error('[SeasonsManager] search fabrics failed', e);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return (
    <div className="pt-1">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />
          <input
            type="text"
            placeholder="搜索面料名称 / SKU 关联..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bds-input sm pl-9"
          />
          {searching && <Loader2 className="w-3 h-3 animate-spin absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-quaternary)' }} />}
        </div>
        <input
          type="text"
          placeholder="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="bds-input sm w-28"
        />
      </div>
      {results.length > 0 && (
        <div className="mt-1.5 rounded-bds-md max-h-40 overflow-y-auto" style={{ border: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
          {results.map((asset, idx) => {
            const fabricId = asset.fabricProfile?.id;
            const alreadyLinked = fabricId != null && linkedFabricIds.includes(fabricId);
            return (
              <button
                key={asset.id}
                disabled={!fabricId || alreadyLinked}
                onClick={() => {
                  if (!fabricId) return;
                  onLink(fabricId, note.trim() || undefined);
                  setQuery('');
                  setResults([]);
                  setNote('');
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--hover-darken)] disabled:opacity-40 disabled:hover:bg-transparent"
                style={idx > 0 ? { borderTop: 'var(--border-subtle)' } : undefined}
              >
                <span className="text-xs truncate flex-1" style={{ color: 'var(--text-primary)' }}>{asset.name}</span>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>{asset.sku}</span>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  {!fabricId ? '无面料档案' : alreadyLinked ? '已关联' : '关联'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==================== 展会 Panel ====================

function ShowsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [shows, setShows] = useState<TradeShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [seasonFilter, setSeasonFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | TradeShowStatus>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<TradeShow | null>(null);
  const [roi, setRoi] = useState<TradeShowROI | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingShow, setEditingShow] = useState<TradeShow | null>(null);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [editingLead, setEditingLead] = useState<TradeShowLead | null>(null);
  const [convertingLead, setConvertingLead] = useState<TradeShowLead | null>(null);

  const loadSeasons = useCallback(async () => {
    try {
      const result = await apiService.listSeasons();
      setSeasons(result.items);
    } catch (e) {
      console.error('[SeasonsManager] shows loadSeasons failed', e);
    }
  }, []);

  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  // ── 加载展会列表 ──
  const loadShows = useCallback(async () => {
    setLoading(true);
    try {
      const items = await apiService.listTradeShows({
        seasonId: seasonFilter || undefined,
        status: statusFilter || undefined,
      });
      setShows(items);
      if (!selectedId && items.length > 0) {
        setSelectedId(items[0].id);
      }
    } catch (e) {
      console.error('[SeasonsManager] loadTradeShows failed', e);
    } finally {
      setLoading(false);
    }
  }, [seasonFilter, statusFilter, selectedId]);

  useEffect(() => {
    loadShows();
  }, [loadShows]);

  // ── 加载展会详情 + ROI ──
  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      setRoi(null);
      return;
    }
    setDetailLoading(true);
    try {
      const data = await apiService.getTradeShow(selectedId);
      setDetail(data?.item ?? null);
      setRoi(data?.roi ?? null);
    } catch (e) {
      console.error('[SeasonsManager] loadTradeShowDetail failed', e);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadShows(), loadDetail()]);
  }, [loadShows, loadDetail]);

  // ── 展会操作 ──
  const handleSaveShow = async (input: TradeShowInput, showId?: string, status?: TradeShowStatus) => {
    try {
      if (showId) {
        await apiService.updateTradeShow(showId, { ...input, status });
      } else {
        await apiService.createTradeShow(input);
      }
      setShowForm(false);
      setEditingShow(null);
      await refreshAll();
    } catch (e: any) {
      alert(`保存展会失败：${e?.message || e}`);
    }
  };

  const handleDeleteShow = async (show: TradeShow) => {
    if (!confirm(`确认删除展会「${show.name}」？其下线索将一并删除。`)) return;
    try {
      await apiService.deleteTradeShow(show.id);
      if (selectedId === show.id) setSelectedId(null);
      await refreshAll();
    } catch (e: any) {
      alert(`删除失败：${e?.message || e}`);
    }
  };

  // ── 线索操作 ──
  const handleSaveLead = async (input: TradeShowLeadInput, leadId?: string, status?: TradeShowLeadStatus) => {
    if (!selectedId) return;
    try {
      if (leadId) {
        await apiService.updateTradeShowLead(leadId, { ...input, status });
      } else {
        await apiService.addTradeShowLead(selectedId, input);
      }
      setShowLeadForm(false);
      setEditingLead(null);
      await loadDetail();
    } catch (e: any) {
      alert(`保存线索失败：${e?.message || e}`);
    }
  };

  const handleLeadStatus = async (lead: TradeShowLead, status: TradeShowLeadStatus) => {
    try {
      await apiService.updateTradeShowLead(lead.id, { status });
      await loadDetail();
    } catch (e: any) {
      alert(`更新线索状态失败：${e?.message || e}`);
    }
  };

  const handleDeleteLead = async (lead: TradeShowLead) => {
    if (!confirm(`确认删除线索「${lead.customerName}」？`)) return;
    try {
      await apiService.deleteTradeShowLead(lead.id);
      await loadDetail();
    } catch (e: any) {
      alert(`删除线索失败：${e?.message || e}`);
    }
  };

  const handleConvertLead = async (relationId: string) => {
    if (!convertingLead) return;
    try {
      await apiService.convertTradeShowLead(convertingLead.id, relationId);
      setConvertingLead(null);
      await loadDetail();
    } catch (e: any) {
      alert(`线索转化失败：${e?.message || e}`);
    }
  };

  const selectedShow = useMemo(
    () => shows.find((s) => s.id === selectedId) ?? null,
    [shows, selectedId],
  );

  return (
    <div className="h-full flex min-h-0 gap-4">
      {/* ── 左侧：展会列表 ── */}
      <div className="w-80 shrink-0 flex flex-col bds-card overflow-hidden" style={{ padding: 0 }}>
        <div className="p-3 space-y-2" style={{ borderBottom: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <select
              value={seasonFilter}
              onChange={(e) => setSeasonFilter(e.target.value)}
              className="bds-select flex-1 min-w-0"
              style={{ width: 'auto', height: 'var(--h-input-sm)', fontSize: 'var(--text-xs)' }}
            >
              <option value="">全部季度</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.code} {s.name}</option>
              ))}
            </select>
            <button
              onClick={refreshAll}
              className="bds-btn bds-btn-ghost bds-btn-icon"
              title="刷新"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="bds-segment flex-wrap">
              {(['', 'Planned', 'Ongoing', 'Completed', 'Cancelled'] as const).map((s) => (
                <button
                  key={s || 'all'}
                  onClick={() => setStatusFilter(s)}
                  className={`seg ${statusFilter === s ? 'active' : ''}`}
                >
                  {s === '' ? '全部' : SHOW_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setEditingShow(null); setShowForm(true); }}
              className="bds-btn bds-btn-secondary ml-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              新建展会
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
            </div>
          ) : shows.length === 0 ? (
            <div className="bds-empty">
              <div className="glyph"><Store className="w-6 h-6" /></div>
              <div className="title">暂无展会记录</div>
              <div className="desc">点击「新建展会」开始</div>
            </div>
          ) : (
            <div className="bds-listrows px-2 py-1">
              {shows.map((show) => {
                const isSelected = show.id === selectedId;
                return (
                  <button
                    key={show.id}
                    onClick={() => setSelectedId(show.id)}
                    className="bds-listrow w-full text-left"
                    style={isSelected ? { background: 'var(--bg-panel)' } : undefined}
                  >
                    <div className="lr-main">
                      <div className="flex items-center gap-2">
                        <span className="lr-title flex-1" style={{ color: 'var(--text-primary)' }}>{show.name}</span>
                        <span className={`bds-badge sm shrink-0 ${SEMANTIC_BADGE_VARIANT[SHOW_STATUS_SEMANTIC[show.status] ?? 'neutral']}`}>
                          {SHOW_STATUS_LABELS[show.status] || show.status}
                        </span>
                      </div>
                      <div className="lr-sub mt-1.5 flex items-center gap-2">
                        <span>{formatDate(show.startDate)}{show.endDate ? ` ~ ${formatDate(show.endDate)}` : ''}</span>
                        {show.location && (
                          <span className="flex items-center gap-0.5 truncate">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {show.location}
                          </span>
                        )}
                        {show.cost != null && <span className="bds-tnum ml-auto shrink-0">{formatMoney(show.cost, show.currency)}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-4 py-2 text-[11px]" style={{ borderTop: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          共 {shows.length} 场展会
        </div>
      </div>

      {/* ── 右侧：展会详情 ── */}
      <div className="flex-1 min-w-0 flex flex-col bds-card overflow-hidden" style={{ padding: 0 }}>
        {!selectedShow ? (
          <div className="bds-empty flex-1 justify-center">
            <div className="glyph"><Store className="w-6 h-6" /></div>
            <div className="title">请选择左侧展会查看详情</div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* 展会头部 */}
            <div className="p-5" style={{ borderBottom: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <h2 className="bds-text-base truncate" style={{ color: 'var(--text-primary)' }}>{selectedShow.name}</h2>
                <span className={`bds-badge sm shrink-0 ${SEMANTIC_BADGE_VARIANT[SHOW_STATUS_SEMANTIC[selectedShow.status] ?? 'neutral']}`}>
                  {SHOW_STATUS_LABELS[selectedShow.status] || selectedShow.status}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                <span>{formatDate(selectedShow.startDate)}{selectedShow.endDate ? ` ~ ${formatDate(selectedShow.endDate)}` : ''}</span>
                {selectedShow.location && <span>地点 {selectedShow.location}</span>}
                {selectedShow.boothNo && <span>展位 {selectedShow.boothNo}</span>}
                {selectedShow.attendees != null && <span>接待 {selectedShow.attendees} 人</span>}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => { setEditingShow(detail ?? selectedShow); setShowForm(true); }}
                  className="bds-btn bds-btn-secondary"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  编辑展会
                </button>
                <button
                  onClick={() => { setEditingLead(null); setShowLeadForm(true); }}
                  className="bds-btn bds-btn-secondary"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新增线索
                </button>
                <button
                  onClick={() => handleDeleteShow(detail ?? selectedShow)}
                  className="bds-btn bds-btn-danger ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              </div>
              {(detail?.notes || selectedShow.notes) && (
                <div className="mt-3 px-3 py-2 rounded-inset text-xs whitespace-pre-wrap" style={{ background: 'var(--bg-panel)', color: 'var(--text-secondary)' }}>
                  {detail?.notes || selectedShow.notes}
                </div>
              )}
            </div>

            <div className="p-5 space-y-5">
              {/* ROI 卡片 */}
              {roi && (
                <section>
                  <div className="bds-overline mb-3" style={{ color: 'var(--text-tertiary)' }}>投资回报 ROI</div>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-inset p-3" style={{ background: 'var(--bg-panel)' }}>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>参展费用</div>
                      <div className="bds-tnum text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{formatMoney(roi.cost, roi.currency)}</div>
                    </div>
                    <div className="rounded-inset p-3" style={{ background: 'var(--bg-panel)' }}>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>转化订单金额</div>
                      <div className="bds-tnum text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{formatMoney(roi.orderAmount, roi.currency)}</div>
                    </div>
                    <div
                      className="rounded-inset p-3"
                      style={SEMANTIC_TINT_STYLE[roi.roi >= 1 ? 'success' : roi.cost > 0 ? 'warning' : 'neutral']}
                    >
                      <div className="text-xs opacity-70">ROI 倍数</div>
                      <div className="bds-tnum text-sm mt-1">{formatNumber(roi.roi)}x</div>
                    </div>
                    <div className="rounded-inset p-3" style={{ background: 'var(--bg-panel)' }}>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>转化订单</div>
                      <div className="bds-tnum text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{roi.orderCount} 单</div>
                    </div>
                  </div>
                  {/* 线索转化占比条 */}
                  <div className="mt-3 rounded-inset p-3" style={{ background: 'var(--bg-panel)' }}>
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      <span>线索 {roi.leadsTotal} 条</span>
                      <span>已转化 {roi.leadsConverted} 条</span>
                      <span className="ml-auto">
                        转化率 {roi.leadsTotal > 0 ? Math.round((roi.leadsConverted / roi.leadsTotal) * 100) : 0}%
                      </span>
                    </div>
                    <div className="bds-progress success mt-2">
                      <div
                        className="fill"
                        style={{ width: `${roi.leadsTotal > 0 ? Math.min((roi.leadsConverted / roi.leadsTotal) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* 线索列表 */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>展会线索（{detail?.leads?.length ?? 0}）</div>
                </div>
                {(detail?.leads ?? []).length === 0 ? (
                  <div className="text-center py-8 text-sm rounded-inset" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-panel)' }}>
                    暂无线索，点击「新增线索」录入展会名片
                  </div>
                ) : (
                  <div className="rounded-inset overflow-hidden" style={{ background: 'var(--bg-panel)' }}>
                    <table className="bds-table">
                      <thead>
                        <tr>
                          <th>客户</th>
                          <th>公司</th>
                          <th>国家</th>
                          <th>需求</th>
                          <th>状态</th>
                          <th>下次跟进</th>
                          <th className="num">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail?.leads ?? []).map((lead) => (
                          <tr key={lead.id}>
                            <td className="max-w-[140px] truncate" style={{ color: 'var(--text-primary)' }}>{lead.customerName}</td>
                            <td className="max-w-[120px] truncate" style={{ color: 'var(--text-secondary)' }}>{lead.company || '—'}</td>
                            <td className="max-w-[80px] truncate" style={{ color: 'var(--text-secondary)' }}>{lead.country || '—'}</td>
                            <td className="max-w-[180px] truncate" title={lead.demand || undefined} style={{ color: 'var(--text-tertiary)' }}>{lead.demand || '—'}</td>
                            <td>
                              <select
                                value={lead.status}
                                onChange={(e) => handleLeadStatus(lead, e.target.value as TradeShowLeadStatus)}
                                className="bds-select"
                                style={{
                                  width: 'auto',
                                  height: 'var(--h-input-sm)',
                                  fontSize: '11px',
                                  padding: '0 26px 0 10px',
                                  ...SEMANTIC_TINT_STYLE[SEMANTIC_BADGE_VARIANT[LEAD_STATUS_SEMANTIC[lead.status] ?? 'neutral']],
                                }}
                              >
                                {(Object.keys(LEAD_STATUS_LABELS) as TradeShowLeadStatus[]).map((s) => (
                                  <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ color: 'var(--text-tertiary)' }}>{formatDate(lead.nextFollowUpAt)}</td>
                            <td>
                              <div className="flex items-center gap-0.5 justify-end">
                                {lead.status !== 'Converted' && (
                                  <button
                                    onClick={() => setConvertingLead(lead)}
                                    className="bds-btn bds-btn-ghost bds-btn-icon"
                                    title="转化为客户"
                                  >
                                    <ArrowRight className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => { setEditingLead(lead); setShowLeadForm(true); }}
                                  className="bds-btn bds-btn-ghost bds-btn-icon"
                                  title="编辑"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteLead(lead)}
                                  className="bds-btn bds-btn-ghost bds-btn-icon"
                                  title="删除"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>

      {/* 弹窗 */}
      <AnimatePresence>
        {showForm && (
          <TradeShowForm
            show={editingShow}
            seasons={seasons}
            onSave={handleSaveShow}
            onClose={() => { setShowForm(false); setEditingShow(null); }}
          />
        )}
        {showLeadForm && (
          <LeadForm
            lead={editingLead}
            onSave={handleSaveLead}
            onClose={() => { setShowLeadForm(false); setEditingLead(null); }}
          />
        )}
        {convertingLead && (
          <ConvertLeadForm
            lead={convertingLead}
            onSave={handleConvertLead}
            onClose={() => setConvertingLead(null)}
          />
        )}
      </AnimatePresence>
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
          <h2 className="bds-text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}>
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

const inputClass = "bds-input";
const selectClass = "bds-select";
const textareaClass = "bds-input bds-textarea";

// ─── 季度表单（新建 / 编辑） ───

function SeasonForm({
  season,
  onSave,
  onClose,
}: {
  season: Season | null;
  onSave: (input: SeasonInput | SeasonPatch, id?: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(season?.code ?? '');
  const [name, setName] = useState(season?.name ?? '');
  const [startDate, setStartDate] = useState(season?.startDate ?? '');
  const [endDate, setEndDate] = useState(season?.endDate ?? '');
  const [status, setStatus] = useState<SeasonStatus>(season?.status ?? 'Planning');
  const [notes, setNotes] = useState(season?.notes ?? '');
  const [calendar, setCalendar] = useState<SeasonCalendarItem[]>(season?.calendar ?? []);

  const updateCalendarRow = (idx: number, patch: Partial<SeasonCalendarItem>) => {
    setCalendar((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const handleSubmit = () => {
    if (!season && !/^[A-Za-z]{2}\d{2}$/.test(code.trim())) {
      alert('季度代码格式如 SS26 / AW26（两位字母 + 两位数字）');
      return;
    }
    if (!name.trim() || !startDate || !endDate) {
      alert('季度名称与起止日期必填');
      return;
    }
    const cleanCalendar = calendar
      .map((row) => ({
        key: row.key.trim(),
        label: row.label.trim(),
        startDate: row.startDate,
        endDate: row.endDate,
      }))
      .filter((row) => row.key && row.label && row.startDate && row.endDate);
    if (season) {
      onSave({
        name: name.trim(),
        startDate,
        endDate,
        status,
        calendar: cleanCalendar.length > 0 ? cleanCalendar : null,
        notes: notes || null,
      }, season.id);
    } else {
      onSave({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        startDate,
        endDate,
        calendar: cleanCalendar.length > 0 ? cleanCalendar : null,
        notes: notes || null,
      });
    }
  };

  return (
    <ModalShell title={season ? `编辑季度 ${season.code}` : '新建季度'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="季度代码 *">
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SS26"
            disabled={!!season}
          />
          {!season && (
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>格式：SS26（春夏）/ AW26（秋冬），创建后不可修改</div>
          )}
        </Field>
        <Field label="季度名称 *">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="2026 春夏" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="开始日期 *">
          <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="结束日期 *">
          <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      {season && (
        <Field label="状态">
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as SeasonStatus)}>
            {(Object.keys(SEASON_STATUS_LABELS) as SeasonStatus[]).map((s) => (
              <option key={s} value={s}>{SEASON_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="备注">
        <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {/* 开发日历节点编辑 */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>开发日历（里程碑节点）</label>
          <button
            onClick={() => setCalendar((rows) => [...rows, { key: '', label: '', startDate: '', endDate: '' }])}
            className="bds-btn bds-btn-ghost"
          >
            <Plus className="w-3 h-3" />
            添加节点
          </button>
        </div>
        {calendar.length === 0 ? (
          <div className="text-[11px] py-2" style={{ color: 'var(--text-tertiary)' }}>暂无节点，点击「添加节点」维护开发里程碑（如 开发启动 / 打样截止 / 下单截止）</div>
        ) : (
          <div className="space-y-2">
            {calendar.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[0.8fr_1.2fr_1fr_1fr_auto] gap-1.5 items-center">
                <input
                  className={inputClass}
                  value={row.key}
                  onChange={(e) => updateCalendarRow(idx, { key: e.target.value })}
                  placeholder="key"
                />
                <input
                  className={inputClass}
                  value={row.label}
                  onChange={(e) => updateCalendarRow(idx, { label: e.target.value })}
                  placeholder="节点名称"
                />
                <input
                  type="date"
                  className={inputClass}
                  value={row.startDate}
                  onChange={(e) => updateCalendarRow(idx, { startDate: e.target.value })}
                />
                <input
                  type="date"
                  className={inputClass}
                  value={row.endDate}
                  onChange={(e) => updateCalendarRow(idx, { endDate: e.target.value })}
                />
                <button
                  onClick={() => setCalendar((rows) => rows.filter((_, i) => i !== idx))}
                  className="bds-btn bds-btn-ghost bds-btn-icon"
                  title="删除节点"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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

// ─── 趋势标签表单 ───

function TrendTagForm({
  tag,
  seasons,
  onSave,
  onClose,
}: {
  tag: TrendTag | null;
  seasons: Season[];
  onSave: (input: TrendTagInput, tagId?: string) => void;
  onClose: () => void;
}) {
  const [seasonId, setSeasonId] = useState(tag?.seasonId ?? '');
  const [type, setType] = useState<TrendTagType>(tag?.type ?? 'fabric');
  const [name, setName] = useState(tag?.name ?? '');
  const [description, setDescription] = useState(tag?.description ?? '');
  const [source, setSource] = useState(tag?.source ?? '');
  const [tradeShowId, setTradeShowId] = useState(tag?.tradeShowId ?? '');
  const [shows, setShows] = useState<TradeShow[]>([]);

  // 加载可选展会（按所选季度过滤，未选季度则全部可选）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await apiService.listTradeShows();
        if (!cancelled) setShows(items);
      } catch (e) {
        console.error('[SeasonsManager] load shows for tag form failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectableShows = useMemo(
    () => (seasonId ? shows.filter((s) => s.seasonId === seasonId) : shows),
    [shows, seasonId],
  );

  const handleSubmit = () => {
    if (!name.trim()) {
      alert('标签名称必填');
      return;
    }
    onSave({
      seasonId: seasonId || null,
      type,
      name: name.trim(),
      description: description || null,
      source: source || null,
      tradeShowId: tradeShowId || null,
    }, tag?.id);
  };

  return (
    <ModalShell title={tag ? '编辑趋势标签' : '新建趋势标签'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="所属季度">
          <select
            className={inputClass}
            value={seasonId}
            onChange={(e) => { setSeasonId(e.target.value); setTradeShowId(''); }}
          >
            <option value="">跨季通用</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.code} {s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="类型 *">
          <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as TrendTagType)}>
            {(Object.keys(TREND_TYPE_LABELS) as TrendTagType[]).map((t) => (
              <option key={t} value={t}>{TREND_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="标签名称 *">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="如：高支棉府绸 / 鼠尾草绿" />
      </Field>
      <Field label="描述">
        <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="来源说明">
          <input className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} placeholder="如：WGSN / 行业报告" />
        </Field>
        <Field label="来源展会">
          <select className={selectClass} value={tradeShowId} onChange={(e) => setTradeShowId(e.target.value)}>
            <option value="">无</option>
            {selectableShows.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
      </div>
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

// ─── 展会表单 ───

function TradeShowForm({
  show,
  seasons,
  onSave,
  onClose,
}: {
  show: TradeShow | null;
  seasons: Season[];
  onSave: (input: TradeShowInput, showId?: string, status?: TradeShowStatus) => void;
  onClose: () => void;
}) {
  const [seasonId, setSeasonId] = useState(show?.seasonId ?? '');
  const [name, setName] = useState(show?.name ?? '');
  const [location, setLocation] = useState(show?.location ?? '');
  const [startDate, setStartDate] = useState(show?.startDate ?? '');
  const [endDate, setEndDate] = useState(show?.endDate ?? '');
  const [boothNo, setBoothNo] = useState(show?.boothNo ?? '');
  const [attendees, setAttendees] = useState(show?.attendees?.toString() ?? '');
  const [cost, setCost] = useState(show?.cost?.toString() ?? '');
  const [currency, setCurrency] = useState(show?.currency ?? 'USD');
  const [status, setStatus] = useState<TradeShowStatus>(show?.status ?? 'Planned');
  const [notes, setNotes] = useState(show?.notes ?? '');

  const handleSubmit = () => {
    if (!name.trim() || !startDate) {
      alert('展会名称与开始日期必填');
      return;
    }
    onSave({
      seasonId: seasonId || null,
      name: name.trim(),
      location: location || null,
      startDate,
      endDate: endDate || null,
      boothNo: boothNo || null,
      attendees: attendees ? Number(attendees) : null,
      cost: cost ? Number(cost) : null,
      currency: currency || null,
      notes: notes || null,
    }, show?.id, show ? status : undefined);
  };

  return (
    <ModalShell title={show ? '编辑展会' : '新建展会'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="所属季度">
          <select className={selectClass} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">不关联季度</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.code} {s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="展会名称 *">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="如：Intertextile 上海面辅料展" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="开始日期 *">
          <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="结束日期">
          <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="地点">
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="上海 · 国家会展中心" />
        </Field>
        <Field label="展位号">
          <input className={inputClass} value={boothNo} onChange={(e) => setBoothNo(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="接待人数">
          <input type="number" min={0} className={inputClass} value={attendees} onChange={(e) => setAttendees(e.target.value)} />
        </Field>
        <Field label="参展费用">
          <input type="number" min={0} className={inputClass} value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field label="币种">
          <select className={selectClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {show && (
        <Field label="状态">
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as TradeShowStatus)}>
            {(Object.keys(SHOW_STATUS_LABELS) as TradeShowStatus[]).map((s) => (
              <option key={s} value={s}>{SHOW_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="备注">
        <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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

// ─── 线索表单 ───

function LeadForm({
  lead,
  onSave,
  onClose,
}: {
  lead: TradeShowLead | null;
  onSave: (input: TradeShowLeadInput, leadId?: string, status?: TradeShowLeadStatus) => void;
  onClose: () => void;
}) {
  const [customerName, setCustomerName] = useState(lead?.customerName ?? '');
  const [company, setCompany] = useState(lead?.company ?? '');
  const [country, setCountry] = useState(lead?.country ?? '');
  const [email, setEmail] = useState(lead?.email ?? '');
  const [phone, setPhone] = useState(lead?.phone ?? '');
  const [demand, setDemand] = useState(lead?.demand ?? '');
  const [nextFollowUpAt, setNextFollowUpAt] = useState(lead?.nextFollowUpAt ?? '');
  const [status, setStatus] = useState<TradeShowLeadStatus>(lead?.status ?? 'New');
  const [notes, setNotes] = useState(lead?.notes ?? '');

  const handleSubmit = () => {
    if (!customerName.trim()) {
      alert('客户姓名必填');
      return;
    }
    onSave({
      customerName: customerName.trim(),
      company: company || null,
      country: country || null,
      email: email || null,
      phone: phone || null,
      demand: demand || null,
      nextFollowUpAt: nextFollowUpAt || null,
      notes: notes || null,
    }, lead?.id, lead ? status : undefined);
  };

  return (
    <ModalShell title={lead ? '编辑线索' : '新增线索'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="客户姓名 *">
          <input className={inputClass} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </Field>
        <Field label="公司">
          <input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="国家">
          <input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} />
        </Field>
        <Field label="邮箱">
          <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="电话">
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      <Field label="需求">
        <textarea className={inputClass} rows={2} value={demand} onChange={(e) => setDemand(e.target.value)} placeholder="如：SS26 高支棉衬衫面料 3000 米" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="下次跟进日期">
          <input type="date" className={inputClass} value={nextFollowUpAt} onChange={(e) => setNextFollowUpAt(e.target.value)} />
        </Field>
        {lead && (
          <Field label="状态">
            <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as TradeShowLeadStatus)}>
              {(Object.keys(LEAD_STATUS_LABELS) as TradeShowLeadStatus[]).map((s) => (
                <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label="备注">
        <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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

// ─── 线索转化表单（选择 category=Customer 的 Relation） ───

function ConvertLeadForm({
  lead,
  onSave,
  onClose,
}: {
  lead: TradeShowLead;
  onSave: (relationId: string) => void;
  onClose: () => void;
}) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relationId, setRelationId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listRelations();
        if (cancelled) return;
        setRelations(list.filter((r) => r.category === 'Customer' && !r.deletedAt));
      } catch (e) {
        console.error('[SeasonsManager] load customer relations failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = () => {
    if (!relationId) {
      alert('请选择要转化到的客户（Relation）');
      return;
    }
    onSave(relationId);
  };

  return (
    <ModalShell title={`转化线索「${lead.customerName}」`} onClose={onClose}>
      <div className="bds-alert info mb-3">
        选择关系智库中 category=Customer 的客户档案，转化后线索状态将变为「已转化」并关联该客户。
      </div>
      <Field label="目标客户 *">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : (
          <select className={selectClass} value={relationId} onChange={(e) => setRelationId(e.target.value)}>
            <option value="">选择客户...</option>
            {relations.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
        {!loading && relations.length === 0 && (
          <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
            暂无客户档案，请先在「关系智库」创建 category=Customer 的客户
          </div>
        )}
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="bds-btn bds-btn-primary"
        >
          确认转化
        </button>
      </div>
    </ModalShell>
  );
}
