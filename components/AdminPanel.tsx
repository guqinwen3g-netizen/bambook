import React, { useState, useEffect, useRef } from 'react';
import { hasRole } from '../services/authService';
import { getApiBaseUrl } from '../services/apiBase';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Shield, BookOpen, Wrench, CheckSquare, ScrollText, UserPlus, Check, X, Trash2, Pencil, Fingerprint, Mail, KeyRound, Clock3, Building2, BadgeCheck, Crown, Workflow } from 'lucide-react';
import { WorkflowPanel } from './WorkflowPanel';
import ScrollEdgeFades from './ui/ScrollEdgeFades';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { PageHeader } from './ui/PageHeader';
import UserAvatar from './ui/UserAvatar';
import SidePanelContainer from './ui/SidePanelContainer';

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
  role: 'viewer',
};

const KNOWLEDGE_SCOPES = ['company', 'department', 'team', 'private'] as const;
const ACCESS_LEVELS = ['read', 'write', 'admin', 'none'] as const;
const TOOL_ACCESS_LEVELS = ['execute', 'read', 'admin', 'none'] as const;
const RISK_MODES = ['direct', 'approval', 'disabled'] as const;

const formatRoleLabel = (role: string) => ROLE_LABELS[role as typeof AVAILABLE_ROLES[number]] || role;
const formatPermissionLabel = (scope: string) => PERMISSION_LABELS[scope] || scope;
const formatAccessLabel = (access: string) => ACCESS_LABELS[access] || access;
const formatRiskModeLabel = (mode: string) => RISK_MODE_LABELS[mode] || mode;

type TabId = 'users' | 'roles' | 'knowledge-acl' | 'tool-perms' | 'approvals' | 'workflow' | 'audit-logs';
type AdminTabCache = Partial<Record<TabId, any>>;

const ADMIN_PANEL_SESSION_CACHE_KEY = 'bambook_admin_panel_session_cache_v1';

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'roles', label: '角色与权限', icon: Shield },
  { id: 'knowledge-acl', label: '知识库权限', icon: BookOpen },
  { id: 'tool-perms', label: '工具权限', icon: Wrench },
  { id: 'approvals', label: '学习与审批', icon: CheckSquare },
  { id: 'workflow', label: '工作流审批', icon: Workflow },
  { id: 'audit-logs', label: '系统日志', icon: ScrollText },
];

