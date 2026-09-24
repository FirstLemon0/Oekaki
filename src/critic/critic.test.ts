import { describe, expect, it } from 'vitest';
import {
  CRITIQUE_JSON_SCHEMA,
  CriticError,
  FALLBACK_MODEL,
  SYSTEM_PROMPT,
  critique,
  estimateCostJpy,
  type CritiqueRequest,
} from './index';

/* ------------------------------------------------------------------ */
/* ヘルパー                                                             */
/* ------------------------------------------------------------------ */

const IMAGE_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 250, 251, 252]);
const IMAGE_B64 = 'UklGRgECAwQF+vv8'; // 上のバイト列の base64（別経路で計算した固定値）

function makeReq(over: Partial<CritiqueRequest['settings']> = {}): CritiqueRequest {
  return {
    image: new Blob([IMAGE_BYTES], { type: 'image/webp' }),
    task: '正面顔を 1 枚、十字線から描いてください',
    stageTitle: 'ステージ1.5 顔の基本',
    rubric: {
      id: 's1_5-graduation',
      stage: 's1_5',
      title: '正面顔の卒業課題',
      points: ['十字線の対称性', '目の位置', 'パーツのバランス'],
      focus: '目の高さを最優先',
    },
    settings: { apiKey: 'sk-test', model: 'claude-opus-5-5', effort: 'high', ...over },
  };
}

const GOOD_BODY = {
  good: ['十字線がまっすぐ引けています', '輪郭の線が一度で引けています'],
  issues: [{ where: '左目', what: '右目より少し高い位置にあります', fix: '十字線の横線に定規を当てて両目の下端をそろえる' }],
  next_one: '横線に両目の下端をそろえて、もう 1 枚描く',
  encourage: '線に迷いが少なくなってきました。',
};

function messageBody(opts: { text?: string; stop_reason?: string; model?: string } = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-opus-5-5',
    content: [{ type: 'text', text: opts.text ?? JSON.stringify(GOOD_BODY) }],
    stop_reason: opts.stop_reason ?? 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1234, output_tokens: 321 },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
  });
}

function apiError(status: number, type: string, message = type): Response {
  return json(status, { type: 'error', error: { type, message } });
}

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

/** 順番に応答を返す fetch モック。呼び出し内容を記録する */
function mockFetch(...responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    const r = responses[i++];
    if (!r) throw new Error('予期しない追加の呼び出し');
    return r();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function expectKind(p: Promise<unknown>, kind: CriticError['kind']) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(CriticError);
  expect((e as CriticError).kind).toBe(kind);
}

/* ------------------------------------------------------------------ */
/* テスト                                                               */
/* ------------------------------------------------------------------ */

