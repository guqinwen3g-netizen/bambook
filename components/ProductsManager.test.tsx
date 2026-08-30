import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildProductExportRows,
  PRODUCT_EXPORT_HEADERS,
  PRODUCT_CATEGORY_CARD_GRID_CLASS,
  PRODUCT_CARD_CLASS,
  PRODUCT_CARD_GRID_CLASS,
  PRODUCT_CARD_LAYOUT_TRANSITION,
  PRODUCT_CARD_GRID_EDGE_FADE_TOP_OFFSET,
  PRODUCT_CARD_SURFACE_CLASS,
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
  PRODUCT_FORM_FIELD_CLASS,
  PRODUCT_FORM_LABEL_CLASS,
  PRODUCT_FORM_MAP_INDEX_CLASS,
  PRODUCT_FORM_SECTION_TITLE_CLASS,
  PRODUCT_SUB_INDEX_PANEL_CLASS,
  PRODUCT_SUB_INDEX_ROW_CLASS,
  PRODUCT_TABLE_CELL_BORDER_CLASS,
  PRODUCT_TABLE_HEADER_CLASS,
  PRODUCT_TABLE_ROW_HOVER_CLASS,
  PRODUCT_TITLE_ACTION_BUTTON_CLASS,
  PRODUCT_TITLE_BAR_CLASS,
  PRODUCT_TITLE_ICON_BUTTON_CLASS,
  PRODUCT_TITLE_PAGE_LABEL_CLASS,
  PRODUCT_TITLE_SAFE_LEFT_STYLE,
  PRODUCT_TOOLBAR_AMBIENT_CLASS,
  PRODUCT_TOOLBAR_CLASS,
  PRODUCT_TOOLBAR_CONTENT_CLASS,
  PRODUCT_TOOLBAR_SEARCH_CLASS,
  PRODUCT_TOOLBAR_SURFACE_CLASS,
} from './ProductsManager';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';
import {
  RELATIONS_FORM_NESTED_ROW_CLASS,
  RELATIONS_FORM_MAP_PANEL_CLASS,
  RELATIONS_FORM_PANEL_CLASS,
  RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING,
  RELATIONS_FORM_QUIET_ACTION_CLASS,
} from './ui/relationsFormStyles';

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
    expect(PRODUCT_TOOLBAR_SURFACE_CLASS).toBe(BAMBOOK_OS.controls.toolbar.surface);
    expect(PRODUCT_TOOLBAR_SEARCH_CLASS).toBe(BAMBOOK_OS.controls.toolbar.search);
  });

  it('adapts direct-on-wallpaper product title navigation and actions', () => {
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary"');
    expect(productsSource).toContain('className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS} bg-transparent border-0 p-0 rounded-none shadow-none transition-colors text-[var(--text-secondary)] hover:text-[var(--os-vnext-brand-blue)]`}');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="secondary" className={PRODUCT_TITLE_SEPARATOR_CLASS}');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary"\n                  className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS}');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary" className={`${PRODUCT_TITLE_PAGE_LABEL_CLASS}');
    expect(productsSource).toContain('data-ui-lab-wallpaper-contrast="primary"\n              className={`${PRODUCT_TITLE_ACTION_BUTTON_CLASS} ${productActionButtonClass} flex items-center justify-center gap-2`}');
    expect(productsSource).not.toContain('<ChevronLeft size={18} strokeWidth={1} className={isDarkMode ?');
  });

  it('keeps OS title bars full-width while constraining product content canvases', () => {
    expect(productsSource).toContain("const productContentCanvasClass = BAMBOOK_OS.layout.desktopPageCanvasClass;");
    expect(productsSource).toContain('style={PRODUCT_TITLE_SAFE_LEFT_STYLE}');
    expect(productsSource).toContain('className="w-full h-full flex flex-col bg-transparent overflow-visible"');
    expect(productsSource).toContain('${productContentCanvasClass} flex-1 flex flex-col min-h-0 overflow-visible');
    expect(productsSource).toContain("shellBaseClassName={`${BAMBOOK_OS.layout.desktopTablePanelShellCompactClass} flex-1 min-h-0 flex flex-col`}");
    expect(productsSource).toContain('form="product-fullscreen-form"');
    expect(productsSource).toContain('<form id="product-fullscreen-form" onSubmit={editingProd ? handleEditProduct : handleAddProduct} className="w-full flex-1 min-h-0 px-7 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch">');
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
    expect(productsSource).toContain('scrollViewportClassName: `bambook-product-form-scroll-viewport min-w-0 -mt-[7rem] h-[calc(100%+7rem)] overflow-y-auto overscroll-contain space-y-6 pt-24 pb-[176px] ${BAMBOOK_OS.layout.panelShadowViewportClass}`');
    expect(productsSource).toContain("source: 'CompiledProductsPage.productForm.surfaceMasks'");
    expect(indexCss).toContain('.bambook-relation-form-scroll-viewport,\n.bambook-product-form-scroll-viewport');
    expect(indexCss).toContain('.bambook-product-form-scroll-viewport {\n        overflow-x: clip;');
  });

  it('aligns archive cards with the dashboard card material and spotlight system', () => {
    expect(PRODUCT_CATEGORY_CARD_GRID_CLASS).toContain('repeat(auto-fill,316px)');
    expect(PRODUCT_CARD_GRID_CLASS).toContain('repeat(auto-fill,300px)');
    expect(PRODUCT_CARD_CLASS).toContain('rounded-card-lg');
    expect(PRODUCT_CARD_CLASS).toContain('h-[220px]');
    expect(PRODUCT_CARD_SURFACE_CLASS).toBe(`bds-surface ${BAMBOOK_OS.controls.listRow.hover}`);
    expect(PRODUCT_CARD_SURFACE_CLASS).not.toContain('bambook-outer-panel');
    expect(PRODUCT_CARD_SURFACE_CLASS).not.toContain(OS_MATERIAL.raisedCard);
    expect(PRODUCT_CARD_SURFACE_CLASS).not.toContain('bambook-panel-glass');
    expect(PRODUCT_SUB_INDEX_PANEL_CLASS).toContain(OS_MATERIAL.framePanel);
    expect(PRODUCT_SUB_INDEX_ROW_CLASS).toContain('min-h-[4.5rem]');
    expect(PRODUCT_SUB_INDEX_ROW_CLASS).not.toContain('min-h-[72px]');
    expect(PRODUCT_CARD_LAYOUT_TRANSITION).toBe(BAMBOOK_OS.motion.layoutTransition);
    // 卡片/工具栏/标题按钮已全面脱离 SpotlightCard 液态蓝光体系（老版淡蓝残留清零）：
    // 不再引用 CompiledInteractiveCard、不再有 spotlightColor/liquidSpotlight/spotlight 常量
    expect(productsSource).not.toContain('<CompiledInteractiveCard');
    expect(productsSource).not.toContain('CompiledInteractiveCard,');
    expect(productsSource).not.toContain('spotlightColor');
    expect(productsSource).not.toContain('liquidSpotlight');
    expect(productsSource).not.toContain('idleSpotlightOpacity');
    expect(productsSource).not.toContain('PRODUCT_CARD_SPOTLIGHT');
    expect(productsSource).not.toContain('PRODUCT_TOOLBAR_SPOTLIGHT');
    expect(productsSource).not.toContain('<CompiledMotionInteractiveCard');
    expect(productsSource).toContain('const productGlassPanelClass = `${OS_MATERIAL.framePanel} bambook-panel-glass bambook-outer-panel`;');
    expect(productsSource).toContain('const productFloatingPanelClass = `${OS_MATERIAL.floatingOverlay} bambook-panel-glass`;');
    expect(productsSource).not.toContain("isDarkMode ? 'bambook-blue-white-surface bg-white/[0.015]' : 'bambook-blue-white-surface bg-white/20'");
    expect(productsSource).not.toContain('h-[420px]');
    expect(productsSource).not.toContain('rounded-[32px]');
    expect(PRODUCT_CARD_CLASS).not.toContain('backdrop-blur-[14px]');
    expect(productsSource).not.toContain('shadow-2xl backdrop-blur');
  });

  it('aligns archive card visual language with the relations category card design', () => {
    // 卡片真源对齐关系智库 renderRelationCard：
    // ① 图标灰阶（text-secondary → hover text-primary，strokeWidth 1），禁品牌蓝
    // ② 表面 bds-surface + 侧栏同源 hover 墨洗（触碰灰光）
    // ③ 尺寸 p-6 h-[220px] rounded-card-lg
    // ④ footer 语言：border-t + text-[10px] + 右侧 ArrowRight（hover 平移）
    const mainCardStart = productsSource.indexOf("navLevel === 'main' && (");
    const mainCardSource = productsSource.slice(
      mainCardStart,
      productsSource.indexOf("navLevel === 'sub' && (", mainCardStart)
    );
    const recordCardStart = productsSource.indexOf('profile="record"');
    const recordCardSource = productsSource.slice(
      recordCardStart,
      productsSource.indexOf('CompiledTableShell', recordCardStart)
    );

    expect(mainCardSource).toContain('p-6 h-[220px] rounded-card-lg');
    expect(mainCardSource).toContain('text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]');
    expect(mainCardSource).toContain('<cat.icon size={24} strokeWidth={1} />');
    expect(mainCardSource).not.toContain('text-[var(--os-vnext-brand-blue)]');
    expect(mainCardSource).not.toContain('text-[var(--os-vnext-brand-blue-strong)]');
    expect(mainCardSource).toContain('<ArrowRight size={14} strokeWidth={1.5}');
    expect(mainCardSource).toContain('group-hover:translate-x-1 text-[var(--text-quaternary)]');
    expect(mainCardSource).toContain('text-[10px] font-light tracking-wide');

    expect(recordCardSource).toContain('p-6 h-[220px] rounded-card-lg');
    expect(recordCardSource).toContain('text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]');
    expect(recordCardSource).toContain('<Library size={24} strokeWidth={1} />');
    expect(recordCardSource).not.toContain('text-[var(--os-vnext-brand-blue)]');
    expect(recordCardSource).toContain('text-[10px] font-light');
  });

  it('routes form fields, labels, inline panels, and tables through semantic tokens', () => {
    expect(PRODUCT_FORM_FIELD_CLASS).toBe(BAMBOOK_OS.controls.recessedField.base);
    expect(PRODUCT_FORM_LABEL_CLASS).toBe(BAMBOOK_OS.tone.text.formLabel);
    expect(PRODUCT_FORM_SECTION_TITLE_CLASS).toBe('text-[var(--text-primary)]');
    expect(PRODUCT_FORM_MAP_INDEX_CLASS).toBe(`${OS_MATERIAL.insetSurface} ${BAMBOOK_OS.tone.surface.formMapIndex}`);
    expect(productsSource).toContain('const productFormSectionTitleClass = PRODUCT_FORM_SECTION_TITLE_CLASS;');
    expect(productsSource).toContain('const productFormMapIndexClass = PRODUCT_FORM_MAP_INDEX_CLASS;');
    expect(productsSource).toContain("mapMaterialRole: 'raisedCard'");
    expect(productsSource).toContain('titleClassName={productFormSectionTitleClass}');
    expect(productsSource).toContain('w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-[10px] font-light transition-colors ${productFormMapIndexClass}`}>{idx + 1}</span>');
    expect(RELATIONS_FORM_PANEL_CLASS).toBe('scroll-mt-28 p-6 bambook-relations-form-panel');
    expect(RELATIONS_FORM_MAP_PANEL_CLASS).toBe('p-6 bambook-relations-form-map-panel');
    expect(RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING).toBe('width');
    expect(productsSource).toContain("} from './ui/relationsFormStyles';");
    expect(productsSource).toContain('<CompiledFormSectionPanel');
    expect(productsSource).toContain('<CompiledFormMapPanel');
    expect(productsSource).toContain('materialRole={blueprint.form.mapMaterialRole}');
    expect(indexCss).toContain('background-color: var(--ui-lab-panel-glass-film-color) !important;');
    expect(indexCss).toContain('background-image: var(--ui-lab-panel-shared-glass-background) !important;');
    expect(indexCss).toContain('box-shadow: var(--ui-lab-panel-frame-inset-shadow) !important;');
    expect(indexCss).toContain('.bambook-relations-form-map-panel');
    expect(indexCss).toContain('.bambook-relations-form-panel .os-material-inset-surface');
    expect(indexCss).toContain('background-color: var(--ui-lab-form-panel-inset-film-color) !important;');
    expect(RELATIONS_FORM_NESTED_ROW_CLASS).toBe(OS_MATERIAL.insetSurface);
    expect(RELATIONS_FORM_QUIET_ACTION_CLASS).toBe(BAMBOOK_OS.controls.formIconButton.quietAction);
    expect(productsSource).toContain('const productFormNestedRowClass = RELATIONS_FORM_NESTED_ROW_CLASS;');
    expect(productsSource).toContain('const productFormQuietActionClass = RELATIONS_FORM_QUIET_ACTION_CLASS;');
    expect(productsSource).not.toContain('isDarkMode ? RELATIONS_FORM_NESTED_ROW_DARK_CLASS');
    expect(productsSource).not.toContain('isDarkMode ? RELATIONS_FORM_QUIET_ACTION_DARK_CLASS');
    expect(productsSource).toContain('rounded-inset border p-4 flex items-center ${productFormNestedRowClass}');
    expect(productsSource).toContain('rounded-inset border p-4 space-y-3 ${productFormNestedRowClass}');
    expect(productsSource).toContain('transition-colors duration-200 ${productFormQuietActionClass}');
    expect(productsSource).not.toContain("bg-slate-50/50 border-slate-100");
    expect(productsSource).not.toContain('className="scroll-mt-28 p-5 space-y-6"');
    expect(productsSource).not.toContain('contentClassName="relative z-10 space-y-6"');
    expect(productsSource).toContain('title={title}');
    expect(productsSource).not.toContain('Archive Section');

    expect(PRODUCT_TABLE_HEADER_CLASS).toBe(BAMBOOK_OS.controls.table.header);
    expect(PRODUCT_TABLE_ROW_HOVER_CLASS).toBe(BAMBOOK_OS.controls.table.rowHover);
    expect(PRODUCT_TABLE_CELL_BORDER_CLASS).toBe(BAMBOOK_OS.controls.table.cellBorder);
    expect(productsSource).not.toContain('className="w-full table-fixed text-left text-xs"');
  });

  it('aligns archive text inputs with the custom select trigger shell', () => {
    expect(productsSource).toContain('const productFieldShellClass =');
    expect(productsSource).toContain('rounded-control border outline-none');
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
      productsSource.indexOf('useCompiledGlassSurfaceEdgeMasks({'),
      productsSource.indexOf('const productTableScrollRef')
    );

    expect(PRODUCT_EDGE_FADE_TOP_HEIGHT).toBe(56);
    expect(PRODUCT_EDGE_FADE_TOP_START).toBe(0);
    expect(PRODUCT_EDGE_FADE_BOTTOM_HEIGHT).toBe(72);
    expect(PRODUCT_CARD_GRID_EDGE_FADE_TOP_OFFSET).toBe(64);
    expect(productsSource).toContain('CompiledEdgeFade');
    expect(productsSource).toContain('renderMode="content-mask"');
    expect(productsSource).toContain('BAMBOOK_OS.layout.panelShadowViewportClass');
    expect(productsSource).toContain('paddingClassName="px-5 pt-[104px] pb-5"');
    expect(productsSource).toContain('paddingClassName="p-8"');
    expect(productsSource).toContain('className="relative flex-1 min-h-0 overflow-visible"');
    expect(productsSource).toContain('scrollClassName={`${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-full-bleed-row-viewport`}');
    expect(productsSource).not.toContain('<div ref={subIndexScrollRef} className="flex-1 min-h-0 overflow-y-scroll">');
    // 分类/档案卡片网格边缘渐隐由 useStaticEdgeMask 固定 mask 挂滚动容器自身（与关系智库同套方案）——
    // 真透明度渐隐（内容淡出而非覆盖色带）、一次设置不监听滚动（不抖动）、
    // 不截断卡片 backdrop-filter（两级页面 hover 毛玻璃一致）；
    // 仅保留 sub 索引行的逐行 mask hook（表格行非毛玻璃卡片，不在此问题域）
    expect(edgeMaskHookSource).not.toContain('scrollRef: productGridScrollRef');
    expect(edgeMaskHookSource).not.toContain('scrollRef: mainCategoryScrollRef');
    expect(edgeMaskHookSource).toContain('scrollRef: subIndexScrollRef');
    expect(edgeMaskHookSource).toContain("enabled: navLevel === 'sub'");
    expect(productsSource).not.toContain('<ScrollEdgeFades');
    expect(productsSource).not.toContain('<StaticEdgeFade');
    expect(productsSource).not.toContain('mainCategoryMaskRef');
    expect(productsSource).not.toContain('productGridMaskRef');
    expect(productsSource).toContain("import { useStaticEdgeMask } from './ui/useStaticEdgeMask'");
    expect(productsSource).toContain('useStaticEdgeMask(mainCategoryScrollRef, {');
    expect(productsSource).toContain('topFadeEnd: PRODUCT_CARD_GRID_EDGE_FADE_TOP_OFFSET + 32');
    expect(productsSource).toContain('bottomFade: 48');
    expect(productsSource).toContain("enabled: navLevel === 'main'");
    expect(productsSource).toContain('useStaticEdgeMask(productGridScrollRef, {');
    expect(productsSource).toContain('topFadeEnd: 32');
    expect(productsSource).toContain("enabled: navLevel === 'list' && listDisplayMode === 'grid'");
    expect(mainViewSource).toContain('ref={mainCategoryScrollRef}');
    // 分类卡片已脱离 SpotlightCard 体系（motion.button，无液态蓝光、无逐卡 mask 属性）
    expect(mainViewSource).toContain('<motion.button');
    expect(mainViewSource).not.toContain('spotlightColor');
    expect(mainViewSource).not.toContain('liquidSpotlight');
    expect(mainViewSource).not.toContain('data-glass-edge-mask');
    expect(productsSource).toContain('ref={productGridScrollRef}');
    // 卡片/行全面禁用 framer layout 动画与 hover 位移——毛玻璃 + transform 会触发
    // Chrome 合成层快照缓存，导致高光冻结/边缘鬼影（入场仅保留 opacity 淡入）
    expect(productsSource).not.toMatch(/whileHover\s*=\s*\{/);
    expect(productsSource).not.toMatch(/<CompiledMotionInteractiveCard[^>]*\slayout[\s=>]/);
    expect(productsSource).not.toMatch(/<CompiledCollectionCardGrid[^>]*\slayout[\s=>]/);
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
    expect(PRODUCT_DETAIL_BODY_SCROLL_CLASS).toBe('flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6');
    expect(productsSource).toContain('materialRole="framePanel"');
    expect(productsSource).toContain('role="product-detail-panel"');
    expect(productsSource).toContain('data-os-compiler-role="product-detail-body-scroll"');
    expect(productsSource).toContain('source="CompiledProductsPage.product-detail-panel"');
    expect(productsSource).toContain('const getDisplayImages = (product: ProductAsset) =>');
    expect(productsSource).toContain('<ImageIcon size={24} strokeWidth={1.5} />');
    expect(productsSource).toContain('selectedProduct.fabricProfile?.colorDescription');
    expect(productsSource).toContain('ref={productDetailBodyScrollRef}');
    expect(productsSource).toContain('contentClassName="relative z-10 flex min-h-0 flex-1 flex-col"');
    expect(productsSource).toContain('className={`h-full flex flex-col rounded-card shadow-none overflow-hidden ${OS_MATERIAL.raisedCard}`}');
    expect(productsSource).toContain('data-os-compiler-role="product-detail-body-scroll"');
    expect(productsSource).toContain('className={`flex-1 min-h-0 overflow-y-auto px-6 py-8 bambook-scrollbar ${BAMBOOK_OS.layout.panelShadowViewportClass}`}');
    const detailHeaderSource = productsSource.slice(
      productsSource.indexOf('role="product-detail-panel"'),
      productsSource.indexOf('ref={productDetailBodyScrollRef}'),
    );
    const detailBodySource = productsSource.slice(
      productsSource.indexOf('ref={productDetailBodyScrollRef}'),
      productsSource.indexOf('<DetailSection title="基础识别">'),
    );
    expect(detailHeaderSource).toContain('{selectedProduct.name}');
    expect(detailHeaderSource).not.toContain('核心档案信息已完整');
    expect(detailBodySource).toContain('核心档案信息已完整');
    expect(detailBodySource).not.toContain('{selectedProduct.name}');
    expect(productsSource).not.toContain("bg-slate-50/80 border-slate-100");
    expect(productsSource).not.toContain("bg-[#0d1b2a]/40 border-white/10");
  });

  it('keeps the product toolbar on the project select/menu system instead of native controls', () => {
    const toolbarSource = productsSource.slice(
      productsSource.indexOf('const renderClassificationTabBar ='),
      productsSource.indexOf('const renderFabricProfileFields =')
    );
    expect(toolbarSource).toContain('<CompiledSelectControl');
    expect(toolbarSource).not.toContain('<select');
    expect(toolbarSource).toContain('surface="toolbar"');
    expect(toolbarSource).toContain('triggerVariant="inline"');
  });

  it('keeps price grouping helpers hoisted so the price tier tab cannot trip render-time TDZ', () => {
    expect(productsSource).toContain('function priceHistoryRows');
    expect(productsSource).toContain('function latestPrice');
    expect(productsSource).not.toContain('const latestPrice =');
    expect(productsSource).not.toContain('const priceHistoryRows =');
  });

  it('does not reintroduce heavy font weights into the archive surface', () => {
    expect(productsSource).not.toMatch(/font-(medium|semibold|bold|normal)/);
  });

  it('exposes edit and delete actions for product sub-category cards', () => {
    expect(productsSource).toContain('setEditingSub(editableCategory)');
    expect(productsSource).toContain('setDeleteSubId(editableCategory.id)');
    expect(productsSource).toContain('name="description"');
  });

  it('retires the PDML raw fabric library entry points entirely', () => {
    expect(productsSource).not.toContain('PdmlRaw');
    expect(productsSource).not.toContain('pdmlRaw');
    expect(productsSource).not.toContain('__pdml_raw_library__');
    expect(productsSource).not.toContain('庞大原始库');
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

describe('ProductsManager 功能批次 C/D（数字档案车道）', () => {
  it('C10 产品导出：列表工具条提供导出按钮，前端 xlsx 生成当前视图全量', () => {
    expect(productsSource).toContain("import * as XLSX from 'xlsx';");
    expect(productsSource).toContain('const handleExportProducts = () => {');
    expect(productsSource).toContain('buildProductExportRows(currentProducts)');
    expect(productsSource).toContain('XLSX.utils.aoa_to_sheet(rows)');
    expect(productsSource).toContain('XLSX.writeFile(book, `产品档案-${stamp}.xlsx`);');
    expect(productsSource).toContain('aria-label="导出当前视图产品 Excel"');
    expect(productsSource).toContain('onClick={handleExportProducts}');
    expect(productsSource).toContain("bdsToast.warning('当前视图没有可导出的产品档案')");
  });

  it('C10 导出行构建：SKU/名称/品类/供应商/价格/库存列映射正确（含 millName 快照优先）', () => {
    const fabricProduct = {
      id: 'PROD-1',
      sku: 'SKU-001',
      name: '精纺羊毛',
      mainCategory: 'Fabric',
      subCategoryId: 'sub-1',
      season: 'AW26',
      cost: 0,
      status: 'Development',
      updatedAt: Date.UTC(2026, 7, 28),
      fabricProfile: {
        millOrganizationId: 'REL-MILL-1',
        millName: 'Panda Mill',
        millQuality: 'Super 120s',
        stockStatus: '现货',
        stockQuantity: 120.5,
        stockUnit: 'm',
      },
      fabricPrices: [
        { id: 'FP-1', productAssetId: 'PROD-1', priceType: 'factory', amount: 8.5, currency: 'USD', unit: 'm', updatedAt: 100 },
        { id: 'FP-2', productAssetId: 'PROD-1', priceType: 'customer', amount: 12, currency: 'USD', unit: 'm', updatedAt: 100 },
        { id: 'FP-3', productAssetId: 'PROD-1', priceType: 'sample', amount: 15, currency: 'USD', unit: 'm', updatedAt: 200 },
        { id: 'FP-4', productAssetId: 'PROD-1', priceType: 'sample', amount: 14, currency: 'USD', unit: 'm', updatedAt: 90 },
        { id: 'FP-5', productAssetId: 'PROD-1', priceType: 'cutting', amount: 13.5, currency: 'USD', unit: 'm', updatedAt: 100 },
        { id: 'FP-6', productAssetId: 'PROD-1', priceType: 'factory', amount: 99, currency: 'USD', unit: 'm', updatedAt: 300, deletedAt: 1 },
      ],
    } as any;
    const rows = buildProductExportRows([fabricProduct]);
    expect(rows[0]).toEqual(PRODUCT_EXPORT_HEADERS);
    expect(rows).toHaveLength(2);
    const row = rows[1];
    expect(row[0]).toBe('SKU-001');
    expect(row[1]).toBe('精纺羊毛');
    expect(row[2]).toBe('面料');
    expect(row[3]).toBe('Super 120s');
    // D3 双写后：供应商展示优先 millName 快照，回退 FK/历史裸文本
    expect(row[4]).toBe('Panda Mill');
    // 工厂价取最新未删除行（deletedAt 行被排除）
    expect(row[5]).toBe(8.5);
    expect(row[6]).toBe(12);
    // 样品价取 updatedAt 最新行
    expect(row[7]).toBe(15);
    expect(row[8]).toBe(13.5);
    expect(row[9]).toBe('USD');
    expect(row[10]).toBe('现货');
    expect(row[11]).toBe('120.5 m');
    expect(row[12]).toBe('2026-08-28');
  });

  it('C11 新建产品图片：表单提供暂存上传区，保存落库后统一上传到同一档案', () => {
    expect(productsSource).toContain('const PendingImageUploader: React.FC<{');
    expect(productsSource).toContain('const [pendingImages, setPendingImages] = useState<File[]>([]);');
    expect(productsSource).toContain('<PendingImageUploader files={pendingImages} onChange={setPendingImages} />');
    expect(productsSource).toContain('URL.createObjectURL(file)');
    // 暂存文件在 createProductAsset 成功拿到 id 后才上传（服务端要求资产已存在）
    expect(productsSource).toContain('apiService.uploadProductImages(persisted.id, pendingImages, cloudEndpoint)');
    expect(productsSource).toContain('persistedWithImages = { ...persisted, images: uploadedImages };');
    // 上传失败不回滚档案，仅提示
    expect(productsSource).toContain('档案已创建，但图片上传失败');
    // 表单关闭时清空暂存
    expect(productsSource).toContain('setPendingImages([]);');
  });

  it('C12 价格历史：补样品价历史与零剪价历史两栏（只读展示存量数据）', () => {
    expect(productsSource).toContain("(['factory', 'customer', 'sample', 'cutting'] as const).map(type => (");
    expect(productsSource).toContain("'售价历史' : type === 'sample' ? '样品价历史' : '零剪价历史'");
    expect(productsSource).toContain('priceHistoryRows(selectedProduct, type)');
  });

  it('D3 面料供应商：从供应商档案下拉选择（与 SupplierInquiryPanel 同源 listFactoryProfiles）', () => {
    expect(productsSource).toContain('const FabricSupplierField: React.FC<{');
    expect(productsSource).toContain('apiService.listFactoryProfiles({ blacklisted: false, limit: 200 })');
    expect(productsSource).toContain('<FabricSupplierField');
    expect(productsSource).toContain('source="CompiledProductsPage.fabric-supplier-select"');
    // FK + 名称快照双写
    expect(productsSource).toContain('<input type="hidden" name="millOrganizationId" value={selectedValue} />');
    expect(productsSource).toContain('name="millName"');
    expect(productsSource).toContain("millName: valueOf('millName'),");
    // 手打输入框已移除
    expect(productsSource).not.toContain('name="millOrganizationId" className={productInputClass}');
    // 展示路径优先 millName 快照
    expect(productsSource).toContain("product.fabricProfile?.millName || product.fabricProfile?.millOrganizationId || '供应商未填'");
  });

  it('D3 设计纪律：供应商下拉走 CompiledSelectControl（BDS），不引入原生 select', () => {
    const fieldStart = productsSource.indexOf('const FabricSupplierField: React.FC<{');
    const fieldEnd = productsSource.indexOf('/**', fieldStart);
    const fieldSource = productsSource.slice(fieldStart, fieldEnd);
    expect(fieldSource).toContain('<CompiledSelectControl');
    expect(fieldSource).toContain('surface="form"');
    expect(fieldSource).not.toContain('<select');
    expect(fieldSource).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(fieldSource).not.toContain('rounded-[');
  });
});
