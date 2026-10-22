/**
 * 新しいお絵描き（#/free の OgFreeDraw）の下書き（UR-002 / ADR-0007 D6-4、ilust-sup-integration-14、ilust-sup-followup-04）。
 *
 * - 印（`{ engine: 'og', docId, savedAt, continueId }`）は **localStorage**（`seichotsu.ogDraft.free`）に置く。タブを閉じた・ホーム画面のアプリ（PWA）を
 *   終了した・OS が背景で落とした後に開き直しても残り、「続きから / 捨てる」を出せる（M7 までは sessionStorage = 開き直すと印が無く、
 *   残っていた OG のジャーナルを掃除で消していた）。M7 の印（sessionStorage の `seichotsu.draft.free`）は読んだら localStorage に移す。
 * - 印の有効期限は OG_DRAFT_TTL_MS（24 時間、savedAt から）。期限切れの印と下書きは開いたときに掃除する。
 * - 掃除（sweep）は「期限切れ」か「捨てるを選んだ」か「残っているものが無い」ときだけ。印が無くても期限内のジャーナルがあれば
 *   印の代わりにそれを「続きから / 捨てる」で出す（decideDraft）。
 * - #/free を開いている間は Web Locks の `og-free-draft` を取る（acquireDraftLock）。取れたタブだけが掃除・印の読み書きをする。
 *   取れない（別のタブで #/free を開いている）タブは共有の持ち方（sharedKeeper）: 印に触れず、掃除せず、下書きを出さない
 *   （OG のジャーナルは別のタブで動いている文書を復旧・掃除の対象にしない = 消えない）。
 * - 文書の本体（.ognk）の置き場: 成果物に下書きの口（saveDraft / latestDraft / openDraft）があれば OG の自動保存の記録（ジャーナル、ADR-0007 D6-4）。
 *   口の無い成果物では局所アダプタとして、親が `ogEmbed.serializeProject()` の写しを専用の小さい IndexedDB（`seichotsu-drafts`、成長通の `seichotsu`
 *   とは別）に 1 件だけ持つ。成長通の DB・バックアップには入らない。
 * - 「続きから」は印と本体の docId が一致したときだけ。保存して終わった・戻るで捨てた・画面を離れたら印も本体も消す。
 * - 失敗（容量不足など）は静かに諦める（印も消す。古い下書きを残さない。v2 の draft.ts と同じ考え方）。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** 印のキー（localStorage）。v2 の下書き（sessionStorage の seichotsu.draft.free）とは別のキー */
export const OG_DRAFT_MARK_KEY = 'seichotsu.ogDraft.free';
/** M7 までの印（sessionStorage、v2 の下書きと同じキー。engine: 'og' のものだけ読んで移す） */
export const LEGACY_DRAFT_MARK_KEY = 'seichotsu.draft.free';
/** 印と下書きの有効期限（savedAt から） */
export const OG_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** #/free を開いている間に取る Web Locks の名前 */
export const OG_DRAFT_LOCK = 'og-free-draft';
/** 別のタブが手放すのを待つ時間（再読み込みの直後は前の文書のロックが少し残ることがある） */
export const OG_DRAFT_LOCK_WAIT_MS = 2000;
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
  /** 印の置き場（localStorage。無い環境では null） */
  storage(): Storage | null;
  /** M7 までの印の置き場（sessionStorage）。読んだら storage に移して消す */
  legacyStorage?(): Storage | null;
  /** 下書きの DB を開く */
  openDb(): Promise<IDBPDatabase<DraftDB>>;
  now?(): Date;
}

export interface OgDraftStore {
  /** 印（無い・壊れていれば null。期限切れかは見ない = isMarkExpired） */
  readMark(): OgDraftMark | null;
  /** 印を置く / 消す（null） */
  setMark(m: OgDraftMark | null): void;
  /** 印に対応する本体（docId が違う・無ければ null） */
  load(mark: OgDraftMark): Promise<Blob | null>;
  /** 残っている写しの印の形（印が無くても。無ければ null） */
  peek(): Promise<OgDraftMark | null>;
  /**
   * 本体を書いてから印を置く。書けなければ両方消して false。
   * `isCurrent` が false を返したら（書いている間に画面を離れた・保存した）印を置かずに本体も消す（古い下書きを残さない）
   */
  write(d: { docId: string; bytes: Blob; continueId: string | null }, isCurrent?: () => boolean): Promise<boolean>;
  /** 印と本体を消す */
  clear(): Promise<void>;
  /** 印が無いのに残っている本体を消す */
  sweepOrphan(): Promise<void>;
}

