import { describe, expect, it, beforeEach } from 'vitest';
import { createHrService, HrError } from '../hrService';

/**
 * C3 HR 深化 — hrService 单元测试
 *
 * Mock Prisma：通用内存表（按表声明唯一键，冲突抛 P2002，与真实 Prisma 同口径）。
 * 覆盖五个子域的核心状态机与业务规则：
 *   C3a 档案 + 生命周期事件（状态唯一入口 / 非法跃迁拦截）
 *   C3b 考勤 upsert 幂等 + 状态自动推导；请假状态机 + 批准后考勤联动
 *   C3c 薪资区间封闭；工资单 Draft→Confirmed→Paid + 明细幂等生成
 *   C3d 绩效周期 + 评定 Draft→Submitted→Confirmed
 *   C3e 培训课程容量 / 重复报名拦截
 */

type Row = Record<string, any>;

function makeTable(uniqueKeys: string[][] = [], defaults: Row = {}) {
  const rows: Row[] = [];
  const withDefaults = (data: Row): Row => {
    const row: Row = { ...defaults, ...data };
    for (const [k, v] of Object.entries(defaults)) {
      if (row[k] === undefined) row[k] = v;
    }
    return row;
  };

  // Prisma 可空列读出恒为 null（不存在 undefined），mock 统一规整
  const matchWhere = (row: Row, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      const val = row[k] ?? null;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const cond: any = v;
        if ('not' in cond) return cond.not === null ? val !== null : val !== cond.not;
        if ('in' in cond) return cond.in.includes(val);
        if ('notIn' in cond) return !cond.notIn.includes(val);
        if ('startsWith' in cond) return typeof val === 'string' && val.startsWith(cond.startsWith);
        // 复合唯一键 where（如 userId_date: {userId, date}）
        return Object.entries(cond).every(([ck, cv]) => (row[ck] ?? null) === cv);
      }
      return val === v;
    });

  const checkUnique = (data: Row, excludeId?: string) => {
    for (const key of uniqueKeys) {
      const clash = rows.some(r =>
        (excludeId === undefined || r.id !== excludeId) &&
        key.every(f => r[f] === data[f]));
      if (clash) {
        const err: any = new Error(`Unique constraint failed on the fields: (${key.join(',')})`);
        err.code = 'P2002';
        throw err;
      }
    }
  };

  const table: any = {
    _rows: rows,
    count: async () => rows.length,
    findUnique: async ({ where }: any) => rows.find(r => matchWhere(r, where)) || null,
    findFirst: async ({ where }: any = {}) => rows.find(r => matchWhere(r, where)) || null,
    findMany: async ({ where }: any = {}) => rows.filter(r => matchWhere(r, where)),
    create: async ({ data }: any) => {
      checkUnique(data);
      const row = withDefaults(data);
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find(r => matchWhere(r, where));
      if (!row) throw new Error('Record not found');
      checkUnique({ ...row, ...data }, row.id);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const targets = rows.filter(r => matchWhere(r, where));
      targets.forEach(r => Object.assign(r, data));
      return { count: targets.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = rows.find(r => matchWhere(r, where));
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      checkUnique(create);
      const row = withDefaults(create);
      rows.push(row);
      return row;
    },
  };
  return table;
}

