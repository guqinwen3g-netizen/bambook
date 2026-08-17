/**
 * 报价管理服务 Quotation Service
 *
 * 职责：
 *   1. 报价单 CRUD（含行明细，事务内创建/更新）
 *   2. 状态流转：Draft → Sent → Accepted/Rejected/Expired
 *   3. 业务事件发布（QuotationIssued / QuotationAccepted）
 *   4. 行金额自动计算 + 报价总金额汇总
 *
 * 设计原则：
 *   - 软删除（deletedAt BigInt），不物理删除
 *   - 事务内创建报价 + 行 + 审计日志
 *   - 状态转换有严格校验（非法转换抛 409）
 *   - 事件发布失败不阻断业务（通知系统是 fire-and-forget）
 */

import { PrismaClient, Quotation, QuotationLine } from '@prisma/client';
import { logger } from '../lib/logger';
import { businessEventBus } from '../events/businessEventBus';
import { deactivateEntityLinks, syncOrderEntityReferences, syncQuotationReferences } from '../entities/sync';
import { calculatePriceDeviation, DeviationLevel } from '../pricing/trackAEstimator';
import { resolveActorUserAccountId } from '../agent/actorIdentity';
import { nextBusinessNumber } from '../shared/businessNumberService';
import { createMoqConfigService, type MoqSnapshot } from '../moq/moqConfigService';
import { createMoqResolutionService, isValidSnapshot } from '../moq/moqResolutionService';
import { createMoqValidationService } from '../moq/moqValidationService';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

export interface QuotationLineInput {
  fabricCode?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  notes?: string;
}

export interface CreateQuotationInput {
  /** 报价号（可选，服务端自动生成 QT-YYYY-NNNN；传入时优先使用传入值并校验唯一性） */
  quotationNumber?: string;
  currency: string;
  customerRelationId?: string;
  customerName?: string;
  customerCode?: string;
  issueDate: string;
  validUntil?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  salesperson?: string;
  inquiryRef?: string;
  exchangeRate?: number;
  baseCurrency?: string;
  notes?: string;
  lines: QuotationLineInput[];
  // ── 双轨定价快照（PRD 8.6；可选，A/B 双轨价齐备时创建即计算偏差分级并持久化）──
  trackAMedianUsd?: number; // 轨道 A 中位估算美元单价
  trackAUnit?: string; // PC（件） | M（米）
  trackBFinalUsd?: number; // 轨道 B 终价美元单价
}

export interface UpdateQuotationInput extends Partial<CreateQuotationInput> {
  status?: string;
}

export type QuotationStatus = 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Expired';

export interface QuotationDetail extends Quotation {
  lines: QuotationLine[];
}

// ────────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────────

const VALID_STATUSES: QuotationStatus[] = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];

/** 报价单创建可写字段白名单（route / Agent Flow 共用真源；lines 元素字段见 QuotationLineInput） */
export const QUOTATION_CREATE_FIELDS: readonly string[] = [
  'quotationNumber', 'currency', 'customerRelationId', 'customerName', 'customerCode', 'issueDate',
  'validUntil', 'deliveryTerms', 'paymentTerms', 'salesperson', 'inquiryRef', 'exchangeRate',
  'baseCurrency', 'notes', 'lines', 'trackAMedianUsd', 'trackAUnit', 'trackBFinalUsd',
];

/**
 * 报价单更新可 patch 字段白名单（仅 Draft 可编辑；双轨快照与 MOQ 快照为 writeOnce，不可 patch；
 * status 走状态机流转，不在 update 通道内）
 */
export const QUOTATION_UPDATE_PATCH_FIELDS: readonly string[] = [
  'quotationNumber', 'currency', 'customerRelationId', 'customerName', 'customerCode', 'issueDate',
  'validUntil', 'deliveryTerms', 'paymentTerms', 'salesperson', 'inquiryRef', 'exchangeRate',
  'baseCurrency', 'notes', 'lines',
];

