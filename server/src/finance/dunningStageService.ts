/**
 * dunningStageService.ts — P0-2 催款分级状态机（提醒→催款→严催→法务准备）
 *
 * 设计真源：docs/design/10-评审与决策/2026-08-25-中度与严重缺失功能开发优先级规划.md P0-2
 * schema 真源：schema.prisma model DunningProfile（含设计决策注释）
 *
 * 分级状态机（双来源合成）：
 *   auto   = 账龄五桶自动定级（d90plus→legal / d61_90→urgent / d31_60→firm / d1_30→reminder）
 *   manual = 人工钉住（升级=提前严催；降级=客户已承诺还款，留痕走 routeAudit）
 *   合成规则：manual 钉住期间，账龄自动定级只能向上穿透（aging 证据压过人工降级），
 *   避免「账已烂到 90+ 但仍停在提醒档」的失真；还款结清后 auto 回落 none。
 *
 * P0-1 尾款喂入：末批 finalPaymentDueDate 逾期未结清 → 自动保底 reminder 档
 * （扫描 OrderShipmentBatch，与账龄行同状态机收口；尾款未开票时生成合成看板行）。
 *
 * 职责边界：
 *   - 本服务：分级主档（DunningProfile）读写 + 分级看板（账龄行×当前分级）+ 人工升降级留痕；
 *   - dunningService：催款函生成（stage 参数选档模板）+ 催款记录登记（stage 快照）；
 *   - dunningStageWatchdog：每日扫描自动升级 + 风险预警通知（调度侧，调本服务 scanAndSync）。
 */
import { PrismaClient } from '@prisma/client';
import { getAgingReport } from './reportService';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { logger } from '../lib/logger';

// ────────────────────────────────────────────────────────────────────
// 常量与纯函数（watchdog / 看板 / 函生成共用）
// ────────────────────────────────────────────────────────────────────

export const DUNNING_STAGES = ['none', 'reminder', 'firm', 'urgent', 'legal'] as const;
export type DunningStage = (typeof DUNNING_STAGES)[number];

export const STAGE_RANK: Record<DunningStage, number> = { none: 0, reminder: 1, firm: 2, urgent: 3, legal: 4 };

export const STAGE_LABELS_ZH: Record<DunningStage, string> = {
  none: '未分级', reminder: '提醒', firm: '催款', urgent: '严催', legal: '法务准备',
};
export const STAGE_LABELS_EN: Record<DunningStage, string> = {
  none: 'None', reminder: 'Reminder', firm: 'Firm', urgent: 'Urgent', legal: 'Legal Prep',
};

/** 各级对应账龄档位（业务口径：提醒 d1-30 / 催款 d31-60 / 严催 d61-90 / 法务准备 d90+） */
export const STAGE_AGING_DESC: Record<DunningStage, string> = {
  none: '—', reminder: '逾期 1-30 天', firm: '逾期 31-60 天', urgent: '逾期 61-90 天', legal: '逾期 90 天以上',
};

export type DunningStageResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } };

const fail = (code: string, message: string, status = 400): DunningStageResult<never> =>
  ({ ok: false, error: { code, message, status } });

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 账龄行锚点：与 getAgingReport row key 同构（rel:{relationId} 或 name:{customerName} + 币种） */
export function scopeKeyOf(customerRelationId: string | null | undefined, customerName: string, currency: string): string {
  const cust = customerRelationId ? `rel:${customerRelationId}` : `name:${customerName}`;
  return `${cust}:${currency}`;
}

/** 账龄五桶 → 自动分级（d90plus>0→legal / d61_90>0→urgent / d31_60>0→firm / d1_30>0→reminder） */
export function stageOfBuckets(buckets: { d1_30?: number; d31_60?: number; d61_90?: number; d90plus?: number }): DunningStage {
  const eps = 0.005; // 与账龄行过滤同容差
  if ((buckets.d90plus ?? 0) > eps) return 'legal';
  if ((buckets.d61_90 ?? 0) > eps) return 'urgent';
  if ((buckets.d31_60 ?? 0) > eps) return 'firm';
  if ((buckets.d1_30 ?? 0) > eps) return 'reminder';
  return 'none';
}

