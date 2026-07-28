import { beforeEach, describe, expect, it, vi } from 'vitest';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  };
}

describe('getApiBaseUrl', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubGlobal('localStorage', createStorage());
  });

  it('defaults business data requests to the Cloudflare API', async () => {
    const { getApiBaseUrl } = await import('./apiBase');

    expect(getApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
  });

  it('honors an explicitly stored Cloudflare endpoint', async () => {
    localStorage.setItem('panda_system_config', JSON.stringify({
      cloudEndpoint: 'https://jiangsupanda.com/bambook',
    }));

    const { getApiBaseUrl } = await import('./apiBase');

    expect(getApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
  });

  it('does not allow business data requests to use a local database endpoint', async () => {
    localStorage.setItem('panda_system_config', JSON.stringify({
      cloudEndpoint: 'http://127.0.0.1:8081',
    }));

    const { getApiBaseUrl } = await import('./apiBase');

    expect(getApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
  });

  it('does not allow VITE_API_BASE_URL to point business data at localhost', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8081/api');

    const { getApiBaseUrl } = await import('./apiBase');

    expect(getApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
  });

  it('does not allow Agent runtime requests to use localhost even when old dev flags are present', async () => {
    vi.stubEnv('VITE_BAMBOOK_DEV_LOCAL_RUNTIME', '1');
    vi.stubEnv('VITE_BAMBOOK_DEV_LOCAL_API_BASE', 'http://localhost:8081/api');
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8081/api');

    const {
      getApiBaseUrl,
      getAgentRuntimeApiBaseUrl,
      getAgentRuntimeModeLabel,
      getAgentRuntimeDevHeaders,
    } = await import('./apiBase');

    expect(getApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
    expect(getAgentRuntimeApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
    expect(getAgentRuntimeModeLabel()).toBe('数据中心 Agent Runtime');
    expect(getAgentRuntimeDevHeaders()).toEqual({});
  });

  it('ignores stale dev-only Agent runtime base settings', async () => {
    vi.stubEnv('VITE_BAMBOOK_DEV_LOCAL_RUNTIME', '1');
    vi.stubEnv('VITE_BAMBOOK_DEV_LOCAL_API_BASE', 'http://47.100.99.170:8081/api');

    const { getAgentRuntimeApiBaseUrl } = await import('./apiBase');

    expect(getAgentRuntimeApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
  });

  it('allows deploy builds to use a relative API base', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/bambook/api');

    const { getApiBaseUrl } = await import('./apiBase');

    expect(getApiBaseUrl()).toBe('/bambook/api');
  });

  it('migrates legacy direct-IP data endpoints back to Cloudflare', async () => {
    localStorage.setItem('panda_system_config', JSON.stringify({
      cloudEndpoint: '47.100.99.170:8081',
    }));

    const { getApiBaseUrl } = await import('./apiBase');

    expect(getApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
  });

  it('does not allow the PDML fabric website to become the Bambook data center', async () => {
    localStorage.setItem('panda_system_config', JSON.stringify({
      cloudEndpoint: 'http://hd.jyiba.cn:49988/pdml#/pages/MLGL/BQCX',
    }));

    const { getApiBaseUrl } = await import('./apiBase');

    expect(getApiBaseUrl()).toBe('https://jiangsupanda.com/bambook/api');
  });
});
