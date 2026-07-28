import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import type { Relation, RelationCategory } from '../../types';

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
  onChange,
  onCreateNew,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  const wrapRef = useRef<HTMLDivElement>(null);

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

  const baseInputCls = isDarkMode
    ? 'bg-slate-800 border-white/10 text-white placeholder:text-slate-500'
    : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400';

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
          className={`w-full pl-3 pr-9 py-3 border rounded-xl outline-none text-xs font-light ${baseInputCls}`}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle dropdown"
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md ${isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}
        >
          <ChevronDown size={14} strokeWidth={2} />
        </button>
        {relationId && (
          <span
            title={`Linked to Relation ${relationId}`}
            className={`absolute -top-2 right-2 px-1.5 py-0.5 rounded-md text-[8px] font-light uppercase tracking-wider ${isDarkMode ? 'bg-white/10 text-white/70 border border-white/15' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}
          >
            FK
          </span>
        )}
      </div>

      {open && (
        <div
          className={`absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border shadow-none ${
            isDarkMode ? 'bg-deep border-white/10' : 'bg-white border-slate-200'
          }`}
        >
          {candidates.length === 0 && !showCreateOption && (
            <div className={`px-3 py-3 text-[11px] flex items-center gap-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              <Search size={12} />
              <span>无匹配的关系档案</span>
            </div>
          )}

          {candidates.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setQuery(r.name);
                setOpen(false);
                onChange({ name: r.name, relationId: r.id, relation: r });
              }}
              className={`w-full text-left px-3 py-2 text-[11px] flex items-center justify-between gap-3 ${
                isDarkMode ? 'hover:bg-white/5 text-slate-200' : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span className="font-light truncate">{r.name}</span>
              <span className={`shrink-0 text-[9px] uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                {r.category}
              </span>
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              onClick={async () => {
                const created = await onCreateNew!(query.trim());
                if (created) {
                  setQuery(created.name);
                  onChange({ name: created.name, relationId: created.id, relation: undefined });
                }
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 border-t ${
                isDarkMode ? 'border-white/10 text-white/70 hover:bg-white/5' : 'border-slate-100 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Plus size={12} />
              <span>创建新档案 "{query.trim()}"</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default RelationCombobox;
