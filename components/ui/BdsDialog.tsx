import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';

/**
 * BdsDialog — BDS 模态对话框统一入口（page-skeleton-spec §7 弹窗区）
 *
 * 替代 window.alert / window.confirm：
 *   - 无 onCancel 时为单按钮提示（alert 语义）
 *   - 有 onCancel 时为双按钮确认（confirm 语义），danger 用于删除等破坏性操作
 * 材质：bds-modal-mask + bds-modal（雾化遮罩 + 卡片面），操作行 bds-btn 40px。
 *
 * 两种用法：
 *   1. 声明式：<BdsDialog .../>（状态驱动，参照 DocumentCenter 范式）
 *   2. 命令式：bdsConfirm({ title, body, danger }) → Promise<boolean>
 *      （对齐 window.confirm 同步语义，迁移最小 diff；ESC/遮罩点击 = false）
 */
export interface BdsDialogProps {
  title: React.ReactNode;
  children?: React.ReactNode;
  /** 确认按钮文案，默认「知道了」（alert）/「确认」（confirm） */
  confirmLabel?: string;
  cancelLabel?: string;
  /** 破坏性操作：确认键改 bds-btn-danger */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  /** 缺省 = 单按钮 alert 模式 */
  onCancel?: () => void;
}

export const BdsDialog: React.FC<BdsDialogProps> = ({
  title,
  children,
  confirmLabel,
  cancelLabel = '取消',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const isConfirm = !!onCancel;
  // ESC 关闭：与遮罩点击同语义（onCancel ?? onConfirm）；loading（提交中）不响应，避免误关
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) (onCancel ?? onConfirm)();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onCancel, onConfirm]);
  return (
    <div className="bds-modal-mask" onClick={onCancel ?? onConfirm}>
      <div className="bds-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          {danger
            ? <Trash2 size={16} className="text-[var(--danger-text)]" />
            : <AlertCircle size={16} className="text-[var(--text-tertiary)]" />}
          <h3 className="text-base font-light text-[var(--text-primary)]">{title}</h3>
        </div>
        {children && (
          <div className="text-sm font-light text-[var(--text-secondary)] mb-5 whitespace-pre-line">{children}</div>
        )}
        <div className="flex justify-end gap-2">
          {isConfirm && (
            <button type="button" className="bds-btn bds-btn-ghost" onClick={onCancel} disabled={loading}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={danger ? 'bds-btn bds-btn-danger' : 'bds-btn bds-btn-primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel ?? (isConfirm ? '确认' : '知道了')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BdsDialog;

// ════════════════════════════════════════════════════════════════
// bdsConfirm — 命令式 confirm 语义（批次 3b 组件建设）
//
// 迁移映射（S-FE-W4-1 任务书 §3）：
//   if (!confirm('确定删除?')) return
//     → if (!(await bdsConfirm({ title, body, danger: true }))) return
//
// 实现要点：
//   - 每次调用独立 root + 容器（document.body 直挂，不依赖 App 根部——App.tsx 冻结）
//   - ESC / 遮罩点击 = resolve(false)；确认 = resolve(true)
//     （ESC 监听已收口进 BdsDialog 本体，命令式/声明式行为一致）
//   - 复用声明式 BdsDialog 的视觉（bds-modal-mask / bds-modal / bds-btn-danger）
// ════════════════════════════════════════════════════════════════

export interface BdsConfirmOptions {
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 破坏性操作：确认键走 bds-btn-danger */
  danger?: boolean;
}

export function bdsConfirm(options: BdsConfirmOptions): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
      // unmount 异步安全：先 resolve 不阻塞调用方
      root.unmount();
      container.remove();
    };

    const ConfirmShell: React.FC = () => (
      <BdsDialog
        title={options.title}
        confirmLabel={options.confirmText}
        cancelLabel={options.cancelText ?? '取消'}
        danger={options.danger ?? false}
        onConfirm={() => finish(true)}
        onCancel={() => finish(false)}
      >
        {options.body}
      </BdsDialog>
    );

    root.render(<ConfirmShell />);
  });
}

// ════════════════════════════════════════════════════════════════
// bdsPrompt — 命令式输入语义（走查批次 R2）
//
// 迁移映射：
//   const v = window.prompt('请输入原因')
//     → const v = await bdsPrompt({ title: '请输入原因' })
//
// 实现要点：
//   - 返回 Promise<string | null>：确认 = 输入串（可为空串）；ESC / 遮罩点击 / 取消 = null
//     —— 与 window.prompt 取消语义对齐，调用方必须判 null 中止，不可 || '' 吞掉取消
//   - 输入框走 .bds-input（BDS token，禁硬编码色/圆角）；Enter = 确认
// ════════════════════════════════════════════════════════════════

export interface BdsPromptOptions {
  title: React.ReactNode;
  body?: React.ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  /** 破坏性操作：确认键走 bds-btn-danger */
  danger?: boolean;
}

export function bdsPrompt(options: BdsPromptOptions): Promise<string | null> {
  return new Promise<string | null>(resolve => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
      // unmount 异步安全：先 resolve 不阻塞调用方
      root.unmount();
      container.remove();
    };

    const PromptShell: React.FC = () => {
      const [value, setValue] = useState(options.defaultValue ?? '');
      return (
        <BdsDialog
          title={options.title}
          confirmLabel={options.confirmText ?? '确认'}
          cancelLabel={options.cancelText ?? '取消'}
          danger={options.danger ?? false}
          onConfirm={() => finish(value)}
          onCancel={() => finish(null)}
        >
          {options.body}
          <input
            autoFocus
            type="text"
            className="bds-input w-full"
            value={value}
            placeholder={options.placeholder}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finish(value);
              }
            }}
          />
        </BdsDialog>
      );
    };

    root.render(<PromptShell />);
  });
}
