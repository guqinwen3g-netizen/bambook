import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createAuthService } from '../auth/service';
import { requireRole } from '../auth/middleware';
import { invalidateAccountStatusCache } from '../auth/accountStatusGuard';
import { createModuleAuthGuard } from '../auth/moduleGuard';
import { buildAuditLogQuery } from '../audit/entityQuery';
import { AgentRole } from '../agent/types';
import { EmailService, buildApprovalApprovedEmail, createEmailService } from '../auth/email';
import { logger } from '../lib/logger';

type AdminRouterOptions = {
  prisma: PrismaClient;
  email?: EmailService;
  /** 是否启用认证（默认 true，与历史行为一致：admin 路由始终要求 owner/admin JWT）。 */
  requireAuth?: boolean;
  /** 允许的 API-Key 集合（默认空集——admin 不接受 API-Key，仅 JWT）。 */
  apiKeys?: Set<string>;
};

function auditId(): string {
  return `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function deletionStamp(): bigint {
  return BigInt(Date.now());
}

async function generateUserAccountId(prisma: PrismaClient, email: string, displayName: string): Promise<string> {
  const source = (email?.split('@')[0] || displayName || 'user').toLowerCase();
  const slug = source
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'user';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const id = `user_${slug}_${suffix}`;
    const existing = await prisma.userAccount.findUnique({ where: { id } });
    if (!existing) return id;
  }
  return `user_${slug}_${Date.now().toString(36)}`;
}

/**
 * 角色解析：id 优先（DR-041 容器角色如 role-sales），name 兜底（中文角色名/旧枚举名）。
 * 前端角色选择器以 Role.id 为值下发；兼容历史调用方按 name 传参。
 */
async function resolveRoleByNameOrId(prisma: PrismaClient, nameOrId: string) {
  const byId = await (prisma.role.findUnique?.({ where: { id: nameOrId } }) ?? Promise.resolve(null)).catch(() => null);
  if (byId) return byId;
  return prisma.role.findFirst({ where: { name: nameOrId } });
}

/**
 * 部门存在性校验：primaryDeptId 是真实外键（UserAccount.primaryDeptId → Department.id），
 * 且 DR-007 审批人解析与 userRole 部门作用域 RBAC 均依赖部门可达。
 * 部门填错会导致审批人兜底与部门隔离静默失效，因此在所有写路径 fail-closed。
 */
async function departmentExists(prisma: PrismaClient, departmentId: string | null | undefined): Promise<boolean> {
  if (!departmentId) return true; // 未分配是合法状态
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  return Boolean(dept && dept.status === 'active');
}

export function createAdminRouter(options: AdminRouterOptions) {
  const router = Router();
  const auth = createAuthService();
  const email = options.email || createEmailService();

  const requireAuth = options.requireAuth ?? true;
  const apiKeys = options.apiKeys ?? new Set<string>();

  // 统一认证守卫：JWT（走 jwt.verify 验签）优先，API-Key 次之
  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));

  // 所有 admin 路由要求 owner/admin 角色（requireRole 走 jwt.verify 验签，比 requireJwtForWrite 更严格；
  // API-Key 即使通过 moduleGuard 也会因无 actor 在此处被挡 → 401）
  if (requireAuth) {
    router.use(requireRole('owner', 'admin'));
  }

  // ---- Users ----
  router.get('/users', async (req: Request, res: Response) => {
    const { status } = req.query as { status?: string };
    const where: any = status ? { status } : { OR: [{ deletedAt: null }, { status: 'disabled' }] };
    const usersRaw = await options.prisma.userAccount.findMany({
      where,
      include: { roles: { include: { role: true } }, primaryDepartment: true },
      orderBy: { createdAt: 'desc' },
    });
    const users = usersRaw.filter(u => {
      const metadata = (u.metadata || {}) as any;
      return !metadata.erased && metadata.deletionMode !== 'erase-personal-data';
    });
    // 部门选项随用户列表下发（与 knowledge-acl 返回 departments 同一模式），
    // 前端用户表单的部门字段用下拉选择，杜绝手填原始 ID。
    // parentId 一并下发：前端下拉按树序展开 + 层级缩进渲染（根/支线可辨）。
    const departments = await options.prisma.department.findMany({
      where: { status: 'active' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true },
    });
    res.json({ ok: true, departments, users: users.map(u => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      avatarUrl: (u as any).avatarUrl || null,
      status: u.status,
      roles: u.roles.map(ur => ur.role.name),
      roleIds: u.roles.map(ur => ur.roleId),
      departmentId: u.primaryDeptId,
      department: u.primaryDepartment?.name || null,
      metadata: u.metadata,
      lastLoginAt: u.lastLoginAt,
      lastLoginIp: u.lastLoginIp,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    })) });
  });

  router.post('/users', async (req: Request, res: Response) => {
    const { displayName, email, password, roles, departmentId } = req.body || {};
    if (!displayName || !email || !password) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'displayName, email, password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: 'Password must be at least 6 characters.' });
    }
    if (!(await departmentExists(options.prisma, departmentId))) {
      return res.status(400).json({ ok: false, error: 'INVALID_DEPARTMENT', message: `部门不存在或已停用：${departmentId}` });
    }
    const existing = await options.prisma.userAccount.findFirst({ where: { email } });
    if (existing && existing.status !== 'disabled' && existing.deletedAt === null) {
      return res.status(409).json({ ok: false, error: 'DUPLICATE', message: 'Email already in use.' });
    }
    const passwordHash = await auth.hashPassword(password);
    const reactivatedMetadata = existing ? { ...((existing.metadata as any) || {}) } : {};
    delete reactivatedMetadata.deletedAt;
    delete reactivatedMetadata.deletedBy;
    delete reactivatedMetadata.deletionMode;
    const user = existing
      ? await options.prisma.userAccount.update({
        where: { id: existing.id },
        data: {
          displayName,
          email,
          passwordHash,
          status: 'active',
          primaryDeptId: departmentId || null,
          deletedAt: null,
          metadata: {
            ...reactivatedMetadata,
            reactivatedAt: new Date().toISOString(),
          },
        },
      })
      : await options.prisma.userAccount.create({
        data: { id: await generateUserAccountId(options.prisma, email, displayName), displayName, email, passwordHash, primaryDeptId: departmentId || null },
      });
    const requestedRoles = Array.isArray(roles) ? roles : (typeof roles === 'string' && roles ? [roles] : []);
    if (requestedRoles.length > 0) {
      const resolvedRoles = [];
      for (const roleNameOrId of requestedRoles) {
        const role = await resolveRoleByNameOrId(options.prisma, roleNameOrId);
        if (!role) {
          return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: `角色不存在：${roleNameOrId}` });
        }
        resolvedRoles.push(role);
      }
      await options.prisma.userRole.deleteMany({ where: { userId: user.id } });
      for (const role of resolvedRoles) {
        await options.prisma.userRole.create({ data: { id: `ur_${user.id}_${role.id}`, userId: user.id, roleId: role.id, departmentId: departmentId || null } });
      }
    }
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: existing ? 'reactivate_user' : 'create_user', targetType: 'UserAccount', targetId: user.id, ip: req.ip },
    });
    res.json({ ok: true, userId: user.id, reactivated: Boolean(existing) });
  });

  router.patch('/users/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { displayName, email, status, departmentId } = req.body || {};
    if (departmentId !== undefined && !(await departmentExists(options.prisma, departmentId))) {
      return res.status(400).json({ ok: false, error: 'INVALID_DEPARTMENT', message: `部门不存在或已停用：${departmentId}` });
    }
    const data: any = {};
    if (displayName !== undefined) data.displayName = displayName;
    if (email !== undefined) data.email = email;
    if (status !== undefined) data.status = status;
    if (departmentId !== undefined) data.primaryDeptId = departmentId;
    if (status === 'active') data.deletedAt = null;
    await options.prisma.userAccount.update({ where: { id }, data });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: 'update_user', targetType: 'UserAccount', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  });

  router.post('/users/:id/reset-password', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: 'New password must be at least 6 characters.' });
    }
    const passwordHash = await auth.hashPassword(newPassword);
    await options.prisma.userAccount.update({ where: { id }, data: { passwordHash } });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: 'reset_password', targetType: 'UserAccount', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  });

  const disableUserAccount = async (req: Request, res: Response) => {
    const { id } = req.params;
    const actor = (req as any).actor;
    if (actor?.userId === id) {
      return res.status(400).json({ ok: false, error: 'SELF_DISABLE_FORBIDDEN', message: '不能停用当前登录账号。' });
    }

    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }

    await options.prisma.userAccount.update({
      where: { id },
      data: {
        status: 'disabled',
        metadata: {
          ...(target.metadata as any || {}),
          disabledAt: new Date().toISOString(),
          disabledBy: actor?.userId || 'system',
        },
      },
    });

    // REQ2-13（DR-056-③）：停用即时失效——组合根状态守卫缓存同步失效
    invalidateAccountStatusCache(id);

    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'disable_account', targetType: 'UserAccount', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  };

  router.post('/users/:id/disable-account', disableUserAccount);
  router.post('/users/:id/delete-account', disableUserAccount);

  router.post('/users/:id/erase-personal-data', async (req: Request, res: Response) => {
    const { id } = req.params;
    const actor = (req as any).actor;
    if (actor?.userId === id) {
      return res.status(400).json({ ok: false, error: 'SELF_ERASE_FORBIDDEN', message: '不能抹除当前登录账号。' });
    }

    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }

    await options.prisma.$transaction([
      options.prisma.agentToolRun.deleteMany({ where: { userId: id } }),
      options.prisma.agentMemory.deleteMany({ where: { userId: id } }),
      options.prisma.agentMessage.deleteMany({ where: { userId: id } }),
      options.prisma.agentSession.deleteMany({ where: { userId: id } }),
      options.prisma.userRole.deleteMany({ where: { userId: id } }),
      options.prisma.userAccount.update({
        where: { id },
        data: {
          displayName: `已抹除用户 ${id.slice(-6)}`,
          email: null,
          passwordHash: '',
          status: 'disabled',
          primaryDeptId: null,
          metadata: {
            erased: true,
            erasedAt: new Date().toISOString(),
            erasedBy: actor?.userId || 'system',
            deletionMode: 'erase-personal-data',
          },
          lastLoginAt: null,
          lastLoginIp: null,
          deletedAt: deletionStamp(),
        },
      }),
    ]);

    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'erase_personal_data', targetType: 'UserAccount', targetId: id, detail: { scope: 'personal-only' }, ip: req.ip },
    });
    res.json({ ok: true });
  });

  router.post('/users/:id/approve', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { roles, departmentId } = req.body || {};
    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }
    if (target.status !== 'pending') {
      return res.status(400).json({ ok: false, error: 'INVALID_STATUS', message: '该用户不在待审批状态。' });
    }

    const requestedRole = (target.metadata as any)?.requestedRole as string | undefined;
    const finalRoles: string[] = Array.isArray(roles) && roles.length
      ? roles
      : (requestedRole ? [requestedRole] : ['role-sales']);

    const finalDeptId = departmentId || target.primaryDeptId || null;
    if (!(await departmentExists(options.prisma, finalDeptId))) {
      return res.status(400).json({ ok: false, error: 'INVALID_DEPARTMENT', message: `部门不存在或已停用：${finalDeptId}` });
    }
    await options.prisma.userAccount.update({
      where: { id },
      data: {
        status: 'active',
        primaryDeptId: finalDeptId,
      },
    });

    const resolvedApproveRoles = [];
    for (const roleNameOrId of finalRoles) {
      const role = await resolveRoleByNameOrId(options.prisma, roleNameOrId);
      if (!role) {
        return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: `角色不存在：${roleNameOrId}` });
      }
      resolvedApproveRoles.push(role);
    }
    await options.prisma.userRole.deleteMany({ where: { userId: id } });
    for (const role of resolvedApproveRoles) {
      await options.prisma.userRole.create({
        data: {
          id: `ur_${id}_${role.id}_${Date.now()}`,
          userId: id,
          roleId: role.id,
          departmentId: finalDeptId,
        },
      });
    }

    let department: { id: string; name: string } | null = null;
    if (finalDeptId) {
      department = await options.prisma.department.findUnique({
        where: { id: finalDeptId },
        select: { id: true, name: true },
      });
    }

    let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
    let emailError: string | null = null;
    if (target.email) {
      try {
        const message = buildApprovalApprovedEmail({
          displayName: target.displayName,
          roles: finalRoles,
          department: department?.name || null,
        });
        message.to = target.email;
        await email.send(message);
        emailStatus = 'sent';
      } catch (err: any) {
        emailStatus = 'failed';
        emailError = err?.message || String(err);
        logger.warn('[admin/approve] failed to send approval email', { error: emailError });
      }
    }

    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: {
        id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: actor?.userId || 'system',
        action: 'approve_register',
        targetType: 'UserAccount',
        targetId: id,
        detail: { roles: finalRoles, departmentId: finalDeptId, emailStatus, emailError },
        ip: req.ip,
      },
    });

    res.json({ ok: true, emailStatus, emailError });
  });

  router.post('/users/:id/reject', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }
    if (target.status !== 'pending') {
      return res.status(400).json({ ok: false, error: 'INVALID_STATUS', message: '该用户不在待审批状态。' });
    }

    await options.prisma.userAccount.update({
      where: { id },
      data: {
        status: 'rejected',
        metadata: {
          ...(target.metadata as any || {}),
          rejectedAt: new Date().toISOString(),
          rejectReason: typeof reason === 'string' ? reason : null,
        },
      },
    });

    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: {
        id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: actor?.userId || 'system',
        action: 'reject_register',
        targetType: 'UserAccount',
        targetId: id,
        detail: { reason: reason || null },
        ip: req.ip,
      },
    });

    res.json({ ok: true });
  });

  router.patch('/users/:id/roles', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { roles, departmentId } = req.body || {};
    await options.prisma.userRole.deleteMany({ where: { userId: id } });
    if (Array.isArray(roles)) {
      for (const roleNameOrId of roles) {
        const role = await resolveRoleByNameOrId(options.prisma, roleNameOrId);
        if (!role) {
          return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: `角色不存在：${roleNameOrId}` });
        }
        await options.prisma.userRole.create({ data: { id: `ur_${id}_${role.id}_${Date.now()}`, userId: id, roleId: role.id, departmentId: departmentId || null } });
      }
    }
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: 'update_roles', targetType: 'UserAccount', targetId: id, detail: { roles }, ip: req.ip },
    });
    res.json({ ok: true });
  });

  // ---- Roles ----
  router.get('/roles', async (_req: Request, res: Response) => {
    const roles = await options.prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
    res.json({ ok: true, roles: roles.map(r => ({
      id: r.id, name: r.name, description: r.description, isSystem: r.isSystem,
      permissions: r.permissions.map(p => p.permission.scope),
    })) });
  });

  // ---- Approvals ----
  router.get('/approvals', async (_req: Request, res: Response) => {
    const approvals = await options.prisma.approvalRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, approvals });
  });

  router.patch('/approvals/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, decisionNote } = req.body || {};
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
    }
    const actor = (req as any).actor;
    await options.prisma.approvalRequest.update({
      where: { id },
      data: { status, reviewerId: actor?.userId, decisionNote: decisionNote || null, decidedAt: new Date() },
    });
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: status === 'approved' ? 'approve' : 'reject', targetType: 'ApprovalRequest', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  });

  // ---- Suggestions ----
  router.get('/suggestions', async (_req: Request, res: Response) => {
    const suggestions = await options.prisma.agentSuggestion.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ ok: true, suggestions });
  });

  router.patch('/suggestions/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, decidedBy } = req.body || {};
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
    }
    const actor = (req as any).actor;
    await options.prisma.agentSuggestion.update({
      where: { id },
      data: { status, decidedBy: actor?.userId || decidedBy, decidedAt: new Date() },
    });
    res.json({ ok: true });
  });

  // ---- Audit Logs ----
  // task ERP-P1: target/time filters + 参数校验 fail closed
  // 阶段 D / D6：where 构造抽取至 audit/entityQuery.ts（与 /api/v1/audit/entity 共享）
  router.get('/audit-logs', async (req: Request, res: Response) => {
    const built = buildAuditLogQuery(req.query as any);
    if (!built.ok) {
      return res.status(built.status).json({ ok: false, error: built.error, message: built.message });
    }

    const [logs, total] = await Promise.all([
      options.prisma.auditLog.findMany({
        where: built.where,
        orderBy: { createdAt: 'desc' },
        take: built.limit,
        skip: built.offset,
      }),
      options.prisma.auditLog.count({ where: built.where }),
    ]);
    res.json({ ok: true, logs, total });
  });

  // ---- Knowledge ACL ----
  router.get('/knowledge-acl', async (_req: Request, res: Response) => {
    const [acls, documents, roles, departments] = await Promise.all([
      options.prisma.knowledgeAcl.findMany({
        include: { role: true, department: true, document: true },
        take: 200,
      }),
      options.prisma.knowledgeDocument.findMany({ where: { deletedAt: null }, select: { id: true, title: true } }),
      options.prisma.role.findMany({ select: { id: true, name: true } }),
      options.prisma.department.findMany({ where: { status: 'active' }, select: { id: true, name: true, parentId: true } }),
    ]);
    res.json({
      ok: true,
      acls: acls.map(a => ({
        id: a.id,
        documentId: a.documentId,
        documentTitle: a.document?.title || null,
        roleId: a.roleId,
        roleName: a.role?.name || null,
        departmentId: a.departmentId,
        departmentName: a.department?.name || null,
        scope: a.scope,
        access: a.access,
      })),
      documents,
      roles,
      departments,
    });
  });

  router.post('/knowledge-acl', async (req: Request, res: Response) => {
    const { documentId, roleId, departmentId, scope, access } = req.body || {};
    if (!documentId || !scope) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'documentId and scope are required.' });
    }
    const validAccess = ['read', 'write', 'admin', 'none'];
    const finalAccess = validAccess.includes(access) ? access : 'read';
    const id = `kacl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await options.prisma.knowledgeAcl.create({
      data: { id, documentId, roleId: roleId || null, departmentId: departmentId || null, scope, access: finalAccess },
    });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'create_knowledge_acl', targetType: 'KnowledgeAcl', targetId: id, detail: { documentId, roleId, departmentId, scope, access: finalAccess }, ip: req.ip },
    });
    res.json({ ok: true, id });
  });

  router.patch('/knowledge-acl/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { roleId, departmentId, scope, access } = req.body || {};
    const data: any = {};
    if (roleId !== undefined) data.roleId = roleId || null;
    if (departmentId !== undefined) data.departmentId = departmentId || null;
    if (scope !== undefined) data.scope = scope;
    if (access !== undefined) {
      const validAccess = ['read', 'write', 'admin', 'none'];
      data.access = validAccess.includes(access) ? access : 'read';
    }
    await options.prisma.knowledgeAcl.update({ where: { id }, data });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'update_knowledge_acl', targetType: 'KnowledgeAcl', targetId: id, detail: data, ip: req.ip },
    });
    res.json({ ok: true });
  });

  router.delete('/knowledge-acl/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    await options.prisma.knowledgeAcl.delete({ where: { id } });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'delete_knowledge_acl', targetType: 'KnowledgeAcl', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  });

  // ---- Role Permissions ----
  router.get('/permissions', async (_req: Request, res: Response) => {
    const permissions = await options.prisma.permission.findMany({ orderBy: { scope: 'asc' } });
    res.json({ ok: true, permissions });
  });

  router.post('/permissions', async (req: Request, res: Response) => {
    const { scope, description } = req.body || {};
    if (!scope) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'scope is required.' });
    }
    const existing = await options.prisma.permission.findUnique({ where: { scope } });
    if (existing) {
      return res.status(409).json({ ok: false, error: 'DUPLICATE', message: 'Permission scope already exists.' });
    }
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await options.prisma.permission.create({ data: { id, scope, description: description || null } });
    res.json({ ok: true, id });
  });

  router.patch('/roles/:id/permissions', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { addPermissions, removePermissions } = req.body || {};
    const role = await options.prisma.role.findUnique({ where: { id } });
    if (!role) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '角色不存在。' });
    }
    if (Array.isArray(addPermissions)) {
      for (const scope of addPermissions) {
        const perm = await options.prisma.permission.findUnique({ where: { scope } });
        if (perm) {
          await options.prisma.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: id, permissionId: perm.id } },
            create: { id: `rp_${id}_${perm.id}`, roleId: id, permissionId: perm.id },
            update: {},
          });
        }
      }
    }
    if (Array.isArray(removePermissions)) {
      for (const scope of removePermissions) {
        const perm = await options.prisma.permission.findUnique({ where: { scope } });
        if (perm) {
          await options.prisma.rolePermission.deleteMany({ where: { roleId: id, permissionId: perm.id } });
        }
      }
    }
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'update_role_permissions', targetType: 'Role', targetId: id, detail: { addPermissions, removePermissions }, ip: req.ip },
    });
    res.json({ ok: true });
  });

  // ---- Tool Permissions ----
  router.get('/tool-permissions', async (_req: Request, res: Response) => {
    const [tools, roles] = await Promise.all([
      options.prisma.agentTool.findMany({
        where: { status: 'active' },
        include: { permissions: { include: { role: true } } },
      }),
      options.prisma.role.findMany({ select: { id: true, name: true } }),
    ]);
    res.json({
      ok: true,
      tools: tools.map(t => ({
        id: t.id, name: t.name, scope: t.scope, risk: t.risk, description: t.description,
        permissions: t.permissions.map(p => ({ id: p.id, roleId: p.roleId, roleName: p.role.name, access: p.access, riskMode: p.riskMode })),
      })),
      roles,
    });
  });

  router.post('/tool-permissions', async (req: Request, res: Response) => {
    const { toolId, roleId, access, riskMode } = req.body || {};
    if (!toolId || !roleId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'toolId and roleId are required.' });
    }
    const validAccess = ['execute', 'read', 'admin', 'none'];
    const validRiskMode = ['direct', 'approval', 'disabled'];
    const finalAccess = validAccess.includes(access) ? access : 'execute';
    const finalRiskMode = validRiskMode.includes(riskMode) ? riskMode : 'direct';
    const id = `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await options.prisma.agentToolPermission.upsert({
      where: { toolId_roleId: { toolId, roleId } },
      create: { id, toolId, roleId, access: finalAccess, riskMode: finalRiskMode },
      update: { access: finalAccess, riskMode: finalRiskMode },
    });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'upsert_tool_permission', targetType: 'AgentToolPermission', targetId: id, detail: { toolId, roleId, access: finalAccess, riskMode: finalRiskMode }, ip: req.ip },
    });
    res.json({ ok: true, id });
  });

  router.patch('/tool-permissions/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { access, riskMode } = req.body || {};
    const data: any = {};
    const validAccess = ['execute', 'read', 'admin', 'none'];
    const validRiskMode = ['direct', 'approval', 'disabled'];
    if (access !== undefined) data.access = validAccess.includes(access) ? access : 'execute';
    if (riskMode !== undefined) data.riskMode = validRiskMode.includes(riskMode) ? riskMode : 'direct';
    await options.prisma.agentToolPermission.update({ where: { id }, data });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'update_tool_permission', targetType: 'AgentToolPermission', targetId: id, detail: data, ip: req.ip },
    });
    res.json({ ok: true });
  });

  router.delete('/tool-permissions/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    await options.prisma.agentToolPermission.delete({ where: { id } });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'delete_tool_permission', targetType: 'AgentToolPermission', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  });

  // ---- Knowledge Documents (for ACL dropdown) ----
  router.get('/knowledge-documents', async (_req: Request, res: Response) => {
    const documents = await options.prisma.knowledgeDocument.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true, sourceType: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, documents });
  });

  return router;
}
