import { describe, expect, it } from 'vitest';

import { resolveInitialDarkMode } from './appTheme';

describe('app theme persistence', () => {
  it('uses the saved appearance mode before legacy theme_preference or system color scheme', () => {
    expect(resolveInitialDarkMode('dark', 'light', false)).toBe(true);
    expect(resolveInitialDarkMode('light', 'dark', true)).toBe(false);
  });

  it('only follows the system color scheme when appearance mode is system', () => {
    expect(resolveInitialDarkMode('system', 'dark', false)).toBe(false);
    expect(resolveInitialDarkMode('system', null, true)).toBe(true);
  });

  it('keeps legacy theme_preference as a fallback for older stored configs', () => {
    expect(resolveInitialDarkMode(undefined, 'dark', false)).toBe(true);
    expect(resolveInitialDarkMode(undefined, 'light', true)).toBe(false);
  });
});
