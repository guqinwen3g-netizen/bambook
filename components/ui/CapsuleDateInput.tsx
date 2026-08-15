import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';

interface CapsuleDateInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  isDarkMode?: boolean;
  /** Unified capsule field recipe supplied by the host (h-10 rounded-full …). */
  className: string;
  placeholder?: string;
}

/**
 * 胶囊日期控件：文本框统一显示 YYYY-MM-DD（规避原生 type="date" 随系统区域
 * 在 MM/DD/YYYY 与「月/日/年」之间漂移的问题），右侧日历按钮触发隐藏的原生
 * date picker（Chromium showPicker）保留拾取体验。
 */
const CapsuleDateInput: React.FC<CapsuleDateInputProps> = ({ value, onChange, disabled = false, isDarkMode = false, className, placeholder = 'YYYY-MM-DD' }) => {
  const pickerRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    el.value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  const normalizeOnBlur = (raw: string) => {
    const trimmed = raw.trim();
    // 宽松归一：2026-1-5 → 2026-01-05；其他非法输入保持原样交由保存链路校验
    const m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const normalized = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      if (normalized !== raw) onChange(normalized);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => normalizeOnBlur(e.target.value)}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        aria-label="选择日期"
        className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`}
      >
        <Calendar size={14} strokeWidth={1.5} />
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-1/2 h-10 w-10 -translate-y-1/2 opacity-0"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};

export default CapsuleDateInput;
