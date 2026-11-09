import { describe, expect, it } from 'vitest';
import { createTestWorld, must, seedTraveler } from '@/application/testing/fakes';
import { GetRankingUseCase, recommendLeague } from '@/application/usecases/competition/GetRankingUseCase';
import { LEAGUE_DUMMIES } from '@/application/usecases/competition/leagueDummies';

describe('GetRankingUseCase', () => {
  it('3リーグを表示順で返し、各リーグはダミー10人＋あなたの11行', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -2]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    expect(dto.leagues.map((l) => l.id)).toEqual(['kayoi', 'hajimete', 'rookie']);
    for (const league of dto.leagues) {
      expect(LEAGUE_DUMMIES[league.id]).toHaveLength(10);
      expect(league.entries).toHaveLength(11);
      expect(league.entries.filter((e) => e.isMe)).toHaveLength(1);
    }
    expect(dto.monthLabel).toBe('11月');
    expect(dto.daysLeft).toBe(21);
  });

  it('初めての人（記録なし）でもルーキー・はじめましてに参加し、1回で順位が上がる案内が出る', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const dto = must(await new GetRankingUseCase(tw).execute());
    const rookie = dto.leagues.find((l) => l.id === 'rookie');
    expect(rookie?.joined).toBe(true);
    expect(rookie?.myCount).toBe(0);
    expect(rookie?.nextStepText).toMatch(/あと1回で\d+位/);
    expect(dto.leagues.find((l) => l.id === 'hajimete')?.nextStepText).toMatch(/あと1か所で\d+位/);
  });

  it('初めての人が新しいスポットを3か所訪れると、はじめまして・ルーキーで表彰台付近に届き、そちらが最初に開く', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -1], ['s_jo01', -1], ['s_jo03', 0]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    const rookie = dto.leagues.find((l) => l.id === 'rookie');
    expect(rookie?.myRank).toBeLessThanOrEqual(3);
    expect(dto.recommendedLeagueId).toBe('rookie');
    expect(dto.leagues.find((l) => l.id === 'kayoi')?.myRank).toBeGreaterThan(3);
  });

  it('使いはじめて30日をこえた人はルーキーを卒業し、あなたの行を含まない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -40], ['l_jo01', -1]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    const rookie = dto.leagues.find((l) => l.id === 'rookie');
    expect(rookie?.joined).toBe(false);
    expect(rookie?.myRank).toBeUndefined();
    expect(rookie?.entries).toHaveLength(10);
    expect(rookie?.membershipNote).toContain('卒業');
    expect(dto.recommendedLeagueId).not.toBe('rookie');
  });

  it('地区の主の状況を全地区ぶん返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const dto = must(await new GetRankingUseCase(tw).execute());
    expect(dto.lords).toHaveLength(tw.spots.allDistricts().length);
  });

  it('recommendLeague は同順位ならルーキー → はじめまして → かよい の順で選ぶ', () => {
    expect(recommendLeague([{ id: 'kayoi', myRank: 2 }, { id: 'hajimete', myRank: 2 }, { id: 'rookie', myRank: 2 }])).toBe('rookie');
    expect(recommendLeague([{ id: 'kayoi', myRank: 1 }, { id: 'hajimete', myRank: 4 }, { id: 'rookie' }])).toBe('kayoi');
  });
});

describe('GetRankingUseCase 競り合い', () => {
  it('今日訪れると昨日より順位が上がり、すぐ上・すぐ下のライバルと表彰台までの数を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -1], ['s_jo01', 0]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    const rookie = dto.leagues.find((l) => l.id === 'rookie');
    expect(rookie?.myCount).toBe(2);
    expect(rookie?.myRank).toBe(5);
    expect(rookie?.myRankYesterday).toBe(7);
    expect(rookie?.rivalAbove).toEqual({ name: '旅人メイ', rank: 3, count: 3, gap: 1 });
    expect(rookie?.rivalBelow).toMatchObject({ gap: 0 });
    expect(rookie?.podiumGap).toBe(1);
  });

  it('不参加のリーグには競り合いの情報を含めない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -40]] });
    const rookie = must(await new GetRankingUseCase(tw).execute()).leagues.find((l) => l.id === 'rookie');
    expect(rookie?.rivalAbove).toBeUndefined();
    expect(rookie?.podiumGap).toBeUndefined();
  });
});
