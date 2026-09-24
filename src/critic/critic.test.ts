import { describe, expect, it } from 'vitest';
import {
  CRITIQUE_JSON_SCHEMA,
  CriticError,
  FALLBACK_MODEL,
  MAX_TOKENS,
  SYSTEM_PROMPT,
  TEST_MAX_TOKENS,
  critique,
  estimateCostJpy,
  testConnection,
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
    expect(body.max_tokens).toBe(16000);
    expect(body.max_tokens).toBe(MAX_TOKENS);
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

  it('429 → rate_limited（アプリの daily_limit とは区別・再試行しない）', async () => {
    const { fetchImpl, calls } = mockFetch(() => apiError(429, 'rate_limit_error'));
    await expectKind(critique(makeReq(), { fetchImpl }), 'rate_limited');
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

  it("stop_reason === 'max_tokens' → truncated（bad_response とは区別）", async () => {
    const { fetchImpl } = mockFetch(() =>
      json(200, messageBody({ text: '{"good": ["線が', stop_reason: 'max_tokens' })),
    );
    await expectKind(critique(makeReq(), { fetchImpl }), 'truncated');
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

describe('critique: 指摘の位置 pos', () => {
  const base = { where: '左目', what: 'x', fix: 'y' };
  const run = async (issues: unknown[]) => {
    const { fetchImpl } = mockFetch(() => json(200, messageBody({ text: JSON.stringify({ ...GOOD_BODY, issues }) })));
    return (await critique(makeReq(), { fetchImpl })).issues;
  };

  it('pos があればそのまま受け取る', async () => {
    const issues = await run([{ ...base, pos: { x: 0.25, y: 0.75 } }]);
    expect(issues[0]!.pos).toEqual({ x: 0.25, y: 0.75 });
  });

  it('pos が無ければキーごと省略', async () => {
    const issues = await run([base]);
    expect(issues[0]).toEqual(base);
    expect(issues[0]).not.toHaveProperty('pos');
  });

  it('範囲外はクランプ、不正な値は省略（批評自体は失敗しない）', async () => {
    const issues = await run([
      { ...base, pos: { x: -0.5, y: 1.8 } },
      { ...base, pos: { x: 'left', y: 0.5 } },
      { ...base, pos: { x: 0.5 } },
      { ...base, pos: null },
    ]);
    expect(issues).toHaveLength(3);
    expect(issues[0]!.pos).toEqual({ x: 0, y: 1 });
    expect(issues[1]).not.toHaveProperty('pos');
    expect(issues[2]).not.toHaveProperty('pos');
  });

  it('JSON Schema とプロンプトに pos がある（任意項目）', () => {
    const item = (CRITIQUE_JSON_SCHEMA as { properties: { issues: { items: { properties: Record<string, unknown>; required: string[] } } } })
      .properties.issues.items;
    expect(Object.keys(item.properties)).toContain('pos');
    expect(item.required).not.toContain('pos');
    expect(SYSTEM_PROMPT).toContain('pos');
  });
});

describe('testConnection', () => {
  const settings = { apiKey: 'sk-test', model: 'claude-opus-5-5', effort: 'high' as const };

  it('成功なら ok と使ったモデル。最小呼び出し（max_tokens 8・画像なし）', async () => {
    const { fetchImpl, calls } = mockFetch(() => json(200, messageBody({ text: 'ok', stop_reason: 'max_tokens' })));
    const r = await testConnection(settings, { fetchImpl });
    expect(r).toEqual({ ok: true, model: 'claude-opus-5-5' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.max_tokens).toBe(TEST_MAX_TOKENS);
    expect(TEST_MAX_TOKENS).toBeLessThanOrEqual(16);
    expect(JSON.stringify(calls[0]!.body)).not.toContain('"image"');
  });

  it('404 なら claude-opus-5 にフォールバックして ok', async () => {
    const { fetchImpl, calls } = mockFetch(
      () => apiError(404, 'not_found_error'),
      () => json(200, messageBody({ text: 'ok', model: 'claude-opus-5' })),
    );
    const r = await testConnection(settings, { fetchImpl });
    expect(r).toEqual({ ok: true, model: FALLBACK_MODEL });
    expect(calls[1]!.body.model).toBe(FALLBACK_MODEL);
  });

  it('失敗は例外でなく kind 付きで返す', async () => {
    const r401 = await testConnection(settings, mockFetch(() => apiError(401, 'authentication_error')));
    expect(r401.ok).toBe(false);
    expect(r401.ok === false && r401.kind).toBe('no_api_key');

    const r404 = await testConnection(settings, mockFetch(() => apiError(404, 'not_found_error'), () => apiError(404, 'not_found_error')));
    expect(r404.ok === false && r404.kind).toBe('model_unavailable');

    const r429 = await testConnection(settings, mockFetch(() => apiError(429, 'rate_limit_error')));
    expect(r429.ok === false && r429.kind).toBe('rate_limited');

    const net = await testConnection(settings, {
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    });
    expect(net.ok === false && net.kind).toBe('network');
    expect(net.ok === false && typeof net.message).toBe('string');
  });

  it('キーが空なら呼ばずに no_api_key', async () => {
    const { fetchImpl, calls } = mockFetch();
    const r = await testConnection({ ...settings, apiKey: '' }, { fetchImpl });
    expect(r.ok === false && r.kind).toBe('no_api_key');
    expect(calls).toHaveLength(0);
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
