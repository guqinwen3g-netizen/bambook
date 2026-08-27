/**
 * C3 HR 深化 — 员工全生命周期 / 考勤请假 / 薪资 / 绩效 / 培训 统一服务层
 *
 * 设计要点：
 *   1. EmployeeProfile 与 UserAccount 1:1，UserAccount 保持认证纯净，HR 业务字段全部落 Profile
 *   2. 生命周期事件（EmploymentEvent）是唯一状态变更入口：所有 employmentStatus / 岗位变动
 *      必须经 recordEmploymentEvent 写入历史流水，禁止直接改 Profile 状态字段
 *   3. 考勤每人每日一条（userId+date 唯一），upsert 语义；状态自动推导（迟到/早退）
 *   4. 请假状态机与退税审核同口径：Pending → Approved / Rejected / Cancelled
 *   5. 薪资结构变更留痕：新结构生效时旧结构 effectiveTo 自动封闭，当前生效恒为 effectiveTo=null
 *   6. 工资单批次状态机：Draft → Confirmed → Paid；仅 Draft 可生成/修改明细
 *   7. 绩效评定状态机：Draft → Submitted → Confirmed（自评→提交→主管终评）
 *   8. 事件发布：状态跃迁后 publishBusinessEvent（事务外、永不阻塞业务），
 *      EmployeeStatusChanged / LeaveRequestDecided 供通知引擎订阅
 */

import { PrismaClient } from '@prisma/client';
import { publishBusinessEvent } from '../events/businessEventBus';
import { logger } from '../lib/logger';

// ────────────────────────────────────────────────────────────────
// 常量与类型
// ────────────────────────────────────────────────────────────────

