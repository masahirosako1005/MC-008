/**
 * @file PostgreSQL のリポジトリで共通に使う SQL の部品と失敗の変換（infrastructure/server/pg 層。docs/12 §4）
 * 日時・日付は SQL の側で保存形と同じ文字列にする（ドライバーの Date 変換に頼らない＝DI-04）。
 * ここの関数に渡すのはコードに書いた列名だけ（外から来た文字列を渡さない＝SEC-08）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SqlExecutor } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/server/pg/pgSql');

/**
 * timestamptz の列を Instant の文字列（'YYYY-MM-DDTHH:mm:ss.sssZ'）にする SQL の式。
 * @param column 列名（コードに書いた定数だけ）
 * @returns SQL の式
 */
export function instantSql(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/**
 * date の列を LocalDate の文字列（'YYYY-MM-DD'）にする SQL の式。
 * @param column 列名（コードに書いた定数だけ）
 * @returns SQL の式
 */
export function localDateSql(column: string): string {
  return `to_char(${column}, 'YYYY-MM-DD')`;
}

/**
 * DB の例外を STORAGE_FAILED の失敗にする。例外の文（SQL・値を含みうる）は利用者向けの文に入れず、cause にだけ残す（SEC-26）。
 * @param message 利用者向けの文
 * @param error DB の例外
 * @returns STORAGE_FAILED の失敗
 */
export function storageFailed(message: string, error: unknown): Result<never, AppError<'STORAGE_FAILED'>> {
  const log = logger.fn('storageFailed');
  log.error('DB の失敗', { message: error instanceof Error ? error.message : 'unknown' });
  return log.exit(fail(AppError.of('STORAGE_FAILED', message, undefined, error)));
}

/** 追記する行の指定 */
export interface AppendRows {
  /** 表の名前（コードに書いた定数だけ） */
  readonly table: string;
  /** 旅人ID */
  readonly travelerId: string;
  /** 集約が持つ行の全体（古い順） */
  readonly items: readonly unknown[];
  /** INSERT … SELECT の SELECT 句（$1 が旅人ID、x.item が1行分の jsonb） */
  readonly insertSql: string;
}

/**
 * 追記専用の表に、まだ保存していない末尾の行だけを足す。
 * 保存済みの件数を数え、それより後ろの行だけを送る（通うほど行が増えても、1回の保存で送るのは増えた分だけ）。
 * 足した後の件数が集約の件数と合わなければ例外にする（集約と DB が食い違ったまま保存しない＝DI-12）。
 * @param tx トランザクション
 * @param rows 追記する行の指定
 * @returns 足した件数
 * @throws Error 件数が合わない／制約違反（呼び出し側のトランザクションが ROLLBACK する）
 */
export async function appendNewRows(tx: SqlExecutor, rows: AppendRows): Promise<number> {
  const log = logger.fn('appendNewRows', { table: rows.table, items: rows.items.length });
  const counted = await tx.query(`SELECT count(*)::integer AS stored FROM ${rows.table} WHERE traveler_id = $1`, [rows.travelerId]);
  const stored = counted[0]?.['stored'];
  if (typeof stored !== 'number' || stored > rows.items.length) throw new Error(`${rows.table}: 保存済みの行が集約より多い`);
  const added = rows.items.slice(stored);
  if (added.length === 0) return log.exit(0);
  const inserted = await tx.query(
    `WITH ins AS (${rows.insertSql} FROM jsonb_array_elements($2::text::jsonb) WITH ORDINALITY AS x(item, ord) ORDER BY x.ord RETURNING 1)
     SELECT count(*)::integer AS added FROM ins`,
    [rows.travelerId, JSON.stringify(added)],
  );
  if (inserted[0]?.['added'] !== added.length) throw new Error(`${rows.table}: 足した件数が合わない`);
  return log.exit(added.length);
}
