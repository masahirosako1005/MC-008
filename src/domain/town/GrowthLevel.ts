/**
 * @file 地区の成長段階（Lv0〜3）の型（domain/town 層）
 * Lv0 輪郭のみ → Lv1 色づく → Lv2 建物が増える → Lv3 名所に装飾（CLAUDE.md 4.3）。
 * 成長は下がらない。訪問記録から導出するだけで保存しない（docs/08 D4）。算出ルールは GrowthPolicy。
 */

/** 成長段階 */
export type GrowthLevel = 0 | 1 | 2 | 3;

/** 成長段階の一覧（低い順） */
export const GROWTH_LEVELS: readonly GrowthLevel[] = [0, 1, 2, 3];

/**
 * 未検証の値が成長段階か判定する型ガード。
 * @param value 判定する値
 * @returns 0〜3 の整数なら true
 */
export function isGrowthLevel(value: unknown): value is GrowthLevel {
  return value === 0 || value === 1 || value === 2 || value === 3;
}
