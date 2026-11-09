/**
 * @file 探索の読取系ユースケースが使う表示用の数値（application 層）
 * 業務ルール（80m／40m など）は domain の constants.ts にある。ここは「近隣リストに何件・どこまで出すか」などの表示側の値。
 * すべて（仮）。発表後に調整する（CLAUDE.md 14 必須ルール 6）。
 */

/** 近隣スポットの既定件数（下シート「半分」に並べる件数）（仮） */
export const NEARBY_DEFAULT_LIMIT = 8;

/** 近隣スポットとして一度に返せる最大件数（入力の上限）（仮） */
export const NEARBY_MAX_LIMIT = 50;

/** 未発見スポットを「名前なしの？」として近隣リストに出す半径（メートル）。発見の半径より少し外まで見せて興味を引く＝B（仮） */
export const NEARBY_UNKNOWN_RADIUS_M = 120;

/** スポット詳細に出す自分の訪問履歴の最大件数（新しい順）（仮） */
export const SPOT_HISTORY_MAX = 10;
