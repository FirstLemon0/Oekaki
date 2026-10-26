# 配信（Render Static Site）

このアプリはビルドすると静的ファイル（`dist/`）になるだけなので、Render の Static Site で配信します。サーバー側の処理はありません。

## ① GitHub に非公開リポジトリを作る

1. GitHub で新しいリポジトリを作成する。**Private（非公開）** にすること。個人の練習記録・学習用アプリなので公開する必要はありません。
2. このプロジェクトを push する。

```bash
git remote add origin git@github.com:<あなたのアカウント>/<リポジトリ名>.git
git push -u origin main
```

## ② Render で Static Site を作る

1. https://dashboard.render.com/ →「New +」→「Static Site」。
2. ①の GitHub リポジトリを接続する（初回は GitHub 連携の許可が必要）。
3. 設定項目:

| 項目 | 値 |
|---|---|
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |
| Node のバージョン | **22** 系に固定する（下記参照） |

4. Node のバージョン固定は次のどちらかで行う（両方設定してもかまいません）。
   - リポジトリ直下の `.node-version` ファイル（このプロジェクトには `22` と書いたものを同梱済み）。Render はこれを自動的に読みます。
   - もしくは Render の環境変数に `NODE_VERSION=22` を追加する。
5. 「Create Static Site」で初回デプロイが始まります。数分でビルドが終わり、`https://<サービス名>.onrender.com` のような URL が発行されます。

## ③ サービス名は最初に決めたら変えない

Render のサービス名（＝配信 URL）は、**一度決めたら変更しないでください**。理由は、このアプリのデータ（進捗・絵・設定など）がすべて IndexedDB に保存されており、IndexedDB はブラウザ上で **オリジン（URL）ごとに別のデータ領域** として扱われるためです。URL が変わると、ブラウザから見て「別のアプリ」扱いになり、それまでの進捗やギャラリーの絵が一切見えなくなります（データが消えるわけではなく、新しい URL からは辿れなくなるだけです）。

もし将来どうしても URL を変える必要が出た場合は、旧 URL 側で先に [バックアップ](./BACKUP.md) を書き出し、新 URL 側で読み込んでください。

## ④ 自動デプロイ

Render の Static Site は既定で「GitHub の対象ブランチに push するたびに自動でビルド・デプロイ」されます（Render の設定画面の「Auto-Deploy」が On になっていることを確認してください）。手元で変更 → コミット → push するだけで、数分後に本番へ反映されます。

## ⑤ 初回アクセス後のオフライン動作

このアプリは PWA（`vite-plugin-pwa`）としてビルドされており、Service Worker が主要なファイルを端末にキャッシュします。

- 初回はオンラインで一度アクセスする必要があります（Service Worker の登録とキャッシュのため）。
- 一度キャッシュされた後は、機内モードや Wi-Fi が無い場所でも、ホーム画面のアイコンから通常どおり起動・練習できます（AI 批評だけは通信が必要です）。

## ⑥ 更新の反映のされ方（autoUpdate）

`vite-plugin-pwa` は `registerType: 'autoUpdate'` で設定されています。挙動は次の通りです。

