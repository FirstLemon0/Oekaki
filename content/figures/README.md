# 図解 SVG の置き方

`read` ステップの `figure`、`quiz` の選択肢の `figure`、`construct` の各段階の
`figure`、`copy`（`reference: "builtin"`）の `refId` は、この `content/figures/`
配下の SVG ファイルの **id**（拡張子抜きのファイル名）を指定する。

## ルール（現在の実態）

- ファイル名 = id。例: `figure: "cube-2pt"` なら `content/figures/cube-2pt.svg`。
- `viewBox="0 0 800 500"` に統一する（横長。幅800×高さ500）。表示側は viewBox
  基準で拡大縮小するので、この比率を崩さないこと。
- ルート要素に共通の属性をまとめて付ける:
  `fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" font-family="Zen Kaku Gothic New, sans-serif"`
- **線の色は `currentColor`**。表示側の文字色を継承するので、ダークモードでも
  そのまま読める。黒・白・グレーの直書きはしない。
- **強調線は `#7BB661`**（アプリのアクセントの緑）。お手本の「ここを見る」線、
  消失点、番号の強調などに使う。1枚の中で強調は少なめに。
  （ステージ1・1.5 の初期の図には旧色 `#45702A` が残っている。新規は `#7BB661`。）
- 塗り（陰・落ち影など）は `fill="currentColor"` ＋ `fill-opacity`（0.15〜0.45 程度）
  で濃淡を表す。明・中・暗の3値なら、白（塗りなし）・薄い・濃いで描き分ける。
- アタリ線（構築線）・見えない辺は `stroke-dasharray="8 8" opacity="0.6"` の点線、
  補助のガイド線は細線（`stroke-width="1.5" opacity="0.45"`）で描き分ける。
- **日本語ラベル可**。`<text>` は `fill="currentColor"`（強調は `#7BB661`）、
  `stroke="none"`、18〜22px 程度。図の下端（y≈475）に1行のまとめを置くことが多い。
- 手順の番号は「丸＋数字」（半径15の円＋18pxの数字）。
- ファイル1つ＝説明1トピック。複数の意味を1枚に詰め込まない（`construct` の
  `stages` のように、段階ごとに別の SVG を指定してよい）。
- `copy` のお手本用の線画（`*-lineart`）は、ラベル・構築線・強調色を入れない。
- クイズの選択肢用の図（`quiz-*`）は、答えがわかる文字を入れない。

## 生成スクリプト

- ステージ1・1.5: `_gen/figures.mjs`
- それ以降の図は、各ステージの担当が手書きまたはスクリプトで作成している。
  既存の SVG は上書きしない（id が変わるとレッスン側の参照が切れるため）。

## 最小テンプレート

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" font-family="Zen Kaku Gothic New, sans-serif">
  <line x1="100" y1="400" x2="700" y2="400"/>
  <line x1="100" y1="300" x2="700" y2="300" stroke="#7BB661" stroke-width="4"/>
  <text x="400" y="475" font-size="20" fill="currentColor" stroke="none" text-anchor="middle">まとめの1行</text>
</svg>
```
