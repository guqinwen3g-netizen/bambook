import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SystemConfig, MODELS, type WallpaperOption } from '../types';
import { apiService } from '../services/apiService';
import { knowledgeApiService } from '../services/knowledgeApiService';
import { storageService, type DeviceStorageReport } from '../services/storageService';
import { getAuthState, changePassword, logout, hasPermission, updateMyProfile, login } from '../services/authService';
import { getDevOptions, setDevOption, subscribe as subscribeDevOptions, type DevOptions } from '../services/devOptionsService';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layout, BrainCircuit, Volume2,
  Monitor, Moon, Sun, DatabaseZap,
  Bot, Server, Cpu, Globe, User, ArrowRight, LogOut,
  HardDrive, RefreshCw, Trash2, Pencil, RotateCw, Image, Upload,
  KeyRound, Wrench
} from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';
import { requestOsAdaptiveContrastRefresh } from './ui/osAdaptiveContrast';
import UserAvatar from './ui/UserAvatar';
import { resolvePublicAssetUrl } from '../utils/publicAssets';
import { setWallpaperAccentSample } from '../utils/wallpaperAccent';
import {
  SIDEBAR_ACTIVE_CLASS,
  SIDEBAR_HOVER_CLASS,
  SIDEBAR_IDLE_ICON_CLASS,
  SIDEBAR_PRESS_CLASS,
} from './ui/sidebarConstants';
import {
  CompiledSplitMainPanel,
  CompiledSplitNavPanel,
  CompiledSplitWorkspace,
} from './ui/primitives/compiledPrimitives';

const ENABLE_WALLPAPER_SWITCHING = false;

export interface SettingsProps {
  mode?: 'account' | 'system';
  config: SystemConfig;
  onUpdateConfig: (c: SystemConfig) => void;
  onRefreshData?: () => Promise<void>;
  isDarkMode?: boolean;
}

type TabId = 'appearance' | 'ai' | 'voice' | 'sync' | 'storage' | 'account' | 'developer';
type AvatarCropDraft = {
  src: string;
  fileName: string;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
  rotation: number;
  offset: { x: number; y: number };
};

const AVATAR_CROP_PREVIEW_SIZE = 224;
const AVATAR_OUTPUT_SIZE = 256;

export const WALLPAPER_PRESETS: WallpaperOption[] = [
  { id: 'none', title: '经典渐变', group: '极简', url: '' },
  { id: 'scifi', title: '蓝羽流光', group: '极简', url: '/wallpapers/wallhaven-4dqgvj.jpg' },
  { id: 'wallhaven-e8ejjw', title: '蓝紫柔光', group: '极简', url: '/wallpapers/wallhaven-e8ejjw.jpg' },
  { id: 'cyber', title: '赛博光束', group: '极简', url: '/wallpapers/wallhaven-1kqvwg.jpg' },
  { id: 'aurora', title: '湖镜列车', group: '自然', url: '/wallpapers/wallhaven-yqxzqx.jpg' },
  { id: 'wallhaven-48pwv2', title: '雪浪成墙', group: '自然', url: '/wallpapers/wallhaven-48pwv2.jpg' },
  { id: 'wallhaven-6lw5ll', title: '雪峰流云', group: '自然', url: '/wallpapers/wallhaven-6lw5ll.jpg' },
  { id: 'wallhaven-mdmrly', title: '碧浪卷心', group: '自然', url: '/wallpapers/wallhaven-mdmrly.jpg' },
  { id: 'wallhaven-rqjrzq', title: '雾海灰潮', group: '自然', url: '/wallpapers/wallhaven-rqjrzq.jpg' },
  { id: 'wallhaven-966ev1', title: '沪上暮光', group: '城市', url: '/wallpapers/wallhaven-966ev1.jpg' },
  { id: 'image-5', title: '星落晚窗', group: '动漫', url: '/wallpapers/5.jpg' },
  { id: 'wallhaven-gw2zpq', title: '暮野孤影', group: '动漫', url: '/wallpapers/wallhaven-gw2zpq.jpg' },
  { id: 'test-solid-black', title: '纯黑', group: '纯色', url: '/wallpapers/test-solid-black.svg' },
  { id: 'test-solid-white', title: '纯白', group: '纯色', url: '/wallpapers/test-solid-white.svg' },
  { id: 'test-solid-brand-blue', title: '主题蓝', group: '纯色', url: '/wallpapers/test-solid-brand-blue.svg' },
  { id: 'solid-mist-blue', title: '雾蓝', group: '纯色', url: '/wallpapers/solid-mist-blue.svg' },
  { id: 'solid-lagoon', title: '湖青', group: '纯色', url: '/wallpapers/solid-lagoon.svg' },
  { id: 'solid-dusk-violet', title: '暮紫', group: '纯色', url: '/wallpapers/solid-dusk-violet.svg' },
  { id: 'solid-graphite', title: '石墨', group: '纯色', url: '/wallpapers/solid-graphite.svg' },
  { id: 'solid-warm-gray', title: '暖灰', group: '纯色', url: '/wallpapers/solid-warm-gray.svg' },
  { id: 'solid-sage', title: '鼠尾草', group: '纯色', url: '/wallpapers/solid-sage.svg' },
  { id: 'solid-midnight-blue', title: '午夜蓝', group: '纯色', url: '/wallpapers/solid-midnight-blue.svg' },
  { id: 'solid-burgundy', title: '勃艮第红', group: '纯色', url: '/wallpapers/solid-burgundy.svg' },
  { id: 'solid-forest-green', title: '森林绿', group: '纯色', url: '/wallpapers/solid-forest-green.svg' },
  { id: 'solid-sunset', title: '暖阳', group: '纯色', url: '/wallpapers/solid-sunset.svg' },
  { id: 'solid-mint', title: '薄荷绿', group: '纯色', url: '/wallpapers/solid-mint.svg' },
  { id: 'solid-sakura-pink', title: '樱花粉', group: '纯色', url: '/wallpapers/solid-sakura-pink.svg' },
  { id: 'solid-mustard', title: '芥末黄', group: '纯色', url: '/wallpapers/solid-mustard.svg' },
];

const PACKAGED_WALLPAPER_URL_BY_ID = WALLPAPER_PRESETS.reduce<Record<string, string>>((map, preset) => {
  map[preset.id] = preset.url;
  return map;
}, {});

const WALLPAPER_GROUP_ORDER = ['极简', '自然', '城市', '动漫', '纯色'];

const DEFAULT_WALLPAPER_PREVIEW_LIGHT_STYLE = {
  backgroundImage: [
    'radial-gradient(circle at 12% 8%, rgba(93,224,230,0.22), transparent 34%)',
    'radial-gradient(circle at 86% 92%, rgba(0,74,173,0.16), transparent 36%)',
    'radial-gradient(circle at 52% 48%, rgba(213,229,242,0.34), transparent 42%)',
    'linear-gradient(135deg, #DDE8F2 0%, #CFDEEC 48%, #BCCFE1 100%)',
  ].join(', '),
};

const DEFAULT_WALLPAPER_PREVIEW_DARK_STYLE = {
  backgroundImage: [
    'radial-gradient(circle at 7% 8%, rgba(64,92,126,0.17), transparent 44%)',
    'radial-gradient(circle at 94% 12%, rgba(73,112,130,0.10), transparent 42%)',
    'radial-gradient(circle at 90% 94%, rgba(92,112,132,0.12), transparent 46%)',
    'radial-gradient(circle at 8% 92%, rgba(52,72,100,0.12), transparent 48%)',
    'linear-gradient(135deg, #070D15 0%, #0B111B 46%, #050A11 100%)',
  ].join(', '),
};

