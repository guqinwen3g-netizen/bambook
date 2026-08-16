import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createMoqConfigService,
  MOQ_FALLBACK_CONSTANTS,
  MOQ_INVALID_REASON,
  MOQ_INVALID_VALUE,
  MOQ_SCOPE_DENIED,
  moqActorHasScope,
} from '../moqConfigService';

/**
 * MOQ §15.1 配置可调验收（A1-A5）：
 *   - getActiveConfig：active 行 / 无 active → null / DB 故障 → null（不抛）
 *   - buildSnapshot：active → moq_config 口径；无 active → fallback_constant + configId=null
 *   - updateConfig：scope 门禁（settings:moq:write）/ changeReason ≥5 字 / 正整数校验 / 事务内换版 + 历史留痕
 *   - listHistory：append-only 只读
 */

const ACTIVE_ROW = {
  id: 'MOQCFG__active1',
  fabricDefaultMoq: 800,
  garmentDefaultMoq: 200,
  capsuleMoq: 20,
  isActive: true,
  effectiveFrom: new Date('2026-08-01T00:00:00Z'),
  effectiveTo: null,
  changedBy: 'usr_admin',
  changeReason: '首次初始化种子值',
};

function makePrisma(opts: {
  activeRow?: any;
  findFirstThrows?: boolean;
  transactionThrows?: boolean;
} = {}) {
  const activeRow = opts.activeRow === undefined ? ACTIVE_ROW : opts.activeRow;

  const moqThresholdConfig = {
    findFirst: opts.findFirstThrows
      ? vi.fn().mockRejectedValue(new Error('DB_DOWN'))
      : vi.fn().mockImplementation(async ({ where }: any) => (where?.isActive === true ? activeRow : null)),
    update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...activeRow, ...data, id: where.id })),
    create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data })),
  };
  const moqThresholdConfigHistory = {
    create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data })),
    findMany: vi.fn().mockImplementation(async ({ orderBy, take }: any) => {
      expect(orderBy).toEqual({ changedAt: 'desc' });
      return [{ id: 'H1' }, { id: 'H2' }].slice(0, take ?? 50);
    }),
  };
  const auditLog = { create: vi.fn().mockResolvedValue({ id: 'AL-1' }) };

  const prisma: any = {
    moqThresholdConfig,
    moqThresholdConfigHistory,
    auditLog,
    $transaction: opts.transactionThrows
      ? vi.fn().mockRejectedValue({ code: 'P2002', message: 'Unique constraint failed' })
      : vi.fn().mockImplementation(async (ops: any[]) => Promise.all(ops)),
  };
  return prisma;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('moqActorHasScope — DR-041 权限链', () => {
  it('permissions 直查命中 → true', () => {
    expect(moqActorHasScope({ userId: 'u1', permissions: ['settings:moq:write'] }, 'settings:moq:write')).toBe(true);
  });
  it('owner / role-super-admin → 全通', () => {
    expect(moqActorHasScope({ userId: 'u1', roles: ['owner'] }, 'settings:moq:write')).toBe(true);
    expect(moqActorHasScope({ userId: 'u1', roles: ['role-super-admin'] }, 'settings:moq:write')).toBe(true);
  });
  it('legacy admin 映射 role-admin（矩阵含 settings:moq:write）→ true', () => {
    expect(moqActorHasScope({ userId: 'u1', roles: ['admin'] }, 'settings:moq:write')).toBe(true);
  });
  it('legacy manager 映射 role-sales-manager（矩阵含 moq:line_override 但无配置写）', () => {
    expect(moqActorHasScope({ userId: 'u1', roles: ['manager'] }, 'moq:line_override')).toBe(true);
    expect(moqActorHasScope({ userId: 'u1', roles: ['manager'] }, 'settings:moq:write')).toBe(false);
  });
  it('业务员 sales 持 moq:line_override（DR-007 申请侧）；finance / 未登录 → false', () => {
    // SALES_BASE 含 moq:line_override（业务员为豁免申请发起人，审批链做最终授权）
    expect(moqActorHasScope({ userId: 'u1', roles: ['sales'] }, 'moq:line_override')).toBe(true);
    expect(moqActorHasScope({ userId: 'u1', roles: ['finance'] }, 'moq:line_override')).toBe(false);
    expect(moqActorHasScope({ userId: 'u1', roles: ['finance'] }, 'settings:moq:write')).toBe(false);
    expect(moqActorHasScope(null as any, 'settings:moq:write')).toBe(false);
  });
});

describe('moqConfigService.getActiveConfig', () => {
  it('有 active 行 → 返回该行', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma() });
    const row = await svc.getActiveConfig();
    expect(row?.id).toBe(ACTIVE_ROW.id);
    expect(row?.fabricDefaultMoq).toBe(800);
  });

  it('无 active 行 → null（A5：调用方走兜底常量）', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma({ activeRow: null }) });
    expect(await svc.getActiveConfig()).toBeNull();
  });

  it('DB 故障 → null（不抛出，fail-closed 走兜底）', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma({ findFirstThrows: true }) });
    expect(await svc.getActiveConfig()).toBeNull();
  });
});

