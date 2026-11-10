# データ完全性監査 2026-11-10

- 対象コミット: 770887f（作業ツリーの未コミット分を含む。ほかのセッションが編集中の時点の読み取り）
- 監査者: AI（Claude Code のサブエージェント。ソース・テストは読むだけで、変更はこの記録の新規作成だけ）
- 範囲: (a) 端末版（localStorage）＝`src/infrastructure/storage/**`、`src/application/usecases/**`、`src/domain/**`、(b) サーバー版（PostgreSQL）＝`src/infrastructure/server/pg/**`、`src/infrastructure/server/app/**`、`src/infrastructure/di/appPlay.ts`・`appBackend.ts`、アプリ側の `src/infrastructure/api/ServerPlay*.ts`・`HttpPlayUseCase.ts`。店舗CMS（SQLite）は対象外
- 方法: `docs/06` の DI-01〜DI-25 を1項目ずつコードとテストで確認。欠陥の候補2件は、リポジトリの外に置いた一時テスト（プロジェクトのテスト用の偽物を使用）で再現を確かめた
- 自動チェック（主セッションの結果を転記。この監査では再実行していない）: `npx tsc --noEmit` エラー 0、`node scripts/audit/static-audit.mjs` error 0／warn 1、`npx vitest run` 177 ファイル・1735 件成功、E2E（`scripts/e2e/demo-scenario.mjs`）38 PASS
- この監査で実行したもの: `npx vitest run`（storage・server/pg・server/app/appBackend・usecases/exploration・usecases/reward・domain/exploration・domain/reward）→ 39 ファイル・447 件成功

判定: ○適合 / △一部 / ×不適合 / －対象外　　内訳: ○ 14 / △ 10 / × 1 / － 0

## 1. チェックリスト（docs/06 §1）

端末＝端末版、サーバー＝サーバー版。テスト名は「」で示す。

