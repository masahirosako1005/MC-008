import { describe, expect, it } from 'vitest';
import { FALLBACK_COLOR, fadedColor, hexToHsl, hslToRgb, mixColors, parseHexColor, rgbToHex, rgbToHsl, scaleSaturation, toRgba } from '@/Common/ui/canvas/colorUtils';

describe('parseHexColor', () => {
  it('#rrggbb と #rgb を RGB にする', () => {
    expect(parseHexColor('#e8762c')).toEqual({ r: 232, g: 118, b: 44 });
    expect(parseHexColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('形式が不正なら undefined を返す', () => {
    for (const bad of ['e8762c', '#e8762', '#gggggg', '', 'red', '#e8762c00']) expect(parseHexColor(bad)).toBeUndefined();
  });
});

describe('RGB と HSL の相互変換', () => {
  it('往復しても元の色に戻る', () => {
    for (const hex of ['#e8762c', '#7a5ea8', '#2f86c9', '#d9a21b', '#4c9a4a', '#d0566b', '#222222', '#ffffff']) {
      const rgb = parseHexColor(hex);
      if (rgb === undefined) throw new Error('テストの前提が不正');
      expect(rgbToHex(hslToRgb(rgbToHsl(rgb)))).toBe(hex);
    }
  });
  it('グレーは彩度 0', () => {
    expect(hexToHsl('#8a8a8a').s).toBe(0);
  });
  it('不正な色はグレー扱い', () => {
    expect(hexToHsl('xyz')).toEqual(hexToHsl(FALLBACK_COLOR));
  });
});

describe('scaleSaturation', () => {
  it('係数 1 なら元のまま、0 ならグレーになる', () => {
    expect(scaleSaturation('#2f86c9', 1)).toBe('#2f86c9');
    const gray = parseHexColor(scaleSaturation('#2f86c9', 0));
    expect(gray?.r).toBe(gray?.g);
    expect(gray?.g).toBe(gray?.b);
  });
  it('係数を下げると彩度が下がる', () => {
    expect(hexToHsl(scaleSaturation('#d0566b', 0.3)).s).toBeLessThan(hexToHsl('#d0566b').s);
  });
});

describe('toRgba と fadedColor', () => {
  it('透明度を付けた rgba 文字列にする（範囲外は丸める）', () => {
    expect(toRgba('#e8762c', 0.5)).toBe('rgba(232, 118, 44, 0.5)');
    expect(toRgba('#e8762c', 2)).toBe('rgba(232, 118, 44, 1)');
    expect(toRgba('#e8762c', -1)).toBe('rgba(232, 118, 44, 0)');
  });
  it('fadedColor は彩度と透明度を同時に変える', () => {
    expect(fadedColor('#e8762c', 1, 0.8)).toBe('rgba(232, 118, 44, 0.8)');
    expect(fadedColor('#e8762c', 0.1, 0.45)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.45\)$/);
  });
});

describe('mixColors', () => {
  it('t=0 で1色目、t=1 で2色目、t=0.5 で中間になる', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixColors('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
