import { describe, expect, it } from 'vitest';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageSettingsRepository } from '@/infrastructure/storage/LocalStorageSettingsRepository';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const PREFIX = 'nnishi.demo.';
const KEY = `${PREFIX}settings`;

describe('LocalStorageSettingsRepository', () => {
  it('未保存なら undefined を返す', async () => {
    const repo = new LocalStorageSettingsRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    expect(must(await repo.load())).toBeUndefined();
  });

  it('保存した文字の大きさを読み込め、版数は保存のたびに増える（キーは P+settings）', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStorageSettingsRepository({ store, prefix: PREFIX });
    must(await repo.save({ textScale: 'large' }));
    expect(must(await repo.load())).toEqual({ textScale: 'large' });
    must(await repo.save({ textScale: 'xlarge' }));
    expect(must(await repo.load())).toEqual({ textScale: 'xlarge' });
    expect(JSON.parse(store.snapshot()[KEY] ?? '')).toEqual({ schemaVersion: 1, version: 2, data: { textScale: 'xlarge' } });
  });

  it('知らない値（改ざん）なら退避して STORAGE_FAILED、次の読込は未保存扱い（DI-01, DI-15）', async () => {
    const raw = JSON.stringify({ schemaVersion: 1, version: 1, data: { textScale: 'huge' } });
    const store = new InMemoryKeyValueStore({ [KEY]: raw });
    const repo = new LocalStorageSettingsRepository({ store, prefix: PREFIX });
    const result = await repo.load();
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(store.snapshot()[`${PREFIX}backup.settings`]).toBeDefined();
    expect(must(await repo.load())).toBeUndefined();
  });

  it('JSON として壊れていても退避して STORAGE_FAILED', async () => {
    const store = new InMemoryKeyValueStore({ [KEY]: '{not json' });
    const repo = new LocalStorageSettingsRepository({ store, prefix: PREFIX });
    const result = await repo.load();
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });
});
