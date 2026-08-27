import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../auth/service';
import { createHRRouter } from './route';

// HR 路由要求 owner/admin 角色（与 admin 路由同模式），用 owner token 通过守卫
function ownerToken() {
  return createAuthService().signToken({
    userId: 'owner-1',
    displayName: 'Owner',
    roles: ['owner'],
    permissions: [],
    departmentIds: [],
  });
}

function makeApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/hr', createHRRouter({ prisma }));
  return app;
}

describe('HR personnel route filters erased users', () => {
  it('keeps disabled users visible but filters erased users from personnel list', async () => {
    // 三类用户：
    //  - activeUser：正常在职员工
    //  - disabledUser：停用账号（status='disabled'），按设计应保留在列表，标记停用
    //  - erasedUser：抹除个人数据（metadata.erased + deletionMode='erase-personal-data'），
    //    admin 路由会把它 status 改成 'disabled'，HR personnel 必须再过滤 metadata 才不会泄漏
    const activeUser = {
      id: 'user-active',
      displayName: 'Active User',
      email: 'active@example.com',
      status: 'active',
      roles: [],
      primaryDeptId: null,
      primaryDepartment: null,
      metadata: null,
      lastLoginAt: null,
      lastLoginIp: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      deletedAt: null,
    };
    const disabledUser = {
      ...activeUser,
      id: 'user-disabled',
      displayName: 'Disabled User',
      email: 'disabled@example.com',
      status: 'disabled',
      metadata: { disabledBy: 'owner-1', disabledAt: '2026-02-01T00:00:00Z' },
      deletedAt: BigInt(123),
    };
    const erasedUser = {
      ...disabledUser,
      id: 'user-erased',
      displayName: '已抹除用户 erased',
      email: null,
      metadata: {
        erased: true,
        erasedAt: '2026-03-01T00:00:00Z',
        erasedBy: 'owner-1',
        deletionMode: 'erase-personal-data',
      },
    };
    const prisma = {
      userAccount: {
        findMany: vi.fn().mockResolvedValue([activeUser, disabledUser, erasedUser]),
      },
      department: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'dept-sales', name: '业务部', parentId: null, status: 'active' },
        ]),
      },
      jobPosition: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const res = await request(makeApp(prisma))
      .get('/hr/personnel')
      .set('Authorization', `Bearer ${ownerToken()}`);

    expect(res.status).toBe(200);
    expect(prisma.userAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ deletedAt: null }, { status: 'disabled' }] },
    }));
    // 关键断言：erased 用户被过滤，active + disabled 用户保留
    expect(res.body.personnel).toHaveLength(2);
    const ids = res.body.personnel.map((u: any) => u.id);
    expect(ids).toContain('user-active');
    expect(ids).toContain('user-disabled');
    expect(ids).not.toContain('user-erased');
  });

  it('also filters users with deletionMode=erase-personal-data but no erased flag', async () => {
    // 防御性 case：仅 deletionMode=erase-personal-data 但 metadata.erased 未设置
    // 设计真源要求两个条件任一命中即过滤
    const normalUser = {
      id: 'user-normal',
      displayName: 'Normal',
      email: 'normal@example.com',
      status: 'active',
      roles: [],
      primaryDeptId: null,
      primaryDepartment: null,
      metadata: null,
      lastLoginAt: null,
      lastLoginIp: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      deletedAt: null,
    };
    const erasedByModeOnly = {
      ...normalUser,
      id: 'user-mode-only',
      displayName: '已抹除用户 modeonly',
      email: null,
      status: 'disabled',
      metadata: { deletionMode: 'erase-personal-data' },
      deletedAt: BigInt(456),
    };
    const prisma = {
      userAccount: {
        findMany: vi.fn().mockResolvedValue([normalUser, erasedByModeOnly]),
      },
      department: { findMany: vi.fn().mockResolvedValue([]) },
      jobPosition: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const res = await request(makeApp(prisma))
      .get('/hr/personnel')
      .set('Authorization', `Bearer ${ownerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.personnel).toHaveLength(1);
    expect(res.body.personnel[0].id).toBe('user-normal');
  });
});
