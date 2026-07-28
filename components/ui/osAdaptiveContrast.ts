export type OSAdaptiveContrastRole = 'primary' | 'secondary' | 'muted' | 'brand';

export type OSAdaptiveRGB = { r: number; g: number; b: number };
export type OSAdaptiveColorMode = 'light' | 'dark';

export const OS_ADAPTIVE_CONTRAST_ATTR = 'data-ui-lab-wallpaper-contrast';
export const OS_ADAPTIVE_CONTRAST_DEPTH_ATTR = 'data-os-adaptive-contrast-depth';
export const OS_ADAPTIVE_DASHBOARD_CARD_ATTR = 'data-os-dashboard-adaptive-card';
export const OS_ADAPTIVE_CONTRAST_REFRESH_EVENT = 'bambook:os-adaptive-contrast-refresh';

export const requestOsAdaptiveContrastRefresh = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OS_ADAPTIVE_CONTRAST_REFRESH_EVENT));
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent(OS_ADAPTIVE_CONTRAST_REFRESH_EVENT));
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(OS_ADAPTIVE_CONTRAST_REFRESH_EVENT));
    });
  });
};

requestOsAdaptiveContrastRefresh();

export const OS_ADAPTIVE_CONTRAST_COLORS = {
  inversionLightStart: 0.58,
  inversionLightEnd: 0.88,
  invertedLightInk: '#F4F8FC',
  invertedDarkInk: '#0A1A2D',
  minimumContrastRatio: {
    primary: 4.15,
    brand: 3.8,
    secondary: 3.65,
    muted: 3.25,
  },
} as const;

export const OS_ADAPTIVE_CONTRAST_SURFACE_SELECTOR = [
  '.os-material-frame-panel',
  '.os-material-raised-card',
  '.os-material-inset-surface',
  '.os-material-floating-overlay',
  '.bambook-outer-panel',
].join(',');

const OS_ADAPTIVE_CONTRAST_AUTO_SELECTOR = [
  '[data-os-adaptive-contrast-depth="wallpaper"]',
  '[data-os-adaptive-contrast-depth="one-layer"]',
  '.app-sidebar:not([data-sidebar-state="collapsed"]) button',
  '.app-sidebar:not([data-sidebar-state="collapsed"]) [data-sidebar-account-bar]',
  '.app-sidebar:not([data-sidebar-state="collapsed"]) [data-sidebar-account-menu-item]',
  '[data-os-lab-main] header :where(h1,h2,h3,button,span,svg)',
].join(',');

export const OS_ADAPTIVE_CONTRAST_TARGET_SELECTOR = [
  `[${OS_ADAPTIVE_CONTRAST_ATTR}]`,
  OS_ADAPTIVE_CONTRAST_AUTO_SELECTOR,
].join(',');

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export const blendOsAdaptiveRgb = (base: OSAdaptiveRGB, overlay: OSAdaptiveRGB, alpha: number): OSAdaptiveRGB => ({
  r: clampChannel(base.r * (1 - alpha) + overlay.r * alpha),
  g: clampChannel(base.g * (1 - alpha) + overlay.g * alpha),
  b: clampChannel(base.b * (1 - alpha) + overlay.b * alpha),
});

export const osAdaptiveRgbFromHex = (hex: string): OSAdaptiveRGB => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
});

