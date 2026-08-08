/**
 * 阶段 P0 回补 — 业务线注册与订单业务线标记服务（PRD 6.2）
 *
 * 职责：
 *   1. 业务线注册表（BusinessLine）：code 为 @unique 注册真源，
 *      Order.businessLine 为其 snapshot 引用（不强制外键，与全库一致）。
 *   2. 订单业务线标记 setOrderBusinessLine：仅允许指向存在且 isActive 的业务线。
 *   3. MOQ 软校验 checkOrderMoq：产出合规结论与违规明细，不阻断业务流程。
 *
 * 设计原则（与 seasons/risk 模块一致）：
 *   - 服务工厂模式 createBusinessLineService(prisma)
 *   - 软删除（deletedAt BigInt）；code 不可修改（snapshot 关联真源）
 *   - 中文校验错误消息，路由层按消息关键字映射 400/404
 */

import { PrismaClient, BusinessLine } from '@prisma/client';
import { logger } from '../lib/logger';
import crypto from 'crypto';

// ────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────

export interface BusinessLineInput {
  code: string; // 归一化为小写；fabric | garment | capsule 之外不限制，但须符合 CODE_RE
  name: string;
  description?: string | null;
  moqValue?: number | null;
  moqUnit?: string | null; // M | PC
  productionCycleDays?: number | null;
  paymentTermsHint?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export type BusinessLinePatch = Partial<Omit<BusinessLineInput, 'code'>>;

export interface MoqViolation {
  rule: 'moq';
  expected: number;
  actual: number;
  unit: string | null;
}

export type MoqCheckResult =
  | { checked: false; reason: string }
  | {
      checked: true;
      businessLine: string;
      moqValue: number;
      moqUnit: string | null;
      quantity: number;
      compliant: boolean;
      violations: MoqViolation[];
    };

const CODE_RE = /^[a-z][a-z0-9_]*$/;

function generateId(prefix: string): string {
  return `${prefix}__${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createBusinessLineService(prisma: PrismaClient) {
  const db = prisma as any;
  const now = () => Date.now();

  async function getBusinessLineOrThrow(id: string): Promise<BusinessLine> {
    const bl = await db.businessLine.findUnique({ where: { id } });
    if (!bl || bl.deletedAt !== null) throw new Error('业务线不存在');
    return bl;
  }

  async function createBusinessLine(input: BusinessLineInput, actorId: string): Promise<BusinessLine> {
    if (!input.code?.trim()) throw new Error('业务线代码必填');
    const code = input.code.trim().toLowerCase();
    if (!CODE_RE.test(code)) {
      throw new Error(`非法业务线代码：${input.code}（须为小写字母开头的小写字母/数字/下划线）`);
    }
    if (!input.name?.trim()) throw new Error('业务线名称必填');

    // code 为 @unique 注册真源：存在（含已软删）即拒绝，避免撞唯一约束
    const dup = await db.businessLine.findUnique({ where: { code } });
    if (dup) throw new Error('业务线代码已存在');

    const ts = now();
    const bl = await db.businessLine.create({
      data: {
        id: generateId('BL'),
        code,
        name: input.name.trim(),
        description: input.description ?? null,
        moqValue: input.moqValue ?? null,
        moqUnit: input.moqUnit ?? null,
        productionCycleDays: input.productionCycleDays ?? null,
        paymentTermsHint: input.paymentTermsHint ?? null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        createdAt: BigInt(ts),
        updatedAt: BigInt(ts),
        deletedAt: null,
      },
    });
    logger.info('[BusinessLineService] business line created', { id: bl.id, code, actorId });
    return bl;
  }

  async function listBusinessLines(query: { includeInactive?: boolean }) {
    const where: any = { deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    const [items, total] = await Promise.all([
      db.businessLine.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      db.businessLine.count({ where }),
    ]);
    return { items, total };
  }

  const PATCH_FIELDS = [
    'name', 'description', 'moqValue', 'moqUnit',
    'productionCycleDays', 'paymentTermsHint', 'isActive', 'sortOrder',
  ] as const;

  async function updateBusinessLine(id: string, patch: BusinessLinePatch, actorId: string): Promise<BusinessLine> {
    const bl = await getBusinessLineOrThrow(id);
    // code 是 snapshot 关联真源（Order.businessLine 等值匹配），禁止修改
    if ((patch as any).code !== undefined) throw new Error('业务线代码不可修改');
    if (patch.name !== undefined && !patch.name?.trim()) throw new Error('业务线名称必填');

    const data: Record<string, unknown> = { updatedAt: BigInt(now()) };
    for (const f of PATCH_FIELDS) {
      if ((patch as any)[f] !== undefined) {
        data[f] = f === 'name' ? patch.name!.trim() : (patch as any)[f];
      }
    }
    const updated = await db.businessLine.update({ where: { id: bl.id }, data });
    logger.info('[BusinessLineService] business line updated', { id: bl.id, actorId, fields: Object.keys(patch) });
    return updated;
  }

  async function deleteBusinessLine(id: string, actorId: string): Promise<void> {
    const bl = await getBusinessLineOrThrow(id);
    const refs = await db.order.count({ where: { deletedAt: null, businessLine: bl.code } });
    if (refs > 0) throw new Error('仍有订单引用此业务线，不可删除');
    await db.businessLine.update({
      where: { id: bl.id },
      data: { deletedAt: BigInt(now()), updatedAt: BigInt(now()) },
    });
    logger.info('[BusinessLineService] business line soft-deleted', { id: bl.id, code: bl.code, actorId });
  }

  /**
   * 订单业务线标记：code 为 null / 空串表示清除标记；
   * 非空时须指向存在且 isActive 的业务线（code 归一化小写）。
   */
  async function setOrderBusinessLine(orderId: string, code: string | null, actorId: string) {
    if (!orderId?.trim()) throw new Error('orderId 必填');
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt !== null) throw new Error('订单不存在');

    let normalized: string | null = null;
    if (code !== null && code !== undefined && String(code).trim() !== '') {
      normalized = String(code).trim().toLowerCase();
      const bl = await db.businessLine.findUnique({ where: { code: normalized } });
      if (!bl || bl.deletedAt !== null) throw new Error('业务线不存在');
      if (!bl.isActive) throw new Error('业务线已停用');
    }

    const updated = await db.order.update({
      where: { id: orderId },
      data: { businessLine: normalized, updatedAt: BigInt(now()) },
    });
    logger.info('[BusinessLineService] order business line set', { orderId, businessLine: normalized, actorId });
    return updated;
  }

  /**
   * MOQ 软校验（PRD 6.2）：不阻断，仅产出合规结论与违规明细。
   * 未标记业务线 / 业务线未配置 MOQ 时返回 checked: false 及原因。
   */
  async function checkOrderMoq(orderId: string): Promise<MoqCheckResult> {
    if (!orderId?.trim()) throw new Error('orderId 必填');
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt !== null) throw new Error('订单不存在');

    if (!order.businessLine) return { checked: false, reason: '未标记业务线' };
    const bl = await db.businessLine.findUnique({ where: { code: order.businessLine } });
    if (!bl || bl.deletedAt !== null) return { checked: false, reason: '业务线不存在' };
    if (bl.moqValue === null || bl.moqValue === undefined) {
      return { checked: false, reason: '该业务线未配置 MOQ' };
    }

    const moqValue = Number(bl.moqValue);
    const quantity = Number(order.quantity ?? 0);
    const compliant = quantity >= moqValue;
    return {
      checked: true,
      businessLine: bl.code,
      moqValue,
      moqUnit: bl.moqUnit ?? null,
      quantity,
      compliant,
      violations: compliant
        ? []
        : [{ rule: 'moq', expected: moqValue, actual: quantity, unit: bl.moqUnit ?? null }],
    };
  }

  return {
    createBusinessLine,
    listBusinessLines,
    updateBusinessLine,
    deleteBusinessLine,
    setOrderBusinessLine,
    checkOrderMoq,
  };
}

export type BusinessLineService = ReturnType<typeof createBusinessLineService>;
