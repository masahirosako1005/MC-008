# 08. 実装設計書（実装フェーズ v0.1 の契約）

CLAUDE.md（企画）と docs/01〜07（規約）を、実装可能な粒度に落とした**契約**。
並行して作業する人・AI は、型名・関数名・ファイル配置・数値ルールを本書に合わせる。
本書と 01〜07 が食い違う場合は 01〜07 が優先（本書を直す）。数値はすべて（仮）。

---

## 0. 決定事項（docs の未決部分をここで決めた）

| # | 項目 | 決定 | 理由 |
|---|---|---|---|
| D1 | フレームワーク | Vanilla TypeScript（フレームワークなし）＋ Vite 8 ＋ Vitest 5 ＋ TypeScript 6（strict） | 依存最小（SEC-08）。DOM API のみで innerHTML 禁止を守りやすい |
| D2 | 訪問回数 | **訪問記録の件数**（同一スポットは JST 暦日で1日1件まで＝DI-08）。地区の「通った回数」・カード・地区の主・ランキングはすべてこれで数える | 指標を1つに揃え、画面間で数字が食い違わないようにする |
| D3 | 成長スコア | `growthScore = 訪問したスポットの種類数 + 訪問回数`。Lv1 ≥1、Lv2 ≥5、Lv3 ≥10。建物数 = min(score, 12) | 4.3「種類数と回数の両方で進む。網羅しなくても通えば育つ」。訪問のたびに建物が増えて見える |
| D4 | 成長の不可逆 | GrowthLevel・カード・アイテムは**追記専用の訪問記録から導出**するため構造的に減らない。保存しない | 01 §2.1、DI-05 |
| D5 | 色あせ | 最終訪問からの日数 d（JST暦日差）。d<23: fresh、23≤d<30: soon（そろそろ）、d≥30: fading（progress = min(1,(d−30)/60)）、訪問なし: never | 4.4。progress は表示用で、描画側は fading になった瞬間から目に見えて薄くする |
| D6 | おかえり | 訪問時点で地区が fading（直前の訪問から d≥30）なら `DistrictRevived`。当日その地区の訪問はすべて基本点×1.5（端数切捨て、差分を bonus エントリで追記） | 4.4。台帳は追記専用（DI-06） |
| D7 | 地区の主 | 直近30日（今日を含む30暦日）の訪問回数で比較。**挑戦者は現職を「上回った」ときだけ交代**（同数なら現職維持）。現職なしなら回数≥1の最多（同数は 旅人→ライバルID昇順）| 「抜かれたら取り返し」を明確にし、誰も来ていない期間に勝手に主が消えない |
| D8 | 取り返し | 主が旅人→ライバルに交代したとき `lostByTraveler=true`。旅人が主に戻るまで「取り返し」理由を出す。必要回数 = 主の回数 − 自分の回数 + 1 | 4.5 |
| D9 | ライバル | 実在ユーザーの代わりに**決定論的な模擬ライバル**（rivals.json）。各ライバルは地区ごとに「intervalDays 日ごとに1回訪問」の背景活動を持つ（日付から純粋計算）。デモの「ライバル行動」は当日付の追加訪問を記録する。本町地区には背景活動を置かない | 日付進行・月替わりでもランキングが空にならず、デモ手順5で主交代が確実に起きる |
| D10 | ランキング | 月間（JST）の3リーグ：かよい＝訪問回数／はじめまして＝今月はじめて訪れたスポット数／ルーキー＝使いはじめて30日以内（仮）の人だけの訪問回数。同数は同順位（1,2,2,4）。PoC は各リーグ ダミー10人（application/usecases/competition/leagueDummies.ts）＋あなた | wireframe 07「順位は通った回数。ポイントではない」 |
| D11 | ポイントとランク | 訪問ポイント 名所10・店舗15（店舗回遊を促す）。旅人ランクは累計ポイントで判定（0 はじめて／50 旅人／150 常連／400 顔なじみ／800 街の名士） | おかえりボーナスがランクに効くようにする |
| D12 | 期限トリガー | 発見済みスポットのクーポン・イベントで、期間内かつ残り7日以内 | 未発見スポットの名前を漏らさない（B） |
| D13 | デモ日付 | `DemoClock = 実時刻 + offsetDays`（offset はデモ名前空間に保存）。旅人切替で offset=0 に戻し、シードを今日基準で作り直す | 発表を何度でも同じ流れで再現できる |
| D14 | デモ既定の旅人 | デモビルド初回起動は「通い慣れた人」。本番ビルドは新規旅人（端末ID = `t_` + UUID） | 実演シナリオ（7.2）がそのまま通る |
| D15 | 位置の保存 | 生座標は保存しない（PRV-03）。デモ位置・足あとはメモリのみ。保存するのはスポットID・日時・地区 | SEC-13 |
| D16 | アイテム（Could） | 訪問記録から導出：提灯＝イベント期間中にそのスポットを訪問／のぼり＝異なる店舗3軒を訪問／松＝3地区で名所を訪問 | 失わない・保存不要 |
| D17 | 便利情報フィルタ | 広域：該当スポットが無い地区を薄く。地区・近接：該当スポットを強調（未発見でも「？」に便利情報バッジを付ける。名前は出さない） | A（初回でも困らない）と B（未知の興味）を両立 |

**企画との差分（発表前に確認したい点）**: 7.2 手順4「+30日 → 色あせ、下シートに『そろそろ』カード」は、手順3で訪問した地区が +30日でちょうど色あせ開始（fading）になるため、出るカードは「色」種別の **色あせ中** 表記になる。「そろそろ（あと n 日）」表記はシード上みなと地区（最終訪問25日前）で起動直後から見える。どちらも同じ「色」カード（カレンダー追加付き）。

---

## 1. ディレクトリと主なファイル（02 の構成を v0.1 範囲に絞ったもの）

