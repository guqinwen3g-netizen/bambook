import React from 'react';
import { motion } from 'framer-motion';
import { BAMBOOK_OS } from '../bambookOsTokens';
import { OS_MATERIAL, OS_SHADOW } from '../osMaterial';
import SidePanelContainer, {
  SIDE_PANEL_BASE_CLASS,
  SIDE_PANEL_CLASS,
  SIDE_PANEL_OUTER_CLASS,
  SIDE_PANEL_SPOTLIGHT_DARK_COLOR,
  SIDE_PANEL_SPOTLIGHT_DARK_SIZE,
  SIDE_PANEL_SPOTLIGHT_LIGHT_COLOR,
  SIDE_PANEL_SPOTLIGHT_LIGHT_SIZE,
} from '../SidePanelContainer';
import ScrollEdgeFades from '../ScrollEdgeFades';
import BottomSheet from '../BottomSheet';
import ContactList from '../ContactList';
import CustomSelect from '../CustomSelect';
import DetailPanel from '../DetailPanel';
import ImageUploader from '../../ImageUploader';
import OrgChart from '../OrgChart';
import {
  COMPILED_DASHBOARD_CARD_SOURCE,
  CompiledDashboardCard,
  CompiledDetailShell,
  CompiledDropdownMenu,
  CompiledDropdownMenuItem,
  CompiledEdgeFade,
  CompiledInteractiveCard,
  CompiledMotionInteractiveCard,
  CompiledSurfacePanel,
  CompiledToolbar,
  useCompiledGlassSurfaceEdgeMasks,
} from './compiledSurfacePrimitives';
export {
  COMPILED_DASHBOARD_CARD_SOURCE,
  CompiledDashboardCard,
  CompiledDetailShell,
  CompiledDropdownMenu,
  CompiledDropdownMenuItem,
  CompiledEdgeFade,
  CompiledInteractiveCard,
  CompiledMotionInteractiveCard,
  CompiledSurfacePanel,
  CompiledToolbar,
  useCompiledGlassSurfaceEdgeMasks,
};
export type {
  CompiledDashboardCardProps,
  CompiledDetailShellProps,
  CompiledDropdownMenuItemProps,
  CompiledDropdownMenuProps,
  CompiledEdgeFadeProps,
  CompiledGlassSurfaceEdgeMaskOptions,
  CompiledInteractiveCardProps,
  CompiledSurfacePanelProps,
  CompiledToolbarProps,
  CompiledToolbarShadowMode,
} from './compiledSurfacePrimitives';
import type { OSCompilerPageBlueprint } from '../osCompiler/osCompiler';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type CompilerChildrenProps = {
  blueprint: OSCompilerPageBlueprint;
  children?: React.ReactNode;
  className?: string;
};

export const COMPILED_MODULE_TITLE_BAR_CLASS = BAMBOOK_OS.layout.desktopTitleBarWithInsetClass;
export const COMPILED_MODULE_TITLE_SAFE_LEFT_STYLE: React.CSSProperties = BAMBOOK_OS.layout.desktopTitleSafeLeftStyle;
export const COMPILED_MODULE_TITLE_NAV_GROUP_CLASS = 'flex h-full items-center gap-1.5 min-w-0';
export const COMPILED_MODULE_TITLE_TEXT_BUTTON_CLASS = 'h-9 flex items-center shrink-0 bg-transparent border-0 p-0 rounded-none shadow-none transition-colors';
export const COMPILED_MODULE_TITLE_PAGE_LABEL_CLASS = BAMBOOK_OS.controls.title.pageLabel;
export const COMPILED_MODULE_TITLE_SEPARATOR_CLASS = 'h-9 w-5 flex items-center justify-center shrink-0';
export const COMPILED_MODULE_TITLE_ICON_BUTTON_CLASS = BAMBOOK_OS.controls.title.iconButton;
export const COMPILED_MODULE_TITLE_ACTION_BUTTON_CLASS = BAMBOOK_OS.controls.title.actionButton;
export const COMPILED_MODULE_TITLE_BUTTON_CLASS = BAMBOOK_OS.controls.actionControl.base;

export const COMPILED_COLLECTION_CATEGORY_CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,316px)] justify-center gap-6 content-start';
export const COMPILED_COLLECTION_RECORD_CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,300px)] justify-center gap-6 content-start';

