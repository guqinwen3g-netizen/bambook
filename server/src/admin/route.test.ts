import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../auth/service';
import { createAdminRouter } from './route';

function adminToken() {
  return createAuthService().signToken({
    userId: 'owner-1',
    displayName: 'Owner',
    roles: ['owner'],
    permissions: ['users:read', 'users:write', 'users:delete', 'roles:read', 'roles:write'],
    departmentIds: [],
  });
}

function makeApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminRouter({ prisma }));
  return app;
}

describe('admin user status management', () => {
  it('keeps disabled users visible in admin user lists', async () => {
    const disabledUser = {
      id: 'user-disabled',
      displayName: 'Disabled User',
      email: 'disabled@example.com',
      status: 'disabled',
      roles: [],
      primaryDeptId: null,
      primaryDepartment: null,
      metadata: { deletedAt: '2026-01-01T00:00:00.000Z' },
      lastLoginAt: null,
      lastLoginIp: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      deletedAt: BigInt(123),
    };
    const erasedUser = {
      ...disabledUser,
      id: 'user-erased',
      metadata: { erased: true },
    };
    const prisma = {
      userAccount: {
        findMany: vi.fn().mockResolvedValue([disabledUser, erasedUser]),
      },
    };

    const res = await request(makeApp(prisma))
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(prisma.userAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ deletedAt: null }, { status: 'disabled' }] },
    }));
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({ id: 'user-disabled', status: 'disabled' });
  });

  it('reactivates a disabled existing account instead of failing duplicate creation', async () => {
    const existing = {
      id: 'user-111',
      displayName: 'Old 111',
      email: '111@example.com',
      status: 'disabled',
      primaryDeptId: null,
      metadata: { deletedAt: '2026-01-01T00:00:00.000Z' },
      deletedAt: BigInt(123),
    };
    const prisma = {
      userAccount: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue({ ...existing, displayName: '111', status: 'active', deletedAt: null }),
      },
      userRole: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
      role: {
        findFirst: vi.fn().mockResolvedValue({ id: 'role-viewer', name: 'viewer' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    const res = await request(makeApp(prisma))
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ displayName: '111', email: '111@example.com', password: 'secret111', roles: 'viewer' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, userId: 'user-111', reactivated: true });
    expect(prisma.userAccount.update).toHaveBeenCalledWith({
      where: { id: 'user-111' },
      data: expect.objectContaining({
        displayName: '111',
        email: '111@example.com',
        status: 'active',
        primaryDeptId: null,
        deletedAt: null,
      }),
    });
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-111' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'reactivate_user', targetId: 'user-111' }),
    });
  });

  it('does not tombstone users when status is changed to disabled', async () => {
    const prisma = {
      userAccount: {
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    const res = await request(makeApp(prisma))
      .patch('/admin/users/user-1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'disabled' });

    expect(res.status).toBe(200);
    expect(prisma.userAccount.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { status: 'disabled' },
    });
  });

  it('disables accounts without deleting roles, password, or email occupancy', async () => {
    const target = {
      id: 'user-1',
      displayName: 'User One',
      email: 'one@example.com',
      status: 'active',
      metadata: {},
    };
    const prisma = {
      userAccount: {
        findUnique: vi.fn().mockResolvedValue(target),
        update: vi.fn().mockResolvedValue({ ...target, status: 'disabled' }),
      },
      userRole: {
        deleteMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    const res = await request(makeApp(prisma))
      .post('/admin/users/user-1/disable-account')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userAccount.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        status: 'disabled',
        metadata: expect.objectContaining({
          disabledBy: 'owner-1',
          disabledAt: expect.any(String),
        }),
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'disable_account', targetId: 'user-1' }),
    });
  });

  it('erases personal data and releases the original email slot', async () => {
    const target = {
      id: 'user-erase',
      displayName: 'Erase Me',
      email: 'erase@example.com',
      status: 'active',
      metadata: {},
      lastLoginAt: new Date('2026-01-01T00:00:00Z'),
      lastLoginIp: '127.0.0.1',
    };
    const prisma = {
      userAccount: {
        findUnique: vi.fn().mockResolvedValue(target),
        update: vi.fn().mockResolvedValue({}),
      },
      agentToolRun: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      agentMemory: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      agentMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      agentSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userRole: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const res = await request(makeApp(prisma))
      .post('/admin/users/user-erase/erase-personal-data')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(prisma.userAccount.update).toHaveBeenCalledWith({
      where: { id: 'user-erase' },
      data: expect.objectContaining({
        displayName: '已抹除用户 -erase',
        email: null,
        passwordHash: '',
        status: 'disabled',
        primaryDeptId: null,
        lastLoginAt: null,
        lastLoginIp: null,
        metadata: expect.objectContaining({
          erased: true,
          deletionMode: 'erase-personal-data',
        }),
      }),
    });
  });
});
