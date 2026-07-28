/**
 * 统一 API 根路径：
 *
 * 优先级（从高到低）：
 * 1. 环境变量 VITE_API_BASE_URL   — 仅允许数据中心/相对 API 路径
 * 2. 用户在设置页填的 cloudEndpoint — Cloudflare / Bambook 数据入口
 * 3. 兜底                          — Cloudflare 公网 API
 */
export const DEFAULT_BAMBOOK_ENDPOINT = 'https://jiangsupanda.com/bambook';
export const CORPORATE_MASTER_IP = 'jiangsupanda.com';
const NON_BAMBOOK_DATA_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '47.100.99.170', 'hd.jyiba.cn']);

export function normalizeDataCenterEndpoint(endpoint?: string): string {
  const raw = endpoint?.trim().replace(/\/$/, '') || '';
  if (!raw) return DEFAULT_BAMBOOK_ENDPOINT;
  const normalized = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(normalized);
    if (NON_BAMBOOK_DATA_HOSTS.has(url.hostname.toLowerCase())) return DEFAULT_BAMBOOK_ENDPOINT;
    if (url.pathname.toLowerCase().includes('/pdml')) return DEFAULT_BAMBOOK_ENDPOINT;
    if (url.pathname.endsWith('/api')) {
      url.pathname = url.pathname.slice(0, -4) || '/';
    }
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`.replace(/\/$/, '');
  } catch {
    return DEFAULT_BAMBOOK_ENDPOINT;
  }
}

export function withApiSuffix(endpoint: string): string {
  const ep = endpoint.trim().replace(/\/$/, '');
  if (!ep) return '';
  if (ep.startsWith('/')) return ep.endsWith('/api') ? ep : `${ep}/api`;
  const normalized = /^https?:\/\//.test(ep) ? ep : `http://${ep}`;
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

function normalizeExplicitApiBase(apiBase?: string): string {
  const raw = apiBase?.trim().replace(/\/$/, '') || '';
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  const normalized = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(normalized);
    if (NON_BAMBOOK_DATA_HOSTS.has(url.hostname.toLowerCase())) return '';
    if (url.pathname.toLowerCase().includes('/pdml')) return '';
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function isDevLocalAgentRuntimeEnabled(): boolean {
  return false;
}

export function getAgentRuntimeApiBaseUrl(): string {
  return getApiBaseUrl();
}

export function getAgentRuntimeModeLabel(): string {
  return '数据中心 Agent Runtime';
}

export function getAgentRuntimeDevHeaders(): Record<string, string> {
  return {};
}

export function getApiBaseUrl(): string {
  // 1. 环境变量最高优先，但账号/业务数据不能指向本机库。
  const envUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envUrl?.trim()) {
    const apiBase = normalizeExplicitApiBase(envUrl);
    if (apiBase) return apiBase;
  }

  // 2. 用户在设置页配置的 Cloudflare 入口。业务数据不能默认落到本机库。
  try {
    const raw = localStorage.getItem('panda_system_config');
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg?.cloudEndpoint && cfg.cloudEndpoint.trim()) {
        const apiBase = withApiSuffix(normalizeDataCenterEndpoint(cfg.cloudEndpoint));
        if (apiBase) return apiBase;
      }
    }
  } catch {
    // localStorage 不可用或解析失败，继续走后面的逻辑
  }

  return withApiSuffix(DEFAULT_BAMBOOK_ENDPOINT);
}
