/**
 * @file 近隣スポットの一覧（presentation/screens/Map/Sheet 層）
 * 下シート「半分」で、近くのスポットを距離順に SpotCard で並べる（CLAUDE.md 6.3、wireframes/03_sheet）。
 * 未発見のスポットは名前を出さず「？」で示し、タップすると案内だけ出す（B: 未開拓への興味）。
 */
import type { NearbySpotDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createSpotCard } from '@/Common/ui/cards/SpotCard';
import { h } from '@/Common/ui/dom';
import { CAN_VISIT_BADGE, nearbySubtitle } from '@/presentation/screens/Map/Sheet/sheetModel';
import { KIND_LABELS } from '@/presentation/shared/labels';
import { createSpotThumb } from '@/presentation/shared/spotThumb';

/** クーポン・イベントがあるスポットに添えるチップ（補足の文字ではなく色付きのチップで目立たせる） */
const COUPON_CHIP = 'クーポン';

const logger = createLogger('presentation/screens/Map/Sheet/NearbySpotList');

/** 一覧からの操作 */
export interface NearbySpotListHandlers {
  /** 発見済み・訪問済みのスポットが押された */
  onSpot(spotId: string): void;
  /** 未発見のスポットが押された */
  onUnknown(): void;
}

/**
 * 近隣スポットの一覧を作る（data-testid="nearby-list"）。並びは距離の近い順。
 * @param spots 近隣スポット（application が距離順で返す。念のためここでも並べ直す）
 * @param handlers タップ時の処理
 * @returns 一覧の要素
 */
export function createNearbySpotList(spots: readonly NearbySpotDto[], handlers: NearbySpotListHandlers): HTMLElement {
  const log = logger.fn('createNearbySpotList', { count: spots.length });
  if (spots.length === 0) {
    return log.exit(h('p', { class: ['hint', 'map-sheet__empty'], attrs: { 'data-testid': 'nearby-list' }, text: '近くにスポットはありません。地図をタップして歩いてみましょう' }));
  }
  const sorted = [...spots].sort((a, b) => a.meters - b.meters);
  const cards = sorted.map((spot) =>
    createSpotCard({
      status: spot.status,
      name: spot.name,
      kindLabel: KIND_LABELS[spot.kind],
      meters: spot.meters,
      subtitle: nearbySubtitle({ ...spot, hasActiveShopEvent: false }),
      chips: spot.status !== 'unknown' && spot.hasActiveShopEvent ? [COUPON_CHIP] : undefined,
      icon: createSpotThumb({ id: spot.id, kind: spot.kind, status: spot.status, name: spot.name }),
      badge: spot.canVisit ? CAN_VISIT_BADGE : undefined,
      spotId: spot.id,
      districtId: spot.status === 'unknown' ? undefined : spot.districtId,
      onClick: spot.status === 'unknown' ? handlers.onUnknown : (): void => handlers.onSpot(spot.id),
    }),
  );
  return log.exit(h('div', { class: 'map-sheet__list', attrs: { 'data-testid': 'nearby-list' } }, cards));
}
