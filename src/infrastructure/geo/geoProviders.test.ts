import { describe, expect, it } from 'vitest';
import { parseInstant, parseLocalDate } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { Clock } from '@/domain/ports/Clock';
import { BrowserGeoProvider, GEO_TIMEOUT_MS } from '@/infrastructure/geo/BrowserGeoProvider';
import { DEMO_ACCURACY_M, DemoGeoProvider } from '@/infrastructure/geo/DemoGeoProvider';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const NOW: Instant = must(parseInstant('2026-11-09T01:00:00.000Z'));
const TODAY: LocalDate = must(parseLocalDate('2026-11-09'));
const FIXED_CLOCK: Clock = { now: () => NOW, today: () => TODAY };
const POINT = must(GeoPoint.of(34.691892, 135.193905));

/** テスト用: 1回だけ応答する Geolocation の偽物 */
function fakeGeolocation(respond: (success: PositionCallback, error: PositionErrorCallback, options?: PositionOptions) => void): {
  geolocation: Geolocation;
  calls: PositionOptions[];
} {
  const calls: PositionOptions[] = [];
  const geolocation: Geolocation = {
    getCurrentPosition: (success, error, options) => {
      calls.push(options ?? {});
      respond(success, error ?? ((): void => undefined), options);
    },
    watchPosition: () => 0,
    clearWatch: () => undefined,
  };
  return { geolocation, calls };
}

/** テスト用: 測位結果 */
function position(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  const coords = { latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) };
  return { coords, timestamp: 0, toJSON: () => ({}) } as GeolocationPosition;
}

/** テスト用: 測位エラー */
function positionError(code: number): GeolocationPositionError {
  return { code, message: 'x', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

describe('DemoGeoProvider', () => {
  it('未設定なら GEO_UNAVAILABLE', async () => {
    const result = await new DemoGeoProvider(FIXED_CLOCK).current();
    expect(result.ok ? undefined : result.error.code).toBe('GEO_UNAVAILABLE');
  });

  it('setPosition した位置を精度 5m・時計の時刻で返し、clearPosition で未設定に戻る', async () => {
    const geo = new DemoGeoProvider(FIXED_CLOCK);
    geo.setPosition(POINT);
    expect(must(await geo.current())).toEqual({ point: POINT, accuracyM: DEMO_ACCURACY_M, at: NOW });
    geo.clearPosition();
    expect((await geo.current()).ok).toBe(false);
  });
});

describe('BrowserGeoProvider', () => {
  it('測位できれば位置・精度・時計の時刻を返し、高精度・10秒タイムアウト・キャッシュ不可で呼ぶ', async () => {
    const fake = fakeGeolocation((success) => success(position(34.69, 135.19, 12)));
    const provider = new BrowserGeoProvider({ clock: FIXED_CLOCK, geolocation: () => fake.geolocation });
    const fix = must(await provider.current());
    expect(fix).toEqual({ point: { lat: 34.69, lng: 135.19 }, accuracyM: 12, at: NOW });
    expect(fake.calls).toEqual([{ enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 }]);
  });

  it('権限拒否は GEO_DENIED（デモ位置へ切り替えない＝SEC-27）', async () => {
    const fake = fakeGeolocation((_success, error) => error(positionError(1)));
    const result = await new BrowserGeoProvider({ clock: FIXED_CLOCK, geolocation: () => fake.geolocation }).current();
    expect(result.ok ? undefined : result.error.code).toBe('GEO_DENIED');
  });

  it('タイムアウト・測位不能は GEO_UNAVAILABLE', async () => {
    for (const code of [2, 3]) {
      const fake = fakeGeolocation((_success, error) => error(positionError(code)));
      const result = await new BrowserGeoProvider({ clock: FIXED_CLOCK, geolocation: () => fake.geolocation }).current();
      expect(result.ok ? undefined : result.error.code).toBe('GEO_UNAVAILABLE');
    }
  });

  it('座標・精度が不正なら GEO_UNAVAILABLE', async () => {
    const fake = fakeGeolocation((success) => success(position(Number.NaN, 135.19, 5)));
    const result = await new BrowserGeoProvider({ clock: FIXED_CLOCK, geolocation: () => fake.geolocation }).current();
    expect(result.ok ? undefined : result.error.code).toBe('GEO_UNAVAILABLE');
  });

  it('位置情報 API が無い・呼出が例外なら GEO_UNAVAILABLE', async () => {
    const none = await new BrowserGeoProvider({ clock: FIXED_CLOCK, geolocation: () => undefined }).current();
    expect(none.ok ? undefined : none.error.code).toBe('GEO_UNAVAILABLE');
    const throwing = fakeGeolocation(() => {
      throw new Error('blocked');
    });
    const thrown = await new BrowserGeoProvider({ clock: FIXED_CLOCK, geolocation: () => throwing.geolocation }).current();
    expect(thrown.ok ? undefined : thrown.error.code).toBe('GEO_UNAVAILABLE');
    const defaultApi = await new BrowserGeoProvider({ clock: FIXED_CLOCK }).current();
    expect(defaultApi.ok ? undefined : defaultApi.error.code).toBe('GEO_UNAVAILABLE');
  });
});
