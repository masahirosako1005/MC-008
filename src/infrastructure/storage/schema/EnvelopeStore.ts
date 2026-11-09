/**
 * @file 封筒（schemaVersion・version・data）単位の読み書きと楽観ロック（infrastructure/storage 層）
 * 各 LocalStorage*Repository が共通で使う。キーは prefix（STORAGE_PREFIX）＋ suffix（'traveler.'+id など）。
 * - 読込: JSON → 封筒検証 → 版の移行 → 中身の検証。どこかで読めなければ P+'backup.'+suffix へ退避して STORAGE_FAILED（DI-01, DI-15）
 * - 保存: 保存済みの version が expectedVersion と違えば CONFLICT。一致すれば version+1 で書く（DI-10）
 * localStorage は同期 API なので、読込→比較→書込の間に他の処理は割り込まない（同一タブ内で原子的）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { KeyValueStore, StorageError } from '@/infrastructure/storage/KeyValueStore';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import { migrateEnvelope, quarantineRecord } from '@/infrastructure/storage/schema/migrations';
import { parseEnvelope, wrapEnvelope } from '@/infrastructure/storage/schema/storageSchema';
import type { StoredRecord } from '@/infrastructure/storage/schema/storageSchema';

const logger = createLogger('infrastructure/storage/schema/EnvelopeStore');

/** 楽観ロック付き保存の失敗コード */
export type VersionedWriteErrorCode = 'CONFLICT' | 'STORAGE_FAILED';

/** EnvelopeStore の依存 */
export interface EnvelopeStoreDeps {
  readonly store: KeyValueStore;
  /** 保存キーの接頭辞（STORAGE_PREFIX。デモ 'nnishi.demo.'／本番 'nnishi.'＝DI-23） */
  readonly prefix: string;
}

/** 楽観ロック付き保存の入力 */
export interface VersionedWriteInput {
  /** 接頭辞を除いたキー */
  readonly suffix: string;
  /** 呼び出し側が読んだときの版数（未保存なら 0） */
  readonly expectedVersion: number;
  /** 新しい版数を受け取り、保存する中身を返す */
  readonly build: (nextVersion: number) => unknown;
}

/** 読込の途中結果（退避用に元の文字列も持つ） */
interface RawRead {
  readonly record: StoredRecord;
  readonly raw: string;
}

/** 封筒単位のストア */
export class EnvelopeStore {
  /**
   * ストアを作る。
   * @param deps キー・値ストアと接頭辞
   */
  constructor(private readonly deps: EnvelopeStoreDeps) {}

  /**
   * 接頭辞を付けた完全なキーを返す。
   * @param suffix 接頭辞を除いたキー
   * @returns prefix + suffix
   */
  keyOf(suffix: string): string {
    return `${this.deps.prefix}${suffix}`;
  }

  /**
   * 読めないデータを退避し、STORAGE_FAILED を返す。退避そのものの失敗もログに残す。
   * @param suffix 接頭辞を除いたキー
   * @param raw 元の文字列
   * @param reason 理由（json / envelope / schemaVersion / data）
   * @returns STORAGE_FAILED の失敗（details.reason に理由）
   * @sideEffect 退避データを書き、元のキーを消す
   */
  private quarantine(suffix: string, raw: string, reason: string): Result<never, StorageError> {
    const log = logger.fn('quarantine', { suffix, reason });
    const moved = quarantineRecord({ store: this.deps.store, prefix: this.deps.prefix, suffix, raw, reason });
    if (!moved.ok) log.error('読めない保存データを退避できませんでした', { suffix, reason });
    const message = '保存データを読み込めませんでした。データは退避しました';
    return log.fail(fail(AppError.of('STORAGE_FAILED', message, { suffix, reason, backedUp: moved.ok })));
  }

