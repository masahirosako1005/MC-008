# 02. プロジェクトフォルダ構成

原則:
1. 最上位は **presentation / application / domain / infrastructure / Common** に分ける。
2. presentation 配下は **画面遷移（ルート）と同じ階層** にする。フォルダを見れば遷移が推定できること。
3. 共通コンポーネント・共通処理は **`src/Common/`** に集約する（1か所のみ）。
4. テストは対象ファイルと同じフォルダに `*.test.ts` として置く（探索コストを下げる）。
5. 画面名・フォルダ名は CLAUDE.md 8.1 のワイヤフレーム名（01_map_wide 〜 10_settings）と対応させる。
6. 用語は CLAUDE.md 11 に従う。「施設」は使わず **スポット（Spot）**。名所＝Landmark、店舗＝Shop。

---

## 1. 全体構成

```
MC-008/
├── CLAUDE.md                      # 企画書＋AI駆動開発の必須ルール（14章に規約の索引）
├── docs/                          # 設計・規約・監査ドキュメント
│   ├── 01_architecture.md … 07_audit_procedure.md
│   ├── templates/                 # コピーして使う雛形（logger.ts / function_template.ts）
│   └── audit/                     # 監査実施記録（YYYYMMDD_<種別>.md）
├── scripts/audit/static-audit.mjs # 静的監査スクリプト
├── wireframes/                    # 今フェーズの成果物（CLAUDE.md 8 章）
│   ├── index.html                 # 全画面へのリンク
│   ├── 01_map_wide.html  02_map_near.html  03_sheet.html  04_spot.html  05_zukan.html
│   ├── 06_mytown.html    07_ranking.html   08_effects.html 09_demo_menu.html 10_settings.html
│   └── common/                    # 共通部品: 下部タブ・下シート・再訪理由カード・地区カード・スポットカード
├── public/master/                 # districts.json, landmarks.json, shops.json, master.schema.json
└── src/
    ├── main.ts                    # エントリ。DIコンテナ生成→App起動のみ
    ├── presentation/
    ├── application/
    ├── domain/
    ├── infrastructure/
    └── Common/
```

---

## 2. presentation（画面遷移＝フォルダ階層）

下部タブ5つ（地図／図鑑／アバター／ランキング／ランク）＋スポット詳細＋全画面演出＋歯車メニュー（設定／デモ）。ランクは 2026-11-09 に追加（CLAUDE.md 6.1）。
**ルートパスとフォルダパスを一致させる**（例: `/spot/:id` → `screens/Spot/`）。

