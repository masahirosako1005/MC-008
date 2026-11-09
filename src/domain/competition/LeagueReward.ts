/**
 * @file 月間リーグの報酬の決まり（domain/competition 層）
 * - 順位報酬: 月末（締め）の順位で決まる。表彰台の3名にメダル、4位以下は今月1回以上の参加で参加スタンプ
 * - キープ報酬: ある順位以内を決まった時間続けて保つと、その場でもらえる（例: 表彰台を24時間キープ）
 * 報酬はメダル・称号・アバターと自分の街を飾るアイテムだけ（ポイントは順位に関係しない＝D10。店舗協力の優待は含めない＝CLAUDE.md 4.6）。
 * 段・時間はすべて（仮）。
 */
import { createLogger } from '@/Common/logging/logger';
import { epochMsOf } from '@/Common/utils/date';
import type { Instant } from '@/Common/utils/date';

const logger = createLogger('domain/competition/LeagueReward');

/** 1時間（ミリ秒） */
const MS_PER_HOUR = 3_600_000;

/** メダルの種類 */
export type Medal = 'gold' | 'silver' | 'bronze';

/** 順位報酬の段 */
export interface RankRewardTier {
  /** この段の最上位 */
  readonly fromRank: number;
  /** この段の最下位（undefined なら下限なし） */
  readonly toRank?: number;
  /** メダル（表彰台の段のみ） */
  readonly medal?: Medal;
  /** 今月1回以上の参加が条件か（参加スタンプの段） */
  readonly needsEntry: boolean;
}

/** 順位報酬の段（上から順）（仮） */
export const RANK_REWARD_TIERS: readonly RankRewardTier[] = Object.freeze([
  { fromRank: 1, toRank: 1, medal: 'gold', needsEntry: false },
  { fromRank: 2, toRank: 2, medal: 'silver', needsEntry: false },
  { fromRank: 3, toRank: 3, medal: 'bronze', needsEntry: false },
  { fromRank: 4, needsEntry: true },
]);

/** キープ報酬の種類 */
export type KeepGoalId = 'podium' | 'top';

/** キープ報酬の条件（maxRank 位以内を hours 時間続けて保つ） */
export interface KeepGoal {
  readonly id: KeepGoalId;
  readonly maxRank: number;
  readonly hours: number;
}

/** キープ報酬の条件（やさしい順）（仮） */
export const KEEP_GOALS: readonly KeepGoal[] = Object.freeze([
  { id: 'podium', maxRank: 3, hours: 24 },
  { id: 'top', maxRank: 1, hours: 72 },
]);

/**
 * 順位と数値から、いまもらえる順位報酬の段を返す。
 * @param rank 順位（不参加なら undefined）
 * @param count 今月の数値（回・か所）
 * @returns 段の番号（RANK_REWARD_TIERS の添字）。該当しなければ -1
 */
export function rankRewardTierIndexOf(rank: number | undefined, count: number): number {
  const log = logger.fn('rankRewardTierIndexOf', { rank, count });
  if (rank === undefined) return log.exit(-1, '不参加');
  return log.exit(RANK_REWARD_TIERS.findIndex((t) => rank >= t.fromRank && (t.toRank === undefined || rank <= t.toRank) && (!t.needsEntry || count > 0)));
}

/** キープの進み具合 */
export interface KeepProgress {
  /** achieved: 獲得済み／keeping: キープ中／not-yet: まだ条件の順位にいない */
  readonly state: 'achieved' | 'keeping' | 'not-yet';
  /** 続けて保っている時間（時間。切り捨て。条件の時間で頭打ち） */
  readonly heldHours: number;
  /** 獲得まであと何時間（切り上げ。獲得済み・まだなら 0／条件の時間） */
  readonly remainingHours: number;
}

/**
 * キープの進み具合を返す。
 * @param goal 条件
 * @param heldSince 条件の順位に入った瞬間（いま条件の順位にいなければ undefined）
 * @param now いま
 * @returns 進み具合
 */
export function keepProgressOf(goal: KeepGoal, heldSince: Instant | undefined, now: Instant): KeepProgress {
  const log = logger.fn('keepProgressOf', { goal: goal.id, heldSince, now });
  if (heldSince === undefined) return log.exit({ state: 'not-yet', heldHours: 0, remainingHours: goal.hours });
  const goalMs = goal.hours * MS_PER_HOUR;
  const heldMs = Math.max(0, epochMsOf(now) - epochMsOf(heldSince));
  if (heldMs >= goalMs) return log.exit({ state: 'achieved', heldHours: goal.hours, remainingHours: 0 });
  return log.exit({ state: 'keeping', heldHours: Math.floor(heldMs / MS_PER_HOUR), remainingHours: Math.max(1, Math.ceil((goalMs - heldMs) / MS_PER_HOUR)) });
}
