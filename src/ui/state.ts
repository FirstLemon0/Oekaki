/**
 * アプリ状態（@preact/signals）。起動時に src/data/repo から読み込む。
 *
 * 利き手・ペン専用・合格ラインの厳しさ・通知時刻・文字サイズ・最終バックアップ日などは
 * data/types の Settings の正式項目（getSettings / updateSettings 経由）。
 * 旧 `settings.ui` の仮置きは廃止した（読み取り用の `uiPrefs` は Settings からの派生として残す）。
 */
import { batch, computed, effect, signal } from '@preact/signals';
import { flattenPath, loadCurriculum, type Curriculum, type PathNode } from '@/content';
import {
  applyFreezeToday,
  getCounters,
  getProfile,
  getSettings,
  getStreak,
  listCritiques,
  listDrillStats,
  listProgress,
  updateProfile,
  updateSettings,
} from '@/data/repo';
import { requestPersistentStorage } from '@/data/db';
import { todayLocalDate } from '@/data/date';
import { useFreezeToday as applyFreeze } from '@/data/streak';
import { dueReviews, type DueReview } from '@/data/review';
import { levelForXp, xpForDrillScore, xpForEvent } from '@/data/xp';
import type { Counters, Critique, DrillStats, Profile, Progress, Settings, Streak } from '@/data/types';

// ---------------------------------------------------------------------------
// UI 向け設定（Settings の該当項目の読み取りビュー）
// ---------------------------------------------------------------------------

/** Settings のうち UI が参照する項目。値の正は Settings（保存は saveSettings）。 */
export type UiPrefs = Pick<
  Settings,
  'leftHanded' | 'penOnly' | 'strictness' | 'notifyTime' | 'fontScale' | 'lastBackupAt' | 'backupSnoozedOn'
>;

export const DEFAULT_UI_PREFS: UiPrefs = {
  leftHanded: false,
  penOnly: true,
  strictness: 'normal',
  notifyTime: '20:00',
  fontScale: 'normal',
  lastBackupAt: null,
  backupSnoozedOn: null,
};

/** @deprecated Settings と同じ。互換のため残す */
export type AppSettings = Settings;

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------

export const ready = signal(false);
export const loadError = signal<string | null>(null);

export const curriculum = signal<Curriculum | null>(null);
export const progress = signal<Progress[]>([]);
export const streak = signal<Streak | null>(null);
export const counters = signal<Counters | null>(null);
export const settings = signal<Settings | null>(null);
export const profile = signal<Profile | null>(null);
export const drillStats = signal<DrillStats[]>([]);
export const critiques = signal<Critique[]>([]);
export const persisted = signal<boolean | null>(null);

/** 今日（端末ローカル）。日付またぎと 22 時判定のため 1 分ごとに更新する。 */
export const now = signal(new Date());
export const today = computed(() => todayLocalDate(now.value));

// ---------------------------------------------------------------------------
// 派生
// ---------------------------------------------------------------------------

export const uiPrefs = computed<UiPrefs>(() => {
  const s = settings.value;
  if (!s) return DEFAULT_UI_PREFS;
  return {
    leftHanded: s.leftHanded ?? DEFAULT_UI_PREFS.leftHanded,
    penOnly: s.penOnly ?? DEFAULT_UI_PREFS.penOnly,
    strictness: s.strictness ?? DEFAULT_UI_PREFS.strictness,
    notifyTime: s.notifyTime === undefined ? DEFAULT_UI_PREFS.notifyTime : s.notifyTime,
    fontScale: s.fontScale ?? DEFAULT_UI_PREFS.fontScale,
    lastBackupAt: s.lastBackupAt ?? null,
    backupSnoozedOn: s.backupSnoozedOn ?? null,
  };
});

export const path = computed<PathNode[]>(() => (curriculum.value ? flattenPath(curriculum.value) : []));

export const completedIds = computed(
  () => new Set(progress.value.filter((p) => p.completedAt !== null).map((p) => p.lessonId)),
);

/** 選択式レッスンを「飛ばす」で完了扱いにしたもの（completedIds にも含まれる） */
export const skippedIds = computed(
  () => new Set(progress.value.filter((p) => p.completedAt !== null && p.skipped === true).map((p) => p.lessonId)),
);

/** ISO 文字列を端末ローカルの YYYY-MM-DD に */
export function localDay(iso: string): string {
  return todayLocalDate(new Date(iso));
}

/** 今日初めて完了したレッスン（あれば最後のもの） */
export const completedTodayIds = computed(() =>
  progress.value
    .filter((p) => p.completedAt !== null && localDay(p.completedAt) === today.value)
    .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? -1 : 1))
    .map((p) => p.lessonId),
);

export const todayDone = computed(() => completedTodayIds.value.length > 0);

/** まだ完了していない最初のノード（＝次にやるレッスン） */
export const nextNode = computed(() => path.value.find((n) => !completedIds.value.has(n.lesson.id)));

export const isFirstRun = computed(() => progress.value.length === 0);

export const reviews = computed<DueReview[]>(() => dueReviews(drillStats.value, today.value));

