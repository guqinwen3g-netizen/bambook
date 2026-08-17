import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import { BAMBOOK_OS } from './bambookOsTokens';

interface Option {
  value: string;
  label: string;
  description?: string;
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
  /** field = bds-select 触发器几何（h-40px(--h-btn-md) / rounded-[--radius-pill] / text-xs / recessed），
   *  供 filterbar/表单以同几何替换原生 select 元素，浮层走 BDS 自绘容器（W4 原生浮层收编） */
  surface?: 'default' | 'toolbar' | 'form' | 'field';
  triggerVariant?: 'boxed' | 'inline';
}

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
  surface = 'default',
  triggerVariant = 'boxed',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
  const formOpenClass = `${BAMBOOK_OS.controls.recessedField.base} !bg-[rgba(15,23,42,0.08)] !border-[var(--border-c-strong)] shadow-none`;
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
  };

  useEffect(() => {
    if (!isOpen || !menuPortal || !containerRef.current) return;

    const updatePortalStyle = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPortalStyle({
        position: 'fixed',
        left: rect.left,
        top: rect.bottom + 8,
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
  }, [isOpen, menuPortal]);

  const menu = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={menuPortal ? portalStyle : undefined}
          data-glass-edge-mask
          data-os-shadow-mode="flat"
          className={`
            ${menuPortal ? 'z-[9999]' : 'absolute top-full left-0 right-0 mt-2 z-50'}
            ${menuClass}
          `}
        >
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 rounded-[inherit] ${menuSurfaceClass}`}
          />
          <div className="relative z-10 max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`
                  flex items-center justify-between gap-3
                  ${optionIdleClass}
                  ${option.value === value ? optionSelectedClass : ''}
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
                {option.value === value && (
                  <Check size={14} strokeWidth={2} className={checkIconClass} />
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`
          w-full flex items-center justify-between gap-2 border ${triggerSizeClass}
          transition-all duration-300
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
