import { describe, expect, it } from 'vitest';
import { epochMsOf, parseInstant } from '@/Common/utils/date';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import { DemoControlAdapter } from '@/infrastructure/demo/DemoControlAdapter';
import { DemoGeoProvider } from '@/infrastructure/geo/DemoGeoProvider';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { DemoClock } from '@/infrastructure/time/DemoClock';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const NOW_MS = epochMsOf(must(parseInstant('2026-11-09T01:00:00.000Z')));
const ENTRANCE = must(GeoPoint.of(34.691892, 135.193905));

/** テスト用: デモ時計・デモ位置・アダプタ */
function setup(enabled: boolean): { clock: DemoClock; geo: DemoGeoProvider; demo: DemoControlAdapter } {
  const clock = new DemoClock({ store: new InMemoryKeyValueStore(), nowMs: () => NOW_MS });
  const geo = new DemoGeoProvider(clock);
  return { clock, geo, demo: new DemoControlAdapter({ clock, geo, enabled }) };
}

describe('DemoControlAdapter', () => {
  it('advanceDays で DemoClock の日付が進み、resetOffset で戻る', () => {
    const { clock, demo } = setup(true);
    expect(must(demo.advanceDays(30))).toBe(30);
    expect(demo.offsetDays()).toBe(30);
    expect(clock.today()).toBe('2026-12-09');
    must(demo.resetOffset());
    expect(clock.today()).toBe('2026-11-09');
  });

  it('setPosition で DemoGeoProvider の位置が変わる', async () => {
    const { geo, demo } = setup(true);
    demo.setPosition(ENTRANCE);
    expect(must(await geo.current()).point).toEqual(ENTRANCE);
  });

  it('無効なビルドでは DEMO_DISABLED で拒否し、日付も位置も変えない（SEC-02）', async () => {
    const { clock, geo, demo } = setup(false);
    const advanced = demo.advanceDays(30);
    expect(advanced.ok ? undefined : advanced.error.code).toBe('DEMO_DISABLED');
    const reset = demo.resetOffset();
    expect(reset.ok ? undefined : reset.error.code).toBe('DEMO_DISABLED');
    demo.setPosition(ENTRANCE);
    expect(clock.offsetDays()).toBe(0);
    expect((await geo.current()).ok).toBe(false);
  });

  it('enabled を省略するとビルドモード（テストでは isDemoBuild=false）に従う', () => {
    const clock = new DemoClock({ store: new InMemoryKeyValueStore(), nowMs: () => NOW_MS });
    const demo = new DemoControlAdapter({ clock, geo: new DemoGeoProvider(clock) });
    expect(demo.advanceDays(1).ok).toBe(false);
  });
});
