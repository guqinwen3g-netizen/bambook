// Material role registry. Visual values live in styles/os-vnext.css, while
// semantic recipes live in bambookOsTokens.ts.
//
// Flat material is the current product direction. Shadow roles remain as
// compatibility metadata until migrated surfaces no longer need legacy depth
// vocabulary.
export const OS_MATERIAL = {
  framePanel: 'os-material-frame-panel',
  raisedCard: 'os-material-raised-card',
  insetSurface: 'os-material-inset-surface',
  floatingOverlay: 'os-material-floating-overlay',
} as const;

export type OSMaterialRole = keyof typeof OS_MATERIAL;

export const OS_SHADOW = {
  frame: 'frame',
  sidebarShell: 'sidebar-shell',
  raised: 'raised',
  secondary: 'secondary',
  floating: 'floating',
  selected: 'selected',
  none: 'none',
} as const;

export type OSShadowRole = keyof typeof OS_SHADOW;

export type OSShadowMode = 'attached' | 'ghost' | 'none';
