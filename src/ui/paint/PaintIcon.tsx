/**
 * お絵描き v2 のツールのアイコン（24×24、stroke 1.75、丸端、currentColor）。components/Icon と同じ線の太さ。
 */
import type { JSX } from 'preact';

export type PaintIconName =
  | 'fill'
  | 'eyedropper'
  | 'shape-line'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'select-rect'
  | 'select-lasso'
  | 'hand'
  | 'layers'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'up'
  | 'down'
  | 'merge'
  | 'duplicate'
  | 'add-layer'
  | 'flip-h'
  | 'flip-v'
  | 'fit'
  | 'rotate-reset'
  | 'select-all'
  | 'deselect'
  | 'download';

const P: Record<PaintIconName, JSX.Element> = {
  /** 塗りつぶし: 傾いたバケツと滴 */
  fill: (
    <>
      <path d="M5 11.5 11.5 5l7 7-6.5 6.5a1.5 1.5 0 0 1-2.1 0L5 13.6a1.5 1.5 0 0 1 0-2.1z" />
      <path d="M5.2 12.5h13M9 3.5l2.5 2.5" />
      <path d="M20 15.5c.9 1.3 1.5 2.3 1.5 3a1.5 1.5 0 0 1-3 0c0-.7.6-1.7 1.5-3z" />
    </>
  ),
  /** スポイト */
  eyedropper: (
    <>
      <path d="m14.5 6.5 3 3" />
      <path d="M16.5 4.2a2.1 2.1 0 0 1 3 3l-2 2-3-3z" />
      <path d="M14.5 8.5 6 17v2.5h2.5L17 11" />
    </>
  ),
  'shape-line': <path d="M5 19 19 5" />,
  'shape-rect': <rect x="4.5" y="6" width="15" height="12" rx="1" />,
  'shape-ellipse': <ellipse cx="12" cy="12" rx="8" ry="6" />,
  /** 矩形選択: 点線の四角 */
  'select-rect': <rect x="4.5" y="5.5" width="15" height="13" stroke-dasharray="2.5 2.5" />,
  /** 投げ縄: 点線の輪と垂れた紐 */
  'select-lasso': (
    <>
      <path d="M7.5 15.5C4.7 14.6 3.5 12.9 3.5 11c0-3.6 3.8-6.5 8.5-6.5s8.5 2.9 8.5 6.5-3.8 6.5-8.5 6.5c-.9 0-1.8-.1-2.6-.3" stroke-dasharray="2.5 2.4" />
      <path d="M7.5 15.5c-.4 1.8.3 3.2 1.8 4" />
    </>
  ),
  /** 手のひら */
  hand: (
    <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-6a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4.3 15.5a1.6 1.6 0 0 1 2.4-2.1L8 14.8" />
  ),
  /** レイヤー: 重なった 3 枚 */
  layers: (
    <>
      <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16 8.5 4.5 8.5-4.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.2 7.2C3.9 8.9 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.3-1.1" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="11" width="13" height="9.5" rx="1.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5.5" y="11" width="13" height="9.5" rx="1.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2" />
    </>
  ),
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  /** 下と結合: 2 枚が 1 枚に */
  merge: (
    <>
      <path d="m12 3.5 7 3.7-7 3.7-7-3.7z" />
      <path d="M12 12.5v4M9.5 14.5 12 17l2.5-2.5" />
      <path d="M5 17.5 12 21l7-3.5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </>
  ),
  'add-layer': (
    <>
      <path d="m11 4 7.5 4-7.5 4-7.5-4z" />
      <path d="m3.5 12.5 7.5 4 2.5-1.3" />
      <path d="M18.5 14v6M15.5 17h6" />
    </>
  ),
  /** 左右反転 */
  'flip-h': <path d="M12 3v18M9 7 3.5 12 9 17zM15 7l5.5 5-5.5 5z" />,
  /** 上下反転 */
  'flip-v': <path d="M3 12h18M7 9l5-5.5L17 9zM7 15l5 5.5 5-5.5z" />,
  /** 全体を表示: 四隅の角 */
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  /** 回転を戻す */
  'rotate-reset': (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M12 8v4l2.5 1.5" />
    </>
  ),
  'select-all': (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" stroke-dasharray="2.5 2.5" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  deselect: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" stroke-dasharray="2.5 2.5" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
};

export function PaintIcon({ name, size = 24 }: { name: PaintIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name]}
    </svg>
  );
}
