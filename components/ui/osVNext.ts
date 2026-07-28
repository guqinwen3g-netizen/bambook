export const OS_VNEXT_ALLOWED_TOKEN_FILES = [
  'components/ui/osVNext.ts',
  'components/ui/OSPrimitives.tsx',
  'styles/os-vnext.css',
] as const;

export const OS_VNEXT_ROLES = [
  'shell',
  'panel',
  'card',
  'toolbar',
  'state-control',
  'action-control',
  'field',
  'table',
  'dialog',
  'scroll-frame',
] as const;

export type OsVNextRole = typeof OS_VNEXT_ROLES[number];

export const OS_VNEXT = {
  version: 'desktop-vnext-1',
  scope: 'desktop',
  roles: OS_VNEXT_ROLES,
  cssVars: {
    '--os-vnext-font-family':
      "'Urbanist', 'HarmonyOS Sans SC', 'Inter', 'Acherus Grotesque', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif",
    '--os-vnext-bg-light': '#DDE8F2',
    '--os-vnext-bg-dark': '#071321',
    '--os-vnext-brand-blue': 'var(--os-vnext-brand-blue)',
    '--os-vnext-brand-blue-strong': 'var(--os-vnext-brand-blue-strong)',
    '--os-vnext-brand-blue-soft': 'var(--os-vnext-brand-blue-soft)',
    '--os-vnext-surface-panel-light': 'rgba(240, 246, 255, 0.38)',
    '--os-vnext-surface-panel-dark': 'rgba(8, 16, 28, 0.30)',
    '--os-vnext-surface-card-light': 'rgba(255, 255, 255, 0.46)',
    '--os-vnext-surface-card-dark': 'rgba(13, 27, 42, 0.48)',
    '--os-vnext-border-light': 'rgba(255, 255, 255, 0.66)',
    '--os-vnext-border-dark': 'rgba(255, 255, 255, 0.10)',
    '--os-vnext-radius-panel': '28px',
    '--os-vnext-radius-card': '24px',
    '--os-vnext-radius-control': '18px',
    '--os-vnext-radius-field': '16px',
    '--os-vnext-space-1': '4px',
    '--os-vnext-space-2': '8px',
    '--os-vnext-space-3': '12px',
    '--os-vnext-space-4': '16px',
    '--os-vnext-space-5': '20px',
    '--os-vnext-space-6': '24px',
    '--os-vnext-control-height': '36px',
    '--os-vnext-toolbar-height': '44px',
    '--os-vnext-text-label': '10px',
    '--os-vnext-text-control': '12px',
    '--os-vnext-text-body': '13px',
    '--os-vnext-text-title': '18px',
    '--os-vnext-motion-fast': '180ms',
    '--os-vnext-motion-standard': '260ms',
    '--os-vnext-motion-layout': '360ms',
    '--os-vnext-ease-standard': 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
} as const;

export const OS_VNEXT_PRIMITIVE_RECIPES = {
  shell: 'os-vnext-shell',
  panel: 'os-vnext-panel',
  card: 'os-vnext-card',
  toolbar: 'os-vnext-toolbar',
  button: {
    action: 'os-vnext-button os-vnext-button--action',
    state: 'os-vnext-button os-vnext-button--state',
    danger: 'os-vnext-button os-vnext-button--danger',
  },
  field: 'os-vnext-field',
  table: 'os-vnext-table',
  dialog: 'os-vnext-dialog',
  scrollFrame: 'os-vnext-scroll-frame',
} as const;

export const OS_VNEXT_LAB_SPOTLIGHT = {
  toolbarDarkColor: 'rgb(var(--os-vnext-brand-blue-soft-rgb) / 0.15)',
  toolbarLightColor: 'rgba(96, 165, 250, 0.24)',
  toolbarDarkSize: 300,
  toolbarLightSize: 240,
  cardDarkColor: 'rgb(var(--os-vnext-brand-blue-soft-rgb) / 0.16)',
  cardLightColor: 'rgba(96, 165, 250, 0.16)',
  cardDarkSize: 360,
  cardLightSize: 320,
} as const;
