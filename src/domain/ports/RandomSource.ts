/**
 * @file 乱数ポート（domain/ports 層）
 * domain は Math.random を使わずこの IF 経由で乱数を得る。実装: infrastructure/random の CryptoRandomSource / SeededRandomSource。
 */

/** 乱数の供給元 */
export interface RandomSource {
  /** [0, 1) の一様乱数 */
  next(): number;
}
