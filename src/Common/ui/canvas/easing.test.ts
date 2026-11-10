import { describe, expect, it } from 'vitest';
import { clamp01, easeOutBack, easeOutCubic, lerp } from '@/Common/ui/canvas/easing';

describe('clamp01', () => {
  it('0〜1 に丸め、NaN・無限大は 0 にする', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(3)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('lerp', () => {
  it('始点と終点の間を進み具合で求め、範囲外は端で止める', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, -1)).toBe(10);
    expect(lerp(10, 20, 2)).toBe(20);
  });
});

describe('easeOutCubic', () => {
  it('0 で 0、1 で 1、途中は線形より先に進む', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    expect(easeOutCubic(5)).toBe(1);
  });
});

describe('easeOutBack', () => {
  it('0 で 0、1 で 1、途中で 1 を超える', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
    expect(easeOutBack(1)).toBe(1);
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
  });

  it('行き過ぎの強さを大きくすると、より強くはねる', () => {
    expect(easeOutBack(0.7, 1.9)).toBeGreaterThan(easeOutBack(0.7));
  });
});
