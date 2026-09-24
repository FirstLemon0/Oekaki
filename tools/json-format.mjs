/**
 * 教材 JSON の整形（既存ファイルの書き方に合わせる）。
 *
 * - 基本は 2 スペースインデント・末尾改行（JSON.stringify(v, null, 2) と同じ）
 * - 値がすべてプリミティブの「小さなオブジェクト」は 1 行で書く
 *   例: { "text": "右下側", "figure": "quiz-sphere-a" }、"params": { "degree": 30, "axisAngleDeg": 15 }
 *   （手で書かれた教材がこの形なので、機械修正で差分が膨らまないようにする）
 *
 * inlineIn: 'array' … 配列の要素だけ 1 行にする / 'any' … プロパティ値も 1 行にする
 */

function isPrimitive(v) {
  return v === null || typeof v !== 'object';
}

function isFlatObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.values(v).every(isPrimitive);
}

function inlineObject(v) {
  return `{ ${Object.entries(v)
    .map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`)
    .join(', ')} }`;
}

export function formatJson(value, { inlineIn = 'array' } = {}) {
  const walk = (v, indent, where) => {
    if (isPrimitive(v)) return JSON.stringify(v);
    if (isFlatObject(v) && !('type' in v) && (inlineIn === 'any' || where === 'array')) return inlineObject(v);
    const pad = '  '.repeat(indent + 1);
    const end = '  '.repeat(indent);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      return `[\n${v.map((x) => pad + walk(x, indent + 1, 'array')).join(',\n')}\n${end}]`;
    }
    const entries = Object.entries(v);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${walk(x, indent + 1, 'prop')}`).join(',\n')}\n${end}}`;
  };
  return `${walk(value, 0, 'root')}\n`;
}

/** ファイルの書き方に一致する整形を探す（どれにも一致しなければ null） */
export function detectFormat(text) {
  const data = JSON.parse(text);
  if (`${JSON.stringify(data, null, 2)}\n` === text) return { kind: 'plain' };
  for (const inlineIn of ['array', 'any']) {
    if (formatJson(data, { inlineIn }) === text) return { kind: 'inline', inlineIn };
  }
  return null;
}

export function formatAs(fmt, data) {
  if (!fmt || fmt.kind === 'plain') return `${JSON.stringify(data, null, 2)}\n`;
  return formatJson(data, { inlineIn: fmt.inlineIn });
}
