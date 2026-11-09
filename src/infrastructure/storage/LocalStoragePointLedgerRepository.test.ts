import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId, parseTravelerId } from '@/Common/types/Id';
import { jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import { createLedgerEntry, PointLedger } from '@/domain/reward/PointLedger';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStoragePointLedgerRepository } from '@/infrastructure/storage/LocalStoragePointLedgerRepository';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const PREFIX = 'nnishi.';
const TRAVELER_ID = must(parseTravelerId('t_0f8fad5bd9cb469fa16570867728950e'));
const KEY = `${PREFIX}ledger.${TRAVELER_ID}`;
const TODAY = must(parseLocalDate('2026-11-09'));

/** テスト用: 訪問1件分（10点）を追記した台帳 */
function ledgerWithVisit(): PointLedger {
  const entry = must(
    createLedgerEntry({
      operationId: must(parseOperationId('0f8fad5b-d9cb-469f-a165-70867728950e')),
      kind: 'visit',
      points: 10,
      districtId: must(parseDistrictId('d_joka')),
      spotId: must(parseSpotId('l_jo01')),
      at: jstInstantOf(TODAY, 10),
      localDate: TODAY,
    }),
  );
  return must(PointLedger.empty(TRAVELER_ID).append([entry]));
}

describe('LocalStoragePointLedgerRepository', () => {
  it('未保存なら版数0の空の台帳を返す', async () => {
    const repo = new LocalStoragePointLedgerRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    const ledger = must(await repo.find(TRAVELER_ID));
    expect(ledger.version).toBe(0);
    expect(ledger.balance()).toBe(0);
  });

  it('保存して読み込むと行と残高が戻り、版数は +1 される', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStoragePointLedgerRepository({ store, prefix: PREFIX });
    const saved = must(await repo.save(ledgerWithVisit(), 0));
    expect(saved.version).toBe(1);
    const loaded = must(await repo.find(TRAVELER_ID));
    expect(loaded.balance()).toBe(10);
    expect(loaded.entries).toEqual(saved.entries);
    expect(store.snapshot()[KEY]).toContain('"schemaVersion":1');
  });

  it('古い版数での保存は CONFLICT（DI-10）', async () => {
    const repo = new LocalStoragePointLedgerRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    must(await repo.save(PointLedger.empty(TRAVELER_ID), 0));
    const result = await repo.save(ledgerWithVisit(), 0);
    expect(result.ok ? undefined : result.error.code).toBe('CONFLICT');
    expect(must(await repo.find(TRAVELER_ID)).balance()).toBe(0);
  });

  it('壊れた JSON は退避して STORAGE_FAILED', async () => {
    const store = new InMemoryKeyValueStore({ [KEY]: 'not json' });
    const repo = new LocalStoragePointLedgerRepository({ store, prefix: PREFIX });
    const result = await repo.find(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.snapshot()[`${PREFIX}backup.ledger.${TRAVELER_ID}`]).toBe('not json');
  });

  it('負のポイント行（改ざん）を含む台帳は読み込まない（DI-06, SEC-21）', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStoragePointLedgerRepository({ store, prefix: PREFIX });
    must(await repo.save(ledgerWithVisit(), 0));
    store.set(KEY, (store.snapshot()[KEY] ?? '').replace('"points":10', '"points":-1000'));
    const result = await repo.find(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });

  it('delete で台帳が消える', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStoragePointLedgerRepository({ store, prefix: PREFIX });
    must(await repo.save(ledgerWithVisit(), 0));
    must(await repo.delete(TRAVELER_ID));
    expect(store.snapshot()[KEY]).toBeUndefined();
    expect(must(await repo.find(TRAVELER_ID)).version).toBe(0);
  });
});
