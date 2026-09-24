/**
 * ドリルの「目標」と画面上の手がかり（純ロジック）。
 *
 * キャンバスの大きさ（CSS px）と教材の params から、1 本ごとの目標を作る。
 * 番号ごとに少しずつ位置を変える（同じ場所をなぞるだけにならないように）。乱数は番号から決まる。
 *
 * 角度の向きは採点側（src/scoring/geometry.ts lineAngleDeg / fitEllipse）と同じく
 * 画面座標（y 下向き）の atan2。30° は時計回りに 30° 傾いた向き。
 */
import type {
  Drawing,
  EllipseTarget,
  HatchingTarget,
  LineTarget,
  ScoreResult,
  Scorers,
  Stroke,
  StrokePoint,
  Vec2,
} from '@/scoring';
import { pressureProfileOf, type DrillType } from './steps';

export interface Size {
  width: number;
  height: number;
}

type Params = Record<string, number | string> | undefined;

/** 画面に出す手がかり（キャンバスの上に SVG で重ねる。ペン入力は通す） */
export interface DrillGuide {
  /** 目標の点（2 点を結ぶ・指定点を通る） */
  points: Vec2[];
  /** 破線で見せる目標の線 */
  path: Vec2[] | null;
  /** ハッチングを埋める枠 */
  area: { x: number; y: number; w: number; h: number } | null;
  /** 右上に出す小さな見本（楕円の度合い・向き／ハッチングの角度） */
  sample: { kind: 'ellipse'; degree: number; axisAngleDeg: number } | { kind: 'hatch'; angleDeg: number; spacing: number } | null;
}

export interface DrillSetup {
  guide: DrillGuide;
  line?: LineTarget;
  curve?: Stroke;
  ellipse?: EllipseTarget;
  hatching?: HatchingTarget;
  pressure?: 'ramp-up' | 'ramp-down' | 'flat';
}

const EMPTY_GUIDE: DrillGuide = { points: [], path: null, area: null, sample: null };

/** 番号から決まる乱数（mulberry32） */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function num(p: Params, key: string): number | undefined {
  const v = p?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(p: Params, key: string): string | undefined {
  const v = p?.[key];
  return typeof v === 'string' ? v : undefined;
}

function toStroke(pts: Vec2[]): Stroke {
  return pts.map((q, i): StrokePoint => ({ x: q.x, y: q.y, p: 0.5, t: i * 10 }));
}

/** 点列を通る Catmull-Rom 曲線 */
export function catmullRom(points: Vec2[], perSeg = 24): Vec2[] {
  if (points.length < 2) return [...points];
  const out: Vec2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

function lineSetup(params: Params, size: Size, rnd: () => number): DrillSetup {
  if (str(params, 'mode') !== 'two-points') return { guide: EMPTY_GUIDE };
  const m = Math.min(size.width, size.height);
  const long = str(params, 'length') === 'long';
  const len = m * (long ? 0.6 : 0.3) * (0.9 + rnd() * 0.2);
  const o = str(params, 'orientation') ?? 'h';
  let ang = 0;
  if (o === 'v') ang = Math.PI / 2;
  else if (o === 'd') ang = (rnd() < 0.5 ? 1 : -1) * (Math.PI / 6 + rnd() * (Math.PI / 6));
  const cx = size.width / 2 + (rnd() - 0.5) * (size.width - len) * 0.5;
  const cy = size.height / 2 + (rnd() - 0.5) * (size.height - len) * 0.4;
  const dx = (Math.cos(ang) * len) / 2;
  const dy = (Math.sin(ang) * len) / 2;
  const from = { x: cx - dx, y: cy - dy };
  const to = { x: cx + dx, y: cy + dy };
  return { guide: { ...EMPTY_GUIDE, points: [from, to] }, line: { from, to } };
}

function curvePoints(params: Params, size: Size, rnd: () => number): { pts: Vec2[]; anchors: Vec2[] | null } {
  const m = Math.min(size.width, size.height);
  const cx = size.width / 2 + (rnd() - 0.5) * size.width * 0.15;
  const cy = size.height / 2 + (rnd() - 0.5) * size.height * 0.1;
  const shape = str(params, 'shape') ?? 'c';
  const N = 96;
  const pts: Vec2[] = [];
  if (shape === 's') {
    const horizontal = str(params, 'direction') === 'horizontal';
    const L = m * 0.55;
    const A = m * 0.13;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const along = -L / 2 + L * t;
      const across = A * Math.sin(2 * Math.PI * t);
      pts.push(horizontal ? { x: cx + along, y: cy - across } : { x: cx + across, y: cy + along });
    }
    return { pts, anchors: null };
  }
  if (shape === 'wave') {
    const L = size.width * 0.6;
    const A = m * 0.08;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push({ x: cx - L / 2 + L * t, y: cy + A * Math.sin(2 * Math.PI * 2 * t) });
    }
    return { pts, anchors: null };
  }
  if (shape === 'spiral') {
    const R = m * 0.3;
    const turns = 2.5;
    for (let i = 0; i <= N * 2; i++) {
      const t = i / (N * 2);
      const r = R * (0.12 + 0.88 * t);
      const th = 2 * Math.PI * turns * t;
      pts.push({ x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) });
    }
    return { pts, anchors: null };
  }
  if (shape === 'through-points') {
    const n = Math.max(2, Math.min(6, Math.round(num(params, 'points') ?? 3)));
    const L = size.width * 0.55;
    const anchors: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const up = i % 2 === 0 ? -1 : 1;
      anchors.push({ x: cx - L / 2 + L * t, y: cy + up * m * (0.08 + rnd() * 0.1) });
    }
    return { pts: catmullRom(anchors), anchors };
  }
  // 'c'（既定）: 右に開いた C
  const R = m * 0.22;
  const strong = str(params, 'bend') === 'strong';
  const half = strong ? (Math.PI * 5) / 6 : Math.PI / 2;
  for (let i = 0; i <= N; i++) {
    const th = Math.PI - half + ((2 * half) * i) / N;
    // 上から下へ（左回り）描く想定: th を逆順に
    const a = 2 * Math.PI - th;
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return { pts, anchors: null };
}

