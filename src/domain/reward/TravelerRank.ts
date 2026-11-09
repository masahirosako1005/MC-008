/**
 * @file 旅人ランクの判定（domain/reward 層の純粋関数）
 * 累計ポイント（台帳の残高）で RANK_THRESHOLDS の段を決める（docs/08 D11）。おかえりボーナスもランクに効く。
 * 残高は減らないので、ランクも下がらない（CLAUDE.md 5「失う体験を作らない」）。
 */
import { createLogger } from '@/Common/logging/logger';
import { isFiniteNumber } from '@/Common/utils/number';
import { RANK_THRESHOLDS } from '@/domain/reward/constants';

const logger = createLogger('domain/reward/TravelerRank');

/** 旅人ランク（マイ街の表示用） */
export interface TravelerRank {
  /** ランク名（例: '常連'） */
  readonly name: string;
  /** RANK_THRESHOLDS の添字（0 が最初の段） */
  readonly index: number;
  /** 次の段に必要な累計ポイント。最上位なら省略 */
  readonly nextAt?: number;
  /** 次の段まであと何ポイントか（1 以上）。最上位なら省略 */
  readonly remaining?: number;
}

/**
 * 判定に使うポイントへ正規化する。非数・負値は 0、小数は切り捨て（表示用の判定なので失敗にせず最下段に寄せる）。
 * @param points 累計ポイント（未検証の数値）
 * @returns 0 以上の整数
 */
function normalizePoints(points: number): number {
  const log = logger.fn('normalizePoints', { points });
  if (!isFiniteNumber(points) || points < 0) return log.fail(0, '不正なポイント。0 として判定');
  return log.exit(Math.floor(points));
}

/**
 * 累計ポイントから旅人ランクを返す。閾値ちょうどで次の段に上がる（例: 50 → '旅人'、49 → 'はじめての旅人'）。
 * @param points 累計ポイント（台帳の残高。非数・負値は 0、小数は切り捨てとして扱う）
 * @returns ランク名・段の添字・次の段の閾値・残りポイント
 */
export function rankOf(points: number): TravelerRank {
  const log = logger.fn('rankOf', { points });
  const value = normalizePoints(points);
  let index = 0;
  RANK_THRESHOLDS.forEach((threshold, i) => {
    if (value >= threshold.min) index = i;
  });
  const current = RANK_THRESHOLDS[index];
  const next = RANK_THRESHOLDS[index + 1];
  const name = current?.name ?? '';
  if (next === undefined) return log.exit(Object.freeze({ name, index }));
  return log.exit(Object.freeze({ name, index, nextAt: next.min, remaining: next.min - value }));
}

/** ランク判定の名前空間（`TravelerRank.rankOf(...)` と書ける） */
export const TravelerRank = Object.freeze({ rankOf });
