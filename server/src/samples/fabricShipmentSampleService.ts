/**
 * fabricShipmentSampleService.ts — 面料 S/S 船样 + RC 匹头样服务
 *
 * 设计真源：
 *   - DR-011（船样 S/S 面料订单必须管理；匹头样 RC 按订单条件启用、业务员决定并留痕；
 *            以面料订单 Exmill Date 驱动倒计时：S/S 出厂日前 2 周寄送并确认，
 *            启用 RC 的订单出厂日前 1 周完成确认；客户/合同另有时限以订单明确要求覆盖并留痕）
 *   - DR-012（船样客户确认 = 标准发货门禁；未确认不得视作可正常发货）
 *   - DR-014（S/S、按需 RC、面料大货 QC 三条件独立并行；本服务只输出样品链资格判定）
 *   - DR-039（每次样品寄送独立记录：收件方/寄送日期/快递服务商/快递单号 + 随附单据）
 *
 * 模型约束（schema 冻结，Phase 0 已落地，本轨不得改 schema）：
 *   - FabricShipmentSample 无 sampleKind 字段：S/S 与 RC 通过 sampleCode 前缀（FSS-/FRC-）
 *     与 attachments.sampleKind 双写区分；
 *   - 确认渠道/证据/确认人、RC 启用留痕、随附单据等扩展事实存 attachments JSON
 *     （保留既有键，read-modify-write）；
 *   - shipmentId 为必填 String：订单阶段样品先落 ''（空串），出运建单后由出运域绑定。
 *
 * 边界声明：
 *   - 本服务只输出「样品链发货资格判定」（computeShipmentEligibility），
 *     实际出运门禁由出运域消费本判定；面料大货 QC 条件由 QC/出运域独立评估（DR-014）。
 *   - DR-013 例外门禁消费点：assertFabricShipmentGate — 在 computeShipmentEligibility
 *     之上叠加 exceptionGate SDK（assertGateOrThrow + bindExceptionChecker），
 *     生效例外精确命中（targetType=Order + targetId=orderId + action=shipment:release）才放行；
 *     无 checker 注入时不具备资格一律 GATE_BLOCKED（fail-closed，无隐藏旁路）。
 */

import type { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import {
  assertGateOrThrow,
  bindExceptionChecker,
  GateBlockedError,
  GATE_BLOCKED,
  type ExceptionChecker,
  type ExceptionInactiveReason,
  type GatePassResult,
} from '../exceptions/exceptionGate';

// ────────────────────────────────────────────────────────────────────
// 常量与类型
// ────────────────────────────────────────────────────────────────────

export const FABRIC_SAMPLE_KINDS = ['SS', 'RC'] as const;
export type FabricSampleKind = (typeof FABRIC_SAMPLE_KINDS)[number];

/** DR-011 默认时限：S/S 出厂日前 2 周寄送并确认；启用 RC 出厂日前 1 周完成确认 */
export const SS_CONFIRM_DEADLINE_DAYS = 14;
export const RC_CONFIRM_DEADLINE_DAYS = 7;

export const FABRIC_SAMPLE_CUSTOMER_STATUSES = ['pending', 'approved', 'rejected', 'needs_revision'] as const;
export type FabricSampleCustomerStatus = (typeof FABRIC_SAMPLE_CUSTOMER_STATUSES)[number];

/** DR-012 资格判定阻断原因（出运域消费） */
export const SHIPMENT_GATE_BLOCKERS = [
  'SS_NOT_REGISTERED',
  'SS_NOT_SENT',
  'SS_NOT_CONFIRMED',
  'SS_REJECTED',
  'RC_NOT_SENT',
  'RC_NOT_CONFIRMED',
] as const;
export type ShipmentGateBlocker = (typeof SHIPMENT_GATE_BLOCKERS)[number];

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; status: number } };

