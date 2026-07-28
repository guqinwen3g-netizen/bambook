import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ProductionGlobe first paint', () => {
  it('renders the atmosphere outside async land texture suspense', () => {
    const source = readFileSync(new URL('./ProductionGlobe.tsx', import.meta.url), 'utf8');
    const sceneSource = source.slice(
      source.indexOf('const sceneContent = ('),
      source.indexOf('return (', source.indexOf('const sceneContent = (')),
    );

    expect(sceneSource).toContain('<Atmosphere radius={GLOBE_RADIUS}');
    expect(sceneSource).toContain('<React.Suspense fallback={null}>');
    expect(sceneSource).toContain('<LandmassClassic');
    expect(sceneSource.indexOf('<Atmosphere radius={GLOBE_RADIUS}')).toBeLessThan(
      sceneSource.indexOf('<React.Suspense fallback={null}>'),
    );
    expect(source).toContain('export function preloadProductionGlobeAssets()');
    expect(source).toContain('useLoader.preload(THREE.ImageBitmapLoader, ORIGINAL_LAND_MASK_URL');
    expect(source).toContain('loadCountryGeoOnce().catch(() => {})');
    expect(source).toContain("GLOBE_MAX_ORBIT_DISTANCE,");
    expect(source).toContain('maxDistance={GLOBE_MAX_ORBIT_DISTANCE}');
    expect(source).not.toContain('maxDistance={40}');
  });
});

describe('ProductionGlobe motion contract', () => {
  it('keeps intro, global camera and auto-rotate values centralized for alternate renderers', () => {
    const motionSource = readFileSync(new URL('./globeMotion.ts', import.meta.url), 'utf8');

    expect(motionSource).toContain('GLOBE_INTRO_GEO');
    expect(motionSource).toContain('lat: 31.23');
    expect(motionSource).toContain('lon: 121.47');
    expect(motionSource).toContain('orbitDistance: 9');
    expect(motionSource).toContain('GLOBE_GLOBAL_GEO');
    expect(motionSource).toContain('lat: 35');
    expect(motionSource).toContain('lon: 105');
    expect(motionSource).toContain('orbitDistance: 23');
    expect(motionSource).toContain('GLOBE_INTERACTION_RESUME_DELAY_MS = 1450');
    expect(motionSource).toContain('GLOBE_AUTO_ROTATE_SPEED = 0.25');
  });
});

describe('ProductionGlobe viewport centering', () => {
  it('can target a measured Dashboard command-center point instead of only sidebar width', () => {
    const source = readFileSync(new URL('./ProductionGlobe.tsx', import.meta.url), 'utf8');

    expect(source).toContain('export interface GlobeViewportCenter');
    expect(source).toContain('width?: number;');
    expect(source).toContain('height?: number;');
    expect(source).toContain('viewportCenter?: GlobeViewportCenter | null;');
    expect(source).toContain('const targetX = canvasRect.width > 0');
    expect(source).toContain('const targetY = canvasRect.height > 0');
    expect(source).toContain('offsetX = size.width / 2 - targetX;');
    expect(source).toContain('offsetY = size.height / 2 - targetY;');
    expect(source).toContain('<ViewOffsetManager sidebarOffset={sidebarOffset} viewportCenter={viewportCenter} />');
  });
});