```
index.html                      # ルート要素 #app と /src/main.ts のみ
public/master/                  # districts.json, landmarks.json, shops.json, shopEvents.json, rivals.json, master.schema.json
scripts/master/hash-master.mjs  # public/master/*.json の SHA-256 を src/infrastructure/master/masterHashes.ts に書く
scripts/e2e/demo-scenario.mjs   # playwright-core＋ローカル Edge で実演6手順を自動実行しスクショ保存
src/main.ts                     # createContainer → App 起動。グローバル例外ハンドラ
src/Common/
  logging/logger.ts logBuffer.ts LogViewer.ts
  result/Result.ts AppError.ts
  types/Brand.ts Id.ts
  utils/date.ts number.ts assert.ts
  constants/env.ts
  ui/dom.ts TabBar.ts BottomSheet.ts Button.ts Modal.ts Toast.ts Chip.ts
  ui/cards/RevisitReasonCard.ts DistrictCard.ts SpotCard.ts
  ui/canvas/CanvasBase.ts drawUtils.ts fadeStyle.ts
  ui/a11y/textScale.ts
  ui/styles/tokens.css base.css components.css
src/domain/
  ports/Clock.ts GeoProvider.ts RandomSource.ts IdGenerator.ts
  events/DomainEvent.ts
  spot/Amenity.ts Spot.ts SpotRepository.ts
  exploration/constants.ts GeoPoint.ts Distance.ts DiscoveryRule.ts VisitRecord.ts VisitStats.ts Traveler.ts TravelerRepository.ts
  town/constants.ts District.ts GrowthPolicy.ts FadePolicy.ts DistrictStatus.ts
  revisit/constants.ts Period.ts ShopEvent.ts RevisitReason.ts RevisitReasonPolicy.ts
  reward/constants.ts Points.ts PointLedger.ts PointLedgerRepository.ts VisitRewardPolicy.ts CardPolicy.ts ItemPolicy.ts TravelerRank.ts
  competition/constants.ts Rival.ts RivalActivity.ts RivalRepository.ts LordPolicy.ts LordshipBoard.ts LordshipRepository.ts Ranking.ts
  posting/PostText.ts
src/application/
  AppServices.ts                  # presentation に渡すサービス一覧（IF）
  dto/*.ts                        # 画面向け DTO（プリミティブのみ）
  events/EventBus.ts EventFactory.ts
  ports/CalendarExporter.ts SessionRepository.ts SettingsRepository.ts DemoControl.ts DataPort.ts
  usecases/exploration/DiscoverNearbySpotsUseCase.ts VisitSpotUseCase.ts GetRevisitReasonsUseCase.ts GetNearbySpotsUseCase.ts GetMapDataUseCase.ts GetCurrentPositionUseCase.ts
  usecases/spot/GetSpotDetailUseCase.ts RedeemCouponUseCase.ts GetZukanUseCase.ts
  usecases/town/GetTownStateUseCase.ts EvaluateDistrictChangeUseCase.ts RecalculateFadeUseCase.ts
  usecases/reward/AwardVisitRewardsUseCase.ts GetMyTownUseCase.ts
  usecases/competition/UpdateDistrictLordUseCase.ts GetRankingUseCase.ts
  usecases/settings/GetSettingsUseCase.ts UpdateTextScaleUseCase.ts ExportDataUseCase.ts DeleteAllDataUseCase.ts
  usecases/session/GetAppStatusUseCase.ts EnsureTravelerUseCase.ts
  usecases/demo/AdvanceDateUseCase.ts SimulateRivalUseCase.ts SwitchTravelerUseCase.ts ResetPositionUseCase.ts MoveDemoPositionUseCase.ts demoSeeds.ts
src/infrastructure/
  di/container.ts
  storage/KeyValueStore.ts LocalStorageKeyValueStore.ts InMemoryKeyValueStore.ts
  storage/LocalStorageTravelerRepository.ts LocalStoragePointLedgerRepository.ts LocalStorageLordshipRepository.ts
  storage/LocalStorageRivalActionRepository.ts LocalStorageSettingsRepository.ts LocalStorageSessionRepository.ts
  storage/schema/storageSchema.ts migrations.ts parsers.ts
  master/MasterDataLoader.ts masterValidators.ts masterHashes.ts InMemorySpotRepository.ts StaticRivalRepository.ts
  geo/BrowserGeoProvider.ts DemoGeoProvider.ts
  time/SystemClock.ts DemoClock.ts
  random/CryptoRandomSource.ts SeededRandomSource.ts CryptoIdGenerator.ts
  calendar/IcsExporter.ts
  events/InMemoryEventBus.ts
src/presentation/
  App/App.ts AppRouter.ts GearMenu.ts AppContext.ts Screen.ts StatusBar.ts LocationConsent.ts
  shared/labels.ts operation.ts
  screens/Map/ MapScreen.ts MapCanvas.ts MapViewModel.ts ZoomState.ts AmenityFilterChips.ts Walker.ts MapScreen.css
  screens/Map/Sheet/ MapSheet.ts NearbySpotList.ts RevisitReasonList.ts DistrictCardList.ts
  screens/Spot/ SpotDetailScreen.ts SpotInfo.ts SpotIllustrationCanvas.ts VisitButton.ts CouponEventList.ts MyVisitHistory.ts
  screens/Zukan/ ZukanScreen.ts DistrictTabs.ts SpotGrid.ts
  screens/MyTown/ MyTownScreen.ts TownOverviewCanvas.ts AvatarPanel.ts CardShelf.ts ItemList.ts RankPanel.ts
  screens/Ranking/ RankingScreen.ts PodiumCanvas.ts ScopeToggle.ts
  screens/Effects/ EffectHost.ts CardAwardEffect.ts DistrictLordChangeEffect.ts ItemAcquiredEffect.ts RevivalEffect.ts
  screens/Demo/ DemoMenuScreen.ts DateAdvancePanel.ts RivalActionPanel.ts TravelerSwitchPanel.ts ResetPositionPanel.ts
  screens/Settings/ SettingsScreen.ts
```

インポートは `@/<層>/...` エイリアスを使う（static-audit の dependency-rule が層を判定できる）。同一フォルダ内は相対でもよい。

---

## 2. 共通（Common）の契約

```ts
// Common/result/AppError.ts
export interface AppError<C extends string = string> {
  readonly code: C; readonly message: string;          // message は日本語・利用者向け（内部情報を含めない）
  readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>>;
}
export const AppError: { of<C extends string>(code: C, message: string, details?: Readonly<Record<string, unknown>>, cause?: unknown): AppError<C> };

// Common/result/Result.ts（AppError も再 export）
export type Result<T, E = AppError> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
export function ok<T>(value: T): Result<T, never>;
export function fail<E>(error: E): Result<never, E>;

// Common/types/Brand.ts
export type Brand<T, B extends string> = T & { readonly __brand: B };

// Common/types/Id.ts  — 正規表現は SEC-16
export type SpotId = Brand<string, 'SpotId'>;           // ^[ls]_[0-9a-z]{2,16}$  (l=名所, s=店舗)
export type DistrictId = Brand<string, 'DistrictId'>;   // ^d_[0-9a-z]{2,16}$
export type TravelerId = Brand<string, 'TravelerId'>;   // ^t_[0-9a-z]{2,40}$
export type RivalId = Brand<string, 'RivalId'>;         // ^r_[0-9a-z]{2,16}$
export type ShopEventId = Brand<string, 'ShopEventId'>; // ^c_[0-9a-z]{2,16}$
export type ItemId = Brand<string, 'ItemId'>;           // ^i_[0-9a-z]{2,16}$
export type OperationId = Brand<string, 'OperationId'>; // ^[0-9a-f-]{8,64}$（UUID）
export type EventId = Brand<string, 'EventId'>;         // ^ev_[0-9a-z]{4,64}$
export function parseSpotId(raw: unknown): Result<SpotId>;  // 他の ID も parseXxx を同じ形で用意
```

`Common/utils/date.ts`（ここと infrastructure/time だけが `new Date` を使ってよい）:

```ts
export type Instant = Brand<string, 'Instant'>;     // UTC ISO 8601 'YYYY-MM-DDTHH:mm:ss.sssZ'
export type LocalDate = Brand<string, 'LocalDate'>; // 'YYYY-MM-DD'（Asia/Tokyo の暦日。JST=UTC+9固定、DSTなし）
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'; // 3-5 / 6-8 / 9-11 / 12-2
export function instantFromEpochMs(ms: number): Instant;
export function epochMsOf(instant: Instant): number;
export function parseInstant(raw: unknown): Result<Instant>;
export function parseLocalDate(raw: unknown): Result<LocalDate>;
export function localDateOf(instant: Instant): LocalDate;          // JST 暦日（DI-04）
export function addDays(date: LocalDate, days: number): LocalDate;
export function daysBetween(from: LocalDate, to: LocalDate): number; // to − from（整数日）
export function monthKeyOf(date: LocalDate): string;               // 'YYYY-MM'
export function startOfMonth(date: LocalDate): LocalDate;
export function endOfMonth(date: LocalDate): LocalDate;
export function seasonOf(date: LocalDate): Season;
export function epochDayOf(date: LocalDate): number;               // 1970-01-01 からの日数（ライバル背景活動の位相計算）
export function formatJpDate(date: LocalDate): string;             // '2026/11/09（月）'
export function formatJpTime(instant: Instant): string;            // '9:41'（JST）
```

`Common/constants/env.ts`: `isDemoBuild`（`import.meta.env.MODE === 'demo'`）、`STORAGE_PREFIX`（デモ `nnishi.demo.`／本番 `nnishi.`）、`APP_VERSION`。

`Common/logging/logger.ts`: docs/templates/logger.ts を移植。変更点: 本番ビルド（`!isDemoBuild && import.meta.env.PROD`）では debug を常に無効（LG-04）。`setCorrelationId` は `crypto.getRandomValues` で6桁英数字。バッファ操作は `logBuffer.ts` に分離（`pushLog`/`readLogBuffer`/`exportLogBuffer`/`clearLogBuffer`）。

---

## 3. domain の契約

### 3.1 ports / events

```ts
export interface Clock { now(): Instant; today(): LocalDate }                 // domain/ports/Clock.ts
export interface GeoFix { readonly point: GeoPoint; readonly accuracyM: number; readonly at: Instant }
export interface GeoProvider { current(): Promise<Result<GeoFix, AppError<'GEO_UNAVAILABLE' | 'GEO_DENIED'>>> }
export interface RandomSource { next(): number }                              // [0,1)
export interface IdGenerator { newId(prefix: string): string }                // 'ev' → 'ev_xxxxxxxx…'
```

`domain/events/DomainEvent.ts`（共通メタ: `eventId: EventId; occurredAt: Instant; sequence: number; travelerId: TravelerId`）:

```ts
type LordHolder = { readonly type: 'traveler' } | { readonly type: 'rival'; readonly rivalId: RivalId };
SpotDiscovered        { spotId; districtId }
SpotVisited           { spotId; districtId; localDate; operationId }
PointsAwarded         { districtId; spotId; basePoints; bonusPoints; operationId }
DistrictGrown         { districtId; from: GrowthLevel; to: GrowthLevel }
DistrictRevived       { districtId; daysSinceLastVisit; level: GrowthLevel }
WelcomeBackBonusGranted { districtId; multiplier; bonusPoints }
CardAwarded           { districtId; rank: 'silver' | 'gold'; reason: 'visits' | 'seasons'; visitCount }
DistrictLordChanged   { districtId; from?: LordHolder; to: LordHolder; fromName?: string; toName: string; travelerCount; lordCount }
ItemAcquired          { itemId; name }
```
`DomainEvent` は `type` を判別子とするユニオン。`DomainEventType = DomainEvent['type']`。

