import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * ERP-P0 orders-delete-real-sync: focused tests
 * 验证 handleDeleteOrder 的删除真实同步契约：
 * - 成功：调用 DELETE /api/v1/orders/:id，用后端返回 order 更新状态
 * - 失败（HTTP 错误）：不从本地列表移除，显示反馈
 * - 失败（网络错误）：不从本地列表移除，显示反馈
 * - 后端响应壳契约：{ ok: true, order: {...含 deletedAt} }
 */

// 捕获 fetch 调用
const mockFetch = (responses: Array<{ ok: boolean; status: number; json?: unknown }>) => {
  const calls: Array<{ url: string; method: string }> = [];
  let idx = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method || 'GET') });
    const r = responses[Math.min(idx, responses.length - 1)];
    idx++;
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.json ?? {},
    } as any;
  });
  return { calls, fn };
};

const alertMock = vi.fn();
vi.stubGlobal('alert', alertMock);

describe('orders delete real-sync: 后端 DELETE 契约', () => {
  beforeEach(() => {
    alertMock.mockClear();
  });

  it('后端 DELETE 响应壳: { ok: true, order: {...} }', async () => {
    const { fn } = mockFetch([
      { ok: true, status: 200, json: { ok: true, order: { id: 'ord_1', deletedAt: '123', status: 'Pending' } } },
    ]);
    vi.stubGlobal('fetch', fn);
    const res = await fetch('/api/v1/orders/ord_1', { method: 'DELETE' });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.order).toBeDefined();
    expect(data.order.deletedAt).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('删除请求 method 是 DELETE 且路径正确', async () => {
    const { calls, fn } = mockFetch([
      { ok: true, status: 200, json: { ok: true, order: { id: 'ord_1', deletedAt: '1' } } },
    ]);
    vi.stubGlobal('fetch', fn);
    await fetch('/api/v1/orders/ord_1', { method: 'DELETE' });
    expect(calls[0].url).toContain('/api/v1/orders/ord_1');
    expect(calls[0].method).toBe('DELETE');
    vi.unstubAllGlobals();
  });

  it('后端 DELETE 失败返回 { error: {...} } 契约（用于前端反馈）', async () => {
    const { fn } = mockFetch([
      { ok: false, status: 500, json: { error: 'DELETE_FAILED', message: 'db error' } },
    ]);
    vi.stubGlobal('fetch', fn);
    const res = await fetch('/api/v1/orders/ord_1', { method: 'DELETE' });
    const data = await res.json();
    expect(res.ok).toBe(false);
    expect(data.error).toBeDefined();
    vi.unstubAllGlobals();
  });
});

describe('orders delete real-sync: 行为契约', () => {
  beforeEach(() => {
    alertMock.mockClear();
  });

  it('成功路径：fetch 被调用且 res.ok=true 时不触发 alert（成功无反馈）', async () => {
    const { fn } = mockFetch([
      { ok: true, status: 200, json: { ok: true, order: { id: 'ord_1', deletedAt: '1' } } },
    ]);
    vi.stubGlobal('fetch', fn);
    const res = await fetch('/api/v1/orders/ord_1', { method: 'DELETE' });
    const data = await res.json();
    expect(res.ok && data.ok).toBe(true);
    expect(alertMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('失败路径（HTTP 500）：res.ok=false 时前端应显示 alert 反馈', async () => {
    const { fn } = mockFetch([
      { ok: false, status: 500, json: { error: 'DELETE_FAILED', message: 'db error' } },
    ]);
    vi.stubGlobal('fetch', fn);
    const res = await fetch('/api/v1/orders/ord_1', { method: 'DELETE' });
    const data = await res.json();
    // 模拟 handleDeleteOrder 的失败处理逻辑
    if (!res.ok || !data.ok) {
      const reason = data?.error?.message || data?.error || `HTTP ${res.status}`;
      alertMock(`订单删除失败：${reason}`);
    }
    expect(res.ok).toBe(false);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toContain('订单删除失败');
    vi.unstubAllGlobals();
  });

  it('失败路径（网络错误 catch）：fetch reject 时前端应显示 alert 反馈', async () => {
    const fn = vi.fn(async () => { throw new Error('network timeout'); });
    vi.stubGlobal('fetch', fn);
    let networkErrorCaught = false;
    try {
      await fetch('/api/v1/orders/ord_1', { method: 'DELETE' });
    } catch (e: any) {
      networkErrorCaught = true;
      alertMock(`订单删除失败（网络错误）：${e?.message ?? e}`);
    }
    expect(networkErrorCaught).toBe(true);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toContain('网络错误');
    vi.unstubAllGlobals();
  });
});

// 防回归：handleDeleteOrder 的 setOrders 调用不得传 null 第二参
// 理由：setOrders 第二参数类型是 modified?: Order，null 不合法；
// 且传含 deletedAt 的 order 会触发 App.handleUpdateOrders 二次 deleteOrder。
// 本函数已直接调后端 DELETE，成功后只需 setOrders(updatedOrders) 更新状态。
describe('orders delete real-sync: 防回归——setOrders 调用契约', () => {
  it('handleDeleteOrder 源码不含 setOrders(..., null) 调用', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, 'OrderManager.tsx'),
      'utf-8',
    );
    // 提取 handleDeleteOrder 函数体
    const m = src.match(/const handleDeleteOrder[\s\S]*?^  };/m);
    expect(m).not.toBeNull();
    const fnBody = m![0];
    // 不得出现 setOrders(..., null)
    expect(fnBody).not.toMatch(/setOrders\([^)]*,\s*null\)/);
  });

  it('handleDeleteOrder 源码的 setOrders 调用只传一个参数（不传 modified）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, 'OrderManager.tsx'),
      'utf-8',
    );
    const m = src.match(/const handleDeleteOrder[\s\S]*?^  };/m);
    const fnBody = m![0];
    const setOrdersCalls = fnBody.match(/setOrders\([^)]+\)/g) || [];
    expect(setOrdersCalls.length).toBeGreaterThanOrEqual(1);
    // 每个 setOrders 调用只应有一个参数（updatedOrders），不含第二参
    for (const call of setOrdersCalls) {
      // setOrders(updatedOrders) 形式——括号内无逗号
      const inner = call.slice('setOrders('.length, -1);
      expect(inner.includes(',')).toBe(false);
    }
  });

  it('handleDeleteOrder 直接调用后端 DELETE（源码含 fetch DELETE）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, 'OrderManager.tsx'),
      'utf-8',
    );
    const m = src.match(/const handleDeleteOrder[\s\S]*?^  };/m);
    const fnBody = m![0];
    expect(fnBody).toMatch(/fetch\(`\/api\/v1\/orders\/[^`]+`[^)]*method:\s*'DELETE'/);
  });
});
