/**
 * @file 訪問の加点とおかえりボーナス・復活の判定（domain/reward 層の純粋関数）
 * - 基本点: 名所 VISIT_POINTS_LANDMARK、店舗 VISIT_POINTS_SHOP（docs/08 D11）
 * - おかえり: 同じ地区の「今日より前」の最終訪問から見て今日が色あせ中（FadePolicy の fading＝FADE_START_DAYS 日以上）なら、
 *   当日その地区の訪問はすべて 基本点×WELCOME_BACK_MULTIPLIER（端数切捨て）。差分を bonus として返す（D6）
 * - 復活: 訪問前の同地区の最終訪問（今日を含む）から見て色あせ中なら revived（当日の2回目以降は revived ではない）
 * 「色あせ中」の判定は town の FadePolicy.stateFor に一本化し、地図の色あせ表示と食い違わないようにする（D5, D6）。
 * 時刻・乱数は使わず、引数の訪問記録と today だけで決まる（DI-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId } from '@/Common/types/Id';
import { addDays, daysBetween } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { floorToInt } from '@/Common/utils/number';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { lastVisitDate } from '@/domain/exploration/VisitStats';
import { VISIT_POINTS_LANDMARK, VISIT_POINTS_SHOP, WELCOME_BACK_MULTIPLIER } from '@/domain/reward/constants';
import type { Spot, SpotKind } from '@/domain/spot/Spot';
import { stateFor } from '@/domain/town/FadePolicy';

const logger = createLogger('domain/reward/VisitRewardPolicy');

/** スポット種別ごとの基本点（Record なので種別を足すと型エラーで気づける） */
const BASE_POINTS: Readonly<Record<SpotKind, number>> = Object.freeze({ landmark: VISIT_POINTS_LANDMARK, shop: VISIT_POINTS_SHOP });

/** rewardFor の入力 */
export interface VisitRewardInput {
  /** 訪問したスポット（種別と地区だけを使う） */
  readonly spot: Pick<Spot, 'kind' | 'districtId'>;
  /** この訪問を含まない、それまでの訪問記録（全地区でよい。当日の先の訪問は含む） */
  readonly visitsBefore: readonly VisitRecord[];
  /** この訪問の JST 暦日 */
  readonly today: LocalDate;
}

/** rewardFor の結果（ポイントはすべて 0 以上の整数） */
export interface VisitReward {
  /** 基本点（名所 10・店舗 15（仮）） */
  readonly basePoints: number;
  /** おかえりボーナスの差分（floor(基本点×倍率) − 基本点）。おかえりの日でなければ 0 */
  readonly bonusPoints: number;
  /** 基本点＋ボーナス */
  readonly totalPoints: number;
  /** 当日その地区がおかえりボーナスの対象か */
  readonly isWelcomeBackDay: boolean;
  /** 適用した倍率（おかえりの日は WELCOME_BACK_MULTIPLIER、それ以外は 1） */
  readonly multiplier: number;
}

/** isRevival / isWelcomeBackDay の入力 */
export interface DistrictVisitInput {
  /** この訪問を含まない、それまでの訪問記録（全地区でよい） */
  readonly visitsBefore: readonly VisitRecord[];
  readonly districtId: DistrictId;
  /** この訪問の JST 暦日 */
  readonly today: LocalDate;
}

/** isRevival の結果 */
export interface RevivalCheck {
  /** この訪問で地区が復活した（色あせから戻った）か */
  readonly revived: boolean;
  /** 直前の訪問（今日を含む）からの日数。その地区への初訪問なら undefined */
  readonly daysSinceLastVisit?: number;
}

/**
 * 最終訪問日から見て、今日その地区が色あせ中（FadePolicy.stateFor が fading）か判定する。
 * 復活・おかえりの境界（FADE_START_DAYS 日）を地図の色あせ表示と同じルールで決めるための共通処理。
 * @param lastVisit 地区の最終訪問日（today 以前）
 * @param today この訪問の JST 暦日
 * @returns 色あせ中なら true
 */
function isFadingOn(lastVisit: LocalDate, today: LocalDate): boolean {
  return stateFor(lastVisit, today).kind === 'fading';
}

