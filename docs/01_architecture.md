# 01. アーキテクチャ指針（DDD・疎結合）

対象: N西市 再訪促進スマホWebアプリ（企画書: `CLAUDE.md`）
目的: 保守性・拡張性を確保するため、ドメイン駆動設計（DDD）を基本とし、
ソースファイル・関数を疎結合に保つためのルールを定める。
用語は CLAUDE.md 11 章に従う（「施設」は使わず「スポット」）。

---

## 1. レイヤ構成

ご指定の3層（プレゼンテーション／ドメイン／インフラ）に、DDDで標準的な
**アプリケーション層（ユースケース）** を加えた4層を推奨する。
アプリケーション層が無いと、画面がドメインとリポジトリを直接編成することになり
プレゼンテーション層が肥大化・密結合になるため。

```
┌──────────────────────────────────────┐
│ presentation   画面・Canvas描画・入力処理             │ ← 画面遷移と同じ階層（02 参照）
├──────────────────────────────────────┤
│ application    ユースケース・トランザクション境界      │
├──────────────────────────────────────┤
│ domain         エンティティ・値オブジェクト・           │ ← 純粋な TS。外部依存ゼロ
│                ドメインサービス・リポジトリIF・ポートIF   │
├──────────────────────────────────────┤
│ infrastructure リポジトリ実装・API・Storage・GPS・時計   │
└──────────────────────────────────────┘
          ↑ すべての層から参照可
┌──────────────────────────────────────┐
│ Common         共通UI・ロガー・Result型・ユーティリティ  │
└──────────────────────────────────────┘
```

> 3層厳守が必要な場合は `application/` を `domain/usecase/` に置く。
> その場合も「ユースケースはドメインモデルを編成するだけ」という責務は変えない。

### 1.1 依存方向ルール（最重要）

| 参照元 ＼ 参照先 | presentation | application | domain | infrastructure | Common |
|---|---|---|---|---|---|
| presentation   | ○(同層内) | ○ | ○(型・値オブジェクトのみ) | **×** | ○ |
| application    | **×** | ○ | ○ | **×**(IF経由のみ) | ○ |
| domain         | **×** | **×** | ○ | **×** | ○(logging/result/types/utils のみ) |
| infrastructure | **×** | ○(IF実装) | ○(IF実装・変換) | ○ | ○ |
| Common         | **×** | **×** | **×** | **×** | ○ |

