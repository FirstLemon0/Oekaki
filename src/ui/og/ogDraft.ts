/**
 * 新しいお絵描き（#/free の OgFreeDraw）の下書き（UR-002 / ADR-0007 D6-4、ilust-sup-integration-14）。
 *
 * - sessionStorage には印だけを置く: `seichotsu.draft.free = { engine: 'og', docId, savedAt, continueId }`（v2 の下書きと同じキー。
 *   ラスターの文書は sessionStorage に入れない）。
 * - 文書の本体（.ognk）の置き場: ADR-0007 D6-4 は「OG の自動保存ジャーナルを下書きにする」だが、埋め込み API v1 には
 *   ジャーナルから開く口が無い（CCR-ilust-sup-m7-wave2-embed-recovery で embed のレーンに依頼）。それまでの局所アダプタとして、
 *   親が `ogEmbed.serializeProject()` の写しを専用の小さい IndexedDB（`seichotsu-drafts`、成長通の `seichotsu` とは別）に 1 件だけ持つ。
 *   成長通の DB・バックアップには入らない（v2 の下書き = sessionStorage と同じく、その端末のその場かぎり）。
 * - 「続きから」は印と本体の docId が一致したときだけ。保存して終わった・戻るで捨てた・画面を離れたら印も本体も消す。
 *   印の無い（別のタブ・閉じて開き直した）ときに残っている本体は古いので消す。
 * - 失敗（容量不足など）は静かに諦める（印も消す。古い下書きを残さない。v2 の draft.ts と同じ考え方）。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** v2 の下書きと同じキー（draft.ts の draftKey(null)） */
export const OG_DRAFT_MARK_KEY = 'seichotsu.draft.free';
export const OG_DRAFT_DB = 'seichotsu-drafts';
const STORE = 'og';
const SLOT = 'free';

export interface OgDraftMark {
  engine: 'og';
  /** 下書きの文書の id（本体の docId と一致したときだけ続きから描ける） */
  docId: string;
  savedAt: string;
  /** ギャラリーの「続きから描く」で開いた絵の id（無ければ新しい絵） */
  continueId: string | null;
}

interface OgDraftRecord {
  key: string;
  docId: string;
  bytes: Blob;
  savedAt: string;
  continueId: string | null;
}

interface DraftDB extends DBSchema {
  og: { key: string; value: OgDraftRecord };
}

export interface OgDraftStoreDeps {
  /** sessionStorage（無い環境では null） */
  storage(): Storage | null;
  /** 下書きの DB を開く */
  openDb(): Promise<IDBPDatabase<DraftDB>>;
  now?(): Date;
}

export interface OgDraftStore {
  /** 今のタブの印（無い・壊れていれば null） */
  readMark(): OgDraftMark | null;
  /** 印に対応する本体（docId が違う・無ければ null） */
  load(mark: OgDraftMark): Promise<Blob | null>;
  /**
   * 本体を書いてから印を置く。書けなければ両方消して false。
   * `isCurrent` が false を返したら（書いている間に画面を離れた・保存した）印を置かずに本体も消す（古い下書きを残さない）
   */
  write(d: { docId: string; bytes: Blob; continueId: string | null }, isCurrent?: () => boolean): Promise<boolean>;
  /** 印と本体を消す */
  clear(): Promise<void>;
  /** 印が無いのに残っている本体を消す（画面を開いたとき） */
  sweepOrphan(): Promise<void>;
}

function parseMark(raw: string | null): OgDraftMark | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<OgDraftMark> | null;
    if (!o || o.engine !== 'og' || typeof o.docId !== 'string' || o.docId === '') return null;
    return {
      engine: 'og',
      docId: o.docId,
      savedAt: typeof o.savedAt === 'string' ? o.savedAt : '',
      continueId: typeof o.continueId === 'string' ? o.continueId : null,
    };
  } catch {
    return null;
  }
}

export function createOgDraftStore(deps: OgDraftStoreDeps): OgDraftStore {
  const now = deps.now ?? (() => new Date());
  const removeMark = () => {
    try {
      deps.storage()?.removeItem(OG_DRAFT_MARK_KEY);
    } catch {
      // 何もしない
    }
  };
  const deleteBody = async () => {
    try {
      const db = await deps.openDb();
      await db.delete(STORE, SLOT);
    } catch {
      // 何もしない（開けない = 残っていない）
    }
  };
  return {
    readMark() {
      try {
        return parseMark(deps.storage()?.getItem(OG_DRAFT_MARK_KEY) ?? null);
      } catch {
        return null;
      }
    },
    async load(mark) {
      try {
        const db = await deps.openDb();
        const rec = await db.get(STORE, SLOT);
        if (!rec || rec.docId !== mark.docId || !(rec.bytes instanceof Blob) || rec.bytes.size === 0) return null;
        return rec.bytes;
      } catch {
        return null;
      }
    },
    async write({ docId, bytes, continueId }, isCurrent = () => true) {
      const savedAt = now().toISOString();
      try {
        if (!isCurrent()) return false;
        const db = await deps.openDb();
        await db.put(STORE, { key: SLOT, docId, bytes, savedAt, continueId });
        if (!isCurrent()) {
          await deleteBody();
          return false;
        }
        const s = deps.storage();
        if (!s) return true;
        const mark: OgDraftMark = { engine: 'og', docId, savedAt, continueId };
        s.setItem(OG_DRAFT_MARK_KEY, JSON.stringify(mark));
        return true;
      } catch {
        removeMark();
        await deleteBody();
        return false;
      }
    },
    async clear() {
      removeMark();
      await deleteBody();
    },
    async sweepOrphan() {
      if (this.readMark()) return;
      await deleteBody();
    },
  };
}

