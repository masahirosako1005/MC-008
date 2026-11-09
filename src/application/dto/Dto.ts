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
  /** カテゴリ（例 'パン'）。地図の看板商品アイコンに使う（未発見の店はシルエットで描く） */
  readonly category?: string;
  /** いま開催中のクーポン・イベントのうち、終わりがいちばん近いもの（地図の「今日の情報」に出す） */
  readonly activeEvent?: MapSpotEventDto;
}

/** 地図に出す開催中のクーポン・イベント（要約） */
export interface MapSpotEventDto {
  readonly kind: 'coupon' | 'event';
  readonly title: string;
  /** 終了までの日数（当日終了=0） */
  readonly daysLeft: number;
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
  /** 訪問の半径（VISIT_RADIUS_M＝80m）以内で今日まだ訪問していない */
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
  /** アバターが身につけている部品ID（アバター画面の着せ替え。地図の自分のアバターに使う） */
  readonly avatarPartIds: readonly string[];
}

// ---------------------------------------------------------------------------
// アバター（着せ替え。部品の所持は通った実績から導出＝報酬は通いに出す）
// ---------------------------------------------------------------------------

/** 部品のレア度 */
export type AvatarRarityDto = 'N' | 'R' | 'SR' | 'SSR';

/** 着せ替えの部品1つ */
export interface AvatarPartDto {
  /** '<枠>.<種類>' */
  readonly id: string;
  readonly slot: string;
  readonly name: string;
  readonly rarity: AvatarRarityDto;
  readonly owned: boolean;
  /** 手に入れてからまだ見ていない */
  readonly isNew: boolean;
  /** 手に入れ方（文言） */
  readonly hint: string;
  /** 進み具合（いまの値・目標の値。はじめから持っている部品は 0/0） */
  readonly current: number;
  readonly target: number;
  /** 進み具合の単位（'回'・'日'・'軒' など。アイテムのように数えないものは ''） */
  readonly unit: string;
  /** 「この地区に通う」条件なら地区ID（地図で向かう） */
  readonly districtId?: string;
  /** ご当地の部品なら地区の短い名前（札に出す） */
  readonly region?: string;
  /** 季節の部品なら季節（'spring' など） */
  readonly season?: string;
}

/** コレクション（ご当地・季節のセット）1つ */
export interface AvatarSetDto {
  readonly id: string;
  readonly name: string;
  readonly kind: 'region' | 'season';
  /** 札に出す文字（地区の短い名前・季節の名前） */
  readonly label: string;
  readonly districtId?: string;
  readonly season?: string;
  readonly partIds: readonly string[];
  /** 持っている部品の数 */
  readonly owned: number;
}

/** マイコーデ1枠 */
export interface AvatarCoordDto {
  readonly index: number;
  /** 保存した部品ID（持っていない部品は外し済み）。空き枠は undefined */
  readonly partIds?: readonly string[];
}

/** アバター画面の全体 */
export interface AvatarClosetDto {
  readonly nickname: string;
  readonly rankName: string;
  readonly points: number;
  readonly totalVisits: number;
  /** 身につけている部品ID（正規化済み） */
  readonly outfit: readonly string[];
  readonly coords: readonly AvatarCoordDto[];
  readonly parts: readonly AvatarPartDto[];
  /** 見た部品をまだ保存していない（はじめて開いた）。いま持っている部品を「見た」として保存し、以降に手に入れたものだけを NEW にする */
  readonly needsSeenBaseline: boolean;
  /** いまの季節（'spring' など。デモの時計の今日から） */
  readonly season: string;
  /** コレクション（ご当地・季節のセット） */
  readonly sets: readonly AvatarSetDto[];
}

/** 着せ替えの保存の入力（どれも省略できる） */
export interface SaveAvatarInput {
  /** 身につける部品ID（持っていない部品は外して保存する） */
  readonly outfit?: readonly string[];
  /** マイコーデの枠へ保存（partIds が null なら空にする） */
  readonly coord?: { readonly index: number; readonly partIds: readonly string[] | null };
  /** 見た部品ID（NEW の印を消す） */
  readonly seenPartIds?: readonly string[];
}

/** 着せ替えの保存の出力 */
export interface SaveAvatarOutput {
  /** 保存した装い（正規化済み） */
  readonly outfit: readonly string[];
}

