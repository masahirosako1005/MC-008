import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseRivalId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId } from '@/Common/types/Id';
import { addDays, daysBetween, jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { rivalHolder, sameHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import type { LordHolder } from '@/domain/competition/LordHolder';
import { collectLordCounts, decide, LordPolicy, lordWindow, visitsNeededToReclaim } from '@/domain/competition/LordPolicy';
import type { LordCount } from '@/domain/competition/LordPolicy';
import type { Rival } from '@/domain/competition/Rival';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** テスト用: 日付 */
function d(text: string): LocalDate {
  return must(parseLocalDate(text));
}

const TARO_ID = must(parseRivalId('r_taro'));
const HANA_ID = must(parseRivalId('r_hana'));
const TARO = rivalHolder(TARO_ID);
const HANA = rivalHolder(HANA_ID);
const ME = TRAVELER_HOLDER;
const HONMACHI: DistrictId = must(parseDistrictId('d_honmachi'));
const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const TODAY = d('2026-11-09');

/** テスト用: 候補と回数 */
function c(holder: LordHolder, count: number): LordCount {
  return { holder, count };
}

/** テスト用: 判定結果が期待どおりの主か */
function expectHolder(actual: LordHolder | undefined, expected: LordHolder | undefined): void {
  expect(sameHolder(actual, expected)).toBe(true);
}

describe('LordPolicy.decide（現職あり）', () => {
  it('挑戦者が現職と同数なら現職を維持する', () => {
    expectHolder(decide({ incumbent: TARO, counts: [c(ME, 5), c(TARO, 5)] }), TARO);
  });

  it('挑戦者が現職を1回上回れば交代する', () => {
    expectHolder(decide({ incumbent: TARO, counts: [c(ME, 6), c(TARO, 5)] }), ME);
  });

  it('現職を上回る挑戦者が複数いれば最多が交代し、同数なら旅人を優先する', () => {
    expectHolder(decide({ incumbent: TARO, counts: [c(ME, 7), c(TARO, 5), c(HANA, 8)] }), HANA);
    expectHolder(decide({ incumbent: TARO, counts: [c(HANA, 7), c(TARO, 5), c(ME, 7)] }), ME);
  });

  it('旅人が現職で窓内0回でも、ライバルも0回なら維持する（勝手に主が消えない）', () => {
    expectHolder(decide({ incumbent: ME, counts: [c(ME, 0), c(TARO, 0), c(HANA, 0)] }), ME);
  });

  it('現職の回数が counts に無ければ0回として扱う', () => {
    expectHolder(decide({ incumbent: TARO, counts: [c(ME, 1)] }), ME);
    expectHolder(decide({ incumbent: TARO, counts: [c(ME, 0)] }), TARO);
    expectHolder(decide({ incumbent: TARO, counts: [] }), TARO);
  });
});

describe('LordPolicy.decide（現職なし）', () => {
  it('回数1以上の最多が主になる', () => {
    expectHolder(decide({ counts: [c(ME, 2), c(TARO, 3), c(HANA, 1)] }), TARO);
  });

  it('同数は 旅人 → ライバルID昇順 で決める', () => {
    expectHolder(decide({ counts: [c(TARO, 3), c(ME, 3), c(HANA, 3)] }), ME);
    expectHolder(decide({ counts: [c(TARO, 3), c(HANA, 3), c(ME, 1)] }), HANA);
  });

  it('全員0回・候補なしなら undefined（主なし）', () => {
    expect(decide({ counts: [c(ME, 0), c(TARO, 0)] })).toBeUndefined();
    expect(decide({ counts: [] })).toBeUndefined();
  });

  it('不正な回数（負・小数・非数）は0回として扱う', () => {
    expect(decide({ counts: [c(ME, -1), c(TARO, Number.NaN), c(HANA, 0.5)] })).toBeUndefined();
    expectHolder(decide({ incumbent: ME, counts: [c(ME, 0), c(TARO, Number.POSITIVE_INFINITY)] }), ME);
  });

  it('同じ候補が重複していれば最初の値を使う', () => {
    expectHolder(decide({ counts: [c(TARO, 1), c(ME, 2), c(TARO, 9)] }), ME);
  });

  it('名前空間 LordPolicy からも同じ関数を呼べる', () => {
    expect(LordPolicy.decide).toBe(decide);
  });
});

describe('lordWindow', () => {
  it('今日を含む直近30暦日（月またぎ）', () => {
    const w = lordWindow(TODAY);
    expect(w).toEqual({ from: d('2026-10-11'), to: TODAY });
    expect(daysBetween(w.from, w.to) + 1).toBe(30);
  });
});

describe('visitsNeededToReclaim', () => {
  it('主の回数 − 自分の回数 + 1 を返す', () => {
    expect(visitsNeededToReclaim(9, 6)).toBe(4);
    expect(visitsNeededToReclaim(5, 5)).toBe(1);
  });

  it('自分が上回っていても最低1回、不正値は0回として扱う', () => {
    expect(visitsNeededToReclaim(3, 5)).toBe(1);
    expect(visitsNeededToReclaim(Number.NaN, -2)).toBe(1);
    expect(visitsNeededToReclaim(4, Number.NaN)).toBe(5);
  });
});

describe('collectLordCounts', () => {
  /** テスト用: 訪問記録 */
  function visit(districtId: DistrictId, localDate: LocalDate, n: number): VisitRecord {
    return {
      spotId: must(parseSpotId(`s_hm0${n}`)),
      districtId,
      visitedAt: jstInstantOf(localDate),
      localDate,
      operationId: must(parseOperationId(`0000000${n}-0000-4000-8000-000000000000`)),
    };
  }

  it('旅人は窓内（両端を含む）の訪問記録の件数、ライバルは背景活動＋行動で数える', () => {
    const window = lordWindow(TODAY);
    const visits = [visit(HONMACHI, TODAY, 1), visit(HONMACHI, window.from, 2), visit(HONMACHI, addDays(window.from, -1), 3), visit(JOKA, TODAY, 4)];
    const taro: Rival = { id: TARO_ID, name: '旅人タロウ', patterns: [{ districtId: JOKA, intervalDays: 4, phase: 1 }] };
    const hana: Rival = { id: HANA_ID, name: '旅人ハナ', patterns: [] };
    const actions = [{ rivalId: TARO_ID, districtId: HONMACHI, localDate: TODAY, count: 3 }];
    const counts = collectLordCounts({ districtId: HONMACHI, visits, rivals: [taro, hana], actions, window });
    expect(counts.map((x) => x.count)).toEqual([2, 3, 0]);
    expectHolder(counts[0]?.holder, ME);
    expectHolder(counts[1]?.holder, TARO);
    expectHolder(decide({ incumbent: ME, counts }), TARO);
  });
});
