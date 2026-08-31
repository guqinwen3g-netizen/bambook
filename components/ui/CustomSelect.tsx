import React, { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
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
  disabled?: boolean;
  className?: string;
  /** 浮层 createPortal 到 document.body（fixed + z-9999）——默认开启。
   *  宿主容器的 overflow-hidden / isolate / 磨砂层 / 低 z-index 堆叠上下文都会裁剪或遮挡
   *  absolute 浮层（2026-08-31 实机验收实证），portal 化是唯一根治路径；
   *  显式传 false 仅限确知无裁剪且需随宿主滚动的特殊场景。 */
  menuPortal?: boolean;
  size?: 'default' | 'compact';
  /** 触发器 aria-label（迁移原生 select 的可访问名，如「状态筛选」） */
  ariaLabel?: string;
  /** field = 40px pill recessed 触发器几何（h-40px(--h-btn-md) / rounded-[--radius-pill] / text-xs，filterbar 纪律），
   *  供 filterbar/表单承接下拉选择，浮层走 BDS 自绘容器（W4 原生浮层收编） */
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
  disabled = false,
  className = '',
  menuPortal = true,
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
  // typeahead 首字母跳选：连续击键累积 buffer，300ms 无续击自动清空
  const typeaheadBufferRef = useRef('');
  const typeaheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  const selectedOption = options.find(opt => opt.value === value);
  const isCompact = size === 'compact';
  const isToolbarSurface = surface === 'toolbar';
  const isFormSurface = surface === 'form';
  const isFieldSurface = surface === 'field';
  const isInlineToolbarTrigger = isToolbarSurface && triggerVariant === 'inline';
  // field 触发器几何 = 40px pill recessed（filterbar 纪律：.bds-filterbar .bds-input
  // 等高同形，见 components.css §21）。原 `--r-control-sm` token 在 styles/ 全局不存在
  // （tailwind 静默丢弃 → 方形按钮），且 34px 与同 bar 的 bds-input(40px)/segment/toggle
  // 高度错位，故收拢为 --h-btn-md + --radius-pill。
  const triggerSizeClass = isFieldSurface
    ? 'h-[var(--h-btn-md)] px-3 py-0 rounded-[var(--radius-pill)] text-xs leading-none'
    : isCompact
      ? `${isInlineToolbarTrigger ? 'h-[var(--h-input-sm)] px-2' : 'h-[var(--h-input-sm)] px-3'} py-0 ${isInlineToolbarTrigger ? 'rounded-control' : 'rounded-full'} text-xs leading-none`
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

  // ── D-6 防越界：options 引用变化（筛选/异步刷新重建数组）时 clamp activeIndex——
  //    越界（>= options.length）或落点已 disabled 则回退到首个可用项，避免
  //    aria-activedescendant 指向失效项与 Enter 选中错位；仍有效的 activeIndex 原样保持
  //    （函数式 setState 返回同一引用 → React bail out，不引入多余重渲染） ──
  useEffect(() => {
    setActiveIndex(prev => {
      if (prev < 0 || (prev < options.length && !options[prev].disabled)) return prev;
      return enabledIndices[0] ?? -1;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

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

  // typeahead 计时器随组件卸载清理（防泄漏）
  useEffect(() => () => {
    if (typeaheadTimeoutRef.current) clearTimeout(typeaheadTimeoutRef.current);
  }, []);

  // ── click-outside + focusin 关闭（2026-08-31 走查 D-5）：isOpen 门控——关闭态零监听，
  //    打开态才挂载；focusin 兜住 programmatic focus() 等不产生 mousedown 的焦点移动 ──
  useEffect(() => {
    if (!isOpen) return;
    const isOutside = (target: Node) =>
      !containerRef.current?.contains(target) && !menuRef.current?.contains(target);
    const handleDismiss = (e: Event) => {
      if (isOutside(e.target as Node)) setIsOpen(false);
    };

    document.addEventListener('mousedown', handleDismiss);
    document.addEventListener('focusin', handleDismiss);
    return () => {
      document.removeEventListener('mousedown', handleDismiss);
      document.removeEventListener('focusin', handleDismiss);
    };
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    // 键盘选择后焦点回触发器（ARIA combobox 惯例）；preventScroll 防离屏触发器引发滚动跳回
    containerRef.current?.querySelector<HTMLButtonElement>('[data-select-trigger]')?.focus({ preventScroll: true });
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
      default: {
        // ── typeahead 首字母跳选（原生 select 键盘能力回退）：仅展开态响应可打印字符；
        //    buffer 以 label 开头匹配（不区分大小写），从当前高亮项之后循环查找首个命中。
        //    收起态不处理——保持「打开」快捷键语义不变 ──
        if (isOpen && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          if (typeaheadTimeoutRef.current) clearTimeout(typeaheadTimeoutRef.current);
          typeaheadBufferRef.current += e.key;
          typeaheadTimeoutRef.current = setTimeout(() => {
            typeaheadBufferRef.current = '';
            typeaheadTimeoutRef.current = null;
          }, 300);
          const buffer = typeaheadBufferRef.current.toLowerCase();
          const startPos = enabledIndices.indexOf(activeIndex);
          const searchOrder = startPos === -1
            ? enabledIndices
            : [...enabledIndices.slice(startPos + 1), ...enabledIndices.slice(0, startPos + 1)];
          const hit = searchOrder.find(i => options[i].label.toLowerCase().startsWith(buffer));
          if (hit !== undefined) setActiveIndex(hit);
        }
        break;
      }
    }
  };

  // ── 浮层展开方向：非 portal 按 trigger 视口空间判定；portal 在定位计算时判定 ──
  useEffect(() => {
    if (!isOpen || menuPortal || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const estimate = Math.min(MENU_MAX_HEIGHT, options.length * MENU_EST_ITEM_HEIGHT + 12) + VIEWPORT_PADDING;
    setDropUp(rect.bottom + estimate > window.innerHeight && rect.top - estimate > 0);
  }, [isOpen, menuPortal, options.length]);

  // ── portal 定位（useLayoutEffect：同步于 paint 前，消灭首帧 static 占位）；
  //    值 diff 守卫：rect 未变（如浮层内滚动）不 setState，杜绝每滚动帧全菜单重渲染 ──
  const lastPortalStyleRef = useRef<{ left: number; top: number; width: number; flipUp: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!isOpen || !menuPortal || !containerRef.current) {
      if (!isOpen) lastPortalStyleRef.current = null;
      return;
    }

    const updatePortalStyle = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // 触发器完全离场（滚出视口两端）→ 自动关闭（业界惯例，防浮层悬空不可达）
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setIsOpen(false);
        return;
      }
      const estimate = Math.min(MENU_MAX_HEIGHT, options.length * MENU_EST_ITEM_HEIGHT + 12) + VIEWPORT_PADDING;
      const overflowBelow = rect.bottom + estimate > window.innerHeight;
      const flipUp = overflowBelow && rect.top - estimate > 0;
      // 双向对称 clamp：向上贴视口顶 / 向下贴视口底（浮层自身 max-h-60 滚动兜底），
      // 触发器越过视口顶（rect.bottom<0）时 top 不再为负——浮层不再渲染到视口外不可见区
      const next = {
        left: rect.left,
        top: flipUp
          ? Math.max(VIEWPORT_PADDING, rect.top - estimate)
          : Math.max(VIEWPORT_PADDING, Math.min(rect.bottom + 8, window.innerHeight - VIEWPORT_PADDING)),
        width: rect.width,
        flipUp,
      };
      const last = lastPortalStyleRef.current;
      if (last && last.left === next.left && last.top === next.top && last.width === next.width && last.flipUp === next.flipUp) return;
      lastPortalStyleRef.current = next;
      setDropUp(next.flipUp);
      setPortalStyle({
        position: 'fixed',
        left: next.left,
        top: next.top,
        // minWidth 允许长选项 label 撑宽浮层（宽度不再锁死触发器宽），maxWidth 视口兜底
        minWidth: next.width,
        maxWidth: window.innerWidth - VIEWPORT_PADDING * 2,
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
          style={{
            ...(menuPortal ? portalStyle : undefined),
            // exit 0.2s 动画期间收口命中（2026-08-31 走查）：渐隐中的隐形 option 会拦截
            // 用户对浮层下方元素的点击（幽灵点击误改值/吞点击），关闭同帧即不可命中
            pointerEvents: isOpen ? undefined : 'none',
          }}
          onKeyDown={(e) => {
            // 防御性 Esc 拦截：焦点意外落在浮层内时（如外部脚本重定向），Esc 仍只关下拉不关宿主弹层
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(false);
            }
          }}
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
          <div className="relative z-10 max-h-60 overflow-y-auto">
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
                  tabIndex={-1}
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
                  <div className="min-w-0">
                    {/* min-w-0 + truncate：窄触发器场景下长 label 截断而非撑爆浮层（portal minWidth 已允许扩展，双保险） */}
                    <span className={`block truncate ${BAMBOOK_OS.typography.weight.ui}`}>{option.label}</span>
                    {option.description && (
                      <p className={`text-[10px] mt-0.5 truncate text-[var(--text-tertiary)]`}>
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