### 3.2 spot

```ts
export const AMENITIES = ['kids', 'toilet', 'nursing', 'stroller', 'rainOk', 'parking'] as const; // 子連れ歓迎/トイレ/授乳室/ベビーカーOK/雨の日OK/駐車場
export type Amenity = (typeof AMENITIES)[number];
export type SpotKind = 'landmark' | 'shop';
export interface Spot { readonly id: SpotId; readonly kind: SpotKind; readonly districtId: DistrictId; readonly name: string;
  readonly point: GeoPoint; readonly category: string; readonly description: string; readonly amenities: readonly Amenity[];
  readonly hours: string; readonly partner: boolean }   // partner=店舗協力あり（QR・クーポン）
export interface SpotRepository {   // マスタ（読込後は同期・不変）
  allSpots(): readonly Spot[]; findSpot(id: SpotId): Spot | undefined; spotsInDistrict(id: DistrictId): readonly Spot[];
  allDistricts(): readonly District[]; findDistrict(id: DistrictId): District | undefined;
  allShopEvents(): readonly ShopEvent[]; shopEventsForSpot(id: SpotId): readonly ShopEvent[];
  cityBounds(): { readonly south: number; readonly west: number; readonly north: number; readonly east: number };
}
```

### 3.3 exploration

- `GeoPoint.of(lat, lng): Result<GeoPoint>`（緯度 −90〜90、経度 −180〜180、有限数）。`interface GeoPoint { readonly lat: number; readonly lng: number }`。
- `Distance.between(a, b): Distance`（`{ meters: number }`、整数に丸め＝DI-18。正距円筒近似で可）。
- `constants.ts`: `DISCOVERY_RADIUS_M = 80`、`VISIT_RADIUS_M = 40`、`MAX_ACCURACY_M = 100`、`MAX_PLAUSIBLE_SPEED_KMH = 30`（すべて（仮））。
- `DiscoveryRule.ts`: `isWithinDiscoveryRadius(m)`, `isWithinVisitRadius(m)`, `findSpotsToDiscover(point, spots, isDiscovered): Spot[]`, `nearestSpots(point, spots, limit): { spot; meters }[]`（距離昇順、同距離は id 昇順）, `isPlausibleMove(prev: GeoFix, next: GeoFix): boolean`（DI-14。本番 GPS のみで使う）。
- `VisitRecord { spotId; districtId; visitedAt: Instant; localDate: LocalDate; operationId: OperationId }`、`DiscoveryRecord { spotId; districtId; discoveredAt: Instant }`、`CouponRedemption { shopEventId; spotId; redeemedAt: Instant; operationId }`。
- `VisitStats.ts`（純粋関数）: `visitsInDistrict(visits, districtId)`, `countVisitsInRange({ visits, districtId?, from, to })`（推奨。4引数の countVisitsBetween は互換用）, `lastVisitDate(visits, districtId, before?: LocalDate)`, `visitCountOfSpot(visits, spotId)`, `distinctSpotCount(visits, districtId)`, `seasonsVisited(visits, districtId): Set<Season>`。
- `Traveler`（集約・不変オブジェクト。変更メソッドは新インスタンスを返す）:

```ts
export type TravelerProfile = 'first' | 'regular' | 'user';
export interface TravelerState { readonly id: TravelerId; readonly nickname: string; readonly profile: TravelerProfile;
  readonly version: number; readonly discoveries: readonly DiscoveryRecord[]; readonly visits: readonly VisitRecord[];
  readonly redemptions: readonly CouponRedemption[]; readonly processedOperationIds: readonly OperationId[] }  // 直近500件まで保持
export class Traveler {
  static create(id: TravelerId, nickname: string, profile: TravelerProfile): Traveler;
  static restore(state: unknown): Result<Traveler>;  // 保存データをそのまま渡せる（PointLedger/LordshipBoard と同形）   // 不変条件: visits の (spotId, localDate) 一意、visit済みは discovery 済み
  toState(): TravelerState;  get id(); get version(); get visits(); get discoveries();
  hasDiscovered(id: SpotId): boolean; hasVisited(id: SpotId): boolean; hasProcessed(op: OperationId): boolean;
  withVersion(version: number): Traveler;
  discover(spots: readonly Spot[], at: Instant): { traveler: Traveler; newlyDiscovered: readonly Spot[] };
  visit(input: { spot: Spot; meters: number; accuracyM: number; at: Instant; localDate: LocalDate; operationId: OperationId })
    : Result<{ traveler: Traveler; record: VisitRecord; duplicate: boolean },
             AppError<'OUT_OF_RANGE' | 'ALREADY_VISITED_TODAY' | 'LOW_ACCURACY'>>;  // 処理済み operationId は duplicate=true で無変更。未発見なら同時に発見記録
  redeem(input: { shopEvent: ShopEvent; meters: number; at: Instant; localDate: LocalDate; operationId: OperationId })
    : Result<{ traveler: Traveler; duplicate: boolean }, AppError<'OUT_OF_RANGE' | 'EXPIRED' | 'ALREADY_REDEEMED' | 'NOT_COUPON'>>;
}
export interface TravelerRepository {
  findById(id: TravelerId): Promise<Result<Traveler | undefined>>;
  save(traveler: Traveler, expectedVersion: number): Promise<Result<Traveler, AppError<'CONFLICT' | 'STORAGE_FAILED'>>>; // 成功時 version+1 を返す
  delete(id: TravelerId): Promise<Result<void>>;
}
```

### 3.4 town

- `District { id; name; shortName; theme; order; color; center: GeoPoint; entrance: GeoPoint; polygon: readonly GeoPoint[] }`（color は `#rrggbb`）。
- `constants.ts`: `FADE_START_DAYS = 30`、`FADE_MAX_DAYS = 90`、`FADE_SOON_NOTICE_DAYS = 7`、`GROWTH_LV1_SCORE = 1`、`GROWTH_LV2_SCORE = 5`、`GROWTH_LV3_SCORE = 10`、`MAX_BUILDINGS = 12`。
- `GrowthPolicy`: `type GrowthLevel = 0 | 1 | 2 | 3`; `growthScore(distinctSpots, visitCount)`, `levelFor(score)`, `buildingsFor(score)`, `nextGoal(score): { nextLevel: GrowthLevel; remainingScore: number } | undefined`。
- `FadePolicy.stateFor(lastVisit: LocalDate | undefined, today: LocalDate): FadeState`
  `FadeState = { kind: 'never' } | { kind: 'fresh'; daysSinceVisit } | { kind: 'soon'; daysSinceVisit; daysUntilFade; fadeStartDate } | { kind: 'fading'; daysSinceVisit; progress /*0..1*/ }`。`fadeStartDate(lastVisit)` も公開。
- `DistrictStatus.ts`: `districtStatusOf({ district, visits, today }): DistrictStatus`
  `DistrictStatus { districtId; level; score; buildings; visitCount; distinctSpots; lastVisit?: LocalDate; fade: FadeState; nextGoal? }`。

### 3.5 revisit

- `Period.of(start, end): Result<Period>`（start ≦ end）、`contains(d)`, `daysUntilEnd(d)`（当日終了=0）。
- `ShopEvent { id: ShopEventId; spotId; districtId; kind: 'coupon' | 'event'; title; description; period: Period }`。`isActive(d)`。
- `constants.ts`: `DEADLINE_NOTICE_DAYS = 7`。
- `RevisitReason.ts`: `REVISIT_REASON_PRIORITY = ['deadline', 'reclaim', 'fade', 'unvisited', 'new'] as const`（4.5 の表の順）。

```ts
type RevisitReason =
  | { kind: 'deadline'; shopEventId; spotId; districtId; title; daysLeft: number }
  | { kind: 'reclaim'; districtId; lordName: string; lordCount: number; myCount: number; needed: number }
  | { kind: 'fade'; districtId; state: 'soon' | 'fading'; daysSinceVisit: number; daysUntilFade?: number; fadeStartDate: LocalDate }
  | { kind: 'unvisited'; districtId; spotIds: readonly SpotId[] }
  | { kind: 'new'; spotId: SpotId; districtId };   // 将来。v0.1 では生成しない
export function sortRevisitReasons(rs): RevisitReason[];  // 種別優先→同種内は緊急度（daysLeft 昇順、needed 昇順、fading>soon、件数降順）
```
- `RevisitReasonPolicy.collect({ today, spots, districts, shopEvents, visits, discoveredSpotIds, lordships: LordshipSnapshot[], redeemedShopEventIds? }): RevisitReason[]`（ソート済み。discoveredSpotIds は訪問済みも含む。LordshipSnapshot は LordshipBoard・collectLordCounts・visitsNeededToReclaim から application で組み立てる）。

