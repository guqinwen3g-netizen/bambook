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
import { writeRouteAuditLog } from '../audit/routeAudit';
import { isFabricChainOrder, isGarmentChainOrder, isDevelopmentSampleType } from './qcChainService';
// D8：验货放行口径唯一真源（合格率≥90% + 不合格率≤3% + 致命疵点=0 + 业务批准），
// 与 production/stageService「qc_shipped」生产门禁同一判定函数，禁止 QC 侧重造宽松口径
import { assessInspectionRelease } from '../production/stageService';

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

/**
 * 大货验货报告录入（缺口修复：此前 InspectionReport 只能直插 DB，无 API 写入路径）。
 * completeAssignment 携带 report 数据时自动创建大货报告：
 *   - final → id 锚定 `INR__{orderId}`（出运门禁消费锚点，每单唯一）
 *   - midline → id `INR__{orderId}__mid`（中期报告，与 final/样品链锚点不冲突）
 */
export interface BulkReportInput {
  result: 'pass' | 'fail';
  inspectionDate?: string; // YYYY-MM-DD
  totalUnits?: number;
  passedUnits?: number;
  lotSize?: number;
  sampleSize?: number;
  aqlLevel?: string;
  criticalDefects?: number; // D7：致命疵点（AQL 0 零容忍，D8 放行口径消费）
  majorDefects?: number;
  minorDefects?: number;
  defectSummary?: string;
  notes?: string;
}

export interface AssignmentListQuery {
  qcUserId?: string;
  status?: string;
  orderId?: string;
  locationId?: string;
  dueBefore?: string; // YYYY-MM-DD，dueDate <= dueBefore
  limit?: number;
  offset?: number;
  /** Excel 台账导出=true：忽略分页上限全量导出（route 层 format=xlsx 专用） */
  exportAll?: boolean;
}

