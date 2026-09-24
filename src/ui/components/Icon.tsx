/**
 * 線画アイコン（24×24、stroke 1.75、丸端）。色は currentColor。
 * パスは DESIGN_SYSTEM.md の原本（design-ref）と同じ。
 */

export type IconName =
  | 'home' | 'gallery' | 'settings' | 'check' | 'lock' | 'flame' | 'freeze'
  | 'pen' | 'eraser' | 'undo' | 'redo' | 'trash' | 'overlay' | 'grid' | 'flip'
  | 'silhouette' | 'play' | 'help' | 'back' | 'chevron' | 'brush' | 'rotate'
  | 'plus' | 'minus'
  | 'target' | 'image' | 'close' | 'snow';

const D: Record<IconName, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  gallery: 'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4 M15.5 9.5h.01',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 3v2.5 M12 18.5V21 M3 12h2.5 M18.5 12H21 M5.6 5.6l1.8 1.8 M16.6 16.6l1.8 1.8 M5.6 18.4l1.8-1.8 M16.6 7.4l1.8-1.8',
  check: 'M5 12l5 5L20 7',
  lock: 'M6 11h12v10H6z M9 11V7a3 3 0 0 1 6 0v4',
  flame:
    'M12 22c4.4 0 7-3 7-6.5 0-2.9-1.6-5-3-6.5-.4 1.6-1.3 2.5-2.5 3 .3-3-1-6-3.5-8-.2 2.8-1.5 4.5-3.2 6.2C5.4 11.6 5 13.3 5 15.5 5 19 7.6 22 12 22z',
  freeze: 'M12 2v20 M4 6l16 12 M20 6L4 18',
  snow: 'M12 2v20 M4 6l16 12 M20 6L4 18',
  pen: 'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.6 7.6',
  eraser: 'M20 20H7L3 16a2 2 0 0 1 0-2.8l9.2-9.2a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L13 19 M7 13l6 6',
  undo: 'M3 7v6h6 M3 13a9 9 0 0 1 15-6.7L21 9',
  redo: 'M21 7v6h-6 M21 13a9 9 0 0 0-15-6.7L3 9',
  trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 11v5 M14 11v5',
  overlay: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 3v18 M12 7h5 M12 12h8 M12 17h5',
  grid: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
  flip: 'M12 3v18 M8 7L3 12l5 5V7z M16 7l5 5-5 5V7z',
  silhouette: 'M12 3a5 5 0 0 1 0 10 5 5 0 0 1 0-10z M4 21a8 8 0 0 1 16 0z',
  play: 'M6 4l14 8-14 8V4z',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7 M12 17h.01',
  back: 'M15 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  brush: 'M4 20c2-1 2-3 3-4a3 3 0 1 1 4 4c-1 1-3 1-4 3z M9 15l8-8 3 3-8 8',
  rotate: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  image: 'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4',
  close: 'M6 6l12 12 M18 6L6 18',
};

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  class?: string;
  /** 読み上げ用ラベル。無ければ装飾扱い（aria-hidden）。 */
  label?: string;
}

export function Icon({ name, size = 24, strokeWidth = 1.75, class: cls, label }: IconProps) {
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
      <path d={D[name]} />
    </svg>
  );
}
