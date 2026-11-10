/**
 * @file 近隣スポットの一覧（presentation/screens/Map/Sheet 層）
 * 下シート「半分」で、近くのスポットを距離順に SpotCard で並べる（CLAUDE.md 6.3、wireframes/03_sheet）。
 * 未発見のスポットは名前を出さず「？」で示し、タップすると案内だけ出す（B: 未開拓への興味）。
 */
import type { NearbySpotDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createSpotCard } from '@/Common/ui/cards/SpotCard';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { CAN_VISIT_BADGE, nearbySubtitle } from '@/presentation/screens/Map/Sheet/sheetModel';
import { mountPhotoImage } from '@/presentation/screens/Spot/SpotPhotoView';
import { KIND_LABELS } from '@/presentation/shared/labels';
import { spotPhotoOf } from '@/presentation/shared/spotPhotos';
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
  /** スポットのカテゴリを引く（図鑑・スポット詳細と同じ写真をサムネに出すため。無ければ街なみ絵） */
  categoryOf?(spotId: string): string | undefined;
}

/**
 * 一覧のサムネを作る。図鑑・スポット詳細と同じ写真（発見済みはモノクロ）。写真が無い・読めないときは街なみ絵。未発見は伏せる。
 * @param spot 近隣スポット
 * @param category カテゴリ（分からなければ undefined）
 * @returns サムネの要素（未発見は undefined＝呼び出し側で「？」になる）
 * @sideEffect img の読込を始める
 */
function createNearbyThumb(spot: NearbySpotDto, category: string | undefined): HTMLElement | undefined {
  const log = logger.fn('createNearbyThumb', { spotId: spot.id, status: spot.status });
  if (spot.status === 'unknown') return log.exit(undefined, '未発見は伏せる');
  const model = { id: spot.id, kind: spot.kind, status: spot.status, name: spot.name, ...(category === undefined ? {} : { category }) };
  const photo = spotPhotoOf({ id: spot.id, kind: spot.kind, category });
  if (photo === undefined) return log.exit(createSpotThumb(model), '街なみ絵');
  const host = h('span', { class: 'map-nearby-thumb', attrs: { 'aria-hidden': 'true' }, dataset: { status: spot.status } });
  mountPhotoImage(host, photo, {
    alt: '',
    onFail: (): void => {
      const fallback = createSpotThumb(model);
      if (fallback !== undefined) host.replaceWith(fallback);
    },
  });
  return log.exit(host);
}

/**
 * 空の状態（線の絵＋名詞1語）を作る。
 * @param testId data-testid
 * @param icon 線の絵
 * @returns 要素
 */
export function createEmptyState(testId: string, icon: Parameters<typeof createIcon>[0]): HTMLElement {
  const log = logger.fn('createEmptyState', { testId });
  return log.exit(h('div', { class: 'map-sheet__empty', attrs: { 'data-testid': testId } }, [createIcon(icon), h('span', { text: 'なし' })]));
}

/**
 * 近隣スポットの一覧を作る（data-testid="nearby-list"）。並びは距離の近い順。
 * @param spots 近隣スポット（application が距離順で返す。念のためここでも並べ直す）
 * @param handlers タップ時の処理
 * @returns 一覧の要素
 */
export function createNearbySpotList(spots: readonly NearbySpotDto[], handlers: NearbySpotListHandlers): HTMLElement {
  const log = logger.fn('createNearbySpotList', { count: spots.length });
  if (spots.length === 0) return log.exit(createEmptyState('nearby-list', 'pin'));
  const sorted = [...spots].sort((a, b) => a.meters - b.meters);
  const cards = sorted.map((spot) =>
    createSpotCard({
      status: spot.status,
      name: spot.name,
      kindLabel: KIND_LABELS[spot.kind],
      meters: spot.meters,
      subtitle: nearbySubtitle({ ...spot, hasActiveShopEvent: false }),
      chips: spot.status !== 'unknown' && spot.hasActiveShopEvent ? [COUPON_CHIP] : undefined,
      icon: createNearbyThumb(spot, handlers.categoryOf?.(spot.id)),
      badge: spot.canVisit ? CAN_VISIT_BADGE : undefined,
      spotId: spot.id,
      districtId: spot.status === 'unknown' ? undefined : spot.districtId,
      onClick: spot.status === 'unknown' ? handlers.onUnknown : (): void => handlers.onSpot(spot.id),
    }),
  );
  return log.exit(h('div', { class: 'map-sheet__list', attrs: { 'data-testid': 'nearby-list' } }, cards));
}
