import React from 'react';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';

/**
 * BdsDialog — BDS 模态对话框统一入口（page-skeleton-spec §7 弹窗区）
 *
 * 替代 window.alert / window.confirm：
 *   - 无 onCancel 时为单按钮提示（alert 语义）
 *   - 有 onCancel 时为双按钮确认（confirm 语义），danger 用于删除等破坏性操作
 * 材质：bds-modal-mask + bds-modal（雾化遮罩 + 卡片面），操作行 bds-btn 40px。
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
