# src/canvas — 描画エンジン v2

契約 1（ARCHITECTURE.md）＋ **契約 1b**（レイヤー・お絵描きツール・ビュー・操作履歴）の実装。Canvas 2D ＋ Pointer Events。
レッスン（ドリル・なぞり・校正・ジェスチャー）は 1 レイヤーのまま従来と同じ結果を返す（旧 API はすべて残す）。

## 概念図

```
               ┌──────────────── 文書（CanvasDocument） ────────────────┐
               │ layers: ops を適用する前のレイヤー（ふつうは空の 1 枚）   │
               │ ops:    CanvasOp[]（stroke / fill / transform / delete / │
               │         layer-add / -remove / -move / -set / -merge-down │
               │         / -duplicate / -clear）  座標はキャンバス座標     │
               └───────┬───────────────────────┬──────────────────────┘
       ops を順に再生   │                       │ ops を順に再生（点列だけ）
                       ▼                       ▼
  レイヤーごとのオフスクリーン canvas        vectorModel（ops.ts）
  （紙の大きさ × DPR、透明背景）             レイヤーごとの生の履歴
   ├ 表示用（bms）… 差分適用＋チェックポイント  → getStrokes()/getStyles()（見えているレイヤー、下から）
   ├ 再生用 … 同じ canvas を時点 0 から        → getHistory()（アクティブレイヤーの stroke op）
   └ 書き出し用 … 書き出し解像度で作り直す
                       │
                       ▼ 合成（compose）
  画面 = 紙色 → レイヤー（下から、visible / opacity / blend）→ 描画中の線・図形（アクティブレイヤーに合成）
         → 重ね（overlay）→ 選択の点線・変形プレビュー → 消しゴムの輪 → グリッド（画面座標に固定）
  画面座標 = DPR × 反転 × ビュー（zoom・回転・pan）× キャンバス座標。入力はその逆変換でキャンバス座標に。
```

- **Undo/Redo は op のまとまり（unit）単位**。ペン 1 本・図形 1 回（四角は 4 本で 1 手）・塗り 1 回・変形の確定 1 回・レイヤー操作 1 回・`clear()` 1 回がそれぞれ 1 手。上限 200 手。
- **チェックポイント**: stroke 以外で画素を書き換える op（fill / transform / delete / layer-clear / layer-merge-down / layer-remove）の直前と直後に、そのレイヤーの画像のコピーを取る。任意時点のレイヤー画像は「その時点以前で最も新しいチェックポイント ＋ それ以降の op の再適用」で作る（別レイヤーを参照する op＝参照 all の塗り・結合・複製は、参照先も同じ方法でその時点に戻して使う）。チェックポイントは直近 **20 op ぶん、かつ合計 256MB まで**。それより古い所へ Undo するときは ops の再適用。
- **サイズ**: 紙の大きさ（`getDocument().width/height`）は attach 後の画面の大きさで、画面が大きくなれば広げ、小さくなっても縮めない。レイヤー画像はキャンバス座標で保持するので、リサイズ・ビュー変更で描いたものは動かない（表示だけ変わる）。`loadStrokes`/`loadHistory`/`loadDocument` で今の画面の大きさにそろえ直す。

## ファイル

| ファイル | 中身 | DOM |
|---|---|---|
| `types.ts` | 契約の型（`Tool` / `CanvasEngine` / `CanvasOp` / `CanvasDocument` / `LayerInfo` / `SelectionMask` / `Mat` / `ViewState` …） | - |
| `engine.ts` | `createCanvasEngine()`（文書・Undo・表示・入力・再生・書き出し）、`DEFAULT_OPTIONS`、`historyOf` | attach 後のみ |
| `ops.ts` | op の純粋な部分: レイヤー一覧の再生 `applyLayerOp`、書き換えるレイヤー `writesOf`、点列モデル `vectorModel`/`visibleInk`、読み込みの検証 `sanitizeDocument` | 純関数 |
| `raster.ts` | op 1 手をレイヤー画像に描く（stroke / fill / transform / delete / 合成） | ○ |
| `paint.ts` | ストローク 1 本の描画（二次ベジェ・入り抜き・作業レイヤー合成・消しゴム） | ○ |
| `fill.ts` | 塗りつぶし（スキャンライン `floodFillMask`・`dilateMask`・`paintBehind`）、`parseHex`/`toHex` | 純関数 |
| `selection.ts` | 選択範囲（`sanitizeMask`・`pointInMask`・`transformMask`・点列の切り分け `cutStrokes`） | 純関数 |
| `matrix.ts` | アフィン行列（`mul`/`invert`/`apply`…）とビュー（`viewMatrix`・`gestureView`・`fitViewFor`） | 純関数 |
| `shapes.ts` | 図形 → 点列（直線 32 点・四角 4 本・楕円 64 点＋閉じ点、筆圧 0.6） | 純関数 |
| `CanvasView.tsx` | Preact ラッパ `{ engine, class? }` | ○ |
| `smooth.ts` / `hit.ts` / `history.ts` / `replay.ts` / `color.ts` / `crop.ts` / `pen.ts` / `erase.ts` / `grid.ts` | 従来どおり（筆圧・当たり判定・UndoStack（今は未使用）・再生スケジュール・CSS 変数・切り詰め・ペン・消しゴムの点列・グリッド） | 純関数 |
| `index.ts` | 公開 API の再エクスポート | - |