export function parseMark(raw: string | null): OgDraftMark | null {
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

/** 印（か下書き）が期限切れか。savedAt が読めなければ期限切れ。未来の時刻（時計のずれ）は期限内とみなす */
export function isMarkExpired(m: Pick<OgDraftMark, 'savedAt'>, now: Date, ttlMs = OG_DRAFT_TTL_MS): boolean {
  const t = Date.parse(m.savedAt);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > ttlMs;
}

export type DraftDecision =
  /** 「描きかけがあります」を出す */
  | { kind: 'offer'; mark: OgDraftMark }
  /** 掃除する（期限切れ / 残っているものが無い） */
  | { kind: 'sweep'; reason: 'expired' | 'none' }
  /** 触らない（別の画面 = 別の continueId の期限内の下書き） */
  | { kind: 'keep' };

/**
 * 開いたときに下書きをどうするか（ロックが取れたタブだけが呼ぶ）。
 * - 印があればそれで決める: 期限切れ → 掃除、同じ画面（continueId）→ 出す、違う画面 → 触らない
 * - 印が無ければ残っている下書き（found = ジャーナルの latestDraft か親の写し）で同じように決める
 * - どちらも無ければ掃除（消すものが無い = 何もしない）
 */
export function decideDraft(o: {
  mark: OgDraftMark | null;
  found: OgDraftMark | null;
  continueId: string | null;
  now: Date;
  ttlMs?: number;
}): DraftDecision {
  const ttl = o.ttlMs ?? OG_DRAFT_TTL_MS;
  const pick = o.mark ?? o.found;
  if (!pick) return { kind: 'sweep', reason: 'none' };
  if (isMarkExpired(pick, o.now, ttl)) return { kind: 'sweep', reason: 'expired' };
  if (pick.continueId === o.continueId) return { kind: 'offer', mark: pick };
  return { kind: 'keep' };
}

export function createOgDraftStore(deps: OgDraftStoreDeps): OgDraftStore {
  const now = deps.now ?? (() => new Date());
  const setMark = (m: OgDraftMark | null) => {
    try {
      const s = deps.storage();
      if (!s) return;
      if (m) s.setItem(OG_DRAFT_MARK_KEY, JSON.stringify(m));
      else s.removeItem(OG_DRAFT_MARK_KEY);
    } catch {
      // 何もしない（容量不足・使えない）
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
  const readMark = (): OgDraftMark | null => {
    try {
      const m = parseMark(deps.storage()?.getItem(OG_DRAFT_MARK_KEY) ?? null);
      if (m) return m;
    } catch {
      // 読めない
    }
    // M7 までの印（sessionStorage）: engine og のものだけ移す（v2 の下書きは同じキーなので触らない）
    try {
      const legacy = deps.legacyStorage?.() ?? null;
      const old = parseMark(legacy?.getItem(LEGACY_DRAFT_MARK_KEY) ?? null);
      if (!old) return null;
      setMark(old);
      legacy?.removeItem(LEGACY_DRAFT_MARK_KEY);
      return old;
    } catch {
      return null;
    }
  };
  return {
    readMark,
    setMark,
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
    async peek() {
      try {
        const db = await deps.openDb();
        const rec = await db.get(STORE, SLOT);
        if (!rec || !(rec.bytes instanceof Blob) || rec.bytes.size === 0) return null;
        return { engine: 'og', docId: rec.docId, savedAt: rec.savedAt, continueId: rec.continueId ?? null };
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
        setMark(null);
        await deleteBody();
        return false;
      }
    },
    async clear() {
      setMark(null);
      await deleteBody();
    },
    async sweepOrphan() {
      if (readMark()) return;
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

/** 印の置き場（localStorage） */
export function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** アプリが使う下書きの置き場（localStorage の印 + seichotsu-drafts。M7 の sessionStorage の印は移す） */
export const ogDraftStore: OgDraftStore = createOgDraftStore({ storage: localStore, legacyStorage: sessionStore, openDb: openDraftDb });

// ---------------------------------------------------------------------------
// #/free の Web Lock（取れたタブだけが掃除・印の読み書きをする）
// ---------------------------------------------------------------------------

export interface DraftLock {
  /** 取れた（= この画面が下書きの持ち主）。Web Locks の無い環境では true（M7 までと同じ振る舞い） */
  readonly held: boolean;
  release(): void;
}

interface LockManagerLike {
  request(name: string, options: { signal?: AbortSignal; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void>): Promise<unknown>;
}

/**
 * `og-free-draft` を取る。別のタブが持っていれば waitMs だけ待ち（再読み込みの直後の取り残しを吸収する）、取れなければ held = false。
 * release() で手放す（画面を離れたとき）。
 */
export function acquireDraftLock(
  locks: LockManagerLike | null | undefined = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks,
  waitMs = OG_DRAFT_LOCK_WAIT_MS,
): Promise<DraftLock> {
  if (!locks || typeof locks.request !== 'function') return Promise.resolve({ held: true, release: () => undefined });
  return new Promise<DraftLock>((resolve) => {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let settled = false;
    const done = (l: DraftLock) => {
      if (settled) return;
      settled = true;
      resolve(l);
    };
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl
      ? setTimeout(() => {
          ctrl.abort();
          done({ held: false, release: () => undefined });
        }, waitMs)
      : null;
    const cb = async (lock: unknown) => {
      if (timer !== null) clearTimeout(timer);
      if (!lock) {
        done({ held: false, release: () => undefined });
        return;
      }
      if (settled) return; // 時間切れの後に取れた: すぐ手放す
      done({ held: true, release });
      await released;
    };
    const opts = ctrl ? { signal: ctrl.signal } : { ifAvailable: true };
    locks.request(OG_DRAFT_LOCK, opts, cb).catch(() => {
      if (timer !== null) clearTimeout(timer);
      done({ held: false, release: () => undefined });
    });
  });
}

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
  /** 'journal' = OG の自動保存の記録（ジャーナル）、'snapshot' = 親の写し（seichotsu-drafts）、'shared' = 別のタブが持ち主 */
  readonly kind: 'journal' | 'snapshot' | 'shared';
  /**
   * 今の絵を下書きに書き、印を置く（描いていなければ消す）。失敗は静かに諦める。
   * `isCurrent` が false を返したら（書いている間に画面を離れた・保存した）印を置かない
   */
  save(isCurrent?: () => boolean): Promise<void>;
  /** 印の下書きを開く。開けたら新しい docId（写しのときは印の docId）、開けなければ null */
  restore(mark: OgDraftMark): Promise<string | null>;
  /** 残っている下書き（印が無くても）を印の形で。無ければ null */
  peek(): Promise<OgDraftMark | null>;
  /** 印と下書きを消す（捨てる・保存した・画面を離れた） */
  clear(): Promise<void>;
  /** 残った下書き（期限切れ・印の無い写し）を消す */
  sweep(): Promise<void>;
}

export interface DraftKeeperOptions {
  api: DraftApi;
  /** 親の写しの置き場（印の置き場も兼ねる。ジャーナルのときも、残った写しの掃除に使う） */
  store: OgDraftStore;
  /** @deprecated 印は store.setMark で置く（互換のために残す。使わない） */
  storage?(): Storage | null;
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
    return {
      kind: 'journal',
      async save(isCurrent = () => true) {
        try {
          if (!isCurrent()) return;
          if (!api.hasContent()) {
            o.store.setMark(null);
            return;
          }
          const m = await saveDraft();
          // 書いている間に離れた・保存した: 印を置かない（ジャーナルは次に開いたときの判断か discardRecovery が消す）
          if (m && isCurrent()) o.store.setMark({ engine: 'og', docId: m.docId, savedAt: m.savedAt, continueId: o.continueId });
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
      async peek() {
        try {
          const d = await latestDraft();
          // ジャーナルはどの画面の下書きかを知らない = 新しい絵（continueId なし）の画面でだけ出す
          return d ? { engine: 'og', docId: d.docId, savedAt: d.savedAt, continueId: null } : null;
        } catch {
          return null;
        }
      },
      async clear() {
        o.store.setMark(null);
        await api.discardRecovery().catch(() => undefined);
        await o.store.clear();
      },
      async sweep() {
        o.store.setMark(null);
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
    peek: () => o.store.peek(),
    async clear() {
      await o.store.clear();
    },
    async sweep() {
      // 使わない OG のジャーナルと、期限切れ・印の無い写し
      await api.discardRecovery().catch(() => undefined);
      await o.store.clear();
    },
  };
}

/**
 * 別のタブが #/free を開いている（ロックが取れない）ときの持ち方。印・写しには触れず、掃除もしない。
 * 画面を離れる・保存するときの discardRecovery は今の文書のため（OG は別のタブで動いている文書の記録を消さない）。
 */
export function sharedKeeper(api: Pick<DraftApi, 'discardRecovery'>): DraftKeeper {
  return {
    kind: 'shared',
    save: async () => undefined,
    restore: async () => null,
    peek: async () => null,
    clear: async () => {
      await api.discardRecovery().catch(() => undefined);
    },
    sweep: async () => undefined,
  };
}
