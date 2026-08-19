/**
 * moqValidationService.ts — MOQ 校验服务（validateCreate + validatePatch 双触发）
 *
 * 设计真源：
 *   - docs/design/03-业务规则/MOQ最小起订量.md §3（豁免审批链 DR-007）/ §6（触发矩阵）/ §X（变更后重算 fail-closed）
 *   - DR-003：Capsule 豁免 = 成衣档 → Capsule 档降级（业务员直接勾选，记录操作者/时间；< capsuleMoq 仍需审批）
 *
 * 铁律（fail-closed）：
 *   1. Capsule 豁免仅允许成衣订单（type=Garment 或 businessLine=garment/capsule），否则 CAPSULE_NOT_ALLOWED
 *   2. 行级 moqOverride 必须持 scope `moq:line_override`（未登录/无 scope → SCOPE_DENIED）
 *   3. Confirmed+ 订单数量跌破 MOQ → blocked=true + 自动生成豁免审批单（经 approvalCreateService，DR-007 解析 reviewerId）
 *   4. 审批单创建失败不静默放行：blocked 仍为 true，approvalError 记录原因（§6 #1 异常分支）
 *   5. 数量回升合规 → 自动取消挂起的 qty_change_below_moq 豁免单；已 Approved 不回退（审计不逆向删除）
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import type { ApprovalCreateService } from '../approvals/approvalCreateService';
import {
  MOQ_SCOPE_DENIED,
  moqActorHasScope,
  type MoqActor,
  type MoqConfigService,
  type MoqSnapshot,
} from './moqConfigService';
import {
  isGarmentFamily,
  isValidSnapshot,
  type MoqResolutionService,
  type MoqSource,
} from './moqResolutionService';

// ───────────────────────────────────────────────────────────────────
// 错误码
// ───────────────────────────────────────────────────────────────────

export const MOQ_CAPSULE_NOT_ALLOWED = 'CAPSULE_NOT_ALLOWED';
export const MOQ_ORDER_NOT_FOUND = 'MOQ_ORDER_NOT_FOUND';
export const MOQ_INVALID_VALUE = 'MOQ_INVALID_VALUE';

export const MOQ_LINE_OVERRIDE_SCOPE = 'moq:line_override' as const;

/** 已确认及以上状态：数量变更触发 §X 重算（草稿/已取消不触发） */
const PATCH_REVALIDATE_STATUSES = new Set(['Confirmed', 'Production', 'Shipping']);

function moqError(code: string, message: string): Error & { code: string } {
  const err = new Error(`${code}: ${message}`) as Error & { code: string };
  err.code = code;
  return err;
}

// ───────────────────────────────────────────────────────────────────
// 类型
// ───────────────────────────────────────────────────────────────────

export interface ValidateCreateLineInput {
  quantity: number;
  unit?: string;
  moqOverride?: number | null;
  productAssetId?: string | null;
  styleNo?: string | null;
  materialCode?: string | null;
  /** 行级业务线（可选；报价单等无单据级 businessLine 的载体按行推导传入，缺省回退单据级） */
  businessLine?: string | null;
}

export interface ValidateCreateInput {
  /** Order.type（'Garment' / 'Fabric' ...）；businessLine 缺省时用于推导 */
  type?: string | null;
  /** fabric | garment | capsule | other */
  businessLine?: string | null;
  capsuleExemption?: boolean;
  customerRelationId?: string | null;
  /** 已有 writeOnce 快照（变更/重检场景）；创建场景不传 → 实时配置口径 */
  snapshot?: Partial<MoqSnapshot> | null;
  lines: ValidateCreateLineInput[];
}

export type MoqGapSeverity = 'none' | 'low' | 'medium' | 'high';

export interface MoqLineVerdict {
  lineIndex: number;
  quantity: number;
  unit: string;
  effectiveMoq: number;
  source: MoqSource;
  capsuleActive: boolean;
  compliant: boolean;
  /** 缺口百分比（仅不合规时 >0，1 位小数） */
  gapPct: number;
  /** low ≤50%（黄）/ medium 50-80%（红）/ high >80%（深红 + 前端二次确认） */
  severity: MoqGapSeverity;
  badge: 'none' | 'yellow' | 'red';
  requiresApproval: boolean;
}

export interface MoqCreateValidation {
  ok: boolean;
  capsuleActive: boolean;
  /** capsuleExemption 勾选成立时由调用方落库（DR-003 审计字段） */
  capsuleExemptionBy?: string;
  capsuleExemptionAt?: string;
  lines: MoqLineVerdict[];
  blockedLineIndexes: number[];
  snapshot: MoqSnapshot;
  approvalRequestId?: string;
  approvalError?: string;
}

