/**
 * zip バックアップの書き出し／読み込み（DESIGN.md §7・§10）。
 *
 * zip の構成:
 * - `manifest.json`      … { version, exportedAt }
 * - `data/*.json`        … 各ストアのレコード（画像 Blob は含めない）
 * - `images/drawing/<id>.<webp|png|jpg|gif>`   … drawings の画像本体
 * - `images/reference/<id>.<webp|png|jpg|gif>` … references の画像本体
 *   拡張子は中身の先頭バイトで決める（`toWebp` が PNG にフォールバックした絵もある）。
 *   旧形式の zip は全部 `.webp` 名なので、読み込み時も中身から型を判定する。
 *
 * 秘密情報: `data/settings.json` の `apiKey` は書き出さない（常に null）。
 * 読み込み（replace/merge とも）では端末側の `apiKey` を必ず残す。
 * `lastBackupAt` は端末側の方が新しければ端末側を残す。
 * `profile.critiqueAttemptsByDay` は日ごとに多い方を残す（読み込みで 1 日上限を回避できないように）。
 *
 * メモリ: 書き出しは fflate の `Zip` ストリームに画像を 1 枚ずつ流し、出力は数 MB ごとに
 * Blob へ逃がす（`exportBackupBlob`）。画像は無圧縮（ZipPassThrough）で格納する。
 * 読み込みは zip の中央ディレクトリを読み、無圧縮の画像は元の Blob の `slice` として
 * そのまま取り出す（`importBackup` に File/Blob を渡せば、画像をバイト列に展開しない）。
 *
 * インポート時は zod で manifest と各 JSON を検証してから書き込む。
 * `merge` モードの衝突解決は「同じ id（または自然キー：lessonId/drillType/
 * drawingId）を持つレコードのうち `updatedAt` が新しい方を採用する」という
 * 単純なルール（Last-Write-Wins）。単一レコードのストア（profile/streak/
 * counters/settings）も同様に、既存とインポート内容を `updatedAt` で比較して
 * 新しい方を残す。
 */