  /**
   * キーを読み、封筒を検証して現在の版へ移行する。
   * @param suffix 接頭辞を除いたキー
   * @returns 成功: 版数・中身と元の文字列（未保存なら undefined）。失敗: STORAGE_FAILED（読めなければ退避済み）
   * @sideEffect 読めないデータを退避する
   */
  private readRaw(suffix: string): Result<RawRead | undefined, StorageError> {
    const log = logger.fn('readRaw', { suffix });
    const stored = this.deps.store.get(this.keyOf(suffix));
    if (!stored.ok) return log.fail(stored);
    const raw = stored.value;
    if (raw === undefined) return log.exit(ok(undefined), 'notFound');
    const json = parseJsonText(raw, suffix);
    if (!json.ok) return log.fail(this.quarantine(suffix, raw, 'json'));
    const envelope = parseEnvelope(json.value);
    if (!envelope.ok) return log.fail(this.quarantine(suffix, raw, 'envelope'));
    const migrated = migrateEnvelope(envelope.value);
    if (!migrated.ok) return log.fail(this.quarantine(suffix, raw, 'schemaVersion'));
    return log.exit(ok({ record: migrated.value, raw }), `version=${migrated.value.version}`);
  }

  /**
   * キーを読み、中身を parse で検証して返す。
   * @param suffix 接頭辞を除いたキー
   * @param parse 中身の検証関数（版数と中身 → 検証済みの値）
   * @returns 成功: 検証済みの値（未保存なら undefined）。失敗: STORAGE_FAILED（読めなければ退避済み）
   * @sideEffect 読めないデータを退避する
   */
  read<T>(suffix: string, parse: (record: StoredRecord) => Result<T>): Result<T | undefined, StorageError> {
    const log = logger.fn('read', { suffix });
    const loaded = this.readRaw(suffix);
    if (!loaded.ok) return log.fail(loaded);
    if (loaded.value === undefined) return log.exit(ok(undefined), 'notFound');
    const parsed = parse(loaded.value.record);
    if (!parsed.ok) return log.fail(this.quarantine(suffix, loaded.value.raw, 'data'));
    return log.exit(ok(parsed.value));
  }

  /**
   * 保存済みの版数を返す（未保存なら 0）。中身は検証しない。
   * @param suffix 接頭辞を除いたキー
   * @returns 成功: 版数。失敗: STORAGE_FAILED（封筒が読めなければ退避済み）
   */
  storedVersion(suffix: string): Result<number, StorageError> {
    const log = logger.fn('storedVersion', { suffix });
    const loaded = this.readRaw(suffix);
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value?.record.version ?? 0));
  }

  /**
   * 楽観ロック付きで保存する。保存済みの版数が expectedVersion と違えば書かずに CONFLICT。
   * @param input キー・期待する版数・中身の組み立て関数
   * @returns 成功: 新しい版数（expectedVersion + 1）。失敗: CONFLICT / STORAGE_FAILED
   * @sideEffect ストアに封筒を書く
   * @see docs/06 DI-10, DI-12
   */
  writeVersioned(input: VersionedWriteInput): Result<number, AppError<VersionedWriteErrorCode>> {
    const log = logger.fn('writeVersioned', { suffix: input.suffix, expectedVersion: input.expectedVersion });
    const current = this.storedVersion(input.suffix);
    if (!current.ok) return log.fail(current);
    if (current.value !== input.expectedVersion) {
      const details = { suffix: input.suffix, expectedVersion: input.expectedVersion, storedVersion: current.value };
      return log.fail(fail(AppError.of('CONFLICT', '他の操作で更新されています。もう一度お試しください', details)));
    }
    const nextVersion = input.expectedVersion + 1;
    const written = this.write(input.suffix, { version: nextVersion, data: input.build(nextVersion) });
    if (!written.ok) return log.fail(written);
    return log.exit(ok(nextVersion));
  }

  /**
   * 版数の比較をせずに保存する（セッション・ライバル行動など、単一の書き手が上書きするデータ用）。
   * @param suffix 接頭辞を除いたキー
   * @param record 版数と中身
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect ストアに封筒を書く
   */
  write(suffix: string, record: StoredRecord): Result<void, StorageError> {
    const log = logger.fn('write', { suffix, version: record.version });
    const text = wrapEnvelope(record);
    if (!text.ok) return log.fail(text);
    const saved = this.deps.store.set(this.keyOf(suffix), text.value);
    return saved.ok ? log.exit(saved) : log.fail(saved);
  }

  /**
   * キーを消す（未保存でも成功）。
   * @param suffix 接頭辞を除いたキー
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect ストアから削除する
   */
  remove(suffix: string): Result<void, StorageError> {
    const log = logger.fn('remove', { suffix });
    const removed = this.deps.store.remove(this.keyOf(suffix));
    return removed.ok ? log.exit(removed) : log.fail(removed);
  }
}
