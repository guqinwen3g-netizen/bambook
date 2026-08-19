/**
 * H1a 供应商管理服务 — Supplier / Factory Management（PRD 13 / 19.18）
 *
 * 职责：
 *   1. 工厂档案（FactoryProfile）：1:1 挂 Relation（category=Supplier 的组织），
 *      承载产能/专长/银行/黑名单等工厂属性；身份真源始终在 Relation。
 *   2. 评估记录（FactoryEvaluation）：验货/交货评分明细 append-only 真源；
 *      追加后同事务重算 FactoryProfile.qualityScore / deliveryScore 缓存（禁止客户端直改）。
 *   3. 认证记录（FactoryCertification）：BSCI/SEDEX 等有效期管理 + 到期预警扫描。
 *   4. 产能日历（FactoryCapacity）：月计划产能 upsert；占用量不落地，
 *      由在手采购单（expectedDeliveryDate 落月）实时聚合。
 *
 * 设计原则（与 CRM 模块一致）：
 *   - 软删除（deletedAt BigInt），不物理删除
 *   - 事务内写入 + 评分重算（fail closed）
 *   - 事件发布失败不阻断业务（fire-and-forget）
 */

import { PrismaClient, FactoryProfile, FactoryEvaluation, FactoryCertification, FactoryCapacity } from '@prisma/client';
import { logger } from '../lib/logger';
import { publishBusinessEvent } from '../events/businessEventBus';
import crypto from 'crypto';

// ────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────

export interface FactoryProfileInput {
  relationId: string;
  monthlyCapacity?: number | null;
  capacityUnit?: string | null;
  equipmentList?: string | null;
  workerCount?: number | null;
  specialties?: string[];
  priceLevel?: string | null; // High | Mid | Low
  firstOrderAt?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankSwift?: string | null;
  notes?: string | null;
}

export type FactoryProfilePatch = Partial<Omit<FactoryProfileInput, 'relationId'>>;

export interface FactoryEvaluationInput {
  kind: string; // inspection（验货） | delivery（交期）
  score: number; // 0-100
  sourceType?: string | null; // inspectionReport | shipment | purchaseOrder | manual
  sourceId?: string | null;
  evaluatedAt: string; // YYYY-MM-DD
  note?: string | null;
}

export interface FactoryCertificationInput {
  type: string; // BSCI | SEDEX | WRAP | ISO9001 | ...
  certificateNo?: string | null;
  issuedAt?: string | null;
  validUntil?: string | null; // null = 长期有效
  attachmentPath?: string | null;
}

export interface FactoryCapacityInput {
  month: string; // YYYY-MM
  capacity: number;
  unit?: string | null;
  note?: string | null;
}

const EVALUATION_KINDS = ['inspection', 'delivery'] as const;
const PRICE_LEVELS = ['High', 'Mid', 'Low'] as const;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 采购单这些状态计入产能占用（在手单）
const OCCUPYING_PO_STATUSES = ['Sent', 'Confirmed', 'PartiallyReceived'];

