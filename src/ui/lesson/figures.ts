/**
 * 図解 SVG（content/figures/<id>.svg）を文字列で読む。
 * Vite の import.meta.glob（?raw・遅延）でビルドに同梱する。fetch と同じく非同期。
 */
const loaders = import.meta.glob('../../../content/figures/*.svg', { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

const byId = new Map<string, () => Promise<string>>();
for (const [path, load] of Object.entries(loaders)) {
  byId.set(path.replace(/^.*\//, '').replace(/\.svg$/, ''), load);
}

const cache = new Map<string, Promise<string | null>>();

export function hasFigure(id: string): boolean {
  return byId.has(id);
}

/** 図解の SVG 文字列。無ければ null */
export function loadFigure(id: string): Promise<string | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const load = byId.get(id);
  const pr = load ? load().catch(() => null) : Promise.resolve(null);
  cache.set(id, pr);
  return pr;
}

/**
 * キャンバスの重ね（画像として描く）用に、currentColor を実色へ置き換え、
 * 大きさを明示する（Image で読むとき幅・高さが無いと 0 になるブラウザがある）。
 */
export function svgForOverlay(svg: string, color: string): string {
  let s = svg.replace(/currentColor/g, color);
  const head = s.slice(0, s.indexOf('>'));
  // stroke-width= などに当たらないよう、空白の直後の width= だけを見る
  if (!/\swidth=/.test(head)) {
    // 縦横比は viewBox に合わせる（横に並べる図解＝inline SVG と同じ縮尺で重なるように）
    const vb = /viewBox\s*=\s*"\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(head);
    const w = vb ? Number(vb[1]) : 800;
    const h = vb ? Number(vb[2]) : 500;
    const k = w > 0 && h > 0 ? 1600 / Math.max(w, h) : 1;
    const W = w > 0 && h > 0 ? Math.round(w * k) : 800;
    const H = w > 0 && h > 0 ? Math.round(h * k) : 500;
    s = s.replace('<svg', `<svg width="${W}" height="${H}"`);
  }
  return s;
}
