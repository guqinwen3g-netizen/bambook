import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BAMBOOK_ADAPTIVE_COLOR_GRAMMAR,
  BAMBOOK_COMPONENT_GRAMMAR,
  BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS,
  BAMBOOK_CONTENT_GRAMMAR,
  BAMBOOK_CONTAINER_LEVELS,
  BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES,
  BAMBOOK_DESIGN_SYSTEM_CONTRACT,
  BAMBOOK_DESIGN_SYSTEM_RETIRED_DOCS,
  BAMBOOK_DESIGN_SYSTEM_RULES,
  BAMBOOK_DESIGN_SYSTEM_VERSION,
  BAMBOOK_LAYOUT_GRAMMAR,
  BAMBOOK_MATERIAL_LIBRARY_CATEGORIES,
  BAMBOOK_MATERIAL_LIBRARY_ITEMS,
  BAMBOOK_PAGE_GENERATION_GRAMMAR,
  BAMBOOK_STATE_GRAMMAR,
} from './bambookDesignSystem';

describe('Bambook OS design system contract', () => {
  it('declares code files as the source of truth before prose docs', () => {
    expect(BAMBOOK_DESIGN_SYSTEM_VERSION).toBe('bambook-os-design-system-v1');
    expect(BAMBOOK_DESIGN_SYSTEM_CONTRACT.version).toBe(BAMBOOK_DESIGN_SYSTEM_VERSION);
    expect(BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES.map(source => source.path)).toEqual([
      'styles/os-vnext.css',
      'components/ui/bambookOsTokens.ts',
      'components/ui/osMaterial.ts',
      'components/ui/SidePanelContainer.tsx',
      'components/ui/GlassEdgeFadeShadow.tsx',
      'components/ui/ScrollEdgeFades.tsx',
      'components/ui/osCompiler/osCompiler.ts',
      'components/ui/primitives/compiledPrimitives.tsx',
      'components/ui/RDLPrimitives.tsx',
      'docs/design-system/rdl-component-authority.md',
    ]);
    expect(BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES.find(source => source.path === 'components/ui/osMaterial.ts')?.owns).toContain('shadow role enum');
    expect(BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES.find(source => source.path === 'components/ui/SidePanelContainer.tsx')?.owns).toContain('surface and shadow role binding');
    expect(BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES.find(source => source.path === 'components/ui/GlassEdgeFadeShadow.tsx')?.owns).toContain('forbidden material-class boundary for shadow casters');
    expect(BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES.find(source => source.path === 'components/ui/osCompiler/osCompiler.ts')?.owns).toContain('compiler fidelity gate');
    expect(BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES.find(source => source.path === 'components/ui/RDLPrimitives.tsx')?.owns).toContain('RDL shared pill and search primitive');
    expect(BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES.find(source => source.path === 'docs/design-system/rdl-component-authority.md')?.owns).toContain('Bambook RDL pill, search, filter, card, row, and overlay-control dialect');
    expect(BAMBOOK_DESIGN_SYSTEM_CONTRACT.authoritativeSources).toBe(BAMBOOK_DESIGN_SYSTEM_AUTHORITATIVE_SOURCES);
    expect(BAMBOOK_DESIGN_SYSTEM_CONTRACT.retiredDocs).toBe(BAMBOOK_DESIGN_SYSTEM_RETIRED_DOCS);
  });

	  it('models container levels and keeps level 4 derivable rather than independently designed', () => {
	    expect(BAMBOOK_CONTAINER_LEVELS.map(level => level.id)).toEqual([
	      'shell-sidebar-underlay',
	      'level-1-frame',
	      'level-2-raised-or-inset',
	      'level-3-tertiary',
	      'level-4-derived',
    ]);

    const sidebarShell = BAMBOOK_CONTAINER_LEVELS[0];
    const level1 = BAMBOOK_CONTAINER_LEVELS[1];
    const level2 = BAMBOOK_CONTAINER_LEVELS[2];
    const level3 = BAMBOOK_CONTAINER_LEVELS[3];
    const level4 = BAMBOOK_CONTAINER_LEVELS[4];

    expect(sidebarShell.shadowToken).toBe('none');
    expect(sidebarShell.shadowRole).toBe('none');
	    expect(sidebarShell.shadowMode).toBe('none');
	    expect(sidebarShell.rule).toContain('not a container surface');
	    expect(level1.backgroundToken).toBe('--ui-lab-panel-shared-glass-background');
	    expect(level1.shadowToken).toBe('none');
	    expect(level1.shadowRole).toBe('none');
	    expect(level1.shadowMode).toBe('none');
	    expect(level1.rule).toContain('shared glass film and blur');
	    expect(level1.rule).toContain('must not carry rim');
	    expect(level2.backgroundToken).toBe('--ui-lab-panel-nested-glass-background');
	    expect(level2.shadowToken).toBe('none');
	    expect(level2.rule).toContain('do not reintroduce rim or depth');
	    expect(level3.primitive).toBe('bambook-tertiary-surface');
	    expect(level3.backgroundToken).toContain('--bambook-rdl-inset-fill');
	    expect(level3.shadowToken).toBe('none');
	    expect(level4.primitive).toBe('not implemented');
	    expect(level4.source).toContain('derive from level 3');
	    expect(level4.rule).toContain('Prefer content-only grouping');
	    expect(level4.shadowToken).toBe('none');
	  });

  it('defines material library categories that UI Lab must render over time', () => {
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES.map(category => category.id)).toEqual([
	      'materials',
	      'flatness',
	      'controls',
	      'content',
	    ]);
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[0].items).toContain('shell-sidebar-underlay');
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[0].items).toContain('level-4-derived');
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[1].items).toContain('shadow-none');
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[1].items).toContain('rim-none');
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[1].items).toContain('depth-none');
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[1].items).toContain('drop-shadow-none');
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[1].items).toContain('container-border-zero');
	    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[1].items).toContain('rdl-matte-frosted-container');
    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[2].items).toContain('recessedField');
    expect(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[3].items).toContain('scrollEdgeFade');
  });

  it('declares layout, adaptive color, state, component, content, and page-generation grammar', () => {
    expect(BAMBOOK_LAYOUT_GRAMMAR.pageShell.canvas).toContain('desktop canvas');
    expect(BAMBOOK_LAYOUT_GRAMMAR.sidebarShell.geometry).toContain('width 270px');
    expect(BAMBOOK_LAYOUT_GRAMMAR.sidebarShell.rule).toContain('underlay');
    expect(BAMBOOK_LAYOUT_GRAMMAR.sidebarShell.rule).toContain('main cover owns the left radius');
    expect(BAMBOOK_LAYOUT_GRAMMAR.backstageShell.source).toContain('desktopBackstagePanelRowClass');
    expect(BAMBOOK_LAYOUT_GRAMMAR.titleBar.safeLeft).toContain('desktopTitleSafeLeftStyle');
    expect(BAMBOOK_LAYOUT_GRAMMAR.titleBar.rule).toContain('Sidebar expanded/collapsed');
    expect(BAMBOOK_LAYOUT_GRAMMAR.mainPanel.source).toContain('SidePanelContainer');
    expect(BAMBOOK_LAYOUT_GRAMMAR.mainPanel.topInset).toContain('64px');
    expect(BAMBOOK_LAYOUT_GRAMMAR.mainPanel.bottomInset).toContain('26px');
    expect(BAMBOOK_LAYOUT_GRAMMAR.mainPanel.bottomInset).toContain('10px');
    expect(BAMBOOK_LAYOUT_GRAMMAR.panelRows.geometry).toContain('gap 16px');
    expect(BAMBOOK_LAYOUT_GRAMMAR.panelRows.geometry).toContain('bottom 26px');
    expect(BAMBOOK_LAYOUT_GRAMMAR.panelRows.geometry).toContain('64px title bar');
    expect(BAMBOOK_LAYOUT_GRAMMAR.splitWorkspace.source).toContain('desktopSplitNavPanelClass');
    expect(BAMBOOK_LAYOUT_GRAMMAR.splitWorkspace.rule).toContain('sibling level-1 panels');
    expect(BAMBOOK_LAYOUT_GRAMMAR.scrollViewport.source).toContain('ScrollEdgeFades');
    expect(BAMBOOK_LAYOUT_GRAMMAR.scrollViewport.source).toContain('desktopMainScrollViewportClass');
    expect(BAMBOOK_LAYOUT_GRAMMAR.toolbarRow.order).toContain('search first');
    expect(BAMBOOK_LAYOUT_GRAMMAR.cardGrid.rule).toContain('Card grid gap');
    expect(BAMBOOK_LAYOUT_GRAMMAR.detailStack.source).toContain('desktopDetailStackClass');
    expect(BAMBOOK_LAYOUT_GRAMMAR.relationsDetailWorkspace.role).toBe('relations-detail-workspace');
    expect(BAMBOOK_LAYOUT_GRAMMAR.relationsDetailWorkspace.canvas).toBe('0px');
    expect(BAMBOOK_LAYOUT_GRAMMAR.relationsDetailWorkspace.contactList).toContain('280px fixed list panel');
    expect(BAMBOOK_LAYOUT_GRAMMAR.relationsDetailWorkspace.rule).toContain('Do not create local list widths');
    expect(BAMBOOK_LAYOUT_GRAMMAR.relationsTableWorkspace.role).toBe('relations-table-workspace');
    expect(BAMBOOK_LAYOUT_GRAMMAR.relationsTableWorkspace.source).toContain('relationsTableColumnTemplateClass');
    expect(BAMBOOK_LAYOUT_GRAMMAR.relationsTableWorkspace.columns).toContain('w-[27%]');
    expect(BAMBOOK_LAYOUT_GRAMMAR.relationsTableWorkspace.rule).toContain('share one column contract');
    expect(BAMBOOK_LAYOUT_GRAMMAR.formStack.source).toContain('desktopFormGridClass');
    expect(BAMBOOK_LAYOUT_GRAMMAR.tableViewport.rule).toContain('must not become cards');
    expect(BAMBOOK_LAYOUT_GRAMMAR.spacing.rule).toContain('Do not use spacing to fake a new material level');
    expect(BAMBOOK_LAYOUT_GRAMMAR.spacing.mainPanelBottomInset).toBe('26px');
    expect(BAMBOOK_LAYOUT_GRAMMAR.spacing.singlePanelBody).toContain('desktopSinglePanelBodyClass');

    expect(BAMBOOK_ADAPTIVE_COLOR_GRAMMAR.source).toBe('components/ui/osAdaptiveContrast.ts');
    expect(BAMBOOK_ADAPTIVE_COLOR_GRAMMAR.adaptiveAllowedOn).toContain('sidebar idle labels and icons');
    expect(BAMBOOK_ADAPTIVE_COLOR_GRAMMAR.adaptiveForbiddenOn).toContain('selected controls');

    expect(BAMBOOK_STATE_GRAMMAR.map(model => model.id)).toEqual([
      'action-control',
      'state-control',
      'field',
      'async-content',
    ]);
    expect(BAMBOOK_STATE_GRAMMAR.find(model => model.id === 'state-control')?.states).toContain('selected');
    expect(BAMBOOK_STATE_GRAMMAR.find(model => model.id === 'field')?.states).toContain('focus');

    expect(BAMBOOK_COMPONENT_GRAMMAR.map(component => component.id)).toEqual([
      'button',
      'input',
      'switch',
      'chip-badge',
      'table',
      'overlay',
    ]);
    expect(BAMBOOK_COMPONENT_GRAMMAR.find(component => component.id === 'switch')?.forbidden).toContain('circular thumb smaller than half track height');

    expect(BAMBOOK_CONTENT_GRAMMAR.missingData.emptyValue).toBe('未填');
    expect(BAMBOOK_CONTENT_GRAMMAR.labels.button).toContain('verb + object');
    expect(BAMBOOK_PAGE_GENERATION_GRAMMAR.requiredInputs).toContain('primary task');
    expect(BAMBOOK_PAGE_GENERATION_GRAMMAR.derivationOrder).toContain('map inline records to level-3 or derived level-4 surfaces');
    expect(BAMBOOK_PAGE_GENERATION_GRAMMAR.uniquenessRule).toContain('If two visual outcomes are possible');
    expect(BAMBOOK_DESIGN_SYSTEM_CONTRACT.compilerUniformityContracts).toBe(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS);
  });

  it('defines compiler-wide uniformity contracts beyond material and layout tokens', () => {
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.semanticInputSchema.requiredKeys).toEqual([
      'pageType',
      'primaryTask',
      'density',
      'navigationDepth',
      'contentModel',
      'mutationModel',
      'stateModel',
      'entityKind',
      'referenceSurface',
    ]);
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.semanticInputSchema.forbiddenKeys).toContain('titlePosition');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.variantGrammar.examples).toContain('CompiledPanel level: shell | 1 | 2 | 3 | derived');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.slotGrammar.ownedByTemplate).toContain('toolbar.viewSwitch');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.layerStack.order).toEqual([
      'wallpaper',
      'ambient-light',
      'app-shell',
      'sidebar-shell',
      'page-title',
      'page-panel',
      'panel-content',
      'floating-toolbar',
      'popover',
      'modal',
      'toast',
    ]);
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.ownership.material).toContain('backdrop sampling');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.ownership.shadow).toContain('disabled globally');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.ownership.shadow).toContain('fill, blur, spacing');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.actionHierarchy.roles).toContain('destructiveAction');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.dataFormatting.missing).toBe('未填');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.portalOverlay.surfaces).toContain('select-menu');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.focusAndAccessibility.states).toContain('aria-invalid');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.responsiveProfiles.profiles).toContain('desktop-ultrawide');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.provenance.bridgeState).toBe('provisionalBridge');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.referenceSnapshot.requiredFields).toContain('pixelTolerance');
    expect(BAMBOOK_COMPILER_UNIFORMITY_CONTRACTS.ciGate.checks).toContain('no page-local title geometry');
  });

  it('makes every material library sample auditable by category, role, token, usage, and forbidden rule', () => {
    const categoryIds = new Set(BAMBOOK_MATERIAL_LIBRARY_CATEGORIES.map(category => category.id));
    expect(BAMBOOK_MATERIAL_LIBRARY_ITEMS.length).toBeGreaterThanOrEqual(10);

    BAMBOOK_MATERIAL_LIBRARY_ITEMS.forEach(item => {
      expect(categoryIds.has(item.category as typeof BAMBOOK_MATERIAL_LIBRARY_CATEGORIES[number]['id'])).toBe(true);
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.role.length).toBeGreaterThan(0);
      expect(item.token.length).toBeGreaterThan(0);
      expect(item.usage.length).toBeGreaterThan(0);
      expect(item.forbidden.length).toBeGreaterThan(0);
      expect(['implemented', 'derived']).toContain(item.status);
    });

    expect(BAMBOOK_MATERIAL_LIBRARY_ITEMS.some(item => item.status === 'derived')).toBe(true);
    expect(BAMBOOK_DESIGN_SYSTEM_CONTRACT.materialLibraryItems).toBe(BAMBOOK_MATERIAL_LIBRARY_ITEMS);
  });

	  it('forbids independent page-local material systems', () => {
	    expect(BAMBOOK_DESIGN_SYSTEM_RULES).toContain('Page files may compose recipes, but must not create independent glass, shadow, selected, hover, or focus materials.');
	    expect(BAMBOOK_DESIGN_SYSTEM_RULES).toContain('Flat surface mode is global: containers may use uniform alpha fill, blur, spacing, and hierarchy, but no shadow, rim, inset highlight, gradient edge, or depth caster.');
	    expect(BAMBOOK_DESIGN_SYSTEM_RULES).toContain('RonDesignLab-style matte frosted containers use zero border, no pseudo highlight, no noise, no container gradient, and moderate backdrop blur.');
	    expect(BAMBOOK_DESIGN_SYSTEM_RULES).toContain('Ghost shadow casters are disabled in flat mode. Scroll masks may remain, but depth-only shadow layers must render as none.');
	    expect(BAMBOOK_DESIGN_SYSTEM_CONTRACT.compilerUniformityContracts.ownership.spotlight).toContain('border box');
	    expect(BAMBOOK_DESIGN_SYSTEM_CONTRACT.compilerUniformityContracts.ownership.spotlight).toContain('single tracking light');
	    expect(BAMBOOK_DESIGN_SYSTEM_CONTRACT.compilerUniformityContracts.ownership.spotlight).toContain('top z-plane');
	    expect(BAMBOOK_DESIGN_SYSTEM_RULES).toContain('Spotlight tracking layers inherit the host radius, but must not create rim, border glow, or raised depth.');
	    expect(BAMBOOK_DESIGN_SYSTEM_RULES).toContain('Fourth-level containers are derived from the level system. They are not allowed to introduce new color families, glow colors, rims, or shadows.');
    expect(BAMBOOK_DESIGN_SYSTEM_RULES).toContain('Pages declare semantic input only. Layout, material, shadow, typography, state, motion, slot structure, overlay behavior, and responsive profile are compiler-owned.');
    expect(BAMBOOK_DESIGN_SYSTEM_RULES).toContain('Legacy or partially migrated surfaces must be marked provisionalBridge and cannot define accepted output.');
  });

  it('loads the flat surface stylesheet as the global no-shadow and no-rim override', () => {
    const flatCss = readFileSync(resolve(__dirname, '../../styles/flat-experimental.css'), 'utf8');
    const osVNextCss = readFileSync(resolve(__dirname, '../../styles/os-vnext.css'), 'utf8');
    const entrySource = readFileSync(resolve(__dirname, '../../index.tsx'), 'utf8');
    const devEntrySource = readFileSync(resolve(__dirname, '../../dev-panda-lab.tsx'), 'utf8');
    const indexCss = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

    expect(flatCss).toContain('--ui-lab-panel-frame-shadow: none !important');
    expect(flatCss).toContain('--ui-lab-panel-surface-shadow: none !important');
    expect(flatCss).toContain('[data-glass-edge-mask-shadow-caster]');
    expect(flatCss).toContain('display: none !important;');
    expect(flatCss).toContain('border-color: transparent !important;');
    expect(flatCss).toContain('[style*="drop-shadow"]');
    expect(flatCss).toContain('[class*="hover:scale"]');
    expect(flatCss).toContain('Final app-scope guard');
    expect(flatCss).toContain('--ui-lab-panel-highlight-background: none !important');
    expect(flatCss).toContain('--ui-lab-panel-seam-interference-background: none !important');
    expect(flatCss).toContain('Generic Tailwind container guard');
    expect(flatCss).toContain('[class*="shadow-"][class*="rounded"]');
    expect(flatCss).toContain('[class*="bg-white/"][class*="rounded"]');
    expect(flatCss).toContain('background-clip: border-box !important;');
    expect(flatCss).toContain('Container rim hard kill');
    expect(flatCss).toContain('border-width: 0 !important;');
    expect(flatCss).toContain('border: 0 !important;');
    expect(flatCss).toContain('.bambook-dashboard-glass-color');
    expect(flatCss).toContain('.liquid-glass-card');
    expect(flatCss).toContain('[class*="border-white/"][class*="rounded"]');
    expect(osVNextCss).toContain('--bambook-rdl-theme-rgb: 255 255 255;');
    expect(osVNextCss).toContain('--bambook-rdl-theme-strong-rgb: 10 10 10;');
    expect(osVNextCss).toContain('--bambook-rdl-panel-fill-light: rgb(255 255 255 / 0.44);');
    expect(osVNextCss).toContain('--bambook-rdl-card-fill-light: rgb(255 255 255 / 0.38);');
    expect(osVNextCss).toContain('--bambook-rdl-panel-fill-dark: rgb(20 35 47 / 0.48);');
    expect(osVNextCss).toContain('--bambook-rdl-primary-text: rgb(7 10 14);');
    expect(osVNextCss).toContain('--bambook-rdl-secondary-text: rgb(52 58 65);');
    expect(osVNextCss).toContain('--bambook-rdl-muted-text: rgb(82 90 100);');
    expect(osVNextCss).toContain('.bambook-os-root[data-wallpaper-mode="on"]');
    expect(osVNextCss).toContain('--bambook-rdl-theme-rgb: 82 99 110;');
    expect(osVNextCss).toContain('--bambook-rdl-theme-strong-rgb: 38 52 62;');
    expect(osVNextCss).toContain('--bambook-rdl-panel-fill-light: rgb(255 255 255 / 0.30);');
    expect(osVNextCss).toContain('--bambook-rdl-card-fill-light: rgb(255 255 255 / 0.24);');
    expect(osVNextCss).toContain('--bambook-rdl-primary-text: rgb(255 255 255);');
    expect(osVNextCss).toContain('--bambook-rdl-secondary-text: rgb(226 234 240);');
    expect(osVNextCss).toContain('--bambook-rdl-muted-text: rgb(188 202 212);');
    expect(osVNextCss).toContain('--bambook-rdl-brand-text: rgb(255 255 255);');
    expect(flatCss).toContain('.bambook-os-root[data-wallpaper-mode="on"] [data-ui-lab-wallpaper-contrast="primary"]');
    expect(flatCss).toContain('.bambook-os-root:not([data-wallpaper-mode="on"]) [data-ui-lab-wallpaper-contrast="primary"]');
    expect(flatCss).toContain(':where(.text-os-adaptive-title, .text-os-adaptive-primary)');
    expect(flatCss).toContain(':where(.text-os-adaptive-brand)');
    expect(flatCss).toContain(':where(svg)');
    expect(flatCss).toContain('stroke: currentColor !important;');
    expect(flatCss).toContain('opacity: 1 !important;');
    expect(flatCss).toContain('[class*="text-white/"]');
    expect(flatCss).toContain('[class*="text-white/[0.8"]');
    expect(flatCss).toContain('color: var(--bambook-rdl-secondary-text) !important;');
    expect(flatCss).toContain('color: var(--bambook-rdl-primary-text) !important;');
    expect(flatCss).toContain(':where(span, p, h1, h2, h3, h4, h5, h6, label, button, a, small, strong, svg)[class*="opacity-"]');
    expect(flatCss).toContain('.dashboard-hud-root :where(');
    expect(flatCss).toContain('border-radius: 34px !important;');
    expect(flatCss).toContain('[class*="text-[var(--os-vnext-brand-blue"]');
    expect(flatCss).toContain('.app-sidebar [data-sidebar-nav-item][data-sidebar-nav-active="false"]');
    expect(flatCss).toContain('Bridge legacy OS vNext and "blue-white" material classes');
    expect(flatCss).toContain('.bambook-blue-white-light');
    expect(flatCss).toContain('.bambook-blue-white-surface');
    expect(osVNextCss).toContain('--bambook-rdl-panel-filter: saturate(124%) blur(15px);');
    expect(osVNextCss).toContain('--bambook-rdl-floating-filter: saturate(128%) blur(20px);');
    expect(flatCss).toContain('--ui-lab-panel-surface-filter: var(--bambook-rdl-panel-filter) !important;');
    expect(flatCss).toContain('--ui-lab-panel-noise-opacity: 0 !important;');
    expect(flatCss).toContain('--bambook-selected-light-background: var(--bambook-rdl-inset-fill) !important;');
    expect(flatCss).toContain('background-color: var(--bambook-rdl-panel-fill) !important;');
    expect(flatCss).toContain('background-color: var(--bambook-rdl-card-fill) !important;');
    expect(flatCss).toContain('background-color: var(--bambook-rdl-inset-fill) !important;');
    expect(flatCss).toContain('background-image: none !important;');
    expect(flatCss).toContain('-webkit-backdrop-filter: var(--bambook-rdl-panel-filter) !important;');
    expect(entrySource.indexOf("import './styles/flat-experimental.css';")).toBeGreaterThan(entrySource.indexOf("import './index.css';"));
    expect(devEntrySource.indexOf("import './styles/flat-experimental.css';")).toBeGreaterThan(devEntrySource.indexOf("import './index.css';"));
    expect(indexCss).toContain("@import './styles/flat-experimental.css';");
  });

  it('keeps the documentation tied to the same contract names', () => {
    const docsRoot = resolve(__dirname, '../../docs/design-system');
    const readDoc = (file: string) => readFileSync(resolve(docsRoot, file), 'utf8');

    expect(readDoc('README.md')).toContain('components/ui/bambookDesignSystem.ts');
    expect(readDoc('README.md')).toContain('Do not create page-local glass colors');
    expect(readDoc('design-constitution.md')).toContain('Every Visible Thing Has A Role');
    expect(readDoc('tokens.md')).toContain('Decision Tokens');
    expect(readDoc('layout-grammar.md')).toContain('Page Shell');
    expect(readDoc('layout-grammar.md')).toContain('Split Workspace');
    expect(readDoc('layout-grammar.md')).toContain('Relations Detail Workspace');
    expect(readDoc('layout-grammar.md')).toContain('Relations Table Workspace');
    expect(readDoc('layout-grammar.md')).toContain('Contact list panel: fixed `280px`');
    expect(readDoc('layout-grammar.md')).toContain('Header columns: `27% / 22% / 27% / 17% / 7%`');
    expect(readDoc('layout-grammar.md')).toContain('Safe-left style: `BAMBOOK_OS.layout.desktopTitleSafeLeftStyle`');
    expect(readDoc('layout-grammar.md')).toContain('Toolbar Row');
    expect(readDoc('layout-grammar.md')).toContain('Table Viewport');
    expect(readDoc('layout-grammar.md')).toContain('Do not put a nav area and a main area inside one larger frame panel');
    expect(readDoc('material-grammar.md')).toContain('ghost shadow');
    expect(readDoc('material-grammar.md')).toContain('Spotlight clipping');
    expect(readDoc('material-grammar.md')).toContain('Surface And Shadow Are Separate');
    expect(readDoc('component-grammar.md')).toContain('Action button: idle, hover, press');
    expect(readDoc('content-language.md')).toContain('Missing Data');
    expect(readDoc('material-grammar.md')).toContain('--ui-lab-panel-shared-glass-background');
    expect(readDoc('material-grammar.md')).toContain('--ui-lab-panel-nested-glass-background');
    expect(readDoc('material-grammar.md')).toContain('--bambook-selected-light-background');
    expect(readDoc('material-grammar.md')).toContain('Level 4: Derived Micro Surface');
    expect(readDoc('component-grammar.md')).toContain('Hover must not look selected');
    expect(readDoc('component-grammar.md')).toContain('Scroll Fade');
    // design-compiler.md 与 page-generation.md 已于 2026-08-27 归档至 docs/archive/superseded/
    // （compiled 双路径 2026-08-18 删除后编译器叙事退役），对应断言一并移除。
    expect(readDoc('governance.md')).toContain('Compiler Uniformity Gate');
    expect(readDoc('governance.md')).toContain('New z-index layer stacks');
    expect(readDoc('governance.md')).toContain('New portal roots or overlay placement rules');
    expect(readDoc('governance.md')).toContain('Page files may not own');
    expect(readDoc('governance.md')).toContain('remains runtime legacy only');
  });

  it('retires old active design documents without deleting historical evidence', () => {
    const repoRoot = resolve(__dirname, '../..');
    const activeDocsRoot = resolve(repoRoot, 'docs/design-system');
    const archiveRoot = resolve(repoRoot, 'docs/archive/design-history');
    const readRepoFile = (file: string) => readFileSync(resolve(repoRoot, file), 'utf8');

    expect(existsSync(resolve(activeDocsRoot, 'material-levels.md'))).toBe(false);
    expect(existsSync(resolve(activeDocsRoot, 'component-rules.md'))).toBe(false);
    expect(existsSync(resolve(activeDocsRoot, 'migration.md'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'bambook-ui-spec.md'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'docs/Bambook-OS-UI-Guidelines.md'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'docs/UI_AUDIT_REPORT.md'))).toBe(false);
    expect(existsSync(resolve(archiveRoot, 'bambook-ui-spec.md'))).toBe(true);
    expect(existsSync(resolve(archiveRoot, 'Bambook-OS-UI-Guidelines.md'))).toBe(true);
    expect(existsSync(resolve(archiveRoot, 'UI_AUDIT_REPORT.md'))).toBe(true);
    expect(readRepoFile('docs/archive/design-history/README.md')).toContain('historical records only');
    // styles/design-system.css 已于 2026-09-01 物理删除（legacy 死文件，运行时零引用）——断言不可复活。
    expect(existsSync(resolve(repoRoot, 'styles/design-system.css'))).toBe(false);
  });
});
