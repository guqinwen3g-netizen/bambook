import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react';
import { parseNotificationLink, primeCrossModuleNav } from '../../services/crossModuleNav';
import type { ParsedNotificationLink } from '../../services/crossModuleNav';
// View 是字符串枚举（值 + 类型双用）：跳转目标映射表需要值语义，不能用 import type
import { View } from '../../types';
import type { CompletenessEntityData, CompletenessGap, CompletenessSeverity } from '../../types';

/**
 * 资料完备度引擎 UI 原语（列表徽标 + 详情横幅）。
 *
 * 数据源：GET /api/completeness/batch（徽标，宿主按 id 映射）与
 * GET /api/completeness/entity（横幅，宿主按详情实体拉取）。
 * 组件只接 props、不直接依赖 apiService —— 数据拉取与失败降级由宿主承担。
 *
 * severity → 语义 token（BDS bds/tokens.css）：P0 错误（danger）/ P1 警示（warning）/ P2 中性。
 */

const SEVERITY_ORDER: Record<CompletenessSeverity, number> = { P0: 0, P1: 1, P2: 2 };

const SEVERITY_CHIP_CLASS: Record<CompletenessSeverity, string> = {
  P0: 'bg-[var(--danger-tint)] text-[var(--danger-text)]',
  P1: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  P2: 'bg-[var(--recessed-bg)] text-[var(--text-tertiary)]',
};

/**
 * fix.target 前端路由 → 结构化导航目标。
 * 路由段协议与通知 link 一致（/orders?id=xxx&tab=yyy），复用 parseNotificationLink 解析；
 * products 段暂缺于 crossModuleNav 的映射表，此处本地补齐，待上游收敛后移除。
 */
const COMPLETENESS_EXTRA_ROUTE_VIEWS: Record<string, View> = { products: View.Products };

const resolveGapRoute = (target: string): ParsedNotificationLink | null => {
  const parsed = parseNotificationLink(target);
  if (parsed) return parsed;
  const [rawPath, rawQuery] = target.replace(/^#/, '').split('?');
  const path = (rawPath ?? '').replace(/^\/+/, '').toLowerCase();
  const view = COMPLETENESS_EXTRA_ROUTE_VIEWS[path];
  if (!view) return null;
  const params = new URLSearchParams(rawQuery ?? '');
  return { view, tab: params.get('tab') ?? undefined, id: params.get('id') ?? undefined, params: {} };
};

/**
 * 列表行「信息完整度」徽标：score < 100 显示百分比 + 缺项 tooltip；
 * 点击展开缺项明细（Esc / 外点 / 滚动收起）；score >= 100 不渲染。
 * 触发器用 span[role=button]：宿主列表行是 motion.button 卡片，嵌套原生 button 非法。
 * 明细面板经 portal 挂 body（fixed 定位）——宿主行/卡片普遍 overflow-hidden，
 * 行内 absolute 面板会被裁剪；expandDirection 控制弹出方向（贴卡片底部的 footer 用 'up'）。
 */
export function CompletenessBadge({
  score,
  missing,
  expandDirection = 'down',
  className = '',
}: {
  score: number;
  missing?: string[];
  expandDirection?: 'down' | 'up';
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  const [triggerRect, setTriggerRect] = useState<{ left: number; top: number } | null>(null);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && rootRef.current) {
        const rect = rootRef.current.getBoundingClientRect();
        setTriggerRect({ left: rect.left, top: rect.top });
      }
      return next;
    });
  };

  useEffect(() => {
    if (!expanded) return;
    const isInside = (target: Node) =>
      Boolean(
        (rootRef.current && rootRef.current.contains(target))
        || (panelRef.current && panelRef.current.contains(target)),
      );
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && isInside(e.target)) return;
      setExpanded(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    // fixed 定位面板不随滚动容器移动：任一容器滚动时直接收起，避免面板漂移
    const onScroll = () => setExpanded(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [expanded]);

  if (typeof score !== 'number' || !Number.isFinite(score) || score >= 100) return null;
  const missingList = (missing ?? []).filter(Boolean);
  const missingText = missingList.join('、');

  return (
    <span ref={rootRef} className={`relative inline-flex items-center ${className}`} onClick={(e) => e.stopPropagation()}>
      <span
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`信息完整度 ${Math.round(score)}%，点击${expanded ? '收起' : '展开'}缺项明细`}
        title={missingText ? `缺失：${missingText}` : undefined}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          toggleExpanded();
        }}
        className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-transparent bg-[var(--warning-tint)] px-2 py-0.5 text-[10px] font-light text-[var(--warning-text)] transition-colors duration-200 hover:bg-[var(--warning-tint-hover)]"
      >
        {Math.round(score)}%
        {missingList.length > 0 && (
          <ChevronDown size={10} strokeWidth={2} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        )}
      </span>
      {expanded && missingList.length > 0 && triggerRect && typeof document !== 'undefined' && createPortal(
        <span
          ref={panelRef}
          data-completeness-badge-detail
          className="fixed z-[70] w-max max-w-64 rounded-card border border-transparent bds-frosted px-3 py-2 text-left text-[10px] font-light leading-relaxed text-[var(--text-primary)]"
          style={{
            left: triggerRect.left,
            top: expandDirection === 'up' ? triggerRect.top - 4 : triggerRect.top + 28,
            transform: expandDirection === 'up' ? 'translateY(-100%)' : undefined,
          }}
        >
          <span className="mb-1 block tracking-[0.14em] text-[var(--text-tertiary)]">缺失维度</span>
          {missingList.map(item => (
            <span key={item} className="block whitespace-nowrap">{item}</span>
          ))}
        </span>,
        document.body,
      )}
    </span>
  );
}

