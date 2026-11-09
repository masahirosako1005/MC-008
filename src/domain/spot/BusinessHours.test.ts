/**
 * @file 営業時間の値オブジェクトのテスト（domain/spot 層）
 */
import { describe, expect, it } from 'vitest';
import { createBusinessHours, formatBusinessHours, minutesOf, parseBusinessHoursText } from '@/domain/spot/BusinessHours';

describe('BusinessHours', () => {
  it('マスタと同じ書式の文字列を作る（定休日は月→日の順、なしは「無休」）', () => {
    const hours = createBusinessHours({ open: '9:30', close: '19:00', closedDays: [3] });
    expect(hours.ok && formatBusinessHours(hours.value)).toBe('9:30–19:00（木休）');
    const two = createBusinessHours({ open: '12:00', close: '18:00', closedDays: [1, 0] });
    expect(two.ok && formatBusinessHours(two.value)).toBe('12:00–18:00（月火休）');
    const none = createBusinessHours({ open: '15:00', close: '24:00', closedDays: [] });
    expect(none.ok && formatBusinessHours(none.value)).toBe('15:00–24:00（無休）');
  });

  it('マスタの文字列を入力欄の値に戻せる（戻せない書式は undefined）', () => {
    expect(parseBusinessHoursText('8:00–18:00（水休）')).toEqual({ open: '8:00', close: '18:00', closedDays: [2] });
    expect(parseBusinessHoursText('12:00–18:00（月火休）')?.closedDays).toEqual([0, 1]);
    expect(parseBusinessHoursText('15:00–23:00（無休）')?.closedDays).toEqual([]);
    expect(parseBusinessHoursText('境内自由')).toBeUndefined();
    expect(parseBusinessHoursText('店舗により異なる')).toBeUndefined();
  });

  it('開店 ≧ 閉店・全曜日休み・範囲外の時刻は拒否する', () => {
    expect(createBusinessHours({ open: '18:00', close: '9:00', closedDays: [] }).ok).toBe(false);
    expect(createBusinessHours({ open: '9:00', close: '9:00', closedDays: [] }).ok).toBe(false);
    expect(createBusinessHours({ open: '9:00', close: '18:00', closedDays: [0, 1, 2, 3, 4, 5, 6] }).ok).toBe(false);
    expect(createBusinessHours({ open: '9:00', close: '18:00', closedDays: [7] }).ok).toBe(false);
    expect(minutesOf('24:30')).toBeUndefined();
    expect(minutesOf('9:5')).toBeUndefined();
    expect(minutesOf('24:00')).toBe(1440);
  });

  it('マスタの営業時間（書式が合うもの）は往復しても同じ文字列になる', () => {
    for (const text of ['10:00–19:00（日休）', '7:00–15:00（日休）', '17:00–24:00（日休）', '10:30–18:30（水休）']) {
      const parsed = parseBusinessHoursText(text);
      expect(parsed && formatBusinessHours(parsed)).toBe(text);
    }
  });
});
