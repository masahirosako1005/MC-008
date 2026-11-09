/**
 * @file テスト用の端末の設定のリポジトリ（application/testing 層。メモリのみ）
 * SettingsRepository の偽物。保存の失敗も再現できる（failNextSave）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SettingsDto } from '@/application/dto/SettingsDto';
import type { SettingsRepository } from '@/application/ports/SettingsRepository';

const logger = createLogger('application/testing/InMemorySettingsRepository');

/** メモリ上の端末の設定のリポジトリ */
export class InMemorySettingsRepository implements SettingsRepository {
  private stored: SettingsDto | undefined;
  /** true なら次の save を STORAGE_FAILED にする（テスト用） */
  failNextSave = false;

  /**
   * 初期値を受け取る。
   * @param initial 保存済みにしておく設定（省略で未保存）
   */
  constructor(initial?: SettingsDto) {
    this.stored = initial;
  }

  /**
   * 設定を読む。
   * @returns 設定（未保存なら undefined）
   */
  async load(): Promise<Result<SettingsDto | undefined>> {
    const log = logger.fn('load');
    return log.exit(ok(this.stored));
  }

  /**
   * 設定を保存する。
   * @param settings 設定
   * @returns 成功: void。failNextSave のときは STORAGE_FAILED
   * @sideEffect メモリの値を書き換える
   */
  async save(settings: SettingsDto): Promise<Result<void>> {
    const log = logger.fn('save', { textScale: settings.textScale });
    if (this.failNextSave) {
      this.failNextSave = false;
      return log.fail(fail(AppError.of('STORAGE_FAILED', '保存できませんでした')));
    }
    this.stored = Object.freeze({ ...settings });
    return log.exit(okVoid());
  }
}
