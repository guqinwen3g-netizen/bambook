/**
 * P1-3 客户专属面料规则测试（缺口 18 · owner fabric 行业铁律）
 *
 * 覆盖：
 *   1. resolveProductAssets 多键解析：sku/articleNo/millQuality/clientCode 并集 +
 *      clientCode 客户范围化（本客户 + 无绑定通用码；全局兜底开关）
 *   2. checkExclusivityForAssets：属主放行（relationId / 名称快照兜底）/ 他人违规 / 无专属放行
 *   3. assertFabricAllowed：fail-closed 409 EXCLUSIVE_FABRIC_BLOCKED + 违规尝试审计留痕；
 *      无产品锚放行；校验器故障 fail-open（不误杀业务）
 *   4. validateExclusiveCodes：专属行缺属主锚 → 报错
 *   5. productAssetIdOfFabricProfile：FabricProfile.id → ProductAsset.id 解析
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import {
  assertFabricAllowed,
  checkExclusivityForAssets,
  resolveProductAssets,
  validateExclusiveCodes,
  productAssetIdOfFabricProfile,
} from '../fabricExclusivityService';

function makeMockPrisma(seed: {
  assets?: any[];
  fabricProfiles?: any[];
  codes?: any[];
} = {}) {
  const assets = [...(seed.assets ?? [])];
  const fabricProfiles = [...(seed.fabricProfiles ?? [])];
  const codes = [...(seed.codes ?? [])];
  const auditLogs: any[] = [];

  const matchWhere = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const cond: any = v;
        if ('not' in cond) return cond.not === null ? row[k] !== null : row[k] !== cond.not;
        if ('in' in cond) return cond.in.includes(row[k]);
        if ('or' in cond) return (cond as any[]).some((sub: any) => matchWhere(row, sub));
        if (k === 'OR') return (v as any[]).some((sub: any) => matchWhere(row, sub));
        return true;
      }
      return row[k] === v;
    });

  return {
    productAsset: {
      findMany: vi.fn(async ({ where }: any = {}) => assets.filter(a => matchWhere(a, where))),
    },
    fabricProfile: {
      findMany: vi.fn(async ({ where }: any = {}) => fabricProfiles.filter(f => matchWhere(f, where))),
      findFirst: vi.fn(async ({ where }: any = {}) => fabricProfiles.find(f => f.id === where?.id) ?? null),
    },
    fabricCustomerCode: {
      findMany: vi.fn(async ({ where }: any = {}) => codes.filter(c => matchWhere(c, where))),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => { auditLogs.push(data); return data; }),
    },
    _stores: { assets, fabricProfiles, codes, auditLogs },
  } as any;
}

const ASSET_X = { id: 'PA__X', sku: 'FAB-X', name: '独家开发面料 X', deletedAt: null };
const ASSET_Y = { id: 'PA__Y', sku: 'FAB-Y', name: '普通面料 Y', deletedAt: null };
/** 面料 X 客户 A 专属登记（客供品号 A-100） */
const EXCLUSIVE_A = { id: 'FCC-1', productAssetId: 'PA__X', clientCode: 'A-100', customerOrganizationId: 'REL-A', customerNameSnapshot: '客户A', isExclusive: true, deletedAt: null };
const PLAIN_B = { id: 'FCC-2', productAssetId: 'PA__Y', clientCode: 'B-200', customerOrganizationId: 'REL-B', customerNameSnapshot: '客户B', isExclusive: false, deletedAt: null };

beforeEach(() => { vi.clearAllMocks(); });

describe('resolveProductAssets 多键解析', () => {
  it('sku / articleNo / millQuality / clientCode 并集解析', async () => {
    const prisma = makeMockPrisma({
      assets: [ASSET_X, ASSET_Y],
      fabricProfiles: [
        { id: 'FP-X', productAssetId: 'PA__X', articleNo: 'ART-X', millQuality: 'MQ-X', deletedAt: null },
      ],
      codes: [EXCLUSIVE_A, PLAIN_B],
    });
    const r = await resolveProductAssets(prisma, { sku: 'FAB-X' });
    expect(r.map(a => a.id)).toEqual(['PA__X']);

    const r2 = await resolveProductAssets(prisma, { millQuality: 'MQ-X' });
    expect(r2.map(a => a.id)).toEqual(['PA__X']);

    const r3 = await resolveProductAssets(prisma, { clientCode: 'A-100' });
    expect(r3.map(a => a.id)).toEqual(['PA__X']);

    const r4 = await resolveProductAssets(prisma, { productAssetId: 'PA__Y' });
    expect(r4.map(a => a.id)).toEqual(['PA__Y']);
  });

  it('clientCode 客户范围化：hint 命中（本客户/无绑定）→ 不做全局兜底；无 hint → 全局', async () => {
    const prisma = makeMockPrisma({ assets: [ASSET_X], codes: [EXCLUSIVE_A] });
    // hint = REL-B（客户B）：范围化查「REL-B 登记 + 无绑定」→ 无命中 → globalFallback=false 不兜底
    const r = await resolveProductAssets(prisma, { clientCode: 'A-100', clientCodeCustomerHint: 'REL-B', clientCodeGlobalFallback: false });
    expect(r).toHaveLength(0);
    // 无 hint：全局解析命中
    const r2 = await resolveProductAssets(prisma, { clientCode: 'A-100' });
    expect(r2.map(a => a.id)).toEqual(['PA__X']);
    // hint 命中属主本人（REL-A 登记的码）
    const r3 = await resolveProductAssets(prisma, { clientCode: 'A-100', clientCodeCustomerHint: 'REL-A' });
    expect(r3.map(a => a.id)).toEqual(['PA__X']);
  });
});