import { inflateSync, strFromU8, strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { z } from 'zod';
import { blobToBytes, imageExtension, sniffImageType, type SniffedImageType } from './images';
import { nowIso, todayLocalDate } from './date';
import { openDb, SINGLETON_KEY, type SeichotsuDBHandle } from './db';
import {
  getProfile,
  listProgress,
  listDrillStats,
  listDrawings,
  listCritiques,
  getStreak,
  getCounters,
  getSettings,
  listReferences,
  pruneCritiqueAttempts,
} from './repo';
import type {
  Counters,
  Critique,
  DrillStats,
  Drawing,
  Profile,
  ReferenceImage,
  Settings,
  Streak,
  Progress,
} from './types';

export const BACKUP_VERSION = 1;

// ---------------------------------------------------------------------------
// zod スキーマ（インポート時の検証用）
// ---------------------------------------------------------------------------

const isoString = z.string().min(1);

const calibrationSchema = z.object({
  calibratedAt: isoString,
  baselines: z.record(z.string(), z.number()),
});

const profileSchema = z.object({
  startedAt: z.string(),
  beforeDrawingId: z.string().nullable(),
  beforeCreatedAt: z.string().nullable(),
  afterDrawingId: z.string().nullable(),
  calibration: calibrationSchema.nullable(),
  lastMonthlyPromptAt: z.string().nullable(),
  // 後から追加した項目（古いバックアップには無い）
  critiqueAttemptsByDay: z.record(z.string(), z.number()).default({}),
  unlockedLessonIds: z.array(z.string()).default([]),
  reviewSkippedOn: z.record(z.string(), z.string()).default({}),
  updatedAt: isoString,
}) satisfies z.ZodType<Profile>;

const progressSchema = z.object({
  lessonId: z.string(),
  completedAt: isoString.nullable(),
  attempts: z.number(),
  lastScore: z.number().nullable(),
  skipped: z.boolean().optional(),
  lastStep: z.number().nullable().optional(),
  updatedAt: isoString,
}) satisfies z.ZodType<Progress>;

const scoreEntrySchema = z.object({ at: isoString, score: z.number() });

const drillStatsSchema = z.object({
  drillType: z.string(),
  history: z.array(scoreEntrySchema),
  bestScore: z.number().nullable(),
  updatedAt: isoString,
}) satisfies z.ZodType<DrillStats>;

const drawingKindSchema = z.enum(['drill', 'lesson', 'free', 'before', 'after', 'submit']);

const strokeSchema = z.object({ x: z.number(), y: z.number(), p: z.number(), t: z.number() });
const strokeDrawingSchema = z.array(z.array(strokeSchema));

const drawingMetaSchema = z.object({
  id: z.string(),
  lessonId: z.string().nullable(),
  kind: drawingKindSchema,
  createdAt: isoString,
  strokes: strokeDrawingSchema.nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
  updatedAt: isoString,
});
type DrawingMeta = z.infer<typeof drawingMetaSchema>;

const critiqueIssueSchema = z.object({
  where: z.string(),
  what: z.string(),
  how: z.string(),
  // 後から追加した任意項目（古いバックアップには無い）
  pos: z.object({ x: z.number(), y: z.number() }).optional(),
});
const critiqueResponseSchema = z.object({
  good: z.array(z.string()),
  issues: z.array(critiqueIssueSchema),
  next_one: z.string(),
  encourage: z.string(),
});

const critiqueSchema = z.object({
  drawingId: z.string(),
  response: critiqueResponseSchema,
  model: z.string(),
  createdAt: isoString,
  updatedAt: isoString,
}) satisfies z.ZodType<Critique>;

const streakSchema = z.object({
  current: z.number(),
  longest: z.number(),
  freezes: z.number(),
  lastActiveDay: z.string().nullable(),
  nextFreezeAt: z.number(),
  updatedAt: isoString,
}) satisfies z.ZodType<Streak>;

const countersSchema = z.object({
  line: z.number(),
  ellipse: z.number(),
  circle: z.number(),
  box: z.number(),
  gesture: z.number(),
  completed: z.number(),
  updatedAt: isoString,
}) satisfies z.ZodType<Counters>;

const settingsSchema = z.object({
  apiKey: z.string().nullable(),
  modelId: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
  dailyCritiqueLimit: z.number(),
  externalAppName: z.string().nullable(),
  theme: z.enum(['light', 'dark', 'system']),
  // 以下は後から追加した項目。古いバックアップには無いので既定値で補う
  leftHanded: z.boolean().default(false),
  penOnly: z.boolean().default(true),
  strictness: z.enum(['easy', 'normal']).default('normal'),
  notifyTime: z.string().nullable().default('20:00'),
  fontScale: z.enum(['normal', 'large']).default('normal'),
  lastBackupAt: z.string().nullable().default(null),
  backupSnoozedOn: z.string().nullable().default(null),
  reviewWarmup: z.boolean().default(true),
  updatedAt: isoString,
});

const referenceMetaSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  createdAt: isoString,
  updatedAt: isoString,
});
type ReferenceMeta = z.infer<typeof referenceMetaSchema>;

const manifestSchema = z.object({
  version: z.number(),
  exportedAt: isoString,
});

// ---------------------------------------------------------------------------
// パス規約
// ---------------------------------------------------------------------------

const IMAGE_EXTS = ['webp', 'png', 'jpg', 'gif'] as const;
const drawingImagePath = (id: string, ext: string) => `images/drawing/${id}.${ext}`;
const referenceImagePath = (id: string, ext: string) => `images/reference/${id}.${ext}`;

const ALL_STORES = [
  'profile',
  'progress',
  'drillStats',
  'drawings',
  'critiques',
  'streak',
  'counters',
  'settings',
  'references',
] as const;

/** Blob.type を画像の型として正規化する。画像でなければ null。 */
function normalizeImageType(type: string): SniffedImageType | null {
  const t = type.toLowerCase().split(';')[0]?.trim() ?? '';
  return t === 'image/webp' || t === 'image/png' || t === 'image/jpeg' || t === 'image/gif' ? t : null;
}

function typeFromExtension(path: string): SniffedImageType {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  return 'image/webp';
}

// ---------------------------------------------------------------------------
// export（ストリーミング）
// ---------------------------------------------------------------------------

/** 出力をこのバイト数ごとに Blob へ逃がす（メモリ上に溜めるチャンクの上限の目安）。 */
const FLUSH_BYTES = 4 * 1024 * 1024;

