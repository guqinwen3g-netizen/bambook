import * as React from 'react';
import { Search } from 'lucide-react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;
type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export type RdlSurfaceTone = 'panel' | 'card' | 'inset' | 'floating';
export type RdlSurfacePadding = 'none' | 'compact' | 'regular' | 'loose';

export interface RdlSurfaceProps extends DivProps {
  tone?: RdlSurfaceTone;
  padding?: RdlSurfacePadding;
}

export function RdlSurface({ tone = 'card', padding = 'none', className, children, ...props }: RdlSurfaceProps) {
  return (
    <div
      data-rdl-component="surface"
      data-rdl-surface-tone={tone}
      data-rdl-padding={padding}
      className={cx('rdl-surface', `rdl-surface--${tone}`, className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface RdlToolbarProps extends DivProps {
  density?: 'regular' | 'compact';
}

export function RdlToolbar({ density = 'regular', className, children, ...props }: RdlToolbarProps) {
  return (
    <div
      data-rdl-component="toolbar"
      data-rdl-density={density}
      className={cx('rdl-toolbar', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface RdlPillProps extends ButtonProps {
  active?: boolean;
  tone?: 'neutral' | 'accent' | 'danger';
}

export function RdlPill({ active = false, tone = 'neutral', className, children, type = 'button', ...props }: RdlPillProps) {
  return (
    <button
      data-rdl-component="pill"
      data-active={active ? 'true' : 'false'}
      data-rdl-tone={tone}
      type={type}
      className={cx('rdl-pill', className)}
      {...props}
    >
      {children}
    </button>
  );
}

export interface RdlSearchProps extends Omit<InputProps, 'className'> {
  className?: string;
  inputClassName?: string;
  density?: 'regular' | 'compact';
}

export function RdlSearch({ className, inputClassName, density = 'regular', ...props }: RdlSearchProps) {
  return (
    <label data-rdl-component="search" data-rdl-density={density} className={cx('rdl-search', className)}>
      <Search className="rdl-search__icon" aria-hidden="true" />
      <input className={cx('rdl-search__input', inputClassName)} {...props} />
    </label>
  );
}

export interface RdlDataRowProps extends DivProps {
  interactive?: boolean;
  selected?: boolean;
}

export function RdlDataRow({ interactive = false, selected = false, className, children, ...props }: RdlDataRowProps) {
  return (
    <div
      data-rdl-component="data-row"
      data-interactive={interactive ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      className={cx('rdl-data-row', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function RdlMetricCard({ className, children, ...props }: DivProps) {
  return (
    <div data-rdl-component="metric-card" className={cx('rdl-metric-card', className)} {...props}>
      {children}
    </div>
  );
}

export function RdlOverlayIconButton({ className, children, type = 'button', ...props }: ButtonProps) {
  return (
    <button data-rdl-component="overlay-icon-button" type={type} className={cx('rdl-overlay-icon-button', className)} {...props}>
      {children}
    </button>
  );
}
