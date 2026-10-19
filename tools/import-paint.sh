#!/usr/bin/env bash
# 埋め込みのペイント（OG-nanika の成果物）を public/paint/ に取り込む（UR-002 / ADR-0007 D4-2）。
#
#   tools/import-paint.sh <OG のコミット>
#
# 守ること:
# - OG の作業木がそのコミットに一致し clean で、OG の `npm run ci`・`npm run build:embed`・`npm run check:embed` が緑のときだけ置き換える
# - 取り込むのは OG の dist-embed/ の成果物だけ（OG のソース・.map・sw.js・manifest・sandbox・bench は入れない）
# - public/paint/BUILD.json に OG のコミット・契約の版・API の版・ファイルごとの sha256・合計・初期 JS の gz を書き、
#   scripts/check-paint-artifact.mjs で照合する（手で直した成果物は落ちる）
# - このスクリプトはコミットも push もしない（差分の大きさを出すだけ。コミットはパスを名指しした git add で）
#
# 環境変数: OG_DIR（既定 ../OG-nanika）、IMPORT_PAINT_SKIP_OG_CI=1 で OG の `npm run ci` を省く（試験用。push の前の取り込みでは使わない）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ILUST_ROOT="$(pwd)"
commit_arg="${1:?OG のコミットを指定してください（例: tools/import-paint.sh 1a2b3c4）}"
OG_DIR="${OG_DIR:-$(cd "${ILUST_ROOT}/.." && pwd)/OG-nanika}"

die() { echo "import-paint: $*" >&2; exit 1; }

[ -d "${OG_DIR}/.git" ] || die "OG のリポジトリがありません: ${OG_DIR}"
og_commit="$(git -C "${OG_DIR}" rev-parse --verify "${commit_arg}^{commit}" 2>/dev/null)" || die "OG にコミット ${commit_arg} がありません"
og_head="$(git -C "${OG_DIR}" rev-parse HEAD)"
[ "${og_head}" = "${og_commit}" ] || die "OG の作業木が ${commit_arg} ではありません（HEAD = ${og_head}）。OG 側で checkout してからやり直してください"
[ -z "$(git -C "${OG_DIR}" status --porcelain --untracked-files=no)" ] || die "OG の作業木に未コミットの変更があります（clean にしてから）"
grep -q '"build:embed"' "${OG_DIR}/package.json" || die "OG に npm run build:embed がありません"
grep -q '"check:embed"' "${OG_DIR}/package.json" || die "OG に npm run check:embed がありません"

if [ "${IMPORT_PAINT_SKIP_OG_CI:-0}" != "1" ]; then
  echo "== OG: npm run ci"
  (cd "${OG_DIR}" && npm run ci)
fi
echo "== OG: npm run build:embed"
(cd "${OG_DIR}" && npm run build:embed)
echo "== OG: npm run check:embed"
(cd "${OG_DIR}" && npm run check:embed)

src="${OG_DIR}/dist-embed"
[ -f "${src}/embed.html" ] || die "OG の dist-embed/embed.html がありません"

og_contract="$(tr -d ' \n\r' < "${OG_DIR}/src/core/VERSION")"
embed_api="$(grep -rhoE 'EMBED_API_VERSION[^=]*=[[:space:]]*[0-9]+' "${OG_DIR}/src/embed" 2>/dev/null | head -1 | grep -oE '[0-9]+$' || true)"
[ -n "${embed_api}" ] || die "OG の src/embed に EMBED_API_VERSION が見つかりません"
og_vite="$(node -p "require('${OG_DIR}/node_modules/vite/package.json').version" 2>/dev/null || echo unknown)"

# 一時ディレクトリに写して照合してから入れ替える（途中で失敗しても public/paint/ を壊さない）
stage="$(mktemp -d "${TMPDIR:-/tmp}/ilust-paint.XXXXXX")"
trap 'rm -rf "${stage}"' EXIT
cp -R "${src}/." "${stage}/"
rm -rf "${stage}/.vite"
node scripts/paint-artifact.mjs write "${stage}" --og-commit="${og_commit}" --og-contract="${og_contract}" --embed-api="${embed_api}" --vite="${og_vite}"
node scripts/paint-artifact.mjs verify "${stage}"

before_files=0; before_bytes=0
if [ -d public/paint ]; then
  before_files="$(find public/paint -type f | wc -l | tr -d ' ')"
  before_bytes="$(du -sb public/paint | cut -f1)"
fi
rm -rf public/paint
mkdir -p public
cp -R "${stage}" public/paint
node scripts/check-paint-artifact.mjs --dir=public/paint

after_files="$(find public/paint -type f | wc -l | tr -d ' ')"
after_bytes="$(du -sb public/paint | cut -f1)"
echo "import-paint: OG ${og_commit}（契約 ${og_contract}、API v${embed_api}、vite ${og_vite}）"
echo "import-paint: public/paint/ ${before_files} ファイル ${before_bytes} B → ${after_files} ファイル ${after_bytes} B"
echo "import-paint: コミットするときは: git add public/paint （パスを名指し。git add -A / . は使わない）"
