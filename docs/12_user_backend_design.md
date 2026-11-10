# 12. 利用者データのサーバー（商用版バックエンド）設計

利用者アプリ「まちクエ」の訪問・EXP・ランキング・領主・アバターを、端末の localStorage からサーバーへ移す（SEC-21、docs/09 §8 フェーズ3 の前提）。
2026-11-10 作成。ユーザーの決定と、それに基づく設計・進め方・未決事項をまとめる。実装が進んだら §7 の状況を更新する。

---

## 1. ユーザーの決定（2026-11-10）

| 項目 | 決定 | 影響 |
|---|---|---|
| 着手範囲 | 利用者データのサーバー化から始める | 店舗CMS の残り（2要素認証・参加申請など）は docs/11 §8 のまま後続 |
| DB | PostgreSQL に移行 | 実行時の依存に `pg` が1つ増える（docs/09 U1「依存パッケージなし」の変更）。店舗CMS の SQLite は §6 の段階5で PostgreSQL へ寄せる |
| 利用者の認証 | 外部ログイン（LINE・Google など） | パスワードは持たない。各社への登録（チャネル／クライアントの発行）が要る（§8） |

## 2. 方針

1. **サーバーが正**（SEC-21）。端末が送るのは「このスポットを訪問したい（位置・精度・操作ID）」という意図だけ。距離の判定・1日1回・EXP・カード・領主はサーバーが計算する。端末が送った EXP や回数は受け取らない。
2. **domain を共有する**。`Traveler.visit`・`PointLedger`・`VisitRewardPolicy` などは今のコードをそのままサーバーで動かす（店舗CMS の `HttpCmsServices` と同じやり方）。規則を2か所に書かない。
3. **失う体験を作らない**（CLAUDE.md §5）。訪問・発見・クーポン利用・台帳の表は追記だけ。DB のトリガーが UPDATE を拒否する。
4. **座標を残さない**（PRV-03、SEC-13）。位置は判定に使ったら捨てる。保存するのはスポットID・地区ID・日時・暦日だけ。ログにも出さない。
5. **集めない**（PRV-06）。外部ログインから受け取るのは「提供元＋その中での利用者ID（sub）」だけ。メール・氏名・写真は要求も保存もしない。
6. 層の規則（01）、JSDoc・ロガー（04）、Result（03）、静的監査（07）は今までどおり。

## 3. 全体の構成

```
利用者（スマホ）──https──▶ 公開の面 app.<ドメイン>
                              ├ 画面（dist）
                              ├ 公開 API（スナップショット・SSE）            … 既存
                              └ 利用者 API /api/app/*（ログイン・訪問・ランキング） … 新規
                                   │  application のユースケース（アプリと同じコード）
                                   ▼
                              PostgreSQL（旅人・台帳・利用者・セッション）   … 新規
店舗・運営者（PC）──https──▶ CMS の面 admin.<ドメイン>（既存。当面 SQLite → 段階5で PostgreSQL）
```

- 利用者アプリの切り替えはビルド時 `VITE_APP_BACKEND=server`（既定は今までどおり localStorage。デモ・発表用の 5173 は変えない）。
- アプリ側は、書き込み系（発見・訪問・購入・チケット）をサーバーの API を呼ぶユースケース（`infrastructure/api/HttpPlayUseCase`）に、旅人と台帳のリポジトリを「サーバーの記録の写しを読むだけ」のもの（`ServerPlayRepositories`）に差し替える。読み取り系のユースケースは変えない。応答に含めたドメインイベントを端末の EventBus に流して演出を出す。
- サーバーを複数台にできるよう、状態はすべて PostgreSQL に置く（プロセスの中に持たない）。

## 4. データベース

### 4.1 接続と形の版（実装済み）

| ファイル（`src/infrastructure/server/pg/`） | 役割 |
|---|---|
| `SqlClient.ts` | 問い合わせの IF。リポジトリはこれだけを使う |
| `PgSqlClient.ts` | 本番：`pg` の接続プール（文ごとの時間切れ 10 秒、プール 10 本、TLS は証明書を検証） |
| `testing/PgliteSqlClient.ts` | テスト：PGlite（WASM 版の PostgreSQL をメモリ上で動かす。PostgreSQL・Docker が無い PC でも本番と同じ SQL を試験できる） |
| `migrations.ts` | 形の版（`schema_migrations`）。起動時に `migrate()`。DDL もトランザクションの中で、複数台の同時起動はアドバイザリロックで直列にする。DB のほうが新しければ起動しない（DI-15） |
| `pgSql.ts` | 日時を文字列で読む式（ドライバーの Date 変換に頼らない＝DI-04）、増えた行だけを足す `appendNewRows` |

