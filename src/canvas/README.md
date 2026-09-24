# src/canvas — 描画エンジン

契約 1（ARCHITECTURE.md）の実装。Canvas 2D ＋ Pointer Events。

## ファイル

| ファイル | 中身 | DOM |
|---|---|---|
| `types.ts` | 契約の型（`Tool` / `OverlaySpec` / `CanvasOptions` / `CanvasEngine`） | - |
| `engine.ts` | `createCanvasEngine()`、`DEFAULT_OPTIONS` | attach 後のみ |
| `CanvasView.tsx` | Preact ラッパ `{ engine, class? }` | ○ |
| `smooth.ts` | 筆圧正規化・線幅・移動平均・中点法の二次ベジェ区間 | 純関数 |
| `hit.ts` | 点と線分の距離、ストロークの当たり判定 | 純関数 |
| `history.ts` | `UndoStack<T>`（スナップショット方式） | 純関数 |
| `replay.ts` | 再生スケジューラ（`buildReplaySchedule` / `visibleCounts`） | 純関数 |
| `color.ts` | `var(--x, fb)` を実色に解決 | 純関数 |
| `crop.ts` | 書き出しの切り詰め範囲と倍率（`inkBounds` / `cropRect` / `exportScale`） | 純関数 |
| `pen.ts` | `PEN_PRESETS`・`PALETTE_COLORS`・線幅／濃淡／入り抜き／ざらつきの計算 | 純関数 |
| `erase.ts` | 部分消しゴム `eraseSegments`（消しゴムの軌跡でストロークを切り分ける） | 純関数 |
| `grid.ts` | `GridSpec` の正規化（旧 `'thirds'`/`'quarters'` 変換）と線の位置 `gridLines` | 純関数 |
| `index.ts` | 公開 API の再エクスポート | - |

## 使い方

```tsx
import { createCanvasEngine, CanvasView } from '@/canvas';

const engine = createCanvasEngine({ penOnly: true, grid: 'thirds' }); // DOM には触らない
engine.on('strokeend', (s) => scoreStroke(s));
engine.on('change', () => refreshToolbar(engine.canUndo(), engine.canRedo()));

<div style="position:fixed; inset:0"><CanvasView engine={engine} /></div>

engine.setTool('eraser');
engine.setOverlay({ kind: 'svg', src: svgText, opacity: 0.3 });
await engine.replay({ speed: 2 });
const blob = await engine.toWebp(1024);
```

- `CanvasView` は親要素いっぱいに広がる。親に大きさを与えること。
- 座標は CSS px。リサイズしてもストローク座標は変わらない（拡大縮小しない）。
- 同じ engine を別の要素へ attach し直すと、前の要素からは自動で detach する。

## ペン・消しゴム・グリッド（実機フィードバック対応で追加）

```ts
engine.setPen({ preset: 'brush' });            // プリセットを変える（size/opacity はそのプリセットで最後に使った値）
engine.setPen({ size: 8, opacity: 0.6 });      // 1..16 px / 0.1..1 に丸める
engine.setPen({ color: '#C8553D' });           // #RRGGBB。{ color: undefined } で墨色（テーマ追従）に戻す
engine.getPen();                               // { preset, size, opacity, color? }
engine.setEraser({ mode: 'partial', size: 16 }); // 'stroke'（丸ごと）| 'partial'（部分）、半径 4..40 px
engine.getEraser();
engine.on('toolchange', () => sync(engine.getPen(), engine.getEraser())); // 値が変わったときだけ
engine.setOptions({ grid: { kind: 'divide', n: 6 } }); // or { kind: 'pitch', px: 50 } / 'none'（旧 'thirds'/'quarters' も可）

// 保存と復元: 点列（採点用）とスタイルは別配列で、同じ並び・同じ長さ
const strokes = engine.getStrokes();          // 従来どおり {x,y,p,t}[][]（採点はこれだけ使う）
const styles = engine.getStyles();            // (StrokeStyle | undefined)[]
engine.loadStrokes(strokes, styles);          // styles 省略・不足分は undefined（= 旧データ扱い）
```

