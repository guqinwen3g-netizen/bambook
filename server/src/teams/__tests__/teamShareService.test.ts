/**
 * teamShareService 单测 — DR-042 小组数据共享
 * 设计真源：docs/design/03-业务规则/小组与业务数据共享.md（v2）§11 验收用例
 * 覆盖：授权幂等（T-12）/ 撤销复活（T-13）/ 解散事务（T-04/T-05）/
 *       双重门禁（T-22/T-23/T-24）/ 软删实体不可授权（T-14）/ 访问档位（§6.2）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── mock 依赖 ──
vi.mock('../../auth/permissionService', () => ({
  createPermissionService: vi.fn(() => ({
    // 默认 department 规则：dept_1 全员可见
    getDataScopeResolver: vi.fn().mockResolvedValue({
      rule: { kind: 'department', own: true },
      allowedDepartmentIds: ['dept_1'],
      allowedUserIds: ['user_1', 'user_2'],
    }),
  })),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { createTeamShareService, __clearTeamShareCacheForTests } from '../teamShareService';

const MANAGER = { userId: 'user_mgr', roles: ['manager'], roleIds: [], departmentIds: ['dept_1'], permissions: [] } as any;
const SALES = { userId: 'user_1', roles: ['sales'], roleIds: ['role-sales'], departmentIds: ['dept_1'], permissions: [] } as any;

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    teamMember: {
      findMany: overrides.teamMemberFindMany ?? vi.fn().mockResolvedValue([
        { teamId: 'team_1' },
      ]),
      findFirst: overrides.teamMemberFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    team: {
      findUnique: overrides.teamFindUnique ?? vi.fn().mockResolvedValue({ id: 'team_1', deletedAt: null }),
      findFirst: overrides.teamFindFirst ?? vi.fn().mockResolvedValue(null),
      update: overrides.teamUpdate ?? vi.fn().mockResolvedValue({}),
    },
    teamDataGrant: {
      findMany: overrides.grantFindMany ?? vi.fn().mockResolvedValue([]),
      findFirst: overrides.grantFindFirst ?? vi.fn().mockResolvedValue(null),
      findUnique: overrides.grantFindUnique ?? vi.fn().mockResolvedValue(null),
      upsert: overrides.grantUpsert ?? vi.fn().mockResolvedValue({}),
      update: overrides.grantUpdate ?? vi.fn().mockResolvedValue({}),
      updateMany: overrides.grantUpdateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
    },
    relation: {
      findFirst: overrides.relationFindFirst ?? vi.fn().mockResolvedValue({ id: 'REL__1', ownerId: 'user_1', departmentId: 'dept_1', salesRepIds: ['user_1'] }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: overrides.$transaction ?? vi.fn(async (fn: any) => fn({
      teamDataGrant: {
        upsert: overrides.grantUpsert ?? vi.fn().mockResolvedValue({}),
        updateMany: overrides.grantUpdateMany ?? vi.fn().mockResolvedValue({ count: 2 }),
      },
      team: { update: overrides.teamUpdate ?? vi.fn().mockResolvedValue({}) },
    })),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  __clearTeamShareCacheForTests();
});

// ═══════════════════════════════════════════════════════════════
// 授权引擎
// ═══════════════════════════════════════════════════════════════

describe('grantEntitiesToTeam 授权', () => {
  it('T-24：无该实体行级写权限 → GRANT_SCOPE_BLOCKED（双重门禁第 2 层）', async () => {
    const prisma = makePrisma({
      relationFindFirst: vi.fn().mockResolvedValue({ id: 'REL__X', ownerId: 'user_other', departmentId: 'dept_9', salesRepIds: [] }),
    });
    const svc = createTeamShareService(prisma);
    const r = await svc.grantEntitiesToTeam(MANAGER, 'team_1', [{ entityType: 'relation', entityId: 'REL__X', permission: 'read' }]);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('GRANT_SCOPE_BLOCKED');
  });

  it('T-22：普通业务员（非组长非主管）不可授权 → FORBIDDEN（双重门禁第 1 层）', async () => {
    const prisma = makePrisma({
      teamMemberFindFirst: vi.fn().mockResolvedValue(null), // 非组长
      teamFindFirst: vi.fn().mockResolvedValue(null),
    });
    const svc = createTeamShareService(prisma);
    const r = await svc.grantEntitiesToTeam(SALES, 'team_1', [{ entityType: 'relation', entityId: 'REL__1', permission: 'read' }]);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('FORBIDDEN');
  });

  it('组长可授权本组（TeamMember.role=leader 通道）', async () => {
    const grantUpsert = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({
      teamMemberFindFirst: vi.fn().mockResolvedValue({ id: 'tm_1' }), // leader
      grantUpsert,
    });
    const svc = createTeamShareService(prisma);
    const r = await svc.grantEntitiesToTeam(SALES, 'team_1', [{ entityType: 'relation', entityId: 'REL__1', permission: 'read+followup' }]);
    expect(r.ok).toBe(true);
    expect(grantUpsert).toHaveBeenCalledTimes(1);
  });

  it('T-25：向已解散组建授权 → TEAM_DISSOLVED', async () => {
    const prisma = makePrisma({
      teamFindUnique: vi.fn().mockResolvedValue({ id: 'team_1', deletedAt: BigInt(1) }),
    });
    const svc = createTeamShareService(prisma);
    const r = await svc.grantEntitiesToTeam(MANAGER, 'team_1', [{ entityType: 'relation', entityId: 'REL__1', permission: 'read' }]);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TEAM_DISSOLVED');
  });

  it('T-14：实体已软删 → ENTITY_NOT_FOUND', async () => {
    const prisma = makePrisma({
      relationFindFirst: vi.fn().mockResolvedValue(null),
    });
    const svc = createTeamShareService(prisma);
    const r = await svc.grantEntitiesToTeam(MANAGER, 'team_1', [{ entityType: 'relation', entityId: 'REL__GONE', permission: 'read' }]);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('ENTITY_NOT_FOUND');
  });

  it('T-12：重复授权 = upsert 复活语义（revokedAt 置 null + 更新 permission）', async () => {
    const grantUpsert = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ grantUpsert });
    const svc = createTeamShareService(prisma);
    await svc.grantEntitiesToTeam(MANAGER, 'team_1', [{ entityType: 'relation', entityId: 'REL__1', permission: 'read' }]);
    await svc.grantEntitiesToTeam(MANAGER, 'team_1', [{ entityType: 'relation', entityId: 'REL__1', permission: 'read+followup' }]);
    expect(grantUpsert).toHaveBeenCalledTimes(2);
    const secondCall = grantUpsert.mock.calls[1][0];
    expect(secondCall.update.permission).toBe('read+followup');
    expect(secondCall.update.revokedAt).toBeNull(); // 复活语义
  });

  it('非法 permission → INVALID_GRANT', async () => {
    const prisma = makePrisma();
    const svc = createTeamShareService(prisma);
    const r = await svc.grantEntitiesToTeam(MANAGER, 'team_1', [{ entityType: 'relation', entityId: 'REL__1', permission: 'write' as any }]);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('INVALID_GRANT');
  });
});

// ═══════════════════════════════════════════════════════════════
// 撤销
// ═══════════════════════════════════════════════════════════════

describe('revokeGrant 撤销', () => {
  it('T-08：软撤销 + reason 必填', async () => {
    const grantUpdate = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({
      grantFindUnique: vi.fn().mockResolvedValue({ id: 'g_1', revokedAt: null }),
      grantUpdate,
    });
    const svc = createTeamShareService(prisma);
    const noReason = await svc.revokeGrant(MANAGER, 'team_1', 'relation', 'REL__1', '');
    expect(noReason.ok).toBe(false);
    expect(noReason.error!.code).toBe('INVALID_GRANT');

    const r = await svc.revokeGrant(MANAGER, 'team_1', 'relation', 'REL__1', '项目结束');
    expect(r.ok).toBe(true);
    expect(grantUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'g_1' },
      data: expect.objectContaining({ revokeReason: '项目结束', revokedBy: 'user_mgr' }),
    }));
  });

  it('幂等：已撤销的授权再次撤销直接成功', async () => {
    const prisma = makePrisma({
      grantFindUnique: vi.fn().mockResolvedValue({ id: 'g_1', revokedAt: new Date() }),
    });
    const svc = createTeamShareService(prisma);
    const r = await svc.revokeGrant(MANAGER, 'team_1', 'relation', 'REL__1', '再撤');
    expect(r.ok).toBe(true);
    expect((r.data as any).revoked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 解散事务（§9.2）
// ═══════════════════════════════════════════════════════════════

describe('dissolveTeam 解散', () => {
  it('T-04：事务内批量 revoke + 软删组 + 审计', async () => {
    const grantUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
    const teamUpdate = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ grantUpdateMany, teamUpdate });
    const svc = createTeamShareService(prisma);
    const r = await svc.dissolveTeam(MANAGER, 'team_1');
    expect(r.ok).toBe(true);
    expect((r.data as any).revokedGrants).toBe(3);
    expect(grantUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 'team_1', revokedAt: null },
      data: expect.objectContaining({ revokeReason: 'team dissolved' }),
    }));
    expect(teamUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'team_1' },
      data: expect.objectContaining({ deletedAt: expect.any(BigInt) }),
    }));
  });

  it('T-05：重复解散 → TEAM_DISSOLVED（幂等保护）', async () => {
    const prisma = makePrisma({
      teamFindUnique: vi.fn().mockResolvedValue({ id: 'team_1', deletedAt: BigInt(1) }),
    });
    const svc = createTeamShareService(prisma);
    const r = await svc.dissolveTeam(MANAGER, 'team_1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TEAM_DISSOLVED');
  });

  it('普通业务员不可解散 → FORBIDDEN', async () => {
    const prisma = makePrisma();
    const svc = createTeamShareService(prisma);
    const r = await svc.dissolveTeam(SALES, 'team_1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('FORBIDDEN');
  });
});

// ═══════════════════════════════════════════════════════════════
// 访问档位（§6.2）
// ═══════════════════════════════════════════════════════════════

describe('resolveRelationAccess 档位解析', () => {
  it('写权限命中 → owner（全权，v2.1 档位）', async () => {
    const prisma = makePrisma(); // REL__1 归属 dept_1，actor 在 allowedUserIds
    const svc = createTeamShareService(prisma);
    const mode = await svc.resolveRelationAccess(MANAGER, 'REL__1');
    expect(mode).toBe('owner');
  });

  it('team-read：组共享 read 档', async () => {
    const prisma = makePrisma({
      relationFindFirst: vi.fn()
        // hasRelationWriteAccess 查实体（无写权限：user_x 的实体）
        .mockResolvedValueOnce({ id: 'REL__2', ownerId: 'user_x', departmentId: 'dept_9', salesRepIds: [] })
        // resolveRelationAccess 里的 grant 查询前还有一次 findFirst？不——grant 走 teamDataGrant.findFirst
        .mockResolvedValue({ id: 'REL__2', ownerId: 'user_x', departmentId: 'dept_9', salesRepIds: [] }),
      teamMemberFindMany: vi.fn().mockResolvedValue([{ teamId: 'team_1' }]),
      grantFindMany: vi.fn().mockResolvedValue([{ entityId: 'REL__2' }]),
      grantFindFirst: vi.fn().mockResolvedValue({ permission: 'read' }),
    });
    const svc = createTeamShareService(prisma);
    const mode = await svc.resolveRelationAccess(MANAGER, 'REL__2');
    expect(mode).toBe('team-read');
  });

  it('team-followup：组共享 read+followup 档', async () => {
    const prisma = makePrisma({
      relationFindFirst: vi.fn().mockResolvedValue({ id: 'REL__2', ownerId: 'user_x', departmentId: 'dept_9', salesRepIds: [] }),
      teamMemberFindMany: vi.fn().mockResolvedValue([{ teamId: 'team_1' }]),
      grantFindMany: vi.fn().mockResolvedValue([{ entityId: 'REL__2' }]),
      grantFindFirst: vi.fn().mockResolvedValue({ permission: 'read+followup' }),
    });
    const svc = createTeamShareService(prisma);
    const mode = await svc.resolveRelationAccess(MANAGER, 'REL__2');
    expect(mode).toBe('team-followup');
  });

  it('none：既无部门维也无组共享', async () => {
    const prisma = makePrisma({
      relationFindFirst: vi.fn().mockResolvedValue({ id: 'REL__3', ownerId: 'user_x', departmentId: 'dept_9', salesRepIds: [] }),
      teamMemberFindMany: vi.fn().mockResolvedValue([{ teamId: 'team_1' }]),
      grantFindMany: vi.fn().mockResolvedValue([]), // 无组授权
    });
    const svc = createTeamShareService(prisma);
    const mode = await svc.resolveRelationAccess(MANAGER, 'REL__3');
    expect(mode).toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════
// 小组维 ID 解析（§5.2 缓存）
// ═══════════════════════════════════════════════════════════════

describe('getActiveGrantedRelationIds 归属解析', () => {
  it('过滤已退组（leftAt）与已撤销授权', async () => {
    const prisma = makePrisma({
      teamMemberFindMany: vi.fn().mockResolvedValue([{ teamId: 'team_1' }, { teamId: 'team_2' }]),
      grantFindMany: vi.fn().mockResolvedValue([
        { entityId: 'REL__A' },
        { entityId: 'REL__B' },
        { entityId: 'REL__A' }, // 去重
      ]),
    });
    const svc = createTeamShareService(prisma);
    const ids = await svc.getActiveGrantedRelationIds('user_1');
    expect(ids).toEqual(['REL__A', 'REL__B']);
  });

  it('60s 进程内缓存：第二次调用不查库', async () => {
    const teamMemberFindMany = vi.fn().mockResolvedValue([{ teamId: 'team_1' }]);
    const grantFindMany = vi.fn().mockResolvedValue([{ entityId: 'REL__A' }]);
    const prisma = makePrisma({ teamMemberFindMany, grantFindMany });
    const svc = createTeamShareService(prisma);
    await svc.getActiveGrantedRelationIds('user_1');
    await svc.getActiveGrantedRelationIds('user_1');
    expect(teamMemberFindMany).toHaveBeenCalledTimes(1);
    expect(grantFindMany).toHaveBeenCalledTimes(1);
  });

  it('用户不在任何组 → 空数组（不查授权）', async () => {
    const grantFindMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      teamMemberFindMany: vi.fn().mockResolvedValue([]),
      grantFindMany,
    });
    const svc = createTeamShareService(prisma);
    const ids = await svc.getActiveGrantedRelationIds('user_1');
    expect(ids).toEqual([]);
    expect(grantFindMany).not.toHaveBeenCalled();
  });
});