### 3.6 reward

- `constants.ts`: `VISIT_POINTS_LANDMARK = 10`、`VISIT_POINTS_SHOP = 15`、`WELCOME_BACK_MULTIPLIER = 1.5`、`SILVER_CARD_VISITS = 3`、`GOLD_CARD_VISITS = 10`、`GOLD_CARD_SEASONS = 4`、`RANK_THRESHOLDS = [{min:0,name:'はじめての旅人'},{min:50,name:'旅人'},{min:150,name:'常連'},{min:400,name:'顔なじみ'},{min:800,name:'街の名士'}]`。
- `Points.of(n): Result<Points>`（0以上の整数）、`add`。
- `LedgerEntry { entryId: string /* `${operationId}:visit` | `${operationId}:bonus` */; kind: 'visit' | 'welcomeBack'; points: number; districtId; spotId; at: Instant; localDate }`。
- `PointLedger`（追記専用・DI-06）: `static empty(travelerId)`, `static restore(state): Result<PointLedger>`, `append(entries): Result<PointLedger>`（同じ entryId は無視＝冪等）, `balance(): number`, `version`, `toState()`。**setBalance を作らない**。
- `PointLedgerRepository { find(travelerId): Promise<Result<PointLedger>>; save(ledger, expectedVersion): Promise<Result<PointLedger, AppError<'CONFLICT' | 'STORAGE_FAILED'>>>; delete(travelerId) }`。
- `VisitRewardPolicy.rewardFor({ spot, visitsBefore, today }): { basePoints; bonusPoints; isWelcomeBackDay }`（D6）。`isRevival({ visitsBefore, districtId, today }): { revived: boolean; daysSinceLastVisit?: number }`。
- `CardPolicy.cardsOf(visits, districtId): { rank; reason; earnedOn: LocalDate }[]`（銀=3回、金=10回または四季）、`nextCardGoal(visits, districtId): { rank; remainingVisits } | undefined`。
- `ItemPolicy.itemsOf({ visits, spots, shopEvents }): { itemId; name; earnedOn }[]`（D16。ID: `i_chochin` 提灯、`i_nobori` のぼり、`i_matsu` 松）。
- `TravelerRank.rankOf(points): { name; index; nextAt?: number; remaining?: number }`。

### 3.7 competition

- `constants.ts`: `LORD_WINDOW_DAYS = 30`。
- `Rival { id: RivalId; name: string; patterns: readonly { districtId; intervalDays; phase }[] }`。
- `RivalActionVisit { rivalId; districtId; localDate; count }`（デモのライバル行動）。
- `RivalActivity.countRivalVisits({ rival, actions, districtId?, from, to }): number`（背景: `(epochDay(d) + phase) % intervalDays === 0` の日を1回とする＋actions）。
- `RivalRepository { allRivals(): readonly Rival[]; findRival(id) }`、`RivalActionRepository { list(travelerId): Promise<Result<readonly RivalActionVisit[]>>; append(travelerId, action): Promise<Result<void>>; clear(travelerId) }`（ドメインIF。ライバル行動は旅人ごとの世界に属する）。
- `LordPolicy.decide({ incumbent?: LordHolder; counts: readonly { holder: LordHolder; count: number }[] }): LordHolder | undefined`（D7）。
- `LordshipBoard`（集約）: `{ travelerId; version; entries: { districtId; holder?: LordHolder; lostByTraveler: boolean }[] }`。`holderOf(d)`, `apply(districtId, next: LordHolder | undefined): { board; changed: boolean; from?: LordHolder }`（旅人→ライバルで lostByTraveler=true、旅人が主になれば false）。
- `LordshipRepository { find(travelerId): Promise<Result<LordshipBoard>>; save(board, expectedVersion); delete(travelerId) }`。
- `Ranking.from({ participants: { key; name; isMe; count }[], asOf }): { entries: { rank; key; name; isMe; count }[] }`（D10、DI-24 スナップショット）。

### 3.8 posting（Could）

`PostText.of(raw): Result<PostText>`（NFC 正規化、制御文字除去、1〜200文字＝DI-17）。UI は枠のみ。

---

## 4. application の契約

### 4.1 共通

- ユースケースは `class XxxUseCase { constructor(private readonly deps: {...}) {} execute(input): Promise<Result<Output>> }`。1操作1クラス。
- 書込み系は入力に `operationId`（UUID、presentation の `newOperationId()` で発行）を必須にする（DI-07）。
- `application/events/EventBus.ts`: `interface EventBus { publish(events: readonly DomainEvent[]): Promise<void>; subscribe<T extends DomainEventType>(type: T, handler: (e: Extract<DomainEvent, {type: T}>) => Promise<void> | void): () => void }`。publish は購読ハンドラを登録順に await 実行。eventId で重複排除（DI-19）。
- `EventFactory`（IdGenerator＋Clock＋インスタンス内 sequence）: `create(travelerId, payload)` → メタ付き DomainEvent。
- 失敗コード（共通）: `INVALID_INPUT`, `SPOT_NOT_FOUND`, `DISTRICT_NOT_FOUND`, `TRAVELER_NOT_FOUND`, `GEO_UNAVAILABLE`, `GEO_DENIED`, `OUT_OF_RANGE`, `LOW_ACCURACY`, `ALREADY_VISITED_TODAY`, `CONFLICT`, `STORAGE_FAILED`, `DEMO_DISABLED`, `EXPIRED`, `ALREADY_REDEEMED`, `NOT_COUPON`。

### 4.2 イベント連鎖（DI-11）

`VisitSpotUseCase` は訪問記録を保存して `SpotVisited` を発行するまで。購読は container で次の順に登録する:
1. `EvaluateDistrictChangeUseCase.handle(SpotVisited)` → `DistrictRevived`（訪問前に fading だった）／`DistrictGrown`（Lv 上昇）
2. `AwardVisitRewardsUseCase.handle(SpotVisited)` → 台帳追記 → `PointsAwarded`、`WelcomeBackBonusGranted`、`CardAwarded`、`ItemAcquired`
3. `UpdateDistrictLordUseCase.handle(SpotVisited)` → `DistrictLordChanged`
各ハンドラは「訪問前の記録」を `operationId` が一致する記録を除いて再構成する。途中で失敗しても訪問記録は残る。

### 4.3 AppServices（presentation が受け取る唯一の入口）

```ts
export interface AppServices {
  readonly isDemo: boolean;
  readonly events: Pick<EventBus, 'subscribe'>;
  readonly status: GetAppStatusUseCase;          // { today, nowLabel, dateLabel, travelerId, profile, isDemo }
  readonly map: GetMapDataUseCase; readonly position: GetCurrentPositionUseCase;
  readonly discover: DiscoverNearbySpotsUseCase; readonly visit: VisitSpotUseCase;
  readonly nearby: GetNearbySpotsUseCase; readonly reasons: GetRevisitReasonsUseCase;
  readonly spotDetail: GetSpotDetailUseCase; readonly redeemCoupon: RedeemCouponUseCase;
  readonly zukan: GetZukanUseCase; readonly town: GetTownStateUseCase; readonly myTown: GetMyTownUseCase;
  readonly ranking: GetRankingUseCase; readonly settings: GetSettingsUseCase; readonly updateTextScale: UpdateTextScaleUseCase;
  readonly exportData: ExportDataUseCase; readonly deleteAllData: DeleteAllDataUseCase; readonly calendar: CalendarExporter;
  readonly demo?: { advanceDate: AdvanceDateUseCase; simulateRival: SimulateRivalUseCase; switchTraveler: SwitchTravelerUseCase;
                    resetPosition: ResetPositionUseCase; moveTo: MoveDemoPositionUseCase };   // isDemoBuild のときだけ
}
```

DTO はプリミティブと配列のみ（Instant/LocalDate は string として渡す）。主要 DTO:

