import { describe, expect, it } from 'vitest';
import { createTestWorld, must, seedLordship, seedTraveler, TEST_TRAVELER_ID, testDistrictId } from '@/application/testing/fakes';
import { createDemoUseCases } from '@/application/testing/scenarioCatalog';
import type { AdvanceDateInput } from '@/application/dto/Dto';

describe('AdvanceDateUseCase', () => {
  it('日付を進め、今日とずらし日数を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const { advanceDate } = createDemoUseCases(tw, { enabled: true });
    expect(must(await advanceDate.execute({ days: 30 }))).toEqual({ today: '2026-12-09', dayOffset: 30 });
    expect(must(await advanceDate.execute({ days: 1 }))).toEqual({ today: '2026-12-10', dayOffset: 31 });
    expect(tw.clock.today()).toBe('2026-12-10');
  });

  it('進めた後に全地区の主を再判定する（来なくなった旅人は回数で抜かれ、取り返し中になる）', async () => {
    const tw = createTestWorld();
    const days = [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0];
    await seedTraveler(tw, { visits: days.map((day): readonly [string, number] => ['l_jo01', day]) });
    await seedLordship(tw, [{ districtId: 'd_joka', holder: 'traveler' }]);
    must(await createDemoUseCases(tw, { enabled: true }).advanceDate.execute({ days: 30 }));
    const changed = tw.events.ofType('DistrictLordChanged');
    expect(changed.map((e) => [e.districtId, e.fromName, e.toName])).toEqual([['d_joka', 'あなた', '旅人タロウ'], ['d_minato', undefined, '旅人ハナ']]);
    const board = must(await tw.lordships.find(TEST_TRAVELER_ID));
    expect(board.isLostByTraveler(testDistrictId('d_joka'))).toBe(true);
  });

  it('選択肢に無い日数は INVALID_INPUT で日付を動かさない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const invalid = { days: 7 } as unknown as AdvanceDateInput; // 実行時に画面から不正値が来た場合を再現する
    const result = await createDemoUseCases(tw, { enabled: true }).advanceDate.execute(invalid);
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(tw.demo.offsetDays()).toBe(0);
  });

  it('デモが無効なら DEMO_DISABLED で日付を動かさない（SEC-02）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const result = await createDemoUseCases(tw, { enabled: false }).advanceDate.execute({ days: 30 });
    expect(result.ok ? undefined : result.error.code).toBe('DEMO_DISABLED');
    expect(tw.clock.today()).toBe('2026-11-09');
    expect(tw.lordships.saveCount).toBe(0);
  });

  it('日付のずらしの保存に失敗したら STORAGE_FAILED', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    tw.demo.failures.failNext('advanceDays');
    const result = await createDemoUseCases(tw, { enabled: true }).advanceDate.execute({ days: 1 });
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });

  it('旅人がいなければ主の再判定が TRAVELER_NOT_FOUND（日付は進んだまま）', async () => {
    const tw = createTestWorld();
    const result = await createDemoUseCases(tw, { enabled: true }).advanceDate.execute({ days: 1 });
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
    expect(tw.demo.offsetDays()).toBe(1);
  });
});
