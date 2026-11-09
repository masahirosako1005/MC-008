import { describe, expect, it } from 'vitest';
import { factorOf, isTextScale, TEXT_SCALES, textScaleFactor } from '@/Common/ui/a11y/textScale';

describe('factorOf', () => {
  it('標準 1・大 1.125・特大 1.25 を返す（ルートフォント 16/18/20px に対応）', () => {
    expect(factorOf('normal')).toBe(1);
    expect(factorOf('large')).toBe(1.125);
    expect(factorOf('xlarge')).toBe(1.25);
    expect(TEXT_SCALES.map((s) => factorOf(s) * 16)).toEqual([16, 18, 20]);
  });
});

describe('isTextScale', () => {
  it('設定値だけを受け付ける', () => {
    expect(isTextScale('large')).toBe(true);
    for (const bad of ['huge', '', 1, null, undefined]) expect(isTextScale(bad)).toBe(false);
  });
});

describe('textScaleFactor', () => {
  it('document が無い環境では標準（1）を返す', () => {
    expect(textScaleFactor()).toBe(1);
  });
});
