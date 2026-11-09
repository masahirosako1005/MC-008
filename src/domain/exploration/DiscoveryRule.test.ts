import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseSpotId } from '@/Common/types/Id';
import type { SpotId } from '@/Common/types/Id';
import { parseInstant } from '@/Common/utils/date';
import type { Instant } from '@/Common/utils/date';
import {
  findSpotsToDiscover,
  isPlausibleMove,
  isWithinDiscoveryRadius,
  isWithinVisitRadius,
  nearestSpots,
} from '@/domain/exploration/DiscoveryRule';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { Spot } from '@/domain/spot/Spot';

/** 1m あたりの緯度（度）。地球平均半径から */
const DEG_PER_M = 180 / (Math.PI * 6_371_008.8);
const ORIGIN: GeoPoint = { lat: 34.69, lng: 135.195 };

/** テスト用: 北へ meters 進んだ点 */
function north(meters: number): GeoPoint {
  return { lat: ORIGIN.lat + meters * DEG_PER_M, lng: ORIGIN.lng };
}

/** テスト用: 検証済み ID */
function sid(raw: string): SpotId {
  const r = parseSpotId(raw);
  if (!r.ok) throw new Error(raw);
  return r.value;
}

/** テスト用: 指定位置のスポット */
function spot(id: string, point: GeoPoint): Spot {
  const district = parseDistrictId('d_joka');
  if (!district.ok) throw new Error('fixture');
  return { id: sid(id), kind: id.startsWith('l_') ? 'landmark' : 'shop', districtId: district.value, name: id, point, category: 'test', description: '', amenities: [], hours: '', partner: false };
}

/** テスト用: 検証済み Instant */
function at(raw: string): Instant {
  const r = parseInstant(raw);
  if (!r.ok) throw new Error(raw);
  return r.value;
}

describe('半径の判定（境界値）', () => {
  it('訪問: 40m は可、41m は不可', () => {
    expect(isWithinVisitRadius(0)).toBe(true);
    expect(isWithinVisitRadius(40)).toBe(true);
    expect(isWithinVisitRadius(41)).toBe(false);
  });
  it('発見: 80m は発見、81m は不可', () => {
    expect(isWithinDiscoveryRadius(80)).toBe(true);
    expect(isWithinDiscoveryRadius(81)).toBe(false);
  });
  it('小数は整数に丸めてから判定する（DI-18）', () => {
    expect(isWithinVisitRadius(40.4)).toBe(true);
    expect(isWithinVisitRadius(40.5)).toBe(false);
    expect(isWithinDiscoveryRadius(80.49)).toBe(true);
  });
  it('負・非数は常に範囲外', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isWithinVisitRadius(bad)).toBe(false);
      expect(isWithinDiscoveryRadius(bad)).toBe(false);
    }
  });
});

describe('findSpotsToDiscover', () => {
  const spots = [spot('s_jo02', north(79)), spot('l_jo01', north(30)), spot('s_jo03', north(82)), spot('s_jo04', north(60))];

  it('80m 以内の未発見スポットを近い順に返す', () => {
    const found = findSpotsToDiscover(ORIGIN, spots, () => false).map((s) => s.id);
    expect(found).toEqual(['l_jo01', 's_jo04', 's_jo02']);
  });
  it('発見済みは除く', () => {
    const found = findSpotsToDiscover(ORIGIN, spots, (id) => id === 'l_jo01').map((s) => s.id);
    expect(found).toEqual(['s_jo04', 's_jo02']);
  });
  it('スポットが無ければ空', () => {
    expect(findSpotsToDiscover(ORIGIN, [], () => false)).toEqual([]);
  });
});

describe('nearestSpots', () => {
  it('距離昇順で limit 件。同距離は ID 昇順', () => {
    const spots = [spot('s_jo09', north(50)), spot('s_jo01', north(50)), spot('l_jo01', north(10)), spot('s_jo05', north(300))];
    const result = nearestSpots(ORIGIN, spots, 3);
    expect(result.map((r) => r.spot.id)).toEqual(['l_jo01', 's_jo01', 's_jo09']);
    expect(result.map((r) => r.meters)).toEqual([10, 50, 50]);
  });
  it('limit が 0 以下・非数なら空', () => {
    const spots = [spot('l_jo01', north(10))];
    expect(nearestSpots(ORIGIN, spots, 0)).toEqual([]);
    expect(nearestSpots(ORIGIN, spots, -3)).toEqual([]);
    expect(nearestSpots(ORIGIN, spots, Number.NaN)).toEqual([]);
  });
});

describe('isPlausibleMove（DI-14）', () => {
  it('徒歩の速さなら妥当', () => {
    expect(isPlausibleMove({ point: ORIGIN, accuracyM: 5, at: at('2026-11-09T00:00:00.000Z') }, { point: north(100), accuracyM: 5, at: at('2026-11-09T00:01:00.000Z') })).toBe(true);
  });
  it('1秒で 1km は不自然', () => {
    expect(isPlausibleMove({ point: ORIGIN, accuracyM: 5, at: at('2026-11-09T00:00:00.000Z') }, { point: north(1000), accuracyM: 5, at: at('2026-11-09T00:00:01.000Z') })).toBe(false);
  });
  it('同時刻でも精度の範囲内のぶれは妥当', () => {
    expect(isPlausibleMove({ point: ORIGIN, accuracyM: 10, at: at('2026-11-09T00:00:00.000Z') }, { point: north(15), accuracyM: 10, at: at('2026-11-09T00:00:00.000Z') })).toBe(true);
  });
  it('時刻が逆行していれば不可', () => {
    expect(isPlausibleMove({ point: ORIGIN, accuracyM: 5, at: at('2026-11-09T00:01:00.000Z') }, { point: ORIGIN, accuracyM: 5, at: at('2026-11-09T00:00:00.000Z') })).toBe(false);
  });
});
