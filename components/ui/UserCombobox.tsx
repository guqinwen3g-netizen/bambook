import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search, User } from 'lucide-react';
import { apiService, type UserAccountDirectoryOption } from '../../services/apiService';
import { BAMBOOK_OS } from './bambookOsTokens';

interface UserComboboxProps {
  /** 当前选中的用户 ID（受控值） */
  value: string;
  onChange: (userId: string) => void;
  /** 从候选中排除的用户 ID（如申请人本人 / 当前审批人，服务端仍 fail-closed 校验） */
  excludeIds?: string[];
  placeholder?: string;
  /** 宿主统一输入框配方（缺省走 recessedField 胶囊字段） */
  inputClassName?: string;
  disabled?: boolean;
}

/**
 * BDS 用户选择器（可搜索下拉）：姓名 + 角色 + 部门展示，受控值为 userId。
 *
 * 数据源：apiService.listUserAccounts()（/api/hr/personnel 聚合视图，服务端
 * 要求 owner/admin 角色）。目录加载失败（如无权限）时按既有 QC 人员选择器
 * 既定降级范式回落为手工录入用户 ID，不阻断主流程。
 */
const UserCombobox: React.FC<UserComboboxProps> = ({
  value,
  onChange,
  excludeIds,
  placeholder = '搜索并选择用户（姓名 / 角色 / 部门）',
  inputClassName,
  disabled = false,
}) => {
  const [users, setUsers] = useState<UserAccountDirectoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.listUserAccounts();
        if (!cancelled) setUsers(list);
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = useMemo(() => users.find((u) => u.id === value) ?? null, [users, value]);

  const candidates = useMemo(() => {
    const excluded = excludeIds && excludeIds.length > 0 ? new Set(excludeIds) : null;
    const lower = query.trim().toLowerCase();
    return users
      .filter((u) => (excluded ? !excluded.has(u.id) : true))
      .filter((u) => {
        if (!lower) return true;
        return (
          u.displayName.toLowerCase().includes(lower)
          || u.id.toLowerCase().includes(lower)
          || (u.department ?? '').toLowerCase().includes(lower)
          || (u.roles ?? []).some((r) => r.toLowerCase().includes(lower))
        );
      })
      .slice(0, 12);
  }, [users, excludeIds, query]);

  const baseInputCls = BAMBOOK_OS.controls.recessedField.base;
  const resolvedInputCls = inputClassName ?? `w-full pl-3 pr-9 py-3 border rounded-control outline-none text-xs font-light ${baseInputCls}`;

  // 降级：目录不可用（无权限 / 网络失败）→ 手工录入用户 ID（与 QC 人员选择器降级范式一致）
  if (loadFailed) {
    return (
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="用户目录不可用，请手工输入用户 ID"
        className={resolvedInputCls}
      />
    );
  }

  const displayMeta = (u: UserAccountDirectoryOption): string => {
    const roleText = (u.roles ?? []).filter(Boolean).join(' / ') || '未分配角色';
    return `${roleText}${u.department ? ` · ${u.department}` : ''}`;
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={open ? query : selected ? selected.displayName : query}
          disabled={disabled || loading}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // 重新键入即视为放弃已选用户，回到搜索态（受控值待重新选定）
            if (value) onChange('');
          }}
          onFocus={() => { setQuery(''); setOpen(true); }}
          placeholder={loading ? '加载用户目录…' : placeholder}
          className={resolvedInputCls}
        />
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle user dropdown"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} strokeWidth={2} />}
        </button>
      </div>
      {selected && !open && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-[var(--text-tertiary)]">
          <User size={10} />
          <span>{displayMeta(selected)} · {selected.id}</span>
        </div>
      )}

      {open && !loading && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-card border bg-[var(--recessed-bg)] border-[var(--border-c-default)]">
          {candidates.length === 0 && (
            <div className="px-3 py-3 text-[11px] flex items-center gap-2 text-[var(--text-tertiary)]">
              <Search size={12} />
              <span>无匹配用户</span>
            </div>
          )}
          {candidates.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                onChange(u.id);
                setQuery('');
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-[11px] flex items-center justify-between gap-3 hover:bg-[var(--hover-darken)] text-[var(--text-primary)]"
            >
              <span className="min-w-0">
                <span className="block truncate font-light">{u.displayName}</span>
                <span className="block truncate text-[9px] text-[var(--text-tertiary)]">{displayMeta(u)}</span>
              </span>
              <span className="shrink-0 font-mono text-[9px] text-[var(--text-tertiary)]">{u.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserCombobox;
