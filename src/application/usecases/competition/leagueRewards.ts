/**
 * @file リーグの報酬（順位報酬・キープ報酬）を DTO にする（application 層・GetRankingUseCase の部品）
 * 段・時間の決まりは domain/competition/LeagueReward。ここではリーグごとの景品の名前（すべて（仮））と、いまの順位でどの段に当たるかを詰める。
 * 景品はリーグごとに変える（称号と飾り）ので、タブを切り替えたときにリーグの違いが報酬でも分かる。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Instant } from '@/Common/utils/date';
import type { KeepRewardDto, LeagueRewardsDto, RewardPrizeDto, RewardTierDto } from '@/application/dto/Dto';
import type { LeagueId } from '@/domain/competition/League';
import { KEEP_GOALS, keepProgressOf, RANK_REWARD_TIERS, rankRewardTierIndexOf } from '@/domain/competition/LeagueReward';
import type { KeepGoal, KeepGoalId, Medal, RankRewardTier } from '@/domain/competition/LeagueReward';

const logger = createLogger('application/usecases/competition/leagueRewards');

/** リーグごとの景品の名前（仮） */
interface LeaguePrizeCopy {
  /** 1位の称号（'常連王' → 称号「11月の常連王」） */
  readonly titleWord: string;
  /** 表彰台の飾り（'提灯' → 金の提灯。アバターが手に持てる飾りと同じ種類） */
  readonly prizeItem: string;
}

/** リーグごとの景品（仮） */
const LEAGUE_PRIZE_COPY: Readonly<Record<LeagueId, LeaguePrizeCopy>> = Object.freeze({
  kayoi: { titleWord: '常連王', prizeItem: '提灯' },
  hajimete: { titleWord: '開拓王', prizeItem: 'のぼり' },
  rookie: { titleWord: 'ルーキー王', prizeItem: '松' },
});

/** メダルの名前と、飾りの頭につける言葉 */
const MEDAL_COPY: Readonly<Record<Medal, { readonly medal: string; readonly prefix: string }>> = Object.freeze({
  gold: { medal: '金メダル', prefix: '金の' },
  silver: { medal: '銀メダル', prefix: '銀の' },
  bronze: { medal: '銅メダル', prefix: '銅の' },
});

/** キープ報酬の見出しと景品（仮） */
const KEEP_COPY: Readonly<Record<KeepGoalId, { readonly goalLabel: string; readonly prize: RewardPrizeDto }>> = Object.freeze({
  podium: { goalLabel: '表彰台（3位以内）', prize: { kind: 'flag', name: '表彰台の旗' } },
  top: { goalLabel: '1位', prize: { kind: 'trophy', name: 'トロフィー' } },
});

/** 参加スタンプ */
const ENTRY_STAMP: RewardPrizeDto = Object.freeze({ kind: 'stamp', name: '参加スタンプ' });

/** 報酬を作る入力 */
export interface LeagueRewardsInput {
  readonly leagueId: LeagueId;
  /** '11月' */
  readonly monthLabel: string;
  /** 数値の単位（'回' / 'か所'） */
  readonly unit: string;
  /** あなたの順位（不参加なら undefined） */
  readonly myRank: number | undefined;
  readonly myCount: number;
  /** いま */
  readonly now: Instant;
  /** キープの条件ごとに、条件の順位に入った瞬間を返す（いま条件の順位にいない・不参加なら undefined） */
  readonly heldSinceOf: (goal: KeepGoal) => Instant | undefined;
}

/**
 * 順位報酬の1段の景品を並べる。
 * @param tier 段
 * @param copy リーグの景品の名前
 * @param monthLabel '11月'
 * @returns 景品（凍結済み）
 */
function prizesOf(tier: RankRewardTier, copy: LeaguePrizeCopy, monthLabel: string): readonly RewardPrizeDto[] {
  const log = logger.fn('prizesOf', { fromRank: tier.fromRank, medal: tier.medal });
  if (tier.medal === undefined) return log.exit(Object.freeze([ENTRY_STAMP]));
  const medal = MEDAL_COPY[tier.medal];
  const prizes: RewardPrizeDto[] = [
    { kind: tier.medal, name: medal.medal },
    ...(tier.medal === 'gold' ? [{ kind: 'title' as const, name: `称号「${monthLabel}の${copy.titleWord}」` }] : []),
    { kind: 'item', name: `${medal.prefix}${copy.prizeItem}` },
  ];
  return log.exit(Object.freeze(prizes.map((p) => Object.freeze(p))));
}

/**
 * 段の見出し（'1位' / '4位〜'）。
 * @param tier 段
 * @returns 見出し
 */
function tierLabelOf(tier: RankRewardTier): string { // audit-ignore: fnlog-missing 段ごとに呼ぶ文字列の組立てだけ（呼び出し側 leagueRewardsOf でログ）
  if (tier.toRank === undefined) return `${tier.fromRank}位〜`;
  return tier.fromRank === tier.toRank ? `${tier.fromRank}位` : `${tier.fromRank}〜${tier.toRank}位`;
}

/**
 * キープ報酬1つ分の DTO を作る。
 * @param goal 条件
 * @param input 報酬を作る入力
 * @returns KeepRewardDto（凍結済み）
 */
function keepRewardOf(goal: KeepGoal, input: LeagueRewardsInput): KeepRewardDto {
  const log = logger.fn('keepRewardOf', { leagueId: input.leagueId, goal: goal.id });
  const progress = keepProgressOf(goal, input.myRank === undefined ? undefined : input.heldSinceOf(goal), input.now);
  const copy = KEEP_COPY[goal.id];
  return log.exit(Object.freeze({ id: goal.id, goalLabel: copy.goalLabel, hours: goal.hours, prize: copy.prize, ...progress }));
}

/**
 * 1リーグの報酬（順位報酬の段と、キープ報酬）を作る。
 * @param input 報酬を作る入力
 * @returns LeagueRewardsDto（凍結済み）
 */
export function leagueRewardsOf(input: LeagueRewardsInput): LeagueRewardsDto {
  const log = logger.fn('leagueRewardsOf', { leagueId: input.leagueId, myRank: input.myRank });
  const copy = LEAGUE_PRIZE_COPY[input.leagueId];
  const mine = rankRewardTierIndexOf(input.myRank, input.myCount);
  const tiers: RewardTierDto[] = RANK_REWARD_TIERS.map((tier, i) =>
    Object.freeze({
      label: tierLabelOf(tier),
      ...(tier.needsEntry ? { condition: `今月1${input.unit}以上` } : {}),
      prizes: prizesOf(tier, copy, input.monthLabel),
      isMine: i === mine,
    }),
  );
  return log.exit(Object.freeze({ tiers: Object.freeze(tiers), keeps: Object.freeze(KEEP_GOALS.map((goal) => keepRewardOf(goal, input))) }));
}
