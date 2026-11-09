import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId, parseTravelerId } from '@/Common/types/Id';
import type { OperationId } from '@/Common/types/Id';
import { jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import {
  PointLedger,
  createLedgerEntry,
  ledgerEntryIdOf,
  parseLedgerEntry,
  parsePointLedgerState,
} from '@/domain/reward/PointLedger';
import type { LedgerEntry, LedgerEntryKind } from '@/domain/reward/PointLedger';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const TRAVELER = must(parseTravelerId('t_test01'));
const JOKA = must(parseDistrictId('d_joka'));
const CASTLE = must(parseSpotId('l_jo01'));
const CAFE = must(parseSpotId('s_jo01'));
const TODAY: LocalDate = must(parseLocalDate('2026-11-09'));

/** テスト用: 操作ID（UUID 形式） */
function op(n: number): OperationId {
  return must(parseOperationId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`));
}

/** テスト用: 台帳の行 */
function entry(n: number, kind: LedgerEntryKind, points: number): LedgerEntry {
  return must(
    createLedgerEntry({ operationId: op(n), kind, points, districtId: JOKA, spotId: kind === 'visit' ? CASTLE : CAFE, at: jstInstantOf(TODAY, 10), localDate: TODAY }),
  );
}

/** テスト用: 保存データ相当のプレーンな行 */
function rawEntry(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(entry(1, 'visit', 10))), ...overrides };
}

describe('LedgerEntry の作成と検証', () => {
  it('行IDは操作ID＋種別の接尾辞（visit / bonus）になる', () => {
    expect(entry(1, 'visit', 10).entryId).toBe(`${op(1)}:visit`);
    expect(entry(1, 'welcomeBack', 5).entryId).toBe(`${op(1)}:bonus`);
    expect(ledgerEntryIdOf(op(2), 'welcomeBack')).toBe(`${op(2)}:bonus`);
  });

  it.each([
    ['負のポイント', -10],
    ['小数のポイント', 2.5],
    ['NaN', Number.NaN],
  ])('%s の行は作れない', (_label, points) => {
    const r = createLedgerEntry({ operationId: op(1), kind: 'visit', points, districtId: JOKA, spotId: CASTLE, at: jstInstantOf(TODAY), localDate: TODAY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
  });

  it('0 ポイントの行は作れる（境界）', () => {
    expect(entry(1, 'welcomeBack', 0).points).toBe(0);
  });

  it('保存データの行を検証して復元できる', () => {
    const parsed = must(parseLedgerEntry(rawEntry()));
    expect(parsed).toEqual(entry(1, 'visit', 10));
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    ['形が違う', null, 'shape'],
    ['種別が不明', rawEntry({ kind: 'admin' }), 'kind'],
    ['行IDの形式が不正', rawEntry({ entryId: 'abc' }), 'entryId'],
    ['種別と行IDの接尾辞が合わない', rawEntry({ kind: 'welcomeBack' }), 'entryIdKindMismatch'],
    ['ポイントが負', rawEntry({ points: -1 }), 'points'],
    ['ポイントが小数', rawEntry({ points: 0.5 }), 'points'],
    ['ポイントが文字列', rawEntry({ points: '10' }), 'points'],
    ['地区IDが不正', rawEntry({ districtId: 'joka' }), 'fields'],
    ['日付が不正', rawEntry({ localDate: '2026-02-30' }), 'fields'],
  ])('%s 行は INVALID_INPUT', (_label, raw, rule) => {
    const r = parseLedgerEntry(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_INPUT');
      expect(r.error.details?.['rule']).toBe(rule);
    }
  });
});

describe('PointLedger の追記と残高（追記専用＝DI-06）', () => {
  it('空の台帳は残高 0・版数 0', () => {
    const ledger = PointLedger.empty(TRAVELER);
    expect(ledger.balance()).toBe(0);
    expect(ledger.version).toBe(0);
    expect(ledger.travelerId).toBe(TRAVELER);
    expect(ledger.entries).toHaveLength(0);
  });

  it('残高は行の合計から導出する', () => {
    const ledger = must(PointLedger.empty(TRAVELER).append([entry(1, 'visit', 10), entry(1, 'welcomeBack', 5), entry(2, 'visit', 15)]));
    expect(ledger.balance()).toBe(30);
    expect(ledger.entries.map((e) => e.points)).toEqual([10, 5, 15]);
  });

  it('同じ entryId を2回 append しても残高は1回分（冪等＝DI-07）', () => {
    const once = must(PointLedger.empty(TRAVELER).append([entry(1, 'visit', 10)]));
    const twice = must(once.append([entry(1, 'visit', 10)]));
    expect(twice.balance()).toBe(10);
    expect(twice.entries).toHaveLength(1);
    expect(twice).toBe(once); // 新しい行が無ければ同じインスタンス
  });

  it('同じバッチ内の entryId 重複も1回分だけ載せる（後の行は無視）', () => {
    const ledger = must(PointLedger.empty(TRAVELER).append([entry(1, 'visit', 10), entry(1, 'visit', 99)]));
    expect(ledger.balance()).toBe(10);
  });

  it('既存の台帳を変えずに新しい台帳を返す（不変）', () => {
    const before = PointLedger.empty(TRAVELER);
    const after = must(before.append([entry(1, 'visit', 10)]));
    expect(before.balance()).toBe(0);
    expect(after.balance()).toBe(10);
    expect(Object.isFrozen(after.toState().entries)).toBe(true);
  });

  it('同じ操作の訪問行が無いボーナス行は追記できない（全部か無し）', () => {
    const r = PointLedger.empty(TRAVELER).append([entry(2, 'visit', 10), entry(1, 'welcomeBack', 5)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details?.['rule']).toBe('bonusWithoutVisit');
  });

  it('訪問行が先に載っていればボーナス行だけを後から追記できる', () => {
    const withVisit = must(PointLedger.empty(TRAVELER).append([entry(1, 'visit', 10)]));
    expect(must(withVisit.append([entry(1, 'welcomeBack', 5)])).balance()).toBe(15);
  });

  it('型を偽った不正な行（負のポイント）は追記できない', () => {
    const forged = { ...entry(1, 'visit', 10), points: -50 } as unknown as LedgerEntry;
    const r = PointLedger.empty(TRAVELER).append([forged]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
  });

  it('残高が安全な整数の範囲を超える追記は失敗にする', () => {
    const big = must(PointLedger.empty(TRAVELER).append([entry(1, 'visit', Number.MAX_SAFE_INTEGER)]));
    const r = big.append([entry(2, 'visit', 1)]);
    expect(r.ok).toBe(false);
    expect(big.balance()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('残高を直接書き換える操作を持たない（setBalance 等が無い）', () => {
    const ledger = PointLedger.empty(TRAVELER);
    expect('setBalance' in ledger).toBe(false);
    expect('remove' in ledger).toBe(false);
    expect(Object.getOwnPropertyNames(PointLedger.prototype).filter((n) => /^(set|remove|delete|subtract)/i.test(n))).toEqual([]);
  });

  it('withVersion は版数だけを変える。不正な版数はバグとして例外', () => {
    const ledger = must(PointLedger.empty(TRAVELER).append([entry(1, 'visit', 10)]));
    const saved = ledger.withVersion(3);
    expect(saved.version).toBe(3);
    expect(saved.balance()).toBe(10);
    expect(saved.hasEntry(`${op(1)}:visit`)).toBe(true);
    expect(() => ledger.withVersion(-1)).toThrow();
    expect(() => ledger.withVersion(1.5)).toThrow();
  });
});

describe('PointLedger.restore（保存データの検証＝DI-01, DI-02）', () => {
  /** テスト用: 保存データ相当の台帳 */
  function rawLedger(entries: readonly unknown[], overrides: Readonly<Record<string, unknown>> = {}): unknown {
    return { travelerId: 't_test01', version: 2, entries, ...overrides };
  }

  it('toState からの往復で同じ残高・版数になる', () => {
    const ledger = must(PointLedger.empty(TRAVELER).append([entry(1, 'visit', 10), entry(1, 'welcomeBack', 5)])).withVersion(4);
    const restored = must(PointLedger.restore(JSON.parse(JSON.stringify(ledger.toState()))));
    expect(restored.balance()).toBe(15);
    expect(restored.version).toBe(4);
    expect(restored.toState()).toEqual(ledger.toState());
  });

  it('復元した台帳でも同じ entryId の追記は無視される', () => {
    const restored = must(PointLedger.restore(rawLedger([rawEntry()])));
    expect(must(restored.append([entry(1, 'visit', 10)])).balance()).toBe(10);
  });

  it.each([
    ['entryId の重複', rawLedger([rawEntry(), rawEntry()]), 'uniqueEntryId'],
    ['負のポイント', rawLedger([rawEntry({ points: -10 })]), 'points'],
    ['小数のポイント', rawLedger([rawEntry({ points: 10.5 })]), 'points'],
    ['訪問行の無いボーナス行', rawLedger([rawEntry({ kind: 'welcomeBack', entryId: `${op(1)}:bonus` })]), 'bonusWithoutVisit'],
    ['旅人IDが不正', rawLedger([], { travelerId: 'x' }), 'travelerId'],
    ['版数が負', rawLedger([], { version: -1 }), 'version'],
    ['版数が小数', rawLedger([], { version: 1.5 }), 'version'],
    ['entries が配列でない', rawLedger([], { entries: {} }), 'entries'],
  ])('%s は INVALID_INPUT で拒否する', (_label, raw, rule) => {
    const r = PointLedger.restore(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_INPUT');
      expect(r.error.details?.['rule']).toBe(rule);
    }
  });

  it('オブジェクトでない値は拒否する', () => {
    expect(PointLedger.restore('ledger').ok).toBe(false);
    expect(parsePointLedgerState(undefined).ok).toBe(false);
  });
});
