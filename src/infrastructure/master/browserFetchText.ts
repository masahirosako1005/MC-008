/**
 * @file ブラウザでマスタファイルを取得する関数（infrastructure/master 層。MasterDataLoader の FetchText 実装）
 * import.meta.env.BASE_URL + 'master/' + ファイル名 を同一オリジンから fetch する（SEC-07: CORS は自ドメインのみ）。
 * ファイル名は英数字 + '.json' だけを許し、パスの組み立てに外部入力を混ぜない（SEC-16）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

const logger = createLogger('infrastructure/master/browserFetchText');

/** 取得してよいファイル名の書式 */
const MASTER_FILE_NAME_PATTERN = /^[A-Za-z0-9]{1,40}\.json$/;

/**
 * マスタの URL を組み立てる。
 * @param fileName ファイル名（例: 'districts.json'）
 * @returns BASE_URL + 'master/' + fileName
 */
export function masterUrlOf(fileName: string): string {
  return `${import.meta.env.BASE_URL}master/${fileName}`;
}

/**
 * マスタファイルの本文を取得する。
 * @param fileName ファイル名（英数字 + '.json'）
 * @returns 成功: 本文。失敗: INVALID_INPUT（ファイル名不正）/ MASTER_FETCH_FAILED（HTTP エラー・ネットワーク失敗）
 * @sideEffect ネットワーク（同一オリジンへの GET）
 */
export async function browserFetchText(fileName: string): Promise<Result<string>> {
  const log = logger.fn('browserFetchText', { fileName });
  if (!MASTER_FILE_NAME_PATTERN.test(fileName)) {
    return log.fail(fail(AppError.of('INVALID_INPUT', 'マスタのファイル名が正しくありません')));
  }
  try {
    const response = await fetch(masterUrlOf(fileName), { method: 'GET', credentials: 'same-origin', cache: 'no-cache' });
    if (!response.ok) {
      return log.fail(fail(AppError.of('MASTER_FETCH_FAILED', 'マスタデータを取得できませんでした', { file: fileName, status: response.status })));
    }
    const text = await response.text();
    return log.exit(ok(text), `length=${text.length}`);
  } catch (error) {
    log.error('マスタの取得で例外', { fileName });
    return log.fail(fail(AppError.of('MASTER_FETCH_FAILED', 'マスタデータを取得できませんでした', { file: fileName }, error)));
  }
}