const WALLPAPER_CURATED_TITLES: Record<string, string> = {
  '/wallpapers/wallhaven-yqxzqx.jpg': '湖镜列车',
  '/wallpapers/5.jpg': '星落晚窗',
  '/wallpapers/wallhaven-4dqgvj.jpg': '蓝羽流光',
  '/wallpapers/wallhaven-48pwv2.jpg': '雪浪成墙',
  '/wallpapers/wallhaven-1kqvwg.jpg': '赛博光束',
  '/wallpapers/wallhaven-6lw5ll.jpg': '雪峰流云',
  '/wallpapers/wallhaven-966ev1.jpg': '沪上暮光',
  '/wallpapers/wallhaven-e8ejjw.jpg': '蓝紫柔光',
  '/wallpapers/wallhaven-gw2zpq.jpg': '暮野孤影',
  '/wallpapers/wallhaven-mdmrly.jpg': '碧浪卷心',
  '/wallpapers/wallhaven-rqjrzq.jpg': '雾海灰潮',
  '/wallpapers/test-solid-black.svg': '纯黑',
  '/wallpapers/test-solid-white.svg': '纯白',
  '/wallpapers/test-solid-brand-blue.svg': '主题蓝',
  '/wallpapers/solid-mist-blue.svg': '雾蓝',
  '/wallpapers/solid-lagoon.svg': '湖青',
  '/wallpapers/solid-dusk-violet.svg': '暮紫',
  '/wallpapers/solid-graphite.svg': '石墨',
  '/wallpapers/solid-warm-gray.svg': '暖灰',
  '/wallpapers/solid-sage.svg': '鼠尾草',
  '/wallpapers/solid-midnight-blue.svg': '午夜蓝',
  '/wallpapers/solid-burgundy.svg': '勃艮第红',
  '/wallpapers/solid-forest-green.svg': '森林绿',
  '/wallpapers/solid-sunset.svg': '暖阳',
  '/wallpapers/solid-mint.svg': '薄荷绿',
  '/wallpapers/solid-sakura-pink.svg': '樱花粉',
  '/wallpapers/solid-mustard.svg': '芥末黄',
};

const WALLPAPER_CURATED_GROUPS: Record<string, string> = {
  '': '极简',
  '/wallpapers/wallhaven-yqxzqx.jpg': '自然',
  '/wallpapers/5.jpg': '动漫',
  '/wallpapers/wallhaven-4dqgvj.jpg': '极简',
  '/wallpapers/wallhaven-48pwv2.jpg': '自然',
  '/wallpapers/wallhaven-1kqvwg.jpg': '极简',
  '/wallpapers/wallhaven-4982k0.jpg': '极简',
  '/wallpapers/wallhaven-6lw5ll.jpg': '自然',
  '/wallpapers/wallhaven-966ev1.jpg': '城市',
  '/wallpapers/wallhaven-e8ejjw.jpg': '极简',
  '/wallpapers/wallhaven-gw2zpq.jpg': '动漫',
  '/wallpapers/wallhaven-mdmrly.jpg': '自然',
  '/wallpapers/wallhaven-rqjrzq.jpg': '自然',
  '/wallpapers/test-solid-black.svg': '纯色',
  '/wallpapers/test-solid-white.svg': '纯色',
  '/wallpapers/test-solid-brand-blue.svg': '纯色',
  '/wallpapers/solid-mist-blue.svg': '纯色',
  '/wallpapers/solid-lagoon.svg': '纯色',
  '/wallpapers/solid-dusk-violet.svg': '纯色',
  '/wallpapers/solid-graphite.svg': '纯色',
  '/wallpapers/solid-warm-gray.svg': '纯色',
  '/wallpapers/solid-sage.svg': '纯色',
  '/wallpapers/solid-midnight-blue.svg': '纯色',
  '/wallpapers/solid-burgundy.svg': '纯色',
  '/wallpapers/solid-forest-green.svg': '纯色',
  '/wallpapers/solid-sunset.svg': '纯色',
  '/wallpapers/solid-mint.svg': '纯色',
  '/wallpapers/solid-sakura-pink.svg': '纯色',
  '/wallpapers/solid-mustard.svg': '纯色',
};

const shouldUseCuratedWallpaperTitle = (option: WallpaperOption) => {
  const title = (option.title || '').trim();
  if (title === '科幻母舰') return true;
  if (/^wallhaven-[\w-]+(?:\.(?:jpe?g|png|webp))?$/i.test(title)) return true;
  return title === (option.url || '').split('/').pop();
};

const shouldUseCuratedWallpaperGroup = (option: WallpaperOption) => {
  const group = (option.group || '').trim();
  return !group || group === '默认' || group === '未分组' || group === '科幻';
};

const getWallpaperGroupRank = (group: string) => {
  const index = WALLPAPER_GROUP_ORDER.indexOf(group);
  return index === -1 ? WALLPAPER_GROUP_ORDER.length : index;
};

const getPackagedWallpaperUrl = (option: WallpaperOption) => {
  const id = option.assetId || option.id;
  if (id && PACKAGED_WALLPAPER_URL_BY_ID[id] !== undefined) return PACKAGED_WALLPAPER_URL_BY_ID[id];
  const match = option.url.match(/\/api\/v1\/system-assets\/([^/]+)\/file/);
  return match ? PACKAGED_WALLPAPER_URL_BY_ID[decodeURIComponent(match[1])] : undefined;
};

const normalizeWallpaperOptions = (options?: WallpaperOption[]): WallpaperOption[] => {
  if (!Array.isArray(options) || options.length === 0) return WALLPAPER_PRESETS;
  const normalizedOptions = options
    .map((option, index) => {
      const packagedUrl = getPackagedWallpaperUrl(option);
      const url = packagedUrl ?? option.url ?? '';
      return {
        id: option.id || option.assetId || `wallpaper-${index}`,
        title: shouldUseCuratedWallpaperTitle({ ...option, url })
          ? WALLPAPER_CURATED_TITLES[url] || option.title
          : option.title || WALLPAPER_CURATED_TITLES[url] || url.split('/').pop() || '未命名壁纸',
        url,
        group: shouldUseCuratedWallpaperGroup(option)
          ? WALLPAPER_CURATED_GROUPS[url || ''] || option.group?.trim() || '未分组'
          : option.group.trim(),
        hidden: Boolean(option.hidden),
        sortOrder: option.sortOrder,
      };
    })
    .filter(option => option.url === '' || WALLPAPER_PRESETS.some(preset => preset.url === option.url));
  const existingUrls = new Set(normalizedOptions.map(option => option.url));
  const missingPackagedOptions = WALLPAPER_PRESETS.filter(preset => !existingUrls.has(preset.url));
  return [...normalizedOptions, ...missingPackagedOptions];
};

const compressWallpaper = (file: File): Promise<{ dataUrl: string; sample: { r: number; g: number; b: number } | null }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取壁纸失败'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('解析图片失败'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: String(reader.result || ''), sample: null });
          return;
        }
        const MAX_LIMIT = 1920;
        let w = img.width;
        let h = img.height;
        if (w > MAX_LIMIT || h > MAX_LIMIT) {
          if (w > h) {
            h = Math.round((h * MAX_LIMIT) / w);
            w = MAX_LIMIT;
          } else {
            w = Math.round((w * MAX_LIMIT) / h);
            h = MAX_LIMIT;
          }
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.8);

        // 复用 canvas 上的已解码像素，顺手算 12×12 平均色作为颜色档案，
        // 与 wallpaperAccent.sampleWallpaperAverageColorUncached 完全一致。
        let sample: { r: number; g: number; b: number } | null = null;
        try {
          const sampleCanvas = document.createElement('canvas');
          sampleCanvas.width = 12;
          sampleCanvas.height = 12;
          const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
          if (sampleCtx) {
            sampleCtx.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
            const pixels = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              r += pixels[i];
              g += pixels[i + 1];
              b += pixels[i + 2];
              count += 1;
            }
            if (count) sample = { r: r / count, g: g / count, b: b / count };
          }
        } catch {
          // 采样失败不影响壁纸本身，运行时仍可走异步 fallback。
        }

        resolve({ dataUrl: compressed, sample });
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
};

// 当前内置 Agent 统一走后端 AI Runtime。模型 ID 来源于
// lib/ai/models.ts 的公共常量；真实 provider 和 key 只存在于后端。
const CHAT_MODEL_PRESETS: { id: string; title: string; sub: string }[] = [
  { id: MODELS.ARK_CODE, title: 'Ark Code', sub: '火山引擎 Coding Plan · 默认' }
];

export const SETTINGS_TABS: { id: TabId; label: string; hint: string; icon: typeof Layout }[] = [
  { id: 'account', label: '账号', hint: '身份与登录', icon: User },
  { id: 'appearance', label: '外观', hint: '主题与显示', icon: Layout },
  { id: 'ai', label: 'AI 对话', hint: '模型与温度', icon: BrainCircuit },
  { id: 'voice', label: '朗读', hint: '自动播报语速', icon: Volume2 },
  { id: 'sync', label: '连接', hint: '云端与知识库连接', icon: Globe },
  { id: 'storage', label: '存储', hint: '缓存与空间', icon: HardDrive },
  { id: 'developer', label: '开发者选项', hint: '开发与演示工具', icon: Wrench }
];

