/**
 * @file アバターの装いの localStorage リポジトリ（infrastructure/storage 層。AvatarRepository の実装）
 * キー: P+'avatar.'+旅人ID。保存形式は封筒 { schemaVersion, version, data: { heldItemId? } }（docs/08 §5）。
 * 読込時にアイテムID の形式を検証する（DI-01）。読めないデータは EnvelopeStore が退避し、既定の姿（カメラ）として扱う。
 * 単一の書き手（その旅人の端末）なので版数は比較せず、保存済みの版数+1 で上書きする（セッションと同じ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseItemId } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { isRecord } from '@/Common/utils/guards';
import type { AvatarRepository, AvatarState } from '@/application/ports/AvatarRepository';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import type { StoredRecord } from '@/infrastructure/storage/schema/storageSchema';
import { avatarKeyOf } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageAvatarRepository');

/**
 * 保存レコードの中身を装いとして検証する。
 * @param record 保存レコード
 * @returns 成功: 装い（凍結済み）。失敗: INVALID_INPUT
 */
export function parseStoredAvatar(record: StoredRecord): Result<AvatarState> {
  const log = logger.fn('parseStoredAvatar', { version: record.version });
  if (!isRecord(record.data)) return log.fail(fail(AppError.of('INVALID_INPUT', '保存データの形式が正しくありません', { kind: 'Avatar', rule: 'shape' })));
  const raw = record.data['heldItemId'];
  if (raw === undefined) return log.exit(ok(Object.freeze({})));
  const itemId = parseItemId(raw);
  if (!itemId.ok) return log.fail(itemId);
  return log.exit(ok(Object.freeze({ heldItemId: itemId.value })));
}

/** アバターの装いの localStorage リポジトリ */
export class LocalStorageAvatarRepository implements AvatarRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 旅人の装いを読む。
   * @param travelerId 旅人ID
   * @returns 成功: 装い（未保存なら空）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async load(travelerId: TravelerId): Promise<Result<AvatarState>> {
    const log = logger.fn('load', { travelerId });
    const loaded = this.envelopes.read(avatarKeyOf(travelerId), parseStoredAvatar);
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value ?? {}));
  }

  /**
   * 旅人の装いを保存する。
   * @param travelerId 旅人ID
   * @param state 装い
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage に書き込む
   */
  async save(travelerId: TravelerId, state: AvatarState): Promise<Result<void>> {
    const log = logger.fn('save', { travelerId, heldItemId: state.heldItemId });
    const key = avatarKeyOf(travelerId);
    const current = this.envelopes.storedVersion(key);
    const version = current.ok ? current.value : 0;
    const data = state.heldItemId === undefined ? {} : { heldItemId: state.heldItemId };
    const written = this.envelopes.write(key, { version: version + 1, data });
    if (!written.ok) return log.fail(written);
    return log.exit(okVoid());
  }
}
