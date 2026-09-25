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

## 契約 1b: キャンバス v2（レイヤー・お絵描きツール・ビュー・操作履歴）

契約 1 の API はすべて残す（レッスンのドリル・なぞり・校正はそのまま動く）。以下は **追加**。

```ts
// ---- レイヤー ----
export type BlendMode = 'normal' | 'multiply' | 'screen';
export interface LayerInfo { id: string; name: string; visible: boolean; opacity: number /* 0..1 */; locked: boolean; blend: BlendMode; }

// ---- ツール（既存 'pen' | 'eraser' | 'guide' に追加）----
export type Tool = 'pen' | 'eraser' | 'guide'
  | 'fill' | 'eyedropper' | 'select-rect' | 'select-lasso'
  | 'shape-line' | 'shape-rect' | 'shape-ellipse' | 'hand';

// ---- 選択とビュー ----
export type SelectionMask =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'lasso'; points: { x: number; y: number }[] };
export type Mat = [number, number, number, number, number, number]; // a b c d e f（CSS matrix と同じ）
export interface ViewState { zoom: number /* 0.25..8 */; panX: number; panY: number; rotationDeg: number; }

// ---- 操作履歴（再生・保存・Undo の単位）。座標はすべてキャンバス座標（CSS px、ビューに依存しない）----
export type CanvasOp =
  | { kind: 'stroke'; layer: string; points: Stroke; style: StrokeStyle }          // pen / eraser / guide / 図形（点列に展開済み）
  | { kind: 'fill'; layer: string; x: number; y: number; color: string; tolerance: number; reference: 'layer' | 'all' }
  | { kind: 'transform'; layer: string; mask: SelectionMask; matrix: Mat }           // 選択範囲の移動・拡縮・回転・反転
  | { kind: 'delete'; layer: string; mask: SelectionMask }                            // 選択範囲を透明に
  | { kind: 'layer-add'; layer: LayerInfo; index: number }
  | { kind: 'layer-remove'; layer: string }
  | { kind: 'layer-move'; layer: string; index: number }
  | { kind: 'layer-set'; layer: string; patch: Partial<Omit<LayerInfo, 'id'>> }
  | { kind: 'layer-merge-down'; layer: string }
  | { kind: 'layer-duplicate'; layer: string; newId: string }
  | { kind: 'layer-clear'; layer: string };
export interface CanvasDocument { v: 2; width: number; height: number; layers: LayerInfo[]; active: string; ops: CanvasOp[]; }

// ---- CanvasEngine への追加 ----
getLayers(): LayerInfo[];  getActiveLayer(): string;  setActiveLayer(id: string): void;
addLayer(opts?: { name?: string; index?: number }): LayerInfo;
removeLayer(id: string): void;  duplicateLayer(id: string): LayerInfo;  mergeDown(id: string): void;
moveLayer(id: string, index: number): void;  setLayer(id: string, patch: Partial<Omit<LayerInfo, 'id'>>): void;  clearLayer(id: string): void;
getLayerThumbnail(id: string, size: number): Promise<Blob>;   // レイヤーパネルのサムネイル（透明背景 PNG）

setFill(opts: Partial<{ tolerance: number /* 0..255、既定 32 */; reference: 'layer' | 'all' }>): void;  getFill(): { tolerance: number; reference: 'layer' | 'all' };
// 塗りつぶしの色は getPen().color（未指定は墨）。setTool('fill') 中のタップで op 'fill'
pickColor(x: number, y: number): string | null;   // 合成結果の色（透明なら null）。setTool('eyedropper') 中のタップでも自動で setPen({color}) して 'toolchange'

getSelection(): SelectionMask | null;  setSelection(mask: SelectionMask | null): void;  selectAll(): void;
transformSelection(matrix: Mat): void;  // プレビュー（何度でも上書き）。commitTransform() で op 化、cancelTransform() で戻す
commitTransform(): void;  cancelTransform(): void;  deleteSelection(): void;  isTransforming(): boolean;

getView(): ViewState;  setView(patch: Partial<ViewState>): void;  resetView(): void;  fitView(): void;
// 2 本指: ピンチ＝ズーム、ドラッグ＝パン、ひねり＝回転（エンジンが処理。1 本指は penOnly なら無視、そうでなければ描画）。'hand' ツールは 1 本指・ペン・マウスでパン
toCanvasPoint(clientX: number, clientY: number): { x: number; y: number };  // UI のハンドル描画用（ビューの逆変換）
toClientPoint(x: number, y: number): { x: number; y: number };

getDocument(): CanvasDocument;   loadDocument(doc: CanvasDocument): void;   // ops を順に適用して復元（履歴はリセット）
// 既存 getHistory()/loadHistory() はアクティブレイヤーの stroke op だけを扱う後方互換。単一レイヤーなら従来と同じ結果

toPng(maxEdge: number, opts?: { transparent?: boolean /* 既定 false＝紙色を敷く */; crop?: boolean }): Promise<Blob>;

on(event: 'layerschange' | 'viewchange' | 'selectionchange' | 'opsend', cb: () => void): () => void;
```

規則:
- Undo/Redo は op 単位（transform のプレビュー中は確定するまで積まない）。fill/transform/delete は直前のレイヤー画像のスナップショットを持ち、Undo は復元で行う（再生は ops の再適用）。
- `getStrokes()`/`getStyles()` は全レイヤー（下から順）のペンのストロークを返す（ドリルは 1 レイヤーなので従来と同じ）。
- 図形ツールはドラッグで直線・四角・楕円を **点列のストローク** に展開し、通常の 'stroke' op として積む（strokeend も発火）。四角は角で 4 本、楕円は 1 本の閉じた線。
- 塗りつぶしはスキャンライン法、`reference: 'all'` は合成結果を境界に使い、塗りはアクティブレイヤーに入る。アンチエイリアスの隙間対策に 1px の膨張を掛ける。
- レイヤーの表示・不透明度・合成は `globalAlpha` と `globalCompositeOperation` で合成。ロック中のレイヤーには描けない（入力を無視し 'toolchange' で UI に知らせる必要はない。UI 側がロック表示する）。
- 保存: `Drawing.meta.doc = getDocument()`（レイヤーが 2 枚以上、または stroke 以外の op があるときだけ。それ以外は従来の `history`）。ギャラリーの再生は `doc` があれば `loadDocument` → `replay`。
- `toWebp` は従来どおり紙色を敷いた合成結果（クロップ既定）。透過が要るときは `toPng({ transparent: true })`。
