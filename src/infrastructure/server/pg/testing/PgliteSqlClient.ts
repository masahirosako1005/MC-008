/**
 * @file テスト・自分の PC 用の PostgreSQL（PGlite＝WASM 版の PostgreSQL。メモリ上、またはフォルダに保存。infrastructure/server/pg/testing 層）
 * 自分の PC に PostgreSQL や Docker が無くても、本番と同じ SQL（制約・トリガー・jsonb）でリポジトリを試験できる。
 * 開発用の依存（devDependencies）なので、サーバーのビルドには含めない（vite.server.config.ts で外部扱い。--pglite-dir のときだけ node_modules から読む）。
 * 本体は create の中で動的に読み込む（型だけを静的に import する）。静的に import すると、サーバーを1ファイルにまとめたときに
 * 先頭の import になり、node_modules の無い場所（本番のコンテナ）では --pglite-dir を使わなくても起動できなくなるため。
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { createLogger } from '@/Common/logging/logger';
import type { SqlClient, SqlExecutor, SqlRow } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/server/pg/testing/PgliteSqlClient');

/**
 * PGlite（本体またはトランザクション）を SqlExecutor にする。
 * @param target PGlite またはそのトランザクション
 * @returns SqlExecutor
 */
function executorOf(target: PGlite | Transaction): SqlExecutor {
  return {
    /**
     * 1つの文を実行する。
     * @param sql SQL
     * @param params プレースホルダーの値
     * @returns 結果の行
     */
    async query(sql: string, params: readonly unknown[] = []): Promise<readonly SqlRow[]> {
      const log = logger.fn('query', { params: params.length });
      const result = await target.query<SqlRow>(sql, [...params]);
      return log.exit(result.rows, `rows=${result.rows.length}`);
    },
    /**
     * 値を持たない複数の文を実行する。
     * @param sql `;` で区切った SQL
     */
    async execScript(sql: string): Promise<void> {
      const log = logger.fn('execScript', { length: sql.length });
      await target.exec(sql);
      log.exit(undefined);
    },
  };
}

/** テスト用の PostgreSQL への接続 */
export class PgliteSqlClient implements SqlClient {
  private readonly executor: SqlExecutor;

  /**
   * PGlite を受け取る（外からは create を使う）。
   * @param db PGlite
   */
  private constructor(private readonly db: PGlite) {
    this.executor = executorOf(db);
  }

  /**
   * DB を開く。
   * @param dataDir データを置くフォルダ（省略時はメモリ上の空の DB）
   * @returns PgliteSqlClient
   * @sideEffect dataDir を指定したときはそのフォルダに保存する
   */
  static async create(dataDir?: string): Promise<PgliteSqlClient> {
    const log = logger.fn('create', { persistent: dataDir !== undefined });
    // 使うときだけ読み込む（ファイル先頭の説明を参照）
    const { PGlite } = await import('@electric-sql/pglite');
    const db =dataDir === undefined ? await PGlite.create() : await PGlite.create(dataDir);
    return log.exit(new PgliteSqlClient(db));
  }

  /**
   * 1つの文を実行する。
   * @param sql SQL
   * @param params プレースホルダーの値
   * @returns 結果の行
   */
  query(sql: string, params?: readonly unknown[]): Promise<readonly SqlRow[]> {
    return this.executor.query(sql, params);
  }

  /**
   * 値を持たない複数の文を実行する。
   * @param sql `;` で区切った SQL
   */
  execScript(sql: string): Promise<void> {
    return this.executor.execScript(sql);
  }

  /**
   * トランザクションの中で work を実行する（例外で ROLLBACK）。
   * @param work トランザクションの中で実行する処理
   * @returns work の戻り値
   */
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const log = logger.fn('transaction');
    const value = await this.db.transaction((tx) => work(executorOf(tx)));
    return log.exit(value);
  }

  /**
   * DB を閉じる。
   * @sideEffect メモリ上の DB を捨てる
   */
  async close(): Promise<void> {
    const log = logger.fn('close');
    await this.db.close();
    log.exit(undefined);
  }
}
