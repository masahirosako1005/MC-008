/**
 * @file 店舗CMS の数値ルール（application/usecases/cms 層）
 * すべて（仮）。docs/09 §2.5。
 */

/** 集計の人数・回数がこれ未満なら数値を出さず「少数」と表示する（仮。個人の特定を防ぐ＝docs/09 CMS-D05） */
export const CMS_SMALL_COUNT_THRESHOLD = 5;

/** 来訪データで見せる週の数（今週を含む） */
export const CMS_STATS_WEEKS = 8;

/** アンケートの集計期間（日。仮） */
export const CMS_SURVEY_WINDOW_DAYS = 30;

/** 曜日・時間帯ごとの満足度の平均を出すのに要る回答の数（仮。少ないと1件で大きく振れる） */
export const CMS_SURVEY_SLOT_MIN = 3;

/** 満足度の変化（直近14日とその前の14日）を比べる期間（日。仮） */
export const CMS_SURVEY_TREND_DAYS = 14;

/** アンケートの画面に出すひとことの数（新しい順。仮） */
export const CMS_SURVEY_COMMENT_LIMIT = 8;