/** ドリル 1 本ぶんの目標と手がかり */
export function drillSetup(drill: DrillType, params: Params, size: Size, index: number): DrillSetup {
  const rnd = seeded(index * 7919 + 17);
  if (size.width <= 0 || size.height <= 0) return { guide: EMPTY_GUIDE };
  switch (drill) {
    case 'line':
      return lineSetup(params, size, rnd);
    case 'curve': {
      const { pts, anchors } = curvePoints(params, size, rnd);
      return {
        guide: { ...EMPTY_GUIDE, points: anchors ?? [], path: anchors ? null : pts },
        curve: toStroke(pts),
      };
    }
    case 'circle':
      return { guide: EMPTY_GUIDE };
    case 'ellipse': {
      const degree = num(params, 'degree');
      const axisAngleDeg = num(params, 'axisAngleDeg');
      const target: EllipseTarget = {};
      if (degree !== undefined) target.degree = degree > 1 ? Math.min(1, degree / 90) : degree;
      if (axisAngleDeg !== undefined) target.axisAngleDeg = axisAngleDeg;
      return {
        guide: {
          ...EMPTY_GUIDE,
          sample: { kind: 'ellipse', degree: target.degree ?? 0.5, axisAngleDeg: target.axisAngleDeg ?? 0 },
        },
        ellipse: target,
      };
    }
    case 'pressure':
      return { guide: EMPTY_GUIDE, pressure: pressureProfileOf(params?.profile) };
    case 'hatching': {
      const m = Math.min(size.width, size.height);
      const w = m * 0.42;
      const h = m * 0.42;
      const x = (size.width - w) / 2;
      const y = (size.height - h) / 2;
      const spacing = num(params, 'spacing');
      const angleDeg = num(params, 'angleDeg');
      const target: HatchingTarget = {};
      if (spacing !== undefined) target.spacing = spacing;
      if (angleDeg !== undefined) target.angleDeg = ((angleDeg % 180) + 180) % 180;
      return {
        guide: {
          ...EMPTY_GUIDE,
          area: { x, y, w, h },
          sample: { kind: 'hatch', angleDeg: target.angleDeg ?? 45, spacing: target.spacing ?? 14 },
        },
        hatching: target,
      };
    }
  }
}

/** 1 本（ハッチングは 1 セット）を採点する */
export function scoreDrill(scorers: Scorers, drill: DrillType, setup: DrillSetup, strokes: Drawing): ScoreResult | null {
  const usable = strokes.filter((s) => s.length >= 2);
  if (usable.length === 0) return null;
  const last = usable[usable.length - 1]!;
  switch (drill) {
    case 'line':
      return scorers.scoreLine(last, setup.line);
    case 'curve':
      return setup.curve ? scorers.scoreCurve(last, setup.curve) : scorers.jitterScore(last);
    case 'circle':
      return scorers.scoreCircle(last);
    case 'ellipse':
      return scorers.scoreEllipse(last, setup.ellipse);
    case 'pressure':
      return scorers.scorePressure(last, setup.pressure ?? 'ramp-up');
    case 'hatching':
      return scorers.scoreHatching(usable, setup.hatching);
  }
}

/** なぞりテンプレート（0..1 正規化）をキャンバスの中央に収める */
export function fitTemplate(template: Drawing, size: Size, fill = 0.82): Drawing {
  const S = Math.min(size.width, size.height) * fill;
  const ox = (size.width - S) / 2;
  const oy = (size.height - S) / 2;
  return template.map((s) => s.map((q) => ({ ...q, x: ox + q.x * S, y: oy + q.y * S })));
}

/** ヒートマップの色段階 */
export function heatBand(v: number): 'good' | 'mid' | 'bad' {
  if (v < 0.34) return 'good';
  if (v < 0.67) return 'mid';
  return 'bad';
}