- 既定: ペン `{ preset: 'pen', size: 3, opacity: 1 }`（色なし＝墨）、消しゴム `{ mode: 'stroke', size: 12 }`。
- 新しく描いた線は、描き始めた時点のペン設定（`StrokeStyle`）を 1 本ずつ持つ。`undefined` のスタイル（旧データ・`loadStrokes` で省略）は `baseWidth` の pen・墨色で描く（従来と同じ見た目）。
- 保存するときは `getStyles()` も一緒に保存し（例: `Drawing.meta.strokeStyles`）、`loadStrokes(strokes, styles)` で戻す。**`getStrokes()` だけを加工して `loadStrokes` し直すとスタイルが消える**ので、並べ替え・間引き・拡大縮小するときは styles も同じ添字で扱うこと。
- `loadStrokes` は壊れたスタイルを `undefined` に、範囲外の size/opacity を丸め、色を大文字の `#RRGGBB` にそろえる（`sanitizeStyle`）。

### プリセット（`PEN_PRESETS`）

| preset | label | size | opacity | 幅倍率（筆圧 0→1） | 不透明度倍率 | 入り抜き | 合成 | ざらつき |
|---|---|---|---|---|---|---|---|---|
| `pencil` | 鉛筆 | 2 | 0.85 | 0.6〜1.2 | 0.5〜1.0 | なし | source-over | ±0.5px |
| `pen` | ペン | 3 | 1 | 0.5〜1.6 | 1 | なし | source-over | なし |
| `brush` | 筆ペン | 5 | 1 | 0.2〜2.2 | 1 | あり | source-over | なし |
| `marker` | マーカー | 10 | 0.45 | 1（一定） | 1 | なし | multiply | なし |

- 線幅 = `size × lerp(幅倍率, 筆圧)` × 入り抜き倍率。区間（点 k の二次ベジェ）ごとに点 k の筆圧で決める。
- 入り抜き（brush）: 始点・終点から「全長の 35%、最大 size × 6 px」の範囲で幅を最小 8% まで絞る（弧長基準なので速さで変わらない）。描いている間は始点側だけ絞り、終点側はペンを離したときに付く。
- ざらつき（pencil、`PenPresetSpec.grain`: 契約への追加）: 各点を x・y それぞれ ±0.5px ずらす。最初の点から決めたシード固定の擬似乱数なので、描画中・再描画・再生・書き出しで同じ形になる。
- 不透明度 < 1・multiply・筆圧で濃淡が変わるペンは、1 本ずつ作業レイヤーに不透明で描いてから `globalAlpha = opacity`・`globalCompositeOperation = blend` で合成する（区間の継ぎ目が濃くならない。1 本の中では濃さ一定、別の線との重なりは濃くなる）。pencil の筆圧による濃淡はレイヤー内で区間ごとに掛ける。
- 色: ストロークの `color`（無ければ `inkColor`）。marker の multiply は色つきでも「紙＋下の線」に掛かる（完了ストロークは紙色を含むキャッシュに合成するため、画面と `toWebp` で同じ見た目）。
- シルエット表示は色・不透明度・合成・入り抜き・ざらつきを無視し、従来どおり太い黒（幅倍率 × 3、最低 4 倍）。
- `PALETTE_COLORS: { label, color }[]`（推奨 14 色）: 墨 #2B2A28／灰 #8E8A80／茶 #7A5230／赤 #C8553D／朱 #D9674A／橙 #E08A2E／黄 #D9A441／若葉 #7BB661／緑 #3E8E7E／青 #3E7EC8／藍 #2F4E8F／紫 #7C5CB8／桃 #D97BA0／白 #FAF8F3。テーマに追従する墨にしたいときは `color` を未指定にする。

### 消しゴム

- `stroke`: 触れた線を丸ごと消す（従来）。当たり = 各線分との距離が「その線の線幅 + (size − 4) px」以内。既定 size 12 で従来の余白 8px と同じ。
- `partial`: 消しゴムの軌跡（半径 size の円を動かした範囲。点と点の間も線分で埋める）に入る部分を取り除き、残った連続区間を別のストロークに分ける（`eraseSegments`）。
  - 範囲内の点は取り除き、線分の途中で範囲に出入りする所には境界点を足す（x,y,p,t を線形補間）。残った元の点の p・t はそのまま。点の間隔が消しゴムより粗くても、なぞった所で正しく切れる。
  - 点が 2 個未満、または長さ 0.5px 未満の区間は捨てる。スタイルは元の線を引き継ぎ、分けた区間は元の位置に順に並ぶ（`getStrokes()`／`getStyles()` の対応は崩れない）。
  - 判定は線の中心線と消しゴムの距離（線幅は含めない）。