describe('critique', () => {
  it('正常応答を CritiqueResult に変換する', async () => {
    const { fetchImpl, calls } = mockFetch(() => json(200, messageBody()));
    const r = await critique(makeReq(), { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(r.good).toEqual(GOOD_BODY.good);
    expect(r.issues).toEqual(GOOD_BODY.issues);
    expect(r.next_one).toBe(GOOD_BODY.next_one);
    expect(r.encourage).toBe(GOOD_BODY.encourage);
    expect(r.model).toBe('claude-opus-5-5');
    expect(r.usage).toEqual({ input: 1234, output: 321 });
    expect(Number.isNaN(Date.parse(r.at))).toBe(false);
  });

  it('送信ペイロードに画像 base64・課題文・観点・構造化出力・effort が含まれる', async () => {
    const { fetchImpl, calls } = mockFetch(() => json(200, messageBody()));
    await critique(makeReq({ effort: 'medium' }), { fetchImpl });
    const call = calls[0]!;
    expect(call.url).toMatch(/\/v1\/messages$/);
    expect(call.headers.get('x-api-key')).toBe('sk-test');
    const body = call.body as {
      model: string;
      max_tokens: number;
      system: string;
      thinking?: unknown;
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
      output_config: { effort: string; format: { type: string; schema: unknown } };
    };
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(2048);
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.thinking).toBeUndefined();
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format).toEqual({ type: 'json_schema', schema: CRITIQUE_JSON_SCHEMA });

    expect(body.messages).toHaveLength(1);
    const content = body.messages[0]!.content;
    const images = content.filter((c) => c.type === 'image');
    expect(images).toHaveLength(1); // 自分の絵 1 枚だけ（お手本は送らない）
    expect(images[0]!.source).toEqual({ type: 'base64', media_type: 'image/webp', data: IMAGE_B64 });
    const text = content.find((c) => c.type === 'text')!.text as string;
    expect(text).toContain('正面顔を 1 枚、十字線から描いてください');
    expect(text).toContain('ステージ1.5 顔の基本');
    expect(text).toContain('十字線の対称性');
    expect(text).toContain('目の高さを最優先');
  });

  it('モデル未提供（404）なら claude-opus-5 に 1 回だけフォールバックする', async () => {
    const { fetchImpl, calls } = mockFetch(
      () => apiError(404, 'not_found_error', 'model: claude-opus-5-5'),
      () => json(200, messageBody({ model: 'claude-opus-5' })),
    );
    const r = await critique(makeReq(), { fetchImpl });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.model).toBe('claude-opus-5-5');
    expect(calls[1]!.body.model).toBe(FALLBACK_MODEL);
    expect(r.model).toBe('claude-opus-5');
  });

  it('フォールバック先も 404 なら model_unavailable（2 回で止まる）', async () => {
    const { fetchImpl, calls } = mockFetch(
      () => apiError(404, 'not_found_error'),
      () => apiError(404, 'not_found_error'),
    );
    await expectKind(critique(makeReq(), { fetchImpl }), 'model_unavailable');
    expect(calls).toHaveLength(2);
  });

  it('401 → no_api_key、403 → no_api_key', async () => {
    await expectKind(
      critique(makeReq(), mockFetch(() => apiError(401, 'authentication_error'))),
      'no_api_key',
    );
    await expectKind(
      critique(makeReq(), mockFetch(() => apiError(403, 'permission_error'))),
      'no_api_key',
    );
  });

  it('キーが空なら API を呼ばずに no_api_key', async () => {
    const { fetchImpl, calls } = mockFetch();
    await expectKind(critique(makeReq({ apiKey: '  ' }), { fetchImpl }), 'no_api_key');
    expect(calls).toHaveLength(0);
  });

  it('429 → daily_limit（再試行しない）', async () => {
    const { fetchImpl, calls } = mockFetch(() => apiError(429, 'rate_limit_error'));
    await expectKind(critique(makeReq(), { fetchImpl }), 'daily_limit');
    expect(calls).toHaveLength(1);
  });

  it('通信失敗 → network', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expectKind(critique(makeReq(), { fetchImpl }), 'network');
  });

  it("stop_reason === 'refusal' → refused", async () => {
    const { fetchImpl } = mockFetch(() => json(200, messageBody({ text: '', stop_reason: 'refusal' })));
    await expectKind(critique(makeReq(), { fetchImpl }), 'refused');
  });

  it('壊れた JSON → bad_response', async () => {
    const { fetchImpl } = mockFetch(() => json(200, messageBody({ text: '{"good": ["線が' })));
    await expectKind(critique(makeReq(), { fetchImpl }), 'bad_response');
  });

  it('スキーマ不正（必須欠落）→ bad_response', async () => {
    const { fetchImpl } = mockFetch(() =>
      json(200, messageBody({ text: JSON.stringify({ good: [], issues: [], next_one: 'x' }) })),
    );
    await expectKind(critique(makeReq(), { fetchImpl }), 'bad_response');
  });

  it('数値スコアを含む応答でも score はフィールドとして受け取らない', async () => {
    const withScore = { ...GOOD_BODY, score: 82, issues: GOOD_BODY.issues.map((i) => ({ ...i, score: 3 })) };
    const { fetchImpl } = mockFetch(() => json(200, messageBody({ text: JSON.stringify(withScore) })));
    const r = await critique(makeReq(), { fetchImpl });
    expect(r).not.toHaveProperty('score');
    expect(r.issues[0]).not.toHaveProperty('score');
    const props = (CRITIQUE_JSON_SCHEMA as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props).sort()).toEqual(['encourage', 'good', 'issues', 'next_one']);
    expect(JSON.stringify(CRITIQUE_JSON_SCHEMA)).not.toMatch(/score/i);
  });

  it('件数が多すぎる応答は先頭 3 件に切り詰める', async () => {
    const many = {
      ...GOOD_BODY,
      good: ['a', 'b', 'c', 'd'],
      issues: [1, 2, 3, 4].map((n) => ({ where: `w${n}`, what: 'x', fix: 'y' })),
    };
    const { fetchImpl } = mockFetch(() => json(200, messageBody({ text: JSON.stringify(many) })));
    const r = await critique(makeReq(), { fetchImpl });
    expect(r.good).toHaveLength(3);
    expect(r.issues).toHaveLength(3);
  });
});

describe('prompt', () => {
  it('数値スコアを禁じ、評価語を避けるよう指示している', () => {
    expect(SYSTEM_PROMPT).toContain('スコアは一切出さない');
    expect(SYSTEM_PROMPT).toContain('「うまい」「へた」');
  });
});

describe('estimateCostJpy', () => {
  it('モデルごとの目安', () => {
    expect(estimateCostJpy('claude-opus-5-5')).toBe(5);
    expect(estimateCostJpy('claude-opus-5')).toBe(7);
    expect(estimateCostJpy('claude-sonnet-5')).toBe(3);
    expect(estimateCostJpy('unknown-model')).toBe(7);
  });
});
