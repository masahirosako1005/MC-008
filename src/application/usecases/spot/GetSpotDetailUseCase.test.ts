import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { createTestWorld, must, offsetPoint, seedTraveler, spotOf } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { GetSpotDetailUseCase } from '@/application/usecases/spot/GetSpotDetailUseCase';

/** 失敗を取り出す（成功なら undefined） */
function errorOf(result: Result<unknown>): { code: string; message: string } | undefined {
  return result.ok ? undefined : { code: result.error.code, message: result.error.message };
}

/** スポットから東へ eastM の位置に立つ */
function standNear(tw: TestWorld, spotId: string, eastM: number): void {
  tw.geo.setPoint(offsetPoint(spotOf(tw.spots, spotId).point, { eastM }));
}

describe('GetSpotDetailUseCase', () => {
  it('未発見のスポットは NOT_DISCOVERED（まだ見つけていないスポットです）で、名前を返さない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const result = await new GetSpotDetailUseCase(tw).execute({ spotId: 's_jo02' });
    expect(errorOf(result)).toEqual({ code: 'NOT_DISCOVERED', message: 'まだ見つけていないスポットです' });
    expect(JSON.stringify(result)).not.toContain('丸岡和菓子店');
  });

  it('80m 以内で今日まだ訪問していなければ canVisit=true で理由なし', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 20);
    const detail = must(await new GetSpotDetailUseCase(tw).execute({ spotId: 'l_jo01' }));
    expect(detail).toMatchObject({ id: 'l_jo01', name: 'N西城跡', kind: 'landmark', districtName: '城下地区', status: 'discovered', meters: 20, canVisit: true, visitedToday: false });
    expect(detail.visitBlockedReason).toBeUndefined();
    expect(detail.metersToVisit).toBeUndefined();
  });

  it('80m より遠いと canVisit=false で、あと何 m 近づけばよいかを返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 110);
    const detail = must(await new GetSpotDetailUseCase(tw).execute({ spotId: 'l_jo01' }));
    expect(detail).toMatchObject({ meters: 110, canVisit: false, metersToVisit: 30, visitBlockedReason: 'あと30m近づくと達成できます' });
  });

  it('位置が取れないと meters なし・canVisit=false・「現在地を取得できません」で詳細は返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    tw.geo.setError('GEO_UNAVAILABLE');
    const detail = must(await new GetSpotDetailUseCase(tw).execute({ spotId: 'l_jo01' }));
    expect(detail.meters).toBeUndefined();
    expect(detail.canVisit).toBe(false);
    expect(detail.visitBlockedReason).toBe('現在地を取得できません');
    expect(tw.demo.positions).toHaveLength(0);
  });

  it('今日訪問済みなら「今日はもう訪問しました（1日1回）」（位置が取れなくても同じ）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', 0]] });
    standNear(tw, 'l_jo01', 0);
    const useCase = new GetSpotDetailUseCase(tw);
    const detail = must(await useCase.execute({ spotId: 'l_jo01' }));
    expect(detail).toMatchObject({ status: 'visited', canVisit: false, visitedToday: true, visitBlockedReason: '今日はもう訪問しました（1日1回）' });
    tw.geo.setError('GEO_DENIED');
    expect(must(await useCase.execute({ spotId: 'l_jo01' })).visitBlockedReason).toBe('今日はもう訪問しました（1日1回）');
  });

  it('測位精度が粗いと「現在地の精度が低いため訪問できません」', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 0);
    tw.geo.setAccuracy(150);
    const detail = must(await new GetSpotDetailUseCase(tw).execute({ spotId: 'l_jo01' }));
    expect(detail).toMatchObject({ canVisit: false, visitBlockedReason: '現在地の精度が低いため訪問できません' });
  });

  it('終了日が今日以降のクーポン・イベントだけを返し、daysLeft は期間内のときだけ', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['s_jo02', 'l_mi02'] });
    const useCase = new GetSpotDetailUseCase(tw);
    const shop = must(await useCase.execute({ spotId: 's_jo02' }));
    expect(shop.shopEvents).toEqual([
      { id: 'c_jo01', kind: 'coupon', title: 'どら焼き1個サービス', description: 'どら焼き1個サービスの説明（テスト用）', daysLeft: 3, active: true, start: '2026-11-01', end: '2026-11-12' },
    ]);
    const upcoming = must(await useCase.execute({ spotId: 'l_mi02' })).shopEvents;
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ id: 'c_mi02', active: false });
    expect(upcoming[0]?.daysLeft).toBeUndefined();
    tw.clock.setToday('2026-11-13');
    expect(must(await useCase.execute({ spotId: 's_jo02' })).shopEvents).toEqual([]);
  });

  it('訪問履歴は新しい順に最大10件。通った回数・地区の回数を返し、金カードまで取れば nextCard は無し', async () => {
    const tw = createTestWorld();
    const visits = Array.from({ length: 12 }, (_, i) => ['l_jo01', -(i + 1)] as const);
    await seedTraveler(tw, { visits: [...visits, ['s_jo01', -2]] });
    const detail = must(await new GetSpotDetailUseCase(tw).execute({ spotId: 'l_jo01' }));
    expect(detail.visitCount).toBe(12);
    expect(detail.districtVisitCount).toBe(13);
    expect(detail.history).toHaveLength(10);
    expect(detail.history[0]).toBe('2026/11/08（日）');
    expect(detail.history[9]).toBe('2026/10/30（金）');
    expect(detail.nextCard).toBeUndefined();
  });

  it('次に狙えるカードと残り回数を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -3], ['s_jo01', -1]] });
    const detail = must(await new GetSpotDetailUseCase(tw).execute({ spotId: 'l_jo01' }));
    expect(detail.nextCard).toEqual({ rank: 'silver', remainingVisits: 1 });
  });

  it('spotId が不正なら INVALID_INPUT、マスタに無ければ SPOT_NOT_FOUND', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const useCase = new GetSpotDetailUseCase(tw);
    expect(errorOf(await useCase.execute({ spotId: '../etc' }))?.code).toBe('INVALID_INPUT');
    expect(errorOf(await useCase.execute({ spotId: 'l_zz99' }))?.code).toBe('SPOT_NOT_FOUND');
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await new GetSpotDetailUseCase(createTestWorld()).execute({ spotId: 'l_jo01' });
    expect(errorOf(result)?.code).toBe('TRAVELER_NOT_FOUND');
  });
});
