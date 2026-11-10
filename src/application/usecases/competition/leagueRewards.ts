/**
 * @file リーグの報酬（順位報酬・キープ報酬）を DTO にする（application 層・GetRankingUseCase の部品）
 * 段・時間の決まりは domain/competition/LeagueReward。景品はすべてアバターの部品（domain/avatar/AvatarCatalog で手に入れ方が league の部品）で、
 * 段・キープ条件の報酬ID から引く（すべて（仮））。1位の称号だけリーグごとに変わるので、タブを切り替えたときにリーグの違いが報酬でも分かる。
 * 景品の主役はこの街ならではのもの（天神祭の催太鼓の投げ頭巾・天神さんの神牛・天満切子・寄席の扇子・梅鉢紋）。メダルなどの記念品はおまけで後ろに並べる。
 * 「次にねらえる報酬まであと何回」もここで求める（ランキングの上で「この順位まではこれがもらえる」を見せて競わせる）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { Instant } from '@/Common/utils/date';
import type { KeepRewardDto, LeagueRewardsDto, NextPrizeDto, RankingEntryDto, RewardPrizeDto, RewardTierDto } from '@/application/dto/Dto';
import { leaguePartsOf } from '@/domain/avatar/AvatarCatalog';
import type { LeagueId } from '@/domain/competition/League';
import { KEEP_GOALS, keepProgressOf, keepRewardIdOf, RANK_REWARD_TIERS, rankRewardIdsOf, rankRewardTierIndexOf } from '@/domain/competition/LeagueReward';
import type { KeepGoal, KeepGoalId, RankRewardTier } from '@/domain/competition/LeagueReward';

const logger = createLogger('application/usecases/competition/leagueRewards');

/** リーグの名前（手に入れ方の文言用） */
const LEAGUE_NAME: Readonly<Record<string, string>> = Object.freeze({ kayoi: 'かよいリーグ', hajimete: 'はじめましてリーグ', rookie: 'ルーキーリーグ' });

/** キープ報酬の見出しと景品の種類 */
const KEEP_COPY: Readonly<Record<KeepGoalId, { readonly goalLabel: string; readonly kind: RewardPrizeDto['kind'] }>> = Object.freeze({
  podium: { goalLabel: '表彰台（3位以内）', kind: 'flag' },
  top: { goalLabel: '1位', kind: 'trophy' },
});

/** どの街でも通じる記念品（メダル・月桂冠・旗・トロフィー）。ご当地の景品を先に見せるため、並びの後ろへ回す */
const KEEPSAKE_PART_IDS: ReadonlySet<string> = new Set(['accessory.medal', 'accessory.silverMedal', 'accessory.bronzeMedal', 'hat.laurel', 'held.cheerFlag', 'object.winnerFlag', 'object.trophy']);

/** 部品が見つからないときの景品（カタログと報酬ID がずれたときの保険） */
const FALLBACK_PRIZE: RewardPrizeDto = Object.freeze({ kind: 'item', name: 'アバターの部品' });

/** 報酬を作る入力 */
export interface LeagueRewardsInput {
  readonly leagueId: LeagueId;
  /** 数値の単位（'回' / 'か所'） */
  readonly unit: string;
  /** あなたの順位（不参加なら undefined） */
  readonly myRank: number | undefined;
  readonly myCount: number;
  /** いま */
  readonly now: Instant;
  /** キープの条件ごとに、条件の順位に入った瞬間を返す（いま条件の順位にいない・不参加なら undefined） */
  readonly heldSinceOf: (goal: KeepGoal) => Instant | undefined;
  /** これまでに手に入れた報酬ID（leagueAwards.earnedLeagueRewardIdsOf） */
  readonly earned: ReadonlySet<string>;
}

/**
 * 段の見出し（'1位' / '4〜5位' / '6位〜'）。
 * @param tier 段
 * @returns 見出し
 */
function tierLabelOf(tier: Pick<RankRewardTier, 'fromRank' | 'toRank'>): string { // audit-ignore: fnlog-missing 段ごとに呼ぶ文字列の組立てだけ（呼び出し側 leagueRewardsOf でログ）
  if (tier.toRank === undefined) return `${tier.fromRank}位〜`;
  return tier.fromRank === tier.toRank ? `${tier.fromRank}位` : `${tier.fromRank}〜${tier.toRank}位`;
}

/**
 * 報酬ID からもらえる景品（アバターの部品）を並べる。
 * @param rewardIds 報酬ID
 * @param kindOf 部品の枠 → 景品の種類（アイコンと色）
 * @param earned 手に入れた報酬ID
 * @returns 景品（凍結済み）
 */
function prizesOf(rewardIds: readonly string[], kindOf: (slot: string) => RewardPrizeDto['kind'], earned: ReadonlySet<string>): readonly RewardPrizeDto[] {
  const log = logger.fn('prizesOf', { rewardIds });
  const prizes = rewardIds.flatMap((rewardId) =>
    leaguePartsOf(rewardId).map((part): RewardPrizeDto => Object.freeze({ kind: kindOf(part.slot), name: part.name, partId: part.id, rarity: part.rarity, owned: earned.has(rewardId) })),
  );
  const local = prizes.filter((p) => p.partId === undefined || !KEEPSAKE_PART_IDS.has(p.partId));
  const keepsakes = prizes.filter((p) => p.partId !== undefined && KEEPSAKE_PART_IDS.has(p.partId));
  return log.exit(Object.freeze([...local.filter((p) => p.kind !== 'title'), ...local.filter((p) => p.kind === 'title'), ...keepsakes]));
}

