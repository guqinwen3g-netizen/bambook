export type WallpaperAccentRGB = { r: number; g: number; b: number };

// 提示：BUILTIN_WALLPAPER_ACCENT_SAMPLES 由
// scripts/generate-wallpaper-accent-samples.mjs 离线生成，
// 内置壁纸的颜色档案在编译期就已固化，运行时同步命中、零异步。
import { BUILTIN_WALLPAPER_ACCENT_SAMPLES } from './wallpaperAccentSamples.generated';

const BUILTIN_WALLPAPER_ACCENT_SAMPLE_OVERRIDES: Readonly<Record<string, WallpaperAccentRGB>> = {
  '/wallpapers/wallhaven-6lw5ll.jpg': { r: 72, g: 132, b: 214 },
};

export type WallpaperAccentPalette = {
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentRgb: string;
  accentStrongRgb: string;
  accentSoftRgb: string;
  globeAtmosphere: string;
  globeBorder: string;
  globeLand: string;
  globeLandRim: string;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const WALLPAPER_ACCENT_SAMPLE_CACHE_KEY = 'bambook_wallpaper_accent_sample_cache_v1';
const wallpaperAccentSampleCache = new Map<string, WallpaperAccentRGB>();
const wallpaperAccentSamplePromises = new Map<string, Promise<WallpaperAccentRGB | null>>();

const rgbToHsl = ({ r, g, b }: WallpaperAccentRGB): { h: number; s: number; l: number } => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0.58, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  if (max === gn) h = (bn - rn) / d + 2;
  if (max === bn) h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
};

const hslToRgb = (h: number, s: number, l: number): WallpaperAccentRGB => {
  const hueToRgb = (p: number, q: number, t: number) => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(clamp01(hueToRgb(p, q, h + 1 / 3)) * 255),
    g: Math.round(clamp01(hueToRgb(p, q, h)) * 255),
    b: Math.round(clamp01(hueToRgb(p, q, h - 1 / 3)) * 255),
  };
};

