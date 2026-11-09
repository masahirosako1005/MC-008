import { describe, expect, it } from 'vitest';
import { parseTravelerId } from '@/Common/types/Id';
import {
  createTestWorld, must, seedLordship, seedTraveler, TEST_TODAY, TEST_TRAVELER_ID, testDistrictId, testOperationId, testRivalId,
} from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { recordVisit, saveVisit, wireVisitHandlers } from '@/application/testing/scenarioCatalog';
import { UpdateDistrictLordUseCase } from '@/application/usecases/competition/UpdateDistrictLordUseCase';
import { holderKey } from '@/domain/competition/LordHolder';
import { RivalActionVisit } from '@/domain/competition/Rival';

/** 盤の主を「地区ID → holderKey」で返す */
async function lordsOf(tw: TestWorld): Promise<Record<string, string>> {
  const board = must(await tw.lordships.find(TEST_TRAVELER_ID));
  return Object.fromEntries(board.entries.flatMap((e) => (e.holder === undefined ? [] : [[e.districtId, holderKey(e.holder)]])));
}

/** 今日付で本町にタロウの行動を count 回足す */
async function addTaroInHonmachi(tw: TestWorld, count: number): Promise<void> {
  const action = must(RivalActionVisit.of({ rivalId: testRivalId('r_taro'), districtId: testDistrictId('d_honmachi'), localDate: TEST_TODAY, count }));
  must(await tw.rivalActions.append(TEST_TRAVELER_ID, action));
}

describe('UpdateDistrictLordUseCase.execute', () => {
  it('現職なしの全地区を再判定し、背景活動のあるライバルが主になる（D7）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const output = must(await new UpdateDistrictLordUseCase(tw).execute());
    expect(output.changed.map((e) => [e.districtId, e.toName, e.fromName, e.travelerCount])).toEqual([
      ['d_joka', '旅人タロウ', undefined, 0],
      ['d_minato', '旅人ハナ', undefined, 0],
    ]);
    expect(output.changed[0]?.from).toBeUndefined();
    expect(await lordsOf(tw)).toEqual({ d_joka: 'rival:r_taro', d_minato: 'rival:r_hana' });
    expect(tw.lordships.saveCount).toBe(1);
    expect(tw.events.types()).toEqual(['DistrictLordChanged', 'DistrictLordChanged']);
  });

  it('交代が無ければ保存もイベントもしない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const useCase = new UpdateDistrictLordUseCase(tw);
    must(await useCase.execute());
    tw.events.clearPublished();
    expect(must(await useCase.execute()).changed).toEqual([]);
    expect(tw.lordships.saveCount).toBe(1);
    expect(tw.events.published).toEqual([]);
  });

  it('指定した地区だけ再判定する', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -1]] });
    const output = must(await new UpdateDistrictLordUseCase(tw).execute({ districtIds: ['d_honmachi'] }));
    expect(output.changed.map((e) => [e.districtId, e.toName, e.travelerCount, e.lordCount])).toEqual([['d_honmachi', 'あなた', 1, 1]]);
    expect(await lordsOf(tw)).toEqual({ d_honmachi: 'traveler' });
  });

  it('ライバル行動で旅人が抜かれると主がライバルに移り、取り返し中になる（D8）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -2], ['l_hm02', -1]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'traveler' }]);
    await addTaroInHonmachi(tw, 3);
    const output = must(await new UpdateDistrictLordUseCase(tw).execute({ districtIds: ['d_honmachi'] }));
    expect(output.changed[0]).toMatchObject({ from: { type: 'traveler' }, to: { type: 'rival', rivalId: 'r_taro' }, fromName: 'あなた', toName: '旅人タロウ', travelerCount: 2, lordCount: 3 });
    const board = must(await tw.lordships.find(TEST_TRAVELER_ID));
    expect(board.isLostByTraveler(testDistrictId('d_honmachi'))).toBe(true);
  });

  it('地区ID の形式が不正なら INVALID_INPUT、マスタに無ければ DISTRICT_NOT_FOUND（SEC-16）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const useCase = new UpdateDistrictLordUseCase(tw);
    const invalid = await useCase.execute({ districtIds: ['honmachi'] });
    const unknown = await useCase.execute({ districtIds: ['d_unknown'] });
    expect(invalid.ok ? undefined : invalid.error.code).toBe('INVALID_INPUT');
    expect(unknown.ok ? undefined : unknown.error.code).toBe('DISTRICT_NOT_FOUND');
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const result = await new UpdateDistrictLordUseCase(createTestWorld()).execute();
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });

  it('盤の保存に失敗したら STORAGE_FAILED でイベントを出さない（DI-12）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    tw.lordships.failures.failNext('save');
    const result = await new UpdateDistrictLordUseCase(tw).execute();
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(tw.events.published).toEqual([]);
  });
});

describe('UpdateDistrictLordUseCase.handle', () => {
  it('同数では現職のまま、1回上回ると取り返して DistrictLordChanged（to 旅人）を出す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_hm01', -3]] });
    await seedLordship(tw, [{ districtId: 'd_honmachi', holder: 'r_taro', lost: true }]);
    await addTaroInHonmachi(tw, 2);
    wireVisitHandlers(tw);
    await recordVisit(tw, 'l_hm02', testOperationId(1));
    expect(tw.events.ofType('DistrictLordChanged')).toEqual([]);
    await recordVisit(tw, 's_hm01', testOperationId(2));
    const changed = tw.events.ofType('DistrictLordChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      districtId: 'd_honmachi', from: { type: 'rival', rivalId: 'r_taro' }, to: { type: 'traveler' },
      fromName: '旅人タロウ', toName: 'あなた', travelerCount: 3, lordCount: 3,
    });
    const board = must(await tw.lordships.find(TEST_TRAVELER_ID));
    expect(board.isLostByTraveler(testDistrictId('d_honmachi'))).toBe(false);
  });

  it('訪問した地区だけを再判定する（他の地区の主は決めない）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 'l_hm01', testOperationId(1));
    must(await new UpdateDistrictLordUseCase(tw).handle(event));
    expect(await lordsOf(tw)).toEqual({ d_honmachi: 'traveler' });
  });

  it('イベントの旅人がセッションの旅人と違えば INVALID_INPUT（SEC-01）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 'l_hm01', testOperationId(1));
    const result = await new UpdateDistrictLordUseCase(tw).handle({ ...event, travelerId: must(parseTravelerId('t_other01')) });
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(tw.lordships.saveCount).toBe(0);
  });
});
