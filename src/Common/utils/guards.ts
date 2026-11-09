/**
 * @file 境界検証用の型ガード（Common 層）
 * JSON・保存データなど unknown な値を domain 型へ変換する前の形チェックに使う（DI-01）。
 */

/**
 * 配列ではないオブジェクト（JSON のオブジェクト）か判定する型ガード。
 * @param value 判定する値
 * @returns プレーンなオブジェクトなら true
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 空でない文字列か判定する型ガード（空白だけの文字列も除外）。
 * @param value 判定する値
 * @returns 空でない文字列なら true
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 制御文字（C0/C1・CR/LF）を含むか判定する。表示名などの検証用（DI-17）。
 * @param text 判定する文字列
 * @returns 制御文字を含めば true
 */
export function hasControlChars(text: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/.test(text);
}

/**
 * 文字数を Unicode コードポイント単位で数える（絵文字を1文字と数える。DI-17）。
 * @param text 文字列
 * @returns コードポイント数
 */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}
