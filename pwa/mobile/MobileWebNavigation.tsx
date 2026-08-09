import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList,
  Database,
  Factory,
  Home,
  LayoutDashboard,
  Library,
  Mail,
  Moon,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { View } from '../../types';
import BambookIcon from '../../components/BambookIcon';
import { canAccessView, hasRole } from '../../services/authService';
import SidePanelContainer from '../../components/ui/SidePanelContainer';

interface MobileWebNavigationProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

const navIconClass = 'transition-all duration-300';
const DUPLICATE_TOUCH_CLICK_WINDOW_MS = 90;
const FIRST_VIEW_SWITCH_DELAY_MS = 25;
const RAPID_VIEW_SWITCH_DELAY_MS = 120;
const RAPID_VIEW_SWITCH_WINDOW_MS = 260;
const EDGE_BACK_START_PX = 28;
const EDGE_BACK_MIN_DELTA_X = 72;
const EDGE_BACK_MAX_DELTA_Y = 44;

const MobileWebNavigation: React.FC<MobileWebNavigationProps> = ({
  currentView,
  onViewChange,
  isDarkMode,
  onToggleTheme,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [optimisticView, setOptimisticView] = React.useState(currentView);
  const lastTouchAtRef = React.useRef(0);
  const lastViewRequestAtRef = React.useRef(0);
  const pendingViewRef = React.useRef<View | null>(null);
  const pendingViewTimerRef = React.useRef<number | null>(null);
  const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const edgeBackStartRef = React.useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const viewHistoryRef = React.useRef<View[]>([]);
  const lastCommittedViewRef = React.useRef(currentView);
  const suppressHistoryRef = React.useRef(false);
  const isAdmin = hasRole('owner', 'admin');

  React.useEffect(() => {
    if (lastCommittedViewRef.current !== currentView) {
      if (suppressHistoryRef.current) {
        suppressHistoryRef.current = false;
      } else {
        const previousView = lastCommittedViewRef.current;
        const history = viewHistoryRef.current;
        if (history[history.length - 1] !== previousView) {
          history.push(previousView);
          if (history.length > 12) history.shift();
        }
      }
      lastCommittedViewRef.current = currentView;
    }
    if (pendingViewRef.current === null) {
      setOptimisticView(currentView);
    }
  }, [currentView]);

  React.useEffect(() => {
    return () => {
      if (pendingViewTimerRef.current !== null) {
        window.clearTimeout(pendingViewTimerRef.current);
      }
    };
  }, []);

  const goBack = React.useCallback(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    let previousView = viewHistoryRef.current.pop();
    while (previousView && !canAccessView(previousView)) {
      previousView = viewHistoryRef.current.pop();
    }
    if (!previousView || previousView === currentView) return;

    suppressHistoryRef.current = true;
    setOptimisticView(previousView);
    pendingViewRef.current = previousView;
    if (pendingViewTimerRef.current !== null) {
      window.clearTimeout(pendingViewTimerRef.current);
    }
    pendingViewTimerRef.current = window.setTimeout(() => {
      const nextView = pendingViewRef.current;
      pendingViewTimerRef.current = null;
      if (!nextView) return;
      onViewChange(nextView);
      window.setTimeout(() => {
        if (pendingViewRef.current === nextView) {
          pendingViewRef.current = null;
        }
      }, 0);
    }, FIRST_VIEW_SWITCH_DELAY_MS);
  }, [currentView, menuOpen, onViewChange]);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if (event.clientX > EDGE_BACK_START_PX) return;
      edgeBackStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };

    const handlePointerUp = (event: PointerEvent) => {
      const start = edgeBackStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      edgeBackStartRef.current = null;
      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      if (deltaX < EDGE_BACK_MIN_DELTA_X || Math.abs(deltaY) > EDGE_BACK_MAX_DELTA_Y) return;
      event.preventDefault();
      goBack();
    };

    const clearEdgeBack = (event: PointerEvent) => {
      if (edgeBackStartRef.current?.pointerId === event.pointerId) {
        edgeBackStartRef.current = null;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    document.addEventListener('pointerup', handlePointerUp, { passive: false });
    document.addEventListener('pointercancel', clearEdgeBack, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', clearEdgeBack);
    };
  }, [goBack]);

  const goToView = (view: View) => {
    if (!canAccessView(view)) return;
    const now = Date.now();
    const delay =
      now - lastViewRequestAtRef.current < RAPID_VIEW_SWITCH_WINDOW_MS
        ? RAPID_VIEW_SWITCH_DELAY_MS
        : FIRST_VIEW_SWITCH_DELAY_MS;
    lastViewRequestAtRef.current = now;
    setOptimisticView(view);
    pendingViewRef.current = view;
    setMenuOpen(false);

    if (pendingViewTimerRef.current !== null) {
      window.clearTimeout(pendingViewTimerRef.current);
    }

    pendingViewTimerRef.current = window.setTimeout(() => {
      const nextView = pendingViewRef.current;
      pendingViewTimerRef.current = null;
      if (!nextView) return;
      onViewChange(nextView);
      window.setTimeout(() => {
        if (pendingViewRef.current === nextView) {
          pendingViewRef.current = null;
        }
      }, 0);
    }, delay);
  };

  const captureTouchStart = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return;
    touchStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const runTouchAction = (event: React.PointerEvent<HTMLElement>, action: () => void) => {
    if (event.pointerType !== 'touch') return;
    const touchStart = touchStartRef.current;
    touchStartRef.current = null;
    if (touchStart) {
      const deltaX = event.clientX - touchStart.x;
      const deltaY = event.clientY - touchStart.y;
      if (Math.hypot(deltaX, deltaY) > 10) return;
    }
    lastTouchAtRef.current = Date.now();
    event.preventDefault();
    action();
  };

  const runClickAction = (action: () => void) => {
    if (Date.now() - lastTouchAtRef.current < DUPLICATE_TOUCH_CLICK_WINDOW_MS) return;
    action();
  };

  const bottomItems = [
    { type: 'view' as const, id: View.Dashboard, icon: LayoutDashboard, label: '看板' },
    { type: 'view' as const, id: View.Relations, icon: Users, label: '关系' },
    { type: 'home' as const, icon: Home, label: '主页' },
    { type: 'view' as const, id: View.Products, icon: Library, label: '档案' },
    { type: 'view' as const, id: View.Assistant, icon: Sparkles, label: 'AI' },
  ].filter(item => item.type === 'home' || canAccessView(item.id));

  const menuItems = [
    { id: View.Dashboard, icon: LayoutDashboard, label: '全景看板' },
    { id: View.Assistant, icon: Sparkles, label: 'AI 助手' },
    { id: View.Relations, icon: Users, label: '关系智库' },
    { id: View.Products, icon: Library, label: '数字档案' },
    { id: View.Orders, icon: Factory, label: '生产管理' },
    { id: View.Development, icon: ClipboardList, label: '开发管理' },
    { id: View.Emails, icon: Mail, label: '智能邮箱' },
    { id: View.DataCenter, icon: Database, label: '策略文库' },
    { id: View.BusinessTools, icon: Wrench, label: '业务工具' },
    ...(isAdmin ? [{ id: View.AdminPanel, icon: Shield, label: '管理后台' }] : []),
    { id: View.Settings, icon: Settings, label: '设置' },
  ].filter(item => canAccessView(item.id));

  return (
    <>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="fixed inset-0 z-[420]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              aria-label="关闭导航菜单"
              onPointerDown={captureTouchStart}
              onPointerUp={(event) => runTouchAction(event, () => setMenuOpen(false))}
              onClick={() => runClickAction(() => setMenuOpen(false))}
              className={`absolute inset-0 ${isDarkMode ? 'bg-black/34' : 'bg-deep-alt/14'} backdrop-blur-[2px]`}
            />
            <motion.div
              initial={{ y: 20, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', damping: 28, stiffness: 210 }}
              className="bambook-mobile-home-panel absolute inset-3"
            >
              <SidePanelContainer
                isDarkMode={isDarkMode}
                className="h-full w-full"
                contentClassName="relative z-10 flex h-full min-h-0 flex-col"
              >
                <div className="flex shrink-0 items-center justify-between px-6 pb-6 pt-7">
                  <div className="flex items-center gap-3">
                    <BambookIcon size={28} strokeWidth={1} className="text-link" />
                    <span className={`text-lg font-light tracking-tight ${isDarkMode ? 'text-white' : 'text-deep-alt'}`}>
                      Bambook <span className={isDarkMode ? 'text-link-light' : 'text-link'}>Neural</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭导航菜单"
                    onPointerDown={captureTouchStart}
                    onPointerUp={(event) => runTouchAction(event, () => setMenuOpen(false))}
                    onClick={() => runClickAction(() => setMenuOpen(false))}
                    className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-colors ${
                      isDarkMode ? 'text-slate-300 hover:bg-white/[0.06]' : 'text-slate-500 hover:bg-white/70'
                    }`}
                  >
                    <X size={19} strokeWidth={1.3} />
                  </button>
                </div>

                <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto px-4 pb-4">
                  {menuItems.map((item) => {
                    const isActive = optimisticView === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onPointerDown={captureTouchStart}
                        onPointerUp={(event) => runTouchAction(event, () => goToView(item.id))}
                        onClick={() => runClickAction(() => goToView(item.id))}
                        className={`flex min-h-[56px] w-full items-center gap-3 rounded-[20px] px-4 py-4 text-left transition-[background,color,box-shadow,transform] duration-250 active:scale-[0.99] ${
                          isActive
                            ? isDarkMode
                              ? 'bg-[linear-gradient(135deg,rgba(35,75,120,0.58),rgba(14,36,68,0.54))] text-slate-50 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.20)]'
                              : 'bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(229,243,255,0.68))] text-deep-alt shadow-[inset_0_0_0_1px_rgba(74,144,226,0.22)]'
                            : isDarkMode
                              ? 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                              : 'text-slate-500 hover:bg-white/55 hover:text-deep-alt'
                        }`}
                        >
                          <item.icon
                          size={20}
                          strokeWidth={1.25}
                          className={isActive ? (isDarkMode ? 'text-link-light' : 'text-link') : navIconClass}
                        />
                        <span className="text-[15px] font-light tracking-tight">{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="shrink-0 border-t border-white/10 p-4">
                  <button
                    type="button"
                    onPointerDown={captureTouchStart}
                    onPointerUp={(event) => runTouchAction(event, onToggleTheme)}
                    onClick={() => runClickAction(onToggleTheme)}
                    className={`flex w-full items-center justify-center gap-2 rounded-control border py-3 text-xs font-medium transition-[background,color,border-color,transform] active:scale-[0.99] ${
                      isDarkMode
                        ? 'border-white/[0.07] bg-white/[0.035] text-slate-300'
                        : 'border-white/60 bg-white/55 text-slate-600'
                    }`}
                  >
                    {isDarkMode ? <Sun size={16} strokeWidth={1.2} /> : <Moon size={16} strokeWidth={1.2} />}
                    {isDarkMode ? '浅色' : '深色'}
                  </button>
                </div>
              </SidePanelContainer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav
        aria-label="手机底部导航"
        className={`bambook-mobile-bottom-nav fixed inset-x-3 bottom-3 z-[380] grid items-center rounded-card-lg border px-2 pb-[max(env(safe-area-inset-bottom),0px)] pt-2 backdrop-blur-2xl ${
          isDarkMode
            ? 'border-white/[0.08] bg-deep/72 shadow-[0_26px_80px_rgba(0,0,0,0.34)]'
            : 'border-white/70 bg-white/78 shadow-[0_26px_80px_rgba(43,115,210,0.24)]'
        }`}
        style={{ gridTemplateColumns: `repeat(${bottomItems.length}, minmax(0, 1fr))` }}
      >
        {bottomItems.map((item) => {
          const Icon = item.icon;
          const isHome = item.type === 'home';
          const isActive = isHome ? menuOpen : optimisticView === item.id;
          const activateItem = () => {
            if (isHome) {
              setMenuOpen(true);
              return;
            }
            goToView(item.id);
          };
          return (
            <button
              key={isHome ? 'home' : item.id}
              type="button"
              aria-label={item.label}
              onPointerDown={captureTouchStart}
              onPointerUp={(event) => runTouchAction(event, activateItem)}
              onClick={() => runClickAction(activateItem)}
              className={`group relative flex h-[58px] flex-col items-center justify-center gap-1 rounded-2xl transition-[background,color,box-shadow,transform] duration-300 active:scale-95 ${
                isHome
                  ? '-mt-8 h-[72px]'
                  : ''
              } ${
                isActive
                  ? isDarkMode
                    ? 'text-link-light'
                    : 'text-link'
                  : isDarkMode
                    ? 'text-slate-400'
                    : 'text-slate-500'
              }`}
            >
              <span
                className={`flex items-center justify-center ${
                  isHome
                    ? `h-14 w-14 rounded-3xl border ${
                        isDarkMode
                          ? 'border-link-light/20 bg-[linear-gradient(135deg,rgba(35,75,120,0.88),rgba(14,36,68,0.82))] shadow-[0_16px_44px_rgba(74,144,226,0.24)]'
                          : 'border-white/80 bg-[linear-gradient(135deg,#ffffff,#e5f3ff)] shadow-[0_16px_44px_rgba(43,115,210,0.26)]'
                      }`
                    : ''
                }`}
              >
                <Icon size={isHome ? 25 : 21} strokeWidth={isHome ? 1.35 : 1.25} />
              </span>
              {!isHome && <span className="text-[10px] font-medium leading-none tracking-tight">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </>
  );
};

export default MobileWebNavigation;
