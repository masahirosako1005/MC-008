/**
 * @file 訪問記録の集計（domain/exploration 層の純粋関数）
 * 「通った回数」は訪問記録の件数で数える（docs/08 D2）。地区の成長・カード・地区の主・ランキングはすべてここを使う。
 * 同じ入力からは常に同じ結果を返す（DI-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import { compareLocalDate, seasonOf } from '@/Common/utils/date';
import type { LocalDate, Season } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';

const logger = createLogger('domain/exploration/VisitStats');

/** countVisitsInRange の条件（03 §3 のオブジェクト引数版） */
export interface VisitRangeQuery {
  /** 対象地区（undefined なら全地区） */
  readonly districtId?: DistrictId;
  /** 開始日（含む） */
  readonly from: LocalDate;
  /** 終了日（含む） */
  readonly to: LocalDate;
}

/**
 * 地区の訪問記録を返す（元の順序のまま）。
 * @param visits 訪問記録
 * @param districtId 地区ID
 * @returns その地区の訪問記録
 */
export function visitsInDistrict(visits: readonly VisitRecord[], districtId: DistrictId): VisitRecord[] {
  return visits.filter((v) => v.districtId === districtId);
}

/**
 * スポットの訪問記録を返す（元の順序のまま。スポット詳細の訪問履歴用）。
 * @param visits 訪問記録
 * @param spotId スポットID
 * @returns そのスポットの訪問記録
 */
export function visitsOfSpot(visits: readonly VisitRecord[], spotId: SpotId): VisitRecord[] {
  return visits.filter((v) => v.spotId === spotId);
}

/**
 * 期間内（両端を含む）の訪問回数を数える。from > to なら 0。
 * @param visits 訪問記録
 * @param query 地区（省略で全地区）・開始日・終了日
 * @returns 訪問回数
 */
export function countVisitsInRange(visits: readonly VisitRecord[], query: VisitRangeQuery): number {
  const log = logger.fn('countVisitsInRange', query);
  const { districtId, from, to } = query;
  const count = visits.filter(
    (v) => (districtId === undefined || v.districtId === districtId) && compareLocalDate(from, v.localDate) <= 0 && compareLocalDate(v.localDate, to) <= 0,
  ).length;
  return log.exit(count);
}

/**
 * 期間内（両端を含む）の訪問回数を数える（docs/08 §3.3 の契約どおりの位置引数版。中身は countVisitsInRange）。
 * @param visits 訪問記録
 * @param districtId 対象地区（undefined なら全地区）
 * @param from 開始日（含む）
 * @param to 終了日（含む）
 * @returns 訪問回数（from > to なら 0）
 */
export function countVisitsBetween(visits: readonly VisitRecord[], districtId: DistrictId | undefined, from: LocalDate, to: LocalDate): number {
  return countVisitsInRange(visits, districtId === undefined ? { from, to } : { districtId, from, to });
}

/**
 * 地区の最終訪問日を返す。before を渡すとその日より前（当日を含まない）の最終訪問日を返す（復活判定の「直前の訪問」）。
 * @param visits 訪問記録
 * @param districtId 地区ID
 * @param before この日より前だけを見る（省略時は全期間）
 * @returns 最終訪問日。訪問が無ければ undefined
 */
export function lastVisitDate(visits: readonly VisitRecord[], districtId: DistrictId, before?: LocalDate): LocalDate | undefined {
  const log = logger.fn('lastVisitDate', { districtId, before });
  let latest: LocalDate | undefined;
  for (const v of visits) {
    if (v.districtId !== districtId) continue;
    if (before !== undefined && compareLocalDate(v.localDate, before) >= 0) continue;
    if (latest === undefined || compareLocalDate(v.localDate, latest) > 0) latest = v.localDate;
  }
  return log.exit(latest);
}

/**
 * スポットへの訪問回数（＝訪問記録の件数）を返す。
 * @param visits 訪問記録
 * @param spotId スポットID
 * @returns 訪問回数
 */
export function visitCountOfSpot(visits: readonly VisitRecord[], spotId: SpotId): number {
  return visits.reduce((n, v) => (v.spotId === spotId ? n + 1 : n), 0);
}

/**
 * 地区で訪問したスポットの種類数を返す（成長スコアの「種類数」＝D3）。
 * @param visits 訪問記録
 * @param districtId 地区ID
 * @returns 異なるスポットの数
 */
export function distinctSpotCount(visits: readonly VisitRecord[], districtId: DistrictId): number {
  return new Set(visitsInDistrict(visits, districtId).map((v) => v.spotId)).size;
}

/**
 * 地区を訪問した季節の集合を返す（四季すべてで金カード＝CLAUDE.md 4.6）。
 * @param visits 訪問記録
 * @param districtId 地区ID
 * @returns 訪問した季節（新しい Set）
 */
export function seasonsVisited(visits: readonly VisitRecord[], districtId: DistrictId): Set<Season> {
  return new Set(visitsInDistrict(visits, districtId).map((v) => seasonOf(v.localDate)));
}
