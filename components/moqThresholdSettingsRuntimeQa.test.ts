import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moqService } from '../services/moqService';

/**
 * Phase 3 Wave 3.1 Track A — Settings MOQ 阈值配置台 runtime QA
 *
 * 消费已 merged /api/v1/moq/* contract（server/src/moq/moqRoute.ts）：
 *   GET /config · PUT /config · GET /history · POST /validate（dry-run）
 *
 * Part 1: moqService 运行时契约（mock fetch，对齐 fxSettlementService.test.ts 模式）
 * Part 2: AdminPanel 平台规则 Tab 源码契约（MoqThresholdsPanel 接线）
 * Part 3: 设计纪律（无 hex / rounded-[Npx] / box-shadow / 过重字重）
 */

const fs = require('fs');
const path = require('path');
const PANEL_SRC = fs.readFileSync(path.resolve(__dirname, 'admin/MoqThresholdsPanel.tsx'), 'utf-8');
const ADMIN_PANEL_SRC = fs.readFileSync(path.resolve(__dirname, 'AdminPanel.tsx'), 'utf-8');
const SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../services/moqService.ts'), 'utf-8');

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

const ACTIVE_ITEM = {
  id: 'MOQCFG__active1',
  fabricDefaultMoq: 800,
  garmentDefaultMoq: 200,
  capsuleMoq: 20,
  isActive: true,
  effectiveFrom: '2026-08-01T00:00:00.000Z',
  effectiveTo: null,
  changedBy: 'usr_admin',
  changeReason: '首次初始化种子值',
};

// ═══ Part 1: moqService runtime（mock fetch） ═══
describe('runtime QA [moqService]: HTTP contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('getConfig GET /v1/moq/config → item + fallback=null', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ item: ACTIVE_ITEM, fallback: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await moqService.getConfig(ENDPOINT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/moq/config');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(res.item?.fabricDefaultMoq).toBe(800);
    expect(res.fallback).toBeNull();
  });

  it('getConfig 无 active → item=null + fallback 兜底常量透出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        item: null,
        fallback: { fabricDefaultMoq: 800, garmentDefaultMoq: 200, capsuleMoq: 20 },
        message: 'MOQ 配置未初始化或加载失败，当前展示兜底常量（请联系管理员）',
      }),
    })));

    const res = await moqService.getConfig(ENDPOINT);
    expect(res.item).toBeNull();
    expect(res.fallback).toEqual({ fabricDefaultMoq: 800, garmentDefaultMoq: 200, capsuleMoq: 20 });
    expect(res.message).toContain('兜底常量');
  });

  it('updateConfig PUT /v1/moq/config，body 含三阈值 + changeReason', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ item: { ...ACTIVE_ITEM, fabricDefaultMoq: 900 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const input = { fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '旺季产能调整阈值' };
    const item = await moqService.updateConfig(input, ENDPOINT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/moq/config');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(item.fabricDefaultMoq).toBe(900);
  });

  it('updateConfig 403 SCOPE_DENIED → 透出服务端 message（不伪成功）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'SCOPE_DENIED', message: 'INSUFFICIENT_SCOPE settings:moq:write（仅系统管理员/超级管理员可调 MOQ 阈值）' }),
    })));

    await expect(
      moqService.updateConfig({ fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '旺季产能调整阈值' }, ENDPOINT),
    ).rejects.toThrow('INSUFFICIENT_SCOPE settings:moq:write');
  });

  it('updateConfig 400 MOQ_INVALID_REASON → 透出原因（changeReason <5 字 fail-closed）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'MOQ_INVALID_REASON', message: 'changeReason 至少 5 字（审计强制，fail-closed）' }),
    })));

    await expect(
      moqService.updateConfig({ fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '短' }, ENDPOINT),
    ).rejects.toThrow('changeReason 至少 5 字');
  });

  it('listHistory GET /v1/moq/history?limit=N → items 数组', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        items: [{
          id: 'MOQHIST__1', configId: 'MOQCFG__active1',
          beforeFabricDefaultMoq: 800, beforeGarmentDefaultMoq: 200, beforeCapsuleMoq: 20,
          afterFabricDefaultMoq: 900, afterGarmentDefaultMoq: 210, afterCapsuleMoq: 21,
          changedBy: 'usr_admin', changeReason: '旺季产能调整阈值', changedAt: '2026-08-10T08:00:00.000Z',
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await moqService.listHistory(50, ENDPOINT);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/moq/history');
    expect(url).toContain('limit=50');
    expect(items).toHaveLength(1);
    expect(items[0].afterFabricDefaultMoq).toBe(900);
  });

  it('validateDryRun POST /v1/moq/validate，body 带 snapshot + capsuleExemption + lines（dry-run 不建审批单）', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        ok: false,
        capsuleActive: true,
        lines: [{
          lineIndex: 0, quantity: 20, unit: '件', effectiveMoq: 21,
          source: 'capsule_exemption', capsuleActive: true, compliant: false,
          gapPct: 4.8, severity: 'low', badge: 'yellow', requiresApproval: true,
        }],
        blockedLineIndexes: [0],
        snapshot: { fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, snapshotAt: '', configId: null, source: 'moq_config' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await moqService.validateDryRun({
      businessLine: 'garment',
      capsuleExemption: true,
      snapshot: { fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21 },
      lines: [{ quantity: 20, unit: '件' }],
    }, ENDPOINT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/moq/validate');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.snapshot).toEqual({ fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21 });
    expect(body.capsuleExemption).toBe(true);
    expect(body.lines).toEqual([{ quantity: 20, unit: '件' }]);
    expect(result.ok).toBe(false);
    expect(result.lines[0].effectiveMoq).toBe(21);
    expect(result.blockedLineIndexes).toEqual([0]);
  });

  it('validateDryRun 400 → 透出 MOQ_INVALID_VALUE message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'MOQ_INVALID_VALUE', message: 'lines 必填且至少 1 行' }),
    })));

    await expect(moqService.validateDryRun({ lines: [] }, ENDPOINT)).rejects.toThrow('lines 必填且至少 1 行');
  });
});

