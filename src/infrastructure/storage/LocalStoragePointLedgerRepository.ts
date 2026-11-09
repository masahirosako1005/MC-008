/**
 * @file ポイント台帳の localStorage リポジトリ（infrastructure/storage 層。PointLedgerRepository の実装）
 * キー: P+'ledger.'+旅人ID。保存形式は封筒 { schemaVersion, version, data: PointLedgerState }（docs/08 §5）。
 * 読込は PointLedger.restore で検証（行ID一意・ボーナスの対応・残高の範囲＝DI-01, DI-06）、保存は楽観ロック（DI-10）。
 * 残高は保存しない（行の合計から導出＝DI-06）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { AppError, Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import { PointLedger } from '@/domain/reward/PointLedger';
import type { PointLedgerRepository, PointLedgerSaveErrorCode } from '@/domain/reward/PointLedgerRepository';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import { parseStoredLedger } from '@/infrastructure/storage/schema/parsers';
import { ledgerKeyOf } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStoragePointLedgerRepository');

/** ポイント台帳の localStorage リポジトリ */
export class LocalStoragePointLedgerRepository implements PointLedgerRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 旅人の台帳を読む。
   * @param travelerId 旅人ID
   * @returns 成功: 台帳（未保存なら PointLedger.empty＝版数0）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async find(travelerId: TravelerId): Promise<Result<PointLedger>> {
    const log = logger.fn('find', { travelerId });
    const loaded = this.envelopes.read(ledgerKeyOf(travelerId), (record) => parseStoredLedger(record, travelerId));
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value ?? PointLedger.empty(travelerId)));
  }

  /**
   * 台帳を保存する（楽観ロック）。
   * @param ledger 保存する台帳
   * @param expectedVersion 読んだときの版数（新規は 0）
   * @returns 成功: 版数を expectedVersion+1 にした台帳。失敗: CONFLICT / STORAGE_FAILED
   * @sideEffect localStorage に書き込む
   * @see docs/06 DI-06, DI-10
   */
  async save(ledger: PointLedger, expectedVersion: number): Promise<Result<PointLedger, AppError<PointLedgerSaveErrorCode>>> {
    const log = logger.fn('save', { travelerId: ledger.travelerId, expectedVersion, entries: ledger.entries.length });
    const written = this.envelopes.writeVersioned({
      suffix: ledgerKeyOf(ledger.travelerId),
      expectedVersion,
      build: (nextVersion) => ledger.withVersion(nextVersion).toState(),
    });
    if (!written.ok) return log.fail(written);
    return log.exit(ok(ledger.withVersion(written.value)), `version=${written.value}`);
  }

  /**
   * 台帳を削除する（旅人切替・全データ削除用。残高を減らす目的には使わない）。
   * @param travelerId 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage から削除する
   */
  async delete(travelerId: TravelerId): Promise<Result<void>> {
    const log = logger.fn('delete', { travelerId });
    const removed = this.envelopes.remove(ledgerKeyOf(travelerId));
    return removed.ok ? log.exit(removed) : log.fail(removed);
  }
}
