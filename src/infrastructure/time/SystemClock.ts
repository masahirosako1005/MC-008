/**
 * @file 実時刻の時計（infrastructure/time 層。Clock の本番実装）
 * 現在時刻を得てよいのはここと Common/utils/date だけ（DI-03）。今日は JST 暦日（DI-04）。
 */
import { createLogger } from '@/Common/logging/logger';
import { instantFromEpochMs, localDateOf } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { Clock } from '@/domain/ports/Clock';

const logger = createLogger('infrastructure/time/SystemClock');

/**
 * 端末の現在時刻（エポックミリ秒）を返す。
 * @returns Date.now() の値
 */
export function systemNowMs(): number {
  return Date.now();
}

/** 実時刻の時計 */
export class SystemClock implements Clock {
  /**
   * 時計を作る。
   * @param nowMs 現在のエポックミリ秒を返す関数（省略時は Date.now。テストで固定値を渡す）
   */
  constructor(private readonly nowMs: () => number = systemNowMs) {}

  /**
   * 現在の瞬間を返す。
   * @returns UTC ISO 8601 の Instant
   */
  now(): Instant {
    const log = logger.fn('now');
    const instant = instantFromEpochMs(this.nowMs());
    return log.exit(instant);
  }

  /**
   * 今日（JST 暦日）を返す。
   * @returns 'YYYY-MM-DD'
   */
  today(): LocalDate {
    const log = logger.fn('today');
    return log.exit(localDateOf(this.now()));
  }
}
