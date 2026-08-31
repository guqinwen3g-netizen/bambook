import React, { useState, useEffect, useMemo, useRef } from 'react';
import { hasRole } from '../services/authService';
import { getApiBaseUrl } from '../services/apiBase';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Shield, BookOpen, Wrench, CheckSquare, ScrollText, UserPlus, Check, X, Trash2, Pencil, Fingerprint, Mail, KeyRound, Clock3, Building2, BadgeCheck, Crown, Workflow, Ruler, Database, ArrowLeftRight } from 'lucide-react';
import { WorkflowPanel } from './WorkflowPanel';
import { CompanyProfileSection } from './admin/CompanyProfileSection';
import { PlatformRulesSection } from './admin/PlatformRulesSection';
import { DataMigrationPanel } from './admin/DataMigrationPanel';
import { useStaticEdgeMask } from './ui/useStaticEdgeMask';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import UserAvatar from './ui/UserAvatar';
import SidePanelContainer from './ui/SidePanelContainer';
import BottomSheet from './ui/BottomSheet';
import CustomSelect from './ui/CustomSelect';
import ToggleSwitch from './ui/ToggleSwitch';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';
import { buildDepartmentOptions } from '../lib/departmentTree';
import { handoverService, HandoverCounts } from '../services/handoverService';

const AVAILABLE_ROLES = ['viewer', 'merchandiser', 'sales', 'finance', 'manager', 'agent_operator', 'admin', 'owner'] as const;
const ROLE_LABELS: Record<typeof AVAILABLE_ROLES[number], string> = {
  viewer: '查看员',
  merchandiser: '跟单',
  sales: '销售',
  finance: '财务',
  manager: '经理',
  agent_operator: '智能体操作员',
  admin: '管理员',
  owner: '所有者',
};
/**
 * DR-041 宽泛角色容器（Role 表 id 以 role- 前缀 seed），用户分配角色的唯一选项来源。
 * 旧枚举角色（viewer/owner 等）仅作为 JWT 聚合映射的内部依赖，不再出现在分配选项中。
 * 顺序即展示顺序：一线 → 主管 → 职能 → 管理层。
 */
const ROLE_CONTAINER_ORDER = [
  'role-sales', 'role-sales-manager', 'role-finance',
  'role-qc', 'role-logistics', 'role-admin', 'role-super-admin',
] as const;
const DEFAULT_ASSIGN_ROLE = 'role-sales';
const PERMISSION_LABELS: Record<string, string> = {
  '*': '全部权限',
  'users:read': '查看用户',
  'users:write': '创建/编辑用户',
  'users:delete': '停用/抹除用户',
  'roles:read': '查看角色权限',
  'roles:write': '编辑角色权限',
  'orders:read': '查看订单',
  'orders:write': '创建/编辑订单',
  'orders:delete': '删除订单',
  'products:read': '查看产品档案',
  'products:write': '创建/编辑产品档案',
  'relations:read': '查看关系智库',
  'relations:write': '创建/编辑关系智库',
  'knowledge:read': '查看数据中心',
  'knowledge:write': '编辑数据中心',
  'knowledge:admin': '管理数据中心权限',
  'tools:execute': '使用智能工具',
  'tools:admin': '管理工具权限',
  'finance:read': '查看财务',
  'finance:write': '编辑财务',
  'ai:chat': '使用 AI 对话',
  'ai:agent': '使用 AI Agent',
  'emails:read': '查看邮件',
  'emails:write': '发送邮件',
  'settings:read': '查看系统设置',
  'settings:write': '修改系统设置',
  'audit:read': '查看审计日志',
  'approvals:read': '查看审批',
  'approvals:write': '审批决策',
};
const ACCESS_LABELS: Record<string, string> = {
  read: '只读',
  write: '可编辑',
  execute: '可执行',
  admin: '管理',
  none: '无权限',
};
const RISK_MODE_LABELS: Record<string, string> = {
  direct: '直接执行',
  approval: '需审批',
  disabled: '已禁用',
};
const ADMIN_USER_STATUS_OPTIONS = [
  { value: 'active', label: '正常' },
  { value: 'pending', label: '待审批' },
  { value: 'disabled', label: '已停用' },
  { value: 'rejected', label: '已驳回' },
] as const;

const EMPTY_USER_EDIT_DRAFT = {
  displayName: '',
  email: '',
  departmentId: '',
  status: 'active',
  role: DEFAULT_ASSIGN_ROLE,
};

const EMPTY_NEW_USER_DRAFT = {
  displayName: '',
  email: '',
  password: '',
  roles: DEFAULT_ASSIGN_ROLE as string,
  departmentId: '',
};

const KNOWLEDGE_SCOPES = ['company', 'department', 'team', 'private'] as const;
const ACCESS_LEVELS = ['read', 'write', 'admin', 'none'] as const;
const TOOL_ACCESS_LEVELS = ['execute', 'read', 'admin', 'none'] as const;
const RISK_MODES = ['direct', 'approval', 'disabled'] as const;
/** R3：系统日志每页条数（与后端 entityQuery 默认 limit=100 对齐，显式传参翻页） */
const AUDIT_PAGE_SIZE = 100;

/** datetime-local 值 → epoch ms（后端 entityQuery 仅收毫秒时间戳）；
 *  转换失败不伪造成功：原值透传，由后端 INVALID_DATE_RANGE fail closed */
const auditDateTimeToMs = (value: string): string => {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? String(t) : value;
};

const formatRoleLabel = (role: string) => ROLE_LABELS[role as typeof AVAILABLE_ROLES[number]] || role;
const formatPermissionLabel = (scope: string) => PERMISSION_LABELS[scope] || scope;
const formatAccessLabel = (access: string) => ACCESS_LABELS[access] || access;
const formatRiskModeLabel = (mode: string) => RISK_MODE_LABELS[mode] || mode;

type TabId = 'users' | 'roles' | 'knowledge-acl' | 'tool-perms' | 'approvals' | 'workflow' | 'audit-logs' | 'company-profile' | 'platform-rules' | 'data-migration';
type AdminTabCache = Partial<Record<TabId, any>>;

const ADMIN_PANEL_SESSION_CACHE_KEY = 'bambook_admin_panel_session_cache_v1';

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'roles', label: '角色与权限', icon: Shield },
  { id: 'company-profile', label: '公司档案', icon: Building2 },
  { id: 'platform-rules', label: '平台规则', icon: Ruler },
  { id: 'knowledge-acl', label: '知识库权限', icon: BookOpen },
  { id: 'tool-perms', label: '工具权限', icon: Wrench },
  { id: 'approvals', label: '学习与审批', icon: CheckSquare },
  { id: 'workflow', label: '工作流审批', icon: Workflow },
  { id: 'audit-logs', label: '系统日志', icon: ScrollText },
  { id: 'data-migration', label: '数据迁移', icon: Database },
];

export const ADMIN_PANEL_BODY_CLASS = `${BAMBOOK_OS.layout.desktopPanelRowClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass}`;
export const ADMIN_PANEL_SURFACE_CLASS = 'h-full min-h-0 overflow-hidden';
export const ADMIN_PANEL_SCROLL_CLASS = 'h-full min-h-0 overflow-y-auto custom-scrollbar';
export const ADMIN_USER_LIST_SCROLL_CLASS = 'min-h-0 flex-1 overflow-y-auto custom-scrollbar';
export const ADMIN_PANEL_GLASS_CLASS = `${BAMBOOK_OS.material.glassColor} ${BAMBOOK_OS.material.panelSurface} border-transparent bg-[var(--recessed-bg)] shadow-none`;
export const ADMIN_USER_CARD_CLASS = `${BAMBOOK_OS.material.glassColor} ${BAMBOOK_OS.material.panelSurface} border-[var(--border-c-strong)] bg-[var(--recessed-bg)]`;
export const ADMIN_USER_FIELD_CLASS = 'bds-input';
// 旧导出别名（配方已坍缩为自适应单条，外部引用与测试保持不变）
export const ADMIN_PANEL_GLASS_DARK_CLASS = ADMIN_PANEL_GLASS_CLASS;
export const ADMIN_PANEL_GLASS_LIGHT_CLASS = ADMIN_PANEL_GLASS_CLASS;
export const ADMIN_USER_CARD_DARK_CLASS = ADMIN_USER_CARD_CLASS;
export const ADMIN_USER_CARD_LIGHT_CLASS = ADMIN_USER_CARD_CLASS;
export const ADMIN_USER_FIELD_DARK_CLASS = ADMIN_USER_FIELD_CLASS;
export const ADMIN_USER_FIELD_LIGHT_CLASS = ADMIN_USER_FIELD_CLASS;

