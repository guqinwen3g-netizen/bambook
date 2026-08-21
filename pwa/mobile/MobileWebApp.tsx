import React, { useState, useEffect, useCallback, useRef, Suspense, lazy, startTransition } from 'react';
import { View, KnowledgeItem, Order, Email, SystemConfig, Insight, Relation, ProductAsset, ProductSubCategory, DevelopmentCase } from '../../types';
import type { OrderViewType } from '../../lib/orderSchema';

// Diagnostic flag — when true, freeze the global background polls (briefing
// refresh, cloud sync) that cascade setState into the entire App tree.
// Currently disabled — kept for future regression hunts.
const DIAG_FREEZE_DASHBOARD = false;
const DEV_PREVIEW_CONTINUITY_KEY = 'bambook_dev_preview_continuity';
const AUTH_TOKEN_KEY = 'bambook_auth_token';
export const DESIGN_TUNER_TOGGLE_SHORTCUT = 'mod+shift+t';

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';
import { dataHubService, DataHubMode, DataHubSnapshot } from '../../services/dataHubService';
import { llmService } from '../../services/llmService';
import { deleteOrder } from '../../services/importService';
import { subscribe, checkAuth, getAuthState, canAccessView, AuthState } from '../../services/authService';
import { resolveInitialDarkMode } from '../../appTheme';
import type { StoredThemePreference } from '../../appTheme';
import MobileWebNavigation from './MobileWebNavigation';

import Dashboard from '../../components/Dashboard';
import Assistant from '../../components/Assistant';
import KnowledgeBase from '../../components/KnowledgeBase';
import OrderManager, { savedRowToOrder } from '../../components/OrderManager';
import EmailManager from '../../components/EmailManager';
import Settings from '../../components/Settings';
import RelationsManager from '../../components/RelationsManager';
import ProductsManager from '../../components/ProductsManager';
import DevelopmentManager from '../../components/DevelopmentManager';
import type { GlobeQualityMode } from '../../components/ProductionGlobe';
// Lazy: three.js + drei + globe code split into its own chunk.
// Loaded on-demand only when Dashboard / Orders-Globe view actually mounts.
// Pairs naturally with the existing initialDelay={2500} splash so users
// never perceive the chunk download.
const ProductionGlobe = lazy(() => import('../../components/ProductionGlobe'));
import SplashScreen, { SPLASH_MIN_VISIBLE_MS } from '../../components/SplashScreen';
import Login from '../../components/Login';
import Register from '../../components/Register';
import AdminPanel from '../../components/AdminPanel';
import BusinessTools from '../../components/BusinessTools';
import DesignTuner from '../../components/dev/DesignTuner';
import WindowControls from '../../components/WindowControls';
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
  Shirt
} from 'lucide-react';

/** Read optional `?globeQuality=high|medium|low|auto` once at boot. */
function readGlobeParamsFromUrl(): { quality: GlobeQualityMode } {
  if (typeof window === 'undefined') return { quality: 'auto' };
  try {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get('globeQuality');
    const quality: GlobeQualityMode =
      q === 'high' || q === 'medium' || q === 'low' || q === 'auto' ? q : 'auto';
    return { quality };
  } catch {
    return { quality: 'auto' };
  }
}

function shouldShowGlobeDiagnostics(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('globeDiag') === '1';
  } catch {
    return false;
  }
}

const MobileGlobeDiagnostics: React.FC<{
  currentView: View;
  isGlobeUnderlay: boolean;
  hasActivatedGlobe: boolean;
}> = ({ currentView, isGlobeUnderlay, hasActivatedGlobe }) => {
  const [snapshot, setSnapshot] = useState('');

  useEffect(() => {
    const collect = () => {
      const layer = document.querySelector('.bambook-mobile-viewport-globe-layer') as HTMLElement | null;
      const fallback = document.querySelector('.bambook-mobile-earth-fallback') as HTMLElement | null;
      const canvas = layer?.querySelector('canvas') as HTMLCanvasElement | null;
      const webglCanvas = document.createElement('canvas');
      const webglOk = Boolean(webglCanvas.getContext('webgl2') || webglCanvas.getContext('webgl'));
      const layerRect = layer?.getBoundingClientRect();
      const fallbackRect = fallback?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      setSnapshot([
        `view=${currentView}`,
        `underlay=${isGlobeUnderlay ? '1' : '0'}`,
        `activated=${hasActivatedGlobe ? '1' : '0'}`,
        `layer=${layer ? `${Math.round(layerRect?.width ?? 0)}x${Math.round(layerRect?.height ?? 0)}` : 'none'}`,
        `fallback=${fallback ? `${Math.round(fallbackRect?.width ?? 0)}x${Math.round(fallbackRect?.height ?? 0)}` : 'none'}`,
        `canvas=${canvas ? `${Math.round(canvasRect?.width ?? 0)}x${Math.round(canvasRect?.height ?? 0)}` : 'none'}`,
        `webgl=${webglOk ? '1' : '0'}`,
      ].join(' | '));
    };

    collect();
    const timer = window.setInterval(collect, 700);
    return () => window.clearInterval(timer);
  }, [currentView, hasActivatedGlobe, isGlobeUnderlay]);

  return (
    <div className="fixed left-3 right-3 top-[max(env(safe-area-inset-top),12px)] z-[9999] rounded-xl border border-cyan-300/35 bg-black/82 px-3 py-2 text-[10px] leading-4 text-cyan-100 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
      {snapshot || 'collecting globe diagnostics...'}
    </div>
  );
};

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