/** 双来源合成：manual 钉住期间，auto 只能向上穿透（aging 证据压过人工降级） */
export function resolveEffectiveStage(
  profile: { stage: string; stageSource: string } | null | undefined,
  autoStage: DunningStage,
): { stage: DunningStage; stageSource: 'auto' | 'manual' } {
  if (!profile) return { stage: autoStage, stageSource: 'auto' };
  if (profile.stageSource === 'manual') {
    const pinned = (DUNNING_STAGES as readonly string[]).includes(profile.stage) ? profile.stage as DunningStage : 'none';
    return STAGE_RANK[autoStage] > STAGE_RANK[pinned]
      ? { stage: autoStage, stageSource: 'auto' }
      : { stage: pinned, stageSource: 'manual' };
  }
  return { stage: autoStage, stageSource: 'auto' };
}

// ────────────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────────────

export function createDunningStageService(prisma: PrismaClient) {
  const db = prisma as any;

  /** P0-1 尾款喂入：逾期未结清末批（shipped + 非 settled + 到期日已过）→ 客户×币种逾期尾款合计 */
  async function loadOverdueFinalPayments(asOf: string): Promise<Array<{
    customerRelationId: string | null; customerName: string | null; currency: string;
    outstanding: number; batchCount: number;
  }>> {
    const asOfMs = new Date(asOf + 'T00:00:00Z').getTime();
    const batches = await db.orderShipmentBatch.findMany({
      where: {
        isFinalBatch: true,
        status: 'shipped',
        settleStatus: { not: 'settled' },
        finalPaymentDueDate: { not: null },
        deletedAt: null,
      },
      select: { customerRelationId: true, customerName: true, currency: true, amount: true, paidAmount: true, finalPaymentDueDate: true },
    });
    const byScope = new Map<string, { customerRelationId: string | null; customerName: string | null; currency: string; outstanding: number; batchCount: number }>();
    for (const b of batches) {
      const dueMs = b.finalPaymentDueDate ? new Date(String(b.finalPaymentDueDate) + 'T00:00:00Z').getTime() : null;
      if (dueMs == null || dueMs >= asOfMs) continue; // 未到期
      const key = scopeKeyOf(b.customerRelationId, b.customerName ?? '', b.currency);
      const outstanding = Math.max(0, Number(b.amount ?? 0) - Number(b.paidAmount ?? 0));
      const cur = byScope.get(key) ?? {
        customerRelationId: b.customerRelationId ?? null,
        customerName: b.customerName ?? null,
        currency: b.currency,
        outstanding: 0,
        batchCount: 0,
      };
      cur.outstanding += outstanding;
      cur.batchCount += 1;
      byScope.set(key, cur);
    }
    return [...byScope.values()];
  }

  /**
   * 分级看板（只读）：账龄应收行 × P0-1 尾款喂入 × DunningProfile 当前态 → 生效分级。
   * 不落库（写路径归 watchdog scanAndSync / setStageManual），保证 GET 零副作用。
   */
  async function listBoard(params?: { asOf?: string }): Promise<DunningStageResult<any>> {
    try {
      const asOf = params?.asOf ?? new Date().toISOString().slice(0, 10);
      const aging = await getAgingReport(prisma, { type: 'Receivable', asOf });
      const overdueFinals = await loadOverdueFinalPayments(asOf);
      const profiles = await db.dunningProfile.findMany({});
      const profileByKey = new Map<string, any>(profiles.map((p: any) => [p.scopeKey, p]));

      // P0-1 尾款喂入：账龄行匹配（relationId 或客户名 + 币种）→ 保底 reminder；
      // 未匹配到账龄行（尾款未开票）→ 合成看板行（债务真实存在，不能从看板消失）。
      const rows: any[] = [];
      const matchedFinalKeys = new Set<string>();
      const finalByKey = new Map<string, any>();
      for (const f of overdueFinals) {
        finalByKey.set(scopeKeyOf(f.customerRelationId, f.customerName ?? '', f.currency), f);
      }

      for (const row of aging.rows) {
        const scopeKey = scopeKeyOf(row.customerRelationId, row.customerName, row.currency);
        const autoFromAging = stageOfBuckets(row.buckets);
        const final = finalByKey.get(scopeKey);
        if (final) {
          matchedFinalKeys.add(scopeKey);
          final.customerName = final.customerName || row.customerName; // 合成行兜底客户名
        }
        // 尾款逾期保底 reminder（aging 可能尚无逾期发票——尾款未开票场景）
        const autoStage: DunningStage = final ? (STAGE_RANK[autoFromAging] >= STAGE_RANK.reminder ? autoFromAging : 'reminder') : autoFromAging;
        const profile = profileByKey.get(scopeKey);
        const effective = resolveEffectiveStage(profile, autoStage);
        const totalOverdue = Math.round(((row.buckets.total - row.buckets.current) + (final ? 0 : 0)) * 100) / 100;
        rows.push({
          scopeKey,
          customerRelationId: row.customerRelationId ?? null,
          customerName: row.customerName,
          currency: row.currency,
          invoiceCount: row.invoiceCount,
          buckets: row.buckets,
          totalOverdue,
          finalPaymentOverdue: !!final,
          finalPaymentOutstanding: final ? Math.round(final.outstanding * 100) / 100 : 0,
          autoStage,
          stage: effective.stage,
          stageSource: effective.stageSource,
          stageSince: profile?.stageSince ?? null,
          escalatedAt: profile?.escalatedAt ?? null,
          downgradedAt: profile?.downgradedAt ?? null,
          ownerName: profile?.ownerName ?? null,
        });
      }

      // 尾款逾期但无账龄行（未开票）→ 合成行（autoStage=reminder 保底）
      for (const [key, f] of finalByKey) {
        if (matchedFinalKeys.has(key)) continue;
        const profile = profileByKey.get(key);
        const effective = resolveEffectiveStage(profile, 'reminder');
        rows.push({
          scopeKey: key,
          customerRelationId: f.customerRelationId,
          customerName: f.customerName ?? '未知客户',
          currency: f.currency,
          invoiceCount: 0,
          buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 },
          totalOverdue: 0,
          finalPaymentOverdue: true,
          finalPaymentOutstanding: Math.round(f.outstanding * 100) / 100,
          autoStage: 'reminder' as DunningStage,
          stage: effective.stage,
          stageSource: effective.stageSource,
          stageSince: profile?.stageSince ?? null,
          escalatedAt: profile?.escalatedAt ?? null,
          downgradedAt: profile?.downgradedAt ?? null,
          ownerName: profile?.ownerName ?? null,
        });
      }

      // 汇总：按生效分级归列（金额口径 = 逾期账款 + 逾期尾款）
      const summary: Record<string, { count: number; amount: number }> = {
        none: { count: 0, amount: 0 }, reminder: { count: 0, amount: 0 },
        firm: { count: 0, amount: 0 }, urgent: { count: 0, amount: 0 }, legal: { count: 0, amount: 0 },
      };
      for (const r of rows) {
        const bucket = summary[r.stage] ?? summary.none;
        bucket.count += 1;
        bucket.amount += Math.round((r.totalOverdue + (r.finalPaymentOutstanding ?? 0)) * 100) / 100;
      }
      for (const k of Object.keys(summary)) summary[k].amount = Math.round(summary[k].amount * 100) / 100;

      // 分级停驻时长看板化（当前分级已停留天数，升级计时锚点）
      const nowMs = Date.now();
      const withDays = rows.map((r: any) => ({
        ...r,
        stageDays: r.stageSince ? Math.max(0, Math.floor((nowMs - Number(r.stageSince)) / MS_PER_DAY)) : null,
      }));

      return { ok: true, data: { asOf, rows: withDays, summary } };
    } catch (e: any) {
      logger.error('[DunningStage] board failed', { error: e?.message });
      return fail('BOARD_FAILED', e?.message || '分级看板生成失败', 500);
    }
  }

  /**
   * 人工升降级（留痕）：stage=none 表示解除人工钉住（回到账龄自动定级）。
   * 钉住期间 auto 升级穿透规则见 resolveEffectiveStage（本方法只写当前请求的钉住值）。
   */
  async function setStageManual(input: {
    customerRelationId?: string | null;
    customerName: string;
    currency: string;
    stage: string;
    reason?: string;
    ownerName?: string | null;
    actorId?: string;
  }): Promise<DunningStageResult<any>> {
    try {
      const customerName = String(input.customerName ?? '').trim();
      if (!customerName) return fail('CUSTOMER_NAME_REQUIRED', 'customerName 必填');
      const currency = String(input.currency ?? '').trim().toUpperCase();
      if (!currency) return fail('CURRENCY_REQUIRED', 'currency 必填');
      const stage = String(input.stage ?? '').trim();
      if (!(DUNNING_STAGES as readonly string[]).includes(stage)) {
        return fail('INVALID_STAGE', `stage 须为 ${DUNNING_STAGES.join(' | ')}`);
      }
      const reason = String(input.reason ?? '').trim();
      if (stage !== 'none' && !reason) {
        return fail('REASON_REQUIRED', '升降级必须填写原因（留痕：审计日志 detail.reason）');
      }

      const scopeKey = scopeKeyOf(input.customerRelationId ?? null, customerName, currency);
      const existing = await db.dunningProfile.findUnique({ where: { scopeKey } });
      // 解除钉住 / 未钉住时：生效分级回退到账龄自动定级（与看板同口径现场计算）
      const autoStage = stage === 'none' || !existing || existing.stageSource !== 'manual'
        ? await autoStageOfScope(input.customerRelationId ?? null, customerName, currency)
        : (existing.stage as DunningStage);

      const ts = BigInt(Date.now());
      const before = existing ? { stage: existing.stage, stageSource: existing.stageSource } : null;
      const nextStage = stage === 'none' ? autoStage : (stage as DunningStage);
      const nextSource = stage === 'none' ? 'auto' : 'manual';
      const rankChange = STAGE_RANK[nextStage] - STAGE_RANK[(existing?.stage as DunningStage) ?? 'none'];

      const data = {
        scopeKey,
        customerRelationId: input.customerRelationId ?? null,
        customerName,
        currency,
        stage: nextStage,
        stageSource: nextSource,
        stageSince: ts,
        autoStage: existing?.autoStage ?? nextStage,
        escalatedAt: rankChange > 0 ? ts : (existing?.escalatedAt ?? null),
        downgradedAt: rankChange < 0 ? ts : (existing?.downgradedAt ?? null),
        ownerName: input.ownerName != null ? (String(input.ownerName).trim() || null) : (existing?.ownerName ?? null),
        updatedAt: ts,
      };

      const profile = existing
        ? await db.dunningProfile.update({ where: { scopeKey }, data })
        : await db.dunningProfile.create({
            data: { id: `DNP__${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`, ...data, createdAt: ts, stageSince: ts },
          });

      await writeRouteAuditLog({
        prisma,
        actorId: input.actorId || 'api',
        source: 'route:finance:dunning-stage:manual',
        operation: 'set_dunning_stage',
        targetType: 'DunningProfile',
        targetId: profile.id,
        before,
        after: { stage: nextStage, stageSource: nextSource, reason: reason || null, requestedStage: stage },
        ip: null,
      });
      logger.info('[DunningStage] manual set', { scopeKey, requested: stage, effective: nextStage, source: nextSource });
      return { ok: true, data: { profile } };
    } catch (e: any) {
      logger.error('[DunningStage] manual set failed', { error: e?.message });
      return fail('SET_STAGE_FAILED', e?.message || '升降级失败', 500);
    }
  }

  /** 现场计算某账龄行的自动分级（含 P0-1 尾款保底；解除钉住时生效分级回退用） */
  async function autoStageOfScope(customerRelationId: string | null, customerName: string, currency: string): Promise<DunningStage> {
    const asOf = new Date().toISOString().slice(0, 10);
    const aging = await getAgingReport(prisma, { type: 'Receivable', asOf });
    const row = aging.rows.find((r: any) =>
      r.currency === currency
      && (customerRelationId ? r.customerRelationId === customerRelationId : (!r.customerRelationId && r.customerName === customerName)));
    const fromAging = row ? stageOfBuckets(row.buckets) : 'none';
    const finals = await loadOverdueFinalPayments(asOf);
    const hasFinal = finals.some((f: any) => scopeKeyOf(f.customerRelationId, f.customerName ?? '', f.currency) === scopeKeyOf(customerRelationId, customerName, currency));
    return hasFinal && STAGE_RANK[fromAging] < STAGE_RANK.reminder ? 'reminder' : fromAging;
  }

  /**
   * watchdog 扫描并同步主档：账龄 + 尾款 → autoStage/生效分级回写 DunningProfile。
   * 与 listBoard 同口径计算，区别在本方法落库（升级轨迹/停驻时长持久化）。
   * 返回 { scanned, escalated }（escalated = 本次生效分级发生升级行数）。
   */
  async function scanAndSync(asOf?: string): Promise<{ scanned: number; escalated: number; rows: any[] }> {
    const board = await listBoard({ asOf });
    if (!board.ok) throw new Error((board as any).error.message);
    const ts = BigInt(Date.now());
    let escalated = 0;
    const changes: any[] = [];
    for (const row of board.data.rows as any[]) {
      const existing = await db.dunningProfile.findUnique({ where: { scopeKey: row.scopeKey } });
      const effective = resolveEffectiveStage(existing, row.autoStage);
      const rankChange = STAGE_RANK[effective.stage] - STAGE_RANK[(existing?.stage as DunningStage) ?? 'none'];
      const data = {
        scopeKey: row.scopeKey,
        customerRelationId: row.customerRelationId,
        customerName: row.customerName,
        currency: row.currency,
        stage: effective.stage,
        stageSource: effective.stageSource,
        stageSince: rankChange !== 0 ? ts : (existing?.stageSince ?? ts),
        autoStage: row.autoStage,
        escalatedAt: rankChange > 0 ? ts : (existing?.escalatedAt ?? null),
        downgradedAt: rankChange < 0 ? ts : (existing?.downgradedAt ?? null),
        lastScanAt: ts,
        updatedAt: ts,
      };
      if (existing) {
        await db.dunningProfile.update({ where: { scopeKey: row.scopeKey }, data: { ...data, ownerName: existing.ownerName ?? null } });
      } else {
        await db.dunningProfile.create({
          data: { id: `DNP__${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`, ...data, ownerName: null, createdAt: ts, stageSince: ts },
        });
      }
      if (rankChange > 0) {
        escalated += 1;
        changes.push({ scopeKey: row.scopeKey, customerName: row.customerName, currency: row.currency, from: existing?.stage ?? 'none', to: effective.stage, totalOverdue: row.totalOverdue, finalPaymentOutstanding: row.finalPaymentOutstanding ?? 0, ownerName: existing?.ownerName ?? null });
      }
    }
    return { scanned: board.data.rows.length, escalated, rows: changes };
  }

  return { listBoard, setStageManual, scanAndSync, loadOverdueFinalPayments };
}
