import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SPOTLIGHT_CARD_ENTRY_INSET,
  SPOTLIGHT_CARD_EXIT_OUTSET,
  SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER,
  SPOTLIGHT_CARD_LIQUID_CAP_STRETCH,
  SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_COMPRESSION,
  SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_EXPANSION,
  SPOTLIGHT_CARD_LIQUID_MOTION_BLEND,
  SPOTLIGHT_CARD_LIQUID_MOTION_DECAY,
  SPOTLIGHT_CARD_LIQUID_MOTION_MAIN_STRETCH,
  SPOTLIGHT_CARD_LIQUID_MOTION_SPEED_DIVISOR,
  SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_FLOOR,
  SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_RANGE,
  SPOTLIGHT_CARD_LIQUID_PRESSURE_MIN_DISTANCE,
  SPOTLIGHT_CARD_LIQUID_PRESSURE_SIZE_RATIO,
  SPOTLIGHT_CARD_LIGHT_SCOPE,
  SPOTLIGHT_CARD_BORDER_LIGHT_BLEED_PX,
  SPOTLIGHT_CARD_LIQUID_TRAIL_ALPHA_SCALE,
  SPOTLIGHT_CARD_LIQUID_TRAIL_OFFSET_RATIO,
  SPOTLIGHT_CARD_LIQUID_TRAIL_STRETCH,
  SPOTLIGHT_CARD_LIQUID_SIDE_STRETCH,
  resolveSpotlightGeometry,
  scaleRgbaAlpha,
} from './SpotlightCard';

describe('SpotlightCard pointer interaction boundaries', () => {
  it('uses strict entry and wide exit tracking for cursor light', () => {
    const source = readFileSync(new URL('./SpotlightCard.tsx', import.meta.url), 'utf8');

    expect(SPOTLIGHT_CARD_ENTRY_INSET).toEqual({ x: 6, y: 6 });
    expect(SPOTLIGHT_CARD_EXIT_OUTSET).toEqual({ x: 14, y: 12 });
    expect(SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER).toBe(1);
    expect(source).toContain('const isInsideEntryZone');
    expect(source).toContain('rect.left + SPOTLIGHT_CARD_ENTRY_INSET.x');
    expect(source).toContain('rect.right - SPOTLIGHT_CARD_ENTRY_INSET.x');
    expect(source).toContain('const isInsideExitZone');
    expect(source).toContain('rect.left - SPOTLIGHT_CARD_EXIT_OUTSET.x');
    expect(source).toContain('rect.right + SPOTLIGHT_CARD_EXIT_OUTSET.x');
    expect(source).toContain('const isPastViewportExitBoundary');
    expect(source).toContain('clientX <= SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER');
    expect(source).toContain('clientY >= window.innerHeight - SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER');
    expect(source).toContain('const releasePointer');
    expect(source).toContain('lastPointerViewportPosition');
    expect(source).toContain('const syncWithLastPointer');
    expect(source).toContain('document.elementFromPoint');
    expect(source).toContain("window.addEventListener('scroll', scheduleSpotlightScrollSync, { capture: true, passive: true })");
    expect(source).toContain("window.removeEventListener('scroll', scheduleSpotlightScrollSync, { capture: true })");
    expect(source).toContain("window.addEventListener('pointermove', handleWindowPointerMove, { passive: true })");
    expect(source).toContain("window.removeEventListener('pointermove', handleWindowPointerMove)");
    expect(source).toContain("window.addEventListener('pointerout', handleWindowPointerOut)");
    expect(source).toContain("window.addEventListener('blur', handleWindowBlur)");
    expect(source).not.toContain('onMouseEnter');
    expect(source).not.toContain('onMouseLeave');
    expect(source).not.toContain('onMouseMove');
  });
});

