/**
 * 各ストアへの型付き CRUD。DESIGN.md §8。
 *
 * 参照系は「無ければストアのデフォルト値を返す」方針（未初期化でも常に使える型で
 * 返す）。書き込み系は必ず `updatedAt` を更新する。これはバックアップのマージ
 * （`backup.ts`）が「id（または自然キー）が衝突したら updatedAt が新しい方を採用」
 * というルールで動くための前提。
 */
import { diffDays, nowIso, todayLocalDate } from './date';
import { genId } from './id';
import { openDb, SINGLETON_KEY } from './db';
import { applyActivity, createInitialStreak, useFreezeToday } from './streak';
import type {
  CalibrationResult,
  CounterKind,
  Counters,
  Critique,
  CritiqueResponse,
  DrillStats,
  Drawing,
  DrawingKind,
  OgDocRecord,
  OgDrawingMeta,
  Profile,
  ReferenceImage,
  ScoreEntry,
  Settings,
  Streak,
  StrokeDrawing,
  Progress,
} from './types';

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

function defaultProfile(updatedAt: string): Profile {
  return {
    startedAt: todayLocalDate(),
    beforeDrawingId: null,
    beforeCreatedAt: null,
    afterDrawingId: null,
    calibration: null,
    lastMonthlyPromptAt: null,
    critiqueAttemptsByDay: {},
    unlockedLessonIds: [],
    reviewSkippedOn: {},
    updatedAt,
  };
}

/** 古い保存データに無い項目を既定値で補う（項目追加後の後方互換）。 */
function withProfileDefaults(stored: Profile | undefined): Profile | undefined {
  if (!stored) return undefined;
  return { ...defaultProfile(stored.updatedAt), ...stored };
}

export async function getProfile(): Promise<Profile> {
  const db = await openDb();
  const existing = withProfileDefaults(await db.get('profile', SINGLETON_KEY));
  return existing ?? defaultProfile(nowIso());
}

export async function updateProfile(patch: Partial<Omit<Profile, 'updatedAt'>>): Promise<Profile> {
  const db = await openDb();
  const current = await getProfile();
  const next: Profile = { ...current, ...patch, updatedAt: nowIso() };
  await db.put('profile', next, SINGLETON_KEY);
  return next;
}

/** AI 批評の試行回数を何日分残すか。 */
export const CRITIQUE_ATTEMPT_KEEP_DAYS = 14;

/** `day` から見て直近 `CRITIQUE_ATTEMPT_KEEP_DAYS` 日（当日含む）の分だけ残す。未来日は時計ずれとして残す。 */
export function pruneCritiqueAttempts(
  byDay: Record<string, number>,
  day: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(byDay)) {
    if (diffDays(k, day) < CRITIQUE_ATTEMPT_KEEP_DAYS) out[k] = v;
  }
  return out;
}

/**
 * AI 批評を 1 回試みたことを記録し、その日の試行回数（記録後）を返す。
 * 成否に関係なく、API を呼ぶ直前に呼ぶ想定（失敗した呼び出しも上限に数えるため）。
 * 読み→書きは 1 トランザクションで行い、同時に呼ばれても取りこぼさない。
 */
export async function recordCritiqueAttempt(day: string = todayLocalDate()): Promise<number> {
  const db = await openDb();
  const tx = db.transaction('profile', 'readwrite');
  const store = tx.objectStore('profile');
  const current = withProfileDefaults(await store.get(SINGLETON_KEY)) ?? defaultProfile(nowIso());
  const count = (current.critiqueAttemptsByDay[day] ?? 0) + 1;
  const critiqueAttemptsByDay = pruneCritiqueAttempts(
    { ...current.critiqueAttemptsByDay, [day]: count },
    day,
  );
  await store.put({ ...current, critiqueAttemptsByDay, updatedAt: nowIso() }, SINGLETON_KEY);
  await tx.done;
  return count;
}

/** 今日（端末ローカル日）の AI 批評の試行回数。 */
export async function getTodayCritiqueAttempts(day: string = todayLocalDate()): Promise<number> {
  const profile = await getProfile();
  return profile.critiqueAttemptsByDay[day] ?? 0;
}

