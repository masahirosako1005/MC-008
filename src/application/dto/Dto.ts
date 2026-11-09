/**
 * @file 画面向け DTO（application 層 ↔ presentation 層の境界）
 * プリミティブと配列だけで構成する（docs/01 §3-6）。日付は文字列（LocalDate='YYYY-MM-DD'、Instant=ISO 8601）。
 * 文言（title/subtitle 等）は application で日本語化して渡し、presentation は表示に専念する。
 * docs/08 §4.3。PoC 範囲外の DTO（マイ街・ランキング・設定）は後で追加する。
 */

/** スポットの状態（未発見／発見済み＝シルエット／訪問済み＝カラー） */
export type SpotStatusDto = 'unknown' | 'discovered' | 'visited';

/** スポット種別 */
export type SpotKindDto = 'landmark' | 'shop';

/** 色あせ状態の種類（docs/08 D5） */
export type FadeKindDto = 'never' | 'fresh' | 'soon' | 'fading';

/** 再訪理由の種別（CLAUDE.md 4.5。表示優先順は deadline > reclaim > fade > unvisited > new） */
export type RevisitReasonKindDto = 'deadline' | 'reclaim' | 'fade' | 'unvisited' | 'new';

/** 緯度経度（描画専用。ログに出さない） */
export interface LatLngDto {
  readonly lat: number;
  readonly lng: number;
}

/** 色あせ状態 */
export interface FadeDto {
  readonly kind: FadeKindDto;
  readonly daysSinceVisit?: number;
  /** soon のとき、色あせ開始までの日数 */
  readonly daysUntilFade?: number;
  /** fading のとき 0..1（1 が最も薄い） */
  readonly progress?: number;
  /** soon / fading のとき、色あせ開始日（YYYY-MM-DD） */
  readonly fadeStartDate?: string;
}

// ---------------------------------------------------------------------------
// 地図
// ---------------------------------------------------------------------------

/** 地図に描く地区 */
export interface DistrictMapDto {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly theme: string;
  /** '#rrggbb' */
  readonly color: string;
  readonly order: number;
  readonly polygon: readonly LatLngDto[];
  readonly center: LatLngDto;
  /** 成長段階 0..3（下がらない） */
  readonly level: number;
  readonly score: number;
  /** 描く建物の数（score から導出） */
  readonly buildings: number;
  readonly visitCount: number;
  readonly fade: FadeDto;
  readonly lordName?: string;
  readonly isLordMe: boolean;
}

/** 地図に描くスポット。未発見（unknown）の店舗は name を含めない（B: 位置だけ示す）。名所は実在の名所なので未発見でも name を返す（ワイヤーフレーム 01） */
export interface MapSpotDto {
  readonly id: string;
  readonly kind: SpotKindDto;
  readonly districtId: string;
  readonly lat: number;
  readonly lng: number;
  readonly status: SpotStatusDto;
  readonly name?: string;
  readonly visitCount: number;
  readonly amenities: readonly string[];
  readonly hasActiveShopEvent: boolean;
}

/** 地図全体のデータ */
export interface MapDataDto {
  readonly today: string;
  readonly districts: readonly DistrictMapDto[];
  readonly spots: readonly MapSpotDto[];
  readonly bounds: { readonly south: number; readonly west: number; readonly north: number; readonly east: number };
  /** 地図の背景（川・公園・道路・線路・駅・公衆トイレ）。実在の地理（OSM 由来）を描く */
  readonly backdrop: MapBackdropDto;
}

/** 背景地物の種類（water=川、park=公園、shrine=神社境内、campus=敷地、arcade=商店街、road=道路、rail=鉄道） */
export type MapFeatureKindDto = 'water' | 'park' | 'shrine' | 'campus' | 'arcade' | 'road' | 'rail';

/** 背景地物（line は折れ線を widthM の太さで、area は多角形で描く） */
export interface MapFeatureDto {
  readonly id: string;
  readonly kind: MapFeatureKindDto;
  readonly name: string;
  readonly shape: 'line' | 'area';
  readonly points: readonly LatLngDto[];
  readonly widthM?: number;
}

/** 駅 */
export interface StationDto {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly lines: string;
}

/** 便利施設ポイント（公衆トイレ等。スポットではない） */
export interface AmenityPointDto {
  readonly id: string;
  readonly kind: 'toilet' | 'nursing' | 'aed';
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly note: string;
}

