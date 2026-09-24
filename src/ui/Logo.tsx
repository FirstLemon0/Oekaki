/**
 * ロゴマーク（暫定）: 若葉色の丸に、うねる一本道の一筆線。
 */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <circle cx="22" cy="22" r="22" fill="var(--color-accent)" />
      <path
        d="M14 33c0-6 16-5 16-11s-12-4-12-9c0-2.5 2.5-4 6-4"
        fill="none"
        stroke="var(--color-on-accent)"
        stroke-width="3"
        stroke-linecap="round"
      />
      <circle cx="26" cy="9" r="2.4" fill="var(--color-on-accent)" />
    </svg>
  );
}
