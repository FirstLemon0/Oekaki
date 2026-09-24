/**
 * 設定画面の「接続テスト」。messages.create を 1 トークンだけ呼ぶ最小の疎通確認。
 * 戻り値の形は旧スタブ（src/ui/stubs/critic.ts）と同じ。
 */
import Anthropic from '@anthropic-ai/sdk';
import { FALLBACK_MODEL } from '@/critic';

export type ConnectionTestResult = { ok: true; model: string } | { ok: false; reason: 'unavailable' | 'no_api_key' };

async function ping(client: Anthropic, model: string): Promise<void> {
  await client.messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
}

export async function testConnection(apiKey: string | null, model: string): Promise<ConnectionTestResult> {
  if (!apiKey || apiKey.trim() === '') return { ok: false, reason: 'no_api_key' };
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 20_000 });
  try {
    await ping(client, model);
    return { ok: true, model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, reason: 'no_api_key' };
    }
    if (e instanceof Anthropic.NotFoundError && model !== FALLBACK_MODEL) {
      try {
        await ping(client, FALLBACK_MODEL);
        return { ok: true, model: FALLBACK_MODEL };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    }
    return { ok: false, reason: 'unavailable' };
  }
}
