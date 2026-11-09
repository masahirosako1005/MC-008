/**
 * @file スポットの表示状態（未発見／発見済み／訪問済み）と付帯情報を決める共通部品（application 層）
 * 地図・近隣リスト・スポット詳細で同じ判定を使い、画面間で状態が食い違わないようにする（D2）。
 * 未発見スポットの名前は DTO に入れない（B。名前を出してよいかは spotStatusOf の結果で決める）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import type { SpotStatusDto } from '@/application/dto/Dto';
import type { Traveler } from '@/domain/exploration/Traveler';
import { isActive } from '@/domain/revisit/ShopEvent';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/exploration/SpotStatus');

/** マスタに名前が無いときの地区名（ReasonText と同じ表記） */
export const UNKNOWN_DISTRICT_NAME = 'この地区';

/**
 * 旅人から見たスポットの状態を返す（訪問済み＞発見済み＞未発見）。
 * 訪問すると発見記録も付く（Traveler.visit）ので、訪問済みは必ず発見済みでもある。
 * @param traveler 旅人
 * @param spotId スポットID
 * @returns 'visited' / 'discovered' / 'unknown'
 */
export function spotStatusOf(traveler: Traveler, spotId: SpotId): SpotStatusDto {
  const log = logger.fn('spotStatusOf', { spotId });
  if (traveler.hasVisited(spotId)) return log.exit('visited');
  return log.exit(traveler.hasDiscovered(spotId) ? 'discovered' : 'unknown');
}

/**
 * 今日が期間内のクーポン・イベントがスポットにあるか判定する（開始日・終了日を含む）。
 * @param spots マスタ参照
 * @param spotId スポットID
 * @param today 今日（Clock.today()）
 * @returns 期間内のものが1件でもあれば true
 */
export function hasActiveShopEventOn(spots: SpotRepository, spotId: SpotId, today: LocalDate): boolean {
  const log = logger.fn('hasActiveShopEventOn', { spotId, today });
  const active = spots.shopEventsForSpot(spotId).some((event) => isActive(event, today));
  return log.exit(active);
}

/**
 * 地区名を引く（マスタに無ければ「この地区」）。
 * @param spots マスタ参照
 * @param districtId 地区ID
 * @returns 地区名
 */
export function districtNameOf(spots: SpotRepository, districtId: DistrictId): string {
  return spots.findDistrict(districtId)?.name ?? UNKNOWN_DISTRICT_NAME;
}
