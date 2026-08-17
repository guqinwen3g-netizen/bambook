import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAgentRouter } from '../route';
import { createAuthService } from '../../auth/service';

function makeApp(requireAuth = false, prismaOverride?: any) {
  const app = express();
  app.use(express.json());
  const prisma = prismaOverride || {
    userAccount: {
      count: async () => 0,
    },
    agentToolRun: {
      count: async () => 0,
      findFirst: async () => null,
    },
    auditLog: {
      findFirst: async () => null,
    },
  } as any;
  app.use('/api/agent', createAgentRouter({
    prisma,
    dataSource: {
      kind: 'local-dev',
      runtimeEnv: 'test',
      database: 'postgresql',
      host: 'localhost',
      name: 'panda_hub_local',
      isBusinessTruth: false,
      warning: 'Local development database only.',
    },
    requireAuth,
    apiKeys: new Set(['test-key']),
    getRuntimeMetrics: () => ({ activeSessions: 0 }),
  }));
  return app;
}

describe('Agent status route', () => {
  it('returns Agent OS identity, tool, memory, knowledge, and job status', async () => {
    const res = await request(makeApp()).get('/api/agent/status');

    expect(res.status).toBe(200);
    expect(res.body.agent).toMatchObject({
      name: 'Bambook Enterprise Agent OS',
      host: 'mac-mini',
      knowledge: { store: 'postgres', acl: true },
      memory: { scopes: ['personal', 'role', 'department', 'company', 'system'] },
      jobs: { queue: 'postgres' },
      dataSource: { kind: 'local-dev', isBusinessTruth: false },
      runtimeMetrics: { activeSessions: 0 },
    });
    expect(res.body.agent.identity.roles.map((role: any) => role.id)).toContain('finance');
  });

  it('requires the Bambook API key when auth is enabled', async () => {
    const missing = await request(makeApp(true)).get('/api/agent/status');
    const ok = await request(makeApp(true)).get('/api/agent/status').set('X-Bambook-API-Key', 'test-key');

    expect(missing.status).toBe(401);
    expect(ok.status).toBe(200);
  });

  it('exposes MCP manifest endpoint', async () => {
    const manifest = await request(makeApp()).get('/api/agent/mcp/manifest');

    expect(manifest.status).toBe(200);
    expect(manifest.body.tools.map((tool: any) => tool.id)).toEqual(expect.arrayContaining([
      'products.query',
      'relations.query',
      'orders.query',
      'knowledge.search',
      'entities.search',
    ]));
    // Task 60 e2e：Phase 7 Runtime 2.0 manifest 契约
    expect(manifest.body.schemaVersion).toBe('2026-06-runtime-2.0');
    expect(manifest.body.summary).toMatchObject({
      total: expect.any(Number),
      byDomain: expect.any(Object),
      byRisk: expect.any(Object),
      approvalRequired: expect.any(Array),
    });
    // 每个工具都必须带 safety + inputHint，缺一不可
    for (const tool of manifest.body.tools) {
      expect(tool).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        domain: expect.any(String),
        risk: expect.any(String),
        safety: {
          approval: expect.stringMatching(/^(never|risk_based|always)$/),
          sideEffects: expect.any(Boolean),
        },
      });
      expect(typeof tool.inputHint).toBe('string');
    }
    // 注：/mcp/plan 端点已随 planner.ts dead code 清理移除（Phase 0 W3）
  });

  it('creates sessions only for the real JWT actor and ignores dev-only headers', async () => {
    const token = createAuthService().signToken({
      userId: 'owner_1',
      displayName: 'Kevin',
      roles: ['owner'],
      permissions: ['*'],
      departmentIds: ['company'],
    });
    const createdSessions: any[] = [];
    const prisma = {
      userAccount: {
        count: async () => 1,
        findFirst: async () => ({ id: 'owner_1' }),
      },
      agentSession: {
        create: async (args: any) => {
          createdSessions.push(args.data);
          return {
            ...args.data,
            createdAt: new Date('2026-06-11T00:00:00.000Z'),
            updatedAt: new Date('2026-06-11T00:00:00.000Z'),
          };
        },
      },
      agentToolRun: {
        count: async () => 0,
        findFirst: async () => null,
      },
      auditLog: {
        findFirst: async () => null,
      },
    };

    const res = await request(makeApp(false, prisma))
      .post('/api/agent/sessions')
      .set('Authorization', `Bearer ${token}`)
      .set('x-bambook-dev-only', 'local-agent-runtime')
      .send({ title: '本地 Agent 测试' });

    expect(res.status).toBe(200);
    expect(createdSessions[0]).toMatchObject({
      userId: 'owner_1',
      title: '本地 Agent 测试',
      memoryScopes: ['personal:owner_1'],
    });
  });
});

