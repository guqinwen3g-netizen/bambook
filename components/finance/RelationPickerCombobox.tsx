/**
 * RelationPickerCombobox — 财务域客户/供应商可搜索选择器（R678）
 *
 * 替代原生 <select> 全量渲染（listRelations 默认窗口 500 条，原生下拉不可搜索）：
 *   - 受控值 = Relation ID（'' = 未选/空选项语义由 emptyOptionLabel 决定）
 *   - 搜索匹配 name / chineseName / englishName / id（不区分大小写）
 *   - 量级截断：匹配超过 RELATION_PICKER_MAX_VISIBLE 时只渲染前 50 条并透明披露，
 *     引导用户输入关键字缩小范围（不伪造"已加载全部"）
 *
 * 设计：flat 无阴影、token 色板、字重 ≤300；点击外部 / Esc 关闭。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { Relation } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** 下拉可见上限：超出截断并提示（配合搜索缩小范围） */
const RELATION_PICKER_MAX_VISIBLE = 50;

export const relationPickerDisplayName = (r: Relation): string => r.chineseName || r.name;

interface RelationPickerComboboxProps {
  /** 当前选中的 Relation ID（'' = 未选） */
  value: string;
  /** 候选列表（宿主预过滤方向/类别；组件内再做关键字过滤） */
  options: Relation[];
  onChange: (id: string, relation?: Relation) => void;
  placeholder?: string;
  /** 提供时下拉顶部渲染「空值」行（如「手动输入（不关联档案）」「全部客户」），选中即 onChange('') */
  emptyOptionLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** 宿主统一输入框配方（缺省 bds-input sm w-full） */
  inputClassName?: string;
}

const RelationPickerCombobox: React.FC<RelationPickerComboboxProps> = ({
  value,
  options,
  onChange,
  placeholder = '搜索并选择档案（名称 / 中文名 / ID）',
  emptyOptionLabel,
  ariaLabel,
  disabled = false,
  inputClassName,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find(r => r.id === value) ?? null, [options, value]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const { matches, truncated } = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const hit = (r: Relation) =>
      !lower
      || r.name.toLowerCase().includes(lower)
      || (r.chineseName ?? '').toLowerCase().includes(lower)
      || (r.englishName ?? '').toLowerCase().includes(lower)
      || r.id.toLowerCase().includes(lower);
    const all = options.filter(hit);
    return {
      matches: all.slice(0, RELATION_PICKER_MAX_VISIBLE),
      truncated: all.length > RELATION_PICKER_MAX_VISIBLE ? all.length - RELATION_PICKER_MAX_VISIBLE : 0,
    };
  }, [options, query]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          value={open ? query : selected ? relationPickerDisplayName(selected) : ''}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(''); setOpen(true); }}
          placeholder={selected && !open ? relationPickerDisplayName(selected) : placeholder}
          className={cx(inputClassName ?? 'bds-input sm w-full', 'pr-8')}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          aria-label="展开/收起档案下拉"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
        >
          <ChevronDown size={14} strokeWidth={2} />
        </button>
      </div>

      {open && (
        <div className="absolute z-[var(--z-pop)] mt-1 max-h-60 w-full overflow-y-auto rounded-card border border-[var(--border-c-default)] bg-[var(--recessed-bg)]">
          {emptyOptionLabel && (
            <button
              type="button"
              onClick={() => { onChange('', undefined); setQuery(''); setOpen(false); }}
              className={cx(
                'w-full px-3 py-2 text-left text-[11px] font-light transition-colors hover:bg-[var(--hover-darken)]',
                value === '' ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
              )}
            >
              {emptyOptionLabel}
            </button>
          )}
          {matches.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] font-light text-[var(--text-tertiary)]">
              <Search size={12} />
              <span>无匹配档案，请更换关键字</span>
            </div>
          ) : (
            matches.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onChange(r.id, r); setQuery(''); setOpen(false); }}
                className={cx(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[11px] transition-colors hover:bg-[var(--hover-darken)]',
                  r.id === value ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                )}
              >
                <span className="min-w-0 truncate font-light">{relationPickerDisplayName(r)}</span>
                {r.chineseName && r.name !== r.chineseName && (
                  <span className="shrink-0 truncate text-[9px] font-light text-[var(--text-tertiary)]">{r.name}</span>
                )}
              </button>
            ))
          )}
          {truncated > 0 && (
            <div className="border-t border-[var(--border-c-subtle)] px-3 py-1.5 text-[10px] font-light text-[var(--text-tertiary)]">
              另有 {truncated} 条匹配未显示——请输入关键字缩小范围
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RelationPickerCombobox;
