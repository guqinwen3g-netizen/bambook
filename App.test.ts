import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('App light background tone', () => {
  it('uses a lightly tinted OS background instead of a near-white base', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    // 根背景色已 token 化（bg-app-light/bg-app-dark 语义类，定义于 tailwind.config + os-vnext.css）
    expect(source).toContain("bg-app-light");
    expect(source).toContain("bg-app-dark");
    expect(source).toContain("linear-gradient(135deg, #EEF2F6 0%, #D8DEE7 48%, #AEB9C8 100%)");
    expect(source).toContain("bg-white/20");
    expect(source).not.toContain("bg-[#EEF5FA]");
    expect(source).not.toContain("bg-[#F5F8FA]");
  });

  it('retires viewport glass masks so page-owned scroll masks do not double blur', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('ProgressiveBlurMask');
    expect(source).not.toContain('showMainGlassMasks');
    expect(source).not.toContain('showMainGlassMasks && !orderFullscreenOpen');
    expect(source).not.toContain('relationsFullscreenOpen');
    expect(source).not.toContain('onFullscreenOpenChange={setRelationsFullscreenOpen}');
  });

  it('keeps the dev preview in place across unavoidable full reloads', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain("DEV_PREVIEW_CONTINUITY_KEY = 'bambook_dev_preview_continuity'");
    expect(source).toContain('shouldUseDevPreviewContinuity()');
    expect(source).toContain('const storedAuthState = getAuthState()');
    expect(source).toContain('return { ...storedAuthState, isLoading: false, isAuthenticated: true }');
    expect(source).toContain('!uiState.hasVisited && !shouldUseDevPreviewContinuity()');
    expect(source).toContain("window.addEventListener('beforeunload', markPreviewContinuity)");
    expect(source).toContain('if (keepCurrentPreview && next.isLoading && authStateRef.current.isAuthenticated && authStateRef.current.user) return');
  });

  it('renders the main shell and globe immediately under the transparent splash logo', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<SplashScreen isVisible={isLoading} isDarkMode={isDarkMode} />');
    expect(source).toContain("type GlobeRendererMode = 'maplibre' | 'three'");
    expect(source).toContain("return value === 'three' ? 'three' : 'maplibre'");
    expect(source).toContain("const mapLibreProductionGlobeImport = initialGlobeRenderer === 'maplibre'");
    expect(source).toContain("import('./components/MapLibreProductionGlobe')");
    expect(source).toContain("const productionGlobeImport = initialGlobeRenderer === 'three'");
    expect(source).toContain('productionGlobeImport?.then(module => module.preloadProductionGlobeAssets())');
    expect(source).toContain('const ProductionGlobe = lazy(() => productionGlobeImport ?? import');
    expect(source).toContain('const MapLibreProductionGlobe = lazy(() => mapLibreProductionGlobeImport ?? import');
    expect(source).toContain("globeRenderer=maplibre|three");
    expect(source).toContain("globeParams.renderer === 'maplibre' && !mapLibreGlobeUnavailable");
    expect(source).toContain('accentPalette={wallpaperAccentPalette}');
    expect(source).toContain('onRuntimeError={() => setMapLibreGlobeUnavailable(true)}');
    expect(source).toContain('initialDelay={0}');
    expect(source).toContain('overflow-hidden opacity-100');
    expect(source).not.toContain("lazy(() => import('./components/ProductionGlobe'))");
    expect(source).not.toContain('initialDelay={2500}');
    expect(source).not.toContain('opacity-0 translate-y-12 scale-95 blur-md');
    expect(source).not.toContain('delay-500');
  });

  it('normalizes saved public asset paths before rendering Electron file URLs', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain("import { resolvePublicAssetUrl } from './utils/publicAssets'");
    expect(source).toContain('backgroundImage: `url(${resolvedBackgroundImageUrl})`,');
  });

  it('hides native scrollbars globally while preserving scroll containers', () => {
    const globalCss = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
    const designSystemCss = readFileSync(new URL('./styles/design-system.css', import.meta.url), 'utf8');

    expect(globalCss).toContain('*::-webkit-scrollbar');
    expect(globalCss).toContain('scrollbar-width: none');
    expect(globalCss).toContain('-ms-overflow-style: none');
    expect(designSystemCss).toContain('.custom-scrollbar');
    expect(designSystemCss).toContain('.scrollbar-custom');
    expect(designSystemCss).toContain('.scrollbar-custom-dark');
    expect(`${globalCss}\n${designSystemCss}`).not.toContain('scrollbar-width: thin');
    expect(`${globalCss}\n${designSystemCss}`).not.toContain('width: 6px');
    expect(`${globalCss}\n${designSystemCss}`).not.toContain('height: 6px');
  });

  it('keeps UI Lab out of the product app shell', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const sidebarSource = readFileSync(new URL('./components/Sidebar.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("import UiLab from './components/UiLab'");
    expect(source).not.toContain('currentView === View.UiLab && <UiLab');
    expect(source).toContain('if (saved === View.UiLab) return View.Dashboard');
    expect(sidebarSource).not.toContain("label: 'UI 实验室'");
    expect(sidebarSource).not.toContain('Palette');
  });

  it('wires the production shell into the OS material token scope without inheriting UI Lab layout', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const osVnextCss = readFileSync(new URL('./styles/os-vnext.css', import.meta.url), 'utf8');
    const indexCss = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

    expect(source).toContain('className={`bambook-os-root ${isDarkMode ? \'bambook-os-root--dark\' : \'\'} flex h-screen');
    expect(source).not.toContain('className={`ui-lab-real-os-root');
    expect(osVnextCss).toContain('.bambook-os-root {');
    expect(osVnextCss).toContain('.bambook-os-root--dark {');
    expect(osVnextCss).toContain('.bambook-os-root .os-material-raised-card {\n  background-color: var(--ui-lab-panel-raised-film-color) !important');
    expect(osVnextCss).not.toContain('.bambook-os-root {\n  position: relative;');
    expect(indexCss).toContain('.bambook-os-root .bambook-shadow-sibling-stack > [data-glass-edge-mask].os-material-raised-card:not(.bambook-sibling-shadow-caster)');
    expect(indexCss).toContain('.bambook-os-root .bambook-sibling-shadow-caster.os-material-raised-card');
  });

  it('keeps the standalone UI Lab watcher from reacting to PWA-only edits', () => {
    const viteConfig = readFileSync(new URL('./vite.config.ts', import.meta.url), 'utf8');

    expect(viteConfig).toContain("process.env.BAMBOOK_UI_LAB_DEV === '1'");
    expect(viteConfig).toContain('watch: isUiLabDev');
    expect(viteConfig).toContain("'**/pwa/**'");
    expect(viteConfig).toContain("'**/public/sw.js'");
    expect(viteConfig).toContain("'**/public/manifest.webmanifest'");
    expect(viteConfig).toContain("'**/public/pwa-icon.svg'");
  });

  it('redirects away from a saved or direct view when current account lacks permission', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('canAccessView(currentView)');
    expect(source).toContain('setCurrentView(View.Dashboard)');
    expect(source).toContain('if (!canAccessView(currentView))');
  });

  it('renders account settings and system settings as separate full-bleed pages', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('View.AccountSettings');
    expect(source).toContain('View.SystemSettings');
    expect(source).toContain('resolveSettingsMode(activeView)');
    expect(source).toContain('{settingsMode && (');
    expect(source).toContain('mode={settingsMode}');
  });

  it('mounts mature UI Lab 2 compiler surfaces in the production shell by default', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain("import { CompiledDashboardPage }");
    expect(source).toContain("import { CompiledProductsPage }");
    expect(source).toContain("import { CompiledRelationsPage }");
    expect(source).toContain("import { CompiledSettingsPage }");
    expect(source).toContain("CompiledProductModuleSettingsWorkspace");
    expect(source).toContain("import { CompiledMainModuleSlot }");
    expect(source).toContain("import { CompiledSidebar }");
    expect(source).toContain('BAMBOOK_MAIN_COMPILER_SURFACES');
    expect(source).toContain('function readCompilerSurfaceFlags()');
    expect(source).toContain('BAMBOOK_MAIN_COMPILER_SURFACES.map(surface => [surface, shouldUseCompilerSurface(surface)])');
    expect(source).toContain('<CompiledSidebar');
    expect(source).not.toContain('allowedViews={MAIN_APP_UI_LAB_2_SIDEBAR_VIEWS}');
    expect(source).toContain('<CompiledDashboardPage');
    expect(source).toContain('<CompiledRelationsPage');
    expect(source).toContain('<CompiledProductsPage');
    expect(source).toContain('<CompiledProductModuleSettingsWorkspace');
    expect(source).toContain('<CompiledSettingsPage');
    expect(source).toContain('<CompiledMainModuleSlot pageId={pageId}');
  });

  it('transfers the accepted UI Lab 2 product module settings workspace into the main products page', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const workspaceSource = readFileSync(new URL('./components/ui/osCompiler/compiledProductModuleSettingsTemplates.tsx', import.meta.url), 'utf8');

    expect(workspaceSource).toContain("template: 'CompiledProductModuleSettingsWorkspace'");
    expect(workspaceSource).toContain("provenance: 'accepted'");
    expect(source).toContain('const [productModuleSettings, setProductModuleSettings] = useState<UiLabProductModuleSettings>(readInitialProductModuleSettings)');
    expect(source).toContain('const [isProductModuleSettingsWorkspaceOpen, setIsProductModuleSettingsWorkspaceOpen] = useState(false)');
    expect(source).toContain('persistProductModuleSettings(nextSettings)');
    expect(source).toContain('if (currentView !== View.Products)');
    expect(source).toContain('setIsProductModuleSettingsWorkspaceOpen(false)');
    expect(source).toContain('isProductModuleSettingsWorkspaceOpen\n                    ? (\n                      <CompiledProductModuleSettingsWorkspace');
    expect(source).toContain('onUpdateModuleSettings={handleUpdateProductModuleSettings}');
    expect(source).toContain('data-main-app-module-settings-fab');
    expect(source).toContain('source="MainApp.productSettingsFab"');
  });

  it('keeps explicit compiler fallback and global opt-in switches for production preview', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const registrySource = readFileSync(new URL('./components/moduleRegistry.ts', import.meta.url), 'utf8');

    expect(registrySource).toContain("'sidebarCompiler'");
    expect(registrySource).toContain("'dashboardCompiler'");
    expect(registrySource).toContain("'relationsCompiler'");
    expect(registrySource).toContain("'productsCompiler'");
    expect(registrySource).toContain("'settingsCompiler'");
    expect(registrySource).toContain("'assistantCompiler'");
    expect(registrySource).toContain("'developmentCompiler'");
    expect(registrySource).toContain("'dataCenterCompiler'");
    expect(registrySource).toContain("'ordersCompiler'");
    expect(registrySource).toContain("'emailsCompiler'");
    expect(registrySource).toContain("'businessToolsCompiler'");
    expect(registrySource).toContain("'adminPanelCompiler'");
    expect(source).toContain('getCompilerSurfaceConfig(surface)');
    expect(source).toContain("params.get('mainCompiler')");
    expect(source).toContain("localStorage.setItem(compilerConfig.storageKey, '0')");
    expect(source).toContain("localStorage.setItem(compilerConfig.storageKey, '1')");
  });

  it('routes remaining production views through compiler-owned main module slots', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const templateSource = readFileSync(new URL('./components/ui/osCompiler/compiledMainModuleTemplates.tsx', import.meta.url), 'utf8');

    expect(templateSource).toContain('export const compileMainModuleSlot');
    expect(templateSource).toContain("template: 'CompiledMainModuleSlot'");
    expect(templateSource).toContain("layoutMode: 'preserve-current-pixels'");
    expect(templateSource).toContain("provenance: 'provisional'");
    expect(templateSource).toContain('data-os-compiler-role="main-module-slot"');
    expect(templateSource).toContain("className = 'contents'");

    expect(source).toContain("renderMainCompilerSlot(\n                compilerSurfaces.assistant,\n                'assistant'");
    expect(source).toContain("renderMainCompilerSlot(\n              compilerSurfaces.development,\n              'development'");
    expect(source).toContain("renderMainCompilerSlot(\n              compilerSurfaces.dataCenter,\n              'data-center'");
    expect(source).toContain("renderMainCompilerSlot(\n                compilerSurfaces.orders,\n                orderType === 'garment' ? 'garment-orders' : orderType === 'other' ? 'other-orders' : 'fabric-orders'");
    expect(source).toContain("renderMainCompilerSlot(\n              compilerSurfaces.emails,\n              'emails'");
    expect(source).toContain("renderMainCompilerSlot(\n              compilerSurfaces.businessTools,\n              'business-tools'");
    expect(source).toContain("renderMainCompilerSlot(\n              compilerSurfaces.adminPanel,\n              'admin-panel'");
  });

  it('passes the company data-center endpoint into the data twin layout page', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<DataCenter isDarkMode={isDarkMode} dataCenterEndpoint={config.cloudEndpoint} />');
  });

  it('starts every explicit login on the dashboard instead of the last saved page', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const loginSource = source.slice(
      source.indexOf('onLogin={(user) => {'),
      source.indexOf('onGoRegister=', source.indexOf('onLogin={(user) => {')),
    );

    expect(loginSource).toContain('storageService.saveUIState({ currentView: View.Dashboard })');
    expect(loginSource).toContain('setCurrentView(View.Dashboard)');
    expect(loginSource).toContain('setAuthState({ user, isLoading: false, isAuthenticated: true })');
  });
});