- どちらも 1 回なぞる（down〜up）で Undo 1 手。なぞっている間は消しゴムの輪（半径 size）を表示する。

### グリッドと左右反転

- `grid`: `'none'`、`{ kind: 'divide', n: 2|3|4|6|8 }`（画面を n 等分）、`{ kind: 'pitch', px: 25|50|100 }`（左上原点の等間隔、CSS px）。旧 `'thirds'`/`'quarters'` も受け付ける。線はデバイス px の整数 + 0.5 に置いた 1px 線、色 `rgba(43,42,40,.12)`。中身が同じ GridSpec を渡し直しても描き直さない。
- 表示の重ね順: 紙＋完了ストローク → 進行中ストローク → 重ね（overlay） → 消しゴムの輪 → グリッド。
- `flipped` は絵（完了・進行中）と重ねだけに掛け、**グリッドは画面座標に固定**（反転しない）。`toWebp` は反転を含めない（常に正像）。

## 契約からの差分（追加のみ）

- `CanvasOptions.allowMouse`（既定 `true`）: `penOnly` 中でもマウスでの描画を許可する（開発・PC 確認用）。タッチは `penOnly` 中は常に無視。本番で完全にペンのみにしたい場合は `false`。
- `DEFAULT_OPTIONS` を export。
- `loadStrokes()` は履歴をリセットする（読み込み前へは Undo できない）。
- `penOnly` の既定は `false`（契約に既定値の記載がないため。設定から渡す想定）。
- `toWebp(maxEdge, quality?, opts?)` の第 3 引数 `ToWebpOptions { crop?: boolean }`（既定 `true`）。紙全体が欲しいときは `{ crop: false }`。
- `cropRect` / `inkBounds` / `exportScale` と余白定数を export（UI で切り詰め範囲を知りたい場合用）。`cropRect(d, baseWidth, styles?)` / `inkBounds(d, baseWidth, styles?)` は styles を渡すとペンごとの幅で計算する。
- `PenPresetSpec.grain`（ざらつきの量）、`PALETTE_COLORS` / `PaletteColor`、`DEFAULT_PEN` / `DEFAULT_ERASER`、各範囲定数、`sanitizeStyle` / `normalizeHexColor`、`eraseSegments`、`normalizeGrid` / `gridLines` / `GRID_COLOR` を export。
- `strokeHit(stroke, pt, baseWidth, margin?, widthAt?)` の第 5 引数（筆圧 → 線幅）。

## 挙動の細部

