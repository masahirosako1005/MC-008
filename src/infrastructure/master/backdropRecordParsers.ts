/**
 * @file 地図の背景（mapFeatures.json の地物・駅）と便利施設ポイント（amenityPoints.json）の1レコードの検証（infrastructure/master 層の境界）
 * unknown を検証して domain/spot/MapBackdrop の型にする（DI-01, DI-13, SEC-16, SEC-22）。2026-11-09 の舞台変更（docs/08 §9）で追加。
 * 見る規則: ID の正規表現・種類（kind / shape）・座標（有効な緯度経度で、許された範囲の内側）・頂点数・線の太さ・文字列長。
 * 制約は public/master/master.schema.json（scripts/master/source/schema.mjs）と scripts/master の check-master に合わせる。
 * 失敗は「破った規則名」（例: 'id', 'kind', 'points', 'outsideArea'）を error に入れて返す。ファイル名・位置は呼び出し側（backdropValidators）が付ける。
 * 値そのもの（座標・名前）はエラーやログに入れない。
 */
import { createLogger } from '@/Common/logging/logger';
import { fail, ok } from '@/Common/result/Result';
import { hasControlChars, codePointLength, isRecord } from '@/Common/utils/guards';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { GeoBounds } from '@/domain/exploration/GeoPoint';
import { AMENITY_POINT_KINDS, MAP_FEATURE_KINDS } from '@/domain/spot/MapBackdrop';
import type { AmenityPoint, AmenityPointKind, MapFeature, MapFeatureKind, Station } from '@/domain/spot/MapBackdrop';
import { isDisplayText } from '@/infrastructure/master/masterRecordParsers';
import type { RecordResult } from '@/infrastructure/master/masterRecordParsers';

const logger = createLogger('infrastructure/master/backdropRecordParsers');

/** 背景データの ID の書式（domain/spot/MapBackdrop.ts の注記と同じ） */
export const BACKDROP_ID_PATTERNS = Object.freeze({
  feature: /^f_[0-9a-z_]{2,24}$/,
  station: /^st_[0-9a-z_]{2,24}$/,
  amenityPoint: /^a_[0-9a-z_]{2,24}$/,
});

/** 背景データの文字列項目の最大文字数（コードポイント。master.schema.json に合わせる） */
export const BACKDROP_TEXT_LIMITS = Object.freeze({
  featureName: 20,
  stationName: 20,
  stationLines: 40,
  amenityName: 20,
  amenityNote: 40,
  attribution: 80,
});

/** 地物の頂点数の範囲（line は2点以上、area は3点以上。上限 40 は生成時の間引きと同じ＝描画負荷とファイル改ざんへの備え） */
export const FEATURE_POINT_LIMITS = Object.freeze({
  line: { min: 2, max: 40 },
  area: { min: 3, max: 40 },
});

/** 線の太さ（m）の範囲（line だけが持つ。大川の川幅を収める） */
export const FEATURE_WIDTH_LIMITS = Object.freeze({ minM: 1, maxM: 300 });

/** 地物の形 */
type FeatureShape = MapFeature['shape'];

/**
 * 規則違反の失敗を作る。
 * @param rule 破った規則名
 * @returns 失敗（error は規則名）
 */
function bad(rule: string): RecordResult<never> {
  return fail(rule);
}

/**
 * 空でもよい補足文として正しいか判定する（制御文字なし・最大文字数以内）。
 * @param value 判定する値
 * @param maxLength 最大文字数（コードポイント）
 * @returns 正しければ true
 */
function isNoteText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && !hasControlChars(value) && codePointLength(value) <= maxLength;
}

/**
 * 地物の種類か判定する型ガード。
 * @param value 判定する値
 * @returns MAP_FEATURE_KINDS の値なら true
 */
function isMapFeatureKind(value: unknown): value is MapFeatureKind {
  return MAP_FEATURE_KINDS.some((kind) => kind === value);
}