/**
 * DR-013 例外门禁消费结果（assertFabricShipmentGate 专用）：
 *   放行分支携带 GatePassResult（gate 正常放行 / exception 例外放行 + 例外摘要供徽标展示）；
 *   阻断分支透传 blockingReasons + exceptionReason + exceptionEntryHint（引导 DR-013 申请入口）。
 */
export type FabricShipmentGateResult =
  | { ok: true; data: { eligibility: any; pass: GatePassResult } }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        status: number;
        blockingReasons?: string[];
        exceptionReason?: ExceptionInactiveReason;
        exceptionEntryHint?: string;
      };
    };

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}
function fail<T>(code: string, message: string, status = 400): Result<T> {
  return { ok: false, error: { code, message, status } };
}

// ────────────────────────────────────────────────────────────────────
// 日期工具（业务日期统一 YYYY-MM-DD 字符串，UTC 锚定避免时区漂移）
// ────────────────────────────────────────────────────────────────────

export function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function diffDaysYmd(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000);
}

// ────────────────────────────────────────────────────────────────────
// 内部辅助
// ────────────────────────────────────────────────────────────────────

function sampleKindOf(sample: any): FabricSampleKind {
  const att = sample?.attachments as any;
  if (att?.sampleKind === 'RC') return 'RC';
  if (typeof sample?.sampleCode === 'string' && sample.sampleCode.startsWith('FRC-')) return 'RC';
  return 'SS';
}

/** 面料订单判定：businessLine='fabric' 或 type='Fabric'（大小写不敏感） */
function isFabricOrder(order: any): boolean {
  if (!order) return false;
  if (String(order.businessLine ?? '').toLowerCase() === 'fabric') return true;
  return String(order.type ?? '').toLowerCase() === 'fabric';
}

async function resolveFabricOrder(prisma: PrismaClient, orderId: string): Promise<Result<{ order: any }>> {
  const order = await prisma.order.findFirst({ where: { id: orderId, deletedAt: null } });
  if (!order) return fail('NOT_FOUND', `订单 ${orderId} 不存在`, 404);
  if (!isFabricOrder(order)) return fail('NOT_FABRIC_ORDER', `订单 ${orderId} 不是面料订单，S/S 与 RC 仅属于面料订单样品链（DR-011 模型边界）`);
  return ok({ order });
}

