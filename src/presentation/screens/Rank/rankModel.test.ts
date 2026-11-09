import { describe, expect, it } from 'vitest';
import type { AppStatusDto, LeagueDto, RankStatusDto, RankingDto } from '@/application/dto/Dto';
import { historyIconOf, isNearRankUp, leagueMedalsOf, rankProgressOf, settingTilesOf, shortDateOf } from '@/presentation/screens/Rank/rankModel';
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

/** テスト用のアプリ状態 */
const STATUS: AppStatusDto = { today: '2026-12-09', dateLabel: '2026/12/09（水）', timeLabel: '9:41', isDemo: true, travelerProfile: 'regular', dayOffset: 30 };

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
  });
});

describe('settingTilesOf', () => {
  it('デモでは短い値とアイコンで6マス（日付は進めた日数の札付き）', () => {
    const tiles = settingTilesOf({ status: STATUS, textScale: 'large', isDemo: true, nickname: '通い慣れた人' });
    expect(tiles.map((t) => t.key)).toEqual(['textScale', 'traveler', 'location', 'date', 'storage', 'build']);
    expect(Object.fromEntries(tiles.map((t) => [t.key, t.value]))).toEqual({
      textScale: '大', traveler: '通い慣れた人', location: 'タップ歩行', date: '12/9', storage: '端末内', build: 'デモ版',
    });
    expect(tiles.find((t) => t.key === 'date')?.badge).toBe('+30日');
    expect(tiles.find((t) => t.key === 'traveler')?.badge).toBe('デモ');
    expect(tiles.every((t) => t.icon !== undefined || t.glyph !== undefined)).toBe(true);
  });

  it('本番は GPS・本番。状態が読めなくてもマスはそろう', () => {
    const tiles = settingTilesOf({ status: undefined, textScale: 'normal', isDemo: false, nickname: 'あなた' });
    expect(tiles.find((t) => t.key === 'location')?.value).toBe('GPS');
    expect(tiles.find((t) => t.key === 'date')?.value).toBe('—');
    expect(tiles.find((t) => t.key === 'build')?.value).toBe('本番');
    expect(tiles.find((t) => t.key === 'traveler')?.badge).toBeUndefined();
  });
});
