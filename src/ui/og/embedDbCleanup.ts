/**
 * 古い埋め込みが Ilust のオリジンに残した**空の** IndexedDB の片付け（OG ADR-0014 D3-2、ilust-sup-followup-05 の Ilust の側）。
 *
 * - `og-files-timelapse`: m12 の埋め込み（OG m12-accepted = 6f70b01）は、タイムラプスが off で画面も無いのに文書を開くたびにこの DB を作った
 *   （cycle13 ilust-sup-followup-02。中身は空、データは壊さない）。OG の M13 から埋め込みでは登録しない（files の RegisterOptions.timelapse = !embedded）ので、
 *   取り込んだ埋め込みの受け入れのタグ（BUILD.json の ogAccepted）が m13 以降なら、もう誰も開かない空の DB が残るだけになる。
 * - 消すのは次の全部が成り立つときだけ（dropLegacySnapshot と同じ考え方 = DB を作らない・形を変えない・中身のあるものは触らない・失敗は静かに諦める）:
 *   (1) 受け入れのタグが m13 以降（形が読めない・無いときは何もしない）、
 *   (2) `indexedDB.databases()` に名前がある（無い環境・無いときは何もしない = 開いて作ってしまわない）、
 *   (3) 版を指定せずに開いて（upgrade を起こさない）、どのストアも 0 件（ストアが無いのも空）。1 件でもあれば残す、
 *   (4) 呼ぶのは #/free の下書きのロック（og-free-draft）を取れたタブだけ（OgFreeDraw）= 別のタブの埋め込みが開いていない。
 * - 結果は 'deleted' / 'kept'（中身がある）/ 'absent'（DB が無い）/ 'skipped'（版が m13 より前・判定できない・失敗）。
 */
import { deleteDB, openDB } from 'idb';

/** 片付けの対象の DB（OG の files のタイムラプスの保管） */
export const OG_TIMELAPSE_DB = 'og-files-timelapse';
/** 埋め込みがこの DB を作らなくなった受け入れの版（m<n>-accepted の n） */
export const TIMELAPSE_DB_GONE_FROM_MILESTONE = 13;

export type EmbedDbCleanupResult = 'deleted' | 'kept' | 'absent' | 'skipped';

/** 'm13.1-accepted' / 'm12-accepted' → 13 / 12（形が違えば null） */
export function acceptedMilestone(tag: unknown): number | null {
  const m = /^m(\d+)(?:\.\d+)?-accepted$/.exec(typeof tag === 'string' ? tag : '');
  return m ? Number(m[1]) : null;
}

interface IdbFactoryLike {
  databases?(): Promise<Array<{ name?: string | null }>>;
}

/**
 * 受け入れのタグが m13 以降の埋め込みで、空の `og-files-timelapse` を消す（中身があれば残す）。
 * @param ogAccepted 取り込んだ埋め込みの受け入れのタグ（ogPaintInfo().ogAccepted）
 */
export async function dropEmptyTimelapseDb(
  ogAccepted: string | null | undefined,
  idb: IdbFactoryLike | undefined = (globalThis as { indexedDB?: IdbFactoryLike }).indexedDB,
): Promise<EmbedDbCleanupResult> {
  const ms = acceptedMilestone(ogAccepted);
  if (ms === null || ms < TIMELAPSE_DB_GONE_FROM_MILESTONE) return 'skipped';
  try {
    if (!idb || typeof idb.databases !== 'function') return 'skipped';
    const list = await idb.databases();
    if (!list.some((d) => d.name === OG_TIMELAPSE_DB)) return 'absent';
    // 版を指定しない = upgrade を起こさない（形を変えない）。数えるだけ
    const db = await openDB(OG_TIMELAPSE_DB);
    let total = 0;
    try {
      for (const store of [...db.objectStoreNames]) {
        total += await db.count(store);
        if (total > 0) break;
      }
    } finally {
      db.close();
    }
    if (total > 0) return 'kept';
    await deleteDB(OG_TIMELAPSE_DB);
    return 'deleted';
  } catch {
    return 'skipped';
  }
}
