import { describe, expect, it } from 'vitest';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import type { KeyValueStore, StorageError } from '@/infrastructure/storage/KeyValueStore';
import { backupKeyOf, migrateEnvelope, quarantineRecord } from '@/infrastructure/storage/schema/migrations';
import { parseEnvelope, STORAGE_SCHEMA_VERSION, wrapEnvelope } from '@/infrastructure/storage/schema/storageSchema';

describe('storageSchema', () => {
  it('wrapEnvelope は現在の schemaVersion を付け、parseEnvelope で読み戻せる', () => {
    const text = wrapEnvelope({ version: 3, data: { a: 1 } });
    expect(text.ok).toBe(true);
    if (!text.ok) return;
    const parsed = parseEnvelope(JSON.parse(text.value));
    expect(parsed).toEqual({ ok: true, value: { schemaVersion: STORAGE_SCHEMA_VERSION, version: 3, data: { a: 1 } } });
  });

  it('封筒の形が不正なら INVALID_INPUT', () => {
    expect(parseEnvelope(null).ok).toBe(false);
    expect(parseEnvelope({ schemaVersion: 0, version: 1, data: {} }).ok).toBe(false);
    expect(parseEnvelope({ schemaVersion: 1, version: -1, data: {} }).ok).toBe(false);
    expect(parseEnvelope({ schemaVersion: 1, version: 1 }).ok).toBe(false);
  });
});

describe('migrateEnvelope', () => {
  it('現在の版はそのまま通す', () => {
    expect(migrateEnvelope({ schemaVersion: 1, version: 2, data: 'x' })).toEqual({ ok: true, value: { version: 2, data: 'x' } });
  });

  it('未来の版は UNKNOWN_SCHEMA_VERSION（DI-15）', () => {
    const result = migrateEnvelope({ schemaVersion: STORAGE_SCHEMA_VERSION + 1, version: 1, data: {} });
    expect(result.ok ? undefined : result.error.code).toBe('UNKNOWN_SCHEMA_VERSION');
  });

  it('移行関数が無い古い版も UNKNOWN_SCHEMA_VERSION', () => {
    const result = migrateEnvelope({ schemaVersion: STORAGE_SCHEMA_VERSION - 1, version: 1, data: {} }, {});
    expect(result.ok ? undefined : result.error.code).toBe('UNKNOWN_SCHEMA_VERSION');
  });

  it('移行関数が拒否したら INVALID_INPUT', () => {
    const from = STORAGE_SCHEMA_VERSION - 1;
    const rejecting = { [from]: (): Result<unknown> => fail(AppError.of('INVALID_INPUT', 'x')) };
    const result = migrateEnvelope({ schemaVersion: from, version: 1, data: {} }, rejecting);
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_INPUT');
  });

  it('移行関数があれば順に適用する', () => {
    const from = STORAGE_SCHEMA_VERSION - 1;
    const migrations = { [from]: (data: unknown): Result<unknown> => ok({ migrated: data }) };
    const result = migrateEnvelope({ schemaVersion: from, version: 4, data: 'old' }, migrations);
    expect(result).toEqual({ ok: true, value: { version: 4, data: { migrated: 'old' } } });
  });
});

describe('quarantineRecord', () => {
  it('退避先に複製してから元のキーを消す', () => {
    const store = new InMemoryKeyValueStore({ 'nnishi.traveler.t_ab': 'raw' });
    expect(quarantineRecord({ store, prefix: 'nnishi.', suffix: 'traveler.t_ab', raw: 'raw', reason: 'json' }).ok).toBe(true);
    expect(store.snapshot()).toEqual({ [backupKeyOf('nnishi.', 'traveler.t_ab')]: 'raw' });
    expect(backupKeyOf('nnishi.', 'traveler.t_ab')).toBe('nnishi.backup.traveler.t_ab');
  });

  it('複製に失敗したら元のキーを消さない（データを失わない）', () => {
    const inner = new InMemoryKeyValueStore({ 'nnishi.session': 'raw' });
    const failingSet: KeyValueStore = {
      get: (key) => inner.get(key),
      set: (): Result<void, StorageError> => fail(AppError.of('STORAGE_FAILED', 'full')),
      remove: (key) => inner.remove(key),
      keys: (prefix) => inner.keys(prefix),
    };
    const result = quarantineRecord({ store: failingSet, prefix: 'nnishi.', suffix: 'session', raw: 'raw', reason: 'json' });
    expect(result.ok).toBe(false);
    expect(inner.snapshot()).toEqual({ 'nnishi.session': 'raw' });
  });
});
