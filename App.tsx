import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { View, KnowledgeItem, Order, Email, SystemConfig, Insight, Relation, ProductAsset, ProductSubCategory, MainCategory, Invoice, PaymentVoucher, Shipment, DevelopmentCase } from './types';
import { parseNotificationLink } from './services/crossModuleNav';
import type { OrderViewType } from './lib/orderSchema';

// Global error listeners — DEV only; in production, errors are handled by React ErrorBoundary.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    console.error('[UNCAUGHT ERROR]', e.message, e.error?.stack || '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[UNHANDLED PROMISE REJECTION]', e.reason?.message || e.reason, e.reason?.stack || '');
  });
}

// Diagnostic flag — when true, freeze the global background polls (briefing
// refresh, cloud sync) that cascade setState into the entire App tree.
// Currently disabled — kept for future regression hunts.
const DIAG_FREEZE_DASHBOARD = false;
const ENABLE_WALLPAPER_SWITCHING = false;
const DEV_PREVIEW_CONTINUITY_KEY = 'bambook_dev_preview_continuity';
const AUTH_TOKEN_KEY = 'bambook_auth_token';
export const DESIGN_TUNER_TOGGLE_SHORTCUT = 'mod+shift+t';

const PRODUCT_MAIN_CATEGORIES: MainCategory[] = ['Garment', 'Fabric', 'Accessories', 'Trimmings', 'Merchandise', 'Other'];

// v0.8 未交付模块的装修遮挡清单：页面 → 提示文案（由开发者选项「装修遮挡」开关统一控制显隐）
const COMING_SOON_PAGES: Partial<Record<View, string>> = {
  [View.Dashboard]: '工作台开发中 · 即将上线',
  [View.Assistant]: 'AI 助手开发中 · 即将上线',
  [View.Emails]: '智能邮箱开发中 · 即将上线',
  [View.DataCenter]: '数据中心开发中 · 即将上线',
  [View.Seasons]: '季节性与趋势开发中 · 即将上线',
  [View.Marketing]: '营销推广开发中 · 即将上线',
};
const PRODUCT_MAIN_CATEGORY_ALIASES: Record<string, MainCategory> = {
  garment: 'Garment',
  garments: 'Garment',
  apparel: 'Garment',
  clothing: 'Garment',
  fabric: 'Fabric',
  fabrics: 'Fabric',
  material: 'Fabric',
  materials: 'Fabric',
  accessories: 'Accessories',
  accessory: 'Accessories',
  trims: 'Trimmings',
  trim: 'Trimmings',
  trimming: 'Trimmings',
  trimmings: 'Trimmings',
  merchandise: 'Merchandise',
  merch: 'Merchandise',
  other: 'Other',
};

