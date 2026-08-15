import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareRelationsForList,
  RELATIONS_CATEGORY_CARD_CLASS,
  RELATIONS_CATEGORY_CARD_GRID_CLASS,
  RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS,
  RELATIONS_CATEGORY_CARD_HIGHLIGHT_POSITION_CLASS,
  RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR,
  RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_SIZE,
  RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR,
  RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_SIZE,
  getRelationsCardRowWidth,
  RELATIONS_CARD_COLUMN_GAP,
  RELATIONS_CARD_COLUMN_WIDTH,
  RELATIONS_CARD_GRID_CLASS,
  RELATIONS_CARD_LAYOUT_TRANSITION,
  RELATIONS_MOBILE_CATEGORY_CARD_CLASS,
  RELATIONS_MOBILE_CATEGORY_GRID_CLASS,
  RELATIONS_FORM_TITLE_BAR_CLASS,
  RELATIONS_FORM_TITLE_CRUMB_CLASS,
  RELATIONS_FORM_TITLE_HEADING_CLASS,
  RELATIONS_FORM_MAP_PANEL_CLASS,
  RELATIONS_FORM_PANEL_CLASS,
  RELATIONS_FORM_TITLE_SECONDARY_BUTTON_CLASS,
  RELATIONS_FORM_TITLE_SUBMIT_BUTTON_CLASS,
  RELATIONS_FORM_FIELD_CLASS,
  RELATIONS_FORM_MAP_INDEX_CLASS,
  RELATIONS_FORM_NESTED_ROW_CLASS,
  RELATIONS_FORM_ICON_ADD_CLASS,
  RELATIONS_FORM_ICON_REMOVE_CLASS,
  RELATIONS_FORM_ICON_COMPACT_REMOVE_CLASS,
  RELATIONS_FORM_INLINE_DANGER_CLASS,
  RELATIONS_FORM_QUIET_ACTION_CLASS,
  RELATIONS_COORDINATE_PANEL_CLASS,
  RELATIONS_COORDINATE_ICON_CLASS,
  getRelationsCoordinateStatusClass,
  RELATIONS_BRAND_INLINE_CLASS,
  RELATIONS_FORM_LABEL_CLASS,
  RELATIONS_FORM_SECTION_TITLE_CLASS,
  RELATIONS_ORGANIZATION_TIER_BADGE_CLASS,
  RELATIONS_ORGANIZATION_COMPLETION_DONE_CLASS,
  RELATIONS_ORGANIZATION_COMPLETION_MISSING_CLASS,
  getRelationsOrganizationCompletionClass,
  RELATIONS_TABLE_HEADER_CLASS,
  RELATIONS_TABLE_ROW_HOVER_CLASS,
  RELATIONS_TABLE_ROW_SEPARATOR_CLASS,
  RELATIONS_TABLE_CELL_MUTED_CLASS,
  RELATIONS_TABLE_EDIT_ACTION_CLASS,
  RELATIONS_TABLE_EMPTY_ACTION_CLASS,
  RELATIONS_PANEL_DIVIDER_CLASS,
  RELATIONS_PAGE_X_COLLAPSED_CLASS,
  RELATIONS_PAGE_X_NORMAL_CLASS,
  RELATIONS_PROGRESS_TRACK_CLASS,
  RELATIONS_TOOLBAR_CLASS,
  RELATIONS_TOOLBAR_AMBIENT_CLASS,
  RELATIONS_TOOLBAR_CONTENT_CLASS,
  RELATIONS_TOOLBAR_CONTROL_CLASS,
  RELATIONS_TOOLBAR_CONTROL_IDLE_CLASS,
  RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS,
  RELATIONS_TOOLBAR_OFFSET_CLASS,
  RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS,
  RELATIONS_TOOLBAR_SEGMENT_CLASS,
  RELATIONS_TOOLBAR_SEGMENT_ACTIVE_CLASS,
  RELATIONS_TOOLBAR_SPOTLIGHT_DARK_COLOR,
  RELATIONS_TOOLBAR_SPOTLIGHT_DARK_SIZE,
  RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_COLOR,
  RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_SIZE,
  RELATIONS_TOOLBAR_SURFACE_CLASS,
  RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS,
  RELATIONS_TOOLBAR_SEARCH_CLASS,
  RELATIONS_TOOLBAR_SEARCH_EXPANDED_CLASS,
  RELATIONS_TOOLBAR_SEARCH_SHELL_CLASS,
  RELATIONS_TOOLBAR_SORT_CLASS,
  RELATIONS_TOOLBAR_VIEW_GROUP_CLASS,
  RELATIONS_TOOLBAR_X_COLLAPSED_CLASS,
  RELATIONS_TOOLBAR_X_NORMAL_CLASS,
  RELATIONS_TITLE_ACTION_BUTTON_CLASS,
  RELATIONS_TITLE_ARROW_ICON_SIZE,
  RELATIONS_TITLE_BACK_BUTTON_CLASS,
  RELATIONS_TITLE_BACK_NAV_GROUP_CLASS,
  RELATIONS_TITLE_BUTTON_CLASS,
  RELATIONS_TITLE_NAV_GROUP_CLASS,
  RELATIONS_TITLE_PAGE_LABEL_CLASS,
  RELATIONS_TITLE_SEPARATOR_CLASS,
  RELATIONS_TITLE_SECTION_BUTTON_CLASS,
  RELATIONS_TITLE_SPOTLIGHT_DARK_COLOR,
  RELATIONS_TITLE_SPOTLIGHT_DARK_SIZE,
  RELATIONS_TITLE_SPOTLIGHT_LIGHT_COLOR,
  RELATIONS_TITLE_SPOTLIGHT_LIGHT_SIZE,
  RELATIONS_TITLE_BAR_CLASS,
  RELATIONS_TITLE_ICON_BUTTON_CLASS,
  RELATIONS_TITLE_TEXT_BUTTON_CLASS,
  RELATIONS_TITLE_VIEW_SWITCH_BUTTON_CLASS,
  RELATIONS_TITLE_VIEW_SWITCH_CLASS,
  RELATIONS_TITLE_SAFE_LEFT_STYLE,
} from './RelationsManager';
import { OS_MATERIAL } from './ui/osMaterial';
import {
  SIDEBAR_ACTIVE_CLASS,
  SIDEBAR_HOVER_DARK_CLASS,
  SIDEBAR_PRESS_DARK_CLASS,
  SIDEBAR_PRESS_LIGHT_CLASS,
} from './Sidebar';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import type { Relation } from '../types';

