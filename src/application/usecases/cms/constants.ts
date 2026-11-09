/**
 * @file 店舗CMS の数値ルール（application/usecases/cms 層）
 * すべて（仮）。docs/09 §2.5。
 */

/** 集計の人数・回数がこれ未満なら数値を出さず「少数」と表示する（仮。個人の特定を防ぐ＝docs/09 CMS-D05） */
export const CMS_SMALL_COUNT_THRESHOLD = 5;

/** 来訪データで見せる週の数（今週を含む） */
export const CMS_STATS_WEEKS = 8;

/** 来訪データの集計期間（日） */
export const CMS_STATS_WINDOW_DAYS = 30;
