/**
 * @file 開始画面のモデルのテスト（時間帯・あいさつ・はじめての人／通い慣れた人の内容・街並み・出すかどうか・イージング）
 */
import { describe, expect, it } from 'vitest';
import type { DistrictCardDto, RankStatusDto } from '@/application/dto/Dto';
import {
  buildLaunchModel,
  easeOutBack,
  easeOutBounce,
  hourOfTimeLabel,
  launchDistrictsOf,
  launchModeOf,
  MAX_LAUNCH_DISTRICTS,
  skyPhaseOf,
  spanProgress,
} from '@/presentation/screens/Launch/launchModel';

/** ランク画面の DTO（必要な項目だけ上書きする） */
function rankOf(over: Partial<RankStatusDto> = {}): RankStatusDto {
  return {
    nickname: 'ハル',
    rank: { name: 'ベテラン冒険者', index: 2, nextName: '街の英雄', nextAt: 500, remaining: 135 },
    steps: [],
    points: 365,
    totalVisits: 29,
    visitedSpots: 18,
    silverCards: 2,
    goldCards: 0,
    lordDistricts: ['天満'],
    travelDays: 41,
    recent: [],
    rules: { landmarkPoints: 20, shopPoints: 10, welcomeBackMultiplier: 1.5 },
    ...over,
  };
}

/** 地区カードの DTO */
function districtOf(over: Partial<DistrictCardDto> = {}): DistrictCardDto {
  return {
    id: 'd_tenma',
    name: '天満',
    shortName: '天満',
    color: '#f59e0b',
    level: 2,
    score: 9,
    buildings: 4,
    visitCount: 9,
    fade: { kind: 'fresh' },
    isLordMe: false,
    lordLost: false,
    nextGoalText: '',
    ...over,
  };
}

describe('hourOfTimeLabel / skyPhaseOf', () => {
  it('時刻の表示から時を読む（読めなければ undefined）', () => {
    expect([hourOfTimeLabel('9:41'), hourOfTimeLabel('21:05'), hourOfTimeLabel('--'), hourOfTimeLabel(undefined), hourOfTimeLabel('25:00')]).toEqual([9, 21, undefined, undefined, undefined]);
  });

  it('時間帯の境目（朝5時・昼8時・夕16時・夜19時）', () => {
    expect([4, 5, 7, 8, 15, 16, 18, 19, 23].map(skyPhaseOf)).toEqual(['night', 'dawn', 'dawn', 'day', 'day', 'dusk', 'dusk', 'night', 'night']);
    expect(skyPhaseOf(undefined)).toBe('day');
  });

});

describe('launchDistrictsOf', () => {
  it('成長 Lv を 0〜3 に丸め、色あせ・地区の主を写す（最大5地区）', () => {
    const town = {
      districts: [
        districtOf({ id: 'a', level: 0 }),
        districtOf({ id: 'b', level: 5, isLordMe: true }),
        districtOf({ id: 'c', level: 1, fade: { kind: 'fading', progress: 0.5 } }),
        districtOf({ id: 'd', color: 'red' }),
        districtOf({ id: 'e' }),
        districtOf({ id: 'f' }),
      ],
    };
    const out = launchDistrictsOf(town);
    expect(out).toHaveLength(MAX_LAUNCH_DISTRICTS);
    expect(out.map((d) => [d.id, d.level, d.faded, d.isLordMe])).toEqual([
      ['a', 0, false, false],
      ['b', 3, false, true],
      ['c', 1, true, false],
      ['d', 2, false, false],
      ['e', 2, false, false],
    ]);
    expect(out[3]?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('地区が取れないときは色づいた一般的な街並みで補う', () => {
    const out = launchDistrictsOf(undefined);
    expect(out).toHaveLength(5);
    expect(out.every((d) => d.level === 1 && !d.faded)).toBe(true);
  });
});

describe('buildLaunchModel', () => {
  it('通い慣れた人: WELCOME BACK・呼び名・ランク／通った回数／EXP（数え上げる数）・いちばん強い再訪理由', () => {
    const model = buildLaunchModel({
      status: { today: '2026-11-09', dateLabel: '2026/11/09（月）', timeLabel: '20:15', isDemo: true, travelerProfile: 'regular' },
      rank: rankOf(),
      town: { districts: [districtOf({ isLordMe: true }), districtOf({ id: 'd_okawa' })] },
      reasons: [
        { kind: 'fade', title: '大川があと3日で色あせ', subtitle: '', districtId: 'd_okawa' },
        { kind: 'unvisited', title: '天満に行っていないスポット', subtitle: '', districtId: 'd_tenma' },
      ],
    });
    expect(model.isFirst).toBe(false);
    expect(model.sky).toBe('night');
    expect([model.eyebrow, model.headline]).toEqual(['WELCOME BACK', 'ハル']);
    expect(model.chips.map((c) => c.value)).toEqual(['ベテラン冒険者', '29回', '365EXP']);
    expect(model.chips.map((c) => [c.count, c.unit])).toEqual([[undefined, undefined], [29, '回'], [365, 'EXP']]);
    expect(model.reason).toEqual({ kind: 'fade', label: '色あせ', title: '大川があと3日で色あせ' });
    expect(model.lordCount).toBe(1);
    expect(model.cta).toBe('クエストへ');
  });

  it('はじめての人（訪問0回）: WELCOME・はじめまして・ステータスなし（手順の説明も出さない）', () => {
    const model = buildLaunchModel({ rank: rankOf({ totalVisits: 0, points: 0, travelDays: undefined }) });
    expect(model.isFirst).toBe(true);
    expect([model.eyebrow, model.headline, model.cta]).toEqual(['WELCOME', 'はじめまして', '冒険に出る']);
    expect(model.chips).toEqual([]);
    expect(model.reason).toBeUndefined();
  });

  it('何も取れなくても組み立てられる（昼・旅人・ステータスなし）', () => {
    const model = buildLaunchModel({});
    expect([model.sky, model.isFirst, model.headline, model.chips.length, model.districts.length]).toEqual(['day', false, '冒険者', 0, 5]);
  });

  it('ランクが取れなくても、ステータスがはじめての人ならはじめまして', () => {
    const model = buildLaunchModel({ status: { today: '2026-11-09', dateLabel: '', timeLabel: '7:00', isDemo: true, travelerProfile: 'first' } });
    expect([model.isFirst, model.sky, model.headline]).toEqual([true, 'dawn', 'はじめまして']);
  });
});

describe('launchModeOf', () => {
  it('?launch=0 で出さない・?launch=1 で必ず出す・自動操作のブラウザでは既定で出さない', () => {
    expect(launchModeOf({ search: '', webdriver: false })).toBe('show');
    expect(launchModeOf({ search: '?launch=0', webdriver: false })).toBe('skip');
    expect(launchModeOf({ search: '', webdriver: true })).toBe('skip');
    expect(launchModeOf({ search: '?launch=1', webdriver: true })).toBe('show');
  });
});

describe('イージング', () => {
  it('区間の外は 0 と 1、行きすぎて戻る・弾むは 0 で始まり 1 で終わる', () => {
    expect([spanProgress(0, 100, 200), spanProgress(200, 100, 200), spanProgress(400, 100, 200)]).toEqual([0, 0.5, 1]);
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
    expect(easeOutBounce(0)).toBeCloseTo(0);
    expect(easeOutBounce(1)).toBeCloseTo(1);
  });
});
