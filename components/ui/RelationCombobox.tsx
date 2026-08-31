import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Link2, Plus, Search } from 'lucide-react';
import type { Relation, RelationCategory } from '../../types';
import { BAMBOOK_OS } from './bambookOsTokens';

interface RelationComboboxProps {
  value: string;
  /** Optional FK snapshot — when set, locks the displayed name to the matching Relation. */
  relationId?: string;
  relations: Relation[];
  /** Filter the dropdown to one or more Relation categories. */
  filterCategories?: RelationCategory[];
  isDarkMode?: boolean;
  placeholder?: string;
  required?: boolean;
  /**
   * Optional override for the input element classes. Hosts with a unified
   * field recipe (e.g. OrderFieldInput's capsule fieldShell) pass it here so
   * the combobox renders pixel-identical to sibling text inputs. When omitted,
   * the legacy standalone style is used.
   */
  inputClassName?: string;
  onChange: (next: { name: string; relationId?: string; relation?: Relation }) => void;
  /**
   * Triggered when the user clicks "+ Create new". The host should open its
   * Relation creation flow and call back with the new Relation. We only need
   * the name + id to wire up the FK snapshot.
   */
  onCreateNew?: (typedName: string) => Promise<{ id: string; name: string } | null> | { id: string; name: string } | null;
}

/**
 * Searchable combobox over the Relations table. Designed for the Customer /
 * Mill / Consignee / Bill-to fields on the Order detail card and manual entry
 * modal: it stores both the Relation FK (for joins/analytics) and a plain
 * name snapshot (so renaming a Relation later doesn't silently rewrite old
 * orders' party names).
 *
 * Free-typed text is allowed — the host can decide whether to prompt the user
 * to also create a matching Relation entry via `onCreateNew`.
 */
const RelationCombobox: React.FC<RelationComboboxProps> = ({
  value,
  relationId,
  relations,
  filterCategories,
  isDarkMode = false,
  placeholder,
  required,
  inputClassName,
  onChange,
  onCreateNew,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 键盘导航：-1 = 无高亮项；候选行与末尾「创建新档案」共用同一索引序列
  const [activeIndex, setActiveIndex] = useState(-1);

  // Keep the input in sync when the host updates `value` programmatically.
  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const candidates = useMemo(() => {
    const cats = filterCategories && filterCategories.length > 0 ? new Set(filterCategories) : null;
    const isInternal = cats?.has('Internal');
    const lower = query.trim().toLowerCase();
    return relations
      .filter((r) => !r.deletedAt)
      .filter((r) => (isInternal ? true : r.isOrganization))
      .filter((r) => (cats ? cats.has(r.category) : true))
      .filter((r) => (lower ? r.name.toLowerCase().includes(lower) : true))
      .slice(0, 12);
  }, [relations, filterCategories, query]);

  const exactMatch = candidates.find((r) => r.name.toLowerCase() === query.trim().toLowerCase());
  const showCreateOption = !!onCreateNew && query.trim().length > 0 && !exactMatch;
  const optionCount = candidates.length + (showCreateOption ? 1 : 0);

  // 候选集变化时重置键盘高亮；列表打开时默认高亮首项（对齐浏览器/OS 下拉惯例）
  useEffect(() => {
    setActiveIndex(open && optionCount > 0 ? 0 : -1);
  }, [open, query, optionCount]);

  // 高亮项滚入可视区
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pickCandidate = (r: Relation) => {
    setQuery(r.name);
    setOpen(false);
    onChange({ name: r.name, relationId: r.id, relation: r });
  };

  const pickCreate = async () => {
    const created = await onCreateNew!(query.trim());
    if (created) {
      setQuery(created.name);
      onChange({ name: created.name, relationId: created.id, relation: undefined });
    }
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex((i) => (optionCount === 0 ? -1 : Math.min(i + 1, optionCount - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (!open || activeIndex < 0) return;
      e.preventDefault();
      if (activeIndex < candidates.length) pickCandidate(candidates[activeIndex]);
      else if (showCreateOption) void pickCreate();
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      // 阻止冒泡到全局 ESC 监听（如 BdsDialog/覆盖层），只收下拉
      e.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  // 兜底输入框配方与全局胶囊字段同源（recessedField）；旧硬编码深底/浅描边组合
  // 会被 flat-experimental 护栏强制 border:0，导致输入框隐形。
  const baseInputCls = BAMBOOK_OS.controls.recessedField.base;
  const resolvedInputCls = inputClassName ?? `w-full pl-3 pr-9 py-3 border rounded-control outline-none text-xs font-light ${baseInputCls}`;

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          required={required}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Free-typed text immediately propagates as the snapshot name. The
            // FK is cleared because we no longer know it matches a Relation.
            onChange({ name: e.target.value, relationId: undefined });
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={resolvedInputCls}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle dropdown"
          className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`}
        >
          <ChevronDown size={14} strokeWidth={2} />
        </button>
      </div>
      {/* FK 关联提示：内联在输入框下方，与 SmartLinkedInput 的「已关联」行同款，
          不再以贴纸形式压在胶囊边框上 */}
      {relationId && (
        <div className={`mt-1 flex items-center gap-1 text-[9px] text-[var(--text-tertiary)]`}>
          <Link2 size={10} />
          <span>已关联关系档案</span>
        </div>
      )}

      {open && (
        <div
          ref={listRef}
          className={`absolute z-50 mt-1 w-full max-h-60 overflow-y-auto ${BAMBOOK_OS.controls.overlayMenu.surfaceBase} ${BAMBOOK_OS.controls.overlayMenu.surface}`}
        >
          {candidates.length === 0 && !showCreateOption && (
            <div className={`px-3 py-3 text-xs flex items-center gap-2 text-[var(--text-tertiary)]`}>
              <Search size={12} />
              <span>无匹配的关系档案</span>
            </div>
          )}

          {candidates.map((r, idx) => (
            <button
              key={r.id}
              type="button"
              data-option-index={idx}
              onClick={() => pickCandidate(r)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 hover:bg-[var(--hover-darken)] text-[var(--text-primary)] ${idx === activeIndex ? 'bg-[var(--hover-darken)]' : ''}`}
            >
              <span className="font-light truncate">{r.name}</span>
              <span className={`shrink-0 text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]`}>
                {r.category}
              </span>
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              data-option-index={candidates.length}
              onClick={() => { void pickCreate(); }}
              onMouseEnter={() => setActiveIndex(candidates.length)}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 border-t border-[var(--border-c-subtle)] text-[var(--text-secondary)] hover:bg-[var(--hover-darken)] ${activeIndex === candidates.length ? 'bg-[var(--hover-darken)]' : ''}`}
            >
              <Plus size={14} />
              <span>创建新档案 "{query.trim()}"</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default RelationCombobox;