| ID | 判定 | 証跡 | 備考 |
|---|---|---|---|
| DI-01 | △ | 端末: `src/infrastructure/storage/schema/EnvelopeStore.ts:106`（JSON→封筒→版→中身の順に検証）、`schema/parsers.ts:51`、`src/domain/exploration/Traveler.ts:154`、`src/domain/reward/PointLedger.ts:138`、入力は `src/application/usecases/exploration/VisitSpotUseCase.ts:58`。サーバー: `src/infrastructure/server/pg/PgTravelerRepository.ts:150`、`src/infrastructure/server/app/appPlayRoutes.ts:73`、アプリ側 `src/infrastructure/api/ServerPlayState.ts:98`。テスト「中身が旅人として不正（改ざん）なら退避して STORAGE_FAILED（DI-01, SEC-21）」「壊れた行があれば読込は失敗する（DI-01）」 | 主な経路は○。残り: サーバーが返すドメインイベントは種類と eventId だけ見て型を付ける（`src/infrastructure/api/HttpPlayUseCase.ts:65`）→ 欠陥 #5。画面が直接持つキー（`map.purchases`・`map.prefs`）は封筒を通らない（自前の検証はある） |
| DI-02 | ○ | `src/domain/reward/Points.ts:45`、`src/domain/exploration/GeoPoint.ts:51`、`src/domain/revisit/Period.ts:20`・`:33`、`Traveler.ts:122`（private）、`PointLedger.ts:115`（private）、`src/domain/exploration/TravelerState.ts:182`。テスト「範囲外・非有限を INVALID_INPUT で拒否する（DI-02）」「開始 > 終了は INVALID_INPUT で拒否する（DI-02）」「安全な整数の範囲を超える合計は失敗にする（黙って丸めない）」 | 両系統とも同じ domain を使う |
| DI-03 | ○ | `scripts/audit/static-audit.mjs:186`（`date-now`）。`Date.now`／`new Date` は `src/infrastructure/time/SystemClock.ts:17`・`src/Common/utils/date.ts:170` と、判定に使わない2か所（`src/Common/logging/logger.ts:221`、`src/presentation/screens/Map/town/TicketWallet.ts:185`。どちらも audit-ignore の理由つき）だけ | サーバーは `SystemClock`（`src/infrastructure/di/serverContainer.ts:237`）。端末の時刻は受け取らない（`appPlayRoutes.ts:12`） |
| DI-04 | ○ | `src/Common/utils/date.ts:215`（JST 暦日）、`VisitSpotUseCase.ts:139`（Clock.now 1回から日時と暦日）、サーバー `src/infrastructure/server/pg/pgSql.ts:18`・`:27`（文字列化を SQL 側で行う）。テスト「JST 23:59:59.999（UTC 14:59:59.999）は同じ日」「JST 翌 0:00（UTC 15:00）は翌日になる」「JST 23:59 と翌 0:00 は別の日として両方記録できる（DI-04）」 | |
| DI-05 | ○ | `src/domain/town/FadePolicy.ts:90`、チケット・カード・アイテムも保存せず導出（`src/application/usecases/reward/tickets.ts:94`、`AwardVisitRewardsUseCase.ts:104`）。テスト「同じ入力には同じ出力を返す（DI-05）」 | |
| DI-06 | ○ | `PointLedger.ts:186`（追記だけ）・`:167`（残高は導出）。サーバー `src/infrastructure/server/pg/migrations.ts:95`〜`:108`（残高の列なし・UPDATE はトリガーで拒否）。テスト「残高を直接書き換える操作を持たない（setBalance 等が無い）」 | 端末版は localStorage を直接書き換えられる（SEC-21 のとおり）。サーバーの DELETE はトリガーで止めていない（物理削除のため） |
| DI-07 | ○ | `Traveler.ts:303`、`PointLedger.ts:193`、`VisitSpotUseCase.ts:117`、`src/application/usecases/reward/RecordPurchaseUseCase.ts:139`。サーバー `migrations.ts:63`・`:105`（UNIQUE）。テスト「同じ operationId を同時に2回送っても、保存と SpotVisited は1回だけ（DI-07）」「同じ操作ID の送り直しは二重に数えない。同じ日の2回目の訪問は断る」 | 画面は押すたびに新しい操作ID を作る（`src/presentation/screens/Map/MapScreen.ts:1073`・`:1212`）。応答が届かなかった後の押し直しは別の操作になる → 欠陥 #4（記録は1日1回・購入の上限で守られる） |
| DI-08 | ○ | 端末: `TravelerState.ts:185`、保存の直前にも検査 `src/infrastructure/storage/LocalStorageTravelerRepository.ts:59`。サーバー: `migrations.ts:62`（UNIQUE (traveler_id, spot_id, local_date)）。テスト「同じスポットの同じ日の訪問は UNIQUE 制約が拒否する（DI-08）」「同時に届いた2つの訪問（別の操作ID）でも、記録されるのは1回だけ」 | |
| DI-09 | ○ | `Traveler.ts:380`〜`:393`（クーポンか・期間・利用済み・距離）、`src/application/usecases/reward/UseTicketUseCase.ts:85`〜`:89`（獲得済みか・Clock）。サーバー `migrations.ts:77`（UNIQUE (traveler_id, shop_event_id)）。テスト「期限（クーポン期間の終わり）を過ぎたチケットは出さない」「お店から80m以内なら使用済みにして保存する。同じ operationId の再実行は duplicate=true（DI-07）」 | チェックリストの `Coupon.redeem` は実装では `Traveler.redeem` |
| DI-10 | ○ | 端末: `EnvelopeStore.ts:135`。サーバー: `PgTravelerRepository.ts:76`、`PgPointLedgerRepository.ts:45`、旅人ごとのロック `src/infrastructure/server/pg/ScopedSqlClient.ts:109`。テスト「保存済みの版数と expectedVersion が違えば CONFLICT で、保存内容は変わらない（DI-10）」「版数が合わなければ CONFLICT で、何も書かない」 | 訪問の加点（`AwardVisitRewardsUseCase.ts:65`）は競合しても読み直さない → 欠陥 #1。思い出・設定・セッションは版数を比べずに上書き → 欠陥 #6 |
| DI-11 | △ | 設計の記載 `docs/08_implementation_design.md:315`〜`:321`、購読の登録 `src/infrastructure/di/container.ts:190`、`src/infrastructure/events/InMemoryEventBus.ts:113` | 端末: 「途中で失敗しても訪問記録は残る」まで。失敗した購読をやり直す仕組みが無い → 欠陥 #1。サーバー: 結果整合ではなく1トランザクションにまとめている（`appPlayRoutes.ts:113`。チェックリストより強い） |
| DI-12 | △ | 端末: 各ユースケースは検証→計算→保存1回（`VisitSpotUseCase.ts:171`、`RecordPurchaseUseCase.ts:198`）。サーバー: `ScopedSqlClient.ts:104`、`src/infrastructure/di/appPlay.ts:140`（後続の失敗を数える）、`pgSql.ts:64`。テスト「保存に失敗したら STORAGE_FAILED を返し、イベントを発行しない。同じ操作をやり直すと成功する（DI-12）」「加点の保存が失敗したら訪問ごと取り消し、送り直すと訪問と EXP の両方が付く（DI-12）」 | サーバーは○。端末は訪問と台帳が別々の保存で、訪問だけ残る状態ができる → 欠陥 #1。旅人の新規作成も複数キーを順に書く → 欠陥 #8 |
| DI-13 | ○ | `src/infrastructure/master/masterValidators.ts:40`（地区 5・名所 14・店舗 66）。テスト「店舗を1件消すと件数違反で失敗する（T-07）」「スポット ID が重複していれば失敗する」「存在しない地区を参照するスポットは失敗する」「存在しないスポットを参照するクーポン・イベントは失敗する」 | JSON Schema ではなく手書きの検証関数。サーバーも同じマスタを起動時に読む |
| DI-14 | △ | 精度（両方）: `Traveler.ts:326`。移動の速さ（サーバーだけ）: `src/infrastructure/server/app/visitPlausibility.ts:62`、`src/domain/exploration/DiscoveryRule.ts:111`。テスト「精度が MAX_ACCURACY_M を超えたら LOW_ACCURACY（100m は可、101m は不可）」「前回の訪問から速すぎる移動の申告は断り、時間がたてば受け付ける（DI-14）」「訪問をしない利用者でも、離れたお店での続けての購入は移動が速すぎるとして断る（DI-14。前回の購入が起点）」 | 端末版には速さの確認が無い（`isPlausibleMove` の呼び出しはサーバーだけ）。サーバーでも発見は確認しない（`appPlayRoutes.ts:186`）。確認を外せるのはデモの版＋開発用ログインのときだけ（`src/infrastructure/di/appBackend.ts:138`） |
| DI-15 | △ | 端末: `src/infrastructure/storage/schema/migrations.ts:48`・`:85`。サーバー: `src/infrastructure/server/pg/migrations.ts:191`（DB が新しければ起動しない）。テスト「未知の schemaVersion は読み込まず backup へ退避して STORAGE_FAILED（DI-15）」「複製に失敗したら元のキーを消さない（データを失わない）」「空の DB を今の版まで進め、もう一度呼んでも変わらない」 | サーバーは○。端末: 退避の次の読込は「未保存」として続く → 欠陥 #2。画面が直接持つ `map.purchases`・`map.prefs` とデモ日付のずらしには schemaVersion が無い |
| DI-16 | △ | 表示のときに外す・言い換える: `src/application/usecases/spot/GetVisitLogUseCase.ts:77`、`src/application/usecases/shared/ReasonText.ts:61`、`src/domain/reward/ItemPolicy.ts:115`。加点のとき `src/application/usecases/shared/VisitContext.ts:85` | ロード時にまとめて孤立参照を見つける処理は無い。保存データの訪問の districtId がマスタのスポットの地区と合うかは見ていない。サーバーの表はマスタへの外部キーを持たない（マスタは JSON） |
| DI-17 | △ | ニックネーム `TravelerState.ts:66`・`:78`、投稿 `src/domain/posting/PostText.ts:56`・`:68`。テスト「結合文字は NFC で1文字にまとめる（e + 結合アキュート、か + 濁点、ハングル字母）」「絵文字（サロゲートペア）は1文字と数え、200個ちょうどは受け付ける」 | `PostText` は使う側がまだ無い（投稿は未実装）。いま保存される自由入力は思い出のメモで、NFC 正規化が無い（`src/application/usecases/spot/SaveVisitMemoryUseCase.ts:69`。長さは文字数で判定・制御文字は除去）→ 欠陥 #6 |
| DI-18 | ○ | `Points.ts:45`（0 以上の整数）、距離は整数に丸めて判定（`DiscoveryRule.ts:46`）、サーバー `migrations.ts:100`（integer・CHECK >= 0）。テスト「小数は整数に丸めてから判定する（DI-18）」 | |
| DI-19 | ○ | `src/application/events/EventFactory.ts:46`〜`:49`（eventId・occurredAt・sequence）、`InMemoryEventBus.ts:132`。テスト「覚えておく件数を超えた古い eventId は忘れる（既定は 1,000 件）」 | 重複の記憶はメモリだけ（再読み込みで消える。サーバーは要求ごとに新しいバス）。保存の重複は DI-07 で守る |
| DI-20 | △ | `AwardVisitRewardsUseCase.ts:69`、`src/application/usecases/competition/UpdateDistrictLordUseCase.ts:135`、デモ操作は warn（`src/application/usecases/demo/AdvanceDateUseCase.ts:51` ほか）、全削除 `src/application/usecases/settings/DeleteAllDataUseCase.ts:43` | 加点は台帳の行（操作ID・日時・スポット）として残る。地区の主の交代とデモ操作はコンソールのログだけで、後から追える形では残らない。サーバーにも利用者の操作の監査表は無い（台帳と訪問の表が記録） |
| DI-21 | × | 書き出しは実装済み（`src/application/usecases/settings/ExportDataUseCase.ts:42`。テスト「保存データをキーごとにまとめた JSON と、日付入りのファイル名を返す（DI-21）」） | インポート（書き出した JSON の読み込み）は未実装。**実装中**（主セッション）。サーバー版では書き出しに入るのは端末のキーだけ |
| DI-22 | △ | 端末: 物理削除 `src/infrastructure/storage/LocalStorageDataPort.ts:90`（退避データも範囲内）。テスト「デモ: 全削除は範囲内だけを物理削除し、店舗CMS・本番・ほかのアプリのキーは残す（PRV-05, DI-22）」。サーバー: 削除の関数だけある（`PgTravelerRepository.ts:195`、`PgPointLedgerRepository.ts:115`） | 投稿の論理削除は投稿が未実装のため未着手。サーバーは退会の API が無く（`docs/12_user_backend_design.md:178` B6）、台帳が旅人と外部キーでつながっていない → 欠陥 #7 |
| DI-23 | ○ | `src/infrastructure/di/container.ts:91`、`src/Common/constants/env.ts:17`、`src/infrastructure/time/DemoClock.ts:7`、`LocalStorageDataPort.ts:39`、本番は `SystemClock` と `BrowserGeoProvider` だけ（`container.ts:129`）。サーバーのにせログイン・移動確認の省略はデモの版だけ（`appBackend.ts:120`・`:138`） | |
| DI-24 | ○ | `src/domain/competition/Ranking.ts:31`（スナップショット＋asOf）、`src/application/usecases/shared/World.ts:108`（1回の読込で凍結）。テスト「スナップショットとして凍結し、入力配列を書き換えない（DI-24）」 | 実際の利用者どうしのランキング（サーバー側の集計）は段階3で未実装 |
| DI-25 | △ | DI-02/04/05/07/09/10/14 のテストはすべてある（上の各行のテスト名） | CI が無く、手元の実行だけ（SEC-10 と同じ） |

