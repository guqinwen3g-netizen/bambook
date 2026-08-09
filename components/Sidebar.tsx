import React from 'react';
import { View } from '../types';
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
import { canAccessView, getAuthState, hasRole, subscribe } from '../services/authService';
import { getPrimaryNavigationModules, groupPrimaryNavigationModules } from './moduleRegistry';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import UserAvatar from './ui/UserAvatar';

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
interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  allowedViews?: readonly View[];
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange, isCollapsed, setIsCollapsed, isDarkMode, onToggleTheme, allowedViews }) => {
  const isAdmin = hasRole('owner', 'admin');
  const sidebarRef = React.useRef<HTMLDivElement>(null);
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

  const primaryNavModules = getPrimaryNavigationModules({ isAdmin, canAccessView, allowedViews });
  const activeNavItems = primaryNavModules
    .map(moduleDefinition => ({
      id: moduleDefinition.view,
      icon: moduleDefinition.icon,
      label: moduleDefinition.productLabel,
    }));
  const groupedNavSections = groupPrimaryNavigationModules(primaryNavModules)
    .map(section => ({
      group: section.group,
      label: section.label,
      items: section.modules.map(moduleDefinition => ({
        id: moduleDefinition.view,
        icon: moduleDefinition.icon,
        label: moduleDefinition.productLabel,
      })),
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
      data-os-adaptive-container="0"
      className="app-sidebar absolute left-0 top-0 bottom-0 z-10 flex-shrink-0 h-screen overflow-visible"
    >
      {/* The Neutral Spine */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-16 z-10 flex flex-col items-center py-8 transition-all duration-700 ease-in-out
          ${isCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        data-sidebar-collapsed-rail
      >
        <button
          onClick={() => setIsCollapsed(false)}
          aria-label="展开侧边栏"
          data-sidebar-collapsed-expand-button
          className="group relative z-20 flex h-10 w-10 items-center justify-center rounded-[20px] bg-[rgb(255_255_255/0.68)] text-deep transition-[background,color,transform] duration-300 hover:scale-105 hover:bg-[rgb(255_255_255/0.84)]"
        >
          <ChevronRight size={18} strokeWidth={1.35} />
        </button>

        <div className="absolute inset-y-0 left-0 right-0 z-10 flex flex-col items-center justify-center gap-6" data-sidebar-collapsed-actions>
          {activeNavItems.slice(0, 4).map(item => {
            return (
              <button
                key={item.id}
                onClick={() => triggerViewChange(item.id)}
                className={`relative group flex items-center justify-center overflow-hidden rounded-control p-2 transition-all duration-300
                  text-os-adaptive-primary`}
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
            {/* 阶段 IA：按业务流分组渲染，组序见 moduleRegistry BAMBOOK_NAV_GROUP_ORDER */}
            <div data-sidebar-nav-scroll className="bambook-sidebar-nav-scroll-viewport px-4 pb-3.5 pt-14 space-y-1.5 overflow-y-auto no-scrollbar flex-1 relative z-10">
              {groupedNavSections.map((section, sectionIndex) => (
                <React.Fragment key={section.group}>
                  <div
                    data-sidebar-nav-group-label={section.group}
                    className={`select-none pl-[19px] pr-4 text-xs font-light tracking-wider text-os-adaptive-subtitle opacity-60 ${sectionIndex === 0 ? '' : 'pt-3'}`}
                  >
                    {section.label}
                  </div>
                  {section.items.map((item) => {
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
                </React.Fragment>
              ))}
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

          {/* Account Menu Popover — sibling placement to avoid overflow-hidden shadow clipping */}
          <AnimatePresence>
            {accountMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.985 }}
                transition={{ type: 'spring', damping: 24, stiffness: 180 }}
                data-sidebar-account-menu
                className={`!absolute left-10 w-[240px] bottom-[104px] z-30 ${accountMenuSurfaceClass}`}
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
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.aside>
  );
};

export default Sidebar;
