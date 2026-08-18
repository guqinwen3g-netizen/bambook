/**
 * crmRouteV2.ts — Phase 1 CRM V2 路由（权限守卫 + 行级 scope）
 *
 * 挂载点：/api/v2/crm
 *
 * 与 V1 的区别：
 *   - requirePermission 守卫（crm:read / crm:write）
 *   - 所有端点先校验 relationId 是否在 actor 的 dataScope 内
 *   - 业务逻辑复用现有 crmService
 *
 * 注意：crmService 方法返回实体（非 {ok,data}），且需要 actorId: string
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { requirePermission } from '../auth/permissionGuard';
import { extractActorFromRequest } from '../auth/middleware';
import { createPermissionService } from '../auth/permissionService';
import { createTeamShareService } from '../teams/teamShareService';
import { createCrmService } from './crmService';
import { logger } from '../lib/logger';

export interface CrmV2RouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

export function createCrmV2Router(opts: CrmV2RouterOptions): Router {
  const router = Router();
  router.use(createModuleAuthGuard({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys }));
  const requireWrite = requireJwtForWrite({ requireAuth: opts.requireAuth, apiKeys: opts.apiKeys });

  const svc = createCrmService(opts.prisma);
  const permSvc = createPermissionService({ prisma: opts.prisma });
  const teamShareSvc = createTeamShareService(opts.prisma);

  const actorOf = (req: Request) => extractActorFromRequest(req);
  const actorId = (req: Request) => actorOf(req)?.userId || '';

  // ── 行级权限：校验 relationId 是否在 actor 的 dataScope 内（部门维，DR-042 写口径）──
  async function checkRelationScope(actor: any, relationId: string): Promise<boolean> {
    if (!actor) return false;
    const resolver = await permSvc.getDataScopeResolver(actor, 'relations');
    if (resolver.rule.kind === 'all') return true;
    const rel = await (opts.prisma as any).relation.findFirst({
      where: { id: relationId, deletedAt: null },
      select: { ownerId: true, departmentId: true },
    });
    if (!rel) return false;
    if (resolver.rule.kind === 'self') return rel.ownerId === actor.userId;
    const deptIds = resolver.allowedDepartmentIds || [];
    const userIds = resolver.allowedUserIds || [];
    if (userIds.length > 0 && rel.ownerId && userIds.includes(rel.ownerId)) return true;
    if (deptIds.length > 0 && rel.departmentId && deptIds.includes(rel.departmentId)) return true;
    return false;
  }

  async function requireRelationScope(req: Request, res: Response): Promise<boolean> {
    const relationId = req.params.relationId;
    if (!relationId) return true;
    const ok = await checkRelationScope(actorOf(req), relationId);
    if (!ok) { res.status(403).json({ error: 'FORBIDDEN', message: '无权限操作此客户的 CRM 数据' }); return false; }
    return true;
  }

  // ── DR-042 §5.3 派生可见：读 = 部门维 ∨ 小组维共享（跟进历史/联系人等子实体随客户可见，T-17）──
  async function requireRelationReadScope(req: Request, res: Response): Promise<boolean> {
    const relationId = req.params.relationId;
    if (!relationId) return true;
    const actor = actorOf(req);
    if (await checkRelationScope(actor, relationId)) return true;
    const access = await teamShareSvc.resolveRelationAccess(actor, relationId);
    if (access === 'team-followup' || access === 'team-read') return true;
    res.status(403).json({ error: 'FORBIDDEN', message: '无权限查看此客户的 CRM 数据' });
    return false;
  }

  function serialize(row: any): any {
    if (!row) return null;
    const out: any = { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
      if (out[k] && typeof out[k] === 'object' && out[k].toString && typeof out[k].toString === 'function' && out[k]._isBigNumber) {
        out[k] = Number(out[k].toString());
      }
    }
    return out;
  }

  // ═══════════ Contact ═══════════
  router.get('/:relationId/contacts', requirePermission('crm:read'), async (req, res) => {
    // DR-042 §5.3 派生可见：联系人随客户可见（组员协作必需——知道联系谁）
    if (!(await requireRelationReadScope(req, res))) return;
    try {
      const items = await svc.listContacts(req.params.relationId);
      res.json({ ok: true, contacts: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:relationId/contacts', requireWrite, requirePermission('crm:write'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const item = await svc.createContact(req.params.relationId, req.body, actorId(req));
      res.json({ ok: true, contact: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/contacts/:id', requirePermission('crm:read'), async (req, res) => {
    try {
      const item = await svc.getContact(req.params.id);
      if (!item) return res.status(404).json({ error: 'NOT_FOUND', message: '联系人不存在' });
      if (item.relationId && !(await checkRelationScope(actorOf(req), item.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限查看此联系人' });
      }
      res.json({ ok: true, contact: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/contacts/:id', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      const existing = await svc.getContact(req.params.id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: '联系人不存在' });
      if (existing.relationId && !(await checkRelationScope(actorOf(req), existing.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限操作此联系人' });
      }
      const item = await svc.updateContact(req.params.id, req.body, actorId(req));
      res.json({ ok: true, contact: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/contacts/:id', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      const existing = await svc.getContact(req.params.id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: '联系人不存在' });
      if (existing.relationId && !(await checkRelationScope(actorOf(req), existing.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限操作此联系人' });
      }
      await svc.deleteContact(req.params.id, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ═══════════ CreditLimit ═══════════
  router.get('/:relationId/credit-limit', requirePermission('crm:read'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const item = await svc.getActiveCreditLimit(req.params.relationId);
      res.json({ ok: true, creditLimit: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/:relationId/credit-limit/history', requirePermission('crm:read'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const items = await svc.listCreditLimitHistory(req.params.relationId);
      res.json({ ok: true, history: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:relationId/credit-limit', requireWrite, requirePermission('crm:write'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const item = await svc.setCreditLimit(req.params.relationId, req.body, actorId(req));
      res.json({ ok: true, creditLimit: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.patch('/credit-limit/:id/status', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      const item = await svc.updateCreditLimitStatus(req.params.id, req.body?.status, actorId(req));
      res.json({ ok: true, creditLimit: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ═══════════ FollowUp ═══════════
  router.get('/:relationId/follow-ups', requirePermission('crm:read'), async (req, res) => {
    // DR-042 §5.3：跟进历史派生可见（部门维 ∨ 小组维共享，T-17）
    if (!(await requireRelationReadScope(req, res))) return;
    try {
      const items = await svc.listFollowUps(req.params.relationId);
      res.json({ ok: true, followUps: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:relationId/follow-ups', requireWrite, requirePermission('crm:write'), async (req, res) => {
    // DR-042 §6.2 跟进门禁：归属部门（部门维写权限）∨ 小组共享 read+followup 档（T-18/T-20）
    const relationId = req.params.relationId;
    const actor = actorOf(req);
    const deptOk = await checkRelationScope(actor, relationId);
    if (!deptOk) {
      const access = await teamShareSvc.resolveRelationAccess(actor, relationId);
      if (access !== 'team-followup') {
        return res.status(403).json({
          error: 'GRANT_PERMISSION_BLOCKED',
          message: access === 'team-read' ? '组共享为只读档位，不可添加跟进记录' : '无权限操作此客户的 CRM 数据',
        });
      }
    }
    try {
      const item = await svc.createFollowUp(req.params.relationId, req.body, actorId(req));
      res.json({ ok: true, followUp: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/follow-ups/overdue', requirePermission('crm:read'), async (req, res) => {
    try {
      const items = await svc.listOverdueFollowUps();
      const actor = actorOf(req);
      const resolver = await permSvc.getDataScopeResolver(actor, 'relations');
      if (resolver.rule.kind === 'all') {
        res.json({ ok: true, overdueFollowUps: items.map(serialize) });
      } else {
        const filtered = [];
        for (const f of items) {
          if (f.relationId && await checkRelationScope(actor, f.relationId)) filtered.push(serialize(f));
        }
        res.json({ ok: true, overdueFollowUps: filtered });
      }
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/follow-ups/:id', requirePermission('crm:read'), async (req, res) => {
    try {
      const item = await svc.getFollowUp(req.params.id);
      if (!item) return res.status(404).json({ error: 'NOT_FOUND', message: '跟进记录不存在' });
      if (item.relationId && !(await checkRelationScope(actorOf(req), item.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限查看此跟进记录' });
      }
      res.json({ ok: true, followUp: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/follow-ups/:id', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      const existing = await svc.getFollowUp(req.params.id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: '跟进记录不存在' });
      if (existing.relationId && !(await checkRelationScope(actorOf(req), existing.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限操作此跟进记录' });
      }
      const item = await svc.updateFollowUp(req.params.id, req.body, actorId(req));
      res.json({ ok: true, followUp: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/follow-ups/:id', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      const existing = await svc.getFollowUp(req.params.id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: '跟进记录不存在' });
      if (existing.relationId && !(await checkRelationScope(actorOf(req), existing.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限操作此跟进记录' });
      }
      await svc.deleteFollowUp(req.params.id, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ═══════════ Opportunity ═══════════
  router.get('/opportunities', requirePermission('crm:read'), async (req, res) => {
    try {
      const opts: any = {};
      if (typeof req.query.stage === 'string') opts.stage = req.query.stage;
      if (typeof req.query.relationId === 'string') opts.relationId = req.query.relationId;
      if (typeof req.query.salesRepId === 'string') opts.salesRepId = req.query.salesRepId;
      const items = await svc.listOpportunities(opts);
      const actor = actorOf(req);
      const resolver = await permSvc.getDataScopeResolver(actor, 'relations');
      if (resolver.rule.kind === 'all') {
        res.json({ ok: true, opportunities: items.map(serialize) });
      } else {
        const filtered = [];
        for (const o of items) {
          if (o.relationId && await checkRelationScope(actor, o.relationId)) filtered.push(serialize(o));
        }
        res.json({ ok: true, opportunities: filtered });
      }
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:relationId/opportunities', requireWrite, requirePermission('crm:write'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const item = await svc.createOpportunity(req.params.relationId, req.body, actorId(req));
      res.json({ ok: true, opportunity: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/opportunities/pipeline/summary', requirePermission('crm:read'), async (req, res) => {
    try {
      const data = await svc.getOpportunityPipelineSummary();
      res.json({ ok: true, pipeline: data });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/opportunities/:id', requirePermission('crm:read'), async (req, res) => {
    try {
      const item = await svc.getOpportunity(req.params.id);
      if (!item) return res.status(404).json({ error: 'NOT_FOUND', message: '商机不存在' });
      if (item.relationId && !(await checkRelationScope(actorOf(req), item.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限查看此商机' });
      }
      res.json({ ok: true, opportunity: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.put('/opportunities/:id', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      const existing = await svc.getOpportunity(req.params.id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: '商机不存在' });
      if (existing.relationId && !(await checkRelationScope(actorOf(req), existing.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限操作此商机' });
      }
      const item = await svc.updateOpportunity(req.params.id, req.body, actorId(req));
      res.json({ ok: true, opportunity: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/opportunities/:id/transition', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      const existing = await svc.getOpportunity(req.params.id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: '商机不存在' });
      if (existing.relationId && !(await checkRelationScope(actorOf(req), existing.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限操作此商机' });
      }
      const toStage = typeof req.body?.toStage === 'string' ? req.body.toStage.trim() : '';
      if (!toStage) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'body.toStage 必填' });
      const item = await svc.transitionOpportunityStage(req.params.id, toStage, actorId(req));
      res.json({ ok: true, opportunity: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/opportunities/:id', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      const existing = await svc.getOpportunity(req.params.id);
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: '商机不存在' });
      if (existing.relationId && !(await checkRelationScope(actorOf(req), existing.relationId))) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权限操作此商机' });
      }
      await svc.deleteOpportunity(req.params.id, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ═══════════ CustomerTier ═══════════
  router.get('/:relationId/customer-tier', requirePermission('crm:read'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const item = await svc.getActiveCustomerTier(req.params.relationId);
      res.json({ ok: true, customerTier: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.get('/:relationId/customer-tier/history', requirePermission('crm:read'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const items = await svc.listCustomerTierHistory(req.params.relationId);
      res.json({ ok: true, history: items.map(serialize) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.post('/:relationId/customer-tier', requireWrite, requirePermission('crm:write'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const item = await svc.assignCustomerTier(req.params.relationId, req.body, actorId(req));
      res.json({ ok: true, customerTier: serialize(item) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  router.delete('/customer-tier/:id', requireWrite, requirePermission('crm:write'), async (req, res) => {
    try {
      await svc.deleteCustomerTier(req.params.id, actorId(req));
      res.json({ ok: true, deleted: true });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  // ═══════════ Overview ═══════════
  router.get('/:relationId/overview', requirePermission('crm:read'), async (req, res) => {
    if (!(await requireRelationScope(req, res))) return;
    try {
      const data = await svc.getRelationCrmOverview(req.params.relationId);
      res.json({ ok: true, ...serialize(data) });
    } catch (e: any) { res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message }); }
  });

  return router;
}
