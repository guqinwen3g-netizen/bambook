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
import { statusSemanticClass, statusSemanticBg, StatusSemantic } from './rdlBusinessStatusTokens';

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

      {/* 模块 Tab 栏 */}
      <div className="px-7 flex items-center gap-1 border-b border-border-subtle shrink-0">
        {MODULE_TABS.map((tab) => {
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
            {activeTab === 'seasons' && <SeasonsPanel isDarkMode={isDarkMode} />}
            {activeTab === 'trends' && <TrendsPanel isDarkMode={isDarkMode} />}
            {activeTab === 'shows' && <ShowsPanel isDarkMode={isDarkMode} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== 季度 Panel ====================

function SeasonsPanel({ isDarkMode }: { isDarkMode?: boolean }) {
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
      <div className="w-80 shrink-0 flex flex-col rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
        <div className="p-3 border-b border-border-subtle space-y-2">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-text-tertiary shrink-0" />
            <input
              type="text"
              placeholder="搜索季度代码 / 名称..."
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
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['', 'Planning', 'Active', 'Closed'] as const).map((s) => (
              <button
                key={s || 'all'}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 text-xs rounded-control border transition-colors ${
                  statusFilter === s
                    ? statusSemanticClass('active', isDarkMode)
                    : 'text-text-tertiary border-transparent hover:text-text-secondary'
                }`}
              >
                {s === '' ? '全部' : SEASON_STATUS_LABELS[s]}
              </button>
            ))}
            <button
              onClick={() => { setEditingSeason(null); setShowForm(true); }}
              className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              新建季度
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
            </div>
          ) : seasons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-tertiary px-4">
              <CalendarRange className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm text-center">
                {search ? '未找到匹配的季度' : '暂无季度，点击「新建季度」开始规划'}
              </p>
            </div>
          ) : (
            seasons.map((s) => {
              const isSelected = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border-subtle transition-colors ${
                    isSelected ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base font-medium text-text-primary truncate flex-1">{s.code}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass(SEASON_STATUS_SEMANTIC[s.status] ?? 'neutral', isDarkMode)}`}>
                      {SEASON_STATUS_LABELS[s.status] || s.status}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-text-secondary truncate">{s.name}</div>
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    {formatDate(s.startDate)} ~ {formatDate(s.endDate)}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-2 border-t border-border-subtle text-[11px] text-text-tertiary">
          共 {total} 个季度
        </div>
      </div>

      {/* ── 右侧：季度详情 ── */}
      <div className="flex-1 min-w-0 flex flex-col rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
        {!selectedSeason ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
            <CalendarRange className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">请选择左侧季度查看详情</p>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* 季度头部 */}
            <div className="p-5 border-b border-border-subtle">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-medium text-text-primary">{selectedSeason.code}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-control border shrink-0 ${statusSemanticClass(SEASON_STATUS_SEMANTIC[selectedSeason.status] ?? 'neutral', isDarkMode)}`}>
                      {SEASON_STATUS_LABELS[selectedSeason.status] || selectedSeason.status}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-text-secondary">{selectedSeason.name}</div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-text-tertiary flex-wrap">
                    <span>{formatDate(selectedSeason.startDate)} ~ {formatDate(selectedSeason.endDate)}</span>
                    <span>{detail?.trendTags?.length ?? 0} 个趋势标签</span>
                    <span>{detail?.tradeShows?.length ?? 0} 场展会</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => { setEditingSeason(detail ?? selectedSeason); setShowForm(true); }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  编辑季度
                </button>
                <button
                  onClick={() => handleDelete(detail ?? selectedSeason)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-tertiary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              </div>
              {(detail?.notes || selectedSeason.notes) && (
                <div className="mt-3 px-3 py-2 rounded-card bg-surface-elevated text-xs text-text-secondary whitespace-pre-wrap">
                  {detail?.notes || selectedSeason.notes}
                </div>
              )}
            </div>

            <div className="p-5 space-y-5">
              {/* 开发日历 timeline */}
              <section>
                <div className="text-xs text-text-tertiary mb-3">开发日历</div>
                {(detail?.calendar ?? []).length > 0 ? (
                  <div className="relative pl-5">
                    <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-border-subtle" />
                    <div className="space-y-3">
                      {(detail?.calendar ?? []).map((node) => (
                        <div key={node.key} className="relative flex items-start gap-3">
                          <span className={`absolute -left-5 top-1 w-2.5 h-2.5 rounded-full ${statusSemanticBg('active', isDarkMode)}`} />
                          <div className="min-w-0 flex-1 bg-surface-elevated rounded-card px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-text-primary">{node.label}</span>
                              <span className="text-[10px] text-text-tertiary">{node.key}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-text-tertiary">
                              {formatDate(node.startDate)} ~ {formatDate(node.endDate)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-text-tertiary text-sm bg-surface-elevated rounded-card">
                    暂无开发日历节点，点击「编辑季度」维护开发里程碑
                  </div>
                )}
              </section>

              {/* 季度回顾 */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="text-xs text-text-tertiary">季度回顾</div>
                  {review && (
                    <span className="text-[10px] text-text-tertiary">生成于 {formatDateTime(review.generatedAt)}</span>
                  )}
                  <button
                    onClick={handleGenerateReview}
                    disabled={generatingReview}
                    className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all disabled:opacity-50"
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
                        <div key={m.label} className="bg-surface-elevated rounded-card p-3">
                          <div className="text-xs text-text-tertiary">{m.label}</div>
                          <div className="text-sm text-text-primary mt-1 font-medium">{m.value}</div>
                        </div>
                      ))}
                    </div>
                    {review.topCustomers.length > 0 && (
                      <div className="bg-surface-elevated rounded-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border-subtle text-xs text-text-tertiary">
                          Top {review.topCustomers.length} 客户
                        </div>
                        <div className="divide-y divide-border-subtle">
                          {review.topCustomers.map((c, idx) => (
                            <div key={`${c.customer}-${idx}`} className="flex items-center gap-3 px-4 py-2">
                              <span className="text-[11px] text-text-tertiary w-5">{idx + 1}</span>
                              <span className="text-sm text-text-primary truncate flex-1">{c.customer}</span>
                              <span className="text-xs text-text-tertiary">{c.orderCount} 单</span>
                              <span className="text-xs text-text-secondary">{formatNumber(c.revenue)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 text-text-tertiary text-sm bg-surface-elevated rounded-card">
                    尚未生成季度回顾，点击「生成季度回顾」按当前订单数据聚合快照
                  </div>
                )}
              </section>

              {/* 关联趋势 / 展会 */}
              {detail && (detail.trendTags?.length || detail.tradeShows?.length) ? (
                <section className="grid grid-cols-2 gap-3">
                  <div className="bg-surface-elevated rounded-card p-3">
                    <div className="text-xs text-text-tertiary mb-2">趋势标签</div>
                    {(detail.trendTags ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(detail.trendTags ?? []).map((t) => (
                          <span key={t.id} className={`text-xs px-2 py-1 rounded-control border ${statusSemanticClass('info', isDarkMode)}`}>
                            {t.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-text-tertiary">暂无</div>
                    )}
                  </div>
                  <div className="bg-surface-elevated rounded-card p-3">
                    <div className="text-xs text-text-tertiary mb-2">展会</div>
                    {(detail.tradeShows ?? []).length > 0 ? (
                      <div className="space-y-1.5">
                        {(detail.tradeShows ?? []).map((show) => (
                          <div key={show.id} className="flex items-center gap-2">
                            <Store className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                            <span className="text-sm text-text-primary truncate flex-1">{show.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass(SHOW_STATUS_SEMANTIC[show.status] ?? 'neutral', isDarkMode)}`}>
                              {SHOW_STATUS_LABELS[show.status] || show.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-text-tertiary">暂无</div>
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

function TrendsPanel({ isDarkMode }: { isDarkMode?: boolean }) {
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
    <div className="h-full flex flex-col min-h-0 rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
      {/* 过滤栏 */}
      <div className="p-3 border-b border-border-subtle flex items-center gap-2 flex-wrap">
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          className="bg-surface-elevated text-text-primary text-xs rounded-control px-2 py-1.5 border border-border-subtle outline-none focus:border-border-action"
        >
          <option value="">全部季度</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.code} {s.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          {(['', 'fabric', 'color', 'craft', 'composition'] as const).map((t) => (
            <button
              key={t || 'all'}
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 text-xs rounded-control border transition-colors ${
                typeFilter === t
                  ? statusSemanticClass('active', isDarkMode)
                  : 'text-text-tertiary border-transparent hover:text-text-secondary'
              }`}
            >
              {t === '' ? '全部' : TREND_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <button
          onClick={loadTags}
          className="p-1 rounded-control hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setEditingTag(null); setShowForm(true); }}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          新建标签
        </button>
      </div>

      {/* 标签卡片列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
          </div>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <TrendingUp className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">暂无趋势标签，点击「新建标签」开始收集趋势</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {tags.map((tag) => {
              const expanded = expandedId === tag.id;
              const links = tag.fabricLinks ?? [];
              return (
                <div key={tag.id} className="bg-surface-elevated rounded-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary font-medium truncate flex-1">{tag.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass('info', isDarkMode)}`}>
                      {TREND_TYPE_LABELS[tag.type] || tag.type}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-tertiary flex-wrap">
                    <span>{links.length} 款关联面料</span>
                    {tag.tradeShow?.name && <span>来源展会：{tag.tradeShow.name}</span>}
                    {!tag.tradeShow?.name && tag.source && <span>来源：{tag.source}</span>}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      onClick={() => setExpandedId(expanded ? null : tag.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                    >
                      <ArrowRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      {expanded ? '收起面料' : '展开面料'}
                    </button>
                    <button
                      onClick={() => { setEditingTag(tag); setShowForm(true); }}
                      className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(tag)}
                      className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors ml-auto"
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
                        <div className="mt-3 pt-3 border-t border-border-subtle space-y-2">
                          {tag.description && (
                            <div className="text-xs text-text-secondary whitespace-pre-wrap">{tag.description}</div>
                          )}
                          {links.length === 0 ? (
                            <div className="text-xs text-text-tertiary py-2">尚未关联面料</div>
                          ) : (
                            <div className="space-y-1.5">
                              {links.map((link) => (
                                <div key={link.id} className="flex items-center gap-2 bg-surface-primary rounded-control px-2.5 py-1.5">
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs text-text-primary truncate">
                                      {link.fabric?.productAsset?.name || link.fabric?.articleNo || link.fabricId}
                                    </div>
                                    <div className="text-[10px] text-text-tertiary truncate">
                                      {link.fabric?.productAsset?.sku || ''}
                                      {link.note ? ` · ${link.note}` : ''}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleUnlinkFabric(tag.id, link.fabricId)}
                                    className="p-1 rounded-control text-text-tertiary hover:text-text-primary transition-colors shrink-0"
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
        <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-surface-primary rounded-control px-2.5 py-1.5 border border-border-subtle focus-within:border-border-action">
          <Search className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
          <input
            type="text"
            placeholder="搜索面料名称 / SKU 关联..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none flex-1 min-w-0"
          />
          {searching && <Loader2 className="w-3 h-3 animate-spin text-text-tertiary shrink-0" />}
        </div>
        <input
          type="text"
          placeholder="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-28 bg-surface-primary text-text-primary text-xs rounded-control px-2.5 py-1.5 border border-border-subtle outline-none focus:border-border-action"
        />
      </div>
      {results.length > 0 && (
        <div className="mt-1.5 bg-surface-primary rounded-control border border-border-subtle divide-y divide-border-subtle max-h-40 overflow-y-auto">
          {results.map((asset) => {
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
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-elevated disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span className="text-xs text-text-primary truncate flex-1">{asset.name}</span>
                <span className="text-[10px] text-text-tertiary shrink-0">{asset.sku}</span>
                <span className="text-[10px] text-text-tertiary shrink-0">
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

function ShowsPanel({ isDarkMode }: { isDarkMode?: boolean }) {
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
      <div className="w-80 shrink-0 flex flex-col rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
        <div className="p-3 border-b border-border-subtle space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={seasonFilter}
              onChange={(e) => setSeasonFilter(e.target.value)}
              className="flex-1 min-w-0 bg-surface-elevated text-text-primary text-xs rounded-control px-2 py-1.5 border border-border-subtle outline-none focus:border-border-action"
            >
              <option value="">全部季度</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.code} {s.name}</option>
              ))}
            </select>
            <button
              onClick={refreshAll}
              className="p-1 rounded-control hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
              title="刷新"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['', 'Planned', 'Ongoing', 'Completed', 'Cancelled'] as const).map((s) => (
              <button
                key={s || 'all'}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 text-xs rounded-control border transition-colors ${
                  statusFilter === s
                    ? statusSemanticClass('active', isDarkMode)
                    : 'text-text-tertiary border-transparent hover:text-text-secondary'
                }`}
              >
                {s === '' ? '全部' : SHOW_STATUS_LABELS[s]}
              </button>
            ))}
            <button
              onClick={() => { setEditingShow(null); setShowForm(true); }}
              className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              新建展会
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
            </div>
          ) : shows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-tertiary px-4">
              <Store className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm text-center">暂无展会记录，点击「新建展会」开始</p>
            </div>
          ) : (
            shows.map((show) => {
              const isSelected = show.id === selectedId;
              return (
                <button
                  key={show.id}
                  onClick={() => setSelectedId(show.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border-subtle transition-colors ${
                    isSelected ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary truncate flex-1">{show.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-control border shrink-0 ${statusSemanticClass(SHOW_STATUS_SEMANTIC[show.status] ?? 'neutral', isDarkMode)}`}>
                      {SHOW_STATUS_LABELS[show.status] || show.status}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-tertiary">
                    <span>{formatDate(show.startDate)}{show.endDate ? ` ~ ${formatDate(show.endDate)}` : ''}</span>
                    {show.location && (
                      <span className="flex items-center gap-0.5 truncate">
                        <MapPin className="w-3 h-3 shrink-0" />
                        {show.location}
                      </span>
                    )}
                    {show.cost != null && <span className="ml-auto shrink-0">{formatMoney(show.cost, show.currency)}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-2 border-t border-border-subtle text-[11px] text-text-tertiary">
          共 {shows.length} 场展会
        </div>
      </div>

      {/* ── 右侧：展会详情 ── */}
      <div className="flex-1 min-w-0 flex flex-col rounded-panel bg-surface-primary border border-border-subtle overflow-hidden">
        {!selectedShow ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
            <Store className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">请选择左侧展会查看详情</p>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* 展会头部 */}
            <div className="p-5 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-medium text-text-primary truncate">{selectedShow.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-control border shrink-0 ${statusSemanticClass(SHOW_STATUS_SEMANTIC[selectedShow.status] ?? 'neutral', isDarkMode)}`}>
                  {SHOW_STATUS_LABELS[selectedShow.status] || selectedShow.status}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-text-tertiary flex-wrap">
                <span>{formatDate(selectedShow.startDate)}{selectedShow.endDate ? ` ~ ${formatDate(selectedShow.endDate)}` : ''}</span>
                {selectedShow.location && <span>地点 {selectedShow.location}</span>}
                {selectedShow.boothNo && <span>展位 {selectedShow.boothNo}</span>}
                {selectedShow.attendees != null && <span>接待 {selectedShow.attendees} 人</span>}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => { setEditingShow(detail ?? selectedShow); setShowForm(true); }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  编辑展会
                </button>
                <button
                  onClick={() => { setEditingLead(null); setShowLeadForm(true); }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新增线索
                </button>
                <button
                  onClick={() => handleDeleteShow(detail ?? selectedShow)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-tertiary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              </div>
              {(detail?.notes || selectedShow.notes) && (
                <div className="mt-3 px-3 py-2 rounded-card bg-surface-elevated text-xs text-text-secondary whitespace-pre-wrap">
                  {detail?.notes || selectedShow.notes}
                </div>
              )}
            </div>

            <div className="p-5 space-y-5">
              {/* ROI 卡片 */}
              {roi && (
                <section>
                  <div className="text-xs text-text-tertiary mb-3">投资回报 ROI</div>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-surface-elevated rounded-card p-3">
                      <div className="text-xs text-text-tertiary">参展费用</div>
                      <div className="text-sm text-text-primary mt-1 font-medium">{formatMoney(roi.cost, roi.currency)}</div>
                    </div>
                    <div className="bg-surface-elevated rounded-card p-3">
                      <div className="text-xs text-text-tertiary">转化订单金额</div>
                      <div className="text-sm text-text-primary mt-1 font-medium">{formatMoney(roi.orderAmount, roi.currency)}</div>
                    </div>
                    <div className={`rounded-card p-3 border ${statusSemanticClass(roi.roi >= 1 ? 'success' : roi.cost > 0 ? 'warning' : 'neutral', isDarkMode)}`}>
                      <div className="text-xs opacity-70">ROI 倍数</div>
                      <div className="text-sm mt-1 font-medium">{formatNumber(roi.roi)}x</div>
                    </div>
                    <div className="bg-surface-elevated rounded-card p-3">
                      <div className="text-xs text-text-tertiary">转化订单</div>
                      <div className="text-sm text-text-primary mt-1 font-medium">{roi.orderCount} 单</div>
                    </div>
                  </div>
                  {/* 线索转化占比条（flat：纯色膜，无阴影） */}
                  <div className="mt-3 bg-surface-elevated rounded-card p-3">
                    <div className="flex items-center gap-2 text-xs text-text-tertiary">
                      <span>线索 {roi.leadsTotal} 条</span>
                      <span>已转化 {roi.leadsConverted} 条</span>
                      <span className="ml-auto">
                        转化率 {roi.leadsTotal > 0 ? Math.round((roi.leadsConverted / roi.leadsTotal) * 100) : 0}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-surface-primary overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${statusSemanticBg('success', isDarkMode)}`}
                        style={{ width: `${roi.leadsTotal > 0 ? Math.min((roi.leadsConverted / roi.leadsTotal) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* 线索列表 */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="text-xs text-text-tertiary">展会线索（{detail?.leads?.length ?? 0}）</div>
                </div>
                {(detail?.leads ?? []).length === 0 ? (
                  <div className="text-center py-8 text-text-tertiary text-sm bg-surface-elevated rounded-card">
                    暂无线索，点击「新增线索」录入展会名片
                  </div>
                ) : (
                  <div className="bg-surface-elevated rounded-card overflow-hidden">
                    <div className="grid grid-cols-[1.2fr_1fr_0.7fr_1.4fr_0.9fr_0.9fr_auto] gap-2 px-4 py-2 border-b border-border-subtle text-[11px] text-text-tertiary">
                      <span>客户</span>
                      <span>公司</span>
                      <span>国家</span>
                      <span>需求</span>
                      <span>状态</span>
                      <span>下次跟进</span>
                      <span className="text-right">操作</span>
                    </div>
                    <div className="divide-y divide-border-subtle">
                      {(detail?.leads ?? []).map((lead) => (
                        <div key={lead.id} className="grid grid-cols-[1.2fr_1fr_0.7fr_1.4fr_0.9fr_0.9fr_auto] gap-2 px-4 py-2.5 items-center">
                          <span className="text-sm text-text-primary truncate">{lead.customerName}</span>
                          <span className="text-xs text-text-secondary truncate">{lead.company || '—'}</span>
                          <span className="text-xs text-text-secondary truncate">{lead.country || '—'}</span>
                          <span className="text-xs text-text-tertiary truncate" title={lead.demand || undefined}>{lead.demand || '—'}</span>
                          <span>
                            <select
                              value={lead.status}
                              onChange={(e) => handleLeadStatus(lead, e.target.value as TradeShowLeadStatus)}
                              className={`text-[11px] px-1.5 py-0.5 rounded-control border outline-none bg-surface-primary ${statusSemanticClass(LEAD_STATUS_SEMANTIC[lead.status] ?? 'neutral', isDarkMode)}`}
                            >
                              {(Object.keys(LEAD_STATUS_LABELS) as TradeShowLeadStatus[]).map((s) => (
                                <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          </span>
                          <span className="text-xs text-text-tertiary">{formatDate(lead.nextFollowUpAt)}</span>
                          <span className="flex items-center gap-0.5 justify-end">
                            {lead.status !== 'Converted' && (
                              <button
                                onClick={() => setConvertingLead(lead)}
                                className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                                title="转化为客户"
                              >
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => { setEditingLead(lead); setShowLeadForm(true); }}
                              className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                              title="编辑"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteLead(lead)}
                              className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
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
            <div className="text-[11px] text-text-tertiary mt-1">格式：SS26（春夏）/ AW26（秋冬），创建后不可修改</div>
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
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as SeasonStatus)}>
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
          <label className="block text-xs text-text-tertiary">开发日历（里程碑节点）</label>
          <button
            onClick={() => setCalendar((rows) => [...rows, { key: '', label: '', startDate: '', endDate: '' }])}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-control text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors"
          >
            <Plus className="w-3 h-3" />
            添加节点
          </button>
        </div>
        {calendar.length === 0 ? (
          <div className="text-[11px] text-text-tertiary py-2">暂无节点，点击「添加节点」维护开发里程碑（如 开发启动 / 打样截止 / 下单截止）</div>
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
                  className="p-1.5 rounded-control text-text-tertiary hover:text-text-primary transition-colors"
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
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as TrendTagType)}>
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
          <select className={inputClass} value={tradeShowId} onChange={(e) => setTradeShowId(e.target.value)}>
            <option value="">无</option>
            {selectableShows.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
      </div>
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
          <select className={inputClass} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
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
          <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {show && (
        <Field label="状态">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as TradeShowStatus)}>
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
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as TradeShowLeadStatus)}>
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
      <div className="mb-3 px-3 py-2 rounded-card bg-surface-primary border border-border-subtle text-xs text-text-tertiary">
        选择关系智库中 category=Customer 的客户档案，转化后线索状态将变为「已转化」并关联该客户。
      </div>
      <Field label="目标客户 *">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
          </div>
        ) : (
          <select className={inputClass} value={relationId} onChange={(e) => setRelationId(e.target.value)}>
            <option value="">选择客户...</option>
            {relations.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
        {!loading && relations.length === 0 && (
          <div className="text-[11px] text-text-tertiary mt-1">
            暂无客户档案，请先在「关系智库」创建 category=Customer 的客户
          </div>
        )}
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-control text-text-tertiary hover:text-text-primary transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm rounded-control bg-surface-primary text-text-primary border border-border-subtle hover:ring-1 hover:ring-border-action transition-all"
        >
          确认转化
        </button>
      </div>
    </ModalShell>
  );
}
