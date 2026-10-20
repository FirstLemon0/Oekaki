/**
 * 自由お絵描き（#/free）の描画エンジンの選び方（UR-002 / ADR-0007 D4-4・D7）。
 *
 * - 設定 `paintEngine`（data/types の Settings。任意の項目）が 'og' なら新しいお絵描き（埋め込みのペイント、OgFreeDraw）、
 *   'v2' なら今までのお絵描き v2（FreeDraw）。未設定なら DEFAULT_PAINT_ENGINE。
 * - 段階: S2 = 既定 'v2'（設定の「新しいお絵描き（試験中）」で 'og'）。S3 = 既定 'og'（設定で 'v2' に戻せる）。
 *   利用者から不具合の報告があれば、ここを 'v2' に戻すコミットを先に出す（ADR-0007 D7）。
 * - レッスンの採点のキャンバスはいつも v2（ここは #/free だけ）。
 * - ギャラリーの「続きから描く」（#/free?og=<id>）は、設定に関わらず新しいお絵描きで開く（その絵は新しいお絵描きの文書なので）。
 */
import type { PaintEngine, Settings } from '@/data/types';

/** 設定で選んでいないときのエンジン */
export const DEFAULT_PAINT_ENGINE: PaintEngine = 'v2';

/** 設定の「新しいお絵描き（試験中）」の文言 */
export const PAINT_ENGINE_LABEL = '新しいお絵描き（試験中）';

export function isPaintEngine(v: unknown): v is PaintEngine {
  return v === 'og' || v === 'v2';
}

/** 設定から今のエンジンを決める（未設定・不正な値は既定） */
export function resolvePaintEngine(s: Pick<Settings, 'paintEngine'> | null | undefined, fallback: PaintEngine = DEFAULT_PAINT_ENGINE): PaintEngine {
  const v = s?.paintEngine;
  return isPaintEngine(v) ? v : fallback;
}

/** #/free で開く画面（continueId があれば常に新しいお絵描き） */
export function freeScreenEngine(engine: PaintEngine, continueId: string | undefined): PaintEngine {
  return continueId ? 'og' : engine;
}