function readField(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeMainCategory(value: unknown): MainCategory | undefined {
  const raw = normalizeString(value);
  if (!raw) return undefined;
  const direct = PRODUCT_MAIN_CATEGORIES.find(category => category === raw);
  if (direct) return direct;
  return PRODUCT_MAIN_CATEGORY_ALIASES[raw.toLowerCase().replace(/[\s_-]+/g, '')];
}

function normalizeProductSubCategory(row: ProductSubCategory): ProductSubCategory {
  const source = row as unknown as Record<string, unknown>;
  return {
    ...row,
    id: normalizeString(readField(source, ['id', 'categoryId', 'category_id'])) ?? row.id,
    mainCategory: normalizeMainCategory(readField(source, ['mainCategory', 'main_category', 'mainCategoryId', 'main_category_id', 'category', 'categoryName', 'category_name'])) ?? row.mainCategory ?? 'Other',
    name: normalizeString(readField(source, ['name', 'label', 'title'])) ?? row.name,
    description: normalizeString(readField(source, ['description', 'desc'])) ?? row.description,
    updatedAt: Number(readField(source, ['updatedAt', 'updated_at'])) || row.updatedAt || Date.now(),
    deletedAt: Number(readField(source, ['deletedAt', 'deleted_at'])) || row.deletedAt,
  };
}

function normalizeProductSubCategories(rows: ProductSubCategory[] = []): ProductSubCategory[] {
  return rows.map(normalizeProductSubCategory).filter(category => Boolean(category.id));
}

function normalizeProductAsset(row: ProductAsset, categoryMainById: Map<string, MainCategory>): ProductAsset {
  const source = row as unknown as Record<string, unknown>;
  const subCategoryId = normalizeString(readField(source, ['subCategoryId', 'sub_category_id', 'subCategory', 'sub_category', 'categoryId', 'category_id'])) ?? row.subCategoryId;
  const directMainCategory = normalizeMainCategory(readField(source, ['mainCategory', 'main_category', 'mainCategoryId', 'main_category_id', 'productCategory', 'product_category', 'category', 'categoryName', 'category_name']));
  const profileMainCategory =
    readField(source, ['garmentProfile', 'garment_profile']) ? 'Garment' :
    readField(source, ['trimmingProfile', 'trimming_profile']) ? 'Trimmings' :
    readField(source, ['fabricProfile', 'fabric_profile']) ? 'Fabric' :
    undefined;

  return {
    ...row,
    mainCategory: directMainCategory ?? (subCategoryId ? categoryMainById.get(subCategoryId) : undefined) ?? profileMainCategory ?? row.mainCategory ?? 'Fabric',
    subCategoryId,
    updatedAt: Number(readField(source, ['updatedAt', 'updated_at'])) || row.updatedAt || Date.now(),
    deletedAt: Number(readField(source, ['deletedAt', 'deleted_at'])) || row.deletedAt,
    fabricProfile: (readField(source, ['fabricProfile', 'fabric_profile']) as ProductAsset['fabricProfile']) ?? row.fabricProfile,
    garmentProfile: (readField(source, ['garmentProfile', 'garment_profile']) as ProductAsset['garmentProfile']) ?? row.garmentProfile,
    trimmingProfile: (readField(source, ['trimmingProfile', 'trimming_profile']) as ProductAsset['trimmingProfile']) ?? row.trimmingProfile,
  };
}

function normalizeProductAssets(rows: ProductAsset[] = [], categories: ProductSubCategory[] = []): ProductAsset[] {
  const normalizedCategories = normalizeProductSubCategories(categories);
  const categoryMainById = new Map(normalizedCategories.map(category => [category.id, category.mainCategory]));
  return rows.map(row => normalizeProductAsset(row, categoryMainById)).filter(product => Boolean(product.id));
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

import { storageService } from './services/storageService';
import { apiService } from './services/apiService';
import { dataHubService, DataHubMode, DataHubSnapshot } from './services/dataHubService';
import { llmService } from './services/llmService';
import { deleteOrder } from './services/importService';
import { subscribe, checkAuth, getAuthState, canAccessView, AuthState } from './services/authService';
import { getDevOptions, subscribe as subscribeDevOptions, type DevOptions } from './services/devOptionsService';
import { resolveInitialDarkMode } from './appTheme';
import type { StoredThemePreference } from './appTheme';
import { resolvePublicAssetUrl } from './utils/publicAssets';
import {
  applyWallpaperAccentPaletteToElement,
  defaultWallpaperAccentPalette,
  getCachedWallpaperAccentPalette,
  preloadWallpaperAccentPalettes,
  resolveWallpaperAccentPalette,
  type WallpaperAccentPalette,
} from './utils/wallpaperAccent';
import Sidebar from './components/Sidebar';
import { ComingSoonOverlay } from './components/ui/ComingSoonOverlay';
import { NotificationCenter } from './components/NotificationCenter';

import Dashboard from './components/Dashboard';
import CockpitManager from './components/CockpitManager';
import Assistant, { assistantRuntimeStore, type AssistantRuntimeSnapshot } from './components/Assistant';
import DataCenter from './components/DataCenter';
import OrderManager, { savedRowToOrder } from './components/OrderManager';
import CommandPalette from './components/CommandPalette';
import EmailManager from './components/EmailManager';
import Settings, { WALLPAPER_PRESETS } from './components/Settings';
import RelationsManager from './components/RelationsManager';
import ProductsManager, {
  parseProductModuleSortValue,
  persistProductModuleSettings,
  ProductModuleSettingsWorkspace,
  readInitialProductModuleSettings,
  type UiLabProductModuleSettings,
} from './components/ProductsManager';
import { BAMBOOK_OS } from './components/ui/bambookOsTokens';
import { OS_MATERIAL } from './components/ui/osMaterial';
import DevelopmentManager from './components/DevelopmentManager';
import FinanceManager, { type FinanceTabId, primeFinanceInvoiceFocus } from './components/FinanceManager';
import ReportCenter from './components/ReportCenter';
import ShipmentManager from './components/ShipmentManager';
import QuotationManager from './components/QuotationManager';
import ProcurementManager from './components/ProcurementManager';
import InventoryManager from './components/InventoryManager';
import BomManager from './components/BomManager';
import CrmManager from './components/CrmManager';
import SuppliersManager from './components/SuppliersManager';
import SeasonsManager from './components/SeasonsManager';
import RisksManager from './components/RisksManager';
import QcWorkbenchManager from './components/QcWorkbenchManager';
import PricingManager, { type PricingTabId } from './components/PricingManager';
import MarketingManager from './components/MarketingManager';
import MesManager from './components/MesManager';
import CustomsManager, { type CustomsTabId } from './components/CustomsManager';
import DocumentCenter, { primeDocumentCenterFocus } from './components/DocumentCenter';
import ProductionBoard from './components/ProductionBoard';
import type { GlobeQualityMode, GlobeViewportCenter } from './components/ProductionGlobe';
import {
  requestOsAdaptiveContrastRefresh,
  createOsAdaptiveDebouncer,
  isOsAdaptiveMutationRelevant,
  computeResponsiveUiLabScale,
  applyCollapsedSidebarContrast
} from './components/ui/osAdaptiveContrast';
import { resolveSettingsMode } from './components/moduleRegistry';
type GlobeRendererMode = 'maplibre' | 'three';

function readInitialGlobeRendererFromUrl(): GlobeRendererMode {
  if (typeof window === 'undefined') return 'maplibre';
  try {
    const value = new URLSearchParams(window.location.search).get('globeRenderer');
    return value === 'three' ? 'three' : 'maplibre';
  } catch {
    return 'maplibre';
  }
}

// Prewarm only the selected globe runtime under the transparent splash logo.
// The old Three renderer remains available as a fallback and via
// ?globeRenderer=three, but the default path no longer downloads its assets.
const initialGlobeRenderer = readInitialGlobeRendererFromUrl();
const productionGlobeImport = initialGlobeRenderer === 'three'
  ? import('./components/ProductionGlobe')
  : null;
productionGlobeImport?.then(module => module.preloadProductionGlobeAssets()).catch(() => {});
const mapLibreProductionGlobeImport = initialGlobeRenderer === 'maplibre'
  ? import('./components/MapLibreProductionGlobe')
  : null;
const ProductionGlobe = lazy(() => productionGlobeImport ?? import('./components/ProductionGlobe'));
const MapLibreProductionGlobe = lazy(() => mapLibreProductionGlobeImport ?? import('./components/MapLibreProductionGlobe'));
import SplashScreen, { SPLASH_MIN_VISIBLE_MS } from './components/SplashScreen';
import Login from './components/Login';
import Register from './components/Register';
import AdminPanel from './components/AdminPanel';
import HRManager from './components/HRManager';
import BusinessTools from './components/BusinessTools';
import DesignTuner from './components/dev/DesignTuner';
import WindowControls from './components/WindowControls';
import {
  ShieldCheck,
  ShieldAlert,
  Database,
  Lock,
  Activity,
  ArrowUpDown,
  Zap,
  Globe,
  Users,
  Shirt,
  Settings2
} from 'lucide-react';

/**
 * MainContentShell — main 内容区的条件容器。
 * isFullBleedView 时返回 Fragment（不生成多余 DOM 层，页面组件直接作为
 * app-main-viewport 子元素，消除"双层 flex 容器"冲突）；
 * 非 isFullBleedView 时返回 glass-panel div（包裹页面内容，提供磨砂面板背景）。
 */
const MainContentShell: React.FC<{
  isFullBleedView: boolean;
  isEmails: boolean;
  isGlobeUnderlay: boolean;
  children: React.ReactNode;
}> = ({ isFullBleedView, isEmails, isGlobeUnderlay, children }) => {
  if (isFullBleedView) return <>{children}</>;
  const pointerEvents = isGlobeUnderlay ? 'pointer-events-none' : 'pointer-events-auto';
  if (isEmails) {
    return <div className={`glass-panel flex-1 h-full overflow-hidden flex flex-col ${pointerEvents}`}>{children}</div>;
  }
  return <div className={`glass-panel min-h-full p-8 transition-all duration-300 ${pointerEvents}`}>{children}</div>;
};

type AgentOsActivitySnapshot = {
  active: boolean;
  source?: 'assistant' | 'pet-preview' | 'system';
  label?: string;
  detail?: string;
};

type AgentPetRendererErrorNotice = {
  message: string;
  source?: string;
};

/** Read optional `?globeQuality=high|medium|low|auto&globeRenderer=maplibre|three` once at boot. */
function readGlobeParamsFromUrl(): { quality: GlobeQualityMode; renderer: GlobeRendererMode } {
  if (typeof window === 'undefined') return { quality: 'auto', renderer: initialGlobeRenderer };
  try {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get('globeQuality');
    const r = sp.get('globeRenderer');
    const quality: GlobeQualityMode =
      q === 'high' || q === 'medium' || q === 'low' || q === 'auto' ? q : 'auto';
    const renderer: GlobeRendererMode = r === 'three' ? 'three' : 'maplibre';
    return { quality, renderer };
  } catch {
    return { quality: 'auto', renderer: initialGlobeRenderer };
  }
}

function shouldUseDevPreviewContinuity(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try {
    const hasReloadMarker = sessionStorage.getItem(DEV_PREVIEW_CONTINUITY_KEY) === '1';
    const hasAuthToken = Boolean(localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY));
    return hasReloadMarker && hasAuthToken;
  } catch {
    return false;
  }
}

const App: React.FC = () => {
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const mainViewportRef = useRef<HTMLDivElement | null>(null);
  // Restore UI state from localStorage on init
  const [uiState] = useState(() => storageService.getUIState());
  const [authState, setAuthState] = useState<AuthState>(() => {
    const storedAuthState = getAuthState();
    if (shouldUseDevPreviewContinuity() && storedAuthState.user) {
      return { ...storedAuthState, isLoading: false, isAuthenticated: true };
    }
    return storedAuthState;
  });
  const authStateRef = useRef(authState);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [globeParams] = useState(readGlobeParamsFromUrl);
  const [appScale, setAppScale] = useState(() =>
    typeof window === 'undefined'
      ? 1
      : computeResponsiveUiLabScale(
          window.innerWidth || document.documentElement.clientWidth,
          window.innerHeight || document.documentElement.clientHeight,
        ),
  );
  const [currentView, setCurrentView] = useState<View>(() => {
    const saved = uiState.currentView;
    if (saved === View.UiLab) return View.Dashboard;
    if (saved && Object.values(View).includes(saved as View)) return saved as View;
    return View.Dashboard;
  });
  const [isLoading, setIsLoading] = useState(() => !uiState.hasVisited && !shouldUseDevPreviewContinuity());
  const [mapLibreGlobeUnavailable, setMapLibreGlobeUnavailable] = useState(false);
  const [globeViewportCenter, setGlobeViewportCenter] = useState<GlobeViewportCenter | null>(null);
  const [assistantRuntimeSnapshot, setAssistantRuntimeSnapshot] = useState<AssistantRuntimeSnapshot>(() => assistantRuntimeStore.getSnapshot());
  const [agentPreviewActivity, setAgentPreviewActivity] = useState<AgentOsActivitySnapshot>({
    active: false,
    source: 'system',
    label: 'Agent OS 待命',
  });
  const [agentPetRendererError, setAgentPetRendererError] = useState<AgentPetRendererErrorNotice | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => uiState.sidebarCollapsed);
  const [showDesignTuner, setShowDesignTuner] = useState(false);
  const [config, setConfig] = useState<SystemConfig>(apiService.getStoredConfig());
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [products, setProducts] = useState<ProductAsset[]>([]);
  const [productCategories, setProductCategories] = useState<ProductSubCategory[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentVouchers, setPaymentVouchers] = useState<PaymentVoucher[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [developmentCases, setDevelopmentCases] = useState<DevelopmentCase[]>([]);
  const [productModuleSettings, setProductModuleSettings] = useState<UiLabProductModuleSettings>(readInitialProductModuleSettings);
  const [isProductModuleSettingsWorkspaceOpen, setIsProductModuleSettingsWorkspaceOpen] = useState(false);
  const [ordersReady, setOrdersReady] = useState(false);
  const [relationsReady, setRelationsReady] = useState(false);
  const [isCloudConnected, setIsCloudConnected] = useState(false);
  const [dataHubMode, setDataHubMode] = useState<DataHubMode>('offline');
  const [isSyncing, setIsSyncing] = useState(false);
  const [briefing, setBriefing] = useState<string>('');
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'pushing' | 'pulling' | 'repairing' | 'blocked'>('idle');
  const [orderViewMode, setOrderViewMode] = useState<'globe' | 'list'>(() => uiState.orderViewMode);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // D1 全局工作台：命令面板开关（Cmd/Ctrl+K）
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 开发者选项（装修遮挡等），跨页面共享、实时响应设置页开关
  const [devOptions, setDevOptions] = useState<DevOptions>(() => getDevOptions());
  useEffect(() => subscribeDevOptions(setDevOptions), []);
  const [orderFullscreenOpen, setOrderFullscreenOpen] = useState(false);
  const [renderGlobe, setRenderGlobe] = useState(false);
  const [orderType, setOrderType] = useState<OrderViewType>('fabric'); // All/Fabric/Garment/Other 切换
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('theme_preference') as StoredThemePreference;
    return resolveInitialDarkMode(
      config.themeMode,
      stored === 'dark' || stored === 'light' ? stored : null,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
  });

  const [lastBriefingGen, setLastBriefingGen] = useState(0);

  const lastWriteTimeRef = useRef<number>(0);
  const syncStatusRef = useRef<'idle' | 'pushing' | 'pulling' | 'repairing' | 'blocked'>('idle');
  const isProductionGlobeEnabled = config.enableProductionGlobe !== false;
  const productModuleRuntimeSettings = React.useMemo(() => ({
    defaultListDisplayMode: productModuleSettings.defaultListDisplayMode,
    defaultTableSort: parseProductModuleSortValue(productModuleSettings.defaultSortValue),
    statusOptions: productModuleSettings.statusOptions,
    requiredFieldIds: productModuleSettings.requiredFieldIds,
    visibleTableColumnIds: productModuleSettings.visibleTableColumnIds,
  }), [productModuleSettings]);
  const handleUpdateProductModuleSettings = useCallback((nextSettings: UiLabProductModuleSettings) => {
    setProductModuleSettings(nextSettings);
    persistProductModuleSettings(nextSettings);
  }, []);

  useEffect(() => assistantRuntimeStore.subscribe(setAssistantRuntimeSnapshot), []);

  useEffect(() => {
    const ipc = window.bambookAgent;
    const unsubscribe = ipc?.onActivity((snapshot) => {
      if (snapshot.source !== 'pet-preview') return;
      setAgentPreviewActivity(previous => (
        previous.active === snapshot.active &&
        previous.label === snapshot.label &&
        previous.detail === snapshot.detail
          ? previous
          : snapshot
      ));
    });

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('bambook-agent-os');
      channel.onmessage = (event) => {
        const snapshot = event.data?.snapshot as AgentOsActivitySnapshot | undefined;
        if (snapshot?.source !== 'pet-preview') return;
        setAgentPreviewActivity(previous => (
          previous.active === snapshot.active &&
          previous.label === snapshot.label &&
          previous.detail === snapshot.detail
            ? previous
            : snapshot
        ));
      };
    }

    return () => {
      unsubscribe?.();
      channel?.close();
    };
  }, []);

  useEffect(() => {
    return window.bambookAgent?.onFocusView?.((view) => {
      setCurrentView(view === 'assistant' ? View.Assistant : View.SystemSettings);
    });
  }, []);

  useEffect(() => (
    window.bambookAgent?.onPetRendererError?.((payload) => {
      setAgentPetRendererError({
        message: payload.message || 'Agent 浮窗渲染错误',
        source: payload.source,
      });
    })
  ), []);

  const isAgentOsActive = assistantRuntimeSnapshot.isLoading || agentPreviewActivity.active;
  const agentOsStatus = React.useMemo<AgentOsActivitySnapshot>(() => {
    if (assistantRuntimeSnapshot.isLoading) {
      const latestStep = assistantRuntimeSnapshot.thinkingLogs.at(-1);
      return {
        active: true,
        source: 'assistant',
        label: latestStep || 'Bambook Agent 正在工作',
        detail: latestStep ? '实时任务状态来自 Assistant Runtime' : '正在连接企业智能核心',
      };
    }
    return {
      active: agentPreviewActivity.active,
      source: agentPreviewActivity.source || 'pet-preview',
      label: agentPreviewActivity.label || (agentPreviewActivity.active ? 'Agent OS 演示运行中' : 'Agent OS 待命'),
      detail: agentPreviewActivity.detail,
    };
  }, [agentPreviewActivity, assistantRuntimeSnapshot.isLoading, assistantRuntimeSnapshot.thinkingLogs]);

  useEffect(() => {
    void window.bambookAgent?.publishActivity(agentOsStatus).catch(() => undefined);
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('bambook-agent-os');
    channel.postMessage({ type: 'agent-activity', snapshot: agentOsStatus });
    channel.close();
  }, [agentOsStatus]);

  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  useEffect(() => {
    if (currentView !== View.Products) {
      setIsProductModuleSettingsWorkspaceOpen(false);
    }
  }, [currentView]);

  useEffect(() => {
    if (!authState.isAuthenticated) return;
    if (!canAccessView(currentView)) {
      setCurrentView(View.Dashboard);
    }
  }, [
    authState.isAuthenticated,
    authState.user?.roles.join('|'),
    authState.user?.permissions.join('|'),
    currentView,
  ]);

  const updateSyncStatus = useCallback((status: 'idle' | 'pushing' | 'pulling' | 'repairing' | 'blocked') => {
    syncStatusRef.current = status;
    setSyncStatus(status);
  }, []);

  const applyDataHubSnapshot = useCallback((snapshot: DataHubSnapshot) => {
    const filterActive = <T extends { deletedAt?: number | null }>(rows: readonly T[]): T[] =>
      rows.filter(row => !row.deletedAt);
    setOrders(previous => {
      const incoming = filterActive(snapshot.orders);
      const next = incoming.length === 0 && previous.length > 0 ? previous : incoming;
      void storageService.saveCachedOrders(next);
      return next;
    });
    setKnowledge(snapshot.knowledge);
    setInsights(snapshot.insights);
    setRelations(previous => {
      const incoming = filterActive(snapshot.relations);
      const next = incoming.length === 0 && previous.length > 0 ? previous : incoming;
      void storageService.saveCachedRelations(next);
      return next;
    });
    setProducts(previous => {
      const normalizedProducts = filterActive(normalizeProductAssets(snapshot.products, snapshot.productCategories));
      const next = normalizedProducts.length === 0 && previous.length > 0 ? previous : normalizedProducts;
      void storageService.saveCachedProducts(next);
      return next;
    });
    setProductCategories(previous => {
      const normalizedCategories = filterActive(normalizeProductSubCategories(snapshot.productCategories));
      const next = normalizedCategories.length === 0 && previous.length > 0 ? previous : normalizedCategories;
      void storageService.saveCachedProductCategories(next);
      return next;
    });
    setInvoices(previous => {
      const incoming = filterActive(snapshot.invoices);
      const next = incoming.length === 0 && previous.length > 0 ? previous : incoming;
      void storageService.saveCachedInvoices(next);
      return next;
    });
    setPaymentVouchers(previous => {
      const incoming = filterActive(snapshot.paymentVouchers);
      const next = incoming.length === 0 && previous.length > 0 ? previous : incoming;
      void storageService.saveCachedPaymentVouchers(next);
      return next;
    });
    setShipments(previous => {
      const incoming = filterActive(snapshot.shipments);
      const next = incoming.length === 0 && previous.length > 0 ? previous : incoming;
      void storageService.saveCachedShipments(next);
      return next;
    });
    setDevelopmentCases(previous => {
      const incoming = filterActive(snapshot.developmentCases);
      const next = incoming.length === 0 && previous.length > 0 ? previous : incoming;
      void storageService.saveCachedDevelopmentCases(next);
      return next;
    });
  }, []);

  const instantPush = useCallback(async (path: string, data: any) => {
    if (!config.cloudEndpoint) return;
    updateSyncStatus('pushing');
    lastWriteTimeRef.current = Date.now();
    try {
      const ok = await dataHubService.pushLegacyData(path, config.cloudEndpoint, data);
      if (!ok) throw new Error(`${path} write returned non-OK response`);
    } catch (e) {
      console.warn(`[UPSTREAM] 广播失败: ${path}`, e);
    } finally {
      updateSyncStatus('idle');
    }
  }, [config.cloudEndpoint, updateSyncStatus]);

  const syncFromCloud = useCallback(async (endpoint: string) => {
    if (!endpoint || syncStatusRef.current === 'pushing' || (Date.now() - lastWriteTimeRef.current < 20000)) return;

    setIsSyncing(true);
    updateSyncStatus('pulling');
    setDataHubMode('syncing');

    try {
      const snapshot = await dataHubService.pullSnapshot(endpoint);
      applyDataHubSnapshot(snapshot);
      setDataHubMode('online');
    } catch (e) {
      console.warn("[DataHub] silent sync failed:", e);
      setDataHubMode('degraded');
    } finally {
      setIsSyncing(false);
      updateSyncStatus('idle');
    }
  }, [applyDataHubSnapshot, updateSyncStatus]);

  const checkConnection = useCallback(async () => {
    const activeConfig = apiService.getStoredConfig();
    if (!activeConfig?.cloudEndpoint) return;
    try {
      const result = await apiService.testConnection(activeConfig.cloudEndpoint);
      setIsCloudConnected(result.ok);
      setDataHubMode(result.ok ? 'online' : 'degraded');
      if (result.ok) await syncFromCloud(activeConfig.cloudEndpoint);
    } catch (err) {
      setIsCloudConnected(false);
      setDataHubMode('degraded');
    }
  }, [syncFromCloud]);

  useEffect(() => {
    if (DIAG_FREEZE_DASHBOARD) return;
    const stop = dataHubService.subscribe(config.cloudEndpoint, () => syncFromCloud(config.cloudEndpoint));
    return stop;
  }, [config.cloudEndpoint, syncFromCloud]);

  useEffect(() => {
    const activeView = authState.isAuthenticated && !canAccessView(currentView) ? View.Dashboard : currentView;
    const isGlobeUnderlayLocal = isProductionGlobeEnabled && (activeView === View.Dashboard || (activeView === View.Orders && orderViewMode === 'globe'));
    if (isGlobeUnderlayLocal) {
      const timer = setTimeout(() => {
        setRenderGlobe(true);
      }, 340);
      return () => clearTimeout(timer);
    } else {
      setRenderGlobe(false);
    }
  }, [authState.isAuthenticated, currentView, isProductionGlobeEnabled, orderViewMode]);

  useEffect(() => {
    if (!isProductionGlobeEnabled && orderViewMode === 'globe') {
      setOrderViewMode('list');
    }
  }, [isProductionGlobeEnabled, orderViewMode]);

  const generateSmartBriefing = useCallback(async (force = false) => {
    const now = Date.now();
    // Cooldown: Don't regenerate if less than 10 seconds have passed, unless forced long-interval check
    if (!force && (now - lastBriefingGen < 10000)) return;

    // 2-hour auto-refresh check is handled by the interval effect, this function is usually for events.
    // If called via event, we allow it (with 10s debounce above).

    setIsBriefingLoading(true);
    try {
      const summary = await llmService.getExecutiveSummary(orders, emails, knowledge, insights);
      setBriefing(summary);
      setLastBriefingGen(now);
    } catch (e) {
      console.error("Failed to generate briefing", e);
    } finally {
      setIsBriefingLoading(false);
    }
  }, [orders, emails, knowledge, insights, lastBriefingGen]);

  // Exportable manual refresh wrapper
  const handleManualRefresh = () => generateSmartBriefing(true);

  // Briefing Auto-Gen Interval (2 Hours) & Init
  useEffect(() => {
    // Initial generation if empty
    if (!briefing && orders.length > 0) {
      generateSmartBriefing(true);
    }

    if (DIAG_FREEZE_DASHBOARD) return;
    const timer = setInterval(() => {
      generateSmartBriefing(true);
    }, 60 * 1000); // 1 minute refresh for extreme dynamism

    return () => clearInterval(timer);
  }, [generateSmartBriefing, briefing, orders.length]);

  // Splash Screen Timer (only for first-time visitors)
  useEffect(() => {
    if (uiState.hasVisited) {
      setIsLoading(false);
    } else {
      const timer = setTimeout(() => {
        setIsLoading(false);
        storageService.saveUIState({ hasVisited: true });
      }, SPLASH_MIN_VISIBLE_MS);
      return () => clearTimeout(timer);
    }
  }, []);

  // Auth check on mount and subscribe to changes
  useEffect(() => {
    const keepCurrentPreview = shouldUseDevPreviewContinuity();
    const unsub = subscribe((next) => {
      if (keepCurrentPreview && next.isLoading && authStateRef.current.isAuthenticated && authStateRef.current.user) return;
      setAuthState(next);
    });
    checkAuth();
    return unsub;
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    const markPreviewContinuity = () => {
      try {
        sessionStorage.setItem(DEV_PREVIEW_CONTINUITY_KEY, '1');
      } catch {
        // Best-effort dev-only continuity marker.
      }
    };
    window.addEventListener('beforeunload', markPreviewContinuity);
    return () => window.removeEventListener('beforeunload', markPreviewContinuity);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    const handleDesignTunerShortcut = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) return;
      if (!event.shiftKey || event.key.toLowerCase() !== 't') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setShowDesignTuner((current) => !current);
    };
    window.addEventListener('keydown', handleDesignTunerShortcut);
    return () => window.removeEventListener('keydown', handleDesignTunerShortcut);
  }, []);

  // D1 全局工作台：Cmd/Ctrl+K 唤起命令面板（输入框内也可用，与 OS 全局搜索惯例一致）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePaletteShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setPaletteOpen((current) => !current);
    };
    window.addEventListener('keydown', handlePaletteShortcut);
    return () => window.removeEventListener('keydown', handlePaletteShortcut);
  }, []);

  useEffect(() => {
    setOrdersReady(false);
    setKnowledge([]);
    setEmails(storageService.getEmails());
    setInsights([]);
    setRelationsReady(false);
    storageService.getCachedOrders()
      .then(cachedOrders => {
        if (cachedOrders.length > 0) {
          setOrders(cachedOrders.filter(order => !order.deletedAt));
          setOrdersReady(true);
        }
      })
      .catch(() => {});
    storageService.getCachedRelations()
      .then(cachedRelations => {
        if (cachedRelations.length > 0) {
          setRelations(cachedRelations.filter(relation => !relation.deletedAt));
          setRelationsReady(true);
        }
      })
      .catch(() => {});
    storageService.getCachedProducts()
      .then(cachedProducts => {
        const normalizedProducts = normalizeProductAssets(cachedProducts);
        if (normalizedProducts.length > 0) setProducts(normalizedProducts.filter(product => !product.deletedAt));
      })
      .catch(() => {});
    storageService.getCachedProductCategories()
      .then(cachedCategories => {
        const normalizedCategories = normalizeProductSubCategories(cachedCategories);
        if (normalizedCategories.length > 0) setProductCategories(normalizedCategories.filter(category => !category.deletedAt));
      })
      .catch(() => {});
    storageService.getCachedInvoices()
      .then(cachedInvoices => {
        if (cachedInvoices.length > 0) setInvoices(cachedInvoices.filter(inv => !inv.deletedAt));
      })
      .catch(() => {});
    storageService.getCachedPaymentVouchers()
      .then(cachedVouchers => {
        if (cachedVouchers.length > 0) setPaymentVouchers(cachedVouchers.filter(v => !v.deletedAt));
      })
      .catch(() => {});
    storageService.getCachedShipments()
      .then(cachedShipments => {
        if (cachedShipments.length > 0) setShipments(cachedShipments.filter(s => !s.deletedAt));
      })
      .catch(() => {});
    storageService.getCachedDevelopmentCases()
      .then(cachedCases => {
        if (cachedCases.length > 0) setDevelopmentCases(cachedCases.filter(c => !c.deletedAt));
      })
      .catch(() => {});
    checkConnection();

    // 关系智库数据源：Mac mini/Postgres API only.
    dataHubService.loadRelations(config.cloudEndpoint).then(localRelations => {
      const activeRelations = localRelations.filter((r: any) => !r.deletedAt);
      setRelations(activeRelations);
      void storageService.saveCachedRelations(activeRelations);
      setRelationsReady(true);
    }).catch((err: any) => {
      console.warn('[Relations] data hub load failed:', err?.message ?? err);
      setRelationsReady(true);
    });

    // 订单数据源：Mac mini/Postgres API only.
    dataHubService.loadOrders(config.cloudEndpoint)
      .then((rows: any[]) => {
        // 后端 /api/v1/orders 返回的是数据库行格式（SavedOrderRow），
        // 需要统一转换成前端 Order 格式再存。
        const converted = rows.map((r: any) => {
          // 如果已经有 customer 字段且没有 poNumber，说明已经是老格式 Order
          if (r.customer && !r.poNumber) return r as Order;
          try { return savedRowToOrder(r); } catch { return r as Order; }
        });
        const activeOrders = converted.filter((o: any) => !o.deletedAt);
        setOrders(activeOrders);
        void storageService.saveCachedOrders(activeOrders);
        setOrdersReady(true);
        console.log(`[Orders] Loaded ${rows.length} orders from Bambook data hub`);
      })
      .catch((err: any) => {
        console.log('[Orders] data hub load failed:', err?.message ?? err);
        setOrdersReady(true);
      });

    if (DIAG_FREEZE_DASHBOARD) return;
    const timer = window.setInterval(() => {
      const activeConfig = apiService.getStoredConfig();
      if (activeConfig?.cloudEndpoint) syncFromCloud(activeConfig.cloudEndpoint);
    }, (config.syncInterval || 15) * 1000);

    return () => window.clearInterval(timer);
  }, [config.cloudEndpoint, config.syncInterval, syncFromCloud]);

  // Follow device theme automatically only when appearance is set to system.
  useEffect(() => {
    if (config.themeMode === 'dark') {
      setIsDarkMode(true);
      return;
    }
    if (config.themeMode === 'light') {
      setIsDarkMode(false);
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [config.themeMode]);

  // Persist theme changes（「跟随系统」时不写入 theme_preference，避免覆盖系统同步）
  useLayoutEffect(() => {
    if (isDarkMode !== undefined) {
      if (config.themeMode !== 'system') {
        localStorage.setItem('theme_preference', isDarkMode ? 'dark' : 'light');
      } else {
        localStorage.removeItem('theme_preference');
      }
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      // BDS v2：同步 data-theme 属性（v2 token 暗色覆盖的标准入口，
      // 与 .dark class 双写并存，组件层对主题机制透明）
      document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
      requestOsAdaptiveContrastRefresh();
    }
  }, [isDarkMode, config.themeMode]);

  useEffect(() => {
    requestOsAdaptiveContrastRefresh();
  }, [ENABLE_WALLPAPER_SWITCHING ? config.backgroundImage : '']);

  useLayoutEffect(() => {
    const root = appRootRef.current;
    if (!root) return undefined;

    let disposed = false;
    let readyImage: HTMLImageElement | null = null;
    const wallpaperUrl = ENABLE_WALLPAPER_SWITCHING && config.backgroundImage ? resolvePublicAssetUrl(config.backgroundImage) : '';
    // 优化 #4：跨帧 debounce —— burst 时只跑一次（leading + 96ms trailing），
    // 避免 MutationObserver / resize 风暴重复触发整页 reapply。
    const debouncer = createOsAdaptiveDebouncer(() => {
      if (!disposed) applyCollapsedSidebarContrast(root, readyImage, isDarkMode, wallpaperUrl);
    });

    const scheduleWithCurrentImage = () => debouncer.schedule();
    window.addEventListener('resize', scheduleWithCurrentImage, { passive: true });
    window.addEventListener('bambook:os-adaptive-contrast-refresh', scheduleWithCurrentImage);

    // 优化 #4：MutationObserver 过滤 —— 列表 row 的 aria-* 翻转、远离 contrast 元素的 class 变化全部跳过。
    const mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver((mutations) => {
          if (isOsAdaptiveMutationRelevant(mutations)) debouncer.schedule();
        })
      : null;
    mutationObserver?.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'data-ui-lab-wallpaper-contrast', 'data-os-adaptive-container', 'data-os-adaptive-contrast', 'aria-selected', 'aria-pressed', 'data-state'],
      childList: true,
      subtree: true,
    });

    if (wallpaperUrl) {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        readyImage = image;
        debouncer.schedule();
      };
      image.onerror = () => debouncer.schedule();
      image.src = wallpaperUrl;
      debouncer.schedule();
      if (image.complete && image.naturalWidth) {
        readyImage = image;
        debouncer.schedule();
      }
    } else {
      debouncer.schedule();
    }

    return () => {
      disposed = true;
      debouncer.cancel();
      window.removeEventListener('resize', scheduleWithCurrentImage);
      window.removeEventListener('bambook:os-adaptive-contrast-refresh', scheduleWithCurrentImage);
      mutationObserver?.disconnect();
    };
  }, [ENABLE_WALLPAPER_SWITCHING ? config.backgroundImage : '', isDarkMode]);
  // 优化 #2：不再依赖 isCollapsed —— sidebar 折叠状态变化会改 class，已被 MutationObserver 自动捕获。

  // Persist UI state changes to localStorage
  useEffect(() => {
    storageService.saveUIState({ currentView });
  }, [currentView]);

  useEffect(() => {
    storageService.saveUIState({ sidebarCollapsed: isCollapsed });
    requestOsAdaptiveContrastRefresh();
    const t1 = setTimeout(requestOsAdaptiveContrastRefresh, 100);
    const t2 = setTimeout(requestOsAdaptiveContrastRefresh, 250);
    const t3 = setTimeout(requestOsAdaptiveContrastRefresh, 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isCollapsed]);

  useEffect(() => {
    storageService.saveUIState({ orderViewMode });
  }, [orderViewMode]);

  useEffect(() => {
    const handleResize = () => {
      setAppScale(computeResponsiveUiLabScale(
        window.innerWidth || document.documentElement.clientWidth,
        window.innerHeight || document.documentElement.clientHeight,
      ));
    };

    handleResize();
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-collapse sidebar based on window width for responsive desktop experience
  useEffect(() => {
    // Note: isMobile is hardcoded false now, but this logic is for Desktop resizing.
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 1300) {
        setIsCollapsed(true);
      } else {
        setIsCollapsed(false);
      }
    };

    // Initial check
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleUpdateOrders = (newOrders: Order[], modified?: Order) => {
    setOrders(newOrders.filter(o => !o.deletedAt));
    if (modified?.deletedAt) {
      deleteOrder(modified.id).catch((err: any) => {
        console.warn('[Orders] delete failed:', err?.message ?? err);
      });
    }
    // Trigger Briefing Update on significant order changes
    if (modified || newOrders.length !== orders.length) generateSmartBriefing(false);
  };

  const handleUpdateKnowledge = (newK: KnowledgeItem[], addedOrModified?: KnowledgeItem) => {
    setKnowledge(newK.filter(k => !k.deletedAt));
    if (addedOrModified) instantPush('/api/knowledge', addedOrModified);
    generateSmartBriefing(false); // New knowledge is always "important"
  };

  const handleUpdateInsights = (newI: Insight[], modified?: Insight) => {
    setInsights(newI.filter(i => !i.deletedAt));
    if (modified) instantPush('/api/insights', modified);
    generateSmartBriefing(false);
  };

  // [Feature Removed] DevMemory block was here.


  const handleUpdateRelations = (newR: Relation[], _modified?: Relation) => {
    const activeRelations = newR.filter(r => !r.deletedAt);
    setRelations(activeRelations);
    void storageService.saveCachedRelations(activeRelations);
  };

  const handleUpdateProducts = (newP: ProductAsset[], modified?: ProductAsset) => {
    const activeProducts = normalizeProductAssets(newP, productCategories).filter(p => !p.deletedAt);
    setProducts(activeProducts);
    void storageService.saveCachedProducts(activeProducts);
  };

  const handleUpdateProductCategories = (newC: ProductSubCategory[], modified?: ProductSubCategory) => {
    const activeCategories = normalizeProductSubCategories(newC).filter(c => !c.deletedAt);
    setProductCategories(activeCategories);
    void storageService.saveCachedProductCategories(activeCategories);
  };

  const handleUpdateEmails = (newE: Email[]) => {
    setEmails(newE);
    storageService.saveEmails(newE);
    // Note: Emails are usually heavy, so we don't instantPush individual ones
    // unless really needed. They'll be synced in next poll or via IMAP.
  };

  const handleToggleTheme = () => {
    const nextIsDarkMode = !isDarkMode;
    const nextConfig: SystemConfig = {
      ...config,
      themeMode: nextIsDarkMode ? 'dark' : 'light',
    };
    syncWallpaperAccentForConfig(nextConfig, nextIsDarkMode);
    setIsDarkMode(nextIsDarkMode);
    setConfig(nextConfig);
    apiService.saveConfig(nextConfig);
  };

  const activeView = authState.isAuthenticated && !canAccessView(currentView) ? View.Dashboard : currentView;
  const effectiveBackgroundImage = ENABLE_WALLPAPER_SWITCHING ? config.backgroundImage : '';
  const resolvedBackgroundImageUrl = effectiveBackgroundImage ? resolvePublicAssetUrl(effectiveBackgroundImage) : '';
  const isWallpaperMode = Boolean(resolvedBackgroundImageUrl);
  const appearanceMode = isWallpaperMode ? 'wallpaper' : (isDarkMode ? 'dark' : 'light');
  const [wallpaperAccentPalette, setWallpaperAccentPalette] = useState<WallpaperAccentPalette>(() =>
    getCachedWallpaperAccentPalette(ENABLE_WALLPAPER_SWITCHING && config.backgroundImage ? resolvePublicAssetUrl(config.backgroundImage) : '', isDarkMode) ??
    defaultWallpaperAccentPalette(isDarkMode)
  );
  const wallpaperAccentRequestIdRef = useRef(0);

  const commitWallpaperAccentPalette = useCallback((palette: WallpaperAccentPalette) => {
    // 命令式写 CSS 变量（同步、零 React 重渲染），下游所有用了
    // var(--os-vnext-brand-blue*) 的组件下一帧就是新颜色。
    applyWallpaperAccentPaletteToElement(appRootRef.current, palette);
    // setState 用函数式更新 + 浅比较，避免「缓存命中后再被异步采样写一遍
    // 完全相同的值」造成的多余整树重渲染。
    setWallpaperAccentPalette(prev => (
      prev.accent === palette.accent &&
      prev.accentStrong === palette.accentStrong &&
      prev.accentSoft === palette.accentSoft &&
      prev.globeAtmosphere === palette.globeAtmosphere &&
      prev.globeBorder === palette.globeBorder &&
      prev.globeLand === palette.globeLand &&
      prev.globeLandRim === palette.globeLandRim
        ? prev
        : palette
    ));
  }, []);

  useLayoutEffect(() => {
    let cancelled = false;
    const requestId = ++wallpaperAccentRequestIdRef.current;
    const fallback = defaultWallpaperAccentPalette(isDarkMode);
    if (!resolvedBackgroundImageUrl) {
      commitWallpaperAccentPalette(fallback);
      return () => { cancelled = true; };
    }
    commitWallpaperAccentPalette(getCachedWallpaperAccentPalette(resolvedBackgroundImageUrl, isDarkMode) ?? fallback);
    resolveWallpaperAccentPalette(resolvedBackgroundImageUrl, isDarkMode).then(palette => {
      if (cancelled || wallpaperAccentRequestIdRef.current !== requestId) return;
      commitWallpaperAccentPalette(palette);
    });
    return () => { cancelled = true; };
  }, [commitWallpaperAccentPalette, isDarkMode, resolvedBackgroundImageUrl]);

  useEffect(() => {
    if (!ENABLE_WALLPAPER_SWITCHING) return;
    const configuredWallpapers = Array.isArray(config.systemWallpaperOptions) && config.systemWallpaperOptions.length > 0
      ? config.systemWallpaperOptions
      : WALLPAPER_PRESETS;
    preloadWallpaperAccentPalettes([
      resolvedBackgroundImageUrl,
      ...configuredWallpapers.map(option => resolvePublicAssetUrl(option.url)),
    ]);
  }, [config.systemWallpaperOptions, resolvedBackgroundImageUrl]);

  const syncWallpaperAccentForConfig = useCallback((nextConfig: SystemConfig, nextIsDarkMode: boolean) => {
    const requestId = ++wallpaperAccentRequestIdRef.current;
    const nextWallpaperUrl = ENABLE_WALLPAPER_SWITCHING && nextConfig.backgroundImage ? resolvePublicAssetUrl(nextConfig.backgroundImage) : '';
    const immediatePalette = getCachedWallpaperAccentPalette(nextWallpaperUrl, nextIsDarkMode) ??
      defaultWallpaperAccentPalette(nextIsDarkMode);
    commitWallpaperAccentPalette(immediatePalette);
    if (!nextWallpaperUrl) return;
    void resolveWallpaperAccentPalette(nextWallpaperUrl, nextIsDarkMode).then(palette => {
      if (wallpaperAccentRequestIdRef.current !== requestId) return;
      commitWallpaperAccentPalette(palette);
    });
  }, [commitWallpaperAccentPalette]);
  // A5d 报表下钻联动：跳转目标模块并定位模块内 tab（FinanceManager/CustomsManager initialTab）
  const [moduleTabOverrides, setModuleTabOverrides] = useState<Partial<Record<View, string>>>({});
  const handleViewChange = (view: View) => {
    // 常规导航清除下钻落点覆盖（A5d），避免旧 tab 定位残留
    setModuleTabOverrides({});
    // P2-004：侧边栏点击订单模块 = 显式回列表（清详情选中），切走再切回不再困在旧详情
    //（handleOpenOrderById 直达链路在 handleViewChange 之后 setSelectedOrder，不受影响）
    if (view === View.Orders) setSelectedOrder(null);
    setCurrentView(canAccessView(view) ? view : View.Dashboard);
  };
  const handleReportNavigate = (view: View, tab?: string) => {
    setCurrentView(canAccessView(view) ? view : View.Dashboard);
    setModuleTabOverrides(tab ? { [view]: tab } : {});
  };
  // 财务发票 ↔ 单据中心 CI 双向直达（回链跳转：prime 定位目标记录，2026-08-21 唯一真源裁决配套）
  const handleOpenInvoiceById = (invoiceId: string) => {
    primeFinanceInvoiceFocus(invoiceId);
    handleViewChange(View.Invoices);
  };
  const handleOpenTradeDocById = (docId: string) => {
    primeDocumentCenterFocus({ docId });
    handleViewChange(View.DocumentCenter);
  };

  // 阶段 IA-3：报价转订单/开发案转订单后「查看订单」直达 —— 切订单页 → 刷新列表 → 选中目标订单
  const handleOpenOrderById = useCallback(async (orderId: string) => {
    const selectFrom = (list: Order[]) => {
      const hit = list.find(o => o.id === orderId && !o.deletedAt);
      if (!hit) return false;
      setOrderType(hit.type === 'Garment' ? 'garment' : 'fabric');
      setSelectedOrder(hit);
      return true;
    };
    handleViewChange(View.Orders);
    if (selectFrom(orders)) return;
    try {
      const rows = await dataHubService.loadOrders(config.cloudEndpoint);
      const converted = rows.map((r: any) => {
        if (r.customer && !r.poNumber) return r as Order;
        try { return savedRowToOrder(r); } catch { return r as Order; }
      });
      const active = converted.filter((o: any) => !o.deletedAt);
      setOrders(active);
      void storageService.saveCachedOrders(active);
      selectFrom(active);
    } catch {
      // 导航已发生；订单列表加载失败时由常规加载路径兜底
    }
  }, [orders, config.cloudEndpoint]);

  // 通知跳转：通知中心点击通知项 / D2 桌面推送回跳 → 解析后端 link 模板
  // （/orders?id=x&tab=y 等）→ 切目标视图；订单类带 id 时直达订单详情。
  // 修复断链：原实现只写 window.location.hash，而本应用为 React state 路由，
  // hash 无消费者，点击通知不产生任何导航。
  const handleNotificationOpenLink = (link: string) => {
    const target = parseNotificationLink(link);
    if (!target) return;
    if (target.view === View.Orders && target.id) {
      void handleOpenOrderById(target.id);
      return;
    }
    handleReportNavigate(target.view, target.tab);
  };

  const settingsMode = resolveSettingsMode(activeView);
  const isFullBleedView = activeView === View.Dashboard || activeView === View.Cockpit || activeView === View.Reports || activeView === View.Relations || activeView === View.Products || activeView === View.Orders || activeView === View.ProductionBoard || activeView === View.Quotations || activeView === View.Procurement || activeView === View.Inventory || activeView === View.BOM || activeView === View.CRM || activeView === View.Suppliers || activeView === View.Seasons || activeView === View.Risks || activeView === View.MES || activeView === View.Customs || activeView === View.DocumentCenter || activeView === View.Invoices || activeView === View.PaymentVouchers || activeView === View.Shipments || activeView === View.Development || activeView === View.Assistant || activeView === View.Emails || activeView === View.DataCenter || activeView === View.Settings || activeView === View.AccountSettings || activeView === View.SystemSettings || activeView === View.BusinessTools || activeView === View.AdminPanel || activeView === View.HR || activeView === View.QcWorkbench || activeView === View.Pricing || activeView === View.Marketing;

  // Views that render the ProductionGlobe as an underlay. We must let pointer
  // events pass THROUGH the main / wrapper divs to the canvas underneath; the
  // dashboard's own interactive panels keep `pointer-events: auto` so they
  // still receive clicks normally.
  const isGlobeUnderlay = isProductionGlobeEnabled && (activeView === View.Dashboard || (activeView === View.Orders && orderViewMode === 'globe'));

  useLayoutEffect(() => {
    if (!isGlobeUnderlay) {
      setGlobeViewportCenter(null);
      return;
    }

    let rafId = 0;
    let animationMeasureUntil = 0;
    const measure = () => {
      const mainRect = mainViewportRef.current?.getBoundingClientRect();
      const rootRect = appRootRef.current?.getBoundingClientRect();
      if (!mainRect && !rootRect) return;
      const fallbackSidebarWidth = (isCollapsed ? 64 : 232) * appScale;
      const mainLeft = mainRect?.left ?? ((rootRect?.left ?? 0) + fallbackSidebarWidth);
      const mainTop = mainRect?.top ?? (rootRect?.top ?? 0);
      const mainWidth = mainRect?.width ?? Math.max(0, (rootRect?.width ?? 0) - fallbackSidebarWidth);
      const mainHeight = mainRect?.height ?? (rootRect?.height ?? 0);
      const next = {
        x: mainLeft + mainWidth / 2,
        y: mainTop + mainHeight / 2,
        width: mainWidth,
        height: mainHeight,
      };
      setGlobeViewportCenter(prev => (
        prev &&
        Math.abs(prev.x - next.x) < 0.5 &&
        Math.abs(prev.y - next.y) < 0.5 &&
        Math.abs((prev.width ?? 0) - next.width) < 0.5 &&
        Math.abs((prev.height ?? 0) - next.height) < 0.5
          ? prev
          : next
      ));

      if (performance.now() < animationMeasureUntil) {
        rafId = window.requestAnimationFrame(measure);
      }
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(measure);
    };
    const scheduleAnimatedMeasure = () => {
      animationMeasureUntil = performance.now() + 520;
      scheduleMeasure();
    };

    scheduleAnimatedMeasure();
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleAnimatedMeasure)
      : null;
    if (resizeObserver) {
      if (appRootRef.current) resizeObserver.observe(appRootRef.current);
      if (mainViewportRef.current) resizeObserver.observe(mainViewportRef.current);
      const sidebar = appRootRef.current?.querySelector<HTMLElement>('.app-sidebar');
      if (sidebar) resizeObserver.observe(sidebar);
    }
    window.addEventListener('resize', scheduleAnimatedMeasure, { passive: true });
    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleAnimatedMeasure);
    };
  }, [appScale, activeView, authState.isLoading, isCollapsed, isFullBleedView, isGlobeUnderlay, orderViewMode]);

  // 顶层 viewport mask 容易和页面自己的真实滚动容器 mask 叠加，形成数字档案底部大模糊。
  // OS 规范：边缘消失效果归属具体滚动容器，不再由 App 全局兜底。
  // Auth gate: show Login or Register page if not authenticated
  if (authState.isLoading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-300 dark:bg-none dark:bg-app-dark">
        <div className="text-xs font-light tracking-[0.22em] uppercase text-slate-400 dark:text-slate-500">
          Checking session...
        </div>
      </div>
    );
  }

  if (!authState.isLoading && !authState.isAuthenticated) {
    if (authView === 'register') {
      return (
        <Register
          isDarkMode={isDarkMode}
          onBackToLogin={() => setAuthView('login')}
          onRegistered={() => setAuthView('login')}
        />
      );
    }
    return (
      <Login
        isDarkMode={isDarkMode}
        onLogin={(user) => {
          if (user) {
            storageService.saveUIState({ currentView: View.Dashboard });
            setCurrentView(View.Dashboard);
            setAuthState({ user, isLoading: false, isAuthenticated: true });
          }
        }}
        onGoRegister={() => setAuthView('register')}
      />
    );
  }

  return (
    <div
      ref={appRootRef}
      className={`bambook-os-root ${isDarkMode ? 'bambook-os-root--dark' : ''} flex h-screen overflow-visible relative transition-[background-image] duration-500 ${isDarkMode ? 'dark bg-app-dark' : 'bg-app-light'}`}
      data-sidebar-state={isCollapsed ? 'collapsed' : 'expanded'}
      data-wallpaper-mode={isWallpaperMode ? 'on' : 'off'}
      data-appearance-mode={appearanceMode}
      style={{
        ['--app-sidebar-w' as any]: isCollapsed ? '64px' : '232px',
        ['--app-sidebar-visual-w' as any]: `${(isCollapsed ? 64 : 232) * appScale}px`,
        ['--ui-lab-app-scale' as any]: appScale.toFixed(4),
        ['--os-vnext-brand-blue' as any]: wallpaperAccentPalette.accent,
        ['--os-vnext-brand-blue-strong' as any]: wallpaperAccentPalette.accentStrong,
        ['--os-vnext-brand-blue-soft' as any]: wallpaperAccentPalette.accentSoft,
        ['--os-vnext-brand-blue-rgb' as any]: wallpaperAccentPalette.accentRgb,
        ['--os-vnext-brand-blue-strong-rgb' as any]: wallpaperAccentPalette.accentStrongRgb,
        ['--os-vnext-brand-blue-soft-rgb' as any]: wallpaperAccentPalette.accentSoftRgb,
        ...(resolvedBackgroundImageUrl
          ? {
              backgroundImage: `url(${resolvedBackgroundImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }
          : isDarkMode
            ? {
                backgroundImage: 'linear-gradient(135deg, #070D15 0%, #0B111B 46%, #050A11 100%)',
              }
            : {
                backgroundImage: 'linear-gradient(135deg, #EEF2F6 0%, #D8DEE7 48%, #AEB9C8 100%)',
              }),
      }}
    >
      <SplashScreen isVisible={isLoading} isDarkMode={isDarkMode} />
      {import.meta.env.DEV && showDesignTuner && <DesignTuner isDarkMode={isDarkMode} />}

      {/* Frameless-window controls (Electron only — renders nothing in
          the browser). Top-left hover zone reveals macOS native traffic
          lights or Windows/Linux custom buttons. See
          components/WindowControls.tsx. */}
      <WindowControls />

      <div
        className={`bambook-agent-edge-aura transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isAgentOsActive ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.015] pointer-events-none'
        }`}
        aria-hidden="true"
        style={{ transitionProperty: 'opacity, transform, filter' }}
      />

      {agentPetRendererError && (
        <div className="pointer-events-auto absolute right-6 top-6 z-[80] max-w-[420px] rounded-control border border-red-400/20 bg-[rgba(35,12,18,0.84)] px-4 py-3 text-sm text-red-50 shadow-[0_18px_48px_-24px_rgba(127,29,29,0.7)] backdrop-blur-2xl">
          <div className="flex items-start gap-3">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-red-200" />
            <div className="min-w-0 flex-1">
              <div className="font-light">Agent 浮窗已关闭</div>
              <div className="mt-1 line-clamp-3 break-words text-xs leading-5 text-red-100/80">
                {agentPetRendererError.message}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAgentPetRendererError(null)}
              className="shrink-0 rounded-full px-2 text-lg leading-5 text-red-100/70 hover:bg-white/10 hover:text-white"
              aria-label="关闭 Agent 浮窗错误提示"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* 自定义壁纸高对比磨砂防护层 */}
      {resolvedBackgroundImageUrl && (
        <div
          className={`absolute inset-0 z-0 pointer-events-none transition-all duration-500 ${
            isDarkMode
              ? 'bg-black/35 backdrop-brightness-[0.80] backdrop-contrast-[1.02]'
              : 'bg-white/20 backdrop-brightness-[1.02] backdrop-contrast-[0.98]'
          }`}
        />
      )}

      {/*
        Production Globe Integration - Total Unconstrained Layer
        放置在背景层，使其可以自由溢出至 Sidebar 下方。
        通过 Padding 动态计算主区域中心，保持视觉对齐。
        现在 Dashboard 和 Orders (仅 Globe 模式) 视图都会启用它。
      */}
      {isGlobeUnderlay && renderGlobe && (
        <div
          className="bambook-production-globe-underlay absolute inset-0 z-0 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] pointer-events-auto"
        >
          <Suspense fallback={null}>
            {globeParams.renderer === 'maplibre' && !mapLibreGlobeUnavailable ? (
              <MapLibreProductionGlobe
                orders={orders}
                sidebarOffset={0}
                isDarkMode={isDarkMode}
                wallpaperUrl={resolvedBackgroundImageUrl}
                accentPalette={wallpaperAccentPalette}
                initialDelay={0}
                quality={globeParams.quality}
                viewportCenter={globeViewportCenter}
                onRuntimeError={() => setMapLibreGlobeUnavailable(true)}
              />
            ) : (
              <ProductionGlobe
                orders={orders}
                sidebarOffset={(isCollapsed ? 64 : 232) * appScale}
                isDarkMode={isDarkMode}
                wallpaperUrl={resolvedBackgroundImageUrl}
                initialDelay={0}
                quality={globeParams.quality}
                viewportCenter={globeViewportCenter}
              />
            )}
          </Suspense>
        </div>
      )}

      <div className="app-reveal-underlay-material" aria-hidden="true" />

      {/* D1 全局工作台：命令面板（Cmd/Ctrl+K；订单记录直开详情，其余记录跳转所属模块） */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        isDarkMode={isDarkMode}
        relations={relations}
        orders={orders}
        products={products}
        invoices={invoices}
        shipments={shipments}
        knowledge={knowledge}
        emails={emails}
        onNavigate={(view) => { setPaletteOpen(false); handleViewChange(view); }}
        onOpenOrder={(order) => { setPaletteOpen(false); setSelectedOrder(order); handleViewChange(View.Orders); }}
      />

      <Sidebar
        currentView={activeView}
        onViewChange={handleViewChange}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        isDarkMode={isDarkMode}
        onToggleTheme={handleToggleTheme}
      />

      {/* Main Content Area - Reveal-underlay mode.
          `app-main` enables the big-screen zoom rules in index.css.
          NOTE: deliberately NO z-index / transform on <main> so it does not
          create a transformed backdrop root. This lets page titles (z-20/z-30)
          paint above the viewport-level glass mask (z-[15]). Page-level
          dialogs use `absolute inset-0` (not `fixed`) so they're confined
          to main's box rather than spanning the viewport. */}
      {/* 业务事件通知中心 — Provider 包裹 main，使 PageHeader 中的 Trigger 可通过 Context 获取状态 */}
      <NotificationCenter isDarkMode={isDarkMode} onOpenLink={handleNotificationOpenLink}>
      <main className={`app-main app-main-cover app-main-cover-flush flex flex-col min-w-0 overflow-hidden opacity-100 ${isGlobeUnderlay ? 'pointer-events-none' : ''}`}>
        <div ref={mainViewportRef} className={`app-main-viewport flex-1 min-h-0 relative ${isFullBleedView ? 'overflow-visible' : ((activeView as string) === View.Emails ? 'overflow-hidden flex flex-col p-6' : 'overflow-y-auto scroll-smooth p-6')} ${isGlobeUnderlay ? 'pointer-events-none' : ''}`}>
          <MainContentShell isFullBleedView={isFullBleedView} isEmails={(activeView as string) === View.Emails} isGlobeUnderlay={isGlobeUnderlay}>

            {activeView === View.Dashboard && (
              <Dashboard
                orders={orders}
                emails={emails}
                insights={insights}
                onNavigate={handleViewChange}
                briefing={briefing}
                isBriefingLoading={isBriefingLoading}
                isCloudConnected={isCloudConnected}
                isDarkMode={isDarkMode}
                onRefreshBriefing={handleManualRefresh}
                hasGlobeUnderlay={isGlobeUnderlay}
              />
            )}
            {activeView === View.Assistant && (
              <Assistant
                knowledge={knowledge}
                orders={orders}
                relations={relations}
                insights={insights}
                onUpdateOrders={handleUpdateOrders}
                onUpdateKnowledge={handleUpdateKnowledge}
                onUpdateInsights={handleUpdateInsights}
                isDarkMode={isDarkMode}
                chatModelId={config.chatModelId}
                temperature={config.temperature}
                voiceSpeed={config.voiceSpeed}
              />
            )}
            {activeView === View.Relations && (
              relationsReady
                ? <RelationsManager relations={relations} onUpdate={handleUpdateRelations} isDarkMode={isDarkMode} sidebarCollapsed={isCollapsed} cloudEndpoint={config.cloudEndpoint} onNavigate={handleViewChange} />
                : <div className="text-slate-500 dark:text-slate-400">关系智库正在读取数据中心...</div>
            )}
            {activeView === View.Products && (
              isProductModuleSettingsWorkspaceOpen
                ? (
                  <ProductModuleSettingsWorkspace
                    isDarkMode={isDarkMode}
                    products={products}
                    productCategories={productCategories}
                    moduleSettings={productModuleSettings}
                    cloudEndpoint={config.cloudEndpoint}
                    onBack={() => setIsProductModuleSettingsWorkspaceOpen(false)}
                    onUpdateCategories={handleUpdateProductCategories}
                    onUpdateModuleSettings={handleUpdateProductModuleSettings}
                  />
                )
                : (
                  <ProductsManager
                    products={products}
                    productCategories={productCategories}
                    onUpdateProducts={handleUpdateProducts}
                    onUpdateCategories={handleUpdateProductCategories}
                    cloudEndpoint={config.cloudEndpoint}
                    isDarkMode={isDarkMode}
                    moduleSettings={productModuleRuntimeSettings}
                    onNavigate={handleViewChange}
                  />
                )
            )}
            {activeView === View.Products && !isProductModuleSettingsWorkspaceOpen && (
              <div className="fixed bottom-8 right-8 z-[120] h-12 w-12">
                <button
                  type="button"
                  data-main-app-module-settings-fab
                  data-os-surface-role="floatingOverlay"
                  aria-label="打开数字档案模块设置"
                  title="数字档案设置"
                  className={`flex h-full w-full items-center justify-center !rounded-full ${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.glassColor} bambook-outer-panel ${OS_MATERIAL.floatingOverlay} transition-colors text-slate-600 hover:text-slate-900 dark:text-white/72 dark:hover:text-white/88`}
                  onClick={() => setIsProductModuleSettingsWorkspaceOpen(true)}
                >
                  <Settings2 size={20} strokeWidth={1.7} />
                </button>
              </div>
            )}
            {activeView === View.Development && (
              <DevelopmentManager isDarkMode={isDarkMode} cases={developmentCases} setCases={setDevelopmentCases} onNavigate={handleViewChange} />
            )}
            {(activeView === View.Invoices || activeView === View.PaymentVouchers) && (
              <FinanceManager
                isDarkMode={isDarkMode}
                initialTab={(moduleTabOverrides[activeView] as FinanceTabId | undefined) ?? (activeView === View.Invoices ? 'invoices' : 'vouchers')}
                invoices={invoices}
                setInvoices={setInvoices}
                vouchers={paymentVouchers}
                setVouchers={setPaymentVouchers}
                onNavigate={handleViewChange}
                onOpenTradeDocument={handleOpenTradeDocById}
              />
            )}
            {activeView === View.Reports && (
              <ReportCenter isDarkMode={isDarkMode} onNavigate={handleReportNavigate} />
            )}
            {activeView === View.Shipments && (
              <ShipmentManager isDarkMode={isDarkMode} shipments={shipments} setShipments={setShipments} onNavigate={handleViewChange} />
            )}
            {activeView === View.Quotations && (
              <QuotationManager isDarkMode={isDarkMode} onOpenOrder={handleOpenOrderById} onNavigate={handleViewChange} />
            )}
            {activeView === View.Procurement && (
              <ProcurementManager isDarkMode={isDarkMode} onNavigate={handleViewChange} />
            )}
            {activeView === View.Inventory && (
              <InventoryManager isDarkMode={isDarkMode} />
            )}
            {activeView === View.BOM && (
              <BomManager isDarkMode={isDarkMode} onNavigate={handleViewChange} />
            )}
            {activeView === View.CRM && (
              <CrmManager isDarkMode={isDarkMode} onNavigate={handleViewChange} />
            )}
            {activeView === View.Suppliers && (
              <SuppliersManager isDarkMode={isDarkMode} onNavigate={handleViewChange} />
            )}
            {activeView === View.Seasons && (
              <SeasonsManager isDarkMode={isDarkMode} />
            )}
            {activeView === View.Risks && (
              <RisksManager isDarkMode={isDarkMode} />
            )}
            {activeView === View.QcWorkbench && (
              <QcWorkbenchManager isDarkMode={isDarkMode} />
            )}
            {activeView === View.Pricing && (
              <PricingManager isDarkMode={isDarkMode} initialTab={moduleTabOverrides[View.Pricing] as PricingTabId | undefined} />
            )}
            {activeView === View.Marketing && (
              <MarketingManager isDarkMode={isDarkMode} />
            )}
            {activeView === View.MES && (
              <MesManager isDarkMode={isDarkMode} />
            )}
            {activeView === View.Customs && (
              <CustomsManager isDarkMode={isDarkMode} initialTab={moduleTabOverrides[View.Customs] as CustomsTabId | undefined} onOpenDocumentCenter={() => handleViewChange(View.DocumentCenter)} onNavigate={handleViewChange} />
            )}
            {activeView === View.DocumentCenter && (
              <DocumentCenter isDarkMode={isDarkMode} onOpenInvoice={handleOpenInvoiceById} />
            )}
            {activeView === View.ProductionBoard && (
              <ProductionBoard isDarkMode={isDarkMode} onOpenOrder={handleOpenOrderById} />
            )}
            {activeView === View.DataCenter && (
              <DataCenter isDarkMode={isDarkMode} dataCenterEndpoint={config.cloudEndpoint} />
            )}
            {activeView === View.Orders && (
              ordersReady
                ? (
                  <OrderManager
                    orders={orders}
                    dirtyIds={new Set()}
                    setOrders={handleUpdateOrders}
                    onSyncComplete={() => { }}
                    knowledge={knowledge}
                    viewMode={orderViewMode}
                    onViewModeChange={setOrderViewMode}
                    selectedOrder={selectedOrder}
                    onSelectOrder={setSelectedOrder}
                    isDarkMode={isDarkMode}
                    orderType={orderType}
                    onOrderTypeChange={setOrderType}
                    relations={relations}
                    allowGlobeView={isProductionGlobeEnabled}
                    onFullscreenOpenChange={setOrderFullscreenOpen}
                    onNavigate={handleViewChange}
                  />
                )
                : <div className="text-slate-500 dark:text-slate-400">订单正在读取数据中心...</div>
            )}
            {activeView === View.Emails && (
              <EmailManager emails={emails} setEmails={handleUpdateEmails} knowledge={knowledge} orders={orders} onAddKnowledge={(item) => handleUpdateKnowledge([item, ...knowledge], item)} isDarkMode={isDarkMode} />
            )}
            {settingsMode && (
              <Settings
                mode={settingsMode}
                config={config}
                onUpdateConfig={(nc) => {
                  const nextIsDarkMode = nc.themeMode === 'light'
                    ? false
                    : nc.themeMode === 'dark'
                      ? true
                      : window.matchMedia('(prefers-color-scheme: dark)').matches;
                  syncWallpaperAccentForConfig(nc, nextIsDarkMode);
                  setConfig(nc);
                  apiService.saveConfig(nc);
                  if (nc.themeMode === 'light') setIsDarkMode(false);
                  else if (nc.themeMode === 'dark') setIsDarkMode(true);
                  else if (nc.themeMode === 'system') {
                    localStorage.removeItem('theme_preference');
                    setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
                  }
                  checkConnection();
                }}
                onRefreshData={checkConnection}
                isDarkMode={isDarkMode}
              />
            )}

            {activeView === View.BusinessTools && (
              <BusinessTools isDarkMode={isDarkMode} relations={relationsReady ? relations : []} orders={ordersReady ? orders : []} onNavigate={handleReportNavigate} />
            )}
            {activeView === View.AdminPanel && (
              <AdminPanel isDarkMode={isDarkMode} />
            )}
            {activeView === View.HR && (
              <HRManager isDarkMode={isDarkMode} />
            )}
            {activeView === View.Cockpit && (
              <CockpitManager isDarkMode={isDarkMode} />
            )}
          </MainContentShell>

          {/* v0.8 未交付模块装修遮挡：磨砂面板覆盖整页（含页面标题栏），由开发者选项「装修遮挡」统一控制 */}
          {devOptions.comingSoonOverlay && COMING_SOON_PAGES[activeView] && (
            <ComingSoonOverlay
              text={COMING_SOON_PAGES[activeView]}
              className="absolute inset-0 z-50"
            />
          )}
        </div>
      </main>
      </NotificationCenter>

    </div>
  );
};

export default App;
