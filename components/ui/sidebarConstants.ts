/**
 * sidebarConstants — SIDEBAR_* 常量唯一真源
 *
 * Phase 0 架构收口：原双定义于 Sidebar.tsx 与 osCompiler/compiledSidebarTemplates.tsx，
 * 且经 Sidebar → compiledPrimitives → ContactList → Sidebar 形成循环依赖，
 * 导致顶层常量初始化触发 TDZ（Cannot access 'SIDEBAR_ACTIVE_CLASS' before initialization）。
 * 本文件仅依赖 bambookOsTokens，为无环叶子模块，所有消费方统一自此导入。
 *
 * BDS 纪律：hover 统一 --hover-darken、active 用 --active-darken（styles/bds/components.css v2.1.1）。
 */

import { BAMBOOK_OS } from './bambookOsTokens';

export const SIDEBAR_HOVER_CLASS = BAMBOOK_OS.controls.listRow.hover;
export const SIDEBAR_PRESS_CLASS = BAMBOOK_OS.controls.listRow.press;
export const SIDEBAR_ACTIVE_CLASS = BAMBOOK_OS.controls.selectedSurface.base;
export const SIDEBAR_ACTIVE_GLASS_CLASS = '';
export const SIDEBAR_ACTIVE_ICON_CLASS = 'text-current';
export const SIDEBAR_IDLE_TEXT_CLASS = '!text-[var(--text-secondary)]';
export const SIDEBAR_IDLE_ICON_CLASS = BAMBOOK_OS.controls.listRow.idleIcon;
export const SIDEBAR_AMBIENT_CLASS = '';
export const SIDEBAR_SETTINGS_ACTIVE_CLASS = SIDEBAR_ACTIVE_CLASS;
export const SIDEBAR_HARMONY_PANEL_CLASS = '';
