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
import type { StrokeStyle } from '@/canvas';

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

/**
 * 教材 params のうち、目標が無くても採点に足せる条件（scoreDrill で点数に混ぜる）。
 * minDim はキャンバスの短辺（長さ・大きさの比の基準）。
 */
export interface DrillChecks {
  minDim: number;
  /** 直線の向き（h 水平・v 垂直・d 斜め）。2 点を結ぶ目標があるときは目標が向きを決めるので使わない */
  orientation?: 'h' | 'v' | 'd';
  /** 直線の長さ */
  length?: 'short' | 'long';
  /** 円の大きさ */
  circleSize?: 'small' | 'medium' | 'large';
  /** 曲線の抜き（終わりに向けて細く＝筆圧を下げる） */
  taper?: 'out';
}

export interface DrillSetup {
  guide: DrillGuide;
  checks?: DrillChecks;
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

function lineChecks(params: Params, size: Size): DrillChecks {
  const o = str(params, 'orientation');
  const len = str(params, 'length');
  return {
    minDim: Math.min(size.width, size.height),
    ...(o === 'h' || o === 'v' || o === 'd' ? { orientation: o } : {}),
    ...(len === 'short' || len === 'long' ? { length: len } : {}),
  };
}

function lineSetup(params: Params, size: Size, rnd: () => number): DrillSetup {
  if (str(params, 'mode') !== 'two-points') return { guide: EMPTY_GUIDE, checks: lineChecks(params, size) };
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
        ...(str(params, 'taper') === 'out' ? { checks: { minDim: Math.min(size.width, size.height), taper: 'out' as const } } : {}),
      };
    }
    case 'circle': {
      const sz = str(params, 'size');
      return {
        guide: EMPTY_GUIDE,
        ...(sz === 'small' || sz === 'medium' || sz === 'large'
          ? { checks: { minDim: Math.min(size.width, size.height), circleSize: sz } }
          : {}),
      };
    }
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

// ---------------------------------------------------------------------------
// params の条件を点数に混ぜる
// ---------------------------------------------------------------------------

/** 条件の点数（0..100）を weight の重みで総合点に混ぜ、サブ指標に足す。条件が低いときは助言も差し替える */
function blend(r: ScoreResult, key: string, value: number, weight: number, hint: string): ScoreResult {
  const v = Math.max(0, Math.min(100, value));
  return {
    ...r,
    score: Math.round(r.score * (1 - weight) + v * weight),
    sub: { ...r.sub, [key]: Math.round(v) },
    hint: v < 60 ? hint : r.hint,
  };
}

/** 水平からの傾き（0..90°）。angleDeg は 0..180 の軸の向き */
function tiltFromHorizontal(angleDeg: number): number {
  const a = ((angleDeg % 180) + 180) % 180;
  return Math.min(a, 180 - a);
}

/** 向きのズレ（°）。斜めは 20〜70° を許す */
export function orientationError(angleDeg: number, orientation: 'h' | 'v' | 'd'): number {
  const t = tiltFromHorizontal(angleDeg);
  if (orientation === 'h') return t;
  if (orientation === 'v') return 90 - t;
  if (t < 20) return 20 - t;
  if (t > 70) return t - 70;
  return 0;
}

const ORIENT_HINT: Record<'h' | 'v' | 'd', string> = {
  h: '向きがずれています。水平（横まっすぐ）を狙って引きましょう。',
  v: '向きがずれています。垂直（縦まっすぐ）を狙って引きましょう。',
  d: '向きがずれています。斜め（45° くらい）を狙って引きましょう。',
};

function applyLineChecks(r: ScoreResult, c: DrillChecks): ScoreResult {
  let out = r;
  const angle = r.raw.angleDeg;
  if (c.orientation && typeof angle === 'number') {
    const err = orientationError(angle, c.orientation);
    out = blend(out, 'line.orient', 100 - Math.max(0, err - 4) * 3, 0.35, ORIENT_HINT[c.orientation]);
  }
  const L = r.raw.length;
  if (c.length && typeof L === 'number' && c.minDim > 0) {
    const ratio = L / c.minDim;
    if (c.length === 'long') {
      out = blend(out, 'line.length', (ratio / 0.45) * 100, 0.2, 'もう少し長く、画面いっぱいを目指して肩から引きましょう。');
    } else {
      out = blend(out, 'line.length', ratio <= 0.3 ? 100 : (1 - (ratio - 0.3) / 0.3) * 100, 0.2, '長すぎます。手首だけで短く引きましょう。');
    }
  }
  return out;
}

/** 円の半径の許す範囲（短辺に対する比） */
const CIRCLE_RANGE: Record<'small' | 'medium' | 'large', [number, number]> = {
  small: [0.015, 0.12],
  medium: [0.08, 0.3],
  large: [0.2, 0.5],
};

const CIRCLE_HINT: Record<'small' | 'medium' | 'large', string> = {
  small: '大きさが違います。指1〜2本分くらいの小さな円にしましょう。',
  medium: '大きさが違います。手のひらくらいの中くらいの円にしましょう。',
  large: '大きさが違います。画面の半分くらいの大きな円にしましょう。',
};

