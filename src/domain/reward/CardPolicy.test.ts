import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId } from '@/Common/types/Id';
import type { DistrictId } from '@/Common/types/Id';
import { addDays, jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { CardPolicy, cardsOf, newlyEarnedCards, nextCardGoal } from '@/domain/reward/CardPolicy';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const MINATO: DistrictId = must(parseDistrictId('d_minato'));
const START: LocalDate = must(parseLocalDate('2026-10-01'));

/** テスト用: 日付 */
function d(text: string): LocalDate {
  return must(parseLocalDate(text));
}

let seq = 0;
/** テスト用: 訪問記録 */
function visit(districtId: DistrictId, localDate: LocalDate): VisitRecord {
  seq += 1;
  return {
    spotId: must(parseSpotId(districtId === JOKA ? 'l_jo01' : 'l_mi01')),
    districtId,
    visitedAt: jstInstantOf(localDate, 10),
    localDate,
    operationId: must(parseOperationId(`00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`)),
  };
}

/** テスト用: START から1日おきに n 回、城下地区を訪問した記録（すべて秋） */
function autumnVisits(n: number): VisitRecord[] {
  return Array.from({ length: n }, (_, i) => visit(JOKA, addDays(START, i * 2)));
}

describe('銀カード（同じ地区に3回）', () => {
  it('2回では銀カードは無い', () => {
    expect(cardsOf(autumnVisits(2), JOKA)).toEqual([]);
  });

  it('3回で銀カード。earnedOn は3回目の訪問日', () => {
    expect(cardsOf(autumnVisits(3), JOKA)).toEqual([{ rank: 'silver', reason: 'visits', earnedOn: d('2026-10-05') }]);
  });

  it('9回では銀のみ', () => {
    expect(cardsOf(autumnVisits(9), JOKA).map((c) => c.rank)).toEqual(['silver']);
  });
});

describe('金カード（同じ地区に10回、または四季すべて）', () => {
  it('10回で金カード（理由: 回数）。earnedOn は10回目の訪問日', () => {
    const cards = cardsOf(autumnVisits(10), JOKA);
    expect(cards).toEqual([
      { rank: 'silver', reason: 'visits', earnedOn: d('2026-10-05') },
      { rank: 'gold', reason: 'visits', earnedOn: d('2026-10-19') },
    ]);
  });

  it('四季すべてで訪問すれば4回でも金カード（理由: 四季）', () => {
    const visits = [d('2026-03-10'), d('2026-07-01'), d('2026-10-01'), d('2026-12-20')].map((x) => visit(JOKA, x));
    expect(cardsOf(visits, JOKA)).toEqual([
      { rank: 'silver', reason: 'visits', earnedOn: d('2026-10-01') },
      { rank: 'gold', reason: 'seasons', earnedOn: d('2026-12-20') },
    ]);
  });

  it('3季節だけなら金カードは無い', () => {
    const visits = [d('2026-03-10'), d('2026-07-01'), d('2026-10-01'), d('2026-10-20'), d('2026-11-05')].map((x) => visit(JOKA, x));
    expect(cardsOf(visits, JOKA).map((c) => c.rank)).toEqual(['silver']);
  });

  it('10回目と四季達成が同じ日なら理由は回数', () => {
    const visits = [...Array.from({ length: 9 }, (_, i) => visit(JOKA, addDays(d('2026-04-01'), i * 30))), visit(JOKA, d('2027-01-10'))];
    const gold = cardsOf(visits, JOKA).find((c) => c.rank === 'gold');
    expect(gold).toEqual({ rank: 'gold', reason: 'visits', earnedOn: d('2027-01-10') });
  });

  it('四季が先にそろえば、後で10回に達しても理由は四季のまま', () => {
    const seasons = [d('2026-03-10'), d('2026-07-01'), d('2026-10-01'), d('2026-12-20')].map((x) => visit(JOKA, x));
    const more = Array.from({ length: 8 }, (_, i) => visit(JOKA, addDays(d('2027-01-01'), i)));
    expect(cardsOf([...seasons, ...more], JOKA).find((c) => c.rank === 'gold')).toEqual({ rank: 'gold', reason: 'seasons', earnedOn: d('2026-12-20') });
  });
});

describe('カードは減らない・記録の順序に左右されない（D4, DI-05）', () => {
  it('訪問を1件ずつ足しても、獲得済みのカードは消えず earnedOn も変わらない', () => {
    const visits = [...autumnVisits(5), ...[d('2027-01-10'), d('2027-04-10'), d('2027-07-10')].map((x) => visit(JOKA, x)), ...autumnVisits(4).map((v) => visit(JOKA, addDays(v.localDate, 400)))];
    for (let k = 0; k < visits.length; k += 1) {
      const before = cardsOf(visits.slice(0, k), JOKA);
      const after = cardsOf(visits.slice(0, k + 1), JOKA);
      for (const card of before) expect(after).toContainEqual(card);
    }
  });

  it('記録の並びが逆でも同じ結果になる', () => {
    const visits = autumnVisits(10);
    expect(cardsOf([...visits].reverse(), JOKA)).toEqual(cardsOf(visits, JOKA));
  });

  it('他の地区の訪問は数えない', () => {
    const visits = [...autumnVisits(2), ...Array.from({ length: 10 }, (_, i) => visit(MINATO, addDays(START, i)))];
    expect(cardsOf(visits, JOKA)).toEqual([]);
    expect(cardsOf(visits, MINATO).map((c) => c.rank)).toEqual(['silver', 'gold']);
  });
});

describe('次のカードの目標', () => {
  it.each([
    [0, { rank: 'silver', remainingVisits: 3 }],
    [2, { rank: 'silver', remainingVisits: 1 }],
    [3, { rank: 'gold', remainingVisits: 7 }],
    [9, { rank: 'gold', remainingVisits: 1 }],
  ])('%i 回訪問済みなら %o', (count, goal) => {
    expect(nextCardGoal(autumnVisits(count), JOKA)).toEqual(goal);
  });

  it('10回訪問済みなら目標は無い', () => {
    expect(nextCardGoal(autumnVisits(10), JOKA)).toBeUndefined();
  });

  it('四季で金カードを得ていれば目標は無い', () => {
    const visits = [d('2026-03-10'), d('2026-07-01'), d('2026-10-01'), d('2026-12-20')].map((x) => visit(JOKA, x));
    expect(nextCardGoal(visits, JOKA)).toBeUndefined();
  });
});

describe('新しく獲得したカード（CardAwarded 用）', () => {
  it('訪問前後の差分を返す', () => {
    const before = cardsOf(autumnVisits(9), JOKA);
    const after = cardsOf(autumnVisits(10), JOKA);
    expect(newlyEarnedCards(before, after).map((c) => c.rank)).toEqual(['gold']);
    expect(newlyEarnedCards(after, after)).toEqual([]);
  });

  it('CardPolicy 名前空間から呼べる', () => {
    expect(CardPolicy.cardsOf(autumnVisits(3), JOKA)).toHaveLength(1);
  });
});
