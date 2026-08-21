import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BAMBOOK_OS } from './ui/bambookOsTokens';

const source = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');

describe('Settings permission visibility', () => {
  it('hides AI-related settings tabs when chat permission is unavailable', () => {
    expect(source).toContain("hasPermission('ai:chat')");
    expect(source).toContain("tab.id !== 'ai' && tab.id !== 'voice'");
    expect(source).toContain('visibleTabs.map');
  });

  it('exposes device storage management without treating it as cloud sync', () => {
    expect(source).toContain("id: 'storage'");
    expect(source).toContain('getDeviceStorageReport');
    expect(source).toContain('clearBusinessCache');
    expect(source).toContain('clearEmailCache');
    expect(source).toContain('clearDevicePreferences');
    expect(source).toContain('业务主数据仍以数据中心为准');
  });

  it('splits account and system settings into route-level modes', () => {
    expect(source).toContain("mode?: 'account' | 'system'");
    expect(source).toContain("mode === 'account' ? 'account' : 'appearance'");
    expect(source).toContain("mode === 'account' ? '账号设置' : '系统设置'");
    expect(source).toContain("mode === 'account'");
    expect(source).toContain("tab.id !== 'account'");
    expect(source).not.toContain('SETTINGS_TARGET_TAB_EVENT');
    expect(source).not.toContain('consumeRequestedSettingsTab()');
  });

  it('uses the shared OS material and control tokens for page chrome', () => {
    expect(source).toContain("import {\n  CompiledSplitMainPanel,\n  CompiledSplitNavPanel,\n  CompiledSplitWorkspace,\n} from './ui/primitives/compiledPrimitives'");
    expect(source).toContain("import { BAMBOOK_OS } from './ui/bambookOsTokens'");
    expect(source).toContain('BAMBOOK_OS.material.nestedSurface');
    expect(source).toContain('bambook-outer-panel');
    expect(source).toContain('bg-[var(--recessed-bg)]');
    expect(source).toContain('const actionControlCls');
    expect(source).toContain('const optionActiveCls = `${SIDEBAR_ACTIVE_CLASS} text-[var(--text-primary)]`');
    expect(source).toContain('const optionIdleCls');
    expect(source).toContain('const settingsFrameClass = `${BAMBOOK_OS.layout.desktopWorkspaceFrameClass} bambook-settings-frame`');
    expect(source).toContain('bambook-settings-frame');
    expect(source).toContain('bambook-settings-nav-panel');
    expect(source).toContain('<PageHeader');
    expect(source).toContain("title={mode === 'account' ? '账号设置' : '系统设置'}");
    expect(source).toContain('panelRowClassName: `${BAMBOOK_OS.layout.desktopPanelRowClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass}`');
    expect(source).toContain('className="bambook-settings-nav-panel"');
    expect(source).toContain('<CompiledSplitNavPanel');
    expect(source).toContain('<CompiledSplitMainPanel');
    expect(source).toContain('scrollRef={settingsScrollRef}');
    expect(source).toContain('<CompiledSplitWorkspace');
    expect(source).toContain('BAMBOOK_OS.layout.desktopAccountSettingsContentStackClass');
    expect(source).toContain('BAMBOOK_OS.layout.desktopSettingsContentStackClass');
    expect(source).not.toContain('items-end pb-3');
    expect(source).not.toContain('className="w-full h-full flex flex-col min-h-0 overflow-hidden"');
    expect(source).not.toContain('className="w-52 md:w-56 shrink-0 bambook-settings-nav-panel"');
    expect(source).not.toContain('className="h-full min-h-0 overflow-y-auto custom-scrollbar p-6 md:p-8"');
    expect(source).not.toContain('data-os-lab-bleed-frame');
    expect(BAMBOOK_OS.layout.desktopPageFrameClass).toContain('overflow-visible');
    expect(BAMBOOK_OS.layout.desktopPanelRowClass).toContain('overflow-visible');
    expect(BAMBOOK_OS.layout.desktopPanelRowClass).toContain('bambook-main-panel-bottom-inset');
    expect(BAMBOOK_OS.layout.desktopPanelRowClass).not.toContain('overflow-hidden');
    expect(BAMBOOK_OS.layout.desktopTitleBarHeight).toBe(56);
    expect(BAMBOOK_OS.layout.desktopTitleToPanelGap).toBe(0);
    expect(BAMBOOK_OS.layout.desktopMainPanelTopInset).toBe(56);
    expect(BAMBOOK_OS.layout.desktopMainPanelBottomInset).toBe(34);
    expect(BAMBOOK_OS.layout.desktopMainPanelBottomLift).toBe(18);
    expect(BAMBOOK_OS.layout.desktopSplitNavPanelClass).toBe('w-52 md:w-56 shrink-0');
    expect(BAMBOOK_OS.layout.desktopSplitMainPanelClass).toBe('flex-1 min-h-0');
    expect(BAMBOOK_OS.layout.desktopMainScrollViewportClass).toBe('h-full min-h-0 overflow-y-auto custom-scrollbar p-6 md:p-8');
    expect(BAMBOOK_OS.layout.panelShadowViewportClass).toBe('bambook-panel-shadow-viewport');
  });

  it('renders boolean settings as BDS switches instead of segmented pills', () => {
    expect(source).toContain('const switchCls = (checked: boolean) => `bds-switch');
    expect(source).toContain("${checked ? 'on' : ''}");
    expect(source).not.toContain('border-[#7DB7FF]/20 bg-[rgba(74,144,226,0.30)]');
    expect(source).not.toContain('border-[#126DCC]/18 bg-[rgba(74,144,226,0.24)]');
    expect(source).not.toContain('inset_0_0_0_1px_rgba(255,255,255,0.018)');
    expect(source).not.toContain('inset_0_0_0_1px_rgba(255,255,255,0.08)');
    expect(source).not.toContain('const switchSliderCls');
    expect(source).not.toContain('const switchControlCls');
    expect(source).toContain('className={switchCls(isProductionGlobeEnabled)}');
    expect(source).toContain('className={switchCls(devOptions.comingSoonOverlay)}');
    expect(source).not.toContain('isLightEffectsEnabled');
    expect(source).not.toContain('const switchStatesCls');
    expect(source).not.toContain('const switchStateCls');
    expect(source).not.toContain('const switchStatesCls = \'absolute inset-0 z-10 grid grid-cols-2 items-center\'');
    expect(source).not.toContain('<span className={switchStateCls(!isProductionGlobeEnabled)}>关</span>');
    expect(source).not.toContain('<span className={switchStateCls(isProductionGlobeEnabled)}>开</span>');
    expect(source).not.toContain('<span className={switchStateCls(!localConfig.dataMasking)}>关</span>');
    expect(source).not.toContain('<span className={switchStateCls(Boolean(localConfig.dataMasking))}>开</span>');
  });

  it('preserves the current theme mode when saving non-theme settings', () => {
    expect(source).toContain("const currentThemeModeRef = useRef<SystemConfig['themeMode']>(config.themeMode);");
    expect(source).toContain('currentThemeModeRef.current = config.themeMode;');
    expect(source).toContain('const newConfig = { ...localConfig, [field]: value };');
    expect(source).toContain("if (field === 'themeMode') {");
    expect(source).toContain("currentThemeModeRef.current = value as SystemConfig['themeMode'];");
    expect(source).toContain('newConfig.themeMode = currentThemeModeRef.current;');
    expect(source).toContain("onClick={() => handleUpdate('enableProductionGlobe', !isProductionGlobeEnabled)}");
  });

  it('renders built-in wallpaper previews through the public asset resolver', () => {
    expect(source).toContain("import { resolvePublicAssetUrl } from '../utils/publicAssets'");
    expect(source).toContain('style={{ backgroundImage: `url(${resolvePublicAssetUrl(preset.url)})` }}');
    expect(source).toContain('style={{ backgroundImage: `url(${resolvePublicAssetUrl(localConfig.backgroundImage)})` }}');
  });

  it('uses packaged default wallpapers without admin editing controls', () => {
    const typeSource = readFileSync(new URL('../types.ts', import.meta.url), 'utf8');

    expect(typeSource).toContain('systemWallpaperOptions?: WallpaperOption[]');
    expect(source).toContain('const PACKAGED_WALLPAPER_URL_BY_ID');
    expect(source).toContain('getPackagedWallpaperUrl(option)');
    expect(source).toContain('normalizeWallpaperOptions(localConfig.systemWallpaperOptions)');
    expect(source).toContain("PACKAGED_WALLPAPER_URL_BY_ID[decodeURIComponent(match[1])]");
    expect(source).toContain("const WALLPAPER_GROUP_ORDER = ['极简', '自然', '城市', '动漫', '纯色']");
    expect(source).not.toContain("id: 'image-0076aswb'");
    expect(source).not.toContain("id: 'wallhaven-0qkg1q'");
    expect(source).toContain('DEFAULT_WALLPAPER_PREVIEW_LIGHT_STYLE');
    expect(source).toContain('rgba(213,229,242,0.34)');
    expect(source).toContain('linear-gradient(135deg, #DDE8F2 0%, #CFDEEC 48%, #BCCFE1 100%)');
    expect(source).not.toContain('linear-gradient(135deg, #F1F6FA 0%, #E8F3FF 48%, #DCEBFA 100%)');
    expect(source).toContain('DEFAULT_WALLPAPER_PREVIEW_DARK_STYLE');
    expect(source).toContain('rgba(64,92,126,0.17)');
    expect(source).toContain('circle at 94% 12%');
    expect(source).toContain('circle at 8% 92%');
    expect(source).toContain('linear-gradient(135deg, #070D15 0%, #0B111B 46%, #050A11 100%)');
    expect(source).not.toContain('linear-gradient(135deg, #0a1628 0%, #0f2340 48%, #07111f 100%)');
    expect(source).toContain('isDarkMode ? DEFAULT_WALLPAPER_PREVIEW_DARK_STYLE : DEFAULT_WALLPAPER_PREVIEW_LIGHT_STYLE');
    expect(source).toContain('WALLPAPER_CURATED_GROUPS');
    expect(source).toContain('getWallpaperGroupRank(a.group) - getWallpaperGroupRank(b.group)');
    expect(source).not.toContain('data-testid="owner-wallpaper-admin-controls"');
    expect(source).not.toContain('data-testid="wallpaper-option-editor"');
    expect(source).not.toContain('编辑壁纸选项');
    expect(source).not.toContain('addWallpaperOption');
    expect(source).not.toContain('removeWallpaperOption');
    expect(source).not.toContain('owner-only-wallpaper-manager');
    expect(source).not.toContain('unlink');
    expect(source).not.toContain('fs.rm');
    expect(source).not.toContain('child_process');
  });

  it('lets users upload a circular account avatar and persists it through auth profile', () => {
    expect(source).toContain('createCircularAvatarDataUrl');
    expect(source).toContain("canvas.toDataURL('image/webp', 0.86)");
    expect(source).toContain('ctx.arc(AVATAR_OUTPUT_SIZE / 2');
    expect(source).toContain('updateMyProfile({ avatarUrl })');
    expect(source).toContain('updateMyProfile({ avatarUrl: null })');
    expect(source).toContain('accept="image/*"');
    expect(source).toContain('avatarUrl={user?.avatarUrl}');
    expect(source).toContain('group-hover/avatar:opacity-100');
    expect(source).toContain('aria-label="编辑头像"');
    expect(source).toContain('<Pencil size={14}');
    expect(source).toContain('aria-label="头像裁切框"');
    expect(source).toContain('onPointerMove={handleAvatarCropPointerMove}');
    expect(source).toContain('value={avatarCrop.scale}');
    expect(source).toContain('<RotateCw size={14}');
    expect(source).toContain('confirmAvatarCrop');
    expect(source).toContain('触碰头像后点击右下角编辑按钮');
    expect(source).not.toContain("avatarLoading ? '处理中...' : '上传圆形头像'");
    expect(source).toContain('所有场景统一圆形显示');
  });
});
