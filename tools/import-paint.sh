#!/usr/bin/env bash
# 埋め込みのペイント（OG-nanika の成果物）を public/paint/ に取り込む（UR-002 / ADR-0007 D4-2、ADR-0008 D10）。
#
#   tools/import-paint.sh <OG の受け入れのタグかコミット>      （例: tools/import-paint.sh m7-accepted）
#
# 守ること（ADR-0008 D10-1）:
# - 取り込みの基点は受け入れ済みのタグ（m<n>-accepted）が指すコミットだけ。タグの無いコミットは拒む
#   （IMPORT_PAINT_ALLOW_UNTAGGED=1 は試験用。BUILD.json の ogAccepted が null になり、check-paint-artifact が拒む）
# - OG の作業木がそのコミットに一致し、未追跡を含めて clean（`git status --porcelain` が空）。ci とビルドの後にもう一度確かめる
#   （OG の e2e が書き直す追跡済みの docs/progress/ の画像だけは og_commit の版に戻してから確かめる）
# - OG の `npm run ci`・`npm run build:embed`・`npm run check:embed` が緑のときだけ置き換える
#   （IMPORT_PAINT_SKIP_OG_CI=1 は試験用。BUILD.json の ogCi が skipped になり、check-paint-artifact が拒む = push できない）
# - 取り込むのは OG の dist-embed/ の成果物だけ（OG のソース・.map・sw.js・manifest・sandbox・bench は入れない）
# - public/paint/BUILD.json に OG のコミット・名前（ogRef）・受け入れのタグ（ogAccepted）・ci を回したか（ogCi）・clean だったか（ogClean）・
#   契約の版・API の版・ファイルごとの sha256・合計・入口の JS の gz・OG の check-embed の初期 JS の gz を書き、
#   scripts/check-paint-artifact.mjs で照合する（手で直した成果物は落ちる）
# - このスクリプトはコミットも push もしない（差分の大きさを出すだけ。コミットはパスを名指しした git add で）
#
# 環境変数: OG_DIR（既定 ../OG-nanika。git worktree でもよい）。OG の e2e の port を変えるときは OG_E2E_PORT / OG_EMBED_PORT（OG の playwright.config）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ILUST_ROOT="$(pwd)"
commit_arg="${1:?OG の受け入れのタグかコミットを指定してください（例: tools/import-paint.sh m7-accepted）}"
OG_DIR="${OG_DIR:-$(cd "${ILUST_ROOT}/.." && pwd)/OG-nanika}"

die() { echo "import-paint: $*" >&2; exit 1; }

og_status() { git -C "${OG_DIR}" status --porcelain --untracked-files=normal; }

[ -d "${OG_DIR}" ] && git -C "${OG_DIR}" rev-parse --git-dir >/dev/null 2>&1 || die "OG のリポジトリがありません: ${OG_DIR}"
og_commit="$(git -C "${OG_DIR}" rev-parse --verify --quiet "${commit_arg}^{commit}")" || die "OG にコミット ${commit_arg} がありません"
og_head="$(git -C "${OG_DIR}" rev-parse HEAD)"
[ "${og_head}" = "${og_commit}" ] || die "OG の作業木が ${commit_arg} ではありません（HEAD = ${og_head}）。OG 側で checkout（か git worktree add --detach）してからやり直してください"
dirty="$(og_status)"
[ -z "${dirty}" ] || die "OG の作業木が clean ではありません（未追跡を含む。clean にしてから）: $(echo "${dirty}" | head -5 | tr '\n' ' ')"

# 受け入れのタグ（そのコミットを指す m<n>-accepted。複数あれば版の大きいもの）
og_accepted="$(git -C "${OG_DIR}" tag --points-at "${og_commit}" | grep -E '^m[0-9]+-accepted$' | sort -V | tail -1 || true)"
if [ -z "${og_accepted}" ]; then
  [ "${IMPORT_PAINT_ALLOW_UNTAGGED:-0}" = "1" ] || die "OG のコミット ${og_commit:0:12} を指す受け入れのタグ（m<n>-accepted）がありません（取り込みの基点は受け入れ済みのタグだけ、ADR-0008 D10-1）"
  echo "import-paint: 試験: 受け入れのタグなしで取り込みます（BUILD.json の ogAccepted = null。check-paint-artifact が拒む）" >&2
fi
grep -q '"build:embed"' "${OG_DIR}/package.json" || die "OG に npm run build:embed がありません"
grep -q '"check:embed"' "${OG_DIR}/package.json" || die "OG に npm run check:embed がありません"

og_ci=ran
if [ "${IMPORT_PAINT_SKIP_OG_CI:-0}" = "1" ]; then
  og_ci=skipped
  echo "import-paint: 試験: OG の npm run ci を省きます（BUILD.json の ogCi = skipped。check-paint-artifact が拒む）" >&2
else
  echo "== OG: npm run ci"
  (cd "${OG_DIR}" && npm run ci)
fi
echo "== OG: npm run build:embed"
(cd "${OG_DIR}" && npm run build:embed)
echo "== OG: npm run check:embed"
(cd "${OG_DIR}" && npm run check:embed)

