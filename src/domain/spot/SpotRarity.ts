/**
 * @file スポットカードのレア度（domain/spot 層）
 * レア度はスポットの性質だけで決まる固定値（訪問状況では変わらない。下がることもない＝CLAUDE.md 5「失う体験を作らない」）。
 * - ★4 レジェンド: 地区の象徴の名所（地区内の名所のうち ID 順で先頭）（仮）
 * - ★3 スーパーレア: その他の名所
 * - ★2 レア: 協力店（店頭QR・クーポンあり）
 * - ★1 ノーマル: その他の店舗
 * レジェンドを四季すべてで訪れると「極」に覚醒する（金カードの四季条件と同じ考え方＝CLAUDE.md 4.6）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Season } from '@/Common/utils/date';
import { SEASONS } from '@/Common/utils/date';
import type { Spot } from '@/domain/spot/Spot';

const logger = createLogger('domain/spot/SpotRarity');

/** レア度（1=ノーマル … 4=レジェンド） */
export type Rarity = 1 | 2 | 3 | 4;

/** 最上位のレア度 */
export const MAX_RARITY: Rarity = 4;

/**
 * 地区ごとの象徴の名所（レジェンド）の ID を求める。
 * @param spots すべてのスポット
 * @returns レジェンドのスポットID の集合
 */
export function legendSpotIdsOf(spots: readonly Spot[]): Set<string> {
  const log = logger.fn('legendSpotIdsOf', { spots: spots.length });
  const firstByDistrict = new Map<string, string>();
  for (const spot of spots) {
    if (spot.kind !== 'landmark') continue;
    const current = firstByDistrict.get(spot.districtId);
    if (current === undefined || spot.id < current) firstByDistrict.set(spot.districtId, spot.id);
  }
  return log.exit(new Set(firstByDistrict.values()));
}

/**
 * スポットのレア度を返す。
 * @param spot スポット
 * @param legendIds legendSpotIdsOf の結果
 * @returns レア度
 */
export function rarityOf(spot: Spot, legendIds: ReadonlySet<string>): Rarity {
  const log = logger.fn('rarityOf', { spotId: spot.id });
  if (spot.kind === 'landmark') return log.exit(legendIds.has(spot.id) ? 4 : 3);
  return log.exit(spot.partner ? 2 : 1);
}

/**
 * レジェンドが「極」に覚醒しているか（四季すべてで訪れた）。
 * @param rarity レア度
 * @param seasons 訪れた季節
 * @returns 覚醒していれば true
 */
export function isAwakened(rarity: Rarity, seasons: readonly Season[]): boolean {
  const log = logger.fn('isAwakened', { rarity, seasons: seasons.length });
  return log.exit(rarity === MAX_RARITY && SEASONS.every((s) => seasons.includes(s)));
}
