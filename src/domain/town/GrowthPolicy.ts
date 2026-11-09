/**
 * @file 地区の成長ルール（domain/town 層の純粋関数）
 * 成長スコア = 訪問したスポットの種類数 + 訪問回数（docs/08 D3）。網羅しなくても通えば育つ（CLAUDE.md 4.3）。
 * スコアは追記専用の訪問記録から毎回導出するので、成長は構造的に下がらない（D4・DI-05）。保存しない。
 */
import { createLogger } from '@/Common/logging/logger';
import { toNonNegativeInt } from '@/Common/utils/number';
import { GROWTH_LEVELS } from '@/domain/town/GrowthLevel';
import type { GrowthLevel } from '@/domain/town/GrowthLevel';
import { GROWTH_LV1_SCORE, GROWTH_LV2_SCORE, GROWTH_LV3_SCORE, MAX_BUILDINGS } from '@/domain/town/constants';

export type { GrowthLevel } from '@/domain/town/GrowthLevel';

const logger = createLogger('domain/town/GrowthPolicy');

/** 次の成長段階までの目標（地区カードの「次の目標」） */
export interface GrowthGoal {
  /** 次に到達する成長段階 */
  readonly nextLevel: GrowthLevel;
  /** あと何スコアで到達するか（1以上の整数） */
  readonly remainingScore: number;
}

/** 各成長段階に必要な最小スコア（Lv0 は 0）。値はすべて constants.ts の（仮）定数 */
const MIN_SCORE_BY_LEVEL: Readonly<Record<GrowthLevel, number>> = {
  0: 0,
  1: GROWTH_LV1_SCORE,
  2: GROWTH_LV2_SCORE,
  3: GROWTH_LV3_SCORE,
};

/** 次の成長段階（Lv3 は最上段なので無し） */
const NEXT_LEVEL: Readonly<Record<GrowthLevel, GrowthLevel | undefined>> = { 0: 1, 1: 2, 2: 3, 3: undefined };

/** 高い段階から順に並べた成長段階（levelFor の探索順） */
const LEVELS_DESCENDING: readonly GrowthLevel[] = [...GROWTH_LEVELS].reverse();

/**
 * 成長スコアを計算する（訪問したスポットの種類数 + 訪問回数＝D3）。
 * 種類数と回数の両方で進むので、同じスポットに通い続けても、新しいスポットを開拓しても育つ。
 * @param distinctSpots 地区で訪問したスポットの種類数（0以上の整数。不正値は 0 扱い）
 * @param visitCount 地区の訪問回数＝訪問記録の件数（0以上の整数。不正値は 0 扱い）
 * @returns 成長スコア（0以上の整数）
 */
export function growthScore(distinctSpots: number, visitCount: number): number {
  const log = logger.fn('growthScore', { distinctSpots, visitCount });
  const spots = toNonNegativeInt(distinctSpots);
  const visits = toNonNegativeInt(visitCount);
  if (spots !== distinctSpots || visits !== visitCount) {
    log.warn('不正な件数を 0 以上の整数にそろえた', { distinctSpots, visitCount });
  }
  return log.exit(spots + visits);
}

/**
 * スコアから成長段階を決める（Lv1 ≥ GROWTH_LV1_SCORE、Lv2 ≥ GROWTH_LV2_SCORE、Lv3 ≥ GROWTH_LV3_SCORE）。
 * スコアについて単調（スコアが増えて段階が下がることはない）。
 * @param score 成長スコア（不正値は 0 扱い）
 * @returns 成長段階 0〜3
 */
export function levelFor(score: number): GrowthLevel {
  const log = logger.fn('levelFor', { score });
  const normalized = toNonNegativeInt(score);
  const level = LEVELS_DESCENDING.find((candidate) => normalized >= MIN_SCORE_BY_LEVEL[candidate]);
  return log.exit(level ?? 0);
}

/**
 * 地区に描く建物の数を返す（min(score, MAX_BUILDINGS)）。訪問のたびに建物が増えて見えるようにする（D3）。
 * @param score 成長スコア（不正値は 0 扱い）
 * @returns 建物数（0〜MAX_BUILDINGS の整数）
 */
export function buildingsFor(score: number): number {
  const log = logger.fn('buildingsFor', { score });
  return log.exit(Math.min(toNonNegativeInt(score), MAX_BUILDINGS));
}

/**
 * 次の成長段階と、そこまでに必要な残りスコアを返す（地区カードの「次の目標」）。
 * @param score 成長スコア（不正値は 0 扱い）
 * @returns 次の目標。最上段（Lv3）なら undefined
 */
export function nextGoal(score: number): GrowthGoal | undefined {
  const log = logger.fn('nextGoal', { score });
  const normalized = toNonNegativeInt(score);
  const nextLevel = NEXT_LEVEL[levelFor(normalized)];
  if (nextLevel === undefined) return log.exit(undefined);
  const goal: GrowthGoal = Object.freeze({ nextLevel, remainingScore: MIN_SCORE_BY_LEVEL[nextLevel] - normalized });
  return log.exit(goal);
}

/**
 * 成長ルールをまとめた名前空間（docs/08 の `GrowthPolicy.xxx(...)` 表記で呼べるようにする）。
 * 名前付き import（growthScore など）と同じ関数を指す。
 */
export const GrowthPolicy = Object.freeze({ growthScore, levelFor, buildingsFor, nextGoal });
