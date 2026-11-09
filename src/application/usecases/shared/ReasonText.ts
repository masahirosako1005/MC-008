/**
 * @file 再訪理由（RevisitReason）を画面向けの日本語 DTO（RevisitReasonDto）にする共通部品（application 層）
 * 下シート・通知で同じ文言を使うため、文言はここに集約する（CLAUDE.md 4.5）。名前はマスタ（SpotRepository）から引く。
 * 未発見スポットの名前は出さない前提（期限・未訪問の理由は RevisitReasonPolicy が発見済みスポットだけから作る＝D12）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId, ShopEventId, SpotId } from '@/Common/types/Id';
import { assertNever } from '@/Common/utils/assert';
import type { RevisitReasonDto } from '@/application/dto/Dto';
import { LORD_WINDOW_DAYS } from '@/domain/competition/constants';
import type { DeadlineReason, FadeReason, NewReason, ReclaimReason, RevisitReason, UnvisitedReason } from '@/domain/revisit/RevisitReason';
import type { ShopEventKind } from '@/domain/revisit/ShopEvent';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/shared/ReasonText');

/** 未訪問の理由で名前を並べる最大件数 */
export const UNVISITED_NAMES_MAX = 3;

/** マスタに名前が無いときの地区名 */
const UNKNOWN_DISTRICT_NAME = 'この地区';

/** マスタに名前が無いときのスポット名 */
const UNKNOWN_SPOT_NAME = 'スポット';

/** クーポン・イベントの種別の表示名 */
const SHOP_EVENT_KIND_LABEL: Readonly<Record<ShopEventKind, string>> = { coupon: 'クーポン', event: 'イベント' };

/** 種別が分からないクーポン・イベントの表示名 */
const UNKNOWN_SHOP_EVENT_LABEL = 'クーポン・イベント';

/**
 * 地区名を引く（マスタに無ければ「この地区」）。
 * @param spots マスタ参照
 * @param districtId 地区ID
 * @returns 地区名
 */
function districtNameOf(spots: SpotRepository, districtId: DistrictId): string {
  return spots.findDistrict(districtId)?.name ?? UNKNOWN_DISTRICT_NAME;
}

/**
 * スポット名を引く（マスタに無ければ「スポット」）。
 * @param spots マスタ参照
 * @param spotId スポットID
 * @returns スポット名
 */
function spotNameOf(spots: SpotRepository, spotId: SpotId): string {
  return spots.findSpot(spotId)?.name ?? UNKNOWN_SPOT_NAME;
}

/**
 * クーポン・イベントの種別の表示名を引く（マスタに無ければ「クーポン・イベント」）。
 * @param spots マスタ参照
 * @param reason 期限の理由（spotId と shopEventId を使う）
 * @returns 「クーポン」「イベント」または「クーポン・イベント」
 */
function shopEventLabelOf(spots: SpotRepository, reason: { readonly spotId: SpotId; readonly shopEventId: ShopEventId }): string {
  const log = logger.fn('shopEventLabelOf', { shopEventId: reason.shopEventId });
  const event = spots.shopEventsForSpot(reason.spotId).find((candidate) => candidate.id === reason.shopEventId);
  if (event === undefined) log.warn('マスタに無いクーポン・イベント', { shopEventId: reason.shopEventId });
  return log.exit(event === undefined ? UNKNOWN_SHOP_EVENT_LABEL : SHOP_EVENT_KIND_LABEL[event.kind]);
}

/**
 * 期限の理由を文言にする。title「{スポット名}の{クーポン|イベント}、あと{n}日」（0日は「今日まで」）、subtitle はクーポン・イベントの題名。
 * @param reason 期限の理由
 * @param spots マスタ参照
 * @returns RevisitReasonDto（kind='deadline'）
 */
function deadlineDto(reason: DeadlineReason, spots: SpotRepository): RevisitReasonDto {
  const log = logger.fn('deadlineDto', { shopEventId: reason.shopEventId, daysLeft: reason.daysLeft });
  const remaining = reason.daysLeft <= 0 ? '今日まで' : `あと${reason.daysLeft}日`;
  const title = `${spotNameOf(spots, reason.spotId)}の${shopEventLabelOf(spots, reason)}、${remaining}`;
  return log.exit({ kind: 'deadline', title, subtitle: reason.title, districtId: reason.districtId, spotId: reason.spotId, shopEventId: reason.shopEventId });
}

/**
 * 取り返しの理由を文言にする。
 * title「{地区名}の主を{lordName}に奪われた」、subtitle「直近30日：{lordName} {lordCount}回／あなた {myCount}回・取り返しまであと{needed}回」。
 * @param reason 取り返しの理由
 * @param spots マスタ参照
 * @returns RevisitReasonDto（kind='reclaim'）
 */
function reclaimDto(reason: ReclaimReason, spots: SpotRepository): RevisitReasonDto {
  const log = logger.fn('reclaimDto', { districtId: reason.districtId, lordCount: reason.lordCount, myCount: reason.myCount, needed: reason.needed });
  const title = `${districtNameOf(spots, reason.districtId)}の主を${reason.lordName}に奪われた`;
  const subtitle = `直近${LORD_WINDOW_DAYS}日：${reason.lordName} ${reason.lordCount}回／あなた ${reason.myCount}回・取り返しまであと${reason.needed}回`;
  return log.exit({ kind: 'reclaim', title, subtitle, districtId: reason.districtId });
}

