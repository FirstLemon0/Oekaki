/**
 * 採点 B: Claude API で 1 回だけ画像批評を行う。
 * 1 日の上限判定は UI 側の責務（ここは純粋に 1 回の呼び出し）。
 *
 * 経路: output_config.format（JSON Schema 構造化出力）で受け、
 *       念のため JSON.parse → zod 検証も行う。effort は output_config.effort。
 *       thinking は指定しない（API 既定）。
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Base64ImageSource, Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { SYSTEM_PROMPT, buildUserText } from './prompt';
import { CRITIQUE_JSON_SCHEMA, CritiqueBodySchema, type CritiqueBody } from './schema';
import { CriticError, type CritiqueDeps, type CritiqueRequest, type CritiqueResult } from './types';

export const FALLBACK_MODEL = 'claude-opus-5';
export const MAX_TOKENS = 2048;

const IMAGE_TYPES: ReadonlyArray<Base64ImageSource['media_type']> = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

function toMediaType(type: string): Base64ImageSource['media_type'] {
  const t = type.toLowerCase().split(';')[0]?.trim() ?? '';
  const hit = IMAGE_TYPES.find((m) => m === t);
  if (!hit) throw new TypeError(`critique: 対応していない画像形式です（${type || '不明'}）。WebP/PNG を渡してください`);
  return hit;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function isModelUnavailable(e: unknown): boolean {
  return (
    e instanceof Anthropic.NotFoundError ||
    (e instanceof Anthropic.APIError && e.type === 'not_found_error')
  );
}

/** SDK の例外を CriticError に丸める（フォールバック判定の後に呼ぶ） */
function classify(e: unknown): CriticError {
  if (e instanceof CriticError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new CriticError('network', 'aborted', { cause: e });
  if (e instanceof Anthropic.APIConnectionError) return new CriticError('network', e.message, { cause: e });
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new CriticError('no_api_key', e.message, { cause: e });
  }
  if (e instanceof Anthropic.RateLimitError) return new CriticError('daily_limit', e.message, { cause: e });
  if (isModelUnavailable(e)) return new CriticError('model_unavailable', (e as Error).message, { cause: e });
  if (e instanceof Anthropic.APIError) {
    // 400/422 はこちらの送信内容の問題、それ以外（5xx/529 等）は再送で直る見込みの通信系として扱う
    if (e.status === 400 || e.status === 422) return new CriticError('bad_response', e.message, { cause: e });
    return new CriticError('network', e.message, { cause: e });
  }
  return new CriticError('network', e instanceof Error ? e.message : String(e), { cause: e });
}

function parseMessage(msg: Message): CritiqueBody {
  if (msg.stop_reason === 'refusal') throw new CriticError('refused', 'モデルが応答を控えました');
  if (msg.stop_reason === 'max_tokens') throw new CriticError('bad_response', '応答が途中で切れました（max_tokens）');
  const text = msg.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim();
  if (!text) throw new CriticError('bad_response', '応答にテキストがありません');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new CriticError('bad_response', '応答が JSON ではありません', { cause: e });
  }
  const parsed = CritiqueBodySchema.safeParse(json);
  if (!parsed.success) throw new CriticError('bad_response', '応答の形式が違います', { cause: parsed.error });
  return parsed.data;
}

export async function critique(req: CritiqueRequest, deps?: CritiqueDeps): Promise<CritiqueResult> {
  const { apiKey, model, effort } = req.settings;
  if (!apiKey.trim()) throw new CriticError('no_api_key', 'API キーが設定されていません');

  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    // 再送は UI の「再送」ボタンに任せる（待ち時間と費用を読みやすくするため）
    maxRetries: 0,
    ...(deps?.fetchImpl ? { fetch: deps.fetchImpl } : {}),
  });

  const data = await blobToBase64(req.image);
  const mediaType = toMediaType(req.image.type);

  const build = (m: string): MessageCreateParamsNonStreaming => ({
    model: m,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: buildUserText(req) },
        ],
      },
    ],
    output_config: {
      effort,
      format: { type: 'json_schema', schema: CRITIQUE_JSON_SCHEMA },
    },
  });

  const send = (m: string) =>
    client.messages.create(build(m), deps?.signal ? { signal: deps.signal } : undefined);

  let used = model;
  let msg: Message;
  try {
    msg = await send(model);
  } catch (e) {
    if (!isModelUnavailable(e) || model === FALLBACK_MODEL) throw classify(e);
    used = FALLBACK_MODEL;
    try {
      msg = await send(FALLBACK_MODEL);
    } catch (e2) {
      throw classify(e2);
    }
  }

  const body = parseMessage(msg);
  return {
    ...body,
    model: used,
    at: new Date().toISOString(),
    usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens },
  };
}
