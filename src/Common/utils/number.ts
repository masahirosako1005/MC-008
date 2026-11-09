/**
 * @file 数値の純粋ユーティリティ（Common 層）
 * 距離・ポイント・スコアは整数で扱う（DI-18）。描画やループで多数回呼ばれる算術ヘルパーなのでログは出さない（docs/04 §2.4-2 の例外）。
 */

/**
 * 有限の数値か判定する型ガード（NaN・Infinity・数値以外を除外）。
 * @param value 判定する値
 * @returns 有限の number なら true
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 0 以上の整数か判定する型ガード（件数・バージョン・ポイントの検証用）。
 * @param value 判定する値
 * @returns 0 以上の安全な整数なら true
 */
export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * 値を [min, max] の範囲に収める。NaN は min として扱う。
 * @param value 元の値
 * @param min 下限
 * @param max 上限（min 以上）
 * @returns 範囲内に収めた値
 */
export function clamp(value: number, min: number, max: number): number {
  return Number.isNaN(value) ? min : Math.min(max, Math.max(min, value));
}

/**
 * 件数・スコアを 0 以上の整数にそろえる（非数・無限大・負数は 0、小数は切り捨て）。
 * 表示や判定で不正値を失敗にせず安全側（0）に寄せるときに使う。成長スコアや取り返し回数が跳ね上がらないようにする（DI-02）。
 * @param value 元の値
 * @returns 0 以上の整数
 */
export function toNonNegativeInt(value: number): number {
  return isFiniteNumber(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * 四捨五入して整数にする（-0 は 0 にそろえる）。距離は m 単位の整数で判定する（DI-18）。
 * @param value 元の値（有限数）
 * @returns 整数
 */
export function roundToInt(value: number): number {
  return Math.round(value) + 0;
}

/**
 * 切り捨てて整数にする（おかえりボーナスの端数切捨てなど＝D6）。
 * @param value 元の値（有限数）
 * @returns 整数
 */
export function floorToInt(value: number): number {
  return Math.floor(value) + 0;
}

/**
 * 常に 0 以上を返す剰余（負数でも周期計算が崩れない。ライバル背景活動の位相計算用）。
 * @param value 割られる数（整数）
 * @param divisor 割る数（1以上の整数）
 * @returns 0 以上 divisor 未満の整数
 */
export function positiveMod(value: number, divisor: number): number {
  return (((value % divisor) + divisor) % divisor) + 0;
}
