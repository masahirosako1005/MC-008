/**
 * @file 投稿（Posting）コンテキストの数値ルール（domain 層）
 * すべて（仮）。docs/08 §3.8、docs/06 DI-17。文字数は Unicode コードポイント単位で数える（絵文字1つ＝1文字）。
 */

/** 投稿本文の最小文字数（正規化・前後空白除去の後）（仮） */
export const POST_TEXT_MIN_LENGTH = 1;

/** 投稿本文の最大文字数（正規化・前後空白除去の後）（仮） */
export const POST_TEXT_MAX_LENGTH = 200;

/** 正規化の前に受け付ける最大長（UTF-16 単位）。巨大な入力を処理する前に拒否する（仮） */
export const POST_TEXT_MAX_RAW_LENGTH = 2000;
