/**
 * @file 保存データの封筒（schemaVersion・version・data）の形（infrastructure/storage 層）
 * localStorage には集約を `{ schemaVersion, version, data }` の JSON で保存する（docs/08 §5）。
 * - schemaVersion: 保存形式の版（DI-15。読込時に migrations.ts で現在の版へ移行する）
 * - version: 集約の楽観ロック用の版数（DI-10）
 * - data: 集約の保存形（toState() の値）。生座標は入れない（SEC-13）
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import { isNonNegativeInteger } from '@/Common/utils/number';
import type { StorageError } from '@/infrastructure/storage/KeyValueStore';

const logger = createLogger('infrastructure/storage/schema/storageSchema');

/** 現在の保存形式の版 */
export const STORAGE_SCHEMA_VERSION = 1;

/** 保存データの封筒（読み込んだまま。schemaVersion は未知の値もありうる） */
export interface StorageEnvelope {
  readonly schemaVersion: number;
  readonly version: number;
  readonly data: unknown;
}

/** 現在の版に移行済みの保存レコード（版数と中身） */
export interface StoredRecord {
  readonly version: number;
  readonly data: unknown;
}

/**
 * 封筒の形が不正なときの失敗を作る。
 * @param rule 破った規則名
 * @returns INVALID_INPUT の失敗
 */
function invalidEnvelope(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '保存データの形式が正しくありません', { kind: 'StorageEnvelope', rule }));
}

/**
 * 未検証の値（JSON.parse の結果）を封筒として検証する（DI-01）。中身（data）の検証は parsers.ts が行う。
 * @param raw 未検証の値
 * @returns 成功: 封筒。失敗: INVALID_INPUT（details.rule: shape / schemaVersion / version / data）
 */
export function parseEnvelope(raw: unknown): Result<StorageEnvelope> {
  const log = logger.fn('parseEnvelope');
  if (!isRecord(raw)) return log.fail(invalidEnvelope('shape'));
  const schemaVersion = raw['schemaVersion'];
  const version = raw['version'];
  if (!isNonNegativeInteger(schemaVersion) || schemaVersion < 1) return log.fail(invalidEnvelope('schemaVersion'));
  if (!isNonNegativeInteger(version)) return log.fail(invalidEnvelope('version'));
  if (!('data' in raw) || raw['data'] === undefined) return log.fail(invalidEnvelope('data'));
  return log.exit(ok(Object.freeze({ schemaVersion, version, data: raw['data'] })), `schemaVersion=${schemaVersion}`);
}

/**
 * 保存レコードを現在の版の封筒に包んで JSON 文字列にする。
 * @param record 版数と中身（中身は JSON にできるプレーンな値であること）
 * @returns 成功: JSON 文字列。失敗: STORAGE_FAILED（循環参照など JSON にできない値）
 */
export function wrapEnvelope(record: StoredRecord): Result<string, StorageError> {
  const log = logger.fn('wrapEnvelope', { version: record.version });
  const envelope: StorageEnvelope = { schemaVersion: STORAGE_SCHEMA_VERSION, version: record.version, data: record.data };
  try {
    return log.exit(ok(JSON.stringify(envelope)));
  } catch (error) {
    log.error('保存データを JSON にできない');
    return log.fail(fail(AppError.of('STORAGE_FAILED', 'データを保存できませんでした', { rule: 'stringify' }, error)));
  }
}
