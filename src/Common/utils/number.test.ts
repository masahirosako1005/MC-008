import { describe, expect, it } from 'vitest';
import { clamp, floorToInt, isFiniteNumber, isNonNegativeInteger, positiveMod, roundToInt, toNonNegativeInt } from '@/Common/utils/number';

describe('number utils', () => {
  it('clamp は範囲に収め、NaN は下限', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });
  it('roundToInt / floorToInt は -0 を 0 にそろえる', () => {
    expect(roundToInt(40.5)).toBe(41);
    expect(roundToInt(40.4)).toBe(40);
    expect(Object.is(roundToInt(-0.2), 0)).toBe(true);
    expect(floorToInt(22.5)).toBe(22);
  });
  it('positiveMod は負数でも 0 以上', () => {
    expect(positiveMod(-1, 7)).toBe(6);
    expect(positiveMod(7, 7)).toBe(0);
    expect(positiveMod(20_766 + 4, 7)).toBe(1);
  });
  it('型ガード', () => {
    expect(isFiniteNumber(1)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber('1')).toBe(false);
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
  });
});

describe('toNonNegativeInt（件数・スコアの正規化。GrowthPolicy・RevisitReasonPolicy で共用）', () => {
  it('0 以上の整数はそのまま、小数は切り捨て', () => {
    expect(toNonNegativeInt(0)).toBe(0);
    expect(toNonNegativeInt(7)).toBe(7);
    expect(toNonNegativeInt(5.7)).toBe(5);
    expect(toNonNegativeInt(0.9)).toBe(0);
  });
  it('負数・NaN・無限大は 0（-0 も 0）', () => {
    for (const bad of [-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(toNonNegativeInt(bad)).toBe(0);
    expect(Object.is(toNonNegativeInt(-0), 0)).toBe(true);
  });
});
