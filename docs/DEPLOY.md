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
6. 埋め込みのペイント（`/paint/`、OG-nanika の成果物）は Service Worker の precache に入れず、開いたときに版ごとのキャッシュ（`og-paint-<版>`）へ入ります。字形のファイル（`.bin`）だけは precache します。

## ⑦ Render の Headers（CSP）

ビルドの `index.html` には CSP（`script-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'`）が meta で入っています。
`frame-ancestors`（ほかのサイトに iframe で埋め込まれない）は meta では効かないので、Render の Static Site の「Headers」に次の 1 行を足してください（任意。サービスの作り直しは要りません）。

| Path | Name | Value |
|---|---|---|
| `/*` | `Content-Security-Policy` | `script-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'self'; frame-ancestors 'self'` |

値の正はリポジトリの `public/_headers`（Render はこのファイルを読まないので、画面の「Headers」に同じ値を入れる）。`scripts/__tests__/headers.test.mjs` が
meta の CSP と食い違わないことを、`e2e/16-csp.spec.ts` がこのヘッダーの下でも新しいお絵描き（`/paint/embed.html` の iframe と Worker）が動くことを確かめる。

## ⑧ main への push（tools/safe-push.sh）

main への push は `tools/safe-push.sh` だけで行います（2026-10-19 の決定: main に直接 push して Render の本番へすぐ反映）。手で `git push` しません。

1. コミットは「パスを名指しした `git add <path>…`」で作る（`git add -A` / `git add .` / `git add -u` は使わない。手元の zip を巻き込まないため）。
2. `tools/safe-push.sh` を実行する。次を全部確かめてから `git push origin HEAD:main`（fast-forward だけ。force は使わない）:
   - ブランチが main、origin/main が HEAD の祖先、作業木が clean、未追跡は手元の zip 1 つだけ、push する範囲に `.zip` が無い
   - port 4173 が空き、`npm ci`、`npm run build`、`node scripts/check-bundle.mjs`、`node scripts/check-paint-artifact.mjs`、`npm test`、
     `CI=1 npx playwright test --retries=0`（Service Worker を有効にした project を含む）がすべて緑
3. push の後、配信中の `/BUILD_ID`（ビルドしたコミット）が HEAD と一致するまで最大 10 分待って記録する。配信の URL は
   `git config seichotsu.deployUrl https://<サービス名>.onrender.com` で一度だけ設定しておく（無ければ照合は飛ばす）。
4. `.git/hooks/pre-push`（`tools/hooks/pre-push`、safe-push が入れる）が、fast-forward でない更新・ブランチの削除・`.zip` を含む push を拒みます。
5. 戻すときは `git revert` で新しいコミットを積み、同じく safe-push で push します（履歴を書き換えない）。

## ⑨ 新しいお絵描き（UR-002）

自由お絵描き（`#/free`）は埋め込みのペイント（`/paint/embed.html`）で開きます（2026-10-20 の S3 から既定）。設定の「新しいお絵描き（試験中）」
（`paintEngine`）を off にすると今までのお絵描き（v2）に戻ります。ギャラリーの新しいお絵描きの絵は「続きから描く」で同じ文書を開けます。
レッスンの採点のキャンバスはいつも今までのものです。不具合があれば `src/ui/paintEngine.ts` の `DEFAULT_PAINT_ENGINE` を `'v2'` に戻すコミットを
先に safe-push で出します（設定で on / off を選んだ人の値はそのまま）。

埋め込みのペイント（`public/paint/`）の更新は `tools/import-paint.sh <OG-nanika のコミット>` で行います（OG 側の `npm run ci`・`build:embed`・`check:embed` が緑のときだけ置き換え、`public/paint/BUILD.json` にハッシュを書く）。
