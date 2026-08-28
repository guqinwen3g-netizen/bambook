/**
 * routeScopeGate.test.ts — S3-γ 修复回归：orders v1 scope 门 + 列表行级数据范围
 *
 * 覆盖：
 *   1. 写端点 legacy requireRole(owner/admin/manager) → requirePermission('orders:write')：
 *      sales 可建单（S1 主链阻断修复证明）；qc/finance 仍 403；DELETE 保留 legacy（sales → 403）
 *   2. GET / 列表行级过滤（对齐 v2 口径，orderService.buildOrderListScopeWhere）：
 *      sales → OR[customerRelationId ∈ 可见客户集, 无客户锚 ∧ ownerId=me]；
 *      admin（全权）→ 不过滤；无 actor（dev/API-Key 读）→ 旧口径放行不过滤
 *
 * 模式参考 permissionDenyPath.test.ts（生产登录链路同款 JWT：roles[]=legacy + permissions[]=默认 scopes）。
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createOrdersRouter } from '../route';
import { ROLE_ID_TO_LEGACY_AGENT_ROLE } from '../../auth/permissionService';
import {
  SYSTEM_ROLE_IDS,
  getDefaultScopeListForRole,
  type SystemRoleId,
} from '../../_shared/rolePermissionMatrix';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';

function tokenForSystemRole(roleId: SystemRoleId, userId = `u_${roleId}`): string {
  const legacy = ROLE_ID_TO_LEGACY_AGENT_ROLE[roleId];
  return jwt.sign(
    {
      userId,
      displayName: `ScopeGate ${roleId}`,
      roles: [legacy],
      permissions: getDefaultScopeListForRole(roleId),
      departmentIds: ['company'],
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function auth(roleId: SystemRoleId, userId?: string): Record<string, string> {
  return { Authorization: `Bearer ${tokenForSystemRole(roleId, userId)}` };
}

/** 捕获 order.findMany 的 where；relation/teamMember 为行级过滤解析提供可控数据 */
function makeMockPrisma() {
  const mock: any = {
    order: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
    },
    relation: {
      findMany: vi.fn(async () => [{ id: 'REL_A' }]),
    },
    teamMember: {
      findMany: vi.fn(async () => []),
    },
    teamDataGrant: {
      findMany: vi.fn(async () => []),
    },
  };
  return mock;
}

function makeApp(prisma: any, requireAuth = true) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/orders', createOrdersRouter({ prisma, requireAuth, apiKeys: new Set() }));
  return app;
}

describe('S3-γ · orders v1 写端点 orders:write scope 门', () => {
  it('sales（持 orders:write）POST / → 通过门禁（S1 主链阻断修复；空 body 落 400 业务校验）', async () => {
    const res = await request(makeApp(makeMockPrisma()))
      .post('/api/v1/orders')
      .set(auth(SYSTEM_ROLE_IDS.SALES))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('sales PUT /:id → 通过门禁（订单不存在 → 404，非 401/403）', async () => {
    const res = await request(makeApp(makeMockPrisma()))
      .put('/api/v1/orders/o_x')
      .set(auth(SYSTEM_ROLE_IDS.SALES))
      .send({ customer: 'Peerless' });
    expect(res.status).toBe(404);
  });

  it('qc（无 orders:write）POST / → 403', async () => {
    const res = await request(makeApp(makeMockPrisma()))
      .post('/api/v1/orders')
      .set(auth(SYSTEM_ROLE_IDS.QC))
      .send({});
    expect(res.status).toBe(403);
  });

  it('finance（业务域只读）POST /:id/status-transition → 403', async () => {
    const res = await request(makeApp(makeMockPrisma()))
      .post('/api/v1/orders/o_x/status-transition')
      .set(auth(SYSTEM_ROLE_IDS.FINANCE))
      .send({ toStatus: 'Confirmed' });
    expect(res.status).toBe(403);
  });

  it('DELETE /:id 保留 legacy 角色门：sales → 403', async () => {
    const res = await request(makeApp(makeMockPrisma()))
      .delete('/api/v1/orders/o_x')
      .set(auth(SYSTEM_ROLE_IDS.SALES));
    expect(res.status).toBe(403);
  });
});

describe('S3-γ · GET /api/v1/orders 列表行级数据范围', () => {
  it('sales → where 带 OR：可见客户集 ∪（无客户锚 ∧ ownerId=me）', async () => {
    const prisma = makeMockPrisma();
    const res = await request(makeApp(prisma))
      .get('/api/v1/orders')
      .set(auth(SYSTEM_ROLE_IDS.SALES, 'u_sales_1'));
    expect(res.status).toBe(200);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual([
      { customerRelationId: { in: ['REL_A'] } },
      { AND: [{ customerRelationId: null }, { ownerId: 'u_sales_1' }] },
    ]);
  });

  it('admin（全权角色）→ 不过滤（where 仅 deletedAt）', async () => {
    const prisma = makeMockPrisma();
    const res = await request(makeApp(prisma))
      .get('/api/v1/orders')
      .set(auth(SYSTEM_ROLE_IDS.ADMIN));
    expect(res.status).toBe(200);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ deletedAt: null });
  });

  it('无 actor（requireAuth:false dev 模式）→ 旧口径放行不过滤', async () => {
    const prisma = makeMockPrisma();
    const res = await request(makeApp(prisma, false)).get('/api/v1/orders');
    expect(res.status).toBe(200);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ deletedAt: null });
  });
});
