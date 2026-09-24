/**
 * ルールベースの日本語 1 文助言。
 * 各検出器は Issue（深刻度つきの候補）を返し、pickHint が最も深刻なものを選ぶ。
 */
import { arcFractions, dist, jitterResiduals, mean, pathLength, rms } from './geometry';
import type { Stroke } from './types';

export interface Issue {
  /** 大きいほど深刻（0..100 目安）。 */
  severity: number;
  text: string;
}

export const HINT_GOOD = 'いい線です。この感覚を覚えておきましょう。';
export const HINT_TOO_SHORT = '線が短すぎて採点できません。もう少し長く描いてみましょう。';

/** 深刻度がこれ未満の候補は採用しない */
const MIN_SEVERITY = 25;

/** 弧長比 [u0, u1) の区間の平均速度（区間の弧長 / 所要時間）。時刻が無効なら NaN */
function regionSpeed(stroke: Stroke, u: number[], u0: number, u1: number): number {
  let len = 0;
  let dt = 0;
  for (let i = 1; i < stroke.length; i++) {
    const um = (u[i - 1]! + u[i]!) / 2;
    if (um < u0 || um >= u1) continue;
    len += dist(stroke[i - 1]!, stroke[i]!);
    dt += stroke[i]!.t - stroke[i - 1]!.t;
  }
  return dt > 0 ? len / dt : NaN;
}

function regionMean(values: readonly number[], u: number[], u0: number, u1: number): number {
  const xs: number[] = [];
  values.forEach((v, i) => {
    const ui = u[i]!;
    if (ui >= u0 && ui <= u1) xs.push(v);
  });
  return mean(xs);
}

/**
 * ストローク共通の検出: 終点のズレ（＋減速）、始点のフック、中盤のブレ。
 * @param heatRow このストロークの点ごとのズレ 0..1
 * @param jitterSub ブレの点数 0..100
 */
export function strokeIssues(stroke: Stroke, heatRow: readonly number[], jitterSub: number): Issue[] {
  const issues: Issue[] = [];
  if (stroke.length < 4 || pathLength(stroke) <= 0) return issues;
  const u = arcFractions(stroke);

  // 終点付近のズレ
  const hEnd = regionMean(heatRow, u, 0.85, 1);
  const hMid = regionMean(heatRow, u, 0.2, 0.75);
  if (hEnd > 0.3 && hEnd > 2 * hMid + 0.05) {
    const vEnd = regionSpeed(stroke, u, 0.8, 1.01);
    const vMid = regionSpeed(stroke, u, 0.2, 0.75);
    const slowed = Number.isFinite(vEnd) && Number.isFinite(vMid) && vMid > 0 && vEnd / vMid < 0.7;
    issues.push({
      severity: 40 + 50 * hEnd,
      text: slowed
        ? '終点で速度が落ちて曲がっています。最後まで一定速度で。'
        : '終点付近で線がそれています。最後まで狙った方向へ引き切りましょう。',
    });
  }

  // 始点のフック（描き始めの数点が本体と大きく違う向き）
  const L = pathLength(stroke);
  const at = (target: number) => {
    let i = 0;
    while (i < stroke.length - 1 && u[i]! < target) i++;
    return stroke[i]!;
  };
  const p0 = stroke[0]!;
  const pa = at(0.04);
  const pb = at(0.06);
  const pc = at(0.14);
  const hx = pa.x - p0.x;
  const hy = pa.y - p0.y;
  const mx = pc.x - pb.x;
  const my = pc.y - pb.y;
  const hl = Math.hypot(hx, hy);
  const ml = Math.hypot(mx, my);
  // 冒頭で最も本体の進行方向と逆に進んだ量
  let back = 0;
  if (ml > 0) {
    for (let i = 1; i < stroke.length && u[i]! <= 0.1; i++) {
      const s = ((stroke[i]!.x - p0.x) * mx + (stroke[i]!.y - p0.y) * my) / ml;
      back = Math.max(back, -s);
    }
  }
  if (hl > 0.004 * L && ml > 0) {
    const cos = (hx * mx + hy * my) / (hl * ml);
    if (cos < Math.cos((75 * Math.PI) / 180) || back > 0.01 * L) {
      issues.push({ severity: 70, text: '描き始めに引っかかりがあります。空中で3回なぞってから一気に。' });
    }
  } else if (back > 0.01 * L) {
    issues.push({ severity: 70, text: '描き始めに引っかかりがあります。空中で3回なぞってから一気に。' });
  }

  // 中盤の高周波ブレ
  if (jitterSub < 60) {
    const res = jitterResiduals(stroke);
    const n = res.length;
    const mid = res.slice(Math.floor(n * 0.2), Math.ceil(n * 0.8));
    if (rms(mid) >= 0.9 * rms(res)) {
      issues.push({ severity: 100 - jitterSub, text: '中ほどで細かく震えています。肘から動かして一気に引きましょう。' });
    }
  }
  return issues;
}

export function closureIssue(closureSub: number): Issue[] {
  if (closureSub >= 60) return [];
  return [{ severity: 100 - closureSub, text: '始点と終点がずれています。最後は始点を狙って。' }];
}

