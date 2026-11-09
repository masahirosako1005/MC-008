/**
 * @file 月間リーグの集計ルール（domain/competition 層）
 * 玄人だけが勝つランキングにしないため、指標の違う3リーグを用意する（CLAUDE.md 4.6・6.7）。すべて月間（JST の暦月）でリセット。
 * - かよいリーグ: 今月の訪問回数（D10 と同じ指標）。通い慣れた人が強い
 * - はじめましてリーグ: 今月「はじめて訪れた」スポットの数。初めての人ほど伸びる（基準 B 未開拓への興味）
 * - ルーキーリーグ: 使いはじめて ROOKIE_PERIOD_DAYS 日以内の人だけで、今月の訪問回数を競う
 * どの指標も実際の訪問記録だけで数える（歩かずに稼げる仕組みは作らない＝CLAUDE.md 5）。
 */
import { createLogger } from '@/Common/logging/logger';
import { addDays, compareLocalDate, daysBetween, endOfMonth, localDateOf, startOfMonth } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { ROOKIE_PERIOD_DAYS } from '@/domain/competition/constants';
import type { DiscoveryRecord, VisitRecord } from '@/domain/exploration/VisitRecord';

const logger = createLogger('domain/competition/League');

/** リーグの種類 */
export type LeagueId = 'kayoi' | 'hajimete' | 'rookie';

/** リーグの表示順（タブの並び） */
export const LEAGUE_IDS: readonly LeagueId[] = Object.freeze(['kayoi', 'hajimete', 'rookie']);

/** 旅人の記録（集計に使う分だけ） */
export interface LeagueRecords {
  readonly visits: readonly VisitRecord[];
  readonly discoveries: readonly DiscoveryRecord[];
}

/** 今月の集計期間 */
export interface MonthWindow {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

/**
 * 今月の集計期間（1日〜今日）を返す。
 * @param today 今日
 * @returns 今月1日から今日まで
 */
export function monthWindowOf(today: LocalDate): MonthWindow {
  const log = logger.fn('monthWindowOf', { today });
  return log.exit(Object.freeze({ from: startOfMonth(today), to: today }));
}

/**
 * 月末までの残り日数（今日を含まない。月末当日は 0）。
 * @param today 今日
 * @returns 残り日数
 */
export function daysLeftInMonth(today: LocalDate): number {
  const log = logger.fn('daysLeftInMonth', { today });
  return log.exit(daysBetween(today, endOfMonth(today)));
}

/**
 * 日付が期間内か。
 * @param date 日付
 * @param window 期間（両端を含む）
 * @returns 期間内なら true
 */
function inWindow(date: LocalDate, window: MonthWindow): boolean {
  return compareLocalDate(date, window.from) >= 0 && compareLocalDate(date, window.to) <= 0;
}

/**
 * 今月の訪問回数（かよいリーグ・ルーキーリーグの指標）。
 * @param visits 訪問記録
 * @param today 今日
 * @returns 今月1日〜今日の訪問記録の件数
 */
export function monthlyVisitCount(visits: readonly VisitRecord[], today: LocalDate): number {
  const log = logger.fn('monthlyVisitCount', { visits: visits.length, today });
  const window = monthWindowOf(today);
  return log.exit(visits.filter((v) => inWindow(v.localDate, window)).length);
}

/**
 * 今月「はじめて訪れた」スポットの数（はじめましてリーグの指標）。
 * スポットごとに最初の訪問日を求め、それが今月に入るものを数える。2回目以降の訪問は数えない。
 * @param visits 訪問記録
 * @param today 今日
 * @returns スポット数
 */
export function monthlyNewSpotCount(visits: readonly VisitRecord[], today: LocalDate): number {
  const log = logger.fn('monthlyNewSpotCount', { visits: visits.length, today });
  const firstVisit = new Map<string, LocalDate>();
  for (const v of visits) {
    const known = firstVisit.get(v.spotId);
    if (known === undefined || compareLocalDate(v.localDate, known) < 0) firstVisit.set(v.spotId, v.localDate);
  }
  const window = monthWindowOf(today);
  return log.exit([...firstVisit.values()].filter((date) => inWindow(date, window)).length);
}

/**
 * 使いはじめた日（最初の発見または訪問の日）。
 * @param records 旅人の記録
 * @returns 最も古い記録の日。記録が無ければ undefined（まだ使いはじめていない）
 */
export function startDateOf(records: LeagueRecords): LocalDate | undefined {
  const log = logger.fn('startDateOf', { visits: records.visits.length, discoveries: records.discoveries.length });
  const dates = [...records.visits.map((v) => v.localDate), ...records.discoveries.map((d) => localDateOf(d.discoveredAt))];
  const earliest = dates.reduce<LocalDate | undefined>((min, date) => (min === undefined || compareLocalDate(date, min) < 0 ? date : min), undefined);
  return log.exit(earliest);
}

/**
 * ルーキーリーグに参加できるか（使いはじめた日を含めて ROOKIE_PERIOD_DAYS 日以内。記録が無い人も参加できる）。
 * @param records 旅人の記録
 * @param today 今日
 * @returns 参加できるなら true
 */
export function isRookie(records: LeagueRecords, today: LocalDate): boolean {
  const log = logger.fn('isRookie', { today });
  const start = startDateOf(records);
  if (start === undefined) return log.exit(true, '記録なし');
  return log.exit(daysBetween(start, today) < ROOKIE_PERIOD_DAYS);
}

/**
 * ルーキーリーグを卒業する日（この日から参加できない）。
 * @param records 旅人の記録
 * @returns 卒業日。記録が無ければ undefined
 */
export function rookieGraduationDateOf(records: LeagueRecords): LocalDate | undefined {
  const log = logger.fn('rookieGraduationDateOf');
  const start = startDateOf(records);
  if (start === undefined) return log.exit(undefined);
  const graduation = addDays(start, ROOKIE_PERIOD_DAYS);
  return log.exit(graduation);
}

/**
 * リーグごとの自分の数値を返す。
 * @param leagueId リーグ
 * @param records 旅人の記録
 * @param today 今日
 * @returns 指標の値（0以上の整数）
 */
export function leagueScoreOf(leagueId: LeagueId, records: LeagueRecords, today: LocalDate): number {
  const log = logger.fn('leagueScoreOf', { leagueId, today });
  if (leagueId === 'hajimete') return log.exit(monthlyNewSpotCount(records.visits, today));
  return log.exit(monthlyVisitCount(records.visits, today));
}
