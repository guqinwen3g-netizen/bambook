// @vitest-environment jsdom
/**
 * 资料完备度引擎 UI 测试：
 *   - CompletenessBadge：score<100 渲染百分比徽标 / score=100 隐藏 /
 *     点击展开缺项明细 / Esc 收起 / 外点收起
 *   - CompletenessBanner：无缺口 → 绿色「资料齐全」/ 有缺口 → severity 列表 +
 *     「去补齐」按钮执行 fix.target 跨模块跳转（primeCrossModuleNav + onNavigate）
 *   - 宿主接线断言（数字档案 / 关系智库 / 订单详情 / 开发单详情）
 *
 * 组件只接 props（数据由宿主 Manager 经 apiService.completenessBatch / completenessEntity
 * 拉取后传入），渲染测试直接 mock 数据形态；API 层契约见 services/apiService.test.ts。
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CompletenessBadge, CompletenessBanner } from './CompletenessIndicators';
import { View } from '../../types';
import type { CompletenessEntityData } from '../../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CROSS_MODULE_NAV_KEY = 'bambook_cross_module_nav';

function renderElement(element: React.ReactElement): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = createRoot(container);
  act(() => { root!.render(element); });
  return {
    container,
    unmount: () => {
      act(() => { root!.unmount(); });
      root = null;
      container.remove();
    },
  };
}

function findByText(scope: ParentNode, text: string): Element | null {
  return Array.from(scope.querySelectorAll('*')).find(el =>
    el.children.length === 0 && (el.textContent || '').includes(text),
  ) ?? null;
}

describe('CompletenessBadge（列表行信息完整度徽标）', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('score < 100 → 渲染百分比徽标（如 62%），缺项进入 title tooltip', () => {
    const { container, unmount } = renderElement(
      <CompletenessBadge score={62} missing={['无信用额度', '税号未填']} />,
    );
    const trigger = container.querySelector('[role="button"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('62%');
    expect(trigger?.getAttribute('title')).toContain('无信用额度、税号未填');
    unmount();
  });

  it('score = 100 → 不渲染徽标', () => {
    const { container, unmount } = renderElement(
      <CompletenessBadge score={100} missing={[]} />,
    );
    expect(container.querySelector('[role="button"]')).toBeNull();
    expect(container.textContent).toBe('');
    unmount();
  });

  it('点击徽标 → 展开缺项明细（missing 逐项渲染）；再点收起', () => {
    const { container, unmount } = renderElement(
      <CompletenessBadge score={48} missing={['无信用额度', 'Ship To 未填']} />,
    );
    const trigger = container.querySelector('[role="button"]') as HTMLElement;
    expect(document.querySelector('[data-completeness-badge-detail]')).toBeNull();
    act(() => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const detail = document.querySelector('[data-completeness-badge-detail]');
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain('无信用额度');
    expect(detail?.textContent).toContain('Ship To 未填');
    act(() => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(document.querySelector('[data-completeness-badge-detail]')).toBeNull();
    unmount();
  });

  it('Esc → 收起明细（对齐既有弹层 Esc 模式）', () => {
    const { container, unmount } = renderElement(
      <CompletenessBadge score={62} missing={['税号未填']} />,
    );
    const trigger = container.querySelector('[role="button"]') as HTMLElement;
    act(() => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(document.querySelector('[data-completeness-badge-detail]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-completeness-badge-detail]')).toBeNull();
    unmount();
  });

  it('外点 → 收起明细；点击明细面板自身不收起', () => {
    const { container, unmount } = renderElement(
      <CompletenessBadge score={62} missing={['税号未填']} />,
    );
    const trigger = container.querySelector('[role="button"]') as HTMLElement;
    act(() => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(document.querySelector('[data-completeness-badge-detail]')).not.toBeNull();
    // 点击明细面板内部 → 保持展开
    const panel = document.querySelector('[data-completeness-badge-detail]') as HTMLElement;
    act(() => { panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(document.querySelector('[data-completeness-badge-detail]')).not.toBeNull();
    // 点击容器外 → 收起
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    act(() => { outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(document.querySelector('[data-completeness-badge-detail]')).toBeNull();
    unmount();
  });
});

describe('CompletenessBanner（详情资料完备度横幅）', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    sessionStorage.removeItem(CROSS_MODULE_NAV_KEY);
  });

  it('data 为 null（拉取失败/未就绪）→ 不渲染', () => {
    const { container, unmount } = renderElement(<CompletenessBanner data={null} />);
    expect(container.textContent).toBe('');
    unmount();
  });

  it('无缺口 → 绿色「资料齐全」（role=status）', () => {
    const data: CompletenessEntityData = { entityType: 'order', id: 'ORD_1', score: 100, gaps: [] };
    const { container, unmount } = renderElement(<CompletenessBanner data={data} />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('资料齐全');
    expect(status?.className).toContain('bg-[var(--success-tint)]');
    unmount();
  });

  it('有缺口 → 按 severity 排序列 label+hint，「去补齐」执行 fix.target 跳转', () => {
    const data: CompletenessEntityData = {
      entityType: 'order',
      id: 'ORD_1',
      score: 62,
      gaps: [
        { ruleId: 'P1-rule', label: '交期未填', severity: 'P1', hint: '填写预计交货日期', fix: { type: 'navigate', target: '/orders?id=ORD_1' } },
        { ruleId: 'P0-rule', label: '客户信用额度未设', severity: 'P0', hint: '到关系智库补录', fix: { type: 'navigate', target: '/relations?id=rel_1' } },
        { ruleId: 'P2-rule', label: '订单备注缺失', severity: 'P2', hint: '可选补充', fix: { type: 'navigate', target: '/orders?id=ORD_1' } },
      ],
    };
    const navigated: View[] = [];
    const { container, unmount } = renderElement(
      <CompletenessBanner data={data} onNavigate={(view) => navigated.push(view)} />,
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // 横幅主色按最高 severity（P0 → 错误色 token）
    expect(alert?.className).toContain('bg-[var(--danger-tint)]');
    // severity 排序：P0 缺口列在最前（同序位下文本先出现）
    const text = alert?.textContent ?? '';
    expect(text.indexOf('客户信用额度未设')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('客户信用额度未设')).toBeLessThan(text.indexOf('交期未填'));
    expect(text).toContain('填写预计交货日期');
    // P0 徽章用错误色、P1 用警示色、P2 用中性色
    const chips = Array.from(container.querySelectorAll('[role="alert"] ul span'));
    expect(chips.some(c => c.textContent === 'P0' && c.className.includes('var(--danger-tint)'))).toBe(true);
    expect(chips.some(c => c.textContent === 'P1' && c.className.includes('var(--warning-tint)'))).toBe(true);
    expect(chips.some(c => c.textContent === 'P2' && c.className.includes('var(--recessed-bg)'))).toBe(true);
    // 「去补齐」→ primeCrossModuleNav（sessionStorage）+ onNavigate(View.Relations)
    const fixButton = findByText(container, '去补齐') as HTMLElement;
    expect(fixButton).not.toBeNull();
    // 三个 gap 的 target 均可解析 → 3 个去补齐按钮；点第一个（P0 → /relations?id=rel_1）
    const fixButtons = Array.from(container.querySelectorAll('button')).filter(b => (b.textContent || '').includes('去补齐'));
    expect(fixButtons.length).toBe(3);
    act(() => { fixButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(navigated).toEqual([View.Relations]);
    const ctx = JSON.parse(sessionStorage.getItem(CROSS_MODULE_NAV_KEY) || 'null');
    expect(ctx?.view).toBe('relations');
    expect(ctx?.focusEntityId).toBe('rel_1');
    unmount();
  });

  it('products 路由段（crossModuleNav 映射暂缺）→ 本地补充映射可解析；不可解析路由 → 不渲染跳转按钮', () => {
    const data: CompletenessEntityData = {
      entityType: 'order',
      id: 'ORD_1',
      gaps: [
        { ruleId: 'r1', label: '产品克重未填', severity: 'P1', hint: '到数字档案补录', fix: { type: 'navigate', target: '/products?id=pdt_1' } },
        { ruleId: 'r2', label: '手工缺失项', severity: 'P2', hint: '无路由' },
      ],
    };
    const navigated: View[] = [];
    const { container, unmount } = renderElement(
      <CompletenessBanner data={data} onNavigate={(view) => navigated.push(view)} />,
    );
    const fixButtons = Array.from(container.querySelectorAll('button')).filter(b => (b.textContent || '').includes('去补齐'));
    // r1 可跳转；r2 无 fix → 不渲染按钮
    expect(fixButtons.length).toBe(1);
    act(() => { fixButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(navigated).toEqual([View.Products]);
    unmount();
  });

  it('未传 onNavigate（宿主无跨模块通道）→ 不渲染跳转按钮，横幅仍展示', () => {
    const data: CompletenessEntityData = {
      entityType: 'order',
      id: 'ORD_1',
      gaps: [{ ruleId: 'r1', label: '客户信用额度未设', severity: 'P0', fix: { type: 'navigate', target: '/relations?id=rel_1' } }],
    };
    const { container, unmount } = renderElement(<CompletenessBanner data={data} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(findByText(container, '去补齐')).toBeNull();
    unmount();
  });
});

describe('资料完备度宿主接线（源码断言，对齐项目走查测试风格）', () => {
  const sourceOf = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

  it('数字档案 ProductsManager：batch?type=product 拉取 + 徽标渲染融合', () => {
    const source = sourceOf('../ProductsManager.tsx');
    expect(source).toContain("apiService.completenessBatch('product')");
    expect(source).toContain('<CompletenessBadge score={badge.score} missing={badge.missing} />');
    expect(source).toContain('const productCompletenessBadge');
    expect(source).toContain('renderProductCompleteness');
  });

  it('关系智库 RelationsManager：batch?type=relation 拉取 + 行徽标与缺失文案', () => {
    const source = sourceOf('../RelationsManager.tsx');
    expect(source).toContain("apiService.completenessBatch('relation')");
    expect(source).toContain('<CompletenessBadge score={completenessBadge.score} missing={completenessBadge.missing} expandDirection="up" />');
    expect(source).toContain('completenessBadge.missing.join');
  });

  it('订单详情 OrderManager：entity?type=order 拉取 + 详情头部横幅', () => {
    const source = sourceOf('../OrderManager.tsx');
    expect(source).toContain("apiService.completenessEntity('order', selectedOrder.id)");
    expect(source).toContain('<CompletenessBanner data={orderCompleteness} onNavigate={onNavigate} />');
  });

  it('开发单详情 DevelopmentManager：entity?type=development-case 拉取 + 详情横幅', () => {
    const source = sourceOf('../DevelopmentManager.tsx');
    expect(source).toContain("apiService.completenessEntity('development-case', selectedCase.id)");
    expect(source).toContain('<CompletenessBanner data={caseCompleteness} onNavigate={onNavigate} />');
  });
});
