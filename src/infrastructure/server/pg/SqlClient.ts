/**
 * @file PostgreSQL への問い合わせの IF（infrastructure/server/pg 層。docs/12 §4）
 * 利用者データのサーバー（商用版）は PostgreSQL に保存する。本番は pg（PgSqlClient）、テストは PGlite（testing/PgliteSqlClient）が実装し、
 * リポジトリはこの IF だけを使う（ドライバーの違いを持ち込まない）。
 * - 値は必ず $1, $2… のプレースホルダーで渡す（SQL に文字列をつながない＝SEC-08）
 * - 日時・日付は SQL の側で文字列（'YYYY-MM-DDTHH:mm:ss.sssZ'・'YYYY-MM-DD'）にして読む。ドライバーの Date 変換（タイムゾーンのずれ）に頼らない（DI-04）
 * - メソッドはドライバーの例外をそのまま投げる。呼び出し側（リポジトリ）が Result に変える（docs/03 §5）
 */

/** 問い合わせ結果の1行（列名 → 値。未検証） */
export type SqlRow = Readonly<Record<string, unknown>>;

/** SQL を実行できるもの（接続プール、または1つのトランザクション） */
export interface SqlExecutor {
  /**
   * 1つの文を実行する。
   * @param sql SQL（値は $1… で渡す）
   * @param params プレースホルダーの値
   * @returns 結果の行（行を返さない文は空の配列）
   * @throws ドライバーの例外（制約違反・接続の失敗など）
   */
  query(sql: string, params?: readonly unknown[]): Promise<readonly SqlRow[]>;
  /**
   * 値を持たない複数の文をまとめて実行する（形の版を進める SQL 用）。
   * @param sql `;` で区切った SQL
   * @throws ドライバーの例外
   */
  execScript(sql: string): Promise<void>;
}

/** PostgreSQL への接続 */
export interface SqlClient extends SqlExecutor {
  /**
   * トランザクションの中で work を実行する。work が値を返せば COMMIT、例外を投げれば ROLLBACK して投げ直す（DI-12）。
   * @param work トランザクションの中で実行する処理
   * @returns work の戻り値
   * @throws work またはドライバーの例外
   */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** 接続を閉じる */
  close(): Promise<void>;
}