1. Render へ新しいバージョンをデプロイする。
2. タブレットでアプリを開く（または開いたまま少し操作する）と、バックグラウンドで新しい Service Worker がダウンロード・インストールされます。
3. 次にアプリを開き直したタイミングで、新しいバージョンに切り替わります。ユーザー側で「更新」ボタンを押すような操作は不要です。
4. すぐに最新版を確認したい場合は、アプリをホーム画面のアイコンから一度完全に閉じて開き直す（または Chrome でページを再読み込みする）と確実です。
5. 自由お絵描き（`#/free`）で保存していない線があるあいだは、新しい版が入っても自動では再読み込みしません。「更新があります（保存後に再読み込み）」と出て、保存（または破棄）した後に再読み込みします。ほかの画面では今までどおりすぐ切り替わります（`src/ui/updateDefer.ts`）。
6. 埋め込みのペイント（`/paint/`、OG-nanika の成果物）は Service Worker の precache に入れず、版ごとのキャッシュ（`og-paint-<版>`）へ入ります。字形のファイル（`.bin`）だけは precache します。
   新しい Service Worker の install のときに `public/paint/BUILD.json` の `assets/` の全部（`.bin` 以外、約 6 MB）を `og-paint-<版>` に先に入れます
   （sha256 が BUILD.json と一致したものだけ。install は失敗させず、待つのは最大 2 分）。端末の「データセーバー」（Save-Data）が on、
   回線が遅い（`effectiveType` が slow-2g / 2g / 3g）、モバイル回線（`connection.type` が cellular）のときは install では入れず
   （ilust-sup-followup-09。これを読めるブラウザだけ）、新しいお絵描きを開いたとき（ready の後の `og-paint-fill`）に足りない分を入れます
   （Save-Data のときはそこでも入れない）。動的 import でしか読まれないチャンクも、オフラインや配信の切り替わりの後に読めます
   （ilust-sup-followup-12、`src/swPaint.ts`）。キャッシュの件数の上限は埋め込みのファイル数より必ず大きい値（`paintCacheMaxEntries`）。
7. 配信が切り替わって新しい Service Worker が有効になっても、**1 つ前の版の `og-paint-<版>` は残します**（ilust-sup-followup-02）。
   ⑥-5 で更新を保留している描きかけのページは古い版の埋め込みのまま動いていて、まだ読んでいないチャンク（古いハッシュ名）は新しい版のキャッシュにも
   配信（Render は新しい版だけを置く）にも無いためです。`/paint/assets/` は今の版のキャッシュに無ければ、ほかの `og-paint-*`（1 つ前を先に）を見てから
   ネットワークへ行きます。1 つ前は、次の版が有効になったとき、またはページの読み込みのとき（`og-paint-prune`）に、有効になった時に開いていた
   古い版のページが 1 つも残っていないことを確かめてから消します（`planPaintActivate` / `planPaintPrune`、記録は Cache Storage の `seichotsu-sw-meta`）。

## ⑦ Render の Headers（CSP）— 必須

ビルドの `index.html` には CSP（`script-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'`）が meta で入っています。
埋め込みのペイント（`/paint/embed.html`）にも、OG `m8.1-accepted` 以降の取り込みでは CSP の meta が入ります（`check-paint-artifact` が必須にしている）。
ただし `frame-ancestors`（ほかのサイトに iframe で埋め込まれない）は **meta では効きません**。成長通と埋め込みのペイントは API キー入りの IndexedDB を
同じオリジンで読めるので、多層防御として Render の Static Site の「Headers」に次の 1 行を **必ず** 足してください
（robustness-security-06。サービスの作り直しは要りません。設定は Render のダッシュボードでだけでき、利用者の作業 = OG の RQ-13）。

| Path | Name | Value |
|---|---|---|
| `/*` | `Content-Security-Policy` | `script-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'; frame-ancestors 'self'` |

- Path は `/*`（成長通と `/paint/*` の両方に掛かる）。Value は **`public/_headers` と 1 文字も違えない**（`frame-ancestors 'self'` を含む）。
  値の正はリポジトリの `public/_headers`（Render はこのファイルを読まないので、画面の「Headers」に同じ値を入れる）
- 設定の後、配信で確かめる: `curl -sI https://<サービス名>.onrender.com/paint/embed.html | grep -i content-security-policy` と
  `curl -sI https://<サービス名>.onrender.com/ | grep -i content-security-policy` の両方に上の値が出る
- meta の CSP は取り込みで入るので、このヘッダーの設定を待たずに push してよい（ADR-0009 D4-5）。ただしヘッダーが無い間は `frame-ancestors` が効いていない

`scripts/__tests__/headers.test.mjs` が meta の CSP と食い違わないことを、`e2e/16-csp.spec.ts` がこのヘッダーの下でも新しいお絵描き
（`/paint/embed.html` の iframe と Worker）が動くことを確かめる。

