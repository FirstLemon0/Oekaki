/**
 * ロックしたレッスンの隠し開放（実機フィードバック）: 3 秒以内に 10 回タップで開放する。
 * 純ロジック（Home のロックノードから使う）。
 */

/** 開放に要るタップ数 */
export const UNLOCK_TAPS = 10;
/** この時間の中で数える（ms） */
export const UNLOCK_WINDOW_MS = 3000;
/** この回数から「あと n 回で開放」を出す */
export const UNLOCK_HINT_FROM = 3;

export interface TapResult {
  /** 窓の中に残ったタップ時刻（次の呼び出しに渡す） */
  times: number[];
  /** 今のタップで開放に届いた */
  unlocked: boolean;
  /** 開放まであと何回 */
  left: number;
}

/** タップを 1 回数える。3 秒より前のタップは捨てる。10 回に届いたら unlocked（times は空に戻す） */
export function registerLockTap(times: readonly number[], now: number): TapResult {
  const kept = times.filter((t) => now - t < UNLOCK_WINDOW_MS && t <= now);
  kept.push(now);
  if (kept.length >= UNLOCK_TAPS) return { times: [], unlocked: true, left: 0 };
  return { times: kept, unlocked: false, left: UNLOCK_TAPS - kept.length };
}

/** 「あと n 回で開放」を出すか */
export function unlockHint(r: TapResult): string | null {
  if (r.unlocked || r.times.length < UNLOCK_HINT_FROM) return null;
  return `あと${r.left}回で開放`;
}