export interface ValidateCreateOptions {
  actor?: MoqActor | null;
  autoCreateApproval?: boolean;
  targetType?: 'Order' | 'Quotation';
  targetId?: string | null;
}

export interface ValidatePatchInput {
  orderId: string;
  beforeQty: number;
  afterQty: number;
  actorId: string;
}

export interface MoqPatchValidation {
  blocked: boolean;
  approvalRequestId?: string;
  approvalError?: string;
  cancelledCount?: number;
  effectiveMoq?: number;
  source?: MoqSource;
  capsuleActive?: boolean;
  reason: 'below_threshold' | 'restored_compliance' | 'still_below_threshold' | 'not_applicable';
}

export interface MoqValidationServiceOptions {
  prisma: PrismaClient;
  configService: MoqConfigService;
  resolutionService: MoqResolutionService;
  approvalCreateService?: ApprovalCreateService;
}

// ───────────────────────────────────────────────────────────────────
// Capsule 资格（§6 #0：仅成衣订单可勾选）
// ───────────────────────────────────────────────────────────────────

export function isCapsuleEligible(ctx: { type?: string | null; businessLine?: string | null }): boolean {
  if (isGarmentFamily(ctx.businessLine)) return true;
  // type 口径与 order_type 字典对齐（apparel 为字典合法值；仅认 garment 时 Capsule 豁免误拒）
  const t = (ctx.type ?? '').toLowerCase();
  return t === 'garment' || t === 'apparel';
}

