/** ID 生成ユーティリティ。ブラウザ・Node どちらでも動くようフォールバックを持つ。 */
export function genId(prefix = 'id'): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}-${cryptoObj.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${random}`;
}
