/**
 * @file 端末の設定の localStorage リポジトリ（infrastructure/storage 層。SettingsRepository の実装）
 * キー: P+'settings'（デモ nnishi.demo.settings／本番 nnishi.settings）。保存形式は封筒 { schemaVersion, version, data: { textScale } }（docs/08 §5）。
 * 読込時に値を検証する（DI-01）。読めないデータは EnvelopeStore が退避して STORAGE_FAILED を返し、次の読込からは未保存として扱う。
 * 書き手はこの端末だけなので版数は比較せず、保存済みの版数+1 で上書きする（セッション・アバターと同じ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SettingsDto } from '@/application/dto/SettingsDto';
import type { SettingsRepository } from '@/application/ports/SettingsRepository';
import { parseSettings } from '@/application/usecases/settings/settingsValues';
import type { StorageRepositoryDeps } from '@/infrastructure/storage/LocalStorageTravelerRepository';
import { EnvelopeStore } from '@/infrastructure/storage/schema/EnvelopeStore';
import type { StoredRecord } from '@/infrastructure/storage/schema/storageSchema';
import { SETTINGS_KEY } from '@/infrastructure/storage/storageKeys';

const logger = createLogger('infrastructure/storage/LocalStorageSettingsRepository');

/**
 * 保存レコードの中身を設定として検証する。
 * @param record 保存レコード
 * @returns 成功: 設定（凍結済み）。失敗: INVALID_INPUT
 */
export function parseStoredSettings(record: StoredRecord): Result<SettingsDto> {
  const log = logger.fn('parseStoredSettings', { version: record.version });
  const parsed = parseSettings(record.data);
  return parsed.ok ? log.exit(parsed) : log.fail(parsed);
}

/** 端末の設定の localStorage リポジトリ */
export class LocalStorageSettingsRepository implements SettingsRepository {
  private readonly envelopes: EnvelopeStore;

  /**
   * リポジトリを作る。
   * @param deps キー・値ストアと接頭辞（STORAGE_PREFIX）
   */
  constructor(deps: StorageRepositoryDeps) {
    this.envelopes = new EnvelopeStore(deps);
  }

  /**
   * 設定を読む。
   * @returns 成功: 設定（未保存なら undefined）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   * @sideEffect 読めないデータを退避する
   */
  async load(): Promise<Result<SettingsDto | undefined>> {
    const log = logger.fn('load');
    const loaded = this.envelopes.read(SETTINGS_KEY, parseStoredSettings);
    return loaded.ok ? log.exit(loaded) : log.fail(loaded);
  }

  /**
   * 設定を保存する。
   * @param settings 設定
   * @returns 成功: void。失敗: STORAGE_FAILED
   * @sideEffect localStorage に書き込む
   */
  async save(settings: SettingsDto): Promise<Result<void>> {
    const log = logger.fn('save', { textScale: settings.textScale });
    const current = this.envelopes.storedVersion(SETTINGS_KEY);
    const version = current.ok ? current.value : 0;
    const written = this.envelopes.write(SETTINGS_KEY, { version: version + 1, data: { textScale: settings.textScale } });
    if (!written.ok) return log.fail(written);
    return log.exit(okVoid());
  }
}