let dbPromise: Promise<IDBPDatabase<DraftDB>> | null = null;

function openDraftDb(): Promise<IDBPDatabase<DraftDB>> {
  if (!dbPromise) {
    const p = openDB<DraftDB>(OG_DRAFT_DB, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      },
      blocking() {
        void p.then((db) => db.close()).catch(() => undefined);
        if (dbPromise === p) dbPromise = null;
      },
      terminated() {
        if (dbPromise === p) dbPromise = null;
      },
    });
    p.catch(() => {
      if (dbPromise === p) dbPromise = null;
    });
    dbPromise = p;
  }
  return dbPromise;
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** アプリが使う下書きの置き場（sessionStorage + seichotsu-drafts） */
export const ogDraftStore: OgDraftStore = createOgDraftStore({ storage: sessionStore, openDb: openDraftDb });

// ---------------------------------------------------------------------------
// 下書きの持ち方（2 通り）: OG のジャーナル（口があれば、ADR-0007 D6-4 のとおり）か、親の写し（局所アダプタ）
// ---------------------------------------------------------------------------

/** 下書きの持ち方が使う ogEmbed の口（型だけ。og/embedApi.ts の OgEmbedApi の一部） */
export interface DraftApi {
  hasContent(): boolean;
  isDirty(): boolean;
  serializeProject(): Promise<Blob>;
  openProject(bytes: Blob): Promise<void>;
  discardRecovery(): Promise<void>;
  saveDraft?(): Promise<{ docId: string; savedAt: string } | null>;
  latestDraft?(): Promise<{ id: string; docId: string; savedAt: string } | null>;
  openDraft?(id: string): Promise<void>;
}

export interface DraftKeeper {
  /** 'journal' = OG の自動保存の記録（ジャーナル）、'snapshot' = 親の写し（seichotsu-drafts） */
  readonly kind: 'journal' | 'snapshot';
  /**
   * 今の絵を下書きに書き、印を置く（描いていなければ消す）。失敗は静かに諦める。
   * `isCurrent` が false を返したら（書いている間に画面を離れた・保存した）印を置かない
   */
  save(isCurrent?: () => boolean): Promise<void>;
  /** 印の下書きを開く。開けたら新しい docId（写しのときは印の docId）、開けなければ null */
  restore(mark: OgDraftMark): Promise<string | null>;
  /** 印と下書きを消す（捨てる・保存した・画面を離れた） */
  clear(): Promise<void>;
  /** 印が無いまま残った下書き（別のタブ・閉じて開き直した）を消す */
  sweep(): Promise<void>;
}

export interface DraftKeeperOptions {
  api: DraftApi;
  /** 親の写しの置き場（ジャーナルのときも、残った写しの掃除に使う） */
  store: OgDraftStore;
  storage(): Storage | null;
  /** 今の文書の id（親が付けたもの。写しのときの印に使う） */
  docId(): string;
  continueId: string | null;
  /** 親の Blob を iframe の realm の Blob に作り直す（openProject の検査に通すため） */
  toFrameBlob(b: Blob): Promise<Blob>;
  now?(): Date;
}

/** 成果物の口に合わせて下書きの持ち方を選ぶ */
export function createDraftKeeper(o: DraftKeeperOptions): DraftKeeper {
  const api = o.api;
  if (typeof api.saveDraft === 'function' && typeof api.latestDraft === 'function' && typeof api.openDraft === 'function') {
    const saveDraft = api.saveDraft.bind(api);
    const latestDraft = api.latestDraft.bind(api);
    const openDraft = api.openDraft.bind(api);
    const setMark = (m: OgDraftMark | null) => {
      try {
        const s = o.storage();
        if (!s) return;
        if (m) s.setItem(OG_DRAFT_MARK_KEY, JSON.stringify(m));
        else s.removeItem(OG_DRAFT_MARK_KEY);
      } catch {
        // 何もしない
      }
    };
    return {
      kind: 'journal',
      async save(isCurrent = () => true) {
        try {
          if (!isCurrent()) return;
          if (!api.hasContent()) {
            setMark(null);
            return;
          }
          const m = await saveDraft();
          // 書いている間に離れた・保存した: 印を置かない（ジャーナルは次に開いたときの掃除か discardRecovery が消す）
          if (m && isCurrent()) setMark({ engine: 'og', docId: m.docId, savedAt: m.savedAt, continueId: o.continueId });
        } catch {
          // 書けなくても描くのは続けられる
        }
      },
      async restore(mark) {
        try {
          const d = await latestDraft();
          if (!d || d.docId !== mark.docId) return null;
          await openDraft(d.id);
          return d.docId;
        } catch {
          return null;
        }
      },
      async clear() {
        setMark(null);
        await api.discardRecovery().catch(() => undefined);
        await o.store.clear();
      },
      async sweep() {
        await api.discardRecovery().catch(() => undefined);
        await o.store.clear();
      },
    };
  }
  return {
    kind: 'snapshot',
    async save(isCurrent = () => true) {
      try {
        if (!isCurrent()) return;
        if (!api.hasContent()) {
          await o.store.clear();
          return;
        }
        const bytes = await api.serializeProject();
        await o.store.write({ docId: o.docId(), bytes, continueId: o.continueId }, isCurrent);
      } catch {
        // 写しが取れなくても描くのは続けられる
      }
    },
    async restore(mark) {
      const blob = await o.store.load(mark);
      if (!blob) return null;
      try {
        await api.openProject(await o.toFrameBlob(blob));
        return mark.docId;
      } catch {
        return null;
      }
    },
    async clear() {
      await o.store.clear();
    },
    async sweep() {
      // 使わない OG のジャーナルと、印の無い写し
      await api.discardRecovery().catch(() => undefined);
      await o.store.sweepOrphan();
    },
  };
}