export function createMoqValidationService(opts: MoqValidationServiceOptions) {
  const { prisma, configService, resolutionService, approvalCreateService } = opts;
  const db = prisma as any;

  function deriveBusinessLine(input: { type?: string | null; businessLine?: string | null }): string | null {
    if (input.businessLine) return input.businessLine;
    const t = (input.type ?? '').toLowerCase();
    // type 口径与 order_type 字典对齐（apparel → garment 家族）
    if (t === 'garment' || t === 'apparel') return 'garment';
    if (t === 'fabric') return 'fabric';
    return null;
  }

  function severityOf(gapPct: number): MoqGapSeverity {
    if (gapPct <= 0) return 'none';
    if (gapPct <= 50) return 'low';
    if (gapPct <= 80) return 'medium';
    return 'high';
  }

  function hitConditionsOf(businessLine: string | null, capsuleActive: boolean, severity: MoqGapSeverity): string[] {
    const tier = capsuleActive ? 'capsule_moq' : isGarmentFamily(businessLine) ? 'garment_default_moq' : 'fabric_default_moq';
    const gap = severity === 'high' ? 'gap_gt80pct' : severity === 'medium' ? 'gap_50_80pct' : 'gap_lt50pct';
    return [tier, gap];
  }

  // ── 内部：经 approvalCreateService 创建 MOQ 豁免审批单（DR-007 服务端解析 reviewerId，禁止手写） ──
  async function createExemptionApproval(params: {
    actorId: string;
    targetType: 'Order' | 'Quotation';
    targetId?: string | null;
    reason: string;
    risk: string;
    payload: Record<string, unknown>;
  }): Promise<{ approvalRequestId?: string; approvalError?: string }> {
    if (!approvalCreateService) {
      logger.warn('[MoqValidation] approvalCreateService 未注入，跳过豁免审批单创建', { reason: params.reason });
      return { approvalError: 'approval service unavailable' };
    }
    try {
      const created = await approvalCreateService.createBusinessApproval({
        requesterId: params.actorId,
        actionType: params.targetType === 'Quotation' ? 'quotation:moq-exemption' : 'order:moq-exemption',
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        risk: params.risk,
        payload: { policyKey: 'moq_exemption', ...params.payload },
      });
      logger.info('[MoqValidation] MOQ 豁免审批单已创建', { approvalId: created.id, reason: params.reason });
      return { approvalRequestId: created.id };
    } catch (e: any) {
      // §6 #1 异常分支：审批创建失败不静默放行，由调用方保持 blocked / 记录 approvalError
      logger.error('[MoqValidation] MOQ 豁免审批单创建失败（fail-closed）', { error: e?.message, code: e?.code });
      return { approvalError: e?.message ?? String(e) };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // validateCreate — OrderLine/QuotationLine 保存（新增/编辑）校验
  // ══════════════════════════════════════════════════════════════════
  async function validateCreate(
    input: ValidateCreateInput,
    options: ValidateCreateOptions = {},
  ): Promise<MoqCreateValidation> {
    const actor = options.actor ?? null;
    const businessLine = deriveBusinessLine(input);
    const capsuleRequested = input.capsuleExemption === true;

    // 门禁 1：Capsule 豁免仅成衣订单（§6 #0 异常分支 → 403）
    if (capsuleRequested && !isCapsuleEligible(input)) {
      throw moqError(MOQ_CAPSULE_NOT_ALLOWED, 'Capsule 豁免仅适用于服装订单');
    }

    // 门禁 2：行级 override 需登录 + scope moq:line_override（B6 越权守卫）
    const hasOverride = input.lines.some((l) => typeof l.moqOverride === 'number' && l.moqOverride > 0);
    if (hasOverride && (!actor?.userId || !moqActorHasScope(actor, MOQ_LINE_OVERRIDE_SCOPE))) {
      logger.warn('[MoqValidation] 越权行级 MOQ override 被拒绝', { actorId: actor?.userId });
      throw moqError(MOQ_SCOPE_DENIED, `INSUFFICIENT_SCOPE ${MOQ_LINE_OVERRIDE_SCOPE}（行级 MOQ 覆盖需授权）`);
    }

    // 口径快照：合法输入快照优先（不追溯），否则实时配置/兜底（一次构建，全行共用）
    const snapshot: MoqSnapshot = isValidSnapshot(input.snapshot)
      ? (input.snapshot as MoqSnapshot)
      : await configService.buildSnapshot();

    const verdicts: MoqLineVerdict[] = [];
    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw moqError(MOQ_INVALID_VALUE, `行 ${i + 1} quantity 必须为正数（当前: ${String(line.quantity)}）`);
      }
      // 行级 businessLine 优先（报价单等无单据级业务线的载体逐行推导），缺省回退单据级
      const lineBusinessLine = line.businessLine ?? businessLine;
      const r = await resolutionService.resolveEffectiveMoq({
        businessLine: lineBusinessLine,
        capsuleExemption: capsuleRequested && isGarmentFamily(lineBusinessLine),
        moqOverride: line.moqOverride ?? null,
        productAssetId: line.productAssetId ?? null,
        styleNo: line.styleNo ?? null,
        customerRelationId: input.customerRelationId ?? null,
        snapshot,
      });
      const compliant = quantity >= r.effectiveMoq;
      const gapPct = compliant ? 0 : Math.round(((r.effectiveMoq - quantity) / r.effectiveMoq) * 1000) / 10;
      const severity = severityOf(gapPct);
      verdicts.push({
        lineIndex: i,
        quantity,
        unit: line.unit ?? r.unit,
        effectiveMoq: r.effectiveMoq,
        source: r.source,
        capsuleActive: r.capsuleActive,
        compliant,
        gapPct,
        severity,
        badge: severity === 'none' ? 'none' : severity === 'low' ? 'yellow' : 'red',
        requiresApproval: !compliant,
      });
    }

    const blockedLineIndexes = verdicts.filter((v) => !v.compliant).map((v) => v.lineIndex);
    const result: MoqCreateValidation = {
      ok: blockedLineIndexes.length === 0,
      capsuleActive: capsuleRequested && isGarmentFamily(businessLine),
      lines: verdicts,
      blockedLineIndexes,
      snapshot,
    };
    if (result.capsuleActive && actor?.userId) {
      result.capsuleExemptionBy = actor.userId;
      result.capsuleExemptionAt = new Date().toISOString();
    }

    // 低于 effectiveMoq → 经 approvalCreateService 走豁免审批链（DR-007 单人单次）
    if (!result.ok && options.autoCreateApproval && actor?.userId) {
      const worst = verdicts.reduce<MoqGapSeverity>(
        (acc, v) => (v.severity === 'high' ? 'high' : v.severity === 'medium' && acc !== 'high' ? 'medium' : acc),
        'none',
      );
      const { approvalRequestId, approvalError } = await createExemptionApproval({
        actorId: actor.userId,
        targetType: options.targetType ?? 'Order',
        targetId: options.targetId ?? null,
        reason: 'below_moq_on_save',
        risk: worst === 'high' ? 'high' : 'medium',
        payload: {
          reason: 'below_moq_on_save',
          hitConditions: hitConditionsOf(businessLine, result.capsuleActive, worst),
          businessLine,
          lines: verdicts.filter((v) => !v.compliant).map((v) => ({
            lineIndex: v.lineIndex, quantity: v.quantity, effectiveMoq: v.effectiveMoq,
            gapPct: v.gapPct, source: v.source,
          })),
          snapshotRef: snapshot.configId,
        },
      });
      if (approvalRequestId) result.approvalRequestId = approvalRequestId;
      if (approvalError) result.approvalError = approvalError;
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════
  // validatePatch — §X 订单变更门禁（Confirmed+ 数量变更 fail-closed 重算）
  // ══════════════════════════════════════════════════════════════════
  async function validatePatch(input: ValidatePatchInput): Promise<MoqPatchValidation> {
    const { orderId, beforeQty, afterQty, actorId } = input;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, status: true, type: true, businessLine: true,
        capsuleExemption: true, moqSnapshot: true, customerRelationId: true,
      },
    });
    if (!order) throw moqError(MOQ_ORDER_NOT_FOUND, `订单 ${orderId} 不存在`);

    // 草稿/已取消订单不触发（§X.1 前置条件）
    if (!PATCH_REVALIDATE_STATUSES.has(order.status)) {
      return { blocked: false, reason: 'not_applicable' };
    }

    // 取数：优先 Order.moqSnapshot（同单生命周期口径一致，不重新拉配置）
    const resolution = await resolutionService.resolveEffectiveMoq({
      // type 口径与 order_type 字典对齐（apparel → garment 家族）
      businessLine: order.businessLine ?? (['garment', 'apparel'].includes(String(order.type ?? '').toLowerCase()) ? 'garment' : 'fabric'),
      capsuleExemption: order.capsuleExemption === true,
      customerRelationId: order.customerRelationId ?? null,
      snapshot: order.moqSnapshot as Partial<MoqSnapshot> | null,
    });
    const moq = resolution.effectiveMoq;

    // ── 正向：变更前 ≥ MOQ 且变更后 < MOQ → fail-closed 阻断 + 自动豁免审批单（X.2） ──
    if (beforeQty >= moq && afterQty < moq) {
      const gapPct = Math.round(((moq - afterQty) / moq) * 1000) / 10;
      const severity = severityOf(gapPct);
      const { approvalRequestId, approvalError } = await createExemptionApproval({
        actorId,
        targetType: 'Order',
        targetId: orderId,
        reason: 'qty_change_below_moq',
        risk: severity === 'high' ? 'high' : 'medium',
        payload: {
          reason: 'qty_change_below_moq',
          hitConditions: hitConditionsOf(order.businessLine ?? null, resolution.capsuleActive, severity),
          beforeQty,
          afterQty,
          moqEffective: moq,
          businessLine: order.businessLine ?? null,
          hitGap: '正向跌破',
          gapPct,
          snapshotRef: resolution.snapshot.configId,
        },
      });
      return {
        blocked: true,
        approvalRequestId,
        approvalError,
        effectiveMoq: moq,
        source: resolution.source,
        capsuleActive: resolution.capsuleActive,
        reason: 'below_threshold',
      };
    }

    // ── 反向：变更后回升合规 → 自动取消挂起的 qty_change_below_moq 豁免单（X.3） ──
    if (afterQty >= moq) {
      const cancelledCount = await cancelPendingMoqExemptionIfAny(orderId);
      return {
        blocked: false,
        cancelledCount,
        effectiveMoq: moq,
        source: resolution.source,
        capsuleActive: resolution.capsuleActive,
        reason: 'restored_compliance',
      };
    }

    // 变更前后均低于 MOQ（未发生新跌破，原挂起审批单继续承载）
    return {
      blocked: false,
      effectiveMoq: moq,
      source: resolution.source,
      capsuleActive: resolution.capsuleActive,
      reason: 'still_below_threshold',
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // cancelPendingMoqExemptionIfAny — X.3 反向场景联动
  // 仅取消 status='pending' 且 payload.reason='qty_change_below_moq' 的单据；
  // 已 Approved 不回退（审计轨迹不逆向删除）。
  // 注：ApprovalRequest 模型当前无 deletedAt 字段，只能写 status='Cancelled'（schema 补齐后联动）。
  // ══════════════════════════════════════════════════════════════════
  async function cancelPendingMoqExemptionIfAny(orderId: string): Promise<number> {
    const pendings = await db.approvalRequest.findMany({
      where: {
        targetType: 'Order',
        targetId: orderId,
        actionType: 'order:moq-exemption',
        status: 'pending',
      },
      select: { id: true, payload: true },
    });
    const ids = (pendings ?? [])
      .filter((p: any) => p?.payload && (p.payload as any).reason === 'qty_change_below_moq')
      .map((p: any) => p.id);
    if (ids.length === 0) return 0;
    const r = await db.approvalRequest.updateMany({
      where: { id: { in: ids } },
      data: { status: 'Cancelled' },
    });
    logger.info('[MoqValidation] 数量回升合规，自动取消挂起 MOQ 豁免单', { orderId, cancelledCount: r?.count ?? ids.length });
    return r?.count ?? ids.length;
  }

  return { validateCreate, validatePatch, cancelPendingMoqExemptionIfAny };
}

export type MoqValidationService = ReturnType<typeof createMoqValidationService>;