// 开发者选项 · 演示账号快速切换（点击即以该账号登录，便于验收不同角色视图）
const DEMO_ACCOUNTS: { email: string; name: string }[] = [
  { email: 'boss@bambook.local', name: '沈国强 · 超管' },
  { email: 'gm@bambook.local', name: '林志远 · 管理员' },
  { email: 'sales.manager@bambook.local', name: '陈雅雯 · 销售主管' },
  { email: 'sales.a@bambook.local', name: '苏晓芸 · 业务员' },
  { email: 'sales.b@bambook.local', name: '周子墨 · 业务员' },
  { email: 'finance.manager@bambook.local', name: '赵美玲 · 财务主管' },
  { email: 'finance@bambook.local', name: '钱志明 · 财务' },
  { email: 'qc@bambook.local', name: '吴建国 · QC' },
  { email: 'logistics@bambook.local', name: '郑海涛 · 后勤' },
];

type CompiledSettingsPageBlueprint = {
  template: 'CompiledSettingsPage';
  source: 'Settings.ui-lab-1.0.full-contract';
  provenance: 'accepted';
  modes: readonly ['system', 'account'];
  tabs: typeof SETTINGS_TABS;
  titleBarClassName: string;
  panelRowClassName: string;
};

export const compileSettingsPage = (): CompiledSettingsPageBlueprint => ({
  template: 'CompiledSettingsPage',
  source: 'Settings.ui-lab-1.0.full-contract',
  provenance: 'accepted',
  modes: ['system', 'account'],
  tabs: SETTINGS_TABS,
  titleBarClassName: BAMBOOK_OS.layout.desktopTitleBarWithInsetClass,
  panelRowClassName: `${BAMBOOK_OS.layout.desktopPanelRowClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass}`,
});

const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) return '不可用';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
};

const readImageFileAsDataUrl = (file: File): Promise<string> => (
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取头像失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  })
);

const loadAvatarImage = (src: string): Promise<HTMLImageElement> => (
  new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onerror = () => reject(new Error('图片格式无法识别'));
    img.onload = () => resolve(img);
    img.src = src;
  })
);

const createCircularAvatarDataUrl = async (draft: AvatarCropDraft): Promise<string> => {
  const img = await loadAvatarImage(draft.src);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持头像裁切');

  const normalizedRotation = ((draft.rotation % 360) + 360) % 360;
  const rotatedW = normalizedRotation % 180 === 0 ? draft.naturalWidth : draft.naturalHeight;
  const rotatedH = normalizedRotation % 180 === 0 ? draft.naturalHeight : draft.naturalWidth;
  const baseScale = AVATAR_OUTPUT_SIZE / Math.min(rotatedW, rotatedH);
  const drawW = draft.naturalWidth * baseScale * draft.scale;
  const drawH = draft.naturalHeight * baseScale * draft.scale;
  const offsetScale = AVATAR_OUTPUT_SIZE / AVATAR_CROP_PREVIEW_SIZE;

  ctx.clearRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR_OUTPUT_SIZE / 2, AVATAR_OUTPUT_SIZE / 2, AVATAR_OUTPUT_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(
    AVATAR_OUTPUT_SIZE / 2 + draft.offset.x * offsetScale,
    AVATAR_OUTPUT_SIZE / 2 + draft.offset.y * offsetScale,
  );
  ctx.rotate((normalizedRotation * Math.PI) / 180);
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  return canvas.toDataURL('image/webp', 0.86);
};

