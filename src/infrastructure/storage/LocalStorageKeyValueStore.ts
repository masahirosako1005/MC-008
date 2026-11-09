/**
 * @file localStorage を使うキー・値ストア（infrastructure/storage 層）
 * ブラウザの Web Storage へのアクセスはここに閉じ込める。例外（容量超過・プライベートモードのアクセス拒否など）は
 * try/catch で受けて STORAGE_FAILED の Result にする（docs/03 §5、docs/08 §5）。値の中身はログに出さない（SEC-13）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { KeyValueStore, StorageError } from '@/infrastructure/storage/KeyValueStore';

const logger = createLogger('infrastructure/storage/LocalStorageKeyValueStore');

/** 容量超過を表す DOMException の名前（ブラウザごとの差を吸収する） */
const QUOTA_ERROR_NAMES: ReadonlySet<string> = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);

/** 容量超過を表す旧来の DOMException コード */
const LEGACY_QUOTA_ERROR_CODES: ReadonlySet<number> = new Set([22, 1014]);

/** 操作名（ログ・失敗の details 用） */
type StorageOperation = 'get' | 'set' | 'remove' | 'keys' | 'open';

/**
 * 例外が容量超過によるものか判定する。
 * @param error 捕捉した例外
 * @returns 容量超過なら true
 */
export function isQuotaExceeded(error: unknown): boolean {
  const log = logger.fn('isQuotaExceeded');
  if (typeof DOMException === 'undefined' || !(error instanceof DOMException)) return log.exit(false);
  return log.exit(QUOTA_ERROR_NAMES.has(error.name) || LEGACY_QUOTA_ERROR_CODES.has(error.code));
}

/**
 * 捕捉した例外を STORAGE_FAILED にする。利用者向けの文言だけを message に入れ、例外は cause に残す。
 * @param operation 失敗した操作
 * @param error 捕捉した例外
 * @returns STORAGE_FAILED の失敗
 */
function storageFailure(operation: StorageOperation, error: unknown): Result<never, StorageError> {
  const log = logger.fn('storageFailure', { operation });
  const quota = isQuotaExceeded(error);
  const message = quota ? '端末の保存容量が足りません。不要なデータを削除してください' : 'データの保存領域にアクセスできません';
  log.error('ストレージ操作に失敗', { operation, quota });
  return log.exit(fail(AppError.of('STORAGE_FAILED', message, { operation, quota }, error)));
}

/**
 * 既定の Storage（window.localStorage）を返す。window が無い環境（Node など）では例外になる。
 * @returns window.localStorage
 * @throws ReferenceError / SecurityError ブラウザ外・アクセス拒否（呼び出し側の try/catch で受ける）
 */
function defaultStorage(): Storage {
  return window.localStorage;
}

/** localStorage を使うキー・値ストア */
export class LocalStorageKeyValueStore implements KeyValueStore {
  private storage: Storage | undefined;

  /**
   * ストアを作る。Storage の取得は最初の操作まで遅らせる（アクセス拒否も Result で返すため）。
   * @param openStorage Storage を返す関数（省略時は window.localStorage。テストでは偽物を渡す）
   */
  constructor(private readonly openStorage: () => Storage = defaultStorage) {}

  /**
   * Storage を取得する（初回のみ openStorage を呼ぶ）。
   * @returns 成功: Storage。失敗: STORAGE_FAILED（ブラウザ外・アクセス拒否）
   */
  private resolveStorage(): Result<Storage, StorageError> {
    const log = logger.fn('resolveStorage');
    if (this.storage !== undefined) return log.exit(ok(this.storage));
    try {
      this.storage = this.openStorage();
      return log.exit(ok(this.storage));
    } catch (error) {
      return log.fail(storageFailure('open', error));
    }
  }

  /**
   * キーの値を読む。
   * @param key キー
   * @returns 成功: 値（未保存なら undefined）。失敗: STORAGE_FAILED
   */
  get(key: string): Result<string | undefined, StorageError> {
    const log = logger.fn('get', { key });
    const storage = this.resolveStorage();
    if (!storage.ok) return log.fail(storage);
    try {
      const value = storage.value.getItem(key);
      return log.exit(ok(value ?? undefined), `found=${value !== null}`);
    } catch (error) {
      return log.fail(storageFailure('get', error));
    }
  }

  /**
   * キーに値を書く。
   * @param key キー
   * @param value 値（文字列）
   * @returns 成功: void。失敗: STORAGE_FAILED（容量超過は details.quota=true）
   * @sideEffect localStorage に書き込む
   */
  set(key: string, value: string): Result<void, StorageError> {
    const log = logger.fn('set', { key, length: value.length });
    const storage = this.resolveStorage();
    if (!storage.ok) return log.fail(storage);
    try {
      storage.value.setItem(key, value);
      return log.exit(okVoid());
    } catch (error) {
      return log.fail(storageFailure('set', error));
    }
  }

  /**
   * キーを消す。
   * @param key キー
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage から削除する
   */
  remove(key: string): Result<void, StorageError> {
    const log = logger.fn('remove', { key });
    const storage = this.resolveStorage();
    if (!storage.ok) return log.fail(storage);
    try {
      storage.value.removeItem(key);
      return log.exit(okVoid());
    } catch (error) {
      return log.fail(storageFailure('remove', error));
    }
  }

  /**
   * prefix で始まるキーを昇順で返す。
   * @param prefix 接頭辞
   * @returns 成功: キーの一覧。失敗: STORAGE_FAILED
   */
  keys(prefix: string): Result<string[], StorageError> {
    const log = logger.fn('keys', { prefix });
    const storage = this.resolveStorage();
    if (!storage.ok) return log.fail(storage);
    try {
      const matched: string[] = [];
      for (let i = 0; i < storage.value.length; i += 1) {
        const key = storage.value.key(i);
        if (key !== null && key.startsWith(prefix)) matched.push(key);
      }
      return log.exit(ok(matched.sort()), `count=${matched.length}`);
    } catch (error) {
      return log.fail(storageFailure('keys', error));
    }
  }
}
