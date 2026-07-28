import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGlassSurfaceMask } from './useGlassSurfaceEdgeMasks';

const rect = (top: number, bottom: number) => ({
  top,
  bottom,
  height: bottom - top,
} as DOMRect);

describe('buildGlassSurfaceMask', () => {
  it('uses the fixed bottom fade zone once a row enters the bottom boundary', () => {
    const mask = buildGlassSurfaceMask(
      rect(0, 60),
      rect(0, 100),
      { showTop: false, showBottom: true },
      56,
      72,
      'clip',
      'zone',
      0,
    );

    expect(mask).toBe('linear-gradient(to bottom, black 0px, black 28px, transparent 60px, transparent 100%)');
  });

  it('mirrors the top fade at the bottom edge and keeps transparency extended', () => {
    const mask = buildGlassSurfaceMask(
      rect(40, 112),
      rect(0, 100),
      { showTop: false, showBottom: true },
      57,
      57,
      'clip',
      'zone',
      58,
      0,
    );

    expect(mask).toBe('linear-gradient(to bottom, black 0px, black 3px, transparent 60px, transparent 100%)');
  });

  it('can finish the bottom fade above the physical viewport edge', () => {
    const mask = buildGlassSurfaceMask(
      rect(40, 112),
      rect(0, 126),
      { showTop: false, showBottom: true },
      57,
      57,
      'clip',
      'zone',
      58,
      26,
    );

    expect(mask).toBe('linear-gradient(to bottom, black 0px, black 3px, transparent 60px, transparent 100%)');
  });

  it('does not render a fully opaque top rim for surfaces entering the bottom fade zone', () => {
    const mask = buildGlassSurfaceMask(
      rect(82, 142),
      rect(0, 126),
      { showTop: false, showBottom: true },
      57,
      57,
      'clip',
      'zone',
      58,
      26,
    );

    expect(mask).toBe('linear-gradient(to bottom, black -39px, transparent 18px, transparent 100%)');
  });

  it('keeps the top fade zone fixed instead of expanding with scroll distance', () => {
    const nearTopMask = buildGlassSurfaceMask(
      rect(-12, 48),
      rect(0, 100),
      { showTop: true, showBottom: false },
      24,
      72,
      'clip',
      'zone',
      0,
    );
    const fartherTopMask = buildGlassSurfaceMask(
      rect(-36, 24),
      rect(0, 100),
      { showTop: true, showBottom: false },
      24,
      72,
      'clip',
      'zone',
      0,
    );

    expect(nearTopMask).toBe('linear-gradient(to bottom, transparent 0px, transparent 12px, black 36px, black 100%)');
    expect(fartherTopMask).toBe('linear-gradient(to bottom, transparent 0px, transparent 36px, black 60px, black 100%)');
  });

  it('keeps bottom clip activation inactive until the surface crosses the viewport edge', () => {
    const mask = buildGlassSurfaceMask(
      rect(0, 60),
      rect(0, 100),
      { showTop: false, showBottom: true },
      56,
      72,
      'clip',
      'clip',
      0,
    );

    expect(mask).toBe('');
  });

  it('selects only real glass surfaces by default', () => {
    const source = readFileSync(new URL('./useGlassSurfaceEdgeMasks.ts', import.meta.url), 'utf8');

    expect(source).toContain('const MASKABLE_SURFACE_SELECTOR = GLASS_SURFACE_SELECTOR;');
    expect(source).not.toContain('const SHADOW_CASTER_SELECTOR');
    expect(source).toContain('surfaceSelector = MASKABLE_SURFACE_SELECTOR');
  });

  it('uses each real glass surface geometry directly', () => {
    const source = readFileSync(new URL('./useGlassSurfaceEdgeMasks.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('const resolveMaskSourceSurface = (surface: HTMLElement) =>');
    expect(source).not.toContain('SHADOW_CASTER_SELECTOR');
    expect(source).toContain('const surfaceRect = scaleRect(surface.getBoundingClientRect(), appScale);');
  });

  it('does not accept alternate visible boundaries for fullscreen form stacks', () => {
    const source = readFileSync(new URL('./useGlassSurfaceEdgeMasks.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('boundaryRef');
    expect(source).toContain('const scrollerRect = scroller.getBoundingClientRect();');
    expect(source).toContain('const viewportRect = scaleRect(scrollerRect, appScale);');
  });

  it('updates masks synchronously on scroll so zoomed surfaces do not drift for one frame', () => {
    const source = readFileSync(new URL('./useGlassSurfaceEdgeMasks.ts', import.meta.url), 'utf8');

    expect(source).toContain('syncWheelScroll?: boolean');
    expect(source).toContain('syncWheelScroll = false');
    expect(source).toContain('const handleWheel = (event: WheelEvent) =>');
    expect(source).toContain('event.preventDefault();');
    expect(source).toContain('scroller.scrollTop = nextScrollTop;');
    expect(source).toContain('const updateOnScroll = () =>');
    expect(source).toContain('window.cancelAnimationFrame(frame)');
    expect(source).toContain('updateSurfaceMasks();');
    expect(source).toContain("scroller.addEventListener('wheel', handleWheel, { passive: false })");
    expect(source).toContain("scroller.removeEventListener('wheel', handleWheel)");
    expect(source).toContain("scroller.addEventListener('scroll', updateOnScroll");
    expect(source).toContain("scroller.removeEventListener('scroll', updateOnScroll)");
  });
});
