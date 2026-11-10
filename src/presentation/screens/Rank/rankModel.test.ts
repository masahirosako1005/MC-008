import { describe, expect, it } from 'vitest';
import type { LeagueDto, RankStatusDto, RankingDto } from '@/application/dto/Dto';
import { historyIconOf, historyTextOf, isNearRankUp, leagueMedalsOf, nextGoalsOf, perkLinkFillsOf, rankProgressOf, shortDateOf } from '@/presentation/screens/Rank/rankModel';
import { tierOf } from '@/presentation/screens/Rank/rankEmblem';

/** 段（RANK_THRESHOLDS と同じ並び） */
const STEPS: RankStatusDto['steps'] = [
  { name: 'はじめての旅人', min: 0, state: 'reached' },
  { name: '旅人', min: 50, state: 'current' },
  { name: '常連', min: 150, state: 'locked' },
  { name: '顔なじみ', min: 400, state: 'locked' },
  { name: '街の名士', min: 800, state: 'locked' },
];

/**
 * テスト用のランクを作る。
 * @param over 上書き
 * @returns ランク
 */
function rankDto(over: Partial<RankStatusDto> = {}): RankStatusDto {
  return {
    nickname: 'テスト旅人',
    rank: { name: '旅人', index: 1, nextName: '常連', nextAt: 150, remaining: 90 },
    steps: STEPS,
    points: 60,
    totalVisits: 5,
    visitedSpots: 3,
    silverCards: 1,
    goldCards: 0,
    lordDistricts: [],
    recent: [],
    rules: { landmarkPoints: 10, shopPoints: 15, welcomeBackMultiplier: 1.5 },
    ...over,
  };
}

/**
 * テスト用のリーグを作る。
 * @param over 上書き
 * @returns リーグ
 */
function league(over: Partial<LeagueDto>): LeagueDto {
  return {
    id: 'kayoi', name: 'かよいリーグ', shortName: 'かよい', icon: '♛', tagline: '', rule: '', unit: '回',
    joined: true, entries: [], myRank: 7, myCount: 4, nextStepText: '', ...over,
  };
}

describe('rankProgressOf', () => {
  it('今の段の中での進み具合（50→150 の段で 60pt なら 10%）と、5段のロード上の位置（2段目＋10%）', () => {
    const p = rankProgressOf(rankDto());
    expect(p.percent).toBe(10);
    expect(p.roadPercent).toBeCloseTo(27.5);
    expect(p.isTop).toBe(false);
  });

  it('最上段は 100% で、ロードの右端', () => {
    expect(rankProgressOf(rankDto({ points: 900, rank: { name: '街の名士', index: 4 } }))).toEqual({ percent: 100, roadPercent: 100, isTop: true });
  });

  it('最初の段の 0pt はロードの左端', () => {
    const p = rankProgressOf(rankDto({ points: 0, rank: { name: 'はじめての旅人', index: 0, nextName: '旅人', nextAt: 50, remaining: 50 } }));
    expect(p).toEqual({ percent: 0, roadPercent: 0, isTop: false });
  });
});

describe('isNearRankUp', () => {
  it('今の段の 80% 以上で目前。最上段では出さない', () => {
    expect(isNearRankUp({ percent: 79, roadPercent: 0, isTop: false })).toBe(false);
    expect(isNearRankUp({ percent: 80, roadPercent: 0, isTop: false })).toBe(true);
    expect(isNearRankUp({ percent: 100, roadPercent: 100, isTop: true })).toBe(false);
  });
});

describe('紋章の段の色', () => {
  it('段の添字を 0..4 に収める', () => {
    expect([-1, 0, 2, 4, 9].map(tierOf)).toEqual([0, 0, 2, 4, 4]);
  });
});

describe('leagueMedalsOf', () => {
  it('1〜3位は金銀銅、4位以下は無地、不参加は見学。回数は単位付き', () => {
    const ranking: RankingDto = {
      monthLabel: '11月', daysLeft: 21, recommendedLeagueId: 'kayoi', lords: [],
      leagues: [
        league({ myRank: 1 }),
        league({ id: 'hajimete', shortName: 'はじめまして', myRank: 7, myCount: 2, unit: 'か所' }),
        league({ id: 'rookie', shortName: 'ルーキー', joined: false, myRank: undefined, myCount: 2 }),
      ],
    };
    expect(leagueMedalsOf(ranking)).toEqual([
      { id: 'kayoi', shortName: 'かよい', rank: 1, medal: 'gold', countText: '4回' },
      { id: 'hajimete', shortName: 'はじめまして', rank: 7, medal: 'plain', countText: '2か所' },
      { id: 'rookie', shortName: 'ルーキー', rank: undefined, medal: 'guest', countText: '2回' },
    ]);
  });
});

