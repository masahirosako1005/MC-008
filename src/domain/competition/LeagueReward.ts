/**
 * @file 月間リーグの報酬の決まり（domain/competition 層）
 * - 順位報酬: 月末（締め）の順位で決まる。1〜3位にメダル、4〜5位は入賞、6位以下は今月1回以上の参加で参加賞
 * - キープ報酬: ある順位以内を決まった時間続けて保つと、その場でもらえる（例: 表彰台を24時間キープ）
 * 報酬はすべてアバターの部品（メダル・称号・月桂冠・旗・トロフィーなど。domain/avatar/AvatarCatalog で手に入れ方が league の部品）。
 * 段・キープ条件ごとの「報酬ID」で部品と結びつける（ポイントは順位に関係しない＝D10。店舗協力の優待は含めない＝CLAUDE.md 4.6）。
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

/** 順位報酬の段の ID（報酬ID の元。1位だけはリーグごとの報酬 'rank1.<リーグ>' も付く） */
export type RankTierId = 'rank1' | 'rank2' | 'rank3' | 'prize' | 'entry';

/** 順位報酬の段 */
export interface RankRewardTier {
  readonly id: RankTierId;
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
  { id: 'rank1', fromRank: 1, toRank: 1, medal: 'gold', needsEntry: false },
  { id: 'rank2', fromRank: 2, toRank: 2, medal: 'silver', needsEntry: false },
  { id: 'rank3', fromRank: 3, toRank: 3, medal: 'bronze', needsEntry: false },
  { id: 'prize', fromRank: 4, toRank: 5, needsEntry: true },
  { id: 'entry', fromRank: 6, needsEntry: true },
]);

/**
 * 順位報酬の段でもらえる報酬ID を返す（1位はリーグ共通の 'rank1' とリーグごとの 'rank1.<リーグ>'）。
 * @param tier 段
 * @param leagueId リーグ
 * @returns 報酬ID
 */
export function rankRewardIdsOf(tier: RankRewardTier, leagueId: string): readonly string[] { // audit-ignore: fnlog-missing 段ごとに呼ぶ純粋な対応
  return tier.id === 'rank1' ? [tier.id, `${tier.id}.${leagueId}`] : [tier.id];
}

/**
 * キープ報酬の報酬ID を返す。
 * @param goalId キープ報酬の種類
 * @returns 報酬ID（'keep.podium' / 'keep.top'）
 */
export function keepRewardIdOf(goalId: KeepGoalId): string { // audit-ignore: fnlog-missing 純粋な文字列の組立て
  return `keep.${goalId}`;
}

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
