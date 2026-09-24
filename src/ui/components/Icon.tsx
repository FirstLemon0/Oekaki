/**
 * 線画アイコン（24×24、stroke 2、丸端）。色は currentColor。
 */
import type { JSX } from 'preact';

export type IconName =
  | 'home' | 'gallery' | 'settings' | 'check' | 'lock' | 'flame' | 'freeze'
  | 'pen' | 'eraser' | 'undo' | 'redo' | 'trash' | 'overlay' | 'grid' | 'flip'
  | 'silhouette' | 'play' | 'help' | 'back' | 'chevron' | 'brush' | 'rotate'
  | 'plus' | 'minus';

const PATHS: Record<IconName, JSX.Element> = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v10.5h4.5V14h3v5.5H18V9" />
    </>
  ),
  gallery: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  flame: (
    <path d="M12 3.5c.5 3-2.5 4.5-2.5 7.5 0 1 .4 1.8 1 2.3-.2-1.6.8-2.8 1.8-3.6.2 2 2.4 2.8 2.4 5.3a3.7 3.7 0 0 1-7.4 0c0-.4 0-.8.1-1.2C6 15.1 5.5 16 5.5 17a6.5 6.5 0 0 0 13 0c0-5.8-4.5-8-6.5-13.5Z" />
  ),
  freeze: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2" />
    </>
  ),
  pen: (
    <>
      <path d="M15.5 4.5 19.5 8.5 9 19H5v-4L15.5 4.5Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  eraser: (
    <>
      <path d="M8.5 19.5 4 15l9.5-9.5a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L10 19.5H8.5Z" />
      <path d="M9 10.5 14.5 16M10 19.5h10" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7 5 11l4 4" />
      <path d="M5 11h9.5a4.5 4.5 0 0 1 0 9H12" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 4 4-4 4" />
      <path d="M19 11H9.5a4.5 4.5 0 0 0 0 9H12" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7" />
      <path d="M6.5 7 7.5 20h9l1-13M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  overlay: (
    <>
      <rect x="3.5" y="3.5" width="11" height="11" rx="2" />
      <rect x="9.5" y="9.5" width="11" height="11" rx="2" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
    </>
  ),
  flip: (
    <>
      <path d="M12 3v18" />
      <path d="M9 6 3.5 18H9V6ZM15 6l5.5 12H15V6Z" />
    </>
  ),
  silhouette: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5 20.5c.5-4.5 3.4-7 7-7s6.5 2.5 7 7" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.7" />
      <path d="M12 16.9v.1" />
    </>
  ),
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  chevron: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  brush: (
    <>
      <path d="M19.5 4.5 11 13" />
      <path d="M11 13c-2.5-.5-5 1-5 3.5 0 1.5-.8 2.5-2 3 3.5 1 8 0 8.5-3.5.2-1.2-.3-2.3-1.5-3Z" />
    </>
  ),
  rotate: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
};

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  class?: string;
  /** 読み上げ用ラベル。無ければ装飾扱い（aria-hidden）。 */
  label?: string;
}

export function Icon({ name, size = 24, strokeWidth = 2, class: cls, label }: IconProps) {
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