function shortId(prefix: string): string {
  return `${prefix}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function nextSampleCode(prisma: PrismaClient, kind: FabricSampleKind): Promise<string> {
  const prefix = `${kind === 'RC' ? 'FRC' : 'FSS'}-${todayYmd().replace(/-/g, '')}`;
  const count = await prisma.fabricShipmentSample.count({ where: { sampleCode: { startsWith: prefix } } });
  return `${prefix}-${String(count + 1).padStart(3, '0')}`;
}

function mergeAttachments(existing: any, patch: Record<string, unknown>): any {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as any) } : {};
  return { ...base, ...patch };
}

// ────────────────────────────────────────────────────────────────────
// 倒计时（DR-011）：以面料订单 Exmill Date（Order.clientDate）驱动
// ────────────────────────────────────────────────────────────────────

export interface SampleCountdown {
  kind: FabricSampleKind;
  exmillDate: string | null;
  deadlineDays: number;            // 实际适用时限（RC 可被订单明确要求覆盖）
  deadlineOverridden: boolean;     // RC 时限是否被客户/合同明确要求覆盖
  confirmDeadline: string | null;  // 确认截止日 = Exmill − deadlineDays
  daysToDeadline: number | null;   // 负值 = 已逾期
  overdue: boolean;                // 未确认且已过截止日
  sent: boolean;
  confirmed: boolean;
  customerStatus: string;
}

export function computeSampleCountdown(sample: any, order: any): SampleCountdown {
  const kind = sampleKindOf(sample);
  const exmillDate: string | null = order?.clientDate ?? null;
  const rcCfg = kind === 'RC' ? (sample?.attachments as any)?.rc : null;
  const overridden = Number.isFinite(rcCfg?.deadlineOverrideDays);
  const deadlineDays = overridden ? Number(rcCfg.deadlineOverrideDays) : kind === 'SS' ? SS_CONFIRM_DEADLINE_DAYS : RC_CONFIRM_DEADLINE_DAYS;
  const confirmDeadline = exmillDate && isYmd(exmillDate) ? addDaysYmd(exmillDate, -deadlineDays) : null;
  const today = todayYmd();
  const confirmed = sample?.customerStatus === 'approved';
  const daysToDeadline = confirmDeadline ? diffDaysYmd(today, confirmDeadline) : null;
  const overdue = Boolean(confirmDeadline && !confirmed && today > confirmDeadline);
  return {
    kind,
    exmillDate,
    deadlineDays,
    deadlineOverridden: overridden,
    confirmDeadline,
    daysToDeadline,
    overdue,
    sent: Boolean(sample?.sentToCustomer),
    confirmed,
    customerStatus: sample?.customerStatus ?? 'pending',
  };
}

// ────────────────────────────────────────────────────────────────────
// 输入类型
// ────────────────────────────────────────────────────────────────────

export interface RegisterShipmentSampleInput {
  fabricProfileId?: string;
  shipmentId?: string;              // 出运单已建时可直接绑定；否则先空后绑定
  sampleQuantity: number;           // 必填：取样长度（米）
  sampleUnit?: string;
  batchNo?: string;
  rollNos?: string[];
  cuttingDate: string;              // 必填：取样日期 YYYY-MM-DD
  notes?: string;
}

export interface EnableHeadSampleInput {
  enabledReason: string;            // 必填：启用原因/依据留痕（DR-011；Separates/常年翻单仅为常见参考场景）
  deadlineOverrideDays?: number;    // 客户/合同明确时限覆盖（如 Exmill 前 10 天）
  deadlineOverrideReason?: string;  // 覆盖原因留痕（带 override 时必填）
  fabricProfileId?: string;
  sampleQuantity?: number;          // 启用时样品未剪可后置，寄送登记时补齐
  cuttingDate?: string;
  notes?: string;
}

export interface RegisterSampleShipmentInput {
  sentDate?: string;                // 默认今天
  courier: string;                  // 必填：快递服务商（DR-039）
  trackingNumber: string;           // 必填：快递单号
  recipientName: string;            // 必填：收件方
  recipientContact?: string;
  documents?: any[];                // 随附单据：样品发票/快递运费凭证等（DR-039）
  // 允许寄送时补齐样品基础信息（RC 启用时未剪样的场景）
  sampleQuantity?: number;
  cuttingDate?: string;
  batchNo?: string;
  rollNos?: string[];
}

export interface RegisterSampleConfirmationInput {
  result: 'approved' | 'rejected' | 'needs_revision'; // 客户确认结果
  confirmationDate: string;         // 必填：确认日期 YYYY-MM-DD
  channel: string;                  // 必填：确认渠道（email/phone/wechat/...；客户不登录系统，业务员登记）
  note?: string;                    // 客户意见
  evidence?: any[];                 // 证据（邮件/聊天记录截图等）
}

// ────────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────────

export function createFabricShipmentSampleService(opts: { prisma: PrismaClient; exceptionChecker?: ExceptionChecker }) {
  const { prisma, exceptionChecker } = opts;

  /** S/S 船样登记（DR-011：面料订单必须管理；允许同订单多批次） */
  async function registerShipmentSample(params: {
    orderId: string;
    input: RegisterShipmentSampleInput;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ sample: any }>> {
    const { orderId, input, actorId, ip } = params;
    if (!input || typeof input !== 'object') return fail('INVALID_INPUT', '请求体必填');
    if (!(Number(input.sampleQuantity) > 0)) return fail('INVALID_INPUT', 'sampleQuantity（取样长度）必填且必须大于 0');
    if (!isYmd(input.cuttingDate)) return fail('INVALID_INPUT', 'cuttingDate（取样日期）必填，格式 YYYY-MM-DD');

    const orderR = await resolveFabricOrder(prisma, orderId);
    if (!orderR.ok) return orderR;

    try {
      const created = await (prisma as any).$transaction(async (tx: any) => {
        const sample = await tx.fabricShipmentSample.create({
          data: {
            id: shortId('FSS'),
            sampleCode: await nextSampleCode(tx, 'SS'),
            shipmentId: input.shipmentId ?? '',
            orderId,
            fabricProfileId: input.fabricProfileId ?? null,
            sampleQuantity: input.sampleQuantity,
            sampleUnit: input.sampleUnit ?? 'meter',
            batchNo: input.batchNo ?? null,
            rollNos: input.rollNos ?? [],
            cuttingDate: input.cuttingDate,
            customerStatus: 'pending',
            notes: input.notes ?? null,
            attachments: { sampleKind: 'SS' },
          },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:fabric',
          operation: 'create_shipment_sample',
          targetType: 'FabricShipmentSample',
          targetId: sample.id,
          after: { id: sample.id, sampleCode: sample.sampleCode, orderId, sampleKind: 'SS' },
          ip: ip ?? null,
        });
        return sample;
      });
      logger.info('[Samples] S/S 船样已登记', { sampleId: created.id, orderId, actorId });
      return ok({ sample: created });
    } catch (e: any) {
      if (e?.code === 'P2002') return fail('DUPLICATE_CODE', '样品业务号冲突，请重试', 409);
      return fail('CREATE_FAILED', `S/S 船样登记失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /**
   * RC 匹头样启用 + 登记（DR-011：按订单条件启用，业务员决定并留痕；
   * Separates/常年翻单仅为常见参考场景，系统不做自动判定或硬性必填）
   */
  async function enableHeadSample(params: {
    orderId: string;
    input: EnableHeadSampleInput;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ sample: any }>> {
    const { orderId, input, actorId, ip } = params;
    if (!input || typeof input !== 'object') return fail('INVALID_INPUT', '请求体必填');
    if (!input.enabledReason || !String(input.enabledReason).trim()) {
      return fail('INVALID_INPUT', 'enabledReason（启用原因/依据）必填：RC 启用须留痕（DR-011）');
    }
    const hasOverride = input.deadlineOverrideDays !== undefined && input.deadlineOverrideDays !== null;
    if (hasOverride) {
      if (!(Number(input.deadlineOverrideDays) > 0)) return fail('INVALID_INPUT', 'deadlineOverrideDays 必须为正整数（天数）');
      if (!input.deadlineOverrideReason || !String(input.deadlineOverrideReason).trim()) {
        return fail('OVERRIDE_REASON_REQUIRED', '客户/合同明确时限覆盖默认值时，deadlineOverrideReason（覆盖原因）必填留痕（DR-011）');
      }
    }
    if (input.cuttingDate !== undefined && input.cuttingDate !== '' && !isYmd(input.cuttingDate)) {
      return fail('INVALID_INPUT', 'cuttingDate 格式须为 YYYY-MM-DD');
    }

    const orderR = await resolveFabricOrder(prisma, orderId);
    if (!orderR.ok) return orderR;

    const existing = await prisma.fabricShipmentSample.findMany({ where: { orderId, deletedAt: null } });
    if (existing.some((s: any) => sampleKindOf(s) === 'RC')) {
      return fail('RC_ALREADY_ENABLED', `订单 ${orderId} 已启用匹头样（RC），不可重复启用`, 409);
    }

    const now = Date.now();
    try {
      const created = await (prisma as any).$transaction(async (tx: any) => {
        const sample = await tx.fabricShipmentSample.create({
          data: {
            id: shortId('FRC'),
            sampleCode: await nextSampleCode(tx, 'RC'),
            shipmentId: '',
            orderId,
            fabricProfileId: input.fabricProfileId ?? null,
            sampleQuantity: input.sampleQuantity ?? 0,
            sampleUnit: 'meter',
            cuttingDate: input.cuttingDate ?? '',
            customerStatus: 'pending',
            notes: input.notes ?? null,
            attachments: {
              sampleKind: 'RC',
              rc: {
                enabledReason: String(input.enabledReason),
                enabledBy: actorId,
                enabledAt: now,
                ...(hasOverride
                  ? {
                      deadlineOverrideDays: Number(input.deadlineOverrideDays),
                      deadlineOverrideReason: String(input.deadlineOverrideReason),
                      deadlineOverrideBy: actorId,
                      deadlineOverrideAt: now,
                    }
                  : {}),
              },
            },
          },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:fabric',
          operation: 'enable_head_sample',
          targetType: 'FabricShipmentSample',
          targetId: sample.id,
          after: {
            id: sample.id,
            sampleCode: sample.sampleCode,
            orderId,
            sampleKind: 'RC',
            enabledReason: input.enabledReason,
            deadlineOverrideDays: hasOverride ? Number(input.deadlineOverrideDays) : null,
          },
          ip: ip ?? null,
        });
        return sample;
      });
      logger.info('[Samples] RC 匹头样已启用', { sampleId: created.id, orderId, actorId });
      return ok({ sample: created });
    } catch (e: any) {
      if (e?.code === 'P2002') return fail('DUPLICATE_CODE', '样品业务号冲突，请重试', 409);
      return fail('CREATE_FAILED', `RC 匹头样启用失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /** 样品寄送登记（DR-039：快递商/单号/日期/收件方 + 随附单据；S/S 与 RC 共用） */
  async function registerSampleShipment(params: {
    sampleId: string;
    input: RegisterSampleShipmentInput;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ sample: any }>> {
    const { sampleId, input, actorId, ip } = params;
    if (!input || typeof input !== 'object') return fail('INVALID_INPUT', '请求体必填');
    if (!input.courier || !String(input.courier).trim()) return fail('INVALID_INPUT', 'courier（快递服务商）必填（DR-039）');
    if (!input.trackingNumber || !String(input.trackingNumber).trim()) return fail('INVALID_INPUT', 'trackingNumber（快递单号）必填（DR-039）');
    if (!input.recipientName || !String(input.recipientName).trim()) return fail('INVALID_INPUT', 'recipientName（收件方）必填（DR-039）');
    if (input.sentDate !== undefined && input.sentDate !== '' && !isYmd(input.sentDate)) {
      return fail('INVALID_INPUT', 'sentDate 格式须为 YYYY-MM-DD');
    }

    const sample = await prisma.fabricShipmentSample.findFirst({ where: { id: sampleId, deletedAt: null } });
    if (!sample) return fail('NOT_FOUND', `样品 ${sampleId} 不存在`, 404);
    if (sample.customerStatus === 'approved') {
      return fail('ALREADY_CONFIRMED', '该样品客户已确认，不可重复寄送登记；如需重寄请登记新批次', 409);
    }

    const now = Date.now();
    const sentDate = input.sentDate || todayYmd();
    try {
      const updated = await (prisma as any).$transaction(async (tx: any) => {
        const attachments = mergeAttachments(sample.attachments, {
          shipmentDocuments: Array.isArray(input.documents) ? input.documents : (sample.attachments as any)?.shipmentDocuments ?? [],
          lastShipment: {
            sentDate,
            courier: String(input.courier),
            trackingNumber: String(input.trackingNumber),
            recipientName: String(input.recipientName),
            recipientContact: input.recipientContact ?? null,
            shippedBy: actorId,
            shippedAt: now,
          },
        });
        const row = await tx.fabricShipmentSample.update({
          where: { id: sample.id },
          data: {
            sentToCustomer: true,
            sentDate,
            courier: String(input.courier),
            trackingNumber: String(input.trackingNumber),
            recipientName: String(input.recipientName),
            recipientContact: input.recipientContact ?? null,
            // 重寄（needs_revision/rejected 后再寄）→ 回到待客户确认
            customerStatus: 'pending',
            ...(input.sampleQuantity !== undefined ? { sampleQuantity: input.sampleQuantity } : {}),
            ...(input.cuttingDate !== undefined && input.cuttingDate !== '' ? { cuttingDate: input.cuttingDate } : {}),
            ...(input.batchNo !== undefined ? { batchNo: input.batchNo } : {}),
            ...(input.rollNos !== undefined ? { rollNos: input.rollNos } : {}),
            attachments,
          },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:fabric',
          operation: 'ship_sample',
          targetType: 'FabricShipmentSample',
          targetId: sample.id,
          before: { sentToCustomer: sample.sentToCustomer, sentDate: sample.sentDate },
          after: { sentToCustomer: true, sentDate, courier: input.courier, trackingNumber: input.trackingNumber, recipientName: input.recipientName },
          ip: ip ?? null,
        });
        return row;
      });
      return ok({ sample: updated });
    } catch (e: any) {
      return fail('UPDATE_FAILED', `寄送登记失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /**
   * 客户确认登记（DR-011/DR-012：客户不登录系统，业务员登记确认结果/日期/渠道/意见/证据；
   * 系统保留操作者与时间，确认链可审计）
   */
  async function registerCustomerConfirmation(params: {
    sampleId: string;
    input: RegisterSampleConfirmationInput;
    actorId: string;
    ip?: string | null;
  }): Promise<Result<{ sample: any }>> {
    const { sampleId, input, actorId, ip } = params;
    if (!input || typeof input !== 'object') return fail('INVALID_INPUT', '请求体必填');
    if (!['approved', 'rejected', 'needs_revision'].includes(String(input.result))) {
      return fail('INVALID_INPUT', 'result 必须是 approved | rejected | needs_revision');
    }
    if (!isYmd(input.confirmationDate)) return fail('INVALID_INPUT', 'confirmationDate（确认日期）必填，格式 YYYY-MM-DD');
    if (!input.channel || !String(input.channel).trim()) return fail('INVALID_INPUT', 'channel（确认渠道）必填：客户不登录系统，须登记确认渠道（DR-012）');

    const sample = await prisma.fabricShipmentSample.findFirst({ where: { id: sampleId, deletedAt: null } });
    if (!sample) return fail('NOT_FOUND', `样品 ${sampleId} 不存在`, 404);
    if (!sample.sentToCustomer) {
      return fail('SAMPLE_NOT_SENT', '样品尚未寄送，须先完成寄送登记再登记客户确认（DR-012 确认链）', 409);
    }

    const now = Date.now();
    const prevConfirmations = Array.isArray((sample.attachments as any)?.confirmations) ? (sample.attachments as any).confirmations : [];
    try {
      const updated = await (prisma as any).$transaction(async (tx: any) => {
        const attachments = mergeAttachments(sample.attachments, {
          confirmationChannel: String(input.channel),
          confirmationEvidence: Array.isArray(input.evidence) ? input.evidence : [],
          confirmedBy: actorId,
          confirmedAt: now,
          confirmations: [
            ...prevConfirmations,
            {
              result: input.result,
              date: input.confirmationDate,
              channel: String(input.channel),
              note: input.note ?? null,
              evidence: Array.isArray(input.evidence) ? input.evidence : [],
              registeredBy: actorId,
              registeredAt: now,
            },
          ],
        });
        const row = await tx.fabricShipmentSample.update({
          where: { id: sample.id },
          data: {
            customerStatus: input.result,
            customerFeedbackDate: input.confirmationDate,
            customerFeedbackNote: input.note ?? null,
            attachments,
          },
        });
        await writeRouteAuditLog({
          prisma: tx,
          actorId: actorId || 'api',
          source: 'route:samples:fabric',
          operation: 'confirm_sample',
          targetType: 'FabricShipmentSample',
          targetId: sample.id,
          before: { customerStatus: sample.customerStatus },
          after: { customerStatus: input.result, confirmationDate: input.confirmationDate, channel: input.channel },
          ip: ip ?? null,
        });
        return row;
      });
      logger.info('[Samples] 样品客户确认已登记', { sampleId, result: input.result, actorId });
      return ok({ sample: updated });
    } catch (e: any) {
      return fail('UPDATE_FAILED', `客户确认登记失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  /** 订单样品列表（含 Exmill 倒计时与逾期标记） */
  async function listOrderSamples(params: { orderId: string }): Promise<Result<{ items: any[] }>> {
    const order = await prisma.order.findFirst({ where: { id: params.orderId, deletedAt: null } });
    if (!order) return fail('NOT_FOUND', `订单 ${params.orderId} 不存在`, 404);
    const samples = await prisma.fabricShipmentSample.findMany({
      where: { orderId: params.orderId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const items = samples.map((s: any) => ({ ...s, sampleKind: sampleKindOf(s), countdown: computeSampleCountdown(s, order) }));
    return ok({ items });
  }

  /**
   * DR-012 样品链发货资格判定（只输出判定，实际出运门禁由出运域消费）：
   *   - S/S 寄出后未登记客户确认 → 不具备正常发货条件；
   *   - 启用 RC 的订单须额外完成 RC 客户确认（DR-014 并行条件）；
   *   - 面料大货 QC 条件不在本判定内（QC/出运域独立评估）。
   * DR-013 接入点：本判定不含任何例外放行；出运域叠加已批准例外单后自行放行。
   */
  async function computeShipmentEligibility(params: { orderId: string }): Promise<Result<{ eligibility: any }>> {
    const { orderId } = params;
    const order = await prisma.order.findFirst({ where: { id: orderId, deletedAt: null } });
    if (!order) return fail('NOT_FOUND', `订单 ${orderId} 不存在`, 404);

    const samples = await prisma.fabricShipmentSample.findMany({ where: { orderId, deletedAt: null } });
    const ssList = samples.filter((s: any) => sampleKindOf(s) === 'SS');
    const rcList = samples.filter((s: any) => sampleKindOf(s) === 'RC');

    const ssConfirmed = ssList.some((s: any) => s.customerStatus === 'approved');
    const ssAnySent = ssList.some((s: any) => s.sentToCustomer);
    const ssLatest = ssList.length
      ? ssList.reduce((a: any, b: any) => (String(a.sentDate ?? '') >= String(b.sentDate ?? '') ? a : b))
      : null;

    const rcEnabled = rcList.length > 0;
    const rcConfirmed = rcList.some((s: any) => s.customerStatus === 'approved');
    const rcAnySent = rcList.some((s: any) => s.sentToCustomer);
    const rcLatest = rcList.length
      ? rcList.reduce((a: any, b: any) => (String(a.sentDate ?? '') >= String(b.sentDate ?? '') ? a : b))
      : null;

    const blockingReasons: ShipmentGateBlocker[] = [];
    if (ssList.length === 0) {
      blockingReasons.push('SS_NOT_REGISTERED');
    } else if (!ssConfirmed) {
      if (!ssAnySent) blockingReasons.push('SS_NOT_SENT');
      else if (ssLatest?.customerStatus === 'rejected') blockingReasons.push('SS_REJECTED');
      else blockingReasons.push('SS_NOT_CONFIRMED');
    }
    if (rcEnabled && !rcConfirmed) {
      blockingReasons.push(rcAnySent ? 'RC_NOT_CONFIRMED' : 'RC_NOT_SENT');
    }

    const eligible = ssConfirmed && (!rcEnabled || rcConfirmed);
    return ok({
      eligibility: {
        orderId,
        exmillDate: order.clientDate ?? null,
        evaluatedAt: todayYmd(),
        eligibleForNormalShipment: eligible,
        blockingReasons,
        gates: {
          ss: {
            required: true,
            total: ssList.length,
            satisfied: ssConfirmed,
            anySent: ssAnySent,
            latestSampleId: ssLatest?.id ?? null,
            countdown: ssLatest ? computeSampleCountdown(ssLatest, order) : null,
          },
          rc: {
            enabled: rcEnabled,
            satisfied: rcEnabled ? rcConfirmed : true,
            anySent: rcAnySent,
            latestSampleId: rcLatest?.id ?? null,
            countdown: rcLatest ? computeSampleCountdown(rcLatest, order) : null,
          },
        },
        // DR-013 例外叠加消费点：出运域调用 assertFabricShipmentGate（本判定下方），
        // 由 exceptionGate SDK 统一完成「阻断 → 查例外 → 放行或 GATE_BLOCKED」；
        // 本判定始终输出原始门禁状态（DR-013：例外不改变原规则）。
        exceptionHook: 'DR-013 controlled exception is applied via assertFabricShipmentGate by the shipping domain; 本判定不含例外放行',
      },
    });
  }

  /**
   * DR-013 例外门禁消费点（出运域在放行动作前调用）：
   *   1. 先做样品链原始资格判定（computeShipmentEligibility，不感知例外）；
   *   2. 不具备资格 → assertGateOrThrow 查「本订单 + shipment:release」生效例外：
   *      - 例外精确命中 → passedVia='exception'（携带例外摘要，供「DR-013 例外放行」徽标展示）；
   *      - 无生效例外 → GATE_BLOCKED 409（blockingReasons + exceptionEntryHint 引导申请入口）；
   *   3. 具备资格 → passedVia='gate'，不触碰例外（一次性例外不被无意核销）；
   *   4. 未注入 exceptionChecker → 不具备资格一律 GATE_BLOCKED（fail-closed，无隐藏旁路）。
   *
   * 例外 scope 精确绑定：targetType='Order' + targetId=orderId + action='shipment:release'
   * （订单级样品链门禁锚定订单；EXC 创建时 scope 必须与此精确一致，绝不泛化到整类对象）。
   */
  async function assertFabricShipmentGate(params: { orderId: string; at?: Date }): Promise<FabricShipmentGateResult> {
    const r = await computeShipmentEligibility({ orderId: params.orderId });
    if (!r.ok) return r;
    const { eligibility } = r.data;
    const checkOrderRelease = exceptionChecker
      ? bindExceptionChecker(exceptionChecker, { targetType: 'Order', action: 'shipment:release' })
      : null;
    try {
      const pass = await assertGateOrThrow(
        {
          eligible: eligibility.eligibleForNormalShipment,
          gate: 'shipment_release',
          blockingReasons: eligibility.blockingReasons,
        },
        checkOrderRelease
          ? () => checkOrderRelease(params.orderId, params.at)
          : { active: false, reason: 'NO_ACTIVE_EXCEPTION' },
      );
      return { ok: true, data: { eligibility, pass } };
    } catch (e) {
      if (e instanceof GateBlockedError) {
        return {
          ok: false,
          error: {
            code: GATE_BLOCKED,
            message: e.message,
            status: e.statusCode,
            blockingReasons: e.blockingReasons,
            exceptionReason: e.exceptionReason,
            exceptionEntryHint: e.exceptionEntryHint,
          },
        };
      }
      throw e;
    }
  }

  return {
    registerShipmentSample,
    enableHeadSample,
    registerSampleShipment,
    registerCustomerConfirmation,
    listOrderSamples,
    computeShipmentEligibility,
    assertFabricShipmentGate,
  };
}

export type FabricShipmentSampleService = ReturnType<typeof createFabricShipmentSampleService>;
