/**
 * @file 地区の型と地理的な純粋関数（domain/town 層）
 * 地区はマスタデータ（5地区）。ポリゴン内判定・境界までの距離はマスタ検証（DI-13）と地図操作で使う。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId } from '@/Common/types/Id';
import { roundToInt } from '@/Common/utils/number';
import { EARTH_MEAN_RADIUS_M } from '@/domain/exploration/Distance';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';

const logger = createLogger('domain/town/District');

/** 度→ラジアン */
const DEG_TO_RAD = Math.PI / 180;

/** 緯度1度あたりのメートル（地球平均半径から算出） */
const METERS_PER_DEGREE = DEG_TO_RAD * EARTH_MEAN_RADIUS_M;

/** 地区色の書式（#rrggbb） */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 地区（マスタ）。color は '#rrggbb'、polygon は 3 頂点以上（閉じない形で持つ） */
export interface District {
  readonly id: DistrictId;
  readonly name: string;
  readonly shortName: string;
  readonly theme: string;
  readonly order: number;
  readonly color: string;
  readonly center: GeoPoint;
  readonly entrance: GeoPoint;
  readonly polygon: readonly GeoPoint[];
}

/** 平面座標（メートル。基準点からの東向き x・北向き y） */
interface LocalXY {
  readonly x: number;
  readonly y: number;
}

/**
 * 点がポリゴンの内側にあるか判定する（レイキャスト法。経度を x、緯度を y とみなす）。
 * 頂点が3未満なら常に false。辺の上の点はどちらとも判定されうるため、マスタは境界から十分内側に置く。
 * @param point 判定する点
 * @param polygon 頂点列（閉じない形。最後の頂点と最初の頂点が自動でつながる）
 * @returns 内側なら true
 */
export function isPointInPolygon(point: GeoPoint, polygon: readonly GeoPoint[]): boolean {
  const log = logger.fn('isPointInPolygon', { vertices: polygon.length });
  if (polygon.length < 3) return log.exit(false);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const crosses = a.lat > point.lat !== b.lat > point.lat;
    if (crosses && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return log.exit(inside);
}

/**
 * 点が地区のポリゴン内にあるか判定する。
 * @param point 判定する点
 * @param district 地区
 * @returns 内側なら true
 */
export function isPointInDistrict(point: GeoPoint, district: District): boolean {
  return isPointInPolygon(point, district.polygon);
}

/**
 * 点を含む地区を返す（どの地区にも入らなければ undefined）。
 * @param point 判定する点
 * @param districts 地区一覧
 * @returns 最初に見つかった地区
 */
export function findDistrictAt(point: GeoPoint, districts: readonly District[]): District | undefined {
  return districts.find((district) => isPointInDistrict(point, district));
}

/**
 * 基準点まわりの平面座標（メートル）に変換する（正距円筒近似）。
 * @param origin 基準点
 * @param p 変換する点
 * @returns 基準点からの東向き x・北向き y（メートル）
 */
function toLocalXY(origin: GeoPoint, p: GeoPoint): LocalXY {
  return { x: (p.lng - origin.lng) * Math.cos(origin.lat * DEG_TO_RAD) * METERS_PER_DEGREE, y: (p.lat - origin.lat) * METERS_PER_DEGREE };
}

/**
 * 原点から線分 ab までの最短距離（メートル、実数）を返す。
 * @param a 線分の端点（平面座標）
 * @param b 線分の端点（平面座標）
 * @returns 距離（メートル）
 */
function originToSegmentMeters(a: LocalXY, b: LocalXY): number { // audit-ignore: fnlog-missing 純粋な算術ヘルパー（辺ごとに呼ばれる。呼び出し側で記録）
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / lengthSq));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

/**
 * 点からポリゴンの辺までの最短距離を m 単位の整数で返す（「境界から 15m 以上内側」のマスタ検証用）。
 * @param point 判定する点
 * @param polygon 頂点列（閉じない形）
 * @returns 最短距離（メートル、整数）。頂点が2未満なら Infinity
 */
export function distanceToPolygonEdgeM(point: GeoPoint, polygon: readonly GeoPoint[]): number {
  const log = logger.fn('distanceToPolygonEdgeM', { vertices: polygon.length });
  if (polygon.length < 2) return log.exit(Number.POSITIVE_INFINITY);
  const local = polygon.map((p) => toLocalXY(point, p));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    if (a !== undefined && b !== undefined) best = Math.min(best, originToSegmentMeters(a, b));
  }
  return log.exit(roundToInt(best));
}

/**
 * 地区色の書式（#rrggbb）か判定する。
 * @param value 判定する値
 * @returns '#rrggbb' 形式の文字列なら true
 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

/**
 * 地区を表示順（order 昇順、同じなら id 昇順）に並べた新しい配列を返す。
 * @param districts 地区一覧
 * @returns 並べ替えた配列（元の配列は変えない）
 */
export function sortDistrictsByOrder(districts: readonly District[]): District[] {
  return [...districts].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
