/**
 * @file 1回の操作を1つのトランザクションにまとめる接続（infrastructure/server/pg 層。docs/12 §4.3、DI-12）
 * 訪問は「訪問記録の保存 → 加点（台帳の保存）」と複数のリポジトリにまたがる。リポジトリはそれぞれ transaction() を呼ぶので、
 * そのままだと別々に確定し、途中で失敗すると「訪問だけ記録されて EXP が付かない」状態が残る。
 * この接続で包むと、atomically() の中で呼ばれた query・transaction はすべて同じトランザクションに乗り、
 * どこかが失敗したら全部を取り消す（呼び出しの文脈は AsyncLocalStorage で引き継ぐので、リポジトリやユースケースは変えない）。
 * - 中のリポジトリが例外を Result に変えて握っても、失敗の印が残るので確定しない
 * - 旅人ごとのアドバイザリロックを取り、同じ旅人の操作を順番にする（別の端末からの同時の操作で版数が競合しない）
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '@/Common/logging/logger';
import type { SqlClient, SqlExecutor, SqlRow } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/server/pg/ScopedSqlClient');

/** 進行中のまとまり */
interface Scope {
  readonly tx: SqlExecutor;
  /** 中の処理が失敗したか（true なら確定しない） */
  failed: boolean;
}

/** まとまりを取り消すための例外（atomically の呼び出し側に届く） */
export class AtomicRollback extends Error {
  /**
   * 作る。
   * @param reason 取り消す理由（ログ用）
   */
  constructor(reason: string) {
    super(reason);
    this.name = 'AtomicRollback';
  }
}

/** 1回の操作を1つのトランザクションにまとめる接続 */
export class ScopedSqlClient implements SqlClient {
  private readonly scopes = new AsyncLocalStorage<Scope>();

  /**
   * 作る。
   * @param inner 実際の接続（pg・PGlite）
   */
  constructor(private readonly inner: SqlClient) {}

  /**
   * 1つの文を実行する（まとまりの中ならそのトランザクションで）。
   * @param sql SQL
   * @param params プレースホルダーの値
   * @returns 結果の行
   */
  async query(sql: string, params?: readonly unknown[]): Promise<readonly SqlRow[]> { // audit-ignore: fnlog-missing 文ごとに呼ぶ薄い中継（実際の接続の query が記録する）
    const scope = this.scopes.getStore();
    if (scope === undefined) return this.inner.query(sql, params);
    try {
      return await scope.tx.query(sql, params);
    } catch (error) {
      scope.failed = true; // 失敗した文があるトランザクションは確定できない
      throw error;
    }
  }

  /**
   * 値を持たない複数の文を実行する（まとまりの中ならそのトランザクションで）。
   * @param sql `;` で区切った SQL
   */
  async execScript(sql: string): Promise<void> { // audit-ignore: fnlog-missing 薄い中継（実際の接続の execScript が記録する）
    const scope = this.scopes.getStore();
    if (scope === undefined) return this.inner.execScript(sql);
    try {
      return await scope.tx.execScript(sql);
    } catch (error) {
      scope.failed = true;
      throw error;
    }
  }

  /**
   * トランザクションの中で work を実行する。まとまりの中なら、新しく始めずにそのトランザクションに乗る。
   * @param work トランザクションの中で実行する処理
   * @returns work の戻り値
   * @throws work またはドライバーの例外（まとまりの中なら、まとまり全体が取り消される）
   */
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const log = logger.fn('transaction', { nested: this.scopes.getStore() !== undefined });
    const scope = this.scopes.getStore();
    if (scope === undefined) return log.exit(await this.inner.transaction(work));
    try {
      return log.exit(await work(this));
    } catch (error) {
      scope.failed = true;
      log.warn('まとまりの中の処理が失敗した（全体を取り消す）', { message: error instanceof Error ? error.message : 'unknown' });
      throw error;
    }
  }

  /**
   * work を1つのトランザクションにまとめて実行する。中のどこかが失敗していたら取り消して AtomicRollback を投げる。
   * @param lockKey 順番にする単位（旅人ID）。同じ鍵のまとまりは同時に走らない
   * @param work まとめる処理。確定してよいかを keep で返す（false なら取り消す）
   * @returns work の value
   * @throws AtomicRollback 取り消したとき／ドライバーの例外
   * @sideEffect トランザクションを開始・確定（または取り消し）する
   */
  async atomically<T>(lockKey: string, work: () => Promise<{ readonly value: T; readonly keep: boolean }>): Promise<T> {
    const log = logger.fn('atomically');
    if (this.scopes.getStore() !== undefined) throw new Error('atomically は入れ子にできません');
    const value = await this.inner.transaction(async (tx) => {
      const scope: Scope = { tx, failed: false };
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
      const outcome = await this.scopes.run(scope, work);
      if (scope.failed || !outcome.keep) throw new AtomicRollback(scope.failed ? '中の保存が失敗した' : '後続の処理が失敗した');
      return outcome.value;
    });
    return log.exit(value);
  }

  /**
   * 接続を閉じる。
   * @sideEffect 実際の接続を閉じる
   */
  close(): Promise<void> {
    return this.inner.close();
  }
}