const MobileWebApp: React.FC = () => {
  // Restore UI state from localStorage on init
  const [uiState] = useState(() => storageService.getUIState());
  const [authState, setAuthState] = useState<AuthState>(() => {
    if (shouldUseDevPreviewContinuity()) {
      return { ...getAuthState(), isLoading: false, isAuthenticated: true };
    }
    return getAuthState();
  });
  const authStateRef = useRef(authState);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [globeParams] = useState(readGlobeParamsFromUrl);
  const [showGlobeDiagnostics] = useState(shouldShowGlobeDiagnostics);
  const [currentView, setCurrentView] = useState<View>(() => {
    const isPhonePreview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bambookDevice') === 'phone';
    if (isPhonePreview) return View.Dashboard;
    const saved = uiState.currentView;
    if (saved === View.UiLab) return View.Dashboard;
    if (saved && Object.values(View).includes(saved as View)) return saved as View;
    return View.Dashboard;
  });
  const [isLoading, setIsLoading] = useState(() => !uiState.hasVisited && !shouldUseDevPreviewContinuity());
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
  const [developmentCases, setDevelopmentCases] = useState<DevelopmentCase[]>([]);
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
  const [orderFullscreenOpen, setOrderFullscreenOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderViewType>('fabric');
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

  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

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
    setOrders(previous => {
      const next = snapshot.orders.length === 0 && previous.length > 0 ? previous : snapshot.orders;
      void storageService.saveCachedOrders(next);
      return next;
    });
    setKnowledge(snapshot.knowledge);
    setInsights(snapshot.insights);
    setRelations(previous => {
      const next = snapshot.relations.length === 0 && previous.length > 0 ? previous : snapshot.relations;
      void storageService.saveCachedRelations(next);
      return next;
    });
    setProducts(previous => {
      const next = snapshot.products.length === 0 && previous.length > 0 ? previous : snapshot.products;
      void storageService.saveCachedProducts(next);
      return next;
    });
    setProductCategories(previous => {
      const next = snapshot.productCategories.length === 0 && previous.length > 0 ? previous : snapshot.productCategories;
      void storageService.saveCachedProductCategories(next);
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
      if (keepCurrentPreview && next.isLoading && authStateRef.current.isAuthenticated) return;
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
        if (cachedProducts.length > 0) setProducts(cachedProducts.filter(product => !product.deletedAt));
      })
      .catch(() => {});
    storageService.getCachedProductCategories()
      .then(cachedCategories => {
        if (cachedCategories.length > 0) setProductCategories(cachedCategories.filter(category => !category.deletedAt));
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
  useEffect(() => {
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
    }
  }, [isDarkMode, config.themeMode]);

  // Persist UI state changes to localStorage
  useEffect(() => {
    storageService.saveUIState({ currentView });
  }, [currentView]);

  useEffect(() => {
    storageService.saveUIState({ sidebarCollapsed: isCollapsed });
  }, [isCollapsed]);

  useEffect(() => {
    storageService.saveUIState({ orderViewMode });
  }, [orderViewMode]);

  // Auto-collapse sidebar based on window width for responsive desktop experience
  useEffect(() => {
    // Note: isMobile is hardcoded false now, but this logic is for Desktop resizing.
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 1100) {
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


  const handleUpdateRelations = (newR: Relation[], modified?: Relation) => {
    const activeRelations = newR.filter(r => !r.deletedAt);
    setRelations(activeRelations);
    void storageService.saveCachedRelations(activeRelations);
    if (modified) {
      const persist = modified.deletedAt
        ? storageService.deleteRelationFromDataHub(modified.id, config.cloudEndpoint)
        : storageService.saveRelationToDataHub(modified, config.cloudEndpoint);
      persist.catch((err: any) => {
        console.warn('[Relations] save failed:', err?.message ?? err);
      });
    }
  };

  const handleUpdateProducts = (newP: ProductAsset[], modified?: ProductAsset) => {
    const activeProducts = newP.filter(p => !p.deletedAt);
    setProducts(activeProducts);
    void storageService.saveCachedProducts(activeProducts);
  };

  const handleUpdateProductCategories = (newC: ProductSubCategory[], modified?: ProductSubCategory) => {
    const activeCategories = newC.filter(c => !c.deletedAt);
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
    setIsDarkMode(nextIsDarkMode);
    setConfig(nextConfig);
    apiService.saveConfig(nextConfig);
  };

  const isFullBleedView = currentView === View.Dashboard || currentView === View.Relations || currentView === View.Products || currentView === View.Orders || currentView === View.Development || currentView === View.Assistant || currentView === View.DataCenter || currentView === View.Settings || currentView === View.BusinessTools || currentView === View.AdminPanel;

  // Views that render the ProductionGlobe as an underlay. We must let pointer
  // events pass THROUGH the main / wrapper divs to the canvas underneath; the
  // dashboard's own interactive panels keep `pointer-events: auto` so they
  // still receive clicks normally.
  const isGlobeUnderlay = isProductionGlobeEnabled && (currentView === View.Dashboard || (currentView === View.Orders && orderViewMode === 'globe'));
  const [hasActivatedGlobe, setHasActivatedGlobe] = useState(isGlobeUnderlay);
  useEffect(() => {
    if (isGlobeUnderlay) {
      setHasActivatedGlobe(true);
    } else if (!isProductionGlobeEnabled) {
      setHasActivatedGlobe(false);
    }
  }, [isGlobeUnderlay, isProductionGlobeEnabled]);
  useEffect(() => {
    if (!isProductionGlobeEnabled && orderViewMode === 'globe') {
      setOrderViewMode('list');
    }
  }, [isProductionGlobeEnabled, orderViewMode]);
  const handleMobileViewChange = useCallback((view: View) => {
    startTransition(() => {
      setCurrentView(canAccessView(view) ? view : View.Dashboard);
    });
  }, []);
  // Auth gate: show Login or Register page if not authenticated
  if (authState.isLoading) {
    return (
      <div className={`bambook-mobile-auth-page w-full h-screen flex items-center justify-center ${isDarkMode ? 'bg-app-dark' : 'bg-gradient-to-br from-slate-50 to-blue-50'}`}>
        <div className={`text-xs font-medium tracking-[0.22em] uppercase ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
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
          if (user) setAuthState({ user, isLoading: false, isAuthenticated: true });
        }}
        onGoRegister={() => setAuthView('register')}
      />
    );
  }

  return (
    <>
      {showGlobeDiagnostics && (
        <MobileGlobeDiagnostics
          currentView={currentView}
          isGlobeUnderlay={isGlobeUnderlay}
          hasActivatedGlobe={hasActivatedGlobe}
        />
      )}
      {isProductionGlobeEnabled && hasActivatedGlobe && currentView !== View.Dashboard && (
        <div
          className={`bambook-mobile-viewport-globe-layer fixed inset-0 z-0 transition-opacity duration-150 ease-out ${
            isGlobeUnderlay ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          aria-hidden={!isGlobeUnderlay}
        >
          <Suspense fallback={null}>
            <ProductionGlobe
              orders={orders}
              sidebarOffset={0}
              isDarkMode={isDarkMode}
              initialDelay={2500}
              quality={globeParams.quality}
            />
          </Suspense>
        </div>
      )}
      <div
        className={`bambook-mobile-web-shell flex h-screen overflow-hidden relative z-10 transition-colors duration-500 ${isDarkMode ? 'dark' : ''} ${isGlobeUnderlay ? 'bg-transparent' : (isDarkMode ? 'bg-app-dark' : 'bg-app-light')}`}
        style={{ ['--app-sidebar-w' as any]: '0px' }}
      >
      <SplashScreen isVisible={isLoading} isDarkMode={isDarkMode} />
      {import.meta.env.DEV && showDesignTuner && <DesignTuner isDarkMode={isDarkMode} />}

      {/* Frameless-window controls (Electron only — renders nothing in
          the browser). Top-left hover zone reveals macOS native traffic
          lights or Windows/Linux custom buttons. See
          components/WindowControls.tsx. */}
      <WindowControls />

      {/* Global Background Decor Layer - IOS 26 Glass Effect Foundation */}
      <div className={`absolute inset-0 z-0 pointer-events-none overflow-hidden transition-opacity duration-150 ${isGlobeUnderlay ? 'opacity-0' : 'opacity-100'}`}>
        <div className={`absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] -mr-48 -mt-48 ${isDarkMode ? 'bg-action/20' : 'bg-accent-cyan/22 mix-blend-multiply'}`}></div>
        <div className={`absolute bottom-0 left-0 w-[600px] h-[600px] rounded-full blur-[140px] -ml-48 -mb-48 ${isDarkMode ? 'bg-accent-blue/15' : 'bg-action/15 mix-blend-multiply'}`}></div>
        <div className={`absolute top-1/2 left-1/2 w-[800px] h-[800px] rounded-full blur-[100px] -translate-x-1/2 -translate-y-1/2 ${isDarkMode ? 'bg-slate-800/30' : 'bg-white/60'}`}></div>
      </div>

      {isProductionGlobeEnabled && hasActivatedGlobe && currentView === View.Dashboard && (
        <div
          className={`bambook-mobile-shell-globe-layer absolute inset-0 z-10 transition-opacity duration-150 ease-out ${
            isGlobeUnderlay ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          aria-hidden={!isGlobeUnderlay}
        >
          <Suspense fallback={null}>
            <ProductionGlobe
              orders={orders}
              sidebarOffset={0}
              isDarkMode={isDarkMode}
              initialDelay={0}
              quality={globeParams.quality}
            />
          </Suspense>
        </div>
      )}

      {/* Main Content Area - Layout integrated (Push mode).
          `app-main` enables the big-screen zoom rules in index.css.
          NOTE: deliberately NO z-index / transform on <main> so it does not
          create its own stacking context. This lets page titles (z-20/z-30)
          paint above the viewport-level glass mask (z-[15]). Page-level
          dialogs use `absolute inset-0` (not `fixed`) so they're confined
          to main's box rather than spanning the viewport. */}
      <main className={`app-main flex-1 flex flex-col min-w-0 overflow-hidden relative z-20 transition-opacity duration-150 ease-out ${!isLoading ? 'opacity-100' : 'opacity-0'} ${isGlobeUnderlay ? 'pointer-events-none' : ''}`}>
        <div className={`flex-1 min-h-0 relative ${isFullBleedView ? 'overflow-hidden flex flex-col' : (currentView === View.Emails ? 'overflow-hidden flex flex-col p-6' : 'overflow-y-auto scroll-smooth p-6')} ${isGlobeUnderlay ? 'pointer-events-none' : ''}`}>
          <div className={`${isFullBleedView ? 'flex-1 h-full' : (currentView === View.Emails ? 'glass-panel flex-1 h-full overflow-hidden flex flex-col' : 'glass-panel min-h-full p-8 transition-all duration-300')} ${isGlobeUnderlay ? 'pointer-events-none' : 'pointer-events-auto'}`}>

            {currentView === View.Dashboard && (
              <Dashboard orders={orders} emails={emails} insights={insights} onNavigate={handleMobileViewChange} briefing={briefing} isBriefingLoading={isBriefingLoading} isCloudConnected={isCloudConnected} isDarkMode={isDarkMode} onRefreshBriefing={handleManualRefresh} isMobileSpatial hasGlobeUnderlay={isGlobeUnderlay} />
            )}
            {currentView === View.Assistant && (
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
            {currentView === View.Relations && (
              relationsReady
                ? <RelationsManager relations={relations} onUpdate={handleUpdateRelations} isDarkMode={isDarkMode} isMobile sidebarCollapsed={isCollapsed} />
                : <div className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>关系智库正在读取数据中心...</div>
            )}
            {currentView === View.Products && <ProductsManager products={products} productCategories={productCategories} onUpdateProducts={handleUpdateProducts} onUpdateCategories={handleUpdateProductCategories} cloudEndpoint={config.cloudEndpoint} isDarkMode={isDarkMode} isMobile />}
            {currentView === View.Development && <DevelopmentManager isDarkMode={isDarkMode} cases={developmentCases} setCases={setDevelopmentCases} />}
            {currentView === View.DataCenter && <KnowledgeBase knowledge={knowledge} setKnowledge={handleUpdateKnowledge} insights={insights} setInsights={handleUpdateInsights} isDarkMode={isDarkMode} />}
            {currentView === View.Orders && orderType === 'fabric' && (
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
                  />
                )
                : <div className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>订单正在读取数据中心...</div>
            )}
            {currentView === View.Emails && <EmailManager emails={emails} setEmails={handleUpdateEmails} knowledge={knowledge} orders={orders} onAddKnowledge={(item) => handleUpdateKnowledge([item, ...knowledge], item)} isDarkMode={isDarkMode} />}
            {currentView === View.Settings && (
              <Settings
                config={config}
                onUpdateConfig={(nc) => {
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

            {currentView === View.BusinessTools && <BusinessTools isDarkMode={isDarkMode} relations={relationsReady ? relations : []} orders={ordersReady ? orders : []} />}
            {currentView === View.AdminPanel && <AdminPanel isDarkMode={isDarkMode} />}
          </div>
        </div>
      </main>

      </div>
      <MobileWebNavigation
        currentView={currentView}
        onViewChange={handleMobileViewChange}
        isDarkMode={isDarkMode}
        onToggleTheme={handleToggleTheme}
      />
    </>
  );
};

export default MobileWebApp;
