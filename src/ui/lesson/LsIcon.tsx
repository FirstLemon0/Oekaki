/** components/Icon に無いアイコン（閉じる・課題・画像）。24×24、stroke 2、currentColor */
import type { JSX } from 'preact';
export type LsIconName = 'close' | 'task' | 'image' | 'collapse' | 'expand' | 'marker';

const PATHS: Record<LsIconName, JSX.Element> = {
  close: <path d="M6 6l12 12M18 6 6 18" />,
  task: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="m4 16 4.5-4 3.5 3 3-2.5 5 4" />
      <path d="M12 2.5v5M9.5 5 12 2.5 14.5 5" />
    </>
  ),
  collapse: <path d="m7 14 5-5 5 5" />,
  expand: <path d="m7 10 5 5 5-5" />,
  marker: (
    <>
      <circle cx="12" cy="11" r="6" />
      <path d="M12 17v4" />
    </>
  ),
};

export function LsIcon({ name, size = 24 }: { name: LsIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