function applyCircleChecks(r: ScoreResult, c: DrillChecks): ScoreResult {
  const radius = r.raw.r;
  if (!c.circleSize || typeof radius !== 'number' || c.minDim <= 0) return r;
  const ratio = radius / c.minDim;
  const [lo, hi] = CIRCLE_RANGE[c.circleSize];
  const off = ratio < lo ? (lo - ratio) / lo : ratio > hi ? (ratio - hi) / hi : 0;
  return blend(r, 'circle.size', (1 - off * 1.5) * 100, 0.2, CIRCLE_HINT[c.circleSize]);
}

/**
 * 抜き（終わりに向けて筆圧を下げる）の点数。筆圧の差が無い入力（マウス・指）では null（採点に混ぜない）。
 */
export function taperOutScore(stroke: Stroke): number | null {
  const ps = stroke.map((q) => q.p);
  if (ps.length < 8) return null;
  const max = Math.max(...ps);
  const min = Math.min(...ps);
  if (max - min < 0.05) return null;
  const n = ps.length;
  const mean = (a: number, b: number) => {
    const xs = ps.slice(Math.floor(a * n), Math.max(Math.floor(a * n) + 1, Math.floor(b * n)));
    return xs.reduce((x, y) => x + y, 0) / xs.length;
  };
  const mid = mean(0.3, 0.7);
  const end = mean(0.85, 1);
  if (!(mid > 0)) return null;
  const ratio = end / mid;
  return ratio <= 0.7 ? 100 : Math.max(0, ((1 - ratio) / 0.3) * 100);
}

function applyTaper(r: ScoreResult, c: DrillChecks | undefined, stroke: Stroke): ScoreResult {
  if (c?.taper !== 'out') return r;
  const v = taperOutScore(stroke);
  if (v === null) return r;
  return blend(r, 'curve.taper', v, 0.2, '最後はペンを持ち上げながら、細く抜きましょう。');
}

/** 1 本（ハッチングは 1 セット）を採点する */
export function scoreDrill(scorers: Scorers, drill: DrillType, setup: DrillSetup, strokes: Drawing): ScoreResult | null {
  const usable = strokes.filter((s) => s.length >= 2);
  if (usable.length === 0) return null;
  const last = usable[usable.length - 1]!;
  switch (drill) {
    case 'line': {
      const r = scorers.scoreLine(last, setup.line);
      return !setup.line && setup.checks ? applyLineChecks(r, setup.checks) : r;
    }
    case 'curve': {
      const r = setup.curve ? scorers.scoreCurve(last, setup.curve) : scorers.jitterScore(last);
      return applyTaper(r, setup.checks, last);
    }
    case 'circle': {
      const r = scorers.scoreCircle(last);
      return setup.checks ? applyCircleChecks(r, setup.checks) : r;
    }
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

/**
 * 紙の大きさが from → to に変わったときの点の写し方。
 * 中心をそろえ、短辺の比で拡縮する（fitTemplate・ドリルの目標と同じ規則）。
 */
export function rescaleMap(from: Size, to: Size): (q: StrokePoint) => StrokePoint {
  const k = Math.min(to.width, to.height) / Math.max(1, Math.min(from.width, from.height));
  return (q) => ({ ...q, x: to.width / 2 + (q.x - from.width / 2) * k, y: to.height / 2 + (q.y - from.height / 2) * k });
}

/**
 * 前のステップの線（消しゴム・補助線を含む生の履歴）を、今の紙の大きさへ写す（rescaleMap と同じ規則）。
 * 大きさが同じならそのままのコピー。styles は並びごと引き継ぐ。
 */
export function carryHistory(
  h: { strokes: Drawing; styles: readonly (StrokeStyle | undefined)[] },
  from: Size,
  to: Size,
): { strokes: Drawing; styles: (StrokeStyle | undefined)[] } {
  const same = from.width === to.width && from.height === to.height;
  const map = same ? (q: StrokePoint) => ({ ...q }) : rescaleMap(from, to);
  return { strokes: h.strokes.map((s) => s.map(map)), styles: [...h.styles] };
}

/**
 * ドリルで自動的に取り消す「点」の閾値: 点が 2 個未満、または線の長さ（折れ線の長さ）が 12px 未満。
 * 取り消すのはドリル（1 本ごとに採点するもの）だけ。ハッチング（セットで採点）と、
 * trace / copy / construct / free / mosha / gesture ではエンジンがそのまま残す。
 */
export const DRILL_MIN_STROKE_PX = 12;

export function isTooShortForDrill(s: Stroke): boolean {
  if (s.length < 2) return true;
  let L = 0;
  for (let i = 1; i < s.length; i++) L += Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y);
  return L < DRILL_MIN_STROKE_PX;
}

/** ヒートマップの色段階 */
export function heatBand(v: number): 'good' | 'mid' | 'bad' {
  if (v < 0.34) return 'good';
  if (v < 0.67) return 'mid';
  return 'bad';
}
