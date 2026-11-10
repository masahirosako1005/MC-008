# 11. 連携サーバーの本番運用（ビルド・起動・アカウント・TLS・バックアップ）

店舗CMS と利用者アプリをつなぐ連携サーバー（docs/09 §7.3）を、デモの PC ではなく本番として動かすための手順。
技術は TypeScript＋Node 標準（`node:http`／`node:https`・`node:sqlite`。依存パッケージなし＝U1）。ホスティング先は未決（§7）。
2026-11-09 作成。

---

## 1. 構成

```
利用者（スマホ）──https──▶ 公開の面（app.example.jp）     ：利用者アプリの画面 ＋ 公開 API（スナップショット・SSE）
店舗・運営者（PC）──https──▶ CMS の面（admin.example.jp）  ：店舗CMS の画面 ＋ 公開 API ＋ 店舗CMS の API ＋ ログインの API
                                     └── 1つの Node プロセス（ポート2つ）── SQLite（登録内容・変更履歴・アカウント・セッション）
```

- CMS は利用者アプリと**別のオリジン**に置く（docs/09 §7.1、SEC-04・SEC-07）。`--cms-port` で同じプロセスが2つのポートで待ち受け、
  公開の面には店舗CMS・ログインの API を出さない（統合テストで確認）。
- ログイン：ID とパスワード。パスワードは scrypt（N=2^15・r=8・p=3）でハッシュ化。セッションは HttpOnly・SameSite=Strict・Secure（https）の
  Cookie `cms_session`（Path=/api）。有効期限はログインから 12 時間、最後の操作から 60 分。
  同じ ID＋同じ相手（IP）で失敗が 5 回続くと 15 分ロック（CMS-A06。ほかの相手＝本人は入れる。失敗の応答は理由によらず同じ 401 と同じ文）。
- 権限：運営者（operator）はすべての店舗とアカウント管理、店舗（shopOwner）は担当する店舗だけ。道筋の店舗ID は信用せず、
  セッションの担当店舗と照らし合わせる（SEC-01、SEC-03）。
- 本番の版（`--mode demo` なしでビルド）には、デモの日付・デモのログイン・デモのやり直しの API が入らない。

## 2. ビルド

```bash
npm ci
npm run build:backend -- --app-origin https://app.example.jp [--app-backend server]
```

- `--app-backend server`：利用者データのサーバー（`DATABASE_URL`。docs/12）を使う本番で付ける。付けないと、アプリの記録は端末の localStorage が正の版になる（改ざんを防げない＝SEC-21。ビルド時に注意が出る）。

| 出力 | 中身 |
|---|---|
| `dist-server/serverMain.mjs` | 連携サーバー（本番の版） |
| `dist/` | 利用者アプリ（連携サーバーの公開スナップショットを受け取る版。`cms.html` は入らない） |
| `dist-cms/` | 店舗CMS（`index.html` として配る。`--app-origin` が「アプリを開く」のリンク先） |

- 個別に作るときは `npm run server:build:prod`、`VITE_CMS_BACKEND=server vite build`、`npm run build:cms`。
- デモ用（同じオリジン・デモの API あり）は従来どおり `npm run demo:backend`。

## 3. 起動

```bash
node dist-server/serverMain.mjs \
  --host 127.0.0.1 --port 8787 --cms-port 8788 \
  --static dist --cms-static dist-cms --master public/master \
  --db /var/lib/kayoimachi/cms.sqlite \
  --trust-proxy --allowed-hosts app.example.jp,admin.example.jp
```

| オプション | 環境変数 | 内容 | 既定 |
|---|---|---|---|
| `--host` | `HOST` | 待ち受けるアドレス。自分の PC 以外に出すときは TLS か `--trust-proxy` が必須（無ければ起動しない） | `127.0.0.1` |
| `--port` | `PORT` | 公開の面のポート | `8787` |
| `--cms-port` | `CMS_PORT` | CMS の面のポート（省略すると公開の面と同じオリジンに CMS も出す） | なし |
| `--static` | `STATIC_DIR` | 利用者アプリの画面のフォルダ | なし（API だけ） |
| `--cms-static` | `CMS_STATIC_DIR` | 店舗CMS の画面のフォルダ | なし |
| `--master` | `MASTER_DIR` | 静的マスタ（`public/master`） | `public/master` |
| `--db` | `DB_PATH` | SQLite のファイル（フォルダは自動で作る） | `.data/cms-demo.sqlite` |
| `--tls-cert` / `--tls-key` | `TLS_CERT` / `TLS_KEY` | PEM の証明書と鍵。両方で https。名前でつなぐ相手には HSTS を付ける | なし |
| `--trust-proxy` | `TRUST_PROXY=1` | TLS を終端する中継の後ろで動かす。`X-Forwarded-For`（回数制限の鍵。**右端から数える**＝左端は相手が書けるため）と `X-Forwarded-Proto`（Cookie の Secure。`http` と明示されたときだけ外す）を信じる。中継の後ろではデモのログインは使えない | なし |
| `--proxy-hops` | `PROXY_HOPS` | 信頼する中継の段数（`X-Forwarded-For` の右端から何番目を相手とみなすか）。中継が1段なら 1 | `1` |
| `--allowed-hosts` | `ALLOWED_HOSTS` | 受け付けるホスト名（`,` 区切り）。localhost と IP アドレス以外はここに無いと 403（DNS リバインディング対策） | なし |

