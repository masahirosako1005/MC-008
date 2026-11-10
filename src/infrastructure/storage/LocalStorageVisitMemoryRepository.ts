/**
 * @file 訪問の思い出（自分の写真・メモ）の localStorage リポジトリ（infrastructure/storage 層。VisitMemoryRepository の実装）
 * キー: P+'memories.'+旅人ID。保存形式は封筒 { schemaVersion, version, data: { items: [{ spotId, localDate, note?, photo?, updatedAt }] } }（docs/08 §5）。
 * 読込時に ID・日付・メモの長さ・写真の形（JPEG の data URL）と大きさ・件数を検証する（DI-01）。読めないデータは EnvelopeStore が退避し、空として扱う。
 * 利用者のデータなので、設定画面の書き出し・全削除（LocalStorageDataPort。接頭辞で拾う）の対象になる（DI-21・PRV-05）。
 * 単一の書き手（その旅人の端末）なので版数は比較せず、保存済みの版数+1 で上書きする（装いと同じ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseSpotId } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { parseInstant, parseLocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import { isMemoryPhoto, MEMORY_ENTRY_LIMIT, MEMORY_NOTE_MAX } from '@/application/ports/VisitMemoryRepository';
import type { VisitMemory, VisitMemoryRepository } from '@/application/ports/VisitMemoryRepository';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import type { StoredRecord } from '@/infrastructure/storage/schema/storageSchema';
import { memoriesKeyOf } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageVisitMemoryRepository');

/**
 * 形式違反の失敗値を作る。
 * @param rule 違反した規則
 * @returns INVALID_INPUT の失敗
 */
function invalid(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '保存データの形式が正しくありません', { kind: 'VisitMemory', rule }));
}

/**
 * 保存データの1件を思い出として検証する。
 * @param raw 未検証の値
 * @returns 成功: 思い出（凍結済み）。失敗: INVALID_INPUT
 */
function parseMemory(raw: unknown): Result<VisitMemory> {
  const log = logger.fn('parseMemory');
  if (!isRecord(raw)) return log.fail(invalid('shape'));
  const spotId = parseSpotId(raw['spotId']);
  const localDate = parseLocalDate(raw['localDate']);
  const updatedAt = parseInstant(raw['updatedAt']);
  if (!spotId.ok || !localDate.ok || !updatedAt.ok) return log.fail(invalid('key'));
  const note = raw['note'];
  const photo = raw['photo'];
  if (note !== undefined && (typeof note !== 'string' || note.length === 0 || [...note].length > MEMORY_NOTE_MAX)) return log.fail(invalid('note'));
  if (photo !== undefined && !isMemoryPhoto(photo)) return log.fail(invalid('photo'));
  if (note === undefined && photo === undefined) return log.fail(invalid('empty'));
  return log.exit(
    ok(Object.freeze({ spotId: spotId.value, localDate: localDate.value, ...(note === undefined ? {} : { note }), ...(photo === undefined ? {} : { photo }), updatedAt: updatedAt.value })),
  );
}

/**
 * 保存レコードの中身を思い出の一覧として検証する（同じ訪問の重複は不正）。
 * @param record 保存レコード
 * @returns 成功: 思い出の一覧（凍結済み）。失敗: INVALID_INPUT
 */
export function parseStoredMemories(record: StoredRecord): Result<readonly VisitMemory[]> {
  const log = logger.fn('parseStoredMemories', { version: record.version });
  const items = isRecord(record.data) ? record.data['items'] : undefined;
  if (!Array.isArray(items) || items.length > MEMORY_ENTRY_LIMIT) return log.fail(invalid('items'));
  const memories: VisitMemory[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const parsed = parseMemory(item);
    if (!parsed.ok) return log.fail(parsed);
    const key = `${parsed.value.spotId}@${parsed.value.localDate}`;
    if (seen.has(key)) return log.fail(invalid('duplicate'));
    seen.add(key);
    memories.push(parsed.value);
  }
  return log.exit(ok(Object.freeze(memories)), `count=${memories.length}`);
}

/** 訪問の思い出の localStorage リポジトリ */
export class LocalStorageVisitMemoryRepository implements VisitMemoryRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 旅人の思い出をすべて読む。
   * @param travelerId 旅人ID
   * @returns 成功: 思い出の一覧（未保存なら空）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async list(travelerId: TravelerId): Promise<Result<readonly VisitMemory[]>> {
    const log = logger.fn('list', { travelerId });
    const loaded = this.envelopes.read(memoriesKeyOf(travelerId), parseStoredMemories);
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value ?? []));
  }

  /**
   * 旅人の思い出をまとめて保存する（空なら保存データごと消す）。
   * @param travelerId 旅人ID
   * @param memories 思い出の一覧
   * @returns 成功: void。失敗: STORAGE_FAILED（容量超過など）
   * @sideEffect localStorage に書き込む
   */
  async saveAll(travelerId: TravelerId, memories: readonly VisitMemory[]): Promise<Result<void>> {
    const log = logger.fn('saveAll', { travelerId, count: memories.length });
    const key = memoriesKeyOf(travelerId);
    if (memories.length === 0) {
      const removed = this.envelopes.remove(key);
      return removed.ok ? log.exit(okVoid(), 'removed') : log.fail(removed);
    }
    const current = this.envelopes.storedVersion(key);
    const version = current.ok ? current.value : 0;
    const items = memories.slice(0, MEMORY_ENTRY_LIMIT).map((m) => ({ ...m }));
    const written = this.envelopes.write(key, { version: version + 1, data: { items } });
    if (!written.ok) return log.fail(written);
    return log.exit(okVoid());
  }
}
