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
    expect(hajimete?.metric).toContain('新しい場所の数');
    expect(rookie?.eligibility).toBe('はじめて30日以内');
    expect(new Set(dto.leagues.map((l) => l.tabHint)).size).toBe(3);
  });

  it('順位報酬は 1位・2位・3位・4〜5位・6位〜 の5段。景品はアバターの部品で、ご当地の景品が先・記念品が後。1位の称号はリーグごとに違う', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const dto = must(await new GetRankingUseCase(tw).execute());
    const kayoi = dto.leagues.find((l) => l.id === 'kayoi');
    expect(kayoi?.rewards?.tiers.map((t) => t.label)).toEqual(['1位', '2位', '3位', '4〜5位', '6位〜']);
    expect(kayoi?.rewards?.tiers[0]?.prizes).toEqual([
      { kind: 'gold', name: '催太鼓の投げ頭巾', partId: 'hat.nagezukin', rarity: 'SSR', owned: false },
      { kind: 'title', name: '天神さんの常連王', partId: 'title.kayoiKing', rarity: 'SSR', owned: false },
      { kind: 'gold', name: '金メダル', partId: 'accessory.medal', rarity: 'SSR', owned: false },
    ]);
    expect(dto.leagues.find((l) => l.id === 'hajimete')?.rewards?.tiers[0]?.prizes.map((p) => p.name)).toEqual(['催太鼓の投げ頭巾', '天満の開拓王', '金メダル']);
    expect(kayoi?.rewards?.tiers.slice(1).map((t) => t.prizes.map((p) => p.name))).toEqual([
      ['天神さんの神牛', '銀メダル'], ['天満切子のグラス', '銅メダル'], ['天満の寄席の扇子', '月桂冠'], ['梅鉢もんの手ぬぐい', '応援フラッグ'],
    ]);
    expect(kayoi?.rewards?.tiers[3]).toMatchObject({ fromRank: 4, toRank: 5, prizes: [{ kind: 'item', partId: 'held.sensu' }, { partId: 'hat.laurel' }] });
    expect(kayoi?.rewards?.tiers[4]).toMatchObject({ fromRank: 6, condition: '今月1回以上', prizes: [{ kind: 'stamp', partId: 'accessory.umeTenugui' }, { partId: 'held.cheerFlag' }] });
    expect(kayoi?.rewards?.tiers[4]?.toRank).toBeUndefined();
    expect(kayoi?.rewards?.keeps.map((k) => k.prizes?.map((p) => p.name))).toEqual([['梅鉢もんの大ちょうちん', '表彰台の旗'], ['天神祭の催太鼓', '金のトロフィー']]);
  });

  it('次にねらえる報酬: 記録なしは参加賞まであと1。3位ならひとつ上（2位）の人に並ぶまでの数', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const fresh = must(await new GetRankingUseCase(tw).execute()).leagues.find((l) => l.id === 'rookie');
    expect(fresh?.nextPrize).toMatchObject({ gap: 1, label: '6位〜', prizes: [{ name: '梅鉢もんの手ぬぐい' }, { name: '応援フラッグ' }] });

    const tw2 = createTestWorld();
    await seedTraveler(tw2, { visits: [['l_jo01', -1], ['s_jo01', -1], ['s_jo03', 0]] });
    const third = must(await new GetRankingUseCase(tw2).execute()).leagues.find((l) => l.id === 'rookie');
    expect(third?.myRank).toBe(3);
    expect(third?.nextPrize).toMatchObject({ gap: 1, label: '2位', prizes: [{ name: '天神さんの神牛' }, { name: '銀メダル' }] });
  });

  it('1位なら次の報酬は無い。卒業したルーキーリーグ（不参加）にも無い', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -40], ...[0, -1, -2, -3, -4, -5].flatMap((day) => ['l_jo01', 's_jo01', 's_jo03'].map((spot): [string, number] => [spot, day]))] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    expect(dto.leagues.find((l) => l.id === 'kayoi')).toMatchObject({ myRank: 1 });
    expect(dto.leagues.find((l) => l.id === 'kayoi')?.nextPrize).toBeUndefined();
    expect(dto.leagues.find((l) => l.id === 'rookie')?.nextPrize).toBeUndefined();
  });

  it('先月に参加していれば、締めた順位の段の報酬は手に入れている（今月の順位報酬は締めるまで手に入らない）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -20], ['l_jo01', -1], ['s_jo01', -1], ['s_jo03', 0]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    const kayoi = dto.leagues.find((l) => l.id === 'kayoi');
    expect(kayoi?.rewards?.tiers[4]?.prizes).toMatchObject([{ name: '梅鉢もんの手ぬぐい', owned: true }, { name: '応援フラッグ', owned: true }]);
    expect(kayoi?.rewards?.tiers.slice(0, 4).flatMap((t) => t.prizes).some((p) => p.owned)).toBe(false);
  });

  it('キープ報酬を達成していれば、その景品は手に入れている', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -2], ['s_jo01', -2], ['s_jo03', -2]] });
    const dto = must(await new GetRankingUseCase(tw).execute());
    expect(dto.leagues.find((l) => l.id === 'rookie')?.rewards?.keeps[0]).toMatchObject({ state: 'achieved', prize: { name: '梅鉢もんの大ちょうちん', owned: true } });
    expect(dto.leagues.find((l) => l.id === 'rookie')?.rewards?.keeps[1]?.prize.owned).toBe(false);
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
    expect(rookie?.rewards?.keeps[0]).toMatchObject({ id: 'podium', state: 'keeping', heldHours: 0, remainingHours: 24, prize: { name: '梅鉢もんの大ちょうちん' } });
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
