
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Relation, RelationCategory, View } from '../types';
import { apiService } from '../services/apiService';
import {
  Users, Search, Plus, Building2, User,
  MoreHorizontal, Edit2, Trash2, X, Save,
  ChevronLeft, ChevronRight, ChevronDown,
  Briefcase, Landmark, Handshake, Globe2, Box, ArrowRight, Map,
  LayoutGrid, List, Navigation, RefreshCw, GitBranch,
  type LucideIcon,
} from 'lucide-react';
import { TraceabilityPanel } from './TraceabilityPanel';
import ContactList from './ui/ContactList';
import DetailPanel from './ui/DetailPanel';
import OrgChart, { isDescendantContact } from './ui/OrgChart';
import CustomSelect from './ui/CustomSelect';
import CapsuleDateInput from './ui/CapsuleDateInput';
import {
  SIDE_PANEL_SPOTLIGHT_DARK_COLOR,
  SIDE_PANEL_SPOTLIGHT_DARK_SIZE,
  SIDE_PANEL_SPOTLIGHT_LIGHT_COLOR,
  SIDE_PANEL_SPOTLIGHT_LIGHT_SIZE,
} from './ui/SidePanelContainer';
import { SpotlightCard } from './ui/SpotlightCard';
import { useGlassSurfaceEdgeMasks } from './ui/useGlassSurfaceEdgeMasks';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { OS_MATERIAL } from './ui/osMaterial';
import { CompiledSurfacePanel } from './ui/primitives/compiledSurfacePrimitives';
import { CompiledTableShell } from './ui/primitives/compiledPrimitives';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { PageHeader } from './ui/PageHeader';
import { motion } from 'framer-motion';
import { resolveCoordinates, extractAddressFromRelation, type ResolvedCoordinates } from '../utils/geoResolveService';
import {
  SIDEBAR_ACTIVE_CLASS,
  SIDEBAR_HOVER_CLASS,
  SIDEBAR_PRESS_CLASS,
} from './Sidebar';
import { primeSuppliersFactoryPreview } from './SuppliersManager';

interface RelationsManagerProps {
  relations: Relation[];
  onUpdate: (relations: Relation[], modified?: Relation) => void;
  isDarkMode?: boolean;
  isMobile?: boolean;
  /** 侧边栏是否收起：用于在 Electron 下避开窗口控制键热区 */
  sidebarCollapsed?: boolean;
  /** 数据中心 API 入口，用于删除等写入操作直连后端 */
  cloudEndpoint?: string;
  /** 跨模块导航（供应商组织详情「工厂档案」直达供应商管理） */
  onNavigate?: (view: View) => void;
}

type RelationFormSectionId = 'basic' | 'contact' | 'address' | 'finance' | 'personal' | 'notes';
type RelationNavLevel = 'category' | 'organizations' | 'detail';
type RelationListDisplayMode = 'grid' | 'table';
export type RelationSortMode = 'recent' | 'rating' | 'contacts' | 'name';
type RelationTagRow = { id: string; value: string };
type BackupContactRow = { id: string; name: string; email: string; phone: string; note: string };
type ShipToRow = { id: string; contactName: string; city: string; postcode: string; phone: string; address: string; note: string };
type OtherContactRow = { id: string; type: string; value: string };

const RELATIONS_PREVIEW_STATE_KEY = 'bambook_relations_preview_state';
const RELATION_CATEGORY_IDS: RelationCategory[] = ['Supplier', 'Customer', 'Agent', 'Partner', 'Government', 'Internal', 'Other'];
export const RELATIONS_CARD_GRID_EDGE_FADE_TOP_OFFSET = 64;
export type RelationCategoryDefinition = { id: RelationCategory; label: string; icon: LucideIcon; color: string; desc: string };
export const RELATION_CATEGORY_DEFINITIONS: RelationCategoryDefinition[] = [
  { id: 'Supplier', label: '供应商', icon: Box, color: 'text-[var(--text-secondary)] bg-[var(--recessed-bg)]', desc: '原材料、零部件及生产服务供应商库。' },
  { id: 'Customer', label: '客户', icon: Users, color: 'text-[var(--text-secondary)] bg-[var(--recessed-bg)]', desc: 'B2B 经销商与战略大客户名录。' },
  { id: 'Agent', label: '代理商', icon: Briefcase, color: 'text-[var(--text-secondary)] bg-[var(--recessed-bg)]', desc: '区域总代与分销渠道合作伙伴。' },
  { id: 'Partner', label: '合作伙伴', icon: Handshake, color: 'text-[var(--text-secondary)] bg-[var(--recessed-bg)]', desc: '技术、物流及联合研发战略伙伴。' },
  { id: 'Government', label: '政府/机构', icon: Landmark, color: 'text-[var(--text-secondary)] bg-[var(--recessed-bg)]', desc: '监管部门、行业协会与标准组织。' },
  { id: 'Other', label: '其他', icon: Globe2, color: 'text-[var(--text-secondary)] bg-[var(--recessed-bg)]', desc: '媒体、咨询机构及其他利益相关方。' },
];

type RelationsPreviewState = {
  navLevel?: RelationNavLevel;
  selectedCategory?: RelationCategory | null;
  selectedOrgId?: string | null;
  selectedContactId?: string | null;
  searchTerm?: string;
  activeTab?: 'contacts' | 'structure';
  relationListDisplayMode?: RelationListDisplayMode;
  relationSortMode?: RelationSortMode;
  categoryScrollTop?: number;
  listScrollTop?: number;
};

const isRelationCategory = (value: unknown): value is RelationCategory =>
  typeof value === 'string' && RELATION_CATEGORY_IDS.includes(value as RelationCategory);

const readRelationsPreviewState = (): RelationsPreviewState => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(RELATIONS_PREVIEW_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RelationsPreviewState;
    return {
      navLevel: parsed.navLevel === 'organizations' || parsed.navLevel === 'detail' || parsed.navLevel === 'category' ? parsed.navLevel : undefined,
      selectedCategory: isRelationCategory(parsed.selectedCategory) ? parsed.selectedCategory : null,
      selectedOrgId: typeof parsed.selectedOrgId === 'string' ? parsed.selectedOrgId : null,
      selectedContactId: typeof parsed.selectedContactId === 'string' ? parsed.selectedContactId : null,
      searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : '',
      activeTab: parsed.activeTab === 'structure' ? 'structure' : 'contacts',
      relationListDisplayMode: parsed.relationListDisplayMode === 'table' ? 'table' : 'grid',
      relationSortMode: parsed.relationSortMode === 'rating' || parsed.relationSortMode === 'contacts' || parsed.relationSortMode === 'name' ? parsed.relationSortMode : 'recent',
      categoryScrollTop: Number.isFinite(parsed.categoryScrollTop) ? parsed.categoryScrollTop : 0,
      listScrollTop: Number.isFinite(parsed.listScrollTop) ? parsed.listScrollTop : 0,
    };
  } catch {
    return {};
  }
};

const writeRelationsPreviewState = (state: RelationsPreviewState) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(RELATIONS_PREVIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Dev-preview continuity only; ignore storage failures.
  }
};

/**
 * 阶段 IA-2：跨模块跳转关系智库指定组织详情。
 * 调用方在触发视图切换（onNavigate(View.Relations)）前调用，
 * Relations 挂载时经 preview state 直接落在该组织详情的联系人 Tab。
 * category 必传：详情页返回上一级落在该分类的组织列表——缺省时组织列表
 * 因 selectedCategory=null 渲染为空（"暂无组织"），返回栈断链。
 */
export const primeRelationsOrgDetailPreview = (orgId: string, category?: RelationCategory | null) => {
  const prev = readRelationsPreviewState();
  writeRelationsPreviewState({
    ...prev,
    navLevel: 'detail',
    selectedOrgId: orgId,
    selectedCategory: category ?? prev.selectedCategory ?? null,
    selectedContactId: null,
    activeTab: 'contacts',
  });
};

const relationSortOptions: Array<{ value: RelationSortMode; label: string }> = [
  { value: 'recent', label: '最近互动' },
  { value: 'rating', label: 'Tier 高到低' },
  { value: 'contacts', label: '联系人多到少' },
  { value: 'name', label: '名称 A-Z' },
];