describe('表示の小物', () => {
  it('日付は月/日だけ', () => {
    expect(shortDateOf('2026-11-07')).toBe('11/7');
    expect(shortDateOf('bad')).toBe('bad');
  });

  it('最近のポイントのアイコン', () => {
    const base = { date: '2026-11-07', spotName: '', districtName: '', points: 5 };
    expect(historyIconOf({ ...base, kind: 'welcomeBack', spotKind: 'shop' })).toBe('sparkle');
    expect(historyIconOf({ ...base, kind: 'visit', spotKind: 'shop' })).toBe('shop');
    expect(historyIconOf({ ...base, kind: 'visit', spotKind: 'landmark' })).toBe('star');
    expect(historyIconOf({ ...base, kind: 'purchase', spotKind: 'shop' })).toBe('coin');
  });

  it('お買い物の行は「{お店}でお買い物」、それ以外はスポット名', () => {
    const base = { date: '2026-11-10', spotName: '城下カフェ', districtName: '', points: 10, spotKind: 'shop' as const };
    expect(historyTextOf({ ...base, kind: 'purchase' })).toBe('城下カフェでお買い物');
    expect(historyTextOf({ ...base, kind: 'visit' })).toBe('城下カフェ');
  });
});

describe('つぎの目標（nextGoalsOf・perkLinkFillsOf）', () => {
  /** 特典（25 獲得済み・50 獲得済み（段1）・100 次・150 まだ（段2）） */
  const PERKS: NonNullable<RankStatusDto['perks']> = [
    { at: 25, parts: [{ id: 'hairColor.akane', name: 'あかね色', rarity: 'R' }], state: 'earned' },
    { at: 50, rankIndex: 1, parts: [{ id: 'title.adventurer', name: '一人前の冒険者', rarity: 'R' }], state: 'earned' },
    { at: 100, parts: [{ id: 'topColor.ruby', name: 'ルビー', rarity: 'R' }], state: 'next' },
    { at: 150, rankIndex: 2, parts: [{ id: 'title.veteran', name: '歴戦の冒険者', rarity: 'SR' }], state: 'locked' },
  ];

  it('ランクアップはいまの段の下限→次の段、特典は直前の特典→次の特典のゲージ', () => {
    const goals = nextGoalsOf(rankDto({ points: 60, perks: PERKS }));
    expect(goals.rank).toEqual({ from: 50, to: 150, remaining: 90, percent: 10, index: 2, name: '常連', isTop: false });
    expect(goals.perk).toMatchObject({ from: 50, to: 100, remaining: 40, percent: 20 });
    expect(goals.perk?.perk.at).toBe(100);
  });

  it('最初の特典の前は 0 から、特典が無い・全部獲得なら特典のゲージは出さない', () => {
    const first = PERKS.map((p) => ({ ...p, state: p.at === 25 ? 'next' : 'locked' }) as const);
    expect(nextGoalsOf(rankDto({ points: 10, perks: first })).perk).toMatchObject({ from: 0, to: 25, remaining: 15, percent: 40 });
    expect(nextGoalsOf(rankDto()).perk).toBeUndefined();
    expect(nextGoalsOf(rankDto({ perks: PERKS.map((p) => ({ ...p, state: 'earned' }) as const) })).perk).toBeUndefined();
  });

  it('最上段はランクアップのゲージが満タンで、残りは 0', () => {
    const top = rankDto({ rank: { name: '街の名士', index: 4 }, points: 900 });
    expect(nextGoalsOf(top).rank).toEqual({ from: 800, to: 800, remaining: 0, percent: 100, index: 4, name: '街の名士', isTop: true });
  });

  it('特典をつなぐ線は、届いた区間は満タン・途中は割合・届いていない区間と最後は 0', () => {
    expect(perkLinkFillsOf(PERKS, 60)).toEqual([100, 20, 0, 0]);
    expect(perkLinkFillsOf(PERKS, 150)).toEqual([100, 100, 100, 0]);
    expect(perkLinkFillsOf(PERKS, 0)).toEqual([0, 0, 0, 0]);
  });
});
