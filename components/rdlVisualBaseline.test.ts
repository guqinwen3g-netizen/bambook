import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RDL visual baseline for sample pages', () => {
  const financeSource = readFileSync(resolve(__dirname, './FinanceManager.tsx'), 'utf8');
  const dashboardSource = readFileSync(resolve(__dirname, './Dashboard.tsx'), 'utf8');
  const primitiveSource = readFileSync(resolve(__dirname, './ui/RDLPrimitives.tsx'), 'utf8');
  const tokenSource = readFileSync(resolve(__dirname, './ui/bambookOsTokens.ts'), 'utf8');

  it('keeps Finance on shared RDL primitives instead of page-local material recipes', () => {
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

    [
      'RdlSurface',
      'RdlPill',
      'RdlSearch',
      'RdlToolbar',
      'RdlMetricCard',
      'RdlOverlayIconButton',
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
    expect(financeSource).toContain('const financeStatusTone');
    expect(financeSource).toContain('const financeInactiveStatusTone');
    expect(financeSource).toContain('const invoiceStatusTone');
    expect(financeSource).toContain('const voucherStatusTone');
    expect(financeSource).toContain('bg-white/[0.055]');
    expect(financeSource).toContain('bg-white/[0.035]');
    expect(financeSource).toContain('bg-white/50');
    expect(financeSource).toContain('bg-white/34');
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
