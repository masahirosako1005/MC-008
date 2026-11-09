/**
 * @file 探索コンテキストの数値ルール（domain 層）
 * すべて（仮）。発表後に調整する（CLAUDE.md 4.2・12、docs/01 §3-9）。
 */

/** 発見の半径（メートル）。この距離以内に入ると図鑑にシルエット登録（仮） */
export const DISCOVERY_RADIUS_M = 80;

/** 訪問の半径（メートル）。この距離以内で訪問操作が成立（仮）。GPS 誤差を見込んだ値（CLAUDE.md 10） */
export const VISIT_RADIUS_M = 40;

/** 訪問を受け付ける位置精度の上限（メートル）。これより粗い測位では訪問不可（DI-14）（仮） */
export const MAX_ACCURACY_M = 100;

/** 徒歩想定の最大移動速度（km/h）。これを超える移動は不自然として保留（DI-14、本番 GPS のみ）（仮） */
export const MAX_PLAUSIBLE_SPEED_KMH = 30;

/** 冪等性のために保持する処理済み操作ID の最大件数。古いものから捨てる（DI-07）（仮） */
export const MAX_PROCESSED_OPERATION_IDS = 500;

/** 旅人のニックネームの最大文字数（コードポイント数）（仮） */
export const MAX_NICKNAME_LENGTH = 20;

/** ニックネームが空のときの既定名（仮） */
export const DEFAULT_NICKNAME = '旅人';
