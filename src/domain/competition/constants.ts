/**
 * @file 競争（地区の主・ランキング）コンテキストの数値ルール（domain 層）
 * すべて（仮）。docs/08 D7、CLAUDE.md 4.6。
 */

/** 地区の主を決める集計期間（今日を含む直近の暦日数）（仮） */
export const LORD_WINDOW_DAYS = 30;

/** ルーキーリーグに参加できる期間（使いはじめた日を含む暦日数）（仮） */
export const ROOKIE_PERIOD_DAYS = 30;
