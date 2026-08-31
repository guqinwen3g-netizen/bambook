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
import { CompiledEdgeFade } from './ui/primitives/compiledPrimitives';

// Phase 0 收口：SIDEBAR_* 常量唯一真源迁至 ./ui/sidebarConstants（无环叶子模块），
// 此处 import 供本文件使用并 re-export 保持既有消费方（RelationsManager/ContactList/测试）
// import './Sidebar' 路径兼容。
import {
  SIDEBAR_HOVER_CLASS,
  SIDEBAR_PRESS_CLASS,
  SIDEBAR_ACTIVE_CLASS,
  SIDEBAR_ACTIVE_GLASS_CLASS,
  SIDEBAR_ACTIVE_ICON_CLASS,
  SIDEBAR_IDLE_TEXT_CLASS,
  SIDEBAR_IDLE_ICON_CLASS,
  SIDEBAR_AMBIENT_CLASS,
  SIDEBAR_SETTINGS_ACTIVE_CLASS,
  SIDEBAR_HARMONY_PANEL_CLASS,
} from './ui/sidebarConstants';

export {
  SIDEBAR_HOVER_CLASS,
  SIDEBAR_PRESS_CLASS,
  SIDEBAR_ACTIVE_CLASS,
  SIDEBAR_ACTIVE_GLASS_CLASS,
  SIDEBAR_ACTIVE_ICON_CLASS,
  SIDEBAR_IDLE_TEXT_CLASS,
  SIDEBAR_IDLE_ICON_CLASS,
  SIDEBAR_AMBIENT_CLASS,
  SIDEBAR_SETTINGS_ACTIVE_CLASS,
  SIDEBAR_HARMONY_PANEL_CLASS,
};

