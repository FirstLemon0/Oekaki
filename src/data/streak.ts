/**
 * ストリーク（連続記録）＋フリーズの純粋関数群。DESIGN.md §6。
 *
 * ルール（設計判断）:
 * - 同日に何度活動しても current は変化しない（重複無視）。
 * - 前回の活動日の「翌日」なら current + 1。
 * - 2 暦日以上空いた場合、フリーズを 1 個持っていれば「そのフリーズを 1 個消費して
 *   継続」（current + 1・freezes - 1）。フリーズが 0 個ならストリークをリセットする
 *   （current = 1、その日から再スタート）。何日空いても消費するフリーズは 1 個のみ
 *   （Duolingo のフリーズ挙動を踏襲）。
 * - フリーズは current が 7 の倍数の閾値（nextFreezeAt）に達するたびに 1 個獲得し、
 *   最大 2 個までしか保持しない（3個目以降は獲得しても切り捨て）。
 */
import { diffDays } from './date';
import type { Streak } from './types';

export type { Streak };

const MAX_FREEZES = 2;
const FREEZE_EVERY_DAYS = 7;

export function createInitialStreak(updatedAt: string): Streak {
  return {
    current: 0,
    longest: 0,
    freezes: 0,
    lastActiveDay: null,
    nextFreezeAt: FREEZE_EVERY_DAYS,
    updatedAt,
  };
}

/**
 * `current` が新しい閾値に達した分だけフリーズを獲得させる（7日ごと・最大2）。
 * 一度に複数の閾値を跨いでも、獲得数は上限でクリップされる。
 */
export function earnFreeze(streak: Streak): Streak {
  let freezes = streak.freezes;
  let nextFreezeAt = streak.nextFreezeAt;
  while (streak.current >= nextFreezeAt) {
    if (freezes < MAX_FREEZES) {
      freezes += 1;
    }
    nextFreezeAt += FREEZE_EVERY_DAYS;
  }
  if (freezes === streak.freezes && nextFreezeAt === streak.nextFreezeAt) {
    return streak;
  }
  return { ...streak, freezes, nextFreezeAt };
}

/**
 * `day`（YYYY-MM-DD）にアプリ内で「活動」（レッスン完了 or 5分以上の自由枠）が
 * あったことを記録し、更新後のストリークを返す。
 */
export function applyActivity(streak: Streak, day: string, updatedAt: string = day): Streak {
  if (streak.lastActiveDay === day) {
    // 同日重複は無視
    return streak;
  }

  let current: number;
  let freezes = streak.freezes;

  if (streak.lastActiveDay === null) {
    current = 1;
  } else {
    const gap = diffDays(streak.lastActiveDay, day);
    if (gap <= 0) {
      // 過去日への記録（時計のずれ等）は現状維持し、壊さない
      return streak;
    }
    if (gap === 1) {
      current = streak.current + 1;
    } else if (freezes > 0) {
      // 2日以上空いたが、フリーズを1つ消費して継続
      freezes -= 1;
      current = streak.current + 1;
    } else {
      // フリーズが無いのでリセット
      current = 1;
    }
  }

  const withFreezeEarned = earnFreeze({
    ...streak,
    current,
    freezes,
  });

  return {
    ...withFreezeEarned,
    longest: Math.max(streak.longest, current),
    lastActiveDay: day,
    updatedAt,
  };
}

/**
 * 「今日はフリーズを使って休む」を明示的に選んだときの処理。
 * フリーズを 1 個消費し、今日を活動日扱いにする（current は増やさない）。
 * 使えない場合（フリーズ 0、今日すでに活動済み、活動履歴なし）は null を返す。
 */
export function useFreezeToday(streak: Streak, today: string, updatedAt: string = today): Streak | null {
  if (streak.freezes <= 0) return null;
  if (streak.lastActiveDay === null || streak.current === 0) return null;
  if (streak.lastActiveDay === today) return null;
  if (diffDays(streak.lastActiveDay, today) <= 0) return null;
  return {
    ...streak,
    freezes: streak.freezes - 1,
    lastActiveDay: today,
    updatedAt,
  };
}

export interface FreezeCheckResult {
  /** 今日まだ活動しておらず、このままだとストリークが途切れうる状態か。 */
  atRisk: boolean;
  /** 最終活動日から今日までの暦日数（活動履歴が無ければ null）。 */
  daysSinceActive: number | null;
  /** 今日活動しないまま日をまたいだ場合、次の活動でフリーズが消費される見込みか。 */
  willConsumeFreeze: boolean;
  freezesRemaining: number;
}

/** 「今日の活動が無い時点」でのストリーク危機判定。 */
export function freezeCheck(streak: Streak, today: string): FreezeCheckResult {
  if (streak.lastActiveDay === null || streak.current === 0) {
    return {
      atRisk: false,
      daysSinceActive: null,
      willConsumeFreeze: false,
      freezesRemaining: streak.freezes,
    };
  }

  const daysSinceActive = diffDays(streak.lastActiveDay, today);
  const atRisk = daysSinceActive >= 1;
  // 今日を活動なしで終えると空き幅が2日以上になり、フリーズ消費 or リセットの対象になる
  const willConsumeFreeze = daysSinceActive >= 1 && streak.freezes > 0;

  return {
    atRisk,
    daysSinceActive,
    willConsumeFreeze,
    freezesRemaining: streak.freezes,
  };
}
