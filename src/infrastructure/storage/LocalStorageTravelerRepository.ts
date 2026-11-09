/**
 * @file 旅人集約の localStorage リポジトリ（infrastructure/storage 層。TravelerRepository の実装）
 * キー: P+'traveler.'+旅人ID。保存形式は封筒 { schemaVersion, version, data: TravelerState }（docs/08 §5）。
 * 読込は Traveler.restore で検証（DI-01）、保存は楽観ロック（expectedVersion 不一致で CONFLICT＝DI-10）。
 * TravelerState はスポットID・日時・地区だけを持ち、生座標を含まない（SEC-13）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository, TravelerSaveErrorCode } from '@/domain/exploration/TravelerRepository';
import { checkTravelerInvariants } from '@/domain/exploration/TravelerState';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import type { EnvelopeStoreDeps } from '@/infrastructure/storage/schema/EnvelopeStore';
import { parseStoredTraveler } from '@/infrastructure/storage/schema/parsers';
import { travelerKeyOf } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageTravelerRepository');

/** localStorage リポジトリ共通の依存（キー・値ストアと接頭辞。デモと本番で名前空間を分ける＝DI-23） */
export type StorageRepositoryDeps = EnvelopeStoreDeps;

/** 旅人集約の localStorage リポジトリ */
export class LocalStorageTravelerRepository implements TravelerRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 旅人を読む。
   * @param id 旅人ID
   * @returns 成功: 旅人（未保存なら undefined）。失敗: STORAGE_FAILED（読めないデータは P+'backup.'+キー へ退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async findById(id: TravelerId): Promise<Result<Traveler | undefined>> {
    const log = logger.fn('findById', { id });
    const loaded = this.envelopes.read(travelerKeyOf(id), (record) => parseStoredTraveler(record, id));
    return loaded.ok ? log.exit(loaded) : log.fail(loaded);
  }

  /**
   * 旅人を保存する（楽観ロック）。
   * 書く前に不変条件（同一スポットは1日1回など）を検証し、満たさない集約は書かない（DI-08 を永続化層でも保証）。
   * @param traveler 保存する旅人
   * @param expectedVersion 読んだときの版数（新規は 0）
   * @returns 成功: 版数を expectedVersion+1 にした旅人。失敗: CONFLICT（保存済みの版数と不一致）/ STORAGE_FAILED（不変条件違反を含む）
   * @sideEffect localStorage に書き込む
   * @see docs/06 DI-08, DI-10, DI-12
   */
  async save(traveler: Traveler, expectedVersion: number): Promise<Result<Traveler, AppError<TravelerSaveErrorCode>>> {
    const log = logger.fn('save', { id: traveler.id, expectedVersion, visits: traveler.visits.length });
    const checked = checkTravelerInvariants(traveler.toState());
    if (!checked.ok) {
      return log.fail(fail(AppError.of('STORAGE_FAILED', '冒険者データを保存できませんでした', { rule: checked.error.details?.['rule'] })));
    }
    const written = this.envelopes.writeVersioned({
      suffix: travelerKeyOf(traveler.id),
      expectedVersion,
      build: (nextVersion) => traveler.withVersion(nextVersion).toState(),
    });
    if (!written.ok) return log.fail(written);
    return log.exit(ok(traveler.withVersion(written.value)), `version=${written.value}`);
  }

  /**
   * 旅人を削除する（旅人切替・全データ削除用）。
   * @param id 旅人ID
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage から削除する
   */
  async delete(id: TravelerId): Promise<Result<void>> {
    const log = logger.fn('delete', { id });
    const removed = this.envelopes.remove(travelerKeyOf(id));
    return removed.ok ? log.exit(removed) : log.fail(removed);
  }
}
