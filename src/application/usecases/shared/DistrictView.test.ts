import { describe, expect, it } from 'vitest';
import { addDays } from '@/Common/utils/date';
import { createTestWorld, must, seedLordship, seedTraveler, testDate, testDistrictId } from '@/application/testing/fakes';
import {
  districtViewsOf,
  fadeCalendarOf,
  fadeDtoOf,
  nextGoalText,
  toDistrictCardDto,
  toDistrictMapDto,
} from '@/application/usecases/shared/DistrictView';
import type { LordStanding } from '@/application/usecases/shared/LordStandings';
import { loadWorld } from '@/application/usecases/shared/World';
import type { DistrictStatus } from '@/domain/town/DistrictStatus';
import type { FadeState } from '@/domain/town/FadePolicy';

const D = testDistrictId('d_honmachi');
const START = testDate('2026-11-14');

/** テスト用: 状態サマリ（既定は訪問ありで fresh、次の Lv あり） */
function status(patch: Partial<DistrictStatus> = {}): DistrictStatus {
  return {
    districtId: D,
    level: 2,
    score: 7,
    buildings: 7,
    visitCount: 4,
    distinctSpots: 3,
    fade: { kind: 'fresh', daysSinceVisit: 3 },
    nextGoal: { nextLevel: 3, remainingScore: 3 },
    ...patch,
  };
}

/** テスト用: 主の状況（既定は自分が主） */
function standing(patch: Partial<LordStanding> = {}): LordStanding {
  return { districtId: D, isMe: true, lostByTraveler: false, lordCount: 4, myCount: 4, needed: 0, lordName: 'あなた', ...patch };
}

const LOST: LordStanding = standing({ isMe: false, lostByTraveler: true, lordName: 'おまいり番長', lordCount: 6, myCount: 4, needed: 3 });
const FADING: FadeState = { kind: 'fading', daysSinceVisit: 40, progress: 1 / 6, fadeStartDate: START };
const SOON: FadeState = { kind: 'soon', daysSinceVisit: 25, daysUntilFade: 5, fadeStartDate: START };

describe('nextGoalText（地区カードの「次の目標」）の優先順', () => {
  it('1. 主を奪われ中なら、色あせ中・カードの目標があっても「奪還まで」を出す', () => {
    const text = nextGoalText({ status: status({ fade: FADING }), standing: LOST, nextCard: { rank: 'gold', remainingVisits: 1 } });
    expect(text).toBe('奪還まで：あと3回（直近30日）');
  });

  it('2. 色あせ中なら「再訪で復活＋おかえりボーナス」（自分が主でも）', () => {
    expect(nextGoalText({ status: status({ fade: FADING }), standing: standing(), nextCard: { rank: 'silver', remainingVisits: 1 } })).toBe('再訪で復活＋おかえりボーナス');
  });

  it('3. 色あせ間近なら「あと{d}日で色あせ」', () => {
    expect(nextGoalText({ status: status({ fade: SOON }), standing: standing(), nextCard: { rank: 'silver', remainingVisits: 1 } })).toBe('あと5日で色あせ');
  });

  it('4. 未訪問なら「まずクエストを1つ達成しよう」', () => {
    const never = status({ visitCount: 0, distinctSpots: 0, score: 0, level: 0, buildings: 0, fade: { kind: 'never' }, nextGoal: { nextLevel: 1, remainingScore: 1 } });
    expect(nextGoalText({ status: never, standing: standing({ isMe: false, lordName: undefined }), nextCard: { rank: 'silver', remainingVisits: 3 } })).toBe('まずクエストを1つ達成しよう');
  });

  it('5. 次のカードがあれば「あと{k}回で{銀|金}カード」', () => {
    expect(nextGoalText({ status: status(), standing: standing(), nextCard: { rank: 'silver', remainingVisits: 2 } })).toBe('あと2回で銀カード');
    expect(nextGoalText({ status: status(), standing: standing(), nextCard: { rank: 'gold', remainingVisits: 6 } })).toBe('あと6回で金カード');
  });

  it('6. カードを取り終えたら「Lv{n}まであと{remaining}」', () => {
    expect(nextGoalText({ status: status(), standing: standing() })).toBe('Lv3まであと3');
  });

  it('7. それ以外は「通い続けて街を彩ろう」', () => {
    const { nextGoal: _omit, ...withoutGoal } = status({ level: 3, score: 20 });
    expect(nextGoalText({ status: withoutGoal, standing: standing() })).toBe('通い続けて街を彩ろう');
  });

  it('主の状況が無い・取り返し中でないときは取り返しの文言を出さない', () => {
    expect(nextGoalText({ status: status() })).toBe('Lv3まであと3');
    expect(nextGoalText({ status: status(), standing: standing({ isMe: false, lostByTraveler: false, lordName: '花見は毎日派', needed: 2 }) })).toBe('Lv3まであと3');
  });
});

