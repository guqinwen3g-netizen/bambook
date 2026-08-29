/**
 * 生产跟单 Pipeline Board（PRD 19.8）
 *
 * 全部在手订单的 10 阶段泳道看板：
 *   - 列 = 生产阶段（业务下单 → … → 验货发货），卡片 = 订单
 *   - 卡片：订单号 / 客户 / 数量 / 跟单 / 交期倒计时（≤7 天橙、逾期红）/ 阻塞红标
 *   - 顶部筛选：搜索（客户/PO/工厂/跟单）、仅看逾期、仅看阻塞
 *   - 卡片点击 → 订单管理详情（App 层 lookup 完整 Order 后选中）
 *   - 数据源：GET /api/v1/production/board（聚合端点，只读查表制）
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Ban, CalendarClock, Loader2, RefreshCw, Search } from 'lucide-react';
import { productionService, ProductionBoardItem } from '../services/productionService';
import { apiService } from '../services/apiService';
import { bdsToast } from './ui/bdsToast';
import { PageHeader } from './ui/PageHeader';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { statusSemanticClass, statusSemanticText } from './rdlBusinessStatusTokens';
import { useStaticEdgeMask } from './ui/useStaticEdgeMask';

// 与后端 PRODUCTION_STAGES 顺序镜像（stageService.ts）；单订单泳道 ProductionPipeline 亦用同一中文标签集
const BOARD_STAGES: Array<{ key: string; label: string }> = [
  { key: 'order_placed', label: '业务下单' },
  { key: 'materials_confirmed', label: '面辅料确认' },
  { key: 'production_planned', label: '生产计划' },
  { key: 'in_production', label: '货期管理' },
  { key: 'materials_arrived', label: '面辅料到厂' },
  { key: 'pre_cut_checked', label: '裁剪前检查' },
  { key: 'pp_sample_approved', label: '产前样确认' },
  { key: 'manufacturing', label: '生产过程' },
  { key: 'final_review', label: '成品确认' },
  { key: 'qc_shipped', label: '验货发货' },
];

const BUSINESS_LINE_LABELS: Record<string, string> = {
  fabric: '面料', garment: '成衣', capsule: 'Capsule',
};

/** 交期倒计时：负数为已逾期天数 */
function daysUntil(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

/**
 * C18 看板阻塞标记：由看板聚合数据推导当前可执行的阻塞动作（纯函数导出，供单测复用）。
 * 作用于当前阶段（第一个非 done 阶段）：未阻塞 → 标记阻塞；已阻塞 → 解除阻塞。
 * 全部阶段 done 或无阶段记录 → null（无入口）。
 */
export function resolveBlockAction(
  stages: Array<{ stageKey: string; stageSeq: number; status: string }>,
  currentStageKey: string | null,
): { stageKey: string; blocked: boolean } | null {
  if (!currentStageKey) return null;
  const current = stages.find(s => s.stageKey === currentStageKey);
  if (!current) return null;
  return { stageKey: current.stageKey, blocked: current.status !== 'blocked' };
}

/** C18：调用阻塞标记端点（POST /v1/production/:orderId/block/:stageKey）；失败抛服务端错误消息 */
export async function postStageBlocked(orderId: string, stageKey: string, blocked: boolean): Promise<void> {
  const base = apiService.getStoredConfig().cloudEndpoint;
  const url = apiService.buildApiUrl(
    `/v1/production/${encodeURIComponent(orderId)}/block/${encodeURIComponent(stageKey)}`,
    base,
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: apiService.getAuthHeaders(),
    body: JSON.stringify({ blocked }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error?.message || `阻塞标记失败：HTTP ${res.status}`);
  }
}

interface ProductionBoardProps {
  isDarkMode: boolean;
  /** 卡片点击 → 跳订单管理详情（App 层负责完整 Order lookup + 视图切换） */
  onOpenOrder?: (orderId: string) => void;
}

const ProductionBoard: React.FC<ProductionBoardProps> = ({ isDarkMode, onOpenOrder }) => {
  const [items, setItems] = useState<ProductionBoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [blockedOnly, setBlockedOnly] = useState(false);
  // C18：阻塞标记提交中的订单 id（防双击）
  const [blockPendingId, setBlockPendingId] = useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // 边缘渐隐：固定 mask 挂滚动容器自身（12px 轻微渐隐，与 ScrollEdgeFades 原参数同口径）
  useStaticEdgeMask(scrollRef, { topFadeEnd: 12, bottomFade: 12 });

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await productionService.getBoard());
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // C18：卡片级「标记阻塞 / 解除阻塞」——作用于当前阶段（第一个非 done 阶段），成功后刷新看板
  const handleToggleBlock = useCallback(async (item: ProductionBoardItem) => {
    const action = resolveBlockAction(item.stages, item.currentStageKey);
    if (!action) {
      bdsToast.warning('该订单没有可标记的进行中阶段');
      return;
    }
    setBlockPendingId(item.order.id);
    try {
      await postStageBlocked(item.order.id, action.stageKey, action.blocked);
      bdsToast.success(action.blocked ? '已标记阻塞' : '已解除阻塞');
      await fetchBoard();
    } catch (e: any) {
      bdsToast.danger(`${action.blocked ? '标记阻塞' : '解除阻塞'}失败：${e?.message || e}`);
    } finally {
      setBlockPendingId(null);
    }
  }, [fetchBoard]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(item => {
      if (q) {
        const o = item.order;
        const hay = [o.customer, o.poNumber, o.millName, o.merchandiser, o.id].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (overdueOnly) {
        const d = daysUntil(item.order.dueDate);
        if (d === null || d >= 0) return false;
      }
      if (blockedOnly && item.blockedCount === 0) return false;
      return true;
    });
  }, [items, search, overdueOnly, blockedOnly]);

  /** 卡片归属列：当前阶段；全部完成归最后一列；无阶段记录归第一列 */
  const columnOf = useCallback((item: ProductionBoardItem): string => {
    if (item.currentStageKey) return item.currentStageKey;
    return item.stages.length > 0 ? 'qc_shipped' : 'order_placed';
  }, []);

  const byColumn = useMemo(() => {
    const map = new Map<string, ProductionBoardItem[]>(BOARD_STAGES.map(s => [s.key, []]));
    for (const item of filtered) map.get(columnOf(item))?.push(item);
    return map;
  }, [filtered, columnOf]);

  const cardClass = `rounded-card border border-[var(--border-c-subtle)] bg-[var(--hover-darken)] ${BAMBOOK_OS.material.glassColor}`;
  const columnClass = 'rounded-card-lg border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const toggleCls = (active: boolean) =>
    `h-7 px-3 rounded-full text-[11px] font-light inline-flex items-center gap-1 transition-colors ${
      active
        ? 'bg-[var(--accent-tint)] text-[var(--accent-text)]'
        : 'bg-[var(--recessed-bg)] text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]'
    }`;

  const renderDueChip = (dueDate: string) => {
    const d = daysUntil(dueDate);
    if (d === null) return null;
    const cls = d < 0
      ? statusSemanticClass('danger', isDarkMode)
      : d <= 7
        ? statusSemanticClass('warning', isDarkMode)
        : statusSemanticClass('neutral', isDarkMode);
    const label = d < 0 ? `逾期 ${-d} 天` : d === 0 ? '今日到期' : `剩 ${d} 天`;
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-compact text-[10px] font-light ${cls}`}>
        <CalendarClock size={14} />{label}
      </span>
    );
  };

  return (
    <div className="w-full h-full flex flex-col bg-transparent overflow-hidden">
      <PageHeader
        title="生产跟单"
        subtitle="Production Pipeline"
        contextLabel="Pipeline Board"
        isDarkMode={isDarkMode}
        actions={(
          <button
            onClick={fetchBoard}
            className="h-7 w-7 inline-flex items-center justify-center rounded-full transition-colors text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)] hover:text-[var(--text-primary)]"
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      />

      {/* 工具行 */}
      <div className="shrink-0 px-7 pb-3 flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-control border w-64 bg-[var(--recessed-bg)] border-[var(--border-c-default)]">
          <Search size={14} className={textSecondary} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索客户 / PO / 工厂 / 跟单..."
            className="flex-1 bg-transparent outline-none text-xs font-light text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
        </div>
        <button className={toggleCls(overdueOnly)} onClick={() => setOverdueOnly(v => !v)}>
          <CalendarClock size={14} />仅看逾期
        </button>
        <button className={toggleCls(blockedOnly)} onClick={() => setBlockedOnly(v => !v)}>
          <AlertTriangle size={14} />仅看阻塞
        </button>
        <span className={`ml-auto text-[11px] font-light ${textSecondary}`}>在手 {filtered.length} 单</span>
      </div>

      {/* 泳道区 */}
      <div className="flex-1 min-h-0 relative px-7 pb-6">
        <div ref={scrollRef} className="h-full overflow-auto custom-scrollbar">
          {loading && items.length === 0 ? (
            <div className={`h-40 flex items-center justify-center gap-2 text-xs font-light ${textSecondary}`}>
              <Loader2 size={14} className="animate-spin" />加载生产看板...
            </div>
          ) : error ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2">
              <div className={`text-xs font-light ${statusSemanticText('danger', isDarkMode)}`}>{error}</div>
              <button onClick={fetchBoard} className="bds-btn bds-btn-link text-[11px] font-light">重试</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className={`h-40 flex items-center justify-center text-xs font-light ${textSecondary}`}>
              {items.length === 0 ? '暂无在手生产订单' : '无符合筛选条件的订单'}
            </div>
          ) : (
            <div className="flex gap-3 items-start min-w-max pb-1">
              {BOARD_STAGES.map((stage, idx) => {
                const columnItems = byColumn.get(stage.key) ?? [];
                return (
                  <motion.div
                    key={stage.key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className={`w-[228px] shrink-0 ${columnClass} p-2.5`}
                  >
                    <div className="flex items-center justify-between px-1 pb-2">
                      <span className="text-xs font-light">{stage.label}</span>
                      <span className={`text-[10px] font-light tabular-nums ${textSecondary}`}>{columnItems.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {columnItems.map(item => {
                        const o = item.order;
                        // C18：当前阶段阻塞动作（全部完成/无阶段 → null 不渲染入口）
                        const blockAction = resolveBlockAction(item.stages, item.currentStageKey);
                        return (
                          <div
                            key={o.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenOrder?.(o.id)}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              onOpenOrder?.(o.id);
                            }}
                            className={`${cardClass} w-full text-left p-3 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-normal truncate">{o.poNumber || o.id}</span>
                              <span className="flex items-center gap-1 shrink-0">
                                {item.blockedCount > 0 && (
                                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-compact ${statusSemanticClass('danger', isDarkMode)} text-[10px] font-light shrink-0`}>
                                    <AlertTriangle size={14} />阻塞
                                  </span>
                                )}
                                {blockAction && (
                                  <button
                                    type="button"
                                    disabled={blockPendingId === o.id}
                                    onClick={(event) => { event.stopPropagation(); void handleToggleBlock(item); }}
                                    title={blockAction.blocked
                                      ? `标记「${BOARD_STAGES.find(s => s.key === blockAction.stageKey)?.label ?? blockAction.stageKey}」为阻塞`
                                      : '解除当前阶段阻塞'}
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-compact text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                                  >
                                    {blockPendingId === o.id ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                                    {blockAction.blocked ? '标记阻塞' : '解除阻塞'}
                                  </button>
                                )}
                              </span>
                            </div>
                            <div className={`text-[11px] font-light mt-1 truncate text-[var(--text-tertiary)]`}>
                              {o.customer}
                            </div>
                            <div className={`text-[10px] font-light mt-0.5 flex items-center gap-1.5 flex-wrap ${textSecondary}`}>
                              <span>{o.quantity.toLocaleString()} 件/米</span>
                              {o.businessLine && <span>· {BUSINESS_LINE_LABELS[o.businessLine] ?? o.businessLine}</span>}
                              {o.merchandiser && <span>· {o.merchandiser}</span>}
                            </div>
                            {(o.millName || o.dueDate) && (
                              <div className="flex items-center justify-between gap-2 mt-2">
                                <span className={`text-[10px] font-light truncate ${textSecondary}`}>{o.millName || ''}</span>
                                {renderDueChip(o.dueDate)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductionBoard;
