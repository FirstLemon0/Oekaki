// src/data/__legacy__/f4f1ed2/ の写しが git の f4f1ed2 と一字一句同じか（互換の試験の前提。写しを手で直していない）。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const COMMIT = 'f4f1ed2';
const FILES = ['backup', 'db', 'repo', 'images', 'date', 'id', 'streak', 'types'];

function hasCommit() {
  try {
    execFileSync('git', ['cat-file', '-e', `${COMMIT}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe(`src/data/__legacy__/${COMMIT}`, () => {
  it.skipIf(!hasCommit())('8 ファイルとも git の中身と一致する', () => {
    for (const f of FILES) {
      const original = execFileSync('git', ['show', `${COMMIT}:src/data/${f}.ts`], { cwd: ROOT, encoding: 'utf8' });
      const copy = readFileSync(`${ROOT}src/data/__legacy__/${COMMIT}/${f}.ts`, 'utf8');
      expect(copy, f).toBe(original);
    }
  });
});
