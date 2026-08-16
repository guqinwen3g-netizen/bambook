/**
 * exceptionService.ts — DR-013 全局业务门禁受控例外服务（Track E 唯一入口）
 *
 * 设计真源：
 *   - docs/design/10-评审与决策/2026-08-16-设计评审决策记录.md DR-013
 *   - docs/design/04-模块设计/07-AI助手/审批与human-in-the-loop.md §15（DR013-A1~A8/B1~B5/C1~C5）
 *   - docs/design/04-模块设计/03-订单与生产/Pricing-定价与成本/偏差校验与审批链.md §11/§13（DEV-11/DEV-13）
 *
 * 铁律（fail-closed）：
 *   1. 创建必填 5 字段（DR013-C3）：拟越过门禁(exceptionCategory) + 原因(≥30字) + 风险/补救
 *      (riskMitigationPlan) + 受影响对象(targetType+targetId+action) + 跟进责任人(responsibleOwnerId)，
 *      缺任一 400 MISSING_MANDATORY_EXCEPTION_FIELDS；reason ≤29 字 400 EXCEPTION_REASON_TOO_SHORT
 *   2. 审批链必须经 approvalCreateService.createBusinessApproval 创建
 *      （actionType='order:dr013-exception'，reviewerId 服务端 DR-007 解析，前端传入仅作审计标记）
 *   3. 生效模型：批准后仅对「指定对象 + 指定动作 + 指定时点」开放（maxUses 一次性 + validUntil 窗口期，
 *      过期自动失效）；例外不改变原门禁状态、不自动复制到其他订单、未获批准保持原门禁
 *   4. BOSS 最终兜底：仅 owner 角色（route 层守卫），reason ≥30 字，ApprovalRequest 与
 *      Dr013ExceptionRequest 双模型写入 bossFinalBypass*（同事务，DEV-13-B4/DR013-B3）
 *   5. 审批结论同步采用惰性对账（approvals 域 decide 不回调本域）：任何读取/消费 EXC 的路径
 *      先 reconcile 关联 ApprovalRequest 状态，再判定生效性；对账写审计（DR013-C4）
 *   6. 审计：申请/批准/拒绝/BOSS 兜底/消费/过期/撤回全留痕（actor、时间、理由、被越过规则、
 *      原状态、后续结果），审计写入与状态变更同事务（失败即回滚，不伪成功）
 *
 * Schema 约束说明（schema.prisma 冻结，不得改）：
 *   Dr013ExceptionRequest 无 targetType/targetId/action/validUntil 列；按 DR013-B5 设计许可
 *   （「JSON 扩展字段或模型新增字段」），生效范围统一存 attachments JSON：
 *     attachments = { files: unknown[], scope: ExceptionScope }
 *   scope 内含 targetType/targetId/action/validUntil/maxUses/usedCount/consumptions/responsibleOwnerId。
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import {
  EXCEPTION_CATEGORIES,
  type ActiveExceptionSummary,
  type ExceptionCategory,
  type ExceptionCheckResult,
  type ExceptionInactiveReason,
  type ExceptionScopeMatch,
} from './exceptionGate';
import type { ApprovalCreateService } from '../approvals/approvalCreateService';

// ───────────────────────────────────────────────────────────────────
// 错误码（全部 fail-closed）
// ───────────────────────────────────────────────────────────────────
export const EXCEPTION_ERRORS = {
  MISSING_MANDATORY_EXCEPTION_FIELDS: 'MISSING_MANDATORY_EXCEPTION_FIELDS',
  EXCEPTION_REASON_TOO_SHORT: 'EXCEPTION_REASON_TOO_SHORT',
  INVALID_EXCEPTION_CATEGORY: 'INVALID_EXCEPTION_CATEGORY',
  INVALID_VALID_UNTIL: 'INVALID_VALID_UNTIL',
  INVALID_MAX_USES: 'INVALID_MAX_USES',
  BYPASSED_APPROVAL_NOT_FOUND: 'BYPASSED_APPROVAL_NOT_FOUND',
  BYPASSED_APPROVAL_NOT_REJECTED: 'BYPASSED_APPROVAL_NOT_REJECTED',
  EXCEPTION_NOT_FOUND: 'EXCEPTION_NOT_FOUND',
  EXCEPTION_NOT_PENDING: 'EXCEPTION_NOT_PENDING',
  EXCEPTION_NOT_ACTIVE: 'EXCEPTION_NOT_ACTIVE',
  EXCEPTION_NOT_FOR_THIS_ENTITY: 'EXCEPTION_NOT_FOR_THIS_ENTITY',
  EXCEPTION_ALREADY_CONSUMED: 'EXCEPTION_ALREADY_CONSUMED',
  EXCEPTION_EXPIRED: 'EXCEPTION_EXPIRED',
  WITHDRAW_NOT_BY_REQUESTER: 'WITHDRAW_NOT_BY_REQUESTER',
  BOSS_REASON_TOO_SHORT: 'BOSS_REASON_TOO_SHORT',
} as const;

export type ExceptionErrorCode = (typeof EXCEPTION_ERRORS)[keyof typeof EXCEPTION_ERRORS];

export type ExceptionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; statusCode: number } };

// ───────────────────────────────────────────────────────────────────
// 状态机（schema 注释真源：Draft → Pending → ReviewerApproved / ReviewerRejected
//   → BossFinalBypass → Approved / Cancelled；本服务扩展 Consumed/Expired 两个终态
//   承载「一次性核销 / 窗口期过期」生效模型）
//   生效集合 = ReviewerApproved | BossFinalBypass
// ───────────────────────────────────────────────────────────────────
export const EXCEPTION_STATUS = {
  PENDING: 'Pending',
  REVIEWER_APPROVED: 'ReviewerApproved',
  REVIEWER_REJECTED: 'ReviewerRejected',
  BOSS_FINAL_BYPASS: 'BossFinalBypass',
  CONSUMED: 'Consumed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
} as const;

const EFFECTIVE_STATUSES: ReadonlySet<string> = new Set([
  EXCEPTION_STATUS.REVIEWER_APPROVED,
  EXCEPTION_STATUS.BOSS_FINAL_BYPASS,
]);

/** EXC 审批链 actionType（DEV-11-A1 第 5 类，DR-007 统一路由，无特殊分支） */
export const DR013_ACTION_TYPE = 'order:dr013-exception';