## ⑧ main への push（tools/safe-push.sh）

main への push は `tools/safe-push.sh` だけで行います（2026-10-19 の決定: main に直接 push して Render の本番へすぐ反映）。手で `git push` しません。

1. コミットは「パスを名指しした `git add <path>…`」で作る（`git add -A` / `git add .` / `git add -u` は使わない。手元の zip を巻き込まないため）。
2. `tools/safe-push.sh` を実行する。次を全部確かめてから `git push origin HEAD:main`（fast-forward だけ。force は使わない）:
   - ブランチが main、origin/main が HEAD の祖先、作業木が clean、未追跡は手元の zip 1 つだけ、push する範囲に `.zip` が無い
   - 埋め込みのペイント（`public/paint/BUILD.json`）が origin/main から変わるなら、その取り込みが `ogCi = ran`・`ogClean = true`・受け入れのタグ（`ogAccepted`）つきで、
     新しい `ogCommit` が origin/main の `ogCommit` の子孫（OG のリポジトリ `../OG-nanika` か `OG_DIR` で `git merge-base --is-ancestor`。版の後退を拒む）
   - port 4173 が空き、`npm ci`、`npm run build`、`node scripts/check-bundle.mjs`、`node scripts/check-paint-artifact.mjs`、`npm test`、
     `CI=1 npx playwright test --retries=0`（Service Worker を有効にした project を含む）がすべて緑
3. push の後、配信中の `/BUILD_ID`（ビルドしたコミット）が HEAD と一致するまで壁時計で最大 600 秒（`SAFE_PUSH_DEPLOY_WAIT_S`）待ち、
   配信中の `/paint/BUILD.json` の buildId と HEAD の `public/paint/BUILD.json` の一致（`paint_deploy=match|mismatch|unknown`）とあわせて記録する。配信の URL は
   `git config seichotsu.deployUrl https://<サービス名>.onrender.com` で一度だけ設定しておく（無ければ照合は飛ばす）。
   エージェントは push しません（M8 から。エージェントは commit と `bash tools/safe-push.sh --dry-run` の緑まで。push は利用者が `bash tools/safe-push.sh` を実行する）。
4. `.git/hooks/pre-push`（`tools/hooks/pre-push`、safe-push が入れる）が、fast-forward でない更新・ブランチの削除・`.zip` を含む push を拒みます。
5. 戻すときは `git revert` で新しいコミットを積み、同じく safe-push で push します（履歴を書き換えない）。

## ⑨ 新しいお絵描き（UR-002）

自由お絵描き（`#/free`）は埋め込みのペイント（`/paint/embed.html`）で開きます（2026-10-20 の S3 から既定）。設定の「新しいお絵描き（試験中）」
（`paintEngine`）を off にすると今までのお絵描き（v2）に戻ります。ギャラリーの新しいお絵描きの絵は「続きから描く」で同じ文書を開けます。
レッスンの採点のキャンバスはいつも今までのものです。不具合があれば `src/ui/paintEngine.ts` の `DEFAULT_PAINT_ENGINE` を `'v2'` に戻すコミットを
先に safe-push で出します（設定で on / off を選んだ人の値はそのまま）。

埋め込みのペイント（`public/paint/`）の更新は `tools/import-paint.sh <OG-nanika の受け入れのタグ>`（例 `tools/import-paint.sh m8.1-accepted`）で行います。
取り込みの元は **受け入れ済みのタグ（`m<n>-accepted`、点の版 `m<n>.<k>-accepted` も可。ADR-0009 D1-2）が指すコミットだけ**（ADR-0008 D10-1）。
OG の作業木はそのコミットで、未追跡を含めて clean（`git status --porcelain` が空。別の作業中の OG を汚さないよう
`git -C ../OG-nanika worktree add --detach ../OG-nanika-ilust m8.1-accepted`（作業木が既にあれば `git -C ../OG-nanika-ilust checkout --detach m8.1-accepted`）で
作った作業木を `OG_DIR` に渡してよい）。