/**
 * 详情头部「资料完备度」横幅：无缺口 → 绿色「资料齐全」；
 * 有缺口 → 按最高 severity 定主色（P0 红 / P1 琥珀 / P2 中性），逐条列
 * label + hint，「去补齐」按钮执行 fix.target 跨模块跳转
 * （crossModuleNav 三段式：prime 上下文 → onNavigate(view)，与开发案详情跳转同模式）。
 */
export function CompletenessBanner({
  data,
  onNavigate,
  className = '',
}: {
  data: CompletenessEntityData | null;
  /** 宿主既有跨模块导航回调（App.handleViewChange 通道） */
  onNavigate?: (view: View) => void;
  className?: string;
}) {
  if (!data) return null;
  const gaps: CompletenessGap[] = (data.gaps ?? [])
    .slice()
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  if (gaps.length === 0) {
    return (
      <div
        role="status"
        className={`flex items-center gap-2 rounded-control border border-transparent bg-[var(--success-tint)] px-3.5 py-2.5 text-xs font-light text-[var(--success-text)] ${className}`}
      >
        <CheckCircle2 size={14} strokeWidth={1.75} className="shrink-0" />
        资料齐全
      </div>
    );
  }

  const worst: CompletenessSeverity = gaps[0].severity;
  const bannerToneClass =
    worst === 'P0'
      ? 'bg-[var(--danger-tint)] text-[var(--danger-text)]'
      : worst === 'P1'
        ? 'bg-[var(--warning-tint)] text-[var(--warning-text)]'
        : 'bg-[var(--recessed-bg)] text-[var(--text-secondary)]';
  const bodyTextClass = worst === 'P2' ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]';

  return (
    <div
      role="alert"
      className={`rounded-card border border-transparent px-4 py-3 text-xs font-light ${bannerToneClass} ${className}`}
      data-completeness-banner
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0" />
        <span className="tracking-wide">资料完备度 · {gaps.length} 项待补齐</span>
      </div>
      <ul className={`mt-2 space-y-1.5 ${bodyTextClass}`}>
        {gaps.map((gap) => {
          const route = gap.fix?.type === 'navigate' && gap.fix.target ? resolveGapRoute(gap.fix.target) : null;
          return (
            <li key={gap.ruleId} className="flex min-w-0 items-center gap-2">
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-light ${SEVERITY_CHIP_CLASS[gap.severity] ?? SEVERITY_CHIP_CLASS.P2}`}>
                {gap.severity}
              </span>
              <span className="shrink-0">{gap.label}</span>
              {gap.hint && <span className="min-w-0 truncate text-[var(--text-tertiary)]">{gap.hint}</span>}
              {route && onNavigate && (
                <button
                  type="button"
                  onClick={() => {
                    primeCrossModuleNav({
                      view: route.view,
                      tab: route.tab,
                      ...(route.id ? { focusEntityId: route.id } : {}),
                    });
                    onNavigate(route.view);
                  }}
                  className="ml-auto shrink-0 rounded-full border border-transparent bg-white/52 px-2.5 py-1 text-[10px] font-light text-[var(--text-primary)] transition-colors duration-200 hover:bg-white/72 dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
                  aria-label={`去补齐：${gap.label}`}
                >
                  去补齐
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
