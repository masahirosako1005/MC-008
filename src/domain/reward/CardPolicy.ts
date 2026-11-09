/**
 * @file 銀・金カードの判定（domain/reward 層の純粋関数）
 * 報酬は「網羅」ではなく「通い」に出す（CLAUDE.md 4.6）。訪問回数＝訪問記録の件数（docs/08 D2）。
 * - 銀: 同じ地区に SILVER_CARD_VISITS 回
 * - 金: 同じ地区に GOLD_CARD_VISITS 回、または GOLD_CARD_SEASONS 季節（四季すべて）で訪問
 * 追記専用の訪問記録から毎回導出するので、訪問を足してもカードは減らない（D4、DI-05）。earnedOn は条件を満たした訪問の暦日。
 */
import { createLogger } from '@/Common/logging/logger';
import type { DistrictId } from '@/Common/types/Id';
import { compareLocalDate, seasonOf } from '@/Common/utils/date';
import type { LocalDate, Season } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { visitsInDistrict } from '@/domain/exploration/VisitStats';
import type { CardRank, EarnedCard } from '@/domain/reward/Card';
import { GOLD_CARD_SEASONS, GOLD_CARD_VISITS, SILVER_CARD_VISITS } from '@/domain/reward/constants';
import { sortVisitsChronologically } from '@/domain/reward/VisitChronology';

const logger = createLogger('domain/reward/CardPolicy');

/** 次に狙えるカードと、あと何回の訪問で届くか（スポット詳細・マイ街の「次の目標」用） */
export interface NextCardGoal {
  readonly rank: CardRank;
  /** あと何回の訪問か（1 以上） */
  readonly remainingVisits: number;
}

/**
 * 古い順の訪問記録で、n 回目の訪問の暦日を返す。
 * @param sorted 古い順の訪問記録
 * @param n 何回目か（1 以上）
 * @returns n 回目の暦日。回数が足りなければ undefined
 */
function nthVisitDate(sorted: readonly VisitRecord[], n: number): LocalDate | undefined {
  return n >= 1 ? sorted[n - 1]?.localDate : undefined;
}

/**
 * 古い順の訪問記録で、訪問した季節の数が GOLD_CARD_SEASONS に届いた訪問の暦日を返す。
 * @param sorted 古い順の訪問記録
 * @returns 届いた日。届いていなければ undefined
 */
function seasonsCompletedOn(sorted: readonly VisitRecord[]): LocalDate | undefined {
  const log = logger.fn('seasonsCompletedOn', { count: sorted.length });
  const seasons = new Set<Season>();
  for (const visit of sorted) {
    seasons.add(seasonOf(visit.localDate));
    if (seasons.size >= GOLD_CARD_SEASONS) return log.exit(visit.localDate);
  }
  return log.exit(undefined, `季節 ${seasons.size} 種`);
}

/**
 * 金カードを判定する。回数と四季の両方を満たすときは先に満たした方を理由にする（同じ日なら回数）。
 * @param sorted 地区の訪問記録（古い順）
 * @returns 金カード。まだなら undefined
 */
function goldCardOf(sorted: readonly VisitRecord[]): EarnedCard | undefined {
  const log = logger.fn('goldCardOf', { count: sorted.length });
  const byVisits = nthVisitDate(sorted, GOLD_CARD_VISITS);
  const bySeasons = seasonsCompletedOn(sorted);
  if (byVisits !== undefined && (bySeasons === undefined || compareLocalDate(byVisits, bySeasons) <= 0)) {
    return log.exit(Object.freeze({ rank: 'gold', reason: 'visits', earnedOn: byVisits }));
  }
  if (bySeasons !== undefined) return log.exit(Object.freeze({ rank: 'gold', reason: 'seasons', earnedOn: bySeasons }));
  return log.exit(undefined);
}

/**
 * 地区で獲得済みのカードを返す（銀→金の順。各ランク最大1枚）。
 * @param visits 訪問記録（全地区・順不同でよい）
 * @param districtId 地区ID
 * @returns 獲得済みカード（凍結済み）。無ければ空配列
 */
export function cardsOf(visits: readonly VisitRecord[], districtId: DistrictId): EarnedCard[] {
  const log = logger.fn('cardsOf', { districtId, visits: visits.length });
  const sorted = sortVisitsChronologically(visitsInDistrict(visits, districtId));
  const cards: EarnedCard[] = [];
  const silverOn = nthVisitDate(sorted, SILVER_CARD_VISITS);
  if (silverOn !== undefined) cards.push(Object.freeze({ rank: 'silver', reason: 'visits', earnedOn: silverOn }));
  const gold = goldCardOf(sorted);
  if (gold !== undefined) cards.push(gold);
  log.debug('判定', { visitCount: sorted.length, cards: cards.map((c) => c.rank) });
  return log.exit(cards);
}

/**
 * 地区で次に狙えるカードと残り訪問回数を返す。金は回数（GOLD_CARD_VISITS）で数える。
 * @param visits 訪問記録（全地区でよい）
 * @param districtId 地区ID
 * @returns 次の目標。銀・金とも獲得済みなら undefined
 */
export function nextCardGoal(visits: readonly VisitRecord[], districtId: DistrictId): NextCardGoal | undefined {
  const log = logger.fn('nextCardGoal', { districtId });
  const ranks = new Set(cardsOf(visits, districtId).map((c) => c.rank));
  const visitCount = visitsInDistrict(visits, districtId).length;
  if (!ranks.has('silver')) return log.exit(Object.freeze({ rank: 'silver', remainingVisits: SILVER_CARD_VISITS - visitCount }));
  if (!ranks.has('gold')) return log.exit(Object.freeze({ rank: 'gold', remainingVisits: GOLD_CARD_VISITS - visitCount }));
  return log.exit(undefined, '銀・金とも獲得済み');
}

/**
 * 訪問の前後のカードを比べ、新しく獲得したカードを返す（CardAwarded 発行用）。
 * @param before 訪問前に獲得済みのカード
 * @param after 訪問後に獲得済みのカード
 * @returns after にあって before に無いランクのカード
 */
export function newlyEarnedCards(before: readonly EarnedCard[], after: readonly EarnedCard[]): EarnedCard[] {
  const log = logger.fn('newlyEarnedCards', { before: before.length, after: after.length });
  const had = new Set(before.map((c) => c.rank));
  return log.exit(after.filter((c) => !had.has(c.rank)));
}

/** カード判定をまとめた名前空間（`CardPolicy.cardsOf(...)` と書ける） */
export const CardPolicy = Object.freeze({ cardsOf, nextCardGoal, newlyEarnedCards });