type SidebarBlueprint = {
  template: 'Sidebar';
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

export const compileSidebar = (): SidebarBlueprint => ({
  template: 'Sidebar',
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
      source: 'Sidebar.navScroll.edgeFade',
    },
  },
});

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
  const blueprint = React.useMemo(() => compileSidebar(), []);
  const isAdmin = hasRole('owner', 'admin');
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const navScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false);
  const [authUser, setAuthUser] = React.useState(() => getAuthState().user);

  React.useEffect(() => subscribe((next) => setAuthUser(next.user)), []);

  // 账户菜单关闭契约（对照通知中心抽屉）：Esc + 外点关闭。
  // 外点判定豁免触发钮（data-sidebar-account-bar）与菜单本体（data-sidebar-account-menu），
  // 触发钮自身的 onClick toggle 已处理"再点一次关闭"。
  React.useEffect(() => {
    if (!accountMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountMenuOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest('[data-sidebar-account-menu]') || el.closest('[data-sidebar-account-bar]')) return;
      setAccountMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [accountMenuOpen]);

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
  const accountMenuSurfaceClass = `${overlayMenu.surfaceBase} ${overlayMenu.surface}`;
  const accountMenuLayerClass = overlayMenu.surfaceLayer;
  const accountMenuItemClass = `${overlayMenu.itemBase} flex items-center gap-2 ${overlayMenu.item}`;
  const accountMenuIconClass = `transition-colors duration-[260ms] ${overlayMenu.icon}`;

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
      {/* motion 控制 opacity/x，与 aside 宽度 spring 同步（damping 25 / stiffness 150），
          button 跟随滑入滑出，不再"戳出来"；不再用 700ms CSS 过渡（与 spring 不同步） */}
      <motion.div
        initial={false}
        animate={{
          opacity: isCollapsed ? 1 : 0,
          x: isCollapsed ? 0 : -20,
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 150 }}
        className={`absolute left-0 top-0 bottom-0 w-16 z-10 flex flex-col items-center ${blueprint.collapsedRail.paddingClass}
          ${isCollapsed ? 'pointer-events-auto' : 'pointer-events-none'}`}
        data-sidebar-collapsed-rail
      >
        <button
          onClick={() => setIsCollapsed(false)}
          aria-label="展开侧边栏"
          data-sidebar-collapsed-expand-button
          className="group relative z-20 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--recessed-bg)] text-deep transition-[background,color,transform] duration-300 hover:scale-105 hover:bg-[var(--recessed-bg-strong)]"
        >
          <ChevronRight size={18} strokeWidth={1.25} />
        </button>

        <div className={`z-10 flex flex-col items-center gap-6 ${blueprint.collapsedRail.actionMarginClass}`} data-sidebar-collapsed-actions>
          {activeNavItems.slice(0, 4).map(item => {
            return (
              <button
                key={item.id}
                onClick={() => triggerViewChange(item.id)}
                aria-label={item.label}
                data-sidebar-collapsed-nav-button
                className={`relative group flex h-10 w-10 items-center justify-center overflow-hidden rounded-control p-0 transition-colors duration-200
                  text-[var(--os-adaptive-primary)]`}
                data-sidebar-adaptive-icon
              >
                <item.icon size={20} strokeWidth={1.25} className="relative z-10" />
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
          className={`absolute bottom-6 left-1/2 z-20 flex h-10 w-10 -translate-x-1/2 items-center justify-center overflow-hidden rounded-control transition-colors duration-200 hover:scale-105
            text-[var(--os-adaptive-primary)]`}
          aria-label="设置"
          data-sidebar-collapsed-settings
        >
          <Settings size={20} strokeWidth={1.25} className="relative z-10" />
        </button>
      </motion.div>

      {/* The Expanded Hub */}
      {/* 始终挂载，motion 控制 opacity/x 与 aside 宽度 spring 同步，内容跟随宽度动画滑入滑出
          （原条件渲染导致 button 直接出现/消失"戳出来"）。
          收起时 pointer-events-none + inert + aria-hidden，鼠标/键盘/读屏均不可达（与原卸载行为对齐）。
          壳无 backdrop-filter（desktopSidebarShellClass 纯布局），x 位移动画不触发磨砂快照失效 */}
      <motion.div
        ref={sidebarRef}
        initial={false}
        animate={{
          opacity: isCollapsed ? 0 : 1,
          x: isCollapsed ? 20 : 0,
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 150 }}
        inert={isCollapsed}
        aria-hidden={isCollapsed}
        className={`${BAMBOOK_OS.layout.desktopSidebarShellClass} app-sidebar-underlay-content relative z-10 min-h-0 overflow-hidden
          ${isCollapsed ? '!pointer-events-none' : ''}`}
        data-sidebar-underlay-content
        data-os-compiler-role="global-sidebar-underlay"
        data-os-compiler-source="CompiledSidebar.global-sidebar-underlay"
      >
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              aria-label="折叠侧边栏"
              data-sidebar-expanded-collapse-button
              className={`absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full text-os-adaptive-subtitle transition-colors duration-300 hover:bg-[rgb(var(--bambook-rdl-theme-rgb)/0.08)] hover:text-os-adaptive-primary`}
            >
              <ChevronLeft size={18} strokeWidth={1.25} />
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
                {groupedNavSections.map((section, sectionIndex) => (
                  <React.Fragment key={section.group}>
                    <div
                      data-sidebar-nav-group-label={section.group}
                      className={`select-none pl-5 pr-4 text-xs font-light tracking-wider text-os-adaptive-subtitle opacity-60 ${sectionIndex === 0 ? '' : 'pt-3'}`}
                    >
                      {section.label}
                    </div>
                    {section.items.map((item) => {
                      const isActive = currentView === item.id;
                      // W-PG-P7 收编：导航行高 54px → h-14（L2/L3 刻度化）
                      return (
                        <button
                          key={item.id}
                          onClick={() => triggerViewChange(item.id)}
                          data-sidebar-nav-item
                          data-sidebar-nav-active={isActive ? 'true' : 'false'}
                          className={`w-full h-14 group relative flex items-center overflow-visible pl-5 pr-4 py-0 rounded-control transition-[color,transform] duration-[320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]
                            ${isActive
                              ? 'text-[var(--text-primary)]'
                              : `${SIDEBAR_IDLE_TEXT_CLASS} ${SIDEBAR_HOVER_CLASS}`}
                            ${SIDEBAR_PRESS_CLASS}`}
                        >
                          {/* OS-level spring active sliding indicator */}
                          {isActive && (
                            <motion.div
                              layoutId="activeNavIndicator"
                              className={`absolute inset-0 rounded-control z-0
                                ${SIDEBAR_ACTIVE_CLASS}`}
                              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                            />
                          )}

                          <div className="relative z-10 flex items-center gap-4 pointer-events-none">
                            <item.icon
                              size={20}
                              strokeWidth={1.25}
                              data-sidebar-nav-icon
                              className={`transition-colors duration-300 ${isActive ? SIDEBAR_ACTIVE_ICON_CLASS : SIDEBAR_IDLE_ICON_CLASS}`}
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
      </motion.div>

      {/* Account Menu Popover — 材质（bds-frosted / backdrop-filter）与动画同元素承载。
          动画仅用 opacity，禁用 transform：transform 动画会让 Chrome 对 backdrop-filter
          缓存合成层快照，动画期间磨砂失效；纯 opacity 淡入可保证磨砂全程实时采样。 */}
      <AnimatePresence>
        {!isCollapsed && accountMenuOpen && (
              // bds-ok: 账户菜单弹层宽度 240px（=w-60 刻度），刻意设计宽度
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                data-os-compiler-role="sidebar-account-menu"
                data-os-compiler-source="compiledSidebarTemplates.account-menu"
                data-glass-edge-mask
                data-os-shadow-mode="flat"
                data-sidebar-account-menu=""
                className={`!absolute left-[15px] w-60 bottom-[99px] z-30 ${accountMenuSurfaceClass}`}
              >
                <div aria-hidden className={`pointer-events-none absolute inset-0 rounded-[inherit] ${accountMenuLayerClass}`} />
                  <button
                    type="button"
                    onClick={() => openSettingsTab('account')}
                    data-sidebar-account-menu-item
                    className={`relative z-10 ${accountMenuItemClass}`}
                  >
                    <User size={16} strokeWidth={1.5} className={accountMenuIconClass} />
                    <span data-ui-lab-wallpaper-contrast="primary" className="text-xs font-light">账号设置</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openSettingsTab('system')}
                    data-sidebar-account-menu-item
                    className={`relative z-10 ${accountMenuItemClass}`}
                  >
                    <Monitor size={16} strokeWidth={1.5} className={accountMenuIconClass} />
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
                      <Sun size={16} strokeWidth={1.5} className={accountMenuIconClass} />
                    ) : (
                      <Moon size={16} strokeWidth={1.5} className={accountMenuIconClass} />
                    )}
                    <span data-ui-lab-wallpaper-contrast="primary" className="text-xs font-light">{isDarkMode ? '切换浅色' : '切换深色'}</span>
                  </button>
              </motion.div>
            )}
      </AnimatePresence>
    </motion.aside>
  );
};

export default Sidebar;