export const osAdaptiveRelativeLuminance = ({ r, g, b }: OSAdaptiveRGB) => {
  const [rs, gs, bs] = [r, g, b].map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

export const osAdaptiveContrastRatio = (a: OSAdaptiveRGB, b: OSAdaptiveRGB) => {
  const l1 = osAdaptiveRelativeLuminance(a);
  const l2 = osAdaptiveRelativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

type OSAdaptiveOklab = { l: number; a: number; b: number };
type OSAdaptiveOklch = { l: number; c: number; h: number };

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

const srgbChannelToLinear = (channel: number) => {
  const value = clampUnit(channel / 255);
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
};

export const osAdaptiveRgbToOklab = ({ r, g, b }: OSAdaptiveRGB): OSAdaptiveOklab => {
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
};

const osAdaptiveOklabToOklch = ({ l, a, b }: OSAdaptiveOklab): OSAdaptiveOklch => ({
  l,
  c: Math.sqrt(a * a + b * b),
  h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360,
});

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const rgbToHex = ({ r, g, b }: OSAdaptiveRGB) =>
  `#${[r, g, b].map(channel => clampChannel(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const mixRgb = (a: OSAdaptiveRGB, b: OSAdaptiveRGB, amount: number): OSAdaptiveRGB => ({
  r: clampChannel(a.r + (b.r - a.r) * amount),
  g: clampChannel(a.g + (b.g - a.g) * amount),
  b: clampChannel(a.b + (b.b - a.b) * amount),
});

const chooseReadableEndpoint = (background: OSAdaptiveRGB, mode?: OSAdaptiveColorMode) => {
  const light = osAdaptiveRgbFromHex(OS_ADAPTIVE_CONTRAST_COLORS.invertedLightInk);
  const dark = osAdaptiveRgbFromHex(OS_ADAPTIVE_CONTRAST_COLORS.invertedDarkInk);
  if (mode === 'dark' && osAdaptiveContrastRatio(background, light) >= 2.35) return light;
  return osAdaptiveContrastRatio(background, light) >= osAdaptiveContrastRatio(background, dark)
    ? light
    : dark;
};

const pushInkToReadableContrast = (background: OSAdaptiveRGB, ink: OSAdaptiveRGB, minimumContrastRatio: number, mode?: OSAdaptiveColorMode) => {
  if (osAdaptiveContrastRatio(background, ink) >= minimumContrastRatio) return ink;

  const endpoint = chooseReadableEndpoint(background, mode);
  for (let step = 1; step <= 12; step += 1) {
    const adjusted = mixRgb(ink, endpoint, step / 12);
    if (osAdaptiveContrastRatio(background, adjusted) >= minimumContrastRatio) return adjusted;
  }

  return endpoint;
};

const applyRoleVibrancy = (background: OSAdaptiveRGB, ink: OSAdaptiveRGB, role: OSAdaptiveContrastRole, mode?: OSAdaptiveColorMode) => {
  const endpoint = chooseReadableEndpoint(background, mode);
  const backgroundBias = role === 'muted'
    ? 0.12
    : role === 'secondary'
      ? 0.06
      : 0;
  const brandBias = role === 'brand' ? 0.08 : 0;
  const toned = backgroundBias > 0 ? mixRgb(ink, background, backgroundBias) : ink;
  const branded = brandBias > 0 ? mixRgb(toned, { r: 74, g: 144, b: 226 }, brandBias) : toned;

  return osAdaptiveContrastRatio(background, branded) >= OS_ADAPTIVE_CONTRAST_COLORS.minimumContrastRatio[role]
    ? branded
    : mixRgb(branded, endpoint, role === 'muted' ? 0.44 : 0.28);
};

const chooseOsAdaptiveBaseInk = (background: OSAdaptiveRGB, role: OSAdaptiveContrastRole, mode?: OSAdaptiveColorMode) => {
  const bg = osAdaptiveOklabToOklch(osAdaptiveRgbToOklab(background));
  const lightInk = osAdaptiveRgbFromHex(OS_ADAPTIVE_CONTRAST_COLORS.invertedLightInk);
  const darkInk = osAdaptiveRgbFromHex(OS_ADAPTIVE_CONTRAST_COLORS.invertedDarkInk);
  const lightAmount = 1 - smoothstep(
    OS_ADAPTIVE_CONTRAST_COLORS.inversionLightStart,
    OS_ADAPTIVE_CONTRAST_COLORS.inversionLightEnd,
    bg.l,
  );
  const modeBiasedLightAmount = mode === 'dark'
    ? Math.max(lightAmount, role === 'primary' || role === 'brand' ? 0.90 : 0.82)
    : lightAmount;
  const continuousInk = mixRgb(darkInk, lightInk, modeBiasedLightAmount);
  const vibrantInk = applyRoleVibrancy(background, continuousInk, role, mode);
  return pushInkToReadableContrast(background, vibrantInk, OS_ADAPTIVE_CONTRAST_COLORS.minimumContrastRatio[role], mode);
};

export const chooseOsAdaptivePrimaryText = (background: OSAdaptiveRGB, mode?: OSAdaptiveColorMode) => {
  const readableInk = chooseOsAdaptiveBaseInk(background, 'primary', mode);

  return rgbToHex(readableInk);
};

export const chooseOsAdaptiveBrandText = (background: OSAdaptiveRGB, mode?: OSAdaptiveColorMode) => {
  return rgbToHex(chooseOsAdaptiveBaseInk(background, 'brand', mode));
};

export const chooseOsAdaptiveText = (background: OSAdaptiveRGB, role: OSAdaptiveContrastRole, mode?: OSAdaptiveColorMode) => {
  return rgbToHex(chooseOsAdaptiveBaseInk(background, role, mode));
};

export const chooseOsAdaptiveTextShadow = (background: OSAdaptiveRGB, inkHex: string) => {
  const ink = osAdaptiveRgbFromHex(inkHex);
  const inkIsLighter = osAdaptiveRelativeLuminance(ink) > osAdaptiveRelativeLuminance(background);
  return inkIsLighter
    ? '0 1px 2px rgba(0,0,0,0.28), 0 0 18px rgba(0,0,0,0.18)'
    : '0 1px 2px rgba(255,255,255,0.34), 0 0 18px rgba(255,255,255,0.18)';
};

export const chooseOsAdaptiveTitleShadow = (background: OSAdaptiveRGB, inkHex: string) => {
  const ink = osAdaptiveRgbFromHex(inkHex);
  const inkIsLighter = osAdaptiveRelativeLuminance(ink) > osAdaptiveRelativeLuminance(background);
  return inkIsLighter
    ? '0 1px 1px rgba(0,0,0,0.16), 0 0 10px rgba(255,255,255,0.10)'
    : '0 1px 1px rgba(255,255,255,0.22), 0 0 10px rgba(10,39,70,0.10)';
};

const hasExplicitOsAdaptiveRole = (target: HTMLElement) =>
  target.hasAttribute(OS_ADAPTIVE_CONTRAST_ATTR);

const getOsAdaptiveSurfaceDepth = (target: HTMLElement) => {
  let depth = 0;
  let current: HTMLElement | null = target;
  while (current) {
    if (current.matches?.(OS_ADAPTIVE_CONTRAST_SURFACE_SELECTOR)) depth += 1;
    current = current.parentElement;
  }
  return depth;
};

const hasColoredClass = (target: HTMLElement) => {
  const className = String(target.getAttribute('class') || '');
  if (/(?:^|\s)(?:text|fill|stroke)-\[#(?:0A2746|64748B|94A3B8)\]/i.test(className)) return false;
  return /(?:^|\s)(?:text|fill|stroke)-(?!(?:slate|white|black|gray|zinc|neutral)\b)(?:\[[^\]]+\]|\w+)/.test(className);
};

const isNeutralTextCandidate = (target: HTMLElement) => {
  const className = String(target.getAttribute('class') || '');
  return !className || /(?:text-(?:slate|white|black|gray|zinc|neutral)|text-\[#(?:0A2746|64748B|94A3B8)\]|hover:text-(?:slate|white|black|gray|zinc|neutral)|hover:text-\[#(?:0A2746|64748B|94A3B8)\])/.test(className);
};

export const shouldUseOsAdaptiveContrast = (target: HTMLElement) => {
  if (hasExplicitOsAdaptiveRole(target)) return true;
  if (target.closest('[data-os-adaptive-contrast="off"], [data-os-vnext-active="true"], [aria-selected="true"], [aria-pressed="true"], [data-state="active"], .os-material-inset-surface, .os-material-floating-overlay')) return false;
  if (getOsAdaptiveSurfaceDepth(target) > 1) return false;
  if (hasColoredClass(target)) return false;
  return isNeutralTextCandidate(target);
};

export const resolveOsAdaptiveContrastRole = (target: HTMLElement): OSAdaptiveContrastRole => {
  const explicitRole = target.getAttribute(OS_ADAPTIVE_CONTRAST_ATTR);
  if (explicitRole === 'brand' || explicitRole === 'muted' || explicitRole === 'secondary' || explicitRole === 'primary') return explicitRole;
  const className = String(target.getAttribute('class') || '');
  return /(?:text-\[(?:9|10|11)px\]|text-xs|opacity|text-slate-(?:4|5|6)|text-white\/[1-6])/.test(className)
    ? 'secondary'
    : 'primary';
};

// 复制自 UiLab 的常量
export const UI_LAB_APP_SCALE_POINTS = [
  { width: 1920, scale: 1.00 },
  { width: 2400, scale: 1.25 },
  { width: 2880, scale: 1.45 },
  { width: 3200, scale: 1.65 },
  { width: 3840, scale: 1.90 },
] as const;

export const UI_LAB_APP_HEIGHT_SCALE_POINTS = [
  { height: 900, scale: 1.00 },
  { height: 1080, scale: 1.25 },
  { height: 1200, scale: 1.45 },
  { height: 1440, scale: 1.65 },
  { height: 1600, scale: 1.90 },
] as const;

const UI_LAB_COLLAPSED_SIDEBAR_LIGHT_INK = 'rgba(248, 252, 255, 0.98)';
const UI_LAB_COLLAPSED_SIDEBAR_DARK_INK = 'rgba(10, 32, 58, 0.84)';
const UI_LAB_COLLAPSED_SIDEBAR_LIGHT_FILL = 'rgba(245, 250, 255, 0.12)';
const UI_LAB_COLLAPSED_SIDEBAR_DARK_FILL = 'rgba(24, 43, 69, 0.08)';
const UI_LAB_COLLAPSED_SIDEBAR_LIGHT_BORDER = 'rgba(245, 250, 255, 0.64)';
const UI_LAB_COLLAPSED_SIDEBAR_DARK_BORDER = 'rgba(24, 43, 69, 0.22)';

const WALLPAPER_BACKDROP_THUMB_LONG_EDGE = 256;

type WallpaperBackdropThumb = {
  data: Uint8ClampedArray;
  thumbWidth: number;
  thumbHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

const interpolateUiLabScale = <Point extends { scale: number }>(
  size: number,
  points: readonly Point[],
  dimension: keyof Omit<Point, 'scale'>,
): number => {
  const first = points[0];
  const firstSize = Number(first[dimension]);
  if (size <= firstSize) return first.scale;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const next = points[i];
    const previousSize = Number(previous[dimension]);
    const nextSize = Number(next[dimension]);
    if (size <= nextSize) {
      const progress = (size - previousSize) / (nextSize - previousSize);
      return previous.scale + ((next.scale - previous.scale) * progress);
    }
  }

  return points[points.length - 1].scale;
};

export const computeResponsiveUiLabScale = (width: number, height: number): number => {
  const widthScale = interpolateUiLabScale(width, UI_LAB_APP_SCALE_POINTS, 'width');
  const heightScale = interpolateUiLabScale(height, UI_LAB_APP_HEIGHT_SCALE_POINTS, 'height');
  return Math.min(widthScale, heightScale);
};

const sampleCoverImageAtViewportPoint = (
  image: HTMLImageElement,
  x: number,
  y: number,
): OSAdaptiveRGB | null => {
  if (!image.naturalWidth || !image.naturalHeight || typeof document === 'undefined') return null;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const scale = Math.max(viewportWidth / image.naturalWidth, viewportHeight / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  const offsetX = (viewportWidth - drawnWidth) / 2;
  const offsetY = (viewportHeight - drawnHeight) / 2;
  const sourceX = (x - offsetX) / scale;
  const sourceY = (y - offsetY) / scale;
  if (sourceX < 0 || sourceY < 0 || sourceX > image.naturalWidth || sourceY > image.naturalHeight) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, sourceX, sourceY, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
};

const wallpaperBackdropThumbCache = new WeakMap<HTMLImageElement, WallpaperBackdropThumb>();
let wallpaperBackdropThumbCanvas: HTMLCanvasElement | null = null;
let wallpaperBackdropThumbCtx: CanvasRenderingContext2D | null = null;

const buildWallpaperBackdropThumb = (image: HTMLImageElement): WallpaperBackdropThumb | null => {
  if (!image.naturalWidth || !image.naturalHeight || typeof document === 'undefined') return null;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  if (!viewportWidth || !viewportHeight) return null;
  const scale = WALLPAPER_BACKDROP_THUMB_LONG_EDGE / Math.max(viewportWidth, viewportHeight);
  const thumbWidth = Math.max(1, Math.round(viewportWidth * scale));
  const thumbHeight = Math.max(1, Math.round(viewportHeight * scale));

  const coverScale = Math.max(viewportWidth / image.naturalWidth, viewportHeight / image.naturalHeight);
  const drawnWidth = image.naturalWidth * coverScale;
  const drawnHeight = image.naturalHeight * coverScale;
  const offsetX = (viewportWidth - drawnWidth) / 2;
  const offsetY = (viewportHeight - drawnHeight) / 2;

  if (!wallpaperBackdropThumbCanvas) {
    wallpaperBackdropThumbCanvas = document.createElement('canvas');
    wallpaperBackdropThumbCtx = wallpaperBackdropThumbCanvas.getContext('2d', { willReadFrequently: true });
  }
  const canvas = wallpaperBackdropThumbCanvas;
  const ctx = wallpaperBackdropThumbCtx;
  if (!ctx) return null;
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  try {
    ctx.drawImage(
      image,
      0, 0, image.naturalWidth, image.naturalHeight,
      offsetX * scale, offsetY * scale, drawnWidth * scale, drawnHeight * scale,
    );
    const { data } = ctx.getImageData(0, 0, thumbWidth, thumbHeight);
    return { data, thumbWidth, thumbHeight, viewportWidth, viewportHeight };
  } catch {
    return null;
  }
};

const getWallpaperBackdropThumb = (image: HTMLImageElement): WallpaperBackdropThumb | null => {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const cached = wallpaperBackdropThumbCache.get(image);
  if (cached && cached.viewportWidth === viewportWidth && cached.viewportHeight === viewportHeight) {
    return cached;
  }
  const fresh = buildWallpaperBackdropThumb(image);
  if (fresh) wallpaperBackdropThumbCache.set(image, fresh);
  return fresh;
};

const sampleWallpaperBackdropAtPoint = (
  thumb: WallpaperBackdropThumb,
  x: number,
  y: number,
): OSAdaptiveRGB | null => {
  if (x < 0 || y < 0 || x > thumb.viewportWidth || y > thumb.viewportHeight) return null;
  const tx = Math.min(thumb.thumbWidth - 1, Math.max(0, Math.floor((x / thumb.viewportWidth) * thumb.thumbWidth)));
  const ty = Math.min(thumb.thumbHeight - 1, Math.max(0, Math.floor((y / thumb.viewportHeight) * thumb.thumbHeight)));
  const idx = (ty * thumb.thumbWidth + tx) * 4;
  return { r: thumb.data[idx], g: thumb.data[idx + 1], b: thumb.data[idx + 2] };
};

const SOLID_WALLPAPER_SAMPLES: Record<string, OSAdaptiveRGB> = {
  '/wallpapers/test-solid-black.svg': { r: 0, g: 0, b: 0 },
  '/wallpapers/test-solid-white.svg': { r: 255, g: 255, b: 255 },
  '/wallpapers/test-solid-brand-blue.svg': { r: 74, g: 144, b: 226 },
  '/wallpapers/solid-mist-blue.svg': { r: 169, g: 199, b: 232 },
  '/wallpapers/solid-lagoon.svg': { r: 124, g: 183, b: 199 },
  '/wallpapers/solid-dusk-violet.svg': { r: 142, g: 140, b: 200 },
  '/wallpapers/solid-graphite.svg': { r: 46, g: 58, b: 70 },
  '/wallpapers/solid-warm-gray.svg': { r: 184, g: 178, b: 168 },
  '/wallpapers/solid-sage.svg': { r: 156, g: 175, b: 158 },
  '/wallpapers/solid-midnight-blue.svg': { r: 15, g: 23, b: 42 },
  '/wallpapers/solid-burgundy.svg': { r: 106, g: 13, b: 34 },
  '/wallpapers/solid-forest-green.svg': { r: 20, g: 83, b: 45 },
  '/wallpapers/solid-sunset.svg': { r: 217, g: 119, b: 6 },
  '/wallpapers/solid-mint.svg': { r: 167, g: 243, b: 208 },
  '/wallpapers/solid-sakura-pink.svg': { r: 255, g: 228, b: 230 },
  '/wallpapers/solid-mustard.svg': { r: 224, g: 180, b: 64 },
};

const resolveSolidWallpaperSample = (wallpaperUrl?: string): OSAdaptiveRGB | null => {
  if (!wallpaperUrl) return null;
  try {
    const pathname = new URL(wallpaperUrl, window.location.href).pathname;
    return SOLID_WALLPAPER_SAMPLES[pathname] || null;
  } catch {
    return SOLID_WALLPAPER_SAMPLES[wallpaperUrl] || null;
  }
};

const parseCssColorLayers = (value: string): Array<{ color: OSAdaptiveRGB; alpha: number }> => {
  const layers: Array<{ color: OSAdaptiveRGB; alpha: number }> = [];
  const colorMatches = value.matchAll(/rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:(?:\s*,\s*|\s*\/\s*)([\d.]+%?))?\s*\)/gi);
  for (const match of colorMatches) {
    const rawAlpha = match[4] ?? '1';
    const alpha = rawAlpha.endsWith('%') ? Number.parseFloat(rawAlpha) / 100 : Number.parseFloat(rawAlpha);
    if (!Number.isFinite(alpha) || alpha <= 0) continue;
    layers.push({
      color: {
        r: Number.parseFloat(match[1]),
        g: Number.parseFloat(match[2]),
        b: Number.parseFloat(match[3]),
      },
      alpha: Math.min(1, alpha),
    });
  }
  return layers;
};

const compositeCssColorLayers = (base: OSAdaptiveRGB, layers: Array<{ color: OSAdaptiveRGB; alpha: number }>) => {
  if (!layers.length) return base;
  const mixed = layers.reduce(
    (acc, layer) => ({
      r: acc.r + layer.color.r * layer.alpha,
      g: acc.g + layer.color.g * layer.alpha,
      b: acc.b + layer.color.b * layer.alpha,
      alpha: acc.alpha + layer.alpha,
    }),
    { r: 0, g: 0, b: 0, alpha: 0 },
  );
  if (mixed.alpha <= 0) return base;
  const alpha = Math.min(0.88, mixed.alpha / layers.length);
  return blendOsAdaptiveRgb(
    base,
    { r: mixed.r / mixed.alpha, g: mixed.g / mixed.alpha, b: mixed.b / mixed.alpha },
    alpha,
  );
};

const compositeElementBackdrop = (base: OSAdaptiveRGB, element: Element, root: HTMLElement) => {
  let composited = base;
  const styles = [window.getComputedStyle(element), window.getComputedStyle(element, '::before'), window.getComputedStyle(element, '::after')];
  styles.forEach((style, index) => {
    const isRootElementStyle = element === root && index === 0;
    const rootHasSampledImage = isRootElementStyle && /url\(/i.test(style.backgroundImage);
    if (!rootHasSampledImage) {
      composited = compositeCssColorLayers(composited, parseCssColorLayers(style.backgroundColor));
    }
    composited = compositeCssColorLayers(composited, parseCssColorLayers(style.backgroundImage));
  });
  return composited;
};

const compositeTargetBackdrop = (root: HTMLElement, target: Element, base: OSAdaptiveRGB) => {
  const stack: Element[] = [];
  let current: Element | null = target;
  while (current && current !== root.parentElement) {
    stack.push(current);
    if (current === root) break;
    current = current.parentElement;
  }
  return stack.reverse().reduce((composited, element) => compositeElementBackdrop(composited, element, root), base);
};

export const applyCollapsedSidebarContrast = (root: HTMLElement, image: HTMLImageElement | null, isDarkMode: boolean, wallpaperUrl?: string) => {
  const fallback: OSAdaptiveRGB = isDarkMode ? { r: 10, g: 22, b: 40 } : { r: 241, g: 246, b: 250 };
  const adaptiveMode = isDarkMode ? 'dark' : 'light';
  const solidWallpaperSample = resolveSolidWallpaperSample(wallpaperUrl);
  const thumb = !solidWallpaperSample && image && image.naturalWidth ? getWallpaperBackdropThumb(image) : null;

  const WALLPAPER_SAMPLE_GRID_SIZE = 64;
  const wallpaperSampleGridCache = new Map<string, OSAdaptiveRGB>();
  const sampleBackdrop = (centerX: number, centerY: number) => {
    if (solidWallpaperSample) return solidWallpaperSample;
    if (!image) return fallback;
    const gridX = Math.floor(centerX / WALLPAPER_SAMPLE_GRID_SIZE);
    const gridY = Math.floor(centerY / WALLPAPER_SAMPLE_GRID_SIZE);
    const key = `${gridX}:${gridY}`;
    const cached = wallpaperSampleGridCache.get(key);
    if (cached) return cached;
    let sample: OSAdaptiveRGB | null = null;
    try {
      sample = thumb
        ? sampleWallpaperBackdropAtPoint(thumb, centerX, centerY)
        : sampleCoverImageAtViewportPoint(image, centerX, centerY);
    } catch {
      sample = null;
    }
    const resolved = sample ?? fallback;
    wallpaperSampleGridCache.set(key, resolved);
    return resolved;
  };
  const overlay = isDarkMode
    ? { color: { r: 0, g: 0, b: 0 }, alpha: 0.56 }
    : { color: { r: 255, g: 255, b: 255 }, alpha: 0.20 };

  const containers = root.querySelectorAll<HTMLElement>('[data-os-adaptive-container]');
  containers.forEach((container) => {
    const depthStr = container.getAttribute('data-os-adaptive-container') || '0';
    const depth = parseInt(depthStr, 10);
    
    if (depth >= 2) {
      container.style.removeProperty('--os-adaptive-title');
      container.style.removeProperty('--os-adaptive-subtitle');
      container.style.removeProperty('--os-adaptive-primary');
      container.style.removeProperty('--os-adaptive-brand');
      container.style.removeProperty('--os-adaptive-danger');
      container.style.removeProperty('--os-adaptive-text-shadow');
      container.style.removeProperty('--os-adaptive-title-shadow');
      return;
    }

    let rect = container.getBoundingClientRect();
    let width = rect.width;
    let height = rect.height;
    let left = rect.left;
    let top = rect.top;

    if (width === 0 || height === 0) {
      let parent = container.parentElement;
      while (parent && (width === 0 || height === 0)) {
        const pRect = parent.getBoundingClientRect();
        width = pRect.width;
        height = pRect.height;
        left = pRect.left;
        top = pRect.top;
        parent = parent.parentElement;
      }
      if (container.hasAttribute('data-sidebar-account-bar')) {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 900;
        left = 0;
        top = viewportHeight - 80;
        width = 270;
        height = 80;
      } else if (width === 0 || height === 0) {
        return;
      }
    }

    const centerX = left + width / 2;
    const centerY = top + height / 2;
    let sampled = fallback;
    try {
      sampled = sampleBackdrop(centerX, centerY);
    } catch {
      sampled = fallback;
    }
    
    const composited = compositeTargetBackdrop(root, container, blendOsAdaptiveRgb(sampled, overlay.color, overlay.alpha));
    const primaryInk = chooseOsAdaptiveText(composited, 'primary', adaptiveMode);
    const brandInk = chooseOsAdaptiveText(composited, 'brand', adaptiveMode);
    const useDarkInk = osAdaptiveRelativeLuminance(osAdaptiveRgbFromHex(primaryInk)) < osAdaptiveRelativeLuminance(composited);
    const secondaryInk = chooseOsAdaptiveText(composited, 'secondary', adaptiveMode);
    const subtitleInk = secondaryInk;
    const textShadow = chooseOsAdaptiveTextShadow(composited, primaryInk);
    const titleShadow = chooseOsAdaptiveTitleShadow(composited, primaryInk);
    
    if (useDarkInk) {
      container.style.setProperty('--os-adaptive-title', primaryInk);
      container.style.setProperty('--os-adaptive-subtitle', subtitleInk);
      container.style.setProperty('--os-adaptive-primary', primaryInk);
      container.style.setProperty('--os-adaptive-brand', brandInk);
      container.style.setProperty('--os-adaptive-danger', '#DC2626');
      container.style.setProperty('--os-adaptive-text-shadow', textShadow);
      container.style.setProperty('--os-adaptive-title-shadow', titleShadow);
    } else {
      container.style.setProperty('--os-adaptive-title', primaryInk);
      container.style.setProperty('--os-adaptive-subtitle', subtitleInk);
      container.style.setProperty('--os-adaptive-primary', primaryInk);
      container.style.setProperty('--os-adaptive-brand', brandInk);
      container.style.setProperty('--os-adaptive-danger', '#F87171');
      container.style.setProperty('--os-adaptive-text-shadow', textShadow);
      container.style.setProperty('--os-adaptive-title-shadow', titleShadow);
    }
  });

  const targets = root.querySelectorAll<HTMLElement>(`[data-sidebar-adaptive-icon], [data-sidebar-adaptive-avatar], ${OS_ADAPTIVE_CONTRAST_TARGET_SELECTOR}`);
  // 优化折叠侧边栏采样：只计算并平均这 5 个 button 实际占据位置的亮度，兼顾局部精准与整列视觉色彩的统一。
  const collapsedControls = Array.from(targets).filter(
    (target) =>
      (target.hasAttribute('data-sidebar-adaptive-icon') || target.hasAttribute('data-sidebar-adaptive-avatar')) &&
      !target.hasAttribute(OS_ADAPTIVE_CONTRAST_ATTR)
  );

  let useDarkInkForCollapsedSidebar = false;
  if (collapsedControls.length > 0) {
    let totalLuminance = 0;
    let validCount = 0;

    collapsedControls.forEach((target) => {
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      let sampled = fallback;
      try {
        sampled = sampleBackdrop(centerX, centerY);
      } catch {
        sampled = fallback;
      }
      const composited = compositeTargetBackdrop(root, target, blendOsAdaptiveRgb(sampled, overlay.color, overlay.alpha));
      totalLuminance += osAdaptiveRelativeLuminance(composited);
      validCount += 1;
    });

    const averageLuminance = validCount > 0 ? totalLuminance / validCount : 0.5;
    useDarkInkForCollapsedSidebar = averageLuminance >= 0.48;
  }

  targets.forEach((target) => {
    const unifiedCard = target.closest<HTMLElement>('[data-os-dashboard-adaptive-card]');
    const navViewport = target.hasAttribute('data-sidebar-nav-item')
      ? target.closest<HTMLElement>('[data-sidebar-nav-scroll]')
      : null;
    const sampleTarget = navViewport || unifiedCard || target;
    const rect = sampleTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let sampled = fallback;
    try {
      sampled = sampleBackdrop(centerX, centerY);
    } catch {
      sampled = fallback;
    }
    const composited = compositeTargetBackdrop(root, sampleTarget, blendOsAdaptiveRgb(sampled, overlay.color, overlay.alpha));
    
    // 自适应暗墨水判定的阈值：对于中偏深彩色背景如日落，0.42 容易误判为深色，
    // 将阈值上调到 0.48，使得在该背景下会被判定为浅色，从而采用白字/白图标。
    const useDarkInk = osAdaptiveRelativeLuminance(composited) >= 0.48;
    
    if (target.hasAttribute('data-sidebar-nav-item')) {
      target.style.removeProperty('--ui-lab-wallpaper-contrast-ink');
      target.style.removeProperty('--ui-lab-sidebar-nav-idle-ink');
      target.style.removeProperty('--ui-lab-sidebar-nav-idle-icon-ink');
      target.style.removeProperty('--ui-lab-wallpaper-contrast-shadow');
      target.style.removeProperty('--ui-lab-wallpaper-title-shadow');
      target.style.removeProperty('--ui-lab-sidebar-nav-active-ink');
      const navInk = chooseOsAdaptiveText(composited, 'primary', adaptiveMode);
      target.style.setProperty('--ui-lab-sidebar-nav-idle-ink', navInk);
      target.style.setProperty('--ui-lab-sidebar-nav-idle-icon-ink', navInk);
      target.style.setProperty('--ui-lab-sidebar-nav-active-ink', navInk);
      target.style.setProperty('--ui-lab-wallpaper-contrast-shadow', chooseOsAdaptiveTextShadow(composited, navInk));
      return;
    }
    const isCollapsedSidebarControl = target.hasAttribute('data-sidebar-adaptive-icon') || target.hasAttribute('data-sidebar-adaptive-avatar');
    if (isCollapsedSidebarControl && !target.hasAttribute(OS_ADAPTIVE_CONTRAST_ATTR)) {
      target.style.removeProperty('--ui-lab-wallpaper-contrast-ink');
      target.style.setProperty('--ui-lab-collapsed-sidebar-sampled-ink', useDarkInkForCollapsedSidebar ? UI_LAB_COLLAPSED_SIDEBAR_DARK_INK : UI_LAB_COLLAPSED_SIDEBAR_LIGHT_INK);
      target.style.setProperty('--ui-lab-collapsed-sidebar-sampled-fill', useDarkInkForCollapsedSidebar ? UI_LAB_COLLAPSED_SIDEBAR_DARK_FILL : UI_LAB_COLLAPSED_SIDEBAR_LIGHT_FILL);
      target.style.setProperty('--ui-lab-collapsed-sidebar-sampled-border', useDarkInkForCollapsedSidebar ? UI_LAB_COLLAPSED_SIDEBAR_DARK_BORDER : UI_LAB_COLLAPSED_SIDEBAR_LIGHT_BORDER);
      return;
    }
    if (target.hasAttribute(OS_ADAPTIVE_CONTRAST_ATTR) || shouldUseOsAdaptiveContrast(target)) {
      const adaptiveInk = chooseOsAdaptiveText(composited, resolveOsAdaptiveContrastRole(target), adaptiveMode);
      target.style.setProperty('--ui-lab-wallpaper-contrast-ink', adaptiveInk);
      target.style.setProperty('--ui-lab-wallpaper-contrast-shadow', chooseOsAdaptiveTextShadow(composited, adaptiveInk));
      target.style.setProperty('--ui-lab-wallpaper-title-shadow', chooseOsAdaptiveTitleShadow(composited, adaptiveInk));
      return;
    }
    target.style.removeProperty('--ui-lab-wallpaper-contrast-ink');
    target.style.removeProperty('--ui-lab-wallpaper-contrast-shadow');
    target.style.removeProperty('--ui-lab-wallpaper-title-shadow');
  });
};

export function createOsAdaptiveDebouncer(callback: () => void) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastRan = 0;

  return {
    schedule() {
      const now = Date.now();
      const timeSinceLastRan = now - lastRan;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (timeSinceLastRan >= 96) {
        lastRan = now;
        callback();
      } else {
        timeoutId = setTimeout(() => {
          lastRan = Date.now();
          callback();
        }, 96 - timeSinceLastRan);
      }
    },
    cancel() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
  };
}

export function isOsAdaptiveMutationRelevant(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      return true;
    }
    if (mutation.type === 'attributes') {
      const name = mutation.attributeName;
      if (!name) continue;
      if (
        name === 'data-ui-lab-wallpaper-contrast' ||
        name === 'data-os-adaptive-container' ||
        name === 'data-os-adaptive-contrast' ||
        name === 'class' ||
        name === 'style'
      ) {
        const target = mutation.target as any;
        if (target && typeof target.hasAttribute === 'function') {
          const hasContainer = target.hasAttribute('data-os-adaptive-container');
          const hasContrast = target.hasAttribute('data-os-adaptive-contrast');
          const hasWallpaper = target.hasAttribute('data-ui-lab-wallpaper-contrast');
          
          const closestContainer = typeof target.closest === 'function' && target.closest('[data-os-adaptive-container]');
          const closestContrast = typeof target.closest === 'function' && target.closest('[data-os-adaptive-contrast]');
          
          const queryContainer = typeof target.querySelector === 'function' && target.querySelector('[data-os-adaptive-container]');
          const queryContrast = typeof target.querySelector === 'function' && target.querySelector('[data-os-adaptive-contrast]');
          
          if (
            hasContainer ||
            hasContrast ||
            hasWallpaper ||
            closestContainer ||
            closestContrast ||
            queryContainer ||
            queryContrast
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}


