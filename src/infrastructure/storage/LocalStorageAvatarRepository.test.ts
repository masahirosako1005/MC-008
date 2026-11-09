import { describe, expect, it } from 'vitest';
import { parseItemId, parseTravelerId } from '@/Common/types/Id';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageAvatarRepository } from '@/infrastructure/storage/LocalStorageAvatarRepository';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const PREFIX = 'nnishi.demo.';
const TRAVELER_ID = must(parseTravelerId('t_demofirst'));
const KEY = `${PREFIX}avatar.${TRAVELER_ID}`;
const MATSU = must(parseItemId('i_matsu'));

describe('LocalStorageAvatarRepository', () => {
  it('未保存なら空の装い（カメラ）を返す', async () => {
    const repo = new LocalStorageAvatarRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    expect(must(await repo.load(TRAVELER_ID))).toEqual({});
  });

  it('保存した装いを読み込め、版数は保存のたびに増える', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStorageAvatarRepository({ store, prefix: PREFIX });
    must(await repo.save(TRAVELER_ID, { heldItemId: MATSU }));
    expect(must(await repo.load(TRAVELER_ID))).toEqual({ heldItemId: MATSU });
    must(await repo.save(TRAVELER_ID, {}));
    expect(must(await repo.load(TRAVELER_ID))).toEqual({});
    expect(JSON.parse(store.snapshot()[KEY] ?? '')).toMatchObject({ schemaVersion: 1, version: 2 });
  });

  it('アイテムID が形式違反（改ざん）なら退避して STORAGE_FAILED、次の読込は空（DI-01）', async () => {
    const raw = JSON.stringify({ schemaVersion: 1, version: 1, data: { heldItemId: 'javascript:alert(1)' } });
    const store = new InMemoryKeyValueStore({ [KEY]: raw });
    const repo = new LocalStorageAvatarRepository({ store, prefix: PREFIX });
    const result = await repo.load(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(must(await repo.load(TRAVELER_ID))).toEqual({});
  });
});
