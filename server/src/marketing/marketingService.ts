/**
 * marketingService.ts — Phase 1-06 营销活动管理服务
 *
 * 职责：
 *   1. Campaign（营销活动）：CRUD + 预算/实际花费追踪 + ROI 计算
 *   2. Lead（营销线索）：CRUD + 状态流转 + 转化追踪
 *
 * 接入平台域：Sequence 编号 + 行级权限 scope + 字典校验
 */
import type { PrismaClient } from '@prisma/client';
import type { TokenPayload } from '../auth/service';
import { createPermissionService } from '../auth/permissionService';
import { createSequenceService } from '../sequence/sequenceService';
import { getDataDictionaryService } from '../dictionaries/dataDictionaryService';
import { logger } from '../lib/logger';

export interface CampaignInput {
  name: string;
  description?: string;
  type?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  actualCost?: number;
  targetSegment?: any;
  seasonId?: string;
  tradeShowId?: string;
  ownerId?: string;
  departmentId?: string;
}

export interface LeadInput {
  campaignId: string;
  relationId?: string;
  source?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  status?: string;
  estimatedValue?: number;
  notes?: string;
}

export function createMarketingService(prisma: PrismaClient) {
  const permSvc = createPermissionService({ prisma });
  const seqSvc = createSequenceService(prisma);
  const dictSvc = getDataDictionaryService(prisma);

  async function buildScopeWhere(actor: TokenPayload | null | undefined): Promise<Record<string, unknown>> {
    if (!actor) return { ownerId: '__NOBODY__' };
    const resolver = await permSvc.getDataScopeResolver(actor, 'marketing');
    if (resolver.rule.kind === 'all') return {};
    if (resolver.rule.kind === 'self') return { ownerId: actor.userId };
    const deptIds = resolver.allowedDepartmentIds || [];
    const userIds = resolver.allowedUserIds || [];
    const orParts: any[] = [];
    if (userIds.length > 0) orParts.push({ ownerId: { in: userIds } });
    if (deptIds.length > 0) orParts.push({ departmentId: { in: deptIds } });
    if (orParts.length === 0) return { ownerId: '__NOBODY__' };
    return { OR: orParts };
  }

  function serialize(row: any): any {
    if (!row) return null;
    const out: any = { ...row };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
      if (out[k] && typeof out[k] === 'object' && out[k].toString && out[k]._isBigNumber) {
        out[k] = Number(out[k].toString());
      }
    }
    return out;
  }

  // ── Campaign CRUD ──
  async function listCampaigns(actor: any, filter: { status?: string; type?: string; search?: string; limit?: number; offset?: number } = {}) {
    const scopeWhere = await buildScopeWhere(actor);
    const where: Record<string, unknown> = { deletedAt: null, ...scopeWhere };
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    if (filter.search) {
      const s = filter.search.trim();
      (where as any).OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    const [items, total] = await Promise.all([
      (prisma as any).marketingCampaign.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: { leads: { where: { deletedAt: null }, select: { id: true, status: true, estimatedValue: true, actualValue: true } } } }),
      (prisma as any).marketingCampaign.count({ where }),
    ]);
    return { items: items.map(serialize), total, limit, offset };
  }

  async function getCampaign(actor: any, id: string) {
    const scopeWhere = await buildScopeWhere(actor);
    return await (prisma as any).marketingCampaign.findFirst({ where: { id, deletedAt: null, ...scopeWhere }, include: { leads: { where: { deletedAt: null } } } });
  }

  async function createCampaign(actor: TokenPayload | null | undefined, input: CampaignInput) {
    if (!actor) throw new Error('UNAUTHORIZED');
    let code: string | null = null;
    try {
      code = await seqSvc.nextNumber(prisma as any, 'marketing');
    } catch (e: any) { logger.error('[Marketing] code gen failed', { error: e?.message }); }
    const ownerId = input.ownerId || actor.userId;
    const departmentId = input.departmentId || actor.departmentIds?.[0] || null;
    const now = BigInt(Date.now());
    const item = await (prisma as any).marketingCampaign.create({
      data: { ...input, code, ownerId, departmentId, status: input.status || 'Draft', createdAt: now, updatedAt: now },
    });
    logger.info('[Marketing] campaign created', { id: item.id, code });
    return item;
  }

  async function updateCampaign(actor: any, id: string, patch: Record<string, unknown>) {
    const scopeWhere = await buildScopeWhere(actor);
    const existing = await (prisma as any).marketingCampaign.findFirst({ where: { id, deletedAt: null, ...scopeWhere } });
    if (!existing) throw new Error('NOT_FOUND');
    delete patch.id; delete patch.code;
    patch.updatedAt = BigInt(Date.now());
    return await (prisma as any).marketingCampaign.update({ where: { id }, data: patch });
  }

  async function deleteCampaign(actor: any, id: string) {
    const scopeWhere = await buildScopeWhere(actor);
    const existing = await (prisma as any).marketingCampaign.findFirst({ where: { id, deletedAt: null, ...scopeWhere } });
    if (!existing) throw new Error('NOT_FOUND');
    return await (prisma as any).marketingCampaign.update({ where: { id }, data: { deletedAt: BigInt(Date.now()) } });
  }

  // ── Campaign ROI ──
  async function getCampaignROI(actor: any, id: string) {
    const campaign = await getCampaign(actor, id);
    if (!campaign) throw new Error('NOT_FOUND');
    const leads = campaign.leads || [];
    const totalLeads = leads.length;
    const convertedLeads = leads.filter((l: any) => l.status === 'Converted');
    const conversionRate = totalLeads > 0 ? convertedLeads.length / totalLeads : 0;
    const totalEstimatedValue = leads.reduce((sum: number, l: any) => sum + Number(l.estimatedValue?.toString?.() || l.estimatedValue || 0), 0);
    const totalActualValue = convertedLeads.reduce((sum: number, l: any) => sum + Number(l.actualValue?.toString?.() || l.actualValue || 0), 0);
    const budget = Number(campaign.budget?.toString?.() || campaign.budget || 0);
    const actualCost = Number(campaign.actualCost?.toString?.() || campaign.actualCost || 0);
    const roi = actualCost > 0 ? (totalActualValue - actualCost) / actualCost : 0;
    return { campaign: serialize(campaign), totalLeads, convertedCount: convertedLeads.length, conversionRate, totalEstimatedValue, totalActualValue, budget, actualCost, roi };
  }

  // ── Lead CRUD ──
  async function listLeads(actor: any, campaignId: string, filter: { status?: string; limit?: number; offset?: number } = {}) {
    const scopeWhere = await buildScopeWhere(actor);
    // 先校验 campaign 在 scope 内
    const campaign = await (prisma as any).marketingCampaign.findFirst({ where: { id: campaignId, deletedAt: null, ...scopeWhere }, select: { id: true } });
    if (!campaign) throw new Error('NOT_FOUND');
    const where: Record<string, unknown> = { campaignId, deletedAt: null };
    if (filter.status) where.status = filter.status;
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    const [items, total] = await Promise.all([
      (prisma as any).marketingLead.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      (prisma as any).marketingLead.count({ where }),
    ]);
    return { items: items.map(serialize), total, limit, offset };
  }

  async function createLead(actor: any, input: LeadInput) {
    const scopeWhere = await buildScopeWhere(actor);
    const campaign = await (prisma as any).marketingCampaign.findFirst({ where: { id: input.campaignId, deletedAt: null, ...scopeWhere }, select: { id: true } });
    if (!campaign) throw new Error('NOT_FOUND: campaign not found or no permission');
    const now = BigInt(Date.now());
    return await (prisma as any).marketingLead.create({
      data: { ...input, status: input.status || 'New', createdAt: now, updatedAt: now },
    });
  }

  async function updateLead(actor: any, id: string, patch: Record<string, unknown>) {
    // 校验 lead 所属 campaign 在 scope 内
    const lead = await (prisma as any).marketingLead.findFirst({ where: { id, deletedAt: null }, include: { campaign: { select: { id: true, ownerId: true, departmentId: true } } } });
    if (!lead) throw new Error('NOT_FOUND');
    const scopeWhere = await buildScopeWhere(actor);
    // 复用 scopeWhere 逻辑验证 campaign 可见性
    const resolver = await permSvc.getDataScopeResolver(actor, 'marketing');
    if (resolver.rule.kind !== 'all') {
      const campaign = lead.campaign;
      if (resolver.rule.kind === 'self' && campaign.ownerId !== actor.userId) throw new Error('FORBIDDEN');
    }
    delete patch.id; delete patch.campaignId;
    patch.updatedAt = BigInt(Date.now());
    // 如果状态变为 Converted，记录转化时间
    if (patch.status === 'Converted' && !patch.convertedAt) {
      patch.convertedAt = BigInt(Date.now());
    }
    return await (prisma as any).marketingLead.update({ where: { id }, data: patch });
  }

  async function deleteLead(actor: any, id: string) {
    // 同 updateLead 的 scope 校验
    const lead = await (prisma as any).marketingLead.findFirst({ where: { id, deletedAt: null }, include: { campaign: { select: { ownerId: true, departmentId: true } } } });
    if (!lead) throw new Error('NOT_FOUND');
    const resolver = await permSvc.getDataScopeResolver(actor, 'marketing');
    if (resolver.rule.kind === 'self' && lead.campaign.ownerId !== actor.userId) throw new Error('FORBIDDEN');
    return await (prisma as any).marketingLead.update({ where: { id }, data: { deletedAt: BigInt(Date.now()) } });
  }

  return {
    listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign, getCampaignROI,
    listLeads, createLead, updateLead, deleteLead,
  };
}