- `MapDataDto { today; districts: DistrictMapDto[]; spots: MapSpotDto[]; bounds }`
  - `DistrictMapDto { id; name; shortName; theme; color; order; polygon: {lat,lng}[]; center; level; score; buildings; visitCount; fade: FadeDto; lordName?; isLordMe; hasAmenity: Record<Amenity, boolean> }`
  - `MapSpotDto { id; kind; districtId; lat; lng; status: 'unknown' | 'discovered' | 'visited'; name?（unknown は undefined）; visitCount; amenities; hasActiveShopEvent }`
  - `FadeDto { kind: 'never' | 'fresh' | 'soon' | 'fading'; daysSinceVisit?; daysUntilFade?; progress?; fadeStartDate? }`
- `PositionDto { lat; lng; accuracyM } | undefined`（presentation の描画専用。ログに出さない）
- `NearbySpotDto { id; name?; kind; districtId; meters; status; visitCount; canVisit; hasActiveShopEvent }`
- `RevisitReasonDto { kind; title; subtitle; districtId; spotId?; shopEventId?; calendar?: { districtName; fadeStartDate } }`（文言は application で日本語化）
- `SpotDetailDto { id; name; kind; category; districtId; districtName; description; amenities; hours; partner; status; meters?; canVisit; metersToVisit?; visitCount; districtVisitCount; nextCard?: { rank; remainingVisits }; history: string[]; shopEvents: { id; kind; title; description; daysLeft; active; redeemed; canRedeem }[] }`
- `ZukanDto { districts: { id; shortName }[]; district: { id; name; level; visitCount; lastVisit? }; tiles: { id?; name?; kind; status; visitCount }[] }`（達成率を含めない）
- `TownStateDto { districts: DistrictCardDto[] }`、`DistrictCardDto { id; name; color; level; score; buildings; fade: FadeDto; lordName?; isLordMe; lordLost; nextGoalText; visitCount }`
- `MyTownDto { nickname; rank: { name; nextAt?; remaining? }; points; totalVisits; districts: DistrictCardDto[]; cards: { districtId; districtName; rank; earnedOn }[]; nextCards: { districtId; districtName; rank; remainingVisits }[]; items: { itemId; name; earnedOn }[] }`
- `RankingDto { monthLabel; daysLeft; leagues: LeagueDto[]; recommendedLeagueId; lords: RankingLordDto[] }`（LeagueDto は entries・myRank・myCount・nextStepText・joined 等。定義は src/application/dto/Dto.ts）
- `AppStatusDto { today; dateLabel; timeLabel; isDemo; travelerProfile; dayOffset? }`

### 4.4 デモ（`isDemoBuild` が false なら container に登録しない＋各ユースケースも `DEMO_DISABLED` で拒否＝SEC-02 二重防御。呼出は warn ログ＝DI-20）

- `AdvanceDateUseCase { days: 1 | 30 | 90 }` → `DemoControl.advanceDays` → 全地区で `UpdateDistrictLordUseCase`。
- `SimulateRivalUseCase { operationId; rivalId?='r_taro'; districtId?='d_honmachi' }` → 今日付の `RivalActionVisit` を「現職と旅人の直近30日回数の最大 + 1 − ライバルの現回数」件追記 → 主の再判定 → `DistrictLordChanged`。
- `SwitchTravelerUseCase { profile: 'first' | 'regular' }` → offset=0、該当プロフィールのデータ（旅人・台帳・主・ライバル行動）を消してシード（`demoSeeds.ts`）を今日基準で作成 → アクティブ旅人を切替 → 位置を城下地区の入口へ。
- `ResetPositionUseCase` → 城下地区の `entrance` へ。`MoveDemoPositionUseCase { lat; lng }` → デモ位置更新（GeoPoint 検証）。

### 4.5 デモシード「通い慣れた人」（today = T）

| 地区 | 訪問（スポット×日） | 回数 | Lv | 色あせ | 主 | 意図 |
|---|---|---|---|---|---|---|
| 城下 | N西城跡 T−20, T−12, T−5／城下カフェ T−12, T−5／城下茶寮 T−5（発見のみ: 武家屋敷通り・丸岡和菓子店・御堀端ベーカリー） | 6 | Lv2（score 9） | fresh | おまいり番長（背景） | 手順2で未発見を発見、手順3の訪問で Lv3 に育つ |
| 本町 | 7スポットで計9回（T−28〜T−2。2026-11-09 に T−12・T−9 の再訪を別スポットへ振り替え） | 9 | Lv3（score 16） | fresh | **旅人** | 手順4で色あせ、手順5で奪われ、手順6の再訪で復活＋金カード（10回）。もう1スポット訪問で取り返し |
| みなと | 大桟橋・魚市場 T−25（＋2026-11-09 追加: 古い訪問 T−70〜T−35 の13回） | 15 | Lv3（score 28） | soon（あと5日） | 花見は毎日派（背景） | 起動直後から「そろそろ」カード |
| 里山 | なし | 0 | Lv0 | never | ケン（背景） | 輪郭のみ（B） |
| 湯の里 | 湯の里源泉 T−60, T−45／足湯公園 T−45／店舗1軒 T−45（＋2026-11-09 追加: 古い訪問 T−95〜T−50 の11回） | 15 | Lv3（score 28） | fading（45日） | ソラ（背景） | 起動直後から色あせ表現 |

「初回の人」はすべて空。どちらも主の初期状態はシード時点で D7 に従い計算して保存する。

2026-11-09 ユーザー指示「名所店舗は初期データとしてある程度獲得している状況に」で、図鑑のカード（訪問済み36枚・発見のみ13枚／80枚）を増やした（同日「グレーではなく獲得したものを見せて」で 21枚→36枚に再増量）。
足したのは直近30日より古い訪問（主の集計に入らない）・本町の再訪2回の振り替え（回数・日付は同じ）・発見のみだけで、最終訪問日（色あせ）・城下の Lv3 手前（score 9）・本町の金カード手前（9回）・里山の未訪問・手順2の未発見は変えていない。
みなと・湯の里は Lv3＋金カード獲得済みになり、台帳の残高は 255 → 600（テスト用の合成カタログでの値。基本点のみ）。
デモビルドの起動時、保存済みの「通い慣れた人」にシードのスポットの記録が欠けていれば（＝前のシードのまま）作り直す（EnsureTravelerUseCase・isRegularSeedOutdated）。

---

## 5. infrastructure の契約

- **ストレージキー**（SEC-07。プレフィックス P = `STORAGE_PREFIX`）: `P+'session'`、`P+'traveler.'+id`、`P+'ledger.'+id`、`P+'lordship.'+id`、`P+'rivalActions.'+id`、`P+'settings'`、`P+'consent'`、`'nnishi.demo.clockOffsetDays'`、`'nnishi.debug'`。
- 保存形式は `{ schemaVersion: 1, version: number, data: ... }`。読込時は `parsers.ts` で unknown → 検証済み型（DI-01）。未知の schemaVersion は `P+'backup.'+key` に退避して `STORAGE_FAILED`（DI-15）。`save(x, expectedVersion)` は保存済み version と不一致なら `CONFLICT`（DI-10）。
- `KeyValueStore { get(key): Result<string | undefined>; set(key, value): Result<void>; remove(key): Result<void>; keys(prefix): Result<string[]> }`。try/catch はここだけ。
- `MasterDataLoader.load(fetchText: (path) => Promise<Result<string>>): Promise<Result<SpotCatalog>>` — JSON.parse → `masterValidators.ts` で構造・ID正規表現・件数（地区5／名所14／店舗66）・ID一意・外部キー（spot→district、shopEvent→spot）・座標が地区ポリゴン内を検証（DI-13, SEC-22）。`masterHashes.ts` の SHA-256 と一致しないファイルは拒否（`crypto.subtle.digest`）。
- `DemoClock`: offsetDays を `nnishi.demo.clockOffsetDays` に保存。`SystemClock`: 実時刻。
- `DemoGeoProvider`: メモリ上の位置（精度 5m）。`BrowserGeoProvider`: `navigator.geolocation.getCurrentPosition`（timeout 10s）。失敗時は `GEO_UNAVAILABLE`／`GEO_DENIED` を返し、デモ位置に切り替えない（SEC-27）。
- `IcsExporter implements CalendarExporter { buildFadeReminder({ districtName, date }): Result<{ filename; content }> }` — RFC 5545、CRLF、TEXT エスケープ、終日予定（色あせ開始日）。
- `InMemoryEventBus`: 登録順に await、例外は log.error して次へ、処理済み eventId を最大1,000件保持。

### 5.1 マスタデータ（public/master）