- 値は必ずプレースホルダーで渡す（SEC-08）。接続文字列は環境変数 `DATABASE_URL`（秘密管理の仕組みから。ログに出さない）。
- 出した版の SQL は書き換えない。変更は次の版として足す。

### 4.2 表

| 版 | 表 | 中身 | 主な制約 | 状況 |
|---|---|---|---|---|
| 1 | `travelers` | 旅人ID・表示名・プロフィール・版数 | 版数で楽観ロック（DI-10） | 済 |
| 1 | `traveler_discoveries` | 発見 | UNIQUE(旅人, スポット)。更新不可 | 済 |
| 1 | `traveler_visits` | 訪問（スポット・地区・日時・JST の暦日・操作ID） | UNIQUE(旅人, スポット, 暦日)＝1日1回（DI-08）、UNIQUE(旅人, 操作ID)＝二重送信（DI-07）。更新不可 | 済 |
| 1 | `traveler_redemptions` | クーポン利用 | UNIQUE(旅人, クーポン)。更新不可 | 済 |
| 1 | `traveler_operations` | 処理済みの操作ID（直近 500 件） | UNIQUE(旅人, 操作ID) | 済 |
| 1 | `point_ledgers`・`ledger_entries` | ポイント台帳（残高の列は持たない＝DI-06） | UNIQUE(旅人, 行ID)、points >= 0、種類は visit・welcomeBack・purchase。更新不可 | 済 |
| 2 | `app_users` | 利用者（内部ID・旅人ID・作成日時・最終利用） | 旅人ID は UNIQUE | 済 |
| 2 | `app_user_identities` | 外部ログインとの対応（提供元・sub） | UNIQUE(提供元, sub) | 済 |
| 2 | `app_sessions` | セッション（トークンは SHA-256 のハッシュで保存） | 期限・無操作の時間切れ | 済 |
| 2 | `app_login_states` | ログイン途中の state・nonce・PKCE（10分で失効） | 1回だけ使える | 済 |
| 3 | `avatar_outfits` | 選んだ装い（手に入れた部品は訪問から導出するので保存しない） | 旅人ごとに1行 | 段階3 |
| 3 | `league_rewards` | 月末の順位報酬・キープ報酬（追記だけ） | UNIQUE(旅人, 月, リーグ, 種類) | 段階3 |

- 領主（直近30日の最多）とランキング（月間）は `traveler_visits` から計算する（索引：地区×暦日、スポット×暦日、暦日）。保存値を別に持たない（DI-05）。重くなったら月次の集計表を足す。
- 来訪データ（docs/09 §2.5）も同じ表から集計値だけを出す（5人未満は伏せる＝U4）。

### 4.3 リポジトリ（実装済み）

`PgTravelerRepository`・`PgPointLedgerRepository` は domain のリポジトリ IF をそのまま実装する。

- 読込：1回の問い合わせで保存形の JSON を組み立て、`Traveler.restore`／`PointLedger.restore` で検証する（DI-01）。
- 保存：1トランザクションで「版数を進める（合わなければ CONFLICT）→ 増えた行だけ足す → 件数を照合」。食い違い・制約違反は ROLLBACK して STORAGE_FAILED（DI-12）。
- 削除：物理削除（PRV-05、DI-22）。記録の表は外部キーの CASCADE で一緒に消える。

## 5. 認証（段階1）

