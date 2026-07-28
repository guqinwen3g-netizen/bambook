import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    DASHBOARD_CARD_ROTATION_MS,
    DASHBOARD_ADAPTIVE_CARD_ATTR,
    DASHBOARD_HEADER_CARD_FADE_OFFSET_PX,
    DASHBOARD_HEADER_CARD_FADE_FEATHER_PX,
    DASHBOARD_EDGE_FADE_CARD_SELECTOR,
    DASHBOARD_EXPANDED_AI_MIN_WIDTH_PX,
    DASHBOARD_EXPANDED_MARKET_MIN_WIDTH_PX,
    DASHBOARD_EXPANDED_MAX_WIDTH_PX,
    DASHBOARD_EXPANDED_METRIC_MIN_WIDTH_PX,
    DASHBOARD_EXPANDED_MIN_WIDTH_PX,
    DASHBOARD_EXPANDED_HUD_FRAME_CLASS,
    DASHBOARD_EXPANDED_PIPELINE_MIN_WIDTH_PX,
    DASHBOARD_EXPANDED_STATUS_MIN_WIDTH_PX,
    DASHBOARD_EXPANDED_VELOCITY_MIN_WIDTH_PX,
    DASHBOARD_HUD_LAYER_CLASS,
    DASHBOARD_HUD_ROOT_CLASS,
    DASHBOARD_HUD_SCROLLER_CLASS,
    DASHBOARD_GLOBE_BOTTOM_CLASS,
    DASHBOARD_GLOBE_HUD_FRAME_CLASS,
    DASHBOARD_GLOBE_STAGE_CLASS,
    DASHBOARD_CARD_RADIUS_CLASS,
    DASHBOARD_FLOATING_OVERLAY_CLASS,
    DASHBOARD_GLOBE_MAX_WIDTH_PX,
    DASHBOARD_HUD_BOTTOM_INSET_CLASS,
    DASHBOARD_HUD_TOP_INSET_CLASS,
    DASHBOARD_INSET_SURFACE_CLASS,
    DASHBOARD_LIVE_SCAN_CLASS,
    DASHBOARD_MARKET_TICK_MS,
    DASHBOARD_PIPELINE_TREND_NEGATIVE_CLASS,
    DASHBOARD_PIPELINE_TREND_POSITIVE_CLASS,
    DASHBOARD_QUIET_ICON_DARK_CLASS,
    DASHBOARD_QUIET_ICON_LIGHT_CLASS,
    DASHBOARD_RAISED_CARD_CLASS,
    DASHBOARD_REFRESH_ICON_DARK_CLASS,
    DASHBOARD_REFRESH_ICON_LIGHT_CLASS,
    DASHBOARD_VELOCITY_ROTATION_MS,
} from './Dashboard';
import { OS_MATERIAL } from './ui/osMaterial';

describe('Dashboard performance timing', () => {
    it('keeps market polling below the visual frame-critical path', () => {
        expect(DASHBOARD_MARKET_TICK_MS).toBeGreaterThanOrEqual(5000);
    });

    it('avoids rapid automatic card flips over the WebGL underlay', () => {
        expect(DASHBOARD_CARD_ROTATION_MS).toBeGreaterThanOrEqual(15000);
        expect(DASHBOARD_VELOCITY_ROTATION_MS).toBeGreaterThanOrEqual(15000);
    });
});

describe('Dashboard globe event passthrough', () => {
    it('keeps full-screen HUD wrappers transparent to globe drag events', () => {
        expect(DASHBOARD_HUD_LAYER_CLASS).toContain('pointer-events-none');
        expect(DASHBOARD_HUD_LAYER_CLASS).not.toContain('pointer-events-auto');
        expect(DASHBOARD_HUD_SCROLLER_CLASS).toContain('pointer-events-none');
        expect(DASHBOARD_HUD_SCROLLER_CLASS).not.toContain('pointer-events-auto');
    });

    it('keeps dashboard cards interactive after the wrappers pass through events', () => {
        const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

        expect(css).toContain('.dashboard-hud-root [data-os-dashboard-adaptive-card]');
        expect(css).toContain('pointer-events: auto');
    });
});