// 状态转换矩阵：key → 允许的目标状态
const TRANSITIONS: Record<string, QuotationStatus[]> = {
  Draft: ['Sent', 'Expired'],
  Sent: ['Accepted', 'Rejected', 'Expired'],
  Accepted: [], // 终态
  Rejected: [], // 终态
  Expired: [], // 终态
};

// ────────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────────

function generateQuotationId(): string {
  return `QT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateLineId(): string {
  return `QTL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function calcLineAmount(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 10000) / 10000; // 4 位小数
}

function calcTotalAmount(lines: QuotationLineInput[]): number {
  return lines.reduce((sum, l) => sum + calcLineAmount(l.quantity, l.unitPrice), 0);
}

function validateStatusTransition(from: string, to: QuotationStatus): void {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`非法状态转换：${from} → ${to}（允许的目标：${allowed?.join(', ') || '无（终态）'}）`);
  }
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createQuotationService(prisma: PrismaClient) {
  // MOQ 域服务（报价侧：create/update advisory 校验 + writeOnce 快照；send/convertToOrder fail-closed 门禁）
  // 豁免审批单统一经 approvalCreateService（DR-007 服务端解析 reviewerId，禁止前端/调用方传入）
  const moqConfigSvc = createMoqConfigService({ prisma });
  const moqResolutionSvc = createMoqResolutionService({ prisma, configService: moqConfigSvc });
  const moqValidationSvc = createMoqValidationService({
    prisma,
    configService: moqConfigSvc,
    resolutionService: moqResolutionSvc,
    approvalCreateService: createApprovalCreateService({
      prisma,
      routingService: createApprovalRoutingService({ prisma }),
    }),
  });

  // ── MOQ 行级业务线推导：Quotation 无单据级 type/businessLine 字段，按行 unit 归族 ──
  // PC/PCS/SET（件/套）→ garment 成衣族；其余（M/YD/KG 等）→ fabric 面料族
  function deriveLineBusinessLine(unit?: string | null): 'garment' | 'fabric' {
    const u = (unit ?? '').trim().toUpperCase();
    return u === 'PC' || u === 'PCS' || u === 'SET' ? 'garment' : 'fabric';
  }

  // ── MOQ 校验输入组装（逐行推导 businessLine；口径 = 报价单 writeOnce 快照） ──
  function buildMoqLines(lines: Array<{ quantity: unknown; unit?: string | null; moqOverride?: number | null }>) {
    return lines.map((l) => ({
      quantity: Number(l.quantity),
      unit: l.unit ?? undefined,
      businessLine: deriveLineBusinessLine(l.unit),
      moqOverride: l.moqOverride ?? null,
    }));
  }

  // ── MOQ 豁免审批单查询（approved 才算有效；查询异常按无豁免处理 → fail-closed 阻断） ──
  async function findApprovedMoqExemption(quotationId: string): Promise<string | null> {
    try {
      const approved = await (prisma as any).approvalRequest.findFirst({
        where: {
          targetType: 'Quotation',
          targetId: quotationId,
          actionType: 'quotation:moq-exemption',
          status: 'approved',
        },
        select: { id: true },
      });
      return approved?.id ?? null;
    } catch (e: any) {
      logger.error('[QuotationService] MOQ 豁免审批单查询失败（fail-closed 按无豁免处理）', { quotationId, error: e?.message });
      return null;
    }
  }

  // ── 创建报价单（含行明细，事务） ──
  async function createQuotation(input: CreateQuotationInput, actorId: string): Promise<QuotationDetail> {
    const totalAmount = calcTotalAmount(input.lines);
    const now = Date.now();
    const quotationId = generateQuotationId();

    // ── 双轨偏差快照（PRD 8.6）：A/B 双轨价齐备 → 计算偏差分级；warn/block 自动生成审批 ──
    const trackAOk = Number.isFinite(input.trackAMedianUsd) && (input.trackAMedianUsd as number) > 0;
    const trackBOk = Number.isFinite(input.trackBFinalUsd) && (input.trackBFinalUsd as number) > 0;
    let deviation: { deviationPercent: number; level: DeviationLevel } | null = null;
    if (trackAOk && trackBOk) {
      deviation = calculatePriceDeviation(input.trackBFinalUsd as number, input.trackAMedianUsd as number);
    }

    // warn/block → 需要审批：先解析 requester（actor → UserAccount，fallback owner）
    // 无法解析时不阻断创建：快照照常落库，priceApprovalId 置空；发送门禁对 block 仍 fail-closed
    let approvalId: string | null = null;
    let approvalRequesterId: string | null = null;
    if (deviation && deviation.level !== 'ok') {
      approvalRequesterId = await resolveActorUserAccountId(prisma, { userId: actorId }).catch(() => null);
      if (!approvalRequesterId) {
        const owner = await prisma.userAccount.findFirst({
          where: { id: 'usr_owner_default', deletedAt: null, status: 'active' },
          select: { id: true },
        }).catch(() => null);
        approvalRequesterId = owner?.id ?? null;
      }
      if (approvalRequesterId) {
        approvalId = `ar_${now}_${Math.random().toString(36).slice(2, 8)}`;
      } else {
        logger.warn('[QuotationService] price deviation approval skipped: no resolvable requester', {
          quotationNumber: input.quotationNumber, deviationPercent: deviation.deviationPercent, level: deviation.level,
        });
      }
    }

    // ── MOQ 快照 writeOnce（§2.3 不追溯；创建时写入，此后不随系统配置变更） ──
    const moqSnapshot = await moqConfigSvc.buildSnapshot();

    const created = await prisma.$transaction(async (tx) => {
      // PRD 5.6：服务端自动生成报价号（QT-YYYY-NNNN），传入时优先使用传入值
      const quotationNumber = input.quotationNumber || await nextBusinessNumber(tx, 'QT');
      const quotation = await tx.quotation.create({
        data: {
          id: quotationId,
          quotationNumber,
          status: 'Draft',
          currency: input.currency,
          totalAmount,
          exchangeRate: input.exchangeRate ?? null,
          baseCurrency: input.baseCurrency ?? 'CNY',
          customerRelationId: input.customerRelationId ?? null,
          customerName: input.customerName ?? null,
          customerCode: input.customerCode ?? null,
          issueDate: input.issueDate,
          validUntil: input.validUntil ?? null,
          deliveryTerms: input.deliveryTerms ?? null,
          paymentTerms: input.paymentTerms ?? null,
          salesperson: input.salesperson ?? null,
          inquiryRef: input.inquiryRef ?? null,
          notes: input.notes ?? null,
          // 双轨快照（此后为历史快照，不随编辑变更）
          trackAMedianUsd: trackAOk ? (input.trackAMedianUsd as number) : null,
          trackAUnit: trackAOk ? (input.trackAUnit ?? null) : null,
          trackBFinalUsd: trackBOk ? (input.trackBFinalUsd as number) : null,
          priceDeviationPercent: deviation?.deviationPercent ?? null,
          priceDeviationLevel: deviation?.level ?? null,
          priceApprovalId: approvalId,
          // MOQ 快照（writeOnce）
          moqSnapshot: moqSnapshot as any,
          createdAt: now,
          updatedAt: now,
          lines: {
            create: input.lines.map((line, i) => ({
              id: generateLineId(),
              lineNumber: i + 1,
              fabricCode: line.fabricCode ?? null,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              amount: calcLineAmount(line.quantity, line.unitPrice),
              notes: line.notes ?? null,
              createdAt: now,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // 偏差 >15% → 同事务自动生成审批请求（warn 提示审批，block 未通过禁止发送）
      if (approvalId && deviation && approvalRequesterId) {
        await tx.approvalRequest.create({
          data: {
            id: approvalId,
            requesterId: approvalRequesterId,
            actionType: 'quotation:price-deviation',
            targetType: 'Quotation',
            targetId: quotationId,
            status: 'pending',
            risk: deviation.level === 'block' ? 'high' : 'medium',
            payload: {
              quotationId,
              quotationNumber: input.quotationNumber,
              trackAMedianUsd: input.trackAMedianUsd,
              trackAUnit: input.trackAUnit ?? null,
              trackBFinalUsd: input.trackBFinalUsd,
              deviationPercent: deviation.deviationPercent,
              level: deviation.level,
              requestedAt: new Date(now).toISOString(),
              source: 'quotation-dual-track',
            },
          },
        });
      }

      // 审计日志
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_quotation',
          targetType: 'Quotation',
          targetId: quotationId,
          detail: { source: 'api:quotation', after: { quotationNumber, totalAmount, lineCount: input.lines.length, priceDeviationLevel: deviation?.level ?? null } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      // EntityLink 图谱：quotedFor（customerRelationId → relation.organization）
      await syncQuotationReferences(prisma, quotation, { source: 'api:quotation' }, tx);

      return quotation;
    });

    // ── MOQ 创建校验（advisory：草稿保存不阻断；sendQuotation 门禁 fail-closed 兜底） ──
    let moqCheck: unknown = null;
    try {
      moqCheck = await moqValidationSvc.validateCreate({
        customerRelationId: input.customerRelationId ?? null,
        snapshot: moqSnapshot,
        lines: buildMoqLines(input.lines),
      }, { actor: actorId && actorId !== 'system' ? { userId: actorId } : null });
      if ((moqCheck as any).ok === false) {
        logger.warn('[QuotationService] MOQ 低于阈值（advisory，发送报价时需豁免审批）', {
          id: quotationId, blockedLineIndexes: (moqCheck as any).blockedLineIndexes,
        });
      }
    } catch (e: any) {
      logger.error('[QuotationService] MOQ 创建校验异常（不阻断创建）', { id: quotationId, error: e?.message });
      moqCheck = null;
    }

    logger.info('[QuotationService] quotation created', { id: quotationId, quotationNumber: input.quotationNumber, totalAmount, snapshotSource: moqSnapshot.source });
    return { ...(created as QuotationDetail), moqCheck } as QuotationDetail;
  }

  // ── 更新报价单（仅 Draft 状态可编辑） ──
  async function updateQuotation(id: string, input: UpdateQuotationInput, actorId: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    if (existing.status !== 'Draft') {
      throw new Error(`报价单 ${id} 状态为 ${existing.status}，仅 Draft 状态可编辑`);
    }

    const now = Date.now();
    const lines = input.lines;
    const totalAmount = lines ? calcTotalAmount(lines) : Number(existing.totalAmount);

    const updated = await prisma.$transaction(async (tx) => {
      // 若提供新行明细，先删后建
      if (lines && lines.length > 0) {
        await tx.quotationLine.deleteMany({ where: { quotationId: id } });
        await tx.quotationLine.createMany({
          data: lines.map((line, i) => ({
            id: generateLineId(),
            quotationId: id,
            lineNumber: i + 1,
            fabricCode: line.fabricCode ?? null,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            amount: calcLineAmount(line.quantity, line.unitPrice),
            notes: line.notes ?? null,
            createdAt: now,
          })),
        });
      }

      const quotation = await tx.quotation.update({
        where: { id },
        data: {
          quotationNumber: input.quotationNumber ?? undefined,
          currency: input.currency ?? undefined,
          totalAmount,
          exchangeRate: input.exchangeRate ?? undefined,
          baseCurrency: input.baseCurrency ?? undefined,
          customerRelationId: input.customerRelationId ?? undefined,
          customerName: input.customerName ?? undefined,
          customerCode: input.customerCode ?? undefined,
          issueDate: input.issueDate ?? undefined,
          validUntil: input.validUntil ?? undefined,
          deliveryTerms: input.deliveryTerms ?? undefined,
          paymentTerms: input.paymentTerms ?? undefined,
          salesperson: input.salesperson ?? undefined,
          inquiryRef: input.inquiryRef ?? undefined,
          notes: input.notes ?? undefined,
          updatedAt: now,
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'update_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { quotationNumber: existing.quotationNumber }, after: { quotationNumber: input.quotationNumber ?? existing.quotationNumber } } as any,
          ip: null,
          operationType: 'update',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      // EntityLink 图谱：quotedFor 快照随 FK 更新
      await syncQuotationReferences(prisma, quotation, { source: 'api:quotation' }, tx);

      return quotation;
    });

    // ── MOQ 编辑校验（advisory：行变更时按 writeOnce 快照口径重算，不阻断保存；moqSnapshot 绝不改写） ──
    let moqCheck: unknown = null;
    if (lines && lines.length > 0) {
      try {
        moqCheck = await moqValidationSvc.validateCreate({
          customerRelationId: input.customerRelationId ?? existing.customerRelationId ?? null,
          snapshot: (existing as any).moqSnapshot ?? null,
          lines: buildMoqLines(lines),
        }, { actor: actorId && actorId !== 'system' ? { userId: actorId } : null });
        if ((moqCheck as any).ok === false) {
          logger.warn('[QuotationService] MOQ 低于阈值（advisory，发送报价时需豁免审批）', {
            id, blockedLineIndexes: (moqCheck as any).blockedLineIndexes,
          });
        }
      } catch (e: any) {
        logger.error('[QuotationService] MOQ 编辑校验异常（不阻断保存）', { id, error: e?.message });
        moqCheck = null;
      }
    }

    logger.info('[QuotationService] quotation updated', { id });
    return { ...(updated as QuotationDetail), moqCheck } as QuotationDetail;
  }

  // ── 软删除报价单（仅 Draft 状态可删除） ──
  async function deleteQuotation(id: string, actorId: string): Promise<void> {
    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    if (existing.status !== 'Draft') {
      throw new Error(`报价单 ${id} 状态为 ${existing.status}，仅 Draft 状态可删除`);
    }

    const now = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.quotation.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
      // EntityLink 图谱：软删同步失效发出的关联
      await deactivateEntityLinks(tx, 'quotation', id, BigInt(now));
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'delete_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { quotationNumber: existing.quotationNumber, status: existing.status } } as any,
          ip: null,
          operationType: 'delete',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
    });

    logger.info('[QuotationService] quotation deleted', { id });
  }

  // ── 查询报价单列表 ──
  async function listQuotations(params: {
    status?: string;
    customerRelationId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Quotation[]; total: number }> {
    const where: any = { deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.customerRelationId) where.customerRelationId = params.customerRelationId;
    if (params.dateFrom || params.dateTo) {
      where.issueDate = {};
      if (params.dateFrom) where.issueDate.gte = params.dateFrom;
      if (params.dateTo) where.issueDate.lte = params.dateTo;
    }
    if (params.search) {
      where.OR = [
        { quotationNumber: { contains: params.search } },
        { customerName: { contains: params.search } },
        { inquiryRef: { contains: params.search } },
      ];
    }

    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const [items, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.quotation.count({ where }),
    ]);

    return { items, total };
  }

  // ── 查询单个报价单（含行明细） ──
  async function getQuotation(id: string): Promise<QuotationDetail | null> {
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!quotation || quotation.deletedAt) return null;
    return quotation as QuotationDetail;
  }

  // ── 状态转换：发送报价单 Draft → Sent ──
  async function sendQuotation(id: string, actorId: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Sent');

    // ── 双轨红标门禁（PRD 8.6）：偏差 >30% 未审批通过禁止发送（fail-closed）──
    if (existing.priceDeviationLevel === 'block') {
      let approved = false;
      if (existing.priceApprovalId) {
        const approval = await prisma.approvalRequest.findUnique({ where: { id: existing.priceApprovalId } });
        approved = approval?.status === 'approved';
      }
      if (!approved) {
        throw new Error(
          `报价单 ${existing.quotationNumber} 双轨偏差 ${existing.priceDeviationPercent ?? '?'}% 超过 30% 红标阈值，`
          + `需审批通过后方可发送（门禁：price-deviation${existing.priceApprovalId ? '' : '，审批请求缺失'}）`,
        );
      }
    }

    // ── MOQ 门禁（§4.3 + §6 #2 fail-closed）：存在低于 MOQ 的行且无 approved 豁免审批单 → 阻断发送 ──
    // 口径：Quotation.moqSnapshot（writeOnce）；不合规时自动生成豁免审批单（§6 #2 动作③，DR-007 解析 reviewerId）
    try {
      const moqCheck = await moqValidationSvc.validateCreate({
        customerRelationId: existing.customerRelationId ?? null,
        snapshot: (existing as any).moqSnapshot ?? null,
        lines: buildMoqLines(existing.lines),
      }, {
        actor: actorId && actorId !== 'system' ? { userId: actorId } : null,
        autoCreateApproval: Boolean(actorId && actorId !== 'system'),
        targetType: 'Quotation',
        targetId: id,
      });
      if (!moqCheck.ok) {
        const approvedId = await findApprovedMoqExemption(id);
        if (!approvedId) {
          const worst = moqCheck.lines.find((l) => !l.compliant);
          throw new Error(
            `报价单 ${existing.quotationNumber} 存在低于 MOQ 的行（行 ${(worst?.lineIndex ?? 0) + 1} 数量 ${worst?.quantity} < MOQ ${worst?.effectiveMoq}，缺口 ${worst?.gapPct}%），`
            + `需 MOQ 豁免审批通过后方可发送（门禁：moq-exemption${moqCheck.approvalRequestId ? `，审批单 ${moqCheck.approvalRequestId} 待审批` : ''}${moqCheck.approvalError ? '，审批单创建失败请联系管理员' : ''}）`,
          );
        }
      }
    } catch (e: any) {
      if (typeof e?.message === 'string' && e.message.includes('门禁：moq-exemption')) throw e;
      // fail-closed：门禁校验基础设施异常 → 阻断发送
      logger.error('[QuotationService] MOQ 发送门禁校验异常（fail-closed 阻断）', { id, error: e?.message });
      throw new Error(`报价单 ${existing.quotationNumber} MOQ 校验失败，请重试或联系管理员（门禁：moq-exemption）：${e?.message}`);
    }

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.update({
        where: { id },
        data: { status: 'Sent', updatedAt: now, sentAt: existing.sentAt ?? now }, // 重发场景保留首次发送时间
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'send_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { status: 'Draft' }, after: { status: 'Sent' } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: 'Draft',
          afterValue: 'Sent',
          transactionId: null,
        },
      });

      return quotation;
    });

    // 发布 QuotationIssued 业务事件（fire-and-forget，不阻断业务）
    try {
      businessEventBus.publish({
        id: `bev_qt_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'QuotationIssued',
        sourceEntityType: 'Quotation',
        sourceEntityId: id,
        payload: {
          quotationId: id,
          quotationNumber: existing.quotationNumber,
          customerName: existing.customerName,
          customerRelationId: existing.customerRelationId,
          totalAmount: Number(existing.totalAmount),
          currency: existing.currency,
          lineCount: existing.lines.length,
        },
        occurredAt: now,
        actorId: actorId || 'system',
      });
    } catch (e: any) {
      logger.warn('[QuotationService] QuotationIssued event publish failed (non-blocking)', { error: e?.message });
    }

    logger.info('[QuotationService] quotation sent', { id, quotationNumber: existing.quotationNumber });
    return updated as QuotationDetail;
  }

  // ── 状态转换：接受报价单 Sent → Accepted ──
  async function acceptQuotation(id: string, actorId: string, note?: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Accepted');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.update({
        where: { id },
        data: { status: 'Accepted', updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'accept_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { status: 'Sent' }, after: { status: 'Accepted', note } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: 'Sent',
          afterValue: 'Accepted',
          transactionId: null,
        },
      });

      return quotation;
    });

    // 发布 QuotationAccepted 业务事件
    try {
      businessEventBus.publish({
        id: `bev_qa_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'QuotationAccepted',
        sourceEntityType: 'Quotation',
        sourceEntityId: id,
        payload: {
          quotationId: id,
          quotationNumber: existing.quotationNumber,
          customerName: existing.customerName,
          customerRelationId: existing.customerRelationId,
          totalAmount: Number(existing.totalAmount),
          currency: existing.currency,
          lines: existing.lines.map(l => ({
            fabricCode: l.fabricCode,
            description: l.description,
            quantity: Number(l.quantity),
            unit: l.unit,
            unitPrice: Number(l.unitPrice),
          })),
        },
        occurredAt: now,
        actorId: actorId || 'system',
      });
    } catch (e: any) {
      logger.warn('[QuotationService] QuotationAccepted event publish failed (non-blocking)', { error: e?.message });
    }

    logger.info('[QuotationService] quotation accepted', { id, quotationNumber: existing.quotationNumber });
    return updated as QuotationDetail;
  }

  // ── 状态转换：拒绝报价单 Sent → Rejected ──
  async function rejectQuotation(id: string, actorId: string, note?: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Rejected');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.update({
        where: { id },
        data: { status: 'Rejected', updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'reject_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { status: 'Sent' }, after: { status: 'Rejected', note } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: 'Sent',
          afterValue: 'Rejected',
          transactionId: null,
        },
      });

      return quotation;
    });

    logger.info('[QuotationService] quotation rejected', { id, quotationNumber: existing.quotationNumber });
    return updated as QuotationDetail;
  }

  // ── 标记过期（调度器或手动触发） ──
  async function expireQuotation(id: string, actorId: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    if (existing.status !== 'Draft' && existing.status !== 'Sent') {
      throw new Error(`报价单 ${id} 状态为 ${existing.status}，不可标记过期`);
    }

    const now = Date.now();
    const updated = await prisma.quotation.update({
      where: { id },
      data: { status: 'Expired', updatedAt: now },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    logger.info('[QuotationService] quotation expired', { id });
    return updated as QuotationDetail;
  }

  // ── 转为正式订单（Accepted → Order） ──
  // 将已接受的报价单转为生产订单，自动映射字段 + 创建订单行 + 标记 convertedOrderId
  async function convertToOrder(
    id: string,
    actorId: string,
    overrides?: { poNumber?: string; millName?: string; type?: string; dueDate?: string },
  ): Promise<{ orderId: string; quotation: QuotationDetail }> {
    const existing = await prisma.quotation.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    if (existing.status !== 'Accepted') {
      throw new Error(`报价单 ${id} 状态为 ${existing.status}，仅 Accepted 可转为订单`);
    }
    if (existing.convertedOrderId) {
      throw new Error(`报价单 ${id} 已转为订单 ${existing.convertedOrderId}，不可重复转换`);
    }

    const now = Date.now();
    const orderId = `ORD-QT-${String(now).slice(-8)}`;
    const poNumber = overrides?.poNumber || existing.quotationNumber;
    const millName = overrides?.millName || '';
    const orderType = overrides?.type || 'Fabric';
    const dueDate = overrides?.dueDate || existing.validUntil || '';
    const totalAmount = Number(existing.totalAmount);

    // ── MOQ 转换门禁（§6 #3 fail-closed）：报价行低于 MOQ 时须持 approved 豁免审批单 ──
    // 有 approved → 复制审批引用至 Order 快照（fieldSources.moqExemptionApprovalId），不重复触发审批；
    // 无 approved / 已撤销 / 已拒绝 → 抛异常中止转换。
    let moqExemptionApprovalId: string | null = null;
    try {
      const moqCheck = await moqValidationSvc.validateCreate({
        customerRelationId: existing.customerRelationId ?? null,
        snapshot: (existing as any).moqSnapshot ?? null,
        lines: buildMoqLines(existing.lines),
      }, { actor: actorId && actorId !== 'system' ? { userId: actorId } : null });
      if (!moqCheck.ok) {
        moqExemptionApprovalId = await findApprovedMoqExemption(id);
        if (!moqExemptionApprovalId) {
          const worst = moqCheck.lines.find((l) => !l.compliant);
          throw new Error(
            `报价单 ${existing.quotationNumber} 存在低于 MOQ 的行（行 ${(worst?.lineIndex ?? 0) + 1} 数量 ${worst?.quantity} < MOQ ${worst?.effectiveMoq}，缺口 ${worst?.gapPct}%）`
            + `且无有效 MOQ 豁免审批（门禁：moq-exemption），转换中止`,
          );
        }
      }
    } catch (e: any) {
      if (typeof e?.message === 'string' && e.message.includes('门禁：moq-exemption')) throw e;
      logger.error('[QuotationService] MOQ 转换门禁校验异常（fail-closed 阻断）', { id, error: e?.message });
      throw new Error(`报价单 ${existing.quotationNumber} MOQ 校验失败，转换中止（门禁：moq-exemption）：${e?.message}`);
    }

    // ── MOQ 快照口径继承：报价 writeOnce 快照合法 → 订单继承同一口径（报价→订单 MOQ 不跳变）；否则新建 ──
    const orderMoqSnapshot: MoqSnapshot = isValidSnapshot((existing as any).moqSnapshot)
      ? ((existing as any).moqSnapshot as MoqSnapshot)
      : await moqConfigSvc.buildSnapshot();

    const result = await prisma.$transaction(async (tx) => {
      // 1. 创建订单
      const order = await tx.order.create({
        data: {
          id: orderId,
          customer: existing.customerName || existing.customerCode || '未知客户',
          product: existing.lines[0]?.description || '',
          type: orderType,
          quantity: existing.lines.reduce((sum, l) => sum + Number(l.quantity), 0),
          status: 'Pending',
          dueDate,
          quoteAmount: totalAmount,
          poNumber,
          customerCode: existing.customerCode,
          currency: existing.currency,
          deliveryTerms: existing.deliveryTerms,
          paymentTerms: existing.paymentTerms,
          customerRelationId: existing.customerRelationId,
          millName,
          source: 'quotation-convert',
          salesCurrency: existing.currency,
          purchaseCurrency: existing.baseCurrency || 'CNY',
          fieldSources: {
            source: 'quotation-convert',
            // §6 #3：源报价行已 approved 的 MOQ 豁免审批引用（不重复触发审批）
            ...(moqExemptionApprovalId ? { moqExemptionApprovalId } : {}),
          } as any,
          moqSnapshot: orderMoqSnapshot as any,
          updatedAt: BigInt(now),
          importedAt: BigInt(now),
          lines: {
            create: existing.lines.map((line, i) => ({
              id: `OL-${orderId}-${i + 1}`,
              lineNumber: i + 1,
              materialCode: line.fabricCode,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              netValue: line.amount,
              status: 'Pending',
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // 2. 更新报价单 — 标记已转换
      const quotation = await tx.quotation.update({
        where: { id },
        data: { convertedOrderId: orderId, updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // 3. 审计日志 — 报价单转换
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'convert_quotation_to_order',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', after: { orderId, poNumber } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'convertedOrderId',
          beforeValue: null as any,
          afterValue: orderId as any,
          transactionId: null,
        },
      });

      // 4. 审计日志 — 订单创建
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_order_from_quotation',
          targetType: 'Order',
          targetId: orderId,
          detail: { source: 'quotation-convert', after: { quotationId: id, poNumber, totalAmount } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      // 5. EntityLink 图谱：报价 convertedToOrder + quotedFor；新订单关系 FK 一并入图
      await syncQuotationReferences(prisma, quotation, { source: 'quotation-convert' }, tx);
      await syncOrderEntityReferences(prisma, order, { source: 'quotation-convert' }, tx);

      return { order, quotation };
    });

    logger.info('[QuotationService] quotation converted to order', {
      id, orderId, poNumber, lineCount: existing.lines.length,
    });

    return { orderId: result.order.id, quotation: result.quotation as QuotationDetail };
  }

  return {
    createQuotation,
    updateQuotation,
    deleteQuotation,
    listQuotations,
    getQuotation,
    sendQuotation,
    acceptQuotation,
    rejectQuotation,
    expireQuotation,
    convertToOrder,
  };
}

export type QuotationService = ReturnType<typeof createQuotationService>;