- 方式：OpenID Connect の認可コード＋PKCE。サーバーが相手（LINE・Google）とやり取りし、端末には提供元のトークンを渡さない。
- 流れ：`GET /api/app/auth/<提供元>/start`（state・nonce・PKCE を作って相手へ）→ 相手で同意 → `GET /api/app/auth/<提供元>/callback`（state の照合、コードの交換、ID トークンの検証＝発行者・宛先・期限・nonce・署名）→ 利用者を探す／作る → セッションの Cookie を出してアプリへ戻す。
- セッション：推測できない乱数のトークン。DB にはハッシュだけ。Cookie `app_session` は HttpOnly・Secure・SameSite=Strict・Path=/api。期限は 30日・無操作 14日（仮）。書き込み系は Origin も照合する（SEC-28）。
- 提供元の追加は設定（発行者・クライアントID・秘密）で行い、コードを提供元ごとに分けない。秘密は環境変数（`OIDC_<提供元>_CLIENT_SECRET`）で渡す。
- 回数制限：ログインの開始・コールバックは相手（IP）ごと、API は利用者ごと（SEC-18）。
- 店舗CMS のログイン（ID＋パスワード、Cookie `cms_session`）とは表も Cookie も別。CMS の面には利用者 API を出さない。

## 6. API と段階

`/api/app/*`。応答は今までと同じ `{ ok, value }`／`{ ok:false, error }`。

| 段階 | 内容 | API | 完了の条件 |
|---|---|---|---|
| **0 土台** | PostgreSQL の接続・形の版・旅人と台帳のリポジトリ | — | テスト（PGlite）・型・静的監査が通る |
| **1 ログイン** | 利用者・外部ログイン・セッション、`DATABASE_URL` の起動オプション、`/api/health` に DB の疎通 | `auth/providers`・`auth/<提供元>/start`・`callback`・`auth/logout`・`me` | にせの提供元を立てた統合テスト、実物の LINE／Google で通し確認 |
| **2 訪問** | 発見・訪問・購入・チケットをサーバーで実行。訪問と加点を1トランザクションに。速度の妥当性（DI-14）。アプリをサーバーにつなぐ版へ切り替え | `POST discoveries`・`visits`・`purchases`・`tickets/use`・`GET state` | 端末のデータを書き換えても EXP が増えないこと（SEC-21 の確認方法）。二重送信・競合・日付境界のテスト |
| **3 競争と装い** | 領主・ランキングを実際の利用者から計算（ダミーの20人は本番で外す）。月末の報酬。装いの保存 | `GET lords`・`GET ranking`・`PUT avatar` | 月をまたぐテスト、同時に訪問しても順位が食い違わない（DI-24） |
| **4 個人データと運用** | 書き出し・退会（全削除）、プライバシーポリシー、監視・アラート、バックアップと復元の訓練、負荷試験、不正の検知（速度・回数の異常を保留にする） | `GET export`・`DELETE me` | docs/05・06 の監査表を商用版として埋める |
| **5 店舗CMS の統合** | 店舗CMS のデータ・ログインを PostgreSQL へ。SSE の通知を LISTEN/NOTIFY に。複数台構成。来訪データを実データに（docs/09 フェーズ3） | 既存 API のまま | SQLite を使わずに全テストが通る |

GPS のなりすましは位置を端末が申告する以上なくせない。段階2の速度の妥当性と回数制限、段階4の異常検知、店頭 QR（docs/09 §2.4）で「割に合わない」ようにする。

## 7. 状況

### 段階0（2026-11-10 完了）

- 追加：`src/infrastructure/server/pg/`（§4.1・§4.3 のファイル）と `pgRepositories.test.ts`（17件。形の版、楽観ロック、増えた行だけ足す、UNIQUE、更新の拒否、失敗時に何も残さない、壊れた行、削除）。
- 依存：`pg`（実行時）、`@types/pg`・`@electric-sql/pglite`（開発時）。`npm audit` 0 件。
- 確認：`vitest`（pg のテスト 17件）・`tsc --noEmit`・`static-audit`（error 0）。`pg` を含めてサーバーを1ファイルにまとめられること（`ssr.noExternal`）と、つながらない DB で `migrate()` が STORAGE_FAILED を返すことを確認。
- **未確認**：本物の PostgreSQL サーバーへ `PgSqlClient` でつなぐ試験（この PC に PostgreSQL・Docker が無い）。段階1で接続先が決まったら、同じテストを `DATABASE_URL` 指定でも走らせる。
- （段階1でサーバーにつないだ。DB の指定が無ければ今までどおり動く。）

### 段階1 ログイン（2026-11-10。この PC でできる範囲は完了）

