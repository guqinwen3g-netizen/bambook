import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RDL global container contract', () => {
  const primitiveSource = readFileSync(resolve(__dirname, './ui/RDLPrimitives.tsx'), 'utf8');
  const osVNextCss = readFileSync(resolve(__dirname, '../styles/os-vnext.css'), 'utf8');
  const flatExperimentalCss = readFileSync(resolve(__dirname, '../styles/flat-experimental.css'), 'utf8');
  const authorityDoc = readFileSync(resolve(__dirname, '../docs/design-system/rdl-component-authority.md'), 'utf8');
  const emailSource = readFileSync(resolve(__dirname, './EmailManager.tsx'), 'utf8');
  const financeSource = readFileSync(resolve(__dirname, './FinanceManager.tsx'), 'utf8');

  it('makes container radius, material, padding, and spacing shared tokens', () => {
    [
      '--bambook-rdl-radius-panel',
      '--bambook-rdl-radius-card',
      '--bambook-rdl-radius-inset',
      '--bambook-rdl-radius-floating',
      '--bambook-rdl-pad-compact',
      '--bambook-rdl-pad-regular',
      '--bambook-rdl-pad-loose',
      '--bambook-rdl-gap-regular',
    ].forEach(token => {
      expect(osVNextCss).toContain(token);
    });
  });

  it('keeps ordinary RDL surfaces flat with no rim, shadow, or gradient chrome', () => {
    const flatBlockStart = osVNextCss.indexOf('.rdl-surface,');
    expect(flatBlockStart).toBeGreaterThan(-1);
    const flatBlock = osVNextCss.slice(flatBlockStart, flatBlockStart + 420);

    expect(flatBlock).toContain('border: 0;');
    expect(flatBlock).toContain('box-shadow: none;');

    const surfaceSection = osVNextCss.slice(osVNextCss.indexOf('.rdl-surface {'), osVNextCss.indexOf('.rdl-toolbar {'));
    expect(surfaceSection).not.toMatch(/linear-gradient|radial-gradient|border:\s*1px|box-shadow:\s*(?!none)/);
  });

  it('exposes explicit surface padding variants instead of page-local padding recipes', () => {
    expect(primitiveSource).toContain("export type RdlSurfacePadding = 'none' | 'compact' | 'regular' | 'loose'");
    expect(primitiveSource).toContain("padding = 'none'");
    expect(primitiveSource).toContain('data-rdl-padding={padding}');
    expect(osVNextCss).toContain('.rdl-surface[data-rdl-padding="compact"]');
    expect(osVNextCss).toContain('.rdl-surface[data-rdl-padding="regular"]');
    expect(osVNextCss).toContain('.rdl-surface[data-rdl-padding="loose"]');
  });

  it('documents that normal containers cannot invent local chrome', () => {
    expect(authorityDoc).toContain('Container chrome is a shared primitive');
    expect(authorityDoc).toContain('Surface padding is explicit');
    expect(authorityDoc).toContain('Legacy container names are compatibility aliases only');
    expect(authorityDoc).toContain('`RdlSurface` / `.rdl-surface` tokens');
    expect(authorityDoc).toContain('should not invent new combinations');
  });

  it('bridges legacy container families to RDL tokens in the final-loaded shield layer', () => {
    expect(flatExperimentalCss).toContain('Final import-order bridge');
    [
      '.glass-panel',
      '.glass-card',
      '.os-vnext-panel',
      '.os-vnext-card',
      '.bambook-selected-surface',
      '.os-material-frame-panel',
      '.os-material-raised-card',
      '.os-material-inset-surface',
      '.os-material-floating-overlay',
    ].forEach(selector => {
      expect(flatExperimentalCss).toContain(selector);
    });
    [
      'border-radius: var(--bambook-rdl-radius-panel)',
      'border-radius: var(--bambook-rdl-radius-card)',
      'border-radius: var(--bambook-rdl-radius-inset)',
      'border-radius: var(--bambook-rdl-radius-floating)',
      'background-color: var(--bambook-rdl-panel-fill)',
      'background-color: var(--bambook-rdl-card-fill)',
      'background-color: var(--bambook-rdl-inset-fill)',
      'background-color: var(--bambook-rdl-floating-fill)',
      'box-shadow: none !important;',
      'background-image: none !important;',
    ].forEach(contract => {
      expect(flatExperimentalCss).toContain(contract);
    });
  });

  it('keeps the main cover geometry out of ordinary container chrome', () => {
    const coverGuardStart = flatExperimentalCss.indexOf('.bambook-os-root .app-main-cover.app-main-cover-flush');
    expect(coverGuardStart).toBeGreaterThan(-1);
    const coverGuard = flatExperimentalCss.slice(coverGuardStart, coverGuardStart + 520);

    expect(coverGuard).toContain('top: 0 !important;');
    expect(coverGuard).toContain('right: 0 !important;');
    expect(coverGuard).toContain('bottom: 0 !important;');
    expect(coverGuard).toContain('border-radius: var(--app-main-cover-radius) 0 0 var(--app-main-cover-radius) !important;');
    expect(coverGuard).toContain('background: transparent !important;');
    expect(coverGuard).toContain('backdrop-filter: none !important;');
  });

  it('keeps migrated RDL surfaces from reintroducing page-local padding recipes', () => {
    const rdlSurfaceWithLocalPadding = /<RdlSurface[^\n]*className="[^"]*\b(?:p-[1-9]|px-|py-)[^"]*"/;

    expect(emailSource).not.toMatch(rdlSurfaceWithLocalPadding);
    expect(financeSource).not.toMatch(rdlSurfaceWithLocalPadding);
    expect(emailSource).toContain('padding="compact"');
    expect(emailSource).toContain('padding="loose"');
    expect(financeSource).toContain('padding="regular"');
  });
});