export const COMPILED_FORM_PANEL_CLASS = 'scroll-mt-28 p-5 bambook-relations-form-panel';
export const COMPILED_FORM_MAP_PANEL_CLASS = 'p-4 bambook-relations-form-map-panel';
export const COMPILED_FORM_PANEL_SPOTLIGHT_SIZING = 'width';
export const COMPILED_FORM_SECTION_TITLE_CLASS = 'text-[var(--text-primary)]';
export const COMPILED_FORM_NOTE_PANEL_CLASS = 'p-4 text-xs';
export const COMPILED_SIDE_PANEL_BASE_CLASS = SIDE_PANEL_BASE_CLASS;
export const COMPILED_SIDE_PANEL_CLASS = SIDE_PANEL_CLASS;
export const COMPILED_SIDE_PANEL_OUTER_CLASS = SIDE_PANEL_OUTER_CLASS;
export const COMPILED_SIDE_PANEL_SPOTLIGHT_DARK_COLOR = SIDE_PANEL_SPOTLIGHT_DARK_COLOR;
export const COMPILED_SIDE_PANEL_SPOTLIGHT_DARK_SIZE = SIDE_PANEL_SPOTLIGHT_DARK_SIZE;
export const COMPILED_SIDE_PANEL_SPOTLIGHT_LIGHT_COLOR = SIDE_PANEL_SPOTLIGHT_LIGHT_COLOR;
export const COMPILED_SIDE_PANEL_SPOTLIGHT_LIGHT_SIZE = SIDE_PANEL_SPOTLIGHT_LIGHT_SIZE;

