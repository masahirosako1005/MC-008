import { describe, expect, it } from 'vitest';
import { jstInstantOf } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { KEEP_GOALS, keepProgressOf, keepRewardIdOf, RANK_REWARD_TIERS, rankRewardIdsOf, rankRewardTierIndexOf } from '@/domain/competition/LeagueReward';

const DAY = '2026-11-09' as LocalDate;
const PODIUM = KEEP_GOALS[0]!;

describe('rankRewardTierIndexOf', () => {
  it('1〜3位はメダルの段、4〜5位は入賞の段、6位以下は今月1回以上の参加で参加賞の段', () => {
    expect([1, 2, 3].map((rank) => RANK_REWARD_TIERS[rankRewardTierIndexOf(rank, 5)]?.medal)).toEqual(['gold', 'silver', 'bronze']);
    expect([4, 5].map((rank) => RANK_REWARD_TIERS[rankRewardTierIndexOf(rank, 3)]?.id)).toEqual(['prize', 'prize']);
    expect(RANK_REWARD_TIERS[rankRewardTierIndexOf(7, 3)]?.id).toBe('entry');
    expect(rankRewardTierIndexOf(11, 0)).toBe(-1);
    expect(rankRewardTierIndexOf(undefined, 4)).toBe(-1);
  });

  it('報酬ID: 1位はリーグ共通とリーグごとの2つ、ほかの段は1つ。キープ報酬は keep.<種類>', () => {
    expect(RANK_REWARD_TIERS.map((tier) => rankRewardIdsOf(tier, 'kayoi'))).toEqual([['rank1', 'rank1.kayoi'], ['rank2'], ['rank3'], ['prize'], ['entry']]);
    expect(KEEP_GOALS.map((goal) => keepRewardIdOf(goal.id))).toEqual(['keep.podium', 'keep.top']);
  });
});

describe('keepProgressOf', () => {
  it('条件の順位にいなければ「まだ」で、残りは条件の時間', () => {
    expect(keepProgressOf(PODIUM, undefined, jstInstantOf(DAY, 10))).toEqual({ state: 'not-yet', heldHours: 0, remainingHours: 24 });
  });

  it('入ってから18時間ならキープ中・あと6時間。端数の残りは切り上げ', () => {
    expect(keepProgressOf(PODIUM, jstInstantOf(DAY, 0), jstInstantOf(DAY, 18))).toEqual({ state: 'keeping', heldHours: 18, remainingHours: 6 });
    expect(keepProgressOf(PODIUM, jstInstantOf(DAY, 10), jstInstantOf(DAY, 10, 30))).toEqual({ state: 'keeping', heldHours: 0, remainingHours: 24 });
  });

  it('条件の時間を保てば獲得済み', () => {
    expect(keepProgressOf(PODIUM, jstInstantOf(DAY, 0), jstInstantOf(DAY, 23, 59)).state).toBe('keeping');
    expect(keepProgressOf(PODIUM, jstInstantOf('2026-11-08' as LocalDate, 10), jstInstantOf(DAY, 10))).toEqual({ state: 'achieved', heldHours: 24, remainingHours: 0 });
  });
});