export async function setCalibration(calibration: CalibrationResult): Promise<Profile> {
  return updateProfile({ calibration });
}

// ---------------------------------------------------------------------------
// progress（key: lessonId）
// ---------------------------------------------------------------------------

export async function getProgress(lessonId: string): Promise<Progress | undefined> {
  const db = await openDb();
  return db.get('progress', lessonId);
}

export async function listProgress(): Promise<Progress[]> {
  const db = await openDb();
  return db.getAll('progress');
}

export interface CompleteLessonOptions {
  score?: number;
  /** 選択式レッスンを「飛ばす」で完了扱いにする場合 true。 */
  skipped?: boolean;
}

/**
 * 途中で中断したレッスンの「次に開くステップ番号」を記録する（完了扱いにはしない）。
 * 完了時は completeLesson が lastStep を null に戻す。
 */
export async function setLessonStep(lessonId: string, step: number): Promise<Progress> {
  const db = await openDb();
  const existing = await db.get('progress', lessonId);
  const now = nowIso();
  const next: Progress = existing
    ? { ...existing, lastStep: step, updatedAt: now }
    : { lessonId, completedAt: null, attempts: 0, lastScore: null, lastStep: step, updatedAt: now };
  await db.put('progress', next);
  return next;
}

/** レッスン完了を記録する。既存レコードがあれば試行回数を+1し、最終スコアを更新する。 */
export async function completeLesson(
  lessonId: string,
  options: CompleteLessonOptions = {},
): Promise<Progress> {
  const db = await openDb();
  const existing = await db.get('progress', lessonId);
  const now = nowIso();

  const next: Progress = existing
    ? {
        lessonId,
        completedAt: existing.completedAt ?? now,
        attempts: existing.attempts + 1,
        lastScore: options.score ?? existing.lastScore,
        // 一度きちんと完了（skipped: false）したレッスンは、後から「飛ばす」で呼ばれても
        // 飛ばした扱いに戻さない
        skipped: existing.completedAt !== null && existing.skipped !== true
          ? false
          : (options.skipped ?? false),
        lastStep: null,
        updatedAt: now,
      }
    : {
        lessonId,
        completedAt: now,
        attempts: 1,
        lastScore: options.score ?? null,
        skipped: options.skipped ?? false,
        lastStep: null,
        updatedAt: now,
      };

  await db.put('progress', next);
  return next;
}

// ---------------------------------------------------------------------------
// drillStats（key: drillType）
// ---------------------------------------------------------------------------

export async function getDrillStats(drillType: string): Promise<DrillStats | undefined> {
  const db = await openDb();
  return db.get('drillStats', drillType);
}

export async function listDrillStats(): Promise<DrillStats[]> {
  const db = await openDb();
  return db.getAll('drillStats');
}

/** ドリルの採点結果を1件記録し、履歴と自己ベストを更新する。 */
export async function recordDrill(drillType: string, score: number): Promise<DrillStats> {
  const db = await openDb();
  const existing = await db.get('drillStats', drillType);
  const now = nowIso();
  const entry: ScoreEntry = { at: now, score };

  const history = existing ? [...existing.history, entry] : [entry];
  const bestScore = existing?.bestScore != null ? Math.max(existing.bestScore, score) : score;

  const next: DrillStats = { drillType, history, bestScore, updatedAt: now };
  await db.put('drillStats', next);
  return next;
}

// ---------------------------------------------------------------------------
// drawings（key: id）
// ---------------------------------------------------------------------------

export interface SaveDrawingInput {
  id?: string;
  lessonId?: string | null;
  kind: DrawingKind;
  image: Blob;
  createdAt?: string;
  strokes?: StrokeDrawing | null;
  meta?: Record<string, unknown>;
}

