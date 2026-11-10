import { describe, expect, it } from 'vitest';
import { parseSpotId, parseTravelerId } from '@/Common/types/Id';
import { parseInstant, parseLocalDate } from '@/Common/utils/date';
import type { VisitMemory } from '@/application/ports/VisitMemoryRepository';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { isUserDataKey } from '@/infrastructure/storage/LocalStorageDataPort';
import { LocalStorageVisitMemoryRepository } from '@/infrastructure/storage/LocalStorageVisitMemoryRepository';

/** テスト用: 検証済みの値を取り出す */
function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

const PREFIX = 'nnishi.demo.';
const TRAVELER_ID = must(parseTravelerId('t_demofirst'));
const KEY = `${PREFIX}memories.${TRAVELER_ID}`;
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const UPDATED_AT = '2026-11-09T01:00:00.000Z';

/** 思い出を1件作る */
function memory(date: string, extra: { note?: string; photo?: string }): VisitMemory {
  return { spotId: must(parseSpotId('l_jo01')), localDate: must(parseLocalDate(date)), ...extra, updatedAt: must(parseInstant(UPDATED_AT)) };
}

/** 保存データ（封筒）を作る */
function stored(items: unknown[]): string {
  return JSON.stringify({ schemaVersion: 1, version: 1, data: { items } });
}

describe('LocalStorageVisitMemoryRepository', () => {
  it('未保存なら空を返す', async () => {
    const repo = new LocalStorageVisitMemoryRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    expect(must(await repo.list(TRAVELER_ID))).toEqual([]);
  });

  it('保存した思い出を読み込め、版数は保存のたびに増える。空で保存するとキーごと消える', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStorageVisitMemoryRepository({ store, prefix: PREFIX });
    const items = [memory('2026-11-06', { note: 'メモ' }), memory('2026-11-09', { photo: PHOTO })];
    must(await repo.saveAll(TRAVELER_ID, items));
    expect(must(await repo.list(TRAVELER_ID))).toEqual(items);
    must(await repo.saveAll(TRAVELER_ID, items.slice(0, 1)));
    expect(JSON.parse(store.snapshot()[KEY] ?? '')).toMatchObject({ schemaVersion: 1, version: 2 });
    must(await repo.saveAll(TRAVELER_ID, []));
    expect(store.snapshot()[KEY]).toBeUndefined();
  });

  it('利用者のデータとして書き出し・全削除の対象になる（DI-21・PRV-05）', () => {
    expect(isUserDataKey(KEY, PREFIX)).toBe(true);
  });

  it.each([
    ['JPEG 以外の写真', { spotId: 'l_jo01', localDate: '2026-11-09', photo: 'javascript:alert(1)', updatedAt: UPDATED_AT }],
    ['外部 URL の写真', { spotId: 'l_jo01', localDate: '2026-11-09', photo: 'https://example.com/a.jpg', updatedAt: UPDATED_AT }],
    ['長すぎるメモ', { spotId: 'l_jo01', localDate: '2026-11-09', note: 'あ'.repeat(201), updatedAt: UPDATED_AT }],
    ['メモも写真も無い', { spotId: 'l_jo01', localDate: '2026-11-09', updatedAt: UPDATED_AT }],
    ['不正な ID', { spotId: '<script>', localDate: '2026-11-09', note: 'メモ', updatedAt: UPDATED_AT }],
    ['不正な日付', { spotId: 'l_jo01', localDate: '11/09', note: 'メモ', updatedAt: UPDATED_AT }],
  ])('%s（改ざん）は退避して STORAGE_FAILED、次の読込は空（DI-01）', async (_name, item) => {
    const store = new InMemoryKeyValueStore({ [KEY]: stored([item]) });
    const repo = new LocalStorageVisitMemoryRepository({ store, prefix: PREFIX });
    const result = await repo.list(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
    expect(must(await repo.list(TRAVELER_ID))).toEqual([]);
  });

  it('同じ訪問の思い出が重複していれば退避する', async () => {
    const item = { spotId: 'l_jo01', localDate: '2026-11-09', note: 'メモ', updatedAt: UPDATED_AT };
    const repo = new LocalStorageVisitMemoryRepository({ store: new InMemoryKeyValueStore({ [KEY]: stored([item, item]) }), prefix: PREFIX });
    const result = await repo.list(TRAVELER_ID);
    expect(result.ok ? undefined : result.error.code).toBe('STORAGE_FAILED');
  });
});
