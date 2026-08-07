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
