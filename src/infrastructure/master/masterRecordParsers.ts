/**
 * @file マスタ JSON の1レコード（地区・スポット・クーポン/イベント・ライバル・市域）の検証（infrastructure/master 層の境界）
 * unknown を検証して domain 型にする（DI-01, DI-13, SEC-16, SEC-22）。項目の制約は public/master/master.schema.json に合わせる。
 * 失敗は「破った規則名」（例: 'id', 'color', 'spotRef'）を error に入れて返し、ファイル名・位置は呼び出し側（masterValidators）が付ける。
 * 値そのものはエラーやログに入れない。
 */
import { createLogger } from '@/Common/logging/logger';
import { fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseDistrictId, parseRivalId, parseShopEventId, parseSpotId, spotKindOfId } from '@/Common/types/Id';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import { codePointLength, hasControlChars, isRecord } from '@/Common/utils/guards';
import { Rival } from '@/domain/competition/Rival';
import type { RivalPattern } from '@/domain/competition/Rival';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import { Period } from '@/domain/revisit/Period';
import { isShopEventKind } from '@/domain/revisit/ShopEvent';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import { AMENITIES, isAmenity } from '@/domain/spot/Amenity';
import type { Amenity } from '@/domain/spot/Amenity';
import type { Spot, SpotKind } from '@/domain/spot/Spot';
import type { CityBounds } from '@/domain/spot/SpotRepository';
import { isHexColor } from '@/domain/town/District';
import type { District } from '@/domain/town/District';

const logger = createLogger('infrastructure/master/masterRecordParsers');

/** レコード検証の結果（失敗は破った規則名） */
export type RecordResult<T> = Result<T, string>;

/** 文字列項目の最大文字数（master.schema.json に合わせる。説明文は表示崩れを防ぐ上限だけ見る） */
export const TEXT_LIMITS = Object.freeze({
  districtName: 20,
  shortName: 8,
  theme: 12,
  spotName: 20,
  category: 12,
  description: 120,
  hours: 40,
  eventTitle: 30,
  eventDescription: 80,
  rivalName: 20,
});

/** 地区ポリゴンの頂点数の範囲（master.schema.json） */
export const POLYGON_VERTICES = Object.freeze({ min: 5, max: 8 });
/** 表示順の範囲 */
export const DISTRICT_ORDER = Object.freeze({ min: 1, max: 99 });
/** ライバルの背景活動の件数・間隔・位相の範囲 */
export const RIVAL_LIMITS = Object.freeze({ maxPatterns: 5, maxIntervalDays: 60 });

/**
 * 規則違反の失敗を作る。
 * @param rule 破った規則名
 * @returns 失敗（error は規則名）
 */
function bad(rule: string): RecordResult<never> {
  return fail(rule);
}

/**
 * 表示用の文字列として正しいか判定する（空白だけでない・制御文字なし・最大文字数以内）。
 * @param value 判定する値
 * @param maxLength 最大文字数（コードポイント）
 * @returns 正しければ true
 */
export function isDisplayText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !hasControlChars(value) && codePointLength(value) <= maxLength;
}

/**
 * 整数の範囲内か判定する。
 * @param value 判定する値
 * @param range 最小・最大（両端を含む）
 * @returns 範囲内の整数なら true
 */
function isIntegerIn(value: unknown, range: { readonly min: number; readonly max: number }): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= range.min && value <= range.max;
}

/**
 * 市域の範囲（districts.json の city.bounds）を検証する。
 * @param raw 未検証の city
 * @returns 成功: 市域。失敗: 'city' / 'bounds'
 */
export function parseCityBounds(raw: unknown): RecordResult<CityBounds> {
  const log = logger.fn('parseCityBounds');
  if (!isRecord(raw) || !isDisplayText(raw['name'], TEXT_LIMITS.districtName)) return log.fail(bad('city'));
  const bounds = raw['bounds'];
  if (!isRecord(bounds)) return log.fail(bad('bounds'));
  const southWest = GeoPoint.fromUnknown({ lat: bounds['south'], lng: bounds['west'] });
  const northEast = GeoPoint.fromUnknown({ lat: bounds['north'], lng: bounds['east'] });
  if (!southWest.ok || !northEast.ok) return log.fail(bad('bounds'));
  if (southWest.value.lat >= northEast.value.lat || southWest.value.lng >= northEast.value.lng) return log.fail(bad('bounds'));
  return log.exit(ok(Object.freeze({ south: southWest.value.lat, west: southWest.value.lng, north: northEast.value.lat, east: northEast.value.lng })));
}

/**
 * 地区ポリゴン（頂点の配列）を検証する。
 * @param raw 未検証の値
 * @returns 成功: 凍結済みの頂点列。失敗: 'polygon'
 */
