# 06. データ完全性（Data Integrity）監査チェックリスト

データ完全性 = 「正しいデータだけが入り（妥当性）、入ったデータが壊れず（一貫性）、
同じ入力から同じ結果が得られ（再現性）、変更の履歴を追える（追跡性）」状態。
本アプリの核となる「訪問 → 加点 → 地区成長／色あせ → ランキング」は、
日付と位置に依存するため、**時刻と位置の扱い**を特に厳格にする。

判定欄: ○/△/×/－。監査記録は `docs/audit/YYYYMMDD_integrity.md` に本表をコピーして記入。

---

## 1. チェックリスト

| ID | 観点 | 確認項目 | 本プロジェクトでの具体策 | 確認方法 | 判定 |
|---|---|---|---|---|---|
| DI-01 | 境界検証 | 外部データ（JSON・URL・Storage・入力）は domain 型へ変換する前に検証される | パース関数 `parseXxx(unknown): Result<Xxx>` を infrastructure/presentation に置き、domain は検証済み型のみ受ける | `as` キャスト検索、スキーマ検証の有無 | |
| DI-02 | 不変条件 | エンティティ／値オブジェクトは不正状態を生成できない | コンストラクタ private＋ファクトリで検証（`Points` は 0 以上整数、`GeoPoint` は緯度経度範囲、`Period` は開始≦終了） | 単体テストに不正値ケースがある | |
| DI-03 | 時刻の単一ソース | 現在時刻は `Clock` ポート経由のみ | `Date.now()`/`new Date()` は `infrastructure/time` と `Common/utils/date` のみ許可 | `static-audit.mjs` の `date-now` | |
| DI-04 | 時刻の保存形式 | 日時は UTC ISO 8601 で保存、表示時に JST 変換。日付境界（色あせ・1日1回）は JST の暦日で判定 | `LocalDate.fromInstant(instant, 'Asia/Tokyo')` を使う | レビュー・境界テスト（23:59→00:00） | |
| DI-05 | 決定論 | 色あせ度・建物数・次に訪れる理由は「状態＋時刻」から再計算できる純粋関数 | `FadePolicy.stateFor(lastVisit, today)`。保存値に頼らず毎回算出 | 同一入力テスト | |
| DI-06 | 台帳の追記専用 | ポイントは残高を直接更新せず、`LedgerEntry` の追記で表現。残高は導出 | `PointLedger.append(entry)` のみ。`setBalance` を作らない | コード検索 | |
| DI-07 | 冪等性 | 書込み系ユースケースは同じ操作 ID で再実行しても結果が変わらない | 入力に `operationId`（UUID）を含め、処理済み ID を保持して重複を無視 | 二重送信テスト | |
| DI-08 | 業務一意性 | 「同一スポットの訪問は 1 日 1 回加点」などの一意制約が永続化層でも保証される | 一意キー `(travelerId, spotId, localDate)`。サーバ導入時は DB の UNIQUE 制約 | 制約定義の確認 | |
| DI-09 | 期限・使用回数 | クーポン・イベントの期限と使用回数は Clock と台帳で判定し、クライアント表示値を信用しない | `Coupon.redeem(now)` が期限・使用済みを検証 | テスト | |
| DI-10 | 楽観ロック | 複数端末・複数ユーザが触る集約（地区の主・ランキング）は version で競合検出 | `save(aggregate, expectedVersion)` が不一致なら `CONFLICT` を返す | 競合テスト | |
| DI-11 | トランザクション境界 | 1 ユースケース = 1 集約更新を原則。複数集約はドメインイベントで結果整合 | 訪問→加点→地区更新をイベント連鎖で実装し、途中失敗でも訪問記録は残る設計を文書化 | レビュー | |
| DI-12 | 部分更新の禁止 | 失敗時に中途半端な状態を残さない（OWASP A10） | 検証→計算→保存の順で、保存は最後に 1 回。失敗は `Result` で返す | 例外注入テスト | |
| DI-13 | マスタ完全性 | 地区 5・名所 14・店舗 66 の件数、ID 一意、参照整合（店舗→地区 ID）をロード時に検証 | `MasterDataLoader` が JSON Schema＋件数＋外部キー検証。失敗時は起動中止 | 改変 JSON テスト | |
| DI-14 | 入力妥当性（位置） | 位置は物理的に妥当か（前回位置からの速度、精度 accuracy） | 連続訪問間の移動速度が閾値（例 30 km/h 徒歩想定で調整）超なら保留。accuracy > 100m は訪問不可 | テスト | |
| DI-15 | スキーマバージョン | 保存データ（localStorage/IndexedDB）に `schemaVersion` を持ち、マイグレーションで更新 | `infrastructure/storage/schema/migrations.ts`。未知バージョンは読み込まずバックアップ | 旧データ読込テスト | |
| DI-16 | 参照整合性 | 訪問記録が参照するスポット ID・地区 ID がマスタに存在する | ロード時に孤立参照を検出し `warn` ログ＋表示除外 | テスト | |
| DI-17 | 文字データ | ニックネーム・投稿は Unicode 正規化（NFC）、長さ制限（文字数で判定）、制御文字除去 | `PostText.of()` で実施 | テスト（絵文字・結合文字） | |
| DI-18 | 数値 | ポイント・距離・スコアは整数または固定小数。浮動小数の累積誤差を避ける | 距離は m を整数に丸めて判定、ポイントは整数のみ | レビュー | |
| DI-19 | 順序・重複（イベント） | ドメインイベントは `eventId`・`occurredAt`・`sequence` を持ち、購読側は重複を無視 | `InMemoryEventBus` が ID で重複排除 | テスト | |
| DI-20 | 監査証跡 | 加点・地区の主交代・デモ操作は「いつ・誰が・何を」記録される | `info` ログ＋台帳。デモ操作は `warn` で明示 | ログ確認 | |
| DI-21 | バックアップ・復元 | 保存データのエクスポート／インポート（デモ・障害復旧用） | 設定画面に JSON エクスポート。インポート時はスキーマ検証 | 操作確認 | |
| DI-22 | 削除方針 | 論理削除／物理削除の方針を集約ごとに決めている | 投稿は論理削除（`deletedAt`）、個人データ削除要求は物理削除 | 設計書確認 | |
| DI-23 | デモと本番の分離 | `DemoClock`／`SeededRandomSource` が本番データに影響しない | デモモードは別ストレージ名前空間（`nnishi.demo.*`） | 実装確認 | |
| DI-24 | ランキングの一貫性 | ランキングは一時点のスナップショットから算出し、計算中の更新が混ざらない | `Ranking.from(snapshot, asOf)` | レビュー | |
| DI-25 | テスト | DI-02/04/05/07/09/10/14 に対応する単体テストが存在し CI で実行される | `*.test.ts` の有無 | テスト一覧 | |

