/**
 * Before/After ギャラリーの月次描き直し通知（DESIGN.md §4.1・§6）。
 *
 * Before を保存した日を起点に、30日ごとに「同じお題を描き直す」通知を出す。
 * 通知を一度出したら `profile.lastMonthlyPromptAt` を更新してもらう想定で、
 * 次回の起点は「前回通知日から30日後」になる（`beforeCreatedAt` からの固定周期
 * ではなく、通知を出すたびに周期が繰り上がる）。
 */
import { diffDays } from './date';
import type { Profile } from './types';

const PROMPT_INTERVAL_DAYS = 30;

export function monthlyPromptDue(profile: Profile, today: string): boolean {
  if (!profile.beforeCreatedAt) {
    return false;
  }
  const anchor = profile.lastMonthlyPromptAt ?? profile.beforeCreatedAt;
  return diffDays(anchor, today) >= PROMPT_INTERVAL_DAYS;
}