```
src/presentation/
├── App/                               # ルート。タブシェル・ルーター・歯車
│   ├── App.ts
│   ├── AppRouter.ts                   # ルート定義（2.1 の表と 1:1）
│   └── GearMenu.ts                    # 右上歯車: タップ→設定、長押し→デモメニュー
├── screens/
│   ├── Map/                           # /map   [01_map_wide, 02_map_near]
│   │   ├── MapScreen.ts               # 3段階ズーム（広域→地区→近接）は同一画面の状態。別ルートにしない
│   │   ├── MapCanvas.ts               # 地区色・建物・80m円・足あと・シルエット描画（純粋 draw 関数）
│   │   ├── MapViewModel.ts            # ドメイン→描画用データ変換（色あせは彩度・透明度・アイコンで表現）
│   │   ├── ZoomState.ts               # wide / district / near
│   │   ├── AmenityFilterChips.ts      # 便利情報フィルタ（子連れ・トイレ・授乳室・ベビーカー・雨・駐車場）
│   │   └── Sheet/                     # [03_sheet] 地図下シート（つまみ／半分／全画面）
│   │       ├── MapSheet.ts            # 3段階の開閉状態
│   │       ├── NearbySpotList.ts      # 近隣スポットと距離（距離順）
│   │       ├── RevisitReasonList.ts   # 再訪理由カード（期限＞取り返し＞色あせ＞未訪問＞新着）
│   │       └── DistrictCardList.ts    # 地区カード一覧（成長Lv・色あせ・地区の主・次の目標・カレンダー追加）
│   ├── Spot/                          # /spot/:id   [04_spot] 地図・シート・図鑑から遷移
│   │   ├── SpotDetailScreen.ts
│   │   ├── SpotInfo.ts                # 写真・説明・便利情報・営業時間
│   │   ├── VisitButton.ts             # 40m以内で有効。QR訪問（店舗協力時）
│   │   ├── CouponEventList.ts         # クーポン・イベント（期限）
│   │   └── MyVisitHistory.ts          # 自分の訪問履歴・通った回数
│   ├── Zukan/                         # /zukan  [05_zukan] 図鑑
│   │   ├── ZukanScreen.ts
│   │   ├── DistrictTabs.ts            # 地区別タブ
│   │   └── SpotGrid.ts                # ？／シルエット／カラー＋通った回数。達成率は出さない
│   ├── Avatar/                        # /avatar [06_mytown] アバター（モバゲー風の着せ替え。旧マイ街を 2026-11-09 に置き換え）
│   │   ├── MyTownScreen.ts
│   │   ├── TownOverviewCanvas.ts      # 5地区の成長・色あせの全景
│   │   ├── AvatarPanel.ts
│   │   ├── CardShelf.ts               # 銀・金カード
│   │   ├── ItemList.ts
│   │   └── RankPanel.ts
│   ├── Rank/                          # /rank  下部タブ「ランク」（2026-11-09 追加。ワイヤーフレームなし）
│   │   ├── RankScreen.ts              # 画面の組立て（ステータスパネル＋ステータス・リーグのメダル・ポイント・設定のカード）と動きの開始・後始末
│   │   ├── rankHero.ts                # ステータスパネル（紋章の舞台・登場演出の飾り・ランクロードを歩くアバター）
│   │   ├── rankFx.ts                  # 動きの部品（数え上げ・ポインタで3Dに傾く・スクロールで出現）
│   │   ├── rankEmblem.ts              # 段の紋章（SVG。面取り・彫り・宝石・翼。段の色は CSS の data-tier）
│   │   └── rankModel.ts               # 表示用の純粋関数（ロード上の位置・メダルの色・設定のマス）
│   ├── Ranking/                       # /ranking [07_ranking]
│   │   ├── RankingScreen.ts
│   │   ├── PodiumCanvas.ts            # 表彰台（上位3名）
│   │   └── ScopeToggle.ts             # 全体／地区別
│   ├── Effects/                       # [08_effects] 全画面演出（ドメインイベント購読。URLは持たない）
│   │   ├── EffectHost.ts              # イベント→演出の振り分け。2〜3秒でスキップ可
│   │   ├── CardAwardEffect.ts         # 銀・金カード獲得
│   │   ├── DistrictLordChangeEffect.ts
│   │   ├── ItemAcquiredEffect.ts
│   │   └── RevivalEffect.ts           # 復活（おかえり）＋おかえりボーナス
│   ├── Demo/                          # /demo   [09_demo_menu] 歯車長押し。本番ビルドで無効
│   │   ├── DemoMenuScreen.ts
│   │   ├── DateAdvancePanel.ts        # +1日／+30日／+90日
│   │   ├── RivalActionPanel.ts        # 地区の主を奪う
│   │   ├── TravelerSwitchPanel.ts     # 初回の人／通い慣れた人
│   │   └── ResetPositionPanel.ts      # 位置リセット
│   └── Settings/                      # /settings [10_settings]
│       └── SettingsScreen.ts          # 文字拡大（標準／大／特大）
└── shared/                            # presentation 内だけで使うもの（Common へ昇格前の部品）
```

### 2.1 画面遷移表（AppRouter.ts と同期させる）

