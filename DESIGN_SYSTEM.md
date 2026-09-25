# 成長通 デザインシステム（正典: Claude Design 版 v1）

出典: `design-ref/成長通 Design.dc.html`（ユーザーが Claude Design で作成、2026-09-24 取り込み）。
この文書は、その内容を実装用に書き起こしたもの。**DESIGN_BRIEF_UI.md §6 の「案A 和紙と若葉」トークンは廃止**し、以下に置き換える。
迷ったら `design-ref/` の原本と `design-ref/screenshots/` を見る。

## 1. トークン（`src/ui/theme.css` の CSS 変数）

### 色 — ライト（既定）
| 変数 | 値 | 用途 |
|---|---|---|
| `--color-paper` | #F2EFE8 | 画面の地 |
| `--color-surface` | #FAF8F3 | カード・レール・シート |
| `--color-canvas` | #EDEAE2 | 描く紙（キャンバス画面の地、画像タイルの地） |
| `--color-line` | #DCD7CC | 罫線・枠・未完了の道 |
| `--color-ink` | #2B2A28 | 文字・描線・主ボタンの文字・ステージバナー地 |
| `--color-ink-2` | #6B6862 | 補助文字 |
| `--color-ink-3` | #9B978E | 弱い文字・ロックの文字 |
| `--color-ink-inverse` | #FAF8F3 | 墨地の上の文字 |
| `--color-accent` | #7BB661 | 若葉。主ボタン地・完了ノード・進捗・トグル ON |
| `--color-accent-press` | #68A34F | 主ボタン押下 |
| `--color-accent-text` | #3F7329 | 若葉の文字（紙の上で 4.5:1 以上）。**実装で調整**: 原本 #4F8A33 は紙 3.65:1 だったため、紙 4.95:1・accent-soft 4.78:1 の値へ |
| `--color-accent-soft` | #E4EFD9 | 選択面・今日達成ピル・ナビ選択 |
| `--color-accent-on-dark` | #A7D48C | 墨地の上の若葉文字・アイコン |
| `--color-danger` | #C8553D | 炎アイコン・危険ボタン・警告文字 |
| `--color-danger-soft` | #F6E3DE | ストリーク危機ピル地 |
| `--color-danger-text` | #A8452F | **実装で追加**: 小さい危険文字（危機ピル・危険ボタン・警告・点数の下がり）。danger #C8553D は紙 3.79:1 で足りないため。紙 5.14:1・danger-soft 4.77:1。炎アイコン・枠は danger のまま。ダークは #E88A73（surface 4.99:1・danger-soft 4.76:1） |
| `--color-locked` | #E3DFD5 | ロックノード・門（未開放）・次ステージバナー |
| `--color-chip` | #F2EFE8 | カード内チップの地（累計・セグメント地） |
| `--color-mannequin-bg` | #E6E2D8 | ジェスチャーのポーズ人形パネル |
| `--color-dash` | #C4BFB4 | 破線枠 |
| `--score-good` | #3E8E7E | 採点の良（青緑。若葉と区別） |
| `--score-mid` | #D9A441 | 中 |
| `--score-bad` | #C8553D | ズレ大 |
| `--good-bg` / `--good-line` / `--good-text` | #E6F0EC / #BBD9D1 / #2E6E62 | 「良い点」カード |
| `--color-overlay` | #7BB661 at 80% | お手本・重ね表示の線色（見比べ「重ねる」で使用） |
| `--glass` | rgba(250,248,243,.88) | キャンバス上の半透明 UI 地 |
| `--glass-line` | rgba(220,215,204,.9) | 同 枠 |
| `--scrim` | rgba(43,42,40,.28) | モーダル幕（ステージ修了は .32） |

### 色 — ダーク（`[data-theme="dark"]`。描く紙も暗くする）
paper #2A2926 / surface #35332F / canvas #3A3833 / line #4A473F / ink #EDE9E0 / ink-2 #B5B0A6 / ink-3 #7E7A71 / ink-inverse #2A2926 / accent #8FC56F / accent-text #A7D48C / accent-soft #3B4A33 / danger #E07A62 / score-good #5FAE9E / score-mid #E2B45C / score-bad #E07A62 / locked #45423C。
未指定のもの（chip, glass, good-bg 等）は surface/line から派生させる。ダークの描線色は ink。

