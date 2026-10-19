# src/data の f4f1ed2 の写し（試験専用）

- 中身は `git show f4f1ed2:src/data/<名前>.ts` をそのまま写したもの（`tools/snapshot-legacy-data.sh f4f1ed2`）。編集しない。
- 使うのは互換の試験だけ（`src/data/legacyCompat.test.ts`）: DB v1 のアプリが書いたデータを新しい版で開く、
  v1 のアプリのバックアップを新しい版で取り込む、新しい版のバックアップを v1 のアプリで取り込む（ADR-0007 D6 の (a)(b)）。
- アプリのコードからは import しない（初期 JS に入らない。`scripts/check-bundle.mjs` が確かめる）。
