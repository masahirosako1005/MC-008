/**
 * @file 街（地区の成長・色あせ）コンテキストの数値ルール（domain 層）
 * すべて（仮）。docs/08 D3・D5、CLAUDE.md 4.3・4.4。
 */

/** 最終訪問からこの日数で色あせ開始（仮） */
export const FADE_START_DAYS = 30;

/** 最終訪問からこの日数で最も薄くなる（仮） */
export const FADE_MAX_DAYS = 90;

/** 色あせ開始の何日前から「そろそろ」カードを出すか（仮） */
export const FADE_SOON_NOTICE_DAYS = 7;

/** 成長スコア（種類数＋訪問回数）が Lv1 になる値（仮） */
export const GROWTH_LV1_SCORE = 1;

/** 成長スコアが Lv2 になる値（仮） */
export const GROWTH_LV2_SCORE = 5;

/** 成長スコアが Lv3 になる値（仮） */
export const GROWTH_LV3_SCORE = 10;

/** 地区に描く建物の最大数（建物数 = min(score, MAX_BUILDINGS)）（仮） */
export const MAX_BUILDINGS = 12;
