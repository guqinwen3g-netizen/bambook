import React from 'react';
import { motion } from 'framer-motion';
import SidePanelContainer from '../SidePanelContainer';
import ScrollEdgeFades from '../ScrollEdgeFades';
import { SpotlightCard } from '../SpotlightCard';
import { useGlassSurfaceEdgeMasks } from '../useGlassSurfaceEdgeMasks';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export type CompiledEdgeFadeProps = React.ComponentProps<typeof ScrollEdgeFades> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledEdgeFade = ({
  compilerRole = 'edge-fade',
  source = 'CompiledEdgeFade',
  renderMode = 'content-mask',
  ...props
}: CompiledEdgeFadeProps) => (
  <>
    <span
      hidden
      data-os-compiler-role={compilerRole}
      data-os-compiler-source={source}
      data-os-compiler-edge-fade-render-mode={renderMode}
    />
    <ScrollEdgeFades renderMode={renderMode} {...props} />
  </>
);

export type CompiledGlassSurfaceEdgeMaskOptions = Parameters<typeof useGlassSurfaceEdgeMasks>[0] & {
  source?: string;
};

export const useCompiledGlassSurfaceEdgeMasks = ({
  source = 'useCompiledGlassSurfaceEdgeMasks',
  ...options
}: CompiledGlassSurfaceEdgeMaskOptions) => {
  void source;
  useGlassSurfaceEdgeMasks(options);
};

export type CompiledDetailShellProps = {
  isDarkMode?: boolean;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  role?: string;
  source?: string;
};

export const CompiledDetailShell = ({
  isDarkMode = false,
  children,
  className,
  contentClassName,
  role = 'detail-shell',
  source = 'CompiledDetailShell',
}: CompiledDetailShellProps) => (
  <SidePanelContainer
    isDarkMode={isDarkMode}
    className={className}
    contentClassName={contentClassName}
    data-os-compiler-role={role}
    data-os-compiler-source={source}
  >
    {children}
  </SidePanelContainer>
);

export type CompiledSurfacePanelProps = React.ComponentProps<typeof SidePanelContainer> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledSurfacePanel = ({
  compilerRole = 'surface-panel',
  source = 'CompiledSurfacePanel',
  children,
  ...props
}: CompiledSurfacePanelProps) => (
  <SidePanelContainer
    data-os-compiler-role={compilerRole}
    data-os-compiler-source={source}
    {...props}
  >
    {children}
  </SidePanelContainer>
);

export type CompiledInteractiveCardProps = React.ComponentProps<typeof SpotlightCard> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledInteractiveCard = React.forwardRef<HTMLElement, CompiledInteractiveCardProps>(({
  compilerRole = 'interactive-card',
  source = 'CompiledInteractiveCard',
  children,
  ...props
}, ref) => (
  <SpotlightCard
    ref={ref}
    data-os-compiler-role={compilerRole}
    data-os-compiler-source={source}
    {...props}
  >
    {children}
  </SpotlightCard>
));

CompiledInteractiveCard.displayName = 'CompiledInteractiveCard';

export const CompiledMotionInteractiveCard = motion(CompiledInteractiveCard);

export const COMPILED_DASHBOARD_CARD_SOURCE = 'CompiledDashboardCard';

export type CompiledDashboardCardProps = React.ComponentProps<typeof SpotlightCard> & {
  source?: string;
};

export const CompiledDashboardCard = ({
  source = COMPILED_DASHBOARD_CARD_SOURCE,
  children,
  ...props
}: CompiledDashboardCardProps) => (
  <SpotlightCard
    data-os-compiler-role="dashboard-card"
    data-os-compiler-source={source}
    data-os-dashboard-adaptive-card
    {...props}
  >
    {children}
  </SpotlightCard>
);

// ============================================================================
// CompiledToolbar — 统一工具栏 / 搜索栏壳
// ----------------------------------------------------------------------------
// 设计原则：
// 1. 平面化：玻璃面板保留 backdrop-filter，但不生成外阴影 caster。
// 2. wrapperClassName / className 二分：
//    - wrapperClassName：布局类（max-w / mt / inset / 自适应等），给外层 sibling-stack
//    - className：玻璃面板自身的视觉 + 内容布局类（h-9, rounded-inset, padding 等）
// 3. shadowMode 默认 none；attached/ghost 仅作为旧调用方兼容输入，不生成新深度层。
// 4. 内置 spotlight + ambient 滑光，保持现 toolbar 的视觉特征，但不形成 rim。
// ============================================================================

export type CompiledToolbarShadowMode = 'attached' | 'ghost' | 'none';

export type CompiledToolbarProps = Omit<React.ComponentProps<typeof SpotlightCard>, 'className'> & {
  /** 外层 sibling-stack 容器布局类（max-width / margin / inset 等）。 */
  wrapperClassName?: string;
  /** 玻璃面板自身的视觉与内容布局类（rounded / h-9 / surface base 等）。 */
  className?: string;
  /** 旧阴影 class。flat mode 下不渲染 caster，仅保留类型兼容。 */
  shadowClassName?: string;
  /** 阴影投射方式。默认 'none'。 */
  shadowMode?: CompiledToolbarShadowMode;
  /** 滑光高亮元素的 className（默认沿用项目 toolbar.ambient 配方）。 */
  ambientClassName?: string;
  /** 是否渲染 ambient 滑光。默认 true。 */
  withAmbient?: boolean;
  compilerRole?: string;
  source?: string;
  children?: React.ReactNode;
};

