/**
 * @file 文字の大きさを変えるユースケース（application 層・書込系）
 * 標準／大／特大のどれかだけを受け付ける（不正な値は INVALID_INPUT＝SEC-16）。同じ値を何度送っても結果は同じ（冪等＝DI-07）。
 * 他の設定項目は今のところ無いが、増えたときに消さないよう、読んでから文字の大きさだけを書き換えて保存する。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { SettingsDto, UpdateTextScaleInput } from '@/application/dto/SettingsDto';
import type { SettingsRepository } from '@/application/ports/SettingsRepository';
import { DEFAULT_SETTINGS, parseTextScaleSetting } from '@/application/usecases/settings/settingsValues';

const logger = createLogger('application/usecases/settings/UpdateTextScaleUseCase');

/** UpdateTextScaleUseCase の依存 */
export interface UpdateTextScaleDeps {
  readonly settings: SettingsRepository;
}

/** 文字の大きさを変える */
export class UpdateTextScaleUseCase implements UseCase<UpdateTextScaleInput, SettingsDto> {
  /**
   * 依存を受け取る。
   * @param deps 設定のリポジトリ
   */
  constructor(private readonly deps: UpdateTextScaleDeps) {}

  /**
   * 文字の大きさを検証して保存する。
   * @param input 文字の大きさ（未検証）
   * @returns 成功: 保存した設定。失敗: INVALID_INPUT／STORAGE_FAILED
   * @sideEffect 設定のリポジトリに書き込む
   */
  async execute(input: UpdateTextScaleInput): Promise<Result<SettingsDto>> {
    const log = logger.fn('execute', { textScale: input.textScale });
    const textScale = parseTextScaleSetting(input.textScale);
    if (!textScale.ok) return log.fail(textScale);
    const loaded = await this.deps.settings.load();
    // 読めなかったデータはリポジトリが退避済み。既定値の上に今回の指定を載せて保存し直す
    const base = loaded.ok ? (loaded.value ?? DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
    const next: SettingsDto = Object.freeze({ ...base, textScale: textScale.value });
    const saved = await this.deps.settings.save(next);
    if (!saved.ok) return log.fail(saved);
    return log.exit(ok(next));
  }
}
