import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getScrollEdgeFadeState, getScrollEdgeFadeStateFromBounds } from './ScrollEdgeFades';

describe('getScrollEdgeFadeState', () => {
  it('hides both edge fades when content does not overflow', () => {
    expect(getScrollEdgeFadeState({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 })).toEqual({
      showTop: false,
      showBottom: false,
    });
  });

  it('shows only the bottom fade at the top of an overflowing surface', () => {
    expect(getScrollEdgeFadeState({ scrollTop: 0, clientHeight: 500, scrollHeight: 900 })).toEqual({
      showTop: false,
      showBottom: true,
    });
  });

  it('shows both fades while content is clipped above and below', () => {
    expect(getScrollEdgeFadeState({ scrollTop: 120, clientHeight: 500, scrollHeight: 900 })).toEqual({
      showTop: true,
      showBottom: true,
    });
  });

  it('shows only the top fade at the bottom of an overflowing surface', () => {
    expect(getScrollEdgeFadeState({ scrollTop: 400, clientHeight: 500, scrollHeight: 900 })).toEqual({
      showTop: true,
      showBottom: false,
    });
  });

  it('hides the bottom fade once real content is visible above the bottom safe space', () => {
    expect(
      getScrollEdgeFadeState(
        { scrollTop: 260, clientHeight: 500, scrollHeight: 900 },
        { bottomContentInset: 144 },
      ),
    ).toEqual({
      showTop: true,
      showBottom: false,
    });
  });

  it('always hides the bottom fade at the physical scroll bottom', () => {
    expect(
      getScrollEdgeFadeState(
        { scrollTop: 400, clientHeight: 500, scrollHeight: 900 },
        { bottomContentInset: 0 },
      ),
    ).toEqual({
      showTop: true,
      showBottom: false,
    });
  });

  it('shows the top fade once real content enters the title safe space', () => {
    expect(
      getScrollEdgeFadeState(
        { scrollTop: 80, clientHeight: 500, scrollHeight: 900 },
        { topContentInset: 112 },
      ),
    ).toEqual({
      showTop: true,
      showBottom: true,
    });
  });
});

describe('getScrollEdgeFadeStateFromBounds', () => {
  it('hides the bottom fade when the last real content block is fully visible', () => {
    expect(
      getScrollEdgeFadeStateFromBounds({
        viewportTop: 0,
        viewportBottom: 500,
        firstContentTop: -200,
        lastContentBottom: 420,
      }),
    ).toEqual({
      showTop: true,
      showBottom: false,
    });
  });

  it('shows the bottom fade only while the last real content block is clipped by the viewport', () => {
    expect(
      getScrollEdgeFadeStateFromBounds({
        viewportTop: 0,
        viewportBottom: 500,
        firstContentTop: -200,
        lastContentBottom: 540,
      }),
    ).toEqual({
      showTop: true,
      showBottom: true,
    });
  });

  it('treats bottom safe spacing as visible room instead of clipped content', () => {
    expect(
      getScrollEdgeFadeStateFromBounds({
        viewportTop: 0,
        viewportBottom: 500,
        firstContentTop: -240,
        lastContentBottom: 620,
        bottomBoundary: 644,
      }),
    ).toEqual({
      showTop: true,
      showBottom: false,
    });
  });
});

