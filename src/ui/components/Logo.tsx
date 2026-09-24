/**
 * ロゴマーク（DESIGN_SYSTEM.md §6）: 若葉の一本道（うねる線）＋ 終点の墨の点。
 * variant="rail" はレール用 40px の形（線がやや短い）。
 */
export function Logo({ size = 40, variant = 'rail' }: { size?: number; variant?: 'rail' | 'mark' }) {
  const rail = variant === 'rail';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path
        d={rail ? 'M14 48 C 22 48, 24 30, 32 30 S 42 44, 50 16' : 'M10 50 C 20 50, 22 30, 32 30 S 44 46, 54 12'}
        stroke="var(--color-accent)"
        stroke-width={rail ? 5 : 6}
        stroke-linecap="round"
      />
      <circle cx={rail ? 50 : 54} cy={rail ? 16 : 12} r={rail ? 4.5 : 5.5} fill="var(--color-ink)" />
    </svg>
  );
}