export const CompiledToolbar = React.forwardRef<HTMLElement, CompiledToolbarProps>(({
  wrapperClassName,
  className,
  shadowClassName,
  shadowMode = 'none',
  ambientClassName,
  withAmbient = true,
  compilerRole = 'toolbar',
  source = 'CompiledToolbar',
  children,
  ...spotlightProps
}, ref) => {
  const ambient = withAmbient ? (
    <span
      aria-hidden="true"
      className={ambientClassName}
      data-os-compiler-role="toolbar-ambient"
    />
  ) : null;

  if (shadowMode === 'attached') {
    // 兼容路径保留单层 DOM，但不接收 shadowClassName。
    return (
      <SpotlightCard
        ref={ref}
        data-os-compiler-role={compilerRole}
        data-os-compiler-source={source}
        data-os-shadow-mode="none"
        className={cx(wrapperClassName, className)}
        {...spotlightProps}
      >
        {ambient}
        {children}
      </SpotlightCard>
    );
  }

  if (shadowMode === 'ghost') {
    void shadowClassName;
  }

  // Flat 路径：单层面板；布局类和材质类同节点，避免 caster/面板尺寸差生成 rim。
  return (
    <SpotlightCard
      ref={ref}
      data-os-compiler-role={compilerRole}
      data-os-compiler-source={source}
      data-os-shadow-mode="none"
      className={cx('relative', wrapperClassName, className)}
      {...spotlightProps}
    >
      {ambient}
      {children}
    </SpotlightCard>
  );
});

CompiledToolbar.displayName = 'CompiledToolbar';

// ============================================================================
// CompiledDropdownMenu — 统一下拉菜单 / Popover 壳（A 方案：只壳 + 可选 MenuItem helper）
// ----------------------------------------------------------------------------
// 设计原则（**项目规范：所有 dropdown 一律平面化、无外阴影、无 wrapper**）：
// 1. **彻底无外阴影**：dropdown 没有 box-shadow 飞地、没有 sibling caster 节点。
//    物理边界 = 视觉边界 = 合成边界，从根上消除"飞地落入相邻 backdrop-filter 区"
//    引发的合成层 squashing → 不再产生幽灵光。
// 2. **DOM 退化为单层**：仅一个 glass panel，包含 backdrop-filter + 内容。
//    定位 / 尺寸 / z-index 由调用方在外层（如 motion.div）控制；CompiledDropdownMenu
//    只负责"玻璃面板壳本身"。
// 3. **保留 data-glass-edge-mask 标记**：让 .glass-panel / .bambook-dashboard-glass-color
//    等 surface family 走 inset-only box-shadow 分支（项目 ghost 分离规范），即使没有
//    外阴影 caster，也保证内描边正确。
// 4. **children 完全由调用方组装**（A 方案——灵活性优先）。
// 5. **避免 transform 动画**：调用方动画建议只用 opacity + y，不用 scale，避免触发
//    Blink 的 backdrop-filter cached snapshot 导致弹开瞬间无毛玻璃。
// ============================================================================

export type CompiledDropdownMenuProps = React.HTMLAttributes<HTMLDivElement> & {
  /** 玻璃面板视觉与内容布局类（rounded / padding / surface base 等）。
   *  定位 / 尺寸 / z-index 请放在外层（如 motion.div）上，CompiledDropdownMenu
   *  本身不再提供 wrapper。 */
  className?: string;
  compilerRole?: string;
  source?: string;
  children?: React.ReactNode;
};

export const CompiledDropdownMenu = React.forwardRef<HTMLDivElement, CompiledDropdownMenuProps>(({
  className,
  compilerRole = 'dropdown-menu',
  source = 'CompiledDropdownMenu',
  children,
  ...rest
}, ref) => (
  <div
    ref={ref}
    data-os-compiler-role={compilerRole}
    data-os-compiler-source={source}
    data-glass-edge-mask
    data-os-shadow-mode="flat"
    className={cx('relative', className)}
    {...rest}
  >
    {children}
  </div>
));

CompiledDropdownMenu.displayName = 'CompiledDropdownMenu';

export type CompiledDropdownMenuItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 是否为当前选中项（影响视觉强调）。 */
  selected?: boolean;
  /** 危险动作（红色文字）。 */
  destructive?: boolean;
  /** 前置 icon。 */
  leadingIcon?: React.ReactNode;
  /** 后置内容（快捷键提示等）。 */
  trailing?: React.ReactNode;
};

/**
 * MenuItem helper——可选使用。
 * 提供"按钮型菜单项"的统一视觉（hover / active / icon 排版）。
 * 调用方也可以自行写 button / a / div 作为 children，CompiledDropdownMenu 不强制。
 */
export const CompiledDropdownMenuItem = React.forwardRef<HTMLButtonElement, CompiledDropdownMenuItemProps>(({
  selected,
  destructive,
  leadingIcon,
  trailing,
  className,
  children,
  type = 'button',
  ...rest
}, ref) => (
  <button
    ref={ref}
    type={type}
    data-os-compiler-role="dropdown-menu-item"
    data-os-compiler-source="CompiledDropdownMenuItem"
    data-selected={selected ? 'true' : undefined}
    data-destructive={destructive ? 'true' : undefined}
    className={cx(
      'group relative flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-left text-sm font-light tracking-wide transition-colors',
      'hover:bg-[var(--recessed-bg-hover)] active:bg-[var(--active-darken)]',
      selected && 'bg-[var(--recessed-bg)]',
      destructive
        ? 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
        : 'text-[var(--text-primary)] hover:text-[var(--text-primary)]',
      className,
    )}
    {...rest}
  >
    {leadingIcon ? (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        {leadingIcon}
      </span>
    ) : null}
    <span className="flex-1 truncate">{children}</span>
    {trailing ? <span className="ml-auto shrink-0 text-xs opacity-60">{trailing}</span> : null}
  </button>
));

CompiledDropdownMenuItem.displayName = 'CompiledDropdownMenuItem';

export { cx as cxCompiledSurfaceClassName };
