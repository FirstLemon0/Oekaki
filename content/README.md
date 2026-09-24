# 教材データの書き方

正典は `DESIGN.md` の §4（カリキュラム）と §4.2（レッスン型）。ここでは
`src/content/schema.ts` のスキーマに沿って、実際に JSON をどう書くかをまとめる。

## 階層

```
Curriculum
├─ stages: Stage[]
│   └─ units: Unit[]
│       └─ lessons: Lesson[]
│           └─ steps: Step[]
└─ rubrics: Rubric[]
```

- 1ファイル = 1 Stage。`content/stages/<stageId>.json` に置く。
- ルーブリックは `content/rubrics/<何か>.json` に置く（ファイル名は自由。中身の
  `id`/`stage` で紐付ける）。
- なぞりのお手本は `content/templates/<id>.json`（ファイル名 = `trace.template` の id）。
- 図解は `content/figures/<id>.svg`（書き方は `content/figures/README.md`）。
- **登録作業は不要**。`src/content/index.ts` が `import.meta.glob` で
  `content/stages/*.json`・`content/rubrics/*.json`・`content/templates/*.json` を
  自動で読み込む。ファイルを置くだけでよい（並びはファイル名順。パス上の順番は
  `stage.order` で決まる）。
- 整形は 2 スペースインデント・末尾改行。選択肢や手順のような小さなオブジェクトは
  `{ "text": "…" }` のように 1 行で書いてよい。
- 既存の教材を機械的に直すときは `tools/patch-content.mjs` に手順を足して実行する
  （`node tools/patch-content.mjs`。`--check` で書き込まずに確認）。1 行オブジェクトの
  書き方は保たれる。

## ID の規約

| 種類 | 形式 | 例 |
|---|---|---|
| stage | `s<番号>` または `s<番号>_5` | `s0`, `s1`, `s1_5`, `s2` |
| unit | `<stageId>-u<番号>` | `s1-u3` |
| lesson | `<unitId>-l<番号>` | `s1-u3-l5` |

形式・一意性・親子の対応関係は zod の `refine`/`superRefine` で検証される
（`loadCurriculum()` 実行時、または `npx vitest run` で失敗すればすぐ分かる）。

## Stage / Unit / Lesson

```json
{
  "id": "s1",
  "order": 1,
  "title": "線と手のコントロール",
  "subtitle": "5週間・25レッスン",
  "weeks": 5,
  "units": [
    {
      "id": "s1-u1",
      "title": "直線",
      "lessons": [
        {
          "id": "s1-u1-l1",
          "title": "短い水平線",
          "minutes": 15,
          "kind": "lesson",
          "summary": "短い水平線を繰り返し引いて、狙った位置に線を止める感覚をつかみます。",
          "steps": [ /* Step[]（下記参照） */ ]
        }
      ]
    }
  ]
}
```

- `order` はステージの並び順（0, 1, 1.5, 2, …）。ソートに使うので他ステージと
  重複させない。
- `kind` は `lesson` / `checkpoint`（模写チェックポイント）/ `graduation`
  （卒業課題）のいずれか。
- `summary` はホーム画面の「今日のカード」に出す1〜2文。
- `optional: true` は **選択式のレッスン**（例: U10-2 の塗り技法。3つの技法から1つ以上）。
  レッスンのヘッダに「この技法は飛ばす」が出て、押すと完了扱い（`skipped`）で次へ進む。
  あとから開き直して取り組める。省略時は必修。選ばなくてよいことは、最初の `read` の
  本文でも一言伝える。

### 途中再開

レッスンはステップを進めるたびに「次に開くステップ番号」を保存する。途中で閉じても、
次に開いたとき「続きから／最初から」を選べる（複数日にまたがる最終課題もこれで続けられる）。
教材側で特別な書き方は要らないが、長い課題は `read`／`submit` などのステップに分けておくと、
区切りのよいところから再開できる。

## Step 型（11種）とサンプル

### read（説明）

```json
{
  "type": "read",
  "title": "ゴースティング法とは",
  "body": "1段落目。\n\n2段落目（空行区切り）。",
  "figure": "ghosting-diagram"
}
```

### drill（反復ドリル）

```json
{
  "type": "drill",
  "drill": "ellipse",
  "count": 10,
  "instruction": "指定された度合いの楕円を10個描きましょう。",
  "params": { "degree": 30, "axisAngleDeg": 15 },
  "counter": "ellipses"
}
```

- `counter`（任意）: 累計カウンターの種別。`lines`（直線）/ `ellipses`（楕円）/
  `circles`（円）/ `boxes`（箱。250箱チャレンジ）。1本（1個）描くごとに加算される。
- 筆圧ドリル（`"drill": "pressure"`）の `params.profile` は `ramp-up`（弱→強）/
  `ramp-down`（強→弱）/ `flat`（一定）。別名 `increasing` / `decreasing` / `constant` も
  読み込み時に正式な値へそろえるが、新しく書くときは正式な値を使う。それ以外の値は検証エラー。

### trace（なぞり）

