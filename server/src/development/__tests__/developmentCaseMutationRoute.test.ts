import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createDevelopmentRouter } from '../route';
import { authHeader } from '../../__tests__/authTestHelper';

/**
 * task ERP-P1-development-mutation-route-foundation:
 * 覆盖 DevelopmentCase create/update/stage/delete 的事务/审计/EntityLink 契约。
 * 沿用 convertRoute.test.ts 的 $transaction: (fn) => fn(tx) 透明穿透模式。
 */

function makeApp(opts: {
  existingCase?: any;
  syncFail?: boolean;
  auditFail?: boolean;
  txFail?: boolean;
  onDataChange?: any;
  duplicateCode?: boolean;
  updateFail?: boolean;
  deletedAlready?: boolean;
} = {}) {
  const hasExisting = opts.existingCase !== null;
  const existingCase = opts.existingCase === null ? null : (opts.existingCase ?? {
    id: 'DEV-CASE-1',
    code: 'DEV-1',
    name: 'Test case',
    type: 'fabric',
    stage: 'developing',
    priority: 'normal',
    currentRound: 1,
    customerRelationId: null,
    customerName: null,
    supplierRelationId: null,
    supplierName: null,
    productAssetId: null,
    productName: null,
    completedDate: null,
    deletedAt: null,
    tags: [],
    createdAt: BigInt(1000),
    updatedAt: BigInt(1000),
  });
  const devCaseCreate = opts.duplicateCode
    ? vi.fn().mockRejectedValue(Object.assign(new Error('unique constraint'), { code: 'P2002' }))
    : vi.fn().mockImplementation(async ({ data }: any) => ({
        ...(existingCase || {}),
        id: data?.id || `DEV-NEW`,
        code: data?.code,
        name: data?.name,
        type: data?.type,
        stage: data?.stage,
        customerRelationId: data?.customerRelationId ?? null,
        customerName: data?.customerName ?? null,
        supplierRelationId: data?.supplierRelationId ?? null,
        supplierName: data?.supplierName ?? null,
        productAssetId: data?.productAssetId ?? null,
        productName: data?.productName ?? null,
        completedDate: null,
        deletedAt: null,
        tags: data?.tags || [],
        createdAt: BigInt(1000),
        updatedAt: BigInt(1000),
      }));
  const devCaseUpdate = opts.updateFail
    ? vi.fn().mockRejectedValue(new Error('DB_BOOM'))
    : vi.fn().mockImplementation(async ({ where, data }: any) => ({
        ...(existingCase || { id: where?.id }),
        ...data,
        id: where?.id || existingCase?.id,
        updatedAt: BigInt(2000),
        customerRelationId: data?.customerRelationId ?? existingCase?.customerRelationId ?? null,
        customerName: data?.customerName ?? existingCase?.customerName ?? null,
      }));
  const devCaseFindFirstTx = vi.fn().mockImplementation(async ({ where }: any) => {
    if (!existingCase) return null;
    if (opts.deletedAlready) return { ...existingCase, deletedAt: BigInt(500) };
    if (where?.deletedAt === null && existingCase.deletedAt) return null;
    return existingCase;
  });
  const auditCreate = opts.auditFail
    ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT'))
    : vi.fn().mockResolvedValue({ id: 'AL-1' });
  const entityRefUpsert = opts.syncFail
    ? vi.fn().mockRejectedValue(new Error('SYNC_BOOM'))
    : vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});
  const entityLinkFindMany = vi.fn().mockResolvedValue([]);
  const entityLinkUpdate = vi.fn().mockResolvedValue({});
  const entityRefFindMany = vi.fn().mockResolvedValue([]);
  const entityRefUpdate = vi.fn().mockResolvedValue({});

  const tx: any = {
    developmentCase: { findFirst: devCaseFindFirstTx, create: devCaseCreate, update: devCaseUpdate },
    auditLog: { create: auditCreate },
    entityReference: { upsert: entityRefUpsert, findMany: entityRefFindMany, update: entityRefUpdate },
    entityLink: { upsert: entityLinkUpsert, findMany: entityLinkFindMany, update: entityLinkUpdate },
  };
  const prisma: any = {
    developmentCase: { findFirst: devCaseFindFirstTx },
    $transaction: opts.txFail
      ? vi.fn().mockRejectedValue(new Error('TX_BOOM'))
      : vi.fn(async (fn: any) => fn(tx)),
  };
  const onDataChange = opts.onDataChange || vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/development', createDevelopmentRouter({ prisma, requireAuth: false, apiKeys: new Set<string>(), onDataChange }));
  return { app, prisma, tx, devCaseCreate, devCaseUpdate, devCaseFindFirstTx, auditCreate, entityRefUpsert, entityLinkFindMany, entityLinkUpdate, entityRefFindMany, entityRefUpdate, onDataChange };
}

