import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId, parseTravelerId } from '@/Common/types/Id';
import type { OperationId, SpotId } from '@/Common/types/Id';
import { jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { MAX_ACCURACY_M, VISIT_RADIUS_M } from '@/domain/exploration/constants';
import { PURCHASE_LIMIT_PER_SPOT_PER_DAY, PURCHASE_POINTS } from '@/domain/reward/constants';
import { PointLedger, createLedgerEntry, isLedgerEntryKind, ledgerEntryIdOf, parseLedgerEntry } from '@/domain/reward/PointLedger';
import type { LedgerEntry, LedgerEntryKind } from '@/domain/reward/PointLedger';
import { purchaseEntriesAt, purchaseRejection, purchaseRewardFor } from '@/domain/reward/PurchaseRewardPolicy';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const JOKA = must(parseDistrictId('d_joka'));
const CAFE = must(parseSpotId('s_jo01'));
const BAKERY = must(parseSpotId('s_jo02'));
const TODAY: LocalDate = must(parseLocalDate('2026-11-10'));
const YESTERDAY: LocalDate = must(parseLocalDate('2026-11-09'));

/** テスト用: 操作ID（UUID 形式） */
function op(n: number): OperationId {
  return must(parseOperationId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`));
}

/** テスト用: 台帳の行 */
function entry(n: number, kind: LedgerEntryKind, spotId: SpotId, date: LocalDate, points = 10): LedgerEntry {
  return must(createLedgerEntry({ operationId: op(n), kind, points, districtId: JOKA, spotId, at: jstInstantOf(date, 12), localDate: date }));
}

describe('台帳の購入の行', () => {
  it('行IDは操作ID＋「:purchase」で、保存データからも読み直せる', () => {
    const row = entry(1, 'purchase', CAFE, TODAY);
    expect(row.entryId).toBe(`${op(1)}:purchase`);
    expect(ledgerEntryIdOf(op(1), 'purchase')).toBe(`${op(1)}:purchase`);
    expect(isLedgerEntryKind('purchase')).toBe(true);
    const parsed = parseLedgerEntry(JSON.parse(JSON.stringify(row)));
    expect(parsed.ok && parsed.value.kind).toBe('purchase');
  });

  it('種別と行IDの接尾辞が食い違う保存データは読まない', () => {
    const raw = { ...JSON.parse(JSON.stringify(entry(1, 'purchase', CAFE, TODAY))), entryId: `${op(1)}:visit` };
    expect(parseLedgerEntry(raw).ok).toBe(false);
  });

  it('購入の行は訪問の行が無くても台帳に載り、残高に足される（減らない）', () => {
    const ledger = PointLedger.empty(must(parseTravelerId('t_test01')));
    const appended = must(ledger.append([entry(1, 'visit', CAFE, TODAY, 15), entry(2, 'purchase', CAFE, TODAY, PURCHASE_POINTS)]));
    expect(Number(appended.balance())).toBe(15 + PURCHASE_POINTS);
    const again = must(appended.append([entry(2, 'purchase', CAFE, TODAY, PURCHASE_POINTS)]));
    expect(Number(again.balance())).toBe(15 + PURCHASE_POINTS);
    expect(PointLedger.restore(JSON.parse(JSON.stringify(again.toState()))).ok).toBe(true);
  });
});

describe('purchaseRejection', () => {
  it('お店の中（精度よし・半径以内）なら受け付ける', () => {
    expect(purchaseRejection({ spot: { kind: 'shop' }, meters: 5, accuracyM: 10 })).toBeUndefined();
    expect(purchaseRejection({ spot: { kind: 'shop' }, meters: VISIT_RADIUS_M, accuracyM: MAX_ACCURACY_M })).toBeUndefined();
  });

  it('名所・精度不足・遠すぎは受け付けない', () => {
    expect(purchaseRejection({ spot: { kind: 'landmark' }, meters: 5, accuracyM: 10 })?.code).toBe('NOT_SHOP');
    expect(purchaseRejection({ spot: { kind: 'shop' }, meters: 5, accuracyM: MAX_ACCURACY_M + 1 })?.code).toBe('LOW_ACCURACY');
    expect(purchaseRejection({ spot: { kind: 'shop' }, meters: 5, accuracyM: Number.NaN })?.code).toBe('LOW_ACCURACY');
    expect(purchaseRejection({ spot: { kind: 'shop' }, meters: VISIT_RADIUS_M + 1, accuracyM: 10 })?.code).toBe('OUT_OF_RANGE');
  });
});

describe('purchaseRewardFor', () => {
  it('その日・そのお店の最初の購入には PURCHASE_POINTS が付く', () => {
    expect(purchaseRewardFor([], CAFE, TODAY)).toEqual({ points: PURCHASE_POINTS, limited: false });
  });

  it('同じお店・同じ日の購入が上限に達したら 0 点（別の日・別のお店・訪問の行は数えない）', () => {
    const rows = Array.from({ length: PURCHASE_LIMIT_PER_SPOT_PER_DAY }, (_, i) => entry(10 + i, 'purchase', CAFE, TODAY));
    expect(purchaseRewardFor(rows, CAFE, TODAY)).toEqual({ points: 0, limited: true });
    const others = [entry(1, 'purchase', CAFE, YESTERDAY), entry(2, 'purchase', BAKERY, TODAY), entry(3, 'visit', CAFE, TODAY, 15)];
    expect(purchaseRewardFor(others, CAFE, TODAY).limited).toBe(false);
  });

  it('purchaseEntriesAt はそのお店の購入の行だけを数える', () => {
    const rows = [entry(1, 'purchase', CAFE, YESTERDAY), entry(2, 'purchase', CAFE, TODAY), entry(3, 'visit', CAFE, TODAY, 15), entry(4, 'purchase', BAKERY, TODAY)];
    expect(purchaseEntriesAt(rows, CAFE)).toHaveLength(2);
    expect(purchaseEntriesAt(rows, CAFE, TODAY)).toHaveLength(1);
  });
});
