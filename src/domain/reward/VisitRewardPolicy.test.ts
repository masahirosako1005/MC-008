import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId, SpotId } from '@/Common/types/Id';
import { addDays, jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { VISIT_POINTS_LANDMARK, VISIT_POINTS_SHOP, WELCOME_BACK_MULTIPLIER } from '@/domain/reward/constants';
import { VisitRewardPolicy, basePointsFor, isRevival, isWelcomeBackDay, rewardFor, welcomeBackTotal } from '@/domain/reward/VisitRewardPolicy';
import type { SpotKind } from '@/domain/spot/Spot';
import { FADE_START_DAYS } from '@/domain/town/constants';
import { stateFor } from '@/domain/town/FadePolicy';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const MINATO: DistrictId = must(parseDistrictId('d_minato'));
const CASTLE: SpotId = must(parseSpotId('l_jo01'));
const CAFE: SpotId = must(parseSpotId('s_jo01'));
const PIER: SpotId = must(parseSpotId('l_mi01'));
const TODAY: LocalDate = must(parseLocalDate('2026-11-09'));

let seq = 0;
/** テスト用: 訪問記録（today から offset 日ずらした日） */
function visit(spotId: SpotId, districtId: DistrictId, offsetDays: number): VisitRecord {
  seq += 1;
  const localDate = addDays(TODAY, offsetDays);
  return {
    spotId,
    districtId,
    visitedAt: jstInstantOf(localDate, 10),
    localDate,
    operationId: must(parseOperationId(`00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`)),
  };
}

/** テスト用: 城下地区のスポット */
function jokaSpot(kind: SpotKind): { kind: SpotKind; districtId: DistrictId } {
  return { kind, districtId: JOKA };
}

describe('基本点（D11）', () => {
  it('名所は VISIT_POINTS_LANDMARK、店舗は VISIT_POINTS_SHOP', () => {
    expect(basePointsFor('landmark')).toBe(VISIT_POINTS_LANDMARK);
    expect(basePointsFor('shop')).toBe(VISIT_POINTS_SHOP);
  });

  it('その地区への初訪問は基本点のみ（おかえりではない）', () => {
    const r = rewardFor({ spot: jokaSpot('landmark'), visitsBefore: [], today: TODAY });
    expect(r).toEqual({ basePoints: 10, bonusPoints: 0, totalPoints: 10, isWelcomeBackDay: false, multiplier: 1 });
  });

  it('最近訪問した地区は基本点のみ', () => {
    const r = rewardFor({ spot: jokaSpot('shop'), visitsBefore: [visit(CASTLE, JOKA, -1)], today: TODAY });
    expect(r.basePoints).toBe(15);
    expect(r.bonusPoints).toBe(0);
  });
});

describe('おかえりボーナス（D6）の境界', () => {
  it('前回から29日ならおかえりではない（倍率なし）', () => {
    const r = rewardFor({ spot: jokaSpot('landmark'), visitsBefore: [visit(CASTLE, JOKA, -29)], today: TODAY });
    expect(r.isWelcomeBackDay).toBe(false);
    expect(r.multiplier).toBe(1);
    expect(r.totalPoints).toBe(10);
  });

  it('前回から30日ならおかえり（名所 10×1.5=15、差分5）', () => {
    const r = rewardFor({ spot: jokaSpot('landmark'), visitsBefore: [visit(CASTLE, JOKA, -30)], today: TODAY });
    expect(r).toEqual({ basePoints: 10, bonusPoints: 5, totalPoints: 15, isWelcomeBackDay: true, multiplier: WELCOME_BACK_MULTIPLIER });
  });

  it('端数は切り捨てる（店舗 15×1.5=22.5→22、差分7）', () => {
    expect(welcomeBackTotal(15)).toBe(22);
    const r = rewardFor({ spot: jokaSpot('shop'), visitsBefore: [visit(CASTLE, JOKA, -45)], today: TODAY });
    expect(r.totalPoints).toBe(22);
    expect(r.bonusPoints).toBe(7);
  });

  it('同じ日の2回目の訪問も1.5倍になる', () => {
    const first = visit(CASTLE, JOKA, 0);
    const r = rewardFor({ spot: jokaSpot('shop'), visitsBefore: [visit(CASTLE, JOKA, -30), first], today: TODAY });
    expect(r.isWelcomeBackDay).toBe(true);
    expect(r.bonusPoints).toBe(7);
  });

  it('他の地区の訪問は判定に影響しない', () => {
    const visitsBefore = [visit(CASTLE, JOKA, -40), visit(PIER, MINATO, -1)];
    expect(isWelcomeBackDay({ visitsBefore, districtId: JOKA, today: TODAY })).toBe(true);
    expect(isWelcomeBackDay({ visitsBefore, districtId: MINATO, today: TODAY })).toBe(false);
  });

  it('今日より後の日付の記録（時計の巻き戻し等）は「今日より前の最終訪問」に数えない', () => {
    const visitsBefore = [visit(CASTLE, JOKA, -30), visit(CAFE, JOKA, 3)];
    expect(isWelcomeBackDay({ visitsBefore, districtId: JOKA, today: TODAY })).toBe(true);
  });
});

describe('復活の判定（DistrictRevived の条件）', () => {
  it('その地区への初訪問は revived ではない（日数も無い）', () => {
    expect(isRevival({ visitsBefore: [], districtId: JOKA, today: TODAY })).toEqual({ revived: false });
    expect(isRevival({ visitsBefore: [visit(PIER, MINATO, -60)], districtId: JOKA, today: TODAY })).toEqual({ revived: false });
  });

  it('前回から29日なら revived ではない', () => {
    expect(isRevival({ visitsBefore: [visit(CASTLE, JOKA, -29)], districtId: JOKA, today: TODAY })).toEqual({ revived: false, daysSinceLastVisit: 29 });
  });

  it('前回から30日なら revived', () => {
    expect(isRevival({ visitsBefore: [visit(CASTLE, JOKA, -30)], districtId: JOKA, today: TODAY })).toEqual({ revived: true, daysSinceLastVisit: 30 });
  });

  it('同じ日の2回目は revived ではない（1回目だけが復活）が、ボーナスは続く', () => {
    const old = visit(CASTLE, JOKA, -45);
    const firstToday = visit(CASTLE, JOKA, 0);
    expect(isRevival({ visitsBefore: [old], districtId: JOKA, today: TODAY }).revived).toBe(true);
    const second = isRevival({ visitsBefore: [old, firstToday], districtId: JOKA, today: TODAY });
    expect(second).toEqual({ revived: false, daysSinceLastVisit: 0 });
    expect(rewardFor({ spot: jokaSpot('shop'), visitsBefore: [old, firstToday], today: TODAY }).isWelcomeBackDay).toBe(true);
  });

  it('今日より後の日付の記録は無視する', () => {
    const r = isRevival({ visitsBefore: [visit(CASTLE, JOKA, -31), visit(CAFE, JOKA, 2)], districtId: JOKA, today: TODAY });
    expect(r).toEqual({ revived: true, daysSinceLastVisit: 31 });
  });
});

describe('名前空間', () => {
  it('VisitRewardPolicy.rewardFor / isRevival で呼べる', () => {
    expect(VisitRewardPolicy.rewardFor({ spot: jokaSpot('landmark'), visitsBefore: [], today: TODAY }).basePoints).toBe(10);
    expect(VisitRewardPolicy.isRevival({ visitsBefore: [], districtId: JOKA, today: TODAY }).revived).toBe(false);
  });
});

describe('色あせ判定の一本化（D5・D6）', () => {
  it('復活・おかえりの判定は FadePolicy.stateFor の fading と 0〜120 日のすべてで一致する', () => {
    for (let days = 0; days <= 120; days += 1) {
      const isFading = stateFor(addDays(TODAY, -days), TODAY).kind === 'fading';
      const before = [visit(CASTLE, JOKA, -days)];
      expect(isRevival({ visitsBefore: before, districtId: JOKA, today: TODAY }).revived).toBe(isFading);
      if (days > 0) expect(isWelcomeBackDay({ visitsBefore: before, districtId: JOKA, today: TODAY })).toBe(isFading);
    }
  });
  it('境界: FADE_START_DAYS − 1 日は対象外、FADE_START_DAYS 日ちょうどから対象（地図の fading 開始日と同じ）', () => {
    const justBefore = [visit(CASTLE, JOKA, -(FADE_START_DAYS - 1))];
    const onStart = [visit(CASTLE, JOKA, -FADE_START_DAYS)];
    expect(isRevival({ visitsBefore: justBefore, districtId: JOKA, today: TODAY }).revived).toBe(false);
    expect(isRevival({ visitsBefore: onStart, districtId: JOKA, today: TODAY }).revived).toBe(true);
    expect(stateFor(addDays(TODAY, -FADE_START_DAYS), TODAY).kind).toBe('fading');
  });
});
