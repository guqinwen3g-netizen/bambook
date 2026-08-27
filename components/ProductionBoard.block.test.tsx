/**
 * C18 生产看板阻塞标记（ProductionBoard）
 *
 * 验收口径：
 *   - 卡片上有「标记阻塞 / 解除阻塞」入口（拍板方案一：看板卡片按钮，作用于当前阶段）
 *   - resolveBlockAction：当前阶段未阻塞 → 标记；已阻塞 → 解除；全部完成/无阶段 → null
 *   - 端点契约：POST /v1/production/:orderId/block/:stageKey { blocked }
 *   - 卡片点击（跳订单详情）与阻塞按钮互不干扰（stopPropagation）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveBlockAction } from './ProductionBoard';

const source = readFileSync(new URL('./ProductionBoard.tsx', import.meta.url), 'utf8');

describe('C18 · resolveBlockAction 阻塞动作推导', () => {
  const stages = [
    { stageKey: 'order_placed', stageSeq: 1, status: 'done' },
    { stageKey: 'materials_confirmed', stageSeq: 2, status: 'pending' },
  ];

  it('当前阶段未阻塞 → 标记阻塞', () => {
    expect(resolveBlockAction(stages, 'materials_confirmed')).toEqual({
      stageKey: 'materials_confirmed', blocked: true,
    });
  });

  it('当前阶段已阻塞 → 解除阻塞', () => {
    const blockedStages = stages.map(s => s.stageKey === 'materials_confirmed' ? { ...s, status: 'blocked' } : s);
    expect(resolveBlockAction(blockedStages, 'materials_confirmed')).toEqual({
      stageKey: 'materials_confirmed', blocked: false,
    });
  });

  it('全部完成（currentStageKey=null）/ 无阶段记录 → null（无入口）', () => {
    expect(resolveBlockAction(stages.map(s => ({ ...s, status: 'done' })), null)).toBeNull();
    expect(resolveBlockAction([], null)).toBeNull();
    expect(resolveBlockAction(stages, 'qc_shipped')).toBeNull(); // currentStageKey 不在 stages 中
  });
});

describe('C18 · 看板卡片阻塞入口（源码契约）', () => {
  it('卡片渲染「标记阻塞 / 解除阻塞」按钮，stopPropagation 不触发卡片跳转', () => {
    expect(source).toContain("const blockAction = resolveBlockAction(item.stages, item.currentStageKey);");
    expect(source).toContain("{blockAction.blocked ? '标记阻塞' : '解除阻塞'}");
    expect(source).toContain("event.stopPropagation(); void handleToggleBlock(item);");
  });

  it('端点契约：POST /v1/production/:orderId/block/:stageKey，body { blocked }', () => {
    expect(source).toContain('`/v1/production/${encodeURIComponent(orderId)}/block/${encodeURIComponent(stageKey)}`');
    expect(source).toContain("method: 'POST'");
    expect(source).toContain('body: JSON.stringify({ blocked })');
  });

  it('成功反馈 + 刷新看板；失败 bdsToast 用户可见', () => {
    expect(source).toContain("bdsToast.success(action.blocked ? '已标记阻塞' : '已解除阻塞')");
    expect(source).toContain('await fetchBoard();');
    expect(source).toContain("bdsToast.danger(`${action.blocked ? '标记阻塞' : '解除阻塞'}失败：${e?.message || e}`)");
  });
});
