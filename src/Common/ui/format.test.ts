import { describe, expect, it } from 'vitest';
import { formatDistance } from '@/Common/ui/format';

describe('formatDistance', () => {
  it('1000m 未満は m 表記（整数に丸める）', () => {
    expect(formatDistance(62)).toBe('62m');
    expect(formatDistance(39.6)).toBe('40m');
    expect(formatDistance(999)).toBe('999m');
  });
  it('1000m 以上は km 表記（小数1桁）', () => {
    expect(formatDistance(1000)).toBe('1.0km');
    expect(formatDistance(1249)).toBe('1.2km');
    expect(formatDistance(2650)).toBe('2.7km');
  });
  it('負・非数は 0m とみなす', () => {
    expect(formatDistance(-5)).toBe('0m');
    expect(formatDistance(Number.NaN)).toBe('0m');
  });
});
