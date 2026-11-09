import { describe, expect, it } from 'vitest';
import { parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { Ranking } from '@/domain/competition/Ranking';
import type { RankingParticipant } from '@/domain/competition/Ranking';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const AS_OF: LocalDate = must(parseLocalDate('2026-11-09'));

/** テスト用: 参加者 */
function p(key: string, name: string, count: number, isMe = false): RankingParticipant {
  return { key, name, isMe, count };
}

describe('Ranking.from', () => {
  it('回数の降順に並べ、同数は同順位にして次の順位を人数分飛ばす（1, 2, 2, 4）', () => {
    const ranking = Ranking.from({
      participants: [p('rival:r_c', 'C', 3), p('rival:r_a', 'A', 9), p('rival:r_b', 'B', 5), p('traveler', '私', 5, true)],
      asOf: AS_OF,
    });
    expect(ranking.entries.map((e) => [e.rank, e.key])).toEqual([
      [1, 'rival:r_a'],
      [2, 'traveler'],
      [2, 'rival:r_b'],
      [4, 'rival:r_c'],
    ]);
    expect(ranking.asOf).toBe(AS_OF);
  });

  it('同数内は 自分 → 名前の昇順 → キーの昇順（入力順に左右されない）', () => {
    const participants = [p('rival:r_z', 'ハナ', 4), p('rival:r_y', 'タロウ', 4), p('traveler', 'ミオ', 4, true), p('rival:r_x', 'タロウ', 4)];
    const expected = ['traveler', 'rival:r_x', 'rival:r_y', 'rival:r_z'];
    expect(Ranking.from({ participants, asOf: AS_OF }).entries.map((e) => e.key)).toEqual(expected);
    expect(Ranking.from({ participants: [...participants].reverse(), asOf: AS_OF }).entries.map((e) => e.key)).toEqual(expected);
  });

  it('全員0回なら全員1位、参加者なしなら空', () => {
    expect(Ranking.from({ participants: [p('a', 'A', 0), p('b', 'B', 0)], asOf: AS_OF }).entries.map((e) => e.rank)).toEqual([1, 1]);
    expect(Ranking.from({ participants: [], asOf: AS_OF }).entries).toEqual([]);
  });

  it('不正な回数（負・小数・非数）は0回として扱い、同じキーは最初の1件だけ残す', () => {
    const ranking = Ranking.from({
      participants: [p('a', 'A', -3), p('b', 'B', Number.NaN), p('c', 'C', 1.5), p('d', 'D', 2), p('d', 'D2', 99)],
      asOf: AS_OF,
    });
    expect(ranking.entries.map((e) => [e.key, e.count, e.rank])).toEqual([
      ['d', 2, 1],
      ['a', 0, 2],
      ['b', 0, 2],
      ['c', 0, 2],
    ]);
  });

  it('スナップショットとして凍結し、入力配列を書き換えない（DI-24）', () => {
    const participants = [p('b', 'B', 1), p('a', 'A', 2)];
    const ranking = Ranking.from({ participants, asOf: AS_OF });
    expect(participants.map((x) => x.key)).toEqual(['b', 'a']);
    expect(Object.isFrozen(ranking)).toBe(true);
    expect(Object.isFrozen(ranking.entries)).toBe(true);
    expect(Object.isFrozen(ranking.entries[0])).toBe(true);
    participants.push(p('c', 'C', 100));
    expect(ranking.entries).toHaveLength(2);
  });
});
