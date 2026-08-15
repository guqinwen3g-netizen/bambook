const toolbarBaseRecipe = 'group w-full min-w-0 h-9 !rounded-2xl border-0 backdrop-blur-[15px] backdrop-saturate-[104%]';
const toolbarContentRecipe = 'relative z-10 h-full w-full flex flex-nowrap items-center gap-3 px-3';
const toolbarAmbientRecipe = 'hidden';
const toolbarSurfaceRecipe =
  'glass-panel bambook-blue-white-surface bg-white/40 dark:bg-[#0a0f1d]/28';
const controlFrostRecipe =
  'backdrop-blur-[15px] backdrop-saturate-[104%] bg-[rgba(255,255,255,0.42)] dark:bg-[rgba(13,27,42,0.28)]';
const controlFrostHoverRecipe = 'hover:bg-[rgba(255,255,255,0.52)] dark:hover:bg-[rgba(255,255,255,0.065)]';
const controlFrostActiveRecipe = 'active:bg-[rgba(255,255,255,0.38)] dark:active:bg-[rgba(255,255,255,0.045)]';
// 单独的 shadow class——给 ghost shadow caster 节点使用，与 backdrop-filter 物理分离避免幽灵光。
const toolbarSurfaceShadowRecipe = 'shadow-none';
const compactCardRecipe = 'bambook-card-glass';
const stateControlBaseRecipe =
  `bambook-blue-white-light ${controlFrostRecipe} !border-transparent shadow-none`;
const toolbarControlBaseRecipe =
  `${controlFrostRecipe} !border-transparent shadow-none`;
const stateControlInteractionRecipe =
  `text-slate-500 dark:text-slate-400 ${controlFrostHoverRecipe} hover:text-[#0A2746] dark:hover:text-slate-50 hover:shadow-none ${controlFrostActiveRecipe} active:shadow-none`;
const actionControlRecipe =
  `${controlFrostRecipe} !border-transparent text-slate-500 dark:text-slate-400 shadow-none ${controlFrostHoverRecipe} hover:text-[#0A2746] dark:hover:text-slate-50 ${controlFrostActiveRecipe}`;
// 自适应选中面：视觉真源在 os-vnext.css `.bambook-selected-surface`（基类浅色 + .dark 翻转）。
const selectedSurfaceRecipe = 'bambook-selected-surface';
// 注意：flat-experimental.css 的护栏规则会对 class 同时含 "rounded" 与
// "shadow-"/"backdrop-blur"/"bg-white/"/"bg-slate"/"border-white/"/"border-slate" 等
// 子串的元素强制 border:0 !important。胶囊字段必须带可见描边，因此配方一律使用
// var()/rgba() 任意值类，禁止出现上述触发子串，也不带 shadow-none/backdrop-blur。
// P3 收编：字段材质对齐 BDS .bds-input 真源（--recessed-bg 族 + --border-c-* + --text-*），
// CSS 变量自适应主题，无需 dark: 变体。
// Tailwind v3 注意：border-[var(...)] 必须带 color: 类型提示，否则 var 无法推断为颜色而不生成规则。
const recessedFieldRecipe =
  'text-xs !bg-[var(--recessed-bg)] !bg-none border border-[color:var(--border-c-default)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:!bg-[var(--recessed-bg-hover)] focus:!bg-none focus:!border-[color:var(--border-c-strong)]';

