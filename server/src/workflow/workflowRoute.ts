/**
 * Workflow Route — 工作流引擎 API
 *
 * 端点：
 *   GET    /api/v1/workflow/definitions          列出活跃的工作流定义
 *   POST   /api/v1/workflow/instances            创建工作流实例
 *   GET    /api/v1/workflow/instances            列出实例（支持过滤）
 *   GET    /api/v1/workflow/instances/:id        获取实例详情
 *   POST   /api/v1/workflow/instances/:id/approve 审批通过当前步骤
 *   POST   /api/v1/workflow/instances/:id/reject  驳回当前步骤
 *   POST   /api/v1/workflow/instances/:id/cancel  取消实例
 *   GET    /api/v1/workflow/entity/:type/:id     获取实体的工作流历史
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { WorkflowEngine } from './workflowEngine';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';

export function createWorkflowRouter(prisma: PrismaClient): Router {
  const router = Router();
  const engine = new WorkflowEngine(prisma);

  // ── 列出活跃的工作流定义 ──
  router.get('/definitions', async (_req: Request, res: Response) => {
    try {
      const defs = await engine.listDefinitions();
      res.json({ definitions: defs });
    } catch (e: any) {
      logger.error('[WorkflowRoute] GET definitions failed', { error: e?.message });
      res.status(500).json({ error: 'failed to list workflow definitions' });
    }
  });

  // ── 创建工作流实例 ──
  router.post('/instances', async (req: Request, res: Response) => {
    try {
      const { definitionId, entityType, entityId, title } = req.body;
      if (!definitionId || !entityType || !entityId) {
        return res.status(400).json({ error: 'definitionId, entityType, entityId are required' });
      }
      const actor = extractActorFromRequest(req);
      const instance = await engine.createInstance({
        definitionId,
        entityType,
        entityId,
        title,
        initiatedById: actor?.userId,
      });

      // 审计日志
      await writeRouteAuditLog({
        prisma,
        actorId: actor?.userId || 'system',
        source: 'api:workflow',
        operation: 'create_workflow_instance',
        targetType: 'WorkflowInstance',
        targetId: instance.id,
        after: { definitionId, entityType, entityId, title },
        operationType: 'create',
      });

      res.status(201).json({ instance });
    } catch (e: any) {
      logger.error('[WorkflowRoute] POST instance failed', { error: e?.message });
      const status = e?.message?.includes('不存在') || e?.message?.includes('已停用') ? 404 : 400;
      res.status(status).json({ error: e?.message || 'failed to create workflow instance' });
    }
  });

  // ── 列出实例（支持过滤）──
  router.get('/instances', async (req: Request, res: Response) => {
    try {
      const { status, entityType, entityId, initiatedById, pendingApproverUserId, pendingApproverRole, limit, offset } = req.query;
      const result = await engine.listInstances({
        status: status as any,
        entityType: entityType as string,
        entityId: entityId as string,
        initiatedById: initiatedById as string,
        pendingApproverUserId: pendingApproverUserId as string,
        pendingApproverRole: pendingApproverRole as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[WorkflowRoute] GET instances failed', { error: e?.message });
      res.status(500).json({ error: 'failed to list workflow instances' });
    }
  });

  // ── 获取实例详情 ──
  router.get('/instances/:id', async (req: Request, res: Response) => {
    try {
      const instance = await engine.getInstance(req.params.id);
      if (!instance) return res.status(404).json({ error: 'workflow instance not found' });
      res.json({ instance });
    } catch (e: any) {
      logger.error('[WorkflowRoute] GET instance failed', { error: e?.message });
      res.status(500).json({ error: 'failed to get workflow instance' });
    }
  });

  // ── 审批通过当前步骤 ──
  router.post('/instances/:id/approve', async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      if (!actor?.userId) {
        return res.status(401).json({ error: 'authentication required to approve workflow' });
      }
      const { note } = req.body;
      const instance = await engine.decideStep({
        instanceId: req.params.id,
        decidedById: actor.userId,
        decision: 'approved',
        note,
      });

      await writeRouteAuditLog({
        prisma,
        actorId: actor.userId,
        source: 'api:workflow',
        operation: 'approve_workflow_step',
        targetType: 'WorkflowInstance',
        targetId: req.params.id,
        after: { decision: 'approved', note, newStatus: instance.status },
        operationType: 'update',
      });

      res.json({ instance });
    } catch (e: any) {
      logger.error('[WorkflowRoute] POST approve failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('无法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to approve workflow step' });
    }
  });

  // ── 驳回当前步骤 ──
  router.post('/instances/:id/reject', async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      if (!actor?.userId) {
        return res.status(401).json({ error: 'authentication required to reject workflow' });
      }
      const { note } = req.body;
      const instance = await engine.decideStep({
        instanceId: req.params.id,
        decidedById: actor.userId,
        decision: 'rejected',
        note,
      });

      await writeRouteAuditLog({
        prisma,
        actorId: actor.userId,
        source: 'api:workflow',
        operation: 'reject_workflow_step',
        targetType: 'WorkflowInstance',
        targetId: req.params.id,
        after: { decision: 'rejected', note, newStatus: instance.status },
        operationType: 'update',
      });

      res.json({ instance });
    } catch (e: any) {
      logger.error('[WorkflowRoute] POST reject failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('无法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to reject workflow step' });
    }
  });

  // ── 取消实例 ──
  router.post('/instances/:id/cancel', async (req: Request, res: Response) => {
    try {
      const actor = extractActorFromRequest(req);
      const { reason } = req.body;
      const instance = await engine.cancelInstance(req.params.id, reason);

      await writeRouteAuditLog({
        prisma,
        actorId: actor?.userId || 'system',
        source: 'api:workflow',
        operation: 'cancel_workflow_instance',
        targetType: 'WorkflowInstance',
        targetId: req.params.id,
        after: { reason, status: 'cancelled' },
        operationType: 'update',
      });

      res.json({ instance });
    } catch (e: any) {
      logger.error('[WorkflowRoute] POST cancel failed', { error: e?.message });
      const status = e?.message?.includes('不存在') ? 404 : e?.message?.includes('无法') ? 409 : 400;
      res.status(status).json({ error: e?.message || 'failed to cancel workflow instance' });
    }
  });

  // ── 获取实体的工作流历史 ──
  router.get('/entity/:entityType/:entityId', async (req: Request, res: Response) => {
    try {
      const instances = await engine.getInstancesForEntity(req.params.entityType, req.params.entityId);
      res.json({ instances });
    } catch (e: any) {
      logger.error('[WorkflowRoute] GET entity history failed', { error: e?.message });
      res.status(500).json({ error: 'failed to get entity workflow history' });
    }
  });

  return router;
}