## 公開 API

### 契約 1（従来どおり）

```ts
const engine = createCanvasEngine({ penOnly: true, grid: 'thirds' }); // DOM には触らない
<div style="position:fixed; inset:0"><CanvasView engine={engine} /></div>

engine.setTool(t); engine.setOptions(patch); engine.setOverlay(o | null);
engine.undo(); engine.redo(); engine.clear(); engine.canUndo(); engine.canRedo();
engine.getStrokes();   // 見えているレイヤーのペンの線（下から、消しゴム適用済み）。1 レイヤーなら従来と同じ
engine.getStyles();    // getStrokes() と同じ並びのスタイル。historyOf(styles) で同じ時点の getHistory() を引ける
engine.getHistory();   // アクティブレイヤーの stroke op（消しゴム・補助線込み）
engine.loadHistory(h); engine.loadStrokes(d, styles?);  // 1 レイヤーの文書に置き換える（履歴リセット）
engine.setStrokeVisibility(alphas | null);              // getHistory() の添字ごとの表示だけの透明度
engine.setPen(p); engine.getPen(); engine.setEraser(e); engine.getEraser();
await engine.replay({ speed: 2 }); engine.cancelReplay();
await engine.toWebp(1024, 0.85, { crop: true });        // 紙色つき・内容の範囲で切り詰め（既定）
engine.size();          // 画面の大きさ（CSS px）
engine.on('strokeend' | 'change' | 'toolchange', cb);
```

### 契約 1b（v2 で追加）

```ts
// レイヤー（並びは下から。作ったレイヤーがアクティブになる）
engine.getLayers(); engine.getActiveLayer(); engine.setActiveLayer(id);
engine.addLayer({ name?, index? });         // 既定はアクティブのすぐ上。名前は「レイヤー n」
engine.removeLayer(id);                     // 最後の 1 枚は消せない
engine.duplicateLayer(id);                  // すぐ上に「◯◯ のコピー」
engine.mergeDown(id);                       // 上のレイヤーを不透明度・合成込みで下へ焼き込む（下の設定が残る。非表示なら捨てる）
engine.moveLayer(id, index); engine.setLayer(id, { name, visible, opacity, locked, blend });
engine.clearLayer(id);
await engine.getLayerThumbnail(id, 96);     // 長辺 96px の透明 PNG

// ツール: 'pen' | 'eraser' | 'guide' | 'fill' | 'eyedropper' | 'select-rect' | 'select-lasso'
//        | 'shape-line' | 'shape-rect' | 'shape-ellipse' | 'hand'
engine.setFill({ tolerance: 32, reference: 'layer' | 'all' }); engine.getFill();
engine.pickColor(x, y);                     // 見えているレイヤーの合成色 '#RRGGBB'（紙色なし）。透明なら null

// 選択と変形（座標はキャンバス座標）
engine.getSelection(); engine.setSelection(mask | null); engine.selectAll();
engine.transformSelection([a, b, c, d, e, f]); // 元の位置からの行列でプレビュー（何度でも上書き）。反転は -1 スケール
engine.commitTransform(); engine.cancelTransform(); engine.isTransforming(); engine.deleteSelection();

// ビュー
engine.getView(); engine.setView({ zoom, panX, panY, rotationDeg }); engine.resetView(); engine.fitView();
engine.toCanvasPoint(clientX, clientY); engine.toClientPoint(x, y);  // UI のハンドル描画用

// 文書・書き出し
engine.getDocument();        // { v: 2, width, height, layers（ops 適用前）, active, ops }
engine.loadDocument(doc);    // ops を順に適用して復元（履歴はリセット）。壊れた op は捨てる。レイヤーが無ければ throw
await engine.toPng(2048, { transparent: true, crop: false });  // 既定: 紙色を敷く・紙全体

engine.on('layerschange' | 'viewchange' | 'selectionchange' | 'opsend', cb);
```

