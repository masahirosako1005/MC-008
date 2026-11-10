/**
 * @file 旅人集約の PostgreSQL リポジトリ（infrastructure/server/pg 層。TravelerRepository の実装。docs/12 §4）
 * 利用者データをサーバーが正として持つ（SEC-21）。集約は追記専用なので、保存は「版数を進める＋増えた行だけ足す」を1トランザクションで行う。
 * - 読込は1回の問い合わせで保存形（JSON）を組み立て、Traveler.restore で検証する（DI-01）
 * - 保存は楽観ロック（版数の不一致で CONFLICT＝DI-10）。同じスポットの1日1回は UNIQUE 制約でも守る（DI-08）
 * - 失敗したら何も残さない（DI-12）。生の座標は保存しない（PRV-03）
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository, TravelerSaveErrorCode } from '@/domain/exploration/TravelerRepository';
import { checkTravelerInvariants } from '@/domain/exploration/TravelerState';
import type { TravelerState } from '@/domain/exploration/TravelerState';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import { appendNewRows, instantSql, localDateSql, storageFailed } from '@/infrastructure/server/pg/pgSql';
import type { SqlClient, SqlExecutor, SqlRow } from '@/infrastructure/server/pg/SqlClient';

const logger = createLogger('infrastructure/server/pg/PgTravelerRepository');

/** 読めなかったときの文 */
const READ_FAILED = '冒険者データを読めませんでした';
/** 保存できなかったときの文 */
const SAVE_FAILED = '冒険者データを保存できませんでした';

/** 旅人1人分を保存形の JSON にして読む SQL（行は追記した順） */
const SELECT_TRAVELER = `
SELECT t.nickname, t.profile, t.version,
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'spotId', d.spot_id, 'districtId', d.district_id, 'discoveredAt', ${instantSql('d.discovered_at')}) ORDER BY d.seq), '[]'::jsonb)
     FROM traveler_discoveries d WHERE d.traveler_id = t.traveler_id)::text AS discoveries,
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'spotId', v.spot_id, 'districtId', v.district_id, 'visitedAt', ${instantSql('v.visited_at')},
      'localDate', ${localDateSql('v.local_date')}, 'operationId', v.operation_id) ORDER BY v.seq), '[]'::jsonb)
     FROM traveler_visits v WHERE v.traveler_id = t.traveler_id)::text AS visits,
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'shopEventId', r.shop_event_id, 'spotId', r.spot_id, 'redeemedAt', ${instantSql('r.redeemed_at')},
      'operationId', r.operation_id) ORDER BY r.seq), '[]'::jsonb)
     FROM traveler_redemptions r WHERE r.traveler_id = t.traveler_id)::text AS redemptions,
  (SELECT coalesce(jsonb_agg(o.operation_id ORDER BY o.seq), '[]'::jsonb)
     FROM traveler_operations o WHERE o.traveler_id = t.traveler_id)::text AS operations
FROM travelers t WHERE t.traveler_id = $1`;

/** 発見を足す SQL の SELECT 句まで */
const INSERT_DISCOVERIES = `INSERT INTO traveler_discoveries (traveler_id, spot_id, district_id, discovered_at)
  SELECT $1, x.item->>'spotId', x.item->>'districtId', (x.item->>'discoveredAt')::timestamptz`;
/** 訪問を足す SQL の SELECT 句まで */
const INSERT_VISITS = `INSERT INTO traveler_visits (traveler_id, spot_id, district_id, visited_at, local_date, operation_id)
  SELECT $1, x.item->>'spotId', x.item->>'districtId', (x.item->>'visitedAt')::timestamptz, (x.item->>'localDate')::date, x.item->>'operationId'`;
/** クーポン利用を足す SQL の SELECT 句まで */
const INSERT_REDEMPTIONS = `INSERT INTO traveler_redemptions (traveler_id, shop_event_id, spot_id, redeemed_at, operation_id)
  SELECT $1, x.item->>'shopEventId', x.item->>'spotId', (x.item->>'redeemedAt')::timestamptz, x.item->>'operationId'`;

/**
 * JSON の列（文字列）を値にする。壊れていれば undefined（後の検証で落とす）。
 * @param row 行
 * @param column 列名
 * @returns JSON の値
 */
function jsonOf(row: SqlRow, column: string): unknown {
  const log = logger.fn('jsonOf', { column });
  const raw = row[column];
  if (typeof raw !== 'string') return log.exit(undefined);
  const parsed = parseJsonText(raw, 'PgTravelerColumn');
  return log.exit(parsed.ok ? parsed.value : undefined);
}

/**
 * 版数を進める（新規は版数 1 で作る）。
 * @param tx トランザクション
 * @param state 保存する旅人の保存形
 * @param expectedVersion 読んだときの版数（新規は 0）
 * @returns 進めた後の版数。保存済みの版数と合わなければ undefined
 */
async function bumpVersion(tx: SqlExecutor, state: TravelerState, expectedVersion: number): Promise<number | undefined> {
  const log = logger.fn('bumpVersion', { id: state.id, expectedVersion });
  const rows = expectedVersion === 0
    ? await tx.query(
      'INSERT INTO travelers (traveler_id, nickname, profile, version) VALUES ($1, $2, $3, 1) ON CONFLICT (traveler_id) DO NOTHING RETURNING version',
      [state.id, state.nickname, state.profile],
    )
    : await tx.query(
      'UPDATE travelers SET version = version + 1, nickname = $2, profile = $3, updated_at = now() WHERE traveler_id = $1 AND version = $4 RETURNING version',
      [state.id, state.nickname, state.profile, expectedVersion],
    );
  const version = rows[0]?.['version'];
  return log.exit(typeof version === 'number' ? version : undefined);
}

