/**
 * @file メモリ上のキー・値ストア（infrastructure/storage 層）
 * テストと、localStorage が使えない環境の代替に使う。プロセス（タブ）を閉じると消える。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { KeyValueStore, StorageError } from '@/infrastructure/storage/KeyValueStore';

const logger = createLogger('infrastructure/storage/InMemoryKeyValueStore');

/** メモリ上のキー・値ストア（失敗しない） */
export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly entries = new Map<string, string>();

  /**
   * 初期値を入れてストアを作る。
   * @param initial 初期のキーと値（省略時は空）
   */
  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(initial)) this.entries.set(key, value);
  }

  /**
   * キーの値を読む。
   * @param key キー
   * @returns 成功: 値（未保存なら undefined）。失敗しない
   */
  get(key: string): Result<string | undefined, StorageError> {
    return ok(this.entries.get(key));
  }

  /**
   * キーに値を書く。
   * @param key キー
   * @param value 値
   * @returns 成功のみ
   * @sideEffect メモリ上の値を上書きする
   */
  set(key: string, value: string): Result<void, StorageError> {
    const log = logger.fn('set', { key, length: value.length });
    this.entries.set(key, value);
    return log.exit(okVoid());
  }

  /**
   * キーを消す。
   * @param key キー
   * @returns 成功のみ
   * @sideEffect メモリ上の値を消す
   */
  remove(key: string): Result<void, StorageError> {
    const log = logger.fn('remove', { key });
    this.entries.delete(key);
    return log.exit(okVoid());
  }

  /**
   * prefix で始まるキーを昇順で返す。
   * @param prefix 接頭辞
   * @returns 成功: キーの一覧。失敗しない
   */
  keys(prefix: string): Result<string[], StorageError> {
    const log = logger.fn('keys', { prefix });
    const matched = [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort();
    return log.exit(ok(matched), `count=${matched.length}`);
  }

  /**
   * 保持しているすべてのキーと値の写しを返す（テストで保存内容を確かめる用）。
   * @returns キー → 値
   */
  snapshot(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.entries);
  }
}
