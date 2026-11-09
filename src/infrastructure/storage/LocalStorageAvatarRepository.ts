/**
 * @file アバターの装いの localStorage リポジトリ（infrastructure/storage 層。AvatarRepository の実装）
 * キー: P+'avatar.'+旅人ID。保存形式は封筒 { schemaVersion, version, data: { heldItemId?, partIds?, coords?, seenPartIds? } }（docs/08 §5）。
 * 読込時に ID の形式と数の上限を検証する（DI-01）。読めないデータは EnvelopeStore が退避し、既定の姿として扱う。
 * 部品の定義・所持の確認はユースケース側（形式だけここで確かめる）。
 * 単一の書き手（その旅人の端末）なので版数は比較せず、保存済みの版数+1 で上書きする（セッションと同じ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseItemId } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { isRecord } from '@/Common/utils/guards';
import { AVATAR_PART_ID_PATTERN, MAX_OUTFIT_PARTS, MAX_SEEN_PARTS } from '@/application/ports/AvatarRepository';
import type { AvatarRepository, AvatarState } from '@/application/ports/AvatarRepository';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import type { StoredRecord } from '@/infrastructure/storage/schema/storageSchema';
import { avatarKeyOf } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageAvatarRepository');

/** マイコーデの枠の上限 */
const MAX_COORD_SLOTS = 8;

/** 書き換えられる AvatarState（組み立て用） */
type MutableState = { -readonly [K in keyof AvatarState]: AvatarState[K] };

/**
 * 部品ID の配列を検証する。
 * @param raw 未検証の値
 * @param max 要素数の上限
 * @returns 正しければ凍結した配列、違えば undefined
 */
function partIdListOf(raw: unknown, max: number): readonly string[] | undefined {
  const log = logger.fn('partIdListOf', { max });
  if (!Array.isArray(raw) || raw.length > max) return log.fail(undefined, 'shape');
  const ids = raw.filter((v): v is string => typeof v === 'string' && AVATAR_PART_ID_PATTERN.test(v));
  return ids.length === raw.length ? log.exit(Object.freeze(ids)) : log.fail(undefined, 'pattern');
}

/**
 * マイコーデの配列を検証する（空き枠は null）。
 * @param raw 未検証の値
 * @returns 正しければ凍結した配列、違えば undefined
 */
function coordListOf(raw: unknown): readonly (readonly string[] | null)[] | undefined {
  const log = logger.fn('coordListOf');
  if (!Array.isArray(raw) || raw.length > MAX_COORD_SLOTS) return log.fail(undefined, 'shape');
  const coords = raw.map((c) => (c === null ? null : partIdListOf(c, MAX_OUTFIT_PARTS)));
  return coords.includes(undefined) ? log.fail(undefined, 'coord') : log.exit(Object.freeze(coords as (readonly string[] | null)[]));
}

/**
 * 形式違反の失敗値を作る。
 * @param rule 違反した規則
 * @returns INVALID_INPUT の失敗
 */
function invalid(rule: string): Result<AvatarState> {
  return fail(AppError.of('INVALID_INPUT', '保存データの形式が正しくありません', { kind: 'Avatar', rule }));
}

/**
 * 保存レコードの中身を装いとして検証する。
 * @param record 保存レコード
 * @returns 成功: 装い（凍結済み）。失敗: INVALID_INPUT
 */
export function parseStoredAvatar(record: StoredRecord): Result<AvatarState> {
  const log = logger.fn('parseStoredAvatar', { version: record.version });
  if (!isRecord(record.data)) return log.fail(invalid('shape'));
  const data = record.data;
  const state: MutableState = {};
  if (data['heldItemId'] !== undefined) {
    const itemId = parseItemId(data['heldItemId']);
    if (!itemId.ok) return log.fail(itemId);
    state.heldItemId = itemId.value;
  }
  if (data['partIds'] !== undefined) state.partIds = partIdListOf(data['partIds'], MAX_OUTFIT_PARTS);
  if (data['coords'] !== undefined) state.coords = coordListOf(data['coords']);
  if (data['seenPartIds'] !== undefined) state.seenPartIds = partIdListOf(data['seenPartIds'], MAX_SEEN_PARTS);
  for (const key of ['partIds', 'coords', 'seenPartIds'] as const) {
    if (data[key] !== undefined && state[key] === undefined) return log.fail(invalid(key));
  }
  return log.exit(ok(Object.freeze(state)));
}

/**
 * 装いを保存レコードの中身にする（未設定の項目は書かない）。
 * @param state 装い
 * @returns 保存する中身
 */
function toStoredData(state: AvatarState): Record<string, unknown> {
  const log = logger.fn('toStoredData');
  const data: Record<string, unknown> = {};
  if (state.heldItemId !== undefined) data['heldItemId'] = state.heldItemId;
  if (state.partIds !== undefined) data['partIds'] = [...state.partIds].slice(0, MAX_OUTFIT_PARTS);
  if (state.coords !== undefined) data['coords'] = state.coords.slice(0, MAX_COORD_SLOTS).map((c) => (c === null ? null : [...c]));
  if (state.seenPartIds !== undefined) data['seenPartIds'] = [...state.seenPartIds].slice(0, MAX_SEEN_PARTS);
  return log.exit(data);
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
    const log = logger.fn('save', { travelerId, parts: state.partIds?.length });
    const key = avatarKeyOf(travelerId);
    const current = this.envelopes.storedVersion(key);
    const version = current.ok ? current.value : 0;
    const written = this.envelopes.write(key, { version: version + 1, data: toStoredData(state) });
    if (!written.ok) return log.fail(written);
    return log.exit(okVoid());
  }
}
