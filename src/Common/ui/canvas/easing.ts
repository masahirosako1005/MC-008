/**
 * @file アニメーションの進み具合の算術（Common/ui/canvas 層。純粋関数）
 * 演出・地図・起動画面・ランクなど、毎フレーム描画する側が共通で使う。画面ごとに同じ関数を書かない（ここへ足す）。
 * 毎フレーム呼ぶ小さな算術なので関数ログは出さない。
 */

/** easeOutBack の行き過ぎの強さの既定値（一般的な値） */
export const EASE_BACK_OVERSHOOT = 1.70158;

/**
 * 値を 0〜1 に丸める（NaN・無限大は 0）。
 * @param t 値
 * @returns 0〜1
 */
export function clamp01(t: number): number {
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}

/**
 * 線形補間。
 * @param a 始点
 * @param b 終点
 * @param t 0〜1（範囲外は丸める）
 * @returns a + (b − a)·t
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/**
 * 減速するイージング（3次）。
 * @param t 0〜1（範囲外は丸める）
 * @returns 0〜1
 */
export function easeOutCubic(t: number): number {
  return 1 - (1 - clamp01(t)) ** 3;
}

/**
 * 少し行き過ぎて戻るイージング（「ぽん」と出る動き）。
 * @param t 0〜1（範囲外は丸める）
 * @param overshoot 行き過ぎの強さ（大きいほど強くはねる）
 * @returns 0 から始まり 1 で終わる値（途中で 1 を少し超える）
 */
export function easeOutBack(t: number, overshoot: number = EASE_BACK_OVERSHOOT): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const x = clamp01(t) - 1;
  return 1 + (overshoot + 1) * x ** 3 + overshoot * x ** 2;
}
