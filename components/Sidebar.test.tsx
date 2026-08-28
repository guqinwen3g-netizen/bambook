import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_ACTIVE_CLASS,
  SIDEBAR_ACTIVE_GLASS_CLASS,
  SIDEBAR_ACTIVE_ICON_CLASS,
  SIDEBAR_AMBIENT_CLASS,
  SIDEBAR_HARMONY_PANEL_CLASS,
  SIDEBAR_IDLE_TEXT_CLASS,
  SIDEBAR_SETTINGS_ACTIVE_CLASS,
} from './Sidebar';
import { BAMBOOK_OS } from './ui/bambookOsTokens';

describe('Sidebar reveal material system', () => {
  it('uses the shared wallpaper-accent matte material instead of a locked blue shell', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const osVnextCss = readFileSync(new URL('../styles/os-vnext.css', import.meta.url), 'utf8');
    const mainCoverSource = osVnextCss.slice(
      osVnextCss.indexOf('.ui-lab-real-os-root .app-main-cover,'),
      osVnextCss.indexOf('.ui-lab-real-os-root .app-main-viewport,')
    );
    const revealUnderlaySource = osVnextCss.slice(
      osVnextCss.indexOf('.ui-lab-real-os-root .app-reveal-underlay-material,'),
      osVnextCss.indexOf('.bambook-os-root--dark .app-reveal-underlay-material')
    );
    const expandedHubSource = source.slice(
      source.indexOf('{/* The Expanded Hub */}'),
      source.indexOf('{/* Nav Items */}')
    );

    expect(SIDEBAR_HARMONY_PANEL_CLASS).toBe('');
    expect(SIDEBAR_AMBIENT_CLASS).toBe('');

    expect(BAMBOOK_OS.material.panelBase).toContain('rounded-[24px]');
    expect(BAMBOOK_OS.material.panelBase).toContain('backdrop-blur-[15px]');
    expect(BAMBOOK_OS.material.panelBase).toContain('backdrop-saturate-[104%]');
    expect(source).toContain('className="app-sidebar absolute left-0 top-0 bottom-0 z-10');
    expect(BAMBOOK_OS.layout.desktopSidebarShellClass).toBe('!absolute !left-0 !top-0 !bottom-0 w-[232px] z-10 flex flex-col ![border-radius:0]');
    expect(BAMBOOK_OS.layout.desktopSidebarShellClass).not.toContain('border-top-right-radius');
    expect(BAMBOOK_OS.layout.desktopSidebarShellClass).not.toContain('border-bottom-right-radius');
    expect(appSource).toContain("data-sidebar-state={isCollapsed ? 'collapsed' : 'expanded'}");
    expect(appSource).toContain("['--app-sidebar-w' as any]: isCollapsed ? '64px' : '232px'");
    expect(appSource).toContain("['--app-sidebar-visual-w' as any]: `${(isCollapsed ? 64 : 232) * appScale}px`");
    expect(appSource).toContain('app-reveal-underlay-material');
    expect(appSource).toContain('app-main app-main-cover');
    expect(appSource).toContain('app-main-viewport');
    expect(osVnextCss).toContain('.bambook-os-root .app-reveal-underlay-material');
    expect(osVnextCss).toContain('--app-underlay-cover-overlap: 0px;');
    expect(osVnextCss).toContain('width: calc(var(--app-sidebar-visual-w, var(--app-sidebar-w, 232px)) + var(--app-main-cover-radius));');
    expect(osVnextCss).toContain('backdrop-filter: var(--bambook-rdl-panel-filter, saturate(124%) blur(15px));');
    expect(appSource).toContain('data-wallpaper-mode={isWallpaperMode ?');
    expect(appSource).toContain('data-appearance-mode={appearanceMode}');
    expect(revealUnderlaySource).toContain('background: var(--bambook-rdl-panel-fill, rgb(255 255 255 / 0.64));');
    expect(revealUnderlaySource).not.toContain('linear-gradient(180deg, rgb(var(--os-vnext-brand-blue-soft-rgb)');
    expect(revealUnderlaySource).not.toContain('rgb(var(--os-vnext-brand-blue-soft-rgb)');
    expect(osVnextCss).toContain('-webkit-mask-image:');
    expect(osVnextCss).toContain('radial-gradient(circle at 100% 100%');
    expect(osVnextCss).toContain('radial-gradient(circle at 100% 0%');
    expect(osVnextCss).toContain('transparent calc(var(--app-main-cover-radius) - 0.5px), #000 calc(var(--app-main-cover-radius) - 0.5px)');
    expect(osVnextCss).toContain('calc(100% - var(--app-main-cover-radius)) 100%');
    expect(osVnextCss).toContain('100% 0,');
    expect(osVnextCss).toContain('100% 100%;');
    expect(osVnextCss).toContain('.bambook-os-root .app-main-cover');
    expect(osVnextCss).toContain('left: var(--app-sidebar-visual-w, var(--app-sidebar-w, 232px));');
    expect(osVnextCss).toContain('z-index: 30;');
    expect(osVnextCss).toContain('--app-main-cover-radius: 38px;');
    expect(osVnextCss).toContain('--app-main-cover-radius: 30px;');
    expect(osVnextCss).toContain('border-radius: var(--app-main-cover-radius);');
    expect(osVnextCss).toContain('border-radius: var(--app-main-cover-radius) 0 0 var(--app-main-cover-radius);');
    expect(osVnextCss).toContain('background: transparent;');
    expect(mainCoverSource).toContain('box-shadow: none !important;');
    expect(mainCoverSource).toContain('border: 0 !important;');
    expect(mainCoverSource).toContain('filter: none !important;');
    expect(mainCoverSource).toContain('overflow: hidden !important;');
    expect(mainCoverSource).not.toContain('box-shadow: -');
    expect(mainCoverSource).not.toContain('box-shadow 420ms');
    expect(osVnextCss).not.toContain('transform: translateX(var(--app-sidebar-w');
    expect(osVnextCss).toContain('.bambook-os-root .app-sidebar-underlay-content');
    expect(osVnextCss).toContain('backdrop-filter: none !important;');
    expect(source).not.toContain("import SidePanelContainer");
    expect(source).not.toContain('MotionSidePanelContainer');
    expect(source).toContain('AnimatePresence');
    expect(source).toContain('data-sidebar-account-menu');
    expect(expandedHubSource).toContain('data-sidebar-underlay-content');
    expect(expandedHubSource).toContain('app-sidebar-underlay-content');
    expect(expandedHubSource).toContain('data-sidebar-expanded-collapse-button');
    expect(expandedHubSource).toContain('setIsCollapsed(true)');
    expect(expandedHubSource).toContain('aria-label="折叠侧边栏"');
    expect(expandedHubSource).not.toContain('<SidePanelContainer');
    expect(expandedHubSource).not.toContain('SIDE_PANEL_OUTER_CLASS');
    expect(expandedHubSource).not.toContain('bambook-outer-panel');
    expect(expandedHubSource).not.toContain('surfaceRole="framePanel"');
    expect(expandedHubSource).not.toContain('shadowRole="sidebarShell"');
    expect(expandedHubSource).not.toContain('shadowMode="attached"');
    expect(expandedHubSource).not.toContain('contentClassName=');
    expect(expandedHubSource).not.toContain('inset-px rounded-[23px]');
    expect(expandedHubSource).not.toContain('inset_0_0_0_1px_rgba(255,255,255');
    expect(expandedHubSource).not.toContain('SIDEBAR_LIQUID');
    expect(expandedHubSource).not.toContain('{/* Spotlight Layer */}');
    expect(source).not.toContain('animateSpotlightTo');
    expect(source).not.toContain("window.addEventListener('pointermove'");
    expect(source).not.toContain("style.setProperty('--sidebar-hover-x'");
    expect(source).not.toContain('data-sidebar-active-target');
  });

  it('syncs collapsed rail and expanded hub transitions with the aside width spring', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const collapsedRailSource = source.slice(
      source.indexOf('{/* The Neutral Spine */}'),
      source.indexOf('{/* The Expanded Hub */}')
    );
    const expandedHubSource = source.slice(
      source.indexOf('{/* The Expanded Hub */}'),
      source.indexOf('</motion.aside>')
    );

    // 收起 rail：motion.div 接管 opacity/x，与 aside 宽度同一 spring（damping 25 / stiffness 150），
    // 不再用 700ms CSS 过渡（与 spring 不同步导致 button "戳出来"）
    expect(collapsedRailSource).toContain('<motion.div');
    expect(collapsedRailSource).toContain('opacity: isCollapsed ? 1 : 0');
    expect(collapsedRailSource).toContain('x: isCollapsed ? 0 : -20');
    expect(collapsedRailSource).toContain("transition={{ type: 'spring', damping: 25, stiffness: 150 }}");
    expect(collapsedRailSource).not.toContain('transition-all duration-700');
    expect(collapsedRailSource).not.toContain("'opacity-100' : 'opacity-0 pointer-events-none'");
    expect(collapsedRailSource).toContain("${isCollapsed ? 'pointer-events-auto' : 'pointer-events-none'}");

    // 展开块：始终挂载 + motion 过渡（原条件渲染导致 button 直接出现/消失）；
    // 收起时 inert + aria-hidden + pointer-events-none，可达性与原卸载行为对齐
    expect(source).not.toContain('{!isCollapsed && (');
    expect(expandedHubSource).toContain('opacity: isCollapsed ? 0 : 1');
    expect(expandedHubSource).toContain('x: isCollapsed ? 20 : 0');
    expect(expandedHubSource).toContain("transition={{ type: 'spring', damping: 25, stiffness: 150 }}");
    expect(expandedHubSource).toContain('inert={isCollapsed}');
    expect(expandedHubSource).toContain('aria-hidden={isCollapsed}');
    expect(expandedHubSource).toContain("${isCollapsed ? '!pointer-events-none' : ''}");
    expect(expandedHubSource).toContain('{!isCollapsed && accountMenuOpen && (');
  });

  it('keeps hover, press, and selected states in the HarmonyOS motion language', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const osVnextCss = readFileSync(new URL('../styles/os-vnext.css', import.meta.url), 'utf8');
    const navSource = source.slice(
      source.indexOf('{/* Nav Items */}'),
      source.indexOf('{/* Bottom Utility Bar */}')
    );

    // P3-2：hover/press 真源坍缩至 BAMBOOK_OS.controls.listRow（BDS 纪律：hover 统一 --hover-darken / active 用 --active-darken）
    expect(BAMBOOK_OS.controls.listRow.hover).toContain('hover:bg-[var(--hover-darken)]');
    expect(BAMBOOK_OS.controls.listRow.hover).toContain('hover:shadow-none');
    expect(BAMBOOK_OS.controls.listRow.hover).not.toContain('0_10px_22px_-14px_rgba(15,23,42,0.13)');
    expect(BAMBOOK_OS.controls.listRow.hover).not.toContain('0_2px_8px_-6px_rgba(15,23,42,0.08)');
    expect(BAMBOOK_OS.controls.listRow.hover).not.toContain('0_8px_16px_-12px_rgba(0,0,0,0.04)');
    expect(BAMBOOK_OS.controls.listRow.hover).not.toContain('hover:text-');
    expect(BAMBOOK_OS.controls.listRow.press).toContain('active:scale-[0.98]');
    expect(BAMBOOK_OS.controls.listRow.press).toContain('active:bg-[var(--active-darken)]');
    expect(SIDEBAR_ACTIVE_CLASS).toBe('bambook-selected-surface');
    expect(osVnextCss).toContain('.bambook-selected-surface');
    expect(osVnextCss).toContain('.bambook-selected-surface--light');
    expect(osVnextCss).toContain('--bambook-selected-light-border-color: transparent;');
    expect(osVnextCss).toContain('--bambook-selected-light-background: rgba(255, 255, 255, 0.42);');
    expect(osVnextCss).toContain('border-color: var(--bambook-selected-light-border-color) !important;');
    expect(osVnextCss).toContain('background: var(--bambook-selected-light-background) !important;');
    expect(osVnextCss).toContain('box-shadow: var(--bambook-selected-light-shadow) !important;');
    expect(osVnextCss).toContain('--bambook-selected-light-shadow: none;');
    expect(osVnextCss).not.toContain('--bambook-selected-light-inner-outline');
    expect(osVnextCss).not.toContain('inset 0 0 0 1px rgba(125, 183, 255, 0.085)');
    expect(osVnextCss).not.toContain('inset 0 0 0 1px rgba(100, 116, 139, 0.055)');
    expect(osVnextCss).toContain('.bambook-selected-surface--dark');
    expect(osVnextCss).toContain('border-color: rgba(255, 255, 255, 0.055) !important;');
    expect(osVnextCss).toContain('background: rgba(255, 255, 255, 0.055) !important;');
    expect(SIDEBAR_ACTIVE_CLASS).not.toContain('rgba(255,255,255,0.6)');
    expect(SIDEBAR_ACTIVE_CLASS).not.toContain('rgba(255,255,255,0.85)');
    expect(source).toContain("'text-[var(--text-primary)]'");
    expect(source).not.toContain('dark:text-white');
    expect(SIDEBAR_ACTIVE_GLASS_CLASS).toBe('');
    expect(SIDEBAR_ACTIVE_ICON_CLASS).toBe('text-current');
    expect(SIDEBAR_IDLE_TEXT_CLASS).toBe('!text-[var(--text-secondary)]');
    expect(BAMBOOK_OS.controls.listRow.idleIcon).toBe('!text-[var(--text-tertiary)]');
    expect(navSource).not.toContain("isDarkMode ? 'text-os-adaptive-primary' : SIDEBAR_IDLE_TEXT_CLASS");
  });

  it('aligns nested surface material to selected button color and secondary panel shadow', () => {
    const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    const nestedSurfaceSource = indexCss.slice(
      indexCss.indexOf('.bambook-nested-surface {'),
      indexCss.indexOf('.relations-toolbar-search-dark')
    );

    expect(nestedSurfaceSource).toContain('background-color: rgba(255, 255, 255, 0.30);');
    expect(nestedSurfaceSource).toContain('border-color: rgba(203, 213, 225, 0.40) !important;');
    expect(nestedSurfaceSource).toContain('background-color: rgba(13, 27, 42, 0.42);');
    expect(nestedSurfaceSource).toContain('border-color: rgba(255, 255, 255, 0.10) !important;');

    expect(nestedSurfaceSource).toContain('box-shadow: var(--ui-lab-panel-secondary-shadow) !important;');
    expect(nestedSurfaceSource).not.toContain('box-shadow: var(--ui-lab-panel-surface-shadow) !important;');
  });

  it('applies shared HarmonyOS constants in nav and settings controls', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    const navSource = source.slice(
      source.indexOf('{/* Nav Items */}'),
      source.indexOf('{/* Bottom Utility Bar */}')
    );
    const utilitySource = source.slice(
      source.indexOf('{/* Bottom Utility Bar */}'),
      source.indexOf('{/* Account Menu Popover')
    );

    expect(navSource).toContain('SIDEBAR_ACTIVE_CLASS');
    expect(navSource).toContain('SIDEBAR_HOVER_CLASS');
    expect(navSource).toContain('SIDEBAR_PRESS_CLASS');
    expect(navSource).not.toContain('dark:active:bg-[var(--recessed-bg)]');
    expect(navSource).toContain('SIDEBAR_IDLE_TEXT_CLASS');
    expect(navSource).toContain('SIDEBAR_ACTIVE_ICON_CLASS');
    expect(navSource).toContain('SIDEBAR_IDLE_ICON_CLASS');
    expect(navSource).not.toMatch(/isDarkMode\s*\?/);
    expect(navSource).toContain('data-sidebar-nav-item');
    expect(navSource).toContain("data-sidebar-nav-active={isActive ? 'true' : 'false'}");
    expect(navSource).toContain('data-sidebar-nav-icon');
    expect(navSource).toContain('data-sidebar-nav-label');
    expect(navSource).toContain('data-sidebar-nav-scroll');
    expect(navSource).toContain('bambook-sidebar-nav-scroll-viewport');
    expect(navSource).toContain('h-14');
    expect(navSource).toContain('py-0');
    expect(navSource).not.toContain('py-2.5');
    expect(navSource).toContain('pt-14');
    expect(navSource).toContain('pb-3.5');
    expect(navSource).toContain('rounded-control');
    expect(navSource).toContain('duration-[320ms]');
    expect(navSource).not.toContain('ref={(node) => {');
    expect(navSource).not.toContain('onMouseMove=');
    expect(navSource).not.toContain('group-hover:scale-[1.08]');
    expect(navSource).not.toContain('translate-x-1');
    expect(indexCss).toContain('.bambook-sidebar-nav-scroll-viewport');
    expect(indexCss).toContain('--bambook-panel-shadow-bleed-x: 0px;');
    expect(indexCss).toContain('overflow-x: hidden;');
    expect(indexCss).toContain('overscroll-behavior-x: none;');

    expect(SIDEBAR_SETTINGS_ACTIVE_CLASS).toBe(SIDEBAR_ACTIVE_CLASS);
    expect(source).toContain('账号设置');
    expect(source).toContain('系统设置');
    expect(utilitySource).toContain('h-11 w-11');
    expect(utilitySource).not.toContain('active:scale');
    expect(utilitySource).not.toContain('hover:bg-white');
    expect(utilitySource).not.toContain('group-hover:scale-[1.03]');
    expect(utilitySource).not.toContain('group-hover:text');
    expect(utilitySource).not.toContain('onMouseMove=');
  });

  it('replaces separate theme and settings buttons with a single account menu entry', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const utilitySource = source.slice(
      source.indexOf('{/* Bottom Utility Bar */}'),
      source.indexOf('{/* Account Menu Popover')
    );

    expect(source).toContain('getAuthState().user');
    expect(source).toContain('subscribe((next) => setAuthUser(next.user))');
    expect(source).toContain('账号设置');
    expect(source).toContain('系统设置');
    expect(utilitySource).toContain('setAccountMenuOpen((open) => !open)');
    expect(source).toContain("openSettingsTab('account')");
    expect(source).toContain("openSettingsTab('system')");
    expect(source).toContain('View.AccountSettings');
    expect(source).toContain('View.SystemSettings');
    expect(utilitySource).not.toContain("<span className=\"text-xs font-medium\">{isDarkMode ? '浅色' : '深色'}</span>");
  });

  it('uses brand blue instead of cyan in the collapsed sidebar rail', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const collapsedRailSource = source.slice(
      source.indexOf('{/* The Neutral Spine */}'),
      source.indexOf('{/* The Expanded Hub */}')
    );

    expect(collapsedRailSource).not.toContain("isDarkMode ? 'text-slate-50' : 'text-[#0A2746]'");
    expect(collapsedRailSource).not.toContain('text-os-adaptive-primary hover:text-os-adaptive-brand');
    expect(collapsedRailSource).toContain('text-[var(--os-adaptive-primary)]');
    expect(collapsedRailSource).toContain('data-sidebar-adaptive-icon');
    expect(collapsedRailSource).not.toContain('SIDEBAR_COLLAPSED_SPINE_CLASS');
    expect(collapsedRailSource).not.toContain('bg-gradient-to-b');
    expect(collapsedRailSource).toContain('z-10 flex flex-col items-center gap-6 ${blueprint.collapsedRail.actionMarginClass}');
    expect(collapsedRailSource).not.toContain('<div className="flex-1"></div>');
    expect(collapsedRailSource).not.toContain('#5DE0E6');
    expect(collapsedRailSource).not.toContain('animate-pulse');
  });

  it('keeps a settings entry at the bottom of the collapsed rail', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const collapsedRailSource = source.slice(
      source.indexOf('{/* The Neutral Spine */}'),
      source.indexOf('{/* The Expanded Hub */}')
    );
    const collapsedActionsSource = collapsedRailSource.slice(
      collapsedRailSource.indexOf('data-sidebar-collapsed-actions'),
      collapsedRailSource.indexOf('aria-label="设置"')
    );

    expect(collapsedRailSource).toContain('aria-label="设置"');
    expect(collapsedRailSource).toContain('absolute bottom-6 left-1/2 z-20');
    expect(collapsedRailSource).toContain('data-sidebar-collapsed-settings');
    expect(collapsedRailSource).toContain('<Settings size={20}');
    expect(collapsedActionsSource).not.toContain('data-sidebar-adaptive-avatar');
    expect(collapsedRailSource).not.toContain('setAccountMenuOpen(true)');
    expect(collapsedRailSource).toContain("openSettingsTab('system')");
    expect(collapsedRailSource).toContain('setIsCollapsed(false)');
    expect(source).toContain("import UserAvatar from './ui/UserAvatar'");
    expect(collapsedRailSource).toContain('data-sidebar-collapsed-rail');
    expect(collapsedRailSource).not.toContain('data-sidebar-adaptive-item');
    expect(collapsedRailSource).toContain('data-sidebar-adaptive-icon');
    expect(collapsedRailSource).not.toContain('data-sidebar-adaptive-avatar');
    expect(collapsedRailSource).not.toContain('isSettingsView');
    expect(collapsedRailSource).toContain('<Settings size={20}');
    expect(collapsedRailSource).toContain('data-sidebar-collapsed-settings');
    expect(collapsedRailSource).not.toContain('sidebar-collapsed-adaptive-avatar-content');
  });

  it('adapts expanded sidebar text through the wallpaper contrast contract', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const expandedSource = source.slice(
      source.indexOf('{/* The Expanded Hub */}'),
      source.indexOf('</motion.aside>')
    );

    expect(expandedSource).not.toContain('className="bambook-title-adaptive-ink text-lg font-light tracking-tighter text-os-adaptive-title"');
    expect(expandedSource).not.toContain('<BambookIcon size={26}');
    expect(expandedSource).not.toContain('Bambook Neural</span>');
    expect(expandedSource).not.toContain('{/* Header / Collapse Control */}');
    expect(expandedSource).toContain('text-[var(--os-adaptive-primary)]');
    expect(expandedSource).toContain('text-[var(--os-adaptive-subtitle)]');
    expect(expandedSource).not.toContain("data-ui-lab-wallpaper-contrast={isActive ? undefined : 'secondary'}");
    expect(expandedSource).not.toContain("data-ui-lab-wallpaper-contrast={isActive ? 'primary' : 'secondary'}");
    expect(expandedSource).toContain('className="truncate text-sm font-light text-[var(--os-adaptive-primary)]"');
    expect(expandedSource).toContain('className="mt-0.5 truncate text-[10px] font-light text-[var(--os-adaptive-subtitle)]"');
    expect(expandedSource).toContain('data-ui-lab-wallpaper-contrast="primary" className="text-xs font-light">账号设置</span>');
    expect(expandedSource).toContain('data-ui-lab-wallpaper-contrast="primary" className="text-xs font-light">系统设置</span>');
    expect(expandedSource).toContain('data-ui-lab-wallpaper-contrast="primary" className="text-xs font-light">{isDarkMode ?');
  });

  it('filters navigation items through view permissions', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('canAccessView');
    expect(source).toContain('allowedViews?: readonly View[]');
    expect(source).toContain('getPrimaryNavigationModules({ isAdmin, canAccessView, allowedViews })');
    expect(source).not.toContain('allowedViewSet.has(item.id)');
    expect(source).not.toContain('.filter(item => canAccessView(item.id) && (!allowedViewSet || allowedViewSet.has(item.id)))');
  });
});
