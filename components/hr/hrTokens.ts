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
  const cardClass = `rounded-inset border transition-all duration-300 ${
    isDarkMode ? 'border-white/[0.055] bg-white/[0.018]' : 'border-white/45 bg-white/24'
  }`;

  const labelCls = `text-[10px] font-light tracking-wide ${
    isDarkMode ? BAMBOOK_OS.tone.text.formLabelDark : BAMBOOK_OS.tone.text.formLabelLight
  }`;

  const inputCls = `w-full h-9 px-3 rounded-control border outline-none text-xs font-light transition-all duration-200 ${
    isDarkMode ? BAMBOOK_OS.controls.recessedField.dark : BAMBOOK_OS.controls.recessedField.light
  }`;

  const primaryButtonCls = `h-9 px-4 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-all duration-200 ${
    isDarkMode
      ? `${BAMBOOK_OS.controls.stateControl.baseDark} ${BAMBOOK_OS.controls.stateControl.interactionDark}`
      : `${BAMBOOK_OS.controls.stateControl.baseLight} ${BAMBOOK_OS.controls.stateControl.interactionLight}`
  }`;

  const actionButtonCls = `h-9 px-3 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-all duration-200 ${
    isDarkMode ? BAMBOOK_OS.controls.actionControl.borderedDark : BAMBOOK_OS.controls.actionControl.borderedLight
  }`;

  const subtleButtonCls = `h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors ${
    isDarkMode
      ? 'border-white/12 text-white/58 hover:text-white/82 hover:bg-white/[0.035]'
      : 'border-white/45 text-slate-600 hover:text-deep-alt hover:bg-white/30'
  }`;

  const dangerButtonCls = `h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors ${
    isDarkMode
      ? 'border-rose-300/20 text-rose-200/70 hover:text-rose-100 hover:bg-rose-400/[0.06]'
      : 'border-rose-300/50 text-rose-600 hover:text-rose-700 hover:bg-rose-50/60'
  }`;

  const sectionTitleClass = `text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`;
  const sectionMutedClass = `text-xs font-light ${isDarkMode ? 'text-white/42' : 'text-slate-500'}`;
  const textPrimaryClass = isDarkMode ? 'text-white/86' : 'text-slate-800';
  const textSecondaryClass = isDarkMode ? 'text-white/48' : 'text-slate-500';

  const thCls = `px-3 py-2 text-left text-[10px] font-light tracking-wide ${
    isDarkMode ? 'text-white/40' : 'text-slate-400'
  }`;
  const tdCls = `px-3 py-2.5 text-xs font-light ${textPrimaryClass}`;
  const rowCls = (selected: boolean) =>
    `w-full text-left transition-colors cursor-pointer ${
      selected
        ? isDarkMode
          ? 'bg-white/[0.05]'
          : 'bg-white/50'
        : isDarkMode
          ? 'hover:bg-white/[0.025]'
          : 'hover:bg-white/30'
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
