import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RDL visual baseline for sample pages', () => {
  const financeSource = readFileSync(resolve(__dirname, './FinanceManager.tsx'), 'utf8');
  const dashboardSource = readFileSync(resolve(__dirname, './Dashboard.tsx'), 'utf8');
  const primitiveSource = readFileSync(resolve(__dirname, './ui/RDLPrimitives.tsx'), 'utf8');
  const tokenSource = readFileSync(resolve(__dirname, './ui/bambookOsTokens.ts'), 'utf8');

  it('keeps Finance on shared design-system primitives instead of page-local material recipes', () => {
    const primitiveExports = [
      'RdlSurface',
      'RdlPill',
      'RdlSearch',
      'RdlToolbar',
      'RdlDataRow',
      'RdlMetricCard',
      'RdlOverlayIconButton',
    ];
    primitiveExports.forEach(name => {
      expect(primitiveSource).toContain(`function ${name}`);
    });

    // FinanceManager 已从 RDL 原语迁移到 BDS 组件族（BDS v2.1）；
    // 契约不变：只允许共享设计系统组件，禁止页面局部材质配方。
    expect(financeSource).not.toMatch(/\bRdl(Surface|Pill|Search|Toolbar|MetricCard|OverlayIconButton|DataRow)\b/);
    [
      'bds-card',
      'bds-btn',
      'bds-input',
      'bds-segment',
      'bds-badge',
      'bds-alert',
    ].forEach(name => {
      expect(financeSource).toContain(name);
    });
  });

  it('keeps Finance neutral: no semantic color families, no raised shadows, no default medium/bold typography', () => {
    [
      'emerald',
      'rose-',
      'red-',
      'amber-',
      'sky-',
      'green-',
      'shadow-xl',
      'shadow-lg',
      'shadow-2xl',
      'font-medium',
      'font-semibold',
      'font-bold',
      'border-l',
    ].forEach(token => {
      expect(financeSource).not.toContain(token);
    });
  });

  it('keeps Finance status and filter states driven by neutral material opacity', () => {
    // BDS v2.1：状态徽章统一 bds-badge neutral 变体，非活跃态以 opacity-60 表达，
    // 延续「Finance 不用语义色族」的中性纪律（机制从 white-opacity 配方升级为共享组件）。
    expect(financeSource).toContain('const FINANCE_STATUS_BADGE');
    expect(financeSource).toContain('const FINANCE_STATUS_BADGE_INACTIVE');
    expect(financeSource).toContain('bds-badge sm neutral');
    expect(financeSource).toContain('opacity-60');
  });

  it('keeps Dashboard ordinary labels light or normal while preserving the single accent for instrument states', () => {
    [
      'font-bold',
      'font-medium',
      'font-semibold',
    ].forEach(token => {
      expect(dashboardSource).not.toContain(token);
    });

    expect(dashboardSource).toContain('const dashboardCardLabelClass =');
    expect(dashboardSource).toContain('text-os-adaptive-brand');
    expect(dashboardSource).toContain('--os-vnext-brand-blue');
  });

  it('keeps shared OS status tokens neutral instead of reintroducing rainbow semantics', () => {
    [
      'bg-green-',
      'text-green-',
      'bg-amber-',
      'text-amber-',
      'bg-purple-',
      'text-purple-',
      'hover:text-red-',
      'hover:bg-red-',
    ].forEach(token => {
      expect(tokenSource).not.toContain(token);
    });

    expect(tokenSource).toContain("savedDark: 'bg-white/[0.045] text-white/58");
    expect(tokenSource).toContain("fallbackLight: 'bg-white/30 text-slate-400");
    expect(tokenSource).toContain("inlineDangerDark: 'backdrop-blur-[15px] backdrop-saturate-[104%] text-white/46 hover:text-white/66 hover:bg-white/[0.055]'");
  });
});
