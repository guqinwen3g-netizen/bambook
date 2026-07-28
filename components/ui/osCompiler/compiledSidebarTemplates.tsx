import React from 'react';
import { View } from '../../../types';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sun,
  Moon,
  User,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Settings
} from 'lucide-react';
import { canAccessView, getAuthState, hasRole, subscribe } from '../../../services/authService';
import { getPrimaryNavigationModules } from '../../moduleRegistry';
import { BAMBOOK_OS } from '../bambookOsTokens';
import UserAvatar from '../UserAvatar';
import {
  CompiledDropdownMenu,
  CompiledEdgeFade,
} from './compiledPrimitives';

export const SIDEBAR_HOVER_DARK_CLASS = 'hover:bg-white/[0.055] hover:shadow-none';
export const SIDEBAR_HOVER_LIGHT_CLASS = 'hover:bg-white/44 hover:shadow-none';
export const SIDEBAR_PRESS_DARK_CLASS = 'active:scale-[0.98] active:bg-white/[0.04]';
export const SIDEBAR_PRESS_LIGHT_CLASS = 'active:scale-[0.98] active:bg-white/34';
export const SIDEBAR_ACTIVE_DARK_CLASS = BAMBOOK_OS.controls.selectedSurface.dark;
export const SIDEBAR_ACTIVE_LIGHT_CLASS = BAMBOOK_OS.controls.selectedSurface.light;
export const SIDEBAR_ACTIVE_GLASS_DARK_CLASS = '';
export const SIDEBAR_ACTIVE_GLASS_LIGHT_CLASS = '';
export const SIDEBAR_ACTIVE_ICON_DARK_CLASS = 'text-current';
export const SIDEBAR_ACTIVE_ICON_LIGHT_CLASS = 'text-current';
export const SIDEBAR_IDLE_TEXT_DARK_CLASS = '!text-slate-300';
export const SIDEBAR_IDLE_TEXT_LIGHT_CLASS = '!text-slate-600';
export const SIDEBAR_IDLE_ICON_DARK_CLASS = '!text-slate-400';
export const SIDEBAR_IDLE_ICON_LIGHT_CLASS = '!text-slate-500';
export const SIDEBAR_AMBIENT_DARK_CLASS = '';
export const SIDEBAR_AMBIENT_LIGHT_CLASS = '';
export const SIDEBAR_SETTINGS_ACTIVE_DARK_CLASS = SIDEBAR_ACTIVE_DARK_CLASS;
export const SIDEBAR_SETTINGS_ACTIVE_LIGHT_CLASS = SIDEBAR_ACTIVE_LIGHT_CLASS;
export const SIDEBAR_HARMONY_PANEL_DARK_CLASS = '';
export const SIDEBAR_HARMONY_PANEL_LIGHT_CLASS = '';

type CompiledSidebarBlueprint = {
  template: 'CompiledSidebar';
  source: 'Sidebar.ui-lab-1.0.contract';
  provenance: 'accepted';
  classContract: 'app-sidebar';
  width: { collapsed: number; expanded: number };
  layering: { role: 'underlay'; containerized: false };
  collapsedRail: {
    paddingClass: string;
    actionMarginClass: string;
  };
  navScroll: {
    edgeFade: {
      topHeight: number;
      bottomHeight: number;
      compilerRole: string;
      source: string;
    };
  };
};

export const compileSidebar = (): CompiledSidebarBlueprint => ({
  template: 'CompiledSidebar',
  source: 'Sidebar.ui-lab-1.0.contract',
  provenance: 'accepted',
  classContract: 'app-sidebar',
  width: { collapsed: 64, expanded: 232 },
  layering: { role: 'underlay', containerized: false },
  collapsedRail: {
    paddingClass: 'pt-8 pb-4',
    actionMarginClass: 'absolute inset-y-0 left-0 right-0 justify-center',
  },
  navScroll: {
    edgeFade: {
      topHeight: 28,
      bottomHeight: 28,
      compilerRole: 'sidebar-nav-edge-fade',
      source: 'CompiledSidebar.navScroll.edgeFade',
    },
  },
});

