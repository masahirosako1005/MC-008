/**
 * @file PostgreSQL のリポジトリのテスト（infrastructure/server/pg 層・テスト。PGlite＝メモリ上の PostgreSQL で実行）
 * LocalStorage 版と同じ約束（楽観ロック・検証・追記専用）と、サーバーで足したもの（形の版・UNIQUE 制約・更新を拒否するトリガー・失敗時に何も残さない）を確かめる。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppError, Result } from '@/Common/result/Result';
import { parseDistrictId, parseOperationId, parseSpotId, parseTravelerId } from '@/Common/types/Id';
import type { OperationId } from '@/Common/types/Id';
import { addDays, jstInstantOf, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { Traveler } from '@/domain/exploration/Traveler';
import { createLedgerEntry, PointLedger } from '@/domain/reward/PointLedger';
import type { Spot } from '@/domain/spot/Spot';
import { migrate, PG_SCHEMA_VERSION } from '@/infrastructure/server/pg/migrations';
import { PgPointLedgerRepository } from '@/infrastructure/server/pg/PgPointLedgerRepository';
import { PgTravelerRepository } from '@/infrastructure/server/pg/PgTravelerRepository';
import { PgliteSqlClient } from '@/infrastructure/server/pg/testing/PgliteSqlClient';

/** テスト用: 成功値を取り出す */
function must<T>(result: Result<T, AppError<string>>): T {
  if (!result.ok) throw new Error(`期待しない失敗: ${result.error.code}`);
  return result.value;
}

const TRAVELER_ID = must(parseTravelerId('t_0f8fad5bd9cb469fa16570867728950e'));
const OTHER_ID = must(parseTravelerId('t_7c9e6679742540de944be07fc1f90ae7'));
const TODAY: LocalDate = must(parseLocalDate('2026-11-09'));
const SPOT: Spot = {
  id: must(parseSpotId('l_jo01')),
  kind: 'landmark',
  districtId: must(parseDistrictId('d_joka')),
  name: 'N西城跡',
  point: { lat: 34.693784, lng: 135.189742 },
  category: '史跡',
  description: '石垣と天守台が残る城跡。',
  amenities: ['toilet'],
  hours: '終日開放',
  partner: false,
};

/**
 * テスト用: n 番目の操作ID。
 * @param n 番号
 * @returns 操作ID
 */
function operationId(n: number): OperationId {
  return must(parseOperationId(`0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, '0')}`));
}

/**
 * テスト用: days 日後に訪問した旅人を返す。
 * @param traveler 旅人
 * @param days TODAY からの日数
 * @returns 訪問後の旅人
 */
function visitOn(traveler: Traveler, days: number): Traveler {
  const localDate = addDays(TODAY, days);
  return must(traveler.visit({ spot: SPOT, meters: 10, accuracyM: 5, at: jstInstantOf(localDate, 10), localDate, operationId: operationId(days) })).traveler;
}

/**
 * テスト用: 訪問 n 件分（10点ずつ）を追記した台帳。
 * @param ledger 台帳
 * @param days TODAY からの日数（操作ID にも使う）
 * @returns 追記後の台帳
 */
function entryOn(ledger: PointLedger, days: number): PointLedger {
  const localDate = addDays(TODAY, days);
  const entry = must(createLedgerEntry({
    operationId: operationId(days), kind: 'visit', points: 10, districtId: SPOT.districtId, spotId: SPOT.id, at: jstInstantOf(localDate, 10), localDate,
  }));
  return must(ledger.append([entry]));
}

let client: PgliteSqlClient;

beforeAll(async () => {
  client = await PgliteSqlClient.create();
  must(await migrate(client));
}, 60_000);
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await client.execScript('DELETE FROM travelers; DELETE FROM point_ledgers;');
});

