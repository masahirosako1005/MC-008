import { describe, expect, it } from 'vitest';
import { parseTravelerId } from '@/Common/types/Id';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageSessionRepository } from '@/infrastructure/storage/LocalStorageSessionRepository';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const PREFIX = 'nnishi.demo.';
const KEY = `${PREFIX}session`;
const TRAVELER_ID = must(parseTravelerId('t_demofirst'));

describe('LocalStorageSessionRepository', () => {
  it('未保存なら空のセッションを返す', async () => {
    const repo = new LocalStorageSessionRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    expect(must(await repo.load())).toEqual({});
  });

  it('保存したアクティブな旅人を読み込める', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStorageSessionRepository({ store, prefix: PREFIX });
    must(await repo.save({ activeTravelerId: TRAVELER_ID }));
    expect(must(await repo.load())).toEqual({ activeTravelerId: TRAVELER_ID });
    must(await repo.save({}));
    expect(must(await repo.load())).toEqual({});
    expect(JSON.parse(store.snapshot()[KEY] ?? '')).toMatchObject({ schemaVersion: 1, version: 2 });
  });

  it('旅人ID が形式違反（改ざん）なら退避して STORAGE_FAILED、次の読込は空（SEC-01, DI-01）', async () => {
    const raw = JSON.stringify({ schemaVersion: 1, version: 1, data: { activeTravelerId: '../t_x' } });
    const store = new InMemoryKeyValueStore({ [KEY]: raw });
    const repo = new LocalStorageSessionRepository({ store, prefix: PREFIX });
    const result = await repo.load();
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.snapshot()[`${PREFIX}backup.session`]).toBe(raw);
    expect(must(await repo.load())).toEqual({});
  });

  it('壊れたセッションがあっても保存で上書きできる', async () => {
    const store = new InMemoryKeyValueStore({ [KEY]: '{' });
    const repo = new LocalStorageSessionRepository({ store, prefix: PREFIX });
    must(await repo.save({ activeTravelerId: TRAVELER_ID }));
    expect(must(await repo.load())).toEqual({ activeTravelerId: TRAVELER_ID });
  });
});
