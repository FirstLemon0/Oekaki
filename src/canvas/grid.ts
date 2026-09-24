/** グリッドの正規化と線の位置（純関数）。 */
import type { CanvasOptions, GridSpec } from './types';

/** グリッドの線色（墨色 12%） */
export const GRID_COLOR = 'rgba(43,42,40,.12)';

const DIVIDE_N = [2, 3, 4, 6, 8] as const;
const PITCH_PX = [25, 50, 100] as const;

/** 旧形式（'thirds' / 'quarters'）や不正値を GridSpec に直す。不正値は 'none'。 */
export function normalizeGrid(g: CanvasOptions['grid'] | undefined | null): GridSpec {
  if (g === 'thirds') return { kind: 'divide', n: 3 };
  if (g === 'quarters') return { kind: 'divide', n: 4 };
  if (!g || typeof g !== 'object') return 'none';
  if (g.kind === 'divide' && (DIVIDE_N as readonly number[]).includes(g.n)) return { kind: 'divide', n: g.n };
  if (g.kind === 'pitch' && (PITCH_PX as readonly number[]).includes(g.px)) return { kind: 'pitch', px: g.px };
  return 'none';
}

/** 同じグリッドか（オブジェクトの同一性ではなく中身で比べる）。 */
export function sameGrid(a: CanvasOptions['grid'], b: CanvasOptions['grid']): boolean {
  const x = normalizeGrid(a);
  const y = normalizeGrid(b);
  if (x === 'none' || y === 'none') return x === y;
  if (x.kind === 'divide' && y.kind === 'divide') return x.n === y.n;
  if (x.kind === 'pitch' && y.kind === 'pitch') return x.px === y.px;
  return false;
}

/**
 * グリッド線の位置（デバイス px。1px 線がにじまないよう整数 + 0.5）。
 * divide: 画面を n 等分する内側の n-1 本ずつ。pitch: 左上原点から px 間隔（0 と端ちょうどの線は引かない）。
 * width/height は CSS px、dpr はデバイスピクセル比。
 */
export function gridLines(
  spec: GridSpec,
  width: number,
  height: number,
  dpr: number,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  if (spec === 'none' || !(width > 0) || !(height > 0)) return { xs, ys };
  const k = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const at = (css: number) => Math.round(css * k) + 0.5;
  if (spec.kind === 'divide') {
    for (let i = 1; i < spec.n; i++) {
      xs.push(at((width * i) / spec.n));
      ys.push(at((height * i) / spec.n));
    }
  } else {
    for (let x = spec.px; x < width; x += spec.px) xs.push(at(x));
    for (let y = spec.px; y < height; y += spec.px) ys.push(at(y));
  }
  return { xs, ys };
}