describe('moqConfigService.buildSnapshot（writeOnce 快照契约）', () => {
  it('有 active 配置 → source=moq_config + configId + 三档值', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma() });
    const snap = await svc.buildSnapshot();
    expect(snap.source).toBe('moq_config');
    expect(snap.configId).toBe(ACTIVE_ROW.id);
    expect(snap.fabricDefaultMoq).toBe(800);
    expect(snap.garmentDefaultMoq).toBe(200);
    expect(snap.capsuleMoq).toBe(20);
    expect(typeof snap.snapshotAt).toBe('string');
  });

  it('无 active 配置 → 兜底常量 800/200/20 + source=fallback_constant + configId=null（A5 last resort）', async () => {
    const prisma = makePrisma({ activeRow: null });
    const svc = createMoqConfigService({ prisma });
    const snap = await svc.buildSnapshot();
    expect(snap.source).toBe('fallback_constant');
    expect(snap.configId).toBeNull();
    expect(snap.fabricDefaultMoq).toBe(MOQ_FALLBACK_CONSTANTS.fabricDefaultMoq);
    expect(snap.garmentDefaultMoq).toBe(MOQ_FALLBACK_CONSTANTS.garmentDefaultMoq);
    expect(snap.capsuleMoq).toBe(MOQ_FALLBACK_CONSTANTS.capsuleMoq);
    // 兜底触发必须 best-effort 审计（可观测性）
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('MOQ_FALLBACK_CONSTANT_USED');
  });
});

describe('moqConfigService.updateConfig（§15.1 A2/A3 变更治理）', () => {
  const admin = { userId: 'usr_admin', roles: ['admin'] };

  it('未登录 → SCOPE_DENIED', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma() });
    await expect(
      svc.updateConfig(null as any, { fabricDefaultMoq: 1, garmentDefaultMoq: 1, capsuleMoq: 1, changeReason: '合理变更原因' }),
    ).rejects.toMatchObject({ code: MOQ_SCOPE_DENIED });
  });

  it('无 settings:moq:write scope（业务员）→ SCOPE_DENIED', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma() });
    await expect(
      svc.updateConfig({ userId: 'u_sales', roles: ['sales'] }, { fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '合理变更原因' }),
    ).rejects.toMatchObject({ code: MOQ_SCOPE_DENIED });
  });

  it('changeReason < 5 字 → MOQ_INVALID_REASON（A2 审计强制）', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma() });
    await expect(
      svc.updateConfig(admin, { fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '太短' }),
    ).rejects.toMatchObject({ code: MOQ_INVALID_REASON });
  });

  it.each([
    ['fabricDefaultMoq', 0],
    ['garmentDefaultMoq', -5],
    ['capsuleMoq', 1.5],
  ])('%s=%d 非正整数 → MOQ_INVALID_VALUE', async (field, value) => {
    const svc = createMoqConfigService({ prisma: makePrisma() });
    const input: any = { fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '合理变更原因' };
    input[field] = value;
    await expect(svc.updateConfig(admin, input)).rejects.toMatchObject({ code: MOQ_INVALID_VALUE });
  });

  it('正常变更：旧配置失效 + 新配置 isActive=true + append 1 条 history（同事务）', async () => {
    const prisma = makePrisma();
    const svc = createMoqConfigService({ prisma });
    const created = await svc.updateConfig(admin, {
      fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '旺季产能调整阈值',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // 旧行 isActive=false + effectiveTo
    expect(prisma.moqThresholdConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ACTIVE_ROW.id },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    // 新行 isActive=true + changedBy/changeReason
    expect(prisma.moqThresholdConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21,
          isActive: true, changedBy: 'usr_admin', changeReason: '旺季产能调整阈值',
        }),
      }),
    );
    // history before/after 对比（append-only）
    expect(prisma.moqThresholdConfigHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          beforeFabricDefaultMoq: 800, afterFabricDefaultMoq: 900,
          beforeGarmentDefaultMoq: 200, afterGarmentDefaultMoq: 210,
          beforeCapsuleMoq: 20, afterCapsuleMoq: 21,
          changedBy: 'usr_admin',
        }),
      }),
    );
    expect(created.fabricDefaultMoq).toBe(900);
  });

  it('无存量配置时首次写入：跳过 update，仅 create + history（before 取兜底常量）', async () => {
    const prisma = makePrisma({ activeRow: null });
    const svc = createMoqConfigService({ prisma });
    await svc.updateConfig(admin, { fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '首次初始化阈值' });
    expect(prisma.moqThresholdConfig.update).not.toHaveBeenCalled();
    expect(prisma.moqThresholdConfigHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ beforeFabricDefaultMoq: 800 }),
      }),
    );
  });

  it('事务失败（并发唯一索引 P2002）→ MOQ_UPDATE_FAILED', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma({ transactionThrows: true }) });
    await expect(
      svc.updateConfig(admin, { fabricDefaultMoq: 900, garmentDefaultMoq: 210, capsuleMoq: 21, changeReason: '旺季产能调整阈值' }),
    ).rejects.toMatchObject({ code: 'MOQ_UPDATE_FAILED' });
  });
});

describe('moqConfigService.listHistory（append-only 只读）', () => {
  it('默认 limit=50，按 changedAt desc', async () => {
    const svc = createMoqConfigService({ prisma: makePrisma() });
    const items = await svc.listHistory();
    expect(items).toHaveLength(2);
  });

  it('limit 截断（上限 200）', async () => {
    const prisma = makePrisma();
    const svc = createMoqConfigService({ prisma });
    await svc.listHistory({ limit: 1 });
    expect(prisma.moqThresholdConfigHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );
    await svc.listHistory({ limit: 9999 });
    expect(prisma.moqThresholdConfigHistory.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });
});