describe('RelationsManager title system', () => {
  it('keeps recent sorting stable when organizations share the same last interaction timestamp', () => {
    const peerless = {
      id: 'peerless001',
      name: 'Peerless Clothing Inc.',
      lastInteraction: 1776072830072,
      rating: 5,
    } as Relation;
    const recman = {
      id: 'recman001',
      name: 'RECMAN',
      lastInteraction: 1776072830072,
      rating: 4,
    } as Relation;

    const names = [recman, peerless]
      .sort((a, b) => compareRelationsForList(a, b, 'recent'))
      .map((relation) => relation.name);

    expect(names).toEqual(['Peerless Clothing Inc.', 'RECMAN']);
  });

  it('uses the shared OS-style menu for toolbar sorting instead of a native select', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const toolbarSource = source.slice(
      source.indexOf('const renderRelationListToolbar'),
      source.indexOf('// --- Handlers ---')
    );

    expect(toolbarSource).toContain('<CustomSelect');
    expect(toolbarSource).toContain('menuPortal');
    expect(toolbarSource).toContain('size="compact"');
    expect(toolbarSource).toContain('surface="toolbar"');
    expect(toolbarSource).toContain('triggerVariant="inline"');
    expect(toolbarSource).not.toContain('>排序<');
    expect(toolbarSource.indexOf('placeholder="搜索组织..."')).toBeLessThan(toolbarSource.indexOf('<CustomSelect'));
    expect(toolbarSource.indexOf('<CustomSelect')).toBeLessThan(toolbarSource.indexOf('RELATIONS_TOOLBAR_SEGMENT_CLASS'));
    expect(toolbarSource).toContain("aria-label={relationListDisplayMode === 'grid' ? '切换到表格视图' : '切换到格子视图'}");
    expect(toolbarSource).not.toContain('/> 格子');
    expect(toolbarSource).not.toContain('/> 表格');
    expect(toolbarSource).not.toContain('筛选');
    expect(toolbarSource).not.toContain('setRelationQuickFilter');
    expect(toolbarSource).not.toContain('待补全');
    expect(source).not.toContain('RelationQuickFilter');
    expect(toolbarSource).not.toContain('<select');
  });

  it('keeps the main title strip transparent and vertically aligned', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const titleSource = source.slice(
      source.indexOf('Primary Header - fixed'),
      source.indexOf('Level 3: transparent tab row')
    );

    expect(RELATIONS_TITLE_BAR_CLASS).toContain('h-14');
    expect(RELATIONS_TITLE_BAR_CLASS).toBe(BAMBOOK_OS.layout.desktopTitleBarClass);
    expect(RELATIONS_PAGE_X_NORMAL_CLASS).toBe(BAMBOOK_OS.layout.desktopPageXClass);
    expect(RELATIONS_PAGE_X_COLLAPSED_CLASS).toBe(BAMBOOK_OS.layout.desktopPageXClass);
    expect(RELATIONS_TITLE_BAR_CLASS).toContain('items-center');
    expect(RELATIONS_TITLE_BAR_CLASS).toContain('translate-y-[2px]');
    expect(RELATIONS_TITLE_BAR_CLASS).not.toContain('pb-3');
    expect(RELATIONS_TITLE_BAR_CLASS).not.toMatch(/\bbg-/);
    expect(RELATIONS_TITLE_BAR_CLASS).not.toContain('backdrop');
    expect(titleSource).toContain('RELATIONS_TITLE_NAV_GROUP_CLASS');
    expect(titleSource).toContain('RELATIONS_TITLE_BACK_NAV_GROUP_CLASS');
    expect(RELATIONS_TITLE_NAV_GROUP_CLASS).toBe('flex h-full items-center gap-1.5 min-w-0');
    expect(RELATIONS_TITLE_BACK_NAV_GROUP_CLASS).toBe('flex h-full items-center gap-0.5 -ml-3 min-w-0');
    expect(RELATIONS_TITLE_SEPARATOR_CLASS).toBe('h-9 w-5 flex items-center justify-center shrink-0');
    expect(RELATIONS_TITLE_PAGE_LABEL_CLASS).toContain('h-9');
    expect(RELATIONS_TITLE_PAGE_LABEL_CLASS).toContain('text-[11px]');
    expect(RELATIONS_TITLE_TEXT_BUTTON_CLASS).toContain('bg-transparent');
    expect(RELATIONS_TITLE_TEXT_BUTTON_CLASS).toContain('border-0');
    expect(RELATIONS_TITLE_TEXT_BUTTON_CLASS).toContain('p-0');
    expect(RELATIONS_TITLE_TEXT_BUTTON_CLASS).toContain('rounded-none');
    expect(RELATIONS_TITLE_SECTION_BUTTON_CLASS).toContain('bg-transparent');
    expect(RELATIONS_TITLE_SECTION_BUTTON_CLASS).toContain('border-0');
    expect(RELATIONS_TITLE_SECTION_BUTTON_CLASS).toContain('rounded-none');
    expect(titleSource).toContain('RELATIONS_FORM_TITLE_CRUMB_CLASS');
    expect(RELATIONS_FORM_TITLE_CRUMB_CLASS).toContain('gap-1.5');
    expect(titleSource).toContain('RELATIONS_TITLE_TEXT_BUTTON_CLASS');
    expect(titleSource).toContain('RELATIONS_TITLE_SECTION_BUTTON_CLASS');
    expect(titleSource).not.toContain('h-8 max-w-[160px] truncate rounded-2xl border px-3');
    expect(BAMBOOK_OS.layout.desktopTitleAccentClass).toContain('text-xl font-light tracking-tight');
    expect(BAMBOOK_OS.layout.desktopTitleAccentClass).toContain('leading-none');
    expect(titleSource).toContain('title="关系智库"');
    expect(RELATIONS_BRAND_INLINE_CLASS).toBe(BAMBOOK_OS.tone.text.brandInline);
    expect(titleSource).not.toContain('leading-snug');
    expect(titleSource).not.toContain('text-xl font-normal');
    expect(titleSource).not.toContain('font-medium text-[#4A90E2]');
  });

  it('uses one control height for title actions', () => {
    expect(RELATIONS_TITLE_ICON_BUTTON_CLASS).toContain('h-8');
    expect(RELATIONS_TITLE_ICON_BUTTON_CLASS).toContain('w-8');
    expect(RELATIONS_TITLE_BACK_BUTTON_CLASS).toContain(RELATIONS_TITLE_ICON_BUTTON_CLASS);
    expect(RELATIONS_TITLE_BACK_BUTTON_CLASS).toContain('!w-7');
    expect(RELATIONS_TITLE_ACTION_BUTTON_CLASS).toContain('h-9');
    expect(RELATIONS_TITLE_ACTION_BUTTON_CLASS).toContain('px-4');
    expect(RELATIONS_TITLE_ACTION_BUTTON_CLASS).toContain('justify-center');
    expect(RELATIONS_FORM_TITLE_SUBMIT_BUTTON_CLASS).toContain('h-9');
    expect(RELATIONS_FORM_TITLE_BAR_CLASS).toContain('translate-y-[2px]');
  });

  it('persists relation navigation during dev preview reloads', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');

    expect(source).toContain("RELATIONS_PREVIEW_STATE_KEY = 'bambook_relations_preview_state'");
    expect(source).toContain('const [previewState] = useState(readRelationsPreviewState)');
    expect(source).toContain("useState<RelationNavLevel>(() => previewState.navLevel || 'category')");
    expect(source).toContain('selectedCategory: isRelationCategory(parsed.selectedCategory) ? parsed.selectedCategory : null');
    expect(source).toContain('writeRelationsPreviewState({');
    expect(source).toContain('categoryScrollTop');
    expect(source).toContain('listScrollTop');
    expect(source).toContain("element.addEventListener('scroll', saveScroll");
  });

  it('uses a bottom sentinel so the fullscreen form fade clears at the last real content', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const formSource = source.slice(
      source.indexOf('id="relation-fullscreen-form"'),
      source.indexOf('</form>')
    );

    expect(formSource).toContain('pb-[176px]');
    expect(formSource).toContain('px-1');
    expect(formSource).not.toContain('pb-36 pr-1');
    expect(formSource).toContain('data-scroll-edge-bottom-sentinel');
  });

  it('keeps the fullscreen form fade aligned to the visible viewport bottom', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const formMaskSource = source.slice(
      source.indexOf('scrollRef: relationFormScrollRef'),
      source.indexOf('// 打开弹窗时锁定 body 滚动')
    );
    const formSource = source.slice(
      source.indexOf('id="relation-fullscreen-form"'),
      source.indexOf('</form>')
    );
    const formOverlaySource = source.slice(
      source.indexOf('{showAddModal && ('),
      source.indexOf('<form id="relation-fullscreen-form"', source.indexOf('{showAddModal && ('))
    );

    expect(formMaskSource).toContain('bottomHeight: 57');
    expect(formMaskSource).toContain('shadowCasterBottomHeight: 57');
    expect(formMaskSource).toContain('bottomFadeEndOffset: BAMBOOK_OS.layout.desktopMainPanelBottomInset');
    expect(formMaskSource).toContain('syncWheelScroll: true');
    expect(BAMBOOK_OS.layout.desktopMainPanelBottomInset).toBe(34);
    expect(source).toContain("const relationsFormBottomEdgeClass = 'bottom-0';");
    expect(formOverlaySource).toContain('${relationsFormBottomEdgeClass} z-[70]');
    expect(formOverlaySource).not.toContain('desktopMainPanelBottomEdgeClass');
    expect(formOverlaySource).not.toContain('bottom-4');
    expect(formSource).toContain('h-[calc(100%+7rem)]');
    expect(formSource).not.toContain('h-[calc(100%+7rem+16px)]');
    expect(formSource).not.toContain('h-[calc(100%+7rem+32px)]');
  });

  it('aligns the fullscreen form map and content panels to the latest glass surface', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    const sidePanelSource = readFileSync(new URL('./ui/SidePanelContainer.tsx', import.meta.url), 'utf8');
    const formSource = source.slice(
      source.indexOf('id="relation-fullscreen-form"'),
      source.indexOf('</form>')
    );

    expect(source).toContain("from './ui/SidePanelContainer'");
    expect(source).toContain("import { OS_MATERIAL } from './ui/osMaterial'");
    expect(source).toContain('OS_MATERIAL.raisedCard');
    expect(indexCss).not.toContain('.bambook-form-panel-edge');
    expect(indexCss).not.toContain('border: 40px solid transparent !important');
    expect(indexCss).not.toContain('border-radius: 64px !important');
    expect(source).not.toContain('RELATIONS_FORM_PANEL_BASE_CLASS');
    expect(source).not.toContain('RELATIONS_FORM_PANEL_DARK_CLASS');
    expect(source).not.toContain('RELATIONS_FORM_PANEL_LIGHT_CLASS');
    expect(indexCss).toContain('.bambook-dashboard-glass-color::before');
    expect(indexCss).toContain('.bambook-dashboard-glass-color::after');
    expect(indexCss).toContain('.bambook-panel-glass,\n.bambook-dashboard-glass-color');
    expect(indexCss).not.toContain('@apply bambook-panel-glass');
    expect(indexCss).toContain('mix-blend-mode: overlay');
    expect(indexCss).toContain('[data-glass-edge-mask].bambook-outer-panel:not(.os-material-raised-card)');
    expect(indexCss).toContain('.dark [data-glass-edge-mask].bambook-relations-form-panel:not(.os-material-raised-card)');
    expect(indexCss).toContain('.bambook-panel-shadow-viewport');
    expect(indexCss).toContain('margin-inline: var(--bambook-panel-shadow-bleed-x)');
    expect(indexCss).toContain('scroll-padding-block: var(--bambook-panel-shadow-bleed-y)');
    expect(indexCss).toContain('.bambook-shadow-sibling-stack');
    expect(indexCss).toContain('.bambook-sibling-shadow-caster');
    expect(indexCss).toContain('inset: calc(var(--bambook-sibling-shadow-bleed) * -1) !important;');
    expect(indexCss).toContain('.ui-lab-real-os-root .bambook-shadow-sibling-stack > [data-glass-edge-mask].bambook-relations-form-panel:not(.bambook-sibling-shadow-caster)');
    expect(indexCss).toContain('background-image: var(--ui-lab-panel-shared-glass-background) !important;');
    expect(indexCss).toContain('box-shadow: var(--ui-lab-panel-frame-inset-shadow) !important;');
    expect(indexCss).toContain('background-image: var(--ui-lab-panel-highlight-background) !important;');
    expect(indexCss).toContain('background-image: var(--ui-lab-panel-seam-interference-background) !important;');
    expect(indexCss).not.toContain('bambook-relations-form-panel:not(.bambook-sibling-shadow-caster)::after {\n    background-image: none !important;');
    const glassEdgeFadeShadowSource = readFileSync(new URL('./ui/GlassEdgeFadeShadow.tsx', import.meta.url), 'utf8');
    expect(sidePanelSource).toContain("import { OS_MATERIAL, OS_SHADOW");
    expect(sidePanelSource).toContain('surfaceRole?: OSMaterialRole');
    expect(sidePanelSource).toContain('shadowRole?: OSShadowRole');
    expect(sidePanelSource).toContain('shadowMode?: OSShadowMode');
    expect(sidePanelSource).toContain("'data-os-shadow-role': OS_SHADOW[resolvedShadowRole]");
    expect(sidePanelSource).toContain("'data-os-shadow-mode': resolvedShadowMode");
    expect(glassEdgeFadeShadowSource).toContain("GLASS_EDGE_FADE_STACK_CLASS = 'bambook-shadow-sibling-stack'");
    expect(glassEdgeFadeShadowSource).toContain("GLASS_EDGE_FADE_SHADOW_CASTER_CLASS = 'bambook-sibling-shadow-caster'");
    expect(glassEdgeFadeShadowSource).toContain('`${GLASS_EDGE_FADE_STACK_CLASS} ${className}`.trim()');
    expect(glassEdgeFadeShadowSource).toContain('data-os-shadow-mode="none"');
    expect(glassEdgeFadeShadowSource).not.toContain('data-os-shadow-role={OS_SHADOW[shadowRole]}');
    expect(glassEdgeFadeShadowSource).not.toContain('data-os-shadow-mode="ghost"');
    expect(sidePanelSource).toContain('data-glass-edge-mask');
    expect(glassEdgeFadeShadowSource).not.toContain('data-glass-edge-mask-shadow-caster');
    expect(glassEdgeFadeShadowSource).not.toContain('bambook-outer-panel ${OS_MATERIAL[materialRole]}');
    expect(glassEdgeFadeShadowSource).not.toContain('data-glass-edge-mask\n      data-glass-edge-mask-shadow-caster');
    expect(indexCss).toContain('[data-glass-edge-mask-shadow-caster]');
    expect(indexCss).toContain('--bambook-sibling-shadow: var(--ui-lab-panel-raised-depth-shadow);');
    expect(indexCss).not.toContain('--bambook-sibling-shadow: var(--ui-lab-panel-raised-shadow);');
    expect(indexCss).not.toContain('--bambook-sibling-shadow: var(--ui-lab-panel-frame-shadow);');
    expect(indexCss).toContain('.bambook-detail-panel-shadow-viewport');
    expect(indexCss).toContain('scroll-padding-block: var(--bambook-detail-panel-shadow-bleed-y)');
    expect(indexCss).toContain('.bambook-tertiary-surface');
    expect(indexCss).toContain('html:not(.dark) :where(.ui-lab-real-os-root, .bambook-os-root) .bambook-tertiary-surface');
    expect(indexCss).toContain('border-color: var(--bambook-selected-light-border-color) !important;');
    expect(indexCss).toContain('background: var(--bambook-selected-light-background) !important;');
    expect(indexCss).toContain('box-shadow: var(--bambook-selected-light-shadow) !important;');
    expect(indexCss).not.toContain('linear-gradient(135deg, rgba(255, 255, 255, 0.24) 0%, rgba(255, 255, 255, 0.10) 100%) !important');
    expect(indexCss).not.toContain('linear-gradient(135deg, rgba(125, 183, 255, 0.035) 0%, rgba(74, 144, 226, 0.012) 100%) !important');
    expect(source).toContain('${relationCategoryGridClass} ${BAMBOOK_OS.layout.panelShadowViewportClass}');
    expect(source).toContain('${RELATIONS_CARD_GRID_CLASS} ${BAMBOOK_OS.layout.panelShadowViewportClass}');
    expect(formSource).toContain('<CompiledSurfacePanel');
    expect(RELATIONS_FORM_MAP_PANEL_CLASS).toBe('p-4 bambook-relations-form-map-panel');
    expect(RELATIONS_FORM_PANEL_CLASS).toBe('scroll-mt-28 p-5 bambook-relations-form-panel');
    expect(formSource).toContain('materialRole="raisedCard" spotlight isDarkMode={isDarkMode} className={RELATIONS_FORM_MAP_PANEL_CLASS}');
    expect(formSource).toContain('materialRole="raisedCard" edgeFadeItem spotlight as="section"');
    expect(formSource).not.toContain('materialRole="framePanel" edgeFadeItem spotlight as="section"');
    expect(formSource).toContain('spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}');
    expect(formSource).toContain('${BAMBOOK_OS.layout.panelShadowViewportClass}');
    expect(formSource).toContain('isDarkMode={isDarkMode}');
    expect(formSource).toContain('spotlight as="section"');
    expect(formSource).not.toContain('<SidePanelContainer spotlight isDarkMode={isDarkMode} className="p-4"');
    expect(formSource).not.toContain('<SidePanelContainer edgeFadeItem spotlight as="section"');
    expect(formSource).not.toContain('RELATIONS_FORM_PANEL_BASE_CLASS');
    expect(formSource).not.toContain('RELATIONS_FORM_PANEL_DARK_CLASS');
    expect(formSource).not.toContain('RELATIONS_FORM_PANEL_LIGHT_CLASS');
    expect(formSource).not.toContain(RELATIONS_CATEGORY_CARD_CLASS);
    expect(formSource).not.toContain('rounded-[28px]');
    expect(formSource).not.toContain('border-white/42 shadow-sm');
    expect(formSource).not.toContain('hover:bg-slate-50');
  });

  it('keeps relations helper surfaces backed by Bambook OS role tokens', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const detailPanelSource = readFileSync(new URL('./ui/DetailPanel.tsx', import.meta.url), 'utf8');

    expect(RELATIONS_PANEL_DIVIDER_CLASS).toBe(BAMBOOK_OS.tone.divider.panel);
    expect(RELATIONS_PROGRESS_TRACK_CLASS).toBe(BAMBOOK_OS.tone.surface.progressTrack);
    expect(RELATIONS_FORM_FIELD_CLASS).toBe(BAMBOOK_OS.controls.recessedField.base);
    expect(RELATIONS_FORM_FIELD_CLASS).not.toContain(OS_MATERIAL.insetSurface);
    expect(RELATIONS_FORM_MAP_INDEX_CLASS).toBe(`${OS_MATERIAL.insetSurface} ${BAMBOOK_OS.tone.surface.formMapIndex}`);
    expect(BAMBOOK_OS.tone.surface.formNestedRow).toBe('');
    expect(RELATIONS_FORM_NESTED_ROW_CLASS).toBe(OS_MATERIAL.insetSurface);
    expect(RELATIONS_FORM_ICON_ADD_CLASS).toBe(BAMBOOK_OS.controls.formIconButton.add);
    expect(RELATIONS_FORM_ICON_REMOVE_CLASS).toBe(BAMBOOK_OS.controls.formIconButton.remove);
    expect(RELATIONS_FORM_ICON_COMPACT_REMOVE_CLASS).toBe(BAMBOOK_OS.controls.formIconButton.compactRemove);
    expect(RELATIONS_FORM_INLINE_DANGER_CLASS).toBe(BAMBOOK_OS.controls.formIconButton.inlineDanger);
    expect(RELATIONS_FORM_QUIET_ACTION_CLASS).toBe(BAMBOOK_OS.controls.formIconButton.quietAction);
    expect(RELATIONS_COORDINATE_PANEL_CLASS).toBe(BAMBOOK_OS.tone.status.coordinate.panel);
    expect(RELATIONS_COORDINATE_ICON_CLASS).toBe(BAMBOOK_OS.tone.status.coordinate.icon);
    expect(RELATIONS_BRAND_INLINE_CLASS).toBe(BAMBOOK_OS.tone.text.brandInline);
    expect(RELATIONS_FORM_LABEL_CLASS).toBe(BAMBOOK_OS.tone.text.formLabel);
    expect(RELATIONS_FORM_SECTION_TITLE_CLASS).toBe('text-[var(--text-primary)] dark:text-[var(--text-secondary)]');
    expect(source).toContain('const relationFormSectionTitleClass = RELATIONS_FORM_SECTION_TITLE_CLASS;');
    expect(source).toContain('Form Map</p>');
    expect(source).toContain('${relationFormSectionTitleClass}`}>Form Map</p>');
    expect(source).toContain('<h4 className={`text-xs font-light tracking-wide mb-4 ${relationFormSectionTitleClass}`}>');
    expect(source).not.toContain("text-white/62' : 'text-slate-400");
    expect(RELATIONS_ORGANIZATION_TIER_BADGE_CLASS).toBe(BAMBOOK_OS.tone.chip.organizationTier);
    expect(RELATIONS_TABLE_HEADER_CLASS).toBe(BAMBOOK_OS.controls.table.header);
    expect(RELATIONS_TABLE_ROW_HOVER_CLASS).toBe(BAMBOOK_OS.controls.table.rowHover);
    expect(RELATIONS_TABLE_ROW_SEPARATOR_CLASS).toBe(BAMBOOK_OS.controls.table.rowSeparator);
    expect(RELATIONS_TABLE_CELL_MUTED_CLASS).toBe(BAMBOOK_OS.controls.table.cellMuted);
    expect(RELATIONS_TABLE_EDIT_ACTION_CLASS).toBe(BAMBOOK_OS.controls.table.editAction);
    expect(RELATIONS_TABLE_EMPTY_ACTION_CLASS).toBe(BAMBOOK_OS.controls.table.emptyAction);
    expect(getRelationsCoordinateStatusClass('existing')).toBe(BAMBOOK_OS.tone.status.coordinate.saved);
    expect(getRelationsCoordinateStatusClass('city')).toBe(BAMBOOK_OS.tone.status.coordinate.city);
    expect(getRelationsCoordinateStatusClass('postcode')).toBe(BAMBOOK_OS.tone.status.coordinate.postcode);
    expect(getRelationsCoordinateStatusClass('fallback')).toBe(BAMBOOK_OS.tone.status.coordinate.fallback);
    expect(getRelationsOrganizationCompletionClass(true)).toBe(RELATIONS_ORGANIZATION_COMPLETION_DONE_CLASS);
    expect(getRelationsOrganizationCompletionClass(false)).toBe(RELATIONS_ORGANIZATION_COMPLETION_MISSING_CLASS);
    expect(source).toContain('relationsPanelDividerClass');
    expect(source).toContain('relationProgressTrackClass');
    expect(source).toContain('relationFormMapIndexClass');
    expect(source).toContain('relationFormNestedRowClass');
    expect(source).toContain('relationQuietIconSurfaceClass');
    expect(source).toContain('relationFormIconAddClass');
    expect(source).toContain('relationFormIconRemoveClass');
    expect(source).toContain('relationFormIconCompactRemoveClass');
    expect(source).toContain('relationFormInlineDangerClass');
    expect(source).toContain('relationFormQuietActionClass');
    expect(source).toContain('relationCoordinatePanelClass');
    expect(source).toContain('relationCoordinateIconClass');
    expect(source).toContain('relationBrandInlineClass');
    expect(source).toContain('relationFormLabelClass');
    expect(source).not.toContain('relationOrganizationTierBadgeClass');
    expect(source).toContain('relationTableHeaderClass');
    expect(source).toContain('relationTableRowHoverClass');
    expect(source).toContain('relationTableRowSeparatorClass');
    expect(source).toContain('relationTableCellMutedClass');
    expect(source).toContain('relationTableEditActionClass');
    expect(source).toContain('relationTableEmptyActionClass');
    expect(source).toContain('getRelationsCoordinateStatusClass(resolvedCoords.source)');
    expect(source).not.toContain('getRelationsCoordinateStatusClass(resolvedCoords.source, isDarkMode)');
    expect(source).not.toContain("font-light text-[#4A90E2]\">智库");
    expect(source).not.toContain("border-white/[0.035] bg-[rgba(74,144,226,0.018)]");
    expect(source).not.toContain("hover:bg-[rgba(74,144,226,0.050)] hover:shadow-[inset_1px_0_0_rgba(125,183,255,0.30)]");
    expect(source).not.toContain("bg-[rgba(74,144,226,0.034)] text-white/35 hover:text-white hover:bg-[rgba(74,144,226,0.070)]");
    expect(detailPanelSource).toContain('BAMBOOK_OS.tone.divider.panel');
    expect(detailPanelSource).toContain('BAMBOOK_OS.tone.divider.section');
    expect(detailPanelSource).not.toContain("border-white/[0.055]' : 'border-slate-200/45");
  });

  it('keeps reporting-line edits inside the org chart instead of the contact form', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const formSource = source.slice(
      source.indexOf('id="relation-fullscreen-form"'),
      source.indexOf('</form>')
    );

    expect(formSource).not.toContain('name="reportsToId"');
    expect(formSource).not.toContain('汇报给');
    expect(formSource).not.toContain('Reports To');
    expect(source).toContain('reportsToId: editingItem?.reportsToId');
    expect(source).toContain('const handleMoveContact = (contactId: string, reportsToId?: string)');
  });

  it('applies the settings content fade primitive to the relation detail scroll viewport', () => {
    const detailPanelSource = readFileSync(new URL('./ui/DetailPanel.tsx', import.meta.url), 'utf8');

    expect(detailPanelSource).toContain("import { CompiledEdgeFade, CompiledSurfacePanel } from './osCompiler/compiledSurfacePrimitives'");
    expect(detailPanelSource).not.toContain("import ScrollEdgeFades from './ScrollEdgeFades'");
    expect(detailPanelSource).toContain('const detailScrollRef = useRef<HTMLDivElement | null>(null);');
    expect(detailPanelSource).toContain('materialRole="insetSurface"');
    expect(detailPanelSource).toContain('materialTone="nested"');
    expect(detailPanelSource).toContain('<CompiledEdgeFade scrollRef={detailScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={64} bottomHeight={72} source="DetailPanel.edgeFade" />');
    expect(detailPanelSource).toContain('ref={detailScrollRef}');
    expect(detailPanelSource).toContain('flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-5 pb-8');
  });

  it('aligns light tertiary relation containers to the selected button rim and highlight primitive', () => {
    const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    const osVnextCss = readFileSync(new URL('../styles/os-vnext.css', import.meta.url), 'utf8');
    const tertiarySurfaceSource = indexCss.slice(
      indexCss.indexOf('html:not(.dark) :where(.ui-lab-real-os-root, .bambook-os-root) .bambook-tertiary-surface'),
      indexCss.indexOf('.dark .bambook-tertiary-surface')
    );

    expect(osVnextCss).toContain('--bambook-selected-light-border-color: transparent;');
    expect(osVnextCss).toContain('--bambook-selected-light-background: rgba(255, 255, 255, 0.42);');
    expect(osVnextCss).toContain('--bambook-selected-light-shadow:');
    expect(tertiarySurfaceSource).toContain('border-color: var(--bambook-selected-light-border-color) !important;');
    expect(tertiarySurfaceSource).toContain('background: var(--bambook-selected-light-background) !important;');
    expect(tertiarySurfaceSource).toContain('box-shadow: var(--bambook-selected-light-shadow) !important;');
    expect(tertiarySurfaceSource).not.toContain('rgba(255, 255, 255, 0.24)');
  });

  it('aligns the contact list and org chart detail views to the current glass UI direction', () => {
    const contactListSource = readFileSync(new URL('./ui/ContactList.tsx', import.meta.url), 'utf8');
    const orgChartSource = readFileSync(new URL('./ui/OrgChart.tsx', import.meta.url), 'utf8');
    const detailPanelSource = readFileSync(new URL('./ui/DetailPanel.tsx', import.meta.url), 'utf8');
    const managerSource = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');

    expect(contactListSource).toContain("import { CompiledEdgeFade, CompiledSurfacePanel } from './osCompiler/compiledSurfacePrimitives'");
    expect(contactListSource).not.toContain("import SidePanelContainer from './SidePanelContainer'");
    expect(contactListSource).toContain('CONTACT_LIST_ACTIVE_DARK_CLASS');
    expect(contactListSource).toContain('CONTACT_LIST_ACTIVE_LIGHT_CLASS');
    expect(contactListSource).toContain('CONTACT_LIST_HOVER_DARK_CLASS');
    expect(contactListSource).toContain('CONTACT_LIST_HOVER_LIGHT_CLASS');
    expect(contactListSource).toContain('const activeItemClass =');
    expect(contactListSource).toContain('${CONTACT_LIST_ACTIVE_LIGHT_CLASS} dark:text-[var(--text-primary)]');
    expect(contactListSource).toContain('? activeItemClass');
    expect(contactListSource).toContain('const idleItemClass =');
    expect(contactListSource).toContain('border border-transparent bg-transparent shadow-none ${CONTACT_LIST_HOVER_LIGHT_CLASS}');
    expect(contactListSource).toContain(': idleItemClass');
    expect(contactListSource).not.toContain('border-transparent ${SIDEBAR_ACTIVE_DARK_CLASS}');
    expect(contactListSource).not.toContain('border-transparent ${SIDEBAR_ACTIVE_LIGHT_CLASS}');
    expect(contactListSource).not.toContain('border-transparent ${SIDEBAR_HOVER_DARK_CLASS}');
    expect(contactListSource).not.toContain('border-transparent ${SIDEBAR_HOVER_LIGHT_CLASS}');
    expect(contactListSource).not.toContain('0_14px_30px_-24px');
    expect(contactListSource).not.toContain('0_12px_24px_-20px');
    expect(contactListSource).not.toContain('0_12px_24px_-22px');
    expect(contactListSource).toContain('w-4 shrink-0 text-center');
    expect(contactListSource).toContain('charAt(0)');
    expect(contactListSource).toContain('<CompiledSurfacePanel');
    expect(contactListSource).toContain('<CompiledEdgeFade');
    expect(contactListSource).toContain('source="ContactList.edgeFade"');
    expect(contactListSource).not.toContain('<SidePanelContainer');
    expect(contactListSource).not.toContain('spotlight');
    expect(managerSource).toContain("flex-1 min-h-0 relative overflow-visible");
    expect(managerSource).toContain('absolute inset-x-0 top-0 ${relationsMainBottomEdgeClass} min-h-0 flex overflow-visible');
    expect(managerSource).not.toContain('slide-in-from-right-4');
    expect(BAMBOOK_OS.layout.relationsDetailListWidth).toBe(280);
    expect(BAMBOOK_OS.layout.relationsDetailListShellClass).toBe('h-full min-h-0 shrink-0 p-4 pr-3 pb-0');
    expect(BAMBOOK_OS.layout.relationsDetailListPanelClass).toBe('w-[280px] h-full flex flex-col bambook-sibling-panel-no-bleed');
    expect(BAMBOOK_OS.layout.relationsDetailMainShellClass).toBe('flex-1 min-w-0 h-full min-h-0 p-4 pl-3 pb-0');
    expect(contactListSource).toContain('className={BAMBOOK_OS.layout.relationsDetailListShellClass}');
    expect(contactListSource).toContain('className={BAMBOOK_OS.layout.relationsDetailListPanelClass}');
    expect(contactListSource).toContain("import { BAMBOOK_OS } from './bambookOsTokens'");
    expect(contactListSource).toContain('BAMBOOK_OS.controls.recessedField.base');
    expect(BAMBOOK_OS.controls.recessedField.base).toContain('placeholder-white/34');
    // recessedField 为 flat 雕刻配方：rgba 任意值绕开护栏，保留可见描边（禁 backdrop-blur 触发子串）
    expect(BAMBOOK_OS.controls.recessedField.base).toContain('border-[rgba(255,255,255,0.10)]');
    expect(BAMBOOK_OS.controls.recessedField.base).toContain('border-[rgba(15,23,42,0.10)]');
    expect(contactListSource).toContain('BAMBOOK_OS.controls.actionControl.bordered');
    expect(contactListSource).not.toContain('border-r backdrop-blur-xl');
    expect(contactListSource).not.toContain('focus:border-[#4A90E2]');
    expect(contactListSource).not.toContain('bambook-blue-white-light');
    expect(contactListSource).not.toContain('inset_0_1px_0_rgba(255,255,255,0.13)');

    expect(orgChartSource).toContain("import { CompiledSurfacePanel } from './osCompiler/compiledSurfacePrimitives'");
    expect(orgChartSource).not.toContain("import SidePanelContainer from './SidePanelContainer'");
    expect(orgChartSource).not.toContain("import { SpotlightCard } from './SpotlightCard'");
    expect(orgChartSource).toContain("import { BAMBOOK_OS } from './bambookOsTokens'");
    expect(orgChartSource).toContain('ZoomIn, ZoomOut, RotateCcw');
    expect(orgChartSource).toContain('ORG_CHART_MIN_ZOOM');
    expect(orgChartSource).toContain('const [zoom, setZoom] = useState(1)');
    expect(orgChartSource).toContain('const [pan, setPan] = useState({ x: 0, y: 0 })');
    expect(orgChartSource).toContain('const [focusedContactId, setFocusedContactId] = useState<string | null>(null)');
    expect(orgChartSource).toContain('handleViewportWheel');
    expect(orgChartSource).toContain('updatePan(current => ({');
    expect(orgChartSource).toContain('x: current.x - event.deltaX');
    expect(orgChartSource).toContain('y: current.y - event.deltaY');
    expect(orgChartSource).toContain('handleCanvasPointerDown');
    expect(orgChartSource).toContain('handleFocusContact');
    expect(orgChartSource).toContain('onDoubleClick={(event) =>');
    expect(orgChartSource).toContain('flex min-w-full justify-center');
    expect(orgChartSource).toContain('w-max flex flex-col items-center');
    expect(orgChartSource).toContain('style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, transformOrigin:');
    expect(orgChartSource).toContain('w-4 shrink-0 text-center');
    expect(orgChartSource).toContain('contact.name.charAt(0)');
    expect(orgChartSource).toContain('ORG_CHART_NODE_CLASS');
    expect(orgChartSource).toContain('BAMBOOK_OS.material.panelBase');
    expect(orgChartSource).toContain('BAMBOOK_OS.material.glassColor');
    expect(orgChartSource).toContain('bambook-outer-panel !rounded-inset');
    expect(orgChartSource).not.toContain('BAMBOOK_OS.material.compactCardDark');
    expect(orgChartSource).not.toContain('BAMBOOK_OS.material.compactCardLight');
    expect(orgChartSource).not.toContain('BAMBOOK_OS.spotlight.compactCardDarkColor');
    expect(orgChartSource).not.toContain('BAMBOOK_OS.spotlight.compactCardLightColor');
    expect(orgChartSource).toContain('BAMBOOK_OS.controls.floatingToolCluster.surface');
    expect(orgChartSource).toContain('className="absolute right-6 top-5 z-30"');
    expect(orgChartSource).toContain('className="relative z-20 mr-[158px] p-3"');
    expect(orgChartSource).not.toContain('absolute right-6 top-[72px] z-30');
    expect(orgChartSource).toContain('BAMBOOK_OS.controls.orgChartMeta.edit');
    expect(orgChartSource).toContain('absolute -top-2 -right-2 z-30 p-1.5');
    expect(orgChartSource).toContain('aria-label={`编辑${contact.name}`}');
    expect(orgChartSource).toContain('BAMBOOK_OS.controls.orgChartMeta.childrenBadge');
    expect(orgChartSource).toContain('<CompiledSurfacePanel');
    expect(orgChartSource).toContain('source="OrgChart.LegendPanel"');
    expect(orgChartSource).not.toContain('<SidePanelContainer');
    expect(orgChartSource).not.toContain('<SpotlightCard');
    expect(orgChartSource).not.toContain('Command Center');
    expect(orgChartSource).not.toContain('bambook-blue-white-light');
    expect(orgChartSource).not.toContain("bg-[rgba(13,27,42,0.42)] border-white/[0.08]");
    expect(orgChartSource).not.toContain("bg-[#0d1b2a]/72 text-white/58 shadow-[0_8px_20px_-16px_rgba(0,0,0,0.5)]");

    expect(detailPanelSource).toContain("import { CompiledEdgeFade, CompiledSurfacePanel } from './osCompiler/compiledSurfacePrimitives'");
    expect(detailPanelSource).not.toContain("import SidePanelContainer from './SidePanelContainer'");
    expect(detailPanelSource).not.toContain("import ScrollEdgeFades from './ScrollEdgeFades'");
    expect(detailPanelSource).toContain("import { BAMBOOK_OS } from './bambookOsTokens'");
    expect(detailPanelSource).toContain('const detailScrollRef = useRef<HTMLDivElement | null>(null);');
    expect(detailPanelSource).toContain('BAMBOOK_OS.controls.actionControl.bordered');
    expect(detailPanelSource).toContain('const detailMaterialClass = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-outer-panel`;');
    expect(detailPanelSource).toContain('const inlinePanelClass = `${detailMaterialClass} bambook-tertiary-surface !rounded-control relative isolate overflow-hidden`;');
    expect(detailPanelSource).not.toContain('const linkedPanelClass');
    expect(detailPanelSource).not.toContain("const inlinePanelClass = 'bambook-card-glass relative isolate overflow-hidden'");
    expect(detailPanelSource).not.toContain('BAMBOOK_OS.tone.surface.inlinePanelDark');
    expect(detailPanelSource).not.toContain('BAMBOOK_OS.tone.surface.linkedPanelDark');
    expect(detailPanelSource).toContain('<CompiledSurfacePanel');
    expect(detailPanelSource).toContain('source="DetailPanel.MainPanel"');
    expect(detailPanelSource).toContain('source="DetailPanel.InfoSection"');
    expect(detailPanelSource).not.toContain('<SidePanelContainer');
    expect(detailPanelSource).not.toContain('spotlight');
    expect(detailPanelSource).toContain('materialRole="insetSurface"');
    expect(detailPanelSource).toContain('materialTone="nested"');
    expect(detailPanelSource).toContain('<InfoSection title="所属组织" icon={<Building2 size={14} />} isDarkMode={isDarkMode}>');
    expect(detailPanelSource).not.toContain('contentClassName="relative z-10 flex items-center gap-3"');
    expect(detailPanelSource).not.toContain('!rounded-[22px]');
    expect(detailPanelSource).toContain('className="h-full flex flex-col"');
    expect(detailPanelSource).toContain('<CompiledEdgeFade scrollRef={detailScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={64} bottomHeight={72} source="DetailPanel.edgeFade" />');
    expect(detailPanelSource).toContain('ref={detailScrollRef}');
    expect(detailPanelSource).toContain('${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-detail-panel-shadow-viewport');
    expect(contactListSource).toContain('className={BAMBOOK_OS.layout.relationsDetailListShellClass}');
    expect(contactListSource).not.toContain("import ScrollEdgeFades from './ScrollEdgeFades'");
    expect(contactListSource).toContain('scrollRef={contactListScrollRef}');
    expect(contactListSource).not.toContain('spotlight');
    expect(contactListSource).toContain('const idleItemClass =');
    expect(contactListSource).toContain('? activeItemClass');
    expect(contactListSource).toContain('border border-transparent bg-transparent shadow-none');
    expect(contactListSource).not.toContain('idleItemMaterialClass');
    expect(contactListSource).not.toContain('${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-outer-panel !rounded-[18px]`');
    expect(contactListSource).not.toContain('BAMBOOK_OS.material.nestedActiveSurface');
    expect(contactListSource).not.toContain('bambook-card-glass');
    expect(contactListSource).toContain('flex-1 min-h-0 overflow-y-auto');
    expect(detailPanelSource).toContain('className={BAMBOOK_OS.layout.relationsDetailMainShellClass}');
    expect(detailPanelSource).toContain('flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-5 pb-8');
    expect(detailPanelSource).toContain('as="section"');
    expect(detailPanelSource).toContain('className="p-3.5 !rounded-inset"');
    expect(detailPanelSource).not.toContain('rounded-[22px] border p-4');
    expect(detailPanelSource).not.toContain('Command Center');
    expect(detailPanelSource).not.toContain('bambook-blue-white-light');
    expect(detailPanelSource).not.toContain('shrink-0 p-6 border-b backdrop-blur-xl');
    expect(detailPanelSource).not.toContain("bg-[rgba(74,144,226,0.030)] text-white/70");
  });

  it('keeps light panel secondary text and quiet icons above washed-out gray', () => {
    const detailPanelSource = readFileSync(new URL('./ui/DetailPanel.tsx', import.meta.url), 'utf8');
    const contactListSource = readFileSync(new URL('./ui/ContactList.tsx', import.meta.url), 'utf8');
    const orgChartSource = readFileSync(new URL('./ui/OrgChart.tsx', import.meta.url), 'utf8');
    const settingsSource = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
    const dataTwinSource = readFileSync(new URL('./DataCenter.tsx', import.meta.url), 'utf8');
    const appCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

    expect(BAMBOOK_OS.tone.text.quiet).toContain('text-slate-600');
    expect(BAMBOOK_OS.tone.text.formLabel).toContain('text-slate-500');
    expect(appCss).toContain('html:not(.dark) .glass-panel .text-slate-400');
    expect(appCss).toContain('html:not(.dark) .bambook-panel-glass .text-slate-400');
    expect(appCss).toContain('color: rgb(71, 85, 105)');
    expect(appCss).toContain('html:not(.dark) .glass-panel .text-slate-500');
    expect(appCss).toContain('color: rgb(71, 85, 105)');
    expect(BAMBOOK_OS.tone.surface.formMapIndex).toContain('text-slate-500');
    expect(BAMBOOK_OS.tone.surface.formMapIndex).not.toContain('text-slate-400');
    expect(BAMBOOK_OS.controls.formIconButton.remove).toContain('text-slate-500');
    expect(BAMBOOK_OS.controls.formIconButton.remove).not.toContain('text-slate-300');
    expect(BAMBOOK_OS.controls.formIconButton.compactRemove).toContain('text-slate-500');
    expect(BAMBOOK_OS.controls.formIconButton.quietAction).toContain('text-slate-500');
    expect(BAMBOOK_OS.controls.orgChartMeta.edit).toContain('text-slate-500');
    expect(BAMBOOK_OS.controls.orgChartMeta.childrenBadge).toContain('text-slate-500');

    expect(detailPanelSource).not.toContain("isDarkMode ? 'text-white/40' : 'text-slate-400'");
    expect(detailPanelSource).not.toContain("isDarkMode ? 'text-white/46' : 'text-slate-400'");
    expect(detailPanelSource).not.toContain("isDarkMode ? 'text-white/58' : 'text-slate-500'");
    expect(contactListSource).not.toContain("isDarkMode ? 'text-white/46' : 'text-slate-400'");
    expect(contactListSource).not.toContain("isDarkMode ? 'text-white/38' : 'text-slate-400'");
    expect(orgChartSource).not.toContain("isDarkMode ? 'text-white/46' : 'text-slate-400'");
    expect(settingsSource).not.toContain("isDarkMode ? 'text-slate-500' : 'text-slate-400'");
    expect(dataTwinSource).not.toContain('text-slate-400">绘制组件');
    expect(dataTwinSource).not.toContain('text-slate-400">属性');
    expect(dataTwinSource).not.toContain('font-light text-slate-400">{item.hint}');
  });

  it('keeps fullscreen form edge fade CSS-fixed instead of hook-driven', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const formOverlaySource = source.slice(
      source.indexOf('{showAddModal &&'),
      source.indexOf('id="relation-fullscreen-form"')
    );
    const formSource = source.slice(
      source.indexOf('id="relation-fullscreen-form"'),
      source.indexOf('</form>')
    );
    expect(source).toContain("import { useGlassSurfaceEdgeMasks } from './ui/useGlassSurfaceEdgeMasks'");
    expect(source).not.toContain("import ScrollEdgeFades from './ui/ScrollEdgeFades'");
    expect(formSource).not.toContain('<ScrollEdgeFades');
    expect(source).not.toContain('const relationFormFadeBoundaryRef = useRef<HTMLDivElement | null>(null);');
    expect(source).toContain('scrollRef: relationFormScrollRef');
    expect(source).not.toContain('boundaryRef: relationFormFadeBoundaryRef');
    expect(source).toContain('enabled: showAddModal');
    expect(formOverlaySource).not.toContain('scrollRef={relationFormScrollRef}');
    expect(formOverlaySource).not.toContain('maskRef=');
    expect(formOverlaySource).not.toContain('topOffset={30}');
    expect(formOverlaySource).toContain('${relationsFormBottomEdgeClass} z-[70]');
    expect(formOverlaySource).not.toContain('${BAMBOOK_OS.layout.desktopMainPanelBottomEdgeClass} z-[70]');
    expect(formOverlaySource).not.toContain('bottom-4');
    expect(source).not.toContain('relationFormContentMaskRef');
    expect(formOverlaySource).toContain('overflow-hidden flex flex-col');
    expect(formSource).toContain('ref={relationFormScrollRef}');
    expect(formSource).not.toContain('relationFormFadeBoundaryRef');
    expect(formSource).not.toContain('bambook-form-fixed-edge-mask');
    expect(formSource).not.toContain('bambook-form-edge-fade-frame');
    expect(formSource).not.toContain('bambook-form-edge-fade bambook-form-edge-fade-top');
    expect(formSource).not.toContain('bambook-form-edge-fade bambook-form-edge-fade-bottom');
    expect(formSource).toContain('-mt-[112px]');
    expect(formSource).toContain('h-[calc(100%+7rem)]');
    expect(formSource).toContain('pt-24');
    expect(formSource).toContain('overflow-y-auto');
    expect(formSource).toContain('bambook-relation-form-scroll-viewport');
  });

  it('keeps organization grid glass material aligned with category cards', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const listStart = source.indexOf('{/* VIEW 2: ORGANIZATION LIST */}');
    const listSource = source.slice(
      listStart,
      source.indexOf("className={relationListDisplayMode === 'grid'", listStart)
    );
    const listMaskHookSource = source.slice(
      source.indexOf('scrollRef: relationListScrollRef'),
      source.indexOf('// 打开弹窗时锁定 body 滚动')
    );
    const sharedCardStart = source.indexOf('const renderRelationCard = ({');
    const sharedCardSource = source.slice(sharedCardStart, source.indexOf('\n\n  return (', sharedCardStart));

    expect(source).toContain('const relationListScrollRef = useRef<HTMLDivElement | null>(null)');
    expect(source).toContain('const relationTableScrollRef = useRef<HTMLDivElement | null>(null)');
    expect(listMaskHookSource).toContain('scrollRef: relationListScrollRef');
    expect(listMaskHookSource).toContain("enabled: navLevel === 'organizations' && relationListDisplayMode === 'grid' && !showAddModal");
    expect(listMaskHookSource).toContain('topHeight: 32');
    expect(listMaskHookSource).toContain('topFadeStartOffset: RELATIONS_CARD_GRID_EDGE_FADE_TOP_OFFSET');
    expect(listMaskHookSource).toContain('bottomHeight: 48');
    expect(source).not.toContain('<ScrollEdgeFades');
    expect(source).toContain('scrollRef: relationTableScrollRef');
    expect(source).toContain("enabled: navLevel === 'organizations' && relationListDisplayMode === 'table' && !showAddModal");
    expect(source).toContain('topHeight: 56');
    expect(source).toContain('bottomHeight: 72');
    expect(source).toContain("bottomFadeActivation: 'zone'");
    expect(listSource).not.toContain('renderMode="overlay"');
    expect(listSource).toContain('ref={relationListScrollRef}');
    expect(source).toContain('scrollRef={relationTableScrollRef}');
    expect(listSource).not.toContain('{renderRelationListToolbar(toolbarInsetClass)}');
    expect(sharedCardSource).toMatch(/<CompiledMotionInteractiveCard\s+as="button"\s+type="button"[\s\S]*?data-glass-edge-mask/);
    expect(sharedCardSource).toContain('spotlightColor={isDarkMode ? RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR : RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR}');
    expect(sharedCardSource).toContain('liquidSpotlightTone="light"');
    expect(source).toContain('currentOrganizations.map((org, idx) => renderRelationCard({');
    expect(source).toContain("navLevel === 'organizations'");
    expect(source).toContain("renderRelationListToolbar('', false)");
    expect(source).toContain('className="flex h-full flex-1 min-w-0 items-center justify-center"');
    expect(source).not.toContain('relationToolbarStyle');
    expect(source).not.toContain('setRelationCardRowWidth');
  });

  it('uses the same icon size for title left and right arrows', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const titleSource = source.slice(
      source.indexOf('Primary Header - fixed'),
      source.indexOf('Level 3: transparent tab row')
    );
    const formTitleSource = source.slice(
      source.indexOf('{/* Header */}'),
      source.indexOf('{/* Form */}')
    );

    expect(RELATIONS_TITLE_ARROW_ICON_SIZE).toBe(18);
    expect(`${titleSource}\n${formTitleSource}`).toContain('size={RELATIONS_TITLE_ARROW_ICON_SIZE}');
    expect(`${titleSource}\n${formTitleSource}`).not.toMatch(/Chevron(?:Left|Right) size=\\{(?:14|16|20)\\}/);
  });

  it('keeps title action buttons quiet while title navigation stays text-only', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const titleSource = source.slice(
      source.indexOf('Primary Header - fixed'),
      source.indexOf('Level 3: transparent tab row')
    );
    const formTitleSource = source.slice(
      source.indexOf('{/* Header */}'),
      source.indexOf('{/* Form */}')
    );
    const combinedTitleSource = `${titleSource}\n${formTitleSource}`;
    const titleSpotlightButtonSource = source.slice(
      source.indexOf('const RelationsTitleSpotlightButton'),
      source.indexOf('const RelationsManager')
    );

    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('bambook-dashboard-glass-color');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('bambook-blue-white-light');
    expect(RELATIONS_TITLE_BUTTON_CLASS).toContain('bg-transparent');
    expect(RELATIONS_TITLE_BUTTON_CLASS).toContain('!border-transparent');
    expect(RELATIONS_TITLE_BUTTON_CLASS).toContain('shadow-none');
    expect(RELATIONS_TITLE_BUTTON_CLASS).toContain('text-[var(--os-adaptive-primary)]');
    expect(RELATIONS_TITLE_BUTTON_CLASS).toContain(SIDEBAR_HOVER_DARK_CLASS);
    expect(RELATIONS_TITLE_BUTTON_CLASS).toContain(SIDEBAR_PRESS_DARK_CLASS);
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('hover:text-[#4A90E2]');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('0_0_0_1px_rgba(96,165,250,0.20)');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('inset_0_0_0_1px');
    expect(RELATIONS_TITLE_BUTTON_CLASS).toContain('active:scale-[0.98]');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('hover:bg-[#4A90E2]/15');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('hover:border-[#4A90E2]');
    expect(RELATIONS_TITLE_BUTTON_CLASS.split(' ')).not.toContain('bg-[#4A90E2]/15');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('hover:text-[#0A2746]');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('0_0_0_1px_rgba(74,144,226,0.24)');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('hover:bg-blue-50/80');
    expect(RELATIONS_TITLE_BUTTON_CLASS).not.toContain('hover:border-blue');
    expect(RELATIONS_TITLE_SPOTLIGHT_DARK_COLOR).toBe(RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR);
    expect(RELATIONS_TITLE_SPOTLIGHT_LIGHT_COLOR).toBe(RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR);
    expect(RELATIONS_TITLE_SPOTLIGHT_DARK_SIZE).toBe(180);
    expect(RELATIONS_TITLE_SPOTLIGHT_LIGHT_SIZE).toBe(140);
    expect(titleSpotlightButtonSource).toContain('<SpotlightCard');
    expect(titleSpotlightButtonSource).toContain('spotlightColor={isDarkMode ? RELATIONS_TITLE_SPOTLIGHT_DARK_COLOR : RELATIONS_TITLE_SPOTLIGHT_LIGHT_COLOR}');
    expect(titleSpotlightButtonSource).toContain('spotlightSize={isDarkMode ? RELATIONS_TITLE_SPOTLIGHT_DARK_SIZE : RELATIONS_TITLE_SPOTLIGHT_LIGHT_SIZE}');
    expect(titleSpotlightButtonSource).toContain('idleSpotlightOpacity={0}');
    expect(titleSpotlightButtonSource).toContain('activeSpotlightOpacity={1}');
    expect(titleSpotlightButtonSource).not.toContain('spotlightClassName="inset-0"');
    expect(combinedTitleSource).toContain('<RelationsTitleSpotlightButton');
    expect(combinedTitleSource).toContain('RELATIONS_TITLE_BUTTON_CLASS');
    expect(titleSource).toContain('RELATIONS_TITLE_TEXT_BUTTON_CLASS');
    expect(titleSource).toContain('RELATIONS_TITLE_SECTION_BUTTON_CLASS');
    expect(formTitleSource).toContain('RELATIONS_TITLE_TEXT_BUTTON_CLASS');
    expect(combinedTitleSource).not.toContain('h-8 max-w-[160px] truncate rounded-2xl border px-3');
    expect(combinedTitleSource).not.toContain('wrapperClassName={`h-8 max-w-[160px]');
    expect(combinedTitleSource).not.toContain('hover:text-[#4A90E2]');
    expect(combinedTitleSource).not.toContain('border-slate-200/70 text-slate-500 hover:border-blue-200');
  });

  it('keeps the option toolbar aligned to the title strip in expanded and collapsed sidebar modes', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');

    expect(RELATIONS_PAGE_X_NORMAL_CLASS).toContain('px-5');
    expect(RELATIONS_TOOLBAR_X_NORMAL_CLASS).toBe('mx-auto');
    expect(RELATIONS_PAGE_X_COLLAPSED_CLASS).toBe('px-5');
    expect(RELATIONS_TITLE_SAFE_LEFT_STYLE).toEqual({ paddingLeft: 'max(2rem, calc(152px - (100vw - 100%)))' });
    expect(BAMBOOK_OS.layout.desktopTitleSafeLeftStyle).toEqual({});
    expect(RELATIONS_TOOLBAR_X_COLLAPSED_CLASS).toBe('mx-auto');
    expect(RELATIONS_PAGE_X_COLLAPSED_CLASS).not.toContain('pl-[152px]');
    expect(source).toContain('max(2rem, calc(152px - (100vw - 100%)))');
    expect(RELATIONS_TOOLBAR_X_COLLAPSED_CLASS).not.toContain('ml-20');
    expect(RELATIONS_TOOLBAR_CONTENT_CLASS).toContain('px-3');
  });

  it('keeps the option toolbar as one compact glass bar with fixed search width', () => {
    expect(RELATIONS_TOOLBAR_OFFSET_CLASS).toContain('mt-1');
    expect(RELATIONS_TOOLBAR_CLASS).toContain('w-full');
    expect(RELATIONS_TOOLBAR_CLASS).toContain('max-w-[560px]');
    expect(RELATIONS_TOOLBAR_CLASS).toContain('min-w-0');
    expect(RELATIONS_TOOLBAR_CLASS).toContain('h-9');
    expect(RELATIONS_TOOLBAR_CLASS).toContain('!rounded-2xl');
    expect(RELATIONS_TOOLBAR_CLASS).toContain('group');
    expect(RELATIONS_TOOLBAR_CLASS).not.toContain('rounded-xl');
    expect(RELATIONS_TOOLBAR_CLASS).toContain('border');
    expect(RELATIONS_TOOLBAR_CLASS).toContain('backdrop-blur');
    expect(RELATIONS_TOOLBAR_CONTENT_CLASS).toContain('flex-nowrap');
    expect(RELATIONS_TOOLBAR_CONTENT_CLASS).toContain('gap-3');
    expect(RELATIONS_TOOLBAR_CONTENT_CLASS).toContain('px-3');
    expect(RELATIONS_TOOLBAR_CLASS).not.toContain('overflow-hidden');
    expect(RELATIONS_TITLE_ICON_BUTTON_CLASS).toContain('rounded-2xl');
    expect(RELATIONS_TITLE_ACTION_BUTTON_CLASS).toContain('rounded-full');
    expect(BAMBOOK_OS.typography.weight.ui).toBe('font-light');
    expect(BAMBOOK_OS.typography.weight.tableHeader).toBe('font-light');
    expect(RELATIONS_TITLE_ACTION_BUTTON_CLASS).toContain(BAMBOOK_OS.typography.weight.ui);
    expect(RELATIONS_TITLE_PAGE_LABEL_CLASS).toContain(BAMBOOK_OS.typography.weight.ui);
    expect(RELATIONS_TOOLBAR_CONTENT_CLASS).toContain('flex-nowrap');
    expect(RELATIONS_TOOLBAR_CLASS).not.toContain('overflow-hidden');
    expect(RELATIONS_TOOLBAR_CLASS).not.toContain('flex-wrap');
    expect(RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS).toContain('max-w-[320px]');
    expect(RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS).toContain('flex-[0_1_320px]');
    expect(RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS).toContain('min-w-[180px]');
    expect(RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS).not.toContain('xl:w-[280px]');
    expect(RELATIONS_TOOLBAR_SEARCH_EXPANDED_CLASS).toBe(RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS);
    expect(RELATIONS_TOOLBAR_SEARCH_SHELL_CLASS).toContain('focus-within:translate-y-[1px]');
    expect(RELATIONS_TOOLBAR_SEARCH_SHELL_CLASS).toContain('transition-transform');
    expect(RELATIONS_TOOLBAR_VIEW_GROUP_CLASS).toContain('ml-auto');
    expect(RELATIONS_TOOLBAR_VIEW_GROUP_CLASS).toContain('gap-1');
    expect(RELATIONS_TOOLBAR_SORT_CLASS).toBe('w-[104px] shrink-0');
    expect(RELATIONS_TOOLBAR_AMBIENT_CLASS).toBe('hidden');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).toContain('glass-panel');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).toContain('bambook-blue-white-surface');
    expect(getRelationsCardRowWidth(624)).toBe(316);
    expect(getRelationsCardRowWidth(656)).toBe(656);
    expect(getRelationsCardRowWidth(948)).toBe(656);
    expect(getRelationsCardRowWidth(996)).toBe(996);
    expect(RELATIONS_CARD_COLUMN_WIDTH).toBe(316);
    expect(RELATIONS_CARD_COLUMN_GAP).toBe(24);
  });

  it('aligns toolbar inner controls to the title button height and radius', () => {
    const customSelectSource = readFileSync(new URL('./ui/CustomSelect.tsx', import.meta.url), 'utf8');

    expect(RELATIONS_TOOLBAR_SEGMENT_CLASS).toContain('h-9');
    expect(RELATIONS_TOOLBAR_SEGMENT_CLASS).toContain('rounded-none');
    expect(RELATIONS_TOOLBAR_SEGMENT_CLASS).toContain('relative');
    expect(RELATIONS_TOOLBAR_SEGMENT_CLASS).toContain('overflow-visible');
    expect(RELATIONS_TOOLBAR_SEGMENT_CLASS).toContain('p-0');
    expect(RELATIONS_TOOLBAR_SEGMENT_CLASS).toContain('items-center');
    expect(RELATIONS_TOOLBAR_SEGMENT_CLASS).not.toContain('p-0.5');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).toContain('h-9');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).toContain('w-7');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).toContain('rounded-none');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).toContain('bg-transparent');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).toContain('border-0');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).toContain('shadow-none');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).toContain('relative z-20');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).toContain(BAMBOOK_OS.typography.weight.ui);
    expect(RELATIONS_FORM_TITLE_CRUMB_CLASS).toContain(BAMBOOK_OS.typography.weight.ui);
    expect(RELATIONS_FORM_TITLE_SECONDARY_BUTTON_CLASS).toContain(BAMBOOK_OS.typography.weight.ui);
    expect(RELATIONS_FORM_TITLE_SUBMIT_BUTTON_CLASS).toContain(BAMBOOK_OS.typography.weight.ui);
    expect(BAMBOOK_OS.controls.title.actionButton).not.toContain('font-medium');
    expect(BAMBOOK_OS.controls.title.pageLabel).not.toContain('font-medium');
    expect(BAMBOOK_OS.controls.title.viewSwitchButton).not.toContain('font-medium');
    expect(RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS).not.toContain('py-1.5');
    expect(customSelectSource).toContain("isInlineToolbarTrigger ? 'h-9 px-2' : 'h-9 px-3'");
    expect(customSelectSource).toContain("isInlineToolbarTrigger ? 'rounded-control' : 'rounded-full'");
    expect(customSelectSource).toContain("'h-9 px-3 py-0 rounded-full text-xs leading-none'");
    expect(customSelectSource).not.toContain("'px-4 py-3 rounded-xl text-[12px]'");
    expect(customSelectSource).toContain("'absolute top-full left-0 right-0 mt-2 z-50'");
    expect(customSelectSource).not.toContain('relative overflow-hidden rounded-2xl p-1');
  });

  it('adapts direct-on-wallpaper relation title navigation and actions', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data-ui-lab-wallpaper-contrast="primary"');
    expect(source).toContain('data-ui-lab-wallpaper-contrast="primary">关系</span><span className={BAMBOOK_OS.layout.desktopTitleAccentClass}>智库</span>');
    expect(source).toContain('data-ui-lab-wallpaper-contrast="secondary" className={RELATIONS_TITLE_SEPARATOR_CLASS}');
    expect(source).toContain('className={`${RELATIONS_TITLE_SECTION_BUTTON_CLASS} text-[var(--os-adaptive-subtitle)] hover:text-[var(--os-adaptive-primary)] transition-colors`}');
    expect(source).toContain('<span className={`${RELATIONS_TITLE_PAGE_LABEL_CLASS} text-[var(--os-adaptive-primary)]`}>');
    expect(source).toContain('data-ui-lab-wallpaper-contrast="primary" className={`${RELATIONS_FORM_TITLE_HEADING_CLASS}');
    expect(source).toContain('className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2 text-inherit"');
  });

  it('keeps grid and table toggles containerless and changes icons in place', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const toolbarSource = source.slice(
      source.indexOf('const renderRelationListToolbar'),
      source.indexOf('// --- Handlers ---')
    );

    expect(toolbarSource).not.toContain('RELATIONS_TOOLBAR_SEGMENT_THUMB_CLASS');
    expect(toolbarSource).not.toContain('translate-x-[');
    expect(toolbarSource).toContain('RELATIONS_TOOLBAR_SEGMENT_ACTIVE_CLASS');
    expect(toolbarSource).toContain("onClick={() => setRelationListDisplayMode(relationListDisplayMode === 'grid' ? 'table' : 'grid')}");
    expect(toolbarSource).toContain("relationListDisplayMode === 'grid' ? (");
    expect(toolbarSource).toContain('<List size={13} strokeWidth={1.5} />');
    expect(toolbarSource).toContain('<LayoutGrid size={13} strokeWidth={1.5} />');
    expect(RELATIONS_TOOLBAR_SEGMENT_ACTIVE_CLASS).toContain('text-[var(--os-vnext-brand-blue)]');
    expect(RELATIONS_TOOLBAR_SEGMENT_ACTIVE_CLASS).toContain('dark:text-[var(--text-primary)]');
    expect(toolbarSource).not.toContain("relationListDisplayMode === 'grid' ? (isDarkMode ? RELATIONS_TOOLBAR_CONTROL_SELECTED");
    expect(toolbarSource).not.toContain("relationListDisplayMode === 'table' ? (isDarkMode ? RELATIONS_TOOLBAR_CONTROL_SELECTED");
  });

  it('uses one outer toolbar frame with floating inner controls', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const toolbarSource = source.slice(
      source.indexOf('const renderRelationListToolbar'),
      source.indexOf('// --- Handlers ---')
    );
    const customSelectSource = readFileSync(new URL('./ui/CustomSelect.tsx', import.meta.url), 'utf8');
    const toolbarSelectSource = customSelectSource.slice(
      customSelectSource.indexOf('const toolbarBaseClass'),
      customSelectSource.indexOf('const overlayMenu')
    );

    expect(RELATIONS_TOOLBAR_CLASS).toContain('border');
    expect(RELATIONS_TOOLBAR_CLASS).not.toContain('shadow');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).toContain('glass-panel');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).toContain('bambook-blue-white-surface');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).not.toContain('inset_0_0_0_1px');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).not.toContain('border-white/10');
    expect(toolbarSource).toContain('RELATIONS_TOOLBAR_SURFACE_CLASS');
    expect(toolbarSource).not.toContain('style={relationToolbarStyle}');
    expect(toolbarSource).not.toContain('bg-white/30 shadow-[inset_0_0_0_1px');
    expect(toolbarSource).not.toContain('bg-white/45 border-white/60 shadow-sm');
    expect(toolbarSource).toContain('RELATIONS_TOOLBAR_SEARCH_CLASS');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('bambook-dashboard-glass-color');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('bambook-blue-white-light');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).toContain('text-slate-700');
    expect(toolbarSource).not.toContain('bg-white/35 border border-white/45');
    expect(RELATIONS_TOOLBAR_SEGMENT_CLASS).not.toContain('border-transparent');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).not.toContain('bambook-dashboard-glass-color');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).toContain('bambook-blue-white-light');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).toContain('!border-transparent');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).not.toContain('bg-[#0d1b2a]/80');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).toContain('focus:!border-transparent');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).toContain('focus:bg-transparent');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).toContain('focus:shadow-none');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('focus:translate-y-[1px]');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('focus:bg-black');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('0_0_0_1px_rgba(74,144,226,0.14)');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('inset_0_0_0_1px');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('bg-white/80');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('inset_0_2px_5px');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('0_0_0_1px_rgba(74,144,226,0.20)');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('bg-[#0d1b2a]/80');
    expect(toolbarSource).not.toContain('transition-all duration-200 shadow-sm');
    expect(toolbarSelectSource).not.toContain('bambook-dashboard-glass-color');
    expect(toolbarSelectSource).toContain('toolbarInlineClass');
    expect(customSelectSource).toContain("import { BAMBOOK_OS } from './bambookOsTokens'");
    expect(customSelectSource).toContain('BAMBOOK_OS.controls.select.toolbarBase');
    expect(customSelectSource).toContain('BAMBOOK_OS.controls.select.toolbarSelected');
    expect(customSelectSource).toContain('BAMBOOK_OS.controls.overlayMenu');
    expect(customSelectSource).toContain('overlayMenu.itemSelected');
    expect(customSelectSource).not.toContain("const toolbarDarkBaseClass = '!bg-[rgba(6,14,24,0.18)]");
    expect(customSelectSource).not.toContain("const toolbarDarkSelectedClass = '!bg-[rgba(7,18,32,0.30)]");
    expect(BAMBOOK_OS.controls.select.toolbarInline).toContain('hover:bg-transparent');
    expect(BAMBOOK_OS.controls.select.toolbarInline).toContain('active:bg-transparent');
    expect(toolbarSelectSource).toContain('toolbarSelectedClass');
    expect(toolbarSelectSource).toContain('toolbarHoverClass');
    expect(toolbarSelectSource).not.toContain('SIDEBAR_HOVER_DARK_CLASS');
    expect(toolbarSelectSource).not.toContain('bg-[#0d1b2a]/80');
  });

  it('uses the existing sidebar and category-card blue system in dark mode', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const toolbarSource = source.slice(
      source.indexOf('const renderRelationListToolbar'),
      source.indexOf('// --- Handlers ---')
    );
    const customSelectSource = readFileSync(new URL('./ui/CustomSelect.tsx', import.meta.url), 'utf8');
    const toolbarSelectSource = customSelectSource.slice(
      customSelectSource.indexOf('const toolbarBaseClass'),
      customSelectSource.indexOf('const overlayMenu')
    );
    const toolbarSelectButtonSource = customSelectSource.slice(
      customSelectSource.indexOf('const triggerOpenClass'),
      customSelectSource.indexOf('const overlayMenu')
    );

    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).not.toContain('bambook-dashboard-glass-color');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).toContain('bambook-blue-white-light');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).toContain('!border-transparent');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).not.toContain('bg-white/35');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).not.toContain('border-white/45');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).toContain('glass-panel');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).toContain('bambook-blue-white-surface');
    expect(RELATIONS_TOOLBAR_SURFACE_CLASS).not.toContain('border-white/10');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('bambook-dashboard-glass-color');
    expect(RELATIONS_TOOLBAR_SEARCH_CLASS).not.toContain('bambook-blue-white-light');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).not.toContain('bg-white/80');
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).toBe(SIDEBAR_ACTIVE_CLASS);
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).not.toContain(SIDEBAR_PRESS_DARK_CLASS);
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).toContain('bambook-selected-surface');
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).not.toContain('border-[#4A90E2]');
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).not.toContain('bg-[#4A90E2]');
    expect(RELATIONS_TOOLBAR_CONTROL_IDLE_CLASS).toContain('text-[var(--text-tertiary)]');
    expect(RELATIONS_TOOLBAR_CONTROL_IDLE_CLASS).toContain(SIDEBAR_HOVER_DARK_CLASS);
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).not.toContain('bg-white');
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).not.toContain(SIDEBAR_PRESS_LIGHT_CLASS);
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).not.toContain('border-slate-300/40');
    expect(RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS).not.toContain('bg-slate-100/80');
    expect(toolbarSelectButtonSource).not.toContain('bambook-dashboard-glass-color');
    expect(toolbarSelectButtonSource).toContain('toolbarSelectedClass');
    expect(toolbarSelectButtonSource).toContain('toolbarHoverClass');
    expect(customSelectSource).not.toContain('SIDEBAR_PRESS_LIGHT_CLASS');
    expect(toolbarSelectSource).not.toContain('hover:border-[#4A90E2]');
    expect(toolbarSelectButtonSource).not.toContain('SIDEBAR_ACTIVE_DARK_CLASS');
    expect(customSelectSource).not.toContain('SIDEBAR_PRESS_DARK_CLASS');
    expect(toolbarSelectButtonSource).not.toContain('SIDEBAR_ACTIVE_LIGHT_CLASS');
    expect(customSelectSource).toContain('BAMBOOK_OS.controls.select.toolbarInline');
    expect(toolbarSelectButtonSource).not.toContain('circle_at_50%_');
    expect(toolbarSelectSource).not.toContain("bg-[#4A90E2]/15 text-[#4A90E2]");
    expect(toolbarSource).not.toMatch(/#123d68|#1f4c73|#17466f|#0d2438|blue-(?:100|50)(?![0-9])/);
    expect(toolbarSource).toContain('RELATIONS_TOOLBAR_SURFACE_CLASS');
    expect(RELATIONS_TOOLBAR_CONTROL_CLASS).not.toMatch(/\/(?:12|15|35)\b/);
  });

  it('keeps category card icons frameless and uses toolbar-style highlight', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const categorySource = source.slice(
      source.indexOf('{/* VIEW 1: CATEGORY GRID */}'),
      source.indexOf('{/* VIEW 2: ORGANIZATION LIST */}')
    );
    const categoryMaskHookSource = source.slice(
      source.indexOf('scrollRef: relationCategoryScrollRef'),
      source.indexOf('scrollRef: relationListScrollRef')
    );
    const sharedCardStart = source.indexOf('const renderRelationCard = ({');
    const sharedCardSource = source.slice(sharedCardStart, source.indexOf('\n\n  return (', sharedCardStart));

    expect(RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS).toBe(SIDEBAR_ACTIVE_CLASS);
    expect(RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS).toContain('bambook-selected-surface');
    expect(RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS).not.toContain('shadow-[');
    expect(RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS).not.toContain('inset_0_0_0_1px');
    expect(RELATIONS_CATEGORY_CARD_HIGHLIGHT_POSITION_CLASS).toBe('inset-0 rounded-[inherit]');
    expect(source).not.toContain('RELATIONS_CATEGORY_CARD_OUTER_RING_CLASS');
    expect(readFileSync(new URL('../index.css', import.meta.url), 'utf8')).not.toContain('relations-card-outer-ring');
    expect(RELATIONS_CARD_LAYOUT_TRANSITION).toEqual({ duration: 0.36, ease: [0.16, 1, 0.3, 1] });
    expect(RELATIONS_CATEGORY_CARD_GRID_CLASS).toContain('grid-cols-[repeat(auto-fill,316px)]');
    expect(RELATIONS_CATEGORY_CARD_GRID_CLASS).toContain('justify-center');
    expect(RELATIONS_CARD_GRID_CLASS).toContain('grid-cols-[repeat(auto-fill,316px)]');
    expect(RELATIONS_CARD_GRID_CLASS).toContain('gap-6');
    expect(RELATIONS_CARD_GRID_CLASS).toContain('justify-center');
    expect(RELATIONS_CARD_GRID_CLASS).not.toContain('justify-between');
    expect(RELATIONS_CARD_GRID_CLASS).not.toContain('auto-fit,minmax');
    expect(RELATIONS_CARD_GRID_CLASS).not.toContain('300px');
    expect(RELATIONS_CARD_GRID_CLASS).not.toContain('320px');
    expect(RELATIONS_MOBILE_CATEGORY_GRID_CLASS).toBe('grid grid-cols-2 gap-3 content-start');
    expect(RELATIONS_MOBILE_CATEGORY_CARD_CLASS).toContain('h-[190px]');
    expect(RELATIONS_MOBILE_CATEGORY_CARD_CLASS).toContain('p-4');
    expect(RELATIONS_CATEGORY_CARD_CLASS).toContain('rounded-[24px]');
    expect(RELATIONS_CATEGORY_CARD_CLASS).toContain('backdrop-blur-[15px]');
    expect(RELATIONS_CATEGORY_CARD_CLASS).toContain('bambook-dashboard-glass-color');
    expect(RELATIONS_CATEGORY_CARD_CLASS).toContain(OS_MATERIAL.raisedCard);
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('bambook-outer-panel');
    expect(RELATIONS_CATEGORY_CARD_CLASS).toContain(SIDEBAR_HOVER_DARK_CLASS);
    expect(RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR).toBe(BAMBOOK_OS.spotlight.cardDarkColor);
    expect(RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR).toBe(BAMBOOK_OS.spotlight.cardLightColor);
    expect(RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_SIZE).toBe(BAMBOOK_OS.spotlight.panelDarkSize);
    expect(RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_SIZE).toBe(BAMBOOK_OS.spotlight.panelLightSize);
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('bambook-blue-white-light');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain(SIDEBAR_PRESS_DARK_CLASS);
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('active:');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('bambook-blue-white-surface');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('relations-card-outer-ring');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('hover:border-[#4A90E2]/42');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain(SIDEBAR_PRESS_LIGHT_CLASS);
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('hover:shadow-[0_0_0_1px_rgba(74,144,226,0.14)');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('active:border');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('active:shadow');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('active:translate-y-px');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('relations-card-edge');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('inset_var(--relations-card-edge');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('inset_0_0_0_1px_rgba(74,144,226');
    expect(RELATIONS_CATEGORY_CARD_CLASS).not.toContain('inset_0_0_0_1px_rgba(255,255,255,0.14)');
    expect(RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS).not.toContain('inset_0_1px_0_rgba(255,255,255,0.14)');
    expect(RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS).not.toContain('rgba(255,255,255,0.6)');
    expect(RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS).not.toContain('rgba(255,255,255,0.85)');
    expect(categorySource).not.toContain('RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS');
    expect(categorySource).not.toContain('RELATIONS_CATEGORY_CARD_HIGHLIGHT_POSITION_CLASS');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_SIZE');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_SIZE');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_CLASS');
    expect(categorySource).toContain('relationCategoryGridClass');
    expect(categorySource).toContain('relationCategoryViewportClass');
    expect(sharedCardSource).toContain('relationCategoryCardClass');
    expect(sharedCardSource).toContain('relationCategoryIconClass');
    expect(source).toContain('const relationCategoryGridClass = isMobile ? RELATIONS_MOBILE_CATEGORY_GRID_CLASS : RELATIONS_CATEGORY_CARD_GRID_CLASS');
    expect(source).toContain("const relationCategoryViewportClass = isMobile ? 'px-7 pt-[92px] pb-28'");
    expect(source).toContain('`${pageInsetExpandedClass} pt-[104px] pb-12`');
    expect(source).toContain('const relationCategoryCardClass = isMobile ? RELATIONS_MOBILE_CATEGORY_CARD_CLASS');
    expect(source).toContain('const relationCategoryScrollRef = useRef<HTMLDivElement | null>(null)');
    expect(source).toContain('const RELATIONS_CARD_GRID_EDGE_FADE_TOP_OFFSET = 64;');
    expect(source).toContain('scrollRef: relationCategoryScrollRef');
    expect(source).toContain("enabled: navLevel === 'category' && !showAddModal");
    expect(categorySource).not.toContain('scrollRef={relationCategoryScrollRef}');
    expect(categorySource).not.toContain('renderMode="content-mask"');
    expect(categorySource).not.toContain('renderMode="overlay"');
    expect(categorySource).toContain('ref={relationCategoryScrollRef}');
    expect(categoryMaskHookSource).toContain('topHeight: 32');
    expect(categoryMaskHookSource).toContain('topFadeStartOffset: RELATIONS_CARD_GRID_EDGE_FADE_TOP_OFFSET');
    expect(categoryMaskHookSource).toContain('bottomHeight: 48');
    expect(categorySource).toContain('<motion.div');
    expect(categorySource).toContain('layout');
    expect(categorySource).toContain('transition={{ layout: RELATIONS_CARD_LAYOUT_TRANSITION }}');
    expect(sharedCardSource).toContain('<CompiledMotionInteractiveCard');
    expect(sharedCardSource).toContain('as="button"');
    expect(sharedCardSource).toContain('idleSpotlightOpacity={0}');
    expect(sharedCardSource).toContain('liquidSpotlight');
    expect(sharedCardSource).toContain('liquidSpotlightTone="light"');
    expect(sharedCardSource).toContain('transition={{ layout: RELATIONS_CARD_LAYOUT_TRANSITION, delay: index * 0.05 }}');
    expect(categorySource).toContain('categories.map((cat, idx) => renderRelationCard({');
    expect(categorySource).toContain('cardKey: cat.id');
    expect(categorySource).toContain('icon: <cat.icon size={24} strokeWidth={1} />');
    expect(categorySource).toContain('title: cat.label');
    expect(categorySource).toContain('description: cat.desc');
    expect(categorySource).not.toContain('px-8 pt-10');
    expect(categorySource).not.toContain('grid-cols-[repeat(auto-fit,minmax');
    expect(sharedCardSource).toContain('transition-colors duration-200');
    expect(source).not.toContain('handleRelationCardMouseMove');
    expect(source).not.toContain("style.setProperty('--relations-card-edge-x'");
    expect(source).not.toContain("style.setProperty('--relations-card-edge-y'");
    expect(sharedCardSource).toContain('group relative isolate overflow-hidden');
    expect(sharedCardSource).not.toContain('absolute z-0 opacity-0 transition-opacity');
    expect(sharedCardSource).not.toContain('group-hover:opacity-100');
    expect(sharedCardSource).not.toContain('SIDEBAR_PRESS_DARK_CLASS');
    expect(sharedCardSource).not.toContain('SIDEBAR_PRESS_LIGHT_CLASS');
    expect(source).toContain("const relationCategoryCardClass = isMobile ? RELATIONS_MOBILE_CATEGORY_CARD_CLASS : 'p-6 h-[220px] rounded-card-lg'");
    expect(sharedCardSource).toContain('${relationCategoryCardClass} transition-colors duration-200');
    expect(sharedCardSource).not.toContain('RELATIONS_CATEGORY_CARD_SURFACE_DARK_CLASS');
    expect(sharedCardSource).not.toContain('RELATIONS_CATEGORY_CARD_SURFACE_LIGHT_CLASS');
    expect(source).not.toContain('RELATIONS_CATEGORY_CARD_SURFACE_');
    expect(sharedCardSource).not.toContain('pointer-events-none absolute inset-0 rounded-[inherit]');
    expect(sharedCardSource).not.toContain('inset-0 rounded-2xl');
    expect(sharedCardSource).not.toContain('inset-px rounded-[15px]');
    expect(sharedCardSource).toContain('-ml-1 -mt-1 ${relationCategoryIconClass} items-center justify-center');
    expect(sharedCardSource).toContain("transition-transform duration-300 group-hover:translate-x-1");
    expect(sharedCardSource).toContain("text-[var(--text-quaternary)]");
    expect(sharedCardSource).not.toContain("text-white/30");
    expect(sharedCardSource).not.toContain("text-slate-300");
    expect(sharedCardSource).not.toContain("ArrowRight size={14} strokeWidth={1.5} className={`transition-all duration-300");
    expect(sharedCardSource).not.toContain('text-white/30 group-hover:text-[#4a9eff]');
    expect(sharedCardSource).not.toContain('text-slate-300 group-hover:text-blue-500');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_CLASS');
    expect(source).not.toContain('RELATIONS_TABLE_ROW_MATERIAL_CLASS');
    expect(source).not.toContain('${RELATIONS_TABLE_ROW_MATERIAL_CLASS} ${relationTableRowHoverClass}');
    expect(source).toContain('relative isolate overflow-hidden ${relationTableRowHoverClass}');
    expect(source).toContain('<span className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 h-px ${relationTableRowSeparatorClass}`} aria-hidden="true" />');
    expect(source).not.toContain('border-b ${relationTableCellBorderClass}');
    expect(source).toContain('${BAMBOOK_OS.layout.relationsTableColumnTemplateClass}');
    expect(BAMBOOK_OS.layout.relationsTableBodyViewportClass).toBe('min-h-0 flex-1 overflow-y-auto overscroll-contain');
    expect(source).toContain('<CompiledTableShell');
    expect(source).toContain('scrollRef={relationTableScrollRef}');
    expect(source).not.toContain('ref={relationTableScrollRef} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${BAMBOOK_OS.layout.panelShadowViewportClass}`}');
    expect(source).not.toContain('mb-2 last:mb-0 relative isolate overflow-hidden !rounded-2xl ${RELATIONS_TABLE_ROW_MATERIAL_CLASS}');
    expect(source).not.toContain('${isDarkMode ? RELATIONS_CATEGORY_CARD_DARK_CLASS : RELATIONS_CATEGORY_CARD_LIGHT_CLASS} ${relationTableRowHoverClass}');
    expect(readFileSync(new URL('../docs/design-system/component-grammar.md', import.meta.url), 'utf8')).toContain('Row hover/highlight must span the full table content width and use squared row edges');
    expect(readFileSync(new URL('../docs/design-system/component-grammar.md', import.meta.url), 'utf8')).toContain('Row separators are inner hairlines inside the masked row element');
    expect(sharedCardSource).not.toContain('hover:border-[#4A90E2]/50');
    expect(sharedCardSource).not.toContain('hover:border-[#4A90E2]/42');
    expect(sharedCardSource).not.toContain('hover:border-blue-200');
    expect(sharedCardSource).not.toContain('hover:bg-white/80 hover:border-white/70');
    expect(sharedCardSource).not.toContain('group-hover:text-blue-600');
    expect(sharedCardSource).not.toContain("text-slate-400 group-hover:text-[#4A90E2]");
    expect(sharedCardSource).toContain('text-[var(--os-vnext-brand-blue)] group-hover:text-[var(--text-primary)]');
    expect(sharedCardSource).not.toContain('bg-blue-50 text-[#4A90E2]');
    expect(sharedCardSource).not.toContain('bg-[#4A90E2]/10 text-[#4A90E2]');
    expect(sharedCardSource).not.toContain('rounded-xl mb-4 flex items-center justify-center');
  });

  it('aligns level-two organization cards with category card styling', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const sharedCardStart = source.indexOf('const renderRelationCard = ({');
    const sharedCardSource = source.slice(sharedCardStart, source.indexOf('\n\n  return (', sharedCardStart));
    const organizationGridStart = source.indexOf('{/* VIEW 2: ORGANIZATION LIST */}');
    const organizationGridSource = source.slice(
      organizationGridStart,
      source.indexOf(')) : (', organizationGridStart)
    );

    expect(organizationGridSource).toContain('currentOrganizations.map((org, idx) => renderRelationCard({');
    expect(organizationGridSource).toContain('cardKey: org.id');
    expect(organizationGridSource).toContain('index: idx');
    expect(organizationGridSource).toContain('icon: <Building2 size={24} strokeWidth={1} />');
    expect(organizationGridSource).toContain('title: org.name');
    expect(organizationGridSource).toContain('description: org.summary || relationLocationLabel(org) || org.type');
    expect(organizationGridSource).toContain('footerLabel: `${orgContactCount(org.id)} 活跃联系人`');
    expect(organizationGridSource).toContain("onClick: () => { setSelectedOrgId(org.id); setNavLevel('detail'); setSearchTerm(''); }");
    expect(organizationGridSource).not.toContain('RELATIONS_CATEGORY_CARD_HIGHLIGHT_DARK_CLASS');
    expect(organizationGridSource).not.toContain('RELATIONS_CATEGORY_CARD_HIGHLIGHT_LIGHT_CLASS');
    expect(organizationGridSource).not.toContain('RELATIONS_CATEGORY_CARD_HIGHLIGHT_LIGHT_POSITION_CLASS');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR');
    expect(organizationGridSource).toContain('${pageInsetExpandedClass}');
    expect(organizationGridSource).toContain('RELATIONS_CARD_GRID_CLASS');
    expect(organizationGridSource).toContain('<motion.div layout');
    expect(organizationGridSource).toContain('transition={{ layout: RELATIONS_CARD_LAYOUT_TRANSITION }}');
    expect(sharedCardSource).toContain('<CompiledMotionInteractiveCard');
    expect(sharedCardSource).toContain('as="button"');
    expect(sharedCardSource).toContain('idleSpotlightOpacity={0}');
    expect(sharedCardSource).toContain('liquidSpotlight');
    expect(sharedCardSource).toContain('liquidSpotlightTone="light"');
    expect(organizationGridSource).not.toContain('cardGridClass');
    expect(organizationGridSource).not.toContain('grid-cols-[repeat(auto-fit,minmax');
    expect(organizationGridSource).not.toContain('onMouseMove={handleRelationCardMouseMove}');
    expect(source).not.toContain('const relationOrganizationCardClass');
    expect(sharedCardSource).not.toContain('absolute z-0 opacity-0 transition-opacity');
    expect(sharedCardSource).not.toContain('group-hover:opacity-100');
    expect(sharedCardSource).not.toContain('SIDEBAR_PRESS_DARK_CLASS');
    expect(sharedCardSource).not.toContain('SIDEBAR_PRESS_LIGHT_CLASS');
    expect(organizationGridSource).not.toContain('rounded-3xl backdrop-blur-xl border transition-all duration-300 hover:-translate-y-1');
    expect(sharedCardSource).not.toContain('RELATIONS_CATEGORY_CARD_SURFACE_DARK_CLASS');
    expect(sharedCardSource).not.toContain('RELATIONS_CATEGORY_CARD_SURFACE_LIGHT_CLASS');
    expect(source).not.toContain('RELATIONS_CATEGORY_CARD_SURFACE_');
    expect(sharedCardSource).not.toContain('pointer-events-none absolute inset-0 rounded-[inherit]');
    expect(sharedCardSource).not.toContain('inset-0 rounded-2xl');
    expect(sharedCardSource).not.toContain('inset-px rounded-[15px]');
    expect(sharedCardSource).toContain('data-glass-edge-mask');
    expect(sharedCardSource).toContain('group relative isolate overflow-hidden flex flex-col items-start text-left');
    expect(sharedCardSource).toContain('${relationCategoryCardClass} transition-colors duration-200');
    expect(sharedCardSource).toContain('-ml-1 -mt-1 ${relationCategoryIconClass} items-center justify-center');
    expect(sharedCardSource).toContain('text-[var(--os-vnext-brand-blue)] group-hover:text-[var(--text-primary)]');
    expect(sharedCardSource).toContain('RELATIONS_CATEGORY_CARD_CLASS');
    expect(organizationGridSource).not.toContain('{tierLabel(org.rating)}');
    expect(organizationGridSource).not.toContain('relationOrganizationTierBadgeClass');
    expect(organizationGridSource).not.toContain('relative z-10 flex justify-between items-start mb-3');
    expect(organizationGridSource).not.toContain('relative z-10 mt-3 space-y-1.5 flex-1 min-h-0');
    expect(organizationGridSource).not.toContain('relative z-10 mt-auto pt-3 border-t flex items-center justify-between gap-3');
    expect(organizationGridSource).not.toContain('text-white/42');
    expect(organizationGridSource).not.toContain('border-white/10 text-white/40');
    expect(organizationGridSource).not.toContain('tierStars');
    expect(organizationGridSource).not.toMatch(/amber|emerald|green|yellow|lime/);
    expect(organizationGridSource).not.toContain('hover:border-[#4a9eff]/40');
    expect(organizationGridSource).not.toContain('bg-gradient-to-br from-[#a78bfa]/20');
    expect(organizationGridSource).not.toContain('bg-indigo-500/10 text-indigo-600');
  });

  it('keeps the organization table inside the title-width column by merging secondary fields', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const tableSource = source.slice(
      source.indexOf('<CompiledTableShell', source.indexOf(')) : (')),
      source.indexOf('{/* Empty state */}')
    );

    expect(BAMBOOK_OS.layout.relationsTableViewportClass).toBe('absolute -top-16 inset-x-0 pt-[80px] pb-0 overflow-visible');
    expect(BAMBOOK_OS.layout.relationsTablePanelClass).toBe('flex h-full w-full flex-col overflow-hidden');
    expect(BAMBOOK_OS.layout.relationsTablePanelContentClass).toBe('relative z-10 flex min-h-0 flex-1 flex-col');
    expect(BAMBOOK_OS.layout.relationsTableHeaderTableClass).toContain('w-full shrink-0 table-fixed');
    expect(BAMBOOK_OS.layout.relationsTableBodyViewportClass).toBe('min-h-0 flex-1 overflow-y-auto overscroll-contain');
    expect(BAMBOOK_OS.layout.relationsTableColumnWidthClasses).toEqual(['w-[27%]', 'w-[22%]', 'w-[27%]', 'w-[17%]', 'w-[7%]']);
    expect(BAMBOOK_OS.layout.relationsTableColumnTemplateClass).toBe('grid-cols-[27%_22%_27%_17%_7%]');
    expect(BAMBOOK_OS.layout.relationsTableHeaders).toEqual(['组织', '主联系人', '地址', '履约', '']);
    expect(source).toContain('`${BAMBOOK_OS.layout.relationsTableViewportClass} ${relationsTableBottomEdgeClass} ${pageInsetClass}`');
    expect(source).not.toContain('pt-[104px] pb-8 overflow-hidden');
    expect(tableSource).toContain('panelClassName={BAMBOOK_OS.layout.relationsTablePanelClass}');
    expect(tableSource).toContain('panelContentClassName={`${BAMBOOK_OS.layout.relationsTablePanelContentClass} overflow-hidden`}');
    expect(tableSource).toContain('className={BAMBOOK_OS.layout.relationsTableHeaderTableClass}');
    expect(tableSource).toContain('BAMBOOK_OS.layout.relationsTableColumnWidthClasses.map');
    expect(tableSource).toContain('BAMBOOK_OS.layout.relationsTableHeaderCellClass');
    expect(tableSource).toContain('scrollClassName="overflow-x-auto overscroll-contain"');
    expect(tableSource).toContain('className={BAMBOOK_OS.layout.relationsTableBodyClass}');
    expect(tableSource).toContain('<CompiledMotionInteractiveCard');
    expect(tableSource).toContain('data-glass-edge-mask');
    expect(tableSource).toContain('spotlightColor={isDarkMode ? RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR : RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR}');
    expect(tableSource).toContain('liquidSpotlight');
    expect(tableSource).not.toContain('min-w-[1080px]');
    expect(tableSource).toContain('<colgroup>');
    expect(tableSource).toContain('BAMBOOK_OS.layout.relationsTableHeaders.map');
    expect(tableSource).toContain('BAMBOOK_OS.layout.relationsTableColumnTemplateClass');
    expect(tableSource).not.toContain('<col className="w-[27%]"');
    expect(tableSource).not.toContain('grid-cols-[27%_22%_27%_17%_7%]');
    expect(tableSource).not.toContain("'状态'");
    expect(source).toContain('const relationLocationLabel = (org: Relation) =>');
    expect(source).toContain('shipToCity || cityFromChineseAddress');
    expect(tableSource).toContain('{relationLocationLabel(org)}');
    expect(tableSource).not.toContain("org.officialAddress || org.billingAddress || org.shippingAddress || '未填'");
    expect(tableSource).not.toContain("'等级', '主联系人', '地址', 'Ship To', '付款条款', '补全', '联系人'");
    expect(tableSource).toContain('{tierLabel(org.rating)}');
    expect(tableSource).toContain('{orgContactCount(org.id)} 位联系人');
    expect(tableSource).toContain('付款未填');
  });

  it('uses plain tier labels without star glyphs in relation views and forms', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const tierLabel');
    expect(source).not.toContain('const tierStars');
    expect(source).not.toContain('★');
    expect(source).toContain('label: tierLabel(tier)');
    expect(source).not.toContain('label: `${tierLabel(tier)}');
  });

  it('gives the option toolbar a bounded liquid spotlight without pointer-down residue', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    const spotlightSource = readFileSync(new URL('./ui/SpotlightCard.tsx', import.meta.url), 'utf8');
    const toolbarSource = source.slice(
      source.indexOf('const renderRelationListToolbar'),
      source.indexOf('// --- Handlers ---')
    );

    expect(RELATIONS_TOOLBAR_SPOTLIGHT_DARK_COLOR).toBe(RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR);
    expect(RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_COLOR).toBe(RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR);
    expect(RELATIONS_TOOLBAR_SPOTLIGHT_DARK_SIZE).toBe(300);
    expect(RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_SIZE).toBe(240);
    expect(toolbarSource).toContain('<SpotlightCard');
    expect(toolbarSource).toContain('spotlightColor={isDarkMode ? RELATIONS_TOOLBAR_SPOTLIGHT_DARK_COLOR : RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_COLOR}');
    expect(toolbarSource).toContain('spotlightSize={isDarkMode ? RELATIONS_TOOLBAR_SPOTLIGHT_DARK_SIZE : RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_SIZE}');
    expect(toolbarSource).toContain('liquidSpotlight');
    expect(toolbarSource).toContain("liquidSpotlightTone={isDarkMode ? 'dark' : 'light'}");
    expect(toolbarSource).toContain('idleSpotlightOpacity={0}');
    expect(toolbarSource).toContain('activeSpotlightOpacity={1}');
    expect(toolbarSource).toContain('RELATIONS_TOOLBAR_AMBIENT_CLASS');
    expect(toolbarSource).toContain('RELATIONS_TOOLBAR_CONTENT_CLASS');
    expect(toolbarSource).toContain('RELATIONS_TOOLBAR_SEARCH_SHELL_CLASS');
    expect(toolbarSource).not.toContain('fadeOnPointerDown');
    expect(indexCss).toContain('@keyframes relations-toolbar-rail-flow');
    expect(indexCss).toContain('.relations-toolbar-search-dark:focus');
    expect(indexCss).toContain('background-color: transparent !important;');
    expect(spotlightSource).toContain('fadeOnPointerDown?: boolean');
    expect(spotlightSource).toContain('idleSpotlightOpacity?: number');
    expect(spotlightSource).toContain('activeSpotlightOpacity?: number');
    expect(spotlightSource).toContain('idleSpotlightPosition?:');
    expect(spotlightSource).toContain('idleSpotlightOpacity = 1');
    expect(spotlightSource).toContain('idleSpotlightPosition = SPOTLIGHT_CARD_DEFAULT_IDLE_POSITION');
    expect(spotlightSource).toContain('animateSpotlightTo(idleSpotlightPosition, false)');
    expect(spotlightSource).toContain('setOpacity(idleSpotlightOpacity)');
    expect(spotlightSource).toContain('const handlePointerDown');
    expect(spotlightSource).toContain('if (fadeOnPointerDown) setOpacity(0)');
    expect(RELATIONS_TOOLBAR_CONTROL_IDLE_CLASS).not.toContain('hover:bg-[#4A90E2]');
  });

  it('matches the toolbar OS surface language in the custom select menu', () => {
    const customSelectSource = readFileSync(new URL('./ui/CustomSelect.tsx', import.meta.url), 'utf8');
    const menuStart = customSelectSource.indexOf('const overlayMenu');
    const menuSource = customSelectSource.slice(
      menuStart,
      customSelectSource.indexOf('export default CustomSelect')
    );

    expect(menuSource).toContain('overlayMenu.surfaceBase');
    expect(menuSource).toContain('overlayMenu.surface');
    expect(BAMBOOK_OS.controls.overlayMenu.surfaceBase).toContain('p-1');
    expect(BAMBOOK_OS.controls.overlayMenu.surfaceBase).toContain('rounded-2xl');
    expect(BAMBOOK_OS.controls.overlayMenu.surface).toContain('bambook-dashboard-glass-color');
    expect(menuSource).toContain('menuSurfaceClass');
    expect(BAMBOOK_OS.controls.overlayMenu.itemBase).toContain('h-9');
    expect(BAMBOOK_OS.controls.overlayMenu.itemBase).toContain('rounded-2xl');
    expect(BAMBOOK_OS.controls.overlayMenu.itemBase).toContain('mx-0.5');
    expect(BAMBOOK_OS.controls.overlayMenu.itemBase).toContain('px-3');
    expect(BAMBOOK_OS.controls.overlayMenu.itemBase).toContain('text-xs');
    expect(menuSource).toContain('BAMBOOK_OS.typography.weight.ui');
    expect(menuSource).toContain('text-[10px] mt-0.5');
    expect(BAMBOOK_OS.controls.overlayMenu.item).toContain('border border-transparent');
    expect(menuSource).toContain('data-glass-edge-mask');
    expect(menuSource).toContain('data-os-shadow-mode="flat"');
    expect(menuSource).not.toContain('SIDEBAR_HOVER_DARK_CLASS');
    expect(menuSource).not.toContain('SIDEBAR_HOVER_LIGHT_CLASS');
    expect(menuSource).not.toContain('SIDEBAR_ACTIVE_DARK_CLASS');
    expect(menuSource).not.toContain('SIDEBAR_ACTIVE_LIGHT_CLASS');
    expect(menuSource).not.toContain('SIDEBAR_PRESS_DARK_CLASS');
    expect(menuSource).not.toContain('SIDEBAR_PRESS_LIGHT_CLASS');
  });

  it('places the detail view switch inside the title bar instead of a separate tab row', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const titleSource = source.slice(
      source.indexOf('<PageHeader'),
      source.indexOf('{/* Content Area')
    );

    expect(RELATIONS_TITLE_VIEW_SWITCH_CLASS).toContain('h-9');
    expect(RELATIONS_TITLE_VIEW_SWITCH_CLASS).toContain('rounded-full');
    expect(RELATIONS_TITLE_VIEW_SWITCH_BUTTON_CLASS).toContain('h-7');
    expect(titleSource).toContain("navLevel === 'detail'");
    expect(titleSource).toContain('RELATIONS_TITLE_VIEW_SWITCH_CLASS');
    expect(titleSource).toContain('通讯录');
    expect(titleSource).toContain('组织架构');
    expect(source).not.toContain('RELATIONS_TITLE_TAB_BAR_CLASS');
    expect(source).not.toContain('RELATIONS_TITLE_TAB_BUTTON_CLASS');
    expect(source).not.toContain('Level 3: transparent tab row');
  });

  it('keeps relation title bars full-width while constraining the relation content canvas', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');

    expect(source).toContain("const relationsContentCanvasClass = isMobile ? 'w-full' : BAMBOOK_OS.layout.desktopPageCanvasClass;");
    expect(source).toContain("const relationsMainBottomEdgeClass = isMobile ? 'bottom-0' : BAMBOOK_OS.layout.desktopMainPanelBottomEdgeClass;");
    expect(source).toContain("const relationsTableBottomEdgeClass = isMobile ? 'bottom-0' : BAMBOOK_OS.layout.desktopTablePanelBottomEdgeClass;");
    expect(source).toContain("const relationsFormBottomEdgeClass = 'bottom-0';");
    expect(BAMBOOK_OS.layout.desktopMainPanelBottomEdgeClass).toBe('bambook-main-panel-bottom-edge');
    expect(BAMBOOK_OS.layout.desktopTablePanelBottomEdgeClass).toBe('bambook-table-panel-bottom-edge');
    expect(source).toContain('<div className="w-full h-full flex flex-col bg-transparent overflow-visible">');
    expect(source).toContain("<div className={`${relationsContentCanvasClass} flex-1 min-h-0 relative overflow-visible ${fullscreenFormOpen ? 'hidden' : ''}`}>");
    expect(source).toContain('${relationsMainBottomEdgeClass} ${relationCategoryViewportClass}');
    expect(source).toContain('${relationsMainBottomEdgeClass} ${pageInsetExpandedClass}');
    expect(source).toContain('${relationsTableBottomEdgeClass} ${pageInsetClass}');
    expect(source).toContain('absolute inset-x-0 top-0 ${relationsMainBottomEdgeClass} min-h-0 flex overflow-visible');
  });

  it('uses the same transparent title language inside the add/edit form', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const formOverlaySource = source.slice(
      source.indexOf('{showAddModal && ('),
      source.indexOf('<form id="relation-fullscreen-form"', source.indexOf('{showAddModal && ('))
    );

    expect(RELATIONS_FORM_TITLE_BAR_CLASS).toContain(RELATIONS_TITLE_BAR_CLASS);
    expect(RELATIONS_FORM_TITLE_BAR_CLASS).toContain('px-7');
    expect(RELATIONS_FORM_TITLE_BAR_CLASS).toContain('h-14');
    expect(RELATIONS_FORM_TITLE_BAR_CLASS).toContain('items-center');
    expect(RELATIONS_FORM_TITLE_BAR_CLASS).not.toMatch(/\bbg-/);
    expect(RELATIONS_FORM_TITLE_BAR_CLASS).not.toContain('backdrop');
    expect(formOverlaySource).toContain('h-full w-full overflow-hidden flex flex-col');
    expect(formOverlaySource).toContain('${relationsFormBottomEdgeClass} z-[70]');
    expect(formOverlaySource).not.toContain('desktopMainPanelBottomEdgeClass');
    expect(formOverlaySource).not.toContain('bottom-4');
    expect(source).toContain('id="relation-fullscreen-form" onSubmit={handleSave} data-relation-save-error={relationSaveError} data-relation-busy={relationBusy} className="w-full flex-1 min-h-0 px-5 pt-3');
    expect(formOverlaySource).toContain('style={{ ...RELATIONS_CLEAR_REGION_STYLE, ...RELATIONS_TITLE_SAFE_LEFT_STYLE }}');
    expect(RELATIONS_FORM_TITLE_CRUMB_CLASS).toContain('h-9');
    expect(RELATIONS_FORM_TITLE_HEADING_CLASS).toBe(RELATIONS_TITLE_PAGE_LABEL_CLASS);
    expect(RELATIONS_FORM_TITLE_HEADING_CLASS).toContain('h-9');
    expect(RELATIONS_FORM_TITLE_HEADING_CLASS).toContain('items-center');
    expect(RELATIONS_FORM_TITLE_HEADING_CLASS).toContain('text-[11px]');
    expect(RELATIONS_FORM_TITLE_HEADING_CLASS).not.toMatch(/\bmt-/);
    expect(RELATIONS_FORM_TITLE_HEADING_CLASS).not.toContain('text-xl');
    expect(RELATIONS_FORM_TITLE_SECONDARY_BUTTON_CLASS).toContain('h-9');
    expect(RELATIONS_FORM_TITLE_SUBMIT_BUTTON_CLASS).toContain('h-9');
  });

  it('uses recessed glass fields inside the add/edit form', () => {
    const source = readFileSync(new URL('./RelationsManager.tsx', import.meta.url), 'utf8');
    const formSource = source.slice(
      source.indexOf('{/* Form */}'),
      source.indexOf('<div data-scroll-edge-bottom-sentinel')
    );

    expect(RELATIONS_FORM_FIELD_CLASS).toContain('!bg-[rgba(255,255,255,0.055)]');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('!bg-none');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('text-xs');
    expect(RELATIONS_FORM_FIELD_CLASS).not.toContain('bambook-blue-white-light');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('border-[rgba(255,255,255,0.10)]');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('focus:!bg-[rgba(255,255,255,0.085)]');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('focus:!bg-none');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('focus:!border-[rgba(255,255,255,0.22)]');
    expect(RELATIONS_FORM_FIELD_CLASS).not.toContain('focus:translate-y-[1px]');
    expect(RELATIONS_FORM_FIELD_CLASS).not.toContain('focus:border-[#4A90E2]');
    expect(RELATIONS_FORM_FIELD_CLASS).not.toContain('rgba(74,144,226');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('!bg-[rgba(15,23,42,0.06)]');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('border-[rgba(15,23,42,0.10)]');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('placeholder-slate-400');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('focus:!bg-[rgba(15,23,42,0.08)]');
    expect(RELATIONS_FORM_FIELD_CLASS).toContain('focus:!border-[rgba(15,23,42,0.24)]');
    expect(formSource).toContain('relationFormFieldClass');
    expect(formSource).toContain('rounded-full border outline-none font-light');
    expect(formSource).toContain('type="date"');
    expect(formSource).toContain('type="date" defaultValue={editingItem?.birthday} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}');
    expect(formSource).not.toContain('focus:ring-blue-100');
  });

  it('documents and styles date fields as select-aligned recessed controls', () => {
    const osVnextCss = readFileSync(new URL('../styles/os-vnext.css', import.meta.url), 'utf8');
    const componentGrammar = readFileSync(new URL('../docs/design-system/component-grammar.md', import.meta.url), 'utf8');

    expect(componentGrammar).toContain('Text inputs, date inputs, and textareas need both the shared `recessedField` recipe and an actual `border` width class');
    expect(componentGrammar).toContain('Native date controls must keep their calendar indicator aligned with field text color');
    expect(osVnextCss).toContain('.ui-lab-real-os-root input[type="date"]');
    expect(osVnextCss).toContain('color-scheme: light;');
    expect(osVnextCss).toContain('.ui-lab-real-os-root--dark input[type="date"]');
    expect(osVnextCss).toContain('color-scheme: dark;');
    expect(osVnextCss).toContain('.ui-lab-real-os-root--dark input[type="date"]::-webkit-calendar-picker-indicator');
    expect(osVnextCss).toContain('filter: invert(1);');
  });
});
