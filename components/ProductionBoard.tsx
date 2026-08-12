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
import { AlertTriangle, CalendarClock, Loader2, RefreshCw, Search } from 'lucide-react';
import { productionService, ProductionBoardItem } from '../services/productionService';
import { PageHeader } from './ui/PageHeader';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { statusSemanticClass, statusSemanticText } from './rdlBusinessStatusTokens';
import ScrollEdgeFades from './ui/ScrollEdgeFades';

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
  const scrollRef = React.useRef<HTMLDivElement>(null);

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

  const cardClass = isDarkMode
    ? `rounded-card border border-white/[0.055] bg-white/[0.03] ${BAMBOOK_OS.material.glassColor}`
    : `rounded-card border border-white/45 bg-white/30 ${BAMBOOK_OS.material.glassColor}`;
  const columnClass = isDarkMode
    ? 'rounded-card-lg border border-white/[0.045] bg-white/[0.015]'
    : 'rounded-card-lg border border-white/40 bg-white/20';
  const textSecondary = isDarkMode ? 'text-slate-500' : 'text-slate-400';
  const toggleCls = (active: boolean) =>
    `h-7 px-3 rounded-full text-[11px] font-light inline-flex items-center gap-1 transition-colors ${
      active
        ? 'bg-[var(--os-vnext-brand-blue)] text-white'
        : isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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
        <CalendarClock size={10} />{label}
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
            className={`h-7 w-7 inline-flex items-center justify-center rounded-full transition-colors ${isDarkMode ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
            title="刷新"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      />

      {/* 工具行 */}
      <div className="shrink-0 px-7 pb-3 flex items-center gap-2.5">
        <div className={`flex items-center gap-1.5 h-7 px-2.5 rounded-control border w-64 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200'}`}>
          <Search size={12} className={textSecondary} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索客户 / PO / 工厂 / 跟单..."
            className={`flex-1 bg-transparent outline-none text-xs font-light ${isDarkMode ? 'text-white placeholder:text-slate-500' : 'text-slate-900 placeholder:text-slate-400'}`}
          />
        </div>
        <button className={toggleCls(overdueOnly)} onClick={() => setOverdueOnly(v => !v)}>
          <CalendarClock size={11} />仅看逾期
        </button>
        <button className={toggleCls(blockedOnly)} onClick={() => setBlockedOnly(v => !v)}>
          <AlertTriangle size={11} />仅看阻塞
        </button>
        <span className={`ml-auto text-[11px] font-light ${textSecondary}`}>在手 {filtered.length} 单</span>
      </div>

      {/* 泳道区 */}
      <div className="flex-1 min-h-0 relative px-7 pb-6">
        <ScrollEdgeFades scrollRef={scrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={12} bottomHeight={12} />
        <div ref={scrollRef} className="h-full overflow-auto custom-scrollbar">
          {loading && items.length === 0 ? (
            <div className={`h-40 flex items-center justify-center gap-2 text-xs font-light ${textSecondary}`}>
              <Loader2 size={14} className="animate-spin" />加载生产看板...
            </div>
          ) : error ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2">
              <div className={`text-xs font-light ${statusSemanticText('danger', isDarkMode)}`}>{error}</div>
              <button onClick={fetchBoard} className="text-[11px] font-light text-[var(--os-vnext-brand-blue)] hover:underline">重试</button>
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
                        return (
                          <button
                            key={o.id}
                            onClick={() => onOpenOrder?.(o.id)}
                            className={`${cardClass} w-full text-left p-3 transition-colors ${isDarkMode ? 'hover:bg-white/[0.05]' : 'hover:bg-white/50'}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-normal truncate">{o.poNumber || o.id}</span>
                              {item.blockedCount > 0 && (
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-compact ${statusSemanticClass('danger', isDarkMode)} text-[10px] font-light shrink-0`}>
                                  <AlertTriangle size={10} />阻塞
                                </span>
                              )}
                            </div>
                            <div className={`text-[11px] font-light mt-1 truncate ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
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
                          </button>
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