describe('POST /approvals/:id/resolve（Agent 工具审批决策）', () => {
  const sign = (userId: string, roles: string[]) =>
    createAuthService().signToken({ userId, displayName: userId, roles, permissions: ['*'], departmentIds: ['company'] });

  function makeResolvePrisma(approval: any) {
    const updates: any[] = [];
    const prisma = {
      approvalRequest: {
        findUnique: async ({ where }: any) => (approval && approval.id === where.id ? approval : null),
        update: async ({ where, data }: any) => {
          updates.push({ where, data });
          return { ...approval, ...data, decidedAt: new Date('2026-08-17T00:00:00.000Z') };
        },
      },
      userAccount: {
        count: async () => 1,
        findFirst: async ({ where }: any) => ({ id: where.id }),
      },
      agentToolRun: { count: async () => 0, findFirst: async () => null },
      auditLog: { findFirst: async () => null, create: async () => ({}) },
    };
    return { prisma, updates };
  }

  const baseApproval = {
    id: 'ar_test_1',
    requesterId: 'u_requester',
    reviewerId: 'u_owner',
    actionType: 'tool:orders.update',
    targetType: 'orders',
    targetId: 'orders.update',
    status: 'pending',
    risk: 'high',
    payload: { toolId: 'orders.update', input: {} },
    decisionNote: null,
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
    decidedAt: null,
  };

  it('自审禁止：requesterId === 当前用户（owner 角色）→ 403 SELF_APPROVAL_FORBIDDEN 且不写库', async () => {
    const { prisma, updates } = makeResolvePrisma({ ...baseApproval, requesterId: 'u_owner' });
    const res = await request(makeApp(false, prisma))
      .post('/api/agent/approvals/ar_test_1/resolve')
      .set('Authorization', `Bearer ${sign('u_owner', ['owner'])}`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ ok: false, error: 'SELF_APPROVAL_FORBIDDEN' });
    expect(updates).toHaveLength(0);
  });

  it('自审禁止：manager 角色同样不豁免 → 403', async () => {
    const { prisma, updates } = makeResolvePrisma({ ...baseApproval, requesterId: 'u_mgr' });
    const res = await request(makeApp(false, prisma))
      .post('/api/agent/approvals/ar_test_1/resolve')
      .set('Authorization', `Bearer ${sign('u_mgr', ['manager'])}`)
      .send({ decision: 'rejected', comment: '拒绝理由' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(updates).toHaveLength(0);
  });

  it('非本人 pending 单 → 200 正常决策（reviewerId 落库为决策人）', async () => {
    const { prisma, updates } = makeResolvePrisma({ ...baseApproval });
    const res = await request(makeApp(false, prisma))
      .post('/api/agent/approvals/ar_test_1/resolve')
      .set('Authorization', `Bearer ${sign('u_owner', ['owner'])}`)
      .send({ decision: 'approved', comment: '同意' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toMatchObject({ status: 'approved', reviewerId: 'u_owner' });
  });

  it('非本人但已决策单 → 409（自审守卫不影响既有重复决策语义）', async () => {
    const { prisma, updates } = makeResolvePrisma({ ...baseApproval, status: 'approved' });
    const res = await request(makeApp(false, prisma))
      .post('/api/agent/approvals/ar_test_1/resolve')
      .set('Authorization', `Bearer ${sign('u_owner', ['owner'])}`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('APPROVAL_ALREADY_RESOLVED');
    expect(updates).toHaveLength(0);
  });
});