---

## 2. データライフサイクル表（実装時に埋める）

| データ | 発生元 | 検証（DI-01） | 保存先 | 保持期間 | 削除方法 | 個人情報 |
|---|---|---|---|---|---|---|
| 訪問記録 | VisitSpotUseCase | スポットID存在・距離・1日1回 | TravelerRepository | 利用中 | 全削除機能 | 準（行動履歴） |
| ポイント台帳 | 各加点ユースケース | 整数・正値・operationId 一意 | PointLedgerRepository | 利用中 | 全削除機能 | 準 |
| 地区状態 | RecalculateFadeUseCase | 導出値（保存しない or キャッシュ） | — | — | — | なし |
| 投稿 | PostSpotUseCase | NFC・長さ・制御文字 | PostRepository | 削除まで | 論理削除 | あり（本文） |
| 設定（文字拡大） | SettingsScreen | 列挙値 | localStorage | 利用中 | 初期化 | なし |
| マスタ | public/master | スキーマ・件数・参照 | 読み取り専用 | リリース単位 | — | なし |

---

## 3. 典型的な違反例と修正方針（AI 向けヒント）

| 違反 | 修正 |
|---|---|
| `traveler.points += 10` | `ledger.append(LedgerEntry.visit(spotId, Points.of(10), operationId))` |
| `if (new Date() > coupon.expiresAt)` | `coupon.isExpired(clock.now())` |
| `const data = JSON.parse(raw) as Traveler` | `const result = parseTraveler(JSON.parse(raw)); if (!result.ok) ...` |
| 色あせ度を保存して毎日更新 | 最終訪問日だけ保存し、表示時に `FadePolicy` で算出 |
| 訪問・加点・地区更新を 1 関数で順に保存 | 訪問保存→`SpotVisited` 発行→購読側で加点・地区更新 |