### 文字
- `--font-body`: 'Zen Kaku Gothic New', 'Hiragino Sans', 'Yu Gothic', sans-serif（400 / 500 / 700）。見出しも同じ書体。
- `--font-mono`: 'Azeret Mono', ui-monospace, monospace（400 / 500 / 600）。**数字・カウンター・点数・タイマー・日付・モデルID・API キー・「2/7」などの進捗表記**はすべて mono。
- 書体ファイルは `public/fonts/` に同梱（オフライン対応、**実装で調整**）。Google Fonts css2（`family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Azeret+Mono:wght@400;500;600&display=swap`）の unicode-range 分割 woff2 をそのまま保存し、`theme.css` 末尾の `@font-face` で読む。OFL 表記は `public/fonts/LICENSE.txt`
- スケール:
  - `--text-display` 96 / 1.0 mono 500（タイマー）、点数は 120 / 1.0 mono 500（採点シート）、72（部品見本）
  - `--text-num-lg` 40 / 1.0 mono 500、ドリル目標 48 mono 500、モーダル統計 32 mono
  - `--text-h1` 28 / 1.3 700、レッスン見出し 32〜36 / 1.3 700、ステージ修了 40 / 1.25 700
  - `--text-h2` 22 / 1.4 700、`--text-h3` 18 / 1.5 500
  - `--text-body` 17 / 1.7 400（レッスン本文は 18 / 1.9）
  - `--text-small` 14 / 1.6、`--text-label` 12 / 1.4 500 letter-spacing .06em（見出しラベル。STAGE ラベルは 10px .12em opacity .6）
- `-webkit-font-smoothing: antialiased`

### 余白・角丸・線・影
- `--sp-1..8`: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64
- `--radius-sm` 6、`--radius-md` 10（ボタン・チップ）、`--radius-lg` 16（カード）、ピル 999。シート上辺 20、モーダル 20〜24、キャンバスの半透明パネル 14
- 線: 罫線 1px line、副ボタン 1.5px line、ノード枠 3px accent、ツール選択 1.5px accent
- `--shadow-1` 0 1px 2px rgba(43,42,40,.08)（セグメント選択）、`--shadow-2` 0 4px 12px .10、`--shadow-3` 0 12px 32px .16（モーダル）、シート 0 -8px 32px rgba(43,42,40,.14)
- キャンバス面では影を使わない

### 操作目標・モーション
- 指 48px 以上、ペン専用 36px 以上。主ボタン高さ 56、副 48〜52、チップ 40〜44、行 56〜64
- 押下: 3% 濃く ＋ scale(.97)、80ms。状態変化 160ms。動くのはパス上だけ（§5）。キャンバス画面は一切動かさない

## 2. コンポーネント

- **ボタン**: 主＝accent 地 ＋ ink 文字（白文字は使わない）500 16〜17px radius 10〜12。副＝surface 地 ＋ 1.5px line 枠。危険＝danger 枠と文字、押下地 danger-soft。無効＝locked 地 ＋ ink-3 文字。文字だけ＝透明地 ink-2。アイコン 48（36）radius 10、選択＝accent-soft 地 ＋ 1.5px accent 枠
- **ピル（上部ステータス）**: 高さ 44、surface 地、1px line 枠、数字 mono 18 500。危機＝danger-soft 地 ＋ danger 枠 ＋「日 · 今日まだ」。達成＝accent-soft 地 ＋ accent 枠 ＋ accent-text 文字
- **ステージバナー**: 520×64、ink 地 ＋ ink-inverse 文字。左「STAGE 1」10px .12em opacity .6 ＋ 題 17 700。右 進捗バー 140×6（地 rgba(250,248,243,.2)、accent）＋ mono 15「20/26」（分母 opacity .5）。ロック中の次ステージ＝locked 地 ＋ ink-2 文字 ＋ 鍵、高さ 52
- **パス**: 幅 520 の縦うねり。道は SVG、未完了 line 色 幅 6 dasharray 1 12、完了区間は accent の実線。ノード中心を通る Q/T 曲線
  - 完了 64 accent 地 ＋ ink チェック 28（stroke 2.5）
  - 今日 72 surface 地 ＋ 3px accent 枠 ＋ ink ペン 32、外側に呼吸する輪（1.8s）。下に題 13 700 ＋「今日」黒ピル 11px
  - ロック 64 locked 地 ＋ ink-3 鍵 24。ラベル 12 ink-3
  - 復習 56 surface ＋ 2px dashed accent ＋ accent-text の undo アイコン
  - 模写CP 60 の 45° 回転角丸四角（radius 14）chip 地 ＋ 2.5px dash 枠、開放時は 64、surface ＋ 2.5px ink 枠
  - 門 200×60〜64、未開放 locked 地 ＋ 中央 1px 縦線 ＋ 鍵「卒業課題」、開放は ink 地 ＋ ink-inverse。開くときは中央から両開き（§5）