function makeMockPrisma() {
  const tables: Record<string, any> = {
    userAccount: makeTable([['id'], ['email']]),
    employeeProfile: makeTable([['id'], ['userId'], ['employeeNo']], { employmentStatus: 'Probation' }),
    employmentEvent: makeTable([['id']]),
    attendanceRecord: makeTable([['id'], ['userId', 'date']], { status: 'Normal' }),
    leaveRequest: makeTable([['id']], { status: 'Pending' }),
    salaryStructure: makeTable([['id']], { positionAllowance: 0, currency: 'CNY', effectiveTo: null }),
    payrollRun: makeTable([['id'], ['period']], { status: 'Draft', totalNet: 0, headcount: 0 }),
    payrollItem: makeTable([['id'], ['runId', 'userId']], { base: 0, allowance: 0, overtimePay: 0, commission: 0, bonus: 0, deduction: 0, net: 0 }),
    performanceCycle: makeTable([['id'], ['period']], { status: 'Open' }),
    performanceReview: makeTable([['id'], ['cycleId', 'userId']], { status: 'Draft' }),
    trainingCourse: makeTable([['id']], { status: 'Planned', type: 'Internal', deletedAt: null }),
    trainingEnrollment: makeTable([['id'], ['courseId', 'userId']], { status: 'Enrolled' }),
  };

  // include 关联仿真（仅覆盖 service 用到的三个关联）
  const attach = (row: any, include: any) => {
    if (!row || !include) return row;
    const out = { ...row };
    if (include.enrollments) {
      out.enrollments = tables.trainingEnrollment._rows.filter((e: any) => e.courseId === row.id);
    }
    if (include.items) {
      out.items = tables.payrollItem._rows.filter((i: any) => i.runId === row.id);
    }
    if (include.reviews) {
      out.reviews = tables.performanceReview._rows.filter((r: any) => r.cycleId === row.id);
    }
    if (include.run) {
      out.run = tables.payrollRun._rows.find((r: any) => r.id === row.runId) ?? null;
    }
    return out;
  };
  for (const name of ['trainingCourse', 'payrollRun', 'performanceCycle', 'payrollItem']) {
    const t = tables[name];
    const origFindUnique = t.findUnique;
    const origFindMany = t.findMany;
    t.findUnique = async (args: any) => attach(await origFindUnique(args), args?.include);
    t.findMany = async (args: any = {}) => (await origFindMany(args)).map((r: any) => attach(r, args?.include));
  }

  const prisma: any = {
    ...tables,
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
    _tables: tables,
  };
  return prisma;
}

function seedUser(prisma: any, id: string, displayName = `用户${id}`) {
  prisma._tables.userAccount._rows.push({
    id, displayName, email: `${id}@test.com`, status: 'active', primaryDeptId: null, deletedAt: null,
  });
}