- コマンドラインが環境変数より優先する。
- 中継（nginx・Caddy・クラウドのロードバランサ）が TLS を終端するときは `--trust-proxy`。中継が無いときは `--tls-cert/--tls-key`。
  **中継が無いのに `--trust-proxy` を付けない**（相手が IP を偽って回数制限をすり抜けられる）。中継の後ろで平文で待ち受けるときは、
  そのポートに中継以外から届かないこと（ファイアウォール・内部ネットワーク）を確かめる（起動時に警告が出る）。
- `--host 0.0.0.0` は、中継が別のホスト・コンテナにあるときだけ使う。そのときは、このポートに中継以外から届かないようにする（Docker なら `-p 127.0.0.1:8787:8787` か内部ネットワーク。`-p 8787:8787` は全インターフェイスに出て、ufw などのファイアウォールも通り抜ける）。
- `--proxy-hops` は実際の中継の段数と同じにする（多いと全員が同じ相手とみなされ、1人が回数制限を使い切ると全員が止まる）。
- 利用者データの PostgreSQL は環境変数 `DATABASE_URL` だけで渡す（パスワードを含むのでコマンドラインでは受け付けない）。自分の PC 以外の DB には `--database-ssl`（`DATABASE_SSL=1`）が必須（無ければ起動しない。証明書も検証する）。
- `--mock-login`（開発用ログイン）は本番の版では起動を断る。
- サーバー自身の守り：ヘッダー 10 秒・要求全体 15 秒で切る、同時のつながりは待ち受けごとに 1,000 本まで。取りこぼした失敗（unhandledRejection など）は記録して終了コード 1 で止まるので、`Restart=on-failure`／`--restart` で起こし直す。
- 動作確認：`GET /api/health` → `{ ok: true, value: { status: 'ok', dbId: '…', snapshotVersion: 0 } }`（本番の版はモードと SSE の本数を出さない）。

### 3.1 中継の例（nginx）

```nginx
server {
  listen 443 ssl; server_name admin.example.jp;
  ssl_protocols TLSv1.2 TLSv1.3; client_max_body_size 32k;
  limit_req zone=cms burst=40 nodelay;   # http の段に limit_req_zone $binary_remote_addr zone=cms:10m rate=20r/s; を書く
  location / { proxy_pass http://127.0.0.1:8788; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto https; }
}
server { listen 80; server_name admin.example.jp app.example.jp; return 301 https://$host$request_uri; }
server {
  listen 443 ssl; server_name app.example.jp;
  ssl_protocols TLSv1.2 TLSv1.3; client_max_body_size 32k;
  location / { proxy_pass http://127.0.0.1:8787; proxy_http_version 1.1; proxy_set_header Connection ""; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto https;
               proxy_buffering off; proxy_read_timeout 1h; }   # SSE（/api/public/cms-snapshot/stream）のため
}
```

### 3.2 systemd の例

```ini
[Service]
ExecStart=/usr/bin/node /opt/kayoimachi/dist-server/serverMain.mjs
WorkingDirectory=/opt/kayoimachi
Environment=HOST=127.0.0.1 PORT=8787 CMS_PORT=8788 STATIC_DIR=dist CMS_STATIC_DIR=dist-cms DB_PATH=/var/lib/kayoimachi/cms.sqlite TRUST_PROXY=1 ALLOWED_HOSTS=app.example.jp,admin.example.jp
# 秘密（DATABASE_URL、OIDC_*_CLIENT_SECRET）は 0600 のファイルから渡す（ユニットのファイルや Environment= には書かない）
EnvironmentFile=/etc/kayoimachi/secrets.env
Restart=on-failure
User=kayoimachi
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/kayoimachi
PrivateTmp=yes
ProtectHome=yes
CapabilityBoundingSet=
```

ログは標準出力（1行1件。info 以上）。journald などで保持する。ログに位置座標・トークン・パスワード・メールは出ない（SEC-25）。

## 4. アカウント

最初の運営者はサーバーを動かす PC のコマンドラインで作る。以後は運営者が CMS の「アカウント」で店舗のアカウントを作る。

