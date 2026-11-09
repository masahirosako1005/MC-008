import { describe, expect, it } from 'vitest';
import { Points } from '@/domain/reward/Points';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

describe('Points.of（0 以上の整数のみ）', () => {
  it('0 と正の整数を受け付ける', () => {
    expect(must(Points.of(0))).toBe(0);
    expect(must(Points.of(15))).toBe(15);
    expect(must(Points.of(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('-0 は 0 にそろえる', () => {
    expect(Object.is(must(Points.of(-0)), 0)).toBe(true);
  });

  it.each([
    ['負数', -1, 'negative'],
    ['小数', 1.5, 'notInteger'],
    ['負の小数', -0.5, 'negative'],
    ['NaN', Number.NaN, 'notNumber'],
    ['Infinity', Number.POSITIVE_INFINITY, 'notNumber'],
    ['安全な整数を超える', Number.MAX_SAFE_INTEGER + 1, 'tooLarge'],
  ])('%s は INVALID_INPUT で拒否する', (_label, raw, reason) => {
    const r = Points.of(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_INPUT');
      expect(r.error.details?.['reason']).toBe(reason);
    }
  });

  it.each([['文字列', '10'], ['null', null], ['undefined', undefined], ['オブジェクト', { value: 1 }]])(
    '数値でない値（%s）は拒否する',
    (_label, raw) => {
      expect(Points.of(raw).ok).toBe(false);
    },
  );
});

describe('Points.add', () => {
  it('2つのポイントを足す', () => {
    expect(must(Points.add(must(Points.of(10)), must(Points.of(15))))).toBe(25);
    expect(must(Points.add(Points.ZERO, Points.ZERO))).toBe(0);
  });

  it('安全な整数の範囲を超える合計は失敗にする（黙って丸めない）', () => {
    const r = Points.add(must(Points.of(Number.MAX_SAFE_INTEGER)), must(Points.of(1)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
  });
});
