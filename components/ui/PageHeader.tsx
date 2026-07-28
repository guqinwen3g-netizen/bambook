import React from 'react';
import { BAMBOOK_OS } from './bambookOsTokens';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/**
 * 统一页面标题栏组件 —— 所有桌面端页面共用。
 * 一处修改，全页面联动：padding、标题字号、副标题间距、右侧布局。
 */
export interface PageHeaderProps {
  /** 中文主标题 */
  title: string;
  /** 英文副标题（显示在主标题下方） */
  subtitle?: string;
  /** 右侧英文上下文标注（如 "Invoice Desk"） */
  contextLabel?: string;
  /** 右侧操作按钮区 */
  actions?: React.ReactNode;
  /** 面包屑节点（显示在右侧操作区左侧） */
  breadcrumb?: React.ReactNode;
  /** 标题栏中间槽（少数页面有视图切换需求） */
  center?: React.ReactNode;
  /** 暗色模式 */
  isDarkMode?: boolean;
  /** 是否隐藏（全屏编辑器场景） */
  hidden?: boolean;
  /** 安全左偏移样式（避让 macOS 红绿灯） */
  safeLeftStyle?: React.CSSProperties;
  /** 额外 className */
  className?: string;
  /** 额外 style */
  style?: React.CSSProperties;
}

const TITLE_DARK = 'text-white/86';
const TITLE_LIGHT = 'text-slate-950';
const SUBTITLE_DARK = 'text-white/52';
const SUBTITLE_LIGHT = 'text-slate-500';

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  contextLabel,
  actions,
  breadcrumb,
  center,
  isDarkMode = false,
  hidden = false,
  safeLeftStyle,
  className,
  style,
}) => {
  const titleColorClass = isDarkMode ? TITLE_DARK : TITLE_LIGHT;
  const mutedClass = isDarkMode ? SUBTITLE_DARK : SUBTITLE_LIGHT;
  const hasRight = breadcrumb || contextLabel || actions;

  return (
    <header
      data-ui-lab-wallpaper-contrast="primary"
      className={cx(
        'flex shrink-0 items-center justify-between gap-4 px-7 pt-5 pb-4',
        hidden && 'hidden',
        className,
      )}
      style={{ ...safeLeftStyle, ...style }}
    >
      {/* 左侧：主标题 + 副标题 */}
      <div className="min-w-0 flex flex-col">
        <h1 className={cx(BAMBOOK_OS.layout.desktopTitleTextClass, titleColorClass)}>
          {title}
        </h1>
        {subtitle && (
          <div className={cx('mt-2 text-xs font-light', mutedClass)}>
            {subtitle}
          </div>
        )}
      </div>
      {/* 中间槽（少数页面有视图切换需求） */}
      {center && (
        <div className="mx-4 flex min-w-0 flex-1 items-center justify-center">
          {center}
        </div>
      )}
      {/* 右侧：面包屑 + 上下文标注 + 操作按钮 */}
      {hasRight && (
        <div className="flex shrink-0 items-center gap-4">
          {breadcrumb}
          {contextLabel && (
            <span className={cx('text-[11px] font-light', mutedClass)}>
              {contextLabel}
            </span>
          )}
          {actions}
        </div>
      )}
    </header>
  );
};
