export const UI_LAB_OS_SECTION_ID = 'bambook-os-replica-lab';
export const UI_LAB_CATEGORY_CARD_VARIANTS = ['Quiet glass', 'Soft edge', 'Dashboard fit'] as const;
export const UI_LAB_BUTTON_LAYER_IDS = ['base', 'whiteEdge', 'outerBlueRim', 'innerBlueRim', 'topHighlight', 'bottomShadow', 'hoverGlow'] as const;
export const UI_LAB_SETTINGS_LAYER_IDS = ['selectedFill', 'hoverFill', 'selectedRim', 'topHighlight', 'bottomShadow', 'pressDepth', 'iconGlow'] as const;
export const UI_LAB_SAVE_LAYER_IDS = ['glassBase', 'surfaceTint', 'whiteBorder', 'spotlight', 'hoverFill', 'hoverOuterRim', 'topHighlight', 'bottomShadow', 'pressDepth'] as const;
export const UI_LAB_INPUT_LAYER_IDS = ['fieldSurface', 'fieldBorder', 'idleInnerEdge', 'focusSurface', 'focusBlueRim', 'innerDepth'] as const;

export const UI_LAB_INTERACTION_PREVIEW_MODES = ['live', 'idle', 'hover', 'press', 'active'] as const;
export const UI_LAB_ACTION_PREVIEW_MODES = ['live', 'idle', 'hover', 'press'] as const;

export type ButtonLayerId = typeof UI_LAB_BUTTON_LAYER_IDS[number];
export type SettingsLayerId = typeof UI_LAB_SETTINGS_LAYER_IDS[number];
export type SaveLayerId = typeof UI_LAB_SAVE_LAYER_IDS[number];
export type InputLayerId = typeof UI_LAB_INPUT_LAYER_IDS[number];
export type LayerControlId = ButtonLayerId | SettingsLayerId | SaveLayerId | InputLayerId;
export type LayerInsetState<T extends string = LayerControlId> = Record<T, number>;

export const UI_LAB_SAVE_LAYER_DEFAULT_INSETS: LayerInsetState<SaveLayerId> = {
  glassBase: 0,
  surfaceTint: 0.5,
  whiteBorder: 0,
  spotlight: 0.5,
  hoverFill: 0.5,
  hoverOuterRim: 0,
  topHighlight: 0.5,
  bottomShadow: 0.5,
  pressDepth: 0,
};

export const UI_LAB_SAVE_LAYER_EXPORT_PREFIX = 'BAMBOOK_UI_LAB_SAVE_BUTTON_LAYERS_V1=';
