/**
 * @file PostgreSQL への接続（本番。pg の接続プール。infrastructure/server/pg 層。docs/12 §4）
 * - 接続先は接続文字列（DATABASE_URL）で受け取る。接続文字列・パスワードはログに出さない（SEC-25）
 * - 文ごとの時間切れ（statement_timeout）を付け、遅い問い合わせが接続を占有し続けないようにする
 * - トランザクションは1本の接続を借りて BEGIN〜COMMIT／ROLLBACK を行い、必ず返す
 */
import { Pool } from 'pg';
import type { PoolClient, PoolConfig } from 'pg';
import { createLogger } from '@/Common/logging/logger';
import type { SqlClient, SqlExecutor, SqlRow } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/server/pg/PgSqlClient');

/** 接続プールの既定の本数（1プロセスあたり） */
const DEFAULT_POOL_SIZE = 10;
/** 文ごとの時間切れの既定（ミリ秒） */
const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;
/** 接続を待つ時間の上限（ミリ秒） */
const CONNECTION_TIMEOUT_MS = 5_000;
/** 使っていない接続を閉じるまでの時間（ミリ秒） */
const IDLE_TIMEOUT_MS = 30_000;

/** 接続の設定 */
export interface PgSqlClientOptions {
  /** 接続文字列（postgres://user:pass@host:5432/db）。秘密管理の仕組みから渡す */
  readonly connectionString: string;
  /** TLS でつなぐか（マネージド DB は true。自分の PC の DB は false） */
  readonly ssl: boolean;
  /** 接続プールの本数 */
  readonly poolSize?: number;
  /** 文ごとの時間切れ（ミリ秒） */
  readonly statementTimeoutMs?: number;
}

/** query を持つもの（Pool と PoolClient の共通部分） */
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * pg の Pool／PoolClient を SqlExecutor にする。
 * @param target Pool または借りた接続
 * @returns SqlExecutor
 */
function executorOf(target: Queryable): SqlExecutor {
  return {
    /**
     * 1つの文を実行する。
     * @param sql SQL
     * @param params プレースホルダーの値
     * @returns 結果の行
     */
    async query(sql: string, params: readonly unknown[] = []): Promise<readonly SqlRow[]> {
      const log = logger.fn('query', { params: params.length });
      const result = await target.query(sql, [...params]);
      return log.exit(result.rows as readonly SqlRow[], `rows=${result.rows.length}`); // 行の中身は呼び出し側が検証する（DI-01）
    },
    /**
     * 値を持たない複数の文を実行する（値を渡さないと pg は簡易プロトコルで送るので、複数の文を書ける）。
     * @param sql `;` で区切った SQL
     */
    async execScript(sql: string): Promise<void> {
      const log = logger.fn('execScript', { length: sql.length });
      await target.query(sql);
      log.exit(undefined);
    },
  };
}

/** PostgreSQL への接続（pg の接続プール） */
export class PgSqlClient implements SqlClient {
  private readonly executor: SqlExecutor;

  /**
   * プールを受け取る（外からは connect を使う）。
   * @param pool pg の接続プール
   */
  private constructor(private readonly pool: Pool) {
    this.executor = executorOf(pool);
  }

  /**
   * 接続プールを作る（実際の接続は最初の問い合わせのときに張られる）。
   * @param options 接続の設定
   * @returns PgSqlClient
   * @sideEffect 使っていない接続で起きた失敗（DB の再起動など）をログに残すハンドラを登録する
   */
  static connect(options: PgSqlClientOptions): PgSqlClient {
    const log = logger.fn('connect', { ssl: options.ssl, poolSize: options.poolSize ?? DEFAULT_POOL_SIZE });
    const config: PoolConfig = {
      connectionString: options.connectionString,
      max: options.poolSize ?? DEFAULT_POOL_SIZE,
      statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    };
    const pool = new Pool(config);
    pool.on('error', (error) => logger.fn('poolError').error('使っていない接続で失敗', { message: error.message }));
    return log.exit(new PgSqlClient(pool));
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
   * トランザクションの中で work を実行する。
   * @param work トランザクションの中で実行する処理
   * @returns work の戻り値
   * @throws work またはドライバーの例外（ROLLBACK してから投げ直す）
   */
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const log = logger.fn('transaction');
    const connection: PoolClient = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await connection.query('BEGIN');
      const value = await work(executorOf(connection));
      await connection.query('COMMIT');
      return log.exit(value);
    } catch (error) {
      broken = await rollback(connection);
      log.warn('トランザクションを取り消した', { message: error instanceof Error ? error.message : 'unknown' });
      throw error;
    } finally {
      connection.release(broken); // ROLLBACK も失敗した接続は捨てる（プールに戻さない）
    }
  }

  /**
   * 接続プールを閉じる。
   * @sideEffect すべての接続を閉じる
   */
  async close(): Promise<void> {
    const log = logger.fn('close');
    await this.pool.end();
    log.exit(undefined);
  }
}

/**
 * ROLLBACK する。失敗したらその失敗を返す（呼び出し側が接続を捨てる）。
 * @param connection 借りた接続
 * @returns ROLLBACK の失敗（成功なら undefined）
 */
async function rollback(connection: PoolClient): Promise<Error | undefined> {
  const log = logger.fn('rollback');
  try {
    await connection.query('ROLLBACK');
    return log.exit(undefined);
  } catch (error) {
    log.error('ROLLBACK に失敗', { message: error instanceof Error ? error.message : 'unknown' });
    return log.exit(error instanceof Error ? error : new Error('rollback failed'));
  }
}
