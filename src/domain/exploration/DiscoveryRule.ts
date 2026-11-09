/**
 * @file 発見（80m）・訪問（40m）の距離ルールと近傍探索（domain/exploration 層のドメインサービス）
 * 発見は DISCOVERY_RADIUS_M 以内で図鑑にシルエット登録、訪問は VISIT_RADIUS_M 以内で成立（CLAUDE.md 4.2）。
 * 距離は m 単位の整数に丸めて判定する（DI-18）。位置の妥当性（移動速度）は本番 GPS のみで使う（DI-14）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { SpotId } from '@/Common/types/Id';
import { epochMsOf } from '@/Common/utils/date';
import { clamp, roundToInt } from '@/Common/utils/number';
import { DISCOVERY_RADIUS_M, MAX_ACCURACY_M, MAX_PLAUSIBLE_SPEED_KMH, VISIT_RADIUS_M } from '@/domain/exploration/constants';
import { Distance } from '@/domain/exploration/Distance';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { GeoFix } from '@/domain/ports/GeoProvider';
import type { Spot } from '@/domain/spot/Spot';

const logger = createLogger('domain/exploration/DiscoveryRule');

/** 単位換算: 1 m/s = 3.6 km/h（物理定数） */
const KMH_PER_MPS = 3.6;

/** スポットと、基準点からの距離（メートル、整数） */
export interface SpotWithDistance {
  readonly spot: Spot;
  readonly meters: number;
}

/**
 * 距離が判定に使える値（0 以上の有限数）か判定する。
 * @param meters 距離（メートル）
 * @returns 使える値なら true
 */
function isUsableDistance(meters: number): boolean {
  return Number.isFinite(meters) && meters >= 0;
}

/**
 * 距離が発見の半径（DISCOVERY_RADIUS_M = 80m）以内か判定する。整数に丸めてから比べる（半径ちょうどは発見、1m でも超えたら不可）。
 * @param meters 距離（メートル。負・非数は false）
 * @returns 発見範囲内なら true
 */
export function isWithinDiscoveryRadius(meters: number): boolean {
  return isUsableDistance(meters) && roundToInt(meters) <= DISCOVERY_RADIUS_M;
}

/**
 * 距離が訪問の半径（VISIT_RADIUS_M = 40m）以内か判定する。整数に丸めてから比べる（半径ちょうどは可、1m でも超えたら不可）。
 * 発見（80m）とは別ルールなので混同しないこと。
 * @param meters 距離（メートル。負・非数は false）
 * @returns 訪問可能なら true
 */
export function isWithinVisitRadius(meters: number): boolean {
  return isUsableDistance(meters) && roundToInt(meters) <= VISIT_RADIUS_M;
}

/**
 * 距離昇順・同距離は ID 昇順で並べる比較関数（結果を決定論的にする）。
 * @param a 左辺
 * @param b 右辺
 * @returns 並び順（負・0・正）
 */
function compareByDistanceThenId(a: SpotWithDistance, b: SpotWithDistance): number {
  return a.meters - b.meters || (a.spot.id < b.spot.id ? -1 : a.spot.id > b.spot.id ? 1 : 0);
}

/**
 * 全スポットに距離を付けて近い順に並べる（共通処理）。
 * @param point 基準点（現在地）
 * @param spots スポット一覧
 * @returns 距離つきスポット（距離昇順・同距離は ID 昇順）
 */
function withDistances(point: GeoPoint, spots: readonly Spot[]): SpotWithDistance[] {
  return spots.map((spot) => ({ spot, meters: Distance.between(point, spot.point).meters })).sort(compareByDistanceThenId);
}

/**
 * 現在地から発見範囲（80m）に入った未発見スポットを返す（近い順）。
 * @param point 現在地
 * @param spots 対象スポット
 * @param isDiscovered 発見済みか判定する関数（Traveler.hasDiscovered など）
 * @returns 新たに発見するスポット（距離昇順・同距離は ID 昇順）
 */
export function findSpotsToDiscover(point: GeoPoint, spots: readonly Spot[], isDiscovered: (id: SpotId) => boolean): Spot[] {
  const log = logger.fn('findSpotsToDiscover', { candidates: spots.length });
  const found = withDistances(point, spots).filter((s) => isWithinDiscoveryRadius(s.meters) && !isDiscovered(s.spot.id));
  log.debug('発見判定', { found: found.map((s) => ({ spotId: s.spot.id, meters: s.meters })) });
  return log.exit(found.map((s) => s.spot));
}

/**
 * 現在地から近いスポットを limit 件返す（下シートの近隣リスト・つまみ表示用）。
 * @param point 現在地
 * @param spots 対象スポット
 * @param limit 最大件数（0 以下なら空配列。小数は切り捨て）
 * @returns 距離つきスポット（距離昇順・同距離は ID 昇順）
 */
export function nearestSpots(point: GeoPoint, spots: readonly Spot[], limit: number): SpotWithDistance[] {
  const log = logger.fn('nearestSpots', { candidates: spots.length, limit });
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (count === 0) return log.exit([]);
  const nearest = withDistances(point, spots).slice(0, count);
  return log.exit(nearest, `${nearest.length}件`);
}

/**
 * 前回の測位から今回の測位への移動が徒歩として物理的に妥当か判定する（DI-14。本番 GPS のみで使う）。
 * 許容距離 = MAX_PLAUSIBLE_SPEED_KMH × 経過秒 ＋ 両測位の精度（各 MAX_ACCURACY_M まで）。時刻が逆行していれば不可。
 * @param prev 前回の測位
 * @param next 今回の測位
 * @returns 妥当なら true
 */
export function isPlausibleMove(prev: GeoFix, next: GeoFix): boolean {
  const log = logger.fn('isPlausibleMove', { prevAccuracyM: prev.accuracyM, nextAccuracyM: next.accuracyM });
  const seconds = (epochMsOf(next.at) - epochMsOf(prev.at)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return log.exit(false, '時刻が逆行');
  const meters = Distance.between(prev.point, next.point).meters;
  const tolerance = clamp(prev.accuracyM, 0, MAX_ACCURACY_M) + clamp(next.accuracyM, 0, MAX_ACCURACY_M);
  const allowed = (MAX_PLAUSIBLE_SPEED_KMH / KMH_PER_MPS) * seconds + tolerance;
  log.debug('移動判定', { meters, seconds, allowed: roundToInt(allowed) });
  return log.exit(meters <= allowed);
}
