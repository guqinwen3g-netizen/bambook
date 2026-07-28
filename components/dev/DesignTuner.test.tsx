import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESIGN_TUNER_EXPORT_PREFIX,
  DESIGN_TUNER_POSITION_KEY,
  DESIGN_TUNER_TOGGLE_HINT,
  SIDEBAR_BUTTON_TUNER_CONTROLS,
  createDesignTunerExportText,
  createDefaultDesignTunerValues,
} from './DesignTuner';

const source = readFileSync(new URL('./DesignTuner.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../../electron/preload.ts', import.meta.url), 'utf8');

describe('DesignTuner dev overlay', () => {
  it('registers sidebar button state controls as CSS variables', () => {
    expect(DESIGN_TUNER_POSITION_KEY).toBe('bambook_design_tuner_position_v1');
    expect(DESIGN_TUNER_EXPORT_PREFIX).toBe('BAMBOOK_DESIGN_TUNER_SIDEBAR_BUTTONS_V1=');
    expect(SIDEBAR_BUTTON_TUNER_CONTROLS).toHaveLength(13);
    expect(SIDEBAR_BUTTON_TUNER_CONTROLS.map((control) => control.variable)).toContain('--bambook-sidebar-hover-light-a1');
    expect(SIDEBAR_BUTTON_TUNER_CONTROLS.map((control) => control.variable)).toContain('--bambook-sidebar-active-dark-a2');
    expect(SIDEBAR_BUTTON_TUNER_CONTROLS.map((control) => control.variable)).toContain('--bambook-sidebar-press-scale');
    expect(DESIGN_TUNER_TOGGLE_HINT).toBe('⌘/Ctrl Shift T');
    expect(createDefaultDesignTunerValues()).toMatchObject({
      lightHoverA1: 0.26,
      lightHoverA2: 0.26,
      lightPressA1: 0.44,
      lightPressA2: 0.44,
      lightActiveA1: 0.54,
      lightActiveA2: 0.58,
      darkHoverA1: 0.08,
      darkHoverA2: 0.08,
      darkPressA1: 0.43,
      darkPressA2: 0.43,
      darkActiveA1: 0.58,
      darkActiveA2: 0.54,
      pressScale: 0.995,
    });
  });

  it('is freely movable, position-persisted, collapsible, and export based', () => {
    expect(source).toContain('bambook-blue-white-light');
    expect(source).toContain('bambook-dashboard-glass-color');
    expect(source).not.toContain('glass-panel bambook-blue-white-surface');
    expect(source).not.toContain('glass-panel bambook-blue-white-light');
    expect(source).toContain('onPointerDown={handleDragStart}');
    expect(source).toContain("window.addEventListener('pointermove'");
    expect(source).toContain('setPointerCapture');
    expect(source).toContain('persistPosition(next)');
    expect(source).toContain('setIsCollapsed');
    expect(source).toContain('createDesignTunerExportText(values)');
    expect(source).toContain('copyTextToClipboard');
    expect(source).toContain('Export');
    expect(source).toContain('DESIGN_TUNER_TOGGLE_HINT');
    expect(source).not.toContain('savePreset');
    expect(source).not.toContain('loadPreset');
  });

  it('can be toggled with a dev-only keyboard shortcut outside editable fields', () => {
    expect(appSource).toContain("export const DESIGN_TUNER_TOGGLE_SHORTCUT = 'mod+shift+t'");
    expect(appSource).toContain('const [showDesignTuner, setShowDesignTuner] = useState(false)');
    expect(appSource).toContain("window.addEventListener('keydown', handleDesignTunerShortcut)");
    expect(appSource).toContain("event.key.toLowerCase() !== 't'");
    expect(appSource).toContain('!event.metaKey && !event.ctrlKey');
    expect(appSource).toContain('isEditableShortcutTarget(event.target)');
    expect(appSource).toContain('setShowDesignTuner((current) => !current)');
    expect(appSource).toContain('showDesignTuner && <DesignTuner');
  });

  it('exports a compact text payload the user can paste back into chat', () => {
    const text = createDesignTunerExportText({ lightHoverA1: 0.58, darkActiveA2: 0.44 });

    expect(text).toContain(DESIGN_TUNER_EXPORT_PREFIX);
    expect(text).toContain('"target":"sidebar-button-states"');
    expect(text).toContain('"lightHoverA1":0.58');
    expect(text).toContain('"darkActiveA2":0.44');
    expect(preloadSource).not.toContain('bambookDesignTuner');
    expect(mainSource).not.toContain('design-tuner:save-preset');
    expect(mainSource).not.toContain('design-tuner:load-preset');
  });
});