describe('fadeDtoOf / fadeCalendarOf', () => {
  it('色あせ状態の種類ごとに必要な項目だけを DTO にする', () => {
    expect(fadeDtoOf({ kind: 'never' })).toEqual({ kind: 'never' });
    expect(fadeDtoOf({ kind: 'fresh', daysSinceVisit: 2 })).toEqual({ kind: 'fresh', daysSinceVisit: 2 });
    expect(fadeDtoOf(SOON)).toEqual({ kind: 'soon', daysSinceVisit: 25, daysUntilFade: 5, fadeStartDate: '2026-11-14' });
    expect(fadeDtoOf(FADING)).toEqual({ kind: 'fading', daysSinceVisit: 40, progress: 1 / 6, fadeStartDate: '2026-11-14' });
  });

  it('カレンダー追加は色あせ間近（soon）のときだけ', () => {
    expect(fadeCalendarOf('本町地区', SOON)).toEqual({ districtName: '本町地区', fadeStartDate: '2026-11-14' });
    expect(fadeCalendarOf('本町地区', FADING)).toBeUndefined();
    expect(fadeCalendarOf('本町地区', { kind: 'fresh', daysSinceVisit: 1 })).toBeUndefined();
    expect(fadeCalendarOf('本町地区', { kind: 'never' })).toBeUndefined();
  });
});

describe('districtViewsOf → toDistrictCardDto / toDistrictMapDto', () => {
  it('シードした旅人の地区カード・地図 DTO が状態サマリ・主・色あせと一致する', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, {
      visits: [['l_hm01', -5], ['l_hm02', -3], ['s_hm01', -1], ['l_mi01', -25], ['l_mi02', -25], ['l_yu01', -45]],
    });
    await seedLordship(tw, [
      { districtId: 'd_honmachi', holder: 'traveler' },
      { districtId: 'd_yunosato', holder: 'r_hana', lost: true },
    ]);
    const world = must(await loadWorld(tw));
    const views = districtViewsOf(world);
    expect(views.map((v) => v.district.id)).toEqual(world.spots.allDistricts().map((d) => d.id));
    const cards = new Map(views.map((v) => [v.district.id, toDistrictCardDto(v)]));

    const honmachi = cards.get(testDistrictId('d_honmachi'));
    expect(honmachi).toMatchObject({ name: '本町地区', shortName: '本町', visitCount: 3, level: 2, score: 6, isLordMe: true, lordName: 'あなた', lordLost: false });
    expect(honmachi?.fade.kind).toBe('fresh');
    expect(honmachi?.nextGoalText).toBe('あと7回で金カード');
    expect(honmachi?.calendar).toBeUndefined();

    const minato = cards.get(testDistrictId('d_minato'));
    expect(minato?.fade).toEqual({ kind: 'soon', daysSinceVisit: 25, daysUntilFade: 5, fadeStartDate: addDays(world.today, 5) });
    expect(minato?.calendar).toEqual({ districtName: 'みなと地区', fadeStartDate: addDays(world.today, 5) });
    expect(minato?.nextGoalText).toBe('あと5日で色あせ');

    const yunosato = cards.get(testDistrictId('d_yunosato'));
    expect(yunosato).toMatchObject({ lordName: '花見は毎日派', isLordMe: false, lordLost: true });
    expect(yunosato?.nextGoalText).toMatch(/^奪還まで：あと\d+回（直近30日）$/);

    const satoyama = cards.get(testDistrictId('d_satoyama'));
    expect(satoyama).toMatchObject({ visitCount: 0, level: 0, isLordMe: false, lordLost: false, nextGoalText: 'まずクエストを1つ達成しよう' });
    expect(satoyama?.lordName).toBeUndefined();
    expect(satoyama?.fade).toEqual({ kind: 'never' });
  });

  it('地図 DTO はポリゴン・中心・成長・色あせ・主を持つ', async () => {
    const tw = createTestWorld();
    await seedTraveler(tw, { visits: [['l_jo01', -2]] });
    const world = must(await loadWorld(tw));
    const joka = districtViewsOf(world).find((v) => v.district.id === testDistrictId('d_joka'));
    if (joka === undefined) throw new Error('fixture');
    const dto = toDistrictMapDto(joka);
    expect(dto).toMatchObject({ id: 'd_joka', name: '城下地区', theme: '歴史', color: '#7a5ea8', order: 1, level: 1, score: 2, buildings: 2, visitCount: 1, isLordMe: false });
    expect(dto.polygon).toHaveLength(joka.district.polygon.length);
    expect(dto.center).toEqual({ lat: joka.district.center.lat, lng: joka.district.center.lng });
    expect(dto.fade).toEqual({ kind: 'fresh', daysSinceVisit: 2 });
    expect(dto.lordName).toBeUndefined();
  });
});