export const EMPLOYMENT_STATUSES = ['Probation', 'Regular', 'Suspended', 'Resigned', 'Terminated'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_EVENT_TYPES = [
  'Onboard', 'Regularize', 'Transfer', 'Promote', 'Suspend', 'Resume', 'Resign', 'Terminate',
] as const;
export type EmploymentEventType = (typeof EMPLOYMENT_EVENT_TYPES)[number];

export const ATTENDANCE_STATUSES = [
  'Normal', 'Late', 'EarlyLeave', 'LateAndEarly', 'Absent', 'Leave', 'Holiday', 'Overtime',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const LEAVE_TYPES = ['Annual', 'Sick', 'Personal', 'CompTime', 'Maternity', 'Other'] as const;
export const LEAVE_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'] as const;

export const CONTRACT_TYPES = ['FixedTerm', 'OpenEnded', 'PartTime', 'Intern'] as const;

export const REVIEW_GRADES = ['A', 'B', 'C', 'D'] as const;

/// C3d KPI 指标项 — 存入 PerformanceReview.kpi Json 字段
/// 设计真源：schema.prisma L1507「kpi Json 保持指标弹性」
/// 每项可关联 HR 项目（projectId 可选），实现剧本要求「KPI 表单 + 项目关联」
export interface KpiItem {
  id: string;
  name: string;
  target: string;
  weight: number;
  unit?: string;
  projectId?: string;
}

/**
 * 校验 KPI 指标列表 — 系统性根因校验（非特例补丁）：
 *  - 必须是数组（null/undefined 视为未设置，允许通过）
 *  - 每项 name 非空、weight 数值 0-100
 *  - sum(weight) <= 100（权重总和不超过满分）
 *  - projectId 可选，非空字符串才视为有效关联
 * 校验失败抛 HrError('VALIDATION_FAILED')
 */
function validateKpiItems(kpi: unknown): KpiItem[] | null {
  if (kpi === null || kpi === undefined) return null;
  if (!Array.isArray(kpi)) {
    throw new HrError('VALIDATION_FAILED', 'kpi 必须是数组');
  }
  let totalWeight = 0;
  const items: KpiItem[] = [];
  for (let i = 0; i < kpi.length; i++) {
    const item = kpi[i] as any;
    if (!item || typeof item !== 'object') {
      throw new HrError('VALIDATION_FAILED', `kpi[${i}] 必须是对象`);
    }
    const name = (item.name ?? '').toString().trim();
    if (!name) {
      throw new HrError('VALIDATION_FAILED', `kpi[${i}].name 必填`);
    }
    const weight = Number(item.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      throw new HrError('VALIDATION_FAILED', `kpi[${i}].weight 须在 0-100`);
    }
    totalWeight += weight;
    const target = (item.target ?? '').toString();
    const id = (item.id ?? '').toString() || `kpi_${i}_${Date.now().toString(36)}`;
    const unit = item.unit != null ? (item.unit as string).toString() : undefined;
    const projectId = item.projectId != null && (item.projectId as string).toString().trim()
      ? (item.projectId as string).toString().trim()
      : undefined;
    items.push({ id, name, target, weight, unit, projectId });
  }
  if (totalWeight > 100) {
    throw new HrError('VALIDATION_FAILED', `KPI 权重总和 ${totalWeight} 超过 100`);
  }
  return items;
}

/** 标准工作时间（考勤自动推导口径） */
export const WORK_START = '09:30';
export const WORK_END = '17:30';

/** 生命周期事件 → 目标状态映射（Transfer/Promote 不改状态） */
const EVENT_TARGET_STATUS: Partial<Record<EmploymentEventType, EmploymentStatus>> = {
  Onboard: 'Probation',
  Regularize: 'Regular',
  Suspend: 'Suspended',
  Resume: 'Regular',
  Resign: 'Resigned',
  Terminate: 'Terminated',
};

/** 事件允许的前置状态（undefined = 不限） */
const EVENT_ALLOWED_FROM: Partial<Record<EmploymentEventType, EmploymentStatus[]>> = {
  Regularize: ['Probation'],
  Transfer: ['Probation', 'Regular'],
  Promote: ['Probation', 'Regular'],
  Suspend: ['Probation', 'Regular'],
  Resume: ['Suspended'],
  Resign: ['Probation', 'Regular', 'Suspended'],
  Terminate: ['Probation', 'Regular', 'Suspended'],
};

export class HrError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ────────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertDate(s: unknown, field: string): asserts s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) throw new HrError('VALIDATION_FAILED', `${field} 须为 YYYY-MM-DD`);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 由打卡时间推导考勤状态（显式 status 优先，Absent/Leave/Holiday 等人工标记不被覆盖） */
function deriveAttendanceStatus(checkIn?: string | null, checkOut?: string | null, explicit?: string | null): AttendanceStatus {
  if (explicit && (ATTENDANCE_STATUSES as readonly string[]).includes(explicit)) return explicit as AttendanceStatus;
  const late = !!checkIn && TIME_RE.test(checkIn) && toMinutes(checkIn) > toMinutes(WORK_START);
  const early = !!checkOut && TIME_RE.test(checkOut) && toMinutes(checkOut) < toMinutes(WORK_END);
  if (late && early) return 'LateAndEarly';
  if (late) return 'Late';
  if (early) return 'EarlyLeave';
  return 'Normal';
}

function computeWorkHours(checkIn?: string | null, checkOut?: string | null): number | null {
  if (!checkIn || !checkOut || !TIME_RE.test(checkIn) || !TIME_RE.test(checkOut)) return null;
  const diff = toMinutes(checkOut) - toMinutes(checkIn);
  return diff > 0 ? Math.round((diff / 60) * 100) / 100 : null;
}

// ────────────────────────────────────────────────────────────────
// 服务主体
// ────────────────────────────────────────────────────────────────

export function createHrService(prisma: PrismaClient) {
  const db = prisma as any;

  // ════════════════════════════════════════════
  // C3a 员工档案
  // ════════════════════════════════════════════

  async function nextEmployeeNo(): Promise<string> {
    // P2002 重试兜底并发
    for (let attempt = 0; attempt < 5; attempt++) {
      const count = await db.employeeProfile.count();
      const candidate = `EMP${String(count + 1 + attempt).padStart(4, '0')}`;
      const clash = await db.employeeProfile.findUnique({ where: { employeeNo: candidate } });
      if (!clash) return candidate;
    }
    // 极端兜底：时间戳后缀
    return `EMP${Date.now().toString(36).toUpperCase()}`;
  }

  async function listProfiles(query: { status?: string; deptId?: string; q?: string } = {}) {
    const where: any = { deletedAt: null };
    if (query.status) where.employmentStatus = query.status;
    if (query.deptId) where.user = { primaryDeptId: query.deptId };
    const profiles = await db.employeeProfile.findMany({
      where,
      include: {
        user: { include: { primaryDepartment: true } },
        position: true,
      },
      orderBy: { employeeNo: 'asc' },
    });
    let rows = profiles.map(profileView);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter((r: any) =>
        r.displayName?.toLowerCase().includes(q) || r.employeeNo.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q));
    }
    return rows;
  }

  function profileView(p: any) {
    return {
      id: p.id,
      userId: p.userId,
      employeeNo: p.employeeNo,
      displayName: p.user?.displayName ?? null,
      email: p.user?.email ?? null,
      avatarUrl: p.user?.avatarUrl ?? null,
      departmentId: p.user?.primaryDeptId ?? null,
      department: p.user?.primaryDepartment?.name ?? null,
      positionId: p.positionId,
      position: p.position?.title ?? null,
      hireDate: p.hireDate,
      regularDate: p.regularDate,
      contractType: p.contractType,
      contractEnd: p.contractEnd,
      employmentStatus: p.employmentStatus,
      phone: p.phone,
      emergencyContact: p.emergencyContact,
      workLocation: p.workLocation,
      notes: p.notes,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  async function getProfile(userId: string) {
    const p = await db.employeeProfile.findUnique({
      where: { userId },
      include: { user: { include: { primaryDepartment: true } }, position: true },
    });
    if (!p || p.deletedAt) return null;
    return profileView(p);
  }

  async function upsertProfile(input: {
    userId: string;
    positionId?: string | null;
    hireDate?: string;
    regularDate?: string | null;
    contractType?: string | null;
    contractEnd?: string | null;
    employmentStatus?: string;
    phone?: string | null;
    emergencyContact?: string | null;
    workLocation?: string | null;
    notes?: string | null;
  }) {
    if (!input.userId) throw new HrError('VALIDATION_FAILED', 'userId 必填');
    const user = await db.userAccount.findUnique({ where: { id: input.userId } });
    if (!user) throw new HrError('USER_NOT_FOUND', `用户 ${input.userId} 不存在`);
    if (input.hireDate !== undefined) assertDate(input.hireDate, 'hireDate');
    if (input.regularDate) assertDate(input.regularDate, 'regularDate');
    if (input.contractEnd) assertDate(input.contractEnd, 'contractEnd');
    if (input.contractType && !(CONTRACT_TYPES as readonly string[]).includes(input.contractType)) {
      throw new HrError('VALIDATION_FAILED', `非法合同类型：${input.contractType}`);
    }
    // employmentStatus 不由此入口直接变更（须走生命周期事件），仅建档时允许指定初始状态
    const existing = await db.employeeProfile.findUnique({ where: { userId: input.userId } });
    if (existing && input.employmentStatus && input.employmentStatus !== existing.employmentStatus) {
      throw new HrError('STATUS_VIA_EVENT_ONLY', '在职状态变更必须经生命周期事件（recordEmploymentEvent）');
    }
    if (input.employmentStatus && !(EMPLOYMENT_STATUSES as readonly string[]).includes(input.employmentStatus)) {
      throw new HrError('VALIDATION_FAILED', `非法在职状态：${input.employmentStatus}`);
    }

    if (existing) {
      const updated = await db.employeeProfile.update({
        where: { userId: input.userId },
        data: {
          ...(input.positionId !== undefined && { positionId: input.positionId || null }),
          ...(input.hireDate !== undefined && { hireDate: input.hireDate }),
          ...(input.regularDate !== undefined && { regularDate: input.regularDate || null }),
          ...(input.contractType !== undefined && { contractType: input.contractType || null }),
          ...(input.contractEnd !== undefined && { contractEnd: input.contractEnd || null }),
          ...(input.phone !== undefined && { phone: input.phone || null }),
          ...(input.emergencyContact !== undefined && { emergencyContact: input.emergencyContact || null }),
          ...(input.workLocation !== undefined && { workLocation: input.workLocation || null }),
          ...(input.notes !== undefined && { notes: input.notes || null }),
        },
      });
      return { profile: updated, created: false };
    }

    if (!input.hireDate) throw new HrError('VALIDATION_FAILED', '建档必须提供 hireDate');
    const created = await db.employeeProfile.create({
      data: {
        id: genId('emp'),
        userId: input.userId,
        employeeNo: await nextEmployeeNo(),
        positionId: input.positionId || null,
        hireDate: input.hireDate,
        regularDate: input.regularDate || null,
        contractType: input.contractType || null,
        contractEnd: input.contractEnd || null,
        employmentStatus: input.employmentStatus || 'Probation',
        phone: input.phone || null,
        emergencyContact: input.emergencyContact || null,
        workLocation: input.workLocation || null,
        notes: input.notes || null,
      },
    });
    return { profile: created, created: true };
  }

  async function deleteProfile(userId: string) {
    await db.employeeProfile.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: BigInt(Date.now()) },
    });
    return { deleted: true };
  }

  // ════════════════════════════════════════════
  // C3a 生命周期事件（状态变更唯一入口）
  // ════════════════════════════════════════════

  async function recordEmploymentEvent(
    actorId: string,
    input: {
      userId: string;
      type: EmploymentEventType;
      effectiveDate: string;
      fromDeptId?: string | null;
      toDeptId?: string | null;
      fromPositionId?: string | null;
      toPositionId?: string | null;
      reason?: string | null;
    },
  ) {
    if (!(EMPLOYMENT_EVENT_TYPES as readonly string[]).includes(input.type)) {
      throw new HrError('VALIDATION_FAILED', `非法事件类型：${input.type}`);
    }
    assertDate(input.effectiveDate, 'effectiveDate');

    const user = await db.userAccount.findUnique({ where: { id: input.userId } });
    if (!user) throw new HrError('USER_NOT_FOUND', `用户 ${input.userId} 不存在`);

    let profile = await db.employeeProfile.findUnique({ where: { userId: input.userId } });

    // Onboard 允许无档案（自动建档）；其余事件必须有在职档案
    if (input.type === 'Onboard') {
      if (!profile || profile.deletedAt) {
        const { profile: created } = await upsertProfile({ userId: input.userId, hireDate: input.effectiveDate });
        profile = created;
      }
    } else {
      if (!profile || profile.deletedAt) throw new HrError('PROFILE_NOT_FOUND', `用户 ${input.userId} 无员工档案，请先 Onboard`);
      const allowed = EVENT_ALLOWED_FROM[input.type];
      if (allowed && !allowed.includes(profile.employmentStatus)) {
        throw new HrError('INVALID_TRANSITION', `${input.type} 不允许从 ${profile.employmentStatus} 发起`);
      }
      if (['Resigned', 'Terminated'].includes(profile.employmentStatus)) {
        throw new HrError('INVALID_TRANSITION', `员工已${profile.employmentStatus === 'Resigned' ? '离职' : '终止'}，不可再变更`);
      }
    }

    const event = await db.employmentEvent.create({
      data: {
        id: genId('evt'),
        userId: input.userId,
        type: input.type,
        effectiveDate: input.effectiveDate,
        fromDeptId: input.fromDeptId ?? null,
        toDeptId: input.toDeptId ?? null,
        fromPositionId: input.fromPositionId ?? null,
        toPositionId: input.toPositionId ?? null,
        reason: input.reason ?? null,
        operatorId: actorId,
      },
    });

    // 应用状态/岗位变动
    const targetStatus = EVENT_TARGET_STATUS[input.type];
    const profilePatch: any = {};
    if (targetStatus && profile.employmentStatus !== targetStatus) profilePatch.employmentStatus = targetStatus;
    if (input.type === 'Regularize') profilePatch.regularDate = input.effectiveDate;
    if ((input.type === 'Transfer' || input.type === 'Promote') && input.toPositionId !== undefined && input.toPositionId !== null) {
      profilePatch.positionId = input.toPositionId;
    }
    if (Object.keys(profilePatch).length > 0) {
      await db.employeeProfile.update({ where: { userId: input.userId }, data: profilePatch });
    }
    // 部门异动落 UserAccount.primaryDeptId
    if (input.toDeptId) {
      await db.userAccount.update({ where: { id: input.userId }, data: { primaryDeptId: input.toDeptId } });
    }

    // 事件发布（事务外，fire-and-forget）
    publishBusinessEvent({
      type: 'EmployeeStatusChanged',
      sourceEntityType: 'EmployeeProfile',
      sourceEntityId: profile.id,
      payload: {
        userId: input.userId,
        displayName: user.displayName,
        eventType: input.type,
        effectiveDate: input.effectiveDate,
        fromStatus: profile.employmentStatus,
        toStatus: targetStatus ?? profile.employmentStatus,
        reason: input.reason ?? null,
      },
      actorId,
    }).catch(e => logger.warn('[HrService] publish EmployeeStatusChanged failed', { error: e?.message }));

    return { event };
  }

  async function listEmploymentEvents(query: { userId?: string; type?: string; limit?: number } = {}) {
    const where: any = {};
    if (query.userId) where.userId = query.userId;
    if (query.type) where.type = query.type;
    return db.employmentEvent.findMany({
      where,
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(query.limit ?? 200, 500),
    });
  }

  // ════════════════════════════════════════════
  // C3b 考勤
  // ════════════════════════════════════════════

  async function upsertAttendance(input: {
    userId: string;
    date: string;
    checkIn?: string | null;
    checkOut?: string | null;
    status?: string | null;
    note?: string | null;
  }) {
    if (!input.userId) throw new HrError('VALIDATION_FAILED', 'userId 必填');
    assertDate(input.date, 'date');
    if (input.checkIn && !TIME_RE.test(input.checkIn)) throw new HrError('VALIDATION_FAILED', 'checkIn 须为 HH:MM');
    if (input.checkOut && !TIME_RE.test(input.checkOut)) throw new HrError('VALIDATION_FAILED', 'checkOut 须为 HH:MM');

    const status = deriveAttendanceStatus(input.checkIn, input.checkOut, input.status);
    const workHours = computeWorkHours(input.checkIn, input.checkOut);

    const record = await db.attendanceRecord.upsert({
      where: { userId_date: { userId: input.userId, date: input.date } },
      create: {
        id: genId('att'),
        userId: input.userId,
        date: input.date,
        checkIn: input.checkIn ?? null,
        checkOut: input.checkOut ?? null,
        status,
        workHours,
        note: input.note ?? null,
      },
      update: {
        ...(input.checkIn !== undefined && { checkIn: input.checkIn }),
        ...(input.checkOut !== undefined && { checkOut: input.checkOut }),
        status,
        workHours,
        ...(input.note !== undefined && { note: input.note }),
      },
    });
    return { record };
  }

  async function listAttendance(query: { userId?: string; month?: string; date?: string; status?: string } = {}) {
    const where: any = {};
    if (query.userId) where.userId = query.userId;
    if (query.month) {
      if (!/^\d{4}-\d{2}$/.test(query.month)) throw new HrError('VALIDATION_FAILED', 'month 须为 YYYY-MM');
      where.date = { startsWith: query.month };
    }
    if (query.date) where.date = query.date;
    if (query.status) where.status = query.status;
    const rows = await db.attendanceRecord.findMany({ where, orderBy: [{ date: 'desc' }, { userId: 'asc' }] });
    // 补充员工姓名
    const userIds = [...new Set(rows.map((r: any) => r.userId))] as string[];
    const users = await db.userAccount.findMany({ where: { id: { in: userIds } } });
    const nameOf = new Map(users.map((u: any) => [u.id, u.displayName]));
    return rows.map((r: any) => ({ ...r, displayName: nameOf.get(r.userId) ?? null }));
  }

  /** 月度考勤汇总：按人统计各状态天数 + 总工时 */
  async function attendanceSummary(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HrError('VALIDATION_FAILED', 'month 须为 YYYY-MM');
    const rows = await db.attendanceRecord.findMany({ where: { date: { startsWith: month } } });
    const byUser = new Map<string, any>();
    for (const r of rows) {
      const agg = byUser.get(r.userId) ?? { userId: r.userId, days: 0, late: 0, earlyLeave: 0, absent: 0, leave: 0, overtime: 0, workHours: 0 };
      agg.days += 1;
      if (r.status === 'Late' || r.status === 'LateAndEarly') agg.late += 1;
      if (r.status === 'EarlyLeave' || r.status === 'LateAndEarly') agg.earlyLeave += 1;
      if (r.status === 'Absent') agg.absent += 1;
      if (r.status === 'Leave') agg.leave += 1;
      if (r.status === 'Overtime') agg.overtime += 1;
      agg.workHours += r.workHours ?? 0;
      byUser.set(r.userId, agg);
    }
    const userIds = [...byUser.keys()];
    const users = await db.userAccount.findMany({ where: { id: { in: userIds } } });
    const nameOf = new Map(users.map((u: any) => [u.id, u.displayName]));
    return [...byUser.values()].map(a => ({
      ...a,
      workHours: Math.round(a.workHours * 100) / 100,
      displayName: nameOf.get(a.userId) ?? null,
    }));
  }

  // ════════════════════════════════════════════
  // C3b 请假（Pending → Approved / Rejected / Cancelled）
  // ════════════════════════════════════════════

  async function createLeaveRequest(input: {
    userId: string;
    type: string;
    startDate: string;
    endDate: string;
    days: number;
    reason?: string | null;
  }) {
    if (!input.userId) throw new HrError('VALIDATION_FAILED', 'userId 必填');
    if (!(LEAVE_TYPES as readonly string[]).includes(input.type)) throw new HrError('VALIDATION_FAILED', `非法请假类型：${input.type}`);
    assertDate(input.startDate, 'startDate');
    assertDate(input.endDate, 'endDate');
    if (input.endDate < input.startDate) throw new HrError('VALIDATION_FAILED', 'endDate 不得早于 startDate');
    if (!Number.isFinite(input.days) || input.days <= 0) throw new HrError('VALIDATION_FAILED', 'days 须为正数');

    const request = await db.leaveRequest.create({
      data: {
        id: genId('leave'),
        userId: input.userId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        days: input.days,
        reason: input.reason ?? null,
        status: 'Pending',
      },
    });
    return { request };
  }

  async function decideLeaveRequest(actorId: string, id: string, decision: 'Approved' | 'Rejected', rejectReason?: string | null) {
    const req = await db.leaveRequest.findUnique({ where: { id } });
    if (!req || req.deletedAt) throw new HrError('LEAVE_NOT_FOUND', `请假单 ${id} 不存在`);
    if (req.status !== 'Pending') throw new HrError('INVALID_TRANSITION', `请假单当前状态 ${req.status}，不可审批`);
    if (decision === 'Rejected' && !rejectReason?.trim()) throw new HrError('VALIDATION_FAILED', '驳回必须填写理由');

    const updated = await db.leaveRequest.update({
      where: { id },
      data: {
        status: decision,
        approverId: actorId,
        approvedAt: new Date(),
        rejectReason: decision === 'Rejected' ? rejectReason!.trim() : null,
      },
    });

    // 审批通过 → 请假期间考勤自动标记 Leave（幂等：upsert 显式 status）
    if (decision === 'Approved') {
      const days = enumerateDates(req.startDate, req.endDate);
      for (const date of days) {
        await upsertAttendance({ userId: req.userId, date, status: 'Leave', note: `请假单 ${req.id}` });
      }
    }

    publishBusinessEvent({
      type: 'LeaveRequestDecided',
      sourceEntityType: 'LeaveRequest',
      sourceEntityId: id,
      payload: {
        userId: req.userId,
        leaveType: req.type,
        startDate: req.startDate,
        endDate: req.endDate,
        days: req.days,
        decision,
        rejectReason: decision === 'Rejected' ? rejectReason!.trim() : null,
      },
      actorId,
    }).catch(e => logger.warn('[HrService] publish LeaveRequestDecided failed', { error: e?.message }));

    return { request: updated };
  }

  async function cancelLeaveRequest(id: string) {
    const req = await db.leaveRequest.findUnique({ where: { id } });
    if (!req || req.deletedAt) throw new HrError('LEAVE_NOT_FOUND', `请假单 ${id} 不存在`);
    if (req.status !== 'Pending') throw new HrError('INVALID_TRANSITION', `仅 Pending 状态可撤销（当前 ${req.status}）`);
    const updated = await db.leaveRequest.update({ where: { id }, data: { status: 'Cancelled' } });
    return { request: updated };
  }

  async function listLeaveRequests(query: { userId?: string; status?: string } = {}) {
    const where: any = { deletedAt: null };
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    const rows = await db.leaveRequest.findMany({ where, orderBy: { createdAt: 'desc' } });
    const userIds = [...new Set(rows.flatMap((r: any) => [r.userId, r.approverId]).filter(Boolean))] as string[];
    const users = await db.userAccount.findMany({ where: { id: { in: userIds } } });
    const nameOf = new Map(users.map((u: any) => [u.id, u.displayName]));
    return rows.map((r: any) => ({
      ...r,
      displayName: nameOf.get(r.userId) ?? null,
      approverName: r.approverId ? nameOf.get(r.approverId) ?? null : null,
    }));
  }

  function enumerateDates(start: string, end: string): string[] {
    const out: string[] = [];
    const cur = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    let guard = 0;
    while (cur <= last && guard < 370) {
      out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
      cur.setDate(cur.getDate() + 1);
      guard += 1;
    }
    return out;
  }

  // ════════════════════════════════════════════
  // C3c 薪资结构与工资单
  // ════════════════════════════════════════════

  /** 设定薪资结构：封闭当前生效区间，写入新区间 */
  async function setSalaryStructure(input: {
    userId: string;
    baseSalary: number;
    positionAllowance?: number;
    currency?: string;
    effectiveFrom: string;
    note?: string | null;
  }) {
    if (!input.userId) throw new HrError('VALIDATION_FAILED', 'userId 必填');
    if (!Number.isFinite(input.baseSalary) || input.baseSalary < 0) throw new HrError('VALIDATION_FAILED', 'baseSalary 非法');
    assertDate(input.effectiveFrom, 'effectiveFrom');

    const current = await db.salaryStructure.findFirst({
      where: { userId: input.userId, effectiveTo: null },
    });
    if (current && input.effectiveFrom <= current.effectiveFrom) {
      throw new HrError('VALIDATION_FAILED', `effectiveFrom 必须晚于当前生效起点 ${current.effectiveFrom}`);
    }

    const [, created] = await prisma.$transaction([
      db.salaryStructure.updateMany({
        where: { userId: input.userId, effectiveTo: null },
        data: { effectiveTo: input.effectiveFrom },
      }),
      db.salaryStructure.create({
        data: {
          id: genId('sal'),
          userId: input.userId,
          baseSalary: input.baseSalary,
          positionAllowance: input.positionAllowance ?? 0,
          currency: input.currency ?? 'CNY',
          effectiveFrom: input.effectiveFrom,
          effectiveTo: null,
          note: input.note ?? null,
        },
      }),
    ]);
    return { structure: created, previousClosed: !!current };
  }

  async function getSalaryHistory(userId: string) {
    return db.salaryStructure.findMany({ where: { userId }, orderBy: { effectiveFrom: 'desc' } });
  }

  async function createPayrollRun(period: string, note?: string | null) {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new HrError('VALIDATION_FAILED', 'period 须为 YYYY-MM');
    const existing = await db.payrollRun.findUnique({ where: { period } });
    if (existing) throw new HrError('DUPLICATE_PERIOD', `期间 ${period} 工资单已存在（${existing.status}）`);
    const run = await db.payrollRun.create({
      data: { id: genId('payrun'), period, note: note ?? null },
    });
    return { run };
  }

  /** 按当前生效薪资结构生成明细（仅 Draft；已存在明细的人员跳过 → 幂等） */
  async function generatePayrollItems(runId: string) {
    const run = await db.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new HrError('RUN_NOT_FOUND', `工资单 ${runId} 不存在`);
    if (run.status !== 'Draft') throw new HrError('INVALID_TRANSITION', `仅 Draft 状态可生成明细（当前 ${run.status}）`);

    const profiles = await db.employeeProfile.findMany({
      where: { deletedAt: null, employmentStatus: { in: ['Probation', 'Regular', 'Suspended'] } },
    });
    let generated = 0;
    for (const p of profiles) {
      const structure = await db.salaryStructure.findFirst({ where: { userId: p.userId, effectiveTo: null } });
      if (!structure) continue; // 无薪资结构者不进入工资单
      const base = structure.baseSalary;
      const allowance = structure.positionAllowance ?? 0;
      const net = Math.round((base + allowance) * 100) / 100;
      try {
        await db.payrollItem.create({
          data: {
            id: genId('payitem'),
            runId,
            userId: p.userId,
            base,
            allowance,
            net,
          },
        });
        generated += 1;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // 已生成 → 跳过（幂等）
      }
    }
    const totals = await recalcRunTotals(runId);
    return { generated, ...totals };
  }

  async function recalcRunTotals(runId: string) {
    const items = await db.payrollItem.findMany({ where: { runId } });
    const totalNet = Math.round(items.reduce((s: number, i: any) => s + (i.net ?? 0), 0) * 100) / 100;
    await db.payrollRun.update({ where: { id: runId }, data: { totalNet, headcount: items.length } });
    return { totalNet, headcount: items.length };
  }

  /** 调整明细（仅 Draft）；net 缺省自动重算 */
  async function updatePayrollItem(itemId: string, patch: {
    overtimePay?: number; commission?: number; bonus?: number; deduction?: number; note?: string | null;
  }) {
    const item = await db.payrollItem.findUnique({ where: { id: itemId }, include: { run: true } });
    if (!item) throw new HrError('ITEM_NOT_FOUND', `明细 ${itemId} 不存在`);
    if (item.run.status !== 'Draft') throw new HrError('INVALID_TRANSITION', `工资单已 ${item.run.status}，明细不可修改`);

    const merged = {
      overtimePay: patch.overtimePay ?? item.overtimePay,
      commission: patch.commission ?? item.commission,
      bonus: patch.bonus ?? item.bonus,
      deduction: patch.deduction ?? item.deduction,
    };
    const net = Math.round((item.base + item.allowance + merged.overtimePay + merged.commission + merged.bonus - merged.deduction) * 100) / 100;
    const updated = await db.payrollItem.update({
      where: { id: itemId },
      data: { ...merged, net, ...(patch.note !== undefined && { note: patch.note }) },
    });
    await recalcRunTotals(item.runId);
    return { item: updated };
  }

  async function confirmPayrollRun(runId: string) {
    const run = await db.payrollRun.findUnique({ where: { id: runId }, include: { items: true } });
    if (!run) throw new HrError('RUN_NOT_FOUND', `工资单 ${runId} 不存在`);
    if (run.status !== 'Draft') throw new HrError('INVALID_TRANSITION', `仅 Draft 可确认（当前 ${run.status}）`);
    if (run.items.length === 0) throw new HrError('VALIDATION_FAILED', '空工资单不可确认，请先生成明细');
    const updated = await db.payrollRun.update({
      where: { id: runId },
      data: { status: 'Confirmed', confirmedAt: new Date() },
    });
    return { run: updated };
  }

  async function markPayrollPaid(runId: string) {
    const run = await db.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new HrError('RUN_NOT_FOUND', `工资单 ${runId} 不存在`);
    if (run.status !== 'Confirmed') throw new HrError('INVALID_TRANSITION', `仅 Confirmed 可标记发放（当前 ${run.status}）`);
    const updated = await db.payrollRun.update({
      where: { id: runId },
      data: { status: 'Paid', paidAt: new Date() },
    });
    return { run: updated };
  }

  async function listPayrollRuns() {
    return db.payrollRun.findMany({ orderBy: { period: 'desc' } });
  }

  async function getPayrollRun(runId: string) {
    const run = await db.payrollRun.findUnique({ where: { id: runId }, include: { items: true } });
    if (!run) return null;
    const userIds = [...new Set(run.items.map((i: any) => i.userId))] as string[];
    const [users, profiles] = await Promise.all([
      db.userAccount.findMany({ where: { id: { in: userIds } } }),
      db.employeeProfile.findMany({ where: { userId: { in: userIds } } }),
    ]);
    const nameOf = new Map(users.map((u: any) => [u.id, u.displayName]));
    const empNoOf = new Map(profiles.map((p: any) => [p.userId, p.employeeNo]));
    return {
      ...run,
      items: run.items.map((i: any) => ({
        ...i,
        displayName: nameOf.get(i.userId) ?? null,
        employeeNo: empNoOf.get(i.userId) ?? null,
      })),
    };
  }

  // ════════════════════════════════════════════
  // C3d 绩效
  // ════════════════════════════════════════════

  async function createPerformanceCycle(input: { name: string; period: string; startDate?: string | null; endDate?: string | null }) {
    if (!input.name?.trim()) throw new HrError('VALIDATION_FAILED', 'name 必填');
    if (!input.period?.trim()) throw new HrError('VALIDATION_FAILED', 'period 必填');
    if (input.startDate) assertDate(input.startDate, 'startDate');
    if (input.endDate) assertDate(input.endDate, 'endDate');
    const existing = await db.performanceCycle.findUnique({ where: { period: input.period.trim() } });
    if (existing) throw new HrError('DUPLICATE_PERIOD', `考核期间 ${input.period} 已存在`);
    const cycle = await db.performanceCycle.create({
      data: {
        id: genId('cycle'),
        name: input.name.trim(),
        period: input.period.trim(),
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      },
    });
    return { cycle };
  }

  async function closePerformanceCycle(cycleId: string) {
    const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) throw new HrError('CYCLE_NOT_FOUND', `考核周期 ${cycleId} 不存在`);
    if (cycle.status !== 'Open') throw new HrError('INVALID_TRANSITION', `周期已 ${cycle.status}`);
    const updated = await db.performanceCycle.update({ where: { id: cycleId }, data: { status: 'Closed' } });
    return { cycle: updated };
  }

  async function listPerformanceCycles() {
    const cycles = await db.performanceCycle.findMany({
      orderBy: { period: 'desc' },
      include: { reviews: true },
    });
    return cycles.map((c: any) => ({
      ...c,
      reviewCount: c.reviews.length,
      confirmedCount: c.reviews.filter((r: any) => r.status === 'Confirmed').length,
      reviews: undefined,
    }));
  }

  /** 录入/更新评定（自评阶段）：upsert by (cycleId,userId)，仅 Draft 可改；kpi 数组结构化校验 */
  async function upsertPerformanceReview(input: {
    cycleId: string;
    userId: string;
    selfScore?: number | null;
    kpi?: KpiItem[] | null;
    comment?: string | null;
    reviewerId?: string | null;
  }) {
    const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId } });
    if (!cycle) throw new HrError('CYCLE_NOT_FOUND', `考核周期 ${input.cycleId} 不存在`);
    if (cycle.status !== 'Open') throw new HrError('INVALID_TRANSITION', `周期已关闭，不可录入`);
    if (input.selfScore !== undefined && input.selfScore !== null && (input.selfScore < 0 || input.selfScore > 100)) {
      throw new HrError('VALIDATION_FAILED', '评分须在 0-100');
    }
    // KPI 列表结构化校验：name 非空、weight 0-100、sum(weight)<=100、projectId 可选
    const validatedKpi = input.kpi !== undefined ? validateKpiItems(input.kpi) : undefined;

    const existing = await db.performanceReview.findUnique({
      where: { cycleId_userId: { cycleId: input.cycleId, userId: input.userId } },
    });
    if (existing && existing.status !== 'Draft') {
      throw new HrError('INVALID_TRANSITION', `评定已 ${existing.status}，不可修改自评`);
    }
    const data: any = {
      ...(input.selfScore !== undefined && { selfScore: input.selfScore }),
      ...(validatedKpi !== undefined && { kpi: validatedKpi }),
      ...(input.comment !== undefined && { comment: input.comment }),
      ...(input.reviewerId !== undefined && { reviewerId: input.reviewerId }),
    };
    const review = existing
      ? await db.performanceReview.update({ where: { id: existing.id }, data })
      : await db.performanceReview.create({
          data: { id: genId('review'), cycleId: input.cycleId, userId: input.userId, ...data },
        });
    return { review };
  }

  async function submitPerformanceReview(reviewId: string) {
    const review = await db.performanceReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new HrError('REVIEW_NOT_FOUND', `评定 ${reviewId} 不存在`);
    if (review.status !== 'Draft') throw new HrError('INVALID_TRANSITION', `仅 Draft 可提交（当前 ${review.status}）`);
    const updated = await db.performanceReview.update({ where: { id: reviewId }, data: { status: 'Submitted' } });
    return { review: updated };
  }

  /** 主管终评：Submitted → Confirmed，写入 managerScore/finalScore/grade */
  async function confirmPerformanceReview(reviewId: string, input: {
    managerScore: number; finalScore: number; grade: string; comment?: string | null; reviewerId?: string | null;
  }) {
    const review = await db.performanceReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new HrError('REVIEW_NOT_FOUND', `评定 ${reviewId} 不存在`);
    if (review.status !== 'Submitted') throw new HrError('INVALID_TRANSITION', `仅 Submitted 可终评（当前 ${review.status}）`);
    for (const [k, v] of [['managerScore', input.managerScore], ['finalScore', input.finalScore]] as const) {
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new HrError('VALIDATION_FAILED', `${k} 须在 0-100`);
    }
    if (!(REVIEW_GRADES as readonly string[]).includes(input.grade)) throw new HrError('VALIDATION_FAILED', `非法评级：${input.grade}`);
    const updated = await db.performanceReview.update({
      where: { id: reviewId },
      data: {
        status: 'Confirmed',
        managerScore: input.managerScore,
        finalScore: input.finalScore,
        grade: input.grade,
        ...(input.comment !== undefined && { comment: input.comment }),
        ...(input.reviewerId !== undefined && { reviewerId: input.reviewerId }),
      },
    });
    return { review: updated };
  }

  async function listPerformanceReviews(query: { cycleId?: string; userId?: string; status?: string } = {}) {
    const where: any = {};
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    const rows = await db.performanceReview.findMany({ where, orderBy: { createdAt: 'desc' } });
    const userIds = [...new Set(rows.flatMap((r: any) => [r.userId, r.reviewerId]).filter(Boolean))] as string[];
    const users = await db.userAccount.findMany({ where: { id: { in: userIds } } });
    const nameOf = new Map(users.map((u: any) => [u.id, u.displayName]));
    return rows.map((r: any) => ({
      ...r,
      displayName: nameOf.get(r.userId) ?? null,
      reviewerName: r.reviewerId ? nameOf.get(r.reviewerId) ?? null : null,
    }));
  }

  // ════════════════════════════════════════════
  // C3e 培训
  // ════════════════════════════════════════════

  async function createTrainingCourse(input: {
    title: string; type?: string; instructor?: string | null;
    startDate?: string | null; endDate?: string | null; capacity?: number | null; description?: string | null;
  }) {
    if (!input.title?.trim()) throw new HrError('VALIDATION_FAILED', 'title 必填');
    if (input.startDate) assertDate(input.startDate, 'startDate');
    if (input.endDate) assertDate(input.endDate, 'endDate');
    if (input.type && !['Internal', 'External'].includes(input.type)) throw new HrError('VALIDATION_FAILED', `非法课程类型：${input.type}`);
    const course = await db.trainingCourse.create({
      data: {
        id: genId('course'),
        title: input.title.trim(),
        type: input.type ?? 'Internal',
        instructor: input.instructor ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        capacity: input.capacity ?? null,
        description: input.description ?? null,
      },
    });
    return { course };
  }

  async function updateTrainingCourse(id: string, patch: {
    title?: string; type?: string; instructor?: string | null; startDate?: string | null;
    endDate?: string | null; capacity?: number | null; status?: string; description?: string | null;
  }) {
    const course = await db.trainingCourse.findUnique({ where: { id } });
    if (!course || course.deletedAt) throw new HrError('COURSE_NOT_FOUND', `课程 ${id} 不存在`);
    if (patch.status && !['Planned', 'Ongoing', 'Completed', 'Cancelled'].includes(patch.status)) {
      throw new HrError('VALIDATION_FAILED', `非法课程状态：${patch.status}`);
    }
    const updated = await db.trainingCourse.update({
      where: { id },
      data: {
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.type !== undefined && { type: patch.type }),
        ...(patch.instructor !== undefined && { instructor: patch.instructor }),
        ...(patch.startDate !== undefined && { startDate: patch.startDate }),
        ...(patch.endDate !== undefined && { endDate: patch.endDate }),
        ...(patch.capacity !== undefined && { capacity: patch.capacity }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.description !== undefined && { description: patch.description }),
      },
    });
    return { course: updated };
  }

  async function deleteTrainingCourse(id: string) {
    await db.trainingCourse.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: BigInt(Date.now()) } });
    return { deleted: true };
  }

  async function listTrainingCourses(query: { status?: string } = {}) {
    const where: any = { deletedAt: null };
    if (query.status) where.status = query.status;
    const courses = await db.trainingCourse.findMany({
      where,
      include: { enrollments: true },
      orderBy: { createdAt: 'desc' },
    });
    return courses.map((c: any) => ({
      ...c,
      enrolledCount: c.enrollments.filter((e: any) => e.status === 'Enrolled' || e.status === 'Completed').length,
      completedCount: c.enrollments.filter((e: any) => e.status === 'Completed').length,
      enrollments: undefined,
    }));
  }

  async function enrollTraining(courseId: string, userId: string) {
    const course = await db.trainingCourse.findUnique({ where: { id: courseId }, include: { enrollments: true } });
    if (!course || course.deletedAt) throw new HrError('COURSE_NOT_FOUND', `课程 ${courseId} 不存在`);
    if (!['Planned', 'Ongoing'].includes(course.status)) throw new HrError('INVALID_TRANSITION', `课程已 ${course.status}，不可报名`);
    // 重复报名优先于容量检查（语义更准确：先告知"已报名"而非"名额已满"）
    if (course.enrollments.some((e: any) => e.userId === userId)) {
      throw new HrError('DUPLICATE_ENROLLMENT', '该员工已报名此课程');
    }
    const active = course.enrollments.filter((e: any) => e.status === 'Enrolled' || e.status === 'Completed');
    if (course.capacity != null && active.length >= course.capacity) {
      throw new HrError('CAPACITY_FULL', `课程名额已满（${course.capacity}）`);
    }
    try {
      const enrollment = await db.trainingEnrollment.create({
        data: { id: genId('enroll'), courseId, userId },
      });
      return { enrollment };
    } catch (e: any) {
      if (e?.code === 'P2002') throw new HrError('DUPLICATE_ENROLLMENT', '该员工已报名此课程');
      throw e;
    }
  }

  async function updateEnrollment(enrollmentId: string, patch: { status?: string; score?: number | null; certificate?: string | null }) {
    const enrollment = await db.trainingEnrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) throw new HrError('ENROLLMENT_NOT_FOUND', `报名记录 ${enrollmentId} 不存在`);
    if (patch.status && !['Enrolled', 'Completed', 'Absent', 'Cancelled'].includes(patch.status)) {
      throw new HrError('VALIDATION_FAILED', `非法报名状态：${patch.status}`);
    }
    if (patch.score !== undefined && patch.score !== null && (patch.score < 0 || patch.score > 100)) {
      throw new HrError('VALIDATION_FAILED', '成绩须在 0-100');
    }
    const updated = await db.trainingEnrollment.update({
      where: { id: enrollmentId },
      data: {
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.score !== undefined && { score: patch.score }),
        ...(patch.certificate !== undefined && { certificate: patch.certificate }),
      },
    });
    return { enrollment: updated };
  }

  async function listEnrollments(query: { courseId?: string; userId?: string } = {}) {
    const where: any = {};
    if (query.courseId) where.courseId = query.courseId;
    if (query.userId) where.userId = query.userId;
    const rows = await db.trainingEnrollment.findMany({ where, orderBy: { createdAt: 'desc' } });
    const userIds = [...new Set(rows.map((r: any) => r.userId))] as string[];
    const users = await db.userAccount.findMany({ where: { id: { in: userIds } } });
    const nameOf = new Map(users.map((u: any) => [u.id, u.displayName]));
    return rows.map((r: any) => ({ ...r, displayName: nameOf.get(r.userId) ?? null }));
  }

  return {
    // C3a
    listProfiles, getProfile, upsertProfile, deleteProfile,
    recordEmploymentEvent, listEmploymentEvents,
    // C3b
    upsertAttendance, listAttendance, attendanceSummary,
    createLeaveRequest, decideLeaveRequest, cancelLeaveRequest, listLeaveRequests,
    // C3c
    setSalaryStructure, getSalaryHistory,
    createPayrollRun, generatePayrollItems, updatePayrollItem,
    confirmPayrollRun, markPayrollPaid, listPayrollRuns, getPayrollRun,
    // C3d
    createPerformanceCycle, closePerformanceCycle, listPerformanceCycles,
    upsertPerformanceReview, submitPerformanceReview, confirmPerformanceReview, listPerformanceReviews,
    // C3e
    createTrainingCourse, updateTrainingCourse, deleteTrainingCourse, listTrainingCourses,
    enrollTraining, updateEnrollment, listEnrollments,
  };
}

export type HrService = ReturnType<typeof createHrService>;
