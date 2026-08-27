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

// K1 测试身份：财务（legacy finance → FINANCE，持 hr:read 但无 sensitive:salary）
function financeToken() {
  return createAuthService().signToken({
    userId: 'fin-1',
    displayName: 'Finance',
    roles: ['finance'],
    permissions: [],
    departmentIds: [],
  });
}

// K1 测试身份：系统管理员（legacy admin → ADMIN，持 hr:read|hr:write 但无 sensitive:salary）
function adminToken() {
  return createAuthService().signToken({
    userId: 'admin-1',
    displayName: 'Admin',
    roles: ['admin'],
    permissions: [],
    departmentIds: [],
  });
}

// K1 测试身份：被显式授权薪酬明细的指定 HR（JWT permissions 携带 sensitive:salary）
function hrSalaryToken() {
  return createAuthService().signToken({
    userId: 'hr-1',
    displayName: 'HR Salary',
    roles: [],
    permissions: ['hr:read', 'hr:write', 'sensitive:salary'],
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

/**
 * K1 工资保密门禁（批次二）：薪酬明细接口（/salary-structures、/payroll-runs、/payroll-items）
 * 在 hr:read|write 全局门之上叠加 sensitive:salary 敏感 scope。
 * 矩阵真源：仅 SuperAdmin + 被显式授权的指定 HR 持有；FINANCE（hr:read）与
 * ADMIN（hr:read|hr:write）均未授予 → 越权访问必须 403。
 */
describe('K1 · 工资保密门禁（sensitive:salary）', () => {
  function makeSalaryPrisma() {
    return {
      salaryStructure: { findMany: vi.fn().mockResolvedValue([]) },
      payrollRun: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }

  it('财务（hr:read 但无 sensitive:salary）读薪资结构 → 403', async () => {
    const prisma = makeSalaryPrisma();
    const res = await request(makeApp(prisma))
      .get('/hr/salary-structures/user-1')
      .set('Authorization', `Bearer ${financeToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('sensitive:salary');
    expect(prisma.salaryStructure.findMany).not.toHaveBeenCalled();
  });

  it('财务（hr:read 但无 sensitive:salary）读工资单列表 → 403', async () => {
    const prisma = makeSalaryPrisma();
    const res = await request(makeApp(prisma))
      .get('/hr/payroll-runs')
      .set('Authorization', `Bearer ${financeToken()}`);
    expect(res.status).toBe(403);
    expect(prisma.payrollRun.findMany).not.toHaveBeenCalled();
  });

  it('总领导（hr:read|hr:write 但无 sensitive:salary）读工资单 → 403', async () => {
    const prisma = makeSalaryPrisma();
    const res = await request(makeApp(prisma))
      .get('/hr/payroll-runs')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(403);
    expect(prisma.payrollRun.findMany).not.toHaveBeenCalled();
  });

  it('总领导（hr:write 但无 sensitive:salary）写薪资结构 → 403', async () => {
    const prisma = makeSalaryPrisma();
    const res = await request(makeApp(prisma))
      .post('/hr/salary-structures')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ userId: 'user-1', baseSalary: 10000, effectiveFrom: '2026-09-01' });
    expect(res.status).toBe(403);
  });

  it('指定 HR（sensitive:salary 已授权）读薪资结构 → 200', async () => {
    const prisma = makeSalaryPrisma();
    const res = await request(makeApp(prisma))
      .get('/hr/salary-structures/user-1')
      .set('Authorization', `Bearer ${hrSalaryToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prisma.salaryStructure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('指定 HR（sensitive:salary 已授权）读工资单列表 → 200', async () => {
    const prisma = makeSalaryPrisma();
    const res = await request(makeApp(prisma))
      .get('/hr/payroll-runs')
      .set('Authorization', `Bearer ${hrSalaryToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('SuperAdmin（owner 特判全通）读工资单列表 → 200', async () => {
    const prisma = makeSalaryPrisma();
    const res = await request(makeApp(prisma))
      .get('/hr/payroll-runs')
      .set('Authorization', `Bearer ${ownerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('非薪酬接口不受敏感门影响：财务读员工列表（hr:read）→ 200', async () => {
    const prisma = {
      employeeProfile: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const res = await request(makeApp(prisma))
      .get('/hr/employees')
      .set('Authorization', `Bearer ${financeToken()}`);
    expect(res.status).toBe(200);
  });
});
