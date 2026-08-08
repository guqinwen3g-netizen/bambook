import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard } from '../auth/moduleGuard';
import { writeRouteAuditLog, actorIdFromRequest } from '../audit/routeAudit';
import { createHrService, HrError } from './hrService';

type HRRouterOptions = {
  prisma: PrismaClient;
  /** 是否启用认证（默认 true，与历史行为一致：HR 路由始终要求 owner/admin JWT）。 */
  requireAuth?: boolean;
  /** 允许的 API-Key 集合（默认空集——HR 不接受 API-Key，仅 JWT）。 */
  apiKeys?: Set<string>;
};

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function deletionStamp(): bigint {
  return BigInt(Date.now());
}

export function createHRRouter(options: HRRouterOptions) {
  const router = Router();
  const { prisma } = options;

  const requireAuth = options.requireAuth ?? true;
  const apiKeys = options.apiKeys ?? new Set<string>();

  // 统一认证守卫：JWT（走 jwt.verify 验签）优先，API-Key 次之
  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));

  // 所有 HR 路由要求 owner/admin 角色（requireRole 走 jwt.verify 验签，比 requireJwtForWrite 更严格；
  // API-Key 即使通过 moduleGuard 也会因无 actor 在此处被挡 → 401）
  if (requireAuth) {
    router.use(requireRole('owner', 'admin'));
  }

  // ════════════════════════════════════════════
  // Personnel Overview (aggregated from UserAccount)
  // ════════════════════════════════════════════
  router.get('/personnel', async (_req: Request, res: Response) => {
    try {
      const users = await prisma.userAccount.findMany({
        where: {
          OR: [{ deletedAt: null }, { status: 'disabled' }],
        },
        include: {
          roles: { include: { role: true } },
          primaryDepartment: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const departments = await prisma.department.findMany({
        where: { status: 'active' },
        orderBy: { name: 'asc' },
      });

      const positions = await prisma.jobPosition.findMany({
        where: { deletedAt: null },
        include: { department: true },
        orderBy: { title: 'asc' },
      });

      res.json({
        ok: true,
        personnel: users.map(u => ({
          id: u.id,
          displayName: u.displayName,
          email: u.email,
          avatarUrl: (u as any).avatarUrl || null,
          status: u.status,
          roles: u.roles.map(ur => ur.role.name),
          departmentId: u.primaryDeptId,
          department: u.primaryDepartment?.name || null,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
        })),
        departments: departments.map(d => ({
          id: d.id,
          name: d.name,
          parentId: d.parentId,
          status: d.status,
        })),
        positions: positions.map(p => ({
          id: p.id,
          title: p.title,
          departmentId: p.departmentId,
          department: p.department?.name || null,
          headcount: p.headcount,
          status: p.status,
          description: p.description,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_PERSONNEL_FETCH_FAILED', message: err.message });
    }
  });

  // ════════════════════════════════════════════
  // Job Positions CRUD
  // ════════════════════════════════════════════
  router.post('/positions', async (req: Request, res: Response) => {
    try {
      const { title, departmentId, description, headcount } = req.body || {};
      if (!title?.trim()) {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'title is required.' });
      }
      const position = await prisma.jobPosition.create({
        data: {
          id: genId('pos'),
          title: title.trim(),
          departmentId: departmentId || null,
          description: description || null,
          headcount: headcount || 1,
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:create_position',
        operation: 'create_position',
        targetType: 'JobPosition',
        targetId: position.id,
        after: { id: position.id, title: position.title, departmentId: position.departmentId, headcount: position.headcount },
        ip: req.ip || null,
      });
      res.json({ ok: true, position });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_POSITION_CREATE_FAILED', message: err.message });
    }
  });

  router.patch('/positions/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { title, departmentId, description, headcount, status } = req.body || {};
      const updated = await prisma.jobPosition.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(departmentId !== undefined && { departmentId: departmentId || null }),
          ...(description !== undefined && { description }),
          ...(headcount !== undefined && { headcount }),
          ...(status !== undefined && { status }),
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:update_position',
        operation: 'update_position',
        targetType: 'JobPosition',
        targetId: id,
        after: { id: updated.id, title: updated.title, status: updated.status, headcount: updated.headcount },
        ip: req.ip || null,
      });
      res.json({ ok: true, position: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_POSITION_UPDATE_FAILED', message: err.message });
    }
  });

  router.delete('/positions/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await prisma.jobPosition.update({
        where: { id },
        data: { deletedAt: deletionStamp() },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:delete_position',
        operation: 'delete_position',
        targetType: 'JobPosition',
        targetId: id,
        after: { deleted: true },
        ip: req.ip || null,
      });
      res.json({ ok: true, deleted: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_POSITION_DELETE_FAILED', message: err.message });
    }
  });

  // ════════════════════════════════════════════
  // Teams CRUD
  // ════════════════════════════════════════════
  router.get('/teams', async (_req: Request, res: Response) => {
    try {
      const teams = await prisma.team.findMany({
        where: { deletedAt: null },
        include: {
          department: true,
          members: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        ok: true,
        teams: teams.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          leaderId: t.leaderId,
          departmentId: t.departmentId,
          department: t.department?.name || null,
          status: t.status,
          memberCount: t.members.filter(m => !m.leftAt).length,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_TEAMS_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/teams', async (req: Request, res: Response) => {
    try {
      const { name, description, leaderId, departmentId } = req.body || {};
      if (!name?.trim()) {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'name is required.' });
      }
      const team = await prisma.team.create({
        data: {
          id: genId('team'),
          name: name.trim(),
          description: description || null,
          leaderId: leaderId || null,
          departmentId: departmentId || null,
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:create_team',
        operation: 'create_team',
        targetType: 'Team',
        targetId: team.id,
        after: { id: team.id, name: team.name, leaderId: team.leaderId, departmentId: team.departmentId },
        ip: req.ip || null,
      });
      res.json({ ok: true, team });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_TEAM_CREATE_FAILED', message: err.message });
    }
  });

  router.patch('/teams/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, description, leaderId, departmentId, status } = req.body || {};
      const updated = await prisma.team.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(leaderId !== undefined && { leaderId: leaderId || null }),
          ...(departmentId !== undefined && { departmentId: departmentId || null }),
          ...(status !== undefined && { status }),
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:update_team',
        operation: 'update_team',
        targetType: 'Team',
        targetId: id,
        after: { id: updated.id, name: updated.name, status: updated.status, leaderId: updated.leaderId },
        ip: req.ip || null,
      });
      res.json({ ok: true, team: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_TEAM_UPDATE_FAILED', message: err.message });
    }
  });

  router.delete('/teams/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await prisma.team.update({
        where: { id },
        data: { deletedAt: deletionStamp() },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:delete_team',
        operation: 'delete_team',
        targetType: 'Team',
        targetId: id,
        after: { deleted: true },
        ip: req.ip || null,
      });
      res.json({ ok: true, deleted: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_TEAM_DELETE_FAILED', message: err.message });
    }
  });

  // Team members
  router.post('/teams/:id/members', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { userId, role } = req.body || {};
      if (!userId) {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'userId is required.' });
      }
      const member = await prisma.teamMember.create({
        data: {
          id: genId('tm'),
          teamId: id,
          userId,
          role: role || 'member',
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:add_team_member',
        operation: 'add_team_member',
        targetType: 'TeamMember',
        targetId: member.id,
        after: { id: member.id, teamId: id, userId, role: member.role },
        ip: req.ip || null,
      });
      res.json({ ok: true, member });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_TEAM_MEMBER_ADD_FAILED', message: err.message });
    }
  });

  router.delete('/teams/:id/members/:userId', async (req: Request, res: Response) => {
    try {
      const { id, userId } = req.params;
      await prisma.teamMember.updateMany({
        where: { teamId: id, userId, leftAt: null },
        data: { leftAt: new Date() },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:remove_team_member',
        operation: 'remove_team_member',
        targetType: 'TeamMember',
        targetId: `${id}:${userId}`,
        after: { teamId: id, userId, removed: true },
        ip: req.ip || null,
      });
      res.json({ ok: true, removed: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_TEAM_MEMBER_REMOVE_FAILED', message: err.message });
    }
  });

  // ════════════════════════════════════════════
  // Projects CRUD
  // ════════════════════════════════════════════
  router.get('/projects', async (_req: Request, res: Response) => {
    try {
      const projects = await prisma.project.findMany({
        where: { deletedAt: null },
        include: {
          team: true,
          members: true,
          assignments: {
            where: { deletedAt: null },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        ok: true,
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          code: p.code,
          description: p.description,
          teamId: p.teamId,
          teamName: p.team?.name || null,
          status: p.status,
          priority: p.priority,
          startDate: p.startDate,
          endDate: p.endDate,
          memberCount: p.members.length,
          assignmentCount: p.assignments.length,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_PROJECTS_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/projects', async (req: Request, res: Response) => {
    try {
      const { name, code, description, teamId, priority, startDate, endDate } = req.body || {};
      if (!name?.trim()) {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'name is required.' });
      }
      const project = await prisma.project.create({
        data: {
          id: genId('proj'),
          name: name.trim(),
          code: code || null,
          description: description || null,
          teamId: teamId || null,
          priority: priority || 'normal',
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:create_project',
        operation: 'create_project',
        targetType: 'Project',
        targetId: project.id,
        after: { id: project.id, name: project.name, code: project.code, teamId: project.teamId, priority: project.priority },
        ip: req.ip || null,
      });
      res.json({ ok: true, project });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_PROJECT_CREATE_FAILED', message: err.message });
    }
  });

  router.patch('/projects/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, code, description, teamId, status, priority, startDate, endDate } = req.body || {};
      const updated = await prisma.project.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(code !== undefined && { code }),
          ...(description !== undefined && { description }),
          ...(teamId !== undefined && { teamId: teamId || null }),
          ...(status !== undefined && { status }),
          ...(priority !== undefined && { priority }),
          ...(startDate !== undefined && { startDate }),
          ...(endDate !== undefined && { endDate }),
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:update_project',
        operation: 'update_project',
        targetType: 'Project',
        targetId: id,
        after: { id: updated.id, name: updated.name, status: updated.status, priority: updated.priority },
        ip: req.ip || null,
      });
      res.json({ ok: true, project: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_PROJECT_UPDATE_FAILED', message: err.message });
    }
  });

  router.delete('/projects/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await prisma.project.update({
        where: { id },
        data: { deletedAt: deletionStamp() },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:delete_project',
        operation: 'delete_project',
        targetType: 'Project',
        targetId: id,
        after: { deleted: true },
        ip: req.ip || null,
      });
      res.json({ ok: true, deleted: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_PROJECT_DELETE_FAILED', message: err.message });
    }
  });

  // Project members
  router.post('/projects/:id/members', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { userId, role } = req.body || {};
      if (!userId) {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'userId is required.' });
      }
      const member = await prisma.projectMember.create({
        data: {
          id: genId('pm'),
          projectId: id,
          userId,
          role: role || 'member',
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:add_project_member',
        operation: 'add_project_member',
        targetType: 'ProjectMember',
        targetId: member.id,
        after: { id: member.id, projectId: id, userId, role: member.role },
        ip: req.ip || null,
      });
      res.json({ ok: true, member });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_PROJECT_MEMBER_ADD_FAILED', message: err.message });
    }
  });

  router.delete('/projects/:id/members/:userId', async (req: Request, res: Response) => {
    try {
      const { id, userId } = req.params;
      await prisma.projectMember.deleteMany({
        where: { projectId: id, userId },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:remove_project_member',
        operation: 'remove_project_member',
        targetType: 'ProjectMember',
        targetId: `${id}:${userId}`,
        after: { projectId: id, userId, removed: true },
        ip: req.ip || null,
      });
      res.json({ ok: true, removed: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_PROJECT_MEMBER_REMOVE_FAILED', message: err.message });
    }
  });

  // ════════════════════════════════════════════
  // Work Assignments CRUD
  // ════════════════════════════════════════════
  router.get('/assignments', async (req: Request, res: Response) => {
    try {
      const { userId, projectId, status } = req.query as any;
      const where: any = { deletedAt: null };
      if (userId) where.userId = userId;
      if (projectId) where.projectId = projectId;
      if (status) where.status = status;

      const assignments = await prisma.workAssignment.findMany({
        where,
        include: { project: true },
        orderBy: { createdAt: 'desc' },
      });

      // Fetch assignee info
      const userIds = [...new Set(assignments.map(a => a.userId))];
      const users = userIds.length > 0
        ? await prisma.userAccount.findMany({
            where: { id: { in: userIds } },
            select: { id: true, displayName: true, avatarUrl: true },
          })
        : [];
      const userMap = new Map(users.map(u => [u.id, u]));

      res.json({
        ok: true,
        assignments: assignments.map(a => ({
          id: a.id,
          title: a.title,
          description: a.description,
          projectId: a.projectId,
          projectName: a.project?.name || null,
          userId: a.userId,
          userName: userMap.get(a.userId)?.displayName || a.userId,
          userAvatar: userMap.get(a.userId)?.avatarUrl || null,
          assignerId: a.assignerId,
          status: a.status,
          priority: a.priority,
          dueDate: a.dueDate,
          completedAt: a.completedAt,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_ASSIGNMENTS_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/assignments', async (req: Request, res: Response) => {
    try {
      const { title, description, projectId, userId, priority, dueDate } = req.body || {};
      if (!title?.trim() || !userId) {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'title and userId are required.' });
      }
      const assignment = await prisma.workAssignment.create({
        data: {
          id: genId('wa'),
          title: title.trim(),
          description: description || null,
          projectId: projectId || null,
          userId,
          assignerId: (req as any).user?.id || null,
          priority: priority || 'normal',
          dueDate: dueDate || null,
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:create_assignment',
        operation: 'create_assignment',
        targetType: 'WorkAssignment',
        targetId: assignment.id,
        after: { id: assignment.id, title: assignment.title, userId, projectId: assignment.projectId, priority: assignment.priority },
        ip: req.ip || null,
      });
      res.json({ ok: true, assignment });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_ASSIGNMENT_CREATE_FAILED', message: err.message });
    }
  });

  router.patch('/assignments/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { title, description, projectId, userId, status, priority, dueDate } = req.body || {};
      const completedAt = status === 'completed' ? new Date() : undefined;
      const updated = await prisma.workAssignment.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(projectId !== undefined && { projectId: projectId || null }),
          ...(userId !== undefined && { userId }),
          ...(status !== undefined && { status, ...(completedAt && { completedAt }) }),
          ...(priority !== undefined && { priority }),
          ...(dueDate !== undefined && { dueDate }),
        },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:update_assignment',
        operation: 'update_assignment',
        targetType: 'WorkAssignment',
        targetId: id,
        after: { id: updated.id, title: updated.title, status: updated.status, priority: updated.priority },
        ip: req.ip || null,
      });
      res.json({ ok: true, assignment: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_ASSIGNMENT_UPDATE_FAILED', message: err.message });
    }
  });

  router.delete('/assignments/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await prisma.workAssignment.update({
        where: { id },
        data: { deletedAt: deletionStamp() },
      });
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: 'route:hr:delete_assignment',
        operation: 'delete_assignment',
        targetType: 'WorkAssignment',
        targetId: id,
        after: { deleted: true },
        ip: req.ip || null,
      });
      res.json({ ok: true, deleted: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: 'HR_ASSIGNMENT_DELETE_FAILED', message: err.message });
    }
  });

  // ════════════════════════════════════════════
  // C3 HR 深化 — 员工档案 / 生命周期 / 考勤请假 / 薪资 / 绩效 / 培训
  // 业务规则统一收口 hrService，route 只做参数透传 + 审计
  // ════════════════════════════════════════════
  const hr = createHrService(prisma);

  /** HrError → HTTP 状态码映射（业务规则冲突 409，校验失败 400，未找到 404） */
  function hrErrorStatus(err: any): number {
    if (!(err instanceof HrError)) return 500;
    if (err.code === 'VALIDATION_FAILED') return 400;
    if (err.code.endsWith('_NOT_FOUND')) return 404;
    return 409;
  }

  async function audited(
    req: Request,
    res: Response,
    ctx: { source: string; operation: string; targetType: string; targetId: () => string },
    fn: () => Promise<{ payload: Record<string, unknown>; auditAfter?: Record<string, unknown> }>,
  ) {
    try {
      const { payload, auditAfter } = await fn();
      await writeRouteAuditLog({
        prisma,
        actorId: actorIdFromRequest(req),
        source: ctx.source,
        operation: ctx.operation,
        targetType: ctx.targetType,
        targetId: ctx.targetId(),
        after: auditAfter ?? payload,
        ip: req.ip || null,
      });
      res.json({ ok: true, ...payload });
    } catch (err: any) {
      const status = hrErrorStatus(err);
      res.status(status).json({ ok: false, error: err.code || 'HR_OPERATION_FAILED', message: err.message });
    }
  }

  // ── C3a 员工档案 ──
  router.get('/employees', async (req: Request, res: Response) => {
    try {
      const { status, deptId, q } = req.query as any;
      const employees = await hr.listProfiles({ status, deptId, q });
      res.json({ ok: true, employees });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_EMPLOYEES_FETCH_FAILED', message: err.message });
    }
  });

  router.get('/employees/:userId', async (req: Request, res: Response) => {
    try {
      const profile = await hr.getProfile(req.params.userId);
      if (!profile) return res.status(404).json({ ok: false, error: 'PROFILE_NOT_FOUND', message: '员工档案不存在' });
      res.json({ ok: true, profile });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_EMPLOYEE_FETCH_FAILED', message: err.message });
    }
  });

  router.put('/employees/:userId', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:upsert_employee', operation: 'upsert_employee',
      targetType: 'EmployeeProfile', targetId: () => req.params.userId,
    }, async () => {
      const { profile, created } = await hr.upsertProfile({ ...req.body, userId: req.params.userId });
      return { payload: { profile, created } };
    });
  });

  router.delete('/employees/:userId', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:delete_employee', operation: 'delete_employee',
      targetType: 'EmployeeProfile', targetId: () => req.params.userId,
    }, async () => ({ payload: await hr.deleteProfile(req.params.userId) }));
  });

  // ── C3a 生命周期事件 ──
  router.get('/employment-events', async (req: Request, res: Response) => {
    try {
      const { userId, type, limit } = req.query as any;
      const events = await hr.listEmploymentEvents({ userId, type, limit: limit ? Number(limit) : undefined });
      res.json({ ok: true, events });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_EVENTS_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/employment-events', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:record_employment_event', operation: 'record_employment_event',
      targetType: 'EmploymentEvent', targetId: () => req.body?.userId || 'unknown',
    }, async () => {
      const { event } = await hr.recordEmploymentEvent(actorIdFromRequest(req) ?? 'unknown', req.body || {});
      return { payload: { event } };
    });
  });

  // ── C3b 考勤 ──
  router.get('/attendance', async (req: Request, res: Response) => {
    try {
      const { userId, month, date, status } = req.query as any;
      const records = await hr.listAttendance({ userId, month, date, status });
      res.json({ ok: true, records });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_ATTENDANCE_FETCH_FAILED', message: err.message });
    }
  });

  router.get('/attendance/summary', async (req: Request, res: Response) => {
    try {
      const { month } = req.query as any;
      const summary = await hr.attendanceSummary(month);
      res.json({ ok: true, summary });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_ATTENDANCE_SUMMARY_FAILED', message: err.message });
    }
  });

  router.post('/attendance', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:upsert_attendance', operation: 'upsert_attendance',
      targetType: 'AttendanceRecord', targetId: () => `${req.body?.userId || 'unknown'}:${req.body?.date || ''}`,
    }, async () => {
      const { record } = await hr.upsertAttendance(req.body || {});
      return { payload: { record } };
    });
  });

  // ── C3b 请假 ──
  router.get('/leave-requests', async (req: Request, res: Response) => {
    try {
      const { userId, status } = req.query as any;
      const requests = await hr.listLeaveRequests({ userId, status });
      res.json({ ok: true, requests });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_LEAVE_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/leave-requests', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:create_leave_request', operation: 'create_leave_request',
      targetType: 'LeaveRequest', targetId: () => req.body?.userId || 'unknown',
    }, async () => {
      const { request } = await hr.createLeaveRequest(req.body || {});
      return { payload: { request } };
    });
  });

  router.post('/leave-requests/:id/decide', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:decide_leave_request', operation: 'decide_leave_request',
      targetType: 'LeaveRequest', targetId: () => req.params.id,
    }, async () => {
      const { decision, rejectReason } = req.body || {};
      if (decision !== 'Approved' && decision !== 'Rejected') {
        throw new HrError('VALIDATION_FAILED', 'decision 须为 Approved 或 Rejected');
      }
      const { request } = await hr.decideLeaveRequest(actorIdFromRequest(req) ?? 'unknown', req.params.id, decision, rejectReason);
      return { payload: { request } };
    });
  });

  router.post('/leave-requests/:id/cancel', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:cancel_leave_request', operation: 'cancel_leave_request',
      targetType: 'LeaveRequest', targetId: () => req.params.id,
    }, async () => {
      const { request } = await hr.cancelLeaveRequest(req.params.id);
      return { payload: { request } };
    });
  });

  // ── C3c 薪资 ──
  router.get('/salary-structures/:userId', async (req: Request, res: Response) => {
    try {
      const structures = await hr.getSalaryHistory(req.params.userId);
      res.json({ ok: true, structures });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_SALARY_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/salary-structures', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:set_salary_structure', operation: 'set_salary_structure',
      targetType: 'SalaryStructure', targetId: () => req.body?.userId || 'unknown',
    }, async () => {
      const result = await hr.setSalaryStructure(req.body || {});
      return { payload: result };
    });
  });

  router.get('/payroll-runs', async (_req: Request, res: Response) => {
    try {
      const runs = await hr.listPayrollRuns();
      res.json({ ok: true, runs });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_PAYROLL_FETCH_FAILED', message: err.message });
    }
  });

  router.get('/payroll-runs/:id', async (req: Request, res: Response) => {
    try {
      const run = await hr.getPayrollRun(req.params.id);
      if (!run) return res.status(404).json({ ok: false, error: 'RUN_NOT_FOUND', message: '工资单不存在' });
      res.json({ ok: true, run });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_PAYROLL_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/payroll-runs', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:create_payroll_run', operation: 'create_payroll_run',
      targetType: 'PayrollRun', targetId: () => req.body?.period || 'unknown',
    }, async () => {
      const { run } = await hr.createPayrollRun(req.body?.period, req.body?.note);
      return { payload: { run } };
    });
  });

  router.post('/payroll-runs/:id/generate', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:generate_payroll_items', operation: 'generate_payroll_items',
      targetType: 'PayrollRun', targetId: () => req.params.id,
    }, async () => ({ payload: await hr.generatePayrollItems(req.params.id) }));
  });

  router.patch('/payroll-items/:id', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:update_payroll_item', operation: 'update_payroll_item',
      targetType: 'PayrollItem', targetId: () => req.params.id,
    }, async () => {
      const { item } = await hr.updatePayrollItem(req.params.id, req.body || {});
      return { payload: { item } };
    });
  });

  router.post('/payroll-runs/:id/confirm', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:confirm_payroll_run', operation: 'confirm_payroll_run',
      targetType: 'PayrollRun', targetId: () => req.params.id,
    }, async () => {
      const { run } = await hr.confirmPayrollRun(req.params.id);
      return { payload: { run } };
    });
  });

  router.post('/payroll-runs/:id/pay', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:mark_payroll_paid', operation: 'mark_payroll_paid',
      targetType: 'PayrollRun', targetId: () => req.params.id,
    }, async () => {
      const { run } = await hr.markPayrollPaid(req.params.id);
      return { payload: { run } };
    });
  });

  // ── C3d 绩效 ──
  router.get('/performance-cycles', async (_req: Request, res: Response) => {
    try {
      const cycles = await hr.listPerformanceCycles();
      res.json({ ok: true, cycles });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_CYCLES_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/performance-cycles', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:create_performance_cycle', operation: 'create_performance_cycle',
      targetType: 'PerformanceCycle', targetId: () => req.body?.period || 'unknown',
    }, async () => {
      const { cycle } = await hr.createPerformanceCycle(req.body || {});
      return { payload: { cycle } };
    });
  });

  router.post('/performance-cycles/:id/close', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:close_performance_cycle', operation: 'close_performance_cycle',
      targetType: 'PerformanceCycle', targetId: () => req.params.id,
    }, async () => {
      const { cycle } = await hr.closePerformanceCycle(req.params.id);
      return { payload: { cycle } };
    });
  });

  router.get('/performance-reviews', async (req: Request, res: Response) => {
    try {
      const { cycleId, userId, status } = req.query as any;
      const reviews = await hr.listPerformanceReviews({ cycleId, userId, status });
      res.json({ ok: true, reviews });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_REVIEWS_FETCH_FAILED', message: err.message });
    }
  });

  router.put('/performance-reviews', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:upsert_performance_review', operation: 'upsert_performance_review',
      targetType: 'PerformanceReview', targetId: () => `${req.body?.cycleId || ''}:${req.body?.userId || ''}`,
    }, async () => {
      const { review } = await hr.upsertPerformanceReview(req.body || {});
      return { payload: { review } };
    });
  });

  router.post('/performance-reviews/:id/submit', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:submit_performance_review', operation: 'submit_performance_review',
      targetType: 'PerformanceReview', targetId: () => req.params.id,
    }, async () => {
      const { review } = await hr.submitPerformanceReview(req.params.id);
      return { payload: { review } };
    });
  });

  router.post('/performance-reviews/:id/confirm', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:confirm_performance_review', operation: 'confirm_performance_review',
      targetType: 'PerformanceReview', targetId: () => req.params.id,
    }, async () => {
      const { review } = await hr.confirmPerformanceReview(req.params.id, {
        ...req.body,
        reviewerId: req.body?.reviewerId ?? actorIdFromRequest(req) ?? null,
      });
      return { payload: { review } };
    });
  });

  // ── C3e 培训 ──
  router.get('/training-courses', async (req: Request, res: Response) => {
    try {
      const { status } = req.query as any;
      const courses = await hr.listTrainingCourses({ status });
      res.json({ ok: true, courses });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_COURSES_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/training-courses', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:create_training_course', operation: 'create_training_course',
      targetType: 'TrainingCourse', targetId: () => req.body?.title || 'unknown',
    }, async () => {
      const { course } = await hr.createTrainingCourse(req.body || {});
      return { payload: { course } };
    });
  });

  router.patch('/training-courses/:id', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:update_training_course', operation: 'update_training_course',
      targetType: 'TrainingCourse', targetId: () => req.params.id,
    }, async () => {
      const { course } = await hr.updateTrainingCourse(req.params.id, req.body || {});
      return { payload: { course } };
    });
  });

  router.delete('/training-courses/:id', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:delete_training_course', operation: 'delete_training_course',
      targetType: 'TrainingCourse', targetId: () => req.params.id,
    }, async () => ({ payload: await hr.deleteTrainingCourse(req.params.id) }));
  });

  router.get('/training-enrollments', async (req: Request, res: Response) => {
    try {
      const { courseId, userId } = req.query as any;
      const enrollments = await hr.listEnrollments({ courseId, userId });
      res.json({ ok: true, enrollments });
    } catch (err: any) {
      res.status(hrErrorStatus(err)).json({ ok: false, error: err.code || 'HR_ENROLLMENTS_FETCH_FAILED', message: err.message });
    }
  });

  router.post('/training-courses/:id/enroll', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:enroll_training', operation: 'enroll_training',
      targetType: 'TrainingEnrollment', targetId: () => `${req.params.id}:${req.body?.userId || ''}`,
    }, async () => {
      const { enrollment } = await hr.enrollTraining(req.params.id, req.body?.userId);
      return { payload: { enrollment } };
    });
  });

  router.patch('/training-enrollments/:id', async (req: Request, res: Response) => {
    await audited(req, res, {
      source: 'route:hr:update_enrollment', operation: 'update_enrollment',
      targetType: 'TrainingEnrollment', targetId: () => req.params.id,
    }, async () => {
      const { enrollment } = await hr.updateEnrollment(req.params.id, req.body || {});
      return { payload: { enrollment } };
    });
  });

  return router;
}