/**
 * 処理済みの操作ID を集約と同じ中身にする（直近の分だけを持つので、古いものは消す）。
 * @param tx トランザクション
 * @param state 保存する旅人の保存形
 */
async function syncOperations(tx: SqlExecutor, state: TravelerState): Promise<void> {
  const log = logger.fn('syncOperations', { ids: state.processedOperationIds.length });
  const ids = JSON.stringify(state.processedOperationIds);
  await tx.query(
    `DELETE FROM traveler_operations WHERE traveler_id = $1
       AND operation_id NOT IN (SELECT jsonb_array_elements_text($2::text::jsonb))`,
    [state.id, ids],
  );
  await tx.query(
    `INSERT INTO traveler_operations (traveler_id, operation_id)
       SELECT $1, x.id FROM jsonb_array_elements_text($2::text::jsonb) WITH ORDINALITY AS x(id, ord)
       ORDER BY x.ord ON CONFLICT (traveler_id, operation_id) DO NOTHING`,
    [state.id, ids],
  );
  log.exit(undefined);
}

/**
 * 増えた記録（発見・訪問・クーポン利用）と処理済みの操作ID を書く。
 * @param tx トランザクション
 * @param state 保存する旅人の保存形
 */
async function writeRecords(tx: SqlExecutor, state: TravelerState): Promise<void> {
  const log = logger.fn('writeRecords', { id: state.id });
  const travelerId = state.id;
  await appendNewRows(tx, { table: 'traveler_discoveries', travelerId, items: state.discoveries, insertSql: INSERT_DISCOVERIES });
  await appendNewRows(tx, { table: 'traveler_visits', travelerId, items: state.visits, insertSql: INSERT_VISITS });
  await appendNewRows(tx, { table: 'traveler_redemptions', travelerId, items: state.redemptions, insertSql: INSERT_REDEMPTIONS });
  await syncOperations(tx, state);
  log.exit(undefined);
}

/** 旅人集約の PostgreSQL リポジトリ */
export class PgTravelerRepository implements TravelerRepository {
  /**
   * リポジトリを作る。
   * @param client PostgreSQL への接続
   */
  constructor(private readonly client: SqlClient) {}

  /**
   * 旅人を読む。
   * @param id 旅人ID
   * @returns 成功: 旅人（未保存なら undefined）。失敗: STORAGE_FAILED（DB の失敗）/ INVALID_INPUT（保存データが壊れている）
   */
  async findById(id: TravelerId): Promise<Result<Traveler | undefined>> {
    const log = logger.fn('findById', { id });
    let row: SqlRow | undefined;
    try {
      row = (await this.client.query(SELECT_TRAVELER, [id]))[0];
    } catch (error) {
      return log.fail(storageFailed(READ_FAILED, error));
    }
    if (row === undefined) return log.exit(ok(undefined), 'none');
    const restored = Traveler.restore({
      id,
      nickname: row['nickname'],
      profile: row['profile'],
      version: row['version'],
      discoveries: jsonOf(row, 'discoveries'),
      visits: jsonOf(row, 'visits'),
      redemptions: jsonOf(row, 'redemptions'),
      processedOperationIds: jsonOf(row, 'operations'),
    });
    return restored.ok ? log.exit(restored) : log.fail(restored);
  }

  /**
   * 旅人を保存する（楽観ロック）。書く前に不変条件を検証し、満たさない集約は書かない。
   * @param traveler 保存する旅人
   * @param expectedVersion 読んだときの版数（新規は 0）
   * @returns 成功: 版数を expectedVersion+1 にした旅人。失敗: CONFLICT（保存済みの版数と不一致）/ STORAGE_FAILED（不変条件違反・制約違反・DB の失敗）
   * @sideEffect DB に書き込む（失敗時は何も残さない）
   * @see docs/06 DI-08, DI-10, DI-12
   */
  async save(traveler: Traveler, expectedVersion: number): Promise<Result<Traveler, AppError<TravelerSaveErrorCode>>> {
    const log = logger.fn('save', { id: traveler.id, expectedVersion, visits: traveler.visits.length });
    const state = traveler.toState();
    const checked = checkTravelerInvariants(state);
    if (!checked.ok) return log.fail(fail(AppError.of('STORAGE_FAILED', SAVE_FAILED, { rule: checked.error.details?.['rule'] })));
    try {
      const version = await this.client.transaction(async (tx) => {
        const next = await bumpVersion(tx, state, expectedVersion);
        if (next !== undefined) await writeRecords(tx, state);
        return next;
      });
      if (version === undefined) return log.fail(fail(AppError.of('CONFLICT', 'ほかの端末で更新されました。もう一度お試しください')));
      return log.exit(ok(traveler.withVersion(version)), `version=${version}`);
    } catch (error) {
      return log.fail(storageFailed(SAVE_FAILED, error));
    }
  }

  /**
   * 旅人を削除する（個人データの削除要求＝PRV-05・DI-22 物理削除。記録の表も一緒に消える）。
   * @param id 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect DB から削除する
   */
  async delete(id: TravelerId): Promise<Result<void>> {
    const log = logger.fn('delete', { id });
    try {
      await this.client.query('DELETE FROM travelers WHERE traveler_id = $1', [id]);
      return log.exit(okVoid());
    } catch (error) {
      return log.fail(storageFailed('冒険者データを削除できませんでした', error));
    }
  }
}
