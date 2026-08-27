/**
 * E3 订单列表列头排序 + E5 异常提示真实原因（OrderManager）
 *
 * 验收口径：
 *   - E3：金额/交期/客户三列可排序；比较器取数口径与行渲染一致；空日期恒排末位
 *   - E5：Alert 横幅展示状态时间线最近一次「→ Alert」流转 note；无留痕走兜底，不写死「已超期」
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareOrderLineItems, resolveOrderAlertReason } from './OrderManager';
import type { OrderLineItem, OrderStatusTransition } from '../types';

const source = readFileSync(new URL('./OrderManager.tsx', import.meta.url), 'utf8');

function line(overrides: any = {}): OrderLineItem {
  const { order: orderOverrides, ...rest } = overrides;
  return {
    id: 'L1',
    orderId: 'O1',
    amount: 0,
    customer: '',
    exMillDate: null,
    ...rest,
    order: { id: 'O1', customer: '', clientDate: null, dueDate: null, ...(orderOverrides ?? {}) },
  } as unknown as OrderLineItem;
}

describe('E3 · compareOrderLineItems 排序比较器', () => {
  it('金额：升序数值小在前，降序反转', () => {
    const small = line({ id: 'S', amount: 100 });
    const big = line({ id: 'B', amount: 900 });
    expect(compareOrderLineItems(small, big, { key: 'amount', dir: 'asc' })).toBeLessThan(0);
    expect(compareOrderLineItems(small, big, { key: 'amount', dir: 'desc' })).toBeGreaterThan(0);
  });

  it('交期：取 行exMillDate → 订单clientDate → 订单dueDate 回退链；空日期恒排末位（与方向无关）', () => {
    const early = line({ id: 'E', exMillDate: '2026-09-01' });
    const late = line({ id: 'L', exMillDate: '2026-12-01' });
    const fallback = line({ id: 'F', exMillDate: null, order: { clientDate: '2026-10-01' } });
    const empty = line({ id: 'N', exMillDate: null, order: { clientDate: null, dueDate: null } });

    expect(compareOrderLineItems(early, late, { key: 'dueDate', dir: 'asc' })).toBeLessThan(0);
    expect(compareOrderLineItems(early, fallback, { key: 'dueDate', dir: 'asc' })).toBeLessThan(0);
    // 空日期升序/降序都在最后
    expect(compareOrderLineItems(empty, early, { key: 'dueDate', dir: 'asc' })).toBeGreaterThan(0);
    expect(compareOrderLineItems(empty, early, { key: 'dueDate', dir: 'desc' })).toBeGreaterThan(0);
    expect(compareOrderLineItems(early, empty, { key: 'dueDate', dir: 'desc' })).toBeLessThan(0);
  });

  it('客户：中文 locale 比较，行 customer 为空回退订单 customer', () => {
    const a = line({ id: 'A', customer: '安踏' });
    const b = line({ id: 'B', customer: '中山溢达' });
    const fallback = line({ id: 'F', customer: '', order: { customer: '安踏' } });
    expect(compareOrderLineItems(a, b, { key: 'customer', dir: 'asc' })).toBeLessThan(0);
    expect(compareOrderLineItems(b, a, { key: 'customer', dir: 'desc' })).toBeLessThan(0);
    expect(compareOrderLineItems(fallback, b, { key: 'customer', dir: 'asc' })).toBeLessThan(0);
  });
});

describe('E3 · 表头排序接线（源码契约）', () => {
  it('客户/金额/交期三列表头声明 sortKey，点击走 handleSortToggle 三态循环', () => {
    expect(source).toContain("{ label: '订单 / 客户', sortKey: 'customer', sortLabel: '客户' }");
    expect(source).toContain("{ label: '数量 / 金额', align: 'text-right', sortKey: 'amount', sortLabel: '金额' }");
    expect(source).toContain("{ label: '日期', sortKey: 'dueDate', sortLabel: '交期' }");
    expect(source).toContain('onClick={() => handleSortToggle(header.sortKey!)}');
    // 三态：无→升序→降序→取消
    expect(source).toContain("if (!prev || prev.key !== key) return { key, dir: 'asc' };");
    expect(source).toContain("if (prev.dir === 'asc') return { key, dir: 'desc' };");
    // 排序应用于全部筛选之后
    expect(source).toContain('items = [...items].sort((a, b) => compareOrderLineItems(a, b, orderSort));');
  });
});

describe('E5 · resolveOrderAlertReason 异常真实原因', () => {
  const t = (overrides: Partial<OrderStatusTransition>): OrderStatusTransition => ({
    id: 'T1', orderId: 'O1', fromStatus: 'Production', toStatus: 'Alert',
    note: null, operator: 'u1', createdAt: 1, ...overrides,
  });

  it('取最近一次「→ Alert」流转的 note（时间线升序，倒序命中即最新）', () => {
    const timeline = [
      t({ id: 'T1', toStatus: 'Alert', note: '面料延期到厂', createdAt: 1 }),
      t({ id: 'T2', toStatus: 'Production', fromStatus: 'Alert', createdAt: 2 }),
      t({ id: 'T3', toStatus: 'Alert', note: '客户临时改单', createdAt: 3 }),
    ];
    expect(resolveOrderAlertReason(timeline)).toBe('客户临时改单');
  });

  it('note 空白/无 Alert 流转 → null（UI 走兜底文案）', () => {
    expect(resolveOrderAlertReason([t({ toStatus: 'Alert', note: '   ' })])).toBeNull();
    expect(resolveOrderAlertReason([t({ toStatus: 'Confirmed', fromStatus: 'Pending' })])).toBeNull();
    expect(resolveOrderAlertReason([])).toBeNull();
  });

  it('横幅展示真实原因，不再写死「已超期」', () => {
    expect(source).not.toContain('此订单已超期');
    expect(source).toContain('const alertReason = resolveOrderAlertReason(statusTimeline);');
    expect(source).toContain('`异常原因：${alertReason}`');
  });
});
