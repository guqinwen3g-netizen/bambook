import { getApiBaseUrl, getDefaultBambookEndpoint, normalizeDataCenterEndpoint } from './apiBase';
import { View } from '../types';
import { getViewPermission, isAuthenticatedPublicView, isDevOnlyView } from '../lib/modulePermissions';

export type AgentRole = 'owner' | 'admin' | 'manager' | 'merchandiser' | 'finance' | 'sales' | 'viewer' | 'agent_operator';

export interface AuthUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  roles: AgentRole[];
  permissions: string[];
  departmentIds: string[];
  department: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

type AuthListener = (state: AuthState) => void;

const initialState: AuthState = { user: null, isLoading: true, isAuthenticated: false };

const listeners = new Set<AuthListener>();
const AUTH_TOKEN_KEY = 'bambook_auth_token';
const AUTH_USER_CACHE_KEY = 'bambook_auth_user';
// 默认认证端点：DEV 闭环本地 8081 后端；PROD 走生产数据中心（与 apiBase 同口径，构建期静态分流）。
const DEFAULT_AUTH_ENDPOINT = getDefaultBambookEndpoint();
const AUTH_FETCH_TIMEOUT_MS = 8000;

const DEFAULT_ROLE_PERMISSIONS: Record<AgentRole, string[] | '*'> = {
  owner: '*',
  admin: ['users:read', 'users:write', 'users:delete', 'roles:read', 'roles:write', 'orders:read', 'orders:write', 'products:read', 'products:write', 'relations:read', 'relations:write', 'knowledge:read', 'knowledge:write', 'knowledge:admin', 'tools:execute', 'tools:admin', 'finance:read', 'ai:chat', 'ai:agent', 'emails:read', 'emails:write', 'settings:read', 'settings:write', 'audit:read', 'approvals:read', 'approvals:write'],
  manager: ['users:read', 'orders:read', 'orders:write', 'products:read', 'products:write', 'relations:read', 'relations:write', 'knowledge:read', 'knowledge:write', 'tools:execute', 'finance:read', 'finance:write', 'emails:read', 'emails:write', 'settings:read', 'audit:read', 'approvals:read', 'approvals:write'],
  merchandiser: ['orders:read', 'orders:write', 'products:read', 'relations:read', 'knowledge:read', 'tools:execute', 'emails:read'],
  sales: ['orders:read', 'products:read', 'relations:read', 'relations:write', 'knowledge:read', 'tools:execute', 'emails:read', 'emails:write'],
  finance: ['orders:read', 'finance:read', 'finance:write', 'knowledge:read', 'tools:execute', 'emails:read'],
  agent_operator: ['orders:read', 'products:read', 'knowledge:read', 'tools:execute'],
  viewer: ['orders:read', 'products:read', 'relations:read', 'knowledge:read'],
};

function deriveDefaultPermissions(roles: AgentRole[]): string[] {
  if (roles.some(role => DEFAULT_ROLE_PERMISSIONS[role] === '*')) {
    return ['*'];
  }
  return Array.from(new Set(roles.flatMap(role => {
    const scopes = DEFAULT_ROLE_PERMISSIONS[role];
    return Array.isArray(scopes) ? scopes : [];
  }))).sort();
}

function normalizeAuthUser(user: AuthUser | null | undefined): AuthUser | null {
  if (!user) return null;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const rawPermissions = (user as any).permissions;
  return {
    ...user,
    roles,
    permissions: Array.isArray(rawPermissions) ? rawPermissions : deriveDefaultPermissions(roles),
    departmentIds: Array.isArray(user.departmentIds) ? user.departmentIds : [],
    department: user.department ?? null,
  };
}

function readCachedAuthState(): AuthState {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
    const raw = localStorage.getItem(AUTH_USER_CACHE_KEY);
    if (!token || !raw) return { ...initialState };
    const user = normalizeAuthUser(JSON.parse(raw));
    if (!user) return { ...initialState };
    return { user, isLoading: false, isAuthenticated: true };
  } catch {
    return { ...initialState };
  }
}

function cacheAuthUser(user: AuthUser | null): void {
  try {
    if (user) {
      localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_USER_CACHE_KEY);
    }
  } catch {
    // Auth cache is only a startup accelerator; ignore storage failures.
  }
}

let currentState: AuthState = readCachedAuthState();

function notify() {
  listeners.forEach(fn => fn({ ...currentState }));
}

function getStoredAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function keepCachedAuthOnRefreshFailure(status?: number): boolean {
  if (!status) return true; // 无状态=网络/离线故障：任何环境都宽容保留缓存
  // 401=服务端明确判定会话失效：任何环境都必须登出（DEV 保留缓存会导致
  // “界面显示已登录、JWT 接口却处处 401”的假登录状态）
  if (status === 401) return false;
  if (import.meta.env.DEV) return true;
  return status >= 500 || status === 408 || status === 429;
}

export function subscribe(fn: AuthListener): () => void {
  listeners.add(fn);
  fn({ ...currentState });
  return () => listeners.delete(fn);
}

export function getAuthState(): AuthState {
  return { ...currentState };
}

function getAuthApiBase(): string {
  // 本地 Web/浏览器模拟测试：VITE_API_BASE_URL 显式配置相对基座（如 '/api'，
  // 由 vite proxy 转发本地 8081 后端）时，auth 与业务 API 同源直连——
  // 优先级与 apiService.getApiBaseUrl 的 env 分支对齐（此前 env 相对基座被
  // 排除，登录请求绕过代理直打生产 DEFAULT_AUTH_ENDPOINT，本地账号全部登录失败）。
  const envBase = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (envBase.startsWith('/')) return envBase.replace(/\/$/, '');

  try {
    const raw = localStorage.getItem('panda_system_config');
    if (raw) {
      const cfg = JSON.parse(raw);
      const cloud = String(cfg?.cloudEndpoint || '').trim();
      if (cloud) {
        const base = normalizeDataCenterEndpoint(cloud).replace(/\/$/, '');
        return base.endsWith('/api') ? base : `${base}/api`;
      }
    }
  } catch {
    // Ignore malformed local config and continue to legacy keys.
  }

  const legacyCloud = localStorage.getItem('cloudEndpoint') || '';
  if (legacyCloud.trim()) {
    const base = normalizeDataCenterEndpoint(legacyCloud).replace(/\/$/, '');
    return base.endsWith('/api') ? base : `${base}/api`;
  }

  const apiBase = getApiBaseUrl().replace(/\/$/, '');
  if (apiBase && apiBase !== '/api') return apiBase;

  return `${DEFAULT_AUTH_ENDPOINT}/api`;
}

/**
 * 认证请求统一错误映射层：把底层网络/协议异常翻译成用户可读文案，
 * 业务页面不再直渲 err.message 原文（TypeError: Failed to fetch 等）。
 * - TypeError / AbortError（断网、CORS、fetch 超时中断）→ 服务器不可达或超时
 * - 非 JSON 响应（代理错误页/HTML 网关页）→ 服务异常（HTTP N）
 * - 其余（后端业务 message，已是中文）→ 原样透传
 */
const NETWORK_ERROR_MESSAGE = '服务器不可达或超时，请检查网络';
const NON_JSON_RESPONSE_RE = /^HTTP (\d+) returned non-JSON response/;

export function mapAuthErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error && typeof error === 'object') {
    const err = error as { name?: unknown; message?: unknown };
    if (err.name === 'AbortError' || error instanceof TypeError) {
      return NETWORK_ERROR_MESSAGE;
    }
    const message = typeof err.message === 'string' ? err.message : '';
    const nonJson = NON_JSON_RESPONSE_RE.exec(message);
    if (nonJson) return `服务异常（HTTP ${nonJson[1]}）`;
    if (message) return message;
  }
  return fallback;
}

async function readJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(`HTTP ${res.status} returned non-JSON response: ${preview || 'empty body'}`);
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredAuthToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

export async function checkAuth(): Promise<AuthState> {
  const canRenderFromCachedUser = currentState.isAuthenticated && Boolean(currentState.user);
  if (!canRenderFromCachedUser) {
    currentState = { ...currentState, isLoading: true };
    notify();
  }
  const storedToken = getStoredAuthToken();
  try {
    const res = await fetchAuth('/auth/me', {
      method: 'GET',
      headers: storedToken ? authHeaders() : {},
      credentials: 'include',
    }, { fallbackToOmitCredentials: true });
    if (res.ok) {
      const data = await readJsonResponse(res);
      currentState = { user: normalizeAuthUser(data.user), isLoading: false, isAuthenticated: true };
      cacheAuthUser(currentState.user);
    } else if (canRenderFromCachedUser && keepCachedAuthOnRefreshFailure(res.status)) {
      currentState = { ...currentState, isLoading: false, isAuthenticated: true };
    } else {
      currentState = { user: null, isLoading: false, isAuthenticated: false };
      cacheAuthUser(null);
    }
  } catch {
    currentState = canRenderFromCachedUser
      ? { ...currentState, isLoading: false, isAuthenticated: true }
      : { user: null, isLoading: false, isAuthenticated: false };
    if (!canRenderFromCachedUser) cacheAuthUser(null);
  }
  notify();
  return currentState;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  requestedDepartment?: string;
  code: string;
}

