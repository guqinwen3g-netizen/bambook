const toolbarBaseRecipe = 'group w-full min-w-0 h-9 !rounded-2xl border-0 backdrop-blur-[15px] backdrop-saturate-[104%]';
const toolbarContentRecipe = 'relative z-10 h-full w-full flex flex-nowrap items-center gap-3 px-3';
const toolbarAmbientRecipe = 'hidden';
const toolbarSurfaceLightRecipe =
  'glass-panel bambook-blue-white-surface bg-white/40';
const toolbarSurfaceDarkRecipe =
  'glass-panel bambook-blue-white-surface bg-[#0a0f1d]/28';
const controlFrostLightRecipe =
  'backdrop-blur-[15px] backdrop-saturate-[104%] bg-[rgba(255,255,255,0.42)]';
const controlFrostDarkRecipe =
  'backdrop-blur-[15px] backdrop-saturate-[104%] bg-[rgba(13,27,42,0.28)]';
const controlFrostHoverLightRecipe = 'hover:bg-[rgba(255,255,255,0.52)]';
const controlFrostHoverDarkRecipe = 'hover:bg-[rgba(255,255,255,0.065)]';
const controlFrostActiveLightRecipe = 'active:bg-[rgba(255,255,255,0.38)]';
const controlFrostActiveDarkRecipe = 'active:bg-[rgba(255,255,255,0.045)]';
// 单独的 shadow class——给 ghost shadow caster 节点使用，与 backdrop-filter 物理分离避免幽灵光。
const toolbarSurfaceLightShadowRecipe =
  'shadow-none';
const toolbarSurfaceDarkShadowRecipe =
  'shadow-none';
const compactCardDarkRecipe = 'bambook-card-glass';
const compactCardLightRecipe = 'bambook-card-glass';
const stateControlBaseLightRecipe =
  `bambook-blue-white-light ${controlFrostLightRecipe} !border-transparent shadow-none`;
const stateControlBaseDarkRecipe =
  `bambook-blue-white-light ${controlFrostDarkRecipe} !border-transparent shadow-none`;
const toolbarControlBaseLightRecipe =
  `${controlFrostLightRecipe} !border-transparent shadow-none`;
const toolbarControlBaseDarkRecipe =
  `${controlFrostDarkRecipe} !border-transparent shadow-none`;
const stateControlInteractionLightRecipe =
  `text-slate-500 ${controlFrostHoverLightRecipe} hover:text-[#0A2746] hover:shadow-none ${controlFrostActiveLightRecipe} active:shadow-none`;
const stateControlInteractionDarkRecipe =
  `text-slate-400 ${controlFrostHoverDarkRecipe} hover:text-slate-50 hover:shadow-none ${controlFrostActiveDarkRecipe} active:shadow-none`;
const actionControlDarkRecipe =
  `${controlFrostDarkRecipe} !border-transparent text-slate-400 shadow-none ${controlFrostHoverDarkRecipe} hover:text-slate-50 ${controlFrostActiveDarkRecipe}`;
const actionControlLightRecipe =
  `${controlFrostLightRecipe} !border-transparent text-slate-500 shadow-none ${controlFrostHoverLightRecipe} hover:text-[#0A2746] ${controlFrostActiveLightRecipe}`;
const selectedSurfaceLightRecipe = 'bambook-selected-surface bambook-selected-surface--light';
const selectedSurfaceDarkRecipe = 'bambook-selected-surface bambook-selected-surface--dark';
const recessedFieldDarkRecipe =
  'text-xs !bg-[rgba(6,14,24,0.20)] !bg-none backdrop-blur-[15px] backdrop-saturate-[104%] !border-transparent text-white placeholder-white/34 shadow-none focus:!bg-[rgba(7,18,32,0.30)] focus:!bg-none focus:!border-white/[0.08] focus:shadow-none';
const recessedFieldLightRecipe =
  'text-xs !bg-[rgba(255,255,255,0.22)] !bg-none backdrop-blur-[15px] backdrop-saturate-[104%] !border-transparent text-slate-900 placeholder-slate-400 shadow-none focus:!bg-[rgba(255,255,255,0.34)] focus:!bg-none focus:!border-slate-300/24 focus:shadow-none';

