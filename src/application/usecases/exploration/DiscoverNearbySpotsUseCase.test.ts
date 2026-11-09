import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import { createTestWorld, districtOf, must, offsetPoint, seedTraveler, TEST_TRAVELER_ID, testOperationId, testSpotId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { DiscoverNearbySpotsUseCase } from '@/application/usecases/exploration/DiscoverNearbySpotsUseCase';

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/** 城下地区の中心から北へ 50m に立つ（武家屋敷通り l_jo02 と城下茶寮 s_jo03 がそれぞれ 50m、ほかは 80m より遠い） */
function standBetweenJo02AndJo03(tw: TestWorld): void {
  tw.geo.setPoint(offsetPoint(districtOf(tw.spots, 'd_joka').center, { northM: 50 }));
}

/** 保存済みの旅人を読む */
async function storedTraveler(tw: TestWorld) {
  const found = must(await tw.travelers.findById(TEST_TRAVELER_ID));
  if (found === undefined) throw new Error('旅人が保存されていない');
  return found;
}

describe('DiscoverNearbySpotsUseCase', () => {
  it('80m 以内の未発見スポットを発見済みにして保存し、SpotDiscovered を発行する', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standBetweenJo02AndJo03(tw);
    const output = must(await new DiscoverNearbySpotsUseCase(tw).execute({ operationId: testOperationId(1) }));
    expect(output.newlyDiscovered.map((spot) => spot.id).sort()).toEqual(['l_jo02', 's_jo03']);
    expect(output.newlyDiscovered.find((spot) => spot.id === 'l_jo02')).toEqual({ id: 'l_jo02', name: '武家屋敷通り', kind: 'landmark', districtId: 'd_joka' });
    const traveler = await storedTraveler(tw);
    expect(traveler.hasDiscovered(testSpotId('l_jo02'))).toBe(true);
    expect(traveler.hasDiscovered(testSpotId('l_jo01'))).toBe(false);
    expect(tw.travelers.saveCount).toBe(2);
    const events = tw.events.ofType('SpotDiscovered');
    expect(events.map((event) => event.spotId).sort()).toEqual(['l_jo02', 's_jo03']);
    expect(events.every((event) => event.travelerId === TEST_TRAVELER_ID && event.districtId === 'd_joka')).toBe(true);
  });

  it('新しく発見するスポットが無ければ、保存もイベント発行もしない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const output = must(await new DiscoverNearbySpotsUseCase(tw).execute({ operationId: testOperationId(1) }));
    expect(output.newlyDiscovered).toEqual([]);
    expect(tw.travelers.saveCount).toBe(1);
    expect(tw.events.published).toHaveLength(0);
  });

  it('同じ場所で2回実行しても、2回目は何も発見せず保存もしない（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standBetweenJo02AndJo03(tw);
    const useCase = new DiscoverNearbySpotsUseCase(tw);
    must(await useCase.execute({ operationId: testOperationId(1) }));
    const second = must(await useCase.execute({ operationId: testOperationId(1) }));
    expect(second.newlyDiscovered).toEqual([]);
    expect(tw.travelers.saveCount).toBe(2);
    expect(tw.events.ofType('SpotDiscovered')).toHaveLength(2);
  });

  it('発見済みのスポットは発見し直さない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo02'] });
    standBetweenJo02AndJo03(tw);
    const output = must(await new DiscoverNearbySpotsUseCase(tw).execute({ operationId: testOperationId(1) }));
    expect(output.newlyDiscovered.map((spot) => spot.id)).toEqual(['s_jo03']);
  });

  it('位置が取れなければ GEO_UNAVAILABLE をそのまま返し、何も発見しない（SEC-27）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standBetweenJo02AndJo03(tw);
    tw.geo.setError('GEO_UNAVAILABLE');
    const result = await new DiscoverNearbySpotsUseCase(tw).execute({ operationId: testOperationId(1) });
    expect(codeOf(result)).toBe('GEO_UNAVAILABLE');
    expect(tw.travelers.saveCount).toBe(1);
    expect(tw.events.published).toHaveLength(0);
  });

  it('operationId が不正なら INVALID_INPUT', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const result = await new DiscoverNearbySpotsUseCase(tw).execute({ operationId: 'x' });
    expect(codeOf(result)).toBe('INVALID_INPUT');
    expect(tw.geo.callCount).toBe(0);
  });

  it('保存が1回競合したら読み直してやり直し、発見を記録する（DI-10）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standBetweenJo02AndJo03(tw);
    tw.travelers.failures.failNext('save', 'CONFLICT');
    const output = must(await new DiscoverNearbySpotsUseCase(tw).execute({ operationId: testOperationId(1) }));
    expect(output.newlyDiscovered).toHaveLength(2);
    expect((await storedTraveler(tw)).discoveries).toHaveLength(2);
    expect(tw.events.ofType('SpotDiscovered')).toHaveLength(2);
  });

  it('保存に失敗したら STORAGE_FAILED を返し、イベントを発行しない（DI-12）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standBetweenJo02AndJo03(tw);
    tw.travelers.failures.failNext('save');
    const result = await new DiscoverNearbySpotsUseCase(tw).execute({ operationId: testOperationId(1) });
    expect(codeOf(result)).toBe('STORAGE_FAILED');
    expect(tw.events.published).toHaveLength(0);
  });
});
