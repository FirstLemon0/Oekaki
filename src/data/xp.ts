/**
 * XP とレベル（DESIGN.md §6：「表示のみ。進級や解錠には使わない」）。
 *
 * 付与量: レッスン完了 10、ドリル 1〜5（点数帯）、模写チェックポイント 20、
 * 卒業課題 30。レベルは `floor(sqrt(xp / 50)) + 1` という単純な式で決める
 * （閾値: レベル L の開始 xp は `50 * (L - 1)^2`）。この値は演出（レベル表示・
 * 次のレベルまでのバー）にのみ使い、進級・機能解錠の判定には一切使わない。
 */

export type XpEventType = 'lesson' | 'drill' | 'checkpoint' | 'graduation';

const FIXED_XP: Record<Exclude<XpEventType, 'drill'>, number> = {
  lesson: 10,
  checkpoint: 20,
  graduation: 30,
};

/** ドリルの点数帯（0〜100）から XP（1〜5）を決める。 */
export function xpForDrillScore(score: number): number {
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  return 1;
}

/** イベント種別（＋ドリルなら点数）から獲得 XP を返す。 */
export function xpForEvent(type: XpEventType, drillScore?: number): number {
  if (type === 'drill') {
    return xpForDrillScore(drillScore ?? 0);
  }
  return FIXED_XP[type];
}

const XP_PER_LEVEL_UNIT = 50;

/** 累計 XP から表示用レベルを算出する。 */
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / XP_PER_LEVEL_UNIT)) + 1;
}

/** そのレベルに到達するのに必要な最小累計 XP（`levelForXp` の逆算）。 */
export function xpThresholdForLevel(level: number): number {
  const clamped = Math.max(1, level);
  return XP_PER_LEVEL_UNIT * (clamped - 1) ** 2;
}