/**
 * スポット種別ごとの基本点を返す（名所 VISIT_POINTS_LANDMARK、店舗 VISIT_POINTS_SHOP）。
 * @param kind スポット種別
 * @returns 基本点（0 以上の整数）
 */
export function basePointsFor(kind: SpotKind): number {
  return BASE_POINTS[kind];
}

/**
 * 基本点におかえり倍率（WELCOME_BACK_MULTIPLIER）を掛け、端数を切り捨てた合計点を返す（例: 15×1.5=22.5→22）。
 * @param basePoints 基本点（0 以上の整数）
 * @returns 倍率適用後の合計点（0 以上の整数）
 */
export function welcomeBackTotal(basePoints: number): number {
  return floorToInt(basePoints * WELCOME_BACK_MULTIPLIER);
}

/**
 * その日がその地区の「おかえりの日」か判定する。
 * 今日より前の最終訪問から見て今日が色あせ中（FADE_START_DAYS 日以上）なら true（当日の2回目以降の訪問も true のまま）。
 * その地区に今日より前の訪問が無ければ false（初めての地区はおかえりではない）。
 * @param input それまでの訪問記録・地区・今日
 * @returns おかえりの日なら true
 */
export function isWelcomeBackDay(input: DistrictVisitInput): boolean {
  const log = logger.fn('isWelcomeBackDay', { districtId: input.districtId, today: input.today });
  const last = lastVisitDate(input.visitsBefore, input.districtId, input.today);
  if (last === undefined) return log.exit(false, '今日より前の訪問なし');
  log.debug('今日より前の最終訪問からの日数', { days: daysBetween(last, input.today) });
  return log.exit(isFadingOn(last, input.today));
}

/**
 * 1回の訪問で得るポイント（基本点とおかえりボーナスの差分）を計算する（D6, D11）。
 * 台帳には基本点を `:visit`、差分（bonusPoints > 0 のとき）を `:bonus` の行として追記する想定。
 * @param input 訪問したスポット・それまでの訪問記録・今日
 * @returns 基本点・ボーナス差分・合計・おかえりの日か・倍率
 */
export function rewardFor(input: VisitRewardInput): VisitReward {
  const log = logger.fn('rewardFor', { kind: input.spot.kind, districtId: input.spot.districtId, today: input.today });
  const basePoints = basePointsFor(input.spot.kind);
  const welcomeBack = isWelcomeBackDay({ visitsBefore: input.visitsBefore, districtId: input.spot.districtId, today: input.today });
  const totalPoints = welcomeBack ? welcomeBackTotal(basePoints) : basePoints;
  const reward: VisitReward = {
    basePoints,
    bonusPoints: totalPoints - basePoints,
    totalPoints,
    isWelcomeBackDay: welcomeBack,
    multiplier: welcomeBack ? WELCOME_BACK_MULTIPLIER : 1,
  };
  return log.exit(Object.freeze(reward));
}

/**
 * この訪問で地区が復活する（色あせから戻る）か判定する（D6 の DistrictRevived の条件）。
 * 訪問前の同地区の最終訪問（今日の先の訪問を含む）から見て色あせ中（FADE_START_DAYS 日以上）なら revived。
 * 同じ日の2回目以降は直前の訪問が今日（0日）になるので revived にならない。初訪問の地区も revived ではない。
 * @param input それまでの訪問記録・地区・今日
 * @returns revived と、直前の訪問からの日数（初訪問なら省略）
 */
export function isRevival(input: DistrictVisitInput): RevivalCheck {
  const log = logger.fn('isRevival', { districtId: input.districtId, today: input.today });
  const last = lastVisitDate(input.visitsBefore, input.districtId, addDays(input.today, 1)); // 明日より前＝今日を含む
  if (last === undefined) return log.exit(Object.freeze({ revived: false }), 'その地区への初訪問');
  const daysSinceLastVisit = daysBetween(last, input.today);
  return log.exit(Object.freeze({ revived: isFadingOn(last, input.today), daysSinceLastVisit }));
}

/** 訪問報酬の判定をまとめた名前空間（`VisitRewardPolicy.rewardFor(...)` と書ける） */
export const VisitRewardPolicy = Object.freeze({ rewardFor, isRevival, isWelcomeBackDay, basePointsFor, welcomeBackTotal });