export type CompiledModuleTitleBarProps = {
  template: string;
  source: string;
  baseClassName?: string;
  hidden?: boolean;
  style?: React.CSSProperties;
  leading?: React.ReactNode;
  center?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export const CompiledModuleTitleBar = ({
  template,
  source,
  baseClassName = COMPILED_MODULE_TITLE_BAR_CLASS,
  hidden = false,
  style,
  leading,
  center,
  actions,
  className,
}: CompiledModuleTitleBarProps) => (
  <div
    data-os-compiler-role="module-title-bar"
    data-os-compiler-template={template}
    data-os-compiler-source={source}
    data-os-adaptive-container="0"
    className={cx(baseClassName, hidden ? 'hidden' : 'flex', className)}
    style={style}
  >
    <div data-os-compiler-slot="title.leading" className="flex h-full min-w-0 items-center">
      {leading}
    </div>
    <div data-os-compiler-slot="title.center" className="mx-4 flex h-full min-w-0 flex-1 items-center justify-center">
      {center}
    </div>
    <div data-os-compiler-slot="title.actions" className="flex h-full shrink-0 items-center gap-2">
      {actions}
    </div>
  </div>
);

export type CompiledCollectionCardGridProps = {
  profile: 'category' | 'record';
  overlapTitleBar?: boolean;
  viewportClassName?: string;
  paddingClassName?: string;
  className?: string;
  children?: React.ReactNode;
  layout?: boolean;
  transition?: React.ComponentProps<typeof motion.div>['transition'];
};

export const CompiledCollectionCardGrid = React.forwardRef<HTMLDivElement, CompiledCollectionCardGridProps>(({
  profile,
  overlapTitleBar = false,
  viewportClassName,
  paddingClassName,
  className,
  children,
  layout = false,
  transition,
}, ref) => {
  const gridClass = profile === 'category'
    ? COMPILED_COLLECTION_CATEGORY_CARD_GRID_CLASS
    : COMPILED_COLLECTION_RECORD_CARD_GRID_CLASS;
  const defaultViewportClass = overlapTitleBar
    ? 'absolute -top-16 inset-x-0 bottom-0 overflow-y-scroll'
    : 'h-full overflow-y-scroll';
  const viewportClass = viewportClassName || defaultViewportClass;

  return (
    <motion.div
      ref={ref}
      layout={layout}
      transition={transition}
      data-os-compiler-role="collection-card-grid"
      data-os-compiler-profile={profile}
      data-os-compiler-source="CompiledCollectionCardGrid"
      className={cx(viewportClass, gridClass, BAMBOOK_OS.layout.panelShadowViewportClass, paddingClassName, className)}
    >
      {children}
    </motion.div>
  );
});

CompiledCollectionCardGrid.displayName = 'CompiledCollectionCardGrid';

export type CompiledTableShellProps = {
  isDarkMode?: boolean;
  shellRef?: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  header?: React.ReactNode;
  children?: React.ReactNode;
  empty?: React.ReactNode;
  useSidePanelContainer?: boolean;
  shellBaseClassName?: string;
  panelClassName?: string;
  panelContentClassName?: string;
  shellClassName?: string;
  scrollClassName?: string;
  edgeFade?: {
    topHeight: number;
    topFadeStartOffset: number;
    bottomHeight: number;
  };
};

export const CompiledTableShell = ({
  isDarkMode = false,
  shellRef,
  scrollRef,
  header,
  children,
  empty,
  useSidePanelContainer = false,
  shellBaseClassName = BAMBOOK_OS.layout.desktopTablePanelShellClass,
  panelClassName,
  panelContentClassName,
  shellClassName,
  scrollClassName,
  edgeFade,
}: CompiledTableShellProps) => {
  const content = (
    <>
      {header}
      {edgeFade && (
        <CompiledEdgeFade
          scrollRef={scrollRef}
          isDarkMode={isDarkMode}
          variant="normal"
          renderMode="content-mask"
          source="CompiledTableShell.edgeFade"
          topHeight={edgeFade.topHeight}
          topFadeStartOffset={edgeFade.topFadeStartOffset}
          bottomHeight={edgeFade.bottomHeight}
        />
      )}
      <div ref={scrollRef} className={cx('flex-1 min-h-0 overflow-y-auto', scrollClassName)}>
        {children}
      </div>
      {empty}
    </>
  );

  return (
    <div
      ref={shellRef}
      data-os-compiler-role="table-shell"
      data-os-compiler-source="CompiledTableShell"
      className={cx(shellBaseClassName, shellClassName)}
    >
      {useSidePanelContainer ? (
        <SidePanelContainer
          isDarkMode={isDarkMode}
          className={panelClassName}
          contentClassName={panelContentClassName}
        >
          {content}
        </SidePanelContainer>
      ) : (
        <div className={cx('flex h-full min-h-0 w-full flex-col overflow-hidden', panelClassName)}>
          {content}
        </div>
      )}
    </div>
  );
};

export type CompiledFormSectionPanelProps = {
  id: string;
  title: string;
  isDarkMode?: boolean;
  children?: React.ReactNode;
  contentBaseClassName?: string;
  contentClassName?: string;
  titleClassName?: string;
  materialRole?: 'framePanel' | 'raisedCard';
};

export const CompiledFormSectionPanel = ({
  id,
  title,
  isDarkMode = false,
  children,
  contentBaseClassName = 'grid grid-cols-1 md:grid-cols-2 gap-5',
  contentClassName,
  titleClassName,
  materialRole = 'framePanel',
}: CompiledFormSectionPanelProps) => (
  <SidePanelContainer
    as="section"
    id={id}
    isDarkMode={isDarkMode}
    materialRole={materialRole}
    edgeFadeItem
    spotlight
    spotlightSizing={COMPILED_FORM_PANEL_SPOTLIGHT_SIZING}
    wrapperClassName="scroll-mt-28"
    className="p-5 bambook-relations-form-panel"
    data-os-compiler-role="form-section-panel"
    data-os-compiler-source="CompiledFormSectionPanel"
  >
    <h4 className={cx('mb-4 text-xs font-light tracking-wide', COMPILED_FORM_SECTION_TITLE_CLASS, titleClassName)}>
      {title}
    </h4>
    <div className={cx(contentBaseClassName, contentClassName)}>
      {children}
    </div>
  </SidePanelContainer>
);

export type CompiledFormMapPanelProps = {
  isDarkMode?: boolean;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  materialRole?: 'framePanel' | 'raisedCard';
  source?: string;
};

export const CompiledFormMapPanel = ({
  isDarkMode = false,
  title = 'Form Map',
  children,
  className,
  titleClassName,
  materialRole = 'raisedCard',
  source = 'CompiledFormMapPanel',
}: CompiledFormMapPanelProps) => (
  <SidePanelContainer
    materialRole={materialRole}
    spotlight
    isDarkMode={isDarkMode}
    className={cx(COMPILED_FORM_MAP_PANEL_CLASS, className)}
    data-os-compiler-role="form-map-panel"
    data-os-compiler-source={source}
  >
    <p className={cx('px-3 pb-3 text-[10px] font-light tracking-[0.22em] uppercase', titleClassName)}>
      {title}
    </p>
    {children}
  </SidePanelContainer>
);

export type CompiledFormNotePanelProps = {
  isDarkMode?: boolean;
  children?: React.ReactNode;
  className?: string;
  materialRole?: 'framePanel' | 'raisedCard';
  source?: string;
};

export const CompiledFormNotePanel = ({
  isDarkMode = false,
  children,
  className,
  materialRole = 'raisedCard',
  source = 'CompiledFormNotePanel',
}: CompiledFormNotePanelProps) => (
  <SidePanelContainer
    materialRole={materialRole}
    edgeFadeItem
    isDarkMode={isDarkMode}
    className={cx(COMPILED_FORM_NOTE_PANEL_CLASS, 'text-[var(--text-tertiary)]', className)}
    data-os-compiler-role="form-note-panel"
    data-os-compiler-source={source}
  >
    {children}
  </SidePanelContainer>
);

export type CompiledSelectControlProps = React.ComponentProps<typeof CustomSelect> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledSelectControl = ({
  compilerRole = 'select-control',
  source = 'CompiledSelectControl',
  className,
  ...props
}: CompiledSelectControlProps) => (
  <div
    data-os-compiler-role={compilerRole}
    data-os-compiler-source={source}
    className={className}
  >
    <CustomSelect {...props} className="w-full" />
  </div>
);

export type CompiledBottomSheetProps = React.ComponentProps<typeof BottomSheet> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledBottomSheet = ({
  compilerRole = 'bottom-sheet',
  source = 'CompiledBottomSheet',
  ...props
}: CompiledBottomSheetProps) => (
  <>
    <span hidden data-os-compiler-role={compilerRole} data-os-compiler-source={source} />
    <BottomSheet {...props} />
  </>
);

export type CompiledImageUploaderProps = React.ComponentProps<typeof ImageUploader> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledImageUploader = ({
  compilerRole = 'image-uploader',
  source = 'CompiledImageUploader',
  ...props
}: CompiledImageUploaderProps) => (
  <div data-os-compiler-role={compilerRole} data-os-compiler-source={source}>
    <ImageUploader {...props} />
  </div>
);

export type CompiledContactListProps = React.ComponentProps<typeof ContactList> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledContactList = ({
  compilerRole = 'relation-contact-list',
  source = 'CompiledContactList',
  ...props
}: CompiledContactListProps) => (
  <div data-os-compiler-role={compilerRole} data-os-compiler-source={source} className="contents">
    <ContactList {...props} />
  </div>
);

export type CompiledRelationDetailPanelProps = React.ComponentProps<typeof DetailPanel> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledRelationDetailPanel = ({
  compilerRole = 'relation-detail-panel',
  source = 'CompiledRelationDetailPanel',
  ...props
}: CompiledRelationDetailPanelProps) => (
  <div data-os-compiler-role={compilerRole} data-os-compiler-source={source} className="contents">
    <DetailPanel {...props} />
  </div>
);

export type CompiledOrgChartProps = React.ComponentProps<typeof OrgChart> & {
  compilerRole?: string;
  source?: string;
};

export const CompiledOrgChart = ({
  compilerRole = 'relation-org-chart',
  source = 'CompiledOrgChart',
  ...props
}: CompiledOrgChartProps) => (
  <div data-os-compiler-role={compilerRole} data-os-compiler-source={source} className="contents">
    <OrgChart {...props} />
  </div>
);

export type CompiledPageProps = CompilerChildrenProps & {
  leading?: React.ReactNode;
  actions?: React.ReactNode;
};

export const CompiledPage = ({
  blueprint,
  leading,
  actions,
  children,
  className,
}: CompiledPageProps) => (
  <div
    data-os-compiler-page={blueprint.pageId}
    data-os-compiler-role="page"
    data-os-compiler-reference={blueprint.fidelity.referenceSurface}
    data-os-compiler-provenance-layout={blueprint.provenance.layout}
    className={cx(blueprint.layout.pageShell.className, className)}
  >
    <div
      data-os-compiler-role="title-bar"
      data-os-compiler-source={blueprint.layout.titleBar.source}
      className={cx(blueprint.layout.titleBar.className, 'flex')}
    >
      <div className="flex min-w-0 items-center gap-3">
        {leading && (
          <div data-os-compiler-slot="title.leading" className="shrink-0">
            {leading}
          </div>
        )}
        <div data-os-compiler-slot="title.identity" className={BAMBOOK_OS.controls.title.breadcrumb}>
          <span data-ui-lab-wallpaper-contrast="primary" className={BAMBOOK_OS.controls.title.textButton}>
            {blueprint.input.title.primary}
          </span>
          {blueprint.input.title.brand && (
            <span data-ui-lab-wallpaper-contrast="brand" className={cx(BAMBOOK_OS.controls.title.textButton, BAMBOOK_OS.tone.text.brandInline)}>
              {blueprint.input.title.brand}
            </span>
          )}
          {blueprint.input.title.child && (
            <>
              <span data-ui-lab-wallpaper-contrast="secondary" className={BAMBOOK_OS.controls.title.separator}>›</span>
              <span data-ui-lab-wallpaper-contrast="primary" className={BAMBOOK_OS.controls.title.pageLabel}>
                {blueprint.input.title.child}
              </span>
            </>
          )}
        </div>
      </div>
      <div data-os-compiler-slot="title.actions" className="flex shrink-0 items-center gap-2">
        {actions}
      </div>
    </div>
    {children}
  </div>
);

export type CompiledToolbarRowProps = CompilerChildrenProps & {
  search?: React.ReactNode;
  filters?: React.ReactNode;
  viewSwitch?: React.ReactNode;
  actions?: React.ReactNode;
};

export const CompiledToolbarRow = ({
  blueprint,
  search,
  filters,
  viewSwitch,
  actions,
  children,
  className,
}: CompiledToolbarRowProps) => (
  <div
    data-os-compiler-role="toolbar-row"
    data-os-compiler-source={blueprint.layout.toolbar.source}
    className={cx(blueprint.layout.toolbar.className, className)}
  >
    <div data-os-compiler-slot="toolbar.search" className={BAMBOOK_OS.layout.desktopToolbarSearchSlotClass}>
      {search}
    </div>
    <div data-os-compiler-slot="toolbar.filters" className="flex shrink-0 items-center gap-2">
      {filters}
    </div>
    <div data-os-compiler-slot="toolbar.viewSwitch" className="shrink-0">
      {viewSwitch}
    </div>
    <div data-os-compiler-slot="toolbar.actions" className={BAMBOOK_OS.layout.desktopToolbarActionSlotClass}>
      {actions}
    </div>
    {children}
  </div>
);

export const CompiledPageCanvas = ({ blueprint, children, className }: CompilerChildrenProps) => (
  <div
    data-os-compiler-role="page-canvas"
    data-os-compiler-source={blueprint.layout.canvas.source}
    className={cx(blueprint.layout.canvas.className, className)}
  >
    {children}
  </div>
);

export const CompiledPanelRow = ({ blueprint, children, className }: CompilerChildrenProps) => (
  <div
    data-os-compiler-role="panel-row"
    data-os-compiler-source={blueprint.layout.panelRow.source}
    className={cx(blueprint.layout.panelRow.className, className)}
  >
    {children}
  </div>
);

type CompiledPanelLevel = 1 | 2 | 3 | 4;

type CompiledPanelProps = CompilerChildrenProps & {
  level: CompiledPanelLevel;
  role: 'main' | 'section' | 'inset' | 'inline' | 'floating' | 'nav';
  isDarkMode?: boolean;
  edgeFadeItem?: boolean;
  contentClassName?: string;
  spotlight?: boolean;
};

const resolvePanelSurface = (blueprint: OSCompilerPageBlueprint, level: CompiledPanelLevel, role: CompiledPanelProps['role']) => {
  if (role === 'floating') return blueprint.material.floatingOverlay;
  if (role === 'inset') return blueprint.material.insetPanel;
  if (level === 1 || role === 'main' || role === 'nav') return blueprint.material.mainPanel;
  if (level === 2 || role === 'section') return blueprint.material.sectionPanel;
  if (level === 3 || role === 'inline') return blueprint.material.inlinePanel;
  return blueprint.material.inlinePanel;
};

export const CompiledPanel = ({
  blueprint,
  level,
  role,
  isDarkMode = false,
  edgeFadeItem = false,
  contentClassName,
  spotlight = false,
  children,
  className,
}: CompiledPanelProps) => {
  const surface = resolvePanelSurface(blueprint, level, role);
  const materialRole = surface.materialRole === 'tertiarySurface' || surface.materialRole === 'derivedOnly'
    ? 'insetSurface'
    : surface.materialRole;
  const materialTone = surface.materialTone === 'nested' ? 'nested' : 'panel';

  return (
    <SidePanelContainer
      isDarkMode={isDarkMode}
      materialRole={materialRole}
      materialTone={materialTone}
      shadowRole={surface.shadowRole}
      shadowMode={surface.shadowMode}
      edgeFadeItem={edgeFadeItem}
      contentClassName={contentClassName}
      spotlight={spotlight}
      data-os-compiler-role="panel"
      data-os-compiler-level={level}
      data-os-compiler-panel-role={role}
      data-os-compiler-source={surface.source}
      data-os-surface-role={materialRole}
      data-os-shadow-role={OS_SHADOW[surface.shadowRole]}
      data-os-shadow-mode={surface.shadowMode}
      className={cx(level === 3 && 'bambook-tertiary-surface', className)}
    >
      {children}
    </SidePanelContainer>
  );
};

export const CompiledScrollViewport = ({ blueprint, children, className }: CompilerChildrenProps) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const { edgeFade } = blueprint.layout.scrollViewport;

  useCompiledGlassSurfaceEdgeMasks({
    scrollRef,
    enabled: true,
    scopeSelector: null,
    topHeight: edgeFade.topHeight,
    topFadeStartOffset: edgeFade.topStartOffset,
    bottomHeight: edgeFade.bottomHeight,
    source: 'CompiledScrollViewport.edgeMasks',
  });

  return (
    <div
      ref={scrollRef}
      data-os-compiler-role="scroll-viewport"
      data-os-compiler-source={blueprint.layout.scrollViewport.source}
      data-os-compiler-edge-fade-source={edgeFade.source}
      className={cx(blueprint.layout.scrollViewport.className, className)}
    >
      {children}
    </div>
  );
};

