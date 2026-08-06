import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Loader2, Search, X } from 'lucide-react';
import { apiService } from '../../services/apiService';
import type { EntityCandidate, EntityType } from '../../lib/entityRegistry';

interface SmartLinkedInputProps {
  value: string;
  fieldKey: string;
  entityTypes: EntityType[];
  isDarkMode?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ownerContext?: Record<string, string | undefined>;
  className?: string;
  onChange: (value: string) => void;
  onCandidateSelected?: (candidate: EntityCandidate) => void;
}

const MIN_QUERY_LENGTH = 2;

const SmartLinkedInput: React.FC<SmartLinkedInputProps> = ({
  value,
  fieldKey,
  entityTypes,
  isDarkMode = false,
  disabled = false,
  placeholder,
  ownerContext,
  className,
  onChange,
  onCandidateSelected,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<EntityCandidate[]>([]);
  const [linked, setLinked] = useState<EntityCandidate | null>(null);
  const latestQuery = useRef('');

  const query = String(value || '').trim();
  const canSearch = query.length >= MIN_QUERY_LENGTH && entityTypes.length > 0 && !disabled;
  const inputCls = className || `w-full px-3 py-3 border rounded-control outline-none text-xs font-light ${
    isDarkMode
      ? 'bg-slate-800 border-white/10 text-white placeholder:text-slate-500'
      : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
  } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;

  const entityLabel = useMemo(() => {
    if (!linked) return null;
    if (linked.entityType.startsWith('relation.')) return '已关联 关系档案';
    if (linked.entityType.startsWith('product.')) return '已关联 产品/面料';
    if (linked.entityType.startsWith('order.')) return '已关联 历史订单';
    return '已关联 数据档案';
  }, [linked]);

  useEffect(() => {
    if (!canSearch) {
      setItems([]);
      setLoading(false);
      return;
    }

    const ctrl = new AbortController();
    latestQuery.current = query;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const apiKey = apiService.getApiKey();
        if (apiKey) headers['X-Bambook-API-Key'] = apiKey;
        const res = await fetch(apiService.buildApiUrl('/v1/entities/search'), {
          method: 'POST',
          signal: ctrl.signal,
          headers,
          body: JSON.stringify({
            query,
            fieldKey,
            entityTypes,
            ownerContext,
            include: { fillPatch: true },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || `Entity search failed (${res.status})`);
        if (latestQuery.current === query) {
          setItems(Array.isArray(data.items) ? data.items : []);
          setOpen(true);
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          setItems([]);
        }
      } finally {
        if (latestQuery.current === query) setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [canSearch, entityTypes, fieldKey, ownerContext, query]);

  const choose = (candidate: EntityCandidate) => {
    setLinked(candidate);
    setOpen(false);
    onChange(candidate.title);
    onCandidateSelected?.(candidate);
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onFocus={() => items.length > 0 && setOpen(true)}
          onChange={(event) => {
            setLinked(null);
            onChange(event.target.value);
          }}
          className={`${inputCls} pr-9`}
        />
        <span className={`absolute right-3 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </span>
      </div>

      {entityLabel && (
        <div className={`mt-1 flex items-center gap-1 text-[9px] ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`}>
          <Link2 size={10} />
          <span>{entityLabel}: {linked?.title}</span>
          <button type="button" onClick={() => setLinked(null)} className="ml-1 opacity-70 hover:opacity-100">
            <X size={10} />
          </button>
        </div>
      )}

      {open && items.length > 0 && (
        <div className={`absolute z-50 mt-1 w-full overflow-hidden rounded-inset border shadow-none ${
          isDarkMode ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-200'
        }`}>
          {items.map((item) => (
            <button
              key={`${item.entityType}:${item.id}:${item.targetPath || ''}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
              className={`w-full text-left px-3 py-2 border-b last:border-b-0 ${
                isDarkMode ? 'border-white/5 hover:bg-white/5' : 'border-slate-100 hover:bg-slate-50'
              }`}
            >
              <div className={`text-xs font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.title}</div>
              <div className={`text-[10px] mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                {[item.entityType, item.subtitle, item.snippet].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SmartLinkedInput;
