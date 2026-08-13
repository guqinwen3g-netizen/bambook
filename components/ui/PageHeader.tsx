import React from 'react';
import { NotificationCenterTrigger } from '../NotificationCenter';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/**
 * 统一页面标题栏组件 —— 所有桌面端页面共用。
 * 一处修改，全页面联动：padding、标题字号、副标题间距、右侧布局。
 *
 * BDS v2.1：内部实现收敛到 bds-pagehead（styles/bds/components.css §20），
 * 对主题透明 — 暗色由 tokens.css [data-theme]/.dark 统一覆盖，
 * isDarkMode prop 保留仅为调用方兼容，组件内部不再消费。
 */
export interface PageHeaderProps {
  /** 中文主标题 */
  title: string;
  /** 英文副标题（中英混排，显示在主标题右侧） */
  subtitle?: string;
  /** 右侧英文上下文标注（如 "Invoice Desk"） */
  contextLabel?: string;
  /** 右侧操作按钮区 */
  actions?: React.ReactNode;
  /** 面包屑节点（显示在右侧操作区左侧） */
  breadcrumb?: React.ReactNode;
  /** 标题栏中间槽（少数页面有视图切换需求） */
  center?: React.ReactNode;
  /** 暗色模式（v2.1 起不再消费，仅为调用方兼容保留） */
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

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  contextLabel,
  actions,
  breadcrumb,
  center,
  hidden = false,
  safeLeftStyle,
  className,
  style,
}) => {
  return (
    <header
      data-ui-lab-wallpaper-contrast="primary"
      className={cx('bds-pagehead shrink-0', hidden && 'hidden', className)}
      style={{ ...safeLeftStyle, ...style }}
    >
      {/* 左侧：中英混排标题（nowrap + truncate：顶栏文字禁止换行） */}
      <div className="ph-main">
        <h1 className="ph-title" style={{ margin: 0 }}>
          {title}
          {subtitle && <span className="en">{subtitle}</span>}
        </h1>
      </div>
      {/* 中间槽（少数页面有视图切换需求） */}
      {center && (
        <div className="mx-4 flex min-w-0 flex-1 items-center justify-center">
          {center}
        </div>
      )}
      {/* 右侧：面包屑 + 上下文标注 + 操作按钮 + 通知按钮（最右） */}
      <div className="ph-side">
        {breadcrumb}
        {contextLabel && (
          <span className="bds-text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {contextLabel}
          </span>
        )}
        {actions}
        <NotificationCenterTrigger variant="header" />
      </div>
    </header>
  );
};
