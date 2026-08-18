/**
 * systemConfigRoute HTTP 契约验收（公司档案与配置.md §1A，2026-08-18 裁决）
 *   - GET  /api/v1/config/company.exporterProfile         全登录可读；无配置 → 200 默认值 + isDefault:true（不落库）
 *   - PUT  /api/v1/config/company.exporterProfile         仅 owner/admin（SUPER_ADMIN/ADMIN legacy）
 *                                                       银行四字段变更且 reason 空 → 400 REASON_REQUIRED
 *                                                       nameEn 缺失/非 string → 400 VALIDATION_FAILED
 *                                                       成功 → 200 + 新 version + SystemConfigHistory 落库
 *   - GET  /api/v1/config/company.exporterProfile/history 仅 owner/admin；createdAt 倒序
 *   - seed 幂等：global::company.exporterProfile 已存在 → 不覆盖；缺失 → 写入前端同款默认值
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  createSystemConfigRouter,
  DEFAULT_EXPORTER_PROFILE,
  EXPORTER_PROFILE_CONFIG_ID,
  EXPORTER_PROFILE_CONFIG_KEY,
} from '../systemConfigRoute';
import { createSystemConfigService } from '../systemConfigService';
import { seedSystemConfigs } from '../../../scripts/seed-systemconfig';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const adminToken = jwt.sign({ userId: 'u_admin', roles: ['admin'], permissions: [], departmentIds: [] }, SECRET);
const ownerToken = jwt.sign({ userId: 'u_owner', roles: ['owner'], permissions: [], departmentIds: [] }, SECRET);
const viewerToken = jwt.sign({ userId: 'u_viewer', roles: ['viewer'], permissions: [], departmentIds: [] }, SECRET);
const merchandiserToken = jwt.sign({ userId: 'u_merch', roles: ['merchandiser'], permissions: [], departmentIds: [] }, SECRET);
const salesToken = jwt.sign({ userId: 'u_sales', roles: ['sales'], permissions: [], departmentIds: [] }, SECRET);

/** 库中已存在的配置行（valueType=json，value 为 JSON 字符串——与 systemConfigService.set 的实际存储一致） */
function makeConfigRow(overrides: any = {}) {
  return {
    id: EXPORTER_PROFILE_CONFIG_ID,
    scope: 'global',
    key: EXPORTER_PROFILE_CONFIG_KEY,
    group: 'company',
    label: '出口方档案（单据抬头/收款账户）',
    valueType: 'json',
    value: JSON.stringify(DEFAULT_EXPORTER_PROFILE),
    encrypted: false,
    version: 2,
    description: null,
    meta: null,
    updatedBy: 'u_admin',
    auditReason: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: BigInt(0),
    ...overrides,
  };
}

function makeApp(opts: { configRow?: any } = {}) {
  const configRow = opts.configRow === undefined ? makeConfigRow() : opts.configRow;
  const historyCreates: any[] = [];
  const upsertCalls: any[] = [];

  const prisma: any = {
    systemConfig: {
      findUnique: vi.fn().mockImplementation(async () => configRow),
      upsert: vi.fn().mockImplementation(async ({ create, update }: any) => {
        upsertCalls.push({ create, update });
        return { ...makeConfigRow(), ...create, ...update, createdAt: new Date('2026-08-01T00:00:00Z') };
      }),
    },
    systemConfigHistory: {
      create: vi.fn().mockImplementation(async ({ data }: any) => { historyCreates.push(data); return { id: 'SCH_1', ...data }; }),
      findMany: vi.fn().mockResolvedValue([
        { id: 'SCH_2', configId: EXPORTER_PROFILE_CONFIG_ID, versionFrom: 2, versionTo: 3, valueFrom: { nameEn: 'A' }, valueTo: { nameEn: 'B' }, actorId: 'u_admin', reason: '更新 USD 账号', sensitiveMasked: false, createdAt: new Date('2026-08-18T02:00:00Z') },
        { id: 'SCH_1', configId: EXPORTER_PROFILE_CONFIG_ID, versionFrom: 1, versionTo: 2, valueFrom: null, valueTo: { nameEn: 'A' }, actorId: 'u_admin', reason: null, sensitiveMasked: false, createdAt: new Date('2026-08-15T01:00:00Z') },
      ]),
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/config', createSystemConfigRouter({
    prisma,
    requireAuth: true,
    configService: createSystemConfigService(prisma),
  }));
  return { app, prisma, historyCreates, upsertCalls };
}

