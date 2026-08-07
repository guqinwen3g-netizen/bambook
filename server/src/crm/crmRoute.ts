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

  const authenticate = (req: Request, res: Response): boolean => {
    if (!requireAuth) return true;
    const apiKey = req.query.apiKey as string || req.headers['x-api-key'] as string;
    if (apiKey && apiKeys.has(apiKey)) return true;
    const actor = extractActorFromRequest(req);
    if (actor?.userId) return true;
    res.status(401).json({ error: 'authentication required' });
    return false;
  };

  const notify = (entity: string, action: string, ids?: string[]) => {
    if (onDataChange) onDataChange({ entity, action, ids });
  };

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
      const contact = await service.createContact(req.params.relationId, req.body as ContactInput, (req as any).actorId || 'api');
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
      const contact = await service.updateContact(req.params.id, req.body as Partial<ContactInput>, (req as any).actorId || 'api');
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
      await service.deleteContact(req.params.id, (req as any).actorId || 'api');
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
      const cl = await service.setCreditLimit(req.params.relationId, req.body as CreditLimitInput, (req as any).actorId || 'api');
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
      const cl = await service.updateCreditLimitStatus(req.params.id, status, (req as any).actorId || 'api');
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
    try {
      const fu = await service.createFollowUp(req.params.relationId, req.body as FollowUpInput, (req as any).actorId || 'api');
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
      const fu = await service.updateFollowUp(req.params.id, req.body as Partial<FollowUpInput>, (req as any).actorId || 'api');
      notify('FollowUpRecord', 'update', [fu.id]);
      res.json({ followUp: fu });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to update follow-up' });
    }
  });

  router.delete('/follow-ups/:id', async (req: Request, res: Response) => {
    if (!authenticate(req, res)) return;
    try {
      await service.deleteFollowUp(req.params.id, (req as any).actorId || 'api');
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
      const opp = await service.createOpportunity(req.params.relationId, req.body as OpportunityInput, (req as any).actorId || 'api');
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
      const opp = await service.updateOpportunity(req.params.id, req.body as Partial<OpportunityInput>, (req as any).actorId || 'api');
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
      const opp = await service.transitionOpportunityStage(req.params.id, toStage, (req as any).actorId || 'api');
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
      await service.deleteOpportunity(req.params.id, (req as any).actorId || 'api');
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
      const tier = await service.assignCustomerTier(req.params.relationId, req.body as CustomerTierInput, (req as any).actorId || 'api');
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
      await service.deleteCustomerTier(req.params.id, (req as any).actorId || 'api');
      notify('CustomerTier', 'delete', [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'failed to delete customer tier' });
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