describe('migrate', () => {
  it('空の DB を今の版まで進め、もう一度呼んでも変わらない', async () => {
    const fresh = await PgliteSqlClient.create();
    expect(must(await migrate(fresh))).toEqual({ from: 0, to: PG_SCHEMA_VERSION });
    expect(must(await migrate(fresh))).toEqual({ from: PG_SCHEMA_VERSION, to: PG_SCHEMA_VERSION });
    await fresh.close();
  }, 60_000); // PGlite の起動に数秒かかる（ほかのテストと同時に走ると延びる）

  it('DB のほうが新しければ STORAGE_FAILED で、何も変えない', async () => {
    const fresh = await PgliteSqlClient.create();
    must(await migrate(fresh));
    await fresh.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [PG_SCHEMA_VERSION + 1, 'future']);
    const result = await migrate(fresh);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('STORAGE_FAILED');
    await fresh.close();
  }, 60_000);
});

describe('PgTravelerRepository', () => {
  it('未保存なら undefined を返す', async () => {
    expect(must(await new PgTravelerRepository(client).findById(TRAVELER_ID))).toBeUndefined();
  });

  it('保存して読み込むと同じ記録が戻り、版数は 1 になる', async () => {
    const repo = new PgTravelerRepository(client);
    const saved = must(await repo.save(visitOn(Traveler.create(TRAVELER_ID, '通い慣れた人', 'user'), 0), 0));
    expect(saved.version).toBe(1);
    const loaded = must(await repo.findById(TRAVELER_ID));
    expect(loaded?.toState()).toEqual(saved.toState());
    expect(loaded?.hasVisited(SPOT.id)).toBe(true);
  });

  it('2回目の保存は増えた行だけを足し、版数が 2 になる', async () => {
    const repo = new PgTravelerRepository(client);
    const first = must(await repo.save(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 0), 0));
    const second = must(await repo.save(visitOn(first, 1), 1));
    expect(second.version).toBe(2);
    const loaded = must(await repo.findById(TRAVELER_ID));
    expect(loaded?.visits.map((v) => v.localDate)).toEqual([TODAY, addDays(TODAY, 1)]);
    expect(loaded?.toState()).toEqual(second.toState());
  });

  it('版数が合わなければ CONFLICT で、何も書かない', async () => {
    const repo = new PgTravelerRepository(client);
    const first = must(await repo.save(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 0), 0));
    must(await repo.save(visitOn(first, 1), 1));
    const stale = await repo.save(visitOn(first, 2), 1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('CONFLICT');
    const again = await repo.save(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 3), 0);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('CONFLICT');
    expect(must(await repo.findById(TRAVELER_ID))?.visits).toHaveLength(2);
  });

  it('同じスポットの同じ日の訪問は UNIQUE 制約が拒否する（DI-08）', async () => {
    must(await new PgTravelerRepository(client).save(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 0), 0));
    const insert = client.query(
      `INSERT INTO traveler_visits (traveler_id, spot_id, district_id, visited_at, local_date, operation_id)
       VALUES ($1, $2, $3, now(), $4::date, $5)`,
      [TRAVELER_ID, SPOT.id, SPOT.districtId, TODAY, operationId(99)],
    );
    await expect(insert).rejects.toThrow();
  });

  it('訪問の行は書き換えられない（追記専用）', async () => {
    must(await new PgTravelerRepository(client).save(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 0), 0));
    await expect(client.query('UPDATE traveler_visits SET spot_id = $1', ['l_zz99'])).rejects.toThrow(/append-only/);
  });

  it('DB の行が集約より多ければ STORAGE_FAILED で、版数も進めない（DI-12）', async () => {
    const repo = new PgTravelerRepository(client);
    const first = must(await repo.save(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 0), 0));
    must(await repo.save(visitOn(first, 1), 1));
    await client.query('UPDATE travelers SET version = 1 WHERE traveler_id = $1', [TRAVELER_ID]);
    const result = await repo.save(first.withVersion(1), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('STORAGE_FAILED');
    expect(must(await repo.findById(TRAVELER_ID))?.version).toBe(1);
  });

  it('処理済みの操作ID は集約と同じ中身になる', async () => {
    const repo = new PgTravelerRepository(client);
    const saved = must(await repo.save(visitOn(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 0), 1), 0));
    const loaded = must(await repo.findById(TRAVELER_ID));
    expect(loaded?.toState().processedOperationIds).toEqual(saved.toState().processedOperationIds);
    expect(loaded?.hasProcessed(operationId(1))).toBe(true);
  });

  it('削除すると記録も消え、ほかの旅人は残る', async () => {
    const repo = new PgTravelerRepository(client);
    must(await repo.save(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 0), 0));
    must(await repo.save(visitOn(Traveler.create(OTHER_ID, 'ほかの人', 'user'), 0), 0));
    must(await repo.delete(TRAVELER_ID));
    expect(must(await repo.findById(TRAVELER_ID))).toBeUndefined();
    expect(must(await repo.findById(OTHER_ID))?.visits).toHaveLength(1);
    const rows = await client.query('SELECT count(*)::integer AS n FROM traveler_visits WHERE traveler_id = $1', [TRAVELER_ID]);
    expect(rows[0]?.['n']).toBe(0);
  });

  it('壊れた行があれば読込は失敗する（DI-01）', async () => {
    const repo = new PgTravelerRepository(client);
    must(await repo.save(visitOn(Traveler.create(TRAVELER_ID, '冒険者', 'user'), 0), 0));
    await client.query(
      'INSERT INTO traveler_discoveries (traveler_id, spot_id, district_id, discovered_at) VALUES ($1, $2, $3, now())',
      [TRAVELER_ID, 'not a spot id', 'd_joka'],
    );
    expect((await repo.findById(TRAVELER_ID)).ok).toBe(false);
  });
});

