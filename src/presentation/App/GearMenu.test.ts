import { describe, expect, it } from 'vitest';
import { GEAR_LONG_PRESS_MS, longPressProgress } from '@/presentation/App/GearMenu';

describe('longPressProgress', () => {
  it('0.8 秒で 1 に達する（長押し成立）', () => {
    expect(GEAR_LONG_PRESS_MS).toBe(800);
    expect(longPressProgress(0)).toBe(0);
    expect(longPressProgress(400)).toBe(0.5);
    expect(longPressProgress(800)).toBe(1);
  });
  it('範囲外・不正値は 0〜1 に丸める', () => {
    expect(longPressProgress(5000)).toBe(1);
    expect(longPressProgress(-10)).toBe(0);
    expect(longPressProgress(Number.NaN)).toBe(0);
    expect(longPressProgress(100, 0)).toBe(0);
  });
});
