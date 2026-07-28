// RDL 低饱和 semantic status tokens
// 保留 neutral/active/info/warning/danger/success/destructive/rebate 语义层级差
// 全部使用中性 opacity 组合（white/slate + opacity），不依赖 Tailwind 彩色类名
// 语义层级差通过 opacity 强度 + border 强度表达（dark: white 递增 / light: slate 递增）

export type StatusSemantic =
  | 'neutral'      // 中性（最弱强调）
  | 'active'       // 活跃（实时、进行中）
  | 'info'         // 信息（已分配、规划）
  | 'warning'      // 警告（待审批、暂停）
  | 'danger'       // 危险（逾期、错误）
  | 'success'      // 成功（复制成功、操作完成）
  | 'destructive'  // 销毁操作（删除按钮）
  | 'rebate';      // 退税专用（业务概念强调）

// statusSemanticClass — 完整 chip 样式（bg + text + border）
// dark: white opacity 组合（opacity 自 neutral -> danger 递增）
// light: slate 标准值组合（slate-400/500/600/700，仅标准 Tailwind 值）
export const statusSemanticClass = (semantic: StatusSemantic, isDarkMode?: boolean): string => {
  const tokens: Record<StatusSemantic, { dark: string; light: string }> = {
    neutral: {
      dark: 'bg-white/[0.03] text-white/45 border-white/[0.06]',
      light: 'bg-slate-50/40 text-slate-400 border-slate-200/30',
    },
    active: {
      dark: 'bg-white/[0.05] text-white/60 border-white/[0.08]',
      light: 'bg-slate-100/50 text-slate-500 border-slate-200/50',
    },
    info: {
      dark: 'bg-white/[0.04] text-white/50 border-white/[0.07]',
      light: 'bg-slate-50/50 text-slate-500 border-slate-200/40',
    },
    warning: {
      dark: 'bg-white/[0.07] text-white/70 border-white/[0.10]',
      light: 'bg-slate-100/65 text-slate-600 border-slate-300/60',
    },
    danger: {
      dark: 'bg-white/[0.08] text-white/75 border-white/[0.11]',
      light: 'bg-slate-200/60 text-slate-700 border-slate-300/70',
    },
    success: {
      dark: 'bg-white/[0.05] text-white/60 border-white/[0.08]',
      light: 'bg-slate-100/50 text-slate-500 border-slate-200/50',
    },
    destructive: {
      dark: 'bg-white/[0.06] text-white/65 border-white/[0.09]',
      light: 'bg-slate-100/60 text-slate-600 border-slate-300/50',
    },
    rebate: {
      dark: 'bg-white/[0.05] text-white/60 border-white/[0.08]',
      light: 'bg-slate-100/50 text-slate-500 border-slate-200/50',
    },
  };
  return tokens[semantic][isDarkMode ? 'dark' : 'light'];
};

// statusSemanticText — 仅文字色（用于 icon/label）
// dark: text-white/[opacity]
// light: text-slate-{400,500,600,700}（仅用标准 Tailwind 步进值，跳过非标准中间档）
export const statusSemanticText = (semantic: StatusSemantic, isDarkMode?: boolean): string => {
  const textTokens: Record<StatusSemantic, { dark: string; light: string }> = {
    neutral:     { dark: 'text-white/45', light: 'text-slate-400' },
    active:      { dark: 'text-white/60', light: 'text-slate-500' },
    info:        { dark: 'text-white/50', light: 'text-slate-500' },
    warning:     { dark: 'text-white/70', light: 'text-slate-600' },
    danger:      { dark: 'text-white/75', light: 'text-slate-700' },
    success:     { dark: 'text-white/60', light: 'text-slate-500' },
    destructive: { dark: 'text-white/65', light: 'text-slate-600' },
    rebate:      { dark: 'text-white/60', light: 'text-slate-500' },
  };
  return textTokens[semantic][isDarkMode ? 'dark' : 'light'];
};

// statusSemanticBg — 仅背景色（用于 dot/pulse 实心圆点）
// dark: bg-white/[opacity]
// light: bg-slate-{400-600}（仅用标准 Tailwind 值）
export const statusSemanticBg = (semantic: StatusSemantic, isDarkMode?: boolean): string => {
  const bgTokens: Record<StatusSemantic, { dark: string; light: string }> = {
    neutral:     { dark: 'bg-white/40', light: 'bg-slate-400' },
    active:      { dark: 'bg-white/55', light: 'bg-slate-500' },
    info:        { dark: 'bg-white/50', light: 'bg-slate-400' },
    warning:     { dark: 'bg-white/65', light: 'bg-slate-500' },
    danger:      { dark: 'bg-white/70', light: 'bg-slate-600' },
    success:     { dark: 'bg-white/55', light: 'bg-slate-500' },
    destructive: { dark: 'bg-white/60', light: 'bg-slate-500' },
    rebate:      { dark: 'bg-white/55', light: 'bg-slate-500' },
  };
  return bgTokens[semantic][isDarkMode ? 'dark' : 'light'];
};

// statusSemanticGradient — 渐变（用于 banner/card 强调态，仅 bg+border，不含 text）
// dark: from-white/[opacity] to-transparent border-white/[opacity]
// light: from-slate-{50,100,200} to-transparent border-slate-{200,300}
export const statusSemanticGradient = (semantic: StatusSemantic, isDarkMode?: boolean): string => {
  const gradTokens: Record<StatusSemantic, { dark: string; light: string }> = {
    neutral:     { dark: 'from-white/[0.04] to-transparent border-white/[0.08]', light: 'from-slate-50 to-transparent border-slate-200/40' },
    active:      { dark: 'from-white/[0.06] to-transparent border-white/[0.10]', light: 'from-slate-100 to-transparent border-slate-200/50' },
    info:        { dark: 'from-white/[0.05] to-transparent border-white/[0.09]', light: 'from-slate-50 to-transparent border-slate-200/45' },
    warning:     { dark: 'from-white/[0.08] to-transparent border-white/[0.12]', light: 'from-slate-100 to-transparent border-slate-300/60' },
    danger:      { dark: 'from-white/[0.10] to-transparent border-white/[0.14]', light: 'from-slate-200 to-transparent border-slate-300/70' },
    success:     { dark: 'from-white/[0.06] to-transparent border-white/[0.10]', light: 'from-slate-100 to-transparent border-slate-200/50' },
    destructive: { dark: 'from-white/[0.07] to-transparent border-white/[0.11]', light: 'from-slate-100 to-transparent border-slate-300/55' },
    rebate:      { dark: 'from-white/[0.06] to-transparent border-white/[0.10]', light: 'from-slate-100 to-transparent border-slate-200/50' },
  };
  return gradTokens[semantic][isDarkMode ? 'dark' : 'light'];
};
