/**
 * @file 保存形式のマイグレーションと、読めないデータの退避（infrastructure/storage 層）
 * 読込時に封筒の schemaVersion を現在の版（STORAGE_SCHEMA_VERSION）へ移行する。v0.1 は版 1 のみで、移行関数はまだ無い。
 * 読めないデータ（壊れた・移行できない古い版）は読み込まず、P+'backup.'+キー へ退避してから STORAGE_FAILED を返す（DI-15）。
 * 退避は「複製してから元を消す」。複製に失敗したら元は消さない。先に退避したものは上書きしない（データを失わない）。
 * 今より新しい版（新しいアプリが書いたデータを古いアプリが読んだ）は、退避もせず元のまま残す（EnvelopeStore.readRaw。新しいアプリで開けばそのまま読める）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { KeyValueStore, StorageError } from '@/infrastructure/storage/KeyValueStore';
import { STORAGE_SCHEMA_VERSION } from '@/infrastructure/storage/schema/storageSchema';
import type { StorageEnvelope, StoredRecord } from '@/infrastructure/storage/schema/storageSchema';

const logger = createLogger('infrastructure/storage/schema/migrations');

/** 退避先キーの接頭辞（P + BACKUP_KEY_SEGMENT + 元のキー） */
export const BACKUP_KEY_SEGMENT = 'backup.';

/** 1版分の移行関数（版 n の data を版 n+1 の data にする） */
export type Migration = (data: unknown) => Result<unknown>;

/** 版 n → n+1 の移行関数の表（v0.1 は版 1 のみなので空） */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

/** 移行の失敗コード */
export type MigrationErrorCode = 'UNKNOWN_SCHEMA_VERSION' | 'INVALID_INPUT';

/** 退避の入力 */
export interface QuarantineInput {
  readonly store: KeyValueStore;
  /** 保存キーの接頭辞（STORAGE_PREFIX。デモと本番で別＝DI-23） */
  readonly prefix: string;
  /** 接頭辞を除いたキー（例: 'traveler.t_demoregular'） */
  readonly suffix: string;
  /** 退避する元の文字列 */
  readonly raw: string;
  /** 退避の理由（ログ用: json / envelope / schemaVersion / data） */
  readonly reason: string;
}

/**
 * 封筒を現在の版へ移行する。
 * @param envelope 読み込んだ封筒
 * @param migrations 移行関数の表（テストで差し替える。既定は MIGRATIONS）
 * @returns 成功: 現在の版の保存レコード。失敗: UNKNOWN_SCHEMA_VERSION（未来の版・移行関数が無い）/ INVALID_INPUT（移行関数が拒否）
 * @see docs/06 DI-15
 */
export function migrateEnvelope(
  envelope: StorageEnvelope,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): Result<StoredRecord, AppError<MigrationErrorCode>> {
  const log = logger.fn('migrateEnvelope', { schemaVersion: envelope.schemaVersion, current: STORAGE_SCHEMA_VERSION });
  const unknownVersion = fail(
    AppError.of('UNKNOWN_SCHEMA_VERSION', '保存データの版が未対応です', { schemaVersion: envelope.schemaVersion }),
  );
  if (envelope.schemaVersion > STORAGE_SCHEMA_VERSION) return log.fail(unknownVersion);
  let data: unknown = envelope.data;
  for (let from = envelope.schemaVersion; from < STORAGE_SCHEMA_VERSION; from += 1) {
    const migration = migrations[from];
    if (migration === undefined) return log.fail(unknownVersion);
    const migrated = migration(data);
    if (!migrated.ok) return log.fail(fail(AppError.of('INVALID_INPUT', '保存データを移行できません', { from })));
    data = migrated.value;
  }
  return log.exit(ok(Object.freeze({ version: envelope.version, data })));
}

/**
 * 退避先のキーを作る（P + 'backup.' + 元のキー）。
 * @param prefix 保存キーの接頭辞
 * @param suffix 接頭辞を除いたキー
 * @returns 退避先のキー
 */
export function backupKeyOf(prefix: string, suffix: string): string {
  return `${prefix}${BACKUP_KEY_SEGMENT}${suffix}`;
}

/** 同じキーの退避を残す数（仮）。先に退避したもの（本物の記録である見込みが高い）を上書きしない */
export const BACKUP_SLOTS = 3;

/**
 * 退避の書き先を決める。空いている枠（または同じ中身が入っている枠）を先頭から探し、すべて埋まっていれば最後の枠を使う。
 * 枠は P+'backup.'+キー、P+'backup.'+キー+'.2'、…（BACKUP_SLOTS 個）。
 * @param input ストア・接頭辞・キー・元の文字列
 * @returns 成功: 書き先のキー。失敗: STORAGE_FAILED（読めない）
 */
function backupSlotFor(input: QuarantineInput): Result<string, StorageError> {
  const log = logger.fn('backupSlotFor', { suffix: input.suffix });
  const base = backupKeyOf(input.prefix, input.suffix);
  const slots = Array.from({ length: BACKUP_SLOTS }, (_, index) => (index === 0 ? base : `${base}.${index + 1}`));
  for (const slot of slots) {
    const held = input.store.get(slot);
    if (!held.ok) return log.fail(held);
    if (held.value === undefined || held.value === input.raw) return log.exit(ok(slot));
  }
  return log.exit(ok(slots[slots.length - 1] ?? base), '枠が埋まっているので最後の枠を使う');
}

/**
 * 読めない保存データを退避先へ複製し、元のキーを消す。先に退避したデータは上書きしない（空いている枠へ書く。backupSlotFor）。
 * @param input ストア・接頭辞・キー・元の文字列・理由
 * @returns 成功: void。失敗: STORAGE_FAILED（複製できなければ元は消さない）
 * @sideEffect ストアに退避データを書き、元のキーを消す
 * @see docs/06 DI-15
 */
export function quarantineRecord(input: QuarantineInput): Result<void, StorageError> {
  const log = logger.fn('quarantineRecord', { suffix: input.suffix, reason: input.reason, length: input.raw.length });
  const slot = backupSlotFor(input);
  if (!slot.ok) return log.fail(slot);
  const copied = input.store.set(slot.value, input.raw);
  if (!copied.ok) return log.fail(copied);
  const removed = input.store.remove(`${input.prefix}${input.suffix}`);
  if (!removed.ok) return log.fail(removed);
  log.warn('読めない保存データを退避しました', { suffix: input.suffix, reason: input.reason });
  return log.exit(okVoid());
}