export async function saveDrawing(input: SaveDrawingInput): Promise<Drawing> {
  const db = await openDb();
  const now = nowIso();
  const drawing: Drawing = {
    id: input.id ?? genId('drawing'),
    lessonId: input.lessonId ?? null,
    kind: input.kind,
    image: input.image,
    createdAt: input.createdAt ?? now,
    strokes: input.strokes ?? null,
    ...(input.meta ? { meta: input.meta } : {}),
    updatedAt: now,
  };
  await db.put('drawings', drawing);
  return drawing;
}

export async function getDrawing(id: string): Promise<Drawing | undefined> {
  const db = await openDb();
  return db.get('drawings', id);
}

/** 絵を消す。新しいお絵描きの文書（ogDocs）があれば同じトランザクションで消す（持ち主のいない文書を残さない）。 */
export async function deleteDrawing(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['drawings', 'ogDocs'], 'readwrite');
  await Promise.all([tx.objectStore('drawings').delete(id), tx.objectStore('ogDocs').delete(id), tx.done]);
}

export interface ListDrawingsQuery {
  kind?: DrawingKind;
  lessonId?: string;
  /** 新しい順に並べたうち先頭何件を返すか。省略時は全件。 */
  limit?: number;
}

/** 絵の一覧を新しい順（`createdAt` 降順）で返す。`kind`/`lessonId` で絞り込み可能。 */
export async function listDrawings(query: ListDrawingsQuery = {}): Promise<Drawing[]> {
  const db = await openDb();

  let items: Drawing[];
  if (query.lessonId !== undefined) {
    items = await db.getAllFromIndex('drawings', 'byLesson', query.lessonId);
    if (query.kind !== undefined) {
      items = items.filter((d) => d.kind === query.kind);
    }
  } else if (query.kind !== undefined) {
    items = await db.getAllFromIndex('drawings', 'byKind', query.kind);
  } else {
    items = await db.getAll('drawings');
  }

  const sorted = [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return query.limit !== undefined ? sorted.slice(0, query.limit) : sorted;
}

// ---------------------------------------------------------------------------
// critiques（key: drawingId）
// ---------------------------------------------------------------------------

export interface SaveCritiqueInput {
  drawingId: string;
  response: CritiqueResponse;
  model: string;
  createdAt?: string;
}

export async function saveCritique(input: SaveCritiqueInput): Promise<Critique> {
  const db = await openDb();
  const now = nowIso();
  const critique: Critique = {
    drawingId: input.drawingId,
    response: input.response,
    model: input.model,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
  await db.put('critiques', critique);
  return critique;
}

export async function getCritique(drawingId: string): Promise<Critique | undefined> {
  const db = await openDb();
  return db.get('critiques', drawingId);
}

export async function listCritiques(): Promise<Critique[]> {
  const db = await openDb();
  return db.getAll('critiques');
}

// ---------------------------------------------------------------------------
// streak（単一）
// ---------------------------------------------------------------------------

export async function getStreak(): Promise<Streak> {
  const db = await openDb();
  return (await db.get('streak', SINGLETON_KEY)) ?? createInitialStreak(nowIso());
}

async function putStreak(streak: Streak): Promise<Streak> {
  const db = await openDb();
  await db.put('streak', streak, SINGLETON_KEY);
  return streak;
}

/**
 * ストリークをそのまま保存する（`updatedAt` は保存時刻に更新）。
 * 通常の活動記録は recordActivity、フリーズの手動使用は applyFreezeToday を使う。
 */
export async function saveStreak(streak: Streak): Promise<Streak> {
  return putStreak({ ...streak, updatedAt: nowIso() });
}

/**
 * 「今日はフリーズを使って休む」: 読む → useFreezeToday → 保存 → 返す。
 * 使えない場合（フリーズ 0、今日すでに活動済み、活動履歴なし）は保存せず null。
 */
export async function applyFreezeToday(today: string = todayLocalDate()): Promise<Streak | null> {
  const current = await getStreak();
  const next = useFreezeToday(current, today, nowIso());
  if (!next) return null;
  return putStreak(next);
}

/** 今日（既定: 端末ローカルの今日）の活動をストリークに反映して保存する。 */
export async function recordActivity(day: string = todayLocalDate()): Promise<Streak> {
  const current = await getStreak();
  const next = applyActivity(current, day, nowIso());
  return putStreak(next);
}

// ---------------------------------------------------------------------------
// counters（単一）
// ---------------------------------------------------------------------------

function defaultCounters(updatedAt: string): Counters {
  return { line: 0, ellipse: 0, circle: 0, box: 0, gesture: 0, completed: 0, updatedAt };
}

export async function getCounters(): Promise<Counters> {
  const db = await openDb();
  return (await db.get('counters', SINGLETON_KEY)) ?? defaultCounters(nowIso());
}

/** 累計カウンターに `n`（既定1）を加算する。 */
export async function bumpCounter(kind: CounterKind, n = 1): Promise<Counters> {
  const db = await openDb();
  const current = await getCounters();
  const next: Counters = { ...current, [kind]: current[kind] + n, updatedAt: nowIso() };
  await db.put('counters', next, SINGLETON_KEY);
  return next;
}

// ---------------------------------------------------------------------------
// settings（単一）
// ---------------------------------------------------------------------------

export function defaultSettings(updatedAt: string): Settings {
  return {
    apiKey: null,
    modelId: 'claude-opus-5-5',
    effort: 'high',
    dailyCritiqueLimit: 3,
    externalAppName: null,
    theme: 'system',
    leftHanded: false,
    penOnly: true,
    strictness: 'normal',
    notifyTime: '20:00',
    fontScale: 'normal',
    lastBackupAt: null,
    backupSnoozedOn: null,
    reviewWarmup: true,
    updatedAt,
  };
}

export async function getSettings(): Promise<Settings> {
  const db = await openDb();
  const stored = await db.get('settings', SINGLETON_KEY);
  // 古い保存データに無い項目は既定値で補う（項目追加後の後方互換）
  return stored ? { ...defaultSettings(stored.updatedAt), ...stored } : defaultSettings(nowIso());
}

export async function updateSettings(patch: Partial<Omit<Settings, 'updatedAt'>>): Promise<Settings> {
  const db = await openDb();
  const current = await getSettings();
  const next: Settings = { ...current, ...patch, updatedAt: nowIso() };
  await db.put('settings', next, SINGLETON_KEY);
  return next;
}

// ---------------------------------------------------------------------------
// references（key: id）
// ---------------------------------------------------------------------------

export interface SaveReferenceInput {
  id?: string;
  image: Blob;
  label?: string | null;
  createdAt?: string;
}

export async function saveReference(input: SaveReferenceInput): Promise<ReferenceImage> {
  const db = await openDb();
  const now = nowIso();
  const reference: ReferenceImage = {
    id: input.id ?? genId('reference'),
    image: input.image,
    label: input.label ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
  await db.put('references', reference);
  return reference;
}

export async function getReference(id: string): Promise<ReferenceImage | undefined> {
  const db = await openDb();
  return db.get('references', id);
}

export async function listReferences(): Promise<ReferenceImage[]> {
  const db = await openDb();
  return db.getAll('references');
}

export async function deleteReference(id: string): Promise<void> {
  const db = await openDb();
  await db.delete('references', id);
}

// ---------------------------------------------------------------------------
// ogDocs（DB v2、key: id = 絵の id。UR-002 / ADR-0007 D6）
// ---------------------------------------------------------------------------

export interface SaveOgDrawingInput {
  /** 省略時は新しい id。指定すると同じ id の絵と文書を置き換える。 */
  id?: string;
  kind: DrawingKind;
  lessonId?: string | null;
  /** ギャラリー用の画像（WebP 1024）。呼び出し側がメモリで作ってから渡す。 */
  image: Blob;
  /** 文書本体（.ognk）。呼び出し側がメモリで作ってから渡す。 */
  ognk: Blob;
  og: OgDrawingMeta;
  embedApi: number;
  createdAt?: string;
  /** meta.og 以外に付ける JSON の値（例: 模写の参照 id）。`og` と `doc` のキーは使えない。 */
  extraMeta?: Record<string, unknown>;
}

export type SaveOgDrawingResult =
  | { ok: true; drawing: Drawing; doc: OgDocRecord }
  | {
      ok: false;
      /** quota = 端末の空き容量が足りない（QuotaExceededError）。other = それ以外の失敗。 */
      reason: 'quota' | 'other';
      error: unknown;
      /** 渡された入力（画像と文書はメモリに残っている）。`retry()` で同じ内容を書き直せる。 */
      input: SaveOgDrawingInput;
      retry: () => Promise<SaveOgDrawingResult>;
    };

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: unknown }).name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/** JSON にそのまま往復できる値か（素のオブジェクト・配列・有限の数・文字列・真偽・null だけ） */
export function isJsonValue(v: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1));
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v) as unknown;
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(v as Record<string, unknown>).every((x) => x !== undefined && isJsonValue(x, depth + 1));
  }
  return false;
}

