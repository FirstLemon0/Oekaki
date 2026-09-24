/**
 * zip バックアップの書き出し／読み込み（DESIGN.md §7・§10）。
 *
 * zip の構成:
 * - `manifest.json`      … { version, exportedAt }
 * - `data/*.json`        … 各ストアのレコード（画像 Blob は含めない）
 * - `images/drawing/<id>.webp`   … drawings の画像本体
 * - `images/reference/<id>.webp` … references の画像本体
 *
 * インポート時は zod で manifest と各 JSON を検証してから書き込む。
 * `merge` モードの衝突解決は「同じ id（または自然キー：lessonId/drillType/
 * drawingId）を持つレコードのうち `updatedAt` が新しい方を採用する」という
 * 単純なルール（Last-Write-Wins）。単一レコードのストア（profile/streak/
 * counters/settings）も同様に、既存とインポート内容を `updatedAt` で比較して
 * 新しい方を残す。
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { bytesToBlob, blobToBytes } from './images';
import { nowIso } from './date';
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
  updatedAt: isoString,
}) satisfies z.ZodType<Profile>;

const progressSchema = z.object({
  lessonId: z.string(),
  completedAt: isoString.nullable(),
  attempts: z.number(),
  lastScore: z.number().nullable(),
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
  updatedAt: isoString,
});
type DrawingMeta = z.infer<typeof drawingMetaSchema>;

const critiqueIssueSchema = z.object({ where: z.string(), what: z.string(), how: z.string() });
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
  updatedAt: isoString,
}) satisfies z.ZodType<Settings>;

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

const drawingImagePath = (id: string) => `images/drawing/${id}.webp`;
const referenceImagePath = (id: string) => `images/reference/${id}.webp`;

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

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export async function exportBackup(): Promise<Uint8Array> {
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

  const manifest = { version: BACKUP_VERSION, exportedAt: nowIso() };

  const files: Zippable = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'data/profile.json': strToU8(JSON.stringify(profile)),
    'data/progress.json': strToU8(JSON.stringify(progress)),
    'data/drillStats.json': strToU8(JSON.stringify(drillStats)),
    'data/drawings.json': strToU8(JSON.stringify(drawingMetas)),
    'data/critiques.json': strToU8(JSON.stringify(critiques)),
    'data/streak.json': strToU8(JSON.stringify(streak)),
    'data/counters.json': strToU8(JSON.stringify(counters)),
    'data/settings.json': strToU8(JSON.stringify(settings)),
    'data/references.json': strToU8(JSON.stringify(referenceMetas)),
  };

  for (const drawing of drawings) {
    files[drawingImagePath(drawing.id)] = await blobToBytes(drawing.image);
  }
  for (const reference of references) {
    files[referenceImagePath(reference.id)] = await blobToBytes(reference.image);
  }

  return zipSync(files);
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

function readJson<T>(files: Record<string, Uint8Array>, path: string, schema: z.ZodType<T>): T {
  const raw = files[path];
  if (!raw) {
    throw new Error(`バックアップに ${path} が見つかりません。`);
  }
  const parsed = JSON.parse(strFromU8(raw));
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${path} の形式が不正です: ${result.error.message}`);
  }
  return result.data;
}

export async function importBackup(bytes: Uint8Array, mode: ImportMode): Promise<void> {
  const files = unzipSync(bytes);

  const manifest = readJson(files, 'manifest.json', manifestSchema);
  if (manifest.version !== BACKUP_VERSION) {
    throw new Error(`未対応のバックアップバージョンです（version=${manifest.version}）。`);
  }

  const profile = readJson(files, 'data/profile.json', profileSchema);
  const progress = readJson(files, 'data/progress.json', z.array(progressSchema));
  const drillStats = readJson(files, 'data/drillStats.json', z.array(drillStatsSchema));
  const drawingMetas = readJson(files, 'data/drawings.json', z.array(drawingMetaSchema));
  const critiques = readJson(files, 'data/critiques.json', z.array(critiqueSchema));
  const streak = readJson(files, 'data/streak.json', streakSchema);
  const counters = readJson(files, 'data/counters.json', countersSchema);
  const settings = readJson(files, 'data/settings.json', settingsSchema);
  const referenceMetas = readJson(files, 'data/references.json', z.array(referenceMetaSchema));

  const drawings: Drawing[] = drawingMetas.map((meta) => {
    const imageBytes = files[drawingImagePath(meta.id)];
    if (!imageBytes) {
      throw new Error(`バックアップに絵の画像が見つかりません: ${meta.id}`);
    }
    return { ...meta, image: bytesToBlob(imageBytes) };
  });

  const references: ReferenceImage[] = referenceMetas.map((meta) => {
    const imageBytes = files[referenceImagePath(meta.id)];
    if (!imageBytes) {
      throw new Error(`バックアップに取込画像が見つかりません: ${meta.id}`);
    }
    return { ...meta, image: bytesToBlob(imageBytes) };
  });

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
    profileStore.put(data.profile, SINGLETON_KEY),
    streakStore.put(data.streak, SINGLETON_KEY),
    countersStore.put(data.counters, SINGLETON_KEY),
    settingsStore.put(data.settings, SINGLETON_KEY),
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

  await profileStore.put(newer(currentProfile, data.profile), SINGLETON_KEY);
  await streakStore.put(newer(currentStreak, data.streak), SINGLETON_KEY);
  await countersStore.put(newer(currentCounters, data.counters), SINGLETON_KEY);
  await settingsStore.put(newer(currentSettings, data.settings), SINGLETON_KEY);

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
