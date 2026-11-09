import { describe, expect, it } from 'vitest';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { addDays } from '@/Common/utils/date';
import { daysLeftInMonth, isRookie, leagueScoreOf, monthlyNewSpotCount, monthlyVisitCount, rookieGraduationDateOf, startDateOf } from '@/domain/competition/League';
import type { LeagueRecords } from '@/domain/competition/League';
import type { DiscoveryRecord, VisitRecord } from '@/domain/exploration/VisitRecord';

const TODAY = '2026-11-09' as LocalDate;

/** 今日からのずれで訪問記録を作る（集計に使う項目だけ意味を持つ） */
function visit(spotId: string, offset: number): VisitRecord {
  const localDate = addDays(TODAY, offset);
  return { spotId, districtId: 'd_joka', visitedAt: `${localDate}T03:00:00.000Z` as Instant, localDate, operationId: `op_${spotId}_${offset}` } as unknown as VisitRecord;
}

/** 今日からのずれで発見記録を作る */
function discovery(spotId: string, offset: number): DiscoveryRecord {
  return { spotId, districtId: 'd_joka', discoveredAt: `${addDays(TODAY, offset)}T03:00:00.000Z` as Instant } as unknown as DiscoveryRecord;
}

/** 記録の組を作る */
function records(visits: VisitRecord[], discoveries: DiscoveryRecord[] = []): LeagueRecords {
  return { visits, discoveries };
}

describe('League', () => {
  it('今月の訪問回数は今月1日〜今日の訪問だけを数える', () => {
    expect(monthlyVisitCount([visit('l_jo01', -20), visit('l_jo01', -8), visit('s_jo01', -3), visit('l_jo01', 0)], TODAY)).toBe(3);
  });

  it('はじめましての数は、最初の訪問が今月のスポットだけを数える（2回目以降は数えない）', () => {
    const r = records([visit('l_jo01', -20), visit('l_jo01', -3), visit('s_jo01', -5), visit('s_jo01', -1), visit('s_jo03', 0)]);
    expect(monthlyNewSpotCount(r.visits, TODAY)).toBe(2);
    expect(leagueScoreOf('hajimete', r, TODAY)).toBe(2);
    expect(leagueScoreOf('kayoi', r, TODAY)).toBe(4);
  });

  it('記録が無い人はルーキー。最初の記録から30日目まで参加でき、30日たつと卒業する', () => {
    expect(isRookie(records([]), TODAY)).toBe(true);
    expect(isRookie(records([visit('l_jo01', -29)]), TODAY)).toBe(true);
    const day30 = records([visit('l_jo01', -30)]);
    expect(isRookie(day30, TODAY)).toBe(false);
    expect(startDateOf(day30)).toBe('2026-10-10');
    expect(rookieGraduationDateOf(day30)).toBe('2026-11-09');
  });

  it('発見だけの記録も使いはじめた日に含める', () => {
    expect(startDateOf(records([visit('l_jo01', -2)], [discovery('s_jo02', -40)]))).toBe('2026-09-30');
  });

  it('月末までの残り日数', () => {
    expect(daysLeftInMonth(TODAY)).toBe(21);
  });
});