## 2. 見つけた欠陥

重さ: High 0 / Medium 2 / Low 6。「確認」は、実行して確かめたか、コードを読んだだけかの別。

| # | 重さ | 系統 | 内容 | 再現の筋道 | 直す場所の候補 | 確認 |
|---|---|---|---|---|---|---|
| 1 | Medium | 端末 | 加点（台帳の保存）が失敗すると、訪問だけが残り、その訪問の EXP は二度と付かない | 台帳の保存を1回失敗させて訪問 → 訪問は成功（duplicate=false）、購読は STORAGE_FAILED をログに出すだけ（`container.ts:202`）。同じ操作ID で送り直す → duplicate=true で SpotVisited を出さない（`VisitSpotUseCase.ts:118`）。新しい操作ID → ALREADY_VISITED_TODAY。結果: 訪問 1 件・台帳 0 行。失敗の原因は容量超過（写真つきの思い出が同じ localStorage を使う）と版数の競合（`AwardVisitRewardsUseCase.ts:65` は読み直さない） | (a) `VisitSpotUseCase` の処理済みの再実行で、台帳に `:visit` 行が無ければ SpotVisited をもう一度出す。(b) 起動時に「訪問はあるが `:visit` 行が無い」ものを `AwardVisitRewardsUseCase.handle` に流す（ハンドラは冪等で、訪問の前後から同じ値を計算できる）。(c) `AwardVisitRewardsUseCase` も CONFLICT で1回読み直す | 一時テストで再現（プロジェクトの偽物で台帳の保存を失敗させた） |
| 2 | Medium | 端末 | 読めない保存データを退避した後、次の読込は「未保存」として続く。台帳なら EXP 0、旅人なら次の起動で新しい旅人になる。新しい版のアプリが書いたデータ（schemaVersion が大きい）を古い版が読んだ場合も、元のキーを消す | `nnishi.ledger.<id>` に schemaVersion 2 の封筒を置く → 1回目の `find` は STORAGE_FAILED、2回目は空の台帳（版数 0）。旅人も同じで 2回目は undefined（`EnsureTravelerUseCase.ts:100` が作り直す）。元の値は `backup.*` に移るが、戻す画面は無く、次の退避で上書きされる（`schema/migrations.ts:79`・`:89`、`LocalStoragePointLedgerRepository.ts:42`） | 未来の版は退避せず、元のキーを残して読込の失敗のままにする（`EnvelopeStore.ts:95`）。台帳だけ欠けたときは訪問記録から再計算する（#1 の (b) と同じ部品）。退避先は上書きしない。DI-21 のインポートで `backup.*` を戻せるようにする | 一時テストで再現（`InMemoryKeyValueStore` と本物のリポジトリ） |
| 3 | Low | 両方 | 「お買い物スタンプ」の回数（`map.purchases`）が台帳の購入回数と食い違う。購入の成否が分かる前に +1 する | お店から離れて購入を押す → `addPurchase` が先に走り（`MapScreen.ts:1202`）、その後 `purchase.execute` が OUT_OF_RANGE。スタンプは増え、台帳は増えない。同じ日の2回目（上限）も同じ | 表示を台帳の `purchasesAtSpot`（`RecordPurchaseUseCase.ts:88`）に寄せるか、成功したときだけ `addPurchase` を呼ぶ。`purchaseLog.ts:4`〜`:5` の注記（EXP は増やさない）も今の実装と合っていない | コードを読んだだけ |
| 4 | Low | サーバー | アプリからの訪問・購入・チケットは `WriteGuard` を通らず、押すたびに新しい操作ID で送る。応答が届かなかった後に押し直すと「今日は達成済み」と出て、演出と EXP の表示が出ない（記録と EXP はサーバーに正しく1回分ある） | 訪問の要求がサーバーで確定した後に時間切れ → もう一度押す → 新しい操作ID（`MapScreen.ts:1073`）→ ALREADY_VISITED_TODAY | `HttpPlayUseCase.ts:133` を CMS と同じ `WriteGuard.send`（`src/infrastructure/api/WriteGuard.ts:37`）経由にし、結果が分からない失敗の後は同じ操作ID で送り直す | コードを読んだだけ |
| 5 | Low | サーバー | サーバーの応答に入るドメインイベントを、種類と eventId だけ確かめて `DomainEvent` として流す | 応答の events に項目の欠けたイベントを入れると、そのまま画面の購読へ渡る（`HttpPlayUseCase.ts:65`〜`:67`） | イベントの種類ごとの形の検証を足す（`src/infrastructure/api/schema/shape.ts` の部品）。壊れたものは捨ててログに残す | コードを読んだだけ |
| 6 | Low | 端末 | 思い出のメモに NFC 正規化が無い。思い出の保存は版数を比べないので、2つのタブで別の回を編集すると後に保存した側だけが残る | メモ: 結合文字で入力すると文字数が多く数えられる（`SaveVisitMemoryUseCase.ts:69`・`:87`）。上書き: `saveAll` は保存済みの版数を読んで +1 するだけ（`src/infrastructure/storage/LocalStorageVisitMemoryRepository.ts:116`〜`:119`） | `normalizeNote` に `normalize('NFC')` を足す。`saveAll` を `writeVersioned` にして、読んだときの版数を渡す | コードを読んだだけ |
| 7 | Low | サーバー | 台帳（`point_ledgers`）が旅人・利用者の表と外部キーでつながっていない。旅人を消しても台帳は残る。`docs/12_user_backend_design.md:83` の「記録の表は CASCADE で一緒に消える」は台帳には当たらない | `migrations.ts:89`〜`:93`。`PgTravelerRepository.delete`（`:195`）は travelers だけを消す。いまは退会の API が無いので実害は出ていない | 形の版 3 で `point_ledgers.traveler_id` に travelers への外部キー（ON DELETE CASCADE）を足すか、退会のユースケースで両方を1トランザクションで消す。テストを足す | コードを読んだだけ |
| 8 | Low | 端末 | 旅人の新規作成は 旅人 → 台帳 → 主の盤 → セッション の順に別々のキーへ書く。途中で失敗すると、本番では次の起動で別の ID の旅人が作られ、前のキーが残る | `src/application/usecases/session/TravelerSetup.ts:92`〜`:105`。セッションの保存だけ失敗させる → 旅人は保存済み・セッションなし → 次の起動は `createUser` が新しい UUID で作る | セッションを先に確かめてから書く、または失敗したら書いた分を消す。残ったキーは全削除では消える | コードを読んだだけ |

