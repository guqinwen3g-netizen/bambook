import { describe, expect, it, vi } from 'vitest';
import { createPermissionService } from '../permissionService';

/**
 * DR-042 v2.1 视野口径收敛回归（设计真源：小组与业务数据共享.md §5.1，T-28/T-32）：
 *   - 业务数据模块（relations/orders/crm/finance/marketing/traceability）的
 *     department 行级规则统一按本人维（self）解析——组为主，部门退出数据权限计算
 *   - 人事编制域（hr）的 department 规则保留原部门维解析（主管看本部门员工档案）
 *   - all 规则零影响（财务/QC/后勤/超管可见性不变）
 */

const SALES_ACTOR = {
  userId: 'user_sales',
  roles: ['sales'],
  departmentIds: ['dept_sales'],
} as any;

const MANAGER_ACTOR = {
  userId: 'user_mgr',
  roles: ['manager'],
  departmentIds: ['dept_sales'],
} as any;

function makePrisma({ usersInDept = ['user_sales', 'user_colleague'] } = {}) {
  return {
    userAccount: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) =>
        (where?.primaryDeptId?.in ?? []).flatMap((deptId: string) =>
          usersInDept.map((id) => ({ id: `${id}@${deptId}` }))),
      ),
    },
    department: {
      findMany: vi.fn().mockResolvedValue([{ id: 'dept_sales' }, { id: 'dept_sub' }]),
    },
  } as any;
}

describe('v2.1 视野口径：业务模块 department → self 收敛', () => {
  it('T-28 resolver 层：sales 角色在 relations 模块 → self（本人维），不再返回部门子树', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    const resolver = await svc.getDataScopeResolver(SALES_ACTOR, 'relations');
    expect(resolver.rule.kind).toBe('self');
    expect(resolver.allowedUserIds).toEqual(['user_sales']);
    expect(resolver.allowedDepartmentIds ?? []).toHaveLength(0);
  });

  it('orders / finance / marketing 等业务模块同样收敛（全局口径一致）', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    for (const moduleName of ['orders', 'finance', 'marketing', 'crm', 'traceability']) {
      const resolver = await svc.getDataScopeResolver(SALES_ACTOR, moduleName);
      expect(resolver.rule.kind, `${moduleName} 应收敛为 self`).toBe('self');
    }
  });

  it('manager（sales-manager 容器）在业务模块同样收敛 self——管理视野由小组承载', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    const resolver = await svc.getDataScopeResolver(MANAGER_ACTOR, 'relations');
    expect(resolver.rule.kind).toBe('self');
    expect(resolver.allowedUserIds).toEqual(['user_mgr']);
  });

  it('hr 模块豁免：department 规则保留部门维解析（主管看本部门员工）', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    const resolver = await svc.getDataScopeResolver(MANAGER_ACTOR, 'hr');
    expect(resolver.rule.kind).toBe('department');
    // 部门成员集仍在（含子部门展开 + own 兜底）
    expect((resolver.allowedUserIds ?? []).length).toBeGreaterThan(0);
  });

  it('T-11/T-32：all 角色零影响（超管全量）', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    const resolver = await svc.getDataScopeResolver(
      { userId: 'user_root', roles: ['owner'], departmentIds: [] } as any,
      'relations',
    );
    expect(resolver.rule.kind).toBe('all');
  });
});
