import { describe, expect, it } from 'vitest';
import { ID_PATTERNS, parseOperationId } from '@/Common/types/Id';
import type { OperationId } from '@/Common/types/Id';
import { LEDGER_ENTRY_ID_PATTERN, ledgerEntryIdOf, visitEntryIdFor } from '@/domain/reward/LedgerEntry';

/** テスト用: 検証済みの操作ID を作る */
function op(text: string): OperationId {
  const r = parseOperationId(text);
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('LEDGER_ENTRY_ID_PATTERN（操作ID の形式を Id.ts と共有）', () => {
  it('操作ID の正規表現と同じ判定になる（境界の長さ・大文字・記号を含む）', () => {
    const samples = [UUID, 'abcdef01', 'abcdef0', 'a'.repeat(64), 'a'.repeat(65), 'ABCDEF01', 'abcdef0g', 'abcd ef01', ''];
    for (const sample of samples) {
      const expected = ID_PATTERNS.OperationId.test(sample);
      expect(LEDGER_ENTRY_ID_PATTERN.test(`${sample}:visit`)).toBe(expected);
      expect(LEDGER_ENTRY_ID_PATTERN.test(`${sample}:bonus`)).toBe(expected);
    }
  });
  it('接尾辞は :visit と :bonus だけを受け付ける', () => {
    expect(LEDGER_ENTRY_ID_PATTERN.test(`${UUID}:welcomeBack`)).toBe(false);
    expect(LEDGER_ENTRY_ID_PATTERN.test(`${UUID}:visit:bonus`)).toBe(false);
    expect(LEDGER_ENTRY_ID_PATTERN.test(`${UUID}`)).toBe(false);
    expect(LEDGER_ENTRY_ID_PATTERN.test(`x${UUID}:visit`)).toBe(false);
  });
});

describe('ledgerEntryIdOf / visitEntryIdFor', () => {
  it('同じ操作ID からは常に同じ行ID を作る（DI-07）', () => {
    expect(ledgerEntryIdOf(op(UUID), 'visit')).toBe(`${UUID}:visit`);
    expect(ledgerEntryIdOf(op(UUID), 'welcomeBack')).toBe(`${UUID}:bonus`);
    expect(LEDGER_ENTRY_ID_PATTERN.test(ledgerEntryIdOf(op(UUID), 'welcomeBack'))).toBe(true);
  });
  it('ボーナス行の行ID から同じ操作の訪問行の行ID を返す（訪問行はそのまま）', () => {
    const bonus = ledgerEntryIdOf(op(UUID), 'welcomeBack');
    const visit = ledgerEntryIdOf(op(UUID), 'visit');
    expect(visitEntryIdFor(bonus)).toBe(visit);
    expect(visitEntryIdFor(visit)).toBe(visit);
  });
});
