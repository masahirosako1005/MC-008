import { describe, expect, it } from 'vitest';
import { parseTravelerId } from '@/Common/types/Id';
import { createTestWorld, must, seedTraveler, testOperationId } from '@/application/testing/fakes';
import { saveVisit } from '@/application/testing/scenarioCatalog';
import { EvaluateDistrictChangeUseCase } from '@/application/usecases/town/EvaluateDistrictChangeUseCase';

describe('EvaluateDistrictChangeUseCase.handle', () => {
  it('初めての訪問で地区が Lv0 → Lv1 に育つと DistrictGrown を出す（復活ではない）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    must(await new EvaluateDistrictChangeUseCase(tw).handle(event));
    expect(tw.events.types()).toEqual(['DistrictGrown']);
    expect(tw.events.ofType('DistrictGrown')[0]).toMatchObject({ districtId: 'd_joka', from: 0, to: 1, travelerId: 't_test01' });
  });

  it('Lv2（score 9）の地区で新しいスポットを訪問すると Lv3 に育つ', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -20], ['l_jo01', -12], ['l_jo01', -5], ['s_jo01', -12], ['s_jo01', -5], ['s_jo03', -5]] });
    const event = await saveVisit(tw, 's_jo02', testOperationId(1));
    must(await new EvaluateDistrictChangeUseCase(tw).handle(event));
    expect(tw.events.ofType('DistrictGrown').map((e) => [e.from, e.to])).toEqual([[2, 3]]);
  });

  it('30日空けて再訪すると DistrictRevived（日数と訪問後の Lv）を出す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -30]] });
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    must(await new EvaluateDistrictChangeUseCase(tw).handle(event));
    expect(tw.events.types()).toEqual(['DistrictRevived']);
    expect(tw.events.ofType('DistrictRevived')[0]).toMatchObject({ districtId: 'd_joka', daysSinceLastVisit: 30, level: 1 });
  });

  it('29日ぶりの再訪は色あせ前なので復活しない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -29]] });
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    must(await new EvaluateDistrictChangeUseCase(tw).handle(event));
    expect(tw.events.ofType('DistrictRevived')).toEqual([]);
  });

  it('復活した日の2回目の訪問では DistrictRevived を出さない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -40]] });
    const handler = new EvaluateDistrictChangeUseCase(tw);
    must(await handler.handle(await saveVisit(tw, 'l_jo01', testOperationId(1))));
    must(await handler.handle(await saveVisit(tw, 's_jo01', testOperationId(2))));
    expect(tw.events.ofType('DistrictRevived')).toHaveLength(1);
  });

  it('同じイベントで2回呼んでもイベントは1回しか出さない（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    const handler = new EvaluateDistrictChangeUseCase(tw);
    must(await handler.handle(event));
    must(await handler.handle(event));
    expect(tw.events.types()).toEqual(['DistrictGrown']);
  });

  it('後から別の訪問が増えていても、その訪問の時点の前後で判定する', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const first = await saveVisit(tw, 'l_jo01', testOperationId(1));
    await saveVisit(tw, 's_jo01', testOperationId(2));
    must(await new EvaluateDistrictChangeUseCase(tw).handle(first));
    expect(tw.events.ofType('DistrictGrown').map((e) => [e.from, e.to])).toEqual([[0, 1]]);
  });

  it('セッションに旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    must(await tw.session.save({}));
    const result = await new EvaluateDistrictChangeUseCase(tw).handle(event);
    expect(result.ok ? undefined : result.error.code).toBe('TRAVELER_NOT_FOUND');
  });

  it('イベントの旅人がセッションの旅人と違えば INVALID_INPUT で何も出さない（SEC-01）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    const forged = { ...event, travelerId: must(parseTravelerId('t_other01')) };
    const result = await new EvaluateDistrictChangeUseCase(tw).handle(forged);
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(tw.events.published).toEqual([]);
  });

  it('訪問記録が保存されていないイベントは INVALID_INPUT', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const event = await saveVisit(tw, 'l_jo01', testOperationId(1));
    const unknown = { ...event, operationId: testOperationId(99) };
    const result = await new EvaluateDistrictChangeUseCase(tw).handle(unknown);
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
  });
});