export const ADMIN_PANEL_BODY_CLASS = `${BAMBOOK_OS.layout.desktopPanelRowClass} ${BAMBOOK_OS.layout.desktopPageCanvasClass}`;
export const ADMIN_PANEL_SURFACE_CLASS = 'h-full min-h-0 overflow-hidden';
export const ADMIN_PANEL_SCROLL_CLASS = 'h-full min-h-0 overflow-y-auto custom-scrollbar';
export const ADMIN_USER_LIST_SCROLL_CLASS = 'min-h-0 flex-1 overflow-y-auto custom-scrollbar';
export const ADMIN_PANEL_GLASS_CLASS = `${BAMBOOK_OS.material.glassColor} ${BAMBOOK_OS.material.panelSurface} border-transparent bg-[var(--recessed-bg)] shadow-none`;
export const ADMIN_USER_CARD_CLASS = `${BAMBOOK_OS.material.glassColor} ${BAMBOOK_OS.material.panelSurface} border-[var(--border-c-strong)] dark:border-[var(--border-c-default)] bg-[var(--recessed-bg)]`;
export const ADMIN_USER_FIELD_CLASS = BAMBOOK_OS.controls.recessedField.base;
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
  const [activeTab, setActiveTab] = useState<TabId>('users');
  const [users, setUsers] = useState<any[]>(() => readAdminPanelCache().users?.users || []);
  const [approvals, setApprovals] = useState<any[]>(() => readAdminPanelCache().approvals?.approvals || []);
  const [suggestions, setSuggestions] = useState<any[]>(() => readAdminPanelCache().approvals?.suggestions || []);
  const [auditLogs, setAuditLogs] = useState<any[]>(() => readAdminPanelCache()['audit-logs']?.logs || []);
  // task_mr1ncdp9: audit query filter state（只发非空字段到 query string）
  const [auditFilter, setAuditFilter] = useState({ targetType: '', targetId: '', action: '', actorId: '', createdFrom: '', createdTo: '' });
  const [auditFilterError, setAuditFilterError] = useState('');
  const [roles, setRoles] = useState<any[]>(() => readAdminPanelCache().roles?.roles || []);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({});
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState(EMPTY_USER_EDIT_DRAFT);

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
  const [newUser, setNewUser] = useState({ displayName: '', email: '', password: '', roles: 'viewer' as string, departmentId: '' });

  const adminGlassClass = ADMIN_PANEL_GLASS_CLASS;
  const userCardClass = ADMIN_USER_CARD_CLASS;
  const card = `rounded-inset border transition-[background,border-color,box-shadow] duration-300 ${userCardClass}`;
  const labelCls = `text-[10px] font-light tracking-wide ${BAMBOOK_OS.tone.text.formLabel}`;
  const inputCls = `w-full h-9 px-3 rounded-control border outline-none text-xs font-light transition-[background,border-color,box-shadow,transform] duration-200 ${ADMIN_USER_FIELD_CLASS}`;
  const actionButtonCls = `h-9 px-3 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-[background,color,box-shadow,transform,border-color] duration-200 ${BAMBOOK_OS.controls.actionControl.bordered}`;
  const primaryButtonCls = `h-9 px-4 rounded-control border inline-flex items-center justify-center gap-1.5 text-[11px] font-light tracking-wide transition-[background,color,box-shadow,transform,border-color] duration-200 ${BAMBOOK_OS.controls.stateControl.base} ${BAMBOOK_OS.controls.stateControl.interaction}`;
  const brandTextCls = BAMBOOK_OS.tone.text.brandEmphasis;
  const neutralChipCls = `rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]`;
  const brandChipCls = `rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--os-vnext-brand-blue)]/8 dark:bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue-strong)] dark:text-[var(--os-vnext-brand-blue-soft)]`;
  const dangerChipCls = `rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]`;
  const brandActionCls = `h-9 px-3 rounded-control text-[11px] font-light inline-flex items-center gap-1 transition-colors disabled:opacity-50 bg-[var(--os-vnext-brand-blue)]/8 dark:bg-[var(--os-vnext-brand-blue)]/10 text-[var(--os-vnext-brand-blue-strong)] dark:text-[var(--os-vnext-brand-blue-soft)] hover:bg-[var(--os-vnext-brand-blue)]/12 dark:hover:bg-[var(--os-vnext-brand-blue)]/14`;
  const dangerActionCls = `h-9 px-3 rounded-control text-[11px] font-light inline-flex items-center gap-1 transition-colors disabled:opacity-50 bg-[var(--recessed-bg)] text-[var(--text-secondary)] hover:bg-[var(--active-darken)]`;
  const quietDangerActionCls = `h-9 px-3 rounded-control border text-[11px] font-light transition-colors disabled:opacity-50 inline-flex items-center gap-1 border-[var(--border-c-strong)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]`;
  const adminTitleClass = `${BAMBOOK_OS.layout.desktopTitleTextClass} text-os-adaptive-title`;
  const adminPanelEyebrowClass = `text-[10px] font-light uppercase ${BAMBOOK_OS.typography.tracking.overline} text-[var(--text-tertiary)]`;
  const sectionTitleClass = `text-sm font-light text-[var(--text-primary)]`;
  const sectionMutedClass = `text-xs font-light text-[var(--text-tertiary)]`;
  const inlinePanelClass = 'rounded-control border border-[var(--border-c-default)] bg-[var(--recessed-bg)]';
  const inlineRowClass = `rounded-compact bg-[var(--recessed-bg)]`;
  const subtleButtonCls = `h-8 px-2.5 rounded-field border inline-flex items-center justify-center gap-1 text-[10px] font-light transition-colors border-[var(--border-c-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-darken)]`;
  const navItemBaseClass = `flex items-center gap-2.5 px-3 h-9 rounded-full text-[11px] font-light tracking-wide transition-all duration-200`;
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

  // task_mr1ncdp9: audit-logs 带筛选 query string（只发非空字段，消费后端 contract）
  const fetchAuditLogs = async (filter?: typeof auditFilter) => {
    const f = filter || auditFilter;
    const params = new URLSearchParams();
    if (f.targetType.trim()) params.set('targetType', f.targetType.trim());
    if (f.targetId.trim()) params.set('targetId', f.targetId.trim());
    if (f.action.trim()) params.set('action', f.action.trim());
    if (f.actorId.trim()) params.set('actorId', f.actorId.trim());
    // invalid date 不前端伪造成功，交给后端 fail closed
    if (f.createdFrom.trim()) params.set('createdFrom', f.createdFrom.trim());
    if (f.createdTo.trim()) params.set('createdTo', f.createdTo.trim());
    const qs = params.toString();
    try {
      const d = await fetchAdmin(qs ? `audit-logs?${qs}` : 'audit-logs');
      setAuditLogs(d.logs || []);
      setAuditFilterError('');
      // 只有无筛选时才缓存，避免筛选结果污染默认缓存
      if (!qs) writeAdminPanelCache('audit-logs', d);
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

  const applyAdminTabPayload = (tab: TabId, data: any) => {
    if (tab === 'users') setUsers(data.users || []);
    if (tab === 'roles') {
      setRoles(data.roles || []);
      if (data.permissions) setAllPermissions(data.permissions || []);
    }
    if (tab === 'approvals') {
      setApprovals(data.approvals || []);
      setSuggestions(data.suggestions || []);
    }
    if (tab === 'audit-logs') setAuditLogs(data.logs || []);
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
    const role = (pendingRoles[userId] || 'viewer').trim() || 'viewer';
    setActionBusyId(userId);
    setLoadError('');
    try {
      const data = await postAdmin(`users/${userId}/approve`, { roles: [role] });
      await loadTab('users');
      if (data?.emailStatus === 'failed') {
        setLoadError(`已批准，但通知邮件发送失败：${data.emailError || '未知错误'}`);
      } else if (data?.emailStatus === 'skipped') {
        setLoadError('已批准。该用户未填写邮箱，未发送通知邮件。');
      }
    } catch (e: any) {
      setLoadError(e.message || '批准失败');
    } finally {
      setActionBusyId(null);
    }
  };

  const rejectPendingUser = async (userId: string) => {
    if (!window.confirm('确认驳回该注册申请？')) return;
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}/reject`, { reason: '' });
      await loadTab('users');
    } catch (e: any) {
      setLoadError(e.message || '驳回失败');
    } finally {
      setActionBusyId(null);
    }
  };

  const disableAccount = async (userId: string, displayName: string) => {
    if (!window.confirm(`确认停用账号「${displayName || userId}」？该账号将无法登录，但用户档案、角色和业务历史会保留。`)) return;
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}/disable-account`, {});
      await loadTab('users');
    } catch (e: any) {
      setLoadError(e.message || '停用账号失败');
    } finally {
      setActionBusyId(null);
    }
  };

  const startUserEdit = (u: any) => {
    const primaryRole = Array.isArray(u.roles) && u.roles[0] ? u.roles[0] : 'viewer';
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
    } catch (e: any) {
      setLoadError(e.message || '保存用户失败');
    } finally {
      setActionBusyId(null);
    }
  };

  const erasePersonalData = async (userId: string, displayName: string) => {
    if (!window.confirm(`确认抹除「${displayName || userId}」的个人数据？这会删除个人会话、消息、记忆和工具运行记录，并匿名化账号；业务数据不会删除。`)) return;
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}/erase-personal-data`, {});
      await loadTab('users');
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
    if (!window.confirm(`确认为「${displayName || userId}」重置密码？系统将生成随机临时密码，仅展示一次。`)) return;
    const newPassword = generateTempPassword();
    setActionBusyId(userId);
    setLoadError('');
    try {
      await postAdmin(`users/${userId}/reset-password`, { newPassword });
      // 一次性展示：新密码仅在此刻可见，不落盘、不回显在页面状态中
      alert(`密码已重置。请立即复制并安全传达给用户（仅展示一次）：\n\n${newPassword}`);
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

      <div className="flex-1 min-h-0 flex gap-3 px-5 pb-5 pt-1 overflow-hidden">
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
          {activeTab !== 'users' && (
            <ScrollEdgeFades scrollRef={mainScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} />
          )}
          <div
            ref={activeTab === 'users' ? undefined : mainScrollRef}
            className={`${activeTab === 'users' ? 'h-full min-h-0 overflow-hidden' : ADMIN_PANEL_SCROLL_CLASS} px-5 py-4`}
          >
            {loadError && (
              <div className={`mb-3 rounded-full border px-4 py-2 text-xs font-light border-[var(--border-c-default)] bg-[var(--recessed-bg)] text-[var(--text-tertiary)]`}>
                {loadError}
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className={activeTab === 'users' ? 'h-full min-h-0 w-full' : 'w-full space-y-4'}>

              {activeTab === 'users' && (() => {
                const pendingUsers = users.filter(u => u.status === 'pending');
                const activeUsers = users.filter(u => u.status !== 'pending');
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
                    <button onClick={() => setShowNewUser(!showNewUser)} className={actionButtonCls}>
                      <UserPlus size={14} strokeWidth={1.4} />
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
                        <div><label className={labelCls}>姓名</label><input value={newUser.displayName} onChange={e => setNewUser({...newUser, displayName: e.target.value})} className={inputCls + ' mt-1'} placeholder="张三" /></div>
                        <div><label className={labelCls}>邮箱</label><input type="email" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} className={inputCls + ' mt-1'} placeholder="zhangsan@company.com" /></div>
                        <div><label className={labelCls}>密码</label><input type="password" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className={inputCls + ' mt-1'} placeholder="至少6位" /></div>
                        <div><label className={labelCls}>角色</label>
                          <select value={newUser.roles} onChange={e => setNewUser({...newUser, roles: e.target.value})} className={inputCls + ' mt-1'}>
                            {AVAILABLE_ROLES.map(role => <option key={role} value={role}>{formatRoleLabel(role)}</option>)}
                          </select>
                        </div>
                        <div><label className={labelCls}>部门ID</label><input value={newUser.departmentId} onChange={e => setNewUser({...newUser, departmentId: e.target.value})} className={inputCls + ' mt-1'} placeholder="company" /></div>
                      </div>
                      <button disabled={actionBusyId !== null} onClick={async () => {
                        if (actionBusyId) return;
                        setActionBusyId('create-user');
                        setLoadError('');
                        try {
                          await postAdmin('users', { ...newUser, id: createAdminGeneratedUserId(newUser.email, newUser.displayName) });
                          setShowNewUser(false);
                          setNewUser({ displayName: '', email: '', password: '', roles: 'viewer', departmentId: '' });
                          await loadTab('users');
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
                          <X size={13} strokeWidth={1.4} />
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
                          <label className={labelCls}>部门 ID</label>
                          <input
                            value={userDraft.departmentId}
                            onChange={e => setUserDraft(prev => ({ ...prev, departmentId: e.target.value }))}
                            className={inputCls + ' mt-1'}
                            placeholder="未分配"
                          />
                        </div>
                        <div>
                          <label className={labelCls}>账号状态</label>
                          <select
                            value={userDraft.status}
                            onChange={e => setUserDraft(prev => ({ ...prev, status: e.target.value }))}
                            className={inputCls + ' mt-1'}
                          >
                            {ADMIN_USER_STATUS_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
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
                            <div className={`${inputCls} flex min-w-[220px] flex-1 items-center`}>已加密保存，不能查看原密码</div>
                            <button onClick={() => resetPassword(editingUser.id, editingUser.displayName)}
                              disabled={actionBusyId === editingUser.id}
                              className={`${actionButtonCls} disabled:opacity-50`}><KeyRound size={12} />重置密码</button>
                          </div>
                        </div>
                      </div>

                      <div className={`border-t pt-4 border-[var(--border-c-default)]`}>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div>
                            <label className={labelCls}>角色权限</label>
                            <select
                              value={userDraft.role}
                              onChange={e => setUserDraft(prev => ({ ...prev, role: e.target.value }))}
                              disabled={actionBusyId === editingUser.id}
                              className={inputCls + ' mt-1 disabled:opacity-50'}
                            >
                              {AVAILABLE_ROLES.map(role => (
                                <option key={role} value={role}>{formatRoleLabel(role)}</option>
                              ))}
                            </select>
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
                            <Check size={12} />{actionBusyId === editingUser.id ? '保存中' : '保存账号'}
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
                            <Trash2 size={12} />抹除个人数据
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
                              <select
                                value={pendingRoles[u.id] || 'viewer'}
                                onChange={e => setPendingRoles(prev => ({ ...prev, [u.id]: e.target.value }))}
                                className={`h-9 rounded-control border px-3 text-[11px] font-light outline-none ${ADMIN_USER_FIELD_CLASS}`}
                                disabled={actionBusyId === u.id}
                              >
                                {AVAILABLE_ROLES.map(role => <option key={role} value={role}>{formatRoleLabel(role)}</option>)}
                              </select>
                              <button
                                onClick={() => approvePendingUser(u.id)}
                                disabled={actionBusyId === u.id}
                                className={brandActionCls}
                              >
                                <Check size={12} />{actionBusyId === u.id ? '处理中' : '批准'}
                              </button>
                              <button
                                onClick={() => rejectPendingUser(u.id)}
                                disabled={actionBusyId === u.id}
                                className={dangerActionCls}
                              >
                                <X size={12} />驳回
                              </button>
                            </div>
                          );
                        })}
                      </div>
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
                    <ScrollEdgeFades
                      scrollRef={userListScrollRef}
                      isDarkMode={isDarkMode}
                      variant="normal"
                      renderMode="content-mask"
                      topHeight={56}
                      bottomHeight={72}
                    />
                    <div ref={userListScrollRef} className={ADMIN_USER_LIST_SCROLL_CLASS}>
                    <table className="w-full table-fixed border-separate border-spacing-0 text-left text-xs">
                      <colgroup>
                        <col className="w-[36%]" />
                        <col className="w-[16%]" />
                        <col className="w-[36%]" />
                        <col className="w-[12%]" />
                      </colgroup>
                      <tbody>
                        {activeUsers.map((u: any, idx: number) => {
                          const roles = Array.isArray(u.roles) ? u.roles : [];
                          const privilegedRole = roles.includes('owner') ? 'owner' : roles.includes('admin') ? 'admin' : null;
                          const userRowBorderClass = idx === activeUsers.length - 1
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
                                        size={13}
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
                                  <Pencil size={12} />编辑
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
                                        ? 'bg-[var(--os-vnext-brand-blue)]/8 dark:bg-[var(--os-vnext-brand-blue)]/16 border-[var(--os-vnext-brand-blue)]/20 dark:border-[var(--os-vnext-brand-blue)]/28 text-[var(--text-primary)]'
                                        : 'bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                                    }`}>
                                    {on && <Check size={10} className="inline mr-1" />}
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
                                } catch (e: any) { setLoadError(e.message || '更新权限失败'); }
                              }} className={brandActionCls}>
                                <Check size={12} />保存权限
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

              {activeTab === 'audit-logs' && (
                <div className="space-y-2">
                  {/* task_mr1ncdp9: audit query filter UI */}
                  <div className={`flex flex-wrap items-center gap-2 p-2 text-xs ${inlineRowClass}`}>
                    <input value={auditFilter.targetType} onChange={(e) => setAuditFilter(s => ({ ...s, targetType: e.target.value }))}
                      placeholder="targetType" className={`w-24 rounded border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    <input value={auditFilter.targetId} onChange={(e) => setAuditFilter(s => ({ ...s, targetId: e.target.value }))}
                      placeholder="targetId" className={`w-28 rounded border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    <input value={auditFilter.action} onChange={(e) => setAuditFilter(s => ({ ...s, action: e.target.value }))}
                      placeholder="action" className={`w-24 rounded border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    <input value={auditFilter.actorId} onChange={(e) => setAuditFilter(s => ({ ...s, actorId: e.target.value }))}
                      placeholder="actorId" className={`w-24 rounded border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    <input value={auditFilter.createdFrom} onChange={(e) => setAuditFilter(s => ({ ...s, createdFrom: e.target.value }))}
                      placeholder="createdFrom(ms)" className={`w-28 rounded border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    <input value={auditFilter.createdTo} onChange={(e) => setAuditFilter(s => ({ ...s, createdTo: e.target.value }))}
                      placeholder="createdTo(ms)" className={`w-28 rounded border px-1.5 py-0.5 border-[var(--border-c-strong)] bg-[var(--bg-card)] text-[var(--text-primary)]`} />
                    <button onClick={() => { setAuditFilter({ targetType: '', targetId: '', action: '', actorId: '', createdFrom: '', createdTo: '' }); setAuditFilterError(''); fetchAuditLogs({ targetType: '', targetId: '', action: '', actorId: '', createdFrom: '', createdTo: '' }); }}
                      className={`rounded border px-2 py-0.5 border-[var(--border-c-strong)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}>清空</button>
                    <button onClick={() => fetchAuditLogs()}
                      className={`rounded border px-2 py-0.5 border-[var(--border-c-strong)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]`}>刷新</button>
                  </div>
                  {auditFilterError && <div className="text-xs text-[var(--text-tertiary)]">{auditFilterError}</div>}
                  <span className={sectionTitleClass}>{auditLogs.length} 条日志</span>
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
                          <select value={aclForm.documentId} onChange={e => setAclForm({ ...aclForm, documentId: e.target.value })} className={inputCls + ' mt-1'}>
                            <option value="">选择文档...</option>
                            {kbDocuments.map((d: any) => <option key={d.id} value={d.id}>{d.title}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>访问范围</label>
                          <select value={aclForm.scope} onChange={e => setAclForm({ ...aclForm, scope: e.target.value })} className={inputCls + ' mt-1'}>
                            {KNOWLEDGE_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>角色（可选）</label>
                          <select value={aclForm.roleId} onChange={e => setAclForm({ ...aclForm, roleId: e.target.value })} className={inputCls + ' mt-1'}>
                            <option value="">不限角色</option>
                            {kbRoles.map((r: any) => <option key={r.id} value={r.id}>{formatRoleLabel(r.name)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>部门（可选）</label>
                          <select value={aclForm.departmentId} onChange={e => setAclForm({ ...aclForm, departmentId: e.target.value })} className={inputCls + ' mt-1'}>
                            <option value="">不限部门</option>
                            {kbDepartments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>权限级别</label>
                          <select value={aclForm.access} onChange={e => setAclForm({ ...aclForm, access: e.target.value })} className={inputCls + ' mt-1'}>
                            {ACCESS_LEVELS.map(a => <option key={a} value={a}>{formatAccessLabel(a)}</option>)}
                          </select>
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
                              if (!window.confirm('确认删除此访问控制规则？')) return;
                              setActionBusyId(`acl:${acl.id}`);
                              try { await postAdmin(`knowledge-acl/${acl.id}`, {}, 'DELETE'); await loadTab('knowledge-acl'); } catch (e: any) { setLoadError(e.message); }
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
                          <select value={toolPermForm.toolId} onChange={e => setToolPermForm({ ...toolPermForm, toolId: e.target.value })} className={inputCls + ' mt-1'}>
                            <option value="">选择工具...</option>
                            {tools.map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.scope})</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>角色</label>
                          <select value={toolPermForm.roleId} onChange={e => setToolPermForm({ ...toolPermForm, roleId: e.target.value })} className={inputCls + ' mt-1'}>
                            <option value="">选择角色...</option>
                            {toolRoles.map((r: any) => <option key={r.id} value={r.id}>{formatRoleLabel(r.name)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>访问级别</label>
                          <select value={toolPermForm.access} onChange={e => setToolPermForm({ ...toolPermForm, access: e.target.value })} className={inputCls + ' mt-1'}>
                            {TOOL_ACCESS_LEVELS.map(a => <option key={a} value={a}>{formatAccessLabel(a)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>风险模式</label>
                          <select value={toolPermForm.riskMode} onChange={e => setToolPermForm({ ...toolPermForm, riskMode: e.target.value })} className={inputCls + ' mt-1'}>
                            {RISK_MODES.map(m => <option key={m} value={m}>{formatRiskModeLabel(m)}</option>)}
                          </select>
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
                                    setActionBusyId(`toolperm:${p.id}`);
                                    try { await postAdmin(`tool-permissions/${p.id}`, {}, 'DELETE'); await loadTab('tool-perms'); } catch (e: any) { setLoadError(e.message); }
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
    </div>
  );
};

export default AdminPanel;
