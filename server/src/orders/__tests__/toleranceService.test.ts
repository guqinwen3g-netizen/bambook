/**
 * REQ2-03 溢短装与多单位计价回归测试
 *
 * 验收锚点（需求池 REQ2-03）：
 *   - 任一合同录入 ±5% 后，发货 5.2% 时系统预警并给出按条款的结算金额
 *   - 米码换算双向精确（1yd = 0.9144m 国际标准）
 */
import { describe, expect, it, vi } from 'vitest';
import { checkTolerance, getOrderToleranceStatus } from '../toleranceService';
import { convertLength, fabricWeightKg, lengthFromWeightKg, METERS_PER_YARD, normalizeLengthUnit } from '../../lib/unitConversion';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ══════════════ 单位换算库 ══════════════

describe('unitConversion 米码换算（单一真源）', () => {
  it('M → YD / YD → M 双向精确（1yd = 0.9144m）', () => {
    expect(convertLength(0.9144, 'M', 'YD')).toBe(1);
    expect(convertLength(1, 'YD', 'M')).toBe(0.9144);
    expect(convertLength(1000, 'M', 'YD')).toBe(1093.6133); // 1000/0.9144
    expect(convertLength(1000, 'YD', 'M')).toBe(914.4);
    expect(METERS_PER_YARD).toBe(0.9144);
  });

  it('同单位直通；非长度单位（PC/SET/KG）返回 null', () => {
    expect(convertLength(500, 'M', 'M')).toBe(500);
    expect(convertLength(500, 'M', 'PC')).toBeNull();
    expect(convertLength(500, 'KG', 'M')).toBeNull();
  });

  it('单位别名归一化（meter/米/yard/码 大小写不敏感）', () => {
    expect(normalizeLengthUnit('meter')).toBe('M');
    expect(normalizeLengthUnit('米')).toBe('M');
    expect(normalizeLengthUnit('Yard')).toBe('YD');
    expect(normalizeLengthUnit('码')).toBe('YD');
    expect(normalizeLengthUnit('PC')).toBeNull();
  });

  it('公斤计价：克重×门幅×长度 → kg（240gsm 150cm 1000m = 360kg）', () => {
    expect(fabricWeightKg(240, 150, 1000)).toBe(360); // 240×1.5×1000/1000
    expect(fabricWeightKg(200, 145, 500)).toBe(145);  // 200×1.45×500/1000
  });

  it('公斤反推米数（360kg → 1000m 往返一致）', () => {
    expect(lengthFromWeightKg(240, 150, 360)).toBe(1000);
  });
});

// ══════════════ 容差校验 ══════════════

describe('checkTolerance 溢短装校验', () => {
  it('验收锚点：±5% 条款发货 5.2% → over_limit 预警 + 条款上限结算金额', () => {
    // 合同 10000M ±5%，发货 10520M（+5.2%），单价 3.25
    const r = checkTolerance({ contractQty: 10000, actualQty: 10520, tolerancePercent: 5, unitPrice: 3.25 });
    expect(r.verdict).toBe('over_limit');
    expect(r.deviationPct).toBe(5.2);
    expect(r.allowedMax).toBe(10500);
    expect(r.allowedMin).toBe(9500);
    expect(r.warning).toContain('溢装超限');
    expect(r.settlementAmount).toBe(34190);      // 3.25 × 10520（按实际量）
    expect(r.maxLimitAmount).toBe(34125);       // 3.25 × 10500（条款上限协商基准）
  });

  it('限额内（+4.9%）→ ok 无预警，按实际量结算', () => {
    const r = checkTolerance({ contractQty: 10000, actualQty: 10490, tolerancePercent: 5, unitPrice: 3.25 });
    expect(r.verdict).toBe('ok');
    expect(r.warning).toBeNull();
    expect(r.settlementAmount).toBe(34092.5);
  });

  it('短装超限（−6%）→ under_limit 预警 + 下限结算额', () => {
    const r = checkTolerance({ contractQty: 1000, actualQty: 940, tolerancePercent: 5, unitPrice: 10 });
    expect(r.verdict).toBe('under_limit');
    expect(r.deviationPct).toBe(-6);
    expect(r.minLimitAmount).toBe(9500);
    expect(r.warning).toContain('短装超限');
  });

  it('容差 0 = 足量交付：任何偏差即预警', () => {
    const r = checkTolerance({ contractQty: 100, actualQty: 101, tolerancePercent: 0 });
    expect(r.verdict).toBe('over_limit');
    expect(r.allowedMin).toBe(100);
    expect(r.allowedMax).toBe(100);
  });

  it('恰好等于上限 → ok（边界含端点）', () => {
    const r = checkTolerance({ contractQty: 1000, actualQty: 1050, tolerancePercent: 5 });
    expect(r.verdict).toBe('ok');
  });

  it('非法输入 fail-closed（qty≤0 / 负数）', () => {
    expect(() => checkTolerance({ contractQty: 0, actualQty: 1, tolerancePercent: 5 })).toThrow();
    expect(() => checkTolerance({ contractQty: 100, actualQty: -1, tolerancePercent: 5 })).toThrow();
  });

  it('无单价：金额字段为 null（数量校验仍可用）', () => {
    const r = checkTolerance({ contractQty: 100, actualQty: 106, tolerancePercent: 5, unitPrice: null });
    expect(r.verdict).toBe('over_limit');
    expect(r.settlementAmount).toBeNull();
  });
});

