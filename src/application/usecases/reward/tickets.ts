/**
 * @file チケット（獲得したクーポン）の導出と、お店の人に見せるコード（application 層・純粋関数）
 * 2026-11-10 ユーザー指示「自分が獲得したチケットをQRコードで表示して使えるようにしてほしい」。
 * チケット＝お店のクーポン（ShopEvent kind='coupon'。店舗CMS の上書き分も含む）を、その期間中にそのお店でクエスト達成（訪問）すると1枚獲得。
 * 訪問記録とクーポン利用記録（Traveler.redemptions）から毎回導出するので、チケットそのものは保存しない（DI-05 と同じ考え方）。
 * 期限（クーポン期間の終わり）を過ぎたものは出さない。使用済みは期限まで「使用済み」で残す。
 * コードは旅人ID とクーポンID の FNV-1a ハッシュ（一方向）で作る。旅人ID・名前・位置は QR に入れない（PRV-03）。改ざん防止の署名は本番の店頭QR（docs/09 Q10）で決める。
 */
import { createLogger } from '@/Common/logging/logger';
import type { TravelerId } from '@/Common/types/Id';
import { compareLocalDate, localDateOf } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { TicketDto } from '@/application/dto/Dto';
import type { Traveler } from '@/domain/exploration/Traveler';
import { isCoupon } from '@/domain/revisit/ShopEvent';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/reward/tickets');

/** QR の中身の頭（アプリ名・種類・形式の版） */
export const TICKET_PAYLOAD_PREFIX = 'MACHIQUEST:TICKET:1';
/** コードに使う文字（見間違えやすい 0・1・I・O を除いた32文字） */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** コードの形（'MQ-' ＋ 4文字 ＋ '-' ＋ 4文字） */
export const TICKET_CODE_PATTERN = /^MQ-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

/**
 * 文字列の FNV-1a 32bit ハッシュ（種を変えて2本作る）。
 * @param text 元の文字列
 * @param seed 種
 * @returns 0..2^32-1
 */
function fnv1a(text: string, seed: number): number { // audit-ignore: fnlog-missing コードを作るときの純粋な算術ヘルパー
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * お店の人に見せるコードを作る（同じ旅人・同じクーポンなら毎回同じ）。
 * @param travelerId 旅人ID
 * @param ticketId チケットID（クーポンID）
 * @returns 'MQ-XXXX-XXXX'
 */
export function ticketCodeOf(travelerId: TravelerId, ticketId: string): string {
  const log = logger.fn('ticketCodeOf', { ticketId });
  const source = `${travelerId}|${ticketId}`;
  const a = fnv1a(source, 0);
  const b = fnv1a(source, 0x9e3779b9);
  let chars = '';
  for (let i = 0; i < 8; i++) {
    const word = i < 4 ? a : b;
    chars += CODE_ALPHABET[(word >>> ((i % 4) * 5)) & 31] ?? '2';
  }
  return log.exit(`MQ-${chars.slice(0, 4)}-${chars.slice(4)}`);
}

/**
 * QR の中身を作る。
 * @param ticketId チケットID（クーポンID）
 * @param code コード
 * @returns 'MACHIQUEST:TICKET:1:<クーポンID>:<コード>'
 */
export function ticketPayloadOf(ticketId: string, code: string): string {
  const log = logger.fn('ticketPayloadOf', { ticketId });
  return log.exit(`${TICKET_PAYLOAD_PREFIX}:${ticketId}:${code}`);
}

/**
 * クーポンを獲得した日（期間中に初めてそのお店でクエスト達成した日）を返す。
 * @param traveler 旅人
 * @param event クーポン
 * @returns 獲得した日（獲得していなければ undefined）
 */
export function earnedOnOf(traveler: Traveler, event: ShopEvent): LocalDate | undefined {
  const log = logger.fn('earnedOnOf', { ticketId: event.id });
  if (!isCoupon(event)) return log.exit(undefined, 'クーポンではない');
  const dates = traveler.visits.filter((v) => v.spotId === event.spotId && event.period.contains(v.localDate)).map((v) => v.localDate);
  if (dates.length === 0) return log.exit(undefined);
  return log.exit([...dates].sort(compareLocalDate)[0]);
}

/**
 * 旅人が持っているチケットを並べる（使える → 使用済み。使えるものは期限の近い順）。
 * @param traveler 旅人
 * @param spots マスタ参照（クーポン・お店）
 * @param today 今日
 * @returns チケット（凍結済み）
 */
export function ticketsOf(traveler: Traveler, spots: SpotRepository, today: LocalDate): readonly TicketDto[] {
  const log = logger.fn('ticketsOf', { travelerId: traveler.id, today });
  const used = new Map(traveler.redemptions.map((r) => [r.shopEventId, localDateOf(r.redeemedAt)]));
  const out: TicketDto[] = [];
  for (const event of spots.allShopEvents()) {
    if (!isCoupon(event) || compareLocalDate(today, event.period.end) > 0) continue;
    const earnedOn = earnedOnOf(traveler, event);
    const spot = spots.findSpot(event.spotId);
    if (earnedOn === undefined || spot === undefined) continue;
    const code = ticketCodeOf(traveler.id, event.id);
    const usedOn = used.get(event.id);
    out.push(
      Object.freeze({
        id: event.id,
        spotId: spot.id,
        spotName: spot.name,
        districtId: spot.districtId,
        ...(spot.category.length > 0 ? { category: spot.category } : {}),
        title: event.title,
        description: event.description,
        validUntil: event.period.end,
        daysLeft: event.period.daysUntilEnd(today),
        earnedOn,
        status: usedOn === undefined ? 'ready' : 'used',
        code,
        payload: ticketPayloadOf(event.id, code),
        ...(usedOn === undefined ? {} : { usedOn }),
      }),
    );
  }
  out.sort((a, b) => Number(a.status === 'used') - Number(b.status === 'used') || a.daysLeft - b.daysLeft || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return log.exit(Object.freeze(out), `${out.length} 枚`);
}