- **カウンターチップ**: 高さ 56〜60、chip 地 radius 10、ラベル 11 ink-2、数字 mono 20 ＋ 単位 11 ink-3。増えた直後は accent-soft 地 ＋ accent 枠 ＋ 「▲+20」accent-text
- **セグメント**: 地 chip（または locked）radius 8〜10 padding 3〜4、項目 36〜40px radius 6〜7、選択＝surface ＋ shadow-1、非選択＝透明 ＋ ink-2
- **トグル**: 56×32 ピル、ON accent、ノブ 26 surface
- **スライダー**: `accent-color: accent`、高さ 36、右に mono の値
- **進捗**: ステップは 8px 高さのセグメント（gap 6、accent / line）＋ mono「2/7」
- **点数**: mono 120（シート）/ 72。差分「▲-6」mono 22 danger（上がったら accent-text）。自己ベスト 13 ink-3。「点数は線の精度だけを見ています」12 ink-3
- **ヒートマップ**: canvas 色の箱 radius 12、目標線 dashed ink-3、線は good→mid→bad の色分け 5px。凡例: グラデ 80×6 ＋「ズレ 小→大」＋ 破線「目標線」
- **サブ指標バー**: 8px、地 locked、値の色は good/mid、右に mono 値 32px 幅
- **批評カード**: 良い点＝good-bg ＋ good-line 枠 ＋ good-text 見出し、各行に check 18。直す点＝surface、番号マーカー 28 ink 地 mono 14、`where` 700 —`what`、改行して「→ fix」accent-text。次にやる1つ＝ink 地、見出し accent-on-dark、本文 20 500
- **番号マーカー（絵の上）**: 32 ink 地 mono 15、2px surface 枠
- **ツールバー**: 半透明 glass 地 ＋ glass-line 枠 radius 14 padding 6 gap 2。縦（左端中央）は 48px ボタン。取っ手 36×48 で折り畳み（折り畳むと取っ手だけ残る）。取っ手の下に「グリッド」ミニセグメント（36px、min-width 64、選択は ink 地）。左利き設定で右端へ、完了ボタンは左下へ
  - 設定パネル（ペン・消しゴム）: 選択中のツールをもう一度タップ（またはロングプレス 400ms）でツールの横に小パネル。glass 地 ＋ glass-line 枠 radius 14、当たり判定 48px。描き始め（紙への pointerdown）で閉じ、描いている間は出さない
    - ペン: プリセット 4 つ（鉛筆／ペン／筆ペン／マーカー。アイコンは太さの違う見本線の線画）、太さ 1〜16、不透明度 10〜100%、色（パレット 14 色のスウォッチ。48px 当たり判定、選択中は 2px accent 枠。先頭の「墨」はテーマの ink に追従。末尾「その他」で任意色、直近の任意色を 3 つまで記憶＝`seichotsu.penRecentColors`）。ペンアイコンの下に現在色の 10px の丸。端末内の好みとして localStorage `seichotsu.penStyle` に保存し、キャンバス起動時に反映。採点するドリル・なぞり・較正では「ペン」・墨に固定し、パネルに「採点中は固定（線の精度を見るため）」と出す
    - 保存: 線ごとの見た目は `engine.getStyles()` を絵の `meta.strokeStyles`（strokes と同じ並び、スタイルなしは null）に入れ、ギャラリーの再生で `loadStrokes(strokes, strokeStyles)` に渡す
    - 消しゴム: モード（線ごと／部分消し）と太さ 4〜40。既定「部分消し・12」（localStorage `seichotsu.eraserStyle`）
  - グリッドのミニセグメントは 2 段: 上「なし／2／3／4／6／8 分割」、下「25／50／100 px」の方眼
  - 左右反転は絵だけ反転する（グリッドは固定）。ボタン名「絵を左右反転（グリッドは固定）」
