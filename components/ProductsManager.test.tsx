import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_CATEGORY_CARD_GRID_CLASS,
  PRODUCT_CARD_CLASS,
  PRODUCT_CARD_DARK_CLASS,
  PRODUCT_CARD_GRID_CLASS,
  PRODUCT_CARD_LAYOUT_TRANSITION,
  PRODUCT_CARD_LIGHT_CLASS,
  PRODUCT_CARD_SPOTLIGHT_DARK_COLOR,
  PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR,
  PRODUCT_DETAIL_BODY_SCROLL_CLASS,
  PRODUCT_DETAIL_HEADER_LAYOUT_CLASS,
  PRODUCT_DETAIL_ITEM_CLASS,
  PRODUCT_DETAIL_MAIN_PANEL_CLASS,
  PRODUCT_DETAIL_MEDIA_FRAME_CLASS,
  PRODUCT_DETAIL_MEDIA_META_CLASS,
  PRODUCT_DETAIL_MEDIA_PANEL_CLASS,
  PRODUCT_DETAIL_PANEL_CONTENT_CLASS,
  PRODUCT_DETAIL_PANEL_LAYOUT_CLASS,
  PRODUCT_DETAIL_STATUS_PANEL_CLASS,
  PRODUCT_EDGE_FADE_BOTTOM_HEIGHT,
  PRODUCT_EDGE_FADE_TOP_HEIGHT,
  PRODUCT_EDGE_FADE_TOP_START,
  PRODUCT_FORM_FIELD_DARK_CLASS,
  PRODUCT_FORM_FIELD_LIGHT_CLASS,
  PRODUCT_FORM_LABEL_DARK_CLASS,
  PRODUCT_FORM_LABEL_LIGHT_CLASS,
  PRODUCT_FORM_MAP_INDEX_DARK_CLASS,
  PRODUCT_FORM_MAP_INDEX_LIGHT_CLASS,
  PRODUCT_FORM_SECTION_TITLE_DARK_CLASS,
  PRODUCT_FORM_SECTION_TITLE_LIGHT_CLASS,
  PRODUCT_TABLE_CELL_BORDER_DARK_CLASS,
  PRODUCT_TABLE_CELL_BORDER_LIGHT_CLASS,
  PRODUCT_TABLE_HEADER_DARK_CLASS,
  PRODUCT_TABLE_HEADER_LIGHT_CLASS,
  PRODUCT_TABLE_ROW_HOVER_DARK_CLASS,
  PRODUCT_TABLE_ROW_HOVER_LIGHT_CLASS,
  PRODUCT_SUB_INDEX_PANEL_CLASS,
  PRODUCT_SUB_INDEX_ROW_CLASS,
  PRODUCT_TITLE_ACTION_BUTTON_CLASS,
  PRODUCT_TITLE_BAR_CLASS,
  PRODUCT_TITLE_ICON_BUTTON_CLASS,
  PRODUCT_TITLE_PAGE_LABEL_CLASS,
  PRODUCT_TITLE_SAFE_LEFT_STYLE,
  PRODUCT_TOOLBAR_AMBIENT_CLASS,
  PRODUCT_TOOLBAR_CLASS,
  PRODUCT_TOOLBAR_CONTENT_CLASS,
  PRODUCT_TOOLBAR_SEARCH_DARK_CLASS,
  PRODUCT_TOOLBAR_SEARCH_LIGHT_CLASS,
  PRODUCT_TOOLBAR_SURFACE_DARK_CLASS,
  PRODUCT_TOOLBAR_SURFACE_LIGHT_CLASS,
} from './ProductsManager';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';
import {
  RELATIONS_FORM_NESTED_ROW_DARK_CLASS,
  RELATIONS_FORM_NESTED_ROW_LIGHT_CLASS,
  RELATIONS_FORM_MAP_PANEL_CLASS,
  RELATIONS_FORM_PANEL_CLASS,
  RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING,
  RELATIONS_FORM_QUIET_ACTION_DARK_CLASS,
  RELATIONS_FORM_QUIET_ACTION_LIGHT_CLASS,
  RELATIONS_TITLE_SAFE_LEFT_STYLE,
} from './RelationsManager';

const productsSource = readFileSync(new URL('./ProductsManager.tsx', import.meta.url), 'utf8');
const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const osVnextCss = readFileSync(new URL('../styles/os-vnext.css', import.meta.url), 'utf8');

