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
- 新しいファイルを追加したら `src/content/index.ts` の `RAW_STAGES` /
  `RAW_RUBRICS` に import を追記する（`import.meta.glob` は使わない方針）。

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

### trace（なぞり）

```json
{
  "type": "trace",
  "template": "leaf-silhouette",
  "instruction": "お手本の輪郭の上を、ゆっくりなぞってみましょう。",
  "count": 5
}
```

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

## 本文のトーン

`read.body` や各 `instruction` は、丁寧だが短い口調で書く。「〜しましょう」
「〜でOK」を使い、命令形（「〜せよ」）や「うまい／へた」といった評価語は使わない
（DESIGN.md §3 の設計原則2「進級は完了ベース」に対応）。