- 描画: 生の点を保存し（0.3px 未満の移動は捨てる）、表示は中点法の二次ベジェ。点 k の区間は点 k+1 が来た時点で確定するので、描画中は requestAnimationFrame ごとに新しく確定した区間だけを描き足す。末尾区間はペンを離したときに描く。
- 線幅: 上の「プリセット」参照（スタイルなしの線は `baseWidth × (0.5 + 1.1 × p)`）。`e.pressure` が 0 のときは 0.5。
- 時刻 `t` はエンジンごとの基準からの ms（`PointerEvent.timeStamp` 由来）。`loadStrokes` 後に描き足すと、読み込んだ最後の t + 300ms から続く。
- 消しゴム: 上の「消しゴム」参照。1 回なぞる（down〜up）で 1 操作として Undo に積む。
- `clear()` も 1 操作（Undo 可）。空のときは何もしない。
- `pointercancel` 時、1 点しかないストロークは捨て、2 点以上なら確定する。
- レイヤー: オフスクリーン canvas を 3 枚使う。cache（紙色＋完了ストローク）、live（進行中ストローク・再生中の途中の線）、scratch（1 本ずつ合成する作業用）。表示は毎フレーム cache → live → 重ね → グリッドを合成する。cache の全再描画は Undo/Redo/消去/消しゴム/色やシルエットの変更/リサイズ時のみ。
- `flipped`: 絵と重ねに `scale(-1,1)`（グリッドは除く）。入力座標も反転して戻すので保存座標は反転しない。
- `silhouette`: 白地に完了ストロークを太い黒（線幅 × 3、最低 baseWidth × 4）で描く。グリッドと重ねは出さない。
- 重ね: `svg`/`image` はキャンバスに収まるよう縦横比を保って中央に配置（contain）。`strokes` はストローク座標そのままの位置に墨色で描く。どれも `globalAlpha = opacity`。
- 再生: ストロークの `t` に従う。ストローク間の空きは最大 400ms、ストローク内の点間隔は最大 200ms に詰めてから `speed` で割る。途中の線は live レイヤーに描き足し、描き終えた線は完成形（入り抜き・合成込み）を cache に描く。再生中は入力を受け付けない。Undo 等を呼ぶと再生は止まる。
- `toWebp(maxEdge, quality=0.85, { crop = true })`: 紙色の上に完了ストロークだけ（ペン・色・合成は画面と同じ。グリッド・重ね・反転・シルエットは含めない）。`toBlob('image/webp')` が null なら PNG。attach 前でも document があれば書き出せる。
  - `crop: true`（既定）: 完了ストロークの範囲（各点の線幅の半分ぶん外側まで）に、余白「内容の長辺 × 8%、最低 24px」を四方に足して切り取る。縦横比は内容のまま（正方形にしない）。倍率は `maxEdge / 長辺`、ただし最大 4 倍まで（小さな絵を拡大しても線はベクタから描き直すので劣化しない）。ストロークが無ければ紙全体。
  - `crop: false`: 紙全体（attach 前はストロークの範囲 + 16px、原点 0,0）。解像度は CSS px × min(DPR, maxEdge / 長辺)。
- 色: `paperColor` / `inkColor` の `var(--x)` は attach 先の要素の computed style で解決する（未定義なら `#f3f0ea` / `#2b2926`）。テーマ切替後は `setOptions({ paperColor: 'var(--color-canvas)' })` のように同じ値を渡し直すと再解決する。
- DPR: `matchMedia('(resolution: Ndppx)')` の change で追従（ブラウザのズーム・外部モニタ移動）。

## 手動確認手順（Chrome）

1. `npm run dev` で起動し、`CanvasView` を置いた画面（キャンバス画面）を開く。UI が未完成なら、一時的なページで `<div style="position:fixed;inset:0"><CanvasView engine={createCanvasEngine()} /></div>` を描画する。
2. マウスで描く: 線が遅れずに追従し、角がカクカクしないこと。速く描いても途切れないこと。
3. DevTools でタッチを試す: DevTools を開き、デバイスツールバー（Ctrl+Shift+M）を ON、デバイスを「Galaxy Tab」等のタブレットにする。マウス操作がタッチとして送られる。
   - `penOnly: false` → 描ける。
   - `penOnly: true` → 描けない（タッチを無視）。ページがスクロール・ズームしないこと（`touch-action: none`）。
4. ペンを試す: 実機（Android タブレット＋ペン）を USB デバッグでつなぎ、PC の `chrome://inspect` からリモートデバッグする。DevTools だけではペン（`pointerType: 'pen'`）と筆圧はエミュレートできない。筆圧で線幅が 0.5〜1.6 倍に変わること、`penOnly: true` で手のひらが触れても線が出ないことを確認。
   - 実機がない場合: Console で `PointerEvent` を合成して `pointerType: 'pen', pressure: 0.9` を canvas に dispatch すると入力経路だけは確認できる（`getCoalescedEvents` は空になるので単発イベントで処理される）。
