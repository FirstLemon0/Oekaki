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

## 契約からの差分（追加のみ）

- `CanvasOptions.allowMouse`（既定 `true`）: `penOnly` 中でもマウスでの描画を許可する（開発・PC 確認用）。タッチは `penOnly` 中は常に無視。本番で完全にペンのみにしたい場合は `false`。
- `DEFAULT_OPTIONS` を export。
- `loadStrokes()` は履歴をリセットする（読み込み前へは Undo できない）。
- `penOnly` の既定は `false`（契約に既定値の記載がないため。設定から渡す想定）。
- `toWebp(maxEdge, quality?, opts?)` の第 3 引数 `ToWebpOptions { crop?: boolean }`（既定 `true`）。紙全体が欲しいときは `{ crop: false }`。
- `cropRect` / `inkBounds` / `exportScale` と余白定数を export（UI で切り詰め範囲を知りたい場合用）。

## 挙動の細部

- 描画: 生の点を保存し（0.3px 未満の移動は捨てる）、表示は中点法の二次ベジェ。点 k の区間は点 k+1 が来た時点で確定するので、描画中は requestAnimationFrame ごとに新しく確定した区間だけを描き足す。末尾区間はペンを離したときに描く。
- 線幅 = `baseWidth × (0.5 + 1.1 × p)`。`e.pressure` が 0 のときは 0.5。
- 時刻 `t` はエンジンごとの基準からの ms（`PointerEvent.timeStamp` 由来）。`loadStrokes` 後に描き足すと、読み込んだ最後の t + 300ms から続く。
- 消しゴム: ストローク単位。消しゴム位置（4px 間隔で補間）と各線分の距離が「その線分の線幅 + 8px」以下なら消す。1 回なぞる（down〜up）で 1 操作として Undo に積む。
- `clear()` も 1 操作（Undo 可）。空のときは何もしない。
- `pointercancel` 時、1 点しかないストロークは捨て、2 点以上なら確定する。
- レイヤー: 紙色 → グリッド → 重ね → 完了ストローク（オフスクリーン canvas にキャッシュ） → 進行中ストローク。全再描画は Undo/Redo/消去/オプション変更/リサイズ時のみ。
- `flipped`: 表示全体に `scale(-1,1)`。入力座標も反転して戻すので保存座標は反転しない。
- `silhouette`: 白地に完了ストロークを太い黒（線幅 × 3、最低 baseWidth × 4）で描く。グリッドと重ねは出さない。
- 重ね: `svg`/`image` はキャンバスに収まるよう縦横比を保って中央に配置（contain）。`strokes` はストローク座標そのままの位置に墨色で描く。どれも `globalAlpha = opacity`。
- 再生: ストロークの `t` に従う。ストローク間の空きは最大 400ms、ストローク内の点間隔は最大 200ms に詰めてから `speed` で割る。再生中は入力を受け付けない。Undo 等を呼ぶと再生は止まる。
- `toWebp(maxEdge, quality=0.85, { crop = true })`: 紙色の上に完了ストロークだけ（グリッド・重ね・反転・シルエットは含めない）。`toBlob('image/webp')` が null なら PNG。attach 前でも document があれば書き出せる。
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
5. 消しゴム: `setTool('eraser')` でなぞると、触れたストロークが丸ごと消える。1 回の Undo でなぞる前に戻る。
6. Undo/Redo/全消し: 全消し → Undo で全部戻る。
7. DPR: DevTools のデバイスツールバーで DPR を 1 と 3 に切り替え、線がぼやけないこと。ウィンドウをリサイズしても線の位置が変わらないこと。
8. 表示: グリッド（3 分割・4 分割）、左右反転（反転中に描いた線が反転解除後に鏡像位置へ来ること）、シルエット、重ね（SVG・画像・ストローク、不透明度 0〜1）。
9. 再生: `replay({ speed: 2 })` で描いた順に再描画され、`cancelReplay()` で即座に完成状態に戻る。
10. 書き出し: `toWebp(1024)` の Blob を `URL.createObjectURL` で開き、紙色＋線のみで、グリッド・重ねが入っていないこと。紙の隅に小さく描いた絵が、余白つきで内容の縦横比のまま切り取られていること。`toWebp(1024, 0.85, { crop: false })` では紙全体になること。
11. ギャラリーの再生: ギャラリーで保存済みの絵（ストロークつき）を開き、再生ボタンで描いた順に再描画されること（`loadStrokes` → `replay`）。再生中に停止すると即座に完成状態に戻り、もう一度再生すると最初から描き直すこと。再生中に画面を離れても（detach）エラーが出ないこと。取込画像（ストロークなし）では再生ボタンが出ない／押しても何も起きないこと。

## 既知の制限

- 描画のピクセル結果と Pointer Events 入力は自動テストがない（jsdom/Canvas が無いため）。再生・書き出しは `engine-dom.test.ts` で偽 DOM（2D コンテキストの呼び出し記録・rAF・時計の差し替え）を使い、描いた区間数・Promise の解決・状態の不変を確かめている。Playwright での実操作テストは UI 側で行う想定。
- 傾き（tiltX/Y）は保存しない（契約の `StrokePoint` に無いため）。
- 線幅の変化は区間単位（区間内では一定）なので、筆圧が急に変わると太さの段差がわずかに見えることがある。
- 消しゴムは部分消しをしない（ストローク単位のみ）。
- 重ねの SVG は外部参照（外部フォント・画像）を読み込めない（Blob URL の Image 描画の制約）。
- リサイズでストロークは拡大縮小しない。縦横切替で画面外に出た線は見えないが、データには残る。
- 再生中にリサイズすると、その時点までの再生分を描き直す（位置は保たれる）。
