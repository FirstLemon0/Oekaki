/**
 * 1 回あたりの費用目安（円）。表示用。
 * 前提: 画像 1 枚（長辺 1024px）＋日本語出力、¥150/$ 換算。
 */
const TABLE: ReadonlyArray<readonly [string, number]> = [
  // 長い id を先に照合する（'opus-5-5' は 'opus-5' を含むため）
  ['opus-5-5', 5],
  ['opus-5', 7],
  ['sonnet-5', 3],
];

/** 表に無いモデルは高い方（opus-5 相当）で見積もる */
const UNKNOWN_JPY = 7;

export function estimateCostJpy(model: string): number {
  const m = model.toLowerCase();
  for (const [key, jpy] of TABLE) {
    if (m.includes(key)) return jpy;
  }
  return UNKNOWN_JPY;
}
