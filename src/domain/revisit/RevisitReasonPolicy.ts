/**
 * @file 再訪理由を集めるルール（domain/revisit 層の純粋関数）
 * 期限・取り返し・色あせ・未訪問の4種を「状態＋今日」から毎回導出し、表示順に並べて返す（CLAUDE.md 4.5、DI-05）。
 * 地区の主の情報は competition の集約（LordshipBoard）に依存しないよう、素朴な構造体（LordshipSnapshot）で受け取る。
 * 取り返しの必要回数だけは competition の純粋関数 visitsNeededToReclaim を使い、計算式を1か所にそろえる（D8）。
 * 新着（new）は将来の種別で、v0.1 では生成しない。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId, ShopEventId, SpotId } from '@/Common/types/Id';
import type { LocalDate } from '@/Common/utils/date';
import { toNonNegativeInt } from '@/Common/utils/number';
import { visitsNeededToReclaim } from '@/domain/competition/LordPolicy';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { lastVisitDate } from '@/domain/exploration/VisitStats';
import { DEADLINE_NOTICE_DAYS } from '@/domain/revisit/constants';
import { sortRevisitReasons } from '@/domain/revisit/RevisitReason';
import type { DeadlineReason, FadeReason, ReclaimReason, RevisitReason, UnvisitedReason } from '@/domain/revisit/RevisitReason';
import { isActive } from '@/domain/revisit/ShopEvent';
import type { ShopEvent } from '@/domain/revisit/ShopEvent';
import type { Spot } from '@/domain/spot/Spot';
import type { District } from '@/domain/town/District';
import { stateFor } from '@/domain/town/FadePolicy';
import type { FadeState } from '@/domain/town/FadePolicy';

const logger = createLogger('domain/revisit/RevisitReasonPolicy');

/** 地区の主の状況（application が competition の LordshipBoard と集計から作って渡す） */
export interface LordshipSnapshot {
  readonly districtId: DistrictId;
  /** いまの地区の主の表示名（主がいなければ無し） */
  readonly lordName?: string;
  /** 旅人自身が地区の主か */
  readonly isMe: boolean;
  /** 旅人が主の座をライバルに奪われ、まだ取り返していないか（D8） */
  readonly lostByTraveler: boolean;
  /** 地区の主の直近30日の訪問回数 */
  readonly lordCount: number;
  /** 旅人の直近30日の訪問回数 */
  readonly myCount: number;
}

/** collect の入力 */
export interface RevisitReasonInput {
  /** 今日（Clock.today()） */
  readonly today: LocalDate;
  /** 全スポット（マスタ） */
  readonly spots: readonly Spot[];
  /** 全地区（マスタ）。色あせ・未訪問・取り返しはここに含まれる地区だけを対象にする */
  readonly districts: readonly District[];
  /** 全クーポン・イベント（マスタ） */
  readonly shopEvents: readonly ShopEvent[];
  /** 旅人の全訪問記録 */
  readonly visits: readonly VisitRecord[];
  /** 旅人が発見済みのスポット（訪問済みも含む） */
  readonly discoveredSpotIds: ReadonlySet<SpotId>;
  /** 地区ごとの主の状況 */
  readonly lordships: readonly LordshipSnapshot[];
  /** 利用済みのクーポン（省略可）。もう使えないクーポンの期限は知らせない */
  readonly redeemedShopEventIds?: ReadonlySet<ShopEventId>;
}

/**
 * 地区一覧から重複のない地区 ID を元の順で取り出す。
 * @param districts 地区一覧
 * @returns 地区 ID（重複なし）
 */
function uniqueDistrictIds(districts: readonly District[]): DistrictId[] {
  return [...new Set(districts.map((district) => district.id))];
}

/**
 * 期限の理由を集める（D12）。発見済みスポットのクーポン・イベントで、今日が期間内かつ残り DEADLINE_NOTICE_DAYS 日以内のもの。
 * 未発見スポットのクーポン・イベントは名前を漏らさないため出さない（B）。利用済みのクーポンも出さない。
 * @param input collect の入力
 * @returns 期限の理由（クーポン・イベントごとに1件）
 */