- 形の版 2（`app_users`・`app_user_identities`・`app_sessions`・`app_login_states`）。
- `src/infrastructure/server/app/`：`oidc/OidcClient`（認可コード＋PKCE、要求は openid だけ）、`oidc/idToken`（HS256／RS256／ES256 の検証を node:crypto だけで）、`AppAuthService`・`PgAppAuthStore`、`appSessionCookie`、`appAuthRoutes`。
- にせの提供元 `oidc/mockOidcProvider`（開発用ログイン。デモの版＋`--mock-login`＋この PC からの要求だけ）。LINE・Google の設定（`lineProvider`・`googleProvider`）は入れてあり、環境変数 `OIDC_LINE_CLIENT_ID`／`_SECRET`・`OIDC_GOOGLE_CLIENT_ID`／`_SECRET` を渡すと有効になる。
- 起動オプション：`--pglite-dir <フォルダ>`（この PC 用。PGlite をフォルダに保存）／環境変数 `DATABASE_URL`（本物の PostgreSQL。`--database-ssl`）、`--app-origin`、`--mock-login`。どちらの DB も指定しなければ利用者の API は出ない（今までどおり）。
- 組み立て：`infrastructure/di/appBackend.ts`・`openAppBackend.ts`。`serverContainer` は公開の面にだけ利用者の API を足す。
- **未確認**：実物の LINE・Google での通し確認（登録が要る＝B2）。LINE の ID トークンの署名方式（HS256 の想定）は、実物で確かめる。

### 段階2 訪問（2026-11-10。サーバー側・アプリ側とも、この PC でできる範囲は完了）

**サーバー側**

- `POST /api/app/discoveries`・`visits`・`purchases`・`tickets/use`、`GET /api/app/state`（`appPlayRoutes`、組み立ては `infrastructure/di/appPlay.ts`）。アプリと同じユースケース（DiscoverNearbySpots・VisitSpot・RecordPurchase・UseTicket と、訪問後の EvaluateDistrictChange・AwardVisitRewards）を要求ごとに組み立てて実行し、発行されたイベントを応答に入れる。
- 書き込みは旅人ごとに1つのトランザクション（`pg/ScopedSqlClient.atomically`）。訪問の保存の後で加点が失敗したら訪問ごと取り消すので、送り直せば訪問と EXP の両方が付く（DI-12）。旅人ごとのアドバイザリロックで、同じ旅人の同時の操作は順番になる。
- 移動の妥当性（DI-14。`visitPlausibility`）：訪問・購入・チケットは、前回訪問したスポットからの移動が時速30km（仮。domain の `isPlausibleMove`）を超える申告を `TOO_FAST` で断る。
  - 例外（この PC 用だけ）：`--demo-walk`（環境変数 `DEMO_WALK=1`）を付けると確かめない。地図タップの移動（デモの歩行。秒速20〜90m）は徒歩より速く、続けて2軒目をクエスト達成すると `TOO_FAST` で断られたため（2026-11-10 の正常系試験で発見）。開発用ログイン（デモの版＋`--mock-login`）を出しているときだけ効き、本番の版では効かない。`npm run serve:app-local` は付けて起動する。
- 旅人は初めての要求で作る（表示名は既定の「冒険者」）。

**アプリ側**（ビルド時 `VITE_APP_BACKEND=server`。既定は今までどおり localStorage）

- `infrastructure/api/ServerPlayState`（サーバーの記録の写し。起動時と書き込みの後に `/api/app/state` を読む）、`ServerPlayRepositories`（写しを読むだけの旅人・台帳・セッション。保存は必ず失敗＝アプリ側で記録や EXP を作れない）、`HttpPlayUseCase`（発見・訪問・購入・チケットを、現在地を添えてサーバーへ送り、返ってきたイベントを画面へ流す）。
- `di/container.ts`：`appBackend: 'server'` のとき上の部品に差し替える。地図・図鑑・ランクなどの読み取り系ユースケースは変えていない（写しを読む）。訪問後の処理は、領主の再判定だけを端末で行う（地区の変化と加点はサーバーのイベントで届く）。
- ログインしていなければコンテナが `UNAUTHENTICATED` を返し、`main.ts` がログインの画面（`presentation/screens/Login`。アプリ名と提供元のボタンだけ）を出す。
- 端末には旅人・台帳を保存しない。設定・装い・訪問の思い出・領主・ライバルは今までどおり端末（段階3・4 で移す）。

