#!/usr/bin/env bash
# tools/hooks/ のフックを .git/hooks/ に入れる（手元だけの設定。追跡されるファイルは変えない）。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
hooks_dir="$(git rev-parse --git-path hooks)"
mkdir -p "${hooks_dir}"
install -m 0755 tools/hooks/pre-push "${hooks_dir}/pre-push"
echo "install-hooks: ${hooks_dir}/pre-push"
