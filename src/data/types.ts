/**
 * データ層の型定義（DESIGN.md §8「データモデル」に対応）。
 *
 * 日付はすべて端末ローカルの暦日を表す `YYYY-MM-DD` 文字列で保持する。
 * 時刻を含む値は ISO 8601 文字列（`updatedAt` / `createdAt` / スコア履歴の `at` 等）。
 *
 * すべてのレコードに `updatedAt`（ISO 8601）を持たせている。バックアップの
 * マージ（`backup.ts`）で「id（または自然キー）が衝突したら updatedAt が新しい方を
 * 採用する」というルールを、ストア横断で一貫させるための設計判断。
 */

// src/scoring/types.ts の Drawing（= StrokePoint[][]、{x,y,p,t}[][]）をそのまま使う。
// アプリ内キャンバスで描いた場合のみ Drawing.strokes に入る。
import type { Drawing as StrokeDrawing } from '@/scoring/types';
export type { StrokeDrawing };

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

export interface CalibrationResult {
  /** 校正を行った日時（ISO 8601）。 */
  calibratedAt: string;
  /** ドリル種別 → 校正で決めた合格ラインの基準値（0〜100）。 */
  baselines: Record<string, number>;
}

export interface Profile {
  /** アプリを使い始めた日（YYYY-MM-DD）。 */
  startedAt: string;
  /** Before の絵（drawings ストア）の ID。まだ無ければ null。 */
  beforeDrawingId: string | null;
  /** Before を保存した日（YYYY-MM-DD）。月次描き直し通知の起点。 */
  beforeCreatedAt: string | null;
  /** After の絵（drawings ストア）の ID。まだ無ければ null。 */
  afterDrawingId: string | null;
  /** 校正モードの結果。未実施なら null。 */
  calibration: CalibrationResult | null;
  /** 直近で Before/After の月次描き直し通知を出した日（YYYY-MM-DD）。 */
  lastMonthlyPromptAt: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// progress（key: lessonId）
// ---------------------------------------------------------------------------

export interface Progress {
  lessonId: string;
  /** 初回完了日時（ISO 8601）。未完了なら null。 */
  completedAt: string | null;
  /** 完了（やり直し含む）回数。 */
  attempts: number;
  /** 直近の採点（A/自動採点があるレッスン型のみ）。無ければ null。 */
  lastScore: number | null;
  /** 選択式レッスン（optional）を「飛ばす」で完了扱いにした場合 true。 */
  skipped?: boolean;
  /** 途中で中断したときの次に開くステップ番号（0 始まり）。完了時は null。 */
  lastStep?: number | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// drillStats（key: drillType）
// ---------------------------------------------------------------------------

export interface ScoreEntry {
  /** 記録日時（ISO 8601）。 */
  at: string;
  /** 0〜100 に正規化した点数。 */
  score: number;
}

export interface DrillStats {
  drillType: string;
  history: ScoreEntry[];
  /** 自己ベスト（history が空なら null）。 */
  bestScore: number | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// drawings（key: id、index: byLesson / byKind / byCreatedAt）
// ---------------------------------------------------------------------------

export type DrawingKind = 'drill' | 'lesson' | 'free' | 'before' | 'after' | 'submit';

export interface Drawing {
  id: string;
  /** 紐づくレッスン ID。自由枠・Before/After 等では null。 */
  lessonId: string | null;
  kind: DrawingKind;
  /** WebP に縮小した画像本体。 */
  image: Blob;
  /** 作成日時（ISO 8601）。 */
  createdAt: string;
  /** アプリ内キャンバスで描いた場合のみ持つストローク列。取込画像は null。 */
  strokes: StrokeDrawing | null;
  /** 付随情報（模写チェックポイントの差分マーク位置など）。JSON 化できる値のみ。 */
  meta?: Record<string, unknown>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// critiques（key: drawingId）
// ---------------------------------------------------------------------------

export interface CritiqueIssue {
  /** どこ */
  where: string;
  /** 何が */
  what: string;
  /** どう直す */
  how: string;
}

/** DESIGN.md §5.2 の B（AI画像批評）応答スキーマ。数値スコアは含めない。 */
export interface CritiqueResponse {
  good: string[];
  issues: CritiqueIssue[];
  next_one: string;
  encourage: string;
}

export interface Critique {
  drawingId: string;
  response: CritiqueResponse;
  model: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// streak（単一）
// ---------------------------------------------------------------------------

export interface Streak {
  current: number;
  longest: number;
  /** 保持しているストリークフリーズの個数（最大2）。 */
  freezes: number;
  /** 最後に活動があった日（YYYY-MM-DD）。未活動なら null。 */
  lastActiveDay: string | null;
  /** 次にフリーズを獲得する `current` の閾値（7日ごと）。 */
  nextFreezeAt: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// counters（単一）
// ---------------------------------------------------------------------------

export type CounterKind = 'line' | 'ellipse' | 'circle' | 'box' | 'gesture' | 'completed';

export interface Counters {
  /** 直線の本数。 */
  line: number;
  /** 楕円の個数。 */
  ellipse: number;
  /** 円の個数。 */
  circle: number;
  /** 箱（250箱チャレンジ）の個数。 */
  box: number;
  /** ジェスチャードローイングの回数。 */
  gesture: number;
  /** 完成させた絵の枚数。 */
  completed: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// settings（単一）
// ---------------------------------------------------------------------------

export type CritiqueEffort = 'low' | 'medium' | 'high';
export type Theme = 'light' | 'dark' | 'system';
export type Strictness = 'easy' | 'normal';
export type FontScale = 'normal' | 'large';

export interface Settings {
  /** Anthropic API キー。未設定なら null。 */
  apiKey: string | null;
  modelId: string;
  effort: CritiqueEffort;
  /** B（AI画像批評）の1日あたりの呼び出し上限。 */
  dailyCritiqueLimit: number;
  /** ステージ7以降で使う外部お絵描きアプリ名。未設定なら null。 */
  externalAppName: string | null;
  theme: Theme;
  /** 左利き。ツールバーと完了ボタンの位置が入れ替わる。 */
  leftHanded: boolean;
  /** ペン専用モード（指では描けない）。 */
  penOnly: boolean;
  /** 合格ラインの厳しさ。表示の点数だけが変わる。 */
  strictness: Strictness;
  /** 通知時刻 HH:MM。null は通知なし。 */
  notifyTime: string | null;
  fontScale: FontScale;
  /** 最終バックアップ日時（ISO）。null は未実施。 */
  lastBackupAt: string | null;
  /** バックアップ通知を「あとで」にした日（YYYY-MM-DD）。 */
  backupSnoozedOn: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// references（key: id）
// ---------------------------------------------------------------------------

export interface ReferenceImage {
  id: string;
  /** ユーザーが端末に保存した模写対象の取込画像。 */
  image: Blob;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}