/**
 * 色あせの理由を文言にする。
 * soon: title「そろそろ色あせ：{地区名} あと{d}日」、subtitle「最終訪問 {n}日前」、カレンダー追加つき。
 * fading: title「色あせ中：{地区名}」、subtitle「最終訪問 {n}日前・再訪で復活＋おかえりボーナス」。
 * @param reason 色あせの理由
 * @param spots マスタ参照
 * @returns RevisitReasonDto（kind='fade'）
 */
function fadeDto(reason: FadeReason, spots: SpotRepository): RevisitReasonDto {
  const log = logger.fn('fadeDto', { districtId: reason.districtId, state: reason.state, daysSinceVisit: reason.daysSinceVisit });
  const districtName = districtNameOf(spots, reason.districtId);
  const lastVisit = `最終訪問 ${reason.daysSinceVisit}日前`;
  if (reason.state === 'fading') {
    return log.exit({ kind: 'fade', title: `色あせ中：${districtName}`, subtitle: `${lastVisit}・再訪で復活＋おかえりボーナス`, districtId: reason.districtId });
  }
  const title = `そろそろ色あせ：${districtName} あと${reason.daysUntilFade ?? 0}日`;
  return log.exit({ kind: 'fade', title, subtitle: lastVisit, districtId: reason.districtId, calendar: { districtName, fadeStartDate: reason.fadeStartDate } });
}

/**
 * 未訪問の理由を文言にする。title「{地区名}にまだ行っていないスポットが{n}件」、subtitle は名前を「、」で最大3件（超えたら末尾に「ほか」）。
 * @param reason 未訪問の理由
 * @param spots マスタ参照
 * @returns RevisitReasonDto（kind='unvisited'。spotId は先頭のスポット）
 */
function unvisitedDto(reason: UnvisitedReason, spots: SpotRepository): RevisitReasonDto {
  const log = logger.fn('unvisitedDto', { districtId: reason.districtId, count: reason.spotIds.length });
  const title = `${districtNameOf(spots, reason.districtId)}にまだ行っていないスポットが${reason.spotIds.length}件`;
  const names = reason.spotIds.slice(0, UNVISITED_NAMES_MAX).map((spotId) => spotNameOf(spots, spotId));
  const subtitle = `${names.join('、')}${reason.spotIds.length > UNVISITED_NAMES_MAX ? 'ほか' : ''}`;
  const first = reason.spotIds[0];
  return log.exit({ kind: 'unvisited', title, subtitle, districtId: reason.districtId, ...(first === undefined ? {} : { spotId: first }) });
}

/**
 * 新着の理由を文言にする（将来の種別。v0.1 の RevisitReasonPolicy は生成しない）。
 * @param reason 新着の理由
 * @param spots マスタ参照
 * @returns RevisitReasonDto（kind='new'）
 */
function newDto(reason: NewReason, spots: SpotRepository): RevisitReasonDto {
  const log = logger.fn('newDto', { spotId: reason.spotId });
  const title = `新着：${spotNameOf(spots, reason.spotId)}`;
  return log.exit({ kind: 'new', title, subtitle: `${districtNameOf(spots, reason.districtId)}に新しいスポット`, districtId: reason.districtId, spotId: reason.spotId });
}

/**
 * 再訪理由を画面向けの日本語 DTO にする。
 * @param reason 再訪理由（RevisitReasonPolicy.collect の要素）
 * @param spots マスタ参照（地区名・スポット名・クーポン/イベント種別を引く）
 * @returns RevisitReasonDto（凍結済み）
 */
export function reasonDtoOf(reason: RevisitReason, spots: SpotRepository): RevisitReasonDto {
  const log = logger.fn('reasonDtoOf', { kind: reason.kind, districtId: reason.districtId });
  switch (reason.kind) {
    case 'deadline':
      return log.exit(Object.freeze(deadlineDto(reason, spots)));
    case 'reclaim':
      return log.exit(Object.freeze(reclaimDto(reason, spots)));
    case 'fade':
      return log.exit(Object.freeze(fadeDto(reason, spots)));
    case 'unvisited':
      return log.exit(Object.freeze(unvisitedDto(reason, spots)));
    case 'new':
      return log.exit(Object.freeze(newDto(reason, spots)));
    default:
      return assertNever(reason);
  }
}

/**
 * 再訪理由の並び（表示順のまま）を DTO の配列にする。
 * @param reasons 再訪理由（並べ替え済み）
 * @param spots マスタ参照
 * @returns RevisitReasonDto の配列（入力と同じ順）
 */
export function reasonDtosOf(reasons: readonly RevisitReason[], spots: SpotRepository): RevisitReasonDto[] {
  const log = logger.fn('reasonDtosOf', { count: reasons.length });
  return log.exit(reasons.map((reason) => reasonDtoOf(reason, spots)));
}
