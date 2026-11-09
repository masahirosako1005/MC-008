import { describe, expect, it } from 'vitest';
import { DEMO_CLOCK_OFFSET_STORAGE_KEY } from '@/Common/constants/env';
import { AppError, fail } from '@/Common/result/Result';
import { epochMsOf, parseInstant } from '@/Common/utils/date';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import type { KeyValueStore } from '@/infrastructure/storage/KeyValueStore';
import { DemoClock, MAX_ADVANCE_DAYS } from '@/infrastructure/time/DemoClock';
import { SystemClock } from '@/infrastructure/time/SystemClock';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** テスト用: ISO 文字列のエポックミリ秒 */
function msOf(iso: string): number {
  return epochMsOf(must(parseInstant(iso)));
}

/** JST 2026-11-08 23:59:59.999 */
const JUST_BEFORE_MIDNIGHT_JST = msOf('2026-11-08T14:59:59.999Z');

describe('DemoClock', () => {
  it('offset が無ければ実時刻のまま。JST 23:59:59.999 は前日、+1ms で翌日（DI-04）', () => {
    let nowMs = JUST_BEFORE_MIDNIGHT_JST;
    const clock = new DemoClock({ store: new InMemoryKeyValueStore(), nowMs: () => nowMs });
    expect(clock.offsetDays()).toBe(0);
    expect(clock.now()).toBe('2026-11-08T14:59:59.999Z');
    expect(clock.today()).toBe('2026-11-08');
    nowMs += 1;
    expect(clock.today()).toBe('2026-11-09');
  });

  it('advanceDays で日付が進み、offset が保存される', () => {
    const store = new InMemoryKeyValueStore();
    const clock = new DemoClock({ store, nowMs: () => JUST_BEFORE_MIDNIGHT_JST });
    expect(must(clock.advanceDays(1))).toBe(1);
    expect(clock.today()).toBe('2026-11-09');
    expect(must(clock.advanceDays(30))).toBe(31);
    expect(clock.today()).toBe('2026-12-09');
    expect(clock.now()).toBe('2026-12-09T14:59:59.999Z');
    expect(store.snapshot()[DEMO_CLOCK_OFFSET_STORAGE_KEY]).toBe('31');
  });

  it('保存された offset は作り直した時計でも引き継がれる（再読込しても同じ日付）', () => {
    const store = new InMemoryKeyValueStore();
    must(new DemoClock({ store, nowMs: () => JUST_BEFORE_MIDNIGHT_JST }).advanceDays(90));
    const reloaded = new DemoClock({ store, nowMs: () => JUST_BEFORE_MIDNIGHT_JST });
    expect(reloaded.offsetDays()).toBe(90);
    expect(reloaded.today()).toBe('2027-02-06');
  });

  it('resetOffset で実時刻に戻り、保存も消える', () => {
    const store = new InMemoryKeyValueStore();
    const clock = new DemoClock({ store, nowMs: () => JUST_BEFORE_MIDNIGHT_JST });
    must(clock.advanceDays(30));
    must(clock.resetOffset());
    expect(clock.offsetDays()).toBe(0);
    expect(clock.today()).toBe('2026-11-08');
    expect(store.snapshot()[DEMO_CLOCK_OFFSET_STORAGE_KEY]).toBeUndefined();
  });

  it('0 以下・小数・上限超えの日数は INVALID_INPUT で、offset は変わらない', () => {
    const clock = new DemoClock({ store: new InMemoryKeyValueStore(), nowMs: () => JUST_BEFORE_MIDNIGHT_JST });
    for (const days of [0, -1, 1.5, Number.NaN, MAX_ADVANCE_DAYS + 1]) {
      const result = clock.advanceDays(days);
      expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    }
    expect(clock.offsetDays()).toBe(0);
  });

  it('保存された offset が壊れていれば 0 とみなす', () => {
    const store = new InMemoryKeyValueStore({ [DEMO_CLOCK_OFFSET_STORAGE_KEY]: '-5days' });
    const clock = new DemoClock({ store, nowMs: () => JUST_BEFORE_MIDNIGHT_JST });
    expect(clock.offsetDays()).toBe(0);
  });

  it('offset を保存できなければ STORAGE_FAILED で、日付は進まない', () => {
    const inner = new InMemoryKeyValueStore();
    const failing: KeyValueStore = {
      get: (key) => inner.get(key),
      set: () => fail(AppError.of('STORAGE_FAILED', 'full')),
      remove: (key) => inner.remove(key),
      keys: (prefix) => inner.keys(prefix),
    };
    const clock = new DemoClock({ store: failing, nowMs: () => JUST_BEFORE_MIDNIGHT_JST });
    const result = clock.advanceDays(30);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(clock.today()).toBe('2026-11-08');
  });
});

describe('SystemClock', () => {
  it('渡した実時刻を Instant と JST 暦日にする', () => {
    const clock = new SystemClock(() => msOf('2026-11-08T15:00:00.000Z'));
    expect(clock.now()).toBe('2026-11-08T15:00:00.000Z');
    expect(clock.today()).toBe('2026-11-09');
  });

  it('既定では端末の現在時刻を使う', () => {
    expect(must(parseInstant(new SystemClock().now()))).toMatch(/Z$/);
  });
});
