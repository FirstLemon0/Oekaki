/**
 * 日付ユーティリティ。
 *
 * アプリ内の「日付」は端末ローカルの暦日を `YYYY-MM-DD` 文字列で扱う。
 * 日数差の計算は UTC の真夜中として解釈することで、タイムゾーンや
 * サマータイムの影響を受けずに「暦日としての日数差」を安定して求める。
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` を UTC 深夜として解釈し、エポックからの通算日数を返す。 */
function dayIndex(day: string): number {
  const [y, m, d] = day.split('-').map((part) => Number(part));
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY;
}

/** `from` から `to` までの暦日数の差（`to` が後なら正の値）。 */
export function diffDays(from: string, to: string): number {
  return dayIndex(to) - dayIndex(from);
}

/** 今日の端末ローカル日を `YYYY-MM-DD` で返す。 */
export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 現在時刻の ISO 8601 文字列を返す。 */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