describe('task ERP-P1-development-mutation-route-foundation: POST /', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功创建 → 201 + 事务内 sync + audit + onDataChange 事务后触发', async () => {
    const { app, devCaseCreate, entityRefUpsert, auditCreate, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/development').set(authHeader()).send({ code: 'DEV-1', name: 'Test', type: 'fabric', customerRelationId: 'REL-1', customerName: 'Cust A' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(devCaseCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(entityRefUpsert).toHaveBeenCalled();
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('缺失 code → 400 INVALID_INPUT，未进 $transaction', async () => {
    const { app, prisma, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/development').set(authHeader()).send({ name: 'Test', type: 'fabric' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('非法 type → 400 INVALID_TYPE', async () => {
    const { app, onDataChange } = makeApp();
    const res = await request(app).post('/api/v1/development').set(authHeader()).send({ code: 'X', name: 'T', type: 'weird' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TYPE');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('sync 失败 → 500 CREATE_FAILED，audit 未触发，onDataChange 未触发', async () => {
    const { app, auditCreate, onDataChange } = makeApp({ syncFail: true });
    const res = await request(app).post('/api/v1/development').set(authHeader()).send({ code: 'DEV-1', name: 'T', type: 'fabric', customerRelationId: 'REL-1', customerName: 'Cust' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CREATE_FAILED');
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit 失败 → 500 CREATE_FAILED，onDataChange 未触发', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).post('/api/v1/development').set(authHeader()).send({ code: 'DEV-1', name: 'T', type: 'fabric' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CREATE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('duplicate code (P2002) → 409 DUPLICATE_CODE', async () => {
    const { app, onDataChange } = makeApp({ duplicateCode: true });
    const res = await request(app).post('/api/v1/development').set(authHeader()).send({ code: 'DEV-1', name: 'T', type: 'fabric' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_CODE');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1-development-mutation-route-foundation: PUT /:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功更新 → 200 + 事务内 sync + audit + onDataChange', async () => {
    const { app, devCaseUpdate, entityRefUpsert, auditCreate, onDataChange } = makeApp();
    const res = await request(app).put('/api/v1/development/DEV-CASE-1').set(authHeader()).send({ name: 'Renamed', customerRelationId: 'REL-1', customerName: 'Cust' });
    expect(res.status).toBe(200);
    expect(devCaseUpdate).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(entityRefUpsert).toHaveBeenCalled();
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('not found → 404 NOT_FOUND', async () => {
    const { app, onDataChange } = makeApp({ existingCase: null });
    const res = await request(app).put('/api/v1/development/MISSING').set(authHeader()).send({ name: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('非法 stage → 400 INVALID_STAGE', async () => {
    const { app, onDataChange } = makeApp();
    const res = await request(app).put('/api/v1/development/DEV-CASE-1').set(authHeader()).send({ stage: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STAGE');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  // B1: 编辑接口改 stage → 409 拒绝（绕过 updateDevelopmentStage 校验的旁路封死）
  it('编辑改 stage（developing → approved）→ 409 INVALID_TRANSITION 提示请使用阶段推进接口，未写库未审计', async () => {
    const { app, devCaseUpdate, auditCreate, onDataChange } = makeApp();
    const res = await request(app).put('/api/v1/development/DEV-CASE-1').set(authHeader()).send({ stage: 'approved' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(res.body.error.message).toContain('请使用阶段推进接口');
    expect(devCaseUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('编辑改 stage（连同其他字段一起提交）→ 409 拒绝，其他字段也不落库', async () => {
    const { app, devCaseUpdate, auditCreate, onDataChange } = makeApp();
    const res = await request(app).put('/api/v1/development/DEV-CASE-1').set(authHeader()).send({ name: 'Renamed', stage: 'shipping' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(res.body.error.message).toContain('请使用阶段推进接口');
    expect(devCaseUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('编辑提交与现状相同的 stage → 不视为变更，正常编辑成功 200', async () => {
    const { app, devCaseUpdate, auditCreate, onDataChange } = makeApp();
    const res = await request(app).put('/api/v1/development/DEV-CASE-1').set(authHeader()).send({ name: 'Renamed', stage: 'developing' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(devCaseUpdate).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('audit 失败 → 500 UPDATE_FAILED，onDataChange 未触发', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).put('/api/v1/development/DEV-CASE-1').set(authHeader()).send({ name: 'X' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('UPDATE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('sync 失败 → 500 UPDATE_FAILED', async () => {
    const { app, onDataChange } = makeApp({ syncFail: true });
    const res = await request(app).put('/api/v1/development/DEV-CASE-1').set(authHeader()).send({ customerRelationId: 'REL-NEW', customerName: 'New' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('UPDATE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1-development-mutation-route-foundation: PATCH /:id/stage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功推进 stage → 200 + audit + onDataChange', async () => {
    const { app, devCaseUpdate, auditCreate, onDataChange } = makeApp();
    const res = await request(app).patch('/api/v1/development/DEV-CASE-1/stage').set(authHeader()).send({ stage: 'shipping', nextAction: 'ship samples' });
    expect(res.status).toBe(200);
    expect(devCaseUpdate).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('非法 stage → 400 INVALID_STAGE，未进 $transaction', async () => {
    const { app, prisma, onDataChange } = makeApp();
    const res = await request(app).patch('/api/v1/development/DEV-CASE-1/stage').set(authHeader()).send({ stage: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STAGE');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('not found → 404 NOT_FOUND', async () => {
    const { app, onDataChange } = makeApp({ existingCase: null });
    const res = await request(app).patch('/api/v1/development/MISSING/stage').set(authHeader()).send({ stage: 'shipping' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  // B1 正规路径回归：转换矩阵校验仍在 stage 接口生效（developing 不可直跳 approved）
  it('非法流转（developing → approved）→ 400 INVALID_TRANSITION，未写库未审计', async () => {
    const { app, devCaseUpdate, auditCreate, onDataChange } = makeApp();
    const res = await request(app).patch('/api/v1/development/DEV-CASE-1/stage').set(authHeader()).send({ stage: 'approved' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(devCaseUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('audit 失败 → 500 STAGE_UPDATE_FAILED', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).patch('/api/v1/development/DEV-CASE-1/stage').set(authHeader()).send({ stage: 'shipping' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('STAGE_UPDATE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1-development-mutation-route-foundation: DELETE /:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功软删 → 200 + audit + EntityLink deactivate 查询触发', async () => {
    const links = [{ id: 'LINK-1' }];
    const refs = [{ id: 'REF-1' }];
    const { app, devCaseUpdate, auditCreate, entityLinkFindMany, entityLinkUpdate, entityRefFindMany, entityRefUpdate, onDataChange } = makeApp();
    entityLinkFindMany.mockResolvedValueOnce(links);
    entityRefFindMany.mockResolvedValueOnce(refs);
    const res = await request(app).delete('/api/v1/development/DEV-CASE-1').set(authHeader());
    expect(res.status).toBe(200);
    expect(devCaseUpdate).toHaveBeenCalled();
    expect(entityLinkFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ fromType: 'development-case', fromId: 'DEV-CASE-1', status: 'active' }) }));
    expect(entityLinkUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'LINK-1' } }));
    expect(entityRefFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerType: 'development-case', ownerId: 'DEV-CASE-1', status: 'active' }) }));
    expect(entityRefUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'REF-1' } }));
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('not found → 404 NOT_FOUND', async () => {
    const { app, onDataChange } = makeApp({ existingCase: null });
    const res = await request(app).delete('/api/v1/development/MISSING').set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('already deleted → 409 ALREADY_DELETED', async () => {
    const { app, onDataChange } = makeApp({ deletedAlready: true });
    const res = await request(app).delete('/api/v1/development/DEV-CASE-1').set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_DELETED');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  // A4: 已转订单删除拦截
  it('已转订单（linkedOrderId 非空，convert 流程形态）→ 409 拒绝删除', async () => {
    const { app, devCaseUpdate, auditCreate, onDataChange } = makeApp({
      existingCase: {
        id: 'DEV-CASE-1', code: 'DEV-1', name: 'Converted case', type: 'fabric',
        stage: 'approved', linkedOrderId: 'ORD-1', linkedOrderPo: 'PO-1',
        deletedAt: null, tags: [], createdAt: BigInt(1000), updatedAt: BigInt(1000),
      },
    });
    const res = await request(app).delete('/api/v1/development/DEV-CASE-1').set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONVERTED_TO_ORDER');
    expect(res.body.error.message).toBe('已转订单的开发单不可删除');
    expect(devCaseUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('已转订单（stage=已确认 && linkedOrderId 存量形态）→ 409 拒绝删除', async () => {
    const { app, devCaseUpdate, auditCreate, onDataChange } = makeApp({
      existingCase: {
        id: 'DEV-CASE-1', code: 'DEV-1', name: 'Legacy converted case', type: 'garment',
        stage: '已确认', linkedOrderId: 'ORD-2', linkedOrderPo: 'PO-2',
        deletedAt: null, tags: [], createdAt: BigInt(1000), updatedAt: BigInt(1000),
      },
    });
    const res = await request(app).delete('/api/v1/development/DEV-CASE-1').set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONVERTED_TO_ORDER');
    expect(res.body.error.message).toBe('已转订单的开发单不可删除');
    expect(devCaseUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('未转订单（linkedOrderId 为空）→ 正常删除 200', async () => {
    const { app, devCaseUpdate, auditCreate, onDataChange } = makeApp();
    const res = await request(app).delete('/api/v1/development/DEV-CASE-1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(devCaseUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'DEV-CASE-1' },
      data: expect.objectContaining({ deletedAt: expect.any(BigInt) }),
    }));
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it('audit 失败 → 500 DELETE_FAILED', async () => {
    const { app, onDataChange } = makeApp({ auditFail: true });
    const res = await request(app).delete('/api/v1/development/DEV-CASE-1').set(authHeader());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('DELETE_FAILED');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('task ERP-P1-development-mutation-route-foundation: route → service 契约', () => {
  it('POST 路径调用 service（$transaction 被触发一次）', async () => {
    const { app, prisma } = makeApp();
    await request(app).post('/api/v1/development').set(authHeader()).send({ code: 'DEV-9', name: 'T', type: 'fabric' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('PUT 路径调用 service（$transaction 被触发一次）', async () => {
    const { app, prisma } = makeApp();
    await request(app).put('/api/v1/development/DEV-CASE-1').set(authHeader()).send({ name: 'Y' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('PATCH stage 路径调用 service（$transaction 被触发一次）', async () => {
    const { app, prisma } = makeApp();
    await request(app).patch('/api/v1/development/DEV-CASE-1/stage').set(authHeader()).send({ stage: 'approved' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('DELETE 路径调用 service（$transaction 被触发一次）', async () => {
    const { app, prisma } = makeApp();
    await request(app).delete('/api/v1/development/DEV-CASE-1').set(authHeader());
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
