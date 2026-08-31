import { BAMBOOK_OS } from '../bambookOsTokens';
import type { OSMaterialRole, OSShadowMode, OSShadowRole } from '../osMaterial';

export type OSCompilerProvenance = 'accepted' | 'provisional' | 'experimental' | 'retired';

export type OSCompilerVisualSystem =
  | 'layout'
  | 'material'
  | 'shadow'
  | 'typography'
  | 'motion'
  | 'state'
  | 'iconography'
  | 'content-language'
  | 'responsive-scale'
  | 'visual-provenance'
  | 'reference-snapshot'
  | 'slot-contract';

export const OS_COMPILER_VISUAL_SYSTEMS: OSCompilerVisualSystem[] = [
  'layout',
  'material',
  'shadow',
  'typography',
  'motion',
  'state',
  'iconography',
  'content-language',
  'responsive-scale',
  'visual-provenance',
  'reference-snapshot',
  'slot-contract',
];

export const OS_COMPILER_FORBIDDEN_ESCAPE_HATCHES = [
  'page-local-title-layout',
  'page-local-panel-width',
  'page-local-material-color',
  'page-local-shadow',
  'page-local-radius',
  'page-local-hover-state',
  'page-local-selected-state',
  'page-local-focus-ring',
  'page-local-animation',
  'page-local-toolbar-structure',
  'page-local-scroll-fade',
  'page-local-instructional-copy',
  'nested-card-inside-card',
] as const;

export type OSCompilerPageType =
  | 'dashboard'
  | 'resource-library'
  | 'list-detail'
  | 'settings'
  | 'module-backstage'
  | 'data-table'
  | 'form'
  | 'internal-reference';

export type OSCompilerDensity = 'compact' | 'standard' | 'spacious';
export type OSCompilerNavigationDepth = 'root' | 'module' | 'split-workspace' | 'drill-in';
export type OSCompilerContentModel =
  | 'dashboard-summary'
  | 'card-grid'
  | 'card-grid-table-switch'
  | 'list-detail'
  | 'table'
  | 'form-stack'
  | 'settings-sections'
  | 'material-library';
export type OSCompilerMutationModel = 'read-only' | 'read-mostly' | 'inline-edit' | 'crud' | 'configuration';
export type OSCompilerStateModel = 'loading' | 'empty' | 'error' | 'ready' | 'dirty';

export type OSCompilerPageInput = {
  pageId: string;
  pageType: OSCompilerPageType;
  title: {
    primary: string;
    brand?: string;
    child?: string;
  };
  density: OSCompilerDensity;
  navigationDepth: OSCompilerNavigationDepth;
  contentModel: OSCompilerContentModel;
  mutationModel: OSCompilerMutationModel;
  stateModel: OSCompilerStateModel;
  referenceSurface: string;
  provenanceOverrides?: Partial<Record<OSCompilerVisualSystem | 'referenceSnapshot', OSCompilerProvenance>>;
};

type ComponentBlueprint<Name extends string> = {
  component: Name;
  className: string;
  source: string;
};

type SurfaceBlueprint = {
  materialRole: OSMaterialRole | 'tertiarySurface' | 'derivedOnly';
  materialTone: 'panel' | 'nested' | 'derived';
  shadowRole: OSShadowRole;
  shadowMode: OSShadowMode;
  source: string;
};

