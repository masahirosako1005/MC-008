/**
 * @file 手に入れた月間リーグの報酬を求める（application 層・アバターの所持判定の部品）
 * 報酬の所持は保存せず、追記専用の訪問記録から毎回求める（docs/08 D4, D16。一度手に入れた報酬は失われない＝CLAUDE.md 5 章）。
 * - 順位報酬: 締めた月（今月より前で、訪問のあった月）ごとに、月末時点の順位の段の報酬
 * - キープ報酬: 締めた月は月末まで、今月はいままでに、条件の順位を決まった時間続けて保ったもの
 * ダミー参加者の数値は固定（leagueDummies）なので、締めた月の順位はあとから計算しても変わらない。本番ではサーバーの確定結果に置き換える（docs/08 §4.3）。
 */
import { createLogger } from '@/Common/logging/logger';
import { addDays, endOfMonth, jstInstantOf, monthKeyOf } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { heldSinceOf, myRankWith } from '@/application/usecases/competition/leagueStanding';
import { isRookie, LEAGUE_IDS, leagueScoreOf } from '@/domain/competition/League';
import type { LeagueId, LeagueRecords } from '@/domain/competition/League';
import { KEEP_GOALS, keepProgressOf, keepRewardIdOf, RANK_REWARD_TIERS, rankRewardIdsOf, rankRewardTierIndexOf } from '@/domain/competition/LeagueReward';

const logger = createLogger('application/usecases/competition/leagueAwards');

/**
 * ある時点までに達成したキープ報酬の報酬ID を返す。
 * @param leagueId リーグ
 * @param records あなたの記録
 * @param date 順位を数える日（今月なら今日、締めた月なら月末）
 * @param until 経過時間を測る時点（今月ならいま、締めた月なら翌月1日 0:00）
 * @returns 報酬ID
 */
function keepRewardIdsOf(leagueId: LeagueId, records: LeagueRecords, date: LocalDate, until: Instant): string[] {
  const log = logger.fn('keepRewardIdsOf', { leagueId, date });
  const ids = KEEP_GOALS.filter((goal) => keepProgressOf(goal, heldSinceOf(leagueId, records, date, goal), until).state === 'achieved').map((goal) => keepRewardIdOf(goal.id));
  return log.exit(ids);
}

/**
 * 1リーグ・1か月ぶんの報酬ID を返す。
 * @param leagueId リーグ
 * @param records あなたの記録
 * @param date 順位を数える日
 * @param until 経過時間を測る時点
 * @param closed 締めた月か（締めた月だけ順位報酬が確定する）
 * @returns 報酬ID
 */
function monthRewardIdsOf(leagueId: LeagueId, records: LeagueRecords, date: LocalDate, until: Instant, closed: boolean): string[] {
  const log = logger.fn('monthRewardIdsOf', { leagueId, date, closed });
  if (leagueId === 'rookie' && !isRookie(records, date)) return log.exit([], 'ルーキー卒業済み');
  const score = leagueScoreOf(leagueId, records, date);
  if (score <= 0) return log.exit([], '参加なし');
  const tier = closed ? RANK_REWARD_TIERS[rankRewardTierIndexOf(myRankWith(leagueId, score, date), score)] : undefined;
  return log.exit([...(tier === undefined ? [] : rankRewardIdsOf(tier, leagueId)), ...keepRewardIdsOf(leagueId, records, date, until)]);
}

/**
 * これまでに手に入れた月間リーグの報酬ID を返す。
 * @param records あなたの記録（訪問・発見）
 * @param today 今日
 * @param now いま
 * @returns 報酬ID の集合
 */
export function earnedLeagueRewardIdsOf(records: LeagueRecords, today: LocalDate, now: Instant): ReadonlySet<string> {
  const log = logger.fn('earnedLeagueRewardIdsOf', { visits: records.visits.length, today });
  const thisMonth = monthKeyOf(today);
  const closedMonthEnds = new Map<string, LocalDate>();
  for (const v of records.visits) {
    const key = monthKeyOf(v.localDate);
    if (key < thisMonth && !closedMonthEnds.has(key)) closedMonthEnds.set(key, endOfMonth(v.localDate));
  }
  const earned = new Set<string>();
  for (const leagueId of LEAGUE_IDS) {
    for (const end of closedMonthEnds.values()) {
      for (const id of monthRewardIdsOf(leagueId, records, end, jstInstantOf(addDays(end, 1), 0, 0), true)) earned.add(id);
    }
    for (const id of monthRewardIdsOf(leagueId, records, today, now, false)) earned.add(id);
  }
  log.debug('リーグの報酬', { closedMonths: closedMonthEnds.size, earned: [...earned] });
  return log.exit(earned);
}