describe('SpotlightCard container-calibrated light', () => {
  it('clips the tracking light with the host radius and covers the full border box', () => {
    const source = readFileSync(new URL('./SpotlightCard.tsx', import.meta.url), 'utf8');

    expect(SPOTLIGHT_CARD_LIGHT_SCOPE).toBe('border-box');
    expect(SPOTLIGHT_CARD_BORDER_LIGHT_BLEED_PX).toBe(1);
    expect(source).toContain("overflow: 'clip'");
    expect(source).toContain('overflowClipMargin: `${SPOTLIGHT_CARD_BORDER_LIGHT_BLEED_PX}px`');
    expect(source).toContain('className="pointer-events-none absolute -inset-px z-20 overflow-hidden rounded-[inherit]"');
    expect(source).toContain('data-spotlight-scope={SPOTLIGHT_CARD_LIGHT_SCOPE}');
    expect(source).toContain('className="absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300"');
    expect(source).toContain('backgroundClip: SPOTLIGHT_CARD_LIGHT_SCOPE');
    expect(source.indexOf('{children}')).toBeLessThan(source.indexOf('data-spotlight-scope={SPOTLIGHT_CARD_LIGHT_SCOPE}'));
    expect(source).not.toContain('data-spotlight-rim="true"');
    expect(source).not.toContain('className="absolute inset-px rounded-[inherit] opacity-0 transition-opacity duration-300"');
    expect(source).not.toContain('[clip-path:inset(0_round_1.5rem)]');
    expect(source).not.toContain('round_1.5rem');
  });

  it('scales a shared spotlight token down on compact cards and keeps larger panels broader', () => {
    const compact = resolveSpotlightGeometry(520, { width: 260, height: 155 });
    const sidebar = resolveSpotlightGeometry(520, { width: 288, height: 688 });

    expect(compact.size).toBe(237);
    expect(sidebar.size).toBe(429);
    expect(compact.size).toBeLessThan(260);
    expect(sidebar.size).toBeGreaterThan(compact.size);
    expect(sidebar.size).toBeLessThanOrEqual(520);
    expect(compact.intensity).toBe(1);
    expect(sidebar.intensity).toBe(1);
  });

  it('supports width-based form panels without collapsing frame panels to their narrow edge', () => {
    const shortFormPanel = resolveSpotlightGeometry(520, { width: 300, height: 180 }, 'width');
    const tallFormPanel = resolveSpotlightGeometry(520, { width: 300, height: 520 }, 'width');
    const sidebarFrame = resolveSpotlightGeometry(520, { width: 288, height: 688 }, 'frame');
    const sidebarWidthOnly = resolveSpotlightGeometry(520, { width: 288, height: 688 }, 'width');

    expect(shortFormPanel.size).toBe(405);
    expect(tallFormPanel.size).toBe(shortFormPanel.size);
    expect(sidebarFrame.size).toBe(429);
    expect(sidebarFrame.size).toBeGreaterThan(sidebarWidthOnly.size);
    expect(shortFormPanel.intensity).toBe(1);
    expect(tallFormPanel.intensity).toBe(1);
    expect(sidebarFrame.intensity).toBe(1);
  });

  it('uses a softened liquid pressure model for edge compression', () => {
    const source = readFileSync(new URL('./SpotlightCard.tsx', import.meta.url), 'utf8');

    expect(SPOTLIGHT_CARD_LIQUID_PRESSURE_MIN_DISTANCE).toBe(124);
    expect(SPOTLIGHT_CARD_LIQUID_PRESSURE_SIZE_RATIO).toBe(0.36);
    expect(SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_COMPRESSION).toBe(0.16);
    expect(SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_EXPANSION).toBe(0.2);
    expect(SPOTLIGHT_CARD_LIQUID_SIDE_STRETCH).toBe(0.82);
    expect(SPOTLIGHT_CARD_LIQUID_CAP_STRETCH).toBe(0.6);
    expect(SPOTLIGHT_CARD_LIQUID_MOTION_SPEED_DIVISOR).toBe(4);
    expect(SPOTLIGHT_CARD_LIQUID_MOTION_BLEND).toBe(0.28);
    expect(SPOTLIGHT_CARD_LIQUID_MOTION_DECAY).toBe(0.9);
    expect(SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_FLOOR).toBe(0.24);
    expect(SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_RANGE).toBe(0.44);
    expect(SPOTLIGHT_CARD_LIQUID_MOTION_MAIN_STRETCH).toBe(0.24);
    expect(SPOTLIGHT_CARD_LIQUID_TRAIL_OFFSET_RATIO).toBe(0.28);
    expect(SPOTLIGHT_CARD_LIQUID_TRAIL_ALPHA_SCALE).toBe(0.72);
    expect(SPOTLIGHT_CARD_LIQUID_TRAIL_STRETCH).toBe(0.62);
    expect(source).toContain('const smoothPressure');
    expect(source).toContain('const resolveLiquidMotion');
    expect(source).toContain('const resolveLiquidMotionStrength');
    expect(source).toContain('const decayLiquidMotion');
    expect(source).toContain('const liquidTrailOffset');
    expect(source).toContain('const liquidTrailColor');
    expect(source).toContain('SPOTLIGHT_CARD_LIQUID_MOTION_MAIN_STRETCH');
    expect(source).toContain('clamped * clamped * (3 - 2 * clamped)');
    expect(source).toContain('transparent 68%');
    expect(source).toContain('transparent 72%');
    expect(source).toContain('transparent 64%');
    expect(source).toContain('transparent 66%');
  });

  it('scales rgba alpha without changing the color channels', () => {
    expect(scaleRgbaAlpha('rgba(74, 144, 226, 0.16)', 0.75)).toBe('rgba(74, 144, 226, 0.12)');
    expect(scaleRgbaAlpha('rgb(74, 144, 226)', 0.75)).toBe('rgb(74, 144, 226)');
  });
});
