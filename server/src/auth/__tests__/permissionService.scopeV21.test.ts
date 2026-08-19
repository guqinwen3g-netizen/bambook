import { describe, expect, it, vi } from 'vitest';
import { createPermissionService } from '../permissionService';
import { resolveWriteKind } from '../../_shared/rolePermissionMatrix';

/**
 * DR-042 v2.2 视野口径回归（设计真源：小组与业务数据共享.md §5.1，T-33/T-40）：
 *   - v2.2 三层视野：sales 在 relations/crm = { kind: 'all', write: 'self' }
 *     读图书馆（normal 档案全公司可查）、写本人维（跟进人）
 *   - 其余业务数据模块（orders/finance/marketing/traceability）的 department
 *     行级规则统一按本人维（self）解析——组为主，部门退出数据权限计算（v2.1 结论保留）
 *   - 人事编制域（hr）的 department 规则保留原部门维解析（主管看本部门员工档案）
 *   - 真 all 规则零影响（财务/QC/后勤/超管可见性不变）
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

describe('v2.2 视野口径：sales 档案图书馆化（all + write:self）', () => {
  it('T-33/T-40：sales 在 relations 模块 → kind all + write self（读图书馆、写本人维）', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    const resolver = await svc.getDataScopeResolver(SALES_ACTOR, 'relations');
    expect(resolver.rule.kind).toBe('all');
    expect(resolveWriteKind(resolver.rule)).toBe('self');
  });

  it('crm 模块同 relations（L2 消费端不再读该 scope，此为口径一致性声明）', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    const resolver = await svc.getDataScopeResolver(SALES_ACTOR, 'crm');
    expect(resolver.rule.kind).toBe('all');
    expect(resolveWriteKind(resolver.rule)).toBe('self');
  });

  it('orders / finance / marketing / traceability 等业务模块仍收敛 self（v2.1 结论保留）', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    for (const moduleName of ['orders', 'finance', 'marketing', 'traceability']) {
      const resolver = await svc.getDataScopeResolver(SALES_ACTOR, moduleName);
      expect(resolver.rule.kind, `${moduleName} 应收敛为 self`).toBe('self');
    }
  });

  it('manager（sales-manager 容器）在业务模块仍收敛 self——管理视野由小组承载', async () => {
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

  it('T-11/T-32/T-35：真 all 角色零影响（超管全量，writeKind 亦为 all → confidential 可见）', async () => {
    const svc = createPermissionService({ prisma: makePrisma() });
    const resolver = await svc.getDataScopeResolver(
      { userId: 'user_root', roles: ['owner'], departmentIds: [] } as any,
      'relations',
    );
    expect(resolver.rule.kind).toBe('all');
    expect(resolveWriteKind(resolver.rule)).toBe('all');
  });
});
