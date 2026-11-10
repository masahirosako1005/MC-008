/**
 * @file 「動きを減らす」設定の判定（Common/ui/a11y 層）
 * OS・ブラウザの prefers-reduced-motion を読む。演出を持つ画面はここを使い、画面ごとに同じ判定を書かない。
 */

/**
 * 利用者が「動きを減らす」を設定しているか（matchMedia が無い環境では false）。
 * @returns 動きを減らすなら true
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
