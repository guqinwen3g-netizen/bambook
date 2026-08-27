import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeStocktakingDiff, formatSignedQty } from './InventoryManager';

const source = readFileSync(new URL('./InventoryManager.tsx', import.meta.url), 'utf8');

/**
 * A3 库存盘点高危操作防护
 *
 * 背景：盘点表单填的是「盘点后实际总数」而非差值，界面原无提示，
 * 仓管误填差值（如"多了 50"）会把库存覆盖成 50。
 * 防护：① 文案改「盘点后实际数量」 ② 表单上方账面对比 + 实时差异 ③ 提交前 bdsConfirm 三要素确认。
 */
describe('A3 盘点防护：差异计算 computeStocktakingDiff / formatSignedQty', () => {
  it('盘盈：盘点后数量 > 账面 → 正差异，带 + 号', () => {
    expect(computeStocktakingDiff(100, 150)).toBe(50);
    expect(formatSignedQty(50)).toBe('+50');
  });

  it('盘亏：盘点后数量 < 账面 → 负差异，带 - 号', () => {
    expect(computeStocktakingDiff(100, 40)).toBe(-60);
    expect(formatSignedQty(-60)).toBe('-60');
  });

  it('账实相符 → 差异 0，不带符号', () => {
    expect(computeStocktakingDiff(100, 100)).toBe(0);
    expect(formatSignedQty(0)).toBe('0');
  });

  it('小数与千分位：口径同 formatQty（en-US、最多 2 位小数）', () => {
    expect(computeStocktakingDiff(100, 1123.456)).toBeCloseTo(1023.456, 3);
    expect(formatSignedQty(1234.5)).toBe('+1,234.5');
    expect(formatSignedQty(-1234.567)).toBe('-1,234.57');
  });
});

describe('A3 盘点防护：表单与确认弹窗（源码契约）', () => {
  it('数量输入框在盘点类型下文案为「盘点后实际数量」，其余类型保持「数量」', () => {
    expect(source).toContain("placeholder={movementForm.type === 'Adjustment' ? '盘点后实际数量 *' : '数量 *'}");
  });

  it('表单上方显示账面数对比：当前账面 + 差异（实时）', () => {
    expect(source).toContain('当前账面：');
    expect(source).toContain('差异：');
    expect(source).toContain('computeStocktakingDiff(bookQty, Number(movementForm.quantity))');
  });

  it('差异着色语义：盘盈 success / 盘亏 danger / 持平 secondary（BDS 语义变量，无硬编码色值）', () => {
    expect(source).toContain("diff > 0 ? 'var(--success-text)' : diff < 0 ? 'var(--danger-text)' : 'var(--text-secondary)'");
  });

  it('提交前 bdsConfirm 确认弹窗：文案含 账面 / 盘点 / 差异 三要素 + 确认提交', () => {
    expect(source).toContain("import { bdsConfirm } from './ui/BdsDialog';");
    expect(source).toContain("title: '确认盘点'");
    expect(source).toContain('账面 ${formatQty(bookQty)}');
    expect(source).toContain('盘点 ${formatQty(countedQty)}');
    expect(source).toContain('差异 ${formatSignedQty(computeStocktakingDiff(bookQty, countedQty))}');
    expect(source).toContain('确认提交？');
    expect(source).toContain("confirmText: '确认提交'");
  });

  it('确认弹窗仅挂 Adjustment 类型（入出库/调拨/锁定不受阻），取消则不提交', () => {
    expect(source).toContain("if (movementForm.type === 'Adjustment') {");
    expect(source).toContain('if (!confirmed) return;');
  });
});
