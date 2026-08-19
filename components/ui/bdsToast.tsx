import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AlertCircle, AlertTriangle, Check, Info } from 'lucide-react';

/**
 * bdsToast — BDS 轻提示命令式单例（批次 3b 组件建设）
 *
 * 迁移映射（S-FE-W4-1 任务书 §3）：
 *   alert('保存成功') → bdsToast.success('保存成功')
 *   alert(err.message) → bdsToast.danger(err.message)
 *
 * 实现要点：
 *   - 单例挂载点：document.body 直挂（App.tsx 冻结，不走 App 根部）
 *   - 自动消失 3.2s；叠加上限 3 条（超出丢弃最旧）
 *   - 材质：.bds-toast + success/danger 变体（components.css §12）；
 *     info/warning 用中性基面（CSS 未定义变体，不新增样式）
 *   - 点击单条可手动关闭
 *   - 不引入动画层（磨砂浮层动画纪律：仅 opacity 可行但非必需；保持零依赖可测）
 */

export type BdsToastVariant = 'success' | 'danger' | 'info' | 'warning';

type ToastItem = {
  id: number;
  variant: BdsToastVariant;
  message: string;
};

const DISMISS_MS = 3200;
const MAX_STACK = 3;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let items: ToastItem[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const VARIANT_ICO: Record<BdsToastVariant, React.ReactNode> = {
  success: <Check size={14} strokeWidth={1.75} />,
  danger: <AlertCircle size={14} strokeWidth={1.75} />,
  info: <Info size={14} strokeWidth={1.75} />,
  warning: <AlertTriangle size={14} strokeWidth={1.75} />,
};

function ensureRoot(): void {
  if (container && root) return;
  container = document.createElement('div');
  container.setAttribute('data-bds-toast-root', '');
  Object.assign(container.style, {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 'var(--z-toast, 220)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    pointerEvents: 'none',
  } satisfies React.CSSProperties);
  document.body.appendChild(container);
  root = createRoot(container);
}

function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!items.some(item => item.id === id)) return;
  items = items.filter(item => item.id !== id);
  render();
}

function render(): void {
  if (!root) return;
  root.render(
    <>
      {items.map(item => (
        <div
          key={item.id}
          className={`bds-toast ${item.variant}`}
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={() => dismiss(item.id)}
          role="status"
        >
          <span className="ico">{VARIANT_ICO[item.variant]}</span>
          <span>{item.message}</span>
        </div>
      ))}
    </>
  );
}

function push(variant: BdsToastVariant, message: string): void {
  if (typeof document === 'undefined') return; // SSR/非浏览器环境防御
  const text = String(message ?? '').trim();
  if (!text) return;
  ensureRoot();
  const item: ToastItem = { id: nextId++, variant, message: text };
  items = [...items, item];
  // 叠加上限：丢弃最旧
  while (items.length > MAX_STACK) {
    const oldest = items[0];
    items = items.slice(1);
    const timer = timers.get(oldest.id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(oldest.id);
    }
  }
  render();
  timers.set(item.id, setTimeout(() => dismiss(item.id), DISMISS_MS));
}

export const bdsToast = {
  success: (message: string) => push('success', message),
  danger: (message: string) => push('danger', message),
  info: (message: string) => push('info', message),
  warning: (message: string) => push('warning', message),
};

/** 仅供测试：清空单例状态（队列/计时器/DOM） */
export function __resetBdsToastForTesting(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  items = [];
  if (root) root.render(null);
}
