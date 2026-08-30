/**
 * C3 HR tab 共享样式 token — 与 HRManager / AdminPanel 同源（BAMBOOK_OS 设计系统）。
 * 5 个 HR 子 tab 共用，避免逐文件重复。
 */
import { BAMBOOK_OS } from '../ui/bambookOsTokens';

export interface HrTokens {
  cardClass: string;
  labelCls: string;
  inputCls: string;
  primaryButtonCls: string;
  actionButtonCls: string;
  subtleButtonCls: string;
  dangerButtonCls: string;
  sectionTitleClass: string;
  sectionMutedClass: string;
  textPrimaryClass: string;
  textSecondaryClass: string;
  thCls: string;
  tdCls: string;
  rowCls: (selected: boolean) => string;
}

export function hrTokens(isDarkMode: boolean): HrTokens {
  // P2 收口：主题分支坍缩为单写自适应类（浅色为基 + dark: 变体），isDarkMode 参数保留兼容调用方
  const cardClass = 'rounded-inset border transition-colors duration-300 border-[var(--border-c-default)] bg-[var(--recessed-bg)]';

  const labelCls = `text-[10px] font-light tracking-wide ${BAMBOOK_OS.tone.text.formLabel}`;

  const inputCls = 'bds-input';

  const primaryButtonCls = `h-9 px-4 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-colors duration-200 ${
    `${BAMBOOK_OS.controls.stateControl.base} ${BAMBOOK_OS.controls.stateControl.interaction}`
  }`;

  const actionButtonCls = `h-9 px-3 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-colors duration-200 ${
    BAMBOOK_OS.controls.actionControl.bordered
  }`;

  const subtleButtonCls = 'h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-darken)]';

  const dangerButtonCls = 'h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors border-[var(--danger-border)] text-[var(--danger-text)] hover:bg-[var(--danger-tint-hover)]';

  const sectionTitleClass = 'text-sm font-light text-[var(--text-primary)]';
  const sectionMutedClass = 'text-xs font-light text-[var(--text-tertiary)]';
  const textPrimaryClass = 'text-[var(--text-primary)]';
  const textSecondaryClass = 'text-[var(--text-secondary)]';

  const thCls = 'px-3 py-2 text-left text-[10px] font-light tracking-wide text-[var(--text-tertiary)]';
  const tdCls = `px-3 py-2.5 text-xs font-light ${textPrimaryClass}`;
  const rowCls = (selected: boolean) =>
    `w-full text-left transition-colors cursor-pointer ${
      selected
        ? 'bg-[var(--active-darken)]'
        : 'hover:bg-[var(--hover-darken)]'
    }`;

  return {
    cardClass,
    labelCls,
    inputCls,
    primaryButtonCls,
    actionButtonCls,
    subtleButtonCls,
    dangerButtonCls,
    sectionTitleClass,
    sectionMutedClass,
    textPrimaryClass,
    textSecondaryClass,
    thCls,
    tdCls,
    rowCls,
  };
}

// ── 共享小工具 ──

export interface HrPersonnelOption {
  id: string;
  displayName: string;
}

export const hrFormatDate = (value?: string | null): string => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

export const hrFormatMoney = (value: number | null | undefined, currency = 'CNY'): string => {
  if (value === null || value === undefined) return '-';
  return `${currency} ${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const hrOptionLabel = (options: ReadonlyArray<{ value: string; label: string }>, value: string | null | undefined): string =>
  options.find(o => o.value === value)?.label || value || '-';

/**
 * R678-⑦ HR 域错误统一转译：
 * 后端 scope 门 403 原文（INSUFFICIENT_SCOPE…）直接进横幅/toast 对用户无意义，
 * 统一转译为「无权限执行该操作」；其余错误保留后端中文 message，兜底 fallback。
 */
export const hrErrorMessage = (e: unknown, fallback: string): string => {
  const msg = (e as { message?: unknown })?.message;
  if (typeof msg === 'string' && msg.length > 0) {
    if (msg.includes('INSUFFICIENT_SCOPE')) return '无权限执行该操作';
    return msg;
  }
  return fallback;
};
