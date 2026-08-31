import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Loader2, Search, X } from 'lucide-react';
import { apiService } from '../../services/apiService';
import type { EntityCandidate, EntityType } from '../../lib/entityRegistry';
import { BAMBOOK_OS } from './bambookOsTokens';

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
  const isUserTyping = useRef(false);

  const query = String(value || '').trim();
  const canSearch = query.length >= MIN_QUERY_LENGTH && entityTypes.length > 0 && !disabled;
  // 兜底输入框配方与全局胶囊字段同源（recessedField）；旧硬编码深底/浅描边组合
  // 会被 flat-experimental 护栏强制 border:0，导致输入框隐形。
  const inputCls = className || `w-full px-3 py-3 border rounded-control outline-none text-xs font-light ${
    BAMBOOK_OS.controls.recessedField.base
  } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;

  const entityLabel = useMemo(() => {
    if (!linked) return null;
    if (linked.entityType.startsWith('relation.')) return '已关联 关系档案';
    if (linked.entityType.startsWith('product.')) return '已关联 产品/面料';
    if (linked.entityType.startsWith('order.')) return '已关联 历史订单';
    return '已关联 数据档案';
  }, [linked]);

  useEffect(() => {
    if (!canSearch || !isUserTyping.current) {
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
            isUserTyping.current = true;
            setLinked(null);
            onChange(event.target.value);
          }}
          className={`${inputCls} pr-9`}
        />
        <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]`}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </span>
      </div>

      {entityLabel && (
        <div className={`mt-1 flex items-center gap-1 text-[9px] text-[var(--text-secondary)]`}>
          <Link2 size={14} />
          <span>{entityLabel}: {linked?.title}</span>
          <button type="button" onClick={() => setLinked(null)} className="ml-1 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {open && items.length > 0 && (
        <div className={`absolute z-50 mt-1 w-full ${BAMBOOK_OS.controls.overlayMenu.surfaceBase} ${BAMBOOK_OS.controls.overlayMenu.surface}`}>
          {items.map((item) => (
            <button
              key={`${item.entityType}:${item.id}:${item.targetPath || ''}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
              className={`w-full text-left px-3 py-2 border-b last:border-b-0 border-[var(--border-c-subtle)] hover:bg-[var(--hover-darken)]`}
            >
              <div className={`truncate text-xs font-light text-[var(--text-primary)]`}>{item.title}</div>
              <div className={`truncate text-[10px] mt-0.5 text-[var(--text-tertiary)]`}>
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