```json
{
  "type": "trace",
  "template": "leaf-silhouette",
  "instruction": "お手本の輪郭の上を、ゆっくりなぞってみましょう。",
  "count": 5
}
```

- `count`（任意・既定 1）: なぞる回数。
- `counter`（任意）: 累計カウンターの種別（drill と同じ 4 種）。1回なぞるごとに 1 加算。
  円・楕円・直線・箱そのものをなぞるときだけ付ける（例: 立方体のお手本 → `"boxes"`）。

### copy（模写・横に見て描く）

```json
{
  "type": "copy",
  "reference": "builtin",
  "refId": "cup-lineart",
  "instruction": "お手本を横に見ながら、同じ大きさで描いてみましょう。"
}
```

### construct（構築手順）

```json
{
  "type": "construct",
  "instruction": "アタリ→形→細部の順で、頭部を描いてみましょう。",
  "stages": [
    { "title": "球を描く", "figure": "loomis-step1", "instruction": "円を1つ描きます。" },
    { "title": "切り落とし線を引く", "figure": "loomis-step2", "instruction": "球に十字線を入れます。" }
  ]
}
```

箱を描く構築手順なら、累計に加算できる:

```json
{
  "type": "construct",
  "instruction": "同じ箱を少しずつ回しながら、5個描きましょう。描き終えると、箱カウンターに5個加わります（250箱チャレンジ）。",
  "stages": [ /* … */ ],
  "counter": "boxes",
  "count": 5
}
```

- `counter`（任意）: 累計カウンターの種別（drill と同じ 4 種）。
- `count`（任意・既定 1）: このステップで描く個数。描き終えたとき（何か描いてあれば）に
  `counter` へこの数だけ加算する。instruction の「◯個加わります」と数をそろえる。

### gesture（時間制限ポーズ）

```json
{
  "type": "gesture",
  "seconds": 30,
  "count": 5,
  "source": "mannequin",
  "instruction": "30秒でポーズ全体のシルエットを捉えましょう。"
}
```

### quiz（選択式クイズ）

```json
{
  "type": "quiz",
  "question": "光源が左上にあるとき、影が濃くなるのはどちら側？",
  "options": [
    { "text": "右下側", "figure": "sphere-shadow-a" },
    { "text": "左上側", "figure": "sphere-shadow-b" }
  ],
  "answer": 0,
  "explain": "光源と反対側が陰になります。"
}
```

`answer` は `options` の添字（0始まり）。範囲外は検証エラーになる。

### mosha（模写チェックポイント）

```json
{
  "type": "mosha",
  "instruction": "お手本を模写し、違うところに自分でタップして印をつけたあと、1か所だけ自由に改変してみましょう。"
}
```

### critique（卒業課題の B 提出）

```json
{
  "type": "critique",
  "rubric": "s1-graduation",
  "mode": "canvas",
  "instruction": "簡単な小物を1つ選び、横に見ながら線画で描いてみましょう。描き終えたら提出します。"
}
```

### submit（外部アプリで描いた絵の提出）

```json
{
  "type": "submit",
  "rubric": "s7-graduation",
  "instruction": "外部アプリで描いたバストアップの線画を1枚、取り込んで提出しましょう。"
}
```

### free（自由お絵描き）

```json
{
  "type": "free",
  "instruction": "5分以上、好きなものを自由に描いてみましょう。"
}
```

## Rubric

```json
{
  "id": "s1-graduation",
  "stage": "s1",
  "title": "ステージ1 卒業課題のルーブリック",
  "points": [
    "狙った位置に線を引けているか",
    "全体の形やバランスを捉えられているか",
    "最後まで描き切れているか"
  ],
  "focus": "形の把握を優先し、完了したこと自体を必ず肯定する。"
}
```

`stage` は `stage.id` と同じ形式（`s0`, `s1`, `s1_5`, `s2` …）である必要がある。
ただし、そのステージ本体（Stage JSON）がまだ無くてもエラーにはならない
（卒業課題のルーブリックを、ステージ本体より先に用意できるようにするため）。

## 図解（figures）

`read.figure`・`quiz` の選択肢の `figure`・`construct` の各段階の `figure`・
`copy`（`reference: "builtin"`）の `refId` は `content/figures/<id>.svg` の id。
要点だけ（詳しくは `content/figures/README.md`）:

- `viewBox="0 0 800 500"`。線は `currentColor`（ダークモードでも読める）。
- 強調は `#7BB661`（アクセントの緑）を少なめに。
- 日本語ラベルを入れてよい（`<text fill="currentColor" stroke="none">`）。ただしお手本の
  線画（`*-lineart`）とクイズの選択肢の図（`quiz-*`）には、ラベルや答えの手がかりを入れない。

## 本文のトーン

`read.body` や各 `instruction` は、丁寧だが短い口調で書く。「〜しましょう」
「〜でOK」を使い、命令形（「〜せよ」）や「うまい／へた」といった評価語は使わない
（DESIGN.md §3 の設計原則2「進級は完了ベース」に対応）。