取り込みは OG の `npm run ci`（e2e の全部を retries 0 で。1 時間半ほど）を回します（ilust-sup-followup-03）:

- **他の OG の e2e（別の作業木を含む）が走っていない時間に、空いている 52xx の port を付けて**実行する。例:
  `OG_DIR=../OG-nanika-ilust OG_E2E_PORT=5292 OG_EMBED_PORT=5293 tools/import-paint.sh m8.1-accepted`
- 最初に OG の e2e の port（既定 5190 / 5191、`OG_E2E_PORT` / `OG_EMBED_PORT`）が空いているかを確かめ、塞がっていれば ci の前にすぐ止まる
- `CI=1` は付けない（OG の playwright の retries が 1 になり関門が緩むので、取り込みは CI を拒む）
- **揺れ（1 本の flaky）で落ちたら同じコマンドでやり直す**（関門は緩めない）ci の後にもう一度 clean を確かめます（例外は OG の e2e が証跡として書き直す追跡済みの `docs/progress/` の画像だけで、
取り込みが og のコミットの版に戻してから厳密に確かめます）。OG 側の `npm run ci`（省かない）・`build:embed`・`check:embed` が緑のときだけ置き換え、`public/paint/BUILD.json`（schema 2）に
ハッシュと関門の記録（`ogRef`・`ogAccepted`・`ogCi`・`ogClean`・`entryJsGzipBytes`・`ogInitialJsGzipBytes`）を書きます。`check-paint-artifact` は
`ogCi = skipped`・`ogClean ≠ true`・タグ無しの取り込みを拒み、`embed.html` の CSP の meta（`script-src 'self'`・`object-src 'none'`）を確かめます
（契約 0.10.0 以降か受け入れのタグが m8 以降なら meta は必須。meta の無い成果物は M7 までの成果物だけ警告で通す移行の印）。
さらに埋め込みの初期 JS（OG の check-embed の値 `ogInitialJsGzipBytes`）を origin/main の取り込みと比べ、+8 KB を超えたか OG の予算 560 KB の 98 % を超えたら
警告します（落とさない。ilust-sup-followup-04）。

OGNK の形式か `ogContract` が上がる取り込みの前には、配信中の埋め込みで保存した `.ognk` のフィクスチャを
`OG_FIXTURE_NAME=og-<短い sha> npx playwright test --config=e2e/fixtures/og-fixture.config.ts` で足し、`e2e/13-og-free.spec.ts` に「ギャラリーから続けると同じ画素」の試験を足します
（今あるのは `e2e/fixtures/og-8af7b0f.ognk`）。

新しいお絵描きの下書きの印は localStorage（`seichotsu.ogDraft.free`、24 時間）にあり、タブやアプリを閉じた後に開き直しても「続きから / 捨てる」が出ます。
下書きの本体は OG の自動保存の記録（ジャーナル）だけで、埋め込みの下書きの口（`saveDraft` / `latestDraft` / `openDraft`、OG 8af7b0f 以降）が無い成果物には繋がず、
今までのお絵描きに戻ります（理由 version）。M7 の局所アダプタ（親が IndexedDB `seichotsu-drafts` に持つ文書の写し・別の realm の Blob への写し直し）は
UR-002 S4（2026-10-22、ilust-sup-followup-10）で外しました。`seichotsu-drafts` の名前は予約として残し、古い版の写しは印を消すときに DB があれば 1 件消します
（DB を作らない・形を変えない）。「今までのお絵描き」（v2）は RQ-7（Yoga Tab の実機確認）に合格するまで設定で選べるまま残します。
今までのお絵描きに戻った理由（missing / version / boot / timeout / open）は通知の末尾と設定の「練習」の 1 行（localStorage の `seichotsu.ogFallback.last`）に出ます。
