/**
 * 新しいお絵描きを開けずに今までのお絵描きに戻した（か「開けませんでした」を出した）理由の記録（ilust-sup-followup-13、RQ-7 の切り分け用）。
 *
 * - 理由: connectOgEmbed の失敗（missing / version / boot / timeout）と、繋がった後に紙を用意できなかった（open）
 * - 通知の末尾に「（理由: timeout）」の形で付ける
 * - 最後の 1 件を localStorage（`seichotsu.ogFallback.last` = { reason, at, buildId }）に残し、設定の画面に 1 行出す
 *   （端末の中だけ。成長通の DB・バックアップには入れない）
 */
import type { OgConnectFailure } from './embedApi';

export type OgFallbackReason = OgConnectFailure | 'open';

export const OG_FALLBACK_KEY = 'seichotsu.ogFallback.last';

export const OG_FALLBACK_REASONS: readonly OgFallbackReason[] = ['missing', 'version', 'boot', 'timeout', 'open'];

/** 設定の画面に出す短い説明 */
export const OG_FALLBACK_REASON_TEXT: Record<OgFallbackReason, string> = {
  missing: '埋め込みのペイントが見つからない',
  version: '埋め込みのペイントの版が違う',
  boot: '埋め込みのペイントの起動に失敗',
  timeout: '埋め込みのペイントの起動の時間切れ',
  open: '紙を用意できない',
};

export interface OgFallbackRecord {
  reason: OgFallbackReason;
  /** ISO 8601 */
  at: string;
  /** 取り込んだ成果物の buildId（無ければ 'none'） */
  buildId: string;
}

/** 記録の置き場（localStorage。無い・使えない環境では null） */
export function fallbackStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 通知の文の末尾に理由を付ける */
export function withReason(text: string, reason: OgFallbackReason): string {
  return `${text}（理由: ${reason}）`;
}

export function parseFallbackRecord(raw: string | null): OgFallbackRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<OgFallbackRecord> | null;
    if (!o || !OG_FALLBACK_REASONS.includes(o.reason as OgFallbackReason) || typeof o.at !== 'string' || !Number.isFinite(Date.parse(o.at))) return null;
    return { reason: o.reason as OgFallbackReason, at: o.at, buildId: typeof o.buildId === 'string' ? o.buildId : 'none' };
  } catch {
    return null;
  }
}

/** 最後の理由を残す（書けなくても何もしない） */
export function recordFallback(storage: Storage | null, reason: OgFallbackReason, buildId: string | null, now: Date = new Date()): OgFallbackRecord {
  const rec: OgFallbackRecord = { reason, at: now.toISOString(), buildId: buildId ?? 'none' };
  try {
    storage?.setItem(OG_FALLBACK_KEY, JSON.stringify(rec));
  } catch {
    // 容量不足・使えない: 記録は諦める（通知の理由は出る）
  }
  return rec;
}

export function readFallback(storage: Storage | null): OgFallbackRecord | null {
  try {
    return parseFallbackRecord(storage?.getItem(OG_FALLBACK_KEY) ?? null);
  } catch {
    return null;
  }
}

/** 設定の画面の 1 行（例「最後に戻った理由: timeout（埋め込みのペイントの起動の時間切れ）・2026/10/22 07:40・版 baabbe0ab899-…」） */
export function formatFallbackLine(rec: OgFallbackRecord): string {
  const d = new Date(rec.at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `最後に今までのお絵描きに戻った理由: ${rec.reason}（${OG_FALLBACK_REASON_TEXT[rec.reason]}）・${when}・版 ${rec.buildId}`;
}