| 遷移元 | 操作 | 遷移先 | フォルダ | WF |
|---|---|---|---|---|
| 起動 | — | 地図（広域） | `screens/Map/` | 01 |
| 地図（広域） | 地区タップ | 地図（地区→近接）※同画面のズーム | `screens/Map/` | 01→02 |
| 地図（近接） | スポットタップ | スポット詳細 | `screens/Spot/` | 02→04 |
| 下シート | スポット行タップ | スポット詳細 | `screens/Spot/` | 03→04 |
| 下シート | 地区カードタップ | 地図（地区ズーム） | `screens/Map/` | 03→01 |
| 図鑑 | スポットタップ | スポット詳細 | `screens/Spot/` | 05→04 |
| スポット詳細 | 訪問 | 演出 → スポット詳細 | `screens/Effects/` | 04→08 |
| タブ | 図鑑／アバター／ランキング | 各画面 | `screens/Zukan|Avatar|Ranking/` | 05/06/07 |
| 歯車 | タップ | 設定 | `screens/Settings/` | 10 |
| 歯車 | 長押し | デモメニュー | `screens/Demo/` | 09 |

> 新しい画面を追加するときは **CLAUDE.md 8.1 → この表 → フォルダ → AppRouter.ts** の順に更新する。

---

## 3. application（ユースケース）

```
src/application/
├── usecases/
│   ├── exploration/
│   │   ├── DiscoverNearbySpotsUseCase.ts        # 80m判定→図鑑にシルエット登録
│   │   ├── VisitSpotUseCase.ts                  # 40m判定・訪問記録・加点・成長・イベント発行
│   │   └── GetRevisitReasonsUseCase.ts          # 再訪理由（期限・取り返し・色あせ・未訪問・新着）
│   ├── town/
│   │   ├── GetTownStateUseCase.ts               # 地区ごとの成長Lv・色あせ度
│   │   └── RecalculateFadeUseCase.ts            # 日付変化時の色あせ再計算（見た目のみ）
│   ├── reward/                                  # GrantWelcomeBackBonusUseCase, AwardCardUseCase
│   ├── competition/                             # GetRankingUseCase, UpdateDistrictLordUseCase
│   ├── posting/                                 # PostSpotUseCase, ReferFriendUseCase（Could）
│   └── demo/                                    # AdvanceDateUseCase, SimulateRivalUseCase, SwitchTravelerUseCase, ResetPositionUseCase
├── dto/                                         # 入出力DTO（プリミティブ中心）
├── events/EventBus.ts                           # ドメインイベントの配送IF（実装は infrastructure）
└── ports/                                       # application が必要とする外部IF（カレンダー ICS 出力など）
```

## 4. domain（純粋なビジネスルール）

```
src/domain/
├── exploration/
│   ├── Traveler.ts                 # 集約ルート（旅人）
│   ├── VisitRecord.ts
│   ├── GeoPoint.ts / Distance.ts   # 値オブジェクト（距離計算はここ）
│   ├── DiscoveryRule.ts            # 80m 発見／40m 訪問（ドメインサービス）
│   ├── constants.ts                # DISCOVERY_RADIUS_M=80, VISIT_RADIUS_M=40（仮）
│   └── TravelerRepository.ts       # インターフェース
├── town/                           # District, GrowthLevel(Lv0-3・不可逆), FadeLevel, FadePolicy(30日/90日 仮), DistrictRepository
├── spot/                           # Spot, Landmark, Shop, Amenity, SpotRepository
├── revisit/                        # ShopEvent, Coupon, Period, RevisitReason(種別・優先順位)
├── reward/                         # PointLedger, LedgerEntry, Points, Card(銀/金), CardPolicy, Item
├── competition/                    # Ranking(月間), DistrictLord(直近30日), Score
├── posting/                        # SpotPost, PostText
├── events/                         # DomainEvent と各イベント型
└── ports/                          # Clock, GeoProvider, RandomSource（副作用の抽象）
```

## 5. infrastructure（実装・差し替え点）

