import { describe, expect, it } from 'vitest';
import { distanceMeters, metersPerDegLng } from '@/presentation/screens/Map/MapViewModel';
import {
  MAX_FOOTPRINTS,
  MAX_WALK_SECONDS,
  MAX_WALK_SPEED_MPS,
  MIN_WALK_SPEED_MPS,
  WALK_SCREEN_SPEED_PX,
  WALK_STEP_M,
  appendFootprint,
  interpolateWalk,
  pointAlong,
  shouldDiscoverAfter,
  stepsDue,
  walkSpeedMps,
} from '@/presentation/screens/Map/Walker';

const FROM = { lat: 34.6919, lng: 135.1939 };

/**
 * FROM から東へ meters 進んだ点を返す。
 * @param meters 距離（メートル）
 * @returns 緯度経度
 */
function eastOf(meters: number): { lat: number; lng: number } {
  return { lat: FROM.lat, lng: FROM.lng + meters / metersPerDegLng(FROM.lat) };
}

describe('interpolateWalk', () => {
  it('10m 以下の等間隔に区切り、最後は目的地そのもの', () => {
    const to = eastOf(95);
    const path = interpolateWalk(FROM, to);
    expect(path).toHaveLength(10);
    expect(path[path.length - 1]).toEqual(to);
    let prev = FROM;
    for (const p of path) {
      expect(distanceMeters(prev, p)).toBeLessThanOrEqual(WALK_STEP_M + 1e-6);
      prev = p;
    }
  });
  it('出発点と目的地が同じなら目的地1点だけ', () => {
    expect(interpolateWalk(FROM, FROM)).toEqual([FROM]);
  });
});

describe('walkSpeedMps', () => {
  it('画面上で WALK_SCREEN_SPEED_PX に見える速さを、下限・上限に収める', () => {
    expect(walkSpeedMps(100, 1)).toBe(WALK_SCREEN_SPEED_PX);
    expect(walkSpeedMps(10, 0.1)).toBe(MIN_WALK_SPEED_MPS);
    expect(walkSpeedMps(10, 10)).toBe(MAX_WALK_SPEED_MPS);
  });
  it('遠いときは MAX_WALK_SECONDS 以内に着くよう速める', () => {
    expect(walkSpeedMps(1400, 1)).toBe(1400 / MAX_WALK_SECONDS);
  });
  it('縮尺を省略したときは詳細表示の縮尺で、実際の徒歩より速く 100 m/秒 より遅い', () => {
    expect(walkSpeedMps(50)).toBeGreaterThan(MIN_WALK_SPEED_MPS);
    expect(walkSpeedMps(50)).toBeLessThan(100);
  });
});

describe('pointAlong', () => {
  it('経過時間×速度だけ直線上を進み、到着後は目的地で止まる', () => {
    const to = eastOf(100);
    const route = { from: FROM, to, totalM: 100, speedMps: 40 };
    expect(distanceMeters(FROM, pointAlong(route, 1000))).toBeCloseTo(40, 3);
    expect(pointAlong(route, 0)).toEqual(FROM);
    expect(pointAlong(route, 10_000)).toEqual(to);
  });
  it('距離 0 ならその場（目的地）', () => {
    expect(pointAlong({ from: FROM, to: FROM, totalM: 0, speedMps: 40 }, 500)).toEqual(FROM);
  });
});

describe('stepsDue', () => {
  it('経過時間×速度に見合う刻み数を返し、全刻み数を超えない', () => {
    expect(stepsDue(0, 120, 10, 10)).toBe(0);
    expect(stepsDue(250, 120, 10, 10)).toBe(3);
    expect(stepsDue(10_000, 120, 10, 10)).toBe(10);
  });
  it('刻みの長さが 0（その場）なら即到着', () => {
    expect(stepsDue(0, 120, 0, 1)).toBe(1);
  });
});

describe('shouldDiscoverAfter', () => {
  it('10m 刻みなら 20m ごとと到着時に発見判定する', () => {
    const calls = Array.from({ length: 7 }, (_, i) => shouldDiscoverAfter(i, 7, 10));
    expect(calls).toEqual([false, true, false, true, false, true, true]);
  });
  it('刻みが半端でも 20m の区切りをまたいだら判定する', () => {
    const calls = Array.from({ length: 5 }, (_, i) => shouldDiscoverAfter(i, 5, 9));
    expect(calls).toEqual([false, false, true, false, true]);
  });
});

describe('appendFootprint', () => {
  it('最大点数を超えたら古い点から捨てる', () => {
    const footprints: { lat: number; lng: number }[] = [];
    for (let i = 0; i < MAX_FOOTPRINTS + 5; i++) appendFootprint(footprints, { lat: i, lng: 0 });
    expect(footprints).toHaveLength(MAX_FOOTPRINTS);
    expect(footprints[0]?.lat).toBe(5);
    expect(footprints[footprints.length - 1]?.lat).toBe(MAX_FOOTPRINTS + 4);
  });
});
