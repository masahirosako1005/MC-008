/**
 * @file 端末の設定を読むユースケース（application 層・読取系）
 * 起動時（文字の大きさを最初の画面より前に当てる）と設定画面で使う。未保存なら既定値（標準）を返す。
 * 読めない保存データはリポジトリが退避して STORAGE_FAILED を返すので、呼び出し側は既定値で続けてよい。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { SettingsDto } from '@/application/dto/SettingsDto';
import type { SettingsRepository } from '@/application/ports/SettingsRepository';
import { DEFAULT_SETTINGS } from '@/application/usecases/settings/settingsValues';

const logger = createLogger('application/usecases/settings/GetSettingsUseCase');

/** GetSettingsUseCase の依存 */
export interface GetSettingsDeps {
  readonly settings: SettingsRepository;
}

/** 端末の設定を読む */
export class GetSettingsUseCase implements UseCase<void, SettingsDto> {
  /**
   * 依存を受け取る。
   * @param deps 設定のリポジトリ
   */
  constructor(private readonly deps: GetSettingsDeps) {}

  /**
   * 設定を返す。
   * @returns 成功: 設定（未保存なら既定値）。失敗: STORAGE_FAILED（読めないデータは退避済み）
   */
  async execute(): Promise<Result<SettingsDto>> {
    const log = logger.fn('execute');
    const loaded = await this.deps.settings.load();
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(loaded.value ?? DEFAULT_SETTINGS), loaded.value === undefined ? '未保存' : undefined);
  }
}