export const CompiledSectionStack = ({ blueprint, children, className }: CompilerChildrenProps) => (
  <div
    data-os-compiler-role="section-stack"
    data-os-compiler-source={blueprint.layout.sectionStack.source}
    className={cx(blueprint.layout.sectionStack.className, className)}
  >
    {children}
  </div>
);

export const CompiledCardGrid = ({ blueprint, children, className }: CompilerChildrenProps) => (
  <div
    data-os-compiler-role="card-grid"
    data-os-compiler-source={blueprint.layout.content.source}
    className={cx(BAMBOOK_OS.layout.desktopCardGridClass, className)}
  >
    {children}
  </div>
);

export const CompiledTableViewport = ({ blueprint, children, className }: CompilerChildrenProps) => (
  <div
    data-os-compiler-role="table-viewport"
    data-os-compiler-source={blueprint.layout.content.source}
    className={cx(BAMBOOK_OS.layout.desktopTableViewportClass, className)}
  >
    {children}
  </div>
);

export const CompiledFormStack = ({ blueprint, children, className }: CompilerChildrenProps) => (
  <div
    data-os-compiler-role="form-stack"
    data-os-compiler-source={blueprint.layout.content.source}
    className={cx(BAMBOOK_OS.layout.desktopFormStackClass, className)}
  >
    {children}
  </div>
);