const INSPECTION_TYPES = ['midline', 'final'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 工作台已完成任务回看窗口：近 30 天 */
const WORKBENCH_COMPLETED_WINDOW_DAYS = 30;
const WORKBENCH_COMPLETED_LIMIT = 20;

// ────────────────────────────────────────────────────────────────
// DR-014 出运资格视图类型（面料链三条件并行）
// ────────────────────────────────────────────────────────────────

export type ShipmentGateCode = 'BULK_QC_NOT_PASSED' | 'SS_NOT_CONFIRMED' | 'RC_NOT_CONFIRMED';

export interface ShipmentGateState {
  satisfied: boolean;
  [key: string]: unknown;
}

export interface ShipmentEligibility {
  orderId: string;
  /** DR-014 三条件仅适用于面料订单；服装订单出运门禁=大货 Final QC（REL-14-A4，由 checkGarmentShipmentEligibility 承担） */
  applicable: boolean;
  eligible: boolean;
  /** 三条件并行状态（完成顺序无关；缺任一条即 eligible=false） */
  conditions: {
    bulkQc: ShipmentGateState;
    ss: ShipmentGateState;
    rc: ShipmentGateState & { enabled: boolean };
  };
  missingGates: ShipmentGateCode[];
  /** applicable=false 时的原因说明（链边界） */
  reason?: string;
}

/**
 * REL-14-A4 服装链出运资格视图：仅大货终期 Final QC 单条件（与样品 QC 严格独立）。
 * 与面料链 ShipmentEligibility 分离定义——服装链无 S/S、RC 概念，复用同一结构会产生误导性空槽。
 */
export interface GarmentShipmentEligibility {
  orderId: string;
  /** 仅服装链订单适用（isGarmentChainOrder）；非服装订单 applicable=false */
  applicable: boolean;
  eligible: boolean;
  /** 大货终期 Final QC 状态（InspectionReport id=INR__{orderId}, inspectionType='final'；D8 起按生产门禁统一口径判定） */
  bulkQc: ShipmentGateState;
  missingGates: ShipmentGateCode[];
  /** applicable=false 时的原因说明（链边界） */
  reason?: string;
}

export type ReportSignRole = 'qc' | 'business';

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

  async function completeAssignment(
    id: string,
    input: { reportId?: string | null; report?: BulkReportInput },
    actorId: string,
  ): Promise<QCAssignment> {
    const assignment = await getAssignmentOrThrow(id);
    if (assignment.status !== 'Assigned' && assignment.status !== 'InProgress') {
      throw new Error(`非法状态流转：当前状态 ${assignment.status} 不可完成`);
    }
    if (input.reportId) {
      const report = await db.inspectionReport.findUnique({ where: { id: input.reportId } });
      if (!report) throw new Error('验货报告不存在');
      if (report.orderId !== assignment.orderId) throw new Error('报告与任务订单不匹配');
    }

    // 缺口修复：携带 report 数据 → 自动创建大货验货报告（此前只能直插 DB）
    let createdReportId: string | null = input.reportId ?? null;
    if (input.report) {
      const r = input.report;
      if (!INSPECTION_TYPES.includes(assignment.inspectionType as any)) {
        throw new Error(`任务验货类型 ${assignment.inspectionType} 不支持大货报告录入（允许 midline | final）`);
      }
      if (r.result !== 'pass' && r.result !== 'fail') {
        throw new Error('report.result 必须是 pass 或 fail');
      }
      const reportId = assignment.inspectionType === 'final'
        ? `INR__${assignment.orderId}` // 出运门禁锚点（checkShipmentEligibility / checkGarmentShipmentEligibility 消费）
        : `INR__${assignment.orderId}__mid`;
      const dup = await db.inspectionReport.findUnique({ where: { id: reportId } });
      if (dup) {
        throw new Error(`大货${assignment.inspectionType === 'final' ? '终期' : '中期'}验货报告已存在（${reportId}），如需修正请先处理既有报告`);
      }
      const ts = now();
      await db.inspectionReport.create({
        data: {
          id: reportId,
          orderId: assignment.orderId,
          inspectionType: assignment.inspectionType,
          result: r.result,
          inspectionDate: r.inspectionDate ?? new Date(ts).toISOString().slice(0, 10),
          inspectedBy: assignment.qcUserId,
          // schema 契约对齐：totalUnits/passedUnits/criticalDefects/majorDefects/minorDefects 为
          // Int @default(0) 必填（不可 null），缺省语义为 0；lotSize/sampleSize 可空
          totalUnits: r.totalUnits ?? 0,
          passedUnits: r.passedUnits ?? 0,
          lotSize: r.lotSize ?? null,
          sampleSize: r.sampleSize ?? null,
          aqlLevel: r.aqlLevel ?? null,
          criticalDefects: r.criticalDefects ?? 0,
          majorDefects: r.majorDefects ?? 0,
          minorDefects: r.minorDefects ?? 0,
          defectSummary: r.defectSummary ?? null,
          notes: r.notes ?? null,
          createdAt: BigInt(ts),
          updatedAt: BigInt(ts),
        },
      });
      createdReportId = reportId;
      logger.info('[QcService] bulk inspection report created', { reportId, orderId: assignment.orderId, type: assignment.inspectionType, result: r.result });
    }

    const ts = now();
    const updated = await db.qCAssignment.update({
      where: { id: assignment.id },
      data: {
        status: 'Completed',
        completedAt: BigInt(ts),
        reportId: createdReportId,
        updatedAt: BigInt(ts),
      },
    });
    logger.info('[QcService] assignment completed', { id: assignment.id, reportId: createdReportId, actorId });
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
    const take = query.exportAll ? undefined : Math.min(query.limit || 50, 200);
    const skip = query.exportAll ? 0 : (query.offset || 0);
    const [rows, total] = await Promise.all([
      db.qCAssignment.findMany({
        where,
        include: { location: true },
        orderBy: { assignedAt: 'desc' },
        ...(take != null ? { take, skip } : {}),
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

  // ══════════════════════════════════════════════════════════════
  // 3. DR-014 面料出运资格判定（大货 QC ∥ S/S 客户确认 ∥ RC 客户确认 三条件并行）
  // ══════════════════════════════════════════════════════════════

  /**
   * DR-014：面料大货 QC 通过、S/S 客户确认完成、已启用 RC 的客户确认完成，
   * 三者是具备申请出运资格的独立并行条件（完成顺序无关，互不前置）。
   * 本函数只做原始门禁状态报告（fail-closed 视图），DR-013 受控例外由出运域另行绑定，
   * 例外不改变此处返回的门禁状态（DR-013「例外不改变原规则」）。
   *
   * 数据来源（链路边界：各自独立记录，禁止合并为单一「已确认」字段）：
   *   - bulkQc：InspectionReport(orderId, inspectionType='final')，D8 起放行判定统一为
   *     生产门禁口径（assessInspectionRelease：结论非 fail + 致命疵点=0 + 合格率≥90%
   *     + 不合格率≤3% + 业务部批准），不满足时 conditions.bulkQc.failureReasons 给出缺口
   *   - ss：FabricShipmentSample(orderId, deletedAt=null) customerStatus='approved'（取最新一条）
   *   - rc：Order.fabricSampleSentDate 非空=已启用；启用则要求 fabricSampleConfirmedDate 非空
   * 服装订单不适用（出运门禁=大货 Final QC 独立检查，REL-14-A4）→ applicable=false。
   */
  async function checkShipmentEligibility(orderId: string): Promise<ShipmentEligibility> {
    if (!orderId?.trim()) throw new Error('orderId 必填');
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt !== null) throw new Error('订单不存在');

    if (!isFabricChainOrder(order)) {
      return {
        orderId,
        applicable: false,
        eligible: false,
        conditions: {
          bulkQc: { satisfied: false },
          ss: { satisfied: false },
          rc: { enabled: false, satisfied: false },
        },
        missingGates: [],
        reason: 'DR-014 出运三条件仅适用于面料订单；服装订单出运门禁为大货终期 Final QC（与样品 QC 独立，REL-14-A4）',
      };
    }

    const finalReport = await db.inspectionReport.findUnique({
      where: { id: `INR__${orderId}` },
    });
    // D8：bulkQc 放行 = 生产门禁统一口径（result 非 fail + 致命疵点=0 + 合格率≥90%
    // + 不合格率≤3% + 业务部批准），不再只看 result='pass' 宽松判定
    const bulkRelease = finalReport && finalReport.inspectionType === 'final'
      ? assessInspectionRelease(finalReport)
      : assessInspectionRelease(null);
    const bulkQcPassed = bulkRelease.qualified;

    const ssSamples = await db.fabricShipmentSample.findMany({
      where: { orderId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const latestSs = ssSamples[0] ?? null;
    const ssApproved = !!latestSs && latestSs.customerStatus === 'approved';

    const rcEnabled = !!order.fabricSampleSentDate;
    const rcConfirmed = rcEnabled && !!order.fabricSampleConfirmedDate;

    const missingGates: ShipmentGateCode[] = [];
    if (!bulkQcPassed) missingGates.push('BULK_QC_NOT_PASSED');
    if (!ssApproved) missingGates.push('SS_NOT_CONFIRMED');
    if (rcEnabled && !rcConfirmed) missingGates.push('RC_NOT_CONFIRMED');

    return {
      orderId,
      applicable: true,
      eligible: missingGates.length === 0,
      conditions: {
        bulkQc: {
          satisfied: bulkQcPassed,
          reportId: finalReport?.id ?? null,
          result: finalReport?.result ?? null,
          inspectedBy: finalReport?.inspectedBy ?? null,
          inspectionDate: finalReport?.inspectionDate ?? null,
          // D8 透明化：不满足时的具体口径缺口（消息与生产门禁逐条口径一致）
          ...(bulkRelease.qualified ? {} : { failureReasons: bulkRelease.failures.map(f => f.message) }),
        },
        ss: {
          satisfied: ssApproved,
          sampleId: latestSs?.id ?? null,
          sampleCode: latestSs?.sampleCode ?? null,
          customerStatus: latestSs?.customerStatus ?? null,
          customerFeedbackDate: latestSs?.customerFeedbackDate ?? null,
        },
        rc: {
          enabled: rcEnabled,
          satisfied: rcEnabled ? rcConfirmed : true,
          sentDate: order.fabricSampleSentDate ?? null,
          confirmedDate: order.fabricSampleConfirmedDate ?? null,
        },
      },
      missingGates,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 3B. REL-14-A4 服装出运资格判定（大货终期 Final QC 单条件，与样品 QC 独立）
  // ══════════════════════════════════════════════════════════════

  /**
   * REL-14-A4：服装订单出运门禁 = 大货终期 Final QC 放行（InspectionReport id=INR__{orderId},
   * inspectionType='final'；D8 起判定统一为生产门禁口径 assessInspectionRelease：结论非 fail
   * + 致命疵点=0 + 合格率≥90% + 不合格率≤3% + 业务部批准），与样品链 QC 严格独立（样品打回不阻断大货出运判定，
   * 大货 Final QC 缺/未过即不具备出运资格）。
   * 本函数只做原始门禁状态报告（fail-closed 视图），DR-013 受控例外由出运域另行绑定，
   * 例外不改变此处返回的门禁状态（DR-013「例外不改变原规则」）。
   * 面料订单不适用（走 checkShipmentEligibility 三条件并行）→ applicable=false。
   */
  async function checkGarmentShipmentEligibility(orderId: string): Promise<GarmentShipmentEligibility> {
    if (!orderId?.trim()) throw new Error('orderId 必填');
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt !== null) throw new Error('订单不存在');

    if (!isGarmentChainOrder(order)) {
      return {
        orderId,
        applicable: false,
        eligible: false,
        bulkQc: { satisfied: false },
        missingGates: [],
        reason: 'REL-14-A4 服装出运门禁仅适用于服装链订单（含 capsule）；面料订单走 DR-014 三条件并行判定',
      };
    }

    const finalReport = await db.inspectionReport.findUnique({
      where: { id: `INR__${orderId}` },
    });
    // D8：与面料链同一放行口径（生产门禁统一判定），不再只看 result='pass'
    const bulkRelease = finalReport && finalReport.inspectionType === 'final'
      ? assessInspectionRelease(finalReport)
      : assessInspectionRelease(null);
    const bulkQcPassed = bulkRelease.qualified;

    return {
      orderId,
      applicable: true,
      eligible: bulkQcPassed,
      bulkQc: {
        satisfied: bulkQcPassed,
        reportId: finalReport?.id ?? null,
        result: finalReport?.result ?? null,
        inspectedBy: finalReport?.inspectedBy ?? null,
        inspectionDate: finalReport?.inspectionDate ?? null,
        // D8 透明化：不满足时的具体口径缺口
        ...(bulkRelease.qualified ? {} : { failureReasons: bulkRelease.failures.map(f => f.message) }),
      },
      missingGates: bulkQcPassed ? [] : ['BULK_QC_NOT_PASSED'],
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 4. DR-027 开发样排除（订单前开发样不进入 QC 门禁，业务员自行登记）
  // ══════════════════════════════════════════════════════════════

  /**
   * DR-027：手织样/先锋样/Lab-dip/Strike-off/FIT/confirmation 等开发样类型
   * 不进入 QC 门禁（QC-29-B1：QC 工作台默认不出现开发样任务；评审端点 fail-closed 拒绝）。
   * 判定真源为 qcChainService.isDevelopmentSampleType（归一化大小写/连字符变体），
   * 此处为 QC 域内统一出口，供工作台与样品域消费，避免跨轨重复实现。
   */
  function shouldExcludeFromQc(sampleType?: string | null): boolean {
    return isDevelopmentSampleType(sampleType);
  }

  // ══════════════════════════════════════════════════════════════
  // 5. InspectionReport 读取 + signatures 双签（质量门禁 §9.3-②）
  // ══════════════════════════════════════════════════════════════

  async function getReportOrThrow(reportId: string): Promise<any> {
    const report = await db.inspectionReport.findUnique({ where: { id: reportId } });
    if (!report) throw new Error('验货报告不存在');
    return report;
  }

  async function getReport(reportId: string): Promise<any> {
    if (!reportId?.trim()) throw new Error('reportId 必填');
    return getReportOrThrow(reportId);
  }

  async function listReportsByOrder(orderId: string): Promise<{ items: any[]; total: number }> {
    if (!orderId?.trim()) throw new Error('orderId 必填');
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt !== null) throw new Error('订单不存在');
    const items = await db.inspectionReport.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return { items, total: items.length };
  }

  /**
   * 双签写入（§9.3-② 产前样双签：QC 签字 + 业务签字均非空才放行开裁）。
   *   - role=qc → signatures.qcSignedAt / qcSignerId
   *   - role=business → signatures.businessSignedAt / businessSignerId
   * 浅合并写入：保留 signatures 上既有键（含 DR-029 chain 命名空间），互不覆盖；
   * 同一角色重复签署 fail-closed 拒绝（签署留痕不可改写， REL-14-A2 审计链保护）。
   *
   * 业务签字身份约束（质量门禁规则 §2.2.1 / QCG-EXC-2 场景①）：
   *   business 侧仅限订单负责人（Order.ownerId）或订单归属部门主管（Department.headId）；
   *   QC 容器代签业务侧 → 403 PP_SIGN_BUSINESS_ROLE_REQUIRED（双签职责分离，fail-closed）。
   */
  async function signReport(reportId: string, role: ReportSignRole, actorId: string, ip?: string | null): Promise<any> {
    if (!reportId?.trim()) throw new Error('reportId 必填');
    if (role !== 'qc' && role !== 'business') {
      throw new Error('非法签署角色（允许 qc | business）');
    }
    const ts = now();
    const atField = role === 'qc' ? 'qcSignedAt' : 'businessSignedAt';
    const byField = role === 'qc' ? 'qcSignerId' : 'businessSignerId';

    return db.$transaction(async (tx: any) => {
      const report = await tx.inspectionReport.findUnique({ where: { id: reportId } });
      if (!report) throw new Error('验货报告不存在');
      const existing = (report.signatures && typeof report.signatures === 'object' ? report.signatures : {}) as Record<string, unknown>;
      if (existing[atField] != null) {
        throw new Error(`该报告 ${role === 'qc' ? 'QC' : '业务'}侧已签署，不可重复签署（签署留痕不可改写）`);
      }

      // QCG-EXC-2：business 侧签字身份 fail-closed（仅订单负责人 / 订单归属部门主管）
      if (role === 'business') {
        const order = report.orderId
          ? await tx.order.findUnique({ where: { id: report.orderId } })
          : null;
        const isOwner = !!order && order.ownerId === actorId;
        let isDeptHead = false;
        if (!isOwner && order?.departmentId) {
          const dept = await tx.department.findUnique({ where: { id: order.departmentId } });
          isDeptHead = !!dept && dept.headId === actorId;
        }
        if (!isOwner && !isDeptHead) {
          throw new Error('业务签字仅限订单负责人或部门主管（PP_SIGN_BUSINESS_ROLE_REQUIRED）');
        }
      }

      const next = { ...existing, [atField]: ts, [byField]: actorId };
      const updated = await tx.inspectionReport.update({
        where: { id: reportId },
        data: { signatures: next, updatedAt: BigInt(ts) },
      });
      await writeRouteAuditLog({
        prisma: tx,
        actorId: actorId || 'api',
        source: 'route:qc:reports:sign',
        operation: `inspection_report_sign_${role}`,
        targetType: 'InspectionReport',
        targetId: reportId,
        after: { id: reportId, orderId: report.orderId, role, [atField]: ts, [byField]: actorId },
        ip: ip ?? null,
        operationType: 'update',
        fieldPath: `signatures.${atField}`,
        beforeValue: null,
        afterValue: ts,
      });
      logger.info('[QcService] report signed', { reportId, role, actorId });
      return updated;
    });
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
    // DR-014 出运资格 / REL-14-A4 服装 Final QC / DR-027 开发样排除
    checkShipmentEligibility,
    checkGarmentShipmentEligibility,
    shouldExcludeFromQc,
    // 报告读取 + 双签
    getReport,
    listReportsByOrder,
    signReport,
  };
}

export type QcService = ReturnType<typeof createQcService>;