const EXCEPTION_REASON_MIN = 30; // DR013-C3：exceptionReason ≥30 字（fail-closed）
const BOSS_REASON_MIN = 30;      // DEV-13-B4：bossFinalBypassReason ≥30 字（复用 approvalKernelRoute 语义）

// ───────────────────────────────────────────────────────────────────
// 生效范围（attachments JSON 扩展字段，schema 冻结期的设计许可方案）
// ───────────────────────────────────────────────────────────────────
export interface ExceptionConsumption {
  consumedBy: string;
  consumedAt: string; // ISO
  note?: string | null;
}

export interface ExceptionScope {
  targetType: string;
  targetId: string;
  action: string;
  /** 生效窗口截止（ISO；null=无时间窗口） */
  validUntil: string | null;
  /** 允许核销次数（默认 1 = 一次性） */
  maxUses: number;
  usedCount: number;
  consumptions: ExceptionConsumption[];
  /** 补救/跟进责任人（DR013-C3 必填 5 字段之一） */
  responsibleOwnerId: string;
}

function parseScope(exc: any): ExceptionScope | null {
  const raw = exc?.attachments?.scope;
  if (!raw || typeof raw !== 'object') return null;
  return raw as ExceptionScope;
}

function parseFiles(exc: any): unknown[] {
  const files = exc?.attachments?.files;
  return Array.isArray(files) ? files : [];
}

/** 详情视图：DB 记录 + 解析后的 scope/files（路由与服务返回值统一使用） */
export function toExceptionView(exc: any) {
  return { ...exc, scope: parseScope(exc), files: parseFiles(exc) };
}

function toSummary(exc: any, scope: ExceptionScope): ActiveExceptionSummary {
  return {
    id: exc.id,
    exceptionNumber: exc.exceptionNumber,
    exceptionCategory: exc.exceptionCategory,
    subCategory: exc.subCategory ?? null,
    status: exc.status,
    bossFinalBypass: exc.status === EXCEPTION_STATUS.BOSS_FINAL_BYPASS || Boolean(exc.bossFinalBypassBy),
    validUntil: scope.validUntil,
  };
}

const genId = () => `EXC__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const auditId = () => `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function fail<T>(code: string, message: string, statusCode: number): ExceptionResult<T> {
  return { ok: false, error: { code, message, statusCode } };
}

// ───────────────────────────────────────────────────────────────────
// 服务工厂
// ───────────────────────────────────────────────────────────────────
export interface ExceptionServiceOptions {
  prisma: PrismaClient;
  approvalCreateService: ApprovalCreateService;
}

export interface CreateExceptionRequestInput {
  /** 拟越过门禁（必填，8 类枚举） */
  exceptionCategory: ExceptionCategory;
  subCategory?: string | null;
  /** 被绕过的被拒审批链（ApprovalRequest.id 列表，必须全部 status=rejected；可空=直接越过门禁无前序审批） */
  bypassedApprovalIds?: string[];
  /** 例外理由（必填，≥30 字） */
  exceptionReason: string;
  customerCommitment?: string | null;
  /** 风险应对/补救措施（必填） */
  riskMitigationPlan: string;
  /** 受影响对象 + 动作（必填，精确匹配三元组） */
  targetType: string;
  targetId: string;
  action: string;
  /** 生效窗口截止（Date / ISO 字符串；缺省 null=仅受一次性约束；提供时必须晚于当前时间） */
  validUntil?: Date | string | null;
  /** 允许核销次数（默认 1=一次性；>1 需更高裁量，仍按指定对象/动作精确匹配） */
  maxUses?: number;
  /** 补救/跟进责任人（必填） */
  responsibleOwnerId: string;
  requesterId: string;
  notes?: string | null;
  /** 附件文件列表（客户承诺截图等；存入 attachments.files） */
  attachments?: unknown;
  /** 前端越权传入的 reviewerId（将被忽略，仅透传 createBusinessApproval 作审计标记） */
  clientSuppliedReviewerId?: string | null;
}

