import React from 'react';
import { SpotlightCard, type SpotlightSizingMode } from './SpotlightCard';
import { BAMBOOK_OS } from './bambookOsTokens';
import { OS_MATERIAL, OS_SHADOW, type OSMaterialRole, type OSShadowMode, type OSShadowRole } from './osMaterial';

export const SIDE_PANEL_BASE_CLASS = BAMBOOK_OS.material.panelBase;
export const SIDE_PANEL_DARK_CLASS = BAMBOOK_OS.material.glassColor;
export const SIDE_PANEL_LIGHT_CLASS = BAMBOOK_OS.material.glassColor;
export const SIDE_PANEL_OUTER_CLASS = 'bambook-outer-panel';
export const SIDE_PANEL_SPOTLIGHT_DARK_COLOR = BAMBOOK_OS.spotlight.panelDarkColor;
export const SIDE_PANEL_SPOTLIGHT_LIGHT_COLOR = BAMBOOK_OS.spotlight.panelLightColor;
export const SIDE_PANEL_SPOTLIGHT_DARK_SIZE = BAMBOOK_OS.spotlight.panelDarkSize;
export const SIDE_PANEL_SPOTLIGHT_LIGHT_SIZE = BAMBOOK_OS.spotlight.panelLightSize;

type SidePanelElement = 'div' | 'section' | 'aside' | 'nav';

type SidePanelContainerProps = React.HTMLAttributes<HTMLElement> & {
  as?: SidePanelElement;
  isDarkMode: boolean;
  contentClassName?: string;
  /** Layout classes. Flat mode merges them into the material node to avoid caster/panel size deltas. */
  wrapperClassName?: string;
  spotlight?: boolean;
  spotlightSizing?: SpotlightSizingMode;
  spotlightColor?: string;
  spotlightSize?: number;
  edgeFadeItem?: boolean;
  materialRole?: OSMaterialRole;
  surfaceRole?: OSMaterialRole;
  shadowRole?: OSShadowRole;
  shadowMode?: OSShadowMode;
  materialTone?: 'panel' | 'nested';
};

const SidePanelContainer = React.forwardRef<HTMLElement, SidePanelContainerProps>(({
  as: Tag = 'div',
  isDarkMode,
  className = '',
  wrapperClassName = '',
  contentClassName = 'relative z-10',
  spotlight = false,
  spotlightSizing,
  spotlightColor,
  spotlightSize,
  edgeFadeItem = false,
  materialRole = 'framePanel',
  surfaceRole,
  shadowRole,
  shadowMode,
  materialTone = 'panel',
  children,
  ...props
}, ref) => {
  const resolvedSurfaceRole = surfaceRole ?? materialRole;
  const resolvedShadowRole: OSShadowRole = shadowRole === 'none' ? shadowRole : 'none';
  const resolvedShadowMode: OSShadowMode = shadowMode === 'none' ? shadowMode : 'none';
  const resolvedSpotlightSizing = spotlightSizing ?? (resolvedSurfaceRole === 'framePanel' ? 'frame' : 'auto');
  // SIDE_PANEL_DARK_CLASS 与 LIGHT 版已坍缩为同一自适应配方（BAMBOOK_OS.material.glassColor），单类承载双主题
  const materialToneClass = materialTone === 'nested'
    ? BAMBOOK_OS.material.nestedSurface
    : SIDE_PANEL_DARK_CLASS;
  const panelExtraClass = `${wrapperClassName} ${className}`.trim().replace(/\s+/g, ' ');
  const panelClassName = `${SIDE_PANEL_BASE_CLASS} ${materialToneClass} ${SIDE_PANEL_OUTER_CLASS} ${OS_MATERIAL[resolvedSurfaceRole]} ${panelExtraClass}`;
  const content = (
    <div className={contentClassName}>
      {children}
    </div>
  );

  const shadowProps = {
    'data-os-surface-role': resolvedSurfaceRole,
    'data-os-shadow-role': OS_SHADOW[resolvedShadowRole],
    'data-os-shadow-mode': resolvedShadowMode,
  };
  const maskProp = edgeFadeItem ? { 'data-glass-edge-mask': true } : {};

  const panel = spotlight ? (
    <SpotlightCard
      as={Tag}
      ref={ref}
      className={panelClassName}
      spotlightColor={spotlightColor ?? (isDarkMode ? SIDE_PANEL_SPOTLIGHT_DARK_COLOR : SIDE_PANEL_SPOTLIGHT_LIGHT_COLOR)}
      spotlightSize={spotlightSize ?? (isDarkMode ? SIDE_PANEL_SPOTLIGHT_DARK_SIZE : SIDE_PANEL_SPOTLIGHT_LIGHT_SIZE)}
      spotlightSizing={resolvedSpotlightSizing}
      idleSpotlightOpacity={0}
      liquidSpotlight
      liquidSpotlightTone="light"
      {...shadowProps}
      {...maskProp}
      {...props}
    >
      {content}
    </SpotlightCard>
  ) : (
    <Tag
      ref={ref as React.Ref<never>}
      className={panelClassName}
      {...shadowProps}
      {...maskProp}
      {...props}
    >
      {content}
    </Tag>
  );

  return panel;
});

SidePanelContainer.displayName = 'SidePanelContainer';

export default SidePanelContainer;
