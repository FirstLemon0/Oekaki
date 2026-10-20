// 配信の CSP（public/_headers、受け入れ ilust-csp）。Render の Headers に入れる値の正。meta の CSP（vite.config）と食い違わないこと。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HEADERS = fileURLToPath(new URL('../../public/_headers', import.meta.url));
const VITE_CONFIG = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));

/** _headers（Netlify / Cloudflare の書式）→ { path: { name: value } } */
export function parseHeaders(text) {
  const out = {};
  let path = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      path = raw.trim();
      out[path] = out[path] ?? {};
      continue;
    }
    const i = raw.indexOf(':');
    if (path && i > 0) out[path][raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
  }
  return out;
}

function directives(csp) {
  return Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...vals] = d.split(/\s+/);
        return [name, vals];
      }),
  );
}

describe('public/_headers の CSP', () => {
  const h = parseHeaders(readFileSync(HEADERS, 'utf8'));
  const csp = h['/*']?.['Content-Security-Policy'];

  it('全部のパスに CSP があり、script-src self・frame-ancestors self・object-src none・worker-src self blob:', () => {
    expect(csp).toBeTruthy();
    const d = directives(csp);
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['worker-src']).toEqual(["'self'", 'blob:']);
    // インラインのスクリプト・eval を許す値は入れない
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it('ビルドの index.html の meta の CSP（vite.config）と同じ指示（meta で効かない frame-ancestors を除く）', () => {
    const src = readFileSync(VITE_CONFIG, 'utf8');
    const m = src.match(/CONTENT_SECURITY_POLICY\s*=\s*"([^"]+)"/);
    expect(m).not.toBeNull();
    const meta = directives(m[1]);
    const header = directives(csp);
    for (const [name, vals] of Object.entries(meta)) expect(header[name], name).toEqual(vals);
    expect(meta['frame-ancestors']).toBeUndefined();
  });

  it('parseHeaders: 注釈と空行を飛ばし、パスごとに名前と値を読む', () => {
    expect(parseHeaders('# c\n/*\n  A: 1\n\n/x\n  B: two: three\n')).toEqual({ '/*': { A: '1' }, '/x': { B: 'two: three' } });
  });
});