/**
 * Bambook OS 配方token — 主题自适应单配方（P2 收口）。
 *
 * 纪律：所有 light/dark 双写配方已坍缩为单条自适应字符串——浅色为基，
 * 暗色用 Tailwind `dark:` 变体（.dark 根class，App.tsx 维护）或 CSS 侧
 * `.dark` 作用域翻转。调用点禁止再 `isDarkMode ? x.dark : x.light` 三元拼类；
 * JS 侧仅在 CSS 无法接管时保留分支（spotlight 尺寸/颜色等数值型 props）。
 */
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
      brandEmphasis: 'text-[var(--os-vnext-brand-blue-strong)] dark:text-[var(--os-vnext-brand-blue-soft)]',
      brandInline: 'text-[var(--os-vnext-brand-blue)]',
      // P3 收编：quiet/formLabel 对齐 BDS 文本真源（--text-secondary，.bds-formrow 标签同级）
      quiet: 'text-[var(--text-secondary)]',
      formLabel: 'text-[var(--text-secondary)]',
    },
    chip: {
      subtle: 'bg-slate-100 text-slate-500 dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.045)] dark:text-white/50',
      data: 'bg-slate-100 text-slate-600 dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.060)] dark:text-white/60',
      accent:
        'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.10)] text-[var(--os-vnext-brand-blue-strong)] dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.20)] dark:text-[var(--os-vnext-brand-blue)]',
      dropTarget:
        'bg-white/80 text-[var(--os-vnext-brand-blue-strong)] dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.14)] dark:text-[var(--os-vnext-brand-blue-soft)]',
      organizationTier:
        'bg-white/24 border border-[rgb(var(--os-vnext-brand-blue-rgb)/0.18)] text-[var(--os-vnext-brand-blue-strong)] shadow-none dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.045)] dark:border-transparent dark:text-[var(--os-vnext-brand-blue-soft)]',
    },
    surface: {
      // P3 收编：quietIcon/progressTrack 对齐 BDS 蚀刻面真源（--recessed-bg，.bds-progress track / .bds-stat-inset 同级）
      quietIcon: 'bg-[var(--recessed-bg)]',
      progressTrack: 'bg-[var(--recessed-bg)]',
      formMapIndex:
        'bg-white/34 border-white/32 text-slate-500 group-hover:text-[var(--os-vnext-brand-blue-strong)] group-hover:border-[rgb(var(--os-vnext-brand-blue-rgb)/0.18)] dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.045)] dark:border-white/[0.06] dark:text-white/58 dark:group-hover:text-white/80 dark:group-hover:border-white/10',
      formNestedRow: '',
      inlinePanel: 'bg-slate-50 text-slate-700 dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.030)] dark:text-white/70',
      linkedPanel: 'bg-white/55 border-white/60 shadow-none dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.030)] dark:border-white/[0.06]',
    },
    divider: {
      // P3 收编：分隔线对齐 BDS 真源（--border-c-subtle，.bds-divider 同级）
      panel: 'border-[var(--border-c-subtle)]',
      section: 'border-[var(--border-c-subtle)]',
    },
    status: {
      coordinate: {
        panel: 'bg-white/40 border border-transparent dark:bg-white/[0.035]',
        // P3 收编：icon 对齐 BDS --text-secondary
        icon: 'text-[var(--text-secondary)]',
        saved: 'bg-white/42 text-slate-500 border border-transparent font-normal dark:bg-white/[0.045] dark:text-white/58',
        city: 'bg-white/38 text-slate-500 border border-transparent font-normal dark:bg-white/[0.04] dark:text-white/54',
        postcode: 'bg-white/38 text-slate-500 border border-transparent font-normal dark:bg-white/[0.04] dark:text-white/54',
        fallback: 'bg-white/30 text-slate-400 border border-transparent font-normal dark:bg-white/[0.032] dark:text-white/42',
      },
      organizationCompletion: {
        // P3 收编：done 安静态对齐 BDS --text-tertiary
        done: 'text-[var(--text-tertiary)]',
        missing: 'text-[var(--os-vnext-brand-blue-strong)] dark:text-[var(--os-vnext-brand-blue-soft)]',
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
    card: compactCardRecipe,
    compactCard: compactCardRecipe,
    panelSurface: 'bambook-blue-white-surface bg-white/42 dark:bg-white/[0.02]',
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
      base: actionControlRecipe,
      bordered: `border-transparent ${actionControlRecipe}`,
    },
    stateControl: {
      base: stateControlBaseRecipe,
      interaction: stateControlInteractionRecipe,
    },
    selectedSurface: {
      base: selectedSurfaceRecipe,
    },
    navigationRow: {
      base: 'min-h-16 rounded-2xl border px-4 py-3 text-left transition-[background,color,box-shadow,transform,border-color] duration-200',
      compact: 'h-12 rounded-2xl border px-4 text-left transition-[background,color,box-shadow,transform,border-color] duration-200',
      icon: 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center transition-colors',
      title: 'block text-sm font-light tracking-tight',
      desc: 'mt-1 block text-xs font-light leading-snug',
    },
    // P3-2 收编：列表/导航行交互态单配方真源（BDS 纪律：hover 统一 --hover-darken /
    // active 用 --active-darken，见 components.css v2.1.1）。消除原 Sidebar.tsx
    // （recessed-bg 系）与 compiledSidebarTemplates 双真源、双写常量的配方分歧。
    listRow: {
      hover: 'hover:bg-[var(--hover-darken)] hover:shadow-none',
      press: 'active:scale-[0.98] active:bg-[var(--active-darken)]',
      idleIcon: '!text-[var(--text-tertiary)]',
    },
    recessedField: {
      base: recessedFieldRecipe,
    },
    toolbar: {
      base: toolbarBaseRecipe,
      content: toolbarContentRecipe,
      ambient: toolbarAmbientRecipe,
      surface: toolbarSurfaceRecipe,
      surfaceShadow: toolbarSurfaceShadowRecipe,
      control: toolbarControlBaseRecipe,
      controlIdle: stateControlInteractionRecipe,
      search:
        // P3 收编：文本/占位对齐 BDS --text-primary / --text-tertiary
        'appearance-none bg-transparent border-transparent shadow-none text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:bg-transparent focus:!border-transparent focus:shadow-none',
      spotlightDarkSize: 300,
      spotlightLightSize: 240,
    },
    select: {
      toolbarBase:
        '!bg-[rgba(255,255,255,0.28)] dark:!bg-[rgba(6,14,24,0.20)] backdrop-blur-[15px] backdrop-saturate-[104%] !border-transparent shadow-none',
      toolbarSelected:
        '!bg-[rgba(255,255,255,0.40)] dark:!bg-[rgba(7,18,32,0.30)] backdrop-blur-[15px] backdrop-saturate-[104%] !border-slate-300/20 dark:!border-white/[0.08] text-slate-800 dark:text-slate-50 shadow-none',
      toolbarInline:
        'bg-transparent !border-transparent shadow-none text-slate-400 dark:text-slate-500 hover:bg-transparent hover:text-slate-600 dark:hover:text-slate-300 active:bg-transparent',
      toolbarInlineOpen: 'bg-transparent !border-transparent shadow-none text-[var(--os-vnext-brand-blue)] dark:text-slate-100',
      toolbarMenu: 'bambook-dashboard-glass-color bambook-blue-white-light',
      defaultMenu: 'bg-white/80 dark:bg-[#0d1b2a]/88 backdrop-blur-[15px] backdrop-saturate-[104%] border border-transparent',
      toolbarMenuSurface: 'bg-transparent',
      defaultOption: 'hover:bg-white/42 dark:hover:bg-white/[0.055] text-slate-700 dark:text-slate-300',
      defaultSelected:
        'bg-white/52 dark:bg-white/[0.065] backdrop-blur-[15px] backdrop-saturate-[104%] text-[var(--os-vnext-brand-blue-strong)] dark:text-[var(--os-vnext-brand-blue-soft)]',
      checkDefault: 'text-[var(--os-vnext-brand-blue)]',
      checkToolbar: 'text-slate-700 dark:text-slate-100',
    },
    overlayMenu: {
      surfaceBase:
        'isolate overflow-hidden rounded-2xl border-0 p-1 backdrop-blur-[15px] backdrop-saturate-[104%]',
      surface: 'bambook-dashboard-glass-color text-slate-700 dark:text-slate-200',
      surfaceShadow: 'shadow-none',
      surfaceLayer: 'bg-transparent',
      itemBase:
        'group/menuitem mx-0.5 h-9 w-[calc(100%-4px)] rounded-2xl px-3 py-0 text-left text-xs font-light transition-[background,color,border-color] duration-200',
      item:
        'border border-transparent text-slate-500 dark:text-slate-400 hover:bg-white/44 dark:hover:bg-white/[0.055] hover:text-[#0A2746] dark:hover:text-slate-50 hover:shadow-none',
      itemSelected:
        'border-transparent bg-white/52 dark:bg-white/[0.065] backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-900 dark:text-slate-50 shadow-none',
      icon: 'text-slate-500 dark:text-slate-400 group-hover/menuitem:text-[var(--os-vnext-brand-blue-strong)] dark:group-hover/menuitem:text-[var(--os-vnext-brand-blue-soft)]',
      check: 'text-[var(--os-vnext-brand-blue-strong)] dark:text-[var(--os-vnext-brand-blue-soft)]',
    },
    table: {
      header: 'border-white/28 dark:border-white/[0.035] bg-white/14 dark:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.018)]',
      rowHover: 'hover:bg-white/28 dark:hover:bg-white/[0.035]',
      cellBorder: 'border-white/24 dark:border-white/[0.030]',
      rowSeparator: 'bg-white/45 dark:bg-white/[0.045]',
      cellMuted: 'border-white/24 dark:border-white/[0.030] text-[var(--text-secondary)]',
      editAction:
        'bg-white/42 dark:bg-[rgba(13,27,42,0.28)] backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-500 dark:text-white/42 hover:text-[var(--os-vnext-brand-blue-strong)] dark:hover:text-white hover:bg-white/56 dark:hover:bg-white/[0.065]',
      emptyAction:
        'bg-white/52 dark:bg-[rgba(13,27,42,0.32)] backdrop-blur-[15px] backdrop-saturate-[104%] border border-transparent text-slate-600 dark:text-white/80 hover:bg-white/64 dark:hover:bg-white/[0.075]',
    },
    floatingToolCluster: {
      surface:
        'bambook-dashboard-glass-color bg-white/44 dark:bg-[rgba(13,27,42,0.42)] border-slate-200/50 dark:border-white/[0.08]',
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
      button: actionControlRecipe,
      viewSwitch: 'h-9 shrink-0 rounded-full border p-1 flex items-center gap-1',
      viewSwitchButton:
        'h-7 rounded-full px-3 text-[11px] font-light tracking-wide transition-[background,color] duration-200',
      spotlightDarkSize: 180,
      spotlightLightSize: 140,
    },
    formIconButton: {
      add:
        `border-transparent text-slate-500 dark:text-white/60 ${controlFrostRecipe} !border-transparent shadow-none ${controlFrostHoverRecipe} hover:text-[#0A2746] dark:hover:text-slate-50 ${controlFrostActiveRecipe}`,
      remove:
        `border-transparent text-slate-500 dark:text-white/48 ${controlFrostRecipe} !border-transparent shadow-none ${controlFrostHoverRecipe} hover:text-[#0A2746] dark:hover:text-slate-50 ${controlFrostActiveRecipe}`,
      compactRemove:
        `border-transparent text-slate-500 dark:text-white/48 ${controlFrostRecipe} !border-transparent shadow-none ${controlFrostHoverRecipe} hover:text-[#0A2746] dark:hover:text-slate-50 ${controlFrostActiveRecipe}`,
      inlineDanger:
        'backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-400 dark:text-white/46 hover:text-slate-600 dark:hover:text-white/66 hover:bg-white/46 dark:hover:bg-white/[0.055]',
      quietAction:
        'backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-500 dark:text-white/62 hover:text-slate-700 dark:hover:text-white/70 hover:bg-white/52 dark:hover:bg-white/[0.065]',
    },
    orgChartMeta: {
      edit: 'bg-white/48 dark:bg-[#0d1b2a]/42 backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-500 dark:text-slate-400 shadow-none',
      childrenBadge: 'bg-white/50 dark:bg-[#0d1b2a]/42 backdrop-blur-[15px] backdrop-saturate-[104%] text-slate-500 dark:text-white/58 shadow-none',
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
