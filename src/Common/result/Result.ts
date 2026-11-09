/**
 * @file 例外に頼らないエラー伝搬のための Result 型（Common 層）
 * 失敗しうる関数は Result<T, AppError> を返し、呼び出し側が `if (!r.ok)` で分岐する（docs/03 §5）。
 * AppError もここから再 export するので `import { ok, fail, AppError } from '@/Common/result/Result'` と書ける。
 */
import { AppError } from '@/Common/result/AppError';

export { AppError };
export type { CommonErrorCode } from '@/Common/result/AppError';

/** 成功側 */
export type Ok<T> = { readonly ok: true; readonly value: T };

/** 失敗側 */
export type Fail<E> = { readonly ok: false; readonly error: E };

/** 成功（value）か失敗（error）のどちらか。判別子は ok */
export type Result<T, E = AppError> = Ok<T> | Fail<E>;

/**
 * 成功の Result を作る。E は never なので、どの Result<T, E> にも代入できる。
 * @param value 成功値（値を持たない成功は ok(undefined) または okVoid()）
 * @returns 成功の Result
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * 値を持たない成功の Result を作る（保存・削除など）。
 * @returns 成功の Result<void>
 */
export function okVoid(): Result<void, never> {
  return { ok: true, value: undefined };
}

/**
 * 失敗の Result を作る。T は never なので、どの Result<T, E> にも代入できる。
 * @param error 失敗内容（通常は AppError.of(...)）
 * @returns 失敗の Result
 */
export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Result が成功か判定する型ガード。
 * @param result 判定する Result
 * @returns 成功なら true（value に安全にアクセスできる）
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Result が失敗か判定する型ガード。
 * @param result 判定する Result
 * @returns 失敗なら true（error に安全にアクセスできる）
 */
export function isFail<T, E>(result: Result<T, E>): result is Fail<E> {
  return !result.ok;
}
