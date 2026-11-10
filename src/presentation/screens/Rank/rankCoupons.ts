/**
 * @file ランク画面の「クーポン」（presentation/screens/Rank 層。DOM 部品）
 * 2026-11-10 ユーザー指示「自分が持っているクーポンともうすぐゲットできるクーポンをランクからわかるように」。
 * - 持っている: 枚数と、紙のチケット（看板商品の写真・お店・中身・あと n 日・QR の印）を横に並べる。タップで地図と同じチケットの入れ物を開き、すぐ QR を見せる
 * - もうすぐ: まだ持っていないクーポンを点線のチケットで並べる（期間中は「あと n 日」＋足あと＝行けばもらえる、始まる前は「11/1から」）。タップでお店の詳細へ
 * 言葉は短いラベルと数だけ（feedback-ui-minimal-text）。QR の中身・コードはここでは出さない。
 */
import type { RankCouponDto, RankCouponsDto, TicketDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import { goodsOf } from '@/presentation/screens/Map/town/goods';
import { paintGoodsPhoto } from '@/presentation/screens/Map/town/goodsPhoto';
import { shortDateOf } from '@/presentation/screens/Rank/rankModel';

const logger = createLogger('presentation/screens/Rank/rankCoupons');

/** 看板商品の写真の一辺（CSS px） */
const PHOTO_PX = 52;

/** 期限が近いとみなす日数（この日数以下で札を赤くする。表示の演出） */
const DUE_SOON_DAYS = 2;

/** クーポンのまとまりの操作 */
export interface CouponHandlers {
  /** 持っているチケットを押したとき（QR を見せる） */
  readonly onOpenTicket: (ticketId: string) => void;
  /** もうすぐのクーポンを押したとき（お店の詳細へ） */
  readonly onOpenSpot: (spotId: string) => void;
}

/**
 * 看板商品の写真風サムネを作る。
 * @param spotId お店
 * @param category カテゴリ
 * @returns canvas
 */
function photoOf(spotId: string, category: string | undefined): HTMLCanvasElement {
  const log = logger.fn('photoOf', { spotId });
  const canvas = h('canvas', { class: 'rank-coupon__photo', attrs: { 'aria-hidden': 'true' } });
  paintGoodsPhoto(canvas, goodsOf({ id: spotId, kind: 'shop', ...(category === undefined ? {} : { category }) }).icon, PHOTO_PX);
  return log.exit(canvas);
}

/**
 * 期限の札の文字（今日まで／あと n 日）。
 * @param days 終わりまでの日数
 * @returns 文字
 */
function dueText(days: number): string { // audit-ignore: fnlog-missing チケットごとに呼ぶ小さな整形（呼び出し側でログ）
  return days <= 0 ? '今日まで' : `あと${days}日`;
}

/**
 * チケットの形（写真・切り取り線・お店・中身・札）を作る。
 * @param parts 中身
 * @returns 子要素
 */
function ticketFace(parts: { readonly photo: HTMLCanvasElement; readonly shop: string; readonly title: string; readonly pill: HTMLElement; readonly corner?: HTMLElement }): HTMLElement[] { // audit-ignore: fnlog-missing チケットごとに呼ぶ DOM 組立て（呼び出し側でログ）
  return [
    h('span', { class: 'rank-coupon__top', attrs: { 'aria-hidden': 'true' } }, [parts.photo, parts.corner]),
    h('span', { class: 'rank-coupon__body', attrs: { 'aria-hidden': 'true' } }, [
      h('span', { class: 'rank-coupon__shop', text: parts.shop }),
      h('span', { class: 'rank-coupon__title', text: parts.title }),
      parts.pill,
    ]),
  ];
}

/**
 * 持っているチケット1枚を作る（タップで QR）。
 * @param ticket チケット
 * @param index 並びの番号（現れる順）
 * @param onOpen 押されたとき
 * @returns 要素
 */
function heldTicket(ticket: TicketDto, index: number, onOpen: (id: string) => void): HTMLElement {
  const log = logger.fn('heldTicket', { id: ticket.id, daysLeft: ticket.daysLeft });
  const pill = h('span', { class: ['rank-coupon__pill', ticket.daysLeft <= DUE_SOON_DAYS ? 'rank-coupon__pill--hot' : undefined], text: dueText(ticket.daysLeft) });
  return log.exit(
    h('li', { style: { '--i': String(index) } }, [
      h(
        'button',
        {
          class: 'rank-coupon',
          dataset: { kind: 'held' },
          attrs: { type: 'button', 'data-testid': 'rank-coupon-held', 'data-ticket-id': ticket.id, 'aria-label': `${ticket.spotName} ${ticket.title} ${dueText(ticket.daysLeft)}。QRを見せる` },
          on: { click: userAction('rank-open-ticket', () => onOpen(ticket.id)) },
        },
        ticketFace({ photo: photoOf(ticket.spotId, ticket.category), shop: ticket.spotName, title: ticket.title, pill, corner: h('span', { class: 'rank-coupon__qr', text: 'QR' }) }),
      ),
    ]),
  );
}

/**
 * もうすぐもらえるクーポン1枚を作る（タップでお店の詳細）。
 * @param coupon クーポン
 * @param index 並びの番号（現れる順）
 * @param onOpen 押されたとき
 * @returns 要素
 */
function upcomingCoupon(coupon: RankCouponDto, index: number, onOpen: (spotId: string) => void): HTMLElement {
  const log = logger.fn('upcomingCoupon', { id: coupon.id, state: coupon.state, days: coupon.days });
  const open = coupon.state === 'open';
  const when = open ? dueText(coupon.days) : `${shortDateOf(coupon.start)}から`;
  const pill = h('span', { class: ['rank-coupon__pill', open && coupon.days <= DUE_SOON_DAYS ? 'rank-coupon__pill--hot' : undefined] }, [open ? createIcon('footprints') : createIcon('calendar'), when]);
  return log.exit(
    h('li', { style: { '--i': String(index) } }, [
      h(
        'button',
        {
          class: 'rank-coupon',
          dataset: { kind: 'upcoming', state: coupon.state },
          attrs: { type: 'button', 'data-testid': 'rank-coupon-upcoming', 'data-coupon-id': coupon.id, 'aria-label': `${coupon.spotName} ${coupon.title} ${when}${open ? '。行けばもらえる' : ''}` },
          on: { click: userAction('rank-open-coupon-spot', () => onOpen(coupon.spotId)) },
        },
        ticketFace({ photo: photoOf(coupon.spotId, coupon.category), shop: coupon.spotName, title: coupon.title, pill, corner: open ? undefined : h('span', { class: 'rank-coupon__lock' }, [createIcon('lock')]) }),
      ),
    ]),
  );
}

/**
 * 小見出し（ラベルと枚数）を作る。
 * @param label ラベル
 * @param count 枚数
 * @returns 要素
 */
function subHead(label: string, count: number): HTMLElement { // audit-ignore: fnlog-missing 2回だけ呼ぶ DOM 組立て（呼び出し側 createCouponBody でログ）
  return h('p', { class: 'rank-coupons__sub' }, [h('span', { text: label }), h('strong', { text: String(count) })]);
}

/**
 * 「クーポン」のカードの中身（持っている＋もうすぐ）を作る。
 * @param coupons クーポン
 * @param handlers 操作
 * @returns 要素（並び順）
 */
export function createCouponBody(coupons: RankCouponsDto, handlers: CouponHandlers): HTMLElement[] {
  const log = logger.fn('createCouponBody', { held: coupons.held.length, upcoming: coupons.upcoming.length });
  const held =
    coupons.held.length === 0
      ? undefined
      : h('ul', { class: 'rank-coupons__row', attrs: { 'aria-label': '手持ちのクーポン', 'data-testid': 'rank-coupons-held' } }, coupons.held.map((t, i) => heldTicket(t, i, handlers.onOpenTicket)));
  const upcoming =
    coupons.upcoming.length === 0
      ? undefined
      : h('ul', { class: 'rank-coupons__row', attrs: { 'aria-label': 'もうすぐもらえるクーポン', 'data-testid': 'rank-coupons-upcoming' } }, coupons.upcoming.map((c, i) => upcomingCoupon(c, i, handlers.onOpenSpot)));
  return log.exit([
    subHead('手持ち', coupons.held.length), // 図鑑の「手持ち」と同じ言葉
    ...(held === undefined ? [] : [held]),
    ...(upcoming === undefined ? [] : [subHead('もうすぐ', coupons.upcoming.length), upcoming]),
  ]);
}