const compareRelationIdentity = (a: Relation, b: Relation) => {
  const byName = (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return (a.id || '').localeCompare(b.id || '', 'en', { sensitivity: 'base' });
};

export const compareRelationsForList = (
  a: Relation,
  b: Relation,
  sortMode: RelationSortMode,
  getContactCount: (orgId: string) => number = () => 0,
) => {
  let primary = 0;
  if (sortMode === 'rating') primary = (b.rating || 0) - (a.rating || 0);
  else if (sortMode === 'contacts') primary = getContactCount(b.id) - getContactCount(a.id);
  else if (sortMode === 'name') primary = (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' });
  else primary = (b.lastInteraction || 0) - (a.lastInteraction || 0);

  return primary || compareRelationIdentity(a, b);
};

const organizationFormSections: { id: RelationFormSectionId; label: string; desc: string }[] = [
  { id: 'basic', label: '基础信息', desc: '名称、类别、等级、简介' },
  { id: 'contact', label: '联系方式', desc: '官网、主联系人、备用联系' },
  { id: 'address', label: '地址信息', desc: '注册地址、Bill To、Ship To' },
  { id: 'finance', label: '财务信息', desc: '条款、币种、税号、额度' },
  { id: 'notes', label: '备注偏好', desc: '交易偏好与合作注意' },
];

const contactFormSections: { id: RelationFormSectionId; label: string; desc: string }[] = [
  { id: 'basic', label: '基础信息', desc: '姓名、职位、部门、汇报线' },
  { id: 'contact', label: '联系方式', desc: '电话、手机、微信、WhatsApp' },
  { id: 'personal', label: '个人信息', desc: '生日、语言、个人备注' },
  { id: 'notes', label: '备注偏好', desc: '沟通偏好与注意事项' },
];

const paymentTermOptions = [
  { value: 'T/T 30%+70%', label: 'T/T 30%+70%' },
  { value: 'Net 30', label: 'Net 30' },
  { value: 'Net 60', label: 'Net 60' },
  { value: 'L/C at Sight', label: 'L/C at Sight' },
  { value: 'O/A 30', label: 'O/A 30 Days' },
  { value: 'Cash', label: '现金' },
];

const currencyOptions = [
  { value: 'USD', label: 'USD 美元' },
  { value: 'CNY', label: 'CNY 人民币' },
  { value: 'EUR', label: 'EUR 欧元' },
  { value: 'GBP', label: 'GBP 英镑' },
];

const languageOptions = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
];

const RELATIONS_CLEAR_REGION_STYLE: React.CSSProperties = {
  background: 'transparent',
  boxShadow: 'none',
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
};

export const RELATIONS_TITLE_BAR_CLASS = BAMBOOK_OS.layout.desktopTitleBarClass;
export const RELATIONS_PAGE_X_NORMAL_CLASS = BAMBOOK_OS.layout.desktopPageXClass;
export const RELATIONS_PAGE_X_COLLAPSED_CLASS = BAMBOOK_OS.layout.desktopPageXClass;
export const RELATIONS_TITLE_SAFE_LEFT_STYLE: React.CSSProperties = {
  paddingLeft: 'max(2rem, calc(152px - (100vw - 100%)))',
};
export const RELATIONS_TOOLBAR_X_NORMAL_CLASS = 'mx-auto';
export const RELATIONS_TOOLBAR_X_COLLAPSED_CLASS = 'mx-auto';
export const RELATIONS_CARD_COLUMN_WIDTH = BAMBOOK_OS.layout.relationsCardColumnWidth;
export const RELATIONS_CARD_COLUMN_GAP = BAMBOOK_OS.layout.relationsCardColumnGap;
export const RELATIONS_CATEGORY_CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,316px)] justify-center gap-6 content-start';
export const RELATIONS_CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,316px)] justify-center gap-6 content-start';
export const RELATIONS_MOBILE_CATEGORY_GRID_CLASS = 'grid grid-cols-2 gap-3 content-start';
export const RELATIONS_MOBILE_CATEGORY_CARD_CLASS = 'p-4 h-[190px] rounded-inset';
export const RELATIONS_TOOLBAR_OFFSET_CLASS = 'mt-1';
export const RELATIONS_TOOLBAR_CLASS = `${BAMBOOK_OS.controls.toolbar.base} max-w-[560px]`;
export const RELATIONS_TOOLBAR_CONTENT_CLASS = BAMBOOK_OS.controls.toolbar.content;
export const RELATIONS_TOOLBAR_AMBIENT_CLASS = BAMBOOK_OS.controls.toolbar.ambient;
export const RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS = 'w-full min-w-[180px] max-w-[320px] flex-[0_1_320px]';
export const RELATIONS_TOOLBAR_SEARCH_EXPANDED_CLASS = RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS;
export const RELATIONS_TOOLBAR_SEARCH_SHELL_CLASS = 'relative h-9 min-w-0 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-within:translate-y-[1px]';
export const RELATIONS_TOOLBAR_VIEW_GROUP_CLASS = 'ml-auto flex h-9 shrink-0 items-center gap-1';
export const RELATIONS_TOOLBAR_SORT_CLASS = 'w-[104px] shrink-0';
export const RELATIONS_TOOLBAR_SEGMENT_CLASS = 'relative h-9 shrink-0 overflow-visible rounded-none p-0 flex items-center';
export const RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS = `relative z-20 h-9 w-7 rounded-none bg-transparent border-0 shadow-none text-[10px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label} flex items-center justify-center transition-[color,opacity,filter,transform] duration-200 ease-out active:translate-y-[1px]`;
export const RELATIONS_TOOLBAR_SEGMENT_ACTIVE_CLASS = 'text-[var(--os-vnext-brand-blue)] opacity-100 drop-shadow-none';
export const RELATIONS_TOOLBAR_CONTROL_CLASS = BAMBOOK_OS.controls.stateControl.base;
export const RELATIONS_TOOLBAR_SURFACE_CLASS = BAMBOOK_OS.controls.toolbar.surface;
export const RELATIONS_TOOLBAR_CONTROL_SELECTED_CLASS = SIDEBAR_ACTIVE_CLASS;
export const RELATIONS_CATEGORY_CARD_HIGHLIGHT_CLASS = SIDEBAR_ACTIVE_CLASS;
export const RELATIONS_CATEGORY_CARD_HIGHLIGHT_POSITION_CLASS = 'inset-0 rounded-[inherit]';
export const RELATIONS_CATEGORY_CARD_CLASS = `bds-surface ${SIDEBAR_HOVER_CLASS}`;
export const RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR = BAMBOOK_OS.spotlight.cardDarkColor;
export const RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR = BAMBOOK_OS.spotlight.cardLightColor;
export const RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_SIZE = SIDE_PANEL_SPOTLIGHT_DARK_SIZE;
export const RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_SIZE = SIDE_PANEL_SPOTLIGHT_LIGHT_SIZE;
export const RELATIONS_TOOLBAR_CONTROL_IDLE_CLASS = `${RELATIONS_TOOLBAR_CONTROL_CLASS} text-[var(--text-tertiary)] ${SIDEBAR_HOVER_CLASS} ${SIDEBAR_PRESS_CLASS}`;
export const RELATIONS_TOOLBAR_SEARCH_CLASS = BAMBOOK_OS.controls.toolbar.search;
export const RELATIONS_TOOLBAR_SPOTLIGHT_DARK_COLOR = RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR;
export const RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_COLOR = RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR;
export const RELATIONS_TOOLBAR_SPOTLIGHT_DARK_SIZE = BAMBOOK_OS.controls.toolbar.spotlightDarkSize;
export const RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_SIZE = BAMBOOK_OS.controls.toolbar.spotlightLightSize;
export const RELATIONS_TITLE_ICON_BUTTON_CLASS = BAMBOOK_OS.controls.title.iconButton;
export const RELATIONS_TITLE_ACTION_BUTTON_CLASS = BAMBOOK_OS.controls.title.actionButton;
export const RELATIONS_TITLE_ARROW_ICON_SIZE = 18;
export const RELATIONS_TITLE_ARROW_STROKE_WIDTH = 1.4;
export const RELATIONS_TITLE_NAV_GROUP_CLASS = 'flex h-full items-center gap-1.5 min-w-0';
export const RELATIONS_TITLE_BACK_NAV_GROUP_CLASS = 'flex h-full items-center gap-0.5 -ml-3 min-w-0';
export const RELATIONS_TITLE_BACK_BUTTON_CLASS = `${RELATIONS_TITLE_ICON_BUTTON_CLASS} !w-7`;
export const RELATIONS_TITLE_SEPARATOR_CLASS = 'h-9 w-5 flex items-center justify-center shrink-0';
export const RELATIONS_TITLE_PAGE_LABEL_CLASS = BAMBOOK_OS.controls.title.pageLabel;
export const RELATIONS_TITLE_TEXT_BUTTON_CLASS = 'h-9 flex items-center shrink-0 bg-transparent border-0 p-0 rounded-none shadow-none transition-colors';
export const RELATIONS_TITLE_SECTION_BUTTON_CLASS = `${RELATIONS_TITLE_PAGE_LABEL_CLASS} bg-transparent border-0 p-0 rounded-none shadow-none transition-colors`;
export const RELATIONS_TITLE_SPOTLIGHT_DARK_COLOR = RELATIONS_CATEGORY_CARD_SPOTLIGHT_DARK_COLOR;
export const RELATIONS_TITLE_SPOTLIGHT_LIGHT_COLOR = RELATIONS_CATEGORY_CARD_SPOTLIGHT_LIGHT_COLOR;
export const RELATIONS_TITLE_SPOTLIGHT_DARK_SIZE = BAMBOOK_OS.controls.title.spotlightDarkSize;
export const RELATIONS_TITLE_SPOTLIGHT_LIGHT_SIZE = BAMBOOK_OS.controls.title.spotlightLightSize;
export const RELATIONS_TITLE_BUTTON_CLASS = `bg-transparent !border-transparent shadow-none text-[var(--os-adaptive-primary)] opacity-70 hover:opacity-100 ${SIDEBAR_HOVER_CLASS} ${SIDEBAR_PRESS_CLASS} active:scale-[0.98]`;
export const RELATIONS_TITLE_VIEW_SWITCH_CLASS = BAMBOOK_OS.controls.title.viewSwitch;
export const RELATIONS_TITLE_VIEW_SWITCH_BUTTON_CLASS = BAMBOOK_OS.controls.title.viewSwitchButton;
export const RELATIONS_FORM_TITLE_BAR_CLASS = `${RELATIONS_TITLE_BAR_CLASS} ${BAMBOOK_OS.layout.desktopTitleBarInsetClass} flex`;
export const RELATIONS_FORM_TITLE_CRUMB_CLASS = `h-9 flex items-center gap-1.5 min-w-0 text-[11px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label}`;
export const RELATIONS_FORM_TITLE_HEADING_CLASS = RELATIONS_TITLE_PAGE_LABEL_CLASS;
export const RELATIONS_FORM_TITLE_SECONDARY_BUTTON_CLASS = `h-9 px-3 rounded-full border flex items-center justify-center shrink-0 transition-colors text-[11px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label}`;
export const RELATIONS_FORM_TITLE_SUBMIT_BUTTON_CLASS = `h-9 px-4 rounded-full border flex items-center justify-center gap-2 shrink-0 transition-colors text-[11px] ${BAMBOOK_OS.typography.weight.ui} ${BAMBOOK_OS.typography.tracking.label}`;
export const RELATIONS_FORM_PANEL_CLASS = 'scroll-mt-28 p-5 bambook-relations-form-panel';
export const RELATIONS_FORM_MAP_PANEL_CLASS = 'p-4 bambook-relations-form-map-panel';
export const RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING = 'width';
export const RELATIONS_FORM_FIELD_CLASS = BAMBOOK_OS.controls.recessedField.base;
export const RELATIONS_PANEL_DIVIDER_CLASS = BAMBOOK_OS.tone.divider.panel;
export const RELATIONS_PROGRESS_TRACK_CLASS = BAMBOOK_OS.tone.surface.progressTrack;
export const RELATIONS_FORM_MAP_INDEX_CLASS = `${OS_MATERIAL.insetSurface} ${BAMBOOK_OS.tone.surface.formMapIndex}`;
export const RELATIONS_FORM_NESTED_ROW_CLASS = OS_MATERIAL.insetSurface;
export const RELATIONS_FORM_ICON_ADD_CLASS = BAMBOOK_OS.controls.formIconButton.add;
export const RELATIONS_FORM_ICON_REMOVE_CLASS = BAMBOOK_OS.controls.formIconButton.remove;
export const RELATIONS_FORM_ICON_COMPACT_REMOVE_CLASS = BAMBOOK_OS.controls.formIconButton.compactRemove;
export const RELATIONS_FORM_INLINE_DANGER_CLASS = BAMBOOK_OS.controls.formIconButton.inlineDanger;
export const RELATIONS_FORM_QUIET_ACTION_CLASS = BAMBOOK_OS.controls.formIconButton.quietAction;
export const RELATIONS_COORDINATE_PANEL_CLASS = BAMBOOK_OS.tone.status.coordinate.panel;
export const RELATIONS_COORDINATE_ICON_CLASS = BAMBOOK_OS.tone.status.coordinate.icon;
export const RELATIONS_BRAND_INLINE_CLASS = BAMBOOK_OS.tone.text.brandInline;
export const RELATIONS_FORM_LABEL_CLASS = BAMBOOK_OS.tone.text.formLabel;
export const RELATIONS_FORM_SECTION_TITLE_CLASS = 'text-[var(--text-primary)]';
export const RELATIONS_ORGANIZATION_TIER_BADGE_CLASS = BAMBOOK_OS.tone.chip.organizationTier;
export const RELATIONS_ORGANIZATION_COMPLETION_DONE_CLASS = BAMBOOK_OS.tone.status.organizationCompletion.done;
export const RELATIONS_ORGANIZATION_COMPLETION_MISSING_CLASS = BAMBOOK_OS.tone.status.organizationCompletion.missing;
export const RELATIONS_TABLE_HEADER_CLASS = BAMBOOK_OS.controls.table.header;
export const RELATIONS_TABLE_ROW_HOVER_CLASS = BAMBOOK_OS.controls.table.rowHover;
export const RELATIONS_TABLE_ROW_SEPARATOR_CLASS = BAMBOOK_OS.controls.table.rowSeparator;
export const RELATIONS_TABLE_CELL_MUTED_CLASS = BAMBOOK_OS.controls.table.cellMuted;
export const RELATIONS_TABLE_EDIT_ACTION_CLASS = BAMBOOK_OS.controls.table.editAction;
export const RELATIONS_TABLE_EMPTY_ACTION_CLASS = BAMBOOK_OS.controls.table.emptyAction;

export const getRelationsCardRowWidth = (availableWidth: number) => {
  if (availableWidth <= 0) return RELATIONS_CARD_COLUMN_WIDTH;
  const columns = Math.max(1, Math.floor((availableWidth + RELATIONS_CARD_COLUMN_GAP) / (RELATIONS_CARD_COLUMN_WIDTH + RELATIONS_CARD_COLUMN_GAP)));
  return Math.min(availableWidth, columns * RELATIONS_CARD_COLUMN_WIDTH + (columns - 1) * RELATIONS_CARD_COLUMN_GAP);
};

export const getRelationsCoordinateStatusClass = (
  source: 'existing' | 'city' | 'postcode' | 'address_keyword' | 'fallback'
) => {
  if (source === 'existing') {
    return BAMBOOK_OS.tone.status.coordinate.saved;
  }
  if (source === 'city') {
    return BAMBOOK_OS.tone.status.coordinate.city;
  }
  if (source === 'postcode') {
    return BAMBOOK_OS.tone.status.coordinate.postcode;
  }
  return BAMBOOK_OS.tone.status.coordinate.fallback;
};

export const getRelationsOrganizationCompletionClass = (isComplete: boolean) => {
  if (isComplete) {
    return RELATIONS_ORGANIZATION_COMPLETION_DONE_CLASS;
  }
  return RELATIONS_ORGANIZATION_COMPLETION_MISSING_CLASS;
};

type RelationsTitleSpotlightButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  isDarkMode: boolean;
  wrapperClassName: string;
};

export const RelationsTitleSpotlightButton: React.FC<RelationsTitleSpotlightButtonProps> = ({
  isDarkMode,
  wrapperClassName,
  children,
  ...buttonProps
}) => (
  <SpotlightCard
    spotlightColor={isDarkMode ? RELATIONS_TITLE_SPOTLIGHT_DARK_COLOR : RELATIONS_TITLE_SPOTLIGHT_LIGHT_COLOR}
    spotlightSize={isDarkMode ? RELATIONS_TITLE_SPOTLIGHT_DARK_SIZE : RELATIONS_TITLE_SPOTLIGHT_LIGHT_SIZE}
    idleSpotlightOpacity={0}
    activeSpotlightOpacity={1}
    className={wrapperClassName}
  >
    <button
      {...buttonProps}
      data-ui-lab-wallpaper-contrast="primary"
      className="relative z-10 h-full w-full rounded-[inherit] flex items-center justify-center gap-2 text-inherit"
    >
      {children}
    </button>
  </SpotlightCard>
);