/**
 * fflate の `Zip` ストリームに 1 ファイルずつ流し、出力チャンクを数 MB ごとに Blob にまとめる。
 * `Zip` は前のファイルが終わっていれば同期的に出力するので、`add*` を順に呼ぶだけでよい。
 */
class ZipBlobWriter {
  private readonly parts: Blob[] = [];
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private error: Error | null = null;
  private finished = false;
  private readonly zip: Zip;

  constructor() {
    this.zip = new Zip((err, chunk, final) => {
      if (err) {
        this.error = err;
        return;
      }
      this.pending.push(chunk);
      this.pendingBytes += chunk.length;
      if (final) this.finished = true;
      if (this.pendingBytes >= FLUSH_BYTES) this.flush();
    });
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    // Blob はチャンクの中身をコピーするので、ここで元の Uint8Array を手放せる
    this.parts.push(new Blob(this.pending as Uint8Array<ArrayBuffer>[]));
    this.pending = [];
    this.pendingBytes = 0;
  }

  private check(): void {
    if (this.error) throw this.error;
  }

  /** 圧縮して格納（JSON 用）。 */
  addDeflated(name: string, data: Uint8Array): void {
    const f = new ZipDeflate(name, { level: 6 });
    this.zip.add(f);
    f.push(data, true);
    this.check();
  }

  /** 無圧縮で格納（WebP/PNG はすでに圧縮済みなので、縮まないうえに CPU を食うだけ）。 */
  addStored(name: string, data: Uint8Array): void {
    const f = new ZipPassThrough(name);
    this.zip.add(f);
    f.push(data, true);
    this.check();
  }

  finish(): Blob {
    this.zip.end();
    this.check();
    if (!this.finished) throw new Error('zip の書き出しが完了しませんでした。');
    this.flush();
    return new Blob(this.parts, { type: 'application/zip' });
  }
}

/**
 * バックアップ zip を Blob で作る。画像は 1 枚ずつ読み出して zip ストリームに流す。
 * UI はこちらを使うとよい（`exportBackup` は互換のためのバイト列版）。
 */
export async function exportBackupBlob(): Promise<Blob> {
  const [profile, progress, drillStats, drawings, critiques, streak, counters, settings, references] =
    await Promise.all([
      getProfile(),
      listProgress(),
      listDrillStats(),
      listDrawings(),
      listCritiques(),
      getStreak(),
      getCounters(),
      getSettings(),
      listReferences(),
    ]);

  const drawingMetas: DrawingMeta[] = drawings.map(({ image: _image, ...meta }) => meta);
  const referenceMetas: ReferenceMeta[] = references.map(({ image: _image, ...meta }) => meta);
  // API キーは zip に入れない（zip は端末外へ持ち出される前提）
  const exportedSettings: Settings = { ...settings, apiKey: null };

  const manifest = { version: BACKUP_VERSION, exportedAt: nowIso() };
  const json = (v: unknown) => strToU8(JSON.stringify(v));

  const w = new ZipBlobWriter();
  w.addDeflated('manifest.json', json(manifest));
  w.addDeflated('data/profile.json', json(profile));
  w.addDeflated('data/progress.json', json(progress));
  w.addDeflated('data/drillStats.json', json(drillStats));
  w.addDeflated('data/drawings.json', json(drawingMetas));
  w.addDeflated('data/critiques.json', json(critiques));
  w.addDeflated('data/streak.json', json(streak));
  w.addDeflated('data/counters.json', json(counters));
  w.addDeflated('data/settings.json', json(exportedSettings));
  w.addDeflated('data/references.json', json(referenceMetas));

  const addImage = async (image: Blob, pathFor: (ext: string) => string) => {
    const bytes = await blobToBytes(image);
    const type = sniffImageType(bytes) ?? normalizeImageType(image.type) ?? 'image/webp';
    w.addStored(pathFor(imageExtension(type)), bytes);
  };
  for (const d of drawings) {
    await addImage(d.image, (ext) => drawingImagePath(d.id, ext));
  }
  for (const r of references) {
    await addImage(r.image, (ext) => referenceImagePath(r.id, ext));
  }

  return w.finish();
}

