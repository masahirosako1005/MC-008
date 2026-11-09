/**
 * @file テスト用の利用者のデータ全体のポート（application/testing 層。メモリのみ）
 * DataPort の偽物。キー（接頭辞なし）と値を Map に持ち、削除の失敗も再現できる（failNextDelete）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { DataPort, UserDataEntry } from '@/application/ports/DataPort';

const logger = createLogger('application/testing/InMemoryDataPort');

/** メモリ上の利用者のデータ全体のポート */
export class InMemoryDataPort implements DataPort {
  private readonly entries: Map<string, unknown>;
  /** true なら次の deleteAll を STORAGE_FAILED にする（テスト用） */
  failNextDelete = false;

  /**
   * 初期データを受け取る。
   * @param initial キー（接頭辞なし）と値
   */
  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    this.entries = new Map(Object.entries(initial));
  }

  /**
   * すべて読む（キーの昇順）。
   * @returns キーと値の一覧
   */
  async readAll(): Promise<Result<readonly UserDataEntry[]>> {
    const log = logger.fn('readAll', { size: this.entries.size });
    const keys = [...this.entries.keys()].sort();
    return log.exit(ok(keys.map((key) => ({ key, value: this.entries.get(key) }))));
  }

  /**
   * すべて消す。
   * @returns 成功: 消した件数。failNextDelete のときは STORAGE_FAILED（何も消さない）
   * @sideEffect Map を空にする
   */
  async deleteAll(): Promise<Result<{ readonly removed: number }>> {
    const log = logger.fn('deleteAll', { size: this.entries.size });
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return log.fail(fail(AppError.of('STORAGE_FAILED', '一部のデータを削除できませんでした', { removed: 0, failed: this.entries.size })));
    }
    const removed = this.entries.size;
    this.entries.clear();
    return log.exit(ok({ removed }));
  }

  /**
   * 残っている件数を返す（テストの確認用）。
   * @returns 件数
   */
  size(): number {
    return logger.fn('size').exit(this.entries.size);
  }
}
