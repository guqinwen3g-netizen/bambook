// @vitest-environment jsdom
/**
 * CustomSelect 生产化补强测试（2026-08-31 W4 原生浮层收编）：
 *   - 打开/关闭/选择基础交互 + ARIA（listbox/option/aria-expanded/aria-selected）
 *   - 键盘：ArrowDown/ArrowUp/Enter/Home/End 导航，Escape 关闭且阻断冒泡（防误关 BdsDialog 宿主层）
 *   - option.disabled：视觉降权 + 点击无效 + 键盘导航跳过
 *   - 宿主 disabled：触发器禁用不展开
 *   - value 不在 options（异步加载态）→ 显示 placeholder
 *
 * 渲染模式与 CompletenessIndicators.test.tsx 同款：jsdom + createRoot + act（项目无 @testing-library）。
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomSelect from './CustomSelect';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

const OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待确认' },
  { value: 'production', label: '生产中' },
  { value: 'delivered', label: '已交付' },
];

function fire(el: Element, type: string, init: KeyboardEventInit | MouseEventInit = {}) {
  const EventCtor = type.startsWith('key') ? KeyboardEvent : MouseEvent;
  act(() => {
    el.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, ...init }));
  });
}

function getTrigger(container: HTMLElement): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('[data-select-trigger]')!;
}

/** AnimatePresence exit 动画 0.2s——关闭断言前等动画卸载浮层 DOM */
async function settleExit() {
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
}

describe('CustomSelect 基础交互', () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => { cleanup.forEach(fn => fn()); cleanup = []; });

  it('value 命中时触发器显示选中 label；未命中显示 placeholder', () => {
    const r1 = renderElement(
      <CustomSelect options={OPTIONS} value="production" onChange={() => {}} />,
    );
    cleanup.push(r1.unmount);
    expect(r1.container.textContent).toContain('生产中');

    const r2 = renderElement(
      <CustomSelect options={OPTIONS} value="ghost" onChange={() => {}} placeholder="请选择仓库..." />,
    );
    cleanup.push(r2.unmount);
    expect(r2.container.textContent).toContain('请选择仓库...');
  });

  it('打开浮层：渲染全部 option + ARIA（listbox/option/aria-selected/aria-expanded）', () => {
    const r = renderElement(
      <CustomSelect options={OPTIONS} value="pending" onChange={() => {}} />,
    );
    cleanup.push(r.unmount);
    const trigger = getTrigger(r.container);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fire(trigger, 'click');

    // 浮层默认 menuPortal 到 document.body（脱离宿主堆叠上下文，防 overflow-hidden/磨砂层裁剪）
    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const optionEls = Array.from(document.body.querySelectorAll('[role="option"]'));
    expect(optionEls).toHaveLength(4);
    expect(optionEls.find(el => el.getAttribute('aria-selected') === 'true')?.textContent).toContain('待确认');
  });

  it('点击选项 → onChange 回传 value 并关闭浮层', async () => {
    const onChange = vi.fn();
    const r = renderElement(
      <CustomSelect options={OPTIONS} value="" onChange={onChange} />,
    );
    cleanup.push(r.unmount);
    fire(getTrigger(r.container), 'click');

    const delivered = Array.from(document.body.querySelectorAll('[role="option"]'))
      .find(el => el.textContent?.includes('已交付')) as HTMLButtonElement;
    fire(delivered, 'click');

    expect(onChange).toHaveBeenCalledWith('delivered');
    await settleExit();
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it('宿主 disabled：触发器禁用且点击不展开', () => {
    const r = renderElement(
      <CustomSelect options={OPTIONS} value="" onChange={() => {}} disabled />,
    );
    cleanup.push(r.unmount);
    const trigger = getTrigger(r.container);
    expect(trigger.disabled).toBe(true);
    fire(trigger, 'click');
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('CustomSelect 键盘导航（W4 原生浮层收编）', () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => { cleanup.forEach(fn => fn()); cleanup = []; });

  it('ArrowDown 打开 + 移动高亮 + Enter 选中', () => {
    const onChange = vi.fn();
    const r = renderElement(
      <CustomSelect options={OPTIONS} value="" onChange={onChange} />,
    );
    cleanup.push(r.unmount);
    const trigger = getTrigger(r.container);

    fire(trigger, 'keydown', { key: 'ArrowDown' });
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    // value='' 命中「全部状态」(index 0)，高亮初始在选中项
    expect(trigger.getAttribute('aria-activedescendant')).toBeTruthy();

    fire(trigger, 'keydown', { key: 'ArrowDown' });
    fire(trigger, 'keydown', { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('pending');
  });

  it('Escape 关闭并阻断冒泡（防误关 BdsDialog 宿主弹层）', async () => {
    const documentSpy = vi.fn();
    document.addEventListener('keydown', documentSpy);
    const r = renderElement(
      <CustomSelect options={OPTIONS} value="" onChange={() => {}} />,
    );
    cleanup.push(r.unmount);
    fire(getTrigger(r.container), 'click');
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();

    fire(getTrigger(r.container), 'keydown', { key: 'Escape' });

    await settleExit();
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    // 合成事件 stopPropagation 透传原生——事件未冒泡到 document
    expect(documentSpy).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentSpy);
  });

  it('Home/End 跳转首末可用项，ArrowUp 反向循环', () => {
    const onChange = vi.fn();
    const r = renderElement(
      <CustomSelect options={OPTIONS} value="delivered" onChange={onChange} />,
    );
    cleanup.push(r.unmount);
    const trigger = getTrigger(r.container);

    fire(trigger, 'keydown', { key: 'ArrowDown' }); // 打开，高亮=选中项(已交付)
    fire(trigger, 'keydown', { key: 'Home' });
    fire(trigger, 'keydown', { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('');
    expect(onChange).toHaveBeenCalledTimes(1);

    fire(trigger, 'keydown', { key: 'ArrowUp' }); // 打开，高亮=全部状态(首项)
    fire(trigger, 'keydown', { key: 'End' });
    fire(trigger, 'keydown', { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('delivered');
  });
});

describe('CustomSelect option.disabled（原生 <option disabled> 等价语义）', () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => { cleanup.forEach(fn => fn()); cleanup = []; });

  const OPTS_WITH_DISABLED = [
    { value: 'a', label: '可用甲' },
    { value: 'b', label: '锁定乙', disabled: true },
    { value: 'c', label: '可用丙' },
  ];

  it('disabled 项 aria-disabled + 点击无效', () => {
    const onChange = vi.fn();
    const r = renderElement(
      <CustomSelect options={OPTS_WITH_DISABLED} value="a" onChange={onChange} />,
    );
    cleanup.push(r.unmount);
    fire(getTrigger(r.container), 'click');

    const locked = Array.from(document.body.querySelectorAll('[role="option"]'))
      .find(el => el.textContent?.includes('锁定乙')) as HTMLButtonElement;
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.disabled).toBe(true);
    fire(locked, 'click');
    expect(onChange).not.toHaveBeenCalled();
    // 浮层保持打开（点击无效而非关闭）
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('键盘导航跳过 disabled 项：从 a ArrowDown 直达 c', () => {
    const onChange = vi.fn();
    const r = renderElement(
      <CustomSelect options={OPTS_WITH_DISABLED} value="a" onChange={onChange} />,
    );
    cleanup.push(r.unmount);
    const trigger = getTrigger(r.container);

    fire(trigger, 'keydown', { key: 'ArrowDown' }); // 打开，高亮=a
    fire(trigger, 'keydown', { key: 'ArrowDown' }); // 跳过 b → c
    fire(trigger, 'keydown', { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });
});