# ci とビルドで作業木が変わっていない（生成物が追跡のファイルを書き換えた・未追跡を足したなら、成果物は og_commit から再現できない）。
# 例外は 1 つだけ: OG の e2e が証跡として書き直す、追跡済みの docs/progress/ の画像（「 M」= 既存の追跡のファイルの書き換え。
# 埋め込みのビルドの入力ではない）。これは og_commit の版に戻して（git checkout --）から、もう一度 clean を厳密に確かめる。
# 新しく足された画像・docs/progress/ の外・画像以外は従来どおり拒む。
dirty="$(og_status)"
if [ -n "${dirty}" ]; then
  evidence="$(printf '%s\n' "${dirty}" | grep -E '^ M docs/progress/[A-Za-z0-9._/-]+\.(png|jpe?g|webp)$' || true)"
  others="$(printf '%s\n' "${dirty}" | grep -vE '^ M docs/progress/[A-Za-z0-9._/-]+\.(png|jpe?g|webp)$' || true)"
  [ -z "${others}" ] || die "OG の ci / build:embed の後に作業木が clean でなくなりました: $(echo "${others}" | head -5 | tr '\n' ' ')"
  mapfile -t evidence_paths < <(printf '%s\n' "${evidence}" | sed -E 's/^ M //')
  echo "import-paint: OG の e2e が書き直した証跡の画像 ${#evidence_paths[@]} 件を ${og_commit:0:12} の版に戻します: ${evidence_paths[*]}"
  git -C "${OG_DIR}" checkout -- "${evidence_paths[@]}"
  dirty="$(og_status)"
  [ -z "${dirty}" ] || die "OG の証跡の画像を戻した後も作業木が clean ではありません: $(echo "${dirty}" | head -5 | tr '\n' ' ')"
fi
[ "$(git -C "${OG_DIR}" rev-parse HEAD)" = "${og_commit}" ] || die "OG の HEAD が取り込みの間に変わりました"

src="${OG_DIR}/dist-embed"
[ -f "${src}/embed.html" ] || die "OG の dist-embed/embed.html がありません"

og_contract="$(tr -d ' \n\r' < "${OG_DIR}/src/core/VERSION")"
embed_api="$(grep -rhoE 'EMBED_API_VERSION[^=]*=[[:space:]]*[0-9]+' "${OG_DIR}/src/embed" 2>/dev/null | head -1 | grep -oE '[0-9]+$' || true)"
[ -n "${embed_api}" ] || die "OG の src/embed に EMBED_API_VERSION が見つかりません"
og_vite="$(node -p "require('${OG_DIR}/node_modules/vite/package.json').version" 2>/dev/null || echo unknown)"
# OG の check-embed が数える埋め込みの初期 JS（入口 + 起動のチャンク）。数えられなければ記録しない
og_initial="$(cd "${OG_DIR}" && npm run --silent check:embed -- --json 2>/dev/null | node -e "let s='';process.stdin.on('data',(d)=>(s+=d)).on('end',()=>{try{const n=JSON.parse(s).info.initialGzBytes;process.stdout.write(Number.isInteger(n)?String(n):'')}catch{}})" || true)"

# 一時ディレクトリに写して照合してから入れ替える（途中で失敗しても public/paint/ を壊さない）
stage="$(mktemp -d "${TMPDIR:-/tmp}/ilust-paint.XXXXXX")"
trap 'rm -rf "${stage}"' EXIT
cp -R "${src}/." "${stage}/"
rm -rf "${stage}/.vite"
node scripts/paint-artifact.mjs write "${stage}" --og-commit="${og_commit}" --og-contract="${og_contract}" --embed-api="${embed_api}" --vite="${og_vite}" \
  --og-ci="${og_ci}" --og-clean=true --og-ref="${commit_arg}" --og-accepted="${og_accepted}" --og-initial-js-gz="${og_initial}"
# 関門の検査（ogCi = skipped・タグなし）はここでは警告にし、置いた後の check-paint-artifact（と safe-push）が拒む
SAFE_PUSH_TEST_CHECKS=import node scripts/paint-artifact.mjs verify "${stage}"

before_files=0; before_bytes=0
if [ -d public/paint ]; then
  before_files="$(find public/paint -type f | wc -l | tr -d ' ')"
  before_bytes="$(du -sb public/paint | cut -f1)"
fi
rm -rf public/paint
mkdir -p public
cp -R "${stage}" public/paint
gate=0
node scripts/check-paint-artifact.mjs --dir=public/paint || gate=$?

after_files="$(find public/paint -type f | wc -l | tr -d ' ')"
after_bytes="$(du -sb public/paint | cut -f1)"
echo "import-paint: OG ${og_commit}（${commit_arg}、受け入れ ${og_accepted:-なし}、ci ${og_ci}、契約 ${og_contract}、API v${embed_api}、vite ${og_vite}）"
echo "import-paint: public/paint/ ${before_files} ファイル ${before_bytes} B → ${after_files} ファイル ${after_bytes} B"
if [ "${gate}" != 0 ]; then
  echo "import-paint: check-paint-artifact が不合格です（試験の取り込み = push できません。git checkout -- public/paint で戻せます）" >&2
  exit "${gate}"
fi
echo "import-paint: コミットするときは: git add public/paint （パスを名指し。git add -A / . は使わない）"
