/**
 * @file 報酬コンテキストの数値ルール（domain 層）
 * すべて（仮）。docs/08 D6・D11、CLAUDE.md 4.4・4.6。
 */

/** 名所の訪問ポイント（仮） */
export const VISIT_POINTS_LANDMARK = 10;

/** 店舗の訪問ポイント（店舗回遊を促すため名所より多い）（仮） */
export const VISIT_POINTS_SHOP = 15;

/** おかえりボーナスの倍率（当日その地区の基本点×1.5、端数切捨て）（仮） */
export const WELCOME_BACK_MULTIPLIER = 1.5;

/** 銀カード: 同じ地区への訪問回数（仮） */
export const SILVER_CARD_VISITS = 3;

/** 金カード: 同じ地区への訪問回数（仮） */
export const GOLD_CARD_VISITS = 10;

/** 金カード: 同じ地区を訪問した季節の数（四季すべて）（仮） */
export const GOLD_CARD_SEASONS = 4;

/** 旅人ランクの閾値（累計ポイント。min 昇順）（仮） */
export const RANK_THRESHOLDS: readonly { readonly min: number; readonly name: string }[] = [
  { min: 0, name: 'はじめての旅人' },
  { min: 50, name: '旅人' },
  { min: 150, name: '常連' },
  { min: 400, name: '顔なじみ' },
  { min: 800, name: '街の名士' },
];

/** アイテム「のぼり」: 訪問した異なる店舗の数（docs/08 D16）（仮） */
export const NOBORI_DISTINCT_SHOPS = 3;

/** アイテム「松」: 名所を訪問した異なる地区の数（docs/08 D16）（仮） */
export const MATSU_LANDMARK_DISTRICTS = 3;
