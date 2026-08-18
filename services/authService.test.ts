// @vitest-environment jsdom
// authService 模块在浏览器语义下运行（window.location 等），文件级开启 jsdom
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

describe('authService checkAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('checks the cookie session when no auth token is stored', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'UNAUTHORIZED' }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const { checkAuth } = await import('./authService');

    await expect(checkAuth()).resolves.toEqual({
      user: null,
      isLoading: false,
      isAuthenticated: false,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://jiangsupanda.com/bambook/api/auth/me',
      expect.objectContaining({
        method: 'GET',
        headers: {},
        credentials: 'include',
      }),
    );
  });

  it('restores the user from an existing cookie session when no local token is stored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        user: {
          id: 'u-cookie',
          displayName: 'Cookie User',
          email: 'cookie@example.com',
          roles: ['viewer'],
          permissions: ['orders:read'],
          departmentIds: ['company'],
          department: null,
        },
      }),
    })));

    const { checkAuth, getAuthState } = await import('./authService');

    await expect(checkAuth()).resolves.toMatchObject({
      isLoading: false,
      isAuthenticated: true,
      user: { displayName: 'Cookie User' },
    });
    expect(getAuthState().user?.email).toBe('cookie@example.com');
    expect(JSON.parse(localStorage.getItem('bambook_auth_user') || '{}').displayName).toBe('Cookie User');
  });

  it('renders from cached user permissions while refreshing the session in the background', async () => {
    localStorage.setItem('bambook_auth_token', 'token-1');
    localStorage.setItem('bambook_auth_user', JSON.stringify({
      id: 'u1',
      displayName: 'Cached User',
      email: 'cached@example.com',
      roles: ['viewer'],
      permissions: ['relations:read'],
      departmentIds: ['company'],
      department: null,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    const { View } = await import('../types');
    const { checkAuth, getAuthState, canAccessView } = await import('./authService');

    expect(getAuthState()).toMatchObject({
      isLoading: false,
      isAuthenticated: true,
      user: { displayName: 'Cached User' },
    });
    expect(canAccessView(View.Relations)).toBe(true);

    await expect(checkAuth()).resolves.toMatchObject({
      isLoading: false,
      isAuthenticated: true,
      user: { displayName: 'Cached User' },
    });
  });

  it('drops the cached user in dev when a session refresh returns 401 (session definitively dead)', async () => {
    localStorage.setItem('bambook_auth_token', 'token-1');
    localStorage.setItem('bambook_auth_user', JSON.stringify({
      id: 'u1',
      displayName: 'Cached User',
      email: 'cached@example.com',
      roles: ['viewer'],
      permissions: ['orders:read'],
      departmentIds: ['company'],
      department: null,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'UNAUTHORIZED', message: 'Token expired or invalid.' }),
    })));

    const { checkAuth, getAuthState } = await import('./authService');

    await expect(checkAuth()).resolves.toMatchObject({
      isLoading: false,
      isAuthenticated: false,
      user: null,
    });
    expect(getAuthState().isAuthenticated).toBe(false);
  });

  it('logs in against the default cloud API when no endpoint is stored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        token: 'token-1',
        user: {
          id: 'u1',
          displayName: 'User One',
          email: 'user@example.com',
          avatarUrl: 'data:image/webp;base64,abc',
          roles: ['owner'],
          departmentIds: ['company'],
          department: null,
        },
      }),
    })));

    const { login } = await import('./authService');
    await login('user@example.com', 'correct-password');

    expect(fetch).toHaveBeenCalledWith(
      'https://jiangsupanda.com/bambook/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('updates the cached current user when profile avatar changes', async () => {
    localStorage.setItem('bambook_auth_token', 'token-1');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        user: {
          id: 'u1',
          displayName: 'User One',
          email: 'user@example.com',
          avatarUrl: 'data:image/webp;base64,next',
          roles: ['viewer'],
          permissions: ['orders:read'],
          departmentIds: ['company'],
          department: null,
        },
      }),
    })));

    const { updateMyProfile, getAuthState } = await import('./authService');
    const user = await updateMyProfile({ avatarUrl: 'data:image/webp;base64,next' });

    expect(fetch).toHaveBeenCalledWith(
      'https://jiangsupanda.com/bambook/api/auth/me',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ avatarUrl: 'data:image/webp;base64,next' }),
      }),
    );
    expect(user.avatarUrl).toBe('data:image/webp;base64,next');
    expect(getAuthState().user?.avatarUrl).toBe('data:image/webp;base64,next');
    expect(JSON.parse(localStorage.getItem('bambook_auth_user') || '{}').avatarUrl).toBe('data:image/webp;base64,next');
  });

  it('keeps LAN phone preview login on the default cloud API when no endpoint is stored', async () => {
    // window stub 必须保留 setTimeout/clearTimeout（authService fetchWithTimeout 依赖），
    // 只覆盖 location.hostname 模拟 LAN 手机预览场景
    vi.stubGlobal('window', {
      location: {
        hostname: '192.168.31.46',
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        token: 'token-1',
        user: {
          id: 'u1',
          displayName: 'User One',
          email: 'user@example.com',
          roles: ['owner'],
          departmentIds: ['company'],
          department: null,
        },
      }),
    })));

    const { login } = await import('./authService');
    await login('user@example.com', 'correct-password');

    expect(fetch).toHaveBeenCalledWith(
      'https://jiangsupanda.com/bambook/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('honors stored Cloudflare endpoint for LAN phone preview login', async () => {
    vi.stubGlobal('window', {
      location: {
        hostname: '192.168.31.46',
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    localStorage.setItem('panda_system_config', JSON.stringify({
      cloudEndpoint: 'https://jiangsupanda.com/bambook',
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        token: 'token-1',
        user: {
          id: 'u1',
          displayName: 'User One',
          email: 'user@example.com',
          roles: ['owner'],
          departmentIds: ['company'],
          department: null,
        },
      }),
    })));

    const { login } = await import('./authService');
    await login('user@example.com', 'correct-password');

    expect(fetch).toHaveBeenCalledWith(
      'https://jiangsupanda.com/bambook/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not log in against a local database endpoint from stored config', async () => {
    localStorage.setItem('panda_system_config', JSON.stringify({
      cloudEndpoint: 'http://127.0.0.1:8081',
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        token: 'token-1',
        user: {
          id: 'u1',
          displayName: 'User One',
          email: 'user@example.com',
          roles: ['owner'],
          departmentIds: ['company'],
          department: null,
        },
      }),
    })));

    const { login } = await import('./authService');
    await login('user@example.com', 'correct-password');

    expect(fetch).toHaveBeenCalledWith(
      'https://jiangsupanda.com/bambook/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses permission scopes to decide whether pages are visible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        token: 'token-1',
        user: {
          id: 'u1',
          displayName: 'User One',
          email: 'user@example.com',
          roles: ['viewer'],
          permissions: ['orders:read', 'products:read'],
          departmentIds: ['company'],
          department: null,
        },
      }),
    })));

    const { View } = await import('../types');
    const { canAccessView, hasPermission, login } = await import('./authService');
    await login('user@example.com', 'correct-password');

    expect(hasPermission('orders:read')).toBe(true);
    expect(hasPermission('ai:chat')).toBe(false);
    expect(canAccessView(View.Orders)).toBe(true);
    expect(canAccessView(View.Assistant)).toBe(false);
    expect(canAccessView(View.AccountSettings)).toBe(true);
    expect(canAccessView(View.SystemSettings)).toBe(true);
  });

  it('does not grant AI access from legacy role fallback when auth responses omit permissions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        token: 'token-1',
        user: {
          id: 'u1',
          displayName: 'User One',
          email: 'user@example.com',
          roles: ['viewer'],
          departmentIds: ['company'],
          department: null,
        },
      }),
    })));

    const { View } = await import('../types');
    const { canAccessView, login } = await import('./authService');
    await login('user@example.com', 'correct-password');

    expect(canAccessView(View.Assistant)).toBe(false);
    expect(canAccessView(View.Products)).toBe(true);
  });
});
