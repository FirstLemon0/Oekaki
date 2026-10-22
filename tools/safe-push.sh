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
#   2b. 埋め込みのペイントの版（ADR-0008 D10、ilust-sup-followup-02）: HEAD の public/paint/BUILD.json が origin/main から変わったなら、
#      その取り込みは ogCi = ran・ogClean = true・受け入れのタグ（ogAccepted）つきであること。さらに新しい ogCommit が
#      origin/main の ogCommit の子孫であること（OG のリポジトリ ${OG_DIR:-../OG-nanika} で git merge-base --is-ancestor。版の後退を拒む）
#   3. 緑の確認（すべて、1 つでも落ちたら push しない）: port 4173 が空き、npm ci、npm run build、check-bundle、
#      check-paint-artifact、npm test（vitest）、CI=1 npx playwright test --retries=0（SW を有効にした project を含む）
#   4. git push origin HEAD:main（--force / --force-with-lease は使わない。フックも非 fast-forward と zip を拒む）
#   5. Render の反映を待ち（壁時計で最大 SAFE_PUSH_DEPLOY_WAIT_S = 600 秒）、配信中の /BUILD_ID と HEAD の一致（deploy=match|timeout）と、
#      配信中の /paint/BUILD.json の buildId と HEAD の public/paint/BUILD.json の一致（paint_deploy=match|mismatch|unknown|none）を
#      記録する（一致しなくても巻き戻さない）。配信の URL は環境変数 SEICHOTSU_DEPLOY_URL か `git config seichotsu.deployUrl`
#      （無ければ照合は飛ばして記録だけ）
#   記録は .git/safe-push.log（手元だけ）に 1 行ずつ追記し、最後に要約を出す（OG の docs/progress/m8/README.md に写す）。
#
# 試験用: SAFE_PUSH_TEST_CHECKS に手順 3 の代わりのコマンドを入れられる（origin がローカルのパスのときだけ。GitHub には使えない）。
#   そのときだけ手順 2b の ogCi = skipped・受け入れのタグなしを警告にする（check-paint-artifact と同じ）。
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

# 2b. 埋め込みのペイントの版（取り込みの関門と後退の拒否）
step "2b. 埋め込みのペイントの版（関門の記録・origin/main からの後退なし）"
PAINT_JSON=public/paint/BUILD.json
# git の木の BUILD.json の 1 つの値（無ければ空）
paint_field() { git show "$1:${PAINT_JSON}" 2>/dev/null | node -e "let s='';process.stdin.on('data',(d)=>(s+=d)).on('end',()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v===undefined||v===null?'':String(v))}catch{}})" "$2" || true; }
new_og="$(paint_field "${head}" ogCommit)"
old_og="$(paint_field "${base}" ogCommit)"
paint_change="same"
if ! git diff --quiet "${base}" "${head}" -- "${PAINT_JSON}"; then
  paint_change="changed"
  if [ -n "${new_og}" ]; then
    new_ci="$(paint_field "${head}" ogCi)"
    new_clean="$(paint_field "${head}" ogClean)"
    new_acc="$(paint_field "${head}" ogAccepted)"
    soft_stop() {
      if [ -n "${SAFE_PUSH_TEST_CHECKS:-}" ]; then echo "safe-push: 試験のため警告だけ: $*" >&2; else die "$*"; fi
    }
    [ "${new_clean}" = true ] || die "新しい埋め込みの取り込みの ogClean が true ではありません（${new_clean:-記録なし}。OG の作業木が clean なときに tools/import-paint.sh で取り込み直す）"
    [ "${new_ci}" = ran ] || soft_stop "新しい埋め込みの取り込みの ogCi が ran ではありません（${new_ci:-記録なし}。IMPORT_PAINT_SKIP_OG_CI なしで取り込み直す）"
    [ -n "${new_acc}" ] || soft_stop "新しい埋め込みの取り込みに受け入れのタグ（ogAccepted）がありません（取り込みの基点は m<n>-accepted だけ）"
  fi
