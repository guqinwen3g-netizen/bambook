import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exceptionService } from '../services/exceptionService';
import { orderChangeService } from '../services/orderChangeService';
import { creditService } from '../services/creditService';
import { paymentRequestService } from '../services/paymentRequestService';
import { approvalKernelService } from '../services/approvalKernelService';
import { moqService } from '../services/moqService';
import { sampleService } from '../services/sampleService';
import { qcService } from '../services/qcService';

const fs = require('fs');
const path = require('path');

/**
 * G10 错误码透传守卫 — 8 个业务 service 的错误码传播契约断言。
 *
 * 契约（UI 门禁逻辑与内联错误展示共同依赖）：
 *   ① err.code === 服务端错误码（机器可读；门禁分支如 GATE_BLOCKED_CODE 判定依赖）
 *   ② err.message 含错误码前缀「CODE：message」（人可读；内联错误横幅直接展示 e.message）
 *   ③ err.status === HTTP 状态码
 *
 * 服务端两种信封都必须支持：
 *   - 平铺 { error: 'CODE', message }（exception / orderChange / credit / paymentRequest / approvalKernel / moq / internalTrade）
 *   - 嵌套 { error: { code, message } }（sample / qc）
 */

const ENDPOINT = 'https://test.example.com';

// ── 前端源码（静态防回退断言） ──
const SERVICE_SRC: Array<{ name: string; src: string }> = [
  'exceptionService',
  'orderChangeService',
  'creditService',
  'paymentRequestService',
  'approvalKernelService',
  'moqService',
  'sampleService',
  'qcService',
].map(name => ({
  name,
  src: fs.readFileSync(path.resolve(__dirname, `../services/${name}.ts`), 'utf-8'),
}));

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
}

/** 平铺信封 { error: 'CODE', message } */
function stubFlatError(status: number, code: string, message: string) {
  vi.stubGlobal('fetch', vi.fn(async (..._args: any[]) => ({
    ok: false,
    status,
    json: async () => ({ error: code, message }),
  })));
}

/** 嵌套信封 { error: { code, message } } */
function stubNestedError(status: number, code: string, message: string) {
  vi.stubGlobal('fetch', vi.fn(async (..._args: any[]) => ({
    ok: false,
    status,
    json: async () => ({ error: { code, message } }),
  })));
}

async function captureError(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e: any) {
    return e;
  }
  throw new Error('expected service call to reject, but it resolved');
}

// ═══ Part 1: 静态源码防回退（错误助手必须显式挂载 err.code / err.status） ═══
describe('runtime QA [G10]: 8 service 错误助手源码契约', () => {
  it('每个 service 的错误助手都把 code/status 挂载到抛出的 Error 上', () => {
    for (const { name, src } of SERVICE_SRC) {
      expect(src, `${name} 必须挂载 err.code`).toMatch(/\.code = code/);
      expect(src, `${name} 必须挂载 err.status`).toMatch(/\.status = res\.status/);
    }
  });

  it('错误消息带 CODE 前缀（内联展示可见错误码，非裸 message）', () => {
    for (const { name, src } of SERVICE_SRC) {
      expect(src, `${name} 消息必须含 CODE：前缀`).toContain('`${code}：');
    }
  });
});

// ═══ Part 2: 行为守卫（mock fetch 服务端信封 → 断言 code/message/status 透传） ═══
describe('runtime QA [G10]: 平铺信封 { error, message } 透传', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('exceptionService.listExceptions', async () => {
    stubFlatError(403, 'EXCEPTION_FORBIDDEN', '无例外链访问权限');
    const err = await captureError(() => exceptionService.listExceptions({}, ENDPOINT));
    expect(err.code).toBe('EXCEPTION_FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.message).toContain('EXCEPTION_FORBIDDEN');
    expect(err.message).toContain('无例外链访问权限');
  });

  it('orderChangeService.listChangeRequests', async () => {
    stubFlatError(400, 'MOQ_BELOW_MIN', '数量低于最小起订量');
    const err = await captureError(() => orderChangeService.listChangeRequests({ orderId: 'O1' }));
    expect(err.code).toBe('MOQ_BELOW_MIN');
    expect(err.status).toBe(400);
    expect(err.message).toContain('MOQ_BELOW_MIN');
    expect(err.message).toContain('数量低于最小起订量');
  });

  it('creditService.getCreditStatus', async () => {
    stubFlatError(409, 'CREDIT_FROZEN', '客户额度已冻结');
    const err = await captureError(() => creditService.getCreditStatus('C1', ENDPOINT));
    expect(err.code).toBe('CREDIT_FROZEN');
    expect(err.status).toBe(409);
    expect(err.message).toContain('CREDIT_FROZEN');
    expect(err.message).toContain('客户额度已冻结');
  });

  it('paymentRequestService.listPaymentRequests', async () => {
    stubFlatError(403, 'PAYMENT_REQUEST_FORBIDDEN', '无付款申请权限');
    const err = await captureError(() => paymentRequestService.listPaymentRequests(undefined, ENDPOINT));
    expect(err.code).toBe('PAYMENT_REQUEST_FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.message).toContain('PAYMENT_REQUEST_FORBIDDEN');
    expect(err.message).toContain('无付款申请权限');
  });

  it('approvalKernelService.listBusinessApprovals', async () => {
    stubFlatError(403, 'APPROVAL_FORBIDDEN', '无审批权限');
    const err = await captureError(() => approvalKernelService.listBusinessApprovals('pending', ENDPOINT));
    expect(err.code).toBe('APPROVAL_FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.message).toContain('APPROVAL_FORBIDDEN');
    expect(err.message).toContain('无审批权限');
  });

  it('moqService.getConfig', async () => {
    stubFlatError(403, 'SCOPE_DENIED', '缺少 settings:moq:read');
    const err = await captureError(() => moqService.getConfig(ENDPOINT));
    expect(err.code).toBe('SCOPE_DENIED');
    expect(err.status).toBe(403);
    expect(err.message).toContain('SCOPE_DENIED');
    expect(err.message).toContain('缺少 settings:moq:read');
  });
});

describe('runtime QA [G10]: 嵌套信封 { error: { code, message } } 透传', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('sampleService.listOrderSamples', async () => {
    stubNestedError(403, 'SAMPLE_FORBIDDEN', '无样品链访问权限');
    const err = await captureError(() => sampleService.listOrderSamples('O1', ENDPOINT));
    expect(err.code).toBe('SAMPLE_FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.message).toContain('SAMPLE_FORBIDDEN');
    expect(err.message).toContain('无样品链访问权限');
  });

  it('qcService.listOrderReports', async () => {
    stubNestedError(403, 'QC_FORBIDDEN', '无 QC 报告访问权限');
    const err = await captureError(() => qcService.listOrderReports('O1', ENDPOINT));
    expect(err.code).toBe('QC_FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.message).toContain('QC_FORBIDDEN');
    expect(err.message).toContain('无 QC 报告访问权限');
  });
});

// ═══ Part 3: 降级路径（非 JSON / 无码信封不裸奔，fallback 可读） ═══
describe('runtime QA [G10]: 降级路径', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('空响应体 → fallback 文案 + HTTP 状态码，不抛 TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async (..._args: any[]) => ({
      ok: false,
      status: 502,
      json: async () => { throw new Error('bad gateway html'); },
    })));
    const err = await captureError(() => moqService.getConfig(ENDPOINT));
    expect(err.message).toContain('502');
    expect(err.status).toBe(502);
    expect(err.code).toBeUndefined();
  });
});
