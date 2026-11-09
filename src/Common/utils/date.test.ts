import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareLocalDate,
  dayOfWeekOf,
  daysBetween,
  endOfMonth,
  epochDayOf,
  epochMsOf,
  formatJpDate,
  formatJpTime,
  instantFromEpochMs,
  jstInstantOf,
  localDateFromEpochDay,
  localDateOf,
  monthKeyOf,
  parseInstant,
  parseLocalDate,
  seasonOf,
  startOfMonth,
} from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';

/** テスト用: 文字列を検証済み LocalDate にする */
function d(text: string): LocalDate {
  const r = parseLocalDate(text);
  if (!r.ok) throw new Error(`bad date ${text}`);
  return r.value;
}

/** テスト用: 文字列を検証済み Instant にする */
function t(text: string): Instant {
  const r = parseInstant(text);
  if (!r.ok) throw new Error(`bad instant ${text}`);
  return r.value;
}

describe('localDateOf（JST 暦日）', () => {
  it('JST 23:59:59.999（UTC 14:59:59.999）は同じ日', () => {
    expect(localDateOf(t('2026-11-08T14:59:59.999Z'))).toBe('2026-11-08');
  });
  it('JST 翌 0:00（UTC 15:00）は翌日になる', () => {
    expect(localDateOf(t('2026-11-08T15:00:00.000Z'))).toBe('2026-11-09');
  });
  it('UTC では前日でも JST では元日になる（年またぎ）', () => {
    expect(localDateOf(t('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01');
    expect(localDateOf(t('2026-12-31T14:59:59.999Z'))).toBe('2026-12-31');
  });
  it('Date の UTC+9 計算と広い範囲で一致する', () => {
    for (let ms = Date.UTC(1999, 0, 1); ms < Date.UTC(2031, 0, 1); ms += 7 * 3_600_000 + 13 * 60_000) {
      const shifted = new Date(ms + 9 * 3_600_000);
      const expected = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
      expect(localDateOf(instantFromEpochMs(ms))).toBe(expected);
    }
  });
});

describe('instantFromEpochMs / epochMsOf', () => {
  it('エポック 0 は 1970-01-01T00:00:00.000Z', () => {
    expect(instantFromEpochMs(0)).toBe('1970-01-01T00:00:00.000Z');
  });
  it('往復で同じミリ秒に戻る', () => {
    const ms = Date.UTC(2026, 10, 9, 0, 41, 5, 123);
    expect(epochMsOf(instantFromEpochMs(ms))).toBe(ms);
  });
  it('非有限・範囲外の値はバグとして例外', () => {
    expect(() => instantFromEpochMs(Number.NaN)).toThrow();
    expect(() => instantFromEpochMs(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => instantFromEpochMs(9e15)).toThrow();
  });
});

describe('parseInstant / parseLocalDate（境界検証）', () => {
  it('正しい書式を受け付ける', () => {
    expect(parseInstant('2026-11-09T00:00:00.000Z').ok).toBe(true);
    expect(parseLocalDate('2028-02-29').ok).toBe(true);
  });
  it('不正な値を拒否する', () => {
    for (const bad of ['2026-02-30T00:00:00.000Z', '2026-11-09T24:00:00.000Z', '2026-11-09T09:00:00+09:00', '2026-11-09T00:00:00Z', '', 1, null, undefined]) {
      expect(parseInstant(bad).ok).toBe(false);
    }
    for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '2026/11/09', '20261109', 20261109, null]) {
      expect(parseLocalDate(bad).ok).toBe(false);
    }
  });
  it('失敗は INVALID_INPUT', () => {
    const r = parseLocalDate('x');
    expect(r.ok ? undefined : r.error.code).toBe('INVALID_INPUT');
  });
});

describe('daysBetween / addDays', () => {
  it('同日は 0、逆順は負', () => {
    expect(daysBetween(d('2026-11-09'), d('2026-11-09'))).toBe(0);
    expect(daysBetween(d('2026-11-09'), d('2026-11-08'))).toBe(-1);
  });
  it('月末・年末・閏年をまたぐ', () => {
    expect(daysBetween(d('2026-11-09'), d('2026-12-09'))).toBe(30);
    expect(daysBetween(d('2026-12-31'), d('2027-01-01'))).toBe(1);
    expect(daysBetween(d('2028-02-28'), d('2028-03-01'))).toBe(2);
    expect(daysBetween(d('2027-02-28'), d('2027-03-01'))).toBe(1);
  });
  it('addDays は月末・年末をまたいで進み、負でも戻る', () => {
    expect(addDays(d('2026-01-31'), 1)).toBe('2026-02-01');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
    expect(addDays(d('2028-03-01'), -1)).toBe('2028-02-29');
    expect(addDays(d('2026-11-09'), 90)).toBe('2027-02-07');
    expect(addDays(d('2026-11-09'), 0)).toBe('2026-11-09');
  });
});

describe('月の計算', () => {
  it('月キー・月初・月末', () => {
    expect(monthKeyOf(d('2026-11-09'))).toBe('2026-11');
    expect(startOfMonth(d('2026-11-09'))).toBe('2026-11-01');
    expect(endOfMonth(d('2026-11-09'))).toBe('2026-11-30');
    expect(endOfMonth(d('2026-12-15'))).toBe('2026-12-31');
  });
  it('2月末は閏年規則に従う（4・100・400）', () => {
    expect(endOfMonth(d('2026-02-10'))).toBe('2026-02-28');
    expect(endOfMonth(d('2028-02-10'))).toBe('2028-02-29');
    expect(endOfMonth(d('2100-02-01'))).toBe('2100-02-28');
    expect(endOfMonth(d('2000-02-01'))).toBe('2000-02-29');
  });
});

describe('seasonOf', () => {
  it('3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬（境界の日）', () => {
    expect(seasonOf(d('2026-02-28'))).toBe('winter');
    expect(seasonOf(d('2026-03-01'))).toBe('spring');
    expect(seasonOf(d('2026-05-31'))).toBe('spring');
    expect(seasonOf(d('2026-06-01'))).toBe('summer');
    expect(seasonOf(d('2026-08-31'))).toBe('summer');
    expect(seasonOf(d('2026-09-01'))).toBe('autumn');
    expect(seasonOf(d('2026-11-30'))).toBe('autumn');
    expect(seasonOf(d('2026-12-01'))).toBe('winter');
    expect(seasonOf(d('2027-01-15'))).toBe('winter');
  });
});

describe('epochDayOf / localDateFromEpochDay', () => {
  it('1970-01-01 は 0、前後は ±1', () => {
    expect(epochDayOf(d('1970-01-01'))).toBe(0);
    expect(epochDayOf(d('1970-01-02'))).toBe(1);
    expect(epochDayOf(d('1969-12-31'))).toBe(-1);
  });
  it('2026-11-09 は Date.UTC と一致する', () => {
    expect(epochDayOf(d('2026-11-09'))).toBe(Date.UTC(2026, 10, 9) / 86_400_000);
  });
  it('往復で同じ日付に戻る（広い範囲）', () => {
    for (let day = -800; day < 40_000; day += 37) {
      expect(epochDayOf(localDateFromEpochDay(day))).toBe(day);
      expect(localDateFromEpochDay(day)).toBe(new Date(day * 86_400_000).toISOString().slice(0, 10));
    }
  });
});

describe('表示用の書式', () => {
  it('formatJpDate は曜日つき', () => {
    expect(formatJpDate(d('2026-11-09'))).toBe('2026/11/09（月）');
    expect(formatJpDate(d('2026-11-15'))).toBe('2026/11/15（日）');
    expect(dayOfWeekOf(d('1970-01-01'))).toBe(4);
  });
  it('formatJpTime は JST の H:mm', () => {
    expect(formatJpTime(t('2026-11-09T00:41:00.000Z'))).toBe('9:41');
    expect(formatJpTime(t('2026-11-08T15:05:00.000Z'))).toBe('0:05');
    expect(formatJpTime(t('2026-11-09T14:59:59.999Z'))).toBe('23:59');
  });
});

describe('jstInstantOf / compareLocalDate', () => {
  it('JST の暦日と時刻から Instant を作り、localDateOf で同じ日に戻る', () => {
    const at = jstInstantOf(d('2026-11-09'), 23, 59);
    expect(at).toBe('2026-11-09T14:59:00.000Z');
    expect(localDateOf(at)).toBe('2026-11-09');
    expect(localDateOf(jstInstantOf(d('2026-11-10'), 0, 0))).toBe('2026-11-10');
  });
  it('時・分が範囲外ならバグとして例外', () => {
    expect(() => jstInstantOf(d('2026-11-09'), 24, 0)).toThrow();
    expect(() => jstInstantOf(d('2026-11-09'), 12, 60)).toThrow();
  });
  it('compareLocalDate は暦順', () => {
    expect(compareLocalDate(d('2026-11-09'), d('2026-11-10'))).toBeLessThan(0);
    expect(compareLocalDate(d('2026-11-09'), d('2026-11-09'))).toBe(0);
    expect(compareLocalDate(d('2027-01-01'), d('2026-12-31'))).toBeGreaterThan(0);
  });
});