- **戻るピル（BackPill）**: 「← 戻る」の文字つきピル。高さ 44、glass 地、1px line 枠、15px 500、radius 999、矢印アイコン 20。左上に固定（キャンバスは top 16 / left 16、ヘッダは左端）。キャンバス・レッスン（旧 ✕）・ジェスチャー・批評・自由お絵描き・校正・復習で共通。戻り先の説明は aria-label / title に入れ、見た目の文字はいつも「戻る」。保存していない線があるときは確認モーダル「描いた線が消えます。戻りますか？」（副「描き続ける」・危険「戻る」）を出す（端末の戻る・閉じるも同じ）
- **ツールバーを反対側へ**: 取っ手の下（縦向きは取っ手の横）に 36×48 の左右矢印ボタン（aria-label「ツールバーを反対側へ」）。押すとツールバー・グリッド欄・完了ボタン・「ペンのみ」が反対側へ移り、設定の「利き手」（`settings.leftHanded`）に保存。縦向き（上端の下の段に横並び）では左寄せ⇄右寄せ
- **紙を替える（ドリルのみ）**: ツールバーの全消しの下に新しい紙のアイコン。表示上の線を全部消す（本数・累計・Undo は変わらない、確認なし）。ドリルの採点済みの線は、最新 1 本はふつう・その前 3 本は不透明度 0.3・それより古い線は出さない（ハッチング・なぞり・自由お絵描きは対象外。お手本の重ねはそのまま）
- **キャンバス上のピル**: 課題＝上中央 48px glass、16 500、右端に 36 の折り畳みボタン。カウンター＝右上 40px glass mono 18「7/10」。ペンのみ＝左下 36px rgba(250,248,243,.7) 12 ink-2「ペンのみ — 指では描けません」
- **入力**: 高さ 48、1.5px line 枠 radius 10、API キーは mono 14。エラー＝danger 枠 ＋ 12px danger の説明
- **リスト行**: 高さ 56〜64、下罫線、左 15px 題（説明 12 ink-3）、右 操作
- **トースト**: 48px ink 地 ＋ ink-inverse 14、先頭に accent-on-dark のチェック
- **空状態**: 1.5px dashed line 枠 radius 12、アイコン ink-3 32、15px「まだ絵がありません」、13 ink-2「今日の1歩を描くと、ここに並びます」
- **画像タイル**: canvas 地 radius 12 1px line、左下 種別チップ（rgba(43,42,40,.75) ＋ ink-inverse 10〜11px）、右下 mono 日付。選択＝2px accent 枠
- **ボトムシート**: surface、上角 20、シート影、取っ手 48×5 line。背景は暗くしない
- **モーダル**: surface radius 20〜24、shadow-3、幕 scrim。出現は stPop（.35s ease-out、scale .6→1.08→1）

## 3. 画面（横 1472×920）