/** 累計 XP（永続化されていないので記録から導出する。表示専用） */
export const totalXp = computed(() => {
  let xp = 0;
  const byId = new Map(path.value.map((n) => [n.lesson.id, n.lesson] as const));
  for (const p of progress.value) {
    if (p.completedAt === null) continue;
    const kind = byId.get(p.lessonId)?.kind ?? 'lesson';
    xp += xpForEvent(kind === 'checkpoint' ? 'checkpoint' : kind === 'graduation' ? 'graduation' : 'lesson') * p.attempts;
  }
  for (const s of drillStats.value) {
    for (const e of s.history) xp += xpForDrillScore(e.score);
  }
  return xp;
});

export const level = computed(() => levelForXp(totalXp.value));

/** ストリーク危機: 22 時以降・今日まだ活動なし・継続中のストリークがある */
export const streakAtRisk = computed(() => {
  const s = streak.value;
  if (!s || s.current === 0) return false;
  if (s.lastActiveDay === today.value) return false;
  return now.value.getHours() >= 22;
});

// ---------------------------------------------------------------------------
// 読み込み・更新
// ---------------------------------------------------------------------------

/** 旧版が settings.ui に仮置きしていた値を Settings の正式項目へ移す（一度だけ） */
async function migrateLegacyUi(se: Settings): Promise<Settings> {
  const legacy = (se as Settings & { ui?: Partial<UiPrefs> }).ui;
  if (!legacy || typeof legacy !== 'object') return se;
  const patch: Partial<UiPrefs> & { ui?: undefined } = { ui: undefined };
  for (const k of Object.keys(DEFAULT_UI_PREFS) as (keyof UiPrefs)[]) {
    if (k in legacy) (patch as Record<string, unknown>)[k] = legacy[k];
  }
  return updateSettings(patch as Partial<Settings>);
}

export async function reloadData(): Promise<void> {
  const [pr, st, co, seRaw, pf, ds, cr] = await Promise.all([
    listProgress(),
    getStreak(),
    getCounters(),
    getSettings(),
    getProfile(),
    listDrillStats(),
    listCritiques(),
  ]);
  const se = await migrateLegacyUi(seRaw);
  batch(() => {
    progress.value = pr;
    streak.value = st;
    counters.value = co;
    settings.value = se;
    profile.value = pf;
    drillStats.value = ds;
    critiques.value = cr;
  });
}

let initialized = false;

export async function initState(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    curriculum.value = loadCurriculum();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }

  try {
    await reloadData();
  } catch (e) {
    loadError.value = `データを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`;
  }

  ready.value = true;

  void requestPersistentStorage().then((ok) => {
    persisted.value = ok;
  });

  setInterval(() => {
    now.value = new Date();
  }, 60_000);
}

export async function saveSettings(patch: Partial<Omit<Settings, 'updatedAt'>>): Promise<void> {
  settings.value = await updateSettings(patch);
}

/** @deprecated saveSettings と同じ（UiPrefs は Settings の一部）。互換のため残す */
export async function saveUiPrefs(patch: Partial<UiPrefs>): Promise<void> {
  await saveSettings(patch);
}

/** 今日フリーズを使えるか。使えないときは理由（小さく添える文言）を返す */
export const freezeAvailability = computed<{ ok: true } | { ok: false; reason: string }>(() => {
  const s = streak.value;
  if (!s) return { ok: false, reason: '読み込み中です' };
  if (s.freezes <= 0) return { ok: false, reason: 'フリーズが残っていません' };
  if (s.lastActiveDay === today.value) return { ok: false, reason: '今日はもう記録があります' };
  if (applyFreeze(s, today.value) === null) return { ok: false, reason: '続いているストリークがありません' };
  return { ok: true };
});

/**
 * 今日フリーズを使って休む（ストリーク継続・フリーズ −1）。保存して streak を更新する。
 * 使えなかったときは false。
 */
export async function freezeToday(): Promise<boolean> {
  const next = await applyFreezeToday(today.value);
  if (!next) return false;
  streak.value = next;
  return true;
}

export async function saveProfile(patch: Partial<Omit<Profile, 'updatedAt'>>): Promise<void> {
  profile.value = await updateProfile(patch);
}

// ---------------------------------------------------------------------------
// 外観の反映（テーマ・文字サイズ）
// ---------------------------------------------------------------------------

/** index.html の theme-color と同じ値（DESIGN_SYSTEM §1 の paper） */
const THEME_COLOR = { light: '#F2EFE8', dark: '#2A2926' } as const;

effect(() => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const theme = settings.value?.theme ?? 'system';
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  const scale = uiPrefs.value.fontScale;
  if (scale === 'large') root.setAttribute('data-font-scale', 'large');
  else root.removeAttribute('data-font-scale');

  // theme-color は index.html にライト/ダークの 2 本（media 付き）。
  // 「システムに合わせる」なら既定値のまま、明示指定なら両方を今の紙色にそろえる。
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => {
    const media = meta.getAttribute('media') ?? '';
    const fallback = media.includes('dark') ? THEME_COLOR.dark : THEME_COLOR.light;
    if (theme === 'system') meta.setAttribute('content', fallback);
    else meta.setAttribute('content', THEME_COLOR[theme]);
  });
});