describe('ScrollEdgeFades sentinel synchronization', () => {
  it('can use a bottom sentinel to hide the mask when real content reaches the viewport', () => {
    const source = readFileSync(new URL('./ScrollEdgeFades.tsx', import.meta.url), 'utf8');

    expect(source).toContain("querySelector<HTMLElement>('[data-scroll-edge-bottom-sentinel]')");
    expect(source).toContain('sentinelRect.top > viewportRect.bottom - EDGE_EPSILON');
  });

  it('supports offsetting the top mask below sticky form chrome', () => {
    const source = readFileSync(new URL('./ScrollEdgeFades.tsx', import.meta.url), 'utf8');

    expect(source).toContain('topOffset?: number');
    expect(source).toContain('topFadeStartOffset?: number');
    expect(source).toContain('const topSafeHeight = Math.max(0, topOffset)');
    expect(source).toContain('const topFadeStart = topSafeHeight + Math.max(0, topFadeStartOffset)');
    expect(source).toContain('const topEnd = topFadeStart + topHeight');
    expect(source).toContain('const mask = buildContentMask(');
    expect(source).toContain('topHeight / appScale');
    expect(source).toContain('topOffset / appScale');
  });

  it('drives only the content mask and renders no overlay layer', () => {
    const source = readFileSync(new URL('./ScrollEdgeFades.tsx', import.meta.url), 'utf8');

    expect(source).toContain("renderMode?: 'content-mask'");
    expect(source).toContain('element.style.maskImage = mask');
    expect(source).toContain('element.style.webkitMaskImage = mask');
    expect(source).toContain("if (renderMode !== 'content-mask') return");
    expect(source).not.toContain('const isChromiumRenderer = () =>');
    expect(source).not.toContain("document.documentElement.classList.contains('is-electron')");
    expect(source).not.toContain('if (isChromiumRenderer()) return');
    expect(source).not.toContain('ProgressiveBlurMask');
    expect(source).not.toContain("renderMode?: 'overlay'");
  });

  it('can disable the bottom edge while keeping top masking active', () => {
    const source = readFileSync(new URL('./ScrollEdgeFades.tsx', import.meta.url), 'utf8');

    expect(source).toContain('disableBottom?: boolean');
    expect(source).toContain('disableTop?: boolean');
    expect(source).toContain('showTop: disableTop ? false : state.showTop');
    expect(source).toContain('showBottom: false');
  });

  it('does not let sentinel logic override the physical bottom rule', () => {
    const source = readFileSync(new URL('./ScrollEdgeFades.tsx', import.meta.url), 'utf8');
    const physicalBottomCheck = source.indexOf('if (isAtScrollBottom(element))');
    const sentinelCheck = source.indexOf("querySelector<HTMLElement>('[data-scroll-edge-bottom-sentinel]')");

    expect(physicalBottomCheck).toBeGreaterThan(-1);
    expect(sentinelCheck).toBeGreaterThan(physicalBottomCheck);
  });
});

describe('useGlassSurfaceEdgeMasks', () => {
  it('masks only real glass surfaces so non-material shadow casters cannot create rims', () => {
    const source = readFileSync(new URL('./useGlassSurfaceEdgeMasks.ts', import.meta.url), 'utf8');

    expect(source).toContain("'[data-glass-edge-mask]'");
    expect(source).toContain('const MASKABLE_SURFACE_SELECTOR = GLASS_SURFACE_SELECTOR');
    expect(source).not.toContain("const SHADOW_CASTER_SELECTOR = '[data-glass-edge-mask-shadow-caster]'");
    expect(source).toContain("scopeSelector = '.ui-lab-real-os-root'");
    expect(source).toContain('if (scopeSelector && !scroller.closest(scopeSelector)) return');
    expect(source).toContain("type EdgeFadeActivation = 'zone' | 'clip'");
    expect(source).toContain("topFadeActivation = 'clip'");
    expect(source).toContain("bottomFadeActivation = 'clip'");
    expect(source).toContain("topFadeActivation === 'clip' ? topZoneStart : topZoneEnd");
    expect(source).toContain("bottomFadeActivation === 'clip' ? bottomZoneEnd : bottomZoneStart");
    expect(source).toContain("topFadeActivation === 'clip'");
    expect(source).toContain("bottomFadeActivation === 'clip'");
    expect(source).not.toContain('topFadeStart + topFadeDistance');
    expect(source).not.toContain('bottomFadeEnd - bottomFadeDistance');
    expect(source).not.toContain('resolveSurfaceBottomHeight(surface, bottomHeight, shadowCasterBottomHeight)');
    expect(source).not.toContain("'.bambook-panel-glass'");
    expect(source).not.toContain("'.bambook-dashboard-glass-color'");
    expect(source).toContain('scroller.querySelectorAll<HTMLElement>(surfaceSelector)');
    expect(source).toContain('surface.style.maskImage = mask');
    expect(source).toContain('surface.style.webkitMaskImage = mask');
    expect(source).not.toContain('const isChromiumRenderer = () =>');
    expect(source).not.toContain("document.documentElement.classList.contains('is-electron')");
    expect(source).toContain('if (!enabled || !scroller) return');
    expect(source).not.toContain('surface.style.opacity = String(opacity)');
    expect(source).not.toContain('scroller.style.maskImage = mask');
    expect(source).toContain("mutationObserver?.observe(scroller, { childList: true, subtree: true })");
    expect(source).not.toContain('attributes: true');
  });
});