## 3. 是正計画（案）

| # | ID | 内容 | 状態 |
|---|---|---|---|
| 1 | DI-11・DI-12（欠陥 #1） | 端末版で、訪問はあるが台帳に行が無いものを加点し直す仕組み | **済**（§5） |
| 2 | DI-15（欠陥 #2） | 未来の版は元を残す。退避先を上書きしない。インポートから戻せるようにする | **済**（§5。退避データを画面から戻す操作は未） |
| 3 | DI-21 | インポートの実装 | **済**（§5） |
| 4 | DI-07（欠陥 #4） | アプリの書き込みを `WriteGuard` 経由にする | 未着手 |
| 5 | DI-22（欠陥 #7） | 台帳の外部キー、退会の API | 未着手（docs/12 B6 の決定待ち） |
| 6 | DI-25 | CI で `tsc`・`vitest`・`static-audit` を回す | 定義だけ追加（`.github/workflows/ci.yml`。リモートのリポジトリが未設定なので未実行） |
| 7 | 欠陥 #3・#5・#6・#8 | 上の表の「直す場所の候補」のとおり | 未着手 |

## 4. 確認していないこと

- 実ブラウザでの容量超過（QuotaExceededError）。欠陥 #1 は偽物のリポジトリで保存を失敗させて確かめたもので、実機でどのくらいの写真の量から起きるかは測っていない
- 実際の PostgreSQL での動作（テストは PGlite）。同時の要求は既存のテスト「同時に届いた2つの訪問（別の操作ID）でも、記録されるのは1回だけ」だけで、負荷をかけた確認はしていない
- 2つのタブ・2台の端末を同時に操作する実機の確認
- サーバー版のアプリをデモの版で使ったとき、端末のデモ時計（日付進行）とサーバーの実時刻がずれる場合の表示（色あせ・チケットの期限）
- デモの版と本番の版のサーバーが同じ PostgreSQL を指した場合の分離（運用の設定）
- 店舗CMS 側（SQLite、`src/infrastructure/server/sqlite/**`）のデータ完全性
- DI-21 のインポート（実装中のため）。この監査の間に `ImportDataUseCase` のテストが増えているが、判定には入れていない
- E2E・全体の `vitest`・ビルドした `dist*` は再実行・確認していない（冒頭の結果は転記）
- 欠陥 #3〜#8 は実行での再現をしていない（コードの読みによる）

