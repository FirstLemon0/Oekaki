/** 色指定の解決。Canvas 2D は CSS 変数を理解しないので、var(--x, fb) を実色に直す。 */

export interface CssVarRef {
  name: string;
  fallback: string | null;
}

/** 'var(--color-ink)' / 'var(--color-ink, #222)' を分解する。CSS 変数でなければ null。純関数。 */
export function parseCssVar(value: string): CssVarRef | null {
  const m = /^\s*var\(\s*(--[\w-]+)\s*(?:,\s*(.+?))?\s*\)\s*$/.exec(value);
  if (!m) return null;
  return { name: m[1]!, fallback: m[2] ?? null };
}

/**
 * 実色に解決する。lookup は CSS 変数名 → 値（空文字は未定義扱い）。
 * 解決できなければ fallback（var 内の既定値 → 引数 fallback の順）。
 */
export function resolveColor(value: string, lookup: (name: string) => string, fallback: string): string {
  const ref = parseCssVar(value);
  if (!ref) return value.trim() || fallback;
  const v = lookup(ref.name).trim();
  if (v) return v;
  if (ref.fallback) return resolveColor(ref.fallback, lookup, fallback);
  return fallback;
}
