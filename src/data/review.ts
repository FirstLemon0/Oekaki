/**
 * 復習カードの判定（DESIGN.md §4.1）。
 *
 * ドリル種別ごとに、以下のいずれかを満たせば「復習が必要」と判定し、
 * 翌日のウォームアップに差し込む対象とする。
 * - 直近3回のスコア平均が自己ベストの80%未満（`scoreDrop`。履歴が3件未満なら判定しない）
 * - 最終実施から14日以上経っている（`stale`）
 * 両方満たす場合は両方の理由を返す。履歴が空のドリルは対象外。
 */
import { diffDays, todayLocalDate } from './date';
import type { DrillStats } from './types';

export type DueReviewReason = 'scoreDrop' | 'stale';

export interface DueReview {
  drillType: string;
  reasons: DueReviewReason[];
  /** 直近3回（無ければそれ未満）の平均点。 */
  recentAverage: number;
  bestScore: number;
  /** 最終実施からの暦日数。 */
  daysSinceLast: number;
}

const RECENT_WINDOW = 3;
const SCORE_DROP_RATIO = 0.8;
const STALE_DAYS = 14;

export function dueReviews(stats: DrillStats[], today: string): DueReview[] {
  const result: DueReview[] = [];

  for (const stat of stats) {
    if (stat.history.length === 0) {
      continue;
    }

    const recent = stat.history.slice(-RECENT_WINDOW);
    const recentAverage = recent.reduce((sum, e) => sum + e.score, 0) / recent.length;
    const bestScore = stat.bestScore ?? Math.max(...stat.history.map((e) => e.score));

    const lastEntry = stat.history[stat.history.length - 1];
    // `at` は ISO（UTC）。先頭 10 文字は UTC の日付なので、端末ローカルの暦日に直してから比べる
    const daysSinceLast = lastEntry ? diffDays(todayLocalDate(new Date(lastEntry.at)), today) : 0;

    const reasons: DueReviewReason[] = [];
    // 履歴が 3 件未満だと「直近3回の平均」が成り立たず、1〜2 回の不調で出てしまうので判定しない
    if (
      stat.history.length >= RECENT_WINDOW &&
      bestScore > 0 &&
      recentAverage < bestScore * SCORE_DROP_RATIO
    ) {
      reasons.push('scoreDrop');
    }
    if (daysSinceLast >= STALE_DAYS) {
      reasons.push('stale');
    }

    if (reasons.length > 0) {
      result.push({ drillType: stat.drillType, reasons, recentAverage, bestScore, daysSinceLast });
    }
  }

  return result;
}