```
src/infrastructure/
├── di/container.ts                 # 依存の組み立て（本番／デモ／テストの切替はここだけ）
├── storage/
│   ├── LocalStorageTravelerRepository.ts
│   ├── IndexedDbPointLedgerRepository.ts
│   └── schema/                     # storageSchema.ts, migrations.ts（保存形式のバージョン管理）
├── api/                            # 連携サーバーの呼び出し（ブラウザ側）と、サーバーと共有する契約（道筋・JSON の形）。docs/09 §7.3
│                                   #   HttpCmsServices（CMS の HTTP 版）, CmsSnapshotSync（公開スナップショットの受け取り）。将来 ApiTravelerRepository も
├── server/                         # 連携サーバー（Node だけで動く。node:http・node:sqlite）。http/（API・SSE・画面の配信）, sqlite/（DB・変更履歴）
├── master/MasterDataLoader.ts      # public/master/*.json を JSON Schema 検証して読込
├── geo/                            # BrowserGeoProvider（本番GPS）, DemoGeoProvider（地図タップ移動・位置リセット）
├── time/                           # SystemClock（実時刻）, DemoClock（日付進行）
├── random/                         # CryptoRandomSource, SeededRandomSource
├── calendar/IcsExporter.ts         # 「カレンダーに追加」
└── events/InMemoryEventBus.ts
```

## 6. Common（共通コンポーネント・共通処理）

```
src/Common/
├── ui/                             # 共通UI。特定画面の知識を持たない
│   ├── TabBar.ts                   # 下部タブ（地図／図鑑／アバター／ランキング／ランク）
│   ├── BottomSheet.ts              # 下シート基盤（つまみ／半分／全画面）
│   ├── cards/                      # RevisitReasonCard.ts, DistrictCard.ts, SpotCard.ts
│   ├── Button.ts, Modal.ts, Toast.ts, Chip.ts
│   ├── canvas/                     # CanvasBase.ts, drawUtils.ts, fadeStyle.ts（彩度・透明度・アイコン）
│   └── a11y/textScale.ts           # 文字拡大（標準／大／特大）
├── logging/
│   ├── logger.ts                   # createLogger / fn スコープ（04_comment_and_logging.md）
│   ├── logBuffer.ts                # リングバッファ・エクスポート
│   └── LogViewer.ts                # デモメニューから開けるログビューア（UI）
├── result/                         # Result.ts, AppError.ts（例外に頼らないエラー伝搬）
├── types/                          # Brand.ts, Id.ts（ブランド型・ID型）
├── utils/                          # date.ts, number.ts, assert.ts（純粋関数のみ）
└── constants/env.ts                # ビルドモード（isDemoBuild など）
```

**Common 昇格ルール**: 2つ以上の画面／層で同じ部品が必要になった時点で Common へ移す。
CLAUDE.md 8 章の共通部品（下部タブ・下シート・再訪理由カード・地区カード・スポットカード）は最初から Common/ui に置く。

---

## 7. 命名規則（フォルダ・ファイル）

| 種別 | 規則 | 例 |
|---|---|---|
| 層・機能フォルダ | 小文字（presentation 配下の画面フォルダは PascalCase） | `exploration/`, `screens/Map/` |
| 画面 | `<Name>Screen.ts` | `MapScreen.ts` |
| コンポーネント | PascalCase 名詞 | `DistrictCard.ts` |
| Canvas 描画 | `<Name>Canvas.ts` | `MapCanvas.ts` |
| ユースケース | `<動詞><目的語>UseCase.ts` | `VisitSpotUseCase.ts` |
| エンティティ／値オブジェクト | PascalCase 名詞 | `Traveler.ts`, `GeoPoint.ts` |
| リポジトリIF | `<集約>Repository.ts` | `TravelerRepository.ts` |
| リポジトリ実装 | `<技術><集約>Repository.ts` | `LocalStorageTravelerRepository.ts` |
| ポート実装 | `<技術><ポート名>.ts` | `DemoClock.ts` |
| テスト | `<対象>.test.ts`（同フォルダ） | `DiscoveryRule.test.ts` |
| 定数 | `constants.ts`（機能フォルダ直下） | `domain/exploration/constants.ts` |
| 用語の英語名 | 旅人=Traveler, 地区=District, スポット=Spot, 名所=Landmark, 店舗=Shop, 図鑑=Zukan, アバター（着せ替え）=Avatar, 地区の主=DistrictLord, 色あせ=Fade, 復活=Revival, 取り返し=Reclaim | — |
