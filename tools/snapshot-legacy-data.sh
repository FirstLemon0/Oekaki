#!/usr/bin/env bash
# 互換の試験用に、指定したコミットの src/data のモジュールを src/data/__legacy__/<コミット>/ へ「そのまま」写す。
# 使い方: tools/snapshot-legacy-data.sh f4f1ed2
# 写したファイルは編集しない（src/data/legacyCompat.test.ts が git の中身と一致することを確かめる）。
# アプリからは import しない（試験だけが使う）。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
commit="${1:?コミットを指定してください（例: f4f1ed2）}"
dest="src/data/__legacy__/${commit}"
mkdir -p "$dest"
for f in backup db repo images date id streak types; do
  git show "${commit}:src/data/${f}.ts" > "${dest}/${f}.ts"
done
echo "写しました: ${dest}"