const rgbToHex = ({ r, g, b }: WallpaperAccentRGB): string => (
  `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
);

const rgbToTriplet = ({ r, g, b }: WallpaperAccentRGB): string => (
  `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`
);

const normalizeWallpaperUrlKey = (wallpaperUrl: string) => wallpaperUrl.trim();

// 内置壁纸都以 `/wallpapers/<file>` 路径发布；运行时可能被加上 BASE_URL
// 前缀或被服务端代理改写成 `/api/v1/system-assets/<id>/file`。这里只取
// 路径中的 `/wallpapers/...` 段作为静态档案的查表键。
const getBuiltinWallpaperSampleKey = (wallpaperUrl: string): string | null => {
  if (!wallpaperUrl) return null;
  const idx = wallpaperUrl.indexOf('/wallpapers/');
  if (idx === -1) return null;
  const tail = wallpaperUrl.slice(idx).split(/[?#]/)[0];
  return tail || null;
};

const getBuiltinWallpaperSample = (wallpaperUrl: string): WallpaperAccentRGB | null => {
  const key = getBuiltinWallpaperSampleKey(wallpaperUrl);
  return key ? (BUILTIN_WALLPAPER_ACCENT_SAMPLE_OVERRIDES[key] ?? BUILTIN_WALLPAPER_ACCENT_SAMPLES[key] ?? null) : null;
};

const isWallpaperAccentRGB = (value: unknown): value is WallpaperAccentRGB => {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<WallpaperAccentRGB>;
  return [sample.r, sample.g, sample.b].every(channel => typeof channel === 'number' && Number.isFinite(channel));
};

const readStoredWallpaperAccentSamples = (): Record<string, WallpaperAccentRGB> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WALLPAPER_ACCENT_SAMPLE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, WallpaperAccentRGB] => isWallpaperAccentRGB(entry[1]))
    );
  } catch {
    return {};
  }
};

const writeStoredWallpaperAccentSample = (wallpaperUrl: string, sample: WallpaperAccentRGB) => {
  if (typeof window === 'undefined') return;
  try {
    const stored = readStoredWallpaperAccentSamples();
    stored[wallpaperUrl] = sample;
    window.localStorage.setItem(WALLPAPER_ACCENT_SAMPLE_CACHE_KEY, JSON.stringify(stored));
  } catch {
    // Cache persistence is best-effort; the in-memory cache still covers the current session.
  }
};

const getCachedWallpaperAccentSample = (wallpaperUrl: string): WallpaperAccentRGB | null => {
  const key = normalizeWallpaperUrlKey(wallpaperUrl);
  if (!key) return null;
  // 1) 内置壁纸：编译期固化的颜色档案，永远同步命中、零异步。
  const builtinSample = getBuiltinWallpaperSample(key);
  if (builtinSample) return builtinSample;
  // 2) 自定义壁纸：本会话内存缓存。
  const memorySample = wallpaperAccentSampleCache.get(key);
  if (memorySample) return memorySample;
  // 3) 自定义壁纸：跨会话 localStorage 缓存（上传时写入，见 setWallpaperAccentSample）。
  const storedSample = readStoredWallpaperAccentSamples()[key];
  if (!storedSample) return null;
  wallpaperAccentSampleCache.set(key, storedSample);
  return storedSample;
};

/**
 * 给自定义壁纸登记一份颜色档案（同步），后续切换/重载都能瞬间命中。
 * 推荐时机：在 Settings 上传壁纸成功、拿到 DataURL 之后立即调用，
 * 这样接下来的 handleUpdate('backgroundImage', url) 会走纯同步路径。
 */
export const setWallpaperAccentSample = (wallpaperUrl: string, sample: WallpaperAccentRGB): void => {
  const key = normalizeWallpaperUrlKey(wallpaperUrl);
  if (!key) return;
  wallpaperAccentSampleCache.set(key, sample);
  writeStoredWallpaperAccentSample(key, sample);
};

export const defaultWallpaperAccentPalette = (isDarkMode: boolean): WallpaperAccentPalette => {
  const accent = isDarkMode ? { r: 127, g: 167, b: 232 } : { r: 111, g: 143, b: 184 };
  const strong = isDarkMode ? { r: 49, g: 90, b: 157 } : { r: 23, g: 59, b: 134 };
  const soft = isDarkMode ? { r: 143, g: 195, b: 193 } : { r: 199, g: 226, b: 223 };
  return {
    accent: rgbToHex(accent),
    accentStrong: rgbToHex(strong),
    accentSoft: rgbToHex(soft),
    accentRgb: rgbToTriplet(accent),
    accentStrongRgb: rgbToTriplet(strong),
    accentSoftRgb: rgbToTriplet(soft),
    globeAtmosphere: isDarkMode ? '#10233d' : '#dce8f1',
    globeBorder: isDarkMode ? '#8fc3c1' : '#173b86',
    globeLand: isDarkMode ? '#294465' : '#eef3f6',
    globeLandRim: isDarkMode ? '#6f96d2' : '#dce8f1',
  };
};

export const deriveWallpaperAccentPalette = (sample: WallpaperAccentRGB, isDarkMode: boolean): WallpaperAccentPalette => {
  const hsl = rgbToHsl(sample);
  const saturation = hsl.s < 0.08 ? 0.16 : Math.min(0.58, Math.max(0.24, hsl.s * 0.86));
  const accent = hslToRgb(hsl.h, saturation, isDarkMode ? 0.62 : 0.48);
  const strong = hslToRgb(hsl.h, Math.min(0.66, saturation * 1.08), isDarkMode ? 0.74 : 0.40);
  const soft = hslToRgb(hsl.h, Math.min(0.70, saturation * 1.12), isDarkMode ? 0.80 : 0.58);
  return {
    accent: rgbToHex(accent),
    accentStrong: rgbToHex(strong),
    accentSoft: rgbToHex(soft),
    accentRgb: rgbToTriplet(accent),
    accentStrongRgb: rgbToTriplet(strong),
    accentSoftRgb: rgbToTriplet(soft),
    globeAtmosphere: rgbToHex(hslToRgb(hsl.h, saturation * 0.42, isDarkMode ? 0.24 : 0.70)),
    globeBorder: rgbToHex(hslToRgb(hsl.h, saturation, isDarkMode ? 0.70 : 0.46)),
    globeLand: rgbToHex(hslToRgb(hsl.h, Math.min(0.62, saturation * 1.08), isDarkMode ? 0.58 : 0.42)),
    globeLandRim: rgbToHex(hslToRgb(hsl.h, Math.min(0.72, saturation * 1.18), isDarkMode ? 0.78 : 0.58)),
  };
};

export const getCachedWallpaperAccentPalette = (wallpaperUrl: string, isDarkMode: boolean): WallpaperAccentPalette | null => {
  const sample = getCachedWallpaperAccentSample(wallpaperUrl);
  return sample ? deriveWallpaperAccentPalette(sample, isDarkMode) : null;
};

export const applyWallpaperAccentPaletteToElement = (element: HTMLElement | null, palette: WallpaperAccentPalette) => {
  if (!element) return;
  element.style.setProperty('--os-vnext-brand-blue', palette.accent);
  element.style.setProperty('--os-vnext-brand-blue-strong', palette.accentStrong);
  element.style.setProperty('--os-vnext-brand-blue-soft', palette.accentSoft);
  element.style.setProperty('--os-vnext-brand-blue-rgb', palette.accentRgb);
  element.style.setProperty('--os-vnext-brand-blue-strong-rgb', palette.accentStrongRgb);
  element.style.setProperty('--os-vnext-brand-blue-soft-rgb', palette.accentSoftRgb);
};

const sampleWallpaperAverageColorUncached = (wallpaperUrl: string): Promise<WallpaperAccentRGB | null> => new Promise(resolve => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !wallpaperUrl) {
    resolve(null);
    return;
  }
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (!image.naturalWidth || !image.naturalHeight) {
      resolve(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 12;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
      count += 1;
    }
    resolve({ r: r / count, g: g / count, b: b / count });
  };
  image.onerror = () => resolve(null);
  image.src = wallpaperUrl;
});

export const sampleWallpaperAverageColor = (wallpaperUrl: string): Promise<WallpaperAccentRGB | null> => {
  const key = normalizeWallpaperUrlKey(wallpaperUrl);
  if (!key) return Promise.resolve(null);
  const cached = getCachedWallpaperAccentSample(key);
  if (cached) return Promise.resolve(cached);
  const pending = wallpaperAccentSamplePromises.get(key);
  if (pending) return pending;

  const next = sampleWallpaperAverageColorUncached(key).then(sample => {
    wallpaperAccentSamplePromises.delete(key);
    if (sample) {
      wallpaperAccentSampleCache.set(key, sample);
      writeStoredWallpaperAccentSample(key, sample);
    }
    return sample;
  });
  wallpaperAccentSamplePromises.set(key, next);
  return next;
};

export const resolveWallpaperAccentPalette = async (wallpaperUrl: string, isDarkMode: boolean): Promise<WallpaperAccentPalette> => {
  const sample = await sampleWallpaperAverageColor(wallpaperUrl);
  return sample ? deriveWallpaperAccentPalette(sample, isDarkMode) : defaultWallpaperAccentPalette(isDarkMode);
};

export const preloadWallpaperAccentPalettes = (wallpaperUrls: readonly string[]) => {
  if (typeof window === 'undefined') return;
  const uniqueUrls = Array.from(new Set(wallpaperUrls.map(normalizeWallpaperUrlKey).filter(Boolean)))
    // 已在内置静态档案 / 任一缓存层命中的 URL 无需再次异步采样。
    .filter(url => !getCachedWallpaperAccentSample(url));
  if (uniqueUrls.length === 0) return;
  const preload = () => {
    uniqueUrls.forEach(url => {
      void sampleWallpaperAverageColor(url);
    });
  };
  if ('requestIdleCallback' in window) {
    (window as Window).requestIdleCallback(preload, { timeout: 1200 });
    return;
  }
  (window as Window).setTimeout(preload, 0);
};
