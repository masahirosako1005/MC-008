import { describe, expect, it } from 'vitest';
import { buildTraveler, createTestWorld, must, seedLordship, seedTraveler, TEST_TODAY, testOperationId, testSpotId } from '@/application/testing/fakes';
import { GetRevisitReasonsUseCase } from '@/application/usecases/exploration/GetRevisitReasonsUseCase';

describe('GetRevisitReasonsUseCase', () => {
  it('期限＞取り返し＞色あせ＞未訪問の順に並べ、日本語の文言を付ける', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['s_jo02', 'l_jo02'], visits: [['l_mi01', -25], ['l_yu01', -45]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'r_taro', lost: true }]);
    const reasons = must(await new GetRevisitReasonsUseCase(tw).execute());
    expect(reasons.map((reason) => `${reason.kind}:${reason.districtId}`)).toEqual([
      'deadline:d_joka',
      'reclaim:d_honmachi',
      'fade:d_yunosato',
      'fade:d_minato',
      'unvisited:d_joka',
    ]);
    expect(reasons[0]).toMatchObject({ title: '丸岡和菓子店のクーポン、あと3日', subtitle: 'どら焼き1個サービス', spotId: 's_jo02', shopEventId: 'c_jo01' });
    expect(reasons[1]?.title).toBe('本町地区の領主をおまいり番長に奪われた');
    expect(reasons[2]?.title).toBe('色あせ中：湯の里地区');
    expect(reasons[2]?.calendar).toBeUndefined();
    expect(reasons[3]).toMatchObject({ title: 'そろそろ色あせ：みなと地区 あと5日', calendar: { districtName: 'みなと地区', fadeStartDate: '2026-11-14' } });
    expect(reasons[4]?.title).toBe('城下地区にまだ行っていないスポットが2件');
  });

  it('未発見スポットのクーポンの期限は出さない（名前を漏らさない＝D12）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const reasons = must(await new GetRevisitReasonsUseCase(tw).execute());
    expect(reasons).toEqual([]);
  });

  it('利用済みのクーポンの期限は出さない', async () => {
    const tw = createTestWorld();
    const base = buildTraveler(tw.spots, TEST_TODAY, { discovered: ['s_jo02'] });
    const coupon = tw.spots.shopEventsForSpot(testSpotId('s_jo02'))[0];
    if (coupon === undefined) throw new Error('テスト用クーポンが無い');
    const redeemed = must(base.redeem({ shopEvent: coupon, meters: 0, at: tw.clock.now(), localDate: TEST_TODAY, operationId: testOperationId(99) })).traveler;
    must(await tw.travelers.save(redeemed, 0));
    must(await tw.session.save({ activeTravelerId: redeemed.id }));
    const reasons = must(await new GetRevisitReasonsUseCase(tw).execute());
    expect(reasons.some((reason) => reason.kind === 'deadline')).toBe(false);
    expect(reasons.map((reason) => reason.kind)).toEqual(['unvisited']);
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await new GetRevisitReasonsUseCase(createTestWorld()).execute();
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });
});