export type OSCompilerPageBlueprint = {
  version: 'bambook-os-compiler-v1';
  pageId: string;
  input: OSCompilerPageInput;
  layout: {
    pageShell: ComponentBlueprint<'CompiledPage'>;
    titleBar: ComponentBlueprint<'CompiledTitleBar'>;
    canvas: ComponentBlueprint<'CompiledPageCanvas'> & { maxWidth: number };
    panelRow: ComponentBlueprint<'CompiledPanelRow'>;
    splitWorkspace: ComponentBlueprint<'CompiledSplitWorkspace'>;
    toolbar: ComponentBlueprint<'CompiledToolbarRow'>;
    scrollViewport: ComponentBlueprint<'CompiledScrollViewport'> & {
      edgeFade: {
        topStartOffset: number;
        topHeight: number;
        bottomHeight: number;
        source: string;
      };
    };
    sectionStack: ComponentBlueprint<'CompiledSectionStack'>;
    content: ComponentBlueprint<'CompiledCardGrid' | 'CompiledTableViewport' | 'CompiledFormStack' | 'CompiledDetailStack'>;
  };
  material: {
    sidebarShell: SurfaceBlueprint;
    mainPanel: SurfaceBlueprint;
    sectionPanel: SurfaceBlueprint;
    insetPanel: SurfaceBlueprint;
    inlinePanel: SurfaceBlueprint;
    floatingOverlay: SurfaceBlueprint;
  };
  typography: {
    pageTitle: ComponentBlueprint<'CompiledPageTitle'>;
    breadcrumb: ComponentBlueprint<'CompiledBreadcrumb'>;
    sectionTitle: ComponentBlueprint<'CompiledSectionTitle'>;
    metadata: ComponentBlueprint<'CompiledMetadataText'>;
    fieldLabel: ComponentBlueprint<'CompiledFieldLabel'>;
    tableHeader: ComponentBlueprint<'CompiledTableHeader'>;
    buttonLabel: ComponentBlueprint<'CompiledButtonLabel'>;
  };
  motion: {
    hover: { durationMs: number; easing: string; transform: string };
    press: { durationMs: number; easing: string; transform: string };
    selected: { durationMs: number; easing: string };
    layout: { durationMs: number; easing: string };
  };
  iconography: {
    defaultSize: number;
    titleSize: number;
    strokeWidth: number;
    wellPolicy: 'bare-by-default';
    source: string;
  };
  contentLanguage: {
    interfaceLanguage: 'zh-CN';
    domainLanguage: 'preserve-source-identifiers';
    emptyValue: string;
    rule: string;
  };
  stateMatrix: Array<'idle' | 'hover' | 'press' | 'selected' | 'focus' | 'disabled' | 'loading' | 'empty' | 'error' | 'dirty' | 'readonly'>;
  responsive: {
    desktopCanvas: number;
    titleBarHeight: number;
    mainPanelBottomInset: number;
    scaleVariable: '--ui-lab-app-scale';
    source: string;
  };
  slotContract: {
    requiredSlots: string[];
    optionalSlots: string[];
    rule: string;
  };
  provenance: Record<OSCompilerVisualSystem | 'referenceSnapshot', OSCompilerProvenance>;
  fidelity: {
    referenceSurface: string;
    gates: string[];
    visualDriftPolicy: string;
  };
  forbiddenEscapeHatches: typeof OS_COMPILER_FORBIDDEN_ESCAPE_HATCHES;
};

export type UiLabReplicaShellInput = {
  activeView: string;
  isDarkMode: boolean;
  isCollapsed: boolean;
  uiLabAppScale: number;
  hasBackgroundImage: boolean;
  hasGlobeUnderlay: boolean;
  isProductModuleSettingsWorkspaceOpen: boolean;
  isMaterialLibraryReferenceMode: boolean;
};

export type UiLabReplicaShellBlueprint = {
  version: 'bambook-os-compiler-v1';
  source: 'ui-lab-1.0-code-contract';
  root: {
    dataShell: 'real-bambook-os-replica';
    dataView: string;
    className: string;
    styleVars: {
      '--app-sidebar-w': string;
      '--ui-lab-app-scale': string;
    };
  };
  wallpaperGuard: {
    enabled: boolean;
    className: 'ui-lab-real-os-wallpaper-guard';
  };
  ambient: {
    className: 'ui-lab-real-os-ambient';
    layers: ['ui-lab-real-os-ambient__a', 'ui-lab-real-os-ambient__b', 'ui-lab-real-os-ambient__c'];
  };
  edgeShadowLayer: {
    className: 'ui-lab-scroll-edge-shadow-layer';
    source: 'syncUiLabScrollEdgeShadowProxies';
  };
  sidebar: {
    component: 'Sidebar';
    allowedViewsSource: 'UI_LAB_SIDEBAR_VIEWS';
    classContract: 'app-sidebar';
  };
  main: {
    className: string;
    frameClassName: string;
    contentClassName: string;
  };
  globeUnderlay: {
    enabled: boolean;
    className: 'ui-lab-production-globe-underlay';
  };
  productSettingsFab: {
    enabled: boolean;
    dataAttr: 'data-ui-lab-module-settings-fab';
    materialRole: 'floatingOverlay';
    shadowRole: 'none';
  };
  slotContract: {
    pageSlot: 'dashboard' | 'relations' | 'products' | 'settings' | 'material-library';
    rule: 'UI Lab 2.0 renders the same product slots as UI Lab 1.0; the compiler owns shell selection and slot placement.';
  };
};