/** 地図の背景一式 */
export interface MapBackdropDto {
  readonly features: readonly MapFeatureDto[];
  readonly stations: readonly StationDto[];
  readonly amenityPoints: readonly AmenityPointDto[];
  /** 出典表示（地図の隅に出す） */
  readonly attribution?: string;
}

/** 現在地（描画専用。保存・ログ出力しない） */
export interface PositionDto {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number;
}

// ---------------------------------------------------------------------------
// 探索（発見・訪問・近隣・再訪理由）
// ---------------------------------------------------------------------------

/** 発見判定の入力 */
export interface DiscoverInput {
  readonly operationId: string;
}

/** 新しく発見したスポット */
export interface DiscoveredSpotDto {
  readonly id: string;
  readonly name: string;
  readonly kind: SpotKindDto;
  readonly districtId: string;
}

/** 発見判定の出力 */
export interface DiscoverOutput {
  readonly newlyDiscovered: readonly DiscoveredSpotDto[];
}

/** 訪問の入力（旅人はセッションから解決する＝SEC-01） */
export interface VisitInput {
  readonly operationId: string;
  readonly spotId: string;
}

/** 訪問の出力（加点・演出はイベントで届く） */
export interface VisitOutput {
  readonly spotId: string;
  readonly districtId: string;
  readonly localDate: string;
  /** 同じ operationId の再実行だった（何も変わっていない） */
  readonly duplicate: boolean;
}

/** 近隣スポットの入力 */
export interface NearbyInput {
  /** 返す件数（既定 8） */
  readonly limit?: number;
}

/** 近隣スポット（距離順） */
export interface NearbySpotDto {
  readonly id: string;
  readonly name?: string;
  readonly kind: SpotKindDto;
  readonly districtId: string;
  readonly districtName: string;
  readonly meters: number;
  readonly status: SpotStatusDto;
  readonly visitCount: number;
  /** 40m 以内で今日まだ訪問していない */
  readonly canVisit: boolean;
  readonly hasActiveShopEvent: boolean;
}

/** 再訪理由カード（下シート・通知で共通） */
export interface RevisitReasonDto {
  readonly kind: RevisitReasonKindDto;
  readonly title: string;
  readonly subtitle: string;
  readonly districtId: string;
  readonly spotId?: string;
  readonly shopEventId?: string;
  /** 色あせ間近（soon）のとき「カレンダーに追加」用 */
  readonly calendar?: { readonly districtName: string; readonly fadeStartDate: string };
}

// ---------------------------------------------------------------------------
// スポット詳細
// ---------------------------------------------------------------------------

/** スポット詳細の入力 */
export interface SpotDetailInput {
  readonly spotId: string;
}

/** クーポン・イベント */
export interface ShopEventDto {
  readonly id: string;
  readonly kind: 'coupon' | 'event';
  readonly title: string;
  readonly description: string;
  /** 期間内なら終了までの日数（当日終了=0）。開始前は undefined */
  readonly daysLeft?: number;
  readonly active: boolean;
  /** 開始日・終了日（YYYY-MM-DD） */
  readonly start: string;
  readonly end: string;
}

/** スポット詳細 */
export interface SpotDetailDto {
  readonly id: string;
  readonly name: string;
  readonly kind: SpotKindDto;
  readonly category: string;
  readonly districtId: string;
  readonly districtName: string;
  readonly description: string;
  readonly amenities: readonly string[];
  readonly hours: string;
  readonly partner: boolean;
  readonly status: SpotStatusDto;
  /** 現在地からの距離（位置が取れないときは undefined） */
  readonly meters?: number;
  readonly canVisit: boolean;
  /** 訪問できない理由（文言）。canVisit=true なら undefined */
  readonly visitBlockedReason?: string;
  /** あと何 m 近づけば訪問できるか */
  readonly metersToVisit?: number;
  readonly visitedToday: boolean;
  readonly visitCount: number;
  readonly districtVisitCount: number;
  readonly nextCard?: { readonly rank: 'silver' | 'gold'; readonly remainingVisits: number };
  /** 訪問日（表示用 '2026/11/02（月）'、新しい順、最大10件） */
  readonly history: readonly string[];
  readonly shopEvents: readonly ShopEventDto[];
}

