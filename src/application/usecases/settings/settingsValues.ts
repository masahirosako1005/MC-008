/**
 * @file 設定の値の一覧・既定値・検証（application 層）
 * 画面からの入力と保存データの両方を同じ関数で検証する（SEC-16・DI-01。外から来た値を信用しない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import type { SettingsDto, TextScaleSetting } from '@/application/dto/SettingsDto';

const logger = createLogger('application/usecases/settings/settingsValues');

/** 文字の大きさの一覧（設定画面の並び順） */
export const TEXT_SCALE_SETTINGS: readonly TextScaleSetting[] = ['normal', 'large', 'xlarge'];

/** 未保存・読めないときの設定（CLAUDE.md 6.1。既定は標準） */
export const DEFAULT_SETTINGS: SettingsDto = Object.freeze({ textScale: 'normal' });

/**
 * 未検証の値を文字の大きさとして検証する。
 * @param raw 画面の入力や保存データの値
 * @returns 成功: 文字の大きさ。失敗: INVALID_INPUT
 */
export function parseTextScaleSetting(raw: unknown): Result<TextScaleSetting> {
  const log = logger.fn('parseTextScaleSetting', { type: typeof raw });
  const found = TEXT_SCALE_SETTINGS.find((s) => s === raw);
  if (found === undefined) return log.fail(fail(AppError.of('INVALID_INPUT', '文字の大きさの指定が正しくありません', { field: 'textScale' })));
  return log.exit(ok(found));
}

/**
 * 未検証の値を設定として検証する（知らない項目は捨てる）。
 * @param raw 保存データの中身
 * @returns 成功: 設定（凍結済み）。失敗: INVALID_INPUT
 */
export function parseSettings(raw: unknown): Result<SettingsDto> {
  const log = logger.fn('parseSettings');
  if (!isRecord(raw)) return log.fail(fail(AppError.of('INVALID_INPUT', '設定の形式が正しくありません', { kind: 'Settings', rule: 'shape' })));
  const textScale = parseTextScaleSetting(raw['textScale']);
  if (!textScale.ok) return log.fail(textScale);
  return log.exit(ok(Object.freeze({ textScale: textScale.value })));
}
