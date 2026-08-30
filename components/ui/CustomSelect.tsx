import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import { BAMBOOK_OS } from './bambookOsTokens';

export interface Option {
  value: string;
  label: string;
  description?: string;
  /** 不可选项（原生 <option disabled> 的等价语义）：视觉降权、点击与键盘导航均跳过 */
  disabled?: boolean;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDarkMode?: boolean;
  disabled?: boolean;
  className?: string;
  menuPortal?: boolean;
  size?: 'default' | 'compact';
  /** 触发器 aria-label（迁移原生 select 的可访问名，如「状态筛选」） */
  ariaLabel?: string;
  /** field = bds-select 触发器几何（h-40px(--h-btn-md) / rounded-[--radius-pill] / text-xs / recessed），
   *  供 filterbar/表单以同几何替换原生 select 元素，浮层走 BDS 自绘容器（W4 原生浮层收编） */
  surface?: 'default' | 'toolbar' | 'form' | 'field';
  triggerVariant?: 'boxed' | 'inline';
}

/** 浮层视口安全边距 + 最大高度（与 max-h-60 对齐） */
const MENU_MAX_HEIGHT = 240;
const MENU_EST_ITEM_HEIGHT = 36;
const VIEWPORT_PADDING = 8;

const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = '请选择...',
  isDarkMode = false,
  disabled = false,
  className = '',
  menuPortal = false,
  size = 'default',
  ariaLabel,
  surface = 'default',
  triggerVariant = 'boxed',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({});
  const [dropUp, setDropUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  const selectedOption = options.find(opt => opt.value === value);
  const isCompact = size === 'compact';
  const isToolbarSurface = surface === 'toolbar';
  const isFormSurface = surface === 'form';
  const isFieldSurface = surface === 'field';
  const isInlineToolbarTrigger = isToolbarSurface && triggerVariant === 'inline';
  // field 触发器几何对齐 `.bds-filterbar .bds-select`（filterbar 规范强制 40px + pill，
  // 见 components.css §21 .bds-filterbar .bds-select 等高同形纪律）。原 `--r-control-sm`
  // token 在 styles/ 全局不存在（tailwind 静默丢弃 → 方形按钮），且 34px 与同 bar 的
  // bds-input(40px)/segment/toggle 高度错位，故收拢为 --h-btn-md + --radius-pill。
  const triggerSizeClass = isFieldSurface
    ? 'h-[var(--h-btn-md)] px-3 py-0 rounded-[var(--radius-pill)] text-xs leading-none'
    : isCompact
      ? `${isInlineToolbarTrigger ? 'h-[var(--h-input-sm)] px-2' : 'h-[var(--h-input-sm)] px-3'} py-0 ${isInlineToolbarTrigger ? 'rounded-control' : 'rounded-full'} text-[11px] leading-none`
      : 'h-9 px-3 py-0 rounded-full text-xs leading-none';
  const toolbarBaseClass = BAMBOOK_OS.controls.select.toolbarBase;
  const toolbarHoverClass = `${toolbarBaseClass} text-[var(--text-tertiary)] hover:!bg-[var(--active-darken)] hover:text-deep-alt hover:shadow-none active:scale-[0.98] active:bg-[var(--active-darken)]`;
  const toolbarSelectedClass = BAMBOOK_OS.controls.select.toolbarSelected;
  const toolbarInlineClass = BAMBOOK_OS.controls.select.toolbarInline;
  const toolbarInlineOpenClass = BAMBOOK_OS.controls.select.toolbarInlineOpen;
  const formIdleClass = `${BAMBOOK_OS.controls.recessedField.base} hover:!border-[var(--border-c-strong)]`;
  const formOpenClass = `${BAMBOOK_OS.controls.recessedField.base} !bg-[var(--recessed-bg-strong)] !border-[var(--border-c-strong)] shadow-none`;
  const fieldIdleClass = `${BAMBOOK_OS.controls.recessedField.base} hover:!border-[var(--border-c-strong)]`;
  const fieldOpenClass = `${BAMBOOK_OS.controls.recessedField.base} !bg-[var(--recessed-bg-strong)] !border-[var(--border-c-strong)] shadow-none`;
  const triggerOpenClass = isFieldSurface
    ? fieldOpenClass
    : isToolbarSurface
      ? isInlineToolbarTrigger ? toolbarInlineOpenClass : toolbarSelectedClass
      : isFormSurface
        ? formOpenClass
        : 'border-[var(--os-vnext-brand-blue)] bg-[var(--recessed-bg)]';
  const triggerIdleClass = isFieldSurface
    ? fieldIdleClass
    : isToolbarSurface
      ? isInlineToolbarTrigger ? toolbarInlineClass : toolbarHoverClass
      : isFormSurface
        ? formIdleClass
        : 'border-[var(--border-c-default)] bg-[var(--recessed-bg)] hover:border-[var(--border-c-strong)]';
  const overlayMenu = BAMBOOK_OS.controls.overlayMenu;
  const menuClass = `${overlayMenu.surfaceBase} ${overlayMenu.surface}`;
  const menuSurfaceClass = overlayMenu.surfaceLayer;
  const optionIdleClass = `${overlayMenu.itemBase} ${overlayMenu.item}`;
  const optionSelectedClass = overlayMenu.itemSelected;
  const checkIconClass = overlayMenu.check;

  // ── 可用项索引（disabled 项对键盘导航不可见） ──
  const enabledIndices = React.useMemo(
    () => options.map((o, i) => (o.disabled ? -1 : i)).filter(i => i >= 0),
    [options],
  );

  // ── 打开时初始化键盘高亮：当前选中项，无则首个可用项 ──
  useEffect(() => {
    if (!isOpen) return;
    const selectedIdx = options.findIndex(opt => opt.value === value && !opt.disabled);
    if (selectedIdx >= 0) {
      setActiveIndex(selectedIdx);
    } else {
      setActiveIndex(enabledIndices[0] ?? -1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 高亮项滚动进可视区（浮层内滚动，block:nearest 防牵动页面）
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const el = itemRefs.current[activeIndex];
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    // 键盘选择后焦点回触发器（ARIA combobox 惯例）
    containerRef.current?.querySelector<HTMLButtonElement>('[data-select-trigger]')?.focus();
  };

  // ── 键盘导航（W4 原生浮层收编：补齐原生 select 的键盘能力，Escape 阻断冒泡防误关 BdsDialog 等全局层） ──
  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const move = (dir: 1 | -1) => {
      e.preventDefault();
      if (enabledIndices.length === 0) return;
      setActiveIndex(prev => {
        const pos = enabledIndices.indexOf(prev);
        const next = pos === -1
          ? (dir === 1 ? 0 : enabledIndices.length - 1)
          : enabledIndices[(pos + dir + enabledIndices.length) % enabledIndices.length];
        return next;
      });
    };

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(enabledIndices[0] ?? -1);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(enabledIndices[enabledIndices.length - 1] ?? -1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0 && !options[activeIndex]?.disabled) {
          handleSelect(options[activeIndex].value);
        }
        break;
      case 'Escape':
        // 阻断冒泡：嵌套在 BdsDialog/BottomSheet 内时，Esc 只关本下拉不关宿主弹层
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        break;
      case 'Tab':
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  // ── 浮层展开方向：非 portal 按 trigger 视口空间判定；portal 在定位计算时判定 ──
  useEffect(() => {
    if (!isOpen || menuPortal || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const estimate = Math.min(MENU_MAX_HEIGHT, options.length * MENU_EST_ITEM_HEIGHT + 12) + VIEWPORT_PADDING;
    setDropUp(rect.bottom + estimate > window.innerHeight && rect.top - estimate > 0);
  }, [isOpen, menuPortal, options.length]);

  useEffect(() => {
    if (!isOpen || !menuPortal || !containerRef.current) return;

    const updatePortalStyle = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const estimate = Math.min(MENU_MAX_HEIGHT, options.length * MENU_EST_ITEM_HEIGHT + 12) + VIEWPORT_PADDING;
      const overflowBelow = rect.bottom + estimate > window.innerHeight;
      const flipUp = overflowBelow && rect.top - estimate > 0;
      setDropUp(flipUp);
      setPortalStyle({
        position: 'fixed',
        left: rect.left,
        top: flipUp ? Math.max(VIEWPORT_PADDING, rect.top - estimate) : rect.bottom + 8,
        width: rect.width,
      });
    };

    updatePortalStyle();
    window.addEventListener('resize', updatePortalStyle);
    window.addEventListener('scroll', updatePortalStyle, true);
    return () => {
      window.removeEventListener('resize', updatePortalStyle);
      window.removeEventListener('scroll', updatePortalStyle, true);
    };
  }, [isOpen, menuPortal, options.length]);

  const menu = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          role="listbox"
          id={listboxId}
          aria-label={placeholder}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={menuPortal ? portalStyle : undefined}
          data-glass-edge-mask
          data-os-shadow-mode="flat"
          className={`
            ${menuPortal ? 'z-[9999]' : dropUp ? 'absolute bottom-full left-0 right-0 mb-2 z-50' : 'absolute top-full left-0 right-0 mt-2 z-50'}
            ${menuClass}
          `}
        >
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 rounded-[inherit] ${menuSurfaceClass}`}
          />
          <div className="relative z-10 max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <button
                  key={option.value}
                  ref={el => { itemRefs.current[index] = el; }}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  disabled={option.disabled}
                  onClick={() => !option.disabled && handleSelect(option.value)}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  className={`
                    flex items-center justify-between gap-3
                    ${optionIdleClass}
                    ${isSelected ? optionSelectedClass : ''}
                    ${isActive && !isSelected ? 'bg-[var(--active-darken)]' : ''}
                    ${option.disabled ? 'opacity-40 cursor-not-allowed' : ''}
                  `}
                >
                  <div>
                    <span className={BAMBOOK_OS.typography.weight.ui}>{option.label}</span>
                    {option.description && (
                      <p className={`text-[10px] mt-0.5 text-[var(--text-tertiary)]`}>
                        {option.description}
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <Check size={14} strokeWidth={2} className={checkIconClass} />
                  )}
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        data-select-trigger
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        className={`
          w-full flex items-center justify-between gap-2 border ${triggerSizeClass}
          transition-colors duration-200
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isOpen ? triggerOpenClass : triggerIdleClass}
          ${isToolbarSurface ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]'}
        `}
      >
        <span className={`min-w-0 truncate ${selectedOption ? '' : 'text-[var(--text-tertiary)]'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={isCompact || isFieldSurface ? 14 : 16}
          strokeWidth={1.5}
          className={`
            shrink-0
            transition-transform duration-300
            ${isOpen ? 'rotate-180' : ''}
            text-[var(--text-tertiary)]
          `}
        />
      </button>

      {menuPortal && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
};

export default CustomSelect;