// ---------------------------------------------------------------------------
// 町（地区カード）
// ---------------------------------------------------------------------------

/** 地区カード（成長Lv・色あせ状態・地区の主・次の目標） */
export interface DistrictCardDto {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly color: string;
  readonly level: number;
  readonly score: number;
  readonly buildings: number;
  readonly visitCount: number;
  readonly fade: FadeDto;
  readonly lordName?: string;
  readonly isLordMe: boolean;
  /** 主を奪われていて取り返し中 */
  readonly lordLost: boolean;
  /** 「次の目標」文言 */
  readonly nextGoalText: string;
  /** 色あせ間近（soon）のときカレンダー追加用 */
  readonly calendar?: { readonly districtName: string; readonly fadeStartDate: string };
}

/** 町全体の状態 */
export interface TownStateDto {
  readonly districts: readonly DistrictCardDto[];
}

// ---------------------------------------------------------------------------
// マイ街（アバター・カード・アイテム・ランク。docs/08 §4.3 の MyTownDto に装いを足したもの）
// ---------------------------------------------------------------------------

/** カードのランク */
export type CardRankDto = 'silver' | 'gold';

/** 獲得済みのカード */
export interface MyTownCardDto {
  readonly districtId: string;
  readonly districtName: string;
  readonly rank: CardRankDto;
  /** 獲得日（表示用 '2026/11/02（月）'） */
  readonly earnedOn: string;
}

/** 次に狙えるカード */
export interface MyTownNextCardDto {
  readonly districtId: string;
  readonly districtName: string;
  readonly rank: CardRankDto;
  readonly remainingVisits: number;
}

/** 獲得済みのアイテム */
export interface MyTownItemDto {
  readonly itemId: string;
  readonly name: string;
  /** 獲得日（表示用） */
  readonly earnedOn: string;
  /** 今アバターが持っている */
  readonly isHeld: boolean;
}

/** まだ持っていないアイテム（手に入れ方を見せる＝B 未開拓への興味） */
export interface MyTownLockedItemDto {
  readonly itemId: string;
  readonly name: string;
  /** 手に入れ方（文言） */
  readonly hint: string;
}

/** マイ街の全体 */
export interface MyTownDto {
  readonly nickname: string;
  readonly rank: { readonly name: string; readonly nextAt?: number; readonly remaining?: number };
  /** 累計ポイント（台帳の残高） */
  readonly points: number;
  /** 全地区の通った回数の合計 */
  readonly totalVisits: number;
  readonly districts: readonly DistrictCardDto[];
  readonly cards: readonly MyTownCardDto[];
  readonly nextCards: readonly MyTownNextCardDto[];
  readonly items: readonly MyTownItemDto[];
  readonly lockedItems: readonly MyTownLockedItemDto[];
  /** アバターが手に持つアイテム（undefined ならカメラ） */
  readonly heldItemId?: string;
}

/** 着せ替えの入力（itemId を省略するとカメラに戻す） */
export interface EquipItemInput {
  readonly itemId?: string;
}

/** 着せ替えの出力 */
export interface EquipItemOutput {
  readonly heldItemId?: string;
}

// ---------------------------------------------------------------------------
// 図鑑（達成率・「全n件中m件」は含めない＝CLAUDE.md 6.5）
// ---------------------------------------------------------------------------

/** 図鑑の入力 */
export interface ZukanInput {
  /** 表示する地区（URL 由来でもよい。省略時は表示順の先頭の地区） */
  readonly districtId?: string;
}

/** 図鑑の地区タブ */
export interface ZukanDistrictTabDto {
  readonly id: string;
  readonly shortName: string;
  readonly theme: string;
  /** 地区の色 '#rrggbb' */
  readonly color: string;
  /** 色あせ状態の種類（タブに ◌ を出す） */
  readonly fadeKind: FadeKindDto;
}

/** 図鑑で選んでいる地区のヘッダー（通った回数と最近いつ） */
export interface ZukanDistrictDto {
  readonly id: string;
  readonly name: string;
  readonly theme: string;
  /** 地区の色 '#rrggbb' */
  readonly color: string;
  /** 成長段階 0..3（下がらない） */
  readonly level: number;
  /** 地区に通った回数 */
  readonly visitCount: number;
  /** 最終訪問日（表示用 '2026/11/02（月）'）。未訪問なら undefined */
  readonly lastVisitLabel?: string;
  readonly fade: FadeDto;
  /** 「次の目標」文言（地区カードと同じ） */
  readonly nextGoalText: string;
}

