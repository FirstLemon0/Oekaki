/**
 * 小さな表示部品: Pill / Chip / Card / ProgressBar / EmptyState
 */
import type { ComponentChildren, JSX } from 'preact';
import { Icon, type IconName } from './Icon';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Pill（上部ステータスなど、角丸 999 の小さな帯）
// ---------------------------------------------------------------------------

export interface PillProps {
  icon?: IconName;
  iconClass?: string;
  tone?: 'default' | 'accent' | 'quiet';
  class?: string;
  title?: string;
  children?: ComponentChildren;
}

export function Pill({ icon, iconClass, tone = 'default', class: cls, title, children }: PillProps) {
  return (
    <span class={cx('pill', `pill--${tone}`, cls)} title={title}>
      {icon && <Icon name={icon} size={20} class={iconClass} />}
      <span class="pill__text">{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Chip（選択可能な小ボタン。高さ 40）
// ---------------------------------------------------------------------------

export interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  icon?: IconName;
  disabled?: boolean;
  children?: ComponentChildren;
}

export function Chip({ selected, onClick, icon, disabled, children }: ChipProps) {
  return (
    <button
      type="button"
      class={cx('chip', selected && 'is-selected')}
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps {
  tone?: 'default' | 'soft' | 'dashed';
  as?: 'section' | 'div' | 'article';
  class?: string;
  style?: JSX.CSSProperties;
  'aria-label'?: string;
  children?: ComponentChildren;
}

export function Card({ tone = 'default', as = 'section', class: cls, style, children, ...rest }: CardProps) {
  const Tag = as;
  return (
    <Tag class={cx('card', `card--${tone}`, cls)} style={style} aria-label={rest['aria-label']}>
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

export interface ProgressBarProps {
  value: number;
  max: number;
  width?: number | string;
  height?: number;
  label?: string;
  tone?: 'accent' | 'good' | 'mid' | 'off';
}

export function ProgressBar({ value, max, width = '100%', height = 8, label, tone = 'accent' }: ProgressBarProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      class={cx('progress', `progress--${tone}`)}
      style={{ width: typeof width === 'number' ? `${width}px` : width, height: `${height}px` }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <div class="progress__fill" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon?: IconName;
  title?: string;
  children?: ComponentChildren;
  action?: ComponentChildren;
}

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div class="empty">
      {icon && <Icon name={icon} size={32} class="empty__icon" />}
      {title && <p class="empty__title">{title}</p>}
      {children && <p class="empty__body">{children}</p>}
      {action && <div class="empty__action">{action}</div>}
    </div>
  );
}