```bash
# パスワードは実行後に「新しいパスワード:」と聞かれるので、画面に映らない入力で打つ（引数・環境変数には書かない＝シェルの履歴に残さない）
node dist-server/serverMain.mjs account create --login operator1 --name 運営者 --role operator --db /var/lib/kayoimachi/cms.sqlite
node dist-server/serverMain.mjs account list --db /var/lib/kayoimachi/cms.sqlite
node dist-server/serverMain.mjs account set-password --login shop.a --db ...
node dist-server/serverMain.mjs account suspend --login shop.a --db ...     # resume で再開
```

自動化（CI・プロビジョニング）で入力できないときだけ、環境変数 `CMS_ACCOUNT_PASSWORD` で渡す（秘密管理の仕組みから渡し、コマンド行に直接書かない）。

| 決まり | 値 |
|---|---|
| ID | 英小文字・数字・`. _ @ -`、3〜64 字（大文字は小文字にそろえる） |
| パスワード | 10〜128 字（コードポイント）。制御文字・空白だけは不可 |
| 店舗のアカウントの担当店舗 | 1〜20 店（運営者は全店舗） |
| 停止 | 停止するとそのアカウントのセッションはすべて切れる。掲載中の内容は残る（CMS-A07） |
| パスワードの作り直し | 運営者が CMS で作り、1回だけ表示して本人に渡す。そのアカウントのセッションはすべて切れる |
| 自分のパスワードの変更 | 今のパスワードを確かめる。ほかの端末のセッションは切れる |

記録：ログイン・失敗・ロック・ログアウト・パスワード変更・アカウントの作成と変更は `cms_auth_log` に残る（操作者はアカウントID。IP・パスワード・メールは残さない＝SEC-24・SEC-25）。保持期間は3年（仮）で、サーバーが10分ごとに古いものを消す。

## 5. バックアップと復元

- DB は1ファイル（WAL モード。`cms.sqlite` のほかに `-wal`・`-shm` ができる）。
- 日次バックアップ：`sqlite3 /var/lib/kayoimachi/cms.sqlite ".backup '/backup/cms-$(date +%F).sqlite'"`（動かしたまま取れる）。
  `sqlite3` が無ければ、サーバーを止めて3ファイルをコピーする。
- バックアップにはパスワードのハッシュとセッションの記録が入る。置き場所は 0600・暗号化し、DB のファイルと同じ人だけが読めるようにする。
- 復元：サーバーを止め、ファイルを戻して起動する。形の版（`PRAGMA user_version`）が古ければ起動時に自動で進める。新しすぎれば起動しない。
- マスタ（`public/master`）はリリース単位で変わる。DB の登録内容はマスタのスポットID を指すので、ID を変えるマスタの更新はしない。

## 6. 日々の確認

| 確認 | 方法 |
|---|---|
| 生きているか | `GET /api/health`（`snapshotVersion`・`streams` も見える） |
| 証明書の期限 | 中継側で管理。自前の TLS なら `--tls-cert` の有効期限 |
| ログイン失敗の多発 | `cms_auth_log` の `login.failed`・`login.locked`・`login.rateLimited` |
| 依存の脆弱性 | `npm audit --audit-level=high`（実行時の依存はフォント1つ＝LINE Seed JP だけ。サーバーのファイルには pg がまとめて入っているので、pg の修正が出たらビルドし直して入れ替える） |
| 監査 | docs/07 の手順。記録は `docs/audit/` |

## 7. ホスティング（未決。docs/09 U1）

要件：Node 24 以上（`node:sqlite`）、常時起動、永続ディスク（SQLite）、ポート2つ（または中継で2ホスト名）、https。

| 候補 | 向き不向き |
|---|---|
| 社内の VM＋nginx／Caddy | 社内の制約に合わせやすい。バックアップは cron。今の設計のまま動く |
| コンテナ（Docker。ルートの `Dockerfile`） | 移しやすい。DB のボリュームを永続化すること |
| マネージドの PaaS（永続ディスクつき） | 運用が軽い。SQLite の1ファイルがそのまま使えるものを選ぶ |

SQLite のままでよい規模：店舗 66・運営者と店舗の担当者 100 人程度・書き込みは1分に数十回まで。これを超えるなら DB の差し替え（リポジトリ IF 経由）を検討する。

## 8. まだ無いもの

- 2要素認証（CMS-A05。運営者は必須の要件）。ログインの土台はできたので、TOTP を次に足す
- パスワード再設定のメール（CMS-A03・A04）。今は運営者が作り直して本人に渡す
- 参加申請と承認（CMS-A01・A02・O01）、掲載確認（CMS-E05・O04）、変更履歴の画面（CMS-S10・O09）
- 利用者アプリのデータ（訪問・ポイント・ランキング）のサーバー化（SEC-21。フェーズ3。docs/09 §8）