- **保存の約束**（契約 1b）: レイヤーが 2 枚以上、または stroke 以外の op があるときだけ `Drawing.meta.doc = getDocument()`。それ以外は従来の `history`。再生は `doc` があれば `loadDocument` → `replay`。
- `getDocument()` の stroke op は必ず `style` を持つ（旧データのスタイル無しの線は `{ preset: 'pen', size: baseWidth, opacity: 1 }` にして出す＝見た目は同じ）。
- イベント: `change` と `opsend` は 1 手を積む／戻す／進めるたびに 1 回（`loadDocument` などの読み込みでも出る）。`layerschange` はレイヤーの並び・設定・アクティブが変わったとき。`selectionchange` は選択・変形プレビューが変わったとき。`viewchange` はビューが変わったとき（2 本指の操作中は毎フレーム）。スポイトで色を拾うと `toolchange`。

### ツールの動き

| ツール | 入力 | 積む op |
|---|---|---|
| pen / eraser / guide | 従来どおり（アクティブレイヤーに描く） | `stroke`（消しゴムは線の無い所をなぞると積まない。塗りのあるレイヤーでは常に積む） |
| shape-line / -rect / -ellipse | ドラッグ中は live レイヤーにプレビュー、離すと点列に展開 | 直線 1 本（32 点）／四角 4 本（角で分ける、各 8 点）／楕円 1 本（64 点＋閉じ点）。筆圧 0.6 固定、ペンの設定で描く。1 手。`strokeend` は線ごとに出る |
| fill | タップ（押した瞬間） | `fill`（色は `getPen().color`、未指定は墨）。紙の外は無視 |
| eyedropper | 押している間 | なし（`setPen({ color })`。透明なら墨に戻す） |
| select-rect / select-lasso | ドラッグで範囲。選択の中を押すと移動（プレビュー）。小さい矩形（タップ）は選択解除 | 確定（`commitTransform`）で `transform`。別の編集を始めると自動で確定 |
| hand | 1 本指・ペン・マウスでパン（penOnly でもタッチ可） | なし |

- **ロック中のレイヤー**には描けない・塗れない・消せない・変形できない（入力を無視するだけ。UI がロック表示する）。下がロックされている `mergeDown` も無視。
- **2 本指**: タッチ 2 本でピンチ＝ズーム（0.25〜8）、ドラッグ＝パン、ひねり＝回転（2 本目が触れてから ±3° を超えるまでは回転しない。離したときの 90° 吸着はしない）。`penOnly: false` のとき 1 本指は描画で、2 本目が触れた瞬間に描いている線を取り消してビュー操作に切り替える。
- **塗りつぶし**: 実寸（DPR 倍）の画素でスキャンライン法。`tolerance` は種の色との RGBA の最大差（完全に透明な画素どうしは RGB を見ない）。`reference: 'all'` は見えているレイヤーの合成（紙色なし・透明背景）を境界にして、塗りはアクティブレイヤーに入る（線画の下のレイヤーに塗る使い方）。塗り領域は max(1, round(DPR)) px 膨張し、色は既存の画素の**下に敷く**（線の縁のアンチエイリアスを残したまま隙間を埋める）。色は不透明。
- **変形**: 選択範囲をクリップで切り出した一時 canvas を行列で描くだけ（プレビュー中はレイヤー画像を変えない）。確定で元の場所を透明にして焼き込み、選択範囲も変形後の形になる（拡縮・移動だけなら矩形、回転などは投げ縄）。点列（`getStrokes`）も範囲内の点を行列で動かす（境界で切る近似）。
- **スポイト**: 見えているレイヤーを不透明度・合成込みで重ねた色（紙色は含めない）。アルファ 8/255 未満は透明扱い。半透明の色は RGB だけを返す。

## ペン・消しゴム・補助線（従来どおり）

