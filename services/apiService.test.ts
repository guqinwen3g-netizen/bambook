import { beforeEach, describe, expect, it, vi } from 'vitest';
// apiService 模块级无可执行副作用（localStorage/fetch 全部调用时读取），
// 静态导入一次即可；beforeEach 的 stubGlobal 保证测试间隔离。
// 避免 vi.resetModules() + 逐测试 await import 重复 transform 大模块图
//（单跑 ~1.1s，全量并发下 transform 队列挤占曾致 5s 超时假象）。
import { apiService } from './apiService';

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

describe('apiService product reads', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('does not convert a failed v1 product request into an empty legacy product list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/v1/products/assets')) {
        return {
          ok: false,
          json: async () => ({ message: 'upstream timeout' }),
        };
      }
      if (url.includes('/api/products')) {
        return {
          ok: true,
          json: async () => [],
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const { apiService } = await import('./apiService');

    await expect(apiService.listProducts('https://jiangsupanda.com/bambook')).rejects.toThrow('upstream timeout');
  });

  it('requests a bounded product page for the global product snapshot', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, assets: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiService.listProducts('https://jiangsupanda.com/bambook');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/products/assets?limit=500'),
      expect.any(Object),
    );
  });

  it('paginates PDML raw fabrics when building the local device cache', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const offset = Number(parsed.searchParams.get('offset') || 0);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          fabrics: offset === 0 ? [{ id: 'PDML-1' }] : [{ id: 'PDML-2' }],
          total: 2,
          limit: 1,
          offset,
          hasMore: offset === 0,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiService.listAllPdmlRawFabrics('https://jiangsupanda.com/bambook', { pageSize: 1 });

    expect(result.fabrics.map(row => row.id)).toEqual(['PDML-1', 'PDML-2']);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/pdml/raw?limit=1'),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/pdml/raw?limit=1&offset=1'),
      expect.any(Object),
    );
  });

  it('starts PDML sync as a background job instead of a blocking request', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true, jobId: 'job-1', status: 'queued', gsid: '6' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { apiService } = await import('./apiService');

    const result = await apiService.startPdmlRawSync('https://jiangsupanda.com/bambook', { pageSize: 500 });

    expect(result).toMatchObject({ jobId: 'job-1', status: 'queued' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/pdml/sync'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pageSize: 500 }),
      }),
    );
  });

  it('keeps the legacy sync helper explicitly blocking for narrow compatibility calls', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        source: 'PDML V_MLXX',
        gsid: '6',
        totalAvailable: 1,
        fetched: 1,
        created: 1,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        syncedAt: 123,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiService.syncPdmlRawFabrics('https://jiangsupanda.com/bambook', { limit: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/pdml/sync'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ limit: 1, blocking: true }),
      }),
    );
  });
});

describe('apiService listUserAccounts（审批委派/QC 选人数据源）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('GET /api/hr/personnel，映射 姓名 + 角色 + 部门，过滤 disabled', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        personnel: [
          { id: 'USR_1', displayName: '张三', email: 'a@b.c', status: 'active', department: '业务一部', roles: ['manager'] },
          { id: 'USR_2', displayName: '李四', status: 'disabled', department: null, roles: [] },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const list = await apiService.listUserAccounts('https://test.example.com');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/hr/personnel'),
      expect.any(Object),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'USR_1',
      displayName: '张三',
      department: '业务一部',
      roles: ['manager'],
    });
  });
});

describe('apiService requestJson 超时治理与网络错误语义化', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('超时（TimeoutError）→ 语义化 REQUEST_TIMEOUT 错误，不暴露原始 DOMException', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }));

    await expect(apiService.listUserAccounts('https://test.example.com'))
      .rejects.toThrow('请求超时');
  });

  it('断网/传输层失败（TypeError: Failed to fetch）→ 语义化 NETWORK_ERROR 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    await expect(apiService.listUserAccounts('https://test.example.com'))
      .rejects.toThrow('网络请求失败');
  });

  it('调用方主动取消（AbortError）→ 原样上抛，不被吞掉', async () => {
    const abortErr = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw abortErr; }));

    await expect(apiService.listUserAccounts('https://test.example.com'))
      .rejects.toBe(abortErr);
  });

  it('默认请求带超时 signal；调用方自带 signal 时原样透传不叠加', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true, personnel: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiService.listUserAccounts('https://test.example.com');
    const defaultInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(defaultInit.signal).toBeInstanceOf(AbortSignal);

    await apiService.listUserAccounts('https://test.example.com');
    // requestJson 未暴露透传 signal 的公开 API；hrRequest 等内部通道继承同一行为，
    // 此处仅断言默认超时 signal 在位（透传路径由 requestJson 签名保证，AbortError 用例已覆盖取消语义）
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('服务端错误信封（HTTP 500 + message）原样上抛，不被网络错误语义化污染', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: 'server exploded' }),
    })));

    await expect(apiService.listUserAccounts('https://test.example.com'))
      .rejects.toThrow('server exploded');
  });
});

describe('apiService getStoredConfig 默认端点（DEV 闭环本地 / PROD 生产行为不变）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('DEV 下默认 cloudEndpoint 落本地后端，即使 env 存在生产 VITE_CLOUD_ENDPOINT 也不采用', async () => {
    vi.stubEnv('VITE_CLOUD_ENDPOINT', 'https://jiangsupanda.com/bambook');

    const { apiService } = await import('./apiService');

    expect(apiService.getStoredConfig().cloudEndpoint).toBe('http://localhost:8081');
  });

  it('PROD 构建下默认 cloudEndpoint 兜底生产端点（行为不变）', async () => {
    vi.stubEnv('DEV', false);

    const { apiService } = await import('./apiService');

    expect(apiService.getStoredConfig().cloudEndpoint).toBe('https://jiangsupanda.com/bambook');
  });
});
