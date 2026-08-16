import { beforeEach, describe, expect, it, vi } from 'vitest';
import { approvalKernelService, isFallbackRoute, RESOLVER_ROUTE_LABEL } from './approvalKernelService';

const ENDPOINT = 'https://test.example.com';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
}

describe('approvalKernelService（DR-007 审批内核 contract）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('listBusinessApprovals GET /v1/approvals?status=pending 并返回 items', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ items: [{ id: 'APR__1', status: 'pending' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await approvalKernelService.listBusinessApprovals('pending', ENDPOINT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/approvals?status=pending');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('APR__1');
  });

  it('getResolutionTrace GET /v1/approvals-kernel/:id/resolution-trace（id 编码）', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({
        item: {
          id: 'APR__1',
          reviewerResolverRoute: 'FALLBACK_ADMIN',
          departmentSnapshotId: 'DEPT_NONE',
          reviewerId: 'USR_admin',
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const trace = await approvalKernelService.getResolutionTrace('APR__1', ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/approvals-kernel/APR__1/resolution-trace');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(trace.reviewerResolverRoute).toBe('FALLBACK_ADMIN');
  });

  it('delegateApproval POST /delegate 携带 toUserId + reason', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ item: { id: 'APR__1', reviewerId: 'USR_delegate', delegatedBy: 'USR_head' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await approvalKernelService.delegateApproval('APR__1', { toUserId: 'USR_delegate', reason: '出差十天，转派给同部门同事跟进' }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/approvals-kernel/APR__1/delegate');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ toUserId: 'USR_delegate', reason: '出差十天，转派给同部门同事跟进' });
  });

  it('delegateApproval 透出服务端 403 DELEGATION_NOT_BY_REVIEWER', async () => {
    vi.stubGlobal('fetch', vi.fn(async (..._args: any[]) => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'DELEGATION_NOT_BY_REVIEWER：仅当前审批人本人可发起转派' }),
    })));

    await expect(
      approvalKernelService.delegateApproval('APR__1', { toUserId: 'USR_x', reason: '超过十个字的委派理由' }, ENDPOINT),
    ).rejects.toThrow('DELEGATION_NOT_BY_REVIEWER');
  });

  it('bossBypassApproval POST /boss-bypass 携带 reason（≥30 字由服务端强制）', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ item: { id: 'APR__1', status: 'approved', bossFinalBypassBy: 'USR_boss' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const reason = '客户生产线停线待料，风险已评估并由我承担最终责任，特批放行';
    const item = await approvalKernelService.bossBypassApproval('APR__1', reason, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/approvals-kernel/APR__1/boss-bypass');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ reason });
    expect(item.bossFinalBypassBy).toBe('USR_boss');
  });

  it('bossBypassApproval 透出 403 BOSS_BYPASS_REQUIRES_OWNER', async () => {
    vi.stubGlobal('fetch', vi.fn(async (..._args: any[]) => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'BOSS_BYPASS_REQUIRES_OWNER：仅超级管理员（BOSS）可最终兜底特批' }),
    })));

    await expect(
      approvalKernelService.bossBypassApproval('APR__1', 'x'.repeat(30), ENDPOINT),
    ).rejects.toThrow('BOSS_BYPASS_REQUIRES_OWNER');
  });

  it('isFallbackRoute：DEPT_HEAD 不算兜底，FALLBACK_* 算兜底', () => {
    expect(isFallbackRoute('DEPT_HEAD')).toBe(false);
    expect(isFallbackRoute('FALLBACK_ADMIN')).toBe(true);
    expect(isFallbackRoute('FALLBACK_DEPT_HEAD_VACANT')).toBe(true);
    expect(isFallbackRoute('FALLBACK_SELF_APPLY_SUPERVISOR')).toBe(true);
    expect(isFallbackRoute(null)).toBe(false);
  });

  it('RESOLVER_ROUTE_LABEL 覆盖全部四条 DR-007 路径', () => {
    expect(Object.keys(RESOLVER_ROUTE_LABEL).sort()).toEqual([
      'DEPT_HEAD',
      'FALLBACK_ADMIN',
      'FALLBACK_DEPT_HEAD_VACANT',
      'FALLBACK_SELF_APPLY_SUPERVISOR',
    ]);
  });

  it('decideApproval POST /v1/approvals/:id/decide（驳回附 decisionNote）', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ item: { id: 'APR__1', status: 'rejected' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await approvalKernelService.decideApproval('APR__1', 'rejected', '偏差过大不接受', ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/approvals/APR__1/decide');
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'rejected', decisionNote: '偏差过大不接受' });
  });
});