export function createExceptionService(opts: ExceptionServiceOptions) {
  const { prisma, approvalCreateService } = opts;

  // ── 内部：审计（与状态变更同事务调用；失败上抛回滚，不伪成功） ──
  async function writeAudit(
    tx: any,
    input: {
      actorId: string;
      action: string;
      exceptionId: string;
      detail: Record<string, unknown>;
      beforeStatus?: string | null;
      afterStatus?: string | null;
      transactionId?: string | null;
    },
  ) {
    await tx.auditLog.create({
      data: {
        id: auditId(),
        actorId: input.actorId || 'system',
        action: input.action,
        targetType: 'Dr013ExceptionRequest',
        targetId: input.exceptionId,
        detail: { source: 'service:exceptions', ...input.detail } as any,
        ip: null,
        operationType: input.beforeStatus ? 'transition' : 'create',
        fieldPath: input.beforeStatus ? 'status' : null,
        beforeValue: input.beforeStatus ?? null,
        afterValue: input.afterStatus ?? null,
        transactionId: input.transactionId ?? null,
      },
    });
  }

  // ── 内部：生成业务单号 EXC-YYYYMMDD-xxx ──
  async function nextExceptionNumber(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `EXC-${day}-`;
    const count = await prisma.dr013ExceptionRequest
      .count({ where: { exceptionNumber: { startsWith: prefix } } })
      .catch(() => 0);
    return `${prefix}${String(count + 1).padStart(3, '0')}`;
  }

  // ── 内部：惰性对账（approvals 域 decide 不回调本域；读取路径先同步审批结论） ──
  //   approved（无 boss 字段） → ReviewerApproved
  //   approved + bossFinalBypassBy → BossFinalBypass + 镜像 bossFinalBypass*（双模型，DEV-13-B4）
  //   rejected → ReviewerRejected
  //   cancelled → Cancelled
  async function reconcileWithApproval(exc: any): Promise<any> {
    if (!exc || exc.status !== EXCEPTION_STATUS.PENDING || !exc.approvalRequestId) return exc;
    const approval = await prisma.approvalRequest.findUnique({ where: { id: exc.approvalRequestId } });
    if (!approval || approval.status === 'pending') return exc;

    let toStatus: string | null = null;
    let auditAction: string | null = null;
    let bossFields: Record<string, unknown> = {};
    if (approval.status === 'approved') {
      if (approval.bossFinalBypassBy) {
        toStatus = EXCEPTION_STATUS.BOSS_FINAL_BYPASS;
        auditAction = 'dr013_exception_boss_final_bypass';
        bossFields = {
          bossFinalBypassBy: approval.bossFinalBypassBy,
          bossFinalBypassAt: approval.bossFinalBypassAt,
          bossFinalBypassReason: approval.bossFinalBypassReason,
        };
      } else {
        toStatus = EXCEPTION_STATUS.REVIEWER_APPROVED;
        auditAction = 'dr013_exception_approved';
      }
    } else if (approval.status === 'rejected') {
      toStatus = EXCEPTION_STATUS.REVIEWER_REJECTED;
      auditAction = 'dr013_exception_rejected';
    } else if (approval.status === 'cancelled') {
      toStatus = EXCEPTION_STATUS.CANCELLED;
      auditAction = 'dr013_exception_cancelled';
    }
    if (!toStatus || !auditAction) return exc;

    try {
      return await prisma.$transaction(async (tx: any) => {
        const updated = await tx.dr013ExceptionRequest.update({
          where: { id: exc.id },
          data: { status: toStatus, ...bossFields },
        });
        await writeAudit(tx, {
          actorId: approval.bossFinalBypassBy ?? approval.reviewerId ?? 'system',
          action: auditAction!,
          exceptionId: exc.id,
          detail: {
            approvalRequestId: approval.id,
            decisionNote: approval.decisionNote ?? null,
            bossFinalBypassReason: approval.bossFinalBypassReason ?? null,
            exceptionCategory: exc.exceptionCategory,
            subCategory: exc.subCategory ?? null,
            bypassedApprovalIds: exc.bypassedApprovalIds ?? [],
            reconcile: 'lazy', // 惰性对账标记：审批域 decide 后由本域首个读取路径同步
          },
          beforeStatus: EXCEPTION_STATUS.PENDING,
          afterStatus: toStatus,
          transactionId: exc.approvalRequestId,
        });
        return updated;
      });
    } catch (e: any) {
      // 对账失败不阻断读取（返回未对账记录），但记录错误日志供排查
      logger.error('[Exceptions] 审批结论惰性对账失败', { exceptionId: exc.id, error: e?.message });
      return exc;
    }
  }

  // ── 内部：过期判定 + 惰性过期落库（DR013-B5：指定时点过期自动失效） ──
  async function expireIfNeeded(exc: any, scope: ExceptionScope, at: Date): Promise<any> {
    if (!scope.validUntil) return exc;
    if (!(new Date(scope.validUntil).getTime() < at.getTime())) return exc;
    if (exc.status !== EXCEPTION_STATUS.REVIEWER_APPROVED && exc.status !== EXCEPTION_STATUS.BOSS_FINAL_BYPASS) return exc;
    try {
      return await prisma.$transaction(async (tx: any) => {
        const updated = await tx.dr013ExceptionRequest.update({
          where: { id: exc.id },
          data: { status: EXCEPTION_STATUS.EXPIRED },
        });
        await writeAudit(tx, {
          actorId: 'system',
          action: 'dr013_exception_expired',
          exceptionId: exc.id,
          detail: { validUntil: scope.validUntil, evaluatedAt: at.toISOString(), exceptionNumber: exc.exceptionNumber },
          beforeStatus: exc.status,
          afterStatus: EXCEPTION_STATUS.EXPIRED,
          transactionId: exc.approvalRequestId ?? exc.id,
        });
        return updated;
      });
    } catch (e: any) {
      logger.error('[Exceptions] 例外过期落库失败', { exceptionId: exc.id, error: e?.message });
      return exc;
    }
  }

  const scopeMatches = (scope: ExceptionScope, match: ExceptionScopeMatch) =>
    scope.targetType === match.targetType && scope.targetId === match.targetId && scope.action === match.action;

  // ══════════════════════════════════════════════════════════════════
  // createExceptionRequest — 创建受控例外申请（scope 由 route 层守卫）
  // ══════════════════════════════════════════════════════════════════
  async function createExceptionRequest(
    input: CreateExceptionRequestInput,
  ): Promise<ExceptionResult<{ exception: any; approvalRequestId: string }>> {
    const {
      exceptionCategory, subCategory, exceptionReason, customerCommitment, riskMitigationPlan,
      targetType, targetId, action, validUntil, maxUses, responsibleOwnerId,
      requesterId, notes, attachments, clientSuppliedReviewerId,
    } = input;
    const bypassedApprovalIds = (input.bypassedApprovalIds ?? []).map((s) => String(s).trim()).filter(Boolean);

    // 1. 类别枚举校验
    if (!EXCEPTION_CATEGORIES.includes(exceptionCategory)) {
      return fail(
        EXCEPTION_ERRORS.INVALID_EXCEPTION_CATEGORY,
        `非法例外类别: ${String(exceptionCategory)}。允许: ${EXCEPTION_CATEGORIES.join(', ')}`,
        400,
      );
    }

    // 2. DR013-C3 必填 5 字段（缺任一 400 + 返回缺失清单）
    const missing: string[] = [];
    if (!(exceptionReason ?? '').trim()) missing.push('exceptionReason（原因）');
    if (!(riskMitigationPlan ?? '').trim()) missing.push('riskMitigationPlan（风险应对/补救）');
    if (!(targetType ?? '').trim()) missing.push('targetType（受影响对象类型）');
    if (!(targetId ?? '').trim()) missing.push('targetId（受影响对象）');
    if (!(action ?? '').trim()) missing.push('action（指定动作）');
    if (!(responsibleOwnerId ?? '').trim()) missing.push('responsibleOwnerId（补救/跟进责任人）');
    if (missing.length > 0) {
      return fail(
        EXCEPTION_ERRORS.MISSING_MANDATORY_EXCEPTION_FIELDS,
        `例外申请必填字段缺失（DR-013：拟越过门禁/原因/风险/受影响对象/补救跟进责任人）：${missing.join('、')}`,
        400,
      );
    }

    // 3. 理由长度 fail-closed（≥30 字）
    const reason = exceptionReason.trim();
    if (reason.length < EXCEPTION_REASON_MIN) {
      return fail(
        EXCEPTION_ERRORS.EXCEPTION_REASON_TOO_SHORT,
        `exceptionReason 至少 ${EXCEPTION_REASON_MIN} 字（当前 ${reason.length} 字，审计强制 fail-closed）`,
        400,
      );
    }

    // 4. 生效窗口：提供时必须为合法时间且晚于当前（创建即过期无意义）
    let validUntilIso: string | null = null;
    if (validUntil != null && validUntil !== '') {
      const d = validUntil instanceof Date ? validUntil : new Date(String(validUntil));
      if (Number.isNaN(d.getTime())) {
        return fail(EXCEPTION_ERRORS.INVALID_VALID_UNTIL, `validUntil 非合法时间: ${String(validUntil)}`, 400);
      }
      if (d.getTime() <= Date.now()) {
        return fail(EXCEPTION_ERRORS.INVALID_VALID_UNTIL, 'validUntil 必须晚于当前时间（指定时点窗口期，禁止创建即过期）', 400);
      }
      validUntilIso = d.toISOString();
    }

    // 5. 核销次数：整数 ≥1（默认 1=一次性）
    const uses = maxUses ?? 1;
    if (!Number.isInteger(uses) || uses < 1) {
      return fail(EXCEPTION_ERRORS.INVALID_MAX_USES, `maxUses 必须为 ≥1 的整数（当前 ${String(maxUses)}）`, 400);
    }

    // 6. 被绕过的被拒审批链校验：全部存在且 status=rejected（fail-closed）
    if (bypassedApprovalIds.length > 0) {
      const approvals = await prisma.approvalRequest.findMany({ where: { id: { in: bypassedApprovalIds } } });
      const found = new Set(approvals.map((a: any) => a.id));
      const notFound = bypassedApprovalIds.filter((id) => !found.has(id));
      if (notFound.length > 0) {
        return fail(EXCEPTION_ERRORS.BYPASSED_APPROVAL_NOT_FOUND, `被绕过审批单不存在: ${notFound.join(', ')}`, 404);
      }
      const notRejected = approvals.filter((a: any) => a.status !== 'rejected').map((a: any) => `${a.id}(${a.status})`);
      if (notRejected.length > 0) {
        return fail(
          EXCEPTION_ERRORS.BYPASSED_APPROVAL_NOT_REJECTED,
          `bypassedApprovalIds 只能绑定已被拒绝的审批单（status=rejected）: ${notRejected.join(', ')}`,
          400,
        );
      }
    }

    // 7. 审批单创建（DR-007 组织归属路由；NO_REVIEWER_RESOLVED 原样透传为 409）
    const exceptionId = genId();
    const exceptionNumber = await nextExceptionNumber();
    let approval;
    try {
      approval = await approvalCreateService.createBusinessApproval({
        requesterId,
        actionType: DR013_ACTION_TYPE,
        targetType: 'Dr013ExceptionRequest',
        targetId: exceptionId,
        payload: {
          exceptionNumber,
          exceptionCategory,
          subCategory: subCategory ?? null,
          bypassedApprovalIds,
          exceptionReason: reason,
          riskMitigationPlan: riskMitigationPlan.trim(),
          scope: { targetType: targetType.trim(), targetId: targetId.trim(), action: action.trim(), validUntil: validUntilIso, maxUses: uses },
          responsibleOwnerId: responsibleOwnerId.trim(),
        },
        risk: 'high',
        clientSuppliedReviewerId: clientSuppliedReviewerId ?? null,
      });
    } catch (e: any) {
      return fail(
        e?.code ?? 'EXCEPTION_CREATE_FAILED',
        e?.message ?? '审批单创建失败',
        e?.code === 'NO_REVIEWER_RESOLVED' ? 409 : 500,
      );
    }

    // 8. 事务：EXC 落库 + 被拒审批单反链（P0-15）+ 申请审计
    const scope: ExceptionScope = {
      targetType: targetType.trim(),
      targetId: targetId.trim(),
      action: action.trim(),
      validUntil: validUntilIso,
      maxUses: uses,
      usedCount: 0,
      consumptions: [],
      responsibleOwnerId: responsibleOwnerId.trim(),
    };
    try {
      const exception = await prisma.$transaction(async (tx: any) => {
        const exc = await tx.dr013ExceptionRequest.create({
          data: {
            id: exceptionId,
            exceptionNumber,
            exceptionCategory,
            subCategory: subCategory ?? null,
            bypassedApprovalIds,
            exceptionReason: reason,
            customerCommitment: customerCommitment?.trim() || null,
            riskMitigationPlan: riskMitigationPlan.trim(),
            requesterId,
            reviewerId: approval.reviewerId as string,
            approvalRequestId: approval.id,
            status: EXCEPTION_STATUS.PENDING,
            notes: notes ?? null,
            attachments: { files: Array.isArray(attachments) ? attachments : attachments ? [attachments] : [], scope } as any,
          },
        });
        // DEV-13-B1/DR013-B3：每张被拒审批单 ApprovalRequest.bypassedApprovalId = 本 EXC 的审批单 id（反链闭环）
        for (const bypassedId of bypassedApprovalIds) {
          await tx.approvalRequest.update({
            where: { id: bypassedId },
            data: { bypassedApprovalId: approval.id },
          });
        }
        // DR013-C4 申请审计：申请人/审批人/理由/被越过门禁/受影响对象/责任人 全字段
        await writeAudit(tx, {
          actorId: requesterId,
          action: 'dr013_exception_created',
          exceptionId,
          detail: {
            exceptionNumber,
            exceptionCategory,
            subCategory: subCategory ?? null,
            exceptionReason: reason,
            riskMitigationPlan: riskMitigationPlan.trim(),
            customerCommitment: customerCommitment?.trim() || null,
            bypassedApprovalIds,
            scope: { targetType: scope.targetType, targetId: scope.targetId, action: scope.action, validUntil: scope.validUntil, maxUses: scope.maxUses },
            responsibleOwnerId: scope.responsibleOwnerId,
            reviewerId: approval.reviewerId,
            approvalRequestId: approval.id,
          },
          afterStatus: EXCEPTION_STATUS.PENDING,
          transactionId: approval.id,
        });
        return exc;
      });
      logger.info('[Exceptions] 例外申请已创建', {
        exceptionId, exceptionNumber, exceptionCategory, requesterId,
        reviewerId: approval.reviewerId, approvalRequestId: approval.id,
      });
      return { ok: true, data: { exception, approvalRequestId: approval.id } };
    } catch (e: any) {
      logger.error('[Exceptions] 例外申请落库失败', { exceptionId, error: e?.message });
      return fail('EXCEPTION_CREATE_FAILED', `例外申请创建事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // getExceptionById — 详情（先惰性对账）
  // ══════════════════════════════════════════════════════════════════
  async function getExceptionById(exceptionId: string): Promise<ExceptionResult<{ exception: any }>> {
    const raw = await prisma.dr013ExceptionRequest.findUnique({ where: { id: exceptionId } });
    if (!raw || raw.deletedAt) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_NOT_FOUND, `例外申请 ${exceptionId} 不存在`, 404);
    }
    const exc = await reconcileWithApproval(raw);
    return { ok: true, data: { exception: toExceptionView(exc) } };
  }

  // ══════════════════════════════════════════════════════════════════
  // listExceptions — 列表（按状态/类别/申请人过滤；Pending 项惰性对账）
  // ══════════════════════════════════════════════════════════════════
  async function listExceptions(filter: {
    status?: string;
    exceptionCategory?: string;
    requesterId?: string;
    limit?: number;
  }): Promise<ExceptionResult<{ items: any[] }>> {
    const where: any = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.exceptionCategory) where.exceptionCategory = filter.exceptionCategory;
    if (filter.requesterId) where.requesterId = filter.requesterId;
    const rows = await prisma.dr013ExceptionRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
    const reconciled = [] as any[];
    for (const row of rows) {
      reconciled.push(row.status === EXCEPTION_STATUS.PENDING ? await reconcileWithApproval(row) : row);
    }
    return { ok: true, data: { items: reconciled.map(toExceptionView) } };
  }

  // ══════════════════════════════════════════════════════════════════
  // hasActiveException — 其他域门禁消费的核心查询
  //   生效中（ReviewerApproved/BossFinalBypass）+ 未过期 + 对象/动作精确匹配 + 未核销完
  // ══════════════════════════════════════════════════════════════════
  async function hasActiveException(match: ExceptionScopeMatch): Promise<ExceptionCheckResult> {
    const at = match.at ?? new Date();
    if (!match.targetType || !match.targetId || !match.action) {
      return { active: false, reason: 'NO_ACTIVE_EXCEPTION' };
    }
    // 候选取全量未删记录（含 Consumed/Expired/Rejected，用于返回精确失效原因；
    // 例外单为低频数据，内存过滤量级可控）；精确匹配在内存完成（scope 为 JSON 扩展字段）
    const candidates = await prisma.dr013ExceptionRequest.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    let sawUnapproved = false;
    let sawExpired = false;
    let sawConsumed = false;

    for (const raw of candidates) {
      const scope = parseScope(raw);
      if (!scope || !scopeMatches(scope, match)) continue; // 精确匹配，绝不泛化到其他订单/动作

      if (raw.status === EXCEPTION_STATUS.EXPIRED) { sawExpired = true; continue; }
      if (raw.status === EXCEPTION_STATUS.CONSUMED) { sawConsumed = true; continue; }

      let exc = raw.status === EXCEPTION_STATUS.PENDING ? await reconcileWithApproval(raw) : raw;
      if (!EFFECTIVE_STATUSES.has(exc.status)) {
        sawUnapproved = true; // 未获批准保持原门禁
        continue;
      }
      exc = await expireIfNeeded(exc, scope, at);
      if (exc.status === EXCEPTION_STATUS.EXPIRED) {
        sawExpired = true;
        continue;
      }
      if (scope.usedCount >= scope.maxUses) {
        sawConsumed = true;
        continue;
      }
      return { active: true, exception: toSummary(exc, scope) };
    }

    const reason: ExceptionInactiveReason = sawExpired
      ? 'EXCEPTION_EXPIRED'
      : sawConsumed
        ? 'EXCEPTION_ALREADY_CONSUMED'
        : sawUnapproved
          ? 'EXCEPTION_NOT_APPROVED'
          : 'NO_ACTIVE_EXCEPTION';
    return { active: false, reason };
  }

  // ══════════════════════════════════════════════════════════════════
  // consumeException — 动作执行时核销（一次性/窗口期服务端强制）
  // ══════════════════════════════════════════════════════════════════
  async function consumeException(input: {
    exceptionId: string;
    targetType: string;
    targetId: string;
    action: string;
    consumedBy: string;
    note?: string | null;
    at?: Date;
  }): Promise<ExceptionResult<{ exception: any; consumed: boolean }>> {
    const at = input.at ?? new Date();
    const raw = await prisma.dr013ExceptionRequest.findUnique({ where: { id: input.exceptionId } });
    if (!raw || raw.deletedAt) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_NOT_FOUND, `例外申请 ${input.exceptionId} 不存在`, 404);
    }
    let exc = await reconcileWithApproval(raw);
    const scope = parseScope(exc);
    // 对象/动作精确匹配（DEV-13-B2：其他 Shipment 绑定同一 EXC → 400）
    if (!scope || !scopeMatches(scope, { targetType: input.targetType, targetId: input.targetId, action: input.action })) {
      return fail(
        EXCEPTION_ERRORS.EXCEPTION_NOT_FOR_THIS_ENTITY,
        `例外 ${raw.exceptionNumber} 仅适用于 ${scope ? `${scope.targetType}/${scope.targetId}/${scope.action}` : '未知范围'}，不可用于 ${input.targetType}/${input.targetId}/${input.action}`,
        400,
      );
    }
    // 精确终态优先返回专属错误码（DEV-13-B2/DR013-B5：已核销/已过期语义不得被泛化为 NOT_ACTIVE）
    if (exc.status === EXCEPTION_STATUS.CONSUMED || scope.usedCount >= scope.maxUses) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_ALREADY_CONSUMED, `例外 ${raw.exceptionNumber} 已核销（${scope.usedCount}/${scope.maxUses}），不得重复使用`, 409);
    }
    if (exc.status === EXCEPTION_STATUS.EXPIRED) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_EXPIRED, `例外 ${raw.exceptionNumber} 已过生效时点（validUntil=${scope.validUntil}），请重新申请 DR-013 例外`, 409);
    }
    // 未获批准保持原门禁（Pending/Rejected/Cancelled 均不可核销）
    if (!EFFECTIVE_STATUSES.has(exc.status)) {
      return fail(
        EXCEPTION_ERRORS.EXCEPTION_NOT_ACTIVE,
        `例外 ${raw.exceptionNumber} 当前状态 ${exc.status}，未处生效期，原门禁保持`,
        409,
      );
    }
    // 指定时点失效（DR013-B5：服务端校验，绝不信任前端）
    exc = await expireIfNeeded(exc, scope, at);
    if (exc.status === EXCEPTION_STATUS.EXPIRED) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_EXPIRED, `例外 ${raw.exceptionNumber} 已过生效时点（validUntil=${scope.validUntil}），请重新申请 DR-013 例外`, 409);
    }

    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const nextScope: ExceptionScope = {
          ...scope,
          usedCount: scope.usedCount + 1,
          consumptions: [
            ...scope.consumptions,
            { consumedBy: input.consumedBy, consumedAt: at.toISOString(), note: input.note ?? null },
          ],
        };
        const exhausted = nextScope.usedCount >= nextScope.maxUses;
        const u = await tx.dr013ExceptionRequest.update({
          where: { id: exc.id },
          data: {
            attachments: { files: parseFiles(exc), scope: nextScope } as any,
            ...(exhausted ? { status: EXCEPTION_STATUS.CONSUMED } : {}),
          },
        });
        await writeAudit(tx, {
          actorId: input.consumedBy,
          action: 'dr013_exception_consumed',
          exceptionId: exc.id,
          detail: {
            exceptionNumber: raw.exceptionNumber,
            exceptionCategory: raw.exceptionCategory,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            usedCount: nextScope.usedCount,
            maxUses: nextScope.maxUses,
            note: input.note ?? null,
          },
          beforeStatus: exc.status,
          afterStatus: exhausted ? EXCEPTION_STATUS.CONSUMED : exc.status,
          transactionId: raw.approvalRequestId ?? exc.id,
        });
        return u;
      });
      logger.info('[Exceptions] 例外已核销', {
        exceptionId: exc.id, exceptionNumber: raw.exceptionNumber,
        usedCount: scope.usedCount + 1, maxUses: scope.maxUses, consumedBy: input.consumedBy,
      });
      return { ok: true, data: { exception: toExceptionView(updated), consumed: true } };
    } catch (e: any) {
      logger.error('[Exceptions] 例外核销失败', { exceptionId: exc.id, error: e?.message });
      return fail('EXCEPTION_CONSUME_FAILED', `例外核销事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // withdrawException — 申请人撤回（仅 Pending，仅本人；级联撤回关联审批单）
  // ══════════════════════════════════════════════════════════════════
  async function withdrawException(params: {
    exceptionId: string;
    actorId: string;
  }): Promise<ExceptionResult<{ exception: any }>> {
    const { exceptionId, actorId } = params;
    const raw = await prisma.dr013ExceptionRequest.findUnique({ where: { id: exceptionId } });
    if (!raw || raw.deletedAt) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_NOT_FOUND, `例外申请 ${exceptionId} 不存在`, 404);
    }
    const exc = await reconcileWithApproval(raw);
    if (exc.status !== EXCEPTION_STATUS.PENDING) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_NOT_PENDING, `例外申请当前状态 ${exc.status}，仅 Pending 可撤回`, 409);
    }
    if (exc.requesterId !== actorId) {
      return fail(EXCEPTION_ERRORS.WITHDRAW_NOT_BY_REQUESTER, '仅申请人本人可撤回例外申请', 403);
    }
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const u = await tx.dr013ExceptionRequest.update({
          where: { id: exc.id },
          data: { status: EXCEPTION_STATUS.CANCELLED },
        });
        if (exc.approvalRequestId) {
          await tx.approvalRequest.updateMany({
            where: { id: exc.approvalRequestId, status: 'pending' },
            data: { status: 'cancelled', decidedAt: new Date(), decisionNote: `例外申请 ${exc.exceptionNumber} 已被申请人撤回` },
          });
        }
        await writeAudit(tx, {
          actorId,
          action: 'dr013_exception_withdrawn',
          exceptionId: exc.id,
          detail: { exceptionNumber: exc.exceptionNumber, approvalRequestId: exc.approvalRequestId ?? null },
          beforeStatus: EXCEPTION_STATUS.PENDING,
          afterStatus: EXCEPTION_STATUS.CANCELLED,
          transactionId: exc.approvalRequestId ?? exc.id,
        });
        return u;
      });
      logger.info('[Exceptions] 例外申请已撤回', { exceptionId, actorId });
      return { ok: true, data: { exception: toExceptionView(updated) } };
    } catch (e: any) {
      logger.error('[Exceptions] 撤回例外失败', { exceptionId, error: e?.message });
      return fail('EXCEPTION_WITHDRAW_FAILED', `撤回事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // bossFinalBypassException — BOSS 最终兜底特批（owner 角色由 route 层守卫）
  //   复用 approvalKernelRoute boss-bypass 语义：仅 pending 可操作；reason ≥30 字；
  //   ApprovalRequest + Dr013ExceptionRequest 双模型写入（同事务，DEV-13-B4）
  // ══════════════════════════════════════════════════════════════════
  async function bossFinalBypassException(params: {
    exceptionId: string;
    bossId: string;
    reason: string;
  }): Promise<ExceptionResult<{ exception: any }>> {
    const { exceptionId, bossId } = params;
    const reason = (params.reason ?? '').trim();
    if (reason.length < BOSS_REASON_MIN) {
      return fail(
        EXCEPTION_ERRORS.BOSS_REASON_TOO_SHORT,
        `bossFinalBypassReason 至少 ${BOSS_REASON_MIN} 字（当前 ${reason.length} 字，绝密级审计强制 fail-closed）`,
        400,
      );
    }
    const raw = await prisma.dr013ExceptionRequest.findUnique({ where: { id: exceptionId } });
    if (!raw || raw.deletedAt) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_NOT_FOUND, `例外申请 ${exceptionId} 不存在`, 404);
    }
    const exc = await reconcileWithApproval(raw);
    if (exc.status !== EXCEPTION_STATUS.PENDING) {
      return fail(EXCEPTION_ERRORS.EXCEPTION_NOT_PENDING, `例外申请当前状态 ${exc.status}，仅 Pending 可 BOSS 兜底特批（被拒后须重新申请新例外单）`, 409);
    }

    const now = new Date();
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        // 1. 关联审批单写入 BOSS 兜底三字段（与 approvalKernelRoute 同语义）
        if (exc.approvalRequestId) {
          await tx.approvalRequest.updateMany({
            where: { id: exc.approvalRequestId, status: 'pending' },
            data: {
              status: 'approved',
              decidedAt: now,
              decisionNote: `[BOSS_FINAL_BYPASS] ${reason}`,
              bossFinalBypassBy: bossId,
              bossFinalBypassAt: now,
              bossFinalBypassReason: reason,
            },
          });
        }
        // 2. EXC 双模型写入（Dr013ExceptionRequest.bossFinalBypass*）
        const u = await tx.dr013ExceptionRequest.update({
          where: { id: exc.id },
          data: {
            status: EXCEPTION_STATUS.BOSS_FINAL_BYPASS,
            bossFinalBypassBy: bossId,
            bossFinalBypassAt: now,
            bossFinalBypassReason: reason,
          },
        });
        // 3. 双审计：审批单侧（kernel 同构）+ EXC 侧（DR013-C4 链路完整性）
        if (exc.approvalRequestId) {
          await tx.auditLog.create({
            data: {
              id: auditId(),
              actorId: bossId,
              action: 'boss_final_bypass',
              targetType: 'ApprovalRequest',
              targetId: exc.approvalRequestId,
              detail: { source: 'service:exceptions', actionType: DR013_ACTION_TYPE, exceptionId: exc.id, bossFinalBypassReason: reason } as any,
              ip: null,
              operationType: 'transition',
              fieldPath: 'status',
              beforeValue: 'pending',
              afterValue: 'approved',
              transactionId: exc.approvalRequestId,
            },
          });
        }
        await writeAudit(tx, {
          actorId: bossId,
          action: 'dr013_exception_boss_final_bypass',
          exceptionId: exc.id,
          detail: {
            exceptionNumber: exc.exceptionNumber,
            exceptionCategory: exc.exceptionCategory,
            subCategory: exc.subCategory ?? null,
            bossFinalBypassReason: reason,
            bypassedApprovalIds: exc.bypassedApprovalIds ?? [],
            approvalRequestId: exc.approvalRequestId ?? null,
          },
          beforeStatus: EXCEPTION_STATUS.PENDING,
          afterStatus: EXCEPTION_STATUS.BOSS_FINAL_BYPASS,
          transactionId: exc.approvalRequestId ?? exc.id,
        });
        return u;
      });
      logger.warn('[Exceptions] BOSS 最终兜底特批例外', { exceptionId, bossId, exceptionNumber: exc.exceptionNumber });
      return { ok: true, data: { exception: toExceptionView(updated) } };
    } catch (e: any) {
      logger.error('[Exceptions] BOSS 兜底特批失败', { exceptionId, error: e?.message });
      return fail('EXCEPTION_BOSS_BYPASS_FAILED', `BOSS 兜底特批事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  return {
    createExceptionRequest,
    getExceptionById,
    listExceptions,
    hasActiveException,
    consumeException,
    withdrawException,
    bossFinalBypassException,
  };
}

export type ExceptionService = ReturnType<typeof createExceptionService>;
