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
  const cardClass = 'rounded-inset border transition-all duration-300 border-white/45 bg-white/24 dark:border-white/[0.055] dark:bg-white/[0.018]';

  const labelCls = `text-[10px] font-light tracking-wide ${BAMBOOK_OS.tone.text.formLabel}`;

  const inputCls = `w-full h-9 px-3 rounded-control border outline-none text-xs font-light transition-all duration-200 ${BAMBOOK_OS.controls.recessedField.base}`;

  const primaryButtonCls = `h-9 px-4 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-all duration-200 ${
    `${BAMBOOK_OS.controls.stateControl.base} ${BAMBOOK_OS.controls.stateControl.interaction}`
  }`;

  const actionButtonCls = `h-9 px-3 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-all duration-200 ${
    BAMBOOK_OS.controls.actionControl.bordered
  }`;

  const subtleButtonCls = 'h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors border-white/45 text-slate-600 hover:text-deep-alt hover:bg-white/30 dark:border-white/12 dark:text-white/58 dark:hover:text-white/82 dark:hover:bg-white/[0.035]';

  const dangerButtonCls = 'h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors border-rose-300/50 text-rose-600 hover:text-rose-700 hover:bg-rose-50/60 dark:border-rose-300/20 dark:text-rose-200/70 dark:hover:text-rose-100 dark:hover:bg-rose-400/[0.06]';

  const sectionTitleClass = 'text-sm font-light text-slate-900 dark:text-white';
  const sectionMutedClass = 'text-xs font-light text-slate-500 dark:text-white/42';
  const textPrimaryClass = 'text-slate-800 dark:text-white/86';
  const textSecondaryClass = 'text-slate-500 dark:text-white/48';

  const thCls = 'px-3 py-2 text-left text-[10px] font-light tracking-wide text-slate-400 dark:text-white/40';
  const tdCls = `px-3 py-2.5 text-xs font-light ${textPrimaryClass}`;
  const rowCls = (selected: boolean) =>
    `w-full text-left transition-colors cursor-pointer ${
      selected
        ? 'bg-white/50 dark:bg-white/[0.05]'
        : 'hover:bg-white/30 dark:hover:bg-white/[0.025]'
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