function generateId(prefix: string): string {
  return `${prefix}__${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
}

function assertScore(score: number): void {
  if (typeof score !== 'number' || Number.isNaN(score) || score < 0 || score > 100) {
    throw new Error('评分必须在 0-100 之间');
  }
}

// ────────────────────────────────────────────────────────────────
// 自动评分口径（H1c）：纯函数，集中口径，供业务事件挂钩复用
// ────────────────────────────────────────────────────────────────

/** 交期评分：交期偏差天数（负数=提前）→ 分数；null（未约定交期）→ 100 不惩罚 */
export function deliveryScoreForDaysLate(daysLate: number | null): number {
  if (daysLate === null) return 100;
  if (daysLate <= 0) return 100;
  if (daysLate <= 7) return 80;
  if (daysLate <= 14) return 60;
  if (daysLate <= 30) return 40;
  return 20;
}

/** 验货评分：结论 + 致命疵点 → 分数（致命疵点一票否决） */
export function inspectionScoreForResult(result: string, criticalDefects: number): number {
  if (criticalDefects > 0 || result === 'fail') return 20;
  if (result === 'conditional') return 70;
  return 95; // pass
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createFactoryService(prisma: PrismaClient) {
  const db = prisma as any;
  const now = () => Date.now();

  // ══════════════════════════════════════════════════════════════
  // 1. 工厂档案 FactoryProfile
  // ══════════════════════════════════════════════════════════════

  /** 校验 Relation 是未删除的供应商组织（身份真源约束） */
  async function assertSupplierRelation(relationId: string): Promise<void> {
    const relation = await db.relation.findUnique({ where: { id: relationId } });
    if (!relation || relation.deletedAt !== null) {
      throw new Error('关联的 Relation 无效或已删除');
    }
    if (relation.category !== 'Supplier') {
      throw new Error('仅 category=Supplier 的 Relation 可建立工厂档案');
    }
    if (!relation.isOrganization) {
      throw new Error('工厂档案必须挂在组织（isOrganization=true）上');
    }
  }

  async function createProfile(input: FactoryProfileInput, actorId: string): Promise<FactoryProfile> {
    if (!input.relationId) throw new Error('relationId 必填');
    if (input.priceLevel && !(PRICE_LEVELS as readonly string[]).includes(input.priceLevel)) {
      throw new Error(`非法 priceLevel：${input.priceLevel}（允许 High | Mid | Low）`);
    }
    if (input.firstOrderAt && !DATE_RE.test(input.firstOrderAt)) {
      throw new Error('firstOrderAt 必须是 YYYY-MM-DD');
    }
    await assertSupplierRelation(input.relationId);

    const existing = await db.factoryProfile.findUnique({ where: { relationId: input.relationId } });
    if (existing && existing.deletedAt === null) {
      throw new Error('该供应商已存在工厂档案（1:1 约束），请使用更新接口');
    }

    const ts = now();
    const profile = await db.factoryProfile.create({
      data: {
        id: generateId('FACP'),
        relationId: input.relationId,
        monthlyCapacity: input.monthlyCapacity ?? null,
        capacityUnit: input.capacityUnit ?? null,
        equipmentList: input.equipmentList ?? null,
        workerCount: input.workerCount ?? null,
        specialties: input.specialties ?? [],
        priceLevel: input.priceLevel ?? null,
        firstOrderAt: input.firstOrderAt ?? null,
        bankName: input.bankName ?? null,
        bankAccount: input.bankAccount ?? null,
        bankSwift: input.bankSwift ?? null,
        notes: input.notes ?? null,
        qualityScore: 0,
        deliveryScore: 0,
        totalOrders: 0,
        totalAmount: 0,
        createdAt: BigInt(ts),
        updatedAt: BigInt(ts),
      },
    });
    logger.info('[FactoryService] profile created', { id: profile.id, relationId: input.relationId, actorId });
    return profile;
  }

  const PROFILE_PATCH_FIELDS = [
    'monthlyCapacity', 'capacityUnit', 'equipmentList', 'workerCount', 'specialties',
    'priceLevel', 'firstOrderAt', 'bankName', 'bankAccount', 'bankSwift', 'notes',
  ] as const;

  async function updateProfile(id: string, patch: FactoryProfilePatch, actorId: string): Promise<FactoryProfile> {
    const profile = await getProfileOrThrow(id);
    if (patch.priceLevel && !(PRICE_LEVELS as readonly string[]).includes(patch.priceLevel)) {
      throw new Error(`非法 priceLevel：${patch.priceLevel}（允许 High | Mid | Low）`);
    }
    if (patch.firstOrderAt && !DATE_RE.test(patch.firstOrderAt)) {
      throw new Error('firstOrderAt 必须是 YYYY-MM-DD');
    }
    const data: Record<string, unknown> = { updatedAt: BigInt(now()) };
    for (const f of PROFILE_PATCH_FIELDS) {
      if ((patch as any)[f] !== undefined) data[f] = (patch as any)[f];
    }
    const updated = await db.factoryProfile.update({ where: { id: profile.id }, data });
    logger.info('[FactoryService] profile updated', { id: profile.id, actorId, fields: Object.keys(patch) });
    return updated;
  }

  async function getProfileOrThrow(id: string): Promise<FactoryProfile> {
    const profile = await db.factoryProfile.findUnique({ where: { id } });
    if (!profile || profile.deletedAt !== null) throw new Error('工厂档案不存在');
    return profile;
  }

  async function getProfile(id: string) {
    const profile = await db.factoryProfile.findUnique({
      where: { id },
      include: { relation: true, certifications: { where: { deletedAt: null } } },
    });
    if (!profile || profile.deletedAt !== null) return null;
    return profile;
  }

  async function getProfileByRelation(relationId: string) {
    const profile = await db.factoryProfile.findUnique({ where: { relationId } });
    if (!profile || profile.deletedAt !== null) return null;
    return profile;
  }

  /** 列表/排名：sort = quality | delivery | orders | amount（默认 quality 降序） */
  async function listProfiles(query: {
    search?: string;
    blacklisted?: boolean;
    sort?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { deletedAt: null };
    if (query.blacklisted === true) where.blacklistedAt = { not: null };
    if (query.blacklisted === false) where.blacklistedAt = null;
    if (query.search) {
      where.relation = { name: { contains: query.search, mode: 'insensitive' } };
    }
    const orderBy: any =
      query.sort === 'delivery' ? { deliveryScore: 'desc' } :
      query.sort === 'orders' ? { totalOrders: 'desc' } :
      query.sort === 'amount' ? { totalAmount: 'desc' } :
      { qualityScore: 'desc' };
    const take = Math.min(query.limit || 50, 200);
    const skip = query.offset || 0;
    const [items, total] = await Promise.all([
      db.factoryProfile.findMany({ where, include: { relation: true }, orderBy, take, skip }),
      db.factoryProfile.count({ where }),
    ]);
    return { items, total };
  }

  async function deleteProfile(id: string, actorId: string): Promise<void> {
    const profile = await getProfileOrThrow(id);
    await db.factoryProfile.update({ where: { id: profile.id }, data: { deletedAt: BigInt(now()), updatedAt: BigInt(now()) } });
    logger.info('[FactoryService] profile soft-deleted', { id: profile.id, actorId });
  }

  // ─── 黑名单 ───

  async function setBlacklist(id: string, reason: string, actorId: string): Promise<FactoryProfile> {
    if (!reason?.trim()) throw new Error('拉黑原因必填');
    const profile = await getProfileOrThrow(id);
    const updated = await db.factoryProfile.update({
      where: { id: profile.id },
      data: { blacklistedAt: BigInt(now()), blacklistReason: reason.trim(), blacklistedById: actorId, updatedAt: BigInt(now()) },
    });
    logger.info('[FactoryService] blacklisted', { id: profile.id, actorId, reason });
    publishBusinessEvent({
      type: 'SupplierBlacklisted',
      sourceEntityType: 'FactoryProfile',
      sourceEntityId: profile.id,
      payload: { factoryId: profile.id, relationId: profile.relationId, reason: reason.trim() },
      actorId,
    }).catch((e: any) => logger.warn('[FactoryService] blacklist event publish failed', { error: e?.message }));
    return updated;
  }

  async function clearBlacklist(id: string, actorId: string): Promise<FactoryProfile> {
    const profile = await getProfileOrThrow(id);
    const updated = await db.factoryProfile.update({
      where: { id: profile.id },
      data: { blacklistedAt: null, blacklistReason: null, blacklistedById: null, updatedAt: BigInt(now()) },
    });
    logger.info('[FactoryService] blacklist cleared', { id: profile.id, actorId });
    return updated;
  }

  /** 采购侧选厂校验：被拉黑的工厂禁止新建采购单（供 procurement 服务调用） */
  async function assertNotBlacklisted(relationId: string): Promise<void> {
    const profile = await getProfileByRelation(relationId);
    if (profile && profile.blacklistedAt !== null) {
      throw new Error(`该供应商已被拉黑（原因：${profile.blacklistReason || '未填写'}），禁止新建采购单`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 2. 评估记录 FactoryEvaluation（append-only 真源 → 事务内重算缓存分）
  // ══════════════════════════════════════════════════════════════

  async function addEvaluation(factoryId: string, input: FactoryEvaluationInput, actorId: string): Promise<FactoryEvaluation> {
    if (!(EVALUATION_KINDS as readonly string[]).includes(input.kind)) {
      throw new Error(`非法评估类型：${input.kind}（允许 inspection | delivery）`);
    }
    assertScore(input.score);
    if (!DATE_RE.test(input.evaluatedAt)) throw new Error('evaluatedAt 必须是 YYYY-MM-DD');

    const ts = now();
    const evaluation: FactoryEvaluation = await db.$transaction(async (tx: any) => {
      const profile = await tx.factoryProfile.findUnique({ where: { id: factoryId } });
      if (!profile || profile.deletedAt !== null) throw new Error('工厂档案不存在');

      const created = await tx.factoryEvaluation.create({
        data: {
          id: generateId('FAEV'),
          factoryId,
          kind: input.kind,
          score: input.score,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          evaluatedAt: input.evaluatedAt,
          note: input.note ?? null,
          actorId,
          createdAt: BigInt(ts),
        },
      });

      // 同事务重算缓存分（真源在明细，均值为口径）
      const [inspectionRows, deliveryRows] = await Promise.all([
        tx.factoryEvaluation.findMany({ where: { factoryId, kind: 'inspection', deletedAt: null }, select: { score: true } }),
        tx.factoryEvaluation.findMany({ where: { factoryId, kind: 'delivery', deletedAt: null }, select: { score: true } }),
      ]);
      const avg = (rows: Array<{ score: number }>) => (rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0);
      await tx.factoryProfile.update({
        where: { id: factoryId },
        data: { qualityScore: avg(inspectionRows), deliveryScore: avg(deliveryRows), updatedAt: BigInt(ts) },
      });
      return created;
    });

    // 事务提交后发布事件（fire-and-forget，失败不阻断业务）
    logger.info('[FactoryService] evaluation appended + scores recalced', {
      factoryId, kind: input.kind, score: input.score, actorId,
    });
    publishBusinessEvent({
      type: 'FactoryEvaluationAdded',
      sourceEntityType: 'FactoryProfile',
      sourceEntityId: factoryId,
      payload: { factoryId, evaluationId: evaluation.id, kind: input.kind, score: input.score, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null },
      actorId,
    }).catch((e: any) => logger.warn('[FactoryService] evaluation event publish failed', { error: e?.message }));
    return evaluation;
  }

  async function listEvaluations(factoryId: string, kind?: string): Promise<FactoryEvaluation[]> {
    const where: any = { factoryId, deletedAt: null };
    if (kind) where.kind = kind;
    return db.factoryEvaluation.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  /**
   * 自动评分入口（H1c）：验货/交货业务事件 → 评估追加。
   * 幂等口径：同 (factoryId, kind, sourceType, sourceId) 只记一次，重复事件静默跳过。
   * 无工厂档案的 Relation 静默跳过（不是所有供应商都建了档案，不阻断主流程）。
   */
  async function recordAutoEvaluation(params: {
    relationId: string;
    kind: 'inspection' | 'delivery';
    score: number;
    sourceType: string;
    sourceId: string;
    evaluatedAt: string;
    note?: string;
    actorId: string;
  }): Promise<{ recorded: boolean; evaluationId?: string }> {
    const profile = await getProfileByRelation(params.relationId);
    if (!profile) return { recorded: false };
    const dup = await db.factoryEvaluation.findFirst({
      where: { factoryId: profile.id, kind: params.kind, sourceType: params.sourceType, sourceId: params.sourceId, deletedAt: null },
    });
    if (dup) return { recorded: false, evaluationId: dup.id };
    const evaluation = await addEvaluation(profile.id, {
      kind: params.kind,
      score: params.score,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      evaluatedAt: params.evaluatedAt,
      note: params.note ?? null,
    }, params.actorId);
    return { recorded: true, evaluationId: evaluation.id };
  }

  // ══════════════════════════════════════════════════════════════
  // 3. 认证记录 FactoryCertification（有效期预警扫描对象）
  // ══════════════════════════════════════════════════════════════

  async function addCertification(factoryId: string, input: FactoryCertificationInput, actorId: string): Promise<FactoryCertification> {
    if (!input.type?.trim()) throw new Error('认证类型必填');
    if (input.issuedAt && !DATE_RE.test(input.issuedAt)) throw new Error('issuedAt 必须是 YYYY-MM-DD');
    if (input.validUntil && !DATE_RE.test(input.validUntil)) throw new Error('validUntil 必须是 YYYY-MM-DD');
    await getProfileOrThrow(factoryId);
    const ts = now();
    const cert = await db.factoryCertification.create({
      data: {
        id: generateId('FACR'),
        factoryId,
        type: input.type.trim(),
        certificateNo: input.certificateNo ?? null,
        issuedAt: input.issuedAt ?? null,
        validUntil: input.validUntil ?? null,
        attachmentPath: input.attachmentPath ?? null,
        createdAt: BigInt(ts),
        updatedAt: BigInt(ts),
      },
    });
    logger.info('[FactoryService] certification added', { factoryId, type: input.type, actorId });
    return cert;
  }

  async function updateCertification(certId: string, patch: Partial<FactoryCertificationInput>, actorId: string): Promise<FactoryCertification> {
    const cert = await db.factoryCertification.findUnique({ where: { id: certId } });
    if (!cert || cert.deletedAt !== null) throw new Error('认证记录不存在');
    if (patch.issuedAt && !DATE_RE.test(patch.issuedAt)) throw new Error('issuedAt 必须是 YYYY-MM-DD');
    if (patch.validUntil && !DATE_RE.test(patch.validUntil)) throw new Error('validUntil 必须是 YYYY-MM-DD');
    const data: Record<string, unknown> = { updatedAt: BigInt(now()) };
    for (const f of ['type', 'certificateNo', 'issuedAt', 'validUntil', 'attachmentPath'] as const) {
      if (patch[f] !== undefined) data[f] = patch[f];
    }
    const updated = await db.factoryCertification.update({ where: { id: certId }, data });
    logger.info('[FactoryService] certification updated', { certId, actorId });
    return updated;
  }

  async function deleteCertification(certId: string, actorId: string): Promise<void> {
    const cert = await db.factoryCertification.findUnique({ where: { id: certId } });
    if (!cert || cert.deletedAt !== null) throw new Error('认证记录不存在');
    await db.factoryCertification.update({ where: { id: certId }, data: { deletedAt: BigInt(now()), updatedAt: BigInt(now()) } });
    logger.info('[FactoryService] certification soft-deleted', { certId, actorId });
  }

  async function listCertifications(factoryId: string): Promise<FactoryCertification[]> {
    return db.factoryCertification.findMany({
      where: { factoryId, deletedAt: null },
      orderBy: { validUntil: 'asc' },
    });
  }

  /** 到期预警：validUntil 在 [today, today+days] 区间内的认证（validUntil 为 null = 长期有效，不预警） */
  async function listExpiringCertifications(days: number): Promise<Array<FactoryCertification & { factory: FactoryProfile }>> {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const from = fmt(today);
    const to = fmt(new Date(today.getTime() + days * 86_400_000));
    return db.factoryCertification.findMany({
      where: { deletedAt: null, validUntil: { gte: from, lte: to }, factory: { deletedAt: null } },
      include: { factory: { include: { relation: true } } },
      orderBy: { validUntil: 'asc' },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 4. 产能日历 FactoryCapacity（计划产能落地；占用实时聚合在手采购单）
  // ══════════════════════════════════════════════════════════════

  async function upsertCapacity(factoryId: string, input: FactoryCapacityInput, actorId: string): Promise<FactoryCapacity> {
    if (!MONTH_RE.test(input.month)) throw new Error('month 必须是 YYYY-MM');
    if (typeof input.capacity !== 'number' || Number.isNaN(input.capacity) || input.capacity < 0) {
      throw new Error('capacity 必须是非负数字');
    }
    await getProfileOrThrow(factoryId);
    const ts = now();
    const existing = await db.factoryCapacity.findFirst({
      where: { factoryId, month: input.month, deletedAt: null },
    });
    let row: FactoryCapacity;
    if (existing) {
      row = await db.factoryCapacity.update({
        where: { id: existing.id },
        data: { capacity: input.capacity, unit: input.unit ?? null, note: input.note ?? null, updatedAt: BigInt(ts) },
      });
    } else {
      row = await db.factoryCapacity.create({
        data: {
          id: generateId('FACC'),
          factoryId,
          month: input.month,
          capacity: input.capacity,
          unit: input.unit ?? null,
          note: input.note ?? null,
          createdAt: BigInt(ts),
          updatedAt: BigInt(ts),
        },
      });
    }
    logger.info('[FactoryService] capacity upserted', { factoryId, month: input.month, actorId });
    return row;
  }

  async function deleteCapacity(factoryId: string, month: string, actorId: string): Promise<void> {
    const existing = await db.factoryCapacity.findFirst({ where: { factoryId, month, deletedAt: null } });
    if (!existing) throw new Error('产能记录不存在');
    await db.factoryCapacity.update({ where: { id: existing.id }, data: { deletedAt: BigInt(now()), updatedAt: BigInt(now()) } });
    logger.info('[FactoryService] capacity soft-deleted', { factoryId, month, actorId });
  }

  /**
   * 产能占用：在手采购单（Sent/Confirmed/PartiallyReceived）按 expectedDeliveryDate 落月聚合行数量。
   * 占用量不落地，实时计算（口径变更无需回填）。
   */
  async function aggregateOccupied(relationId: string, months: string[]): Promise<Record<string, number>> {
    const occupied: Record<string, number> = {};
    if (!months.length) return occupied;
    const pos = await db.purchaseOrder.findMany({
      where: {
        supplierRelationId: relationId,
        deletedAt: null,
        status: { in: OCCUPYING_PO_STATUSES },
        expectedDeliveryDate: { not: null },
      },
      // P0-002 修复：PurchaseLine 无 deletedAt 软删字段（随主单 onDelete: Cascade），
      // 原 where: { deletedAt: null } 引用不存在字段导致 Prisma 校验 500（供应商 360° overview 全挂）。
      select: { expectedDeliveryDate: true, lines: { select: { quantity: true } } },
    });
    for (const po of pos) {
      const month = String(po.expectedDeliveryDate).slice(0, 7);
      if (!months.includes(month)) continue;
      const qty = po.lines.reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
      occupied[month] = (occupied[month] || 0) + qty;
    }
    return occupied;
  }

  async function listCapacity(factoryId: string): Promise<Array<FactoryCapacity & { occupied: number }>> {
    const profile = await getProfileOrThrow(factoryId);
    const rows: FactoryCapacity[] = await db.factoryCapacity.findMany({
      where: { factoryId, deletedAt: null },
      orderBy: { month: 'asc' },
    });
    const occupied = await aggregateOccupied(profile.relationId, rows.map(r => r.month));
    return rows.map(r => ({ ...r, occupied: occupied[r.month] || 0 }));
  }

  // ══════════════════════════════════════════════════════════════
  // 5. 360° 总览
  // ══════════════════════════════════════════════════════════════

  async function getOverview(factoryId: string) {
    const profile = await db.factoryProfile.findUnique({
      where: { id: factoryId },
      include: { relation: true },
    });
    if (!profile || profile.deletedAt !== null) return null;
    const [evaluations, certifications, capacity] = await Promise.all([
      listEvaluations(factoryId),
      listCertifications(factoryId),
      listCapacity(factoryId),
    ]);
    return { profile, evaluations: evaluations.slice(0, 20), certifications, capacity };
  }

  return {
    createProfile,
    updateProfile,
    getProfile,
    getProfileByRelation,
    listProfiles,
    deleteProfile,
    setBlacklist,
    clearBlacklist,
    assertNotBlacklisted,
    addEvaluation,
    recordAutoEvaluation,
    listEvaluations,
    addCertification,
    updateCertification,
    deleteCertification,
    listCertifications,
    listExpiringCertifications,
    upsertCapacity,
    deleteCapacity,
    listCapacity,
    aggregateOccupied,
    getOverview,
  };
}

export type FactoryService = ReturnType<typeof createFactoryService>;
