# src/critic — 採点 B（AI 画像批評）

ARCHITECTURE.md「契約 2: 批評」の実装です。Claude API を公式 TypeScript SDK（`@anthropic-ai/sdk` 0.128.0）のブラウザ直接モードで 1 回だけ呼びます。1 日の上限判定は UI 側で行います。このモジュールは判定しません。

## 使い方

```ts
import { critique, CriticError, estimateCostJpy } from '@/critic';

try {
  const r = await critique(
    { image: webpBlob, task, rubric, stageTitle, settings: { apiKey, model: 'claude-opus-5-5', effort: 'high' } },
    { signal: abortController.signal }, // 任意。待機画面のキャンセル用
  );
  // r.good / r.issues / r.next_one / r.encourage / r.model / r.at / r.usage
} catch (e) {
  if (e instanceof CriticError) {
    // e.kind: no_api_key | daily_limit | network | model_unavailable | refused | bad_response
  }
}
```

- `image` は長辺 1024px 以下に縮小した WebP または PNG の Blob です。`Blob.type` を media_type に使います。jpeg と gif も通りますが、それ以外の形式は `TypeError` になります。
- 送るものは、ユーザー自身の絵 1 枚、課題文、ステージ名、ルーブリック（`title` / `points` / `focus`）だけです。お手本は送りません。
- `deps.fetchImpl` を指定すると、SDK の `fetch` オプションに渡します（テスト用）。

## 採った経路

| 項目 | 実装 |
|---|---|
| 構造化出力 | **あり**。SDK 0.128.0 の型に `output_config.format`（`{ type: 'json_schema', schema }`）があるので、それを使います。受け取った本文には、念のため `JSON.parse` と zod 検証（`CritiqueBodySchema`）もかけます。 |
| effort | **`output_config.effort`** に `settings.effort` をそのまま渡します（型定義で確認済み）。`extra_body` などの抜け道は使っていません。 |
| thinking | 指定しません（API の既定に任せます）。応答に thinking ブロックが混じっても、text ブロックだけを読みます。 |
| max_tokens | 2048 |
| 再試行 | SDK の `maxRetries: 0`。再送は UI の「再送」ボタンで行います。 |
| フォールバック | 1 回目が `NotFoundError`（404）または `error.type === 'not_found_error'` のときだけ、`claude-opus-5` で 1 回再送します。結果の `model` には実際に使ったモデルが入ります。指定モデルがもともと `claude-opus-5` のときや、再送も 404 だったときは `model_unavailable` になります。 |

### エラーの分類

| 状況 | kind |
|---|---|
| キーが空（API は呼ばない）、401 `AuthenticationError`、403 `PermissionDeniedError` | `no_api_key` |
| 429 `RateLimitError`（API 側のレート制限もここに含める） | `daily_limit` |
| `APIConnectionError`（タイムアウトを含む）、5xx や 529 などのその他の API エラー | `network` |
| `APIUserAbortError`（signal による中断） | `network`（message は `'aborted'`） |
| 404 でフォールバックもできなかった | `model_unavailable` |
| `stop_reason === 'refusal'` | `refused` |
| JSON として壊れている、スキーマに合わない、テキストが空、`max_tokens` で途中終了、400 や 422 | `bad_response` |

### 応答スキーマ（数値スコアなし）

`good[]`、`issues[{where, what, fix}]`、`next_one`、`encourage` の 4 項目だけです。JSON Schema に `score` はなく、`additionalProperties: false` です。万一 `score` などの余計なキーが返ってきても、zod が捨てます。構造化出力は `minItems` と `maxItems` の対応が限られるので、件数は次のように扱います。

- `good` は 1 件以上を必須とし、4 件以上なら先頭 3 件だけ残します。
- `issues` は 4 件以上なら先頭 3 件だけ残します。

## 費用の前提（`estimateCostJpy`）

1 回あたりの目安です。画像 1 枚（長辺 1024px）と日本語の出力を想定し、¥150/$ で換算しています。

| モデル | 目安 |
|---|---|
| claude-opus-5-5 | 約 ¥5 |
| claude-opus-5 | 約 ¥7 |
| claude-sonnet-5 | 約 ¥3 |
| 表にないモデル | ¥7（高い方で見積もる） |

表示用の概算です。実費は `usage`（input/output トークン）で確認してください。

## テスト

```
npx vitest run src/critic
```

本物の API は呼びません。`fetchImpl` に差し替えたモックが Messages API 形式の JSON やエラーを返し、次の点を確認します。

- 正常応答の変換
- ペイロードの中身（画像の base64、課題文、観点、構造化出力、effort、thinking を指定していないこと）
- 404 からのフォールバック
- 401 と 403、キー空、429、通信断、refusal、壊れた JSON、スキーマ不正、score キーの除去、件数の切り詰め、費用表