describe('GET /company.exporterProfile（全登录可读）', () => {
  it('无配置 → 200 默认值 + isDefault:true（不落库）', async () => {
    const { app, prisma } = makeApp({ configRow: null });
    const res = await request(app).get(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    expect(res.body.version).toBe(0);
    expect(res.body.value).toEqual(DEFAULT_EXPORTER_PROFILE);
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('有配置 → 200 库值 + isDefault:false + version', async () => {
    const stored = { ...DEFAULT_EXPORTER_PROFILE, nameEn: 'CUSTOM CO.,LTD.' };
    const { app } = makeApp({ configRow: makeConfigRow({ value: JSON.stringify(stored), version: 5 }) });
    const res = await request(app).get(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`).set('Authorization', `Bearer ${salesToken}`);
    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(false);
    expect(res.body.version).toBe(5);
    expect(res.body.value.nameEn).toBe('CUSTOM CO.,LTD.');
    expect(res.body.value.swiftCode).toBe(DEFAULT_EXPORTER_PROFILE.swiftCode);
  });

  it('未登录 → 401 UNAUTHORIZED', async () => {
    const { app } = makeApp();
    const res = await request(app).get(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });
});

describe('PUT /company.exporterProfile（RBAC：仅 SUPER_ADMIN/ADMIN）', () => {
  const validBody = { value: { ...DEFAULT_EXPORTER_PROFILE, nameEn: 'RENAMED CO.,LTD.' } };

  it('未登录 → 401 UNAUTHORIZED', async () => {
    const { app } = makeApp();
    const res = await request(app).put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`).send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it.each([
    ['viewer', viewerToken],
    ['merchandiser', merchandiserToken],
    ['sales', salesToken],
  ])('角色 %s → 403 FORBIDDEN', async (_role, token) => {
    const { app, prisma } = makeApp();
    const res = await request(app).put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`).set('Authorization', `Bearer ${token}`).send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('ADMIN 成功 → 200 + 新 version + SystemConfigHistory 落库（versionFrom/To + actorId + reason）', async () => {
    const { app, historyCreates } = makeApp();
    const res = await request(app)
      .put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: { ...DEFAULT_EXPORTER_PROFILE, bankName: 'BANK OF CHINA SUZHOU BRANCH' }, reason: '更新收款银行' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe(3); // 既有 version=2 → +1
    expect(res.body.value.bankName).toBe('BANK OF CHINA SUZHOU BRANCH');
    expect(historyCreates).toHaveLength(1);
    expect(historyCreates[0]).toMatchObject({
      configId: EXPORTER_PROFILE_CONFIG_ID,
      versionFrom: 2,
      versionTo: 3,
      actorId: 'u_admin',
      reason: '更新收款银行',
      sensitiveMasked: false,
    });
  });

  it('OWNER（SUPER_ADMIN legacy）成功 → 200', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validBody);
    expect(res.status).toBe(200);
  });

  it('银行字段变更（swiftCode）无 reason → 400 REASON_REQUIRED，不写库', async () => {
    const { app, prisma } = makeApp();
    const res = await request(app)
      .put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: { ...DEFAULT_EXPORTER_PROFILE, swiftCode: 'BKCHCNBJ999' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('REASON_REQUIRED');
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('银行字段变更 + reason → 200', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: { ...DEFAULT_EXPORTER_PROFILE, usdAccountNumber: '467668199999' }, reason: '更换美元账户' });
    expect(res.status).toBe(200);
    expect(res.body.value.usdAccountNumber).toBe('467668199999');
  });

  it('仅 nameEn 变更（无 reason）→ 200', async () => {
    const { app, historyCreates } = makeApp();
    const res = await request(app)
      .put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.value.nameEn).toBe('RENAMED CO.,LTD.');
    expect(historyCreates[0].reason).toBeNull();
  });

  it('nameEn 缺失 → 400 VALIDATION_FAILED', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: { beneficiary: 'X' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('nameEn 非 string → 400 VALIDATION_FAILED', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: { nameEn: 123 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('value 非对象 → 400 VALIDATION_FAILED', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'not-an-object' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });
});

describe('GET /company.exporterProfile/history（仅 SUPER_ADMIN/ADMIN）', () => {
  it('非 admin（viewer）→ 403 FORBIDDEN', async () => {
    const { app } = makeApp();
    const res = await request(app).get(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}/history`).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('admin → 200 + createdAt 倒序列表（versionFrom/To/valueFrom/valueTo/actorId/reason）', async () => {
    const { app, prisma } = makeApp();
    const res = await request(app).get(`/api/v1/config/${EXPORTER_PROFILE_CONFIG_KEY}/history`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ id: 'SCH_2', versionFrom: 2, versionTo: 3, actorId: 'u_admin', reason: '更新 USD 账号' });
    expect(prisma.systemConfigHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { configId: EXPORTER_PROFILE_CONFIG_ID },
      orderBy: { createdAt: 'desc' },
    }));
  });
});

describe('seed 幂等（seed-systemconfig.ts）', () => {
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('global::company.exporterProfile 已存在 → 不覆盖（create 0 次）', async () => {
    const create = vi.fn();
    const db: any = {
      systemConfig: {
        findUnique: vi.fn().mockResolvedValue({ id: EXPORTER_PROFILE_CONFIG_ID }),
        create,
      },
    };
    const result = await seedSystemConfigs(db);
    expect(create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it('缺失 → 写入与前端 EXPORTER_PROFILE 同款默认值（group=company / valueType=json / version=1）', async () => {
    const creates: any[] = [];
    const db: any = {
      systemConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }: any) => { creates.push(data); return data; }),
      },
    };
    await seedSystemConfigs(db);
    const entry = creates.find((c) => c.key === EXPORTER_PROFILE_CONFIG_KEY);
    expect(entry).toBeTruthy();
    expect(entry.id).toBe(EXPORTER_PROFILE_CONFIG_ID);
    expect(entry.group).toBe('company');
    expect(entry.valueType).toBe('json');
    expect(entry.version).toBe(1);
    expect(entry.encrypted).toBe(false);
    expect(entry.value).toEqual(DEFAULT_EXPORTER_PROFILE);
  });
});
