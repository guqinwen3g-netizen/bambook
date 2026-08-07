/**
 * Phase 3 C1 CRM 深化服务
 *
 * 职责：
 *   1. 联系人管理（Contact）：多联系人/主联系人/决策人标记
 *   2. 信用额度（CreditLimit）：额度管理/用量跟踪/超额检测
 *   3. 跟进记录（FollowUpRecord）：销售跟进日志/下次跟进/逾期检测
 *   4. 商机管线（Opportunity）：销售管线阶段流转/成交/流失
 *   5. 客户分层（CustomerTier）：分层评定/权益管理
 *
 * 设计原则：
 *   - 软删除（deletedAt BigInt），不物理删除
 *   - 事务内创建/更新 + 审计日志
 *   - 业务事件发布（信用超额/商机阶段变更/分层评定）
 *   - 事件发布失败不阻断业务（fire-and-forget）
 */

import { PrismaClient, Contact, CreditLimit, FollowUpRecord, Opportunity, CustomerTier } from '@prisma/client';
import { logger } from '../lib/logger';
import { publishBusinessEvent } from '../events/businessEventBus';
import { deactivateEntityLinks, syncOpportunityReferences } from '../entities/sync';

// ────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────

export interface ContactInput {
  name: string;
  title?: string;
  department?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  wechat?: string;
  whatsapp?: string;
  isPrimary?: boolean;
  isDecisionMaker?: boolean;
  birthday?: string;
  personalNote?: string;
  tags?: string[];
}

export interface CreditLimitInput {
  totalLimit: number;
  currency?: string;
  validFrom: string;
  validTo?: string;
  approvedBy?: string;
  notes?: string;
}

export interface FollowUpInput {
  contactId?: string;
  type: string; // Visit | Call | Email | WeChat | Meeting | Other
  content: string;
  followUpAt: string;
  nextFollowUpAt?: string;
  nextFollowUpTopic?: string;
  opportunityId?: string;
  orderId?: string;
  salesRepId?: string;
  salesRepName?: string;
  attachments?: Record<string, unknown>;
  notes?: string;
}

export interface OpportunityInput {
  title: string;
  description?: string;
  amount: number;
  currency?: string;
  stage?: string;
  probability?: number;
  expectedCloseDate?: string;
  source?: string;
  salesRepId?: string;
  salesRepName?: string;
  tags?: string[];
  notes?: string;
}

export interface CustomerTierInput {
  level: string; // Bronze | Silver | Gold | Platinum | VIP
  criteria?: string;
  discountRate?: number;
  paymentTermsDays?: number;
  creditPriority?: string; // High | Normal | Low
  evaluatedAt: string;
  validUntil?: string;
  evaluatedBy?: string;
  notes?: string;
}

// 商机阶段流转矩阵
const OPPORTUNITY_TRANSITIONS: Record<string, string[]> = {
  Prospecting: ['Qualification', 'ClosedLost'],
  Qualification: ['Proposal', 'ClosedLost'],
  Proposal: ['Negotiation', 'ClosedLost'],
  Negotiation: ['ClosedWon', 'ClosedLost'],
  ClosedWon: [],   // 终态
  ClosedLost: [], // 终态
};

// 阶段 → 默认成交概率
const STAGE_DEFAULT_PROBABILITY: Record<string, number> = {
  Prospecting: 10,
  Qualification: 25,
  Proposal: 50,
  Negotiation: 75,
  ClosedWon: 100,
  ClosedLost: 0,
};

