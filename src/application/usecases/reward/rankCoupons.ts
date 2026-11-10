/**
 * @file ランク画面のクーポン（持っているチケットと、もうすぐもらえるクーポン）を求める（application 層・純粋関数）
 * 2026-11-10 ユーザー指示「自分が持っているクーポンともうすぐゲットできるクーポンをランクからわかるように」。
 * - 持っている: 獲得したチケットのうち使えるもの（tickets.ts の ticketsOf。期限の近い順）
 * - もうすぐ: まだ獲得していないクーポンのうち、いま期間中のもの（期間中にそのお店でクエスト達成すればもらえる）と、
 *   COUPON_SOON_DAYS 日以内に始まるもの。期間中のものを先に、それぞれ日数の少ない順
 * 訪問記録・クーポン利用記録・マスタ（店舗CMS の上書き分も含む）から毎回導出し、保存しない。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { daysBetween } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { RankCouponDto, RankCouponsDto } from '@/application/dto/Dto';
import { ticketsOf } from '@/application/usecases/reward/tickets';
import type { Traveler } from '@/domain/exploration/Traveler';
import { isCoupon } from '@/domain/revisit/ShopEvent';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/reward/rankCoupons');

/** 「もうすぐ」に入れる、始まるまでの日数の上限（表示の都合。ゲームの数値ルールではない）（仮） */
export const COUPON_SOON_DAYS = 30;

/**
 * もうすぐもらえるクーポンの並び（期間中 → もうすぐ始まる。それぞれ日数の少ない順、同じならID順）。
 * @param a クーポン
 * @param b クーポン
 * @returns 並びの比較
 */
function compareUpcoming(a: RankCouponDto, b: RankCouponDto): number { // audit-ignore: fnlog-missing 並べ替えの比較関数（呼び出し側 rankCouponsOf でログ）
  return Number(a.state === 'soon') - Number(b.state === 'soon') || a.days - b.days || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * 持っているチケットと、もうすぐもらえるクーポンを求める。
 * @param traveler 旅人（訪問記録・クーポン利用記録）
 * @param spots マスタ参照（クーポン・お店・地区）
 * @param today 今日
 * @returns クーポン（凍結済み）
 */
export function rankCouponsOf(traveler: Traveler, spots: SpotRepository, today: LocalDate): RankCouponsDto {
  const log = logger.fn('rankCouponsOf', { travelerId: traveler.id, today });
  const tickets = ticketsOf(traveler, spots, today);
  const held = tickets.filter((t) => t.status === 'ready');
  const earned = new Set(tickets.map((t) => t.id));
  const upcoming: RankCouponDto[] = [];
  for (const event of spots.allShopEvents()) {
    if (!isCoupon(event) || earned.has(event.id)) continue;
    const spot = spots.findSpot(event.spotId);
    if (spot === undefined) continue;
    const open = event.period.contains(today);
    const days = open ? event.period.daysUntilEnd(today) : daysBetween(today, event.period.start);
    if (!open && !(event.period.hasNotStarted(today) && days <= COUPON_SOON_DAYS)) continue;
    upcoming.push(
      Object.freeze({
        id: event.id,
        spotId: spot.id,
        spotName: spot.name,
        districtName: spots.findDistrict(spot.districtId)?.shortName ?? '',
        ...(spot.category.length > 0 ? { category: spot.category } : {}),
        title: event.title,
        state: open ? 'open' : 'soon',
        days,
        start: event.period.start,
        end: event.period.end,
      } as const),
    );
  }
  upcoming.sort(compareUpcoming);
  log.debug('クーポン', { held: held.length, used: tickets.length - held.length, upcoming: upcoming.length });
  return log.exit(Object.freeze({ held: Object.freeze(held), usedCount: tickets.length - held.length, upcoming: Object.freeze(upcoming) }));
}
