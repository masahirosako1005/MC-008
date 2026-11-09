/**
 * @file プログラムの誤り（バグ）を検出するアサーション（Common 層）
 * 利用者の入力や外部データの不正は Result で返す。ここは「起こり得ないはず」の検出専用で、例外を投げる（docs/03 §1-5）。
 */

/**
 * switch の網羅漏れを型で検出する。実行時に到達したらバグとして例外を投げる。
 * @param value 到達しないはずの値（型は never）
 * @param message 例外メッセージ（内部用）
 * @returns 戻らない
 * @throws Error 常に投げる
 */
export function assertNever(value: never, message = '想定外の値です'): never {
  throw new Error(`${message}: ${String(value)}`);
}

/**
 * 条件が成り立つことを表明する。成り立たなければバグとして例外を投げる。
 * @param condition 成り立つべき条件
 * @param message 例外メッセージ（内部用。利用者向けではない）
 * @throws Error 条件が偽のとき
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`不変条件違反: ${message}`);
}
