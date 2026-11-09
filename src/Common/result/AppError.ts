/**
 * @file アプリ共通のエラー値（Common 層）
 * 失敗は例外ではなく Result の error 側にこの値を入れて返す（docs/03 §5）。
 * message は利用者向けの日本語。スタック・生データ・座標などの内部情報を入れない（OWASP A10）。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('Common/result/AppError');

/** アプリ共通の失敗コード（docs/08 §4.1）。各コンテキストは必要に応じて独自コードを足してよい */
export type CommonErrorCode =
  | 'INVALID_INPUT'
  | 'SPOT_NOT_FOUND'
  | 'DISTRICT_NOT_FOUND'
  | 'TRAVELER_NOT_FOUND'
  | 'GEO_UNAVAILABLE'
  | 'GEO_DENIED'
  | 'OUT_OF_RANGE'
  | 'LOW_ACCURACY'
  | 'ALREADY_VISITED_TODAY'
  | 'CONFLICT'
  | 'STORAGE_FAILED'
  | 'DEMO_DISABLED'
  | 'EXPIRED'
  | 'ALREADY_REDEEMED'
  | 'NOT_COUPON';

/** 失敗を表す値。code は機械可読、message は利用者向け日本語 */
export interface AppError<C extends string = string> {
  readonly code: C;
  readonly message: string;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** AppError のファクトリと判定関数（interface と同名の値。`AppError.of(...)` と書ける） */
export const AppError = {
  /**
   * AppError を作る。不要な項目（details / cause）は省き、凍結して返す。
   * docs/08 §2 の契約どおり引数は4つ（03 §3 の「3つまで」の例外。呼び出し箇所が多く簡潔さを優先）。
   * @param code 機械可読な失敗コード（例: 'OUT_OF_RANGE'）
   * @param message 利用者向けの日本語メッセージ（内部情報を含めない）
   * @param details 画面で使う補足値（距離など。座標・トークンは入れない）
   * @param cause 元になった例外など（ログ用。画面に出さない）
   * @returns 凍結済みの AppError
   */
  of<C extends string>(code: C, message: string, details?: Readonly<Record<string, unknown>>, cause?: unknown): AppError<C> {
    const log = logger.fn('of', { code });
    const base: { code: C; message: string; details?: Readonly<Record<string, unknown>>; cause?: unknown } = { code, message };
    if (details !== undefined) base.details = Object.freeze({ ...details });
    if (cause !== undefined) base.cause = cause;
    return log.exit(Object.freeze(base));
  },

  /**
   * 任意の値が AppError の形（code と message が文字列）をしているか判定する。
   * 境界（例外ハンドラ・保存データ）で受け取った値を安全に扱うために使う。
   * @param value 判定する値
   * @returns AppError の形なら true
   */
  isAppError(value: unknown): value is AppError {
    const log = logger.fn('isAppError');
    if (typeof value !== 'object' || value === null) return log.exit(false);
    const candidate = value as { code?: unknown; message?: unknown };
    return log.exit(typeof candidate.code === 'string' && typeof candidate.message === 'string');
  },
};
