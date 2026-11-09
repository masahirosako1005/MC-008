import { describe, expect, it } from 'vitest';
import { createTestWorld, must, seedLordship, seedTraveler } from '@/application/testing/fakes';
import { GetTownStateUseCase } from '@/application/usecases/town/GetTownStateUseCase';

describe('GetTownStateUseCase', () => {
  it('5地区の地区カードを order 順に返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -5], ['s_jo01', -5], ['l_jo01', -1], ['l_mi01', -25], ['l_yu01', -45]] });
    const town = must(await new GetTownStateUseCase(tw).execute());
    expect(town.districts.map((card) => card.id)).toEqual(['d_joka', 'd_minato', 'd_honmachi', 'd_satoyama', 'd_yunosato']);
    expect(town.districts[0]).toMatchObject({ name: '城下地区', shortName: '城下', level: 2, score: 5, visitCount: 3, nextGoalText: 'あと7回で金カード' });
    expect(town.districts[1]).toMatchObject({ fade: { kind: 'soon', daysUntilFade: 5 }, nextGoalText: 'あと5日で色あせ', calendar: { districtName: 'みなと地区', fadeStartDate: '2026-11-14' } });
    expect(town.districts[3]).toMatchObject({ level: 0, visitCount: 0, fade: { kind: 'never' }, nextGoalText: 'まず1か所を訪問しよう' });
    expect(town.districts[4]).toMatchObject({ fade: { kind: 'fading' }, nextGoalText: '再訪で復活＋おかえりボーナス' });
  });

  it('主を奪われた地区は lordLost=true で「取り返しまで」の目標を出す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -3]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'r_taro', lost: true }]);
    const town = must(await new GetTownStateUseCase(tw).execute());
    const honmachi = town.districts.find((card) => card.id === 'd_honmachi');
    expect(honmachi).toMatchObject({ lordName: 'おまいり番長', isLordMe: false, lordLost: true, nextGoalText: '取り返しまで：あと1回（直近30日）' });
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await new GetTownStateUseCase(createTestWorld()).execute();
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });
});
