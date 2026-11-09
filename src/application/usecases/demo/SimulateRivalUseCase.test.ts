import { describe, expect, it } from 'vitest';
import { must, seedLordship, seedTraveler, TEST_TRAVELER_ID, testDistrictId, testOperationId } from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { createDemoUseCases, createScenarioWorld, reasonsOf } from '@/application/testing/scenarioCatalog';

/**
 * 天満地区（ライバル行動の既定の地区）で旅人が主（直近30日に3回）の世界を作る。
 * @returns テスト用の世界（新 ID のシナリオ用カタログ）
 */
async function tenmaLordWorld(): Promise<TestWorld> {
  const tw = createScenarioWorld();
  await seedTraveler(tw, { visits: [['l_tm01', -3], ['l_tm02', -2], ['s_tm01', -1]] });
  await seedLordship(tw, [{ districtId: 'd_tenma', holder: 'traveler' }]);
  return tw;
}

describe('SimulateRivalUseCase', () => {
  it('既定（おまいり番長・天満）で max(現職, 旅人)+1−ライバルの回数 を今日付で足し、主を奪う', async () => {
    const tw = await tenmaLordWorld();
    const output = must(await createDemoUseCases(tw, { enabled: true }).simulateRival.execute({ operationId: testOperationId(1) }));
    expect(output).toEqual({ districtId: 'd_tenma', districtName: '天満地区', rivalName: 'おまいり番長', changed: true });
    const actions = must(await tw.rivalActions.list(TEST_TRAVELER_ID));
    expect(actions.map((a) => [a.rivalId, a.districtId, a.localDate, a.count])).toEqual([['r_taro', 'd_tenma', '2026-11-09', 4]]);
    expect(tw.events.ofType('DistrictLordChanged')[0]).toMatchObject({ fromName: 'あなた', toName: 'おまいり番長', travelerCount: 3, lordCount: 4 });
    const board = must(await tw.lordships.find(TEST_TRAVELER_ID));
    expect(board.isLostByTraveler(testDistrictId('d_tenma'))).toBe(true);
  });

  it('奪われた後は「取り返し」理由（あと2回）が出る', async () => {
    const tw = await tenmaLordWorld();
    must(await createDemoUseCases(tw, { enabled: true }).simulateRival.execute({ operationId: testOperationId(1) }));
    const reclaim = (await reasonsOf(tw)).find((r) => r.kind === 'reclaim');
    expect(reclaim).toMatchObject({ kind: 'reclaim', districtId: 'd_tenma', lordName: 'おまいり番長', lordCount: 4, myCount: 3, needed: 2 });
  });

  it('同じ operationId は1回だけ記録する（DI-07）', async () => {
    const tw = await tenmaLordWorld();
    const { simulateRival } = createDemoUseCases(tw, { enabled: true });
    must(await simulateRival.execute({ operationId: testOperationId(1) }));
    const again = must(await simulateRival.execute({ operationId: testOperationId(1) }));
    expect(again.changed).toBe(false);
    expect(must(await tw.rivalActions.list(TEST_TRAVELER_ID))).toHaveLength(1);
    expect(tw.events.ofType('DistrictLordChanged')).toHaveLength(1);
  });

  it('主なしの地区でも最低1回足して主にする', async () => {
    const tw = createScenarioWorld();
    await seedTraveler(tw);
    const output = must(await createDemoUseCases(tw, { enabled: true }).simulateRival.execute({ operationId: testOperationId(1), rivalId: 'r_hana', districtId: 'd_tenma' }));
    expect(output).toMatchObject({ rivalName: '花見は毎日派', changed: true });
    expect(must(await tw.rivalActions.list(TEST_TRAVELER_ID)).map((a) => a.count)).toEqual([1]);
  });

  it('不正な操作ID・未知のライバルは INVALID_INPUT、未知の地区は DISTRICT_NOT_FOUND（SEC-16）', async () => {
    const tw = await tenmaLordWorld();
    const { simulateRival } = createDemoUseCases(tw, { enabled: true });
    const codes = [
      await simulateRival.execute({ operationId: 'not-uuid!' }),
      await simulateRival.execute({ operationId: testOperationId(1), rivalId: 'r_nobody' }),
      await simulateRival.execute({ operationId: testOperationId(1), rivalId: 'taro' }),
      await simulateRival.execute({ operationId: testOperationId(1), districtId: 'd_unknown' }),
    ].map((result) => (result.ok ? undefined : result.error.code));
    expect(codes).toEqual(['INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT', 'DISTRICT_NOT_FOUND']);
    expect(must(await tw.rivalActions.list(TEST_TRAVELER_ID))).toEqual([]);
  });

  it('デモが無効なら DEMO_DISABLED で何も記録しない（SEC-02）', async () => {
    const tw = await tenmaLordWorld();
    const result = await createDemoUseCases(tw, { enabled: false }).simulateRival.execute({ operationId: testOperationId(1) });
    expect(result.ok ? undefined : result.error.code).toBe('DEMO_DISABLED');
    expect(must(await tw.rivalActions.list(TEST_TRAVELER_ID))).toEqual([]);
  });

  it('ライバル行動の保存に失敗したら STORAGE_FAILED で主は変わらない', async () => {
    const tw = await tenmaLordWorld();
    tw.rivalActions.failures.failNext('append');
    const result = await createDemoUseCases(tw, { enabled: true }).simulateRival.execute({ operationId: testOperationId(1) });
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(tw.events.ofType('DistrictLordChanged')).toEqual([]);
  });
});