**残り**

- 店舗CMS で登録したクーポン・イベントの重ね合わせ（サーバーの訪問・チケットは今はマスタだけを見る）。
- 購入の裏付け（レジの QR の検証。今は「お店の近くにいること」と1日の上限だけ＝docs/09 U3・U6）。
- デモメニュー（日付を進める・旅人切替・ライバル行動）は、サーバーにつなぐ版ではサーバーの記録と食い違う（サーバーの時計は進まない）。この版では地図タップでの移動だけを使う。
- 途中でセッションが切れたときにログインの画面へ戻す導線（今は操作が「ログインしてください」で失敗する）。ログアウトのボタン。

### この PC での動かし方

```bash
npm run serve:app-local     # サーバー（デモの版）と、サーバーにつなぐ版のアプリをビルドして http://localhost:8787 に起動
```

1. ブラウザで `http://localhost:8787/` を開く → ログインの画面 →「開発用アカウントでログイン」→ テスト冒険者を選ぶ → アプリが開く。
2. 地図をタップして移動し、クエスト達成（チェックイン）すると、サーバーに記録される（`/api/app/state` で見える）。別のブラウザで同じテスト冒険者を選ぶと同じ記録が出る。
3. データは `.data/app-pg`（PGlite）に残る。フォルダを消せば初期化。`--port`・`--data` で変えられる（`scripts/dev/app-local.mjs`）。

### 確認（2026-11-10）

- `src/infrastructure/server`・`di` のテスト：PostgreSQL のリポジトリ 17、ID トークン 6、ログイン・訪問・購入・まとまり・移動の妥当性・アプリのコンテナとの統合 24 ほか。最後の全体実行で 1738 件すべて成功、静的監査 error 0、型チェックはエラーなし（途中の実行では、ほかの作業中のファイルによる失敗・エラーが一時的に出た）。
- `npm run serve:app-local` 相当で起動し、ヘッドレスの Edge で「ログインの画面 → 開発用ログイン → 地図が開く」を確認。端末の localStorage に旅人・台帳が無いことも確認。
- curl で、再起動後も同じ旅人ID で記録が残ることを確認。
- **未確認**：ブラウザの画面操作でのクエスト達成（コンテナとサーバーをつないだ統合テストでは確認済み）、本物の PostgreSQL、実物の LINE・Google。

## 8. 未決事項（ユーザーに決めてもらうこと）

| # | 項目 | 論点 | 要る時期 |
|---|---|---|---|
| B1 | ホスティングと PostgreSQL の置き場所 | **当面はローカル（自分の PC）で動かす**（2026-11-10 ユーザー決定）。クラウド（マネージド PostgreSQL 16 以上＋コンテナ）か社内 VM かは公開を決めるときに選ぶ。docs/11 §7 の候補を PostgreSQL 前提に見直す | 公開の前 |
| B2 | 外部ログインの登録 | LINE Developers のチャネル、Google Cloud の OAuth クライアント。どちらも事業者情報・同意画面・戻り先 URL（本番のドメイン）が要る。最初に出す提供元はどれか | 段階1の通し確認の前 |
| B3 | ログインを求めるタイミング | 案：地図・図鑑を見るだけならログインなし、クエスト達成（チェックイン）で初めて求める（A「初回満足度」を落とさない） | 段階2の前 |
| B4 | 本番のドメイン | `app.`／`admin.` の2つ。Cookie・戻り先 URL・許可するホスト名に使う | 段階1の通し確認の前 |
| B5 | 発表版のデータの扱い | 端末の localStorage の記録は商用版へ引き継がない（端末の値を信用しない＝SEC-21）でよいか | 段階2の前 |
| B6 | 保持期間と退会 | 退会で即時に物理削除。最後の利用から何年で自動削除するか | 段階4の前 |
| B7 | プライバシーポリシー・利用規約 | 位置情報の扱い・外部ログイン・店舗へ渡す集計値の記載（PRV-01・04・07）。法務の確認 | 公開の前 |