/**
 * 便利施設ポイントの種類か判定する型ガード。
 * @param value 判定する値
 * @returns AMENITY_POINT_KINDS の値なら true
 */
function isAmenityPointKind(value: unknown): value is AmenityPointKind {
  return AMENITY_POINT_KINDS.some((kind) => kind === value);
}

/**
 * 地物の形か判定する型ガード。
 * @param value 判定する値
 * @returns 'line' / 'area' なら true
 */
function isFeatureShape(value: unknown): value is FeatureShape {
  return value === 'line' || value === 'area';
}

/**
 * 位置が範囲の内側（境界を含む）にあるか判定する。
 * @param point 位置
 * @param area 範囲
 * @returns 内側なら true
 */
function isInside(point: GeoPoint, area: GeoBounds): boolean {
  return point.lat >= area.south && point.lat <= area.north && point.lng >= area.west && point.lng <= area.east;
}

/**
 * 緯度経度を検証し、範囲の内側か確かめる。
 * @param raw 未検証の { lat, lng }
 * @param area 許す範囲
 * @returns 成功: GeoPoint。失敗: 'point'（緯度経度として不正）/ 'outsideArea'（範囲の外）
 */
function parseAreaPoint(raw: unknown, area: GeoBounds): RecordResult<GeoPoint> {
  const log = logger.fn('parseAreaPoint');
  const point = GeoPoint.fromUnknown(raw);
  if (!point.ok) return log.fail(bad('point'));
  return isInside(point.value, area) ? log.exit(ok(point.value)) : log.fail(bad('outsideArea'));
}

/**
 * 範囲を四方に広げる（川・道路・線路は市域の外へ少しはみ出してよい）。
 * @param bounds 元の範囲
 * @param marginDeg 広げる幅（度）
 * @returns 広げた範囲
 */
export function expandBounds(bounds: GeoBounds, marginDeg: number): GeoBounds {
  return Object.freeze({ south: bounds.south - marginDeg, west: bounds.west - marginDeg, north: bounds.north + marginDeg, east: bounds.east + marginDeg });
}

/**
 * 地物の頂点列を検証する（形ごとの頂点数・各点の座標）。
 * @param raw 未検証の値
 * @param shape 地物の形
 * @param area 許す範囲
 * @returns 成功: 凍結済みの頂点列。失敗: 'points' / 'point' / 'outsideArea'
 */
function parseFeaturePoints(raw: unknown, shape: FeatureShape, area: GeoBounds): RecordResult<readonly GeoPoint[]> {
  const log = logger.fn('parseFeaturePoints', { shape });
  if (!Array.isArray(raw)) return log.fail(bad('points'));
  const items: readonly unknown[] = raw;
  const limits = FEATURE_POINT_LIMITS[shape];
  if (items.length < limits.min || items.length > limits.max) return log.fail(bad('points'));
  const points: GeoPoint[] = [];
  for (const item of items) {
    const point = parseAreaPoint(item, area);
    if (!point.ok) return log.fail(point);
    points.push(point.value);
  }
  return log.exit(ok(Object.freeze(points)), `points=${points.length}`);
}

/**
 * 線の太さを検証する（line は必須、area は持たない）。
 * @param raw 未検証の値（undefined なら無し）
 * @param shape 地物の形
 * @returns 成功: 太さ（area は undefined）。失敗: 'widthM'（line に無い・範囲外・area にある）
 */
function parseWidthM(raw: unknown, shape: FeatureShape): RecordResult<number | undefined> {
  const log = logger.fn('parseWidthM', { shape, present: raw !== undefined });
  if (shape === 'area') return raw === undefined ? log.exit(ok(undefined)) : log.fail(bad('widthM'));
  const valid = typeof raw === 'number' && Number.isFinite(raw) && raw >= FEATURE_WIDTH_LIMITS.minM && raw <= FEATURE_WIDTH_LIMITS.maxM;
  return valid ? log.exit(ok(raw)) : log.fail(bad('widthM'));
}

