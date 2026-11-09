import { describe, expect, it } from 'vitest';
import { Distance } from '@/domain/exploration/Distance';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';

const ORIGIN: GeoPoint = { lat: 34.69, lng: 135.195 };

describe('Distance.between（既知距離 ±1m）', () => {
  it('同じ点は 0m', () => {
    expect(Distance.between(ORIGIN, ORIGIN).meters).toBe(0);
  });
  it('南北 0.0009° は約 100m（haversine 100.08m）', () => {
    expect(Math.abs(Distance.between(ORIGIN, { lat: 34.6909, lng: 135.195 }).meters - 100.08)).toBeLessThanOrEqual(1);
  });
  it('東西 0.0011°（北緯34.69°）は約 101m（haversine 100.57m）', () => {
    expect(Math.abs(Distance.between(ORIGIN, { lat: 34.69, lng: 135.1961 }).meters - 100.57)).toBeLessThanOrEqual(1);
  });
  it('斜め方向も一致する（haversine 567.51m）', () => {
    expect(Math.abs(Distance.between(ORIGIN, { lat: 34.6936, lng: 135.1994 }).meters - 567.51)).toBeLessThanOrEqual(1);
  });
  it('数 km でも誤差 1m 以内（東京駅→新宿駅 haversine 6873.07m）', () => {
    const tokyo = { lat: 35.681236, lng: 139.767125 };
    const shinjuku = { lat: 35.689487, lng: 139.691706 };
    expect(Math.abs(Distance.between(tokyo, shinjuku).meters - 6873.07)).toBeLessThanOrEqual(1);
  });
  it('距離は整数に丸め、向きによらず同じ（DI-18）', () => {
    const p = { lat: 34.6936, lng: 135.1994 };
    const ab = Distance.between(ORIGIN, p).meters;
    expect(Number.isInteger(ab)).toBe(true);
    expect(Distance.between(p, ORIGIN).meters).toBe(ab);
  });
});

describe('Distance.ofMeters', () => {
  it('0 以上の有限数を整数に丸めて受け付ける', () => {
    const r = Distance.ofMeters(40.4);
    expect(r.ok ? r.value.meters : undefined).toBe(40);
    expect(Distance.ofMeters(0).ok).toBe(true);
  });
  it('負・非数を拒否する', () => {
    expect(Distance.ofMeters(-1).ok).toBe(false);
    expect(Distance.ofMeters(Number.NaN).ok).toBe(false);
    expect(Distance.ofMeters(Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});
