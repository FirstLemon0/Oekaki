/**
 * ドリルの「採点済みの線」の扱い（純ロジック。DrillRunner から使う）。
 */
import type { Drawing, ScoreResult, Stroke } from '@/scoring';
import { average } from './steps';

/** 採点した 1 本（ハッチングは 1 セット） */
export interface DrillEntry {
  /** キャンバス上の線と対応づける鍵（最初の点） */
  keys: string[];
  strokes: Drawing;
  result: ScoreResult;
  target: Drawing | null;
}

/** ストロークの鍵（getStrokes はコピーを返すので、最初の点の値で対応づける） */
export function strokeKey(s: Stroke): string {
  const q = s[0];
  return q ? `${q.x.toFixed(2)},${q.y.toFixed(2)},${q.t}` : '';
}

/** キャンバスから消えた（Undo・消しゴム・全消し）線の採点を外す */
export function syncEntries(entries: readonly DrillEntry[], onCanvas: Drawing): DrillEntry[] {
  const present = new Set(onCanvas.map(strokeKey));
  return entries.filter((e) => e.keys.every((k) => present.has(k)));
}

/** セット全体のまとめ（平均点・サブ指標の平均・一番低い本の助言） */
export function summarizeEntries(entries: readonly DrillEntry[]): ScoreResult | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]!.result;
  const sub: Record<string, number> = {};
  const keys = new Set(entries.flatMap((e) => Object.keys(e.result.sub)));
  for (const k of keys) {
    const vs = entries.map((e) => e.result.sub[k]).filter((v): v is number => typeof v === 'number');
    if (vs.length > 0) sub[k] = Math.round(vs.reduce((a, b) => a + b, 0) / vs.length);
  }
  const worst = entries.reduce((a, b) => (b.result.score < a.result.score ? b : a));
  return {
    score: average(entries.map((e) => e.result.score)) ?? 0,
    sub,
    hint: worst.result.hint,
    heat: entries.flatMap((e) => e.result.heat),
    raw: {},
  };
}
