/**
 * @file SQLite の登録内容リポジトリのテスト（infrastructure/server/sqlite 層・テスト）
 * LocalStorage 版と同じ約束（楽観ロック・検証）と、連携サーバーで足したもの（変更履歴・変更通知・版を戻さない消去・ファイルへの保存）を確かめる。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppError, Result } from '@/Common/result/Result';
import type { OperationId, ShopEventId, SpotId } from '@/Common/types/Id';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { CmsOverlayData, CmsShopEventRecord } from '@/application/ports/CmsOverlayRepository';
import { CmsDatabase } from '@/infrastructure/server/sqlite/CmsDatabase';
import { SqliteCmsOverlayRepository } from '@/infrastructure/server/sqlite/SqliteCmsOverlayRepository';
import { OffsetClock } from '@/infrastructure/time/OffsetClock';

const NOW_MS = Date.parse('2026-11-09T01:00:00.000Z');
const opened: CmsDatabase[] = [];
const dirs: string[] = [];
afterEach(() => {
  opened.splice(0).forEach((db) => db.close());
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/** テスト用: 成功値を取り出す */
function must<T>(result: Result<T, AppError<string>>): T {
  if (!result.ok) throw new Error(`期待しない失敗: ${result.error.code}`);
  return result.value;
}

/** テスト用: DB を開いてリポジトリを作る */
function repoOn(path = ':memory:'): { readonly db: CmsDatabase; readonly repo: SqliteCmsOverlayRepository } {
  const db = must(CmsDatabase.open(path));
  opened.push(db);
  return { db, repo: new SqliteCmsOverlayRepository({ db, actor: 'tester', clock: new OffsetClock({ offsetDays: 0, nowMs: () => NOW_MS }) }) };
}

const EVENT: CmsShopEventRecord = {
  id: 'c_test0001' as ShopEventId, spotId: 's_mm04' as SpotId, kind: 'coupon', title: '試食会', description: '新作をひとつ',
  start: '2026-11-10' as LocalDate, end: '2026-11-14' as LocalDate, createdAt: '2026-11-09T01:00:00.000Z' as Instant,
};
const DATA: CmsOverlayData = {
  spotEdits: [{ spotId: 's_mm04' as SpotId, hours: '10:00–18:00（水休）', amenities: ['kids', 'toilet'], updatedAt: '2026-11-09T01:00:00.000Z' as Instant }],
  shopEvents: [EVENT],
  processedOperationIds: ['aaaaaaaa-0000-4000-8000-000000000001' as OperationId],
};

describe('SqliteCmsOverlayRepository', () => {
  it('未保存なら版数 0 の空。保存すると版数が1つ進み、同じ中身を読める', async () => {
    const { repo } = repoOn();
    expect(must(await repo.load())).toEqual({ version: 0, spotEdits: [], shopEvents: [], processedOperationIds: [] });
    const saved = must(await repo.save(DATA, 0));
    expect(saved.version).toBe(1);
    expect(must(await repo.load())).toEqual({ ...DATA, version: 1 });
  });

  it('読んだときの版数と違えば CONFLICT で、中身は変えない（DI-10）', async () => {
    const { repo } = repoOn();
    must(await repo.save(DATA, 0));
    const stale = await repo.save({ ...DATA, shopEvents: [] }, 0);
    expect(!stale.ok && stale.error.code).toBe('CONFLICT');
    expect(must(await repo.load()).shopEvents).toHaveLength(1);
  });

  it('検証に通らない中身は書かない（DI-01）', async () => {
    const { repo } = repoOn();
    const bad = await repo.save({ ...DATA, shopEvents: [{ ...EVENT, title: 'x'.repeat(31) }] }, 0);
    expect(!bad.ok && bad.error.code).toBe('STORAGE_FAILED');
    expect(must(await repo.load()).version).toBe(0);
  });

  it('保存のたびに変更履歴（いつ・誰が・何を・前と後）を残し、確定後に変更を知らせる（DI-20）', async () => {
    const { db, repo } = repoOn();
    const notified: number[] = [];
    db.onChange((state) => notified.push(state.version));
    must(await repo.save(DATA, 0));
    must(await repo.save({ ...DATA, shopEvents: [{ ...EVENT, withdrawnOn: '2026-11-11' as LocalDate }] }, 1));
    must(await repo.clear());
    expect(notified).toEqual([1, 2, 3]);
    const audit = db.recentAudit(10).map((e) => [e.action, e.targetId, e.actor, e.overlayVersion]);
    expect(audit).toEqual([
      ['overlay.clear', 'all', 'tester', 3],
      ['shopEvent.withdraw', 'c_test0001', 'tester', 2],
      ['shopEvent.register', 'c_test0001', 'tester', 1],
      ['spotEdit.create', 's_mm04', 'tester', 1],
    ]);
    const withdrawal = db.recentAudit(2)[1];
    expect(withdrawal?.before).toMatchObject({ id: 'c_test0001', title: '試食会' });
    expect(withdrawal?.before).not.toHaveProperty('withdrawnOn');
    expect(withdrawal?.after).toMatchObject({ withdrawnOn: '2026-11-11' });
  });

  it('消しても版数は戻さない（配った版番号と食い違わない）', async () => {
    const { repo } = repoOn();
    must(await repo.save(DATA, 0));
    must(await repo.clear());
    expect(must(await repo.load())).toEqual({ version: 2, spotEdits: [], shopEvents: [], processedOperationIds: [] });
  });

  it('ファイルに保存し、開き直しても残る（形の版は user_version）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cms-db-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'cms.sqlite');
    const first = repoOn(path);
    must(await first.repo.save(DATA, 0));
    const firstId = first.db.readState().dbId;
    first.db.close();
    opened.splice(opened.indexOf(first.db), 1);
    const reopened = repoOn(path);
    expect(must(await reopened.repo.load())).toEqual({ ...DATA, version: 1 });
    expect(reopened.db.readState().dbId).toBe(firstId);
    expect(repoOn(':memory:').db.readState().dbId).not.toBe(firstId);
  });
});
