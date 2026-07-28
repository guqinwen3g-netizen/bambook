import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Bambook PWA mobile shell', () => {
  it('keeps phone, tablet, and desktop behind one URL with a copied web app for phone', () => {
    const indexSource = readFileSync(new URL('../../index.tsx', import.meta.url), 'utf8');
    const pageZoomGuardSource = readFileSync(new URL('../pageZoomGuard.ts', import.meta.url), 'utf8');
    const deviceSource = readFileSync(new URL('../deviceMode.ts', import.meta.url), 'utf8');
    const mobileWebSource = readFileSync(new URL('./MobileWebApp.tsx', import.meta.url), 'utf8');
    const desktopSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

    expect(indexSource).toContain("import('./pwa/mobile/MobileWebApp')");
    expect(indexSource).toContain("import('./App')");
    expect(indexSource).toContain("classList.toggle('bambook-device-phone'");
    expect(indexSource).toContain('installPageZoomGuard');
    expect(indexSource).toContain('installPhoneZoomGuard');
    expect(pageZoomGuardSource).toContain('maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    expect(pageZoomGuardSource).toContain("document.addEventListener('wheel', preventTrackpadPageZoom, { capture: true, passive: false })");
    expect(pageZoomGuardSource).toContain("document.addEventListener('touchmove', preventPinch, { passive: false })");
    expect(pageZoomGuardSource).toContain("document.addEventListener('gesturestart', preventGesture, { passive: false })");
    expect(mobileWebSource).toContain("import Dashboard from '../../components/Dashboard'");
    expect(mobileWebSource).toContain("import MobileWebNavigation from './MobileWebNavigation'");
    expect(mobileWebSource).toContain('bambook-mobile-web-shell');
    expect(mobileWebSource).toContain('const MobileWebApp: React.FC');
    expect(mobileWebSource).toContain('export default MobileWebApp');
    expect(desktopSource).toContain('const App: React.FC');
    expect(deviceSource).toContain("get('bambookDevice')");
    expect(deviceSource).toContain("return 'phone'");
    expect(deviceSource).toContain("return 'tablet'");
    expect(deviceSource).toContain("return 'desktop'");
  });

  it('removes the failed legacy mobile shell and scripts', () => {
    const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    const packageJson = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');

    expect(appSource).not.toContain("import MobileNavBar");
    expect(appSource).not.toContain("import MobileDashboard");
    expect(appSource).not.toContain('isMobileDrawerOpen');
    expect(packageJson).not.toContain('dev:mobile');
    expect(packageJson).not.toContain('build:mobile');
    expect(existsSync(new URL('../../components/MobileNavBar.tsx', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../../components/mobile/MobileDashboard.tsx', import.meta.url))).toBe(false);
  });

  it('declares installable PWA metadata for the deployed Bambook OS scope', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const manifest = readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8');
    const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    const tailwind = readFileSync(new URL('../../tailwind.config.js', import.meta.url), 'utf8');

    expect(html).toContain('rel="manifest"');
    expect(html).toContain('maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(manifest).toContain('"scope": "/bambookos/"');
    expect(manifest).toContain('"start_url": "/bambookos/"');
    expect(sw).toContain('bambook-pwa-shell');
    expect(sw).not.toContain("'./',");
    expect(sw).toContain("request.mode === 'navigate'");
    expect(sw).toContain('fetch(request)');
    expect(sw).toContain("url.pathname.includes('/api/')");
    expect(tailwind).toContain("./pwa/**/*.{ts,tsx,js,jsx}");
  });

  it('keeps the custom mobile shell out of the active phone entry', () => {
    const indexSource = readFileSync(new URL('../../index.tsx', import.meta.url), 'utf8');
    expect(indexSource).not.toContain("import('./pwa/mobile/MobilePwaApp')");
  });

  it('adapts the copied phone app with a scaled shell and mobile navigation chrome', () => {
    const mobileWebSource = readFileSync(new URL('./MobileWebApp.tsx', import.meta.url), 'utf8');
    const mobileNavigationSource = readFileSync(new URL('./MobileWebNavigation.tsx', import.meta.url), 'utf8');
    const desktopSidebarSource = readFileSync(new URL('../../components/Sidebar.tsx', import.meta.url), 'utf8');
    const cssSource = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

    expect(mobileWebSource).toContain("import MobileWebNavigation from './MobileWebNavigation'");
    expect(mobileWebSource).toContain("['--app-sidebar-w' as any]: '0px'");
    expect(mobileWebSource).toContain('sidebarOffset={0}');
    expect(mobileWebSource).toContain('<MobileWebNavigation');
    expect(mobileWebSource).toContain('isDarkMode={isDarkMode} isMobile');
    expect(mobileWebSource).toContain('<RelationsManager relations={relations} onUpdate={handleUpdateRelations} isDarkMode={isDarkMode} isMobile');
    expect(mobileWebSource).toContain('startTransition');
    expect(mobileWebSource).toContain('hasActivatedGlobe');
    expect(mobileWebSource).toContain('isGlobeUnderlay');
    expect(mobileWebSource).not.toContain('active={isGlobeUnderlay}');
    expect(mobileWebSource).not.toContain('frameMode=');
    expect(mobileWebSource).not.toContain('ProgressiveBlurMask');
    expect(mobileWebSource).toContain('transition-opacity duration-150');
    expect(mobileWebSource).not.toContain('duration-1000 ease-out delay-500');
    expect(mobileNavigationSource).toContain('bambook-mobile-bottom-nav');
    expect(mobileNavigationSource).toContain('bambook-mobile-home-panel');
    expect(mobileNavigationSource).toContain("type: 'home' as const, icon: Home, label: '主页'");
    expect(mobileNavigationSource).not.toContain('bambook-mobile-menu-trigger');
    expect(mobileNavigationSource).not.toContain('fixed right-4 top-4');
    expect(mobileNavigationSource).not.toContain('fixed left-4 top-4');
    expect(mobileNavigationSource).not.toContain('rounded-2xl border backdrop-blur-2xl');
    expect(mobileNavigationSource).not.toContain('rounded-2xl backdrop-blur-2xl');
    expect(mobileNavigationSource).not.toContain('bg-white/44');
    expect(mobileNavigationSource).not.toContain('bg-[#0d1b2a]/42');
    expect(mobileNavigationSource).toContain('View.Assistant');
    expect(mobileNavigationSource).toContain("id: View.Products, icon: Library, label: '档案'");
    expect(mobileNavigationSource).not.toContain("id: View.Settings, icon: Settings, label: '设置' },\\n  ];");
    expect(mobileNavigationSource).toContain('View.AdminPanel');
    expect(mobileNavigationSource).toContain('Sparkles');
    expect(mobileNavigationSource).toContain('runTouchAction');
    expect(mobileNavigationSource).toContain('onPointerUp');
    expect(mobileNavigationSource).toContain('lastTouchAtRef');
    expect(mobileNavigationSource).toContain('DUPLICATE_TOUCH_CLICK_WINDOW_MS = 90');
    expect(mobileNavigationSource).toContain('Math.hypot');
    expect(mobileNavigationSource).toContain('optimisticView');
    expect(mobileNavigationSource).toContain('pendingViewTimerRef');
    expect(mobileNavigationSource).toContain('window.setTimeout(() =>');
    expect(mobileNavigationSource).toContain('FIRST_VIEW_SWITCH_DELAY_MS = 25');
    expect(mobileNavigationSource).toContain('RAPID_VIEW_SWITCH_DELAY_MS = 120');
    expect(mobileNavigationSource).toContain('RAPID_VIEW_SWITCH_WINDOW_MS = 260');
    expect(mobileNavigationSource).toContain('EDGE_BACK_START_PX = 28');
    expect(mobileNavigationSource).toContain('EDGE_BACK_MIN_DELTA_X = 72');
    expect(mobileNavigationSource).toContain('EDGE_BACK_MAX_DELTA_Y = 44');
    expect(mobileNavigationSource).toContain('viewHistoryRef');
    expect(mobileNavigationSource).toContain('suppressHistoryRef');
    expect(mobileNavigationSource).toContain('const goBack = React.useCallback');
    expect(mobileNavigationSource).toContain("document.addEventListener('pointerdown', handlePointerDown, { passive: true })");
    expect(mobileNavigationSource).toContain("document.addEventListener('pointerup', handlePointerUp, { passive: false })");
    expect(mobileWebSource).not.toContain('MobileWebSidebar');
    expect(existsSync(new URL('./MobileWebSidebar.tsx', import.meta.url))).toBe(false);
    expect(desktopSidebarSource).not.toContain('runTouchAction');
    expect(cssSource).toContain('body.bambook-device-phone .bambook-mobile-web-shell');
    expect(cssSource).toContain('--bambook-mobile-web-logical-width: 520px');
    expect(cssSource).toContain('transform: scale(var(--bambook-mobile-web-scale))');
    expect(cssSource).toContain('body.bambook-device-phone .bambook-mobile-bottom-nav');
    expect(cssSource).toContain('right: max(env(safe-area-inset-right), 14px)');
    expect(cssSource).toContain('body.bambook-device-phone .bambook-mobile-home-panel');
    expect(cssSource).not.toContain('body.bambook-device-phone .bambook-mobile-menu-trigger');
    expect(cssSource).toContain('safe-area-inset-bottom');
    expect(cssSource).toContain('safe-area-inset-left');
    expect(cssSource).toContain('safe-area-inset-right');
  });
});
