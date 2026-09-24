/**
 * スタブ: src/critic（ARCHITECTURE.md 契約 2）がまだ無いあいだの最小代替。
 *
 * 統合時は UI 側の import を `@/critic` に差し替え、このファイルを消す。
 * 「接続テスト」は契約に無いため、統合時に critic 側へ小さな疎通関数を足すか、
 * 1x1 画像で critique() を呼ぶかを統括が決める。
 */

/** 本物の critic が入ったら true になる（スタブでは常に false）。 */
export const criticAvailable = false;

/** 表示用の 1 回あたり費用の目安（円）。 */
export function estimateCostJpy(model: string): number {
  if (model.includes('sonnet')) return 2;
  if (model.includes('haiku')) return 1;
  return 5;
}

export type ConnectionTestResult = { ok: true; model: string } | { ok: false; reason: 'unavailable' | 'no_api_key' };

/** 接続テスト。スタブでは常に「未接続」を返す。 */
export async function testConnection(apiKey: string | null, _model: string): Promise<ConnectionTestResult> {
  if (!apiKey) return { ok: false, reason: 'no_api_key' };
  return { ok: false, reason: 'unavailable' };
}
