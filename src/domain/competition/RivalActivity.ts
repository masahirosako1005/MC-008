/**
 * @file ライバルの訪問回数の計算（domain/competition 層の純粋関数）
 * 背景活動は日付から決定論的に計算し（(epochDay + phase) % intervalDays === 0 の日に1回）、
 * デモの「ライバル行動」（RivalActionVisit）を足し合わせる（docs/08 D9）。同じ入力からは常に同じ結果（DI-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId } from '@/Common/types/Id';
import { compareLocalDate, epochDayOf } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { isNonNegativeInteger, positiveMod } from '@/Common/utils/number';
import { isValidIntervalDays } from '@/domain/competition/Rival';
import type { Rival, RivalActionVisit, RivalPattern } from '@/domain/competition/Rival';

const logger = createLogger('domain/competition/RivalActivity');

/** countRivalVisits の条件 */
export interface RivalVisitQuery {
  readonly rival: Rival;
  /** 旅人の世界に記録されたライバル行動（他のライバルの分が混ざっていてもよい。rivalId で絞る） */
  readonly actions: readonly RivalActionVisit[];
  /** 対象地区（省略で全地区） */
  readonly districtId?: DistrictId;
  /** 開始日（含む） */
  readonly from: LocalDate;
  /** 終了日（含む） */
  readonly to: LocalDate;
}

/**
 * その日が背景活動の訪問日か判定する（(epochDay + phase) % intervalDays === 0）。
 * @param pattern 背景活動（intervalDays は1以上の整数であること）
 * @param date 判定する暦日
 * @returns 訪問日なら true
 */
export function isBackgroundVisitDay(pattern: RivalPattern, date: LocalDate): boolean {
  return isValidIntervalDays(pattern.intervalDays) && positiveMod(epochDayOf(date) + pattern.phase, pattern.intervalDays) === 0;
}

/**
 * 1つの背景活動について、エポック日 [fromDay, toDay] の訪問日数を数える。
 * (e + phase) が intervalDays の倍数になる e の個数を、床関数の差で O(1) に求める（負の日数でも正しい）。
 * @param pattern 背景活動（検証済み）
 * @param fromDay 開始エポック日（含む）
 * @param toDay 終了エポック日（含む。fromDay 以上）
 * @returns 訪問日数
 */
function countPatternDays(pattern: RivalPattern, fromDay: number, toDay: number): number { // audit-ignore: fnlog-missing 純粋な算術ヘルパー（呼び出し側 countBackgroundVisits でまとめてログ）
  const n = pattern.intervalDays;
  return Math.floor((toDay + pattern.phase) / n) - Math.floor((fromDay + pattern.phase - 1) / n);
}

/**
 * 背景活動による訪問回数を数える。不正な背景活動（間隔が1未満・非整数、位相が非整数）は数えない。
 * @param query ライバル・地区（任意）・期間（from ≦ to であること）
 * @returns 訪問回数
 */
function countBackgroundVisits(query: RivalVisitQuery): number {
  const log = logger.fn('countBackgroundVisits', { rivalId: query.rival.id, districtId: query.districtId, from: query.from, to: query.to });
  const fromDay = epochDayOf(query.from);
  const toDay = epochDayOf(query.to);
  let total = 0;
  for (const pattern of query.rival.patterns) {
    if (query.districtId !== undefined && pattern.districtId !== query.districtId) continue;
    if (!isValidIntervalDays(pattern.intervalDays) || !Number.isSafeInteger(pattern.phase)) {
      log.warn('不正な背景活動を無視', { districtId: pattern.districtId });
      continue;
    }
    total += countPatternDays(pattern, fromDay, toDay);
  }
  return log.exit(total);
}

/**
 * ライバル行動（デモの追加訪問）による訪問回数を数える。他のライバル・他の地区・期間外は除く。
 * count が0以上の整数でない行動は数えない（保存データの改ざん・破損に備える）。
 * @param query ライバル・行動・地区（任意）・期間（from ≦ to であること）
 * @returns 訪問回数
 */
function countActionVisits(query: RivalVisitQuery): number {
  const log = logger.fn('countActionVisits', { rivalId: query.rival.id, districtId: query.districtId, actions: query.actions.length });
  let total = 0;
  for (const action of query.actions) {
    if (action.rivalId !== query.rival.id) continue;
    if (query.districtId !== undefined && action.districtId !== query.districtId) continue;
    if (compareLocalDate(action.localDate, query.from) < 0 || compareLocalDate(query.to, action.localDate) < 0) continue;
    if (!isNonNegativeInteger(action.count)) {
      log.warn('不正な回数のライバル行動を無視', { districtId: action.districtId, localDate: action.localDate });
      continue;
    }
    total += action.count;
  }
  return log.exit(total);
}

/**
 * 期間内（両端を含む）のライバルの訪問回数を返す（背景活動＋ライバル行動）。from > to なら 0。
 * 地区の主（直近30日）・月間ランキングの集計に使う（docs/08 D7, D9, D10）。
 * @param query ライバル・行動・地区（省略で全地区）・開始日・終了日
 * @returns 訪問回数（0以上の整数）
 */
export function countRivalVisits(query: RivalVisitQuery): number {
  const log = logger.fn('countRivalVisits', { rivalId: query.rival.id, districtId: query.districtId, from: query.from, to: query.to });
  if (compareLocalDate(query.from, query.to) > 0) return log.exit(0, '開始日が終了日より後');
  return log.exit(countBackgroundVisits(query) + countActionVisits(query));
}

/** ライバル活動の計算（`RivalActivity.countRivalVisits(...)` と書ける名前空間） */
export const RivalActivity = Object.freeze({ countRivalVisits, isBackgroundVisitDay });
