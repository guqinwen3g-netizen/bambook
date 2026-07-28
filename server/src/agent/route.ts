import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_AGENT_ROLES, DEFAULT_AGENT_TOOLS } from './defaults';
import { extractActorFromRequest, requireRole } from '../auth/middleware';
import { RuntimeDataSource } from '../dataSource';
import { createIdentityService } from './identity';
import { AgentRole, ActorContext } from './types';
import { getMcpManifest } from './mcp/manifest';
import { runMcpPlan } from './mcp/executor';
import { buildAgentTaskFrame } from './taskFrame';

type AuthOptions = {
  requireAuth: boolean;
  apiKeys: Set<string>;
};

type AgentStatusOptions = AuthOptions & {
  getRuntimeMetrics: () => Record<string, unknown>;
  prisma: PrismaClient;
  dataSource: RuntimeDataSource;
};

export function createAgentRouter(options: AgentStatusOptions) {
  const router = Router();
  const requireAgentActor = requireActor(options.prisma);

  router.get('/status', auth(options), asyncHandler(async (_req, res) => {
    const [userTotal, activeUsers] = await Promise.all([
      options.prisma.userAccount.count().catch(() => 0),
      options.prisma.userAccount.count({ where: { deletedAt: null, status: 'active' } }).catch(() => 0),
    ]);
    const toolRunCount = await options.prisma.agentToolRun.count().catch(() => 0);
    const latestToolRun = await options.prisma.agentToolRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: {
        toolId: true,
        userId: true,
        actorId: true,
        actorDisplayName: true,
        actorRoles: true,
        sessionId: true,
        requestSource: true,
        approvalId: true,
        status: true,
        risk: true,
        startedAt: true,
        completedAt: true,
      },
    }).catch(() => null);
    const latestAuditLog = await options.prisma.auditLog.findFirst({
      where: { action: { startsWith: 'agent_tool_' } },
      orderBy: { createdAt: 'desc' },
      select: {
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        detail: true,
        createdAt: true,
      },
    }).catch(() => null);
    res.json({
      ok: true,
      agent: {
        name: 'Bambook Enterprise Agent OS',
        host: 'mac-mini',
        identity: {
          roles: DEFAULT_AGENT_ROLES.map(role => ({
            id: role.id,
            name: role.name,
            permissions: role.permissions,
          })),
        },
        tools: {
          registered: DEFAULT_AGENT_TOOLS.length,
          highRisk: DEFAULT_AGENT_TOOLS.filter(tool => tool.risk === 'high').length,
          items: DEFAULT_AGENT_TOOLS.map(tool => ({
            id: tool.id,
            scope: tool.scope,
            risk: tool.risk,
            allowedRoles: tool.allowedRoles,
            approvalRoles: tool.approvalRoles || [],
          })),
        },
        knowledge: {
          store: 'postgres',
          status: 'schema-ready',
          acl: true,
        },
        memory: {
          scopes: ['personal', 'role', 'department', 'company', 'system'],
          status: 'schema-ready',
        },
        jobs: {
          status: 'schema-ready',
          queue: 'postgres',
        },
        audit: {
          toolRuns: toolRunCount,
          latestToolRun: latestToolRun ? {
            ...latestToolRun,
            startedAt: latestToolRun.startedAt.toISOString(),
            completedAt: latestToolRun.completedAt?.toISOString() || null,
          } : null,
          latestAuditLog: latestAuditLog ? {
            ...latestAuditLog,
            createdAt: latestAuditLog.createdAt.toISOString(),
          } : null,
        },
        users: {
          total: userTotal,
          active: activeUsers,
        },
        dataSource: options.dataSource,
        runtimeMetrics: options.getRuntimeMetrics(),
      },
    });
  }));

  router.get('/sessions', requireAgentActor, asyncHandler(async (req, res) => {
    const actor = (req as any).actor;
    const sessions = await options.prisma.agentSession.findMany({
      where: { userId: actor.userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    });

    res.json({
      ok: true,
      sessions: sessions.map(session => ({
        id: session.id,
        title: session.title || '未命名对话',
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        messageCount: session._count.messages,
        lastMessage: session.messages[0] ? {
          role: session.messages[0].role,
          content: session.messages[0].content,
          createdAt: session.messages[0].createdAt.toISOString(),
        } : null,
      })),
    });
  }));

  router.post('/sessions', requireAgentActor, asyncHandler(async (req, res) => {
    const actor = (req as any).actor;
    const user = await options.prisma.userAccount.findFirst({
      where: { id: actor.userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Login user no longer exists.' });
    }
    const title = cleanTitle(req.body?.title);
    const session = await options.prisma.agentSession.create({
      data: {
        id: `as_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: actor.userId,
        departmentId: null,
        title: title || '新对话',
        status: 'active',
        memoryScopes: [`personal:${actor.userId}`],
        metadata: {
          source: 'assistant',
          roles: actor.roles || [],
          departmentIds: actor.departmentIds || [],
        },
      },
    });

    res.json({ ok: true, session: serializeSession(session) });
  }));

  router.get('/sessions/:id/messages', requireAgentActor, asyncHandler(async (req, res) => {
    const actor = (req as any).actor;
    const session = await options.prisma.agentSession.findFirst({
      where: { id: req.params.id, userId: actor.userId, deletedAt: null },
    });
    if (!session) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Session not found.' });

    const messages = await options.prisma.agentMessage.findMany({
      where: { sessionId: session.id, userId: actor.userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      ok: true,
      session: serializeSession(session),
      messages: messages.map(message => ({
        id: message.id,
        role: message.role === 'user' ? 'user' : 'model',
        text: message.content,
        timestamp: message.createdAt.getTime(),
        sources: (message.metadata as any)?.sources,
        thoughtProcess: (message.metadata as any)?.thoughtProcess,
        attachments: (message.metadata as any)?.attachments,
      })),
    });
  }));

  router.post('/sessions/:id/messages', requireAgentActor, asyncHandler(async (req, res) => {
    const actor = (req as any).actor;
    const role = req.body?.role === 'user' ? 'user' : 'model';
    const content = String(req.body?.text || req.body?.content || '').trim();
    if (!content) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'Message text is required.' });

    const session = await options.prisma.agentSession.findFirst({
      where: { id: req.params.id, userId: actor.userId, deletedAt: null },
    });
    if (!session) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Session not found.' });

    const message = await options.prisma.agentMessage.create({
      data: {
        id: `am_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId: session.id,
        userId: actor.userId,
        role,
        content,
        metadata: {
          attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : undefined,
          sources: Array.isArray(req.body?.sources) ? req.body.sources : undefined,
          thoughtProcess: typeof req.body?.thoughtProcess === 'string' ? req.body.thoughtProcess : undefined,
        },
      },
    });

    const nextTitle = session.title && session.title !== '新对话' ? session.title : titleFromMessage(content);
    await options.prisma.agentSession.update({
      where: { id: session.id },
      data: {
        title: nextTitle,
        metadata: {
          ...((session.metadata as Record<string, unknown> | null) || {}),
          lastRole: role,
          lastMessageAt: new Date().toISOString(),
        },
      },
    });

    res.json({
      ok: true,
      message: {
        id: message.id,
        role: message.role === 'user' ? 'user' : 'model',
        text: message.content,
        timestamp: message.createdAt.getTime(),
      },
    });
  }));

  router.patch('/sessions/:id', requireAgentActor, asyncHandler(async (req, res) => {
    const actor = (req as any).actor;
    const session = await options.prisma.agentSession.findFirst({
      where: { id: req.params.id, userId: actor.userId, deletedAt: null },
    });
    if (!session) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Session not found.' });

    const data: any = {};
    if (typeof req.body?.title === 'string') data.title = cleanTitle(req.body.title) || session.title;
    if (typeof req.body?.status === 'string') data.status = req.body.status;
    const next = await options.prisma.agentSession.update({ where: { id: session.id }, data });
    res.json({ ok: true, session: serializeSession(next) });
  }));

  router.delete('/sessions/:id', requireAgentActor, asyncHandler(async (req, res) => {
    const actor = (req as any).actor;
    const session = await options.prisma.agentSession.findFirst({
      where: { id: req.params.id, userId: actor.userId, deletedAt: null },
    });
    if (!session) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Session not found.' });
    await options.prisma.agentSession.update({
      where: { id: session.id },
      data: { deletedAt: BigInt(Date.now()) },
    });
    res.json({ ok: true });
  }));

  router.get('/tool-runs/:id', authActorOrApiKey(options), asyncHandler(async (req, res) => {
    const toolRun = await options.prisma.agentToolRun.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        toolId: true,
        userId: true,
        actorId: true,
        actorDisplayName: true,
        actorRoles: true,
        sessionId: true,
        requestSource: true,
        approvalId: true,
        status: true,
        input: true,
        output: true,
        error: true,
        risk: true,
        idempotencyKey: true,
        startedAt: true,
        completedAt: true,
      },
    });
    if (!toolRun) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Tool run not found.' });
    const approval = toolRun.approvalId
      ? await options.prisma.approvalRequest.findUnique({
        where: { id: toolRun.approvalId },
        select: {
          id: true,
          requesterId: true,
          reviewerId: true,
          actionType: true,
          targetType: true,
          targetId: true,
          status: true,
          risk: true,
          payload: true,
          decisionNote: true,
          createdAt: true,
          decidedAt: true,
        },
      }).catch(() => null)
      : null;
    res.json({
      ok: true,
      toolRun: {
        ...toolRun,
        startedAt: toolRun.startedAt.toISOString(),
        completedAt: toolRun.completedAt?.toISOString() || null,
        approval: approval ? serializeApprovalRequest(approval) : null,
      },
    });
  }));

  router.post('/approvals/:id/resolve', authActorOrApiKey(options), requireRole('owner', 'admin', 'manager'), asyncHandler(async (req, res) => {
    const actor = await resolveMcpActor(req);
    const decision = normalizeApprovalDecision(req.body?.decision);
    if (!decision) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'decision must be approved, rejected, or modified.' });
    }

    const approval = await options.prisma.approvalRequest.findUnique({ where: { id: req.params.id } });
    if (!approval) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Approval request not found.' });
    if (approval.status !== 'pending') {
      return res.status(409).json({ ok: false, error: 'APPROVAL_ALREADY_RESOLVED', message: 'Approval request has already been resolved.', approval: serializeApprovalRequest(approval) });
    }

    const reviewer = await options.prisma.userAccount.findFirst({
      where: { id: actor.userId, deletedAt: null },
      select: { id: true },
    }).catch(() => null);
    const decisionNote = typeof req.body?.comment === 'string'
      ? req.body.comment.trim().slice(0, 2000)
      : typeof req.body?.decisionNote === 'string'
        ? req.body.decisionNote.trim().slice(0, 2000)
        : undefined;
    const modifiedInput = req.body?.modifiedInput && typeof req.body.modifiedInput === 'object'
      ? req.body.modifiedInput
      : req.body?.input && typeof req.body.input === 'object'
        ? req.body.input
        : undefined;
    const payload = {
      ...((approval.payload as Record<string, unknown> | null) || {}),
      resolution: {
        decision,
        decisionNote,
        modifiedInput: decision === 'modified' ? modifiedInput : undefined,
        reviewerId: reviewer?.id || null,
        reviewerDisplayName: actor.displayName,
        decidedAt: new Date().toISOString(),
      },
    };

    const updated = await options.prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: decision,
        reviewerId: reviewer?.id || null,
        decisionNote,
        decidedAt: new Date(),
        payload: payload as any,
      },
    });

    await options.prisma.auditLog.create({
      data: {
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: reviewer?.id || approval.requesterId,
        action: `agent_approval_${decision}`,
        targetType: approval.targetType,
        targetId: approval.targetId || approval.id,
        detail: {
          approvalId: approval.id,
          actionType: approval.actionType,
          risk: approval.risk,
          decision,
          decisionNote,
          modifiedInput: decision === 'modified' ? modifiedInput : undefined,
          reviewerActor: serializeActor(actor),
        } as any,
      },
    });

    const { approvalEventBus } = require('./events');
    approvalEventBus.emit('resolved', approval.id, {
      decision,
      decisionNote,
      modifiedInput: decision === 'modified' ? modifiedInput : undefined,
    });

    res.json({ ok: true, approval: serializeApprovalRequest(updated) });
  }));

  router.post('/forms/:id/submit', authActorOrApiKey(options), asyncHandler(async (req, res) => {
    const formId = req.params.id;
    const values = req.body?.values && typeof req.body.values === 'object'
      ? req.body.values as Record<string, unknown>
      : {};
    const { formEventBus } = require('./events');
    formEventBus.emit('submitted', formId, values);
    res.json({ ok: true, formId, values });
  }));

  router.get('/mcp/manifest', authActorOrApiKey(options), asyncHandler(async (_req, res) => {
    const tools = getMcpManifest();
    res.json({
      ok: true,
      schemaVersion: '2026-06-runtime-2.0',
      generatedAt: new Date().toISOString(),
      tools,
      summary: {
        total: tools.length,
        byDomain: tools.reduce<Record<string, number>>((acc, tool) => {
          acc[tool.domain] = (acc[tool.domain] || 0) + 1;
          return acc;
        }, {}),
        byRisk: tools.reduce<Record<string, number>>((acc, tool) => {
          acc[tool.risk] = (acc[tool.risk] || 0) + 1;
          return acc;
        }, {}),
        approvalRequired: tools.filter(tool => tool.safety.approval !== 'never').map(tool => tool.id),
      },
    });
  }));

  router.post('/mcp/run', authActorOrApiKey(options), asyncHandler(async (req, res) => {
    const actor = await resolveMcpActor(req);
    const query = String(req.body?.query || req.body?.message || '').trim();
    if (!req.body?.plan || !Array.isArray(req.body.plan.steps)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'plan is required.' });
    }
    const plan = req.body.plan;
    const hits = await runMcpPlan({
      prisma: options.prisma,
      actor,
      plan,
      sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
      actorUserId: actor.userId,
      requestSource: extractActorFromRequest(req) ? 'user-session' : 'api-key',
      taskFrame: query ? buildAgentTaskFrame(query) : undefined,
    });
    res.json({ ok: true, actor: serializeActor(actor), plan, hits });
  }));

  return router;
}

