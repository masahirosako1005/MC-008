import { describe, expect, it } from 'vitest';
import { parseDistrictId, parseRivalId, parseTravelerId } from '@/Common/types/Id';
import { rivalHolder, TRAVELER_HOLDER } from '@/domain/competition/LordHolder';
import { LordshipBoard } from '@/domain/competition/LordshipBoard';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageLordshipRepository } from '@/infrastructure/storage/LocalStorageLordshipRepository';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const PREFIX = 'nnishi.demo.';
const TRAVELER_ID = must(parseTravelerId('t_demoregular'));
const KEY = `${PREFIX}lordship.${TRAVELER_ID}`;
const HONMACHI = must(parseDistrictId('d_honmachi'));
const TARO = rivalHolder(must(parseRivalId('r_taro')));

/** テスト用: 本町の主を旅人→タロウと交代させた盤（取り返し中） */
function lostBoard(): LordshipBoard {
  const mine = LordshipBoard.empty(TRAVELER_ID).apply(HONMACHI, TRAVELER_HOLDER).board;
  return mine.apply(HONMACHI, TARO).board;
}

describe('LocalStorageLordshipRepository', () => {
  it('未保存なら版数0・地区なしの盤を返す', async () => {
    const repo = new LocalStorageLordshipRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    const board = must(await repo.find(TRAVELER_ID));
    expect(board.version).toBe(0);
    expect(board.entries).toEqual([]);
  });

  it('保存して読み込むと主と取り返し中の状態が戻る', async () => {
    const repo = new LocalStorageLordshipRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    const saved = must(await repo.save(lostBoard(), 0));
    expect(saved.version).toBe(1);
    const loaded = must(await repo.find(TRAVELER_ID));
    expect(loaded.holderOf(HONMACHI)).toEqual(TARO);
    expect(loaded.isLostByTraveler(HONMACHI)).toBe(true);
    expect(loaded.version).toBe(1);
  });

  it('古い版数での保存は CONFLICT（DI-10）', async () => {
    const repo = new LocalStorageLordshipRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    const first = must(await repo.save(LordshipBoard.empty(TRAVELER_ID), 0));
    must(await repo.save(first, first.version));
    const stale = await repo.save(lostBoard(), first.version);
    expect(stale.ok ? undefined : stale.error.code).toBe('CONFLICT');
  });

  it('取り返し中なのに主が旅人という不正な盤は退避して STORAGE_FAILED', async () => {
    const data = { travelerId: TRAVELER_ID, version: 1, entries: [{ districtId: HONMACHI, holder: { type: 'traveler' }, lostByTraveler: true }] };
    const raw = JSON.stringify({ schemaVersion: 1, version: 1, data });
    const store = new InMemoryKeyValueStore({ [KEY]: raw });
    const repo = new LocalStorageLordshipRepository({ store, prefix: PREFIX });
    const result = await repo.find(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.snapshot()[`${PREFIX}backup.lordship.${TRAVELER_ID}`]).toBe(raw);
  });

  it('delete で盤が消える', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStorageLordshipRepository({ store, prefix: PREFIX });
    must(await repo.save(lostBoard(), 0));
    must(await repo.delete(TRAVELER_ID));
    expect(store.snapshot()[KEY]).toBeUndefined();
  });
});