// ══════════════ 订单维度状态 ══════════════

describe('getOrderToleranceStatus 订单溢短装状态', () => {
  function makePrisma(orders: any[], lines: any[]) {
    return {
      order: { findFirst: vi.fn().mockImplementation(async ({ where }: any) => orders.find(o => o.id === where.id) ?? null) },
      orderLine: { findMany: vi.fn().mockResolvedValue(lines) },
    } as any;
  }

  it('聚合各行已发量 vs 合同量（含 summary 与未发行）', async () => {
    const prisma = makePrisma(
      [{ id: 'PO-1', poNumber: 'DEMO-PO-1' }],
      [
        { id: 'L1', itemNo: '001', description: 'Cotton Twill', unit: 'M', quantity: 10000, unitPrice: 3.25, shipmentQuantity: 10520, tolerancePercent: 5 },
        { id: 'L2', itemNo: '002', description: 'Wool Suiting', unit: 'YD', quantity: 2000, unitPrice: 15, shipmentQuantity: 2000, tolerancePercent: 5 },
        { id: 'L3', itemNo: '003', description: 'Knit', unit: 'M', quantity: 500, unitPrice: 4, shipmentQuantity: null, tolerancePercent: 3 },
      ],
    );
    const s = await getOrderToleranceStatus(prisma, 'PO-1');
    expect(s!.poNumber).toBe('DEMO-PO-1');
    expect(s!.lines).toHaveLength(3);
    const l1 = s!.lines[0];
    expect(l1.check.verdict).toBe('over_limit');
    expect(l1.check.deviationPct).toBe(5.2);
    // 未发行（L3 shippedQty=0）：不触发容差判定，归 unshipped
    const l3 = s!.lines[2];
    expect(l3.shippedQty).toBe(0);
    expect(s!.summary).toEqual({ total: 3, ok: 1, overLimit: 1, underLimit: 0, unshipped: 1 });
  });

  it('订单不存在 → null', async () => {
    const prisma = makePrisma([], []);
    expect(await getOrderToleranceStatus(prisma, '__NONE__')).toBeNull();
  });

  it('shipmentQuantity 缺省 0；tolerancePercent 缺省 5（历史行回退默认条款）', async () => {
    const prisma = makePrisma(
      [{ id: 'PO-2', poNumber: 'X' }],
      [{ id: 'L1', itemNo: '1', description: null, unit: null, quantity: 100, unitPrice: null, shipmentQuantity: null, tolerancePercent: null }],
    );
    const s = await getOrderToleranceStatus(prisma, 'PO-2');
    expect(s!.lines[0].shippedQty).toBe(0);
    expect(s!.lines[0].tolerancePercent).toBe(5);
  });
});
