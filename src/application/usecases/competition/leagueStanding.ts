/**
 * @file リーグの中の「あなた」の順位の求め方（application 層・GetRankingUseCase と leagueAwards の共通部品）
 * ダミー参加者（leagueDummies）と「あなた」を並べて Ranking.from で順位をつける（D10）。
 * ダミーの数値は固定なので、順位はあなたの記録だけで決まる。締めた月の順位も、その月の末日を「今日」として同じ計算で求められる。
 */
import { createLogger } from '@/Common/logging/logger';
import { compareInstant, jstInstantOf, startOfMonth } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { LEAGUE_DUMMIES } from '@/application/usecases/competition/leagueDummies';
import { TRAVELER_LORD_NAME } from '@/application/usecases/shared/LordStandings';
import { leagueScoreOf } from '@/domain/competition/League';
import type { LeagueId, LeagueRecords } from '@/domain/competition/League';
import type { KeepGoal } from '@/domain/competition/LeagueReward';
import { Ranking } from '@/domain/competition/Ranking';
import type { RankingParticipant } from '@/domain/competition/Ranking';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';

const logger = createLogger('application/usecases/competition/leagueStanding');

/** 「あなた」の参加者キー */
export const ME_KEY = 'traveler';

/**
 * ダミーと「あなた」を参加者の配列にする。
 * @param leagueId リーグ
 * @param myCount あなたの数値（undefined なら不参加）
 * @returns 参加者
 */
export function participantsOf(leagueId: LeagueId, myCount: number | undefined): RankingParticipant[] {
  const log = logger.fn('participantsOf', { leagueId, joined: myCount !== undefined });
  const others: RankingParticipant[] = LEAGUE_DUMMIES[leagueId].map((d) => ({ key: d.key, name: d.name, isMe: false, count: d.count }));
  if (myCount === undefined) return log.exit(others);
  return log.exit([...others, { key: ME_KEY, name: TRAVELER_LORD_NAME, isMe: true, count: myCount }]);
}

/**
 * あなたの順位を返す。
 * @param leagueId リーグ
 * @param myCount あなたの数値
 * @param today 今日
 * @returns 順位
 */
export function myRankWith(leagueId: LeagueId, myCount: number, today: LocalDate): number {
  const log = logger.fn('myRankWith', { leagueId, myCount });
  const ranking = Ranking.from({ participants: participantsOf(leagueId, myCount), asOf: today });
  return log.exit(ranking.entries.find((e) => e.isMe)?.rank ?? ranking.entries.length);
}

/**
 * 訪問記録の一部（ある時点までの訪問）だけで数えたときの、あなたの順位を返す。
 * @param leagueId リーグ
 * @param records あなたの記録（発見記録はそのまま使う）
 * @param visits 数に入れる訪問
 * @param today 今日
 * @returns 順位
 */
function rankWithVisits(leagueId: LeagueId, records: LeagueRecords, visits: readonly VisitRecord[], today: LocalDate): number {
  const log = logger.fn('rankWithVisits', { leagueId, visits: visits.length });
  return log.exit(myRankWith(leagueId, leagueScoreOf(leagueId, { visits, discoveries: records.discoveries }, today), today));
}

/**
 * あなたがいま goal.maxRank 位以内にいるなら、その順位に入った瞬間を返す（キープ報酬の起点）。
 * ダミーの数値は固定なので、順位はあなたの記録が増えたときだけ上がる。訪問を古い順に1件ずつ足し、初めて条件の順位に入った訪問の時刻を起点にする。
 * 月の初めからすでに条件の順位にいたなら、月初め 0:00 を起点にする。
 * @param leagueId リーグ
 * @param records あなたの記録
 * @param today 今日
 * @param goal キープの条件
 * @returns 起点の瞬間（いま条件の順位にいなければ undefined）
 */
export function heldSinceOf(leagueId: LeagueId, records: LeagueRecords, today: LocalDate, goal: KeepGoal): Instant | undefined {
  const log = logger.fn('heldSinceOf', { leagueId, goal: goal.id, today });
  if (rankWithVisits(leagueId, records, records.visits, today) > goal.maxRank) return log.exit(undefined, '条件の順位の外');
  const monthStart = jstInstantOf(startOfMonth(today), 0, 0);
  const sorted = [...records.visits].sort((a, b) => compareInstant(a.visitedAt, b.visitedAt));
  const beforeMonth = sorted.filter((v) => compareInstant(v.visitedAt, monthStart) < 0).length;
  if (rankWithVisits(leagueId, records, sorted.slice(0, beforeMonth), today) <= goal.maxRank) return log.exit(monthStart, '月初めから');
  for (let i = beforeMonth; i < sorted.length; i++) {
    const visit = sorted[i];
    if (visit !== undefined && rankWithVisits(leagueId, records, sorted.slice(0, i + 1), today) <= goal.maxRank) return log.exit(visit.visitedAt);
  }
  return log.exit(undefined, '起点なし');
}