/**
 * 背景地物1件（mapFeatures.json の features の要素）を検証する。
 * @param raw 未検証の値
 * @param area 頂点に許す範囲（市域を少し広げたもの）
 * @returns 成功: 凍結済みの MapFeature。失敗: 規則名（shape / id / kind / name / featureShape / widthM / points / point / outsideArea）
 */
export function parseMapFeatureRecord(raw: unknown, area: GeoBounds): RecordResult<MapFeature> {
  const log = logger.fn('parseMapFeatureRecord');
  if (!isRecord(raw)) return log.fail(bad('shape'));
  const { id, kind, name, shape } = raw;
  if (typeof id !== 'string' || !BACKDROP_ID_PATTERNS.feature.test(id)) return log.fail(bad('id'));
  if (!isMapFeatureKind(kind)) return log.fail(bad('kind'));
  if (!isDisplayText(name, BACKDROP_TEXT_LIMITS.featureName)) return log.fail(bad('name'));
  if (!isFeatureShape(shape)) return log.fail(bad('featureShape'));
  const widthM = parseWidthM(raw['widthM'], shape);
  if (!widthM.ok) return log.fail(widthM);
  const points = parseFeaturePoints(raw['points'], shape, area);
  if (!points.ok) return log.fail(points);
  const feature: MapFeature = { id, kind, name, shape, points: points.value, ...(widthM.value === undefined ? {} : { widthM: widthM.value }) };
  return log.exit(ok(Object.freeze(feature)));
}

/**
 * 駅1件（mapFeatures.json の stations の要素）を検証する。
 * @param raw 未検証の値
 * @param area 位置に許す範囲（市域）
 * @returns 成功: 凍結済みの Station。失敗: 規則名（shape / id / name / lines / point / outsideArea）
 */
export function parseStationRecord(raw: unknown, area: GeoBounds): RecordResult<Station> {
  const log = logger.fn('parseStationRecord');
  if (!isRecord(raw)) return log.fail(bad('shape'));
  const { id, name, lines } = raw;
  if (typeof id !== 'string' || !BACKDROP_ID_PATTERNS.station.test(id)) return log.fail(bad('id'));
  if (!isDisplayText(name, BACKDROP_TEXT_LIMITS.stationName)) return log.fail(bad('name'));
  if (!isDisplayText(lines, BACKDROP_TEXT_LIMITS.stationLines)) return log.fail(bad('lines'));
  const point = parseAreaPoint({ lat: raw['lat'], lng: raw['lng'] }, area);
  if (!point.ok) return log.fail(point);
  return log.exit(ok(Object.freeze({ id, name, point: point.value, lines })));
}

/**
 * 便利施設ポイント1件（amenityPoints.json の points の要素）を検証する。
 * @param raw 未検証の値
 * @param area 位置に許す範囲（市域。便利施設は市域の中だけを載せる）
 * @returns 成功: 凍結済みの AmenityPoint。失敗: 規則名（shape / id / kind / name / note / point / outsideArea）
 */
export function parseAmenityPointRecord(raw: unknown, area: GeoBounds): RecordResult<AmenityPoint> {
  const log = logger.fn('parseAmenityPointRecord');
  if (!isRecord(raw)) return log.fail(bad('shape'));
  const { id, kind, name, note } = raw;
  if (typeof id !== 'string' || !BACKDROP_ID_PATTERNS.amenityPoint.test(id)) return log.fail(bad('id'));
  if (!isAmenityPointKind(kind)) return log.fail(bad('kind'));
  if (!isDisplayText(name, BACKDROP_TEXT_LIMITS.amenityName)) return log.fail(bad('name'));
  if (!isNoteText(note, BACKDROP_TEXT_LIMITS.amenityNote)) return log.fail(bad('note'));
  const point = parseAreaPoint({ lat: raw['lat'], lng: raw['lng'] }, area);
  if (!point.ok) return log.fail(point);
  return log.exit(ok(Object.freeze({ id, kind, name, point: point.value, note })));
}
