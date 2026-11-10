import { describe, expect, it } from 'vitest';
import type { RankStatusDto } from '@/application/dto/Dto';
import { createTestWorld, must, offsetPoint, seedTraveler, spotOf, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { GetRankStatusUseCase } from '@/application/usecases/reward/GetRankStatusUseCase';
import { COUPON_SOON_DAYS } from '@/application/usecases/reward/rankCoupons';
import { UseTicketUseCase } from '@/application/usecases/reward/UseTicketUseCase';

/**
 * ランク画面のクーポンを読む。
 * @param tw テスト用の世界
 * @returns クーポン
 */
async function couponsOf(tw: TestWorld): Promise<RankStatusDto['coupons']> {
  return must(await new GetRankStatusUseCase(tw).execute()).coupons;
}

describe('ランク画面のクーポン（持っている・もうすぐ）', () => {
  it('期間中に通ったお店のクーポンは「持っている」、まだのクーポンは期間中なら「もうすぐ」（終わりの近い順）。イベントは入らない', async () => {
    const tw = createTestWorld();
    // 今日 11/09。s_jo01（c_jo02 11/01〜11/15）に 11/05 に通った
    await seedTraveler(tw, { visits: [['s_jo01', -4]] });
    const coupons = await couponsOf(tw);
    expect(coupons?.held.map((t) => t.id)).toEqual(['c_jo02']);
    expect(coupons?.usedCount).toBe(0);
    expect(coupons?.upcoming.map((c) => [c.id, c.state, c.days])).toEqual([['c_jo01', 'open', 3], ['c_mi01', 'open', 11], ['c_hm01', 'open', 21]]);
    expect(coupons?.upcoming[0]).toMatchObject({ spotId: 's_jo02', title: 'どら焼き1個サービス', start: '2026-11-01', end: '2026-11-12' });
    expect(coupons?.upcoming.some((c) => c.id === 'c_jo03')).toBe(false);
  });

  it(`始まる前のクーポンは ${COUPON_SOON_DAYS} 日以内なら「もうすぐ」（始まるまでの日数の少ない順、同じならID順）`, async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    tw.clock.setToday('2026-10-20');
    const coupons = await couponsOf(tw);
    expect(coupons?.held).toEqual([]);
    expect(coupons?.upcoming.map((c) => [c.id, c.state, c.days])).toEqual([['c_hm01', 'soon', 12], ['c_jo01', 'soon', 12], ['c_jo02', 'soon', 12], ['c_mi01', 'soon', 16]]);
    tw.clock.setToday('2026-09-01');
    expect((await couponsOf(tw))?.upcoming).toEqual([]);
  });

  it('期間中のクーポンが先、始まる前のクーポンが後', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    tw.clock.setToday('2026-11-03');
    const coupons = await couponsOf(tw);
    expect(coupons?.upcoming.map((c) => c.state)).toEqual(['open', 'open', 'open', 'soon']);
    expect(coupons?.upcoming.at(-1)).toMatchObject({ id: 'c_mi01', days: 2 });
  });

  it('使ったチケットは「持っている」から外れて使用済みの枚数になり、「もうすぐ」にも戻らない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['s_jo01', -4]] });
    tw.geo.setPoint(offsetPoint(spotOf(tw.spots, 's_jo01').point, { eastM: 10 }));
    must(await new UseTicketUseCase(tw).execute({ operationId: testOperationId(1), ticketId: 'c_jo02' }));
    const coupons = await couponsOf(tw);
    expect(coupons?.held).toEqual([]);
    expect(coupons?.usedCount).toBe(1);
    expect(coupons?.upcoming.some((c) => c.id === 'c_jo02')).toBe(false);
  });
});