const formatAdminDate = (value?: string | null) => {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const readAdminPanelCache = (): AdminTabCache => {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(ADMIN_PANEL_SESSION_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeAdminPanelCache = (tab: TabId, data: any) => {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const cache = readAdminPanelCache();
    sessionStorage.setItem(ADMIN_PANEL_SESSION_CACHE_KEY, JSON.stringify({
      ...cache,
      [tab]: {
        ...data,
        cachedAt: Date.now(),
      },
    }));
  } catch {
    // Session cache is only a zero-flicker accelerator.
  }
};

const maskAdminEmail = (value?: string | null) => {
  if (!value || !value.includes('@')) return '邮箱已设置';
  const [name, domain] = value.split('@');
  const head = name.slice(0, 2);
  return `${head}${name.length > 2 ? '***' : '*'}@${domain}`;
};

const createAdminGeneratedUserId = (email: string, displayName: string) => {
  const source = (email.split('@')[0] || displayName || 'user').toLowerCase();
  const slug = source
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'user';
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `user_${slug}_${random}`;
};

interface AdminPanelProps { isDarkMode: boolean; }

const AdminPanel: React.FC<AdminPanelProps> = ({ isDarkMode }) => {
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const userListScrollRef = useRef<HTMLDivElement | null>(null);
  // 边缘渐隐：固定 mask 挂滚动容器自身（与 ScrollEdgeFades 原参数同口径——主区 96/112 默认档、
  // 用户列表 56/72）；users tab 主区不滚动（ADMIN_PANEL_SCROLL_CLASS 不挂），enabled 跟随 tab
  const [activeTab, setActiveTab] = useState<TabId>('users');
  useStaticEdgeMask(mainScrollRef, { topFadeEnd: 96, bottomFade: 112, enabled: activeTab !== 'users' });
  useStaticEdgeMask(userListScrollRef, { topFadeEnd: 56, bottomFade: 72, enabled: activeTab === 'users' });
  const [users, setUsers] = useState<any[]>(() => readAdminPanelCache().users?.users || []);
  const [approvals, setApprovals] = useState<any[]>(() => readAdminPanelCache().approvals?.approvals || []);
  const [suggestions, setSuggestions] = useState<any[]>(() => readAdminPanelCache().approvals?.suggestions || []);
  const [auditLogs, setAuditLogs] = useState<any[]>(() => readAdminPanelCache()['audit-logs']?.logs || []);
  // R3：系统日志分页（后端 entityQuery 默认截 100 并返回 total；limit/offset + 共 N 条翻页）
  const [auditTotal, setAuditTotal] = useState<number>(() => readAdminPanelCache()['audit-logs']?.total ?? 0);
  const [auditOffset, setAuditOffset] = useState(0);
  // task_mr1ncdp9: audit query filter state（只发非空字段到 query string）
  const [auditFilter, setAuditFilter] = useState({ targetType: '', targetId: '', action: '', actorId: '', createdFrom: '', createdTo: '' });
  const [auditFilterError, setAuditFilterError] = useState('');
  const [roles, setRoles] = useState<any[]>(() => readAdminPanelCache().roles?.roles || []);
  // 用户角色分配选项：仅 DR-041 容器角色（真源 /api/admin/roles，按 ROLE_CONTAINER_ORDER 排序）
  const assignableRoles = useMemo(() => {
    const byId = new Map(roles.filter(r => ROLE_CONTAINER_ORDER.includes(r.id)).map(r => [r.id, r]));
    return ROLE_CONTAINER_ORDER.map(id => byId.get(id)).filter(Boolean) as any[];
  }, [roles]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({});
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState(EMPTY_USER_EDIT_DRAFT);
  // 用户表单部门选项（真源 /api/admin/users 响应 departments；与 kbDepartments 同构但独立缓存于 users tab）
  const [userDepartments, setUserDepartments] = useState<any[]>(() => readAdminPanelCache().users?.departments || []);

  // REQ2-13 离职一键交接 state（DR-056：预览→确认→执行，BottomSheet 承载）
  const [handoverTarget, setHandoverTarget] = useState<any | null>(null);
  const [handoverSuccessorId, setHandoverSuccessorId] = useState('');
  const [handoverPreview, setHandoverPreview] = useState<{ fromUser: any; counts: HandoverCounts; warnings: string[] } | null>(null);
  const [handoverPreviewLoading, setHandoverPreviewLoading] = useState(false);
  const [handoverDisable, setHandoverDisable] = useState(true);
  const [handoverNote, setHandoverNote] = useState('');
  const [handoverExecuting, setHandoverExecuting] = useState(false);
  const [handoverError, setHandoverError] = useState('');
  const [handoverResult, setHandoverResult] = useState<{ handoverId: string; counts: HandoverCounts; accountDisabled: boolean } | null>(null);
  const [handoverRecords, setHandoverRecords] = useState<any[]>([]);

  // Knowledge ACL state
  const [knowledgeAcls, setKnowledgeAcls] = useState<any[]>(() => readAdminPanelCache()['knowledge-acl']?.acls || []);
  const [kbDocuments, setKbDocuments] = useState<any[]>(() => readAdminPanelCache()['knowledge-acl']?.documents || []);
  const [kbRoles, setKbRoles] = useState<any[]>(() => readAdminPanelCache()['knowledge-acl']?.roles || []);
  const [kbDepartments, setKbDepartments] = useState<any[]>(() => readAdminPanelCache()['knowledge-acl']?.departments || []);
  const [showAclForm, setShowAclForm] = useState(false);
  const [aclForm, setAclForm] = useState({ documentId: '', roleId: '', departmentId: '', scope: 'company', access: 'read' });
  const [editingAclId, setEditingAclId] = useState<string | null>(null);

  // Role permissions state
  const [allPermissions, setAllPermissions] = useState<any[]>(() => readAdminPanelCache().roles?.permissions || []);
  const [permEditingRoleId, setPermEditingRoleId] = useState<string | null>(null);
  const [permDraft, setPermDraft] = useState<string[]>([]);

  // Tool permissions state
  const [tools, setTools] = useState<any[]>(() => readAdminPanelCache()['tool-perms']?.tools || []);
  const [toolRoles, setToolRoles] = useState<any[]>(() => readAdminPanelCache()['tool-perms']?.roles || []);
  const [showToolPermForm, setShowToolPermForm] = useState(false);
  const [toolPermForm, setToolPermForm] = useState({ toolId: '', roleId: '', access: 'execute', riskMode: 'direct' });

  // New user form
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER_DRAFT);
  // 用户列表搜索 / 状态筛选（客户端过滤已加载列表）
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<string>('all');

  const adminGlassClass = ADMIN_PANEL_GLASS_CLASS;
  const userCardClass = ADMIN_USER_CARD_CLASS;
  const card = `rounded-inset border transition-[background,border-color,box-shadow] duration-300 ${userCardClass}`;
  const labelCls = `text-[10px] font-light tracking-wide ${BAMBOOK_OS.tone.text.formLabel}`;
  // v2.3 字段统一裁决：BDS .bds-input 已胶囊化（36px/描边/rounded-control），
  // 与原 recessedField 胶囊配方完全同规格——表单字段直接用 BDS 类，消灭双真源
  const inputCls = 'bds-input';
  const actionButtonCls = `h-9 px-3 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-[background,color,box-shadow,transform,border-color] duration-200 ${BAMBOOK_OS.controls.actionControl.bordered}`;
  const primaryButtonCls = `h-9 px-4 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-[background,color,box-shadow,transform,border-color] duration-200 ${BAMBOOK_OS.controls.stateControl.base} ${BAMBOOK_OS.controls.stateControl.interaction}`;
  const brandTextCls = BAMBOOK_OS.tone.text.brandEmphasis;
  const neutralChipCls = `rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]`;
  const brandChipCls = `rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--os-vnext-brand-blue)]/8 text-[var(--os-vnext-brand-blue-strong)]`;
  const dangerChipCls = `rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]`;
  const brandActionCls = `h-9 px-3 rounded-control text-[11px] font-light inline-flex items-center gap-1 transition-colors disabled:opacity-50 bg-[var(--os-vnext-brand-blue)]/8 text-[var(--os-vnext-brand-blue-strong)] hover:bg-[var(--os-vnext-brand-blue)]/12`;
  const dangerActionCls = `h-9 px-3 rounded-control text-[11px] font-light inline-flex items-center gap-1 transition-colors disabled:opacity-50 bg-[var(--recessed-bg)] text-[var(--text-secondary)] hover:bg-[var(--active-darken)]`;
  const quietDangerActionCls = `h-9 px-3 rounded-control border text-[11px] font-light transition-colors disabled:opacity-50 inline-flex items-center gap-1 border-[var(--border-c-strong)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]`;
  const adminTitleClass = `${BAMBOOK_OS.layout.desktopTitleTextClass} text-os-adaptive-title`;
  const adminPanelEyebrowClass = `text-[10px] font-light uppercase ${BAMBOOK_OS.typography.tracking.overline} text-[var(--text-tertiary)]`;
  const sectionTitleClass = `text-sm font-light text-[var(--text-primary)]`;
  const sectionMutedClass = `text-xs font-light text-[var(--text-tertiary)]`;
  const inlinePanelClass = 'rounded-control border border-[var(--border-c-default)] bg-[var(--recessed-bg)]';
  const inlineRowClass = `rounded-compact bg-[var(--recessed-bg)]`;
  const subtleButtonCls = `h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors border-[var(--border-c-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-darken)]`;
  const navItemBaseClass = `flex items-center gap-2.5 px-3 h-9 rounded-full text-[11px] font-light tracking-wide transition-colors duration-200`;
  const navItemActiveClass = 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]';
  const navItemIdleClass = 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-darken)]';

  const apiBase = getApiBaseUrl().replace(/\/$/, '');
  const authToken = () => localStorage.getItem('bambook_auth_token') || sessionStorage.getItem('bambook_auth_token');

  const adminHeaders = (extra: Record<string, string> = {}) => {
    const token = authToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  };

  const fetchAdmin = async (path: string) => {
    const res = await fetch(`${apiBase}/admin/${path}`, { headers: adminHeaders(), credentials: authToken() ? 'omit' : 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `Failed to fetch ${path} (HTTP ${res.status})`);
    return data;
  };

  // 角色分配选项独立于 roles tab 加载：用户审批/编辑表单在任何 tab 都可能渲染
  useEffect(() => {
    if (assignableRoles.length > 0) return;
    let cancelled = false;
    fetchAdmin('roles')
      .then(d => { if (!cancelled) setRoles(d.roles || []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // task_mr1ncdp9: audit-logs 带筛选 query string（只发非空字段，消费后端 contract）
  // R3：limit/offset 分页（后端默认截 100 且返回 total），翻页保持当前筛选
  const fetchAuditLogs = async (filter?: typeof auditFilter, offset = 0) => {
    const f = filter || auditFilter;
    const hasFilter = Boolean(f.targetType.trim() || f.targetId.trim() || f.action.trim() || f.actorId.trim() || f.createdFrom.trim() || f.createdTo.trim());
    const params = new URLSearchParams();
    if (f.targetType.trim()) params.set('targetType', f.targetType.trim());
    if (f.targetId.trim()) params.set('targetId', f.targetId.trim());
    if (f.action.trim()) params.set('action', f.action.trim());
    if (f.actorId.trim()) params.set('actorId', f.actorId.trim());
    // 前端收 datetime-local，转 epoch ms 发给后端（后端仅收毫秒时间戳；转换失败原值透传 fail closed）
    if (f.createdFrom.trim()) params.set('createdFrom', auditDateTimeToMs(f.createdFrom.trim()));
    if (f.createdTo.trim()) params.set('createdTo', auditDateTimeToMs(f.createdTo.trim()));
    params.set('limit', String(AUDIT_PAGE_SIZE));
    if (offset > 0) params.set('offset', String(offset));
    try {
      const d = await fetchAdmin(`audit-logs?${params.toString()}`);
      setAuditLogs(d.logs || []);
      setAuditTotal(typeof d.total === 'number' ? d.total : (d.logs || []).length);
      setAuditOffset(offset);
      setAuditFilterError('');
      // 只有无筛选首页才缓存，避免筛选/翻页结果污染默认缓存
      if (offset === 0 && !hasFilter) writeAdminPanelCache('audit-logs', d);
    } catch (e: any) {
      // 筛选区显示后端 INVALID_DATE_RANGE/INVALID_PAGINATION 错误（不伪成功）
      setAuditFilterError(e?.message || String(e));
    }
  };

  const postAdmin = async (path: string, body: any, method = 'POST') => {
    const res = await fetch(`${apiBase}/admin/${path}`, {
      method, headers: adminHeaders({ 'Content-Type': 'application/json' }), credentials: authToken() ? 'omit' : 'include', body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Failed');
    return data;
  };

  // DR-042 小组管理已按 v2.1 归位迁入 HRManager 人事管理（组织人事概念）；
  // 本面板收敛为软件层治理（账号/角色/工具权限/平台规则），hr 域 API 通道随之移除。

  const applyAdminTabPayload = (tab: TabId, data: any) => {
    if (tab === 'users') {
      setUsers(data.users || []);
      if (data.departments) setUserDepartments(data.departments);
    }
    if (tab === 'roles') {
      setRoles(data.roles || []);
      if (data.permissions) setAllPermissions(data.permissions || []);
    }
    if (tab === 'approvals') {
      setApprovals(data.approvals || []);
      setSuggestions(data.suggestions || []);
    }
    if (tab === 'audit-logs') {
      setAuditLogs(data.logs || []);
      setAuditTotal(typeof data.total === 'number' ? data.total : (data.logs || []).length);
    }
    if (tab === 'knowledge-acl') {
      setKnowledgeAcls(data.acls || []);
      setKbDocuments(data.documents || []);
      setKbRoles(data.roles || []);
      setKbDepartments(data.departments || []);
    }
    if (tab === 'tool-perms') {
      setTools(data.tools || []);
      setToolRoles(data.roles || []);
    }
  };

  const hydrateAdminTabFromCache = (tab: TabId) => {
    const cached = readAdminPanelCache()[tab];
    if (!cached) return false;
    applyAdminTabPayload(tab, cached);
    return true;
  };

  useEffect(() => {
    hydrateAdminTabFromCache(activeTab);
    loadTab(activeTab);
  }, [activeTab]);

  const loadTab = async (tab: TabId) => {
    const hasCachedView = hydrateAdminTabFromCache(tab);
    setLoading(!hasCachedView);
    setLoadError('');
    try {
      if (tab === 'users') {
        const d = await fetchAdmin('users');
        applyAdminTabPayload(tab, d);
        writeAdminPanelCache(tab, d);
      }
      if (tab === 'approvals') {
        const [a, s] = await Promise.all([fetchAdmin('approvals'), fetchAdmin('suggestions')]);
        const data = { approvals: a.approvals || [], suggestions: s.suggestions || [] };
        applyAdminTabPayload(tab, data);
        writeAdminPanelCache(tab, data);
      }
      if (tab === 'audit-logs') {
        await fetchAuditLogs();
      }
      if (tab === 'knowledge-acl') {
        const d = await fetchAdmin('knowledge-acl');
        applyAdminTabPayload(tab, d);
        writeAdminPanelCache(tab, d);
      }
      if (tab === 'tool-perms') {
        const d = await fetchAdmin('tool-permissions');
        applyAdminTabPayload(tab, d);
        writeAdminPanelCache(tab, d);
      }
      if (tab === 'roles') {
        const [d, p] = await Promise.all([fetchAdmin('roles'), fetchAdmin('permissions')]);
        const data = { roles: d.roles || [], permissions: p.permissions || [] };
        applyAdminTabPayload(tab, data);
        writeAdminPanelCache(tab, data);
      }
    } catch (e: any) {
      console.error('Admin load failed:', e.message);
      setLoadError(e.message || '管理后台数据加载失败');
    }
    finally { setLoading(false); }
  };

  const approvePendingUser = async (userId: string) => {
    const role = (pendingRoles[userId] || DEFAULT_ASSIGN_ROLE).trim() || DEFAULT_ASSIGN_ROLE;
    setActionBusyId(userId);
    setLoadError('');
    try {
      const data = await postAdmin(`users/${userId}/approve`, { roles: [role] });
      await loadTab('users');
      // 批准成功的三类后续状态走 toast（loadError 是错误横幅，不承载非错误信息）
      if (data?.emailStatus === 'failed') {
        bdsToast.warning(`已批准，但通知邮件发送失败：${data.emailError || '未知错误'}`);
      } else if (data?.emailStatus === 'skipped') {
        bdsToast.info('已批准。该用户未填写邮箱，未发送通知邮件。');
      } else {
        bdsToast.success('已批准该注册申请。');
      }
    } catch (e: any) {
      setLoadError(e.message || '批准失败');
    } finally {
      setActionBusyId(null);
    }
  };

  const rejectPendingUser = async (userId: string) => {
    if (!(await bdsConfirm({ title: '确认驳回', body: '确认驳回该注册申请？' }))) return;
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}/reject`, { reason: '' });
      await loadTab('users');
      bdsToast.success('已驳回该注册申请。');
    } catch (e: any) {
      setLoadError(e.message || '驳回失败');
    } finally {
      setActionBusyId(null);
    }
  };

  const disableAccount = async (userId: string, displayName: string) => {
    if (!(await bdsConfirm({ title: '确认停用账号', body: `确认停用账号「${displayName || userId}」？该账号将无法登录，但用户档案、角色和业务历史会保留。` }))) return;
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}/disable-account`, {});
      await loadTab('users');
      bdsToast.success(`账号「${displayName || userId}」已停用。`);
    } catch (e: any) {
      setLoadError(e.message || '停用账号失败');
    } finally {
      setActionBusyId(null);
    }
  };

  // ── REQ2-13 离职一键交接（DR-056：预览→确认→执行；停用即时失效由服务端组合根守卫承接） ──
  const handoverSuccessorOptions = useMemo(
    () => users.filter((u: any) => u.status === 'active' && u.id !== handoverTarget?.id),
    [users, handoverTarget],
  );

  const refreshHandoverPreview = async (fromUserId: string, toUserId?: string) => {
    setHandoverPreviewLoading(true);
    setHandoverError('');
    try {
      setHandoverPreview(await handoverService.preview(fromUserId, toUserId || undefined));
    } catch (e: any) {
      setHandoverError(e.message || '交接预览加载失败');
    } finally {
      setHandoverPreviewLoading(false);
    }
  };

  const openHandover = async (u: any) => {
    setHandoverTarget(u);
    setHandoverSuccessorId('');
    setHandoverPreview(null);
    setHandoverDisable(true);
    setHandoverNote('');
    setHandoverError('');
    setHandoverResult(null);
    setHandoverRecords([]);
    setHandoverPreviewLoading(true);
    try {
      const [preview, records] = await Promise.all([
        handoverService.preview(u.id),
        handoverService.listRecords(10),
      ]);
      setHandoverPreview(preview);
      setHandoverRecords(records.records);
    } catch (e: any) {
      setHandoverError(e.message || '交接预览加载失败');
    } finally {
      setHandoverPreviewLoading(false);
    }
  };

  const executeHandover = async () => {
    if (!handoverTarget || !handoverSuccessorId || handoverExecuting) return;
    const successor = handoverSuccessorOptions.find((u: any) => u.id === handoverSuccessorId);
    const confirmed = await bdsConfirm({
      title: '确认执行离职交接',
      body: `将「${handoverTarget.displayName}」名下全部客户资产移交给「${successor?.displayName || handoverSuccessorId}」？${handoverDisable ? '交接完成后其账号将立即停用（未过期登录凭证同步失效）。' : '其账号将保持当前状态（不停用）。'}此操作单事务原子执行、全程留痕，不可撤销。`,
      danger: true,
    });
    if (!confirmed) return;
    setHandoverExecuting(true);
    setHandoverError('');
    try {
      const result = await handoverService.execute({
        fromUserId: handoverTarget.id,
        toUserId: handoverSuccessorId,
        disableAccount: handoverDisable,
        note: handoverNote.trim() || undefined,
      });
      setHandoverResult(result);
      bdsToast.success('离职交接完成，资产已全部移交。');
      await loadTab('users');
      setHandoverRecords((await handoverService.listRecords(10)).records);
    } catch (e: any) {
      setHandoverError(e.message || '交接执行失败');
    } finally {
      setHandoverExecuting(false);
    }
  };

  const closeHandoverSheet = () => {
    if (handoverExecuting) return;
    setHandoverTarget(null);
  };

  const startUserEdit = (u: any) => {
    // 优先用 roleId（DR-041 容器 id，与角色选择器值域一致）；旧数据无 roleIds 时回退角色名
    const primaryRole = (Array.isArray(u.roleIds) && u.roleIds[0])
      || (Array.isArray(u.roles) && u.roles[0])
      || DEFAULT_ASSIGN_ROLE;
    setEditingUserId(u.id);
    setUserDraft({
      displayName: u.displayName || '',
      email: u.email || '',
      departmentId: u.departmentId || '',
      status: u.status || 'active',
      role: primaryRole,
    });
    setLoadError('');
  };

  const cancelUserEdit = () => {
    setEditingUserId(null);
    setUserDraft(EMPTY_USER_EDIT_DRAFT);
  };

  const saveUserEdit = async (userId: string) => {
    const displayName = userDraft.displayName.trim();
    const email = userDraft.email.trim();
    const departmentId = userDraft.departmentId.trim();
    const role = userDraft.role.trim();
    if (!displayName || !email || !role) {
      setLoadError('姓名、邮箱和角色权限不能为空');
      return;
    }
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}`, { displayName, email, departmentId: departmentId || null, status: userDraft.status }, 'PATCH');
      await postAdmin(`users/${userId}/roles`, { roles: [role] }, 'PATCH');
      await loadTab('users');
      setEditingUserId(null);
      setUserDraft(EMPTY_USER_EDIT_DRAFT);
      bdsToast.success('账号已保存。');
    } catch (e: any) {
      setLoadError(e.message || '保存用户失败');
    } finally {
      setActionBusyId(null);
    }
  };

  const erasePersonalData = async (userId: string, displayName: string) => {
    if (!(await bdsConfirm({ title: '确认抹除', body: `确认抹除「${displayName || userId}」的个人数据？这会删除个人会话、消息、记忆和工具运行记录，并匿名化账号；业务数据不会删除。`, danger: true }))) return;
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}/erase-personal-data`, {});
      await loadTab('users');
      bdsToast.success(`「${displayName || userId}」的个人数据已抹除。`);
    } catch (e: any) {
      setLoadError(e.message || '抹除个人数据失败');
    } finally {
      setActionBusyId(null);
    }
  };

  // 生成随机强临时密码（12 位，字母+数字，crypto 随机源），禁止使用弱默认密码
  const generateTempPassword = (): string => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  };

  const resetPassword = async (userId: string, displayName: string) => {
    if (!(await bdsConfirm({ title: '确认重置密码', body: `确认为「${displayName || userId}」重置密码？系统将生成随机临时密码，仅展示一次。` }))) return;
    const newPassword = generateTempPassword();
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}/reset-password`, { newPassword });
      // 一次性展示：新密码仅在此刻可见，不落盘、不回显在页面状态中；
      // 用驻留弹窗而非 toast——toast 3.2s 自动消失，临时密码来不及复制
      await bdsConfirm({ title: '密码已重置', body: `临时密码：${newPassword}（仅显示一次，请立即保存）`, confirmText: '我已保存' });
    } catch (e: any) {
      setLoadError(e.message || '重置密码失败');
    } finally {
      setActionBusyId(null);
    }
  };

  // 审批决策：fail closed + busy 防重（高危操作失败必须显式呈现，禁止静默）
  const decideApproval = async (approvalId: string, status: 'approved' | 'rejected') => {
    setActionBusyId(`approval:${approvalId}`);
    setLoadError('');
    try {
      await postAdmin(`approvals/${approvalId}`, { status }, 'PATCH');
      await loadTab('approvals');
      bdsToast.success(status === 'approved' ? '已通过审批。' : '已驳回审批。');
    } catch (e: any) {
      setLoadError(e.message || '审批操作失败');
    } finally {
      setActionBusyId(null);
    }
  };

  const decideSuggestion = async (suggestionId: string, status: 'accepted' | 'rejected') => {
    setActionBusyId(`suggestion:${suggestionId}`);
    setLoadError('');
    try {
      await postAdmin(`suggestions/${suggestionId}`, { status }, 'PATCH');
      await loadTab('approvals');
      bdsToast.success(status === 'accepted' ? '已采纳该建议。' : '已驳回该建议。');
    } catch (e: any) {
      setLoadError(e.message || '建议操作失败');
    } finally {
      setActionBusyId(null);
    }
  };

  if (!hasRole('owner', 'admin')) {
    return <div className="px-5 py-4 text-center text-[var(--text-tertiary)]">需要管理员权限</div>;
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <PageHeader
        title="管理后台"
        subtitle="System Administration"
        contextLabel="Access Control"
        isDarkMode={isDarkMode}
      />

      <div className="flex-1 min-h-0 flex gap-3 px-7 pb-5 pt-1 overflow-hidden">
        <SidePanelContainer
          as="nav"
          isDarkMode={isDarkMode}
          spotlight
          surfaceRole="framePanel"
          shadowRole="frame"
          shadowMode="attached"
          className={`${ADMIN_PANEL_SURFACE_CLASS} w-52 md:w-56 shrink-0`}
          contentClassName="relative z-10 flex h-full min-h-0 flex-col gap-1 p-2"
        >
          {TABS.map(tab => {
            const Icon = tab.icon;
            const on = activeTab === tab.id;
            return (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                data-os-vnext-active={on ? 'true' : 'false'}
                className={`${navItemBaseClass} ${on ? navItemActiveClass : navItemIdleClass}`}>
                <Icon size={14} strokeWidth={1.25} className="shrink-0 opacity-80" />
                <span className="text-[11px]">{tab.label}</span>
              </button>
            );
          })}
        </SidePanelContainer>

        <SidePanelContainer
          isDarkMode={isDarkMode}
          spotlight
          surfaceRole="framePanel"
          shadowRole="frame"
          shadowMode="attached"
          className={`${ADMIN_PANEL_SURFACE_CLASS} relative flex-1`}
          contentClassName="relative z-10 h-full min-h-0"
        >
          <div
            ref={activeTab === 'users' ? undefined : mainScrollRef}
            className={`${activeTab === 'users' ? 'h-full min-h-0 overflow-hidden' : ADMIN_PANEL_SCROLL_CLASS} px-5 py-4`}
          >
            {loadError && (
              <div className={`mb-3 rounded-control border px-4 py-2 text-xs font-light border-[var(--border-c-default)] bg-[var(--recessed-bg)] text-[var(--text-tertiary)]`}>
                {loadError}
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className={activeTab === 'users' ? 'h-full min-h-0 w-full' : 'w-full space-y-4'}>

              {activeTab === 'users' && (() => {
                const pendingUsers = users.filter(u => u.status === 'pending');
                const activeUsers = users.filter(u => u.status !== 'pending');
                // 姓名 / 邮箱关键字 + 状态筛选（客户端过滤）
                const userKeyword = userSearch.trim().toLowerCase();
                const visibleUsers = activeUsers.filter(u => {
                  if (userStatusFilter !== 'all' && u.status !== userStatusFilter) return false;
                  if (!userKeyword) return true;
                  return (u.displayName || '').toLowerCase().includes(userKeyword)
                    || (u.email || '').toLowerCase().includes(userKeyword);
                });
                const editingUser = editingUserId ? activeUsers.find(u => u.id === editingUserId) : null;
                return (
                <div className="flex h-full min-h-0 flex-col gap-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className={adminPanelEyebrowClass}>Identity Control</p>
                      <p data-ui-lab-wallpaper-contrast="primary" className={`mt-1 text-sm font-light text-[var(--text-primary)]`}>用户管理</p>
                      <p className={`mt-1 text-[11px] font-light text-[var(--text-tertiary)]`}>
                        {users.length} 个用户 · {activeUsers.length} 个账号 · {pendingUsers.length} 个待审批
                      </p>
                    </div>
                    <button onClick={() => {
                      // 收起时重置草稿，避免下次打开残留上次输入
                      if (showNewUser) setNewUser(EMPTY_NEW_USER_DRAFT);
                      setShowNewUser(!showNewUser);
                    }} className={actionButtonCls}>
                      <UserPlus size={14} strokeWidth={1.5} />
                      {showNewUser ? '取消' : '新建用户'}
                    </button>
                  </div>

                  {showNewUser && (
                    <div className={card + ' p-5 space-y-4'}>
                      <div>
                        <h3 className={`text-sm font-light text-[var(--text-primary)]`}>新建用户</h3>
                        <p className={`mt-1 text-[11px] font-light text-[var(--text-tertiary)]`}>
                          用户 ID 将自动生成；密码只在创建/重置时可设置，数据库不会保存明文密码。
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div><label className={labelCls}>姓名</label><input value={newUser.displayName} onChange={e => setNewUser({...newUser, displayName: e.target.value})} className={inputCls + ' mt-1'} placeholder="员工姓名" /></div>
                        <div><label className={labelCls}>邮箱</label><input type="email" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} className={inputCls + ' mt-1'} placeholder="name@company.com" /></div>
                        <div><label className={labelCls}>密码</label><input type="password" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className={inputCls + ' mt-1'} placeholder="至少6位" /></div>
                        <div><label className={labelCls}>角色</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={newUser.roles}
                            onChange={v => setNewUser({ ...newUser, roles: v })}
                            options={assignableRoles.length > 0
                              ? assignableRoles.map(role => ({ value: role.id, label: role.name }))
                              : [{ value: DEFAULT_ASSIGN_ROLE, label: '业务员' }]}
                          />
                        </div>
                        <div><label className={labelCls}>部门</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={newUser.departmentId}
                            onChange={v => setNewUser({ ...newUser, departmentId: v })}
                            options={[
                              { value: '', label: '未分配' },
                              ...buildDepartmentOptions(userDepartments).map((d: any) => ({ value: d.id, label: d.label })),
                            ]}
                          />
                        </div>
                      </div>
                      <button disabled={actionBusyId !== null} onClick={async () => {
                        if (actionBusyId) return;
                        setActionBusyId('create-user');
                        setLoadError('');
                        try {
                          await postAdmin('users', { ...newUser, id: createAdminGeneratedUserId(newUser.email, newUser.displayName) });
                          setShowNewUser(false);
                          setNewUser(EMPTY_NEW_USER_DRAFT);
                          await loadTab('users');
                          bdsToast.success('用户已创建。');
                        } catch(e: any) {
                          // fail closed：创建失败显示在页面错误区，禁止 alert 弹窗
                          setLoadError(e.message || '创建用户失败');
                        } finally {
                          setActionBusyId(null);
                        }
                      }}
                        className={primaryButtonCls}>{actionBusyId === 'create-user' ? '创建中…' : '创建用户'}</button>
                    </div>
                  )}

                  {editingUser ? (
                    <div className={card + ' p-5 space-y-5'}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className={`text-sm font-light text-[var(--text-primary)]`}>编辑用户</p>
                          <p className={`mt-1 truncate text-[11px] font-light text-[var(--text-tertiary)]`}>
                            {editingUser.displayName} 的账号信息、密码管理与角色权限
                          </p>
                        </div>
                        <button type="button" onClick={cancelUserEdit} className={actionButtonCls}>
                          <X size={14} strokeWidth={1.5} />
                          返回列表
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <label className={labelCls}>用户 ID</label>
                          <div className={`${inputCls} mt-1 flex items-center font-mono`}>{editingUser.id}</div>
                        </div>
                        <div>
                          <label className={labelCls}>姓名</label>
                          <input
                            value={userDraft.displayName}
                            onChange={e => setUserDraft(prev => ({ ...prev, displayName: e.target.value }))}
                            className={inputCls + ' mt-1'}
                            placeholder="用户姓名"
                          />
                        </div>
                        <div>
                          <label className={labelCls}>完整邮箱</label>
                          <input
                            type="email"
                            value={userDraft.email}
                            onChange={e => setUserDraft(prev => ({ ...prev, email: e.target.value }))}
                            className={inputCls + ' mt-1'}
                            placeholder="name@company.com"
                          />
                        </div>
                        <div>
                          <label className={labelCls}>部门</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={userDraft.departmentId}
                            onChange={v => setUserDraft(prev => ({ ...prev, departmentId: v }))}
                            options={[
                              { value: '', label: '未分配' },
                              ...buildDepartmentOptions(userDepartments).map((d: any) => ({ value: d.id, label: d.label })),
                            ]}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>账号状态</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={userDraft.status}
                            onChange={v => setUserDraft(prev => ({ ...prev, status: v }))}
                            options={ADMIN_USER_STATUS_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>最后登录</label>
                          <div className={`${inputCls} mt-1 flex items-center`}>{formatAdminDate(editingUser.lastLoginAt)}</div>
                        </div>
                        <div>
                          <label className={labelCls}>创建时间</label>
                          <div className={`${inputCls} mt-1 flex items-center`}>{formatAdminDate(editingUser.createdAt)}</div>
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <label className={labelCls}>密码</label>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <div className={`${inputCls} flex min-w-56 flex-1 items-center`}>已加密保存，不能查看原密码</div>
                            <button onClick={() => resetPassword(editingUser.id, editingUser.displayName)}
                              disabled={actionBusyId === editingUser.id}
                              className={`${actionButtonCls} disabled:opacity-50`}><KeyRound size={14} />重置密码</button>
                          </div>
                        </div>
                      </div>

                      <div className={`border-t pt-4 border-[var(--border-c-default)]`}>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div>
                            <label className={labelCls}>角色权限</label>
                            <CustomSelect
                              className="mt-1"
                              surface="form"
                              value={userDraft.role}
                              onChange={v => setUserDraft(prev => ({ ...prev, role: v }))}
                              disabled={actionBusyId === editingUser.id}
                              options={assignableRoles.length > 0 ? assignableRoles.map(role => (
                                { value: role.id, label: role.name }
                              )) : (
                                [{ value: userDraft.role, label: userDraft.role }]
                              )}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 mt-4">
                          <button
                            type="button"
                            onClick={cancelUserEdit}
                            disabled={actionBusyId === editingUser.id}
                            className={`${actionButtonCls} disabled:opacity-50`}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => saveUserEdit(editingUser.id)}
                            disabled={actionBusyId === editingUser.id || !userDraft.displayName.trim() || !userDraft.email.trim() || !userDraft.role.trim()}
                            className={brandActionCls}
                          >
                            <Check size={14} />{actionBusyId === editingUser.id ? '保存中' : '保存账号'}
                          </button>
                          <button
                            onClick={() => openHandover(editingUser)}
                            disabled={actionBusyId === editingUser.id}
                            className={brandActionCls}
                          >
                            <ArrowLeftRight size={14} />离职交接
                          </button>
                          <button
                            onClick={() => disableAccount(editingUser.id, editingUser.displayName)}
                            disabled={actionBusyId === editingUser.id}
                            className={actionButtonCls}
                          >
                            停用账号
                          </button>
                          <button
                            onClick={() => erasePersonalData(editingUser.id, editingUser.displayName)}
                            disabled={actionBusyId === editingUser.id}
                            className={quietDangerActionCls}
                          >
                            <Trash2 size={14} />抹除个人数据
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className={card + ` p-4 border-[var(--border-c-default)]`}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <UserPlus size={14} className={brandTextCls} />
                        <h3 className={`text-sm font-light text-[var(--text-primary)]`}>
                          注册申请待审批 ({pendingUsers.length})
                        </h3>
                      </div>
                      {loading && <span className={`text-[10px] text-[var(--text-tertiary)]`}>加载中...</span>}
                    </div>
                    {pendingUsers.length === 0 ? (
                      <p className={`text-xs text-[var(--text-tertiary)]`}>
                        暂无待审批注册申请。新用户通过登录页「申请注册」并完成邮箱验证码后，会出现在这里。
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {pendingUsers.map((u: any) => {
                          const requestedDept = u.metadata?.requestedDepartment || '';
                          const emailVerified = u.metadata?.emailVerified !== false;
                          return (
                            <div key={u.id} className={`flex flex-wrap items-center gap-3 p-3 rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)]`}>
                              <UserAvatar name={u.displayName} email={u.email} avatarUrl={u.avatarUrl} isDarkMode={isDarkMode} sizeClassName="h-8 w-8" textClassName="text-xs" />
                              <div className="flex-1 min-w-0">
                                <div className={`text-sm font-light truncate text-[var(--text-primary)]`}>
                                  {u.displayName}
                                  {emailVerified && <span className={brandChipCls + ' ml-2'}>邮箱已验证</span>}
                                </div>
                                <div className={`text-[11px] truncate text-[var(--text-tertiary)]`}>
                                  {maskAdminEmail(u.email)}
                                  {requestedDept && <><span className="mx-1 opacity-50">·</span>{requestedDept}</>}
                                </div>
                              </div>
                              <CustomSelect
                                size="compact"
                                className="w-36 shrink-0"
                                value={pendingRoles[u.id] || DEFAULT_ASSIGN_ROLE}
                                onChange={v => setPendingRoles(prev => ({ ...prev, [u.id]: v }))}
                                disabled={actionBusyId === u.id}
                                options={assignableRoles.length > 0 ? assignableRoles.map(role => (
                                  { value: role.id, label: role.name }
                                )) : (
                                  [{ value: DEFAULT_ASSIGN_ROLE, label: '业务员' }]
                                )}
                              />
                              <button
                                onClick={() => approvePendingUser(u.id)}
                                disabled={actionBusyId === u.id}
                                className={brandActionCls}
                              >
                                <Check size={14} />{actionBusyId === u.id ? '处理中' : '批准'}
                              </button>
                              <button
                                onClick={() => rejectPendingUser(u.id)}
                                disabled={actionBusyId === u.id}
                                className={dangerActionCls}
                              >
                                <X size={14} />驳回
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-56">
                      <input
                        value={userSearch}
                        onChange={e => setUserSearch(e.target.value)}
                        placeholder="搜索姓名 / 邮箱"
                        aria-label="搜索姓名或邮箱"
                        className={inputCls}
                      />
                    </div>
                    <CustomSelect
                      className="w-32 shrink-0"
                      value={userStatusFilter}
                      onChange={v => setUserStatusFilter(v)}
                      ariaLabel="按状态筛选"
                      options={[
                        { value: 'all', label: '全部状态' },
                        ...ADMIN_USER_STATUS_OPTIONS.filter(o => o.value !== 'pending').map(o => ({ value: o.value, label: o.label })),
                      ]}
                    />
                    {(userKeyword || userStatusFilter !== 'all') && (
                      <span className={`text-[10px] text-[var(--text-tertiary)]`}>
                        匹配 {visibleUsers.length} / {activeUsers.length} 个账号
                      </span>
                    )}
                  </div>

                  <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-inset border ${userCardClass}`}>
                    <table className="w-full shrink-0 table-fixed border-separate border-spacing-0 text-left text-xs">
                      <colgroup>
                        <col className="w-[36%]" />
                        <col className="w-[16%]" />
                        <col className="w-[36%]" />
                        <col className="w-[12%]" />
                      </colgroup>
                      <thead className={`text-[var(--text-tertiary)]`}>
                        <tr>
                          {['用户', '状态', '角色', ''].map(header => (
                            <th key={header} className={`border-b px-4 py-3 text-[10px] font-light tracking-[0.16em] bg-[var(--recessed-bg-strong)] border-[var(--border-c-default)]`}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                    </table>
                    <div ref={userListScrollRef} className={ADMIN_USER_LIST_SCROLL_CLASS}>
                    <table className="w-full table-fixed border-separate border-spacing-0 text-left text-xs">
                      <colgroup>
                        <col className="w-[36%]" />
                        <col className="w-[16%]" />
                        <col className="w-[36%]" />
                        <col className="w-[12%]" />
                      </colgroup>
                      <tbody>
                        {visibleUsers.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center text-[11px] text-[var(--text-tertiary)]">
                              {activeUsers.length === 0 ? '暂无账号' : '无匹配账号，调整搜索或状态筛选'}
                            </td>
                          </tr>
                        )}
                        {visibleUsers.map((u: any, idx: number) => {
                          const roles = Array.isArray(u.roles) ? u.roles : [];
                          const privilegedRole = roles.includes('owner') ? 'owner' : roles.includes('admin') ? 'admin' : null;
                          const userRowBorderClass = idx === visibleUsers.length - 1
                            ? 'border-transparent'
                            : 'border-[var(--border-c-default)]';
                          return (
                            <tr key={u.id} className={`transition-[background,box-shadow,color] duration-200 hover:bg-[var(--hover-darken)]`}>
                              <td className={`border-b px-4 py-3 ${userRowBorderClass}`}>
                                <div className="flex min-w-0 items-center gap-3">
                                  <UserAvatar name={u.displayName} email={u.email} avatarUrl={u.avatarUrl} isDarkMode={isDarkMode} sizeClassName="h-8 w-8" textClassName="text-xs" />
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <div className={`min-w-0 truncate text-sm font-light text-[var(--text-primary)]`}>{u.displayName}</div>
                                    {privilegedRole && (
                                      <Crown
                                        size={14}
                                        strokeWidth={1.5}
                                        className={`${brandTextCls} shrink-0`}
                                        aria-label={privilegedRole === 'owner' ? 'Owner account' : 'Admin account'}
                                      />
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className={`border-b px-4 py-3 ${userRowBorderClass}`}>
                                <span className={u.status === 'rejected' ? dangerChipCls : u.status === 'active' ? brandChipCls : neutralChipCls}>{u.status}</span>
                              </td>
                              <td className={`border-b px-4 py-3 ${userRowBorderClass}`}>
                                <div className="flex min-w-0 flex-wrap gap-1.5">
                                  {roles.length > 0 ? roles.slice(0, 3).map((role: string) => (
                                    <span key={role} className={brandChipCls}>{formatRoleLabel(role)}</span>
                                  )) : (
                                    <span className={neutralChipCls}>无角色</span>
                                  )}
                                  {roles.length > 3 && <span className={`rounded-full px-2 py-0.5 text-[10px] font-light text-[var(--text-tertiary)]`}>+{roles.length - 3}</span>}
                                </div>
                              </td>
                              <td className={`border-b px-4 py-3 text-right ${userRowBorderClass}`}>
                                <button
                                  onClick={() => startUserEdit(u)}
                                  disabled={actionBusyId === u.id}
                                  className={`${actionButtonCls} disabled:opacity-50`}
                                >
                                  <Pencil size={14} />编辑
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                  </>
                  )}
                </div>
                );
              })()}

              {activeTab === 'roles' && (
                <div className="space-y-4">
                  <span className={sectionTitleClass}>
                    {roles.length} 个角色 · {allPermissions.length} 个权限项
                  </span>
                  {roles.map((r: any) => {
                    const isEditingPerms = permEditingRoleId === r.id;
                    const currentPerms = isEditingPerms ? permDraft : (r.permissions || []);
                    return (
                      <div key={r.id} className={card + ' p-4'}>
                        <div className="flex items-center gap-2 mb-2">
                          <Shield size={14} className={brandTextCls} />
                          <span className={sectionTitleClass}>{formatRoleLabel(r.name)}</span>
                          {r.isSystem && <span className={brandChipCls}>系统内置</span>}
                          <span className={`text-[10px] text-[var(--text-tertiary)]`}>{currentPerms.length} 项权限</span>
                          {!isEditingPerms && (
                            <button onClick={() => { setPermEditingRoleId(r.id); setPermDraft([...(r.permissions || [])]); }}
                              className={`${subtleButtonCls} ml-auto`}>
                              编辑权限
                            </button>
                          )}
                        </div>
                        <div className={`text-xs mb-3 text-[var(--text-tertiary)]`}>{r.description || '无描述'}</div>

                        {isEditingPerms ? (
                          <div className={`mt-2 pt-3 border-t border-[var(--border-c-default)]`}>
                            <div className={`text-[10px] mb-2 text-[var(--text-tertiary)]`}>勾选该角色应当拥有的权限</div>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {allPermissions.map((p: any) => {
                                const on = permDraft.includes(p.scope);
                                return (
                                  <button key={p.id} type="button" onClick={() => setPermDraft(prev => on ? prev.filter(s => s !== p.scope) : [...prev, p.scope])}
                                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                                      on
                                        ? 'bg-[var(--os-vnext-brand-blue)]/8 border-[var(--os-vnext-brand-blue)]/20 text-[var(--text-primary)]'
                                        : 'bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                                    }`}>
                                    {on && <Check size={14} className="inline mr-1" />}
                                    {formatPermissionLabel(p.scope)}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={() => setPermEditingRoleId(null)}
                                className={subtleButtonCls}>取消</button>
                              <button type="button" onClick={async () => {
                                setLoadError('');
                                const original = r.permissions || [];
                                const toAdd = permDraft.filter((s: string) => !original.includes(s));
                                const toRemove = original.filter((s: string) => !permDraft.includes(s));
                                if (!toAdd.length && !toRemove.length) { setPermEditingRoleId(null); return; }
                                try {
                                  await postAdmin(`roles/${r.id}/permissions`, { addPermissions: toAdd, removePermissions: toRemove }, 'PATCH');
                                  setPermEditingRoleId(null);
                                  loadTab('roles');
                                  bdsToast.success('角色权限已更新。');
                                } catch (e: any) { setLoadError(e.message || '更新权限失败'); }
                              }} className={brandActionCls}>
                                <Check size={14} />保存权限
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {(r.permissions || []).length === 0 && <span className={`text-[10px] text-[var(--text-tertiary)]`}>暂无权限</span>}
                            {(r.permissions || []).map((p: string) => (
                              <span key={p} className={`text-[10px] px-2 py-0.5 rounded-full bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>{formatPermissionLabel(p)}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {activeTab === 'approvals' && (
                <div className="space-y-6">
                  <div>
                    <h3 className={`${sectionTitleClass} mb-3`}>待审批 ({approvals.length})</h3>
                    {approvals.length === 0 && <p className={sectionMutedClass}>暂无待审批项</p>}
                    {approvals.map((a: any) => (
                      <div key={a.id} className={`${inlinePanelClass} p-3 mb-2`}>
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <span className={sectionMutedClass}>{a.actionType}</span>
                            <span className={`text-[10px] ml-2 text-[var(--text-tertiary)]`}>{a.risk} risk</span>
                            {/* PRD 8.6 双轨偏差业务审批上下文（报价单号 + 轨道 A/B + 偏差） */}
                            {a.actionType === 'quotation:price-deviation' && a.payload && (
                              <div className={`mt-1 text-[11px] text-[var(--text-tertiary)]`}>
                                报价单 {a.payload.quotationNumber || a.targetId}
                                {' · '}轨道 A 中位 ${Number(a.payload.trackAMedianUsd ?? 0).toFixed(4)}/{a.payload.trackAUnit === 'PC' ? '件' : '米'}
                                {' · '}轨道 B 终价 ${Number(a.payload.trackBFinalUsd ?? 0).toFixed(4)}
                                {' · '}偏差 {(a.payload.deviationPercent ?? 0) > 0 ? '+' : ''}{a.payload.deviationPercent}%
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button disabled={actionBusyId !== null} onClick={() => decideApproval(a.id, 'approved')}
                              className={brandActionCls}>{actionBusyId === `approval:${a.id}` ? '提交中…' : '批准'}</button>
                            <button disabled={actionBusyId !== null} onClick={() => decideApproval(a.id, 'rejected')}
                              className={dangerActionCls}>{actionBusyId === `approval:${a.id}` ? '提交中…' : '驳回'}</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3 className={`${sectionTitleClass} mb-3`}>学习建议 ({suggestions.length})</h3>
                    {suggestions.map((s: any) => (
                      <div key={s.id} className={`${inlinePanelClass} p-3 mb-2`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className={sectionMutedClass}>{s.suggestionType}</span>
                            <span className={`text-[10px] ml-2 text-[var(--text-tertiary)]`}>confidence: {s.confidence}</span>
                          </div>
                          <div className="flex gap-1">
                            <button disabled={actionBusyId !== null} onClick={() => decideSuggestion(s.id, 'accepted')}
                              className={brandActionCls}>{actionBusyId === `suggestion:${s.id}` ? '提交中…' : '接受'}</button>
                            <button disabled={actionBusyId !== null} onClick={() => decideSuggestion(s.id, 'rejected')}
                              className={dangerActionCls}>{actionBusyId === `suggestion:${s.id}` ? '提交中…' : '驳回'}</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'workflow' && (
                <WorkflowPanel isDarkMode={isDarkMode} />
              )}

              {activeTab === 'company-profile' && (
                <CompanyProfileSection />
              )}

              {activeTab === 'platform-rules' && (
                <PlatformRulesSection />
              )}

              {activeTab === 'data-migration' && (
                <DataMigrationPanel />
              )}

              {activeTab === 'audit-logs' && (
                <div className="space-y-2">
                  {/* task_mr1ncdp9: audit query filter UI（中文 label + 时间用 datetime-local，前端转 epoch ms） */}
                  <div className={`flex flex-wrap items-end gap-2 p-2 text-xs ${inlineRowClass}`}>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)]">对象类型</span>
                      <input value={auditFilter.targetType} onChange={(e) => setAuditFilter(s => ({ ...s, targetType: e.target.value }))}
                        placeholder="如 Order" className={`w-24 rounded-field border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)]">对象 ID</span>
                      <input value={auditFilter.targetId} onChange={(e) => setAuditFilter(s => ({ ...s, targetId: e.target.value }))}
                        placeholder="精确 ID" className={`w-28 rounded-field border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)]">动作</span>
                      <input value={auditFilter.action} onChange={(e) => setAuditFilter(s => ({ ...s, action: e.target.value }))}
                        placeholder="如 order.update" className={`w-28 rounded-field border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)]">操作人 ID</span>
                      <input value={auditFilter.actorId} onChange={(e) => setAuditFilter(s => ({ ...s, actorId: e.target.value }))}
                        placeholder="用户 ID" className={`w-24 rounded-field border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)]">起始时间</span>
                      <input type="datetime-local" value={auditFilter.createdFrom} onChange={(e) => setAuditFilter(s => ({ ...s, createdFrom: e.target.value }))}
                        className={`rounded-field border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--text-tertiary)]">结束时间</span>
                      <input type="datetime-local" value={auditFilter.createdTo} onChange={(e) => setAuditFilter(s => ({ ...s, createdTo: e.target.value }))}
                        className={`rounded-field border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    </label>
                    <button onClick={() => { setAuditFilter({ targetType: '', targetId: '', action: '', actorId: '', createdFrom: '', createdTo: '' }); setAuditFilterError(''); fetchAuditLogs({ targetType: '', targetId: '', action: '', actorId: '', createdFrom: '', createdTo: '' }); }}
                      className={`rounded-control border px-2 py-0.5 border-[var(--border-c-strong)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}>清空</button>
                    <button onClick={() => fetchAuditLogs()}
                      className={`rounded-control border px-2 py-0.5 border-[var(--border-c-strong)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]`}>刷新</button>
                  </div>
                  {auditFilterError && <div className="text-xs text-[var(--text-tertiary)]">{auditFilterError}</div>}
                  {/* R3：共 N 条 + 翻页（后端返回 total；翻页保持当前筛选） */}
                  <div className="flex items-center gap-2">
                    <span className={sectionTitleClass}>共 {auditTotal} 条日志</span>
                    {auditTotal > AUDIT_PAGE_SIZE && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <button
                          disabled={auditOffset === 0}
                          onClick={() => fetchAuditLogs(undefined, Math.max(0, auditOffset - AUDIT_PAGE_SIZE))}
                          className={`rounded-control border px-2 py-0.5 border-[var(--border-c-strong)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)] disabled:opacity-40`}
                        >上一页</button>
                        <span className="text-[var(--text-tertiary)]">第 {Math.floor(auditOffset / AUDIT_PAGE_SIZE) + 1} / {Math.ceil(auditTotal / AUDIT_PAGE_SIZE)} 页</span>
                        <button
                          disabled={auditOffset + AUDIT_PAGE_SIZE >= auditTotal}
                          onClick={() => fetchAuditLogs(undefined, auditOffset + AUDIT_PAGE_SIZE)}
                          className={`rounded-control border px-2 py-0.5 border-[var(--border-c-strong)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)] disabled:opacity-40`}
                        >下一页</button>
                      </div>
                    )}
                  </div>
                  {auditLogs.map((l: any) => (
                    <div key={l.id} className={`flex items-center gap-3 p-2 text-xs ${inlineRowClass}`}>
                      <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{new Date(l.createdAt).toLocaleString()}</span>
                      <span className={`font-light text-[var(--text-primary)]`}>{l.action}</span>
                      <span className="text-[var(--text-tertiary)]">{l.actorId}</span>
                      {l.targetType && <span className="text-[var(--text-secondary)]">{l.targetType}:{l.targetId}</span>}
                      {l.ip && <span className="text-[var(--text-secondary)] ml-auto">{l.ip}</span>}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'knowledge-acl' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className={sectionTitleClass}>
                      文档访问控制 ({knowledgeAcls.length} 条规则)
                    </span>
                    <button onClick={() => { setAclForm({ documentId: '', roleId: '', departmentId: '', scope: 'company', access: 'read' }); setEditingAclId(null); setShowAclForm(!showAclForm); }}
                      className={subtleButtonCls}>
                      {showAclForm ? '取消' : '新增规则'}
                    </button>
                  </div>

                  <p className={sectionMutedClass}>
                    控制不同角色和部门对企业文档的访问级别。每条规则指定一个文档、一个角色或部门、访问范围和权限级别。
                  </p>

                  {showAclForm && (
                    <div className={card + ' p-5 space-y-3'}>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>文档</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={aclForm.documentId}
                            onChange={v => setAclForm({ ...aclForm, documentId: v })}
                            options={[
                              { value: '', label: '选择文档...' },
                              ...kbDocuments.map((d: any) => ({ value: d.id, label: d.title })),
                            ]}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>访问范围</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={aclForm.scope}
                            onChange={v => setAclForm({ ...aclForm, scope: v })}
                            options={KNOWLEDGE_SCOPES.map(s => ({ value: s, label: s }))}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>角色（可选）</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={aclForm.roleId}
                            onChange={v => setAclForm({ ...aclForm, roleId: v })}
                            options={[
                              { value: '', label: '不限角色' },
                              ...kbRoles.map((r: any) => ({ value: r.id, label: formatRoleLabel(r.name) })),
                            ]}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>部门（可选）</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={aclForm.departmentId}
                            onChange={v => setAclForm({ ...aclForm, departmentId: v })}
                            options={[
                              { value: '', label: '不限部门' },
                              ...buildDepartmentOptions(kbDepartments).map((d: any) => ({ value: d.id, label: d.label })),
                            ]}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>权限级别</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={aclForm.access}
                            onChange={v => setAclForm({ ...aclForm, access: v })}
                            options={ACCESS_LEVELS.map(a => ({ value: a, label: formatAccessLabel(a) }))}
                          />
                        </div>
                      </div>
                      <button disabled={actionBusyId !== null} onClick={async () => {
                        if (actionBusyId) return;
                        setActionBusyId('acl-save');
                        setLoadError('');
                        try {
                          if (editingAclId) {
                            await postAdmin(`knowledge-acl/${editingAclId}`, { roleId: aclForm.roleId || null, departmentId: aclForm.departmentId || null, scope: aclForm.scope, access: aclForm.access }, 'PATCH');
                          } else {
                            await postAdmin('knowledge-acl', aclForm);
                          }
                          setShowAclForm(false);
                          setEditingAclId(null);
                          await loadTab('knowledge-acl');
                          bdsToast.success('访问规则已保存。');
                        } catch (e: any) { setLoadError(e.message || '保存失败'); }
                        finally { setActionBusyId(null); }
                      }} className={primaryButtonCls}>
                        {actionBusyId === 'acl-save' ? '提交中…' : editingAclId ? '更新规则' : '创建规则'}
                      </button>
                    </div>
                  )}

                  {knowledgeAcls.length === 0 ? (
                    <p className={sectionMutedClass}>
                      暂无访问控制规则。所有已认证用户默认可访问 scope=company 的文档。
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {knowledgeAcls.map((acl: any) => (
                        <div key={acl.id} className={`${inlinePanelClass} p-3`}>
                          <div className="flex items-center gap-3">
                            <BookOpen size={14} className={`${brandTextCls} shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-light truncate text-[var(--text-primary)]`}>
                                {acl.documentTitle || acl.documentId}
                              </div>
                              <div className={`text-[11px] text-[var(--text-tertiary)]`}>
                                {acl.roleName && <span className="mr-2">角色: {formatRoleLabel(acl.roleName)}</span>}
                                {acl.departmentName && <span className="mr-2">部门: {acl.departmentName}</span>}
                                {!acl.roleName && !acl.departmentName && <span className="mr-2">适用所有</span>}
                                <span>范围: {acl.scope}</span>
                              </div>
                            </div>
                            <span className={acl.access === 'admin' ? dangerChipCls : acl.access === 'none' ? neutralChipCls : brandChipCls}>{formatAccessLabel(acl.access)}</span>
                            <button onClick={() => {
                              setAclForm({
                                documentId: acl.documentId, roleId: acl.roleId || '', departmentId: acl.departmentId || '',
                                scope: acl.scope, access: acl.access,
                              });
                              setEditingAclId(acl.id);
                              setShowAclForm(true);
                            }} className={subtleButtonCls}>编辑</button>
                            <button disabled={actionBusyId !== null} onClick={async () => {
                              if (actionBusyId) return;
                              if (!(await bdsConfirm({ title: '确认删除', body: '确认删除此访问控制规则？', danger: true }))) return;
                              setActionBusyId(`acl:${acl.id}`);
                              try { await postAdmin(`knowledge-acl/${acl.id}`, {}, 'DELETE'); await loadTab('knowledge-acl'); bdsToast.success('访问规则已删除。'); } catch (e: any) { setLoadError(e.message); }
                              finally { setActionBusyId(null); }
                            }} className={quietDangerActionCls}>删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'tool-perms' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className={sectionTitleClass}>
                      工具权限配置 ({tools.length} 个工具)
                    </span>
                    <button onClick={() => { setToolPermForm({ toolId: '', roleId: '', access: 'execute', riskMode: 'direct' }); setShowToolPermForm(!showToolPermForm); }}
                      className={subtleButtonCls}>
                      {showToolPermForm ? '取消' : '新增授权'}
                    </button>
                  </div>

                  <p className={sectionMutedClass}>
                    配置每个工具的角色授权和审批策略。高风险工具可设置为需审批模式。
                  </p>

                  {showToolPermForm && (
                    <div className={card + ' p-5 space-y-3'}>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>工具</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={toolPermForm.toolId}
                            onChange={v => setToolPermForm({ ...toolPermForm, toolId: v })}
                            options={[
                              { value: '', label: '选择工具...' },
                              ...tools.map((t: any) => ({ value: t.id, label: `${t.name} (${t.scope})` })),
                            ]}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>角色</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={toolPermForm.roleId}
                            onChange={v => setToolPermForm({ ...toolPermForm, roleId: v })}
                            options={[
                              { value: '', label: '选择角色...' },
                              ...toolRoles.map((r: any) => ({ value: r.id, label: formatRoleLabel(r.name) })),
                            ]}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>访问级别</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={toolPermForm.access}
                            onChange={v => setToolPermForm({ ...toolPermForm, access: v })}
                            options={TOOL_ACCESS_LEVELS.map(a => ({ value: a, label: formatAccessLabel(a) }))}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>风险模式</label>
                          <CustomSelect
                            className="mt-1"
                            surface="form"
                            value={toolPermForm.riskMode}
                            onChange={v => setToolPermForm({ ...toolPermForm, riskMode: v })}
                            options={RISK_MODES.map(m => ({ value: m, label: formatRiskModeLabel(m) }))}
                          />
                        </div>
                      </div>
                      <button disabled={actionBusyId !== null} onClick={async () => {
                        if (!toolPermForm.toolId || !toolPermForm.roleId) { setLoadError('请选择工具和角色'); return; }
                        if (actionBusyId) return;
                        setActionBusyId('toolperm-create');
                        setLoadError('');
                        try {
                          await postAdmin('tool-permissions', toolPermForm);
                          setShowToolPermForm(false);
                          await loadTab('tool-perms');
                          bdsToast.success('工具授权已保存。');
                        } catch (e: any) { setLoadError(e.message || '保存失败'); }
                        finally { setActionBusyId(null); }
                      }} className={primaryButtonCls}>{actionBusyId === 'toolperm-create' ? '提交中…' : '创建授权'}</button>
                    </div>
                  )}

                  {tools.length === 0 ? (
                    <p className={sectionMutedClass}>
                      暂无已注册工具。工具会在 Agent 运行时自动注册。
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {tools.map((t: any) => (
                        <div key={t.id} className={card + ' p-4'}>
                          <div className="flex items-center gap-2 mb-2">
                            <Wrench size={14} className={brandTextCls} />
                            <span className={sectionTitleClass}>{t.name}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>{t.scope}</span>
                            <span className={t.risk === 'high' ? dangerChipCls : t.risk === 'medium' ? neutralChipCls : brandChipCls}>{t.risk} risk</span>
                            {t.description && <span className={`text-[10px] text-[var(--text-tertiary)]`}>{t.description}</span>}
                          </div>
                          {t.permissions.length === 0 ? (
                            <p className={`text-[10px] text-[var(--text-tertiary)]`}>暂无角色授权</p>
                          ) : (
                            <div className="space-y-1.5">
                              {t.permissions.map((p: any) => (
                                <div key={p.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${inlineRowClass}`}>
                                  <span className={`font-light text-[var(--text-primary)]`}>{formatRoleLabel(p.roleName)}</span>
                                  <span className={p.access === 'admin' ? dangerChipCls : p.access === 'none' ? neutralChipCls : brandChipCls}>{formatAccessLabel(p.access)}</span>
                                  <span className={p.riskMode === 'disabled' ? dangerChipCls : p.riskMode === 'approval' ? neutralChipCls : brandChipCls}>{formatRiskModeLabel(p.riskMode)}</span>
                                  <button disabled={actionBusyId !== null} onClick={async () => {
                                    if (actionBusyId) return;
                                    // R5：移除授权前确认（对齐本文件 knowledge-acl 删除确认模式）
                                    if (!(await bdsConfirm({ title: '确认移除授权', body: `确认移除「${formatRoleLabel(p.roleName)}」对工具 ${t.name} 的授权？移除后该角色将无法再调用此工具。`, danger: true }))) return;
                                    setActionBusyId(`toolperm:${p.id}`);
                                    try { await postAdmin(`tool-permissions/${p.id}`, {}, 'DELETE'); await loadTab('tool-perms'); bdsToast.success('工具授权已移除。'); } catch (e: any) { setLoadError(e.message); }
                                    finally { setActionBusyId(null); }
                                  }} className={`${quietDangerActionCls} ml-auto h-8 px-2`}>移除</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              </motion.div>
            </AnimatePresence>
          </div>
        </SidePanelContainer>
      </div>

      {/* REQ2-13 离职一键交接 BottomSheet（DR-056：预览→确认→执行 + 交接单留痕） */}
      {handoverTarget && (
        <BottomSheet
          isOpen={!!handoverTarget}
          onClose={closeHandoverSheet}
          title="离职一键交接"
          isDarkMode={isDarkMode}
        >
          <div className="space-y-4 px-6 py-5">
            {/* 离职者档案头 */}
            <div className={`flex items-center gap-3 p-3 rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)]`}>
              <UserAvatar
                name={handoverTarget.displayName}
                email={handoverTarget.email}
                avatarUrl={handoverTarget.avatarUrl}
                isDarkMode={isDarkMode}
                sizeClassName="h-9 w-9"
                textClassName="text-xs"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-light truncate text-[var(--text-primary)]">{handoverTarget.displayName}</div>
                <div className="text-[11px] truncate text-[var(--text-tertiary)]">{maskAdminEmail(handoverTarget.email)}</div>
              </div>
              <span className={handoverTarget.status === 'active' ? brandChipCls : neutralChipCls}>{handoverTarget.status}</span>
            </div>

            {handoverResult ? (
              <>
                {/* 执行结果视图（交接单摘要） */}
                <div className="bds-alert success">
                  交接完成（单号 {handoverResult.handoverId}）：{handoverResult.counts.relationsOwned} 个档主客户、
                  {handoverResult.counts.relationsCoFollowed} 个协同客户、{handoverResult.counts.opportunities} 个商机、
                  {handoverResult.counts.followUpRecords} 条跟进记录、{handoverResult.counts.unanchoredOrders} 个无锚订单已全部移交；
                  {handoverResult.accountDisabled ? '离职者账号已停用，未过期登录凭证同步失效。' : '离职者账号保持原状态。'}
                </div>
                <div className="flex justify-end pt-1">
                  <button type="button" onClick={closeHandoverSheet} className={brandActionCls}>关闭</button>
                </div>
              </>
            ) : (
              <>
                {/* 资产预览计数 */}
                <div>
                  <div className={`mb-2 text-[10px] tracking-[0.14em] ${BAMBOOK_OS.tone.text.formLabel}`}>待移交资产</div>
                  {handoverPreviewLoading && !handoverPreview ? (
                    <div className={sectionMutedClass}>加载中...</div>
                  ) : handoverPreview ? (
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { label: '档主客户', value: handoverPreview.counts.relationsOwned },
                        { label: '协同客户', value: handoverPreview.counts.relationsCoFollowed },
                        { label: '商机', value: handoverPreview.counts.opportunities },
                        { label: '跟进记录', value: handoverPreview.counts.followUpRecords },
                        { label: '无锚订单', value: handoverPreview.counts.unanchoredOrders },
                      ].map(cell => (
                        <div key={cell.label} className={`px-2 py-2.5 text-center ${inlineRowClass}`}>
                          <div className="text-base font-light text-[var(--text-primary)]">{cell.value}</div>
                          <div className="text-[10px] font-light text-[var(--text-tertiary)]">{cell.label}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className={`mt-2 text-[10px] font-light leading-relaxed text-[var(--text-tertiary)]`}>
                    有客户锚的订单与邮件历史随客户归属自动继承（T-38），无需单独移交；档案与归属改写全程审计留痕。
                  </div>
                </div>

                {handoverPreview?.warnings?.length ? (
                  <div className="bds-alert warning">
                    {handoverPreview.warnings.map((w, i) => <div key={i}>{w}</div>)}
                  </div>
                ) : null}

                {/* 接收人选择 */}
                <div>
                  <label className={`mb-1.5 block text-[10px] tracking-[0.14em] ${BAMBOOK_OS.tone.text.formLabel}`}>接收人 *</label>
                  <CustomSelect
                    surface="form"
                    value={handoverSuccessorId}
                    onChange={v => {
                      setHandoverSuccessorId(v);
                      if (v) refreshHandoverPreview(handoverTarget.id, v);
                    }}
                    disabled={handoverExecuting}
                    options={[
                      { value: '', label: '选择接收全部资产的在职账号' },
                      ...handoverSuccessorOptions.map((u: any) => ({
                        value: u.id,
                        label: `${u.displayName}${u.email ? ` · ${u.email}` : ''}`,
                      })),
                    ]}
                  />
                </div>

                {/* 停用开关 + 备注 */}
                <div className={`flex items-center justify-between gap-3 p-3 ${inlineRowClass}`}>
                  <div className="min-w-0">
                    <div className="text-xs font-light text-[var(--text-primary)]">交接后停用离职者账号</div>
                    <div className="text-[10px] font-light text-[var(--text-tertiary)]">停用后立即无法登录，未过期登录凭证同步失效</div>
                  </div>
                  <ToggleSwitch
                    checked={handoverDisable}
                    onChange={setHandoverDisable}
                    disabled={handoverExecuting}
                    ariaLabel="交接后停用账号"
                  />
                </div>
                <div>
                  <label className={`mb-1.5 block text-[10px] tracking-[0.14em] ${BAMBOOK_OS.tone.text.formLabel}`}>交接备注</label>
                  <input
                    value={handoverNote}
                    onChange={e => setHandoverNote(e.target.value)}
                    disabled={handoverExecuting}
                    placeholder="离职原因 / 客户沟通口径等（随交接单留痕）"
                    className="bds-input sm w-full"
                  />
                </div>

                {handoverError && <div className="bds-alert danger">{handoverError}</div>}

                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" disabled={handoverExecuting} onClick={closeHandoverSheet} className={actionButtonCls}>取消</button>
                  <button
                    type="button"
                    disabled={handoverExecuting || !handoverSuccessorId || handoverPreviewLoading}
                    onClick={executeHandover}
                    className={brandActionCls}
                  >
                    <ArrowLeftRight size={14} />{handoverExecuting ? '执行中...' : '执行交接'}
                  </button>
                </div>
              </>
            )}

            {/* 交接单历史（append-only 留痕） */}
            {handoverRecords.length > 0 && (
              <div className="pt-2">
                <div className={`mb-2 text-[10px] tracking-[0.14em] ${BAMBOOK_OS.tone.text.formLabel}`}>最近交接记录</div>
                <div className="space-y-1.5">
                  {handoverRecords.map((r: any) => (
                    <div key={r.id} className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-[11px] font-light ${inlineRowClass}`}>
                      <span className="text-[var(--text-primary)]">{r.fromUserName}</span>
                      <ArrowLeftRight size={14} className="text-[var(--text-tertiary)]" />
                      <span className="text-[var(--text-primary)]">{r.toUserName}</span>
                      <span className={neutralChipCls}>{r.disableAccount ? '已停用' : '未停用'}</span>
                      <span className="text-[var(--text-tertiary)]">
                        {r.detail?.relationsOwned ?? 0} 客户 · {r.detail?.opportunities ?? 0} 商机 · {r.detail?.followUpRecords ?? 0} 跟进
                      </span>
                      <span className="ml-auto text-[var(--text-tertiary)]">
                        {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
};

export default AdminPanel;
