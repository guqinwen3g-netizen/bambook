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
  surface?: 'default' | 'toolbar' | 'form';
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
  const isInlineToolbarTrigger = isToolbarSurface && triggerVariant === 'inline';
  const triggerSizeClass = isCompact
    ? `${isInlineToolbarTrigger ? 'h-9 px-2' : 'h-9 px-3'} py-0 ${isInlineToolbarTrigger ? 'rounded-control' : 'rounded-full'} text-[11px] leading-none`
    : 'h-9 px-3 py-0 rounded-full text-xs leading-none';
  const toolbarDarkBaseClass = BAMBOOK_OS.controls.select.toolbarDarkBase;
  const toolbarLightBaseClass = BAMBOOK_OS.controls.select.toolbarLightBase;
  const toolbarDarkHoverClass = `${toolbarDarkBaseClass} text-slate-400 hover:!bg-white/[0.065] hover:text-slate-50 hover:shadow-none active:scale-[0.98] active:bg-white/[0.045]`;
  const toolbarLightHoverClass = `${toolbarLightBaseClass} text-slate-500 hover:!bg-white/52 hover:text-deep-alt hover:shadow-none active:scale-[0.98] active:bg-white/38`;
  const toolbarDarkSelectedClass = BAMBOOK_OS.controls.select.toolbarDarkSelected;
  const toolbarLightSelectedClass = BAMBOOK_OS.controls.select.toolbarLightSelected;
  const toolbarDarkInlineClass = BAMBOOK_OS.controls.select.toolbarDarkInline;
  const toolbarLightInlineClass = BAMBOOK_OS.controls.select.toolbarLightInline;
  const toolbarDarkInlineOpenClass = BAMBOOK_OS.controls.select.toolbarDarkInlineOpen;
  const toolbarLightInlineOpenClass = BAMBOOK_OS.controls.select.toolbarLightInlineOpen;
  const formDarkIdleClass = `${BAMBOOK_OS.controls.recessedField.dark} hover:!border-white/[0.105]`;
  const formLightIdleClass = `${BAMBOOK_OS.controls.recessedField.light} hover:!border-slate-300/36`;
  const formDarkOpenClass = `${BAMBOOK_OS.controls.recessedField.dark} !bg-[rgba(7,18,32,0.30)] !border-white/[0.08] shadow-none`;
  const formLightOpenClass = `${BAMBOOK_OS.controls.recessedField.light} !bg-[rgba(255,255,255,0.34)] !border-slate-300/24 shadow-none`;
  const darkTriggerOpenClass = isToolbarSurface
    ? isInlineToolbarTrigger ? toolbarDarkInlineOpenClass : toolbarDarkSelectedClass
    : isFormSurface
      ? formDarkOpenClass
    : 'border-[var(--os-vnext-brand-blue)]/50 bg-white/5';
  const lightTriggerOpenClass = isToolbarSurface
    ? isInlineToolbarTrigger ? toolbarLightInlineOpenClass : toolbarLightSelectedClass
    : isFormSurface
      ? formLightOpenClass
    : 'border-[var(--os-vnext-brand-blue)] bg-white';
  const darkTriggerIdleClass = isToolbarSurface
    ? isInlineToolbarTrigger ? toolbarDarkInlineClass : toolbarDarkHoverClass
    : isFormSurface
      ? formDarkIdleClass
    : 'border-white/10 bg-white/5 hover:border-white/20';
  const lightTriggerIdleClass = isToolbarSurface
    ? isInlineToolbarTrigger ? toolbarLightInlineClass : toolbarLightHoverClass
    : isFormSurface
      ? formLightIdleClass
    : 'border-slate-200 bg-white hover:border-slate-300';
  const overlayMenu = BAMBOOK_OS.controls.overlayMenu;
  const darkMenuClass = `${overlayMenu.surfaceBase} ${overlayMenu.surfaceDark}`;
  const lightMenuClass = `${overlayMenu.surfaceBase} ${overlayMenu.surfaceLight}`;
  const darkMenuSurfaceClass = overlayMenu.surfaceLayerDark;
  const lightMenuSurfaceClass = overlayMenu.surfaceLayerLight;
  const darkOptionIdleClass = `${overlayMenu.itemBase} ${overlayMenu.itemDark}`;
  const lightOptionIdleClass = `${overlayMenu.itemBase} ${overlayMenu.itemLight}`;
  const darkOptionSelectedClass = overlayMenu.itemSelectedDark;
  const lightOptionSelectedClass = overlayMenu.itemSelectedLight;
  const checkIconClass = isDarkMode ? overlayMenu.checkDark : overlayMenu.checkLight;

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
            ${isDarkMode ? darkMenuClass : lightMenuClass}
          `}
        >
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 rounded-[inherit] ${isDarkMode ? darkMenuSurfaceClass : lightMenuSurfaceClass}`}
          />
          <div className="relative z-10 max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`
                  flex items-center justify-between gap-3
                  ${isDarkMode ? darkOptionIdleClass : lightOptionIdleClass}
                  ${option.value === value
                    ? isDarkMode
                      ? darkOptionSelectedClass
                      : lightOptionSelectedClass
                    : ''}
                `}
              >
                <div>
                  <span className={BAMBOOK_OS.typography.weight.ui}>{option.label}</span>
                  {option.description && (
                    <p className={`text-[10px] mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}`}>
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
          ${isOpen
            ? isDarkMode
              ? darkTriggerOpenClass
              : lightTriggerOpenClass
            : isDarkMode
              ? darkTriggerIdleClass
              : lightTriggerIdleClass}
          ${isDarkMode ? isToolbarSurface ? 'text-slate-200' : 'text-white' : 'text-slate-900'}
        `}
      >
        <span className={`min-w-0 truncate ${selectedOption ? '' : isDarkMode ? 'text-slate-400' : 'text-slate-400'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={isCompact ? 14 : 16}
          strokeWidth={1.5}
          className={`
            shrink-0
            transition-transform duration-300
            ${isOpen ? 'rotate-180' : ''}
            ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}
          `}
        />
      </button>

      {menuPortal && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
};

export default CustomSelect;