const contentComponentByModel: Record<OSCompilerContentModel, OSCompilerPageBlueprint['layout']['content']['component']> = {
  'dashboard-summary': 'CompiledCardGrid',
  'card-grid': 'CompiledCardGrid',
  'card-grid-table-switch': 'CompiledCardGrid',
  'list-detail': 'CompiledDetailStack',
  table: 'CompiledTableViewport',
  'form-stack': 'CompiledFormStack',
  'settings-sections': 'CompiledDetailStack',
  'material-library': 'CompiledDetailStack',
};

const defaultProvenance = (): OSCompilerPageBlueprint['provenance'] => ({
  layout: 'accepted',
  material: 'accepted',
  shadow: 'accepted',
  typography: 'accepted',
  motion: 'accepted',
  state: 'accepted',
  iconography: 'accepted',
  'content-language': 'accepted',
  'responsive-scale': 'accepted',
  'visual-provenance': 'accepted',
  'reference-snapshot': 'provisional',
  'slot-contract': 'accepted',
  referenceSnapshot: 'provisional',
});

export const compileUiLabReplicaShell = (input: UiLabReplicaShellInput): UiLabReplicaShellBlueprint => {
  const isDashboard = input.activeView === 'dashboard';
  const pointerGuard = input.hasGlobeUnderlay ? 'pointer-events-none' : '';
  const pageSlot = input.isMaterialLibraryReferenceMode
    ? 'material-library'
    : input.activeView === 'relations'
      ? 'relations'
      : input.activeView === 'products'
        ? 'products'
        : input.activeView === 'settings' || input.activeView === 'account-settings' || input.activeView === 'system-settings'
          ? 'settings'
          : 'dashboard';

  return {
    version: 'bambook-os-compiler-v1',
    source: 'ui-lab-1.0-code-contract',
    root: {
      dataShell: 'real-bambook-os-replica',
      dataView: input.activeView,
      className: `ui-lab-real-os-root ${isDashboard ? '' : 'ui-lab-real-os-root--thin-type'} ${input.isDarkMode ? 'dark ui-lab-real-os-root--dark' : ''}`,
      styleVars: {
        '--app-sidebar-w': input.isCollapsed ? '64px' : '320px',
        '--ui-lab-app-scale': input.uiLabAppScale.toFixed(4),
      },
    },
    wallpaperGuard: {
      enabled: input.hasBackgroundImage,
      className: 'ui-lab-real-os-wallpaper-guard',
    },
    ambient: {
      className: 'ui-lab-real-os-ambient',
      layers: ['ui-lab-real-os-ambient__a', 'ui-lab-real-os-ambient__b', 'ui-lab-real-os-ambient__c'],
    },
    edgeShadowLayer: {
      className: 'ui-lab-scroll-edge-shadow-layer',
      source: 'syncUiLabScrollEdgeShadowProxies',
    },
    sidebar: {
      component: 'Sidebar',
      allowedViewsSource: 'UI_LAB_SIDEBAR_VIEWS',
      classContract: 'app-sidebar',
    },
    main: {
      className: `app-main flex-1 flex flex-col min-w-0 overflow-visible relative opacity-100 ${pointerGuard}`,
      frameClassName: `flex-1 min-h-0 relative overflow-visible flex flex-col ${pointerGuard}`,
      contentClassName: `flex-1 h-full overflow-visible ${input.hasGlobeUnderlay ? 'pointer-events-none' : 'pointer-events-auto'}`,
    },
    globeUnderlay: {
      enabled: input.hasGlobeUnderlay,
      className: 'ui-lab-production-globe-underlay',
    },
    productSettingsFab: {
      enabled: !input.isMaterialLibraryReferenceMode && input.activeView === 'products' && !input.isProductModuleSettingsWorkspaceOpen,
      dataAttr: 'data-ui-lab-module-settings-fab',
      materialRole: 'floatingOverlay',
      shadowRole: 'none',
    },
    slotContract: {
      pageSlot,
      rule: 'UI Lab 2.0 renders the same product slots as UI Lab 1.0; the compiler owns shell selection and slot placement.',
    },
  };
};