/** 季節（訪問した季節の印に使う） */
export type SeasonDto = 'spring' | 'summer' | 'autumn' | 'winter';

/** スポットのなじみ度（同じスポットに通うほど上がる。1=訪問、2=なじみ、3=常連。下がらない） */
export type FamiliarityDto = 1 | 2 | 3;

/**
 * 図鑑のタイル。unknown のときは id・name・category を含めない（位置も名前も教えない＝B）。
 * 並びはマスタ順（名所→店舗）で、状態によって並べ替えない。
 */
export interface ZukanTileDto {
  readonly id?: string;
  readonly name?: string;
  readonly kind: SpotKindDto;
  /** 絵の形を決めるカテゴリ（unknown は undefined） */
  readonly category?: string;
  readonly status: SpotStatusDto;
  /** 通った回数（unknown・discovered は 0） */
  readonly visitCount: number;
  /** なじみ度（visited のみ） */
  readonly familiarity?: FamiliarityDto;
  /** なじみ度の呼び名（visited のみ。'訪問'／'なじみ'／'常連'） */
  readonly familiarityLabel?: string;
  /** 次のなじみ度までの文言（'あと2回で常連'。最高段階なら undefined） */
  readonly nextFamiliarityText?: string;
  /** 訪れた季節（visited のみ。春→冬の順） */
  readonly seasons?: readonly SeasonDto[];
  /** 今日訪問した */
  readonly visitedToday?: boolean;
  /** レア度（1=ノーマル … 4=レジェンド。未発見でも出す） */
  readonly rarity?: RarityDto;
  /** レア度の名前（'レジェンド' など） */
  readonly rarityName?: string;
  /** 短い入手条件（'訪問 or 店頭QR' など） */
  readonly acquisitionShort?: string;
  /** 取得方法の手順（見つける → 訪れる → レア度ごとの条件） */
  readonly acquisitionSteps?: readonly string[];
  /** レジェンドを四季すべてで訪れて「極」に覚醒した */
  readonly awakened?: boolean;
}

/** カードのレア度（1=ノーマル、2=レア、3=スーパーレア、4=レジェンド） */
export type RarityDto = 1 | 2 | 3 | 4;

/** 図鑑 */
export interface ZukanDto {
  readonly districts: readonly ZukanDistrictTabDto[];
  readonly district: ZukanDistrictDto;
  readonly tiles: readonly ZukanTileDto[];
}

// ---------------------------------------------------------------------------
// ランキング（月間リーグ。順位は回数・か所数で、ポイントではない＝D10）
// ---------------------------------------------------------------------------

/** リーグの種類（かよい／はじめまして／ルーキー） */
export type LeagueIdDto = 'kayoi' | 'hajimete' | 'rookie';

/** ランキングの1行 */
export interface RankingEntryDto {
  /** 順位（同数は同順位 1,2,2,4） */
  readonly rank: number;
  readonly name: string;
  readonly isMe: boolean;
  readonly count: number;
  /** 主をつとめている地区の短い名前（かよいリーグのみ） */
  readonly lordOf: readonly string[];
}

/** 1リーグ分 */
export interface LeagueDto {
  readonly id: LeagueIdDto;
  /** 'かよいリーグ' */
  readonly name: string;
  /** タブ用の短い名前 'かよい' */
  readonly shortName: string;
  /** 1文字のアイコン */
  readonly icon: string;
  /** どんな人が活躍できるか（1行） */
  readonly tagline: string;
  /** 順位の決め方（1行） */
  readonly rule: string;
  /** 数値の単位（'回' / 'か所'） */
  readonly unit: string;
  /** あなたが参加しているか（ルーキーは使いはじめて30日まで） */
  readonly joined: boolean;
  /** 参加状況の補足（卒業済み・卒業まであと何日 など）。無ければ undefined */
  readonly membershipNote?: string;
  /** 順位の昇順。参加していれば「あなた」を含む */
  readonly entries: readonly RankingEntryDto[];
  /** あなたの順位（不参加なら undefined） */
  readonly myRank?: number;
  /** あなたの数値（不参加でも数える） */
  readonly myCount: number;
  /** 次の一歩（「あと1回で4位」など。不参加なら応援の文言） */
  readonly nextStepText: string;
  /** 昨日の時点のあなたの順位（不参加・月が変わった直後は undefined） */
  readonly myRankYesterday?: number;
  /** すぐ上のライバル（あなたが1位・不参加なら undefined） */
  readonly rivalAbove?: RankingRivalDto;
  /** すぐ下のライバル（あなたが最下位・不参加なら undefined） */
  readonly rivalBelow?: RankingRivalDto;
  /** 表彰台（3位以内）に届くまでの数（すでに表彰台なら 0。不参加なら undefined） */
  readonly podiumGap?: number;
}

