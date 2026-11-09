import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseRivalId, parseTravelerId } from '@/Common/types/Id';
import type { DistrictId } from '@/Common/types/Id';
import { rivalHolder, sameHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import { LordshipBoard, parseLordshipBoardState } from '@/domain/competition/LordshipBoard';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const TRAVELER = must(parseTravelerId('t_demo01'));
const TARO = rivalHolder(must(parseRivalId('r_taro')));
const HANA = rivalHolder(must(parseRivalId('r_hana')));
const ME = TRAVELER_HOLDER;
const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const HONMACHI: DistrictId = must(parseDistrictId('d_honmachi'));
const MINATO: DistrictId = must(parseDistrictId('d_minato'));

/** テスト用: 本町の主が旅人の盤 */
function boardWithMeAsLord(): LordshipBoard {
  return LordshipBoard.empty(TRAVELER, [JOKA, HONMACHI]).apply(HONMACHI, ME).board;
}

describe('LordshipBoard.empty', () => {
  it('全地区が主なし・取り返し中でない・版数0の盤を作り、重複した地区はまとめる', () => {
    const board = LordshipBoard.empty(TRAVELER, [JOKA, HONMACHI, JOKA]);
    expect(board.travelerId).toBe(TRAVELER);
    expect(board.version).toBe(0);
    expect(board.entries.map((e) => e.districtId)).toEqual([JOKA, HONMACHI]);
    expect(board.holderOf(JOKA)).toBeUndefined();
    expect(board.isLostByTraveler(JOKA)).toBe(false);
    expect(Object.isFrozen(board.toState())).toBe(true);
    expect(Object.isFrozen(board.entries)).toBe(true);
  });

  it('地区を省略すると行なしの盤になり、盤に無い地区は主なしとして扱う', () => {
    const board = LordshipBoard.empty(TRAVELER);
    expect(board.entries).toEqual([]);
    expect(board.holderOf(MINATO)).toBeUndefined();
    expect(board.isLostByTraveler(MINATO)).toBe(false);
    expect(board.entryOf(MINATO)).toBeUndefined();
  });
});

describe('LordshipBoard.apply（lostByTraveler の遷移＝D8）', () => {
  it('主なし → 旅人: 交代し、取り返し中にはならない', () => {
    const r = LordshipBoard.empty(TRAVELER, [HONMACHI]).apply(HONMACHI, ME);
    expect(r.changed).toBe(true);
    expect(r.from).toBeUndefined();
    expect(sameHolder(r.board.holderOf(HONMACHI), ME)).toBe(true);
    expect(r.board.isLostByTraveler(HONMACHI)).toBe(false);
  });

  it('旅人 → ライバル: lostByTraveler が true になり、from は旅人', () => {
    const r = boardWithMeAsLord().apply(HONMACHI, TARO);
    expect(r.changed).toBe(true);
    expect(sameHolder(r.from, ME)).toBe(true);
    expect(sameHolder(r.board.holderOf(HONMACHI), TARO)).toBe(true);
    expect(r.board.isLostByTraveler(HONMACHI)).toBe(true);
  });

  it('ライバル → 旅人: lostByTraveler が false に戻る（取り返し）', () => {
    const lost = boardWithMeAsLord().apply(HONMACHI, TARO).board;
    const r = lost.apply(HONMACHI, ME);
    expect(r.changed).toBe(true);
    expect(sameHolder(r.from, TARO)).toBe(true);
    expect(r.board.isLostByTraveler(HONMACHI)).toBe(false);
  });

  it('ライバル → ライバル: lostByTraveler は変えない（true のまま／false のまま）', () => {
    const lost = boardWithMeAsLord().apply(HONMACHI, TARO).board;
    expect(lost.apply(HONMACHI, HANA).board.isLostByTraveler(HONMACHI)).toBe(true);
    const neverMine = LordshipBoard.empty(TRAVELER, [JOKA]).apply(JOKA, TARO).board;
    expect(neverMine.isLostByTraveler(JOKA)).toBe(false);
    expect(neverMine.apply(JOKA, HANA).board.isLostByTraveler(JOKA)).toBe(false);
  });

  it('主なしになれば取り返す相手がいないので lostByTraveler は false', () => {
    const lost = boardWithMeAsLord().apply(HONMACHI, TARO).board;
    const r = lost.apply(HONMACHI, undefined);
    expect(r.changed).toBe(true);
    expect(r.board.holderOf(HONMACHI)).toBeUndefined();
    expect(r.board.isLostByTraveler(HONMACHI)).toBe(false);
  });

  it('同じ主なら changed=false で同じ盤を返す', () => {
    const board = boardWithMeAsLord();
    const r = board.apply(HONMACHI, { type: 'traveler' });
    expect(r.changed).toBe(false);
    expect(r.board).toBe(board);
    expect(sameHolder(r.from, ME)).toBe(true);
    const empty = LordshipBoard.empty(TRAVELER);
    expect(empty.apply(JOKA, undefined).board).toBe(empty);
  });

  it('盤に無い地区は行を追加し、元の盤と版数は変えない', () => {
    const board = boardWithMeAsLord().withVersion(3);
    const r = board.apply(MINATO, HANA);
    expect(r.board.entries.map((e) => e.districtId)).toEqual([JOKA, HONMACHI, MINATO]);
    expect(r.board.version).toBe(3);
    expect(board.holderOf(MINATO)).toBeUndefined();
    expect(board.entries).toHaveLength(2);
  });
});

describe('LordshipBoard.withVersion', () => {
  it('版数だけを変え、不正な版数はバグとして例外にする', () => {
    const board = boardWithMeAsLord();
    expect(board.withVersion(5).version).toBe(5);
    expect(board.withVersion(5).toState().entries).toEqual(board.toState().entries);
    expect(() => board.withVersion(-1)).toThrow();
    expect(() => board.withVersion(1.5)).toThrow();
  });
});

describe('LordshipBoard.restore', () => {
  it('toState → JSON → restore で同じ盤に戻る（主なしの holder はキーごと消える）', () => {
    const board = boardWithMeAsLord().apply(HONMACHI, TARO).board.withVersion(7);
    const json: unknown = JSON.parse(JSON.stringify(board.toState()));
    const restored = must(LordshipBoard.restore(json));
    expect(restored.toState()).toEqual(board.toState());
    expect(restored.isLostByTraveler(HONMACHI)).toBe(true);
  });

  it('holder が null の行は主なしとして受け付ける', () => {
    const r = must(LordshipBoard.restore({ travelerId: 't_demo01', version: 0, entries: [{ districtId: 'd_joka', holder: null, lostByTraveler: false }] }));
    expect(r.holderOf(JOKA)).toBeUndefined();
  });

  it('不正な保存データを規則ごとに拒否する', () => {
    const entry = { districtId: 'd_joka', holder: { type: 'rival', rivalId: 'r_taro' }, lostByTraveler: true };
    const cases: readonly [unknown, string][] = [
      [null, 'shape'],
      [[], 'shape'],
      [{ travelerId: 'x', version: 0, entries: [] }, 'travelerId'],
      [{ travelerId: 't_demo01', version: -1, entries: [] }, 'version'],
      [{ travelerId: 't_demo01', version: 1.5, entries: [] }, 'version'],
      [{ travelerId: 't_demo01', version: 0, entries: {} }, 'entries'],
      [{ travelerId: 't_demo01', version: 0, entries: ['x'] }, 'entry'],
      [{ travelerId: 't_demo01', version: 0, entries: [{ ...entry, districtId: 'joka' }] }, 'districtId'],
      [{ travelerId: 't_demo01', version: 0, entries: [{ ...entry, holder: { type: 'admin' } }] }, 'holder'],
      [{ travelerId: 't_demo01', version: 0, entries: [{ ...entry, lostByTraveler: 'yes' }] }, 'lostByTraveler'],
      [{ travelerId: 't_demo01', version: 0, entries: [{ ...entry, holder: { type: 'traveler' } }] }, 'lostByTraveler'],
      [{ travelerId: 't_demo01', version: 0, entries: [{ districtId: 'd_joka', lostByTraveler: true }] }, 'lostByTraveler'],
      [{ travelerId: 't_demo01', version: 0, entries: [entry, entry] }, 'duplicateDistrict'],
    ];
    for (const [raw, rule] of cases) {
      const r = LordshipBoard.restore(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.code).toBe('INVALID_INPUT');
      expect(!r.ok && r.error.details?.['rule']).toBe(rule);
    }
  });

  it('parseLordshipBoardState は凍結済みの保存形を返す', () => {
    const state = must(parseLordshipBoardState({ travelerId: 't_demo01', version: 2, entries: [{ districtId: 'd_joka', lostByTraveler: false }] }));
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.entries)).toBe(true);
    expect(Object.isFrozen(state.entries[0])).toBe(true);
  });
});
