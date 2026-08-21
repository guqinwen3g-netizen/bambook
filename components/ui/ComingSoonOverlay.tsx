import React from 'react';

/**
 * 开发中 · 即将上线 —— v0.8 阶段不交付模块的极简磨砂覆盖层。
 * 材质：.bds-surface（半透膜 + blur + saturate，BDS 唯一主容器玻璃面）；
 * 版式：单行极简文字，居中；
 * 对主题透明：全部走 BDS token（无 isDarkMode 分支 / 无暗色变体）。
 * 定位由调用方传入 className（如 absolute inset-0 z-50 rounded-panel）。
 */
export interface ComingSoonOverlayProps {
  /** 提示文字（默认「开发中 · 即将上线」） */
  text?: string;
  /** 定位 / 尺寸类（如 absolute inset-0 z-50 rounded-panel） */
  className?: string;
}

export const ComingSoonOverlay: React.FC<ComingSoonOverlayProps> = ({
  text = '开发中 · 即将上线',
  className = '',
}) => {
  return (
    <div
      data-bambook-coming-soon
      className={`bds-surface pointer-events-auto flex items-center justify-center overflow-hidden ${className}`}
    >
      <p className="text-[14px] font-light text-[var(--text-primary)]">{text}</p>
    </div>
  );
};

export default ComingSoonOverlay;