describe('ProductsManager Bambook OS tokens', () => {
  it('uses the shared title and toolbar control recipes', () => {
    expect(PRODUCT_TITLE_BAR_CLASS).toContain('h-14');
    expect(PRODUCT_TITLE_BAR_CLASS).toBe(BAMBOOK_OS.layout.desktopTitleBarWithInsetClass);
    expect(PRODUCT_TITLE_SAFE_LEFT_STYLE).toBe(BAMBOOK_OS.layout.desktopTitleSafeLeftStyle);
    expect(PRODUCT_TITLE_ICON_BUTTON_CLASS).toBe(BAMBOOK_OS.controls.title.iconButton);
    expect(PRODUCT_TITLE_ACTION_BUTTON_CLASS).toBe(BAMBOOK_OS.controls.title.actionButton);
    expect(PRODUCT_TITLE_PAGE_LABEL_CLASS).toBe(BAMBOOK_OS.controls.title.pageLabel);

    expect(PRODUCT_TOOLBAR_CLASS).toBe(BAMBOOK_OS.controls.toolbar.base);
    expect(PRODUCT_TOOLBAR_CONTENT_CLASS).toBe(BAMBOOK_OS.controls.toolbar.content);
    expect(PRODUCT_TOOLBAR_AMBIENT_CLASS).toBe(BAMBOOK_OS.controls.toolbar.ambient);
    expect(PRODUCT_TOOLBAR_SURFACE_DARK_CLASS).toBe(BAMBOOK_OS.controls.toolbar.surfaceDark);
    expect(PRODUCT_TOOLBAR_SURFACE_LIGHT_CLASS).toBe(BAMBOOK_OS.controls.toolbar.surfaceLight);
    expect(PRODUCT_TOOLBAR_SEARCH_DARK_CLASS).toBe(BAMBOOK_OS.controls.toolbar.searchDark);
    expect(PRODUCT_TOOLBAR_SEARCH_LIGHT_CLASS).toBe(BAMBOOK_OS.controls.toolbar.searchLight);
  });

  it('adapts direct-on-wallpaper product title navigation and actions', () => {
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary"');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary" className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} ${isDarkMode ? \'text-white/70\' : \'text-slate-700\'}`}');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="secondary" className={PRODUCT_TITLE_SEPARATOR_CLASS}');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary"\n                  className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS}');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary" className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS}');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary" className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2');
    expect(productsSource).not.toContain('<ChevronLeft size={18} strokeWidth={1} className={isDarkMode ?');
  });

  it('keeps OS title bars full-width while constraining product content canvases', () => {
    expect(productsSource).toContain("const productContentCanvasClass = isMobile ? 'w-full' : BAMBOOK_OS.layout.desktopPageCanvasClass;");
    expect(productsSource).toContain('style={PRODUCT_TITLE_SAFE_LEFT_STYLE}');
    expect(productsSource).toContain('<div className="w-full h-full flex flex-col bg-transparent overflow-visible">');
    expect(productsSource).toContain("<div className={`${productContentCanvasClass} flex-1 overflow-visible ${hideUnderlyingProductPage ? 'hidden' : ''}`}>");
    expect(productsSource).toContain("className={isMobile ? 'h-full overflow-visible px-3 pb-24 pt-5' : BAMBOOK_OS.layout.desktopTablePanelShellCompactClass}");
    expect(productsSource).toContain('className={BAMBOOK_OS.layout.desktopTablePanelShellClass}');
    expect(productsSource).toContain('form="product-fullscreen-form"');
    expect(productsSource).toContain('<form id="product-fullscreen-form" onSubmit={editingProd ? handleEditProduct : handleAddProduct} className="w-full flex-1 min-h-0 px-5 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch">');
    expect(productsSource).not.toContain('className="max-w-[1130px] mx-auto w-full h-full min-h-0 px-8 pt-8 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-8 items-stretch"'); // legacy guard
    expect(productsSource).not.toContain('const productFormFadeBoundaryRef = useRef<HTMLDivElement | null>(null);');
    expect(productsSource).toContain('const productFormScrollRef = useRef<HTMLDivElement | null>(null);');
    expect(productsSource).toContain('scrollRef: productFormScrollRef');
    expect(productsSource).toContain('shadowCasterBottomHeight: 57');
    expect(productsSource).toContain('bottomFadeEndOffset: BAMBOOK_OS.layout.desktopMainPanelBottomInset');
    expect(productsSource).toContain('syncWheelScroll: true');
    expect(productsSource).not.toContain('boundaryRef: productFormFadeBoundaryRef');
    expect(productsSource).toContain('enabled: fullscreenProductFormOpen');
    expect(productsSource).not.toContain('scrollRef={productFormScrollRef}');
    expect(productsSource).not.toContain('productFormFadeBoundaryRef');
    expect(productsSource).not.toContain('bambook-form-fixed-edge-mask');
    expect(productsSource).not.toContain('bambook-form-edge-fade-frame');
    expect(productsSource).not.toContain('bambook-form-edge-fade bambook-form-edge-fade-top');
    expect(productsSource).not.toContain('bambook-form-edge-fade bambook-form-edge-fade-bottom');
    expect(productsSource).toContain('if (!fullscreenProductFormOpen) return;');
    expect(productsSource).toContain('document.body.style.overflow = \'hidden\';');
    expect(productsSource).toContain('document.body.style.overflow = prev;');
    expect(productsSource).toContain('className={`bambook-product-form-scroll-viewport min-w-0 -mt-[112px] h-[calc(100%+7rem)] overflow-y-auto overscroll-contain space-y-6 pt-24 pb-[176px] ${BAMBOOK_OS.layout.panelShadowViewportClass}`}');
    expect(productsSource).toContain('edgeFadeItem');
    expect(indexCss).toContain('.bambook-relation-form-scroll-viewport,\n.bambook-product-form-scroll-viewport');
    expect(indexCss).toContain('.bambook-product-form-scroll-viewport {\n        overflow-x: clip;');
  });

  it('aligns archive cards with the dashboard card material and spotlight system', () => {
    expect(PRODUCT_CATEGORY_CARD_GRID_CLASS).toContain('repeat(auto-fill,316px)');
    expect(PRODUCT_CARD_GRID_CLASS).toContain('repeat(auto-fill,300px)');
    expect(PRODUCT_CARD_CLASS).toContain('rounded-card-lg');
    expect(PRODUCT_CARD_DARK_CLASS).toBe(`${OS_MATERIAL.raisedCard} bambook-panel-glass`);
    expect(PRODUCT_CARD_LIGHT_CLASS).toBe(`${OS_MATERIAL.raisedCard} bambook-panel-glass`);
    expect(PRODUCT_CARD_DARK_CLASS).not.toContain('bambook-outer-panel');
    expect(PRODUCT_CARD_LIGHT_CLASS).not.toContain('bambook-outer-panel');
    expect(PRODUCT_SUB_INDEX_PANEL_CLASS).toContain(OS_MATERIAL.framePanel);
    expect(PRODUCT_SUB_INDEX_ROW_CLASS).toContain('h-[72px]');
    expect(PRODUCT_SUB_INDEX_ROW_CLASS).not.toContain('min-h-[72px]');
    expect(PRODUCT_CARD_LAYOUT_TRANSITION).toBe(BAMBOOK_OS.motion.layoutTransition);
    expect(PRODUCT_CARD_SPOTLIGHT_DARK_COLOR).toBe(BAMBOOK_OS.spotlight.cardDarkColor);
    expect(PRODUCT_CARD_SPOTLIGHT_LIGHT_COLOR).toBe(BAMBOOK_OS.spotlight.cardLightColor);
    expect(productsSource).toContain('<SpotlightCard');
    expect(productsSource).toContain('CompiledMotionInteractiveCard');
    expect(productsSource).toContain('const productGlassPanelClass = `${OS_MATERIAL.framePanel} bambook-panel-glass bambook-outer-panel`;');
    expect(productsSource).toContain('const productFloatingPanelClass = `${OS_MATERIAL.floatingOverlay} bambook-panel-glass`;');
    expect(productsSource).not.toContain("isDarkMode ? 'bambook-blue-white-surface bg-white/[0.015]' : 'bambook-blue-white-surface bg-white/20'");
    expect(productsSource).not.toContain('h-[420px]');
    expect(productsSource).not.toContain('rounded-[32px]');
    expect(PRODUCT_CARD_CLASS).not.toContain('backdrop-blur-[14px]');
    expect(productsSource).not.toContain('shadow-2xl backdrop-blur');
  });

  it('routes form fields, labels, inline panels, and tables through semantic tokens', () => {
    expect(PRODUCT_FORM_FIELD_DARK_CLASS).toBe(BAMBOOK_OS.controls.recessedField.dark);
    expect(PRODUCT_FORM_FIELD_LIGHT_CLASS).toBe(BAMBOOK_OS.controls.recessedField.light);
    expect(PRODUCT_FORM_LABEL_DARK_CLASS).toBe(BAMBOOK_OS.tone.text.formLabelDark);
    expect(PRODUCT_FORM_LABEL_LIGHT_CLASS).toBe(BAMBOOK_OS.tone.text.formLabelLight);
    expect(PRODUCT_FORM_SECTION_TITLE_DARK_CLASS).toBe('text-white/62');
    expect(PRODUCT_FORM_SECTION_TITLE_LIGHT_CLASS).toBe('text-slate-950');
    expect(PRODUCT_FORM_MAP_INDEX_DARK_CLASS).toBe(`${OS_MATERIAL.insetSurface} ${BAMBOOK_OS.tone.surface.formMapIndexDark}`);
    expect(PRODUCT_FORM_MAP_INDEX_LIGHT_CLASS).toBe(`${OS_MATERIAL.insetSurface} ${BAMBOOK_OS.tone.surface.formMapIndexLight}`);
    expect(productsSource).toContain('const productFormSectionTitleClass = isDarkMode ? PRODUCT_FORM_SECTION_TITLE_DARK_CLASS : PRODUCT_FORM_SECTION_TITLE_LIGHT_CLASS;');
    expect(productsSource).toContain('const productFormMapIndexClass = isDarkMode ? PRODUCT_FORM_MAP_INDEX_DARK_CLASS : PRODUCT_FORM_MAP_INDEX_LIGHT_CLASS;');
    expect(productsSource).toContain('<CompiledSurfacePanel materialRole="raisedCard" spotlight isDarkMode={isDarkMode} className={RELATIONS_FORM_MAP_PANEL_CLASS}>');
    expect(productsSource).toContain('${productFormSectionTitleClass}`}>Form Map</p>');
    expect(productsSource).toContain('w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-[10px] font-light transition-colors ${productFormMapIndexClass}`}>{idx + 1}</span>');
    expect(RELATIONS_FORM_PANEL_CLASS).toBe('scroll-mt-28 p-5 bambook-relations-form-panel');
    expect(RELATIONS_FORM_MAP_PANEL_CLASS).toBe('p-4 bambook-relations-form-map-panel');
    expect(RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING).toBe('width');
    expect(productsSource).toContain("} from './ui/relationsFormStyles';");
    expect(productsSource).toContain('className={RELATIONS_FORM_PANEL_CLASS}');
    expect(productsSource).toContain('className={RELATIONS_FORM_MAP_PANEL_CLASS}');
    expect(productsSource).toContain('spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}');
    expect(indexCss).toContain('background-color: var(--ui-lab-panel-glass-film-color) !important;');
    expect(indexCss).toContain('background-image: var(--ui-lab-panel-shared-glass-background) !important;');
    expect(indexCss).toContain('box-shadow: var(--ui-lab-panel-frame-inset-shadow) !important;');
    expect(indexCss).toContain('.bambook-relations-form-map-panel');
    expect(indexCss).toContain('.bambook-relations-form-panel .os-material-inset-surface');
    expect(indexCss).toContain('background-color: var(--ui-lab-form-panel-inset-film-color) !important;');
    expect(RELATIONS_FORM_NESTED_ROW_DARK_CLASS).toBe(OS_MATERIAL.insetSurface);
    expect(RELATIONS_FORM_NESTED_ROW_LIGHT_CLASS).toBe(OS_MATERIAL.insetSurface);
    expect(productsSource).toContain('const productFormNestedRowClass = isDarkMode ? RELATIONS_FORM_NESTED_ROW_DARK_CLASS : RELATIONS_FORM_NESTED_ROW_LIGHT_CLASS;');
    expect(productsSource).toContain('const productFormQuietActionClass = isDarkMode ? RELATIONS_FORM_QUIET_ACTION_DARK_CLASS : RELATIONS_FORM_QUIET_ACTION_LIGHT_CLASS;');
    expect(productsSource).toContain('rounded-inset border p-4 flex items-center ${productFormNestedRowClass}');
    expect(productsSource).toContain('rounded-inset border p-4 space-y-3 ${productFormNestedRowClass}');
    expect(productsSource).toContain('transition-all ${productFormQuietActionClass}');
    expect(productsSource).not.toContain("bg-slate-50/50 border-slate-100");
    expect(productsSource).not.toContain('className="scroll-mt-28 p-5 space-y-6"');
    expect(productsSource).not.toContain('contentClassName="relative z-10 space-y-6"');
    expect(productsSource).toContain('<h4 className={`text-xs font-light tracking-wide mb-4 ${isDarkMode ? PRODUCT_FORM_SECTION_TITLE_DARK_CLASS : PRODUCT_FORM_SECTION_TITLE_LIGHT_CLASS}`}>{title}</h4>');
    expect(productsSource).not.toContain('Archive Section');

    expect(PRODUCT_TABLE_HEADER_DARK_CLASS).toBe(BAMBOOK_OS.controls.table.headerDark);
    expect(PRODUCT_TABLE_HEADER_LIGHT_CLASS).toBe(BAMBOOK_OS.controls.table.headerLight);
    expect(PRODUCT_TABLE_ROW_HOVER_DARK_CLASS).toBe(BAMBOOK_OS.controls.table.rowHoverDark);
    expect(PRODUCT_TABLE_ROW_HOVER_LIGHT_CLASS).toBe(BAMBOOK_OS.controls.table.rowHoverLight);
    expect(PRODUCT_TABLE_CELL_BORDER_DARK_CLASS).toBe(BAMBOOK_OS.controls.table.cellBorderDark);
    expect(PRODUCT_TABLE_CELL_BORDER_LIGHT_CLASS).toBe(BAMBOOK_OS.controls.table.cellBorderLight);
    expect(productsSource).toContain('className="w-full table-fixed border-separate border-spacing-0 text-left text-xs"');
    expect(productsSource).not.toContain('className="w-full table-fixed text-left text-xs"');
  });

  it('aligns archive text inputs with the custom select trigger shell', () => {
    expect(productsSource).toContain('const productFieldShellClass =');
    expect(productsSource).toContain('rounded-full border outline-none');
    expect(productsSource).not.toContain('const productFieldShellClass = `rounded-2xl bambook-blue-white-light');
    expect(productsSource).toContain('const productInputClass = `w-full h-9 px-3 ${productFieldShellClass}');
    expect(productsSource).toContain('const productTextareaClass = `w-full px-3 py-3 ${productFieldShellClass}');
  });

  it('uses the shared content-mask scroll edge fade contract on archive scroll surfaces', () => {
    const mainViewStart = productsSource.indexOf("navLevel === 'main' && (");
    const mainViewSource = productsSource.slice(
      mainViewStart,
      productsSource.indexOf("navLevel === 'sub' && (", mainViewStart)
    );
    const edgeMaskHookSource = productsSource.slice(
      productsSource.indexOf('useGlassSurfaceEdgeMasks({'),
      productsSource.indexOf('const productTableScrollRef')
    );

    expect(PRODUCT_EDGE_FADE_TOP_HEIGHT).toBe(56);
    expect(PRODUCT_EDGE_FADE_TOP_START).toBe(0);
    expect(PRODUCT_EDGE_FADE_BOTTOM_HEIGHT).toBe(72);
    expect(productsSource).toContain('ScrollEdgeFades');
    expect(productsSource).toContain('renderMode="content-mask"');
    expect(productsSource).toContain('BAMBOOK_OS.layout.panelShadowViewportClass');
    expect(productsSource).toContain('${PRODUCT_CATEGORY_CARD_GRID_CLASS} ${BAMBOOK_OS.layout.panelShadowViewportClass} px-8 pt-[104px] pb-8');
    expect(productsSource).toContain('${PRODUCT_CARD_GRID_CLASS} ${BAMBOOK_OS.layout.panelShadowViewportClass} p-8');
    expect(productsSource).toContain('className="relative flex-1 min-h-0 overflow-visible"');
    expect(productsSource).not.toContain('bambook-edge-mask-parent-shadow');
    expect(productsSource).toContain('ref={subIndexScrollRef} className={`flex-1 min-h-0 overflow-y-scroll ${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-full-bleed-row-viewport`}');
    expect(productsSource).not.toContain('<div ref={subIndexScrollRef} className="flex-1 min-h-0 overflow-y-scroll">');
    expect(edgeMaskHookSource).toContain('scrollRef: productGridScrollRef');
    expect(edgeMaskHookSource).toContain("enabled: navLevel === 'list' && listDisplayMode === 'grid' && !isPdmlRawView");
    expect(edgeMaskHookSource).toContain('scrollRef: mainCategoryScrollRef');
    expect(edgeMaskHookSource).toContain("enabled: navLevel === 'main'");
    expect(edgeMaskHookSource).toContain('scrollRef: subIndexScrollRef');
    expect(edgeMaskHookSource).toContain("enabled: navLevel === 'sub'");
    expect(mainViewSource).not.toContain('<ScrollEdgeFades');
    expect(mainViewSource).toContain('ref={mainCategoryScrollRef}');
    expect(mainViewSource).toContain('data-glass-edge-mask');
  });

  it('renders explicit empty states for archive drill-down views instead of blank panels', () => {
    expect(productsSource).toContain('categoryGroups.length === 0');
    expect(productsSource).toContain('当前分类暂无索引');
    expect(productsSource).toContain('currentProducts.length === 0');
    expect(productsSource).toContain('当前视图下暂无档案');
  });

  it('keeps product detail scrolling on the body region instead of the floating shell', () => {
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).not.toContain('max-w-[1130px]');
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).toContain('h-full');
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).toContain('max-h-full');
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).toContain('min-h-0');
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).toContain('overflow-hidden');
    expect(PRODUCT_DETAIL_PANEL_CONTENT_CLASS).toContain('grid h-full min-h-0');
    expect(PRODUCT_DETAIL_PANEL_CONTENT_CLASS).toContain('grid-cols-[360px_minmax(0,1fr)]');
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).not.toContain('max-w-5xl');
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).not.toContain('grid-cols');
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).not.toContain('flex flex-col');
    expect(PRODUCT_DETAIL_PANEL_LAYOUT_CLASS).not.toContain('overflow-y-auto');
    expect(PRODUCT_DETAIL_MEDIA_PANEL_CLASS).toContain('flex flex-col');
    expect(PRODUCT_DETAIL_MEDIA_FRAME_CLASS).toContain('aspect-[4/5]');
    expect(PRODUCT_DETAIL_MEDIA_FRAME_CLASS).toContain('rounded-inset');
    expect(PRODUCT_DETAIL_MEDIA_FRAME_CLASS).toContain(OS_MATERIAL.insetSurface);
    expect(PRODUCT_DETAIL_MEDIA_META_CLASS).toContain(OS_MATERIAL.insetSurface);
    expect(PRODUCT_DETAIL_MAIN_PANEL_CLASS).toContain('overflow-hidden');
    expect(PRODUCT_DETAIL_MAIN_PANEL_CLASS).toContain('flex flex-col');
    expect(PRODUCT_DETAIL_MAIN_PANEL_CLASS).not.toContain('rounded-[24px]');
    expect(PRODUCT_DETAIL_MAIN_PANEL_CLASS).not.toContain('border');
    expect(PRODUCT_DETAIL_ITEM_CLASS).toContain(OS_MATERIAL.insetSurface);
    expect(PRODUCT_DETAIL_STATUS_PANEL_CLASS).toContain(OS_MATERIAL.insetSurface);
    expect(PRODUCT_DETAIL_HEADER_LAYOUT_CLASS).toContain('shrink-0');
    expect(PRODUCT_DETAIL_HEADER_LAYOUT_CLASS).not.toContain('sticky');
    expect(PRODUCT_DETAIL_BODY_SCROLL_CLASS).toBe('flex-1 min-h-0 overflow-y-auto p-8 space-y-8');
    expect(productsSource).toContain('materialRole="framePanel"');
    expect(productsSource).toContain('data-os-compiler-role="product-detail-panel"');
    expect(productsSource).toContain('data-os-compiler-role="product-detail-media-panel"');
    expect(productsSource).toContain('data-os-compiler-role="product-detail-main-panel"');
    expect(productsSource).toContain('const getDisplayImages = (product: ProductAsset) =>');
    expect(productsSource).toContain('<ImageIcon size={34} strokeWidth={1.3} />');
    expect(productsSource).toContain('selectedProduct.fabricProfile?.colorDescription || selectedProduct.fabricProfile?.millQuality || selectedProduct.subCategoryId ||');
    expect(productsSource).toContain('className={`${PRODUCT_DETAIL_HEADER_LAYOUT_CLASS} justify-end');
    expect(productsSource).toContain('contentClassName={PRODUCT_DETAIL_PANEL_CONTENT_CLASS}');
    expect(productsSource).toContain('className={PRODUCT_DETAIL_MAIN_PANEL_CLASS}');
    expect(productsSource).toContain('className={PRODUCT_DETAIL_BODY_SCROLL_CLASS}');
    expect(productsSource).toContain("className={`${wide ? 'md:col-span-2' : ''} ${PRODUCT_DETAIL_ITEM_CLASS}`}");
    const mediaPanelSource = productsSource.slice(
      productsSource.indexOf('data-os-compiler-role="product-detail-media-panel"'),
      productsSource.indexOf('data-os-compiler-role="product-detail-main-panel"'),
    );
    const mainPanelSource = productsSource.slice(
      productsSource.indexOf('data-os-compiler-role="product-detail-main-panel"'),
      productsSource.indexOf('<DetailSection title="基础识别">'),
    );
    expect(mediaPanelSource).toContain('{selectedProduct.name}');
    expect(mediaPanelSource).toContain('核心档案信息已完整');
    expect(mainPanelSource).not.toContain('{selectedProduct.name}');
    expect(mainPanelSource).not.toContain('核心档案信息已完整');
    expect(productsSource).not.toContain("bg-slate-50/80 border-slate-100");
    expect(productsSource).not.toContain("bg-[#0d1b2a]/40 border-white/10");
  });

  it('keeps the product toolbar on the project select/menu system instead of native controls', () => {
    expect(productsSource).toContain('<CustomSelect');
    expect(productsSource).not.toContain('<select');
    expect(productsSource).toContain('surface="toolbar"');
    expect(productsSource).toContain('triggerVariant="inline"');
  });

  it('keeps price grouping helpers hoisted so the price tier tab cannot trip render-time TDZ', () => {
    expect(productsSource).toContain('function priceHistoryRows');
    expect(productsSource).toContain('function latestPrice');
    expect(productsSource).not.toContain('const latestPrice =');
    expect(productsSource).not.toContain('const priceHistoryRows =');
  });

  it('defines the PDML raw view guard before scroll mask hooks read it', () => {
    expect(productsSource.indexOf('const isPdmlRawView')).toBeGreaterThan(-1);
    expect(productsSource.indexOf('useGlassSurfaceEdgeMasks({')).toBeGreaterThan(-1);
    expect(productsSource.indexOf('const isPdmlRawView')).toBeLessThan(productsSource.indexOf('useGlassSurfaceEdgeMasks({'));
  });

  it('does not reintroduce heavy font weights into the archive surface', () => {
    expect(productsSource).not.toMatch(/font-(medium|semibold|bold|normal)/);
  });

  it('exposes edit and delete actions for product sub-category cards', () => {
    expect(productsSource).toContain('setEditingSub(editableCategory)');
    expect(productsSource).toContain('setDeleteSubId(editableCategory.id)');
    expect(productsSource).toContain('name="description"');
  });

  it('uses IndexedDB device cache for the PDML raw fabric library instead of a 500-row localStorage snapshot', () => {
    expect(productsSource).toContain('getCachedPdmlRawFabrics');
    expect(productsSource).toContain('saveCachedPdmlRawFabrics');
    expect(productsSource).toContain('listAllPdmlRawFabrics');
    expect(productsSource).toContain('const firstPage = await apiService.listPdmlRawFabrics');
    expect(productsSource).toContain('apiService.startPdmlRawSync');
    expect(productsSource).toContain('pollPdmlSyncJob');
    expect(productsSource).toContain('已保留当前数据');
    expect(productsSource).toContain('数据中心本次返回 0 条，已保留本机缓存。');
    expect(productsSource).not.toContain('bambook_pdml_raw_snapshot_v1');
    expect(productsSource).not.toContain('writePdmlRawSnapshot');
  });

  it('writes product archive changes to the data center before mutating local cache state', () => {
    expect(productsSource).toContain('ensureOnlineWrite');
    expect(productsSource).toContain('const persisted = await apiService.createProductAsset');
    expect(productsSource).toContain('const persisted = await apiService.updateProductAsset');
    expect(productsSource).toContain('await apiService.deleteProductAsset');
    expect(productsSource).toContain('await apiService.saveProductCategory');
    expect(productsSource).not.toContain("backend create failed");
    expect(productsSource).not.toContain("backend update failed");
    expect(productsSource).not.toContain("backend delete failed");
  });
});