export async function sendVerificationCode(email: string, purpose: 'register' | 'reset_password' = 'register'): Promise<{ message: string; cooldownMs: number; transport: string }> {
  const res = await fetch(`${getAuthApiBase()}/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({ email, purpose }),
  });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    const err: any = new Error(data.message || data.error || `Send code failed (HTTP ${res.status})`);
    err.code = data.error;
    err.retryAfterMs = data.retryAfterMs;
    throw err;
  }
  return { message: data.message, cooldownMs: data.cooldownMs ?? 60000, transport: data.transport };
}

export async function register(input: RegisterInput): Promise<{ message: string; userId: string }> {
  const res = await fetch(`${getAuthApiBase()}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(input),
  });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    throw new Error(data.message || data.error || `Register failed (HTTP ${res.status})`);
  }
  return { message: data.message, userId: data.user?.id };
}

export async function login(identifier: string, password: string): Promise<AuthUser> {
  let res: Response;
  let data: any;
  try {
    res = await fetchAuth('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: identifier, identifier, password }),
    }, { fallbackToOmitCredentials: true });
    data = await readJsonResponse(res);
  } catch (error) {
    throw new Error(mapAuthErrorMessage(error, '登录失败，请稍后重试'));
  }
  if (!res.ok) {
    const err: any = new Error(data.message || data.error || `服务异常（HTTP ${res.status}）`);
    err.code = data.error;
    // 429 防爆破限流：透传后端算好的冷却时长，供登录页做倒计时
    if (typeof data.retryAfterMs === 'number') err.retryAfterMs = data.retryAfterMs;
    throw err;
  }
  if (data.token) {
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
  }
  const user = normalizeAuthUser(data.user);
  currentState = { user, isLoading: false, isAuthenticated: true };
  cacheAuthUser(user);
  notify();
  return user as AuthUser;
}

async function fetchAuth(
  path: string,
  init: RequestInit,
  options: { fallbackToOmitCredentials?: boolean } = {},
): Promise<Response> {
  const url = `${getAuthApiBase()}${path}`;
  const fetchWithTimeout = (nextInit: RequestInit) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
    return fetch(url, { ...nextInit, signal: nextInit.signal ?? controller.signal })
      .finally(() => window.clearTimeout(timer));
  };
  try {
    return await fetchWithTimeout(init);
  } catch (error) {
    if (!options.fallbackToOmitCredentials || init.credentials === 'omit') {
      throw error;
    }
    return fetchWithTimeout({ ...init, credentials: 'omit' });
  }
}

export async function logout(): Promise<void> {
  await fetch(`${getAuthApiBase()}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  localStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  cacheAuthUser(null);
  currentState = { user: null, isLoading: false, isAuthenticated: false };
  notify();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetchAuth('/auth/change-password', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ currentPassword, newPassword }),
  }, { fallbackToOmitCredentials: true });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    throw new Error(data.message || data.error || `Password change failed (HTTP ${res.status})`);
  }
}

export async function updateMyProfile(input: { avatarUrl?: string | null; displayName?: string }): Promise<AuthUser> {
  const res = await fetchAuth('/auth/me', {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(input),
  }, { fallbackToOmitCredentials: true });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    throw new Error(data.message || data.error || `Profile update failed (HTTP ${res.status})`);
  }
  const user = normalizeAuthUser(data.user);
  currentState = { user, isLoading: false, isAuthenticated: true };
  cacheAuthUser(user);
  notify();
  return user as AuthUser;
}

export function hasRole(...roles: AgentRole[]): boolean {
  if (!currentState.user) return false;
  return currentState.user.roles.some(r => roles.includes(r));
}

export function hasPermission(...permissions: string[]): boolean {
  if (!currentState.user) return false;
  if (hasRole('owner')) return true;
  if (currentState.user.permissions.includes('*')) return true;
  return permissions.some(scope => currentState.user?.permissions.includes(scope));
}

export function canAccessView(view: View): boolean {
  if (!currentState.isAuthenticated || !currentState.user) return false;
  if (isAuthenticatedPublicView(view)) return true;
  if (isDevOnlyView(view)) return import.meta.env.DEV;
  const requiredPermission = getViewPermission(view);
  if (!requiredPermission) return false;
  return hasPermission(requiredPermission);
}
