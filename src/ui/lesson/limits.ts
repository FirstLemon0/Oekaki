/**
 * 批評の送信可否（純ロジック）と、校正ベースラインの保存形式。
 */
import { METRIC_KEYS, defaultBaseline, makeScorers, type Baseline, type Scorers } from '@/scoring';
import { todayLocalDate } from '@/data/date';
import type { CalibrationResult, Critique } from '@/data/types';

// ---------------------------------------------------------------------------
// 批評の上限
// ---------------------------------------------------------------------------

/** 今日（端末ローカル）に行った批評の件数 */
export function critiquesToday(list: readonly Pick<Critique, 'createdAt'>[], today: string): number {
  return list.filter((c) => todayLocalDate(new Date(c.createdAt)) === today).length;
}

export type CritiqueGate = { ok: true; remaining: number } | { ok: false; reason: 'no_api_key' | 'daily_limit' };

/** 送ってよいか。キー未設定 → no_api_key、今日の件数 ≥ 上限 → daily_limit */
export function critiqueGate(apiKey: string | null | undefined, limit: number, usedToday: number): CritiqueGate {
  if (!apiKey || apiKey.trim() === '') return { ok: false, reason: 'no_api_key' };
  const cap = Math.max(0, Math.floor(limit));
  if (usedToday >= cap) return { ok: false, reason: 'daily_limit' };
  return { ok: true, remaining: cap - usedToday };
}

// ---------------------------------------------------------------------------
// 校正
// ---------------------------------------------------------------------------

const GAMMA_KEY = '__gamma';

/** Baseline → profile.calibration.baselines（k と gamma を平らに入れる） */
export function baselineToRecord(b: Baseline): Record<string, number> {
  const rec: Record<string, number> = { [GAMMA_KEY]: b.gamma };
  for (const key of METRIC_KEYS) rec[key] = b.k[key];
  return rec;
}

/** profile.calibration.baselines → Baseline。欠けや不正があれば null */
export function recordToBaseline(rec: Record<string, number> | null | undefined): Baseline | null {
  if (!rec) return null;
  const gamma = rec[GAMMA_KEY];
  if (typeof gamma !== 'number' || !Number.isFinite(gamma) || gamma <= 0) return null;
  const k = {} as Baseline['k'];
  for (const key of METRIC_KEYS) {
    const v = rec[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    k[key] = v;
  }
  return { gamma, k };
}

/** 厳しさ 'easy' は k を 0.8 倍（同じ誤差で点数が上がる） */
export function applyStrictness(b: Baseline, strictness: 'easy' | 'normal'): Baseline {
  if (strictness !== 'easy') return b;
  const k = {} as Baseline['k'];
  for (const key of METRIC_KEYS) k[key] = b.k[key] * 0.8;
  return { gamma: b.gamma, k };
}

/** 保存済みの校正と厳しさから、採点に使う Baseline を決める */
export function effectiveBaseline(calibration: CalibrationResult | null | undefined, strictness: 'easy' | 'normal'): Baseline {
  const base = recordToBaseline(calibration?.baselines) ?? defaultBaseline;
  return applyStrictness(base, strictness);
}

export function scorersFor(calibration: CalibrationResult | null | undefined, strictness: 'easy' | 'normal'): Scorers {
  return makeScorers(effectiveBaseline(calibration, strictness));
}

/** 校正で描かせる本数 */
export const CALIBRATION_PLAN = [
  { key: 'lines', label: '直線', count: 5, instruction: 'まっすぐな線を5本。長さと向きは自由です。' },
  { key: 'circles', label: '円', count: 3, instruction: '円を3つ。1筆で閉じるように描きます。' },
  { key: 'ellipses', label: '楕円', count: 3, instruction: '楕円を3つ。つぶれ具合と向きは自由です。' },
] as const;
