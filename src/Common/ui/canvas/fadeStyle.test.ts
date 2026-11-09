import { describe, expect, it } from 'vitest';
import {
  FADE_ICON,
  FADING_ALPHA_END,
  FADING_ALPHA_START,
  FADING_SATURATION_END,
  FADING_SATURATION_START,
  fadedFill,
  fadeVisual,
} from '@/Common/ui/canvas/fadeStyle';

describe('fadeVisual', () => {
  it('訪問なし・新鮮な地区は元のまま（破線もアイコンもなし）', () => {
    for (const kind of ['never', 'fresh'] as const) {
      expect(fadeVisual(kind)).toEqual({ saturation: 1, alpha: 1, dashed: false, icon: '' });
    }
  });
  it('色あせ間近（soon）は少しだけ薄くし、破線・アイコンは付けない', () => {
    const v = fadeVisual('soon');
    expect(v.saturation).toBeLessThan(1);
    expect(v.saturation).toBeGreaterThan(FADING_SATURATION_START);
    expect(v.alpha).toBeLessThan(1);
    expect(v.dashed).toBe(false);
    expect(v.icon).toBe('');
  });
  it('色あせ開始の瞬間（progress=0）から目に見えて薄く、破線と ◌ を付ける', () => {
    expect(fadeVisual('fading', 0)).toEqual({ saturation: FADING_SATURATION_START, alpha: FADING_ALPHA_START, dashed: true, icon: FADE_ICON });
  });
  it('最も薄い（progress=1）ときは彩度 0.1・透明度 0.45', () => {
    const v = fadeVisual('fading', 1);
    expect(v.saturation).toBeCloseTo(FADING_SATURATION_END);
    expect(v.alpha).toBeCloseTo(FADING_ALPHA_END);
  });
  it('progress に比例して薄くなり、範囲外・非数は丸める', () => {
    const half = fadeVisual('fading', 0.5);
    expect(half.saturation).toBeCloseTo((FADING_SATURATION_START + FADING_SATURATION_END) / 2);
    expect(fadeVisual('fading', 5)).toEqual(fadeVisual('fading', 1));
    expect(fadeVisual('fading', -1)).toEqual(fadeVisual('fading', 0));
    expect(fadeVisual('fading', Number.NaN)).toEqual(fadeVisual('fading', 0));
  });
});

describe('fadedFill', () => {
  it('成長段階の濃さと色あせの透明度を掛け合わせる', () => {
    expect(fadedFill('#e8762c', fadeVisual('fresh'), 0.5)).toBe('rgba(232, 118, 44, 0.5)');
    expect(fadedFill('#e8762c', fadeVisual('fading', 0), 0.5)).toMatch(/, 0\.4\)$/);
  });
});
