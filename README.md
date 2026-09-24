# 成長通（せいちょうつう）

画力ゼロからアニメ・漫画調のキャラクターイラスト1枚絵が描けるようになるまで、毎日15分で伴走する練習アプリです。タブレット＋ペンでの利用を想定した PWA（Vite + Preact）で、データは端末内（IndexedDB）だけに保存されます。設計の背景や決定事項は [DESIGN.md](./DESIGN.md) を、実装の取り決めは [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

## 開発コマンド

```bash
npm run dev        # 開発サーバー（LAN公開あり）
npm test           # 単体テスト（vitest）
npm run test:e2e   # E2E テスト（Playwright・ローカルの vite preview を使う）
npm run build      # 型チェック + 本番ビルド（dist/）
```

### タブレットの Chrome から確認する（`npm run dev`）

`npm run dev` は `vite --host` で立ち上がるため、同じ Wi-Fi にいるタブレットからも開けます。

1. 開発機で `npm run dev` を実行する。ターミナルに `Network: http://<IP>:5173/` のような行が出るので、その IP を控える（出ない場合は下記でも調べられる）。
   - Windows: `ipconfig` の「IPv4 アドレス」
   - macOS/Linux: `ifconfig` または `ip addr`
2. タブレットの Chrome で `http://<開発機のIP>:5173` を開く。
3. **WSL2 で開発している場合の注意**: WSL2 は既定で NAT ネットワークのため、同じ Wi-Fi の他端末（タブレット）から WSL2 内の Vite サーバーへ直接は届かないことがあります。Windows 11 の「ミラーモード」ネットワーク（`.wslconfig` に `networkingMode=mirrored`）を使うか、届かない場合は Windows 側で `netsh interface portproxy` を使って 5173 番ポートを WSL2 の IP へ転送してください。うまくいかない場合は、いったん `npm run build && npm run preview` で確認する方法もあります（この場合も同様の LAN 到達性が必要です）。
4. 開発機のファイアウォールで 5173 番ポートの着信がブロックされていないか確認する。

## ディレクトリ構成

主要なディレクトリと役割、担当の分け方は [ARCHITECTURE.md](./ARCHITECTURE.md) にまとめてあります。ざっくりは次の通りです。

| パス | 役割 |
|---|---|
| `src/scoring/` | 採点 A（幾何学採点）の純関数 |
| `src/content/` | 教材スキーマ・ローダー |
| `src/data/` | IndexedDB・ストリーク・バックアップ |
| `src/canvas/` | 描画エンジン |
| `src/critic/` | 採点 B（Claude API 呼び出し） |
| `src/ui/` | 画面・ルーティング・テーマ |
| `content/` | 教材データ（JSON・SVG） |
| `e2e/` | Playwright の E2E テスト |
| `docs/` | セットアップ・配信・バックアップ・トラブルシューティングの手順書 |

## 教材の書き方

レッスン・ステップの JSON フォーマットは [content/README.md](./content/README.md) を参照してください。

## 手順書

- [docs/SETUP.md](./docs/SETUP.md) — 初回セットアップ（API キー・タブレット設定など）
- [docs/DEPLOY.md](./docs/DEPLOY.md) — Render への配信
- [docs/BACKUP.md](./docs/BACKUP.md) — バックアップの取り方・戻し方
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) — よくある困りごと