## 5. 監査の後の対応（同日・主セッション）

§1 の判定表は監査時点のまま残す。対応後の見込みは ○ 15 / △ 10 / × 0（DI-21 が × → ○。DI-11・DI-12・DI-15 は欠陥を直したが、△ の理由がほかにも残るので据え置き）。

| 対象 | 直したこと | 場所 | 確認 |
|---|---|---|---|
| 欠陥 #1（加点の抜け） | 起動時に、訪問はあるのに台帳に訪問行が無いものを加点し直す（端末版だけ。行ID で冪等）。台帳の保存の競合は読み直して1回やり直す | `src/application/usecases/reward/ReconcileVisitRewardsUseCase.ts`、`AwardVisitRewardsUseCase.ts`（handle／award）、`src/infrastructure/di/container.ts`（createContainer） | テスト「訪問だけ保存されて加点が抜けた訪問に、あとから EXP を付ける」「もう一度呼んでも二重には付かない」「台帳の保存が1回競合しても…加点は1回だけ付く」。E2E で既存の EXP（600・15・637）が変わらないこと |
| 欠陥 #2（退避） | 今より新しい版のデータは退避せず元のまま残す（読込・書込は断る）。退避は先のものを上書きせず、3枠まで残す | `src/infrastructure/storage/schema/EnvelopeStore.ts`（readRaw）、`schema/migrations.ts`（backupSlotFor・quarantineRecord） | テスト「今より新しい schemaVersion は…何度読んでも消えない」「先に退避したデータは上書きせず、次の枠へ書く」 |
| DI-21（復元） | 設定画面の「読み込む」。書き出したファイルの形式名・版・ビルド（デモ／本番）・件数・キーを確かめ、範囲の外のキーは断る。書き込みの途中で失敗したら元に戻す | `src/application/usecases/settings/ImportDataUseCase.ts`、`src/infrastructure/storage/LocalStorageDataPort.ts`（replaceAll）、`src/presentation/screens/Settings/DataPanel.ts` | 単体テスト（往復・拒否 10 通り・範囲外のキー・途中失敗の巻き戻し）、E2E「B14b 書き出したファイルを読み込むと元に戻る」「B14c 合わないファイルは読み込まない」 |

- 対応後: `tsc --noEmit` エラー 0、`vitest` 179 ファイル・1,766 件成功、E2E 40 PASS／0 FAIL。`static-audit` は error 1（`presentation/screens/Map/town/townScene.ts` の JSDoc。ほかのセッションが編集中のファイルで、この対応の変更ではない）
- 残り: 欠陥 #3〜#8（Low）は未着手。#3（お買い物スタンプ）は地図の画面をほかのセッションが編集中のため見送り
- 読み込みは、個々の値の中身までは確かめない（読み込み直した後に各リポジトリの検証が働き、読めない値は退避される）。端末版では保存データの書き換えはもともと防げない（SEC-21。商用版はサーバーが正）
