import React from 'react';
import '../../styles/os-vnext.css';
import { OS_VNEXT_PRIMITIVE_RECIPES, type OsVNextRole } from './osVNext';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const roleProps = (role: OsVNextRole) => ({ 'data-os-vnext-role': role });

type OSPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  elevated?: boolean;
};

export const OSPanel = React.forwardRef<HTMLDivElement, OSPanelProps>(({
  elevated = true,
  className,
  children,
  ...props
}, ref) => (
  <div
    ref={ref}
    {...roleProps('panel')}
    className={cx(OS_VNEXT_PRIMITIVE_RECIPES.panel, elevated && 'os-vnext-panel--elevated', className)}
    {...props}
  >
    {children}
  </div>
));
OSPanel.displayName = 'OSPanel';

export const OSCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({
  className,
  children,
  ...props
}, ref) => (
  <div ref={ref} {...roleProps('card')} className={cx(OS_VNEXT_PRIMITIVE_RECIPES.card, className)} {...props}>
    {children}
  </div>
));
OSCard.displayName = 'OSCard';

type OSButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'action' | 'state' | 'danger';
  active?: boolean;
};

export const OSButton = React.forwardRef<HTMLButtonElement, OSButtonProps>(({
  variant = 'action',
  active = false,
  className,
  children,
  ...props
}, ref) => {
  const role: OsVNextRole = variant === 'state' ? 'state-control' : 'action-control';
  return (
    <button
      ref={ref}
      type="button"
      {...roleProps(role)}
      data-os-vnext-active={variant === 'state' ? String(active) : undefined}
      className={cx(OS_VNEXT_PRIMITIVE_RECIPES.button[variant], className)}
      {...props}
    >
      {children}
    </button>
  );
});
OSButton.displayName = 'OSButton';

export const OSField = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({
  className,
  ...props
}, ref) => (
  <input ref={ref} {...roleProps('field')} className={cx(OS_VNEXT_PRIMITIVE_RECIPES.field, className)} {...props} />
));
OSField.displayName = 'OSField';

export const OSToolbar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({
  className,
  children,
  ...props
}, ref) => (
  <div ref={ref} {...roleProps('toolbar')} className={cx(OS_VNEXT_PRIMITIVE_RECIPES.toolbar, className)} {...props}>
    {children}
  </div>
));
OSToolbar.displayName = 'OSToolbar';

export const OSTable = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(({
  className,
  children,
  ...props
}, ref) => (
  <table ref={ref} {...roleProps('table')} className={cx(OS_VNEXT_PRIMITIVE_RECIPES.table, className)} {...props}>
    {children}
  </table>
));
OSTable.displayName = 'OSTable';

type OSDialogProps = React.HTMLAttributes<HTMLDivElement> & {
  open?: boolean;
  title?: React.ReactNode;
};

export const OSDialog = React.forwardRef<HTMLDivElement, OSDialogProps>(({
  open = false,
  title,
  className,
  children,
  ...props
}, ref) => {
  if (!open) return null;
  return (
    <div ref={ref} {...roleProps('dialog')} className={cx(OS_VNEXT_PRIMITIVE_RECIPES.dialog, className)} {...props}>
      {title && <div className="os-vnext-dialog__title">{title}</div>}
      <div className="os-vnext-dialog__body">{children}</div>
    </div>
  );
});
OSDialog.displayName = 'OSDialog';

type OSScrollFrameProps = React.HTMLAttributes<HTMLDivElement> & {
  edgeFade?: boolean;
};

export const OSScrollFrame = React.forwardRef<HTMLDivElement, OSScrollFrameProps>(({
  edgeFade = true,
  className,
  children,
  ...props
}, ref) => (
  <div
    ref={ref}
    {...roleProps('scroll-frame')}
    data-os-vnext-edge-fade={String(edgeFade)}
    className={cx(OS_VNEXT_PRIMITIVE_RECIPES.scrollFrame, className)}
    {...props}
  >
    {children}
  </div>
));
OSScrollFrame.displayName = 'OSScrollFrame';