function deadlineReasons(input: RevisitReasonInput): DeadlineReason[] {
  const log = logger.fn('deadlineReasons', { shopEvents: input.shopEvents.length, today: input.today });
  const seen = new Set<ShopEventId>();
  const reasons: DeadlineReason[] = [];
  for (const event of input.shopEvents) {
    if (seen.has(event.id) || !input.discoveredSpotIds.has(event.spotId)) continue;
    if (input.redeemedShopEventIds?.has(event.id) === true || !isActive(event, input.today)) continue;
    const daysLeft = event.period.daysUntilEnd(input.today);
    if (daysLeft > DEADLINE_NOTICE_DAYS) continue;
    seen.add(event.id);
    reasons.push(
      Object.freeze({ kind: 'deadline', shopEventId: event.id, spotId: event.spotId, districtId: event.districtId, title: event.title, daysLeft }),
    );
  }
  return log.exit(reasons);
}

/**
 * 地区の主の状況から取り返しの理由を作る（D8）。
 * 奪われていて（lostByTraveler）、いま自分が主でなく、主の名前があるときだけ作る。
 * 必要回数は competition の LordPolicy.visitsNeededToReclaim（主の回数 − 自分の回数 + 1、最小 1）で求め、画面間で数字をそろえる（D2）。
 * @param lordship 地区の主の状況
 * @returns 取り返しの理由。対象外なら undefined
 */
function reclaimReasonOf(lordship: LordshipSnapshot): ReclaimReason | undefined {
  const log = logger.fn('reclaimReasonOf', { districtId: lordship.districtId, isMe: lordship.isMe, lostByTraveler: lordship.lostByTraveler });
  const lordName = lordship.lordName?.trim() ?? '';
  if (!lordship.lostByTraveler || lordship.isMe || lordName === '') return log.exit(undefined);
  const lordCount = toNonNegativeInt(lordship.lordCount);
  const myCount = toNonNegativeInt(lordship.myCount);
  const needed = visitsNeededToReclaim(lordCount, myCount);
  const reason: ReclaimReason = Object.freeze({ kind: 'reclaim', districtId: lordship.districtId, lordName, lordCount, myCount, needed });
  return log.exit(reason);
}

/**
 * 取り返しの理由を集める（地区ごとに最大1件。入力に無い地区の情報は無視する）。
 * @param input collect の入力
 * @returns 取り返しの理由
 */
function reclaimReasons(input: RevisitReasonInput): ReclaimReason[] {
  const log = logger.fn('reclaimReasons', { lordships: input.lordships.length });
  const known = new Set(uniqueDistrictIds(input.districts));
  const seen = new Set<DistrictId>();
  const reasons: ReclaimReason[] = [];
  for (const lordship of input.lordships) {
    if (seen.has(lordship.districtId)) continue;
    if (!known.has(lordship.districtId)) {
      log.warn('地区一覧に無い地区の主情報を無視した', { districtId: lordship.districtId });
      continue;
    }
    const reason = reclaimReasonOf(lordship);
    if (reason === undefined) continue;
    seen.add(lordship.districtId);
    reasons.push(reason);
  }
  return log.exit(reasons);
}

/**
 * 地区の色あせ状態から色あせの理由を作る。soon（そろそろ）と fading（色あせ中）だけが対象で、never / fresh は出さない。
 * @param districtId 地区 ID
 * @param fade 色あせ状態（FadePolicy.stateFor の結果）
 * @returns 色あせの理由。対象外なら undefined
 */
function fadeReasonOf(districtId: DistrictId, fade: FadeState): FadeReason | undefined {
  const log = logger.fn('fadeReasonOf', { districtId, kind: fade.kind });
  if (fade.kind === 'soon') {
    const { daysSinceVisit, daysUntilFade, fadeStartDate } = fade;
    return log.exit(Object.freeze({ kind: 'fade', districtId, state: 'soon', daysSinceVisit, daysUntilFade, fadeStartDate }));
  }
  if (fade.kind === 'fading') {
    const { daysSinceVisit, fadeStartDate } = fade;
    return log.exit(Object.freeze({ kind: 'fade', districtId, state: 'fading', daysSinceVisit, fadeStartDate }));
  }
  return log.exit(undefined);
}