fi
if [ -n "${new_og}" ] && [ -n "${old_og}" ] && [ "${new_og}" != "${old_og}" ]; then
  og_repo="${OG_DIR:-$(cd .. && pwd)/OG-nanika}"
  git -C "${og_repo}" rev-parse --git-dir >/dev/null 2>&1 || die "埋め込みの版の前後を確かめる OG のリポジトリがありません（${og_repo}。OG_DIR で指定）"
  git -C "${og_repo}" cat-file -e "${old_og}^{commit}" 2>/dev/null || die "OG のリポジトリに origin/main の ogCommit ${old_og:0:12} がありません（${og_repo}）"
  git -C "${og_repo}" cat-file -e "${new_og}^{commit}" 2>/dev/null || die "OG のリポジトリに HEAD の ogCommit ${new_og:0:12} がありません（${og_repo}）"
  if ! git -C "${og_repo}" merge-base --is-ancestor "${old_og}" "${new_og}"; then
    die "埋め込みの版が後退しています: HEAD の ogCommit ${new_og:0:12} は origin/main の ${old_og:0:12} の子孫ではありません"
  fi
fi
paint_gate="${paint_change}:${old_og:0:12}->${new_og:0:12}"

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
  printf '%s\tDRY-RUN\t%s\tbase=%s\tcommits=%s\tchecks=%s\tpaint=%s\tpaint_gate=%s\n' "${started}" "${head}" "${base}" "${commits}" "${checks}" "${paint}" "${paint_gate}" >> "${LOG}"
  echo "safe-push: --dry-run のため push しません（${head} は緑、paint=${paint}、paint_gate=${paint_gate}）"
  exit 0
fi

# 4. push（fast-forward だけ）
step "4. git push origin HEAD:main"
git push origin HEAD:main || die "git push が失敗しました（フックが拒んだか、origin が先に進んだ）"

# 5. デプロイの照合
deploy_url="${SEICHOTSU_DEPLOY_URL:-$(git config --get seichotsu.deployUrl || true)}"
deploy="skipped(no-url)"
paint_deploy="skipped(no-url)"
if [ -n "${deploy_url}" ] && [ -z "${SAFE_PUSH_TEST_CHECKS:-}" ]; then
  wait_s="${SAFE_PUSH_DEPLOY_WAIT_S:-600}"
  step "5. Render の反映を待つ（壁時計で最大 ${wait_s} 秒）: ${deploy_url%/}/BUILD_ID"
  deploy="timeout"
  t0="$(date +%s)"
  while :; do
    served="$(curl -fsS --max-time 15 "${deploy_url%/}/BUILD_ID?t=$(date +%s)" 2>/dev/null | tr -d '\r\n ' || true)"
    if [ "${served}" = "${head}" ]; then
      deploy="match"
      break
    fi
    left=$(( t0 + wait_s - $(date +%s) ))
    [ "${left}" -gt 0 ] || break
    sleep $(( left < 20 ? left : 20 ))
  done
  [ "${deploy}" = match ] || echo "safe-push: 配信中の BUILD_ID が ${head} になりませんでした（巻き戻さない。次の push の前に確かめる）" >&2
  # 埋め込みの版（/paint/BUILD.json の buildId）も HEAD のものと比べる（記録だけ）
  want_paint="$(paint_field "${head}" buildId)"
  if [ -z "${want_paint}" ]; then
    paint_deploy="none"
  else
    served_paint="$(curl -fsS --max-time 15 "${deploy_url%/}/paint/BUILD.json?t=$(date +%s)" 2>/dev/null | node -e "let s='';process.stdin.on('data',(d)=>(s+=d)).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).buildId??''))}catch{}})" || true)"
    if [ -z "${served_paint}" ]; then paint_deploy="unknown"
    elif [ "${served_paint}" = "${want_paint}" ]; then paint_deploy="match"
    else paint_deploy="mismatch(${served_paint})"
    fi
  fi
  [ "${paint_deploy}" = match ] || [ "${paint_deploy}" = none ] || echo "safe-push: 配信中の /paint/BUILD.json の buildId が HEAD と違います（${paint_deploy}）" >&2
fi

printf '%s\tPUSHED\t%s\tbase=%s\tcommits=%s\tchecks=%s\tpaint=%s\tpaint_gate=%s\tdeploy=%s\tpaint_deploy=%s\n' "${started}" "${head}" "${base}" "${commits}" "${checks}" "${paint}" "${paint_gate}" "${deploy}" "${paint_deploy}" >> "${LOG}"
echo "safe-push: push しました: ${base:0:7}..${head:0:7}（${commits} コミット、paint=${paint}、deploy=${deploy}、paint_deploy=${paint_deploy}）"