// ────────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function validateOpportunityTransition(from: string, to: string): void {
  const allowed = OPPORTUNITY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`非法商机阶段转换：${from} → ${to}（允许的目标：${allowed?.join(', ') || '无（终态）'}）`);
  }
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createCrmService(prisma: PrismaClient) {
  const now = () => Date.now();

  // ══════════════════════════════════════════════════════════════
  // 1. 联系人管理（Contact）
  // ══════════════════════════════════════════════════════════════

  async function createContact(relationId: string, input: ContactInput, actorId: string): Promise<Contact> {
    const ts = now();
    const contactId = generateId('CTC');

    const created = await prisma.$transaction(async (tx) => {
      // 若新联系人为 primary，先清除该 relation 下其他 primary
      if (input.isPrimary) {
        await tx.contact.updateMany({
          where: { relationId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false, updatedAt: ts },
        });
      }

      const contact = await tx.contact.create({
        data: {
          id: contactId,
          relationId,
          name: input.name,
          title: input.title ?? null,
          department: input.department ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          mobile: input.mobile ?? null,
          wechat: input.wechat ?? null,
          whatsapp: input.whatsapp ?? null,
          isPrimary: input.isPrimary ?? false,
          isDecisionMaker: input.isDecisionMaker ?? false,
          birthday: input.birthday ?? null,
          personalNote: input.personalNote ?? null,
          tags: input.tags ?? [],
          status: 'Active',
          createdAt: ts,
          updatedAt: ts,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId('alog'),
          actorId: actorId || 'system',
          action: 'create_contact',
          targetType: 'Contact',
          targetId: contactId,
          detail: { source: 'api:crm', after: { relationId, name: input.name } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return contact;
    });

    logger.info('[CrmService] contact created', { id: contactId, relationId, name: input.name });
    return created;
  }

  async function listContacts(relationId: string): Promise<Contact[]> {
    return prisma.contact.findMany({
      where: { relationId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async function getContact(id: string): Promise<Contact | null> {
    return prisma.contact.findFirst({ where: { id, deletedAt: null } });
  }

  async function updateContact(id: string, input: Partial<ContactInput>, actorId: string): Promise<Contact> {
    const ts = now();
    const existing = await prisma.contact.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new Error(`联系人 ${id} 不存在`);

    const updated = await prisma.$transaction(async (tx) => {
      // 若设为 primary，先清除同 relation 下其他 primary
      if (input.isPrimary) {
        await tx.contact.updateMany({
          where: { relationId: existing.relationId, isPrimary: true, id: { not: id }, deletedAt: null },
          data: { isPrimary: false, updatedAt: ts },
        });
      }

      return tx.contact.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.department !== undefined && { department: input.department }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.mobile !== undefined && { mobile: input.mobile }),
          ...(input.wechat !== undefined && { wechat: input.wechat }),
          ...(input.whatsapp !== undefined && { whatsapp: input.whatsapp }),
          ...(input.isPrimary !== undefined && { isPrimary: input.isPrimary }),
          ...(input.isDecisionMaker !== undefined && { isDecisionMaker: input.isDecisionMaker }),
          ...(input.birthday !== undefined && { birthday: input.birthday }),
          ...(input.personalNote !== undefined && { personalNote: input.personalNote }),
          ...(input.tags !== undefined && { tags: input.tags }),
          updatedAt: ts,
        },
      });
    });

    logger.info('[CrmService] contact updated', { id, actorId });
    return updated;
  }

  async function deleteContact(id: string, actorId: string): Promise<void> {
    const ts = now();
    await prisma.contact.update({
      where: { id },
      data: { deletedAt: ts, updatedAt: ts, isPrimary: false },
    });
    logger.info('[CrmService] contact soft-deleted', { id, actorId });
  }

  // ══════════════════════════════════════════════════════════════
  // 2. 信用额度（CreditLimit）
  // ══════════════════════════════════════════════════════════════

  async function setCreditLimit(relationId: string, input: CreditLimitInput, actorId: string): Promise<CreditLimit> {
    const ts = now();
    const clId = generateId('CL');

    const created = await prisma.$transaction(async (tx) => {
      // 将同 relation 下已有的 Active 信用额度标记为 Expired
      await tx.creditLimit.updateMany({
        where: { relationId, status: 'Active', deletedAt: null },
        data: { status: 'Expired', updatedAt: ts },
      });

      // 查询当前已用额度（从订单/发票未收款累计 — 简化版：查询该 relation 关联的未付款发票总额）
      const usedAmount = await calculateUsedCredit(tx, relationId);

      const cl = await tx.creditLimit.create({
        data: {
          id: clId,
          relationId,
          totalLimit: input.totalLimit,
          usedAmount,
          currency: input.currency ?? 'CNY',
          validFrom: input.validFrom,
          validTo: input.validTo ?? null,
          status: 'Active',
          approvedBy: input.approvedBy ?? null,
          approvedAt: input.approvedBy ? ts : null,
          notes: input.notes ?? null,
          createdAt: ts,
          updatedAt: ts,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId('alog'),
          actorId: actorId || 'system',
          action: 'set_credit_limit',
          targetType: 'CreditLimit',
          targetId: clId,
          detail: { source: 'api:crm', after: { relationId, totalLimit: input.totalLimit, usedAmount } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return cl;
    });

    // 事务提交后检查超额并发布事件
    if (created.usedAmount > created.totalLimit) {
      await publishBusinessEvent({
        type: 'CreditLimitExceeded',
        sourceEntityType: 'CreditLimit',
        sourceEntityId: clId,
        payload: {
          relationId,
          totalLimit: Number(created.totalLimit),
          usedAmount: Number(created.usedAmount),
          currency: created.currency,
          exceedAmount: Number(created.usedAmount) - Number(created.totalLimit),
        },
        actorId: actorId || 'system',
      }).catch((e) => logger.error('[CrmService] publish CreditLimitExceeded failed', { error: e?.message }));
    }

    logger.info('[CrmService] credit limit set', { id: clId, relationId, totalLimit: input.totalLimit });
    return created;
  }

  async function getActiveCreditLimit(relationId: string): Promise<CreditLimit | null> {
    return prisma.creditLimit.findFirst({
      where: { relationId, status: 'Active', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function listCreditLimitHistory(relationId: string): Promise<CreditLimit[]> {
    return prisma.creditLimit.findMany({
      where: { relationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function updateCreditLimitStatus(id: string, status: string, actorId: string): Promise<CreditLimit> {
    const ts = now();
    const updated = await prisma.creditLimit.update({
      where: { id },
      data: { status, updatedAt: ts },
    });
    logger.info('[CrmService] credit limit status updated', { id, status, actorId });
    return updated;
  }

  // ══════════════════════════════════════════════════════════════
  // 3. 跟进记录（FollowUpRecord）
  // ══════════════════════════════════════════════════════════════

  async function createFollowUp(relationId: string, input: FollowUpInput, actorId: string): Promise<FollowUpRecord> {
    const ts = now();
    const fuId = generateId('FU');

    const created = await prisma.$transaction(async (tx) => {
      const fu = await tx.followUpRecord.create({
        data: {
          id: fuId,
          relationId,
          contactId: input.contactId ?? null,
          type: input.type,
          content: input.content,
          followUpAt: input.followUpAt,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
          nextFollowUpTopic: input.nextFollowUpTopic ?? null,
          opportunityId: input.opportunityId ?? null,
          orderId: input.orderId ?? null,
          salesRepId: input.salesRepId ?? null,
          salesRepName: input.salesRepName ?? null,
          attachments: (input.attachments as any) ?? null,
          notes: input.notes ?? null,
          createdAt: ts,
          updatedAt: ts,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId('alog'),
          actorId: actorId || 'system',
          action: 'create_follow_up',
          targetType: 'FollowUpRecord',
          targetId: fuId,
          detail: { source: 'api:crm', after: { relationId, type: input.type, followUpAt: input.followUpAt } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return fu;
    });

    logger.info('[CrmService] follow-up created', { id: fuId, relationId, type: input.type });
    return created;
  }

  async function listFollowUps(relationId: string, opts: { limit?: number; includeCompleted?: boolean } = {}): Promise<FollowUpRecord[]> {
    const where: Record<string, unknown> = { relationId, deletedAt: null };
    if (!opts.includeCompleted) {
      // 默认只返回待跟进（nextFollowUpAt 不为 null 且 >= 今天 或 followUpAt >= 今天-30天）
      const today = new Date().toISOString().slice(0, 10);
      where.OR = [
        { nextFollowUpAt: { gte: today } },
        { nextFollowUpAt: null, followUpAt: { gte: today } },
      ];
    }
    return prisma.followUpRecord.findMany({
      where: where as any,
      orderBy: [{ nextFollowUpAt: 'asc' }, { followUpAt: 'desc' }],
      take: opts.limit ?? 100,
      include: { contact: { select: { name: true, title: true } } },
    });
  }

  async function getFollowUp(id: string): Promise<FollowUpRecord | null> {
    return prisma.followUpRecord.findFirst({
      where: { id, deletedAt: null },
      include: { contact: { select: { name: true, title: true } } },
    });
  }

  async function updateFollowUp(id: string, input: Partial<FollowUpInput>, actorId: string): Promise<FollowUpRecord> {
    const ts = now();
    const updated = await prisma.followUpRecord.update({
      where: { id },
      data: {
        ...(input.contactId !== undefined && { contactId: input.contactId }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.followUpAt !== undefined && { followUpAt: input.followUpAt }),
        ...(input.nextFollowUpAt !== undefined && { nextFollowUpAt: input.nextFollowUpAt }),
        ...(input.nextFollowUpTopic !== undefined && { nextFollowUpTopic: input.nextFollowUpTopic }),
        ...(input.opportunityId !== undefined && { opportunityId: input.opportunityId }),
        ...(input.orderId !== undefined && { orderId: input.orderId }),
        ...(input.salesRepId !== undefined && { salesRepId: input.salesRepId }),
        ...(input.salesRepName !== undefined && { salesRepName: input.salesRepName }),
        ...(input.attachments !== undefined && { attachments: input.attachments as any }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedAt: ts,
      },
    });
    logger.info('[CrmService] follow-up updated', { id, actorId });
    return updated;
  }

  async function deleteFollowUp(id: string, actorId: string): Promise<void> {
    const ts = now();
    await prisma.followUpRecord.update({
      where: { id },
      data: { deletedAt: ts, updatedAt: ts },
    });
    logger.info('[CrmService] follow-up soft-deleted', { id, actorId });
  }

  /** 查询逾期跟进（nextFollowUpAt < 今天 且未完成） */
  async function listOverdueFollowUps(daysAhead = 0): Promise<FollowUpRecord[]> {
    const today = new Date();
    today.setDate(today.getDate() - daysAhead);
    const cutoff = today.toISOString().slice(0, 10);
    return prisma.followUpRecord.findMany({
      where: {
        deletedAt: null,
        nextFollowUpAt: { lt: cutoff, not: null },
      },
      orderBy: { nextFollowUpAt: 'asc' },
      take: 200,
      include: { relation: { select: { name: true, category: true } } },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 4. 商机管线（Opportunity）
  // ══════════════════════════════════════════════════════════════

  async function createOpportunity(relationId: string, input: OpportunityInput, actorId: string): Promise<Opportunity> {
    const ts = now();
    const oppId = generateId('OPP');
    const stage = input.stage ?? 'Prospecting';
    const probability = input.probability ?? STAGE_DEFAULT_PROBABILITY[stage] ?? 10;

    const created = await prisma.$transaction(async (tx) => {
      const opp = await tx.opportunity.create({
        data: {
          id: oppId,
          relationId,
          title: input.title,
          description: input.description ?? null,
          amount: input.amount,
          currency: input.currency ?? 'CNY',
          stage,
          probability,
          expectedCloseDate: input.expectedCloseDate ?? null,
          source: input.source ?? null,
          salesRepId: input.salesRepId ?? null,
          salesRepName: input.salesRepName ?? null,
          tags: input.tags ?? [],
          notes: input.notes ?? null,
          createdAt: ts,
          updatedAt: ts,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId('alog'),
          actorId: actorId || 'system',
          action: 'create_opportunity',
          targetType: 'Opportunity',
          targetId: oppId,
          detail: { source: 'api:crm', after: { relationId, title: input.title, amount: input.amount, stage } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      // EntityLink 图谱：opportunityFor（/ convertedToOrder）
      await syncOpportunityReferences(prisma, opp, { source: 'api:crm' }, tx);

      return opp;
    });

    logger.info('[CrmService] opportunity created', { id: oppId, relationId, title: input.title });
    return created;
  }

  async function listOpportunities(opts: { relationId?: string; stage?: string; salesRepId?: string } = {}): Promise<Opportunity[]> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (opts.relationId) where.relationId = opts.relationId;
    if (opts.stage) where.stage = opts.stage;
    if (opts.salesRepId) where.salesRepId = opts.salesRepId;
    return prisma.opportunity.findMany({
      where: where as any,
      orderBy: [{ expectedCloseDate: 'asc' }, { createdAt: 'desc' }],
      include: { relation: { select: { name: true, category: true } } },
    });
  }

  async function getOpportunity(id: string): Promise<Opportunity | null> {
    return prisma.opportunity.findFirst({
      where: { id, deletedAt: null },
      include: { relation: { select: { name: true, category: true } } },
    });
  }

  async function updateOpportunity(id: string, input: Partial<OpportunityInput>, actorId: string): Promise<Opportunity> {
    const ts = now();
    const existing = await prisma.opportunity.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new Error(`商机 ${id} 不存在`);

    const updated = await prisma.$transaction(async (tx) => {
      const opp = await tx.opportunity.update({
        where: { id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.amount !== undefined && { amount: input.amount }),
          ...(input.currency !== undefined && { currency: input.currency }),
          ...(input.probability !== undefined && { probability: input.probability }),
          ...(input.expectedCloseDate !== undefined && { expectedCloseDate: input.expectedCloseDate }),
          ...(input.source !== undefined && { source: input.source }),
          ...(input.salesRepId !== undefined && { salesRepId: input.salesRepId }),
          ...(input.salesRepName !== undefined && { salesRepName: input.salesRepName }),
          ...(input.tags !== undefined && { tags: input.tags }),
          ...(input.notes !== undefined && { notes: input.notes }),
          updatedAt: ts,
        },
      });

      // EntityLink 图谱：标题/阶段快照随 update 同步
      await syncOpportunityReferences(prisma, { ...existing, ...opp }, { source: 'api:crm' }, tx);

      return opp;
    });

    logger.info('[CrmService] opportunity updated', { id, actorId });
    return updated;
  }

  /** 商机阶段流转（状态机） */
  async function transitionOpportunityStage(id: string, toStage: string, actorId: string): Promise<Opportunity> {
    const ts = now();
    const existing = await prisma.opportunity.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new Error(`商机 ${id} 不存在`);

    const fromStage = existing.stage;
    validateOpportunityTransition(fromStage, toStage);

    const updated = await prisma.$transaction(async (tx) => {
      const opp = await tx.opportunity.update({
        where: { id },
        data: {
          stage: toStage,
          probability: STAGE_DEFAULT_PROBABILITY[toStage] ?? existing.probability,
          ...(toStage === 'ClosedWon' || toStage === 'ClosedLost' ? { closedAt: ts } : {}),
          updatedAt: ts,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId('alog'),
          actorId: actorId || 'system',
          action: 'transition_opportunity_stage',
          targetType: 'Opportunity',
          targetId: id,
          detail: { source: 'api:crm', before: { stage: fromStage }, after: { stage: toStage } } as any,
          ip: null,
          operationType: 'update',
          fieldPath: 'stage',
          beforeValue: fromStage as any,
          afterValue: toStage as any,
          transactionId: null,
        },
      });

      // EntityLink 图谱：stage 快照随流转同步
      await syncOpportunityReferences(prisma, opp, { source: 'api:crm' }, tx);

      return opp;
    });

    // 事务提交后发布事件
    const eventType = toStage === 'ClosedWon' ? 'OpportunityClosedWon'
      : toStage === 'ClosedLost' ? 'OpportunityClosedLost'
      : 'OpportunityStageChanged';

    await publishBusinessEvent({
      type: eventType,
      sourceEntityType: 'Opportunity',
      sourceEntityId: id,
      payload: {
        relationId: existing.relationId,
        title: existing.title,
        amount: Number(existing.amount),
        currency: existing.currency,
        fromStage,
        toStage,
        orderId: existing.orderId ?? undefined,
      },
      actorId: actorId || 'system',
    }).catch((e) => logger.error('[CrmService] publish opportunity event failed', { error: e?.message }));

    logger.info('[CrmService] opportunity stage transitioned', { id, fromStage, toStage, actorId });
    return updated;
  }

  async function deleteOpportunity(id: string, actorId: string): Promise<void> {
    const ts = now();
    await prisma.$transaction(async (tx) => {
      await tx.opportunity.update({
        where: { id },
        data: { deletedAt: ts, updatedAt: ts },
      });
      // EntityLink 图谱：软删同步失效发出的关联
      await deactivateEntityLinks(tx, 'opportunity', id, BigInt(ts));
    });
    logger.info('[CrmService] opportunity soft-deleted', { id, actorId });
  }

  /** 商机管线汇总（按阶段统计数量和金额） */
  async function getOpportunityPipelineSummary(opts: { salesRepId?: string } = {}): Promise<Record<string, { count: number; totalAmount: number }>> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (opts.salesRepId) where.salesRepId = opts.salesRepId;
    const opportunities = await prisma.opportunity.findMany({ where: where as any, select: { stage: true, amount: true } });
    const summary: Record<string, { count: number; totalAmount: number }> = {};
    for (const opp of opportunities) {
      if (!summary[opp.stage]) summary[opp.stage] = { count: 0, totalAmount: 0 };
      summary[opp.stage].count += 1;
      summary[opp.stage].totalAmount += Number(opp.amount);
    }
    return summary;
  }

  // ══════════════════════════════════════════════════════════════
  // 5. 客户分层（CustomerTier）
  // ══════════════════════════════════════════════════════════════

  async function assignCustomerTier(relationId: string, input: CustomerTierInput, actorId: string): Promise<CustomerTier> {
    const ts = now();
    const tierId = generateId('TIER');

    const created = await prisma.$transaction(async (tx) => {
      // 将同 relation 下已有 active tier 标记为过期
      await tx.customerTier.updateMany({
        where: { relationId, deletedAt: null, validUntil: null },
        data: { validUntil: input.evaluatedAt, updatedAt: ts },
      });
      // 同时把 validUntil 不为 null 但未过期的也标记过期
      await tx.customerTier.updateMany({
        where: {
          relationId,
          deletedAt: null,
          validUntil: { not: null, gte: input.evaluatedAt },
        },
        data: { validUntil: input.evaluatedAt, updatedAt: ts },
      });

      const tier = await tx.customerTier.create({
        data: {
          id: tierId,
          relationId,
          level: input.level,
          criteria: input.criteria ?? null,
          discountRate: input.discountRate ?? null,
          paymentTermsDays: input.paymentTermsDays ?? null,
          creditPriority: input.creditPriority ?? 'Normal',
          evaluatedAt: input.evaluatedAt,
          validUntil: input.validUntil ?? null,
          evaluatedBy: input.evaluatedBy ?? null,
          notes: input.notes ?? null,
          createdAt: ts,
          updatedAt: ts,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId('alog'),
          actorId: actorId || 'system',
          action: 'assign_customer_tier',
          targetType: 'CustomerTier',
          targetId: tierId,
          detail: { source: 'api:crm', after: { relationId, level: input.level } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return tier;
    });

    // 事务提交后发布事件
    await publishBusinessEvent({
      type: 'CustomerTierAssigned',
      sourceEntityType: 'CustomerTier',
      sourceEntityId: tierId,
      payload: {
        relationId,
        level: input.level,
        discountRate: input.discountRate,
        creditPriority: input.creditPriority ?? 'Normal',
      },
      actorId: actorId || 'system',
    }).catch((e) => logger.error('[CrmService] publish CustomerTierAssigned failed', { error: e?.message }));

    logger.info('[CrmService] customer tier assigned', { id: tierId, relationId, level: input.level });
    return created;
  }

  async function getActiveCustomerTier(relationId: string): Promise<CustomerTier | null> {
    const today = new Date().toISOString().slice(0, 10);
    return prisma.customerTier.findFirst({
      where: {
        relationId,
        deletedAt: null,
        OR: [
          { validUntil: null },
          { validUntil: { gte: today } },
        ],
      },
      orderBy: { evaluatedAt: 'desc' },
    });
  }

  async function listCustomerTierHistory(relationId: string): Promise<CustomerTier[]> {
    return prisma.customerTier.findMany({
      where: { relationId, deletedAt: null },
      orderBy: { evaluatedAt: 'desc' },
    });
  }

  async function deleteCustomerTier(id: string, actorId: string): Promise<void> {
    const ts = now();
    await prisma.customerTier.update({
      where: { id },
      data: { deletedAt: ts, updatedAt: ts },
    });
    logger.info('[CrmService] customer tier soft-deleted', { id, actorId });
  }

  // ══════════════════════════════════════════════════════════════
  // 内部辅助：计算已用信用额度
  // ══════════════════════════════════════════════════════════════

  async function calculateUsedCredit(tx: any, relationId: string): Promise<number> {
    // 已用信用额度 = 该 relation（作为客户）关联的未付款 Receivable 发票总额
    // 简化版：查询 status != 'Paid' 且 type = 'Receivable' 的发票 amount 之和
    const result = await tx.invoice.aggregate({
      _sum: { amount: true },
      where: {
        deletedAt: null,
        status: { notIn: ['Paid', 'Cancelled', 'Void'] },
        type: 'Receivable',
        order: { customerRelationId: relationId },
      },
    });
    return result._sum?.amount ? Number(result._sum.amount) : 0;
  }

  // ══════════════════════════════════════════════════════════════
  // CRM 总览（按 relation 聚合）
  // ══════════════════════════════════════════════════════════════

  async function getRelationCrmOverview(relationId: string): Promise<{
    contacts: Contact[];
    activeCreditLimit: CreditLimit | null;
    creditLimitHistory: CreditLimit[];
    pendingFollowUps: FollowUpRecord[];
    opportunities: Opportunity[];
    activeTier: CustomerTier | null;
    tierHistory: CustomerTier[];
  }> {
    const [contacts, activeCreditLimit, creditLimitHistory, pendingFollowUps, opportunities, activeTier, tierHistory] = await Promise.all([
      listContacts(relationId),
      getActiveCreditLimit(relationId),
      listCreditLimitHistory(relationId),
      listFollowUps(relationId, { limit: 10 }),
      listOpportunities({ relationId }),
      getActiveCustomerTier(relationId),
      listCustomerTierHistory(relationId),
    ]);

    return {
      contacts,
      activeCreditLimit,
      creditLimitHistory,
      pendingFollowUps,
      opportunities,
      activeTier,
      tierHistory,
    };
  }

  return {
    // Contact
    createContact,
    listContacts,
    getContact,
    updateContact,
    deleteContact,
    // CreditLimit
    setCreditLimit,
    getActiveCreditLimit,
    listCreditLimitHistory,
    updateCreditLimitStatus,
    // FollowUpRecord
    createFollowUp,
    listFollowUps,
    getFollowUp,
    updateFollowUp,
    deleteFollowUp,
    listOverdueFollowUps,
    // Opportunity
    createOpportunity,
    listOpportunities,
    getOpportunity,
    updateOpportunity,
    transitionOpportunityStage,
    deleteOpportunity,
    getOpportunityPipelineSummary,
    // CustomerTier
    assignCustomerTier,
    getActiveCustomerTier,
    listCustomerTierHistory,
    deleteCustomerTier,
    // Overview
    getRelationCrmOverview,
  };
}
