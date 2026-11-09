/**
 * @file 銀・金カードの型（domain/reward 層）
 * カードは「通い」に対して出す報酬（CLAUDE.md 4.6）。訪問記録から導出し保存しない（docs/08 D4）。判定は CardPolicy。
 */
import type { LocalDate } from '@/Common/utils/date';

/** カードのランク */
export const CARD_RANKS = ['silver', 'gold'] as const;

/** カードのランク（銀／金） */
export type CardRank = (typeof CARD_RANKS)[number];

/** カードの獲得理由 */
export const CARD_REASONS = ['visits', 'seasons'] as const;

/** カードの獲得理由（訪問回数／四季すべて） */
export type CardReason = (typeof CARD_REASONS)[number];

/** 獲得済みカード（地区ごとに CardPolicy.cardsOf が返す） */
export interface EarnedCard {
  readonly rank: CardRank;
  readonly reason: CardReason;
  /** 条件を満たした訪問の暦日 */
  readonly earnedOn: LocalDate;
}

/**
 * 未検証の値がカードのランクか判定する型ガード。
 * @param value 判定する値
 * @returns 'silver' または 'gold' なら true
 */
export function isCardRank(value: unknown): value is CardRank {
  return value === 'silver' || value === 'gold';
}

/**
 * 未検証の値がカードの獲得理由か判定する型ガード。
 * @param value 判定する値
 * @returns 'visits' または 'seasons' なら true
 */
export function isCardReason(value: unknown): value is CardReason {
  return value === 'visits' || value === 'seasons';
}
