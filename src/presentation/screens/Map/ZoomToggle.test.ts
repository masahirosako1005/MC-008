import { describe, expect, it } from 'vitest';
import type { MapDistrictVm } from '@/presentation/screens/Map/MapViewModel';
import { middleDistrictOf, toggleValueOf } from '@/presentation/screens/Map/ZoomToggle';

/** middleDistrictOf が使う項目（ID と中心）だけを持つ地区 */
const DISTRICTS = [
  { id: 'd_a', center: { lat: 34.7, lng: 135.5 } },
  { id: 'd_b', center: { lat: 34.71, lng: 135.5 } },
] as unknown as readonly MapDistrictVm[];

describe('toggleValueOf', () => {
  it('広域は「広域」、地区ズームは「中間」、近接は「詳細」', () => {
    expect(toggleValueOf('wide')).toBe('wide');
    expect(toggleValueOf('district')).toBe('middle');
    expect(toggleValueOf('near')).toBe('detail');
  });
});

describe('middleDistrictOf', () => {
  it('注目中の地区 → 現在地の地区 → いちばん近い地区 の順に決める', () => {
    expect(middleDistrictOf(DISTRICTS, 'd_b', { lat: 34.7, lng: 135.5 }, 'd_a')).toBe('d_b');
    expect(middleDistrictOf(DISTRICTS, undefined, { lat: 34.7, lng: 135.5 }, 'd_a')).toBe('d_a');
    expect(middleDistrictOf(DISTRICTS, undefined, { lat: 34.709, lng: 135.5 }, undefined)).toBe('d_b');
  });

  it('注目中の地区が無い地区なら使わない。現在地も無ければ決められない', () => {
    expect(middleDistrictOf(DISTRICTS, 'd_none', undefined, undefined)).toBeUndefined();
    expect(middleDistrictOf([], undefined, { lat: 34.7, lng: 135.5 }, undefined)).toBeUndefined();
  });
});
