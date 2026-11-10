/**
 * @file ポイント台帳の PostgreSQL リポジトリ（infrastructure/server/pg 層。PointLedgerRepository の実装。docs/12 §4）
 * 台帳はサーバーが正（SEC-21）。行は追記だけで、残高の列は持たない（残高は行から導出＝DI-06）。行の UPDATE は DB のトリガーが拒否する。
 * - 読込は1回の問い合わせで保存形（JSON）を組み立て、PointLedger.restore で検証する（DI-01）
 * - 保存は楽観ロック（DI-10）で「版数を進める＋増えた行だけ足す」を1トランザクションで行う（DI-12）
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import { PointLedger } from '@/domain/reward/PointLedger';
import type { PointLedgerRepository, PointLedgerSaveErrorCode } from '@/domain/reward/PointLedgerRepository';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import { appendNewRows, instantSql, localDateSql, storageFailed } from '@/infrastructure/server/pg/pgSql';
import type { SqlClient, SqlExecutor, SqlRow } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/server/pg/PgPointLedgerRepository');

/** 読めなかったときの文 */
const READ_FAILED = 'ポイントの記録を読めませんでした';
/** 保存できなかったときの文 */
const SAVE_FAILED = 'ポイントの記録を保存できませんでした';

/** 台帳1つ分を保存形の JSON にして読む SQL（行は追記した順） */
const SELECT_LEDGER = `
SELECT l.version,
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'entryId', e.entry_id, 'kind', e.kind, 'points', e.points, 'districtId', e.district_id, 'spotId', e.spot_id,
      'at', ${instantSql('e.at')}, 'localDate', ${localDateSql('e.local_date')}) ORDER BY e.seq), '[]'::jsonb)
     FROM ledger_entries e WHERE e.traveler_id = l.traveler_id)::text AS entries
FROM point_ledgers l WHERE l.traveler_id = $1`;

/** 行を足す SQL の SELECT 句まで */
const INSERT_ENTRIES = `INSERT INTO ledger_entries (traveler_id, entry_id, kind, points, district_id, spot_id, at, local_date)
  SELECT $1, x.item->>'entryId', x.item->>'kind', (x.item->>'points')::integer, x.item->>'districtId', x.item->>'spotId',
         (x.item->>'at')::timestamptz, (x.item->>'localDate')::date`;

/**
 * 版数を進める（新規は版数 1 で作る）。
 * @param tx トランザクション
 * @param travelerId 旅人ID
 * @param expectedVersion 読んだときの版数（新規は 0）
 * @returns 進めた後の版数。保存済みの版数と合わなければ undefined
 */
async function bumpVersion(tx: SqlExecutor, travelerId: TravelerId, expectedVersion: number): Promise<number | undefined> {
  const log = logger.fn('bumpVersion', { travelerId, expectedVersion });
  const rows = expectedVersion === 0
    ? await tx.query('INSERT INTO point_ledgers (traveler_id, version) VALUES ($1, 1) ON CONFLICT (traveler_id) DO NOTHING RETURNING version', [travelerId])
    : await tx.query(
      'UPDATE point_ledgers SET version = version + 1, updated_at = now() WHERE traveler_id = $1 AND version = $2 RETURNING version',
      [travelerId, expectedVersion],
    );
  const version = rows[0]?.['version'];
  return log.exit(typeof version === 'number' ? version : undefined);
}

/** ポイント台帳の PostgreSQL リポジトリ */
export class PgPointLedgerRepository implements PointLedgerRepository {
  /**
   * リポジトリを作る。
   * @param client PostgreSQL への接続
   */
  constructor(private readonly client: SqlClient) {}

  /**
   * 旅人の台帳を読む。
   * @param travelerId 旅人ID
   * @returns 成功: 台帳（未保存なら版数 0 の空の台帳）。失敗: STORAGE_FAILED（DB の失敗）/ INVALID_INPUT（保存データが壊れている）
   */
  async find(travelerId: TravelerId): Promise<Result<PointLedger>> {
    const log = logger.fn('find', { travelerId });
    let row: SqlRow | undefined;
    try {
      row = (await this.client.query(SELECT_LEDGER, [travelerId]))[0];
    } catch (error) {
      return log.fail(storageFailed(READ_FAILED, error));
    }
    if (row === undefined) return log.exit(ok(PointLedger.empty(travelerId)), 'empty');
    const raw = row['entries'];
    const entries = typeof raw === 'string' ? parseJsonText(raw, 'PgLedgerColumn') : undefined;
    const restored = PointLedger.restore({ travelerId, version: row['version'], entries: entries?.ok === true ? entries.value : undefined });
    return restored.ok ? log.exit(restored) : log.fail(restored);
  }

  /**
   * 台帳を保存する（楽観ロック）。
   * @param ledger 保存する台帳
   * @param expectedVersion 読んだときの版数（新規は 0）
   * @returns 成功: 版数を expectedVersion+1 にした台帳。失敗: CONFLICT（保存済みの版数と不一致）/ STORAGE_FAILED（制約違反・DB の失敗）
   * @sideEffect DB に書き込む（失敗時は何も残さない）
   * @see docs/06 DI-06, DI-10, DI-12
   */
  async save(ledger: PointLedger, expectedVersion: number): Promise<Result<PointLedger, AppError<PointLedgerSaveErrorCode>>> {
    const log = logger.fn('save', { travelerId: ledger.travelerId, expectedVersion, entries: ledger.entries.length });
    const travelerId = ledger.travelerId;
    try {
      const version = await this.client.transaction(async (tx) => {
        const next = await bumpVersion(tx, travelerId, expectedVersion);
        if (next !== undefined) await appendNewRows(tx, { table: 'ledger_entries', travelerId, items: ledger.entries, insertSql: INSERT_ENTRIES });
        return next;
      });
      if (version === undefined) return log.fail(fail(AppError.of('CONFLICT', 'ほかの端末で更新されました。もう一度お試しください')));
      return log.exit(ok(ledger.withVersion(version)), `version=${version}`);
    } catch (error) {
      return log.fail(storageFailed(SAVE_FAILED, error));
    }
  }

  /**
   * 台帳を削除する（個人データの削除要求＝PRV-05・DI-22 物理削除。残高を減らす用途に使わない）。
   * @param travelerId 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect DB から削除する
   */
  async delete(travelerId: TravelerId): Promise<Result<void>> {
    const log = logger.fn('delete', { travelerId });
    try {
      await this.client.query('DELETE FROM point_ledgers WHERE traveler_id = $1', [travelerId]);
      return log.exit(okVoid());
    } catch (error) {
      return log.fail(storageFailed('ポイントの記録を削除できませんでした', error));
    }
  }
}
