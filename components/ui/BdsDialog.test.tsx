// @vitest-environment jsdom
/**
 * 批次 3b 组件建设测试：bdsConfirm（Promise 语义）+ bdsToast（单例队列）
 *
 * 覆盖（S-FE-W4-1 任务书 §2）：
 *   - bdsConfirm：确认 resolve true / 取消·ESC·遮罩点击 resolve false / danger 类名 / body 渲染
 *   - bdsToast：四变体挂载 / 自动消失 3.2s / 叠加上限 3 条（丢最旧）/ 点击手动关闭
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { bdsConfirm, bdsPrompt } from './BdsDialog';
import { bdsToast, __resetBdsToastForTesting } from './bdsToast';

// React 19 act 环境 flag（消除 "not configured to support act" 警告）
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function clickButton(label: string): void {
  const buttons = Array.from(document.querySelectorAll('button'));
  const btn = buttons.find(b => (b.textContent || '').includes(label));
  if (!btn) throw new Error(`button "${label}" not found; got: ${buttons.map(b => b.textContent)}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('bdsConfirm', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('点击确认 → resolve true；danger 类名 + body 渲染', async () => {
    let resolved: boolean | undefined;
    const promise = bdsConfirm({ title: '删除确认', body: '确定删除这条记录吗？', danger: true })
      .then(v => { resolved = v; return v; });
    await act(async () => { await Promise.resolve(); });
    const confirmBtn = Array.from(document.querySelectorAll('button'))
      .find(b => (b.textContent || '').includes('确认'))!;
    expect(confirmBtn.className).toContain('bds-btn-danger');
    expect(document.body.textContent).toContain('确定删除这条记录吗？');
    clickButton('确认');
    await act(async () => { await promise; });
    expect(resolved).toBe(true);
    // 容器清理
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.bds-modal-mask')).toBeNull();
  });

  it('点击取消 → resolve false', async () => {
    let resolved: boolean | undefined;
    const promise = bdsConfirm({ title: '确认操作' }).then(v => { resolved = v; return v; });
    await act(async () => { await Promise.resolve(); });
    clickButton('取消');
    await act(async () => { await promise; });
    expect(resolved).toBe(false);
  });

  it('ESC → resolve false', async () => {
    let resolved: boolean | undefined;
    const promise = bdsConfirm({ title: '确认操作' }).then(v => { resolved = v; return v; });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await act(async () => { await promise; });
    expect(resolved).toBe(false);
  });

  it('遮罩点击 → resolve false', async () => {
    let resolved: boolean | undefined;
    const promise = bdsConfirm({ title: '确认操作' }).then(v => { resolved = v; return v; });
    await act(async () => { await Promise.resolve(); });
    const mask = document.querySelector('.bds-modal-mask')!;
    act(() => {
      mask.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => { await promise; });
    expect(resolved).toBe(false);
  });

  it('confirmText 自定义文案', async () => {
    let resolved: boolean | undefined;
    const promise = bdsConfirm({ title: '确认', confirmText: '删除它' }).then(v => { resolved = v; return v; });
    await act(async () => { await Promise.resolve(); });
    clickButton('删除它');
    await act(async () => { await promise; });
    expect(resolved).toBe(true);
  });
});

describe('bdsPrompt（走查批次 R2 输入型原语）', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function typeIntoInput(value: string): void {
    const input = document.querySelector('.bds-modal input') as HTMLInputElement | null;
    if (!input) throw new Error('prompt input not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('输入 + 确认 → resolve 输入串；placeholder / bds-input 类渲染', async () => {
    let resolved: string | null | undefined;
    const promise = bdsPrompt({ title: '撤销授权', placeholder: '撤销原因（必填）' })
      .then(v => { resolved = v; return v; });
    await act(async () => { await Promise.resolve(); });
    const input = document.querySelector('.bds-modal input') as HTMLInputElement;
    expect(input.className).toContain('bds-input');
    expect(input.placeholder).toBe('撤销原因（必填）');
    typeIntoInput('客户要求收回');
    clickButton('确认');
    await act(async () => { await promise; });
    expect(resolved).toBe('客户要求收回');
  });

  it('取消 → resolve null（不被吞成空串）', async () => {
    let resolved: string | null | undefined;
    const promise = bdsPrompt({ title: '驳回', cancelText: '算了' }).then(v => { resolved = v; return v; });
    await act(async () => { await Promise.resolve(); });
    clickButton('算了');
    await act(async () => { await promise; });
    expect(resolved).toBeNull();
  });

  it('ESC → resolve null；Enter → resolve 当前输入', async () => {
    let escResult: string | null | undefined;
    const p1 = bdsPrompt({ title: 'A' }).then(v => { escResult = v; return v; });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await act(async () => { await p1; });
    expect(escResult).toBeNull();

    let enterResult: string | null | undefined;
    const p2 = bdsPrompt({ title: 'B' }).then(v => { enterResult = v; return v; });
    await act(async () => { await Promise.resolve(); });
    typeIntoInput('hello');
    const input = document.querySelector('.bds-modal input')!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => { await p2; });
    expect(enterResult).toBe('hello');
  });
});

describe('bdsToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetBdsToastForTesting();
  });

  afterEach(() => {
    __resetBdsToastForTesting();
    vi.useRealTimers();
  });

  it('success 变体挂载到 body 单例容器并渲染消息', () => {
    act(() => {
      bdsToast.success('保存成功');
    });
    const host = document.querySelector('[data-bds-toast-root]');
    expect(host).toBeTruthy();
    expect(host!.querySelector('.bds-toast.success')).toBeTruthy();
    expect(host!.textContent).toContain('保存成功');
  });

  it('四变体叠加上限 3 条（丢最旧）', () => {
    act(() => {
      bdsToast.success('s');
      bdsToast.danger('d');
      bdsToast.info('i');
      bdsToast.warning('w');
    });
    const host = document.querySelector('[data-bds-toast-root]')!;
    expect(host.querySelectorAll('.bds-toast').length).toBe(3);
    expect(host.querySelector('.bds-toast.success')).toBeNull(); // 最旧被丢弃
    expect(host.querySelector('.bds-toast.danger')).toBeTruthy();
    expect(host.querySelector('.bds-toast.info')).toBeTruthy();
    expect(host.querySelector('.bds-toast.warning')).toBeTruthy();
  });

  it('3.2s 自动消失', () => {
    act(() => {
      bdsToast.danger('失败提示');
    });
    expect(document.body.textContent).toContain('失败提示');
    act(() => {
      vi.advanceTimersByTime(3300);
    });
    expect(document.querySelector('.bds-toast')).toBeNull();
  });

  it('点击单条手动关闭', () => {
    act(() => {
      bdsToast.info('点击关闭');
    });
    const toast = document.querySelector('.bds-toast')!;
    act(() => {
      toast.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('.bds-toast')).toBeNull();
  });
});