// ---------------------------------------------------------------------------
// 図鑑（達成率・「全n件中m件」は含めない＝CLAUDE.md 6.5）
// ---------------------------------------------------------------------------

/** 図鑑の入力 */
export interface ZukanInput {
  /** 最初に絞り込む地区（URL 由来でもよい。省略時はすべての地区） */
  readonly districtId?: string;
}

/** 図鑑の地区（絞り込みの選択肢と、カードの地区札に使う） */
export interface ZukanDistrictTabDto {
  readonly id: string;
  readonly shortName: string;
  readonly theme: string;
  /** 地区の色 '#rrggbb' */
  readonly color: string;
  /** 色あせ状態の種類（選択肢に ◌ を出す） */
  readonly fadeKind: FadeKindDto;
}

/** 季節（訪問した季節の印に使う） */
export type SeasonDto = 'spring' | 'summer' | 'autumn' | 'winter';

/** スポットのなじみ度（同じスポットに通うほど上がる。1=訪問、2=なじみ、3=常連。下がらない） */
export type FamiliarityDto = 1 | 2 | 3;

/**
 * 図鑑のタイル。2026-11-09 ユーザー指示「アイコンが？になっているけどすべて表示」で、unknown でも id・name・category を含める
 * （位置は出さない＝B。未発見のカードからスポット詳細＝地図の位置へは進めない）。
 * 並びは名所→店舗、同種は 訪問済み→発見済み→未発見（獲得したカードを先に）、同じ状態は地区の表示順→ID 順。
 */