/** meta.og が JSON にできる値だけか（Blob や関数・NaN を入れない。ADR-0007 D6-2） */
export function isJsonOgMeta(og: OgDrawingMeta): boolean {
  return og.engine === 'og' && typeof og.docId === 'string' && isJsonValue(og);
}

/**
 * 新しいお絵描きの絵を保存する。絵（WebP）と文書（.ognk）を 1 つのトランザクションで書く（片方だけ残らない）。
 * 失敗しても例外にせず、入力をメモリに残したまま `{ ok: false, retry }` を返す（容量不足なら reason = 'quota'）。
 */
export async function saveOgDrawing(input: SaveOgDrawingInput): Promise<SaveOgDrawingResult> {
  const fail = (reason: 'quota' | 'other', error: unknown): SaveOgDrawingResult => ({
    ok: false,
    reason,
    error,
    input,
    retry: () => saveOgDrawing(input),
  });
  if (!isJsonOgMeta(input.og)) return fail('other', new Error('meta.og は JSON にできる値だけにしてください。'));
  if (input.extraMeta && ('og' in input.extraMeta || 'doc' in input.extraMeta)) {
    return fail('other', new Error('extraMeta に og / doc は使えません。'));
  }
  const now = nowIso();
  const id = input.id ?? genId('drawing');
  const drawing: Drawing = {
    id,
    lessonId: input.lessonId ?? null,
    kind: input.kind,
    image: input.image,
    createdAt: input.createdAt ?? now,
    strokes: null,
    meta: { ...(input.extraMeta ?? {}), og: { ...input.og } },
    updatedAt: now,
  };
  const doc: OgDocRecord = {
    id,
    drawingId: id,
    bytes: input.ognk,
    format: 'ognk',
    ogContract: input.og.ogContract,
    embedApi: input.embedApi,
    updatedAt: now,
  };
  let db: Awaited<ReturnType<typeof openDb>>;
  try {
    db = await openDb();
  } catch (e) {
    return fail(isQuotaError(e) ? 'quota' : 'other', e);
  }
  const tx = db.transaction(['drawings', 'ogDocs'], 'readwrite');
  const pending: Promise<unknown>[] = [];
  try {
    pending.push(tx.objectStore('drawings').put(drawing));
    pending.push(tx.objectStore('ogDocs').put(doc));
    pending.push(tx.done);
    await Promise.all(pending);
    return { ok: true, drawing, doc };
  } catch (e) {
    // 途中で同期に投げられたとき、先に出した要求は中断で reject される（未処理にしない）
    for (const p of pending) p.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // すでに中断・完了している
    }
    await tx.done.catch(() => undefined);
    return fail(isQuotaError(e) ? 'quota' : 'other', e);
  }
}

export async function getOgDoc(id: string): Promise<OgDocRecord | undefined> {
  const db = await openDb();
  return db.get('ogDocs', id);
}

export async function listOgDocs(): Promise<OgDocRecord[]> {
  const db = await openDb();
  return db.getAll('ogDocs');
}

/** 端末の保存の使用量（任意。非対応なら null）。ギャラリーの表示用（OG の分も含むオリジン全体）。 */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  const storage = (globalThis as { navigator?: Navigator }).navigator?.storage;
  if (!storage || typeof storage.estimate !== 'function') return null;
  try {
    const e = await storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
