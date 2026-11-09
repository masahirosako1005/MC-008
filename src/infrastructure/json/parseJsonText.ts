/**
 * @file JSON 文字列の安全なパース（infrastructure 層の境界ヘルパー）
 * JSON.parse の例外をここで Result にする（try/catch は infrastructure の境界だけ＝docs/03 §5）。
 * 戻り値は unknown。呼び出し側が parseXxx で検証してから domain 型にする（DI-01）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

const logger = createLogger('infrastructure/json/parseJsonText');

/**
 * JSON 文字列をパースする。中身はログに出さない（長さだけ）。
 * @param text JSON 文字列（保存データ・マスタ）
 * @param kind 失敗時の details に入れる対象名（例: 'districts.json'）
 * @returns 成功: パース結果（unknown）。失敗: INVALID_INPUT（JSON として壊れている）
 */
export function parseJsonText(text: string, kind: string): Result<unknown> {
  const log = logger.fn('parseJsonText', { kind, length: text.length });
  try {
    const parsed: unknown = JSON.parse(text);
    return log.exit(ok(parsed));
  } catch (error) {
    log.error('JSON の解析に失敗', { kind });
    return log.fail(fail(AppError.of('INVALID_INPUT', 'データの形式が正しくありません', { kind, rule: 'json' }, error)));
  }
}