| preset | label | size | opacity | 幅倍率（筆圧 0→1） | 不透明度倍率 | 入り抜き | 合成 | ざらつき |
|---|---|---|---|---|---|---|---|---|
| `pencil` | 鉛筆 | 2 | 0.85 | 0.6〜1.2 | 0.5〜1.0 | なし | source-over | ±0.5px |
| `pen` | ペン | 3 | 1 | 0.5〜1.6 | 1 | なし | source-over | なし |
| `brush` | 筆ペン | 5 | 1 | 0.2〜2.2 | 1 | あり | source-over | なし |
| `marker` | マーカー | 10 | 0.45 | 1（一定） | 1 | なし | multiply | なし |

- 不透明度 < 1・multiply・筆圧で濃淡が変わるペンは、1 本ずつ作業レイヤー（scratch）に描いてから opacity・blend でレイヤーに合成する（区間の継ぎ目が濃くならない）。marker の multiply は同じレイヤーの下の画素にだけ掛かり、紙には掛からない（描いている途中も mix で同じ見た目）。
- 消しゴムはラスター（`destination-out` の丸い線、半径 size）でアクティブレイヤーだけを消す。点列側（`getStrokes`）は `flattenHistory` で中心線を切り分ける近似。
- 補助線（`'guide'`）は幅 1.5px・不透明度 0.35・`--color-ink-2`。`getStrokes`/`getStyles`/`strokeend` に出ない。シルエットでは出さない。
- シルエット表示は線を太い黒、塗りつぶしを黒で描く（表示だけ。書き出しは普通の色）。
- 詳細（入り抜き・ざらつき・パレット 14 色・消しゴムの点列の切り分け・短い線の扱い・グリッド）は `pen.ts`・`erase.ts`・`grid.ts` のコメントを参照。

## 書き出し

- `toWebp(maxEdge, quality=0.85, { crop = true })`: 紙色＋見えているレイヤーの合成（グリッド・重ね・反転・シルエット・ビューは含めない）。`crop` は従来どおり「内容の範囲＋余白（長辺 × 8%、最低 24px）」、倍率は最大 4 倍。塗りつぶしがある文書は、画素で見た内容の範囲（長辺 1024px 以下で一度描いて測る）と線の範囲を合わせて切る。`crop: false` は画面の大きさ。
- `toPng(maxEdge, { transparent = false, crop = false })`: PNG。`transparent` で紙色を敷かない。`crop: false` は紙全体（`getDocument().width/height`）。
- どちらも ops を書き出し解像度で**最初から再適用**して描く（線はベクタから描き直すので拡大しても劣化しない。塗りつぶしも書き出し解像度で計算し直す）。attach 前でも document があれば書き出せる。
- `getLayerThumbnail(id, size)`: 表示中のレイヤー画像を縮小した透明 PNG（attach 前は ops から作る）。

## 手動確認手順（Chrome）

1. `npm run dev` で起動し、自由お絵描き（キャンバス画面）を開く。UI が未完成なら一時的なページに `CanvasView` を置き、DevTools の Console から `engine` を操作する。
2. 従来の確認: ペン 4 種・色・消しゴム（輪が出る・なぞった所だけ消える・1 回で Undo 1 手）・補助線・グリッド・左右反転・シルエット・重ね・再生・`toWebp`。ドリルで古い線が薄く・隠れること（`setStrokeVisibility`）。
3. レイヤー: 追加 → 別の色で描く → 下のレイヤーを非表示にすると上だけ見える → 不透明度 50% で薄くなる → 乗算で下の色と掛け合わさる → 並べ替え → 複製 → 下と結合（見た目が変わらない）→ 削除 → Undo でそれぞれ 1 手ずつ戻る。ロック中は描けない。
4. 図形: 直線・四角・楕円をドラッグ。離すまではプレビュー、離すと確定。四角は Undo 1 回で消える。
5. 塗りつぶし: 楕円を描いて中をタップ → 縁まで隙間なく塗れる（拡大して縁の白い隙間が無いこと）。線の途切れた図形では外まで流れる。線画レイヤーの下に新しいレイヤーを作り、参照「すべて」で塗ると下のレイヤーに塗れる。許容値 0 と 128 で違いを確かめる。
6. スポイト: 塗った所をタップ → ペンの色が変わる。何も無い所 → 墨に戻る。
7. 選択: 矩形・投げ縄で囲む（白黒の点線）→ 中をドラッグで移動 → 確定で元の場所が透明になる → Undo で戻る。UI の反転・拡縮・回転ボタン（`transformSelection`）→ キャンセルで元に戻る。「削除」で範囲が透明になる。
8. ビュー: DevTools のデバイスツールバー（タッチ）ではピンチができないので、実機（USB デバッグ + `chrome://inspect`）で 2 本指のズーム・パン・回転を確かめる。回転は少しひねっただけでは起きない。ズーム中に描いた線が指の下に出る。手のひらツールで 1 本指パン。`fitView`／`resetView`。
9. リサイズ・回転: 画面を回しても描いたもの（塗り・変形も）が動かないこと。DPR を 1 と 3 で切り替えて線・塗りがぼやけないこと。
10. 書き出し: `toPng(2048, { transparent: true })` を開いて背景が透明、`toWebp(1024)` は紙色つきで内容の範囲に切れていること。保存 → ギャラリーで同じ見た目・再生で描いた順（塗り・変形・レイヤー操作も順に）に出ること。
11. 自動の画素確認: 開発時はヘッドレス Chromium（Playwright）で「2 レイヤーに描き分け → 結合 → 塗りつぶし → 選択して移動 → 透過 PNG」を DPR 1 と 2 で画素比較した（一時スクリプト。リポジトリには置いていない）。

