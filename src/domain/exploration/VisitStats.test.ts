import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId } from '@/Common/types/Id';
import { jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import {
  countVisitsBetween,
  countVisitsInRange,
  distinctSpotCount,
  lastVisitDate,
  seasonsVisited,
  visitCountOfSpot,
  visitsInDistrict,
  visitsOfSpot,
} from '@/domain/exploration/VisitStats';

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

let seq = 0;
/** テスト用: 訪問記録 */
function visit(spot: string, district: DistrictId, date: string): VisitRecord {
  seq += 1;
  return {
    spotId: must(parseSpotId(spot)),
    districtId: district,
    visitedAt: jstInstantOf(d(date), 10),
    localDate: d(date),
    operationId: must(parseOperationId(`00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`)),
  };
}

const VISITS: readonly VisitRecord[] = [
  visit('l_jo01', JOKA, '2026-03-10'),
  visit('s_jo01', JOKA, '2026-07-01'),
  visit('l_jo01', JOKA, '2026-10-20'),
  visit('l_jo01', JOKA, '2026-11-09'),
  visit('l_mi01', MINATO, '2026-11-01'),
];

describe('地区・スポット別の抽出', () => {
  it('地区の訪問記録だけを返す', () => {
    expect(visitsInDistrict(VISITS, JOKA)).toHaveLength(4);
    expect(visitsInDistrict(VISITS, MINATO)).toHaveLength(1);
  });
  it('スポットの訪問回数（＝記録の件数）', () => {
    expect(visitCountOfSpot(VISITS, must(parseSpotId('l_jo01')))).toBe(3);
    expect(visitsOfSpot(VISITS, must(parseSpotId('s_jo01')))).toHaveLength(1);
    expect(visitCountOfSpot(VISITS, must(parseSpotId('s_jo99')))).toBe(0);
  });
  it('訪問したスポットの種類数', () => {
    expect(distinctSpotCount(VISITS, JOKA)).toBe(2);
    expect(distinctSpotCount([], JOKA)).toBe(0);
  });
});

describe('countVisitsBetween（両端を含む）', () => {
  it('期間の両端の日を含めて数える', () => {
    expect(countVisitsBetween(VISITS, JOKA, d('2026-10-20'), d('2026-11-09'))).toBe(2);
    expect(countVisitsBetween(VISITS, JOKA, d('2026-10-21'), d('2026-11-08'))).toBe(0);
  });
  it('地区を省略すると全地区', () => {
    expect(countVisitsBetween(VISITS, undefined, d('2026-11-01'), d('2026-11-30'))).toBe(2);
  });
  it('開始が終了より後なら 0', () => {
    expect(countVisitsBetween(VISITS, JOKA, d('2026-12-01'), d('2026-01-01'))).toBe(0);
  });
  it('オブジェクト引数版と同じ結果', () => {
    expect(countVisitsInRange(VISITS, { districtId: JOKA, from: d('2026-01-01'), to: d('2026-12-31') })).toBe(4);
  });
});

describe('lastVisitDate', () => {
  it('地区の最終訪問日', () => {
    expect(lastVisitDate(VISITS, JOKA)).toBe('2026-11-09');
  });
  it('before 指定時はその日より前（当日を含まない）', () => {
    expect(lastVisitDate(VISITS, JOKA, d('2026-11-09'))).toBe('2026-10-20');
    expect(lastVisitDate(VISITS, JOKA, d('2026-03-10'))).toBeUndefined();
  });
  it('訪問が無ければ undefined', () => {
    expect(lastVisitDate([], JOKA)).toBeUndefined();
  });
});

describe('seasonsVisited', () => {
  it('訪問した季節を集める', () => {
    expect([...seasonsVisited(VISITS, JOKA)].sort()).toEqual(['autumn', 'spring', 'summer']);
    expect(seasonsVisited(VISITS, MINATO).size).toBe(1);
  });
});