export const CompiledSplitWorkspace = ({
  blueprint,
  nav,
  main,
  children,
  className,
  source,
  baseClassName = BAMBOOK_OS.layout.desktopBackstagePanelRowClass,
}: {
  blueprint?: OSCompilerPageBlueprint;
  nav?: React.ReactNode;
  main?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  source?: string;
  baseClassName?: string;
}) => (
  <div
    data-os-compiler-role="split-workspace"
    data-os-compiler-source={source || blueprint?.layout.splitWorkspace.source || 'CompiledSplitWorkspace'}
    className={cx(baseClassName, className)}
  >
    {nav}
    {main}
    {children}
  </div>
);

export type CompiledSplitNavPanelProps = {
  isDarkMode?: boolean;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  source?: string;
  ariaLabel?: string;
  includeSiblingNoBleed?: boolean;
};

export const CompiledSplitNavPanel = ({
  isDarkMode = false,
  children,
  className,
  contentClassName,
  source = 'BAMBOOK_OS.layout.desktopSplitNavPanelClass',
  ariaLabel,
  includeSiblingNoBleed = true,
}: CompiledSplitNavPanelProps) => (
  <SidePanelContainer
    as="nav"
    isDarkMode={isDarkMode}
    spotlight
    materialRole="framePanel"
    shadowMode="none"
    wrapperClassName={BAMBOOK_OS.layout.desktopSplitNavPanelClass}
    className={cx(
      'h-full',
      includeSiblingNoBleed && BAMBOOK_OS.layout.desktopSiblingPanelNoBleedClass,
      className,
    )}
    contentClassName={cx(BAMBOOK_OS.layout.desktopSplitNavContentClass, contentClassName)}
    aria-label={ariaLabel}
    data-os-compiler-role="split-nav-panel"
    data-os-compiler-source={source}
  >
    {children}
  </SidePanelContainer>
);

