import type { ComponentChildren, JSX } from 'preact';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'size' | 'icon'> {
  variant?: ButtonVariant;
  /** lg = 56px（主）、md = 48px（副）、sm = 40px（チップ相当。ペン専用の小ボタン用） */
  size?: ButtonSize;
  icon?: IconName;
  /** icon バリアントのときの読み上げラベル（必須推奨） */
  label?: string;
  block?: boolean;
  /** 渡すと <a> として描画する（ハッシュ遷移用） */
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  children?: ComponentChildren;
}

export function Button({
  variant = 'secondary',
  size,
  icon,
  label,
  block,
  href,
  type = 'button',
  class: cls,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const resolvedSize = size ?? (variant === 'primary' ? 'lg' : 'md');
  const className = [
    'btn',
    `btn--${variant}`,
    `btn--${resolvedSize}`,
    block ? 'btn--block' : '',
    typeof cls === 'string' ? cls : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {icon && <Icon name={icon} size={resolvedSize === 'sm' ? 20 : 24} />}
      {variant === 'icon' ? label && <span class="visually-hidden">{label}</span> : children}
    </>
  );

  if (href && !disabled) {
    return (
      <a class={className} href={href} aria-label={variant === 'icon' ? label : undefined}>
        {content}
      </a>
    );
  }

  return (
    <button
      {...rest}
      type={type}
      class={className}
      disabled={disabled}
      aria-label={variant === 'icon' ? label : rest['aria-label']}
      title={variant === 'icon' ? label : undefined}
    >
      {content}
    </button>
  );
}