export const BAMBOOK_OS = {
  patterns: {
    materialRoles: {
      panel: 'large glass container with visible edge and subtle transmitted light',
      card: 'actionable surface with lighter footprint than a panel',
      stateControl: 'control that may keep an active state',
      actionControl: 'control that reacts only during interaction',
      recessedField: 'field carved into a panel instead of floating above it',
    },
    stateModels: {
      actionControl: ['idle', 'hover', 'press'],
      stateControl: ['idle', 'hover', 'press', 'active'],
      field: ['idle', 'focus'],
    },
    layoutRoles: {
      chrome: 'title bars, toolbars, and fixed structural controls stay visually lighter than content panels',
      scrollContent: 'fade and clipping belong to the scrolling viewport, not the chrome around it',
      nestedGroups: 'prefer one outer panel with lightweight inner grouping over cards inside cards',
    },
  },
  brand: {
    blue: 'var(--os-vnext-brand-blue)',
    blueStrong: 'var(--os-vnext-brand-blue-strong)',
    blueSoft: 'var(--os-vnext-brand-blue-soft)',
  },
  tone: {
    text: {
      brandDark: 'text-[var(--os-vnext-brand-blue-soft)]',
      brandLight: 'text-[var(--os-vnext-brand-blue-strong)]',
      brandInline: 'text-[var(--os-vnext-brand-blue)]',
      quietDark: 'text-white/58',
      quietLight: 'text-slate-600',
      formLabelDark: 'text-white/46',
      formLabelLight: 'text-slate-500',
    },
    chip: {
      subtleDark: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.045)] text-white/50',
      subtleLight: 'bg-slate-100 text-slate-500',
      dataDark: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.060)] text-white/60',
      dataLight: 'bg-slate-100 text-slate-600',
      accentDark: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.20)] text-[var(--os-vnext-brand-blue)]',
      accentLight: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.10)] text-[var(--os-vnext-brand-blue-strong)]',
      dropTargetDark: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.14)] text-[var(--os-vnext-brand-blue-soft)]',
      dropTargetLight: 'bg-white/80 text-[var(--os-vnext-brand-blue-strong)]',
      organizationTierDark:
        'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.045)] border border-transparent text-[var(--os-vnext-brand-blue-soft)] shadow-none',
      organizationTierLight: 'bg-white/24 border border-[rgb(var(--os-vnext-brand-blue-rgb)/0.18)] text-[var(--os-vnext-brand-blue-strong)]',
    },
    surface: {
      quietIconDark: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.045)]',
      quietIconLight: 'bg-slate-100',
      progressTrackDark: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.045)]',
      progressTrackLight: 'bg-slate-100',
      formMapIndexDark:
        'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.045)] border-white/[0.06] text-white/58 group-hover:text-white/80 group-hover:border-white/10',
      formMapIndexLight:
        'bg-white/34 border-white/32 text-slate-500 group-hover:text-[var(--os-vnext-brand-blue-strong)] group-hover:border-[rgb(var(--os-vnext-brand-blue-rgb)/0.18)]',
      formNestedRowDark: '',
      formNestedRowLight: '',
      inlinePanelDark: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.030)] text-white/70',
      inlinePanelLight: 'bg-slate-50 text-slate-700',
      linkedPanelDark: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.030)] border-white/[0.06]',
      linkedPanelLight: 'bg-white/55 border-white/60 shadow-none',
    },
    divider: {
      panelDark: 'border-white/[0.06]',
      panelLight: 'border-slate-200/50',
      sectionDark: 'border-white/[0.055]',
      sectionLight: 'border-slate-200/45',
    },
    status: {
      coordinate: {
        panelDark: 'bg-white/[0.035] border border-transparent',
        panelLight: 'bg-white/40 border border-transparent',
        iconDark: 'text-white/52',
        iconLight: 'text-slate-500',
        savedDark: 'bg-white/[0.045] text-white/58 border border-transparent font-normal',
        savedLight: 'bg-white/42 text-slate-500 border border-transparent font-normal',
        cityDark: 'bg-white/[0.04] text-white/54 border border-transparent font-normal',
        cityLight: 'bg-white/38 text-slate-500 border border-transparent font-normal',
        postcodeDark: 'bg-white/[0.04] text-white/54 border border-transparent font-normal',
        postcodeLight: 'bg-white/38 text-slate-500 border border-transparent font-normal',
        fallbackDark: 'bg-white/[0.032] text-white/42 border border-transparent font-normal',
        fallbackLight: 'bg-white/30 text-slate-400 border border-transparent font-normal',
      },
      organizationCompletion: {
        doneDark: 'text-white/45',
        doneLight: 'text-slate-500',
        missingDark: 'text-[var(--os-vnext-brand-blue-soft)]',
        missingLight: 'text-[var(--os-vnext-brand-blue-strong)]',
      },
    },
  },
  radius: {
    panel: 'rounded-[24px]',
    card: 'rounded-3xl',
    control: 'rounded-[18px]',
    compactControl: 'rounded-2xl',
  },
  typography: {
    weight: {
      ui: 'font-light',
      body: 'font-light',
      data: 'font-light',
      tableHeader: 'font-light',
    },
    size: {
      overline: 'text-[10px]',
      caption: 'text-[11px]',
      body: 'text-xs',
      bodyLg: 'text-sm',
      title: 'text-xl',
    },
    tracking: {
      label: 'tracking-wide',
      overline: 'tracking-[0.18em]',
      denseOverline: 'tracking-[0.2em]',
    },
    leading: {
      tight: 'leading-none',
      snug: 'leading-snug',
      relaxed: 'leading-relaxed',
    },
  },
  spacing: {
    cellPadding: 'px-3 py-3',
    cellContentPadding: 'px-3 py-4',
    detailPanelPadding: 'px-5 py-4',
    nestedPanelPadding: 'px-4 py-3',
    attrRowGap: 'gap-3 py-2',
    rowGapTight: 'gap-2',
    rowGap: 'gap-3',
    rowGapLoose: 'gap-4',
    stackTight: 'space-y-1',
    stack: 'space-y-3',
    stackLoose: 'space-y-4',
  },
  material: {
    panelBase: 'rounded-[24px] border-0 backdrop-blur-[15px] backdrop-saturate-[104%]',
    glassColor: 'bambook-dashboard-glass-color',
    nestedSurface: 'bambook-nested-surface',
    cardDark: 'bambook-card-glass',
    cardLight: 'bambook-card-glass',
    compactCardDark: compactCardDarkRecipe,
    compactCardLight: compactCardLightRecipe,
    panelSurfaceDark: 'bambook-blue-white-surface bg-white/[0.02]',
    panelSurfaceLight: 'bambook-blue-white-surface bg-white/42',
  },
  spotlight: {
    panelDarkColor: 'rgb(var(--os-vnext-brand-blue-soft-rgb) / 0.06)',
    panelLightColor: 'rgb(var(--os-vnext-brand-blue-rgb) / 0.08)',
    panelDarkSize: 520,
    panelLightSize: 460,
    cardDarkColor: 'rgb(var(--os-vnext-brand-blue-rgb) / 0.05)',
    cardLightColor: 'rgb(var(--os-vnext-brand-blue-rgb) / 0.05)',
    cardDarkSize: 420,
    cardLightSize: 340,
    compactCardDarkColor: 'rgb(var(--os-vnext-brand-blue-rgb) / 0.04)',
    compactCardLightColor: 'rgb(var(--os-vnext-brand-blue-rgb) / 0.04)',
  },
  controls: {
    actionControl: {
      light: actionControlLightRecipe,
      dark: actionControlDarkRecipe,
      borderedLight: `border-transparent text-slate-500 ${actionControlLightRecipe}`,
      borderedDark: `border-transparent text-slate-400 ${actionControlDarkRecipe}`,
    },
    stateControl: {
      baseLight: stateControlBaseLightRecipe,
      baseDark: stateControlBaseDarkRecipe,
      interactionLight: stateControlInteractionLightRecipe,
      interactionDark: stateControlInteractionDarkRecipe,
    },
    selectedSurface: {
      light: selectedSurfaceLightRecipe,
      dark: selectedSurfaceDarkRecipe,
    },
    navigationRow: {
      base: 'min-h-16 rounded-2xl border px-4 py-3 text-left transition-[background,color,box-shadow,transform,border-color] duration-200',
      compact: 'h-12 rounded-2xl border px-4 text-left transition-[background,color,box-shadow,transform,border-color] duration-200',
      icon: 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center transition-colors',
      title: 'block text-sm font-light tracking-tight',
      desc: 'mt-1 block text-xs font-light leading-snug',
    },
    recessedField: {
      light: recessedFieldLightRecipe,
      dark: recessedFieldDarkRecipe,
    },
    toolbar: {
      base: toolbarBaseRecipe,
      content: toolbarContentRecipe,
      ambient: toolbarAmbientRecipe,
      surfaceLight: toolbarSurfaceLightRecipe,
      surfaceDark: toolbarSurfaceDarkRecipe,
      surfaceLightShadow: toolbarSurfaceLightShadowRecipe,
      surfaceDarkShadow: toolbarSurfaceDarkShadowRecipe,
      controlLight: toolbarControlBaseLightRecipe,
      controlDark: toolbarControlBaseDarkRecipe,
      controlIdleLight: stateControlInteractionLightRecipe,
      controlIdleDark: stateControlInteractionDarkRecipe,
      searchLight:
        'appearance-none bg-transparent border-transparent shadow-none text-slate-700 placeholder-slate-400 focus:bg-transparent focus:!border-transparent focus:shadow-none',
      searchDark:
        'relations-toolbar-search-dark appearance-none bg-transparent border-transparent shadow-none text-slate-200 placeholder-slate-500 focus:bg-transparent focus:!border-transparent focus:shadow-none',
      spotlightDarkSize: 300,
      spotlightLightSize: 240,
    },
    select: {
      toolbarDarkBase:
        '!bg-[rgba(6,14,24,0.20)] backdrop-blur-[15px] backdrop-saturate-[104%] !border-transparent shadow-none',
      toolbarLightBase:
        '!bg-[rgba(255,255,255,0.28)] backdrop-blur-[15px] backdrop-saturate-[104%] !border-transparent shadow-none',
      toolbarDarkSelected:
        '!bg-[rgba(7,18,32,0.30)] backdrop-blur-[15px] backdrop-saturate-[104%] !border-white/[0.08] text-slate-50 shadow-none',
      toolbarLightSelected:
        '!bg-[rgba(255,255,255,0.40)] backdrop-blur-[15px] backdrop-saturate-[104%] !border-slate-300/20 text-slate-800 shadow-none',
      toolbarDarkInline:
        'bg-transparent !border-transparent shadow-none text-slate-500 hover:bg-transparent hover:text-slate-300 active:bg-transparent',
      toolbarLightInline:
        'bg-transparent !border-transparent shadow-none text-slate-400 hover:bg-transparent hover:text-slate-600 active:bg-transparent',
      toolbarDarkInlineOpen: 'bg-transparent !border-transparent shadow-none text-slate-100',
      toolbarLightInlineOpen: 'bg-transparent !border-transparent shadow-none text-[var(--os-vnext-brand-blue)]',
      toolbarMenuDark: 'bambook-dashboard-glass-color bambook-blue-white-light',
      toolbarMenuLight: 'bambook-dashboard-glass-color bambook-blue-white-light',
      defaultMenuDark: 'bg-[#0d1b2a]/88 backdrop-blur-[15px] backdrop-saturate-[104%] border border-transparent',
      defaultMenuLight: 'bg-white/80 backdrop-blur-[15px] backdrop-saturate-[104%] border border-transparent',
      toolbarMenuSurfaceDark:
        'bg-transparent',
      toolbarMenuSurfaceLight:
        'bg-transparent',
      defaultOptionDark: 'hover:bg-white/[0.055] text-slate-300',
      defaultOptionLight: 'hover:bg-white/42 text-slate-700',
      defaultSelectedDark: 'bg-white/[0.065] backdrop-blur-[15px] backdrop-saturate-[104%] text-[var(--os-vnext-brand-blue-soft)]',
      defaultSelectedLight: 'bg-white/52 backdrop-blur-[15px] backdrop-saturate-[104%] text-[var(--os-vnext-brand-blue-strong)]',
      checkDefault: 'text-[var(--os-vnext-brand-blue)]',
      checkToolbarDark: 'text-slate-100',
      checkToolbarLight: 'text-slate-700',
    },
    overlayMenu: {
      surfaceBase:
        'isolate overflow-hidden rounded-2xl border-0 p-1 backdrop-blur-[15px] backdrop-saturate-[104%]',
      surfaceDark:
        'bambook-dashboard-glass-color text-slate-200',
      surfaceLight:
        'bambook-dashboard-glass-color text-slate-700',
      surfaceShadowDark:
        'shadow-none',
      surfaceShadowLight:
        'shadow-none',
      surfaceLayerDark:
        'bg-transparent',
      surfaceLayerLight:
        'bg-transparent',
      itemBase:
        'group/menuitem mx-0.5 h-9 w-[calc(100%-4px)] rounded-2xl px-3 py-0 text-left text-xs font-light transition-[background,color,border-color] duration-200',
      itemDark:
        'border border-transparent text-slate-400 hover:bg-white/[0.055] hover:text-slate-50 hover:shadow-none',
      itemLight:
        'border border-transparent text-slate-500 hover:bg-white/44 hover:text-[#0A2746] hover:shadow-none',
      itemSelectedDark:
        'border-transparent bg-white/[0.065] backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-50 shadow-none',
      itemSelectedLight:
        'border-transparent bg-white/52 backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-900 shadow-none',
      iconDark: 'text-slate-400 group-hover/menuitem:text-[var(--os-vnext-brand-blue-soft)]',
      iconLight: 'text-slate-500 group-hover/menuitem:text-[var(--os-vnext-brand-blue-strong)]',
      checkDark: 'text-[var(--os-vnext-brand-blue-soft)]',
      checkLight: 'text-[var(--os-vnext-brand-blue-strong)]',
    },
    table: {
      headerDark: 'border-white/[0.035] bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.018)]',
      headerLight: 'border-white/28 bg-white/14',
      rowHoverDark: 'hover:bg-white/[0.035]',
      rowHoverLight: 'hover:bg-white/28',
      cellBorderDark: 'border-white/[0.030]',
      cellBorderLight: 'border-white/24',
      rowSeparatorDark: 'bg-white/[0.045]',
      rowSeparatorLight: 'bg-white/45',
      cellMutedDark: 'border-white/[0.030] text-white/54',
      cellMutedLight: 'border-white/24 text-slate-600',
      editActionDark: 'bg-[rgba(13,27,42,0.28)] backdrop-blur-[15px] backdrop-saturate-[104%] text-white/42 hover:text-white hover:bg-white/[0.065]',
      editActionLight: 'bg-white/42 backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-500 hover:text-[var(--os-vnext-brand-blue-strong)] hover:bg-white/56',
      emptyActionDark: 'bg-[rgba(13,27,42,0.32)] backdrop-blur-[15px] backdrop-saturate-[104%] text-white/80 hover:bg-white/[0.075]',
      emptyActionLight:
        'bg-white/52 backdrop-blur-[15px] backdrop-saturate-[104%] border border-transparent text-slate-600 hover:bg-white/64',
    },
    floatingToolCluster: {
      surfaceDark:
        'bambook-dashboard-glass-color bg-[rgba(13,27,42,0.42)] border-white/[0.08]',
      surfaceLight: 'bambook-dashboard-glass-color bg-white/44 border-slate-200/50',
    },
    title: {
      iconButton: 'h-8 w-8 rounded-2xl border flex items-center justify-center shrink-0 cursor-pointer transition-colors',
      backButton: 'h-8 !w-7 rounded-2xl border flex items-center justify-center shrink-0 cursor-pointer transition-colors',
      actionButton:
        'h-9 px-4 rounded-full border flex items-center justify-center gap-2 shrink-0 transition-colors text-[11px] font-light tracking-wide',
      pageLabel: 'h-9 flex items-center max-w-[260px] truncate text-[11px] font-light tracking-wide leading-none',
      textButton: 'h-9 flex items-center shrink-0 bg-transparent border-0 p-0 rounded-none shadow-none transition-colors',
      breadcrumb: 'h-9 flex items-center gap-1.5 min-w-0 text-[11px] font-light tracking-wide',
      separator: 'h-9 w-5 flex items-center justify-center shrink-0',
      buttonDark: actionControlDarkRecipe,
      buttonLight: actionControlLightRecipe,
      viewSwitch: 'h-9 shrink-0 rounded-full border p-1 flex items-center gap-1',
      viewSwitchButton:
        'h-7 rounded-full px-3 text-[11px] font-light tracking-wide transition-[background,color] duration-200',
      spotlightDarkSize: 180,
      spotlightLightSize: 140,
    },
    formIconButton: {
      addDark:
        `border-transparent text-white/60 ${actionControlDarkRecipe}`,
      addLight:
        `border-transparent text-slate-500 ${actionControlLightRecipe}`,
      removeDark: `border-transparent text-white/48 ${actionControlDarkRecipe}`,
      removeLight: `border-transparent text-slate-500 ${actionControlLightRecipe}`,
      compactRemoveDark: `border-transparent text-white/48 ${actionControlDarkRecipe}`,
      compactRemoveLight: `border-transparent text-slate-500 ${actionControlLightRecipe}`,
      inlineDangerDark: 'backdrop-blur-[15px] backdrop-saturate-[104%] text-white/46 hover:text-white/66 hover:bg-white/[0.055]',
      inlineDangerLight: 'backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-400 hover:text-slate-600 hover:bg-white/46',
      quietActionDark: 'backdrop-blur-[15px] backdrop-saturate-[104%] text-white/62 hover:text-white/70 hover:bg-white/[0.065]',
      quietActionLight: 'backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-500 hover:text-slate-700 hover:bg-white/52',
    },
    orgChartMeta: {
      editDark: 'bg-[#0d1b2a]/42 backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-400 shadow-none',
      editLight: 'bg-white/48 backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-500 shadow-none',
      childrenBadgeDark: 'bg-[#0d1b2a]/42 backdrop-blur-[15px] backdrop-saturate-[104%] text-white/58 shadow-none',
      childrenBadgeLight: 'bg-white/50 backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-500 shadow-none',
    },
  },
  layout: {
    desktopMainMaxWidth: 0,
    desktopMainMaxWidthClass: 'max-w-none',
    desktopSidebarPanelTopInset: 16,
    desktopSidebarPanelBottomInset: 16,
    desktopTitleBarHeight: 56,
    desktopTitleToPanelGap: 0,
    desktopMainPanelTopInset: 56,
    desktopMainPanelBottomInset: 34,
    desktopTablePanelBottomInset: 40,
    desktopMainPanelBottomLift: 18,
    desktopSidebarShellClass: '!absolute !left-0 !top-0 !bottom-0 w-[232px] z-10 flex flex-col ![border-radius:0]',
    desktopPageCanvasClass: 'w-full h-full',
    desktopPageFrameClass: 'w-full h-full flex flex-col min-h-0 overflow-visible bg-transparent',
    desktopWorkspaceFrameClass: 'w-full h-full flex flex-col min-h-0 overflow-visible bg-transparent',
    desktopPageXClass: 'px-5',
    desktopPanelRowClass: 'flex-1 min-h-0 flex px-5 pt-0 bambook-main-panel-bottom-inset gap-4 overflow-visible',
    desktopBackstagePanelRowClass: 'flex-1 min-h-0 flex px-5 pt-0 bambook-main-panel-bottom-inset gap-4 overflow-visible w-full h-full',
    desktopSinglePanelBodyClass: 'flex-1 min-h-0 flex flex-col px-5 pt-0 bambook-main-panel-bottom-inset overflow-visible',
    desktopTitleTextClass: 'bambook-title-adaptive-ink text-[28px] font-light tracking-[-0.01em] leading-none',
    desktopTitleAccentClass: 'bambook-title-adaptive-ink-accent text-xl font-light tracking-tight leading-none',
    desktopTitleMetaClass: 'h-9 flex items-center gap-2 text-[10px] font-light tracking-wide',
    desktopSubtoolbarClass: 'h-12 shrink-0 flex items-center border-b pointer-events-auto',
    desktopMainPanelBottomEdgeClass: 'bambook-main-panel-bottom-edge',
    desktopTablePanelBottomEdgeClass: 'bambook-table-panel-bottom-edge',
    desktopTablePanelShellClass: 'flex-1 min-h-0 overflow-visible px-8 pt-8 pb-10',
    desktopTablePanelShellCompactClass: 'h-full overflow-visible px-8 pt-5 pb-10',
    desktopSplitNavPanelClass: 'w-52 md:w-56 shrink-0',
    desktopSiblingPanelNoBleedClass: 'bambook-sibling-panel-no-bleed',
    desktopSplitNavContentClass: 'relative z-10 flex h-full flex-col gap-1 p-2',
    desktopSplitMainPanelClass: 'flex-1 min-h-0',
    desktopSplitMainContentClass: 'relative z-10 flex h-full min-h-0 flex-col',
    desktopMainScrollViewportClass: 'h-full min-h-0 overflow-y-auto custom-scrollbar p-6 md:p-8',
    desktopSettingsContentStackClass: 'max-w-2xl space-y-8',
    desktopAccountSettingsContentStackClass: 'max-w-3xl space-y-8',
    desktopBackstageContentStackClass: 'max-w-3xl space-y-6',
    desktopToolbarRowClass: 'mb-4 flex h-9 min-h-9 items-center gap-2',
    desktopToolbarSearchSlotClass: 'min-w-0 flex-1',
    desktopToolbarActionSlotClass: 'shrink-0',
    desktopCardGridClass: 'grid gap-3',
    cardGridEdgeFadeTopOffset: 56,
    cardGridEdgeFadeTopHeight: 32,
    cardGridEdgeFadeBottomHeight: 48,
    desktopTwoColumnGridClass: 'grid grid-cols-2 gap-3',
    desktopDetailStackClass: 'space-y-3',
    desktopFormStackClass: 'space-y-4',
    desktopFormGridClass: 'grid grid-cols-2 gap-4',
    desktopTableViewportClass: 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
    panelShadowViewportClass: 'bambook-panel-shadow-viewport',
    desktopTitleBarClass: 'h-14 shrink-0 relative z-20 items-center justify-between gap-4 translate-y-[2px]',
    desktopTitleBarInsetClass: 'px-7',
    desktopTitleBarWithInsetClass: 'h-14 shrink-0 relative z-20 items-center justify-between gap-4 translate-y-[2px] px-7',
    desktopTitleSafeLeftStyle: {},
    uiLab2RootShellClass: 'relative h-screen min-h-screen w-full overflow-hidden',
    uiLab2MainStageClass: 'absolute inset-y-0 left-[232px] right-0 min-w-0 overflow-hidden',
    uiLab2SidebarContentClass: 'relative z-10 flex h-full min-h-0 flex-col',
    uiLab2CompiledMainContentClass: 'relative z-10 flex h-full min-h-0 flex-col',
    relationsDetailListWidth: 280,
    relationsDetailListShellClass: 'h-full min-h-0 shrink-0 p-4 pr-3 pb-0',
    relationsDetailListPanelClass: 'w-[280px] h-full flex flex-col bambook-sibling-panel-no-bleed',
    relationsDetailMainShellClass: 'flex-1 min-w-0 h-full min-h-0 p-4 pl-3 pb-0',
    relationsTableViewportClass: 'absolute -top-16 inset-x-0 pt-[80px] pb-0 overflow-visible',
    relationsTablePanelClass: 'flex h-full w-full flex-col overflow-hidden',
    relationsTablePanelContentClass: 'relative z-10 flex min-h-0 flex-1 flex-col',
    relationsTableHeaderTableClass: 'w-full shrink-0 table-fixed border-separate border-spacing-0 text-left text-xs',
    relationsTableHeaderCellClass: 'px-3 py-3 text-[10px] font-light tracking-[0.16em] whitespace-nowrap border-b',
    relationsTableBodyViewportClass: 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
    relationsTableBodyClass: 'w-full text-left text-xs',
    relationsTableColumnWidthClasses: ['w-[27%]', 'w-[22%]', 'w-[27%]', 'w-[17%]', 'w-[7%]'],
    relationsTableColumnTemplateClass: 'grid-cols-[27%_22%_27%_17%_7%]',
    relationsTableHeaders: ['组织', '主联系人', '地址', '履约', ''],
    relationsCardColumnWidth: 316,
    relationsCardColumnGap: 24,
    sidebarPanelInset: 0,
  },
  motion: {
    microDuration: 200,
    standardDuration: 260,
    layoutTransition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } as const,
  },
} as const;