const RelationsManager: React.FC<RelationsManagerProps> = ({ relations, onUpdate, isDarkMode = false, isMobile = false, sidebarCollapsed = false, cloudEndpoint, onNavigate }) => {
  const [previewState] = useState(readRelationsPreviewState);
  // Navigation State
  const [navLevel, setNavLevel] = useState<RelationNavLevel>(() => previewState.navLevel || 'category');
  const [selectedCategory, setSelectedCategory] = useState<RelationCategory | null>(() => previewState.selectedCategory || null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() => previewState.selectedOrgId || null);

  // UI State
  const [selectedContactId, setSelectedContactId] = useState<string | null>(() => previewState.selectedContactId || null);
  const [searchTerm, setSearchTerm] = useState(() => previewState.searchTerm || '');
  const [activeTab, setActiveTab] = useState<'contacts' | 'structure'>(() => previewState.activeTab || 'contacts');
  const [relationListDisplayMode, setRelationListDisplayMode] = useState<RelationListDisplayMode>(() => previewState.relationListDisplayMode || 'grid');
  const [relationSortMode, setRelationSortMode] = useState<RelationSortMode>(() => previewState.relationSortMode || 'recent');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showTracePanel, setShowTracePanel] = useState(false);
  const [editingItem, setEditingItem] = useState<Relation | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [relationSaveError, setRelationSaveError] = useState<string | null>(null);
  const [relationBusy, setRelationBusy] = useState(false);
  const [tagRows, setTagRows] = useState<RelationTagRow[]>([{ id: 'tag-0', value: '' }]);
  const [backupContactRows, setBackupContactRows] = useState<BackupContactRow[]>([{ id: 'backup-0', name: '', email: '', phone: '', note: '' }]);
  const [shipToRows, setShipToRows] = useState<ShipToRow[]>([{ id: 'shipto-0', contactName: '', city: '', postcode: '', phone: '', address: '', note: '' }]);
  const [otherContactRows, setOtherContactRows] = useState<OtherContactRow[]>([{ id: 'oc-0', type: '', value: '' }]);
  const [formSelectValues, setFormSelectValues] = useState<Record<string, string>>({});
  const [birthdayDraft, setBirthdayDraft] = useState<string>('');
  const [resolvedCoords, setResolvedCoords] = useState<ResolvedCoordinates | null>(null);
  const relationCategoryScrollRef = useRef<HTMLDivElement | null>(null);
  const relationListScrollRef = useRef<HTMLDivElement | null>(null);
  // 静止遮罩外壳：边缘淡出 mask 挂在外壳上而非滚动容器自身——滚动时遮罩层无需
  // 逐帧重栅格化，避免与 main 圆角裁剪 + 侧栏 backdrop-filter 在左缘圆角区叠加
  // 产生阶梯残影（Chromium 对运动中的 masked 层合成路径差异，随内核版本忽有忽无）
  const relationCategoryMaskRef = useRef<HTMLDivElement | null>(null);
  const relationListMaskRef = useRef<HTMLDivElement | null>(null);
  const relationTableScrollRef = useRef<HTMLDivElement | null>(null);
  const relationFormScrollRef = useRef<HTMLDivElement | null>(null);
  const relationFormContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    writeRelationsPreviewState({
      ...readRelationsPreviewState(),
      navLevel,
      selectedCategory,
      selectedOrgId,
      selectedContactId,
      searchTerm,
      activeTab,
      relationListDisplayMode,
      relationSortMode,
    });
  }, [activeTab, navLevel, relationListDisplayMode, relationSortMode, searchTerm, selectedCategory, selectedContactId, selectedOrgId]);

  // 卸载时清除 preview state：正常进入关系智库始终回到分类卡片页（navLevel='category'）。
  // 跨模块跳转（CRM/Suppliers 经 primeRelationsOrgDetailPreview 预填）在视图切换前写入，挂载时照常恢复。
  useEffect(() => {
    return () => {
      try {
        sessionStorage.removeItem(RELATIONS_PREVIEW_STATE_KEY);
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const scrollKey = navLevel === 'category'
      ? 'categoryScrollTop'
      : navLevel === 'organizations'
        ? 'listScrollTop'
        : null;
    const element = navLevel === 'category'
      ? relationCategoryScrollRef.current
      : navLevel === 'organizations'
        ? relationListScrollRef.current
        : null;

    if (!scrollKey || !element) return;

    const savedTop = readRelationsPreviewState()[scrollKey] || 0;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = savedTop;
    });
    const saveScroll = () => {
      writeRelationsPreviewState({
        ...readRelationsPreviewState(),
        [scrollKey]: element.scrollTop,
      });
    };

    element.addEventListener('scroll', saveScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener('scroll', saveScroll);
    };
  }, [navLevel, relationListDisplayMode]);

  // 分类/组织网格视图的淡出已统一改由 ScrollEdgeFades 承接（见视图容器处），
  // 不再使用逐卡片 useGlassSurfaceEdgeMasks——毛玻璃卡片 + 逐卡片 mask 会触发
  // Chrome 合成层快照缓存，导致边缘鬼影/漂移/闪烁。
  useGlassSurfaceEdgeMasks({
    scrollRef: relationTableScrollRef,
    enabled: navLevel === 'organizations' && relationListDisplayMode === 'table' && !showAddModal,
    scopeSelector: null,
    topHeight: 56,
    topFadeStartOffset: 0,
    bottomHeight: 72,
  });

  useGlassSurfaceEdgeMasks({
    scrollRef: relationFormScrollRef,
    enabled: showAddModal,
    scopeSelector: null,
    topHeight: 57,
    topFadeStartOffset: 58,
    bottomHeight: 57,
    shadowCasterBottomHeight: 57,
    topFadeActivation: 'clip',
    bottomFadeActivation: 'zone',
    bottomFadeEndOffset: BAMBOOK_OS.layout.desktopMainPanelBottomInset,
    bottomContentInset: 0,
    syncWheelScroll: true,
  });

  // 打开弹窗时锁定 body 滚动，关闭时恢复，避免与底层滚动叠加产生卡顿
  useEffect(() => {
    if (!showAddModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    
    // Escape 键关闭弹窗
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAddModal(false);
        setEditingItem(null);
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showAddModal]);

  useEffect(() => {
    if (!showAddModal) return;
    setBirthdayDraft(editingItem?.birthday || '');
  }, [editingItem?.id, showAddModal]);

  useEffect(() => {
    if (!showAddModal) return;
    const sourceTags = editingItem?.tags?.length ? editingItem.tags : [''];
    setTagRows(sourceTags.map((tag, index) => ({ id: `tag-${editingItem?.id || 'new'}-${index}`, value: tag })));
  }, [editingItem?.id, showAddModal]);

  useEffect(() => {
    if (!showAddModal) return;
    const sourceContacts: Array<{ name?: string; email?: string; phone?: string; note?: string; text?: string }> =
      editingItem?.backupContacts?.length ? editingItem.backupContacts : [{}];
    setBackupContactRows(sourceContacts.map((contact, index) => ({
      id: `backup-${editingItem?.id || 'new'}-${index}`,
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      note: contact.note || contact.text || '',
    })));
  }, [editingItem?.id, showAddModal]);

  useEffect(() => {
    if (!showAddModal) return;
    const source: Array<{ contactName?: string; name?: string; city?: string; postcode?: string; phone?: string; address?: string; note?: string; text?: string }> =
      editingItem?.shipToAddresses?.length ? editingItem.shipToAddresses as Array<{ contactName?: string; name?: string; city?: string; postcode?: string; phone?: string; address?: string; note?: string; text?: string }> : [{}];
    setShipToRows(source.map((item, index) => ({
      id: `shipto-${editingItem?.id || 'new'}-${index}`,
      contactName: item.contactName || item.name || '',
      city: item.city || '',
      postcode: item.postcode || '',
      phone: item.phone || '',
      address: item.address || item.text || '',
      note: item.note || '',
    })));
  }, [editingItem?.id, showAddModal]);

  // Resolve coordinates from Relation's address data for display
  useEffect(() => {
    if (!showAddModal || !editingItem) {
      setResolvedCoords(null);
      return;
    }
    const addressInput = extractAddressFromRelation(editingItem);
    const resolved = resolveCoordinates(editingItem.coordinates, addressInput);
    setResolvedCoords(resolved);
  }, [editingItem?.id, showAddModal]);

  const handleReResolveCoords = () => {
    if (!editingItem) return;
    const addressInput = extractAddressFromRelation(editingItem);
    const resolved = resolveCoordinates(undefined, addressInput);
    setResolvedCoords(resolved);
  };

  useEffect(() => {
    if (!showAddModal) return;
    const source: Array<{ type?: string; value?: string }> =
      (editingItem?.otherContacts as Array<{ type?: string; value?: string }> | undefined)?.length ? editingItem?.otherContacts as Array<{ type?: string; value?: string }> : [{}];
    setOtherContactRows(source.map((item, index) => ({
      id: `oc-${editingItem?.id || 'new'}-${index}`,
      type: item.type || '',
      value: item.value || '',
    })));
  }, [editingItem?.id, showAddModal]);

  useEffect(() => {
    if (!showAddModal) return;
    setFormSelectValues({
      // rating 历史数据可能是小数（demo seed 4.6）：表单 Tier 是 1-5 离散枚举，
      // 回填时四舍五入到最近合法档位，否则 CustomSelect 值不匹配显示"请选择..."
      rating: String(Math.min(5, Math.max(1, Math.round(Number(editingItem?.rating || 3))))),
      paymentTerms: editingItem?.paymentTerms || '',
      currency: editingItem?.currency || '',
      language: editingItem?.language || '',
    });
  }, [editingItem?.id, showAddModal]);

  // Constants
  const categories = RELATION_CATEGORY_DEFINITIONS;

  const orgContactCount = (orgId: string) => relations.filter(r => r.parentId === orgId && !r.deletedAt).length;
  const tierLabel = (rating?: number) => `Tier ${Math.min(5, Math.max(1, Number(rating || 3)))}`;
  const updateTagRow = (id: string, value: string) => {
    setTagRows(rows => rows.map(row => row.id === id ? { ...row, value } : row));
  };
  const addTagRow = () => {
    setTagRows(rows => [...rows, { id: `tag-${Date.now()}`, value: '' }]);
  };
  const removeTagRow = (id: string) => {
    setTagRows(rows => rows.length > 1 ? rows.filter(row => row.id !== id) : [{ ...rows[0], value: '' }]);
  };
  const updateBackupContactRow = (id: string, patch: Partial<BackupContactRow>) => {
    setBackupContactRows(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  };
  const addBackupContactRow = () => {
    setBackupContactRows(rows => [...rows, { id: `backup-${Date.now()}`, name: '', email: '', phone: '', note: '' }]);
  };
  const removeBackupContactRow = (id: string) => {
    setBackupContactRows(rows => rows.length > 1 ? rows.filter(row => row.id !== id) : [{ ...rows[0], name: '', email: '', phone: '', note: '' }]);
  };
  const backupContactsFromRows = () => backupContactRows
    .map(row => ({
      name: row.name.trim(),
      email: row.email.trim(),
      phone: row.phone.trim(),
      note: row.note.trim(),
    }))
    .filter(row => row.name || row.email || row.phone || row.note)
    .map(row => ({
      ...row,
      text: [row.name, row.email, row.phone, row.note].filter(Boolean).join(' | '),
    }));

  const updateShipToRow = (id: string, patch: Partial<ShipToRow>) => {
    setShipToRows(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  };
  const addShipToRow = () => {
    setShipToRows(rows => [...rows, { id: `shipto-${Date.now()}`, contactName: '', city: '', postcode: '', phone: '', address: '', note: '' }]);
  };
  const removeShipToRow = (id: string) => {
    setShipToRows(rows => rows.length > 1 ? rows.filter(row => row.id !== id) : [{ ...rows[0], contactName: '', city: '', postcode: '', phone: '', address: '', note: '' }]);
  };
  const shipToAddressesFromRows = () => shipToRows
    .map(row => ({
      contactName: row.contactName.trim(),
      city: row.city.trim(),
      postcode: row.postcode.trim(),
      phone: row.phone.trim(),
      address: row.address.trim(),
      note: row.note.trim(),
    }))
    .filter(row => row.contactName || row.city || row.postcode || row.phone || row.address || row.note);

  const updateOtherContactRow = (id: string, patch: Partial<OtherContactRow>) => {
    setOtherContactRows(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  };
  const addOtherContactRow = () => {
    setOtherContactRows(rows => [...rows, { id: `oc-${Date.now()}`, type: '', value: '' }]);
  };
  const removeOtherContactRow = (id: string) => {
    setOtherContactRows(rows => rows.length > 1 ? rows.filter(row => row.id !== id) : [{ ...rows[0], type: '', value: '' }]);
  };
  const otherContactsFromRows = () => otherContactRows
    .map(row => ({ type: row.type.trim(), value: row.value.trim() }))
    .filter(row => row.type && row.value);

  const organizationMissingFields = (org: Relation) => {
    const checks = [
      { label: '名称', ok: !!org.name?.trim() },
      { label: '中/英文名', ok: !!(org.chineseName || org.englishName)?.trim() },
      { label: '主联系人', ok: !!(org.primaryContactName || org.contactInfo)?.trim() },
      { label: '主联系邮箱', ok: !!org.primaryContactEmail?.trim() },
      { label: '联系电话', ok: !!(org.primaryContactPhone || org.phone)?.trim() },
      { label: '地址', ok: !!(org.officialAddress || org.billingAddress || org.shippingAddress)?.trim() },
      { label: 'Ship To', ok: !!org.shippingAddress?.trim() || (org.shipToAddresses || []).length > 0 },
      { label: '财务条款', ok: !!(org.paymentTerms || org.financialNotes)?.trim() },
    ];
    return checks.filter(item => !item.ok).map(item => item.label);
  };

  const relationLocationLabel = (org: Relation) => {
    const address = [org.shippingAddress, org.officialAddress, org.billingAddress, org.contactInfo]
      .find(value => value?.trim())?.trim() || '';
    const shipToCity = (org.shipToAddresses || []).find(item => item.city?.trim())?.city?.trim();
    const cityFromChineseAddress = address.match(/([\u4e00-\u9fa5]{2,}市)/)?.[1];
    const addressParts = address
      .split(/[,，|]/)
      .map(part => part.trim())
      .filter(Boolean);
    const knownCountry = ['中国', 'China', 'USA', 'United States', 'US', 'America', 'Vietnam', 'India', 'Bangladesh', 'Cambodia', 'Turkey', 'Türkiye', 'Italy', 'France', 'Germany', 'UK', 'United Kingdom', 'Canada', 'Mexico']
      .find(country => address.toLowerCase().includes(country.toLowerCase()));
    const country = knownCountry || (addressParts.length > 1 ? addressParts[addressParts.length - 1] : '');
    const city = shipToCity || cityFromChineseAddress || (addressParts.length > 1 ? addressParts[addressParts.length - 2] : addressParts[0]);

    return [city, country]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(' / ') || '未填';
  };

  // --- Derived Data ---

  // Level 2: Organizations in selected category
  const currentOrganizations = useMemo(() => {
    if (!selectedCategory) return [];
    let list = relations.filter(r =>
      r.isOrganization &&
      r.category === selectedCategory &&
      !r.deletedAt
    );

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(r =>
        r.name.toLowerCase().includes(lower) ||
        (r.chineseName || '').toLowerCase().includes(lower) ||
        (r.englishName || '').toLowerCase().includes(lower) ||
        (r.primaryContactName || '').toLowerCase().includes(lower) ||
        (r.primaryContactEmail || '').toLowerCase().includes(lower) ||
        (r.contactInfo || '').toLowerCase().includes(lower) ||
        (r.tags || []).some(tag => tag.toLowerCase().includes(lower))
      );
    }

    return [...list].sort((a, b) => compareRelationsForList(a, b, relationSortMode, orgContactCount));
  }, [relations, relationSortMode, searchTerm, selectedCategory]);

  // Level 3: Current Organization Detail
  const selectedOrganization = useMemo(() =>
    relations.find(r => r.id === selectedOrgId),
    [relations, selectedOrgId]);

  // Level 3 Tab 1: Contacts in this organization
  const orgContacts = useMemo(() => {
    if (!selectedOrgId) return [];
    return relations.filter(r =>
      !r.isOrganization &&
      r.parentId === selectedOrgId &&
      !r.deletedAt
    );
  }, [relations, selectedOrgId]);

  // Level 3 Tab 2: Hierarchy Tree (Simplified for now)
  const orgHierarchy = useMemo(() => {
    // In a real implementation this would build a tree structure
    return orgContacts;
  }, [orgContacts]);

  const renderRelationListToolbar = (toolbarInsetClass = '', includeOffset = true) => (
    <SpotlightCard
      spotlightColor={isDarkMode ? RELATIONS_TOOLBAR_SPOTLIGHT_DARK_COLOR : RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_COLOR}
      spotlightSize={isDarkMode ? RELATIONS_TOOLBAR_SPOTLIGHT_DARK_SIZE : RELATIONS_TOOLBAR_SPOTLIGHT_LIGHT_SIZE}
      liquidSpotlight
      liquidSpotlightTone={isDarkMode ? 'dark' : 'light'}
      idleSpotlightOpacity={0}
      activeSpotlightOpacity={1}
      className={`${RELATIONS_TOOLBAR_CLASS} ${toolbarInsetClass} ${includeOffset ? RELATIONS_TOOLBAR_OFFSET_CLASS : ''} ${RELATIONS_TOOLBAR_SURFACE_CLASS}`}
    >
      <span className={RELATIONS_TOOLBAR_AMBIENT_CLASS} aria-hidden="true" />
      <div className={RELATIONS_TOOLBAR_CONTENT_CLASS}>
        <div className={`${RELATIONS_TOOLBAR_SEARCH_SHELL_CLASS} ${RELATIONS_TOOLBAR_SEARCH_COMPACT_CLASS}`}>
          <span
            className="pointer-events-none absolute left-0 top-0 z-10 flex h-9 w-9 items-center justify-center rounded-control text-[var(--text-tertiary)]"
            aria-hidden="true"
          >
            <Search size={14} strokeWidth={1.5} />
          </span>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索组织..."
            className={`h-9 w-full rounded-control border pl-10 pr-3 outline-none font-normal text-xs ${RELATIONS_TOOLBAR_SEARCH_CLASS}`}
          />
        </div>

        <div className={RELATIONS_TOOLBAR_VIEW_GROUP_CLASS}>
          <CustomSelect
            value={relationSortMode}
            onChange={(value) => setRelationSortMode(value as RelationSortMode)}
            options={relationSortOptions}
            isDarkMode={isDarkMode}
            className={RELATIONS_TOOLBAR_SORT_CLASS}
            size="compact"
            surface="toolbar"
            triggerVariant="inline"
            menuPortal
          />

          <div className={RELATIONS_TOOLBAR_SEGMENT_CLASS}>
            <button
              type="button"
              onClick={() => setRelationListDisplayMode(relationListDisplayMode === 'grid' ? 'table' : 'grid')}
              className={`${RELATIONS_TOOLBAR_SEGMENT_BUTTON_CLASS} ${RELATIONS_TOOLBAR_SEGMENT_ACTIVE_CLASS}`}
              aria-label={relationListDisplayMode === 'grid' ? '切换到表格视图' : '切换到格子视图'}
            >
              {relationListDisplayMode === 'grid' ? (
                <List size={13} strokeWidth={1.5} />
              ) : (
                <LayoutGrid size={13} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    </SpotlightCard>
  );


  // --- Handlers ---

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (relationBusy) return;
    const formData = new FormData(e.currentTarget);
    const isOrg = formData.get('isOrganization') === 'on';

    const item: Relation = {
      id: editingItem?.id || `REL-${Date.now()}`,
      name: formData.get('name') as string,
      category: formData.get('category') as RelationCategory,
      type: formData.get('type') as any,
      isOrganization: isOrg,
      role: formData.get('role') as string,
      department: formData.get('department') as string,
      tags: formData.getAll('tags').map(value => String(value).trim()).filter(Boolean),
      contactInfo: formData.get('contactInfo') as string,
      rating: Number(formData.get('rating') || editingItem?.rating || 3),
      lastInteraction: Date.now(),
      preferences: formData.get('preferences') as string,
      deletedAt: undefined,
      parentId: selectedOrgId || editingItem?.parentId || undefined,

      // 组织专属字段
      ...(isOrg ? {
        website: formData.get('website') as string || undefined,
        chineseName: formData.get('chineseName') as string || undefined,
        englishName: formData.get('englishName') as string || undefined,
        summary: formData.get('summary') as string || undefined,
        primaryContactName: formData.get('primaryContactName') as string || undefined,
        primaryContactEmail: formData.get('primaryContactEmail') as string || undefined,
        primaryContactPhone: formData.get('primaryContactPhone') as string || undefined,
        backupContacts: backupContactsFromRows(),
        shipToAddresses: shipToAddressesFromRows(),
        financialNotes: formData.get('financialNotes') as string || undefined,
        paymentTerms: formData.get('paymentTerms') as string || undefined,
        paymentPreference: formData.get('paymentPreference') as string || undefined,
        currency: formData.get('currency') as string || undefined,
        taxId: formData.get('taxId') as string || undefined,
        creditLimit: formData.get('creditLimit') ? Number(formData.get('creditLimit')) : undefined,
        officialAddress: formData.get('officialAddress') as string || undefined,
        billingAddress: formData.get('billingAddress') as string || undefined,
        shippingAddress: formData.get('shippingAddress') as string || undefined,
        factoryAddresses: (formData.get('factoryAddresses') as string || '').split('\n').map(s => s.trim()).filter(Boolean),
        warehouseAddress: formData.get('warehouseAddress') as string || undefined,
        coordinates: resolvedCoords && resolvedCoords.source !== 'existing'
          ? { lat: resolvedCoords.lat, lng: resolvedCoords.lng }
          : editingItem?.coordinates,
      } : {}),

      // 联系人专属字段
      ...(!isOrg ? {
        email: formData.get('email') as string || undefined,
        phone: formData.get('phone') as string || undefined,
        mobile: formData.get('mobile') as string || undefined,
        wechat: formData.get('wechat') as string || undefined,
        whatsapp: formData.get('whatsapp') as string || undefined,
        otherContacts: otherContactsFromRows(),
        birthday: formData.get('birthday') as string || undefined,
        language: formData.get('language') as string || undefined,
        timezone: formData.get('timezone') as string || undefined,
        personalNote: formData.get('personalNote') as string || undefined,
        reportsToId: editingItem?.reportsToId,
        // 联系人统一：CRM 语义字段不在表单内——编辑时保留原值（否则保存会静默重置）
        isPrimary: editingItem?.isPrimary ?? false,
        isDecisionMaker: editingItem?.isDecisionMaker ?? false,
        contactStatus: editingItem?.contactStatus,
      } : {}),
    };

    setRelationBusy(true);
    setRelationSaveError(null);
    try {
      const persisted = editingItem
        ? await apiService.updateRelation(item.id, item, cloudEndpoint)
        : await apiService.saveRelation(item, cloudEndpoint);
      if (editingItem) {
        onUpdate(relations.map(r => r.id === persisted.id ? persisted : r), persisted);
      } else {
        onUpdate([persisted, ...relations], persisted);
      }
      setShowAddModal(false);
      setEditingItem(null);
    } catch (e: any) {
      setRelationSaveError(e?.message || '保存失败，请稍后重试');
    } finally {
      setRelationBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setRelationSaveError(null);
    setRelationBusy(true);
    try {
      const deletedRelation = await apiService.deleteRelation(id, cloudEndpoint);
      const wasSelectedOrg = selectedOrgId === deletedRelation.id;
      // 后端删除组织时级联软删其下联系人（cascadedContactIds）——内存数组同步移除，
      // 避免残留已被软删的联系人（下次刷新才会消失的幻影数据）
      const cascadedIds = (deletedRelation as any).cascadedContactIds as string[] | undefined;
      const removedIds = new Set([deletedRelation.id, ...(cascadedIds || [])]);
      onUpdate(relations.filter(r => !removedIds.has(r.id)), deletedRelation);
      if (selectedContactId === id || cascadedIds?.includes(selectedContactId || '')) setSelectedContactId(null);
      // 删除当前浏览的组织后回退到组织列表——navLevel='detail' 的内容区依赖
      // selectedOrganization 存在才渲染，不回退会停留在空白详情页
      if (wasSelectedOrg) {
        setSelectedOrgId(null);
        setNavLevel('organizations');
      }
      setConfirmDeleteId(null);
      setShowAddModal(false);
      setEditingItem(null);
    } catch (e: any) {
      setRelationSaveError(e?.message || '删除失败，请稍后重试');
    } finally {
      setRelationBusy(false);
    }
  };

  const handleMoveContact = (contactId: string, reportsToId?: string) => {
    const source = orgContacts.find(contact => contact.id === contactId);
    if (!source) return;
    if (source.reportsToId === reportsToId) return;
    if (reportsToId === contactId) return;
    if (reportsToId && !orgContacts.some(contact => contact.id === reportsToId)) return;

    // 环防御：目标若在被拖联系人的子树中，移动会形成汇报环。
    // UI canDrop 已拦截（同一 isDescendantContact 规则），此处为提交层兜底（防绕过 UI 直接调用）
    if (isDescendantContact(orgContacts, contactId, reportsToId || undefined)) return;

    const updated: Relation = { ...source, reportsToId };
    onUpdate(relations.map(relation => relation.id === contactId ? updated : relation), updated);
  };

  const selectedContact = relations.find(r => r.id === selectedContactId);

  const setFormSelectValue = (name: string, value: string) => {
    setFormSelectValues(current => ({ ...current, [name]: value }));
  };

  const stringifyStructuredLines = (items?: Array<{ text?: string; name?: string; email?: string; phone?: string; contactName?: string; city?: string; address?: string; note?: string }>) => {
    return (items || [])
      .map((item) => item.text || [item.name || item.contactName, item.email || item.city, item.phone, item.address, item.note].filter(Boolean).join(' | '))
      .filter(Boolean)
      .join('\n');
  };

  const relationFormIsOrganization = editingItem?.isOrganization ?? navLevel !== 'detail';
  const relationFormSections = relationFormIsOrganization ? organizationFormSections : contactFormSections;
  const fullscreenFormOpen = showAddModal;
  const relationsContentCanvasClass = isMobile ? 'w-full' : BAMBOOK_OS.layout.desktopPageCanvasClass;
  const relationsMainBottomEdgeClass = isMobile ? 'bottom-0' : BAMBOOK_OS.layout.desktopMainPanelBottomEdgeClass;
  const relationsTableBottomEdgeClass = isMobile ? 'bottom-0' : BAMBOOK_OS.layout.desktopTablePanelBottomEdgeClass;
  const relationsFormBottomEdgeClass = 'bottom-0';
  const pageInsetClass = sidebarCollapsed ? RELATIONS_PAGE_X_COLLAPSED_CLASS : RELATIONS_PAGE_X_NORMAL_CLASS;
  const scrollContainerExpandedClass = 'left-[-16px] right-[-16px] md:left-[-32px] md:right-[-32px]';
  const pageInsetExpandedClass = 'px-8 md:px-16';
  const titleInsetClass = RELATIONS_PAGE_X_NORMAL_CLASS;
  const relationFormFieldClass = RELATIONS_FORM_FIELD_CLASS;
  const relationsPanelDividerClass = RELATIONS_PANEL_DIVIDER_CLASS;
  const relationProgressTrackClass = RELATIONS_PROGRESS_TRACK_CLASS;
  const relationFormMapIndexClass = RELATIONS_FORM_MAP_INDEX_CLASS;
  const relationActionButtonClass = BAMBOOK_OS.controls.actionControl.base;
  const relationFormNestedRowClass = RELATIONS_FORM_NESTED_ROW_CLASS;
  const relationQuietIconSurfaceClass = BAMBOOK_OS.tone.surface.quietIcon;
  const relationFormIconAddClass = RELATIONS_FORM_ICON_ADD_CLASS;
  const relationFormIconRemoveClass = RELATIONS_FORM_ICON_REMOVE_CLASS;
  const relationFormIconCompactRemoveClass = RELATIONS_FORM_ICON_COMPACT_REMOVE_CLASS;
  const relationFormInlineDangerClass = RELATIONS_FORM_INLINE_DANGER_CLASS;
  const relationFormQuietActionClass = RELATIONS_FORM_QUIET_ACTION_CLASS;
  const relationCoordinatePanelClass = RELATIONS_COORDINATE_PANEL_CLASS;
  const relationCoordinateIconClass = RELATIONS_COORDINATE_ICON_CLASS;
  const relationBrandInlineClass = RELATIONS_BRAND_INLINE_CLASS;
  const relationFormLabelClass = RELATIONS_FORM_LABEL_CLASS;
  const relationFormSectionTitleClass = RELATIONS_FORM_SECTION_TITLE_CLASS;
  const relationTableHeaderClass = RELATIONS_TABLE_HEADER_CLASS;
  const relationTableRowHoverClass = RELATIONS_TABLE_ROW_HOVER_CLASS;
  const relationTableRowSeparatorClass = RELATIONS_TABLE_ROW_SEPARATOR_CLASS;
  const relationTableCellMutedClass = RELATIONS_TABLE_CELL_MUTED_CLASS;
  const relationTableEditActionClass = RELATIONS_TABLE_EDIT_ACTION_CLASS;
  const relationTableEmptyActionClass = RELATIONS_TABLE_EMPTY_ACTION_CLASS;
  const relationCategoryGridClass = isMobile ? RELATIONS_MOBILE_CATEGORY_GRID_CLASS : RELATIONS_CATEGORY_CARD_GRID_CLASS;
  const relationCategoryViewportClass = isMobile ? 'px-7 pt-[92px] pb-28' : `${pageInsetExpandedClass} pt-[104px] pb-12`;
  const relationCategoryCardClass = isMobile ? RELATIONS_MOBILE_CATEGORY_CARD_CLASS : 'p-6 h-[220px] rounded-card-lg';
  const relationCategoryIconClass = isMobile ? 'mb-3 flex h-9 w-9' : 'mb-4 flex h-10 w-10';
  const relationCategoryTitleClass = isMobile ? 'text-sm leading-snug' : 'text-base';
  const relationCategoryDescriptionClass = isMobile ? 'text-[11px] mt-1.5 leading-snug line-clamp-3' : 'text-[12px] mt-2 leading-relaxed';
  const renderRelationCard = ({
    cardKey,
    index,
    icon,
    title,
    description,
    footerLabel,
    onClick,
  }: {
    cardKey: string;
    index: number;
    icon: React.ReactNode;
    title: React.ReactNode;
    description: React.ReactNode;
    footerLabel: React.ReactNode;
    onClick: () => void;
  }) => (
    // 液态 spotlight 已移除——蓝 tint 主光斑 + 蓝边缘光是历史遗留体系，且 panel 级
    // 光斑尺寸（460/520px）远超卡片本身，侧栏收起主面板加宽后整卡泛蓝。
    // BDS 正确的 hover 高光由 RELATIONS_CATEGORY_CARD_CLASS（bds-surface + 墨洗）承担。
    <motion.button
      type="button"
      key={cardKey}
      onClick={onClick}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, delay: index * 0.04 }}
      className={`
        group relative isolate overflow-hidden flex flex-col items-start text-left
        ${relationCategoryCardClass} transition-colors duration-200
        ${RELATIONS_CATEGORY_CARD_CLASS}
      `}
    >
      <div className={`
        relative z-10 -ml-1 -mt-1 ${relationCategoryIconClass} items-center justify-center
        transition-colors duration-300
        text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]
      `}>
        {icon}
      </div>

      <h3 className={`relative z-10 ${relationCategoryTitleClass} font-light tracking-tight text-[var(--text-primary)]`}>
        {title}
      </h3>
      <p className={`relative z-10 ${relationCategoryDescriptionClass} font-light text-[var(--text-tertiary)]`}>
        {description}
      </p>

      <div className={`relative z-10 mt-auto ${isMobile ? 'pt-3' : 'pt-4'} border-t w-full flex justify-between items-center ${relationsPanelDividerClass}`}>
        <span className={`text-[10px] font-light tracking-wide text-[var(--text-tertiary)]`}>
          {footerLabel}
        </span>
        <ArrowRight size={14} strokeWidth={1.5} className={`transition-transform duration-300 group-hover:translate-x-1 text-[var(--text-quaternary)]`} />
      </div>
    </motion.button>
  );

  return (
    <div className="w-full h-full flex flex-col bg-transparent overflow-visible">

      {/* Primary Header - fixed, transparent title/navigation system.
          The left padding tracks the main area's live width so it clears the
          macOS traffic-light hot zone without jumping during sidebar springs. */}
      <PageHeader
        title="关系智库"
        subtitle="Relations"
        isDarkMode={isDarkMode}
        hidden={fullscreenFormOpen}
        safeLeftStyle={RELATIONS_TITLE_SAFE_LEFT_STYLE}
        style={RELATIONS_CLEAR_REGION_STYLE}
        /* Bug B 修复：滚动容器以 -top-16 负偏移伸入标题区且 DOM 靠后，
           无定位的 PageHeader 被其层叠覆盖、拦截工具栏点击。
           落实设计意图（透明标题条 z-30 悬浮于滚动内容之上） */
        className="relative z-30"
        breadcrumb={(
          <>
        <div className={`${navLevel === 'category' ? RELATIONS_TITLE_NAV_GROUP_CLASS : RELATIONS_TITLE_BACK_NAV_GROUP_CLASS} ${navLevel === 'organizations' ? 'shrink-0' : 'flex-1'}`}>
          {navLevel !== 'category' && (
            <RelationsTitleSpotlightButton
              isDarkMode={isDarkMode}
              type="button"
              onClick={() => {
                if (navLevel === 'detail') {
                  // 跨模块直达详情（无分类语境）时返回分类首页：
                  // selectedCategory=null 的组织列表渲染为空（"暂无组织"），返回栈断链
                  if (!selectedCategory) {
                    setNavLevel('category');
                  } else {
                    setNavLevel('organizations');
                  }
                  setSelectedOrgId(null);
                  setSelectedContactId(null);
                  setActiveTab('contacts');
                } else {
                  setNavLevel('category');
                  setSelectedCategory(null);
                  setSearchTerm('');
                }
              }}
              wrapperClassName={`${RELATIONS_TITLE_BACK_BUTTON_CLASS} ${RELATIONS_TITLE_BUTTON_CLASS}`}
              aria-label="返回上一级"
            >
              <ChevronLeft size={RELATIONS_TITLE_ARROW_ICON_SIZE} strokeWidth={RELATIONS_TITLE_ARROW_STROKE_WIDTH} />
            </RelationsTitleSpotlightButton>
          )}

          <div className={`${RELATIONS_FORM_TITLE_CRUMB_CLASS} text-[var(--os-adaptive-subtitle)]`}>
            {selectedCategory && navLevel !== 'category' && (
              <div className={`h-9 flex items-center gap-1.5 min-w-0 text-[11px] font-light tracking-wide text-[var(--os-adaptive-subtitle)]`}>
                <span className={RELATIONS_TITLE_SEPARATOR_CLASS}>
                  <ChevronRight size={RELATIONS_TITLE_ARROW_ICON_SIZE} strokeWidth={RELATIONS_TITLE_ARROW_STROKE_WIDTH} />
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNavLevel('organizations');
                    setSelectedOrgId(null);
                    setSelectedContactId(null);
                    setActiveTab('contacts');
                  }}
                  className={`${RELATIONS_TITLE_SECTION_BUTTON_CLASS} text-[var(--os-adaptive-subtitle)] hover:text-[var(--os-adaptive-primary)] transition-colors`}
                >
                  {categories.find(c => c.id === selectedCategory)?.label}
                </button>
                {navLevel === 'detail' && selectedOrganization && (
                  <>
                    <span className={RELATIONS_TITLE_SEPARATOR_CLASS}>
                      <ChevronRight size={RELATIONS_TITLE_ARROW_ICON_SIZE} strokeWidth={RELATIONS_TITLE_ARROW_STROKE_WIDTH} />
                    </span>
                    <span className={`${RELATIONS_TITLE_PAGE_LABEL_CLASS} text-[var(--os-adaptive-primary)]`}>
                      {selectedOrganization.name}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
          </>
        )}
        center={(
          <>

        {navLevel === 'organizations' && (
          <div className="flex h-full flex-1 min-w-0 items-center justify-center">
            {renderRelationListToolbar('', false)}
          </div>
        )}

        {navLevel === 'detail' && (
          <div className="flex h-full flex-1 min-w-0 items-center justify-center">
            <div className={`${RELATIONS_TITLE_VIEW_SWITCH_CLASS} ${RELATIONS_TOOLBAR_SURFACE_CLASS}`}>
              <button
                type="button"
                onClick={() => setActiveTab('contacts')}
                className={`${RELATIONS_TITLE_VIEW_SWITCH_BUTTON_CLASS} ${activeTab === 'contacts'
                  ? SIDEBAR_ACTIVE_CLASS
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                通讯录
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('structure')}
                className={`${RELATIONS_TITLE_VIEW_SWITCH_BUTTON_CLASS} ${activeTab === 'structure'
                  ? SIDEBAR_ACTIVE_CLASS
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                组织架构
              </button>
            </div>
          </div>
        )}
          </>
        )}
        actions={(
          <>

        <div className="flex h-full items-center gap-2 shrink-0">
          {/* 阶段 IA 全局收编：供应商组织详情直达「供应商管理」工厂档案（评分/认证/产能） */}
          {navLevel === 'detail' && selectedOrganization?.category === 'Supplier' && onNavigate && (
            <RelationsTitleSpotlightButton
              isDarkMode={isDarkMode}
              type="button"
              onClick={() => {
                primeSuppliersFactoryPreview(selectedOrganization.id);
                onNavigate(View.Suppliers);
              }}
              wrapperClassName={`${RELATIONS_TITLE_ACTION_BUTTON_CLASS} ${RELATIONS_TITLE_BUTTON_CLASS}`}
            >
              <Building2 size={14} strokeWidth={1.5} /> 工厂档案
            </RelationsTitleSpotlightButton>
          )}
          {/* 新增按钮：分类页不展示 */}
          {(navLevel === 'organizations' || navLevel === 'detail') && (
            <RelationsTitleSpotlightButton
              isDarkMode={isDarkMode}
              type="button"
              onClick={() => setShowAddModal(true)}
              wrapperClassName={`${RELATIONS_TITLE_ACTION_BUTTON_CLASS} ${RELATIONS_TITLE_BUTTON_CLASS}`}
            >
              <Plus size={14} strokeWidth={1.5} /> {navLevel === 'detail' ? '新增人员' : '新增组织'}
            </RelationsTitleSpotlightButton>
          )}
          {/* 一键溯源按钮：detail 视图展示 */}
          {navLevel === 'detail' && selectedOrgId && (
            <button
              type="button"
              onClick={() => setShowTracePanel(true)}
              className={`flex h-8 items-center gap-1.5 rounded-control px-3 text-xs font-light transition-colors bg-[var(--recessed-bg)] text-[var(--text-secondary)] hover:bg-[var(--active-darken)] hover:text-[var(--text-primary)]`}
            >
              <GitBranch size={13} strokeWidth={1.5} /> 溯源
            </button>
          )}
        </div>
          </>
        )}
      />

      {/* Content Area
          Note: removed `overflow-hidden` so each view's scroll container can
          extend UP under the transparent title bar via a negative `-top-16`
          offset. The root container above already has `overflow-hidden`, so
          the upward extension is still clipped at the page bounds — content
          can't leak above the page, but it CAN render visually behind the
          (transparent, z-30) title strip. Edge fades are applied directly to
          glass surfaces so Chromium does not isolate backdrop-filter through
          masked parent wrappers. */}
      <div className={`${relationsContentCanvasClass} flex-1 min-h-0 relative overflow-visible ${fullscreenFormOpen ? 'hidden' : ''}`}>

        {/* VIEW 1: CATEGORY GRID */}
        {navLevel === 'category' && (
          <div className="relative h-full">
            {/* ScrollEdgeFades 与侧边栏同源：mask 挂在静止外壳（maskRef）而非滚动容器
                自身——滚动时遮罩层不逐帧重栅格化，杜绝左缘圆角区与侧栏玻璃叠加的阶梯残影；
                同时不叠加 panelShadowViewportClass 的 margin bleed + framer layout
                （backdrop-filter 毛玻璃卡片 + transform 布局动画在 Chrome 会合成层快照 → 漂移/闪烁/鬼影） */}
            <ScrollEdgeFades
              scrollRef={relationCategoryScrollRef}
              maskRef={relationCategoryMaskRef}
              isDarkMode={isDarkMode}
              variant="subtle"
              topHeight={32}
              topFadeStartOffset={RELATIONS_CARD_GRID_EDGE_FADE_TOP_OFFSET}
              bottomHeight={48}
            />
            <div
              ref={relationCategoryMaskRef}
              className={`absolute -top-16 ${scrollContainerExpandedClass} ${relationsMainBottomEdgeClass}`}
            >
              <motion.div
                ref={relationCategoryScrollRef}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={`h-full w-full ${relationCategoryViewportClass} overflow-y-scroll ${relationCategoryGridClass}`}
              >
                {categories.map((cat, idx) => renderRelationCard({
                  cardKey: cat.id,
                  index: idx,
                  icon: <cat.icon size={24} strokeWidth={1} />,
                  title: cat.label,
                  description: cat.desc,
                  footerLabel: `${relations.filter(r => r.category === cat.id && r.isOrganization && !r.deletedAt).length} 组织`,
                  onClick: () => { setSelectedCategory(cat.id); setNavLevel('organizations'); setSearchTerm(''); },
                }))}
              </motion.div>
            </div>
          </div>
        )}

        {/* VIEW 2: ORGANIZATION LIST */}
        {navLevel === 'organizations' && (
          <div className="relative h-full">
            {relationListDisplayMode === 'grid' && (
              <ScrollEdgeFades
                scrollRef={relationListScrollRef}
                maskRef={relationListMaskRef}
                isDarkMode={isDarkMode}
                variant="subtle"
                topHeight={32}
                topFadeStartOffset={RELATIONS_CARD_GRID_EDGE_FADE_TOP_OFFSET}
                bottomHeight={48}
              />
            )}
            {/* 静止遮罩外壳：grid 模式承载边缘淡出 mask（滚动时遮罩不逐帧重栅格化，
                杜绝左缘圆角区与侧栏玻璃叠加的阶梯残影）；table 模式降级为
                display:contents 透明包裹，不参与盒树布局 */}
            <div
              ref={relationListMaskRef}
              className={relationListDisplayMode === 'grid' ? `absolute -top-16 ${scrollContainerExpandedClass} ${relationsMainBottomEdgeClass}` : 'contents'}
            >
            <motion.div
              ref={relationListScrollRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={relationListDisplayMode === 'grid' ? `h-full w-full ${pageInsetExpandedClass} pt-[104px] pb-8 overflow-y-scroll ${RELATIONS_CARD_GRID_CLASS}` : `${BAMBOOK_OS.layout.relationsTableViewportClass} ${relationsTableBottomEdgeClass} ${pageInsetClass}`}
            >
            {relationListDisplayMode === 'grid' ? currentOrganizations.map((org, idx) => renderRelationCard({
              cardKey: org.id,
              index: idx,
              icon: <Building2 size={24} strokeWidth={1} />,
              title: org.name,
              description: org.summary || relationLocationLabel(org) || org.type,
              footerLabel: `${orgContactCount(org.id)} 活跃联系人`,
              onClick: () => { setSelectedOrgId(org.id); setNavLevel('detail'); setSearchTerm(''); },
            })) : (
              <CompiledTableShell
                isDarkMode={isDarkMode}
                scrollRef={relationTableScrollRef}
                useSidePanelContainer
                shellBaseClassName="h-full min-h-0 overflow-visible"
                panelClassName={BAMBOOK_OS.layout.relationsTablePanelClass}
                panelContentClassName={`${BAMBOOK_OS.layout.relationsTablePanelContentClass} overflow-hidden`}
                scrollClassName="overflow-x-auto overscroll-contain"
                edgeFade={{ topHeight: 22, topFadeStartOffset: 0, bottomHeight: 42 }}
                header={(
                  <table className={BAMBOOK_OS.layout.relationsTableHeaderTableClass}>
                    <colgroup>
                      {BAMBOOK_OS.layout.relationsTableColumnWidthClasses.map((widthClass, index) => (
                        <col key={index} className={widthClass} />
                      ))}
                    </colgroup>
                    <thead className={`text-[var(--text-tertiary)]`}>
                      <tr>
                        {BAMBOOK_OS.layout.relationsTableHeaders.map(header => (
                          <th key={header} className={`${BAMBOOK_OS.layout.relationsTableHeaderCellClass} ${relationTableHeaderClass}`}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                )}
              >
                <div className={BAMBOOK_OS.layout.relationsTableBodyClass}>
                    {currentOrganizations.map((org, idx) => (
                      // 液态蓝光同卡片一并移除（历史遗留体系）；hover 由 relationTableRowHoverClass 墨洗承担。
                      // data-glass-edge-mask 保留——table 模式 useGlassSurfaceEdgeMasks 逐行 mask 消费该属性。
                      <motion.div
                        role="button"
                        tabIndex={0}
                        key={org.id}
                        data-glass-edge-mask
                        onClick={() => { setSelectedOrgId(org.id); setNavLevel('detail'); setSearchTerm(''); }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          setSelectedOrgId(org.id);
                          setNavLevel('detail');
                          setSearchTerm('');
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.18, delay: idx * 0.03 }}
                        className={`group grid cursor-pointer ${BAMBOOK_OS.layout.relationsTableColumnTemplateClass} text-xs transition-[background,color,transform] duration-200 relative isolate overflow-hidden ${relationTableRowHoverClass}`}
                      >
                        <span className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 h-px ${relationTableRowSeparatorClass}`} aria-hidden="true" />
                        <div className="relative z-10 px-4 py-4">
                          <div className="min-w-0">
                            <div className={`truncate font-light text-[var(--text-primary)]`}>{org.name}</div>
                            <div className={`text-[var(--text-tertiary)] mt-1 truncate`}>{org.chineseName || org.englishName || org.type}</div>
                          </div>
                          <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-light tracking-wide bg-[var(--os-vnext-brand-blue)]/7 text-[var(--os-vnext-brand-blue-strong)]`}>
                            {tierLabel(org.rating)}
                          </span>
                        </div>
                        <div className="relative z-10 px-4 py-4">
                          <div className={`truncate text-[var(--text-secondary)]`}>{org.primaryContactName || '未填'}</div>
                          <div className={`text-[var(--text-tertiary)] mt-1 truncate`}>{org.primaryContactEmail || org.contactInfo || '邮箱未填'}</div>
                          <div className={`text-[var(--text-tertiary)] mt-1 text-[10px]`}>{orgContactCount(org.id)} 位联系人</div>
                        </div>
                        <div className="relative z-10 px-4 py-4">
                          <div className="truncate">{relationLocationLabel(org)}</div>
                        </div>
                        <div className="relative z-10 px-4 py-4">
                          <div className="truncate">{(org.shipToAddresses || []).length > 0 ? `${org.shipToAddresses?.length} 个 Ship To` : org.shippingAddress || 'Ship To 未填'}</div>
                          <div className={`text-[var(--text-tertiary)] mt-1 truncate`}>{org.paymentTerms || org.paymentPreference || '付款未填'}</div>
                        </div>
                        <div className="relative z-10 pl-2 pr-4 py-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditingItem(org); setShowAddModal(true); }}
                            className={`p-2 rounded-full transition-colors ${relationTableEditActionClass}`}
                            aria-label="编辑组织"
                          >
                            <Edit2 size={13} />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </CompiledTableShell>
            )}

            {/* Empty state：区分「搜索无结果」与「分类本就为空」——前者提示调整关键词，后者引导创建 */}
            {currentOrganizations.length === 0 && (
              <div className={`col-span-full py-20 flex flex-col items-center justify-center text-[var(--text-tertiary)]`}>
                <div className={`w-20 h-20 rounded-inset flex items-center justify-center mb-6 ${relationQuietIconSurfaceClass}`}>
                  <Building2 size={40} strokeWidth={1} className="opacity-40" />
                </div>
                {searchTerm.trim() ? (
                  <>
                    <p className="text-sm font-light tracking-wide mb-2">未找到匹配的组织</p>
                    <p className={`text-xs mb-4 text-[var(--text-tertiary)]`}>「{searchTerm}」在{categories.find(c => c.id === selectedCategory)?.label || '当前分类'}中没有匹配结果，试试其他关键词</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-light tracking-wide mb-2">暂无组织</p>
                    <p className={`text-xs mb-4 text-[var(--text-tertiary)]`}>该分类还没有组织，点击下方按钮创建第一个</p>
                    <button
                      onClick={() => setShowAddModal(true)}
                      className={`px-4 py-2 rounded-full text-xs font-light transition-all ${relationTableEmptyActionClass}`}
                    >
                      创建组织
                    </button>
                  </>
                )}
              </div>
            )}
            </motion.div>
            </div>
          </div>
        )}

        {/* VIEW 3: DETAIL - 根据 activeTab 切换视图 */}
        {navLevel === 'detail' && selectedOrganization && (
          <div className={`absolute inset-x-0 top-0 ${relationsMainBottomEdgeClass} min-h-0 flex overflow-visible`}>
            {activeTab === 'contacts' ? (
              <>
                {/* 左侧通讯录列表 */}
                <ContactList
                  organization={selectedOrganization}
                  contacts={orgContacts}
                  selectedId={selectedContactId}
                  onSelect={setSelectedContactId}
                  onAddContact={() => setShowAddModal(true)}
                  isDarkMode={isDarkMode}
                />

                {/* 右侧详情面板 */}
                <DetailPanel
                  type={selectedContactId ? 'contact' : 'organization'}
                  data={selectedContactId
                    ? (orgContacts.find(c => c.id === selectedContactId) || selectedOrganization)
                    : selectedOrganization
                  }
                  organization={selectedContactId ? selectedOrganization : undefined}
                  onEdit={() => {
                    const target = selectedContactId
                      ? orgContacts.find(c => c.id === selectedContactId)
                      : selectedOrganization;
                    if (target) {
                      setEditingItem(target);
                      setShowAddModal(true);
                    }
                  }}
                  onDelete={() => {
                    // 删除入口收拢：详情页底部为唯一删除入口，须经确认弹窗（不直删）
                    const targetId = selectedContactId || selectedOrgId;
                    if (targetId) {
                      setConfirmDeleteId(targetId);
                    }
                  }}
                  isDarkMode={isDarkMode}
                />
              </>
            ) : (
              /* 组织架构图视图 */
              <div className="flex-1 min-w-0 h-full min-h-0 p-4 pl-3">
                <CompiledSurfacePanel
                  isDarkMode={isDarkMode}
                  className="h-full flex flex-col overflow-hidden"
                  contentClassName="relative z-10 flex min-h-0 flex-1 flex-col"
                >
                  <OrgChart
                    organization={selectedOrganization}
                    contacts={orgContacts}
                    onSelectContact={(id) => {
                      setSelectedContactId(id);
                      setActiveTab('contacts');
                    }}
                    onAddContact={() => setShowAddModal(true)}
                    onEditContact={(contact) => {
                      setEditingItem(contact);
                      setShowAddModal(true);
                    }}
                    onMoveContact={handleMoveContact}
                    isDarkMode={isDarkMode}
                  />
                </CompiledSurfacePanel>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Add/Edit Modal
          用 absolute inset-0 叠在组件内部，不用 Portal 也不用 fixed。
          这样弹窗完全在 <main> 内容区内，和 sidebar 无任何交集，
          不存在事件被 sidebar 或 -webkit-app-region: drag 吞掉的问题。
          加 absolute inset-0 叠在组件内部，不用 Portal 也不用 fixed。
          这样弹窗完全在 <main> 内容区内，和 sidebar 无任何交集，
          不存在事件被 sidebar 或 -webkit-app-region: drag 吞掉的问题。
          整个弹窗卡片就是唯一的滚动容器。
          (no-drag 已在 index.css 通过 .overflow-y-auto 全局覆盖，无需手动添加) */}
      {showAddModal && (
        <div
          className={`absolute inset-x-0 top-0 ${relationsFormBottomEdgeClass} z-[70] bg-transparent`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddModal(false);
              setEditingItem(null);
            }
          }}
        >
          <div
            className={`
            h-full w-full overflow-hidden flex flex-col
            bg-transparent
          `}>
            {/* Header */}
            <div className={RELATIONS_FORM_TITLE_BAR_CLASS} style={{ ...RELATIONS_CLEAR_REGION_STYLE, ...RELATIONS_TITLE_SAFE_LEFT_STYLE }}>
              <div className={RELATIONS_TITLE_BACK_NAV_GROUP_CLASS}>
                <RelationsTitleSpotlightButton
                  isDarkMode={isDarkMode}
                  type="button"
                  onClick={() => { setShowAddModal(false); setEditingItem(null); }}
                  wrapperClassName={`${RELATIONS_TITLE_BACK_BUTTON_CLASS} ${RELATIONS_TITLE_BUTTON_CLASS}`}
                  aria-label="返回关系智库"
                >
                  <ChevronLeft size={RELATIONS_TITLE_ARROW_ICON_SIZE} strokeWidth={RELATIONS_TITLE_ARROW_STROKE_WIDTH} />
                </RelationsTitleSpotlightButton>
                <div className={`${RELATIONS_FORM_TITLE_CRUMB_CLASS} text-[var(--text-tertiary)]`}>
                  <button
                    type="button"
                    onClick={() => { setShowAddModal(false); setEditingItem(null); }}
                    className={`${RELATIONS_TITLE_TEXT_BUTTON_CLASS} text-[var(--text-primary)] hover:text-[var(--text-secondary)]`}
                  >
                    <span className={`${BAMBOOK_OS.layout.desktopTitleTextClass} text-[var(--text-primary)]`}>
                          <span data-ui-lab-wallpaper-contrast="primary">关系</span><span className={BAMBOOK_OS.layout.desktopTitleAccentClass}>智库</span>
                    </span>
                  </button>
                  <span data-ui-lab-wallpaper-contrast="secondary" className={RELATIONS_TITLE_SEPARATOR_CLASS}>
                    <ChevronRight size={RELATIONS_TITLE_ARROW_ICON_SIZE} strokeWidth={RELATIONS_TITLE_ARROW_STROKE_WIDTH} />
                  </span>
                  <h3 data-ui-lab-wallpaper-contrast="primary" className={`${RELATIONS_FORM_TITLE_HEADING_CLASS} text-[var(--text-secondary)]`}>
                    {editingItem ? '编辑资料' : (relationFormIsOrganization ? '新建组织' : '添加联系人')}
                  </h3>
                </div>
              </div>
              <div className="flex h-full items-center gap-2 shrink-0">
                {/* 删除入口收拢：编辑界面不再承载删除（详情页底部唯一入口 + 确认弹窗） */}
                <RelationsTitleSpotlightButton
                  isDarkMode={isDarkMode}
                  type="button"
                  onClick={() => { setShowAddModal(false); setEditingItem(null); }}
                  wrapperClassName={`${RELATIONS_FORM_TITLE_SECONDARY_BUTTON_CLASS} ${RELATIONS_TITLE_BUTTON_CLASS}`}
                >
                  取消
                </RelationsTitleSpotlightButton>
                <RelationsTitleSpotlightButton
                  isDarkMode={isDarkMode}
                  type="submit"
                  form="relation-fullscreen-form"
                  disabled={relationBusy}
                  wrapperClassName={`${RELATIONS_FORM_TITLE_SUBMIT_BUTTON_CLASS} ${RELATIONS_TITLE_BUTTON_CLASS}`}
                >
                  <Save size={14} strokeWidth={1.5} /> 保存资料
                </RelationsTitleSpotlightButton>
              </div>
            </div>

            {/* Form */}
            <form id="relation-fullscreen-form" onSubmit={handleSave} data-relation-save-error={relationSaveError} data-relation-busy={relationBusy} className="w-full flex-1 min-h-0 px-7 pt-3 grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 items-stretch">
              {relationSaveError && (
                <div className="col-span-2 text-xs text-[var(--text-tertiary)] bg-[var(--recessed-bg)] rounded-control px-3 py-2">{relationSaveError}</div>
              )}
              <input type="hidden" name="isOrganization" value={relationFormIsOrganization ? 'on' : 'off'} />
              <input type="hidden" name="category" value={selectedCategory || 'Other'} />

              <aside className="self-start">
                <CompiledSurfacePanel materialRole="raisedCard" spotlight isDarkMode={isDarkMode} className={RELATIONS_FORM_MAP_PANEL_CLASS}>
                  <p className={`px-3 pb-3 text-[10px] font-light tracking-[0.22em] uppercase ${relationFormSectionTitleClass}`}>Form Map</p>
                  <div className="space-y-1">
                    {relationFormSections.map((section, idx) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => document.getElementById(`relation-form-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        className={`w-full text-left rounded-full border px-3 py-3 transition-all group ${relationActionButtonClass}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-[10px] font-light transition-colors ${relationFormMapIndexClass}`}>{idx + 1}</span>
                          <div className="min-w-0">
                            <div className={`text-xs font-light text-[var(--text-secondary)]`}>{section.label}</div>
                            <div className={`text-[10px] mt-0.5 truncate ${relationFormLabelClass}`}>{section.desc}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </CompiledSurfacePanel>
              </aside>

              <div ref={relationFormScrollRef} className={`bambook-relation-form-scroll-viewport min-w-0 -mt-[112px] h-[calc(100%+7rem)] overflow-y-auto overscroll-contain space-y-6 pt-24 pb-[176px] ${BAMBOOK_OS.layout.panelShadowViewportClass}`}>
                  {/* 基础信息 */}
                  <CompiledSurfacePanel materialRole="raisedCard" edgeFadeItem spotlight as="section" id="relation-form-basic" isDarkMode={isDarkMode} className={RELATIONS_FORM_PANEL_CLASS} spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}>
                    <h4 className={`text-xs font-light tracking-wide mb-4 ${relationFormSectionTitleClass}`}>
                      基础信息
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>
                          {relationFormIsOrganization ? '组织名称' : '姓名'} *
                        </label>
                        <input
                          name="name"
                          defaultValue={editingItem?.name}
                          required
                          className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                        />
                      </div>

                    <div>
                      <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>
                        {relationFormIsOrganization ? '行业类型' : '职位'}
                      </label>
                      <input
                        name="role"
                        defaultValue={editingItem?.role}
                        className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                      />
                    </div>

                    {!relationFormIsOrganization && (
                      <div>
                        <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>
                          部门
                        </label>
                        <input
                          name="department"
                          defaultValue={editingItem?.department}
                          className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                        />
                      </div>
                    )}

                    {relationFormIsOrganization && (
                      <>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>中文名称</label>
                          <input name="chineseName" defaultValue={editingItem?.chineseName || ''} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>英文名称</label>
                          <input name="englishName" defaultValue={editingItem?.englishName || ''} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>信用 Tier</label>
                          <input type="hidden" name="rating" value={formSelectValues.rating || '3'} />
                          <CustomSelect
                            className="mt-1"
                          value={formSelectValues.rating || '3'}
                          onChange={(value) => setFormSelectValue('rating', value)}
                          isDarkMode={isDarkMode}
                          surface="toolbar"
                          options={[5, 4, 3, 2, 1].map(tier => ({ value: String(tier), label: tierLabel(tier) }))}
                        />
                        </div>
                        <div className="col-span-2">
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>组织简介</label>
                          <textarea name="summary" defaultValue={editingItem?.summary || ''} rows={2} className={`w-full mt-1 px-4 py-3 rounded-full border outline-none font-light transition-all resize-none ${relationFormFieldClass}`} />
                        </div>
                      </>
                    )}

                    <div className={relationFormIsOrganization ? 'col-span-1' : ''}>
                      <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>
                        联系方式
                      </label>
                      {/* 数据合约承载「邮箱 | 电话」组合值（demo/存量数据均为组合格式），
                          type=email 的原生校验会拒绝组合值导致保存被浏览器静默拦截——改 text */}
                      <input
                        name="contactInfo"
                        type="text"
                        defaultValue={editingItem?.contactInfo}
                        placeholder="邮箱 | 电话"
                        className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                      />
                    </div>

                    <div className="col-span-2">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>
                          标签
                        </label>
                        <button
                          type="button"
                          onClick={addTagRow}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${relationFormIconAddClass}`}
                          aria-label="添加标签"
                        >
                          <Plus size={14} strokeWidth={1.8} />
                        </button>
                      </div>
                      <div className="space-y-2">
                        {tagRows.map((row, index) => (
                          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_36px] gap-2 items-center">
                            <input
                              name="tags"
                              value={row.value}
                              onChange={(event) => updateTagRow(row.id, event.target.value)}
                              placeholder={index === 0 ? 'VIP / 长期合作 / 优先供应商...' : '新增标签'}
                              className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                            />
                            <button
                              type="button"
                              onClick={() => removeTagRow(row.id)}
                              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${relationFormIconRemoveClass}`}
                              aria-label="删除标签"
                            >
                              <X size={14} strokeWidth={1.8} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CompiledSurfacePanel>

                {/* 组织专属字段 */}
                {relationFormIsOrganization && (
                  <>
                    {/* 联系方式 */}
                    <CompiledSurfacePanel materialRole="raisedCard" edgeFadeItem spotlight as="section" id="relation-form-contact" isDarkMode={isDarkMode} className={RELATIONS_FORM_PANEL_CLASS} spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}>
                      <h4 className={`text-xs font-light tracking-wide mb-4 ${relationFormSectionTitleClass}`}>
                        联系方式
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>公司官网</label>
                          <input name="website" defaultValue={editingItem?.website} placeholder="www.example.com" className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>联系电话</label>
                          <input name="phone" defaultValue={editingItem?.phone} placeholder="+86 21 1234 5678" className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>主联系对象</label>
                          <input name="primaryContactName" defaultValue={editingItem?.primaryContactName || ''} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>主联系邮箱</label>
                          <input name="primaryContactEmail" type="email" defaultValue={editingItem?.primaryContactEmail || ''} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div className="col-span-2">
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>主联系电话</label>
                          <input name="primaryContactPhone" defaultValue={editingItem?.primaryContactPhone || ''} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div className="col-span-2">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>备用联系人</label>
                            <button
                              type="button"
                              onClick={addBackupContactRow}
                              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${relationFormIconAddClass}`}
                              aria-label="添加备用联系人"
                            >
                              <Plus size={14} strokeWidth={1.8} />
                            </button>
                          </div>
                          <div className="space-y-3">
                            {backupContactRows.map((row, index) => (
                              <div key={row.id} className={`rounded-inset border p-3 space-y-2 ${relationFormNestedRowClass}`}>
                                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                                  <input
                                    value={row.name}
                                    onChange={(event) => updateBackupContactRow(row.id, { name: event.target.value })}
                                    placeholder={index === 0 ? '联系人姓名' : '新增联系人姓名'}
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                  <input
                                    value={row.email}
                                    onChange={(event) => updateBackupContactRow(row.id, { email: event.target.value })}
                                    type="email"
                                    placeholder="邮箱"
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                  <input
                                    value={row.phone}
                                    onChange={(event) => updateBackupContactRow(row.id, { phone: event.target.value })}
                                    placeholder="电话"
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                  <input
                                    value={row.note}
                                    onChange={(event) => updateBackupContactRow(row.id, { note: event.target.value })}
                                    placeholder="备注"
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                </div>
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => removeBackupContactRow(row.id)}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${relationFormIconCompactRemoveClass}`}
                                    aria-label="删除备用联系人"
                                  >
                                    <X size={14} strokeWidth={1.8} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CompiledSurfacePanel>

                    {/* 地址信息 */}
                    <CompiledSurfacePanel materialRole="raisedCard" edgeFadeItem spotlight as="section" id="relation-form-address" isDarkMode={isDarkMode} className={RELATIONS_FORM_PANEL_CLASS} spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}>
                      <h4 className={`text-xs font-light tracking-wide mb-4 ${relationFormSectionTitleClass}`}>
                        地址信息
                      </h4>
                      <div className="space-y-4">
                        {/* Coordinates display */}
                        {resolvedCoords && (
                          <div className={`flex items-center justify-between p-3 rounded-inset ${relationCoordinatePanelClass}`}>
                            <div className="flex items-center gap-2">
                              <Navigation size={14} className={relationCoordinateIconClass} />
                              <span className={`text-xs font-mono text-[var(--text-secondary)]`}>
                                {resolvedCoords.lat.toFixed(4)}, {resolvedCoords.lng.toFixed(4)}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-bds-sm ${getRelationsCoordinateStatusClass(resolvedCoords.source)}`}>
                                {resolvedCoords.source === 'existing' ? '已保存' : resolvedCoords.source === 'city' ? `城市: ${resolvedCoords.label || ''}` : resolvedCoords.source === 'postcode' ? '邮编匹配' : resolvedCoords.source === 'address_keyword' ? `关键词: ${resolvedCoords.label || ''}` : '兜底'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={handleReResolveCoords}
                              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full transition-all ${relationFormQuietActionClass}`}
                              title="重新解析坐标"
                            >
                              <RefreshCw size={12} />
                              重新解析
                            </button>
                          </div>
                        )}
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>注册地址</label>
                          <input name="officialAddress" defaultValue={editingItem?.officialAddress} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>Bill To / 账单地址</label>
                          <textarea name="billingAddress" defaultValue={editingItem?.billingAddress} rows={2} className={`w-full mt-1 px-4 py-3 rounded-full border outline-none font-light transition-all resize-none ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>Ship To / 发货地址</label>
                          <input name="shippingAddress" defaultValue={editingItem?.shippingAddress} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>多个 Ship To（结构化）</label>
                            <button
                              type="button"
                              onClick={addShipToRow}
                              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${relationFormIconAddClass}`}
                              aria-label="添加 Ship To"
                            >
                              <Plus size={14} strokeWidth={1.8} />
                            </button>
                          </div>
                          <div className="space-y-3">
                            {shipToRows.map((row, index) => (
                              <div key={row.id} className={`rounded-inset border p-3 space-y-2 ${relationFormNestedRowClass}`}>
                                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                                  <input
                                    value={row.contactName}
                                    onChange={(event) => updateShipToRow(row.id, { contactName: event.target.value })}
                                    placeholder={index === 0 ? '联系人' : '联系人'}
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                  <input
                                    value={row.city}
                                    onChange={(event) => updateShipToRow(row.id, { city: event.target.value })}
                                    placeholder="城市"
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                  <input
                                    value={row.postcode}
                                    onChange={(event) => updateShipToRow(row.id, { postcode: event.target.value })}
                                    placeholder="邮编"
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                  <input
                                    value={row.phone}
                                    onChange={(event) => updateShipToRow(row.id, { phone: event.target.value })}
                                    placeholder="电话"
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                  <input
                                    value={row.address}
                                    onChange={(event) => updateShipToRow(row.id, { address: event.target.value })}
                                    placeholder="详细地址"
                                    className={`w-full h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <input
                                    value={row.note}
                                    onChange={(event) => updateShipToRow(row.id, { note: event.target.value })}
                                    placeholder="备注"
                                    className={`flex-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeShipToRow(row.id)}
                                    className={`shrink-0 w-8 h-8 rounded-control flex items-center justify-center transition-all ${relationFormInlineDangerClass}`}
                                    aria-label="删除此 Ship To"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>工厂地址 (每行一个)</label>
                          <textarea name="factoryAddresses" defaultValue={editingItem?.factoryAddresses?.join('\n')} rows={3} placeholder="浙江省宁波市XX区XX路XX号&#10;江苏省苏州市XX工业园" className={`w-full mt-1 px-4 py-3 rounded-full border outline-none font-light transition-all resize-none ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>仓库地址</label>
                          <input name="warehouseAddress" defaultValue={editingItem?.warehouseAddress} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                      </div>
                    </CompiledSurfacePanel>

                    {/* 财务信息 */}
                    <CompiledSurfacePanel materialRole="raisedCard" edgeFadeItem spotlight as="section" id="relation-form-finance" isDarkMode={isDarkMode} className={RELATIONS_FORM_PANEL_CLASS} spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}>
                      <h4 className={`text-xs font-light tracking-wide mb-4 ${relationFormSectionTitleClass}`}>
                        财务信息
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>付款条款</label>
                          <input type="hidden" name="paymentTerms" value={formSelectValues.paymentTerms || ''} />
                          <CustomSelect
                            className="mt-1"
                            value={formSelectValues.paymentTerms || ''}
                            onChange={(value) => setFormSelectValue('paymentTerms', value)}
                            placeholder="选择付款条款"
                            isDarkMode={isDarkMode}
                            surface="toolbar"
                            options={paymentTermOptions}
                          />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>交易币种</label>
                          <input type="hidden" name="currency" value={formSelectValues.currency || ''} />
                          <CustomSelect
                            className="mt-1"
                            value={formSelectValues.currency || ''}
                            onChange={(value) => setFormSelectValue('currency', value)}
                            placeholder="选择币种"
                            isDarkMode={isDarkMode}
                            surface="toolbar"
                            options={currencyOptions}
                          />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>税号</label>
                          <input name="taxId" defaultValue={editingItem?.taxId} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>信用额度 (USD)</label>
                          <input name="creditLimit" type="number" defaultValue={editingItem?.creditLimit} placeholder="50000" className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div className="col-span-2">
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>付款偏好说明</label>
                          <input name="paymentPreference" defaultValue={editingItem?.paymentPreference} placeholder="偏好电汇，月结30天" className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div className="col-span-2">
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>财务备注 / 付款详细信息</label>
                          <textarea name="financialNotes" defaultValue={editingItem?.financialNotes || ''} rows={3} className={`w-full mt-1 px-4 py-3 rounded-full border outline-none font-light transition-all resize-none ${relationFormFieldClass}`} />
                        </div>
                      </div>
                    </CompiledSurfacePanel>
                  </>
                )}

                {/* 联系人专属字段 */}
                {!relationFormIsOrganization && (
                  <>
                    {/* 联系方式 */}
                    <CompiledSurfacePanel materialRole="raisedCard" edgeFadeItem spotlight as="section" id="relation-form-contact" isDarkMode={isDarkMode} className={RELATIONS_FORM_PANEL_CLASS} spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}>
                      <h4 className={`text-xs font-light tracking-wide mb-4 ${relationFormSectionTitleClass}`}>
                        联系方式
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>邮箱</label>
                          <input name="email" type="email" defaultValue={editingItem?.email} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>座机电话</label>
                          <input name="phone" defaultValue={editingItem?.phone} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>手机号码</label>
                          <input name="mobile" defaultValue={editingItem?.mobile} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>微信号</label>
                          <input name="wechat" defaultValue={editingItem?.wechat} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>WhatsApp</label>
                          <input name="whatsapp" defaultValue={editingItem?.whatsapp} className={`w-full mt-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`} />
                        </div>
                      </div>
                      {/* 其他联系方式（动态添加） */}
                      <div className="mt-4">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>其他联系方式</label>
                          <button
                            type="button"
                            onClick={addOtherContactRow}
                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${relationFormIconAddClass}`}
                            aria-label="添加其他联系方式"
                          >
                            <Plus size={14} strokeWidth={1.8} />
                          </button>
                        </div>
                        <div className="space-y-2">
                          {otherContactRows.map((row) => (
                            <div key={row.id} className="flex items-center gap-2">
                              <input
                                value={row.type}
                                onChange={(e) => updateOtherContactRow(row.id, { type: e.target.value })}
                                placeholder="类型 (LinkedIn/Telegram/…)"
                                className={`w-32 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                              />
                              <input
                                value={row.value}
                                onChange={(e) => updateOtherContactRow(row.id, { value: e.target.value })}
                                placeholder="账号/链接/号码"
                                className={`flex-1 h-9 px-3 rounded-full border outline-none font-light text-xs transition-all ${relationFormFieldClass}`}
                              />
                              <button
                                type="button"
                                onClick={() => removeOtherContactRow(row.id)}
                                className={`shrink-0 w-8 h-8 rounded-control flex items-center justify-center transition-all ${relationFormInlineDangerClass}`}
                                aria-label="删除"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CompiledSurfacePanel>

                    {/* 个人信息 */}
                    <CompiledSurfacePanel materialRole="raisedCard" edgeFadeItem spotlight as="section" id="relation-form-personal" isDarkMode={isDarkMode} className={RELATIONS_FORM_PANEL_CLASS} spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}>
                      <h4 className={`text-xs font-light tracking-wide mb-4 ${relationFormSectionTitleClass}`}>
                        个人信息
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>生日</label>
                          <input type="hidden" name="birthday" value={birthdayDraft} />
                          <CapsuleDateInput
                            value={birthdayDraft}
                            onChange={setBirthdayDraft}
                            isDarkMode={isDarkMode}
                            className="mt-1 w-full"
                          />
                        </div>
                        <div>
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>语言偏好</label>
                          <input type="hidden" name="language" value={formSelectValues.language || ''} />
                          <CustomSelect
                            className="mt-1"
                            value={formSelectValues.language || ''}
                            onChange={(value) => setFormSelectValue('language', value)}
                            placeholder="选择语言"
                            isDarkMode={isDarkMode}
                            surface="toolbar"
                            options={languageOptions}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className={`text-[10px] font-light tracking-wide ml-1 ${relationFormLabelClass}`}>个人备注</label>
                          <textarea name="personalNote" defaultValue={editingItem?.personalNote} rows={2} placeholder="客户偏好、注意事项等..." className={`w-full mt-1 px-4 py-3 rounded-full border outline-none font-light transition-all resize-none ${relationFormFieldClass}`} />
                        </div>
                      </div>
                    </CompiledSurfacePanel>
                  </>
                )}

                {/* 备注 (通用) */}
                <CompiledSurfacePanel materialRole="raisedCard" edgeFadeItem spotlight as="section" id="relation-form-notes" isDarkMode={isDarkMode} className={RELATIONS_FORM_PANEL_CLASS} spotlightSizing={RELATIONS_FORM_PANEL_SPOTLIGHT_SIZING}>
                  <h4 className={`text-xs font-light tracking-wide mb-4 ${relationFormSectionTitleClass}`}>
                    备注与偏好
                  </h4>
                  <textarea
                    name="preferences"
                    defaultValue={editingItem?.preferences}
                    rows={3}
                    placeholder="交易偏好、合作注意事项等..."
                    className={`w-full px-4 py-3 rounded-full border outline-none font-light transition-all resize-none ${relationFormFieldClass}`}
                  />
                </CompiledSurfacePanel>

                  <CompiledSurfacePanel materialRole="raisedCard" edgeFadeItem isDarkMode={isDarkMode} className={`p-4 text-xs text-[var(--text-tertiary)]`}>
                    录入内容会先保存为结构化关系档案；后续订单、样品、财务、Ship To 会从这里复用。
                  </CompiledSurfacePanel>
                  <div data-scroll-edge-bottom-sentinel aria-hidden />
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDeleteId && (() => {
        // 删除对象判定：组织 or 联系人（唯一删除入口为详情页底部，两类共用本弹窗）
        const deleteTarget = relations.find(r => r.id === confirmDeleteId);
        const deletingOrganization = deleteTarget?.isOrganization ?? false;
        return (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className={`bg-[var(--bg-card)] rounded-card w-full max-w-sm shadow-none overflow-hidden animate-in zoom-in duration-300 backdrop-blur-xl`}>
            <div className="p-10 text-center space-y-6">
              <div className={`w-20 h-20 rounded-control flex items-center justify-center mx-auto mb-2 border bg-[var(--recessed-bg)] text-[var(--text-tertiary)] border-[var(--border-c-default)]`}>
                <Trash2 size={32} strokeWidth={1.5} />
              </div>
              <div>
                <h3 className={`text-base font-light mb-2 text-[var(--text-primary)]`}>{deletingOrganization ? '确认移除此组织？' : '确认移除此联系人？'}</h3>
                <p className={`text-xs font-light leading-relaxed text-[var(--text-tertiary)]`}>
                  {deletingOrganization
                    ? '移除后该组织将从关系智库列表消失。相关历史订单与记录仍会保留，此操作可由管理员恢复。'
                    : '移除后该联系人将从所属组织的通讯录消失。相关历史跟进与沟通记录仍会保留，此操作可由管理员恢复。'}
                </p>
              </div>
              {relationSaveError && (
                <div className={`text-xs text-[var(--text-tertiary)] bg-[var(--recessed-bg)] rounded-control px-3 py-2`}>{relationSaveError}</div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={relationBusy}
                  onClick={() => handleDelete(confirmDeleteId)}
                  className="w-full py-4 rounded-full text-sm font-light text-[var(--on-accent)] bg-[var(--accent)] hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  确认移除
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className={`w-full py-4 rounded-full text-sm font-light transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]`}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* 一键溯源侧边面板 */}
      {showTracePanel && selectedOrgId && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setShowTracePanel(false)}
        >
          <div className={`absolute inset-0 bg-[var(--mask-bg)]`} />
          <div
            className={`relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-[var(--border-c-strong)] bg-bds-card/95 backdrop-blur-xl`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 面板标题栏 */}
            <div className={`flex items-center justify-between border-b px-4 py-3 border-[var(--border-c-default)]`}>
              <div className="flex items-center gap-2">
                <GitBranch size={15} className={'text-[var(--text-secondary)]'} />
                <span className={`text-sm font-light text-[var(--text-primary)]`}>客户全景溯源</span>
                <span className={`text-[10px] font-light tracking-[0.14em] text-[var(--text-tertiary)]`}>Customer Panorama</span>
              </div>
              <button
                type="button"
                onClick={() => setShowTracePanel(false)}
                className={`flex h-7 w-7 items-center justify-center rounded-control transition-colors text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-secondary)]`}
              >
                <X size={15} />
              </button>
            </div>
            {/* 溯源内容 */}
            <TraceabilityPanel
              isDarkMode={isDarkMode}
              presetScenario="customerPanorama"
              presetRootId={selectedOrgId}
              embedded
            />
          </div>
        </div>
      )}

    </div>
  );
};

function parseStructuredLines(value: string) {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [nameOrContact, emailOrCity, phone, address, note] = line.split('|').map(part => part.trim());
      return {
        text: line,
        name: nameOrContact || undefined,
        contactName: nameOrContact || undefined,
        email: emailOrCity?.includes('@') ? emailOrCity : undefined,
        city: emailOrCity && !emailOrCity.includes('@') ? emailOrCity : undefined,
        phone: phone || undefined,
        address: address || undefined,
        note: note || undefined,
      };
    });
}

export default RelationsManager;