export type CompiledSplitMainPanelProps = {
  isDarkMode?: boolean;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  source?: string;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  scrollViewportClassName?: string;
  edgeFadeVariant?: React.ComponentProps<typeof ScrollEdgeFades>['variant'];
  edgeFadeZIndex?: number;
  /** flat=true 时跳过 framePanel 圆角磨砂外壳，直接渲染滚动视口（用于无导航的扁平页面，如账号设置） */
  flat?: boolean;
};

export const CompiledSplitMainPanel = ({
  isDarkMode = false,
  children,
  className,
  contentClassName,
  source = 'BAMBOOK_OS.layout.desktopSplitMainPanelClass',
  scrollRef,
  scrollViewportClassName,
  edgeFadeVariant = 'subtle',
  edgeFadeZIndex = 12,
  flat = false,
}: CompiledSplitMainPanelProps) => {
  const inner = scrollRef ? (
    <>
      <CompiledEdgeFade scrollRef={scrollRef} isDarkMode={isDarkMode} variant={edgeFadeVariant} zIndex={edgeFadeZIndex} source="CompiledSplitMainPanel.edgeFade" />
      <div ref={scrollRef} className={cx(BAMBOOK_OS.layout.desktopMainScrollViewportClass, BAMBOOK_OS.layout.panelShadowViewportClass, scrollViewportClassName)}>
        {children}
      </div>
    </>
  ) : children;

  if (flat) {
    return (
      <div
        className={cx(BAMBOOK_OS.layout.desktopSplitMainPanelClass, 'flex flex-col', className)}
        data-os-compiler-role="split-main-panel"
        data-os-compiler-source={source}
      >
        {inner}
      </div>
    );
  }

  return (
    <SidePanelContainer
      isDarkMode={isDarkMode}
      spotlight
      materialRole="framePanel"
      shadowMode="none"
      wrapperClassName={BAMBOOK_OS.layout.desktopSplitMainPanelClass}
      className={className}
      contentClassName={cx(BAMBOOK_OS.layout.desktopSplitMainContentClass, contentClassName)}
      data-os-compiler-role="split-main-panel"
      data-os-compiler-source={source}
    >
      {inner}
    </SidePanelContainer>
  );
};

export const CompiledFloatingAction = ({
  blueprint,
  children,
  className,
}: CompilerChildrenProps) => (
  <div
    data-os-compiler-role="floating-action"
    data-os-compiler-source={blueprint.material.floatingOverlay.source}
    data-os-surface-role={OS_MATERIAL.floatingOverlay}
    data-os-shadow-role={OS_SHADOW.floating}
    data-os-shadow-mode="attached"
    className={cx('fixed bottom-8 right-8 z-[120] h-12 w-12', className)}
  >
    {children}
  </div>
);
