// RDL agent-response 共享中性 tone helper
// 统一 risk/status/tone 中性化表达，禁止散落 risk/status map

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | string;
export type LifecycleStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped' | 'cancelled' | string;
export type MetricTone = 'neutral' | 'positive' | 'negative' | 'warning' | string;

// 3 档中性 opacity 层级（按 RDL status token contract）
export const agentNeutralTone = (isDarkMode?: boolean, level: 'inactive' | 'normal' | 'active' = 'normal'): string => {
  if (isDarkMode) {
    const opacity = level === 'inactive' ? { bg: 'bg-white/[0.02]', text: 'text-white/40', border: 'border-white/[0.06]' }
      : level === 'active' ? { bg: 'bg-white/[0.06]', text: 'text-white/70', border: 'border-white/[0.08]' }
      : { bg: 'bg-white/[0.04]', text: 'text-white/55', border: 'border-white/[0.08]' };
    return `${opacity.bg} ${opacity.text} ${opacity.border}`;
  }
  const opacity = level === 'inactive' ? { bg: 'bg-slate-50/30', text: 'text-slate-400', border: 'border-slate-200/30' }
    : level === 'active' ? { bg: 'bg-slate-100/60', text: 'text-slate-600', border: 'border-slate-300/40' }
    : { bg: 'bg-slate-50/50', text: 'text-slate-500', border: 'border-slate-200/40' };
  return `${opacity.bg} ${opacity.text} ${opacity.border}`;
};

// risk 中性化（low=inactive, medium/normal, high/critical=active 强调用 opacity）
export const riskToneClass = (risk: RiskLevel, isDarkMode?: boolean): string => {
  const level = risk === 'high' || risk === 'critical' ? 'active' : risk === 'medium' ? 'normal' : 'inactive';
  const t = agentNeutralTone(isDarkMode, level);
  // 只返回 text 类（用于 icon className）
  return isDarkMode
    ? level === 'active' ? 'text-white/70' : level === 'normal' ? 'text-white/55' : 'text-white/40'
    : level === 'active' ? 'text-slate-600' : level === 'normal' ? 'text-slate-500' : 'text-slate-400';
};

// risk pill 中性化（用于 badge）
export const riskPillClass = (risk: RiskLevel, isDarkMode?: boolean): string => {
  const level = risk === 'high' || risk === 'critical' ? 'active' : risk === 'medium' ? 'normal' : 'inactive';
  return isDarkMode
    ? level === 'active'
      ? 'border-white/[0.08] bg-white/[0.06] text-white/70'
      : level === 'normal'
      ? 'border-white/[0.08] bg-white/[0.04] text-white/55'
      : 'border-white/[0.06] bg-white/[0.02] text-white/40'
    : level === 'active'
    ? 'border-slate-300/40 bg-slate-100/60 text-slate-600'
    : level === 'normal'
    ? 'border-slate-200/40 bg-slate-50/50 text-slate-500'
    : 'border-slate-200/30 bg-slate-50/30 text-slate-400';
};

// status icon/text 中性化
export const statusToneText = (isDarkMode?: boolean): string =>
  isDarkMode ? 'text-white/70' : 'text-slate-600';

// metric tone 中性化
export const metricToneClass = (tone: MetricTone, isDarkMode?: boolean): string => {
  // 全中性，tone 差异靠 opacity
  const level = tone === 'positive' ? 'active' : tone === 'negative' ? 'inactive' : 'normal';
  return isDarkMode
    ? level === 'active' ? 'text-white/70' : level === 'inactive' ? 'text-white/40' : 'text-white/55'
    : level === 'active' ? 'text-slate-600' : level === 'inactive' ? 'text-slate-400' : 'text-slate-500';
};


// status icon/text 中性化（按 RDL status contract，状态不用 accent）
export type LifecycleStatusValue = 'idle' | 'running' | 'success' | 'succeeded' | 'failed' | 'skipped' | 'cancelled' | 'blocked' | 'planned' | 'parameterized' | 'permission_checked' | string;

// status icon 颜色（中性 opacity，不用 accent）
export const statusIconClass = (status: LifecycleStatusValue, isDarkMode?: boolean): string => {
  // 所有状态统一中性，不区分色彩
  return isDarkMode ? 'text-white/70' : 'text-slate-600';
};

// status text 颜色（中性）
export const statusTextClass = (isDarkMode?: boolean): string =>
  isDarkMode ? 'text-white/55' : 'text-slate-500';

// running 状态中性（不用 accent，改用 opacity 区分）
export const runningStatusClass = (isDarkMode?: boolean): string =>
  isDarkMode ? 'text-white/70' : 'text-slate-600';

// pulse 动画中性（不用 accent 色）
export const pulseClass = (isDarkMode?: boolean): string =>
  isDarkMode ? 'text-white/70' : 'text-slate-600';
