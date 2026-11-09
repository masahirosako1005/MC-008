/**
 * @file キー・値ストアの IF（infrastructure/storage 層）
 * localStorage とメモリ実装を差し替えるための最小 IF。すべての操作は Result で失敗を返し、例外を外へ出さない。
 * try/catch はこの IF の実装（LocalStorageKeyValueStore）の中だけに置く（docs/03 §5、docs/08 §5）。
 */
import type { AppError, Result } from '@/Common/result/Result';

/** ストアの失敗コード（容量超過・アクセス拒否など） */
export type StorageErrorCode = 'STORAGE_FAILED';

/** ストア操作の失敗 */
export type StorageError = AppError<StorageErrorCode>;

/** 文字列のキー・値ストア */
export interface KeyValueStore {
  /** キーの値を読む。未保存なら ok(undefined) */
  get(key: string): Result<string | undefined, StorageError>;
  /** キーに値を書く（上書き） */
  set(key: string, value: string): Result<void, StorageError>;
  /** キーを消す（未保存でも成功） */
  remove(key: string): Result<void, StorageError>;
  /** prefix で始まるキーの一覧（昇順） */
  keys(prefix: string): Result<string[], StorageError>;
}
