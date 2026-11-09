/**
 * @file 図鑑・スポット表示で使う数値（application 層）
 * なじみ度は「同じスポットに通うほど図鑑のカードが豪華になる」表示用の段階。報酬は網羅ではなく通いに出す（CLAUDE.md 4.6）。
 * 段階は訪問記録から毎回導出し、保存しない・下がらない（CLAUDE.md 5「失う体験を作らない」）。
 * すべて（仮）。発表後に調整する（CLAUDE.md 14 必須ルール 6）。
 */

/** なじみ度2「なじみ」になる、同じスポットへの訪問回数（仮） */
export const FAMILIAR_VISITS = 3;

/** なじみ度3「常連」になる、同じスポットへの訪問回数（仮） */
export const REGULAR_VISITS = 5;

/** なじみ度の呼び名（1=訪問、2=なじみ、3=常連） */
export const FAMILIARITY_LABELS = { 1: '訪問', 2: 'なじみ', 3: '常連' } as const;