export interface ZukanTileDto {
  readonly id?: string;
  readonly name?: string;
  readonly kind: SpotKindDto;
  /** 所属する地区（地区の絞り込みとカードの地区札に使う） */
  readonly districtId: string;
  /** 絵の形を決めるカテゴリ */
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

/** 図鑑（すべての地区のカード。地区と状態の絞り込みは画面で行う） */
export interface ZukanDto {
  /** 地区の一覧（表示順） */
  readonly districts: readonly ZukanDistrictTabDto[];
  /** 入力で指定された地区（最初の絞り込み）。省略時は undefined＝すべての地区 */
  readonly selectedDistrictId?: string;
  /** すべての地区のタイル（名所→店舗、同種は訪問済み→発見済み→未発見、同じ状態は地区の表示順→ID 順） */
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
  /** アバターの見た目を決める人ごとのキー（模擬ライバルはライバルID、それ以外は名前。地図のほかの旅人と同じ見た目になる） */
  readonly avatarKey: string;
}

/** 報酬1つ（種類はアイコンと色に使う） */
export interface RewardPrizeDto {
  readonly kind: 'gold' | 'silver' | 'bronze' | 'title' | 'item' | 'stamp' | 'flag' | 'trophy';
  /** '金メダル' / '称号「11月の常連王」' など */
  readonly name: string;
}

/** 順位報酬の1段 */
export interface RewardTierDto {
  /** '1位' / '4位〜' */
  readonly label: string;
  /** 条件の補足（'今月1回以上' など）。無ければ undefined */
  readonly condition?: string;
  readonly prizes: readonly RewardPrizeDto[];
  /** いまの順位ならこの段の報酬がもらえる */
  readonly isMine: boolean;
}

/** キープ報酬（ある順位以内を決まった時間続けて保つともらえる） */
export interface KeepRewardDto {
  readonly id: 'podium' | 'top';
  /** '表彰台（3位以内）' / '1位' */
  readonly goalLabel: string;
  /** 続けて保つ時間（時間） */
  readonly hours: number;
  readonly prize: RewardPrizeDto;
  /** achieved: 獲得済み／keeping: キープ中／not-yet: まだ条件の順位にいない（不参加も） */
  readonly state: 'achieved' | 'keeping' | 'not-yet';
  /** 続けて保っている時間（時間） */
  readonly heldHours: number;
  /** 獲得まであと何時間 */
  readonly remainingHours: number;
}

/** 1リーグの報酬 */
export interface LeagueRewardsDto {
  /** 順位報酬（上の段から） */
  readonly tiers: readonly RewardTierDto[];
  /** キープ報酬（やさしい順） */
  readonly keeps: readonly KeepRewardDto[];
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
  /** 競うもの（'今月 通った回数'） */
  readonly metric?: string;
  /** 参加できる人（'だれでも' / '使いはじめて30日以内の人だけ'） */
  readonly eligibility?: string;
  /** タブに添える違いの一言（'通った回数' / '新しい場所の数' / '30日以内の人'） */
  readonly tabHint?: string;
  /** 数値の単位（'回' / 'か所'） */
  readonly unit: string;
  /** 報酬（順位報酬とキープ報酬）。metric〜rewards と RankingDto の期間は GetRankingUseCase が必ず入れる（省略可はほかの画面のテストの手組みを壊さないため） */
  readonly rewards?: LeagueRewardsDto;
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
  /** 地区の短い名前（'南森町'。ランキング画面の小さなタイル用。省略可） */
  readonly districtShortName?: string;
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
  /** 期間（'11/1（日）〜11/30（月）'） */
  readonly periodLabel?: string;
  /** 締め（'11/30（月）23:59'） */
  readonly closeLabel?: string;
  /** 順位報酬が届く日（'12/1（火）'） */
  readonly deliveryLabel?: string;
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
  /** 表示名（例: おまいり番長） */
  readonly name: string;
  /** アイコンに描く1文字（例: タ） */
  readonly initial: string;
  readonly districtId: string;
  /** この地区の主か */
  readonly isLord: boolean;
}

// ---------------------------------------------------------------------------
// ランク（旅人ランクの状況。下部タブ「ランク」。ランクは累計ポイントで決まり、下がらない＝D11）
// ---------------------------------------------------------------------------

/** ランクの段の状態（到達済み／いまの段／まだ） */
export type RankStepStateDto = 'reached' | 'current' | 'locked';

/** ランクの1段 */
export interface RankStepDto {
  /** 段の名前（例: '常連'） */
  readonly name: string;
  /** この段に上がる累計ポイント */
  readonly min: number;
  readonly state: RankStepStateDto;
}

/** 最近のポイントの1行（新しい順） */
export interface RankPointHistoryDto {
  /** 加点した暦日 'YYYY-MM-DD'（表示は presentation で短くする） */
  readonly date: string;
  /** スポット名（マスタから消えていれば「スポット」） */
  readonly spotName: string;
  /** スポットの種別（アイコンに使う。マスタから消えていれば undefined） */
  readonly spotKind?: SpotKindDto;
  /** 地区の短い名前（マスタから消えていれば空文字） */
  readonly districtName: string;
  /** visit=訪問の基本点、welcomeBack=おかえりボーナス */
  readonly kind: 'visit' | 'welcomeBack';
  readonly points: number;
}

/** ポイントのもらい方（数値ルール（仮）をそのまま見せる） */
export interface RankPointRulesDto {
  readonly landmarkPoints: number;
  readonly shopPoints: number;
  /** おかえりボーナスの倍率（1.5） */
  readonly welcomeBackMultiplier: number;
}

/** ランク画面 */
export interface RankStatusDto {
  readonly nickname: string;
  /** いまの段 */
  readonly rank: {
    readonly name: string;
    /** 段の添字（0 が最初の段） */
    readonly index: number;
    /** 次の段の名前（最上段なら undefined） */
    readonly nextName?: string;
    /** 次の段に上がる累計ポイント（最上段なら undefined） */
    readonly nextAt?: number;
    /** 次の段まであと何ポイント（最上段なら undefined） */
    readonly remaining?: number;
  };
  /** すべての段（下から順） */
  readonly steps: readonly RankStepDto[];
  /** 累計ポイント（台帳の残高。減らない） */
  readonly points: number;
  /** 通った回数（累計） */
  readonly totalVisits: number;
  /** 訪れたスポットの数（同じスポットは1つ。網羅率は出さない） */
  readonly visitedSpots: number;
  readonly silverCards: number;
  readonly goldCards: number;
  /** あなたが主をつとめる地区の短い名前（表示順） */
  readonly lordDistricts: readonly string[];
  /** 旅の日数（はじめて訪れた日を1日目として今日が何日目か。未訪問なら undefined） */
  readonly travelDays?: number;
  /** 最近のポイント（新しい順・最大 RANK_HISTORY_LIMIT 件） */
  readonly recent: readonly RankPointHistoryDto[];
  readonly rules: RankPointRulesDto;
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