describe('C3a · 员工档案 + 生命周期事件', () => {
  let prisma: any;
  let hr: ReturnType<typeof createHrService>;
  beforeEach(() => {
    prisma = makeMockPrisma();
    hr = createHrService(prisma);
  });

  it('Onboard 自动建档（employeeNo 自动编号，初始 Probation）', async () => {
    seedUser(prisma, 'U1', '张三');
    const { event } = await hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Onboard', effectiveDate: '2026-01-15' });
    expect(event.type).toBe('Onboard');
    const profile = await hr.getProfile('U1');
    expect(profile.employeeNo).toBe('EMP0001');
    expect(profile.employmentStatus).toBe('Probation');
    expect(profile.hireDate).toBe('2026-01-15');
  });

  it('生命周期状态机：Regularize 仅允许 Probation；离职后禁止任何变更', async () => {
    seedUser(prisma, 'U1');
    await hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Onboard', effectiveDate: '2026-01-15' });

    // Suspend 前置不允许（Probation 允许 Suspend，但先测 Resign 后终态）
    await hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Regularize', effectiveDate: '2026-04-15' });
    let profile = await hr.getProfile('U1');
    expect(profile.employmentStatus).toBe('Regular');
    expect(profile.regularDate).toBe('2026-04-15');

    // Regular 状态再次 Regularize → 拦截
    await expect(
      hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Regularize', effectiveDate: '2026-05-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    // 离职 → 终态
    await hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Resign', effectiveDate: '2026-06-01', reason: '个人原因' });
    profile = await hr.getProfile('U1');
    expect(profile.employmentStatus).toBe('Resigned');
    await expect(
      hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Resume', effectiveDate: '2026-06-15' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('状态变更禁止绕过事件：upsertProfile 改 employmentStatus 被拦截', async () => {
    seedUser(prisma, 'U1');
    await hr.upsertProfile({ userId: 'U1', hireDate: '2026-01-15' });
    await expect(
      hr.upsertProfile({ userId: 'U1', employmentStatus: 'Regular' }),
    ).rejects.toMatchObject({ code: 'STATUS_VIA_EVENT_ONLY' });
  });

  it('Transfer 联动部门与岗位；Suspend/Resume 往返', async () => {
    seedUser(prisma, 'U1');
    await hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Onboard', effectiveDate: '2026-01-15' });
    await hr.recordEmploymentEvent('admin', {
      userId: 'U1', type: 'Transfer', effectiveDate: '2026-03-01',
      fromDeptId: 'D1', toDeptId: 'D2', toPositionId: 'P9',
    });
    const profile = await hr.getProfile('U1');
    expect(profile.positionId).toBe('P9');
    const user = prisma._tables.userAccount._rows.find((u: any) => u.id === 'U1');
    expect(user.primaryDeptId).toBe('D2');

    await hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Suspend', effectiveDate: '2026-04-01' });
    expect((await hr.getProfile('U1')).employmentStatus).toBe('Suspended');
    await hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Resume', effectiveDate: '2026-05-01' });
    expect((await hr.getProfile('U1')).employmentStatus).toBe('Regular');

    // 事件流水完整
    const events = await hr.listEmploymentEvents({ userId: 'U1' });
    expect(events.length).toBe(4);
  });

  it('非 Onboard 事件要求既有档案', async () => {
    seedUser(prisma, 'U9');
    await expect(
      hr.recordEmploymentEvent('admin', { userId: 'U9', type: 'Regularize', effectiveDate: '2026-04-01' }),
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
  });
});

describe('K2 · 离职自动停账号（批次二）', () => {
  let prisma: any;
  let hr: ReturnType<typeof createHrService>;
  beforeEach(() => {
    prisma = makeMockPrisma();
    hr = createHrService(prisma);
  });

  const userRow = (id: string) => prisma._tables.userAccount._rows.find((u: any) => u.id === id);

  it('Resign 登记离职 → 系统账号自动停用 + metadata 留痕联链事件', async () => {
    seedUser(prisma, 'U1');
    await hr.recordEmploymentEvent('admin', { userId: 'U1', type: 'Onboard', effectiveDate: '2026-01-15' });
    const { event, accountDisabled } = await hr.recordEmploymentEvent(
      'hr-admin', { userId: 'U1', type: 'Resign', effectiveDate: '2026-06-01', reason: '个人原因' },
    );

    expect(accountDisabled).toBe(true);
    const user = userRow('U1');
    expect(user.status).toBe('disabled');
    expect(user.metadata.disabledBy).toBe('hr-admin');
    expect(user.metadata.disabledReason).toBe('resignation');
    expect(user.metadata.employmentEventId).toBe(event.id);
    expect(user.metadata.disabledAt).toBeTruthy();
  });

  it('Terminate 终止雇佣 → 系统账号同样自动停用', async () => {
    seedUser(prisma, 'U2');
    await hr.recordEmploymentEvent('admin', { userId: 'U2', type: 'Onboard', effectiveDate: '2026-01-15' });
    const { accountDisabled } = await hr.recordEmploymentEvent(
      'hr-admin', { userId: 'U2', type: 'Terminate', effectiveDate: '2026-06-01', reason: '违纪' },
    );

    expect(accountDisabled).toBe(true);
    const user = userRow('U2');
    expect(user.status).toBe('disabled');
    expect(user.metadata.disabledReason).toBe('termination');
  });

  it('非终态事件（Regularize/Transfer）不停用账号', async () => {
    seedUser(prisma, 'U3');
    await hr.recordEmploymentEvent('admin', { userId: 'U3', type: 'Onboard', effectiveDate: '2026-01-15' });
    const { accountDisabled } = await hr.recordEmploymentEvent(
      'admin', { userId: 'U3', type: 'Regularize', effectiveDate: '2026-04-15' },
    );

    expect(accountDisabled).toBe(false);
    expect(userRow('U3').status).toBe('active');
  });

  it('幂等：账号已停用（如先走交接停用）再补登记离职 → 不重复改写 metadata', async () => {
    seedUser(prisma, 'U4');
    await hr.recordEmploymentEvent('admin', { userId: 'U4', type: 'Onboard', effectiveDate: '2026-01-15' });
    // 模拟 handover 已先行停用（带交接留痕）
    const prior = { disabledAt: '2026-05-20T00:00:00.000Z', disabledBy: 'owner-1', handoverId: 'ho_1' };
    Object.assign(userRow('U4'), { status: 'disabled', metadata: prior });

    const { accountDisabled } = await hr.recordEmploymentEvent(
      'hr-admin', { userId: 'U4', type: 'Resign', effectiveDate: '2026-06-01' },
    );

    expect(accountDisabled).toBe(false);
    expect(userRow('U4').status).toBe('disabled');
    expect(userRow('U4').metadata).toEqual(prior);
  });
});

describe('C3b · 考勤 + 请假', () => {
  let prisma: any;
  let hr: ReturnType<typeof createHrService>;
  beforeEach(() => {
    prisma = makeMockPrisma();
    hr = createHrService(prisma);
    seedUser(prisma, 'U1', '张三');
  });

  it('考勤状态自动推导：迟到 / 早退 / 迟到且早退 / 正常', async () => {
    const late = await hr.upsertAttendance({ userId: 'U1', date: '2026-08-03', checkIn: '10:05', checkOut: '18:00' });
    expect(late.record.status).toBe('Late');
    const early = await hr.upsertAttendance({ userId: 'U1', date: '2026-08-04', checkIn: '09:00', checkOut: '16:00' });
    expect(early.record.status).toBe('EarlyLeave');
    const both = await hr.upsertAttendance({ userId: 'U1', date: '2026-08-05', checkIn: '11:00', checkOut: '15:00' });
    expect(both.record.status).toBe('LateAndEarly');
    expect(both.record.workHours).toBe(4);
    const normal = await hr.upsertAttendance({ userId: 'U1', date: '2026-08-06', checkIn: '09:00', checkOut: '18:00' });
    expect(normal.record.status).toBe('Normal');
  });

  it('考勤 upsert 幂等：同一人同日重复打卡更新而非新增', async () => {
    await hr.upsertAttendance({ userId: 'U1', date: '2026-08-03', checkIn: '09:00' });
    const { record } = await hr.upsertAttendance({ userId: 'U1', date: '2026-08-03', checkIn: '09:00', checkOut: '18:00' });
    expect(record.checkOut).toBe('18:00');
    const rows = await hr.listAttendance({ userId: 'U1' });
    expect(rows.length).toBe(1);
  });

  it('月度汇总：各状态天数与工时聚合', async () => {
    await hr.upsertAttendance({ userId: 'U1', date: '2026-08-03', checkIn: '09:00', checkOut: '18:00' });
    await hr.upsertAttendance({ userId: 'U1', date: '2026-08-04', checkIn: '10:00', checkOut: '18:00' }); // Late
    await hr.upsertAttendance({ userId: 'U1', date: '2026-08-05', status: 'Absent' });
    const summary = await hr.attendanceSummary('2026-08');
    expect(summary.length).toBe(1);
    expect(summary[0].days).toBe(3);
    expect(summary[0].late).toBe(1);
    expect(summary[0].absent).toBe(1);
    expect(summary[0].workHours).toBe(17);
  });

  it('请假状态机：Pending → Approved 后考勤自动标记 Leave；重复审批拦截', async () => {
    const { request } = await hr.createLeaveRequest({
      userId: 'U1', type: 'Annual', startDate: '2026-08-10', endDate: '2026-08-12', days: 3, reason: '年假',
    });
    expect(request.status).toBe('Pending');

    const { request: approved } = await hr.decideLeaveRequest('admin', request.id, 'Approved');
    expect(approved.status).toBe('Approved');
    expect(approved.approverId).toBe('admin');

    // 3 天考勤自动标记 Leave
    const att = await hr.listAttendance({ userId: 'U1', status: 'Leave' });
    expect(att.length).toBe(3);
    expect(att.map((r: any) => r.date).sort()).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);

    // 已审批不可重复审批 / 不可撤销
    await expect(hr.decideLeaveRequest('admin', request.id, 'Approved')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(hr.cancelLeaveRequest(request.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('请假驳回必须填写理由；Pending 可撤销；日期倒置校验', async () => {
    const { request } = await hr.createLeaveRequest({
      userId: 'U1', type: 'Sick', startDate: '2026-08-10', endDate: '2026-08-10', days: 1,
    });
    await expect(hr.decideLeaveRequest('admin', request.id, 'Rejected')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const { request: rejected } = await hr.decideLeaveRequest('admin', request.id, 'Rejected', '旺季不予批假');
    expect(rejected.status).toBe('Rejected');
    expect(rejected.rejectReason).toBe('旺季不予批假');

    const { request: r2 } = await hr.createLeaveRequest({
      userId: 'U1', type: 'Personal', startDate: '2026-08-20', endDate: '2026-08-20', days: 1,
    });
    const { request: cancelled } = await hr.cancelLeaveRequest(r2.id);
    expect(cancelled.status).toBe('Cancelled');

    await expect(
      hr.createLeaveRequest({ userId: 'U1', type: 'Annual', startDate: '2026-08-12', endDate: '2026-08-10', days: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('C3c · 薪资结构 + 工资单', () => {
  let prisma: any;
  let hr: ReturnType<typeof createHrService>;
  beforeEach(() => {
    prisma = makeMockPrisma();
    hr = createHrService(prisma);
    seedUser(prisma, 'U1', '张三');
    seedUser(prisma, 'U2', '李四');
  });

  async function onboard(userId: string) {
    await hr.recordEmploymentEvent('admin', { userId, type: 'Onboard', effectiveDate: '2026-01-15' });
  }

  it('薪资变更留痕：新结构生效封闭旧区间，历史可溯', async () => {
    await hr.setSalaryStructure({ userId: 'U1', baseSalary: 10000, positionAllowance: 500, effectiveFrom: '2026-01-15' });
    const { structure: s2, previousClosed } = await hr.setSalaryStructure({ userId: 'U1', baseSalary: 12000, positionAllowance: 800, effectiveFrom: '2026-07-01' });
    expect(previousClosed).toBe(true);
    expect(s2.effectiveTo).toBeNull();

    const history = await hr.getSalaryHistory('U1');
    expect(history.length).toBe(2);
    const old = history.find((h: any) => h.baseSalary === 10000);
    expect(old.effectiveTo).toBe('2026-07-01');

    // effectiveFrom 不得早于当前生效起点
    await expect(
      hr.setSalaryStructure({ userId: 'U1', baseSalary: 9000, effectiveFrom: '2026-06-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('工资单全流程：创建→生成明细（幂等）→调项→确认→发放；期间唯一', async () => {
    await onboard('U1');
    await onboard('U2');
    await hr.setSalaryStructure({ userId: 'U1', baseSalary: 10000, positionAllowance: 500, effectiveFrom: '2026-01-15' });
    await hr.setSalaryStructure({ userId: 'U2', baseSalary: 8000, effectiveFrom: '2026-01-15' });

    const { run } = await hr.createPayrollRun('2026-07');
    expect(run.status).toBe('Draft');
    await expect(hr.createPayrollRun('2026-07')).rejects.toMatchObject({ code: 'DUPLICATE_PERIOD' });

    // 生成明细：2 人；重复生成幂等
    const g1 = await hr.generatePayrollItems(run.id);
    expect(g1.generated).toBe(2);
    expect(g1.headcount).toBe(2);
    expect(g1.totalNet).toBe(18500);
    const g2 = await hr.generatePayrollItems(run.id);
    expect(g2.generated).toBe(0);
    expect(g2.headcount).toBe(2);

    // 调整明细（加班费 + 扣款）→ net 自动重算
    const detail = await hr.getPayrollRun(run.id);
    const item1 = detail.items.find((i: any) => i.userId === 'U1');
    const { item: patched } = await hr.updatePayrollItem(item1.id, { overtimePay: 300, deduction: 200 });
    expect(patched.net).toBe(10600);
    const after = await hr.getPayrollRun(run.id);
    expect(after.totalNet).toBe(18600);

    // 确认 → 明细锁定；发放
    const { run: confirmed } = await hr.confirmPayrollRun(run.id);
    expect(confirmed.status).toBe('Confirmed');
    await expect(hr.updatePayrollItem(item1.id, { bonus: 100 })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(hr.generatePayrollItems(run.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const { run: paid } = await hr.markPayrollPaid(run.id);
    expect(paid.status).toBe('Paid');
    expect(paid.paidAt).toBeTruthy();
  });

  it('空工资单不可确认；无薪资结构者不进入明细', async () => {
    await onboard('U1'); // U1 无薪资结构
    const { run } = await hr.createPayrollRun('2026-08');
    const g = await hr.generatePayrollItems(run.id);
    expect(g.generated).toBe(0);
    await expect(hr.confirmPayrollRun(run.id)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('C3d · 绩效', () => {
  let prisma: any;
  let hr: ReturnType<typeof createHrService>;
  beforeEach(() => {
    prisma = makeMockPrisma();
    hr = createHrService(prisma);
    seedUser(prisma, 'U1', '张三');
  });

  it('评定状态机：Draft → Submitted → Confirmed；期间唯一；周期关闭后禁录', async () => {
    const { cycle } = await hr.createPerformanceCycle({ name: '2026 上半年考核', period: '2026-H1' });
    await expect(hr.createPerformanceCycle({ name: '重复', period: '2026-H1' })).rejects.toMatchObject({ code: 'DUPLICATE_PERIOD' });

    const { review } = await hr.upsertPerformanceReview({ cycleId: cycle.id, userId: 'U1', selfScore: 85, comment: '自评良好' });
    expect(review.status).toBe('Draft');

    // Draft 可重复修订
    await hr.upsertPerformanceReview({ cycleId: cycle.id, userId: 'U1', selfScore: 88 });

    const { review: submitted } = await hr.submitPerformanceReview(review.id);
    expect(submitted.status).toBe('Submitted');

    // Submitted 后自评锁定
    await expect(
      hr.upsertPerformanceReview({ cycleId: cycle.id, userId: 'U1', selfScore: 99 }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const { review: confirmed } = await hr.confirmPerformanceReview(review.id, {
      managerScore: 90, finalScore: 89, grade: 'A', reviewerId: 'admin',
    });
    expect(confirmed.status).toBe('Confirmed');
    expect(confirmed.grade).toBe('A');

    // 非法评级拦截
    const { review: r2 } = await hr.upsertPerformanceReview({ cycleId: cycle.id, userId: 'U2', selfScore: 70 });
    await hr.submitPerformanceReview(r2.id);
    await expect(
      hr.confirmPerformanceReview(r2.id, { managerScore: 70, finalScore: 70, grade: 'S' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // 周期关闭后禁录
    await hr.closePerformanceCycle(cycle.id);
    await expect(
      hr.upsertPerformanceReview({ cycleId: cycle.id, userId: 'U3', selfScore: 60 }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('C3e · 培训', () => {
  let prisma: any;
  let hr: ReturnType<typeof createHrService>;
  beforeEach(() => {
    prisma = makeMockPrisma();
    hr = createHrService(prisma);
    seedUser(prisma, 'U1');
    seedUser(prisma, 'U2');
    seedUser(prisma, 'U3');
  });

  it('报名容量控制 + 重复报名拦截 + 成绩登记', async () => {
    const { course } = await hr.createTrainingCourse({ title: '面料跟单实务', capacity: 2, instructor: '王老师' });

    await hr.enrollTraining(course.id, 'U1');
    await hr.enrollTraining(course.id, 'U2');
    // 容量满
    await expect(hr.enrollTraining(course.id, 'U3')).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    // 重复报名
    await expect(hr.enrollTraining(course.id, 'U1')).rejects.toMatchObject({ code: 'DUPLICATE_ENROLLMENT' });

    const enrollments = await hr.listEnrollments({ courseId: course.id });
    const e1 = enrollments.find((e: any) => e.userId === 'U1');
    const { enrollment: done } = await hr.updateEnrollment(e1.id, { status: 'Completed', score: 92, certificate: 'CERT-001' });
    expect(done.score).toBe(92);

    const courses = await hr.listTrainingCourses();
    expect(courses[0].enrolledCount).toBe(2);
    expect(courses[0].completedCount).toBe(1);

    // 课程完成后不可报名
    await hr.updateTrainingCourse(course.id, { status: 'Completed' });
    await expect(hr.enrollTraining(course.id, 'U3')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
