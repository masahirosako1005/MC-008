/**
 * @file 決まった日数だけずらした時計（infrastructure/time 層。Clock の実装。連携サーバーのデモ用）
 * 連携サーバーは、CMS の画面から届いたデモの日付のずらし日数（DemoClock と同じ値）で、1回の要求ごとにこの時計を作る。
 * こうすると、CMS をブラウザだけで動かしていたとき（DemoClock）と同じ「今日」で、期間の規則を確かめられる。
 * ずらし日数は呼び出し側が検証してから渡す（parseDemoOffsetDays。0〜MAX_DEMO_OFFSET_DAYS）。
 */
import { createLogger } from '@/Common/logging/logger';
import { instantFromEpochMs, localDateOf, MS_PER_DAY } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { Clock } from '@/domain/ports/Clock';
import { systemNowMs } from '@/infrastructure/time/SystemClock';

const logger = createLogger('infrastructure/time/OffsetClock');

/** OffsetClock の依存 */
export interface OffsetClockDeps {
  /** ずらす日数（0 以上の整数） */
  readonly offsetDays: number;
  /** 実時刻（エポックミリ秒）。省略時は Date.now。テストで固定する */
  readonly nowMs?: () => number;
}

/** 決まった日数だけずらした時計 */
export class OffsetClock implements Clock {
  /**
   * 時計を作る。
   * @param deps ずらす日数・実時刻
   */
  constructor(private readonly deps: OffsetClockDeps) {}

  /**
   * 現在の瞬間（実時刻 + ずらす日数）を返す。
   * @returns UTC ISO 8601
   */
  now(): Instant {
    const log = logger.fn('now', { offsetDays: this.deps.offsetDays });
    const nowMs = this.deps.nowMs ?? systemNowMs;
    return log.exit(instantFromEpochMs(nowMs() + this.deps.offsetDays * MS_PER_DAY));
  }

  /**
   * 今日（JST 暦日）を返す。
   * @returns 'YYYY-MM-DD'
   */
  today(): LocalDate {
    return localDateOf(this.now());
  }
}
