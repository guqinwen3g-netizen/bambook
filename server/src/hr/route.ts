import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../auth/middleware';
import { createModuleAuthGuard } from '../auth/moduleGuard';
import { writeRouteAuditLog, actorIdFromRequest } from '../audit/routeAudit';

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

  return router;
}
