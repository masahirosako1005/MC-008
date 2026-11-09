import { describe, expect, it } from 'vitest';
import { backingStoreSize, MAX_DEVICE_PIXEL_RATIO, normalizeDpr } from '@/Common/ui/canvas/CanvasBase';

describe('normalizeDpr', () => {
  it('1〜上限の範囲に丸める', () => {
    expect(normalizeDpr(2)).toBe(2);
    expect(normalizeDpr(0.5)).toBe(1);
    expect(normalizeDpr(5)).toBe(MAX_DEVICE_PIXEL_RATIO);
  });
  it('不正な値は 1 とみなす', () => {
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(normalizeDpr(bad)).toBe(1);
  });
});

describe('backingStoreSize', () => {
  it('CSS px に倍率を掛けて整数に丸める', () => {
    expect(backingStoreSize(390, 600, 2)).toEqual({ width: 780, height: 1200 });
    expect(backingStoreSize(100.4, 50.6, 1.5)).toEqual({ width: 151, height: 76 });
  });
  it('0 以下でも最低 1px にする', () => {
    expect(backingStoreSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
  });
});
