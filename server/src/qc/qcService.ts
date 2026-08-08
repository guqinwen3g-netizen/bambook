/**
 * 阶段 P0 回补 — QC 驻地与验货任务服务（PRD 6.2 / 4.2 QC 工作台）
 *
 * 职责：
 *   1. QC 驻地（QCLocation）：code 为 @unique 注册真源，软删除；
 *      有未删除任务引用时禁止删除。
 *   2. 验货任务（QCAssignment）：状态机 Assigned → InProgress → Completed，
 *      Assigned | InProgress → Cancelled；同订单同验货类型仅允许一个进行中任务。
 *      factoryRelationId 冗余自 Order.millRelationId（snapshot，随订单当时值落库）。
 *   3. QC 工作台 getWorkbench：按状态分组，completed 仅近 30 天（按 completedAt
 *      降序限 20 条）；每条任务附 Order 快照（批量联查，N+1 防护）。
 *
 * 设计原则（与 seasons/risk 模块一致）：
 *   - 服务工厂模式 createQcService(prisma)
 *   - 软删除（deletedAt BigInt）；已完结任务不可修改
 *   - 中文校验错误消息，路由层按消息关键字映射 400/404
 */

import { PrismaClient, QCLocation, QCAssignment } from '@prisma/client';
import { logger } from '../lib/logger';
import crypto from 'crypto';

// ────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────

export interface QCLocationInput {
  code: string; // 归一化为小写
  name: string;
  region?: string | null;
  focus?: string | null; // 驻地主攻业务线：garment | fabric
  address?: string | null;
  notes?: string | null;
}

export type QCLocationPatch = Partial<Omit<QCLocationInput, 'code'>>;

export interface QCAssignmentInput {
  orderId: string;
  inspectionType: string; // midline | final
  qcUserId: string;
  locationId?: string | null;
  dueDate?: string | null; // YYYY-MM-DD
  notes?: string | null;
}

export type QCAssignmentPatch = Partial<Pick<QCAssignmentInput, 'notes' | 'dueDate' | 'locationId' | 'qcUserId'>>;

export interface AssignmentListQuery {
  qcUserId?: string;
  status?: string;
  orderId?: string;
  locationId?: string;
  dueBefore?: string; // YYYY-MM-DD，dueDate <= dueBefore
  limit?: number;
  offset?: number;
}