### ホーム
- 左レール 96px surface ＋ 右罫線。上にロゴ 40（§6）、ナビ 72×64 radius 12（選択 accent-soft）、ラベル 11
- 上部バー 72px: 左にピル群（ストリーク／フリーズ「1 /2」／今日 未達・達成）、右に「Lv 4 XP 1,240」（13 ink-3、数字 mono ink-2）
- 中央: ステージバナー ＋ パス（幅 520、高さは内容に応じて縦スクロール。今日のノードが見える位置へ初期スクロール）。ユニット見出し「U1-3 円と楕円」12 500 ink-2 左上
- 右パネル 400px、gap 16:
  - 通常: 「今日の1歩」カード（surface radius 16 padding 22 24。ラベル accent-text 12 500 .06em、題 24 700、メタ 14 ink-2「約15分 · 7ステップ · 説明 → ドリル → なぞり」、主ボタン 56「始める」）
  - 今日完了: accent-soft 地 ＋ accent 枠。「今日の分は終わり。続けるなら次へ」＋ check。その下に surface 地の「次のレッスン」カード（題 22 700・メタ・主ボタン「続ける」）。前を終えたら次はすぐ開く（日付の縛りなし）。下に副ボタン2つ「追加ドリル」「自由お絵描き」
  - 危機（22時以降・未活動）: ink 地。「今日まだ描いていません」#E0A797、「あと 1:40 で日付が変わります」24 700 mono、主「5分だけ描く」＋ 透明枠「フリーズ」
  - 初回: 「はじめに」「今の1枚を描きましょう」本文「上手さは見ません。半年後に見比べるための『Before』です。好きなキャラを1人、15分で。」主「Before を描く」
  - 副ボタン 56「自由お絵描き」（ブラシ icon、右端に 12 ink-3「採点なし・記録だけ」）
  - 「累計」カード: ラベル 12 500 ink-2 .06em、3列グリッド gap 8 の 60px チップ
  - 通知行（通常時のみ）: 1px line 枠 radius 12「バックアップから30日経過しました」＋ 副ボタン 40「書き出す」

### レッスン（read / drill）
- ヘッダ 80: 左「← 戻る」ピル（§2）、中央 進捗セグメント 8px、右 mono「2/7」。復習（ウォームアップ）の説明画面はフッタに副「スキップ」
- read: grid 720px | 1fr、gap 56、padding 24 80 0。図解カード 560 高 surface radius 16。右: ラベル「説明」accent-text、h3 32 700、本文 18/1.9 `text-wrap: pretty`、補足 14 ink-2。フッタ 112、右寄せ主「次へ」（padding 0 48）
- drill: grid 1fr | 560px、padding 24 80 0 120。左: ラベル「ドリル」、h3 36 700 1.35、本文 16 ink-2 1.8、下に「目標 / 現在 / 前回」mono 48（現在・前回は ink-3、前回に「点」）。右: 図解カード 400 高。主「描く」＋ ペン icon

### キャンバス
- 地 canvas。グリッド 3分割/4分割は rgba(43,42,40,.12) の 1px 線
- 上中央 課題ピル、右上 カウンター、左中央 ツールバー＋取っ手＋グリッドセグメント、左下 ペンのみ、右下 主「完了」（radius 14、check icon）
- 採点シート 400 高: 取っ手、grid 260px | 1fr | 380px gap 48。左: 「点数」12、mono 120、▲-6、自己ベスト、注記。中: 「ヒートマップ — 最後の1本」＋ 150 高の箱 ＋ 凡例。右: 助言箱（chip 地 radius 12 16px 500 1.7）＋ サブ指標。フッタ右寄せ 副「次へ」・主「もう一回」（undo icon）

### ジェスチャー
- タイマー: 左 560px パネル（mannequin-bg）にポーズ人形の枠 360×520（1.5px dashed dash 色、radius 16）＋ 回転ボタン ＋「正面に戻す」。右は紙。上中央 mono 96 の残り秒 ＋「60秒 · 3/5体目」12 ink-3 .1em。左（x=576）にミニツールバー（ペン・undo・全消し）。左下ペンのみ。右下 副「先に終える」（glass 地）
- 見比べ: ヘッダ 80「見比べ」20 700 ＋「3/5体目 · 60秒」14 ink-2、右にセグメント（並べる／重ねる）。本文 2 パネル（ポーズ＝mannequin-bg、自分の線＝canvas）。重ねるは 1 パネルに accent 80% の人形線 ＋ ink の自分の線、左上に凡例。フッタ 112: 左に一言 15 ink-2、右に副「もう一度同じポーズ」・主「次のポーズ」