function parsePolygon(raw: unknown): RecordResult<readonly GeoPoint[]> {
  const log = logger.fn('parsePolygon');
  if (!Array.isArray(raw)) return log.fail(bad('polygon'));
  const items: readonly unknown[] = raw;
  if (items.length < POLYGON_VERTICES.min || items.length > POLYGON_VERTICES.max) return log.fail(bad('polygon'));
  const points: GeoPoint[] = [];
  for (const item of items) {
    const point = GeoPoint.fromUnknown(item);
    if (!point.ok) return log.fail(bad('polygon'));
    points.push(point.value);
  }
  return log.exit(ok(Object.freeze(points)));
}

/**
 * 地区1件を検証する。
 * @param raw 未検証の値
 * @returns 成功: 凍結済みの District。失敗: 規則名（shape / id / name / shortName / theme / order / color / center / entrance / polygon）
 */
export function parseDistrictRecord(raw: unknown): RecordResult<District> {
  const log = logger.fn('parseDistrictRecord');
  if (!isRecord(raw)) return log.fail(bad('shape'));
  const id = parseDistrictId(raw['id']);
  if (!id.ok) return log.fail(bad('id'));
  const { name, shortName, theme, order, color } = raw;
  if (!isDisplayText(name, TEXT_LIMITS.districtName)) return log.fail(bad('name'));
  if (!isDisplayText(shortName, TEXT_LIMITS.shortName)) return log.fail(bad('shortName'));
  if (!isDisplayText(theme, TEXT_LIMITS.theme)) return log.fail(bad('theme'));
  if (!isIntegerIn(order, DISTRICT_ORDER)) return log.fail(bad('order'));
  if (!isHexColor(color)) return log.fail(bad('color'));
  const center = GeoPoint.fromUnknown(raw['center']);
  if (!center.ok) return log.fail(bad('center'));
  const entrance = GeoPoint.fromUnknown(raw['entrance']);
  if (!entrance.ok) return log.fail(bad('entrance'));
  const polygon = parsePolygon(raw['polygon']);
  if (!polygon.ok) return log.fail(polygon);
  const district: District = { id: id.value, name, shortName, theme, order, color: color.toLowerCase(), center: center.value, entrance: entrance.value, polygon: polygon.value };
  return log.exit(ok(Object.freeze(district)));
}

/**
 * 便利情報の配列を検証する（AMENITIES の値のみ・重複なし）。
 * @param raw 未検証の値
 * @returns 成功: 凍結済みの便利情報。失敗: 'amenities'
 */
function parseAmenities(raw: unknown): RecordResult<readonly Amenity[]> {
  const log = logger.fn('parseAmenities');
  if (!Array.isArray(raw)) return log.fail(bad('amenities'));
  const items: readonly unknown[] = raw;
  if (items.length > AMENITIES.length || new Set(items).size !== items.length) return log.fail(bad('amenities'));
  const amenities: Amenity[] = [];
  for (const item of items) {
    if (!isAmenity(item)) return log.fail(bad('amenities'));
    amenities.push(item);
  }
  return log.exit(ok(Object.freeze(amenities)));
}

/**
 * スポットの文字列項目（名前・分類・説明・営業時間）を検証する。
 * @param raw 未検証のレコード
 * @returns 成功: 4項目。失敗: 'name' / 'category' / 'description' / 'hours'
 */
function parseSpotTexts(raw: Readonly<Record<string, unknown>>): RecordResult<Pick<Spot, 'name' | 'category' | 'description' | 'hours'>> {
  const log = logger.fn('parseSpotTexts');
  const { name, category, description, hours } = raw;
  if (!isDisplayText(name, TEXT_LIMITS.spotName)) return log.fail(bad('name'));
  if (!isDisplayText(category, TEXT_LIMITS.category)) return log.fail(bad('category'));
  if (!isDisplayText(description, TEXT_LIMITS.description)) return log.fail(bad('description'));
  if (!isDisplayText(hours, TEXT_LIMITS.hours)) return log.fail(bad('hours'));
  return log.exit(ok({ name, category, description, hours }));
}

/**
 * スポット1件（名所 or 店舗）を検証する。ID の接頭辞（l_ / s_）と種別の一致、名所は店舗協力なし（partner=false）も見る。
 * @param raw 未検証の値
 * @param kind ファイルが表す種別（landmarks.json → 'landmark'、shops.json → 'shop'）
 * @returns 成功: 凍結済みの Spot。失敗: 規則名（shape / id / kind / districtId / point / amenities / partner ほか文字列項目名）
 */
