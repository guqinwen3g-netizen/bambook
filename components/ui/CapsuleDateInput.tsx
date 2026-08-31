import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { BAMBOOK_OS } from './bambookOsTokens';

interface CapsuleDateInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Unified capsule field recipe supplied by the host (h-10 rounded-full …). */
  className: string;
  placeholder?: string;
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

const parseYmd = (raw: string): { y: number; m: number; d: number } | null => {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return { y, m: mo, d };
};

const fmtYmd = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * 胶囊日期控件：文本框统一显示 YYYY-MM-DD（规避原生 date 输入随系统区域
 * 在 MM/DD/YYYY 与「月/日/年」之间漂移的问题），右侧日历按钮打开 BDS 自绘
 * 月历浮层（overlayMenu 玻璃容器族，与 CustomSelect 浮层同规范）——
 * W4 原生浮层收编：替代原 Chromium showPicker 原生日历。
 */
const CapsuleDateInput: React.FC<CapsuleDateInputProps> = ({ value, onChange, disabled = false, className, placeholder = 'YYYY-MM-DD' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const selected = parseYmd(value);

  const openCalendar = () => {
    const base = parseYmd(value);
    setView(base ? { y: base.y, m: base.m } : { y: today.getFullYear(), m: today.getMonth() });
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const next = new Date(v.y, v.m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });
  };

  const pickDay = (d: number) => {
    onChange(fmtYmd(view.y, view.m, d));
    setIsOpen(false);
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

  // 月历网格：周一开头；首行空白格 = 1 日前的占位
  const firstWeekday = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const overlayMenu = BAMBOOK_OS.controls.overlayMenu;
  const isToday = (d: number) =>
    d === today.getDate() && view.m === today.getMonth() && view.y === today.getFullYear();
  const isSelected = (d: number) =>
    selected !== null && d === selected.d && view.m === selected.m && view.y === selected.y;

  return (
    <div ref={containerRef} className="relative">
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
        onClick={openCalendar}
        aria-label="选择日期"
        aria-expanded={isOpen}
        className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`}
      >
        <Calendar size={14} strokeWidth={1.5} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            data-glass-edge-mask
            data-os-shadow-mode="flat"
            role="dialog"
            aria-label="日期选择"
            className={`absolute top-full right-0 mt-2 z-50 w-60 ${overlayMenu.surfaceBase} ${overlayMenu.surface}`}
          >
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-[inherit] ${overlayMenu.surfaceLayer}`}
            />
            <div className="relative z-10 p-2">
              {/* 月份导航 */}
              <div className="flex items-center justify-between px-1 pb-1">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  aria-label="上一月"
                  className="h-7 w-7 rounded-full flex items-center justify-center transition-colors text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <ChevronLeft size={14} strokeWidth={1.5} />
                </button>
                <span className="text-xs font-light tracking-wide text-[var(--text-primary)]">
                  {view.y} 年 {view.m + 1} 月
                </span>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="下一月"
                  className="h-7 w-7 rounded-full flex items-center justify-center transition-colors text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <ChevronRight size={14} strokeWidth={1.5} />
                </button>
              </div>
              {/* 星期头（周一开头） */}
              <div className="grid grid-cols-7">
                {WEEKDAY_LABELS.map((w) => (
                  <span
                    key={w}
                    className="h-7 flex items-center justify-center text-[10px] font-light text-[var(--text-quaternary)]"
                  >
                    {w}
                  </span>
                ))}
              </div>
              {/* 日期网格：选中日 accent 填充小圆（强调仅限小元素）；今天 accent 文字 */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((d, i) =>
                  d === null ? (
                    <span key={`blank-${i}`} className="h-8" />
                  ) : (
                    <button
                      key={d}
                      type="button"
                      onClick={() => pickDay(d)}
                      aria-pressed={isSelected(d)}
                      className={`h-8 w-8 mx-auto rounded-full text-xs font-light flex items-center justify-center transition-colors ${
                        isSelected(d)
                          ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                          : isToday(d)
                            ? 'text-[var(--accent)] hover:bg-[var(--recessed-bg-hover)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {d}
                    </button>
                  ),
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CapsuleDateInput;
