/**
 * @file クーポン・イベントの一覧（presentation/screens/Spot 層）
 * 期間内のものは再訪理由「期限」と同じ時計のアイコンと「あと n 日」を付ける（CLAUDE.md 4.5・6.4、wireframes/04_spot、docs/08 §10.3）。
 * 予定（期間前）のものはクーポン券のアイコンを灰色の台座に載せる。
 * 店舗協力が無いスポットはこの一覧自体を出さない（店舗協力なしでも成立する）。利用ボタンは PoC では出さない（docs/08 §8）。
 */
import type { ShopEventDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createReasonIcon } from '@/Common/ui/cards/RevisitReasonCard';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { eventSubtitle } from '@/presentation/screens/Spot/spotDetailModel';

const logger = createLogger('presentation/screens/Spot/CouponEventList');

/**
 * クーポン・イベント1件のカードを作る（data-testid="shop-event"）。
 * @param event クーポン・イベント
 * @returns カード要素
 */
function createShopEventCard(event: ShopEventDto): HTMLElement {
  const log = logger.fn('createShopEventCard', { id: event.id, active: event.active, daysLeft: event.daysLeft });
  const tag = event.active
    ? createReasonIcon('deadline')
    : h('span', { class: ['reason-icon', 'spot-event__upcoming'], attrs: { 'aria-hidden': 'true' } }, [createIcon('ticket')]);
  const card = h('div', { class: ['card', 'spot-event'], attrs: { 'data-testid': 'shop-event', 'data-active': event.active ? '1' : '0', 'data-event-id': event.id } }, [
    tag,
    h('span', { class: 'spot-event__text' }, [
      h('span', { class: 'spot-event__label', text: event.active ? '期限' : '予定' }),
      h('span', { class: 'spot-event__title', text: event.title }),
      h('span', { class: 'spot-event__sub', text: eventSubtitle(event) }),
      event.description.length === 0 ? undefined : h('span', { class: 'spot-event__desc', text: event.description }),
    ]),
  ]);
  return log.exit(card);
}

/**
 * クーポン・イベントの一覧を作る（data-testid="shop-events"）。期間内のものを先に並べる。
 * @param events クーポン・イベント
 * @returns section 要素。1件も無ければ undefined（セクションごと出さない）
 */
export function createCouponEventList(events: readonly ShopEventDto[]): HTMLElement | undefined {
  const log = logger.fn('createCouponEventList', { count: events.length });
  if (events.length === 0) return log.exit(undefined);
  const sorted = [...events].sort((a, b) => Number(b.active) - Number(a.active));
  return log.exit(
    h('section', { class: 'spot-section', attrs: { 'data-testid': 'shop-events' } }, [
      h('h2', { class: 'sheet-section-title', text: 'クーポン・イベント' }),
      ...sorted.map((event) => createShopEventCard(event)),
    ]),
  );
}
