import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  OS_VNEXT,
  OS_VNEXT_ALLOWED_TOKEN_FILES,
  OS_VNEXT_PRIMITIVE_RECIPES,
} from './osVNext';
import {
  OSButton,
  OSCard,
  OSDialog,
  OSField,
  OSPanel,
  OSScrollFrame,
  OSTable,
  OSToolbar,
} from './OSPrimitives';

describe('Bambook OS vNext desktop contract', () => {
  it('declares one desktop-first source of truth for exact design values', () => {
    expect(OS_VNEXT.version).toBe('desktop-vnext-1');
    expect(OS_VNEXT.scope).toBe('desktop');
    expect(OS_VNEXT.cssVars['--os-vnext-radius-panel']).toBe('28px');
    expect(OS_VNEXT.cssVars['--os-vnext-control-height']).toBe('36px');
    expect(OS_VNEXT.cssVars['--os-vnext-motion-standard']).toBe('260ms');
    expect(OS_VNEXT.cssVars['--os-vnext-ease-standard']).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(OS_VNEXT.cssVars['--os-vnext-font-family']).toContain('Urbanist');
    expect(OS_VNEXT.roles).toEqual([
      'shell',
      'panel',
      'card',
      'toolbar',
      'state-control',
      'action-control',
      'field',
      'table',
      'dialog',
      'scroll-frame',
    ]);
  });

  it('keeps primitives tied to named recipes instead of page-local pixels', () => {
    expect(OS_VNEXT_ALLOWED_TOKEN_FILES).toContain('components/ui/osVNext.ts');
    expect(OS_VNEXT_ALLOWED_TOKEN_FILES).toContain('styles/os-vnext.css');
    expect(OS_VNEXT_PRIMITIVE_RECIPES.panel).toContain('os-vnext-panel');
    expect(OS_VNEXT_PRIMITIVE_RECIPES.button.action).toContain('os-vnext-button--action');
    expect(OS_VNEXT_PRIMITIVE_RECIPES.field).toContain('os-vnext-field');
    expect(OS_VNEXT_PRIMITIVE_RECIPES.table).toContain('os-vnext-table');
  });

  it('renders every promoted primitive with a stable os role marker', () => {
    const html = renderToStaticMarkup(
      <OSPanel>
        <OSToolbar>
          <OSButton>Action</OSButton>
          <OSButton variant="state" active>State</OSButton>
          <OSField aria-label="Search" defaultValue="Bambook" />
        </OSToolbar>
        <OSScrollFrame>
          <OSCard>Card</OSCard>
          <OSTable>
            <thead><tr><th>Name</th></tr></thead>
            <tbody><tr><td>Panda</td></tr></tbody>
          </OSTable>
        </OSScrollFrame>
        <OSDialog open title="Dialog">Body</OSDialog>
      </OSPanel>
    );

    expect(html).toContain('data-os-vnext-role="panel"');
    expect(html).toContain('data-os-vnext-role="toolbar"');
    expect(html).toContain('data-os-vnext-role="action-control"');
    expect(html).toContain('data-os-vnext-role="state-control"');
    expect(html).toContain('data-os-vnext-active="true"');
    expect(html).toContain('data-os-vnext-role="field"');
    expect(html).toContain('data-os-vnext-role="scroll-frame"');
    expect(html).toContain('data-os-vnext-role="card"');
    expect(html).toContain('data-os-vnext-role="table"');
    expect(html).toContain('data-os-vnext-role="dialog"');
  });

  it('defines exact CSS variables in the vNext stylesheet, not in pages', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/os-vnext.css'), 'utf8');

    expect(css).toContain('--os-vnext-surface-panel-light: rgba(240, 246, 255, 0.38);');
    expect(css).toContain('--os-vnext-surface-panel-dark: rgba(8, 16, 28, 0.30);');
    expect(css).toContain('.os-vnext-panel');
    expect(css).toContain('.os-vnext-button--state[data-os-vnext-active="true"]');
    expect(css).toContain('.os-vnext-button:hover');
    expect(css).toContain('0 10px 22px -14px rgba(15, 23, 42, 0.13)');
    expect(css).toContain('0 2px 8px -6px rgba(15, 23, 42, 0.08)');
    expect(css).toContain('.bambook-selected-surface--light');
    expect(css).toContain('border-color: transparent;');
    expect(css).toContain('--bambook-selected-light-border-color: transparent;');
    expect(css).toContain('border-color: var(--bambook-selected-light-border-color) !important;');
    expect(css).toContain('background: var(--bambook-selected-light-background) !important;');
    expect(css).toContain('box-shadow: var(--bambook-selected-light-shadow) !important;');
    expect(css).toContain('border-color: rgba(255, 255, 255, 0.10) !important;');
    expect(css).toContain('background: linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.105));');
    expect(css).toContain('background: var(--bambook-selected-light-background);');
    expect(css).toContain('--bambook-selected-light-depth-shadow: 0 4px 12px -7px rgba(15, 23, 42, 0.14);');
    expect(css).toContain('.bambook-state-switch-track--checked-light');
    expect(css).toContain('.bambook-state-switch-track--checked-dark');
    expect(css).not.toContain('--bambook-selected-light-inner-outline');
    expect(css).not.toContain('inset 0 0 0 1px rgba(125, 183, 255, 0.085)');
    expect(css).not.toContain('inset 0 0 0 1px rgba(100, 116, 139, 0.055)');
    expect(css).not.toContain('background: linear-gradient(135deg, rgba(74, 144, 226, 0.075), rgba(125, 183, 255, 0.040));');
    expect(css).not.toContain('inset 0 1px 0 rgba(125, 183, 255, 0.18)');
    expect(css).toContain('border: 1px solid rgba(150, 170, 192, 0.22);');
    expect(css).toContain('inset 0 0 0 1px rgba(255, 255, 255, 0.036)');
    expect(css).toContain('border-color: rgba(74, 144, 226, 0.25);');
    expect(css).toContain('.os-vnext-scroll-frame[data-os-vnext-edge-fade="true"]');
  });
});