describe('PgPointLedgerRepository', () => {
  it('未保存なら版数 0 の空の台帳を返す', async () => {
    const ledger = must(await new PgPointLedgerRepository(client).find(TRAVELER_ID));
    expect(ledger.version).toBe(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('保存して読み込むと同じ行と残高が戻る', async () => {
    const repo = new PgPointLedgerRepository(client);
    const saved = must(await repo.save(entryOn(PointLedger.empty(TRAVELER_ID), 0), 0));
    expect(saved.version).toBe(1);
    const next = must(await repo.save(entryOn(saved, 1), 1));
    const loaded = must(await repo.find(TRAVELER_ID));
    expect(loaded.toState()).toEqual(next.toState());
    expect(loaded.balance()).toBe(next.balance());
    expect(loaded.entries).toHaveLength(2);
  });

  it('版数が合わなければ CONFLICT', async () => {
    const repo = new PgPointLedgerRepository(client);
    const saved = must(await repo.save(entryOn(PointLedger.empty(TRAVELER_ID), 0), 0));
    must(await repo.save(entryOn(saved, 1), 1));
    const stale = await repo.save(entryOn(saved, 2), 1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('CONFLICT');
    expect(must(await repo.find(TRAVELER_ID)).entries).toHaveLength(2);
  });

  it('台帳の行は書き換えられない（DI-06）', async () => {
    must(await new PgPointLedgerRepository(client).save(entryOn(PointLedger.empty(TRAVELER_ID), 0), 0));
    await expect(client.query('UPDATE ledger_entries SET points = 9999')).rejects.toThrow(/append-only/);
    await expect(client.query(
      `INSERT INTO ledger_entries (traveler_id, entry_id, kind, points, district_id, spot_id, at, local_date)
       VALUES ($1, 'x:visit', 'visit', -5, 'd_joka', 'l_jo01', now(), now()::date)`,
      [TRAVELER_ID],
    )).rejects.toThrow();
  });

  it('削除すると空の台帳に戻る', async () => {
    const repo = new PgPointLedgerRepository(client);
    must(await repo.save(entryOn(PointLedger.empty(TRAVELER_ID), 0), 0));
    must(await repo.delete(TRAVELER_ID));
    expect(must(await repo.find(TRAVELER_ID)).version).toBe(0);
  });
});
