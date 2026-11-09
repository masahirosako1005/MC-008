import { describe, expect, it } from 'vitest';
import { createTestWorld, districtOf, must } from '@/application/testing/fakes';
import { GetCurrentPositionUseCase } from '@/application/usecases/exploration/GetCurrentPositionUseCase';

describe('GetCurrentPositionUseCase', () => {
  it('現在地と測位精度を返す', async () => {
    const tw = createTestWorld();
    const position = must(await new GetCurrentPositionUseCase(tw).execute());
    expect(position).toEqual({ lat: tw.geo.currentPoint.lat, lng: tw.geo.currentPoint.lng, accuracyM: 5 });
    expect(tw.geo.callCount).toBe(1);
  });

  it('位置が取れなければ GEO_DENIED をそのまま返し、デモ位置に切り替えない（SEC-27）', async () => {
    const tw = createTestWorld();
    tw.geo.setError('GEO_DENIED');
    const result = await new GetCurrentPositionUseCase(tw).execute();
    expect(result.ok ? undefined : result.error.code).toBe('GEO_DENIED');
    expect(tw.demo.positions).toHaveLength(0);
    expect(tw.geo.currentPoint).toEqual(districtOf(tw.spots, 'd_joka').entrance);
  });
});