function asyncHandler(
  handler: (req: Request, res: Response, next?: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next?: NextFunction) => {
    handler(req, res, next).catch(error => {
      console.error('[agent] route failed:', error);
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: 'AGENT_ROUTE_FAILED',
          message: error instanceof Error ? error.message : 'Agent route failed.',
        });
      }
    });
  };
}

function requireActor(prisma: PrismaClient) {
  return asyncHandler(async (req: Request, res: Response, next?: NextFunction) => {
    const actor = extractActorFromRequest(req);
    if (!actor) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Login required.' });
    }
    (req as any).actor = actor;
    next?.();
  });
}

function auth(options: AuthOptions) {
  return (req: Request, res: Response, next: () => void) => {
    if (!options.requireAuth) return next();
    const apiKey = (req.headers['x-bambook-api-key'] || req.query.apiKey) as string | undefined;
    if (!apiKey) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'API Key is required.' });
    if (!options.apiKeys.has(apiKey)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid API Key.' });
    return next();
  };
}

function authActorOrApiKey(options: AuthOptions) {
  return (req: Request, res: Response, next: () => void) => {
    if (!options.requireAuth) return next();
    if (extractActorFromRequest(req)) return next();
    const apiKey = (req.headers['x-bambook-api-key'] || req.query.apiKey) as string | undefined;
    if (!apiKey) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login or API key is required.' });
    if (!options.apiKeys.has(apiKey)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid API Key.' });
    return next();
  };
}

function cleanTitle(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function titleFromMessage(value: string) {
  return cleanTitle(value) || '新对话';
}

function serializeSession(session: any) {
  return {
    id: session.id,
    title: session.title || '未命名对话',
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function normalizeApprovalDecision(value: unknown): 'approved' | 'rejected' | 'modified' | null {
  if (value === 'approved' || value === 'rejected' || value === 'modified') return value;
  return null;
}

function serializeApprovalRequest(approval: any) {
  return {
    id: approval.id,
    requesterId: approval.requesterId,
    reviewerId: approval.reviewerId,
    actionType: approval.actionType,
    targetType: approval.targetType,
    targetId: approval.targetId,
    status: approval.status,
    risk: approval.risk,
    payload: approval.payload,
    decisionNote: approval.decisionNote,
    createdAt: approval.createdAt?.toISOString?.() || null,
    decidedAt: approval.decidedAt?.toISOString?.() || null,
  };
}

async function resolveMcpActor(req: Request): Promise<ActorContext> {
  const jwtActor = extractActorFromRequest(req);
  if (jwtActor) {
    return createIdentityService().resolveActorContext({
      userId: jwtActor.userId,
      displayName: jwtActor.displayName,
      roles: normalizeRoles(jwtActor.roles),
      departmentIds: jwtActor.departmentIds,
    });
  }
  return createIdentityService().resolveActorContext({
    userId: String(req.body?.userId || 'api-key-agent'),
    displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : 'API Agent',
    roles: normalizeRoles(req.body?.roles),
    departmentIds: Array.isArray(req.body?.departmentIds) ? req.body.departmentIds.map(String) : ['company'],
  });
}

function normalizeRoles(value: unknown): AgentRole[] {
  const allowed = new Set(DEFAULT_AGENT_ROLES.map(role => role.id));
  const roles = Array.isArray(value) ? value.map(String).filter(role => allowed.has(role as AgentRole)) as AgentRole[] : [];
  return roles.length ? roles : ['owner'];
}

function serializeActor(actor: ActorContext) {
  return {
    userId: actor.userId,
    displayName: actor.displayName,
    roles: actor.roles,
    departmentIds: actor.departmentIds,
    toolScopes: actor.toolScopes,
  };
}
