import { describe, expect, it } from 'vitest';
import { AppError, fail, isFail, isOk, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

/** テスト用: 正の数だけ受け付ける */
function positive(n: number): Result<number, AppError<'NOT_POSITIVE'>> {
  return n > 0 ? ok(n) : fail(AppError.of('NOT_POSITIVE', '正の数ではありません', { n }));
}

describe('Result', () => {
  it('ok は値を持ち、ok=true で判別できる', () => {
    const r = positive(3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(3);
    expect(isOk(r)).toBe(true);
    expect(isFail(r)).toBe(false);
  });
  it('fail はエラーを持ち、ok=false で判別できる', () => {
    const r = positive(0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_POSITIVE');
      expect(r.error.details).toEqual({ n: 0 });
    }
    expect(isFail(r)).toBe(true);
  });
  it('okVoid は値を持たない成功', () => {
    const r: Result<void> = okVoid();
    expect(r.ok).toBe(true);
  });
});

describe('AppError', () => {
  it('of は不要な項目を省き、凍結して返す', () => {
    const e = AppError.of('OUT_OF_RANGE', '離れています');
    expect(e).toEqual({ code: 'OUT_OF_RANGE', message: '離れています' });
    expect('details' in e).toBe(false);
    expect('cause' in e).toBe(false);
    expect(Object.isFrozen(e)).toBe(true);
  });
  it('details と cause を保持する', () => {
    const cause = new Error('内部');
    const e = AppError.of('STORAGE_FAILED', '保存できませんでした', { key: 'x' }, cause);
    expect(e.details).toEqual({ key: 'x' });
    expect(e.cause).toBe(cause);
  });
  it('isAppError は形で判定する', () => {
    expect(AppError.isAppError(AppError.of('X_Y', 'm'))).toBe(true);
    expect(AppError.isAppError({ code: 1, message: 'm' })).toBe(false);
    expect(AppError.isAppError(null)).toBe(false);
    expect(AppError.isAppError('X')).toBe(false);
  });
});
