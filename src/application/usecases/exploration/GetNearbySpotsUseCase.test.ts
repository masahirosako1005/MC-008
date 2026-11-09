import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { createTestWorld, districtOf, must, offsetPoint, seedTraveler } from '@/application/testing/fakes';
import type { TestWorld, TravelerSeed } from '@/application/testing/fakes';
import { GetNearbySpotsUseCase } from '@/application/usecases/exploration/GetNearbySpotsUseCase';

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/**
 * 城下地区の中心から西へ 100m・北へ 30m に立つ。各スポットまでの距離:
 * s_jo02 30m / l_jo01 70m / s_jo03 104m / l_jo02 122m / s_jo04 202m / s_jo01 212m（ほかの地区は 400m 以上）
 */
function standNearJo02(tw: TestWorld): void {
  tw.geo.setPoint(offsetPoint(districtOf(tw.spots, 'd_joka').center, { eastM: -100, northM: 30 }));
}

/** l_jo01・l_jo02・s_jo01・s_jo02 を発見済み（s_jo03・s_jo04 は未発見）の旅人 */
const SEED: TravelerSeed = { discovered: ['l_jo01', 'l_jo02', 's_jo01', 's_jo02'] };

describe('GetNearbySpotsUseCase', () => {
  it('発見済みのスポットを距離順に返し、120m 以内の未発見スポットは名前なしで混ぜる', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, SEED);
    standNearJo02(tw);
    const list = must(await new GetNearbySpotsUseCase(tw).execute({}));
    expect(list.map((spot) => spot.id)).toEqual(['s_jo02', 'l_jo01', 's_jo03', 'l_jo02', 's_jo01']);
    const meters = list.map((spot) => spot.meters);
    expect([...meters].sort((a, b) => a - b)).toEqual(meters);
    const unknown = list.find((spot) => spot.id === 's_jo03');
    expect(unknown?.status).toBe('unknown');
    expect(unknown !== undefined && 'name' in unknown).toBe(false);
    expect(list[0]).toMatchObject({ name: '丸岡和菓子店', status: 'discovered', districtName: '城下地区', hasActiveShopEvent: true });
  });

  it('limit 件までに絞る（既定は 8 件）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, SEED);
    standNearJo02(tw);
    const list = must(await new GetNearbySpotsUseCase(tw).execute({ limit: 2 }));
    expect(list.map((spot) => spot.id)).toEqual(['s_jo02', 'l_jo01']);
  });

  it('80m（地図の円）以内で今日まだ訪問していなければ canVisit=true、それ以外は false', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, SEED);
    standNearJo02(tw);
    const list = must(await new GetNearbySpotsUseCase(tw).execute({}));
    const expected = list.filter((spot) => spot.meters <= 80).map((spot) => spot.id);
    expect(expected).toContain('s_jo02');
    expect(list.filter((spot) => spot.canVisit).map((spot) => spot.id)).toEqual(expected);
  });

  it('今日訪問済みのスポットは 80m 以内でも canVisit=false', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { ...SEED, visits: [['s_jo02', 0]] });
    standNearJo02(tw);
    const list = must(await new GetNearbySpotsUseCase(tw).execute({}));
    expect(list[0]).toMatchObject({ id: 's_jo02', status: 'visited', visitCount: 1, canVisit: false });
  });

  it('測位精度が粗いと canVisit=false', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, SEED);
    standNearJo02(tw);
    tw.geo.setAccuracy(150);
    const list = must(await new GetNearbySpotsUseCase(tw).execute({}));
    expect(list.some((spot) => spot.canVisit)).toBe(false);
  });

  it('位置が取れなければ GEO_DENIED を返す（SEC-27）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, SEED);
    tw.geo.setError('GEO_DENIED');
    expect(codeOf(await new GetNearbySpotsUseCase(tw).execute({}))).toBe('GEO_DENIED');
  });

  it('limit が 1〜50 の整数でなければ INVALID_INPUT', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, SEED);
    const useCase = new GetNearbySpotsUseCase(tw);
    expect(codeOf(await useCase.execute({ limit: 0 }))).toBe('INVALID_INPUT');
    expect(codeOf(await useCase.execute({ limit: 1.5 }))).toBe('INVALID_INPUT');
    expect(codeOf(await useCase.execute({ limit: 51 }))).toBe('INVALID_INPUT');
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    expect(codeOf(await new GetNearbySpotsUseCase(createTestWorld()).execute({}))).toBe('TRAVELER_NOT_FOUND');
  });
});
