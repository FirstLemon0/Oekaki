# 図解 SVG の置き方

`read` ステップの `figure` や `quiz` の選択肢の `figure`、`construct` の各段階の
`figure` は、この `content/figures/` 配下の SVG ファイルの **id**（拡張子抜きの
ファイル名）を指定する。

## ルール

- ファイル名 = id。例: `figure: "loomis-head-front"` なら `content/figures/loomis-head-front.svg`。
- `viewBox="0 0 800 500"` に統一する（横長。幅800×高さ500）。表示側は viewBox
  基準で拡大縮小するので、この比率を崩さないこと。
- 線の色はハードコードせず、CSS 変数 `--fig-ink` を使う（ダークモード対応のため）。
  例: `<path d="..." stroke="var(--fig-ink)" fill="none" stroke-width="4" />`
- 塗りが必要な場合も同様に、専用の CSS 変数（例: `--fig-fill`）を用意して使う。
  固定の黒・白・グレーの直書きは避ける。
- アタリ線（構築線）と仕上げ線を区別したい場合は、`stroke-dasharray` や
  `opacity` で描き分ける（色を変えない）。
- ファイル1つ＝説明1トピック。複数の意味を1枚に詰め込まない（`construct` の
  `stages` のように、段階ごとに複数の SVG を用意する）。
- 文字は入れない（多言語化・拡大時の可読性のため）。矢印や番号などの記号のみ可。

## 最小テンプレート

```svg
<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
  <path d="M100,400 L700,400" stroke="var(--fig-ink)" stroke-width="4" fill="none" />
</svg>
```