- 都市原点 lat 34.6900, lng 135.1950（架空）。1m ≒ 緯度 1/111,000°、経度 1/91,290°。市域は約 2,000m × 2,600m、南側が海（みなと地区が海に面する）。
- 地区（order 順）: `d_joka` 城下地区（歴史、#7a5ea8、北西）／`d_minato` みなと地区（港、#2f86c9、南東）／`d_honmachi` 本町地区（商店街、#d9a21b、北東）／`d_satoyama` 里山地区（里山、#4c9a4a、最北）／`d_yunosato` 湯の里地区（温泉、#d0566b、南西）。ポリゴンは5〜8頂点、互いに重ならない。
- 名所14: 城下3（`l_jo01` N西城跡、`l_jo02` 武家屋敷通り、ほか1）／本町3（`l_hm01` 本町アーケード、`l_hm02` 旧銀行館、ほか1）／みなと3（`l_mi01` 大桟橋、`l_mi02` 魚市場、ほか1）／里山3（`l_sy01` 棚田展望台、ほか2）／湯の里2（`l_yu01` 湯の里源泉、`l_yu02` 足湯公園）。
- 店舗66: 城下14（`s_jo01` 城下カフェ、`s_jo02` 丸岡和菓子店、`s_jo03` 城下茶寮、`s_jo04` 御堀端ベーカリー、ほか）／本町15／みなと13／里山12／湯の里12。ID は `s_<地区2字><連番2桁>`（地区2字: jo, hm, mi, sy, yu）。
- 同一地区内のスポット間は 60m 以上、ポリゴン境界から 15m 以上内側。各地区の `entrance` はどのスポットからも 85m 以上離す。城下の入口から地区中心へ歩くと未発見スポットが 80m 円に入る配置にする。
- shopEvents: 15件前後（クーポン・イベント）。2026-11 上旬に終わるもの（`c_jo01` 丸岡和菓子店「どら焼き1個サービス」終了日 2026-11-12、`c_jo02` 城下カフェ 終了日 2026-11-15 等）、2026-11〜2027-01、2027 春。`rivals.json`: `r_taro` おまいり番長（城下 4日ごと）、`r_hana` 花見は毎日派（みなと 3日ごと、城下 9日ごと）、`r_ken` 天六の生き字引（里山 3日ごと）、`r_mio` みおつくし（みなと 6日、湯の里 8日）、`r_sora` 中崎町カフェ部（湯の里 3日）、`r_riku` 商店街踏破中（城下 7日、里山 9日）、`r_aoi` 親子でてくてく（湯の里 10日）。**本町の背景活動は誰も持たない**（D9）。

---

## 6. presentation の契約

- `Screen { mount(root: HTMLElement): Promise<void> | void; unmount(): void }`。`AppContext { services; router; toast; effects; sheetState? }` を各画面のファクトリに渡す。
- ルート（hash）: `#/map`、`#/map/:districtId`、`#/spot/:spotId`、`#/zukan`、`#/zukan/:districtId`、`#/avatar`（下部タブ「アバター」＝着せ替え。2026-11-09 に `#/mytown` から置き換え）、`#/rank`（下部タブ「ランク」。2026-11-09 追加）、`#/ranking`、`#/settings`、`#/demo`（デモビルドのみ登録）。パラメータは Id の parse 関数で検証し、不正なら地図へ（SEC-16）。
- DOM 生成は `Common/ui/dom.ts` の `h(tag, { class, attrs, on, dataset, text }, children)` のみ。`innerHTML` 禁止。
- 各ユーザー操作のハンドラ先頭で `setCorrelationId()`、書込み系は `newOperationId()`（`crypto.randomUUID`）。
- 文字拡大: `html` に `data-text-scale="normal|large|xlarge"`、ルートフォントサイズ 16/18/20px。CSS のサイズは rem。Canvas の文字は `textScaleFactor()`（1.0/1.125/1.25）倍。
- タップ領域は最小 44×44px。色あせは「彩度・透明度・破線・小アイコン（◌）」の4重で示す（色覚配慮）。
- スマホ枠: 幅 ≥ 500px の画面では 390×844 の枠を中央に描く（発表用）。狭い画面は全画面。
- 再訪理由の見た目（`Common/ui/cards/RevisitReasonCard.ts` に集約）: 期限＝「期」／取り返し＝「取」／色あせ＝「色」／未訪問＝「未」／新着＝「新」。文字＋形（丸・菱形・四角など）で区別し、色だけに頼らない。
- 演出（EffectHost）: 訪問操作中に届いたイベントをためて、訪問完了後に **復活（おかえりボーナス込み）→ カード → 主交代（自分が主になったときのみ）→ アイテム** の順で全画面表示。各 2.5 秒で自動送り、「スキップ」で即終了。`DistrictGrown` は全画面にせず地図のパルス＋トースト。
- 歯車: 通常タップ＝設定、0.8秒長押し＝デモメニュー（デモビルドのみ）。
- 地図（2026-11-09 作り直し。ユーザー指示「地図画面を抜本的に修正」）: 実在の地理（OSM）は描かず、スポットの位置と地区の形から作る**オリジナルの「ドット絵の街」**（5m 四方のセル。src/presentation/screens/Map/town/）。生成 townGenerator（川・商店街・大通り・通り・路地・公園・境内・桜の通り抜け・高架の線路と駅・建物。市域の外にも 700m 続き、空白なし）→ 描画 townArt（160m 四方のチャンクにドット絵を焼いてキャッシュ。引いて見るときは全体図）→ 重ねる townScene（お店・名所・公衆トイレのドット絵、看板商品の吹き出し、今日だけ・クーポン、行きたい・好み、フィルタの強調、陣地、円、道筋）。ドラッグで移動・2本指／ホイールで拡大縮小（mapCamera）。お店をタップすると自分のアイコンが道に沿って歩き（townPath の A*。デモ）、お店カード（SpotCard）でチェックイン。チェックインの半径は VISIT_RADIUS_M＝80m（地図の円と同じ。旧 40m）。陣取り（territory）: 訪問したスポットのまわり 30m＋通うごとに10m（8回まで）＋Lv×6m が自分の陣地、ライバルが主の地区はその地区の4か所×45m がライバルの陣地（どちらも訪問記録から導出・保存しない・減らない）。便利情報フィルタ（今日だけ／ベビーカーOK／トイレ／子連れ／雨の日OK／行きたい・好み）と好み・行きたいは端末内（`${STORAGE_PREFIX}map.prefs`）。「今日だけ」はクーポン・イベントの最終日と、デモのみ日替わりの特典（goods.todaySpecialOf、店の約13%）。公衆トイレの位置は OSM 由来なので地図に出典を出す。
- （旧仕様。上の作り直しで置き換え）地図: 3段階ズーム（wide: 市域全体、地区名と名所のみ／district: 地区ポリゴンに合わせる、店舗が見える／near: 現在地中心で約 450m 幅（2026-11-09 ユーザー指示「地図を広めに」で 260m から拡大。右上の「広域／中間／詳細」切替で wide／district／near を直接選べる。中間は「いま見ている地区→現在地の地区→最寄りの地区」）、80m 破線円（1つだけ。2026-11-09 ユーザー指示「エリアの円は1周でOK」で 40m 円は廃止）・足あと）。地図タップ: wide は地区を選んでズーム、district/near はスポット（22px 以内）ならスポット詳細、それ以外はそこへ歩く（デモ。district は表示を保ったまま歩き、near は現在地を追う）。歩く速さは画面上で約 55px/秒（20〜90 m/秒、最長6秒。2026-11-09 ユーザー指示「高速で動くのが変。人が歩いているように」）で、描画位置は時間で補間してなめらかに動かし、自分はマイ街と同じアバター（ドット絵＋白いふち。presentation/shared/avatarSprite.ts。2026-11-09 ユーザー指示「かっこいい実際のアバターを反映」）を現在地に立たせ、歩くと1歩ごとに弾み、進む向きに左右反転する（アバターを読めないときは朱の人型バッジ）。ほかの旅人（模擬ライバル。GetOtherTravelersUseCase、地区単位）も同じドット絵のアバターで地区・詳細に立たせる（服の色・帽子・持ち物は人ごとに固定、地区の主は王冠。詳細では名前を添える）。記録は 10m 刻みで位置を更新し、20m ごとに発見判定。足あとはメモリのみ。
- 画面読み上げと E2E 用に、地図の上に不可視のスポット一覧（`data-testid="map-spot"`、`data-spot-id`、`data-x`/`data-y` は canvas 内 CSS px）を置く。

---

## 7. 品質ゲート（完了の定義）

