import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseRivalId } from '@/Common/types/Id';
import type { DistrictId, RivalId } from '@/Common/types/Id';
import { parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { isValidIntervalDays, isValidPhase, Rival, RivalActionVisit } from '@/domain/competition/Rival';
import type { RivalPattern } from '@/domain/competition/Rival';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** テスト用: 失敗の details.rule を取り出す */
function ruleOf(r: { ok: true } | { ok: false; error: { code: string; details?: Readonly<Record<string, unknown>> } }): unknown {
  if (r.ok) return 'ok';
  expect(r.error.code).toBe('INVALID_INPUT');
  return r.error.details?.['rule'];
}

const TARO: RivalId = must(parseRivalId('r_taro'));
const JOKA: DistrictId = must(parseDistrictId('d_joka'));
const MINATO: DistrictId = must(parseDistrictId('d_minato'));
const TODAY: LocalDate = must(parseLocalDate('2026-11-09'));

/** テスト用: 背景活動 */
function pattern(intervalDays: number, phase: number, districtId: DistrictId = JOKA): RivalPattern {
  return { districtId, intervalDays, phase };
}

describe('Rival.of', () => {
  it('正しい値からライバルを作り、表示名の前後の空白を除いて凍結する', () => {
    const rival = must(Rival.of({ id: TARO, name: '  おまいり番長 ', patterns: [pattern(4, 1), pattern(9, 4, MINATO)] }));
    expect(rival.name).toBe('おまいり番長');
    expect(rival.patterns).toHaveLength(2);
    expect(Object.isFrozen(rival)).toBe(true);
    expect(Object.isFrozen(rival.patterns)).toBe(true);
    expect(Object.isFrozen(rival.patterns[0])).toBe(true);
  });

  it('背景活動が空のライバルも作れる（デモ行動だけで動く）', () => {
    expect(must(Rival.of({ id: TARO, name: 'タロウ', patterns: [] })).patterns).toEqual([]);
  });

  it('作成後に入力配列を書き換えても影響しない', () => {
    const patterns = [pattern(4, 1)];
    const rival = must(Rival.of({ id: TARO, name: 'タロウ', patterns }));
    patterns.push(pattern(3, 0, MINATO));
    expect(rival.patterns).toHaveLength(1);
  });

  it('intervalDays が1未満・非整数・非数なら拒否する', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ruleOf(Rival.of({ id: TARO, name: 'タロウ', patterns: [pattern(bad, 0)] }))).toBe('intervalDays');
    }
    expect(ruleOf(Rival.of({ id: TARO, name: 'タロウ', patterns: [pattern(1, 0)] }))).toBe('ok');
  });

  it('phase は 0 以上 intervalDays 未満の整数だけを受け付ける（境界値）', () => {
    expect(ruleOf(Rival.of({ id: TARO, name: 'タロウ', patterns: [pattern(4, 0)] }))).toBe('ok');
    expect(ruleOf(Rival.of({ id: TARO, name: 'タロウ', patterns: [pattern(4, 3)] }))).toBe('ok');
    for (const bad of [-1, 4, 0.5, Number.NaN]) {
      expect(ruleOf(Rival.of({ id: TARO, name: 'タロウ', patterns: [pattern(4, bad)] }))).toBe('phase');
    }
  });

  it('同じ地区の背景活動が2件あれば拒否し、位置を details.index に入れる', () => {
    const r = Rival.of({ id: TARO, name: 'タロウ', patterns: [pattern(4, 1), pattern(9, 4, MINATO), pattern(3, 0)] });
    expect(ruleOf(r)).toBe('duplicateDistrict');
    expect(!r.ok && r.error.details?.['index']).toBe(2);
  });

  it('表示名が空・空白だけ・制御文字入り・21文字なら拒否し、20文字は受け付ける', () => {
    const control = `タロ${String.fromCharCode(0x07)}ウ`;
    for (const bad of ['', '   ', control, 'あ'.repeat(21)]) {
      expect(ruleOf(Rival.of({ id: TARO, name: bad, patterns: [] }))).toBe('name');
    }
    expect(ruleOf(Rival.of({ id: TARO, name: 'あ'.repeat(20), patterns: [] }))).toBe('ok');
  });

  it('isValidIntervalDays / isValidPhase は境界を正しく判定する', () => {
    expect(isValidIntervalDays(1)).toBe(true);
    expect(isValidIntervalDays(0)).toBe(false);
    expect(isValidPhase(0, 1)).toBe(true);
    expect(isValidPhase(1, 1)).toBe(false);
  });
});

describe('RivalActionVisit.of', () => {
  it('1回以上の整数なら作れて、operationId も保持する', () => {
    const operationId = must(parseOperationId('0f8e2a4c-1b2d-4e5f-9a0b-1c2d3e4f5a6b'));
    const action = must(RivalActionVisit.of({ rivalId: TARO, districtId: JOKA, localDate: TODAY, count: 1, operationId }));
    expect(action).toEqual({ rivalId: TARO, districtId: JOKA, localDate: TODAY, count: 1, operationId });
    expect(Object.isFrozen(action)).toBe(true);
  });

  it('operationId が無ければキーを持たない', () => {
    const action = must(RivalActionVisit.of({ rivalId: TARO, districtId: JOKA, localDate: TODAY, count: 3 }));
    expect('operationId' in action).toBe(false);
  });

  it('回数が0・負・小数・非数なら拒否する', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(ruleOf(RivalActionVisit.of({ rivalId: TARO, districtId: JOKA, localDate: TODAY, count: bad }))).toBe('count');
    }
  });
});
