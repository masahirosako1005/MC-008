/**
 * @file 利用者操作ハンドラの共通ラッパー（Common/ui 層）
 * 1 ユーザー操作ごとに相関ID を発行してから処理を呼ぶ（docs/04 §2.4-3）。カード類のタップで使う。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';

const logger = createLogger('Common/ui/userAction');

/**
 * 相関ID を発行してから handler を呼ぶ関数を作る。
 * @param name 操作名（ログ用。例 'spot-card'）
 * @param handler 呼び出し側の処理
 * @returns イベントリスナとして渡せる関数
 */
export function userAction(name: string, handler: () => void): () => void {
  return (): void => {
    setCorrelationId();
    const log = logger.fn('userAction', { name });
    handler();
    log.exit(undefined);
  };
}