export const compileBambookPage = (input: OSCompilerPageInput): OSCompilerPageBlueprint => {
  const provenance = {
    ...defaultProvenance(),
    ...input.provenanceOverrides,
  };
  const contentComponent = contentComponentByModel[input.contentModel];
  const isSplit = input.navigationDepth === 'split-workspace' || input.pageType === 'settings' || input.pageType === 'module-backstage';

  return {
    version: 'bambook-os-compiler-v1',
    pageId: input.pageId,
    input,
    layout: {
      pageShell: {
        component: 'CompiledPage',
        className: isSplit ? BAMBOOK_OS.layout.desktopWorkspaceFrameClass : BAMBOOK_OS.layout.desktopPageFrameClass,
        source: 'BAMBOOK_OS.layout.desktopPageFrameClass|desktopWorkspaceFrameClass',
      },
      titleBar: {
        component: 'CompiledTitleBar',
        className: BAMBOOK_OS.layout.desktopTitleBarWithInsetClass,
        source: 'BAMBOOK_OS.layout.desktopTitleBarWithInsetClass',
      },
      canvas: {
        component: 'CompiledPageCanvas',
        className: BAMBOOK_OS.layout.desktopPageCanvasClass,
        source: 'BAMBOOK_OS.layout.desktopPageCanvasClass',
        maxWidth: BAMBOOK_OS.layout.desktopMainMaxWidth,
      },
      panelRow: {
        component: 'CompiledPanelRow',
        className: isSplit ? BAMBOOK_OS.layout.desktopBackstagePanelRowClass : BAMBOOK_OS.layout.desktopPanelRowClass,
        source: 'BAMBOOK_OS.layout.desktopPanelRowClass|desktopBackstagePanelRowClass',
      },
      splitWorkspace: {
        component: 'CompiledSplitWorkspace',
        className: `${BAMBOOK_OS.layout.desktopSplitNavPanelClass} + ${BAMBOOK_OS.layout.desktopSplitMainPanelClass}`,
        source: 'BAMBOOK_OS.layout.desktopSplitNavPanelClass + desktopSplitMainPanelClass',
      },
      toolbar: {
        component: 'CompiledToolbarRow',
        className: BAMBOOK_OS.layout.desktopToolbarRowClass,
        source: 'BAMBOOK_OS.layout.desktopToolbarRowClass',
      },
      scrollViewport: {
        component: 'CompiledScrollViewport',
        className: `${BAMBOOK_OS.layout.desktopMainScrollViewportClass} ${BAMBOOK_OS.layout.panelShadowViewportClass}`,
        source: 'BAMBOOK_OS.layout.desktopMainScrollViewportClass + panelShadowViewportClass',
        edgeFade: {
          topStartOffset: BAMBOOK_OS.layout.cardGridEdgeFadeTopOffset,
          topHeight: BAMBOOK_OS.layout.cardGridEdgeFadeTopHeight,
          bottomHeight: BAMBOOK_OS.layout.cardGridEdgeFadeBottomHeight,
          source: 'BAMBOOK_OS.layout.cardGridEdgeFade*',
        },
      },
      sectionStack: {
        component: 'CompiledSectionStack',
        className: input.pageType === 'module-backstage' ? BAMBOOK_OS.layout.desktopBackstageContentStackClass : BAMBOOK_OS.layout.desktopDetailStackClass,
        source: 'BAMBOOK_OS.layout.desktopDetailStackClass|desktopBackstageContentStackClass',
      },
      content: {
        component: contentComponent,
        className: contentComponent === 'CompiledCardGrid'
          ? BAMBOOK_OS.layout.desktopCardGridClass
          : contentComponent === 'CompiledTableViewport'
            ? BAMBOOK_OS.layout.desktopTableViewportClass
            : contentComponent === 'CompiledFormStack'
              ? BAMBOOK_OS.layout.desktopFormStackClass
              : BAMBOOK_OS.layout.desktopDetailStackClass,
        source: 'content model -> layout component mapping',
      },
    },
    material: {
      sidebarShell: {
        materialRole: 'framePanel',
        materialTone: 'panel',
        shadowRole: 'none',
        shadowMode: 'none',
        source: 'Flat sidebar underlay reference',
      },
      mainPanel: {
        materialRole: 'framePanel',
        materialTone: 'panel',
        shadowRole: 'none',
        shadowMode: 'none',
        source: 'Level 1 flat frame panel',
      },
      sectionPanel: {
        materialRole: 'raisedCard',
        materialTone: 'nested',
        shadowRole: 'none',
        shadowMode: 'none',
        source: 'Level 2 flat nested surface',
      },
      insetPanel: {
        materialRole: 'insetSurface',
        materialTone: 'nested',
        shadowRole: 'none',
        shadowMode: 'none',
        source: 'Level 2 flat inset surface',
      },
      inlinePanel: {
        materialRole: 'tertiarySurface',
        materialTone: 'derived',
        shadowRole: 'none',
        shadowMode: 'none',
        source: 'Level 3 flat derived tertiary surface',
      },
      floatingOverlay: {
        materialRole: 'floatingOverlay',
        materialTone: 'panel',
        shadowRole: 'none',
        shadowMode: 'none',
        source: 'Flat floating overlay material role',
      },
    },
    typography: {
      pageTitle: { component: 'CompiledPageTitle', className: BAMBOOK_OS.controls.title.textButton, source: 'BAMBOOK_OS.controls.title' },
      breadcrumb: { component: 'CompiledBreadcrumb', className: BAMBOOK_OS.controls.title.breadcrumb, source: 'BAMBOOK_OS.controls.title.breadcrumb' },
      sectionTitle: { component: 'CompiledSectionTitle', className: 'text-sm font-light tracking-tight', source: 'BAMBOOK typography section title' },
      metadata: { component: 'CompiledMetadataText', className: 'text-xs font-light leading-relaxed', source: 'BAMBOOK metadata rhythm' },
      fieldLabel: { component: 'CompiledFieldLabel', className: 'text-[10px] font-light tracking-wide', source: 'BAMBOOK field label rhythm' },
      tableHeader: { component: 'CompiledTableHeader', className: BAMBOOK_OS.layout.relationsTableHeaderCellClass, source: 'BAMBOOK_OS.layout.relationsTableHeaderCellClass' },
      buttonLabel: { component: 'CompiledButtonLabel', className: 'text-xs font-light tracking-wide', source: 'BAMBOOK_OS.controls.title.actionButton' },
    },
    motion: {
      hover: { durationMs: BAMBOOK_OS.motion.microDuration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', transform: 'material-dependent' },
      press: { durationMs: BAMBOOK_OS.motion.microDuration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', transform: 'translate-y-or-scale-by-component' },
      selected: { durationMs: BAMBOOK_OS.motion.standardDuration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      layout: { durationMs: Math.round(BAMBOOK_OS.motion.layoutTransition.duration * 1000), easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
    iconography: {
      defaultSize: 17,
      titleSize: 18,
      strokeWidth: 1.6,
      wellPolicy: 'bare-by-default',
      source: 'BAMBOOK component grammar icon policy',
    },
    contentLanguage: {
      interfaceLanguage: 'zh-CN',
      domainLanguage: 'preserve-source-identifiers',
      emptyValue: '未填',
      rule: 'Interface structure uses Chinese; product codes and source identifiers are preserved.',
    },
    stateMatrix: ['idle', 'hover', 'press', 'selected', 'focus', 'disabled', 'loading', 'empty', 'error', 'dirty', 'readonly'],
    responsive: {
      desktopCanvas: BAMBOOK_OS.layout.desktopMainMaxWidth,
      titleBarHeight: BAMBOOK_OS.layout.desktopTitleBarHeight,
      mainPanelBottomInset: BAMBOOK_OS.layout.desktopMainPanelBottomInset,
      scaleVariable: '--ui-lab-app-scale',
      source: 'UI Lab responsive scale contract',
    },
    slotContract: {
      requiredSlots: [
        'title.leading',
        'title.identity',
        'title.actions',
        'toolbar.search',
        'toolbar.filters',
        'toolbar.viewSwitch',
        'toolbar.actions',
        'content.primary',
        'content.empty',
        'content.error',
      ],
      optionalSlots: ['title.breadcrumb', 'panel.header', 'panel.footer', 'floatingAction', 'contextualAction'],
      rule: 'Pages fill semantic slots only; slot structure and visual treatment are compiler-owned.',
    },
    provenance,
    fidelity: {
      referenceSurface: input.referenceSurface,
      gates: ['compiler-output-only', 'source-provenance-visible', 'no-page-local-visual-values', 'reference-review-required'],
      visualDriftPolicy: 'Any drift from accepted reference must be either a named compiler correction or a provisional review item.',
    },
    forbiddenEscapeHatches: OS_COMPILER_FORBIDDEN_ESCAPE_HATCHES,
  };
};

export const createCompilerFidelityReport = (blueprint: OSCompilerPageBlueprint) => {
  const provisionalSystems = Object.entries(blueprint.provenance)
    .filter(([, value]) => value === 'provisional')
    .map(([key]) => (key === 'reference-snapshot' ? 'referenceSnapshot' : key))
    .filter((key, index, list) => list.indexOf(key) === index);
  return {
    pageId: blueprint.pageId,
    referenceSurface: blueprint.fidelity.referenceSurface,
    provisionalSystems,
    isFullyAccepted: provisionalSystems.length === 0,
    requiredReview: provisionalSystems.length > 0
      ? 'User review required before this blueprint becomes accepted reference.'
      : 'No provisional systems remain.',
  };
};