### 批評
- ヘッダ 80: 戻る、ラベル「ステージ1.5 卒業課題」accent-text、題「正面顔 — 批評」20 700、右「今日の残り 2/3 回」
- 送信前: grid 520 | 1fr gap 64 padding 24 120 48。左 600 高の絵（canvas 地、左上「送る絵（縮小）」）。右 h3 28「先生に見てもらいますか？」、リストカード（自分の絵／課題文／ルーブリック＝check、お手本は送りません＝✕ ink-3）、注記「10〜30秒かかります。点数はつけません。言葉で見ます。モデル: … · 目安 ¥…」、副「やめる」・主「送る」
- 待機: 中央に絵 280×340 opacity .7、accent の 3 点ドット（stDots 1.4s）、「先生が見ています…」20 500、副「キャンセル」
- 結果: grid 480 | 1fr gap 40。左 絵 ＋ 番号マーカー ＋ 下に注記。右 2 列グリッド: 良い点（列1）、直す点（列2・2行分）、次にやる1つ（列1）、最下段に引用「『1枚目でここまで形になれば十分です』」16 ink-2 ＋ 副「履歴」・主「レッスンを終える」

### ギャラリー
- 左レール。ヘッダ 88: h3 24 ＋ セグメント（グリッド／Before / After 比較）＋ 右「186 枚 · 1.2 GB」
- グリッド: フィルタピル 40（すべて／ドリル／レッスン／自由／卒業課題／Before・After、選択は ink 地）＋ 6 列 aspect 1 タイル
- 比較: 2 カード（AFTER は 2px accent 枠、左上 BEFORE/AFTER ラベル 12 700 .1em ＋ mono 日付、右上「92日」accent-text）＋ 「月ごとの描き直し」カード 120 高（72px タイル、選択 accent 枠、未来は dashed ＋「＋」）

### 設定
- 左レール ＋ 左列 300（h3 24、グループ行 52 radius 10、選択 accent-soft。下に「成長通 v… / 最終バックアップ …」12 ink-3）
- 右: 2 列グリッド gap 32、グループ＝ラベル 12 700 ink-2 .06em ＋ カード（surface radius 12 padding 6 20、行 56〜64）
  - AI 批評: API キー（mono 入力 ＋ 接続テスト、下に接続結果 accent-text）、モデル ID（mono）、思考の深さ（セグメント low/medium/high）、1日の上限回数（mono）、費用の目安
  - 採点: 校正モード（説明 ＋ 副「再実行」）、合格ラインの厳しさ（ふつう／やさしめ）
  - 練習: 1日の目標（chevron）、通知（mono 時刻 ＋ トグル）、利き手（右／左、説明「ツールバーと完了ボタンの位置が入れ替わります」）、ペン専用モード（トグル）、外部お絵描きアプリ
  - データ: ストレージ（mono「1.2 / 8 GB」＋ 6px バー ink）、バックアップ（最終日 danger で警告 ＋ 副「読み込む」・主「zip で書き出す」）

### モーダル
- レッスン完了: 640 幅 radius 20 padding 40 44 32。44 の accent 丸チェック ＋ h3 28「今日の分は終わり。」、メタ 16 ink-2、3 統計カード（XP mono 32「+30」/ 楕円 accent-soft「▲+20 個」/ ストリーク 炎 ＋ mono 32「24日」「23 → 24」）、「次はこれ」枠行（押すと次のレッスンへ）、3 ボタン（副・副・主「ホームへ」）
- ステージ修了: 1040×720 radius 24 grid 460 | 1fr。左 canvas 地に卒業課題の絵 ＋ キャプション。右 padding 56: 「STAGE 1 修了」accent-text .12em、h3 40 700 2 行、本文 16 ink-2 1.8、下寄せに ink 地の NEXT カード（「NEXT · STAGE 1.5」11 .12em opacity .6、題 20 700、「6 レッスン · すぐ始められます」13 opacity .7、右に chevron accent-on-dark）、副「Before と見比べる」・主「ホームへ」