const INSPECTION_TYPES = ['midline', 'final'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 工作台已完成任务回看窗口：近 30 天 */
const WORKBENCH_COMPLETED_WINDOW_DAYS = 30;
const WORKBENCH_COMPLETED_LIMIT = 20;

function generateId(prefix: string): string {
  return `${prefix}__${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createQcService(prisma: PrismaClient) {
  const db = prisma as any;
  const now = () => Date.now();

  // ══════════════════════════════════════════════════════════════
  // 1. QC 驻地 QCLocation
  // ══════════════════════════════════════════════════════════════

  async function getLocationOrThrow(id: string): Promise<QCLocation> {
    const loc = await db.qCLocation.findUnique({ where: { id } });
    if (!loc || loc.deletedAt !== null) throw new Error('驻地不存在');
    return loc;
  }

  async function createLocation(input: QCLocationInput, actorId: string): Promise<QCLocation> {
    if (!input.code?.trim()) throw new Error('驻地代码必填');
    const code = input.code.trim().toLowerCase();
    if (!input.name?.trim()) throw new Error('驻地名称必填');

    const dup = await db.qCLocation.findUnique({ where: { code } });
    if (dup) throw new Error('驻地代码已存在');

    const ts = now();
    const loc = await db.qCLocation.create({
      data: {
        id: generateId('QCL'),
        code,
        name: input.name.trim(),
        region: input.region ?? null,
        focus: input.focus ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        createdAt: BigInt(ts),
        updatedAt: BigInt(ts),
        deletedAt: null,
      },
    });
    logger.info('[QcService] location created', { id: loc.id, code, actorId });
    return loc;
  }

  async function listLocations() {
    return db.qCLocation.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  const LOCATION_PATCH_FIELDS = ['name', 'region', 'focus', 'address', 'notes'] as const;

  async function updateLocation(id: string, patch: QCLocationPatch, actorId: string): Promise<QCLocation> {
    const loc = await getLocationOrThrow(id);
    // code 是注册真源，禁止修改
    if ((patch as any).code !== undefined) throw new Error('驻地代码不可修改');
    if (patch.name !== undefined && !patch.name?.trim()) throw new Error('驻地名称必填');

    const data: Record<string, unknown> = { updatedAt: BigInt(now()) };
    for (const f of LOCATION_PATCH_FIELDS) {
      if ((patch as any)[f] !== undefined) {
        data[f] = f === 'name' ? patch.name!.trim() : (patch as any)[f];
      }
    }
    const updated = await db.qCLocation.update({ where: { id: loc.id }, data });
    logger.info('[QcService] location updated', { id: loc.id, actorId, fields: Object.keys(patch) });
    return updated;
  }

  async function deleteLocation(id: string, actorId: string): Promise<void> {
    const loc = await getLocationOrThrow(id);
    const refs = await db.qCAssignment.count({ where: { deletedAt: null, locationId: loc.id } });
    if (refs > 0) throw new Error('仍有验货任务引用此驻地，不可删除');
    await db.qCLocation.update({
      where: { id: loc.id },
      data: { deletedAt: BigInt(now()), updatedAt: BigInt(now()) },
    });
    logger.info('[QcService] location soft-deleted', { id: loc.id, code: loc.code, actorId });
  }

  // ══════════════════════════════════════════════════════════════
  // 2. 验货任务 QCAssignment
  // ══════════════════════════════════════════════════════════════

  async function getAssignmentOrThrow(id: string): Promise<QCAssignment> {
    const assignment = await db.qCAssignment.findUnique({ where: { id } });
    if (!assignment || assignment.deletedAt !== null) throw new Error('验货任务不存在');
    return assignment;
  }

  async function assertQcUser(qcUserId: string): Promise<void> {
    const user = await db.userAccount.findUnique({ where: { id: qcUserId } });
    if (!user || user.deletedAt !== null) throw new Error('QC 人员不存在');
    if (user.status !== 'active') throw new Error('QC 人员必须是 active 状态');
  }

  function assertDueDate(dueDate: string | null | undefined): void {
    if (dueDate !== null && dueDate !== undefined && !DATE_RE.test(dueDate)) {
      throw new Error('dueDate 必须是 YYYY-MM-DD');
    }
  }

  async function createAssignment(input: QCAssignmentInput, actorId: string): Promise<QCAssignment> {
    if (!input.orderId?.trim()) throw new Error('orderId 必填');
    if (!(INSPECTION_TYPES as readonly string[]).includes(input.inspectionType)) {
      throw new Error(`非法验货类型：${input.inspectionType}（允许 midline | final）`);
    }
    if (!input.qcUserId?.trim()) throw new Error('qcUserId 必填');
    assertDueDate(input.dueDate);

    const order = await db.order.findUnique({ where: { id: input.orderId } });
    if (!order || order.deletedAt !== null) throw new Error('订单不存在');
    await assertQcUser(input.qcUserId);
    if (input.locationId) await getLocationOrThrow(input.locationId);

    // 同订单同验货类型仅允许一个进行中任务（Cancelled 不占位）
    const dup = await db.qCAssignment.findFirst({
      where: {
        orderId: input.orderId,
        inspectionType: input.inspectionType,
        deletedAt: null,
        status: { not: 'Cancelled' },
      },
    });
    if (dup) throw new Error('该订单此验货类型已有进行中任务');

    const ts = now();
    const assignment = await db.qCAssignment.create({
      data: {
        id: generateId('QCA'),
        orderId: input.orderId,
        inspectionType: input.inspectionType,
        qcUserId: input.qcUserId,
        locationId: input.locationId ?? null,
        factoryRelationId: order.millRelationId ?? null,
        status: 'Assigned',
        dueDate: input.dueDate ?? null,
        assignedAt: BigInt(ts),
        assignedById: actorId,
        completedAt: null,
        reportId: null,
        notes: input.notes ?? null,
        createdAt: BigInt(ts),
        updatedAt: BigInt(ts),
        deletedAt: null,
      },
    });
    logger.info('[QcService] assignment created', {
      id: assignment.id, orderId: input.orderId, inspectionType: input.inspectionType, qcUserId: input.qcUserId, actorId,
    });
    return assignment;
  }

  const ASSIGNMENT_PATCH_FIELDS = ['notes', 'dueDate', 'locationId', 'qcUserId'] as const;

  async function updateAssignment(id: string, patch: QCAssignmentPatch, actorId: string): Promise<QCAssignment> {
    const assignment = await getAssignmentOrThrow(id);
    if (assignment.status === 'Completed' || assignment.status === 'Cancelled') {
      throw new Error('已完结任务不可修改');
    }
    assertDueDate(patch.dueDate);
    if (patch.qcUserId !== undefined) await assertQcUser(patch.qcUserId);
    if (patch.locationId) await getLocationOrThrow(patch.locationId);

    const data: Record<string, unknown> = { updatedAt: BigInt(now()) };
    for (const f of ASSIGNMENT_PATCH_FIELDS) {
      if ((patch as any)[f] !== undefined) data[f] = (patch as any)[f];
    }
    const updated = await db.qCAssignment.update({ where: { id: assignment.id }, data });
    logger.info('[QcService] assignment updated', { id: assignment.id, actorId, fields: Object.keys(patch) });
    return updated;
  }

  async function startAssignment(id: string, actorId: string): Promise<QCAssignment> {
    const assignment = await getAssignmentOrThrow(id);
    if (assignment.status !== 'Assigned') {
      throw new Error(`非法状态流转：当前状态 ${assignment.status} 不可开始`);
    }
    const updated = await db.qCAssignment.update({
      where: { id: assignment.id },
      data: { status: 'InProgress', updatedAt: BigInt(now()) },
    });
    logger.info('[QcService] assignment started', { id: assignment.id, actorId });
    return updated;
  }

  async function completeAssignment(id: string, input: { reportId?: string | null }, actorId: string): Promise<QCAssignment> {
    const assignment = await getAssignmentOrThrow(id);
    if (assignment.status !== 'Assigned' && assignment.status !== 'InProgress') {
      throw new Error(`非法状态流转：当前状态 ${assignment.status} 不可完成`);
    }
    if (input.reportId) {
      const report = await db.inspectionReport.findUnique({ where: { id: input.reportId } });
      if (!report) throw new Error('验货报告不存在');
      if (report.orderId !== assignment.orderId) throw new Error('报告与任务订单不匹配');
    }
    const ts = now();
    const updated = await db.qCAssignment.update({
      where: { id: assignment.id },
      data: {
        status: 'Completed',
        completedAt: BigInt(ts),
        reportId: input.reportId ?? null,
        updatedAt: BigInt(ts),
      },
    });
    logger.info('[QcService] assignment completed', { id: assignment.id, reportId: input.reportId ?? null, actorId });
    return updated;
  }

  async function cancelAssignment(id: string, actorId: string): Promise<QCAssignment> {
    const assignment = await getAssignmentOrThrow(id);
    if (assignment.status === 'Completed') throw new Error('已完成任务不可取消');
    if (assignment.status === 'Cancelled') throw new Error('非法状态流转：任务已取消');
    const updated = await db.qCAssignment.update({
      where: { id: assignment.id },
      data: { status: 'Cancelled', updatedAt: BigInt(now()) },
    });
    logger.info('[QcService] assignment cancelled', { id: assignment.id, actorId });
    return updated;
  }

  async function deleteAssignment(id: string, actorId: string): Promise<void> {
    const assignment = await getAssignmentOrThrow(id);
    await db.qCAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: BigInt(now()), updatedAt: BigInt(now()) },
    });
    logger.info('[QcService] assignment soft-deleted', { id: assignment.id, actorId });
  }

  // ─── 查询（附 Order 快照 + location） ───

  /** 批量联查 Order 快照（N+1 防护）：软删订单视同无快照 */
  async function attachOrderSnapshots(rows: any[]): Promise<any[]> {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map(r => r.orderId))];
    const orders = await db.order.findMany({ where: { id: { in: ids }, deletedAt: null } });
    const map = new Map<string, any>(orders.map((o: any) => [o.id, o]));
    return rows.map(r => {
      const o = map.get(r.orderId);
      return {
        ...r,
        order: o
          ? {
              poNumber: o.poNumber ?? null,
              customer: o.customer,
              product: o.product,
              dueDate: o.dueDate,
              clientDate: o.clientDate ?? null,
              businessLine: o.businessLine ?? null,
            }
          : null,
      };
    });
  }

  async function listAssignments(query: AssignmentListQuery) {
    const where: any = { deletedAt: null };
    if (query.qcUserId) where.qcUserId = query.qcUserId;
    if (query.status) where.status = query.status;
    if (query.orderId) where.orderId = query.orderId;
    if (query.locationId) where.locationId = query.locationId;
    if (query.dueBefore) where.dueDate = { lte: query.dueBefore };
    const take = Math.min(query.limit || 50, 200);
    const skip = query.offset || 0;
    const [rows, total] = await Promise.all([
      db.qCAssignment.findMany({
        where,
        include: { location: true },
        orderBy: { assignedAt: 'desc' },
        take,
        skip,
      }),
      db.qCAssignment.count({ where }),
    ]);
    const items = await attachOrderSnapshots(rows);
    return { items, total };
  }

  /**
   * QC 工作台（PRD 4.2）：按状态分组；completed 仅近 30 天，
   * 按 completedAt 降序限 20 条。qcUserId 为空返回全部未删除任务。
   */
  async function getWorkbench(query: { qcUserId?: string }) {
    const where: any = { deletedAt: null };
    if (query.qcUserId) where.qcUserId = query.qcUserId;
    const rows = await db.qCAssignment.findMany({
      where,
      include: { location: true },
      orderBy: { assignedAt: 'desc' },
      take: 1000,
    });
    const withOrders = await attachOrderSnapshots(rows);

    const assigned = withOrders.filter(r => r.status === 'Assigned');
    const inProgress = withOrders.filter(r => r.status === 'InProgress');
    const since = now() - WORKBENCH_COMPLETED_WINDOW_DAYS * DAY_MS;
    const completed = withOrders
      .filter(r => r.status === 'Completed' && r.completedAt !== null && Number(r.completedAt) >= since)
      .sort((a, b) => Number(b.completedAt) - Number(a.completedAt))
      .slice(0, WORKBENCH_COMPLETED_LIMIT);

    return { assigned, inProgress, completed };
  }

  return {
    // 驻地
    createLocation,
    listLocations,
    updateLocation,
    deleteLocation,
    // 任务
    createAssignment,
    updateAssignment,
    startAssignment,
    completeAssignment,
    cancelAssignment,
    deleteAssignment,
    listAssignments,
    getWorkbench,
  };
}

export type QcService = ReturnType<typeof createQcService>;
