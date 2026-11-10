/**
 * @file 地区の成長段階（Lv0〜3）の型（domain/town 層）
 * Lv0 輪郭のみ → Lv1 色づく → Lv2 建物が増える → Lv3 名所に装飾（CLAUDE.md 4.3）。
 * 成長は下がらない。訪問記録から導出するだけで保存しない（docs/08 D4）。算出ルールは GrowthPolicy。
 */

/** 成長段階 */
export type GrowthLevel = 0 | 1 | 2 | 3;

/** 成長段階の一覧（低い順） */
export const GROWTH_LEVELS: readonly GrowthLevel[] = [0, 1, 2, 3];
