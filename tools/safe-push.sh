#!/usr/bin/env bash
# main への push はこのスクリプトだけで行う（UR-002 / ADR-0007 D5。利用者の選択 2026-10-19 = main に直接、Render の本番へ即反映）。
# 手で `git push` しない。force-push しない。履歴を書き換えない（戻すときは git revert の新しいコミット）。
#
#   tools/safe-push.sh            … 確かめてから origin main へ fast-forward で push し、Render の反映を待って照合する
#   tools/safe-push.sh --dry-run  … push の直前まで（緑の確認まで）を行い、push しない
#
# 流れ:
#   0. pre-push フック（tools/hooks/pre-push）を .git/hooks/ に入れる
#   1. ブランチが main、`git fetch origin main`、origin/main が HEAD の祖先（fast-forward でなければ止める。rebase も merge もしない）
#   2. 載せるものの確認: 作業木と index が clean（今のコミットのツリーで確かめる）、未追跡は zip 1 つだけ、
#      origin/main..HEAD と HEAD のツリーに .zip が無い（コミットは呼び出し側が「パスを名指しした git add」で作る）
#   3. 緑の確認（すべて、1 つでも落ちたら push しない）: port 4173 が空き、npm ci、npm run build、check-bundle、
#      check-paint-artifact、npm test（vitest）、CI=1 npx playwright test --retries=0（SW を有効にした project を含む）
#   4. git push origin HEAD:main（--force / --force-with-lease は使わない。フックも非 fast-forward と zip を拒む）
#   5. Render の反映を最大 10 分待ち、配信中の /BUILD_ID と HEAD の一致を記録する（一致しなくても巻き戻さない）。
#      配信の URL は環境変数 SEICHOTSU_DEPLOY_URL か `git config seichotsu.deployUrl`（無ければ照合は飛ばして記録だけ）
#   記録は .git/safe-push.log（手元だけ）に 1 行ずつ追記し、最後に要約を出す（OG の docs/progress/m7/README.md に写す）。
#
# 試験用: SAFE_PUSH_TEST_CHECKS に手順 3 の代わりのコマンドを入れられる（origin がローカルのパスのときだけ。GitHub には使えない）。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export CI=1

ZIP_NAME='デザイン確認フォーム進行中.zip'
DRY_RUN=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "safe-push: 知らない引数です: $a" >&2; exit 2 ;;
  esac
done

LOG="$(git rev-parse --git-path safe-push.log)"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
die() {
  echo "safe-push: 止めました: $*" >&2
  printf '%s\tSTOP\t%s\t%s\n' "${started}" "$(git rev-parse --short HEAD 2>/dev/null || echo '-')" "$*" >> "${LOG}" 2>/dev/null || true
  exit 1
}
step() { echo "== safe-push: $*"; }