export function parseSpotRecord(raw: unknown, kind: SpotKind): RecordResult<Spot> {
  const log = logger.fn('parseSpotRecord', { kind });
  if (!isRecord(raw)) return log.fail(bad('shape'));
  const id = parseSpotId(raw['id']);
  if (!id.ok) return log.fail(bad('id'));
  if (spotKindOfId(id.value) !== kind) return log.fail(bad('kind'));
  const districtId = parseDistrictId(raw['districtId']);
  if (!districtId.ok) return log.fail(bad('districtId'));
  const point = GeoPoint.fromUnknown({ lat: raw['lat'], lng: raw['lng'] });
  if (!point.ok) return log.fail(bad('point'));
  const texts = parseSpotTexts(raw);
  if (!texts.ok) return log.fail(texts);
  const amenities = parseAmenities(raw['amenities']);
  if (!amenities.ok) return log.fail(amenities);
  const partner = raw['partner'];
  if (typeof partner !== 'boolean' || (kind === 'landmark' && partner)) return log.fail(bad('partner'));
  const spot: Spot = { id: id.value, kind, districtId: districtId.value, point: point.value, ...texts.value, amenities: amenities.value, partner };
  return log.exit(ok(Object.freeze(spot)));
}

/**
 * クーポン・イベント1件を検証する。地区はスポットの地区から決める（参照整合は呼び出し側の spotDistrict で解決）。
 * @param raw 未検証の値
 * @param spotDistrict スポットID → 地区ID（存在しないスポットは undefined）
 * @returns 成功: 凍結済みの ShopEvent。失敗: 規則名（shape / id / spotId / spotRef / kind / title / description / period）
 */
export function parseShopEventRecord(raw: unknown, spotDistrict: (id: SpotId) => DistrictId | undefined): RecordResult<ShopEvent> {
  const log = logger.fn('parseShopEventRecord');
  if (!isRecord(raw)) return log.fail(bad('shape'));
  const id = parseShopEventId(raw['id']);
  if (!id.ok) return log.fail(bad('id'));
  const spotId = parseSpotId(raw['spotId']);
  if (!spotId.ok) return log.fail(bad('spotId'));
  const districtId = spotDistrict(spotId.value);
  if (districtId === undefined) return log.fail(bad('spotRef'));
  const { kind, title, description } = raw;
  if (!isShopEventKind(kind)) return log.fail(bad('kind'));
  if (!isDisplayText(title, TEXT_LIMITS.eventTitle)) return log.fail(bad('title'));
  if (!isDisplayText(description, TEXT_LIMITS.eventDescription)) return log.fail(bad('description'));
  const period = Period.fromUnknown(raw['start'], raw['end']);
  if (!period.ok) return log.fail(bad('period'));
  return log.exit(ok(Object.freeze({ id: id.value, spotId: spotId.value, districtId, kind, title, description, period: period.value })));
}

/**
 * ライバルの背景活動1件を検証する（地区の参照整合・間隔・位相）。
 * @param raw 未検証の値
 * @param hasDistrict 地区ID が存在するか
 * @returns 成功: RivalPattern。失敗: 'pattern' / 'districtRef' / 'intervalDays' / 'phase'
 */
function parseRivalPattern(raw: unknown, hasDistrict: (id: DistrictId) => boolean): RecordResult<RivalPattern> {
  const log = logger.fn('parseRivalPattern');
  if (!isRecord(raw)) return log.fail(bad('pattern'));
  const districtId = parseDistrictId(raw['districtId']);
  if (!districtId.ok) return log.fail(bad('pattern'));
  if (!hasDistrict(districtId.value)) return log.fail(bad('districtRef'));
  const { intervalDays, phase } = raw;
  if (!isIntegerIn(intervalDays, { min: 1, max: RIVAL_LIMITS.maxIntervalDays })) return log.fail(bad('intervalDays'));
  if (!isIntegerIn(phase, { min: 0, max: intervalDays - 1 })) return log.fail(bad('phase'));
  return log.exit(ok({ districtId: districtId.value, intervalDays, phase }));
}

/**
 * ライバル1件を検証する（背景活動は 1〜5 件、同じ地区は1件まで＝Rival.of の不変条件）。
 * @param raw 未検証の値
 * @param hasDistrict 地区ID が存在するか
 * @returns 成功: 凍結済みの Rival。失敗: 規則名（shape / id / name / patterns / districtRef / intervalDays / phase / rival）
 */
export function parseRivalRecord(raw: unknown, hasDistrict: (id: DistrictId) => boolean): RecordResult<Rival> {
  const log = logger.fn('parseRivalRecord');
  if (!isRecord(raw)) return log.fail(bad('shape'));
  const id = parseRivalId(raw['id']);
  if (!id.ok) return log.fail(bad('id'));
  const name = raw['name'];
  if (!isDisplayText(name, TEXT_LIMITS.rivalName)) return log.fail(bad('name'));
  const rawPatterns = raw['patterns'];
  if (!Array.isArray(rawPatterns) || rawPatterns.length < 1 || rawPatterns.length > RIVAL_LIMITS.maxPatterns) return log.fail(bad('patterns'));
  const patterns: RivalPattern[] = [];
  for (const item of rawPatterns as readonly unknown[]) {
    const pattern = parseRivalPattern(item, hasDistrict);
    if (!pattern.ok) return log.fail(pattern);
    patterns.push(pattern.value);
  }
  const rival = Rival.of({ id: id.value, name, patterns });
  return rival.ok ? log.exit(ok(rival.value)) : log.fail(bad('rival'));
}