## 契約からの差分（追加のみ）

- 契約 1 以来の追加: `CanvasOptions.allowMouse`、`DEFAULT_OPTIONS`、`getHistory`/`loadHistory`/`historyOf`、`setStrokeVisibility`、`setPen`/`setEraser`、`toWebp` の `crop`、`'guide'`、各種純関数の export（従来どおり）。
- 契約 1b への追加: `FillOptions` / `ToPngOptions` 型、`CanvasDocument.layers` は「**ops 適用前**のレイヤー」と定義（最終状態は `getLayers()`）、`clear()` は内容のあるロックされていない全レイヤーを `layer-clear`（1 手）、`redo` でレイヤーの追加・複製をやり直すとそのレイヤーがアクティブに戻る、不透明度だけの `setLayer` を続けて呼ぶと 1 手にまとめる、`setFill` は値が変わると `toolchange`。
- `getStrokes()` は**見えている**レイヤーだけ（非表示レイヤーの線は採点・保存の点列に入れない）。`delete`/`transform` は点列も近似で追従（範囲内を捨てる／動かす。そのレイヤーの補助線は点列モデルから落ちる）。結合した上のレイヤーの線は下のレイヤーの点列に移る。
- `getHistory()` はアクティブレイヤーの stroke op をそのまま並べたもの（結合で移った線・変形は反映しない）。

## 既知の制限・性能上の注意

- **メモリ**: レイヤー 1 枚 = 紙の大きさ × DPR² × 4 バイト（1472×920・DPR 2 で約 21MB）。チェックポイントは 1 op あたり最大 2 枚で合計 256MB まで（その規模なら約 6 op ぶん。以降の Undo は再適用で遅くなる）。レイヤーを増やしすぎると端末のメモリを圧迫する。
- **性能（参考）**: 2944×1840 px の塗りつぶし約 120ms、その Undo 約 30ms（スナップショットから）、Redo は再計算で約 120ms（ヘッドレス Chromium・PC）。Redo と、チェックポイントの無い古い所への Undo は再適用なので、塗りの多い長い履歴では重くなる。
- ズームは表示時の拡大なので、ズーム 2 倍以上ではレイヤー画像（DPR 倍）が補間されてややぼやける（書き出しはベクタから描き直すので影響なし）。
- 紙の大きさは画面より小さくならない（縦横を回すと広い方に合わせて大きくなる）。広げた後に古い塗りつぶしを再適用すると、紙の端まで流れていた塗りが広がった分まで流れることがある。
- 変形は画素の補間（`imageSmoothingEnabled`）なので、何度も回転・拡縮すると少しずつぼやける。選択の縁はクリップのアンチエイリアスで 1px ほど半透明になる。
- `delete`/`transform` の点列（`getStrokes`）追従は中心線の近似。塗りつぶしは点列に現れない。
- 変形プレビュー中はそのレイヤーを 1 フレームごとに作業用 canvas で合成し直す。
- 2 本指のジェスチャー・筆圧は自動テストで実機を再現できない（偽の PointerEvent で経路だけ確認）。
- UI 側の注意: 画面回転で `loadHistory` により線を拡大縮小し直す従来の処理は、1 レイヤーの文書に置き換える（レイヤー・塗りは消える）。v2 の文書では呼ばないこと。
- 傾き（tiltX/Y）は保存しない。重ねの SVG は外部参照を読み込めない。