origin_url="$(git remote get-url origin 2>/dev/null)" || die "origin がありません"
if [ -n "${SAFE_PUSH_TEST_CHECKS:-}" ]; then
  case "${origin_url}" in
    /*|file://*) ;;
    *) die "SAFE_PUSH_TEST_CHECKS は origin がローカルのパスのときだけ使えます（${origin_url}）" ;;
  esac
fi

# 0. フック
step "0. pre-push フックを入れる"
hooks_dir="$(git rev-parse --git-path hooks)"
mkdir -p "${hooks_dir}"
if ! cmp -s tools/hooks/pre-push "${hooks_dir}/pre-push" 2>/dev/null; then
  install -m 0755 tools/hooks/pre-push "${hooks_dir}/pre-push"
fi

# 1. ブランチと上流
step "1. main と origin/main（fast-forward だけ）"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "${branch}" = main ] || die "main ではありません（${branch}）"
git fetch origin main
git merge-base --is-ancestor origin/main HEAD || die "origin/main が先に進んでいます（fast-forward でない）。rebase も merge もせず止めます"
head="$(git rev-parse HEAD)"
base="$(git rev-parse origin/main)"
[ "${head}" != "${base}" ] || die "push するコミットがありません（HEAD = origin/main）"

# 2. 載せるもの
step "2. 載せるもの（clean・未追跡は zip だけ・範囲に zip なし）"
git diff --quiet || die "作業木に未コミットの変更があります（今のコミットのツリーで確かめるため clean にしてから）"
git diff --cached --quiet || die "index に stage された未コミットの変更があります（$(git -c core.quotepath=false diff --cached --name-only | tr '\n' ' ')）"
unexpected="$(git -c core.quotepath=false ls-files --others --exclude-standard | grep -vxF "${ZIP_NAME}" || true)"
[ -z "${unexpected}" ] || die "想定外の未追跡のファイルがあります: $(echo "${unexpected}" | tr '\n' ' ')"
zips_in_range="$(git -c core.quotepath=false log --name-only --format= "${base}..${head}" | grep -iE '\.zip$' | sort -u || true)"
[ -z "${zips_in_range}" ] || die "push する範囲に .zip があります: ${zips_in_range}"
zips_in_tree="$(git -c core.quotepath=false ls-tree -r --name-only "${head}" | grep -iE '\.zip$' || true)"
[ -z "${zips_in_tree}" ] || die "HEAD のツリーに .zip があります: ${zips_in_tree}"
commits="$(git rev-list --count "${base}..${head}")"

# 3. 緑の確認
step "3. 緑の確認"
if [ -n "${SAFE_PUSH_TEST_CHECKS:-}" ]; then
  bash -c "${SAFE_PUSH_TEST_CHECKS}" || die "緑の確認（試験用）が失敗しました"
  checks="test-override"
else
  if node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen(4173,'127.0.0.1',()=>s.close(()=>process.exit(0)))"; then :; else
    die "port 4173 が使われています（古い preview を試験に使わないよう、止めてから）"
  fi
  npm ci || die "npm ci が失敗しました"
  npm run build || die "npm run build（tsc --noEmit && vite build）が失敗しました"
  node scripts/check-bundle.mjs || die "check-bundle（初期 JS の予算・paint/ の混入）が失敗しました"
  node scripts/check-paint-artifact.mjs || die "check-paint-artifact（BUILD.json の照合）が失敗しました"
  npm test || die "vitest が失敗しました"
  npx playwright test --retries=0 || die "e2e（--retries=0、SW を有効にした project を含む）が失敗しました"
  checks="npm-ci,build,check-bundle,check-paint-artifact,vitest,e2e(retries=0)"
fi

paint="none"
if [ -f public/paint/BUILD.json ]; then
  paint="$(node -p "const b=require('./public/paint/BUILD.json'); b.ogCommit.slice(0,12)+'/'+b.buildId")"
fi

if [ "${DRY_RUN}" = 1 ]; then
  printf '%s\tDRY-RUN\t%s\tbase=%s\tcommits=%s\tchecks=%s\tpaint=%s\n' "${started}" "${head}" "${base}" "${commits}" "${checks}" "${paint}" >> "${LOG}"
  echo "safe-push: --dry-run のため push しません（${head} は緑）"
  exit 0
fi

# 4. push（fast-forward だけ）
step "4. git push origin HEAD:main"
git push origin HEAD:main || die "git push が失敗しました（フックが拒んだか、origin が先に進んだ）"

# 5. デプロイの照合
deploy_url="${SEICHOTSU_DEPLOY_URL:-$(git config --get seichotsu.deployUrl || true)}"
deploy="skipped(no-url)"
if [ -n "${deploy_url}" ] && [ -z "${SAFE_PUSH_TEST_CHECKS:-}" ]; then
  step "5. Render の反映を待つ（最大 10 分）: ${deploy_url%/}/BUILD_ID"
  deploy="timeout"
  for _ in $(seq 1 30); do
    served="$(curl -fsS --max-time 15 "${deploy_url%/}/BUILD_ID?t=$(date +%s)" 2>/dev/null | tr -d '\r\n ' || true)"
    if [ "${served}" = "${head}" ]; then
      deploy="match"
      break
    fi
    sleep 20
  done
  [ "${deploy}" = match ] || echo "safe-push: 配信中の BUILD_ID が ${head} になりませんでした（巻き戻さない。次の push の前に確かめる）" >&2
fi

printf '%s\tPUSHED\t%s\tbase=%s\tcommits=%s\tchecks=%s\tpaint=%s\tdeploy=%s\n' "${started}" "${head}" "${base}" "${commits}" "${checks}" "${paint}" "${deploy}" >> "${LOG}"
echo "safe-push: push しました: ${base:0:7}..${head:0:7}（${commits} コミット、paint=${paint}、deploy=${deploy}）"