describe('checkExclusivityForAssets 属主匹配', () => {
  const prisma = () => makeMockPrisma({ assets: [ASSET_X, ASSET_Y], codes: [EXCLUSIVE_A, PLAIN_B] });

  it('属主客户（relationId 命中）→ 无违规', async () => {
    const violations = await checkExclusivityForAssets(prisma(), ['PA__X'], { customerRelationId: 'REL-A', customerName: null });
    expect(violations).toHaveLength(0);
  });

  it('属主客户（名称快照兜底命中）→ 无违规', async () => {
    const violations = await checkExclusivityForAssets(prisma(), ['PA__X'], { customerRelationId: null, customerName: '客户A' });
    expect(violations).toHaveLength(0);
  });

  it('他人客户 → 违规（含面料名/属主/客供品号）', async () => {
    const violations = await checkExclusivityForAssets(prisma(), ['PA__X'], { customerRelationId: 'REL-B', customerName: '客户B' });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      productAssetId: 'PA__X',
      sku: 'FAB-X',
      productName: '独家开发面料 X',
      ownerCustomerName: '客户A',
      ownerRelationId: 'REL-A',
      clientCode: 'A-100',
    });
  });

  it('无专属登记的产品 → 放行', async () => {
    const violations = await checkExclusivityForAssets(prisma(), ['PA__Y'], { customerRelationId: 'REL-A', customerName: null });
    expect(violations).toHaveLength(0);
  });
});

describe('assertFabricAllowed fail-closed 断言', () => {
  it('他人客户 → 409 EXCLUSIVE_FABRIC_BLOCKED + 违规尝试审计留痕', async () => {
    const p = makeMockPrisma({ assets: [ASSET_X], codes: [EXCLUSIVE_A] });
    const r = await assertFabricAllowed(p, {
      customer: { customerRelationId: 'REL-B', customerName: '客户B' },
      productKeys: { clientCode: 'A-100', clientCodeCustomerHint: 'REL-B' },
      context: 'order-line:create',
      actorId: 'user-1',
      documentRef: { orderId: 'ORD-1' },
    });
    expect(r.ok).toBe(false);
    expect((r as any).error.code).toBe('EXCLUSIVE_FABRIC_BLOCKED');
    expect((r as any).error.status).toBe(409);
    expect((r as any).error.message).toContain('独家开发面料 X');
    expect((r as any).error.message).toContain('客户A');
    // 违规尝试留痕（fail-closed 前置审计）
    const log = p._stores.auditLogs[0];
    expect(log.action).toBe('exclusive_fabric_violation_attempt');
    expect(log.detail.source).toBe('fabric-exclusivity:order-line:create');
    expect(log.detail.after.violations[0].productAssetId).toBe('PA__X');
  });

  it('属主客户 → 放行；无产品锚 → 放行（checked 0）', async () => {
    const p = makeMockPrisma({ assets: [ASSET_X], codes: [EXCLUSIVE_A] });
    const owner = await assertFabricAllowed(p, {
      customer: { customerRelationId: 'REL-A', customerName: null },
      productKeys: { clientCode: 'A-100' },
      context: 'order-line:create',
    });
    expect(owner.ok).toBe(true);
    expect((owner as any).data.checked).toBe(1);

    const noAnchor = await assertFabricAllowed(p, {
      customer: { customerRelationId: 'REL-B', customerName: null },
      productKeys: {},
      context: 'order-line:create',
    });
    expect(noAnchor.ok).toBe(true);
    expect((noAnchor as any).data.checked).toBe(0);
  });

  it('校验器故障（模型缺失等）→ fail-open 不阻断业务（错误已记录）', async () => {
    const broken: any = { productAsset: {}, fabricProfile: {}, fabricCustomerCode: {} }; // findMany 缺失 → TypeError
    const r = await assertFabricAllowed(broken, {
      customer: { customerRelationId: 'REL-B', customerName: '客户B' },
      productKeys: { clientCode: 'A-100' },
      context: 'order-line:create',
    });
    expect(r.ok).toBe(true);
  });
});

describe('validateExclusiveCodes 专属标记维护校验', () => {
  it('专属行缺属主锚 → 报错；有锚 → null', () => {
    expect(validateExclusiveCodes([{ isExclusive: true, clientCode: 'A-100' }])).toContain('必须绑定属主客户');
    expect(validateExclusiveCodes([{ isExclusive: true, clientCode: 'A-100', customerOrganizationId: 'REL-A' }])).toBeNull();
    expect(validateExclusiveCodes([{ isExclusive: true, clientCode: 'A-100', customerNameSnapshot: '客户A' }])).toBeNull();
    expect(validateExclusiveCodes([{ isExclusive: false, clientCode: 'B-200' }])).toBeNull();
  });
});

describe('productAssetIdOfFabricProfile 样品链直锚解析', () => {
  it('FabricProfile.id → productAssetId；未命中 → null', async () => {
    const p = makeMockPrisma({ fabricProfiles: [{ id: 'FP-X', productAssetId: 'PA__X', deletedAt: null }] });
    expect(await productAssetIdOfFabricProfile(p, 'FP-X')).toBe('PA__X');
    expect(await productAssetIdOfFabricProfile(p, 'FP-MISSING')).toBeNull();
    expect(await productAssetIdOfFabricProfile(p, null)).toBeNull();
  });
});
