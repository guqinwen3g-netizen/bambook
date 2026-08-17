/**
 * layoutPrimitives — Phase 1 布局构建语言 React 原语
 *
 * 真源：docs/design/06-组件规格/布局构建语言.md（L1-L8）
 * 定位：纯布局载体，仅负责把规范类组合成可复用的页面积木；
 *       不承载业务逻辑，页面重建时按原语组合，禁止自由手写 Tailwind 布局。
 */

import React from 'react';

/* ── L1 页面骨架 PageShell ──
   页级 inset 唯一刻度 px-7 pt-5 pb-4（=.bds-page-shell）。 */
export interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}
export const PageShell: React.FC<PageShellProps> = ({ children, className = '' }) => (
  <div className={`bds-page-shell ${className}`.trim()}>{children}</div>
);

/* ── L3 图表井 BdsWell ──
   可视化容器统一 recessed 蚀刻底 + 高度族，替代手写 min-h-[Npx]。 */
export type WellSize = 'sm' | 'md' | 'lg';
export interface BdsWellProps {
  size?: WellSize;
  className?: string;
  children?: React.ReactNode;
}
export const BdsWell: React.FC<BdsWellProps> = ({ size = 'md', className = '', children }) => (
  <div className={`bds-well${size === 'sm' ? ' bds-well--sm' : ''}${size === 'lg' ? ' bds-well--lg' : ''} ${className}`.trim()}>
    {children}
  </div>
);

/* ── L3 方形缩略图 BdsThumb ──
   图片/图标占位，尺寸档位化，替代裸 w-[Npx] h-[Npx]。 */
export type ThumbSize = 's' | 'm' | 'l' | 'xl';
export interface BdsThumbProps {
  size?: ThumbSize;
  className?: string;
  children?: React.ReactNode;
}
export const BdsThumb: React.FC<BdsThumbProps> = ({ size = 'm', className = '', children }) => (
  <div className={`bds-thumb bds-thumb--${size} ${className}`.trim()}>{children}</div>
);

/* ── L4 工具栏 Toolbar ──
   组合 bar：左区标题/计数 + 右区动作组（=.bds-toolbar 三槽位）。 */
export interface ToolbarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  count?: React.ReactNode;
  className?: string;
}
export const Toolbar: React.FC<ToolbarProps> = ({ left, right, count, className = '' }) => (
  <div className={`bds-toolbar ${className}`.trim()}>
    <div className="tb-left">
      {left}
      {count != null && <span className="tb-count">{count}</span>}
    </div>
    {right != null && <div className="tb-right">{right}</div>}
  </div>
);

/* ── L5 表格密度 TableDensity ──
   行高族常量：compact(40px) / standard(48px) / cozy(56px)。 */
export const TABLE_DENSITY = {
  compact: 'bds-table compact',
  standard: 'bds-table',
  cozy: 'bds-table cozy',
} as const;
export type TableDensityKey = keyof typeof TABLE_DENSITY;

/* ── L7 空态 EmptyState ──
   glyph 圆形雾化图标 + title + desc；mist 变体用于玻璃背景卡。 */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  desc?: string;
  mist?: boolean;
  className?: string;
  children?: React.ReactNode;
}
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon, title, desc, mist = false, className = '', children,
}) => (
  <div className={`bds-empty${mist ? ' mist' : ''} ${className}`.trim()}>
    {icon != null && <div className="glyph">{icon}</div>}
    <div className="title">{title}</div>
    {desc != null && <div className="desc">{desc}</div>}
    {children}
  </div>
);

/* ── L7 错误态 ErrorBanner ──
   统一 danger 横幅，替代各页手写 "p-3 rounded-inset border + 红色文案" 拼装。 */
export interface ErrorBannerProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}
export const ErrorBanner: React.FC<ErrorBannerProps> = ({ children, icon, className = '' }) => (
  <div role="alert" className={`bds-error-banner ${className}`.trim()}>
    {icon != null && <span className="glyph">{icon}</span>}
    <div>{children}</div>
  </div>
);

/* ── L7 加载态 Skeleton ──
   Skeleton：块级 shimmer 骨架；SkeletonLine：文本行宽骨架。 */
export interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
}
export const Skeleton: React.FC<SkeletonProps> = ({ className = '', width, height }) => (
  <div className={`bds-skeleton ${className}`.trim()} style={{ width, height }} />
);
export const SkeletonLine: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`bds-skeleton ${className}`.trim()} style={{ height: 14, borderRadius: 7 }} />
);
