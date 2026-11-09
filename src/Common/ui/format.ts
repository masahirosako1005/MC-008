/**
 * @file 表示用の書式ユーティリティ（Common/ui 層。純粋関数）
 * 距離など、複数の画面・共通部品で同じ書き方をしたい値の整形をまとめる。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('Common/ui/format');

/** この距離以上は km 表記にする（メートル） */
export const KILOMETER_THRESHOLD_M = 1000;

/**
 * 距離を表示用にする（1000m 未満は '62m'、以上は '1.2km'）。
 * @param meters 距離（メートル。負・非数は 0 とみなす）
 * @returns 表示文字列
 */
export function formatDistance(meters: number): string {
  const log = logger.fn('formatDistance', { meters });
  const m = Number.isFinite(meters) && meters > 0 ? Math.round(meters) : 0;
  if (m < KILOMETER_THRESHOLD_M) return log.exit(`${m}m`);
  return log.exit(`${(Math.round(m / 100) / 10).toFixed(1)}km`);
}
