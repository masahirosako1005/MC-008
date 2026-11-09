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
    expect(rookie?.rivalAbove).toEqual({ name: '週末デビュー', rank: 3, count: 3, gap: 1 });
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

describe('GetRankingUseCase リーグの違いと報酬', () => {
  it('期間（月初め〜月末）・締め・届く日を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const dto = must(await new GetRankingUseCase(tw).execute());
    expect(dto.periodLabel).toBe('11/1（日）〜11/30（月）');
    expect(dto.closeLabel).toBe('11/30（月）23:59');
    expect(dto.deliveryLabel).toBe('12/1（火）');
  });

  it('リーグごとに競うもの・参加できる人・タブの一言が違う', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const dto = must(await new GetRankingUseCase(tw).execute());
    const [kayoi, hajimete, rookie] = dto.leagues;
    expect(kayoi?.tabHint).toBe('通った回数');
    expect(hajimete?.metric).toContain('はじめて訪れたスポットの数');
    expect(rookie?.eligibility).toBe('使いはじめて30日以内の人だけ');
    expect(new Set(dto.leagues.map((l) => l.tabHint)).size).toBe(3);
  });

  it('順位報酬は 1位・2位・3位・4位〜 の4段。1位は称号つきで、飾りはリーグごとに違う', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const dto = must(await new GetRankingUseCase(tw).execute());
    const kayoi = dto.leagues.find((l) => l.id === 'kayoi');
    expect(kayoi?.rewards?.tiers.map((t) => t.label)).toEqual(['1位', '2位', '3位', '4位〜']);
    expect(kayoi?.rewards?.tiers[0]?.prizes.map((p) => p.name)).toEqual(['金メダル', '称号「11月の常連王」', '金の提灯']);
    expect(dto.leagues.find((l) => l.id === 'hajimete')?.rewards?.tiers[0]?.prizes.map((p) => p.name)).toContain('金ののぼり');
    expect(kayoi?.rewards?.tiers[3]).toMatchObject({ condition: '今月1回以上', prizes: [{ kind: 'stamp', name: '参加スタンプ' }] });
  });

  it('記録なし（今月0回）はどの段にも当たらず、キープ報酬はまだ', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const dto = must(await new GetRankingUseCase(tw).execute());
    const kayoi = dto.leagues.find((l) => l.id === 'kayoi');
    expect(kayoi?.rewards?.tiers.some((t) => t.isMine)).toBe(false);
    expect(kayoi?.rewards?.keeps.map((k) => k.state)).toEqual(['not-yet', 'not-yet']);
  });

  it('今日表彰台に入ったばかりならキープ中・あと24時間、いまの順位の段に印がつく', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -1], ['s_jo01', -1], ['s_jo03', 0]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    const rookie = dto.leagues.find((l) => l.id === 'rookie');
    expect(rookie?.myRank).toBe(3);
    expect(rookie?.rewards?.tiers.find((t) => t.isMine)?.label).toBe('3位');
    expect(rookie?.rewards?.keeps[0]).toMatchObject({ id: 'podium', state: 'keeping', heldHours: 0, remainingHours: 24, prize: { name: '表彰台の旗' } });
    expect(rookie?.rewards?.keeps[1]).toMatchObject({ id: 'top', state: 'not-yet' });
  });

  it('2日前から表彰台にいれば、表彰台を24時間キープの報酬は獲得済み', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -2], ['s_jo01', -2], ['s_jo03', -2]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    expect(dto.leagues.find((l) => l.id === 'rookie')?.rewards?.keeps[0]?.state).toBe('achieved');
  });

  it('模擬ライバルのアバターのキーはライバルID（地図のほかの旅人と同じ見た目）、それ以外は名前', async () => {
    const tw = createTestWorld({ allRivals: true });
    await seedTraveler(tw, { visits: [['l_jo01', -1]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    const kayoi = dto.leagues.find((l) => l.id === 'kayoi');
    expect(kayoi?.entries.find((e) => e.name === 'おまいり番長')?.avatarKey).toBe('r_taro');
    expect(dto.leagues.find((l) => l.id === 'hajimete')?.entries.find((e) => e.name === '路地裏コンパス')?.avatarKey).toBe('路地裏コンパス');
  });
});