/**
 * 順位報酬の段の景品の種類を決める（称号は title、メダルの段は金・銀・銅、参加賞は stamp）。
 * @param tier 段
 * @param slot 部品の枠
 * @returns 景品の種類
 */
function tierPrizeKindOf(tier: RankRewardTier, slot: string): RewardPrizeDto['kind'] { // audit-ignore: fnlog-missing 景品ごとに呼ぶ純粋な対応
  if (slot === 'title') return 'title';
  return tier.medal ?? (tier.id === 'entry' ? 'stamp' : 'item');
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
  const found = prizesOf([keepRewardIdOf(goal.id)], () => copy.kind, input.earned);
  const prizes = found.length > 0 ? found : Object.freeze([FALLBACK_PRIZE]);
  return log.exit(Object.freeze({ id: goal.id, goalLabel: copy.goalLabel, hours: goal.hours, prize: prizes[0] ?? FALLBACK_PRIZE, prizes, ...progress }));
}

/**
 * 1リーグの報酬（順位報酬の段と、キープ報酬）を作る。
 * @param input 報酬を作る入力
 * @returns LeagueRewardsDto（凍結済み）
 */
export function leagueRewardsOf(input: LeagueRewardsInput): LeagueRewardsDto {
  const log = logger.fn('leagueRewardsOf', { leagueId: input.leagueId, myRank: input.myRank });
  const mine = rankRewardTierIndexOf(input.myRank, input.myCount);
  const tiers: RewardTierDto[] = RANK_REWARD_TIERS.map((tier, i) =>
    Object.freeze({
      label: tierLabelOf(tier),
      fromRank: tier.fromRank,
      ...(tier.toRank === undefined ? {} : { toRank: tier.toRank }),
      ...(tier.needsEntry ? { condition: `今月1${input.unit}以上` } : {}),
      prizes: prizesOf(rankRewardIdsOf(tier, input.leagueId), (slot) => tierPrizeKindOf(tier, slot), input.earned),
      isMine: i === mine,
    }),
  );
  return log.exit(Object.freeze({ tiers: Object.freeze(tiers), keeps: Object.freeze(KEEP_GOALS.map((goal) => keepRewardOf(goal, input))) }));
}

/**
 * 次にねらえる順位報酬（ひとつ上の段）と、そこに届くまでの数を求める。
 * その段のいちばん下の順位の人に並べば届く（同数は同順位）。まだ参加賞にも届いていなければ、参加賞まであと1。
 * @param rewards リーグの報酬
 * @param entries 順位表（あなたを含む。順位の昇順）
 * @param myCount あなたの数値
 * @returns 次の報酬（不参加・すでに一番上の段なら undefined）
 */
export function nextPrizeOf(rewards: LeagueRewardsDto, entries: readonly Pick<RankingEntryDto, 'isMe' | 'count'>[], myCount: number): NextPrizeDto | undefined {
  const log = logger.fn('nextPrizeOf', { entries: entries.length, myCount });
  if (!entries.some((e) => e.isMe)) return log.exit(undefined, '不参加');
  const mine = rewards.tiers.findIndex((t) => t.isMine);
  if (mine === 0) return log.exit(undefined, '一番上の段');
  const target = rewards.tiers[mine === -1 ? rewards.tiers.length - 1 : mine - 1];
  if (target === undefined) return log.exit(undefined, '段なし');
  const others = entries.filter((e) => !e.isMe);
  const border = target.toRank === undefined ? undefined : others[target.toRank - 1];
  const gap = Math.max(1, (border?.count ?? 0) - myCount);
  return log.exit(Object.freeze({ gap, label: target.label, prizes: target.prizes }));
}

/**
 * 月間リーグの報酬の手に入れ方の文言を作る（アバター画面の「手に入れ方」）。
 * @param rewardId 報酬ID（'rank1' / 'rank1.kayoi' / 'prize' / 'entry' / 'keep.podium' など）
 * @returns 文言
 */
export function leagueRewardHintOf(rewardId: string): string {
  const log = logger.fn('leagueRewardHintOf', { rewardId });
  const goal = KEEP_GOALS.find((g) => keepRewardIdOf(g.id) === rewardId);
  if (goal !== undefined) return log.exit(`ランキングで${KEEP_COPY[goal.id].goalLabel.replace(/（.*）$/, '')}を${goal.hours}時間キープ`);
  const [tierId, leagueId] = rewardId.split('.');
  const tier = RANK_REWARD_TIERS.find((t) => t.id === tierId);
  if (tier === undefined) return log.exit('月間ランキングの報酬');
  const where = leagueId === undefined ? '月間ランキング' : (LEAGUE_NAME[leagueId] ?? '月間ランキング');
  return log.exit(tier.id === 'entry' ? `${where}に参加して月末をむかえる` : `${where}で月末に${tierLabelOf(tier)}`);
}