1. `npx tsc --noEmit` エラー 0。
2. `npx vitest run` 全件成功（domain・application は必須。仕様名は日本語）。
3. `node scripts/audit/static-audit.mjs` error 0（warn は理由付き audit-ignore か修正）。
4. `npm run build` と `npm run build:demo` が成功。本番ビルドの成果物に `/demo` ルートとデモユースケースが含まれない。
5. `npm run e2e`（デモビルドを起動し 7.2 の6手順を自動操作）が成功し、各手順のスクリーンショットを `docs/demo-screenshots/` に保存。
6. `docs/audit/YYYYMMDD_static.md`・`_security.md`・`_integrity.md` を記録。

---

## 8. PoC 範囲（2026-11-09 決定：機能確認を優先し、作り込みは後回し）

**作る（実演 7.2 の6手順を通すための Must）**
- domain: §3 すべて（実装済みのものはそのまま使う）
- application: `AppServices.ts`・`dto/Dto.ts`・`events/EventBus.ts`・`ports/{SessionRepository,DemoControl}.ts`（契約は作成済み）、`EventFactory`、
  ユースケース: status / map / position / discover / visit / nearby / reasons / spotDetail / town、イベントハンドラ3つ（§4.2）、デモ5つ（§4.4）、`EnsureTravelerUseCase`、`demoSeeds.ts`
- infrastructure: KeyValueStore（localStorage・メモリ）、リポジトリ（旅人・台帳・主・ライバル行動・セッション）、保存形式（schemaVersion・version・parsers）、
  マスタ読込と検証（件数・ID・参照整合）、InMemorySpotRepository・StaticRivalRepository、SystemClock・DemoClock、DemoGeoProvider・BrowserGeoProvider、CryptoIdGenerator、InMemoryEventBus、container
- presentation: App シェル（スマホ枠・ステータスバー・下部タブ4つ・歯車）、ルーター、地図（3段階ズーム・歩行・発見・地区の成長/色あせ描画）、下シート（つまみ/半分/全画面）、スポット詳細（訪問）、演出（復活＋おかえり・銀金カード・主交代）、デモメニュー
- 検証: tsc 0 / vitest 成功 / static-audit error 0 / E2E で6手順のスクリーンショット

**後回し（PoC では作らない。タブは「準備中」表示）**
マイ街・ランキング・設定（文字拡大）画面、便利情報フィルタ、カレンダー追加（ICS）、クーポン利用、アイテム演出、ログビューア、マスタのハッシュ検証、
データ書き出し・削除、位置情報の同意画面、Canvas の作り込み、監査記録（docs/audit）、敵対的レビュー。

**後から実装したもの**
- 設定（文字拡大）画面（2026-11-09）: `screens/Settings/`（標準／大／特大の3択・プレビュー・通知と位置情報は将来項目・このアプリについて）。
  端末ごとの設定として P+'settings' に保存（旅人を切り替えても残る）し、起動時に App が最初の画面より前に当てる。
  `GetSettingsUseCase`・`UpdateTextScaleUseCase`・`SettingsRepository`／`LocalStorageSettingsRepository`。
- データの書き出し・削除（2026-11-09、DI-21・PRV-05・DI-22）: 設定画面の「データ」（`screens/Settings/DataPanel.ts`）。
  範囲は接頭辞 P の利用者のデータすべて（除外: 店舗CMS の `P+'cms.*'`、本番から見た `nnishi.demo.*`、`nnishi.debug`）。`DataPort`／`LocalStorageDataPort`。
  書き出しは JSON（`format: 'kayoimachi-user-data'`, `formatVersion: 1`）。削除は確認ダイアログ（既定のフォーカスは「やめる」）→ 物理削除 → `AppRouter.restart('#/map')` で読み込み直し、起動時の EnsureTraveler が旅人を作り直す（デモは最初のデモの状態）。
  `ExportDataUseCase`・`DeleteAllDataUseCase`。読み込み（インポート）は未着手。

---

## 9. 舞台の変更：大阪・南森町周辺（2026-11-09 決定）

ユーザー指示「MAP が現実的でないので、大阪の南森町近辺の商店街を模擬して町とお店とトイレを作る」により、架空の N西市から**実在の地理**へ変更した。
- 名所・駅・公園・神社・川・通りは**実在の名前と位置**。店舗は**架空の名前**（実在店舗への誤認・クーポン誤解を避ける）。イベントは模擬。
- 川・公園・境内・道路・公衆トイレの位置は OpenStreetMap（Nominatim 経由で取得）と Wikipedia 座標に基づく。地図に「© OpenStreetMap contributors」を表示する（ODbL）。
- 件数（5地区・名所14・店舗66）、ゲームルール、デモシードの「役割」は変えない。地区ID・スポットIDだけ変える。
- 背景（川・公園・道路・線路・駅）は `public/master/mapFeatures.json`、公衆トイレ等は `public/master/amenityPoints.json`。型は `domain/spot/MapBackdrop.ts`、`SpotRepository.backdrop()`、DTO は `MapDataDto.backdrop`。

### 9.1 地区（order 順）と旧地区の役割の対応

| ID | 名前 / shortName | テーマ | 色 | おおよその範囲（緯度・経度） | 旧役割（§4.5） |
|---|---|---|---|---|---|
| `d_minamimori` | 南森町・天満宮地区 / 南森町 | 門前町 | #7a5ea8 | 34.6930〜34.7012, 135.5078〜135.5158 | 城下（開始地区。入口＝南森町駅付近） |
| `d_tenma` | 天満地区 / 天満 | 市場と食 | #d9a21b | 34.7016〜34.7082, 135.5104〜135.5163 | 本町（主・金カード・ライバル背景なし） |
| `d_tenroku` | 天六地区 / 天六 | 暮らし | #4c9a4a | 34.7086〜34.7135, 135.5085〜135.5160 | 里山（未訪問 Lv0） |
| `d_ogimachi` | 扇町・中崎町地区 / 扇町 | 公園と路地 | #d0566b | 34.7016〜34.7082, 135.5020〜135.5102 | 湯の里（色あせ中） |
| `d_okawa` | 大川沿い地区 / 大川 | 川辺と桜 | #2f86c9 | 大川の北岸（34.6915〜34.6928, 135.5125〜135.5168）と西岸（34.6928〜34.7045, 135.5168〜135.5222）の L 字 | みなと（そろそろ色あせ） |

市域 bounds: south 34.6895, west 135.5010, north 34.7140, east 135.5245。スポットIDの地区2字: mm / tm / tr / og / ok。

### 9.2 名所（14、実在）

| ID | 名前 | 緯度, 経度 |
|---|---|---|
| l_mm01 | 大阪天満宮 | 34.69609, 135.51277 |
| l_mm02 | 天満天神繁昌亭 | 34.69680, 135.51225（境内の北側） |
| l_mm03 | 堀川戎神社 | 34.69970, 135.50885 |
| l_tm01 | 天満市場 | 34.70659, 135.51262 |
| l_tm02 | 天神橋筋商店街（天四） | 34.70300, 135.51120 |
| l_tm03 | 天満駅前の高架下 | 34.70490, 135.51232 |
| l_tr01 | 大阪くらしの今昔館 | 34.71047, 135.51143 |
| l_tr02 | 天神橋筋商店街 北の玄関（天六） | 34.71110, 135.51050 |
| l_og01 | 扇町公園 | 34.70416, 135.50915 |
| l_og02 | キッズプラザ大阪 | 34.70468, 135.50985 |
| l_og03 | 中崎町の路地 | 34.70660, 135.50400 |
| l_ok01 | 造幣局（桜の通り抜け） | 34.69519, 135.52097 |
| l_ok02 | 泉布観 | 34.69810, 135.52145 |
| l_ok03 | 南天満公園 | 34.69197, 135.51460 |

主要な線: 天神橋筋（商店街）は経度 ≒135.5117（南端 34.6904）→135.5107（北端 34.7149）のほぼ南北の直線。曽根崎通（国道1号）は緯度 ≒34.6975〜34.6982 の東西。扇町通は緯度 ≒34.7037 の東西。JR 環状線は 天満駅（34.70493, 135.51232）・桜ノ宮駅（34.70492, 135.52033）を通る東西。天満橋筋は経度 ≒135.5178（南）→135.5160（北）。
駅: 南森町 34.69770,135.51102／大阪天満宮 34.69741,135.51344／扇町 34.70381,135.51083／天満 34.70493,135.51232／天神橋筋六丁目 34.71060,135.51078／天満橋 34.69020,135.51663／北浜 34.69151,135.50758／桜ノ宮 34.70492,135.52033／中崎町 34.70686,135.50524。

### 9.3 デモシード（§4.5 の役割を新IDで）

