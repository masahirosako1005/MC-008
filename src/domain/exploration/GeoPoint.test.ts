import { describe, expect, it } from 'vitest';
import { boundsOf, GeoPoint } from '@/domain/exploration/GeoPoint';

describe('GeoPoint.of', () => {
  it('範囲内の緯度経度から作れる（境界値を含む）', () => {
    expect(GeoPoint.of(34.69, 135.195).ok).toBe(true);
    expect(GeoPoint.of(90, 180).ok).toBe(true);
    expect(GeoPoint.of(-90, -180).ok).toBe(true);
  });
  it('範囲外・非有限を INVALID_INPUT で拒否する（DI-02）', () => {
    for (const [lat, lng] of [
      [90.0001, 0],
      [-90.0001, 0],
      [0, 180.0001],
      [0, -180.0001],
      [Number.NaN, 0],
      [0, Number.POSITIVE_INFINITY],
    ] as const) {
      const r = GeoPoint.of(lat, lng);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
  });
  it('作った値は凍結されている', () => {
    const r = GeoPoint.of(34.69, 135.195);
    expect(r.ok && Object.isFrozen(r.value)).toBe(true);
  });
});

describe('GeoPoint.fromUnknown', () => {
  it('{ lat, lng } の数値だけを受け付ける', () => {
    expect(GeoPoint.fromUnknown({ lat: 34.69, lng: 135.195 }).ok).toBe(true);
    expect(GeoPoint.fromUnknown({ lat: '34.69', lng: 135.195 }).ok).toBe(false);
    expect(GeoPoint.fromUnknown(null).ok).toBe(false);
    expect(GeoPoint.fromUnknown([34.69, 135.195]).ok).toBe(false);
  });
});

describe('boundsOf', () => {
  it('点の集合を囲む矩形を返す', () => {
    expect(
      boundsOf([
        { lat: 34.69, lng: 135.2 },
        { lat: 34.7, lng: 135.19 },
        { lat: 34.695, lng: 135.21 },
      ]),
    ).toEqual({ south: 34.69, west: 135.19, north: 34.7, east: 135.21 });
  });
  it('空なら undefined', () => {
    expect(boundsOf([])).toBeUndefined();
  });
});