const Settings: React.FC<SettingsProps> = ({ mode = 'system', config, onUpdateConfig, isDarkMode = false }) => {
  const blueprint = useMemo(() => compileSettingsPage(), []);
  const settingsScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(() => (mode === 'account' ? 'account' : 'appearance'));
  const [localConfig, setLocalConfig] = useState<SystemConfig>(config);
  const currentThemeModeRef = useRef<SystemConfig['themeMode']>(config.themeMode);
  const [accountView, setAccountView] = useState<'overview' | 'modify'>('overview');
  const [devOptions, setDevOptions] = useState<DevOptions>(() => getDevOptions());

  useEffect(() => subscribeDevOptions(setDevOptions), []);

  useEffect(() => {
    setLocalConfig(config);
    currentThemeModeRef.current = config.themeMode;
  }, [config]);

  useEffect(() => {
    if (mode === 'account') {
      setActiveTab('account');
      setAccountView('overview');
      return;
    }
    if (activeTab === 'account') setActiveTab('appearance');
  }, [mode, activeTab]);

  const [isTestingMainApi, setIsTestingMainApi] = useState(false);
  const [isTestingKnowledgeApi, setIsTestingKnowledgeApi] = useState(false);
  const [testLogs, setTestLogs] = useState<{ msg: string; type: 'info' | 'success' | 'error' | 'latency' }[]>([]);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);
  // 开发者选项 · 演示账号一键切换（由开发者选项页开关控制）
  const [switchingAccount, setSwitchingAccount] = useState<string | null>(null);
  const [switchMsg, setSwitchMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [storageReport, setStorageReport] = useState<DeviceStorageReport | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageMsg, setStorageMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [avatarCrop, setAvatarCrop] = useState<AvatarCropDraft | null>(null);
  const [avatarDrag, setAvatarDrag] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: { x: number; y: number };
  } | null>(null);

  const addLog = (msg: string, type: 'info' | 'success' | 'error' | 'latency' = 'info') => {
    setTestLogs(prev => [{ msg: `[${new Date().toLocaleTimeString()}] ${msg}`, type }, ...prev].slice(0, 50));
  };

  const handleUpdate = (field: keyof SystemConfig, value: unknown) => {
    const newConfig = { ...localConfig, [field]: value };
    if (field === 'themeMode') {
      currentThemeModeRef.current = value as SystemConfig['themeMode'];
    } else {
      newConfig.themeMode = currentThemeModeRef.current;
    }
    setLocalConfig(newConfig);
    onUpdateConfig(newConfig);
    if (field === 'themeMode' || field === 'backgroundImage') {
      requestOsAdaptiveContrastRefresh();
    }
  };

  const openAgentPetWindow = () => {
    void window.bambookAgent?.openPetWindow?.();
  };

  const testMainDataApi = async () => {
    if (isTestingMainApi) return;
    setIsTestingMainApi(true);
    addLog(`测试主数据 API：${apiService.buildApiUrl('/health', localConfig.cloudEndpoint)}`, 'latency');
    try {
      const result = await apiService.testConnection(localConfig.cloudEndpoint);
      if (result.testedUrl) addLog(`请求 URL：${result.testedUrl}`, 'info');
      if (result.ok) addLog('主数据 API 连接正常。', 'success');
      else addLog(result.detail || `主数据 API 连接失败${result.statusCode ? ` (HTTP ${result.statusCode})` : ''}。`, 'error');
    } finally {
      setIsTestingMainApi(false);
    }
  };

  const testKnowledgeApi = async () => {
    if (isTestingKnowledgeApi) return;
    setIsTestingKnowledgeApi(true);
    addLog(`测试知识库 API：${knowledgeApiService.buildKnowledgeUrl('/health', localConfig.knowledgeApiEndpoint)}`, 'latency');
    try {
      const result = await knowledgeApiService.testConnection(
        localConfig.knowledgeApiEndpoint,
        localConfig.knowledgeApiKey,
      );
      if (result.testedUrl) addLog(`请求 URL：${result.testedUrl}`, 'info');
      if (result.ok) addLog(result.detail || '知识库 API 连接正常。', 'success');
      else addLog(result.detail || `知识库 API 连接失败${result.statusCode ? ` (HTTP ${result.statusCode})` : ''}。`, 'error');
    } finally {
      setIsTestingKnowledgeApi(false);
    }
  };

  const card = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-settings-nested-panel bambook-outer-panel transition-[background,border-color,box-shadow] duration-300`;
  const labelCls = `text-[11px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.tone.text.formLabel}`;
  const inputCls = `w-full h-9 px-4 rounded-control outline-none transition-colors duration-200 ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.controls.recessedField.base}`;
  const actionControlCls = `h-9 rounded-full border text-xs ${BAMBOOK_OS.typography.weight.ui} transition-colors duration-200 ${BAMBOOK_OS.controls.actionControl.bordered}`;
  const brandIconCls = BAMBOOK_OS.tone.text.brandEmphasis;
  const primaryTextCls = 'text-[var(--text-primary)]';
  const secondaryTextCls = BAMBOOK_OS.tone.text.quiet;
  const weakTextCls = 'text-[var(--text-tertiary)]';
  const sectionDividerCls = BAMBOOK_OS.tone.divider.section;
  const iconWellCls = `flex h-9 w-9 shrink-0 items-center justify-center rounded-field border ${BAMBOOK_OS.tone.surface.quietIcon} border-[var(--border-c-subtle)] ${BAMBOOK_OS.tone.text.brandEmphasis}`;
  const optionActiveCls = `${SIDEBAR_ACTIVE_CLASS} text-[var(--text-primary)]`;
  // SIDEBAR_HOVER/PRESS 的 DARK 与 LIGHT 版已坍缩为同一自适应配方，单类承载双主题
  const optionIdleCls = `border border-transparent bg-transparent shadow-none text-[var(--text-secondary)] ${SIDEBAR_HOVER_CLASS} ${SIDEBAR_PRESS_CLASS}`;
  const uploadDropzoneCls = 'relative h-20 rounded-control border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-200 border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)] active:scale-[0.98] active:bg-[var(--active-darken)]';
  const selectedWallpaperCls = 'border-[var(--os-vnext-brand-blue)] shadow-none';
  const idleWallpaperCls = 'border-[var(--border-c-subtle)] hover:border-[var(--border-c-default)]';
  const rangeCls = 'bambook-settings-range w-full appearance-none cursor-pointer';
  const switchCls = (checked: boolean) => `bds-switch ${checked ? 'on' : ''}`;

  const modelId = localConfig.chatModelId || MODELS.FAST;
  const canOpenAgentPetWindow = Boolean(window.bambookAgent?.openPetWindow);
  const auth = getAuthState();
  const user = auth.user;
  const canUseAiChat = hasPermission('ai:chat');
  const isProductionGlobeEnabled = localConfig.enableProductionGlobe !== false;
  const wallpaperOptions = normalizeWallpaperOptions(localConfig.systemWallpaperOptions);
  const groupedWallpaperOptions = wallpaperOptions.reduce<Array<{ group: string; presets: WallpaperOption[] }>>((groups, preset) => {
    const groupName = preset.group || '未分组';
    const existing = groups.find(group => group.group === groupName);
    if (existing) existing.presets.push(preset);
    else groups.push({ group: groupName, presets: [preset] });
    return groups;
  }, []).sort((a, b) => (
    getWallpaperGroupRank(a.group) - getWallpaperGroupRank(b.group)
    || a.group.localeCompare(b.group, 'zh-Hans-CN')
  ));
  const visibleTabs = useMemo(() => SETTINGS_TABS.filter(tab => (
    mode === 'account'
      ? tab.id === 'account'
      : tab.id !== 'account'
        && (tab.id !== 'developer' || devOptions.developerMode)
        && (canUseAiChat || (tab.id !== 'ai' && tab.id !== 'voice'))
  )), [mode, canUseAiChat, devOptions.developerMode]);

  useEffect(() => {
    if (visibleTabs.some(tab => tab.id === activeTab)) return;
    setActiveTab(mode === 'account' ? 'account' : 'appearance');
  }, [activeTab, canUseAiChat, mode, visibleTabs]);

  const handleChangePw = async () => {
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: '两次输入的新密码不一致' }); return; }
    if (newPw.length < 6) { setPwMsg({ ok: false, text: '新密码至少 6 位' }); return; }
    setPwLoading(true);
    setPwMsg(null);
    try {
      await changePassword(currentPw, newPw);
      setPwMsg({ ok: true, text: '密码已修改' });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (e: any) { setPwMsg({ ok: false, text: e.message || '修改失败' }); }
    finally { setPwLoading(false); }
  };

  const handleLogout = async () => {
    await logout();
  };

  // 开发者选项 · 一键切换演示账号（登录新账号 → 全局状态刷新 → 各页面按新权限重挂载）
  const handleQuickSwitch = async (email: string) => {
    if (switchingAccount) return;
    setSwitchingAccount(email);
    setSwitchMsg(null);
    try {
      await login(email, 'Bambook@2026');
      setSwitchMsg({ ok: true, text: '已切换' });
    } catch (e: any) {
      setSwitchMsg({ ok: false, text: e.message || '切换失败' });
    } finally {
      setSwitchingAccount(null);
    }
  };

  const handleAvatarFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setAvatarMsg({ ok: false, text: '请选择图片文件' });
      return;
    }
    setAvatarLoading(true);
    setAvatarMsg(null);
    try {
      const src = await readImageFileAsDataUrl(file);
      const image = await loadAvatarImage(src);
      setAvatarCrop({
        src,
        fileName: file.name || 'avatar',
        naturalWidth: image.width,
        naturalHeight: image.height,
        scale: 1,
        rotation: 0,
        offset: { x: 0, y: 0 },
      });
    } catch (e: any) {
      setAvatarMsg({ ok: false, text: e.message || '头像读取失败' });
    } finally {
      setAvatarLoading(false);
    }
  };

  const confirmAvatarCrop = async () => {
    if (!avatarCrop) return;
    setAvatarLoading(true);
    setAvatarMsg(null);
    try {
      const avatarUrl = await createCircularAvatarDataUrl(avatarCrop);
      if (avatarUrl.length > 700_000) throw new Error('头像图片太大，请缩小或换一张图片。');
      await updateMyProfile({ avatarUrl });
      setAvatarCrop(null);
      setAvatarMsg({ ok: true, text: '头像已更新' });
    } catch (e: any) {
      setAvatarMsg({ ok: false, text: e.message || '头像更新失败' });
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarLoading(true);
    setAvatarMsg(null);
    try {
      await updateMyProfile({ avatarUrl: null });
      setAvatarMsg({ ok: true, text: '头像已移除' });
    } catch (e: any) {
      setAvatarMsg({ ok: false, text: e.message || '移除失败' });
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleAvatarCropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!avatarCrop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setAvatarDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: avatarCrop.offset,
    });
  };

  const handleAvatarCropPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!avatarCrop || !avatarDrag || avatarDrag.pointerId !== event.pointerId) return;
    setAvatarCrop({
      ...avatarCrop,
      offset: {
        x: avatarDrag.startOffset.x + event.clientX - avatarDrag.startX,
        y: avatarDrag.startOffset.y + event.clientY - avatarDrag.startY,
      },
    });
  };

  const handleAvatarCropPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (avatarDrag?.pointerId === event.pointerId) setAvatarDrag(null);
  };

  const refreshStorageReport = async () => {
    setStorageLoading(true);
    setStorageMsg(null);
    try {
      setStorageReport(await storageService.getDeviceStorageReport());
    } catch (e: any) {
      setStorageMsg({ ok: false, text: e.message || '读取本机存储失败' });
    } finally {
      setStorageLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'storage') return;
    void refreshStorageReport();
  }, [activeTab]);

  // R5：清理/重置前 bdsConfirm 确认（本地数据不可恢复，danger 语义）
  const clearStorageArea = async (kind: 'business' | 'email' | 'preferences') => {
    const meta = kind === 'business'
      ? { title: '确认清理业务缓存', body: '将移除本机的庞大原始库与行情快照缓存，不影响云端业务数据。', confirmText: '清理' }
      : kind === 'email'
        ? { title: '确认清理邮箱缓存', body: '将移除本机的邮箱列表与正文缓存，重新打开邮箱时会重新拉取。', confirmText: '清理' }
        : { title: '确认重置本机偏好', body: '主题、页面、布局状态将恢复默认，不影响云端业务数据。', confirmText: '重置' };
    if (!(await bdsConfirm({ title: meta.title, body: meta.body, confirmText: meta.confirmText, danger: true }))) return;
    setStorageLoading(true);
    setStorageMsg(null);
    try {
      const removed = kind === 'business'
        ? await storageService.clearBusinessCache()
        : kind === 'email'
          ? await storageService.clearEmailCache()
          : await storageService.clearDevicePreferences();
      await refreshStorageReport();
      const label = kind === 'business' ? '业务缓存' : kind === 'email' ? '邮箱缓存' : '本机个性化';
      setStorageMsg({ ok: true, text: `${label}已清理，移除 ${removed} 个本地键。` });
    } catch (e: any) {
      setStorageMsg({ ok: false, text: e.message || '清理失败' });
      setStorageLoading(false);
    }
  };

  const settingsFrameClass = `${BAMBOOK_OS.layout.desktopWorkspaceFrameClass} bambook-settings-frame`;
  const settingsPanelRowClass = blueprint.panelRowClassName;

  return (
    <div
      className={settingsFrameClass}
      data-os-compiler-page="settings"
      data-os-compiler-template={blueprint.template}
      data-os-compiler-source={blueprint.source}
      data-os-compiler-provenance={blueprint.provenance}
      data-os-compiler-role="settings-full-contract"
    >
      <PageHeader
        title={mode === 'account' ? '账号设置' : '系统设置'}
        subtitle={mode === 'account' ? 'Account Settings' : 'System Settings'}
        isDarkMode={isDarkMode}
      />

      <CompiledSplitWorkspace
        blueprint={blueprint as any}
        source="SETTINGS_SPLIT_WORKSPACE"
        baseClassName={settingsPanelRowClass}
      >
        {/* 左侧导航 */}
        {mode === 'system' && (
          <CompiledSplitNavPanel
            isDarkMode={isDarkMode}
            className="bambook-settings-nav-panel"
            source="SETTINGS_SPLIT_NAV_PANEL"
          >
            {visibleTabs.map(tab => {
              const Icon = tab.icon;
              const on = activeTab === tab.id;
              const hintCls = weakTextCls;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`text-left rounded-control px-3 py-2.5 transition-colors duration-200 flex items-start gap-2 border ${BAMBOOK_OS.typography.weight.ui} ${on ? optionActiveCls : optionIdleCls}`}
                >
                  <Icon size={16} strokeWidth={1.5} className={`mt-0.5 shrink-0 transition-colors ${on ? 'text-current' : SIDEBAR_IDLE_ICON_CLASS}`} />
                  <span>
                    <span className="block text-sm font-light leading-tight">{tab.label}</span>
                    <span className={`block text-[10px] mt-0.5 ${hintCls}`}>{tab.hint}</span>
                  </span>
                </button>
              );
            })}
            <div className="mt-auto pt-3 px-2 pb-1 text-[10px] text-[var(--text-tertiary)]">
              <div>Bambook Hub v0.8</div>
              <button
                type="button"
                onClick={() => setDevOption('developerMode', !devOptions.developerMode)}
                className="mt-1 flex items-center gap-1 opacity-70 hover:opacity-100 hover:text-[var(--text-secondary)] transition-[opacity,color] duration-200"
              >
                <Wrench size={10} strokeWidth={1.5} />
                {devOptions.developerMode ? '开发者选项已开启' : '开发者选项'}
              </button>
            </div>
          </CompiledSplitNavPanel>
        )}

        {/* 主内容 */}
        <CompiledSplitMainPanel
          isDarkMode={isDarkMode}
          source="SETTINGS_SPLIT_MAIN_PANEL"
          scrollRef={settingsScrollRef}
          flat={mode === 'account'}
        >
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className={mode === 'account' ? BAMBOOK_OS.layout.desktopAccountSettingsContentStackClass : BAMBOOK_OS.layout.desktopSettingsContentStackClass}
              >
              {activeTab === 'appearance' && (
                <div className="space-y-6">
                  <div>
                    <h3 className={`text-xs font-light uppercase tracking-[0.2em] mb-3 text-[var(--text-tertiary)]`}>系统外观主题</h3>
                    <p className={`text-xs mb-3 ${secondaryTextCls}`}>
                      与应用其他页面一致的全局浅色 / 深色主题。选择「跟随系统」时，将使用系统外观并随系统切换。
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {(['light', 'dark', 'system'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => handleUpdate('themeMode', mode)}
                          className={`p-4 rounded-control border flex flex-col items-center gap-2 transition-colors duration-200 ${localConfig.themeMode === mode ? optionActiveCls : optionIdleCls}`}
                        >
                          {mode === 'light' && <Sun size={24} strokeWidth={1.75} />}
                          {mode === 'dark' && <Moon size={24} strokeWidth={1.75} />}
                          {mode === 'system' && <Monitor size={24} strokeWidth={1.75} />}
                          <span className="text-xs font-light">{mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={`pt-6 border-t ${sectionDividerCls}`}>
                    <div className={card + ' p-5'}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`mt-0.5 ${iconWellCls}`}>
                            <Globe size={18} strokeWidth={1.5} />
                          </div>
                          <div className="min-w-0">
                            <div className={`text-sm font-light ${primaryTextCls}`}>生产地球组件</div>
                            <p className={`mt-1 text-xs leading-relaxed ${weakTextCls}`}>
                              控制全景看板与订单地球视图的 WebGL 地球背景。关闭后不挂载地球画布。
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isProductionGlobeEnabled}
                          onClick={() => handleUpdate('enableProductionGlobe', !isProductionGlobeEnabled)}
                          className={switchCls(isProductionGlobeEnabled)}
                        />
                      </div>
                    </div>
                  </div>

                  {ENABLE_WALLPAPER_SWITCHING && (
                  <div className={`pt-6 border-t ${sectionDividerCls}`}>
                    <h3 className={`text-xs font-light uppercase tracking-[0.2em] mb-2 text-[var(--text-tertiary)]`}>桌面背景壁纸</h3>
                    <p className={`text-xs mb-4 ${secondaryTextCls}`}>
                      选择内置的物理折射壁纸或上传自定义照片，以提升工作区的毛玻璃感与三维立体深度。
                    </p>

                    <div className="space-y-4">
                      {groupedWallpaperOptions.map(group => (
                        <div key={group.group} className="space-y-2">
                          <div className={`text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]`}>{group.group}</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {group.presets.map(preset => {
                              const resolvedBackgroundImage = resolvePublicAssetUrl(localConfig.backgroundImage);
                              const isSelected = (!localConfig.backgroundImage && preset.url === '') || (resolvedBackgroundImage === preset.url);
                              return (
                                <div
                                  key={preset.id}
                                  className={`relative rounded-control border transition-colors duration-200 ${isSelected ? selectedWallpaperCls : idleWallpaperCls}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleUpdate('backgroundImage', preset.url)}
                                    className="group/wp relative flex h-20 w-full flex-col justify-end overflow-hidden rounded-control p-2 text-left"
                                  >
                                    {preset.url ? (
                                      <>
                                        <div
                                          className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover/wp:scale-105"
                                          style={{ backgroundImage: `url(${resolvePublicAssetUrl(preset.url)})` }}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                                      </>
                                    ) : (
                                      <>
                                        <div
                                          className="absolute inset-0 transition-transform duration-500 group-hover/wp:scale-105"
                                          style={isDarkMode ? DEFAULT_WALLPAPER_PREVIEW_DARK_STYLE : DEFAULT_WALLPAPER_PREVIEW_LIGHT_STYLE}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-white/15" />
                                      </>
                                    )}
                                    <span className="relative z-10 flex max-w-full items-center gap-1 text-[10px] font-light text-white drop-shadow-none">
                                      <span className="truncate">{preset.title}</span>
                                    </span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* 如果有自定义上传的背景（且不在 Preset 里），显示它 */}
                      {localConfig.backgroundImage && !wallpaperOptions.some(p => p.url === resolvePublicAssetUrl(localConfig.backgroundImage)) && (
                        <button
                          type="button"
                          className={`group/wp relative h-20 rounded-control border ${selectedWallpaperCls} overflow-hidden flex flex-col justify-end p-2 text-left`}
                        >
                          <div
                            className="absolute inset-0 bg-cover bg-center"
                            style={{ backgroundImage: `url(${resolvePublicAssetUrl(localConfig.backgroundImage)})` }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                          <span className="relative z-10 text-[10px] font-light text-white truncate max-w-full drop-shadow-none flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--active-darken)]" />
                            自定义背景
                          </span>
                        </button>
                      )}

                      {/* 上传图片卡片按钮 */}
                      <label
                        className={uploadDropzoneCls}
                      >
                        <Upload size={18} strokeWidth={1.5} />
                        <span className="text-[10px] font-light">上传背景图</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={async (e) => {
                            const file = e.currentTarget.files?.[0];
                            if (file) {
                              try {
                                const { dataUrl, sample } = await compressWallpaper(file);
                                // 关键：把颜色档案写进缓存里，要先于 handleUpdate；
                                // 这样下一帧 App 重新渲染时 getCachedWallpaperAccentPalette
                                // 立刻命中，accent CSS 变量同步切换、无任何异步延迟。
                                if (sample) setWallpaperAccentSample(dataUrl, sample);
                                handleUpdate('backgroundImage', dataUrl);
                              } catch (err: any) {
                                bdsToast.danger(err.message || '读取并压缩壁纸失败');
                              }
                            }
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  )}
                </div>
              )}

              {activeTab === 'ai' && (
                <div className="space-y-8">
                  <div className={card + ' p-5'}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={iconWellCls}>
                          <Bot size={18} strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className={`text-sm font-light ${primaryTextCls}`}>Agent 宠物浮窗</div>
                          <div className={`mt-1 text-xs leading-relaxed ${weakTextCls}`}>
                            打开桌面上的 Bambook Agent 熊猫浮窗。关闭后也可以从这里重新开启。
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 px-4 ${actionControlCls}`}
                        disabled={!canOpenAgentPetWindow}
                        onClick={openAgentPetWindow}
                      >
                        <Bot size={14} strokeWidth={1.5} />
                        {canOpenAgentPetWindow ? '打开浮窗' : '仅桌面端可用'}
                      </button>
                    </div>
                  </div>

                  <div className={card + ' p-5'}>
                    <div className="flex items-center gap-2 mb-4">
                      <Cpu size={18} className={brandIconCls} strokeWidth={1.5} />
                      <span className={`text-sm font-light ${primaryTextCls}`}>主对话模型</span>
                    </div>
                    <p className={`text-xs mb-4 ${weakTextCls}`}>
                      与 AI 助理中的对话一致；当前内置 Agent 走后端 AI Runtime（数据中心环境变量）。保存后立即生效于新会话。
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CHAT_MODEL_PRESETS.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleUpdate('chatModelId', m.id)}
                          className={`text-left p-4 rounded-control border transition-colors duration-200 ${modelId === m.id ? optionActiveCls : optionIdleCls}`}
                        >
                          <div className={`text-sm font-light ${modelId === m.id ? 'text-current' : primaryTextCls}`}>{m.title}</div>
                          <div className={`text-[11px] mt-1 ${weakTextCls}`}>{m.sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={card + ' p-5'}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={labelCls}>采样温度</span>
                      <span className={`text-xs font-mono ${primaryTextCls}`}>{localConfig.temperature ?? 0.7}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={localConfig.temperature ?? 0.7}
                      onChange={e => handleUpdate('temperature', parseFloat(e.target.value))}
                      className={rangeCls}
                    />
                    <div className={`flex justify-between text-[10px] mt-2 uppercase tracking-wide text-[var(--text-tertiary)]`}>
                      <span>更稳</span>
                      <span>更活</span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'voice' && (
                <div className="space-y-6">
                  <p className={`text-sm ${secondaryTextCls}`}>
                    控制 AI 回复后的<strong className="font-light text-[var(--text-primary)]">自动朗读</strong>语速。语音经本地 Melo TTS 代理合成。
                  </p>
                  <div className={card + ' p-5'}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={labelCls}>语速</span>
                      <span className={`text-xs font-mono ${primaryTextCls}`}>{(localConfig.voiceSpeed ?? 1).toFixed(2)}×</span>
                    </div>
                    <input
                      type="range"
                      min={0.75}
                      max={1.5}
                      step={0.05}
                      value={localConfig.voiceSpeed ?? 1}
                      onChange={e => handleUpdate('voiceSpeed', parseFloat(e.target.value))}
                      className={rangeCls}
                    />
                  </div>
                  <p className={`text-xs ${weakTextCls}`}>
                    下方「TTS 引擎」旧选项已弃用展示；当前实现以助理内实际播放链路为准。
                  </p>
                </div>
              )}

              {activeTab === 'sync' && (
                <div className="space-y-8">
                  <div className={card + ' p-5 space-y-4'}>
                    <div className="flex items-center gap-2">
                      <Server size={18} strokeWidth={1.5} className={brandIconCls} />
                      <span className={`text-sm font-light ${primaryTextCls}`}>主数据 API</span>
                    </div>
                    <p className={`text-xs ${weakTextCls}`}>
                      同步订单、关系智库、数字档案等业务数据，客户端会自动拼接 <code className="font-mono">/api/...</code>。若 Cloudflare 使用 <code className="font-mono">/bambook</code> Path，填 <code className="font-mono">https://jiangsupanda.com/bambook</code> 后会请求 <code className="font-mono">/bambook/api/...</code>。
                    </p>
                    <input
                      type="text"
                      value={localConfig.cloudEndpoint}
                      onChange={e => handleUpdate('cloudEndpoint', e.target.value)}
                      className={inputCls + ' font-mono text-xs'}
                      placeholder="https://jiangsupanda.com/bambook"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${config.isCloudConnected ? 'bg-[var(--os-vnext-brand-blue-strong)]' : 'bg-[var(--text-tertiary)]'}`} />
                        <span className={secondaryTextCls}>
                          当前探测：{config.isCloudConnected ? '已连接' : '未连接'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={testMainDataApi}
                        disabled={isTestingMainApi}
                        className={`ml-auto px-3 ${actionControlCls} disabled:opacity-50`}
                      >
                        {isTestingMainApi ? '测试中…' : '测试主数据连接'}
                      </button>
                    </div>
                  </div>

                  <div className={card + ' p-5 space-y-4'}>
                    <div className="flex items-center gap-2">
                      <KeyRound size={18} strokeWidth={1.5} className={brandIconCls} />
                      <span className={`text-sm font-light ${primaryTextCls}`}>本客户端凭据</span>
                    </div>
                    <p className={`text-xs ${weakTextCls}`}>
                      本客户端连接后端 <code className="font-mono">/api/v1/*</code> 时使用的认证方式与密钥。
                      生产环境请使用强密钥；对外访问策略由管理员在「管理后台 → 平台规则」维护。
                    </p>
                    <div>
                      <div className={labelCls + ' mb-2'}>认证模式</div>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { id: 'auto' as const, name: '自动' },
                          { id: 'required' as const, name: '必验' },
                          { id: 'none' as const, name: '开放' }
                        ]).map(authMode => (
                          <button
                            key={authMode.id}
                            type="button"
                            onClick={() => handleUpdate('sdkAuthMode', authMode.id)}
                            className={`h-9 rounded-control text-xs font-light border transition-colors duration-200 ${localConfig.sdkAuthMode === authMode.id ? optionActiveCls : optionIdleCls}`}
                          >
                            {authMode.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(localConfig.sdkAuthMode === 'auto' || localConfig.sdkAuthMode === 'required') && (
                      <div>
                        <label className={labelCls}>API Key</label>
                        <input
                          type="password"
                          value={localConfig.sdkApiKey || ''}
                          onChange={e => handleUpdate('sdkApiKey', e.target.value)}
                          className={inputCls + ' mt-1 font-mono text-xs'}
                          placeholder="与后端校验一致"
                          autoComplete="off"
                        />
                      </div>
                    )}
                  </div>

                  <div className={card + ' p-5 space-y-4'}>
                    <div className="flex items-center gap-2">
                      <DatabaseZap size={18} strokeWidth={1.5} className={brandIconCls} />
                      <span className={`text-sm font-light ${primaryTextCls}`}>知识库 API</span>
                    </div>
                    <p className={`text-xs ${weakTextCls}`}>
                      用于向量检索、RAG 对话和知识入库。默认公网地址为 <code className="font-mono">https://jiangsupanda.com/bambook</code>，认证使用独立 Bearer Token。
                    </p>
                    <div>
                      <label className={labelCls}>公网地址</label>
                      <input
                        type="text"
                        value={localConfig.knowledgeApiEndpoint || ''}
                        onChange={e => handleUpdate('knowledgeApiEndpoint', e.target.value)}
                        className={inputCls + ' mt-1 font-mono text-xs'}
                        placeholder="https://jiangsupanda.com/bambook"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>知识库 API Key</label>
                      <input
                        type="password"
                        value={localConfig.knowledgeApiKey || ''}
                        onChange={e => handleUpdate('knowledgeApiKey', e.target.value)}
                        className={inputCls + ' mt-1 font-mono text-xs'}
                        placeholder="Bearer token，不提交仓库"
                        autoComplete="off"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={testKnowledgeApi}
                      disabled={isTestingKnowledgeApi}
                      className={`w-full ${actionControlCls} disabled:opacity-50`}
                    >
                      {isTestingKnowledgeApi ? '测试中…' : '测试知识库连接'}
                    </button>
                  </div>

                  <div className={card + ' p-5 space-y-4'}>
                    <div className="flex justify-between items-center">
                      <span className={labelCls}>定时从云端拉取（分钟）</span>
                      <span className="text-xs font-mono">{localConfig.syncInterval ?? 15}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={60}
                      step={1}
                      value={localConfig.syncInterval ?? 15}
                      onChange={e => handleUpdate('syncInterval', parseInt(e.target.value, 10))}
                      className={rangeCls}
                    />
                  </div>

                  <div className={`p-3 rounded-control border font-mono text-[10px] h-36 overflow-y-auto custom-scrollbar bg-[var(--recessed-bg-strong)] border-[var(--border-c-subtle)] text-[var(--text-secondary)]`}>
                    {testLogs.map((log, i) => (
                      <div key={i} className={`mb-1 ${log.type === 'error' ? 'text-[var(--text-tertiary)]' : log.type === 'success' ? 'text-[var(--text-secondary)]' : ''}`}>
                        {log.msg}
                      </div>
                    ))}
                    {testLogs.length === 0 && <span className="opacity-40">尚无日志</span>}
                  </div>
                </div>
              )}

              {activeTab === 'storage' && (
                <div className="space-y-6">
                  <div className={card + ' p-5 space-y-4'}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className={`text-sm font-light ${primaryTextCls}`}>本机存储管理</div>
                        <p className={`mt-1 text-xs ${weakTextCls}`}>
                          这里只管理当前设备的缓存和个性化数据。业务主数据仍以数据中心为准。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={refreshStorageReport}
                        disabled={storageLoading}
                        className={`px-3 inline-flex items-center gap-2 ${actionControlCls} disabled:opacity-50`}
                      >
                        <RefreshCw size={14} strokeWidth={1.5} className={storageLoading ? 'animate-spin' : ''} />
                        刷新
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {[
                        ['键值数据', formatBytes(storageReport?.localStorageBytes)],
                        ['浏览器缓存', formatBytes(storageReport?.indexedDbUsageBytes)],
                        ['设备配额', formatBytes(storageReport?.quotaBytes)],
                      ].map(([title, value]) => (
                        <div key={title} className={`rounded-control border px-4 py-3 ${BAMBOOK_OS.tone.surface.inlinePanel}`}>
                          <div className={labelCls}>{title}</div>
                          <div className={`mt-1 text-sm font-light ${primaryTextCls}`}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {(storageReport?.categories || []).map(category => (
                      <div key={category.id} className={`rounded-control border p-4 flex items-center justify-between gap-4 ${BAMBOOK_OS.tone.surface.linkedPanel}`}>
                        <div className="min-w-0">
                          <div className={`text-sm font-light ${primaryTextCls}`}>{category.label}</div>
                          <div className={`mt-1 text-[11px] leading-relaxed ${weakTextCls}`}>{category.description}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-light ${primaryTextCls}`}>{formatBytes(category.bytes)}</div>
                          <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">{category.keys.length} keys</div>
                        </div>
                      </div>
                    ))}
                    {!storageReport && (
                      <div className={`rounded-control border p-4 text-xs ${BAMBOOK_OS.tone.surface.linkedPanel} text-[var(--text-tertiary)]`}>
                        {storageLoading ? '正在读取本机存储...' : '暂无存储报告'}
                      </div>
                    )}
                  </div>

                  <div className={card + ' p-5 space-y-4'}>
                    <div>
                      <div className={`text-sm font-light ${primaryTextCls}`}>清理操作</div>
                      <p className={`mt-1 text-xs ${weakTextCls}`}>
                        不会删除云端业务数据。账号会话和连接配置暂不提供批量清理，避免误断线。
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: 'business' as const, title: '清业务缓存', desc: '庞大原始库、行情快照' },
                        { id: 'email' as const, title: '清邮箱缓存', desc: '邮箱列表与正文缓存' },
                        { id: 'preferences' as const, title: '重置本机偏好', desc: '主题、页面、布局状态' },
                      ].map(action => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => clearStorageArea(action.id)}
                          disabled={storageLoading}
                          className={`rounded-control border p-3 text-left transition-colors duration-200 ${optionIdleCls} disabled:opacity-50`}
                        >
                          <div className="flex items-center gap-2 text-xs font-light">
                            <Trash2 size={14} strokeWidth={1.5} />
                            {action.title}
                          </div>
                          <div className={`mt-1 text-[10px] ${weakTextCls}`}>{action.desc}</div>
                        </button>
                      ))}
                    </div>
                    {storageMsg && (
                      <div className={`text-xs rounded-control px-3 py-2 border ${storageMsg.ok ? 'text-[var(--text-secondary)] bg-[var(--recessed-bg)] border-[var(--border-c-subtle)]' : 'text-[var(--text-tertiary)] bg-[var(--recessed-bg)] border-[var(--border-c-subtle)]'}`}>
                        {storageMsg.text}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'account' && (
                <div className="space-y-6">
                  {accountView === 'overview' && (
                    <>
                      <div className={`${card} overflow-hidden`}>
                        <div className="p-6 flex items-start gap-4">
                          <div className="group/avatar relative shrink-0">
                            <UserAvatar
                              name={user?.displayName}
                              email={user?.email}
                              avatarUrl={user?.avatarUrl}
                              isDarkMode={isDarkMode}
                              sizeClassName="h-16 w-16"
                              textClassName="text-xl"
                            />
                            {user && (
                              <label
                                className={`absolute -bottom-1 -right-1 z-20 flex h-8 w-7 cursor-pointer items-center justify-center rounded-full border opacity-0 shadow-none transition-colors duration-200 group-hover/avatar:opacity-100 group-focus-within/avatar:opacity-100 ${avatarLoading ? 'pointer-events-none opacity-60' : 'hover:scale-105'} border-transparent bg-[var(--recessed-bg)] text-[var(--os-vnext-brand-blue-strong)]`}
                                aria-label="编辑头像"
                              >
                                <Pencil size={14} strokeWidth={1.5} />
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="sr-only"
                                  onChange={event => {
                                    void handleAvatarFile(event.currentTarget.files?.[0]);
                                    event.currentTarget.value = '';
                                  }}
                                />
                              </label>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-light tracking-[0.2em] uppercase text-[var(--text-tertiary)]`}>Signed In Account</div>
                            <div className={`mt-1 text-xl font-light truncate ${primaryTextCls}`}>
                              {user?.displayName || '未登录'}
                            </div>
                            <div className={`mt-1 text-xs font-mono truncate text-[var(--text-tertiary)]`}>
                              {user?.email || 'No active session'}
                            </div>
                          </div>
                          <span className={`text-[10px] px-2 py-1 rounded-full shrink-0 ${user ? 'bg-[var(--recessed-bg)] text-[var(--text-secondary)]' : 'bg-[var(--recessed-bg)] text-[var(--text-tertiary)]'}`}>
                            {user ? '已登录' : '未登录'}
                          </span>
                        </div>
                        {user && (
                          <div className={`border-t px-6 py-4 border-[var(--border-c-subtle)]`}>
                            <div className="flex flex-wrap items-center gap-2">
                              {user.avatarUrl && (
                                <button
                                  type="button"
                                  onClick={handleRemoveAvatar}
                                  disabled={avatarLoading}
                                  className={`px-4 ${actionControlCls} disabled:opacity-50`}
                                >
                                  移除头像
                                </button>
                              )}
                              <span className={`text-[11px] text-[var(--text-tertiary)]`}>
                                触碰头像后点击右下角编辑按钮；自动居中裁切，所有场景统一圆形显示。
                              </span>
                            </div>
                            {avatarMsg && (
                              <div className={`mt-3 text-xs rounded-control px-3 py-2 ${avatarMsg.ok ? 'text-[var(--text-secondary)] bg-[var(--recessed-bg)] border border-[var(--border-c-subtle)]' : 'text-[var(--text-tertiary)] bg-[var(--recessed-bg)] border border-[var(--border-c-subtle)]'}`}>
                                {avatarMsg.text}
                              </div>
                            )}
                          </div>
                        )}
                        {user && (
                          <div className={`grid grid-cols-2 border-t border-[var(--border-c-subtle)]`}>
                            <div className="p-4">
                              <div className={labelCls}>角色</div>
                              <div className={`mt-1 text-sm text-[var(--text-primary)]`}>{user.roles.join(', ') || '-'}</div>
                            </div>
                            <div className={`p-4 border-l border-[var(--border-c-subtle)]`}>
                              <div className={labelCls}>部门</div>
                              <div className={`mt-1 text-sm text-[var(--text-primary)]`}>{user.department || user.departmentIds.join(', ') || '-'}</div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className={`p-4 rounded-control border text-left transition-colors duration-200 ${optionIdleCls}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-light">切换账号</div>
                              <div className={`mt-1 text-[11px] ${weakTextCls}`}>退出当前会话后重新登录</div>
                            </div>
                            <ArrowRight size={16} strokeWidth={1.5} />
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={handleLogout}
                          className={`p-4 rounded-control border text-left transition-colors duration-200 bg-[var(--recessed-bg)] border-[var(--border-c-subtle)] text-[var(--text-secondary)] hover:bg-[var(--hover-darken)]`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-light">退出登录</div>
                              <div className={`mt-1 text-[11px] text-[var(--text-tertiary)]`}>清除本机登录状态</div>
                            </div>
                            <LogOut size={16} strokeWidth={1.5} />
                          </div>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setAccountView('modify')}
                        className={`w-full p-4 rounded-control border text-left transition-colors duration-200 ${optionIdleCls}`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className={`text-sm font-light ${primaryTextCls}`}>账号修改</div>
                            <div className={`mt-1 text-[11px] ${weakTextCls}`}>
                              修改密码等敏感账户操作
                            </div>
                          </div>
                          <ArrowRight size={16} strokeWidth={1.5} className={weakTextCls} />
                        </div>
                      </button>
                    </>
                  )}

                  {accountView === 'modify' && (
                    <div className="space-y-4">
                      <button
                        type="button"
                        onClick={() => setAccountView('overview')}
                        className={`text-xs font-light text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`}
                      >
                        返回账号名片
                      </button>

                      <div className={card + ' p-5 space-y-4'}>
                        <div>
                          <div className={`text-sm font-light ${primaryTextCls}`}>修改密码</div>
                          <p className={`mt-1 text-xs ${weakTextCls}`}>需要输入当前密码确认身份。</p>
                        </div>
                        <div>
                          <label className={labelCls}>当前密码</label>
                          <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className={inputCls + ' mt-1'} autoComplete="current-password" />
                        </div>
                        <div>
                          <label className={labelCls}>新密码</label>
                          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className={inputCls + ' mt-1'} autoComplete="new-password" />
                        </div>
                        <div>
                          <label className={labelCls}>确认新密码</label>
                          <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className={inputCls + ' mt-1'} autoComplete="new-password" />
                        </div>
                        {pwMsg && (
                          <div className={`text-xs rounded-control px-3 py-2 ${pwMsg.ok ? 'text-[var(--text-secondary)] bg-[var(--recessed-bg)] border border-[var(--border-c-subtle)]' : 'text-[var(--text-tertiary)] bg-[var(--recessed-bg)] border border-[var(--border-c-subtle)]'}`}>
                            {pwMsg.text}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={handleChangePw}
                          disabled={pwLoading || !currentPw || !newPw || !confirmPw}
                          className={`w-full ${actionControlCls} transition-colors duration-200 ${
                            pwLoading || !currentPw || !newPw || !confirmPw
                              ? 'opacity-50'
                              : ''
                          }`}
                        >
                          {pwLoading ? '修改中...' : '确认修改密码'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'developer' && (
                <div className="space-y-6">
                  {/* 装修遮挡 */}
                  <div className={card + ' p-5'}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={`mt-0.5 ${iconWellCls}`}>
                          <Layout size={18} strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0">
                          <div className={`text-sm font-light ${primaryTextCls}`}>装修遮挡</div>
                          <p className={`mt-1 text-xs leading-relaxed ${weakTextCls}`}>
                            v0.8 未交付模块以磨砂面板覆盖，并提示「开发中 · 即将上线」。关闭后显示完整界面。
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={devOptions.comingSoonOverlay}
                        onClick={() => setDevOption('comingSoonOverlay', !devOptions.comingSoonOverlay)}
                        className={switchCls(devOptions.comingSoonOverlay)}
                      />
                    </div>
                  </div>

                  {/* 演示账号快速切换 */}
                  <div className={card + ' p-5'}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={`mt-0.5 ${iconWellCls}`}>
                          <User size={18} strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0">
                          <div className={`text-sm font-light ${primaryTextCls}`}>演示账号快速切换</div>
                          <p className={`mt-1 text-xs leading-relaxed ${weakTextCls}`}>
                            点击即以演示账号身份登录，便于验收不同角色视图。
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={devOptions.demoAccountSwitch}
                        onClick={() => setDevOption('demoAccountSwitch', !devOptions.demoAccountSwitch)}
                        className={switchCls(devOptions.demoAccountSwitch)}
                      />
                    </div>
                    {devOptions.demoAccountSwitch && (
                      <div className="mt-4">
                        {switchMsg && (
                          <div className={`mb-3 text-xs rounded-control px-3 py-2 ${switchMsg.ok ? 'text-[var(--status-success)]' : 'text-[var(--status-danger)]'}`}>
                            {switchMsg.text}
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-2">
                          {DEMO_ACCOUNTS.map((acct) => {
                            const isCurrent = user?.email === acct.email;
                            const isBusy = switchingAccount === acct.email;
                            return (
                              <button
                                key={acct.email}
                                type="button"
                                disabled={isCurrent || !!switchingAccount}
                                onClick={() => handleQuickSwitch(acct.email)}
                                className={`px-3 py-2 rounded-control border text-[11px] font-light transition-colors duration-200 ${
                                  isCurrent
                                    ? 'border-[var(--border-c-strong)] bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]'
                                    : 'border-[var(--border-c-subtle)] text-[var(--text-secondary)] hover:bg-[var(--hover-darken)]'
                                } disabled:opacity-50`}
                              >
                                {isBusy ? '切换中…' : isCurrent ? `${acct.name}（当前）` : acct.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={`${card} p-5 text-[11px] ${weakTextCls}`}>
                    开发者选项入口位于设置页左下角，默认隐藏；关闭开发者模式后，导航栏不再显示本页。
                  </div>
                </div>
              )}

              </motion.div>
            </AnimatePresence>
        </CompiledSplitMainPanel>
      </CompiledSplitWorkspace>
      <AnimatePresence>
        {avatarCrop && (
          <motion.div
            className="absolute inset-0 z-[120] flex items-center justify-center bg-[var(--mask-bg)] px-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className={`${card} relative w-full max-w-md p-5`}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className={`text-sm font-light ${primaryTextCls}`}>调整头像</div>
                  <div className={`mt-1 text-[11px] ${weakTextCls}`}>拖动图片位置，缩放后保存圆形头像。</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAvatarCrop(null)}
                  className={`px-3 ${actionControlCls}`}
                  disabled={avatarLoading}
                >
                  取消
                </button>
              </div>

              <div className="flex flex-col items-center gap-4">
                <div
                  className={`relative h-56 w-56 cursor-grab touch-none select-none overflow-hidden rounded-full border active:cursor-grabbing border-[var(--border-c-subtle)] bg-[var(--recessed-bg)]`}
                  onPointerDown={handleAvatarCropPointerDown}
                  onPointerMove={handleAvatarCropPointerMove}
                  onPointerUp={handleAvatarCropPointerUp}
                  onPointerCancel={handleAvatarCropPointerUp}
                  role="application"
                  aria-label="头像裁切框"
                >
                  <img
                    src={avatarCrop.src}
                    alt=""
                    draggable={false}
                    className="absolute left-1/2 top-1/2 max-w-none select-none"
                    style={{
                      width: `${avatarCrop.naturalWidth * (AVATAR_CROP_PREVIEW_SIZE / Math.min(
                        avatarCrop.rotation % 180 === 0 ? avatarCrop.naturalWidth : avatarCrop.naturalHeight,
                        avatarCrop.rotation % 180 === 0 ? avatarCrop.naturalHeight : avatarCrop.naturalWidth,
                      ))}px`,
                      height: `${avatarCrop.naturalHeight * (AVATAR_CROP_PREVIEW_SIZE / Math.min(
                        avatarCrop.rotation % 180 === 0 ? avatarCrop.naturalWidth : avatarCrop.naturalHeight,
                        avatarCrop.rotation % 180 === 0 ? avatarCrop.naturalHeight : avatarCrop.naturalWidth,
                      ))}px`,
                      transform: `translate(-50%, -50%) translate(${avatarCrop.offset.x}px, ${avatarCrop.offset.y}px) rotate(${avatarCrop.rotation}deg) scale(${avatarCrop.scale})`,
                    }}
                  />
                  <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-[var(--border-c-subtle)]" />
                  <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[var(--border-c-subtle)]" />
                  <div className="pointer-events-none absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-[var(--border-c-subtle)]" />
                </div>

                <div className="w-full space-y-3">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className={labelCls}>缩放</span>
                      <span className={`text-[11px] font-mono text-[var(--text-tertiary)]`}>{avatarCrop.scale.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.01}
                      value={avatarCrop.scale}
                      onChange={event => setAvatarCrop({ ...avatarCrop, scale: Number(event.target.value) })}
                      className={rangeCls}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAvatarCrop({ ...avatarCrop, rotation: (avatarCrop.rotation + 90) % 360 })}
                      className={`flex-1 justify-center px-3 ${actionControlCls} inline-flex items-center gap-2`}
                      disabled={avatarLoading}
                    >
                      <RotateCw size={14} strokeWidth={1.5} />
                      旋转
                    </button>
                    <button
                      type="button"
                      onClick={() => setAvatarCrop({ ...avatarCrop, scale: 1, rotation: 0, offset: { x: 0, y: 0 } })}
                      className={`flex-1 px-3 ${actionControlCls}`}
                      disabled={avatarLoading}
                    >
                      重置
                    </button>
                    <button
                      type="button"
                      onClick={confirmAvatarCrop}
                      className={`flex-1 px-3 ${actionControlCls} ${avatarLoading ? 'opacity-50' : ''}`}
                      disabled={avatarLoading}
                    >
                      {avatarLoading ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Settings;
