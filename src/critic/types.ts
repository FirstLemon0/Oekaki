/**
 * 採点 B（AI 画像批評）の契約型。
 * 正典: ARCHITECTURE.md「契約 2: 批評」
 */
import type { Rubric } from '../content/schema';

export type CriticEffort = 'low' | 'medium' | 'high';

export interface CritiqueSettings {
  apiKey: string;
  /** 例: 'claude-opus-5-5' */
  model: string;
  effort: CriticEffort;
}

export interface CritiqueRequest {
  /** 長辺 1024 以下に縮小済み WebP/PNG（呼び出し側が downscaleToWebp する） */
  image: Blob;
  /** 課題文 */
  task: string;
  rubric: Rubric;
  stageTitle: string;
  settings: CritiqueSettings;
}

export interface CritiqueIssue {
  where: string;
  what: string;
  fix: string;
}

export interface CritiqueResult {
  /** 2..3（モデルが多く返した場合は先頭 3 件に切り詰める） */
  good: string[];
  /** 0..3 */
  issues: CritiqueIssue[];
  next_one: string;
  encourage: string;
  /** 実際に使ったモデル（フォールバック時は 'claude-opus-5'） */
  model: string;
  /** ISO 8601 */
  at: string;
  usage?: { input: number; output: number };
}

export type CriticErrorKind =
  | 'no_api_key'
  | 'daily_limit'
  | 'network'
  | 'model_unavailable'
  | 'refused'
  | 'bad_response';

export class CriticError extends Error {
  readonly kind: CriticErrorKind;
  constructor(kind: CriticErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options);
    this.name = 'CriticError';
    this.kind = kind;
  }
}

export interface CritiqueDeps {
  /** テスト・差し替え用の fetch 実装（SDK の `fetch` オプションに渡す） */
  fetchImpl?: typeof fetch;
  /** 待機画面の「キャンセル」用。中断時は CriticError('network', 'aborted') */
  signal?: AbortSignal;
}
