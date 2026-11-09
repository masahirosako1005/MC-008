import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId } from '@/Common/types/Id';
import { addDays, jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { MAX_BUILDINGS } from '@/domain/town/constants';
import type { District } from '@/domain/town/District';
import { districtStatusOf } from '@/domain/town/DistrictStatus';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const MINATO: DistrictId = must(parseDistrictId('d_minato'));

/** テスト用: 日付 */
function d(text: string): LocalDate {
  return must(parseLocalDate(text));
}

/** テスト用: 地区 */
function district(id: DistrictId): District {
  const point = { lat: 34.69, lng: 135.19 };
  return { id, name: id, shortName: id, theme: 't', order: 1, color: '#7a5ea8', center: point, entrance: point, polygon: [point, point, point] };
}

let seq = 0;
/** テスト用: 訪問記録 */
function visit(spot: string, districtId: DistrictId, date: LocalDate): VisitRecord {
  seq += 1;
  return {
    spotId: must(parseSpotId(spot)),
    districtId,
    visitedAt: jstInstantOf(date, 10),
    localDate: date,
    operationId: must(parseOperationId(`00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`)),
  };
}

/** テスト用: 再現可能な擬似乱数（線形合同法） */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const TODAY = d('2026-11-09');

describe('districtStatusOf', () => {
  it('訪問なしは Lv0・建物0・色あせ never・次の目標は Lv1', () => {
    const status = districtStatusOf({ district: district(JOKA), visits: [], today: TODAY });
    expect(status).toEqual({
      districtId: JOKA,
      level: 0,
      score: 0,
      buildings: 0,
      visitCount: 0,
      distinctSpots: 0,
      fade: { kind: 'never' },
      nextGoal: { nextLevel: 1, remainingScore: 1 },
    });
    expect('lastVisit' in status).toBe(false);
  });

  it('種類数と訪問回数からスコア・Lv・建物数を出し、他地区の訪問は数えない', () => {
    const visits = [
      visit('l_jo01', JOKA, d('2026-11-01')),
      visit('s_jo01', JOKA, d('2026-11-03')),
      visit('l_jo01', JOKA, d('2026-11-05')),
      visit('l_mi01', MINATO, d('2026-11-08')),
    ];
    const status = districtStatusOf({ district: district(JOKA), visits, today: TODAY });
    expect(status.visitCount).toBe(3);
    expect(status.distinctSpots).toBe(2);
    expect(status.score).toBe(5);
    expect(status.level).toBe(2);
    expect(status.buildings).toBe(5);
    expect(status.lastVisit).toBe('2026-11-05');
    expect(status.fade).toEqual({ kind: 'fresh', daysSinceVisit: 4 });
    expect(status.nextGoal).toEqual({ nextLevel: 3, remainingScore: 5 });
  });

  it('Lv3 では次の目標が無く、建物数は MAX_BUILDINGS で頭打ち', () => {
    const visits = Array.from({ length: 20 }, (_, i) => visit('l_jo01', JOKA, addDays(d('2026-01-01'), i)));
    const status = districtStatusOf({ district: district(JOKA), visits, today: TODAY });
    expect(status.level).toBe(3);
    expect(status.score).toBe(21);
    expect(status.buildings).toBe(MAX_BUILDINGS);
    expect('nextGoal' in status).toBe(false);
  });

  it('日付が進んで色あせても Lv・スコア・建物数・通った回数は変わらない（色あせは見た目だけ）', () => {
    const visits = [visit('l_jo01', JOKA, d('2026-08-01')), visit('s_jo01', JOKA, d('2026-08-02'))];
    const fresh = districtStatusOf({ district: district(JOKA), visits, today: d('2026-08-03') });
    const faded = districtStatusOf({ district: district(JOKA), visits, today: d('2027-08-03') });
    expect(fresh.fade.kind).toBe('fresh');
    expect(faded.fade.kind).toBe('fading');
    expect(faded.level).toBe(fresh.level);
    expect(faded.score).toBe(fresh.score);
    expect(faded.buildings).toBe(fresh.buildings);
    expect(faded.visitCount).toBe(fresh.visitCount);
    expect(faded.distinctSpots).toBe(fresh.distinctSpots);
  });

  it('色あせは最終訪問日（30日後に fading、23日後に soon）から決まる', () => {
    const visits = [visit('l_jo01', JOKA, d('2026-10-01')), visit('l_jo01', JOKA, d('2026-09-01'))];
    expect(districtStatusOf({ district: district(JOKA), visits, today: d('2026-10-24') }).fade.kind).toBe('soon');
    expect(districtStatusOf({ district: district(JOKA), visits, today: d('2026-10-31') }).fade).toEqual({
      kind: 'fading',
      daysSinceVisit: 30,
      progress: 0,
      fadeStartDate: d('2026-10-31'),
    });
  });

  it('訪問を追加しても成長は下がらない（ランダムな訪問列 100 通り）', () => {
    const random = seededRandom(7);
    const spots = ['l_jo01', 'l_jo02', 's_jo01', 's_jo02', 's_jo03', 's_jo04'];
    for (let trial = 0; trial < 100; trial += 1) {
      const visits: VisitRecord[] = [];
      let previous = districtStatusOf({ district: district(JOKA), visits, today: TODAY });
      const length = 1 + Math.floor(random() * 25);
      for (let step = 0; step < length; step += 1) {
        const spot = spots[Math.floor(random() * spots.length)] ?? 'l_jo01';
        visits.push(visit(spot, random() < 0.8 ? JOKA : MINATO, addDays(d('2026-01-01'), step)));
        const today = addDays(d('2026-01-01'), step + Math.floor(random() * 200));
        const current = districtStatusOf({ district: district(JOKA), visits, today });
        expect(current.score).toBeGreaterThanOrEqual(previous.score);
        expect(current.level).toBeGreaterThanOrEqual(previous.level);
        expect(current.buildings).toBeGreaterThanOrEqual(previous.buildings);
        expect(current.visitCount).toBeGreaterThanOrEqual(previous.visitCount);
        expect(current.distinctSpots).toBeGreaterThanOrEqual(previous.distinctSpots);
        previous = current;
      }
    }
  });

  it('同じ入力には同じ出力を返し、訪問記録の並び順にも左右されない（DI-05）', () => {
    const visits = [
      visit('l_jo01', JOKA, d('2026-09-01')),
      visit('s_jo01', JOKA, d('2026-10-15')),
      visit('s_jo02', JOKA, d('2026-10-02')),
    ];
    const a = districtStatusOf({ district: district(JOKA), visits, today: TODAY });
    const b = districtStatusOf({ district: district(JOKA), visits, today: TODAY });
    const reversed = districtStatusOf({ district: district(JOKA), visits: [...visits].reverse(), today: TODAY });
    expect(a).toEqual(b);
    expect(reversed).toEqual(a);
    expect(a.lastVisit).toBe('2026-10-15');
  });

  it('結果は凍結されている', () => {
    expect(Object.isFrozen(districtStatusOf({ district: district(JOKA), visits: [], today: TODAY }))).toBe(true);
  });
});
