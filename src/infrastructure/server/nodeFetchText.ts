/**
 * @file 連携サーバーでマスタファイルを読む関数（infrastructure/server 層。MasterDataLoader の FetchText の Node 版）
 * 利用者アプリと同じ MasterDataLoader で、同じ public/master の JSON を同じ検証にかける（規則を1か所に＝DI-01）。
 * ファイル名は英数字 + '.json' だけを許し、決めたフォルダの外は読まない（SEC-16）。
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { FetchText } from '@/infrastructure/master/MasterDataLoader';

const logger = createLogger('infrastructure/server/nodeFetchText');

/** 読んでよいファイル名の書式（browserFetchText と同じ） */
const MASTER_FILE_NAME_PATTERN = /^[A-Za-z0-9]{1,40}\.json$/;

/**
 * フォルダからマスタを読む関数を作る。
 * @param masterDir マスタのフォルダ（例: 'public/master'）
 * @returns FetchText
 */
export function nodeFetchText(masterDir: string): FetchText {
  const root = resolve(masterDir);
  return async (fileName: string): Promise<Result<string>> => {
    const log = logger.fn('nodeFetchText', { fileName });
    if (!MASTER_FILE_NAME_PATTERN.test(fileName)) return log.fail(fail(AppError.of('INVALID_INPUT', 'マスタのファイル名が正しくありません')));
    try {
      return log.exit(ok(await readFile(resolve(root, fileName), 'utf8')));
    } catch (error) {
      log.error('マスタを読めませんでした', { fileName });
      return log.fail(fail(AppError.of('MASTER_FETCH_FAILED', 'マスタデータを読めませんでした', { file: fileName }, error)));
    }
  };
}