// ═══ Part 2: UI 源码契约 ═══
describe('runtime QA [moqService 源码]: 端点与方法齐备', () => {
  it('封装 4 个端点（config GET/PUT · history · validate）', () => {
    expect(SERVICE_SRC).toContain("'/v1/moq/config'");
    expect(SERVICE_SRC).toContain("'/v1/moq/history'");
    expect(SERVICE_SRC).toContain("'/v1/moq/validate'");
    expect(SERVICE_SRC).toContain("method: 'PUT'");
    expect(SERVICE_SRC).toContain("method: 'POST'");
  });
  it('错误透出优先服务端 message（{ error, message } 契约）', () => {
    expect(SERVICE_SRC).toMatch(/err\?\.message/);
    expect(SERVICE_SRC).toMatch(/err\?\.error/);
  });
});

describe('runtime QA [AdminPanel 接线]: 平台规则 Tab 注册', () => {
  it('TabId 含 platform-rules 且 TABS 注册中英双语标签', () => {
    expect(ADMIN_PANEL_SRC).toMatch(/'platform-rules'/);
    expect(ADMIN_PANEL_SRC).toMatch(/label: '平台规则'/);
  });
  it('activeTab === platform-rules 渲染 PlatformRulesSection', () => {
    expect(ADMIN_PANEL_SRC).toContain('PlatformRulesSection');
    expect(ADMIN_PANEL_SRC).toMatch(/activeTab === 'platform-rules'/);
  });
});

describe('runtime QA [面板]: 权限门 + 三态 + dry-run', () => {
  it('hasPermission(settings:moq:write) 门控编辑表单（其他人只读）', () => {
    expect(PANEL_SRC).toContain("hasPermission('settings:moq:write')");
    expect(PANEL_SRC).toMatch(/canWrite && loadState === 'ready'/);
    expect(PANEL_SRC).toMatch(/!canWrite && loadState === 'ready'/);
  });
  it('changeReason 前端校验 ≥5 字（与后端 fail-closed 对齐）', () => {
    expect(PANEL_SRC).toContain('CHANGE_REASON_MIN = 5');
    expect(PANEL_SRC).toMatch(/reasonInput\.trim\(\)\.length >= CHANGE_REASON_MIN/);
  });
  it('保存前 dry-run：validateDryRun 带拟变更 snapshot + capsuleExemption 探针', () => {
    expect(PANEL_SRC).toContain('moqService.validateDryRun');
    expect(PANEL_SRC).toContain("capsuleExemption: probe.key === 'capsule'");
    expect(PANEL_SRC).toMatch(/snapshot = \{\s*fabricDefaultMoq: parsed\.fabric/);
  });
  it('保存成功后 reload config + history（不伪造本地状态）', () => {
    expect(PANEL_SRC).toContain('moqService.updateConfig');
    expect(PANEL_SRC).toMatch(/await Promise\.all\(\[loadConfig\(\), loadHistory\(\)\]\)/);
  });
  it('loading / error / empty 三态齐全（无占位符假数据）', () => {
    expect(PANEL_SRC).toContain("setLoadState('loading')");
    expect(PANEL_SRC).toContain("setLoadState('error')");
    expect(PANEL_SRC).toContain('正在读取 MOQ 配置');
    expect(PANEL_SRC).toContain('暂无变更记录');
    expect(PANEL_SRC).toContain('重试');
  });
  it('历史时间线展示 before→after 三档值 + changedBy + changeReason + changedAt', () => {
    expect(PANEL_SRC).toContain('beforeFabricDefaultMoq');
    expect(PANEL_SRC).toContain('afterFabricDefaultMoq');
    expect(PANEL_SRC).toContain('beforeGarmentDefaultMoq');
    expect(PANEL_SRC).toContain('afterGarmentDefaultMoq');
    expect(PANEL_SRC).toContain('beforeCapsuleMoq');
    expect(PANEL_SRC).toContain('afterCapsuleMoq');
    expect(PANEL_SRC).toContain('item.changedBy');
    expect(PANEL_SRC).toContain('item.changeReason');
    expect(PANEL_SRC).toContain('item.changedAt');
  });
  it('fallback 兜底常量场景展示服务端 message（A5）', () => {
    expect(PANEL_SRC).toContain('fallbackMessage');
    expect(PANEL_SRC).toContain('config ?? fallback');
  });
});

// ═══ Part 3: 设计纪律（防回退） ═══
describe('runtime QA [设计纪律]: 面板无硬编码', () => {
  it('无 hex 颜色 / rounded-[Npx] / box-shadow / 过重字重', () => {
    expect(PANEL_SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(PANEL_SRC).not.toMatch(/rounded-\[[0-9]+px\]/);
    expect(PANEL_SRC).not.toMatch(/box-shadow:/);
    expect(PANEL_SRC).not.toMatch(/font-(medium|semibold|bold)\b/);
  });
  it('无 emoji（UI 纪律）', () => {
    // eslint-disable-next-line no-control-regex
    expect(PANEL_SRC).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
