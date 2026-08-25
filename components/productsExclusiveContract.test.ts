/**
 * P1-3 客户专属面料规则 — 前端契约测试
 *
 * 覆盖：
 *   1. apiService.checkFabricExclusivity（fetch mock）：POST /v1/products/fabric-exclusivity/check
 *   2. ProductsManager 源码契约：专属属主客户表单字段 / 保存合并专属行 / 档案详情专属标识
 *   3. types 契约：FabricCustomerCode.isExclusive + FabricExclusivityViolation
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiService } from '../services/apiService';

const ENDPOINT = 'https://test.example.com';
const productsManagerSource = readFileSync(new URL('./ProductsManager.tsx', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../types.ts', import.meta.url), 'utf8');

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
}

describe('apiService P1-3 专属面料预检（fetch mock）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('checkFabricExclusivity POST body（客户 + 面料键）→ allowed/violations', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({
        ok: true, allowed: false,
        violations: [{ productAssetId: 'PA__X', sku: 'FAB-X', productName: '独家开发面料 X', ownerCustomerName: '客户A', ownerRelationId: 'REL-A', clientCode: 'A-100' }],
        matchedAssets: [{ id: 'PA__X', sku: 'FAB-X', name: '独家开发面料 X' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await apiService.checkFabricExclusivity({
      customerRelationId: 'REL-B', customerName: '客户B', fabricCode: 'A-100',
    }, ENDPOINT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/products/fabric-exclusivity/check');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      customerRelationId: 'REL-B', customerName: '客户B', fabricCode: 'A-100',
    });
    expect(r.allowed).toBe(false);
    expect(r.violations[0].ownerCustomerName).toBe('客户A');
  });

  it('allowed=true 且无 violations 字段 → 默认放行空清单', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      ok: true,
      json: async () => ({ ok: true, allowed: true, matchedAssets: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await apiService.checkFabricExclusivity({ customerRelationId: 'REL-A', clientCode: 'A-100' }, ENDPOINT);
    expect(r.allowed).toBe(true);
    expect(r.violations).toEqual([]);
  });
});

describe('ProductsManager P1-3（源码契约）', () => {
  it('面料表单：专属属主客户（RelationCombobox）+ 专属客供品号 + 规则说明', () => {
    expect(productsManagerSource).toContain('fkName="exclusiveOwnerRelationId"');
    expect(productsManagerSource).toContain('name="exclusiveOwnerName"');
    expect(productsManagerSource).toContain('name="exclusiveClientCode"');
    expect(productsManagerSource).toContain('专属属主客户（出资开发独占）');
    expect(productsManagerSource).toContain("filterCategories={['Customer']}");
    expect(productsManagerSource).toContain('EXCLUSIVE_FABRIC_BLOCKED');
  });

  it('保存合并专属行：属主客户非空 → isExclusive 行（保留既有行 id 稳定替换）', () => {
    expect(productsManagerSource).toContain("formData.get('exclusiveOwnerRelationId')");
    expect(productsManagerSource).toContain('hasExclusiveOwner');
    expect(productsManagerSource).toContain('`FCC-${productId}-EXCL`');
    expect(productsManagerSource).toContain('isExclusive: true');
    // 专属行客供品号去重（同码不双行）
    expect(productsManagerSource).toContain('plainClientCodes');
  });

  it('档案详情：专属面料标识（属主 + 客供品号 + 阻断说明徽章）', () => {
    expect(productsManagerSource).toContain('专属面料</span>');
    expect(productsManagerSource).toContain('属主 {ownerLabel}');
    expect(productsManagerSource).toContain('引用将被系统阻断');
  });
});

describe('types P1-3 契约', () => {
  it('FabricCustomerCode.isExclusive + FabricExclusivityViolation', () => {
    expect(typesSource).toContain('isExclusive?: boolean;');
    expect(typesSource).toContain('export interface FabricExclusivityViolation {');
    expect(typesSource).toContain('ownerCustomerName: string | null;');
  });
});