| 地区 | 訪問 | 発見のみ |
|---|---|---|
| d_minamimori | l_mm01 T−20, T−12, T−5／s_mm01 T−12, T−5／s_mm03 T−5（6回） | l_mm02, s_mm02（クーポン c_mm01「どら焼き1個サービス」〜2026-11-12）, s_mm04 |
| d_tenma | l_tm01 T−28／l_tm02 T−26／s_tm01 T−22, T−5／s_tm02 T−18, T−2／s_tm03 T−15／l_tm03 T−12／s_tm04 T−9（計9回）。主＝旅人 | s_tm05, s_tm06, s_tm07, s_tm08, s_tm09, s_tm10, s_tm11, s_tm13, s_tm14 |
| d_okawa | l_ok01, l_ok02 T−25／s_ok02, s_ok06 T−35／l_ok03, s_ok01 T−40／s_ok08, s_ok09 T−48／s_ok05, s_ok07 T−55／s_ok10, s_ok11 T−62／s_ok12, s_ok01, l_ok01 T−70（15回・13スポット） | s_ok13 |
| d_tenroku | なし | — |
| d_ogimachi | l_og01 T−95, T−60, T−45／l_og02 T−45／s_og01 T−45／s_og02, s_og05 T−50／s_og08, s_og09 T−68／l_og03, s_og03 T−75／s_og04, s_og07 T−85／s_og11, s_og12 T−95（15回・13スポット） | — |

ライバル背景活動: おまいり番長（r_taro） d_minamimori 4日／花見は毎日派（r_hana） d_okawa 3日・d_minamimori 9日／天六の生き字引（r_ken） d_tenroku 3日／みおつくし（r_mio） d_okawa 6日・d_ogimachi 8日／中崎町カフェ部（r_sora） d_ogimachi 3日／商店街踏破中（r_riku） d_minamimori 7日・d_tenroku 9日／親子でてくてく（r_aoi） d_ogimachi 10日。**d_tenma の背景活動は誰も持たない**。
デモ既定: 開始地区（位置リセット先）= d_minamimori の entrance（南森町駅付近）。ライバル行動の既定 = r_taro が d_tenma を奪う。

---

## 10. ビジュアルデザイン：モダンな都市の生活アプリ（2026-11-09 決定）

ユーザー指示「画面が武士の時代みたい。街で使えるおしゃれなデザインに」により、和紙・朱・丸ゴシック・家紋風の札・鳥居や日の丸の絵をやめ、**都会の地図アプリ／グルメ・生活アプリのトーン**に統一する。

### 10.1 原則
- 清潔・軽い・情報が読みやすい。装飾は最小限、余白と階層で見せる。テクスチャ（紙の繊維・しみ・破れた縁）・セピア・筆文字風は使わない。
- 地図は Apple マップ／Google マップ風の淡いベースマップ。ゲーム要素（地区の色づき・建物・ピン）はその上に「重ねる情報レイヤー」として描く。
- アクセントは **コーラル #FF5A36 の1色**（現在地・主要ボタン・選択中タブ）。地区色5色は地区の識別だけに使う。
- 色だけに頼らない（色あせ＝彩度低下＋透明度＋破線＋◌アイコン＋「色あせ」チップ。再訪理由＝アイコン＋短いラベル）。

### 10.2 トークン（CSS: src/Common/ui/styles/tokens.css、Canvas: src/Common/ui/theme/palette.ts。名前は既存を保ち値を差し替える）
| 用途 | 値 |
|---|---|
| 文字 ink / sub / muted | #111827 / #374151 / #6B7280 |
| 背景 page / surface / subtle | #F5F6F8 / #FFFFFF / #F1F3F6 |
| 罫線 | #E5E7EB（hairline rgba(17,24,39,0.08)） |
| ブランド | #FF5A36、白文字用 #D63D1F、ソフト #FFEDE7 |
| 地区色（ink は白地の文字用） | 南森町 #6366F1 / #4338CA、天満 #F59E0B / #B45309、天六 #10B981 / #047857、扇町 #EC4899 / #BE185D、大川 #0EA5E9 / #0369A1 |
| 金・銀・銅 | 金 #F5B700（グラデ #FDE68A→#F59E0B→#B45309）、銀 #E5E7EB→#9CA3AF、銅 #F3C6A5→#B8693D |
| 色あせ（セピアをやめクールグレー） | #9CA3AF、ink #6B7280、soft #F1F3F6 |
| 期限 | #E11D48 / soft #FFE4E9 |
| 未発見 / 発見済み | #9CA3AF / #6B7280 |
| 地図 | 陸 #F2F4F7、街区 #EAEDF1、公園 #CDEBD5、境内 #F7E3DC（淡い朱ではなく淡いテラコッタ）、敷地 #E6E9EE、水面 #A8D8F4（ラベル #2B7BB9）、道路 白＋縁 #D9DEE5（幹線は縁 #CDD3DB）、商店街 #FFE3D9＋中心にブランド色の細い破線、鉄道 #9CA3AF＋白破線、駅 白丸＋濃グレー縁 |
| 影 | 0 1px 2px rgba(17,24,39,.06), 0 4px 12px rgba(17,24,39,.08)（大: 0 12px 32px rgba(17,24,39,.14)） |
| 角丸 | 8 / 12 / 16 / 20px、ピル 999px |

- 書体: **Noto Sans JP**（@fontsource/noto-sans-jp を Vite でバンドル＝self-host、CSP font-src 'self'）400/500/700。見出し 700、本文 400〜500、数字は tabular-nums。Canvas も同じ書体（CANVAS_FONT_FAMILY / DISPLAY_FONT_FAMILY）。丸ゴシック（M PLUS Rounded）はやめる。
- アイコン: 線のアイコン（stroke 1.75〜2、round）。src/Common/ui/icons.ts に追加する。

### 10.3 部品
- タブバー: 白、上に hairline。線アイコン＋ラベル、選択中はブランド色＋上部の短いインジケータ（またはピル背景）。
- 上部バー・ステータスバー: 白〜半透明白（背景ぼかし可）。デモバッジは小さな黒のピル。
- カード: 白、角丸 16px、影小、内側余白 16px。リストは区切り線よりカード／行の余白で区切る。
- 再訪理由チップ: アイコン＋ラベル（期限＝時計、取り返し＝旗、色あせ＝しずく/かすれ円、未訪問＝コンパス、新着＝きらめき）。漢字1字の札・ひし形は使わない。
- ボタン: 主要＝ブランド色のベタ（白文字 #D63D1F 系でコントラスト確保）、副＝白＋罫線、テキストボタン。高さ 48px、角丸 12px。
- チップ・タグ: 角丸ピル、淡い面＋濃い文字。

### 10.4 地図（Canvas）
- ベースマップ（10.2 の地図色）の上に、地区＝半透明の面（Lv1 12%・Lv2 18%・Lv3 24% 程度）＋2px の実線輪郭（Lv0 は灰色の破線輪郭のみ）。破れた紙の縁・紙の影はやめる。
- 建物＝上から見た小さな角丸の四角（地区色の濃淡2〜3色＋ごく弱い影）。Lv3 は名所に小さな旗アイコン（モダンなピン旗）。木は小さな緑の丸。
- ピン: 名所＝しずく型ピン（訪問済みは地区色の塗り＋白い星、発見済みはグレー、未発見は白地に破線と「?」）。店舗＝円形マーカー（訪問済み 地区色の塗り＋白い店アイコン、発見済み グレー、未発見 破線「?」）。回数バッジは小さな白縁の黒丸。
- ラベル: 白いピル＋影小、12px/600。地区ラベルは「南森町 Lv2」をピル＋レベルの小チップ。主は小さな王冠アイコン（線）。
- 現在地: ブランド色の丸（白縁）＋淡い外光、80m 破線円は1つだけ。
- 色あせ地区: 面をグレー化（彩度 0.15〜0.4）、輪郭は破線、「◌ 色あせ」チップ。

### 10.5 イラスト（マイ街・スポット詳細・演出・図鑑・ランキング）
- フラットなモダン都市イラスト: 角の立ったビル（窓のグリッド）、ガラス張りの店先、地区色のストライプの日よけ、街路樹、街灯、淡い空色のグラデ。鳥居・瓦屋根・日の丸・提灯などの「昔の日本」記号は使わない（名所の天満宮も、イラストは控えめな現代的アイコン表現にする）。
- 成長段階: Lv0 薄い区画線のみ → Lv1 低層の店が数軒 → Lv2 中層ビルと店が増える → Lv3 高層＋ライトアップ。色あせ＝グレースケール寄せ（形は残す）。
- 演出: 暗めの半透明の背景、中央に白いカード、カード獲得は紙吹雪（幾何学的な小片）と光沢、主交代は王冠の線アイコン、復活は灰色→色が戻るワイプ。