- 依存は常に **外側 → 内側**。内側（domain）は外側を知らない。
- infrastructure への依存は **インターフェース（domain/ports, domain/**Repository）経由** のみ。
  実装の差し替えは `infrastructure/di/container.ts` で行う（依存性注入）。
- 違反は `scripts/audit/static-audit.mjs` の `dependency-rule` チェックで検出する。

### 1.2 各層の責務

| 層 | 置くもの | 置かないもの |
|---|---|---|
| presentation | 画面コンポーネント、Canvas描画、入力ハンドラ、ViewModel、画面遷移 | ビジネスルール、永続化、HTTP呼び出し |
| application | ユースケース（1操作=1クラス）、DTO、トランザクション境界、ドメインイベント発行 | 画面都合の整形、SQL/HTTP詳細 |
| domain | エンティティ、値オブジェクト、集約、ドメインサービス、ドメインイベント、リポジトリIF、ポートIF（Clock/GeoProvider/RandomSource） | `fetch`、`localStorage`、`Date.now()`、`Math.random()`、DOM |
| infrastructure | リポジトリ実装（LocalStorage/IndexedDB/REST）、ポート実装（SystemClock/DemoClock、BrowserGeoProvider/DemoGeoProvider）、DIコンテナ | ビジネスルール |
| Common | 共通UI部品、ロガー、Result/エラー型、純粋ユーティリティ、定数 | 特定画面・特定ユースケースの知識 |

---

## 2. ドメインモデル（初期案）

CLAUDE.md 4 章から抽出した境界づけられたコンテキストと集約。
数値は（仮）。`domain/**/constants.ts` に名前付きで置き、発表後に調整する。
**実装時はこの表を更新し、用語（ユビキタス言語）を統一すること。**

| コンテキスト | 集約ルート | 主な値オブジェクト | 主な不変条件（整合性ルール） |
|---|---|---|---|
| 探索（Exploration） | `Traveler`（旅人） | `GeoPoint`, `Distance`, `VisitRecord` | 発見は `DISCOVERY_RADIUS_M`=80 以内（図鑑にシルエット）。訪問は `VISIT_RADIUS_M`=40 以内。歩かずに稼げないよう同一スポットの加点には上限を設ける（1日1回を仮置き） |
| 街（Town） | `District`（地区）×5 | `GrowthLevel`（Lv0〜3）, `FadeLevel` | **成長は下がらない**（不可逆）。色あせは最終訪問日からの経過日数で**決定論的**に算出（`FADE_START_DAYS`=30, `FADE_MAX_DAYS`=90）、見た目のみに影響 |
| スポット（Spot） | `Spot`＝`Landmark`（名所14）／`Shop`（店舗66） | `SpotId`, `Amenity`（子連れ・トイレ・授乳室・ベビーカー・雨・駐車場） | マスタデータ。実行時に変更不可。必ず1つの地区に属する |
| 再訪動機（Revisit） | `ShopEvent`, `Coupon` | `Period`, `RevisitReason`（期限＞取り返し＞色あせ＞未訪問＞新着） | クーポンは期限内・1回のみ。期限判定は `Clock` 経由。理由の優先順位は定数 |
| 報酬（Reward） | `PointLedger`（ポイント台帳） | `Points`, `Card`（銀/金）, `Item` | 台帳は**追記専用**。残高は台帳から導出し負にならない。銀=同地区3回、金=同地区10回または四季訪問。おかえりボーナス=当日その地区 ×1.5 |
| 競争（Competition） | `DistrictLord`（地区の主）, `Ranking` | `Score` | 地区の主は直近30日の訪問回数最多。交代時に `DistrictLordChanged` を発行し「取り返し」理由を生成。ランキングは月間リセット（全体／地区別） |
| 投稿（Posting） | `SpotPost` | `PostText`, `ImageRef` | 本文は長さ・制御文字検証済みのみ保持。公開前審査は将来 |
| デモ（Demo） | （集約なし。application 層のユースケース） | — | 本番ビルドでは無効。`DemoClock`/`DemoGeoProvider`/`RivalSimulator` の差し替えで実現 |

### 2.1 設計ガード「失う体験を作らない」（CLAUDE.md 4.3 / 5）

GrowthLevel・カード・図鑑の発見／訪問状態・ポイント残高は **減少させる操作を domain に作らない**。
色あせは `FadeLevel` という表示用の導出値であり、保存しない（06 の DI-05）。

### 2.2 ドメインイベント（画面演出との疎結合）

全画面演出（銀・金カード、地区の主交代、アイテム獲得、復活）は
**ドメインイベントを購読して表示**し、ユースケースから直接画面を呼ばない。

```
SpotDiscovered / SpotVisited / DistrictGrown / DistrictRevived / WelcomeBackBonusGranted
CardAwarded(rank) / DistrictLordChanged(district, from, to) / ItemAcquired(item)
```

---

## 3. 疎結合のための設計ルール

1. **1ファイル1責務**: 1ファイルに export する「主役」は1つ（コンポーネント、クラス、ユースケース）。
2. **1関数1目的**: 関数は30行以内を目安。超える場合は分割し、名前で意図を表す。
3. **依存は引数で受け取る**（コンストラクタ注入／関数引数）。モジュール直下で `new` したり
   シングルトンを `import` して使わない。例外: Common のロガー・純粋ユーティリティ。
4. **副作用はポート経由**: 時刻は `Clock`、位置は `GeoProvider`、乱数は `RandomSource`、
   永続化は `Repository` のインターフェース越しにのみ行う。
   → デモメニューの「日付進行・ライバル行動・旅人切替・位置リセット」は実装差し替えだけで実現できる。
5. **イベント駆動で層をまたぐ**: 画面演出・通知・ログ集計はドメインイベント購読で行う。
6. **DTOで境界を越える**: presentation ↔ application 間はプリミティブ中心のDTO。
   domain のエンティティをそのまま画面に渡さない（値オブジェクトの型は共有可）。
7. **状態は集約に閉じる**: グローバルな可変状態（`window.xxx`, module-level `let`）を禁止。
   例外: Common/logging のリングバッファ（デバッグ用途・読み取り専用API）。
8. **循環参照禁止**: 検出した時点でモジュール分割またはイベント化で解消。
9. **マジックナンバー禁止**: 80m／40m／30日／90日／1.5倍／3回／10回 は `constants.ts` に名前付き＋`（仮）`コメントで定義。
10. **Canvas描画は純粋関数化**: `draw(ctx, viewModel)` の形にし、描画関数は状態を持たない。
    描画データ（ViewModel）の生成と描画を分離するとテストと差し替えが容易になる。
11. **再訪理由の表現を1か所に**: アイコン・色・優先順位は `Common/ui/cards/RevisitReasonCard` と
    `domain/revisit/RevisitReason` に集約し、下シート・通知で共有する。

---

## 4. データフロー（1ユースケースの流れ）

```
[スポット詳細] 訪問ボタン
  → presentation/screens/Spot/VisitButton.ts                 （入力検証・DTO化・cid 発行）
  → application/usecases/exploration/VisitSpotUseCase.ts     （ログ: ENTER）
      ├ GeoProvider.current()            … infrastructure 実装（Browser or Demo）
      ├ TravelerRepository.findById()    … 集約取得
      ├ traveler.visit(spot, point, clock.now())  … ドメインルール（40m 判定・訪問記録）
      ├ TravelerRepository.save(traveler, expectedVersion)  … 永続化（楽観ロック）
      └ EventBus.publish(SpotVisited)                        （ログ: EXIT）
  → 購読側ユースケース: 加点（台帳追記）→ 地区成長／復活判定 → CardAwarded / DistrictRevived …
  → presentation/screens/Effects/*  がイベント購読して全画面演出（スキップ可）
```

---

## 5. 技術スタック前提（未確定事項の明示）

CLAUDE.md では技術スタックが未指定のため、以下を**仮置き**とする。
決定次第 CLAUDE.md 14 章の「技術スタック」を更新すること。

- 言語: TypeScript（strict）。フレームワーク非依存の指針とする（Vanilla/React/Vue いずれでも適用可）。
- ビルド: Vite 想定。
- 永続化: 初期は `infrastructure/storage/LocalStorage*Repository`、将来 REST API 実装へ差し替え。
- 描画: Canvas 2D（CLAUDE.md 6.1）。
- 現段階: 実装せず、画面ごとの HTML ワイヤフレームを `wireframes/` に作成（CLAUDE.md 8 章）。
  ワイヤフレーム名（01_map_wide 〜 10_settings）と presentation の画面フォルダは `02_folder_structure.md` §2 で対応付ける。
