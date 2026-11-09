import { describe, expect, it } from 'vitest';
import { AppError, fail } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import {
  createTestWorld,
  must,
  offsetPoint,
  seedTraveler,
  spotOf,
  TEST_TRAVELER_ID,
  testOperationId,
  testSpotId,
} from '@/application/testing/fakes';
import type { TestWorld } from '@/application/testing/fakes';
import { VisitSpotUseCase } from '@/application/usecases/exploration/VisitSpotUseCase';

/** 失敗コードを取り出す（成功なら undefined） */
function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/** スポットから東へ eastM の位置に立つ */
function standNear(tw: TestWorld, spotId: string, eastM: number): void {
  tw.geo.setPoint(offsetPoint(spotOf(tw.spots, spotId).point, { eastM }));
}

/** 保存済みの旅人を読む */
async function storedTraveler(tw: TestWorld) {
  const found = must(await tw.travelers.findById(TEST_TRAVELER_ID));
  if (found === undefined) throw new Error('旅人が保存されていない');
  return found;
}

describe('VisitSpotUseCase', () => {
  it('80m 以内なら訪問記録を保存し、SpotVisited を1回発行する', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 30);
    const output = must(await new VisitSpotUseCase(tw).execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    expect(output).toEqual({ spotId: 'l_jo01', districtId: 'd_joka', localDate: '2026-11-09', duplicate: false });
    const traveler = await storedTraveler(tw);
    expect(traveler.visits).toHaveLength(1);
    expect(traveler.visits[0]?.operationId).toBe(testOperationId(1));
    expect(traveler.version).toBe(2);
    const visited = tw.events.ofType('SpotVisited');
    expect(visited).toHaveLength(1);
    expect(visited[0]).toMatchObject({ spotId: 'l_jo01', districtId: 'd_joka', localDate: '2026-11-09', operationId: testOperationId(1), travelerId: TEST_TRAVELER_ID });
  });

  it('同じ operationId を2回送ると2回目は duplicate=true で、保存と SpotVisited は1回だけ（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 10);
    const useCase = new VisitSpotUseCase(tw);
    const first = must(await useCase.execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    const second = must(await useCase.execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ spotId: 'l_jo01', districtId: 'd_joka', localDate: '2026-11-09', duplicate: true });
    expect(tw.travelers.saveCount).toBe(2);
    expect(tw.events.ofType('SpotVisited')).toHaveLength(1);
    expect((await storedTraveler(tw)).visits).toHaveLength(1);
  });

  it('同じ operationId を同時に2回送っても、保存と SpotVisited は1回だけ（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 10);
    const useCase = new VisitSpotUseCase(tw);
    const input = { operationId: testOperationId(7), spotId: 'l_jo01' };
    const results = await Promise.all([useCase.execute(input), useCase.execute(input)]);
    const outputs = results.map((result) => must(result));
    expect(outputs.map((output) => output.duplicate).sort()).toEqual([false, true]);
    expect(tw.events.ofType('SpotVisited')).toHaveLength(1);
    expect((await storedTraveler(tw)).visits).toHaveLength(1);
  });

  it('処理済みの operationId なら、位置が取れなくても duplicate=true を返す', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 10);
    const useCase = new VisitSpotUseCase(tw);
    must(await useCase.execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    tw.geo.setError('GEO_UNAVAILABLE');
    const again = must(await useCase.execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    expect(again.duplicate).toBe(true);
    expect(tw.events.ofType('SpotVisited')).toHaveLength(1);
  });

  it('80m を超えると OUT_OF_RANGE で、保存も発行もしない', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 90);
    const result = await new VisitSpotUseCase(tw).execute({ operationId: testOperationId(1), spotId: 'l_jo01' });
    expect(codeOf(result)).toBe('OUT_OF_RANGE');
    expect(tw.travelers.saveCount).toBe(1);
    expect(tw.events.published).toHaveLength(0);
  });

  it('位置が取れないと GEO_DENIED をそのまま返し、訪問しない（デモ位置に切り替えない＝SEC-27）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 0);
    tw.geo.setError('GEO_DENIED');
    const result = await new VisitSpotUseCase(tw).execute({ operationId: testOperationId(1), spotId: 'l_jo01' });
    expect(codeOf(result)).toBe('GEO_DENIED');
    expect(tw.demo.positions).toHaveLength(0);
    expect(tw.travelers.saveCount).toBe(1);
    expect(tw.events.published).toHaveLength(0);
  });

  it('測位精度が粗いと LOW_ACCURACY', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 0);
    tw.geo.setAccuracy(150);
    const result = await new VisitSpotUseCase(tw).execute({ operationId: testOperationId(1), spotId: 'l_jo01' });
    expect(codeOf(result)).toBe('LOW_ACCURACY');
    expect(tw.events.published).toHaveLength(0);
  });

  it('同じスポットを同じ日に別の operationId で訪問すると ALREADY_VISITED_TODAY（DI-08）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 0);
    const useCase = new VisitSpotUseCase(tw);
    must(await useCase.execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    const result = await useCase.execute({ operationId: testOperationId(2), spotId: 'l_jo01' });
    expect(codeOf(result)).toBe('ALREADY_VISITED_TODAY');
    tw.clock.advanceDays(1);
    expect(must(await useCase.execute({ operationId: testOperationId(3), spotId: 'l_jo01' })).localDate).toBe('2026-11-10');
    expect(tw.events.ofType('SpotVisited')).toHaveLength(2);
  });

  it('不正な spotId・operationId は INVALID_INPUT、マスタに無いスポットは SPOT_NOT_FOUND', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    const useCase = new VisitSpotUseCase(tw);
    expect(codeOf(await useCase.execute({ operationId: testOperationId(1), spotId: '<script>' }))).toBe('INVALID_INPUT');
    expect(codeOf(await useCase.execute({ operationId: 'not-uuid!', spotId: 'l_jo01' }))).toBe('INVALID_INPUT');
    expect(codeOf(await useCase.execute({ operationId: testOperationId(1), spotId: 'l_zz99' }))).toBe('SPOT_NOT_FOUND');
    expect(tw.geo.callCount).toBe(0);
  });

  it('未発見のスポットでも 80m 以内なら訪問でき、発見記録も付く', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw);
    standNear(tw, 's_jo03', 5);
    must(await new VisitSpotUseCase(tw).execute({ operationId: testOperationId(1), spotId: 's_jo03' }));
    const traveler = await storedTraveler(tw);
    expect(traveler.hasDiscovered(testSpotId('s_jo03'))).toBe(true);
    expect(traveler.hasVisited(testSpotId('s_jo03'))).toBe(true);
  });

  it('保存に失敗したら STORAGE_FAILED を返し、イベントを発行しない。同じ操作をやり直すと成功する（DI-12）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 0);
    const useCase = new VisitSpotUseCase(tw);
    tw.travelers.failures.failNext('save');
    const failed = await useCase.execute({ operationId: testOperationId(1), spotId: 'l_jo01' });
    expect(codeOf(failed)).toBe('STORAGE_FAILED');
    expect(tw.events.published).toHaveLength(0);
    expect((await storedTraveler(tw)).visits).toHaveLength(0);
    const retried = must(await useCase.execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    expect(retried.duplicate).toBe(false);
    expect(tw.events.ofType('SpotVisited')).toHaveLength(1);
  });

  it('保存が1回競合しても、読み直して訪問を記録する（DI-10）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 0);
    tw.travelers.failures.failNext('save', 'CONFLICT');
    const output = must(await new VisitSpotUseCase(tw).execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    expect(output.duplicate).toBe(false);
    expect((await storedTraveler(tw)).visits).toHaveLength(1);
    expect(tw.events.ofType('SpotVisited')).toHaveLength(1);
  });

  it('保存が競合し、読み直すと同じ操作が保存済みなら duplicate=true を返して発行しない（DI-07）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 0);
    let raced = false;
    const travelers: TravelerRepository = {
      findById: (id) => tw.travelers.findById(id),
      delete: (id) => tw.travelers.delete(id),
      save: async (traveler, expectedVersion) => {
        if (raced) return tw.travelers.save(traveler, expectedVersion);
        raced = true;
        must(await tw.travelers.save(traveler, expectedVersion)); // 並行した同じ要求が先に保存した
        return fail(AppError.of('CONFLICT', '競合（テスト）'));
      },
    };
    const output = must(await new VisitSpotUseCase({ ...tw, travelers }).execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    expect(output.duplicate).toBe(true);
    expect(tw.events.published).toHaveLength(0);
    expect((await storedTraveler(tw)).visits).toHaveLength(1);
  });

  it('SpotVisited の購読ハンドラには、保存済みの訪問記録が見える（DI-11）', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { discovered: ['l_jo01'] });
    standNear(tw, 'l_jo01', 0);
    const seen: number[] = [];
    tw.events.subscribe('SpotVisited', async () => {
      seen.push((await storedTraveler(tw)).visits.length);
    });
    must(await new VisitSpotUseCase(tw).execute({ operationId: testOperationId(1), spotId: 'l_jo01' }));
    expect(seen).toEqual([1]);
  });

  it('旅人がいなければ TRAVELER_NOT_FOUND', async () => {
    const tw = createTestWorld();
    const result = await new VisitSpotUseCase(tw).execute({ operationId: testOperationId(1), spotId: 'l_jo01' });
    expect(codeOf(result)).toBe('TRAVELER_NOT_FOUND');
  });
});
