import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RDL shared primitives', () => {
  const primitiveSource = readFileSync(resolve(__dirname, './RDLPrimitives.tsx'), 'utf8');
  const osVNextCss = readFileSync(resolve(__dirname, '../../styles/os-vnext.css'), 'utf8');
  const authorityDoc = readFileSync(resolve(__dirname, '../../docs/design-system/rdl-component-authority.md'), 'utf8');

  it('exports the shared Bambook RDL component dialect before page migration', () => {
    [
      'RdlSurface',
      'RdlPill',
      'RdlSearch',
      'RdlToolbar',
      'RdlDataRow',
      'RdlMetricCard',
      'RdlOverlayIconButton',
    ].forEach(name => {
      expect(primitiveSource).toContain(`function ${name}`);
      expect(authorityDoc).toContain(`\`${name}\``);
    });

    expect(primitiveSource).toContain('data-rdl-component="surface"');
    expect(primitiveSource).toContain('data-rdl-component="pill"');
    expect(primitiveSource).toContain('data-rdl-component="search"');
    expect(primitiveSource).toContain('data-rdl-component="data-row"');
  });

  it('keeps RDL primitives flat: no rim, no shadow, no transparent text', () => {
    expect(osVNextCss).toContain('.rdl-surface,');
    expect(osVNextCss).toContain('.rdl-overlay-icon-button {');
    expect(osVNextCss).toContain('border: 0;');
    expect(osVNextCss).toContain('box-shadow: none;');
    expect(osVNextCss).toContain('color: var(--bambook-rdl-primary-text');
    expect(osVNextCss).not.toContain('.rdl-search__input {\n  opacity:');
  });

  it('keeps primitive danger states neutral instead of reintroducing semantic red', () => {
    const dangerStart = osVNextCss.indexOf('.rdl-pill[data-rdl-tone="danger"]');
    expect(dangerStart).toBeGreaterThan(-1);
    const dangerBlock = osVNextCss.slice(dangerStart, dangerStart + 180);

    expect(dangerBlock).toContain('--bambook-rdl-command-soft-rgb');
    expect(dangerBlock).not.toContain('190 44 60');
    expect(dangerBlock).not.toMatch(/red|rose|amber|emerald|green|sky/i);
  });

  it('maps official RDL evidence into Bambook product-scale components', () => {
    expect(authorityDoc).toContain('cases__search');
    expect(authorityDoc).toContain('cases-sort__button');
    expect(authorityDoc).toContain('next-steps-slider__next/prev');
    expect(osVNextCss).toContain('border-radius: 999px;');
    expect(osVNextCss).toContain('backdrop-filter: var(--bambook-rdl-floating-filter');
    expect(osVNextCss).toContain('backdrop-filter: blur(15px) saturate(104%);');
  });
});
