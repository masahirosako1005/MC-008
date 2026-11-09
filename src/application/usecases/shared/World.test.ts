import { describe, expect, it } from 'vitest';
import { createTestWorld, must, seedLordship, seedTraveler, TEST_TRAVELER_ID, testDistrictId, testSpotId } from '@/application/testing/fakes';
import { discoveredSpotIdsOf, loadActiveTraveler, loadWorld, resolveActiveTravelerId } from '@/application/usecases/shared/World';

describe('resolveActiveTravelerId', () => {
  it('セッションのアクティブな旅人ID を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    expect(must(await resolveActiveTravelerId(tw.session))).toBe(TEST_TRAVELER_ID);
  });

  it('セッションに旅人が無ければ TRAVELER_NOT_FOUND', async () => {
    const tw = createTestWorld();
    const result = await resolveActiveTravelerId(tw.session);
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });

  it('セッションの読込失敗はそのまま返す', async () => {
    const tw = createTestWorld();
    tw.session.failures.failNext('load');
    const result = await resolveActiveTravelerId(tw.session);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });
});

describe('loadActiveTraveler', () => {
  it('セッションにあるが保存されていない旅人は TRAVELER_NOT_FOUND', async () => {
    const tw = createTestWorld();
    must(await tw.session.save({ activeTravelerId: TEST_TRAVELER_ID }));
    const result = await loadActiveTraveler(tw);
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });
});

describe('loadWorld', () => {
  it('今日・旅人・盤・ライバル行動・ライバル・マスタをまとめて返す（盤が未保存なら空の盤）', async () => {
    const tw = createTestWorld({ today: '2026-12-01' });
    await seedTraveler(tw, { visits: [['l_jo01', -1]] });
    const world = must(await loadWorld(tw));
    expect(world.today).toBe('2026-12-01');
    expect(world.traveler.id).toBe(TEST_TRAVELER_ID);
    expect(world.traveler.visits).toHaveLength(1);
    expect(world.board.entries).toEqual([]);
    expect(world.board.version).toBe(0);
    expect(world.actions).toEqual([]);
    expect(world.rivals.map((r) => r.id)).toEqual(['r_taro', 'r_hana']);
    expect(world.spots).toBe(tw.spots);
  });

  it('保存済みの盤を読む', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'traveler' }]);
    const world = must(await loadWorld(tw));
    expect(world.board.version).toBe(1);
    expect(world.board.holderOf(testDistrictId('d_honmachi'))?.type).toBe('traveler');
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await loadWorld(createTestWorld());
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });

  it('盤・ライバル行動の読込失敗はそのまま返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    tw.lordships.failures.failNext('find');
    const boardFailed = await loadWorld(tw);
    expect(boardFailed.ok ? undefined : boardFailed.error.code).toBe('STORAGE_FAILED');
    tw.rivalActions.failures.failNext('list');
    const actionsFailed = await loadWorld(tw);
    expect(actionsFailed.ok ? undefined : actionsFailed.error.code).toBe('STORAGE_FAILED');
  });

  it('保存データが壊れていれば STORAGE_FAILED（リポジトリの境界で検証）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    tw.travelers.putRaw(TEST_TRAVELER_ID, { id: TEST_TRAVELER_ID, visits: 'broken' });
    const result = await loadWorld(tw);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });
});

describe('discoveredSpotIdsOf', () => {
  it('発見だけのスポットと訪問済みスポットの両方を含む', async () => {
    const tw = createTestWorld();
    const traveler = await seedTraveler(tw, { visits: [['l_jo01', -1]], discovered: ['s_jo02'] });
    const ids = discoveredSpotIdsOf(traveler);
    expect([...ids].sort()).toEqual([testSpotId('l_jo01'), testSpotId('s_jo02')]);
  });
});