/** バックアップ zip をバイト列で返す（互換用。大きなデータでは `exportBackupBlob` を使う）。 */
export async function exportBackup(): Promise<Uint8Array> {
  const blob = await exportBackupBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------------------
// zip の読み出し（中央ディレクトリ方式）
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  /** 0 = 無圧縮, 8 = deflate */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const u16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, i: number) => (u16(b, i) | (u16(b, i + 2) << 16)) >>> 0;

async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const NOT_ZIP = 'zip ファイルとして読めません（壊れているか、バックアップの zip ではありません）。';

/**
 * 末尾の End of Central Directory から中央ディレクトリを読み、ファイル一覧を返す。
 * 中央ディレクトリにはサイズが必ず入っているので、データディスクリプタ付きの
 * エントリ（ストリーム書き出し）でも正しく読める。ZIP64 は非対応。
 */
async function readZipEntries(zip: Blob): Promise<Map<string, ZipEntry>> {
  const tailLen = Math.min(zip.size, 22 + 0xffff);
  if (tailLen < 22) throw new Error(NOT_ZIP);
  const tail = await readRange(zip, zip.size - tailLen, zip.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(NOT_ZIP);
  const count = u16(tail, eocd + 10);
  const cdSize = u32(tail, eocd + 12);
  const cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('ZIP64 形式のバックアップには対応していません。');
  }
  if (cdOffset + cdSize > zip.size) throw new Error(NOT_ZIP);

  const cd = await readRange(zip, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw new Error(NOT_ZIP);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      name,
      method: u16(cd, p + 10),
      compressedSize: u32(cd, p + 20),
      uncompressedSize: u32(cd, p + 24),
      localHeaderOffset: u32(cd, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** エントリの（圧縮されたままの）データ部分を Blob の範囲として返す。コピーしない。 */
async function entryRawSlice(zip: Blob, e: ZipEntry): Promise<Blob> {
  const lh = await readRange(zip, e.localHeaderOffset, e.localHeaderOffset + 30);
  if (lh.length < 30 || u32(lh, 0) !== 0x04034b50) throw new Error(NOT_ZIP);
  const start = e.localHeaderOffset + 30 + u16(lh, 26) + u16(lh, 28);
  const end = start + e.compressedSize;
  if (end > zip.size) throw new Error(NOT_ZIP);
  return zip.slice(start, end);
}

/** エントリを展開したバイト列を返す（JSON 用・圧縮された旧形式の画像用）。 */
async function entryBytes(zip: Blob, e: ZipEntry): Promise<Uint8Array> {
  const raw = new Uint8Array(await (await entryRawSlice(zip, e)).arrayBuffer());
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateSync(raw, { out: new Uint8Array(e.uncompressedSize) });
  throw new Error(`未対応の圧縮形式です（${e.name}, method=${e.method}）。`);
}

/**
 * 画像エントリを Blob として返す。型は先頭バイトで判定する（旧 zip は PNG でも `.webp` 名）。
 * 無圧縮なら元 Blob の `slice` をそのまま返すので、画像をメモリに展開しない。
 */
async function entryImageBlob(zip: Blob, e: ZipEntry): Promise<Blob> {
  if (e.method === 0) {
    const raw = await entryRawSlice(zip, e);
    const head = new Uint8Array(await raw.slice(0, 16).arrayBuffer());
    const type = sniffImageType(head) ?? typeFromExtension(e.name);
    return raw.slice(0, raw.size, type);
  }
  const bytes = await entryBytes(zip, e);
  const type = sniffImageType(bytes) ?? typeFromExtension(e.name);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

export type ImportMode = 'replace' | 'merge';

interface BackupPayload {
  profile: Profile;
  progress: Progress[];
  drillStats: DrillStats[];
  drawings: Drawing[];
  critiques: Critique[];
  streak: Streak;
  counters: Counters;
  settings: Settings;
  references: ReferenceImage[];
}

async function readJson<T>(
  zip: Blob,
  entries: Map<string, ZipEntry>,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const entry = entries.get(path);
  if (!entry) {
    throw new Error(`バックアップに ${path} が見つかりません。`);
  }
  const parsed: unknown = JSON.parse(strFromU8(await entryBytes(zip, entry)));
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${path} の形式が不正です: ${result.error.message}`);
  }
  return result.data;
}

function findImageEntry(
  entries: Map<string, ZipEntry>,
  pathFor: (ext: string) => string,
): ZipEntry | undefined {
  for (const ext of IMAGE_EXTS) {
    const e = entries.get(pathFor(ext));
    if (e) return e;
  }
  return undefined;
}

/**
 * バックアップ zip を読み込む。`input` に File/Blob を渡すと、画像を 1 枚ずつ
 * 元ファイルの範囲として取り出す（全体をメモリに展開しない）。Uint8Array も受け付ける。
 */
export async function importBackup(input: Uint8Array | Blob, mode: ImportMode): Promise<void> {
  const zip = input instanceof Blob ? input : new Blob([input as Uint8Array<ArrayBuffer>]);
  const entries = await readZipEntries(zip);

  const manifest = await readJson(zip, entries, 'manifest.json', manifestSchema);
  if (manifest.version !== BACKUP_VERSION) {
    throw new Error(`未対応のバックアップバージョンです（version=${manifest.version}）。`);
  }

  const profile = await readJson(zip, entries, 'data/profile.json', profileSchema);
  const progress = await readJson(zip, entries, 'data/progress.json', z.array(progressSchema));
  const drillStats = await readJson(zip, entries, 'data/drillStats.json', z.array(drillStatsSchema));
  const drawingMetas = await readJson(zip, entries, 'data/drawings.json', z.array(drawingMetaSchema));
  const critiques = await readJson(zip, entries, 'data/critiques.json', z.array(critiqueSchema));
  const streak = await readJson(zip, entries, 'data/streak.json', streakSchema);
  const counters = await readJson(zip, entries, 'data/counters.json', countersSchema);
  const settings = await readJson(zip, entries, 'data/settings.json', settingsSchema);
  const referenceMetas = await readJson(zip, entries, 'data/references.json', z.array(referenceMetaSchema));

  const drawings: Drawing[] = [];
  for (const meta of drawingMetas) {
    const entry = findImageEntry(entries, (ext) => drawingImagePath(meta.id, ext));
    if (!entry) {
      throw new Error(`バックアップに絵の画像が見つかりません: ${meta.id}`);
    }
    drawings.push({ ...meta, image: await entryImageBlob(zip, entry) });
  }

  const references: ReferenceImage[] = [];
  for (const meta of referenceMetas) {
    const entry = findImageEntry(entries, (ext) => referenceImagePath(meta.id, ext));
    if (!entry) {
      throw new Error(`バックアップに取込画像が見つかりません: ${meta.id}`);
    }
    references.push({ ...meta, image: await entryImageBlob(zip, entry) });
  }

  const payload: BackupPayload = {
    profile,
    progress,
    drillStats,
    drawings,
    critiques,
    streak,
    counters,
    settings,
    references,
  };

  const db = await openDb();
  if (mode === 'replace') {
    await replaceAll(db, payload);
  } else {
    await mergeAll(db, payload);
  }
}

/** 新しい方（`updatedAt` が大きい方）を返す。既存が無ければ常に incoming を採用。 */
function newer<T extends { updatedAt: string }>(existing: T | undefined, incoming: T): T {
  if (!existing) return incoming;
  return incoming.updatedAt >= existing.updatedAt ? incoming : existing;
}

function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** 読み込み後の設定: API キーは端末側を必ず残し、最終バックアップ日時は新しい方を残す。 */
function reconcileSettings(chosen: Settings, device: Settings | undefined): Settings {
  return {
    ...chosen,
    apiKey: device?.apiKey ?? null,
    lastBackupAt: laterIso(device?.lastBackupAt, chosen.lastBackupAt),
  };
}

/** 読み込み後の profile: AI 批評の試行回数は日ごとに多い方を残す（直近 14 日分）。開放したレッスンは和集合。 */
function reconcileProfile(chosen: Profile, device: Profile | undefined): Profile {
  const merged: Record<string, number> = { ...(chosen.critiqueAttemptsByDay ?? {}) };
  for (const [day, n] of Object.entries(device?.critiqueAttemptsByDay ?? {})) {
    merged[day] = Math.max(merged[day] ?? 0, n);
  }
  // 開放したレッスンは両方を合わせる（読み込みで隠し機能の開放が消えないように）
  const unlocked = [...new Set([...(chosen.unlockedLessonIds ?? []), ...(device?.unlockedLessonIds ?? [])])];
  return {
    ...chosen,
    unlockedLessonIds: unlocked,
    reviewSkippedOn: chosen.reviewSkippedOn ?? {},
    critiqueAttemptsByDay: pruneCritiqueAttempts(merged, todayLocalDate()),
  };
}

async function replaceAll(db: SeichotsuDBHandle, data: BackupPayload): Promise<void> {
  const tx = db.transaction(ALL_STORES, 'readwrite');
  const profileStore = tx.objectStore('profile');
  const progressStore = tx.objectStore('progress');
  const drillStatsStore = tx.objectStore('drillStats');
  const drawingsStore = tx.objectStore('drawings');
  const critiquesStore = tx.objectStore('critiques');
  const streakStore = tx.objectStore('streak');
  const countersStore = tx.objectStore('counters');
  const settingsStore = tx.objectStore('settings');
  const referencesStore = tx.objectStore('references');

  // 消す前に、端末側に残すもの（API キー等）を読んでおく
  const [deviceProfile, deviceSettings] = await Promise.all([
    profileStore.get(SINGLETON_KEY),
    settingsStore.get(SINGLETON_KEY),
  ]);

  await Promise.all([
    profileStore.clear(),
    progressStore.clear(),
    drillStatsStore.clear(),
    drawingsStore.clear(),
    critiquesStore.clear(),
    streakStore.clear(),
    countersStore.clear(),
    settingsStore.clear(),
    referencesStore.clear(),
  ]);

  await Promise.all([
    profileStore.put(reconcileProfile(data.profile, deviceProfile), SINGLETON_KEY),
    streakStore.put(data.streak, SINGLETON_KEY),
    countersStore.put(data.counters, SINGLETON_KEY),
    settingsStore.put(reconcileSettings(data.settings, deviceSettings), SINGLETON_KEY),
    ...data.progress.map((item) => progressStore.put(item)),
    ...data.drillStats.map((item) => drillStatsStore.put(item)),
    ...data.drawings.map((item) => drawingsStore.put(item)),
    ...data.critiques.map((item) => critiquesStore.put(item)),
    ...data.references.map((item) => referencesStore.put(item)),
  ]);

  await tx.done;
}

async function mergeAll(db: SeichotsuDBHandle, data: BackupPayload): Promise<void> {
  const tx = db.transaction(ALL_STORES, 'readwrite');
  const profileStore = tx.objectStore('profile');
  const progressStore = tx.objectStore('progress');
  const drillStatsStore = tx.objectStore('drillStats');
  const drawingsStore = tx.objectStore('drawings');
  const critiquesStore = tx.objectStore('critiques');
  const streakStore = tx.objectStore('streak');
  const countersStore = tx.objectStore('counters');
  const settingsStore = tx.objectStore('settings');
  const referencesStore = tx.objectStore('references');

  const [currentProfile, currentStreak, currentCounters, currentSettings] = await Promise.all([
    profileStore.get(SINGLETON_KEY),
    streakStore.get(SINGLETON_KEY),
    countersStore.get(SINGLETON_KEY),
    settingsStore.get(SINGLETON_KEY),
  ]);

  await profileStore.put(reconcileProfile(newer(currentProfile, data.profile), currentProfile), SINGLETON_KEY);
  await streakStore.put(newer(currentStreak, data.streak), SINGLETON_KEY);
  await countersStore.put(newer(currentCounters, data.counters), SINGLETON_KEY);
  await settingsStore.put(reconcileSettings(newer(currentSettings, data.settings), currentSettings), SINGLETON_KEY);

  for (const item of data.progress) {
    const existing = await progressStore.get(item.lessonId);
    await progressStore.put(newer(existing, item));
  }
  for (const item of data.drillStats) {
    const existing = await drillStatsStore.get(item.drillType);
    await drillStatsStore.put(newer(existing, item));
  }
  for (const item of data.drawings) {
    const existing = await drawingsStore.get(item.id);
    await drawingsStore.put(newer(existing, item));
  }
  for (const item of data.critiques) {
    const existing = await critiquesStore.get(item.drawingId);
    await critiquesStore.put(newer(existing, item));
  }
  for (const item of data.references) {
    const existing = await referencesStore.get(item.id);
    await referencesStore.put(newer(existing, item));
  }

  await tx.done;
}
