import { describe, expect, it } from 'vitest';
import { createTestWorld, districtOf, must, offsetPoint } from '@/application/testing/fakes';
import { createDemoUseCases, createScenarioWorld } from '@/application/testing/scenarioCatalog';

describe('ResetPositionUseCase', () => {
  it('デモ位置を開始地区（南森町・天満宮地区）の入口へ戻す（精度 5m）', async () => {
    const tw = createScenarioWorld();
    const entrance = districtOf(tw.spots, 'd_minamimori').entrance;
    const position = must(await createDemoUseCases(tw, { enabled: true }).resetPosition.execute());
    expect(position).toEqual({ lat: entrance.lat, lng: entrance.lng, accuracyM: 5 });
    expect(tw.demo.positions).toEqual([entrance]);
    expect(tw.geo.currentPoint).toEqual(entrance);
  });

  it('デモが無効なら DEMO_DISABLED で位置を変えない（SEC-02）', async () => {
    const tw = createTestWorld();
    const result = await createDemoUseCases(tw, { enabled: false }).resetPosition.execute();
    expect(result.ok ? undefined : result.error.code).toBe('DEMO_DISABLED');
    expect(tw.demo.positions).toEqual([]);
  });

  it('マスタに開始地区が無ければ DISTRICT_NOT_FOUND で位置を変えない', async () => {
    const tw = createTestWorld();
    const result = await createDemoUseCases(tw, { enabled: true }).resetPosition.execute();
    expect(result.ok ? undefined : result.error.code).toBe('DISTRICT_NOT_FOUND');
    expect(tw.demo.positions).toEqual([]);
  });
});

describe('MoveDemoPositionUseCase', () => {
  it('市域の中ならデモ位置を動かす', async () => {
    const tw = createTestWorld();
    const target = offsetPoint(districtOf(tw.spots, 'd_honmachi').center, { eastM: 10 });
    const position = must(await createDemoUseCases(tw, { enabled: true }).moveTo.execute({ lat: target.lat, lng: target.lng }));
    expect(position).toEqual({ lat: target.lat, lng: target.lng, accuracyM: 5 });
    expect(tw.geo.currentPoint).toEqual(target);
  });

  it('市域の外・数値でない・範囲外の緯度経度は INVALID_INPUT で動かさない（DI-01）', async () => {
    const tw = createTestWorld();
    const { moveTo } = createDemoUseCases(tw, { enabled: true });
    const bounds = tw.spots.cityBounds();
    const codes = [
      await moveTo.execute({ lat: bounds.north + 0.01, lng: bounds.east }),
      await moveTo.execute({ lat: Number.NaN, lng: bounds.east }),
      await moveTo.execute({ lat: 91, lng: 0 }),
    ].map((result) => (result.ok ? undefined : result.error.code));
    expect(codes).toEqual(['INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT']);
    expect(tw.demo.positions).toEqual([]);
  });

  it('市域の境界上は受け付ける', async () => {
    const tw = createTestWorld();
    const bounds = tw.spots.cityBounds();
    expect((await createDemoUseCases(tw, { enabled: true }).moveTo.execute({ lat: bounds.south, lng: bounds.west })).ok).toBe(true);
  });

  it('デモが無効なら DEMO_DISABLED（SEC-02）', async () => {
    const tw = createTestWorld();
    const center = districtOf(tw.spots, 'd_joka').center;
    const result = await createDemoUseCases(tw, { enabled: false }).moveTo.execute({ lat: center.lat, lng: center.lng });
    expect(result.ok ? undefined : result.error.code).toBe('DEMO_DISABLED');
    expect(tw.demo.positions).toEqual([]);
  });
});
