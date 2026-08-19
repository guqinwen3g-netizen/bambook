/**
 * CRM 管理 API — /api/v1/crm
 *
 * 端点（按模型分组）：
 *
 * 联系人 Contact：
 *   GET    /:relationId/contacts                — 联系人列表
 *   POST   /:relationId/contacts                — 创建联系人
 *   GET    /contacts/:id                        — 联系人详情
 *   PUT    /contacts/:id                        — 更新联系人
 *   DELETE /contacts/:id                        — 软删除联系人
 *
 * 信用额度 CreditLimit：
 *   GET    /:relationId/credit-limit            — 当前生效信用额度
 *   GET    /:relationId/credit-limit/history    — 信用额度历史
 *   POST   /:relationId/credit-limit            — 设置信用额度（旧的自动过期）
 *   PATCH  /credit-limit/:id/status             — 更新信用额度状态
 *
 * 跟进记录 FollowUp：
 *   GET    /:relationId/follow-ups              — 跟进记录列表
 *   POST   /:relationId/follow-ups              — 创建跟进记录
 *   GET    /follow-ups/:id                      — 跟进详情
 *   PUT    /follow-ups/:id                      — 更新跟进
 *   DELETE /follow-ups/:id                      — 软删除跟进
 *   GET    /follow-ups/overdue                   — 全局逾期跟进列表
 *
 * 商机 Opportunity：
 *   GET    /opportunities                       — 商机列表（支持 stage/relation/salesRep 过滤）
 *   POST   /:relationId/opportunities           — 创建商机
 *   GET    /opportunities/:id                   — 商机详情
 *   PUT    /opportunities/:id                   — 更新商机
 *   POST   /opportunities/:id/transition        — 阶段流转
 *   DELETE /opportunities/:id                  — 软删除商机
 *   GET    /opportunities/pipeline/summary      — 商机管线汇总
 *
 * 客户分层 CustomerTier：
 *   GET    /:relationId/customer-tier           — 当前生效分层
 *   GET    /:relationId/customer-tier/history   — 分层历史
 *   POST   /:relationId/customer-tier          — 评定分层
 *   DELETE /customer-tier/:id                   — 软删除分层
 *
 * 总览：
 *   GET    /:relationId/overview                — CRM 总览（聚合所有模型）
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { logger } from '../lib/logger';
import { createCrmService, ContactInput, CreditLimitInput, FollowUpInput, OpportunityInput, CustomerTierInput } from './crmService';
import { createBrandLineService } from './brandLineService';
import { createTeamShareService } from '../teams/teamShareService';

export interface CrmRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

export function createCrmRouter(options: CrmRouterOptions): Router {
  const router = Router();
  const { prisma, requireAuth, apiKeys, onDataChange } = options;
  const service = createCrmService(prisma);
  const brandLines = createBrandLineService(prisma);
  const teamShareSvc = createTeamShareService(prisma);

  /**
   * DR-042 §6.2 跟进门禁（V1 路径——前端 apiService.listFollowUps/createFollowUp 实际消费的端点）：
   * 归属人（行级写权限，v2.1 本人维）∨ 小组共享 read+followup 档。
   * 同时补齐 PL-2B 既有缺口：V1 跟进端点此前只有认证没有行级 scope。
   */
  async function requireFollowUpWriteScope(req: Request, res: Response): Promise<boolean> {
    const relationId = req.params.relationId;
    const actor = extractActorFromRequest(req);
    if (!actor?.userId) return true; // API-Key 调用走旧口径（moduleGuard 层把关）
    try {
      const access = await teamShareSvc.resolveRelationAccess(actor, relationId);
      if (access === 'owner' || access === 'team-followup') return true;
      res.status(403).json({
        error: 'GRANT_PERMISSION_BLOCKED',
        message: access === 'team-read' ? '组共享为只读档位，不可添加跟进记录' : '无权限操作此客户的跟进记录',
      });
      return false;
    } catch (e: any) {
      logger.error('[CrmRoute] follow-up scope check failed（fail-closed）', { relationId, error: e?.message });
      res.status(403).json({ error: 'FORBIDDEN', message: '权限校验失败，拒绝操作（fail-closed）' });
      return false;
    }
  }

  /** DR-042 §5.3 派生可见（读）：部门维 ∨ 小组维共享（跟进历史随客户可见，T-17） */
  async function requireFollowUpReadScope(req: Request, res: Response): Promise<boolean> {
    const relationId = req.params.relationId;
    const actor = extractActorFromRequest(req);
    if (!actor?.userId) return true; // API-Key 调用走旧口径
    try {
      const access = await teamShareSvc.resolveRelationAccess(actor, relationId);
      if (access !== 'none') return true;
      res.status(403).json({ error: 'FORBIDDEN', message: '无权限查看此客户的跟进记录' });
      return false;
    } catch {
      return true; // 读路径 fail-open：scope 解析异常不阻断既有可见性（写路径才 fail-closed）
    }
  }

  const authenticate = (req: Request, res: Response): boolean => {
    if (!requireAuth) return true;
    const apiKey = (req.query.apiKey as string) || (req.headers['x-bambook-api-key'] as string) || (req.headers['x-api-key'] as string);
    if (apiKey && apiKeys.has(apiKey)) return true;
    const actor = extractActorFromRequest(req);
    if (actor?.userId) return true;
    res.status(401).json({ error: 'authentication required' });
    return false;
  };

  const notify = (entity: string, action: string, ids?: string[]) => {
    if (onDataChange) onDataChange({ entity, action, ids });
  };

  // 统一从 JWT 提取操作者；无 JWT（API-Key/系统调用）落 'system' 哨兵
  // （seed 保证 UserAccount 存在 id='system' 系统账号，满足 AuditLog.actorId 外键；
  //   历史上这里与旧端点曾落 'api'，但 'api' 账号不存在 → 审计写 FK 违约，已统一收敛为 'system'）
  const actorOf = (req: Request): string => extractActorFromRequest(req)?.userId || 'system';

  // ══════════════════════════════════════════════════════════════
  // 1. 联系人 Contact
  // ══════════════════════════════════════════════════════════════

  router.get('/:relationId/contacts', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const contacts = await service.listContacts(req.params.relationId);
      res.json({ contacts });
    } catch (e: any) {
      logger.error('[CrmRoute] GET contacts failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to list contacts' });
    }
  });

  router.post('/:relationId/contacts', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const contact = await service.createContact(req.params.relationId, req.body as ContactInput, actorOf(req));
      notify('Contact', 'create', [contact.id]);
      res.status(201).json({ contact });
    } catch (e: any) {
      logger.error('[CrmRoute] POST contact failed', { error: e?.message });
      res.status(400).json({ error: e?.message || 'failed to create contact' });
    }
  });

  router.get('/contacts/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const contact = await service.getContact(req.params.id);
      if (!contact) return res.status(404).json({ error: '联系人不存在' });
      res.json({ contact });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to get contact' });
    }
  });

  router.put('/contacts/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const contact = await service.updateContact(req.params.id, req.body as Partial<ContactInput>, actorOf(req));
      notify('Contact', 'update', [contact.id]);
      res.json({ contact });
    } catch (e: any) {
      logger.error('[CrmRoute] PUT contact failed', { error: e?.message });
      res.status(400).json({ error: e?.message || 'failed to update contact' });
    }
  });

  router.delete('/contacts/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteContact(req.params.id, actorOf(req));
      notify('Contact', 'delete', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to delete contact' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 2. 信用额度 CreditLimit
  // ══════════════════════════════════════════════════════════════

  router.get('/:relationId/credit-limit', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const cl = await service.getActiveCreditLimit(req.params.relationId);
      res.json({ creditLimit: cl });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to get credit limit' });
    }
  });

  router.get('/:relationId/credit-limit/history', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const history = await service.listCreditLimitHistory(req.params.relationId);
      res.json({ history });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to list credit limit history' });
    }
  });

  router.post('/:relationId/credit-limit', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const cl = await service.setCreditLimit(req.params.relationId, req.body as CreditLimitInput, actorOf(req));
      notify('CreditLimit', 'create', [cl.id]);
      res.status(201).json({ creditLimit: cl });
    } catch (e: any) {
      logger.error('[CrmRoute] POST credit limit failed', { error: e?.message });
      res.status(400).json({ error: e?.message || 'failed to set credit limit' });
    }
  });

  router.patch('/credit-limit/:id/status', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { status } = req.body as { status: string };
      const cl = await service.updateCreditLimitStatus(req.params.id, status, actorOf(req));
      notify('CreditLimit', 'update', [cl.id]);
      res.json({ creditLimit: cl });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to update credit limit status' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 3. 跟进记录 FollowUp
  // ══════════════════════════════════════════════════════════════

  router.get('/:relationId/follow-ups', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    if (!(await requireFollowUpReadScope(req, res))) return; // DR-042 §5.3 派生可见
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const includeCompleted = req.query.includeCompleted === 'true';
      const followUps = await service.listFollowUps(req.params.relationId, { limit, includeCompleted });
      res.json({ followUps });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to list follow-ups' });
    }
  });

  router.post('/:relationId/follow-ups', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    if (!(await requireFollowUpWriteScope(req, res))) return; // DR-042 §6.2 跟进门禁（T-18/T-20）
    try {
      const fu = await service.createFollowUp(req.params.relationId, req.body as FollowUpInput, actorOf(req));
      notify('FollowUpRecord', 'create', [fu.id]);
      res.status(201).json({ followUp: fu });
    } catch (e: any) {
      logger.error('[CrmRoute] POST follow-up failed', { error: e?.message });
      res.status(400).json({ error: e?.message || 'failed to create follow-up' });
    }
  });

  router.get('/follow-ups/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const fu = await service.getFollowUp(req.params.id);
      if (!fu) return res.status(404).json({ error: '跟进记录不存在' });
      res.json({ followUp: fu });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to get follow-up' });
    }
  });

  router.put('/follow-ups/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const fu = await service.updateFollowUp(req.params.id, req.body as Partial<FollowUpInput>, actorOf(req));
      notify('FollowUpRecord', 'update', [fu.id]);
      res.json({ followUp: fu });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to update follow-up' });
    }
  });

  router.delete('/follow-ups/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteFollowUp(req.params.id, actorOf(req));
      notify('FollowUpRecord', 'delete', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to delete follow-up' });
    }
  });

  router.get('/follow-ups/overdue', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const daysAhead = req.query.daysAhead ? parseInt(req.query.daysAhead as string, 10) : 0;
      const overdue = await service.listOverdueFollowUps(daysAhead);
      res.json({ overdue });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to list overdue follow-ups' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 4. 商机 Opportunity
  // ══════════════════════════════════════════════════════════════

  router.get('/opportunities', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { relationId, stage, salesRepId } = req.query;
      const opportunities = await service.listOpportunities({
        relationId: relationId as string | undefined,
        stage: stage as string | undefined,
        salesRepId: salesRepId as string | undefined,
      });
      res.json({ opportunities });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to list opportunities' });
    }
  });

  router.post('/:relationId/opportunities', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const opp = await service.createOpportunity(req.params.relationId, req.body as OpportunityInput, actorOf(req));
      notify('Opportunity', 'create', [opp.id]);
      res.status(201).json({ opportunity: opp });
    } catch (e: any) {
      logger.error('[CrmRoute] POST opportunity failed', { error: e?.message });
      res.status(400).json({ error: e?.message || 'failed to create opportunity' });
    }
  });

  router.get('/opportunities/pipeline/summary', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { salesRepId } = req.query;
      const summary = await service.getOpportunityPipelineSummary({
        salesRepId: salesRepId as string | undefined,
      });
      res.json({ summary });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to get pipeline summary' });
    }
  });

  router.get('/opportunities/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const opp = await service.getOpportunity(req.params.id);
      if (!opp) return res.status(404).json({ error: '商机不存在' });
      res.json({ opportunity: opp });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to get opportunity' });
    }
  });

  router.put('/opportunities/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const opp = await service.updateOpportunity(req.params.id, req.body as Partial<OpportunityInput>, actorOf(req));
      notify('Opportunity', 'update', [opp.id]);
      res.json({ opportunity: opp });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to update opportunity' });
    }
  });

  router.post('/opportunities/:id/transition', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const { toStage } = req.body as { toStage: string };
      const opp = await service.transitionOpportunityStage(req.params.id, toStage, actorOf(req));
      notify('Opportunity', 'transition', [opp.id]);
      res.json({ opportunity: opp });
    } catch (e: any) {
      logger.error('[CrmRoute] POST opportunity transition failed', { error: e?.message });
      res.status(400).json({ error: e?.message || 'failed to transition opportunity' });
    }
  });

  router.delete('/opportunities/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteOpportunity(req.params.id, actorOf(req));
      notify('Opportunity', 'delete', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to delete opportunity' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 5. 客户分层 CustomerTier
  // ══════════════════════════════════════════════════════════════

  router.get('/:relationId/customer-tier', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const tier = await service.getActiveCustomerTier(req.params.relationId);
      res.json({ customerTier: tier });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to get customer tier' });
    }
  });

  router.get('/:relationId/customer-tier/history', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const history = await service.listCustomerTierHistory(req.params.relationId);
      res.json({ history });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to list tier history' });
    }
  });

  router.post('/:relationId/customer-tier', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const tier = await service.assignCustomerTier(req.params.relationId, req.body as CustomerTierInput, actorOf(req));
      notify('CustomerTier', 'create', [tier.id]);
      res.status(201).json({ customerTier: tier });
    } catch (e: any) {
      logger.error('[CrmRoute] POST customer tier failed', { error: e?.message });
      res.status(400).json({ error: e?.message || 'failed to assign customer tier' });
    }
  });

  router.delete('/customer-tier/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteCustomerTier(req.params.id, actorOf(req));
      notify('CustomerTier', 'delete', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to delete customer tier' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 6. 品牌线 BrandLine（阶段 P3b，PRD 6.2）
  // ══════════════════════════════════════════════════════════════

  router.get('/:relationId/brand-lines', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
      const result = await brandLines.listBrandLines(req.params.relationId, includeInactive);
      res.json(result);
    } catch (e: any) {
      logger.error('[CrmRoute] GET brand-lines failed', { error: e?.message });
      res.status(e?.message?.includes('不存在') ? 404 : 500).json({ error: e?.message || 'failed to list brand lines' });
    }
  });

  router.post('/:relationId/brand-lines', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await brandLines.createBrandLine(req.params.relationId, req.body ?? {}, actorOf(req));
      notify('BrandLine', 'create', [item.id]);
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CrmRoute] POST brand-line failed', { error: e?.message });
      const msg = e?.message || '';
      res.status(msg.includes('不存在') ? 404 : msg.includes('已存在') ? 409 : 400).json({ error: msg || 'failed to create brand line' });
    }
  });

  router.put('/brand-lines/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await brandLines.updateBrandLine(req.params.id, req.body ?? {}, actorOf(req));
      notify('BrandLine', 'update', [item.id]);
      res.json({ item });
    } catch (e: any) {
      logger.error('[CrmRoute] PUT brand-line failed', { error: e?.message });
      const msg = e?.message || '';
      res.status(msg.includes('不存在') ? 404 : msg.includes('已存在') ? 409 : 400).json({ error: msg || 'failed to update brand line' });
    }
  });

  router.delete('/brand-lines/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await brandLines.deleteBrandLine(req.params.id, actorOf(req));
      notify('BrandLine', 'delete', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[CrmRoute] DELETE brand-line failed', { error: e?.message });
      res.status(e?.message?.includes('不存在') ? 404 : 400).json({ error: e?.message || 'failed to delete brand line' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 7. 沟通日志 CommunicationLog（阶段 P3b，PRD 12.3）
  // ══════════════════════════════════════════════════════════════

  router.get('/:relationId/comm-logs', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const result = await brandLines.listCommunicationLogs(req.params.relationId, {
        type: req.query.type as string | undefined,
        direction: req.query.direction as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logger.error('[CrmRoute] GET comm-logs failed', { error: e?.message });
      res.status(e?.message?.includes('不存在') ? 404 : 500).json({ error: e?.message || 'failed to list communication logs' });
    }
  });

  router.post('/:relationId/comm-logs', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await brandLines.createCommunicationLog(req.params.relationId, req.body ?? {}, actorOf(req));
      notify('CommunicationLog', 'create', [item.id]);
      res.status(201).json({ item });
    } catch (e: any) {
      logger.error('[CrmRoute] POST comm-log failed', { error: e?.message });
      res.status(e?.message?.includes('不存在') ? 404 : 400).json({ error: e?.message || 'failed to create communication log' });
    }
  });

  router.put('/comm-logs/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const item = await brandLines.updateCommunicationLog(req.params.id, req.body ?? {}, actorOf(req));
      notify('CommunicationLog', 'update', [item.id]);
      res.json({ item });
    } catch (e: any) {
      logger.error('[CrmRoute] PUT comm-log failed', { error: e?.message });
      res.status(e?.message?.includes('不存在') ? 404 : 400).json({ error: e?.message || 'failed to update communication log' });
    }
  });

  router.delete('/comm-logs/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await brandLines.deleteCommunicationLog(req.params.id, actorOf(req));
      notify('CommunicationLog', 'delete', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      logger.error('[CrmRoute] DELETE comm-log failed', { error: e?.message });
      res.status(e?.message?.includes('不存在') ? 404 : 400).json({ error: e?.message || 'failed to delete communication log' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 总览 Overview
  // ══════════════════════════════════════════════════════════════

  router.get('/:relationId/overview', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      const overview = await service.getRelationCrmOverview(req.params.relationId);
      res.json(overview);
    } catch (e: any) {
      logger.error('[CrmRoute] GET overview failed', { error: e?.message });
      res.status(500).json({ error: e?.message || 'failed to get CRM overview' });
    }
  });

  return router;
}