5. 消しゴム: `setTool('eraser')`（既定の `mode: 'stroke'`）でなぞると、触れたストロークが丸ごと消える。1 回の Undo でなぞる前に戻る。
6. Undo/Redo/全消し: 全消し → Undo で全部戻る。
7. DPR: DevTools のデバイスツールバーで DPR を 1 と 3 に切り替え、線がぼやけないこと。ウィンドウをリサイズしても線の位置が変わらないこと。
8. 表示: グリッド（14 も参照）、左右反転（反転中に描いた線が反転解除後に鏡像位置へ来ること）、シルエット、重ね（SVG・画像・ストローク、不透明度 0〜1）。
9. 再生: `replay({ speed: 2 })` で描いた順に再描画され、`cancelReplay()` で即座に完成状態に戻る。
10. 書き出し: `toWebp(1024)` の Blob を `URL.createObjectURL` で開き、紙色＋線のみで、グリッド・重ねが入っていないこと。紙の隅に小さく描いた絵が、余白つきで内容の縦横比のまま切り取られていること。`toWebp(1024, 0.85, { crop: false })` では紙全体になること。
11. ギャラリーの再生: ギャラリーで保存済みの絵（ストロークつき）を開き、再生ボタンで描いた順に再描画されること（`loadStrokes` → `replay`）。再生中に停止すると即座に完成状態に戻り、もう一度再生すると最初から描き直すこと。再生中に画面を離れても（detach）エラーが出ないこと。取込画像（ストロークなし）では再生ボタンが出ない／押しても何も起きないこと。
12. ペン: ツールでプリセットを切り替えて描き比べる。
    - ペン: 従来と同じ（筆圧で 0.5〜1.6 倍）。
    - 鉛筆: 細く、軽い筆圧で薄く・強い筆圧で濃くなる。線の縁がわずかに揺れる。Undo/Redo・画面回転で描き直しても揺れ方が変わらないこと。
    - 筆ペン: 入りと抜きが細く尖る（描いている間は入りだけ、離すと抜きが付く）。筆圧で太さが大きく変わる。
    - マーカー: 太さ一定・半透明。1 本の中で折り返しても濃くならず、別の線と重なった所だけ濃くなる。色つきでも同じ。
    - 色: パレットで色を変えて描き、前に描いた線の色が変わらないこと。色なし（墨）の線はテーマ切替に追従すること。シルエット表示では全部黒になること。
    - サイズ・不透明度のスライダーが次の線から効くこと。プリセットを行き来するとそれぞれの値に戻ること。
13. 部分消しゴム: モードを「部分」にして線の真ん中をなぞる → そこだけ消えて 2 本に分かれる。端をなぞる → 短くなる。速く描いた（点がまばらな）線を横切っても切れる。1 回の Undo でなぞる前に戻る。分かれた線も元の色・ペンのまま。なぞっている間は輪が表示され、半径スライダーで大きさが変わること。「丸ごと」モードは従来どおり線全体が消えること。
14. グリッド: 2/3/4/6/8 分割、25/50/100px 間隔を切り替え、線が 1px でにじまないこと（DPR 1 と 3 の両方）。左右反転しても**グリッドは動かず**、絵と重ね（お手本）だけ反転すること。反転中に描いている途中の線も反転して見えること。
15. 保存: 各ペン・色で描いた絵を保存 → ギャラリーで開いて同じ見た目で表示・再生されること（UI が `getStyles()` を保存している場合）。反転中に保存しても正像で保存されること。

## 既知の制限

- 描画のピクセル結果と Pointer Events 入力は自動テストがない（jsdom/Canvas が無いため）。再生・書き出しは `engine-dom.test.ts` で偽 DOM（2D コンテキストの呼び出し記録・rAF・時計の差し替え）を使い、描いた区間数・Promise の解決・状態の不変を確かめている。Playwright での実操作テストは UI 側で行う想定。
- 傾き（tiltX/Y）は保存しない（契約の `StrokePoint` に無いため）。
- 線幅の変化は区間単位（区間内では一定）なので、筆圧が急に変わると太さの段差がわずかに見えることがある（筆ペンの入り抜きも区間単位の段階的な変化）。
- 鉛筆の筆圧による濃淡は区間ごとの不透明度なので、濃さが変わる所の継ぎ目がわずかに見えることがある。
- マーカーの multiply は白系の色では見えない（掛け算のため）。
- 部分消しゴムの判定は線の中心線まで（太い線の縁だけを触っても消えない）。消した跡が筆ペンだと、切れ目にも入り抜きが付く。
- 部分消しゴムで分かれた線は、採点（`getStrokes()`）上も別のストロークになる。
- 描いている途中のマーカー等の合成はフレームごとに全層を合成し直すので、非常に大きな画面では従来より負荷が高い。
- 重ねの SVG は外部参照（外部フォント・画像）を読み込めない（Blob URL の Image 描画の制約）。
- リサイズでストロークは拡大縮小しない。縦横切替で画面外に出た線は見えないが、データには残る。
- 再生中にリサイズすると、その時点までの再生分を描き直す（位置は保たれる）。
