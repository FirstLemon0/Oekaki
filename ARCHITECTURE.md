# 成長通 アーキテクチャと契約

DESIGN.md（構想）と DESIGN_BRIEF_UI.md（UI）を実装に落とすための取り決め。並行作業する人（エージェント）は、自分の担当ディレクトリの外を書かない。

## ディレクトリ

| パス | 役割 | 依存してよいもの |
|---|---|---|
| `src/scoring/` | 採点 A（純関数） | なし |
| `src/content/` | 教材スキーマ・ローダー・一本道パス | zod |
| `src/data/` | IndexedDB・ストリーク・復習・XP・バックアップ | idb, fflate, zod, scoring/types |
| `src/canvas/` | 描画エンジン（Pointer Events → ストローク、描画、Undo、重ね、再生、WebP 化） | scoring/types |
| `src/critic/` | 採点 B（Claude API 呼び出し、ルーブリック、上限、フォールバック） | @anthropic-ai/sdk, content/schema, data(設定の型のみ) |
| `src/ui/` | 画面・ルーティング・テーマ（Preact） | 上のすべて |
| `content/` | 教材データ（JSON）・図解 SVG・なぞりテンプレート | なし |
| `public/` | アイコン・静的ファイル | なし |

`src/app.tsx` と `src/main.tsx` は UI 担当だけが触る。

## 共通の型

- ストローク: `src/scoring/types.ts` の `StrokePoint {x,y,p,t}` / `Stroke` / `Drawing`。座標はキャンバス CSS px、`p` は 0..1、`t` は ms。
- 教材: `src/content/schema.ts` の `Stage/Unit/Lesson/Step/Rubric`（zod infer）。
- 永続データ: `src/data/types.ts`。

## 契約 1: キャンバス `src/canvas/`

```ts
export type Tool = 'pen' | 'eraser';
export interface OverlaySpec { kind: 'svg' | 'image' | 'strokes'; src: string | Blob | Drawing; opacity: number /* 0..1 */; }
export interface CanvasOptions {
  penOnly: boolean;            // true: pointerType 'pen' 以外の描画を無視
  leftHanded: boolean;         // UI 側の配置用。エンジンは参照のみ
  paperColor: string;          // 既定 var(--color-canvas)
  inkColor: string;            // 既定 var(--color-ink)
  baseWidth: number;           // 既定 3px。筆圧で 0.5x..1.6x
  grid: 'none' | 'thirds' | 'quarters';
  flipped: boolean;            // 左右反転表示（ストローク座標は反転しない）
  silhouette: boolean;         // 2値表示
}
export interface CanvasEngine {
  attach(host: HTMLElement): void;          // host 内に <canvas> を作る。ResizeObserver で追従
  detach(): void;
  setTool(t: Tool): void;
  setOptions(patch: Partial<CanvasOptions>): void;
  setOverlay(o: OverlaySpec | null): void;
  undo(): void; redo(): void; clear(): void;
  canUndo(): boolean; canRedo(): boolean;
  getStrokes(): Drawing;                    // 描いた順
  loadStrokes(d: Drawing): void;            // 再生・復元用
  replay(opts: { speed: number }): Promise<void>;  // 描いた順に再描画、途中で cancelReplay()
  cancelReplay(): void;
  toWebp(maxEdge: number, quality?: number): Promise<Blob>;
  size(): { width: number; height: number };
  on(event: 'strokeend', cb: (s: Stroke) => void): () => void;
  on(event: 'change', cb: () => void): () => void;
}
export function createCanvasEngine(opts?: Partial<CanvasOptions>): CanvasEngine;
```

Preact ラッパ `CanvasView`（`src/canvas/CanvasView.tsx`）: props `{ engine: CanvasEngine; class?: string }`。ツールバーは UI 側が描く（エンジンは描画面だけ）。

実装上の約束: `getCoalescedEvents()` で高頻度サンプル、`pointerrawupdate` は使わない。`touch-action: none`。描画中は requestAnimationFrame で差分描画、全再描画は Undo/オプション変更時のみ。ストロークは 2 点間を二次ベジェで滑らかに、筆圧で線幅。消しゴムはストローク単位で消す（当たり判定は点と線分距離）。

## 契約 2: 批評 `src/critic/`

```ts
export interface CritiqueRequest {
  image: Blob;                 // 長辺 1024 以下に縮小済み WebP/PNG（呼び出し側が downscaleToWebp する）
  task: string;                // 課題文
  rubric: Rubric;              // content/schema の Rubric
  stageTitle: string;
  settings: { apiKey: string; model: string; effort: 'low' | 'medium' | 'high'; };
}
export interface CritiqueResult {
  good: string[];              // 2..3
  issues: { where: string; what: string; fix: string }[];  // 0..3
  next_one: string;
  encourage: string;
  model: string;               // 実際に使ったモデル
  at: string;                  // ISO
  usage?: { input: number; output: number };
}
export class CriticError extends Error { kind: 'no_api_key' | 'daily_limit' | 'network' | 'model_unavailable' | 'refused' | 'bad_response'; }
export function critique(req: CritiqueRequest, deps?: { fetchImpl?: typeof fetch }): Promise<CritiqueResult>;
export function estimateCostJpy(model: string): number;   // 表示用の目安
```

- SDK はブラウザ直接モード（`dangerouslyAllowBrowser: true`）。
- 出力は構造化出力（JSON スキーマ）で受ける。**数値スコアを出させない**。日本語で、良い点 2〜3、直す点 最大 3（どこ／何が／どう直す）、次の 1 つ、励まし 1 文。
- モデルが 404/未提供なら `claude-opus-5` に 1 回だけフォールバックし、結果の `model` に実際のモデルを入れる。
- 1 日の上限は UI 側（data の settings と critiques の日付）で判定し、超えていれば呼ばない。critic は純粋に 1 回の呼び出し。
- thinking は既定（adaptive）。effort は `output_config.effort`。
- テストは `fetchImpl` を差し替えて行う。

## 契約 3: UI `src/ui/`

- `src/ui/theme.css`: DESIGN_BRIEF_UI.md と Design キャンバス「デザイントークン」の CSS 変数（ライト／ダーク）。`:root` と `[data-theme="dark"]`、`prefers-color-scheme` 追従。
- ルーティングはハッシュ（`#/`, `#/lesson/:id`, `#/lesson/:id/step/:n`, `#/free`, `#/gallery`, `#/gallery/:drawingId`, `#/settings`, `#/calibrate`）。
- 画面: Home（パス）、LessonPlayer（step 型ごとの部品）、CanvasScreen（ツールバー＋CanvasView＋採点シート）、GestureScreen、CritiqueScreen（確認→待機→結果）、Gallery、Settings、Calibrate、モーダル（レッスン完了／ステージ修了／ストリーク危機／Before-After）。
- 文言は「丁寧だが短い」。「うまい／へた」を使わない。絵文字を使わない。
- 描画中は何も動かさない（キャンバス画面にトースト・アニメーションを出さない）。
- 指のタップ目標 48px、ペン専用ボタン 36px 以上。

## 教材の書き方（content/）

`content/README.md` を正典とする。ステージごとに `content/stages/<id>.json`、図解は `content/figures/<id>.svg`（viewBox 800×500、線色は `currentColor`、太さ 2.5、文字は `Zen Kaku Gothic New`）、なぞりテンプレートは `content/templates/<id>.json`（`Drawing` 形式、座標は 0..1 の正規化）。

## 検証

- `npm run build`（tsc → vite build）が通ること。
- `npm test`（vitest）が通ること。
- Playwright 実操作は M8 で `e2e/` に置く。
