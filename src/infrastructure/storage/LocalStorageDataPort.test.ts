import { describe, expect, it } from 'vitest';
import { AppError, fail } from '@/Common/result/Result';
import { CMS_OVERLAY_KEY } from '@/infrastructure/storage/storageKeys';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { LocalStorageDataPort, STORE_SIDE_SEGMENT, isUserDataKey } from '@/infrastructure/storage/LocalStorageDataPort';

/** テスト用: 成功値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

/** デモと本番の両方のキーが入った端末 */
function seededStore(): InMemoryKeyValueStore {
  return new InMemoryKeyValueStore({
    'nnishi.demo.session': '{"schemaVersion":1,"version":1,"data":{"activeTravelerId":"t_demoregular"}}',
    'nnishi.demo.traveler.t_demoregular': '{"schemaVersion":1,"version":3,"data":{}}',
    'nnishi.demo.settings': '{"schemaVersion":1,"version":1,"data":{"textScale":"large"}}',
    'nnishi.demo.map.prefs': '{"pins":[]}',
    'nnishi.demo.backup.avatar.t_demoregular': 'not json',
    'nnishi.demo.clockOffsetDays': '30',
    'nnishi.demo.cms.overlay': '{"shops":{}}',
    'nnishi.session': '{"schemaVersion":1,"version":1,"data":{}}',
    'nnishi.traveler.t_abc': '{"schemaVersion":1,"version":1,"data":{}}',
    'nnishi.debug': '1',
    'other.app': 'x',
  });
}

describe('isUserDataKey', () => {
  it('店舗CMS の登録内容は利用者のデータに含めない', () => {
    expect(CMS_OVERLAY_KEY.startsWith(STORE_SIDE_SEGMENT)).toBe(true);
    expect(isUserDataKey('nnishi.demo.cms.overlay', 'nnishi.demo.')).toBe(false);
  });

  it('本番の範囲にデモの名前空間と debug フラグは入らない（DI-23）', () => {
    expect(isUserDataKey('nnishi.traveler.t_abc', 'nnishi.')).toBe(true);
    expect(isUserDataKey('nnishi.demo.traveler.t_demoregular', 'nnishi.')).toBe(false);
    expect(isUserDataKey('nnishi.debug', 'nnishi.')).toBe(false);
  });

  it('デモの範囲に本番のキーは入らず、デモの日付のずらしは入る', () => {
    expect(isUserDataKey('nnishi.traveler.t_abc', 'nnishi.demo.')).toBe(false);
    expect(isUserDataKey('nnishi.demo.clockOffsetDays', 'nnishi.demo.')).toBe(true);
  });
});

describe('LocalStorageDataPort', () => {
  it('デモ: 範囲内のデータを接頭辞を除いたキーで昇順に読み、JSON でない値は文字列のまま返す', async () => {
    const port = new LocalStorageDataPort({ store: seededStore(), prefix: 'nnishi.demo.' });
    const entries = must(await port.readAll());
    expect(entries.map((e) => e.key)).toEqual(['backup.avatar.t_demoregular', 'clockOffsetDays', 'map.prefs', 'session', 'settings', 'traveler.t_demoregular']);
    expect(entries.find((e) => e.key === 'settings')?.value).toEqual({ schemaVersion: 1, version: 1, data: { textScale: 'large' } });
    expect(entries.find((e) => e.key === 'backup.avatar.t_demoregular')?.value).toBe('not json');
    expect(entries.find((e) => e.key === 'clockOffsetDays')?.value).toBe(30);
  });

  it('デモ: 全削除は範囲内だけを物理削除し、店舗CMS・本番・ほかのアプリのキーは残す（PRV-05, DI-22）', async () => {
    const store = seededStore();
    const port = new LocalStorageDataPort({ store, prefix: 'nnishi.demo.' });
    expect(must(await port.deleteAll())).toEqual({ removed: 6 });
    expect(Object.keys(store.snapshot()).sort()).toEqual(['nnishi.debug', 'nnishi.demo.cms.overlay', 'nnishi.session', 'nnishi.traveler.t_abc', 'other.app']);
    expect(must(await port.readAll())).toEqual([]);
  });

  it('デモ: 読んだ内容をそのまま置き換えに渡すと、保存している文字列が元と同じになる（DI-21 往復）', async () => {
    const store = seededStore();
    const before = store.snapshot();
    const port = new LocalStorageDataPort({ store, prefix: 'nnishi.demo.' });
    const entries = must(await port.readAll());
    must(await port.deleteAll());
    expect(must(await port.replaceAll(entries))).toEqual({ written: 6 });
    expect(store.snapshot()).toEqual(before);
  });

  it('デモ: 置き換えは範囲内の古いキーを消し、店舗CMS・本番・ほかのアプリのキーには触れない', async () => {
    const store = seededStore();
    const port = new LocalStorageDataPort({ store, prefix: 'nnishi.demo.' });
    must(await port.replaceAll([{ key: 'settings', value: { schemaVersion: 1, version: 1, data: { textScale: 'xlarge' } } }]));
    expect(Object.keys(store.snapshot()).sort()).toEqual(['nnishi.debug', 'nnishi.demo.cms.overlay', 'nnishi.demo.settings', 'nnishi.session', 'nnishi.traveler.t_abc', 'other.app']);
    expect(store.snapshot()['nnishi.demo.settings']).toBe('{"schemaVersion":1,"version":1,"data":{"textScale":"xlarge"}}');
  });

  it.each([['cms.overlay'], ['demo.session'], ['debug'], ['']])('本番: 範囲の外のキー「%s」が混ざっていたら INVALID_INPUT で、何も変えない', async (key) => {
    const store = seededStore();
    const before = store.snapshot();
    const result = await new LocalStorageDataPort({ store, prefix: 'nnishi.' }).replaceAll([{ key: 'settings', value: {} }, { key, value: {} }]);
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
    expect(store.snapshot()).toEqual(before);
  });

  it('デモ: 書いている途中で失敗したら、置き換える前の内容に戻す（DI-12）', async () => {
    const store = seededStore();
    const before = store.snapshot();
    const set = store.set.bind(store);
    let calls = 0;
    // 2件目の書き込みだけ失敗させる（容量超過の再現）
    store.set = (key, value) => {
      calls += 1;
      return calls === 2 ? fail(AppError.of('STORAGE_FAILED', 'quota')) : set(key, value);
    };
    const result = await new LocalStorageDataPort({ store, prefix: 'nnishi.demo.' }).replaceAll([{ key: 'a', value: 1 }, { key: 'b', value: 2 }, { key: 'c', value: 3 }]);
    expect(result.ok ? undefined : [result.error.code, result.error.details]).toEqual(['STORAGE_FAILED', { restored: true }]);
    expect(store.snapshot()).toEqual(before);
  });

  it('本番: 全削除してもデモの名前空間と debug フラグは残す', async () => {
    const store = seededStore();
    const port = new LocalStorageDataPort({ store, prefix: 'nnishi.' });
    expect(must(await port.deleteAll())).toEqual({ removed: 2 });
    expect(store.snapshot()['nnishi.demo.session']).toBeDefined();
    expect(store.snapshot()['nnishi.debug']).toBe('1');
    expect(store.snapshot()['nnishi.session']).toBeUndefined();
  });
});
