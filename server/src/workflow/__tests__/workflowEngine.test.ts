/**
 * WorkflowEngine 单元测试
 *
 * 覆盖：
 *   1. createInstance — 从定义创建实例 + 所有步骤
 *   2. 幂等性 — 同实体+定义+running → 返回已有实例
 *   3. decideStep(approve) — 推进到下一步
 *   4. decideStep(approve last) — 完成实例
 *   5. decideStep(reject) — 终止实例
 *   6. cancelInstance — 取消实例
 *   7. listInstances — 过滤
 *   8. seedDefaultWorkflowDefinitions — seed 默认定义
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock realtime 模块 — 避免真实 SSE 推送
vi.mock('../../realtime', () => ({
  publishNotificationEvent: vi.fn(),
}));

// Mock logger
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { WorkflowEngine, seedDefaultWorkflowDefinitions, DEFAULT_WORKFLOW_DEFINITIONS } from '../workflowEngine';

// ── Mock Prisma 工厂 ──
function makeMockPrisma(overrides: Record<string, any> = {}) {
  const mockData: Record<string, any[]> = {
    workflowDefinition: [],
    workflowInstance: [],
    workflowStep: [],
    userAccount: [{ id: 'user_1', displayName: 'Test User' }],
    userRole: [],
  };

  return {
    workflowDefinition: {
      findUnique: vi.fn(async ({ where }: any) => mockData.workflowDefinition.find(d => d.id === where.id) || null),
      findMany: vi.fn(async () => mockData.workflowDefinition),
      create: vi.fn(async ({ data }: any) => { mockData.workflowDefinition.push(data); return data; }),
    },
    workflowInstance: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const inst = mockData.workflowInstance.find(i => i.id === where.id);
        if (!inst) return null;
        if (include?.steps) {
          return { ...inst, steps: mockData.workflowStep.filter(s => s.instanceId === inst.id), definition: mockData.workflowDefinition.find(d => d.id === inst.definitionId), initiator: mockData.userAccount.find(u => u.id === inst.initiatedById) };
        }
        return inst;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return mockData.workflowInstance.find(i =>
          i.definitionId === where.definitionId &&
          i.entityType === where.entityType &&
          i.entityId === where.entityId &&
          i.status === where.status
        ) || null;
      }),
      findMany: vi.fn(async ({ where, include, take, skip, orderBy }: any) => {
        let results = mockData.workflowInstance.slice();
        if (where?.status) results = results.filter(i => i.status === where.status);
        if (where?.entityType) results = results.filter(i => i.entityType === where.entityType);
        if (where?.entityId) results = results.filter(i => i.entityId === where.entityId);
        if (where?.initiatedById) results = results.filter(i => i.initiatedById === where.initiatedById);
        if (include?.steps) {
          results = results.map(i => ({
            ...i,
            steps: mockData.workflowStep.filter(s => s.instanceId === i.id),
            definition: mockData.workflowDefinition.find(d => d.id === i.definitionId),
            initiator: mockData.userAccount.find(u => u.id === i.initiatedById),
          }));
        }
        return results.slice(skip || 0, (skip || 0) + (take || 50));
      }),
      count: vi.fn(async () => mockData.workflowInstance.length),
      create: vi.fn(async ({ data, include }: any) => {
        const inst = { ...data, createdAt: new Date(), updatedAt: new Date() };
        mockData.workflowInstance.push(inst);
        // 如果 data.steps.create 有数据，创建步骤
        if (data.steps?.create) {
          for (const stepData of data.steps.create) {
            const step = { ...stepData, instanceId: inst.id, createdAt: new Date() };
            mockData.workflowStep.push(step);
          }
        }
        if (include?.steps) {
          return { ...inst, steps: mockData.workflowStep.filter(s => s.instanceId === inst.id) };
        }
        return inst;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = mockData.workflowInstance.findIndex(i => i.id === where.id);
        if (idx >= 0) {
          mockData.workflowInstance[idx] = { ...mockData.workflowInstance[idx], ...data };
          return mockData.workflowInstance[idx];
        }
        return null;
      }),
    },
    workflowStep: {
      update: vi.fn(async ({ where, data }: any) => {
        const idx = mockData.workflowStep.findIndex(s => s.id === where.id);
        if (idx >= 0) {
          mockData.workflowStep[idx] = { ...mockData.workflowStep[idx], ...data };
          return mockData.workflowStep[idx];
        }
        return null;
      }),
    },
    userAccount: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.id?.in) {
          return mockData.userAccount.filter(u => where.id.in.includes(u.id));
        }
        return mockData.userAccount;
      }),
    },
    userRole: {
      findMany: vi.fn(async () => mockData.userRole),
    },
    notification: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    _mockData: mockData,
    ...overrides,
  } as any;
}

// ── 测试用定义 ──
const TEST_DEFINITION = {
  id: 'wf_def_test',
  name: '测试审批流',
  description: '两步审批',
  entityType: 'Order',
  triggerEvent: null,
  steps: [
    { name: '销售经理审批', approverRole: 'manager' },
    { name: '财务审批', approverRole: 'finance' },
  ],
  version: 1,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('WorkflowEngine', () => {
  let prisma: any;
  let engine: WorkflowEngine;

  beforeEach(() => {
    prisma = makeMockPrisma();
    // 预置测试定义
    prisma._mockData.workflowDefinition.push({ ...TEST_DEFINITION });
    engine = new WorkflowEngine(prisma);
  });

  describe('createInstance', () => {
    it('creates instance with all steps from definition', async () => {
      const instance = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_123',
        title: '订单 #123 审批',
        initiatedById: 'user_1',
      });

      expect(instance.id).toBeDefined();
      expect(instance.status).toBe('running');
      expect(instance.currentStepIndex).toBe(0);
      expect(instance.steps).toHaveLength(2);
      expect(instance.steps[0].stepName).toBe('销售经理审批');
      expect(instance.steps[0].decision).toBeNull();
      expect(instance.steps[1].stepName).toBe('财务审批');
    });

    it('returns existing instance for same entity + definition (idempotent)', async () => {
      const first = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_456',
      });

      const second = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_456',
      });

      expect(second.id).toBe(first.id);
    });

    it('throws for non-existent definition', async () => {
      await expect(engine.createInstance({
        definitionId: 'nonexistent',
        entityType: 'Order',
        entityId: 'ord_1',
      })).rejects.toThrow('不存在');
    });
  });

  describe('decideStep', () => {
    it('advances to next step on approve', async () => {
      const instance = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_approve_1',
        initiatedById: 'user_1',
      });

      const result = await engine.decideStep({
        instanceId: instance.id,
        decidedById: 'user_1',
        decision: 'approved',
        note: '同意',
      });

      expect(result.status).toBe('running');
      expect(result.currentStepIndex).toBe(1);
      // 第一步已决策
      expect(result.steps[0].decision).toBe('approved');
      expect(result.steps[0].decisionNote).toBe('同意');
    });

    it('completes instance when last step approved', async () => {
      const instance = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_complete_1',
        initiatedById: 'user_1',
      });

      // 审批第一步
      await engine.decideStep({
        instanceId: instance.id,
        decidedById: 'user_1',
        decision: 'approved',
      });

      // 审批第二步（最后一步）
      const result = await engine.decideStep({
        instanceId: instance.id,
        decidedById: 'user_1',
        decision: 'approved',
      });

      expect(result.status).toBe('approved');
      expect(result.completedAt).not.toBeNull();
    });

    it('terminates instance on reject', async () => {
      const instance = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_reject_1',
        initiatedById: 'user_1',
      });

      const result = await engine.decideStep({
        instanceId: instance.id,
        decidedById: 'user_1',
        decision: 'rejected',
        note: '价格不合理',
      });

      expect(result.status).toBe('rejected');
      expect(result.completedAt).not.toBeNull();
      expect(result.steps[0].decision).toBe('rejected');
      expect(result.steps[0].decisionNote).toBe('价格不合理');
    });

    it('throws for non-running instance', async () => {
      const instance = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_status_1',
      });

      // 先驳回
      await engine.decideStep({
        instanceId: instance.id,
        decidedById: 'user_1',
        decision: 'rejected',
      });

      // 再尝试审批 → 应报错
      await expect(engine.decideStep({
        instanceId: instance.id,
        decidedById: 'user_1',
        decision: 'approved',
      })).rejects.toThrow('无法审批');
    });
  });

  describe('cancelInstance', () => {
    it('cancels a running instance', async () => {
      const instance = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_cancel_1',
      });

      const result = await engine.cancelInstance(instance.id, '不再需要');
      expect(result.status).toBe('cancelled');
    });

    it('throws for non-running instance', async () => {
      const instance = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_cancel_2',
      });

      await engine.cancelInstance(instance.id);

      await expect(engine.cancelInstance(instance.id)).rejects.toThrow('无法取消');
    });
  });

  describe('listInstances', () => {
    it('filters by status', async () => {
      // 创建两个实例，一个通过一个运行中
      const inst1 = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_list_1',
      });
      const inst2 = await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_list_2',
      });
      // inst1 通过
      await engine.decideStep({ instanceId: inst1.id, decidedById: 'user_1', decision: 'approved' });
      await engine.decideStep({ instanceId: inst1.id, decidedById: 'user_1', decision: 'approved' });

      const running = await engine.listInstances({ status: 'running' });
      const approved = await engine.listInstances({ status: 'approved' });

      expect(running.items.some(i => i.id === inst2.id)).toBe(true);
      expect(running.items.some(i => i.id === inst1.id)).toBe(false);
      expect(approved.items.some(i => i.id === inst1.id)).toBe(true);
    });

    it('filters by entity type + id', async () => {
      await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Order',
        entityId: 'ord_entity_1',
      });

      const result = await engine.listInstances({ entityType: 'Order', entityId: 'ord_entity_1' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].entityId).toBe('ord_entity_1');
    });
  });

  describe('getInstancesForEntity', () => {
    it('returns all workflows for an entity', async () => {
      await engine.createInstance({
        definitionId: 'wf_def_test',
        entityType: 'Shipment',
        entityId: 'ship_1',
      });

      const instances = await engine.getInstancesForEntity('Shipment', 'ship_1');
      expect(instances).toHaveLength(1);
      expect(instances[0].entityType).toBe('Shipment');
    });
  });

  describe('listDefinitions', () => {
    it('returns active definitions', async () => {
      const defs = await engine.listDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].id).toBe('wf_def_test');
    });
  });
});

describe('seedDefaultWorkflowDefinitions', () => {
  it('seeds default definitions that do not exist yet', async () => {
    const prisma = makeMockPrisma();
    await seedDefaultWorkflowDefinitions(prisma);

    // 默认定义应被创建
    const createdIds = prisma._mockData.workflowDefinition.map((d: any) => d.id);
    for (const def of DEFAULT_WORKFLOW_DEFINITIONS) {
      expect(createdIds).toContain(def.id);
    }
  });

  it('skips definitions that already exist', async () => {
    const prisma = makeMockPrisma();
    // 预置一个已存在的定义
    prisma._mockData.workflowDefinition.push({ id: DEFAULT_WORKFLOW_DEFINITIONS[0].id, name: 'existing' });

    const beforeCount = prisma._mockData.workflowDefinition.length;
    await seedDefaultWorkflowDefinitions(prisma);

    // 不应重复创建
    const duplicates = prisma._mockData.workflowDefinition.filter((d: any) => d.id === DEFAULT_WORKFLOW_DEFINITIONS[0].id);
    expect(duplicates).toHaveLength(1);
  });
});
