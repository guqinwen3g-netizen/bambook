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
