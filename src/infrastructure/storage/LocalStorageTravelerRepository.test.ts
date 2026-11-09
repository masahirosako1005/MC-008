import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseOperationId, parseSpotId, parseTravelerId } from '@/Common/types/Id';
import { jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { Traveler } from '@/domain/exploration/Traveler';
import type { Spot } from '@/domain/spot/Spot';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageTravelerRepository } from '@/infrastructure/storage/LocalStorageTravelerRepository';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const PREFIX = 'nnishi.demo.';
const TRAVELER_ID = must(parseTravelerId('t_demoregular'));
const KEY = `${PREFIX}traveler.${TRAVELER_ID}`;
const BACKUP_KEY = `${PREFIX}backup.traveler.${TRAVELER_ID}`;
const TODAY: LocalDate = must(parseLocalDate('2026-11-09'));

const SPOT: Spot = {
  id: must(parseSpotId('l_jo01')),
  kind: 'landmark',
  districtId: must(parseDistrictId('d_joka')),
  name: 'N西城跡',
  point: { lat: 34.693784, lng: 135.189742 },
  category: '史跡',
  description: '石垣と天守台が残る城跡。',
  amenities: ['toilet'],
  hours: '終日開放',
  partner: false,
};

/** テスト用: 1回訪問済みの旅人 */
function visitedTraveler(): Traveler {
  const created = Traveler.create(TRAVELER_ID, '通い慣れた人', 'regular');
  const visited = created.visit({
    spot: SPOT,
    meters: 10,
    accuracyM: 5,
    at: jstInstantOf(TODAY, 10),
    localDate: TODAY,
    operationId: must(parseOperationId('0f8fad5b-d9cb-469f-a165-70867728950e')),
  });
  return must(visited).traveler;
}

/** テスト用: ストアとリポジトリ */
function setup(initial: Readonly<Record<string, string>> = {}): { store: InMemoryKeyValueStore; repo: LocalStorageTravelerRepository } {
  const store = new InMemoryKeyValueStore(initial);
  return { store, repo: new LocalStorageTravelerRepository({ store, prefix: PREFIX }) };
}

describe('LocalStorageTravelerRepository', () => {
  it('未保存なら undefined を返す', async () => {
    const { repo } = setup();
    expect(must(await repo.findById(TRAVELER_ID))).toBeUndefined();
  });

  it('保存して読み込むと同じ訪問記録が戻り、版数は 1 になる', async () => {
    const { repo, store } = setup();
    const saved = must(await repo.save(visitedTraveler(), 0));
    expect(saved.version).toBe(1);
    const loaded = must(await repo.findById(TRAVELER_ID));
    expect(loaded?.version).toBe(1);
    expect(loaded?.visits).toEqual(saved.visits);
    expect(loaded?.hasVisited(SPOT.id)).toBe(true);
    const envelope: unknown = JSON.parse(store.snapshot()[KEY] ?? '');
    expect(envelope).toMatchObject({ schemaVersion: 1, version: 1 });
  });

  it('生座標を保存しない（SEC-13）', async () => {
    const { repo, store } = setup();
    must(await repo.save(visitedTraveler(), 0));
    const raw = store.snapshot()[KEY] ?? '';
    expect(raw).not.toContain('"lat"');
    expect(raw).not.toContain('"lng"');
    expect(raw).not.toContain('34.693784');
  });

  it('保存済みの版数と expectedVersion が違えば CONFLICT で、保存内容は変わらない（DI-10）', async () => {
    const { repo, store } = setup();
    const first = must(await repo.save(Traveler.create(TRAVELER_ID, '旅人', 'regular'), 0));
    const before = store.snapshot()[KEY];
    const stale = await repo.save(visitedTraveler(), 0);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('CONFLICT');
    expect(store.snapshot()[KEY]).toBe(before);
    const next = must(await repo.save(visitedTraveler(), first.version));
    expect(next.version).toBe(2);
  });

  it('新規なのに expectedVersion が 0 でなければ CONFLICT', async () => {
    const { repo } = setup();
    const result = await repo.save(Traveler.create(TRAVELER_ID, '旅人', 'regular'), 3);
    expect(result.ok ? undefined : result.error.code).toBe('CONFLICT');
  });

  it('未知の schemaVersion は読み込まず backup へ退避して STORAGE_FAILED（DI-15）', async () => {
    const raw = JSON.stringify({ schemaVersion: 99, version: 1, data: {} });
    const { repo, store } = setup({ [KEY]: raw });
    const result = await repo.findById(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.snapshot()[BACKUP_KEY]).toBe(raw);
    expect(store.snapshot()[KEY]).toBeUndefined();
    expect(must(await repo.findById(TRAVELER_ID))).toBeUndefined();
  });

  it('壊れた JSON は退避して STORAGE_FAILED', async () => {
    const { repo, store } = setup({ [KEY]: '{"schemaVersion":1,' });
    const result = await repo.findById(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.snapshot()[BACKUP_KEY]).toBe('{"schemaVersion":1,');
  });

  it('中身が旅人として不正（改ざん）なら退避して STORAGE_FAILED（DI-01, SEC-21）', async () => {
    const raw = JSON.stringify({ schemaVersion: 1, version: 1, data: { id: TRAVELER_ID, visits: 'many' } });
    const { repo, store } = setup({ [KEY]: raw });
    const result = await repo.findById(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.snapshot()[BACKUP_KEY]).toBe(raw);
  });

  it('キーの旅人ID と中身の旅人ID が違えば読み込まない', async () => {
    const { repo, store } = setup();
    must(await repo.save(visitedTraveler(), 0));
    const otherId = must(parseTravelerId('t_demofirst'));
    store.set(`${PREFIX}traveler.${otherId}`, store.snapshot()[KEY] ?? '');
    const result = await repo.findById(otherId);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });

  it('封筒の版数と中身の版数が違えば読み込まない', async () => {
    const { repo, store } = setup();
    must(await repo.save(visitedTraveler(), 0));
    const envelope = JSON.parse(store.snapshot()[KEY] ?? '') as { version: number };
    store.set(KEY, JSON.stringify({ ...envelope, version: 7 }));
    const result = await repo.findById(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });

  it('delete で消え、デモと本番の名前空間は互いに影響しない（DI-23）', async () => {
    const store = new InMemoryKeyValueStore();
    const demo = new LocalStorageTravelerRepository({ store, prefix: 'nnishi.demo.' });
    const prod = new LocalStorageTravelerRepository({ store, prefix: 'nnishi.' });
    must(await demo.save(visitedTraveler(), 0));
    expect(must(await prod.findById(TRAVELER_ID))).toBeUndefined();
    must(await demo.delete(TRAVELER_ID));
    expect(must(await demo.findById(TRAVELER_ID))).toBeUndefined();
  });
});
