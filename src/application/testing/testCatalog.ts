/**
 * @file テスト専用の小さなマスタ（SpotRepository・RivalRepository の偽物と固定データ）（application 層・テスト専用）
 * 本番コードから import しない。application のテストは '@/application/testing/fakes' 経由で使う。
 * 5地区（旧 N西市の ID・名前：城下・みなと・本町・里山・湯の里）に、旧デモシード（docs/08 §4.5）の配置を再現するスポットだけを置いた縮小版。
 * 2026-11-09 に本物のマスタは大阪・南森町周辺（docs/08 §9）へ変わったが、純粋な単体テストはこの旧 ID のカタログのまま使う。
 * 新しい地区ID・スポットID のデモシードを再現するカタログは scenarioCatalog.ts の buildScenarioCatalog（同じ組み立て関数 buildCatalog を使う）。
 * 座標は合成（地区は 400m 四方、スポットは 100m 間隔、入口はどのスポットからも 85m 以上離す）。offsetPoint で「スポットから n m」を作れる。
 * 地図の背景は既定で EMPTY_BACKDROP。buildSampleBackdrop で小さなサンプル（川・公園・駅・公衆トイレ）を作れる。
 */
import { createLogger } from '@/Common/logging/logger';
import { parseDistrictId, parseRivalId, parseShopEventId, parseSpotId, spotKindOfId } from '@/Common/types/Id';
import type { DistrictId, RivalId, SpotId } from '@/Common/types/Id';
import { invariant } from '@/Common/utils/assert';
import { parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { Result } from '@/Common/result/Result';
import { Rival } from '@/domain/competition/Rival';
import type { RivalRepository } from '@/domain/competition/RivalRepository';
import { EARTH_MEAN_RADIUS_M } from '@/domain/exploration/Distance';
import { boundsOf, GeoPoint } from '@/domain/exploration/GeoPoint';
import { Period } from '@/domain/revisit/Period';
import type { ShopEvent, ShopEventKind } from '@/domain/revisit/ShopEvent';
import type { Amenity } from '@/domain/spot/Amenity';
import { EMPTY_BACKDROP } from '@/domain/spot/MapBackdrop';
import type { AmenityPoint, MapBackdrop, MapFeature, Station } from '@/domain/spot/MapBackdrop';
import type { Spot } from '@/domain/spot/Spot';
import type { CityBounds, SpotRepository } from '@/domain/spot/SpotRepository';
import type { District } from '@/domain/town/District';
import { sortDistrictsByOrder } from '@/domain/town/District';

const logger = createLogger('application/testing/testCatalog');

/** 度→ラジアン */
const DEG_TO_RAD = Math.PI / 180;

/** 地区の一辺の半分（m） */
const DISTRICT_HALF_SIZE_M = 200;

/** 地区中心から入口までのずれ（m。どのスポットからも 85m 以上離れる位置） */
const ENTRANCE_OFFSET_M = { eastM: 150, northM: -150 } as const;

/**
 * テストの前提データの Result から値を取り出す（失敗は前提データの誤り＝テストのバグとして例外）。
 * @param result Result
 * @returns 成功値
 * @throws Error 失敗だった
 */
export function must<T>(result: Result<T, unknown>): T {
  const log = logger.fn('must', { ok: result.ok });
  invariant(result.ok, 'テストの前提データが不正です');
  return log.exit(result.value);
}

/**
 * 'YYYY-MM-DD' を LocalDate にする（テスト用）。
 * @param text 日付文字列
 * @returns LocalDate
 */
export function testDate(text: string): LocalDate {
  return must(parseLocalDate(text));
}

/**
 * 文字列をスポットID にする（テスト用）。
 * @param text 'l_jo01' など
 * @returns SpotId
 */
export function testSpotId(text: string): SpotId {
  return must(parseSpotId(text));
}

/**
 * 文字列を地区ID にする（テスト用）。
 * @param text 'd_joka' など
 * @returns DistrictId
 */
export function testDistrictId(text: string): DistrictId {
  return must(parseDistrictId(text));
}

/**
 * 文字列をライバルID にする（テスト用）。
 * @param text 'r_taro' など
 * @returns RivalId
 */
export function testRivalId(text: string): RivalId {
  return must(parseRivalId(text));
}

/** テスト用の市の原点（旧 N西市の原点。buildTestCatalog が使う） */
export const TEST_ORIGIN: GeoPoint = must(GeoPoint.of(34.69, 135.195));

/**
 * 基準点から東西南北に m 単位でずらした点を返す（Distance.between と同じ正距円筒近似の逆算なので、距離がほぼ一致する）。
 * @param base 基準点
 * @param offset eastM（東が正）・northM（北が正）
 * @returns ずらした点
 */
export function offsetPoint(base: GeoPoint, offset: { readonly eastM?: number; readonly northM?: number }): GeoPoint {
  const log = logger.fn('offsetPoint', { eastM: offset.eastM, northM: offset.northM });
  const lat = base.lat + ((offset.northM ?? 0) / EARTH_MEAN_RADIUS_M) / DEG_TO_RAD;
  const meanLat = ((base.lat + lat) / 2) * DEG_TO_RAD;
  const lng = base.lng + ((offset.eastM ?? 0) / (EARTH_MEAN_RADIUS_M * Math.cos(meanLat))) / DEG_TO_RAD;
  return log.exit(must(GeoPoint.of(lat, lng)));
}

/** 地区の定義（center は原点からのずれ m） */
export interface DistrictDef {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly theme: string;
  readonly order: number;
  readonly color: string;
  readonly eastM: number;
  readonly northM: number;
}

/** スポットの定義（位置は地区中心からのずれ m） */
export interface SpotDef {
  readonly id: string;
  readonly districtId: string;
  readonly name: string;
  readonly category: string;
  readonly eastM: number;
  readonly northM: number;
  readonly amenities: readonly Amenity[];
  readonly partner: boolean;
}

/** クーポン・イベントの定義 */
export interface ShopEventDef {
  readonly id: string;
  readonly spotId: string;
  readonly kind: ShopEventKind;
  readonly title: string;
  readonly start: string;
  readonly end: string;
}

/** ライバルの定義 */
export interface RivalDef {
  readonly id: string;
  readonly name: string;
  readonly patterns: readonly { readonly districtId: string; readonly intervalDays: number; readonly phase: number }[];
}

/** カタログの定義一式（buildCatalog の材料） */
export interface CatalogDefs {
  /** 市の原点（地区の位置はここからのずれ） */
  readonly origin: GeoPoint;
  readonly districts: readonly DistrictDef[];
  readonly spots: readonly SpotDef[];
  readonly shopEvents: readonly ShopEventDef[];
  /** 全ライバル（allRivals のとき全員、既定は先頭 defaultRivalCount 人） */
  readonly rivals: readonly RivalDef[];
  readonly defaultRivalCount: number;
}

/** テスト用の地区の定義（旧 N西市の ID・名前・色。center は原点からのずれ m） */
const DISTRICT_DEFS: readonly DistrictDef[] = [
  { id: 'd_joka', name: '城下地区', shortName: '城下', theme: '歴史', order: 1, color: '#7a5ea8', eastM: -500, northM: 300 },
  { id: 'd_minato', name: 'みなと地区', shortName: 'みなと', theme: '港', order: 2, color: '#2f86c9', eastM: 0, northM: -200 },
  { id: 'd_honmachi', name: '本町地区', shortName: '本町', theme: '商店街', order: 3, color: '#d9a21b', eastM: 0, northM: 300 },
  { id: 'd_satoyama', name: '里山地区', shortName: '里山', theme: '里山', order: 4, color: '#4c9a4a', eastM: 500, northM: 300 },
  { id: 'd_yunosato', name: '湯の里地区', shortName: '湯の里', theme: '温泉', order: 5, color: '#d0566b', eastM: -500, northM: -200 },
];

/** テスト用のスポットの定義（位置は地区中心からのずれ m） */
const SPOT_DEFS: readonly SpotDef[] = [
  { id: 'l_jo01', districtId: 'd_joka', name: 'N西城跡', category: '史跡', eastM: -100, northM: 100, amenities: ['toilet', 'parking', 'kids'], partner: false },
  { id: 'l_jo02', districtId: 'd_joka', name: '武家屋敷通り', category: '町並み', eastM: 0, northM: 100, amenities: ['toilet', 'parking'], partner: false },
  { id: 's_jo01', districtId: 'd_joka', name: '城下カフェ', category: 'カフェ', eastM: 100, northM: 100, amenities: ['toilet', 'rainOk', 'kids', 'nursing'], partner: true },
  { id: 's_jo02', districtId: 'd_joka', name: '丸岡和菓子店', category: '和菓子', eastM: -100, northM: 0, amenities: ['kids', 'toilet', 'stroller'], partner: true },
  { id: 's_jo03', districtId: 'd_joka', name: '城下茶寮', category: '甘味処', eastM: 0, northM: 0, amenities: ['toilet', 'kids', 'rainOk'], partner: false },
  { id: 's_jo04', districtId: 'd_joka', name: '御堀端ベーカリー', category: 'パン', eastM: 100, northM: 0, amenities: ['stroller', 'rainOk'], partner: true },
  { id: 'l_hm01', districtId: 'd_honmachi', name: '本町アーケード', category: '商店街', eastM: -100, northM: 100, amenities: ['toilet', 'rainOk', 'stroller'], partner: false },
  { id: 'l_hm02', districtId: 'd_honmachi', name: '旧銀行館', category: '建築', eastM: 0, northM: 100, amenities: ['toilet', 'rainOk'], partner: false },
  { id: 'l_hm03', districtId: 'd_honmachi', name: '時計台広場', category: '広場', eastM: 100, northM: 100, amenities: ['kids', 'parking'], partner: false },
  { id: 's_hm01', districtId: 'd_honmachi', name: '本町コロッケ', category: '総菜', eastM: -100, northM: 0, amenities: ['kids'], partner: true },
  { id: 's_hm02', districtId: 'd_honmachi', name: 'アーケード珈琲', category: 'カフェ', eastM: 0, northM: 0, amenities: ['rainOk', 'toilet', 'kids'], partner: true },
  { id: 's_hm03', districtId: 'd_honmachi', name: '本町青果', category: '青果', eastM: 100, northM: 0, amenities: ['kids', 'stroller'], partner: false },
  { id: 'l_mi01', districtId: 'd_minato', name: '大桟橋', category: '港', eastM: -100, northM: 0, amenities: ['toilet', 'parking'], partner: false },
  { id: 'l_mi02', districtId: 'd_minato', name: '魚市場', category: '市場', eastM: 0, northM: 0, amenities: ['toilet', 'rainOk'], partner: false },
  { id: 's_mi01', districtId: 'd_minato', name: 'みなと鮮魚店', category: '鮮魚', eastM: 100, northM: 0, amenities: ['parking'], partner: true },
  { id: 'l_sy01', districtId: 'd_satoyama', name: '棚田展望台', category: '展望', eastM: -50, northM: 0, amenities: ['toilet', 'parking'], partner: false },
  { id: 's_sy01', districtId: 'd_satoyama', name: '棚田おむすび', category: '食堂', eastM: 50, northM: 0, amenities: ['kids', 'toilet'], partner: true },
  { id: 'l_yu01', districtId: 'd_yunosato', name: '湯の里源泉', category: '温泉', eastM: -100, northM: 0, amenities: ['toilet', 'parking', 'kids'], partner: false },
  { id: 'l_yu02', districtId: 'd_yunosato', name: '足湯公園', category: '公園', eastM: 0, northM: 0, amenities: ['kids', 'nursing'], partner: false },
  { id: 's_yu01', districtId: 'd_yunosato', name: '湯の里 外湯', category: '温泉', eastM: 100, northM: 0, amenities: ['toilet', 'rainOk'], partner: false },
];

/** テスト用のクーポン・イベントの定義（旧マスタから抜粋。2026-11-09 基準で期限前・期間中・開始前がそろう） */
const SHOP_EVENT_DEFS: readonly ShopEventDef[] = [
  { id: 'c_jo01', spotId: 's_jo02', kind: 'coupon', title: 'どら焼き1個サービス', start: '2026-11-01', end: '2026-11-12' },
  { id: 'c_jo02', spotId: 's_jo01', kind: 'coupon', title: 'ドリンク50円引き', start: '2026-11-01', end: '2026-11-15' },
  { id: 'c_jo03', spotId: 'l_jo01', kind: 'event', title: '城下 秋まつり', start: '2026-10-25', end: '2026-11-30' },
  { id: 'c_hm01', spotId: 's_hm02', kind: 'coupon', title: 'モーニング50円引き', start: '2026-11-01', end: '2026-11-30' },
  { id: 'c_mi01', spotId: 's_mi01', kind: 'coupon', title: '干物1枚おまけ', start: '2026-11-05', end: '2026-11-20' },
  { id: 'c_mi02', spotId: 'l_mi02', kind: 'event', title: '冬の蟹まつり', start: '2026-12-05', end: '2027-01-31' },
  { id: 'c_yu01', spotId: 'l_yu02', kind: 'event', title: '湯けむり灯籠まつり', start: '2026-12-20', end: '2027-01-20' },
];

/** テスト用のライバルの定義（旧 rivals.json と同じ。既定はおまいり番長と花見は毎日派の2人。本町の背景活動は誰も持たない＝D9） */
const RIVAL_DEFS: readonly RivalDef[] = [
  { id: 'r_taro', name: 'おまいり番長', patterns: [{ districtId: 'd_joka', intervalDays: 4, phase: 1 }] },
  { id: 'r_hana', name: '花見は毎日派', patterns: [{ districtId: 'd_minato', intervalDays: 3, phase: 0 }, { districtId: 'd_joka', intervalDays: 9, phase: 4 }] },
  { id: 'r_ken', name: '天六の生き字引', patterns: [{ districtId: 'd_satoyama', intervalDays: 3, phase: 2 }] },
  { id: 'r_mio', name: 'みおつくし', patterns: [{ districtId: 'd_minato', intervalDays: 6, phase: 3 }, { districtId: 'd_yunosato', intervalDays: 8, phase: 5 }] },
  { id: 'r_sora', name: '中崎町カフェ部', patterns: [{ districtId: 'd_yunosato', intervalDays: 3, phase: 1 }] },
  { id: 'r_riku', name: '商店街踏破中', patterns: [{ districtId: 'd_joka', intervalDays: 7, phase: 2 }, { districtId: 'd_satoyama', intervalDays: 9, phase: 6 }] },
  { id: 'r_aoi', name: '親子でてくてく', patterns: [{ districtId: 'd_yunosato', intervalDays: 10, phase: 7 }] },
];

/** 旧 ID のカタログの定義一式（既定のライバルはおまいり番長・花見は毎日派の2人） */
const LEGACY_CATALOG_DEFS: CatalogDefs = Object.freeze({
  origin: TEST_ORIGIN, districts: DISTRICT_DEFS, spots: SPOT_DEFS, shopEvents: SHOP_EVENT_DEFS, rivals: RIVAL_DEFS, defaultRivalCount: 2,
});

/**
 * 地区の定義から District を作る（400m 四方の正方形、入口は中心から南東へずらした点）。
 * @param def 地区の定義
 * @param origin 市の原点
 * @returns District
 */
function buildDistrict(def: DistrictDef, origin: GeoPoint): District {
  const log = logger.fn('buildDistrict', { id: def.id });
  const center = offsetPoint(origin, { eastM: def.eastM, northM: def.northM });
  const h = DISTRICT_HALF_SIZE_M;
  const polygon = [[-h, h], [h, h], [h, -h], [-h, -h]].map(([eastM, northM]) => offsetPoint(center, { eastM: eastM ?? 0, northM: northM ?? 0 }));
  const district: District = Object.freeze({
    id: testDistrictId(def.id), name: def.name, shortName: def.shortName, theme: def.theme, order: def.order, color: def.color,
    center, entrance: offsetPoint(center, ENTRANCE_OFFSET_M), polygon: Object.freeze(polygon),
  });
  return log.exit(district);
}

/**
 * スポットの定義から Spot を作る（位置は所属地区の中心からのずれ）。
 * @param def スポットの定義
 * @param districts 地区（所属地区の中心を引く）
 * @returns Spot
 * @throws Error 所属地区が無い（前提データの誤り）
 */
function buildSpot(def: SpotDef, districts: readonly District[]): Spot {
  const log = logger.fn('buildSpot', { id: def.id });
  const district = districts.find((candidate) => candidate.id === def.districtId);
  invariant(district !== undefined, `テスト用スポット ${def.id} の地区がありません`);
  const id = testSpotId(def.id);
  const spot: Spot = Object.freeze({
    id, kind: spotKindOfId(id), districtId: district.id, name: def.name, point: offsetPoint(district.center, { eastM: def.eastM, northM: def.northM }),
    category: def.category, description: `${def.name}の説明（テスト用）`, amenities: Object.freeze([...def.amenities]), hours: '9:00–17:00', partner: def.partner,
  });
  return log.exit(spot);
}

/**
 * クーポン・イベントの定義から ShopEvent を作る。
 * @param def 定義
 * @param spots スポット（地区を引く）
 * @returns ShopEvent
 * @throws Error 対象スポットが無い（前提データの誤り）
 */
function buildShopEvent(def: ShopEventDef, spots: readonly Spot[]): ShopEvent {
  const log = logger.fn('buildShopEvent', { id: def.id });
  const spot = spots.find((candidate) => candidate.id === def.spotId);
  invariant(spot !== undefined, `テスト用クーポン・イベント ${def.id} のスポットがありません`);
  const event: ShopEvent = Object.freeze({
    id: must(parseShopEventId(def.id)), spotId: spot.id, districtId: spot.districtId, kind: def.kind, title: def.title,
    description: `${def.title}の説明（テスト用）`, period: must(Period.of(testDate(def.start), testDate(def.end))),
  });
  return log.exit(event);
}

/**
 * ライバルの定義から Rival を作る（Rival.of で不変条件を検証）。
 * @param def 定義
 * @returns Rival
 */
function buildRival(def: RivalDef): Rival {
  const log = logger.fn('buildRival', { id: def.id });
  const patterns = def.patterns.map((p) => ({ districtId: testDistrictId(p.districtId), intervalDays: p.intervalDays, phase: p.phase }));
  return log.exit(must(Rival.of({ id: testRivalId(def.id), name: def.name, patterns })));
}

/**
 * 基準点の近くに小さな地図の背景（川1・公園1・駅1・公衆トイレ1）を作る（GetMapDataUseCase の DTO 変換を確かめる用）。
 * @param origin 置く場所の基準点
 * @returns 凍結済みの MapBackdrop（出典つき）
 */
export function buildSampleBackdrop(origin: GeoPoint): MapBackdrop {
  const log = logger.fn('buildSampleBackdrop');
  /** 基準点から東へ eastM・北へ northM ずらした点 */
  const at = (eastM: number, northM: number): GeoPoint => offsetPoint(origin, { eastM, northM });
  const features: readonly MapFeature[] = [
    { id: 'f_test_river', kind: 'water', name: 'テスト川', shape: 'line', widthM: 60, points: [at(-900, -700), at(900, -650)] },
    { id: 'f_test_park', kind: 'park', name: 'テスト公園', shape: 'area', points: [at(-50, -50), at(50, -50), at(50, 50), at(-50, 50)] },
  ];
  const stations: readonly Station[] = [{ id: 'st_test', name: 'テスト駅', point: at(0, -120), lines: 'テスト線' }];
  const amenityPoints: readonly AmenityPoint[] = [{ id: 'a_test_toilet', kind: 'toilet', name: '公衆トイレ', point: at(20, 0), note: 'テスト公園内' }];
  return log.exit(Object.freeze({ features, stations, amenityPoints, attribution: '© OpenStreetMap contributors' }));
}

/** TestSpotRepository の入力 */
export interface TestSpotData {
  readonly districts: readonly District[];
  readonly spots: readonly Spot[];
  readonly shopEvents: readonly ShopEvent[];
  /** 地図の背景（省略時 EMPTY_BACKDROP） */
  readonly backdrop?: MapBackdrop;
}

/** テスト用のマスタ参照（読込後は不変。InMemorySpotRepository と同じ振る舞い） */
export class TestSpotRepository implements SpotRepository {
  private readonly districts: readonly District[];
  private readonly spotById: ReadonlyMap<SpotId, Spot>;

  /**
   * マスタの配列から作る（地区は order 昇順に並べ替える）。
   * @param data 地区・スポット・クーポン/イベント
   */
  constructor(private readonly data: TestSpotData) {
    this.districts = Object.freeze(sortDistrictsByOrder(data.districts));
    this.spotById = new Map(data.spots.map((spot) => [spot.id, spot]));
  }

  /**
   * 全スポットを返す。
   * @returns 全スポット（定義順）
   */
  allSpots(): readonly Spot[] {
    return this.data.spots;
  }

  /**
   * ID でスポットを探す。
   * @param id スポットID
   * @returns スポット。無ければ undefined
   */
  findSpot(id: SpotId): Spot | undefined {
    return this.spotById.get(id);
  }

  /**
   * 地区内のスポットを返す。
   * @param id 地区ID
   * @returns 地区内のスポット（定義順）
   */
  spotsInDistrict(id: DistrictId): readonly Spot[] {
    return this.data.spots.filter((spot) => spot.districtId === id);
  }

  /**
   * 全地区を返す。
   * @returns 全地区（order 昇順）
   */
  allDistricts(): readonly District[] {
    return this.districts;
  }

  /**
   * ID で地区を探す。
   * @param id 地区ID
   * @returns 地区。無ければ undefined
   */
  findDistrict(id: DistrictId): District | undefined {
    return this.districts.find((district) => district.id === id);
  }

  /**
   * 全クーポン・イベントを返す。
   * @returns 全クーポン・イベント
   */
  allShopEvents(): readonly ShopEvent[] {
    return this.data.shopEvents;
  }

  /**
   * スポットのクーポン・イベントを返す。
   * @param id スポットID
   * @returns そのスポットのクーポン・イベント
   */
  shopEventsForSpot(id: SpotId): readonly ShopEvent[] {
    return this.data.shopEvents.filter((event) => event.spotId === id);
  }

  /**
   * 市域の範囲（全地区のポリゴンを囲む矩形）を返す。
   * @returns 市域の範囲
   */
  cityBounds(): CityBounds {
    const log = logger.fn('cityBounds', { districts: this.districts.length });
    const bounds = boundsOf(this.districts.flatMap((district) => district.polygon));
    invariant(bounds !== undefined, 'テスト用マスタに地区がありません');
    return log.exit(bounds);
  }

  /**
   * 地図の背景を返す。
   * @returns 作成時に渡した背景（無ければ EMPTY_BACKDROP）
   */
  backdrop(): MapBackdrop {
    return this.data.backdrop ?? EMPTY_BACKDROP;
  }
}

/** テスト用のライバルのマスタ */
export class TestRivalRepository implements RivalRepository {
  /**
   * ライバルの配列から作る。
   * @param rivals ライバル（この順で allRivals が返す）
   */
  constructor(private readonly rivals: readonly Rival[]) {}

  /**
   * すべてのライバルを返す。
   * @returns ライバル
   */
  allRivals(): readonly Rival[] {
    return this.rivals;
  }

  /**
   * ID でライバルを探す。
   * @param id ライバルID
   * @returns ライバル。無ければ undefined
   */
  findRival(id: RivalId): Rival | undefined {
    return this.rivals.find((rival) => rival.id === id);
  }
}

/** buildTestCatalog・buildCatalog の選択肢 */
export interface TestCatalogOptions {
  /** true ならライバル7人（既定はおまいり番長・花見は毎日派の2人） */
  readonly allRivals?: boolean;
  /** 地図の背景（既定 EMPTY_BACKDROP） */
  readonly backdrop?: MapBackdrop;
}

/** テスト用のマスタ一式 */
export interface TestCatalog {
  readonly spots: TestSpotRepository;
  readonly rivals: TestRivalRepository;
}

/**
 * カタログの定義一式からマスタ一式を作る（buildTestCatalog と scenarioCatalog の buildScenarioCatalog が使う）。
 * @param defs 定義一式
 * @param options ライバルの人数・地図の背景
 * @returns SpotRepository と RivalRepository の偽物
 */
export function buildCatalog(defs: CatalogDefs, options: TestCatalogOptions = {}): TestCatalog {
  const log = logger.fn('buildCatalog', { districts: defs.districts.length, allRivals: options.allRivals === true });
  const districts = defs.districts.map((def) => buildDistrict(def, defs.origin));
  const spots = defs.spots.map((def) => buildSpot(def, districts));
  const shopEvents = defs.shopEvents.map((def) => buildShopEvent(def, spots));
  const rivalDefs = options.allRivals === true ? defs.rivals : defs.rivals.slice(0, defs.defaultRivalCount);
  const backdrop = options.backdrop === undefined ? {} : { backdrop: options.backdrop };
  const catalog: TestCatalog = Object.freeze({
    spots: new TestSpotRepository({ districts, spots, shopEvents, ...backdrop }),
    rivals: new TestRivalRepository(rivalDefs.map(buildRival)),
  });
  return log.exit(catalog);
}

/**
 * テスト用の小さなマスタ一式を作る（旧 N西市の ID）。
 * 5地区（城下・みなと・本町・里山・湯の里）・20スポット（旧デモシードで使うもの）・クーポン/イベント7件・ライバル2人（allRivals で7人）。
 * @param options 選択肢
 * @returns SpotRepository と RivalRepository の偽物
 */
export function buildTestCatalog(options: TestCatalogOptions = {}): TestCatalog {
  const log = logger.fn('buildTestCatalog', { allRivals: options.allRivals === true });
  return log.exit(buildCatalog(LEGACY_CATALOG_DEFS, options));
}

/**
 * マスタからスポットを引く（テスト用。無ければ前提データの誤り）。
 * @param spots マスタ参照
 * @param id スポットID の文字列
 * @returns スポット
 * @throws Error マスタに無い
 */
export function spotOf(spots: SpotRepository, id: string): Spot {
  const log = logger.fn('spotOf', { id });
  const spot = spots.findSpot(testSpotId(id));
  invariant(spot !== undefined, `テスト用マスタにスポット ${id} がありません`);
  return log.exit(spot);
}

/**
 * マスタから地区を引く（テスト用。無ければ前提データの誤り）。
 * @param spots マスタ参照
 * @param id 地区ID の文字列
 * @returns 地区
 * @throws Error マスタに無い
 */
export function districtOf(spots: SpotRepository, id: string): District {
  const log = logger.fn('districtOf', { id });
  const district = spots.findDistrict(testDistrictId(id));
  invariant(district !== undefined, `テスト用マスタに地区 ${id} がありません`);
  return log.exit(district);
}