/** すぐ上・すぐ下のライバル */
export interface RankingRivalDto {
  readonly name: string;
  readonly rank: number;
  readonly count: number;
  /** 上: 追いつく（同数なら順位はあなたが上）のに必要な数＝相手の数 − あなたの数。下: あなたとの差＝あなたの数 − 相手の数 */
  readonly gap: number;
}

/** 地区の主の状況（ランキング画面の下段） */
export interface RankingLordDto {
  readonly districtId: string;
  readonly districtName: string;
  readonly lordName?: string;
  readonly isMe: boolean;
  /** ライバルに奪われて取り返し中 */
  readonly lost: boolean;
  /** 主の直近30日の回数 */
  readonly lordCount: number;
  /** 自分の直近30日の回数 */
  readonly myCount: number;
  /** 主になる（取り返す）までの回数。自分が主なら 0 */
  readonly needed: number;
}

/** ランキング画面 */
export interface RankingDto {
  /** '11月' */
  readonly monthLabel: string;
  /** 月末までの残り日数 */
  readonly daysLeft: number;
  /** 表示順（かよい→はじめまして→ルーキー） */
  readonly leagues: readonly LeagueDto[];
  /** あなたが一番上位にいる参加中のリーグ（最初に開くタブ） */
  readonly recommendedLeagueId: LeagueIdDto;
  readonly lords: readonly RankingLordDto[];
}

/**
 * 地図に出す「ほかの旅人」（模擬ライバル）。位置は地区単位だけ持つ（表示位置は presentation が地区内で決める＝CLAUDE.md 10）。
 * 同じ人が複数の地区によく来るときは、地区ごとに1件ずつ並ぶ。
 */
export interface OtherTravelerDto {
  /** 表示用の一意キー（ライバルID:地区ID） */
  readonly key: string;
  /** 表示名（例: 旅人タロウ） */
  readonly name: string;
  /** アイコンに描く1文字（例: タ） */
  readonly initial: string;
  readonly districtId: string;
  /** この地区の主か */
  readonly isLord: boolean;
}

// ---------------------------------------------------------------------------
// アプリ状態・デモ
// ---------------------------------------------------------------------------

/** ステータスバー等に出すアプリ状態 */
export interface AppStatusDto {
  readonly today: string;
  /** '2026/11/09（月）' */
  readonly dateLabel: string;
  /** '9:41' */
  readonly timeLabel: string;
  readonly isDemo: boolean;
  readonly travelerProfile: 'first' | 'regular' | 'user';
  /** デモのずらし日数（本番は undefined） */
  readonly dayOffset?: number;
}

/** 日付進行の入力 */
export interface AdvanceDateInput {
  readonly days: 1 | 30 | 90;
}

/** 日付進行の出力 */
export interface AdvanceDateOutput {
  readonly today: string;
  readonly dayOffset: number;
}

/** ライバル行動の入力 */
export interface SimulateRivalInput {
  readonly operationId: string;
  /** 既定 r_taro */
  readonly rivalId?: string;
  /** 既定 d_tenma（docs/08 §9.3） */
  readonly districtId?: string;
}

/** ライバル行動の出力 */
export interface SimulateRivalOutput {
  readonly districtId: string;
  readonly districtName: string;
  readonly rivalName: string;
  /** 主が交代したか */
  readonly changed: boolean;
}

/** 旅人切替の入力 */
export interface SwitchTravelerInput {
  readonly profile: 'first' | 'regular';
}

/** 旅人切替の出力 */
export interface SwitchTravelerOutput {
  readonly travelerId: string;
  readonly profile: 'first' | 'regular';
}

/** デモ位置の移動入力（地図タップ・歩行） */
export interface MoveDemoPositionInput {
  readonly lat: number;
  readonly lng: number;
}