/**
 * 色あせの理由を集める（地区ごとに最大1件。最終訪問日から FadePolicy で判定）。
 * @param input collect の入力
 * @returns 色あせの理由
 */
function fadeReasons(input: RevisitReasonInput): FadeReason[] {
  const log = logger.fn('fadeReasons', { districts: input.districts.length, today: input.today });
  const reasons: FadeReason[] = [];
  for (const districtId of uniqueDistrictIds(input.districts)) {
    const reason = fadeReasonOf(districtId, stateFor(lastVisitDate(input.visits, districtId), input.today));
    if (reason !== undefined) reasons.push(reason);
  }
  return log.exit(reasons);
}

/**
 * 発見済み・未訪問のスポットを地区ごとにまとめる。
 * @param input collect の入力
 * @returns 地区 ID → 発見済み・未訪問のスポット ID の集合
 */
function unvisitedSpotsByDistrict(input: RevisitReasonInput): Map<DistrictId, Set<SpotId>> {
  const log = logger.fn('unvisitedSpotsByDistrict', { spots: input.spots.length, discovered: input.discoveredSpotIds.size });
  const visited = new Set(input.visits.map((visit) => visit.spotId));
  const byDistrict = new Map<DistrictId, Set<SpotId>>();
  for (const spot of input.spots) {
    if (!input.discoveredSpotIds.has(spot.id) || visited.has(spot.id)) continue;
    const ids = byDistrict.get(spot.districtId) ?? new Set<SpotId>();
    ids.add(spot.id);
    byDistrict.set(spot.districtId, ids);
  }
  return log.exit(byDistrict);
}

/**
 * 未訪問の理由を集める（地区ごとに最大1件。spotIds は id 昇順）。
 * @param input collect の入力
 * @returns 未訪問の理由
 */
function unvisitedReasons(input: RevisitReasonInput): UnvisitedReason[] {
  const log = logger.fn('unvisitedReasons', { districts: input.districts.length });
  const byDistrict = unvisitedSpotsByDistrict(input);
  const reasons: UnvisitedReason[] = [];
  for (const districtId of uniqueDistrictIds(input.districts)) {
    const ids = byDistrict.get(districtId);
    if (ids === undefined || ids.size === 0) continue;
    const spotIds: readonly SpotId[] = Object.freeze([...ids].sort());
    reasons.push(Object.freeze({ kind: 'unvisited', districtId, spotIds }));
  }
  return log.exit(reasons);
}

/**
 * 今日時点の再訪理由をすべて集め、表示順（sortRevisitReasons）に並べて返す。
 * 期限＞取り返し＞色あせ＞未訪問の順。同じ入力には常に同じ結果を返し、入力配列の並び順にも左右されない（DI-05）。
 * @param input 今日・マスタ（スポット・地区・クーポン/イベント）・訪問記録・発見済みスポット・地区の主の状況
 * @returns 並べ替え済みの再訪理由（新しい配列）
 */
export function collect(input: RevisitReasonInput): RevisitReason[] {
  const log = logger.fn('collect', {
    today: input.today,
    spots: input.spots.length,
    districts: input.districts.length,
    shopEvents: input.shopEvents.length,
    visits: input.visits.length,
    discovered: input.discoveredSpotIds.size,
    lordships: input.lordships.length,
  });
  const reasons: RevisitReason[] = [...deadlineReasons(input), ...reclaimReasons(input), ...fadeReasons(input), ...unvisitedReasons(input)];
  return log.exit(sortRevisitReasons(reasons));
}

/**
 * 再訪理由ルールの名前空間（docs/08 の `RevisitReasonPolicy.collect(...)` 表記で呼べるようにする）。
 * 名前付き import の collect と同じ関数を指す。
 */
export const RevisitReasonPolicy = Object.freeze({ collect });