interface CompiledSidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  allowedViews?: readonly View[];
}

export const CompiledSidebar: React.FC<CompiledSidebarProps> = ({ currentView, onViewChange, isCollapsed, setIsCollapsed, isDarkMode, onToggleTheme, allowedViews }) => {
  const blueprint = React.useMemo(() => compileSidebar(), []);
  const isAdmin = hasRole('owner', 'admin');
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const navScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false);
  const [authUser, setAuthUser] = React.useState(() => getAuthState().user);

  React.useEffect(() => subscribe((next) => setAuthUser(next.user)), []);

  const triggerViewChange = (view: View) => {
    onViewChange(view);
  };

  const openSettingsTab = (tab: 'account' | 'system') => {
    setAccountMenuOpen(false);
    triggerViewChange(tab === 'account' ? View.AccountSettings : View.SystemSettings);
  };

  const activeNavItems = getPrimaryNavigationModules({ isAdmin, canAccessView, allowedViews })
    .map(moduleDefinition => ({
      id: moduleDefinition.view,
      icon: moduleDefinition.icon,
      label: moduleDefinition.productLabel,
    }));
  const accountName = authUser?.displayName || authUser?.email || 'Bambook 用户';
  const accountMeta = authUser?.email || authUser?.roles?.[0] || '账号设置';
  const overlayMenu = BAMBOOK_OS.controls.overlayMenu;
  const accountMenuSurfaceClass = `${overlayMenu.surfaceBase} ${isDarkMode ? overlayMenu.surfaceDark : overlayMenu.surfaceLight}`;
  const accountMenuLayerClass = isDarkMode ? overlayMenu.surfaceLayerDark : overlayMenu.surfaceLayerLight;
  const accountMenuItemClass = `${overlayMenu.itemBase} flex items-center gap-2 ${isDarkMode ? overlayMenu.itemDark : overlayMenu.itemLight}`;
  const accountMenuIconClass = `transition-colors duration-[260ms] ${isDarkMode ? overlayMenu.iconDark : overlayMenu.iconLight}`;

  return (
    <motion.aside
      initial={false}
      animate={{
        width: isCollapsed ? 64 : 232,
      }}
      transition={{ type: 'spring', damping: 25, stiffness: 150 }}
      data-sidebar-state={isCollapsed ? 'collapsed' : 'expanded'}
      data-os-compiler-template={blueprint.template}
      data-os-compiler-source={blueprint.source}
      data-os-compiler-provenance={blueprint.provenance}
      data-os-compiler-role="global-sidebar"
      data-os-adaptive-container="0"
      className="app-sidebar absolute left-0 top-0 bottom-0 z-10 flex-shrink-0 h-screen overflow-visible"
    >
      {/* The Neutral Spine */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-16 z-10 flex flex-col items-center ${blueprint.collapsedRail.paddingClass} transition-all duration-700 ease-in-out
          ${isCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        data-sidebar-collapsed-rail
      >
        <button
          onClick={() => setIsCollapsed(false)}
          aria-label="展开侧边栏"
          data-sidebar-collapsed-expand-button
          className="group relative z-20 flex h-10 w-10 items-center justify-center rounded-[20px] bg-[rgb(255_255_255/0.68)] text-[#0B1F3A] transition-[background,color,transform] duration-300 hover:scale-105 hover:bg-[rgb(255_255_255/0.84)]"
        >
          <ChevronRight size={18} strokeWidth={1.35} />
        </button>

        <div className={`z-10 flex flex-col items-center gap-6 ${blueprint.collapsedRail.actionMarginClass}`} data-sidebar-collapsed-actions>
          {activeNavItems.slice(0, 4).map(item => {
            return (
              <button
                key={item.id}
                onClick={() => triggerViewChange(item.id)}
                aria-label={item.label}
                data-sidebar-collapsed-nav-button
                className={`relative group flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl p-0 transition-all duration-300
                  text-[var(--os-adaptive-primary)]`}
                data-sidebar-adaptive-icon
              >
                <item.icon size={20} strokeWidth={1} className="relative z-10" />
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setIsCollapsed(false);
            openSettingsTab('system');
          }}
          className={`absolute bottom-6 left-1/2 z-20 flex h-10 w-10 -translate-x-1/2 items-center justify-center overflow-hidden rounded-control transition-all duration-300 hover:scale-105
            text-[var(--os-adaptive-primary)]`}
          aria-label="设置"
          data-sidebar-collapsed-settings
        >
          <Settings size={20} strokeWidth={1.25} className="relative z-10" />
        </button>
      </div>

      {/* The Expanded Hub */}
      {!isCollapsed && (
        <>
          <div
            ref={sidebarRef}
            className={`${BAMBOOK_OS.layout.desktopSidebarShellClass} app-sidebar-underlay-content relative z-10 min-h-0 overflow-hidden`}
            data-sidebar-underlay-content
            data-os-compiler-role="global-sidebar-underlay"
            data-os-compiler-source="CompiledSidebar.global-sidebar-underlay"
          >
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              aria-label="折叠侧边栏"
              data-sidebar-expanded-collapse-button
              className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full text-os-adaptive-subtitle transition-colors duration-300 hover:bg-[rgb(var(--bambook-rdl-theme-rgb)/0.08)] hover:text-os-adaptive-primary"
            >
              <ChevronLeft size={18} strokeWidth={1.35} />
            </button>

            {/* Nav Items */}
            <div className="relative z-10 flex-1 min-h-0" data-sidebar-nav-scroll-shell>
              <CompiledEdgeFade
                scrollRef={navScrollRef}
                isDarkMode={isDarkMode}
                variant="subtle"
                zIndex={12}
                topHeight={blueprint.navScroll.edgeFade.topHeight}
                bottomHeight={blueprint.navScroll.edgeFade.bottomHeight}
                compilerRole={blueprint.navScroll.edgeFade.compilerRole}
                source={blueprint.navScroll.edgeFade.source}
              />
              <div ref={navScrollRef} data-sidebar-nav-scroll className={`${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-sidebar-nav-scroll-viewport h-full min-h-0 px-4 pb-3.5 pt-14 space-y-1.5 overflow-y-auto no-scrollbar`}>
                {activeNavItems.map((item) => {
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => triggerViewChange(item.id)}
                      data-sidebar-nav-item
                      data-sidebar-nav-active={isActive ? 'true' : 'false'}
                      className={`w-full h-[54px] group relative flex items-center overflow-visible pl-[19px] pr-4 py-0 rounded-control transition-[color,transform] duration-[320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]
                        ${isActive
                          ? (isDarkMode ? 'text-white' : 'text-deep-alt')
                          : `${isDarkMode ? SIDEBAR_IDLE_TEXT_DARK_CLASS : SIDEBAR_IDLE_TEXT_LIGHT_CLASS} ${isDarkMode ? SIDEBAR_HOVER_DARK_CLASS : SIDEBAR_HOVER_LIGHT_CLASS}`}
                        ${isDarkMode ? SIDEBAR_PRESS_DARK_CLASS : SIDEBAR_PRESS_LIGHT_CLASS}`}
                    >
                      {/* OS-level spring active sliding indicator */}
                      {isActive && (
                        <motion.div
                          layoutId="activeNavIndicator"
                          className={`absolute inset-0 rounded-control z-0
                            ${isDarkMode ? SIDEBAR_ACTIVE_DARK_CLASS : SIDEBAR_ACTIVE_LIGHT_CLASS}`}
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        />
                      )}

                      <div className="relative z-10 flex items-center gap-[15px] pointer-events-none">
                        <item.icon
                          size={20}
                          strokeWidth={1}
                          data-sidebar-nav-icon
                          className={`transition-colors duration-300 ${isActive ? (isDarkMode ? SIDEBAR_ACTIVE_ICON_DARK_CLASS : SIDEBAR_ACTIVE_ICON_LIGHT_CLASS) : (isDarkMode ? SIDEBAR_IDLE_ICON_DARK_CLASS : SIDEBAR_IDLE_ICON_LIGHT_CLASS)}`}
                        />
                        <span data-sidebar-nav-label className={`text-sm font-light tracking-tight transition-[color,opacity] duration-300 ${isActive ? 'opacity-100' : 'opacity-80'}`}>
                          {item.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Utility Bar */}
            <div className="mt-auto shrink-0 p-4 relative z-10" data-sidebar-account-bar data-os-adaptive-container="1">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                className="group relative flex w-full items-center gap-3 px-3 py-2 rounded-inset text-left"
              >
                <UserAvatar
                  name={accountName}
                  email={authUser?.email}
                  avatarUrl={authUser?.avatarUrl}
                  isDarkMode={isDarkMode}
                  sizeClassName="h-11 w-11"
                  textClassName="text-sm"
                  className="relative z-10"
                  adaptive
                />
                <div className="relative z-10 min-w-0 flex-1">
                  <div className="truncate text-sm font-light text-[var(--os-adaptive-primary)]">{accountName}</div>
                  <div className="mt-0.5 truncate text-[10px] font-light text-[var(--os-adaptive-subtitle)]">{accountMeta}</div>
                </div>
              </button>
            </div>
          </div>

          {/* Account Menu Popover — 走 CompiledDropdownMenu：sibling-stack + caster
              + glass panel 三件套统一规范。motion 动画移除 scale，避免 transform
              触发 backdrop-filter cached snapshot 导致的"弹开瞬间无毛玻璃"。 */}
          <AnimatePresence>
            {accountMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ type: 'spring', damping: 24, stiffness: 180 }}
                className="!absolute left-[15px] w-[240px] bottom-[99px] z-30"
              >
                <CompiledDropdownMenu
                  compilerRole="sidebar-account-menu"
                  source="compiledSidebarTemplates.account-menu"
                  className={accountMenuSurfaceClass}
                  data-sidebar-account-menu=""
                >
                  <div aria-hidden className={`pointer-events-none absolute inset-0 rounded-[inherit] ${accountMenuLayerClass}`} />
                  <button
                    type="button"
                    onClick={() => openSettingsTab('account')}
                    data-sidebar-account-menu-item
                    className={`relative z-10 ${accountMenuItemClass}`}
                  >
                    <User size={15} strokeWidth={1.4} className={accountMenuIconClass} />
                    <span data-ui-lab-wallpaper-contrast="primary" className="text-xs font-light">账号设置</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openSettingsTab('system')}
                    data-sidebar-account-menu-item
                    className={`relative z-10 ${accountMenuItemClass}`}
                  >
                    <Monitor size={15} strokeWidth={1.4} className={accountMenuIconClass} />
                    <span data-ui-lab-wallpaper-contrast="primary" className="text-xs font-light">系统设置</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleTheme();
                      setAccountMenuOpen(false);
                    }}
                    data-sidebar-account-menu-item
                    className={`relative z-10 ${accountMenuItemClass}`}
                  >
                    {isDarkMode ? (
                      <Sun size={15} strokeWidth={1.4} className={accountMenuIconClass} />
                    ) : (
                      <Moon size={15} strokeWidth={1.4} className={accountMenuIconClass} />
                    )}
                    <span data-ui-lab-wallpaper-contrast="primary" className="text-xs font-light">{isDarkMode ? '切换浅色' : '切换深色'}</span>
                  </button>
                </CompiledDropdownMenu>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.aside>
  );
};
