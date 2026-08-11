import React from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  isDarkMode?: boolean;
  ariaLabel?: string;
}

/**
 * 统一滑动开关（胶囊轨道 + 圆形滑块）。
 * 所有布尔控件的唯一视觉真源：OrderFieldInput boolean、ProductionPipeline
 * 裁剪前门襟、验货批准等共用，避免各处手写轨道/滑块导致样式漂移。
 */
const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange, disabled = false, isDarkMode = false, ariaLabel }) => {
  // 注意：轨道带 rounded-full，class 中若出现 bg-slate/border-white/ 等子串会命中
  // flat-experimental.css 护栏被强制 border:0。统一用 rgba() 任意值，保证描边可见。
  const trackCls = checked
    ? isDarkMode
      ? 'bg-[rgba(255,255,255,0.72)] border border-[rgba(255,255,255,0.80)]'
      : 'bg-[rgba(51,65,85,0.82)] border border-[rgba(51,65,85,0.90)]'
    : isDarkMode
      ? 'bg-[rgba(255,255,255,0.13)] border border-[rgba(255,255,255,0.22)]'
      : 'bg-[rgba(100,116,139,0.26)] border border-[rgba(15,23,42,0.20)]';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${trackCls} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 h-[14px] w-[14px] rounded-full transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'} ${checked ? (isDarkMode ? 'bg-[rgba(13,27,42,0.85)]' : 'bg-white') : isDarkMode ? 'bg-[rgba(255,255,255,0.75)]' : 'bg-white'}`}
      />
    </button>
  );
};

export default ToggleSwitch;