export function ellipseIssues(
  fitted: { degree: number; axisAngleDeg: number },
  target: { degree?: number; axisAngleDeg?: number },
  angleDiff: number,
): Issue[] {
  const out: Issue[] = [];
  if (target.degree !== undefined) {
    const d = fitted.degree - target.degree;
    const tgt = target.degree.toFixed(2);
    const got = fitted.degree.toFixed(2);
    if (d > 0.06) {
      out.push({
        severity: 30 + d * 400,
        text: `楕円が指定より丸くなっています（目標${tgt}→${got}）。短い方の幅をもう少し詰めて。`,
      });
    } else if (d < -0.06) {
      out.push({
        severity: 30 - d * 400,
        text: `楕円が指定より細くなっています（目標${tgt}→${got}）。短い方の幅をもう少し広げて。`,
      });
    }
  }
  if (target.axisAngleDeg !== undefined && angleDiff > 7 && fitted.degree < 0.92) {
    out.push({
      severity: 30 + angleDiff * 3,
      text: `楕円の軸が目標から約${Math.round(angleDiff)}°傾いています。長軸を目標の向きに合わせて。`,
    });
  }
  return out;
}

export function pressureIssues(
  profile: 'ramp-up' | 'ramp-down' | 'flat',
  slopePenalty: number,
  pressureSub: number,
): Issue[] {
  if (pressureSub >= 70) return [];
  const severity = 100 - pressureSub;
  if (profile === 'ramp-up' && slopePenalty > 0.05) {
    return [{ severity, text: '筆圧がだんだん強くなっていません。入りは軽く、終わりに向けて押し込みましょう。' }];
  }
  if (profile === 'ramp-down' && slopePenalty > 0.05) {
    return [{ severity, text: '筆圧が抜けていません。入りは強く、終わりに向けて力を抜きましょう。' }];
  }
  if (profile === 'flat') {
    return [{ severity, text: '筆圧が一定ではありません。最初から最後まで同じ力加減を保ちましょう。' }];
  }
  return [{ severity, text: '筆圧の変化がなめらかではありません。力の入れ抜きを少しずつ変えましょう。' }];
}

/** なぞりで全体が一方向にずれているとき（画面座標: y 下向き） */
export function traceOffsetIssues(off: { x: number; y: number }, diag: number, chamferSub: number): Issue[] {
  const mag = Math.hypot(off.x, off.y) / diag;
  if (chamferSub >= 75 || mag < 0.015) return [];
  const dir =
    Math.abs(off.x) >= Math.abs(off.y) ? (off.x > 0 ? '右' : '左') : off.y > 0 ? '下' : '上';
  return [
    {
      severity: 30 + (100 - chamferSub) * 0.7,
      text: `全体がお手本より${dir}にずれています。書き出しの位置をお手本の線に合わせましょう。`,
    },
  ];
}

/** 最弱の指標に対する一般的な助言 */
const SUB_TEXT: Record<string, string> = {
  'line.rmse': '全体的に線が揺れています。狙った直線の上をまっすぐ通しましょう。',
  'line.p90': '一部で大きくそれています。紙を回して引きやすい向きで描きましょう。',
  'line.endpoint': '始点と終点が目標に届いていません。点を見てから引き始めましょう。',
  'line.direction': '進む向きが途中で変わっています。一方向に迷わず引きましょう。',
  'curve.chamfer': 'お手本の曲線から離れています。曲がり始めの位置を確かめて。',
  'curve.smooth': '曲がり方がカクついています。手首ではなく腕全体で弧を描きましょう。',
  'circle.fit': '円がゆがんでいます。肩から回して、一定のカーブで描きましょう。',
  'circle.closure': '始点と終点がずれています。最後は始点を狙って。',
  'ellipse.fit': '楕円の輪郭がゆがんでいます。両端のカーブを同じ形にそろえましょう。',
  'ellipse.degree': '楕円の度合いが目標と違います。短い方の幅を意識して。',
  'ellipse.angle': '楕円の軸が傾いています。長軸の向きを先に決めてから描きましょう。',
  pressure: '筆圧の変化が目標と違います。力の入れ方を意識してゆっくり試しましょう。',
  'hatch.spacing': '線の間隔がばらついています。ひとつ前の線を見ながら同じ幅で並べましょう。',
  'hatch.angle': '線の角度がそろっていません。手首を固定して同じ向きで引きましょう。',
  'hatch.straight': '一本一本が曲がっています。短く速く、まっすぐ引きましょう。',
  'trace.chamfer': 'お手本の線から離れています。線の真上をゆっくりなぞりましょう。',
  'trace.iou': 'お手本と重なっていない部分があります。描き漏れや余分な線がないか確認して。',
  jitter: '線が細かく震えています。肘から動かして一気に引きましょう。',
};

/**
 * 候補から 1 文を選ぶ。候補が無ければ最弱指標（70 点未満）の一般助言、それも無ければ褒める。
 */
export function pickHint(issues: readonly Issue[], sub: Record<string, number>): string {
  const cand = issues.filter((i) => i.severity >= MIN_SEVERITY).sort((a, b) => b.severity - a.severity);
  if (cand[0]) return cand[0].text;
  let worstKey: string | null = null;
  let worst = 70;
  for (const [k, v] of Object.entries(sub)) {
    if (v < worst && SUB_TEXT[k]) {
      worst = v;
      worstKey = k;
    }
  }
  if (worstKey) return SUB_TEXT[worstKey]!;
  return HINT_GOOD;
}
