/**
 * @file 訪問記録を時系列に並べる補助（domain/reward 層の純粋関数）
 * カード・アイテムの「条件を満たした訪問の日付（earnedOn）」を、記録の保存順に左右されず決めるために使う（DI-05）。
 */
import { createLogger } from '@/Common/logging/logger';
import { compareInstant, compareLocalDate } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';

const logger = createLogger('domain/reward/VisitChronology');

/**
 * 2件の訪問記録を時系列で比較する（JST 暦日 → 訪問日時 → スポットID の順）。
 * @param a 訪問記録
 * @param b 訪問記録
 * @returns a が先なら負、後なら正、同じなら 0
 */
function compareVisits(a: VisitRecord, b: VisitRecord): number { // audit-ignore: fnlog-missing sort の比較で多数回呼ばれる純粋ヘルパー（呼び出し側でまとめてログ）
  const byDate = compareLocalDate(a.localDate, b.localDate);
  if (byDate !== 0) return byDate;
  const byTime = compareInstant(a.visitedAt, b.visitedAt);
  if (byTime !== 0) return byTime;
  return a.spotId < b.spotId ? -1 : a.spotId > b.spotId ? 1 : 0; // ロケールに左右されない比較
}

/**
 * 訪問記録を古い順に並べた新しい配列を返す（元の配列は変えない）。
 * @param visits 訪問記録（順不同でよい）
 * @returns 古い順の訪問記録
 */
export function sortVisitsChronologically(visits: readonly VisitRecord[]): VisitRecord[] {
  const log = logger.fn('sortVisitsChronologically', { count: visits.length });
  const sorted = [...visits].sort(compareVisits);
  return log.exit(sorted, '並べ替え完了');
}