## 4. 縦向き（920×1472）
- ホーム: ヘッダ 80 ピル群 ＋ Lv。今日カード（横並び: 題 22 ＋ 主ボタン 56）。累計チップ横スクロール（56 高 min-width 128）。中央にステージバナー ＋ パス 520。下部ナビ 88 surface ＋ 上罫線、項目 120×64
- キャンバス: 上端 16px に左「← 戻る」・右端カウンター、その下 72px の段にツールバー横並び（48 ボタン。右利きは左寄せ、左利きは右寄せ）、148px に課題ピル。左下ペンのみ、右下 完了（左利きは左右入れ替え）

## 5. マイクロインタラクション（パス上のみ・1 秒以内・ease-out）
- 完了: 今日ノードが白→accent に 200ms で満ち、チェックの線が 300ms で描かれ（dashoffset）、道の次区間が 400ms で accent に伸びる
- 今日: 外輪 1.8s 周期で広がって消える（stPulse: scale 1→1.55, opacity .55→0）。画面に 1 つだけ。タップで .97 に沈み、レッスンへスライド遷移
- ロック: タップで左右 3px に 1 回だけ振れ（.4s）、トースト「前のレッスンを終えると開きます」。赤や✕は出さない
- 門: 模写チェックポイント完了時、ink 色の両扉が 600ms で開き（translateX ±46px, rotateY ±40deg）、中の accent-soft が見える。開いた門は「卒業課題へ」ボタンになる
- モーダル出現 stPop .35〜.4s。待機ドット stDots 1.4s

## 6. ロゴ・アイコン
- マーク: `<path d="M10 50 C 20 50, 22 30, 32 30 S 44 46, 54 12" stroke=accent stroke-width=6 stroke-linecap=round>` ＋ 終点 `<circle cx=54 cy=12 r=5.5 fill=ink>`（viewBox 0 0 64 64）。レール用は 40px、path は `M14 48 C 22 48, 24 30, 32 30 S 42 44, 50 16` ＋ circle(50,16,4.5)
- ワードマーク「成長通」44 700 .04em、ふりがな 13 ink-2 .2em。墨地版は accent #8FC56F ＋ 点 surface
- アプリアイコン 512: 地 #F2EFE8 radius 56（マスク対応は角丸なしで同じ構図）、文字なし版・文字あり版（40 700 .06em）・反転版（accent 地、線 ink、点 surface）。192 は radius 22、48 は radius 11 で線幅 7

## 7. 文言（変更なし）
丁寧だが短い。「今日の1歩」「始める」「描く」「今日の分は終わり。」「先生が見ています…」「点数はつけません。言葉で見ます」「前のレッスンを終えると開きます」。「うまい／へた」「✕」を使わない。

## 8. 実装メモ
- 数字は必ず `font-family: var(--font-mono)`。`font-variant-numeric: tabular-nums` も併用
- 主ボタンの文字は ink（白にしない）
- 良い点カードの色は score-good 系（青緑）で、若葉とは分ける
- ダークでも今回は「描く紙」を暗くする（原本の指定）。将来切替設定を足してもよい

## 実装で調整したこと（レビュー反映 2026-09-24）
- コントラスト: `--color-accent-text` を #3F7329 に、小さい危険文字用に `--color-danger-text` を追加（§1 表）。12〜14px の注記・補助文字（点数の注記、自己ベスト、カウンター単位、行の説明、XP、枚数・容量、接続テスト、ストレージ注記、批評の注記など）は ink-3 から ink-2 へ。ink-3 はロック状態・アイコン・無効表示にだけ使う。
- 指の当たり判定 48: 見た目はそのまま、`::after`（または `::before`）で当たり判定を広げる。セグメント 40/36、フィルタピル 40、小ボタン 40（「別の角度」「正面に戻す」など）は上下に、ステッパー 44 は周囲 2px、トグル 56×32 は周囲 8px。スライダーは要素の高さ 48（溝 6 のまま）。