describe('Dashboard HUD polish', () => {
    it('extends the title fade region without restoring the old live status badge', () => {
        const source = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8');
        const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

        expect(DASHBOARD_HEADER_CARD_FADE_FEATHER_PX).toBe(30);
        expect(DASHBOARD_HEADER_CARD_FADE_OFFSET_PX).toBe(10);
        expect(DASHBOARD_EDGE_FADE_CARD_SELECTOR).toBe('[data-os-dashboard-adaptive-card], .liquid-glass-card');
        expect(DASHBOARD_HUD_TOP_INSET_CLASS).toBe('pt-[116px]');
        expect(DASHBOARD_HUD_ROOT_CLASS).toContain(DASHBOARD_HUD_TOP_INSET_CLASS);
        expect(css).toContain('.is-electron .dashboard-hud-root');
        expect(css).toContain('padding-top: 7.75rem');
        expect(css).not.toContain('padding-top: 1.75rem');
        expect(source).toContain('const feather = DASHBOARD_HEADER_CARD_FADE_FEATHER_PX');
        expect(source).toContain('headerRect.bottom + DASHBOARD_HEADER_CARD_FADE_OFFSET_PX');
        expect(source).toContain('scrollerRect.bottom - DASHBOARD_HEADER_CARD_FADE_OFFSET_PX');
        expect(source).toContain('const topActive = rect.top < topFadeLine');
        expect(source).toContain('rect.top >= bottomFadeLine');
        expect(source).toContain("const isUiLab = Boolean(scroller.closest('.ui-lab-real-os-root'))");
        expect(source).toContain("card.setAttribute('data-glass-edge-mask', 'true')");
        expect(source).toContain('transparent ${fadeStart}px, black ${fadeEnd}px');
        expect(source).toContain('stops.push(`transparent 0px, transparent ${fadeStart}px, black ${fadeEnd}px`)');
        expect(source).toContain("stops.push('black 100%')");
        expect(source).not.toContain('DASHBOARD_HEADER_CARD_FADE_OPAQUE_RATIO');
        expect(source).not.toContain('rgba(0,0,0,0.18)');
        expect(DASHBOARD_LIVE_SCAN_CLASS).toContain('dashboard-live-scan');
        expect(DASHBOARD_LIVE_SCAN_CLASS).not.toContain('animate-[');
        expect(source).not.toContain('className={isDarkMode ? DASHBOARD_LIVE_SCAN_CLASS : DASHBOARD_LIVE_SCAN_LIGHT_CLASS}');
        expect(source).not.toContain('>Live<');
        expect(source).not.toContain('AGENT EOS ACTIVE');
        expect(source).not.toContain('Agent EOS active');
        expect(css).toContain('@keyframes dashboard-live-scan');
    });

    it('keeps the dashboard corner clock on desktop while allowing mobile to hide it', () => {
        const source = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8');

        expect(source).toContain('!isMobileSpatial &&');
        expect(source).toContain('toLocaleTimeString');
        expect(source).toContain('UTC+8 SHANGHAI');
        expect(source).toContain('data-ui-lab-wallpaper-contrast');
        expect(source).toContain('Bambook Hub');
        expect(source).toContain('aria-label="Search Bambook Hub"');
        expect(source).toContain('aria-label="Notifications"');
        expect(source).toContain('aria-label="Bambook Team"');
        expect(source).toContain("import UserAvatar from './ui/UserAvatar'");
        expect(source).toContain("import { getAuthState, subscribe } from '../services/authService'");
        expect(source).toContain('avatarUrl={authUser?.avatarUrl}');
        expect(source).not.toContain('text-[13px] font-semibold">B</span>');
        expect(source).not.toContain('Command Center');
        expect(source).not.toContain('command Center');
        expect(source).not.toContain('Panorama Dashboard');
    });

    it('routes dashboard cards through the shared flat OS material role instead of legacy glass classes', () => {
        const source = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8');
        const marketSource = readFileSync(new URL('./ui/MarketIntelligence.tsx', import.meta.url), 'utf8');
        const primitiveSource = readFileSync(new URL('./ui/osCompiler/compiledSurfacePrimitives.tsx', import.meta.url), 'utf8');
        const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
        const osVnextCss = readFileSync(new URL('../styles/os-vnext.css', import.meta.url), 'utf8');
        const flatCss = readFileSync(new URL('../styles/flat-experimental.css', import.meta.url), 'utf8');

        expect(DASHBOARD_CARD_RADIUS_CLASS).toBe('!rounded-[34px]');
        expect(DASHBOARD_RAISED_CARD_CLASS).toBe(`${OS_MATERIAL.raisedCard} ${DASHBOARD_CARD_RADIUS_CLASS}`);
        expect(DASHBOARD_ADAPTIVE_CARD_ATTR).toBe('data-os-dashboard-adaptive-card');
        expect(source).toContain("export const DASHBOARD_ADAPTIVE_CARD_ATTR = 'data-os-dashboard-adaptive-card'");
        expect(primitiveSource).toContain('data-os-dashboard-adaptive-card');
        expect(marketSource).toContain('data-os-dashboard-adaptive-card');
        expect(DASHBOARD_INSET_SURFACE_CLASS).toBe(OS_MATERIAL.insetSurface);
        expect(DASHBOARD_FLOATING_OVERLAY_CLASS).toBe(OS_MATERIAL.floatingOverlay);
        expect(source).not.toContain('deriveAmbientFromContent');
        expect(marketSource).not.toContain('deriveAmbientFromContent');
        expect(source).not.toContain('dashboard-surface-');
        expect(marketSource).not.toContain('dashboard-surface-');
        expect(css).not.toContain('.dashboard-surface-');
        expect(source).not.toContain('DASHBOARD_RAISED_CARD_CLASS = `${OS_MATERIAL.raisedCard} glass-panel');
        expect(source).not.toContain('DASHBOARD_RAISED_CARD_CLASS = `${OS_MATERIAL.raisedCard} bambook-blue-white-surface');
        expect(marketSource).not.toContain('MARKET_INTELLIGENCE_CARD_CLASS = `${OS_MATERIAL.raisedCard} glass-panel');
        expect(marketSource).not.toContain('MARKET_INTELLIGENCE_CARD_CLASS = `${OS_MATERIAL.raisedCard} bambook-blue-white-surface');
        expect(marketSource).toContain('MARKET_INTELLIGENCE_CARD_CLASS');
        expect(marketSource).toContain('OS_MATERIAL.raisedCard');
        expect(css).toContain('.dashboard-hud-root [data-os-dashboard-adaptive-card]');
        expect(css).toContain('.bambook-blue-white-surface');
        expect(css).toContain('.bambook-dashboard-glass-color');
        expect(osVnextCss).toContain('--ui-lab-panel-glass-film-background: none;');
        expect(osVnextCss).toContain('--ui-lab-panel-surface-border: transparent;');
        expect(osVnextCss).toContain('--ui-lab-panel-highlight-opacity: 0;');
        expect(flatCss).toContain('BAMBOOK FLAT MATERIAL MIGRATION SHIELD');
        expect(flatCss).toContain('--bambook-rdl-panel-fill-light: rgb(255 255 255 / 0.50)');
        expect(flatCss).toContain('--bambook-rdl-card-fill-light: rgb(255 255 255 / 0.44)');
        expect(flatCss).toContain('--bambook-rdl-inset-fill-light: rgb(255 255 255 / 0.30)');
        expect(flatCss).toContain('--bambook-rdl-floating-fill-light: rgb(255 255 255 / 0.70)');
        expect(flatCss).toContain('--ui-lab-panel-frame-depth-shadow: none !important');
        expect(flatCss).toContain('--ui-lab-panel-raised-depth-shadow: none !important');
        expect(flatCss).toContain('.bambook-os-root[data-wallpaper-mode="on"]');
        expect(flatCss).toContain('--bambook-rdl-card-fill-light: rgb(255 255 255 / 0.28)');
        expect(flatCss).toContain('--bambook-rdl-primary-text: rgb(255 255 255)');
        expect(flatCss).toContain('box-shadow: none !important');
        expect(flatCss).toContain('border-color: transparent !important');
        expect(css).not.toContain('radial-gradient(360px 240px at 18% 8%');
        expect(css).not.toContain('radial-gradient(380px 250px at 18% 8%');
        expect(osVnextCss).toContain('--ui-lab-panel-glass-film-color: rgba(255, 255, 255, 0.50)');
        expect(osVnextCss).toContain('--ui-lab-panel-glass-film-color: rgba(20, 28, 42, 0.42)');
        expect(osVnextCss).not.toContain('--ui-lab-panel-glass-film-background: radial-gradient(360px 240px');
        expect(osVnextCss).not.toContain('--ui-lab-panel-glass-film-background: radial-gradient(380px 250px');
        expect(osVnextCss).not.toContain('--ui-lab-panel-glass-film-background: radial-gradient(900px 180px');
        expect(osVnextCss).toContain('--ui-lab-panel-shared-glass-background: none;');
        expect(osVnextCss).toContain('--ui-lab-panel-nested-glass-background: transparent;');
        expect(osVnextCss).toContain('--ui-lab-panel-raised-film-color: var(--ui-lab-panel-glass-film-color)');
        expect(osVnextCss).toContain('--ui-lab-panel-inset-film-color: var(--ui-lab-panel-glass-film-color)');
        expect(osVnextCss).toContain('--ui-lab-panel-raised-glass-background: var(--ui-lab-panel-nested-glass-background)');
        expect(osVnextCss).toContain('--ui-lab-panel-inset-glass-background: var(--ui-lab-panel-nested-glass-background)');
        expect(osVnextCss).not.toContain('--ui-lab-panel-raised-glass-background: var(--ui-lab-panel-shared-glass-background)');
        expect(osVnextCss).not.toContain('--ui-lab-panel-inset-glass-background: var(--ui-lab-panel-shared-glass-background)');
        expect(osVnextCss).toContain('background-color: var(--ui-lab-panel-glass-film-color) !important');
        expect(osVnextCss).toContain('background-image: var(--ui-lab-panel-raised-glass-background) !important');
        expect(osVnextCss).toContain('background-image: var(--ui-lab-panel-inset-glass-background) !important');
        expect(osVnextCss).toContain('.ui-lab-real-os-root .os-material-raised-card,\n.bambook-os-root .os-material-raised-card');
        expect(osVnextCss).toContain('background-color: var(--ui-lab-panel-raised-film-color) !important');
        expect(osVnextCss).toContain('backdrop-filter: var(--ui-lab-panel-surface-filter) !important');
        expect(source).toContain('DASHBOARD_RAISED_CARD_CLASS');
        expect(source).toContain('DASHBOARD_INSET_SURFACE_CLASS');
        expect(source).toContain('DASHBOARD_FLOATING_OVERLAY_CLASS');
        expect(source).not.toContain('bg-[#0d1b2a]/48');
        expect(source).not.toContain('bg-white/44');
        expect(source).not.toContain('shadow-sm');
        expect(source).not.toContain('shadow-2xl backdrop-blur-md');
    });

    it('keeps dashboard status accents on the Bambook blue-gray contract', () => {
        const source = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8');
        const cognitionMetricSource = source.slice(
            source.indexOf('>Cognition</span>'),
            source.indexOf('>Production</span>')
        );
        const productionMetricSource = source.slice(
            source.indexOf('>Production</span>'),
            source.indexOf('>Critical Analysis</span>')
        );
        const criticalMetricSource = source.slice(
            source.indexOf('>Critical Analysis</span>'),
            source.indexOf('{/* CENTER SPACER')
        );
        const statusSource = source.slice(
            source.indexOf('{/* Legend / Status Panel'),
            source.indexOf('{/* Active Pipeline Value')
        );
        const pipelineSource = source.slice(
            source.indexOf('Pipeline Value'),
            source.indexOf('{/* 3D Switching Velocity Hub')
        );

        expect(DASHBOARD_PIPELINE_TREND_POSITIVE_CLASS).toBe('text-os-adaptive-brand');
        expect(DASHBOARD_PIPELINE_TREND_NEGATIVE_CLASS).toBe('text-os-adaptive-subtitle');
        expect(pipelineSource).not.toContain('text-emerald-500');
        expect(pipelineSource).toContain('trendValue >= 0 ? DASHBOARD_PIPELINE_TREND_POSITIVE_CLASS : DASHBOARD_PIPELINE_TREND_NEGATIVE_CLASS');
        expect(DASHBOARD_QUIET_ICON_DARK_CLASS).toBe('text-os-adaptive-subtitle');
        expect(DASHBOARD_QUIET_ICON_LIGHT_CLASS).toBe('text-os-adaptive-subtitle');
        expect(DASHBOARD_REFRESH_ICON_DARK_CLASS).toContain(DASHBOARD_QUIET_ICON_DARK_CLASS);
        expect(DASHBOARD_REFRESH_ICON_LIGHT_CLASS).toContain(DASHBOARD_QUIET_ICON_LIGHT_CLASS);
        expect(source).not.toContain('const dashboardQuietIconClass');
        expect(source).not.toContain('className={dashboardQuietIconClass}');
        expect(source).toContain('isDarkMode ? DASHBOARD_REFRESH_ICON_DARK_CLASS : DASHBOARD_REFRESH_ICON_LIGHT_CLASS');
        expect(source).toContain('className={dashboardCardLabelClass}>Cognition');
        expect(cognitionMetricSource).toContain("{cognitionView === 'nodes' ? 'Active Nodes' : 'High Priority'}");
        expect(cognitionMetricSource).toContain('bg-[var(--os-vnext-brand-blue)]');
        expect(source).toContain('className={dashboardCardLabelClass}>Production');
        expect(productionMetricSource).toContain("{productionView === 'threads' ? 'Active Lines' : productionView === 'factories' ? 'Production Bases' : 'Live Orders'}");
        expect(productionMetricSource).toContain('bg-[var(--os-vnext-brand-blue)]');
        expect(source).toContain('${DASHBOARD_RAISED_CARD_CLASS} ${DASHBOARD_ACCENT_CARD_CLASS} flex flex-col justify-between flex-1 h-full transition-all duration-300');
        expect(source).toContain('className={dashboardCardLabelClass}>Critical Analysis');
        expect(criticalMetricSource).toContain("{criticalView === 'production' ? 'Line Blocks' : criticalView === 'logistics' ? 'Delay Risks' : 'Unread Inbox'}");
        expect(criticalMetricSource).toContain('bg-[var(--os-vnext-brand-blue)]');
        expect(criticalMetricSource).not.toContain('bambook-dashboard-danger-accent');
        expect(criticalMetricSource).not.toContain('animate-pulse');
        expect(criticalMetricSource).not.toContain('animate-ping');
        expect(criticalMetricSource).not.toContain("data-ui-lab-wallpaper-contrast={alertCount > 0 ? undefined : 'muted'}");
        expect(criticalMetricSource).not.toContain("isDarkMode ? 'text-slate-500' : 'text-slate-400'");
        expect(source).not.toContain('shadow-[0_0_');
        expect(source).not.toContain('boxShadow: s.glow');
        expect(statusSource).toContain('className={`${dashboardCardLabelClass} mb-3 block pb-2`}>Status Index');
        expect(statusSource).toContain('className="space-y-3"');
        expect(statusSource).toContain('text-os-adaptive-subtitle');
        expect(statusSource).toContain('className="text-[13px] font-light tabular-nums text-os-adaptive-subtitle"');
    });

    it('does not clip the market glass edge inside its height wrapper', () => {
        const source = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8');
        const marketWrapperSource = source.slice(
            source.indexOf('const dashboardMarketHubClass'),
            source.indexOf('{/* BOTTOM HUD')
        );

        expect(source).toContain("'h-full min-h-0 overflow-visible transition-all duration-300'");
        expect(source).not.toContain('hover:-translate-y-1');
        expect(marketWrapperSource).toContain('className={dashboardMarketHubClass}');
        expect(marketWrapperSource).not.toContain('h-[200px]');
        expect(marketWrapperSource).not.toContain('h-[200px] overflow-hidden');
    });

    it('lifts the globe command center components away from the bottom edge', () => {
        const source = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8');

        expect(DASHBOARD_GLOBE_HUD_FRAME_CLASS).toBe('max-w-[1680px] w-full mx-auto px-4');
        expect(DASHBOARD_HUD_ROOT_CLASS).toContain(DASHBOARD_GLOBE_HUD_FRAME_CLASS);
        expect(DASHBOARD_HUD_ROOT_CLASS).toContain(DASHBOARD_HUD_TOP_INSET_CLASS);
        expect(DASHBOARD_HUD_BOTTOM_INSET_CLASS).toBe('pb-[14px]');
        expect(DASHBOARD_HUD_ROOT_CLASS).toContain(DASHBOARD_HUD_BOTTOM_INSET_CLASS);
        expect(DASHBOARD_GLOBE_STAGE_CLASS).toContain('items-end');
        expect(DASHBOARD_GLOBE_STAGE_CLASS).toContain('gap-1 lg:gap-1.5');
        expect(DASHBOARD_GLOBE_STAGE_CLASS).toContain('pt-3');
        expect(DASHBOARD_GLOBE_STAGE_CLASS).not.toContain('-translate-y-6');
        expect(DASHBOARD_GLOBE_BOTTOM_CLASS).toContain('h-[155px]');
        expect(DASHBOARD_GLOBE_BOTTOM_CLASS).not.toContain('-translate-y-6');
        expect(source).toContain("gridTemplateColumns: 'repeat(12, minmax(0, 1fr))'");
        expect(source).toContain("gridTemplateRows: 'minmax(0, 1fr) minmax(176px, clamp(176px, 23vh, 210px))'");
        expect(source).toContain(": 'dashboard-spatial-stage col-span-12 row-start-1 grid grid-cols-12 grid-rows-2 gap-1.5 min-h-0 items-stretch';");
        expect(source).toContain(": 'dashboard-spatial-bottom col-span-12 row-start-2 grid grid-cols-12 gap-1.5 min-h-0 items-stretch';");
        expect(DASHBOARD_GLOBE_BOTTOM_CLASS).toContain('gap-1 lg:gap-1.5');
        expect(source).toContain("'dashboard-spatial-left col-start-1 col-span-4 row-start-1 row-span-2 grid grid-cols-2 grid-rows-[minmax(0,0.82fr)_minmax(0,1fr)] gap-1.5 min-h-0 min-w-0 self-end'");
        expect(source).toContain('col-start-5 col-span-2 row-start-1 min-w-0 ${DASHBOARD_RAISED_CARD_CLASS} p-5 flex flex-col justify-center gap-2 h-full transition-all duration-300');
        expect(source).toContain('col-start-2 row-start-2 min-w-0 ${DASHBOARD_RAISED_CARD_CLASS} p-0 flex flex-col h-full overflow-visible perspective-[1000px] transition-all duration-300');
        expect(source).toContain('col-start-7 col-span-6 row-start-1 min-w-0 w-full perspective-[1200px] h-full pointer-events-auto');
        expect(source).toContain('DASHBOARD_HUD_BOTTOM_INSET_CLASS');
        expect(source).toContain('${DASHBOARD_HUD_BOTTOM_INSET_CLASS}');
        expect(source).toContain("'dashboard-spatial-stage w-full h-full min-h-0 grid grid-cols-12 gap-1.5 items-stretch'");
        expect(source).toContain("'dashboard-spatial-stage col-span-12 row-start-1 grid grid-cols-12 grid-rows-2 gap-1.5 min-h-0 items-stretch'");
    });

    it('lets expanded dashboard top metrics shrink inside the remaining sidebar content width', () => {
        const source = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8');

        expect(DASHBOARD_GLOBE_MAX_WIDTH_PX).toBe(1680);
        expect(DASHBOARD_GLOBE_MAX_WIDTH_PX).toBeGreaterThan(DASHBOARD_EXPANDED_MAX_WIDTH_PX);
        expect(DASHBOARD_GLOBE_MAX_WIDTH_PX).toBeLessThan(1920);
        expect(DASHBOARD_GLOBE_HUD_FRAME_CLASS).toContain('max-w-[1680px]');
        expect(DASHBOARD_EXPANDED_HUD_FRAME_CLASS).toBe('max-w-[1130px] min-w-0 w-full mx-auto px-4');
        expect(source).toContain('const dashboardHeaderFrameClass = useExpandedDashboardLayout');
        expect(source).toContain('className={dashboardHeaderFrameClass}');
        expect(source).toContain('className="flex w-full flex-row flex-wrap justify-between items-center gap-4"');
        expect(source).not.toContain("max-w-[1680px] w-full mx-auto pointer-events-none");
        expect(source).not.toContain("p-4 pb-0 mt-[5px] max-w-[1130px]");
        expect(source).not.toContain('max-w-[1920px]');
        expect(DASHBOARD_EXPANDED_MAX_WIDTH_PX).toBe(1130);
        expect(DASHBOARD_EXPANDED_MIN_WIDTH_PX).toBe(0);
        expect(DASHBOARD_EXPANDED_METRIC_MIN_WIDTH_PX).toBe(0);
        expect(DASHBOARD_EXPANDED_AI_MIN_WIDTH_PX).toBe(340);
        expect(DASHBOARD_EXPANDED_MARKET_MIN_WIDTH_PX).toBe(460);
        expect(DASHBOARD_EXPANDED_STATUS_MIN_WIDTH_PX).toBe(220);
        expect(DASHBOARD_EXPANDED_PIPELINE_MIN_WIDTH_PX).toBe(300);
        expect(DASHBOARD_EXPANDED_VELOCITY_MIN_WIDTH_PX).toBe(560);
        expect(source).toContain('max-w-[1130px] min-w-0');
        expect(source).not.toContain('max-w-[1130px] min-w-[980px]');
        expect(source).not.toContain('grid-cols-[repeat(3,minmax(300px,1fr))]');
        expect(source).toContain('gridTemplateColumns: `repeat(3, minmax(${DASHBOARD_EXPANDED_METRIC_MIN_WIDTH_PX}px, 1fr))`');
        expect(source).toContain('<motion.div className={dashboardLeftClass} style={dashboardLeftStyle}>');
        expect(source).toContain('DASHBOARD_EXPANDED_AI_MIN_WIDTH_PX');
        expect(source).toContain('DASHBOARD_EXPANDED_MARKET_MIN_WIDTH_PX');
        expect(source).toContain('DASHBOARD_EXPANDED_STATUS_MIN_WIDTH_PX');
        expect(source).toContain('DASHBOARD_EXPANDED_PIPELINE_MIN_WIDTH_PX');
        expect(source).toContain('DASHBOARD_EXPANDED_VELOCITY_MIN_WIDTH_PX');
    });
});
