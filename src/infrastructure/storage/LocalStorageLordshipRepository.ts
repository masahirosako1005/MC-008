/**
 * @file 地区の主の盤の localStorage リポジトリ（infrastructure/storage 層。LordshipRepository の実装）
 * キー: P+'lordship.'+旅人ID。保存形式は封筒 { schemaVersion, version, data: LordshipBoardState }（docs/08 §5）。
 * 読込は LordshipBoard.restore で検証（DI-01）、保存は楽観ロック（expectedVersion 不一致で CONFLICT＝DI-10）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { AppError, Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import { LordshipBoard } from '@/domain/competition/LordshipBoard';
import type { LordshipRepository, LordshipSaveErrorCode } from '@/domain/competition/LordshipRepository';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import { parseStoredLordship } from '@/infrastructure/storage/schema/parsers';
import { lordshipKeyOf } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageLordshipRepository');

/** 地区の主の盤の localStorage リポジトリ */
export class LocalStorageLordshipRepository implements LordshipRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 旅人の盤を読む。
   * @param travelerId 旅人ID
   * @returns 成功: 盤（未保存なら LordshipBoard.empty＝地区なし・版数0）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async find(travelerId: TravelerId): Promise<Result<LordshipBoard>> {
    const log = logger.fn('find', { travelerId });
    const loaded = this.envelopes.read(lordshipKeyOf(travelerId), (record) => parseStoredLordship(record, travelerId));
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value ?? LordshipBoard.empty(travelerId)));
  }

  /**
   * 盤を保存する（楽観ロック）。
   * @param board 保存する盤
   * @param expectedVersion 読んだときの版数（新規は 0）
   * @returns 成功: 版数を expectedVersion+1 にした盤。失敗: CONFLICT / STORAGE_FAILED
   * @sideEffect localStorage に書き込む
   * @see docs/06 DI-10
   */
  async save(board: LordshipBoard, expectedVersion: number): Promise<Result<LordshipBoard, AppError<LordshipSaveErrorCode>>> {
    const log = logger.fn('save', { travelerId: board.travelerId, expectedVersion, entries: board.entries.length });
    const written = this.envelopes.writeVersioned({
      suffix: lordshipKeyOf(board.travelerId),
      expectedVersion,
      build: (nextVersion) => board.withVersion(nextVersion).toState(),
    });
    if (!written.ok) return log.fail(written);
    return log.exit(ok(board.withVersion(written.value)), `version=${written.value}`);
  }

  /**
   * 盤を削除する（旅人切替・全データ削除用）。
   * @param travelerId 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage から削除する
   */
  async delete(travelerId: TravelerId): Promise<Result<void>> {
    const log = logger.fn('delete', { travelerId });
    const removed = this.envelopes.remove(lordshipKeyOf(travelerId));
    return removed.ok ? log.exit(removed) : log.fail(removed);
  }
}
