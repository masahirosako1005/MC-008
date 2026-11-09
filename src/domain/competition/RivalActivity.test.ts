import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseRivalId } from '@/Common/types/Id';
import type { DistrictId, RivalId } from '@/Common/types/Id';
import { addDays, compareLocalDate, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { Rival, RivalActionVisit, RivalPattern } from '@/domain/competition/Rival';
import { countRivalVisits, isBackgroundVisitDay, RivalActivity } from '@/domain/competition/RivalActivity';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** テスト用: 日付 */
function d(text: string): LocalDate {
  return must(parseLocalDate(text));
}

const TARO: RivalId = must(parseRivalId('r_taro'));
const HANA: RivalId = must(parseRivalId('r_hana'));
const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const MINATO: DistrictId = must(parseDistrictId('d_minato'));
const HONMACHI: DistrictId = must(parseDistrictId('d_honmachi'));
const TODAY = d('2026-11-09');
/** 今日を含む直近30日 */
const WINDOW_FROM = addDays(TODAY, -29);

/** テスト用: 背景活動を持つライバル（Rival.of を通さない素の値。countRivalVisits は防御的に扱う） */
function rival(id: RivalId, patterns: readonly RivalPattern[]): Rival {
  return { id, name: id, patterns };
}

/** テスト用: 1日ずつ数える素朴な実装（O(1) の計算式と突き合わせる） */
function bruteForce(pattern: RivalPattern, from: LocalDate, to: LocalDate): number {
  let n = 0;
  for (let day = from; compareLocalDate(day, to) <= 0; day = addDays(day, 1)) {
    if (isBackgroundVisitDay(pattern, day)) n += 1;
  }
  return n;
}

/** テスト用: ライバル行動 */
function action(rivalId: RivalId, districtId: DistrictId, localDate: LocalDate, count: number): RivalActionVisit {
  return { rivalId, districtId, localDate, count };
}

describe('countRivalVisits（背景活動）', () => {
  it('4日ごとの背景活動は30日窓で7〜8回、位相0〜3の合計は30回（毎日ちょうど1つの位相が当たる）', () => {
    let total = 0;
    for (let phase = 0; phase < 4; phase += 1) {
      const n = countRivalVisits({ rival: rival(TARO, [{ districtId: JOKA, intervalDays: 4, phase }]), actions: [], from: WINDOW_FROM, to: TODAY });
      expect(n === 7 || n === 8).toBe(true);
      total += n;
    }
    expect(total).toBe(30);
  });

  it('位相を1増やすと訪問日が1日前にずれる', () => {
    for (let offset = 0; offset < 8; offset += 1) {
      const day = addDays(TODAY, offset);
      const base: RivalPattern = { districtId: JOKA, intervalDays: 4, phase: 1 };
      const shifted: RivalPattern = { districtId: JOKA, intervalDays: 4, phase: 2 };
      expect(isBackgroundVisitDay(shifted, addDays(day, -1))).toBe(isBackgroundVisitDay(base, day));
    }
  });

  it('計算式は1日ずつ数えた結果と一致する（1970年以前の負のエポック日・閏年をまたぐ範囲を含む）', () => {
    const ranges: readonly [LocalDate, LocalDate][] = [
      [d('1969-11-15'), d('1970-02-10')],
      [d('2027-12-20'), d('2029-01-15')],
      [WINDOW_FROM, TODAY],
    ];
    for (const [from, to] of ranges) {
      for (const intervalDays of [1, 3, 4, 7, 9, 10]) {
        for (let phase = 0; phase < intervalDays; phase += 1) {
          const p: RivalPattern = { districtId: JOKA, intervalDays, phase };
          expect(countRivalVisits({ rival: rival(TARO, [p]), actions: [], from, to })).toBe(bruteForce(p, from, to));
        }
      }
    }
  });

  it('1日だけの期間は 0 か 1、開始日が終了日より後なら 0', () => {
    const r = rival(TARO, [{ districtId: JOKA, intervalDays: 1, phase: 0 }]);
    expect(countRivalVisits({ rival: r, actions: [], from: TODAY, to: TODAY })).toBe(1);
    expect(countRivalVisits({ rival: r, actions: [action(TARO, JOKA, TODAY, 5)], from: TODAY, to: addDays(TODAY, -1) })).toBe(0);
  });

  it('地区を指定するとその地区の背景活動だけ、省略すると全地区を数える', () => {
    const r = rival(HANA, [
      { districtId: MINATO, intervalDays: 3, phase: 0 },
      { districtId: JOKA, intervalDays: 9, phase: 4 },
    ]);
    const minato = countRivalVisits({ rival: r, actions: [], districtId: MINATO, from: WINDOW_FROM, to: TODAY });
    const joka = countRivalVisits({ rival: r, actions: [], districtId: JOKA, from: WINDOW_FROM, to: TODAY });
    expect(minato).toBe(10);
    expect(joka === 3 || joka === 4).toBe(true);
    expect(countRivalVisits({ rival: r, actions: [], from: WINDOW_FROM, to: TODAY })).toBe(minato + joka);
    expect(countRivalVisits({ rival: r, actions: [], districtId: HONMACHI, from: WINDOW_FROM, to: TODAY })).toBe(0);
  });

  it('不正な背景活動（間隔0・負・小数、位相が非整数）は数えない', () => {
    const r = rival(TARO, [
      { districtId: JOKA, intervalDays: 0, phase: 0 },
      { districtId: MINATO, intervalDays: -3, phase: 0 },
      { districtId: HONMACHI, intervalDays: 2.5, phase: 0 },
    ]);
    expect(countRivalVisits({ rival: r, actions: [], from: WINDOW_FROM, to: TODAY })).toBe(0);
    const badPhase = rival(TARO, [{ districtId: JOKA, intervalDays: 3, phase: Number.NaN }]);
    expect(countRivalVisits({ rival: badPhase, actions: [], from: WINDOW_FROM, to: TODAY })).toBe(0);
    expect(isBackgroundVisitDay({ districtId: JOKA, intervalDays: 0, phase: 0 }, TODAY)).toBe(false);
  });
});

describe('countRivalVisits（ライバル行動）', () => {
  const noBackground = rival(TARO, []);

  it('同じライバル・同じ地区・期間内（両端を含む）の行動の回数を合計する', () => {
    const actions = [
      action(TARO, HONMACHI, TODAY, 3),
      action(TARO, HONMACHI, WINDOW_FROM, 2),
      action(TARO, HONMACHI, addDays(WINDOW_FROM, -1), 100),
      action(TARO, HONMACHI, addDays(TODAY, 1), 100),
      action(HANA, HONMACHI, TODAY, 100),
      action(TARO, JOKA, TODAY, 7),
    ];
    expect(countRivalVisits({ rival: noBackground, actions, districtId: HONMACHI, from: WINDOW_FROM, to: TODAY })).toBe(5);
    expect(countRivalVisits({ rival: noBackground, actions, from: WINDOW_FROM, to: TODAY })).toBe(12);
  });

  it('背景活動と行動を足し合わせる', () => {
    const r = rival(TARO, [{ districtId: JOKA, intervalDays: 1, phase: 0 }]);
    expect(countRivalVisits({ rival: r, actions: [action(TARO, JOKA, TODAY, 2)], districtId: JOKA, from: WINDOW_FROM, to: TODAY })).toBe(32);
  });

  it('回数が負・小数・非数の行動は数えない', () => {
    const actions = [action(TARO, HONMACHI, TODAY, -5), action(TARO, HONMACHI, TODAY, 1.5), action(TARO, HONMACHI, TODAY, Number.NaN), action(TARO, HONMACHI, TODAY, 1)];
    expect(countRivalVisits({ rival: noBackground, actions, districtId: HONMACHI, from: TODAY, to: TODAY })).toBe(1);
  });

  it('名前空間 RivalActivity からも同じ関数を呼べる', () => {
    expect(RivalActivity.countRivalVisits).toBe(countRivalVisits);
  });
});
